import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "How It Works — LENS by ProRefuel",
  description:
    "Learn how LENS syncs your activity GPS with GoPro video telemetry and automatically generates a cinematic edit.",
};

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans">
      {/* Ambient */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] bg-amber-500/6 blur-[140px] rounded-full" />
        <div className="absolute bottom-0 left-[-5%] w-[30%] h-[40%] bg-amber-500/4 blur-[120px] rounded-full" />
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="text-xl font-black tracking-tight text-white group-hover:text-amber-400 transition-colors">LENS</span>
          <span className="hidden sm:block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel.app</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link href="/como-funciona" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-amber-400">
            How It Works
          </Link>
          <Link href="/privacidade" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">
            Privacy
          </Link>
        </div>
      </nav>

      {/* Content */}
      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-32 pb-24">

        {/* Header */}
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/25 mb-8">
            <span className="text-amber-400 text-base">⚡</span>
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">3 Steps · Auto-Edited</span>
          </div>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tight leading-[0.9] mb-6">
            HOW<br />
            <span className="text-amber-500">LENS WORKS</span>
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed">
            LENS combines your activity GPS with the internal telemetry of your GoPro video
            to automatically generate a synced cinematic edit — entirely in your browser.
          </p>
        </div>

        {/* DESKTOP ONLY NOTICE */}
        <div className="mb-14 p-6 rounded-2xl bg-amber-500/8 border border-amber-500/25">
          <div className="flex gap-4">
            <span className="text-2xl shrink-0">🖥️</span>
            <div>
              <h3 className="font-black text-amber-400 text-sm uppercase tracking-wide mb-2">Desktop + Chrome Required</h3>
              <p className="text-zinc-300 text-sm leading-relaxed mb-3">
                LENS runs 100% in your browser — but it is a computationally intensive engine. Processing a raw GoPro video requires significant GPU acceleration, high memory bandwidth, and multi-threaded WebAssembly execution. These capabilities are currently only available at full performance on <strong className="text-white">desktop or laptop computers running Google Chrome</strong>.
              </p>
              <div className="space-y-2 text-sm text-zinc-400">
                <p><span className="text-white font-bold">GPU rendering</span> — The cinematic composite (video + map + telemetry overlay) is rendered frame-by-frame using hardware-accelerated canvas. Mobile GPUs are not powerful enough to maintain the required frame rate.</p>
                <p><span className="text-white font-bold">Memory</span> — Raw GoPro files can exceed 4 GB. The engine streams and decodes them entirely in-memory. Mobile devices impose hard memory limits that would cause the process to crash.</p>
                <p><span className="text-white font-bold">WebAssembly (WASM)</span> — The video encoding pipeline uses FFmpeg compiled to WASM with multi-threading (SharedArrayBuffer). This requires a secure cross-origin context that Chrome enforces correctly; other browsers and mobile WebViews do not guarantee this.</p>
                <p><span className="text-white font-bold">Web Workers</span> — GPS telemetry extraction runs in a background thread to avoid blocking the UI. Mobile browsers throttle background workers aggressively, breaking the timing-sensitive sync pipeline.</p>
              </div>
              <p className="text-zinc-500 text-xs mt-3 italic">Support for additional browsers and mobile-optimised processing is planned for future releases.</p>
            </div>
          </div>
        </div>

        {/* THE 3 STEPS */}
        <SectionTitle>How it works in 3 steps</SectionTitle>
        <div className="space-y-4 mb-14">
          <Step
            number="01"
            title="Import your GPX activity file"
            body="Export your activity in GPX format from Garmin Connect, Strava, Wahoo, Komoot, or any cycling or running app. This file contains the full GPS track of your adventure — coordinates, elevation, and precise timestamps."
            tip="The GPX file must cover the same time period during which the video was recorded."
          />
          <Step
            number="02"
            title="Import your GoPro video (MP4)"
            body="Upload the MP4 file directly from your GoPro camera. LENS reads the GPS telemetry data embedded inside the video file itself — no external software, no extra exports needed."
            tip={undefined}
          />
          <Step
            number="03"
            title="Generate the cinematic edit"
            body="LENS automatically syncs both GPS tracks, detects the most intense moments of your adventure, and generates a cinematic edit in 9:16 format — ready to post on Instagram, TikTok, or YouTube Shorts."
            tip={undefined}
          />
        </div>

        {/* TECHNICAL REQUIREMENTS */}
        <SectionTitle>Technical requirements</SectionTitle>

        <div className="space-y-5 mb-14">

          <RequirementCard icon="📹" title="GoPro camera with GPS enabled" required>
            <p>LENS supports GoPro cameras with built-in GPS and GPMF telemetry:</p>
            <ul className="mt-2 space-y-1">
              <li>GoPro Hero 5 Black or newer</li>
              <li>GoPro Hero Session 5 or newer (GPS model)</li>
              <li>GoPro Hero 7, 8, 9, 10, 11, 12, 13</li>
              <li>GoPro Max</li>
            </ul>
            <p className="mt-3 text-amber-400/80">
              GPS must be <strong className="text-amber-400">enabled in the camera settings</strong> before starting recording.
            </p>
          </RequirementCard>

          <RequirementCard icon="🛰️" title="Camera GPS must be locked (fix acquired)" required>
            <p>
              The GoPro needs a few seconds after power-on to acquire a GPS satellite lock (fix).
              Record a few seconds of stillness before moving to ensure the GPS is locked.
            </p>
            <p className="mt-2">
              If the GPS never locks, the location data embedded in the video will be invalid and LENS will not be able to synchronize.
            </p>
            <Tip>Turn the camera on outdoors and wait for the GPS icon to appear before you start recording.</Tip>
          </RequirementCard>

          <RequirementCard icon="🗺️" title="GPX activity file" required>
            <p>The GPX file must contain:</p>
            <ul className="mt-2 space-y-1">
              <li><strong className="text-white">GPS coordinates</strong> — latitude and longitude for each point</li>
              <li><strong className="text-white">UTC timestamps</strong> — precise time for each point (ISO 8601 format)</li>
              <li><strong className="text-white">Elevation</strong> — required for the 3D visualization overlay</li>
            </ul>
            <p className="mt-3">Compatible sources: Garmin Connect, Strava, Wahoo, Komoot, RideWithGPS, and any standard GPX 1.1 export.</p>
          </RequirementCard>

          <RequirementCard icon="⏱️" title="Time overlap is required" required>
            <p>
              The period recorded in the GoPro video <strong className="text-white">must overlap with the GPX activity period</strong>.
              LENS finds the overlap using the GPS timestamps from both sources.
            </p>
            <Tip>Start both the camera recording and the activity tracker (Garmin/Strava) before you begin your ride or run. Make sure both are running at the same time.</Tip>
          </RequirementCard>

          <RequirementCard icon="📍" title="Spatial overlap is required" required>
            <p>
              The route recorded by the camera GPS must pass through the same geographic points as the activity GPX.
              LENS cross-references GPS positions from both sources to confirm they share the same route.
            </p>
            <p className="mt-2">
              If the camera was used in a completely different location from the recorded activity, synchronization will not work.
            </p>
          </RequirementCard>

        </div>

        {/* HOW THE SYNC WORKS */}
        <SectionTitle>How the sync engine works</SectionTitle>

        <div className="space-y-4 mb-14">
          <InfoCard icon="🔗">
            <p>
              <strong className="text-white">Two GPS sources, one clock.</strong> The activity GPX comes from your Garmin or smartphone — both use the GPS satellite clock. The GoPro video also embeds GPS timestamps in its internal telemetry. LENS uses these two GPS clocks to automatically align the two sources with no manual adjustment needed.
            </p>
          </InfoCard>

          <InfoCard icon="🎯">
            <p>
              <strong className="text-white">Position and speed matching.</strong> LENS cross-references the GPS coordinates from the video with those from the activity to identify matching points. It then analyzes the speed patterns from both sources to confirm alignment — ensuring precision even with minor clock variations.
            </p>
          </InfoCard>

          <InfoCard icon="🎬">
            <p>
              <strong className="text-white">Intensity moment detection.</strong> With both tracks synced, LENS automatically analyzes acceleration, speed, and elevation data to identify the most intense segments of your adventure — climbs, descents, sprints, corners — and selects them for the final edit.
            </p>
          </InfoCard>

          <InfoCard icon="📱">
            <p>
              <strong className="text-white">9:16 vertical edit, ready to post.</strong> The final video is rendered in the ideal format for social media — Instagram Reels, TikTok, YouTube Shorts. Telemetry overlays (speed, elevation, map) are composited in real-time during generation.
            </p>
          </InfoCard>
        </div>

        {/* COMMON ISSUES */}
        <SectionTitle>Common issues</SectionTitle>

        <div className="space-y-4 mb-14">
          <ProblemCard problem="Error: No GPS signal found in video">
            The camera GPS was not enabled or did not acquire a lock before recording. Check your GoPro settings to confirm GPS is turned on, and record outdoors while waiting for the fix.
          </ProblemCard>
          <ProblemCard problem="Error: No valid GPS points found">
            The GPS points in the video are corrupted or the camera was in a location with very weak signal (tunnels, covered areas). Try recording in locations with clear sky visibility.
          </ProblemCard>
          <ProblemCard problem="Sync is off or misaligned">
            Verify that the GPX file covers the same time window as the video. The Garmin/Wahoo clock and the camera GPS clock both need to be set to the correct time.
          </ProblemCard>
          <ProblemCard problem="Video has no GPMF telemetry">
            Only GoPro cameras with built-in GPS (Hero 5 and newer) generate files with GPMF telemetry. Videos from other cameras, smartphones, or older GoPros are not supported.
          </ProblemCard>
        </div>

        {/* CTA */}
        <div className="p-8 rounded-3xl bg-zinc-900/60 border border-zinc-800 text-center">
          <p className="text-white font-black text-xl mb-2">Ready to generate your edit?</p>
          <p className="text-zinc-400 text-sm mb-6">Open on your desktop with Chrome.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-amber-500 text-black font-black uppercase tracking-widest text-sm hover:scale-105 transition-transform shadow-[0_15px_40px_rgba(245,158,11,0.35)]"
          >
            ⚡ Get Started
          </Link>
        </div>

      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-800/50 bg-black/30 backdrop-blur-sm mt-4">
        <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2 group">
            <span className="text-sm font-black tracking-tight text-white group-hover:text-amber-400 transition-colors">LENS</span>
            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">by ProRefuel.app</span>
          </a>
          <div className="flex items-center gap-5">
            <a href="/como-funciona" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">How It Works</a>
            <a href="/privacidade" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">Privacy</a>
          </div>
          <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">© {new Date().getFullYear()} ProRefuel.app</p>
        </div>
      </footer>
    </main>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-black uppercase tracking-[0.3em] text-amber-500/80 mb-5 mt-2">
      {children}
    </h2>
  );
}

function Step({ number, title, body, tip }: { number: string; title: string; body: string; tip?: string }) {
  return (
    <div className="flex gap-5 p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/60 hover:border-amber-500/20 transition-colors">
      <div className="shrink-0 w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center">
        <span className="text-black font-black text-sm">{number}</span>
      </div>
      <div>
        <h3 className="font-black text-white text-sm uppercase tracking-wide mb-2">{title}</h3>
        <p className="text-zinc-400 text-sm leading-relaxed">{body}</p>
        {tip && <Tip>{tip}</Tip>}
      </div>
    </div>
  );
}

function RequirementCard({
  icon, title, required, children,
}: {
  icon: string; title: string; required?: boolean; children: ReactNode;
}) {
  return (
    <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/60 hover:border-zinc-700 transition-colors">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-xl shrink-0">{icon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-black text-white text-sm uppercase tracking-wide">{title}</h3>
            {required && (
              <span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-[9px] font-black uppercase tracking-widest text-red-400">
                Required
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="text-zinc-400 text-sm leading-relaxed ml-8 space-y-1 [&_li]:flex [&_li]:gap-2 [&_li]:before:content-['·'] [&_li]:before:text-amber-500/60 [&_li]:before:shrink-0">
        {children}
      </div>
    </div>
  );
}

function InfoCard({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/50">
      <span className="text-xl shrink-0">{icon}</span>
      <div className="text-zinc-400 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function ProblemCard({ problem, children }: { problem: string; children: ReactNode }) {
  return (
    <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/50">
      <p className="text-[11px] font-black uppercase tracking-widest text-red-400/80 mb-2 font-mono">{problem}</p>
      <p className="text-zinc-400 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 mt-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
      <span className="text-amber-400 text-sm shrink-0">💡</span>
      <p className="text-amber-400/80 text-[12px] leading-relaxed">{children}</p>
    </div>
  );
}
