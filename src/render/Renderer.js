import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { QUALITY } from '../config.js';

// Owns the WebGL renderer, scene lighting, sky, fog and post-processing.
export class Renderer {
  constructor(container) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatioCap));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.88;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.dom = r.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 2600);

    this.hazeColor = new THREE.Color(0xb9c6d2);
    this.scene.fog = new THREE.FogExp2(this.hazeColor.clone(), 0.0021);
    this.scene.background = this.hazeColor.clone();

    this._setupSky();
    this._setupLights();
    this._setupPost();

    window.addEventListener('resize', () => this.resize());
  }

  _setupSky() {
    const sky = new Sky();
    sky.scale.setScalar(2400);
    const u = sky.material.uniforms;
    u.turbidity.value = 6.5;
    u.rayleigh.value = 1.35;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.86;
    // Late-afternoon sun: long dramatic shadows across the streets.
    const elevation = 31, azimuth = 218;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sky = sky;
    this.scene.add(sky);

    // Pre-filtered environment for glass reflections and ambient specular.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyClone = new Sky();
    skyClone.scale.setScalar(1000);
    Object.assign(skyClone.material.uniforms.turbidity, { value: u.turbidity.value });
    skyClone.material.uniforms.rayleigh.value = u.rayleigh.value;
    skyClone.material.uniforms.mieCoefficient.value = u.mieCoefficient.value;
    skyClone.material.uniforms.mieDirectionalG.value = u.mieDirectionalG.value;
    skyClone.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(skyClone);
    // A dim ground disc so reflections show a horizon line rather than sky below.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3a3d42 }),
    );
    ground.position.y = -5;
    envScene.add(ground);
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6b5f52, 0.9);
    this.scene.add(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(0xffe2bf, 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
    const s = 120;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.shadowExtent = s;
  }

  _setupPost() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: QUALITY.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (QUALITY.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
      this.composer.addPass(this.bloom);
    }
    // Grade + vignette + damage flash in one cheap pass.
    this.gradePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uDamage: { value: 0 },
        uVignette: { value: 0.32 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uDamage; uniform float uVignette; uniform float uTime;
        varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 d = vUv - 0.5;
          float r = dot(d, d);
          float vig = 1.0 - uVignette * smoothstep(0.08, 0.55, r);
          c.rgb *= vig;
          // Warm the highlights and cool the shadows slightly.
          float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 1.0, 0.95), smoothstep(0.4, 1.0, l));
          c.rgb = mix(c.rgb, c.rgb * vec3(0.95, 0.99, 1.05), 1.0 - smoothstep(0.0, 0.35, l));
          // Red pulse at the edges when the monster takes damage.
          float edge = smoothstep(0.05, 0.5, r);
          c.rgb = mix(c.rgb, vec3(0.75, 0.05, 0.02), uDamage * edge * 0.75);
          gl_FragColor = c;
        }`,
    });
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
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
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + this.sunDir.x * 350, this.sunDir.y * 350, fz + this.sunDir.z * 350);
    sun.target.updateMatrixWorld();
  }

  render(dt) {
    this.gradePass.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
