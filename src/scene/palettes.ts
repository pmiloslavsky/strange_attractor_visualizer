import * as THREE from 'three';

/**
 * Gradient palettes, low → high. Low ends are kept off pure black because
 * trails are blended additively on a black background: a black stop would
 * simply make that part of the attractor invisible.
 */
export const PALETTES = {
  Aurora: ['#1b2a6b', '#1a6fb0', '#18c3a8', '#9ef01a', '#fff275'],
  Inferno: ['#2a0b5e', '#7a1d6d', '#c73a4f', '#f17c1e', '#fcd34d', '#fffbd0'],
  Neon: ['#3a0ca3', '#7209b7', '#f72585', '#ff9e00', '#4cc9f0'],
  Ember: ['#5c0a0a', '#9d0208', '#e85d04', '#faa307', '#ffe66d'],
  Glacier: ['#0b2f7a', '#0077b6', '#00b4d8', '#90e0ef', '#f0fbff'],
  Spectral: ['#5e4fa2', '#3288bd', '#66c2a5', '#e6f598', '#fdae61', '#f46d43', '#d53e4f'],
} as const satisfies Record<string, readonly string[]>;

export type PaletteName = keyof typeof PALETTES;
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];

const WIDTH = 256;

/** Bake a palette into a 256×1 texture. Mirrored wrapping makes color cycling seamless. */
export function paletteTexture(name: PaletteName, target?: THREE.DataTexture): THREE.DataTexture {
  const stops = PALETTES[name].map((hex) => new THREE.Color(hex));
  const data = target?.image.data instanceof Uint8Array ? target.image.data : new Uint8Array(WIDTH * 4);
  const c = new THREE.Color();
  for (let i = 0; i < WIDTH; i++) {
    const t = (i / (WIDTH - 1)) * (stops.length - 1);
    const k = Math.min(Math.floor(t), stops.length - 2);
    c.copy(stops[k]!).lerp(stops[k + 1]!, t - k);
    // THREE.Color holds linear values; bytes are sRGB-encoded, and the texture's
    // SRGBColorSpace makes the GPU decode them back to linear on sampling.
    const srgb = c.clone().convertLinearToSRGB();
    data[4 * i] = Math.round(srgb.r * 255);
    data[4 * i + 1] = Math.round(srgb.g * 255);
    data[4 * i + 2] = Math.round(srgb.b * 255);
    data[4 * i + 3] = 255;
  }
  const tex = target ?? new THREE.DataTexture(data, WIDTH, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
