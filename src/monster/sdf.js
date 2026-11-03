// Signed-distance sculpting toolkit: primitives, smooth booleans, surface-nets meshing.
// Used to build organic, watertight creature meshes procedurally (no external assets).

export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

// Rotate a point by inverse quaternion (q given as [x,y,z,w]).
function invRot(q, x, y, z, out) {
  const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

const tmp = [0, 0, 0];

export function sdEllipsoid(px, py, pz, p) {
  let x = px - p.c[0], y = py - p.c[1], z = pz - p.c[2];
  if (p.q) { invRot(p.q, x, y, z, tmp); x = tmp[0]; y = tmp[1]; z = tmp[2]; }
  const rx = p.r[0], ry = p.r[1], rz = p.r[2];
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

// iq's round cone between two arbitrary points
export function sdRoundCone(px, py, pz, p) {
  const a = p.a, b = p.b, r1 = p.r1, r2 = p.r2;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xvx = pax * l2 - bax * y, xvy = pay * l2 - bay * y, xvz = paz * l2 - baz * y;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

export function primDist(p, x, y, z) {
  return p.type === 'cone' ? sdRoundCone(x, y, z, p) : sdEllipsoid(x, y, z, p);
}

export function primBounds(p) {
  const m = p.k + 0.01;
  if (p.type === 'cone') {
    const r = Math.max(p.r1, p.r2) + m;
    return [
      Math.min(p.a[0], p.b[0]) - r, Math.min(p.a[1], p.b[1]) - r, Math.min(p.a[2], p.b[2]) - r,
      Math.max(p.a[0], p.b[0]) + r, Math.max(p.a[1], p.b[1]) + r, Math.max(p.a[2], p.b[2]) + r,
    ];
  }
  const r = Math.max(p.r[0], p.r[1], p.r[2]) + m;
  return [p.c[0] - r, p.c[1] - r, p.c[2] - r, p.c[0] + r, p.c[1] + r, p.c[2] + r];
}

// Rasterize grouped primitives into a scalar field. Each group is blended internally with
// per-primitive k, then groups are merged with group-level k (keeps limbs from webbing to torso).
export function buildField(groups, groupK, bounds, h) {
  const [x0, y0, z0, x1, y1, z1] = bounds;
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  const N = nx * ny * nz;
  const FAR = 1.0;
  const out = new Float32Array(N).fill(FAR);
  const gf = new Float32Array(N);
  for (const g of groups) {
    gf.fill(FAR);
    const adds = g.prims.filter((p) => !p.sub);
    const subs = g.prims.filter((p) => p.sub);
    for (const p of adds) rasterPrim(p, gf, false);
    for (const p of subs) rasterPrim(p, gf, true);
    const k = groupK[g.name] ?? 0.04;
    for (let i = 0; i < N; i++) {
      const a = out[i], b = gf[i];
      if (b >= FAR && a >= FAR) continue;
      out[i] = smin(a, b, k);
    }
  }
  function rasterPrim(p, field, sub) {
    const bb = primBounds(p);
    const i0 = Math.max(0, Math.floor((bb[0] - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((bb[3] - x0) / h));
    const j0 = Math.max(0, Math.floor((bb[1] - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((bb[4] - y0) / h));
    const k0 = Math.max(0, Math.floor((bb[2] - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((bb[5] - z0) / h));
    for (let k = k0; k <= k1; k++) {
      const z = z0 + k * h;
      for (let j = j0; j <= j1; j++) {
        const y = y0 + j * h;
        let idx = i0 + nx * (j + ny * k);
        for (let i = i0; i <= i1; i++, idx++) {
          const x = x0 + i * h;
          const d = primDist(p, x, y, z);
          field[idx] = sub ? smax(field[idx], -d, p.k) : smin(field[idx], d, p.k);
        }
      }
    }
  }
  return { field: out, nx, ny, nz, x0, y0, z0, h };
}

// Naive surface nets: one vertex per sign-changing cell, quads across sign-changing edges.
export function surfaceNets(F) {
  const { field, nx, ny, nz, x0, y0, z0, h } = F;
  const at = (i, j, k) => field[i + nx * (j + ny * k)];
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const [a, b, d] = corners[c];
      v[c] = at(i + a, j + b, k + d);
      if (v[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [e0, e1] of edges) {
      const a = v[e0], b = v[e1];
      if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b);
      const c0 = corners[e0], c1 = corners[e1];
      sx += c0[0] + (c1[0] - c0[0]) * t;
      sy += c0[1] + (c1[1] - c0[1]) * t;
      sz += c0[2] + (c1[2] - c0[2]) * t;
      cnt++;
    }
    cellVert[cidx(i, j, k)] = pos.length / 3;
    pos.push(x0 + (i + sx / cnt) * h, y0 + (j + sy / cnt) * h, z0 + (k + sz / cnt) * h);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s = at(i, j, k) < 0;
    // x edge
    if (i < nx - 1 && s !== (at(i + 1, j, k) < 0)) {
      quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], s);
    }
    if (j < ny - 1 && s !== (at(i, j + 1, k) < 0)) {
      quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], s);
    }
    if (k < nz - 1 && s !== (at(i, j, k + 1) < 0)) {
      quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], s);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
