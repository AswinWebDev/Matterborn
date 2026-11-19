// DOM overlay: title screen, HUD (form wheel), hints, letterbox, fades, story text, pause,
// skip indicator and credits.

import { FORMS, FORM_ORDER, Form } from '../actors/forms';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class UI {
  private hintEl = $('#hint');
  private formsEl = $('#forms');
  private letterTop = $('#letterbox-top');
  private letterBottom = $('#letterbox-bottom');
  private fadeEl = $('#fade');
  private storyEl = $('#story');
  private titleCard = $('#titlecard');
  private skipEl = $('#skip');
  private skipBar = $('#skip-bar');
  private pauseEl = $('#pause');
  private titleEl = $('#title');
  private loadingEl = $('#loading');
  private loadingBar = $('#loading-bar');
  private creditsEl = $('#credits');
  private toastEl = $('#toast');
  private hintTimer = 0;
  private currentHint: string | null = null;

  // Logical copy of the overlay state on the game clock, so the capture tool can redraw the
  // overlay frame by frame (the DOM version animates with CSS in real time).
  clock: () => number = () => performance.now() / 1000;
  private lb = { on: false, t: -99, from: 0 };
  private fd = { from: 0, to: 0, t: -99, sec: 1, color: '#000' };
  private st = { text: '', sub: '', show: false, t: -99, from: 0 };
  private tc = { main: '', sub: '', show: false, t: -99, from: 0 };
  private hn = { text: '', show: false, t: -99, from: 0 };
  private cr = { show: false, t: -99 };
  private titleShown = false;

  constructor() {
    this.formsEl.innerHTML = FORM_ORDER.map(
      (f, i) => `<div class="slot locked" data-form="${f}" style="--c:#${FORMS[f].emissive.toString(16).padStart(6, '0')}"><span class="key">${i + 1}</span><span class="gem"></span><span class="name">${FORMS[f].label}</span></div>`,
    ).join('');
  }

  setLoading(k: number, text?: string) {
    this.loadingBar.style.width = `${Math.round(k * 100)}%`;
    if (text) $('#loading-text').textContent = text;
  }
  hideLoading() {
    this.loadingEl.classList.add('hidden');
    // do not rely on the CSS transition finishing (background tabs pause transitions)
    window.setTimeout(() => this.loadingEl.remove(), 900);
  }
  showTitle(show: boolean) {
    this.titleShown = show;
    this.titleEl.classList.toggle('hidden', !show);
  }

  setForms(unlocked: Set<Form>, current: Form) {
    this.formsEl.querySelectorAll<HTMLElement>('.slot').forEach((el) => {
      const f = el.dataset.form as Form;
      el.classList.toggle('locked', !unlocked.has(f));
      el.classList.toggle('active', f === current);
    });
    this.formsEl.classList.toggle('hidden', unlocked.size < 2);
  }
  pulseForm(f: Form) {
    const el = this.formsEl.querySelector<HTMLElement>(`.slot[data-form="${f}"]`);
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  hint(text: string | null) {
    if (text === this.currentHint) return;
    this.currentHint = text;
    this.hn = { text: text ?? this.hn.text, show: !!text, t: this.clock(), from: this.alphaOf(this.hn, 0.5) };
    if (text) {
      this.hintEl.textContent = text;
      this.hintEl.classList.add('show');
    } else this.hintEl.classList.remove('show');
  }

  toast(text: string, sec = 2.4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), sec * 1000);
  }

  letterbox(on: boolean) {
    if (on !== this.lb.on) this.lb = { on, t: this.clock(), from: this.letterboxAmount() };
    this.letterTop.classList.toggle('on', on);
    this.letterBottom.classList.toggle('on', on);
    document.body.classList.toggle('cinematic', on);
  }

  fade(opacity: number, sec = 1, color = '#000') {
    this.fd = { from: this.fadeAmount(), to: opacity, t: this.clock(), sec: Math.max(0.001, sec), color };
    this.fadeEl.style.transition = `opacity ${sec}s ease`;
    this.fadeEl.style.background = color;
    this.fadeEl.style.opacity = String(opacity);
  }

  story(text: string | null, sub = '') {
    if (!text) {
      if (this.st.show) this.st = { ...this.st, show: false, t: this.clock(), from: this.alphaOf(this.st, 1.2) };
      this.storyEl.classList.remove('show');
      return;
    }
    this.st = { text, sub, show: true, t: this.clock(), from: 0 };
    this.storyEl.innerHTML = `<div class="line">${text}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this.storyEl.classList.remove('show');
    void this.storyEl.offsetWidth;
    this.storyEl.classList.add('show');
  }

  titleCardShow(main: string | null, sub = '') {
    if (!main) {
      if (this.tc.show) this.tc = { ...this.tc, show: false, t: this.clock(), from: this.alphaOf(this.tc, 1.4) };
      this.titleCard.classList.remove('show');
      return;
    }
    this.tc = { main, sub, show: true, t: this.clock(), from: this.alphaOf(this.tc, 1.4) };
    this.titleCard.innerHTML = `<div class="main">${main}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this.titleCard.classList.add('show');
  }

  skipProgress(k: number, visible: boolean) {
    this.skipEl.classList.toggle('show', visible);
    this.skipBar.style.width = `${Math.round(k * 100)}%`;
  }

  /** During a cutscene the menu offers "Skip scene" instead of "Back to last shrine". */
  pause(on: boolean, cutscene = false) {
    this.pauseEl.classList.toggle('hidden', !on);
    this.pauseEl.classList.toggle('cutscene', cutscene);
  }

  credits(on: boolean) {
    if (on !== this.cr.show) this.cr = { show: on, t: this.clock() };
    this.creditsEl.classList.toggle('show', on);
  }

  // ---------------------------------------------------------------- logical overlay state
  private alphaOf(s: { show: boolean; t: number; from: number }, sec: number) {
    const k = Math.min(1, Math.max(0, (this.clock() - s.t) / sec));
    return s.from + ((s.show ? 1 : 0) - s.from) * k;
  }
  private letterboxAmount() {
    const k = Math.min(1, Math.max(0, (this.clock() - this.lb.t) / 0.9));
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    return this.lb.from + ((this.lb.on ? 1 : 0) - this.lb.from) * e;
  }
  private fadeAmount() {
    const k = Math.min(1, Math.max(0, (this.clock() - this.fd.t) / this.fd.sec));
    const e = k * k * (3 - 2 * k);
    return this.fd.from + (this.fd.to - this.fd.from) * e;
  }
  /** Current overlay, sampled on the game clock (for frame-by-frame capture). */
  snapshot() {
    const strip = (h: string) => h.replace(/<[^>]*>/g, '');
    return {
      letterbox: this.letterboxAmount(),
      fade: this.fadeAmount(),
      fadeColor: this.fd.color,
      story: { text: strip(this.st.text), sub: strip(this.st.sub), alpha: this.alphaOf(this.st, 1.2) },
      titleCard: { main: strip(this.tc.main), sub: strip(this.tc.sub), alpha: this.alphaOf(this.tc, 1.4), age: this.clock() - this.tc.t },
      hint: { text: this.hn.text, alpha: this.alphaOf(this.hn, 0.5) },
      title: this.titleShown,
      credits: this.cr.show ? Math.min(1, (this.clock() - this.cr.t) / 2) : 0,
      creditsAge: this.clock() - this.cr.t,
    };
  }
}
export type UISnapshot = ReturnType<UI['snapshot']>;
