import type * as THREE from 'three';

/** Something the A-10's cannon or the Apache's missiles can shoot down. */
export interface Target {
  /** On screen and not already shot down. */
  alive(): boolean;
  position(target?: THREE.Vector3): THREE.Vector3;
  /** World size, for hit tests and the explosion's scale. */
  size(): number;
  /** A photo to break into shards, or null for dark wreckage. */
  photo(): THREE.Texture | null;
  /** Shot down: hide it for a while. */
  kill(): void;
}

/** Seconds anything shot down stays gone. */
export const KNOCKOUT_SECONDS = 120;
