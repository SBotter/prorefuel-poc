import { spawn } from "node:child_process";
import path from "node:path";
import { JSDOM } from "jsdom";
import { exiftool } from "exiftool-vendored";

export interface GPSPoint {
  lat: number;
  lon: number;
  ele: number;
  time: number;
}

export class GoProEngine {
  /**
   * Extrai telemetria GPMF convertendo para GPX via ExifTool.
   */
  static async extractGPS(videoPath: string): Promise<string> {
    const fmtPath = path.join(process.cwd(), "src", "lib", "media", "gpx.fmt");

    /**
     * AJUSTE PARA WINDOWS:
     * Como o exiftool.exe está na raiz, usamos o path.join para garantir que o Node o encontre.
     * Se estiver em outro sistema (Linux/Vercel), ele usará apenas "exiftool".
     */
    const command =
      process.platform === "win32"
        ? path.join(process.cwd(), "exiftool.exe")
        : "exiftool";

    return new Promise((resolve, reject) => {
      console.log(
        `[GoProEngine] ⚙️ Executando: ${command} -p ${fmtPath} -ee3 ${videoPath}`,
      );

      const proc = spawn(command, ["-p", fmtPath, "-ee3", videoPath]);

      let gpxData = "";
      let errorData = "";

      proc.on("error", (err) => {
        console.error(
          `[GoProEngine] ❌ Falha ao iniciar ExifTool: ${err.message}`,
        );
        reject(new Error(`ExifTool não encontrado em: ${command}`));
      });

      proc.stdout.on("data", (data) => {
        gpxData += data.toString();
        // Feedback visual no terminal para arquivos grandes (500MB gera muito dado)
        if (gpxData.length % 5000 === 0) {
          console.log(
            `[GoProEngine] ⏳ Coletando dados GPX... (${(gpxData.length / 1024).toFixed(0)} KB)`,
          );
        }
      });

      proc.stderr.on("data", (data) => {
        errorData += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          console.log(
            `[GoProEngine] ✅ Extração concluída (${gpxData.length} bytes).`,
          );
          resolve(gpxData);
        } else {
          console.error(
            `[GoProEngine] ❌ Erro ExifTool (Code ${code}): ${errorData}`,
          );
          reject(new Error(`ExifTool falhou: ${errorData}`));
        }
      });
    });
  }

  /**
   * Converte XML para array de pontos usando JSDOM.
   */
  static parseGPX(xmlText: string): GPSPoint[] {
    try {
      const dom = new JSDOM(xmlText);
      const doc = dom.window.document;
      const trkpts = Array.from(doc.querySelectorAll("trkpt"));

      console.log(
        `[GoProEngine] 📄 Processando ${trkpts.length} pontos no JSDOM...`,
      );

      return trkpts
        .map((pt: any) => ({
          lat: parseFloat(pt.getAttribute("lat") || "0"),
          lon: parseFloat(pt.getAttribute("lon") || "0"),
          ele: parseFloat(pt.querySelector("ele")?.textContent || "0"),
          time: new Date(pt.querySelector("time")?.textContent || "").getTime(),
        }))
        .filter((p) => !isNaN(p.lat) && !isNaN(p.lon) && p.time > 0);
    } catch (e) {
      console.error("[GoProEngine] Erro no Parse GPX:", e);
      return [];
    }
  }

  /**
   * Extrai modelo com timeout de 5s para não travar o backend.
   */
  static async getCameraModel(videoPath: string): Promise<string> {
    // Para resolver o travamento eterno em vídeos grandes (500MB+),
    // vamos pular a leitura do modelo que não é usada na POC.
    return Promise.resolve("GoPro App - PoC");
  }
}
