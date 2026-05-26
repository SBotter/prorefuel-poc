-- Track client-side HEVC→H.264 transcoding duration.
-- Populated for both successful transcodes (HEVC_TRANSCODE_OK events)
-- and failed transcodes (WRONG_VIDEO_FORMAT events with HEVC context).
-- Enables dashboard KPIs: avg transcode time, p90, breakdown by device/OS.

ALTER TABLE error_events
  ADD COLUMN IF NOT EXISTS hevc_transcode_ms integer;  -- wall-clock ms from FFmpeg start to completion
