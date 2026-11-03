import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { QUALITY } from '../config.js';

// Lighting look. Everything that sets the "mood" of the daylight lives here so it can be tuned
// in one place. Values are in linear, physically-based units (three r155+ light intensities).
export const LOOK = {
  exposure: 1.0,
  toneMapping: THREE.AgXToneMapping,
  sun: { color: 0xfff1dc, intensity: 3.4, elevation: 36, azimuth: 222 },
  hemi: { sky: 0x9cbcf0, ground: 0x6a5642, intensity: 0.42 },
  env: 0.5, // sky-environment contribution (diffuse + specular)
  sky: { turbidity: 2.6, rayleigh: 1.55, mie: 0.0035, mieG: 0.82 },
  skyScale: 0.55,
  clouds: 0.45,
  haze: 0x8eaac8,
  fog: 0.00095,
  saturation: 1.12,
  contrast: 1.06,
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
    r.toneMapping = tm === 'aces' ? THREE.ACESFilmicToneMapping : tm === 'neutral' ? THREE.NeutralToneMapping : LOOK.toneMapping;
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
    const sky = new Sky();
    sky.scale.setScalar(2400);
    sky.userData.noAO = true;
    const u = sky.material.uniforms;
    u.turbidity.value = LOOK.sky.turbidity;
    u.rayleigh.value = LOOK.sky.rayleigh;
    u.mieCoefficient.value = LOOK.sky.mie;
    u.mieDirectionalG.value = LOOK.sky.mieG;
    u.cloudCoverage.value = LOOK.clouds;
    u.cloudDensity.value = 0.55;
    // Afternoon sun: long, readable shadows down the avenues.
    const phi = THREE.MathUtils.degToRad(90 - LOOK.sun.elevation);
    const theta = THREE.MathUtils.degToRad(LOOK.sun.azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    // The Sky shader is far brighter than the lit city; scale it into the same range so the
    // horizon doesn't glow white and wash everything out through bloom.
    sky.material.onBeforeCompile = (sh) => {
      sh.fragmentShader = '#define SKY_K ' + LOOK.skyScale.toFixed(3) + '\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * SKY_K, 1.0 );');
    };
    this.sky = sky;
    this.scene.add(sky);

    // Pre-filtered environment for glass reflections and ambient specular.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyClone = new Sky();
    skyClone.scale.setScalar(1000);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) skyClone.material.uniforms[k].value = u[k].value;
    skyClone.material.uniforms.sunPosition.value.copy(this.sunDir);
    skyClone.material.onBeforeCompile = sky.material.onBeforeCompile;
    envScene.add(skyClone);
    // Reflections see a city-coloured lower hemisphere instead of more sky.
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2a2c30, side: THREE.BackSide }),
    );
    ground.position.y = -2;
    envScene.add(ground);
    // a few dark "buildings" on the horizon so glass reflects a skyline, not a blank sky
    const boxMat = new THREE.MeshBasicMaterial({ color: 0x3b4350 });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const h = 40 + ((i * 37) % 9) * 22;
      const m = new THREE.Mesh(new THREE.BoxGeometry(70, h * 2, 70), boxMat);
      m.position.set(Math.cos(a) * 520, 0, Math.sin(a) * 520);
      m.lookAt(0, 0, 0);
      envScene.add(m);
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

    const sun = new THREE.DirectionalLight(LOOK.sun.color, LOOK.sun.intensity);
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
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.38, 0.45, 2.4);
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
    this.sky.material.uniforms.time.value += dt;
    this.composer.render(dt);
  }
}
