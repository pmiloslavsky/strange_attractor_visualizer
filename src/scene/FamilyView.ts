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
  visible = true;

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

  sync(fade: number, camera: THREE.Camera, projScale: number) {
    const { sys } = this;
    const worldSize = sys.analysis.radius * RELATIVE_SIZE;
    this.group.updateMatrixWorld();
    this.sprites.forEach((sprite, i) => {
      sprite.visible = this.visible && i < sys.count && !!sprite.material.map;
      if (!sprite.visible) return;
      sprite.position.fromArray(sys.pos, 3 * i);
      const dist = this.tmp.copy(sprite.position).applyMatrix4(this.group.matrixWorld).distanceTo(camera.position);
      sprite.scale.setScalar(Math.max(worldSize, (MIN_PIXELS * dist) / projScale));
      sprite.material.opacity = fade;
    });
  }
}
