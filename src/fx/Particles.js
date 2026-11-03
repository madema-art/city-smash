import * as THREE from 'three';

// CPU-simulated, GPU-instanced billboard particles. One draw call per blend mode.
// Used for dust, smoke, fire, sparks and flashes.

function makePuffTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  // Layered value noise to give the puff a billowy edge instead of a perfect disc.
  const rnd = (x, y) => {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi), b = rnd(xi + 1, yi), cc = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      let n = 0, a = 0.5, f = 4;
      for (let o = 0; o < 4; o++) { n += a * vnoise(x / s * f, y / s * f); a *= 0.5; f *= 2; }
      const fall = Math.max(0, 1 - r);
      const alpha = Math.max(0, Math.min(1, fall * fall * (0.55 + n * 0.9) * 1.25 - 0.05));
      const shade = 0.78 + 0.22 * n - dy * 0.25; // lighter on top
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, shade * 255);
      img.data[i + 3] = alpha * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let puffTex = null;

export class ParticleSystem {
  constructor(scene, capacity, additive) {
    if (!puffTex) puffTex = makePuffTexture();
    this.cap = capacity;
    this.count = 0;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.sr = new Float32Array(capacity * 2); // size, rotation
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(this.sr, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iSR', this.aSR);
    geo.instanceCount = 0;

    // Simulation state
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.rotVel = new Float32Array(capacity);
    this.rgb = new Float32Array(capacity * 3);
    this.fadeIn = new Float32Array(capacity);
    this.colorShift = new Float32Array(capacity); // fire -> smoke darkening rate

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: puffTex },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 },
      },
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSR;
        varying vec2 vUv; varying vec4 vCol; varying float vFogDepth;
        void main(){
          vUv = uv; vCol = iCol;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iSR.y), s = sin(iSR.y);
          vec2 p = vec2(c*position.x - s*position.y, s*position.x + c*position.y) * iSR.x;
          mv.xy += p;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity;
        varying vec2 vUv; varying vec4 vCol; varying float vFogDepth;
        void main(){
          vec4 t = texture2D(map, vUv);
          vec4 c = vec4(vCol.rgb * t.rgb, vCol.a * t.a);
          c.a *= smoothstep(4.0, 26.0, vFogDepth); // never let a puff fill the lens
          ${additive ? '' : 'float f = 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth); c.rgb = mix(c.rgb, fogColor, f);'}
          if (c.a < 0.004) discard;
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
    this.geo = geo;
    scene.add(this.mesh);
    this.additive = additive;
  }

  emit(x, y, z, vx, vy, vz, size, life, r, g, b, a, opts = {}) {
    let i;
    if (this.count < this.cap) i = this.count++;
    else i = Math.floor(Math.random() * this.cap); // overwrite a random live particle under pressure
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.grow[i] = opts.grow ?? 1.0;
    this.alpha0[i] = a;
    this.drag[i] = opts.drag ?? 1.0;
    this.grav[i] = opts.gravity ?? 0;
    this.rotVel[i] = opts.rotVel ?? (Math.random() - 0.5) * 0.6;
    this.sr[i * 2 + 1] = Math.random() * Math.PI * 2;
    this.rgb[i3] = r; this.rgb[i3 + 1] = g; this.rgb[i3 + 2] = b;
    this.fadeIn[i] = opts.fadeIn ?? 0.08;
    this.colorShift[i] = opts.colorShift ?? 0;
    return i;
  }

  update(dt, fog) {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
    }
    // compact dead particles
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] < this.maxLife[i]) {
        if (w !== i) this._move(i, w);
        w++;
      }
    }
    this.count = w;
    for (let i = 0; i < w; i++) {
      const i3 = i * 3;
      const t = this.life[i] / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.3 && this.grav[i] < 0) { this.pos[i3 + 1] = 0.3; this.vel[i3 + 1] *= -0.2; }
      const size = this.size0[i] * (1 + this.grow[i] * Math.sqrt(t) * 2.0);
      this.sr[i * 2] = size;
      this.sr[i * 2 + 1] += this.rotVel[i] * dt;
      const fi = Math.min(1, this.life[i] / Math.max(0.001, this.fadeIn[i]));
      const fo = 1 - t;
      const a = this.alpha0[i] * fi * fo * (this.additive ? fo : 1);
      const cs = Math.max(0, 1 - this.colorShift[i] * t);
      this.col[i * 4] = this.rgb[i3] * cs;
      this.col[i * 4 + 1] = this.rgb[i3 + 1] * cs;
      this.col[i * 4 + 2] = this.rgb[i3 + 2] * cs;
      this.col[i * 4 + 3] = a;
    }
    this.geo.instanceCount = w;
    if (w > 0) {
      this.aPos.addUpdateRange(0, w * 3); this.aPos.needsUpdate = true;
      this.aCol.addUpdateRange(0, w * 4); this.aCol.needsUpdate = true;
      this.aSR.addUpdateRange(0, w * 2); this.aSR.needsUpdate = true;
    }
    if (fog) {
      this.material.uniforms.fogColor.value.copy(fog.color);
      this.material.uniforms.fogDensity.value = fog.density;
    }
  }

  _move(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.rgb[t3 + k] = this.rgb[f3 + k];
    }
    this.sr[to * 2] = this.sr[from * 2];
    this.sr[to * 2 + 1] = this.sr[from * 2 + 1];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.grow[to] = this.grow[from];
    this.alpha0[to] = this.alpha0[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
    this.rotVel[to] = this.rotVel[from];
    this.fadeIn[to] = this.fadeIn[from];
    this.colorShift[to] = this.colorShift[from];
  }

  clear() { this.count = 0; this.geo.instanceCount = 0; }
}
