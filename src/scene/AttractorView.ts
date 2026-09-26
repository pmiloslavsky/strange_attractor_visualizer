import * as THREE from 'three';
import type { ParticleSystem } from '../simulation/ParticleSystem';
import { paletteTexture, type PaletteName } from './palettes';
import { COLOR_MODES, headFragment, headVertex, trailFragment, trailVertex, type ColorMode } from './shaders';

/** The density the default trail opacity is tuned for (particles × trail length). */
const REFERENCE_PARTICLES = 1500;
const REFERENCE_TRAIL = 240;

export interface ViewStyle {
  palette: PaletteName;
  colorMode: ColorMode;
  /** Palette offset per second of real time; 0 disables cycling. */
  cycleSpeed: number;
  trailOpacity: number;
  /** World-space particle diameter (the original's particle_size slider). */
  particleSize: number;
}

/**
 * Renders a ParticleSystem: trails as one indexed LineSegments draw and heads
 * as one Points draw, both reading the same GPU position buffer.
 */
export class AttractorView {
  /** Model space is z-up (as in the ODEs); rotate so model z is world up. */
  readonly group = new THREE.Group();

  private readonly uniforms = {
    uPalette: { value: paletteTexture('Aurora') },
    uHead: { value: 0 },
    uCount: { value: 1 },
    uTrailLength: { value: 2 },
    uColorMode: { value: 0 },
    uSpeedRange: { value: new THREE.Vector2(0, 1) },
    uZRange: { value: new THREE.Vector2(0, 1) },
    uHeightAxis: { value: new THREE.Vector3(0, 0, 1) },
    uCycle: { value: 0 },
    uTrailOpacity: { value: 0.07 },
    uHeadOpacity: { value: 1 },
    uFade: { value: 1 },
    uSize: { value: 1 },
    uProjScale: { value: 1 },
    uMinPointPx: { value: 2 },
  };

  private trails?: THREE.LineSegments;
  private heads?: THREE.Points;
  private posAttr?: THREE.BufferAttribute;
  private speedAttr?: THREE.BufferAttribute;
  private indexAttr?: THREE.BufferAttribute;
  private builtVersion = -1;
  private readonly trailMaterial: THREE.ShaderMaterial;
  private readonly headMaterial: THREE.ShaderMaterial;

  style: ViewStyle = {
    palette: 'Aurora',
    colorMode: 'speed',
    cycleSpeed: 0.03,
    trailOpacity: 0.07,
    particleSize: 0.33,
  };

  constructor(private readonly sys: ParticleSystem) {
    this.group.rotation.x = -Math.PI / 2;
    const shared = {
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    };
    this.trailMaterial = new THREE.ShaderMaterial({ ...shared, vertexShader: trailVertex, fragmentShader: trailFragment });
    this.headMaterial = new THREE.ShaderMaterial({ ...shared, vertexShader: headVertex, fragmentShader: headFragment });
    this.setStyle({});
  }

  /** Overall opacity, used for cross-fades between attractors. */
  set fade(v: number) {
    this.uniforms.uFade.value = v;
  }
  get fade(): number {
    return this.uniforms.uFade.value;
  }

  /** Drawing-buffer pixels per world unit at distance 1. */
  get projScale(): number {
    return this.uniforms.uProjScale.value;
  }

  setStyle(patch: Partial<ViewStyle>) {
    const prevPalette = this.style.palette;
    this.style = { ...this.style, ...patch };
    if (patch.palette && patch.palette !== prevPalette) paletteTexture(this.style.palette, this.uniforms.uPalette.value);
    this.uniforms.uColorMode.value = COLOR_MODES.indexOf(this.style.colorMode);
  }

  /** Pixels per world unit at distance 1, for world-sized point sprites. */
  setProjection(camera: THREE.PerspectiveCamera, drawingBufferHeight: number) {
    this.uniforms.uProjScale.value = drawingBufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  /** Push simulation state to the GPU; call once per frame after advance(). */
  sync(realDt: number) {
    const sys = this.sys;
    if (sys.version !== this.builtVersion) this.build();
    const pos = this.posAttr!, speed = this.speedAttr!, index = this.indexAttr!;
    const n = sys.count;

    if (sys.fullDirty) {
      pos.clearUpdateRanges();
      speed.clearUpdateRanges();
      index.clearUpdateRanges();
      pos.needsUpdate = speed.needsUpdate = index.needsUpdate = true;
      sys.fullDirty = false;
      sys.lastWrite = null;
    } else if (sys.lastWrite) {
      const { slot, prevSlot } = sys.lastWrite;
      pos.addUpdateRange(slot * n * 3, n * 3);
      speed.addUpdateRange(slot * n, n);
      index.addUpdateRange(prevSlot * n * 2, n * 2);
      index.addUpdateRange(slot * n * 2, n * 2);
      pos.needsUpdate = speed.needsUpdate = index.needsUpdate = true;
      sys.lastWrite = null;
    }

    const u = this.uniforms;
    u.uHead.value = sys.head;
    u.uSpeedRange.value.set(...sys.speedRange);
    u.uZRange.value.set(...sys.zRange);
    u.uSize.value = this.style.particleSize;
    u.uHeightAxis.value.set(0, sys.heightAxis === 1 ? 1 : 0, sys.heightAxis === 2 ? 1 : 0);
    // Additive blending makes brightness grow with density. Above the default
    // density, dim trails and heads so more particles read as smoother, not
    // as a white-out. Below it, leave them alone (sparse scenes stay crisp).
    const density = (n * sys.trailLength) / (REFERENCE_PARTICLES * REFERENCE_TRAIL);
    u.uTrailOpacity.value = this.style.trailOpacity * Math.min(1, density ** -0.8);
    u.uHeadOpacity.value = Math.min(1, (n / REFERENCE_PARTICLES) ** -0.5);
    // Maps are a point cloud: the density image *is* the picture, so no
    // trails (consecutive iterates jump across the plane) and finer points.
    const isMap = sys.attractor.kind === 'map';
    this.trails!.visible = !isMap;
    u.uMinPointPx.value = isMap ? 1.5 : 2;
    u.uCycle.value = (u.uCycle.value + realDt * this.style.cycleSpeed) % 2;
    this.heads!.geometry.setDrawRange(sys.head * n, n);
  }

  private build() {
    const sys = this.sys;
    // Both geometries share attributes; dispose both so the GPU buffers are freed.
    for (const obj of [this.trails, this.heads]) {
      if (!obj) continue;
      obj.geometry.dispose();
      this.group.remove(obj);
    }

    this.posAttr = new THREE.BufferAttribute(sys.trail, 3).setUsage(THREE.DynamicDrawUsage);
    this.speedAttr = new THREE.BufferAttribute(sys.speed, 1).setUsage(THREE.DynamicDrawUsage);
    this.indexAttr = new THREE.BufferAttribute(sys.index, 1).setUsage(THREE.DynamicDrawUsage);

    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute('position', this.posAttr);
    trailGeom.setAttribute('speed', this.speedAttr);
    trailGeom.setIndex(this.indexAttr);

    // Heads share the trail's attributes; a draw range selects the newest slot.
    const headGeom = new THREE.BufferGeometry();
    headGeom.setAttribute('position', this.posAttr);
    headGeom.setAttribute('speed', this.speedAttr);

    this.trails = new THREE.LineSegments(trailGeom, this.trailMaterial);
    this.heads = new THREE.Points(headGeom, this.headMaterial);
    // Positions change every frame; skip bounding-sphere culling entirely.
    this.trails.frustumCulled = this.heads.frustumCulled = false;
    this.group.add(this.trails, this.heads);

    this.uniforms.uCount.value = sys.count;
    this.uniforms.uTrailLength.value = sys.trailLength;
    this.builtVersion = sys.version;
    sys.fullDirty = false;
    sys.lastWrite = null;
  }

  /** World-space center of the current attractor (model center through the group transform). */
  worldCenter(target = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateMatrixWorld();
    return target.fromArray(this.sys.analysis.center).applyMatrix4(this.group.matrixWorld);
  }
}
