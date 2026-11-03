import * as THREE from 'three';

// Searchlights: visible light shafts through the night haze plus a small pool of real spotlights.
// Helicopters hunt the monster with their lights from response level 2; at level 4+ ground
// batteries on the outskirts sweep the sky, and at level 5+ some of them lock onto him.

const beamGeo = (() => {
  const g = new THREE.CylinderGeometry(0.03, 1, 1, 28, 1, true);
  g.translate(0, -0.5, 0); // apex at origin, base at y = -1
  return g;
})();

function beamMaterial(color, intensity) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: intensity } },
    vertexShader: /* glsl */`
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main(){
        vAlong = -position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uI;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main(){
        float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = uI * core * pow(1.0 - vAlong, 1.3) * smoothstep(0.0, 0.04, vAlong);
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Searchlights {
  constructor(ctx) {
    this.ctx = ctx;
    this.beams = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(beamGeo, beamMaterial(0xdfe8ff, 0.12));
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 12;
      m.userData.noAO = true;
      ctx.root.add(m);
      this.beams.push(m);
    }
    this.spots = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.SpotLight(0xe8eeff, 0, 0, 0.12, 0.55, 2);
      s.castShadow = false;
      ctx.root.add(s);
      ctx.root.add(s.target);
      this.spots.push(s);
    }
    this.t = 0;
    this.ground = [
      { x: -260, z: -240 }, { x: 250, z: -260 }, { x: 270, z: 230 }, { x: -240, z: 260 },
    ];
  }

  _aim(beam, from, to, radius, intensity) {
    _d.copy(to).sub(from);
    const len = _d.length();
    _d.divideScalar(len);
    _q.setFromUnitVectors(DOWN, _d);
    beam.position.copy(from);
    beam.quaternion.copy(_q);
    beam.scale.set(radius, len, radius);
    beam.material.uniforms.uI.value = intensity;
    beam.visible = true;
  }

  update(dt) {
    const ctx = this.ctx;
    const g = ctx.gorilla;
    const lvl = ctx.military.level;
    this.t += dt;
    for (const b of this.beams) b.visible = false;
    for (const s of this.spots) s.intensity = 0;
    let bi = 0, si = 0;
    const chest = new THREE.Vector3(g.pos.x, g.pos.y + 9, g.pos.z);
    // helicopters
    if (lvl >= 2 || ctx.military.ceaseFire) {
      const helis = ctx.military.helis.filter((h) => h.state === 'fly' && !h.held)
        .sort((a, b) => Math.hypot(a.x - g.pos.x, a.z - g.pos.z) - Math.hypot(b.x - g.pos.x, b.z - g.pos.z));
      for (const h of helis.slice(0, 4)) {
        const from = new THREE.Vector3(h.x + Math.sin(h.yaw) * 2.5, h.y - 1.2, h.z + Math.cos(h.yaw) * 2.5);
        // the beam hunts: it wanders around the monster and settles on him
        const k = h.t * 0.9 + h.band * 10;
        const to = chest.clone().add(new THREE.Vector3(Math.sin(k) * 7, Math.sin(k * 1.3) * 4 - 3, Math.cos(k * 0.8) * 7));
        if (bi < this.beams.length) this._aim(this.beams[bi++], from, to, 0.13 * from.distanceTo(to) / 1.0 * 0.12 + 2.2, 0.14);
        if (si < 2) {
          const s = this.spots[si++];
          s.position.copy(from);
          s.target.position.copy(to);
          s.target.updateMatrixWorld();
          s.intensity = 14000;
          s.angle = 0.16;
        }
        if (to.y < 6) ctx.lights.pulse(to.x, to.z, 0.5, 0.52, 0.6, 9);
        h.searchlight = true;
      }
    }
    // ground batteries on the outskirts
    if (lvl >= 4 && !ctx.military.retreat) {
      this.ground.forEach((gp, i) => {
        if (bi >= this.beams.length) return;
        const from = new THREE.Vector3(gp.x, 2, gp.z);
        let to;
        if (lvl >= 5 && i < 2 && !ctx.military.ceaseFire) {
          to = chest.clone().add(new THREE.Vector3(Math.sin(this.t * 0.7 + i) * 5, 0, Math.cos(this.t * 0.6 + i) * 5));
          if (si < 3) {
            const s = this.spots[si++];
            s.position.copy(from); s.target.position.copy(to); s.target.updateMatrixWorld();
            s.intensity = 60000; s.angle = 0.05;
          }
        } else {
          const a = this.t * (0.25 + i * 0.05) + i * 1.7;
          to = new THREE.Vector3(gp.x * 0.2 + Math.cos(a) * 160, 420, gp.z * 0.2 + Math.sin(a) * 160);
        }
        this._aim(this.beams[bi++], from, to, lvl >= 5 && i < 2 ? 0.05 * from.distanceTo(to) + 2 : 26, lvl >= 5 && i < 2 ? 0.1 : 0.07);
      });
    }
  }
}
