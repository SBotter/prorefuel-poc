import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — LENS by ProRefuel",
  description:
    "LENS processes everything locally on your device. No data is ever sent to any server or cloud.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans">
      {/* Ambient */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-amber-500/6 blur-[140px] rounded-full" />
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="text-xl font-black tracking-tight text-white group-hover:text-amber-400 transition-colors">LENS</span>
          <span className="hidden sm:block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel.app</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link href="/how-it-works" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">
            How It Works
          </Link>
          <Link href="/privacy" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-amber-400">
            Privacy
          </Link>
        </div>
      </nav>

      {/* Content */}
      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-32 pb-24">

        {/* Header */}
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/25 mb-8">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[11px] font-black uppercase tracking-widest text-green-400">100% Local · Zero Cloud</span>
          </div>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tight leading-[0.9] mb-6">
            YOUR PRIVACY<br />
            <span className="text-amber-500">IS ABSOLUTE.</span>
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed">
            LENS was built on one non-negotiable principle: your data belongs to you.
            Full stop.
          </p>
        </div>

        {/* Cards */}
        <div className="space-y-5">
          <PrivacyCard
            icon="🔒"
            title="100% Local Processing"
            body="All video processing happens directly on your device — inside your browser. Your GoPro, iPhone, or Android video and your manually uploaded GPX file never leave your machine. No file is uploaded, transmitted, or sent to any server, anywhere."
          />
          <PrivacyCard
            icon="🚫"
            title="Zero Data Transmission — Your Files"
            body="Your video files, GPS coordinates, location data, heart rate, and telemetry are processed entirely in your browser. LENS has no way to access them remotely — and never will. The only exception is the optional Strava integration below."
          />

          {/* Strava integration card */}
          <div className="flex gap-5 p-6 rounded-2xl bg-zinc-900/50 border border-[#FC4C02]/25 hover:border-[#FC4C02]/40 transition-colors">
            <div className="shrink-0 mt-0.5 w-9 h-9 rounded-xl bg-[#FC4C02] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
            </div>
            <div>
              <h3 className="font-black text-white text-sm uppercase tracking-wide mb-2">Strava Integration — Optional</h3>
              <p className="text-zinc-400 text-sm leading-relaxed mb-3">
                If you choose to connect Strava, here is exactly what happens — and what does not:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-black shrink-0 mt-0.5">✓</span>
                  <span className="text-zinc-300">You authorise LENS with <strong className="text-white">read-only</strong> scope (<code className="text-[#FC4C02]">activity:read</code>) — LENS cannot modify, post, or delete anything on your Strava account.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-black shrink-0 mt-0.5">✓</span>
                  <span className="text-zinc-300">Your Strava access token is <strong className="text-white">encrypted</strong> (AES-256) and stored in an <strong className="text-white">httpOnly cookie</strong> on your browser — it is never stored in a database or transmitted to a third party.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-black shrink-0 mt-0.5">✓</span>
                  <span className="text-zinc-300">When you pick an activity, LENS fetches the GPS data from Strava and processes it <strong className="text-white">in your browser</strong> — identically to a manual GPX upload. The GPS data is not stored on any server.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 font-black shrink-0 mt-0.5">✓</span>
                  <span className="text-zinc-300">The cookie expires automatically after <strong className="text-white">6 hours</strong>. Closing the browser tab or session also clears the connection.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 font-black shrink-0 mt-0.5">✗</span>
                  <span className="text-zinc-500">LENS does not store your Strava ID, athlete profile, activity list, or any Strava data beyond the single GPS stream used for the video you are generating.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 font-black shrink-0 mt-0.5">✗</span>
                  <span className="text-zinc-500">LENS does not share your Strava data with any third party.</span>
                </li>
              </ul>
              <p className="text-zinc-600 text-[11px] mt-3 leading-relaxed">
                Strava integration is entirely optional. You can always use LENS by uploading a GPX file manually — no connection to Strava required.
              </p>
            </div>
          </div>
          <PrivacyCard
            icon="🧠"
            title="No Personal Information Collected"
            body="We collect no name, email, location, device identifiers, or any other personal information. No sign-up, no login, no account required."
          />
          <PrivacyCard
            icon="📡"
            title="No Analytics, No Tracking"
            body="LENS uses no tracking cookies, advertising pixels, third-party analytics, or behavioral telemetry of any kind. What you do in the app stays in the app."
          />
          <PrivacyCard
            icon="📂"
            title="Your Files Are Yours"
            body="Videos you generate with LENS are saved directly to your device. You decide what to do with them. LENS does not store, access, or monitor any content you produce."
          />
        </div>

        {/* Contact */}
        <div className="mt-10 p-8 rounded-3xl bg-pink-500/5 border border-pink-500/20 text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-pink-400 mb-2">Contact</p>
          <p className="text-white font-black text-base mb-1">Questions about your data?</p>
          <p className="text-zinc-400 text-sm leading-relaxed mb-5">
            Send us a direct message on Instagram. We respond to all data requests, deletion requests, and privacy questions.
          </p>
          <a
            href="https://instagram.com/LENS.video"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-pink-500/15 border border-pink-500/30 text-pink-400 font-black uppercase tracking-widest text-[11px] hover:bg-pink-500/25 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
            </svg>
            DM us · @LENS.video
          </a>
        </div>

        {/* Bottom CTA */}
        <div className="mt-6 p-8 rounded-3xl bg-zinc-900/60 border border-zinc-800 text-center">
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">
            Curious about how LENS works technically?
          </p>
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-amber-500 text-black font-black uppercase tracking-widest text-[11px] hover:scale-105 transition-transform shadow-[0_10px_30px_rgba(245,158,11,0.3)]"
          >
            How It Works
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
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a href="https://instagram.com/LENS.video" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-pink-500/30 bg-pink-500/5 text-pink-400 hover:bg-pink-500/15 transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
              </svg>
              <span className="text-[11px] font-black uppercase tracking-widest">Contact · @LENS.video</span>
            </a>
            <a href="/how-it-works" className="text-[11px] font-black uppercase tracking-widest text-zinc-500 hover:text-amber-400 transition-colors">How It Works</a>
          </div>
          <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">© {new Date().getFullYear()} ProRefuel.app</p>
        </div>
      </footer>
    </main>
  );
}

function PrivacyCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="flex gap-5 p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/60 hover:border-zinc-700 transition-colors">
      <div className="text-2xl shrink-0 mt-0.5">{icon}</div>
      <div>
        <h3 className="font-black text-white text-sm uppercase tracking-wide mb-2">{title}</h3>
        <p className="text-zinc-400 text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
