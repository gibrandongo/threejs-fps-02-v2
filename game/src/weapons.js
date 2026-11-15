// Weapon definitions — one table drives HUD, buy menu, sim damage and audio.
// Damage is per pellet; headshots multiply, long range falls off. Accuracy
// beats speed: spread grows while moving, airborne or spraying.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 SIDEARM', price: 0, damage: 26, headMult: 2.5, legMult: 0.7,
    pellets: 1, interval: 0.16, auto: false, mag: 15, reserve: 90, reload: 1.4,
    spread: 0.011, moveSpread: 0.030, range: 40, falloff: 0.72, kick: 0.011,
    tracer: 0xffe9a8, sound: 'pistol', desc: 'Reliable sidearm. Free, always owned.',
  },
  smg: {
    id: 'smg', name: 'VK-9 SMG', price: 1500, damage: 24, headMult: 2.2, legMult: 0.7,
    pellets: 1, interval: 0.085, auto: true, mag: 28, reserve: 112, reload: 1.9,
    spread: 0.020, moveSpread: 0.042, range: 28, falloff: 0.62, kick: 0.009,
    tracer: 0xffd27a, sound: 'smg', desc: 'Fast close-quarters spray. Punished at range.',
  },
  shotgun: {
    id: 'shotgun', name: 'M590 BREACHER', price: 1200, damage: 9, headMult: 1.8, legMult: 0.7,
    pellets: 8, interval: 0.9, auto: false, mag: 6, reserve: 24, reload: 2.6,
    spread: 0.052, moveSpread: 0.07, range: 14, falloff: 0.4, kick: 0.045,
    tracer: 0xffc46b, sound: 'shotgun', desc: 'Eight pellets. Devastating up close, useless far.',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 LONGSHOT', price: 2700, damage: 34, headMult: 2.6, legMult: 0.7,
    pellets: 1, interval: 0.11, auto: true, mag: 25, reserve: 100, reload: 2.2,
    spread: 0.008, moveSpread: 0.026, range: 60, falloff: 0.8, kick: 0.016,
    tracer: 0xfff2c0, sound: 'rifle', desc: 'The workhorse. Rewards stopping to aim.',
  },
  sniper: {
    id: 'sniper', name: 'LR-50 RAIL', price: 4750, damage: 110, headMult: 2.2, legMult: 0.7,
    pellets: 1, interval: 1.25, auto: false, mag: 5, reserve: 15, reload: 3.0,
    spread: 0.0015, moveSpread: 0.09, range: 120, falloff: 0.95, kick: 0.07,
    tracer: 0x9fd8ff, sound: 'sniper', desc: 'One shot, one down. Right-click to zoom. Slow.',
  },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const WEAPON_ORDER = ['p9', 'smg', 'shotgun', 'rifle', 'sniper'];
export const ECONOMY = {
  startMoney: 800, killReward: 300, plantReward: 300,
  winReward: 3250, lossReward: 1900, lossStreakBonus: 500, maxLossReward: 3400,
};
