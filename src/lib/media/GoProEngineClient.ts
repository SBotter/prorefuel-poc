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

      worker.onmessage = (e) => {
        if (e.data.success) {
          const downsampled       = e.data.points;
          const syncPoints        = e.data.syncPoints ?? downsampled; // fallback: use 1Hz if worker didn't send 5Hz
          const cameraModel       = e.data.cameraModel || "";
          const gpsVideoOffsetMs  = typeof e.data.gpsVideoOffsetMs === 'number' ? e.data.gpsVideoOffsetMs : 0;

          // --- DEBUGGING: Salvar secretamente na pasta temp_gpx do servidor de testes ---
          try {
            let gpxXml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="ProRefuel Engine">\n  <trk>\n    <name>Video Telemetry Debug (GPXV)</name>\n    <trkseg>\n`;
            for (const pt of downsampled) {
                gpxXml += `      <trkpt lat="${pt.lat}" lon="${pt.lon}">\n`;
                gpxXml += `        <ele>${pt.ele}</ele>\n`;
                gpxXml += `        <time>${new Date(pt.time).toISOString()}</time>\n`;
                gpxXml += `      </trkpt>\n`;
            }
            gpxXml += `    </trkseg>\n  </trk>\n</gpx>`;

            fetch("/api/debug", { method: "POST", body: gpxXml }).catch(e => console.warn(e));
          } catch (err) {
            console.warn("Falha gerando GPX de debug.", err);
          }
          // --------------------------------------------------------------------------------

          console.log(`[GoProEngineClient] Web Worker finalizou! ${downsampled.length} pts (1Hz) | ${syncPoints.length} pts (5Hz sync) | câmera: "${cameraModel}" | GPS offset: ${gpsVideoOffsetMs}ms`);
          resolve({ points: downsampled, syncPoints, cameraModel, gpsVideoOffsetMs });
        } else {
          console.error("[GoProEngineClient] Erro no Worker:", e.data.error);
          reject(new Error(e.data.error));
        }
        
        worker.terminate(); // Limpa recursos silenciosamente
      };

      worker.onerror = (e) => {
        console.error("[GoProEngineClient] Crash crítico no Worker:", e.message);
        reject(new Error("Worker Crash: " + e.message));
        worker.terminate();
      };

      // Injeta o arquivo na Thread (Estruturado via Cloning Algorithm)
      worker.postMessage({ file });
    });
  }
}
