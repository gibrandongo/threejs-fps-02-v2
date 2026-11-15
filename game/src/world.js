// Foundry Yard — BREAKLINE's original map. A 64 x 48 m industrial yard:
// three lanes (west / mid / east) from the south spawn to two bomb sites
// in the north corners. All art is procedural: canvas textures, flat
// colours and a dusk palette. Collision is a list of AABBs; line of sight
// is a segment-vs-AABB slab test, so the sim never needs the renderer.
import * as THREE from 'three';
import { makeRng } from './rng.js';

export const MAP = { w: 64, d: 48, wallH: 5 };

function canvasTex(size, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function concreteTex() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#5a6068'; g.fillRect(0, 0, s, s);
    const r = makeRng(7);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${20 + r.int(0, 40)},${20 + r.int(0, 40)},${25 + r.int(0, 40)},0.25)`;
      g.fillRect(r.range(0, s), r.range(0, s), r.range(1, 4), r.range(1, 4));
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, s); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(s, i * 64); g.stroke();
    }
  }, 8, 6);
}
function hazardTex() {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#c9a227'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#15181c';
    for (let i = -2; i < 6; i++) {
      g.beginPath(); g.moveTo(i * 32, s); g.lineTo(i * 32 + 16, s); g.lineTo(i * 32 + 48, 0); g.lineTo(i * 32 + 32, 0); g.closePath(); g.fill();
    }
  });
}
function metalTex(base) {
  return canvasTex(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < s; y += 16) g.fillRect(0, y, s, 3);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 8; y < s; y += 16) g.fillRect(0, y, s, 2);
  }, 2, 1);
}
function signTex(text, fg, bg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 96);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(4, 4, 248, 88);
  g.fillStyle = fg; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- collision -----------------------------------------------------------
export function segmentBlocked(a, b, colliders) {
  // Slab test: true if segment a->b hits any AABB.
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  for (const c of colliders) {
    let t0 = 0, t1 = 1, ok = true;
    const axes = [[a.x, dx, c.min.x, c.max.x], [a.y, dy, c.min.y, c.max.y], [a.z, dz, c.min.z, c.max.z]];
    for (const [o, d, mn, mx] of axes) {
      if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } }
      else {
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok) return true;
  }
  return false;
}
export function hasLineOfSight(a, b, colliders) {
  const pa = new THREE.Vector3(a.x, a.y + 1.45, a.z);
  const pb = new THREE.Vector3(b.x, b.y + 1.35, b.z);
  return !segmentBlocked(pa, pb, colliders);
}
// Push a standing body (radius r, feet at pos.y) out of every AABB it overlaps.
export function collideMove(pos, r, colliders) {
  for (const c of colliders) {
    if (pos.y + 1.7 < c.min.y || pos.y > c.max.y) continue;
    const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
    const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * r; pos.z = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const px = Math.min(pos.x - c.min.x + r, c.max.x - pos.x + r);
        const pz = Math.min(pos.z - c.min.z + r, c.max.z - pos.z + r);
        if (px < pz) pos.x = (pos.x - c.min.x < c.max.x - pos.x) ? c.min.x - r : c.max.x + r;
        else pos.z = (pos.z - c.min.z < c.max.z - pos.z) ? c.min.z - r : c.max.z + r;
      }
    }
  }
  pos.x = Math.max(-MAP.w / 2 + 0.6, Math.min(MAP.w / 2 - 0.6, pos.x));
  pos.z = Math.max(-MAP.d / 2 + 0.6, Math.min(MAP.d / 2 - 0.6, pos.z));
}

// ---- world build ---------------------------------------------------------
export function buildWorld(scene) {
  const colliders = [];
  const wallMeshes = [];
  const rng = makeRng(20261115);
  const concrete = concreteTex(), hazard = hazardTex();
  const matWall = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.95 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.9 });
  const matRust = new THREE.MeshStandardMaterial({ map: metalTex('#7a4a2b'), roughness: 0.8, metalness: 0.25 });
  const matBlue = new THREE.MeshStandardMaterial({ map: metalTex('#2b4a6b'), roughness: 0.75, metalness: 0.3 });
  const matTeal = new THREE.MeshStandardMaterial({ map: metalTex('#2b6b5e'), roughness: 0.75, metalness: 0.3 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0x8a6f3f, roughness: 0.9 });
  const matHazard = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.85 });

  function box(x, y, z, w, h, d, mat, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z); m.castShadow = false; m.receiveShadow = false;
    scene.add(m); wallMeshes.push(m);
    if (collide) colliders.push({ min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2) });
    return m;
  }
  function barrel(x, z) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: rng.pick([0x8a2f2f, 0x2f5e8a, 0x5e7a2f]), roughness: 0.7, metalness: 0.4 }));
    m.position.set(x, 0.6, z); scene.add(m); wallMeshes.push(m);
    colliders.push({ min: new THREE.Vector3(x - 0.55, 0, z - 0.55), max: new THREE.Vector3(x + 0.55, 1.2, z + 0.55) });
  }

  // ground + sky
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w + 40, MAP.d + 40),
    new THREE.MeshStandardMaterial({ map: concrete, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = 0; scene.add(ground);
  scene.background = new THREE.Color(0x1a2029);
  scene.fog = new THREE.Fog(0x1a2029, 45, 110);
  const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x2a2118, 1.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.0); sun.position.set(20, 30, 12); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x5e7fa8, 0.7); fill.position.set(-18, 14, -10); scene.add(fill);

  // perimeter
  box(0, 0, -MAP.d / 2 - 0.5, MAP.w + 2, MAP.wallH, 1, matWall);
  box(0, 0, MAP.d / 2 + 0.5, MAP.w + 2, MAP.wallH, 1, matWall);
  box(-MAP.w / 2 - 0.5, 0, 0, 1, MAP.wallH, MAP.d + 2, matWall);
  box(MAP.w / 2 + 0.5, 0, 0, 1, MAP.wallH, MAP.d + 2, matWall);
  // hazard trim along the north wall
  box(0, 0, -MAP.d / 2 + 0.05, MAP.w, 0.5, 0.3, matHazard, false);

  // interior: three lanes. Long walls + crates + containers make corners.
  // mid divider stubs (leave gaps so lanes connect at z = 0 and z = -8)
  box(-10.5, 0, 8, 1, 3.2, 16, matWall);            // west/mid divider, south half
  box(-10.5, 0, -14, 1, 3.2, 8, matWall);           // west/mid divider, north stub
  box(10.5, 0, 8, 1, 3.2, 16, matWall);             // mid/east divider, south half
  box(10.5, 0, -14, 1, 3.2, 8, matWall);            // mid/east divider, north stub
  box(0, 0, -4, 21, 2.6, 1, matWall);               // mid cross wall with gaps at |x|>10.5
  // site A (west) structures
  box(-22, 0, -18, 8, 3.6, 1.2, matBlue);           // crane base back wall
  box(-26, 0, -10, 1.2, 3.6, 6, matBlue);
  box(-18, 0, -20, 5, 1.2, 5, matRust);             // low crate platform A
  box(-24, 0, -16, 2, 2.4, 2, matCrate);
  // site B (east) structures
  box(22, 0, -18, 8, 3.6, 1.2, matTeal);
  box(26, 0, -10, 1.2, 3.6, 6, matTeal);
  box(18, 0, -20, 5, 1.2, 5, matRust);
  box(24, 0, -16, 2, 2.4, 2, matCrate);
  // mid containers + crates (cover in the lanes)
  box(-5, 0, 12, 6, 2.6, 2.4, matRust);
  box(6, 0, 14, 2.4, 1.3, 2.4, matCrate);
  box(0, 0, -12, 2.4, 1.3, 2.4, matCrate);
  box(-15, 0, 2, 4, 2.6, 2.4, matBlue);
  box(15, 0, 2, 4, 2.6, 2.4, matTeal);
  box(-14, 0, -6, 2.2, 1.2, 2.2, matCrate);
  box(14, 0, -6, 2.2, 1.2, 2.2, matCrate);
  box(-2, 0, 18, 3, 1.2, 2, matCrate);
  barrel(-8, 16); barrel(8, -2); barrel(-26, 6); barrel(26, 6); barrel(0, -18);
  // spawn cover
  box(-14, 0, 20, 6, 2.2, 1.2, matDark);
  box(14, 0, 20, 6, 2.2, 1.2, matDark);
  box(-14, 0, -21, 6, 2.2, 1.2, matDark);
  box(14, 0, -21, 6, 2.2, 1.2, matDark);

  // site markers: glowing ring + floating sign
  function siteMarker(x, z, label, color) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.8, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.06, z); scene.add(ring);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.65),
      new THREE.MeshBasicMaterial({ map: signTex(label, '#ffffff', color === 0x2fa8d8 ? '#0d3a4d' : '#4d3a0d'), transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
    sign.position.set(x, 3.4, z); scene.add(sign);
    const glow = new THREE.PointLight(color, 12, 14); glow.position.set(x, 2.5, z); scene.add(glow);
    return { ring, sign };
  }
  const siteA = { id: 'A', name: 'SITE A — CRANE', pos: new THREE.Vector3(-22, 0, -15), color: 0x2fa8d8, ...siteMarker(-22, -15, 'SITE A', 0x2fa8d8) };
  const siteB = { id: 'B', name: 'SITE B — SILO', pos: new THREE.Vector3(22, 0, -15), color: 0xffb02e, ...siteMarker(22, -15, 'SITE B', 0xffb02e) };

  // spawns
  const spawnsA = [
    new THREE.Vector3(-14, 0, 22), new THREE.Vector3(-7, 0, 22), new THREE.Vector3(0, 0, 22),
    new THREE.Vector3(7, 0, 22), new THREE.Vector3(14, 0, 22),
  ];
  const spawnsB = [
    new THREE.Vector3(-14, 0, -21), new THREE.Vector3(-7, 0, -21), new THREE.Vector3(0, 0, -21),
    new THREE.Vector3(7, 0, -21), new THREE.Vector3(14, 0, -21),
  ];

  // waypoint graph — lanes + connectors + site approaches
  const wpPos = [
    [-20, 20], [-10, 20], [0, 20], [10, 20], [20, 20],          // 0-4 spawn row
    [-20, 10], [-5, 10], [5, 10], [20, 10],                     // 5-8
    [-20, 0], [-5, 0], [5, 0], [20, 0],                         // 9-12 mid cross
    [-20, -8], [-5, -8], [5, -8], [20, -8],                     // 13-16
    [-22, -15], [22, -15],                                      // 17-18 sites
    [-14, -18], [14, -18], [-26, -6], [26, -6],                 // 19-22 site corners
    [0, -16], [0, 4], [-14, 14], [14, 14],                      // 23-26
  ];
  const waypoints = wpPos.map(([x, z], i) => ({ id: i, pos: new THREE.Vector3(x, 0, z), links: [] }));
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i].pos, b = waypoints[j].pos;
      if (a.distanceTo(b) > 16) continue;
      if (segmentBlocked(new THREE.Vector3(a.x, 1, a.z), new THREE.Vector3(b.x, 1, b.z), colliders)) continue;
      waypoints[i].links.push(j); waypoints[j].links.push(i);
    }
  }
  return { colliders, wallMeshes, siteA, siteB, spawnsA, spawnsB, waypoints };
}

export function nearestWaypoint(pos, waypoints) {
  let best = 0, bd = Infinity;
  for (const w of waypoints) { const d = w.pos.distanceToSquared(pos); if (d < bd) { bd = d; best = w.id; } }
  return best;
}
// BFS over the waypoint graph; returns an array of waypoint ids.
export function findPath(from, to, waypoints) {
  if (from === to) return [to];
  const prev = new Array(waypoints.length).fill(-1);
  const q = [from]; prev[from] = from;
  while (q.length) {
    const cur = q.shift();
    for (const n of waypoints[cur].links) {
      if (prev[n] !== -1) continue;
      prev[n] = cur;
      if (n === to) {
        const path = [to]; let c = to;
        while (c !== from) { c = prev[c]; path.unshift(c); }
        return path;
      }
      q.push(n);
    }
  }
  return [to];
}
