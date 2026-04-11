-- ============================================================
-- Fix FK hierarchy:
-- processing_sessions is the master record (one per video)
-- gpx_sessions belongs to a processing_session
-- ============================================================

-- Remove the wrong FK from processing_sessions
alter table public.processing_sessions
  drop column if exists gpx_session_id;

-- Add the correct FK on gpx_sessions → processing_sessions
alter table public.gpx_sessions
  add column if not exists processing_session_id uuid
    references public.processing_sessions(id)
    on delete cascade;

create index if not exists idx_gpx_sessions_processing_session_id
  on public.gpx_sessions (processing_session_id);
