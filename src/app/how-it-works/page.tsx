import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "How It Works — LENS by ProRefuel",
  description:
    "LENS syncs your GoPro, iPhone, or Android video with your GPS activity and generates a cinematic edit automatically — on desktop or mobile.",
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
          <Link href="/privacy" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">Privacy</Link>
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
            LENS combines your GPS activity with your video — from any supported camera — to automatically generate a synced cinematic edit, entirely in your browser. Available on desktop and mobile.
          </p>
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

        {/* ── DESKTOP VS MOBILE ─────────────────────────────────────────────── */}
        <SectionTitle>Desktop vs Mobile</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-5">
          LENS runs on both desktop and mobile — each with a pipeline optimised for the platform. The output quality is equivalent; the main difference is audio and hardware requirements.
        </p>
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          {/* Desktop */}
          <div className="p-5 rounded-2xl bg-zinc-900/60 border border-amber-500/30">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">🖥️</span>
              <div>
                <p className="font-black text-white text-sm">Desktop</p>
                <p className="text-[10px] text-amber-400 font-black uppercase tracking-widest">Chrome · Edge · Firefox</p>
              </div>
            </div>
            <ul className="space-y-2">
              <FeatureRow icon="✅" label="Full pipeline — all camera types" />
              <FeatureRow icon="✅" label="Audio: original video + cinematic music" />
              <FeatureRow icon="✅" label="Up to 60s highlight reel" />
              <FeatureRow icon="✅" label="MP4 download to computer" />
              <FeatureRow icon="✅" label="No minimum hardware" />
            </ul>
            <p className="text-[11px] text-zinc-600 mt-3 leading-relaxed">Best for: GoPro videos, long activities, maximum quality.</p>
          </div>
          {/* Mobile */}
          <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-700/60">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📱</span>
              <div>
                <p className="font-black text-white text-sm">Mobile</p>
                <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">iOS Safari · Android Chrome</p>
              </div>
            </div>
            <ul className="space-y-2">
              <FeatureRow icon="✅" label="iPhone + Android videos" />
              <FeatureRow icon="✅" label="GoPro videos" />
              <FeatureRow icon="⏳" label="Audio: coming soon (currently silent)" muted />
              <FeatureRow icon="✅" label="Up to 30s highlight reel" />
              <FeatureRow icon="✅" label="Saves to Photos / Gallery" />
            </ul>
            <p className="text-[11px] text-zinc-600 mt-3 leading-relaxed">Best for: quick edits on the go from your phone.</p>
          </div>
        </div>
        <div className="p-4 rounded-2xl bg-blue-500/8 border border-blue-500/25 mb-14">
          <p className="text-blue-300 text-[12px] font-bold leading-relaxed">
            <span className="font-black text-blue-200">📢 Audio note:</span> Mobile video exports are currently silent. Original video audio and cinematic music will be added in a future update for iOS 18+ and Android Chrome 94+.
          </p>
        </div>

        {/* ── DEVICE REQUIREMENTS ───────────────────────────────────────────── */}
        <SectionTitle>Device requirements</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          LENS uses WebCodecs — a modern browser API for hardware-accelerated video encoding. Older devices do not have this capability. Below are the minimum requirements for a reliable experience.
        </p>

        {/* iOS */}
        <div className="mb-5 p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <div className="flex items-center gap-3 mb-4">
            <img src="/devices/logos/iphone_logo.svg" alt="iPhone" style={{ height: 20, width: "auto", maxWidth: 58 }} />
            <div>
              <p className="font-black text-white text-sm">iOS (Safari)</p>
              <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">All browsers on iOS use WebKit — browser choice doesn't matter</p>
            </div>
          </div>
          <div className="space-y-2 mb-4">
            <RequirementRow
              level="premium"
              label="Recommended (premium)"
              value="iOS 17.0+ · iPhone 11 or newer (A13 chip, 2019)"
            />
            <RequirementRow
              level="warning"
              label="Minimum (may work)"
              value="iOS 16.4+ · iPhone XR / XS (A12, 2018)"
            />
            <RequirementRow
              level="blocked"
              label="Not supported"
              value="iOS 16.3 or older · iPhone 8/X or older"
            />
          </div>
          <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
            <p className="text-amber-400 text-[11px] font-bold leading-relaxed">
              <span className="font-black">Why iPhone 11 / iOS 17?</span> The A13 chip (iPhone 11, 2019) introduced dedicated hardware encoder and decoder pipelines that don't interfere with each other. Older chips may show encoding errors when decoding and encoding video simultaneously. iOS 17 also improves Video Toolbox memory management.
            </p>
          </div>
          <div className="mt-3 p-3 rounded-xl bg-zinc-800/50 border border-zinc-700">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">Max video file size</p>
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-zinc-400">iOS 17+ / iPhone 11+ (premium)</span>
                <span className="text-green-400 font-black">2 GB</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-zinc-400">iOS 16.4–16.x / iPhone XR/XS</span>
                <span className="text-amber-400 font-black">500 MB</span>
              </div>
            </div>
          </div>
          <div className="mt-3 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700">
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              <span className="font-black text-zinc-200">Below minimum or file too large?</span> Open <strong className="text-amber-400">lens.prorefuel.app</strong> on your desktop computer (Chrome) — no device or size restrictions.
            </p>
          </div>
          <div className="mt-3 p-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
            <p className="text-blue-300 text-[11px] font-bold leading-relaxed">
              <span className="font-black text-blue-200">iOS 18+ (future):</span> Full audio support — your video's original sound included in the export.
            </p>
          </div>
        </div>

        {/* Android */}
        <div className="mb-14 p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
          <div className="flex items-center gap-3 mb-4">
            <img src="/devices/logos/android_logo.svg" alt="Android" style={{ height: 20, width: "auto", maxWidth: 72 }} />
            <div>
              <p className="font-black text-white text-sm">Android (Chrome)</p>
              <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Chrome auto-updates — browser version is usually not a concern</p>
            </div>
          </div>
          <div className="space-y-2 mb-4">
            <RequirementRow
              level="premium"
              label="Recommended (premium)"
              value="Android 11+ · Chrome 114+ · 4 GB+ RAM"
            />
            <RequirementRow
              level="warning"
              label="Minimum (may work)"
              value="Android 10 · Chrome 94+ · 3 GB RAM"
            />
            <RequirementRow
              level="blocked"
              label="Not supported"
              value="Android 9 or older · Chrome 93 or older"
            />
          </div>
          <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
            <p className="text-amber-400 text-[11px] font-bold leading-relaxed">
              <span className="font-black">Why 4 GB RAM / Android 11?</span> The video decoder buffers 3–5 frames at a time (not the full file), so file size ≠ RAM usage. The 4 GB requirement ensures headroom for concurrent H264 encoding + video decoding without OOM crashes. Android 11 improves media codec resource management.
            </p>
          </div>
          <div className="mt-3 p-3 rounded-xl bg-zinc-800/50 border border-zinc-700">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">Max video file size</p>
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-zinc-400">Android 11+ / 4 GB RAM (premium)</span>
                <span className="text-green-400 font-black">1.5 GB</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-zinc-400">Android 10 / 3 GB RAM</span>
                <span className="text-amber-400 font-black">1 GB</span>
              </div>
            </div>
          </div>
          <div className="mt-3 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700">
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              <span className="font-black text-zinc-200">Below minimum or file too large?</span> Open <strong className="text-amber-400">lens.prorefuel.app</strong> on your desktop computer (Chrome) — no device or size restrictions.
            </p>
          </div>
          <div className="mt-3 p-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
            <p className="text-blue-300 text-[11px] font-bold leading-relaxed">
              <span className="font-black text-blue-200">Android audio (coming soon):</span> Android Chrome 94+ already supports AudioEncoder. Audio export is being rolled out.
            </p>
          </div>
        </div>

        {/* ── VIDEO FILE SIZE REFERENCE ─────────────────────────────────────── */}
        <SectionTitle>Video file size reference</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-4">
          File size ≠ memory usage. LENS streams video on-demand, decoding only 3–5 frames at a time regardless of file size. The limits exist to protect older devices with less capable blob URL handling.
        </p>
        <div className="mb-5 overflow-hidden rounded-2xl border border-zinc-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-black uppercase tracking-widest text-[10px]">Platform</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-black uppercase tracking-widest text-[10px]">Max size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              <tr className="bg-zinc-900/40">
                <td className="px-4 py-3 text-zinc-300">🖥️ Desktop (Chrome / Edge / Firefox)</td>
                <td className="px-4 py-3 text-right font-black text-green-400">No limit</td>
              </tr>
              <tr className="bg-zinc-900/40">
                <td className="px-4 py-3 text-zinc-300">📱 iOS 17+ / iPhone 11+</td>
                <td className="px-4 py-3 text-right font-black text-green-400">2 GB</td>
              </tr>
              <tr className="bg-zinc-900/40">
                <td className="px-4 py-3 text-zinc-300">📱 Android 11+ / 4 GB RAM</td>
                <td className="px-4 py-3 text-right font-black text-green-400">1.5 GB</td>
              </tr>
              <tr className="bg-zinc-900/40">
                <td className="px-4 py-3 text-zinc-500">📱 iOS 16.4–16.x / iPhone XR/XS</td>
                <td className="px-4 py-3 text-right font-black text-amber-400">500 MB</td>
              </tr>
              <tr className="bg-zinc-900/40">
                <td className="px-4 py-3 text-zinc-500">📱 Android 10 / 3 GB RAM</td>
                <td className="px-4 py-3 text-right font-black text-amber-400">1 GB</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mb-4 p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Typical file sizes</p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              { cam: "iPhone 13 · 1080p60", size: "~120 MB/min", limit: "~16 min" },
              { cam: "iPhone 15 · 4K30 HEVC", size: "~600 MB/min", limit: "~3 min 20s" },
              { cam: "GoPro Hero 12 · 4K30", size: "~400 MB/min", limit: "~5 min" },
              { cam: "Samsung S24 · 4K30", size: "~300 MB/min", limit: "~6 min 40s" },
            ].map(r => (
              <div key={r.cam} className="p-2 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
                <p className="text-zinc-300 font-bold leading-snug mb-0.5">{r.cam}</p>
                <p className="text-zinc-500">{r.size} · 2 GB limit = {r.limit}</p>
              </div>
            ))}
          </div>
          <p className="text-zinc-600 text-[10px] mt-3">For clips larger than the limit, trim your video in your camera app before importing.</p>
        </div>
        <div className="mb-14 p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800">
          <p className="text-zinc-400 text-[11px] leading-relaxed">
            <span className="font-black text-zinc-200">💡 Tip:</span> You don't need to import your entire ride. Select a 2–10 minute segment that covers your best moments. LENS will detect and highlight the most intense scenes from that window.
          </p>
        </div>

        {/* ── HOW IT WORKS IN 3 STEPS ──────────────────────────────────────── */}
        <SectionTitle>How it works in 3 steps</SectionTitle>
        <div className="space-y-4 mb-14">
          <Step number="01" title="Import your GPS activity">
            You have two ways to provide your GPS activity data:
            <br /><br />
            <span className="text-zinc-300 font-bold">Option A — Connect directly to Strava:</span>
            <div className="mt-2 p-3 rounded-xl bg-[#FC4C02]/8 border border-[#FC4C02]/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-md bg-[#FC4C02] flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
                </div>
                <span className="text-[#FC4C02] text-xs font-black uppercase tracking-widest">Strava Direct Import</span>
              </div>
              <p className="text-zinc-400 text-[12px] leading-relaxed">Click <strong className="text-white">Import from Strava</strong>, authorise once, and LENS shows your 10 most recent activities. Pick one and LENS extracts the full GPS route, elevation, HR, cadence and power automatically — no file download needed.</p>
              <p className="text-zinc-600 text-[11px] mt-1.5">On mobile, the authorization opens the Strava app directly if installed.</p>
            </div>
            <br />
            <span className="text-zinc-300 font-bold">Option B — Upload a GPX file manually:</span>
            <p className="text-zinc-500 text-[12px] mt-1 mb-2 leading-relaxed">Export your activity as a <code className="text-amber-400">.gpx</code> file from any GPS app or device and drop it into LENS.</p>
            <DeviceRow logo="/devices/logos/garmin_logo.svg" lw={48} name="Garmin" detail="Garmin Connect → Activity → Export to GPX" />
            <DeviceRow logo="/devices/logos/strava_logo.svg"  lw={44} name="Strava"  detail="Activity page → ••• → Export GPX (or use direct import above)" />
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
            <br /><br />
            <span className="text-zinc-300 font-bold">Output format:</span>
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/60 text-xs">
                <span className="text-zinc-400">Desktop</span>
                <span className="text-zinc-200 font-bold">MP4 · H264 · with audio (video + cinematic music)</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/60 text-xs">
                <span className="text-zinc-400">Mobile</span>
                <span className="text-zinc-200 font-bold">MP4 · H264 · silent (audio coming soon)</span>
              </div>
            </div>
          </Step>
        </div>

        {/* ── SUPPORTED VIDEO CAMERAS ───────────────────────────────────────── */}
        <SectionTitle>Supported video cameras</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          Each camera type uses a different sync strategy. GoPro is the gold standard — GPS is embedded in the video at high frequency. iPhone and Android rely on the creation timestamp instead.
        </p>

        <DeviceCard logo="/devices/logos/gopro_logo.svg" lw={64} name="GoPro" badge="Maximum Data · 18 Hz GPS" badgeColor="amber">
          <Row label="Formats" value=".mp4" />
          <Row label="GPS track" value="18 Hz embedded in video" good />
          <Row label="Accelerometer" value="200 Hz" good />
          <Row label="Gyroscope" value="Yes" good />
          <Row label="Barometer" value="Yes" good />
          <Row label="Sync method" value="GPS satellite clock — millisecond precision" good />
          <Row label="Audio in output (desktop)" value="Original video audio + cinematic music" good />
          <Row label="Audio in output (mobile)" value="Coming soon — currently silent" neutral />
          <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
            <strong className="text-zinc-300">Compatible models:</strong> Hero 5 Black, Hero 7–13, Hero 12 Black, GoPro Max. Enable GPS in <strong className="text-white">Settings → Preferences → GPS → On</strong> and wait for the solid satellite icon before recording.
          </p>
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            <strong className="text-zinc-300">Important:</strong> Your GoPro clip must be at least 60 seconds long to allow GPS lock. A 14-second clip will have no valid GPS data and cannot be synced.
          </p>
        </DeviceCard>

        <DeviceCard logo="/devices/logos/iphone_logo.svg" lw={72} name="iPhone" badge="Timestamp sync" badgeColor="blue">
          <Row label="Formats" value=".mov" />
          <Row label="GPS track in video" value="Not embedded" neutral />
          <Row label="Sync method" value="CreateDate timestamp matched to GPX" neutral />
          <Row label="Minimum device" value="iPhone 11+ (recommended) · iPhone XR/XS (minimum)" neutral />
          <Row label="Minimum iOS" value="iOS 17.0+ (recommended) · iOS 16.4 (minimum)" neutral />
          <Row label="Audio in output (desktop)" value="Original video audio + cinematic music" good />
          <Row label="Audio in output (mobile)" value="iOS 18+: planned · iOS 16-17: silent" neutral />
          <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
            iPhones do not embed a continuous GPS track in the video. LENS reads the <strong className="text-white">recording start time</strong> from the video metadata and aligns it with your GPS activity. Your iPhone's clock must be set to automatic (Settings → General → Date & Time → Set Automatically).
          </p>
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            <strong className="text-zinc-300">Important:</strong> Start your GPS tracker (Garmin, Strava, etc.) <strong className="text-white">before</strong> pressing record on your iPhone. The activity GPX must cover the time window of the video.
          </p>
        </DeviceCard>

        <DeviceCard logo="/devices/logos/android_logo.svg" lw={80} name="Android" badge="Timestamp sync" badgeColor="green">
          <Row label="Formats" value=".mp4" />
          <Row label="GPS track in video" value="Not embedded" neutral />
          <Row label="Sync method" value="Recording timestamp from video metadata" neutral />
          <Row label="Minimum Android" value="Android 11+ (recommended) · Android 10 (minimum)" neutral />
          <Row label="Minimum RAM" value="4 GB+ (recommended) · 3 GB (minimum)" neutral />
          <Row label="Browser" value="Chrome 114+ (Chrome auto-updates)" neutral />
          <Row label="Audio in output (desktop)" value="Original video audio + cinematic music" good />
          <Row label="Audio in output (mobile)" value="Chrome 94+: coming soon · currently silent" neutral />
          <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
            Android phones record the <strong className="text-white">end time</strong> of the video in the file metadata. LENS calculates the start time automatically (end time − duration). Keep your phone's clock synced to automatic time.
          </p>
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            <strong className="text-zinc-300">Saves to Gallery:</strong> On Android, the video downloads to your Downloads folder. Your Gallery app automatically detects new videos there within seconds.
          </p>
        </DeviceCard>

        {/* ── GPS TRACKERS ──────────────────────────────────────────────────── */}
        <SectionTitle>GPS trackers &amp; apps</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          Your GPS device records the activity. LENS needs it exported as a <strong className="text-white">.gpx file</strong>.
        </p>

        <div className="space-y-4 mb-14">
          <GpsCard logo="/devices/logos/garmin_logo.svg" lw={56} name="Garmin Connect">
            <p className="text-zinc-400 text-sm leading-relaxed mb-2">Works with all Garmin devices: Edge, Fenix, Forerunner, Venu, Epix, and more.</p>
            <ol className="space-y-1 text-sm text-zinc-400 list-none">
              <ExportStep>Open Garmin Connect → <strong className="text-white">Activities</strong></ExportStep>
              <ExportStep>Select the activity recorded during your video</ExportStep>
              <ExportStep><strong className="text-white">⚙ gear icon</strong> → <strong className="text-white">Export to GPX</strong></ExportStep>
            </ol>
          </GpsCard>

          <GpsCard logo="/devices/logos/strava_logo.svg" lw={52} name="Strava">
            <p className="text-zinc-400 text-sm leading-relaxed mb-3">Works with any activity synced to Strava, regardless of the recording device.</p>

            {/* Direct import */}
            <div className="p-3 rounded-xl bg-[#FC4C02]/8 border border-[#FC4C02]/25 mb-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#FC4C02] mb-1.5">Recommended — Direct import</p>
              <ol className="space-y-1 text-sm text-zinc-400 list-none">
                <ExportStep>Click <strong className="text-white">Import from Strava</strong> in LENS</ExportStep>
                <ExportStep>Authorise once — no login needed if the app is installed</ExportStep>
                <ExportStep>Pick any of your last 10 activities — done</ExportStep>
              </ol>
            </div>

            {/* Manual export */}
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">Or export manually</p>
            <ol className="space-y-1 text-sm text-zinc-400 list-none">
              <ExportStep>Open the activity on Strava (web or app)</ExportStep>
              <ExportStep>Click the <strong className="text-white">···</strong> menu (three dots)</ExportStep>
              <ExportStep><strong className="text-white">Export GPX</strong></ExportStep>
            </ol>
          </GpsCard>

          <GpsCard logo="/devices/logos/suunto_logo.svg" lw={56} name="Suunto">
            <p className="text-zinc-400 text-sm leading-relaxed mb-2">Suunto exports <strong className="text-white">two separate GPX files</strong> — you need the track file, not the route file.</p>
            <ol className="space-y-1 text-sm text-zinc-400 list-none">
              <ExportStep>Open Suunto app → select the activity</ExportStep>
              <ExportStep>Export / Share → GPX</ExportStep>
              <ExportStep>Use the file named <code className="text-amber-400">*-track.gpx</code></ExportStep>
            </ol>
            <div className="mt-3 p-3 rounded-xl bg-red-500/8 border border-red-500/20">
              <p className="text-[11px] text-red-400 font-black uppercase tracking-widest mb-1">Important</p>
              <p className="text-[11px] text-zinc-400 leading-relaxed">Do <strong className="text-white">not</strong> use the <code className="text-red-400">*-route.gpx</code> file — it has no timestamps.</p>
            </div>
          </GpsCard>

          <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800">
            <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">Also supported</p>
            <p className="text-zinc-400 text-sm leading-relaxed">
              <strong className="text-white">Wahoo</strong> (Activity → Share → GPX), <strong className="text-white">Polar Flow</strong>, <strong className="text-white">Coros</strong>, <strong className="text-white">Komoot</strong> (Tour → Download GPX), and any app that exports standard .gpx files.
            </p>
          </div>
        </div>

        {/* ── SYNC ENGINE ───────────────────────────────────────────────────── */}
        <SectionTitle>How the sync engine works</SectionTitle>
        <div className="space-y-4 mb-14">
          <InfoCard icon="🛰️">
            <p><strong className="text-white">GoPro: GPS satellite clock.</strong> The GoPro and your Garmin/Wahoo both reference the same GPS satellite clock. LENS matches them directly — no correction needed, millisecond precision.</p>
          </InfoCard>
          <InfoCard icon="⏱️">
            <p><strong className="text-white">iPhone / Android: timestamp alignment.</strong> LENS reads the recording start time from the video metadata (UTC) and finds the matching window in your GPX activity. Your device clock must be set to automatic time.</p>
          </InfoCard>
          <InfoCard icon="🎯">
            <p><strong className="text-white">Scene detection.</strong> LENS analyzes speed, elevation, gradient, heart rate, cadence, and power from the GPX — plus GoPro accelerometer/gyroscope when available — to identify the most intense moments.</p>
          </InfoCard>
          <InfoCard icon="🎬">
            <p><strong className="text-white">Cinematic output, 9:16 format.</strong> Each detected scene maps to a specific video position. LENS cuts between scenes, overlays telemetry data, and composes the final video — entirely in your browser.</p>
          </InfoCard>
        </div>

        {/* ── GoPro GPS SETUP ───────────────────────────────────────────────── */}
        <SectionTitle>Enabling GPS on GoPro</SectionTitle>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">GoPro needs GPS enabled and a satellite lock before recording starts.</p>
        <div className="space-y-3 mb-6">
          <SetupStep number="1" title="Enable GPS in settings">
            <strong className="text-white">Settings (wrench) → Preferences → GPS → On</strong>. On Hero 10+, GPS is always on when location is enabled via Quik pairing.
          </SetupStep>
          <SetupStep number="2" title="Power on outdoors with clear sky">
            Keep the GPS antenna (top edge of camera) unobstructed. Power on outside — indoors or in a bag it will never lock.
          </SetupStep>
          <SetupStep number="3" title="Wait for the solid GPS icon">
            A blinking icon means searching. A <strong className="text-white">solid icon means lock acquired</strong> (10–30 seconds outdoors). Start recording only after lock, and record for at least 60 seconds.
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
            GoPro only: GPS was not enabled or never acquired a lock. Enable GPS, power on outdoors, wait for the solid icon, and record for at least 60 seconds.
          </ProblemCard>
          <ProblemCard problem="Video and GPX don't match">
            The video and GPX are from different days or sessions. Use the GPX from the same activity during which you recorded the video. Also check that your device clock is set to automatic time.
          </ProblemCard>
          <ProblemCard problem="No scenes detected">
            The activity window covered by the video is too short or too flat. Try a longer video with varied terrain.
          </ProblemCard>
          <ProblemCard problem="This is a Suunto route file">
            You uploaded the <code className="text-amber-400">*-route.gpx</code> — no timestamps. Upload the <code className="text-amber-400">*-track.gpx</code> file instead.
          </ProblemCard>
          <ProblemCard problem="Update required (mobile)">
            Your device doesn't meet the minimum requirements for the mobile pipeline. Open LENS on a desktop computer (Chrome recommended) for the full experience without restrictions.
          </ProblemCard>
        </div>

        {/* ── HELP ──────────────────────────────────────────────────────────── */}
        <div id="help" className="scroll-mt-24">
          <SectionTitle>Help &amp; troubleshooting</SectionTitle>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">Detailed explanations for every error message.</p>
          <div className="space-y-3 mb-14">
            <HelpItem error="Unsupported format. Use GoPro .mp4, iPhone .mov, or Android .mp4." title="Wrong video format">
              LENS accepts <code className="text-amber-400">.mp4</code> from GoPro and Android, and <code className="text-amber-400">.mov</code> from iPhone. Do not re-encode — telemetry data is lost in conversion.
            </HelpItem>
            <HelpItem error="No GPS data found in this video." title="No GPS in GoPro video">
              GPS was not enabled or recording started before lock. Enable GPS, power on outdoors, wait for the solid icon, then record for at least 60 seconds.
            </HelpItem>
            <HelpItem error="GPS signal too weak — no valid fix was recorded." title="GPS signal too weak (GoPro)">
              Recording started before GPS lock. Wait until the GPS icon is <strong className="text-white">solid (not blinking)</strong> — 10–30 seconds outdoors.
            </HelpItem>
            <HelpItem error="This video and GPX file don't match." title="Video and GPX from different sessions">
              Timestamps don't overlap. Ensure the GPX is from the same activity during which the video was recorded. For iPhone/Android, verify your device clock is set to automatic.
            </HelpItem>
            <HelpItem error="Video (date) and GPX (date) appear to be from different days." title="Date mismatch">
              The video metadata shows a different date than the GPX. Common cause: the video was edited or trimmed after recording, which resets the metadata date. Use the original, unedited file. Also check your camera's date/time settings.
            </HelpItem>
            <HelpItem error="This is a Suunto route file, not a recording." title="Wrong Suunto file">
              Use the <code className="text-amber-400">*-track.gpx</code> file (recorded activity with timestamps), not <code className="text-amber-400">*-route.gpx</code> (planned route without timestamps).
            </HelpItem>
            <HelpItem error="No GPS track found in this file." title="Empty or invalid GPX">
              The GPX has no track points. Re-export from your app using GPX format.
            </HelpItem>
            <HelpItem error="No highlight scenes detected." title="No scenes found">
              The activity is too short or too uniform. Use a longer recording with climbs, descents, or sprints.
            </HelpItem>
            <HelpItem error="Export failed / Not enough memory." title="Export failed or out of memory">
              The browser ran out of memory. On desktop: close other tabs, reload, try again. On mobile: use desktop Chrome for best reliability, or ensure your Android has 4 GB+ RAM.
            </HelpItem>
            <HelpItem error="Encoding failed. Please try again. (mobile)" title="Mobile encoding error">
              The hardware video encoder encountered an error. This usually happens on older devices below the recommended minimum. Try again, or switch to desktop Chrome for reliable export.
            </HelpItem>
          </div>
        </div>

        {/* ── CTA ───────────────────────────────────────────────────────────── */}
        <div className="p-8 rounded-3xl bg-zinc-900/60 border border-zinc-800 text-center">
          <p className="text-white font-black text-xl mb-2">Ready to generate your edit?</p>
          <p className="text-zinc-400 text-sm mb-6">GoPro · iPhone · Android · Desktop Chrome · Free</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-amber-500 text-black font-black uppercase tracking-widest text-sm hover:scale-105 transition-transform shadow-[0_15px_40px_rgba(245,158,11,0.35)]"
            >
              🖥️ Open on Desktop
            </Link>
            <Link
              href="/mobile"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-zinc-800 border border-zinc-700 text-white font-black uppercase tracking-widest text-sm hover:bg-zinc-700 transition-colors"
            >
              📱 Open on Mobile
            </Link>
          </div>
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
            <a href="/privacy" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">Privacy</a>
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

function FeatureRow({ icon, label, muted }: { icon: string; label: string; muted?: boolean }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="text-sm shrink-0">{icon}</span>
      <span className={muted ? "text-zinc-600" : "text-zinc-300"}>{label}</span>
    </li>
  );
}

function RequirementRow({ level, label, value }: { level: "premium" | "warning" | "blocked"; label: string; value: string }) {
  const styles = {
    premium: { dot: "bg-green-500", label: "text-green-400", value: "text-zinc-200", border: "border-zinc-700/50 bg-zinc-800/30" },
    warning: { dot: "bg-amber-500", label: "text-amber-400", value: "text-zinc-300", border: "border-zinc-700/50 bg-zinc-800/30" },
    blocked: { dot: "bg-red-500",   label: "text-red-400",   value: "text-zinc-500", border: "border-zinc-700/50 bg-zinc-800/30" },
  }[level];
  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${styles.border}`}>
      <div className={`w-2 h-2 rounded-full mt-0.5 shrink-0 ${styles.dot}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${styles.label}`}>{label}</p>
        <p className={`text-[11px] leading-snug ${styles.value}`}>{value}</p>
      </div>
    </div>
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
