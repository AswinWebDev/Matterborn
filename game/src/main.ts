import './style.css';
import { Game } from './Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const game = new Game(canvas);
(window as unknown as { game: Game }).game = game;

document.querySelector('#title')?.addEventListener('click', () => game.startGame());
document.querySelector('#archive-btn')?.addEventListener('click', (e) => {
  e.stopPropagation(); // not a click on the title screen itself
  game.openArchive();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyG' && !e.repeat && game.state === 'title') game.openArchive();
});
document.querySelector('#resume')?.addEventListener('click', () => game.togglePause());
document.querySelector('#skipscene')?.addEventListener('click', () => game.skipScene());
// Esc in fullscreen only leaves fullscreen (the page never sees the key): open the pause menu then
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) game.pauseIfPlaying();
});
document.querySelector('#mute')?.addEventListener('click', (e) => {
  const muted = game.audio.toggleMute();
  (e.target as HTMLElement).textContent = muted ? 'Sound: off' : 'Sound: on';
});
const gfx = document.querySelector<HTMLElement>('#gfx');
const gfxLabel = () => {
  if (gfx) gfx.textContent = `Graphics: ${{ auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low' }[game.renderer.qualityMode]}`;
};
gfx?.addEventListener('click', () => {
  const order = ['auto', 'high', 'medium', 'low'] as const;
  const next = order[(order.indexOf(game.renderer.qualityMode) + 1) % order.length];
  game.renderer.setQualityMode(next);
  gfxLabel();
});
gfxLabel();
document.querySelector('#restart')?.addEventListener('click', () => {
  game.togglePause();
  game.restartFromShrine();
});

// fullscreen from the pause menu (F is taken: it is an alternate interact key)
document.querySelector('#fullscreen')?.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
});

// dev tools: window.capture(opts) records trailer footage and stills (see src/dev/Capture.ts)
if (import.meta.env.DEV) {
  // silent while developing (no AudioContext is created); add ?sound to the URL to hear the game
  if (!new URLSearchParams(location.search).has('sound')) {
    game.audio.silent = true;
    game.audio.muted = true;
    const btn = document.querySelector('#mute');
    if (btn) btn.textContent = 'Sound: off (dev)';
  }
  const w = window as unknown as Record<string, unknown>;
  w.capture = async (opts?: { width?: number; height?: number; fps?: number; audio?: boolean }) => new (await import('./dev/Capture')).Capture(game, opts);
  w.shots = () => import('./dev/shots');
  w.view = async (name: string, opts?: { restored?: boolean; settle?: number }) => (await import('./dev/views')).view(game, name, opts);
  w.gallery = async (size?: number, ids?: string[]) => (await import('./dev/gallery')).gallery(game, size, ids);
}

game.init().catch((err) => {
  console.error(err);
  const el = document.querySelector('#loading-text');
  if (el) el.textContent = 'Something went wrong while loading. Please refresh.';
});
