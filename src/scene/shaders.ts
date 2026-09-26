/**
 * Shared GLSL for trails (LineSegments) and particle heads (Points).
 *
 * Both draw from the same slot-major trail buffer, so a vertex's slot is
 * gl_VertexID / uCount (for indexed draws gl_VertexID is the index value; for
 * the Points draw range it includes the range start). Age is how many frames
 * old that slot is relative to the ring-buffer head.
 */

export const COLOR_MODES = ['speed', 'age', 'height', 'particle'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

const common = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uHead;
  uniform float uCount;
  uniform float uTrailLength;
  uniform int uColorMode;
  uniform vec2 uSpeedRange;
  uniform vec2 uZRange;
  uniform vec3 uHeightAxis;
  uniform float uCycle;

  attribute float speed;

  // Integer math: float division can land a hair below an exact multiple on
  // some GPUs and misattribute a vertex to the previous slot.
  int vertexSlot() { return gl_VertexID / int(uCount + 0.5); }
  int vertexParticle() { return gl_VertexID - vertexSlot() * int(uCount + 0.5); }

  float slotAge() {
    return mod(uHead - float(vertexSlot()) + uTrailLength, uTrailLength);
  }

  vec3 paletteColor(float age) {
    float t;
    if (uColorMode == 0) {
      t = (speed - uSpeedRange.x) / (uSpeedRange.y - uSpeedRange.x);
    } else if (uColorMode == 1) {
      t = 1.0 - age / uTrailLength;
    } else if (uColorMode == 2) {
      t = (dot(position, uHeightAxis) - uZRange.x) / (uZRange.y - uZRange.x);
    } else {
      t = fract(float(vertexParticle()) * 0.61803398875);
    }
    return texture2D(uPalette, vec2(clamp(t, 0.0, 1.0) + uCycle, 0.5)).rgb;
  }
`;

export const trailVertex = /* glsl */ `
  ${common}
  uniform float uTrailOpacity;
  uniform float uFade;
  varying vec4 vColor;

  void main() {
    float age = slotAge();
    float life = 1.0 - age / uTrailLength;
    vColor = vec4(paletteColor(age), uTrailOpacity * uFade * pow(life, 1.6));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const trailFragment = /* glsl */ `
  varying vec4 vColor;
  void main() {
    gl_FragColor = vColor;
  }
`;

export const headVertex = /* glsl */ `
  ${common}
  uniform float uSize;
  uniform float uProjScale;
  uniform float uMinPointPx;
  uniform float uFade;
  uniform float uHeadOpacity;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // uSize is a world-space diameter (the original's particle_size); keep a
    // floor so distant particles stay visible as glints.
    gl_PointSize = max(uSize * uProjScale / -mv.z, uMinPointPx);
    vColor = paletteColor(0.0);
    vAlpha = uFade * uHeadOpacity;
  }
`;

export const headFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(1.0, 0.0, r);
    // Hot white-ish core fading to palette color: reads as a glowing bead under bloom.
    vec3 col = mix(vColor, vec3(1.0), core * core * 0.6) * (1.0 + core);
    gl_FragColor = vec4(col, core * vAlpha);
  }
`;
