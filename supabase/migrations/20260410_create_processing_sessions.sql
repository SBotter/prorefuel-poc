-- ============================================================
-- LENS by ProRefuel — Video processing sessions tracking
-- Run this in Supabase SQL Editor or via supabase db push
-- ============================================================

create table if not exists public.processing_sessions (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),

  -- Video metadata
  video_filename      text,
  video_duration_s    numeric,
  camera_model        text,

  -- Activity metadata
  activity_name       text,
  gpx_points_count    integer,
  gps_device          text,
  activity_location   text,

  -- Sync
  sync_strategy       text,

  -- Output
  scenes_count        integer,
  unit_system         text,

  -- Performance
  processing_time_ms  integer,

  -- Result
  status              text not null default 'success' check (status in ('success', 'error')),
  error_message       text,

  -- Context
  user_agent          text,
  app_version         text
);

-- Index for time-series queries
create index if not exists idx_processing_sessions_created_at
  on public.processing_sessions (created_at desc);

-- Index for filtering by status
create index if not exists idx_processing_sessions_status
  on public.processing_sessions (status);

-- RLS: table is insert-only from the service_role key (server-side only)
-- No client-side access needed — all writes go through /api/track
alter table public.processing_sessions enable row level security;

-- Allow the server (service_role) to insert freely (service_role bypasses RLS by default)
-- Deny all anon/authenticated access at the client level
create policy "No client access"
  on public.processing_sessions
  for all
  to anon, authenticated
  using (false);
