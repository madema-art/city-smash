import * as THREE from 'three';
import { cityLightUniforms, CITY_LIGHT_GLSL } from '../render/CityLights.js';

// Procedural facade shader on top of MeshStandardMaterial.
// Each building cell is an instanced box. The shader works out, per fragment, whether it is on
// the building's original exterior (facade with windows, roof) or an interior surface exposed by
// damage (broken floor slabs, dark rooms, raw concrete). Damage per cell drives cracks, soot and
// shattered windows, so damage persists visibly without any texture memory.

export const sharedBuildingUniforms = {
  uCamPos: { value: new THREE.Vector3() },
  uFocus: { value: new THREE.Vector3() },
  uFadeOn: { value: 1 },
  uTime: { value: 0 },
};

export const STYLES = {
  GLASS: 0,
  RIBBON: 1,
  BRICK: 2,
  DECO: 3,
  SHOP: 4,
};

const prefix = /* glsl */`
uniform vec3 uWallA; uniform vec3 uWallB; uniform vec3 uGlass; uniform vec3 uTrim; uniform vec3 uRoof;
uniform vec4 uWin; uniform float uStyle; uniform float uSeed;
uniform vec3 uCamPos; uniform vec3 uFocus; uniform float uFadeOn;
varying vec3 vLocal; varying vec3 vObjN; varying vec3 vInfo; varying vec3 vWPos; varying float vPow;
uniform float uTime;
${CITY_LIGHT_GLSL}
float bh12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float bnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = bh12(i), b = bh12(i+vec2(1,0)), c = bh12(i+vec2(0,1)), d = bh12(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float bfbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * bnoise(p); p *= 2.07; a *= 0.5; } return s; }
float bayer4(vec2 p){ vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // 4x4 bayer via lookup arithmetic
  float b = mod(i * 7.0 + floor(i / 4.0) * 3.0, 16.0);
  return b / 16.0; }
float boxAA(float x, float lo, float hi, float w){ return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x)); }
`;

const fragMain = /* glsl */`
  // ---- camera obstruction: dither away building surfaces between camera and monster ----
  if (uFadeOn > 0.5) {
    vec3 ab = uFocus - uCamPos;
    float t = clamp(dot(vWPos - uCamPos, ab) / dot(ab, ab), 0.0, 1.0);
    float dist = length(vWPos - (uCamPos + ab * t));
    float rad = mix(2.5, 8.0, t);
    if (t < 0.93 && dist < rad) {
      float k = smoothstep(rad, rad * 0.55, dist) * 0.82;
      if (bayer4(gl_FragCoord.xy) < k) discard;
    }
  }

  vec3 bAlb = uWallA; float bRough = 0.85; float bMetal = 0.0; vec3 bEmis = vec3(0.0); float bAO = 1.0; float bRefl = 0.8;
  vec3 n = vObjN;
  float bitv; vec2 fc; int axis;
  if (abs(n.x) > 0.5) { bitv = n.x > 0.0 ? 1.0 : 2.0; fc = vec2(vLocal.z * sign(n.x), vLocal.y); axis = 0; }
  else if (abs(n.z) > 0.5) { bitv = n.z > 0.0 ? 16.0 : 32.0; fc = vec2(-vLocal.x * sign(n.z), vLocal.y); axis = 2; }
  else { bitv = n.y > 0.0 ? 4.0 : 8.0; fc = vLocal.xz; axis = 1; }
  float mask = vInfo.x;
  float ext = mod(floor(mask / bitv + 0.001), 2.0);
  float dmg = vInfo.y;
  float topCell = mod(floor(mask / 4.0 + 0.001), 2.0);
  float aaw = 0.03;

  if (axis != 1 && ext > 0.5) {
    // ---------------- facade ----------------
    float fl = floor(fc.y / 4.0);
    float fv = fract(fc.y / 4.0);
    float colW = 4.0 / uWin.x;
    float wu = fc.x / colW;
    float wid = floor(wu);
    float fu = fract(wu);
    vec2 wcell = vec2(wid, fl) + uSeed;
    float h = bh12(wcell * 1.37);
    float winHalf = uWin.y * 0.5;
    float sill = uWin.w, top = uWin.w + uWin.z;
    float ground = 1.0 - step(1.0, fl);
    if (ground > 0.5) {
      // storefront / lobby: tall glazing with a signage band
      winHalf = 0.44; sill = 0.06; top = 0.74;
    }
    float inWin = boxAA(fu, 0.5 - winHalf, 0.5 + winHalf, aaw) * boxAA(fv, sill, top, aaw);
    vec3 wall = mix(uWallA, uWallB, bfbm(fc * 0.35 + uSeed) * 0.8);
    float frame = 0.0;

    if (uStyle < 0.5) {
      // glass curtain wall: spandrels + thin bright mullions
      float mull = 1.0 - boxAA(fract(wu), 0.035, 0.965, 0.01);
      wall = mix(uWallA, uWallB, step(0.5, fract(fc.y / 8.0)) * 0.3);
      frame = mull;
    } else if (uStyle < 1.5) {
      // ribbon windows: continuous horizontal bands
      float band = boxAA(fv, sill, top, aaw);
      float mull = 1.0 - boxAA(fract(wu), 0.03, 0.97, 0.01);
      inWin = mix(inWin, band, ground > 0.5 ? 0.0 : 1.0);
      frame = mull * band;
      wall *= 0.92 + 0.08 * step(0.5, fract(fv * 2.0 + 0.25));
    } else if (uStyle < 2.5) {
      // brick: courses + white window frames + sills
      vec2 bp = vec2(fc.x * 3.2, fc.y * 6.5);
      bp.x += step(1.0, mod(floor(bp.y), 2.0)) * 0.5;
      float mortar = 1.0 - boxAA(fract(bp.x), 0.04, 0.96, 0.02) * boxAA(fract(bp.y), 0.08, 0.92, 0.03);
      float bv = bh12(floor(bp)) * 0.18;
      wall = mix(wall * (0.9 + bv), vec3(0.55, 0.52, 0.48), mortar * 0.7);
      float outer = boxAA(fu, 0.5 - winHalf - 0.05, 0.5 + winHalf + 0.05, aaw) * boxAA(fv, sill - 0.05, top + 0.04, aaw);
      frame = (outer - inWin) * (1.0 - ground);
    } else if (uStyle < 3.5) {
      // art-deco stone: vertical piers, recessed dark windows, cornice bands every 6 floors
      float pier = 1.0 - boxAA(fract(fc.x / 4.0), 0.12, 0.88, 0.02);
      wall = mix(wall, uTrim, pier * 0.55);
      inWin *= 1.0 - pier;
      float cornice = step(5.5, mod(fl, 6.0)) * step(0.86, fv);
      wall = mix(wall, uTrim * 1.1, cornice);
      bAO = mix(1.0, 0.75, boxAA(fu, 0.5 - winHalf - 0.06, 0.5 + winHalf + 0.06, aaw) * (1.0 - inWin));
    } else {
      // shop/low-rise stucco with coloured ground floor and awnings
      float outer = boxAA(fu, 0.5 - winHalf - 0.06, 0.5 + winHalf + 0.06, aaw) * boxAA(fv, sill - 0.06, top + 0.06, aaw);
      frame = (outer - inWin) * (1.0 - ground);
    }

    // ---- glass + night interiors ----
    float tint = h;
    vec3 glass = uGlass * (0.55 + 0.4 * tint);
    float broken = step(h, dmg * 1.35 - 0.05) + step(0.95, dmg);
    broken = clamp(broken, 0.0, 1.0);
    // jagged shard edge around broken panes
    float jag = bnoise(vec2(fu, fv) * 22.0 + wcell * 3.1);
    float inner = boxAA(fu, 0.5 - winHalf * 0.85 + jag * 0.08, 0.5 + winHalf * 0.85 - jag * 0.08, 0.01)
                * boxAA(fv, sill + 0.06 + jag * 0.05, top - 0.06 - jag * 0.05, 0.01);
    float hole = broken * inner;
    float occ = step(1.0, vInfo.z) * (1.0 - broken);

    // which rooms are lit tonight: per building type, with whole office floors lit together
    float h2 = bh12(wcell * 2.71 + 0.3);
    float litFrac = uStyle < 0.5 ? 0.6 : uStyle < 1.5 ? 0.55 : uStyle < 2.5 ? 0.52 : uStyle < 3.5 ? 0.42 : 0.45;
    float officeFloor = step(0.45, bh12(vec2(fl, uSeed * 1.7)));
    float isLit = (uStyle < 1.5) ? max(step(h2, litFrac * 0.55), officeFloor * step(h2, 0.92)) : step(h2, litFrac);
    if (ground > 0.5) isLit = 1.0; // storefronts and lobbies stay lit
    isLit = max(isLit, occ);
    // electrical state of this cell: 1 steady, 0 dead, in between = failing (flicker)
    float pw = vPow;
    float fn = bnoise(vec2(uTime * 11.0 + vInfo.z * 61.0, wid * 3.1 + fl * 1.7));
    float onK = pw > 0.995 ? 1.0 : step(1.0 - pw * 0.85, fn) * (0.4 + 0.6 * pw);
    // light colours: warm homes, neutral and cool offices, occasional blue TV glow
    float hc = bh12(wcell * 5.3 + 1.1);
    vec3 warm = vec3(1.0, 0.62, 0.3), neutral = vec3(1.0, 0.82, 0.58), cool = vec3(0.68, 0.82, 1.0), tv = vec3(0.35, 0.5, 1.0);
    vec3 lc = (uStyle < 1.5) ? mix(cool, neutral, step(0.6, hc)) : (hc < 0.12 ? tv : mix(warm, neutral, step(0.7, hc)));
    if (ground > 0.5) lc = mix(neutral, cool, step(0.5, bh12(vec2(wid, uSeed))));
    // simple room illusion: ceiling light falloff, furniture, blinds/curtains, the odd silhouette
    float wy = (fv - sill) / max(0.01, top - sill), wx = (fu - (0.5 - winHalf)) / max(0.01, 2.0 * winHalf);
    float room = 0.55 + 0.6 * smoothstep(0.0, 1.0, wy);
    room *= 1.0 - 0.6 * step(wy, 0.22) * step(0.5, bh12(wcell + 7.0)) * boxAA(wx, 0.15 + h * 0.3, 0.55 + h * 0.4, 0.02);
    if (uStyle < 1.5) room *= mix(1.0, 0.7 + 0.3 * step(0.5, fract(wy * 18.0)), step(0.55, h)); // blinds
    else room *= mix(1.0, 0.45, (1.0 - boxAA(wx, 0.18, 0.82, 0.03)) * step(0.4, h)); // curtains
    float person = step(0.86, bh12(wcell + 3.3)) * (1.0 - smoothstep(0.08, 0.13, length(vec2((wx - 0.5 - (h - 0.5) * 0.4) * 1.6, (wy - 0.35) * 1.0))));
    person = max(person, step(0.86, bh12(wcell + 3.3)) * boxAA(wx, 0.38 + (h - 0.5) * 0.4, 0.62 + (h - 0.5) * 0.4, 0.02) * step(wy, 0.3));
    room *= 1.0 - person * 0.85;
    float glow = isLit * onK * (1.0 - hole);
    vec3 roomCol = lc * room;
    if (occ > 0.5) roomCol = mix(vec3(0.75, 0.48, 0.25), vec3(1.0, 0.82, 0.55), smoothstep(0.0, 1.0, wy));

    vec3 winCol = mix(glass, roomCol * 0.25, glow);
    float winRough = mix(uStyle < 0.5 ? 0.05 : 0.12, 0.6, glow);
    float winMetal = mix(uStyle < 0.5 ? 0.9 : 0.6, 0.1, glow);
    winCol = mix(winCol, vec3(0.006), hole);
    winRough = mix(winRough, 0.95, hole);
    winMetal = mix(winMetal, 0.0, hole);
    float winE = (ground > 0.5 ? 0.8 : uStyle < 1.5 ? 0.85 : 0.75) * (0.75 + 0.5 * h);
    bEmis += roomCol * glow * inWin * winE;

    vec3 frameCol = uStyle < 0.5 ? vec3(0.45, 0.48, 0.52) : uTrim;
    bAlb = mix(wall, frameCol, frame);
    bRough = mix(uStyle < 0.5 ? 0.35 : 0.88, 0.5, frame);
    bMetal = uStyle < 0.5 ? 0.35 * frame + 0.2 : 0.0;
    bAlb = mix(bAlb, winCol, inWin);
    bRough = mix(bRough, winRough, inWin);
    bMetal = mix(bMetal, winMetal, inWin);
    // dark glass mirrors the lit city; lit panes and walls reflect less
    bRefl = mix(0.6, uStyle < 0.5 ? 2.4 : 1.7, inWin * (1.0 - hole) * (1.0 - glow * 0.7));
    // light spilling onto the wall just around lit windows
    float spill = isLit * onK * (1.0 - inWin) * boxAA(fu, 0.5 - winHalf - 0.12, 0.5 + winHalf + 0.12, 0.08) * boxAA(fv, sill - 0.1, top + 0.08, 0.06);
    bEmis += wall * lc * spill * 0.06;
    // recessed windows: darker frame edge around each pane
    float rim = inWin * (1.0 - boxAA(fu, 0.5 - winHalf + 0.03, 0.5 + winHalf - 0.03, 0.01) * boxAA(fv, sill + 0.03, top - 0.03, 0.01));
    bAO *= 1.0 - rim * 0.55;

    if (ground > 0.5) {
      // signage band above storefronts
      float sign = boxAA(fv, 0.8, 0.95, aaw) * boxAA(fu, 0.08, 0.92, aaw);
      vec3 signCol = 0.5 + 0.5 * cos(6.2831 * (bh12(vec2(wid, uSeed)) + vec3(0.0, 0.33, 0.67)));
      bAlb = mix(bAlb, signCol * 0.3, sign);
      float neon = sign * (0.6 + 0.4 * step(0.25, bnoise(vec2(fc.x * 3.0, fc.y * 6.0) + wid)));
      bEmis += signCol * neon * onK * (uStyle > 2.5 ? 3.2 : 2.2);
      if (uStyle > 3.5) {
        // striped awning
        float aw = boxAA(fv, 0.75, 0.8, aaw) * step(0.5, fract(fc.x * 1.0));
        bAlb = mix(bAlb, signCol * 0.6, aw);
        bEmis += signCol * aw * 0.25 * onK;
      }
    }
    // parapet / cornice on the top storey of each tier
    if (topCell > 0.5) {
      float cap = smoothstep(0.86, 0.88, fv);
      bAlb = mix(bAlb, uTrim, cap);
      bRough = mix(bRough, 0.8, cap);
      bMetal = mix(bMetal, 0.0, cap);
    }
    // grime streaks near the base and under windows
    float grime = (1.0 - smoothstep(0.0, 5.0, fc.y)) * 0.32 + bfbm(vec2(fc.x * 0.6, fc.y * 0.08) + uSeed) * 0.14;
    bAlb *= 1.0 - grime;
    // street lamps, signs and headlights wash up the lower floors
    bEmis += bAlb * cityLightAt(vWPos + vObjN * 0.6);
  } else if (ext > 0.5) {
    // ---------------- roof ----------------
    vec2 rp = fc;
    float g = bfbm(rp * 0.8 + uSeed);
    bAlb = uRoof * (0.8 + 0.4 * g);
    bRough = 0.95;
    // parapet strip along exterior edges
    vec2 cl = fract(vLocal.xz / 4.0);
    float e = 0.0;
    if (mod(floor(mask / 1.0 + 0.001), 2.0) > 0.5) e = max(e, smoothstep(0.9, 0.93, cl.x));
    if (mod(floor(mask / 2.0 + 0.001), 2.0) > 0.5) e = max(e, 1.0 - smoothstep(0.07, 0.1, cl.x));
    if (mod(floor(mask / 16.0 + 0.001), 2.0) > 0.5) e = max(e, smoothstep(0.9, 0.93, cl.y));
    if (mod(floor(mask / 32.0 + 0.001), 2.0) > 0.5) e = max(e, 1.0 - smoothstep(0.07, 0.1, cl.y));
    bAlb = mix(bAlb, uTrim * 0.9, e);
    if (n.y < 0.0) { bAlb = vec3(0.25); }
  } else {
    // ---------------- exposed interior ----------------
    vec3 conc = vec3(0.46, 0.44, 0.41) * (0.75 + 0.5 * bfbm(fc * 1.3 + uSeed));
    if (axis == 1) {
      // floor slab or ceiling seen through damage
      bAlb = n.y > 0.0 ? conc * 0.85 : conc * 0.45;
      float tiles = boxAA(fract(fc.x * 0.5), 0.03, 0.97, 0.02) * boxAA(fract(fc.y * 0.5), 0.03, 0.97, 0.02);
      if (n.y > 0.0) bAlb *= mix(0.75, 1.0, tiles);
      bRough = 0.95;
    } else {
      float fv = fract(fc.y / 4.0);
      float slab = 1.0 - boxAA(fv, 0.13, 0.9, 0.02);
      float col = 1.0 - boxAA(fract(fc.x / 4.0), 0.08, 0.92, 0.02);
      float room = 1.0 - max(slab, col);
      vec3 roomCol = mix(vec3(0.06, 0.055, 0.05), vec3(0.32, 0.27, 0.22), step(0.8, bnoise(fc * 0.7 + uSeed)) * 0.6);
      bAlb = mix(conc, roomCol, room);
      // rebar strands sticking out of slab edges
      float rebar = step(0.92, bnoise(vec2(fc.x * 8.0, floor(fc.y / 4.0)))) * slab;
      bAlb = mix(bAlb, vec3(0.25, 0.12, 0.08), rebar * 0.8);
      bRough = 0.95;
    }
    dmg = max(dmg, 0.5);
    bEmis += bAlb * cityLightAt(vWPos) * 0.5;
  }

  // ---------------- damage: cracks + soot ----------------
  if (dmg > 0.02) {
    vec2 cp = fc * 0.45 + uSeed * 3.0;
    float cn = abs(bfbm(cp) - 0.5);
    float crack = 1.0 - smoothstep(0.0, 0.012 + dmg * 0.03, cn);
    float soot = bfbm(fc * 0.25 + 7.0) * dmg;
    bAlb *= 1.0 - crack * smoothstep(0.1, 0.5, dmg) * 0.85;
    bAlb = mix(bAlb, bAlb * vec3(0.45, 0.42, 0.4), smoothstep(0.3, 0.9, soot));
    bRough = mix(bRough, 0.95, dmg * 0.7);
    bMetal *= 1.0 - dmg * 0.6;
  }
  bAlb *= bAO;
`;

const materialCache = new Map();

export function createBuildingMaterial(style) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  const u = {
    uWallA: { value: new THREE.Color(style.wallA) },
    uWallB: { value: new THREE.Color(style.wallB) },
    uGlass: { value: new THREE.Color(style.glass) },
    uTrim: { value: new THREE.Color(style.trim) },
    uRoof: { value: new THREE.Color(style.roof) },
    uWin: { value: new THREE.Vector4(...style.win) },
    uStyle: { value: style.type },
    uSeed: { value: style.seed },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, sharedBuildingUniforms, cityLightUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aInfo; attribute float aPow;
        varying vec3 vLocal; varying vec3 vObjN; varying vec3 vInfo; varying vec3 vWPos; varying float vPow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 lp = instanceMatrix * vec4(position, 1.0);
        #else
          vec4 lp = vec4(position, 1.0);
        #endif
        vLocal = lp.xyz;
        vObjN = normal;
        vInfo = aInfo;
        vPow = aPow;
        vWPos = (modelMatrix * lp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${prefix}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${fragMain}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = bAlb;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n roughnessFactor = bRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n metalnessFactor = bMetal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += bEmis;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n iblIrradiance *= 0.45 * bAO; radiance *= bRefl;`);
  };
  mat.customProgramCacheKey = () => 'cs-building-night-v1';
  return mat;
}

export { materialCache };
