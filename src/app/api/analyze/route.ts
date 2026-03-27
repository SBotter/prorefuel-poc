import { NextRequest, NextResponse } from "next/server";
import { GoProEngine } from "@/lib/media/GoProEngine";
import { VideoAnalyzer } from "@/lib/engine/VideoAnalyzer";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { v4 as uuidv4 } from "uuid";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let tempFilePath = "";

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `prorefuel_${uuidv4()}_${file.name}`);

    console.log(
      `\n🚀 [API] Recebendo: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
    );

    // 1. Gravação via Stream (Não ocupa RAM)
    const destinationStream = createWriteStream(tempFilePath);
    const readableStream = Readable.fromWeb(file.stream() as any);
    await finished(readableStream.pipe(destinationStream));
    console.log("✅ [API] Salvo no disco.");

    // 2. Extração de Modelo (Timeout isolado)
    const model = await GoProEngine.getCameraModel(tempFilePath).catch(
      () => "GoPro",
    );

    // 3. Extração GPS (Passo principal)
    console.log("⚙️ [API] Iniciando ExifTool Deep Scan...");
    const gpxString = await GoProEngine.extractGPS(tempFilePath);

    if (!gpxString || gpxString.length < 100) {
      throw new Error("No GPS telemetry found. Check if GPS was ON.");
    }

    // 4. Processamento de Dados
    const points = GoProEngine.parseGPX(gpxString);
    console.log(`📊 [API] ${points.length} pontos encontrados.`);

    const highlight = VideoAnalyzer.getEntireVideoSegment(points);
    console.log("🎯 [API] Vídeo completo definido como Highlight.");

    return NextResponse.json({ success: true, model, points, highlight });
  } catch (error: any) {
    console.error("❌ [API] Erro:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
      console.log("🧹 [API] Temporário removido.\n");
    }
  }
}
