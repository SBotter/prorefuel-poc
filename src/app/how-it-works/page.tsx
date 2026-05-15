import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "How It Works — LENS by ProRefuel",
  description:
    "LENS syncs your GoPro, iPhone, or Android video with your GPS activity (Garmin, Strava, Suunto) and generates a cinematic edit automatically.",
};

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans">

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
          <Link href="/how-it-works" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-amber-400">How It Works</Link>
          <Link href="/privacidade" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">Privacy</Link>
        </div>
      </nav>

      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-32 pb-24">

        {/* ── HEADER ───────────────────────────────────────────────────────── */}
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/25 mb-8">
            <span className="text-amber-400 text-base">⚡</span>
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">Auto-Edited · 100% In Browser</span>
          </div>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tight leading-[0.9] mb-6">
            HOW<br />
            <span className="text-amber-500">LENS WORKS</span>
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed mb-5">
            LENS combines your GPS activity with your video — from any supported camera — to automatically generate a synced cinematic edit, entirely in your browser.
          </p>
          {/* Compatibility strip */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Works with</span>
            {[
              { src: "/devices/logos/gopro_logo.svg",   w: 52 },
              { src: "/devices/logos/iphone_logo.svg",  w: 58 },
              { src: "/devices/logos/android_logo.svg", w: 72 },
              { src: "/devices/logos/garmin_logo.svg",  w: 52 },
              { src: "/devices/logos/strava_logo.svg",  w: 44 },
              { src: "/devices/logos/suunto_logo.svg",  w: 52 },
            ].map((d, i) => (
              <div key={i} className="flex items-center justify-center h-7 px-3 rounded-lg bg-white/50 border border-white/40">
                <img src={d.src} alt="" style={{ height: 14, width: "auto", maxWidth: d.w }} />
              </div>
            ))}
          </div>
        </div>

        {/* ── HOW IT WORKS IN 3 STEPS ──────────────────────────────────────── */}
        <SectionTitle>How it works in 3 steps</SectionTitle>
        <div className="space-y-4 mb-14">
          <Step number="01" title="Import your GPS activity file (.gpx)">
            Export your activity in GPX format from your GPS app or device. This file contains your full route — coordinates, elevation, timestamps, heart rate, cadence, and power. LENS uses it to detect the best moments and to sync with your video.
            <br /><br />
            <span className="text-zinc-300 font-bold">Supported sources:</span>
            <DeviceRow logo="/devices/logos/garmin_logo.svg" lw={48} name="Garmin" detail="Garmin Connect → Activity → Export to GPX" />
            <DeviceRow logo="/devices/logos/strava_logo.svg"  lw={44} name="Strava"  detail="Activity page → ••• → Export GPX" />
            <DeviceRow logo="/devices/logos/suunto_logo.svg"  lw={48} name="Suunto"  detail="Export the *-track.gpx file (not the -route.gpx)" />
            <p className="text-zinc-600 text-[11px] mt-2 leading-relaxed">Also works with Wahoo, Polar, Coros, Komoot and any app that exports standard .gpx files.</p>
          </Step>
          <Step number="02" title="Import your video">
            LENS supports three camera types — each synced differently:
            <br /><br />
            <DeviceRow logo="/devices/logos/gopro_logo.svg"   lw={52} name="GoPro"   detail="GPS + accelerometer embedded in MP4 at 18 Hz — richest data, automatic precise sync" highlight />
            <DeviceRow logo="/devices/logos/iphone_logo.svg"  lw={58} name="iPhone"  detail="No GPS track in video — synced via CreateDate timestamp (UTC) matched to your activity" />
            <DeviceRow logo="/devices/logos/android_logo.svg" lw={72} name="Android" detail="Same as iPhone — Samsung Galaxy, Google Pixel, and any Android phone" />
          </Step>
          <Step number="03" title="Generate the cinematic edit">
            LENS synchronizes both sources, detects the most intense moments — climbs, sprints, descents — and generates a 9:16 cinematic edit ready for Instagram Reels, TikTok, and YouTube Shorts. No uploads, no accounts, no waiting.
          </Step>
        </div>

        {/* ── SUPPORTED VIDEO CAMERAS ───────────────────────────────────────── */}
        <SectionTitle>Supported video cameras</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          Each camera type uses a different sync strategy. GoPro is the gold standard — GPS is embedded in the video at high frequency. iPhone and Android rely on the creation timestamp instead.
        </p>

        {/* GoPro */}
        <DeviceCard
          logo="/devices/logos/gopro_logo.svg" lw={64}
          name="GoPro"
          badge="Maximum Data · 18 Hz GPS"
          badgeColor="amber"
        >
          <Row label="Formats" value=".mp4" />
          <Row label="GPS track" value="18 Hz embedded in video" good />
          <Row label="Accelerometer" value="200 Hz" good />
          <Row label="Gyroscope" value="Yes" good />
          <Row label="Barometer" value="Yes" good />
          <Row label="Sync method" value="GPS satellite clock — millisecond precision" good />
          <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
            <strong className="text-zinc-300">Compatible models:</strong> Hero 5 Black, Hero 7–13, Hero 12 Black, GoPro Max. Enable GPS in <strong className="text-white">Settings → Preferences → GPS → On</strong> and wait for the solid satellite icon before recording.
          </p>
        </DeviceCard>

        {/* iPhone */}
        <DeviceCard
          logo="/devices/logos/iphone_logo.svg" lw={72}
          name="iPhone"
          badge="Timestamp sync"
          badgeColor="blue"
        >
          <Row label="Formats" value=".mov" />
          <Row label="GPS track in video" value="Not embedded" neutral />
          <Row label="Sync method" value="CreateDate timestamp matched to GPX" neutral />
          <Row label="Requirement" value="iPhone 8 or newer" neutral />
          <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
            iPhones do not embed a continuous GPS track in the video. LENS reads the <strong className="text-white">recording start time</strong> from the video metadata and aligns it with your GPS activity. Your iPhone's clock must be set to automatic (Settings → General → Date & Time → Set Automatically).
          </p>
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            <strong className="text-zinc-300">Important:</strong> Start your GPS tracker (Garmin, Strava, etc.) <strong className="text-white">before</strong> pressing record on your iPhone. The activity GPX must cover the time window of the video.
          </p>
        </DeviceCard>

        {/* Android */}
        <DeviceCard
          logo="/devices/logos/android_logo.svg" lw={80}
          name="Android"
          badge="Timestamp sync"
          badgeColor="green"
        >
          <Row label="Formats" value=".mp4" />
          <Row label="GPS track in video" value="Not embedded" neutral />
          <Row label="Sync method" value="Recording timestamp from video metadata" neutral />
          <Row label="Compatible devices" value="Samsung Galaxy, Google Pixel, any Android" neutral />
          <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
            Android phones record the <strong className="text-white">end time</strong> of the video in the file metadata. LENS calculates the start time automatically (end time − duration). Keep your phone's clock synced to automatic time.
          </p>
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            <strong className="text-zinc-300">Filename pattern:</strong> Standard Android camera files use the format <code className="text-amber-400">YYYYMMDD_HHMMSS.mp4</code> (e.g., <code className="text-amber-400">20260512_113007.mp4</code>). LENS detects these automatically.
          </p>
        </DeviceCard>

        {/* ── GPS TRACKERS ──────────────────────────────────────────────────── */}
        <SectionTitle>GPS trackers & apps</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          Your GPS device records the activity. LENS needs it exported as a <strong className="text-white">.gpx file</strong>. Here's how to export from each supported platform.
        </p>

        <div className="space-y-4 mb-14">
          <GpsCard logo="/devices/logos/garmin_logo.svg" lw={56} name="Garmin Connect">
            <p className="text-zinc-400 text-sm leading-relaxed mb-2">
              Works with all Garmin devices: Edge cycling computers, Fenix, Forerunner, Venu, Epix, and more.
            </p>
            <ol className="space-y-1 text-sm text-zinc-400 list-none">
              <ExportStep>Open Garmin Connect → <strong className="text-white">Activities</strong></ExportStep>
              <ExportStep>Select the activity recorded during your video</ExportStep>
              <ExportStep><strong className="text-white">⚙ gear icon</strong> → <strong className="text-white">Export to GPX</strong></ExportStep>
            </ol>
            <p className="text-[11px] text-zinc-600 mt-2">The GPX will contain coordinates, elevation, HR, cadence, and power if your device had those sensors.</p>
          </GpsCard>

          <GpsCard logo="/devices/logos/strava_logo.svg" lw={52} name="Strava">
            <p className="text-zinc-400 text-sm leading-relaxed mb-2">
              Works with any activity synced to Strava, regardless of the recording device.
            </p>
            <ol className="space-y-1 text-sm text-zinc-400 list-none">
              <ExportStep>Open the activity on Strava (web or app)</ExportStep>
              <ExportStep>Click the <strong className="text-white">···</strong> menu (three dots)</ExportStep>
              <ExportStep><strong className="text-white">Export GPX</strong></ExportStep>
            </ol>
            <p className="text-[11px] text-zinc-600 mt-2">Strava exports include heart rate and elevation but may not include cadence or power.</p>
          </GpsCard>

          <GpsCard logo="/devices/logos/suunto_logo.svg" lw={56} name="Suunto">
            <p className="text-zinc-400 text-sm leading-relaxed mb-2">
              Suunto exports <strong className="text-white">two separate GPX files</strong> — you need the track file, not the route file.
            </p>
            <ol className="space-y-1 text-sm text-zinc-400 list-none">
              <ExportStep>Open Suunto app → select the activity</ExportStep>
              <ExportStep>Export / Share → GPX</ExportStep>
              <ExportStep>Use the file named <code className="text-amber-400">*-track.gpx</code></ExportStep>
            </ol>
            <div className="mt-3 p-3 rounded-xl bg-red-500/8 border border-red-500/20">
              <p className="text-[11px] text-red-400 font-black uppercase tracking-widest mb-1">Important</p>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Do <strong className="text-white">not</strong> use the <code className="text-red-400">*-route.gpx</code> file — it has no timestamps and cannot be synced with video.
              </p>
            </div>
          </GpsCard>

          <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800">
            <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">Also supported</p>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Any app that exports standard GPX with timestamps works: <strong className="text-white">Wahoo</strong> (Activity → Share → GPX), <strong className="text-white">Polar Flow</strong>, <strong className="text-white">Coros</strong>, <strong className="text-white">Komoot</strong> (Tour → Download GPX), and more.
            </p>
          </div>
        </div>

        {/* ── SYNC ENGINE ───────────────────────────────────────────────────── */}
        <SectionTitle>How the sync engine works</SectionTitle>
        <div className="space-y-4 mb-14">
          <InfoCard icon="🛰️">
            <p>
              <strong className="text-white">GoPro: GPS satellite clock.</strong> The GoPro and your Garmin/Wahoo both reference the same GPS satellite clock. LENS matches them directly — no correction needed, millisecond precision.
            </p>
          </InfoCard>
          <InfoCard icon="⏱️">
            <p>
              <strong className="text-white">iPhone / Android: timestamp alignment.</strong> LENS reads the recording start time from the video metadata (UTC) and finds the matching window in your GPX activity. Your device clock must be set to automatic time for this to work correctly.
            </p>
          </InfoCard>
          <InfoCard icon="🎯">
            <p>
              <strong className="text-white">Scene detection from combined data.</strong> LENS analyzes speed, elevation, gradient, heart rate, cadence, and power from the GPX — plus the GoPro accelerometer and gyroscope when available — to identify the most intense moments with high confidence.
            </p>
          </InfoCard>
          <InfoCard icon="🎬">
            <p>
              <strong className="text-white">Cinematic cuts, 9:16 format.</strong> Each detected scene maps to a specific video position. LENS cuts between scenes, overlays speed and map data, and composes the final video — entirely in your browser using WebAssembly.
            </p>
          </InfoCard>
        </div>

        {/* ── GoPro GPS SETUP ───────────────────────────────────────────────── */}
        <SectionTitle>Enabling GPS on GoPro</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          GoPro needs GPS enabled and a satellite lock before recording starts. Follow these steps for best results.
        </p>
        <div className="space-y-3 mb-6">
          <SetupStep number="1" title="Enable GPS in settings">
            <strong className="text-white">Settings (wrench) → Preferences → GPS → On</strong>. On Hero 10+, GPS is always on when location is enabled via Quik pairing.
          </SetupStep>
          <SetupStep number="2" title="Power on outdoors with clear sky">
            The GPS antenna is on the top edge of the camera. Keep it unobstructed and power on outside — indoors or in a bag it will never lock.
          </SetupStep>
          <SetupStep number="3" title="Wait for the solid GPS icon">
            A blinking icon means searching. A <strong className="text-white">solid icon means lock acquired</strong> (10–30 seconds outdoors). Start recording only after lock.
          </SetupStep>
        </div>
        <div className="mb-14 p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-500/80 mb-3">Model notes</p>
          <div className="space-y-2 text-sm text-zinc-400">
            <p><span className="text-white font-bold">Hero 5 / 6:</span> GPS off by default. Enable manually each session.</p>
            <p><span className="text-white font-bold">Hero 7 / 8 / 9:</span> Setting persists. Check once and leave on.</p>
            <p><span className="text-white font-bold">Hero 10 / 11 / 12 / 13:</span> Best GPS chip — faster lock, 18 Hz in all modes.</p>
            <p><span className="text-white font-bold">GoPro Max:</span> GPS included. Same setup as Hero 7+.</p>
          </div>
        </div>

        {/* ── COMMON ISSUES ─────────────────────────────────────────────────── */}
        <SectionTitle>Common issues</SectionTitle>
        <div className="space-y-4 mb-14">
          <ProblemCard problem="No GPS in this video">
            GoPro only: GPS was not enabled or never acquired a lock. Enable GPS in settings, power on outdoors, wait for the solid satellite icon.
          </ProblemCard>
          <ProblemCard problem="Video and GPX don't match">
            The video and the GPX are from different sessions — their timestamps don't overlap. Use the GPX from the same activity during which you recorded the video.
          </ProblemCard>
          <ProblemCard problem="No scenes detected">
            The activity window covered by the video is too short or too flat. Try a longer video with varied terrain, or make sure your GPX includes speed and elevation data.
          </ProblemCard>
          <ProblemCard problem="This is a Suunto route file">
            You uploaded the <code className="text-amber-400">*-route.gpx</code> file — it has no timestamps. Upload the <code className="text-amber-400">*-track.gpx</code> file instead from your Suunto app export.
          </ProblemCard>
        </div>

        {/* ── HELP ──────────────────────────────────────────────────────────── */}
        <div id="help" className="scroll-mt-24">
          <SectionTitle>Help &amp; troubleshooting</SectionTitle>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">Detailed explanations for every error message.</p>
          <div className="space-y-3 mb-14">
            <HelpItem error="Unsupported format. Use GoPro .mp4, iPhone .mov, or Android .mp4." title="Wrong video format">
              LENS accepts <code className="text-amber-400">.mp4</code> files from GoPro and Android cameras, and <code className="text-amber-400">.mov</code> files from iPhone. Other formats are not supported.
              <br /><br />
              <strong className="text-white">Fix:</strong> Use the original file from your camera or phone. Do not re-encode — telemetry data is lost in conversion.
            </HelpItem>
            <HelpItem error="Unsupported camera. Supported: GoPro, iPhone, and Android phones." title="Unsupported camera">
              LENS detected a video from a camera it does not yet support (DJI, Insta360, Sony, etc.).
              <br /><br />
              <strong className="text-white">Supported cameras:</strong> GoPro HERO 5+, any iPhone 8+, any Android phone (Samsung, Pixel, etc.).
            </HelpItem>
            <HelpItem error="No GPS data found in this video." title="No GPS in GoPro video">
              GPS was not enabled in the GoPro settings, or recording started before GPS lock. Enable GPS in <strong className="text-white">Settings → Preferences → GPS → On</strong>, power on outdoors, wait for the solid satellite icon, then record.
            </HelpItem>
            <HelpItem error="GPS signal too weak — no valid fix was recorded." title="GPS signal too weak (GoPro)">
              The GoPro recorded before acquiring a lock. After powering on, wait until the GPS icon is <strong className="text-white">solid (not blinking)</strong> — 10–30 seconds outdoors.
            </HelpItem>
            <HelpItem error="This video and GPX file don't match." title="Video and GPX from different sessions">
              LENS compared the timestamps (and GPS coordinates for GoPro) and found no overlap. Ensure the GPX is from the same activity during which the video was recorded.
              <br /><br />
              <strong className="text-white">For iPhone/Android:</strong> check that your device clock is set to automatic time (Settings → General → Date & Time → Set Automatically).
            </HelpItem>
            <HelpItem error="This is a Suunto route file, not a recording." title="Wrong Suunto file">
              You uploaded the <code className="text-amber-400">*-route.gpx</code> — a planned route with no timestamps. Export again and use the <code className="text-amber-400">*-track.gpx</code> file which contains your recorded activity with timestamps and HR.
            </HelpItem>
            <HelpItem error="No GPS track found in this file." title="Empty or invalid GPX">
              The GPX has no track points. Re-export from your app using GPX format (not FIT or TCX).
              <br />
              Strava: Activity → ••• → Export GPX &nbsp;·&nbsp;
              Garmin: Activity → Export → GPX &nbsp;·&nbsp;
              Wahoo: Activity → Share → GPX.
            </HelpItem>
            <HelpItem error="No highlight scenes detected." title="No scenes found">
              The activity window is too short or too uniform. Use a longer ride with climbs, descents, or sprints. Make sure your GPX includes speed or elevation data.
            </HelpItem>
            <HelpItem error="Export failed / Not enough memory." title="Export failed or out of memory">
              The browser ran out of WebAssembly memory. Close all other tabs, reload the page, and try again. Use Chrome on desktop for the highest memory limit.
            </HelpItem>
          </div>
        </div>

        {/* ── CTA ───────────────────────────────────────────────────────────── */}
        <div className="p-8 rounded-3xl bg-zinc-900/60 border border-zinc-800 text-center">
          <p className="text-white font-black text-xl mb-2">Ready to generate your edit?</p>
          <p className="text-zinc-400 text-sm mb-6">GoPro · iPhone · Android · Desktop Chrome · Free</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-amber-500 text-black font-black uppercase tracking-widest text-sm hover:scale-105 transition-transform shadow-[0_15px_40px_rgba(245,158,11,0.35)]"
          >
            ⚡ Get Started
          </Link>
        </div>

      </div>

      <footer className="relative z-10 border-t border-zinc-800/50 bg-black/30 backdrop-blur-sm mt-4">
        <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2 group">
            <span className="text-sm font-black tracking-tight text-white group-hover:text-amber-400 transition-colors">LENS</span>
            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">by ProRefuel.app</span>
          </a>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a href="https://instagram.com/LENS.video" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-pink-500/30 bg-pink-500/5 text-pink-400 hover:bg-pink-500/15 transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
              </svg>
              <span className="text-[11px] font-black uppercase tracking-widest">Contact · @LENS.video</span>
            </a>
            <a href="/privacidade" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">Privacy</a>
          </div>
          <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">© {new Date().getFullYear()} ProRefuel.app</p>
        </div>
      </footer>
    </main>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-black uppercase tracking-[0.3em] text-amber-500/80 mb-5 mt-2">
      {children}
    </h2>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/60">
      <div className="flex items-center gap-3 mb-3">
        <div className="shrink-0 w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
          <span className="text-xs font-black text-amber-400">{number}</span>
        </div>
        <p className="font-black text-white text-sm">{title}</p>
      </div>
      <div className="text-zinc-400 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function DeviceRow({ logo, lw, name, detail, highlight }: {
  logo: string; lw: number; name: string; detail: string; highlight?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 mt-2 p-3 rounded-xl ${highlight ? "bg-amber-500/8 border border-amber-500/20" : "bg-zinc-800/50 border border-zinc-700/50"}`}>
      <div className="min-w-[72px] h-10 flex items-center justify-center shrink-0 bg-white/50 rounded-lg px-2">
        <img src={logo} alt={name} style={{ height: 18, width: "auto", maxWidth: lw + 16 }} />
      </div>
      <div>
        <p className={`text-xs font-black ${highlight ? "text-amber-400" : "text-zinc-200"}`}>{name}</p>
        <p className="text-zinc-500 text-[11px] leading-snug">{detail}</p>
      </div>
    </div>
  );
}

function DeviceCard({ logo, lw, name, badge, badgeColor, children }: {
  logo: string; lw: number; name: string; badge: string; badgeColor: "amber" | "blue" | "green";
  children: ReactNode;
}) {
  const colors = {
    amber: "bg-amber-500/15 border-amber-500/40 text-amber-400",
    blue:  "bg-blue-500/15  border-blue-500/40  text-blue-400",
    green: "bg-green-500/15 border-green-500/40 text-green-400",
  };
  return (
    <div className="mb-5 p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="min-w-[64px] h-9 flex items-center justify-center bg-white/50 rounded-lg px-3">
            <img src={logo} alt={name} style={{ height: 16, width: "auto", maxWidth: lw }} />
          </div>
          <span className="font-black text-white text-sm">{name}</span>
        </div>
        <span className={`px-2 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${colors[badgeColor]}`}>{badge}</span>
      </div>
      <ul className="space-y-1 mb-2">{children}</ul>
    </div>
  );
}

function Row({ label, value, good, neutral }: {
  label: string; value: string; good?: boolean; neutral?: boolean;
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

function GpsCard({ logo, lw, name, children }: {
  logo: string; lw: number; name: string; children: ReactNode;
}) {
  return (
    <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800">
      <div className="flex items-center gap-3 mb-4">
        <div className="min-w-[56px] h-8 flex items-center justify-center bg-white/50 rounded-lg px-3">
          <img src={logo} alt={name} style={{ height: 14, width: "auto", maxWidth: lw }} />
        </div>
        <span className="font-black text-white text-sm">{name}</span>
      </div>
      {children}
    </div>
  );
}

function ExportStep({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-zinc-400 text-sm">
      <span className="text-amber-500 font-black shrink-0 text-xs mt-0.5">→</span>
      <span>{children}</span>
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

function InfoCard({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/60">
      <span className="text-xl shrink-0">{icon}</span>
      <div className="text-zinc-400 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function ProblemCard({ problem, children }: { problem: string; children: ReactNode }) {
  return (
    <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/60">
      <p className="font-black text-red-400 text-xs uppercase tracking-wide mb-2">⚠ {problem}</p>
      <p className="text-zinc-400 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function HelpItem({ error, title, children }: { error: string; title: string; children: ReactNode }) {
  return (
    <details className="group bg-zinc-900/50 border border-zinc-800/60 rounded-2xl overflow-hidden">
      <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer select-none list-none">
        <div>
          <p className="font-black text-white text-sm">{title}</p>
          <p className="text-zinc-600 text-[11px] font-mono mt-0.5 truncate max-w-xs">{error}</p>
        </div>
        <span className="text-zinc-600 group-open:rotate-180 transition-transform text-xs shrink-0">▼</span>
      </summary>
      <div className="px-5 pb-5 text-zinc-400 text-sm leading-relaxed border-t border-zinc-800/60 pt-4">
        {children}
      </div>
    </details>
  );
}
