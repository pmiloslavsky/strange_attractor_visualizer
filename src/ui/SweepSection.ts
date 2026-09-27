import type { App } from '../app/App';
import type { Attractor } from '../attractors';
import { bifurcationColumns, type BifurcationColumn } from '../simulation/bifurcation';
import { paramLabel as label } from './labels';
/** Milliseconds of diagram computation allowed per animation frame. */
const FRAME_BUDGET = 10;

/**
 * Default sweep for a system: its curated one if it has it, else the
 * parameter whose example values vary most, over a range around them.
 */
function defaultSweep(a: Attractor): { param: number; from: number; to: number } {
  if (a.sweep) return { ...a.sweep };
  let param = a.params.length - 1, best = -1;
  a.params.forEach((_, i) => {
    const vals = a.examples.map((ex) => ex[i]!);
    const spread = (Math.max(...vals) - Math.min(...vals)) / (Math.abs(vals[0]!) + 1e-9);
    if (spread > best) {
      best = spread;
      param = i;
    }
  });
  const spec = a.params[param]!;
  const vals = a.examples.map((ex) => ex[param]!);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = hi > lo ? 0.15 * (hi - lo) : Math.max(0.3 * Math.abs(lo), 0.5);
  lo = Math.max(spec.min, lo - pad);
  hi = Math.min(spec.max, hi + pad);
  return { param, from: lo, to: hi };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/**
 * Parameter sweep + bifurcation diagram. Pick a parameter and a range;
 * "Compute" draws the diagram (what the system settles into at each value),
 * "Sweep" animates the live simulation across the same range with a cursor on
 * the diagram, and clicking the diagram jumps to that value.
 */
export class SweepSection {
  readonly root = el('details', 'sweep');
  private readonly paramSelect = el('select');
  private readonly fromInput = el('input');
  private readonly toInput = el('input');
  private readonly durationSelect = el('select');
  private readonly sweepButton = el('button', 'sweep-btn', 'Sweep ▶');
  private readonly caption = el('div', 'sweep-caption');
  private readonly plot = el('canvas', 'sweep-plot');
  private readonly cursor = el('canvas', 'sweep-cursor');
  private columns: BifurcationColumn[] = [];
  private job: Generator<BifurcationColumn> | null = null;
  private computedFor = '';
  private builtFor?: Attractor;
  private range = { param: 0, from: 0, to: 1 };

  constructor(private readonly app: App) {
    const summary = el('summary', undefined, 'Parameter sweep & bifurcation diagram');
    this.fromInput.type = this.toInput.type = 'number';
    this.fromInput.step = this.toInput.step = 'any';
    this.fromInput.title = 'From';
    this.toInput.title = 'To';
    for (const s of [10, 20, 40]) this.durationSelect.append(new Option(`${s} s`, String(s)));
    this.durationSelect.value = '20';
    this.durationSelect.title = 'Time for one pass across the range';

    const controls = el('div', 'sweep-row');
    controls.append(this.paramSelect, this.fromInput, el('span', 'sweep-dash', '→'), this.toInput);
    const plotWrap = el('div', 'sweep-plot-wrap');
    plotWrap.append(this.plot, this.cursor);
    const compute = el('button', 'sweep-btn', 'Compute diagram');
    const actions = el('div', 'sweep-row');
    actions.append(compute, this.sweepButton, this.durationSelect);
    this.root.append(summary, controls, plotWrap, this.caption, actions);

    compute.addEventListener('click', () => this.compute());
    this.sweepButton.addEventListener('click', () => {
      if (app.sweep) app.stopSweep();
      else {
        this.readRange();
        app.startSweep(this.range.param, this.range.from, this.range.to, Number(this.durationSelect.value));
      }
    });
    this.paramSelect.addEventListener('change', () => {
      const a = app.attractor;
      const param = Number(this.paramSelect.value);
      const d = defaultSweep(a);
      // Same parameter as the default: use the curated range; otherwise ±30% around the current value.
      if (param === d.param) this.setRange(d);
      else {
        const spec = a.params[param]!, v = app.sys.params[param]!, pad = Math.max(0.3 * Math.abs(v), 0.5);
        this.setRange({ param, from: Math.max(spec.min, v - pad), to: Math.min(spec.max, v + pad) });
      }
      this.clear();
    });
    for (const input of [this.fromInput, this.toInput]) input.addEventListener('change', () => this.clear());
    this.root.addEventListener('toggle', () => {
      if (this.root.open && !this.columns.length) this.compute();
    });
    this.cursor.addEventListener('click', (e) => {
      const r = this.cursor.getBoundingClientRect();
      const t = (e.clientX - r.left) / r.width;
      this.readRange();
      app.setParam(this.range.param, this.range.from + t * (this.range.to - this.range.from));
    });
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  /** Call on every app change: rebuilds for a new system, updates the sweep button. */
  refresh() {
    const a = this.app.attractor;
    if (a !== this.builtFor) {
      this.builtFor = a;
      this.paramSelect.replaceChildren(...a.params.map((p, i) => new Option(label(p.name), String(i))));
      this.setRange(defaultSweep(a));
      this.clear();
      if (this.root.open) this.compute();
    }
    this.sweepButton.textContent = this.app.sweep ? 'Stop ■' : 'Sweep ▶';
  }

  private setRange(r: { param: number; from: number; to: number }) {
    this.range = r;
    this.paramSelect.value = String(r.param);
    const fmt = (v: number) => String(+v.toPrecision(4));
    this.fromInput.value = fmt(r.from);
    this.toInput.value = fmt(r.to);
  }

  private readRange() {
    const from = Number(this.fromInput.value), to = Number(this.toInput.value);
    if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
      this.range = { param: Number(this.paramSelect.value), from, to };
    }
  }

  private clear() {
    this.job = null;
    this.columns = [];
    this.computedFor = '';
    this.draw();
    this.caption.textContent = 'Press "Compute diagram".';
  }

  private compute() {
    this.readRange();
    const { app } = this;
    const a = app.attractor, sys = app.sys;
    const { param, from, to } = this.range;
    const s = sys.analysis.samples;
    this.columns = [];
    this.computedFor = `${a.id}|${sys.params.map((v, i) => (i === param ? '*' : v)).join(',')}|${sys.dt}`;
    this.job = bifurcationColumns({
      attractor: a,
      params: sys.params,
      param,
      from,
      to,
      dt: sys.dt,
      integrator: sys.integrator,
      start: [s[0]!, s[1]!, s[2]!],
    });
    this.caption.textContent = 'Computing…';
  }

  /** Per frame: advance the computation within a time budget, redraw, move the cursor. */
  private tick() {
    requestAnimationFrame(this.tick);
    if (!this.root.open) return;
    if (this.job) {
      const t0 = performance.now();
      let added = false;
      while (performance.now() - t0 < FRAME_BUDGET) {
        const next = this.job.next();
        if (next.done) {
          this.job = null;
          this.describe();
          break;
        }
        this.columns.push(next.value);
        added = true;
      }
      if (added) this.draw();
    }
    this.drawCursor();
  }

  private describe() {
    const a = this.app.attractor;
    const name = label(a.params[this.range.param]!.name);
    this.caption.textContent =
      `Peaks of z the orbit settles into, for each ${name}: one line = a simple loop, ` +
      'splits = period doubling, smear = chaos. Click to jump there.';
  }

  private sizeCanvas(c: HTMLCanvasElement) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return { w, h, dpr };
  }

  private draw() {
    const { w, h } = this.sizeCanvas(this.plot);
    const ctx = this.plot.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (!this.columns.length) return;
    // Robust y-range over everything computed so far.
    const all: number[] = [];
    for (const c of this.columns) for (const v of c.points) all.push(v);
    if (!all.length) return;
    all.sort((a, b) => a - b);
    const lo = all[Math.floor(all.length * 0.005)]!, hi = all[Math.min(all.length - 1, Math.floor(all.length * 0.995))]!;
    const span = hi - lo || 1;
    const total = 240; // columns in a full diagram
    const colW = Math.max(1, w / total);
    const style = getComputedStyle(this.root).getPropertyValue('--accent').trim() || '#7fd6ff';
    ctx.fillStyle = style;
    ctx.globalAlpha = 0.55;
    for (const c of this.columns) {
      const x = (c.index / (total - 1)) * (w - colW);
      for (const v of c.points) {
        const y = h - 2 - ((v - lo) / span) * (h - 4);
        if (y >= 0 && y <= h) ctx.fillRect(x, y, colW, 1.2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawCursor() {
    const { w, h, dpr } = this.sizeCanvas(this.cursor);
    const ctx = this.cursor.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    const { param, from, to } = this.range;
    const v = this.app.sys.params[param];
    if (v === undefined || this.app.attractor !== this.builtFor) return;
    const t = (v - from) / (to - from);
    if (t < 0 || t > 1) return;
    const x = t * w;
    ctx.strokeStyle = this.app.sweep ? 'rgba(255, 190, 120, 0.95)' : 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    // Stale diagram (another parameter changed since computing): say so.
    const key = `${this.app.attractor.id}|${this.app.sys.params.map((p, i) => (i === param ? '*' : p)).join(',')}|${this.app.sys.dt}`;
    this.plot.style.opacity = !this.computedFor || key === this.computedFor ? '1' : '0.35';
  }
}
