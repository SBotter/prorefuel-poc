-- ─────────────────────────────────────────────────────────────────────────────
-- LENS · Error Diagnostics Enrichment
-- 2026-05-25
--
-- PURPOSE:
--   Current error_events rows contain a free-text error_message but almost no
--   structured context. This makes it impossible to answer questions like:
--   "Which Android version fails most?", "Is HEVC causing most rejections?",
--   "Are 2 GB GoPro files consistently failing on Android 11?"
--
--   This migration adds structured diagnostic columns so every error event
--   carries full context about the device, browser, file, and codec.
--
-- HOW TO RUN:
--   Paste this script into your Supabase SQL editor and click Run.
--   All statements use IF NOT EXISTS / OR REPLACE — safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. New columns on error_events ───────────────────────────────────────────

-- File details (from File API, available at upload time)
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
    -- Raw bytes of the video/gpx file the user tried to upload.
    -- NULL for errors that fire before a file is selected.
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS file_mime_type  TEXT;
    -- MIME type reported by the browser: 'video/mp4', 'video/quicktime', etc.

-- Video codec (detected via byte scan before processing)
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS video_codec TEXT;
    -- 'h264' | 'hevc' | 'unknown' | NULL (for GPX / pre-detection errors)
    -- Critical for diagnosing HEVC rejections on Chrome/Windows.

-- Browser / phone used to ACCESS LENS (not the recording device)
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS browser_os          TEXT;
    -- 'iOS' | 'Android' | 'Windows' | 'macOS' | 'Linux'
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS browser_os_version  TEXT;
    -- Major OS version string: '17', '16.4', '13', '14' …
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS browser_name        TEXT;
    -- 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Unknown'
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS browser_version     TEXT;
    -- Major browser version string: '125', '17.4', '124' …

-- Client hardware hints (available via browser APIs)
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS device_memory_gb REAL;
    -- navigator.deviceMemory — Android Chrome only, returns power-of-2 buckets:
    -- 0.25 / 0.5 / 1 / 2 / 4 / 8 (GB). NULL on iOS / other browsers.
    -- Key signal: helps correlate OOM / slow errors with low-RAM devices.
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS cpu_cores INTEGER;
    -- navigator.hardwareConcurrency — logical CPU count. Available cross-platform.
    -- NULL when API unavailable (rare). Low core count → slow transcoding.


-- ── 2. Performance indexes ───────────────────────────────────────────────────
-- These speed up the dashboard queries that group/filter by these columns.

CREATE INDEX IF NOT EXISTS idx_error_events_code
    ON error_events(error_code);

CREATE INDEX IF NOT EXISTS idx_error_events_created
    ON error_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_events_device_type
    ON error_events(device_type);

CREATE INDEX IF NOT EXISTS idx_error_events_browser_os
    ON error_events(browser_os);

CREATE INDEX IF NOT EXISTS idx_error_events_video_codec
    ON error_events(video_codec);

CREATE INDEX IF NOT EXISTS idx_error_events_file_size
    ON error_events(file_size_bytes);

-- Also index processing_sessions for the cross-tab queries
CREATE INDEX IF NOT EXISTS idx_processing_sessions_device_type
    ON processing_sessions(device_type);

CREATE INDEX IF NOT EXISTS idx_processing_sessions_status_device
    ON processing_sessions(status, device_type);


-- ── 3. Analysis views ────────────────────────────────────────────────────────
-- Read-only views for SQL-level analysis (Supabase Table Editor / BI tools).
-- Not required by the app — useful for ad-hoc debugging.

-- 3a. Error summary — one row per (code × device × os × codec × size bucket)
CREATE OR REPLACE VIEW v_error_summary AS
SELECT
    error_code,
    error_source,
    device_type,
    device_make,
    device_model,
    browser_os,
    browser_os_version,
    browser_name,
    video_codec,
    CASE
        WHEN file_size_bytes IS NULL              THEN 'Unknown'
        WHEN file_size_bytes <  100 * 1048576    THEN '< 100 MB'
        WHEN file_size_bytes <  300 * 1048576    THEN '100–300 MB'
        WHEN file_size_bytes < 1024 * 1048576    THEN '300 MB–1 GB'
        WHEN file_size_bytes < 1536 * 1048576    THEN '1–1.5 GB'
        ELSE '> 1.5 GB'
    END AS file_size_bucket,
    device_memory_gb,
    cpu_cores,
    COUNT(*)                                     AS error_count,
    DATE_TRUNC('day', created_at)                AS day
FROM error_events
GROUP BY
    error_code, error_source, device_type, device_make, device_model,
    browser_os, browser_os_version, browser_name, video_codec,
    file_size_bucket, device_memory_gb, cpu_cores,
    DATE_TRUNC('day', created_at)
ORDER BY day DESC, error_count DESC;

COMMENT ON VIEW v_error_summary IS
    'Aggregated error diagnostics. Use for ad-hoc analysis in SQL editor or BI.';


-- 3b. Success rate by camera type (GoPro / iPhone / Android)
CREATE OR REPLACE VIEW v_success_rate_by_camera AS
SELECT
    CASE device_type
        WHEN 'gopro'   THEN 'GoPro'
        WHEN 'iphone'  THEN 'iPhone'
        WHEN 'android' THEN 'Android'
        ELSE 'Unknown'
    END                                          AS camera_type,
    COUNT(*)                                     AS total_sessions,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
    SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) AS error_count,
    ROUND(
        100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*),
        1
    )                                            AS success_pct
FROM processing_sessions
WHERE device_type IS NOT NULL
GROUP BY device_type
ORDER BY total_sessions DESC;

COMMENT ON VIEW v_success_rate_by_camera IS
    'Success vs error rate grouped by camera/recording device type.';


-- 3c. HEVC rejection rate — how many HEVC videos fail vs succeed
CREATE OR REPLACE VIEW v_codec_error_rate AS
SELECT
    video_codec,
    browser_os,
    browser_name,
    COUNT(*)                                     AS error_count,
    -- Compare to total sessions with that codec (requires processing_sessions join)
    -- Use this view for error-only analysis; success comes from processing_sessions
    MIN(file_size_bytes) / 1048576.0             AS min_size_mb,
    MAX(file_size_bytes) / 1048576.0             AS max_size_mb,
    AVG(file_size_bytes) / 1048576.0             AS avg_size_mb
FROM error_events
WHERE video_codec IS NOT NULL
GROUP BY video_codec, browser_os, browser_name
ORDER BY error_count DESC;

COMMENT ON VIEW v_codec_error_rate IS
    'Error counts grouped by video codec, OS, and browser. Diagnose HEVC issues.';


-- ── 4. Useful diagnostic queries (run these manually in SQL editor) ──────────
-- Not executed automatically — copy-paste when you need to investigate.

/*
-- Q1: What are the most common errors in the last 7 days?
SELECT error_code, device_type, browser_os, video_codec, COUNT(*) as n
FROM error_events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1,2,3,4
ORDER BY n DESC
LIMIT 20;

-- Q2: Are large GoPro files (> 1 GB) failing more than small ones?
SELECT
  CASE WHEN file_size_bytes > 1073741824 THEN '> 1 GB' ELSE '<= 1 GB' END as size_group,
  error_code, COUNT(*) as n
FROM error_events
WHERE device_type = 'gopro'
GROUP BY 1,2
ORDER BY n DESC;

-- Q3: Which Android versions have the most errors?
SELECT browser_os_version, error_code, COUNT(*) as n
FROM error_events
WHERE browser_os = 'Android'
GROUP BY 1,2
ORDER BY n DESC;

-- Q4: HEVC rejection by browser
SELECT browser_name, browser_os, COUNT(*) as hevc_errors
FROM error_events
WHERE video_codec = 'hevc' AND error_code = 'WRONG_VIDEO_FORMAT'
GROUP BY 1,2
ORDER BY hevc_errors DESC;

-- Q5: Success rate by OS version (from processing_sessions)
SELECT device_os, device_os_version,
       COUNT(*) total,
       SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success,
       ROUND(100.0 * SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) / COUNT(*), 1) pct
FROM processing_sessions
WHERE device_os IS NOT NULL AND device_os_version IS NOT NULL
GROUP BY 1,2
ORDER BY total DESC;
*/
