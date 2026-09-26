import type { App } from '../app/App';
import type { Attractor } from '../attractors';
import type { Analysis } from '../simulation/analysis';

const AXES = ['x', 'y', 'z'] as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/**
 * Poincaré section controls and the 2D plot of crossings. Opening the section
 * turns collection on (and shows the plane in 3D); closing it turns it off.
 */
export class PoincarePanel {
  readonly root = el('details', 'sweep poincare');
  private readonly axisSelect = el('select');
  private readonly offset = el('input');
  private readonly offsetValue = el('span', 'poincare-value');
  private readonly info = el('div', 'sweep-caption');
  private readonly canvas = el('canvas', 'sweep-plot');
  private builtFor?: Attractor;
  private builtAnalysis?: Analysis;
  private drawnVersion = -1;
  private drawnHead = 0;
  private lastRescale = 0;
  private scale = { u: 0, v: 1, u0: 0, u1: 1, v0: 0, v1: 1 };

  constructor(private readonly app: App) {
    const summary = el('summary', undefined, 'Poincaré section');
    for (const [i, a] of AXES.entries()) this.axisSelect.append(new Option(`${a} =`, String(i)));
    this.offset.type = 'range';
    this.offset.step = 'any';
    const row = el('div', 'sweep-row');
    row.append(this.axisSelect, this.offset, this.offsetValue);
    const wrap = el('div', 'sweep-plot-wrap');
    wrap.append(this.canvas);
    const clear = el('button', 'sweep-btn', 'Clear points');
    const actions = el('div', 'sweep-row');
    actions.append(clear);
    this.root.append(summary, row, wrap, this.info, actions);

    this.root.addEventListener('toggle', () => app.setSectionEnabled(this.root.open));
    this.axisSelect.addEventListener('change', () => {
      const axis = Number(this.axisSelect.value) as 0 | 1 | 2;
      const [lo, hi] = app.sys.analysis.ranges[axis]!;
      app.setSection(axis, (lo + hi) / 2);
      this.syncControls();
    });
    this.offset.addEventListener('input', () => {
      app.setSection(app.section.axis, Number(this.offset.value));
      this.syncControls();
    });
    clear.addEventListener('click', () => app.section.clear());
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  /** Call on every app change. */
  refresh() {
    const a = this.app.attractor;
    this.root.hidden = a.kind === 'map';
    // New system, or new parameters that changed the attractor's extent.
    if (a !== this.builtFor || this.app.sys.analysis !== this.builtAnalysis) {
      this.builtFor = a;
      this.builtAnalysis = this.app.sys.analysis;
      this.syncControls();
    }
  }

  /** Slider range, value label and plot scaling from the current plane and attractor. */
  private syncControls() {
    const { axis, offset } = this.app.section;
    const r = this.app.sys.analysis.ranges;
    const [lo, hi] = r[axis]!;
    const pad = 0.1 * (hi - lo);
    this.axisSelect.value = String(axis);
    this.offset.min = String(lo - pad);
    this.offset.max = String(hi + pad);
    this.offset.value = String(offset);
    this.offsetValue.textContent = (+offset.toPrecision(3)).toString();
    const [u, v] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
    const grow = (k: number) => {
      const [a, b] = r[k]!, m = 0.08 * (b - a);
      return [a - m, b + m];
    };
    const [u0, u1] = grow(u), [v0, v1] = grow(v);
    this.scale = { u, v, u0: u0!, u1: u1!, v0: v0!, v1: v1! };
    this.drawnVersion = -1; // replot everything
  }

  /**
   * Zoom the plot to the crossings themselves (1st–99th percentile, with a
   * margin): sections are often thin curves in a small part of the plane.
   * Returns true if the scale changed enough to need a full redraw.
   */
  private autoscale(): boolean {
    const sec = this.app.section;
    if (sec.count < 50) return false;
    const { u, v } = this.scale;
    const n = sec.count, step = Math.max(1, Math.floor(n / 4000));
    const us: number[] = [], vs: number[] = [];
    for (let i = 0; i < n; i += step) {
      us.push(sec.points[3 * i + u]!);
      vs.push(sec.points[3 * i + v]!);
    }
    const bounds = (a: number[]) => {
      a.sort((x, y) => x - y);
      const lo = a[Math.floor(a.length * 0.01)]!, hi = a[Math.min(a.length - 1, Math.floor(a.length * 0.99))]!;
      const m = 0.12 * (hi - lo || Math.abs(lo) || 1);
      return [lo - m, hi + m] as const;
    };
    const [u0, u1] = bounds(us), [v0, v1] = bounds(vs);
    const s = this.scale;
    const off = (a0: number, a1: number, b0: number, b1: number) => Math.abs(a0 - b0) + Math.abs(a1 - b1) > 0.1 * (b1 - b0);
    if (!off(u0, u1, s.u0, s.u1) && !off(v0, v1, s.v0, s.v1)) return false;
    this.scale = { u, v, u0, u1, v0, v1 };
    return true;
  }

  private tick(now: number) {
    requestAnimationFrame(this.tick);
    if (!this.root.open || this.root.hidden) return;
    const sec = this.app.section;
    if (now - this.lastRescale > 700) {
      this.lastRescale = now;
      if (this.autoscale()) this.drawnVersion = -1;
    }
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    const ctx = c.getContext('2d')!;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      this.drawnVersion = -1;
    }
    if (sec.version !== this.drawnVersion) {
      ctx.clearRect(0, 0, w, h);
      this.drawnVersion = sec.version;
      // Replot everything already collected (after a resize or rescale).
      this.plot(ctx, w, h, 0, sec.count);
      this.drawnHead = sec.head;
    }
    if (sec.head !== this.drawnHead) {
      if (sec.head > this.drawnHead) this.plot(ctx, w, h, this.drawnHead, sec.head);
      else {
        this.plot(ctx, w, h, this.drawnHead, sec.capacity);
        this.plot(ctx, w, h, 0, sec.head);
      }
      this.drawnHead = sec.head;
    }
    const [un, vn] = [AXES[this.scale.u], AXES[this.scale.v]];
    this.info.textContent =
      `${sec.count.toLocaleString()} upward crossings of ${AXES[sec.axis]} = ${+sec.offset.toPrecision(3)}, ` +
      `plotted as ${un} (across) vs ${vn} (up). A loop is a dot; chaos draws a thin fractal curve.`;
  }

  private plot(ctx: CanvasRenderingContext2D, w: number, h: number, from: number, to: number) {
    const { u, v, u0, u1, v0, v1 } = this.scale;
    const pts = this.app.section.points;
    ctx.fillStyle = 'rgba(255, 210, 160, 0.55)';
    const s = Math.max(1, Math.round(w / 280));
    for (let i = from; i < to; i++) {
      const x = ((pts[3 * i + u]! - u0) / (u1 - u0)) * w;
      const y = h - ((pts[3 * i + v]! - v0) / (v1 - v0)) * h;
      ctx.fillRect(x, y, s, s);
    }
  }
}
