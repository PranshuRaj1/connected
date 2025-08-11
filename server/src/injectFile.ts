// Example: injectFileIntoMediasoup.ts  (drop into your server code)
// Assumes mediasoup Router instance is available.

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as mediasoup from 'mediasoup';

type InjectSession = {
  ffmpeg?: ChildProcessWithoutNullStreams;
  audioTransport?: mediasoup.types.PlainTransport;
  videoTransport?: mediasoup.types.PlainTransport;
  audioProducer?: mediasoup.types.Producer;
  videoProducer?: mediasoup.types.Producer;
}

const injectSessions = new Map<string, InjectSession>();

/**
 * Injects `inputFile` into mediasoup by spawning FFmpeg that sends RTP to mediasoup.
 * Returns the spawned FFmpeg child process.
 *
 * NOTE: This example uses OPUS (audio) and VP8 (video) as the codecs/params.
 * If your router doesn't support them, change mimeType/payloadType/clockRate accordingly.
 */
export async function injectFileIntoMediasoup({
  roomId,
  router,
  inputFile
}: {
  roomId: string;
  router: mediasoup.types.Router;
  inputFile: string;
}) {
  // 1) Cleanup old session if exists
  const old = injectSessions.get(roomId);
  if (old) {
    console.log(`[inject] cleaning old session for ${roomId}`);
    try { old.ffmpeg?.kill('SIGKILL'); } catch {}
    try { await old.audioProducer?.close(); } catch {}
    try { await old.videoProducer?.close(); } catch {}
    try { await old.audioTransport?.close(); } catch {}
    try { await old.videoTransport?.close(); } catch {}
    injectSessions.delete(roomId);
  }

  // 2) Create PlainTransports (listen on localhost)
  // Docs example uses comedia: true here — that's fine for local FFmpeg sending.
  const audioTransport = await router.createPlainTransport({
    listenIp: '127.0.0.1',
    rtcpMux: false,    // not muxed in the doc example; you may change to true if desired
    comedia: true,
  });

  const videoTransport = await router.createPlainTransport({
    listenIp: '127.0.0.1',
    rtcpMux: false,
    comedia: true,
  });

  const audioRtpPort = audioTransport.tuple.localPort;
  const audioRtcpPort = audioTransport.rtcpTuple?.localPort;
  const videoRtpPort = videoTransport.tuple.localPort;
  const videoRtcpPort = videoTransport.rtcpTuple?.localPort;

  console.log(`[inject] audio ports ${audioRtpPort}/${audioRtcpPort} video ports ${videoRtpPort}/${videoRtcpPort}`);

  // 3) Prepare rtpParameters for the Producers (these must match what FFmpeg will send)
  // Example: Opus audio, VP8 video. Choose payloadType/ssrc values you will use in FFmpeg.
  const audioPayloadType = 101;
  const audioSsrc = 11111111;
  const videoPayloadType = 102;
  const videoSsrc = 22222222;

  const audioRtpParameters: mediasoup.types.RtpParameters = {
    codecs: [{
      mimeType: 'audio/opus',
      payloadType: audioPayloadType,
      clockRate: 48000,
      channels: 2,
      rtcpFeedback: []
    }],
    encodings: [{ ssrc: audioSsrc }],
  };

  const videoRtpParameters: mediasoup.types.RtpParameters = {
    codecs: [{
      mimeType: 'video/vp8',
      payloadType: videoPayloadType,
      clockRate: 90000,
      rtcpFeedback: [] // FFmpeg doesn't support NACK/PLI/FIR typically
    }],
    encodings: [{ ssrc: videoSsrc }],
  };

  // 4) Tell mediasoup we will receive external RTP on these transports (create Producers)
  const audioProducer = await audioTransport.produce({
    kind: 'audio',
    rtpParameters: audioRtpParameters
  });

  const videoProducer = await videoTransport.produce({
    kind: 'video',
    rtpParameters: videoRtpParameters
  });

  // 5) Spawn FFmpeg to send the file's audio+video RTP to the transports.
  // Use -re to read at native rate. Use -f tee with two rtp outputs (audio|video).
  // NOTE: codec choices must match the rtpParameters above: opus for audio, vp8 for video.
  // Adjust bitrate/encoder settings to suit your needs.
  const ffmpegArgs = [
    '-re',
    '-stream_loop', '-1', // loop the file; remove if not desired
    '-i', inputFile,

    // Audio mapping: encode to opus
    '-map', '0:a:0',
    '-acodec', 'libopus',
    '-b:a', '96k',
    '-ac', '2',
    '-ar', '48000',

    // Video mapping: encode to vp8 (or h264 if you prefer, but choose matching mimeType)
    '-map', '0:v:0',
    '-c:v', 'libvpx', // vp8 encoder
    '-b:v', '1000k',
    '-deadline', 'realtime',
    '-cpu-used', '4',
    '-pix_fmt', 'yuv420p',

    // Use tee muxer to create two rtp outputs (audio and video)
    '-f', 'tee',
    `[select=a:f=rtp:ssrc=${audioSsrc}:payload_type=${audioPayloadType}]rtp://127.0.0.1:${audioRtpPort}?rtcpport=${audioRtcpPort}|[select=v:f=rtp:ssrc=${videoSsrc}:payload_type=${videoPayloadType}]rtp://127.0.0.1:${videoRtpPort}?rtcpport=${videoRtcpPort}`
  ];

  console.log('[inject] ffmpeg args:', ffmpegArgs.join(' '));
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stderr.on('data', (d) => console.error(`[inject FFMPEG STDERR] ${d.toString()}`));
  ffmpeg.on('error', (err) => console.error('[inject FFMPEG ERROR]', err));
  ffmpeg.on('close', (code) => {
    console.log(`[inject] ffmpeg closed with code ${code}`);
  });

  injectSessions.set(roomId, {
    ffmpeg, audioTransport, videoTransport, audioProducer, videoProducer
  });

  return ffmpeg;
}
