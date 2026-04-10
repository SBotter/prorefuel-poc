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
          <Link href="/como-funciona" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-amber-400 transition-colors">
            How It Works
          </Link>
          <Link href="/privacidade" className="px-3 sm:px-4 py-2 text-[11px] font-black uppercase tracking-widest text-amber-400">
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
            body="All video and activity file processing happens directly on your device — inside your browser. No file is ever uploaded, transmitted, or sent to any server, anywhere."
          />
          <PrivacyCard
            icon="🚫"
            title="Zero Data Transmission"
            body="Your GoPro videos, GPX files, GPS coordinates, and location data never leave your machine. LENS has no way to access them remotely — and never will."
          />
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

        {/* Bottom CTA */}
        <div className="mt-16 p-8 rounded-3xl bg-zinc-900/60 border border-zinc-800 text-center">
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">
            Curious about how LENS works technically?
          </p>
          <Link
            href="/como-funciona"
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
