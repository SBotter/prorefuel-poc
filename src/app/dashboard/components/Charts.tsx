"use client";

import { useState } from "react";
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

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-zinc-900 border border-zinc-800 rounded-3xl p-6 ${className}`}>{children}</div>;
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

// ── Chart primitives ──────────────────────────────────────────────────────────

function DonutChart({ data, title, colors }: { data: { name: string; value: number }[]; title: string; colors?: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const c = colors ?? PIE_COLORS;
  return (
    <Card>
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

function HBarChart({ data, title, color = AMBER }: { data: { name: string; value: number }[]; title: string; color?: string }) {
  return (
    <Card>
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

function VBarChart({ data, title, color = AMBER }: { data: { name: string; value: number }[]; title: string; color?: string }) {
  return (
    <Card>
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

export function KpiCards({ data }: { data: DashboardData["kpis"] }) {
  const cards = [
    { label: "Total Uploads",     value: data.totalUploads,   unit: "" },
    { label: "Videos Downloaded", value: data.totalDownloads, unit: "" },
    { label: "Conversion Rate",   value: data.conversionRate, unit: "%" },
    { label: "Avg Render Time",   value: data.avgRenderSec,   unit: "s" },
    { label: "Avg Process Time",  value: data.avgProcessSec,  unit: "s" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      {cards.map((c) => (
        <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">{c.label}</p>
          <p className="text-3xl font-black text-white">
            {c.value}<span className="text-amber-500 text-lg">{c.unit}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Sessions Over Time ────────────────────────────────────────────────────────

function SessionsChart({ data }: { data: DashboardData["sessionsOverTime"] }) {
  return (
    <Card>
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
    <Card>
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

function FunnelChart({ data }: { data: DashboardData["funnel"] }) {
  const max = data[0]?.value || 1;
  return (
    <Card>
      <ChartTitle>Conversion Funnel</ChartTitle>
      {data.every((d) => d.value === 0) ? <EmptyState /> : (
        <div className="space-y-4">
          {data.map((step, i) => {
            const pct = Math.round((step.value / max) * 100);
            const colors = [AMBER, "#d97706", "#92400e"];
            return (
              <div key={step.name}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-zinc-400 font-medium">{step.name}</span>
                  <span className="text-white font-black">{step.value} <span className="text-zinc-500">({pct}%)</span></span>
                </div>
                <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: colors[i] }} />
                </div>
              </div>
            );
          })}
        </div>
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
    <Card>
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
    { label: "Total Errors",      value: data.totalErrors,     unit: "",  color: "text-red-400",    border: "border-red-900/40" },
    { label: "Last 7 Days",       value: data.errorsLast7d,    unit: "",  color: "text-orange-400", border: "border-orange-900/40" },
    { label: "Last 24h",          value: data.errorsLast24h,   unit: "",  color: "text-yellow-400", border: "border-yellow-900/30" },
    { label: "Success Rate",      value: data.successRate,     unit: "%", color: "text-amber-400",  border: "border-amber-900/40" },
    { label: "Error Rate",        value: data.errorSessionRate,unit: "%", color: "text-red-400",    border: "border-red-900/40" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      {cards.map((c) => (
        <div key={c.label} className={`bg-zinc-900 border ${c.border} rounded-2xl px-5 py-4`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">{c.label}</p>
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
    <Card>
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
    <Card>
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
    <Card>
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

// ── Errors Over Time ──────────────────────────────────────────────────────────

function ErrorsOverTimeChart({ data }: { data: DashboardData["errorsOverTime"] }) {
  return (
    <Card>
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

function RecentErrorsTable({ data }: { data: DashboardData["recentErrors"] }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <ChartTitle>Recent Error Events</ChartTitle>
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">{data.length} shown</span>
      </div>
      {data.length === 0 ? <EmptyState /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                {["Date", "Code", "Source", "v", "Message / Device"].map(h => (
                  <th key={h} className="text-left py-2 pr-3 font-black uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((e, i) => {
                const deviceMatch = e.message.match(/Device:\s*"([^"]+)"/);
                const cameraMatch = e.message.match(/Unsupported camera:\s*"([^"]+)"/);
                const deviceHint  = deviceMatch?.[1] ?? cameraMatch?.[1] ?? null;
                const cleanMsg    = e.message.replace(/\s*Device:\s*"[^"]+"\./g, "").replace(/\s*File:\s*"[^"]+"\./g, "");
                return (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                    <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap font-mono text-[10px]">
                      {new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                      <span className="text-zinc-700">{new Date(e.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide whitespace-nowrap"
                        style={{ background: `${ERROR_COLORS[e.code] ?? ERROR_RED}20`, color: ERROR_COLORS[e.code] ?? ERROR_RED }}>
                        {e.code}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black capitalize whitespace-nowrap"
                        style={{ background: `${SOURCE_COLORS[e.source] ?? "#52525b"}20`, color: SOURCE_COLORS[e.source] ?? "#71717a" }}>
                        {e.source.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-zinc-600 font-mono text-[10px] whitespace-nowrap">{e.version || "—"}</td>
                    <td className="py-2 max-w-sm">
                      {deviceHint && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-[10px] font-black mr-2 whitespace-nowrap">{deviceHint}</span>
                      )}
                      <span className="text-zinc-400 text-[11px] break-all">{cleanMsg}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabId = "overview" | "errors" | "video" | "gps" | "engine";

const TABS: { id: TabId; label: string; icon: string; accent?: string }[] = [
  { id: "overview", label: "Overview",      icon: "▦" },
  { id: "errors",   label: "Errors",        icon: "⚠", accent: "#ef4444" },
  { id: "video",    label: "Video Devices", icon: "▶" },
  { id: "gps",      label: "GPS Trackers",  icon: "⊕" },
  { id: "engine",   label: "Engine",        icon: "⚙" },
];

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>Growth & Conversions</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SessionsChart            data={data.sessionsOverTime} />
          <SessionOutcomeOverTimeChart data={data.sessionSuccessOverTime} />
        </div>
      </section>
      <section>
        <SectionLabel>Conversion Funnel</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FunnelChart data={data.funnel} />
          <SessionOutcomeWidget data={data.errorKPIs} />
        </div>
      </section>
    </div>
  );
}

// ── Tab: Errors ───────────────────────────────────────────────────────────────

function ErrorsTab({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-6">
      <ErrorKpiCards data={data.errorKPIs} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ErrorsByCodeChart   data={data.errorsByCode} />
        <ErrorsBySourceChart data={data.errorsBySource} />
        <ErrorsByDeviceChart data={data.errorsByDevice} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ErrorsOverTimeChart        data={data.errorsOverTime} />
        <SessionOutcomeOverTimeChart data={data.sessionSuccessOverTime} />
      </div>
      <RecentErrorsTable data={data.recentErrors} />
    </div>
  );
}

// ── Tab: Video Devices ────────────────────────────────────────────────────────

function VideoDevicesTab({ data }: { data: DashboardData }) {
  // Device type with distinct colors
  const deviceTypeColors = data.videoDeviceTypes.map(d => DEVICE_COLORS[d.name] ?? PIE_COLORS[0]);

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>Camera / Recording Device</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart
            data={data.videoDeviceTypes}
            title="Device Type (GoPro / iPhone / Android)"
            colors={data.videoDeviceTypes.map(d => DEVICE_COLORS[d.name] ?? "#78716c")}
          />
          <HBarChart data={data.cameraModels}     title="Camera Models" />
          <HBarChart data={data.videoDeviceMakes} title="Device Brands" color="#3b82f6" />
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
          <HBarChart  data={data.topLocations}  title="Top Locations" color="#a855f7" />
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
      <section>
        <SectionLabel>Render Pipeline</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart data={data.renderStatus}   title="Render Status" />
          <VBarChart  data={data.renderDuration} title="Render Duration" />
          <VBarChart  data={data.processingTime} title="Processing Time" color="#22d3ee" />
        </div>
      </section>

      <section>
        <SectionLabel>User Behaviour</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <VBarChart  data={data.timeOnReady}    title="Time on Preview Before Recording" color="#78716c" />
          <DonutChart data={data.syncStrategies} title="Sync Strategy Distribution" />
          <FunnelChart data={data.funnel} />
        </div>
      </section>

      <section>
        <SectionLabel>Browser & Client</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart
            data={data.browserOs.byOs}
            title="User OS Distribution"
            colors={["#3b82f6","#a855f7","#f59e0b","#22c55e","#78716c"]}
          />
          <DonutChart
            data={data.browserOs.mobileDesktop}
            title="Mobile vs Desktop"
            colors={[AMBER, "#3b82f6"]}
          />
        </div>
      </section>
    </div>
  );
}

// ── Main export: DashboardTabs ────────────────────────────────────────────────

export function DashboardCharts({ data }: { data: DashboardData }) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <div>
      {/* Tab navigation */}
      <div className="flex flex-wrap gap-2 mb-8 border-b border-zinc-800 pb-4">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-black uppercase tracking-wider transition-all"
              style={{
                background:  isActive ? (tab.accent ? `${tab.accent}18` : "#f59e0b18") : "transparent",
                color:       isActive ? (tab.accent ?? AMBER) : "#71717a",
                border:      isActive ? `1px solid ${tab.accent ? `${tab.accent}40` : "#f59e0b40"}` : "1px solid transparent",
              }}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab  data={data} />}
      {activeTab === "errors"   && <ErrorsTab    data={data} />}
      {activeTab === "video"    && <VideoDevicesTab   data={data} />}
      {activeTab === "gps"      && <GpsTrackersTab    data={data} />}
      {activeTab === "engine"   && <EngineTab    data={data} />}
    </div>
  );
}
