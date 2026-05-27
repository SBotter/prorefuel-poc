"use client";

import { useEffect, useRef, useState } from "react";
import { X, Share, Plus } from "lucide-react";

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

export function InstallPrompt({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);
  const [ios,     setIos]     = useState(false);
  const deferredEvt           = useRef<any>(null);

  // Capture Chrome's install event as early as possible
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); deferredEvt.current = e; };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Show 1.5 s after video is done — skip if already installed or dismissed
  useEffect(() => {
    if (!show) return;
    if (isStandalone()) return;
    if (wasDismissed()) return;

    const ios = isIOS();

    // On non-iOS, only show if the browser supports installation
    if (!ios && !deferredEvt.current) return;

    setIos(ios);
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
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center px-4 pb-8 animate-slide-up pointer-events-none">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700/50 shadow-2xl shadow-black/70 p-4 pointer-events-auto">

        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/LENS_name_circle_blk.png"
            alt="LENS"
            width={48}
            height={48}
            className="rounded-xl shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-white leading-tight">
              Add LENS to your home screen
            </p>
            <p className="text-xs text-zinc-400 mt-0.5 leading-snug">
              {ios
                ? "Access your next cinematic edit in one tap — no App Store needed."
                : "Install LENS for instant access, just like a native app."}
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-1 -mr-1 -mt-1"
          >
            <X size={15} />
          </button>
        </div>

        {/* iOS: step-by-step instructions */}
        {ios ? (
          <div className="mt-3 rounded-xl bg-zinc-800/50 border border-zinc-700/40 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2.5 text-xs text-zinc-300">
              <div className="w-5 h-5 rounded-md bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                <Share size={11} className="text-blue-400" />
              </div>
              <span>Tap the <span className="font-bold text-white">Share</span> button in your browser</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-zinc-300">
              <div className="w-5 h-5 rounded-md bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                <Plus size={11} className="text-blue-400" />
              </div>
              <span>Select <span className="font-bold text-white">"Add to Home Screen"</span></span>
            </div>
          </div>
        ) : (
          /* Chrome/Android/Desktop: native install button */
          <button
            onClick={install}
            className="mt-3 w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black text-sm font-black tracking-wide transition-colors"
          >
            Install App
          </button>
        )}
      </div>
    </div>
  );
}
