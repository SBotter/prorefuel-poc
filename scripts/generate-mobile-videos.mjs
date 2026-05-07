/**
 * Generates mobile-optimized hero videos from the full-resolution originals.
 *
 * Output: public/videos/hero-preview-mobile.mp4
 *         public/videos/hero-preview-raw-mobile.mp4
 *
 * Requirements: ffmpeg must be in PATH
 * Usage: node scripts/generate-mobile-videos.mjs
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir  = dirname(fileURLToPath(import.meta.url));
const videos = join(__dir, "..", "public", "videos");

// Only encode the range the slider actually uses (0 → CLIP_END + 2s buffer)
const TRIM_END = 42;

const jobs = [
  { input: "hero-preview.mp4",     output: "hero-preview-mobile.mp4"     },
  { input: "hero-preview-raw.mp4", output: "hero-preview-raw-mobile.mp4" },
];

function ffmpeg(input, output) {
  const cmd = [
    "ffmpeg",
    "-y",                          // overwrite without asking
    "-i", `"${input}"`,
    "-t", TRIM_END,                // trim: only first 42s
    "-vf", '"scale=360:-2"',       // 360px wide → 360×640 (9:16). Target ~3MB for 42s.
    "-c:v", "libx264",
    "-crf", "32",                  // quality — 32 gives ~3-4MB at 360p (28 was too large at 12MB)
    "-preset", "fast",
    "-profile:v", "baseline",      // widest mobile compatibility (iOS 9+, Android 4+)
    "-level", "3.0",
    "-an",                         // strip audio — videos are muted
    "-movflags", "+faststart",     // moov atom at start → browser can play before full download
    `"${output}"`,
  ].join(" ");

  console.log(`\n▶ ${cmd}\n`);
  execSync(cmd, { stdio: "inherit" });
}

for (const { input, output } of jobs) {
  const inputPath  = join(videos, input);
  const outputPath = join(videos, output);

  if (!existsSync(inputPath)) {
    console.error(`✗ Not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`\n── ${input} → ${output} ──`);
  ffmpeg(inputPath, outputPath);
  console.log(`✓ Done → ${outputPath}`);
}

console.log("\n✓ All mobile videos generated.");
console.log("  Remember to add them to .gitignore if they are too large for the repo.\n");
