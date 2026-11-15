// BREAKLINE — bootstrap, rendering and input. The sim (sim.js) runs at a
// fixed 60 Hz in an accumulator; this file only renders state, reads input
// and turns sim events into tracers, particles, flashes and camera shake.
// No game logic lives here.
import * as THREE from 'three';
import { createState } from './state.js';
import { WEAPONS, ECONOMY, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';
import { buildWorld } from './world.js';
import { step, startRound, buyWeapon, equipWeapon, DT } from './sim.js';
import { createHud } from './hud.js';
import { Sfx } from './audio.js';
import { applyShot } from './stage.js';

const S = createState();
const sfx = new Sfx();
window.__BREAKLINE__ = { S, errors: [], startedAt: Date.now() };
window.addEventListener('error', (e) => window.__BREAKLINE__.errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => window.__BREAKLINE__.errors.push('rejection: ' + String(e.reason)));

// ---- renderer / scene ----------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 200);
camera.rotation.order = 'YXZ';
const world = buildWorld(scene);
const raycaster = new THREE.Raycaster();

// ---- agent meshes --------------------------------------------------------
const TEAM_COLOR = { A: 0x2fa8d8, B: 0xffb02e };
const shootTargets = [...world.wallMeshes];
function makeNameSprite(agent) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(2.2, 0.55, 1); sp.position.y = 2.15;
  agent._nameCanvas = c; agent._nameTex = tex;
  drawName(agent);
  return sp;
}
function drawName(a) {
  const g = a._nameCanvas.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = a.team === 'A' ? '#5ec8e8' : '#ffb02e';
  g.font = 'bold 26px Arial'; g.textAlign = 'center';
  g.fillText(a.name, 128, 26);
  g.fillStyle = '#1a1a1a'; g.fillRect(58, 36, 140, 10);
  g.fillStyle = a.hp > 50 ? '#7ee081' : a.hp > 25 ? '#ffb02e' : '#ff5d5d';
  g.fillRect(58, 36, 140 * Math.max(0, a.hp / 100), 10);
  a._nameTex.needsUpdate = true;
}
function buildAgentMesh(a) {
  const g = new THREE.Group();
  const col = TEAM_COLOR[a.team];
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.36),
    new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 }));
  torso.position.y = 1.05; torso.userData = { agent: a, part: 'body' };
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.9 }));
  vest.position.y = 1.1; vest.userData = { agent: a, part: 'body' };
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xd9b48a, roughness: 0.8 }));
  head.position.y = 1.62; head.userData = { agent: a, part: 'head' };
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.3, metalness: 0.6 }));
  visor.position.set(0, 1.64, -0.18); visor.userData = { agent: a, part: 'head' };
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.9 }));
  legL.position.set(-0.16, 0.36, 0); legL.userData = { agent: a, part: 'leg' };
  const legR = legL.clone(); legR.position.x = 0.16; legR.userData = { agent: a, part: 'leg' };
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85),
    new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.5, metalness: 0.5 }));
  gun.position.set(0.28, 1.18, -0.45); gun.userData = { agent: a, part: 'body' };
  const name = makeNameSprite(a);
  g.add(torso, vest, head, visor, legL, legR, gun, name);
  g.position.copy(a.pos);
  scene.add(g);
  a.mesh = g; a.headMesh = head; a.bodyMesh = torso;
  shootTargets.push(torso, vest, head, visor, legL, legR, gun);
  a._lastHp = a.hp;
  return g;
}
for (const a of S.agents) buildAgentMesh(a);
S.player.mesh.visible = false; // first person: no self body

// view-model gun (attached to the camera)
const viewGun = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.45, metalness: 0.55 }));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 8),
    new THREE.MeshStandardMaterial({ color: 0x0e1113, roughness: 0.4, metalness: 0.6 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.42);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x30363d, roughness: 0.4, metalness: 0.6 }));
  sight.position.set(0, 0.11, -0.1);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 }));
  mag.position.set(0, -0.14, 0.05);
  viewGun.add(body, barrel, sight, mag);
  viewGun.position.set(0.26, -0.24, -0.5);
  camera.add(viewGun);
  scene.add(camera);
}
// muzzle flash light
const muzzle = new THREE.PointLight(0xffc46b, 0, 9);
muzzle.position.set(0.26, -0.2, -1.1);
camera.add(muzzle);

// ---- tracers / particles / explosion FX ----------------------------------
const tracers = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0 }));
  line.visible = false; scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerI = 0;
function spawnTracer(from, to, color) {
  const t = tracers[tracerI++ % tracers.length];
  t.line.geometry.setFromPoints([from, to]);
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.9; t.line.visible = true; t.life = 0.09;
}
const sparks = [];
for (let i = 0; i < 48; i++) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  m.visible = false; scene.add(m);
  sparks.push({ m, vel: new THREE.Vector3(), life: 0 });
}
let sparkI = 0;
function spawnBurst(pos, color, n, speed) {
  for (let k = 0; k < n; k++) {
    const s = sparks[sparkI++ % sparks.length];
    s.m.visible = true; s.m.position.copy(pos);
    s.m.material.color.setHex(color);
    s.vel.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.7, (Math.random() - 0.5) * speed);
    s.life = 0.35 + Math.random() * 0.25;
  }
}
const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0 }));
boom.visible = false; scene.add(boom);
const boomLight = new THREE.PointLight(0xff7a2e, 0, 30); scene.add(boomLight);
let boomT = 0, shakeT = 0;

function consumeEvents() {
  for (const ev of S.events) {
    if (ev.type === 'tracer') spawnTracer(ev.from, ev.to, ev.color);
    else if (ev.type === 'impact') spawnBurst(ev.pos, 0xffd27a, 4, 3);
    else if (ev.type === 'blood') spawnBurst(ev.pos, 0xc03030, 6, 2.5);
    else if (ev.type === 'explosion') {
      boom.visible = true; boom.position.copy(ev.pos); boomT = 0.6;
      boomLight.position.copy(ev.pos); boomLight.intensity = 60;
      shakeT = Math.max(shakeT, 0.5);
    } else if (ev.type === 'death') {
      const a = ev.agent;
      if (a.mesh) a.mesh.visible = false;
    } else if (ev.type === 'roundStart') {
      for (const a of S.agents) if (a.mesh) a.mesh.visible = !a.isPlayer;
    }
  }
  S.events.length = 0;
}

// ---- HUD + input -----------------------------------------------------------
const hud = createHud(S, world, {
  buy(id) { buyItem(id); },
  hintText() {
    const p = S.player;
    if (S.phase === 'freeze') return 'Press B for the buy menu';
    if (p.hasBomb) {
      if (p.pos.distanceTo(world.siteA.pos) < 3.4) return 'Hold E to plant at SITE A';
      if (p.pos.distanceTo(world.siteB.pos) < 3.4) return 'Hold E to plant at SITE B';
      return 'Carry the charge to Site A or B';
    }
    if (S.bomb.state === 'planted' && p.pos.distanceTo(S.bomb.pos) < 2.6) return 'Hold E to defuse';
    if (S.bomb.state === 'dropped' && p.pos.distanceTo(S.bomb.pos) < 1.6) return 'Pick up the charge';
    return '';
  },
});
const input = {
  f: false, b: false, l: false, r: false, jump: false, crouch: false, slow: false,
  fire: false, fireEdge: false, reload: false, interact: false, grenade: false,
  yawDelta: 0, pitchDelta: 0, zoom: false,
};
const env = {
  input, sfx, raycaster, shootTargets, world,
  hudHitmark: (kill) => hud.hitmark(kill),
  hudBanner: (html) => hud.setBanner(html),
};
let locked = false, buyOpen = false, scoreOpen = false;
const canvas = renderer.domElement;

function buyItem(id) {
  const p = S.player;
  if (S.phase !== 'freeze') return;
  if (id === 'grenade') {
    if (p.money >= GRENADE_PRICE && p.grenades < 2) { p.money -= GRENADE_PRICE; p.grenades++; sfx.buy(); }
  } else if (id === 'armor') {
    if (p.money >= ARMOR_PRICE && p.armor <= 0) { p.money -= ARMOR_PRICE; p.armor = 100; sfx.buy(); }
  } else if (buyWeapon(S, p, id)) sfx.buy();
  hud.buildBuyMenu();
}
function startMatch() {
  if (S.phase !== 'menu') return;
  S.round = 1; S.wins.A = 0; S.wins.B = 0; S.lossStreak.A = 0; S.lossStreak.B = 0;
  for (const a of S.agents) { a.kills = 0; a.deaths = 0; a.money = ECONOMY.startMoney; a.owned = ['p9']; a.weaponId = 'p9'; a.armor = 0; a.grenades = 0; }
  hud.showMenu(false);
  startRound(S, world, env);
}
function toggleBuy(force) {
  buyOpen = force !== undefined ? force : !buyOpen;
  if (buyOpen && S.phase !== 'freeze') buyOpen = false;
  hud.showBuy(buyOpen);
  if (buyOpen) document.exitPointerLock();
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyW': input.f = true; break;
    case 'KeyS': input.b = true; break;
    case 'KeyA': input.l = true; break;
    case 'KeyD': input.r = true; break;
    case 'Space': input.jump = true; e.preventDefault(); break;
    case 'ControlLeft': case 'KeyC': input.crouch = true; break;
    case 'ShiftLeft': input.slow = true; break;
    case 'KeyR': input.reload = true; break;
    case 'KeyE': input.interact = true; break;
    case 'KeyG': input.grenade = true; break;
    case 'KeyB': toggleBuy(); break;
    case 'KeyQ': {
      const owned = S.player.owned;
      const i = owned.indexOf(S.player.weaponId);
      equipWeapon(S.player, owned[(i + 1) % owned.length]);
      break;
    }
    case 'Tab': scoreOpen = true; hud.showScoreboard(true); e.preventDefault(); break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': {
      const idx = Number(e.code.slice(5)) - 1;
      const list = ['p9', 'smg', 'shotgun', 'rifle', 'sniper'];
      const id = list[idx];
      if (S.phase === 'freeze') buyItem(id);
      else equipWeapon(S.player, id);
      break;
    }
    case 'KeyM': sfx.enabled = !sfx.enabled; break;
  }
});
addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': input.f = false; break;
    case 'KeyS': input.b = false; break;
    case 'KeyA': input.l = false; break;
    case 'KeyD': input.r = false; break;
    case 'Space': input.jump = false; break;
    case 'ControlLeft': case 'KeyC': input.crouch = false; break;
    case 'ShiftLeft': input.slow = false; break;
    case 'KeyR': input.reload = false; break;
    case 'KeyE': input.interact = false; break;
    case 'Tab': scoreOpen = false; hud.showScoreboard(false); break;
  }
});
addEventListener('mousemove', (e) => {
  if (!locked) return;
  input.yawDelta += e.movementX * 0.0022;
  input.pitchDelta += e.movementY * 0.0022;
});
canvas.addEventListener('mousedown', (e) => {
  if (S.phase === 'menu' || buyOpen) return;
  if (!locked) { canvas.requestPointerLock(); return; }
  if (e.button === 0) { input.fire = true; input.fireEdge = true; sfx.ensure(); }
  if (e.button === 2) input.zoom = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) input.zoom = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
document.getElementById('playbtn').addEventListener('click', () => {
  sfx.ensure(); startMatch(); canvas.requestPointerLock();
});
document.getElementById('againbtn').addEventListener('click', () => {
  hud.showMenu(false); startMatch();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- main loop: fixed-step sim, render reads state ------------------------
let last = performance.now(), acc = 0;
const params = new URLSearchParams(location.search);
if (params.get('auto') === '1') {
  S.auto = true;
  startMatch();
}
applyShot(S, world, { hud, startMatch });
if (params.get('auto') === '1') S.auto = true;
if (params.get('shot') === 'plant') input.interact = true; // hold E: real plant mechanic for the still

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let n = 0;
  while (acc >= DT && n < 5) { step(S, world, env, DT); acc -= DT; n++; }
  if (n === 5) acc = 0;
  consumeEvents();

  // camera follows the player (or orbits the yard on the menu)
  const p = S.player;
  if (S.phase === 'menu') {
    const t = now * 0.00008;
    camera.position.set(Math.sin(t) * 26, 12, Math.cos(t) * 26);
    camera.lookAt(0, 1, -8);
    camera.fov = 60; camera.updateProjectionMatrix();
  } else {
    const eye = p.pos.y + (p.crouch ? 1.12 : 1.55);
    camera.position.set(p.pos.x, eye, p.pos.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch;
    if (shakeT > 0) {
      camera.position.x += (Math.random() - 0.5) * shakeT * 0.3;
      camera.position.y += (Math.random() - 0.5) * shakeT * 0.3;
      shakeT -= dt;
    }
    const wantFov = input.zoom && p.weaponId === 'sniper' ? 32 : 75;
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
  // view-model: bob + recoil kick
  const w = WEAPONS[p.weaponId];
  viewGun.position.y = -0.24 + Math.sin(now * 0.012) * 0.004 * (p.moving ? 1 : 0.2);
  viewGun.position.z = -0.5 + p.spreadHeat * 0.05;
  viewGun.visible = p.alive && S.phase !== 'menu';
  muzzle.intensity = Math.max(0, muzzle.intensity - dt * 90);
  if (S.time - p.lastShotT < 0.05) muzzle.intensity = 26;

  // agent meshes follow sim positions
  for (const a of S.agents) {
    if (!a.mesh || a.isPlayer) continue;
    a.mesh.position.copy(a.pos);
    a.mesh.rotation.y = a.yaw;
    a.mesh.visible = a.alive && S.phase !== 'menu';
    if (a._lastHp !== a.hp) { a._lastHp = a.hp; drawName(a); }
    // simple walk bob
    a.mesh.position.y = a.pos.y + (a.moving ? Math.abs(Math.sin(S.time * 9 + a.id)) * 0.05 : 0);
  }
  // tracers fade
  for (const t of tracers) {
    if (t.life > 0) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9; if (t.life <= 0) t.line.visible = false; }
  }
  for (const s of sparks) {
    if (s.life > 0) {
      s.life -= dt;
      s.vel.y -= 9 * dt;
      s.m.position.addScaledVector(s.vel, dt);
      if (s.m.position.y < 0.03) { s.m.position.y = 0.03; s.vel.y *= -0.4; }
      if (s.life <= 0) s.m.visible = false;
    }
  }
  if (boomT > 0) {
    boomT -= dt;
    const k = 1 - boomT / 0.6;
    boom.scale.setScalar(1 + k * 9);
    boom.material.opacity = Math.max(0, 0.85 * (1 - k));
    boomLight.intensity = 60 * (1 - k);
    if (boomT <= 0) { boom.visible = false; boomLight.intensity = 0; }
  }
  // site signs gently pulse; bomb light blinks when planted
  const pulse = 0.75 + Math.sin(now * 0.004) * 0.25;
  world.siteA.sign.material.opacity = pulse;
  world.siteB.sign.material.opacity = pulse;
  hud.update(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
