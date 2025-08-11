'use client';

import React, { useEffect, useRef, FC } from 'react';

export const AudioPlayer: FC<{ stream: MediaStream }> = ({ stream }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
};