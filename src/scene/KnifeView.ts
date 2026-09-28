import * as THREE from 'three';
import type { Target } from './combat';
import { type Effects, rand, randomUnit } from './Effects';

/** Seconds between volleys (random in this range), counted only while there is something to hit. */
const WAIT: [number, number] = [10, 20];
/** Knives per volley, and seconds between throws. */
const VOLLEY = 3;
const THROW_GAP = 0.18;
/** Seconds a knife takes to reach its aim point, and how high it arcs (in target sizes). */
const TRAVEL = 0.75;
const ARC = 1.2;
/** A missed knife keeps tumbling this long past its aim point. */
const OVERSHOOT = 0.5;
/** Knife hits that bring an aircraft down. */
const KILL_HITS = 2;
/** Share of volleys thrown wide. */
const MISS_CHANCE = 0.35;
/** Turns per second, end over end. */
const SPIN = 3.2;
/** Knife length relative to the thrower's size. */
const LENGTH = 0.55;
const MAX_KNIVES = 9;

interface Knife {
  mesh: THREE.Group;
  from: THREE.Vector3;
  offset: THREE.Vector3;
  target: Target;
  hits: boolean;
  age: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
  /** Axis it tumbles about, perpendicular to its flight. */
  spinAxis: THREE.Vector3;
  active: boolean;
}

export interface Thrower {
  /** On screen and able to throw. */
  alive(): boolean;
  position(target?: THREE.Vector3): THREE.Vector3;
  size(): number;
  /** Called on each throw, for a little wind-up animation. */
  onThrow?(): void;
}

/**
 * Moorcat fights back: every so often the cat throws a volley of knives at
 * the Apache or the A-10. Each knife tumbles end over end along an arc to its
 * target; two hits bring the aircraft down. About a third of volleys go wide.
 * The knives are lit meshes, drawn crisp in the overlay scene.
 */
export class KnifeView {
  /** Add to Stage.overlay. */
  readonly bodies = new THREE.Group();
  enabled = true;

  private wait = rand(...WAIT) * 0.6;
  private volley: { target: Target; thrown: number; clock: number; hits: number; miss: boolean; missDir: THREE.Vector3 } | null = null;
  private readonly knives: Knife[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(private readonly fx: Effects) {
    const steel = new THREE.MeshStandardMaterial({ color: '#d8dde2', metalness: 0.95, roughness: 0.18 });
    const handleMat = new THREE.MeshStandardMaterial({ color: '#3a2418', metalness: 0.1, roughness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: '#b8923a', metalness: 0.9, roughness: 0.3 });
    // Local model: length 1 along +Z, point forward. The blade tapers to a point.
    const blade = new THREE.Shape();
    blade.moveTo(-0.05, 0);
    blade.lineTo(0.05, 0);
    blade.lineTo(0.045, 0.45);
    blade.lineTo(0, 0.6);
    blade.lineTo(-0.02, 0.5);
    blade.closePath();
    const bladeGeom = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 })
      .rotateX(Math.PI / 2) // shape y (length) → +Z, extrusion (thickness) → −Y
      .translate(0, 0.012, 0);
    const handle = new THREE.CylinderGeometry(0.035, 0.03, 0.34, 10).rotateX(Math.PI / 2).translate(0, 0, -0.2);
    const guard = new THREE.BoxGeometry(0.2, 0.04, 0.03);
    for (let i = 0; i < MAX_KNIVES; i++) {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(bladeGeom, steel), new THREE.Mesh(handle, handleMat), new THREE.Mesh(guard, brass));
      mesh.visible = false;
      this.bodies.add(mesh);
      this.knives.push({
        mesh, from: new THREE.Vector3(), offset: new THREE.Vector3(), target: null as unknown as Target,
        hits: false, age: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1,
        spinAxis: new THREE.Vector3(1, 0, 0), active: false,
      });
    }
  }

  /** Stop any volley and remove knives in flight (e.g. on an attractor switch). */
  reset() {
    this.volley = null;
    this.wait = rand(...WAIT);
    for (const k of this.knives) k.active = k.mesh.visible = false;
  }

  /** Skip the rest of the wait: throw at the next chance. */
  throwSoon() {
    this.wait = 0;
  }

  /** Advance one frame. `paused` freezes throwing but lets knives in flight land. */
  update(realDt: number, cat: Thrower, targets: readonly Target[], paused: boolean) {
    const dt = Math.min(realDt, 0.1);
    const armed = this.enabled && cat.alive() && !paused;
    if (!armed) this.volley = null;
    else if (this.volley) this.throwKnives(dt, cat, targets);
    else {
      const candidates = targets.filter((t) => t.alive());
      if (candidates.length && (this.wait -= dt) <= 0) {
        const target = candidates[Math.floor(Math.random() * candidates.length)]!;
        this.volley = { target, thrown: 0, clock: THROW_GAP, hits: 0, miss: Math.random() < MISS_CHANCE, missDir: randomUnit() };
      }
    }
    for (const k of this.knives) if (k.active) this.fly(k, dt);
  }

  private throwKnives(dt: number, cat: Thrower, targets: readonly Target[]) {
    const v = this.volley!;
    if (!v.target.alive() || !targets.includes(v.target)) {
      this.endVolley();
      return;
    }
    v.clock += dt;
    if (v.clock < THROW_GAP || v.thrown >= VOLLEY) {
      if (v.thrown >= VOLLEY && !this.knives.some((k) => k.active && k.target === v.target)) this.endVolley();
      return;
    }
    const k = this.knives.find((x) => !x.active);
    if (!k) return;
    v.clock = 0;
    v.thrown++;
    const offset = randomUnit().multiplyScalar(rand(0, 0.4));
    if (v.miss) offset.addScaledVector(v.missDir, rand(1.3, 2.2));
    cat.position(k.from);
    k.pos.copy(k.from);
    k.offset.copy(offset);
    k.target = v.target;
    k.hits = offset.length() < 0.45;
    k.age = 0;
    k.size = cat.size() * LENGTH;
    k.active = k.mesh.visible = true;
    cat.onThrow?.();
  }

  private endVolley() {
    this.volley = null;
    this.wait = rand(...WAIT);
  }

  private fly(k: Knife, dt: number) {
    k.age += dt;
    const prev = this.tmp.copy(k.pos);
    if (k.age <= TRAVEL) {
      // Along an arc to the aim point, which moves with the target.
      const s = k.target.size();
      const aim = k.target.position().addScaledVector(k.offset, s);
      const u = k.age / TRAVEL;
      k.pos.lerpVectors(k.from, aim, u).y += ARC * s * 4 * u * (1 - u);
      k.vel.copy(k.pos).sub(prev).divideScalar(Math.max(dt, 1e-4));
    } else if (k.hits && k.target.alive()) {
      const at = k.target.position();
      const size = k.target.size();
      this.fx.impact(at, size);
      if (this.volley?.target === k.target && ++this.volley.hits >= KILL_HITS) {
        this.fx.explode(at, size, null);
        k.target.kill();
        this.volley.thrown = VOLLEY; // no more knives for a dead target
      }
      k.active = k.mesh.visible = false;
      return;
    } else if (k.hits || k.age > TRAVEL + OVERSHOOT) {
      k.active = k.mesh.visible = false;
      return;
    } else {
      k.pos.addScaledVector(k.vel, dt);
    }
    // Point along the flight, tumbling end over end about a sideways axis.
    const dir = this.tmp.copy(k.vel).normalize();
    k.spinAxis.set(0, 1, 0).cross(dir);
    if (k.spinAxis.lengthSq() < 1e-6) k.spinAxis.set(1, 0, 0);
    k.spinAxis.normalize();
    k.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    k.mesh.quaternion.premultiply(this.q.setFromAxisAngle(k.spinAxis, k.age * SPIN * Math.PI * 2));
    k.mesh.position.copy(k.pos);
    const fade = k.age > TRAVEL ? 1 - (k.age - TRAVEL) / OVERSHOOT : 1;
    k.mesh.scale.setScalar(k.size * Math.max(0.05, fade));
  }
}
