import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Aircraft length as a fraction of the attractor radius. */
const RELATIVE_LENGTH = 0.107;
/** Never draw it shorter than this many drawing-buffer pixels. */
const MIN_PIXELS = 43;
/** Bank angle (radians) per radian/second of turn rate, and the limit. */
const BANK_GAIN = 0.35;
const MAX_BANK = 1.1;

type P2 = [number, number];

/** Soft radial glow (white center fading to transparent), tinted by the sprite color. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** A closed outline as a THREE.Shape. */
function shape(points: P2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(...points[0]!);
  for (const p of points.slice(1)) s.lineTo(...p);
  s.closePath();
  return s;
}

/**
 * A lifting surface: planform outline (x = span, y = position along the
 * aircraft) extruded to `thickness` with rounded edges, lying in the XZ plane
 * centered on y = 0.
 */
function surface(planform: P2[], thickness: number): THREE.BufferGeometry {
  const bevel = thickness * 0.45;
  const g = new THREE.ExtrudeGeometry(shape(planform), {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: 5,
    curveSegments: 1,
  });
  g.rotateX(Math.PI / 2); // shape y → +z, extrusion → −y
  g.translate(0, thickness / 2 - bevel, 0);
  g.computeVertexNormals();
  return g;
}

/** A vertical surface: outline (x = along the aircraft, y = height) in the YZ plane. */
function fin(outline: P2[], thickness: number): THREE.BufferGeometry {
  const bevel = thickness * 0.45;
  const g = new THREE.ExtrudeGeometry(shape(outline), {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: 4,
  });
  g.rotateY(-Math.PI / 2); // shape x → +z, extrusion → −x
  g.translate(thickness / 2 - bevel, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Smoothly sampled (radius, z) profile through control points. */
function smoothProfile(control: P2[], n: number): P2[] {
  const curve = new THREE.SplineCurve(control.map(([r, z]) => new THREE.Vector2(r, z)));
  return curve.getPoints(n).map((v) => [Math.max(0, v.x), v.y]);
}

/** A body of revolution around +Z from (radius, z) profile points. */
function revolve(profile: P2[], segments = 48): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  g.rotateX(Math.PI / 2); // lathe axis +Y → +Z
  return g;
}

/**
 * A fourth rider: an A-10 Warthog flying along particle 3, nose along the
 * flow, upright and banking into turns, with glowing engine exhaust that
 * brightens with speed. (The real A-10's turbofans have no afterburners; these
 * are for show.) The airframe is lit, with an environment map for reflections,
 * and drawn in the overlay scene after bloom so it stays crisp; the exhaust and
 * navigation lights are in the main scene so bloom makes them glow.
 *
 * Local model: length ≈ 1, nose toward +Z, up +Y, right wing +X. Proportions
 * follow the real aircraft: span slightly more than length, straight low
 * wings, engines in pods high on the rear fuselage, H-tail.
 */
export class JetView {
  /** Add to Stage.overlay. */
  readonly body = new THREE.Group();
  /** Add to Stage.scene. */
  readonly flames = new THREE.Group();
  /** Add to Stage.overlay, next to `body`. */
  readonly lights = new THREE.Group();
  visible = true;

  private readonly outer: THREE.Mesh[] = [];
  private readonly inner: THREE.Mesh[] = [];
  private readonly light = new THREE.DirectionalLight('#ffffff', 2.2);
  private readonly glowMat: THREE.SpriteMaterial;
  private readonly strobe: THREE.SpriteMaterial;
  private readonly heading = new THREE.Quaternion();
  private hasHeading = false;
  private readonly lastForward = new THREE.Vector3(0, 0, 1);
  private readonly lastRight = new THREE.Vector3(1, 0, 0);
  private bank = 0;
  private time = 0;
  private flicker = [1, 1];
  /** Smoothed 0–1 throttle. */
  private throttle = 0.5;
  private readonly glowColor = new THREE.Color('#ffb070').multiplyScalar(2.6);
  private readonly tmp = new THREE.Vector3();

  constructor() {
    // Dark charcoal "Compass Ghost"-style paint: matte, a little metallic.
    const paint = new THREE.MeshStandardMaterial({ color: '#34393f', metalness: 0.35, roughness: 0.55 });
    const paintDark = new THREE.MeshStandardMaterial({ color: '#2a2e33', metalness: 0.35, roughness: 0.6 });
    const metal = new THREE.MeshStandardMaterial({ color: '#1c1f23', metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
    const inlet = new THREE.MeshStandardMaterial({ color: '#0b0d10', metalness: 0.3, roughness: 0.7, side: THREE.DoubleSide });
    const ordnance = new THREE.MeshStandardMaterial({ color: '#4a5140', metalness: 0.3, roughness: 0.6 });
    const hot = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a4a').multiplyScalar(1.3), side: THREE.DoubleSide });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#1b2c44',
      metalness: 0.1,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.6,
    });
    const parts: THREE.Object3D[] = [];

    // Fuselage: long and rounded, blunt nose, cockpit hump forward, tapering tail cone.
    const fuselage = new THREE.Mesh(
      revolve(
        smoothProfile(
          [[0, 0.5], [0.022, 0.49], [0.038, 0.46], [0.05, 0.4], [0.057, 0.3], [0.06, 0.15], [0.06, 0], [0.056, -0.15], [0.045, -0.3], [0.03, -0.42], [0.018, -0.48]],
          56,
        ),
        56,
      ),
      paint,
    );
    fuselage.scale.set(0.95, 1.12, 1);
    parts.push(fuselage);

    // The GAU-8 Avenger cannon muzzle, just under the nose.
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.06, 16).rotateX(Math.PI / 2), metal);
    gun.position.set(0, -0.018, 0.5);
    parts.push(gun);

    // Bubble canopy well forward, with a frame hoop.
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    canopy.scale.set(0.034, 0.042, 0.075);
    canopy.position.set(0, 0.052, 0.31);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 40, Math.PI), metal);
    hoop.scale.set(0.035, 0.043, 0.035);
    hoop.position.set(0, 0.052, 0.285);
    parts.push(canopy, hoop);

    // Straight, low, slightly tapered wings, spanning a bit more than the length.
    const wing = surface([[0.04, 0.085], [0.54, 0.05], [0.54, -0.04], [0.04, -0.075]], 0.024);
    // Landing-gear pods under each wing, and bombs on pylons further out.
    const pod = revolve(smoothProfile([[0, 0.12], [0.016, 0.1], [0.022, 0.06], [0.022, -0.02], [0.012, -0.08], [0, -0.09]], 20), 24);
    const bomb = revolve(smoothProfile([[0, 0.05], [0.009, 0.035], [0.011, 0.01], [0.011, -0.025], [0.006, -0.045], [0, -0.05]], 16), 20);
    const pylon = surface([[-0.004, 0.02], [0.004, 0.02], [0.004, -0.02], [-0.004, -0.02]], 0.02);
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wing, paint);
      w.position.y = -0.035;
      w.scale.x = side; // mirror (three.js flips face culling for negative scale)
      const gear = new THREE.Mesh(pod, paintDark);
      gear.position.set(side * 0.14, -0.056, 0.0);
      parts.push(w, gear);
      for (const x of [0.26, 0.37]) {
        const b = new THREE.Mesh(bomb, ordnance);
        b.position.set(side * x, -0.072, 0.02);
        const p = new THREE.Mesh(pylon, paintDark);
        p.rotation.z = Math.PI / 2; // stand the pylon upright between wing and bomb
        p.position.set(side * x, -0.055, 0.02);
        parts.push(b, p);
      }
    }

    // Engines: the A-10's signature pods high on the rear fuselage, on stub pylons.
    const nacelle = revolve(
      smoothProfile([[0.036, -0.095], [0.045, -0.105], [0.047, -0.14], [0.046, -0.2], [0.04, -0.26], [0.034, -0.29]], 28),
      40,
    );
    const engineX = 0.085, engineY = 0.078, exhaustZ = -0.29;
    for (const side of [-1, 1]) {
      const n = new THREE.Mesh(nacelle, paint);
      n.position.set(side * engineX, engineY, 0);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.036, 32), inlet);
      face.position.set(side * engineX, engineY, -0.1);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 16).rotateX(Math.PI / 2), metal);
      cone.position.set(side * engineX, engineY, -0.095); // fan spinner
      const stub = new THREE.Mesh(fin([[-0.13, 0], [-0.24, 0], [-0.23, 0.03], [-0.14, 0.03]], 0.01), paintDark);
      stub.position.set(side * 0.03, 0.045, 0);
      stub.rotation.z = side * -0.9; // lean the pylon out toward the pod
      const nozzle = new THREE.Mesh(revolve([[0.034, -0.29], [0.031, -0.305], [0.027, -0.305], [0.029, -0.29]], 32), metal);
      nozzle.position.set(side * engineX, engineY, 0);
      // Closed back end: a hot turbine face with a tapered exhaust plug, so the
      // pod doesn't read as a hollow tube from behind.
      const turbine = new THREE.Mesh(new THREE.CircleGeometry(0.03, 32), hot);
      turbine.rotation.y = Math.PI; // face backward
      turbine.position.set(side * engineX, engineY, -0.282);
      const plug = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.035, 20).rotateX(-Math.PI / 2), metal);
      plug.position.set(side * engineX, engineY, -0.3);
      parts.push(n, face, cone, stub, nozzle, turbine, plug);
    }

    // H-tail: a straight stabilizer on the tail cone with a fin at each end.
    const stab = surface([[0, -0.37], [0.22, -0.385], [0.22, -0.45], [0, -0.46]], 0.014);
    const tailFin = fin([[-0.375, -0.035], [-0.38, 0.12], [-0.41, 0.135], [-0.465, 0.12], [-0.47, -0.035]], 0.012);
    for (const side of [-1, 1]) {
      const s = new THREE.Mesh(stab, paint);
      s.position.y = 0.01;
      s.scale.x = side;
      const f = new THREE.Mesh(tailFin, paint);
      f.position.x = side * 0.222;
      parts.push(s, f);
    }
    this.body.add(...parts);

    // Exhaust: an orange plume around a blue-white core, per engine. Cones are
    // built along +Y with the tip at +y: shift so the base sits at the origin,
    // then rotate so the tip trails behind along −Z (length 1, scaled per frame).
    const flameMat = (color: string, intensity: number, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    const outerMat = flameMat('#ff5a10', 2.2, 0.65);
    const innerMat = flameMat('#cfe8ff', 4, 0.9);
    this.glowMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: this.glowColor.clone(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cone = (r: number) => new THREE.ConeGeometry(r, 1, 24, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
    for (const side of [-1, 1]) {
      const x = side * engineX;
      const plume = new THREE.Mesh(cone(0.03), outerMat);
      const core = new THREE.Mesh(cone(0.017), innerMat);
      plume.userData = { opacity: outerMat.opacity, color: outerMat.color.clone() };
      core.userData = { opacity: innerMat.opacity, color: innerMat.color.clone() };
      for (const f of [plume, core]) f.position.set(x, engineY, exhaustZ - 0.01);
      const glow = new THREE.Sprite(this.glowMat);
      glow.position.set(x, engineY, exhaustZ - 0.012);
      glow.scale.setScalar(0.11);
      this.outer.push(plume);
      this.inner.push(core);
      this.flames.add(plume, core, glow);
    }

    // Navigation lights: red left wingtip, green right, and a white tail strobe.
    const navLight = (color: string, intensity: number) =>
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color(color).multiplyScalar(intensity),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    for (const [x, color] of [[-0.545, '#ff2a2a'], [0.545, '#2aff5a']] as const) {
      const s = new THREE.Sprite(navLight(color, 3));
      s.position.set(x, -0.035, 0.0);
      s.scale.setScalar(0.045);
      this.flames.add(s);
    }
    this.strobe = navLight('#ffffff', 4);
    for (const x of [-0.222, 0.222]) {
      const s = new THREE.Sprite(this.strobe);
      s.position.set(x, 0.138, -0.44);
      s.scale.setScalar(0.06);
      this.flames.add(s);
    }

    // Lights only affect the airframe's materials (everything else in the overlay is unlit).
    // They live beside the body, not inside it, so its scale and rotation don't move them.
    this.lights.add(new THREE.HemisphereLight('#dfe9ff', '#1a2233', 0.9), this.light, this.light.target);
  }

  /**
   * Give the overlay scene an environment map (a neutral studio room) so the
   * paint, metal and glass have something to reflect. Call once.
   */
  setEnvironment(renderer: THREE.WebGLRenderer, overlay: THREE.Scene) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    overlay.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    overlay.environmentIntensity = 1;
    pmrem.dispose();
  }

  /**
   * Place the aircraft at `worldPos` flying along `worldDir`: kept upright
   * (wings level relative to world up) and banked into turns in proportion to
   * the turn rate, with all rotation eased so it flies smoothly. The exhaust
   * brightens and lengthens with `throttle`. `small` shrinks it while the
   * camera is riding right behind it.
   */
  sync(opts: {
    show: boolean;
    worldPos: THREE.Vector3;
    worldDir: THREE.Vector3;
    radius: number;
    camera: THREE.Camera;
    projScale: number;
    fade: number;
    realDt: number;
    small: boolean;
    /** 0 = slowest typical speed on this attractor, 1 = fastest. */
    throttle: number;
  }) {
    const show = opts.show && this.visible;
    this.body.visible = this.flames.visible = this.lights.visible = show;
    if (!show || opts.worldDir.lengthSq() < 1e-20) return;
    const dt = Math.max(opts.realDt, 1e-4);
    this.time += dt;

    // Upright frame: forward along the flow, right = up × forward, up = forward × right.
    const forward = opts.worldDir.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(forward);
    if (right.lengthSq() < 1e-6) right.copy(this.lastRight); // flying straight up or down
    right.normalize();
    const up = forward.clone().cross(right);
    // Bank into turns: yaw rate about our up axis (positive = turning right).
    const yawRate = this.hasHeading ? this.lastForward.clone().cross(forward).dot(up) / dt : 0;
    const targetBank = THREE.MathUtils.clamp(-yawRate * BANK_GAIN, -MAX_BANK, MAX_BANK);
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 4);
    this.lastForward.copy(forward);
    this.lastRight.copy(right);
    const target = new THREE.Quaternion()
      .setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bank));
    if (!this.hasHeading) this.heading.copy(target);
    else this.heading.slerp(target, 1 - Math.exp(-dt * 10));
    this.hasHeading = true;

    const dist = this.tmp.copy(opts.worldPos).distanceTo(opts.camera.position);
    const world = opts.radius * RELATIVE_LENGTH;
    const scale = opts.small ? world * 0.5 : Math.max(world, (MIN_PIXELS * dist) / opts.projScale);
    for (const g of [this.body, this.flames]) {
      g.position.copy(opts.worldPos);
      g.quaternion.copy(this.heading);
      g.scale.setScalar(scale);
    }

    // Throttle, eased so the exhaust swells and fades rather than pops.
    const t = THREE.MathUtils.clamp(opts.throttle, 0, 1);
    this.throttle += (t - this.throttle) * Math.min(1, dt * 4);
    const power = this.throttle;
    this.flicker = this.flicker.map((f) => f + (0.75 + Math.random() * 0.5 - f) * Math.min(1, dt * 18));
    const length = 0.3 + 0.6 * power; // near idle: short stub; full power: long plume
    this.outer.forEach((m, i) => m.scale.set(1, 1, 0.5 * length * this.flicker[i]!));
    this.inner.forEach((m, i) => m.scale.set(1, 1, 0.28 * length * (0.6 + 0.4 * this.flicker[i]!)));
    const brightness = 0.35 + 0.8 * power;
    for (const m of [...this.outer, ...this.inner]) {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = m.userData.opacity * opts.fade;
      mat.color.copy(m.userData.color).multiplyScalar(brightness);
    }
    this.glowMat.opacity = opts.fade;
    this.glowMat.color.copy(this.glowColor).multiplyScalar(brightness);
    // Tail strobe: a short double flash about once a second.
    const phase = this.time % 1.2;
    this.strobe.opacity = (phase < 0.06 || (phase > 0.14 && phase < 0.2) ? 1 : 0) * opts.fade;

    // Key light from over the camera's shoulder, so the side we see is lit.
    const toCamera = this.tmp.copy(opts.camera.position).sub(opts.worldPos).normalize();
    this.light.position.copy(opts.worldPos).addScaledVector(toCamera, scale * 10).add(new THREE.Vector3(0, scale * 6, 0));
    this.light.target.position.copy(opts.worldPos);
  }
}
