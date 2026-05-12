"use client";

import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { DashboardData } from "@/lib/supabase/dashboard";

const AMBER   = "#f59e0b";
const ZINC700 = "#3f3f46";

const PIE_COLORS = [AMBER, "#78716c", "#44403c", "#a8a29e", "#d6d3d1", "#57534e"];

const tooltipStyle = {
  backgroundColor: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 12,
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
};

function SectionTitle({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <h2 className={`text-[11px] font-black uppercase tracking-widest mb-5 ${accent ? "text-red-500" : "text-zinc-500"}`}>
      {children}
    </h2>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-3xl p-6 ${className}`}>
      {children}
    </div>
  );
}

function ChartTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-white font-black text-sm mb-4">{children}</p>;
}

function EmptyState({ label = "No data yet" }: { label?: string }) {
  return <p className="text-zinc-600 text-xs text-center py-8">{label}</p>;
}

// ── KPI Cards ────────────────────────────────────────────────────────────────

export function KpiCards({ data }: { data: DashboardData["kpis"] }) {
  const cards = [
    { label: "Total Uploads",     value: data.totalUploads,   unit: "" },
    { label: "Videos Downloaded", value: data.totalDownloads, unit: "" },
    { label: "Conversion Rate",   value: data.conversionRate, unit: "%" },
    { label: "Avg Render Time",   value: data.avgRenderSec,   unit: "s" },
    { label: "Avg Process Time",  value: data.avgProcessSec,  unit: "s" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
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

export function SessionsChart({ data }: { data: DashboardData["sessionsOverTime"] }) {
  return (
    <Card>
      <ChartTitle>Sessions — Last 30 Days</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="amber" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={AMBER} stopOpacity={0.3} />
                <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="count" stroke={AMBER} strokeWidth={2} fill="url(#amber)" name="Sessions" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Funnel ────────────────────────────────────────────────────────────────────

export function FunnelChart({ data }: { data: DashboardData["funnel"] }) {
  const max = data[0]?.value || 1;
  return (
    <Card>
      <ChartTitle>Conversion Funnel</ChartTitle>
      {data.every((d) => d.value === 0) ? <EmptyState /> : (
        <div className="space-y-3">
          {data.map((step, i) => {
            const pct = Math.round((step.value / max) * 100);
            return (
              <div key={step.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-400 font-medium">{step.name}</span>
                  <span className="text-white font-black">{step.value} <span className="text-zinc-500">({pct}%)</span></span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: i === 0 ? AMBER : i === 1 ? "#d97706" : "#92400e" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Donut ─────────────────────────────────────────────────────────────────────

function DonutChart({ data, title }: { data: { name: string; value: number }[]; title: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card>
      <ChartTitle>{title}</ChartTitle>
      {total === 0 ? <EmptyState /> : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={130} height={130}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={38} outerRadius={58} dataKey="value" strokeWidth={0}>
                {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {data.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="text-zinc-400 text-[11px]">{d.name}</span>
                </div>
                <span className="text-white text-[11px] font-black">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Horizontal Bar ────────────────────────────────────────────────────────────

function HBarChart({ data, title }: { data: { name: string; value: number }[]; title: string }) {
  return (
    <Card>
      <ChartTitle>{title}</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} horizontal={false} />
            <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 11 }} tickLine={false} axisLine={false} width={100} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill={AMBER} radius={[0, 6, 6, 0]} name="Count" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Vertical Bar ──────────────────────────────────────────────────────────────

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

// ── Error colors ──────────────────────────────────────────────────────────────

const ERROR_RED = "#ef4444";
const ERROR_COLORS: Record<string, string> = {
  NO_GPS_VIDEO:       "#ef4444",
  GPS_WEAK:           "#f97316",
  VIDEO_GPX_MISMATCH: "#eab308",
  NO_SCENES:          "#a855f7",
  WRONG_VIDEO_FORMAT: "#3b82f6",
  WRONG_GPX_FORMAT:   "#06b6d4",
  NO_GPS_TRACK:       "#14b8a6",
  UNSUPPORTED_CAMERA: "#8b5cf6",
  RENDER_OOM:         "#ec4899",
  RENDER_FAILED:      "#f43f5e",
  WORKER_ERROR:       "#78716c",
};

const SOURCE_COLORS: Record<string, string> = {
  video_upload: "#3b82f6",
  gpx_upload:   "#14b8a6",
  render:       "#ec4899",
  worker:       "#78716c",
  unknown:      "#52525b",
};

// ── Session Outcome Widget ────────────────────────────────────────────────────

export function SessionOutcomeWidget({ data }: { data: DashboardData["errorKPIs"] }) {
  const donutData = [
    { name: "Success", value: data.successCount },
    { name: "Error",   value: data.errorCount },
  ];
  const DONUT_COLORS = [AMBER, "#ef4444"];

  return (
    <Card className="border-zinc-800">
      <ChartTitle>Session Outcomes — All Time</ChartTitle>
      {data.totalSessions === 0 ? <EmptyState label="No sessions recorded yet" /> : (
        <div className="flex flex-col sm:flex-row items-center gap-8">

          {/* Donut + center label */}
          <div className="relative shrink-0">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%" cy="50%"
                  innerRadius={56} outerRadius={80}
                  dataKey="value"
                  strokeWidth={0}
                  startAngle={90}
                  endAngle={-270}
                >
                  {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            {/* Center overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black text-amber-400">{data.successRate}%</span>
              <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">success</span>
            </div>
          </div>

          {/* Stats */}
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
            <div className="bg-zinc-800/60 rounded-2xl px-5 py-4 border border-amber-500/20">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Generated Video</p>
              <p className="text-4xl font-black text-amber-400">{data.successCount}</p>
              <p className="text-xs text-zinc-500 mt-1">{data.successRate}% of all sessions</p>
            </div>
            <div className="bg-zinc-800/60 rounded-2xl px-5 py-4 border border-red-500/20">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Failed</p>
              <p className="text-4xl font-black text-red-400">{data.errorCount}</p>
              <p className="text-xs text-zinc-500 mt-1">{data.errorSessionRate}% of all sessions</p>
            </div>

            {/* Progress bar */}
            <div className="sm:col-span-2">
              <div className="flex justify-between text-[11px] mb-1.5">
                <span className="text-amber-400 font-black">Success {data.successRate}%</span>
                <span className="text-red-400 font-black">Error {data.errorSessionRate}%</span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-amber-400 transition-all rounded-l-full"
                  style={{ width: `${data.successRate}%` }}
                />
                <div
                  className="h-full bg-red-500 transition-all rounded-r-full"
                  style={{ width: `${data.errorSessionRate}%` }}
                />
              </div>
              <p className="text-[10px] text-zinc-600 mt-1.5">{data.totalSessions} total sessions recorded</p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Error KPI Cards ───────────────────────────────────────────────────────────

export function ErrorKpiCards({ data }: { data: DashboardData["errorKPIs"] }) {
  const cards = [
    { label: "Total Error Events", value: data.totalErrors,      unit: "",  color: "text-red-400",    border: "border-red-900/40" },
    { label: "Errors — Last 7d",   value: data.errorsLast7d,     unit: "",  color: "text-orange-400", border: "border-orange-900/40" },
    { label: "Errors — Last 24h",  value: data.errorsLast24h,    unit: "",  color: "text-yellow-400", border: "border-yellow-900/30" },
    { label: "Session Success",    value: data.successRate,       unit: "%", color: "text-amber-400",  border: "border-amber-900/40" },
    { label: "Session Error Rate", value: data.errorSessionRate,  unit: "%", color: "text-red-400",    border: "border-red-900/40" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      {cards.map((c) => (
        <div key={c.label} className={`bg-zinc-900 border ${c.border} rounded-2xl px-5 py-4`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">{c.label}</p>
          <p className={`text-3xl font-black ${c.color}`}>
            {c.value}<span className="text-lg">{c.unit}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Errors by Code ────────────────────────────────────────────────────────────

export function ErrorsByCodeChart({ data }: { data: DashboardData["errorsByCode"] }) {
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
                    {entry.value}
                    <span className="text-zinc-500 font-normal ml-1">({pct}%)</span>
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

export function ErrorsBySourceChart({ data }: { data: DashboardData["errorsBySource"] }) {
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
                  {d.value}
                  <span className="text-zinc-600 font-normal ml-1">({total > 0 ? Math.round(d.value / total * 100) : 0}%)</span>
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

export function ErrorsByDeviceChart({ data }: { data: DashboardData["errorsByDevice"] }) {
  return (
    <Card>
      <ChartTitle>Errors by Device / App</ChartTitle>
      {data.length === 0
        ? <EmptyState label="No device data yet — errors with device info will appear here" />
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

export function ErrorsOverTimeChart({ data }: { data: DashboardData["errorsOverTime"] }) {
  return (
    <Card>
      <ChartTitle>Error Events — Last 30 Days</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={ERROR_RED} stopOpacity={0.25} />
                <stop offset="95%" stopColor={ERROR_RED} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fill: "#71717a", fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="count" stroke={ERROR_RED} fill="url(#errorGrad)" strokeWidth={2} name="Errors" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Sessions Success/Error Over Time ──────────────────────────────────────────

export function SessionOutcomeOverTimeChart({ data }: { data: DashboardData["sessionSuccessOverTime"] }) {
  return (
    <Card>
      <ChartTitle>Sessions: Success vs Error — Last 30 Days</ChartTitle>
      {data.length === 0 ? <EmptyState /> : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={AMBER} stopOpacity={0.3} />
                <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="errorGrad2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={ERROR_RED} stopOpacity={0.3} />
                <stop offset="95%" stopColor={ERROR_RED} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={ZINC700} />
            <XAxis dataKey="day" tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fill: "#71717a", fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
            <Area type="monotone" dataKey="success" stroke={AMBER}     fill="url(#successGrad)" strokeWidth={2} name="Success" />
            <Area type="monotone" dataKey="error"   stroke={ERROR_RED} fill="url(#errorGrad2)"  strokeWidth={2} name="Error"   />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Recent Errors Table ───────────────────────────────────────────────────────

export function RecentErrorsTable({ data }: { data: DashboardData["recentErrors"] }) {
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
                <th className="text-left py-2 pr-3 font-black uppercase tracking-widest whitespace-nowrap">Date</th>
                <th className="text-left py-2 pr-3 font-black uppercase tracking-widest">Code</th>
                <th className="text-left py-2 pr-3 font-black uppercase tracking-widest">Source</th>
                <th className="text-left py-2 pr-3 font-black uppercase tracking-widest">v</th>
                <th className="text-left py-2 font-black uppercase tracking-widest">Message / Device</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e, i) => {
                // Extract device hint from message for display
                const deviceMatch  = e.message.match(/Device:\s*"([^"]+)"/);
                const cameraMatch  = e.message.match(/Unsupported camera:\s*"([^"]+)"/);
                const deviceHint   = deviceMatch?.[1] ?? cameraMatch?.[1] ?? null;
                // Strip device/camera suffix for cleaner message display
                const cleanMessage = e.message
                  .replace(/\s*Device:\s*"[^"]+"\./g, "")
                  .replace(/\s*File:\s*"[^"]+"\./g, "");

                return (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors group">
                    <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap font-mono text-[10px]">
                      {new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" "}
                      <span className="text-zinc-700">
                        {new Date(e.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide whitespace-nowrap"
                        style={{ background: `${ERROR_COLORS[e.code] ?? ERROR_RED}20`, color: ERROR_COLORS[e.code] ?? ERROR_RED }}
                      >
                        {e.code}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-black capitalize whitespace-nowrap"
                        style={{ background: `${SOURCE_COLORS[e.source] ?? "#52525b"}20`, color: SOURCE_COLORS[e.source] ?? "#71717a" }}
                      >
                        {e.source.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-zinc-600 font-mono text-[10px] whitespace-nowrap">
                      {e.version || "—"}
                    </td>
                    <td className="py-2 max-w-sm">
                      {deviceHint && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-[10px] font-black mr-2 whitespace-nowrap">
                          {deviceHint}
                        </span>
                      )}
                      <span className="text-zinc-400 text-[11px] break-all">{cleanMessage}</span>
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

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function DashboardCharts({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-10">

      {/* Error Analytics — promoted to top */}
      <section>
        <SectionTitle accent>Error Intelligence</SectionTitle>

        {/* Hero: success vs error rate */}
        <div className="mb-4">
          <SessionOutcomeWidget data={data.errorKPIs} />
        </div>

        {/* Error KPIs */}
        <ErrorKpiCards data={data.errorKPIs} />

        {/* Three-column: type + source + device */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <ErrorsByCodeChart   data={data.errorsByCode} />
          <ErrorsBySourceChart data={data.errorsBySource} />
          <ErrorsByDeviceChart data={data.errorsByDevice} />
        </div>

        {/* Two-column: error trend + success/error trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <ErrorsOverTimeChart        data={data.errorsOverTime} />
          <SessionOutcomeOverTimeChart data={data.sessionSuccessOverTime} />
        </div>

        {/* Full-width errors table */}
        <RecentErrorsTable data={data.recentErrors} />
      </section>

      {/* Conversion & Growth */}
      <section>
        <SectionTitle>Conversion & Growth</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FunnelChart   data={data.funnel} />
          <SessionsChart data={data.sessionsOverTime} />
        </div>
      </section>

      {/* Engine Performance */}
      <section>
        <SectionTitle>Engine Performance</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart data={data.renderStatus}   title="Render Status" />
          <VBarChart  data={data.renderDuration} title="Render Duration" />
          <VBarChart  data={data.timeOnReady}    title="Time on Preview Before Recording" color="#78716c" />
        </div>
      </section>

      {/* Video GPS Quality */}
      <section>
        <SectionTitle>Video GPS Quality</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart data={data.gpsLock}       title="GPS Lock (Video)" />
          <HBarChart  data={data.cameraModels}  title="Camera Models" />
          <DonutChart data={data.syncStrategies} title="Sync Strategy" />
        </div>
      </section>

      {/* GPX Quality */}
      <section>
        <SectionTitle>GPX File Quality</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <HBarChart  data={data.gpxFields}     title="Performance Data in GPX" />
          <HBarChart  data={data.gpsDevices}    title="GPS Devices / Apps" />
          <DonutChart data={data.activityTypes} title="Activity Types" />
        </div>
      </section>

      {/* User Profile */}
      <section>
        <SectionTitle>User Profile</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart data={data.unitSystem}   title="Unit System" />
          <HBarChart  data={data.topLocations} title="Top Locations" />
        </div>
      </section>

    </div>
  );
}
