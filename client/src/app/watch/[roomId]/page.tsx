// src/app/watch/[roomId]/page.tsx
'use client';

import HlsPlayer from '@/components/HlsPlayer';
import { useParams } from 'next/navigation'; // Import useParams to get URL params
import { useEffect, useState } from 'react';

export default function WatchPage() {
  const params = useParams();
  const [hlsStreamUrl, setHlsStreamUrl] = useState<string | null>(null);

  // The roomId comes from the URL, e.g., /watch/room123 -> roomId is "room123"
  const roomId = params.roomId as string;

  useEffect(() => {
    if (roomId) {
      const manifestFile = 'stream.m3u8';
      const url = `http://localhost:5001/watch/${roomId}/${manifestFile}`;
      
      console.log(`[WatchPage] Room ID from URL: '${roomId}'`);
      console.log(`[WatchPage] Constructed HLS Stream URL: ${url}`);
      
      setHlsStreamUrl(url);
    }
  }, [roomId]);


  return (
    <div style={{ backgroundColor: '#111', color: 'white', minHeight: '100vh', padding: '20px' }}>
      <h1>Watching HLS Stream for Room: {roomId || 'Loading...'}</h1>
      {hlsStreamUrl ? (
        <HlsPlayer src={hlsStreamUrl} />
      ) : (
        <p>Generating stream URL...</p>
      )}
    </div>
  );
}