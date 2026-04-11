"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

export default function DashboardLogin() {
  const [password, setPassword] = useState("");
  const [error, setError]       = useState(false);
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);

    try {
      const res = await fetch("/api/dashboard-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError(true);
        setLoading(false);
      }
    } catch {
      setError(true);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] flex items-center justify-center px-6">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-amber-500/6 blur-[140px] rounded-full" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="flex items-center gap-3 justify-center mb-10">
          <span className="text-2xl font-black tracking-tight text-white">LENS</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Dashboard</span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-8 shadow-2xl"
        >
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 mx-auto mb-6">
            <Lock size={20} className="text-amber-400" />
          </div>

          <h1 className="text-white font-black text-lg text-center mb-1">Access restricted</h1>
          <p className="text-zinc-500 text-sm text-center mb-8">Enter the dashboard password to continue.</p>

          <div className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              className={`w-full px-4 py-3.5 rounded-2xl bg-zinc-800 border text-white text-sm placeholder-zinc-600 outline-none transition-colors focus:border-amber-500/60 ${
                error ? "border-red-500/60" : "border-zinc-700"
              }`}
            />
            {error && (
              <p className="text-red-400 text-xs font-medium text-center">Incorrect password.</p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3.5 rounded-2xl bg-amber-500 text-black font-black uppercase tracking-widest text-[11px] hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Verifying..." : "Enter"}
            </button>
          </div>
        </form>

        <p className="text-center text-zinc-700 text-[10px] uppercase tracking-widest font-bold mt-8">
          © {new Date().getFullYear()} ProRefuel.app
        </p>
      </div>
    </main>
  );
}
