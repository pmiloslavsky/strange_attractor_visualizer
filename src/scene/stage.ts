import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface BloomSettings {
  strength: number;
  radius: number;
  threshold: number;
}

/** Renderer, camera, orbit controls and the bloom post-processing chain. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Drawn after bloom, so its contents (the photo balls) stay crisp. */
  readonly overlay = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  readonly controls: OrbitControls;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  /** Called after every resize with the new drawing-buffer height. */
  onResize?: (drawingBufferHeight: number) => void;

  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x05060a, 1);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; // inertia after release
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomToCursor = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.35, 0.15);
    this.composer.addPass(this.bloom);
    const overlayPass = new RenderPass(this.overlay, this.camera);
    overlayPass.clear = false;
    this.composer.addPass(overlayPass);
    this.composer.addPass(new OutputPass());

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setBloom(b: Partial<BloomSettings>) {
    if (b.strength !== undefined) this.bloom.strength = b.strength;
    if (b.radius !== undefined) this.bloom.radius = b.radius;
    if (b.threshold !== undefined) this.bloom.threshold = b.threshold;
  }

  /** CSS pixels on the right covered by the control panel (0 when it isn't in the way). */
  private rightInset = 0;

  /**
   * Keep the scene centered in the part of the window the panel doesn't
   * cover, by shifting the projection center left by half the inset.
   */
  setRightInset(px: number) {
    if (px === this.rightInset) return;
    this.rightInset = px;
    this.resize();
  }

  /** Aspect ratio of the uncovered part of the view, for framing. */
  get visibleAspect(): number {
    const w = Math.max(1, this.container.clientWidth - this.rightInset);
    return w / Math.max(1, this.container.clientHeight);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Offsetting the view window to the right moves the scene left on screen.
    if (this.rightInset > 0 && this.rightInset < w) this.camera.setViewOffset(w, h, this.rightInset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.onResize?.(h * dpr);
  }

  render() {
    this.controls.update();
    this.composer.render();
  }

  /**
   * PNG of the current frame. Renders and reads back in the same task, so the
   * canvas doesn't need preserveDrawingBuffer (which costs performance).
   */
  screenshot(): Promise<Blob> {
    this.composer.render();
    return new Promise((resolve, reject) =>
      this.renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
  }
}
