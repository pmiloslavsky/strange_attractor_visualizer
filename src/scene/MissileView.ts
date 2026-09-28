import * as THREE from 'three';
import type { Target } from './combat';
import { type Effects, rand } from './Effects';
import { glowTexture } from './JetView';

/** Seconds between salvos (random in this range), counted only while there is something to shoot. */
const WAIT: [number, number] = [12, 25];
/** Missiles per salvo, and seconds between them. */
const SALVO = 2;
const SALVO_GAP = 0.45;
/** Motion, in multiples of the target's size (per second, per second²). */
const LAUNCH_SPEED = 4;
const DROP_SPEED = 1.2;
const IGNITION = 0.18;
const ACCEL = 45;
const MAX_SPEED = 22;
/** Radians per second the missile can turn once its motor is lit. */
const TURN_RATE = 3.5;
/** Share of missiles that lose lock, fly off and self-destruct. */
const LOSE_LOCK_CHANCE = 0.25;
const LOSE_LOCK_AT = 0.5;
const SELF_DESTRUCT = 3;
/** A locked missile that still hasn't caught its target gives up after this long. */
const MAX_FLIGHT = 5;
const MAX_MISSILES = 6;
/** Missile length relative to the target's size. */
const LENGTH = 0.6;

interface Missile {
  body: THREE.Group;
  glow: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  target: Target | null;
  losesLock: boolean;
  /** Scale for speeds and size, fixed at launch. */
  unit: number;
  smokeClock: number;
  active: boolean;
}

export interface MissileCarrier {
  /** Drawn this frame (visible and not shot down). */
  flying: boolean;
  /** World position of the left (−1) or right (+1) missile rack. */
  rack(side: -1 | 1, target?: THREE.Vector3): THREE.Vector3;
  forward(target?: THREE.Vector3): THREE.Vector3;
}

/**
 * The Apache's Hellfire missiles: every so often it picks a target and
 * fires a pair, alternating wing racks. Each missile drops clear, lights its
 * motor, accelerates and homes in with a limited turn rate, trailing grey
 * smoke; a hit blows the target up. A quarter lose lock, fly off and
 * self-destruct in a small airburst.
 */
export class MissileView {
  /** Add to Stage.overlay (the lit missile bodies). */
  readonly bodies = new THREE.Group();
  /** Add to Stage.scene (motor glows, so bloom picks them up). */
  readonly glows = new THREE.Group();
  enabled = true;

  private wait = rand(...WAIT) * 0.4; // the first salvo comes sooner
  private salvo: { target: Target; fired: number; clock: number } | null = null;
  private nextSide: -1 | 1 = -1;
  private readonly missiles: Missile[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(private readonly fx: Effects) {
    const white = new THREE.MeshStandardMaterial({ color: '#c9ccc4', metalness: 0.3, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: '#3a3f36', metalness: 0.4, roughness: 0.5 });
    // Local model: length 1 along +Z, nose forward.
    const tube = new THREE.CylinderGeometry(0.07, 0.07, 0.8, 16).rotateX(Math.PI / 2).translate(0, 0, -0.05);
    const nose = new THREE.SphereGeometry(0.07, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.35);
    const finGeom = new THREE.BoxGeometry(0.01, 0.26, 0.14);
    const glowMap = glowTexture();
    for (let i = 0; i < MAX_MISSILES; i++) {
      const body = new THREE.Group();
      body.add(new THREE.Mesh(tube, white), new THREE.Mesh(nose, dark));
      for (const [z, s] of [[0.2, 0.55], [-0.38, 1]] as const) {
        for (let f = 0; f < 4; f++) {
          const fin = new THREE.Mesh(finGeom, dark);
          fin.scale.set(1, s, s);
          fin.position.z = z;
          fin.rotation.z = (f * Math.PI) / 2 + Math.PI / 4;
          body.add(fin);
        }
      }
      body.visible = false;
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowMap,
          color: new THREE.Color('#ffc07a').multiplyScalar(3),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      );
      glow.visible = false;
      this.bodies.add(body);
      this.glows.add(glow);
      this.missiles.push({
        body, glow, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0,
        target: null, losesLock: false, unit: 1, smokeClock: 0, active: false,
      });
    }
  }

  /** Stop any salvo and remove missiles in flight (e.g. on an attractor switch). */
  reset() {
    this.salvo = null;
    this.wait = rand(...WAIT);
    for (const m of this.missiles) this.retire(m);
  }

  /** Skip the rest of the wait: fire at the next chance. */
  fireSoon() {
    this.wait = 0;
  }

  /** Advance one frame. `paused` freezes launching but lets missiles in flight finish. */
  update(realDt: number, heli: MissileCarrier, targets: readonly Target[], paused: boolean) {
    const dt = Math.min(realDt, 0.1);
    const armed = this.enabled && heli.flying && !paused;
    if (!armed) this.salvo = null;
    else if (this.salvo) this.launch(dt, heli, targets);
    else {
      const candidates = targets.filter((t) => t.alive());
      if (candidates.length && (this.wait -= dt) <= 0) {
        this.salvo = { target: candidates[Math.floor(Math.random() * candidates.length)]!, fired: 0, clock: SALVO_GAP };
      }
    }
    for (const m of this.missiles) if (m.active) this.fly(m, dt, targets);
  }

  private launch(dt: number, heli: MissileCarrier, targets: readonly Target[]) {
    const s = this.salvo!;
    s.clock += dt;
    if (s.clock < SALVO_GAP) return;
    const m = this.missiles.find((x) => !x.active);
    if (!m || !s.target.alive() || !targets.includes(s.target)) {
      this.endSalvo();
      return;
    }
    s.clock = 0;
    const forward = heli.forward(this.tmp);
    Object.assign(m, {
      active: true,
      age: 0,
      target: s.target,
      losesLock: Math.random() < LOSE_LOCK_CHANCE,
      unit: s.target.size(),
      smokeClock: 0,
    });
    heli.rack(this.nextSide, m.pos);
    m.vel.copy(forward).multiplyScalar(LAUNCH_SPEED * m.unit).add(this.tmp2.set(0, -DROP_SPEED * m.unit, 0));
    m.body.visible = true;
    this.nextSide = this.nextSide === -1 ? 1 : -1;
    this.fx.flash(m.pos, m.unit * 0.3, m.unit * 0.8, 0.15, '#fff0c0', 2); // rail flash
    if (++s.fired >= SALVO) this.endSalvo();
  }

  private endSalvo() {
    this.salvo = null;
    this.wait = rand(...WAIT);
  }

  private fly(m: Missile, dt: number, targets: readonly Target[]) {
    m.age += dt;
    const u = m.unit;
    const lit = m.age > IGNITION;
    // Lost lock, or the target was destroyed by something else: find another, or fly on blind.
    if (m.losesLock && m.age > LOSE_LOCK_AT) m.target = null;
    else if (m.target && !m.target.alive()) m.target = targets.find((t) => t.alive()) ?? null;

    if (lit) {
      const speed = Math.min(MAX_SPEED * u, m.vel.length() + ACCEL * u * dt);
      const dir = this.tmp.copy(m.vel).normalize();
      if (m.target) {
        // Turn toward the target, limited to TURN_RATE.
        const want = m.target.position(this.tmp2).sub(m.pos).normalize();
        const angle = dir.angleTo(want);
        const turn = Math.min(1, (TURN_RATE * dt) / Math.max(angle, 1e-6));
        dir.lerp(want, turn).normalize();
      }
      m.vel.copy(dir).multiplyScalar(speed);
    } else {
      m.vel.y -= 4 * u * dt; // falling clear of the rack before the motor lights
    }
    m.pos.addScaledVector(m.vel, dt);

    // Hit?
    if (m.target && m.pos.distanceTo(m.target.position(this.tmp2)) < m.target.size() * 0.55) {
      this.fx.explode(this.tmp2, m.target.size(), m.target.photo());
      m.target.kill();
      this.retire(m);
      return;
    }
    // Out of fuel or lock: a small airburst.
    if ((!m.target && m.age > SELF_DESTRUCT) || m.age > MAX_FLIGHT) {
      this.fx.flash(m.pos, u * 0.3, u * 1.2, 0.35, '#ffcf7a', 2.5);
      this.fx.sparks(m.pos, u, 40, 2, [3.5, 1.8, 0.6], 0.8);
      this.retire(m);
      return;
    }

    // Draw: body along the velocity, motor glow and smoke behind.
    m.body.position.copy(m.pos);
    m.body.quaternion.setFromUnitVectors(this.tmp.set(0, 0, 1), this.tmp2.copy(m.vel).normalize());
    m.body.scale.setScalar(u * LENGTH);
    const tail = this.tmp.copy(m.vel).normalize().multiplyScalar(-u * LENGTH * 0.5).add(m.pos);
    m.glow.visible = lit;
    m.glow.position.copy(tail);
    m.glow.scale.setScalar(u * rand(0.35, 0.5));
    if (lit && (m.smokeClock -= dt) <= 0) {
      m.smokeClock = 0.022;
      this.fx.smoke(tail, u * 0.2, u * 1.1, 1.4);
    }
  }

  private retire(m: Missile) {
    m.active = false;
    m.target = null;
    m.body.visible = m.glow.visible = false;
  }
}
