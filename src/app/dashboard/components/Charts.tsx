"use client";

import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { DashboardData } from "@/lib/supabase/dashboard";

const AMBER   = "#f59e0b";
const ZINC700 = "#3f3f46";
const ZINC600 = "#52525b";

const PIE_COLORS = [AMBER, "#78716c", "#44403c", "#a8a29e", "#d6d3d1", "#57534e"];

const tooltipStyle = {
  backgroundColor: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 12,
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-5">
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

function EmptyState() {
  return <p className="text-zinc-600 text-xs text-center py-8">No data yet</p>;
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

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function DashboardCharts({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-10">

      {/* Funnel + Sessions */}
      <section>
        <SectionTitle>Conversion & Growth</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FunnelChart data={data.funnel} />
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
          <DonutChart  data={data.gpsLock}      title="GPS Lock (Video)" />
          <HBarChart   data={data.cameraModels} title="Camera Models" />
          <DonutChart  data={data.syncStrategies} title="Sync Strategy" />
        </div>
      </section>

      {/* GPX Quality */}
      <section>
        <SectionTitle>GPX File Quality</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <HBarChart  data={data.gpxFields}      title="Performance Data in GPX" />
          <HBarChart  data={data.gpsDevices}     title="GPS Devices / Apps" />
          <DonutChart data={data.activityTypes}  title="Activity Types" />
        </div>
      </section>

      {/* User Profile */}
      <section>
        <SectionTitle>User Profile</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DonutChart data={data.unitSystem}    title="Unit System" />
          <HBarChart  data={data.topLocations}  title="Top Locations" />
        </div>
      </section>

    </div>
  );
}
