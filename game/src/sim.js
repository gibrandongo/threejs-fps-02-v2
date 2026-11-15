// Fixed-step simulation — runs at exactly 60 Hz, apart from rendering.
// Owns movement, shooting, grenades, plant/defuse, round flow and economy.
// It never touches the DOM or the renderer; it emits events into S.events
// (shots, impacts, explosions, kills) which main.js turns into visuals.
import * as THREE from 'three';
import { WEAPONS, ECONOMY, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';
import {
  FREEZE_TIME, ROUND_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME,
  WIN_ROUNDS, MAX_ROUNDS, awardRound, resetAgentForRound, equipWeapon,
} from './state.js';
import { collideMove, hasLineOfSight, segmentBlocked } from './world.js';
import { updateBot, assignRoles } from './bots.js';

const DT = 1 / 60;
const EYE_STAND = 1.55, EYE_CROUCH = 1.12;
const RADIUS = 0.45;
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _tmp = new THREE.Vector3();

function eyeOf(a) { return a.pos.y + (a.crouch ? EYE_CROUCH : EYE_STAND); }
function moveSpeed(a) {
  if (a.crouch) return 2.1;
  return 4.2;
}

// ---- shooting ------------------------------------------------------------
function fireShot(S, env, shooter, aimPoint, aimErr) {
  const w = WEAPONS[shooter.weaponId];
  if (shooter.mag <= 0) { if (shooter.isPlayer) env.sfx.dryFire(); return false; }
  shooter.mag--;
  shooter.fireCooldown = w.interval;
  shooter.spreadHeat = Math.min(1, shooter.spreadHeat + (w.auto ? 0.09 : 0.16));
  shooter.lastShotT = S.time;
  S.stats.shots++;
  _origin.set(shooter.pos.x, eyeOf(shooter), shooter.pos.z);
  const dist = _origin.distanceTo(aimPoint);
  const spread = (w.spread + shooter.spreadHeat * 0.02 + (shooter.moving ? w.moveSpread : 0) + aimErr) * (shooter.crouch ? 0.7 : 1);
  let hitAny = false, killed = false;
  for (let p = 0; p < w.pellets; p++) {
    _dir.copy(aimPoint).sub(_origin).normalize();
    // random cone offset, perpendicular basis built without allocation
    const rx = (Math.random() - 0.5) * 2 * spread * dist;
    const ry = (Math.random() - 0.5) * 2 * spread * dist;
    _tmp.copy(aimPoint); _tmp.x += rx; _tmp.y += ry;
    _dir.copy(_tmp).sub(_origin).normalize();
    env.raycaster.set(_origin, _dir);
    env.raycaster.far = w.range;
    const hits = env.raycaster.intersectObjects(env.shootTargets, false);
    const end = hits.length ? hits[0].point : _tmp.copy(_origin).addScaledVector(_dir, w.range);
    S.events.push({ type: 'tracer', from: _origin.clone(), to: end.clone ? end.clone() : end, color: w.tracer });
    if (!hits.length) { S.events.push({ type: 'impact', pos: end.clone ? end.clone() : end }); continue; }
    const h = hits[0];
    const ud = h.object.userData;
    if (ud && ud.agent && ud.agent.alive && ud.agent !== shooter) {
      const d = h.point.distanceTo(_origin);
      let dmg = w.damage * (ud.part === 'head' ? w.headMult : ud.part === 'leg' ? w.legMult : 1);
      if (d > w.range * 0.55) dmg *= w.falloff;
      const died = applyDamage(S, env, ud.agent, dmg, shooter, ud.part, w.id);
      S.stats.hits++;
      if (shooter.isPlayer) env.hudHitmark(died);
      hitAny = true; killed = killed || died;
      S.events.push({ type: 'blood', pos: h.point.clone() });
    } else {
      S.events.push({ type: 'impact', pos: h.point.clone() });
    }
  }
  env.sfx.shot(w.sound);
  S.shotNoise.push({ pos: shooter.pos.clone(), t: S.time, team: shooter.team });
  if (S.shotNoise.length > 24) S.shotNoise.shift();
  if (shooter.isPlayer) shooter.pitch += w.kick * (0.7 + Math.random() * 0.6);
  return hitAny || killed;
}

export function applyDamage(S, env, victim, dmg, attacker, part, weaponId) {
  if (!victim.alive) return false;
  if (victim.armor > 0) { dmg *= 0.5; victim.armor = Math.max(0, victim.armor - dmg); }
  victim.hp -= dmg;
  victim.lastHurtT = S.time;
  if (victim.isPlayer) env.sfx.hurt();
  else if (attacker && attacker.isPlayer) env.sfx.hit();
  if (victim.hp > 0) return false;
  victim.hp = 0; victim.alive = false; victim.deaths++;
  if (attacker && attacker !== victim) {
    attacker.kills++;
    attacker.money = Math.min(16000, attacker.money + ECONOMY.killReward);
  }
  S.killfeed.push({ a: attacker ? attacker.name : '—', aTeam: attacker ? attacker.team : 'A', b: victim.name, bTeam: victim.team, weapon: WEAPONS[weaponId] ? WEAPONS[weaponId].name : weaponId, headshot: part === 'head', t: S.time });
  if (S.killfeed.length > 8) S.killfeed.shift();
  S.events.push({ type: 'death', agent: victim });
  if (attacker && attacker.isPlayer) env.sfx.kill();
  if (victim.hasBomb) {
    victim.hasBomb = false;
    S.bomb.state = 'dropped'; S.bomb.pos.copy(victim.pos); S.bomb.carrier = -1;
    S.events.push({ type: 'bombDropped', pos: victim.pos.clone() });
  }
  if (victim.mesh) victim.mesh.visible = false;
  return true;
}

// ---- movement ------------------------------------------------------------
function stepMove(S, world, a, ix, iz, dt, slow) {
  const target = moveSpeed(a) * (slow ? 0.62 : 1);
  const ax = ix * 34, az = iz * 34;
  a.vel.x += ax * dt; a.vel.z += az * dt;
  const sp = Math.hypot(a.vel.x, a.vel.z);
  const max = Math.max(target, 0.5);
  if (sp > max) { a.vel.x *= max / sp; a.vel.z *= max / sp; }
  if (ix === 0 && iz === 0) { // friction
    const f = Math.max(0, 1 - 9 * dt);
    a.vel.x *= f; a.vel.z *= f;
  }
  a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
  collideMove(a.pos, RADIUS, world.colliders);
  a.speedNow = Math.hypot(a.vel.x, a.vel.z);
  a.moving = a.speedNow > 0.8;
  // simple gravity / jump
  if (!a.onGround) {
    a.vel.y -= 14 * dt; a.pos.y += a.vel.y * dt;
    if (a.pos.y <= 0) { a.pos.y = 0; a.vel.y = 0; a.onGround = true; }
  }
}

function botApi(S, world, env) {
  return {
    moveAgent(a, ix, iz, dt, crouch, slow) { a.crouch = !!crouch; stepMove(S, world, a, ix, iz, dt, slow); },
    fire(a, aimPoint, aimErr) { fireShot(S, env, a, aimPoint, aimErr); },
    grenade(a) { throwGrenade(S, env, a); },
  };
}

// ---- rounds --------------------------------------------------------------
export function startRound(S, world, env) {
  S.phase = 'freeze'; S.timeLeft = FREEZE_TIME; S.phaseT = 0;
  S.bomb.state = 'carried'; S.bomb.site = null; S.bomb.timer = BOMB_TIME;
  S.grenades.length = 0; S.shotNoise.length = 0;
  // carrier: the player on round 1, then a random attacker
  const carrier = S.round === 1 ? 0 : 1 + Math.floor(Math.random() * 4);
  S.bomb.carrier = carrier;
  S.agents.forEach((a, i) => {
    const spawns = a.team === 'A' ? world.spawnsA : world.spawnsB;
    const sp = spawns[i % 5];
    resetAgentForRound(S, a, sp, a.team === 'A' ? 0 : Math.PI);
    a.hasBomb = i === carrier;
    // bot economy: buy up with their money
    if (!a.isPlayer) botBuy(S, a);
  });
  assignRoles(S, world);
  env.sfx.ensure();
  S.events.push({ type: 'roundStart', round: S.round });
}

function botBuy(S, a) {
  const r = Math.random();
  if (a.money >= 4750 && a.team === 'B' && r < 0.25) buyWeapon(S, a, 'sniper');
  else if (a.money >= 2700) buyWeapon(S, a, 'rifle');
  else if (a.money >= 1500) buyWeapon(S, a, 'smg');
  else if (a.money >= 1200 && r < 0.5) buyWeapon(S, a, 'shotgun');
  if (a.money >= 300 && r < 0.5) { a.money -= 300; a.grenades++; }
  if (a.money >= 650 && r < 0.6) { a.money -= 650; a.armor = 100; }
}

export function buyWeapon(S, a, id) {
  const w = WEAPONS[id];
  if (!w) return false;
  if (a.owned.includes(id)) { equipWeapon(a, id); return true; }
  if (a.money < w.price) return false;
  a.money -= w.price; a.owned.push(id);
  a.ammo[id] = { mag: w.mag, reserve: w.reserve };
  equipWeapon(a, id);
  return true;
}

export function endRound(S, env, winner, reason) {
  if (S.phase !== 'live') return;
  S.roundWinner = winner;
  awardRound(S, winner);
  S.phase = 'end'; S.timeLeft = 5; S.phaseT = 0;
  const score = 'Vanguard ' + S.wins.A + ' — ' + S.wins.B + ' Sentinel';
  const banner = winner === 'A'
    ? `<span style="color:#7ee081">ROUND WON</span><span class="sub2">${reason} · ${score}</span>`
    : `<span style="color:#ff5d5d">ROUND LOST</span><span class="sub2">${reason} · ${score}</span>`;
  env.hudBanner(banner);
  if (winner === 'A') env.sfx.roundWin(); else env.sfx.roundLose();
  S.events.push({ type: 'roundEnd', winner, reason });
}

function checkRoundEnd(S, env) {
  const aliveA = S.agents.filter(a => a.alive && a.team === 'A').length;
  const aliveB = S.agents.filter(a => a.alive && a.team === 'B').length;
  if (S.bomb.state === 'planted') return; // bomb decides from here
  if (aliveA === 0) endRound(S, env, 'B', 'Vanguard eliminated');
  else if (aliveB === 0) endRound(S, env, 'A', 'Sentinel eliminated');
}

// ---- grenades ------------------------------------------------------------
function throwGrenade(S, env, a) {
  if (a.grenades <= 0) return;
  a.grenades--;
  const dir = new THREE.Vector3(-Math.sin(a.yaw) * Math.cos(a.pitch), Math.sin(a.pitch) + 0.35, -Math.cos(a.yaw) * Math.cos(a.pitch)).normalize();
  S.grenades.push({
    pos: new THREE.Vector3(a.pos.x, eyeOf(a), a.pos.z),
    vel: dir.multiplyScalar(15), t: 0, fuse: 1.7, owner: a, bounced: false,
  });
  env.sfx.click();
}
function stepGrenades(S, env, dt) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    g.t += dt;
    g.vel.y -= 13 * dt;
    const nx = g.pos.x + g.vel.x * dt, ny = g.pos.y + g.vel.y * dt, nz = g.pos.z + g.vel.z * dt;
    let bounced = false;
    for (const c of env.world.colliders) {
      if (nx > c.min.x - 0.12 && nx < c.max.x + 0.12 && ny > c.min.y - 0.12 && ny < c.max.y + 0.12 && nz > c.min.z - 0.12 && nz < c.max.z + 0.12) {
        // reflect on the axis of least penetration
        const dxl = Math.min(Math.abs(nx - c.min.x), Math.abs(nx - c.max.x));
        const dzl = Math.min(Math.abs(nz - c.min.z), Math.abs(nz - c.max.z));
        const dyl = Math.min(Math.abs(ny - c.min.y), Math.abs(ny - c.max.y));
        if (dxl <= dzl && dxl <= dyl) g.vel.x *= -0.45;
        else if (dzl <= dyl) g.vel.z *= -0.45;
        else g.vel.y *= -0.45;
        bounced = true; break;
      }
    }
    if (!bounced) { g.pos.set(nx, ny, nz); }
    if (g.pos.y < 0.12) { g.pos.y = 0.12; g.vel.y *= -0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; bounced = true; }
    if (bounced && !g.bounced) { g.bounced = true; env.sfx.grenadeBounce(); }
    if (g.t >= g.fuse) {
      S.grenades.splice(i, 1);
      explode(S, env, g);
    }
  }
}
function explode(S, env, g) {
  S.events.push({ type: 'explosion', pos: g.pos.clone() });
  env.sfx.explosion();
  for (const a of S.agents) {
    if (!a.alive) continue;
    const d = a.pos.distanceTo(g.pos);
    if (d > 8) continue;
    let dmg = 115 * (1 - d / 9) + 15;
    if (segmentBlocked(new THREE.Vector3(g.pos.x, g.pos.y, g.pos.z), new THREE.Vector3(a.pos.x, a.pos.y + 1, a.pos.z), env.world.colliders)) dmg *= 0.3;
    if (dmg > 5) applyDamage(S, env, a, dmg, g.owner, 'body', 'grenade');
  }
}

// ---- player + objective interaction --------------------------------------
function stepPlayer(S, world, env, dt) {
  const p = S.player, inp = env.input;
  if (!p.alive) return;
  p.yaw -= inp.yawDelta; p.pitch -= inp.pitchDelta;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
  inp.yawDelta = 0; inp.pitchDelta = 0;
  p.crouch = !!inp.crouch;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  let ix = 0, iz = 0;
  if (inp.f) { ix += fx; iz += fz; }
  if (inp.b) { ix -= fx; iz -= fz; }
  if (inp.r) { ix += rx; iz += rz; }
  if (inp.l) { ix -= rx; iz -= rz; }
  const len = Math.hypot(ix, iz);
  if (len > 0) { ix /= len; iz /= len; }
  stepMove(S, world, p, ix, iz, dt, !!inp.slow);
  if (inp.jump && p.onGround) { p.vel.y = 5.2; p.onGround = false; }
  // fire
  const w = WEAPONS[p.weaponId];
  if (inp.fire && p.fireCooldown <= 0 && p.reloading <= 0 && (w.auto || inp.fireEdge)) {
    _tmp.set(p.pos.x - Math.sin(p.yaw) * Math.cos(p.pitch) * 30, eyeOf(p) + Math.sin(p.pitch) * 30, p.pos.z - Math.cos(p.yaw) * Math.cos(p.pitch) * 30);
    fireShot(S, env, p, _tmp, 0);
  }
  inp.fireEdge = false;
  if (inp.reload && p.reloading <= 0 && p.mag < w.mag && p.reserve > 0) {
    p.reloading = w.reload; env.sfx.reload();
  }
  if (inp.grenade) { inp.grenade = false; throwGrenade(S, env, p); }
}

function stepInteract(S, world, env, dt) {
  const p = S.player;
  const agents = S.agents;
  // bomb pickup
  if (S.bomb.state === 'dropped') {
    for (const a of agents) {
      if (a.alive && a.team === 'A' && a.pos.distanceTo(S.bomb.pos) < 1.6) {
        a.hasBomb = true; S.bomb.state = 'carried'; S.bomb.carrier = a.id;
        S.events.push({ type: 'bombPickup', agent: a });
        break;
      }
    }
  }
  // plant / defuse progress
  for (const a of agents) {
    if (!a.alive) continue;
    const wantPlant = a.isPlayer ? env.input.interact : a.brain.interact === 'plant';
    const wantDefuse = a.isPlayer ? env.input.interact : a.brain.interact === 'defuse';
    let planting = false, defusing = false;
    if (wantPlant && a.hasBomb && S.bomb.state === 'carried') {
      const site = a.pos.distanceTo(world.siteA.pos) < 3.4 ? world.siteA : a.pos.distanceTo(world.siteB.pos) < 3.4 ? world.siteB : null;
      if (site) {
        planting = true;
        a.plantT += dt;
        if (Math.floor(a.plantT * 4) !== Math.floor((a.plantT - dt) * 4)) env.sfx.plantTick();
        if (a.plantT >= PLANT_TIME) {
          S.bomb.state = 'planted'; S.bomb.site = site.id; S.bomb.pos.copy(a.pos); S.bomb.timer = BOMB_TIME;
          a.hasBomb = false; a.plantT = 0;
          a.money = Math.min(16000, a.money + ECONOMY.plantReward);
          S.events.push({ type: 'bombPlanted', site: site.id, agent: a });
          env.hudBanner(`<span style="color:#ff5d5d">CHARGE PLANTED — SITE ${site.id}</span><span class="sub2">Sentinel must defuse it before it blows</span>`);
        }
      }
    }
    if (wantDefuse && S.bomb.state === 'planted' && a.team === 'B' && a.pos.distanceTo(S.bomb.pos) < 2.6) {
      defusing = true;
      a.defuseT += dt;
      if (Math.floor(a.defuseT * 4) !== Math.floor((a.defuseT - dt) * 4)) env.sfx.plantTick();
      if (a.defuseT >= DEFUSE_TIME) {
        S.bomb.state = 'defused'; a.defuseT = 0;
        S.events.push({ type: 'bombDefused', agent: a });
        endRound(S, env, 'B', 'Charge defused');
        return;
      }
    }
    if (!planting) a.plantT = Math.max(0, a.plantT - dt * 2);
    if (!defusing) a.defuseT = Math.max(0, a.defuseT - dt * 2);
  }
}

function stepTimers(S, env, dt) {
  for (const a of S.agents) {
    if (a.fireCooldown > 0) a.fireCooldown -= dt;
    if (a.reloading > 0) {
      a.reloading -= dt;
      if (a.reloading <= 0) {
        const w = WEAPONS[a.weaponId];
        const need = w.mag - a.mag, take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
      }
    }
    a.spreadHeat = Math.max(0, a.spreadHeat - dt * 0.55);
  }
  if (S.bomb.state === 'planted') {
    S.bomb.timer -= dt;
    S.bomb.beepT -= dt;
    if (S.bomb.beepT <= 0) { S.bomb.beepT = S.bomb.timer < 10 ? 0.5 : 1; env.sfx.beep(S.bomb.timer < 10); }
    if (S.bomb.timer <= 0) {
      S.bomb.state = 'exploded';
      S.events.push({ type: 'explosion', pos: S.bomb.pos.clone(), big: true });
      env.sfx.explosion();
      for (const a of S.agents) {
        if (a.alive && a.pos.distanceTo(S.bomb.pos) < 9) applyDamage(S, env, a, 200, null, 'body', 'grenade');
      }
      endRound(S, env, 'A', 'Charge detonated');
    }
  }
}

// ---- the fixed step ------------------------------------------------------
export function step(S, world, env, dt) {
  S.time += dt; S.tick++;
  if (S.phase === 'menu') return;
  S.phaseT += dt;
  S.timeLeft -= dt;
  if (S.phase === 'freeze') {
    if (S.timeLeft <= 0) {
      S.phase = 'live'; S.timeLeft = ROUND_TIME; S.phaseT = 0;
      env.hudBanner('<span>ROUND ' + S.round + ' — GO</span><span class="sub2">Plant the charge or eliminate Sentinel</span>');
      env.sfx.beep(true);
    }
    return;
  }
  if (S.phase === 'end') {
    if (S.timeLeft <= 0) {
      if (S.wins.A >= WIN_ROUNDS || S.wins.B >= WIN_ROUNDS || S.round >= MAX_ROUNDS) {
        S.phase = 'matchend';
        S.matchWinner = S.wins.A > S.wins.B ? 'A' : 'B';
      } else {
        S.round++;
        startRound(S, world, env);
      }
    }
    return;
  }
  if (S.phase !== 'live') return;
  if (S.timeLeft <= 0) { endRound(S, env, 'B', 'Time expired — Sentinel holds'); return; }

  const api = botApi(S, world, env);
  if (S.auto) updateBot(S, world, S.player, dt, api);
  else stepPlayer(S, world, env, dt);
  for (const a of S.agents) {
    if (a.isPlayer) continue;
    updateBot(S, world, a, dt, api);
  }
  stepInteract(S, world, env, dt);
  stepGrenades(S, env, dt);
  stepTimers(S, env, dt);
  checkRoundEnd(S, env);
  // visibility memory for the minimap: who can the player's team see?
  for (const e of S.agents) {
    if (e.team === 'B' && e.alive) {
      for (const f of S.agents) {
        if (f.team === 'A' && f.alive && hasLineOfSight(f.pos, e.pos, world.colliders)) { e.lastSeenT = S.time; break; }
      }
    }
  }
}

export { DT, equipWeapon };
