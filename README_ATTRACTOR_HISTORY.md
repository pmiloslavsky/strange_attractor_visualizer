# The Attractors: History and Background

Each system in the visualizer is a set of three coupled ordinary differential
equations. Start almost anywhere and a trajectory settles onto a bounded shape,
the *attractor*, but never repeats itself and never settles into a loop. Two
starting points that are arbitrarily close drift apart exponentially fast.
This combination of boundedness, aperiodicity and sensitive dependence is what
makes an attractor *strange*, and it is why a cloud of particles, each started
a hair apart, spreads out to trace the whole shape.

The parameter values below are the ones the visualizer uses. They come from the
original C++ [ode_simulation](https://github.com/pmiloslavsky/demo/tree/master/ode_simulation)
parameter table, which matches the values popularized by
[Dynamic Mathematics' strange attractor gallery](https://www.dynamicmath.xyz/strange-attractors/).
Notation follows the code: `dx/dt` etc., with parameters named as in the sliders.

| | System | Year | Origin |
|---|---|---|---|
| 1 | [Lorenz](#lorenz) | 1963 | Atmospheric convection |
| 2 | [Chen–Lee](#chenlee) | 2004 | Rigid-body rotation with feedback |
| 3 | [Rössler](#rössler) | 1976 | Simplest continuous chaos, by design |
| 4 | [Aizawa (Langford)](#aizawa-langford) | 1984 | Torus bifurcations |
| 5 | [Three-Scroll Unified](#three-scroll-unified-chaotic-system) | 2010 | Unifying Lorenz- and Lü/Chen-type systems |
| 6 | [Thomas](#thomas) | 1999 | Biological feedback circuits |
| 7 | [Dadras](#dadras) | 2009 | Multi-scroll attractor design |

---

## Lorenz

<img src="docs/screenshots/lorenz.jpg" width="480" alt="Lorenz attractor">

```
dx/dt = σ(y − x)
dy/dt = x(ρ − z) − y
dz/dt = xy − βz
```

Defaults: σ = 10, β = 8/3, ρ = 28. Also: (12.69, 0.13, 53.03), (95.03, 0.19, 82.7).

In 1963 MIT meteorologist **Edward Lorenz** published *Deterministic Nonperiodic
Flow*, a drastically truncated model of convection rolls in a fluid layer
heated from below (building on a model by Barry Saltzman). Here x is the
intensity of the convective motion, and y and z describe temperature variations.
Lorenz had found by accident that restarting a simulation from rounded-off
numbers produced a completely different forecast after a short time. That
observation, sensitive dependence on initial conditions, became the founding
example of chaos theory. His 1972 talk *"Predictability: Does the Flap of a
Butterfly's Wings in Brazil Set Off a Tornado in Texas?"* gave it the name the
**butterfly effect**. The two-lobed attractor happens to look like a
butterfly too.

Whether the Lorenz equations truly have a strange attractor (rather than just
looking like it numerically) stayed open for decades. Stephen Smale listed it
as the 14th of his problems for the 21st century. **Warwick Tucker** settled it
in 2002 with a computer-assisted proof.

- [Lorenz system (Wikipedia)](https://en.wikipedia.org/wiki/Lorenz_system)
- [Lorenz, E. N. (1963). Deterministic Nonperiodic Flow. *J. Atmos. Sci.* 20(2): 130–141](https://doi.org/10.1175/1520-0469(1963)020%3C0130:DNF%3E2.0.CO;2)
- [Butterfly effect (Wikipedia)](https://en.wikipedia.org/wiki/Butterfly_effect)
- [Smale's problems: #14 (Wikipedia)](https://en.wikipedia.org/wiki/Smale%27s_problems)
- [Lorenz Attractor (Wolfram MathWorld)](https://mathworld.wolfram.com/LorenzAttractor.html)

---

## Chen–Lee

<img src="docs/screenshots/chen-lee.jpg" width="480" alt="Chen-Lee attractor">

```
dx/dt = ax − yz
dy/dt = by + xz
dz/dt = cz + xy/3
```

Defaults: a = 5, b = −10, c = −0.38.

**Hsien-Keng Chen and Ching-I Lee** introduced this system in 2004 while
studying *anti-control* of chaos: deliberately making a well-behaved system
chaotic. They started from **Euler's equations for a rotating rigid body** (think
of a gyroscope or a tumbling satellite, with x, y, z the angular velocities
about its principal axes) and added linear feedback. For suitable feedback
gains the body tumbles chaotically. The authors showed the system is closely
related to the Lorenz and Chen systems, and later work built hyperchaotic
versions on top of it.

In the visualizer, note that with these defaults a fraction of starting points
fly off to infinity instead of joining the attractor. The simulation respawns
them.

- [Chen, H.-K., Lee, C.-I. (2004). Anti-control of chaos in rigid body motion. *Chaos, Solitons & Fractals* 21(4): 957–965](https://www.sciencedirect.com/science/article/abs/pii/S096007790300688X)
- Tam, L., Chen, J., Chen, H., Tou, W. (2008). Generation of hyperchaos from the Chen–Lee system. *Chaos, Solitons & Fractals* 38: 826–839.
- [Controlling chaos and chaotification in the Chen–Lee system by multiple time delays (*Chaos, Solitons & Fractals*)](https://www.sciencedirect.com/science/article/abs/pii/S0960077906010277)
- [Rigid body dynamics: Euler's equations (Wikipedia)](https://en.wikipedia.org/wiki/Euler%27s_equations_(rigid_body_dynamics))

---

## Rössler

<img src="docs/screenshots/rossler.jpg" width="480" alt="Rössler attractor">

```
dx/dt = −(y + z)
dy/dt = x + ay
dz/dt = b + z(x − c)
```

Defaults: a = 0.2, b = 0.2, c = 5.7. Also: (0.1, 0.1, 14).

Where Lorenz found chaos in a physical model, **Otto Rössler**, a German
biochemist, set out in 1976 to *construct* the simplest possible continuous
chaotic system. His equations have just one nonlinear term (zx). The motion is
easy to picture: trajectories spiral outward in the x–y plane, and once x gets
large enough the z term kicks them up and folds them back into the center. That
stretch-and-fold is the basic mechanism of chaos. The Rössler system became a
standard textbook example, including for period-doubling routes to chaos
(increase c and watch simple loops double before the band turns chaotic).

- [Rössler attractor (Wikipedia)](https://en.wikipedia.org/wiki/R%C3%B6ssler_attractor)
- [Rössler, O. E. (1976). An equation for continuous chaos. *Physics Letters A* 57(5): 397–398](https://doi.org/10.1016/0375-9601(76)90101-8)

---

## Aizawa (Langford)

<img src="docs/screenshots/aizawa.jpg" width="480" alt="Aizawa attractor">

```
dx/dt = (z − b)x − dy
dy/dt = dx + (z − b)y
dz/dt = c + az − z³/3 − (x² + y²)(1 + ez) + fzx³
```

Defaults: a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1.

This apple-shaped attractor, with a tube running through its axis, is
universally known as the **Aizawa attractor**, after the physicist Yoji Aizawa.
The name appears to be a misattribution. The equations do not seem to appear in
Aizawa's papers. They trace back to **William F. Langford's** 1984 work on
*torus bifurcations*, the way a periodic orbit grows into a doughnut-shaped
(toroidal) flow and then breaks up into chaos. The system is essentially the
normal form of a cusp–Hopf bifurcation, which explains the rotational symmetry
around the z-axis (the d terms spin trajectories around it). Jason Mireles James,
who studied this vector field with Emmanuel Fleurantin, has pointed out that
"Langford system" is the more accurate name. Some galleries now label it
"Langford (Aizawa)".

A curiosity the visualizer runs into: the system also has a *stable fixed
point* near (0, 0, −1.3), so some starting points never reach the attractor at
all and just sit still.

- [Aizawa / Langford attractor (Dynamic Mathematics)](https://www.dynamicmath.xyz/calculus/velfields/Aizawa/)
- [The Aizawa Attractor (Algosome), including the attribution note in the comments](https://www.algosome.com/articles/aizawa-attractor-chaos.html)
- Langford, W. F. (1984). Numerical studies of torus bifurcations. In *Numerical Methods for Bifurcation Problems*, International Series of Numerical Mathematics vol. 70, Birkhäuser.
- [Fleurantin, E., Mireles James, J. D. (2019). Resonant Tori, Transport Barriers, and Chaos in a Vector Field with a Neimark-Sacker Bifurcation (arXiv)](https://arxiv.org/abs/1905.08828)

---

## Three-Scroll Unified Chaotic System

<img src="docs/screenshots/three-scroll.jpg" width="480" alt="Three-Scroll Unified Chaotic System">

```
dx/dt = a(y − x) + dxz
dy/dt = bx − xz + fy
dz/dt = cz + xy − ex²
```

Defaults: a = 40, b = 55, c = 11/6, d = 0.16, e = 0.65, f = 20.

Much of 1990s–2000s chaos research produced families of Lorenz-like systems
(Chen, Lü, and the "unified" system that interpolates between them). In 2010
**Lin Pan, Wuneng Zhou, Jian'an Fang and Dequan Li** proposed the **Three-Scroll
Unified Chaotic System (TSUCS)**, which contains a Lorenz-style attractor and a
Lü/Chen-style attractor at its extremes and, in between, an attractor with
three scrolls instead of the usual two. It has since been a popular test case
for chaos synchronization and control schemes, which matters for applications
such as chaos-based secure communication. The system is stiff, so it needs a
very small time step (dt = 0.0001 here).

(Published papers order the parameters differently. Some list b = 1.833 and
c = 55, which is the same system as here with the two labels swapped.)

- [Pan, L., Zhou, W., Fang, J., Li, D. (2010). A New Three-Scroll Unified Chaotic System Coined. *International Journal of Nonlinear Science* 10(4): 462–474 (Semantic Scholar)](https://www.semanticscholar.org/paper/A-New-Three-Scroll-Unified-Chaotic-System-Coined-Pan-Zhou/24e0f03058fbc8f8071b0fb0372afd3046f7c453)
- [Three Unified Scroll attractor: renderings and notes (Morten Albring)](https://www.mortenalbring.com/Posts/TSUCS)

---

## Thomas

<img src="docs/screenshots/thomas.jpg" width="480" alt="Thomas attractor">

```
dx/dt = sin(y) − bx
dy/dt = sin(z) − by
dz/dt = sin(x) − bz
```

Defaults: b = 0.208186. Also: 0.1998 and 0.32899.

**René Thomas**, a Belgian biologist, studied how *feedback circuits* (genes
switching each other on and off, for example) produce complex behavior. In
1999 he gave this strikingly symmetric system as an example: each variable is
driven by the sine of the next, x → y → z → x, with a single damping
parameter b. Swap the axes cyclically and the equations don't change, which is
why the attractor looks the same from three directions.

The three presets in the visualizer are landmarks on the road to chaos. At
b ≈ 0.32899 a Hopf bifurcation creates a simple periodic loop. As b decreases,
a period-doubling cascade follows, and around b ≈ 0.208186 the motion becomes
chaotic. Push b toward 0 and damping disappears: trajectories wander through an
endless lattice of cells, a deterministic random walk that Thomas called
**labyrinth chaos** and that Julien Sprott and Konstantinos Chlouverakis later
analyzed in detail.

- [Thomas' cyclically symmetric attractor (Wikipedia)](https://en.wikipedia.org/wiki/Thomas%27_cyclically_symmetric_attractor)
- [Thomas, R. (1999). Deterministic chaos seen in terms of feedback circuits: Analysis, synthesis, "labyrinth chaos". *Int. J. Bifurcation and Chaos* 9(10): 1889–1905](https://doi.org/10.1142/S0218127499001383)
- Sprott, J. C., Chlouverakis, K. E. (2007). Labyrinth Chaos. *Int. J. Bifurcation and Chaos* 17(6): 2097.

---

## Dadras

<img src="docs/screenshots/dadras.jpg" width="480" alt="Dadras attractor">

```
dx/dt = y − ax + byz
dy/dt = cy − xz + z
dz/dt = dxy − ez
```

Defaults: a = 3, b = 2.7, c = 1.7, d = 2, e = 9.

**Sara Dadras and Hamid Reza Momeni** published this system in 2009 as a new three-dimensional autonomous chaotic
system that can produce **two-, three- or four-scroll attractors** by varying a
single parameter. Multi-scroll attractors are of interest for electronic chaos
generators and secure communication because they have richer dynamics than the
classic two-lobed shapes. The paper analyzes the system with Poincaré maps,
bifurcation diagrams and Lyapunov exponents. Try sweeping the parameters in the
visualizer to see the scroll count change.

- [Dadras, S., Momeni, H. R. (2009). A novel three-dimensional autonomous chaotic system generating two, three and four-scroll attractors. *Physics Letters A* 373(40): 3637–3642](https://www.sciencedirect.com/science/article/abs/pii/S0375960109009591)
- [NASA ADS abstract](https://ui.adsabs.harvard.edu/abs/2009PhLA..373.3637D/abstract)

---

## Further reading

- [Strange attractor (Wikipedia)](https://en.wikipedia.org/wiki/Attractor#Strange_attractor), [Chaos theory (Wikipedia)](https://en.wikipedia.org/wiki/Chaos_theory)
- [Strange Attractors gallery (Dynamic Mathematics)](https://www.dynamicmath.xyz/strange-attractors/): interactive versions of all seven systems and more, with references
- Steven Strogatz, *Nonlinear Dynamics and Chaos*: the standard introduction, with whole chapters on the Lorenz and Rössler systems
- James Gleick, *Chaos: Making a New Science*: the popular history, including Lorenz's discovery
- J. C. Sprott, *Elegant Chaos: Algebraically Simple Chaotic Flows*: a catalog of minimal chaotic systems in the spirit of Rössler's
