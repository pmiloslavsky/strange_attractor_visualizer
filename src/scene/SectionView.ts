import * as THREE from 'three';
import type { Analysis } from '../simulation/analysis';
import type { PoincareSection } from '../simulation/poincare';

/**
 * The Poincaré section in 3D: a faint plane through the attractor and a
 * glowing dot at every recorded crossing. Lives in model space (add it to
 * the AttractorView group).
 */
export class SectionView {
  readonly group = new THREE.Group();
  private readonly plane: THREE.Mesh;
  private readonly outline: THREE.LineSegments;
  private readonly dots: THREE.Points;
  private readonly dotAttr: THREE.BufferAttribute;
  private shownVersion = -1;
  private shownHead = 0;

  constructor(private readonly section: PoincareSection) {
    const color = new THREE.Color('#ffb070');
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    const geom = new THREE.BufferGeometry();
    this.dotAttr = new THREE.BufferAttribute(section.points, 3).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.dotAttr);
    geom.setDrawRange(0, 0);
    this.dots = new THREE.Points(
      geom,
      new THREE.PointsMaterial({
        // Thousands of dots stack on thin curves; keep each faint so the
        // structure stays visible under bloom instead of blowing out.
        color: '#ffc890',
        size: 2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.dots.frustumCulled = false;
    this.group.add(this.plane, this.outline, this.dots);
    this.group.visible = false;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** Position the plane for the current section and attractor, and upload new dots. */
  sync(analysis: Analysis) {
    if (!this.group.visible) return;
    const { axis, offset } = this.section;
    const [u, v] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
    const r = analysis.ranges;
    const size = (k: number) => 1.3 * (r[k]![1] - r[k]![0]) || 1;
    const mid = (k: number) => (r[k]![0] + r[k]![1]) / 2;
    // PlaneGeometry lies in its local XY; rotate so its normal is the section axis.
    for (const obj of [this.plane, this.outline]) {
      obj.rotation.set(axis === 1 ? Math.PI / 2 : 0, axis === 0 ? Math.PI / 2 : 0, 0);
      const pos = [0, 0, 0];
      pos[axis] = offset;
      pos[u] = mid(u);
      pos[v] = mid(v);
      obj.position.fromArray(pos);
      // After rotation, local x/y map to the two in-plane model axes.
      const [sx, sy] = axis === 0 ? [size(2), size(1)] : axis === 1 ? [size(0), size(2)] : [size(0), size(1)];
      obj.scale.set(sx, sy, 1);
    }

    // Upload only what was written since last time (the ring may have wrapped).
    const sec = this.section;
    if (sec.version !== this.shownVersion) {
      this.shownVersion = sec.version;
      this.shownHead = 0;
    }
    if (sec.head !== this.shownHead) {
      const from = this.shownHead, to = sec.head;
      if (to > from) this.dotAttr.addUpdateRange(from * 3, (to - from) * 3);
      else {
        this.dotAttr.addUpdateRange(from * 3, (sec.capacity - from) * 3);
        this.dotAttr.addUpdateRange(0, to * 3);
      }
      this.dotAttr.needsUpdate = true;
      this.shownHead = to;
    }
    // Before the ring fills, only the first `count` entries are valid.
    this.dots.geometry.setDrawRange(0, sec.count);
  }
}
