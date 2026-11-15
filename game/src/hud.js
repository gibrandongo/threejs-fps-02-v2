// DOM HUD — health, ammo, money, timer, score, minimap, killfeed,
// crosshair spread, buy menu and scoreboard. Reads state only; the sim
// never touches the DOM. Minimap is a 2D canvas redrawn each frame.
import { WEAPONS, WEAPON_ORDER, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';
import { TEAM_A, TEAM_B } from './state.js';

export function createHud(S, world, api) {
  const $ = (id) => document.getElementById(id);
  const els = {
    hud: $('hud'), minimap: $('minimap'), timer: $('timer'), roundlabel: $('roundlabel'),
    scoreA: $('scoreA'), scoreB: $('scoreB'), bomb: $('bombstatus'), killfeed: $('killfeed'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), hp: $('hpnum'), armor: $('armorfill'),
    mag: $('mag'), reserve: $('reserve'), wname: $('weaponname'), money: $('money'),
    grenades: $('grenades'), hint: $('hint'), plantbar: $('plantbar'), plantfill: $('plantfill'),
    objective: $('objective'), banner: $('banner'), vignette: $('vignette'), flash: $('flash'),
    buy: $('buy'), buygrid: $('buygrid'), buymoney: $('buymoney'),
    scoreboard: $('scoreboard'), sbTable: document.querySelector('#sb-table tbody'),
    sbScore: $('sb-score'), menu: $('menu'), death: $('deathscreen'), deathinfo: $('deathinfo'),
    matchend: $('matchend'), matchtitle: $('matchtitle'), matchscore: $('matchscore'),
  };
  const mm = els.minimap.getContext('2d');
  let lastHp = 100, hitT = 0, killT = 0, feedLen = 0;

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function show(el, on) { el.classList.toggle('hidden', !on); }

  function buildBuyMenu() {
    els.buygrid.innerHTML = '';
    const p = S.player;
    const items = WEAPON_ORDER.map((id, i) => {
      const w = WEAPONS[id];
      return { key: String(i + 1), id, name: w.name, price: w.price, desc: w.desc, owned: p.owned.includes(id) };
    });
    items.push({ key: '6', id: 'grenade', name: 'HE CHARGE', price: GRENADE_PRICE, desc: 'Frag grenade. Press G to throw.', owned: false });
    items.push({ key: '7', id: 'armor', name: 'KEVLAR ARMOR', price: ARMOR_PRICE, desc: 'Halves incoming damage for the round.', owned: p.armor > 0 });
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'buyitem' + (it.owned ? ' owned' : '') + (p.money < it.price && !it.owned ? ' cant' : '');
      b.innerHTML = `<span class="bp">${it.owned ? 'OWNED' : '$' + it.price}</span><span class="bn">${it.key}. ${it.name}</span><div class="bd">${it.desc}</div>`;
      b.addEventListener('click', () => api.buy(it.id));
      els.buygrid.appendChild(b);
    }
    els.buymoney.textContent = '$' + p.money;
  }

  function drawMinimap() {
    const W = 180, scale = W / 68;
    mm.clearRect(0, 0, W, W);
    mm.fillStyle = '#12161d'; mm.fillRect(0, 0, W, W);
    const X = (x) => (x + 34) * scale, Z = (z) => (z + 26) * scale;
    // walls
    mm.fillStyle = '#5a636e';
    for (const c of world.colliders) {
      mm.fillRect(X(c.min.x), Z(c.min.z), (c.max.x - c.min.x) * scale, (c.max.z - c.min.z) * scale);
    }
    // sites
    for (const s of [world.siteA, world.siteB]) {
      mm.fillStyle = s.id === 'A' ? '#2fa8d8' : '#ffb02e';
      mm.beginPath(); mm.arc(X(s.pos.x), Z(s.pos.z), 7, 0, 7); mm.fill();
      mm.fillStyle = '#fff'; mm.font = 'bold 11px Arial'; mm.textAlign = 'center';
      mm.fillText(s.id, X(s.pos.x), Z(s.pos.z) + 4);
    }
    // bomb
    if (S.bomb.state === 'planted' || S.bomb.state === 'dropped') {
      mm.fillStyle = '#ff4040';
      mm.beginPath(); mm.arc(X(S.bomb.pos.x), Z(S.bomb.pos.z), 4, 0, 7); mm.fill();
    }
    // agents: teammates always, enemies only if seen in the last 3 s
    for (const a of S.agents) {
      if (!a.alive) continue;
      const isEnemy = a.team !== 'A';
      if (isEnemy && S.time - a.lastSeenT > 3) continue;
      mm.fillStyle = isEnemy ? '#ff5d5d' : (a.isPlayer ? '#ffffff' : '#5ec8e8');
      mm.beginPath(); mm.arc(X(a.pos.x), Z(a.pos.z), a.isPlayer ? 4.5 : 3.5, 0, 7); mm.fill();
      if (a.isPlayer) {
        mm.strokeStyle = '#fff'; mm.beginPath();
        mm.moveTo(X(a.pos.x), Z(a.pos.z));
        mm.lineTo(X(a.pos.x) + Math.sin(a.yaw) * -10, Z(a.pos.z) + Math.cos(a.yaw) * -10);
        mm.stroke();
      }
    }
  }

  function updateKillfeed() {
    if (S.killfeed.length === feedLen) return;
    feedLen = S.killfeed.length;
    els.killfeed.innerHTML = '';
    for (const k of S.killfeed.slice(-5)) {
      const d = document.createElement('div');
      d.innerHTML = `<span class="k${k.aTeam}">${k.a}</span> <span class="kw">${k.headshot ? '◉ ' : ''}${k.weapon}</span> <span class="k${k.bTeam}">${k.b}</span>`;
      els.killfeed.appendChild(d);
    }
  }

  function update(dt) {
    const p = S.player;
    show(els.hud, S.phase !== 'menu');
    if (S.phase === 'menu') return;
    els.timer.textContent = fmtTime(S.timeLeft);
    els.roundlabel.textContent = 'ROUND ' + S.round + ' / 15';
    els.scoreA.textContent = S.wins.A; els.scoreB.textContent = S.wins.B;
    els.hp.textContent = Math.max(0, Math.ceil(p.hp));
    els.hp.style.color = p.hp > 50 ? '#e8ecf1' : p.hp > 25 ? '#ffb02e' : '#ff5d5d';
    els.armor.style.width = Math.min(100, p.armor) + '%';
    const w = WEAPONS[p.weaponId];
    els.mag.textContent = p.reloading > 0 ? '––' : p.mag;
    els.reserve.textContent = '/ ' + p.reserve;
    els.wname.textContent = w.name + (p.reloading > 0 ? ' — RELOADING' : '');
    els.money.textContent = '$' + p.money;
    els.grenades.textContent = p.grenades > 0 ? '◆ HE x' + p.grenades + '  [G]' : '';
    // crosshair spread from movement + firing heat
    const gap = 7 + p.spreadHeat * 26 + p.speedNow * 1.6 + (p.crouch ? -2 : 0);
    els.crosshair.style.setProperty('--gap', Math.max(5, gap).toFixed(1) + 'px');
    els.crosshair.style.opacity = p.alive ? '1' : '0';
    // hitmarker
    if (S.time - hitT < 0.18) els.hitmarker.style.opacity = '1';
    else els.hitmarker.style.opacity = '0';
    els.hitmarker.classList.toggle('kill', S.time - killT < 0.5);
    // damage vignette
    const hurt = p.alive ? Math.max(0, (S.time - p.lastHurtT)) : 1;
    const low = p.alive && p.hp <= 30 ? 0.35 : 0;
    const v = Math.max(low, hurt < 0.6 ? 0.55 * (1 - hurt / 0.6) : 0);
    els.vignette.style.boxShadow = `inset 0 0 120px rgba(255,0,0,${v.toFixed(2)})`;
    if (p.hp < lastHp) { /* flash handled by hurt event */ }
    lastHp = p.hp;
    // bomb status
    if (S.bomb.state === 'planted') els.bomb.textContent = '⚠ CHARGE PLANTED — ' + fmtTime(S.bomb.timer) + (S.bomb.site ? ' · SITE ' + S.bomb.site : '');
    else if (S.bomb.state === 'carried') els.bomb.textContent = p.hasBomb ? 'YOU CARRY THE CHARGE — plant at Site A or B [E]' : 'Charge with ' + (S.agents[S.bomb.carrier] || {}).name;
    else if (S.bomb.state === 'dropped') els.bomb.textContent = '⚠ CHARGE DROPPED — pick it up';
    else els.bomb.textContent = '';
    // hint + plant/defuse bar
    const prog = Math.max(p.plantT / 4, p.defuseT / 5);
    if (prog > 0) {
      els.plantbar.style.display = 'block';
      els.plantfill.style.width = (prog * 100).toFixed(0) + '%';
      els.hint.textContent = p.plantT > 0 ? 'PLANTING…' : 'DEFUSING…';
    } else {
      els.plantbar.style.display = 'none';
      els.hint.textContent = api.hintText();
    }
    els.objective.textContent = S.phase === 'freeze'
      ? 'FREEZE TIME — buy up, then the round starts'
      : S.bomb.state === 'planted' ? 'Defend the charge — Sentinel must defuse it'
        : 'Plant the charge at Site A (Crane) or Site B (Silo), or eliminate Sentinel';
    // banner
    if (S.banner && S.time - S.bannerT < 4.5) {
      els.banner.classList.remove('hidden');
      els.banner.innerHTML = S.banner;
    } else els.banner.classList.add('hidden');
    // death / match end
    show(els.death, !p.alive && S.phase === 'live');
    if (!p.alive && S.phase === 'live') els.deathinfo.textContent = 'Spectating your squad — ' + S.agents.filter(a => a.alive && a.team === 'A').length + ' Vanguard still up.';
    show(els.matchend, S.phase === 'matchend');
    if (S.phase === 'matchend') {
      els.matchtitle.textContent = S.matchWinner === 'A' ? 'VICTORY' : 'DEFEAT';
      els.matchtitle.style.color = S.matchWinner === 'A' ? '#7ee081' : '#ff5d5d';
      els.matchscore.textContent = 'Final score — Vanguard ' + S.wins.A + ' : ' + S.wins.B + ' Sentinel · Rounds played: ' + S.stats.roundsPlayed;
    }
    updateKillfeed();
    drawMinimap();
  }

  function showScoreboard(on) {
    show(els.scoreboard, on);
    if (!on) return;
    els.sbScore.textContent = S.wins.A + ' — ' + S.wins.B;
    els.sbTable.innerHTML = '';
    for (const a of [...S.agents].sort((x, y) => y.kills - x.kills)) {
      const tr = document.createElement('tr');
      tr.className = a.team === 'A' ? 'rowA' : 'rowB';
      tr.innerHTML = `<td>${a.name}${a.isPlayer ? ' (YOU)' : ''}${a.hasBomb ? ' 💣' : ''}</td><td>${a.team === 'A' ? TEAM_A : TEAM_B}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td><td>${WEAPONS[a.weaponId].name}</td>`;
      els.sbTable.appendChild(tr);
    }
  }

  return {
    update, showScoreboard, buildBuyMenu,
    showBuy(on) { show(els.buy, on); if (on) buildBuyMenu(); },
    showMenu(on) { show(els.menu, on); },
    hitmark(kill) { hitT = S.time; if (kill) killT = S.time; },
    flash() { els.flash.style.opacity = '0.7'; setTimeout(() => { els.flash.style.opacity = '0'; }, 60); },
    setBanner(html) { S.banner = html; S.bannerT = S.time; },
  };
}
