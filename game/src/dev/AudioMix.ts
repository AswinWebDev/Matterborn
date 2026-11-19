// Dev-only: gives trailer captures a soundtrack in perfect sync. While Capture records, the game's
// Audio sends every effect, narrator line, music change and ambience level here (stamped with the
// capture clock) instead of playing it; at the end the same mix is rendered offline (same buses,
// loudness normalisation, ducking and narration queue rules as the live game) and encoded as AAC
// into the MP4.

import type { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { peakWindowRms, type AudioTap, type VoiceMode, type AmbienceId } from '../audio/Audio';

type Ev =
  | { t: number; kind: 'sfx'; id: string; vol: number; rate: number; pan: number }
  | { t: number; kind: 'voice'; id: string; mode: VoiceMode }
  | { t: number; kind: 'music'; id: string | null; level: number; fade: number }
  | { t: number; kind: 'amb'; levels: Record<string, number> };

const BASE = `${import.meta.env.BASE_URL}audio/`;

/** Teaser mixing: drop the game's narration and music, add a score, narration and hits at fixed times. */
export interface MixOptions {
  gameVoice?: boolean;
  gameMusic?: boolean;
  sfxScale?: number;
  ambScale?: number;
  score?: { id: string; t: number; level: number };
  lines?: { id: string; t: number }[];
  hits?: { id: string; t: number; vol: number }[];
}

export class AudioRecorder implements AudioTap {
  /** Capture clock (seconds of video) of the frame being recorded. */
  now = 0;
  /** False while the capture skips time (cuts, setups): nothing heard then. */
  live = false;
  readonly events: Ev[] = [];
  private musicState: { id: string | null; level: number; fade: number } = { id: null, level: 0, fade: 1 };
  private ambState: Record<string, number> = {};
  private loggedMusic = '';
  private loggedAmb = '';

  sfx(id: string, vol: number, rate: number, pan: number) {
    if (this.live) this.events.push({ t: this.now, kind: 'sfx', id, vol, rate, pan });
  }
  voice(id: string, mode: VoiceMode) {
    if (this.live) this.events.push({ t: this.now, kind: 'voice', id, mode });
  }
  music(id: string | null, level: number, fade: number) {
    this.musicState = { id, level, fade };
  }
  amb(levels: Partial<Record<AmbienceId, number>>) {
    const r: Record<string, number> = {};
    for (const [k, v] of Object.entries(levels)) if (v && v > 0.005) r[k] = Math.round(v * 100) / 100;
    this.ambState = r;
  }
  /** Once per recorded frame: log music and ambience state whenever it has changed. */
  tick() {
    const m = JSON.stringify(this.musicState);
    if (m !== this.loggedMusic) {
      this.loggedMusic = m;
      this.events.push({ t: this.now, kind: 'music', ...this.musicState });
    }
    const a = JSON.stringify(this.ambState);
    if (a !== this.loggedAmb) {
      this.loggedAmb = a;
      this.events.push({ t: this.now, kind: 'amb', levels: { ...this.ambState } });
    }
  }
}

function impulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Render the recorded events to a stereo buffer `duration` seconds long. */
export async function renderMix(allEvents: Ev[], duration: number, sampleRate = 48000, opts: MixOptions = {}) {
  const events = allEvents.filter(
    (e) => !(e.kind === 'voice' && opts.gameVoice === false) && !(e.kind === 'music' && opts.gameMusic === false) && !(e.kind === 'sfx' && opts.score && e.id.startsWith('mus_')),
  );
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const need = new Set<string>();
  for (const e of events) {
    if (e.kind === 'sfx' || e.kind === 'voice') need.add(e.id);
    else if (e.kind === 'music' && e.id) need.add(e.id);
    else if (e.kind === 'amb') for (const k of Object.keys(e.levels)) need.add(k);
  }
  if (opts.score) need.add(opts.score.id);
  for (const l of opts.lines ?? []) need.add(l.id);
  for (const h of opts.hits ?? []) need.add(h.id);
  const bufs = new Map<string, { buf: AudioBuffer; norm: number }>();
  await Promise.all(
    [...need].map(async (id) => {
      try {
        const r = await fetch(`${BASE}${id}.mp3`);
        if (!r.ok) return;
        const buf = await ctx.decodeAudioData(await r.arrayBuffer());
        const rms = peakWindowRms(buf);
        const target = id.startsWith('vo_') ? 0.17 : id.startsWith('amb_') || id.startsWith('mus_') ? 0.14 : 0.2;
        bufs.set(id, { buf, norm: rms > 1e-4 ? Math.min(3, Math.max(0.25, target / rms)) : 1 });
      } catch {
        /* a missing file is simply silent in the mix */
      }
    }),
  );

  // the live game's buses (Audio.start)
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  // video mixes are played on phones and laptops: a little makeup gain, then a brick-wall limiter
  const makeup = ctx.createGain();
  makeup.gain.value = 1.7;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  const ceiling = ctx.createGain();
  ceiling.gain.value = 0.89; // about -1 dBFS
  master.connect(comp).connect(makeup).connect(limiter).connect(ceiling).connect(ctx.destination);
  const bus = (g: number) => {
    const n = ctx.createGain();
    n.gain.value = g;
    n.connect(master);
    return n;
  };
  const sfxBus = bus(0.85);
  const voiceBus = bus(1);
  const ambBus = bus(0.5);
  const trackBus = bus(opts.score ? 0.95 : 0.42);
  const trackLevel = trackBus.gain.value;
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 3.8, 2.6);
  reverb.connect(master);
  for (const [from, g] of [[sfxBus, 0.18], [voiceBus, 0.06]] as const) {
    const s = ctx.createGain();
    s.gain.value = g;
    from.connect(s).connect(reverb);
  }

  // narration, with the live queue / drop / interrupt rules
  const talk: [number, number][] = [];
  let voiceEnd = 0;
  let current: AudioBufferSourceNode | null = null;
  const queue: string[] = [];
  const startVoice = (id: string, at: number) => {
    const s = bufs.get(id);
    if (!s) return;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    const g = ctx.createGain();
    g.gain.value = s.norm;
    src.connect(g).connect(voiceBus);
    src.start(at);
    current = src;
    voiceEnd = at + s.buf.duration;
    talk.push([at, voiceEnd]);
  };
  const flush = (until: number) => {
    while (queue.length && voiceEnd + 0.2 <= until) startVoice(queue.shift()!, voiceEnd + 0.2);
  };
  for (const e of events) {
    if (e.kind !== 'voice') continue;
    flush(e.t);
    const busy = e.t < voiceEnd - 0.05;
    if (busy && e.mode === 'drop') continue;
    if (busy && e.mode === 'queue') {
      queue.push(e.id);
      continue;
    }
    if (busy) {
      queue.length = 0;
      try {
        (current as AudioBufferSourceNode | null)?.stop(e.t);
      } catch {
        /* already scheduled to end */
      }
      if (talk.length) talk[talk.length - 1][1] = e.t;
    }
    startVoice(e.id, e.t + 0.02);
  }
  flush(Infinity);
  // the teaser's own narration at fixed times
  for (const l of opts.lines ?? []) startVoice(l.id, l.t);
  const duck = opts.score ? 0.62 : 0.45;
  for (const [s, e] of talk) {
    trackBus.gain.setTargetAtTime(trackLevel * duck, s, 0.12);
    trackBus.gain.setTargetAtTime(trackLevel, e, 0.6);
    ambBus.gain.setTargetAtTime(0.5 * 0.6, s, 0.12);
    ambBus.gain.setTargetAtTime(0.5, e, 0.6);
  }

  // music: one looping source per stretch of the same track
  let cur: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  for (const e of events) {
    if (e.kind !== 'music') continue;
    const tc = Math.max(0.05, e.fade / 3);
    if (cur && cur.id !== e.id) {
      cur.gain.gain.setTargetAtTime(0, e.t, tc);
      cur.src.stop(e.t + e.fade + 1.5);
      cur = null;
    }
    if (!e.id) continue;
    if (!cur) {
      const s = bufs.get(e.id);
      if (!s) continue;
      const src = ctx.createBufferSource();
      src.buffer = s.buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(trackBus);
      src.start(e.t);
      cur = { id: e.id, src, gain };
    }
    cur.gain.gain.setTargetAtTime(e.level, e.t, tc);
  }

  // ambience beds
  const beds = new Map<string, GainNode>();
  for (const e of events) {
    if (e.kind !== 'amb') continue;
    for (const id of new Set([...beds.keys(), ...Object.keys(e.levels)])) {
      const want = e.levels[id] ?? 0;
      let g = beds.get(id);
      if (!g) {
        const s = bufs.get(id);
        if (want <= 0.01 || !s) continue;
        const src = ctx.createBufferSource();
        src.buffer = s.buf;
        src.loop = true;
        src.loopStart = Math.min(0.05, s.buf.duration * 0.1);
        src.loopEnd = Math.max(src.loopStart + 0.1, s.buf.duration - 0.05);
        g = ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(ambBus);
        src.start(e.t, Math.random() * s.buf.duration * 0.8);
        beds.set(id, g);
      }
      g.gain.setTargetAtTime(want * (bufs.get(id)?.norm ?? 1) * (opts.ambScale ?? 1), e.t, 0.8);
    }
  }

  // the teaser score: one take from its start
  if (opts.score) {
    const s = bufs.get(opts.score.id);
    if (s) {
      const src = ctx.createBufferSource();
      src.buffer = s.buf;
      const g = ctx.createGain();
      g.gain.value = opts.score.level;
      src.connect(g).connect(trackBus);
      src.start(opts.score.t);
    }
  }
  // the teaser's hits
  for (const h of opts.hits ?? []) {
    const s = bufs.get(h.id);
    if (!s) continue;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    const g = ctx.createGain();
    g.gain.value = h.vol * s.norm;
    src.connect(g).connect(sfxBus);
    src.start(h.t);
  }
  // effects
  for (const e of events) {
    if (e.kind !== 'sfx') continue;
    const s = bufs.get(e.id);
    if (!s) continue;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = e.rate;
    const g = ctx.createGain();
    g.gain.value = e.vol * s.norm * (opts.sfxScale ?? 1);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, e.pan));
    src.connect(g).connect(p).connect(sfxBus);
    src.start(e.t);
  }
  return ctx.startRendering();
}

/** Encode a rendered mix as AAC into the capture's MP4 muxer. */
export async function encodeAac(buf: AudioBuffer, muxer: Muxer<ArrayBufferTarget>) {
  let err: Error | null = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (err = e as Error) });
  enc.configure({ codec: 'mp4a.40.2', sampleRate: buf.sampleRate, numberOfChannels: 2, bitrate: 192_000 });
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const step = 4800;
  for (let i = 0; i < buf.length; i += step) {
    const n = Math.min(step, buf.length - i);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0);
    data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / buf.sampleRate) * 1e6), data });
    enc.encode(ad);
    ad.close();
    if (enc.encodeQueueSize > 20) await new Promise((r) => enc.addEventListener('dequeue', r, { once: true }));
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
}
