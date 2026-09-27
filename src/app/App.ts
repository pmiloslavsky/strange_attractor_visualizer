import * as THREE from 'three';
import { ATTRACTORS, type Attractor } from '../attractors';
import { AttractorView, type ViewStyle } from '../scene/AttractorView';
import { FamilyView } from '../scene/FamilyView';
import { Stage } from '../scene/stage';
import { Tweens } from '../scene/tween';
import { euler, rk4 } from '../simulation/integrators';
import { LyapunovMeter } from '../simulation/lyapunov';
import { PoincareSection } from '../simulation/poincare';
import { SectionView } from '../scene/SectionView';
import { AxesView } from '../scene/AxesView';
import { JetView } from '../scene/JetView';
import { CannonView } from '../scene/CannonView';
import { ParticleSystem, type SeedMode } from '../simulation/ParticleSystem';
import type { ColorMode } from '../scene/shaders';

export const LIMITS = {
  particles: { min: 1, max: 8000 },
  trail: { min: 2, max: 2000 },
  /** particles × trail cap: keeps trail buffers under ~100 MB. */
  maxVertices: 3_000_000,
  particleSize: { min: 0.01, max: 4 },
  speed: { min: 0, max: 4 },
} as const;

export const INTEGRATORS = { euler, rk4 } as const;
export type IntegratorName = keyof typeof INTEGRATORS;

const DEFAULT_PARTICLES = 1500;
const DEFAULT_TRAIL = 240;
/** Initial viewing direction (from target toward camera), in world space. */
const VIEW_DIR = new THREE.Vector3(1, 0.45, 1.2).normalize();

/** What the camera frames: a bounding sphere, plus the box when known (model coords). */
type FrameFit = {
  readonly center: readonly number[];
  readonly radius: number;
  readonly ranges?: readonly (readonly [number, number])[];
};
/**
 * Looking (almost) straight down on the model's z = 0 plane, which is the
 * world's horizontal plane; used for the basin slice. The slight tilt fixes
 * which way is up on screen (model +y).
 */
const TOP_VIEW_DIR = new THREE.Vector3(0, 1, 0.02).normalize();
/** The jet rides the particle after the three photo balls (0–2). */
export const JET_PARTICLE = 3;
/** Seconds a photo ball stays gone after the A-10 shoots it down. */
const KNOCKOUT_SECONDS = 10;
/** Minimum particle count for the basin demo, so the pattern reads clearly. */
const BASIN_PARTICLES = 4000;

/**
 * Owns the simulation, its view and the camera, and exposes the operations the
 * control panel and keyboard need. UI code subscribes with onChange() to hear
 * about state it didn't cause itself (attractor switches, preset tweens,
 * keyboard shortcuts).
 */
export class App {
  readonly stage: Stage;
  readonly sys: ParticleSystem;
  readonly view: AttractorView;
  readonly family: FamilyView;
  /** Live largest-Lyapunov-exponent estimate for the current system and settings. */
  readonly chaos: LyapunovMeter;
  /** Poincaré section: collects crossings only while enabled (its panel section is open). */
  readonly section = new PoincareSection();
  private readonly sectionView: SectionView;
  /** The original's x/y/z reference axes (off by default). */
  private readonly axes = new AxesView();
  /** The A-10 flying along particle JET_PARTICLE. */
  private readonly jet = new JetView();
  /** The A-10's cannon: now and then shoots down a photo ball. */
  private readonly cannon = new CannonView();
  private sectionEnabled = false;
  private sectionKey = '';
  private readonly tweens = new Tweens();

  paused = false;
  /** Multiplies each attractor's own simSpeed. */
  speed = 1;
  /** Glide the camera when parameter changes resize or move the attractor. */
  autoFrame = true;
  integrator: IntegratorName = 'euler';
  fps = 60;

  private switching = false;
  private listeners = new Set<() => void>();
  private reanalyzeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Identifies the running preset tween; replaced to cancel it. */
  private presetToken: object | null = null;
  private framed = { center: new THREE.Vector3(), radius: 1 };
  /** Restored when leaving a multi-attractor system, which forces 'attractor' coloring. */
  private colorModeBeforeBasins: ColorMode = 'speed';
  /** Particle count to restore when leaving the basin demo, if it raised it. */
  private countBeforeBasins: number | undefined;
  /** Pending "follow the particles in" camera move after the basin demo. */
  private followUpTimer: ReturnType<typeof setTimeout> | undefined;
  private followUpToken: object | null = null;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.sys = new ParticleSystem(ATTRACTORS[0]!, DEFAULT_PARTICLES, DEFAULT_TRAIL);
    this.view = new AttractorView(this.sys);
    this.family = new FamilyView(this.sys);
    this.chaos = new LyapunovMeter(this.sys);
    this.sectionView = new SectionView(this.section);
    this.view.group.add(this.sectionView.group, this.axes.group);
    this.stage.overlay.add(this.jet.body, this.jet.lights);
    this.jet.setEnvironment(this.stage.renderer, this.stage.overlay);
    this.stage.scene.add(this.jet.flames, this.cannon.group);
    this.cannon.onKill = (i) => this.family.knockOut(i, KNOCKOUT_SECONDS);
    this.resetSection();
    this.view.setStyle({ particleSize: this.sys.attractor.particleSize });
    this.stage.scene.add(this.view.group);
    this.stage.overlay.add(this.family.group);
    this.stage.onResize = (h) => this.view.setProjection(this.stage.camera, h);
    this.stage.resize();
    this.stage.camera.position.copy(VIEW_DIR);
    void this.frameCamera(0);
    // The user taking the camera cancels any automatic follow-up move.
    this.stage.controls.addEventListener('start', () => (this.followUpToken = null));
    // Controls are disabled while riding, so listen on the canvas: a drag ends the ride.
    this.stage.renderer.domElement.addEventListener('pointerdown', () => this.stopRide());
  }

  get attractor(): Attractor {
    return this.sys.attractor;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  // --- System & parameters ---------------------------------------------------

  /** Cross-fade to another system: fade out, reseed, glide the camera, fade in. */
  async switchTo(a: Attractor) {
    if (this.switching || a === this.sys.attractor) return;
    this.switching = true;
    this.presetToken = null;
    this.followUpToken = null;
    this.sweep = null;
    this.stopRide(false); // the switch frames the camera itself
    this.cannon.reset();
    clearTimeout(this.reanalyzeTimer);
    await this.tweens.run(250, (k) => (this.view.fade = 1 - k));
    if (this.countBeforeBasins !== undefined) {
      // Leaving the basin demo: undo its particle-count bump.
      this.sys.configure(this.countBeforeBasins, this.sys.trailLength);
      this.countBeforeBasins = undefined;
    }
    this.sys.setAttractor(a);
    this.lastPreset = 0;
    this.view.setStyle({ particleSize: a.particleSize });
    this.resetSection();
    let glide: Promise<void>;
    if (this.sys.hasBasins) {
      // Several attractors: open with the basin demo, colored by destination.
      if (this.view.style.colorMode !== 'attractor') this.colorModeBeforeBasins = this.view.style.colorMode;
      this.view.setStyle({ colorMode: 'attractor' });
      // Enough points for the basin shape to read clearly.
      if (this.sys.count < BASIN_PARTICLES) {
        this.countBeforeBasins = this.sys.count;
        this.setCount(BASIN_PARTICLES);
      }
      glide = this.seedRegion(900);
    } else {
      if (this.view.style.colorMode === 'attractor') this.view.setStyle({ colorMode: this.colorModeBeforeBasins });
      glide = this.frameCamera(900);
    }
    this.emit();
    await this.tweens.run(500, (k) => (this.view.fade = k));
    await glide;
    this.switching = false;
  }

  /** Running parameter sweep, if any (see startSweep). */
  sweep: { param: number; from: number; to: number; seconds: number; phase: number } | null = null;

  /**
   * Animate one parameter back and forth between `from` and `to`, one full
   * pass every `seconds`, so period doublings and the onset of chaos play out
   * live. Anything else that sets parameters stops it.
   */
  startSweep(param: number, from: number, to: number, seconds = 20) {
    this.presetToken = null;
    clearTimeout(this.reanalyzeTimer);
    // Start at the current value's position so the sweep doesn't jump.
    const cur = this.sys.params[param]!;
    const t = to === from ? 0 : Math.min(1, Math.max(0, (cur - from) / (to - from)));
    this.sweep = { param, from, to, seconds, phase: t };
    this.emit();
  }

  stopSweep() {
    if (!this.sweep) return;
    this.sweep = null;
    this.scheduleReanalyze(0);
    this.emit();
  }

  private advanceSweep(realDt: number) {
    const sw = this.sweep;
    if (!sw) return;
    sw.phase = (sw.phase + realDt / sw.seconds) % 2;
    const tri = sw.phase <= 1 ? sw.phase : 2 - sw.phase; // 0 → 1 → 0
    const p = [...this.sys.params];
    p[sw.param] = sw.from + (sw.to - sw.from) * tri;
    this.sys.setParams(p, false);
    this.emit();
  }

  /** Live single-parameter change (slider drag). */
  setParam(i: number, value: number) {
    this.sweep = null;
    this.presetToken = null;
    const p = [...this.sys.params];
    p[i] = value;
    this.sys.setParams(p, false);
    this.scheduleReanalyze();
  }

  /** Index of the preset the current parameters match exactly, or −1 if customized. */
  presetIndex(): number {
    const p = this.sys.params;
    return this.attractor.examples.findIndex((ex) => ex.every((v, i) => Math.abs(v - p[i]!) <= 1e-9 * (1 + Math.abs(v))));
  }

  /** Last preset applied, so "next" still advances after sliders were nudged. */
  private lastPreset = 0;

  /** Morph to the next preset of this system (wrapping round). */
  nextPreset() {
    const n = this.attractor.examples.length;
    const current = this.presetIndex();
    const next = ((current >= 0 ? current : this.lastPreset) + 1) % n;
    void this.applyPreset(this.attractor.examples[next]!);
  }

  /** Tween all parameters to a preset, so the attractor morphs instead of jumping. */
  async applyPreset(values: readonly number[], ms = 1200) {
    const index = this.attractor.examples.indexOf(values as never);
    if (index >= 0) this.lastPreset = index;
    this.sweep = null;
    const token = {};
    this.presetToken = token;
    clearTimeout(this.reanalyzeTimer);
    const from = [...this.sys.params];
    await this.tweens.run(ms, (k) => {
      if (this.presetToken !== token) return;
      // Land exactly on the preset (lerp at k = 1 can be off in the last bit).
      this.sys.setParams(k >= 1 ? values : from.map((f, i) => f + (values[i]! - f) * k), false);
      this.emit();
    });
    if (this.presetToken === token) {
      this.presetToken = null;
      // Always refit after a preset so the new shape fills, but never overflows, the view.
      this.scheduleReanalyze(0, true);
    }
  }

  setDt(dt: number) {
    this.sys.dt = dt;
    this.scheduleReanalyze();
  }

  setIntegrator(name: IntegratorName) {
    this.integrator = name;
    this.sys.integrator = INTEGRATORS[name];
  }

  /** Restore the current system's defaults: first example, dt, particle size. */
  resetSystem() {
    this.view.setStyle({ particleSize: this.attractor.particleSize });
    this.sys.dt = this.attractor.dt;
    void this.applyPreset(this.attractor.examples[0]!);
  }

  reseed(mode: SeedMode = 'attractor') {
    this.followUpToken = null;
    if (mode === 'region') void this.seedRegion(800);
    else this.sys.reseed(mode);
  }

  /**
   * Basin demo: seed the system's basin region (a flat slice) with particles
   * colored by the attractor each will reach, and look straight down at it so
   * the pattern of the starting space is visible before they fly off.
   */
  private seedRegion(animateMs: number): Promise<void> {
    this.sys.reseed('region');
    const region = this.attractor.basins?.region;
    if (!region) return this.frameCamera(animateMs);
    const center = region.min.map((v, i) => (v + region.max[i]!) / 2) as [number, number, number];
    const radius = 0.5 * Math.hypot(...region.max.map((v, i) => v - region.min[i]!));
    // Once the particles have had time to reach their attractors, follow them
    // in: swing round to a 3D view framing the attractors themselves. Any
    // camera drag, switch or reseed in the meantime cancels this.
    const token = {};
    this.followUpToken = token;
    clearTimeout(this.followUpTimer);
    this.followUpTimer = setTimeout(() => {
      if (this.followUpToken === token && this.sys.hasBasins) void this.frameCamera(2000, VIEW_DIR);
    }, 10_000 + animateMs); // ≈ 10 time units at Newton–Leipnik's simSpeed of 1
    return this.frameCamera(animateMs, TOP_VIEW_DIR, { center, radius });
  }

  /**
   * Re-run the reference trajectory after parameters or dt settle. Debounced so
   * dragging a slider stays smooth.
   */
  private scheduleReanalyze(delay = 180, forceFrame = false) {
    clearTimeout(this.reanalyzeTimer);
    this.reanalyzeTimer = setTimeout(() => {
      this.sys.reanalyze();
      if (this.sys.analysis.ok) {
        this.sys.respawnOutliers(3);
        // Coming back from a setting where everything collapsed onto a fixed
        // point, all particles would restart from one spot; spread them out.
        if (!this.sys.analysis.collapsed && this.sys.spread() < 0.02) this.sys.reseed();
      }
      // The attractors merged (parameters or dt): nothing left to tell apart.
      if (!this.sys.hasBasins && this.view.style.colorMode === 'attractor') {
        this.view.setStyle({ colorMode: this.colorModeBeforeBasins });
      }
      this.emit();
      if (this.autoFrame || forceFrame) this.reframeIfNeeded(forceFrame);
    }, delay);
  }

  /**
   * Glide to a new framing when the attractor has moved, no longer fits on
   * screen at the current zoom, or has shrunk to a small part of it. `always`
   * reframes regardless (after a preset).
   */
  private reframeIfNeeded(always = false) {
    const a = this.sys.analysis;
    if (!a.ok || a.collapsed) return;
    const { camera: cam, controls } = this.stage;
    const center = this.view.worldCenter();
    const moved = center.distanceTo(this.framed.center) > 0.25 * this.framed.radius;
    const dir = cam.position.clone().sub(controls.target);
    const ratio = dir.length() / this.frameDistance(a, dir.normalize());
    if (always || moved || ratio < 0.98 || ratio > 1.6) void this.frameCamera(800);
  }

  // --- Ride along --------------------------------------------------------------

  /** Index of the particle the camera is riding with (0–2 photo balls, 3 the A-10), or null. */
  ride: number | null = null;
  private rideLook = new THREE.Vector3();
  private rideAutoRotate = false;

  /** Chase-camera ride on particle `i`. Dragging the view, Esc or stopRide() ends it. */
  startRide(i: number) {
    if (i >= this.sys.count) return;
    if (this.ride === null) this.rideAutoRotate = this.stage.controls.autoRotate;
    this.ride = i;
    this.followUpToken = null;
    const { controls, camera } = this.stage;
    controls.enabled = false;
    controls.autoRotate = false;
    this.rideLook.copy(controls.target);
    camera.near = this.sys.analysis.radius / 5000; // we'll be right among the particles
    camera.updateProjectionMatrix();
    this.emit();
  }

  /** `reframe`: glide back to the overview (skip when something else is about to move the camera). */
  stopRide(reframe = true) {
    if (this.ride === null) return;
    this.ride = null;
    const { controls } = this.stage;
    controls.enabled = true;
    controls.autoRotate = this.rideAutoRotate;
    if (reframe) void this.frameCamera(900);
    this.emit();
  }

  /**
   * Place the camera a little behind and above the ridden particle, looking
   * ahead along its direction of travel (from the equations, not the noisy
   * frame-to-frame motion), easing toward that pose so turns are smooth.
   */
  private updateRide(realDt: number) {
    if (this.ride === null) return;
    const i = this.ride;
    if (i >= this.sys.count) return this.stopRide();
    const { pos, params, attractor } = this.sys;
    const r = this.sys.analysis.radius;
    const d: [number, number, number] = [0, 0, 0];
    attractor.derivative(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!, params, d);
    const p = this.view.modelToWorld([pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!]);
    const dir = new THREE.Vector3(...d).applyQuaternion(this.view.group.quaternion);
    if (dir.lengthSq() < 1e-20) return;
    dir.normalize();
    const eye = p.clone().addScaledVector(dir, -0.14 * r).add(new THREE.Vector3(0, 0.05 * r, 0));
    const look = p.clone().addScaledVector(dir, 0.12 * r);
    const k = 1 - Math.exp(-realDt * 5);
    this.stage.camera.position.lerp(eye, k);
    this.rideLook.lerp(look, k);
    // OrbitControls still runs update() and looks at its target; keep it on our look point.
    this.stage.controls.target.copy(this.rideLook);
  }

  // --- Poincaré section --------------------------------------------------------

  setSectionEnabled(on: boolean) {
    this.sectionEnabled = on;
    this.sectionView.visible = on;
    if (!on) this.section.clear();
  }

  /** Move the plane; clears the collected crossings. */
  setSection(axis: 0 | 1 | 2, offset: number) {
    this.section.set(axis, offset);
    this.emit();
  }

  /** This system's default plane: its classic one if defined, else through the middle of its z range. */
  resetSection() {
    const a = this.attractor, r = this.sys.analysis.ranges;
    const def = a.section ?? { axis: 2 as const, offset: (r[2]![0] + r[2]![1]) / 2 };
    this.section.set(def.axis, def.offset);
    this.section.clear();
  }

  /** Collect this frame's crossings; clears when the dynamics changed. */
  private collectSection() {
    if (!this.sectionEnabled) return;
    const key = `${this.attractor.id}|${this.sys.params.join(',')}|${this.sys.dt}`;
    if (key !== this.sectionKey) {
      this.sectionKey = key;
      this.section.clear();
    }
    this.section.collect(this.sys);
  }

  // --- Particles & style -----------------------------------------------------

  /** Keeps particles × trail within the vertex budget by shortening trails if needed. */
  setCount(n: number) {
    const count = THREE.MathUtils.clamp(Math.round(n), LIMITS.particles.min, LIMITS.particles.max);
    const trail = Math.min(this.sys.trailLength, Math.floor(LIMITS.maxVertices / count));
    this.sys.configure(count, Math.max(LIMITS.trail.min, trail));
    this.emit();
  }

  /** Keeps particles × trail within the vertex budget by reducing particles if needed. */
  setTrail(n: number) {
    const trail = THREE.MathUtils.clamp(Math.round(n), LIMITS.trail.min, LIMITS.trail.max);
    const count = Math.min(this.sys.count, Math.floor(LIMITS.maxVertices / trail));
    this.sys.configure(Math.max(LIMITS.particles.min, count), trail);
    this.emit();
  }

  setStyle(patch: Partial<ViewStyle>) {
    this.view.setStyle(patch);
    this.emit();
  }

  setFamilyVisible(visible: boolean) {
    this.family.visible = visible;
    this.emit();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.emit();
  }

  get jetVisible(): boolean {
    return this.jet.visible;
  }

  setJetVisible(on: boolean) {
    this.jet.visible = on;
    this.emit();
  }

  /** Whether the A-10 shoots at the photo balls now and then (only while both are shown). */
  get cannonEnabled(): boolean {
    return this.cannon.enabled;
  }

  setCannonEnabled(on: boolean) {
    this.cannon.enabled = on;
    if (!on) this.cannon.reset();
    this.emit();
  }

  /** Fire a burst now, at the next ball ahead of the nose (for demos and testing). */
  fireCannon() {
    this.cannon.fireSoon();
  }

  /** Fly the jet along its particle, nose along the flow direction from the equations. */
  private syncJet(realDt: number) {
    const i = JET_PARTICLE;
    const { pos, params, attractor, count } = this.sys;
    const show = count > i;
    const d: [number, number, number] = [0, 0, 0];
    if (show) attractor.derivative(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!, params, d);
    // Throttle: the jet's speed within this attractor's typical range (same scale as speed coloring).
    const [lo, hi] = this.sys.speedRange;
    const throttle = (Math.hypot(...d) - lo) / (hi - lo || 1);
    this.jet.sync({
      throttle,
      show,
      worldPos: this.view.modelToWorld(show ? [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!] : [0, 0, 0]),
      worldDir: new THREE.Vector3(...d).applyQuaternion(this.view.group.quaternion),
      radius: this.sys.analysis.radius,
      camera: this.stage.camera,
      projScale: this.view.projScale,
      fade: this.view.fade,
      realDt,
      small: this.ride === i,
    });
  }

  get axesVisible(): boolean {
    return this.axes.visible;
  }

  setAxesVisible(on: boolean) {
    this.axes.visible = on;
    this.emit();
  }

  setAutoRotate(on: boolean) {
    this.stage.controls.autoRotate = on;
    this.emit();
  }

  // --- Camera ----------------------------------------------------------------

  /**
   * Distance from the target at which the attractor fits the part of the view
   * the panel doesn't cover. With a bounding box (`ranges`), its corners are
   * projected exactly for the view direction `dir` — or, while auto-rotating,
   * for every direction the spin will pass through, so it never grows past
   * the screen edge mid-orbit. Without one, falls back to the sphere `radius`.
   */
  private frameDistance(fit: FrameFit, dir: THREE.Vector3): number {
    const cam = this.stage.camera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const tanH = tanV * this.stage.visibleAspect;
    if (!fit.ranges) {
      // Half the box diagonal overstates the on-screen size; 0.8 fills without clipping.
      return (fit.radius / Math.sin(Math.atan(Math.min(tanV, tanH)))) * 0.8;
    }
    // Corners must land within this fraction of the visible half-width/height;
    // the ranges are 1–99% percentiles and trails reach a little past them.
    const MARGIN = 0.88;
    const target = this.view.modelToWorld(fit.center);
    const up = cam.up.clone().normalize();
    const corners: THREE.Vector3[] = [];
    const [rx, ry, rz] = fit.ranges;
    for (const x of rx!) for (const y of ry!) for (const z of rz!) {
      corners.push(this.view.modelToWorld([x, y, z]).sub(target));
    }
    const dirs = this.stage.controls.autoRotate
      ? Array.from({ length: 24 }, (_, i) => dir.clone().applyAxisAngle(up, (i / 24) * Math.PI * 2))
      : [dir];
    const back = new THREE.Vector3(), right = new THREE.Vector3(), camUp = new THREE.Vector3();
    let need = 0;
    for (const d of dirs) {
      back.copy(d).normalize();
      right.crossVectors(up, back);
      if (right.lengthSq() < 1e-9) right.set(1, 0, 0); // looking straight along `up`
      right.normalize();
      camUp.crossVectors(back, right);
      for (const c of corners) {
        // Camera at distance D sees the corner at depth D − z.
        const z = c.dot(back);
        need = Math.max(
          need,
          z + Math.abs(c.dot(right)) / (tanH * MARGIN),
          z + Math.abs(c.dot(camUp)) / (tanV * MARGIN),
        );
      }
    }
    return need;
  }

  /**
   * Move the orbit target and camera onto the current attractor. Keeps the
   * current view direction unless `toDir` is given, in which case the camera
   * swings round to it during the glide.
   */
  frameCamera(
    animateMs = 800,
    toDir?: THREE.Vector3,
    fit: FrameFit = this.sys.analysis,
  ): Promise<void> {
    const { camera: cam, controls } = this.stage;
    const { radius } = fit;
    const toTarget = this.view.modelToWorld(fit.center);
    const fromDir = cam.position.clone().sub(controls.target);
    if (fromDir.lengthSq() < 1e-12) fromDir.copy(VIEW_DIR);
    fromDir.normalize();
    const endDir = (toDir ?? fromDir).clone().normalize();
    const dist = this.frameDistance(fit, endDir);
    const dir = new THREE.Vector3();
    this.framed = { center: toTarget.clone(), radius };

    const fromTarget = controls.target.clone();
    const fromDist = cam.position.distanceTo(controls.target) || dist;
    cam.near = radius / 200;
    cam.far = radius * 200;
    cam.updateProjectionMatrix();
    controls.minDistance = radius * 0.05;
    controls.maxDistance = radius * 20;

    const apply = (k: number) => {
      // Interpolate distance geometrically: scales differ by 100× between systems.
      const d = fromDist * Math.pow(dist / fromDist, k);
      controls.target.lerpVectors(fromTarget, toTarget, k);
      dir.lerpVectors(fromDir, endDir, k);
      // Opposite directions blend through zero; jump to the end one instead.
      if (dir.lengthSq() < 1e-6) dir.copy(endDir);
      dir.normalize();
      cam.position.copy(controls.target).addScaledVector(dir, d);
    };
    if (animateMs <= 0) {
      apply(1);
      return Promise.resolve();
    }
    return this.tweens.run(animateMs, apply);
  }

  // --- Capture ---------------------------------------------------------------

  /** Download the current frame as a PNG (the original's S hotkey). */
  /**
   * e.g. "rossler-preset3-2026-09-27T10-15-00-000Z.png": the attractor, the
   * preset number (1-based) only while the parameters exactly match a preset,
   * and a timestamp so names never collide.
   */
  screenshotName(now = new Date()): string {
    const preset = this.presetIndex();
    const parts = [this.attractor.id, ...(preset >= 0 ? [`preset${preset + 1}`] : []), now.toISOString().replace(/[:.]/g, '-')];
    return `${parts.join('-')}.png`;
  }

  async saveScreenshot() {
    const blob = await this.stage.screenshot();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.screenshotName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // --- Loop --------------------------------------------------------------------

  start() {
    let last = performance.now();
    this.stage.renderer.setAnimationLoop((now) => {
      const elapsed = (now - last) / 1000;
      last = now;
      if (elapsed > 0) this.fps += (1 / elapsed - this.fps) * 0.05;
      // Clamp so a backgrounded tab doesn't come back and simulate a huge jump.
      const realDt = Math.min(elapsed, 1 / 20);
      this.tweens.tick(now);
      if (!this.paused) {
        this.advanceSweep(realDt);
        this.sys.advance(realDt * this.attractor.simSpeed * this.speed);
      }
      // Measures parameters, not particles, so it keeps converging while paused.
      this.chaos.tick();
      this.collectSection(); // before view.sync, which consumes sys.lastWrite
      this.view.sync(realDt);
      this.sectionView.sync(this.sys.analysis);
      this.axes.sync(this.sys.analysis);
      this.updateRide(realDt);
      this.family.sync(this.view.fade, this.stage.camera, this.view.projScale, this.ride, realDt);
      this.syncJet(realDt);
      this.cannon.update(realDt, this.jet, this.family, this.stage.camera, this.ride, this.paused || this.switching);
      this.stage.render();
    });
  }
}
