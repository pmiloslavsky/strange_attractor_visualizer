export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Tween {
  start: number;
  duration: number;
  update: (k: number) => void;
  ease: (t: number) => number;
  resolve: () => void;
}

/** Minimal frame-driven tweens; tick() is called from the render loop. */
export class Tweens {
  private list: Tween[] = [];

  /** Animate k from 0 to 1 over `ms`; resolves when done. */
  run(ms: number, update: (k: number) => void, ease = easeInOutCubic): Promise<void> {
    return new Promise((resolve) => {
      // start is stamped on the first tick so the tween begins on a rendered frame.
      this.list.push({ start: -1, duration: ms, update, ease, resolve });
      update(0);
    });
  }

  tick(now: number) {
    const finished: Tween[] = [];
    for (const tw of this.list) {
      if (tw.start < 0) tw.start = now;
      const t = Math.min(1, (now - tw.start) / tw.duration);
      tw.update(tw.ease(t));
      if (t >= 1) finished.push(tw);
    }
    if (finished.length) {
      this.list = this.list.filter((tw) => !finished.includes(tw));
      finished.forEach((tw) => tw.resolve());
    }
  }
}
