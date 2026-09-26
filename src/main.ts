import { App } from './app/App';
import { ATTRACTORS } from './attractors';
import { PALETTE_NAMES } from './scene/palettes';
import { COLOR_MODES } from './scene/shaders';
import { Panel } from './ui/Panel';
import './style.css';

const app = new App(document.getElementById('app')!);

const SHORTCUTS = [
  [`1–${Math.min(9, ATTRACTORS.length)}`, 'Switch attractor (first nine)'],
  ['C / P', 'Next color mode / palette'],
  ['R', 'Auto-rotate on/off'],
  ['[ ]', 'Fewer / more particles'],
  ['- =', 'Shorter / longer trails'],
  ['F', 'Photo balls on/off'],
  ['S', 'Save screenshot'],
  ['Space', 'Pause'],
  ['H', 'Hide all controls'],
] as const;

const panel = new Panel(app, SHORTCUTS);

function next<T>(list: readonly T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length]!;
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Leave typing in Tweakpane's text fields alone.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const { view, sys } = app;
  const a = ATTRACTORS[Number(e.key) - 1];
  if (a) void app.switchTo(a);
  else if (e.key === 'c') app.setStyle({ colorMode: next(COLOR_MODES, view.style.colorMode) });
  else if (e.key === 'p') app.setStyle({ palette: next(PALETTE_NAMES, view.style.palette) });
  else if (e.key === 'r') app.setAutoRotate(!app.stage.controls.autoRotate);
  else if (e.key === ' ') app.setPaused(!app.paused);
  else if (e.key === 'h') panel.toggleHidden();
  else if (e.key === 'f') app.setFamilyVisible(!app.family.visible);
  else if (e.key === 's') void app.saveScreenshot();
  else if (e.key === '[' || e.key === ']') app.setCount(sys.count * (e.key === ']' ? 1.5 : 1 / 1.5));
  else if (e.key === '-' || e.key === '=') app.setTrail(sys.trailLength * (e.key === '=' ? 1.5 : 1 / 1.5));
  else return;
  e.preventDefault();
});

app.start();

if (import.meta.env.DEV) Object.assign(window, { __app: app });
