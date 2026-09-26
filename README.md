# Strange Attractor Visualizer

Real-time 3D strange attractors in the browser: thousands of particles with
glowing, fading trails, palette coloring by speed / age / height, bloom, and
orbit controls. A from-scratch web rebuild of the C++/SFML/TGUI
[ode_simulation](https://github.com/pmiloslavsky/demo/tree/master/ode_simulation)
demo, keeping its seven systems and parameter tables:
Lorenz, Chen-Lee, Rossler, Aizawa, Three-Scroll-Unified, Thomas, Dadras.

Static site, no backend. Vite + TypeScript + Three.js.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static output in dist/
```

## Controls (temporary, until the control panel lands)

| Key | Action |
| --- | --- |
| 1–7 | Switch attractor |
| C / P | Cycle color mode / palette |
| R | Toggle auto-rotate |
| `[` `]` | Fewer / more particles |
| `-` `=` | Shorter / longer trails |
| Space | Pause |
| H | Hide help |

Drag to orbit, scroll or pinch to zoom.

## Layout

- `src/attractors/` — one file per system: equations, parameter ranges, example
  sets, default dt and particle size (ported from the original `DE` table).
- `src/simulation/` — integrators, reference-trajectory analysis, and the
  particle system with its trail ring buffer.
- `src/scene/` — Three.js stage (camera, controls, bloom), trail/particle
  shaders, palettes.

## Deploy

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml` (enable Pages → Source: GitHub Actions in the
repo settings once).
