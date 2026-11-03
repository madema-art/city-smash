import * as THREE from 'three';

// The city's light field.
// Thousands of real lights would be far too expensive, so street-level illumination is stored in
// two world-space light maps sampled by every lit material:
//   * static map  (1 m/texel): streetlights, signals, shop signs. Re-stamped only when a light
//     breaks, so destroying a lamp really darkens that patch of street, facade and passers-by.
//   * dynamic map (2 m/texel): headlights, police flashers, fires, explosions, searchlight spots.
//     Cleared and re-stamped every frame from a bounded list.
// A light's contribution falls off with height above the street, so it pools on pavement and
// washes up the first floors of facades, the way real street lighting does.

const EXT = 256; // half extent in metres (covers the whole city + outskirts)

export const cityLightUniforms = {
  uStaticLight: { value: null },
  uDynLight: { value: null },
  uLightExt: { value: EXT },
  uLightGain: { value: 1.0 },
  uTimeG: { value: 0 },
};

export const CITY_LIGHT_GLSL = /* glsl */`
uniform sampler2D uStaticLight; uniform sampler2D uDynLight; uniform float uLightExt; uniform float uLightGain; uniform float uTimeG;
vec3 cityLightAt(vec3 wp) {
  vec2 uv = (wp.xz + uLightExt) / (2.0 * uLightExt);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  vec3 s = texture2D(uStaticLight, uv).rgb;
  vec3 d = texture2D(uDynLight, uv).rgb;
  // stored with a x4 headroom; street lamps sit ~9 m up, so light falls away above that
  float hs = exp(-max(0.0, wp.y - 5.0) / 6.0);
  float hd = exp(-max(0.0, wp.y - 4.0) / 9.0);
  return (s * s * hs + d * d * hd) * 4.0 * uLightGain;
}
`;

// Inject city-light sampling into a MeshStandardMaterial (instanced, skinned or plain).
export function patchCityLight(mat, { strength = 1, key = '' } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, cityLightUniforms);
    sh.uniforms.uCityK = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityW;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        {
          vec4 cw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cw = instanceMatrix * cw;
          #endif
          vCityW = (modelMatrix * cw).xyz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCityW; uniform float uCityK;\n${CITY_LIGHT_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * cityLightAt(vCityW) * uCityK;`);
  };
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => prevKey() + '|citylight' + key;
  return mat;
}

function makeTex(size) {
  const data = new Uint8Array(size * size * 4);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { data, tex, size };
}

export class CityLights {
  constructor() {
    this.stat = makeTex(512); // 1 m / texel
    this.dyn = makeTex(256); // 2 m / texel
    this.staticAcc = new Float32Array(512 * 512 * 3); // linear accumulation before sqrt encode
    this.dynAcc = new Float32Array(256 * 256 * 3);
    this.sources = []; // static sources {x,z,r,g,b,radius,on,id}
    this.staticDirty = true;
    this.dynList = [];
    cityLightUniforms.uStaticLight.value = this.stat.tex;
    cityLightUniforms.uDynLight.value = this.dyn.tex;
  }

  addStatic(x, z, color, intensity, radius) {
    const c = new THREE.Color(color);
    const s = { x, z, r: c.r * intensity, g: c.g * intensity, b: c.b * intensity, radius, on: 1 };
    this.sources.push(s);
    this.staticDirty = true;
    return s;
  }

  setOn(src, on) {
    if (src.on === on) return;
    src.on = on;
    this.staticDirty = true;
  }

  // dynamic light for this frame only
  pulse(x, z, r, g, b, radius) {
    if (this.dynList.length < 400) this.dynList.push(x, z, r, g, b, radius);
  }

  _stamp(acc, size, mpt, x, z, r, g, b, radius) {
    const cx = (x + EXT) / mpt, cz = (z + EXT) / mpt, rr = radius / mpt;
    const i0 = Math.max(0, Math.floor(cx - rr)), i1 = Math.min(size - 1, Math.ceil(cx + rr));
    const j0 = Math.max(0, Math.floor(cz - rr)), j1 = Math.min(size - 1, Math.ceil(cz + rr));
    for (let j = j0; j <= j1; j++) {
      const dz = (j + 0.5 - cz) / rr;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5 - cx) / rr;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 1) continue;
        // soft pool: bright core, long gentle tail
        const f = (1 - d2) * (1 - d2) * (0.35 + 0.65 / (1 + d2 * 6));
        const k = (j * size + i) * 3;
        acc[k] += r * f; acc[k + 1] += g * f; acc[k + 2] += b * f;
      }
    }
  }

  _encode(acc, tex) {
    const d = tex.data;
    const n = tex.size * tex.size;
    for (let i = 0; i < n; i++) {
      // stored as sqrt(L/4) for precision in the dim range
      d[i * 4] = Math.min(255, Math.sqrt(acc[i * 3] * 0.25) * 255);
      d[i * 4 + 1] = Math.min(255, Math.sqrt(acc[i * 3 + 1] * 0.25) * 255);
      d[i * 4 + 2] = Math.min(255, Math.sqrt(acc[i * 3 + 2] * 0.25) * 255);
      d[i * 4 + 3] = 255;
    }
    tex.tex.needsUpdate = true;
  }

  // light value (linear) at a point, for tests and gameplay queries
  sampleStatic(x, z) {
    const i = Math.floor(x + EXT), j = Math.floor(z + EXT);
    if (i < 0 || j < 0 || i >= 512 || j >= 512) return 0;
    const k = (j * 512 + i) * 3;
    return this.staticAcc[k] + this.staticAcc[k + 1] + this.staticAcc[k + 2];
  }

  update(dt) {
    cityLightUniforms.uTimeG.value += dt;
    if (this.staticDirty) {
      this.staticDirty = false;
      this.staticAcc.fill(0);
      for (const s of this.sources) {
        if (s.on <= 0) continue;
        this._stamp(this.staticAcc, 512, 1, s.x, s.z, s.r * s.on, s.g * s.on, s.b * s.on, s.radius);
      }
      this._encode(this.staticAcc, this.stat);
    }
    this.dynAcc.fill(0);
    const L = this.dynList;
    for (let i = 0; i < L.length; i += 6) this._stamp(this.dynAcc, 256, 2, L[i], L[i + 1], L[i + 2], L[i + 3], L[i + 4], L[i + 5]);
    this._encode(this.dynAcc, this.dyn);
    L.length = 0;
  }

  dispose() { this.stat.tex.dispose(); this.dyn.tex.dispose(); }
}
