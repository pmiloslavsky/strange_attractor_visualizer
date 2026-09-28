import * as THREE from 'three';
import { Knockout, UprightFlight } from './flight';
import { fin, glowTexture, revolve, smoothProfile, surface } from './JetView';

/** Helicopter length as a fraction of the attractor radius. */
const RELATIVE_LENGTH = 0.1;
/** Never draw it shorter than this many drawing-buffer pixels. */
const MIN_PIXELS = 42;
/** Helicopters bank less eagerly than jets, and fly tilted nose-down. */
const BANK_GAIN = 0.25;
const MAX_BANK = 0.7;
const PITCH = 0.12;
/** Rotor speeds, radians per second. */
const MAIN_ROTOR = 26;
const TAIL_ROTOR = 110;
/** Missile racks (outer pylons), in the local model. */
const RACK = new THREE.Vector3(0.19, -0.075, 0.06);

/**
 * A fifth rider: an AH-64 Apache flying along particle 4, nose along the flow,
 * tilted forward and banking gently into turns, rotors spinning. Stubby wings
 * carry rocket pods and Hellfire racks (see MissileView). Like the A-10, the
 * airframe is drawn crisp in the overlay scene; the navigation lights and red
 * beacon are in the main scene so bloom makes them glow.
 *
 * Local model: length ≈ 1 including the tail, nose toward +Z, up +Y.
 */
export class HeliView {
  /** Add to Stage.overlay. */
  readonly body = new THREE.Group();
  /** Add to Stage.scene. */
  readonly glows = new THREE.Group();
  visible = true;
  /** Shot down by the A-10: gone for a while, then back. */
  readonly knockout = new Knockout();
  /** World length as drawn last frame. */
  size = 1;

  private readonly rotor = new THREE.Group();
  private readonly tailRotor = new THREE.Group();
  private readonly beacon: THREE.SpriteMaterial;
  private readonly flight = new UprightFlight(BANK_GAIN, MAX_BANK, PITCH);
  private time = 0;
  private readonly tmp = new THREE.Vector3();

  constructor() {
    // Olive drab, matte, as fielded.
    const paint = new THREE.MeshStandardMaterial({ color: '#434a36', metalness: 0.2, roughness: 0.75 });
    const paintDark = new THREE.MeshStandardMaterial({ color: '#30352a', metalness: 0.25, roughness: 0.75 });
    const metal = new THREE.MeshStandardMaterial({ color: '#1e2124', metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide });
    const blade = new THREE.MeshStandardMaterial({ color: '#23262a', metalness: 0.3, roughness: 0.6 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#22302c',
      metalness: 0.1,
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.5,
      flatShading: true,
    });
    const parts: THREE.Object3D[] = [];

    // Fuselage: narrow and tall, sensor nose forward, tapering into the tail boom.
    const pod = new THREE.Mesh(
      revolve(smoothProfile([[0, 0.37], [0.03, 0.35], [0.05, 0.3], [0.066, 0.2], [0.072, 0.08], [0.07, -0.04], [0.055, -0.12], [0.04, -0.16]], 40), 40),
      paint,
    );
    pod.scale.set(0.8, 1.3, 1);
    const boom = new THREE.Mesh(revolve(smoothProfile([[0.04, -0.12], [0.03, -0.25], [0.022, -0.4], [0.016, -0.47], [0, -0.48]], 24), 24), paint);
    boom.position.y = 0.03;
    parts.push(pod, boom);

    // Tandem stepped cockpit: gunner in front and low, pilot behind and higher. Faceted like the real flat panes.
    const pane = new THREE.SphereGeometry(1, 6, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const [z, y, h] of [[0.26, 0.06, 0.042], [0.14, 0.085, 0.05]] as const) {
      const c = new THREE.Mesh(pane, glass);
      c.scale.set(0.045, h, 0.075);
      c.position.set(0, y, z);
      parts.push(c);
    }

    // Nose sensor turret, and the chin-mounted 30 mm gun.
    const turret = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12), paintDark);
    turret.position.set(0, -0.025, 0.36);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.014, 16), glass);
    lens.position.set(0, -0.025, 0.391);
    const gunMount = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), metal);
    gunMount.position.set(0, -0.1, 0.2);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 10).rotateX(Math.PI / 2), metal);
    barrel.position.set(0, -0.105, 0.25);
    parts.push(turret, lens, gunMount, barrel);

    // Engines on either side of the rotor mast, with dark exhaust suppressors.
    const nacelle = revolve(smoothProfile([[0.02, 0.05], [0.03, 0.03], [0.032, -0.04], [0.03, -0.12], [0.024, -0.15]], 20), 24);
    for (const side of [-1, 1]) {
      const n = new THREE.Mesh(nacelle, paint);
      n.position.set(side * 0.07, 0.07, 0);
      const intake = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), metal);
      intake.position.set(side * 0.07, 0.07, 0.051);
      const exhaust = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.04), metal);
      exhaust.position.set(side * 0.085, 0.075, -0.14);
      exhaust.rotation.y = side * 0.4;
      parts.push(n, intake, exhaust);
    }

    // Rotor mast with the Longbow radar dome on top, and the main rotor.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.07, 12), metal);
    mast.position.set(0, 0.15, 0.03);
    const radar = new THREE.Mesh(new THREE.SphereGeometry(0.032, 20, 12), paintDark);
    radar.scale.set(1, 0.55, 1);
    radar.position.set(0, 0.215, 0.03);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 12), metal);
    hub.position.y = 0;
    this.rotor.add(hub);
    for (let b = 0; b < 4; b++) {
      const blade3 = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.004, 0.034).translate(0.205, 0, 0), blade);
      blade3.rotation.y = (b * Math.PI) / 2;
      blade3.rotation.x = 0.04; // a little blade twist so they catch the light
      this.rotor.add(blade3);
    }
    // Faint disc so the spinning rotor reads as a blur rather than a strobe.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.41, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#15181b', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.rotor.add(disc);
    this.rotor.position.set(0, 0.19, 0.03);
    parts.push(mast, radar, this.rotor);

    // Stub wings: rocket pods inboard, four Hellfires outboard on each side.
    const wing = surface([[0.05, 0.07], [0.22, 0.06], [0.22, 0.0], [0.05, -0.01]], 0.014);
    const rocketPod = revolve(smoothProfile([[0.012, 0.06], [0.022, 0.05], [0.022, -0.04], [0.018, -0.05]], 12), 20);
    const hellfire = new THREE.CylinderGeometry(0.008, 0.008, 0.08, 10).rotateX(Math.PI / 2);
    const ordnance = new THREE.MeshStandardMaterial({ color: '#5a6049', metalness: 0.3, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wing, paint);
      w.position.y = -0.035;
      w.rotation.z = side * -0.06; // slight anhedral
      w.scale.x = side;
      const rp = new THREE.Mesh(rocketPod, paintDark);
      rp.position.set(side * 0.12, -0.065, 0.04);
      parts.push(w, rp);
      for (const [dx, dy] of [[-0.012, 0], [0.012, 0], [-0.012, -0.022], [0.012, -0.022]]) {
        const h = new THREE.Mesh(hellfire, ordnance);
        h.position.set(side * (RACK.x + dx!), RACK.y + dy!, RACK.z);
        parts.push(h);
      }
    }

    // Tail: fin with the tail rotor on its left, and a stabilator at the bottom.
    const tailFin = new THREE.Mesh(fin([[-0.4, 0.02], [-0.43, 0.13], [-0.47, 0.14], [-0.48, 0.02]], 0.01), paint);
    tailFin.position.y = 0.02;
    const stab = surface([[0, -0.42], [0.1, -0.425], [0.1, -0.46], [0, -0.465]], 0.008);
    for (const side of [-1, 1]) {
      const s = new THREE.Mesh(stab, paint);
      s.position.y = 0.035;
      s.scale.x = side;
      parts.push(s);
    }
    // The Apache's tail rotor is a "scissor": two pairs of blades at 55° rather than 90°.
    for (const a of [0, 0.96]) {
      const pair = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.12, 0.016), blade);
      pair.rotation.x = a;
      this.tailRotor.add(pair);
    }
    this.tailRotor.position.set(-0.014, 0.12, -0.455);
    parts.push(tailFin, this.tailRotor);

    // Landing gear: two main wheels on trailing struts, and a tail wheel.
    const wheel = new THREE.CylinderGeometry(0.022, 0.022, 0.014, 16).rotateZ(Math.PI / 2);
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wheel, paintDark);
      w.position.set(side * 0.075, -0.13, 0.12);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 6), metal);
      strut.position.set(side * 0.065, -0.1, 0.13);
      strut.rotation.z = side * 0.3;
      parts.push(w, strut);
    }
    const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 12).rotateZ(Math.PI / 2), paintDark);
    tailWheel.position.set(0, -0.025, -0.44);
    parts.push(tailWheel);
    this.body.add(...parts);

    // Lights: red left wingtip, green right, white tail, and a flashing red beacon on the fin.
    const light = (color: string, intensity: number) =>
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color(color).multiplyScalar(intensity),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    for (const [x, color] of [[-0.225, '#ff2a2a'], [0.225, '#2aff5a']] as const) {
      const s = new THREE.Sprite(light(color, 3));
      s.position.set(x, -0.045, 0.03);
      s.scale.setScalar(0.04);
      this.glows.add(s);
    }
    const tail = new THREE.Sprite(light('#ffffff', 2));
    tail.position.set(0, 0.03, -0.48);
    tail.scale.setScalar(0.035);
    this.beacon = light('#ff2020', 4);
    const beacon = new THREE.Sprite(this.beacon);
    beacon.position.set(0, 0.17, -0.45);
    beacon.scale.setScalar(0.07);
    this.glows.add(tail, beacon);
  }

  /** Whether the helicopter was drawn this frame. */
  get flying(): boolean {
    return this.body.visible;
  }

  /** World position of the left (−1) or right (+1) Hellfire rack. */
  rack(side: -1 | 1, target = new THREE.Vector3()): THREE.Vector3 {
    this.body.updateMatrixWorld();
    return this.body.localToWorld(target.set(side * RACK.x, RACK.y - 0.03, RACK.z + 0.04));
  }

  /** World direction the nose points. */
  forward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, 1).applyQuaternion(this.body.quaternion);
  }

  /** Place it on its particle flying along `worldDir`. `small` shrinks it while the camera rides behind it. */
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
  }) {
    const dt = Math.max(opts.realDt, 1e-4);
    this.knockout.tick(dt);
    const show = opts.show && this.visible && !this.knockout.down;
    this.body.visible = this.glows.visible = show;
    if (!show || opts.worldDir.lengthSq() < 1e-20) return;
    this.time += dt;
    const heading = this.flight.update(opts.worldDir, dt);

    const dist = this.tmp.copy(opts.worldPos).distanceTo(opts.camera.position);
    const world = opts.radius * RELATIVE_LENGTH;
    const full = opts.small ? world * 0.5 : Math.max(world, (MIN_PIXELS * dist) / opts.projScale);
    this.size = full;
    const scale = full * Math.max(1e-3, this.knockout.presence);
    for (const g of [this.body, this.glows]) {
      g.position.copy(opts.worldPos);
      g.quaternion.copy(heading);
      g.scale.setScalar(scale);
    }
    this.rotor.rotation.y -= MAIN_ROTOR * dt;
    this.tailRotor.rotation.x += TAIL_ROTOR * dt;
    // Beacon: a slow single flash.
    this.beacon.opacity = ((this.time % 1.4) < 0.12 ? 1 : 0.08) * opts.fade;
  }
}
