import * as THREE from 'three';
import { WORLD, CELL } from '../config.js';
import { Building } from './Building.js';
import { STYLES, createBuildingMaterial } from './BuildingMaterial.js';
import { mulberry32 } from '../core/util.js';
import { cityLightUniforms, CITY_LIGHT_GLSL } from '../render/CityLights.js';

const S = CELL.size;
const H = CELL.height;
const PITCH = WORLD.blockSize + WORLD.roadWidth; // 86
const HALF = (WORLD.blocksX * WORLD.blockSize + (WORLD.blocksX + 1) * WORLD.roadWidth) / 2; // 183

export const ROAD_CENTERS = [];
for (let k = 0; k <= WORLD.blocksX; k++) ROAD_CENTERS.push(-HALF + WORLD.roadWidth / 2 + k * PITCH);
export const CITY_HALF = HALF;

const PALETTES = {
  [STYLES.GLASS]: [
    { wallA: 0x223040, wallB: 0x2c3d52, glass: 0x2f5f86, trim: 0x9aa6b2, roof: 0x45484c },
    { wallA: 0x34393f, wallB: 0x262a2f, glass: 0x3d7a86, trim: 0xb8bcc2, roof: 0x404346 },
    { wallA: 0x1e2a36, wallB: 0x18222c, glass: 0x4a6f92, trim: 0x7f8c98, roof: 0x45484b },
    { wallA: 0x3a3226, wallB: 0x2b251c, glass: 0x8a6a36, trim: 0xb39a6a, roof: 0x4d4943 },
  ],
  [STYLES.RIBBON]: [
    { wallA: 0xb9b0a0, wallB: 0xa59c8c, glass: 0x27404f, trim: 0x7d7568, roof: 0x5a5752 },
    { wallA: 0xc4bba9, wallB: 0xb0a794, glass: 0x22384a, trim: 0x8a2f24, roof: 0x55524e },
    { wallA: 0x7f8f99, wallB: 0x6e7e88, glass: 0x1f3442, trim: 0x535f66, roof: 0x4a4d50 },
  ],
  [STYLES.BRICK]: [
    { wallA: 0x8f3420, wallB: 0x6d2617, glass: 0x1f2c36, trim: 0xd9d1c0, roof: 0x34302d },
    { wallA: 0xa45f37, wallB: 0x86492a, glass: 0x1f2c36, trim: 0xe3dccb, roof: 0x3a3531 },
    { wallA: 0x5e2f25, wallB: 0x4a241c, glass: 0x1d2830, trim: 0xcfc4b0, roof: 0x2e2a27 },
    { wallA: 0xae8a58, wallB: 0x937346, glass: 0x1f2c36, trim: 0xe6dfcf, roof: 0x3d3934 },
  ],
  [STYLES.DECO]: [
    { wallA: 0xc9b688, wallB: 0xb8a376, glass: 0x1a242b, trim: 0x8c7a52, roof: 0x5c564c },
    { wallA: 0xc2ad94, wallB: 0xae9980, glass: 0x182027, trim: 0x6f2e2a, roof: 0x57514a },
  ],
  [STYLES.SHOP]: [
    { wallA: 0xe0a868, wallB: 0xd09658, glass: 0x22323c, trim: 0xf2ece0, roof: 0x4f4b46 },
    { wallA: 0x5fa894, wallB: 0x4f967f, glass: 0x22323c, trim: 0xf2ece0, roof: 0x4a4744 },
    { wallA: 0xe2cfa4, wallB: 0xd3bf92, glass: 0x22323c, trim: 0xb03a28, roof: 0x4f4b46 },
    { wallA: 0xd06a48, wallB: 0xbc5a3a, glass: 0x22323c, trim: 0xf2ece0, roof: 0x4a4642 },
    { wallA: 0x6f8fc4, wallB: 0x5f7fb4, glass: 0x22323c, trim: 0xf2ece0, roof: 0x4a4744 },
  ],
};
const WIN = {
  [STYLES.GLASS]: [2, 0.94, 0.78, 0.12],
  [STYLES.RIBBON]: [2, 0.8, 0.42, 0.36],
  [STYLES.BRICK]: [2, 0.42, 0.5, 0.26],
  [STYLES.DECO]: [2, 0.46, 0.62, 0.18],
  [STYLES.SHOP]: [2, 0.48, 0.46, 0.3],
};

function groundMaterial(scorchTex) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uScorch = { value: scorchTex };
    sh.uniforms.uPitch = { value: PITCH };
    sh.uniforms.uHalf = { value: HALF };
    Object.assign(sh.uniforms, cityLightUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGW; uniform sampler2D uScorch; uniform float uPitch; uniform float uHalf;
        float gh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(gh(i),gh(i+vec2(1,0)),f.x), mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x), f.y); }
        float gf(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*gn(p); p*=2.1; a*=.5; } return s; }
        float band(float x, float lo, float hi){ return step(lo, x) * step(x, hi); }
        ${CITY_LIGHT_GLSL}
        float gWet = 0.0;
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 w = vGW.xz;
        float off = uHalf - 11.0;
        vec2 rc = (w + off) / uPitch;
        vec2 dc = abs((rc - floor(rc + 0.5)) * uPitch); // distance to nearest road centreline on each axis
        float onX = step(dc.x, 7.0), onZ = step(dc.y, 7.0);
        float swX = step(dc.x, 11.0), swZ = step(dc.y, 11.0);
        float n = gf(w * 0.15);
        float fine = gn(w * 3.0);
        vec3 asphalt = vec3(0.07, 0.072, 0.078) * (0.75 + 0.45 * n + 0.15 * fine);
        vec3 walk = vec3(0.36, 0.345, 0.32) * (0.8 + 0.3 * n);
        float tile = band(fract(w.x / 2.0), 0.03, 0.97) * band(fract(w.y / 2.0), 0.03, 0.97);
        walk *= mix(0.82, 1.0, tile);
        vec3 plaza = vec3(0.3, 0.285, 0.26) * (0.8 + 0.35 * n);
        float ptile = band(fract(w.x / 4.0), 0.02, 0.98) * band(fract(w.y / 4.0), 0.02, 0.98);
        plaza *= mix(0.8, 1.0, ptile);
        vec3 col = plaza;
        float road = max(onX, onZ);
        float side = max(swX, swZ);
        col = mix(col, walk, side);
        // curb
        float curbX = band(dc.x, 7.0, 7.4) * (1.0 - onZ), curbZ = band(dc.y, 7.0, 7.4) * (1.0 - onX);
        col = mix(col, vec3(0.46, 0.44, 0.41), max(curbX, curbZ));
        col = mix(col, asphalt, road);
        float inter = onX * onZ;
        // markings on the vertical (along-z) roads
        if (onX > 0.5 && swZ < 0.5) {
          float yel = band(dc.x, 0.12, 0.32);
          float dash = band(dc.x, 3.38, 3.62) * step(fract(w.y / 9.0), 0.5);
          float edge = band(dc.x, 6.5, 6.7);
          col = mix(col, vec3(0.75, 0.52, 0.06), yel);
          col = mix(col, vec3(0.62), max(dash, edge));
        }
        if (onZ > 0.5 && swX < 0.5) {
          float yel = band(dc.y, 0.12, 0.32);
          float dash = band(dc.y, 3.38, 3.62) * step(fract(w.x / 9.0), 0.5);
          float edge = band(dc.y, 6.5, 6.7);
          col = mix(col, vec3(0.75, 0.52, 0.06), yel);
          col = mix(col, vec3(0.62), max(dash, edge));
        }
        // crosswalks
        if (onX > 0.5 && band(dc.y, 7.6, 10.6) > 0.5) col = mix(col, vec3(0.6), step(0.5, fract(w.x / 1.6)) * 0.9);
        if (onZ > 0.5 && band(dc.x, 7.6, 10.6) > 0.5) col = mix(col, vec3(0.6), step(0.5, fract(w.y / 1.6)) * 0.9);
        // outside the city: scrubby lots
        float outside = step(uHalf, max(abs(w.x), abs(w.y)));
        vec3 grass = mix(vec3(0.12, 0.2, 0.06), vec3(0.2, 0.26, 0.09), n);
        col = mix(col, grass, outside * (1.0 - road) * (1.0 - side * 0.7));
        // persistent scorch + cracks from the fight
        vec2 suv = (w + 256.0) / 512.0;
        vec4 sc = texture2D(uScorch, suv);
        float crack = sc.g * (1.0 - smoothstep(0.0, 0.06, abs(gf(w * 0.9) - 0.5)));
        col *= 1.0 - sc.r * 0.85;
        col *= 1.0 - crack * 0.8;
        col = mix(col, vec3(0.34, 0.31, 0.27), sc.b * 0.6);
        diffuseColor.rgb = col;
        // damp night streets: puddles collect on the asphalt and in gutters
        float pud = smoothstep(0.55, 0.72, gf(w * 0.08 + 13.0)) + band(dc.x, 6.2, 7.0) * 0.6 + band(dc.y, 6.2, 7.0) * 0.6;
        gWet = clamp(road * (0.35 + pud), 0.0, 1.0) * (1.0 - sc.b);
        diffuseColor.rgb *= 1.0 - gWet * 0.35;
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.92, 0.32, gWet);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 L = cityLightAt(vGW);
          totalEmissiveRadiance += diffuseColor.rgb * L;
          // wet sheen: lamp pools glint on the damp road
          totalEmissiveRadiance += L * gWet * 0.18;
        }`);
  };
  return mat;
}

export class City {
  constructor(ctx, seed = 7) {
    this.ctx = ctx;
    this.rng = mulberry32(seed);
    this.buildings = [];
    this.parks = [];
    this.shopLights = [];
    this.shopCheck = 0;
    this.totalCells = 0;

    // scorch map: r = burn, g = cracks, b = dust
    this.scorchSize = 512;
    this.scorchData = new Uint8Array(this.scorchSize * this.scorchSize * 4);
    this.scorchTex = new THREE.DataTexture(this.scorchData, this.scorchSize, this.scorchSize, THREE.RGBAFormat);
    this.scorchTex.magFilter = THREE.LinearFilter;
    this.scorchTex.minFilter = THREE.LinearFilter;
    this.scorchTex.needsUpdate = true;
    this.scorchDirty = false;
    this.scorchTimer = 0;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), groundMaterial(this.scorchTex));
    ground.receiveShadow = true;
    ctx.root.add(ground);
    this.ground = ground;

    this._layout();
    this._skyline();
  }

  _layout() {
    const rng = this.rng;
    const ctx = this.ctx;
    let id = 0;
    for (let bz = 0; bz < WORLD.blocksZ; bz++) {
      for (let bx = 0; bx < WORLD.blocksX; bx++) {
        const x0 = -HALF + WORLD.roadWidth + bx * PITCH;
        const z0 = -HALF + WORLD.roadWidth + bz * PITCH;
        const bs = WORLD.blockSize;
        const dc = Math.hypot(x0 + bs / 2, z0 + bs / 2) / (HALF * 1.2); // 0 downtown .. 1 edge
        if ((bx === 0 && bz === 1) || (bx === 3 && bz === 2)) {
          this._park(x0, z0, bs);
          continue;
        }
        const lots = [];
        const split = (x, z, w, d, depth) => {
          const big = Math.max(w, d);
          if (depth >= 3 || big <= 24 || (depth >= 1 && big <= 36 && rng() < 0.55) || (depth >= 2 && rng() < 0.35)) {
            lots.push({ x, z, w, d });
            return;
          }
          if (w >= d) {
            const cut = 12 + Math.floor(rng() * ((w - 24) / 4 + 1)) * 4;
            split(x, z, cut, d, depth + 1);
            split(x + cut, z, w - cut, d, depth + 1);
          } else {
            const cut = 12 + Math.floor(rng() * ((d - 24) / 4 + 1)) * 4;
            split(x, z, w, cut, depth + 1);
            split(x, z + cut, w, d - cut, depth + 1);
          }
        };
        // showcase block right in front of the start
        if (bx === 2 && bz === 3) {
          lots.push({ x: x0, z: z0, w: 36, d: 36, force: { floors: 24, style: STYLES.GLASS } });
          lots.push({ x: x0 + 36, z: z0, w: 28, d: 36 });
          lots.push({ x: x0, z: z0 + 36, w: 36, d: 28, force: { floors: 5, style: STYLES.SHOP } });
          lots.push({ x: x0 + 36, z: z0 + 36, w: 28, d: 28, force: { floors: 9, style: STYLES.BRICK } });
        } else if (bx === 1 && bz === 3) {
          lots.push({ x: x0, z: z0, w: 64, d: 28 });
          lots.push({ x: x0 + 28, z: z0 + 28, w: 36, d: 36, force: { floors: 14, style: STYLES.DECO } });
          lots.push({ x: x0, z: z0 + 28, w: 28, d: 36, force: { floors: 6, style: STYLES.BRICK } });
        } else {
          split(x0, z0, bs, bs, 0);
        }
        for (const lot of lots) {
          const inset = 2;
          const w = lot.w - inset * 2, d = lot.d - inset * 2;
          const nx = Math.max(2, Math.floor(w / S)), nz = Math.max(2, Math.floor(d / S));
          const area = nx * nz;
          let floors;
          if (lot.force) floors = lot.force.floors;
          else {
            const base = 4 + (1 - dc) * 22;
            floors = Math.round(base * (0.45 + rng() * 0.85) * (area >= 36 ? 1.15 : area >= 20 ? 0.9 : 0.6));
            floors = Math.max(2, Math.min(30, floors));
          }
          let type;
          if (lot.force) type = lot.force.style;
          else if (floors >= 15) type = [STYLES.GLASS, STYLES.GLASS, STYLES.DECO, STYLES.RIBBON][Math.floor(rng() * 4)];
          else if (floors >= 7) type = [STYLES.RIBBON, STYLES.BRICK, STYLES.DECO, STYLES.BRICK][Math.floor(rng() * 4)];
          else type = [STYLES.SHOP, STYLES.SHOP, STYLES.BRICK][Math.floor(rng() * 3)];
          const heights = new Array(nx * nz).fill(floors);
          // tiered setbacks on towers
          if (floors >= 12 && nx >= 5 && nz >= 5 && rng() < 0.75) {
            const tier = Math.round(floors * (0.55 + rng() * 0.2));
            for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
              const edge = x === 0 || z === 0 || x === nx - 1 || z === nz - 1;
              if (edge) heights[x + z * nx] = tier;
            }
            if (floors >= 20 && nx >= 7 && nz >= 7 && rng() < 0.6) {
              const tier2 = Math.round(floors * 0.82);
              for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
                const ring = x === 1 || z === 1 || x === nx - 2 || z === nz - 2;
                if (ring && heights[x + z * nx] === floors) heights[x + z * nx] = tier2;
              }
            }
          } else if (floors >= 6 && rng() < 0.3) {
            // L-shaped / stepped low block
            const cx = Math.floor(nx / 2);
            for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) if (x >= cx && z < Math.floor(nz / 2)) heights[x + z * nx] = Math.max(2, Math.round(floors * 0.5));
          }
          const pal = PALETTES[type][Math.floor(rng() * PALETTES[type].length)];
          const style = { ...pal, type, win: WIN[type], seed: rng() * 100 };
          const b = new Building(ctx, {
            id: id++,
            x0: lot.x + inset + (w - nx * S) / 2,
            z0: lot.z + inset + (d - nz * S) / 2,
            nx, nz, heights, style,
            occupants: Math.round(nx * nz * floors * 0.08),
          });
          this.buildings.push(b);
          this.totalCells += b.totalCells;
          this._roofProps(b, rng);
          this._facadeProps(b, rng);
        }
      }
    }
    for (const b of this.buildings) b.buildColliders();
  }

  // Fire escapes, balconies and shop-front light: details bolted to individual facade cells, so
  // they fall off when their cell is smashed and ride along with collapsing sections.
  _facadeProps(b, rng) {
    const props = this.ctx.props;
    const t = b.style.type;
    const faces = [
      { nx: 1, nz: 0, bit: 1 }, { nx: -1, nz: 0, bit: 2 }, { nx: 0, nz: 1, bit: 16 }, { nx: 0, nz: -1, bit: 32 },
    ];
    const along = (f) => (f.nx !== 0 ? b.nz : b.nx);
    const cellOn = (f, k, y) => {
      if (f.nx !== 0) return b.idx(f.nx > 0 ? b.nx - 1 : 0, y, k);
      return b.idx(k, y, f.nz > 0 ? b.nz - 1 : 0);
    };
    const place = (type, f, k, y, out, scale = 1) => {
      const i = cellOn(f, k, y);
      if (!b.exists[i] || !(b.mask[i] & f.bit)) return;
      const [x, , z] = b.coords(i);
      let lx = (x + 0.5) * S, lz = (z + 0.5) * S;
      if (f.nx !== 0) lx = f.nx > 0 ? (x + 1) * S + out : x * S - out;
      else lz = f.nz > 0 ? (z + 1) * S + out : z * S - out;
      props.addRoof(type, b, i, lx, y * H + 0.15, lz, Math.atan2(f.nx, f.nz), scale);
    };
    if (t === STYLES.BRICK) {
      // a fire-escape stack on one or two faces
      const pickF = faces.filter(() => rng() < 0.5).slice(0, 2);
      if (!pickF.length) pickF.push(faces[Math.floor(rng() * 4)]);
      for (const f of pickF) {
        const n = along(f);
        const k0 = Math.floor(rng() * Math.max(1, n - 1));
        for (const k of [k0, k0 + 1 < n ? k0 + 1 : k0]) {
          if (k === k0 && k0 + 1 < n && rng() < 0.4) continue;
          for (let y = 1; y < b.ny - 1; y++) place('fireescape', f, k, y, 0.05);
          break;
        }
      }
    }
    if (t === STYLES.BRICK || t === STYLES.SHOP || (t === STYLES.RIBBON && rng() < 0.4)) {
      for (const f of faces) {
        for (let k = 0; k < along(f); k++) for (let y = 1; y < b.ny - 1; y++) {
          if (rng() < 0.09) place('balcony', f, k, y, 0.02);
        }
      }
    }
    // light from shop fronts and lobbies spills onto the sidewalk (dies with the cell's power)
    for (const f of faces) {
      for (let k = 0; k < along(f); k += 2) {
        const i = cellOn(f, k, 0);
        if (!b.exists[i] || !(b.mask[i] & f.bit)) continue;
        const [x, , z] = b.coords(i);
        let wx = b.x0 + (x + 0.5) * S, wz = b.z0 + (z + 0.5) * S;
        wx += f.nx * (S * 0.5 + 3); wz += f.nz * (S * 0.5 + 3);
        const col = [0xffc98a, 0xbfd9ff, 0xffe2b8, 0xff8fb0, 0x9effe0][Math.floor(rng() * 5)];
        const src = this.ctx.lights.addStatic(wx, wz, col, t === STYLES.SHOP ? 0.4 : 0.26, 8);
        this.shopLights.push({ src, b, i });
      }
    }
  }

  _roofProps(b, rng) {
    const props = this.ctx.props;
    const t = b.style.type;
    // find top cells (cells whose top face is exterior) on the highest tier
    const tops = [];
    for (let z = 0; z < b.nz; z++) for (let x = 0; x < b.nx; x++) {
      const h = b.heights[x + z * b.nx];
      tops.push({ x, z, h, i: b.idx(x, h - 1, z) });
    }
    const maxH = Math.max(...tops.map((t) => t.h));
    const high = tops.filter((t) => t.h === maxH);
    const interior = high.filter((c) => c.x > 0 && c.z > 0 && c.x < b.nx - 1 && c.z < b.nz - 1);
    const pool = interior.length ? interior : high;
    const pickCell = () => pool[Math.floor(rng() * pool.length)];
    const place = (type, scale = 1, rot = Math.floor(rng() * 4) * Math.PI / 2) => {
      const c = pickCell();
      props.addRoof(type, b, c.i, (c.x + 0.5) * S, c.h * H, (c.z + 0.5) * S, rot, scale);
    };
    const nAC = Math.min(4, 1 + Math.floor(pool.length / 6));
    for (let k = 0; k < nAC; k++) place('ac', 0.9 + rng() * 0.3);
    if (t === STYLES.BRICK && rng() < 0.85) place('watertower', 0.9 + rng() * 0.3);
    if ((t === STYLES.GLASS || t === STYLES.DECO) && maxH >= 15 && rng() < 0.7) place('antenna', 0.8 + rng() * 0.6);
    if (t === STYLES.GLASS && pool.length >= 9 && rng() < 0.5) {
      const c = pool[Math.floor(pool.length / 2)];
      props.addRoof('helipad', b, c.i, (c.x + 0.5) * S, c.h * H, (c.z + 0.5) * S, 0, 1);
    }
    if (t === STYLES.SHOP && rng() < 0.6) place('billboard', 1, rng() < 0.5 ? 0 : Math.PI / 2);
    if (t !== STYLES.SHOP && rng() < 0.6) place('stairhouse', 1);
    // lower tiers get some AC too
    const low = tops.filter((t) => t.h < maxH);
    for (let k = 0; k < Math.min(3, Math.floor(low.length / 8)); k++) {
      const c = low[Math.floor(rng() * low.length)];
      props.addRoof('ac', b, c.i, (c.x + 0.5) * S, c.h * H, (c.z + 0.5) * S, Math.floor(rng() * 4) * Math.PI / 2, 0.9);
    }
  }

  _park(x0, z0, bs) {
    const ctx = this.ctx;
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(bs - 4, bs - 4).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x2f5a1c, roughness: 1 }),
    );
    grass.position.set(x0 + bs / 2, 0.05, z0 + bs / 2);
    grass.receiveShadow = true;
    ctx.root.add(grass);
    const path = new THREE.Mesh(
      new THREE.RingGeometry(10, 13, 32).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x9b917f, roughness: 1 }),
    );
    path.position.set(x0 + bs / 2, 0.08, z0 + bs / 2);
    path.receiveShadow = true;
    ctx.root.add(path);
    const fountain = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5.5, 1.2, 24),
      new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.8 }),
    );
    fountain.position.set(x0 + bs / 2, 0.6, z0 + bs / 2);
    fountain.castShadow = fountain.receiveShadow = true;
    ctx.root.add(fountain);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(4.6, 24).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3d6b80, roughness: 0.05, metalness: 0.6 }),
    );
    water.position.set(x0 + bs / 2, 1.15, z0 + bs / 2);
    ctx.root.add(water);
    for (let k = 0; k < 26; k++) {
      const a = this.rng() * Math.PI * 2, r = 16 + this.rng() * 12;
      ctx.props.addStreet('tree', x0 + bs / 2 + Math.cos(a) * r, z0 + bs / 2 + Math.sin(a) * r, this.rng() * 6, 0.9 + this.rng() * 0.5);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.props.addStreet('bench', x0 + bs / 2 + Math.cos(a) * 14.5, z0 + bs / 2 + Math.sin(a) * 14.5, -a + Math.PI / 2, 1);
    }
    this.parks.push({ x0, z0, size: bs });
  }

  // Non-destructible background city for depth on the horizon.
  _skyline() {
    const rng = this.rng;
    const style = { ...PALETTES[STYLES.RIBBON][0], type: STYLES.RIBBON, win: WIN[STYLES.RIBBON], seed: 3 };
    const styles = [STYLES.GLASS, STYLES.RIBBON, STYLES.DECO, STYLES.BRICK];
    const groups = styles.map((t) => {
      const pal = PALETTES[t][0];
      return { t, mat: createBuildingMaterial({ ...pal, type: t, win: WIN[t], seed: rng() * 50 }), items: [] };
    });
    void style;
    for (let k = 0; k < 340; k++) {
      const a = rng() * Math.PI * 2;
      const r = 250 + Math.pow(rng(), 0.7) * 520;
      let x = Math.cos(a) * r, z = Math.sin(a) * r;
      // keep the approach roads clear
      const near = (v) => { const rc = (v + HALF - 11) / PITCH; return Math.abs((rc - Math.round(rc)) * PITCH) < 16; };
      if (near(x) || near(z)) continue;
      const w = 16 + Math.floor(rng() * 6) * 4, d = 16 + Math.floor(rng() * 6) * 4;
      const fl = Math.round(4 + rng() * rng() * 36 * (1 - (r - 250) / 900));
      const gi = fl > 18 ? (rng() < 0.6 ? 0 : 2) : fl > 8 ? 1 : 3;
      groups[gi].items.push({ x, z, w, d, h: fl * H });
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const g of groups) {
      if (!g.items.length) continue;
      const geo = box.clone();
      const info = new Float32Array(g.items.length * 3);
      const mesh = new THREE.InstancedMesh(geo, g.mat, g.items.length);
      const m = new THREE.Matrix4();
      g.items.forEach((it, i) => {
        m.compose(new THREE.Vector3(it.x, it.h / 2, it.z), new THREE.Quaternion(), new THREE.Vector3(it.w, it.h, it.d));
        mesh.setMatrixAt(i, m);
        info[i * 3] = 1 | 2 | 4 | 16 | 32;
        info[i * 3 + 1] = 0;
        info[i * 3 + 2] = Math.random();
      });
      geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 3));
      geo.setAttribute('aPow', new THREE.InstancedBufferAttribute(new Float32Array(g.items.length).fill(1), 1));
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.ctx.root.add(mesh);
    }
    // distant hills
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x46583c, roughness: 1, flatShading: true });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rng() * 0.3;
      const r = 1050 + rng() * 150;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(160 + rng() * 140, 70 + rng() * 110, 7), hillMat);
      hill.position.set(Math.cos(a) * r, 20, Math.sin(a) * r);
      hill.rotation.y = rng() * 6;
      this.ctx.root.add(hill);
    }
  }

  // ---------- street furniture ----------
  populateStreets() {
    const props = this.ctx.props;
    const rng = this.rng;
    const ext = HALF;
    for (const c of ROAD_CENTERS) {
      for (let t = -ext + 14; t < ext - 10; t += 21) {
        if (this._nearIntersection(t, 14)) continue;
        // lamps on both sidewalks of vertical (along-z) road at x=c
        props.addStreet('lamp', c - 8.6, t, Math.PI / 2, 1);
        props.addStreet('lamp', c + 8.6, t + 10, -Math.PI / 2, 1);
        props.addStreet('lamp', t, c - 8.6, 0, 1);
        props.addStreet('lamp', t + 10, c + 8.6, Math.PI, 1);
      }
      for (let t = -ext + 26; t < ext - 10; t += 43) {
        if (this._nearIntersection(t, 18)) continue;
        if (rng() < 0.45) props.addStreet('busstop', c + 9.6, t + 5, -Math.PI / 2, 1);
        if (rng() < 0.45) props.addStreet('busstop', t + 5, c - 9.6, 0, 1);
      }
      for (let t = -ext + 17; t < ext - 10; t += 19) {
        if (this._nearIntersection(t, 13)) continue;
        if (rng() < 0.6) props.addStreet('trashcan', c - 8.2, t + 2, 0, 1);
        if (rng() < 0.6) props.addStreet('trashcan', t + 2, c + 8.2, 0, 1);
      }
      for (let t = -ext + 20; t < ext - 10; t += 15) {
        if (this._nearIntersection(t, 16)) continue;
        if (rng() < 0.55) props.addStreet('tree', c + (rng() < 0.5 ? -9.8 : 9.8), t + rng() * 4, rng() * 6, 0.8 + rng() * 0.3);
        if (rng() < 0.55) props.addStreet('tree', t + rng() * 4, c + (rng() < 0.5 ? -9.8 : 9.8), rng() * 6, 0.8 + rng() * 0.3);
        if (rng() < 0.12) props.addStreet('hydrant', c + 8, t + 3, 0, 1);
        if (rng() < 0.1) props.addStreet('bench', t + 2, c - 9.8, 0, 1);
      }
    }
    // traffic signals at intersections
    for (const cx of ROAD_CENTERS) for (const cz of ROAD_CENTERS) {
      props.addStreet('signal', cx + 8.5, cz + 8.5, Math.PI, 1);
      props.addStreet('signal', cx - 8.5, cz - 8.5, 0, 1);
    }
  }

  _nearIntersection(t, r) {
    for (const c of ROAD_CENTERS) if (Math.abs(t - c) < r) return true;
    return false;
  }

  // ---------- queries ----------
  buildingsNear(x, z, r) {
    const out = [];
    for (const b of this.buildings) {
      if (x + r < b.x0 || x - r > b.x0 + b.width || z + r < b.z0 || z - r > b.z0 + b.depth) continue;
      out.push(b);
    }
    return out;
  }

  cellQuery(x, y, z, exclude = null) {
    for (const b of this.buildings) {
      if (b === exclude) continue;
      if (x < b.x0 || x > b.x0 + b.width || z < b.z0 || z > b.z0 + b.depth || y > b.height || y < 0) continue;
      const i = b.cellAt(x, y, z);
      if (i >= 0 && b.alive[i]) return { b, i };
    }
    return null;
  }

  solidAt(x, y, z) { return !!this.cellQuery(x, y, z); }

  // Highest surface (roof, broken floor, rubble or street) at or below maxY.
  groundAt(x, z, maxY) {
    let g = this.ctx.rubble.heightAt(x, z) * 0.7;
    for (const b of this.buildings) {
      if (!b.inFootprint(x, z)) continue;
      const s = b.supportAt(x, z, maxY);
      if (s > g) g = s;
    }
    return g;
  }

  damageSphere(p, radius, amount, dir, opts = {}) {
    const total = { destroyed: 0, damaged: 0, ground: 0, glass: 0, buildings: [] };
    for (const b of this.buildingsNear(p.x, p.z, radius)) {
      const r = b.damageSphere(p, radius, amount, dir, opts);
      if (r.destroyed || r.damaged) total.buildings.push(b);
      total.destroyed += r.destroyed;
      total.damaged += r.damaged;
      total.ground += r.ground;
      total.glass += r.glass;
    }
    if (total.destroyed || total.damaged) {
      this.ctx.events.emit('buildingHit', { p: p.clone(), result: total, opts });
    }
    return total;
  }

  // March a ray through the city; returns hit distance or -1.
  raycast(origin, dir, maxDist, step = 1.5) {
    const cands = [];
    for (const b of this.buildings) cands.push(b);
    for (let t = 0; t <= maxDist; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < 0) return t;
      for (const b of cands) {
        if (x < b.x0 || x > b.x0 + b.width || z < b.z0 || z > b.z0 + b.depth || y > b.height) continue;
        if (b.solidAt(x, y, z)) return t;
      }
    }
    return -1;
  }

  // Ground scars: burn (explosions), cracks (stomps), dust (collapses).
  scar(x, z, radius, burn = 0, crack = 0, dust = 0) {
    const size = this.scorchSize;
    const cx = Math.floor(x + 256), cz = Math.floor(z + 256);
    const r = Math.ceil(radius);
    for (let j = cz - r; j <= cz + r; j++) for (let i = cx - r; i <= cx + r; i++) {
      if (i < 0 || j < 0 || i >= size || j >= size) continue;
      const d = Math.hypot(i - cx, j - cz) / radius;
      if (d > 1) continue;
      const f = (1 - d) * (0.6 + Math.random() * 0.4);
      const k = (j * size + i) * 4;
      this.scorchData[k] = Math.min(255, this.scorchData[k] + burn * f * 255);
      this.scorchData[k + 1] = Math.min(255, this.scorchData[k + 1] + crack * f * 255);
      this.scorchData[k + 2] = Math.min(255, this.scorchData[k + 2] + dust * f * 255);
    }
    this.scorchDirty = true;
  }

  get destroyedPercent() {
    let d = 0;
    for (const b of this.buildings) d += Math.min(b.destroyedCells, b.totalCells);
    return (d / this.totalCells) * 100;
  }

  // Victory: power fails across the city in a rolling wave outward from the monster.
  blackoutWave(origin) {
    this.wave = { t: 0 };
    for (const b of this.buildings) b.blackoutDelay = Math.hypot(b.cx - origin.x, b.cz - origin.z) / 70 + Math.random() * 0.6;
    this.waveLamps = this.ctx.props.types.lamp.items.filter((it) => it.alive).map((it) => ({ it, d: Math.hypot(it.x - origin.x, it.z - origin.z) / 85 + Math.random() * 0.4 }));
  }

  update(dt) {
    for (const b of this.buildings) b.update(dt);
    if (this.wave) {
      this.wave.t += dt;
      for (const b of this.buildings) {
        if (b.blackoutDelay !== undefined && b.blackoutDelay <= this.wave.t && b.blackout === -1) b.blackout = b.ny - 1;
      }
      for (const l of this.waveLamps) {
        if (l.it.alive && !l.out && l.d <= this.wave.t) { l.out = true; this.ctx.props.lampOutQuiet(l.it); }
      }
    }
    this.shopCheck -= dt;
    if (this.shopCheck <= 0) {
      this.shopCheck = 0.3;
      for (const s of this.shopLights) {
        if (s.src.on > 0 && (!s.b.alive[s.i] || s.b.power[s.i] < 0.3)) this.ctx.lights.setOn(s.src, 0);
      }
    }
    this.scorchTimer -= dt;
    if (this.scorchDirty && this.scorchTimer <= 0) {
      this.scorchTex.needsUpdate = true;
      this.scorchDirty = false;
      this.scorchTimer = 0.2;
    }
  }
}
