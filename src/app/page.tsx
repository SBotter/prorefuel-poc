"use client";

import { useState, useRef } from "react";
import { Upload, Play, CheckCircle2, Loader2, Gauge } from "lucide-react";
import MapEngine from "@/components/MapEngine";
import { ActionSegment, TelemetryCrossRef } from "@/lib/engine/TelemetryCrossRef";
import { GoProEngineClient } from "@/lib/media/GoProEngineClient";

export default function ProRefuelPage() {
  const [activityPoints, setActivityPoints] = useState<any[]>([]);
  const [highlights, setHighlights] = useState<ActionSegment[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<"UPLOAD" | "READY" | "EXPERIENCE">("UPLOAD");
  const [statusMsg, setStatusMsg] = useState("");
  const mapEngineRef = useRef<{ start: () => void }>(null);

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setVideoFile(file);
    setProgress(0);
    setStatusMsg("Iniciando processamento...");

    // Simulação progressiva visual (fake load para encobrir o ArrayBuffer)
    const estimatedSecs = Math.max(8, file.size / (1024 * 1024 * 15) + 5);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 98) return 98;
        return prev + 100 / (estimatedSecs * 10);
      });
    }, 100);

    try {
      setStatusMsg("Lendo arquivo no navegador...");
      await new Promise(resolve => setTimeout(resolve, 150)); // Libera a UI para renderizar o spinner
      
      const videoPoints = await GoProEngineClient.extractTelemetry(file);

      setStatusMsg("Mapeando Clímax...");
      await new Promise(resolve => setTimeout(resolve, 50)); // Yield

      const segments = TelemetryCrossRef.findHighlights(activityPoints, videoPoints);

      if (!segments || segments.length === 0) {
        throw new Error("Nenhum dado de GPS pôde ser cruzado do vídeo.");
      }

      clearInterval(interval);
      setProgress(100);
      setTimeout(() => {
        setHighlights(segments);
        setStep("READY");
        setLoading(false);
      }, 500);
    } catch (error: any) {
      clearInterval(interval);
      alert(error.message || "Erro nativo de extração.");
      setLoading(false);
    }
  };

  const handleGPXUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    
    // Função helper para puxar extensões do Garmin/Strava
    const getExt = (pt: Element, tag: string) => {
       const el = pt.getElementsByTagName(tag)[0] || pt.getElementsByTagName(`gpxtpx:${tag}`)[0] || pt.getElementsByTagName(`ns3:${tag}`)[0];
       return el ? parseFloat(el.textContent || "0") : undefined;
    };

    const pts = Array.from(xml.querySelectorAll("trkpt")).map((pt: Element) => ({
      lat: parseFloat(pt.getAttribute("lat") || "0"),
      lon: parseFloat(pt.getAttribute("lon") || "0"),
      ele: parseFloat(pt.querySelector("ele")?.textContent || "0"),
      time: new Date(pt.querySelector("time")?.textContent || "").getTime(),
      hr: getExt(pt, "hr"),
      cad: getExt(pt, "cad"),
      power: getExt(pt, "power") || getExt(pt, "watts"),
      speed: getExt(pt, "speed"), // Pode estar gravado pelas extensoes GPX
    }));
    setActivityPoints(pts);
  };

  const startShow = () => {
    setStep("EXPERIENCE");
    setTimeout(() => mapEngineRef.current?.start(), 1000);
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-[400px] aspect-[9/16] bg-zinc-900 rounded-[3rem] overflow-hidden relative border border-white/10 shadow-2xl flex flex-col">
        {step !== "EXPERIENCE" ? (
          <div className="p-8 flex flex-col h-full">
            <header className="mb-10 text-center flex flex-col items-center">
              <img src="/prorefuel_logo.png" alt="ProRefuel Logo" className="w-56 mb-1 drop-shadow-2xl" />
              <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-bold mt-2">
                POC Cinematic Engine
              </p>
            </header>
            <div className="flex-1 space-y-6">
              <div
                className={`p-6 rounded-3xl border-2 border-dashed transition-all ${activityPoints.length > 0 ? "border-green-500/50 bg-green-500/5" : "border-zinc-700 bg-white/5"}`}
              >
                <label className="flex flex-col items-center cursor-pointer">
                  {activityPoints.length > 0 ? (
                    <>
                      <CheckCircle2 className="text-green-500 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-widest">
                        GPX Sincronizado
                      </span>
                    </>
                  ) : (
                    <>
                      <Gauge className="text-amber-500 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-widest text-center">
                        Upload GPX Atividade
                      </span>
                      <span className="text-[10px] text-zinc-500 mt-1">Garmin / Strava Elevado</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept=".gpx"
                    onChange={handleGPXUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <div
                className={`p-6 rounded-3xl border-2 border-dashed transition-all ${highlights.length > 0 ? "border-green-500/50 bg-green-500/5" : "border-zinc-700 bg-white/5"}`}
              >
                <label className="flex flex-col items-center cursor-pointer w-full text-center">
                  {loading ? (
                    <div className="w-full flex flex-col items-center">
                      <Loader2 className="animate-spin text-amber-500 mb-4" />
                      <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mb-2">
                        <div
                          className="bg-amber-500 h-full transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-black uppercase text-amber-500">
                        {Math.round(progress)}% - {statusMsg}
                      </span>
                    </div>
                  ) : highlights.length > 0 ? (
                    <>
                      <CheckCircle2 className="text-green-500 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-widest text-center">
                        Vídeo Mapeado<br/>
                        <span className="text-[10px] text-amber-500 mt-1">[{highlights.length} Cenas de Ação]</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="text-zinc-400 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                        Upload Vídeo Câmera
                      </span>
                      <span className="text-[10px] text-zinc-500 mt-1">.MP4 Direto Local</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="video/mp4"
                    disabled={loading || activityPoints.length === 0}
                    onChange={handleVideoUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <button
              onClick={startShow}
              disabled={!highlights.length || !videoFile}
              className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all mt-6 ${
                highlights.length && videoFile
                  ? "bg-amber-500 text-black hover:bg-amber-400 hover:scale-[1.02]"
                  : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              }`}
            >
              <Play size={18} />
              Gerar Cinematic
            </button>
          </div>
        ) : (
          <div className="w-full h-full relative">
            <MapEngine
              ref={mapEngineRef}
              activityPoints={activityPoints}
              highlights={highlights}
              videoFile={videoFile}
            />
          </div>
        )}
      </div>
    </main>
  );
}
