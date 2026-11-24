import * as THREE from './vendor/three.module.js';

/*
 * Krathong Live · 3D night river engine
 * =====================================
 * Everything krathong-shaped in the site is real geometry:
 *   · hero river          (ambient krathongs)
 *   · launch ceremony     (full krathong, candles, incense, embers, wish text)
 *   · gallery river       (every wish becomes a 3D krathong you can click)
 *   · create preview      (3D krathong preview inside the dialog)
 *   · wish detail         (3D krathong inside the detail dialog)
 *   · match card          (two 3D krathongs drifting together)
 *
 * Lighting is built from layered additive glows, warm point lights, shader
 * water reflections, fireflies, embers, incense smoke and a moon flare.
 * GSAP orchestrates every sequence. No post-processing dependency.
 */

const TAU = Math.PI * 2;
const gsap = window.gsap;
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

function isReduced() {
  return reduceQuery.matches || document.body.classList.contains('reduce-motion');
}

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && canvas.getContext('webgl2'))
      || Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (error) {
    return false;
  }
}

/* ==================================================================== */
/* Textures                                                             */
/* ==================================================================== */

function radialTexture(stops, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const glowTexture = radialTexture([
  [0, 'rgba(255,252,242,1)'],
  [0.14, 'rgba(255,238,196,0.98)'],
  [0.36, 'rgba(255,188,110,0.62)'],
  [0.68, 'rgba(255,132,54,0.18)'],
  [1, 'rgba(255,104,30,0)']
]);

function makeFlameTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const cx = size / 2;
  context.save();
  context.beginPath();
  context.moveTo(cx, 8);
  context.bezierCurveTo(cx + 30, 44, cx + 39, 96, cx, 120);
  context.bezierCurveTo(cx - 39, 96, cx - 30, 44, cx, 8);
  context.closePath();
  context.clip();
  const gradient = context.createRadialGradient(cx, 92, 2, cx, 84, 64);
  gradient.addColorStop(0, 'rgba(255,255,250,1)');
  gradient.addColorStop(0.2, 'rgba(255,246,206,1)');
  gradient.addColorStop(0.48, 'rgba(255,196,98,0.96)');
  gradient.addColorStop(0.74, 'rgba(255,120,48,0.6)');
  gradient.addColorStop(1, 'rgba(255,80,20,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const flameTexture = makeFlameTexture();

function makeSmokeTexture() {
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  for (let i = 0; i < 16; i++) {
    const x = size / 2 + (Math.random() - 0.5) * 74;
    const y = size / 2 + (Math.random() - 0.5) * 84;
    const r = 20 + Math.random() * 34;
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.09)');
    gradient.addColorStop(0.55, 'rgba(235,235,240,0.05)');
    gradient.addColorStop(1, 'rgba(220,220,235,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const smokeTexture = makeSmokeTexture();

function makeRayTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.translate(size / 2, size / 2);
  context.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    context.rotate(Math.PI / 2);
    const gradient = context.createLinearGradient(0, 0, 0, -124);
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(0.18, 'rgba(206,220,255,0.32)');
    gradient.addColorStop(1, 'rgba(160,190,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(-2.5, 0);
    context.lineTo(0, -124);
    context.lineTo(2.5, 0);
    context.closePath();
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const rayTexture = makeRayTexture();

function makeNoiseTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const value = 118 + Math.round((Math.random() - 0.5) * 74);
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  return texture;
}

const noiseTexture = makeNoiseTexture();

function makeTrunkTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#c2a67c';
  context.fillRect(0, 0, size, size);
  context.globalAlpha = 0.28;
  for (let radius = 5; radius < size * 0.56; radius += 5) {
    context.strokeStyle = radius % 10 === 0 ? '#8a6f4a' : '#d7bd92';
    context.lineWidth = 1.1;
    context.beginPath();
    context.ellipse(size / 2, size / 2, radius, radius * 0.96, 0, 0, TAU);
    context.stroke();
  }
  context.globalAlpha = 0.14;
  context.strokeStyle = '#6f5838';
  for (let i = 0; i < 42; i++) {
    const angle = Math.random() * TAU;
    const inner = 18 + Math.random() * 42;
    const outer = inner + 26 + Math.random() * 74;
    context.beginPath();
    context.moveTo(size / 2 + Math.cos(angle) * inner, size / 2 + Math.sin(angle) * inner);
    context.lineTo(size / 2 + Math.cos(angle) * outer, size / 2 + Math.sin(angle) * outer);
    context.stroke();
  }
  context.globalAlpha = 0.18;
  for (let i = 0; i < 220; i++) {
    context.fillStyle = Math.random() > 0.5 ? '#7a5f3e' : '#e3cc9f';
    context.beginPath();
    context.arc(Math.random() * size, Math.random() * size, 0.7 + Math.random() * 1.6, 0, TAU);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const trunkTexture = makeTrunkTexture();

/* ==================================================================== */
/* Water shader                                                         */
/* ==================================================================== */

const WATER_VERTEX = `
uniform float uTime;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main() {
  vec3 p = position;
  float a = sin(p.x * 0.32 + uTime * 0.78);
  float b = sin(p.y * 0.44 - uTime * 0.6);
  float c = sin((p.x + p.y) * 0.2 + uTime * 1.12);
  float d = sin((p.x - p.y * 0.8) * 0.66 - uTime * 1.55);
  p.z += a * 0.11 + b * 0.085 + c * 0.05 + d * 0.02;

  float dx = 0.32 * cos(p.x * 0.32 + uTime * 0.78) * 0.11
           + 0.2 * cos((p.x + p.y) * 0.2 + uTime * 1.12) * 0.05
           + 0.66 * cos((p.x - p.y * 0.8) * 0.66 - uTime * 1.55) * 0.02;
  float dy = 0.44 * cos(p.y * 0.44 - uTime * 0.6) * 0.085
           + 0.2 * cos((p.x + p.y) * 0.2 + uTime * 1.12) * 0.05
           - 0.52 * cos((p.x - p.y * 0.8) * 0.66 - uTime * 1.55) * 0.02;

  vec3 n = normalize(vec3(-dx, -dy, 1.0));
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAGMENT = `
uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uMoonPos;
uniform vec3 uMoonColor;
uniform vec3 uSkyColor;
uniform vec3 uWaterNear;
uniform vec3 uWaterFar;
uniform vec3 uCandlePos;
uniform vec3 uCandleColor;
uniform float uCandleIntensity;
uniform float uGlitter;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCameraPos - vWorldPosition);
  float distanceToCamera = length(uCameraPos - vWorldPosition);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, 4.0);

  vec3 color = mix(uWaterNear, uWaterFar, smoothstep(2.0, 52.0, distanceToCamera));

  vec3 moonDir = normalize(uMoonPos - vWorldPosition);
  float moonDiffuse = max(dot(N, moonDir), 0.0);
  vec3 moonHalf = normalize(moonDir + V);
  float moonSpec = pow(max(dot(N, moonHalf), 0.0), 220.0);
  float glint = 0.5 + 0.5 * sin(vWorldPosition.x * 3.7 + uTime * 1.6) * sin(vWorldPosition.z * 2.9 - uTime * 1.2);
  float glintFade = 1.0 - smoothstep(18.0, 90.0, distanceToCamera) * 0.94;
  float glitter = moonSpec * (0.35 + 0.9 * glint) * glintFade;

  vec3 candleVec = uCandlePos - vWorldPosition;
  float candleDist = length(candleVec);
  vec3 candleDir = candleVec / max(candleDist, 0.001);
  float candleDiffuse = max(dot(N, candleDir), 0.0) / (1.0 + candleDist * candleDist * 0.14);
  vec3 candleHalf = normalize(candleDir + V);
  float candleSpec = pow(max(dot(N, candleHalf), 0.0), 80.0) / (1.0 + candleDist * candleDist * 0.2);
  float shimmer = 0.72 + 0.28 * sin(uTime * 9.0 + vWorldPosition.x * 5.0);
  float caustic = pow(max(dot(N, candleDir), 0.0), 5.0)
    * (0.5 + 0.5 * sin(vWorldPosition.x * 17.0 + uTime * 3.1) * sin(vWorldPosition.z * 15.0 - uTime * 2.4))
    / (1.0 + candleDist * candleDist * 0.1);

  color += uMoonColor * (moonDiffuse * 0.15 + glitter * 2.1);
  color += uCandleColor * (candleDiffuse * 1.1 + candleSpec * shimmer * 1.6 + caustic * 0.55) * uCandleIntensity;
  color = mix(color, uSkyColor, fresnel * 0.64);

  float sparkle = pow(max(dot(N, moonHalf), 0.0), 34.0)
    * smoothstep(0.84, 1.0, sin(vWorldPosition.x * 9.0 + uTime * 2.4) * sin(vWorldPosition.z * 7.3 - uTime * 1.9))
    * 0.2 * glintFade;
  color += uMoonColor * sparkle * uGlitter;

  gl_FragColor = vec4(color, 1.0);
}
`;

function createWater(size = 200, segments = 160) {
  const uniforms = {
    uTime: { value: 0 },
    uCameraPos: { value: new THREE.Vector3(0, 2, 8) },
    uMoonPos: { value: new THREE.Vector3(10, 15, -55) },
    uMoonColor: { value: new THREE.Vector3(0.62, 0.7, 0.94) },
    uSkyColor: { value: new THREE.Vector3(0.024, 0.055, 0.094) },
    uWaterNear: { value: new THREE.Vector3(0.018, 0.055, 0.085) },
    uWaterFar: { value: new THREE.Vector3(0.045, 0.11, 0.17) },
    uCandlePos: { value: new THREE.Vector3(0, 1, 0) },
    uCandleColor: { value: new THREE.Vector3(1.0, 0.56, 0.24) },
    uCandleIntensity: { value: 0 },
    uGlitter: { value: 1 }
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: WATER_VERTEX, fragmentShader: WATER_FRAGMENT });
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, uniforms };
}

function createWaterSkirt(inner, outer, color = '#081523', y = -0.4) {
  const geometry = new THREE.RingGeometry(inner, outer, 96, 1);
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = -2;
  return mesh;
}

/* ==================================================================== */
/* Sky, moon, stars, fireflies                                          */
/* ==================================================================== */

function createMoon(position, scale = 1) {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(2.4 * scale, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff4da, toneMapped: false })
  );
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xbcd0ff, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  halo.scale.set(20 * scale, 20 * scale, 1);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xfff0cf, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  core.scale.set(8 * scale, 8 * scale, 1);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: rayTexture, color: 0xd8e4ff, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flare.scale.set(30 * scale, 30 * scale, 1);
  group.add(flare, halo, core, disc);
  group.position.copy(position);
  group.userData.flare = flare;
  return group;
}

function createStars(count = 380) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * TAU;
    const pitch = 0.1 + Math.random() * 0.8;
    const radius = 70 + Math.random() * 60;
    positions[i * 3] = Math.cos(theta) * Math.cos(pitch) * radius;
    positions[i * 3 + 1] = Math.sin(pitch) * radius * 0.9 + 4;
    positions[i * 3 + 2] = -Math.abs(Math.sin(theta) * Math.cos(pitch)) * radius - 8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size: 1.3, map: glowTexture, color: 0xdbe6ff, transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  return new THREE.Points(geometry, material);
}

function createFireflies(count = 56, spread = 24, height = 5) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread * 2;
    positions[i * 3 + 1] = 0.3 + Math.random() * height;
    positions[i * 3 + 2] = 6 - Math.random() * spread * 2.2;
    phases[i] = Math.random() * TAU;
    speeds[i] = 0.18 + Math.random() * 0.42;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    uColor: { value: new THREE.Color(0xffd28a) }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aPhase;
      attribute float aSpeed;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * aSpeed + aPhase) * 1.4;
        p.y += sin(uTime * aSpeed * 1.7 + aPhase * 2.0) * 0.45;
        p.z += cos(uTime * aSpeed * 0.8 + aPhase) * 1.1;
        vAlpha = 0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * 2.1 + aPhase * 3.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 16.0 * uPixelRatio * (1.0 / max(1.0, -mv.z * 0.07));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.04, d);
        gl_FragColor = vec4(uColor, a * vAlpha);
      }
    `
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, uniforms };
}

/* ==================================================================== */
/* Krathong model                                                       */
/* ==================================================================== */

const PALETTES = {
  gold: {
    leafBottom: '#1c321f', leafTop: '#a3bf74', leafDarkBottom: '#14251a', leafDarkTop: '#6d8f52',
    petalBottom: '#96591c', petalTop: '#ffd080', petalMidBottom: '#ad6f28', petalMidTop: '#ffd68c',
    trunk: 0xb89d72, marigold: 0xf2a13a, accent: '#f4d18a'
  },
  lotus: {
    leafBottom: '#1d3727', leafTop: '#96b575', leafDarkBottom: '#13251a', leafDarkTop: '#64844e',
    petalBottom: '#5e102e', petalTop: '#ff9fc4', petalMidBottom: '#741a3a', petalMidTop: '#ffb3d0',
    trunk: 0xb89d72, marigold: 0xf2a13a, accent: '#ffd6e2'
  }
};

const geoCache = new Map();
const matCache = new Map();

function cachedGeo(key, factory) {
  if (!geoCache.has(key)) {
    const geometry = factory();
    geometry.userData.shared = true;
    geoCache.set(key, geometry);
  }
  return geoCache.get(key);
}

function cachedMat(key, factory) {
  if (!matCache.has(key)) {
    const material = factory();
    material.userData.shared = true;
    matCache.set(key, material);
  }
  return matCache.get(key);
}

function applyGradient(geometry, height, bottomHex, topHex) {
  const position = geometry.attributes.position;
  const bottom = new THREE.Color(bottomHex);
  const top = new THREE.Color(topHex);
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = clamp(position.getY(i) / height, 0, 1);
    color.copy(bottom).lerp(top, t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function makeBladeGeometry(height, width, bottomHex, topHex, bend = 0.16) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(width * 0.95, height * 0.3, width * 0.55, height * 0.8, 0, height);
  shape.bezierCurveTo(-width * 0.55, height * 0.8, -width * 0.95, height * 0.3, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.018,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    curveSegments: 10
  });
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    position.setZ(i, position.getZ(i) - bend * Math.pow(y / height, 2));
  }
  geometry.computeVertexNormals();
  applyGradient(geometry, height, bottomHex, topHex);
  geometry.computeVertexNormals();
  return geometry;
}

function bladeMaterial(variant, kind) {
  return cachedMat(`blade-${kind}-${variant}`, () => new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: kind === 'petal' ? 0.48 : 0.66,
    metalness: kind === 'petal' ? 0.04 : 0.02,
    side: THREE.DoubleSide,
    bumpMap: noiseTexture,
    bumpScale: kind === 'petal' ? 0.012 : 0.02,
    emissive: kind === 'petal'
      ? (variant === 'lotus' ? 0x6a1630 : 0x2a1808)
      : 0x0b1509,
    emissiveIntensity: kind === 'petal' ? 0.5 : 0.45
  }));
}

function flatMaterial(color, options = {}) {
  const key = `flat-${color}-${options.roughness || 0.8}-${options.emissive || 0}-${options.emissiveIntensity || 0}`;
  return cachedMat(key, () => new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.8,
    metalness: options.metalness ?? 0,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    side: options.side ?? THREE.FrontSide
  }));
}

function addCandle(parent, materials, options) {
  const { x, z, y, withLight, full } = options;
  const holder = new THREE.Group();
  holder.position.set(x, y, z);

  const waxGeo = cachedGeo('wax', () => new THREE.CylinderGeometry(0.05, 0.058, 0.32, 12));
  const wax = new THREE.Mesh(waxGeo, materials.wax);
  wax.position.y = 0.16;
  holder.add(wax);

  if (full) {
    const rim = new THREE.Mesh(cachedGeo('waxRim', () => new THREE.TorusGeometry(0.054, 0.01, 5, 14)), materials.wax);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.32;
    holder.add(rim);
    const drip = new THREE.Mesh(cachedGeo('waxDrip', () => new THREE.CapsuleGeometry(0.016, 0.09, 3, 6)), materials.wax);
    drip.position.set(0.045, 0.2, 0.01);
    drip.rotation.z = -0.15;
    holder.add(drip);
  }

  const wick = new THREE.Mesh(cachedGeo('wick', () => new THREE.CylinderGeometry(0.008, 0.008, 0.055, 6)), materials.wick);
  wick.position.y = 0.345;
  holder.add(wick);

  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flameTexture, color: 0xffd9a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flame.position.y = 0.52;
  flame.scale.set(0.001, 0.001, 1);

  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xfff8e6, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  core.position.y = 0.47;
  core.scale.set(0.001, 0.001, 1);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xff9a4a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
  }));
  halo.position.y = 0.52;
  halo.scale.set(0.001, 0.001, 1);

  const base = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0x6fa8ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  base.position.y = 0.34;
  base.scale.set(0.001, 0.001, 1);

  holder.add(flame, core, halo, base);

  let light = null;
  if (withLight) {
    light = new THREE.PointLight(0xffa860, 0, 6, 2);
    light.position.y = 0.52;
    holder.add(light);
  }

  parent.add(holder);
  return {
    flame, core, halo, base, light, dim: 1,
    state: { ignition: 0, size: 0 }
  };
}

function addIncense(parent, materials, x, z, index) {
  const holder = new THREE.Group();
  holder.position.set(x, 0.46, z);
  const stick = new THREE.Mesh(cachedGeo('incense', () => new THREE.CylinderGeometry(0.011, 0.013, 0.74, 6)), materials.incense);
  stick.position.y = 0.37;
  stick.rotation.x = 0.1;
  stick.rotation.z = (index - 1) * 0.09;
  const ember = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xff8a3d, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  ember.position.set(0, 0.74, 0);
  ember.scale.set(0.001, 0.001, 1);
  holder.add(stick, ember);
  parent.add(holder);
  return { ember, state: { ignition: 0 } };
}

function buildKrathong({ variant = 'gold', detail = 'full' } = {}) {
  const palette = PALETTES[variant] || PALETTES.gold;
  const full = detail === 'full';
  const simple = detail === 'simple';
  const mini = detail === 'mini';
  const group = new THREE.Group();

  const trunkMat = cachedMat('trunkMat', () => new THREE.MeshStandardMaterial({
    map: trunkTexture,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    emissive: 0x160f07,
    emissiveIntensity: 0.3
  }));
  const leafFlat = flatMaterial(0x3e6041, { roughness: 0.72, side: THREE.DoubleSide, emissive: 0x0b1509, emissiveIntensity: 0.4 });
  const leafDarkFlat = flatMaterial(0x2a4630, { roughness: 0.78, side: THREE.DoubleSide, emissive: 0x091207, emissiveIntensity: 0.35 });
  const goldTrim = flatMaterial(0xd9b371, { roughness: 0.35, metalness: 0.55, emissive: 0x2a1a06, emissiveIntensity: 0.5 });
  const leafBlade = bladeMaterial(variant, 'leaf');
  const petalBlade = bladeMaterial(variant, 'petal');
  const wax = flatMaterial(0xf8eed8, { roughness: 0.36, emissive: 0x3a2a10, emissiveIntensity: 0.4 });
  const wick = flatMaterial(0x241610, { roughness: 0.9 });
  const incense = flatMaterial(0x6d4b30, { roughness: 0.86 });
  const marigold = flatMaterial(palette.marigold, { roughness: 0.66, emissive: 0x3a1602, emissiveIntensity: 0.55 });
  const materials = { wax, wick, incense };

  // Base: sliced banana trunk.
  const trunk = new THREE.Mesh(cachedGeo('trunk', () => new THREE.CylinderGeometry(1.035, 0.9, 0.2, 48)), trunkMat);
  trunk.position.y = 0.1;
  group.add(trunk);

  // Folded leaf bowl.
  const rim = new THREE.Mesh(cachedGeo('rim', () => new THREE.LatheGeometry([
    new THREE.Vector2(0.97, 0),
    new THREE.Vector2(1.02, 0.05),
    new THREE.Vector2(1.09, 0.12),
    new THREE.Vector2(1.16, 0.21),
    new THREE.Vector2(1.25, 0.3)
  ], 64)), leafFlat);
  rim.position.y = 0.02;
  group.add(rim);

  if (!mini) {
    const trim = new THREE.Mesh(cachedGeo('trim', () => new THREE.TorusGeometry(1.225, 0.014, 6, 72)), goldTrim);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.305;
    group.add(trim);
  }

  // Folded banana leaves around the rim.
  const outerLeafA = cachedGeo(`leafA-${variant}`, () => makeBladeGeometry(0.48, 0.22, palette.leafBottom, palette.leafTop, 0.17));
  const outerLeafB = cachedGeo(`leafB-${variant}`, () => makeBladeGeometry(0.42, 0.2, palette.leafDarkBottom, palette.leafDarkTop, 0.15));
  const leafCount = full ? 16 : (simple ? 10 : 6);
  for (let i = 0; i < leafCount; i++) {
    const angle = (i / leafCount) * TAU;
    const holder = new THREE.Group();
    holder.rotation.y = angle;
    holder.position.set(Math.sin(angle) * 1.0, 0.22, Math.cos(angle) * 1.0);
    const leaf = new THREE.Mesh(i % 2 ? outerLeafB : outerLeafA, leafBlade);
    leaf.rotation.x = 0.84 + (i % 3) * 0.035;
    leaf.rotation.z = (i % 2 ? 1 : -1) * 0.05;
    leaf.scale.setScalar(0.94 + (i % 3) * 0.04);
    holder.add(leaf);
    group.add(holder);
  }

  if (full) {
    const innerLeaf = cachedGeo(`leafIn-${variant}`, () => makeBladeGeometry(0.3, 0.16, palette.leafDarkBottom, palette.leafDarkTop, 0.12));
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * TAU + 0.2;
      const holder = new THREE.Group();
      holder.rotation.y = angle;
      holder.position.set(Math.sin(angle) * 0.82, 0.25, Math.cos(angle) * 0.82);
      const leaf = new THREE.Mesh(innerLeaf, leafBlade);
      leaf.rotation.x = 0.46;
      leaf.scale.setScalar(0.9 + (i % 2) * 0.08);
      holder.add(leaf);
      group.add(holder);
    }
  }

  // Raised centre.
  const platform = new THREE.Mesh(cachedGeo('platform', () => new THREE.CylinderGeometry(0.6, 0.72, 0.12, 32)), leafDarkFlat);
  platform.position.y = 0.35;
  group.add(platform);

  // Lotus petal rings.
  const petalA = cachedGeo(`petalA-${variant}`, () => makeBladeGeometry(0.5, 0.18, palette.petalBottom, palette.petalTop, 0.2));
  const petalB = cachedGeo(`petalB-${variant}`, () => makeBladeGeometry(0.4, 0.15, palette.petalMidBottom, palette.petalMidTop, 0.18));
  const petalC = cachedGeo(`petalC-${variant}`, () => makeBladeGeometry(0.28, 0.11, palette.petalMidBottom, palette.petalTop, 0.12));
  function petalRing(geometry, count, radius, y, tilt, offset = 0) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + offset;
      const holder = new THREE.Group();
      holder.rotation.y = angle;
      holder.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
      const petal = new THREE.Mesh(geometry, petalBlade);
      petal.rotation.x = tilt;
      petal.rotation.z = (i % 2 ? 1 : -1) * 0.06;
      petal.scale.setScalar(0.94 + (i % 3) * 0.04);
      holder.add(petal);
      group.add(holder);
    }
  }
  if (full) {
    petalRing(petalA, 14, 0.8, 0.28, 0.5, 0.15);
    petalRing(petalB, 10, 0.58, 0.34, 0.3);
    petalRing(petalC, 6, 0.4, 0.38, 0.12);
  } else if (simple) {
    petalRing(petalA, 8, 0.78, 0.28, 0.48, 0.15);
  } else {
    petalRing(petalA, 5, 0.72, 0.28, 0.48, 0.15);
  }

  // Decorative folded leaf at the back.
  if (full) {
    const sail = new THREE.Mesh(cachedGeo(`sail-${variant}`, () => makeBladeGeometry(0.8, 0.3, palette.leafBottom, palette.leafTop, 0.22)), leafBlade);
    sail.position.set(0, 0.36, -0.12);
    sail.rotation.x = -0.28;
    group.add(sail);
  }

  // Candles.
  const candles = [];
  const candleCount = full ? 3 : 1;
  const candleRadius = mini ? 0.3 : 0.38;
  const angles = full ? [Math.PI * 0.5, Math.PI * 1.35, Math.PI * 1.85] : [Math.PI * 0.5];
  for (let i = 0; i < candleCount; i++) {
    const angle = angles[i];
    candles.push(addCandle(group, materials, {
      x: Math.sin(angle) * candleRadius,
      z: Math.cos(angle) * candleRadius,
      y: 0.46,
      withLight: full || simple,
      full
    }));
  }

  // Incense sticks.
  const incenseItems = [];
  if (full) {
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * TAU + 1.15;
      incenseItems.push(addIncense(group, materials, Math.sin(angle) * 0.2, Math.cos(angle) * 0.2, i));
    }
  }

  // Marigold ring.
  if (full) {
    const bloomGeo = cachedGeo('marigold', () => new THREE.IcosahedronGeometry(0.058, 0));
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * TAU + 0.18;
      const bloom = new THREE.Mesh(bloomGeo, marigold);
      bloom.position.set(Math.sin(angle) * 0.72, 0.46, Math.cos(angle) * 0.72);
      bloom.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(bloom);
    }
  }

  // Incense smoke.
  const smoke = [];
  if (full) {
    for (const source of incenseItems) {
      for (let i = 0; i < 3; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: smokeTexture, color: 0xdcd8cf, transparent: true, opacity: 0,
          depthWrite: false
        }));
        sprite.position.set(source.ember.position.x, 1.1, source.ember.position.z);
        sprite.scale.set(0.001, 0.001, 1);
        group.add(sprite);
        smoke.push({
          sprite,
          life: Math.random() * 2.4,
          maxLife: 2.4 + Math.random() * 1.4,
          baseX: source.ember.position.x,
          baseY: 1.12,
          baseZ: source.ember.position.z,
          rise: 0.9 + Math.random() * 0.8,
          sway: 0.06 + Math.random() * 0.14,
          phase: Math.random() * TAU,
          source
        });
      }
    }
  }

  // Warm collective glow (fake bloom).
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xffb066, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
  }));
  glow.position.y = 0.85;
  glow.scale.set(2.6, 1.7, 1);
  group.add(glow);

  group.userData = { candles, incense: incenseItems, smoke, glow, variant, detail, dim: 1 };
  if (full) {
    const frontLight = new THREE.PointLight(0xffb070, 0, 5, 2);
    frontLight.position.set(0, 1.05, 1.0);
    group.add(frontLight);
    group.userData.frontLight = frontLight;
  }
  return group;
}

function tickCandle(candle, time, index) {
  const state = candle.state;
  const dim = candle.dim ?? 1;
  if (state.ignition <= 0.001) {
    candle.flame.material.opacity = 0;
    candle.core.material.opacity = 0;
    candle.halo.material.opacity = 0;
    candle.base.material.opacity = 0;
    if (candle.light) candle.light.intensity = 0;
    return;
  }
  const flicker = 0.78
    + Math.sin(time * 11.3 + index * 2.1) * 0.1
    + Math.sin(time * 6.7 + index * 1.7) * 0.08
    + Math.sin(time * 23.9 + index * 3.3) * 0.035;
  const f = clamp(flicker, 0.45, 1.15);
  const size = state.size;
  candle.flame.scale.set(0.27 * size * (0.9 + f * 0.2), 0.51 * size * (0.9 + f * 0.24), 1);
  candle.flame.material.opacity = state.ignition * clamp(f, 0, 1) * dim;
  candle.flame.position.x = Math.sin(time * 7 + index) * 0.007;
  candle.core.scale.set(0.12 * size, 0.18 * size, 1);
  candle.core.material.opacity = state.ignition * 0.9 * dim;
  candle.halo.scale.set(1.1 * size * (0.9 + f * 0.2), 0.85 * size * (0.9 + f * 0.2), 1);
  candle.halo.material.opacity = state.ignition * 0.24 * f * dim;
  candle.base.material.opacity = state.ignition * 0.26 * dim;
  candle.base.scale.set(0.09 * size, 0.12 * size, 1);
  if (candle.light) candle.light.intensity = state.ignition * (1.8 + f * 1.9) * dim;
}

function tickKrathong(model, time, delta = 1 / 60) {
  const candles = model.userData.candles || [];
  const modelDim = model.userData.dim ?? 1;
  candles.forEach((candle, index) => {
    candle.dim = modelDim;
    tickCandle(candle, time, index);
  });

  const incense = model.userData.incense || [];
  incense.forEach((item, index) => {
    if (item.state.ignition <= 0.001) {
      item.ember.material.opacity = 0;
      return;
    }
    const flicker = 0.7 + Math.sin(time * 7.4 + index * 1.7) * 0.25;
    item.ember.material.opacity = item.state.ignition * clamp(flicker, 0, 1);
    const size = 0.22 * item.state.ignition * (0.7 + flicker * 0.6);
    item.ember.scale.set(size, size, 1);
  });

  const smoke = model.userData.smoke || [];
  for (const puff of smoke) {
    puff.life += delta;
    if (puff.life > puff.maxLife) puff.life = 0;
    const t = puff.life / puff.maxLife;
    puff.sprite.position.set(
      puff.baseX + Math.sin(time * 0.8 + puff.phase) * puff.sway * (0.3 + t),
      puff.baseY + t * puff.rise,
      puff.baseZ + Math.cos(time * 0.6 + puff.phase) * puff.sway * (0.3 + t)
    );
    puff.sprite.material.opacity = (puff.source.state.ignition || 0) * 0.17 * Math.sin(Math.PI * Math.min(1, t));
    const scale = 0.16 + t * 0.62;
    puff.sprite.scale.set(scale, scale, 1);
  }

  const glow = model.userData.glow;
  let average = 0;
  for (const candle of candles) average += candle.state.ignition;
  average = candles.length ? average / candles.length : 0;
  if (glow) {
    glow.material.opacity = 0.3 * average * (model.userData.dim ?? 1);
    glow.scale.set(2.5 * (0.9 + average * 0.25), 1.65 * (0.9 + average * 0.25), 1);
  }
  if (model.userData.frontLight) {
    model.userData.frontLight.intensity = 2.1 * average * (model.userData.dim ?? 1);
  }
}

function setModelLit(model) {
  for (const candle of model.userData.candles || []) {
    candle.state.ignition = 1;
    candle.state.size = 1;
  }
  for (const item of model.userData.incense || []) item.state.ignition = 1;
}

function resetModel(model) {
  for (const candle of model.userData.candles || []) {
    candle.state.ignition = 0;
    candle.state.size = 0;
    candle.dim = 1;
    candle.flame.material.opacity = 0;
    candle.core.material.opacity = 0;
    candle.halo.material.opacity = 0;
    candle.base.material.opacity = 0;
    if (candle.light) candle.light.intensity = 0;
  }
  for (const item of model.userData.incense || []) {
    item.state.ignition = 0;
    item.ember.material.opacity = 0;
  }
  for (const puff of model.userData.smoke || []) {
    puff.sprite.material.opacity = 0;
    puff.life = 0;
  }
  if (model.userData.glow) model.userData.glow.material.opacity = 0;
  if (model.userData.frontLight) model.userData.frontLight.intensity = 0;
  model.userData.dim = 1;
}

function igniteCandle(timeline, candle, at, onSpark) {
  const state = candle.state;
  state.ignition = 0;
  state.size = 0;
  timeline.to(state, { ignition: 1, duration: 0.7, ease: 'power2.out' }, at);
  timeline.to(state, { size: 1, duration: 1.0, ease: 'back.out(2.6)' }, at);
  if (onSpark) timeline.call(() => onSpark(candle), null, at);
}

function disposeModel(model) {
  model.traverse(object => {
    if (object.geometry && !object.geometry.userData?.shared) object.geometry.dispose();
    const material = object.material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const item of list) if (!item.userData?.shared) item.dispose();
  });
  if (model.parent) model.parent.remove(model);
}

function makeWishSprite(text) {
  const canvas = document.createElement('canvas');
  const width = 1200;
  const height = 480;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const clean = String(text || '').trim().slice(0, 180);
  if (!clean) return null;
  context.clearRect(0, 0, width, height);
  context.font = '600 40px "Festival Thai", "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(255,182,90,0.92)';
  context.shadowBlur = 28;
  context.fillStyle = 'rgba(255,236,196,1)';

  const maxWidth = width - 100;
  const isMark = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    if (context.measureText(word).width <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = '';
    for (const character of word) {
      const test = chunk + character;
      if (context.measureText(test).width <= maxWidth || !chunk) {
        chunk = test;
      } else if (isMark.test(character)) {
        chunk += character;
        lines.push(chunk);
        chunk = '';
      } else {
        lines.push(chunk);
        chunk = character;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);

  const visible = lines.slice(0, 4);
  const lineHeight = 54;
  const startY = height / 2 - ((visible.length - 1) * lineHeight) / 2;
  visible.forEach((content, index) => {
    context.fillText(content, width / 2, startY + index * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  sprite.scale.set(5.4, 2.16, 1);
  return sprite;
}

/* ==================================================================== */
/* Ember particles                                                      */
/* ==================================================================== */

function createEmberField(parent, count = 36) {
  const embers = [];
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: i % 3 === 0 ? 0xffd09a : 0xff9448,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    sprite.scale.set(0.001, 0.001, 1);
    parent.add(sprite);
    embers.push({
      sprite,
      life: Math.random() * 2,
      maxLife: 1.1 + Math.random() * 1.6,
      angle: Math.random() * TAU,
      radius: 0.18 + Math.random() * 0.55,
      rise: 0.9 + Math.random() * 1.9,
      active: false
    });
  }
  return embers;
}

function updateEmbers(embers, time, delta, active) {
  for (const ember of embers) {
    if (!active) {
      ember.sprite.material.opacity = 0;
      continue;
    }
    ember.life += delta;
    if (ember.life > ember.maxLife) {
      ember.life = 0;
      ember.angle = Math.random() * TAU;
      ember.radius = 0.18 + Math.random() * 0.55;
      ember.rise = 0.9 + Math.random() * 1.9;
    }
    const t = ember.life / ember.maxLife;
    const x = Math.sin(ember.angle) * ember.radius + Math.sin(time * 2 + ember.angle) * 0.07;
    const z = Math.cos(ember.angle) * ember.radius + Math.cos(time * 1.7 + ember.angle) * 0.07;
    ember.sprite.position.set(x, 0.5 + t * ember.rise, z);
    ember.sprite.material.opacity = Math.sin(Math.PI * Math.min(1, t)) * 0.92;
    const size = 0.035 + t * 0.07;
    ember.sprite.scale.set(size, size, 1);
  }
}

/* ==================================================================== */
/* Base scene                                                           */
/* ==================================================================== */

class BaseRiver {
  constructor(canvas, host, { fov = 46, far = 440 } = {}) {
    this.canvas = canvas;
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, far);
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.delta = 0;
    this.running = false;
    this.auto = false;
    this.reduced = isReduced();
    this._tmp = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._rayPoint = new THREE.Vector3();
    this.frame = this.tick.bind(this);

    this.onVisibility = () => { if (document.hidden) this.stop(); else this.resume(); };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onMotion = () => {
      this.reduced = isReduced();
      if (this.reduced) { this.stop(); this.renderFrame(0.8); }
      else this.resume();
    };
    document.addEventListener('krathong:motion', this.onMotion);
    reduceQuery.addEventListener('change', this.onMotion);

    this._onLost = event => { event.preventDefault(); this.stop(); };
    this._onRestored = () => this.renderFrame(this.elapsed);
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
  }

  observe(host) {
    this.host = host;
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
  }

  addWaterSky({
    size = 200, segments = 150, moonPosition, moonScale = 1,
    stars = 340, fireflies = 48, spread = 24, fireflyHeight = 5, skirtColor = '#081523'
  }) {
    const { mesh, uniforms } = createWater(size, segments);
    this.water = mesh;
    this.uniforms = uniforms;
    this.scene.add(mesh);
    this.scene.add(createWaterSkirt(size * 0.46, size * 2.6, skirtColor, -0.4));

    this.moonPosition = moonPosition.clone();
    this.moonGroup = createMoon(moonPosition, moonScale);
    this.moonFlare = this.moonGroup.userData.flare;
    this.scene.add(this.moonGroup);
    uniforms.uMoonPos.value.copy(moonPosition);

    this.stars = createStars(stars);
    this.scene.add(this.stars);

    this.fireflies = createFireflies(fireflies, spread, fireflyHeight);
    this.scene.add(this.fireflies.points);

    this.scene.add(new THREE.AmbientLight(0x9fb4dd, 0.4));
    const moonLight = new THREE.DirectionalLight(0xbfd0ff, 1.15);
    moonLight.position.copy(moonPosition);
    this.scene.add(moonLight);
    const fill = new THREE.DirectionalLight(0xc9d8f5, 0.24);
    fill.position.set(0, 5, 12);
    this.scene.add(fill);
  }

  resize(force = false) {
    if (!this.host) return;
    const width = Math.max(1, this.host.clientWidth || 1);
    const height = Math.max(1, this.host.clientHeight || 1);
    if (!force && this._w === width && this._h === height) return;
    this._w = width;
    this._h = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.fireflies) this.fireflies.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
    if (this.reduced) this.renderFrame(0.8);
  }

  start() {
    this.auto = true;
    this.resume();
  }

  pause() {
    this.auto = false;
    this.stop();
  }

  resume() {
    if (!this.auto || this.reduced || this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  tick() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) {
      this.stop();
      return;
    }
    this.delta = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += this.delta;
    this.renderFrame(this.elapsed);
  }

  renderFrame(time) {
    if (!this.uniforms) return;
    this.uniforms.uTime.value = time;
    this.uniforms.uCameraPos.value.copy(this.camera.position);
    if (this.moonGroup) {
      this.moonGroup.position.y = this.moonPosition.y + Math.sin(time * 0.18) * 0.22;
      if (this.moonFlare) this.moonFlare.material.rotation = time * 0.02;
    }
    if (this.fireflies) this.fireflies.uniforms.uTime.value = time;
    this.renderScene(time, this.delta);
    this.renderer.render(this.scene, this.camera);
  }

  renderScene() {}

  spawnRipple(x, z, strength = 1, color = 0x9fc6ff) {
    if (this.reduced) return;
    for (let k = 0; k < 2; k++) {
      const geometry = new THREE.RingGeometry(0.4 + k * 0.16, 0.5 + k * 0.16, 64);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.26 - k * 0.09,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.04, z);
      this.scene.add(ring);
      const target = 4.2 * strength + k * 1.1;
      if (gsap) {
        gsap.to(ring.scale, { x: target, y: target, z: 1, duration: 1.6 + k * 0.25, ease: 'power2.out', delay: k * 0.12 });
        gsap.to(ring.material, {
          opacity: 0, duration: 1.6 + k * 0.25, delay: k * 0.12, ease: 'power1.out',
          onComplete: () => {
            this.scene.remove(ring);
            geometry.dispose();
            material.dispose();
          }
        });
      } else {
        this.scene.remove(ring);
        geometry.dispose();
        material.dispose();
      }
    }
  }

  pointerToWater(event) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1
    };
    this._raycaster.setFromCamera(ndc, this.camera);
    return this._raycaster.ray.intersectPlane(this._plane, this._rayPoint);
  }

  destroy() {
    this.stop();
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('krathong:motion', this.onMotion);
    reduceQuery.removeEventListener('change', this.onMotion);
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.renderer.dispose();
  }
}

/* ==================================================================== */
/* Hero river                                                           */
/* ==================================================================== */

class HeroRiver extends BaseRiver {
  constructor(canvas, stage) {
    super(canvas, stage, { fov: 46 });
    this.observe(stage);
    this.camera.position.set(0, 2.2, 8.6);
    this.camera.lookAt(0, 1.1, -10);
    this.addWaterSky({
      size: 280, segments: 190,
      moonPosition: new THREE.Vector3(12, 16, -58), moonScale: 1.15,
      stars: 380, fireflies: 64, spread: 28
    });
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.ambient = [];
    this.buildAmbient();
    this.bind();
    this.resize();
    if (this.reduced) this.renderFrame(0.8);
    document.body.classList.add('scene-hero');
  }

  buildAmbient() {
    const variants = ['gold', 'lotus', 'gold', 'lotus', 'gold', 'lotus', 'gold', 'lotus'];
    for (let i = 0; i < 8; i++) {
      const design = variants[i % variants.length];
      const model = buildKrathong({ variant: design, detail: 'simple' });
      setModelLit(model);
      model.scale.setScalar(0.58 + Math.random() * 0.5);
      const x = -10 + Math.random() * 20;
      const z = -3 - Math.random() * 34;
      model.position.set(x, 0.02, z);
      model.rotation.y = Math.random() * TAU;
      this.scene.add(model);
      this.ambient.push({
        model,
        baseX: x,
        baseZ: z,
        phase: Math.random() * TAU,
        bob: 0.05 + Math.random() * 0.05,
        speed: 0.1 + Math.random() * 0.15,
        sway: 0.5 + Math.random() * 1.4
      });
    }
  }

  bind() {
    this.onDown = event => {
      if (event.target.closest('a, button, input, textarea, select')) return;
      const point = this.pointerToWater(event);
      if (!point) return;
      if (point.x < -42 || point.x > 42 || point.z < -60 || point.z > 12) return;
      this.spawnRipple(point.x, point.z, 1 + Math.random() * 0.5);
    };
    this.onMove = event => {
      if (event.pointerType === 'touch') return;
      const rect = this.host.getBoundingClientRect();
      if (!rect.width) return;
      this.pointer.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      this.pointer.ty = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    this.onLeave = () => { this.pointer.tx = 0; this.pointer.ty = 0; };
    this.host.addEventListener('pointerdown', this.onDown, { passive: true });
    this.host.addEventListener('pointermove', this.onMove, { passive: true });
    this.host.addEventListener('pointerleave', this.onLeave, { passive: true });
    this.host.querySelector('.water-action')?.addEventListener('click', () => {
      this.spawnRipple(2.6, 1.4, 1.3);
    });
    this.intersection = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) this.start();
      else this.pause();
    }, { threshold: 0.02 });
    this.intersection.observe(this.host);
  }

  renderScene(time) {
    this.pointer.x = lerp(this.pointer.x, this.pointer.tx, 0.05);
    this.pointer.y = lerp(this.pointer.y, this.pointer.ty, 0.05);
    this.camera.position.x = this.pointer.x * 0.9;
    this.camera.position.y = 2.2 - this.pointer.y * 0.3 + Math.sin(time * 0.5) * 0.03;
    this.camera.lookAt(0, 1.1, -10);

    let nearest = null;
    for (const item of this.ambient) {
      const driftX = Math.sin(time * item.speed + item.phase) * item.sway;
      const driftZ = Math.cos(time * item.speed * 0.7 + item.phase) * 0.9;
      item.model.position.x = item.baseX + driftX;
      item.model.position.z = item.baseZ + driftZ;
      item.model.position.y = 0.02 + Math.sin(time * 1.1 + item.phase) * item.bob;
      item.model.rotation.z = Math.sin(time * 0.8 + item.phase) * 0.06;
      item.model.rotation.x = Math.sin(time * 1.3 + item.phase) * 0.045;
      tickKrathong(item.model, time, this.delta);
      if (!nearest || item.model.position.z > nearest.model.position.z) nearest = item;
    }
    if (nearest) {
      nearest.model.updateMatrixWorld();
      nearest.model.userData.candles[0]?.flame.getWorldPosition(this._tmp);
      this.uniforms.uCandlePos.value.copy(this._tmp);
      this.uniforms.uCandleIntensity.value = 0.55;
    }
  }

  destroy() {
    super.destroy();
    this.intersection?.disconnect();
    this.host.removeEventListener('pointerdown', this.onDown);
    this.host.removeEventListener('pointermove', this.onMove);
    this.host.removeEventListener('pointerleave', this.onLeave);
  }
}

/* ==================================================================== */
/* Launch ceremony                                                      */
/* ==================================================================== */

class LaunchScene extends BaseRiver {
  constructor(canvas, overlay) {
    super(canvas, overlay, { fov: 42 });
    this.observe(overlay);
    this.camFrame = { startZ: 7.4, startY: 3.0, z: 5.6, y: 1.75, endZ: 8.8, endY: 2.4, fov: 42 };
    this.camera.position.set(0, 1.75, 5.6);
    this.camera.lookAt(0, 0.72, 0);
    this.addWaterSky({
      size: 220, segments: 180,
      moonPosition: new THREE.Vector3(6.4, 7.2, -46), moonScale: 0.7,
      stars: 300, fireflies: 42, spread: 14, fireflyHeight: 3
    });
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.glowLight = new THREE.PointLight(0xffb26a, 0, 10, 2);
    this.glowLight.position.set(0, 1.1, 0);

    this.underGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: 0xffa85c, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.underGlow.position.set(0, 0.08, 0);
    this.underGlow.scale.set(3.4, 1.1, 1);
    this.scene.add(this.underGlow);

    this.model = null;
    this.embers = [];
    this.embersActive = false;
    this.timeline = null;
    this.wishSprite = null;
    this.active = false;
    this.message = overlay.querySelector('.launch-message');
    this.resize();
    if (this.reduced) this.applyCamera();
  }

  resize(force = false) {
    super.resize(force);
    if (!this.host) return;
    const aspect = Math.max(1, this.host.clientWidth) / Math.max(1, this.host.clientHeight);
    this.portrait = aspect < 1.05;
    this.camFrame = this.portrait
      ? { startZ: 11.2, startY: 4.2, z: 9.6, y: 3.0, endZ: 14.2, endY: 3.9, fov: 42 }
      : { startZ: 7.4, startY: 3.0, z: 5.6, y: 1.75, endZ: 8.8, endY: 2.4, fov: 42 };
    if (!this.active) this.applyCamera();
  }

  applyCamera() {
    const frame = this.camFrame;
    this.camera.position.set(0, frame.y, frame.z);
    this.camera.fov = frame.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0.72, 0);
  }

  setDesign(design) {
    if (this.model) {
      this.model.remove(this.glowLight);
      this.root.remove(this.model);
      disposeModel(this.model);
      this.model = null;
    }
    const model = buildKrathong({ variant: design === 'lotus' ? 'lotus' : 'gold', detail: 'full' });
    model.position.set(0, 0.02, 0);
    model.rotation.y = -0.5;
    model.add(this.glowLight);
    this.glowLight.position.set(0, 1.1, 0);
    this.glowLight.intensity = 0;
    this.root.add(model);
    this.model = model;
    this.embers = createEmberField(model, 38);
    this.embersActive = false;
  }

  reset() {
    if (this.timeline) {
      this.timeline.kill();
      this.timeline = null;
    }
    if (this.wishSprite) {
      this.scene.remove(this.wishSprite);
      this.wishSprite.material.map?.dispose();
      this.wishSprite.material.dispose();
      this.wishSprite = null;
    }
    if (!this.model) return;
    resetModel(this.model);
    this.model.position.set(0, 0.02, 0);
    this.model.scale.setScalar(1);
    this.model.rotation.set(0, -0.5, 0);
    this.glowLight.intensity = 0;
    this.underGlow.material.opacity = 0;
    this.uniforms.uCandleIntensity.value = 0;
    this.embersActive = false;
    updateEmbers(this.embers, 0, 0, false);
    if (this.message) {
      this.message.style.animation = '';
      this.message.style.opacity = '1';
    }
    this.applyCamera();
    this.elapsed = 0;
  }

  play(design, wish) {
    if (!gsap) return false;
    this.setDesign(design);
    this.reset();
    this.active = true;
    this.start();
    this.startTimeline(wish);
    return true;
  }

  ignite(timeline, candle, at) {
    igniteCandle(timeline, candle, at, () => {
      this.sparkBurst(candle);
      this.waterRing(0.7);
    });
  }

  startTimeline(wish) {
    const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
    this.timeline = timeline;
    const model = this.model;
    const camera = this.camera;
    const frame = this.camFrame;

    if (this.reduced) {
      setModelLit(model);
      this.uniforms.uCandleIntensity.value = 0.9;
      this.glowLight.intensity = 6;
      this.underGlow.material.opacity = 0.36;
      this.embersActive = true;
      this.renderFrame(0.8);
      timeline.call(() => document.dispatchEvent(new CustomEvent('krathong:launchdone')), null, 0.9);
      return;
    }

    camera.position.set(1.7, frame.startY, frame.startZ);
    camera.lookAt(0, 0.7, 0);
    timeline.to(camera.position, { x: 0, y: frame.y, z: frame.z, duration: 2.8, ease: 'power2.inOut' }, 0);
    timeline.to(model.rotation, { y: 0.25, duration: 2.8, ease: 'power2.inOut' }, 0);

    const candles = model.userData.candles || [];
    candles.forEach((candle, index) => this.ignite(timeline, candle, 1.5 + index * 0.95));

    const incense = model.userData.incense || [];
    incense.forEach((item, index) => {
      timeline.to(item.state, { ignition: 1, duration: 0.9, ease: 'power2.out' }, 3.4 + index * 0.24);
    });

    timeline.to(this.uniforms.uCandleIntensity, { value: 0.9, duration: 1.8, ease: 'power2.out' }, 2.0);
    timeline.to(this.glowLight, { intensity: 6, duration: 1.8, ease: 'power2.out' }, 2.0);
    timeline.to(this.underGlow.material, { opacity: 0.36, duration: 2.0, ease: 'power2.out' }, 2.0);
    timeline.call(() => { this.embersActive = true; }, null, 2.2);

    const launchAt = 5.8;
    if (this.message) {
      // CSS keyframes win over inline styles, so stop the entrance animation first.
      this.message.style.animation = 'none';
      timeline.to(this.message, { opacity: 0, duration: 1.1, ease: 'power2.out' }, launchAt - 0.3);
    }
    if (wish) {
      const sprite = makeWishSprite(wish);
      if (sprite) {
        const baseWidth = 4.8;
        const baseHeight = baseWidth * 0.4;
        sprite.position.set(0, 1.3, 0);
        sprite.scale.set(baseWidth, baseHeight, 1);
        this.scene.add(sprite);
        this.wishSprite = sprite;
        timeline.fromTo(sprite.material, { opacity: 0 }, { opacity: 0.9, duration: 1.4, ease: 'power2.out' }, launchAt - 0.4);
        timeline.to(sprite.position, { y: 3.1, duration: 7.2, ease: 'power1.out' }, launchAt);
        timeline.to(sprite.scale, { x: baseWidth * 1.12, y: baseHeight * 1.12, z: 1, duration: 7.2, ease: 'power1.out' }, launchAt);
        timeline.to(sprite.material, { opacity: 0, duration: 2.4, ease: 'power1.in' }, launchAt + 4.2);
        timeline.call(() => {
          if (this.wishSprite === sprite) {
            this.scene.remove(sprite);
            sprite.material.map?.dispose();
            sprite.material.dispose();
            this.wishSprite = null;
          }
        }, null, launchAt + 6.8);
      }
    }

    timeline.to(model.position, { z: -12, x: 1.8, duration: 8.5, ease: 'power1.inOut' }, launchAt);
    timeline.to(model.scale, { x: 0.8, y: 0.8, z: 0.8, duration: 8.5, ease: 'power2.in' }, launchAt);
    timeline.to(camera.position, { z: frame.endZ, y: frame.endY, duration: 8.5, ease: 'power1.out' }, launchAt);
    timeline.to(camera, {
      fov: 40, duration: 8.5, ease: 'power1.out',
      onUpdate: () => camera.updateProjectionMatrix()
    }, launchAt);
    timeline.call(() => this.launchFlash(), null, launchAt);
    timeline.call(() => this.waterRing(0.6), null, launchAt + 0.2);
    timeline.call(() => document.dispatchEvent(new CustomEvent('krathong:launchdone')), null, launchAt + 6.8);
  }

  sparkBurst(candle) {
    if (!gsap || !this.model) return;
    candle.flame.getWorldPosition(this._tmp);
    const origin = this._tmp.clone();
    for (let i = 0; i < 11; i++) {
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: i % 3 === 0 ? 0xffe6b0 : 0xffb060,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }));
      spark.position.copy(origin);
      spark.scale.set(0.075, 0.075, 1);
      this.scene.add(spark);
      const angle = Math.random() * TAU;
      const distance = 0.2 + Math.random() * 0.45;
      gsap.to(spark.position, {
        x: origin.x + Math.cos(angle) * distance,
        y: origin.y + 0.08 + Math.random() * 0.4,
        z: origin.z + Math.sin(angle) * distance,
        duration: 0.55 + Math.random() * 0.5,
        ease: 'power2.out'
      });
      gsap.to(spark.scale, { x: 0.012, y: 0.012, z: 1, duration: 0.85, ease: 'power1.in' });
      gsap.to(spark.material, {
        opacity: 0, duration: 0.85, ease: 'power1.in',
        onComplete: () => {
          this.scene.remove(spark);
          spark.material.dispose();
        }
      });
    }
  }

  waterRing(strength = 1) {
    if (!this.model) return;
    this.spawnRipple(this.model.position.x, this.model.position.z, strength, 0xffc98a);
  }

  launchFlash() {
    if (!gsap || !this.model) return;
    this.model.updateMatrixWorld();
    const origin = this._tmp.clone();
    this.model.userData.candles?.[0]?.flame.getWorldPosition(origin);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: 0xffd9a8, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    flash.position.copy(origin);
    flash.scale.set(0.8, 0.8, 1);
    this.scene.add(flash);
    gsap.to(flash.scale, { x: 6.4, y: 6.4, z: 1, duration: 1.8, ease: 'power2.out' });
    gsap.to(flash.material, {
      opacity: 0, duration: 1.8, ease: 'power1.out',
      onComplete: () => {
        this.scene.remove(flash);
        flash.material.dispose();
      }
    });
  }

  halt() {
    this.active = false;
    this.auto = false;
    BaseRiver.prototype.stop.call(this);
    if (this.timeline) this.timeline.pause();
  }

  renderScene(time) {
    if (!this.model) return;
    this.model.position.y = 0.02 + Math.sin(time * 1.05) * 0.045;
    this.model.rotation.z = Math.sin(time * 0.85) * 0.045;
    this.model.rotation.x = Math.sin(time * 1.2 + 1) * 0.03;
    tickKrathong(this.model, time, this.delta);

    this.camera.lookAt(0, 0.7, 0);
    this.uniforms.uCandlePos.value.set(this.model.position.x, 0.55, this.model.position.z);
    this.underGlow.position.set(this.model.position.x, 0.08, this.model.position.z);
    updateEmbers(this.embers, time, this.delta, this.embersActive && this.uniforms.uCandleIntensity.value > 0.15);
  }
}

/* ==================================================================== */
/* Gallery river                                                        */
/* ==================================================================== */

class GalleryScene extends BaseRiver {
  constructor(canvas, host, collection) {
    super(canvas, host, { fov: 46 });
    this.collection = collection;
    this.observe(host);
    this.camera.position.set(0, 3.6, 11.5);
    this.camera.lookAt(0, 0.9, -5);
    this.addWaterSky({
      size: 320, segments: 190,
      moonPosition: new THREE.Vector3(14, 16, -58), moonScale: 1.15,
      stars: 420, fireflies: 72, spread: 32
    });
    this.boatGroup = new THREE.Group();
    this.scene.add(this.boatGroup);
    this.items = [];
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.hoveredId = '';
    this._project = new THREE.Vector3();
    this.bind();
    this.resize();
    if (this.reduced) this.renderFrame(0.8);
    document.body.classList.add('scene-gallery');
  }

  setWishes(wishes) {
    this.collection.replaceChildren();
    for (const item of this.items) {
      this.boatGroup.remove(item.model);
      disposeModel(item.model);
    }
    this.items = [];

    const list = Array.isArray(wishes) ? wishes.slice(0, 16) : [];
    const host = this.host || this.canvas.parentElement;
    const width = Math.max(1, host?.clientWidth || 900);
    const height = Math.max(1, host?.clientHeight || 480);
    const aspect = width / height;
    const portrait = aspect < 1.1;
    const columns = list.length <= 2 ? Math.max(1, list.length) : (portrait ? 3 : 6);
    const rows = Math.max(1, Math.ceil(list.length / columns));
    const stepX = portrait ? 3.2 : 2.75;
    const stepZ = portrait ? 6 : 3.9;

    this.camera.position.set(0, portrait ? 4.7 : 3.6, portrait ? 16 : 11.5);
    this.camera.lookAt(0, 0.9, -5);

    list.forEach((wish, index) => {
      const model = buildKrathong({ variant: wish.design === 'lotus' ? 'lotus' : 'gold', detail: 'mini' });
      setModelLit(model);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const stagger = row % 2 ? (portrait ? 0.8 : 1.3) : 0;
      const x = (column - (columns - 1) / 2) * stepX + stagger + (Math.random() - 0.5) * 0.4;
      const z = -2.4 - row * stepZ + (Math.random() - 0.5) * 0.5;
      const baseScale = portrait ? 0.86 : 0.92 - row * 0.06;
      model.scale.setScalar(baseScale);
      model.position.set(x, 0.02, z);
      model.rotation.y = (Math.random() - 0.5) * 0.8;
      this.boatGroup.add(model);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wish-hit';
      button.dataset.wishId = wish.id;
      button.setAttribute('aria-label', `เปิดคำอธิษฐานของ ${wish.name || 'ผู้ร่วมลอยกระทง'}`);
      button.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('krathong:selectwish', { detail: { id: wish.id } }));
      });
      button.addEventListener('pointerenter', () => { this.hoveredId = wish.id; });
      button.addEventListener('pointerleave', () => { if (this.hoveredId === wish.id) this.hoveredId = ''; });
      button.addEventListener('focus', () => { this.hoveredId = wish.id; });
      button.addEventListener('blur', () => { if (this.hoveredId === wish.id) this.hoveredId = ''; });
      this.collection.appendChild(button);

      this.items.push({
        id: wish.id,
        model,
        button,
        baseScale,
        phase: Math.random() * TAU,
        bob: 0.035 + Math.random() * 0.04
      });
    });

    if (this.reduced) this.renderFrame(0.8);
  }

  bind() {
    this.onMove = event => {
      if (event.pointerType === 'touch') return;
      const rect = this.host.getBoundingClientRect();
      if (!rect.width) return;
      this.pointer.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      this.pointer.ty = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    this.onLeave = () => { this.pointer.tx = 0; this.pointer.ty = 0; };
    this.onDown = event => {
      if (event.target.closest('a, button, input, textarea, select')) return;
      const point = this.pointerToWater(event);
      if (!point) return;
      if (point.x < -40 || point.x > 40 || point.z < -50 || point.z > 12) return;
      this.spawnRipple(point.x, point.z, 1 + Math.random() * 0.4, 0xbcd6ff);
    };
    this.host.addEventListener('pointermove', this.onMove, { passive: true });
    this.host.addEventListener('pointerleave', this.onLeave, { passive: true });
    this.host.addEventListener('pointerdown', this.onDown, { passive: true });
    this.host.querySelector('.water-action')?.addEventListener('click', () => {
      this.spawnRipple(2.8, -1.5, 1.2, 0xbcd6ff);
    });
    this.intersection = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) this.start();
      else this.pause();
    }, { threshold: 0.02 });
    this.intersection.observe(this.host);
  }

  renderScene(time) {
    const portrait = this.camera.aspect < 1.1;
    this.pointer.x = lerp(this.pointer.x, this.pointer.tx, 0.04);
    this.pointer.y = lerp(this.pointer.y, this.pointer.ty, 0.04);
    this.camera.position.x = this.pointer.x * 0.7;
    this.camera.position.y = (portrait ? 4.7 : 3.6) - this.pointer.y * 0.25;
    this.camera.lookAt(0, 0.9, -5);
    this.camera.updateMatrixWorld();

    let nearest = null;
    for (const item of this.items) {
      item.model.position.y = 0.02 + Math.sin(time * 1.05 + item.phase) * item.bob;
      item.model.rotation.z = Math.sin(time * 0.9 + item.phase) * 0.05;
      item.model.rotation.x = Math.sin(time * 1.2 + item.phase) * 0.03;
      const target = item.id === this.hoveredId ? item.baseScale * 1.09 : item.baseScale;
      const scale = lerp(item.model.scale.x, target, 0.12);
      item.model.scale.setScalar(scale);
      tickKrathong(item.model, time, this.delta);

      item.model.getWorldPosition(this._project);
      this._project.y += 0.34 * scale;
      this._project.project(this.camera);
      if (this._project.z > 1 || this._project.z < -1) {
        item.button.style.display = 'none';
      } else {
        item.button.style.display = '';
        item.button.style.left = `${((this._project.x * 0.5 + 0.5) * 100).toFixed(2)}%`;
        item.button.style.top = `${((-this._project.y * 0.5 + 0.5) * 100).toFixed(2)}%`;
      }

      if (!nearest || item.model.position.z > nearest.model.position.z) nearest = item;
    }

    if (nearest) {
      nearest.model.updateMatrixWorld();
      nearest.model.userData.candles?.[0]?.flame.getWorldPosition(this._tmp);
      this.uniforms.uCandlePos.value.copy(this._tmp);
      this.uniforms.uCandleIntensity.value = 0.5;
    }
  }

  destroy() {
    super.destroy();
    this.intersection?.disconnect();
    this.host.removeEventListener('pointermove', this.onMove);
    this.host.removeEventListener('pointerleave', this.onLeave);
    this.host.removeEventListener('pointerdown', this.onDown);
    this.collection.replaceChildren();
  }
}

/* ==================================================================== */
/* Match pair river                                                     */
/* ==================================================================== */

class PairScene extends BaseRiver {
  constructor(canvas, host, card) {
    super(canvas, host, { fov: 42 });
    this.card = card;
    this.observe(host);
    this.camera.position.set(0, 1.45, 5.4);
    this.camera.lookAt(0, 0.6, 0);
    this.addWaterSky({
      size: 90, segments: 110,
      moonPosition: new THREE.Vector3(3.2, 5.2, -20), moonScale: 0.55,
      stars: 120, fireflies: 20, spread: 10, fireflyHeight: 2.6
    });

    this.boatA = buildKrathong({ variant: 'gold', detail: 'simple' });
    this.boatB = buildKrathong({ variant: 'lotus', detail: 'simple' });
    setModelLit(this.boatA);
    setModelLit(this.boatB);
    this.boatA.scale.setScalar(0.82);
    this.boatB.scale.setScalar(0.82);
    this.boatA.position.set(-1.15, 0.02, 0.1);
    this.boatB.position.set(1.7, 0.02, -1.5);
    this.boatB.userData.dim = 0.45;
    this.scene.add(this.boatA, this.boatB);

    this.status = card.dataset.status || 'connecting';
    this.mutation = new MutationObserver(() => this.applyStatus(this.card.dataset.status));
    this.mutation.observe(card, { attributes: true, attributeFilter: ['data-status'] });
    this.applyStatus(this.status, true);

    this.resize();
    this.intersection = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) this.start();
      else this.pause();
    }, { threshold: 0.05 });
    this.intersection.observe(host);
    document.body.classList.add('scene-pair');
  }

  applyStatus(status, instant = false) {
    const previous = this.status;
    this.status = status;
    const near = status === 'waiting'
      ? { a: [-1.15, 0.1], b: [2.15, -2.1], scale: 0.66, dim: 0.4 }
      : status === 'released'
        ? { a: [-1.7, -6.2], b: [2.3, -7.4], scale: 0.45, dim: 0.65 }
        : status === 'matched' || status === 'ready' || status === 'partnerReady'
          ? { a: [-1.1, 0], b: [1.1, -0.15], scale: 0.82, dim: 1 }
          : { a: [-1.15, 0.1], b: [1.7, -1.5], scale: 0.8, dim: 0.8 };

    const apply = () => {
      this.boatA.position.x = near.a[0];
      this.boatA.position.z = near.a[1];
      this.boatB.position.x = near.b[0];
      this.boatB.position.z = near.b[1];
      this.boatA.scale.setScalar(near.scale);
      this.boatB.scale.setScalar(near.scale);
      this.boatB.userData.dim = near.dim;
    };

    if (instant || !gsap) {
      apply();
    } else {
      gsap.to(this.boatA.position, { x: near.a[0], z: near.a[1], duration: 1.15, ease: 'power3.inOut', overwrite: 'auto' });
      gsap.to(this.boatB.position, { x: near.b[0], z: near.b[1], duration: 1.15, ease: 'power3.inOut', overwrite: 'auto' });
      gsap.to(this.boatA.scale, { x: near.scale, y: near.scale, z: near.scale, duration: 1.15, ease: 'power3.inOut', overwrite: 'auto' });
      gsap.to(this.boatB.scale, { x: near.scale, y: near.scale, z: near.scale, duration: 1.15, ease: 'power3.inOut', overwrite: 'auto' });
      gsap.to(this.boatB.userData, { dim: near.dim, duration: 1.15, ease: 'power2.out', overwrite: 'auto' });
    }

    if (!instant && previous !== status && (status === 'matched' || status === 'ready' || status === 'partnerReady')) {
      this.glowPulse();
    }
  }

  glowPulse() {
    if (!gsap) return;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: 0xffc98a, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    flash.position.set(0, 0.8, -0.4);
    flash.scale.set(0.7, 0.7, 1);
    this.scene.add(flash);
    gsap.to(flash.scale, { x: 4.2, y: 3.2, z: 1, duration: 1.2, ease: 'power2.out' });
    gsap.to(flash.material, {
      opacity: 0, duration: 1.2, ease: 'power1.out',
      onComplete: () => {
        this.scene.remove(flash);
        flash.material.dispose();
      }
    });
  }

  renderScene(time) {
    this.boatA.position.y = 0.02 + Math.sin(time * 1.05) * 0.05;
    this.boatB.position.y = 0.02 + Math.sin(time * 1.05 + 1.4) * 0.05;
    this.boatA.rotation.z = Math.sin(time * 0.82) * 0.06;
    this.boatB.rotation.z = Math.sin(time * 0.82 + 1.2) * 0.06;
    tickKrathong(this.boatA, time, this.delta);
    tickKrathong(this.boatB, time, this.delta);
    this.camera.lookAt(0, 0.6, 0);
    this.uniforms.uCandlePos.value.set(0, 0.5, -0.2);
    this.uniforms.uCandleIntensity.value = 0.5;
  }

  destroy() {
    super.destroy();
    this.intersection?.disconnect();
    this.mutation?.disconnect();
  }
}

/* ==================================================================== */
/* Shared 3D viewer (create preview + wish detail)                      */
/* ==================================================================== */

class ViewerScene extends BaseRiver {
  constructor() {
    const canvas = document.createElement('canvas');
    canvas.className = 'viewer-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    super(canvas, null, { fov: 40 });
    this.camera.position.set(0, 1.28, 3.95);
    this.camera.lookAt(0, 0.55, 0);
    this.addWaterSky({
      size: 90, segments: 120,
      moonPosition: new THREE.Vector3(2.8, 4.6, -16), moonScale: 0.4,
      stars: 110, fireflies: 18, spread: 8, fireflyHeight: 2.4
    });
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.models = {};
    this.design = '';
    this.underGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: 0xffa85c, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.underGlow.position.set(0, 0.06, 0);
    this.underGlow.scale.set(2.4, 0.9, 1);
    this.scene.add(this.underGlow);
    document.body.classList.add('scene-viewer');
  }

  mount(container) {
    if (!container) return;
    this.observe(container);
    if (this.canvas.parentElement !== container) container.appendChild(this.canvas);
    container.classList.add('has-canvas');
    this.resize(true);
  }

  setDesign(design) {
    const key = design === 'lotus' ? 'lotus' : 'gold';
    if (!this.models.gold) {
      for (const variant of ['gold', 'lotus']) {
        const model = buildKrathong({ variant, detail: 'full' });
        setModelLit(model);
        model.scale.setScalar(1);
        model.position.set(0, 0.02, 0);
        model.visible = variant === key;
        this.root.add(model);
        this.models[variant] = model;
      }
    }
    for (const variant of Object.keys(this.models)) {
      this.models[variant].visible = variant === key;
    }
    this.design = key;
    this.canvas.dataset.design = key;
    if (this.reduced) this.renderFrame(0.8);
  }

  show(container, design) {
    this.mount(container);
    this.setDesign(design);
    this.start();
  }

  hide() {
    this.pause();
  }

  renderScene(time) {
    const model = this.models[this.design];
    if (!model) return;
    const base = this.design === 'lotus' ? 0.35 : -0.35;
    model.rotation.y = base + Math.sin(time * 0.26) * 0.22;
    model.position.y = 0.02 + Math.sin(time * 1.05) * 0.035;
    tickKrathong(model, time, this.delta);
    this.camera.lookAt(0, 0.55, 0);
    this.uniforms.uCandlePos.value.set(0, 0.5, 0);
    this.uniforms.uCandleIntensity.value = 0.7;
    this.underGlow.material.opacity = 0.28 + Math.sin(time * 1.3) * 0.05;
  }
}

/* ==================================================================== */
/* Bootstrap                                                            */
/* ==================================================================== */

const api = { available: false };
try {
  api.available = hasWebGL();
} catch (error) {
  api.available = false;
}
window.Krathong3D = api;

let hero = null;
let launchScene = null;
let galleryScene = null;
let pairScene = null;
let viewerScene = null;
let galleryFailed = false;

function bootHero() {
  const canvas = document.getElementById('hero-canvas');
  const stage = canvas?.closest('.hero-stage');
  if (!canvas || !stage || !api.available) {
    document.body.classList.add('no-webgl');
    return;
  }
  try {
    hero = new HeroRiver(canvas, stage);
  } catch (error) {
    console.warn('Krathong 3D: hero scene unavailable.', error);
    document.body.classList.add('no-webgl');
  }
}

function bootPair() {
  const canvas = document.getElementById('pair-canvas');
  const host = canvas?.closest('.match-scene');
  const card = document.getElementById('match-card');
  if (!canvas || !host || !card || !api.available) return;
  try {
    pairScene = new PairScene(canvas, host, card);
  } catch (error) {
    console.warn('Krathong 3D: match scene unavailable.', error);
  }
}

api.showPreview = (kind, design) => {
  if (!api.available) return;
  try {
    if (!viewerScene) viewerScene = new ViewerScene();
    const container = document.getElementById(kind === 'detail' ? 'detail-visual' : 'create-preview');
    if (!container) return;
    viewerScene.show(container, design);
  } catch (error) {
    console.warn('Krathong 3D: viewer unavailable.', error);
    viewerScene = null;
  }
};

api.hidePreview = () => {
  viewerScene?.hide();
};

api.setPreviewDesign = design => {
  viewerScene?.setDesign(design);
};

document.addEventListener('krathong:launch', event => {
  if (!api.available) {
    document.body.classList.add('no-webgl');
    return;
  }
  const canvas = document.getElementById('launch-canvas');
  const overlay = document.getElementById('launch-overlay');
  if (!canvas || !overlay) return;
  try {
    if (!launchScene) launchScene = new LaunchScene(canvas, overlay);
    launchScene.resize();
    const design = event.detail?.design === 'lotus' ? 'lotus' : 'gold';
    if (!launchScene.play(design, event.detail?.wish)) {
      document.body.classList.add('no-webgl');
      document.dispatchEvent(new CustomEvent('krathong:launchfailed'));
    }
  } catch (error) {
    console.warn('Krathong 3D: launch scene unavailable.', error);
    document.body.classList.add('no-webgl');
    document.dispatchEvent(new CustomEvent('krathong:launchfailed'));
    document.dispatchEvent(new CustomEvent('krathong:launchdone'));
  }
});

document.addEventListener('krathong:launchend', () => {
  launchScene?.halt();
});

document.addEventListener('krathong:gallery', event => {
  if (!api.available || galleryFailed) return;
  const canvas = document.getElementById('gallery-canvas');
  const host = document.getElementById('gallery-river');
  const collection = document.getElementById('floating-collection');
  if (!canvas || !host || !collection) return;
  try {
    if (!galleryScene) galleryScene = new GalleryScene(canvas, host, collection);
    galleryScene.setWishes(event.detail?.wishes || []);
  } catch (error) {
    console.warn('Krathong 3D: gallery scene unavailable.', error);
    galleryFailed = true;
    document.dispatchEvent(new CustomEvent('krathong:galleryfailed'));
  }
});

window.addEventListener('resize', () => {
  pairScene?.resize();
  galleryScene?.resize();
  launchScene?.resize();
});

if (document.getElementById('match-card')) {
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      bootPair();
    }
  }, { rootMargin: '240px' });
  observer.observe(document.getElementById('match-card'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootHero, { once: true });
} else {
  bootHero();
}


