import * as THREE from 'three';
import type { ParticleSystem } from '../simulation/ParticleSystem';
import { paletteTexture, type PaletteName } from './palettes';
import { COLOR_MODES, headFragment, headVertex, trailFragment, trailVertex, type ColorMode } from './shaders';

export interface ViewStyle {
  palette: PaletteName;
  colorMode: ColorMode;
  /** Palette offset per second of real time; 0 disables cycling. */
  cycleSpeed: number;
  trailOpacity: number;
  /** Multiplies the attractor's particle size. */
  particleScale: number;
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
    uCycle: { value: 0 },
    uTrailOpacity: { value: 0.1 },
    uFade: { value: 1 },
    uSize: { value: 1 },
    uProjScale: { value: 1 },
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
    trailOpacity: 0.1,
    particleScale: 1,
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

  setStyle(patch: Partial<ViewStyle>) {
    const prevPalette = this.style.palette;
    this.style = { ...this.style, ...patch };
    if (patch.palette && patch.palette !== prevPalette) paletteTexture(this.style.palette, this.uniforms.uPalette.value);
    this.uniforms.uColorMode.value = COLOR_MODES.indexOf(this.style.colorMode);
    this.uniforms.uTrailOpacity.value = this.style.trailOpacity;
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
    u.uSize.value = sys.attractor.particleSize * this.style.particleScale;
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
