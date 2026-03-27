export interface GPSPoint {
  lat: number;
  lon: number;
  ele: number;
  time: number;
}

export class GoProEngineClient {
  /**
   * Extrai Metadados de GPS alocando o processamento em um Web Worker 
   * para não travar a "Main Thread" (evita UI Freezes em vídeos de 4GB+)
   */
  static async extractTelemetry(file: File): Promise<GPSPoint[]> {
    console.log(`[GoProEngineClient] Delegando ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) para Web Worker...`);
    
    return new Promise((resolve, reject) => {
      // Instancia o Worker gerenciado pelo Next.js (Turbopack suporta via import.meta.url)
      const worker = new Worker(new URL('../workers/gopro.worker.ts', import.meta.url));

      worker.onmessage = (e) => {
        if (e.data.success) {
          const downsampled = e.data.points;

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

          console.log(`[GoProEngineClient] Web Worker finalizou! ${downsampled.length} pontos retornados.`);
          resolve(downsampled);
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
