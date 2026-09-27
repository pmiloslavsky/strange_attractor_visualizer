import * as THREE from 'three';
import type { ParticleSystem } from '../simulation/ParticleSystem';

/**
 * The original's "family": three photo-textured balls riding on particles
 * 0, 1 and 2 (moorcat, stella, nico). Drawn in an overlay scene after bloom
 * so the photos stay crisp instead of glowing.
 */
export const DEFAULT_FAMILY = [
  { name: 'Moorcat', url: 'family/moorcat.jpg' },
  { name: 'Stella', url: 'family/stella.jpg' },
  { name: 'Nico', url: 'family/nico.jpg' },
] as const;

const TEXTURE_SIZE = 256;
/** Ball diameter as a fraction of the attractor radius (matches the original screenshots). */
const RELATIVE_SIZE = 0.08;
/** Never draw a ball smaller than this many (drawing-buffer) pixels. */
const MIN_PIXELS = 36;
/** Seconds a ball takes to fade back in after being shot down. */
const REAPPEAR = 0.8;

/** Center-crop an image into a circle with a thin bright rim. */
export function circularCanvas(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const s = TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const side = Math.min(img.width, img.height);
  const rim = s * 0.035;

  ctx.save();
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - rim, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, s, s);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - rim / 2, 0, Math.PI * 2);
  ctx.lineWidth = rim;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.stroke();
  return canvas;
}

export class FamilyView {
  readonly group = new THREE.Group();
  private readonly sprites: THREE.Sprite[];
  private readonly tmp = new THREE.Vector3();
  /** Seconds each ball stays knocked out; ≤ 0 once back (down to −REAPPEAR while fading in). */
  private readonly downFor = DEFAULT_FAMILY.map(() => -REAPPEAR);
  /** Off by default; the tray's eye button or F shows them. */
  visible = false;

  constructor(private readonly sys: ParticleSystem) {
    this.group.rotation.x = -Math.PI / 2; // same model→world transform as AttractorView
    this.sprites = DEFAULT_FAMILY.map(() => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }),
      );
      sprite.visible = false; // until its texture arrives
      this.group.add(sprite);
      return sprite;
    });
  }

  setImage(i: number, canvas: HTMLCanvasElement) {
    const mat = this.sprites[i]!.material;
    mat.map?.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    mat.needsUpdate = true;
  }

  get count(): number {
    return this.sprites.length;
  }

  /** Knock ball `i` out (shot down) for `seconds`; it fades back in afterwards. */
  knockOut(i: number, seconds: number) {
    this.downFor[i] = seconds;
  }

  /** Whether ball `i` is on screen and not knocked out: something the A-10 can shoot at. */
  isTarget(i: number): boolean {
    const sprite = this.sprites[i];
    return !!sprite && sprite.visible && this.downFor[i]! <= 0;
  }

  /** World position of ball `i` as drawn last frame. */
  worldPosition(i: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateMatrixWorld();
    return target.copy(this.sprites[i]!.position).applyMatrix4(this.group.matrixWorld);
  }

  /** Ball `i`'s photo texture (circular crop), if loaded. */
  texture(i: number): THREE.Texture | null {
    return this.sprites[i]!.material.map;
  }

  /** World diameter of ball `i` as drawn last frame. */
  worldSize(i: number): number {
    return this.sprites[i]!.scale.x;
  }

  /** `ridden`: index of the ball the camera is riding behind; drawn small so it doesn't fill the view. */
  sync(fade: number, camera: THREE.Camera, projScale: number, ridden: number | null = null, realDt = 0) {
    const { sys } = this;
    const worldSize = sys.analysis.radius * RELATIVE_SIZE;
    this.group.updateMatrixWorld();
    this.sprites.forEach((sprite, i) => {
      // Count down while knocked out; the last REAPPEAR seconds are a fade-in.
      const down = (this.downFor[i] = Math.max(-REAPPEAR, this.downFor[i]! - realDt));
      sprite.visible = this.visible && i < sys.count && !!sprite.material.map && down <= 0;
      if (!sprite.visible) return;
      sprite.position.fromArray(sys.pos, 3 * i);
      const dist = this.tmp.copy(sprite.position).applyMatrix4(this.group.matrixWorld).distanceTo(camera.position);
      sprite.scale.setScalar(i === ridden ? worldSize * 0.3 : Math.max(worldSize, (MIN_PIXELS * dist) / projScale));
      sprite.material.opacity = fade * Math.min(1, -down / REAPPEAR);
    });
  }
}
