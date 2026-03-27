# ProRefuel POC - Coding Standards & Instructions

You are an expert Next.js 15+, TypeScript, and Tailwind CSS developer.
Your goal is to build a high-performance video telemetry synchronization engine.

## 1. Tech Stack & Architecture

- **Framework:** Next.js (App Router).
- **Runtime:** Node.js (Required for ExifTool/Filesystem operations).
- **Maps:** Mapbox GL JS (Client-side rendering).
- **Metadata:** ExifTool (via `exiftool-vendored`) + `gopro-telemetry`.
- **Styling:** Tailwind CSS.

## 2. Core Coding Rules

- **Server vs Client:** - Use `"use client"` ONLY for components that need Mapbox, Hooks, or Browser APIs.
  - Heavy video processing (ExifTool) MUST happen in API Routes (`src/app/api/...`).
- **File Imports:** Always use the `@/*` alias (e.g., `@/lib/media/...`).
- **Types:** Strictly type all GPS data. Use `interface Point { lat: number; lon: number; ele: number; time: number; }`.
- **Performance:** Avoid unnecessary re-renders in the Map component. Use `useRef` for the Mapbox instance.

## 3. Specific Engine Logic (ProRefuel)

- **GPX Extraction:** Use `exiftool` with `-p lib/media/gpx.fmt -ee3` to extract telemetry from MP4.
- **Elevation Trigger:** The "High Point" is defined as the segment with the highest elevation gain (`ele` difference) in the video GPX.
- **Synchronization:** Sync Activity GPX and Video GPX using `timestamp` (UTC).
- **Map Speed:** The default playback speed for the map navigation is 8x.

## 4. UI/UX Requirements

- Mobile-first (9:16 aspect ratio simulation).
- Cinematic transitions: Use Tailwind's `transition-opacity` and `duration-1000` for Fades between Map and Video.
- Final Screen: Must display "Developed by ProRefuel.app" with an amber/orange-500 theme.

## 5. Metadata Handling

- Always clean up temporary files in `/tmp` using `fs.unlink` after processing.
- Max duration for API requests: 60 seconds (Metadata extraction can be heavy).
