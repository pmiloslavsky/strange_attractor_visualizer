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
import { ParticleSystem, type SeedMode } from '../simulation/ParticleSystem';
import type { ColorMode } from '../scene/shaders';

export const LIMITS = {
  particles: { min: 1, max: 8000 },
  /** Maps are points only (no trails), so they can afford far more. */
  mapParticles: { min: 1000, max: 400_000 },
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
/**
 * Maps lie in the model's z = 0 plane, which is the world's horizontal plane,
 * so view them from (almost) straight above. The slight tilt fixes which way
 * is up on screen (model +y), and auto-rotate then spins the image in place.
 */
const MAP_VIEW_DIR = new THREE.Vector3(0, 1, 0.02).normalize();
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
  /** Last particle/trail settings used for each kind, restored when switching back. */
  private kindConfig = {
    flow: { count: DEFAULT_PARTICLES, trail: DEFAULT_TRAIL },
    // Map iteration runs on the CPU; start phones (narrow screens) lighter.
    map: { count: matchMedia('(max-width: 720px)').matches ? 80_000 : 200_000, trail: 2 },
  };

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.sys = new ParticleSystem(ATTRACTORS[0]!, DEFAULT_PARTICLES, DEFAULT_TRAIL);
    this.view = new AttractorView(this.sys);
    this.family = new FamilyView(this.sys);
    this.chaos = new LyapunovMeter(this.sys);
    this.sectionView = new SectionView(this.section);
    this.view.group.add(this.sectionView.group);
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
    clearTimeout(this.reanalyzeTimer);
    await this.tweens.run(250, (k) => (this.view.fade = 1 - k));
    if (this.countBeforeBasins !== undefined) {
      // Leaving the basin demo: undo its particle-count bump.
      this.sys.configure(this.countBeforeBasins, this.sys.trailLength);
      this.countBeforeBasins = undefined;
    }
    const prevKind = this.sys.attractor.kind;
    this.kindConfig[prevKind] = { count: this.sys.count, trail: this.sys.trailLength };
    this.sys.setAttractor(a);
    const kindChanged = a.kind !== prevKind;
    if (kindChanged) {
      // Positions were just reseeded on the new attractor, so configure()
      // keeps them and only adds or drops particles.
      const { count, trail } = this.kindConfig[a.kind];
      this.sys.configure(count, trail);
    }
    this.view.setStyle({ particleSize: a.particleSize });
    this.resetSection();
    this.setSectionEnabled(this.sectionWanted); // maps have no section; re-evaluate for this system
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
      glide = this.frameCamera(900, kindChanged ? (a.kind === 'map' ? MAP_VIEW_DIR : VIEW_DIR) : undefined);
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

  /** Tween all parameters to a preset, so the attractor morphs instead of jumping. */
  async applyPreset(values: readonly number[], ms = 1200) {
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
      this.scheduleReanalyze(0);
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
    }, 4000 + animateMs);
    return this.frameCamera(animateMs, MAP_VIEW_DIR, { center, radius });
  }

  /**
   * Re-run the reference trajectory after parameters or dt settle. Debounced so
   * dragging a slider stays smooth.
   */
  private scheduleReanalyze(delay = 180) {
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
      if (this.autoFrame) this.reframeIfNeeded();
    }, delay);
  }

  private reframeIfNeeded() {
    const a = this.sys.analysis;
    if (!a.ok || a.collapsed) return;
    const center = this.view.worldCenter();
    const ratio = a.radius / this.framed.radius;
    const moved = center.distanceTo(this.framed.center) > 0.25 * this.framed.radius;
    if (ratio < 0.7 || ratio > 1.4 || moved) void this.frameCamera(800);
  }

  // --- Poincaré section --------------------------------------------------------

  /** Whether the UI asked for the section (it stays off on maps regardless). */
  private sectionWanted = false;

  setSectionEnabled(on: boolean) {
    this.sectionWanted = on;
    this.sectionEnabled = on && this.attractor.kind === 'flow';
    this.sectionView.visible = this.sectionEnabled;
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

  /** Particle-count range for the current kind of system. */
  get particleLimits(): { min: number; max: number } {
    return this.attractor.kind === 'map' ? LIMITS.mapParticles : LIMITS.particles;
  }

  /** Keeps particles × trail within the vertex budget by shortening trails if needed. */
  setCount(n: number) {
    const { min, max } = this.particleLimits;
    const count = THREE.MathUtils.clamp(Math.round(n), min, max);
    // Maps have no trails; the budget only applies to flows.
    const trail = this.attractor.kind === 'map'
      ? LIMITS.trail.min
      : Math.min(this.sys.trailLength, Math.floor(LIMITS.maxVertices / count));
    this.sys.configure(count, Math.max(LIMITS.trail.min, trail));
    this.emit();
  }

  /** Keeps particles × trail within the vertex budget by reducing particles if needed. */
  setTrail(n: number) {
    if (this.attractor.kind === 'map') return; // maps are drawn without trails
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

  setAutoRotate(on: boolean) {
    this.stage.controls.autoRotate = on;
    this.emit();
  }

  // --- Camera ----------------------------------------------------------------

  /** Distance at which a sphere of `radius` fills the view with some margin. */
  private frameDistance(radius: number): number {
    const cam = this.stage.camera;
    const vfov = THREE.MathUtils.degToRad(cam.fov) / 2;
    const hfov = Math.atan(Math.tan(vfov) * cam.aspect);
    return (radius / Math.sin(Math.min(vfov, hfov))) * 1.1;
  }

  /**
   * Move the orbit target and camera onto the current attractor. Keeps the
   * current view direction unless `toDir` is given, in which case the camera
   * swings round to it during the glide.
   */
  frameCamera(
    animateMs = 800,
    toDir?: THREE.Vector3,
    fit: { center: [number, number, number]; radius: number } = this.sys.analysis,
  ): Promise<void> {
    const { camera: cam, controls } = this.stage;
    const { radius } = fit;
    const toTarget = this.view.modelToWorld(fit.center);
    const dist = this.frameDistance(radius);
    const fromDir = cam.position.clone().sub(controls.target);
    if (fromDir.lengthSq() < 1e-12) fromDir.copy(VIEW_DIR);
    fromDir.normalize();
    const endDir = (toDir ?? fromDir).clone().normalize();
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
  async saveScreenshot() {
    const blob = await this.stage.screenshot();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.attractor.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
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
      this.family.sync(this.view.fade, this.stage.camera, this.view.projScale);
      this.stage.render();
    });
  }
}
