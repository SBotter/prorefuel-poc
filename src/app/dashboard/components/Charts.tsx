"use client";

import React, { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { DashboardData } from "@/lib/supabase/dashboard";

// ── Design tokens ─────────────────────────────────────────────────────────────
const AMBER   = "#f59e0b";
const ZINC700 = "#3f3f46";
const ERROR_RED = "#ef4444";

const PIE_COLORS   = [AMBER, "#78716c", "#44403c", "#a8a29e", "#d6d3d1", "#57534e", "#22d3ee", "#a855f7"];
const DEVICE_COLORS: Record<string, string> = {
  GoPro: "#3b82f6", Gopro: "#3b82f6",
  Iphone: AMBER, iPhone: AMBER,
  Android: "#22c55e",
  Unknown: "#52525b",
};
const ERROR_COLORS: Record<string, string> = {
  NO_GPS_VIDEO: "#ef4444", GPS_WEAK: "#f97316", VIDEO_GPX_MISMATCH: "#eab308",
  NO_SCENES: "#a855f7", WRONG_VIDEO_FORMAT: "#3b82f6", WRONG_GPX_FORMAT: "#06b6d4",
  NO_GPS_TRACK: "#14b8a6", UNSUPPORTED_CAMERA: "#8b5cf6",
  RENDER_OOM: "#ec4899", RENDER_FAILED: "#f43f5e", WORKER_ERROR: "#78716c",
};
const SOURCE_COLORS: Record<string, string> = {
  video_upload: "#3b82f6", gpx_upload: "#14b8a6", render: "#ec4899", worker: "#78716c", unknown: "#52525b",
};

const tooltipStyle = {
  backgroundColor: "#18181b", border: "1px solid #3f3f46",
  borderRadius: 12, color: "#fff", fontSize: 12, fontWeight: 600,
};

// ── Primitive components ───────────────────────────────────────────────────────

function Card({ children, className = "", tooltip }: { children: React.ReactNode; className?: string; tooltip?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-3xl p-6 relative ${className}`}>
      {tooltip && <div className="absolute top-4 right-4 z-10"><InfoTooltip text={tooltip} /></div>}
      {children}
    </div>
  );
}
function ChartTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-white font-black text-sm mb-4">{children}</p>;
}
function SectionLabel({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <h2 className="text-[11px] font-black uppercase tracking-widest mb-5"
        style={{ color: accent ?? "#71717a" }}>
      {children}
    </h2>
  );
}
function EmptyState({ label = "No data yet" }: { label?: string }) {
  return <p className="text-zinc-600 text-xs text-center py-8">{label}</p>;
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="relative group inline-flex items-center">
      <button className="w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 flex items-center justify-center text-[9px] font-black cursor-help select-none transition-colors">?</button>
      <div className="absolute z-[100] right-0 bottom-full mb-2 w-64 p-3 rounded-xl bg-zinc-800 border border-zinc-600/80 text-zinc-300 text-[11px] leading-relaxed opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 shadow-xl whitespace-normal">
        {text}
        <div className="absolute top-full right-3 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-zinc-600/80" />
      </div>
    </div>
  );
}

// ── Chart primitives ──────────────────────────────────────────────────────────

function DonutChart({ data, title, colors, tooltip }: { data: { name: string; value: number }[]; title: string; colors?: string[]; tooltip?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const c = colors ?? PIE_COLORS;
  return (
    <Card tooltip={tooltip}>
      <ChartTitle>{title}</ChartTitle>
      {total === 0 ? <EmptyState /> : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={130} height={130}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={38} outerRadius={58} dataKey="value" strokeWidth={0}>
                {data.map((_, i) => <Cell key={i} fill={c[i % c.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {data.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: c[i % c.length] }} />
                  <span className="text-zinc-400 text-[11px]">{d.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-white text-[11px] font-black">{d.value}</span>
                  <span className="text-zinc-600 text-[10px] ml-1">({total > 0 ? Math.round(d.value / total * 100) : 0}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function HBarChart({ data, title, color = AMBER, tooltip }: { data: { name: string; value: number }[]; title: string; color?: string; tooltip?: string }) {
  return (
    <Card tooltip={tooltip}>
      <ChartTitle>{title}</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} horizontal={false} />
            <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickLine={false} axisLine={false} width={110} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} name="Count" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function VBarChart({ data, title, color = AMBER, tooltip }: { data: { name: string; value: number }[]; title: string; color?: string; tooltip?: string }) {
  return (
    <Card tooltip={tooltip}>
      <ChartTitle>{title}</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="name" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} name="Count" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, unit, accent = AMBER, sub, tooltip }: {
  label: string; value: number | string; unit?: string; accent?: string; sub?: string; tooltip?: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 relative">
      {tooltip && <div className="absolute top-3 right-3"><InfoTooltip text={tooltip} /></div>}
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 pr-5">{label}</p>
      <p className="text-3xl font-black text-white leading-none">
        {value}<span className="text-lg" style={{ color: accent }}>{unit}</span>
      </p>
      {sub && <p className="text-[10px] text-zinc-600 mt-1 uppercase tracking-widest font-bold">{sub}</p>}
    </div>
  );
}

export function KpiCards({ data }: { data: DashboardData }) {
  const { kpis, contentStats, renderPercentiles } = data;
  return (
    <div className="space-y-4 mb-8">
      {/* Row 1 — Core business metrics */}
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600 mb-2">Core Metrics</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard label="Total Uploads"     value={kpis.totalUploads}     tooltip="Total upload sessions started. Each video file dropped into the app creates one session." />
          <KpiCard label="Videos Generated"  value={kpis.totalDownloads}   accent="#22c55e" tooltip="Total videos successfully generated and ready to download or share." />
          <KpiCard label="Conversion Rate"   value={kpis.conversionRate}   unit="%" tooltip="% of upload sessions that ended with a generated video. Core product success metric." />
          <KpiCard label="Avg Render Time"   value={kpis.avgRenderSec}     unit="s" tooltip="Average render duration across all successful renders. Zero-duration records (pre-fix) are excluded." />
          <KpiCard label="P90 Render Time"   value={renderPercentiles.p90} unit="s" sub="90% of renders finish within" tooltip="90th percentile render time — 90% of users get their video within this duration. SLA target: under 120s." />
        </div>
      </div>

      {/* Row 2 — Content volume (investor deck) */}
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600 mb-2">Content Volume — All Time</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard label="KM Analyzed"       value={contentStats.totalKm.toLocaleString()}    unit=" km"  accent="#22d3ee" tooltip="Total GPS track distance across all processed sessions — cumulative kilometers of adventure analyzed." />
          <KpiCard label="Elevation Gained"  value={contentStats.totalElevM.toLocaleString()} unit=" m"   accent="#a855f7" tooltip="Total elevation gain across all activities processed — cumulative meters climbed." />
          <KpiCard label="Activity Hours"    value={contentStats.totalActivityH}               unit=" h"   accent="#22d3ee" tooltip="Total duration of GPS tracks analyzed, in hours. Reflects how much activity data the engine has processed." />
          <KpiCard label="Video Hours In"    value={contentStats.totalVideoH}                  unit=" h"   accent="#78716c" tooltip="Total duration of raw source video files uploaded, in hours. Gives a sense of input content volume." />
          <KpiCard label="Avg Clips/Video"   value={contentStats.avgScenes}                                                tooltip="Average number of action scene clips detected per video — higher means richer, more dynamic content." sub="action clips per video" />
          <KpiCard label="Avg Output Length" value={contentStats.avgOutputSec}                  unit=" s"                  tooltip="Average duration of the final rendered highlight video in seconds." sub="final video duration" />
          <KpiCard label="Avg Output Size"   value={contentStats.avgOutputMB}                   unit=" MB" accent={AMBER}  tooltip="Average file size of the rendered highlight video downloaded by the user." sub="avg rendered video size" />
          <KpiCard label="Max Output Size"   value={contentStats.maxOutputMB}                   unit=" MB" accent={AMBER}  tooltip="Largest rendered highlight video downloaded — useful for sizing infrastructure limits." sub="largest rendered video" />
          <KpiCard label="Total Output"      value={contentStats.totalOutputGB}                 unit=" GB" accent="#22d3ee" tooltip="Total gigabytes of rendered highlight videos downloaded by all users." sub="total video generated" />
        </div>
      </div>
    </div>
  );
}

// ── Render Time Percentiles widget ────────────────────────────────────────────

function RenderPercentilesWidget({ data }: { data: DashboardData["renderPercentiles"] }) {
  const bars = [
    { label: "P50 — half of renders finish within",     value: data.p50, color: "#22c55e" },
    { label: "P90 — 90% of renders finish within",      value: data.p90, color: AMBER },
    { label: "P99 — worst 1% of renders takes up to",   value: data.p99, color: "#ef4444" },
  ];
  const max = Math.max(...bars.map(b => b.value), 1);
  return (
    <Card tooltip="Render time distribution. P50 is the median — half of renders finish faster. P90 means 90% of renders finish within this time. P99 is the slowest 1%.">
      <div className="flex items-center justify-between mb-4">
        <ChartTitle>Render Time Percentiles</ChartTitle>
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">{data.count} renders</span>
      </div>
      {data.count === 0 ? <EmptyState /> : (
        <div className="space-y-4">
          {bars.map(b => (
            <div key={b.label}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-zinc-400 font-medium">{b.label}</span>
                <span className="font-black text-white">{b.value}<span className="text-zinc-500 font-normal">s</span></span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.round(b.value / max * 100)}%`, background: b.color }} />
              </div>
            </div>
          ))}
          <p className="text-[10px] text-zinc-600 pt-1">SLA target: P90 &lt; 120s</p>
        </div>
      )}
    </Card>
  );
}

// ── Success Rate by Device ────────────────────────────────────────────────────

function SuccessRateByDeviceChart({ data }: { data: DashboardData["successByDevice"] }) {
  return (
    <Card tooltip="Success rate grouped by the camera used to record the video (GoPro, iPhone, Android) — not the device used to open LENS. A GoPro video rendered on desktop Chrome still appears under 'GoPro' here.">
      <ChartTitle>Success Rate by Camera Type</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <div className="space-y-5 mt-1">
          {data.map(d => {
            const succeeded = Math.round(d.total * d.successRate / 100);
            const failed    = d.total - succeeded;
            const rateColor = d.successRate >= 90 ? "#22c55e" : d.successRate >= 70 ? AMBER : "#ef4444";
            const devColor  = DEVICE_COLORS[d.name] ?? "#78716c";
            return (
              <div key={d.name}>
                {/* Row header */}
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2 text-zinc-200 font-black text-xs">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: devColor }} />
                    {d.name}
                  </span>
                  <span className="text-[10px] text-zinc-500">{d.total} total sessions</span>
                </div>
                {/* Success / Fail counts */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2 text-center border border-zinc-700/30">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-0.5">Succeeded</p>
                    <p className="text-xl font-black text-green-400 leading-none">{succeeded}</p>
                  </div>
                  <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2 text-center border border-zinc-700/30">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-0.5">Failed</p>
                    <p className="text-xl font-black leading-none" style={{ color: failed === 0 ? "#3f3f46" : "#ef4444" }}>
                      {failed === 0 ? "—" : failed}
                    </p>
                  </div>
                  <div className="flex-1 bg-zinc-800/60 rounded-xl px-3 py-2 text-center border border-zinc-700/30">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-0.5">Rate</p>
                    <p className="text-xl font-black leading-none" style={{ color: rateColor }}>{d.successRate}%</p>
                  </div>
                </div>
                {/* Stacked bar */}
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden flex">
                  <div className="h-full rounded-l-full transition-all" style={{ width: `${d.successRate}%`, background: devColor }} />
                  {failed > 0 && <div className="h-full rounded-r-full transition-all" style={{ width: `${100 - d.successRate}%`, background: "#ef444440" }} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Sessions Over Time ────────────────────────────────────────────────────────

function SessionsChart({ data }: { data: DashboardData["sessionsOverTime"] }) {
  return (
    <Card tooltip="Number of upload sessions started each day over the last 30 days. Each session = one video file uploaded.">
      <ChartTitle>Sessions — Last 30 Days</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={AMBER} stopOpacity={0.3} />
                <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="count" stroke={AMBER} strokeWidth={2} fill="url(#amberGrad)" name="Sessions" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function SessionOutcomeOverTimeChart({ data }: { data: DashboardData["sessionSuccessOverTime"] }) {
  return (
    <Card tooltip="Daily breakdown of successful vs failed sessions over the last 30 days. Watch for spikes in the error line — they indicate a deployment or platform issue.">
      <ChartTitle>Success vs Error — Last 30 Days</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="sGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={AMBER}     stopOpacity={0.3} />
                <stop offset="95%" stopColor={AMBER}     stopOpacity={0} />
              </linearGradient>
              <linearGradient id="eGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={ERROR_RED} stopOpacity={0.3} />
                <stop offset="95%" stopColor={ERROR_RED} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
            <Area type="monotone" dataKey="success" stroke={AMBER}     fill="url(#sGrad)" strokeWidth={2} name="Success" />
            <Area type="monotone" dataKey="error"   stroke={ERROR_RED} fill="url(#eGrad)" strokeWidth={2} name="Error" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}


// ── Session Outcome Widget ────────────────────────────────────────────────────

function SessionOutcomeWidget({ data }: { data: DashboardData["errorKPIs"] }) {
  const donutData = [
    { name: "Success", value: data.successCount },
    { name: "Error",   value: data.errorCount },
  ];
  return (
    <Card tooltip="All-time breakdown of sessions by outcome. 'Generated' = a video was produced and available for download. 'Failed' = the pipeline encountered a hard error (from processing_sessions).">
      <ChartTitle>Session Outcomes — All Time</ChartTitle>
      {data.totalSessions === 0 ? <EmptyState label="No sessions recorded yet" /> : (
        <div className="flex flex-col sm:flex-row items-center gap-8">
          <div className="relative shrink-0">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={56} outerRadius={80} dataKey="value" strokeWidth={0} startAngle={90} endAngle={-270}>
                  <Cell fill={AMBER} />
                  <Cell fill={ERROR_RED} />
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black text-amber-400">{data.successRate}%</span>
              <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">success</span>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-4 w-full">
            <div className="bg-zinc-800/60 rounded-2xl px-5 py-4 border border-amber-500/20">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Generated</p>
              <p className="text-4xl font-black text-amber-400">{data.successCount}</p>
              <p className="text-xs text-zinc-500 mt-1">{data.successRate}% of sessions</p>
            </div>
            <div className="bg-zinc-800/60 rounded-2xl px-5 py-4 border border-red-500/20">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Failed</p>
              <p className="text-4xl font-black text-red-400">{data.errorCount}</p>
              <p className="text-xs text-zinc-500 mt-1">{data.errorSessionRate}% of sessions</p>
            </div>
            <div className="col-span-2">
              <div className="flex justify-between text-[11px] mb-1.5">
                <span className="text-amber-400 font-black">Success {data.successRate}%</span>
                <span className="text-red-400 font-black">Error {data.errorSessionRate}%</span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden flex">
                <div className="h-full bg-amber-400 rounded-l-full transition-all" style={{ width: `${data.successRate}%` }} />
                <div className="h-full bg-red-500 rounded-r-full transition-all" style={{ width: `${data.errorSessionRate}%` }} />
              </div>
              <p className="text-[10px] text-zinc-600 mt-1.5">{data.totalSessions} total sessions</p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Error KPI Cards ───────────────────────────────────────────────────────────

function ErrorKpiCards({ data }: { data: DashboardData["errorKPIs"] }) {
  const cards = [
    { label: "Total Errors",  value: data.totalErrors,      unit: "",  color: "text-red-400",    border: "border-red-900/40",    tooltip: "Total error events ever logged — includes pre-session rejections (wrong format, no GPS) and soft pipeline errors." },
    { label: "Last 7 Days",   value: data.errorsLast7d,     unit: "",  color: "text-orange-400", border: "border-orange-900/40", tooltip: "Error events in the last 7 days. A rising count may indicate a recent platform or compatibility issue." },
    { label: "Last 24h",      value: data.errorsLast24h,    unit: "",  color: "text-yellow-400", border: "border-yellow-900/30", tooltip: "Error events in the last 24 hours. Useful for detecting newly deployed bugs or spikes from a specific user segment." },
    { label: "Success Rate",  value: data.successRate,      unit: "%", color: "text-amber-400",  border: "border-amber-900/40",  tooltip: "% of all sessions that completed successfully and produced a video." },
    { label: "Error Rate",    value: data.errorSessionRate, unit: "%", color: "text-red-400",    border: "border-red-900/40",    tooltip: "% of all sessions that ended with a hard pipeline error. Calculated from processing_sessions, not error_events." },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      {cards.map((c) => (
        <div key={c.label} className={`bg-zinc-900 border ${c.border} rounded-2xl px-5 py-4 relative`}>
          <div className="absolute top-3 right-3"><InfoTooltip text={c.tooltip} /></div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 pr-5">{c.label}</p>
          <p className={`text-3xl font-black ${c.color}`}>{c.value}<span className="text-lg">{c.unit}</span></p>
        </div>
      ))}
    </div>
  );
}

// ── Errors by Code ────────────────────────────────────────────────────────────

function ErrorsByCodeChart({ data }: { data: DashboardData["errorsByCode"] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card tooltip="Most frequent error types ranked by count. Use this to prioritize which error categories to fix first — the top errors have the most user impact.">
      <ChartTitle>Errors by Type</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <div className="space-y-2.5">
          {data.map((entry) => {
            const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
            const color = ERROR_COLORS[entry.name] ?? ERROR_RED;
            return (
              <div key={entry.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-zinc-300 font-mono text-[11px]">{entry.name}</span>
                  </div>
                  <span className="text-white font-black tabular-nums">
                    {entry.value}<span className="text-zinc-500 font-normal ml-1">({pct}%)</span>
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Errors by Source ──────────────────────────────────────────────────────────

function ErrorsBySourceChart({ data }: { data: DashboardData["errorsBySource"] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const colored = data.map((d) => ({ ...d, color: SOURCE_COLORS[d.name] ?? "#52525b" }));
  return (
    <Card tooltip="Where in the pipeline errors originate: video_upload = format/size rejection before processing; gpx_upload = invalid GPX file; render = failure during video generation; worker = unexpected crash.">
      <ChartTitle>Errors by Source</ChartTitle>
      {total === 0 ? <EmptyState /> : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={130} height={130}>
            <PieChart>
              <Pie data={colored} cx="50%" cy="50%" innerRadius={38} outerRadius={58} dataKey="value" strokeWidth={0}>
                {colored.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {colored.map((d) => (
              <div key={d.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-zinc-400 text-[11px] capitalize">{d.name.replace("_", " ")}</span>
                </div>
                <span className="text-white text-[11px] font-black">
                  {d.value}<span className="text-zinc-600 font-normal ml-1">({total > 0 ? Math.round(d.value / total * 100) : 0}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Errors by Device ──────────────────────────────────────────────────────────

function ErrorsByDeviceChart({ data }: { data: DashboardData["errorsByDevice"] }) {
  return (
    <Card tooltip="Error count by camera make and model. Helps identify whether a specific hardware model is consistently causing failures.">
      <ChartTitle>Errors by Device / App</ChartTitle>
      {data.length === 0
        ? <EmptyState label="No device data yet" />
        : (
          <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
            <BarChart data={data} layout="vertical" margin={{ left: 0, right: 28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} horizontal={false} />
              <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickLine={false} axisLine={false} width={110} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" fill="#8b5cf6" radius={[0, 6, 6, 0]} name="Errors" />
            </BarChart>
          </ResponsiveContainer>
        )
      }
    </Card>
  );
}

// ── Success vs Error rate by camera (stacked bar) ─────────────────────────────

function SuccessRateByCameraChart({ data }: { data: DashboardData["successRateByCamera"] }) {
  return (
    <Card tooltip="Success vs error rate per camera type — GoPro, iPhone, Android. Shows which recording device produces the most reliable results.">
      <ChartTitle>Success vs Error Rate by Camera Type</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-3 -mt-2">Based on all upload sessions. "Unknown" = sessions where camera type wasn't detected (older sessions or unsupported cameras).</p>
      {data.length === 0 ? <EmptyState label="No camera session data yet" /> : (
        <div className="space-y-4">
          {data.map(d => (
            <div key={d.name}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="flex items-center gap-2 text-zinc-300 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: DEVICE_COLORS[d.name] ?? "#78716c" }} />
                  {d.name}
                </span>
                <span className="flex items-center gap-3 text-[11px]">
                  <span className="text-amber-400 font-black">{d.success} ok</span>
                  <span className="text-red-400 font-black">{d.error} fail</span>
                  <span className="text-zinc-500">({d.total} total)</span>
                </span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden flex">
                <div className="h-full rounded-l-full transition-all"
                  style={{ width: `${d.successRate}%`, background: DEVICE_COLORS[d.name] ?? AMBER }} />
                <div className="h-full rounded-r-full transition-all"
                  style={{ width: `${100 - d.successRate}%`, background: "#ef444440" }} />
              </div>
              <div className="flex justify-between text-[10px] mt-0.5">
                <span className="font-black" style={{ color: d.successRate >= 90 ? "#22c55e" : d.successRate >= 70 ? AMBER : "#ef4444" }}>
                  {d.successRate}% success
                </span>
                <span className="text-zinc-600">{100 - d.successRate}% error</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Errors by OS version ──────────────────────────────────────────────────────

function ErrorsByOsVersionChart({ data }: { data: DashboardData["errorsByOsVersion"] }) {
  return (
    <Card tooltip="Error count broken down by OS version (iOS or Android). Helps identify if a specific OS update broke compatibility — populated from v1.0.31+ sessions.">
      <ChartTitle>Errors by OS Version</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-3 -mt-2">Only populated for errors since v1.0.31+ with diagnostic enrichment.</p>
      {data.length === 0 ? <EmptyState label="No OS version data yet — run migration and collect new errors" /> : (
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34)}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} horizontal={false} />
            <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickLine={false} axisLine={false} width={90} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill="#22c55e" radius={[0, 6, 6, 0]} name="Errors">
              {data.map((d, i) => (
                <Cell key={i} fill={d.name.startsWith("iOS") ? AMBER : "#22c55e"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Unsupported Sources (demand signals) ─────────────────────────────────────

function UnsupportedSourcesWidget({ data }: { data: DashboardData["unsupportedSources"] }) {
  const cameras = data.unsupportedCameras;
  const gps     = data.unsupportedGps;
  const totalVideo = cameras.reduce((s, d) => s + d.value, 0);
  const totalGps   = gps.reduce((s, d) => s + d.value, 0);

  const Row = ({ name, value, total, color }: { name: string; value: number; total: number; color: string }) => {
    const pct = total > 0 ? Math.round(value / total * 100) : 0;
    const barW = total > 0 ? (value / total) * 100 : 0;
    return (
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-zinc-300 font-semibold truncate max-w-[160px]" title={name}>{name}</span>
          <span className="text-zinc-500 shrink-0 ml-2">{value}× <span className="text-zinc-600">({pct}%)</span></span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${barW}%`, background: color }} />
        </div>
      </div>
    );
  };

  return (
    <Card
      className="col-span-full"
      tooltip="Cameras and GPS trackers that users tried to use but LENS doesn't support yet. Use this as a roadmap demand signal — the higher the count, the more users are asking for that device."
    >
      <ChartTitle>Unsupported Devices — Demand Signals</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-5 -mt-2">
        Every attempt with an unsupported camera or GPS tracker is captured here.
        High counts = strong demand for future support.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Video cameras */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-3">
            Unsupported Video Cameras
            <span className="text-zinc-600 font-normal ml-2 normal-case tracking-normal">{totalVideo} total attempt{totalVideo !== 1 ? "s" : ""}</span>
          </p>
          {cameras.length === 0
            ? <EmptyState label="No unsupported camera attempts yet" />
            : <div className="space-y-3">
                {cameras.map(d => <Row key={d.name} name={d.name} value={d.value} total={totalVideo} color="#3b82f6" />)}
              </div>
          }
        </div>

        {/* GPS trackers */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-3">
            Unsupported GPS Sources
            <span className="text-zinc-600 font-normal ml-2 normal-case tracking-normal">{totalGps} total attempt{totalGps !== 1 ? "s" : ""}</span>
          </p>
          {gps.length === 0
            ? <EmptyState label="No unsupported GPS source attempts yet" />
            : <div className="space-y-3">
                {gps.map(d => <Row key={d.name} name={d.name} value={d.value} total={totalGps} color={AMBER} />)}
              </div>
          }
        </div>

      </div>
    </Card>
  );
}

// ── Errors by Browser ────────────────────────────────────────────────────────

function ErrorsByBrowserChart({ data }: { data: DashboardData["errorsByBrowser"] }) {
  const BROWSER_COLORS: Record<string, string> = {
    Chrome: "#22c55e", Safari: AMBER, Firefox: "#f97316", Edge: "#3b82f6", Unknown: "#52525b",
  };
  return (
    <Card tooltip="Error distribution by browser. Safari on iOS has stricter WebCodecs constraints — higher Safari error rates may indicate codec or memory limits specific to that browser.">
      <ChartTitle>Errors by Browser</ChartTitle>
      {data.length === 0 ? <EmptyState label="No browser data yet" /> : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={34} outerRadius={54} dataKey="value" strokeWidth={0}>
                {data.map((d, i) => <Cell key={i} fill={BROWSER_COLORS[d.name] ?? "#52525b"} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {data.map(d => {
              const total = data.reduce((s, x) => s + x.value, 0);
              const pct = total > 0 ? Math.round(d.value / total * 100) : 0;
              return (
                <div key={d.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: BROWSER_COLORS[d.name] ?? "#52525b" }} />
                    <span className="text-zinc-400 text-[11px]">{d.name}</span>
                  </div>
                  <span className="text-white text-[11px] font-black">{d.value}
                    <span className="text-zinc-600 font-normal ml-1">({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Errors by video codec ─────────────────────────────────────────────────────

function ErrorsByCodecChart({ data }: { data: DashboardData["errorsByCodec"] }) {
  const CODEC_COLORS = ["#3b82f6", "#f97316", "#52525b"];
  return (
    <Card tooltip="Error distribution by video codec. H.264 is widely supported. HEVC (H.265) requires browser transcoding support and generates more errors — especially on older devices.">
      <ChartTitle>Errors by Video Codec</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-2 -mt-2">H.264 = standard · HEVC/H.265 = requires transcoding or newer browser.</p>
      {data.length === 0 ? <EmptyState label="No codec data yet" /> : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={120} height={120}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={34} outerRadius={54} dataKey="value" strokeWidth={0}>
                {data.map((_, i) => <Cell key={i} fill={CODEC_COLORS[i % CODEC_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {data.map((d, i) => {
              const total = data.reduce((s, x) => s + x.value, 0);
              const pct = total > 0 ? Math.round(d.value / total * 100) : 0;
              return (
                <div key={d.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: CODEC_COLORS[i % CODEC_COLORS.length] }} />
                    <span className="text-zinc-400 text-[11px] font-mono">{d.name}</span>
                  </div>
                  <span className="text-white text-[11px] font-black">{d.value}
                    <span className="text-zinc-600 font-normal ml-1">({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Errors by file size (errors-only distribution) ────────────────────────────

function ErrorsByFileSizeChart({ data }: { data: DashboardData["errorsByFileSizeBucket"] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card tooltip="File size distribution of uploads that triggered errors. Useful for calibrating upload limits and understanding if large files are a disproportionate source of failures.">
      <ChartTitle>Failed Uploads by File Size</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-3 -mt-2">File sizes of videos that produced an error (not successful uploads).</p>
      {total === 0 ? <EmptyState label="No file size data yet" /> : (
        <div className="space-y-2.5">
          {data.map(d => {
            const pct = total > 0 ? Math.round(d.value / total * 100) : 0;
            return (
              <div key={d.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-zinc-300 font-mono text-[11px]">{d.name}</span>
                  <span className="text-white font-black tabular-nums">
                    {d.value}<span className="text-zinc-500 font-normal ml-1">({pct}%)</span>
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-red-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-zinc-600 pt-1">{total} errors with known file size</p>
        </div>
      )}
    </Card>
  );
}

// ── Error rate over time (% errors per day) ───────────────────────────────────

function ErrorRateOverTimeChart({ data }: { data: DashboardData["errorRateOverTime"] }) {
  return (
    <Card tooltip="% of sessions that ended with an error, per day over the last 30 days. A sustained high rate (above 20%) or a sudden spike indicates a systemic issue needing investigation.">
      <ChartTitle>Daily Error Rate — Last 30 Days</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-2 -mt-2">% of sessions that resulted in an error each day.</p>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="errRateGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={ERROR_RED} stopOpacity={0.25} />
                <stop offset="95%" stopColor={ERROR_RED} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`, "Error Rate"]} />
            <Area type="monotone" dataKey="errorRate" stroke={ERROR_RED} fill="url(#errRateGrad)" strokeWidth={2} name="Error Rate %" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Errors Over Time ──────────────────────────────────────────────────────────

function ErrorsOverTimeChart({ data }: { data: DashboardData["errorsOverTime"] }) {
  return (
    <Card tooltip="Raw count of error events per day over the last 30 days. Includes pre-session rejections and soft errors — not just hard pipeline failures.">
      <ChartTitle>Error Events — Last 30 Days</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="errGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={ERROR_RED} stopOpacity={0.25} />
                <stop offset="95%" stopColor={ERROR_RED} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="count" stroke={ERROR_RED} fill="url(#errGrad)" strokeWidth={2} name="Errors" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Recent Errors Table ───────────────────────────────────────────────────────

const ERRORS_PER_PAGE = 15;

function RecentErrorsTable({ data }: { data: DashboardData["recentErrors"] }) {
  const [page, setPage]           = useState(0);
  const [expandedIdx, setExpanded] = useState<number | null>(null);

  const totalPages = Math.ceil(data.length / ERRORS_PER_PAGE);
  const slice      = data.slice(page * ERRORS_PER_PAGE, (page + 1) * ERRORS_PER_PAGE);

  const fmtMB = (bytes: number | null) =>
    bytes == null ? null : bytes < 1_048_576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1_048_576).toFixed(0)} MB`;

  const fmtDate = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const timeOverlapAnalysis = (e: typeof data[number]) => {
    if (!e.video_recorded_at || !e.gpx_start_at || !e.gpx_end_at) return null;
    const rec   = new Date(e.video_recorded_at).getTime();
    const start = new Date(e.gpx_start_at).getTime();
    const end   = new Date(e.gpx_end_at).getTime();
    const inWindow = rec >= start && rec <= end;
    const diffMin  = Math.round(Math.min(Math.abs(rec - start), Math.abs(rec - end)) / 60_000);
    return { inWindow, diffMin };
  };

  const COL_COUNT = 9;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <ChartTitle>Error Log — Full Diagnostic Context</ChartTitle>
          <p className="text-[10px] text-zinc-600 -mt-3">Click any row to expand full diagnostics</p>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
          {data.length} events
        </span>
      </div>
      {data.length === 0 ? <EmptyState /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  {["", "Date", "Code", "Camera / GPS Source", "File", "Resolution", "Codec", "OS", "Message"].map(h => (
                    <th key={h} className="text-left py-2 pr-3 font-black uppercase tracking-widest whitespace-nowrap text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((e, i) => {
                  const isOpen      = expandedIdx === i;
                  const cameraLabel = [e.device_make, e.device_model].filter(Boolean).join(" ") || null;
                  const cameraColor = e.device_type === "gopro"   ? "#3b82f6"
                                    : e.device_type === "iphone"  ? "#f59e0b"
                                    : e.device_type === "android" ? "#22c55e"
                                    : null;
                  const codecColor  = e.video_codec === "hevc" ? "#f97316" : e.video_codec === "h264" ? "#22d3ee" : null;
                  const osColor     = e.browser_os === "iOS" ? AMBER : e.browser_os === "Android" ? "#22c55e" : "#71717a";
                  const cleanMsg    = (e.message ?? "")
                    .replace(/\s*Camera:\s*\w+\s*\w*\s*\w*\.\s*/g, "")
                    .replace(/\s*Device:\s*"[^"]+"\./g, "")
                    .replace(/\s*File:\s*"[^"]+"\./g, "")
                    .replace(/Unsupported camera:\s*"[^"]+"\.?\s*/g, "")
                    .slice(0, 100);
                  const resolution  = (e as any).video_width && (e as any).video_height
                    ? `${(e as any).video_width}×${(e as any).video_height}` : null;
                  const overlap     = timeOverlapAnalysis(e as any);

                  return (
                    <React.Fragment key={`row-${i}`}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : i)}
                        className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${isOpen ? "bg-zinc-800/40" : "hover:bg-zinc-800/20"}`}
                      >
                        {/* Expand indicator */}
                        <td className="py-2 pr-1 text-zinc-600 text-[10px] font-black w-4 select-none">
                          {isOpen ? "▾" : "▸"}
                        </td>
                        {/* Date */}
                        <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap font-mono text-[10px]">
                          {new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                          <span className="text-zinc-700">{new Date(e.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                        </td>
                        {/* Code */}
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide"
                            style={{ background: `${ERROR_COLORS[e.code] ?? ERROR_RED}20`, color: ERROR_COLORS[e.code] ?? ERROR_RED }}>
                            {e.code?.replace(/_/g, " ")}
                          </span>
                        </td>
                        {/* Camera / GPS Source */}
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {cameraLabel ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-black whitespace-nowrap"
                              style={{ background: `${cameraColor ?? "#78716c"}18`, color: cameraColor ?? "#a1a1aa" }}>
                              {cameraLabel}
                            </span>
                          ) : (e as any).gpx_creator ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-black whitespace-nowrap bg-amber-900/20 text-amber-400">
                              {(e as any).gpx_creator}
                            </span>
                          ) : <span className="text-zinc-700">—</span>}
                        </td>
                        {/* File */}
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            {fmtMB(e.file_size_bytes) && (
                              <span className="text-zinc-300 font-mono text-[10px] font-bold">{fmtMB(e.file_size_bytes)}</span>
                            )}
                            {e.file_extension && (
                              <span className="text-zinc-600 font-mono text-[10px]">{e.file_extension}</span>
                            )}
                            {!fmtMB(e.file_size_bytes) && !e.file_extension && <span className="text-zinc-700">—</span>}
                          </div>
                        </td>
                        {/* Resolution */}
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {resolution ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-zinc-300 font-mono text-[10px] font-bold">{resolution}</span>
                              {(e as any).video_fps && (
                                <span className="text-zinc-600 font-mono text-[10px]">{(e as any).video_fps} fps</span>
                              )}
                            </div>
                          ) : <span className="text-zinc-700">—</span>}
                        </td>
                        {/* Codec */}
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {e.video_codec ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-black uppercase"
                              style={{ background: `${codecColor ?? "#52525b"}20`, color: codecColor ?? "#71717a" }}>
                              {e.video_codec}
                            </span>
                          ) : <span className="text-zinc-700">—</span>}
                        </td>
                        {/* OS */}
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {e.browser_os ? (
                            <div>
                              <span className="font-black text-[11px]" style={{ color: osColor }}>{e.browser_os}</span>
                              {e.browser_os_version && (
                                <span className="text-zinc-600 text-[10px] ml-1">{e.browser_os_version}</span>
                              )}
                            </div>
                          ) : <span className="text-zinc-700">—</span>}
                        </td>
                        {/* Message */}
                        <td className="py-2 max-w-[240px]">
                          <span className="text-zinc-400 text-[10px] break-words leading-relaxed">{cleanMsg || "—"}</span>
                        </td>
                      </tr>

                      {/* ── Expanded detail panel ─────────────────────────────── */}
                      {isOpen && (
                        <tr key={`detail-${i}`} className="bg-zinc-900/80 border-b border-zinc-800">
                          <td colSpan={COL_COUNT} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

                              {/* Video */}
                              <div className="space-y-2">
                                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-zinc-600 mb-2">Video File</p>
                                {[
                                  { label: "Codec",       value: e.video_codec?.toUpperCase() ?? null,
                                    color: e.video_codec === "hevc" ? "#f97316" : e.video_codec === "h264" ? "#22d3ee" : null },
                                  { label: "Resolution",  value: resolution },
                                  { label: "Frame Rate",  value: (e as any).video_fps ? `${(e as any).video_fps} fps` : null },
                                  { label: "File Size",   value: fmtMB(e.file_size_bytes) },
                                  { label: "Format",      value: e.file_extension ?? null },
                                  { label: "MIME",        value: e.file_mime_type ?? null },
                                  { label: "Embedded GPS",value: (e as any).video_has_gps != null
                                      ? ((e as any).video_has_gps ? "Yes — GPMF stream present" : "No") : null,
                                    color: (e as any).video_has_gps ? "#22c55e" : null },
                                  { label: "Recorded At", value: fmtDate((e as any).video_recorded_at) },
                                ].map(({ label, value, color }: any) => value != null && (
                                  <div key={label} className="flex items-baseline gap-2">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600 w-24 shrink-0">{label}</span>
                                    <span className="text-[11px] font-black" style={{ color: color ?? "#e4e4e7" }}>{value}</span>
                                  </div>
                                ))}
                              </div>

                              {/* GPX + Time Overlap */}
                              <div className="space-y-2">
                                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-zinc-600 mb-2">GPS / GPX</p>
                                {[
                                  { label: "Source",      value: (e as any).gpx_creator ?? null },
                                  { label: "Points",      value: (e as any).gpx_point_count ? `${(e as any).gpx_point_count.toLocaleString()} pts` : null },
                                  { label: "GPX Start",   value: fmtDate((e as any).gpx_start_at) },
                                  { label: "GPX End",     value: fmtDate((e as any).gpx_end_at) },
                                ].map(({ label, value }: any) => value != null && (
                                  <div key={label} className="flex items-baseline gap-2">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600 w-24 shrink-0">{label}</span>
                                    <span className="text-[11px] font-black text-zinc-200">{value}</span>
                                  </div>
                                ))}
                                {overlap != null && (
                                  <div className={`mt-2 px-2 py-1.5 rounded-lg text-[10px] font-black ${
                                    overlap.inWindow
                                      ? "bg-green-900/30 text-green-400"
                                      : "bg-red-900/30 text-red-400"
                                  }`}>
                                    {overlap.inWindow
                                      ? "✓ Video recording falls within GPX time window"
                                      : `⚠ No time overlap — video is ${overlap.diffMin} min outside GPX window`}
                                  </div>
                                )}
                              </div>

                              {/* Device + Browser */}
                              <div className="space-y-2">
                                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-zinc-600 mb-2">Device & Browser</p>
                                {[
                                  { label: "Camera",      value: [e.device_make, e.device_model].filter(Boolean).join(" ") || null },
                                  { label: "Type",        value: e.device_type ?? null },
                                  { label: "Browser OS",  value: e.browser_os ? `${e.browser_os} ${e.browser_os_version ?? ""}`.trim() : null },
                                  { label: "Browser",     value: e.browser_name ? `${e.browser_name} ${e.browser_version ?? ""}`.trim() : null },
                                  { label: "RAM",         value: e.device_memory_gb != null ? `${e.device_memory_gb} GB` : null },
                                  { label: "CPU Cores",   value: e.cpu_cores != null ? `${e.cpu_cores} cores` : null },
                                  { label: "App Version", value: e.version ?? null },
                                ].map(({ label, value }: any) => value != null && (
                                  <div key={label} className="flex items-baseline gap-2">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600 w-24 shrink-0">{label}</span>
                                    <span className="text-[11px] font-black text-zinc-200">{value}</span>
                                  </div>
                                ))}

                                {/* Full error message */}
                                {e.message && (
                                  <div className="mt-3 pt-3 border-t border-zinc-800/60">
                                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-zinc-600 mb-1">Full Message</p>
                                    <p className="text-[10px] text-zinc-400 leading-relaxed whitespace-pre-wrap break-words">{e.message}</p>
                                  </div>
                                )}
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800/60">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
              {page * ERRORS_PER_PAGE + 1}–{Math.min((page + 1) * ERRORS_PER_PAGE, data.length)} of {data.length}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(0)} disabled={page === 0}
                className="px-2 py-1 rounded-lg text-[10px] font-black disabled:text-zinc-700 disabled:cursor-not-allowed text-zinc-400 hover:text-white hover:bg-zinc-800">«</button>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-2 py-1 rounded-lg text-[10px] font-black disabled:text-zinc-700 disabled:cursor-not-allowed text-zinc-400 hover:text-white hover:bg-zinc-800">‹</button>
              {Array.from({ length: Math.min(totalPages, 8) }, (_, i) => i).map(i => (
                <button key={i} onClick={() => setPage(i)}
                  className={`w-7 h-7 rounded-lg text-[11px] font-black transition-colors ${i === page ? "bg-amber-500 text-black" : "text-zinc-500 hover:text-white hover:bg-zinc-800"}`}>
                  {i + 1}
                </button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                className="px-2 py-1 rounded-lg text-[10px] font-black disabled:text-zinc-700 disabled:cursor-not-allowed text-zinc-400 hover:text-white hover:bg-zinc-800">›</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1}
                className="px-2 py-1 rounded-lg text-[10px] font-black disabled:text-zinc-700 disabled:cursor-not-allowed text-zinc-400 hover:text-white hover:bg-zinc-800">»</button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Complete Pipeline Funnel ──────────────────────────────────────────────────
// Shows the full end-to-end journey of a session: attempt → process → preview
// → render → save. Each stage shows count, drop-off and conversion rate.
// Also clarifies the semantic gap between error_events log and failed sessions.

type PipelineFunnel = DashboardData["pipelineFunnel"];

function PipelineFunnelWidget({ data: d }: { data: PipelineFunnel }) {
  const stages: {
    label: string; sub: string; count: number;
    rate: number | null; drop: number; dropLabel: string; color: string;
  }[] = [
    // drop = sessions lost TO REACH this stage from the previous one.
    // Shown below the stage bar so the reader sees: "this many arrived, this many were lost here."
    { label: "Uploaded",  sub: "Upload attempt started",      count: d.total,          rate: null,           drop: 0,              dropLabel: "",                         color: "#f59e0b" },
    { label: "Processed", sub: "GPS + telemetry extracted",   count: d.processed,      rate: d.rateProcess,  drop: d.dropProcess,  dropLabel: "failed extraction",        color: "#f59e0b" },
    { label: "Preview",   sub: 'Clicked "Generate"',          count: d.reachedPreview, rate: d.ratePreview,  drop: d.dropPreview,  dropLabel: "didn't click Generate",    color: "#22d3ee" },
    { label: "Rendered",  sub: "Video file produced",         count: d.rendered,       rate: d.rateRender,   drop: d.dropRender,   dropLabel: "render failed / aborted",  color: "#a855f7" },
    { label: "Saved",     sub: "User saved or shared",        count: d.downloaded,     rate: d.rateDownload, drop: d.dropDownload, dropLabel: "rendered but not saved",   color: "#22c55e" },
  ];

  const e2eColor = d.rateEndToEnd >= 70 ? "#22c55e" : d.rateEndToEnd >= 40 ? AMBER : "#ef4444";
  const maxCount = d.total || 1;

  return (
    <Card tooltip="Full session journey from upload to saved video. Each stage shows count, % conversion from the first stage, and drop-off (sessions lost before reaching the next stage). Note: Error Events ≠ Failed Sessions — error events include pre-session rejections.">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-white font-black text-sm">End-to-End Pipeline</p>
          <p className="text-zinc-500 text-[11px] mt-0.5">From upload to saved video — every stage tracked.</p>
        </div>
        <div className="text-right shrink-0 ml-4">
          <p className="font-black text-2xl leading-none" style={{ color: e2eColor }}>{d.rateEndToEnd}%</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-0.5">end-to-end</p>
        </div>
      </div>

      {d.total === 0 ? <EmptyState label="No sessions recorded yet" /> : (
        <>
          {/* Funnel rows */}
          <div>
            {stages.map((s, i) => {
              const barPct = Math.round((s.count / maxCount) * 100);
              const isLast = i === stages.length - 1;
              return (
                <div key={s.label}>
                  {/* Stage row: [COUNT] [label + bar] [rate] */}
                  <div className="flex items-center gap-3 py-2">

                    {/* COUNT — big, left column, fixed width */}
                    <div className="w-10 shrink-0 text-right">
                      <span className="text-2xl font-black tabular-nums leading-none"
                        style={{ color: s.color }}>
                        {s.count}
                      </span>
                    </div>

                    {/* Stage label + sub + proportional bar */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-[11px] font-black text-white uppercase tracking-widest">{s.label}</span>
                        <span className="text-zinc-600 text-[10px] ml-3 shrink-0">{s.sub}</span>
                      </div>
                      <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${barPct}%`, background: s.color + "60" }} />
                      </div>
                    </div>

                    {/* RATE — right column, fixed width */}
                    <div className="w-12 shrink-0 text-right">
                      {s.rate !== null
                        ? <span className="text-sm font-black tabular-nums"
                            style={{ color: s.rate >= 90 ? "#22c55e" : s.rate >= 70 ? AMBER : "#ef4444" }}>
                            {s.rate}%
                          </span>
                        : <span className="text-[10px] text-zinc-700 font-black">—</span>
                      }
                    </div>
                  </div>

                  {/* Drop-off row — indented to align with label column */}
                  {!isLast && (
                    <div className="flex items-center gap-3 pb-1">
                      <div className="w-10 shrink-0" />
                      <div className="flex items-center gap-2 pl-0.5">
                        {s.drop > 0 ? (
                          <>
                            <span className="text-red-800 text-[11px] leading-none select-none">↘</span>
                            <span className="text-red-400 text-[10px] font-black tabular-nums">−{s.drop}</span>
                            <span className="text-zinc-600 text-[10px]">{s.dropLabel}</span>
                          </>
                        ) : (
                          <span className="text-zinc-800 text-[11px] leading-none select-none">↓</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Semantic clarification: error_events vs failed sessions */}
          <div className="mt-5 bg-zinc-800/30 border border-zinc-700/40 rounded-xl p-3 flex items-start gap-3">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="3"/>
            </svg>
            <p className="text-zinc-500 text-[10px] leading-relaxed">
              <span className="font-black text-zinc-400">Error Events ({d.errorEventCount}) ≠ Failed Sessions ({d.failedProc}).</span>{" "}
              The error log counts every rejection (wrong format, no GPS…) even before a session starts.
              The {d.failedProc} failed session{d.failedProc !== 1 ? "s" : ""} above are actual pipeline failures.
              The remaining {Math.max(0, d.errorEventCount - d.failedProc)} event{Math.max(0, d.errorEventCount - d.failedProc) !== 1 ? "s" : ""} are pre-session rejections.
            </p>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Quick-status KPI strip (overview hero) ────────────────────────────────────

function PipelineHealthStrip({ data: d }: { data: PipelineFunnel }) {
  const items = [
    { label: "Attempts",    value: d.total,         color: AMBER,     tooltip: "Total upload sessions started — every video file dropped into the app." },
    { label: "Processed",   value: d.processed,      color: AMBER,     tooltip: "Sessions where GPS telemetry and video metadata were successfully extracted." },
    { label: "Previewed",   value: d.reachedPreview, color: "#22d3ee", tooltip: "Sessions where the user clicked 'Generate' and saw a preview — indicating real intent to create a video." },
    { label: "Rendered",    value: d.rendered,       color: "#a855f7", tooltip: "Sessions where the engine produced a final video file." },
    { label: "Saved",       value: d.downloaded,     color: "#22c55e", tooltip: "Sessions where the user saved or shared the generated video." },
    { label: "Hard Errors", value: d.failedProc,     color: "#ef4444", tooltip: "Sessions that entered the pipeline and failed with a hard error. Source: processing_sessions WHERE status = 'error'. Not the same as error_events." },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
      {items.map(item => (
        <div key={item.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-center relative">
          <div className="absolute top-2 right-2"><InfoTooltip text={item.tooltip} /></div>
          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-1">{item.label}</p>
          <p className="text-2xl font-black leading-none" style={{ color: item.color }}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Failed Sessions Log (hard errors only) ────────────────────────────────────
// Source: processing_sessions WHERE status = 'error'
// Completely separate from error_events — never mixed or summed together.

function FailedSessionsLog({ data }: { data: DashboardData["failedSessions"] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (data.length === 0) {
    return (
      <Card tooltip="Sessions that entered the pipeline and failed with a hard error. Source: processing_sessions WHERE status = 'error'. Completely separate from the error_events log.">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
          <ChartTitle>Failed Sessions</ChartTitle>
        </div>
        <EmptyState label="No failed sessions — pipeline is clean" />
      </Card>
    );
  }

  return (
    <Card tooltip="Sessions that entered the pipeline and failed with a hard error. Source: processing_sessions WHERE status = 'error'. Completely separate from the error_events log. Click any row to see the full error message and context.">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 animate-pulse" />
            <p className="text-white font-black text-sm">Failed Sessions</p>
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Sessions that entered the pipeline and failed — from <span className="font-black text-zinc-400">processing_sessions</span>.
            Not the same as error_events (pre-session rejections).
          </p>
        </div>
        <span className="shrink-0 ml-4 px-2.5 py-1 rounded-full bg-red-950 border border-red-800/50 text-red-400 text-[11px] font-black">
          {data.length} hard error{data.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-3">
        {data.map((s) => {
          const isOpen = expanded === s.id;
          const cameraLabel = [s.device_make, s.device_model].filter(Boolean).join(" ") || s.camera_model || null;
          const deviceColor = s.device_type === "gopro"   ? "#3b82f6"
                            : s.device_type === "iphone"  ? "#f59e0b"
                            : s.device_type === "android" ? "#22c55e"
                            : "#71717a";
          const osColor = s.browser_os === "iOS" ? AMBER : s.browser_os === "Android" ? "#22c55e" : "#71717a";
          const procSec = s.processing_time_ms != null ? (s.processing_time_ms / 1000).toFixed(1) : null;

          return (
            <div key={s.id}
              className="border border-zinc-800 rounded-2xl overflow-hidden">
              {/* Summary row — always visible */}
              <button
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors text-left">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
                    {/* Date */}
                    <span className="text-zinc-500 font-mono text-[10px]">
                      {new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                      {new Date(s.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {/* Camera */}
                    {cameraLabel && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black"
                        style={{ background: `${deviceColor}18`, color: deviceColor }}>
                        {cameraLabel}
                      </span>
                    )}
                    {/* OS */}
                    {s.browser_os && (
                      <span className="text-[10px] font-black" style={{ color: osColor }}>
                        {s.browser_os}{s.browser_os_version ? ` ${s.browser_os_version}` : ""}
                      </span>
                    )}
                    {/* Browser */}
                    {s.browser_name && (
                      <span className="text-zinc-500 text-[10px]">
                        {s.browser_name}{s.browser_version ? ` ${s.browser_version}` : ""}
                      </span>
                    )}
                    {/* Processing time */}
                    {procSec && (
                      <span className="text-zinc-600 text-[10px]">{procSec}s processing</span>
                    )}
                  </div>
                  {/* File + error message preview */}
                  <div className="flex items-center gap-2">
                    {s.video_filename && (
                      <span className="text-zinc-400 font-mono text-[10px] truncate max-w-[160px]">{s.video_filename}</span>
                    )}
                    <span className="text-red-400 text-[10px] truncate flex-1">
                      {(s.error_message ?? "No error message recorded").slice(0, 120)}
                    </span>
                  </div>
                </div>
                <span className="text-zinc-600 text-[10px] shrink-0 mt-0.5">{isOpen ? "▲" : "▼"}</span>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-4 border-t border-zinc-800/60 pt-3 space-y-3">
                  {/* Full error message */}
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-1">Error Log</p>
                    <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-[11px] text-red-300 font-mono whitespace-pre-wrap break-words leading-relaxed overflow-x-auto">
                      {s.error_message ?? "No error message recorded in processing_sessions.error_message"}
                    </pre>
                  </div>
                  {/* Context grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { label: "Session ID",    value: s.id },
                      { label: "App Version",   value: s.app_version },
                      { label: "Video File",    value: s.video_filename },
                      { label: "Camera Model",  value: s.camera_model },
                      { label: "Device",        value: cameraLabel },
                      { label: "Device OS",     value: s.device_os ? `${s.device_os} ${s.device_os_version ?? ""}`.trim() : null },
                      { label: "Browser OS",    value: s.browser_os ? `${s.browser_os} ${s.browser_os_version ?? ""}`.trim() : null },
                      { label: "Browser",       value: s.browser_name ? `${s.browser_name} ${s.browser_version ?? ""}`.trim() : null },
                      { label: "Processed in",  value: procSec ? `${procSec}s` : null },
                    ].filter(r => r.value).map(r => (
                      <div key={r.label} className="bg-zinc-900 rounded-xl px-3 py-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-0.5">{r.label}</p>
                        <p className="text-zinc-300 text-[11px] font-mono break-all">{r.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Investor KPIs ─────────────────────────────────────────────────────────────

function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-600 text-[10px]">no prior data</span>;
  const color = value > 0 ? "#22c55e" : value < 0 ? "#ef4444" : "#71717a";
  const sign  = value > 0 ? "+" : "";
  return (
    <span className="text-[13px] font-black tabular-nums" style={{ color }}>
      {sign}{value}%
    </span>
  );
}

function InvestorKpiStrip({ data }: { data: DashboardData }) {
  const { growthMetrics: g, shareRate: sr, platformComparison: pc, timeToValue: tv } = data;

  const fmtSec = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

  const tiles: {
    label: string; sub: string;
    main: React.ReactNode; detail?: string; accent?: string; tooltip: string;
  }[] = [
    {
      label: "WoW Growth",
      sub: `${g.thisWeek} this week vs ${g.lastWeek} last week`,
      main: <GrowthBadge value={g.wowGrowth} />,
      accent: g.wowGrowth != null && g.wowGrowth > 0 ? "#22c55e" : "#ef4444",
      tooltip: "Week-over-Week growth in upload sessions. Compares this calendar week vs the previous 7-day window. Key early traction signal.",
    },
    {
      label: "MoM Growth",
      sub: `${g.thisMonth} this month vs ${g.lastMonth} last month`,
      main: <GrowthBadge value={g.momGrowth} />,
      accent: g.momGrowth != null && g.momGrowth > 0 ? "#22c55e" : "#ef4444",
      tooltip: "Month-over-Month growth in upload sessions. Compares this calendar month vs the previous 30-day window. Smooths out weekly noise.",
    },
    {
      label: "Share Rate",
      sub: `${sr.shareCount} shared · ${sr.saveCount} saved`,
      main: (
        <span className="text-[22px] font-black leading-none tabular-nums"
          style={{ color: sr.shareRate >= 30 ? "#22c55e" : sr.total === 0 ? "#52525b" : AMBER }}>
          {sr.total === 0 ? "—" : `${sr.shareRate}%`}
        </span>
      ),
      detail: sr.total > 0 ? `of ${sr.total} saved videos shared to social` : "no data yet",
      tooltip: "% of saved videos that were shared to social media (Instagram, etc.) vs saved locally. Measures virality and organic distribution potential.",
    },
    {
      label: "Time to Value",
      sub: tv.count > 0 ? `median across ${tv.count} sessions` : "no data yet",
      main: (
        <span className="text-[22px] font-black leading-none tabular-nums text-white">
          {tv.count === 0 ? "—" : fmtSec(tv.medianSec)}
        </span>
      ),
      detail: tv.count > 0 ? `P90: ${fmtSec(tv.p90Sec)} · from Generate click to video saved` : undefined,
      tooltip: "Median time from clicking 'Generate' to the final video being saved. Measures how fast the product delivers value. Lower is better.",
    },
    {
      label: "Mobile Success",
      sub: `${pc.mobile.total} mobile sessions`,
      main: (
        <span className="text-[22px] font-black leading-none tabular-nums"
          style={{ color: pc.mobile.successRate >= 80 ? "#22c55e" : pc.mobile.successRate >= 60 ? AMBER : "#ef4444" }}>
          {pc.mobile.total === 0 ? "—" : `${pc.mobile.successRate}%`}
        </span>
      ),
      detail: pc.desktop.total > 0 ? `Desktop: ${pc.desktop.successRate}%` : undefined,
      tooltip: "Video generation success rate on mobile browsers. Based on the browser_is_mobile flag per session. Target: above 80%.",
    },
    {
      label: "Desktop Success",
      sub: `${pc.desktop.total} desktop sessions`,
      main: (
        <span className="text-[22px] font-black leading-none tabular-nums"
          style={{ color: pc.desktop.successRate >= 80 ? "#22c55e" : pc.desktop.successRate >= 60 ? AMBER : "#ef4444" }}>
          {pc.desktop.total === 0 ? "—" : `${pc.desktop.successRate}%`}
        </span>
      ),
      detail: pc.mobile.total > 0 ? `Mobile: ${pc.mobile.successRate}%` : undefined,
      tooltip: "Video generation success rate on desktop browsers. Based on the browser_is_mobile flag per session. Desktop typically has more memory and better WebCodecs support.",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 relative">
          <div className="absolute top-3 right-3"><InfoTooltip text={t.tooltip} /></div>
          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-2 pr-5">{t.label}</p>
          <div className="mb-1">{t.main}</div>
          <p className="text-[10px] text-zinc-500 leading-tight">{t.sub}</p>
          {t.detail && <p className="text-[9px] text-zinc-700 mt-1 leading-tight">{t.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function PlatformComparisonWidget({ data: pc }: { data: DashboardData["platformComparison"] }) {
  const platforms = [
    { label: "Mobile",  icon: "📱", d: pc.mobile,  barColor: AMBER },
    { label: "Desktop", icon: "🖥️", d: pc.desktop, barColor: "#22d3ee" },
    { label: "Unknown", icon: "❓", d: pc.unknown,  barColor: "#52525b" },
  ].filter(p => p.d.total > 0);

  return (
    <Card tooltip="Success rate comparison between mobile and desktop browsers. Based on the browser_is_mobile flag on each session. 'Unknown' = sessions where the flag was not captured (older sessions or incomplete instrumentation) — check these for hidden failures.">
      <ChartTitle>Mobile vs Desktop</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-4 -mt-2">
        Success rate by platform — <span className="font-mono">browser_is_mobile</span> flag. "Unknown" = flag not captured.
      </p>
      {platforms.length === 0 ? <EmptyState label="No platform data yet" /> : (
        <div className="space-y-5">
          {platforms.map(p => (
            <div key={p.label}>
              {/* Header row */}
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 text-zinc-200 font-black text-xs">
                  <span>{p.icon}</span>{p.label}
                </span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-zinc-400">{p.d.total} sessions</span>
                  <span className="font-black tabular-nums"
                    style={{ color: p.d.successRate >= 80 ? "#22c55e" : p.d.successRate >= 60 ? AMBER : "#ef4444" }}>
                    {p.d.successRate}% success
                  </span>
                </div>
              </div>
              {/* Stacked bar */}
              <div className="h-5 bg-zinc-800 rounded-full overflow-hidden flex">
                <div className="h-full rounded-l-full transition-all"
                  style={{ width: `${p.d.successRate}%`, background: p.barColor + "90" }} />
                <div className="h-full transition-all"
                  style={{ width: `${p.d.errorRate}%`, background: "#ef444440" }} />
              </div>
              {/* Sub stats */}
              <div className="flex justify-between text-[10px] mt-1 text-zinc-600">
                <span>{p.d.success} succeeded</span>
                <span>{p.d.error} failed</span>
              </div>
            </div>
          ))}
          {/* Delta callout */}
          {pc.mobile.total > 0 && pc.desktop.total > 0 && (
            <div className="pt-3 border-t border-zinc-800/60">
              {(() => {
                const delta = pc.desktop.successRate - pc.mobile.successRate;
                const abs   = Math.abs(delta);
                if (abs < 3) return (
                  <p className="text-[11px] text-zinc-500 text-center">
                    Mobile and Desktop perform <span className="text-white font-black">equally well</span> — within {abs}%
                  </p>
                );
                const better = delta > 0 ? "Desktop" : "Mobile";
                const worse  = delta > 0 ? "Mobile"  : "Desktop";
                return (
                  <p className="text-[11px] text-zinc-500 text-center">
                    <span className="text-white font-black">{better}</span> outperforms {worse} by{" "}
                    <span className="font-black" style={{ color: AMBER }}>{abs}pp</span>
                  </p>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function GrowthTrendWidget({ data }: { data: DashboardData }) {
  const { growthMetrics: g, sessionsOverTime } = data;
  const fmtGrowth = (v: number | null) => {
    if (v === null) return { text: "No prior period", color: "#52525b" };
    if (v > 0)  return { text: `+${v}% vs prev`, color: "#22c55e" };
    if (v < 0)  return { text: `${v}% vs prev`,  color: "#ef4444" };
    return { text: "Flat vs prev", color: "#71717a" };
  };
  const wow = fmtGrowth(g.wowGrowth);
  const mom = fmtGrowth(g.momGrowth);

  return (
    <Card tooltip="Upload sessions over the last 30 days with Week-over-Week and Month-over-Month growth annotations. Use this to identify trend direction and seasonal patterns.">
      <div className="flex items-start justify-between mb-4">
        <ChartTitle>Sessions Growth</ChartTitle>
        <div className="flex items-center gap-3 text-right shrink-0 ml-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-0.5">WoW</p>
            <p className="text-sm font-black" style={{ color: wow.color }}>{wow.text}</p>
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-0.5">MoM</p>
            <p className="text-sm font-black" style={{ color: mom.color }}>{mom.text}</p>
          </div>
        </div>
      </div>
      {sessionsOverTime.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={sessionsOverTime}>
            <defs>
              <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={AMBER} stopOpacity={0.3} />
                <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 10 }} tickFormatter={(v) => v.slice(5)} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="count" stroke={AMBER} strokeWidth={2} fill="url(#growthGrad)" name="Sessions" />
          </AreaChart>
        </ResponsiveContainer>
      )}
      <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-zinc-800/60">
        {[
          { label: "This Week",  value: g.thisWeek  },
          { label: "This Month", value: g.thisMonth },
          { label: "All Time",   value: g.total     },
        ].map(s => (
          <div key={s.label} className="text-center">
            <p className="text-lg font-black text-white">{s.value}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">{s.label}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Top Locations ─────────────────────────────────────────────────────────────

function TopLocationsChart({ data, totalUploads }: { data: { name: string; value: number }[]; totalUploads: number }) {
  const withLocation = data.reduce((s, d) => s + d.value, 0);
  const noLocation   = totalUploads - withLocation;

  return (
    <Card tooltip="Activity locations extracted from GPS data — where the user was when they recorded the video. Only sessions with a resolved location are counted. Sessions without GPS location are shown separately.">
      <div className="flex items-start justify-between mb-4">
        <ChartTitle>Top Locations</ChartTitle>
        <div className="text-right text-[10px] shrink-0 ml-3">
          <p className="text-zinc-400 font-black">{withLocation} <span className="text-zinc-600 font-normal">with location</span></p>
          {noLocation > 0 && <p className="text-zinc-600">{noLocation} without location data</p>}
        </div>
      </div>
      {data.length === 0 ? <EmptyState label="No location data yet" /> : (
        <div className="space-y-2.5">
          {data.map(d => {
            const pct = Math.round((d.value / withLocation) * 100);
            return (
              <div key={d.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-zinc-300 font-medium">{d.name}</span>
                  <span className="font-black text-white tabular-nums">
                    {d.value}
                    <span className="text-zinc-600 font-normal ml-1">({pct}% of located)</span>
                  </span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500 bg-purple-500"
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Video File Size Distribution + Platform breakdown ─────────────────────────

type VideoSizeStats = NonNullable<DashboardData["videoSizeStats"]>;

// Mobile upload limits (from mobile/page.tsx)
const MOBILE_LIMITS = [
  { label: "iOS 16.4 / Android 9-",  limitMB: 500,  color: "#22c55e" },
  { label: "Android 10",              limitMB: 1024, color: "#f59e0b" },
  { label: "Android 11+",             limitMB: 1536, color: "#f97316" },
  { label: "iOS 17+",                 limitMB: 2048, color: "#ef4444" },
];

function VideoFileSizeWidget({ data }: { data: VideoSizeStats | null }) {
  if (!data || data.count === 0) {
    return (
      <Card tooltip="Every video file users attempted to process — successful uploads and early rejections combined. All platforms (desktop + mobile).">
        <ChartTitle>Video File Size — All Attempts</ChartTitle>
        <EmptyState label="No video data yet" />
      </Card>
    );
  }

  const total = data.buckets.reduce((s, b) => s + b.value, 0);

  // Reference lines: at what bar index does each mobile limit fall?
  const limitLabels: Record<string, string> = {
    "501–600 MB":  "← iOS 16.4 / Android 9- limit (500 MB)",
    "1–1.5 GB":    "← Android 10 limit (1 GB)",
    "1.5–2 GB":    "← Android 11+ limit (1.5 GB)",
    "> 2 GB":      "← iOS 17+ limit (2 GB)",
  };

  return (
    <Card tooltip="Every video file users attempted to process — successful uploads and early rejections combined. All platforms (desktop + mobile). Each bar = % of all attempts in that size range. Dashed lines show mobile upload limits.">
      <div className="flex items-start justify-between mb-5">
        <div>
          <ChartTitle>Video File Size — All Attempts</ChartTitle>
          <p className="text-[10px] text-zinc-500 -mt-3">{total} attempts · desktop + mobile · bars show % of total</p>
        </div>
        <div className="flex gap-5 shrink-0 ml-4">
          {[
            { label: "Avg",    value: data.avgMB },
            { label: "Max",    value: data.maxMB },
          ].map(s => (
            <div key={s.label} className="text-right">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">{s.label}</p>
              <p className="text-lg font-black text-amber-400">{s.value} MB</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {data.buckets.map(b => {
          const pct     = total > 0 ? Math.round((b.value / total) * 100) : 0;
          const isEmpty = b.value === 0;
          const limitNote = limitLabels[b.name];
          return (
            <div key={b.name}>
              {/* Mobile limit separator */}
              {limitNote && (
                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 border-t border-dashed border-zinc-700" />
                  <span className="text-[9px] text-zinc-600 font-mono shrink-0">{limitNote}</span>
                  <div className="h-px flex-1 border-t border-dashed border-zinc-700" />
                </div>
              )}
              {/* Bar row */}
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-zinc-400 w-28 shrink-0 text-right tabular-nums">{b.name}</span>
                <div className="flex-1 h-3 bg-zinc-800 rounded-full overflow-hidden">
                  {!isEmpty && (
                    <div className="h-full rounded-full transition-all duration-500 bg-amber-500"
                      style={{ width: `${pct === 0 && b.value > 0 ? 1 : pct}%` }} />
                  )}
                </div>
                <div className="flex items-center gap-2 w-20 shrink-0">
                  <span className={`font-black text-sm tabular-nums ${isEmpty ? "text-zinc-700" : "text-white"}`}>
                    {isEmpty ? "—" : b.value}
                  </span>
                  {!isEmpty && (
                    <span className="text-zinc-600 text-[10px] tabular-nums">({pct}%)</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile limits reference */}
      <div className="mt-4 pt-3 border-t border-zinc-800/60">
        <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-2">Mobile upload limits</p>
        <div className="flex flex-wrap gap-3">
          {MOBILE_LIMITS.map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: l.color }} />
              <span className="text-[10px] text-zinc-500">{l.label} — max {l.limitMB >= 1024 ? `${l.limitMB / 1024} GB` : `${l.limitMB} MB`}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm bg-zinc-600 shrink-0" />
            <span className="text-[10px] text-zinc-500">Desktop — no limit</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function FileSizeByPlatformWidget({ data }: { data: DashboardData["fileSizeByPlatform"] }) {
  const rows = [
    { label: "Desktop",  icon: "🖥️",  d: data.desktop, color: "#22d3ee" },
    { label: "Mobile",   icon: "📱",  d: data.mobile,  color: AMBER },
    { label: "iOS",      icon: "🍎",  d: data.iOS,     color: AMBER },
    { label: "Android",  icon: "🤖",  d: data.Android, color: "#22c55e" },
  ].filter(r => r.d.count > 0);

  const cols: { key: keyof typeof data.desktop; label: string }[] = [
    { key: "avgMB",    label: "Avg" },
    { key: "medianMB", label: "Median" },
    { key: "p90MB",    label: "P90" },
    { key: "maxMB",    label: "Max" },
  ];

  // Which mobile limits would each platform's P90 exceed?
  const limitWarning = (mb: number) => {
    if (mb > 2048) return { text: "exceeds all mobile limits", color: "#7f1d1d" };
    if (mb > 1536) return { text: "exceeds Android 11+ limit", color: "#ef4444" };
    if (mb > 1024) return { text: "exceeds Android 10 limit", color: "#f97316" };
    if (mb > 500)  return { text: "exceeds iOS 16 / Android 9 limit", color: "#f59e0b" };
    return null;
  };

  return (
    <Card tooltip="Average, median, P90 and maximum upload file size split by platform. P90 shows what 90% of users upload — if P90 is above a mobile limit, most users on that device tier will hit the size restriction.">
      <ChartTitle>Upload Size by Platform</ChartTitle>
      {rows.length === 0 ? <EmptyState label="No platform data yet" /> : (
        <>
          {/* Stats table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[360px]">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-2 pr-4 text-[10px] font-black uppercase tracking-widest text-zinc-600">Platform</th>
                  <th className="text-center py-2 px-2 text-[10px] font-black uppercase tracking-widest text-zinc-600">Sessions</th>
                  {cols.map(c => (
                    <th key={c.key} className="text-right py-2 px-2 text-[10px] font-black uppercase tracking-widest text-zinc-600">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label} className="border-b border-zinc-800/40">
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-1.5 font-black text-[12px]" style={{ color: r.color }}>
                        <span>{r.icon}</span>{r.label}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-zinc-400 font-mono text-[11px]">{r.d.count}</td>
                    {cols.map(c => (
                      <td key={c.key} className="py-2.5 px-2 text-right">
                        <span className="font-black text-white tabular-nums text-[12px]">{r.d[c.key]}</span>
                        <span className="text-zinc-600 text-[10px] ml-0.5">MB</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* P90 limit warnings */}
          {rows.filter(r => r.label === "iOS" || r.label === "Android").some(r => limitWarning(r.d.p90MB)) && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-2">P90 vs mobile limits</p>
              {rows.filter(r => r.label === "iOS" || r.label === "Android").map(r => {
                const warn = limitWarning(r.d.p90MB);
                if (!warn) return (
                  <div key={r.label} className="flex items-center gap-2 text-[10px]">
                    <span className="text-green-500 font-black">✓</span>
                    <span className="text-zinc-500">{r.label} P90 ({r.d.p90MB} MB) — within all mobile limits</span>
                  </div>
                );
                return (
                  <div key={r.label} className="flex items-center gap-2 text-[10px]">
                    <span className="font-black" style={{ color: warn.color }}>⚠</span>
                    <span className="text-zinc-400">{r.label} P90 <span className="font-black text-white">{r.d.p90MB} MB</span> — <span style={{ color: warn.color }}>{warn.text}</span></span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── File size by recording device ────────────────────────────────────────────

function FileSizeByDeviceWidget({ data }: { data: DashboardData["fileSizeByDevice"] }) {
  if (!data || data.length === 0) {
    return (
      <Card tooltip="File sizes crossed with the recording device — every attempt, all platforms.">
        <ChartTitle>File Size by Device</ChartTitle>
        <EmptyState label="No device data yet" />
      </Card>
    );
  }

  const maxCount = Math.max(...data.map(d => d.count));

  const deviceColor = (type: string | null) =>
    type === "gopro"   ? "#3b82f6"
    : type === "iphone"  ? "#f59e0b"
    : type === "android" ? "#22c55e"
    : "#52525b";

  const cols = [
    { key: "count",    label: "Attempts" },
    { key: "avgMB",    label: "Avg"      },
    { key: "medianMB", label: "Median"   },
    { key: "p90MB",    label: "P90"      },
    { key: "maxMB",    label: "Max"      },
  ] as const;

  return (
    <Card tooltip="Every video users attempted to bring to LENS — successful uploads and early rejections combined — grouped by recording device. Avg / Median / P90 / Max are in MB.">
      <ChartTitle>File Size by Device — What Users Are Trying to Edit</ChartTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left py-2 pr-4 text-[10px] font-black uppercase tracking-widest text-zinc-600">Device</th>
              <th className="text-left py-2 pr-6 text-[10px] font-black uppercase tracking-widest text-zinc-600 min-w-[100px]">Attempts</th>
              {cols.slice(1).map(c => (
                <th key={c.key} className="text-right py-2 px-2 text-[10px] font-black uppercase tracking-widest text-zinc-600">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(row => {
              const color = deviceColor(row.type);
              const barPct = Math.round((row.count / maxCount) * 100);
              return (
                <tr key={row.label} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                  <td className="py-2.5 pr-4">
                    <span className="font-black text-[12px]" style={{ color }}>{row.label}</span>
                  </td>
                  <td className="py-2.5 pr-6">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-white tabular-nums text-[12px] w-6 shrink-0">{row.count}</span>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden min-w-[60px]">
                        <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: color }} />
                      </div>
                    </div>
                  </td>
                  {(["avgMB", "medianMB", "p90MB", "maxMB"] as const).map(k => (
                    <td key={k} className="py-2.5 px-2 text-right">
                      <span className="font-black text-white tabular-nums text-[12px]">{row[k]}</span>
                      <span className="text-zinc-600 text-[10px] ml-0.5">MB</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabId = "overview" | "errors" | "video" | "gps" | "engine" | "codec";

const TABS: { id: TabId; label: string; icon: string; accent?: string }[] = [
  { id: "overview", label: "Overview",      icon: "▦" },
  { id: "errors",   label: "Errors",        icon: "⚠", accent: "#ef4444" },
  { id: "video",    label: "Video Devices", icon: "▶" },
  { id: "gps",      label: "GPS Trackers",  icon: "⊕" },
  { id: "codec",    label: "Codec / HEVC",  icon: "◈", accent: "#f97316" },
  { id: "engine",   label: "Engine",        icon: "⚙" },
];

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-8">
      <KpiCards data={data} />

      {/* ── Investor KPIs ─────────────────────────────────────────────────── */}
      <section>
        <SectionLabel accent="#a855f7">Traction — Investor View</SectionLabel>
        <InvestorKpiStrip data={data} />
      </section>

      {/* ── Hero: pipeline health strip ───────────────────────────────────── */}
      <section>
        <SectionLabel>Pipeline Health</SectionLabel>
        <PipelineHealthStrip data={data.pipelineFunnel} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <PipelineFunnelWidget      data={data.pipelineFunnel} />
          <PlatformComparisonWidget  data={data.platformComparison} />
        </div>
      </section>

      {/* ── Growth ────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Growth</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GrowthTrendWidget          data={data} />
          <SessionOutcomeOverTimeChart data={data.sessionSuccessOverTime} />
        </div>
      </section>

      {/* ── Hard errors — failed sessions only ───────────────────────────── */}
      <section>
        <SectionLabel accent={ERROR_RED}>Hard Errors — Failed Sessions</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
          Sessions that entered the pipeline and failed. Source: <span className="font-mono text-zinc-500">processing_sessions WHERE status = &apos;error&apos;</span>.
          Independent from the error_events log.
        </p>
        <FailedSessionsLog data={data.failedSessions} />
      </section>

      {/* ── Session outcomes ──────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Session Outcomes</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SessionOutcomeWidget     data={data.errorKPIs} />
          <SuccessRateByDeviceChart data={data.successByDevice} />
        </div>
      </section>

    </div>
  );
}

// ── Tab: Errors ───────────────────────────────────────────────────────────────

function ErrorsByDeviceAndSizeTable({ data }: { data: DashboardData["errorsByDeviceSize"] }) {
  if (!data || data.length === 0) return null;
  return (
    <Card>
      <ChartTitle>Errors by Device OS · File Size · Type</ChartTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              {["Device OS", "Version", "Error Type", "File Size", "Count"].map(h => (
                <th key={h} className="text-left py-2 pr-3 font-black uppercase tracking-widest whitespace-nowrap text-[10px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => {
              const errColor = r.error === "File too large"     ? "#ef4444"
                             : r.error === "H.265 not supported" ? "#f97316"
                             : r.error === "Camera not supported" ? "#8b5cf6"
                             : r.error === "GPS missing"          ? "#eab308"
                             : r.error === "Timestamp error"      ? "#3b82f6"
                             : "#71717a";
              return (
                <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                  <td className="py-2 pr-3">
                    <span className={`font-black text-xs ${r.os === "iOS" ? "text-amber-400" : "text-green-400"}`}>
                      {r.os}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-zinc-300 font-mono text-[11px]">{r.version}</td>
                  <td className="py-2 pr-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-black"
                      style={{ background: `${errColor}18`, color: errColor }}>
                      {r.error}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-zinc-400 text-[11px]">{r.size}</td>
                  <td className="py-2 font-black text-white">{r.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ErrorsTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-8">

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <ErrorKpiCards data={data.errorKPIs} />

      {/* ── Demand signals: unsupported devices ─────────────────────────────── */}
      <section>
        <SectionLabel accent="#3b82f6">Unsupported Devices — Demand Signals</SectionLabel>
        <div className="grid grid-cols-1 gap-4">
          <UnsupportedSourcesWidget data={data.unsupportedSources} />
        </div>
      </section>

      {/* ── Error type breakdown ──────────────────────────────────────────── */}
      <section>
        <SectionLabel accent={ERROR_RED}>Error Type & Source</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ErrorsByCodeChart   data={data.errorsByCode} />
          <ErrorsBySourceChart data={data.errorsBySource} />
          <ErrorsByCodecChart  data={data.errorsByCodec ?? []} />
        </div>
      </section>

      {/* ── Camera & device analysis ──────────────────────────────────────── */}
      <section>
        <SectionLabel accent="#3b82f6">Camera & Device Diagnostics</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
          Success vs error rate per camera type · Errors broken down by camera make/model · Errors by OS version.
          New structured fields populate from v1.0.31 onwards.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SuccessRateByCameraChart data={data.successRateByCamera ?? []} />
          <ErrorsByDeviceChart      data={data.errorsByDevice} />
          <ErrorsByOsVersionChart   data={data.errorsByOsVersion ?? []} />
        </div>
      </section>

      {/* ── File & format analysis ────────────────────────────────────────── */}
      <section>
        <SectionLabel accent="#f97316">File & Format Issues</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
          Distribution of file sizes that caused errors · Browser that served those errors.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ErrorsByFileSizeChart  data={data.errorsByFileSizeBucket ?? []} />
          <ErrorsByBrowserChart   data={data.errorsByBrowser ?? []} />
        </div>
      </section>

      {/* ── Timeline ─────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Error Timeline</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ErrorRateOverTimeChart     data={data.errorRateOverTime ?? []} />
          <ErrorsOverTimeChart        data={data.errorsOverTime} />
        </div>
      </section>

      {/* ── Cross-tab: device × file size × error type ───────────────────── */}
      <section>
        <SectionLabel>Device × File Size × Error Type</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
          Cross-tabulation from processing_sessions error records. Helps identify
          which hardware/size combos are consistently failing.
        </p>
        <ErrorsByDeviceAndSizeTable data={data.errorsByDeviceSize ?? []} />
      </section>

      {/* ── Full diagnostic error log ─────────────────────────────────────── */}
      <section>
        <SectionLabel accent="#22d3ee">Full Diagnostic Log</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
          Last 100 error events with all structured context: camera, file size, codec, OS, browser, RAM.
          Historical rows show "—" for columns added after the migration.
        </p>
        <RecentErrorsTable data={data.recentErrors} />
      </section>

    </div>
  );
}

// ── Tab KPI strips ────────────────────────────────────────────────────────────

function VideoKpiStrip({ data }: { data: DashboardData }) {
  const types  = data.videoDeviceTypes;
  const gopro  = types.find(d => ["Gopro","GoPro"].includes(d.name))?.value  ?? 0;
  const iphone = types.find(d => ["Iphone","iPhone"].includes(d.name))?.value ?? 0;
  const android= types.find(d => d.name === "Android")?.value                ?? 0;
  const top    = data.cameraModels[0];
  const cards = [
    { label: "Total Sessions", value: data.kpis.totalUploads,     accent: AMBER,     tooltip: "Total upload sessions across all recording devices." },
    { label: "GoPro",          value: gopro,                      accent: "#3b82f6", tooltip: "Sessions with video recorded on a GoPro action camera." },
    { label: "iPhone",         value: iphone,                     accent: AMBER,     tooltip: "Sessions with video recorded on an iPhone." },
    { label: "Android",        value: android,                    accent: "#22c55e", tooltip: "Sessions with video recorded on an Android phone." },
    { label: "Top Camera",     value: top?.name ?? "—",           accent: "#a855f7", tooltip: `Most-used camera model. Count: ${top?.value ?? 0} sessions.` },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      {cards.map(c => <KpiCard key={c.label} label={c.label} value={c.value} accent={c.accent} tooltip={c.tooltip} />)}
    </div>
  );
}

function GpsKpiStrip({ data }: { data: DashboardData }) {
  const topActivity = data.activityTypes[0];
  const topDevice   = data.gpsDevices[0];
  const cards = [
    { label: "Total KM",       value: data.contentStats.totalKm.toLocaleString(), unit: " km", accent: "#22d3ee", tooltip: "Cumulative GPS track distance across all processed sessions." },
    { label: "Elevation",      value: data.contentStats.totalElevM.toLocaleString(), unit: " m", accent: "#a855f7", tooltip: "Total elevation gain across all GPS tracks processed." },
    { label: "Activity Hours", value: data.contentStats.totalActivityH, unit: " h",  accent: "#22d3ee", tooltip: "Total duration of GPS tracks analyzed." },
    { label: "Top Activity",   value: topActivity?.name ?? "—",                      accent: AMBER,     tooltip: `Most common activity type. Count: ${topActivity?.value ?? 0} sessions.` },
    { label: "Top GPS Device", value: topDevice?.name ?? "—",                        accent: "#22c55e", tooltip: `Most-used GPS app or device. Count: ${topDevice?.value ?? 0} sessions.` },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      {cards.map(c => <KpiCard key={c.label} label={c.label} value={c.value} unit={(c as any).unit} accent={c.accent} tooltip={c.tooltip} />)}
    </div>
  );
}

function EngineKpiStrip({ data }: { data: DashboardData }) {
  const totalRenders  = data.renderStatus.reduce((s, r) => s + r.value, 0);
  const successRender = data.renderStatus.find(r => r.name === "success")?.value ?? 0;
  const renderRate    = totalRenders > 0 ? Math.round((successRender / totalRenders) * 100) : 0;
  const cards = [
    { label: "Total Renders",  value: totalRenders,                    accent: AMBER,     tooltip: "Total render jobs attempted — includes success, error, and aborted." },
    { label: "Successful",     value: successRender,                   accent: "#22c55e", tooltip: "Renders that completed successfully and produced a video file." },
    { label: "Render Rate",    value: renderRate,     unit: "%",       accent: renderRate >= 80 ? "#22c55e" : renderRate >= 60 ? AMBER : "#ef4444", tooltip: "% of render jobs that completed successfully." },
    { label: "Avg Render",     value: data.kpis.avgRenderSec, unit: "s", accent: AMBER,  tooltip: "Average render duration across successful renders. Zero-duration records excluded." },
    { label: "P90 Render",     value: data.renderPercentiles.p90, unit: "s", accent: data.renderPercentiles.p90 <= 120 ? "#22c55e" : "#ef4444", tooltip: "90th percentile render time — 90% of renders finish within this duration. SLA target: < 120s." },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      {cards.map(c => <KpiCard key={c.label} label={c.label} value={c.value} unit={(c as any).unit} accent={c.accent} tooltip={c.tooltip} />)}
    </div>
  );
}

// ── Tab: Video Devices ────────────────────────────────────────────────────────

function VideoDevicesTab({ data }: { data: DashboardData }) {
  const normalizedDeviceTypes = data.videoDeviceTypes.map(d => ({
    ...d,
    name: d.name === "Gopro"   ? "GoPro"
        : d.name === "Iphone"  ? "iPhone"
        : d.name === "Android" ? "Android"
        : d.name,
  }));

  return (
    <div className="space-y-8">
      <VideoKpiStrip data={data} />
      <section>
        <SectionLabel>Camera / Recording Device</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-3">GoPro = action camera · iPhone = Apple smartphone (iOS) · Android = non-Apple smartphone (Samsung, Google, etc.)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart
            data={normalizedDeviceTypes}
            title="Device Category"
            colors={normalizedDeviceTypes.map(d => DEVICE_COLORS[d.name] ?? "#78716c")}
          />
          <HBarChart data={data.cameraModels}     title="Camera Models" />
          <HBarChart data={data.videoDeviceMakes} title="Device Brands" color="#3b82f6" />
        </div>
      </section>

      <section>
        <SectionLabel accent="#22c55e">Mobile OS & Actions</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-3">Tracked from sessions after mobile analytics was enabled. Historical data shows null.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart
            data={data.mobileOsBreakdown ?? []}
            title="Mobile OS (iOS vs Android)"
            colors={["#f59e0b", "#22c55e", "#3b82f6"]}
          />
          <HBarChart
            data={data.osVersionBreakdown ?? []}
            title="OS Version Distribution"
            color="#22c55e"
          />
          <DonutChart
            data={data.mobileDownloadActions ?? []}
            title="Save vs Share to Instagram"
            colors={["#f59e0b", "#ee2a7b"]}
          />
          {(data.mobileDownloadActions ?? []).length > 0 && (
            <Card>
              <ChartTitle>Save vs Share — Numbers</ChartTitle>
              <div className="space-y-4 mt-2">
                {(data.mobileDownloadActions ?? []).map((item, i) => {
                  const total = (data.mobileDownloadActions ?? []).reduce((s, d) => s + d.value, 0);
                  const colors = ["#f59e0b", "#ee2a7b"];
                  const pct = total > 0 ? Math.round(item.value / total * 100) : 0;
                  return (
                    <div key={item.name}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-zinc-400 font-medium">{item.name}</span>
                        <span className="font-black text-white">{item.value} <span className="text-zinc-500 font-normal">({pct}%)</span></span>
                      </div>
                      <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[i] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </section>

      <section>
        <SectionLabel>GPS Quality by Video</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart data={data.gpsLock}        title="GPS Lock (Video)" />
          <DonutChart data={data.syncStrategies} title="Sync Strategy" />
          <VBarChart  data={data.renderDuration} title="Render Duration by Complexity" />
        </div>
      </section>
    </div>
  );
}

// ── Tab: GPS Trackers ─────────────────────────────────────────────────────────

function GpsTrackersTab({ data }: { data: DashboardData }) {
  const hasModels  = data.gpsDeviceModels.length > 0;
  return (
    <div className="space-y-8">
      <GpsKpiStrip data={data} />

      <section>
        <SectionLabel accent="#22d3ee">GPS Device & App</SectionLabel>
        {hasModels && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <HBarChart data={data.gpsDeviceModels} title="GPS Device Models" color="#22d3ee" />
            <HBarChart data={data.gpsDeviceBrands} title="Brand Breakdown" color="#a855f7" />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <HBarChart  data={data.gpsDevices}    title="GPS Apps & Devices" color="#22d3ee" />
          <DonutChart data={data.activityTypes} title="Activity Types" colors={["#f59e0b","#22d3ee","#a855f7","#22c55e","#f43f5e","#3b82f6"]} />
          <TopLocationsChart data={data.topLocations} totalUploads={data.kpis.totalUploads} />
        </div>
      </section>

      <section>
        <SectionLabel>GPX Sensor Data Quality</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <HBarChart data={data.gpxFields} title="Activity Metrics Available (Speed · HR · Cadence · Power)" color="#22c55e" />
          <DonutChart data={data.unitSystem} title="Unit System Preference" />
        </div>
      </section>
    </div>
  );
}

// ── Tab: Engine ───────────────────────────────────────────────────────────────

function EngineTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-8">
      <EngineKpiStrip data={data} />
      <section>
        <SectionLabel>Render Pipeline</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart data={data.renderStatus}   title="Render Status"    tooltip="Breakdown of render outcomes: success, error, or aborted. A high error slice signals a systemic rendering issue." />
          <VBarChart  data={data.renderDuration} title="Render Duration (Successful)"  tooltip="Distribution of render durations for successful renders only. Failed renders are excluded. Helps identify whether most renders are fast or if there's a long-tail performance problem." />
          <RenderPercentilesWidget data={data.renderPercentiles} />
        </div>
      </section>

      <section>
        <SectionLabel>Input Video &amp; Rendering Success</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <VBarChart  data={data.videoDuration}  title="Input Video Length Distribution" color="#22d3ee" tooltip="Distribution of source video durations uploaded by users. Longer videos require more memory and processing time." />
          <VBarChart  data={data.processingTime} title="Processing Time Distribution"    color="#a855f7" tooltip="Time spent extracting GPS telemetry and metadata from the video file, before rendering starts. High values may indicate large files or slow GPS parsing." />
          <SuccessRateByDeviceChart data={data.successByDevice} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <PlatformComparisonWidget data={data.platformComparison} />
          <SuccessRateByCameraChart  data={data.successRateByCamera ?? []} />
        </div>
      </section>

      <section>
        <SectionLabel>Video File Size — What Users Are Trying to Edit</SectionLabel>
        <div className="space-y-4">
          <FileSizeByDeviceWidget data={data.fileSizeByDevice} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <VideoFileSizeWidget      data={data.videoSizeStats} />
            <FileSizeByPlatformWidget data={data.fileSizeByPlatform} />
          </div>
        </div>
      </section>

      <section>
        <SectionLabel>User Behaviour</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <VBarChart  data={data.timeOnReady}    title="Time on Preview Before Recording" color="#78716c" tooltip="How long users spend on the preview screen before triggering the screen recording. Longer dwell time may indicate confusion or deliberate review of the generated route overlay." />
          <DonutChart data={data.syncStrategies} title="Sync Strategy Distribution"       tooltip="Which GPS sync method users are relying on: video-embedded GPS (GPMF from GoPro) or external GPX file upload. Affects which error types are most likely." />
          <DonutChart data={data.unitSystem}     title="Unit System (Metric vs Imperial)"  colors={[AMBER, "#3b82f6"]} tooltip="Metric (km/m) vs Imperial (miles/ft) preference across all sessions. Useful for localisation prioritisation." />
        </div>
      </section>

      <section>
        <SectionLabel>Browser & Client</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart
            data={data.browserOs.byOs}
            title="User OS Distribution"
            tooltip="Operating system distribution across all sessions. Helps prioritise platform-specific testing and compatibility work."
            colors={data.browserOs.byOs.map(d => {
              if (d.name === "Windows")   return "#3b82f6";
              if (d.name === "macOS")     return "#a855f7";
              if (d.name === "iOS")       return AMBER;
              if (d.name === "Android")   return "#22c55e";
              if (d.name === "Linux")     return "#22d3ee";
              return "#78716c";
            })}
          />
          <DonutChart
            data={data.browserOs.mobileDesktop}
            title="Mobile vs Desktop"
            colors={[AMBER, "#3b82f6"]}
            tooltip="Split between mobile (phone/tablet browser) and desktop sessions. Reflects where users are using the product and should inform UI/UX investment priorities."
          />
        </div>
      </section>
    </div>
  );
}

// ── Codec / HEVC Tab ──────────────────────────────────────────────────────────

const HEVC_ORANGE = "#f97316";
const H264_CYAN   = "#22d3ee";
const CODEC_COLORS_MAP: Record<string, string> = {
  "HEVC / H.265": HEVC_ORANGE,
  "H.264":        H264_CYAN,
  "Other":        "#52525b",
};

function CodecKpiStrip({ d }: { d: DashboardData["codecStats"] }) {
  const tiles = [
    {
      label: "Error Events with Codec Data",
      value: d.totalWithCodec.toLocaleString(),
      sub:   "error_events WHERE video_codec IS NOT NULL",
      accent: "#71717a",
    },
    {
      label: "HEVC / H.265 Events",
      value: d.hevcCount.toLocaleString(),
      sub:   `${d.hevcPct}% of codec-tagged errors`,
      accent: HEVC_ORANGE,
    },
    {
      label: "H.264 Events",
      value: d.h264Count.toLocaleString(),
      sub:   d.totalWithCodec > 0 ? `${100 - d.hevcPct}% of codec-tagged errors` : "—",
      accent: H264_CYAN,
    },
    {
      label: "Top HEVC Error",
      value: d.hevcErrorCodes[0]?.name.replace(/_/g, " ") ?? "—",
      sub:   d.hevcErrorCodes[0] ? `${d.hevcErrorCodes[0].value}× occurrences` : "no data",
      accent: "#ef4444",
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map(t => (
        <Card key={t.label} className="flex flex-col gap-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">{t.label}</p>
          <p className="text-2xl font-black tabular-nums leading-none" style={{ color: t.accent }}>{t.value}</p>
          <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{t.sub}</p>
        </Card>
      ))}
    </div>
  );
}

function CodecSplitDonut({ d }: { d: DashboardData["codecStats"] }) {
  const total = d.totalWithCodec;
  return (
    <Card tooltip="Breakdown of error events by video codec. HEVC (H.265) requires browser support or FFmpeg transcoding — it generates more failures than standard H.264.">
      <ChartTitle>Codec Distribution — Error Events</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-3 -mt-2">
        All error events where the codec could be identified.
      </p>
      {total === 0 ? <EmptyState label="No codec data in error events yet" /> : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={130} height={130}>
            <PieChart>
              <Pie data={d.codecSplit} cx="50%" cy="50%" innerRadius={36} outerRadius={58} dataKey="value" strokeWidth={0}>
                {d.codecSplit.map(entry => (
                  <Cell key={entry.name} fill={CODEC_COLORS_MAP[entry.name] ?? "#52525b"} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-3">
            {d.codecSplit.map(entry => {
              const pct = total > 0 ? Math.round(entry.value / total * 100) : 0;
              return (
                <div key={entry.name}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: CODEC_COLORS_MAP[entry.name] ?? "#52525b" }} />
                      <span className="font-mono font-black text-zinc-300">{entry.name}</span>
                    </div>
                    <span className="font-black text-white tabular-nums">{entry.value}
                      <span className="text-zinc-600 font-normal ml-1">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CODEC_COLORS_MAP[entry.name] ?? "#52525b" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function HevcByCameraChart({ d }: { d: DashboardData["codecStats"] }) {
  const CAM_ACCENT: Record<string, string> = { GoPro: "#3b82f6", iPhone: AMBER, Android: "#22c55e", Unknown: "#52525b" };
  return (
    <Card tooltip="For each camera type, how many error events came from HEVC files vs H.264 files. High HEVC on Android = users recorded in 'Efficient format' mode. iPhone HEVC is handled natively by Safari but may cause issues in other browsers.">
      <ChartTitle>HEVC vs H.264 by Camera Type</ChartTitle>
      {d.hevcByCamera.length === 0 ? <EmptyState label="No camera-codec data yet" /> : (
        <div className="space-y-4">
          {d.hevcByCamera.map(row => {
            const barMax = Math.max(...d.hevcByCamera.map(r => r.total), 1);
            return (
              <div key={row.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-black" style={{ color: CAM_ACCENT[row.name] ?? "#71717a" }}>{row.name}</span>
                  <span className="text-zinc-600 text-[10px]">{row.total} total</span>
                </div>
                <div className="flex gap-1 h-5">
                  {row.hevc > 0 && (
                    <div
                      className="h-full rounded flex items-center justify-center text-[9px] font-black text-black"
                      style={{ width: `${(row.hevc / barMax) * 100}%`, background: HEVC_ORANGE, minWidth: row.hevc > 0 ? "28px" : 0 }}
                    >
                      {row.hevc}
                    </div>
                  )}
                  {row.h264 > 0 && (
                    <div
                      className="h-full rounded flex items-center justify-center text-[9px] font-black text-black"
                      style={{ width: `${(row.h264 / barMax) * 100}%`, background: H264_CYAN, minWidth: row.h264 > 0 ? "28px" : 0 }}
                    >
                      {row.h264}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex gap-4 pt-1">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ background: HEVC_ORANGE }} /><span className="text-[10px] text-zinc-400 font-mono">HEVC / H.265</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ background: H264_CYAN }} /><span className="text-[10px] text-zinc-400 font-mono">H.264</span></div>
          </div>
        </div>
      )}
    </Card>
  );
}

function HevcByOsChart({ d }: { d: DashboardData["codecStats"] }) {
  const OS_ACCENT: Record<string, string> = { iOS: AMBER, Android: "#22c55e", macOS: "#a855f7", Windows: "#3b82f6", Linux: "#06b6d4" };
  return (
    <Card tooltip="Codec breakdown by operating system. iOS Safari supports HEVC natively — errors there may be unrelated to codec. Android Chrome may lack hardware HEVC decoding on older devices.">
      <ChartTitle>HEVC vs H.264 by OS</ChartTitle>
      {d.hevcByOs.length === 0 ? <EmptyState label="No OS-codec data yet" /> : (
        <div className="space-y-4">
          {d.hevcByOs.map(row => {
            const barMax = Math.max(...d.hevcByOs.map(r => r.total), 1);
            return (
              <div key={row.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-black" style={{ color: OS_ACCENT[row.name] ?? "#71717a" }}>{row.name}</span>
                  <span className="text-zinc-600 text-[10px]">{row.total} total</span>
                </div>
                <div className="flex gap-1 h-5">
                  {row.hevc > 0 && (
                    <div
                      className="h-full rounded flex items-center justify-center text-[9px] font-black text-black"
                      style={{ width: `${(row.hevc / barMax) * 100}%`, background: HEVC_ORANGE, minWidth: row.hevc > 0 ? "28px" : 0 }}
                    >
                      {row.hevc}
                    </div>
                  )}
                  {row.h264 > 0 && (
                    <div
                      className="h-full rounded flex items-center justify-center text-[9px] font-black text-black"
                      style={{ width: `${(row.h264 / barMax) * 100}%`, background: H264_CYAN, minWidth: row.h264 > 0 ? "28px" : 0 }}
                    >
                      {row.h264}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex gap-4 pt-1">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ background: HEVC_ORANGE }} /><span className="text-[10px] text-zinc-400 font-mono">HEVC / H.265</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ background: H264_CYAN }} /><span className="text-[10px] text-zinc-400 font-mono">H.264</span></div>
          </div>
        </div>
      )}
    </Card>
  );
}

function ResolutionChart({ d }: { d: DashboardData["codecStats"] }) {
  const total = d.resolutionBreakdown.reduce((s, r) => s + r.value, 0);
  const RES_COLORS: Record<string, string> = {
    "4K (2160p+)": "#a855f7",
    "1440p":        "#3b82f6",
    "1080p":        HEVC_ORANGE,
    "720p":         H264_CYAN,
    "< 720p":       "#52525b",
  };
  return (
    <Card tooltip="Resolution of videos that triggered errors, bucketed by height. 4K and 1440p files are more likely to be HEVC-encoded and exceed older device memory limits.">
      <ChartTitle>Resolution Breakdown</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-3 -mt-2">Bucketed by video height from error events.</p>
      {total === 0 ? <EmptyState label="No resolution data yet" /> : (
        <div className="space-y-2.5">
          {d.resolutionBreakdown.map(row => {
            const pct = total > 0 ? Math.round(row.value / total * 100) : 0;
            return (
              <div key={row.name}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="font-mono font-black text-zinc-300">{row.name}</span>
                  <span className="font-black text-white tabular-nums">{row.value}
                    <span className="text-zinc-600 font-normal ml-1">({pct}%)</span>
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: RES_COLORS[row.name] ?? "#71717a" }} />
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-zinc-600 pt-1">{total} errors with resolution data</p>
        </div>
      )}
    </Card>
  );
}

function FpsChart({ d }: { d: DashboardData["codecStats"] }) {
  const total = d.fpsBreakdown.reduce((s, r) => s + r.value, 0);
  return (
    <Card tooltip="Frame rate distribution of videos that triggered errors. 60fps and 120fps files are more likely to be HEVC-encoded (modern slow-motion modes).">
      <ChartTitle>Frame Rate Breakdown</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-3 -mt-2">FPS of videos from error events.</p>
      {total === 0 ? <EmptyState label="No FPS data yet" /> : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={d.fpsBreakdown} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} horizontal={false} />
            <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis dataKey="name" type="category" tick={{ fill: "#a1a1aa", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false} width={48} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill={HEVC_ORANGE} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function HevcErrorCodesChart({ d }: { d: DashboardData["codecStats"] }) {
  const total = d.hevcErrorCodes.reduce((s, r) => s + r.value, 0);
  return (
    <Card
      className="col-span-full"
      tooltip="Which error codes are triggered specifically by HEVC (H.265) files. WRONG_VIDEO_FORMAT = file rejected before processing. NO_GPS_VIDEO = file reached the parser but had no embedded GPS. This tells you where in the pipeline HEVC causes the most pain."
    >
      <ChartTitle>Error Codes — HEVC Files Only</ChartTitle>
      <p className="text-[10px] text-zinc-600 mb-4 -mt-2">
        Only errors from H.265 / HEVC files. Identifies which pipeline stage fails most with HEVC.
      </p>
      {total === 0 ? <EmptyState label="No HEVC error code data yet" /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {d.hevcErrorCodes.map(row => {
            const pct = total > 0 ? Math.round(row.value / total * 100) : 0;
            return (
              <div key={row.name} className="bg-zinc-800/50 border border-zinc-700/40 rounded-2xl p-4 flex flex-col gap-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{row.name.replace(/_/g, " ")}</span>
                <span className="text-xl font-black tabular-nums" style={{ color: ERROR_COLORS[row.name] ?? HEVC_ORANGE }}>{row.value}</span>
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mt-1">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ERROR_COLORS[row.name] ?? HEVC_ORANGE }} />
                </div>
                <span className="text-[10px] text-zinc-600">{pct}% of HEVC errors</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function TranscodeTimingSection({ t }: { t: DashboardData["hevcTranscodeStats"] }) {
  const fmtMs = (ms: number | null) => {
    if (ms == null) return "—";
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  };

  const maxMs = Math.max(...t.byDevice.map(d => d.avgMs), ...t.byOs.map(d => d.avgMs), 1);

  return (
    <section>
      <SectionLabel accent={HEVC_ORANGE}>Transcoding Time — HEVC → H.264</SectionLabel>
      <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
        Wall-clock duration of FFmpeg.wasm transcoding on the user's device.
        Source: <span className="font-mono text-zinc-500">HEVC_TRANSCODE_OK</span> events (success) +{" "}
        <span className="font-mono text-zinc-500">WRONG_VIDEO_FORMAT</span> with timing (failure).
        {t.totalEvents === 0 && " — No transcode timing data yet. Events are logged after the first user transcodes a HEVC video."}
      </p>

      {t.totalEvents === 0 ? (
        <EmptyState label="No transcode timing data yet — appears after the first HEVC transcoding session." />
      ) : (
        <div className="space-y-4">

          {/* ── Stat tiles ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Sessions",   value: t.totalEvents.toLocaleString(), accent: "#71717a",    sub: `${t.successCount} ok · ${t.failureCount} failed` },
              { label: "Average",    value: fmtMs(t.avgMs),                 accent: HEVC_ORANGE,  sub: "all events" },
              { label: "Median p50", value: fmtMs(t.p50Ms),                 accent: H264_CYAN,    sub: "half faster than this" },
              { label: "p90",        value: fmtMs(t.p90Ms),                 accent: "#a855f7",    sub: "90% finish by here" },
              { label: "p95",        value: fmtMs(t.p95Ms),                 accent: "#ef4444",    sub: "worst-case tail" },
              { label: "Max",        value: fmtMs(t.maxMs),                 accent: "#f43f5e",    sub: "longest recorded" },
            ].map(tile => (
              <Card key={tile.label} className="flex flex-col gap-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">{tile.label}</p>
                <p className="text-xl font-black tabular-nums leading-tight" style={{ color: tile.accent }}>{tile.value}</p>
                <p className="text-[9px] text-zinc-600 font-mono">{tile.sub}</p>
              </Card>
            ))}
          </div>

          {/* ── Time buckets ────────────────────────────────────────────────── */}
          {t.buckets.length > 0 && (
            <Card tooltip="Distribution of successful transcode durations. A long tail (> 2 min) signals that large 4K HEVC files are slow on FFmpeg.wasm — consider adding a file-size warning or recommending H.264 recording.">
              <ChartTitle>Transcode Duration Distribution</ChartTitle>
              <p className="text-[10px] text-zinc-600 mb-3 -mt-2">Successful transcodes only.</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {t.buckets.map(b => {
                  const pct = t.successCount > 0 ? Math.round(b.value / t.successCount * 100) : 0;
                  return (
                    <div key={b.name} className="bg-zinc-800/40 border border-zinc-700/30 rounded-2xl p-3 text-center">
                      <p className="text-[10px] font-mono font-black text-zinc-400 mb-1">{b.name}</p>
                      <p className="text-2xl font-black tabular-nums" style={{ color: HEVC_ORANGE }}>{b.value}</p>
                      <p className="text-[10px] text-zinc-600">{pct}%</p>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── By device + by OS ───────────────────────────────────────────── */}
          {(t.byDevice.length > 0 || t.byOs.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {t.byDevice.length > 0 && (
                <Card tooltip="Average transcoding time per camera type (successful transcodes). Android HEVC tends to be larger files; iPhone HEVC is usually skipped on real devices (Safari plays natively).">
                  <ChartTitle>Avg Transcode Time by Camera</ChartTitle>
                  <div className="space-y-3 mt-2">
                    {t.byDevice.map(d => {
                      const CAM_ACCENT: Record<string, string> = { GoPro: "#3b82f6", iPhone: AMBER, Android: "#22c55e", Unknown: "#52525b" };
                      return (
                        <div key={d.name}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-black" style={{ color: CAM_ACCENT[d.name] ?? "#71717a" }}>
                              {d.name}
                            </span>
                            <span className="text-white font-black text-[11px] tabular-nums">
                              {fmtMs(d.avgMs)}
                              <span className="text-zinc-600 font-normal ml-1">({d.count}×)</span>
                            </span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${(d.avgMs / maxMs) * 100}%`,
                              background: CAM_ACCENT[d.name] ?? "#71717a",
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {t.byOs.length > 0 && (
                <Card tooltip="Average transcoding time per operating system. Android is typically slower because FFmpeg.wasm runs on lower-end hardware. Desktop Chrome benefits from faster CPUs.">
                  <ChartTitle>Avg Transcode Time by OS</ChartTitle>
                  <div className="space-y-3 mt-2">
                    {t.byOs.map(d => {
                      const OS_ACCENT: Record<string, string> = { iOS: AMBER, Android: "#22c55e", macOS: "#a855f7", Windows: "#3b82f6", Linux: "#06b6d4" };
                      return (
                        <div key={d.name}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-black" style={{ color: OS_ACCENT[d.name] ?? "#71717a" }}>
                              {d.name}
                            </span>
                            <span className="text-white font-black text-[11px] tabular-nums">
                              {fmtMs(d.avgMs)}
                              <span className="text-zinc-600 font-normal ml-1">({d.count}×)</span>
                            </span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${(d.avgMs / maxMs) * 100}%`,
                              background: OS_ACCENT[d.name] ?? "#71717a",
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CodecTab({ data }: { data: DashboardData }) {
  const d = data.codecStats;
  return (
    <div className="space-y-8">

      {/* ── KPI strip ───────────────────────────────────────────────────────── */}
      <CodecKpiStrip d={d} />

      {/* ── Codec split + camera breakdown ──────────────────────────────────── */}
      <section>
        <SectionLabel accent={HEVC_ORANGE}>Codec Distribution</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
          HEVC vs H.264 breakdown across all error events where codec was detected.
          Data source: <span className="font-mono text-zinc-500">error_events.video_codec</span>.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CodecSplitDonut  d={d} />
          <HevcByCameraChart d={d} />
          <HevcByOsChart     d={d} />
        </div>
      </section>

      {/* ── Video specs ─────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel accent="#a855f7">Video Specs</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
          Resolution and frame rate of videos that triggered errors.
          Higher resolution / higher fps = more likely to be HEVC.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ResolutionChart d={d} />
          <FpsChart        d={d} />
        </div>
      </section>

      {/* ── HEVC error codes ────────────────────────────────────────────────── */}
      <section>
        <SectionLabel accent="#ef4444">HEVC Failure Points</SectionLabel>
        <p className="text-[10px] text-zinc-600 mb-3 -mt-4">
          Which pipeline errors are caused specifically by HEVC / H.265 files.
          Each card = one error code, count, and share of total HEVC errors.
        </p>
        <HevcErrorCodesChart d={d} />
      </section>

      {/* ── Transcode timing ────────────────────────────────────────────────── */}
      <TranscodeTimingSection t={data.hevcTranscodeStats} />

    </div>
  );
}

// ── Main export: DashboardCharts (two-column layout) ─────────────────────────

// Navbar height: py-[14px] + text-xl (~28px line-height) + border ≈ 57px
const NAV_H = "57px";

export function DashboardCharts({ data }: { data: DashboardData }) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex">

      {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
      <aside
        className="shrink-0 sticky z-40 flex flex-col border-r border-zinc-800 bg-[#050505] transition-all duration-200 overflow-hidden"
        style={{
          top:    NAV_H,
          height: `calc(100vh - ${NAV_H})`,
          width:  collapsed ? "58px" : "200px",
        }}
      >
        <div className="pt-5" />

        {/* Nav items */}
        <nav className="flex-1 flex flex-col px-2 gap-0.5 overflow-y-auto overflow-x-hidden">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            const accent   = tab.accent ?? AMBER;
            return (
              <button
                key={tab.id}
                title={tab.label}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center py-2.5 px-3 rounded-xl text-left transition-all duration-100 relative group ${
                  collapsed ? "justify-center" : "gap-3"
                } ${isActive ? "" : "hover:bg-zinc-800/50 text-zinc-600 hover:text-zinc-300"}`}
                style={isActive ? { background: `${accent}16`, color: accent } : {}}
              >
                {/* Active left indicator */}
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full transition-all"
                    style={{ background: accent }} />
                )}
                <span className="text-[17px] leading-none shrink-0">{tab.icon}</span>
                {!collapsed && (
                  <span className="text-[11px] font-black uppercase tracking-wider whitespace-nowrap overflow-hidden">
                    {tab.label}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <div className="border-t border-zinc-800/60 p-2">
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-xl text-zinc-700 hover:text-zinc-400 hover:bg-zinc-800/40 transition-all ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <span className="text-[11px] font-black leading-none">{collapsed ? "▶" : "◀"}</span>
          </button>
        </div>
      </aside>

      {/* ── Right Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">

        {/* Header */}
        <div className="px-8 pt-8 pb-5 border-b border-zinc-800/40">
          <h1 className="text-2xl font-black tracking-tight text-white mb-0.5">Engine Insights</h1>
          <p className="text-zinc-600 text-sm">Real-time analytics from all user sessions.</p>
        </div>

        {/* Tab content */}
        <div className="px-8 pb-20 pt-6">
          {activeTab === "overview" && <OverviewTab     data={data} />}
          {activeTab === "errors"   && <ErrorsTab       data={data} />}
          {activeTab === "video"    && <VideoDevicesTab data={data} />}
          {activeTab === "gps"      && <GpsTrackersTab  data={data} />}
          {activeTab === "codec"    && <CodecTab        data={data} />}
          {activeTab === "engine"   && <EngineTab       data={data} />}
        </div>

      </div>
    </div>
  );
}
