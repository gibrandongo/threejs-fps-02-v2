// Bot AI — waypoint navigation, roles, combat bursts, rotations, planting
// and defusing. Brains think at 5 Hz and steer every fixed step; the sim
// owns movement, shooting and objective progress, so bots only set intent.
import * as THREE from 'three';
import { nearestWaypoint, findPath, hasLineOfSight } from './world.js';
import { makeRng } from './rng.js';

const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();

function dist2D(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
function angleTo(a, b) { return Math.atan2(-(b.x - a.x), -(b.z - a.z)); }
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

export function assignRoles(S, world) {
  // Attackers: carrier + 2 go A, 2 go B (lanes split). Defenders: 2 hold A,
  // 2 hold B, 1 roams mid. Roles are re-picked every round.
  const rng = makeRng(1000 + S.round * 77);
  const attackers = S.agents.filter(a => a.team === 'A');
  const defenders = S.agents.filter(a => a.team === 'B');
  const carrier = S.agents[S.bomb.carrier];
  attackers.forEach((a, i) => {
    a.brain.role = a === carrier ? 'carrier' : (i % 2 === 0 ? 'attackA' : 'attackB');
    a.brain.site = a.brain.role === 'attackB' ? 'B' : 'A';
  });
  defenders.forEach((a, i) => {
    a.brain.role = i === 4 ? 'roam' : (i < 2 ? 'holdA' : 'holdB');
    a.brain.site = a.brain.role === 'holdB' ? 'B' : 'A';
  });
  // hold positions near each site
  for (const a of defenders) {
    const site = a.brain.site === 'A' ? world.siteA : world.siteB;
    const off = rng.range(-4, 4);
    a.brain.holdPos = new THREE.Vector3(site.pos.x + off, 0, site.pos.z + rng.range(2, 6));
    a.brain.holdT = 0;
  }
  void rng;
}

function acquireTarget(S, world, a) {
  const brain = a.brain;
  let best = null, bestD = 55;
  _eye.set(a.pos.x, a.pos.y + 1.5, a.pos.z);
  for (const e of S.agents) {
    if (!e.alive || e.team === a.team) continue;
    const d = dist2D(a.pos, e.pos);
    if (d > bestD) continue;
    if (!hasLineOfSight(a.pos, e.pos, world.colliders)) continue;
    best = e; bestD = d;
  }
  if (best) {
    if (brain.target !== best) {
      brain.reactionT = 0.35 + makeRng(a.id * 131 + S.round).next() * 0.45;
      brain.burstLeft = 0;
    }
    brain.target = best;
    best.lastSeenT = S.time; best.lastSeenPos.copy(best.pos);
    a.lastSeenT = S.time;
  } else if (brain.target && S.time - brain.target.lastSeenT > 1.5) {
    brain.target = null;
  }
  return brain.target;
}

function gotoWaypoint(S, world, a, wpId, dt, api) {
  const brain = a.brain;
  const wp = world.waypoints[wpId];
  if (!wp) return true;
  const d = dist2D(a.pos, wp.pos);
  if (d < 1.2) return true;
  const wantYaw = angleTo(a.pos, wp.pos);
  a.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, angDiff(a.yaw, wantYaw)));
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  api.moveAgent(a, fx, fz, dt, false, false);
  return false;
}

function followPath(S, world, a, dt, api) {
  const brain = a.brain;
  if (!brain.path.length || brain.pathI >= brain.path.length) return true;
  const arrived = gotoWaypoint(S, world, a, brain.path[brain.pathI], dt, api);
  if (arrived) brain.pathI++;
  return brain.pathI >= brain.path.length;
}

function setPathTo(S, world, a, targetPos) {
  const from = nearestWaypoint(a.pos, world.waypoints);
  const to = nearestWaypoint(targetPos, world.waypoints);
  a.brain.path = findPath(from, to, world.waypoints);
  a.brain.pathI = 0;
}

function pickSiteTarget(S, world, a) {
  // The whole Vanguard squad executes on ONE site — the carrier's pick.
  // Splitting 2/2 let two site holders win repeated 2v1s against attackers
  // arriving staggered; a five-agent execute creates the numbers advantage
  // at the point of attack and leaves the other site's holders out of it.
  if (a.team === 'A') {
    const carrier = S.agents[S.bomb.carrier];
    if (carrier && carrier.alive && a !== carrier) {
      a.brain.site = carrier.brain.site;
    } else if (a === carrier) {
      const nearA = S.agents.filter(e => e.alive && e.team === 'B' && dist2D(e.pos, world.siteA.pos) < 14).length;
      const nearB = S.agents.filter(e => e.alive && e.team === 'B' && dist2D(e.pos, world.siteB.pos) < 14).length;
      a.brain.site = nearB < nearA ? 'B' : 'A';
    }
  }
  return a.brain.site === 'A' ? world.siteA : world.siteB;
}

function urgentObjective(S, a) {
  // An agent with a live objective keeps moving toward it even mid-fight:
  // the carrier must reach a site, attackers must recover a dropped charge,
  // defenders must rotate to a planted charge. This stays NARROW: extending
  // it to every attacker made the whole squad spray on the move (move
  // spread) while holders stood still and landed shots — attackers died
  // faster. Non-carriers stop to burst, then push on via objectiveDest.
  if (a.hasBomb && S.bomb.state === 'carried') return true;
  if (S.bomb.state === 'dropped' && a.team === 'A') return true;
  if (S.bomb.state === 'planted' && a.team === 'B') return true;
  return false;
}

// Where this agent should be heading right now (used to (re)path when its
// current path runs out, even while it has a target).
function objectiveDest(S, world, a) {
  if (S.bomb.state === 'planted') return (S.bomb.site === 'A' ? world.siteA : world.siteB).pos;
  if (a.team === 'A') return pickSiteTarget(S, world, a).pos;
  if (a.brain.role === 'roam') return null; // roamers wander via the think block
  return a.brain.holdPos;
}

export function updateBot(S, world, a, dt, api) {
  const brain = a.brain;
  if (!a.alive || S.phase !== 'live') return;
  brain.thinkT -= dt;
  brain.stuckT += dt;
  if (brain.stuckT > 1.2) {
    if (a.pos.distanceTo(brain.lastPos) < 0.25) {
      // stuck against a wall: repath via a random nearby waypoint
      const r = makeRng((S.tick * 31 + a.id * 17) >>> 0);
      setPathTo(S, world, a, world.waypoints[r.int(0, world.waypoints.length - 1)].pos);
      brain.stuckT = 0;
    }
    brain.lastPos.copy(a.pos); brain.stuckT = 0;
  }
  if (brain.thinkT <= 0) {
    brain.thinkT = 0.2;
    acquireTarget(S, world, a);
    // hearing: investigate the newest nearby gunshot
    for (const n of S.shotNoise) {
      if (n.team !== a.team && S.time - n.t < 1 && dist2D(a.pos, n.pos) < 26) {
        brain.noisePos = n.pos; brain.noiseT = S.time;
      }
    }
    // repath timer for objective movement
    brain.repathT -= 0.2;
    if (brain.repathT <= 0 && !brain.target) {
      brain.repathT = 2.5;
      let dest = null;
      if (S.bomb.state === 'planted') {
        dest = (S.bomb.site === 'A' ? world.siteA : world.siteB).pos;
      } else if (a.team === 'A') {
        dest = pickSiteTarget(S, world, a).pos;
      } else if (brain.role === 'roam') {
        dest = world.waypoints[makeRng(S.tick + a.id).int(0, world.waypoints.length - 1)].pos;
      } else if (brain.holdPos && dist2D(a.pos, brain.holdPos) > 2) {
        dest = brain.holdPos;
      }
      if (dest) setPathTo(S, world, a, dest);
    }
  }

  const target = brain.target;
  // ---- combat ----
  // Bots aim by coordinates (api.fire takes an aim point), so an agent with
  // a live objective can shoot on the move: it fires at the target but its
  // feet and facing belong to the objective, never to a strafe duel. Two
  // drivers on the same yaw/velocity left carriers duelling in mid-map
  // until they died and the charge was never planted.
  if (target && target.alive) {
    const d = dist2D(a.pos, target.pos);
    const urgent = urgentObjective(S, a);
    const aimErr = 0.012 + d * 0.00045;
    brain.reactionT -= dt;
    if (!urgent) {
      const wantYaw = angleTo(a.pos, target.pos);
      a.yaw += Math.max(-4.5 * dt, Math.min(4.5 * dt, angDiff(a.yaw, wantYaw)));
    }
    if (brain.reactionT <= 0 && hasLineOfSight(a.pos, target.pos, world.colliders)) {
      if (brain.burstLeft <= 0) {
        if (brain.burstPause <= 0) { brain.burstLeft = 3 + Math.floor(Math.random() * 3); brain.burstPause = 0.55 + Math.random() * 0.6; }
        else brain.burstPause -= dt;
      } else if (a.fireCooldown <= 0 && a.reloading <= 0) {
        _v.copy(target.pos); _v.y += 1.25;
        api.fire(a, _v, aimErr);
        brain.burstLeft--;
      }
      if (!urgent) {
        if (brain.burstLeft > 0) {
          // stand still while bursting — stopping to aim pays; spraying on
          // the move is what lost attackers every duel (move spread).
          api.moveAgent(a, 0, 0, dt, true, true);
        } else {
          // strafe between bursts, slow for accuracy
          const strafe = Math.sin(S.time * 1.3 + a.id * 2.1) > 0 ? 1 : -1;
          const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
          const rx = Math.cos(a.yaw) * strafe, rz = -Math.sin(a.yaw) * strafe;
          const back = d < 6 ? -0.7 : 0;
          api.moveAgent(a, fx * back + rx * 0.6, fz * back + rz * 0.6, dt, true, true);
        }
        return;
      }
      // urgent: fired on the move — fall through to the objective below.
    } else if (!urgent && S.time - target.lastSeenT < 2) {
      // target known but no LOS: push to last seen position
      setPathTo(S, world, a, target.lastSeenPos); followPath(S, world, a, dt, api);
      return;
    }
    if (!urgent) return;
  }

  // ---- objective / idle ----
  brain.interact = null;
  // Utility on the execute: attackers lob their HE at the site as they
  // close in, softening the holders before the push.
  if (a.team === 'A' && (S.bomb.state === 'carried' || S.bomb.state === 'dropped')
    && a.grenades > 0 && !a.brain.naded) {
    const usite = a.brain.site === 'A' ? world.siteA : world.siteB;
    if (dist2D(a.pos, usite.pos) < 12) { api.grenade(a); a.brain.naded = true; }
  }
  if (S.bomb.state === 'planted') {
    const site = S.bomb.site === 'A' ? world.siteA : world.siteB;
    if (a.team === 'B') {
      const d = dist2D(a.pos, S.bomb.pos);
      const enemiesNear = S.agents.some(e => e.alive && e.team === 'A' && dist2D(e.pos, S.bomb.pos) < 12);
      if (d < 2.4 && !enemiesNear) { brain.interact = 'defuse'; a.yaw += Math.max(-3 * dt, Math.min(3 * dt, angDiff(a.yaw, angleTo(a.pos, S.bomb.pos)))); return; }
      followPath(S, world, a, dt, api);
      if (brain.pathI >= brain.path.length) setPathTo(S, world, a, S.bomb.pos);
    } else {
      // attackers: hold near the planted charge, watch approaches
      if (dist2D(a.pos, site.pos) > 6) { followPath(S, world, a, dt, api); if (brain.pathI >= brain.path.length) setPathTo(S, world, a, site.pos); }
      else { a.yaw += Math.max(-2 * dt, Math.min(2 * dt, angDiff(a.yaw, angleTo(a.pos, world.waypoints[11].pos)))); }
    }
    return;
  }
  if (a.team === 'A' && a.hasBomb) {
    const site = pickSiteTarget(S, world, a);
    const d = dist2D(a.pos, site.pos);
    if (d < 3.2) { brain.interact = 'plant'; return; }
    followPath(S, world, a, dt, api);
    if (brain.pathI >= brain.path.length) setPathTo(S, world, a, site.pos);
    return;
  }
  if (a.team === 'A' && S.bomb.state === 'dropped') {
    const d = dist2D(a.pos, S.bomb.pos);
    if (d < 1.6) { /* pickup handled by sim proximity */ }
    followPath(S, world, a, dt, api);
    if (brain.pathI >= brain.path.length) setPathTo(S, world, a, S.bomb.pos);
    return;
  }
  if (a.team === 'B' && brain.role !== 'roam') {
    // hold the site: sit at holdPos, scan the approaches
    if (brain.holdPos && dist2D(a.pos, brain.holdPos) > 1.5) {
      followPath(S, world, a, dt, api);
      if (brain.pathI >= brain.path.length) setPathTo(S, world, a, brain.holdPos);
    } else {
      brain.holdT += dt;
      const scanYaw = Math.sin(S.time * 0.5 + a.id) * 1.1 + angleTo(a.pos, world.waypoints[11].pos);
      a.yaw += Math.max(-1.6 * dt, Math.min(1.6 * dt, angDiff(a.yaw, scanYaw)));
      if (brain.noisePos && S.time - brain.noiseT < 2) { setPathTo(S, world, a, brain.noisePos); brain.noisePos = null; }
    }
    return;
  }
  // roamers and attackers without the bomb: push along the path
  followPath(S, world, a, dt, api);
  if (brain.pathI >= brain.path.length) {
    const dest = objectiveDest(S, world, a);
    if (dest) setPathTo(S, world, a, dest);
  }
}
