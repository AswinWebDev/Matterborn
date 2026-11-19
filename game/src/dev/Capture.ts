// Dev-only frame-by-frame recorder for trailer footage and report stills. It drives the real
// game loop one frame at a time (independent of requestAnimationFrame, so a hidden window still
// records smooth 60 fps), redraws the DOM overlay (letterbox, fades, story text, title cards)
// on a 2D canvas from the UI's game-clock state, and encodes H.264 with WebCodecs into an MP4
// that the dev server saves under capture/. Never part of the production bundle.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Game } from '../Game';
import { FORMS, FORM_ORDER } from '../actors/forms';
import { yieldTask } from '../core/yieldTask';
import { AudioRecorder, renderMix, encodeAac, type MixOptions } from './AudioMix';

export interface Caption {
  text: string;
  sub?: string;
  from: number; // seconds on the capture clock
  to: number;
  pos?: 'low' | 'high' | 'center';
  size?: number;
}

async function upload(name: string, body: Blob | ArrayBuffer) {
  const res = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`saving ${name} failed: ${res.status}`);
  return res.json();
}

export class Capture {
  readonly W: number;
  readonly H: number;
  readonly fps: number;
  /** Seconds of video recorded so far. */
  clock = 0;
  captions: Caption[] = [];
  showHud = true;
  showHints = false;
  /** Extra full-frame fade drawn by the capture script (0..1), for cuts between shots. */
  cut = 0;
  /** Big centred words on the capture clock (teaser beats). */
  words: { text: string; from: number; to: number; size?: number }[] = [];
  /** Draw fixed cinematic letterbox bars on every frame. */
  bars = false;
  /** How the recorded sound is mixed (teaser: its own score and narration over the game's effects). */
  mix: MixOptions = {};
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private encoder: VideoEncoder | null = null;
  private muxer: Muxer<ArrayBufferTarget> | null = null;
  private frameIndex = 0;
  private encodeError: Error | null = null;
  /** Records the game's sound for an AAC track (opts.audio). */
  private rec: AudioRecorder | null = null;
  private readonly withAudio: boolean;

  constructor(
    readonly game: Game,
    opts: { width?: number; height?: number; fps?: number; audio?: boolean } = {},
  ) {
    this.withAudio = !!opts.audio;
    this.W = opts.width ?? 1920;
    this.H = opts.height ?? 1080;
    this.fps = opts.fps ?? 60;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Take over the loop and render at the capture size. Pass a name to also record video. */
  async begin(videoName?: string, bitrate = 16_000_000) {
    await document.fonts.ready;
    this.game.manual = true;
    this.game.renderer.setFixedSize(this.W, this.H);
    this.clock = 0;
    this.frameIndex = 0;
    if (!videoName) return;
    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: this.W, height: this.H, frameRate: this.fps },
      audio: this.withAudio ? { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 } : undefined,
      fastStart: 'in-memory',
    });
    if (this.withAudio) {
      this.rec = new AudioRecorder();
      this.game.audio.recorder = this.rec;
    }
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer!.addVideoChunk(chunk, meta),
      error: (e) => (this.encodeError = e as Error),
    });
    this.encoder.configure({ codec: 'avc1.640033', width: this.W, height: this.H, bitrate, framerate: this.fps, latencyMode: 'quality' });
    this.videoName = videoName;
  }
  private videoName = '';

  /** Advance and record `seconds` of game time; `perFrame` runs before each frame (inputs, camera). */
  async run(seconds: number, perFrame?: (t: number) => void | Promise<void>) {
    const n = Math.max(1, Math.round(seconds * this.fps));
    for (let i = 0; i < n; i++) {
      if (perFrame) await perFrame(i / this.fps);
      await this.frame();
    }
  }

  /** Advance game time without recording (settling after a teleport, cuts between shots). */
  async skip(seconds: number) {
    const n = Math.max(1, Math.round(seconds * this.fps));
    if (this.rec) this.rec.live = false;
    for (let i = 0; i < n; i++) {
      this.game.advance(1 / this.fps);
      await yieldTask();
    }
  }

  /** One frame: step the game, composite the overlay and encode. */
  async frame() {
    if (this.encodeError) throw this.encodeError;
    if (this.rec) {
      this.rec.now = this.clock;
      this.rec.live = true;
    }
    this.game.advance(1 / this.fps);
    this.rec?.tick();
    this.composite();
    if (this.encoder) {
      const vf = new VideoFrame(this.canvas, { timestamp: Math.round((this.frameIndex * 1e6) / this.fps), duration: Math.round(1e6 / this.fps) });
      this.encoder.encode(vf, { keyFrame: this.frameIndex % (this.fps * 2) === 0 });
      vf.close();
      while (this.encoder.encodeQueueSize > 6) await new Promise((r) => this.encoder!.addEventListener('dequeue', r, { once: true }));
    }
    this.frameIndex++;
    this.clock += 1 / this.fps;
    await yieldTask();
  }

  /** Save the current composite as a PNG (call right after frame()). */
  async still(name: string) {
    this.composite(); // redraw: the WebGL buffer is only valid within the task that rendered it
    const blob = await new Promise<Blob>((r) => this.canvas.toBlob((b) => r(b!), 'image/png'));
    return upload(name.endsWith('.png') ? name : `${name}.png`, blob);
  }

  /** Render one frame without advancing time and save it (for report screenshots). */
  async snap(name: string) {
    this.game.renderer.render(0);
    return this.still(name);
  }

  async end() {
    let saved: unknown = null;
    if (this.encoder && this.muxer) {
      await this.encoder.flush();
      this.encoder.close();
      if (this.rec) await encodeAac(await renderMix(this.rec.events, this.clock, 48000, this.mix), this.muxer);
      this.muxer.finalize();
      saved = await upload(this.videoName, this.muxer.target.buffer);
    }
    this.encoder = null;
    this.muxer = null;
    if (this.rec) this.game.audio.recorder = null;
    this.rec = null;
    this.game.renderer.clearFixedSize();
    this.game.manual = false;
    return saved;
  }

  // ------------------------------------------------------------------- overlay compositor
  private composite() {
    const { ctx, W, H } = this;
    const gl = this.game.renderer.gl.domElement;
    ctx.globalAlpha = 1;
    ctx.drawImage(gl, 0, 0, W, H);
    const s = this.game.ui.snapshot();
    const vh = H / 100;
    const cinematic = s.letterbox > 0.01;

    if (this.showHud && !cinematic && this.game.state === 'play') this.drawForms();
    if (this.showHints && s.hint.alpha > 0.01 && !cinematic) this.pill(s.hint.text, W / 2, H - 52, 26, s.hint.alpha);

    if (s.title && this.game.state === 'title') {
      this.text('MATTERBORN', W / 2, H * 0.43, `600 ${Math.round(H * 0.12)}px Cinzel`, '#fff5e6', 1, 0.2, 42);
      this.text('Become what the world needs', W / 2, H * 0.52, `italic ${Math.round(H * 0.034)}px "Cormorant Garamond"`, 'rgba(246,234,219,0.85)', 1);
    }
    if (s.titleCard.alpha > 0.01) {
      const rise = Math.min(1, s.titleCard.age / 2.4);
      const spacing = 0.5 - 0.28 * (1 - Math.pow(1 - rise, 3));
      this.text(s.titleCard.main, W / 2, H * 0.5, `600 ${Math.round(H * 0.105)}px Cinzel`, '#fff5e6', s.titleCard.alpha * Math.min(1, rise * 1.6), spacing, 40);
      if (s.titleCard.sub) this.text(s.titleCard.sub, W / 2, H * 0.5 + H * 0.085, `italic ${Math.round(H * 0.03)}px "Cormorant Garamond"`, 'rgba(246,234,219,0.75)', s.titleCard.alpha);
    }
    if (s.story.alpha > 0.01) {
      const y = H - 14 * vh - 10;
      const lines = this.wrap(s.story.text, `italic ${Math.round(H * 0.037)}px "Cormorant Garamond"`, W * 0.78);
      lines.forEach((l, i) => this.text(l, W / 2, y - (lines.length - 1 - i) * H * 0.045 - (s.story.sub ? H * 0.03 : 0), `italic ${Math.round(H * 0.037)}px "Cormorant Garamond"`, '#f6eadb', s.story.alpha, 0, 18));
      if (s.story.sub) this.text(s.story.sub, W / 2, y + H * 0.004, `italic ${Math.round(H * 0.024)}px "Cormorant Garamond"`, 'rgba(246,234,219,0.7)', s.story.alpha);
    }
    if (s.letterbox > 0.001 || this.bars) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      const h = 11 * vh * (this.bars ? 1 : s.letterbox);
      ctx.fillRect(0, 0, W, h);
      ctx.fillRect(0, H - h, W, h);
    }
    for (const w of this.words) {
      if (this.clock < w.from || this.clock > w.to) continue;
      const k = Math.min(1, (this.clock - w.from) / 0.1, (w.to - this.clock) / 0.12);
      const grow = 1 + (this.clock - w.from) * 0.04;
      this.text(w.text, W / 2, H * 0.53, `600 ${Math.round(H * (w.size ?? 0.14) * grow)}px Cinzel`, '#fff5e6', k, 0.32, 46);
    }
    for (const c of this.captions) {
      if (this.clock < c.from || this.clock > c.to) continue;
      const k = Math.min(1, (this.clock - c.from) / 0.35, (c.to - this.clock) / 0.35);
      this.caption(c, k);
    }
    if (s.fade > 0.001) {
      ctx.globalAlpha = s.fade;
      ctx.fillStyle = s.fadeColor;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.cut > 0.001) {
      ctx.globalAlpha = Math.min(1, this.cut);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  private text(t: string, x: number, y: number, font: string, color: string, alpha: number, spacingEm = 0, glow = 14) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = spacingEm ? `${spacingEm}em` : '0px';
    ctx.shadowColor = glow > 20 ? 'rgba(255,170,80,0.55)' : 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = glow;
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
    ctx.restore();
  }

  private wrap(t: string, font: string, max: number) {
    this.ctx.font = font;
    const words = t.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (this.ctx.measureText(next).width > max && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  private pill(t: string, x: number, y: number, px: number, alpha: number) {
    const { ctx } = this;
    ctx.save();
    ctx.font = `500 ${px}px Inter`;
    const w = ctx.measureText(t).width + px * 1.6;
    const h = px * 2;
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = '#08080e';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.restore();
    this.text(t, x, y + 1, `500 ${px}px Inter`, '#f6eadb', alpha, 0, 6);
  }

  private caption(c: Caption, k: number) {
    const { W, H } = this;
    const px = c.size ?? Math.round(H * 0.05);
    const y = c.pos === 'high' ? H * 0.17 : c.pos === 'center' ? H * 0.5 : H * 0.8;
    const font = `700 ${px}px Inter`;
    const lines = this.wrap(c.text, font, W * 0.8);
    const lh = px * 1.22;
    const top = y - ((lines.length - 1) * lh) / 2 - (c.sub ? px * 0.45 : 0);
    const ctx = this.ctx;
    ctx.save();
    ctx.font = font;
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 1.4;
    const bh = lines.length * lh + px * 0.7 + (c.sub ? px * 0.95 : 0);
    ctx.globalAlpha = 0.5 * k;
    ctx.fillStyle = '#05060a';
    ctx.beginPath();
    ctx.roundRect(W / 2 - bw / 2, top - lh / 2 - px * 0.35, bw, bh, px * 0.4);
    ctx.fill();
    ctx.restore();
    lines.forEach((l, i) => this.text(l, W / 2, top + i * lh, font, '#fff7ec', k, 0, 10));
    if (c.sub) this.text(c.sub, W / 2, top + (lines.length - 1) * lh + px * 1.05, `500 ${Math.round(px * 0.55)}px Inter`, '#ffcf8f', k, 0, 8);
  }

  private drawForms() {
    const p = this.game.player;
    if (!p || p.unlocked.size < 2) return;
    const { ctx, H } = this;
    const r = H * 0.022;
    let x = H * 0.05;
    const y = H - H * 0.07;
    ctx.save();
    for (const f of FORM_ORDER) {
      const unlocked = p.unlocked.has(f);
      const active = p.form === f;
      const col = `#${FORMS[f].emissive.toString(16).padStart(6, '0')}`;
      ctx.globalAlpha = unlocked ? (active ? 1 : 0.55) : 0.18;
      ctx.beginPath();
      ctx.arc(x, y, active ? r * 1.25 : r, 0, Math.PI * 2);
      ctx.fillStyle = unlocked ? col : '#333';
      ctx.shadowColor = col;
      ctx.shadowBlur = active ? 24 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (unlocked) {
        ctx.font = `600 ${Math.round(H * 0.016)}px Inter`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f6eadb';
        ctx.fillText(FORMS[f].label, x, y + r * 2.4);
      }
      x += r * 3.6;
    }
    ctx.restore();
  }
}
