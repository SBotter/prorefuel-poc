"use client";

import * as Tone from "tone";

// ─────────────────────────────────────────────────────────────────────────────
// SocialAudioEngine — cinematic music for LENS social video
//
// Structure:
//   HOOK    (0-10s)   Suspense — curiosity, "what is this?"
//   BEFORE  (10-16s)  Building tension
//   SLAM    (16-17.8) Riser → small release
//   FEATURES(17.8+)   Synchronized hits on each card entry, building energy
//   SPLIT   (42.8s)   THE BOOM — peak of the music
//   OUTRO   (57.8s+)  Rhythmic walking close, fading out
//
// All oscillators: sine/triangle (warm). Pink noise for snare.
// ─────────────────────────────────────────────────────────────────────────────

export interface SocialPhases {
  hookEnd:      number;
  beforeEnd:    number;
  slamStart:    number;
  slamEnd:      number;
  cardHitTimes: number[]; // absolute times for each feature card entrance
  featuresEnd:  number;
  splitEnd:     number;
  outroEnd:     number;
}

export class SocialAudioEngine {
  private kick!:   Tone.MembraneSynth;
  private snare!:  Tone.NoiseSynth;
  private hat!:    Tone.NoiseSynth;
  private pad!:    Tone.PolySynth<Tone.Synth>;
  private bass!:   Tone.Synth;
  private lead!:   Tone.Synth;
  private drone!:  Tone.Oscillator;
  private riser!:  Tone.Oscillator;
  private riserGain!: Tone.Gain;

  private masterVol!: Tone.Volume;
  private limiter!:   Tone.Limiter;
  private padFx!:     Tone.Reverb;
  private leadFx!:    Tone.Reverb;
  private mediaDest!: MediaStreamAudioDestinationNode;

  private seqs: Tone.Sequence<any>[] = [];
  private initialized = false;

  init(phases: SocialPhases): void {
    void Tone.start();
    Tone.Transport.bpm.value    = 120;
    Tone.Transport.timeSignature = 4;
    Tone.Transport.cancel(0);

    // ── Master chain ──────────────────────────────────────────────────────────
    this.masterVol = new Tone.Volume(-3).toDestination();
    this.limiter   = new Tone.Limiter(-1).connect(this.masterVol);

    // ── Effects ───────────────────────────────────────────────────────────────
    this.padFx  = new Tone.Reverb({ decay: 6, wet: 0.70 }).connect(this.limiter);
    this.leadFx = new Tone.Reverb({ decay: 3, wet: 0.50 }).connect(this.limiter);

    // ── Kick — deep warm thump ────────────────────────────────────────────────
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.07, octaves: 9,
      envelope: { attack: 0.001, decay: 0.40, sustain: 0, release: 0.25 },
      volume: -3,
    }).connect(this.limiter);

    // ── Snare — pink noise, soft ──────────────────────────────────────────────
    this.snare = new Tone.NoiseSynth({
      noise: { type: "pink" } as any,
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
      volume: -9,
    }).connect(this.limiter);

    // ── Hi-hat — quiet, filtered ──────────────────────────────────────────────
    const hatFilter = new Tone.Filter({ frequency: 8000, type: "bandpass" })
      .connect(this.limiter);
    this.hat = new Tone.NoiseSynth({
      noise: { type: "white" } as any,
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.01 },
      volume: -18,
    }).connect(hatFilter);

    // ── Pad — triangle + reverb, lush ────────────────────────────────────────
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.8, decay: 0.5, sustain: 0.8, release: 3.0 },
      volume: -14,
    }).connect(this.padFx);

    // ── Bass — warm triangle ──────────────────────────────────────────────────
    this.bass = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.06, decay: 0.4, sustain: 0.7, release: 0.8 },
      volume: -9,
    }).connect(this.limiter);

    // ── Lead — sweet triangle + reverb ───────────────────────────────────────
    this.lead = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.15, decay: 0.5, sustain: 0.6, release: 1.5 },
      volume: -16,
    }).connect(this.leadFx);

    // ── Drone — deep sine, suspense ───────────────────────────────────────────
    const droneGain   = new Tone.Gain(0).connect(this.limiter);
    const droneFilter = new Tone.Filter({ frequency: 200, type: "lowpass" })
      .connect(droneGain);
    this.drone = new Tone.Oscillator({ type: "sine", frequency: 55, volume: -20 })
      .connect(droneFilter);
    this.drone.start(0);

    // ── Riser — sine sweep for slam ───────────────────────────────────────────
    this.riserGain = new Tone.Gain(0).connect(this.limiter);
    this.riser = new Tone.Oscillator({ type: "sine", frequency: 80, volume: -24 })
      .connect(this.riserGain);
    this.riser.start(0);

    // ── MediaStream for recording ─────────────────────────────────────────────
    const rawCtx   = Tone.getContext().rawContext as AudioContext;
    this.mediaDest = rawCtx.createMediaStreamDestination();
    Tone.getDestination().connect(this.mediaDest);

    // ── Schedule all music ────────────────────────────────────────────────────
    this._schedule(phases, droneGain);
    this.initialized = true;
  }

  private _schedule(p: SocialPhases, droneGain: Tone.Gain): void {
    const at = (s: number, fn: (time: number) => void) =>
      Tone.Transport.schedule(fn, s);

    // ════════════════════════════════════════════════════════════════════════
    // HOOK (0–10s) — SUSPENSE: drone + slow heartbeat, NO drums
    // Creates a sense of mystery: "what is this?"
    // ════════════════════════════════════════════════════════════════════════
    at(0.0, (t) => {
      // Drone fades in slowly over 3s
      droneGain.gain.setValueAtTime(0, t);
      droneGain.gain.linearRampToValueAtTime(0.6, t + 3.0);
      // Very soft dissonant tension pad (minor 2nd: A + Bb)
      this.pad.triggerAttack(["A3", "Bb3"], t, 0.12);
    });

    // Slow heartbeat pulse (every 1.8s)
    [0.8, 2.6, 4.4, 6.2, 8.0].forEach((sec) => {
      at(sec, (t) => {
        this.kick.triggerAttackRelease("A0", "16n", t, 0.25); // very soft, sub
      });
    });

    // High tension: add E4 (creates Am feels, less dissonance) at 5s
    at(5.0, (t) => {
      this.pad.triggerAttack(["E4"], t, 0.15);
    });

    // ════════════════════════════════════════════════════════════════════════
    // BEFORE (10–16s) — TENSION BUILDS
    // ════════════════════════════════════════════════════════════════════════
    at(10.0, (t) => {
      this.pad.releaseAll(t);
      this.pad.triggerAttack(["D3", "F3", "A3"], t, 0.30); // Dm — darker
      this.bass.triggerAttackRelease("D1", "2n", t, 0.4);
    });
    // Heartbeat accelerates (every 1.2s)
    [10.5, 11.7, 12.9, 14.1, 15.3].forEach((sec) => {
      at(sec, (t) => {
        this.kick.triggerAttackRelease("A0", "16n", t, 0.35);
      });
    });

    // ════════════════════════════════════════════════════════════════════════
    // SLAM (16–17.8s) — RISER → RELEASE
    // ════════════════════════════════════════════════════════════════════════
    at(14.5, (t) => {
      // Riser begins 1.5s before slam
      this.riserGain.gain.setValueAtTime(0, t);
      this.riserGain.gain.linearRampToValueAtTime(0.7, t + 1.4);
      this.riser.frequency.setValueAtTime(80, t);
      this.riser.frequency.exponentialRampToValueAtTime(600, t + 1.4);
      // Heartbeat accelerates further
    });
    at(15.5, (t) => { this.kick.triggerAttackRelease("A0", "16n", t, 0.5); });
    at(15.9, (t) => { this.kick.triggerAttackRelease("A0", "16n", t, 0.6); });
    at(15.98, (t) => {
      // Silence just before hit
      this.pad.releaseAll(t);
      this.riserGain.gain.linearRampToValueAtTime(0, t + 0.1);
    });
    at(16.0, (t) => {
      // SLAM hit — moderate, not the big boom (saved for split)
      this.kick.triggerAttackRelease("C1", "8n", t, 0.8);
      this.pad.triggerAttack(["A3", "C4", "E4"], t, 0.5); // Am chord opens
      this.bass.triggerAttackRelease("A1", "4n", t, 0.7);
    });
    at(16.5, (t) => { this.snare.triggerAttackRelease("8n", t, 0.5); });

    // ════════════════════════════════════════════════════════════════════════
    // FEATURES (17.8+) — SYNCHRONIZED HITS ON EACH CARD
    // Each card entrance gets its own beat hit — the beat BUILDS each card
    // ════════════════════════════════════════════════════════════════════════
    p.cardHitTimes.forEach((cardTime, i) => {
      at(cardTime, (t) => {
        // Card 1: single kick
        // Card 2: kick + snare
        // Card 3: kick + snare + hat pattern starts
        // Card 4: kick + snare + bass
        // Card 5: full energy + riser begins
        this.kick.triggerAttackRelease("C1", "8n", t, 0.7 + i * 0.06);

        if (i >= 1) {
          this.snare.triggerAttackRelease("8n", t + 0.5, 0.5 + i * 0.05);
        }
        if (i >= 2) {
          // Chord accent on card 3+
          const chords = [
            ["A3","C4","E4"],  // Am
            ["F3","A3","C4"],  // F
            ["C4","E4","G4"],  // C
          ];
          const ch = chords[i % chords.length];
          this.pad.releaseAll(t);
          this.pad.triggerAttack(ch, t, 0.55 + i * 0.05);
          this.bass.triggerAttackRelease(ch[0].replace(/[0-9]/, "1"), "4n", t, 0.65);
        }
        if (i >= 2) {
          // Hat pattern starts from card 3
          if (i === 2) {
            const hatSeq = new Tone.Sequence((t2) => {
              this.hat.triggerAttackRelease("16n", t2, 0.45);
            }, [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5], "8n");
            hatSeq.start(t);
            this.seqs.push(hatSeq);
          }
        }
        if (i >= 3) {
          // Full beat from card 4
          if (i === 3) {
            const kickSeq = new Tone.Sequence((t2) => {
              this.kick.triggerAttackRelease("C1", "8n", t2, 0.75);
            }, ["C1", null, null, null, "C1", null, null, null], "8n");
            const snareSeq = new Tone.Sequence((t2) => {
              this.snare.triggerAttackRelease("8n", t2, 0.6);
            }, [null, null, "C2", null, null, null, "C2", null], "8n");
            kickSeq.start(t);
            snareSeq.start(t);
            this.seqs.push(kickSeq, snareSeq);
          }
        }
        if (i === 4) {
          // Card 5: lead melody begins
          const melody = ["E4","D4","C4","A3","G3","A3","C4","E4"];
          melody.forEach((note, j) => {
            const mt = cardTime + j * 0.7;
            if (mt < p.featuresEnd - 1) {
              at(mt, (t2) => { this.lead.triggerAttackRelease(note, "4n", t2, 0.5); });
            }
          });
        }
      });

      // Bass walk on every card (offbeat)
      at(cardTime + 1.5, (t) => {
        if (i >= 2) {
          this.bass.triggerAttackRelease("A1", "4n", t, 0.55);
        }
      });
      at(cardTime + 3.0, (t) => {
        if (i >= 3) {
          this.kick.triggerAttackRelease("C1", "8n", t, 0.7);
        }
      });
    });

    // ════════════════════════════════════════════════════════════════════════
    // PRE-BOOM RISER (starts 2.5s before split)
    // ════════════════════════════════════════════════════════════════════════
    at(p.featuresEnd - 2.5, (t) => {
      this.riser.frequency.setValueAtTime(100, t);
      this.riser.frequency.exponentialRampToValueAtTime(1200, t + 2.3);
      this.riserGain.gain.setValueAtTime(0, t);
      this.riserGain.gain.linearRampToValueAtTime(0.9, t + 2.2);
      // Stop hat/beat sequences so the boom hits clean
      this.seqs.forEach(s => { try { s.stop(t + 2.4); } catch {} });
    });
    at(p.featuresEnd - 0.1, (t) => {
      // Silence 0.1s before boom
      this.riserGain.gain.linearRampToValueAtTime(0, t + 0.08);
      this.pad.releaseAll(t);
    });

    // ════════════════════════════════════════════════════════════════════════
    // THE BOOM (split start) — PEAK OF THE ENTIRE VIDEO
    // ════════════════════════════════════════════════════════════════════════
    at(p.featuresEnd, (t) => {
      this.kick.triggerAttackRelease("C1", "4n", t, 1.0);      // massive kick
      this.snare.triggerAttackRelease("4n", t, 1.0);           // big snare
      this.pad.triggerAttack(["A2","A3","E4","A4"], t, 1.0);   // full Am chord, loud
      this.bass.triggerAttackRelease("A1", "2n", t, 1.0);      // heavy bass
      this.lead.triggerAttackRelease("A5", "2n", t, 0.7);      // highest note — emotional peak
    });
    // Echo hit
    at(p.featuresEnd + 0.5, (t) => {
      this.kick.triggerAttackRelease("C1", "8n", t, 0.5);
      this.snare.triggerAttackRelease("8n", t, 0.4);
    });

    // ════════════════════════════════════════════════════════════════════════
    // SPLIT (42.8+) — VIDA! Ritmo acelerado, antes/depois com energia
    // Double-time feel: hat em 16ths, kick offbeat, bass walking
    // ════════════════════════════════════════════════════════════════════════
    at(p.featuresEnd + 1.0, (t) => {
      // Kick on EVERY beat (4-on-the-floor) + offbeat ghost kick
      const splitKick = new Tone.Sequence((t2) => {
        this.kick.triggerAttackRelease("C1", "8n", t2, 0.75);
      }, ["C1", null, "C1", null, "C1", null, "C1", null], "8n");

      // Snare on 2+4, with ghost on the "e" of beat 3
      const splitSnare = new Tone.Sequence((t2, val) => {
        if (val) this.snare.triggerAttackRelease("8n", t2, val as number);
      }, [null, null, 0.65, null, null, 0.30, 0.65, null], "8n");

      // Hat: 16th notes — double speed = double energy
      const splitHat = new Tone.Sequence((t2, val) => {
        if (val) this.hat.triggerAttackRelease("32n", t2, val as number);
      }, [0.55, 0.30, 0.55, 0.30, 0.55, 0.30, 0.55, 0.30,
          0.55, 0.30, 0.55, 0.30, 0.55, 0.30, 0.55, 0.30], "16n");

      splitKick.start(t);
      splitSnare.start(t);
      splitHat.start(t);
      this.seqs.push(splitKick, splitSnare, splitHat);

      // Chord: Am driving
      this.pad.releaseAll(t);
      this.pad.triggerAttack(["A3","C4","E4"], t, 0.70);
      this.bass.triggerAttackRelease("A1", "4n", t, 0.80);
    });

    // Bass walking — fills the offbeats for groove
    [1.5, 2.0, 2.5, 3.5, 4.0, 4.5, 5.5, 6.0, 6.5, 7.5, 8.0, 8.5].forEach((off) => {
      at(p.featuresEnd + off, (t) => {
        const bNotes = ["A1","E1","G1","A1","F1","C2","A1","E1","G1","D1","A1","C2"];
        const i = Math.round(off * 2) % bNotes.length;
        this.bass.triggerAttackRelease(bNotes[i], "8n", t, 0.50);
      });
    });

    // Chord changes every 4s: Am → F → C → Am
    at(p.featuresEnd + 5.0, (t) => {
      this.pad.releaseAll(t);
      this.pad.triggerAttack(["F3","A3","C4"], t, 0.68); // F
    });
    at(p.featuresEnd + 9.0, (t) => {
      this.pad.releaseAll(t);
      this.pad.triggerAttack(["C4","E4","G4"], t, 0.70); // C
      this.lead.triggerAttackRelease("C5", "2n", t, 0.55);
    });
    at(p.featuresEnd + 13.0, (t) => {
      this.pad.releaseAll(t);
      this.pad.triggerAttack(["A3","C4","E4","G4"], t, 0.72); // Am7 — LENS moment
      this.lead.triggerAttackRelease("E5", "2n", t, 0.60);
    });

    // Split melody — more energetic, tighter
    const splitMelody = ["E4","G4","A4","G4","E4","D4","C4","E4","G4","A4","E4","D4"];
    splitMelody.forEach((note, j) => {
      const mt = p.featuresEnd + 1.5 + j * 0.75;
      if (mt < p.splitEnd - 2) {
        at(mt, (t) => { this.lead.triggerAttackRelease(note, "8n", t, 0.48); });
      }
    });

    // ════════════════════════════════════════════════════════════════════════
    // OUTRO (57.8+) — O NOME LENS FICA NA MEMÓRIA
    // Acorde ressonante, melodia que sobe, fade lento e suave
    // ════════════════════════════════════════════════════════════════════════
    at(p.splitEnd, (t) => {
      // Stop all sequences
      this.seqs.forEach(s => { try { s.stop(t); } catch {} });

      // Am chord — limpo, ressonante, com muito reverb
      this.pad.releaseAll(t);
      this.pad.triggerAttack(["A2","A3","E4","A4"], t, 0.80);
      this.bass.triggerAttackRelease("A1", "1n", t, 0.60);

      // Kick único — ponto final do ritmo
      this.kick.triggerAttackRelease("C1", "8n", t, 0.85);
      this.snare.triggerAttackRelease("8n", t, 0.60);

      // Inicia fade gradual a partir daqui — exponencial (mais natural)
      this.masterVol.volume.setValueAtTime(-3, t);
      this.masterVol.volume.exponentialRampToValueAtTime(0.001, t + (p.outroEnd - p.splitEnd));
    });

    // Motivo final ascendente — "LENS" fica na memória
    // Cada nota sobe — cria sensação de abertura, de possibilidade
    at(p.splitEnd + 0.8, (t) => { this.lead.triggerAttackRelease("A4", "4n", t, 0.55); });
    at(p.splitEnd + 1.8, (t) => { this.lead.triggerAttackRelease("C5", "4n", t, 0.50); });
    at(p.splitEnd + 2.8, (t) => { this.lead.triggerAttackRelease("E5", "2n", t, 0.45); });
    at(p.splitEnd + 4.5, (t) => { this.lead.triggerAttackRelease("A5", "1n", t, 0.35); }); // nota mais alta — fica a tocar

    at(p.outroEnd - 0.5, (t) => {
      this.pad.releaseAll(t);
      droneGain.gain.linearRampToValueAtTime(0, t + 0.4);
    });
  }

  start(): void {
    if (this.initialized) Tone.Transport.start();
  }

  getOutputStream(): MediaStream {
    return this.mediaDest.stream;
  }

  dispose(): void {
    try { Tone.Transport.stop(); Tone.Transport.cancel(0); } catch {}
    this.seqs.forEach(s => { try { s.dispose(); } catch {} });
    const instruments = [
      this.kick, this.snare, this.hat, this.pad, this.bass,
      this.lead, this.drone, this.riser, this.riserGain,
      this.padFx, this.leadFx, this.masterVol, this.limiter,
    ];
    instruments.forEach(i => { try { (i as any)?.dispose(); } catch {} });
    this.seqs = [];
    this.initialized = false;
  }
}
