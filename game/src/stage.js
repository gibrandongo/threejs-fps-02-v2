// Deterministic scene staging for screenshots — ONLY for capturing stills.
// Every scene is built from the real game state (real round, real bots,
// real HUD); staging just picks positions and phases, then the game runs.
// ?shot=menu | combat | buy | plant
import * as THREE from 'three';
import { equipWeapon } from './sim.js';

export function applyShot(S, world, hooks) {
  const q = new URLSearchParams(location.search).get('shot');
  if (!q) return false;
  const p = S.player;
  if (q === 'menu') { S.phase = 'menu'; return true; }
  hooks.startMatch();
  if (q === 'buy') {
    S.phase = 'freeze'; S.timeLeft = 12; S.round = 1;
    p.money = 5400;
    hooks.hud.showBuy(true);
    return true;
  }
  if (q === 'combat') {
    S.phase = 'live'; S.timeLeft = 88;
    p.pos.set(0, 0, 14); p.yaw = 0.05; p.pitch = 0.01;
    if (!p.owned.includes('rifle')) { p.owned.push('rifle'); p.ammo.rifle = { mag: 25, reserve: 100 }; }
    equipWeapon(p, 'rifle');
    const e1 = S.agents[5], e2 = S.agents[6], e3 = S.agents[8];
    e1.pos.set(2.5, 0, 2); e1.yaw = Math.PI; e1.hp = 62;
    e2.pos.set(-5, 0, 5); e2.yaw = Math.PI; e2.hp = 100;
    e3.pos.set(7.5, 0, 0); e3.yaw = Math.PI; e3.hp = 100;
    for (const a of S.agents) if (a.team === 'A' && !a.isPlayer) { a.pos.set(-4 + a.id, 0, 16); a.yaw = 0; }
    S.events.push({ type: 'tracer', from: new THREE.Vector3(0.3, 1.5, 13), to: new THREE.Vector3(2.5, 1.3, 2), color: 0xfff2c0 });
    S.killfeed.push({ a: 'ROOK', aTeam: 'A', b: 'HALE', bTeam: 'B', weapon: 'AR-77 LONGSHOT', headshot: false, t: S.time });
    return true;
  }
  if (q === 'plant') {
    S.phase = 'live'; S.timeLeft = 64;
    p.pos.set(-21, 0, -13.5); p.yaw = 0.5; p.pitch = 0;
    p.hasBomb = true; S.bomb.state = 'carried'; S.bomb.carrier = 0;
    p.plantT = 2.1;
    const d1 = S.agents[5]; d1.pos.set(-14, 0, -18); d1.yaw = Math.PI * 0.75; d1.hp = 100;
    const d2 = S.agents[7]; d2.pos.set(-26, 0, -8); d2.yaw = Math.PI * 0.5; d2.hp = 45;
    for (const a of S.agents) if (a.team === 'A' && !a.isPlayer) { a.pos.set(-16 + a.id, 0, -4); a.yaw = 0.3; }
    return true;
  }
  return false;
}
