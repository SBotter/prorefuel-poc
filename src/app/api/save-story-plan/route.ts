import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(request: Request) {
  try {
    const plan = await request.json();
    
    const targetDir = path.join(process.cwd(), "temp_gpx");
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, "storyPlan.json");
    fs.writeFileSync(filePath, JSON.stringify(plan, null, 2));

    return NextResponse.json({ success: true, path: filePath });
  } catch (error: any) {
    console.error("[API] Failed to save story plan:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
