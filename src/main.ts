import * as THREE from 'three';
import { ATTRACTORS, CONTROL_RANGES, type Attractor } from './attractors';
import { AttractorView } from './scene/AttractorView';
import { FamilyView } from './scene/FamilyView';
import { PALETTE_NAMES } from './scene/palettes';
import { COLOR_MODES } from './scene/shaders';
import { Stage } from './scene/stage';
import { Tweens } from './scene/tween';
import { ParticleSystem } from './simulation/ParticleSystem';
import { createFamilyTray } from './ui/familyTray';
import './style.css';

const DEFAULT_PARTICLES = 1500;
const DEFAULT_TRAIL = 240;
/** Initial viewing direction (from target toward camera), in world space. */
const VIEW_DIR = new THREE.Vector3(1, 0.45, 1.2).normalize();

const app = document.getElementById('app')!;
const stage = new Stage(app);
const sys = new ParticleSystem(ATTRACTORS[0]!, DEFAULT_PARTICLES, DEFAULT_TRAIL);
const view = new AttractorView(sys);
const tweens = new Tweens();
const family = new FamilyView(sys);
stage.scene.add(view.group);
stage.overlay.add(family.group);
const familyTray = createFamilyTray(family, document.body);
stage.onResize = (h) => view.setProjection(stage.camera, h);
stage.resize();

let paused = false;
let switching = false;

/** Distance at which a sphere of `radius` fills the view with some margin. */
function frameDistance(radius: number): number {
  const cam = stage.camera;
  const vfov = THREE.MathUtils.degToRad(cam.fov) / 2;
  const hfov = Math.atan(Math.tan(vfov) * cam.aspect);
  return (radius / Math.sin(Math.min(vfov, hfov))) * 1.1;
}

/** Move the orbit target and camera onto the current attractor, keeping the view direction. */
function frameCamera(animateMs: number): Promise<void> {
  const cam = stage.camera;
  const controls = stage.controls;
  const toTarget = view.worldCenter();
  const dist = frameDistance(sys.analysis.radius);
  const dir = cam.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-12) dir.copy(VIEW_DIR);
  dir.normalize();

  const fromTarget = controls.target.clone();
  const fromDist = cam.position.distanceTo(controls.target) || dist;
  cam.near = sys.analysis.radius / 200;
  cam.far = sys.analysis.radius * 200;
  cam.updateProjectionMatrix();
  controls.minDistance = sys.analysis.radius * 0.05;
  controls.maxDistance = sys.analysis.radius * 20;

  const apply = (k: number) => {
    // Interpolate distance geometrically: scales differ by 100× between systems.
    const d = fromDist * Math.pow(dist / fromDist, k);
    controls.target.lerpVectors(fromTarget, toTarget, k);
    cam.position.copy(controls.target).addScaledVector(dir, d);
  };
  if (animateMs <= 0) {
    apply(1);
    return Promise.resolve();
  }
  return tweens.run(animateMs, apply);
}

async function switchTo(a: Attractor) {
  if (switching || a === sys.attractor) return;
  switching = true;
  await tweens.run(250, (k) => (view.fade = 1 - k));
  sys.setAttractor(a);
  updateHud();
  const glide = frameCamera(900);
  await tweens.run(500, (k) => (view.fade = k));
  await glide;
  switching = false;
}

// --- Temporary keyboard controls + HUD (replaced by the control panel) -------

const hud = document.createElement('div');
hud.className = 'hud';
document.body.appendChild(hud);

function updateHud() {
  const s = view.style;
  hud.innerHTML =
    `<b>${sys.attractor.name}</b> · ${sys.count} particles · trail ${sys.trailLength}<br>` +
    `color: ${s.colorMode} · palette: ${s.palette}${paused ? ' · paused' : ''}<br>` +
    `<span class="dim">1–${ATTRACTORS.length} system · C color · P palette · R auto-rotate · ` +
    `[ ] particles · - = trail · F photos · S screenshot · space pause · H hide</span>`;
}

/** Download the current frame as a PNG (the original's S hotkey). */
async function saveScreenshot() {
  const blob = await stage.screenshot();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${sys.attractor.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function cycle<T>(list: readonly T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length]!;
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const a = ATTRACTORS[Number(e.key) - 1];
  if (a) void switchTo(a);
  else if (e.key === 'c') view.setStyle({ colorMode: cycle(COLOR_MODES, view.style.colorMode) });
  else if (e.key === 'p') view.setStyle({ palette: cycle(PALETTE_NAMES, view.style.palette) });
  else if (e.key === 'r') stage.controls.autoRotate = !stage.controls.autoRotate;
  else if (e.key === ' ') paused = !paused;
  else if (e.key === 'h') hud.hidden = familyTray.element.hidden = !hud.hidden;
  else if (e.key === 'f') {
    family.visible = !family.visible;
    familyTray.refresh();
  } else if (e.key === 's') void saveScreenshot();
  else if (e.key === '[' || e.key === ']') {
    const n = Math.round(sys.count * (e.key === ']' ? 1.5 : 1 / 1.5));
    sys.configure(THREE.MathUtils.clamp(n, CONTROL_RANGES.particles.min, 20000), sys.trailLength);
  } else if (e.key === '-' || e.key === '=') {
    const n = Math.round(sys.trailLength * (e.key === '=' ? 1.5 : 1 / 1.5));
    sys.configure(sys.count, THREE.MathUtils.clamp(n, 2, 4000));
  } else return;
  updateHud();
});

// --- Main loop ---------------------------------------------------------------

stage.camera.position.copy(VIEW_DIR);
void frameCamera(0);
updateHud();

let last = performance.now();
stage.renderer.setAnimationLoop((now) => {
  // Clamp so a backgrounded tab doesn't come back and simulate a huge jump.
  const realDt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  tweens.tick(now);
  if (!paused) sys.advance(realDt * sys.attractor.simSpeed);
  view.sync(realDt);
  family.sync(view.fade, stage.camera, view.projScale);
  stage.render();
});

if (import.meta.env.DEV) Object.assign(window, { __app: { sys, view, stage, family } });
