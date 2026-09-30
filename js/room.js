/* ============================================================
   Sound Room · Room
   等距房间渲染（Kenney 素材）+ 粒子 + 猫/落地钟/烛火绘制 + 交互
   M2：六物件全接 + 混音推子台 + 预设配方
   ============================================================ */
'use strict';

/* ---------- 视口与等距坐标 ---------- */
const VIEW = { w: 1000, h: 860 };
const CX = 500, CY = 400;      // 房间中心（格子 0,0 的锚点）
const STEP_X = 96, STEP_Y = 48; // 256×512 sprite @ 0.75 缩放后的等距步长
const SC = 0.75, SPR_W = 256 * SC, SPR_H = 512 * SC;

const iso = (i, j) => ({ x: CX + (i - j) * STEP_X, y: CY + (i + j) * STEP_Y });

/* ---------- 精灵加载 ---------- */
const SPRITES = {
  tile:        'assets/sprites/stoneTile_N.png',
  wall:        'assets/sprites/stoneWall_N.png',
  window:      'assets/sprites/stoneWallWindow_N.png',
  arch:        'assets/sprites/stoneWallArchway_N.png',
  bookcaseW:   'assets/sprites/bookcaseWideBooks_N.png',
  bookcase:    'assets/sprites/bookcaseBooks_N.png',
  bookcaseH:   'assets/sprites/bookcaseHalfBooks_N.png',
  display:     'assets/sprites/displayCaseBooks_N.png',
  carpet:      'assets/sprites/floorCarpet_N.png',
  longTable:   'assets/sprites/longTable_N.png',
  roundTable:  'assets/sprites/tableRoundItemsChairs_N.png',
  chair:       'assets/sprites/libraryChair_N.png',
  candleD:     'assets/sprites/candleStandDouble_N.png',
  candle:      'assets/sprites/candleStand_N.png',
  bookStand:   'assets/sprites/bookStand_N.png',
};
const img = {};
let loadedCount = 0;
const loadPromises = Object.entries(SPRITES).map(([k, src]) => new Promise(res => {
  const im = new Image();
  im.onload = () => { img[k] = im; loadedCount++; res(); };
  im.onerror = () => { console.warn('sprite 加载失败', src); res(); };
  im.src = src;
}));

/* ---------- 场景定义（painter 顺序 = i+j 升序） ---------- */
// 地板 5×5
const tiles = [];
for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) tiles.push({ k: 'tile', i, j });
// 后墙（j=-0.5 线）与左墙（i=-0.5 线）
const walls = [
  { k: 'wall',      i: -0.5, j: -0.5 },
  { k: 'wall',      i: 0,    j: -0.5 },
  { k: 'bookcaseW', i: 1,    j: -0.5 },
  { k: 'window',    i: 2,    j: -0.5, id: 'window' },
  { k: 'bookcase',  i: 3,    j: -0.5 },
  { k: 'wall',      i: 4,    j: -0.5 },
  { k: 'wall',      i: -0.5, j: 0 },
  { k: 'bookcaseH', i: -0.5, j: 0 },
  { k: 'arch',      i: -0.5, j: 1, id: 'fire' },
  { k: 'wall',      i: -0.5, j: 2 },
  { k: 'display',   i: -0.5, j: 3 },
  { k: 'wall',      i: -0.5, j: 4 },
];
// 地面物件
const props = [
  { k: 'longTable',  i: 1,    j: 3 },
  { k: 'chair',      i: 1.9,  j: 3.2 },
  { k: 'carpet',     i: 2,    j: 2 },
  { k: 'roundTable', i: 3.1,  j: 2.1, id: 'tea' },
  { k: 'bookStand',  i: 3.6,  j: 0.8 },
  { k: 'candleD',    i: 4,    j: -0.15, id: 'candle' },
  { k: 'candle',     i: 0.6,  j: 3.6 },
  { k: 'clock',      i: 4.35, j: 0.35, id: 'clock' },  // 自绘落地钟
  { k: 'cat',        i: 2.3,  j: 1.95, id: 'cat' },    // 自绘猫
];
const scene = [...tiles, ...walls, ...props].sort((a, b) => (a.i + a.j) - (b.i + b.j));

/* ---------- 关键锚点 ---------- */
const P = {
  window: iso(2, -0.5),
  fire:   { x: iso(-0.5, 1).x - 38, y: iso(-0.5, 1).y },  // 对齐拱门开口中心
  tea:    iso(3.1, 2.1),
  clock:  iso(4.35, 0.35),
  cat:    iso(2.3, 1.95),
  candleD:iso(4, -0.15),
  candle: iso(0.6, 3.6),
};
const RAIN_RECT = { x: P.window.x - 50, y: P.window.y - 218, w: 100, h: 145 };

/* ---------- 六声轨定义 ---------- */
const TRACKS = [
  { key: 'rain',   name: '雨声',     obj: 'window' },
  { key: 'fire',   name: '柴火噼啪', obj: 'fire' },
  { key: 'tea',    name: '沸水咕嘟', obj: 'tea' },
  { key: 'candle', name: '烛火轻响', obj: 'candle' },
  { key: 'cat',    name: '呼噜',     obj: 'cat' },
  { key: 'tick',   name: '钟摆滴答', obj: 'clock' },
];
const trackByKey = k => TRACKS.find(t => t.key === k);
const trackByObj = o => TRACKS.find(t => t.obj === o);

/* ---------- 状态 ---------- */
const state = {
  on:   { rain: false, fire: true, cat: false, tick: false, tea: false, candle: false },
  vols: { rain: 0.6, fire: 0.55, cat: 0.55, tick: 0.3, tea: 0.4, candle: 0.35 },
  rainLevel: 0,   // 0-1 雨强度（粒子/音量插值）
  teaLevel: 0,    // 茶炉蒸汽强度
  candleLevel: 0, // 烛火强度
  flash: 0,       // 闪电亮度 0-1
  shake: 0,       // 窗玻璃震动 0-1
  nextThunderAt: 0,
  sleep: null,    // { end, total } 睡眠定时（墙钟）
  _dim: 0,        // 定时结束前画面渐暗 0-1
  hovered: null,
};

/* ---------- 月光光柱 + 尘埃 ---------- */
// 从窗口斜射到地板的平行四边形（视觉：冷蓝微光）
const BEAM = [
  { x: P.window.x - 38, y: P.window.y - 200 },
  { x: P.window.x + 34, y: P.window.y - 200 },
  { x: P.window.x - 96, y: P.window.y + 168 },
  { x: P.window.x - 172, y: P.window.y + 168 },
];
const dustMotes = Array.from({ length: 16 }, () => ({
  x: Math.random(), y: Math.random(), s: 0.3 + Math.random() * 0.7, ph: Math.random() * Math.PI * 2,
}));
function beamBounds() {
  return {
    x0: Math.min(BEAM[0].x, BEAM[3].x), x1: Math.max(BEAM[1].x, BEAM[2].x),
    y0: BEAM[0].y, y1: BEAM[2].y,
  };
}

/* ---------- 画布 ---------- */
const cvsScene = document.getElementById('scene');
const cvsFx = document.getElementById('fx');
const cvsLight = document.getElementById('light');
const ctxS = cvsScene.getContext('2d');
const ctxF = cvsFx.getContext('2d');
const ctxL = cvsLight.getContext('2d');
function fitCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = VIEW.w * dpr; c.height = VIEW.h * dpr;
  c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas(cvsScene); fitCanvas(cvsFx); fitCanvas(cvsLight);

/* ---------- 自绘：猫 ---------- */
function drawCat(ctx, x, y, t, purring) {
  const br = 1 + Math.sin(t * 1.6) * 0.05;             // 呼吸
  const twitch = Math.sin(t * 0.7) > 0.97 ? 4 : 0;      // 偶尔耳动
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1.7, 1.7 * br);
  // 尾巴：缓慢摆动
  ctx.strokeStyle = '#989486'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(30, -8);
  ctx.quadraticCurveTo(50, -12 + Math.sin(t * 0.9) * 5, 46, -28 + Math.sin(t * 0.9) * 4);
  ctx.stroke();
  // 身体（蜷团）
  ctx.fillStyle = '#B0ACA0';
  ctx.beginPath(); ctx.ellipse(0, -16, 34, 20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7A766B'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#989486';
  ctx.beginPath(); ctx.ellipse(-4, -12, 26, 13, 0, 0, Math.PI * 2); ctx.fill();
  // 头
  ctx.fillStyle = '#B0ACA0';
  ctx.beginPath(); ctx.arc(-26, -22, 15, 0, Math.PI * 2); ctx.fill();
  ctx.stroke();
  // 耳
  ctx.fillStyle = '#989486';
  ctx.beginPath(); ctx.moveTo(-36, -34); ctx.lineTo(-33, -45 + twitch); ctx.lineTo(-27, -35); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-25, -36); ctx.lineTo(-20, -46); ctx.lineTo(-16, -35); ctx.closePath(); ctx.fill();
  // 呼噜时的 Zzz
  if (purring && Math.sin(t * 0.5) > 0.6) {
    ctx.fillStyle = 'rgba(200,205,230,.85)';
    ctx.font = '600 13px Georgia';
    ctx.fillText('z', -40, -50 - (t % 1) * 10);
  }
  ctx.restore();
}

/* ---------- 自绘：落地钟（真实时间钟面） ---------- */
function drawClock(ctx, x, y, t) {
  ctx.save();
  ctx.translate(x, y);
  // 钟壳
  ctx.fillStyle = '#4A3626';
  ctx.beginPath();
  ctx.moveTo(-30, 0); ctx.lineTo(-30, -170); ctx.arc(0, -170, 30, Math.PI, 0);
  ctx.lineTo(30, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5A4433';
  ctx.fillRect(-24, -140, 48, 120);
  // 钟面
  ctx.fillStyle = '#E8DCC4';
  ctx.beginPath(); ctx.arc(0, -170, 24, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4A3626'; ctx.lineWidth = 3; ctx.stroke();
  const d = new Date();
  const mm = d.getMinutes() + d.getSeconds() / 60;
  const hh = (d.getHours() % 12) + mm / 60;
  ctx.strokeStyle = '#1A1A18'; ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -170);
  ctx.lineTo(Math.sin(hh / 12 * Math.PI * 2) * 12, -170 - Math.cos(hh / 12 * Math.PI * 2) * 12);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -170);
  ctx.lineTo(Math.sin(mm / 60 * Math.PI * 2) * 18, -170 - Math.cos(mm / 60 * Math.PI * 2) * 18);
  ctx.stroke();
  // 钟摆
  const sw = Math.sin(t * 2.2) * 0.35;
  ctx.strokeStyle = '#C9A45C'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -130);
  ctx.lineTo(Math.sin(sw) * 55, -130 + Math.cos(sw) * 55); ctx.stroke();
  ctx.fillStyle = '#C9A45C';
  ctx.beginPath(); ctx.arc(Math.sin(sw) * 55, -130 + Math.cos(sw) * 55, 9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ---------- 场景静态渲染 ---------- */
const FLOOR_POLYGON = [iso(0, 0), iso(0, 4), iso(4, 4), iso(4, 0)];
function drawScene() {
  ctxS.clearRect(0, 0, VIEW.w, VIEW.h);
  // 地板基座（填补 tile 缝隙，避免"黑洞"感）
  ctxS.fillStyle = '#333952';
  ctxS.beginPath();
  ctxS.moveTo(FLOOR_POLYGON[0].x, FLOOR_POLYGON[0].y + 8);
  FLOOR_POLYGON.forEach(p => ctxS.lineTo(p.x, p.y + 8));
  ctxS.closePath(); ctxS.fill();
  for (const o of scene) {
    const p = iso(o.i, o.j);
    if (o.k === 'cat') { drawCat(ctxS, p.x, p.y, performance.now() / 1000, state.on.cat); continue; }
    if (o.k === 'clock') { drawClock(ctxS, p.x, p.y, performance.now() / 1000); continue; }
    const im = img[o.k];
    if (im) ctxS.drawImage(im, p.x - SPR_W / 2, p.y - SPR_H, SPR_W, SPR_H);
    // 悬停高亮
    if (state.hovered && o.id === state.hovered.id) {
      const g = ctxS.createRadialGradient(p.x, p.y - 120, 10, p.x, p.y - 120, 150);
      g.addColorStop(0, 'rgba(242,166,90,.22)'); g.addColorStop(1, 'rgba(242,166,90,0)');
      ctxS.fillStyle = g;
      ctxS.fillRect(p.x - 160, p.y - 280, 320, 300);
    }
  }
}

/* ---------- 粒子 ---------- */
const rainDrops = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 }));
const sparks = Array.from({ length: 24 }, () => ({ x: Math.random() * 30 - 15, y: 0, v: 20 + Math.random() * 40, drift: Math.random() * 20 - 10 }));
const steams = Array.from({ length: 7 }, () => ({ x: Math.random() * 14 - 7, y: Math.random() * 40, v: 12 + Math.random() * 14 }));
let fireFlicker = 1, candleFlicker = 1;

function drawParticles(dt, t) {
  ctxF.clearRect(0, 0, VIEW.w, VIEW.h);

  /* 调试：标出关键锚点（?debug=1） */
  if (state._debug) {
    ctxF.font = '12px monospace';
    [['fire', P.fire], ['window', P.window], ['cat', P.cat], ['tea', P.tea], ['candle', P.candleD]].forEach(([n, p]) => {
      ctxF.fillStyle = '#ff3355';
      ctxF.beginPath(); ctxF.arc(p.x, p.y, 5, 0, Math.PI * 2); ctxF.fill();
      ctxF.fillText(n, p.x + 8, p.y);
      ctxF.strokeStyle = '#ff3355'; ctxF.strokeRect(RAIN_RECT.x, RAIN_RECT.y, RAIN_RECT.w, RAIN_RECT.h);
    });
  }

  /* 雨（裁剪到窗玻璃区；雷声时玻璃轻震） */
  if (state.rainLevel > 0.01) {
    const ox = state.shake > 0.01 ? Math.sin(t * 70) * 3 * state.shake : 0;
    const oy = state.shake > 0.01 ? Math.cos(t * 83) * 2 * state.shake : 0;
    ctxF.save();
    ctxF.beginPath(); ctxF.rect(RAIN_RECT.x + ox, RAIN_RECT.y + oy, RAIN_RECT.w, RAIN_RECT.h); ctxF.clip();
    ctxF.strokeStyle = `rgba(160,180,235,${0.5 * state.rainLevel})`;
    ctxF.lineWidth = 1.2;
    const n = Math.floor(rainDrops.length * state.rainLevel);
    for (let k = 0; k < n; k++) {
      const d = rainDrops[k];
      d.y += d.s * dt * 1.6; if (d.y > 1) { d.y = 0; d.x = Math.random(); }
      const px = RAIN_RECT.x + d.x * RAIN_RECT.w, py = RAIN_RECT.y + d.y * RAIN_RECT.h;
      ctxF.beginPath(); ctxF.moveTo(px, py); ctxF.lineTo(px - 2, py + 9 * d.s); ctxF.stroke();
    }
    ctxF.restore();
    // 窗台溅落
    ctxF.fillStyle = `rgba(160,180,235,${0.25 * state.rainLevel})`;
    for (let k = 0; k < 6; k++) {
      const sx = RAIN_RECT.x + ((t * 130 + k * 37) % RAIN_RECT.w);
      ctxF.fillRect(sx, RAIN_RECT.y + RAIN_RECT.h - 2, 3, 2);
    }
  }

  /* 月光光柱 + 尘埃（常驻氛围，壁纸感） */
  ctxF.save();
  ctxF.globalCompositeOperation = 'lighter';
  const bg = ctxF.createLinearGradient(0, BEAM[0].y, 0, BEAM[2].y);
  bg.addColorStop(0, 'rgba(123,140,222,.13)');
  bg.addColorStop(1, 'rgba(123,140,222,.02)');
  ctxF.fillStyle = bg;
  ctxF.beginPath();
  ctxF.moveTo(BEAM[0].x, BEAM[0].y);
  BEAM.slice(1).forEach(p => ctxF.lineTo(p.x, p.y));
  ctxF.closePath(); ctxF.fill();
  // 尘埃在光柱内缓浮
  const bb = beamBounds();
  dustMotes.forEach(m => {
    m.y += dt * 0.012 * m.s; m.x += dt * 0.004 * m.s;
    if (m.y > 1) { m.y = 0; m.x = Math.random(); }
    const a = 0.07 + 0.06 * (1 + Math.sin(t * 1.5 + m.ph)) / 2;
    ctxF.fillStyle = `rgba(200,210,245,${a})`;
    ctxF.fillRect(bb.x0 + m.x * (bb.x1 - bb.x0), bb.y0 + m.y * (bb.y1 - bb.y0), 2, 2);
  });
  ctxF.restore();

  /* 壁炉：火焰 + 火星 */
  if (state.on.fire) {
    fireFlicker = 0.85 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23 + 1) * 0.07;
    const fx = P.fire.x, fy = P.fire.y - 46;
    ctxF.save();
    // 木柴堆
    ctxF.fillStyle = '#4A3626';
    ctxF.fillRect(fx - 26, fy - 6, 52, 8);
    ctxF.fillStyle = '#5A4433';
    ctxF.fillRect(fx - 20, fy - 12, 40, 7);
    ctxF.globalCompositeOperation = 'lighter';
    for (let l = 0; l < 3; l++) {
      const h = (52 - l * 14) * fireFlicker, w = (26 - l * 7);
      const g = ctxF.createRadialGradient(fx, fy - h * 0.4, 2, fx, fy - h * 0.4, h);
      const col = l === 0 ? '217,108,61' : l === 1 ? '242,166,90' : '247,215,116';
      g.addColorStop(0, `rgba(${col},.9)`); g.addColorStop(1, `rgba(${col},0)`);
      ctxF.fillStyle = g;
      ctxF.beginPath();
      ctxF.ellipse(fx + Math.sin(t * 9 + l * 2) * 4, fy - h * 0.35, w, h, 0, 0, Math.PI * 2);
      ctxF.fill();
    }
    // 火星
    ctxF.fillStyle = 'rgba(247,215,116,.9)';
    sparks.forEach(s => {
      s.y -= s.v * dt; s.x += Math.sin(t * 3 + s.drift) * dt * 12;
      if (s.y < -80) { s.y = 0; s.x = Math.random() * 30 - 15; }
      ctxF.globalAlpha = Math.max(0, 1 + s.y / 90);
      ctxF.fillRect(fx + s.x, fy + s.y, 2.5, 2.5);
    });
    ctxF.restore();
    ctxF.globalAlpha = 1;
  }

  /* 茶炉蒸汽（随 teaLevel 淡入淡出） */
  if (state.teaLevel > 0.02) {
    ctxF.fillStyle = `rgba(220,225,240,${0.16 * state.teaLevel})`;
    steams.forEach(s => {
      s.y -= s.v * dt; if (s.y < -50) { s.y = 0; s.x = Math.random() * 14 - 7; }
      ctxF.beginPath();
      ctxF.arc(P.tea.x + s.x + Math.sin(t + s.x) * 4, P.tea.y - 120 + s.y, 5 + (-s.y) * 0.12, 0, Math.PI * 2);
      ctxF.fill();
    });
  }

  /* 烛火（双烛台 + 单烛，随 candleLevel） */
  if (state.candleLevel > 0.02) {
    candleFlicker = 0.85 + Math.sin(t * 13 + 2) * 0.1 + Math.sin(t * 29) * 0.05;
    ctxF.save();
    ctxF.globalCompositeOperation = 'lighter';
    const flame = (x, y, h) => {
      const g = ctxF.createRadialGradient(x, y - h * 0.5, 1, x, y - h * 0.5, h);
      g.addColorStop(0, `rgba(247,215,116,${0.85 * state.candleLevel})`);
      g.addColorStop(0.55, `rgba(242,166,90,${0.4 * state.candleLevel})`);
      g.addColorStop(1, 'rgba(242,166,90,0)');
      ctxF.fillStyle = g;
      ctxF.beginPath();
      ctxF.ellipse(x + Math.sin(t * 7 + x) * 1.5, y - h * 0.5, h * 0.32, h * 0.62 * candleFlicker, 0, 0, Math.PI * 2);
      ctxF.fill();
    };
    flame(P.candleD.x - 14, P.candleD.y - 152, 26);
    flame(P.candleD.x + 14, P.candleD.y - 152, 22);
    flame(P.candle.x, P.candle.y - 96, 18);
    ctxF.restore();
  }
}

/* ---------- 光照层（独立画布：暗底 + 光源打孔）
   必须与粒子分层——destination-out 会连同火焰一起擦掉 ---------- */
function drawLight() {
  ctxL.clearRect(0, 0, VIEW.w, VIEW.h);
  ctxL.save();
  ctxL.globalCompositeOperation = 'source-over';
  ctxL.fillStyle = 'rgba(9,11,28,.46)';
  ctxL.fillRect(0, 0, VIEW.w, VIEW.h);
  // 睡眠定时：最后 1 分钟画面同步渐暗
  if (state._dim > 0.01) {
    ctxL.fillStyle = `rgba(5,6,18,${0.5 * state._dim})`;
    ctxL.fillRect(0, 0, VIEW.w, VIEW.h);
  }
  ctxL.globalCompositeOperation = 'destination-out';
  const punch = (x, y, r, a) => {
    const g = ctxL.createRadialGradient(x, y, r * 0.15, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctxL.fillStyle = g; ctxL.fillRect(x - r, y - r, r * 2, r * 2);
  };
  if (state.on.fire) punch(P.fire.x, P.fire.y - 60, 340 * fireFlicker, 0.95);
  // 月光光柱对应的地板微亮
  punch((BEAM[2].x + BEAM[3].x) / 2, BEAM[2].y - 10, 130, 0.3);
  // 烛台：开启时更亮更大，关闭时只剩装饰微光
  punch(P.candleD.x, P.candleD.y - 150, 150 + 90 * state.candleLevel, 0.35 + 0.4 * state.candleLevel);
  punch(P.candle.x, P.candle.y - 90, 100 + 50 * state.candleLevel, 0.2 + 0.35 * state.candleLevel);
  punch(P.tea.x, P.tea.y - 110, 100, 0.25 + 0.2 * state.teaLevel);
  punch(P.cat.x, P.cat.y - 20, 90, 0.3);
  punch(P.window.x, P.window.y - 160, 140, 0.25);            // 月光
  punch(P.clock.x, P.clock.y - 140, 70, 0.2);
  // 闪电：整屏泛蓝白（在打孔之后盖，才能提亮所有区域）
  if (state.flash > 0.02) {
    ctxL.globalCompositeOperation = 'source-over';
    ctxL.fillStyle = `rgba(190,200,255,${0.22 * state.flash})`;
    ctxL.fillRect(0, 0, VIEW.w, VIEW.h);
  }
  ctxL.restore();
}

/* ---------- 雷声（仅开窗时，20-60s 随机） ---------- */
function triggerThunder() {
  engine.playThunder(0.45 + Math.random() * 0.25);
  state.flash = 1;
  state.shake = 1;
}
function scheduleThunder() {
  state.nextThunderAt = performance.now() + 20000 + Math.random() * 40000;
}

/* ---------- 状态持久化：URL hash 分享 + localStorage 恢复 ---------- */
const TRACK_ORDER = ['rain', 'fire', 'tea', 'candle', 'cat', 'tick'];
const LS_KEY = 'sound-room-v1';

function encodeState() {
  const bits = TRACK_ORDER.map(k => state.on[k] ? '1' : '0').join('');
  const vols = TRACK_ORDER.map(k => Math.round(state.vols[k] * 100)).join(',');
  return `mix=${bits},${vols}`;
}

function decodeState(str) {
  const m = (str || '').match(/mix=(\d{6}),([\d,]+)/);
  if (!m) return false;
  const vols = m[2].split(',').map(Number);
  TRACK_ORDER.forEach((k, i) => {
    state.on[k] = m[1][i] === '1';
    if (!Number.isNaN(vols[i])) state.vols[k] = Math.min(1, Math.max(0, vols[i] / 100));
  });
  return true;
}

function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ on: state.on, vols: state.vols })); } catch (e) {}
  // 地址栏实时同步成分享链接（replaceState 不触发跳转、不滚动）
  history.replaceState(null, '', '#' + encodeState());
}

function loadState() {
  // 优先级：URL hash（分享链接）> localStorage（上次房间） > 默认
  if (decodeState(location.hash)) return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.on && d.vols) {
        TRACK_ORDER.forEach(k => {
          if (typeof d.on[k] === 'boolean') state.on[k] = d.on[k];
          if (typeof d.vols[k] === 'number') state.vols[k] = d.vols[k];
        });
      }
    }
  } catch (e) {}
}

/* ---------- 分享 ---------- */
function shareRoom() {
  saveState();
  const url = location.href;
  const toast = document.getElementById('toast');
  const show = msg => {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => show('🔗 链接已复制，发给朋友吧'))
      .catch(() => show(url));
  } else show(url);
}

/* ---------- 睡眠定时 ---------- */
const MX_TIMER_LABEL = () => document.getElementById('mxTimerLabel');
function setSleepTimer(min) {
  if (min <= 0) { clearSleepTimer(); return; }
  engine.ensure();
  state.sleep = { end: performance.now() + min * 60000, total: min * 60000 };
  engine.setMaster(0.9, 1);
  document.querySelectorAll('.mx-timer button').forEach(b =>
    b.classList.toggle('active', +b.dataset.min === min));
  updateTimerLabel();
}
function clearSleepTimer(silent) {
  state.sleep = null;
  state._dim = 0;
  engine.setMaster(0.9, 1);
  document.querySelectorAll('.mx-timer button').forEach(b => b.classList.remove('active'));
  if (!silent) MX_TIMER_LABEL().textContent = '';
}
function updateTimerLabel() {
  if (!state.sleep) return;
  const remain = Math.max(0, state.sleep.end - performance.now());
  const m = Math.floor(remain / 60000), s = Math.floor((remain % 60000) / 1000);
  MX_TIMER_LABEL().textContent = ` ${m}:${String(s).padStart(2, '0')} 后渐弱`;
}
function finishSleep() {
  engine.stopAll(1.5);
  for (const tr of TRACKS) state.on[tr.key] = false;
  syncMixer();
  clearSleepTimer(true);
  MX_TIMER_LABEL().textContent = ' 晚安';
  setTimeout(() => { MX_TIMER_LABEL().textContent = ''; }, 8000);
}

/* ---------- 交互对象注册 ---------- */
const OBJECTS = [
  { id: 'window', name: '木窗',   sound: '雨声',     ...P.window, hitW: 150, hitH: 330, hoverY: -330 },
  { id: 'fire',   name: '壁炉',   sound: '柴火噼啪', ...P.fire,   hitW: 170, hitH: 300, hoverY: -300 },
  { id: 'tea',    name: '茶炉',   sound: '沸水咕嘟', ...P.tea,    hitW: 150, hitH: 180, hoverY: -180 },
  { id: 'candle', name: '烛台',   sound: '烛火轻响', ...P.candleD,hitW: 130, hitH: 210, hoverY: -210 },
  { id: 'clock',  name: '落地钟', sound: '滴答',     ...P.clock, hitW: 90,  hitH: 260, hoverY: -260 },
  { id: 'cat',    name: '猫',     sound: '呼噜',     ...P.cat,    hitW: 110, hitH: 70,  hoverY: -70 },
];

/* ---------- 音频接线 ---------- */
function startTrack(key) {
  const v = state.vols[key];
  switch (key) {
    case 'rain':
      engine.startLoop('rain', 'assets/audio/rain_loop.mp3',
        { volume: v, fadeIn: 2, filterFreq: 1200 });
      break;
    case 'fire':
      engine.startLoop('fire', 'assets/audio/fire_loop.m4a', { volume: v, fadeIn: 2 });
      break;
    case 'tea':    engine.startBubble('tea', { volume: v }); break;
    case 'candle': engine.startCandle('candle', { volume: v }); break;
    case 'cat':    engine.startPurr('cat', { volume: v }); break;
    case 'tick':   engine.startTick('tick', { volume: v }); break;
  }
}
function stopTrack(key, fade = 1.5) { engine.fadeOut(key, fade); }

function toggleTrack(key) {
  engine.ensure();
  state.on[key] = !state.on[key];
  state.on[key] ? startTrack(key) : stopTrack(key);
  syncMixer();
  saveState();
}

function setVol(key, v, ramp = 0.15) {
  state.vols[key] = v;
  engine.setVolume(key, v, ramp);
}

/* ---------- 预设配方（设计文档 4.3，映射到六轨） ---------- */
const PRESETS = {
  focus: { label: '专注', vols: { rain: .6,  fire: 0,   tea: .3,  candle: .2,  cat: 0,   tick: 0 } },
  sleep: { label: '助眠', vols: { rain: .5,  fire: .6,  tea: .2,  candle: .3,  cat: .5,  tick: 0 } },
  read:  { label: '阅读', vols: { rain: .3,  fire: .25, tea: .4,  candle: .4,  cat: 0,   tick: .25 } },
  night: { label: '深夜', vols: { rain: .4,  fire: .35, tea: .3,  candle: .25, cat: 0,   tick: .15 } },
};

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  engine.ensure();
  for (const tr of TRACKS) {
    const v = p.vols[tr.key];
    state.vols[tr.key] = v;
    if (v > 0) {
      if (!state.on[tr.key]) { state.on[tr.key] = true; startTrack(tr.key); }
      else engine.setVolume(tr.key, v, 2.5);
    } else {
      if (state.on[tr.key]) stopTrack(tr.key, 1.5);
      state.on[tr.key] = false;
    }
  }
  document.querySelectorAll('.mx-presets button').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === name));
  syncMixer();
  saveState();
}

/* ---------- 混音台 UI ---------- */
const mixerRows = {};
function buildMixer() {
  const box = document.getElementById('mxSliders');
  for (const tr of TRACKS) {
    const row = document.createElement('div');
    row.className = 'mx-row';
    row.innerHTML = `
      <span class="mx-dot"></span>
      <span class="mx-name">${tr.name}</span>
      <input type="range" min="0" max="100" step="5" value="${Math.round(state.vols[tr.key] * 100)}">
      <span class="mx-pct">${Math.round(state.vols[tr.key] * 100)}%</span>`;
    box.appendChild(row);
    const slider = row.querySelector('input');
    slider.addEventListener('input', () => {
      const v = slider.value / 100;
      engine.ensure();
      if (v > 0 && !state.on[tr.key]) { state.on[tr.key] = true; startTrack(tr.key); }
      if (v === 0 && state.on[tr.key]) { state.on[tr.key] = false; stopTrack(tr.key); }
      setVol(tr.key, v);
      if (state.on[tr.key]) engine.setVolume(tr.key, v, 0.1);
      syncMixer();
      saveState();
    });
    mixerRows[tr.key] = { row, slider, pct: row.querySelector('.mx-pct') };
  }
  document.querySelectorAll('.mx-presets button').forEach(b =>
    b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  document.querySelectorAll('.mx-timer button').forEach(b =>
    b.addEventListener('click', () => setSleepTimer(+b.dataset.min)));
  document.getElementById('mxToggle').addEventListener('click', () => {
    document.getElementById('mixer').classList.toggle('open');
  });
}

function syncMixer() {
  for (const tr of TRACKS) {
    const m = mixerRows[tr.key];
    if (!m) continue;
    m.slider.value = Math.round(state.vols[tr.key] * 100);
    m.pct.textContent = Math.round(state.vols[tr.key] * 100) + '%';
    m.row.classList.toggle('on', state.on[tr.key]);
  }
}

/* ---------- 悬停 / 点击 / 滚轮 ---------- */
const tip = document.getElementById('tip');
function objAt(mx, my) {
  for (let k = OBJECTS.length - 1; k >= 0; k--) {
    const o = OBJECTS[k];
    if (Math.abs(mx - o.x) < o.hitW / 2 && my > o.y + o.hoverY && my < o.y + 8) return o;
  }
  return null;
}

cvsFx.addEventListener('mousemove', e => {
  const r = cvsFx.getBoundingClientRect();
  const mx = (e.clientX - r.left) * (VIEW.w / r.width);
  const my = (e.clientY - r.top) * (VIEW.h / r.height);
  const o = objAt(mx, my);
  if (o !== state.hovered) { state.hovered = o; drawScene(); }
  cvsFx.style.cursor = o ? 'pointer' : 'default';
  if (o) {
    const tr = trackByObj(o.id);
    const on = tr && state.on[tr.key];
    tip.style.display = 'block';
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top = (e.clientY - 10) + 'px';
    tip.innerHTML = on
      ? `${o.name} · ${o.sound} <em>开（滚轮调音量）</em>`
      : `${o.name} · ${o.sound}`;
  } else tip.style.display = 'none';
});

cvsFx.addEventListener('click', e => {
  const o = state.hovered;
  if (!o) return;
  engine.ensure();
  autoStartOnce();
  const tr = trackByObj(o.id);
  if (tr) toggleTrack(tr.key);
});

/* 首次交互时，把"已经点亮"的物件（壁炉）的声音悄悄接上 */
let _autoStarted = false;
function autoStartOnce() {
  if (_autoStarted) return;
  _autoStarted = true;
  for (const tr of TRACKS) {
    if (state.on[tr.key] && !engine.tracks[tr.key]) startTrack(tr.key);
  }
}

cvsFx.addEventListener('wheel', e => {
  const o = state.hovered;
  if (!o) return;
  const tr = trackByObj(o.id);
  if (!tr || !state.on[tr.key]) return;
  e.preventDefault();
  const v = Math.min(1, Math.max(0, state.vols[tr.key] - Math.sign(e.deltaY) * 0.08));
  setVol(tr.key, v);
  engine.setVolume(tr.key, v, 0.1);
  tip.innerHTML = `${o.name} · 音量 ${Math.round(v * 100)}%`;
}, { passive: false });

function sleepTick() {
  if (!state.sleep) return;
  const remain = state.sleep.end - performance.now();
  if (remain <= 0) { finishSleep(); return; }
  if (remain < 60000) {
    state._dim = 1 - remain / 60000;
    engine.setMaster(0.9 * (remain / 60000), 1.2);
  }
  const sec = Math.floor(remain / 1000);
  if (sec !== _lastLabelSec) { _lastLabelSec = sec; updateTimerLabel(); }
}

/* ---------- 主循环 ---------- */
let last = performance.now();
let _lastLabelSec = -1;
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  const t = now / 1000;
  state._loopTick = (state._loopTick || 0) + 1;
  // 雨 / 蒸汽 / 烛火强度趋近目标（开关的交叉淡化同时作用于粒子和光照）
  const ease = (cur, target) => cur + (target - cur) * Math.min(dt * 1.4, 1);
  state.rainLevel   = ease(state.rainLevel,   state.on.rain   ? 1 : 0);
  state.teaLevel    = ease(state.teaLevel,    state.on.tea    ? 1 : 0);
  state.candleLevel = ease(state.candleLevel, state.on.candle ? 1 : 0);
  // 雷声调度（仅开窗时）
  if (state.on.rain) {
    if (!state.nextThunderAt) scheduleThunder();
    else if (now >= state.nextThunderAt) { triggerThunder(); scheduleThunder(); }
  } else if (state.nextThunderAt) {
    state.nextThunderAt = 0;
  }
  // 闪电 / 玻璃震动衰减
  state.flash = Math.max(0, state.flash - dt * 1.4);
  state.shake = Math.max(0, state.shake - dt * 1.8);
  // 睡眠定时：最后一分钟主音量渐弱 + 画面渐暗
  sleepTick();
  drawParticles(dt, t);
  drawLight();
  requestAnimationFrame(loop);
}

/* ---------- 启动 ---------- */
// 启动加载：URL hash（分享链接）> localStorage（上次房间）> 默认
// 必须在 ?rain=1 等测试参数之前执行，测试参数才具有最高优先级
loadState();

// 测试参数：?rain=1 直接显示下雨，?fire=0 熄灭壁炉，?mixer=1 展开混音台
//           ?candle=1&tea=1 点亮烛火/茶炉，?sleep=0.2 设 0.2 分钟定时，?thunder=1 立即打雷
const qp = new URLSearchParams(location.search);
if (qp.get('rain') === '1') { state.on.rain = true; state.rainLevel = 1; }
if (qp.get('fire') === '0') state.on.fire = false;
if (qp.get('tea') === '1') { state.on.tea = true; state.teaLevel = 1; }
if (qp.get('candle') === '1') { state.on.candle = true; state.candleLevel = 1; }
if (qp.get('sleep')) setTimeout(() => setSleepTimer(parseFloat(qp.get('sleep')) || 0), 1500);
if (qp.get('thunder') === '1') Promise.all(loadPromises).then(() => setTimeout(triggerThunder, 2000));
if (qp.get('debug') === '1') {
  state._debug = true;  setTimeout(() => {
    const probe = (p) => {
      const d = ctxF.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
      return [d[0], d[1], d[2], d[3]].join(',');
    };
    document.title = 'DBG ' + JSON.stringify({
      fire: state.on.fire, rain: state.on.rain, candle: state.on.candle,
      Pfire: P.fire, Pwindow: P.window,
      flicker: +fireFlicker.toFixed(2),
      loopAlive: !!state._loopTick,
      pxFire: probe({ x: P.fire.x, y: P.fire.y - 60 }),
      pxCat: probe(P.cat),
      pxBeamIn: probe({ x: 640, y: 450 }),
      pxBeamOut: probe({ x: 500, y: 450 }),
      fxSize: [cvsFx.width, cvsFx.height],
    });
  }, 800);
}
// 点击链路自测：?selftest=1 → 模拟鼠标点击猫，标题输出结果
if (qp.get('selftest') === '1') {
  Promise.all(loadPromises).then(() => setTimeout(() => {
    const r = cvsFx.getBoundingClientRect();
    const sx = r.left + (P.cat.x / VIEW.w) * r.width;
    const sy = r.top + ((P.cat.y - 30) / VIEW.h) * r.height;
    cvsFx.dispatchEvent(new MouseEvent('mousemove', { clientX: sx, clientY: sy, bubbles: true }));
    cvsFx.dispatchEvent(new MouseEvent('click', { clientX: sx, clientY: sy, bubbles: true }));
    setTimeout(() => {
      document.title = 'SELFTEST hovered=' + (state.hovered && state.hovered.id) + ' catOn=' + state.on.cat;
    }, 300);
  }, 1200));
}
// 混音台自测：?selftest=2 → 应用助眠配方，标题输出各轨状态
if (qp.get('selftest') === '2') {
  Promise.all(loadPromises).then(() => setTimeout(() => {
    applyPreset('sleep');
    const mx = document.getElementById('mixer');
    mx.style.transition = 'none';
    mx.classList.add('open');
    setTimeout(() => {
      const mr = document.getElementById('mixer').getBoundingClientRect();
      document.title = 'SELFTEST2 ' + JSON.stringify({
        on: state.on, vols: state.vols,
        tracksRegistered: Object.keys(engine.tracks),
        mixerRect: [Math.round(mr.top), Math.round(mr.bottom), Math.round(mr.height)],
        sliderRows: document.querySelectorAll('.mx-row').length,
        open: document.getElementById('mixer').classList.contains('open'),
      });
    }, 600);
  }, 800));
}

// M3 自测：?selftest=3 → 雷 + 睡眠定时（0.2 分钟 = 12s），标题输出状态
if (qp.get('selftest') === '3') {
  Promise.all(loadPromises).then(() => setTimeout(() => {
    state.on.rain = true; state.rainLevel = 1;
    triggerThunder();
    setSleepTimer(0.2);
    setTimeout(() => {
      document.title = 'SELFTEST3 ' + JSON.stringify({
        flash: +state.flash.toFixed(2),
        shake: +state.shake.toFixed(2),
        nextThunderAt: state.nextThunderAt > 0,
        sleep: !!state.sleep,
        dim: +state._dim.toFixed(2),
        label: document.getElementById('mxTimerLabel').textContent,
      });
    }, 400);
    // 12.5s 后确认定时结束、全部关闭
    setTimeout(() => {
      sleepTick();  // 无头模式下 rAF 可能已停，手动补一拍验证收尾逻辑
      document.title = 'SELFTEST3b ' + JSON.stringify({
        sleep: !!state.sleep,
        remain: state.sleep ? Math.round(state.sleep.end - performance.now()) : null,
        on: state.on, dim: state._dim,
        label: document.getElementById('mxTimerLabel').textContent,
      });
    }, 12500);
  }, 1000));
}

// M4 自测：?selftest=4 → 状态编解码往返 + localStorage 落盘
if (qp.get('selftest') === '4') {
  Promise.all(loadPromises).then(() => setTimeout(() => {
    // 制造一个非默认状态：开雨+猫，雨 80%
    state.on.rain = true; state.on.cat = true; state.vols.rain = 0.8;
    saveState();
    const ls = localStorage.getItem(LS_KEY);
    // 模拟重开：清空 state 后从 hash 解码
    state.on.rain = false; state.on.cat = false; state.vols.rain = 0.6;
    const hashOk = decodeState(location.hash);
    setTimeout(() => {
      document.title = 'SELFTEST4 ' + JSON.stringify({
        hashOk,
        hash: location.hash,
        ls: !!ls,
        decoded: { rain: state.on.rain, cat: state.on.cat, volRain: state.vols.rain },
      });
    }, 300);
  }, 800));
}

Promise.all(loadPromises).then(() => {
  buildMixer();
  syncMixer();
  document.getElementById('shareBtn').addEventListener('click', shareRoom);
  if (qp.get('mixer') === '1') {
    const mx = document.getElementById('mixer');
    mx.style.transition = 'none';
    mx.classList.add('open');
  }
  // 恢复的视觉状态需要重绘（雨/蒸汽/烛火强度一步到位）
  state.rainLevel = state.on.rain ? 1 : 0;
  state.teaLevel = state.on.tea ? 1 : 0;
  state.candleLevel = state.on.candle ? 1 : 0;
  drawScene();
  requestAnimationFrame(loop);
});
