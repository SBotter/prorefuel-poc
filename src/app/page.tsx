"use client";

import { useState, useRef } from "react";
import { Upload, Play, CheckCircle2, Loader2, Gauge } from "lucide-react";
import MapEngine from "@/components/MapEngine";
import { GPSPoint } from "@/lib/media/GoProEngine";
import { HighlightSegment } from "@/lib/engine/VideoAnalyzer";

export default function ProRefuelPage() {
  const [activityPoints, setActivityPoints] = useState<GPSPoint[]>([]);
  const [highlight, setHighlight] = useState<HighlightSegment | null>(null);
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

    // Simulação de progresso baseada em tamanho (15MB/s)
    const estimatedSecs = Math.max(8, file.size / (1024 * 1024 * 15) + 5);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 98) return 98;
        return prev + 100 / (estimatedSecs * 10);
      });
    }, 100);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      clearInterval(interval);
      setProgress(100);
      setTimeout(() => {
        setHighlight(data.highlight);
        setStep("READY");
        setLoading(false);
      }, 500);
    } catch (error: any) {
      clearInterval(interval);
      alert(error.message || "Erro ao analisar.");
      setLoading(false);
    }
  };

  // Funções handleGPXUpload e startShow permanecem as mesmas do código anterior...
  const handleGPXUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    const pts = Array.from(xml.querySelectorAll("trkpt")).map((pt) => ({
      lat: parseFloat(pt.getAttribute("lat") || "0"),
      lon: parseFloat(pt.getAttribute("lon") || "0"),
      ele: parseFloat(pt.querySelector("ele")?.textContent || "0"),
      time: new Date(pt.querySelector("time")?.textContent || "").getTime(),
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
                    <CheckCircle2 className="text-green-500 mb-2" />
                  ) : (
                    <Upload className="text-zinc-500 mb-2" />
                  )}
                  <span className="text-xs font-bold uppercase tracking-widest">
                    GPX Atividade
                  </span>
                  <input
                    type="file"
                    accept=".gpx"
                    onChange={handleGPXUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <div
                className={`p-6 rounded-3xl border-2 border-dashed transition-all ${highlight ? "border-green-500/50 bg-green-500/5" : "border-zinc-700 bg-white/5"}`}
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
                        {Math.round(progress)}% - Analisando Vídeo
                      </span>
                    </div>
                  ) : highlight ? (
                    <>
                      <CheckCircle2 className="text-green-500 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-widest">
                        Vídeo Sincronizado
                      </span>
                    </>
                  ) : (
                    <>
                      <Gauge className="text-zinc-500 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-widest">
                        Upload GoPro MP4
                      </span>
                      <input
                        type="file"
                        accept="video/*"
                        onChange={handleVideoUpload}
                        className="hidden"
                      />
                    </>
                  )}
                </label>
              </div>
              {highlight && (
                <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl animate-in fade-in slide-in-from-bottom-4 text-xs">
                  <p className="font-black text-amber-500 uppercase">
                    Vídeo Sincronizado:
                  </p>
                  <p className="mt-1">
                    Duração Total: {highlight.duration.toFixed(1)}s |{" "}
                    +{highlight.elevationGain.toFixed(1)}m Acumulado
                  </p>
                </div>
              )}
            </div>
            <button
              disabled={step !== "READY" || loading}
              onClick={startShow}
              className="mt-8 w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-20 text-black py-5 rounded-[2rem] font-black italic uppercase tracking-tighter flex items-center justify-center gap-2 transition-all shadow-xl shadow-amber-500/20"
            >
              <Play fill="black" size={20} /> Gerar Cinematic
            </button>
          </div>
        ) : (
          <MapEngine
            ref={mapEngineRef}
            activityPoints={activityPoints}
            highlight={highlight!}
            videoFile={videoFile}
            onComplete={() => setStep("UPLOAD")}
          />
        )}
      </div>
    </main>
  );
}
