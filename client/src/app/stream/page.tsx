'use client';

import { useState, useRef, useEffect, useCallback, FC, FormEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { Transport, Producer, Consumer, RtpCapabilities, DtlsParameters, RtpParameters } from 'mediasoup-client/types';
import { useSearchParams } from 'next/navigation';
import { AudioPlayer } from '@/components/AudioPlayer';

// --- TYPE DEFINITIONS ---
interface VideoState {
  id: string;
  user: string;
  stream: MediaStream;
}
interface ServerToClientEvents {
  'new-producer': ({ username, producerId }: { username: string; producerId: string; }) => void;
  'peer-left': ({ username }: { username: string }) => void;
  'consumer-closed': ({ consumerId }: { consumerId: string }) => void;
  'meeting-ended': () => void;
}
interface ClientToServerEvents {
  joinRoom: (payload: { username: string; roomId: string; isCreator: boolean }, callback: (response: any) => void) => void;
  createWebRTCTransport: (callback: (response: any) => void) => void;
  'transport-connect': (payload: { dtlsParameters: DtlsParameters }) => void;
  'transport-recv-connect': (payload: { transportId: string; dtlsParameters: DtlsParameters }) => void;
  'transport-produce': (payload: { kind: 'audio' | 'video'; rtpParameters: RtpParameters; appData: any }, callback: (response: { id: string }) => void) => void;
  hangup: (username: string) => void;
  'end-meeting': () => void;
  'consumer-resume': (payload: { consumerId: string }) => void;
  consume: (payload: { rtpCapabilities: RtpCapabilities, remoteProducerId: string, remoteUsername: string }, callback: (response: any) => void) => void;
}

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5001';
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  withCredentials: true,
});

// --- SUB-COMPONENTS ---
const VideoPlayer: FC<{ stream: MediaStream, isLocal?: boolean }> = ({ stream, isLocal }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline muted={isLocal} className="w-full h-full object-cover" />;
};

const JoinScreen: FC<{ onJoin: (username: string, roomId: string, isCreator: boolean) => void }> = ({ onJoin }) => {
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const searchParams = useSearchParams();

  useEffect(() => {
    const roomIdFromUrl = searchParams.get('roomId');
    if (roomIdFromUrl) setRoomId(roomIdFromUrl);
  }, [searchParams]);

  const handleJoin = (e: FormEvent, isCreator: boolean) => {
    e.preventDefault();
    if (!username) return alert("Please enter a display name.");
    const finalRoomId = isCreator ? Math.random().toString(36).substring(2, 15) : roomId;
    if (!finalRoomId) return alert("Please enter a room ID to join.");
    onJoin(username, finalRoomId, isCreator);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="w-full max-w-md p-8 space-y-6 bg-white border-2 rounded-lg shadow-md dark:bg-gray-800 dark:border-gray-700">
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white">Join Conference</h2>
        <form className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Display Name</label>
            <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter your name" className="w-full px-3 py-2 mt-1 text-gray-900 bg-gray-50 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
          </div>
          <div>
            <label htmlFor="roomId" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Room ID (to join)</label>
            <input id="roomId" type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="Enter Room ID" className="w-full px-3 py-2 mt-1 text-gray-900 bg-gray-50 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
          </div>
          <div className="flex items-center justify-between gap-4 pt-2">
            <button onClick={(e) => handleJoin(e, true)} className="w-full px-4 py-2 font-bold text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500">Create Meeting</button>
            <button onClick={(e) => handleJoin(e, false)} className="w-full px-4 py-2 font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">Join Meeting</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Controls: FC<{ onToggleAudio: () => void; onToggleVideo: () => void; onHangUp: () => void; isAudioMuted: boolean; isVideoPaused: boolean; }> = ({ onToggleAudio, onToggleVideo, onHangUp, isAudioMuted, isVideoPaused }) => (
  <div className="fixed bottom-0 left-0 right-0 flex justify-center p-4 bg-black bg-opacity-50">
    <div className="flex gap-4">
      <button onClick={onToggleAudio} className="p-3 bg-gray-700 rounded-full text-white">{isAudioMuted ? 'Unmute' : 'Mute'}</button>
      <button onClick={onToggleVideo} className="p-3 bg-gray-700 rounded-full text-white">{isVideoPaused ? 'Resume' : 'Pause'}</button>
      <button onClick={onHangUp} className="p-3 bg-red-600 rounded-full text-white">Hang Up</button>
    </div>
  </div>
);

const VideoGrid: FC<{ videos: VideoState[]; localUsername: string }> = ({ videos, localUsername }) => (
  <div className="flex-1 p-4 grid gap-4 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
    {videos.map(({ id, user, stream }) => (
      <div key={id} className="relative aspect-video bg-black rounded-lg overflow-hidden">
        <VideoPlayer stream={stream} isLocal={user === localUsername} />
        <div className="absolute bottom-2 left-2 px-2 py-1 text-white bg-black bg-opacity-50 rounded">
          {user}{user === localUsername ? ' (You)' : ''}
        </div>
      </div>
    ))}
  </div>
);

// --- MAIN PAGE COMPONENT ---
export default function MeetPage() {
  const [isInRoom, setIsInRoom] = useState(false);
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [videos, setVideos] = useState<VideoState[]>([]);
  const [audioStreams, setAudioStreams] = useState<MediaStream[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoPaused, setIsVideoPaused] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const producerTransportRef = useRef<Transport | null>(null);
  const consumerTransportRef = useRef<Transport | null>(null);
  const videoProducerRef = useRef<Producer | null>(null);
  const audioProducerRef = useRef<Producer | null>(null);
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const localUsernameRef = useRef('');

  const addParticipantVideo = useCallback((user: string, id: string, stream: MediaStream) => {
    console.log(`[UI] Adding video for ${user}`);
    setVideos((prev) => {
      if (prev.find(v => v.user === user && v.id.startsWith('consumer'))) return prev;
      return [...prev, { user, id, stream }];
    });
  }, []);

  const removeParticipantVideo = useCallback((user: string) => {
    console.log(`[UI] Removing video for ${user}`);
    setVideos((prev) => prev.filter((video) => video.user !== user));
  }, []);

  const consumeNewProducer = useCallback(async (producerId: string, producerUsername: string) => {
    console.log(`[CONSUME]  Attempting to consume producerId: ${producerId} from user: ${producerUsername}`);
    if (!deviceRef.current || !consumerTransportRef.current) {
        console.error("[CONSUME]  Device or consumer transport not ready.");
        return;
    }
    if (!deviceRef.current.loaded) {
        console.error("[CONSUME]  Device not loaded.");
        return;
    }

    const payload = {
        rtpCapabilities: deviceRef.current.rtpCapabilities,
        remoteProducerId: producerId,
        remoteUsername: producerUsername,
    };
    console.log("[CONSUME]  Emitting 'consume' with payload:", payload);

    socket.emit('consume', payload, async (params: any) => {
        console.log("[CONSUME]  Received response for 'consume':", params);
        if (params.error) {
            console.error('[CONSUME]  Cannot consume:', params.error);
            return;
        }

        try {
            const consumer = await consumerTransportRef.current!.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });
            consumersRef.current.set(consumer.id, consumer);
            console.log("[CONSUME] Consumer created:", consumer);

            const { track } = consumer;
    if (consumer.kind === 'video') {
        const remoteStream = new MediaStream([track]);
        addParticipantVideo(producerUsername, consumer.id, remoteStream);
    } else if (consumer.kind === 'audio') {
      
        const remoteAudioStream = new MediaStream([track]);
        setAudioStreams(prev => [...prev, remoteAudioStream]);
    }

            console.log("[CONSUME]  Emitting 'consumer-resume' for consumerId:", consumer.id);
            socket.emit('consumer-resume', { consumerId: consumer.id });
        } catch (e) {
            console.error("[CONSUME]  Error creating consumer on client:", e);
        }
    });
  }, [addParticipantVideo]);

  useEffect(() => {
    const handleNewProducer = ({ username, producerId }: { username: string, producerId: string }) => {
        if (username === localUsernameRef.current) {
            console.log("Ignoring my own new producer notification.");
            return;
        }
        console.log(`[EVENT]  Received 'new-producer' from user: ${username}, producerId: ${producerId}`);
        consumeNewProducer(producerId, username);
    };

    const handlePeerLeft = ({ username }: { username: string }) => {
        console.log(`[EVENT] ⬅ Received 'peer-left' for user: ${username}`);
        removeParticipantVideo(username);
    };

    const handleMeetingEnded = () => {
        console.log("[EVENT] ⬅ Received 'meeting-ended'");
        alert("The meeting has ended.");
        setIsInRoom(false);
        setVideos([]);
    };

    socket.on('new-producer', handleNewProducer);
    socket.on('peer-left', handlePeerLeft);
    socket.on('meeting-ended', handleMeetingEnded);

    return () => {
        socket.off('new-producer', handleNewProducer);
        socket.off('peer-left', handlePeerLeft);
        socket.off('meeting-ended', handleMeetingEnded);
    };
  }, [consumeNewProducer, removeParticipantVideo]);

  const handleJoinRoom = useCallback(async (joinUsername: string, joinRoomId: string, isCreator: boolean) => {
    console.log(`[JOIN] Attempting to join room: ${joinRoomId} as ${joinUsername}`);
    localUsernameRef.current = joinUsername;
    setUsername(joinUsername);
    setRoomId(joinRoomId);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localStreamRef.current = stream;
    addParticipantVideo(joinUsername, 'local', stream);
    setIsInRoom(true);

    console.log("[JOIN]  Emitting 'joinRoom'");
    socket.emit('joinRoom', { username: joinUsername, roomId: joinRoomId, isCreator }, async (response) => {
        console.log("[JOIN]  Received response for 'joinRoom':", response);
        if (response.error) {
            alert(response.error);
            setIsInRoom(false);
            return;
        }

        const device = new Device();
        console.log("[JOIN]  Loading mediasoup device with router capabilities...");
        await device.load({ routerRtpCapabilities: response.rtpCapabilities });
        deviceRef.current = device;
        console.log("[JOIN]  Device loaded.");

        console.log("[JOIN]  Emitting 'createWebRTCTransport'");
        socket.emit('createWebRTCTransport', async (transportRes) => {
            console.log("[JOIN]  Received response for 'createWebRTCTransport':", transportRes);
            if (transportRes.error) {
                console.error(transportRes.error);
                return;
            }

            // Create Send Transport
            console.log("[PRODUCER]  Creating send transport...");
            const sendTransport = device.createSendTransport(transportRes.producer);
            sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                console.log("[PRODUCER]  'connect' event on send transport. Emitting 'transport-connect'");
                socket.emit('transport-connect', { dtlsParameters });
                callback();
            });
            sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                console.log(`[PRODUCER]  'produce' event for kind: ${kind}. Emitting 'transport-produce'`);
                socket.emit('transport-produce', { kind, rtpParameters, appData: { ...appData, username: joinUsername } }, (res) => {
                    console.log(`[PRODUCER]  Received response for 'transport-produce' with producer ID: ${res.id}`);
                    callback({ id: res.id });
                });
            });
            producerTransportRef.current = sendTransport;
            console.log("[PRODUCER]  Send transport created.");

            // Create Receive Transport
            console.log("[CONSUMER]  Creating receive transport...");
            const recvTransport = device.createRecvTransport(transportRes.consumer);
            recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                console.log("[CONSUMER]  'connect' event on receive transport. Emitting 'transport-recv-connect'");
                socket.emit('transport-recv-connect', { transportId: recvTransport.id, dtlsParameters });
                callback();
            });
            consumerTransportRef.current = recvTransport;
            console.log("[CONSUMER]  Receive transport created.");

            // Start producing local media
            const audioProducer = await sendTransport.produce({ track: stream.getAudioTracks()[0], appData: { username: joinUsername, mediaType: 'audio' } });
            audioProducerRef.current = audioProducer;
            const videoProducer = await sendTransport.produce({ track: stream.getVideoTracks()[0], appData: { username: joinUsername, mediaType: 'video' } });
            videoProducerRef.current = videoProducer;
            console.log("[PRODUCER]  Audio and video producers created locally.");

            // Consume existing producers
            if (response.existingProducers && response.existingProducers.length > 0) {
                console.log(`[JOIN]  Found ${response.existingProducers.length} existing producers. Consuming them now.`);
                for (const producer of response.existingProducers) {
                    await consumeNewProducer(producer.producerId, producer.username);
                }
            } else {
                console.log("[JOIN] No existing producers found.");
            }
        });
    });
  }, [addParticipantVideo, consumeNewProducer]);

  const handleToggleAudio = useCallback(() => {
    if (!audioProducerRef.current) return;
    const newMutedState = !isAudioMuted;
    if (newMutedState) audioProducerRef.current.pause();
    else audioProducerRef.current.resume();
    setIsAudioMuted(newMutedState);
    console.log(`[CONTROL] Audio ${newMutedState ? 'Muted' : 'Unmuted'}`);
  }, [isAudioMuted]);

  const handleToggleVideo = useCallback(() => {
    if (!videoProducerRef.current) return;
    const newPausedState = !isVideoPaused;
    if (newPausedState) videoProducerRef.current.pause();
    else videoProducerRef.current.resume();
    setIsVideoPaused(newPausedState);
    console.log(`[CONTROL] Video ${newPausedState ? 'Paused' : 'Resumed'}`);
  }, [isVideoPaused]);

  const handleHangUp = useCallback(() => {
    console.log("[CONTROL] Hang Up initiated.");
    socket.emit('hangup', username);
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    producerTransportRef.current?.close();
    consumerTransportRef.current?.close();
    setIsInRoom(false);
    setVideos([]);
  }, [username]);

  if (!isInRoom) {
    return <JoinScreen onJoin={handleJoinRoom} />;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <header className="p-4 text-xl font-bold text-center">Room: {roomId}</header>
      <VideoGrid videos={videos} localUsername={username} />

     
      {audioStreams.map((stream) => (
        <AudioPlayer key={stream.id} stream={stream} />
      ))}

      <Controls
        onToggleAudio={handleToggleAudio}
        onToggleVideo={handleToggleVideo}
        onHangUp={handleHangUp}
        isAudioMuted={isAudioMuted}
        isVideoPaused={isVideoPaused}
      />
    </div>
);
}