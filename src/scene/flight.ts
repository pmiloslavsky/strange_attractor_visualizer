import * as THREE from 'three';

/**
 * Orientation for an aircraft following the flow: nose along the direction
 * of travel, kept upright (wings level relative to world up), banked into
 * turns in proportion to the turn rate, optionally pitched, and eased so it
 * flies smoothly rather than snapping with every wiggle of the trajectory.
 */
export class UprightFlight {
  readonly quaternion = new THREE.Quaternion();
  private started = false;
  private bank = 0;
  private readonly lastForward = new THREE.Vector3(0, 0, 1);
  private readonly lastRight = new THREE.Vector3(1, 0, 0);

  /**
   * `bankGain`: bank angle (radians) per radian/second of turn rate, up to
   * `maxBank`. `pitch`: constant nose-down attitude (radians), as a
   * helicopter tilts forward to fly.
   */
  constructor(
    private readonly bankGain: number,
    private readonly maxBank: number,
    private readonly pitch = 0,
  ) {}

  /** Advance toward flying along `worldDir`; returns the eased orientation. */
  update(worldDir: THREE.Vector3, dt: number): THREE.Quaternion {
    // Upright frame: forward along the flow, right = up × forward, up = forward × right.
    const forward = worldDir.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(forward);
    if (right.lengthSq() < 1e-6) right.copy(this.lastRight); // flying straight up or down
    right.normalize();
    const up = forward.clone().cross(right);
    // Bank into turns: yaw rate about our up axis (positive = turning right).
    const yawRate = this.started ? this.lastForward.clone().cross(forward).dot(up) / dt : 0;
    const targetBank = THREE.MathUtils.clamp(-yawRate * this.bankGain, -this.maxBank, this.maxBank);
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 4);
    this.lastForward.copy(forward);
    this.lastRight.copy(right);
    const target = new THREE.Quaternion()
      .setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bank))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch));
    if (!this.started) this.quaternion.copy(target);
    else this.quaternion.slerp(target, 1 - Math.exp(-dt * 10));
    this.started = true;
    return this.quaternion;
  }
}

/**
 * Shot-down state for anything that can be destroyed: gone for a while, then
 * back, growing or fading in over REAPPEAR seconds.
 */
export class Knockout {
  static readonly REAPPEAR = 0.8;
  private downFor = -Knockout.REAPPEAR;

  knockOut(seconds: number) {
    this.downFor = seconds;
  }

  /** Count down; call once per frame. */
  tick(dt: number) {
    this.downFor = Math.max(-Knockout.REAPPEAR, this.downFor - dt);
  }

  get down(): boolean {
    return this.downFor > 0;
  }

  /** 0 while down, rising to 1 as it comes back. */
  get presence(): number {
    return this.downFor > 0 ? 0 : Math.min(1, -this.downFor / Knockout.REAPPEAR);
  }
}
