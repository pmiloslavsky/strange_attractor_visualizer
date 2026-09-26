import { Pane, type BladeApi, type ListInputBindingApi, type SliderInputBindingApi } from 'tweakpane';
import { ATTRACTORS, CONTROL_RANGES, type Attractor } from '../attractors';
import { LIMITS, type App, type IntegratorName } from '../app/App';
import { PALETTE_NAMES, type PaletteName } from '../scene/palettes';
import { COLOR_MODES, type ColorMode } from '../scene/shaders';
import { DEFAULT_FAMILY } from '../scene/FamilyView';
import { createFamilyTray } from './familyTray';
import { paramLabel } from './labels';
import { PoincarePanel } from './PoincarePanel';
import { SweepSection } from './SweepSection';

const CUSTOM = -1;

/**
 * Enough decimals to show every example value exactly (0.208186 needs 6),
 * but not the endless expansion of values like 8/3.
 */
function decimalsFor(values: readonly number[]): number {
  let d = 2;
  for (const v of values) {
    const s = String(v);
    const dot = s.indexOf('.');
    if (dot < 0) continue;
    const n = s.length - dot - 1;
    d = Math.max(d, n > 6 ? 3 : n);
  }
  return d;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/**
 * The control panel: attractor picker, equations, parameter sliders with
 * presets, and simulation / color / glow / camera settings. A side panel on
 * desktop, a collapsible bottom sheet on narrow screens.
 */
export class Panel {
  readonly root = el('aside', 'panel');
  private readonly title = el('span', 'panel-title');
  private readonly picker = el('div', 'picker');
  private readonly equations = el('div', 'equations');
  private readonly status = el('div', 'status');
  private readonly meter = el('div', 'meter');
  private readonly paramHost = el('div', 'tp-host');
  private readonly mainHost = el('div', 'tp-host');
  private paramPane?: Pane;
  private readonly mainPane: Pane;
  private builtFor?: Attractor;
  private syncing = false;
  private particlesSlider!: SliderInputBindingApi;
  private colorModeList!: ListInputBindingApi<ColorMode>;
  private flowOnly: BladeApi[] = [];
  /** Controls that only make sense for systems with several attractors. */
  private basinOnly: BladeApi[] = [];
  private basinsShown?: boolean;
  private readonly tray: ReturnType<typeof createFamilyTray>;
  private readonly sweep: SweepSection;
  private readonly poincare: PoincarePanel;

  /** Proxies Tweakpane binds to; copied from / written to the app. */
  private readonly params: Record<string, number> = {};
  private readonly state = {
    preset: 0,
    dt: 0.01,
    speed: 1,
    integrator: 'euler' as IntegratorName,
    particles: 0,
    trail: 0,
    particleSize: 0.3,
    paused: false,
    colorMode: 'speed' as ColorMode,
    palette: 'Aurora' as PaletteName,
    cycleSpeed: 0,
    trailOpacity: 0,
    autoRotate: true,
    autoFrame: true,
    ride: -1,
    axes: false,
  };

  constructor(
    private readonly app: App,
    shortcuts: readonly (readonly [string, string])[],
  ) {
    const head = el('header', 'panel-head');
    const toggle = el('button', 'panel-toggle');
    toggle.setAttribute('aria-label', 'Collapse or expand controls');
    toggle.addEventListener('click', () => this.setCollapsed(!this.root.classList.contains('collapsed')));
    head.append(this.title, toggle);
    head.addEventListener('click', (e) => {
      // On the bottom sheet the whole header is the handle.
      if (e.target !== toggle && matchMedia('(max-width: 720px)').matches) toggle.click();
    });

    const body = el('div', 'panel-body');
    this.buildPicker();
    const photos = el('section', 'photos');
    photos.append(el('div', 'section-label', 'Photo balls'));
    this.tray = createFamilyTray(app.family, photos, (v) => app.setFamilyVisible(v));

    const help = el('details', 'shortcuts');
    help.append(el('summary', undefined, 'Keyboard shortcuts'));
    const list = el('dl');
    for (const [key, action] of shortcuts) list.append(el('dt', undefined, key), el('dd', undefined, action));
    help.append(list);

    this.sweep = new SweepSection(app);
    this.poincare = new PoincarePanel(app);
    body.append(
      this.picker, this.equations, this.meter, this.status, this.paramHost,
      this.sweep.root, this.poincare.root, this.mainHost, photos, help,
    );
    this.meter.title =
      'Largest Lyapunov exponent λ: how fast two almost identical starting states drift apart. ' +
      'Positive = chaotic, about zero = periodic, negative = settles to a fixed point.';
    // The estimate refines continuously; a few updates a second is plenty.
    setInterval(() => this.renderMeter(), 250);
    this.root.append(head, body);
    document.body.appendChild(this.root);

    this.mainPane = new Pane({ container: this.mainHost });
    this.buildMain();
    this.setCollapsed(matchMedia('(max-width: 720px)').matches);
    app.onChange(() => this.refresh());
    this.refresh();
  }

  setCollapsed(collapsed: boolean) {
    this.root.classList.toggle('collapsed', collapsed);
  }

  /** H key: hide every on-screen control, as in the original. */
  toggleHidden() {
    this.root.hidden = !this.root.hidden;
  }

  private buildPicker() {
    for (const a of ATTRACTORS) {
      const b = el('button', 'pick');
      b.dataset.id = a.id;
      b.title = a.name;
      const img = el('img');
      img.src = `thumbs/${a.id}.jpg`;
      img.alt = '';
      b.append(img, el('span', undefined, a.name.replace('-Unified', '').replace('Peter ', '')));
      b.addEventListener('click', () => void this.app.switchTo(a));
      this.picker.append(b);
    }
  }

  /** Parameter sliders + presets for the current system; rebuilt on every switch. */
  private buildParams(a: Attractor) {
    this.paramPane?.dispose();
    for (const k of Object.keys(this.params)) delete this.params[k];
    const pane = new Pane({ container: this.paramHost });
    const folder = pane.addFolder({ title: 'Parameters' });

    const presetOptions: Record<string, number> = { Custom: CUSTOM };
    a.examples.forEach((_, i) => (presetOptions[i === 0 ? 'Example 1 (default)' : `Example ${i + 1}`] = i));
    folder
      .addBinding(this.state, 'preset', { label: 'preset', options: presetOptions })
      .on('change', (ev) => {
        if (this.syncing || ev.value === CUSTOM) return;
        void this.app.applyPreset(a.examples[ev.value]!);
      });

    a.params.forEach((spec, i) => {
      const d = decimalsFor([...a.examples.map((ex) => ex[i]!), spec.min, spec.max]);
      this.params[spec.name] = this.app.sys.params[i]!;
      folder
        .addBinding(this.params, spec.name, {
          label: paramLabel(spec.name),
          min: spec.min,
          max: spec.max,
          step: 10 ** -d,
          format: (v: number) => v.toFixed(d),
        })
        .on('change', (ev) => {
          if (!this.syncing) this.app.setParam(i, ev.value);
        });
    });
    folder.addButton({ title: 'Reset to defaults' }).on('click', () => this.app.resetSystem());

    this.paramPane = pane;
    this.builtFor = a;
    for (const blade of this.flowOnly) blade.hidden = a.kind === 'map';
    const limits = this.app.particleLimits;
    this.particlesSlider.min = limits.min;
    this.particlesSlider.max = limits.max;
    this.equations.innerHTML = a.equations.map((e) => `<div>${e}</div>`).join('');
    for (const b of this.picker.querySelectorAll<HTMLElement>('.pick')) {
      b.classList.toggle('active', b.dataset.id === a.id);
    }
  }

  private buildMain() {
    const { app, state } = this;
    const pane = this.mainPane;
    const guard = <T>(fn: (v: T) => void) => (ev: { value: T }) => {
      if (!this.syncing) fn(ev.value);
    };

    const sim = pane.addFolder({ title: 'Simulation' });
    const dt = sim
      .addBinding(state, 'dt', {
        min: CONTROL_RANGES.dt.min,
        max: CONTROL_RANGES.dt.max,
        step: 0.0001,
        format: (v: number) => v.toFixed(4),
      })
      .on('change', guard((v: number) => app.setDt(v)));
    sim
      .addBinding(state, 'speed', { ...LIMITS.speed, step: 0.05, format: (v: number) => `${v.toFixed(2)}×` })
      .on('change', guard((v: number) => (app.speed = v)));
    const integrator = sim
      .addBinding(state, 'integrator', { options: { 'Euler (original)': 'euler', 'Runge-Kutta 4': 'rk4' } })
      .on('change', guard((v: IntegratorName) => app.setIntegrator(v)));
    // Resizing reallocates buffers, so apply when the drag ends.
    this.particlesSlider = sim
      .addBinding(state, 'particles', { ...LIMITS.particles, step: 1, format: (v: number) => v.toFixed(0) })
      .on('change', (ev) => {
        if (!this.syncing && ev.last) app.setCount(ev.value);
      }) as SliderInputBindingApi;
    const trail = sim
      .addBinding(state, 'trail', { ...LIMITS.trail, step: 1, format: (v: number) => v.toFixed(0) })
      .on('change', (ev) => {
        if (!this.syncing && ev.last) app.setTrail(ev.value);
      });
    // Maps iterate with a fixed step of 1, only with Euler, and have no trails.
    this.flowOnly = [dt, integrator, trail];
    sim
      .addBinding(state, 'particleSize', { label: 'size', ...LIMITS.particleSize, step: 0.01 })
      .on('change', guard((v: number) => app.setStyle({ particleSize: v })));
    sim.addBinding(state, 'paused').on('change', guard((v: boolean) => app.setPaused(v)));
    sim.addButton({ title: 'Reseed particles' }).on('click', () => app.reseed());
    // Sensitive dependence, made visible: every particle starts within a
    // ball a thousandth of the attractor's size, then they smear apart.
    sim.addButton({ title: 'Butterfly effect: one tiny cluster' }).on('click', () => app.reseed('cluster'));
    this.basinOnly.push(
      sim.addButton({ title: 'Seed basin slice' }).on('click', () => app.reseed('region')),
    );
    sim.addBinding(app, 'fps', { readonly: true, view: 'graph', min: 0, max: 150, interval: 500 });

    const color = pane.addFolder({ title: 'Color' });
    this.colorModeList = color
      .addBinding(state, 'colorMode', {
        label: 'color by',
        options: Object.fromEntries(COLOR_MODES.map((m) => [m, m])),
      })
      .on('change', guard((v: ColorMode) => app.setStyle({ colorMode: v }))) as ListInputBindingApi<ColorMode>;
    color
      .addBinding(state, 'palette', { options: Object.fromEntries(PALETTE_NAMES.map((p) => [p, p])) })
      .on('change', guard((v: PaletteName) => app.setStyle({ palette: v })));
    color
      .addBinding(state, 'cycleSpeed', { label: 'cycling', min: 0, max: 0.3, step: 0.005 })
      .on('change', guard((v: number) => app.setStyle({ cycleSpeed: v })));
    color
      .addBinding(state, 'trailOpacity', { label: 'trails', min: 0.01, max: 0.3, step: 0.005 })
      .on('change', guard((v: number) => app.setStyle({ trailOpacity: v })));

    const glow = pane.addFolder({ title: 'Glow', expanded: false });
    glow.addBinding(app.stage.bloom, 'strength', { min: 0, max: 2.5, step: 0.05 });
    glow.addBinding(app.stage.bloom, 'radius', { min: 0, max: 1, step: 0.01 });
    glow.addBinding(app.stage.bloom, 'threshold', { min: 0, max: 1, step: 0.01 });

    const cam = pane.addFolder({ title: 'Camera' });
    cam
      .addBinding(state, 'autoRotate', { label: 'auto-rotate' })
      .on('change', guard((v: boolean) => app.setAutoRotate(v)));
    cam.addBinding(app.stage.controls, 'autoRotateSpeed', { label: 'rotate speed', min: -4, max: 4, step: 0.05 });
    cam
      .addBinding(state, 'autoFrame', { label: 'auto-frame' })
      .on('change', guard((v: boolean) => (app.autoFrame = v)));
    cam.addBinding(state, 'axes', { label: 'x/y/z axes' }).on('change', guard((v: boolean) => app.setAxesVisible(v)));
    cam.addButton({ title: 'Frame attractor' }).on('click', () => void app.frameCamera(800));
    // Chase camera behind one of the photo-ball particles.
    const rideOptions: Record<string, number> = { off: -1 };
    DEFAULT_FAMILY.forEach((m, i) => (rideOptions[m.name] = i));
    this.flowOnly.push(
      cam
        .addBinding(state, 'ride', { label: 'ride with', options: rideOptions })
        .on('change', guard((v: number) => (v < 0 ? app.stopRide() : app.startRide(v)))),
    );

    const capture = pane.addFolder({ title: 'Capture', expanded: false });
    capture.addButton({ title: 'Save screenshot (PNG)' }).on('click', () => void app.saveScreenshot());
  }

  private renderMeter() {
    if (this.root.hidden || this.root.classList.contains('collapsed')) return;
    const r = this.app.chaos.reading();
    const fmt = (v: number) => (Math.abs(v) >= 0.1 ? v.toFixed(2) : v.toFixed(3));
    let detail: string;
    if (r.verdict === 'measuring') detail = 'measuring…';
    else if (r.verdict === 'diverges') detail = 'trajectories fly off to infinity';
    else {
      detail = `λ ≈ ${fmt(r.lambda)} ± ${fmt(r.error)} per ${r.unit}`;
      if (r.verdict === 'chaotic') {
        const t = r.doubling;
        const unit = r.unit === 'iteration' ? (t === 1 ? 'iteration' : 'iterations') : 'time units';
        detail += `<br>nearby paths separate 2× every ${t >= 10 ? t.toFixed(0) : t.toFixed(1)} ${unit}`;
      }
    }
    this.meter.innerHTML =
      `<span class="meter-label">Chaos meter</span>` +
      `<span class="verdict verdict-${r.verdict.replace(' ', '-')}">${r.verdict}</span>` +
      `<div class="meter-detail">${detail}</div>`;
  }

  /** Pull app state into the proxies and redraw bindings, without echoing change events back. */
  private refresh() {
    const { app, state } = this;
    const a = app.attractor;
    if (a !== this.builtFor) this.buildParams(a);
    // Several attractors can appear or merge with parameters or dt, not just on a switch.
    const basins = app.sys.hasBasins;
    if (basins !== this.basinsShown) {
      this.basinsShown = basins;
      for (const blade of this.basinOnly) blade.hidden = !basins;
      this.colorModeList.options = COLOR_MODES.filter((m) => basins || m !== 'attractor').map((m) => ({
        text: m,
        value: m,
      }));
    }

    const p = app.sys.params;
    a.params.forEach((spec, i) => (this.params[spec.name] = p[i]!));
    const match = a.examples.findIndex((ex) => ex.every((v, i) => Math.abs(v - p[i]!) <= 1e-9 * (1 + Math.abs(v))));
    Object.assign(state, {
      preset: match,
      dt: app.sys.dt,
      speed: app.speed,
      integrator: app.integrator,
      particles: app.sys.count,
      trail: app.sys.trailLength,
      particleSize: app.view.style.particleSize,
      paused: app.paused,
      colorMode: app.view.style.colorMode,
      palette: app.view.style.palette,
      cycleSpeed: app.view.style.cycleSpeed,
      trailOpacity: app.view.style.trailOpacity,
      autoRotate: app.stage.controls.autoRotate,
      autoFrame: app.autoFrame,
      ride: app.ride ?? -1,
      axes: app.axesVisible,
    });

    this.syncing = true;
    this.paramPane?.refresh();
    this.mainPane.refresh();
    this.syncing = false;

    this.title.textContent = a.name;
    this.tray.refresh();
    this.sweep.refresh();
    this.poincare.refresh();
    const an = app.sys.analysis;
    this.status.textContent = !an.ok
      ? 'These parameters diverge: particles fly off to infinity and keep respawning.'
      : an.collapsed
        ? 'These parameters settle onto a fixed point, not an attractor.'
        : '';
    this.status.hidden = !this.status.textContent;
  }
}
