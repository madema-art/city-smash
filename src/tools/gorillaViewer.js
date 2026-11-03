import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { instantiateGorilla, buildGorillaGeometry } from '../monster/GorillaModel.js';
import { Pose, Poses, applyPose } from '../monster/GorillaAnimator.js';

// Dev tool: ?view=gorilla&poses=idle,walk:0.25,... renders posed gorillas side by side.
export function runGorillaViewer(params) {
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(innerWidth, innerHeight);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.shadowMap.enabled = true;
  document.getElementById('app').appendChild(r.domElement);
  document.getElementById('overlay').style.display = 'none';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb0bf);
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x554433, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.5);
  sun.position.set(3, 5, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 4, bottom: -2 });
  scene.add(sun);
  const pmrem = new THREE.PMREMGenerator(r);
  import('three/examples/jsm/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.4;
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x777777 }));
  floor.receiveShadow = true;
  scene.add(floor);
  const info = buildGorillaGeometry();
  console.log('gorilla', info.ms.toFixed(0) + 'ms', info.verts, 'verts', info.tris, 'tris');
  const list = (params.get('poses') || 'rest,idle,walk:0.25,run:0.3,punch:0.42,smash:0.3').split(',');
  const yaw = parseFloat(params.get('yaw') || '0.6');
  const spacing = 1.6;
  const items = [];
  list.forEach((spec, i) => {
    const [name, arg] = spec.split(':');
    const g = instantiateGorilla();
    g.group.position.x = (i - (list.length - 1) / 2) * spacing;
    g.group.rotation.y = yaw;
    scene.add(g.group);
    const p = new Pose();
    const t = parseFloat(arg || '0');
    const base = Poses.idle(new Pose(), 0);
    switch (name) {
      case 'rest': p.clear(); break;
      case 'idle': Poses.idle(p, t); break;
      case 'walk': Poses.walk(p, t); break;
      case 'run': Poses.run(p, t); break;
      case 'air': Poses.air(p, t); break;
      case 'land': Poses.land(p, t); break;
      case 'punch': Poses.punch(p, t, 'R', base); break;
      case 'smash': Poses.smash(p, t, base); break;
      case 'stomp': Poses.stomp(p, t, base); break;
      case 'roar': Poses.roar(p, t, base); break;
      case 'grab': Poses.grab(p, t, base); break;
      case 'eat': Poses.eat(p, t, Poses.hold(new Pose(), base)); break;
      case 'throw': Poses.throw(p, t, Poses.hold(new Pose(), base)); break;
      case 'climb': Poses.climb(p, t, 1); break;
      case 'chold': Poses.climb(p, 0, 0); break;
      case 'cpunch': Poses.climbPunch(p, t, 'R', Poses.climb(new Pose(), 0, 0), 0); break;
      case 'csmash': Poses.climbSmash(p, t, Poses.climb(new Pose(), 0, 0)); break;
      case 'ckick': Poses.climbKick(p, t, Poses.climb(new Pose(), 0, 0)); break;
      case 'cgrab': Poses.climbGrab(p, t, Poses.climb(new Pose(), 0, 0), 0.6, 0); break;
      case 'ceat': Poses.climbEat(p, t, Poses.climb(new Pose(), 0, 0)); break;
      case 'cswat': Poses.climbSwat(p, t, 'R', Poses.climb(new Pose(), 0, 0), 0.3); break;
      case 'mantle': Poses.mantle(p, t); break;
      case 'death': Poses.death(p, t); break;
    }
    applyPose(g.bones, p, g.rest);
    if (/^(c[a-z]+|climb|mantle)$/.test(name) && params.get('wall')) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.6), new THREE.MeshStandardMaterial({ color: 0x8899aa, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      wall.position.set(0, 1.2, 3.2 / 9.2);
      g.group.add(wall);
    }
    items.push(g);
  });
  const zoom = parseFloat(params.get('zoom') || '1');
  cam.position.set(0, 1.1, (list.length * spacing * 0.95 + 1.5) / zoom);
  const ctl = new OrbitControls(cam, r.domElement);
  ctl.target.set(0, params.get('ty') ? parseFloat(params.get('ty')) : 0.8, 0);
  if (params.get('cam')) { const c = params.get('cam').split(',').map(Number); cam.position.set(...c); }
  ctl.update();
  const loop = () => { r.render(scene, cam); requestAnimationFrame(loop); };
  loop();
  window.__viewerReady = true;
}
