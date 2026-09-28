import * as THREE from 'three';
import { glowTexture } from './JetView';

const MAX_SPARKS = 1500;
const MAX_FLASHES = 40;
const MAX_SMOKE = 260;
const SHARDS = 24;
const RINGS = 4;

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function randomUnit(target = new THREE.Vector3()): THREE.Vector3 {
  const z = rand(-1, 1), a = rand(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
  return target.set(r * Math.cos(a), r * Math.sin(a), z);
}

/** A jagged dark fragment, for wreckage that has no photo. */
function debrisTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, r = 18 + Math.random() * 12;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#2e3236';
  ctx.fill();
  ctx.strokeStyle = '#ff8a3a';
  ctx.lineWidth = 3;
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft grey puff for smoke trails. */
function smokeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(200,200,205,0.9)');
  g.addColorStop(0.5, 'rgba(170,170,178,0.45)');
  g.addColorStop(1, 'rgba(150,150,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Flash {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  from: number;
  to: number;
  color: THREE.Color;
}

interface Puff {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  from: number;
  to: number;
}

interface Shard {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  spin: number;
  age: number;
  life: number;
}

interface Ring {
  mesh: THREE.Mesh;
  age: number;
  size: number;
}

/**
 * Pooled combat effects shared by the A-10's cannon and the Apache's
 * missiles: flashes (glow sprites that swell and fade), sparks, spinning
 * shards (pieces of a photo, or dark wreckage), expanding shock rings and
 * grey smoke puffs. Glowing parts are additive so bloom picks them up. All
 * sizes are in world units, usually multiples of the target's size.
 */
export class Effects {
  /** Add to Stage.scene. */
  readonly group = new THREE.Group();

  private readonly flashes: Flash[] = [];
  private readonly puffs: Puff[] = [];
  private readonly shards: Shard[] = [];
  private readonly rings: Ring[] = [];
  private readonly debris = debrisTexture();

  private readonly sparkGeom = new THREE.BufferGeometry();
  private readonly sparkMat: THREE.PointsMaterial;
  private readonly sparkPos = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkCol = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkVel = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkBase = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkLife = new Float32Array(MAX_SPARKS * 2); // age, life
  private nextSpark = 0;
  private sparkSize = 1;
  /**
   * Points are sized in world units against half the viewport height, sprites
   * against the view's full vertical extent; multiply point sizes by this so
   * the two agree.
   */
  pointScale = 1;

  constructor() {
    const glow = glowTexture();
    for (let i = 0; i < MAX_FLASHES; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
      );
      sprite.visible = false;
      this.flashes.push({ sprite, age: 1, life: 1, from: 1, to: 1, color: new THREE.Color() });
      this.group.add(sprite);
    }

    const smoke = smokeTexture();
    for (let i = 0; i < MAX_SMOKE; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, transparent: true, depthWrite: false }));
      sprite.visible = false;
      this.puffs.push({ sprite, age: 1, life: 1, from: 1, to: 1 });
      this.group.add(sprite);
    }

    for (let i = 0; i < SHARDS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      sprite.visible = false;
      this.shards.push({ sprite, vel: new THREE.Vector3(), spin: 0, age: 1, life: 1 });
      this.group.add(sprite);
    }

    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 1, 64),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color('#ffb070').multiplyScalar(1.6),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.visible = false;
      this.rings.push({ mesh, age: Infinity, size: 1 });
      this.group.add(mesh);
    }

    for (let i = 0; i < MAX_SPARKS; i++) this.sparkLife[2 * i] = this.sparkLife[2 * i + 1] = 1;
    this.sparkGeom.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkGeom.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkMat = new THREE.PointsMaterial({
      map: glowTexture(),
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const sparks = new THREE.Points(this.sparkGeom, this.sparkMat);
    sparks.frustumCulled = false;
    this.group.add(sparks);
  }

  /** A glow that swells from `from` to `to` (world diameters) and fades over `life` seconds. */
  flash(at: THREE.Vector3, from: number, to: number, life: number, color: string, intensity: number) {
    const f = this.oldest(this.flashes);
    f.sprite.position.copy(at);
    Object.assign(f, { age: 0, life, from, to });
    f.color.set(color).multiplyScalar(intensity);
    f.sprite.visible = true;
  }

  /** A grey smoke puff that grows and thins out. */
  smoke(at: THREE.Vector3, from: number, to: number, life: number) {
    const p = this.oldest(this.puffs);
    p.sprite.position.copy(at);
    p.sprite.material.rotation = rand(0, Math.PI * 2);
    Object.assign(p, { age: 0, life, from, to });
    p.sprite.visible = true;
  }

  /** `count` sparks flying out at up to `speed` × `size` per second, fading over about `life` seconds. */
  sparks(at: THREE.Vector3, size: number, count: number, speed: number, rgb: [number, number, number], life: number) {
    this.sparkSize = size;
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const i = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % MAX_SPARKS;
      randomUnit(v).multiplyScalar(size * speed * rand(0.3, 1));
      this.sparkPos.set([at.x, at.y, at.z], 3 * i);
      this.sparkVel.set([v.x, v.y, v.z], 3 * i);
      const w = rand(0.6, 1.2);
      this.sparkBase.set([rgb[0] * w, rgb[1] * w, rgb[2] * w], 3 * i);
      this.sparkLife[2 * i] = 0;
      this.sparkLife[2 * i + 1] = life * rand(0.5, 1);
    }
  }

  /** A small hit: a quick flash and a few sparks. */
  impact(at: THREE.Vector3, size: number) {
    this.flash(at, size * 0.6, size * 0.2, 0.1, '#ffe2a0', 2);
    this.sparks(at, size, 5, 1.8, [3, 2, 0.8], 0.3);
  }

  /**
   * Something blown up: fireball, sparks, a shock ring and tumbling pieces,
   * cut from `photo` if given, else dark wreckage.
   */
  explode(at: THREE.Vector3, size: number, photo: THREE.Texture | null) {
    this.flash(at, size * 0.5, size * 1.8, 0.55, '#ffcf7a', 3);
    this.flash(at, size * 0.3, size * 1.1, 0.3, '#ffffff', 3.5);
    this.flash(at, size * 0.7, size * 2.4, 0.9, '#ff5a1a', 1.1);
    this.sparks(at, size, 160, 2.8, [4, 2.2, 0.7], 1.1);
    this.sparks(at, size, 80, 1.4, [3, 0.8, 0.2], 1.6);
    for (let k = 0; k < 12; k++) {
      const s = this.oldest(this.shards);
      s.sprite.material.map = photo ?? this.debris;
      s.sprite.material.needsUpdate = true;
      s.sprite.position.copy(at).addScaledVector(randomUnit(), size * 0.25);
      s.sprite.scale.setScalar(size * rand(0.25, 0.4));
      s.sprite.visible = true;
      randomUnit(s.vel).multiplyScalar(size * rand(1.5, 3));
      s.spin = rand(-12, 12);
      s.age = 0;
      s.life = rand(1, 1.8);
    }
    const ring = this.rings.reduce((a, b) => (b.age > a.age ? b : a));
    ring.mesh.position.copy(at);
    ring.size = size;
    ring.age = 0;
  }

  /** Advance one frame. */
  update(dt: number, camera: THREE.Camera) {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    this.pointScale = 1 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);

    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      const k = (f.age += dt) / f.life;
      if (k >= 1) {
        f.sprite.visible = false;
        continue;
      }
      f.sprite.scale.setScalar(f.from + (f.to - f.from) * (1 - (1 - k) ** 3));
      f.sprite.material.color.copy(f.color).multiplyScalar((1 - k) ** 2);
    }

    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      const k = (p.age += dt) / p.life;
      if (k >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.sprite.scale.setScalar(p.from + (p.to - p.from) * (1 - (1 - k) ** 2));
      p.sprite.material.opacity = 0.55 * (1 - k);
    }

    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < MAX_SPARKS; i++) {
      const age = (this.sparkLife[2 * i] = this.sparkLife[2 * i]! + dt);
      const life = this.sparkLife[2 * i + 1]!;
      if (age >= life) {
        this.sparkCol[3 * i] = this.sparkCol[3 * i + 1] = this.sparkCol[3 * i + 2] = 0;
        continue;
      }
      const k = 1 - age / life;
      for (let a = 0; a < 3; a++) {
        this.sparkVel[3 * i + a]! *= drag;
        this.sparkPos[3 * i + a]! += this.sparkVel[3 * i + a]! * dt;
        // Fade out, reddening as they cool.
        this.sparkCol[3 * i + a] = this.sparkBase[3 * i + a]! * k * (a === 0 ? 1 : k);
      }
    }
    this.sparkMat.size = this.sparkSize * 0.3 * this.pointScale;
    this.sparkGeom.attributes.position!.needsUpdate = true;
    this.sparkGeom.attributes.color!.needsUpdate = true;

    for (const s of this.shards) {
      if (!s.sprite.visible) continue;
      const k = (s.age += dt) / s.life;
      if (k >= 1) {
        s.sprite.visible = false;
        continue;
      }
      s.vel.multiplyScalar(drag);
      s.sprite.position.addScaledVector(s.vel, dt);
      s.sprite.material.rotation += s.spin * dt;
      s.sprite.material.opacity = 1 - k * k;
    }

    for (const r of this.rings) {
      const k = (r.age += dt) / 0.6;
      r.mesh.visible = k < 1;
      if (!r.mesh.visible) continue;
      r.mesh.quaternion.copy(camera.quaternion);
      r.mesh.scale.setScalar(r.size * (0.4 + 1.6 * (1 - (1 - k) ** 2)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7;
    }
  }

  /** The pool entry furthest through its life (or unused), to reuse. */
  private oldest<T extends { age: number; life: number; sprite: THREE.Sprite }>(pool: T[]): T {
    return pool.find((e) => !e.sprite.visible) ?? pool.reduce((a, b) => (b.age / b.life > a.age / a.life ? b : a));
  }
}
