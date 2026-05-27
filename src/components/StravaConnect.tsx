"use client";

import { useState, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StravaActivity {
  id:           number;
  name:         string;
  sport_type:   string;
  type:         string;
  start_date:   string;
  distance:     number;
  moving_time:  number;
  has_heartrate: boolean;
}

type State = "idle" | "connected" | "loading_activities" | "picker" | "loading_gpx" | "error";

// ── Props ─────────────────────────────────────────────────────────────────────

interface StravaConnectProps {
  onGpxLoaded: (gpxText: string) => Promise<void>;
  /** "desktop" or "mobile" — determines where to redirect back after OAuth */
  origin?: "desktop" | "mobile";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sportIcon(type: string): string {
  const t = (type ?? "").toLowerCase();
  if (t.includes("ride") || t.includes("cycling") || t.includes("velom")) return "🚴";
  if (t.includes("trailrun") || t.includes("trail_run"))                  return "🏔️";
  if (t.includes("run") || t.includes("jogg"))                            return "🏃";
  if (t.includes("hike") || t.includes("walk"))                           return "🥾";
  if (t.includes("swim"))                                                  return "🏊";
  if (t.includes("ski") || t.includes("snowboard"))                       return "⛷";
  if (t.includes("kayak") || t.includes("canoe") || t.includes("row"))   return "🚣";
  if (t.includes("alpine") || t.includes("climb"))                        return "🧗";
  return "🏆";
}

function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StravaConnect({ onGpxLoaded, origin = "desktop" }: StravaConnectProps) {
  const [state,        setState]        = useState<State>("idle");
  const [activities,   setActivities]   = useState<StravaActivity[]>([]);
  const [error,        setError]        = useState<string | null>(null);
  const [loadingId,    setLoadingId]    = useState<number | null>(null);
  const [page,         setPage]         = useState(1);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [hasMore,      setHasMore]      = useState(true);

  // On mount: handle OAuth callback params OR check for existing valid session
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);

    if (p.get("strava") === "connected") {
      window.history.replaceState({}, "", window.location.pathname);
      fetchActivities();
      return;
    }
    if (p.get("strava") === "denied") {
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (p.get("strava") === "error") {
      window.history.replaceState({}, "", window.location.pathname);
      setError("Something went wrong connecting to Strava. Please try again.");
      setState("error");
      return;
    }

    // No OAuth callback — check if there is already a valid session cookie.
    // If connected, show the "connected" button so the user can open the list on demand.
    // Never auto-open the list on page load — only on explicit click.
    fetch("/api/strava/status")
      .then(r => r.json())
      .then(d => { if (d.connected) setState("connected"); })
      .catch(() => { /* network error — stay on idle */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchActivities = async () => {
    setState("loading_activities");
    setError(null);
    setPage(1);
    setHasMore(true);
    try {
      const res = await fetch("/api/strava/activities?page=1");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to fetch activities");
      }
      const data: StravaActivity[] = await res.json();
      setActivities(data);
      setHasMore(data.length === 10);
      setState("picker");
    } catch (e: any) {
      setError(e.message ?? "Failed to connect to Strava");
      setState("error");
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const res = await fetch(`/api/strava/activities?page=${nextPage}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to load more");
      }
      const data: StravaActivity[] = await res.json();
      setActivities(prev => [...prev, ...data]);
      setPage(nextPage);
      setHasMore(data.length === 10);
    } catch (e: any) {
      setError(e.message ?? "Failed to load more activities");
    } finally {
      setLoadingMore(false);
    }
  };

  const selectActivity = async (activity: StravaActivity) => {
    setLoadingId(activity.id);
    setState("loading_gpx");
    setError(null);
    try {
      const res = await fetch(`/api/strava/gpx/${activity.id}`);
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to load activity data");
      await onGpxLoaded(d.gpx);
      // Reset to idle — component stays visible so user can switch activity anytime
      setState("idle");
    } catch (e: any) {
      setError(e.message ?? "Failed to load activity");
      setState("picker"); // go back to picker so user can choose another
    } finally {
      setLoadingId(null);
    }
  };

  const connect = () => {
    window.location.href = `/api/auth/strava?origin=${origin}`;
  };

  const reset = () => {
    setState("connected");
    setActivities([]);
    setError(null);
  };

  // ── Render: idle — not authenticated ────────────────────────────────────
  if (state === "idle") {
    return (
      <div className="space-y-3">
        <Divider />
        <button
          onClick={connect}
          className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-zinc-800 bg-zinc-900/40 hover:border-[#FC4C02]/40 hover:bg-[#FC4C02]/5 transition-all group"
        >
          <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0 group-hover:bg-[#FC4C02]/20 transition-colors">
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-zinc-500 group-hover:fill-[#FC4C02] transition-colors">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-0.5">Strava</p>
            <p className="text-sm font-black uppercase text-zinc-400 group-hover:text-white leading-none transition-colors">Connect to Strava</p>
          </div>
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-zinc-700 group-hover:text-[#FC4C02] transition-colors shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    );
  }

  // ── Render: connected — authenticated, list not open yet ─────────────────
  if (state === "connected") {
    return (
      <div className="space-y-3">
        <Divider />
        <button
          onClick={fetchActivities}
          className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-[#FC4C02]/40 bg-[#FC4C02]/5 hover:border-[#FC4C02]/70 hover:bg-[#FC4C02]/10 transition-all group"
        >
          <div className="w-10 h-10 rounded-xl bg-[#FC4C02] flex items-center justify-center shrink-0 shadow-lg group-hover:scale-105 transition-transform">
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#FC4C02]/80 mb-0.5">Strava · Connected</p>
            <p className="text-sm font-black uppercase text-white leading-none">Open My Activities</p>
          </div>
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#FC4C02]/50 group-hover:text-[#FC4C02] transition-colors shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    );
  }

  // ── Render: loading activities ────────────────────────────────────────────
  if (state === "loading_activities") {
    return (
      <div className="space-y-3">
        <Divider />
        <div className="flex items-center gap-3 p-4 rounded-2xl border-2 border-[#FC4C02]/30 bg-[#FC4C02]/5">
          <div className="w-10 h-10 rounded-xl bg-[#FC4C02] flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white animate-pulse">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
          </div>
          <p className="text-sm font-black uppercase text-[#FC4C02] animate-pulse">Connecting to Strava…</p>
        </div>
      </div>
    );
  }

  // ── Render: loading GPX for a specific activity ───────────────────────────
  if (state === "loading_gpx") {
    return (
      <div className="space-y-3">
        <Divider />
        <div className="flex items-center gap-3 p-4 rounded-2xl border-2 border-[#FC4C02]/30 bg-[#FC4C02]/5">
          <div className="w-10 h-10 rounded-xl bg-[#FC4C02] flex items-center justify-center shrink-0 animate-spin">
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
          </div>
          <p className="text-sm font-black uppercase text-[#FC4C02]">Loading GPS data…</p>
        </div>
      </div>
    );
  }

  // ── Render: activity picker ───────────────────────────────────────────────
  if (state === "picker") {
    return (
      <div className="space-y-3">
        <Divider />
        <div className="rounded-2xl border-2 border-[#FC4C02]/30 bg-zinc-900/60 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-[#FC4C02] flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white">
                  <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                </svg>
              </div>
              <span className="text-[11px] font-black uppercase tracking-widest text-zinc-300">Your recent activities</span>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20">
              <p className="text-[11px] text-red-400 font-semibold">{error}</p>
            </div>
          )}

          {/* Activity list */}
          <div className="divide-y divide-zinc-800/40 max-h-[260px] overflow-y-auto">
            {activities.length === 0 ? (
              <p className="px-4 py-6 text-zinc-500 text-sm text-center">No recent activities found.</p>
            ) : (
              activities.map(a => {
                const isLoading = loadingId === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => selectActivity(a)}
                    disabled={loadingId !== null}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/4 active:bg-white/8 transition-colors text-left disabled:opacity-60"
                  >
                    <span className="text-xl shrink-0">{sportIcon(a.sport_type || a.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-black text-white truncate leading-tight">{a.name}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        {formatDate(a.start_date)} · {formatDist(a.distance)} · {formatTime(a.moving_time)}
                        {a.has_heartrate && " · ♥"}
                      </p>
                    </div>
                    {isLoading
                      ? <div className="w-4 h-4 border-2 border-[#FC4C02] border-t-transparent rounded-full animate-spin shrink-0" />
                      : <svg viewBox="0 0 24 24" className="w-4 h-4 text-zinc-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    }
                  </button>
                );
              })
            )}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="px-4 py-2.5 border-t border-zinc-800/60">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full text-[11px] font-black uppercase tracking-wider text-zinc-400 hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loadingMore
                  ? <><div className="w-3 h-3 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" /> Loading…</>
                  : "Load 10 more ↓"
                }
              </button>
            </div>
          )}

          {/* Footer: use manual upload */}
          <div className={`px-4 py-2.5 ${hasMore ? "" : "border-t border-zinc-800/60"}`}>
            <button
              onClick={reset}
              className="text-[11px] font-black uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ← Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: error (not inside picker) ────────────────────────────────────
  if (state === "error") {
    return (
      <div className="space-y-3">
        <Divider />
        <div className="p-4 rounded-2xl border border-red-500/30 bg-red-500/8">
          <p className="text-[11px] text-red-400 font-semibold mb-2">{error}</p>
          <div className="flex gap-3">
            <button onClick={fetchActivities} className="text-[10px] font-black uppercase tracking-wider text-[#FC4C02] hover:text-white transition-colors">
              Try again
            </button>
            <span className="text-zinc-700">·</span>
            <button onClick={reset} className="text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors">
              Use file upload
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function Divider() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 border-t border-zinc-800/60" />
      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600 shrink-0">or</span>
      <div className="flex-1 border-t border-zinc-800/60" />
    </div>
  );
}
