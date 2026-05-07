// Server Component — zero client-side JS for static content.
// This page is served to mobile browsers redirected from /
// No engine, no dynamic imports, no heavy dependencies.

import MobileSlider from "./MobileSlider";

function IgIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function MobileLandingPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans selection:bg-amber-500/40 overflow-x-hidden">

      {/* AMBIENT GLOW */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[80%] h-[60%] bg-amber-500/6 blur-[160px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[50%] bg-amber-600/4 blur-[140px] rounded-full" />
      </div>

      {/* ── NAVBAR ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-4 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <a href="/mobile" className="flex items-center gap-2">
          <span className="text-xl font-black tracking-tight text-white">LENS</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel</span>
        </a>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Free Beta</span>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative z-10 pt-24 pb-0 px-5">

        {/* Badge */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/80 border border-amber-500/25 mb-7 w-fit shadow-xl backdrop-blur">
          <svg viewBox="0 0 24 24" className="w-3 h-3 text-amber-500 fill-amber-500 animate-pulse" stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-200">Beta v1.0 &nbsp;·&nbsp; 100% Free</span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl font-black tracking-tight leading-[0.88] mb-5">
          STOP SHARING<br />
          RAW FOOTAGE.<br />
          <span className="text-amber-500 drop-shadow-[0_0_30px_rgba(245,158,11,0.4)]">
            START SHARING<br />STORIES.
          </span>
        </h1>

        <p className="text-zinc-300 text-lg font-semibold mb-3 leading-relaxed">
          Your GoPro captures everything.<br />LENS edits what matters.
        </p>
        <p className="text-zinc-500 text-sm mb-8 leading-relaxed max-w-sm">
          Import your GPX activity and GoPro video. LENS detects the best moments and generates a cinematic 9:16 edit — synced, scored, and ready to post.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-10">
          {[
            { value: "18Hz", label: "GPS" },
            { value: "< 60s", label: "Time" },
            { value: "9:16", label: "Format" },
            { value: "0 Upload", label: "Private" },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center bg-zinc-900/50 rounded-xl py-3 px-1 border border-zinc-800/60">
              <span className="text-lg font-black text-amber-400 leading-none">{s.value}</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Slider */}
        <div className="w-full max-w-[320px] mx-auto mb-10">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500/70 mb-3 text-center">
            RAW footage vs LENS edit
          </p>
          <MobileSlider />
        </div>

        {/* Instagram */}
        <div className="flex items-center justify-center gap-2 mb-10">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30">
            <IgIcon size={15} />
            <span className="text-[13px] font-black text-white tracking-wide">@LENS.video</span>
          </div>
          <span className="text-zinc-600 text-xs">· Share · Get featured</span>
        </div>
      </section>

      {/* ── DESKTOP CTA ── */}
      <section className="relative z-10 px-5 py-10 border-t border-zinc-800/40">
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/25 rounded-[2rem] p-7 text-center">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-2xl mx-auto mb-4">🖥️</div>
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-2">Create Your Video</p>
          <h2 className="text-2xl font-black tracking-tight mb-3">
            Open on Desktop<br />
            <span className="text-amber-500">to Generate</span>
          </h2>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6 max-w-xs mx-auto">
            LENS processes your GoPro video directly in the browser — no upload, no cloud. Requires Chrome on a desktop computer.
          </p>
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-700 w-full justify-center">
              <span className="text-zinc-300 font-mono text-sm font-bold">lens.prorefuel.app</span>
            </div>
            <p className="text-zinc-600 text-xs">Open this URL on Chrome Desktop</p>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="relative z-10 px-5 py-10 border-t border-zinc-800/40">
        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-3 text-center">Why LENS</p>
        <h2 className="text-3xl font-black tracking-tight text-center mb-8">
          Built for <span className="text-amber-500">athletes</span>,<br />not editors.
        </h2>
        <div className="space-y-3">
          {[
            { icon: "🛰️", title: "GPS Scene Detection", body: "Finds climbs, sprints, and technical sections from your GPS data." },
            { icon: "🎬", title: "Cinematic Auto-Edit", body: "Selects the best clips and assembles them with smooth transitions." },
            { icon: "📊", title: "Telemetry Overlay", body: "Speed, heart rate, elevation — rendered in real time on every frame." },
            { icon: "🔒", title: "100% Private", body: "Everything runs in your browser. Your files never leave your device." },
          ].map(f => (
            <div key={f.title} className="flex gap-4 p-4 rounded-2xl bg-zinc-900/50 border border-zinc-800/60">
              <span className="text-2xl shrink-0">{f.icon}</span>
              <div>
                <p className="font-black text-white text-sm mb-0.5">{f.title}</p>
                <p className="text-zinc-500 text-xs leading-relaxed">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── INSTAGRAM CTA ── */}
      <section className="relative z-10 px-5 py-10 border-t border-zinc-800/40 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600/30 to-pink-600/30 border border-purple-500/30 mb-5">
          <IgIcon size={24} />
        </div>
        <h2 className="text-3xl font-black tracking-tight mb-3">
          Tag us. Get featured.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">@LENS.video</span>
        </h2>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6 max-w-sm mx-auto">
          Share your LENS edit on Instagram and tag <strong className="text-white">@LENS.video</strong>. Your video could be featured on our page.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <span className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600/15 to-pink-600/15 border border-purple-500/25 text-[12px] font-black text-white">📸 Share your ride</span>
          <span className="px-4 py-2.5 rounded-xl bg-zinc-900/60 border border-zinc-700/50 text-[12px] font-black text-zinc-300">💬 Drop feedback</span>
          <span className="px-4 py-2.5 rounded-xl bg-zinc-900/60 border border-zinc-700/50 text-[12px] font-black text-zinc-300">🏆 Get featured</span>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative z-10 border-t border-zinc-800/50 bg-black/30 px-5 py-8 text-center">
        <a href="/mobile" className="inline-flex items-center gap-2 mb-3">
          <span className="text-lg font-black tracking-tight text-white">LENS</span>
          <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">by ProRefuel.app</span>
        </a>
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold mb-4">Elevate your adventure.</p>
        <div className="flex items-center justify-center gap-4 mb-4">
          <a href="https://instagram.com/LENS.video" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-zinc-500">
            <IgIcon size={13} />
            <span className="text-[11px] font-black uppercase tracking-widest">@LENS.video</span>
          </a>
          <a href="/como-funciona" className="text-[11px] font-black uppercase tracking-widest text-zinc-500">How It Works</a>
          <a href="/privacidade" className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Privacy</a>
        </div>
        <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">© {new Date().getFullYear()} ProRefuel.app</p>
      </footer>

    </main>
  );
}
