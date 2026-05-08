"use client";

import { useEffect, useRef, useState } from "react";

export default function PhoneMockup() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const v = videoRef.current!;
    v.muted = true;
    v.preload = "auto";
    v.load();

    const onReady = () => {
      setLoaded(true);
      v.play().catch(() => {
        document.addEventListener("touchstart", () => v.play().catch(() => {}), {
          once: true,
          passive: true,
        });
      });
    };

    if (v.readyState >= 3) onReady();
    else {
      v.addEventListener("canplay", onReady, { once: true });
      v.addEventListener("loadeddata", onReady, { once: true });
    }
  }, []);

  return (
    <div className="relative w-full">
      {/* Phone shell — 5mm padding each side (~19px) */}
      <div
        className="relative rounded-[2.8rem] overflow-hidden"
        style={{
          background: "linear-gradient(145deg, #2a2a2a, #111)",
          padding: "10px",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.08), 0 40px 100px rgba(0,0,0,0.95), inset 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Side buttons */}
        <div className="absolute left-[-4px] top-[90px] w-[4px] h-[32px] rounded-l-sm bg-zinc-700" />
        <div className="absolute left-[-4px] top-[136px] w-[4px] h-[52px] rounded-l-sm bg-zinc-700" />
        <div className="absolute left-[-4px] top-[200px] w-[4px] h-[52px] rounded-l-sm bg-zinc-700" />
        <div className="absolute right-[-4px] top-[150px] w-[4px] h-[70px] rounded-r-sm bg-zinc-700" />

        {/* Screen bezel — 9:16 matches the video exactly */}
        <div className="relative rounded-[2.2rem] overflow-hidden bg-black" style={{ aspectRatio: "9/16" }}>
          {/* Dynamic island */}
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-20 rounded-full bg-black"
            style={{ width: "80px", height: "24px" }}
          />

          {/* Video */}
          <video
            ref={videoRef}
            src="/videos/hero-preview.mp4"
            muted
            playsInline
            loop
            preload="none"
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Loading spinner */}
          {!loaded && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950">
              <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Ambient glow under phone */}
      <div
        className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-12 rounded-full pointer-events-none"
        style={{ background: "rgba(245,158,11,0.18)", filter: "blur(28px)" }}
      />
    </div>
  );
}
