import * as THREE from 'three';
import type { Analysis } from '../simulation/analysis';

/** Original colors: x red, y green, z blue (softened a little for the dark, glowing scene). */
const AXES = [
  { name: 'x', color: '#ff6b6b', dir: new THREE.Vector3(1, 0, 0) },
  { name: 'y', color: '#6bff8f', dir: new THREE.Vector3(0, 1, 0) },
  { name: 'z', color: '#6b9bff', dir: new THREE.Vector3(0, 0, 1) },
] as const;

function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The original's reference-frame axes: lines from the model origin along +x,
 * +y and +z. Each reaches a little past the attractor's extent on that axis,
 * so it stays in proportion from Lorenz (≈ ±25) to Newton–Leipnik (≈ ±0.7).
 * Lives in model space (add to the AttractorView group).
 */
export class AxesView {
  readonly group = new THREE.Group();
  private readonly lines: THREE.Line[] = [];
  private readonly labels: THREE.Sprite[] = [];
  private shownFor?: Analysis;

  constructor() {
    for (const a of AXES) {
      const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), a.dir.clone()]);
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color: a.color, transparent: true, opacity: 0.75, depthWrite: false }),
      );
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: labelTexture(a.name, a.color), transparent: true, depthWrite: false }),
      );
      this.lines.push(line);
      this.labels.push(label);
      this.group.add(line, label);
    }
    this.group.visible = false;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Resize to the current attractor. */
  sync(analysis: Analysis) {
    if (!this.group.visible || analysis === this.shownFor) return;
    this.shownFor = analysis;
    const r = analysis.radius;
    AXES.forEach((a, k) => {
      const [lo, hi] = analysis.ranges[k]!;
      // Reach past the far side of the attractor along +axis (or a sensible minimum).
      const len = Math.max(hi * 1.15, Math.abs(lo) * 0.6, r * 0.35);
      this.lines[k]!.scale.setScalar(len);
      this.labels[k]!.position.copy(a.dir).multiplyScalar(len + r * 0.05);
      this.labels[k]!.scale.setScalar(r * 0.08);
    });
  }
}
