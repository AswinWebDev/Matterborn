// Keyboard + gamepad input with per-frame "pressed"/"released" edges and input buffering.

export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'dash'
  | 'pound'
  | 'interact'
  | 'form1'
  | 'form2'
  | 'form3'
  | 'form4'
  | 'cycle'
  | 'pause'
  | 'skip'
  | 'confirm';

const KEYMAP: Record<string, Action[]> = {
  ArrowLeft: ['left'],
  KeyA: ['left'],
  ArrowRight: ['right'],
  KeyD: ['right'],
  ArrowUp: ['up'],
  KeyW: ['up'],
  ArrowDown: ['down'],
  KeyS: ['down'],
  Space: ['jump', 'confirm'],
  KeyK: ['jump'],
  ShiftLeft: ['dash'],
  ShiftRight: ['dash'],
  KeyJ: ['dash'],
  KeyL: ['dash'],
  KeyC: ['pound'],
  ControlLeft: ['pound'],
  KeyX: ['pound'],
  KeyE: ['interact'],
  KeyF: ['interact'],
  Digit1: ['form1'],
  Digit2: ['form2'],
  Digit3: ['form3'],
  Digit4: ['form4'],
  KeyQ: ['cycle'],
  Tab: ['cycle'],
  Escape: ['pause'],
  Enter: ['confirm', 'skip'],
};

export class Input {
  private down = new Set<Action>();
  private pressedThisStep = new Set<Action>();
  private releasedThisStep = new Set<Action>();
  private keyState = new Map<string, boolean>();
  private padPrev = new Map<Action, boolean>();
  private lastPressTime = new Map<Action, number>();
  private time = 0;
  /** Presses that happened since the last update, so taps shorter than a step are never lost. */
  private pendingPress = new Set<Action>();
  /** Actions held by scripts/tests (debug API, attract mode). */
  readonly virtual = new Set<Action>();
  /** Horizontal analog axis in [-1, 1] (keyboard gives -1/0/1). */
  axisX = 0;
  axisY = 0;
  usingGamepad = false;
  enabled = true;
  /** Right stick, for the camera. */
  lookX = 0;
  lookY = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (KEYMAP[e.code]) {
        if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
        if (e.repeat) return;
        this.keyState.set(e.code, true);
        for (const a of KEYMAP[e.code]) this.pendingPress.add(a);
        this.usingGamepad = false;
      }
    });
    target.addEventListener('keyup', (e) => {
      if (KEYMAP[e.code]) this.keyState.set(e.code, false);
    });
    target.addEventListener('blur', () => this.keyState.clear());
  }

  /** Call once per fixed step before game logic. */
  update(dt: number) {
    this.time += dt;
    const now = new Set<Action>();
    for (const [code, isDown] of this.keyState) {
      if (isDown) for (const a of KEYMAP[code]) now.add(a);
    }
    for (const a of this.virtual) now.add(a);
    const tapped = new Set(this.pendingPress);
    this.pendingPress.clear();
    let padX = 0;
    let padY = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = (i: number) => Boolean(p.buttons[i]?.pressed);
      const ax = Math.abs(p.axes[0] ?? 0) > 0.25 ? p.axes[0] : 0;
      const ay = Math.abs(p.axes[1] ?? 0) > 0.35 ? p.axes[1] : 0;
      padX = ax || (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
      this.lookX = Math.abs(p.axes[2] ?? 0) > 0.2 ? p.axes[2] : 0;
      this.lookY = Math.abs(p.axes[3] ?? 0) > 0.2 ? p.axes[3] : 0;
      padY = ay || (b(13) ? 1 : 0) - (b(12) ? 1 : 0);
      const map: [Action, boolean][] = [
        ['jump', b(0)],
        ['confirm', b(0)],
        ['dash', b(2) || b(7)],
        ['pound', b(1) || b(6)],
        ['interact', b(3)],
        ['cycle', b(5) || b(4)],
        ['pause', b(9)],
        ['skip', b(1)],
        ['left', padX < -0.5],
        ['right', padX > 0.5],
        ['up', padY < -0.5],
        ['down', padY > 0.5],
      ];
      let any = false;
      for (const [a, v] of map) {
        if (v) {
          now.add(a);
          any = true;
        }
      }
      if (any || padX !== 0) this.usingGamepad = true;
    }
    if (!this.enabled) now.clear();

    this.pressedThisStep.clear();
    this.releasedThisStep.clear();
    for (const a of now) if (!this.down.has(a)) {
      this.pressedThisStep.add(a);
      this.lastPressTime.set(a, this.time);
    }
    // a tap that started and ended between two steps still counts as a press (and a release)
    if (this.enabled) for (const a of tapped) if (!this.pressedThisStep.has(a) && !this.down.has(a)) {
      this.pressedThisStep.add(a);
      this.lastPressTime.set(a, this.time);
      if (!now.has(a)) this.releasedThisStep.add(a);
    }
    for (const a of this.down) if (!now.has(a)) this.releasedThisStep.add(a);
    this.down = now;

    const kx = (now.has('right') ? 1 : 0) - (now.has('left') ? 1 : 0);
    const ky = (now.has('up') ? 1 : 0) - (now.has('down') ? 1 : 0);
    this.axisX = padX !== 0 && this.enabled ? Math.max(-1, Math.min(1, padX)) : kx;
    this.axisY = padY !== 0 && this.enabled ? -padY : ky;
    this.padPrev.clear();
  }

  held(a: Action) {
    return this.down.has(a);
  }
  pressed(a: Action) {
    return this.pressedThisStep.has(a);
  }
  released(a: Action) {
    return this.releasedThisStep.has(a);
  }
  /** True if the action was pressed within the last `window` seconds (input buffering). */
  buffered(a: Action, window: number) {
    const t = this.lastPressTime.get(a);
    return t !== undefined && this.time - t <= window;
  }
  consume(a: Action) {
    this.lastPressTime.delete(a);
    this.pressedThisStep.delete(a);
  }
  /** One-shot press injected by scripts/tests. */
  tap(a: Action) {
    this.pendingPress.add(a);
  }
  clearAll() {
    this.pendingPress.clear();
    this.keyState.clear();
    this.down.clear();
    this.lastPressTime.clear();
    this.pressedThisStep.clear();
  }
}
