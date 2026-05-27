-- Enrich error_events with structured video + GPX metadata.
-- Enables cross-referencing codec, resolution, FPS, embedded GPS, and time overlap
-- for diagnostic analysis in the dashboard error log.

ALTER TABLE error_events
  ADD COLUMN IF NOT EXISTS video_width        integer,
  ADD COLUMN IF NOT EXISTS video_height       integer,
  ADD COLUMN IF NOT EXISTS video_fps          real,
  ADD COLUMN IF NOT EXISTS video_has_gps      boolean,
  ADD COLUMN IF NOT EXISTS video_recorded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS gpx_start_at       timestamptz,
  ADD COLUMN IF NOT EXISTS gpx_end_at         timestamptz,
  ADD COLUMN IF NOT EXISTS gpx_point_count    integer;
