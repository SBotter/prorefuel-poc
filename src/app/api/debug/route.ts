import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: Request) {
  try {
    const xmlData = await req.text();
    
    // Pasta temp_gpx na raiz do projeto local
    const tempDir = path.join(process.cwd(), "temp_gpx");
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    // Salva o GPX com a data/hora para não sobrescrever sempre
    const filename = `gpxv_debug_${new Date().toISOString().replace(/[:.]/g, "-")}.gpx`;
    fs.writeFileSync(path.join(tempDir, filename), xmlData);

    return NextResponse.json({ success: true, savedTo: filename });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
