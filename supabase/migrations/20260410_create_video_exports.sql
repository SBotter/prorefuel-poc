-- ============================================================
-- LENS by ProRefuel — Video export tracking
-- One record per video creation attempt.
-- Parent: processing_sessions
-- ============================================================

create table if not exists public.video_exports (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),

  -- FK → processing_sessions (master record)
  processing_session_id uuid references public.processing_sessions(id) on delete cascade,

  -- Funnel
  reached_experience    boolean not null default false,  -- user entered the EXPERIENCE step
  clicked_record        boolean not null default false,  -- recording was triggered
  completed_download    boolean not null default false,  -- file was downloaded

  -- User timing
  time_on_ready_ms      integer,   -- how long user spent on READY before clicking Generate
  time_to_download_ms   integer,   -- from entering EXPERIENCE to download completing

  -- Engine performance
  render_duration_ms    integer,   -- wall-clock time of the FFmpeg render
  render_status         text check (render_status in ('success', 'error', 'fallback')),
  error_message         text,      -- if render failed

  -- Output details
  output_format         text,      -- 'mp4' | 'webm' (fallback)
  output_size_bytes     bigint,
  output_duration_s     numeric,

  -- App context
  app_version           text
);

create index if not exists idx_video_exports_processing_session_id
  on public.video_exports (processing_session_id);

create index if not exists idx_video_exports_created_at
  on public.video_exports (created_at desc);

alter table public.video_exports enable row level security;

create policy "No client access"
  on public.video_exports
  for all
  to anon, authenticated
  using (false);
