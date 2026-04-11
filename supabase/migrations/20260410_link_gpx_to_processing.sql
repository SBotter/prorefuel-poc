-- ============================================================
-- Link gpx_sessions → processing_sessions
-- gpx_session_id on processing_sessions is the FK
-- (GPX is uploaded before the video, so the GPX record is
--  created first and its id is carried into the video session)
-- ============================================================

alter table public.processing_sessions
  add column if not exists gpx_session_id uuid
    references public.gpx_sessions(id)
    on delete set null;

create index if not exists idx_processing_sessions_gpx_session_id
  on public.processing_sessions (gpx_session_id);
