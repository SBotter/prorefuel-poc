"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronDown } from "lucide-react";

const DISMISSED_KEY = "lens_install_dismissed";
const DISMISS_TTL   = 30 * 24 * 60 * 60 * 1000; // 30 days

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function wasDismissed(): boolean {
  try {
    const ts = localStorage.getItem(DISMISSED_KEY);
    return !!ts && Date.now() - Number(ts) < DISMISS_TTL;
  } catch {
    return false;
  }
}

// Safari's share icon — matches the actual iOS toolbar button
function SafareShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
      <path d="M12 2 L12 15 M8 6 L12 2 L16 6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 11 L5 20 L19 20 L19 11" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// iOS "Add to Home Screen" icon — the square with plus
function AddHomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="white" strokeWidth="2" />
      <path d="M12 8 L12 16 M8 12 L16 12" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function InstallPrompt({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);
  const [ios,     setIos]     = useState(false);
  const deferredEvt           = useRef<any>(null);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); deferredEvt.current = e; };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (!show) return;
    if (isStandalone()) return;
    if (wasDismissed()) return;
    const onIos = isIOS();
    if (!onIos && !deferredEvt.current) return;
    setIos(onIos);
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [show]);

  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch {}
  }

  async function install() {
    if (!deferredEvt.current) return;
    deferredEvt.current.prompt();
    const { outcome } = await deferredEvt.current.userChoice;
    deferredEvt.current = null;
    if (outcome === "accepted") setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center px-4 pb-6 animate-slide-up pointer-events-none">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700/50 shadow-2xl shadow-black/80 overflow-hidden pointer-events-auto">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/LENS_name_circle.png" alt="LENS" width={40} height={40} className="rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-white leading-tight">Add LENS to your home screen</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {ios ? "Free · No App Store · One tap access" : "Install for instant access, like a native app."}
            </p>
          </div>
          <button onClick={dismiss} aria-label="Dismiss"
            className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors p-1 -mr-1">
            <X size={15} />
          </button>
        </div>

        {ios ? (
          <>
            {/* Divider */}
            <div className="h-px bg-zinc-800 mx-4" />

            {/* Steps */}
            <div className="px-4 pt-3 pb-2 space-y-2">

              {/* Step 1 */}
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center shrink-0 text-[11px] font-black text-white">1</div>
                <p className="text-[12px] text-zinc-300">Tap the <span className="font-black text-white">Share</span> button in Safari</p>
                {/* Visual of the actual Safari share button */}
                <div className="ml-auto w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-600 flex items-center justify-center shrink-0">
                  <SafareShareIcon />
                </div>
              </div>

              {/* Connector line */}
              <div className="ml-3.5 w-px h-3 bg-zinc-700" />

              {/* Step 2 */}
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center shrink-0 text-[11px] font-black text-white">2</div>
                <p className="text-[12px] text-zinc-300">Select <span className="font-black text-white">"Add to Home Screen"</span></p>
                {/* Visual of the Add to Home Screen icon */}
                <div className="ml-auto w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-600 flex items-center justify-center shrink-0">
                  <AddHomeIcon />
                </div>
              </div>
            </div>

            {/* Arrow pointing to Safari toolbar below */}
            <div className="flex flex-col items-center py-2 gap-0.5">
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Share button is below</p>
              <ChevronDown size={18} className="text-blue-400 animate-bounce" />
            </div>
          </>
        ) : (
          /* Chrome/Android/Desktop */
          <div className="px-4 pb-4">
            <button onClick={install}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black text-sm font-black tracking-wide transition-colors">
              Install App
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
