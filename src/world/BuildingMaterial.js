import * as THREE from 'three';

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
varying vec3 vLocal; varying vec3 vObjN; varying vec3 vInfo; varying vec3 vWPos;

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
    float rad = mix(4.0, 13.0, t);
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

    // glass
    float tint = h;
    vec3 glass = uGlass * (0.75 + 0.5 * tint);
    float blinds = step(0.72, h) * step(fv, mix(top, sill, 0.45 + 0.4 * fract(h * 7.0)));
    vec3 interior = mix(vec3(0.05, 0.05, 0.055), vec3(0.62, 0.58, 0.5), blinds);
    float lit = step(0.93, fract(h * 13.7));
    float broken = step(h, dmg * 1.35 - 0.05) + step(0.95, dmg);
    broken = clamp(broken, 0.0, 1.0);
    // jagged shard edge around broken panes
    float jag = bnoise(vec2(fu, fv) * 22.0 + wcell * 3.1);
    float inner = boxAA(fu, 0.5 - winHalf * 0.85 + jag * 0.08, 0.5 + winHalf * 0.85 - jag * 0.08, 0.01)
                * boxAA(fv, sill + 0.06 + jag * 0.05, top - 0.06 - jag * 0.05, 0.01);
    float hole = broken * inner;

    vec3 winCol = mix(glass, interior, uStyle < 0.5 ? blinds * 0.6 : 0.35 + blinds * 0.5);
    float occ = step(1.0, vInfo.z) * (1.0 - broken);
    if (occ > 0.5) {
      // window flung open: lit room, ceiling light, darker floor band
      vec3 room = mix(vec3(0.55, 0.38, 0.22), vec3(0.95, 0.78, 0.5), smoothstep(sill, top, fv));
      winCol = room;
      bEmis += vec3(1.0, 0.7, 0.42) * inWin * 0.55;
    }
    float winRough = mix(uStyle < 0.5 ? 0.04 : 0.12, 0.9, occ);
    float winMetal = mix(uStyle < 0.5 ? 0.85 : 0.55, 0.0, occ);
    winCol = mix(winCol, vec3(0.012, 0.011, 0.012), hole);
    winRough = mix(winRough, 0.95, hole);
    winMetal = mix(winMetal, 0.0, hole);

    vec3 frameCol = uStyle < 0.5 ? vec3(0.62, 0.66, 0.7) : uTrim;
    bAlb = mix(wall, frameCol, frame);
    bRough = mix(uStyle < 0.5 ? 0.35 : 0.88, 0.5, frame);
    bMetal = uStyle < 0.5 ? 0.35 * frame + 0.2 : 0.0;
    bAlb = mix(bAlb, winCol, inWin);
    bRough = mix(bRough, winRough, inWin);
    bMetal = mix(bMetal, winMetal, inWin);
    bEmis += vec3(1.0, 0.75, 0.45) * lit * inWin * (1.0 - hole) * 0.35;
    // glass reflects the sky strongly; walls only a little
    bRefl = mix(0.7, uStyle < 0.5 ? 2.6 : 1.9, inWin * (1.0 - hole) * (1.0 - occ));
    // recessed windows: darker frame edge around each pane
    float rim = inWin * (1.0 - boxAA(fu, 0.5 - winHalf + 0.03, 0.5 + winHalf - 0.03, 0.01) * boxAA(fv, sill + 0.03, top - 0.03, 0.01));
    bAO *= 1.0 - rim * 0.55;

    if (ground > 0.5) {
      // signage band above storefronts
      float sign = boxAA(fv, 0.8, 0.95, aaw) * boxAA(fu, 0.08, 0.92, aaw);
      vec3 signCol = 0.5 + 0.5 * cos(6.2831 * (bh12(vec2(wid, uSeed)) + vec3(0.0, 0.33, 0.67)));
      bAlb = mix(bAlb, signCol * (uStyle > 3.5 ? 1.0 : 0.6), sign * (uStyle > 2.5 ? 1.0 : 0.6));
      bEmis += signCol * sign * 0.12;
      if (uStyle > 3.5) {
        // striped awning
        float aw = boxAA(fv, 0.75, 0.8, aaw) * step(0.5, fract(fc.x * 1.0));
        bAlb = mix(bAlb, signCol, aw);
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
    Object.assign(shader.uniforms, u, sharedBuildingUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aInfo;
        varying vec3 vLocal; varying vec3 vObjN; varying vec3 vInfo; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 lp = instanceMatrix * vec4(position, 1.0);
        #else
          vec4 lp = vec4(position, 1.0);
        #endif
        vLocal = lp.xyz;
        vObjN = normal;
        vInfo = aInfo;
        vWPos = (modelMatrix * lp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${prefix}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${fragMain}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = bAlb;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n roughnessFactor = bRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n metalnessFactor = bMetal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += bEmis;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n iblIrradiance *= 0.8 * bAO; radiance *= bRefl;`);
  };
  mat.customProgramCacheKey = () => 'cs-building-v3';
  return mat;
}

export { materialCache };
