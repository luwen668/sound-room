/* ============================================================
   Sound Room · Room
   等距房间渲染（Kenney 素材）+ 粒子 + 猫/落地钟/烛火绘制 + 交互
   M2：六物件全接 + 混音推子台 + 预设配方
   ============================================================ */
'use strict';

/* ---------- 视口与等距坐标 ---------- */
const VIEW = { w: 1000, h: 860 };
const CX = 500, CY = 400;      // 房间中心（格子 0,0 的锚点）
const STEP_X = 96, STEP_Y = 48; // 等距网格步长（一格）
// 关键：Kenney miniature 精灵的地砖是 2×2 格拼块，256×512 画布
// 必须按 0.375 缩放（96×192）绘制， footprint 恰好 = 1 格，否则重叠成"绗缝被子"
const SC = 0.375, SPR_W = 256 * SC, SPR_H = 512 * SC;

const iso = (i, j) => ({ x: CX + (i - j) * STEP_X, y: CY + (i + j) * STEP_Y });

/* ---------- 精灵加载 ---------- */
const SPRITES = {
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
// 地板与两面后墙改为自绘（连续石板/石墙），见 drawFloor/drawWalls
// 靠墙家具与摆件（Kenney 精灵，1 格 footprint）
const walls = [
  { k: 'bookcaseW', i: 1,    j: -0.3, s: 1.4 },
  { k: 'window',    i: 2,    j: -0.3, id: 'window' },
  { k: 'bookcase',  i: 3,    j: -0.3, s: 1.4 },
  { k: 'bookcaseH', i: -0.3, j: 0, s: 1.4 },
  { k: 'arch',      i: -0.3, j: 1, id: 'fire' },
  { k: 'display',   i: -0.3, j: 3, s: 1.4 },
];
// 地面物件
const props = [
  { k: 'longTable',  i: 1,    j: 3,   s: 1.35 },
  { k: 'chair',      i: 1.9,  j: 3.2, s: 1.3 },
  { k: 'carpet',     i: 2,    j: 2,   s: 1.5 },
  { k: 'roundTable', i: 3.1,  j: 2.1, id: 'tea', s: 1.3 },
  { k: 'bookStand',  i: 3.6,  j: 0.8, s: 1.3 },
  { k: 'candleD',    i: 4.2,  j: 1.6,  id: 'candle', s: 1.35 },   // 右侧墙边，远离落地钟避免误点
  { k: 'candle',     i: 0.6,  j: 3.6, s: 1.35 },
  { k: 'clock',      i: 4.35, j: 0.35, id: 'clock' },  // 自绘落地钟
  { k: 'cat',        i: 2.3,  j: 1.95, id: 'cat' },    // 自绘猫
];
const scene = [...walls, ...props].sort((a, b) => (a.i + a.j) - (b.i + b.j));

/* ---------- 关键锚点 ---------- */
const P = {
  window: iso(2, -0.3),
  fire:   { x: iso(-0.3, 1).x - 38, y: iso(-0.3, 1).y },  // 对齐拱门开口中心
  tea:    iso(3.1, 2.1),
  clock:  iso(4.35, 0.35),
  cat:    iso(2.3, 1.95),
  candleD:iso(4.2, 1.6),
  candle: iso(0.6, 3.6),
};
  const RAIN_RECT = { x: P.window.x - 28, y: P.window.y - 118, w: 56, h: 80 };

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
  vols: { rain: 0.45, fire: 0.55, cat: 0.55, tick: 0.3, tea: 0.4, candle: 0.35 },
  viewMode: 'fit',  // fit 整屋适配 / pan 放大巡视
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
  { x: P.window.x - 22, y: P.window.y - 108 },
  { x: P.window.x + 20, y: P.window.y - 108 },
  { x: P.window.x - 55, y: P.window.y + 92 },
  { x: P.window.x - 100, y: P.window.y + 92 },
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

/* ---------- 自绘：猫（橘猫蜷睡：闭眼、鼻嘴、胡须、虎斑、绕身尾） ---------- */
function drawCat(ctx, x, y, t, purring) {
  const br = 1 + Math.sin(t * 1.6) * 0.05;             // 呼吸
  const twitch = Math.sin(t * 0.7) > 0.97 ? 4 : 0;      // 偶尔耳动
  const FUR = '#D9A066', FUR_D = '#C08B52', STRIPE = '#B0763D', LINE = '#7A5A34';
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1.25, 1.25 * br);

  /* 尾巴：从身后绕到身前（蜷团经典姿势），尾尖深色 */
  const tailSway = Math.sin(t * 0.9) * 2;
  ctx.strokeStyle = FUR_D; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(32, -12);
  ctx.quadraticCurveTo(40, 3, 14, 4);
  ctx.quadraticCurveTo(-4, 4, -13, -3 + tailSway);
  ctx.stroke();
  ctx.strokeStyle = STRIPE; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-13, -3 + tailSway);
  ctx.lineTo(-18, -5 + tailSway);
  ctx.stroke();

  /* 身体（蜷团） */
  ctx.fillStyle = FUR;
  ctx.beginPath(); ctx.ellipse(0, -14, 34, 21, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.stroke();
  /* 虎斑纹（背上三道弧） */
  ctx.strokeStyle = STRIPE; ctx.lineWidth = 3; ctx.lineCap = 'round';
  [-6, 5, 15].forEach(sx => {
    ctx.beginPath();
    ctx.arc(sx, -20, 8, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
  });

  /* 前爪（蜷在身前） */
  ctx.fillStyle = FUR_D;
  ctx.beginPath(); ctx.ellipse(-13, -3, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();

  /* 头 */
  ctx.fillStyle = FUR;
  ctx.beginPath(); ctx.arc(-24, -24, 16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.stroke();
  /* 耳（三角 + 内耳） */
  ctx.fillStyle = FUR_D;
  ctx.beginPath(); ctx.moveTo(-37, -33); ctx.lineTo(-34, -46 + twitch); ctx.lineTo(-26, -37); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-22, -37); ctx.lineTo(-17, -47); ctx.lineTo(-12, -34); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#E8C39A';
  ctx.beginPath(); ctx.moveTo(-34, -36); ctx.lineTo(-32.5, -42 + twitch); ctx.lineTo(-29, -37); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-20, -37); ctx.lineTo(-18, -42); ctx.lineTo(-15.5, -36); ctx.closePath(); ctx.fill();

  /* 闭眼（睡着的猫，两道下弧） */
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(-29, -27, 3, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
  ctx.beginPath(); ctx.arc(-19, -27, 3, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
  /* 鼻 + 嘴（小 ω） */
  ctx.fillStyle = '#B0763D';
  ctx.beginPath(); ctx.moveTo(-25.6, -21.5); ctx.lineTo(-22.4, -21.5); ctx.lineTo(-24, -19.2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.arc(-25.6, -19.4, 1.7, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  ctx.beginPath(); ctx.arc(-22.4, -19.4, 1.7, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  /* 胡须 */
  ctx.strokeStyle = 'rgba(232,230,222,.7)'; ctx.lineWidth = 0.8;
  [[-38, -22, -47, -24], [-38, -19.5, -47, -18], [-11, -22, -3, -24], [-11, -19.5, -3, -18]]
    .forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });

  /* 呼噜时的 Zzz */
  if (purring && Math.sin(t * 0.5) > 0.6) {
    ctx.fillStyle = 'rgba(200,205,230,.85)';
    ctx.font = '600 11px Georgia';
    ctx.fillText('z', -40, -46 - (t % 1) * 8);
  }
  ctx.restore();
}

/* ---------- 自绘：落地钟（真实时间钟面） ---------- */
function drawClock(ctx, x, y, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(0.55, 0.55);
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
const FLOOR_POLYGON = [iso(0, 0), iso(0, 5), iso(5, 5), iso(5, 0)];
const WALL_H = 190;                 // 后墙高度（px）
const STONE_PALETTE = ['#C9BEA4', '#C2B79C', '#BCB195', '#C6BBA1'];

/* 两面后墙（沿 j=0 边与 i=0 边）：连续石墙，砖缝错缝，带顶面与转角柱 */
function drawWalls() {
  const edgeA = [iso(0, 0), iso(5, 0)];   // 右后墙基线
  const edgeB = [iso(0, 0), iso(0, 5)];   // 左后墙基线
  const face = (E0, E1, tx) => {
    // 墙面（上亮下暗）
    const g = ctxS.createLinearGradient(0, Math.min(E0.y, E1.y) - WALL_H, 0, Math.max(E0.y, E1.y));
    g.addColorStop(0, '#968D77'); g.addColorStop(1, '#6B6452');
    ctxS.fillStyle = g;
    ctxS.beginPath();
    ctxS.moveTo(E0.x, E0.y); ctxS.lineTo(E1.x, E1.y);
    ctxS.lineTo(E1.x, E1.y - WALL_H); ctxS.lineTo(E0.x, E0.y - WALL_H);
    ctxS.closePath(); ctxS.fill();
    // 砖缝（裁剪到墙面内）
    ctxS.save(); ctxS.clip();
    ctxS.strokeStyle = 'rgba(56,48,36,.42)'; ctxS.lineWidth = 1.4;
    const yTop = Math.min(E0.y, E1.y) - WALL_H, yBot = Math.max(E0.y, E1.y);
    const xL = Math.min(E0.x, E1.x) - 8, xR = Math.max(E0.x, E1.x) + 8;
    for (let y = yBot - 15; y > yTop; y -= 17) {
      ctxS.beginPath(); ctxS.moveTo(xL, y); ctxS.lineTo(xR, y); ctxS.stroke();
    }
    let row = 0;
    for (let y = yBot - 15; y > yTop; y -= 17, row++) {
      for (let x = xL + (row % 2 ? 26 : 9); x < xR; x += 44) {
        ctxS.beginPath(); ctxS.moveTo(x, y); ctxS.lineTo(x, y - 17); ctxS.stroke();
      }
    }
    ctxS.restore();
    // 顶面（朝屋内偏移的窄条）
    ctxS.fillStyle = '#A99E85';
    ctxS.beginPath();
    ctxS.moveTo(E0.x, E0.y - WALL_H); ctxS.lineTo(E1.x, E1.y - WALL_H);
    ctxS.lineTo(E1.x + tx, E1.y - WALL_H + 10); ctxS.lineTo(E0.x + tx, E0.y - WALL_H + 10);
    ctxS.closePath(); ctxS.fill();
  };
  face(edgeA[0], edgeA[1], -9);
  face(edgeB[0], edgeB[1], 9);
  // 转角柱（遮两面墙接缝）
  const c = iso(0, 0);
  ctxS.fillStyle = '#635C4B';
  ctxS.fillRect(c.x - 8, c.y - WALL_H, 16, WALL_H);
  ctxS.strokeStyle = 'rgba(56,48,36,.42)'; ctxS.lineWidth = 1.4;
  for (let y = c.y - 15; y > c.y - WALL_H; y -= 17) {
    ctxS.beginPath(); ctxS.moveTo(c.x - 8, y); ctxS.lineTo(c.x + 8, y); ctxS.stroke();
  }
  ctxS.fillStyle = '#B0A58B';
  ctxS.beginPath(); ctxS.ellipse(c.x, c.y - WALL_H, 12, 6, 0, 0, Math.PI * 2); ctxS.fill();
}

/* 连续石板地板：5×5 格，每格 2×2 迷你砖（与 Kenney 墙壁砖块尺度一致），墙根压暗 */
function drawFloor() {
  // 基座（外沿加厚，承托墙体视觉）
  ctxS.fillStyle = '#333952';
  ctxS.beginPath();
  ctxS.moveTo(FLOOR_POLYGON[0].x, FLOOR_POLYGON[0].y + 8);
  FLOOR_POLYGON.forEach(p => ctxS.lineTo(p.x, p.y + 8));
  ctxS.closePath(); ctxS.fill();
  // 逐格 2×2 迷你砖（确定性配色，刷新不闪变）
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const A = iso(i, j), B = iso(i, j + 1), C = iso(i + 1, j + 1), D = iso(i + 1, j);
    const Puv = (u, v) => ({
      x: A.x * (1 - u) * (1 - v) + B.x * (1 - u) * v + C.x * u * v + D.x * u * (1 - v),
      y: A.y * (1 - u) * (1 - v) + B.y * (1 - u) * v + C.y * u * v + D.y * u * (1 - v),
    });
    for (let mi = 0; mi < 2; mi++) for (let mj = 0; mj < 2; mj++) {
      const p1 = Puv(mi / 2, mj / 2), p2 = Puv(mi / 2, (mj + 1) / 2),
            p3 = Puv((mi + 1) / 2, (mj + 1) / 2), p4 = Puv((mi + 1) / 2, mj / 2);
      ctxS.fillStyle = STONE_PALETTE[(i * 7 + j * 3 + mi * 5 + mj + (i + j) % 2) % 4];
      ctxS.beginPath();
      ctxS.moveTo(p1.x, p1.y); ctxS.lineTo(p2.x, p2.y); ctxS.lineTo(p3.x, p3.y); ctxS.lineTo(p4.x, p4.y);
      ctxS.closePath(); ctxS.fill();
      ctxS.strokeStyle = 'rgba(74,66,50,.4)'; ctxS.lineWidth = 1; ctxS.stroke();
    }
  }
  // 墙根环境光遮蔽（两条后沿压暗，增强房间纵深感）
  const ao = (E0, E1, T) => {
    const g = ctxS.createLinearGradient(E0.x, E0.y, E0.x + T.x, E0.y + T.y);
    g.addColorStop(0, 'rgba(10,12,26,.4)'); g.addColorStop(1, 'rgba(10,12,26,0)');
    ctxS.fillStyle = g;
    ctxS.beginPath();
    ctxS.moveTo(E0.x, E0.y); ctxS.lineTo(E1.x, E1.y);
    ctxS.lineTo(E1.x + T.x, E1.y + T.y); ctxS.lineTo(E0.x + T.x, E0.y + T.y);
    ctxS.closePath(); ctxS.fill();
  };
  ao(iso(0, 0), iso(5, 0), { x: -36, y: 18 });
  ao(iso(0, 0), iso(0, 5), { x: 36, y: 18 });
}

function drawScene() {
  ctxS.clearRect(0, 0, VIEW.w, VIEW.h);
  drawWalls();
  drawFloor();
  for (const o of scene) {
    const p = iso(o.i, o.j);
    if (o.k === 'cat') { drawCat(ctxS, p.x, p.y, performance.now() / 1000, state.on.cat); continue; }
    if (o.k === 'clock') { drawClock(ctxS, p.x, p.y, performance.now() / 1000); continue; }
    const im = img[o.k];
    if (im) {
      const sc = o.s || 1;  // 家具类放大（底部锚点不变，只长个儿）
      ctxS.drawImage(im, p.x - SPR_W * sc / 2, p.y - SPR_H * sc, SPR_W * sc, SPR_H * sc);
    }
    // 悬停高亮
    if (state.hovered && o.id === state.hovered.id) {
      const g = ctxS.createRadialGradient(p.x, p.y - 70, 8, p.x, p.y - 70, 95);
      g.addColorStop(0, 'rgba(242,166,90,.22)'); g.addColorStop(1, 'rgba(242,166,90,0)');
      ctxS.fillStyle = g;
      ctxS.fillRect(p.x - 100, p.y - 170, 200, 185);
    }
  }
  // 常驻名牌：标明哪些物件可点击（可被「标注」开关关闭）
  if (state.showLabels) {
    ctxS.font = '11px "PingFang SC", sans-serif';
    ctxS.textAlign = 'center';
    for (const o of OBJECTS) {
      const w = ctxS.measureText(o.name).width + 14;
      const lx = o.x, ly = o.y + 18;
      ctxS.fillStyle = 'rgba(14,17,34,.55)';
      if (ctxS.roundRect) {
        ctxS.beginPath(); ctxS.roundRect(lx - w / 2, ly - 10, w, 16, 8); ctxS.fill();
      } else ctxS.fillRect(lx - w / 2, ly - 10, w, 16);
      ctxS.fillStyle = 'rgba(232,230,222,.85)';
      ctxS.fillText(o.name, lx, ly + 2.5);
    }
    ctxS.textAlign = 'left';
  }
}

/* ---------- 粒子 ---------- */
const rainDrops = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 }));
const sparks = Array.from({ length: 24 }, () => ({ x: Math.random() * 18 - 9, y: 0, v: 12 + Math.random() * 24, drift: Math.random() * 20 - 10 }));
const steams = Array.from({ length: 7 }, () => ({ x: Math.random() * 10 - 5, y: Math.random() * 28, v: 8 + Math.random() * 10 }));
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
      ctxF.beginPath(); ctxF.moveTo(px, py); ctxF.lineTo(px - 1.5, py + 6 * d.s); ctxF.stroke();
    }
    ctxF.restore();
    // 窗台溅落
    ctxF.fillStyle = `rgba(160,180,235,${0.25 * state.rainLevel})`;
    for (let k = 0; k < 6; k++) {
      const sx = RAIN_RECT.x + ((t * 130 + k * 37) % RAIN_RECT.w);
      ctxF.fillRect(sx, RAIN_RECT.y + RAIN_RECT.h - 2, 2, 1.5);
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
    const fx = P.fire.x, fy = P.fire.y - 26;
    ctxF.save();
    // 木柴堆
    ctxF.fillStyle = '#4A3626';
    ctxF.fillRect(fx - 15, fy - 4, 30, 5);
    ctxF.fillStyle = '#5A4433';
    ctxF.fillRect(fx - 11, fy - 7, 22, 4);
    ctxF.globalCompositeOperation = 'lighter';
    for (let l = 0; l < 3; l++) {
      const h = (30 - l * 8) * fireFlicker, w = (15 - l * 4);
      const g = ctxF.createRadialGradient(fx, fy - h * 0.4, 1.5, fx, fy - h * 0.4, h);
      const col = l === 0 ? '217,108,61' : l === 1 ? '242,166,90' : '247,215,116';
      g.addColorStop(0, `rgba(${col},.9)`); g.addColorStop(1, `rgba(${col},0)`);
      ctxF.fillStyle = g;
      ctxF.beginPath();
      ctxF.ellipse(fx + Math.sin(t * 9 + l * 2) * 2.5, fy - h * 0.35, w, h, 0, 0, Math.PI * 2);
      ctxF.fill();
    }
    // 火星
    ctxF.fillStyle = 'rgba(247,215,116,.9)';
    sparks.forEach(s => {
      s.y -= s.v * dt; s.x += Math.sin(t * 3 + s.drift) * dt * 8;
      if (s.y < -46) { s.y = 0; s.x = Math.random() * 18 - 9; }
      ctxF.globalAlpha = Math.max(0, 1 + s.y / 55);
      ctxF.fillRect(fx + s.x, fy + s.y, 1.8, 1.8);
    });
    ctxF.restore();
    ctxF.globalAlpha = 1;
  }

  /* 茶炉蒸汽（随 teaLevel 淡入淡出） */
  if (state.teaLevel > 0.02) {
    ctxF.fillStyle = `rgba(220,225,240,${0.22 * state.teaLevel})`;
    steams.forEach(s => {
      s.y -= s.v * dt; if (s.y < -32) { s.y = 0; s.x = Math.random() * 10 - 5; }
      ctxF.beginPath();
      ctxF.arc(P.tea.x + s.x + Math.sin(t + s.x) * 3, P.tea.y - 78 + s.y, 3.5 + (-s.y) * 0.1, 0, Math.PI * 2);
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
      ctxF.ellipse(x + Math.sin(t * 7 + x) * 1, y - h * 0.5, h * 0.32, h * 0.62 * candleFlicker, 0, 0, Math.PI * 2);
      ctxF.fill();
    };
    flame(P.candleD.x - 11, P.candleD.y - 77, 15);
    flame(P.candleD.x + 11, P.candleD.y - 77, 13);
    flame(P.candle.x, P.candle.y - 74, 12);
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
  if (state.on.fire) punch(P.fire.x, P.fire.y - 35, 205 * fireFlicker, 0.9);
  // 月光光柱对应的地板微亮
  punch((BEAM[2].x + BEAM[3].x) / 2, BEAM[2].y - 6, 75, 0.3);
  // 烛台：开启时更亮更大，关闭时只剩装饰微光
  punch(P.candleD.x, P.candleD.y - 77, 85 + 50 * state.candleLevel, 0.35 + 0.4 * state.candleLevel);
  punch(P.candle.x, P.candle.y - 60, 58 + 30 * state.candleLevel, 0.2 + 0.35 * state.candleLevel);
  punch(P.tea.x, P.tea.y - 70, 60, 0.25 + 0.2 * state.teaLevel);
  punch(P.cat.x, P.cat.y - 12, 55, 0.3);
  punch(P.window.x, P.window.y - 90, 85, 0.25);            // 月光
  punch(P.clock.x, P.clock.y - 78, 45, 0.2);
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
  // 视图模式：手动选择优先，否则窄屏默认巡视模式
  try {
    const v = localStorage.getItem('sound-room-view');
    state.viewMode = (v === 'pan' || v === 'fit') ? v : (window.innerWidth <= 720 ? 'pan' : 'fit');
  } catch (e) { state.viewMode = window.innerWidth <= 720 ? 'pan' : 'fit'; }
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
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function shareRoom() {
  saveState();
  const url = location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('🔗 链接已复制，发给朋友吧'))
      .catch(() => showToast(url));
  } else showToast(url);
}

/* ---------- 名牌标注开关 ---------- */
function toggleLabels() {
  state.showLabels = !state.showLabels;
  try { localStorage.setItem('sound-room-labels', state.showLabels ? '1' : '0'); } catch (e) {}
  document.getElementById('labelToggle').classList.toggle('active', state.showLabels);
  drawScene();
}
function loadLabels() {
  let v = true;
  try { v = localStorage.getItem('sound-room-labels') !== '0'; } catch (e) {}
  state.showLabels = v;
  document.getElementById('labelToggle').classList.toggle('active', v);
}

/* ---------- 静音总开关（只断声音，房间视觉状态不变） ---------- */
function toggleMute() {
  engine.setMuted(!engine.muted);
  try { localStorage.setItem('sound-room-muted', engine.muted ? '1' : '0'); } catch (e) {}
  document.getElementById('muteBtn').textContent = engine.muted ? '🔇' : '🔊';
  showToast(engine.muted ? '🔇 已静音' : '🔊 声音开启');
}
function loadMute() {
  try { engine.muted = localStorage.getItem('sound-room-muted') === '1'; } catch (e) {}
  document.getElementById('muteBtn').textContent = engine.muted ? '🔇' : '🔊';
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
  { id: 'window', name: '木窗',   sound: '雨声',     ...P.window, hitW: 85,  hitH: 190, hoverY: -190 },
  { id: 'fire',   name: '壁炉',   sound: '柴火噼啪', ...P.fire,   hitW: 100, hitH: 175, hoverY: -175 },
  { id: 'tea',    name: '茶炉',   sound: '沸水咕嘟', ...P.tea,    hitW: 90,  hitH: 105, hoverY: -105 },
  { id: 'candle', name: '烛台',   sound: '烛火轻响', ...P.candleD,hitW: 65,  hitH: 120, hoverY: -120 },
  { id: 'clock',  name: '落地钟', sound: '滴答',     ...P.clock, hitW: 55,  hitH: 150, hoverY: -150 },
  { id: 'cat',    name: '猫',     sound: '呼噜',     ...P.cat,    hitW: 85,  hitH: 55,  hoverY: -55 },
];

/* ---------- 音频接线 ---------- */
function startTrack(key) {
  const v = state.vols[key];
  switch (key) {
    case 'rain':
      engine.startRain('rain', { volume: v });   // 合成雨（低鸣底噪+成簇雨滴）
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
  focus: { label: '专注', vols: { rain: .45, fire: 0,   tea: .3,  candle: .2,  cat: 0,   tick: 0 } },
  sleep: { label: '助眠', vols: { rain: .4,  fire: .6,  tea: .2,  candle: .3,  cat: .5,  tick: 0 } },
  read:  { label: '阅读', vols: { rain: .25, fire: .25, tea: .4,  candle: .4,  cat: 0,   tick: .25 } },
  night: { label: '深夜', vols: { rain: .35, fire: .35, tea: .3,  candle: .25, cat: 0,   tick: .15 } },
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
  document.querySelectorAll('.mx-timer button[data-min]').forEach(b =>
    b.addEventListener('click', () => setSleepTimer(+b.dataset.min)));
  // 自定义定时（1-480 分钟）
  const customIn = document.getElementById('mxCustomMin');
  const applyCustomTimer = () => {
    let v = parseInt(customIn.value, 10);
    if (Number.isNaN(v)) return;
    v = Math.min(480, Math.max(1, v));
    customIn.value = v;
    setSleepTimer(v);
  };
  document.getElementById('mxCustomBtn').addEventListener('click', applyCustomTimer);
  customIn.addEventListener('keydown', e => { if (e.key === 'Enter') applyCustomTimer(); });
  const mx = document.getElementById('mixer');
  document.getElementById('mxToggle').addEventListener('click', () => {
    mx.classList.toggle('open');
  });
  document.getElementById('mxClose').addEventListener('click', () => {
    mx.classList.remove('open');
  });
  // 三种收起方式：面板内「收起」按钮 / 点击面板外任意处 / Esc
  document.addEventListener('click', e => {
    if (!mx.classList.contains('open')) return;
    if (mx.contains(e.target) || document.getElementById('mxToggle').contains(e.target)) return;
    mx.classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') mx.classList.remove('open');
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

/* ---------- 视图模式：fit 整屋适配 / pan 放大巡视（拖动） ---------- */
const pan = { x: 0, y: 0 };
function panLimits() {
  const r = cvsFx.getBoundingClientRect();
  const stage = document.getElementById('stage');
  return {
    x: Math.max(0, (r.width - stage.clientWidth) / 2),
    y: Math.max(0, (r.height - stage.clientHeight) / 2),
  };
}
function applyPan() {
  const t = `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`;
  for (const c of [cvsScene, cvsFx, cvsLight]) c.style.transform = t;
}
function applyViewMode() {
  const panMode = state.viewMode === 'pan';
  document.body.dataset.view = state.viewMode;
  document.getElementById('viewToggle').classList.toggle('active', panMode);
  if (!panMode) { pan.x = 0; pan.y = 0; }
  requestAnimationFrame(applyPan);
}
function toggleViewMode() {
  state.viewMode = state.viewMode === 'pan' ? 'fit' : 'pan';
  try { localStorage.setItem('sound-room-view', state.viewMode); } catch (e) {}
  applyViewMode();
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

/* 触摸：单指拖动 = 巡视房间；轻点 = 点击物件 */
let _touchStart = null, _touchMoved = false, _lastTouchEnd = 0;
/* 提示标签定位：钳制在视口内，并避开展开的混音台（防手机端被遮住） */
function placeTip(x, y) {
  tip.style.display = 'block';
  const tw = tip.offsetWidth || 120, th = tip.offsetHeight || 30;
  let left = Math.min(x + 14, window.innerWidth - tw - 8);
  let top = y - 10;
  const mx = document.getElementById('mixer');
  const mixerTop = mx.classList.contains('open') ? mx.getBoundingClientRect().top : Infinity;
  top = Math.min(top, mixerTop - th - 8);
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
function showTipFor(o, clientX, clientY) {
  const tr = trackByObj(o.id);
  const on = tr && state.on[tr.key];
  tip.innerHTML = on
    ? `${o.name} · ${o.sound} <em>开</em>`
    : `${o.name} · ${o.sound}`;
  placeTip(clientX, clientY);
}
function tapAt(clientX, clientY) {
  const r = cvsFx.getBoundingClientRect();
  const mx = (clientX - r.left) * (VIEW.w / r.width);
  const my = (clientY - r.top) * (VIEW.h / r.height);
  const o = objAt(mx, my);
  if (!o) { tip.style.display = 'none'; return; }
  const tr = trackByObj(o.id);
  if (tr) {
    engine.ensure();
    autoStartOnce();
    toggleTrack(tr.key);
  }
  state.hovered = o; drawScene();
  showTipFor(o, clientX, clientY);
  clearTimeout(tapAt._t);
  tapAt._t = setTimeout(() => { tip.style.display = 'none'; }, 1400);
}

cvsFx.addEventListener('touchstart', e => {
  const t = e.touches[0];
  _touchStart = { x: t.clientX, y: t.clientY, panX: pan.x, panY: pan.y };
  _touchMoved = false;
}, { passive: true });

cvsFx.addEventListener('touchmove', e => {
  if (!_touchStart) return;
  const t = e.touches[0];
  const dx = t.clientX - _touchStart.x, dy = t.clientY - _touchStart.y;
  if (!_touchMoved && Math.hypot(dx, dy) > 10) _touchMoved = true;
  if (_touchMoved) {
    e.preventDefault();
    const lim = panLimits();
    pan.x = Math.min(lim.x, Math.max(-lim.x, _touchStart.panX + dx));
    pan.y = Math.min(lim.y, Math.max(-lim.y, _touchStart.panY + dy));
    applyPan();
    tip.style.display = 'none';
  }
}, { passive: false });

cvsFx.addEventListener('touchend', e => {
  _lastTouchEnd = performance.now();
  if (_touchStart && !_touchMoved) {
    const t = e.changedTouches[0];
    tapAt(t.clientX, t.clientY);
  }
  _touchStart = null;
});

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
    tip.innerHTML = on
      ? `${o.name} · ${o.sound} <em>开（滚轮调音量）</em>`
      : `${o.name} · ${o.sound}`;
    placeTip(e.clientX, e.clientY);
  } else tip.style.display = 'none';
});

cvsFx.addEventListener('click', e => {
  if (performance.now() - _lastTouchEnd < 600) return;  // 触摸已处理，忽略合成点击
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

// M4b 自测：?selftest=5 → 混音台收起链路（外部点击 / 收起按钮 / Esc）
if (qp.get('selftest') === '5') {
  Promise.all(loadPromises).then(() => setTimeout(() => {
    const mx = document.getElementById('mixer');
    mx.classList.add('open');
    cvsFx.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // 点外部
    const closedByOutside = !mx.classList.contains('open');
    mx.classList.add('open');
    document.getElementById('mxClose').click();                        // 收起按钮
    const closedByBtn = !mx.classList.contains('open');
    mx.classList.add('open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // Esc
    const closedByEsc = !mx.classList.contains('open');
    // 打开状态下点开关按钮应能保持可切换（不被外部点击误关）
    document.getElementById('mxToggle').click();
    const reopened = mx.classList.contains('open');
    document.title = 'SELFTEST5 ' + JSON.stringify({ closedByOutside, closedByBtn, closedByEsc, reopened });
  }, 800));
}

// M4c 自测：?selftest=6 → 触摸：拖动巡视 + 轻点开关（窄屏布局下验证）
if (qp.get('selftest') === '6') {
  Promise.all(loadPromises).then(() => setTimeout(() => {
    state.viewMode = 'pan'; applyViewMode();
    const r0 = cvsFx.getBoundingClientRect();
    const mk = (type, x, y) => {
      const touch = new Touch({ identifier: 1, target: cvsFx, clientX: x, clientY: y });
      return new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch], bubbles: true, cancelable: true,
      });
    };
    // 拖动巡视
    cvsFx.dispatchEvent(mk('touchstart', 300, 400));
    cvsFx.dispatchEvent(mk('touchmove', 220, 360));
    const panned = Math.abs(pan.x) > 5;
    cvsFx.dispatchEvent(mk('touchend', 220, 360));
    // 轻点猫（注意画布已随 pan 平移，需用实时 rect）
    const r = cvsFx.getBoundingClientRect();
    const sx = r.left + (P.cat.x / VIEW.w) * r.width;
    const sy = r.top + ((P.cat.y - 30) / VIEW.h) * r.height;
    cvsFx.dispatchEvent(mk('touchstart', sx, sy));
    cvsFx.dispatchEvent(mk('touchend', sx, sy));
    setTimeout(() => {
      document.title = 'SELFTEST6 ' + JSON.stringify({
        panned, panX: Math.round(pan.x),
        canvasW: Math.round(r0.width), catOn: state.on.cat,
      });
    }, 300);
  }, 1000));
}

// M5 自测：?selftest=7 → 自定义定时：输入 45 → 设定 → 状态生效
if (qp.get('selftest') === '7') {
  Promise.all(loadPromises).then(() => setTimeout(() => {
    const input = document.getElementById('mxCustomMin');
    input.value = '45';
    document.getElementById('mxCustomBtn').click();
    setTimeout(() => {
      document.title = 'SELFTEST7 ' + JSON.stringify({
        sleep: !!state.sleep,
        totalMin: state.sleep ? Math.round(state.sleep.total / 60000) : null,
        label: document.getElementById('mxTimerLabel').textContent,
        inputVal: input.value,
      });
    }, 300);
  }, 800));
}

// M5b 自测：?selftest=8 → 静音总开关：状态、基准保留、ensure 后生效
if (qp.get('selftest') === '8') {
  Promise.all(loadPromises).then(() => setTimeout(() => {
    document.getElementById('muteBtn').click();
    const muted = engine.muted;
    const baseKept = engine._base === 0.9;
    const ls = localStorage.getItem('sound-room-muted');
    engine.ensure();  // 静音状态下创建 ctx，主音量应立即为 0
    const silent = engine.master.gain.value <= 0.001;
    document.getElementById('muteBtn').click();  // 恢复
    const restored = !engine.muted;
    document.title = 'SELFTEST8 ' + JSON.stringify({ muted, baseKept, ls, silent, restored });
  }, 800));
}

Promise.all(loadPromises).then(() => {
  buildMixer();
  syncMixer();
  document.getElementById('shareBtn').addEventListener('click', shareRoom);
  document.getElementById('viewToggle').addEventListener('click', toggleViewMode);
  document.getElementById('muteBtn').addEventListener('click', toggleMute);
  document.getElementById('labelToggle').addEventListener('click', toggleLabels);
  loadMute();
  loadLabels();
  applyViewMode();
  window.addEventListener('resize', () => { const lim = panLimits();
    pan.x = Math.min(lim.x, Math.max(-lim.x, pan.x));
    pan.y = Math.min(lim.y, Math.max(-lim.y, pan.y));
    applyPan();
  });
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
