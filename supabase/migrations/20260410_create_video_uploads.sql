-- ============================================================
-- LENS by ProRefuel — Video upload tracking
-- One record per video uploaded by the user.
-- Parent: processing_sessions
-- ============================================================

create table if not exists public.video_uploads (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),

  -- FK → processing_sessions (master record)
  processing_session_id     uuid references public.processing_sessions(id) on delete cascade,

  -- File identity
  filename                  text,
  file_size_bytes           bigint,
  camera_model              text,

  -- GPS presence
  has_gps                   boolean,
  gps_points_count          integer,
  gps_duration_s            numeric,
  gps_sampling_interval_ms  numeric,    -- effective interval after downsampling
  gps_start_utc             timestamptz,
  gps_end_utc               timestamptz,
  gps_video_offset_ms       integer,    -- raw GPMF value: ms from video start to first GPS sample

  -- GPS lock quality
  has_gps_lock              boolean,
  gps_lock_latency_s        numeric,    -- seconds until GPS fix was acquired
  pre_lock_points           integer,    -- points with stale/cached position (pre-fix)
  post_lock_points          integer,    -- points with real GPS position

  -- Telemetry values (post-lock only)
  speed_avg_kmh             numeric,
  speed_max_kmh             numeric,
  distance_m                numeric,

  -- Fix quality distribution
  fix_pct_no_fix            numeric,    -- % of points with fix=0 (no signal)
  fix_pct_2d                numeric,    -- % of points with fix=2
  fix_pct_3d                numeric,    -- % of points with fix=3 (best)

  -- App context
  app_version               text
);

create index if not exists idx_video_uploads_processing_session_id
  on public.video_uploads (processing_session_id);

create index if not exists idx_video_uploads_created_at
  on public.video_uploads (created_at desc);

create index if not exists idx_video_uploads_camera_model
  on public.video_uploads (camera_model);

alter table public.video_uploads enable row level security;

create policy "No client access"
  on public.video_uploads
  for all
  to anon, authenticated
  using (false);
