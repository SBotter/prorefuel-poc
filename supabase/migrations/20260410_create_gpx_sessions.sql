-- ============================================================
-- LENS by ProRefuel — GPX file analysis tracking
-- Purpose: analyse uploaded GPX files to improve the engine
-- ============================================================

create table if not exists public.gpx_sessions (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),

  -- Identity
  creator                   text,             -- GPS device / app (Garmin, Wahoo, Strava...)
  activity_type             text,             -- cycling, running, hiking (from <type> tag)
  activity_name             text,             -- from <name> tag
  activity_start_at         timestamptz,      -- timestamp of first point
  activity_location         text,             -- reverse-geocoded city, region

  -- File structure quality
  total_points              integer,
  avg_sample_interval_s     numeric,          -- avg seconds between consecutive points
  has_all_timestamps        boolean,          -- every point has a valid timestamp
  gap_count                 integer,          -- intervals > 30s between points
  invalid_point_count       integer,          -- points where lat=0 or lon=0

  -- Route metrics
  duration_s                numeric,
  distance_m                numeric,
  elevation_gain_m          numeric,
  elevation_loss_m          numeric,
  altitude_max_m            numeric,
  altitude_min_m            numeric,

  -- Performance data presence
  has_hr                    boolean,
  has_cadence               boolean,
  has_power                 boolean,
  has_speed                 boolean,

  -- Performance data values (when available)
  hr_avg                    numeric,
  hr_max                    numeric,
  power_avg                 numeric,
  power_max                 numeric,

  -- App context
  app_version               text
);

create index if not exists idx_gpx_sessions_created_at
  on public.gpx_sessions (created_at desc);

create index if not exists idx_gpx_sessions_creator
  on public.gpx_sessions (creator);

alter table public.gpx_sessions enable row level security;

create policy "No client access"
  on public.gpx_sessions
  for all
  to anon, authenticated
  using (false);
