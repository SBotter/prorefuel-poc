"use client";

export function SignOutButton() {
  const handleSignOut = async () => {
    await fetch("/api/dashboard-auth", { method: "DELETE" });
    window.location.href = "/dashboard/login";
  };

  return (
    <button
      onClick={handleSignOut}
      className="text-[11px] font-black uppercase tracking-widest text-zinc-600 hover:text-red-400 transition-colors"
    >
      Sign out
    </button>
  );
}
