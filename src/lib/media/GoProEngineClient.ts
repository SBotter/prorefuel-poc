import { trackError } from "@/lib/supabase/tracking";

export interface GPSPoint {
  lat: number;
  lon: number;
  ele: number;
  time: number;
}

export interface TelemetryResult {
  points: GPSPoint[];       // 1 Hz — for map rendering and scene detection
  syncPoints: GPSPoint[];   // ~5 Hz — higher-resolution GPS used only for clock offset estimation
  cameraModel: string;      // e.g. "GoPro Hero9 Black" — empty string if unavailable
  gpsVideoOffsetMs: number; // ms from video start to first valid GPS sample (GPS startup latency)
}

export class GoProEngineClient {
  /**
   * Extracts GPS metadata by delegating processing to a Web Worker
   * to avoid blocking the Main Thread (prevents UI freezes on 4GB+ videos).
   */
  static async extractTelemetry(file: File): Promise<TelemetryResult> {
    console.log(`[GoProEngineClient] Delegando ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) para Web Worker...`);

    return new Promise((resolve, reject) => {
      // Instancia o Worker gerenciado pelo Next.js (Turbopack suporta via import.meta.url)
      const worker = new Worker(new URL('../workers/gopro.worker.ts', import.meta.url));

      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("GoPro telemetry extraction timed out. The file may be too large or corrupted."));
      }, 90_000);

      worker.onmessage = (e) => {
        clearTimeout(timeout);
        if (e.data.success) {
          const downsampled       = e.data.points;
          const syncPoints        = e.data.syncPoints ?? downsampled;
          const cameraModel       = e.data.cameraModel || "";
          const gpsVideoOffsetMs  = typeof e.data.gpsVideoOffsetMs === 'number' ? e.data.gpsVideoOffsetMs : 0;

          console.log(`[GoProEngineClient] Worker done — ${downsampled.length} pts (1Hz) | ${syncPoints.length} pts (sync) | camera: "${cameraModel}" | GPS offset: ${gpsVideoOffsetMs}ms`);
          resolve({ points: downsampled, syncPoints, cameraModel, gpsVideoOffsetMs });
        } else {
          const errMsg: string = e.data.error ?? "Worker returned no data.";
          console.warn("[GoProEngineClient] Worker error:", errMsg);
          void trackError("WORKER_ERROR", `[${file.name}] ${errMsg}`, "worker", {
            device_type:    "gopro",
            file_extension: "." + (file.name.split(".").pop()?.toLowerCase() ?? "mp4"),
          });
          reject(new Error(errMsg));
        }

        worker.terminate();
      };

      worker.onerror = (e) => {
        clearTimeout(timeout);
        const errMsg = e.message || e.error?.message || "Unknown worker crash.";
        console.error("[GoProEngineClient] Worker crash:", { message: e.message, filename: e.filename, lineno: e.lineno, error: e.error });
        void trackError("WORKER_ERROR", `[${file.name}] Worker crash: ${errMsg}`, "worker", {
          device_type:    "gopro",
          file_extension: "." + (file.name.split(".").pop()?.toLowerCase() ?? "mp4"),
        });
        reject(new Error("Failed to read GoPro telemetry. Make sure the file is a valid, unmodified GoPro MP4."));
        worker.terminate();
      };

      // Injeta o arquivo na Thread (Estruturado via Cloning Algorithm)
      worker.postMessage({ file });
    });
  }
}
