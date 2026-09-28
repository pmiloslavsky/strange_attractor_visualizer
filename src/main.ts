import { App, RIDERS } from './app/App';
import { ATTRACTORS } from './attractors';
import { PALETTE_NAMES } from './scene/palettes';
import { COLOR_MODES } from './scene/shaders';
import { Panel } from './ui/Panel';
import './style.css';

const app = new App(document.getElementById('app')!);

const SHORTCUTS = [
  [`1–${Math.min(9, ATTRACTORS.length)}`, 'Switch attractor'],
  ['N', 'Next preset'],
  ['C / P', 'Next color mode / palette'],
  ['R', 'Auto-rotate on/off'],
  ['[ ]', 'Fewer / more particles'],
  ['- =', 'Shorter / longer trails'],
  ['B', 'Butterfly effect: reseed as one tiny cluster'],
  ['V', 'Ride along with a photo ball, the A-10 or the Apache (Esc to stop)'],
  ['A', 'x/y/z axes on/off'],
  ['F', 'Photo balls on/off'],
  ['J', 'A-10 Warthog on/off'],
  ['K', 'Apache helicopter on/off'],
  ['M', "Weapons on/off (cannon, missiles, and the cat's knives)"],
  ['D', 'Corner figure on/off (click it: next preset, then next system)'],
  ['S', 'Save screenshot'],
  ['Space', 'Pause'],
  ['H', 'Hide all controls'],
] as const;

const panel = new Panel(app, SHORTCUTS);

const corner = document.createElement('div');
corner.className = 'corner';
const figure = Object.assign(document.createElement('img'), {
  className: 'corner-figure',
  src: 'figure/dario.png',
  alt: '',
  draggable: false,
});
// Easter egg: clicking the figure steps through every preset of every system.
figure.addEventListener('click', () => app.nextShowcase());
const massacre = Object.assign(document.createElement('span'), { className: 'massacre', textContent: 'Massacre!!!' });
corner.append(figure, massacre);
document.body.appendChild(corner);

// All three photo balls shot down: flash a small red word beside the figure.
app.onMassacre = () => {
  massacre.classList.remove('show');
  void massacre.offsetWidth; // restart the animation
  massacre.classList.add('show');
};
massacre.addEventListener('animationend', () => massacre.classList.remove('show'));

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
  else if (e.key === 'c') {
    const modes = COLOR_MODES.filter((m) => sys.hasBasins || m !== 'attractor');
    app.setStyle({ colorMode: next(modes, view.style.colorMode) });
  }
  else if (e.key === 'p') app.setStyle({ palette: next(PALETTE_NAMES, view.style.palette) });
  else if (e.key === 'r') app.setAutoRotate(!app.stage.controls.autoRotate);
  else if (e.key === ' ') app.setPaused(!app.paused);
  else if (e.key === 'h') panel.toggleHidden();
  else if (e.key === 'f') app.setFamilyVisible(!app.family.visible);
  else if (e.key === 'b') app.reseed('cluster');
  else if (e.key === 'n') app.nextPreset();
  else if (e.key === 'a') app.setAxesVisible(!app.axesVisible);
  else if (e.key === 'j') app.setJetVisible(!app.jetVisible);
  else if (e.key === 'k') app.setHeliVisible(!app.heliVisible);
  else if (e.key === 'm') app.setWeaponsEnabled(!app.weaponsEnabled);
  else if (e.key === 'd') corner.hidden = !corner.hidden;
  // V cycles the ride through the three photo balls, the jet and the helicopter.
  else if (e.key === 'v') app.startRide(app.ride === null ? 0 : (app.ride + 1) % RIDERS);
  else if (e.key === 'Escape' && app.ride !== null) app.stopRide();
  else if (e.key === 's') void app.saveScreenshot();
  else if (e.key === '[' || e.key === ']') app.setCount(sys.count * (e.key === ']' ? 1.5 : 1 / 1.5));
  else if (e.key === '-' || e.key === '=') app.setTrail(sys.trailLength * (e.key === '=' ? 1.5 : 1 / 1.5));
  else return;
  e.preventDefault();
});

app.start();

if (import.meta.env.DEV) Object.assign(window, { __app: app });
