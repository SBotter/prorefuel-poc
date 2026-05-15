import PhoneMockup from "./PhoneMockup";

function IgIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function MobilePage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans overflow-x-hidden">

      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[80%] h-[60%] bg-amber-500/6 blur-[80px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[50%] bg-amber-600/4 blur-[80px] rounded-full" />
      </div>

      {/* NAVBAR */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-4 backdrop-blur-md bg-black/40 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black tracking-tight text-white">LENS</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">by ProRefuel</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Beta v1.0.31</span>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative z-10 pt-24 px-5">

        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/80 border border-amber-500/25 mb-7 w-fit backdrop-blur-sm">
          <svg viewBox="0 0 24 24" className="w-3 h-3 fill-amber-500" stroke="none">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-200">Beta v1.0.31 · 100% Free</span>
        </div>

        <h1 className="text-5xl font-black tracking-tight leading-[0.88] mb-5">
          STOP SHARING<br />RAW FOOTAGE.<br />
          <span className="text-amber-500">
            START SHARING<br />STORIES.
          </span>
        </h1>

        <p className="text-zinc-300 text-lg font-semibold mb-2 leading-relaxed">
          GoPro, iPhone, or Android.<br />LENS edits what matters.
        </p>
        <p className="text-zinc-500 text-sm mb-5 leading-relaxed">
          GPS-synced cinematic edit — in under 60 seconds.
        </p>

        {/* Compatible devices strip */}
        <div className="flex flex-wrap items-center gap-2 mb-8">
          {[
            { src: "/devices/logos/gopro_logo.svg",   w: 44 },
            { src: "/devices/logos/iphone_logo.svg",  w: 52 },
            { src: "/devices/logos/android_logo.svg", w: 64 },
            { src: "/devices/logos/garmin_logo.svg",  w: 44 },
            { src: "/devices/logos/strava_logo.svg",  w: 40 },
            { src: "/devices/logos/suunto_logo.svg",  w: 44 },
          ].map((d, i) => (
            <div key={i} className="flex items-center justify-center h-7 px-2.5 rounded-lg bg-white/50 border border-white/40">
              <img src={d.src} alt="" style={{ height: 14, width: "auto", maxWidth: d.w, opacity: 1 }} />
            </div>
          ))}
        </div>

        {/* Render time hero stat */}
        <div className="relative mb-4 rounded-2xl overflow-hidden border border-amber-500/40 bg-amber-500/10 px-5 py-5 flex items-center gap-4">
          <div className="relative flex flex-col items-center justify-center shrink-0 w-24">
            <span className="text-5xl font-black text-amber-400 leading-none">&lt;60s</span>
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/70 mt-1">render time</span>
          </div>
          <div className="relative flex flex-col gap-0.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">Lightning Fast</span>
            <p className="text-white text-sm font-bold leading-snug">Your cinematic edit,<br />ready in under a minute.</p>
            <p className="text-zinc-500 text-[11px] mt-1">From raw footage to shareable story — no waiting, no cloud.</p>
          </div>
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-3 gap-2 mb-10">
          {[
            { value: "18Hz", label: "GPS" },
            { value: "9:16", label: "Format" },
            { value: "0 Upload", label: "Private" },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center bg-zinc-900/50 rounded-xl py-3 px-1 border border-zinc-800/60">
              <span className="text-base font-black text-amber-400 leading-none">{s.value}</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Phone mockup */}
        <div className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500/70 mb-6 text-center">
            Your edit, ready to post
          </p>
          <div style={{ margin: "0 19px" }}>
            <PhoneMockup />
          </div>
        </div>

        {/* Instagram */}
        <div className="flex items-center justify-center gap-2 mb-10">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-purple-600/15 border border-purple-500/30">
            <IgIcon size={15} />
            <span className="text-[13px] font-black text-white tracking-wide">@LENS.video</span>
          </div>
        </div>
      </section>

      {/* DESKTOP CTA */}
      <section className="relative z-10 px-5 py-10 border-t border-zinc-800/40">
        <div className="bg-amber-500/10 border border-amber-500/25 rounded-[2rem] p-7 text-center">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-2xl mx-auto mb-4">🖥️</div>
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-2">Create Your Video</p>
          <h2 className="text-2xl font-black tracking-tight mb-3">
            Open on Desktop<br /><span className="text-amber-500">to Generate</span>
          </h2>
          <p className="text-zinc-400 text-sm leading-relaxed mb-5 max-w-xs mx-auto">
            No upload. No cloud. Runs entirely in Chrome on your desktop computer.
          </p>
          <div className="px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-center">
            <span className="text-zinc-300 font-mono text-sm font-bold">lens.prorefuel.app</span>
          </div>
        </div>
      </section>

      {/* COMPATIBLE DEVICES */}
      <section className="relative z-10 px-5 py-10 border-t border-zinc-800/40">
        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500/70 mb-4 text-center">Compatible Devices</p>
        <h2 className="text-2xl font-black tracking-tight text-center mb-7">Works with your gear.</h2>

        <div className="space-y-3 mb-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">Video Camera</p>
          {[
            { logo: "/devices/logos/gopro_logo.svg",   name: "GoPro",   detail: "HERO 8–13, Max — GPMF telemetry at 18Hz", lw: 52 },
            { logo: "/devices/logos/iphone_logo.svg",  name: "iPhone",  detail: "iPhone 8 and newer — timestamp sync", lw: 58 },
            { logo: "/devices/logos/android_logo.svg", name: "Android", detail: "Samsung, Pixel and any Android phone", lw: 72 },
          ].map(d => (
            <div key={d.name} className="flex items-center gap-3 p-3 rounded-2xl bg-white/35 border border-white/30">
              <div className="min-w-[64px] h-9 flex items-center justify-center shrink-0 bg-white/50 rounded-lg px-2">
                <img src={d.logo} alt={d.name} style={{ height: 16, width: "auto", maxWidth: d.lw }} />
              </div>
              <div>
                <p className="text-zinc-900 text-sm font-black">{d.name}</p>
                <p className="text-zinc-700 text-[11px]">{d.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1 mt-5">GPS Tracker — export as .gpx</p>
          {[
            { logo: "/devices/logos/garmin_logo.svg", name: "Garmin", detail: "Edge, Fenix, Forerunner — via Garmin Connect", lw: 52 },
            { logo: "/devices/logos/strava_logo.svg", name: "Strava", detail: "Export activity GPX from Strava", lw: 48 },
            { logo: "/devices/logos/suunto_logo.svg", name: "Suunto", detail: "Export -track.gpx from Suunto app", lw: 52 },
          ].map(d => (
            <div key={d.name} className="flex items-center gap-3 p-3 rounded-2xl bg-white/35 border border-white/30">
              <div className="min-w-[64px] h-9 flex items-center justify-center shrink-0 bg-white/50 rounded-lg px-2">
                <img src={d.logo} alt={d.name} style={{ height: 14, width: "auto", maxWidth: d.lw }} />
              </div>
              <div>
                <p className="text-zinc-900 text-sm font-black">{d.name}</p>
                <p className="text-zinc-700 text-[11px]">{d.detail}</p>
              </div>
            </div>
          ))}
          <p className="text-zinc-600 text-[11px] px-1 leading-relaxed">Also: Wahoo, Polar, Coros, Komoot and any app exporting .gpx.</p>
        </div>
      </section>

      {/* FEATURES */}
      <section className="relative z-10 px-5 py-10 border-t border-zinc-800/40">
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

      {/* INSTAGRAM CTA */}
      <section className="relative z-10 px-5 py-10 border-t border-zinc-800/40 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600/30 to-pink-600/30 border border-purple-500/30 mb-5">
          <IgIcon size={24} />
        </div>
        <h2 className="text-3xl font-black tracking-tight mb-3">
          Tag us. Get featured.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">@LENS.video</span>
        </h2>
        <p className="text-zinc-400 text-sm leading-relaxed mb-5 max-w-sm mx-auto">
          Share your LENS edit on Instagram and tag <strong className="text-white">@LENS.video</strong>.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <span className="px-4 py-2.5 rounded-xl bg-purple-600/15 border border-purple-500/25 text-[12px] font-black text-white">📸 Share your ride</span>
          <span className="px-4 py-2.5 rounded-xl bg-zinc-900/60 border border-zinc-700/50 text-[12px] font-black text-zinc-300">🏆 Get featured</span>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative z-10 border-t border-zinc-800/50 bg-black/30 px-5 py-8 text-center">
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="text-lg font-black text-white">LENS</span>
          <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">by ProRefuel.app</span>
        </div>
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold mb-4">Elevate your adventure.</p>
        <div className="flex items-center justify-center gap-4 mb-4">
          <a href="https://instagram.com/LENS.video" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-zinc-500">
            <IgIcon size={13} />
            <span className="text-[11px] font-black uppercase tracking-widest">@LENS.video</span>
          </a>
          <a href="/how-it-works" className="text-[11px] font-black uppercase tracking-widest text-zinc-500">How It Works</a>
          <a href="/privacidade" className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Privacy</a>
        </div>
        <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">© {new Date().getFullYear()} ProRefuel.app</p>
      </footer>

    </main>
  );
}
