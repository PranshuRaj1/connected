// src/hls.ts
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as mediasoup from 'mediasoup';
import { Router, Producer } from 'mediasoup/node/lib/types';

type HlsSession = {
  ffmpeg?: ChildProcessWithoutNullStreams;
  plainTransport?: mediasoup.types.PlainTransport;
  consumer?: mediasoup.types.Consumer;
};

const hlsSessions = new Map<string, HlsSession>();
const HLS_OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'hls');

if (!fs.existsSync(HLS_OUTPUT_DIR)) {
  fs.mkdirSync(HLS_OUTPUT_DIR, { recursive: true });
}

export async function startHlsRecording({
  roomId,
  producer,
  router
}: {
  roomId: string;
  producer: mediasoup.types.Producer;
  router: mediasoup.types.Router;
}) {
  // stop previous if present
  const prev = hlsSessions.get(roomId);
  if (prev) {
    console.log(`[HLS] cleaning previous session for ${roomId}`);
    try { prev.ffmpeg?.kill('SIGKILL'); } catch {}
    try { await prev.consumer?.close(); } catch {}
    try { await prev.plainTransport?.close(); } catch {}
    hlsSessions.delete(roomId);
  }

  // create a PlainTransport that mediasoup will use to send RTP to FFmpeg
  const plainTransport = await router.createPlainTransport({
    listenIp: { ip: '127.0.0.1' }, // local only; use server IP if ffmpeg runs remotely
    rtcpMux: true,                 // important: single port for RTP+RTCP
    comedia: true,                // mediasoup will be the one sending; FFmpeg will connect via SDP
  });

  // get the single port mediasoup allocated for RTP (rtcpMux: true)
  const rtpPort = plainTransport.tuple.localPort;
  console.log(`[HLS Backend] Created PlainTransport for HLS on port ${rtpPort} (rtcp-mux)`);

  // create a consumer on that plainTransport for the provided producer
  // Use router.rtpCapabilities to satisfy API (we will use the router's capabilities)
  const consumer = await plainTransport.consume({
    producerId: producer.id,
    rtpCapabilities: router.rtpCapabilities,
    paused: true,
  });

  // construct a one-port SDP (rtcp-mux)
  // use codec info from the consumer (first codec)
  const codec = consumer.rtpParameters.codecs[0];
  const payloadType = codec.payloadType ?? 100; // fallback

  // Build fmtp string if codec.parameters exists
  const fmtp = codec.parameters && Object.keys(codec.parameters).length > 0
    ? `a=fmtp:${payloadType} ${Object.entries(codec.parameters).map(([k, v]) => `${k}=${v}`).join(';')}`
    : '';

  // create output directory for the room
  const outputDir = path.join(HLS_OUTPUT_DIR, roomId);
  fs.mkdirSync(outputDir, { recursive: true });

  const sdpFile = `/tmp/hls-${roomId}-${Date.now()}.sdp`;
  const sdp = [
    'v=0',
    `o=- 0 0 IN IP4 127.0.0.1`,
    's=mediasoup-hls',
    't=0 0',
    // single-port RTP for video
    `m=video ${rtpPort} RTP/AVP ${payloadType}`,
    `c=IN IP4 127.0.0.1`,
    `a=rtpmap:${payloadType} ${codec.mimeType.split('/')[1]}/${codec.clockRate}`,
    fmtp,
    'a=rtcp-mux',
    'a=recvonly',
    ''
  ].join('\r\n');

  fs.writeFileSync(sdpFile, sdp);
  console.log(`[HLS Backend] Wrote SDP for room ${roomId} to ${sdpFile}`);

  // spawn ffmpeg to read the SDP and generate HLS
  // ensure ffmpeg is available on PATH
  const ffmpegArgs = [
    '-loglevel', 'verbose',
    '-protocol_whitelist', 'file,udp,rtp',
    '-i', sdpFile,
    '-map', '0:v:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '5',
    '-hls_flags', 'delete_segments',
    '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
    path.join(outputDir, 'stream.m3u8')
  ];

  console.log(`[HLS Backend] Spawning FFmpeg for room ${roomId}: ffmpeg ${ffmpegArgs.join(' ')}`);
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stderr.on('data', (data) => {
    console.error(`[FFMPEG STDERR] Room ${roomId}: ${data.toString()}`);
  });

  ffmpeg.on('error', (err) => {
    console.error(`[FFMPEG ERROR] Room ${roomId}:`, err);
    // cleanup if spawn fails
    try { consumer.close(); } catch {}
    try { plainTransport.close(); } catch {}
    try { fs.unlinkSync(sdpFile); } catch {}
    hlsSessions.delete(roomId);
  });

  ffmpeg.on('close', async (code) => {
    console.log(`[FFMPEG CLOSE] Process for room ${roomId} exited with code ${code}`);
    // cleanup media resources when ffmpeg stops
    const sess = hlsSessions.get(roomId);
    if (sess) {
      try { await sess.consumer?.close(); } catch {}
      try { await sess.plainTransport?.close(); } catch {}
      hlsSessions.delete(roomId);
    }
    try { fs.unlinkSync(sdpFile); } catch {}
  });

  // resume consumer AFTER ffmpeg is spawned (let consumer deliver media)
  await consumer.resume();
  console.log(`[HLS Backend] Consumer resumed for room ${roomId}. HLS should be active.`);

  // store session for cleanup later
  hlsSessions.set(roomId, {
    ffmpeg,
    plainTransport,
    consumer,
  });
}

export function stopHlsRecording(roomId: string) {
  const sess = hlsSessions.get(roomId);
  if (!sess) {
    console.log(`[HLS] No HLS session found for ${roomId}`);
    return;
  }

  console.log(`[HLS] Stopping HLS for ${roomId}`);
  try { sess.ffmpeg?.kill('SIGKILL'); } catch {}
  (async () => {
    try { await sess.consumer?.close(); } catch {}
    try { await sess.plainTransport?.close(); } catch {}
  })();

  hlsSessions.delete(roomId);
}
