
'use client';
import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js';

interface HlsPlayerProps {
  src: string;
}

const HlsPlayer: React.FC<HlsPlayerProps> = ({ src }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!src) return;

    const video = videoRef.current;
    if (!video) return;

    console.log(`[HLS Player] Component mounted. Received source URL: ${src}`);
    let hls = new Hls();

    if (Hls.isSupported()) {
      console.log('[HLS Player] HLS.js is supported by this browser.');
      
      // Log all HLS events for deep debugging
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[HLS Player] ✅ Manifest parsed successfully. Playing video.');
        video.play().catch(e => console.error('[HLS Player] Autoplay was prevented:', e));
      });

      hls.on(Hls.Events.LEVEL_LOADING, (event, data) => {
        console.log(`[HLS Player] Loading level ${data.level}...`);
      });

      hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
        console.log(`[HLS Player] Level ${data.level} loaded.`);
      });
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error(`[HLS Player] ❌ HLS.js Error!`);
        console.error(`- Type: ${data.type}`);
        console.error(`- Details: ${data.details}`);
        console.error(`- Fatal: ${data.fatal}`);
        if(data.response) {
           console.error(`- Response URL: ${data.response.url}`);
           console.error(`- Response Code: ${data.response.code}`);
        }
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('[HLS Player] Fatal network error encountered, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('[HLS Player] Fatal media error encountered, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
      
      hls.loadSource(src);
      hls.attachMedia(video);

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('[HLS Player] Using native browser HLS support (e.g., Safari).');
      video.src = src;
      video.addEventListener('loadedmetadata', () => {
        console.log('[HLS Player] Native player loaded metadata. Playing video.');
        video.play();
      });
       video.addEventListener('error', (e) => {
        console.error('[HLS Player] ❌ Native player error:', e);
      });
    }

    return () => {
      console.log('[HLS Player] Component unmounting. Destroying HLS instance.');
      if (hls) {
        hls.destroy();
      }
    };
  }, [src]);

  return <video ref={videoRef} controls autoPlay className="w-full h-full bg-black" />;
};

export default HlsPlayer;