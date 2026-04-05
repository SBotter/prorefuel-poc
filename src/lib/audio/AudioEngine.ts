/**
 * ProRefuel EpicAudioEngine — Phase 6 Cinematic Sound Identity
 *
 * Referências: Planet Earth, The Revenant, Dune, Into the Wild
 * Tudo gerado proceduralmente — sem MP3/WAV. 100% Tone.js.
 *
 * API pública:
 *   playIntroWithDataImpacts()  — vento épico 6.5s + heartbeat + reverb invade MP4
 *   playBrandExit()             — wind swell + deep thud + chord bloom (3.5s brand)
 *   stopAll()                  — fade-out e reset de tudo
 *   getToneOutputStream()      — tap Tone output into a MediaStream (Engine 2 recording)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type T = any;

// ─── Singleton Tone lazy-load ─────────────────────────────────────────────────

let _tone: T = null;
let _started = false;

async function getTone(): Promise<T> {
  if (!_tone) _tone = await import("tone");
  if (!_started) {
    await _tone.start();
    _started = true;
  }
  return _tone;
}

// ─── Cleanup helper ───────────────────────────────────────────────────────────

const _tracked: T[] = [];

function track(...items: T[]): void {
  _tracked.push(...items);
}

function releaseAfter(items: T[], ms: number): void {
  setTimeout(() => {
    for (const item of items) {
      try { item.stop?.(); item.dispose?.(); } catch { /* já disposed */ }
    }
    for (const item of items) {
      const i = _tracked.indexOf(item);
      if (i !== -1) _tracked.splice(i, 1);
    }
  }, ms);
}

// ─── STOP ALL ─────────────────────────────────────────────────────────────────

export async function stopAll(): Promise<void> {
  if (!_tone) return;
  _tone.Transport.cancel();
  _tone.Transport.stop();
  for (const item of [..._tracked]) {
    try { item.stop?.(); item.dispose?.(); } catch { /* ignore */ }
  }
  _tracked.length = 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// SCENE 1 — INTRO (6500ms): WIND + HEARTBEAT
// ══════════════════════════════════════════════════════════════════════════════
//
//   t=0ms       Wind starts (white noise, 2s fade-in)
//   t=1500ms    Heartbeat starts (~73bpm)
//   t=5000ms    Wind begins slow fade-out (bleeds into MP4 start)
//   t=7500ms    Reverb fully gone

export async function playIntroWithDataImpacts(): Promise<void> {
  const Tone = await getTone();

  Tone.Transport.cancel();
  Tone.Transport.stop();
  Tone.Transport.start();

  const now = Tone.now() + 0.08;

  // ── Layer 1: AMBIENT WIND (white noise + LFO breathing) ─────────────────────
  const windRev  = new Tone.Reverb({ decay: 2.0, wet: 0.52 }).toDestination();
  const windComp = new Tone.Compressor({ ratio: 3, attack: 0.15, release: 0.3 }).connect(windRev);
  const windFade = new Tone.Gain(0).connect(windComp);
  const windMod  = new Tone.Gain(0).connect(windFade);
  const windLPF  = new Tone.Filter({ frequency: 500, type: "lowpass", rolloff: -12 }).connect(windMod);
  const windHPF  = new Tone.Filter({ frequency: 100, type: "highpass" }).connect(windLPF);
  const wind     = new Tone.Noise("white").connect(windHPF);

  const windAmplLFO = new Tone.LFO({ frequency: 0.35, min: 0.55, max: 0.75 });
  windAmplLFO.connect(windMod.gain);
  windAmplLFO.start(now);

  const windFilterLFO = new Tone.LFO({ frequency: 0.25, min: 350, max: 650 });
  windFilterLFO.connect(windLPF.frequency);
  windFilterLFO.start(now);

  wind.start(now);
  windFade.gain.setValueAtTime(0, now);
  windFade.gain.linearRampToValueAtTime(1.0, now + 2.0);
  windFade.gain.setValueAtTime(1.0, now + 5.0);
  windFade.gain.linearRampToValueAtTime(0, now + 7.5);
  wind.stop(now + 7.6);

  track(wind, windHPF, windLPF, windMod, windFade, windComp, windRev, windAmplLFO, windFilterLFO);
  releaseAfter([wind, windHPF, windLPF, windMod, windFade, windComp, windRev, windAmplLFO, windFilterLFO], 11000);

  // ── Layer 2: HEARTBEAT (t=1500ms → t=5800ms) ────────────────────────────────
  //
  // Enters after the logo appears (t=500ms) while stats are being revealed.
  // ~73bpm, 6 beats, volume gently decreases with the wind fade-out.

  const hbInterval = 0.82;
  const hbStart    = 1.5;
  const hbCount    = 6;

  for (let i = 0; i < hbCount; i++) {
    const beatOffset = hbStart + i * hbInterval;
    const volume     = 1.0 - i * 0.12; // fade gradual: 1.0 → 0.40
    Tone.Transport.schedule((audioTime: number) => {
      scheduleHeartbeat(Tone, audioTime, volume);
    }, `+${beatOffset}`);
  }
}

// ─── Heartbeat — cinematic lub-dub ───────────────────────────────────────────
//
// Two sequential beats (lub + dub) with descending frequency sweep.
// volume: 1.0 = max intensity, decreases with each beat.

function scheduleHeartbeat(Tone: T, time: number, volume: number): void {
  const hbRev  = new Tone.Reverb({ decay: 1.8, wet: 0.52 }).toDestination();
  const hbGain = new Tone.Gain(volume * 1.8).connect(hbRev);  // era 0.55 — triplicado

  // Lub: batida principal — mais grave, mais presença
  const lub = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope  : { attack: 0.006, decay: 0.18, sustain: 0, release: 0.08 },
    volume    : +3,   // era -4
  }).connect(hbGain);
  lub.frequency.setValueAtTime(80, time);
  lub.frequency.exponentialRampToValueAtTime(45, time + 0.14);
  lub.triggerAttackRelease(80, 0.18, time);

  // Dub: eco orgânico (150ms depois, um pouco mais suave)
  const dub = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope  : { attack: 0.005, decay: 0.13, sustain: 0, release: 0.06 },
    volume    : -1,   // era -8
  }).connect(hbGain);
  dub.frequency.setValueAtTime(65, time + 0.15);
  dub.frequency.exponentialRampToValueAtTime(38, time + 0.25);
  dub.triggerAttackRelease(65, 0.14, time + 0.15);

  track(lub, dub, hbGain, hbRev);
  releaseAfter([lub, dub, hbGain, hbRev], 3500);
}

// ══════════════════════════════════════════════════════════════════════════════
// SCENE 3 — BRAND EXIT (3500ms — BRAND_SEC = 3.5s)
// ══════════════════════════════════════════════════════════════════════════════
//
// Timing derived from StorytellingProcessor + MapEngine:
//   BRAND_SEC = 3.5s  (StorytellingProcessor.ts:35)
//   Logo fade-in delay = 600ms  (MapEngine.tsx: delay-[600ms])
//   Logo fully visible = 1600ms (600ms delay + 1000ms transition)
//
// Timeline:
//   t=0ms       Background wind starts (same wind from intro — journey continues)
//   t=600ms     💣 CANNON BOOM — synced with logo appearance!
//   t=1500ms    Wind fade-out begins (slow, smooth)
//   t=2000ms    Full fade-out — everything dissolves gracefully
//   t=3500ms    Silence — 1.8s reverb tail lingers (auditory memory)

// prerollSec: seconds before the BRAND transition when this function is called.
// With prerollSec=2 (default):
//   now+0.0  → wind + swell start (while video is still playing)
//   now+2.0  → BRAND begins (smooth transition, no hard cut)
//   now+2.6  → LOGO appears → deep impact + opening chord
//   now+5.5  → BRAND ends
//   now+6.5  → everything dissolves with reverb
export async function playBrandExit(prerollSec = 0): Promise<void> {
  const Tone = await getTone();

  Tone.Transport.cancel();
  Tone.Transport.stop();

  const now  = Tone.now() + 0.06;
  const p    = prerollSec;
  const logo = now + p + 0.6; // momento exato do logo (delay-[600ms] do BRAND)

  // ── Layer 1: WIND — gentle fade-in during preroll ────────────────────────────
  //
  // Already present when BRAND starts — organic transition, no hard cut.
  // Fade-out ends 1s after BRAND to avoid an abrupt stop.

  const windRev  = new Tone.Reverb({ decay: 2.2, wet: 0.50 }).toDestination();
  const windFade = new Tone.Gain(0).connect(windRev);
  const windMod  = new Tone.Gain(0).connect(windFade);
  const windLPF  = new Tone.Filter({ frequency: 500, type: "lowpass", rolloff: -12 }).connect(windMod);
  const windHPF  = new Tone.Filter({ frequency: 100, type: "highpass" }).connect(windLPF);
  const wind     = new Tone.Noise("white").connect(windHPF);

  const windAmplLFO = new Tone.LFO({ frequency: 0.35, min: 0.40, max: 0.58 });
  windAmplLFO.connect(windMod.gain);
  windAmplLFO.start(now);

  const windFilterLFO = new Tone.LFO({ frequency: 0.25, min: 300, max: 620 });
  windFilterLFO.connect(windLPF.frequency);
  windFilterLFO.start(now);

  wind.start(now);
  windFade.gain.setValueAtTime(0, now);
  windFade.gain.linearRampToValueAtTime(0.9, now + p * 0.8);       // fade-in ocupa 80% do preroll
  windFade.gain.setValueAtTime(0.9, now + p + 1.8);                // plateau
  windFade.gain.linearRampToValueAtTime(0, now + p + 3.5 + 1.2);  // dissolve 1.2s após BRAND
  wind.stop(now + p + 3.5 + 1.3);

  track(wind, windHPF, windLPF, windMod, windFade, windRev, windAmplLFO, windFilterLFO);
  releaseAfter([wind, windHPF, windLPF, windMod, windFade, windRev, windAmplLFO, windFilterLFO], (p + 7) * 1000);

  // ── Layer 2: TENSION SWELL — builds during preroll, peaks at logo ────────────
  //
  // Filtered white noise with progressive LPF opening —
  // feeling of something arriving, rising anticipation before the logo.
  // Dissolves right after impact (the logo "resolves" the tension).

  const swellRev    = new Tone.Reverb({ decay: 3.0, wet: 0.68 }).toDestination();
  const swellGain   = new Tone.Gain(0).connect(swellRev);
  const swellFilter = new Tone.Filter({ frequency: 180, type: "lowpass" }).connect(swellGain);
  const swell       = new Tone.Noise("white").connect(swellFilter);

  swell.start(now);
  swellGain.gain.setValueAtTime(0, now);
  swellGain.gain.linearRampToValueAtTime(0.55, logo - 0.05);    // cresce até o logo
  swellGain.gain.linearRampToValueAtTime(0,    logo + 0.8);     // dissolve após impacto
  swellFilter.frequency.setValueAtTime(180, now);
  swellFilter.frequency.exponentialRampToValueAtTime(1400, logo); // abre = tensão cresce
  swell.stop(logo + 0.9);

  track(swell, swellFilter, swellGain, swellRev);
  releaseAfter([swell, swellFilter, swellGain, swellRev], (p + 5) * 1000);

  // ── Layer 3: LOGO IMPACT — 3 simultaneous layers, 100% sine ─────────────────
  //
  //   A) Sub-cannon  60→40Hz  — felt in the chest (physical, not a note)
  //   B) Mid-punch  200→80Hz  — body of the explosion, compressor for punch
  //   C) Snap-click 600→300Hz — detonator, attack < 8ms, duration 60ms
  //
  // All 3 fire EXACTLY at `logo` (synced with CSS delay-[600ms]).

  // A) Sub-cannon
  const subRev  = new Tone.Reverb({ decay: 2.5, wet: 0.65 }).toDestination();
  const subGain = new Tone.Gain(0).connect(subRev);
  const sub     = new Tone.Oscillator({ type: "sine", frequency: 60 }).connect(subGain);

  sub.start(logo);
  subGain.gain.setValueAtTime(0,   logo);
  subGain.gain.linearRampToValueAtTime(2.2, logo + 0.02);          // hit abrupto
  subGain.gain.exponentialRampToValueAtTime(0.001, logo + 0.5);    // decay orgânico
  sub.frequency.setValueAtTime(60, logo);
  sub.frequency.exponentialRampToValueAtTime(40, logo + 0.35);
  sub.stop(logo + 0.55);

  track(sub, subGain, subRev);
  releaseAfter([sub, subGain, subRev], (p + 5) * 1000);

  // B) Mid-punch
  const midComp = new Tone.Compressor({ ratio: 5, attack: 0.01, release: 0.15, threshold: -18 }).toDestination();
  const midRev  = new Tone.Reverb({ decay: 1.8, wet: 0.55 }).connect(midComp);
  const midGain = new Tone.Gain(0).connect(midRev);
  const mid     = new Tone.Oscillator({ type: "sine", frequency: 200 }).connect(midGain);

  mid.start(logo);
  midGain.gain.setValueAtTime(0,   logo);
  midGain.gain.linearRampToValueAtTime(1.5, logo + 0.015);
  midGain.gain.exponentialRampToValueAtTime(0.001, logo + 0.4);
  mid.frequency.setValueAtTime(200, logo);
  mid.frequency.exponentialRampToValueAtTime(80, logo + 0.2);
  mid.stop(logo + 0.45);

  track(mid, midGain, midRev, midComp);
  releaseAfter([mid, midGain, midRev, midComp], (p + 5) * 1000);

  // C) Snap-click — detonador, brevíssimo
  const snapRev  = new Tone.Reverb({ decay: 0.8, wet: 0.28 }).toDestination();
  const snapGain = new Tone.Gain(0).connect(snapRev);
  const snap     = new Tone.Oscillator({ type: "sine", frequency: 600 }).connect(snapGain);

  snap.start(logo);
  snapGain.gain.setValueAtTime(0,   logo);
  snapGain.gain.linearRampToValueAtTime(0.85, logo + 0.008);
  snapGain.gain.exponentialRampToValueAtTime(0.001, logo + 0.06);
  snap.frequency.setValueAtTime(600, logo);
  snap.frequency.exponentialRampToValueAtTime(300, logo + 0.06);
  snap.stop(logo + 0.07);

  track(snap, snapGain, snapRev);
  releaseAfter([snap, snapGain, snapRev], (p + 4) * 1000);

  // ── Layer 4: HERO BLOOM (logo + 60ms) ────────────────────────────────────────
  //
  // PolySynth sawtooth chord — C major add9 (C3·G3·C4·D4).
  // Enters 60ms after impact to avoid competing with the punch.
  // Lowpass filter 6kHz: warm, no metallic brightness.
  // Reverb 2.0s: cinematic space that "opens" with the logo.
  //
  // Feeling: "Wow, beautiful!" — premium + aspirational.

  const bloomRev    = new Tone.Reverb({ decay: 2.0, wet: 0.60 }).toDestination();
  const bloomFilter = new Tone.Filter({ type: "lowpass", frequency: 6000, rolloff: -24 }).connect(bloomRev);
  const bloom       = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope  : { attack: 0.05, decay: 0.8, sustain: 0.7, release: 1.5 },
    volume    : -4,
  }).connect(bloomFilter);

  bloom.triggerAttackRelease(["C3", "G3", "C4", "D4"], 1.8, logo + 0.06);

  track(bloom, bloomFilter, bloomRev);
  releaseAfter([bloom, bloomFilter, bloomRev], (p + 8) * 1000);

  // ── Layer 5: DEEP SUSTAIN — sub-bass sine que sustenta o logo ───────────────
  //
  // Sine 45Hz puro — abaixo do limiar de pitch audível, sentido no peito.
  // Sem notas, sem melodia, sem nada metálico.
  // Bloom lento (400ms attack) + sustain longo = gravidade e presença.
  // Reverb 3.0s: o espaço continua a vibrar depois que o logo aparece.

  const deepRev  = new Tone.Reverb({ decay: 3.0, wet: 0.55 }).toDestination();
  const deepGain = new Tone.Gain(0).connect(deepRev);
  const deep     = new Tone.Oscillator({ type: "sine", frequency: 45 }).connect(deepGain);

  deep.start(logo + 0.05);
  deepGain.gain.setValueAtTime(0,    logo + 0.05);
  deepGain.gain.linearRampToValueAtTime(1.1, logo + 0.45);   // bloom lento
  deepGain.gain.setValueAtTime(1.1,  logo + 1.2);            // sustain
  deepGain.gain.linearRampToValueAtTime(0,   logo + 3.0);    // fade com o vento
  deep.stop(logo + 3.1);

  track(deep, deepGain, deepRev);
  releaseAfter([deep, deepGain, deepRev], (p + 7) * 1000);
}

// ══════════════════════════════════════════════════════════════════════════════
// ENGINE 2 — MediaStream tap for MP4 recording
// ══════════════════════════════════════════════════════════════════════════════
//
// Connects Tone.js master output → MediaStreamAudioDestinationNode so that
// the Engine 2 MediaRecorder can capture cinematic audio into the exported file.
//
// Usage (CanvasRenderer):
//   await playIntroWithDataImpacts();           // initializes Tone.js
//   const stream = await getToneOutputStream(); // taps its output
//   new MediaRecorder(new MediaStream([...videoTracks, ...stream.getAudioTracks()]))

// ─── initTone — pre-warm Tone.js without playing anything ────────────────────
// Call this before startRecording so Tone has a stable AudioContext to tap.

export async function initTone(): Promise<void> {
  await getTone();
}

let _recordingDest: MediaStreamAudioDestinationNode | null = null;

export async function getToneOutputStream(): Promise<MediaStream> {
  const Tone = await getTone();
  const rawCtx = Tone.getContext().rawContext as AudioContext;

  // Reuse existing tap if already created for this context
  if (_recordingDest && _recordingDest.context === rawCtx) {
    return _recordingDest.stream;
  }

  _recordingDest = rawCtx.createMediaStreamDestination();

  // Tone.Destination → _recordingDest (parallel to existing → speakers path)
  Tone.getDestination().connect(_recordingDest);

  return _recordingDest.stream;
}

export function disconnectToneOutputStream(): void {
  if (_recordingDest && _tone) {
    try { _tone.getDestination().disconnect(_recordingDest); } catch { /* ignore */ }
  }
  _recordingDest = null;
}
