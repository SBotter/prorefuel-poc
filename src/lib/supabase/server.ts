import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client.
 * Uses the service_role key — NEVER import this in client components.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
