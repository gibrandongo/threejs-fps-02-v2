// Central game state — the single source of truth. The sim mutates it at a
// fixed 60 Hz; rendering and the HUD only read it. No other module keeps
// its own copy of round, score, money or agent health.
import * as THREE from 'three';
import { WEAPONS, ECONOMY } from './weapons.js';

export const TEAM_A = 'VANGUARD'; // attackers — the player's team, plants the charge
export const TEAM_B = 'SENTINEL'; // defenders
export const WIN_ROUNDS = 8;
export const MAX_ROUNDS = 15;
export const FREEZE_TIME = 15;
export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;

const NAMES_A = ['ACE', 'VEX', 'ROOK', 'IRIS', 'MOSS'];
const NAMES_B = ['HALE', 'BRAM', 'SABLE', 'ONYX', 'KITE'];

export function makeAgent(id, team, name, isPlayer) {
  return {
    id, team, name, isPlayer,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true,
    weaponId: 'p9', owned: ['p9'], mag: 15, reserve: 90, ammo: { p9: { mag: 15, reserve: 90 } },
    grenades: 0, reloading: 0, fireCooldown: 0, spreadHeat: 0,
    kills: 0, deaths: 0, money: ECONOMY.startMoney,
    crouch: false, onGround: true, moving: false, speedNow: 0,
    hasBomb: false, plantT: 0, defuseT: 0, lastShotT: -99, lastHurtT: -99,
    lastSeenT: -99, lastSeenPos: new THREE.Vector3(),
    // bot brain (unused for the player unless autopilot is on)
    brain: {
      state: 'idle', wp: -1, path: [], pathI: 0, repathT: 0, thinkT: 0,
      target: null, reactionT: 0, burstLeft: 0, burstPause: 0,
      aimErr: 0.02, holdPos: null, holdT: 0, role: 'roam',
      stuckT: 0, lastPos: new THREE.Vector3(), noisePos: null, noiseT: -99,
    },
    // view-model / render scratch, filled by main.js
    mesh: null, headMesh: null, bodyMesh: null, nameSprite: null, gunMesh: null,
  };
}

export function createState() {
  const agents = [];
  for (let i = 0; i < 5; i++) agents.push(makeAgent(i, 'A', NAMES_A[i], i === 0));
  for (let i = 0; i < 5; i++) agents.push(makeAgent(5 + i, 'B', NAMES_B[i], false));
  return {
    phase: 'menu', // menu | freeze | live | end | matchend
    round: 1, wins: { A: 0, B: 0 }, lossStreak: { A: 0, B: 0 },
    timeLeft: FREEZE_TIME, phaseT: 0, time: 0, tick: 0,
    agents, player: agents[0],
    bomb: { state: 'carried', carrier: 0, site: null, pos: new THREE.Vector3(), timer: BOMB_TIME, beepT: 0 },
    grenades: [], // live grenade projectiles {pos, vel, t, fuse, owner}
    killfeed: [], // {a, b, weapon, headshot, t}
    banner: null, bannerT: 0,
    roundWinner: null, matchWinner: null,
    events: [], // transient HUD/audio events: {type, ...}
    shotNoise: [], // {pos, t, team} — bots hear these
    stats: { shots: 0, hits: 0, roundsPlayed: 0 },
    auto: false, // autopilot: player driven by bot brain (soak / demo)
    muted: false,
  };
}

export function resetAgentForRound(S, a, spawnPos, spawnYaw) {
  a.pos.copy(spawnPos); a.vel.set(0, 0, 0);
  a.yaw = spawnYaw; a.pitch = 0;
  a.hp = 100; a.alive = true; a.reloading = 0; a.fireCooldown = 0; a.spreadHeat = 0;
  a.plantT = 0; a.defuseT = 0; a.crouch = false; a.armor = 0;
  a.hasBomb = false;
  a.brain.state = 'idle'; a.brain.path = []; a.brain.pathI = 0; a.brain.target = null;
  a.brain.reactionT = 0; a.brain.burstLeft = 0; a.brain.holdPos = null; a.brain.holdT = 0;
  a.brain.noisePos = null;
  a.brain.naded = false;
  // keep the best weapon the agent owns; refill every owned weapon's ammo
  if (!a.owned.includes(a.weaponId)) a.weaponId = a.owned[a.owned.length - 1] || 'p9';
  for (const id of a.owned) {
    const w = WEAPONS[id];
    a.ammo[id] = { mag: w.mag, reserve: w.reserve };
  }
  const w = WEAPONS[a.weaponId];
  a.mag = w.mag; a.reserve = w.reserve;
}

// Swap weapons, preserving each weapon's own magazine and reserve.
export function equipWeapon(a, id) {
  if (!a.owned.includes(id) || a.weaponId === id) return false;
  a.ammo[a.weaponId] = { mag: a.mag, reserve: a.reserve };
  a.weaponId = id; a.reloading = 0;
  const saved = a.ammo[id] || { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  a.mag = saved.mag; a.reserve = saved.reserve;
  return true;
}

export function awardRound(S, winner) {
  const loser = winner === 'A' ? 'B' : 'A';
  S.wins[winner]++; S.lossStreak[winner] = 0; S.lossStreak[loser]++;
  for (const a of S.agents) {
    if (!a.alive && a.team === winner) { /* dead winners still get paid */ }
    if (a.team === winner) a.money += ECONOMY.winReward;
    else {
      const bonus = Math.min((S.lossStreak[loser] - 1) * ECONOMY.lossStreakBonus,
        ECONOMY.maxLossReward - ECONOMY.lossReward);
      a.money += ECONOMY.lossReward + Math.max(0, bonus);
    }
    a.money = Math.min(a.money, 16000);
  }
  S.stats.roundsPlayed++;
}
