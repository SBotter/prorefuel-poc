import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "How It Works — LENS by ProRefuel",
  description:
    "LENS syncs your GoPro video with your activity GPS and generates a cinematic edit automatically. Learn how to get the best results.",
};

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans">

      {/* Ambient glows */}
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
          <Link href="/how-it-works" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-amber-400">
            How It Works
          </Link>
          <Link href="/privacidade" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">
            Privacy
          </Link>
        </div>
      </nav>

      {/* Content */}
      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-32 pb-24">

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/25 mb-8">
            <span className="text-amber-400 text-base">⚡</span>
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">Auto-Edited · 100% In Browser</span>
          </div>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tight leading-[0.9] mb-6">
            HOW<br />
            <span className="text-amber-500">LENS WORKS</span>
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed">
            LENS combines your activity GPS with your GoPro footage to automatically generate a synced cinematic edit — entirely in your browser, with no uploads, no accounts, no waiting.
          </p>
        </div>

        {/* ── GoPro CAMERA CARD ────────────────────────────────────────────── */}
        <SectionTitle>Supported camera</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          LENS is built around GoPro. The camera embeds a full high-frequency GPS track, accelerometer, and gyroscope directly in the MP4 file — the richest possible data source for scene detection and cinematic storytelling.
        </p>

        <div className="mb-14 p-6 rounded-2xl bg-zinc-900/60 border border-amber-500/30 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎥</span>
              <span className="font-black text-white text-sm uppercase tracking-wide">GoPro</span>
            </div>
            <span className="px-2 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-[9px] font-black uppercase tracking-widest text-amber-400">Maximum Data</span>
          </div>
          <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-1">Format</div>
          <div className="flex items-center gap-2 -mt-2">
            <span className="px-3 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-xs font-black text-white font-mono">.MP4</span>
          </div>
          <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-1">Sensors embedded in video</div>
          <ul className="space-y-1 -mt-2">
            <DataRow label="GPS track" value="18 Hz continuous" good />
            <DataRow label="Accelerometer" value="200 Hz" good />
            <DataRow label="Gyroscope" value="Yes" good />
            <DataRow label="Barometer" value="Yes" good />
          </ul>
          <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-1">Compatible models</div>
          <p className="text-zinc-400 text-xs -mt-2 leading-relaxed">Hero 5 Black, Hero 7–13, Hero 12 Black, GoPro Max</p>
        </div>

        {/* ── GPS SETUP: GOPRO ────────────────────────────────────────────── */}
        <SectionTitle>Enabling GPS on GoPro</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          The GoPro embeds a full GPS track — coordinates, speed, altitude — directly in the MP4 file at 18 samples per second. This is what drives scene detection and telemetry overlays. Follow these steps to guarantee GPS is active and locked before you start recording.
        </p>

        <div className="space-y-3 mb-6">
          <SetupStep number="1" title="Enable GPS in camera settings">
            On most models: <strong className="text-white">Settings (wrench icon) → Preferences → GPS → On</strong>. On Hero 10 and newer, GPS is always on when location is enabled in Quik pairing.
          </SetupStep>
          <SetupStep number="2" title="Power on outdoors — not inside a bag">
            The GPS antenna is on the top edge of the camera. Obstruct it or keep it indoors and it will never acquire a lock. Power on with clear sky visibility.
          </SetupStep>
          <SetupStep number="3" title="Wait for the GPS lock icon">
            After power-on, watch for the GPS satellite icon in the camera display. A blinking icon means searching. A <strong className="text-white">solid icon means lock acquired</strong>. This typically takes 10–30 seconds outdoors.
          </SetupStep>
          <SetupStep number="4" title="Start recording after lock — not before">
            If you start recording before lock, the GPS data for those first seconds is stale (cached from the last session). LENS detects and skips these pre-lock samples, but a shorter recording means fewer usable moments.
          </SetupStep>
        </div>

        <div className="mb-14 p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-500/80 mb-3">Model-specific notes</p>
          <div className="space-y-2 text-sm text-zinc-400">
            <p><span className="text-white font-bold">Hero 5 / 6:</span> GPS is off by default. Enable manually in settings before each session.</p>
            <p><span className="text-white font-bold">Hero 7 / 8 / 9:</span> GPS setting persists between sessions. Check once and leave it on.</p>
            <p><span className="text-white font-bold">Hero 10 / 11 / 12 / 13:</span> Best GPS chip in the lineup — faster lock, 18 Hz in all video modes, improved performance under tree canopy.</p>
            <p><span className="text-white font-bold">GoPro Max:</span> GPS included. Same setup as Hero 7+.</p>
          </div>
        </div>

        {/* ── GETTING THE BEST FROM GOPRO ─────────────────────────────────── */}
        <SectionTitle>Getting the most from your GoPro</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          GPS data quality directly affects the quality of the final edit. More data = better scene detection = more dynamic storytelling.
        </p>

        <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/60 mb-14">
          <div className="space-y-3">
            <BestPractice icon="🛰️" title="Wait for GPS lock, always">
              The GoPro GPS needs 10–30 seconds to lock in the first session of the day. Power on early, wait for the solid satellite icon, then start recording. Every locked second is a potential scene.
            </BestPractice>
            <BestPractice icon="☀️" title="Keep the top of the camera clear">
              The GPS antenna is embedded in the top edge of the camera body. Mounting accessories, thick pads, or covering the camera with a bag will degrade signal quality and reduce GPS frequency.
            </BestPractice>
            <BestPractice icon="🌳" title="Expect signal gaps in dense canopy">
              Mountain biking under heavy tree cover causes GPS signal loss and recovery cycles. Hero 12 and 13 Black have improved GPS chips that handle canopy much better than older models.
            </BestPractice>
            <BestPractice icon="⚡" title="Hero 12 / 13 for the richest telemetry">
              Newer GoPro models record at the full 18 Hz GPS rate in all video modes. Older models (Hero 5–8) may drop to lower frequencies in higher-resolution modes. For maximum data density, use the latest hardware you have.
            </BestPractice>
            <BestPractice icon="📊" title="How GPS quality affects the edit">
              A strong GPS signal with 18 Hz lock produces hundreds of data points per minute. LENS uses these to detect climbs, descents, sprints, technical sections, and flow zones with high confidence. Weak GPS produces fewer points — detection still works, but with lower precision.
            </BestPractice>
          </div>
        </div>

        {/* ── THE 3 STEPS ─────────────────────────────────────────────────── */}
        <SectionTitle>How it works in 3 steps</SectionTitle>
        <div className="space-y-4 mb-14">
          <Step
            number="01"
            title="Import your GPX activity file"
            body="Export your activity in GPX format from Strava, Garmin Connect, Wahoo, Komoot, or any cycling or running app. This file contains your full GPS track — coordinates, elevation, timestamps, heart rate, cadence, and power."
            tip="The GPX must cover the same time period during which the video was recorded. Start your GPS tracker before pressing record."
          />
          <Step
            number="02"
            title="Import your GoPro MP4"
            body="Upload your GoPro MP4 directly from your camera. LENS reads the GPS telemetry embedded in the file — no extra exports or apps needed. The camera and activity GPS both use the same satellite clock, so sync is automatic and precise."
            tip={undefined}
          />
          <Step
            number="03"
            title="Generate the cinematic edit"
            body="LENS synchronizes both sources, detects the most intense moments of your activity — climbs, sprints, descents — and generates a 9:16 cinematic edit ready for Instagram Reels, TikTok, and YouTube Shorts."
            tip={undefined}
          />
        </div>

        {/* ── HOW THE SYNC ENGINE WORKS ───────────────────────────────────── */}
        <SectionTitle>How the sync engine works</SectionTitle>
        <div className="space-y-4 mb-14">
          <InfoCard icon="🛰️">
            <p>
              <strong className="text-white">GPS satellite clock.</strong> Both your activity GPS (Garmin, Wahoo) and the GoPro video use the GPS satellite clock as their time reference — the same signal, worldwide. LENS matches them directly with no correction needed, down to the millisecond.
            </p>
          </InfoCard>
          <InfoCard icon="🎯">
            <p>
              <strong className="text-white">Scene detection from combined data.</strong> LENS analyzes speed, elevation, gradient, heart rate, cadence, and power from your activity GPX — plus the accelerometer and gyroscope from the GoPro video — to identify the most intense moments with high precision.
            </p>
          </InfoCard>
          <InfoCard icon="🎬">
            <p>
              <strong className="text-white">Cinematic cuts, 9:16 format.</strong> Each detected scene maps to a specific video seek position. LENS cuts between scenes, fades in and out, overlays speed and map data, and composes the final video frame-by-frame — entirely in your browser.
            </p>
          </InfoCard>
        </div>

        {/* ── COMMON ISSUES ───────────────────────────────────────────────── */}
        <SectionTitle>Common issues</SectionTitle>
        <div className="space-y-4 mb-14">
          <ProblemCard problem="No GPS in this video">
            GPS was not enabled in GoPro settings, or the camera never acquired a lock. Enable GPS in the settings menu, power on outdoors, and wait for the solid satellite icon before recording.
          </ProblemCard>
          <ProblemCard problem="GPS signal too weak">
            The camera started recording before GPS lock was acquired. Record a few seconds of stillness outdoors before moving. Avoid starting recordings inside or in areas with poor sky visibility.
          </ProblemCard>
          <ProblemCard problem="Video and GPX don't match">
            The video and the GPX file are from different sessions — their timestamps don't overlap. Make sure you import the GPX from the same ride during which the video was recorded. Check that your GPS device clock is set correctly.
          </ProblemCard>
          <ProblemCard problem="No scenes detected">
            The activity window covered by the video is too short, or the activity data is too uniform (constant flat speed). Try a longer video, or check that your GPX contains speed, elevation, or heart rate data.
          </ProblemCard>
        </div>

        {/* ── HELP & TROUBLESHOOTING ──────────────────────────────────────── */}
        <div id="help" className="scroll-mt-24">
          <SectionTitle>Help &amp; troubleshooting</SectionTitle>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">
            Detailed explanations for every error message you may encounter. Click any item to expand.
          </p>
          <div className="space-y-3 mb-14">
            <HelpItem error="Unsupported file format. Only GoPro MP4 files (.mp4) are accepted." title="Wrong video format">
              LENS only reads GoPro MP4 files because they embed GPS, accelerometer, and gyroscope data directly in the video container. Files from other cameras do not include this telemetry.
              <br /><br />
              <strong className="text-white">How to fix:</strong> Use a GoPro camera and import the original <code className="text-amber-400">.mp4</code> file directly from your camera or SD card. Do not convert or re-encode the file — the telemetry is lost in conversion.
            </HelpItem>
            <HelpItem error="Unsupported camera. Only GoPro cameras are supported." title="Unsupported camera">
              LENS detected a video file from a camera brand that does not embed GPS telemetry in the MP4 container in the format LENS can read.
              <br /><br />
              <strong className="text-white">How to fix:</strong> Use a GoPro camera (Hero 5 Black or newer). Make sure you are importing the original file — not a file edited or exported from another app.
            </HelpItem>
            <HelpItem error="No GPS data found in this video. Make sure GPS is enabled on your GoPro and that you waited for GPS lock before starting recording." title="No GPS in video">
              The GoPro video contains zero GPS samples. This happens when GPS is disabled in the camera settings, or when the recording started before any GPS signal was acquired.
              <br /><br />
              <strong className="text-white">How to fix:</strong>
              <br />① Go to <strong className="text-white">Settings → Preferences → GPS → On</strong> on your GoPro.
              <br />② Power on outdoors with clear sky above.
              <br />③ Wait for the solid GPS satellite icon on the camera display.
              <br />④ Only then press record.
            </HelpItem>
            <HelpItem error="GPS signal too weak — no valid fix was recorded. Wait for the GPS lock icon on your GoPro before starting your activity." title="GPS signal too weak">
              The GoPro started recording before a GPS lock was acquired. The samples in the file exist but have no valid satellite fix — LENS cannot use them for scene detection or sync.
              <br /><br />
              <strong className="text-white">How to fix:</strong> After powering on, wait until the GPS icon on the camera screen is <strong className="text-white">solid (not blinking)</strong>. This typically takes 10–30 seconds outdoors. Starting indoors or under dense cover significantly increases lock time.
            </HelpItem>
            <HelpItem error="This video and GPX file don't match. Make sure both files are from the same ride." title="Video and GPX don't match">
              LENS compared the GPS coordinates in the video with the GPS coordinates in the GPX file and found no spatial overlap — they are more than 2 km apart. This means they are from different sessions or different locations.
              <br /><br />
              <strong className="text-white">How to fix:</strong>
              <br />① Make sure the GPX was exported from the <strong className="text-white">same activity</strong> during which you were recording with the GoPro.
              <br />② Check that your GPS watch or cycling computer clock is set to the correct time zone and synced correctly.
            </HelpItem>
            <HelpItem error="No highlight scenes detected. Your activity may be too short or lack speed and elevation variation." title="No scenes detected">
              LENS analyzes speed, elevation, gradient, heart rate, and cadence to find highlight moments. If the activity window covered by the video is too short, too flat, or at constant speed, no scenes will score above the detection threshold.
              <br /><br />
              <strong className="text-white">How to fix:</strong>
              <br />① Use a longer ride — at least 20–30 minutes of varied activity works best.
              <br />② Make sure your GPX file includes speed or elevation data, not just coordinates.
              <br />③ Rides with climbs, descents, or sprint segments produce the most scenes.
            </HelpItem>
            <HelpItem error="No GPS track found in this file. Make sure your .gpx file contains valid location data." title="Empty or invalid GPX file">
              The .gpx file was parsed but contained no <code className="text-amber-400">&lt;trkpt&gt;</code> elements — the standard GPX tag for trackpoints with coordinates and timestamps. This happens with corrupted exports, route files (waypoints only), or files saved in an unsupported format.
              <br /><br />
              <strong className="text-white">How to fix:</strong>
              <br />① Export your activity again from your GPS app — use <strong className="text-white">GPX</strong> format, not FIT or TCX.
              <br />② In Strava: Activity → ••• → Export GPX.
              <br />③ In Garmin Connect: Activity → Export → Export to GPX.
              <br />④ In Wahoo: Activity → Share → GPX.
              <br />⑤ In Komoot: Tour → Download GPX.
            </HelpItem>
            <HelpItem error="Export failed / Not enough memory to export." title="Export failed or out of memory">
              The video export process uses your browser&apos;s WebAssembly memory to run FFmpeg. On longer recordings or lower-memory devices, this can exceed the available browser memory limit.
              <br /><br />
              <strong className="text-white">How to fix:</strong>
              <br />① Close all other browser tabs and windows, then try again.
              <br />② Use Chrome on a desktop or laptop — it has the highest WebAssembly memory limit.
              <br />③ If the error persists, reload the page to clear memory before starting the export.
            </HelpItem>
          </div>
        </div>

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <div className="p-8 rounded-3xl bg-zinc-900/60 border border-zinc-800 text-center">
          <p className="text-white font-black text-xl mb-2">Ready to generate your edit?</p>
          <p className="text-zinc-400 text-sm mb-6">GoPro MP4 · Desktop · Chrome</p>
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
            <a href="/how-it-works" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">How It Works</a>
            <a href="/privacidade" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">Privacy</a>
          </div>
          <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">© {new Date().getFullYear()} ProRefuel.app</p>
        </div>
      </footer>
    </main>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-black uppercase tracking-[0.3em] text-amber-500/80 mb-5 mt-2">
      {children}
    </h2>
  );
}

function DataRow({
  label, value, good, neutral, bad,
}: {
  label: string; value: string;
  good?: boolean; neutral?: boolean; bad?: boolean;
}) {
  const dot = good ? "bg-amber-500" : neutral ? "bg-zinc-500" : "bg-zinc-700";
  const val = good ? "text-white" : neutral ? "text-zinc-400" : "text-zinc-600";
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-zinc-500 text-xs">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        {label}
      </span>
      <span className={`text-xs font-bold ${val}`}>{value}</span>
    </li>
  );
}

function SetupStep({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/60">
      <div className="shrink-0 w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
        <span className="text-xs font-black text-amber-400">{number}</span>
      </div>
      <div>
        <p className="font-black text-white text-sm mb-1">{title}</p>
        <p className="text-zinc-400 text-sm leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function BestPractice({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-base shrink-0">{icon}</span>
      <div>
        <p className="font-black text-white text-xs uppercase tracking-wide mb-0.5">{title}</p>
        <p className="text-zinc-400 text-sm leading-relaxed">{children}</p>
      </div>
    </div>
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
        {tip && (
          <div className="flex gap-2 mt-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
            <span className="text-amber-400 text-sm shrink-0">💡</span>
            <p className="text-amber-400/80 text-[12px] leading-relaxed">{tip}</p>
          </div>
        )}
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

function HelpItem({ error, title, children }: { error: string; title: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl bg-zinc-900/40 border border-zinc-800/50 overflow-hidden">
      <summary className="flex items-start justify-between gap-4 p-5 cursor-pointer list-none select-none hover:bg-zinc-800/30 transition-colors">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-500/70 mb-1">{title}</p>
          <p className="text-zinc-300 text-xs font-mono leading-relaxed">{error}</p>
        </div>
        <span className="shrink-0 text-zinc-500 group-open:rotate-180 transition-transform duration-200 mt-0.5">▼</span>
      </summary>
      <div className="px-5 pb-5 pt-1 text-zinc-400 text-sm leading-relaxed border-t border-zinc-800/60">
        {children}
      </div>
    </details>
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
