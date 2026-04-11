import { getAllDashboardData } from "@/lib/supabase/dashboard";
import { KpiCards, DashboardCharts } from "./components/Charts";
import { SignOutButton } from "./components/SignOutButton";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Double-check auth server-side (middleware already guards, this is a safety net)
  const cookieStore = await cookies();
  if (!cookieStore.get("lens_dash_auth")?.value) redirect("/dashboard/login");

  const data = await getAllDashboardData();

  return (
    <main className="min-h-screen bg-[#050505] text-white font-sans">
      {/* Ambient */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-amber-500/5 blur-[140px] rounded-full" />
      </div>

      {/* Navbar */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-10 py-4 backdrop-blur-xl bg-black/60 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <a href="/" className="text-xl font-black tracking-tight text-white hover:text-amber-400 transition-colors">LENS</a>
          <span className="text-zinc-700">·</span>
          <span className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Engine Dashboard</span>
        </div>
        <SignOutButton />
      </nav>

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-10 py-10">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-black tracking-tight mb-1">Engine Insights</h1>
          <p className="text-zinc-500 text-sm">Real-time data from all user sessions — use this to continuously improve LENS.</p>
        </div>

        {/* KPIs */}
        <KpiCards data={data.kpis} />

        {/* Charts */}
        <DashboardCharts data={data} />

      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-800/50 mt-16 py-6 text-center">
        <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">
          © {new Date().getFullYear()} ProRefuel.app · Internal Dashboard
        </p>
      </footer>
    </main>
  );
}
