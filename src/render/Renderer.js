import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { QUALITY } from '../config.js';

// Lighting look: cinematic night. Values are linear, physically-based (three r155+ units).
// The moon gives silhouettes and long soft shadows; nearly everything else is lit by the city
// itself (windows, street lamps, signs, headlights, emergency lights, fires) via CityLights.
export const LOOK = {
  exposure: 1.15,
  toneMapping: THREE.ACESFilmicToneMapping,
  moon: { color: 0x8fa8ff, intensity: 0.55, elevation: 34, azimuth: 132 },
  hemi: { sky: 0x22325a, ground: 0x2a1c12, intensity: 0.22 },
  env: 0.45,
  haze: 0x0b1018,
  fog: 0.0019,
  saturation: 1.18,
  contrast: 1.08,
};

// Night sky dome: deep blue zenith, sodium-orange light pollution on the horizon, stars, a moon
// with a soft halo, and thin dark clouds lit from below by the city.
const NightSkyShader = {
  uniforms: { uMoon: { value: new THREE.Vector3() }, uTime: { value: 0 }, uGlow: { value: 1 } },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: /* glsl */`
    uniform vec3 uMoon; uniform float uTime; uniform float uGlow;
    varying vec3 vDir;
    float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
                 mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
    void main(){
      vec3 d = normalize(vDir);
      float y = d.y;
      vec3 zen = vec3(0.004, 0.008, 0.024);
      vec3 mid = vec3(0.012, 0.022, 0.05);
      vec3 hor = vec3(0.07, 0.06, 0.07);
      vec3 col = mix(mid, zen, smoothstep(0.05, 0.7, y));
      col = mix(hor, col, smoothstep(-0.02, 0.22, y));
      // light pollution: warm sodium glow hugging the horizon
      col += vec3(0.16, 0.085, 0.04) * exp(-max(y, 0.0) * 9.0) * uGlow;
      // stars (fade near the glowing horizon)
      vec3 sp = d * 420.0;
      float st = step(0.9965, h3(floor(sp)));
      float tw = 0.6 + 0.4 * sin(uTime * (2.0 + h3(floor(sp) + 3.1) * 4.0) + h3(floor(sp)) * 40.0);
      col += vec3(0.8, 0.85, 1.0) * st * tw * smoothstep(0.08, 0.45, y) * 0.9;
      // moon + halo
      float md = dot(d, normalize(uMoon));
      col += vec3(0.9, 0.95, 1.05) * smoothstep(0.99955, 0.99975, md) * 3.5;
      col += vec3(0.12, 0.15, 0.25) * pow(max(md, 0.0), 180.0) * 1.2 + vec3(0.03, 0.04, 0.07) * pow(max(md, 0.0), 12.0);
      // thin drifting clouds, dark blue with a warm underside from the city
      vec3 cp = vec3(d.xz / max(0.08, y) * 0.6 + uTime * 0.004, 0.0);
      float c = n3(cp * 1.3) * 0.6 + n3(cp * 3.1) * 0.3 + n3(cp * 7.0) * 0.1;
      float cm = smoothstep(0.55, 0.8, c) * smoothstep(0.02, 0.25, y);
      vec3 cc = mix(vec3(0.05, 0.035, 0.03), vec3(0.025, 0.03, 0.05), smoothstep(0.1, 0.6, y));
      col = mix(col, cc + vec3(0.06, 0.07, 0.1) * pow(max(md, 0.0), 30.0), cm * 0.85);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

// GTAO that skips particles, tracers, glass shards and the sky dome (they have no meaningful
// depth/normals and would otherwise stamp dark blotches into the occlusion buffer).
class CityAOPass extends GTAOPass {
  _renderOverride(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha) {
    const hidden = [];
    this.scene.traverseVisible((o) => { if (o.userData.noAO) hidden.push(o); });
    for (const o of hidden) o.visible = false;
    super._renderOverride(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha);
    for (const o of hidden) o.visible = true;
  }

  setSize(w, h) { super.setSize(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5))); }
}

// Owns the WebGL renderer, scene lighting, sky, fog and post-processing.
export class Renderer {
  constructor(container) {
    const params = new URLSearchParams(location.search);
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatioCap));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const tm = params.get('tm');
    r.toneMapping = tm === 'agx' ? THREE.AgXToneMapping : tm === 'neutral' ? THREE.NeutralToneMapping : LOOK.toneMapping;
    r.toneMappingExposure = parseFloat(params.get('exp') || LOOK.exposure);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.dom = r.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 2600);

    this.hazeColor = new THREE.Color(LOOK.haze);
    this.scene.fog = new THREE.FogExp2(this.hazeColor.clone(), LOOK.fog);
    this.scene.background = this.hazeColor.clone();

    this._setupSky();
    this._setupLights();
    this._setupPost(params);

    window.addEventListener('resize', () => this.resize());
  }

  _setupSky() {
    const phi = THREE.MathUtils.degToRad(90 - LOOK.moon.elevation);
    const theta = THREE.MathUtils.degToRad(LOOK.moon.azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta); // "sun" = the moon
    const mat = new THREE.ShaderMaterial({ ...NightSkyShader, uniforms: THREE.UniformsUtils.clone(NightSkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false });
    mat.uniforms.uMoon.value.copy(this.sunDir);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 48, 24), mat);
    sky.userData.noAO = true;
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    this.scene.add(sky);

    // Night environment for reflections: dark sky, horizon glow, and a ring of lit skyline so
    // glass towers reflect windows and signs rather than a blank sky.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({ ...NightSkyShader, uniforms: THREE.UniformsUtils.clone(NightSkyShader.uniforms), side: THREE.BackSide }));
    envSky.material.uniforms.uMoon.value.copy(this.sunDir);
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0c0b0b }));
    ground.position.y = -2;
    envScene.add(ground);
    const wall = new THREE.MeshBasicMaterial({ color: 0x07090d });
    const lit = [0xffc27a, 0xcfe3ff, 0xffe0b0, 0xff9a5a];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const h = 60 + ((i * 37) % 11) * 26;
      const m = new THREE.Mesh(new THREE.BoxGeometry(60, h * 2, 60), wall);
      m.position.set(Math.cos(a) * 480, 0, Math.sin(a) * 480);
      m.lookAt(0, 0, 0);
      envScene.add(m);
      // a few lit window bands
      for (let k = 0; k < 6; k++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(40, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(lit[(i + k) % 4]).multiplyScalar(0.8 + ((i * k) % 5) * 0.3) }));
        w.position.set(Math.cos(a) * 449, 8 + ((i * 13 + k * 29) % Math.max(10, h - 10)), Math.sin(a) * 449);
        w.lookAt(0, w.position.y, 0);
        envScene.add(w);
      }
    }
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = LOOK.env;
    pmrem.dispose();
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(LOOK.hemi.sky, LOOK.hemi.ground, LOOK.hemi.intensity);
    this.scene.add(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(LOOK.moon.color, LOOK.moon.intensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
    const s = 140;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 800;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.5;
    sun.shadow.radius = 2;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.shadowExtent = s;
  }

  _setupPost(params) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: QUALITY.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Ambient occlusion: contact shadows where buildings meet the street, in window recesses,
    // under cars and around the monster. Half resolution keeps it cheap.
    if (!QUALITY.low && params.get('ao') !== '0') {
      const ao = new CityAOPass(this.scene, this.camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: 5.5, distanceExponent: 1.4, thickness: 3, scale: 1.0, samples: 12, distanceFallOff: 0.6, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85;
      this.ao = ao;
      this.composer.addPass(ao);
    }
    if (QUALITY.bloom) {
      // Only genuinely hot pixels bloom: fire, explosions, tracers, sun glints.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.42, 0.38, 1.05);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    // Display-space grade (after tone mapping): saturation, gentle S-curve, vignette, damage flash.
    this.gradePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uDamage: { value: 0 },
        uVignette: { value: 0.28 },
        uSat: { value: LOOK.saturation },
        uContrast: { value: LOOK.contrast },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uDamage; uniform float uVignette; uniform float uSat; uniform float uContrast; uniform float uTime;
        varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSat);
          c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
          // warm highlights, slightly cool shadows
          c *= mix(vec3(0.97, 0.99, 1.03), vec3(1.03, 1.0, 0.96), smoothstep(0.25, 0.85, l));
          vec2 d = vUv - 0.5;
          float r = dot(d, d);
          c *= 1.0 - uVignette * smoothstep(0.1, 0.6, r);
          float edge = smoothstep(0.05, 0.5, r);
          c = mix(c, vec3(0.75, 0.05, 0.02), uDamage * edge * 0.75);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.composer.addPass(this.gradePass);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  // Keep the shadow frustum centred on the action, snapped to texels to avoid shimmering.
  updateShadowFocus(focus) {
    const sun = this.sun;
    const texel = (this.shadowExtent * 2) / sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    const fy = Math.round(focus.y / texel) * texel;
    sun.target.position.set(fx, fy, fz);
    sun.position.set(fx + this.sunDir.x * 400, fy + this.sunDir.y * 400, fz + this.sunDir.z * 400);
    sun.target.updateMatrixWorld();
  }

  render(dt) {
    this.gradePass.uniforms.uTime.value += dt;
    this.sky.material.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
