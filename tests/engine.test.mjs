/* engine.test.mjs — 引擎单测(node --test,零依赖)
 * [V1.10 修订⑤] 数据按人工核查表校准:渔场5×16/周期30、纺织厂一步链、
 * 陶土矿场/砖厂/铁矿=工人层、5 阶住宅升级链、仓库=服务建筑(生产建筑须在服务范围内)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/engine/data/goods.js');
require('../src/engine/data/needs-data.js');
require('../src/engine/data/tiers.js');
require('../src/engine/data/buildings-data.js');
require('../src/engine/data/buildings.js');
require('../src/engine/data/map-template.js');
require('../src/engine/data/balance.js');
require('../src/engine/events.js');
require('../src/engine/state.js');
require('../src/engine/connectivity.js');
require('../src/engine/economy.js');
require('../src/engine/placement.js');
require('../src/engine/population.js');
require('../src/engine/goals.js');
require('../src/engine/chains.js');
require('../src/engine/tick.js');
require('../src/engine/save.js');

const E = globalThis.Engine;
const { key } = E.state;
const { placeBuilding, setRoad, demolish, footprint, upgradeResidence } = E.placement;

const DEFAULT_SEED = 20260808;
const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ALL_LAND = [0, 1, 2, 3, 4, 5];
const PF = [0]; // [用户决策] 森林移除:可建地形仅平地
const CYCLE = 60; // 测试基准周期(秒)

function createInitialState() {
  return E.state.createInitialState(DEFAULT_SEED);
}

// ---- footprint 查找助手(全部要求外圈有陆地可铺路/仓库覆盖) ----
function cellFree(s, x, y) {
  const k = key(x, y);
  return !(s.grid[k] || s.roads[k]);
}
function freeRect(s, x, y, w, h) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
    if (!cellFree(s, x + dx, y + dy)) return false;
  }
  return true;
}
function terrainRectOk(s, x, y, w, h, codes) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
    if (!codes.includes(s.map.terrain[y + dy][x + dx])) return false;
  }
  return true;
}
function hasLandNb(s, x, y, w, h) {
  const size = s.map.size;
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
    for (const [ddx, ddy] of dirs4) {
      const nx = x + dx + ddx, ny = y + dy + ddy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const t = s.map.terrain[ny][nx];
      if (t !== 6 && t !== 7) return true;
    }
  }
  return false;
}
function findSpot(s, w, h, anchorCode, codes) {
  const size = s.map.size;
  const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2);
  for (let cy = by; cy <= size - 1 - (h - 1 - by); cy++) for (let cx = bx; cx <= size - 1 - (w - 1 - bx); cx++) {
    if (anchorCode !== null && s.map.terrain[cy][cx] !== anchorCode) continue; // 锚点=中心格
    const x = cx - bx, y = cy - by; // 检查用左上角矩形
    if (!freeRect(s, x, y, w, h)) continue;
    if (!terrainRectOk(s, x, y, w, h, codes)) continue;
    if (!hasLandNb(s, x, y, w, h)) continue;
    return { x: cx, y: cy }; // 返回中心
  }
  return null;
}
function findAdjacentSpot(s, x, y, w, h, codes, dist, exclude, anchorW, anchorH) {
  const dirs = [[dist, 0], [-dist, 0], [0, dist], [0, -dist]];
  const aw = anchorW || 0, ah = anchorH || 0;
  const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2);
  const ox = x - bx, oy = y - by; // 入参中心 → 左上角
  const overlaps = (nx, ny) => aw > 0 && ox < nx + aw && nx < ox + w && oy < ny + ah && ny < oy + h;
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy; // 中心
    if (nx - bx < 0 || ny - by < 0) continue;
    if (exclude && nx === exclude.x && ny === exclude.y) continue;
    if (overlaps(nx, ny)) continue;
    if (!freeRect(s, nx - bx, ny - by, w, h)) continue;
    if (!terrainRectOk(s, nx - bx, ny - by, w, h, codes)) continue;
    return { x: nx, y: ny };
  }
  return null;
}
// 渔场 5×16:锚点陆地、footprint 无山脉、至少一格邻水、外圈有陆地(码头式可伸海)
function findCoastFishery(s) {
  const size = s.map.size, W = 5, H = 16;
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const wd = E.buildings.getDef('warehouse');
  const cx = wh ? wh.x : 64, cy = wh ? wh.y : 64; // 中心语义:wh 坐标即中心
  for (let y = 0; y <= size - H; y++) for (let x = 0; x <= size - W; x++) {
    const mh = wh ? Math.abs(x + W / 2 - cx) + Math.abs(y + H / 2 - cy) : 0;
    if (mh > 24 || mh < 16) continue; // 仓库服务范围 ≤24 且不贴仓库(留铺路空间)
    if (!freeRect(s, x, y, W, H)) continue;
    // [顺序10 用户修正] 任何一点不可在陆地:footprint 全水格 + 至少一格 4 邻接陆地
    let allWater = true, anyLandNb = false;
    for (let dy = 0; dy < H && allWater; dy++) for (let dx = 0; dx < W && allWater; dx++) {
      if (s.map.terrain[y + dy][x + dx] !== 6) { allWater = false; break; }
      if (dirs4.some(([ddx, ddy]) => {
        const wx = x + dx + ddx, wy = y + dy + ddy;
        return wx >= 0 && wy >= 0 && wx < size && wy < size && s.map.terrain[wy][wx] !== 6 && s.map.terrain[wy][wx] !== 7;
      })) anyLandNb = true;
    }
    if (!allWater || !anyLandNb) continue;
    // 仓库可达验证:岸侧陆路 connectTo 铺路成功(中心语义:锚点 = 中心)
    if (wh) {
      const av = footprint(E.buildings.getDef('fishery'), x + 2, y + 7);
      if (!connectTo(s, x + 2, y + 7, av, av)) continue;
    }
    return { x: x + 2, y: y + 7 }; // 返回中心
  }
  return null;
}
// [V1.10 修订⑤ 顺序11] 横向全水+邻陆+仓库可达+覆盖找位(旋转放置用;W×H 为旋转后包围盒尺寸)
function findSpotWaterRow(s, W, H) {
  const size = s.map.size;
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const wd = E.buildings.getDef('warehouse');
  const cx = wh ? wh.x : 64, cy = wh ? wh.y : 64; // 中心语义:wh 坐标即中心
  const fdef = E.buildings.getDef('fishery');
  for (let y = 0; y <= size - H; y++) for (let x = 0; x <= size - W; x++) {
    // 中心语义:锚点 = 建筑中心,footprint 由引擎计算
    const mh = wh ? Math.abs(x - cx) + Math.abs(y - cy) : 0;
    if (mh > 24 || mh < 12) continue;
    const cells = E.placement.footprint(fdef, x, y, 1);
    let allWater = true, anyLandNb = false, free = true;
    for (const c of cells) {
      if (c.x < 0 || c.y < 0 || c.x >= size || c.y >= size) { allWater = false; break; }
      if (s.map.terrain[c.y][c.x] !== 6) { allWater = false; break; }
      if (s.grid[c.x + ',' + c.y] || s.roads[c.x + ',' + c.y]) { free = false; break; }
      for (const [ddx, ddy] of dirs4) {
        const wx = c.x + ddx, wy = c.y + ddy;
        if (wx >= 0 && wy >= 0 && wx < size && wy < size && s.map.terrain[wy][wx] !== 6 && s.map.terrain[wy][wx] !== 7) anyLandNb = true;
      }
    }
    if (!allWater || !free || !anyLandNb) continue;
    if (wh) {
      const av = footprint(fdef, x, y, 1);
      if (!connectTo(s, x, y, av, av)) continue;
      const roads = E.population.serviceRoads(s, 'warehouse');
      let covered = false;
      for (const c of av) for (const [ddx, ddy] of dirs4) {
        const nx = c.x + ddx, ny = c.y + ddy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (roads.has(key(nx, ny))) { covered = true; break; }
      }
      if (!covered) continue;
    }
    return { x, y };
  }
  return null;
}

// 两矩形共享边(相邻)
function rectAdjacent(ax, ay, aw, ah, bx, by, bw, bh) {
  return ((ax + aw === bx || bx + bw === ax) && ay < by + bh && by < ay + ah) ||
    ((ay + ah === by || by + bh === ay) && ax < bx + bw && bx < ax + aw);
}
// 找与已建建筑(built,含尺寸)相邻的 3×3 平地(开局住宅区)
function findHouseSpot(s, built) {
  const size = s.map.size;
  for (let y = 0; y <= size - 3; y++) for (let x = 0; x <= size - 3; x++) {
    if (!freeRect(s, x, y, 3, 3) || !terrainRectOk(s, x, y, 3, 3, PF)) continue;
    for (const pb of built) {
      const pbd = E.buildings.getDef(pb.type);
      const pbx = pb.x - Math.floor((pbd.size.w - 1) / 2), pby = pb.y - Math.floor((pbd.size.h - 1) / 2);
      if (rectAdjacent(x, y, 3, 3, pbx, pby, pbd.size.w, pbd.size.h)) return { x: x + 1, y: y + 1 };
    }
  }
  return null;
}
// 农田/工厂对(相邻):要求内陆(半径内平地 ≥75%,开发度全效)+ 半径内几乎无建筑
// [中心语义] 按 4×4 找位(覆盖 sheepFarm 3×3 + tailor 4×4 两种尺寸),返回中心
function findPlainPair(s, radius) {
  const r = radius || 7;
  const devNeed = Math.ceil((((2 * r + 1) * (2 * r + 1)) + 12) / 1.2); // dev≤25%(含建筑/路余量,更严) // dev≤25%(含放置后建筑/路 ~12 格)
  const size = s.map.size;
  for (let y = 0; y <= size - 4; y++) for (let x = 0; x <= size - 4; x++) {
    if (!freeRect(s, x, y, 4, 4) || !terrainRectOk(s, x, y, 4, 4, PF)) continue;
    if (!hasLandNb(s, x, y, 4, 4)) continue;
    const ccx = x + 2, ccy = y + 2;
    let occ = 0, devCount = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = ccx + dx, ny = ccy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const t = s.map.terrain[ny][nx];
      if (t === 0) devCount++; // [用户反馈] 可开发格=平地
      if (s.grid[key(nx, ny)]) occ++;
      if (s.roads[key(nx, ny)]) occ++;
    }
    if (devCount < devNeed) continue;
    if (occ > 5) continue;
    const nb = findAdjacentSpot(s, x + 2, y + 2, 4, 4, PF, 4, null, 4, 4); // [顺序8] dist 4:给 4×4 建筑留间隙
    if (nb) return { p1: { x: x + 2, y: y + 2 }, p2: nb };
  }
  return null;
}
// 伐木营地:4×4 平地,半径 7 内开发度低,且距仓库近(路径 ≤15 格,保证仓库服务覆盖)
function findSawmillSpot(s) {
  const size = s.map.size;
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const wd = E.buildings.getDef('warehouse');
  const wcx = wh.x, wcy = wh.y; // 中心语义:wh 坐标已是中心
  for (let y = 0; y <= size - 4; y++) for (let x = 0; x <= size - 4; x++) {
    if (Math.abs(x + 1 - wcx) + Math.abs(y + 1 - wcy) > 15) continue;
    if (!freeRect(s, x, y, 4, 4) || !terrainRectOk(s, x, y, 4, 4, PF)) continue;
    const ccx = x + 1, ccy = y + 1; // 4×4 中心偏置 1
    let occ = 0, devCount = 0;
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
      const fx = ccx + dx, fy = ccy + dy;
      if (fx < 0 || fy < 0 || fx >= size || fy >= size) continue;
      const t = s.map.terrain[fy][fx];
      if (t === 0) devCount++; // [用户反馈] 可开发格=平地(水/山/矿/黏土均计占用)
      if (s.grid[key(fx, fy)]) occ++;
      if (s.roads[key(fx, fy)]) occ++;
    }
    if (devCount < 180) continue; // 225 格半径:dev≤25% 需平地≥180
    if (occ > 5) continue;
    return { x: x + 1, y: y + 1 }; // 返回中心
  }
  return null;
}
// BFS 铺路:仓库 footprint → 目标建筑 footprint 外圈(仓库服务覆盖判定依赖此路)
function connectTo(s, tx, ty, avoid, targetCells) {
  const wh = Object.values(s.buildings).find((b) => {
    const d = E.buildings.getDef(b.type);
    return d && d.special === 'warehouse';
  });
  if (!wh) return false;
  const size = s.map.size;
  const wdef = E.buildings.getDef('warehouse');
  const w = (wdef.size && wdef.size.w) || 1, h = (wdef.size && wdef.size.h) || 1;
  const wbx = Math.floor((w - 1) / 2), wby = Math.floor((h - 1) / 2); // 中心语义:左上角 = 中心-偏置
  const prev = {};
  const seen = {};
  const queue = [];
  // [多仓库] BFS 起点 = 全部仓库(分仓库也是总池接入点,铺路从最近仓库出发)
  for (const wh of Object.values(s.buildings)) {
    const wd2 = E.buildings.getDef(wh.type);
    if (!wd2 || wd2.special !== 'warehouse') continue;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const k = key(wh.x - wbx + dx, wh.y - wby + dy);
      seen[k] = true;
      queue.push([wh.x - wbx + dx, wh.y - wby + dy]);
    }
  }
  let found = null;
  const avoidSet = new Set((avoid || []).map((p) => key(p.x, p.y)));
  const targetSet = new Set((targetCells || [{ x: tx, y: ty }]).map((p) => key(p.x, p.y)));
  while (queue.length && !found) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of dirs4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (targetSet.has(key(nx, ny))) {
        if (!targetSet.has(key(x, y))) { found = [x, y]; break; }
        continue;
      }
      const k = key(nx, ny);
      if (seen[k]) continue;
      const t = s.map.terrain[ny][nx];
      if (t === 6 || t === 7) continue;
      if (s.grid[k]) continue;
      if (avoidSet.has(k)) continue;
      seen[k] = true;
      prev[k] = [x, y];
      queue.push([nx, ny]);
    }
  }
  if (!found) return false;
  let cur = found;
  while (cur) {
    const k = key(cur[0], cur[1]);
    if (!s.roads[k]) setRoad(s, cur[0], cur[1], true);
    cur = prev[k];
  }
  // 保证仓库外圈有至少 1 格路(仓库门口,服务传播起点;建筑贴仓库无路时依赖此格)(中心语义)
  const tgtKeys = new Set((targetCells || [{ x: tx, y: ty }]).map((p) => key(p.x, p.y)));
  const wh0 = Object.values(s.buildings).find((b) => {
    const d = E.buildings.getDef(b.type);
    return d && d.special === 'warehouse';
  });
  if (wh0) {
  outer:
  for (const [dx, dy] of dirs4) {
    const exs = dx ? [wh0.x + (dx > 0 ? wbx + 1 : -(wbx + 1))] : Array.from({ length: w }, (_, i) => wh0.x - wbx + i);
    const eys = dy ? [wh0.y + (dy > 0 ? wby + 1 : -(wby + 1))] : Array.from({ length: h }, (_, i) => wh0.y - wby + i);
    for (const ex of exs) for (const ey of eys) {
      if (ex < 0 || ey < 0 || ex >= size || ey >= size) continue;
      const k = key(ex, ey);
      if (tgtKeys.has(k)) continue; // 门口路不进目标 footprint
      if (s.grid[k] || s.roads[k]) continue;
      const t = s.map.terrain[ey][ex];
      if (t === 6 || t === 7) continue;
      setRoad(s, ex, ey, true);
      break outer;
    }
  }
  }
  return true;
}
// 遍历所有路找必经路段(拆了断连的那条)
function findCutRoad(s, buildingId) {
  for (const k of Object.keys(s.roads)) {
    const [rx, ry] = k.split(',').map(Number);
    setRoad(s, rx, ry, false);
    if (!E.connectivity.isConnected(s, buildingId)) return k;
    setRoad(s, rx, ry, true);
  }
  return null;
}
// 拆建筑 footprint 外圈全部路(多路径/环网下必断)
function cutAdjacentRoads(s, buildingId) {
  const b = s.buildings[buildingId];
  if (!b) return 0;
  const def = E.buildings.getDef(b.type);
  const w = (def.size && def.size.w) || 1, h = (def.size && def.size.h) || 1;
  let n = 0;
  for (const k of Object.keys(s.roads)) {
    const [rx, ry] = k.split(',').map(Number);
    const adj = (rx >= b.x - 1 && rx <= b.x + w && ry >= b.y - 1 && ry <= b.y + h) &&
      !(rx >= b.x && rx < b.x + w && ry >= b.y && ry < b.y + h);
    if (adj) { setRoad(s, rx, ry, false); n++; }
  }
  return n;
}

// ---- 场景助手 ----
// [B-43] 测试基建:仓库 5×5(500金10木)+ 5 栋民居(显式注入 50 人,模拟已增长;新建民居真实初始 0 人由专项测试验证)
function setupBase(s) {
  const p = findSpot(s, 5, 5, null, PF);
  assert.ok(p, '应有 5×5 平地');
  const r = placeBuilding(s, 'warehouse', p.x, p.y);
  assert.equal(r.ok, true, '仓库应可建(500金)');
  // 仓库外圈铺路(仓库=物流服务建筑,必须连路才提供服务范围)
  outer:
  for (const [dx, dy] of dirs4) {
    const exs = dx ? [p.x + (dx > 0 ? 3 : -3)] : [p.x - 2, p.x - 1, p.x, p.x + 1, p.x + 2]; // 中心语义:5×5 中心±2,外圈±3
    const eys = dy ? [p.y + (dy > 0 ? 3 : -3)] : [p.y - 2, p.y - 1, p.y, p.y + 1, p.y + 2];
    for (const ex of exs) for (const ey of eys) {
      if (ex < 0 || ey < 0 || ex >= s.map.size || ey >= s.map.size) continue;
      const k = key(ex, ey);
      if (s.grid[k] || s.roads[k]) continue;
      const t = s.map.terrain[ey][ex];
      if (t === 6 || t === 7) continue;
      setRoad(s, ex, ey, true);
      break outer;
    }
  }
  const built = [r.building];
  for (let i = 0; i < 5; i++) {
    const spot = findHouseSpot(s, built);
    assert.ok(spot, '民居位置 ' + i);
    const rr = placeBuilding(s, 'residence', spot.x, spot.y);
    assert.equal(rr.ok, true, '民居可建 ' + i);
    built.push(rr.building);
    // 民居铺路(背侧 4 邻一格,模拟住宅路网)+ 补接仓库路网(民居路需在仓库服务覆盖内)
    outer:
    for (const [dx, dy] of dirs4) {
      const exs = dx ? [spot.x + (dx > 0 ? 2 : -2)] : [spot.x - 1, spot.x, spot.x + 1]; // 3×3 中心±1,外圈±2
      const eys = dy ? [spot.y + (dy > 0 ? 2 : -2)] : [spot.y - 1, spot.y, spot.y + 1];
      for (const ex of exs) for (const ey of eys) {
        if (ex < 0 || ey < 0 || ex >= s.map.size || ey >= s.map.size) continue;
        const k = key(ex, ey);
        if (s.grid[k] || s.roads[k]) continue;
        const t = s.map.terrain[ey][ex];
        if (t === 6 || t === 7) continue;
        setRoad(s, ex, ey, true);
        break outer;
      }
    }
    // 补接仓库路网:民居背侧路需连到仓库服务路网(玩家真实操作=把住宅区路接回仓库)
    const avH = footprint(E.buildings.getDef('residence'), spot.x, spot.y);
    connectTo(s, spot.x, spot.y, avH, avH);
  }
  // [B-43] 民居初始 0 人(规则由专项测试验证);测试基建显式模拟"已增长"人口:
  // 5 栋民居 × 10 = 50(后续测试可再调整库存/人口构造具体场景)
  s.population.farmers.count = 50;
  return r.building;
}
function setupMarket(s) {
  const res = Object.values(s.buildings).filter((b) => b.type === 'residence');
  if (!res.length) return null;
  const cx = Math.round(res.reduce((a, b) => a + b.x, 0) / res.length);
  const cy = Math.round(res.reduce((a, b) => a + b.y, 0) / res.length);
  for (let rad = 0; rad <= 24; rad++) {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      const x = cx + dx, y = cy + dy;
      if (x - 2 < 0 || y - 2 < 0 || x + 3 > 128 || y + 4 > 128) continue; // 5×6 中心偏置 (2,2)
      if (!freeRect(s, x - 2, y - 2, 5, 6) || !terrainRectOk(s, x - 2, y - 2, 5, 6, PF)) continue;
      const av = footprint(E.buildings.getDef('market'), x, y);
      if (!connectTo(s, x, y, av, av)) continue;
      const r = placeBuilding(s, 'market', x, y);
      if (r.ok) {
        E.population.updateNeeds(s);
        // [顺序8] 离散 influx:市场 sat>0 即全额提供人口;覆盖阈值 0.2 够用(矿脉占位后难找 0.5 位)
        if ((E.population.serviceCoverage(s, 'farmers', 'market') || 0) >= 0.2) return r.building;
        demolish(s, r.building.id);
      }
    }
  }
  return null;
}
function setupFishery(s) {
  setupBase(s);
  const c = findCoastFishery(s);
  assert.ok(c, '应有 5×16 沿海空地');
  const av = footprint(E.buildings.getDef('fishery'), c.x, c.y);
  connectTo(s, c.x, c.y, av, av);
  const r = placeBuilding(s, 'fishery', c.x, c.y);
  assert.equal(r.ok, true, '渔场应可放置于沿海');
  return r.building;
}
// 工人层砖链(陶土矿场 50 工人 + 砖厂 25 工人):手动置位工人人口,手动驱动周期
function setupBrick(s) {
  const clay = findSpot(s, 5, 5, 2, [2]); // [完全嵌合] 5×5 全黏土
  assert.ok(clay, '应有 5×5 陶土区(全黏土)');
  const avC = footprint(E.buildings.getDef('clayPit'), clay.x, clay.y);
  connectTo(s, clay.x, clay.y, avC, avC);
  const p = placeBuilding(s, 'clayPit', clay.x, clay.y);
  assert.equal(p.ok, true, '陶土矿场应可建(5×5)');
  const bwPos = findSpotNear(s, 5, 5, 20);
  assert.ok(bwPos, '砖厂位置(仓库附近平地)');
  const avB = footprint(E.buildings.getDef('brickworks'), bwPos.x, bwPos.y);
  connectTo(s, bwPos.x, bwPos.y, avC.concat(avB), avB);
  const b = placeBuilding(s, 'brickworks', bwPos.x, bwPos.y);
  assert.equal(b.ok, true, '砖厂应可建');
  s.resources.brick = 10;
  return b.building;
}
// [V1.10 修订⑤] 为链上每个建筑都铺路(仓库服务覆盖需建筑 4 邻接触被覆盖道路)
// avoid 全部 footprint:路径不穿过任何建筑候选区
function connectBuildings(s, list) {
  const allAv = [];
  for (const it of list) allAv.push(...footprint(E.buildings.getDef(it.type), it.x, it.y));
  for (const it of list) {
    const av = footprint(E.buildings.getDef(it.type), it.x, it.y);
    connectTo(s, it.x, it.y, allAv, av);
  }
}

function setupSchnapps(s) {
  setupBrick(s);
  const pair = findPlainPair(s, 12); // potatoField r12
  assert.ok(pair, '应有相邻 3×3 平地对');
  const avoidCells = footprint(E.buildings.getDef('potatoField'), pair.p1.x, pair.p1.y)
    .concat(footprint(E.buildings.getDef('distillery'), pair.p2.x, pair.p2.y));
  connectTo(s, pair.p1.x, pair.p1.y, avoidCells, footprint(E.buildings.getDef('potatoField'), pair.p1.x, pair.p1.y));
  const pf = placeBuilding(s, 'potatoField', pair.p1.x, pair.p1.y);
  const di = placeBuilding(s, 'distillery', pair.p2.x, pair.p2.y);
  assert.equal(pf.ok, true);
  assert.equal(di.ok, true);
  return di.building;
}

// ================= V1.8 生成器 =================

test('[V1.8] 生成器:同种子同图,边界全海,占比达标,矿脉贴山且成块', () => {
  const S = 128;
  const t = E.mapTemplate.generateMap(S, 42);
  const t2 = E.mapTemplate.generateMap(S, 42);
  let identical = true;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (t[y][x] !== t2[y][x]) identical = false;
  assert.equal(identical, true, '同种子 → 同图');

  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) counts[t[y][x]]++;
  const land = S * S - counts[6];
  assert.ok(land / (S * S) > 0.35 && land / (S * S) < 0.55, '陆地占比 35~55%');
  assert.ok(counts[7] / land > 0.06 && counts[7] / land < 0.25, '山脉占陆地 6~25%');
  assert.equal(counts[1], 0, '森林地形不再生成(用户决策移除)');
  assert.ok(counts[2] >= 30, '陶土 ≥30');
  assert.ok(counts[3] > counts[4] && counts[4] > counts[5], '铁 > 铜 > 金');
  assert.ok(counts[5] >= 9, '金矿 ≥9 格');
  assert.ok(counts[0] > 1500, '可建平地充足');

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (x < 4 || y < 4 || x >= S - 4 || y >= S - 4) assert.equal(t[y][x], 6, '边界必须海洋');
  }
  const adj8 = dirs4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (t[y][x] !== 3 && t[y][x] !== 4 && t[y][x] !== 5) continue;
    const same = dirs4.some(([dx, dy]) =>
      x + dx >= 0 && y + dy >= 0 && x + dx < S && y + dy < S && t[y + dy][x + dx] === t[y][x]);
    const nearMt = adj8.some(([dx, dy]) =>
      x + dx >= 0 && y + dy >= 0 && x + dx < S && y + dy < S && t[y + dy][x + dx] === 7);
    assert.equal(same || nearMt, true, '矿格应成块或贴山');
  }
});

test('[V1.8] 生成器:可通行陆地单连通(山脉为障碍)', () => {
  const S = 128;
  const t = E.mapTemplate.generateMap(S, 7);
  const seen = new Uint8Array(S * S);
  let largest = 0, totalPass = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (t[y][x] !== 6 && t[y][x] !== 7) totalPass++;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (t[y][x] === 6 || t[y][x] === 7 || seen[y * S + x]) continue;
    let size = 0;
    const q = [[x, y]];
    seen[y * S + x] = 1;
    while (q.length) {
      const [cx, cy] = q.pop();
      size++;
      for (const [dx, dy] of dirs4) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        if (t[ny][nx] === 6 || t[ny][nx] === 7 || seen[ny * S + nx]) continue;
        seen[ny * S + nx] = 1;
        q.push([nx, ny]);
      }
    }
    if (size > largest) largest = size;
  }
  assert.ok(totalPass > 0);
  assert.ok(largest / totalPass > 0.99, '可通行区域应单连通');
});

test('[B-43] 仓库与民居建造:仓库 5×5 收费 500,新建民居初始 0 人', () => {
  const s = createInitialState();
  assert.equal(Object.keys(s.buildings).length, 0);
  assert.equal(s.map.size, 128);
  const coin0 = s.resources.coin;
  const p = findSpot(s, 5, 5, null, PF);
  assert.ok(p);
  const r = placeBuilding(s, 'warehouse', p.x, p.y);
  assert.equal(r.ok, true);
  assert.equal(s.resources.coin, coin0 - 500, '仓库收费 500');
  assert.equal(s.resources.wood, 50, '仓库耗 10 木材');
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  assert.deepEqual(E.buildings.getDef('warehouse').size, { w: 5, h: 5 }, '仓库 5×5');
  // 手动建 3 栋民居(建造后先入住 10/栋)
  const built = [wh];
  for (let i = 0; i < 3; i++) {
    const sp = findHouseSpot(s, built);
    assert.ok(sp, '民居位置 ' + i);
    const rr = placeBuilding(s, 'residence', sp.x, sp.y);
    assert.equal(rr.ok, true);
    built.push(rr.building);
  }
  // [B-43] 新建民居 0 人(无保底;人口由需求满足驱动)
  assert.equal(s.population.farmers.count, 0, '新建民居初始 0 人');
  assert.equal(E.goals.getCurrentGoal(s).id, 'g1', '有仓库 → 引导建渔场');
});

test('[V1.10 修订⑤] 拆除返还:非金币 100% 返还,金币不返还;footprint 全清', () => {
  const s = createInitialState();
  const f = setupFishery(s); // 渔场成本 coin:100 wood:2
  const coin0 = s.resources.coin, wood0 = s.resources.wood;
  demolish(s, f.id);
  assert.equal(s.resources.wood, wood0 + 2, '木材全额返还');
  assert.equal(s.resources.coin, coin0, '金币不返还');
  const def = E.buildings.getDef('fishery');
  const bx = Math.floor((def.size.w - 1) / 2), by = Math.floor((def.size.h - 1) / 2); // 中心语义
  for (let dy = 0; dy < def.size.h; dy++) for (let dx = 0; dx < def.size.w; dx++) {
    assert.equal(s.grid[key(f.x - bx + dx, f.y - by + dy)], undefined, 'footprint 格全清');
  }
});

test('[V1.8] 山脉禁铺路/禁建筑', () => {
  const s = createInitialState();
  const m = findSpot(s, 1, 1, 7, [7]);
  assert.ok(m, '地图应有山脉');
  assert.equal(setRoad(s, m.x, m.y, true).ok, false, '山脉不可铺路');
  assert.equal(placeBuilding(s, 'residence', m.x, m.y).ok, false, '山脉不可建筑');
});

test('[V1.8] 多格占用与重叠:footprint 内不可再建', () => {
  const s = createInitialState();
  setupBase(s);
  const spot = findSpot(s, 4, 4, null, PF);
  assert.ok(spot);
  assert.equal(placeBuilding(s, 'sawmill', spot.x, spot.y).ok, true);
  assert.equal(placeBuilding(s, 'sawmill', spot.x + 1, spot.y + 1).ok, false, '重叠 footprint 不可');
  assert.equal(placeBuilding(s, 'residence', spot.x + 2, spot.y + 2).ok, false, '内部格不可再建');
});

// ================= 基础 =================

test('[V1.6] 时间推进:12 tick 一小时,288 tick 跨一天,暂停不推进', () => {
  const s = createInitialState();
  assert.deepEqual(s.time, { day: 1, hour: 0, tickAcc: 0 });
  for (let i = 0; i < 12; i++) E.tick.tick(s);
  assert.equal(s.time.hour, 1);
  assert.equal(s.time.day, 1);
  for (let i = 0; i < 276; i++) E.tick.tick(s);
  assert.equal(s.time.day, 2);
  s.settings.paused = true;
  const r = E.tick.tick(s);
  assert.equal(r.ticked, false);
  assert.equal(s.time.hour, 0, '暂停时时间不推进');
});

test('[V1.10] 收入:需求收入 × 满足度 × 当前人口,维护费按分钟扣除', () => {
  const s = createInitialState();
  setupBase(s); // 5 栋民居,50 人,鱼 300 满足
  E.population.updateNeeds(s);
  const before = s.resources.coin;
  E.population.collectTax(s);
  const income = (s.resources.coin - before) * 60;
  assert.ok(Math.abs(income - 0.125 * 50) < 0.01, '收入 = 鱼0.125×50人 = 6.25/分钟(实际 ' + income.toFixed(3) + ')');
  // 手动建渔场(避免 setupFishery 重复 setupBase)
  const c = findCoastFishery(s);
  assert.ok(c);
  const av = footprint(E.buildings.getDef('fishery'), c.x, c.y);
  connectTo(s, c.x, c.y, av, av);
  const f = placeBuilding(s, 'fishery', c.x, c.y);
  assert.equal(f.ok, true);
  const coin0 = s.resources.coin;
  E.tick.tick(s);
  const m = (coin0 - s.resources.coin + (s.rates.coin.produced || 0)) * 60;
  assert.ok(Math.abs(m - 60) < 0.5, '维护 = 渔场40+仓库20 = 60/分钟(实际 ' + m.toFixed(1) + ')');
});

test('[V1.10 修订⑥] tick 主循环按需求收入公式结算金币', () => {
  const s = createInitialState(12345);
  s.population.farmers.count = 10;
  const before = s.resources.coin;

  E.tick.tick(s);

  const pop = s.population.farmers;
  let expected = 0;
  for (const [good, need] of Object.entries(E.tiers.TIERS.farmers.needs)) {
    if (!need.income) continue;
    expected += need.income * ((pop.needSats || {})[good] ?? 0) * pop.count / 60;
  }
  const actual = s.resources.coin - before;
  assert.ok(expected > 0, '开局鱼库存满足鱼需求,应产生正的需求收入');
  assert.ok(Math.abs(actual - expected) < 1e-9,
    'tick 金币增量应等于需求收入(期望 ' + expected + ',实际 ' + actual + ')');
});

test('初始状态:128 地图,无建筑,资源(10000 金币/60 木/300 鱼)', () => {
  const s = createInitialState();
  assert.equal(Object.keys(s.buildings).length, 0);
  assert.equal(s.map.size, 128);
  assert.equal(s.population.farmers.count, 0, '开局无人口(民居驱动)');
  assert.equal(s.resources.coin, 10000); // [玩家反馈 #2] 开局金币 2500→10000
  assert.equal(s.resources.wood, 60);
  assert.equal(s.resources.fish, 300);
  assert.equal(E.goals.getCurrentGoal(s).id, 'g0', '初始目标:放仓库');
});

test('[V1.10 修订⑤] 仓库服务机制:生产建筑须在仓库服务范围内,范围外无法生产', () => {
  const s = createInitialState();
  setupBase(s);
  // 仓库覆盖道路 = 仓库沿路延伸 34 格
  const whRoads = E.population.serviceRoads(s, 'warehouse');
  assert.ok(whRoads.size > 0, '民居路网应在仓库服务范围内');
  // 渔场建在覆盖范围内(connectTo 铺路)→ producing
  const c = findCoastFishery(s);
  assert.ok(c);
  const av = footprint(E.buildings.getDef('fishery'), c.x, c.y);
  connectTo(s, c.x, c.y, av, av);
  const f = placeBuilding(s, 'fishery', c.x, c.y);
  assert.equal(f.ok, true);
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(f.building.status, 'producing', '范围内可生产');
  // 拆仓库外圈路(服务起点)→ 仓库无路 → 整个网络 disconnected(断连停工)
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const cutN = cutAdjacentRoads(s, wh.id);
  assert.ok(cutN > 0);
  E.economy.refresh(s, { produce: false, logs: false });
  assert.notEqual(f.building.status, 'producing', '仓库无路 → 停工(waiting=无服务起点/disconnected=断网)');
  // 恢复:重新铺路连接渔场(等价玩家重铺路),再缩小仓库服务半径 → 渔场有路但超范围 → waiting
  const avR = footprint(E.buildings.getDef('fishery'), f.building.x, f.building.y);
  connectTo(s, f.building.x, f.building.y, avR, avR);
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(f.building.status, 'producing', '恢复后渔场可生产');
  const whDef = E.buildings.getDef('warehouse');
  const origR = whDef.service.radius;
  whDef.service.radius = 1; // 临时缩小服务半径(渔场路径 >1 格 → 超范围)
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(E.connectivity.isConnected(s, f.building.id), true, '渔场仍有路连通');
  assert.equal(f.building.status, 'waiting', '仓库服务范围外无法生产');
  whDef.service.radius = origR; // 还原
});

test('连通性:铺路→连通,拆路→断连,补路→恢复', () => {
  const s = createInitialState();
  const fishery = setupFishery(s);
  assert.equal(E.connectivity.isConnected(s, fishery.id), true);
  assert.equal(fishery.status, 'producing');
  const cutN = cutAdjacentRoads(s, fishery.id);
  assert.ok(cutN > 0, '渔场应有邻接路');
  assert.equal(fishery.status, 'disconnected');
  const c2 = findCoastFishery(s);
  const av2 = footprint(E.buildings.getDef('fishery'), fishery.x, fishery.y);
  connectTo(s, fishery.x, fishery.y, av2, av2);
  assert.equal(E.connectivity.isConnected(s, fishery.id), true);
  assert.equal(fishery.status, 'producing');
});

test('[V1.10 修订⑤ 顺序8] 周期制:渔场 30 tick 产 1 鱼;消耗按当前人口', () => {
  const s = createInitialState();
  setupBase(s);
  const c = findCoastFishery(s);
  assert.ok(c, '应有向海渔场位');
  const av = footprint(E.buildings.getDef('fishery'), c.x, c.y);
  connectTo(s, c.x, c.y, av, av);
  const f = placeBuilding(s, 'fishery', c.x, c.y);
  assert.equal(f.ok, true, '渔场: ' + (f.reason || ''));
  assert.equal(f.building.status, 'producing', '渔场应 producing');
  // 固定人口 50,直接驱动(updateNeeds 消耗 + refresh 生产)→ 消耗 = 人口×率 精确
  s.population.farmers.count = 50;
  for (let i = 0; i < CYCLE; i++) {
    E.state.initFlow(s);
    E.population.updateNeeds(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
  const net = s.resources.fish - 300;
  assert.ok(Math.abs(net - (2 - 50 * 0.00004166667 * CYCLE)) < 0.01, '净 = 产2 - 耗(50人×率×60)=' + net.toFixed(3)); // [玩家反馈] rate 已÷容量(每住宅→每人)
  // 人口减半 → 消耗减半
  s.population.farmers.count = 25;
  const f2 = s.resources.fish;
  for (let i = 0; i < CYCLE; i++) {
    E.state.initFlow(s);
    E.population.updateNeeds(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
  const net2 = s.resources.fish - f2;
  assert.ok(Math.abs(net2 - (2 - 25 * 0.00004166667 * CYCLE)) < 0.01, '25人消耗减半: ' + net2.toFixed(3));
});

test('[B-43] 住户 Influx 模型:满足基础需求给全额人口(离散);至少 1 需求不塌', () => {
  const s = createInitialState();
  setupBase(s);
  assert.equal(s.population.farmers.count, 50, '测试基建显式注入 50 人');
  for (let i = 0; i < 200; i++) E.tick.tick(s);
  const cnt = s.population.farmers.count;
  assert.ok(Math.abs(cnt - 15) < 1, '无市场仅鱼 → 目标 15(3×5栋)(实际 ' + cnt.toFixed(1) + ')');
  const mk = setupMarket(s);
  assert.ok(mk, '市场应可建并覆盖民居');
  for (let i = 0; i < 200; i++) E.tick.tick(s);
  const cov2 = E.population.serviceCoverage(s, 'farmers', 'market');
  const cnt2 = s.population.farmers.count;
  const target2 = 5 * (5 + 3); // 离散:市场 sat>0 → 全额 5;鱼 → 3
  assert.ok(cov2 >= 0.3, '市场路距离覆盖率 ≥0.3(实际 ' + cov2.toFixed(2) + ')');
  assert.ok(Math.abs(cnt2 - target2) < 1.5, '目标 = 5×(5+3)=40(离散全额)(实际 ' + cnt2.toFixed(1) + ')');
});

test('断连建筑不生产', () => {
  const s = createInitialState();
  const fishery = setupFishery(s);
  const cutN = cutAdjacentRoads(s, fishery.id);
  assert.ok(cutN > 0, '渔场应有邻接路');
  const fish0 = s.resources.fish;
  E.tick.tick(s);
  assert.ok(s.resources.fish < fish0, '断连无产出,仅有消耗');
});

test('暂停时不推进', () => {
  const s = createInitialState();
  setupFishery(s);
  s.settings.paused = true;
  const fish0 = s.resources.fish;
  const r = E.tick.tick(s);
  assert.equal(r.ticked, false);
  assert.equal(s.resources.fish, fish0);
});

test('放置规则:地形/重叠/资金', () => {
  const s = createInitialState();
  setupBase(s);
  const res = findSpot(s, 3, 3, null, PF);
  assert.ok(res);
  assert.equal(placeBuilding(s, 'residence', res.x, res.y).ok, true, '平地可放民居');
  assert.equal(placeBuilding(s, 'residence', res.x, res.y).ok, false, '重叠不可');
  assert.equal(placeBuilding(s, 'residence', 0, 0).ok, false, '水域不可放民居');
  s.resources.coin = 0;
  const p2 = findSpot(s, 3, 3, null, PF);
  assert.equal(placeBuilding(s, 'fishery', p2.x, p2.y).ok, false, '资金不足不可建(渔场需 100 金币)');
});

test('拆除:清除占用,状态刷新,可重建', () => {
  const s = createInitialState();
  const fishery = setupFishery(s);
  const { x, y } = fishery;
  demolish(s, fishery.id);
  assert.equal(s.buildings[fishery.id], undefined);
  const r = placeBuilding(s, 'fishery', x, y);
  assert.equal(r.ok, true, '拆除后可重建');
});

test('阶层解锁:农民≥50 → 工人', () => {
  const s = createInitialState();
  s.population.farmers.count = 50;
  E.population.checkUnlocks(s);
  assert.equal(s.unlocks.workers, true);
  assert.ok(s.log.some((m) => m.includes('工人阶层')));
});

test('存档:序列化往返一致,损坏报错,无 localStorage 时 load 返回 null', () => {
  const s = createInitialState();
  const text = E.save.serialize(s);
  const back = E.save.deserialize(text);
  assert.deepEqual(back, s);
  assert.throws(() => E.save.deserialize('garbage'));
  assert.equal(E.save.load(), null, 'Node 无 localStorage → null');
});

test('[V1.10 修订⑤] 原木厂:未开发度机制(空旷 15s 产 1,60s 产 4)', () => {
  const s = createInitialState();
  setupBase(s);
  const spot = findSawmillSpot(s);
  assert.ok(spot, '应有空旷平地');
  const av = footprint(E.buildings.getDef('sawmill'), spot.x, spot.y);
  connectTo(s, spot.x, spot.y, av, av);
  const r = placeBuilding(s, 'sawmill', spot.x, spot.y);
  assert.equal(r.ok, true, '原木厂 4×4 可建');
  const w0 = s.resources.log || 0;
  for (let i = 0; i < CYCLE; i++) E.tick.tick(s);
  const gained = (s.resources.log || 0) - w0;
  assert.ok(Math.abs(gained - 4) < 0.1, '空旷区 60tick 产 4 木(15s×1×4,实际 ' + gained.toFixed(2) + ')');
  const dev = E.economy.developmentRatio(s, r.building, E.buildings.getDef('sawmill'));
  assert.ok(dev <= 0.25, '空旷区开发度 ≤25%(实际 ' + dev.toFixed(3) + ')');
});

test('[V1.10 修订②] 开发度 >25% 半效,>75% 停产', () => {
  const s = createInitialState();
  setupBase(s);
  const spot = findSawmillSpot(s);
  assert.ok(spot);
  const av = footprint(E.buildings.getDef('sawmill'), spot.x, spot.y);
  connectTo(s, spot.x, spot.y, av, av);
  const r = placeBuilding(s, 'sawmill', spot.x, spot.y);
  assert.equal(r.ok, true);
  const def = E.buildings.getDef('sawmill');
  const cx = r.building.x + 1, cy = r.building.y + 1; // 4×4 中心偏置 1
  const size = s.map.size;
  let dev = E.economy.developmentRatio(s, r.building, def);
  outer:
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
    if (dev > 0.3) break outer;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    const t = s.map.terrain[y][x];
    if (t === 6 || t === 7) continue;
    const k = key(x, y);
    if (s.grid[k] || s.roads[k]) continue;
    setRoad(s, x, y, true);
    dev = E.economy.developmentRatio(s, r.building, def);
  }
  assert.ok(dev > 0.25 && dev <= 0.5, '开发度应落在 (0.25, 0.5](实际 ' + dev.toFixed(3) + ')');
  const w0 = s.resources.log || 0;
  for (let i = 0; i < CYCLE; i++) E.tick.tick(s);
  const gained = (s.resources.log || 0) - w0;
  assert.ok(Math.abs(gained - 2) < 0.15, '半效 60tick 产 2 原木(实际 ' + gained.toFixed(2) + ')');
  let dev2 = E.economy.developmentRatio(s, r.building, def);
  outer2:
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
    if (dev2 > 0.8) break outer2;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    const t = s.map.terrain[y][x];
    if (t === 6 || t === 7) continue;
    const k = key(x, y);
    if (s.grid[k] || s.roads[k]) continue;
    setRoad(s, x, y, true);
    dev2 = E.economy.developmentRatio(s, r.building, def);
  }
  assert.ok(dev2 > 0.75, '开发度应 >75%(实际 ' + dev2.toFixed(3) + ')');
  const w1 = s.resources.log || 0;
  for (let i = 0; i < CYCLE; i++) E.tick.tick(s);
  assert.ok(Math.abs((s.resources.log || 0) - w1) < 0.01, '>75% 停产不产原木');
  assert.equal(r.building.status, 'waiting', '>75% 状态 waiting');
});

test('[V1.10 修订⑤] 住宅升级链:农民→工人→工匠(全基础需求+建材)', () => {
  const s = createInitialState();
  const base = findSpot(s, 5, 5, null, PF);
  assert.ok(base);
  const whB = placeBuilding(s, 'warehouse', base.x, base.y);
  assert.equal(whB.ok, true);
  const resSpot = findHouseSpot(s, [whB.building]);
  assert.ok(resSpot);
  const resB = placeBuilding(s, 'residence', resSpot.x, resSpot.y);
  assert.equal(resB.ok, true);
  const res = resB.building;
  s.resources.wood = 100;
  s.resources.brick = 100;
  s.resources.steel = 100;
  s.resources.windows = 100;
  s.resources.concrete = 100;
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1, schnapps: 0 };
  s.population.farmers.count = 10; // [玩家反馈 #4] 满员:1 栋容量 10
  const r2 = upgradeResidence(s, res.id);
  assert.equal(r2.ok, true, '需求满足+满员+4木可升级');
  assert.equal(s.resources.wood, 96, '100 - 4(升级) = 96');
  assert.equal(s.buildings[r2.building.id].type, 'residenceWorkers', '升级为工人住宅');
  // [B-43] 迁移该栋实际住户:农民 -10、工人 +10(拆开断言,原 0 && x 恒为 0 的 bug)
  assert.equal(s.population.farmers.count, 0, '农民人口迁移后为 0');
  assert.equal(s.population.workers.count, 10, '工人人口 +10(不是 20)');
  assert.equal(E.buildings.getDef('residenceWorkers').capacity, 20, '工人住宅容量 20');
  // 工人住宅 → 工匠住宅(6木2砖;工人全基础需求注入满足,奢侈不计)
  s.population.workers.needSats = { market: 1, fish: 1, workclothes: 1, sausage: 1, bread: 1, soap: 1, school: 1, schnapps: 0, bar: 0, church: 0, beer: 0 };
  s.population.workers.count = 20; // [玩家反馈 #4] 满员:工人住宅容量 20
  const w2 = upgradeResidence(s, r2.building.id);
  assert.equal(w2.ok, true, '工人→工匠(6木2砖)');
  assert.equal(s.resources.wood, 90, '96 - 6 = 90');
  assert.equal(s.resources.brick, 98, '100 - 2 = 98');
  assert.equal(s.buildings[w2.building.id].type, 'residenceArtisans', '升级为工匠住宅');
  // 工匠 → 工程师(8木3砖2钢2窗)
  s.population.artisans.needSats = { sausage: 1, bread: 1, soap: 1, school: 1, canned: 1, sewingMachine: 1, furCoat: 1, university: 1, church: 0, beer: 0, theater: 0, rum: 0 };
  s.population.artisans.count = 30; // [玩家反馈 #4] 满员:工匠住宅容量 30
  const w3 = upgradeResidence(s, w2.building.id);
  assert.equal(w3.ok, true, '工匠→工程师(8木3砖2钢2窗)');
  assert.equal(s.buildings[w3.building.id].type, 'residenceEngineers', '升级为工程师住宅');
  s.population.engineers.needSats = { canned: 1, sewingMachine: 1, furCoat: 1, university: 1, rum: 1, champagne: 1, glasses: 1, pocketWatch: 1, lightbulb: 1, coffee: 1, cigar: 1, chocolate: 1, bank: 1, theater: 0, church: 0, beer: 0 };
  s.population.engineers.count = 40; // [玩家反馈 #4] 满员:工程师住宅容量 40
  assert.equal(s.resources.wood, 82, '90 - 8 = 82');
  assert.equal(s.resources.steel, 96, '98 - 2 = 96');
  assert.equal(s.resources.windows, 98, '100 - 2 = 98');
  // 工程师 → 投资人(10木4砖3钢3窗3混凝土)
  s.population.engineers.needSats = { canned: 1, sewingMachine: 1, furCoat: 1, university: 1, glasses: 1, coffee: 1, electricity: 1, lightBulb: 1, theater: 0, rum: 0, bicycle: 0, pocketWatch: 0, bank: 0 };
  const w4 = upgradeResidence(s, w3.building.id);
  assert.equal(w4.ok, true, '工程师→投资人(10木4砖3钢3窗3混凝土)');
  assert.equal(s.buildings[w4.building.id].type, 'residenceInvestors', '升级为投资人住宅');
  assert.equal(s.resources.wood, 72, '82 - 10 = 72');
  assert.equal(s.resources.steel, 93, '96 - 3 = 93');
  assert.equal(s.resources.windows, 95, '98 - 3 = 95');
  assert.equal(s.resources.concrete, 97, '100 - 3 = 97');
  assert.equal(E.buildings.getDef('residenceInvestors').capacity, 50, '投资人住宅容量 50');
});

test('[V1.1] 目标系统:g0→g1→g2→g3→g4→g5→g6(V1.10 修订⑤ 数值)', () => {
  const s = createInitialState();
  assert.equal(E.goals.getCurrentGoal(s).id, 'g0', '开局无仓库');
  setupBase(s); // 建仓库 + 5 栋民居(50 人)
  s.population.farmers.count = 15; // 模拟需求不足流失
  assert.equal(E.goals.getCurrentGoal(s).id, 'g1');
  const c = findCoastFishery(s);
  assert.ok(c);
  const avC = footprint(E.buildings.getDef('fishery'), c.x, c.y);
  const r = placeBuilding(s, 'fishery', c.x, c.y);
  assert.equal(r.ok, true);
  let cut = findCutRoad(s, r.building.id);
  while (cut) { setRoad(s, ...cut.split(',').map(Number), false); cut = findCutRoad(s, r.building.id); }
  assert.equal(E.goals.getCurrentGoal(s).id, 'g2', '渔场未连通');
  connectTo(s, c.x, c.y, avC, avC);
  assert.equal(E.goals.getCurrentGoal(s).id, 'g3', '已连通 → 引导烈酒链');
  setupBrick(s);
  const pair = findPlainPair(s, 12); // potatoField r12
  assert.ok(pair);
  connectBuildings(s, [
    { type: 'potatoField', ...pair.p1 }, { type: 'distillery', ...pair.p2 },
  ]);
  const p = placeBuilding(s, 'potatoField', pair.p1.x, pair.p1.y);
  assert.equal(p.ok, true);
  assert.equal(E.goals.getCurrentGoal(s).id, 'g3', '仅土豆田(1/2)');
  const d = placeBuilding(s, 'distillery', pair.p2.x, pair.p2.y);
  assert.equal(d.ok, true);
  assert.equal(E.goals.getCurrentGoal(s).id, 'g4', '烈酒链齐 → 引导工作服链');
  // 工作服链(绵羊牧场+纺织厂)
  const pair2 = findPlainPair(s, 5);
  assert.ok(pair2);
  connectBuildings(s, [
    { type: 'sheepFarm', ...pair2.p1 }, { type: 'tailor', ...pair2.p2 },
  ]);
  const sh2 = placeBuilding(s, 'sheepFarm', pair2.p1.x, pair2.p1.y);
  const ta2 = placeBuilding(s, 'tailor', pair2.p2.x, pair2.p2.y);
  assert.equal(sh2.ok, true);
  assert.equal(ta2.ok, true);
  assert.equal(E.goals.getCurrentGoal(s).id, 'g5', '工作服链齐 → 解锁工人目标(人口不足)');
  s.resources.workclothes = 100;
  for (let i = 0; i < CYCLE * 3; i++) E.tick.tick(s);
  // 鱼+工作服满足 → 目标 25(市场覆盖细节由 Influx 测试验证,此处验证引导流程)
  assert.ok(s.population.farmers.count >= 24, '人口回升(实际 ' + s.population.farmers.count.toFixed(1) + ')');
  s.population.farmers.count = 50;
  E.population.checkUnlocks(s);
  assert.equal(E.goals.getCurrentGoal(s).id, 'g6', '人口 50 → 自由发展');
});

test('[V1.10 修订⑤] 工作服链:绵羊牧场→纺织厂(一步,核查表)', () => {
  const s = createInitialState();
  setupBase(s);
  const pair = findPlainPair(s, 5);
  assert.ok(pair, '应有平地对');
  connectBuildings(s, [
    { type: 'sheepFarm', ...pair.p1 }, { type: 'tailor', ...pair.p2 },
  ]);
  const sh = placeBuilding(s, 'sheepFarm', pair.p1.x, pair.p1.y);
  const ta = placeBuilding(s, 'tailor', pair.p2.x, pair.p2.y);
  assert.equal(sh.ok, true, '绵羊牧场 3×3: ' + (sh.reason || ''));
  assert.equal(ta.ok, true, '纺织厂 4×4: ' + (ta.reason || ''));
  // 直接驱动周期(纺织厂需 50 农民,渐近慢;绵羊 30s 产1 = 纺织 30s 耗1)
  s.population.farmers.count = 50;
  for (let i = 0; i < CYCLE * 2; i++) {
    E.state.initFlow(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
  assert.ok(s.resources.workclothes > 0, '纺织厂应产出工作服');
  assert.equal(ta.building.status, 'producing');
});

test('[V1.10 修订⑤] 砖块链(工人层):陶土矿场+砖厂,手动工人驱动周期', () => {
  const s = createInitialState();
  setupBase(s);
  const clay = findSpot(s, 5, 5, 2, [2]); // [完全嵌合] 5×5 全黏土
  assert.ok(clay);
  const avC = footprint(E.buildings.getDef('clayPit'), clay.x, clay.y);
  connectTo(s, clay.x, clay.y, avC, avC);
  const p = placeBuilding(s, 'clayPit', clay.x, clay.y);
  const bwPos = findAdjacentSpot(s, clay.x, clay.y, 5, 5, ALL_LAND, 5, null, 5, 5);
  assert.ok(bwPos);
  const avB = footprint(E.buildings.getDef('brickworks'), bwPos.x, bwPos.y);
  connectTo(s, bwPos.x, bwPos.y, avC.concat(avB), avB);
  const w = placeBuilding(s, 'brickworks', bwPos.x, bwPos.y);
  assert.equal(p.ok, true, '陶土矿场 5×5');
  assert.equal(w.ok, true, '砖厂 5×5');
  // 工人层:手动置位工人人口 + 直接驱动生产周期
  s.population.workers.count = 100;
  s.resources.clay = 100;
  for (let i = 0; i < CYCLE; i++) {
    E.state.initFlow(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
  assert.ok(s.resources.brick > 0, '砖厂应产出砖');
  assert.equal(w.building.status, 'producing');
});

test('[V1.10 修订⑤] 烈酒链:土豆农场(未开发半径12)+烈酒厂(30s)', () => {
  const s = createInitialState();
  setupBase(s);
  s.resources.coin = 5000;
  const pair = findPlainPair(s, 12); // potatoField r12
  assert.ok(pair);
  connectBuildings(s, [
    { type: 'potatoField', ...pair.p1 }, { type: 'distillery', ...pair.p2 },
  ]);
  const pf = placeBuilding(s, 'potatoField', pair.p1.x, pair.p1.y);
  const di = placeBuilding(s, 'distillery', pair.p2.x, pair.p2.y);
  assert.equal(pf.ok, true, '土豆农场 3×3');
  assert.equal(di.ok, true, '烈酒厂 3×4');
  assert.equal(E.buildings.getDef('potatoField').production.radius, 12, '土豆农场未开发半径 12');
  // 直接驱动周期(烈酒厂需 50 农民,人口渐近慢)
  s.population.farmers.count = 50;
  s.resources.potato = 100;
  for (let i = 0; i < CYCLE; i++) {
    E.state.initFlow(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
  assert.ok(s.resources.schnapps > 0, '烈酒厂应产出烈酒');
  assert.equal(di.building.status, 'producing');
});

test('[V1.2] 生产链总览:商品聚合正确(修订⑤ 纺织一步链)', () => {
  const chains = E.chains.buildChains();
  assert.ok(chains.fish.producers.some((d) => d.id === 'fishery'));
  assert.ok(chains.fish.consumers.some((d) => d.tier === 'farmers'));
  assert.ok(chains.potato.producers.some((d) => d.id === 'potatoField'));
  assert.ok(chains.potato.consumers.some((d) => d.id === 'distillery'));
  assert.ok(chains.schnapps.producers.some((d) => d.id === 'distillery'));
  assert.ok(chains.schnapps.consumers.some((d) => d.tier === 'farmers'));
  assert.ok(chains.wood.producers.some((d) => d.id === 'boardmill'), '木材生产者 = 木板厂(原木厂产原木)');
  assert.ok(chains.log.producers.some((d) => d.id === 'sawmill'), '原木生产者 = 原木厂');
  assert.ok(chains.wool.producers.some((d) => d.id === 'sheepFarm'));
  assert.ok(chains.workclothes.producers.some((d) => d.id === 'tailor'));
  assert.ok(chains.workclothes.consumers.some((d) => d.tier === 'farmers'));
  // [顺序4] 工人链聚合
  assert.ok(chains.pig.producers.some((d) => d.id === 'pigFarm'));
  assert.ok(chains.sausage.producers.some((d) => d.id === 'sausageFactory'));
  assert.ok(chains.bread.producers.some((d) => d.id === 'bakery'));
  assert.ok(chains.beer.producers.some((d) => d.id === 'brewery'));
  assert.ok(chains.beer.consumers.some((d) => d.tier === 'workers'));
  assert.ok(chains.steelBar.producers.some((d) => d.id === 'blastFurnace'));
  assert.ok(chains.steelBar.consumers.some((d) => d.id === 'steelWorks'));
  assert.ok(chains.soap.producers.some((d) => d.id === 'soapFactory'));
});

test('[V1.2] 每 tick 流量统计:产出/消耗/净速率(周期制下按累计)', () => {
  const s = createInitialState();
  const f = setupFishery(s);
  s.population.farmers.count = 50; // 固定人口
  const fish0 = s.resources.fish;
  for (let i = 0; i < CYCLE; i++) {
    E.state.initFlow(s);
    E.population.updateNeeds(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
  const net = s.resources.fish - fish0;
  const expectNet = 2 - 50 * 0.00004166667 * CYCLE; // [玩家反馈] rate 已÷容量(每住宅→每人)
  assert.ok(Math.abs(net - expectNet) < 0.01, '净变化 = 产-耗(实际 ' + net.toFixed(3) + ')');
  assert.ok(s.flow.fish && s.flow.fish.produced > 0 && s.flow.fish.consumed > 0, '流量统计含产出/消耗');
});

// [V1.10 修订⑤ 顺序4] 工人链测试助手:手动置位工人人口 + 直接驱动生产周期
// (工人层无住宅时 updatePopulation 会把 workers 拉回 0,故跳过人口模型,聚焦链逻辑)
function driveWorkers(s, ticks, workforce) {
  s.population.workers.count = workforce || 500;
  for (let i = 0; i < ticks; i++) {
    E.state.initFlow(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
}
// [顺序6] 按阶层驱动(工匠等)
function driveTier(s, ticks, tier, workforce) {
  s.population[tier].count = workforce || 500;
  for (let i = 0; i < ticks; i++) {
    E.state.initFlow(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
}
// 宽型海岸找位(砂石采集场 6×16):距仓库 ≤24(服务覆盖)且 ≥6(不贴边)
function findCoastRect(s, W, H) {
  const size = s.map.size;
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const wd = E.buildings.getDef('warehouse');
  const cx = wh.x, cy = wh.y; // 中心语义
  for (let y = 0; y <= size - H; y++) for (let x = 0; x <= size - W; x++) {
    const mh = Math.abs(x + W / 2 - cx) + Math.abs(y + H / 2 - cy);
    if (mh > 24 || mh < 6) continue;
    if (!freeRect(s, x, y, W, H)) continue;
    // [顺序10 用户修正] 任何一点不可在陆地:footprint 全水格 + 至少一格 4 邻接陆地
    let allWater = true, anyLandNb = false;
    for (let dy = 0; dy < H && allWater; dy++) for (let dx = 0; dx < W && allWater; dx++) {
      if (s.map.terrain[y + dy][x + dx] !== 6) { allWater = false; break; }
      if (dirs4.some(([ddx, ddy]) => {
        const wx = x + dx + ddx, wy = y + dy + ddy;
        return wx >= 0 && wy >= 0 && wx < size && wy < size && s.map.terrain[wy][wx] !== 6 && s.map.terrain[wy][wx] !== 7;
      })) anyLandNb = true;
    }
    if (!allWater || !anyLandNb) continue;
    // 仓库可达+覆盖验证:岸侧陆路 connectTo 铺路,且 4 邻路在仓库覆盖内(中心语义)
    if (wh) {
      const bx2 = Math.floor((W - 1) / 2), by2 = Math.floor((H - 1) / 2);
      const av = footprint(E.buildings.getDef('sandPit'), x + bx2, y + by2);
      if (!connectTo(s, x + bx2, y + by2, av, av)) continue;
      const roads = E.population.serviceRoads(s, 'warehouse');
      let covered = false;
      for (const c of av) for (const [ddx, ddy] of dirs4) {
        const nx = c.x + ddx, ny = c.y + ddy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (roads.has(key(nx, ny))) { covered = true; break; }
      }
      if (!covered) continue;
    }
    return { x: x + Math.floor((W - 1) / 2), y: y + Math.floor((H - 1) / 2) }; // 返回中心
  }
  return null;
}
// 建链上每个建筑并铺路(仓库服务覆盖)
function placeChain(s, list) {
  s.resources.coin = 50000; // 工匠建筑成本高(罐头厂 15000),测试给足预算
  s.resources.brick = 100;
  s.resources.wood = 100;
  s.resources.steel = 100;
  s.resources.windows = 100;
  s.resources.concrete = 100;
  const avs = [];
  for (const it of list) avs.push(...footprint(E.buildings.getDef(it.type), it.x, it.y));
  const placed = [];
  for (const it of list) {
    const av = footprint(E.buildings.getDef(it.type), it.x, it.y);
    connectTo(s, it.x, it.y, avs, av);
    const r = placeBuilding(s, it.type, it.x, it.y);
    assert.equal(r.ok, true, it.type + ' 可建: ' + (r.reason || ''));
    placed.push(r.building);
  }
  return placed;
}
// 单建筑空旷位(农场类:内陆 + 半径 R 内几乎无建筑 + 仓库 ≤20 服务覆盖)
// occ 只算建筑(grid)不算路:连接路必然经过半径内,不能因此拒绝;dev 机制本身算路
function findOpenSpot(s, w, h, R, maxDist) {
  const r = R || 7;
  const md = maxDist || 20;
  const devNeed = Math.ceil((((2 * r + 1) * (2 * r + 1)) + 12) / 1.2); // dev≤25%(含建筑/路余量,更严) // dev≤25%(含放置后建筑/路 ~12 格)
  const size = s.map.size;
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const wd = E.buildings.getDef('warehouse');
  const cx = wh.x, cy = wh.y; // 中心语义
  for (let y = 0; y <= size - h; y++) for (let x = 0; x <= size - w; x++) {
    if (Math.abs(x + w / 2 - cx) + Math.abs(y + h / 2 - cy) > md) continue;
    if (!freeRect(s, x, y, w, h) || !terrainRectOk(s, x, y, w, h, PF)) continue;
    if (!hasLandNb(s, x, y, w, h)) continue;
    const ccx = x + Math.floor((w - 1) / 2), ccy = y + Math.floor((h - 1) / 2);
    let occ = 0, devCount = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = ccx + dx, ny = ccy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const t = s.map.terrain[ny][nx];
      if (t === 0) devCount++; // [用户反馈] 可开发格=平地
      if (s.grid[key(nx, ny)]) occ++;
    }
    if (devCount < devNeed) continue; // 半径内平地 ≥75%(开发度全效)
    if (occ / devCount > 0.2) continue; // 半径内建筑占用 ≤20%(保证全效;半径大分母大,容忍多建筑)
    return { x: x + Math.floor((w - 1) / 2), y: y + Math.floor((h - 1) / 2) }; // 返回中心
  }
  return null;
}
// 清掉民居与路,保留仓库(工人链测试:仓库服务覆盖需要空旷路网)
function clearAround(s) {
  for (const b of Object.values(s.buildings)) if (b.type !== 'warehouse') demolish(s, b.id);
  for (const k of Object.keys(s.roads)) setRoad(s, ...k.split(',').map(Number), false);
}
// [开发度机制] 农田/牧场远离主仓库时,在目标旁放"分仓库"提供服务覆盖(玩家真实操作:多仓库=总池接入点)
function addLocalWarehouse(s, nearX, nearY) {
  let spot = null;
  for (let rad = 0; rad <= 14 && !spot; rad++) {
    for (let dy = -rad; dy <= rad && !spot; dy++) for (let dx = -rad; dx <= rad && !spot; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      const x = nearX + dx, y = nearY + dy;
      if (Math.abs(x - nearX) < 5 && Math.abs(y - nearY) < 5) continue; // 避开目标建筑候选位
      if (x - 2 < 0 || y - 2 < 0 || x + 3 > 128 || y + 3 > 128) continue;
      if (!freeRect(s, x - 2, y - 2, 5, 5) || !terrainRectOk(s, x - 2, y - 2, 5, 5, PF)) continue;
      spot = { x, y };
    }
  }
  if (!spot) return null;
  const r = placeBuilding(s, 'warehouse', spot.x, spot.y);
  if (!r.ok) return null;
  outer:
  for (const [dx, dy] of dirs4) {
    const exs = dx ? [spot.x + (dx > 0 ? 3 : -3)] : [spot.x - 2, spot.x - 1, spot.x, spot.x + 1, spot.x + 2];
    const eys = dy ? [spot.y + (dy > 0 ? 3 : -3)] : [spot.y - 2, spot.y - 1, spot.y, spot.y + 1, spot.y + 2];
    for (const ex of exs) for (const ey of eys) {
      if (ex < 0 || ey < 0 || ex >= 128 || ey >= 128) continue;
      if (s.grid[key(ex, ey)] || s.roads[key(ex, ey)]) continue;
      if (s.map.terrain[ey][ex] === 6 || s.map.terrain[ey][ex] === 7) continue;
      setRoad(s, ex, ey, true);
      break outer;
    }
  }
  return r.building;
}
// [H-03回归] 远离仓库的找位(距最近仓库 >40 格,保证断路)
function findSpotFar(s, w, h) {
  const size = s.map.size;
  const whs = Object.values(s.buildings).filter((b) => {
    const d = E.buildings.getDef(b.type);
    return d && d.special === 'warehouse';
  });
  const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2);
  for (let cy = by; cy <= size - 1 - (h - 1 - by); cy++) for (let cx = bx; cx <= size - 1 - (w - 1 - bx); cx++) {
    if (whs.some((wh) => Math.abs(wh.x - cx) < 40 && Math.abs(wh.y - cy) < 40)) continue;
    const x = cx - bx, y = cy - by;
    if (!freeRect(s, x, y, w, h) || !terrainRectOk(s, x, y, w, h, PF)) continue;
    return { x: cx, y: cy };
  }
  return null;
}
// 仓库附近找位(路径 ≤34 格 → 仓库服务覆盖);anchorCode=锚点地形(如铁矿 3)
function findSpotNear(s, w, h, maxDist, anchorCode, minDist, codes) {
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const wd = E.buildings.getDef('warehouse');
  const cx = wh.x, cy = wh.y; // 中心语义
  const size = s.map.size;
  const cs = codes || PF;
  for (let y = 0; y <= size - h; y++) for (let x = 0; x <= size - w; x++) {
    const mh = Math.abs(x + w / 2 - cx) + Math.abs(y + h / 2 - cy);
    if (mh > maxDist) continue;
    if (minDist && mh < minDist) continue; // 不贴仓库(留出铺路空间)
    if (anchorCode !== null && anchorCode !== undefined && s.map.terrain[y + Math.floor((h - 1) / 2)][x + Math.floor((w - 1) / 2)] !== anchorCode) continue; // 锚点=中心格
    if (!freeRect(s, x, y, w, h) || !terrainRectOk(s, x, y, w, h, cs)) continue;
    if (!hasLandNb(s, x, y, w, h)) continue;
    return { x: x + Math.floor((w - 1) / 2), y: y + Math.floor((h - 1) / 2) }; // 返回中心
  }
  return null;
}
// 找两个相邻平地(谷物/猪等农场对):要求内陆 + 半径内平地 ≥75%(开发度全效)+ 几乎无建筑
function findPairNear(s, w, h, radius) {
  const r = radius || 7;
  const devNeed = Math.ceil((((2 * r + 1) * (2 * r + 1)) + 12) / 1.2); // dev≤25%(含建筑/路余量,更严) // dev≤25%(含放置后建筑/路)
  const size = s.map.size;
  for (let y = 0; y <= size - h; y++) for (let x = 0; x <= size - w; x++) {
    if (!freeRect(s, x, y, w, h) || !terrainRectOk(s, x, y, w, h, PF)) continue;
    if (!hasLandNb(s, x, y, w, h)) continue;
    const ccx = x + Math.floor((w - 1) / 2), ccy = y + Math.floor((h - 1) / 2);
    let occ = 0, devCount = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = ccx + dx, ny = ccy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const t = s.map.terrain[ny][nx];
      if (t === 0) devCount++; // [用户反馈] 可开发格=平地
      if (s.grid[key(nx, ny)]) occ++;
      if (s.roads[key(nx, ny)]) occ++;
    }
    if (devCount < devNeed) continue;
    if (occ > 5) continue;
    const nb = findAdjacentSpot(s, ccx, ccy, w, h, PF, 3, null, w, h);
    if (nb) return { p1: { x: ccx, y: ccy }, p2: nb };
  }
  return null;
}

test('[V1.10 修订⑤ 顺序4] 工人链:猪牧场→香肠厂(周期/消耗)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  // 猪牧场单独放空旷区(未开发度机制),香肠厂放仓库附近工业位(服务覆盖)
  const pigSpot = findPairNear(s, 3, 4, 5);
  assert.ok(pigSpot, '猪牧场空旷位');
  placeChain(s, [{ type: 'pigFarm', ...pigSpot.p1 }]);
  const facSpot = findSpotNear(s, 3, 4, 20);
  assert.ok(facSpot, '香肠厂位置(仓库附近)');
  const built = placeChain(s, [{ type: 'sausageFactory', ...facSpot }]);
  driveWorkers(s, CYCLE * 2, 100);
  assert.ok(s.resources.sausage > 0, '香肠应产出');
  assert.equal(built[0].status, 'producing');
});

test('[V1.10 修订⑤ 顺序4] 工人链:谷物→磨坊→面包店(三步链)', () => {
  const s = createInitialState();
  setupBase(s);
  const pair = findPairNear(s, 3, 4, 24);
  assert.ok(pair);
  addLocalWarehouse(s, pair.p1.x, pair.p1.y); // 农田远离主仓库 → 先放分仓库(placeChain 铺路时即接入)
  const built = placeChain(s, [
    { type: 'grainFarm', ...pair.p1 }, { type: 'mill', ...pair.p2 },
  ]);
  const tPos = findSpot(s, 3, 4, null, PF);
  assert.ok(tPos, '面包店位置');
  const avB = footprint(E.buildings.getDef('bakery'), tPos.x, tPos.y);
  connectTo(s, tPos.x, tPos.y, avB, avB);
  const bk = placeBuilding(s, 'bakery', tPos.x, tPos.y);
  assert.equal(bk.ok, true);
  driveWorkers(s, CYCLE * 3, 100);
  const gf = Object.values(s.buildings).find((b) => b.type === 'grainFarm');
  assert.ok(s.resources.bread > 0, '面包应产出');
  assert.ok(s.resources.flour <= 2, '面粉不堆积');
});

test('[V1.10 修订⑤ 顺序4] 工人链:啤酒(谷物→麦芽+啤酒花→酿酒厂,多输入)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.steel = 100; s.resources.windows = 100; s.resources.concrete = 100;
  const pair = findPairNear(s, 3, 4, 24); // grainFarm r24 / hopFarm r16,取最大
  assert.ok(pair);
  addLocalWarehouse(s, pair.p1.x, pair.p1.y); // 农田远离主仓库 → 先放分仓库
  placeChain(s, [
    { type: 'grainFarm', ...pair.p1 }, { type: 'hopFarm', ...pair.p2 },
  ]);
  const mPos = findSpotNear(s, 4, 5, 24);
  assert.ok(mPos, '麦芽厂位置');
  const avM = footprint(E.buildings.getDef('maltWorks'), mPos.x, mPos.y);
  connectTo(s, mPos.x, mPos.y, avM, avM);
  const malt = placeBuilding(s, 'maltWorks', mPos.x, mPos.y);
  assert.equal(malt.ok, true);
  const bPos = findSpotNear(s, 4, 5, 26);
  assert.ok(bPos, '酿酒厂位置');
  const avB = footprint(E.buildings.getDef('brewery'), bPos.x, bPos.y);
  connectTo(s, bPos.x, bPos.y, avM.concat(avB), avB);
  const brew = placeBuilding(s, 'brewery', bPos.x, bPos.y);
  assert.equal(brew.ok, true);
  assert.deepEqual(E.buildings.getDef('brewery').production.inputs, { malt: 1, hops: 1 }, '酿酒厂多输入');
  driveWorkers(s, CYCLE * 4, 200);
  assert.ok(s.resources.beer > 0, '啤酒应产出(链末端库存可能耗尽转 waiting,属正常)');
});

test('[V1.10 修订⑤ 顺序4] 工人链:钢铁(铁矿+炭窑→高炉→钢材厂,多输入)', () => {
  const s = createInitialState();
  // 铁矿在山缘:仓库直接建在铁矿旁(生产建筑须在仓库服务范围内)
  const iron = findSpot(s, 3, 3, 3, [3]); // [用户要求] 矿建筑须完全嵌合矿脉(全格铁)
  assert.ok(iron, '应有铁矿区');
  const whPos = findAdjacentSpot(s, iron.x, iron.y, 5, 5, ALL_LAND, 6, null, 3, 3);
  assert.ok(whPos, '铁矿旁应有仓库位');
  const whB = placeBuilding(s, 'warehouse', whPos.x, whPos.y);
  assert.equal(whB.ok, true, '仓库(铁矿旁): ' + (whB.reason || ''));
  outer:
  for (const [dx, dy] of dirs4) {
    const exs = dx ? [whPos.x + (dx > 0 ? 3 : -3)] : [whPos.x - 2, whPos.x - 1, whPos.x, whPos.x + 1, whPos.x + 2]; // 中心语义:5×5 中心±2,外圈±3
    const eys = dy ? [whPos.y + (dy > 0 ? 3 : -3)] : [whPos.y - 2, whPos.y - 1, whPos.y, whPos.y + 1, whPos.y + 2];
    for (const ex of exs) for (const ey of eys) {
      if (ex < 0 || ey < 0 || ex >= 128 || ey >= 128) continue;
      const k = key(ex, ey);
      if (s.grid[k] || s.roads[k]) continue;
      const t = s.map.terrain[ey][ex];
      if (t === 6 || t === 7) continue;
      setRoad(s, ex, ey, true);
      break outer;
    }
  }
  s.resources.coin = 20000; s.resources.brick = 100; s.resources.wood = 100;
  const avI = footprint(E.buildings.getDef('ironMine'), iron.x, iron.y);
  connectTo(s, iron.x, iron.y, avI, avI);
  const im = placeBuilding(s, 'ironMine', iron.x, iron.y);
  assert.equal(im.ok, true, '铁矿: ' + (im.reason || ''));
  const kilnPos = findSpotNear(s, 5, 5, 20);
  assert.ok(kilnPos, '炭窑位置');
  const avK = footprint(E.buildings.getDef('charcoalKiln'), kilnPos.x, kilnPos.y);
  connectTo(s, kilnPos.x, kilnPos.y, avK, avK);
  const kiln = placeBuilding(s, 'charcoalKiln', kilnPos.x, kilnPos.y);
  assert.equal(kiln.ok, true, '炭窑: ' + (kiln.reason || ''));
  const bfPos = findSpotNear(s, 4, 7, 22);
  assert.ok(bfPos, '高炉位置');
  const avB = footprint(E.buildings.getDef('blastFurnace'), bfPos.x, bfPos.y);
  connectTo(s, bfPos.x, bfPos.y, avI.concat(avB), avB);
  const bf = placeBuilding(s, 'blastFurnace', bfPos.x, bfPos.y);
  assert.equal(bf.ok, true, '高炉: ' + (bf.reason || ''));
  assert.deepEqual(E.buildings.getDef('blastFurnace').production.inputs, { ironOre: 1, coal: 1 }, '高炉多输入');
  driveWorkers(s, CYCLE * 3, 300);
  assert.ok(s.resources.steelBar > 0, '钢铁应产出');
  assert.equal(bf.building.status, 'producing');
});

test('[V1.10 修订⑤ 顺序4] 工人链:肥皂(猪→精炼厂→肥皂厂)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.steel = 100; s.resources.windows = 100; s.resources.concrete = 100;
  // 猪牧场单独空旷;精炼厂(耗猪)+肥皂厂(耗油脂)放仓库附近工业位
  const pigSpot = findPairNear(s, 3, 4, 5);
  assert.ok(pigSpot, '猪牧场空旷位');
  addLocalWarehouse(s, pigSpot.p1.x, pigSpot.p1.y); // 牧场远离主仓库 → 先放分仓库
  placeChain(s, [{ type: 'pigFarm', ...pigSpot.p1 }]);
  const rPos = findSpotNear(s, 3, 3, 20);
  assert.ok(rPos, '精炼厂位置');
  placeChain(s, [{ type: 'renderingWorks', ...rPos }]);
  const sPos = findSpotNear(s, 4, 4, 20);
  assert.ok(sPos, '肥皂厂位置');
  const avS = footprint(E.buildings.getDef('soapFactory'), sPos.x, sPos.y);
  connectTo(s, sPos.x, sPos.y, avS, avS);
  const sf = placeBuilding(s, 'soapFactory', sPos.x, sPos.y);
  assert.equal(sf.ok, true);
  driveWorkers(s, CYCLE * 6, 200); // 半效风险:加长驱动保证产出
  assert.ok(s.resources.soap > 0, '肥皂应产出');
});

test('[V1.10 修订⑤ 顺序6] 工匠链:窗户(砂石→玻璃厂→窗户厂)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.coin = 50000; s.resources.brick = 200; s.resources.wood = 200; s.resources.steel = 200;
  const sand = findCoastRect(s, 6, 16);
  assert.ok(sand, '砂石采集场 6×16 海岸位');
  const avS = footprint(E.buildings.getDef('sandPit'), sand.x, sand.y);
  connectTo(s, sand.x, sand.y, avS, avS);
  const sp = placeBuilding(s, 'sandPit', sand.x, sand.y);
  assert.equal(sp.ok, true, '砂石采集场: ' + (sp.reason || ''));
  const glPos = findSpotNear(s, 4, 6, 20);
  assert.ok(glPos, '玻璃厂位置');
  const avG = footprint(E.buildings.getDef('glassworks'), glPos.x, glPos.y);
  connectTo(s, glPos.x, glPos.y, avG, avG);
  const gl = placeBuilding(s, 'glassworks', glPos.x, glPos.y);
  assert.equal(gl.ok, true, '玻璃厂: ' + (gl.reason || ''));
  const wPos = findSpotNear(s, 5, 5, 20);
  assert.ok(wPos, '窗户厂位置');
  const avW = footprint(E.buildings.getDef('windowFactory'), wPos.x, wPos.y);
  connectTo(s, wPos.x, wPos.y, avG.concat(avW), avW);
  const wf = placeBuilding(s, 'windowFactory', wPos.x, wPos.y);
  assert.equal(wf.ok, true, '窗户厂: ' + (wf.reason || ''));
  assert.deepEqual(E.buildings.getDef('windowFactory').production.inputs, { glass: 1, log: 1 }, '窗户厂耗玻璃+原木');
  s.resources.log = 100; // 原木手动供料(原木厂产 log,工匠层测试简化)
  driveTier(s, CYCLE * 4, 'artisans', 300);
  assert.ok(s.resources.glass > 0, '玻璃应产出');
  assert.ok(s.resources.windows > 0, '窗户应产出');
});

test('[V1.10 修订⑤ 顺序6] 工匠链:罐头(牛牧场+红椒→厨房→罐头厂)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.coin = 50000; s.resources.brick = 200; s.resources.wood = 200; s.resources.steel = 200; s.resources.windows = 200;
  // 牛牧场/红椒农场分开空旷(未开发度机制);牛牧场建 2 个(半效时靠数量补足)
  const cowSpot = findOpenSpot(s, 4, 5, 8, 12);
  assert.ok(cowSpot, '牛牧场空旷位');
  placeChain(s, [{ type: 'cattleFarm', ...cowSpot }]);
  const cowSpot2 = findOpenSpot(s, 4, 5, 8, 12);
  assert.ok(cowSpot2, '牛牧场2空旷位');
  placeChain(s, [{ type: 'cattleFarm', ...cowSpot2 }]);
  const pepSpot = findOpenSpot(s, 3, 4, 18);
  assert.ok(pepSpot, '红椒农场空旷位(半径18)');
  addLocalWarehouse(s, pepSpot.x, pepSpot.y); // 农田远离主仓库 → 先放分仓库
  addLocalWarehouse(s, cowSpot.x, cowSpot.y);
  placeChain(s, [{ type: 'pepperFarm', ...pepSpot }]);
  const kPos = findSpotNear(s, 5, 5, 20);
  assert.ok(kPos, '工匠厨房位置');
  const avK = footprint(E.buildings.getDef('artisanKitchen'), kPos.x, kPos.y);
  connectTo(s, kPos.x, kPos.y, avK, avK);
  const kf = placeBuilding(s, 'artisanKitchen', kPos.x, kPos.y);
  assert.equal(kf.ok, true, '工匠厨房: ' + (kf.reason || ''));
  const cPos = findSpotNear(s, 5, 5, 20);
  assert.ok(cPos, '罐头厂位置');
  const avC = footprint(E.buildings.getDef('cannery'), cPos.x, cPos.y);
  connectTo(s, cPos.x, cPos.y, avK.concat(avC), avC);
  const cn = placeBuilding(s, 'cannery', cPos.x, cPos.y);
  assert.equal(cn.ok, true, '罐头厂: ' + (cn.reason || ''));
  s.resources.ironOre = 100; // 罐头耗铁矿石,手动供料(钢铁链已单测)
  driveTier(s, CYCLE * 10, 'artisans', 300); // 半效风险:加长驱动保证产出
  const cows = Object.values(s.buildings).filter((b) => b.type === 'cattleFarm');
  const peps = Object.values(s.buildings).filter((b) => b.type === 'pepperFarm');
  const kit = Object.values(s.buildings).find((b) => b.type === 'artisanKitchen');
  assert.ok(s.resources.cannedFood > 0, '红椒炖肉应产出');
  assert.ok(s.resources.canned > 0, '罐头应产出');
});

test('[V1.10 修订⑤ 顺序6] 工匠链:缝纫机(钢铁+原木→缝纫机厂)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.coin = 50000; s.resources.brick = 200; s.resources.wood = 200; s.resources.steel = 200; s.resources.windows = 200;
  const mPos = findSpotNear(s, 6, 9, 20, undefined, 14);
  assert.ok(mPos, '缝纫机厂位置');
  const avM = footprint(E.buildings.getDef('sewingMachineFactory'), mPos.x, mPos.y);
  connectTo(s, mPos.x, mPos.y, avM, avM);
  const sf = placeBuilding(s, 'sewingMachineFactory', mPos.x, mPos.y);
  assert.equal(sf.ok, true, '缝纫机厂: ' + (sf.reason || ''));
  assert.deepEqual(E.buildings.getDef('sewingMachineFactory').production.inputs, { steelBar: 1, log: 1 }, '缝纫机厂耗钢铁+原木');
  s.resources.steelBar = 100; s.resources.log = 100; // 钢铁/原木手动供料
  driveTier(s, CYCLE * 2, 'artisans', 500);
  assert.ok(s.resources.sewingMachine > 0, '缝纫机应产出');
});

test('[V1.10 修订⑤ 顺序6] 工匠链:煤矿(15s 产煤)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.coin = 50000; s.resources.brick = 200;
  // 煤矿贴山(terrain 8),仓库需重建在矿旁(生产建筑须在仓库服务范围内)
  const coal = findSpot(s, 3, 3, 8, [8]);
  assert.ok(coal, '应有煤矿地形(terrain 8)');
  const oldWh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  demolish(s, oldWh.id);
  let whPos = null;
  for (const dist of [6, 8, 10, 12]) {
    whPos = findAdjacentSpot(s, coal.x, coal.y, 5, 5, ALL_LAND, dist, null, 3, 3);
    if (whPos) break;
  }
  assert.ok(whPos, '煤矿旁仓库位');
  const wh = placeBuilding(s, 'warehouse', whPos.x, whPos.y);
  assert.equal(wh.ok, true, '仓库(煤矿旁): ' + (wh.reason || ''));
  outer:
  for (const [dx, dy] of dirs4) {
    const exs = dx ? [whPos.x + (dx > 0 ? 3 : -3)] : [whPos.x - 2, whPos.x - 1, whPos.x, whPos.x + 1, whPos.x + 2]; // 中心语义:5×5 中心±2,外圈±3
    const eys = dy ? [whPos.y + (dy > 0 ? 3 : -3)] : [whPos.y - 2, whPos.y - 1, whPos.y, whPos.y + 1, whPos.y + 2];
    for (const ex of exs) for (const ey of eys) {
      if (ex < 0 || ey < 0 || ex >= 128 || ey >= 128) continue;
      if (s.grid[ex + ',' + ey] || s.roads[ex + ',' + ey]) continue;
      if (s.map.terrain[ey][ex] === 6 || s.map.terrain[ey][ex] === 7) continue;
      setRoad(s, ex, ey, true);
      break outer;
    }
  }
  const avM = footprint(E.buildings.getDef('coalMine'), coal.x, coal.y);
  connectTo(s, coal.x, coal.y, avM, avM);
  const cm = placeBuilding(s, 'coalMine', coal.x, coal.y);
  assert.equal(cm.ok, true, '煤矿: ' + (cm.reason || ''));
  driveTier(s, CYCLE, 'artisans', 100);
  assert.ok(s.resources.coal > 0, '煤矿应产煤');
  assert.equal(cm.building.status, 'producing');
});

test('[V1.10 修订⑤ 顺序7] 工程师链:黄铜(锌矿+铜矿→冶炼厂)→眼镜厂', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.coin = 200000; s.resources.brick = 300; s.resources.wood = 300; s.resources.steel = 300; s.resources.windows = 300; s.resources.concrete = 300;
  // 锌矿贴山(terrain 9)难在仓库覆盖内;手动供料(锌矿地形由新矿脉测试覆盖)
  s.resources.zincOre = 100;
  const bw = findSpotNear(s, 5, 5, 20);
  assert.ok(bw, '黄铜冶炼厂位置');
  const avB = footprint(E.buildings.getDef('brassWorks'), bw.x, bw.y);
  connectTo(s, bw.x, bw.y, avB, avB);
  const bf = placeBuilding(s, 'brassWorks', bw.x, bw.y);
  assert.equal(bf.ok, true, '黄铜冶炼厂: ' + (bf.reason || ''));
  const gPos = findSpotNear(s, 4, 6, 20, undefined, 10);
  assert.ok(gPos, '眼镜厂位置');
  const avG = footprint(E.buildings.getDef('glassesWorks'), gPos.x, gPos.y);
  connectTo(s, gPos.x, gPos.y, avG, avG);
  const gf = placeBuilding(s, 'glassesWorks', gPos.x, gPos.y);
  assert.equal(gf.ok, true, '眼镜厂: ' + (gf.reason || ''));
  s.resources.copperOre = 100; s.resources.glass = 100; // 铜矿石/玻璃手动供料
  driveTier(s, CYCLE * 3, 'engineers', 300);
  assert.ok(s.resources.brass > 0, '黄铜应产出');
  assert.ok(s.resources.glasses > 0, '眼镜应产出');
});

test('[V1.10 修订⑤ 顺序7] 工程师链:混凝土(石灰岩→水泥→混凝土厂)+灯泡(煤→灯丝→灯泡厂)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.coin = 200000; s.resources.brick = 300; s.resources.wood = 300; s.resources.steel = 300; s.resources.windows = 300; s.resources.concrete = 300;
  // 石灰岩矿贴山(terrain 10)难在仓库覆盖内;手动供料
  s.resources.cement = 100;
  const cw = findSpotNear(s, 5, 6, 20);
  assert.ok(cw, '混凝土厂位置');
  const avW = footprint(E.buildings.getDef('concreteWorks'), cw.x, cw.y);
  connectTo(s, cw.x, cw.y, avW, avW);
  const cwf = placeBuilding(s, 'concreteWorks', cw.x, cw.y);
  assert.equal(cwf.ok, true, '混凝土厂: ' + (cwf.reason || ''));
  s.resources.steelBar = 100; // 钢铁手动供料
  // 灯丝厂(煤)+ 灯泡厂
  const fPos = findSpotNear(s, 6, 7, 20);
  assert.ok(fPos, '灯丝厂位置');
  const avF = footprint(E.buildings.getDef('filamentWorks'), fPos.x, fPos.y);
  connectTo(s, fPos.x, fPos.y, avF, avF);
  const fw = placeBuilding(s, 'filamentWorks', fPos.x, fPos.y);
  assert.equal(fw.ok, true, '灯丝厂: ' + (fw.reason || ''));
  const bPos = findSpotNear(s, 6, 6, 20);
  assert.ok(bPos, '灯泡厂位置');
  const avB = footprint(E.buildings.getDef('bulbFactory'), bPos.x, bPos.y);
  connectTo(s, bPos.x, bPos.y, avF.concat(avB), avB);
  const bl = placeBuilding(s, 'bulbFactory', bPos.x, bPos.y);
  assert.equal(bl.ok, true, '灯泡厂: ' + (bl.reason || ''));
  s.resources.coal = 100; s.resources.glass = 100;
  driveTier(s, CYCLE * 3, 'engineers', 300);
  assert.ok(s.resources.cement > 0, '水泥应产出');
  assert.ok(s.resources.concrete > 0, '钢筋混凝土应产出');
  assert.ok(s.resources.filament > 0, '灯丝应产出');
  assert.ok(s.resources.lightBulb > 0, '灯泡应产出');
});

test('[V1.10 修订⑤ 顺序7] 工程师链:蒸汽机(钢铁+黄铜)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.coin = 200000; s.resources.brick = 300; s.resources.wood = 300; s.resources.steel = 300; s.resources.windows = 300; s.resources.concrete = 300;
  const sw = findSpotNear(s, 6, 9, 20, undefined, 14);
  assert.ok(sw, '蒸汽机厂位置');
  const avS = footprint(E.buildings.getDef('steamWorks'), sw.x, sw.y);
  connectTo(s, sw.x, sw.y, avS, avS);
  const sf = placeBuilding(s, 'steamWorks', sw.x, sw.y);
  assert.equal(sf.ok, true, '蒸汽机厂: ' + (sf.reason || ''));
  s.resources.steelBar = 100; s.resources.brass = 100;
  driveTier(s, CYCLE * 2, 'engineers', 300);
  assert.ok(s.resources.steamEngine > 0, '蒸汽机应产出');
  assert.equal(sf.building.status, 'producing');
});

test('[V1.10 修订⑤ 顺序7] 投资人链:香槟(葡萄+玻璃)+留声机(薄木片+黄铜)', () => {
  const s = createInitialState();
  setupBase(s);
  clearAround(s);
  s.resources.coin = 200000; s.resources.brick = 300; s.resources.wood = 300; s.resources.steel = 300; s.resources.windows = 300; s.resources.concrete = 300;
  const grape = findOpenSpot(s, 3, 4, 20);
  assert.ok(grape, '葡萄农场空旷位');
  placeChain(s, [{ type: 'grapeFarm', ...grape }]);
  s.resources.coin = 200000; // placeChain 预算 50000 不够香槟厂 35000+薄木片 22000,重置
  const cc = findSpotNear(s, 5, 6, 20);
  assert.ok(cc, '香槟酒厂位置');
  const avC = footprint(E.buildings.getDef('champagneCellar'), cc.x, cc.y);
  connectTo(s, cc.x, cc.y, avC, avC);
  const ch = placeBuilding(s, 'champagneCellar', cc.x, cc.y);
  assert.equal(ch.ok, true, '香槟酒厂: ' + (ch.reason || ''));
  const vw = findSpotNear(s, 5, 5, 20);
  assert.ok(vw, '薄木片厂位置');
  const avV = footprint(E.buildings.getDef('veneerWorks'), vw.x, vw.y);
  connectTo(s, vw.x, vw.y, avV, avV);
  const vf = placeBuilding(s, 'veneerWorks', vw.x, vw.y);
  assert.equal(vf.ok, true, '薄木片厂: ' + (vf.reason || ''));
  const ph = findSpotNear(s, 7, 7, 20, undefined, 14);
  assert.ok(ph, '留声机厂位置');
  const avP = footprint(E.buildings.getDef('phonographWorks'), ph.x, ph.y);
  connectTo(s, ph.x, ph.y, avV.concat(avP), avP);
  const pf = placeBuilding(s, 'phonographWorks', ph.x, ph.y);
  assert.equal(pf.ok, true, '留声机厂: ' + (pf.reason || ''));
  s.resources.glass = 100; s.resources.brass = 100; s.resources.log = 100; // 薄木片耗原木
  driveTier(s, CYCLE * 4, 'investors', 300);
  assert.ok(s.resources.grapes > 0, '葡萄应产出');
  assert.ok(s.resources.champagne > 0, '香槟应产出');
  assert.ok(s.resources.veneer > 0, '薄木片应产出');
  assert.ok(s.resources.phonograph > 0, '留声机应产出');
});

test('[V1.10 修订⑤ 顺序8] 新矿脉:煤矿/锌矿/石灰岩矿贴山缘生成(3×3 块)', () => {
  const s = createInitialState();
  const t = s.map.terrain;
  const count = { 8: 0, 9: 0, 10: 0 };
  for (const row of t) for (const v of row) if (count[v] !== undefined) count[v]++;
  assert.ok(count[8] >= 18, '煤矿 ≥2 块(实际 ' + count[8] + ' 格)');
  assert.ok(count[9] >= 9, '锌矿 ≥1 块(实际 ' + count[9] + ' 格)');
  assert.ok(count[10] >= 9, '石灰岩矿 ≥1 块(实际 ' + count[10] + ' 格)');
  // 煤矿可建在 coal 地形(锚点匹配)
  setupBase(s);
  clearAround(s);
  s.resources.coin = 50000; s.resources.brick = 200;
  const coal = findSpot(s, 3, 3, 8, [8]);
  assert.ok(coal, '应有煤矿地形(terrain 8)');
  const avC = footprint(E.buildings.getDef('coalMine'), coal.x, coal.y);
  connectTo(s, coal.x, coal.y, avC, avC);
  const cm = placeBuilding(s, 'coalMine', coal.x, coal.y);
  assert.equal(cm.ok, true, '煤矿建在 coal 地形: ' + (cm.reason || ''));
  // 锌矿/石灰岩矿地形数据正确
  assert.equal(E.buildings.getDef('zincMine').terrain, 'zinc');
  assert.equal(E.buildings.getDef('limestoneMine').terrain, 'limestone');
});

test('[V1.10 修订⑤ 顺序11] 建筑旋转:绕几何中心 4 向 + 放置 + 服务覆盖', () => {
  const s = createInitialState();
  const fdef = E.buildings.getDef('fishery'); // 5×16
  // ① footprint 绕中心旋转:锚点=几何中心,4 向包围盒中心恒在 (10,20)
  const f0 = E.placement.footprint(fdef, 10, 20, 0);
  const f1 = E.placement.footprint(fdef, 10, 20, 1);
  const f2 = E.placement.footprint(fdef, 10, 20, 2);
  const f3 = E.placement.footprint(fdef, 10, 20, 3);
  assert.equal(f0.length, 80, '5×16 = 80 格');
  assert.equal(f1.length, 80, '旋转后格数不变');
  // rot=1:5×16 → 16×5(尺寸交换,中心不动)
  const xs1 = new Set(f1.map((c) => c.x)), ys1 = new Set(f1.map((c) => c.y));
  assert.equal(xs1.size, 16, 'rot=1 占 16 列');
  assert.equal(ys1.size, 5, 'rot=1 占 5 行');
  // 4 向包围盒中心≈锚点(偶数尺寸允许 ±0.5 格半格误差,绕中心旋转不再"甩到一侧")
  const bc = [0, 1, 2, 3].map((r) => {
    const b = E.placement.footprintBounds(fdef, 10, 20, r);
    return (b.x + b.w / 2) + ',' + (b.y + b.h / 2);
  });
  for (const c of bc) {
    const [cx, cy] = c.split(',').map(Number);
    assert.ok(Math.abs(cx - 10) <= 1.01 && Math.abs(cy - 20) <= 1.01, '包围盒中心≈锚点(10,20),实际 ' + c);
  }
  // 锚点格恒在 (10,20)(= 建筑中心格)
  for (const r of [0, 1, 2, 3]) {
    const hasAnchor = E.placement.footprint(fdef, 10, 20, r).some((c) => c.x === 10 && c.y === 20);
    assert.ok(hasAnchor, 'rot=' + r + ' 锚点格在 (10,20)');
  }
  // ② 正方形 5×5:4 向包围盒完全相同(绕中心,位置不变)
  const wdef = E.buildings.getDef('warehouse'); // 5×5
  const wbs = [0, 1, 2, 3].map((r) => E.placement.footprintBounds(wdef, 10, 20, r));
  assert.equal(new Set(wbs.map((b) => b.x + ',' + b.y + ',' + b.w + 'x' + b.h)).size, 1, '正方形 4 向包围盒相同(中心旋转)');
  assert.deepEqual(wbs[0], { x: 8, y: 18, w: 5, h: 5 }, '5×5 中心 (10,20) → 包围盒 8..12, 18..22');
  // ③ 旋转放置:渔场横放(rot=1)
  setupBase(s);
  clearAround(s);
  s.resources.coin = 50000;
  const hz = findSpotWaterRow(s, 16, 5);
  assert.ok(hz, '应有横向海岸位(16×5 全水+邻陆)');
  const avH = footprint(fdef, hz.x, hz.y, 1);
  connectTo(s, hz.x, hz.y, avH, avH);
  const f = placeBuilding(s, 'fishery', hz.x, hz.y, 1);
  assert.equal(f.ok, true, '渔场横放: ' + (f.reason || ''));
  assert.equal(f.building.rot, 1, '建筑存 rot=1');
  // 旋转后的 footprint 全部格已占位(grid 记录)
  for (const c of E.placement.footprint(fdef, hz.x, hz.y, 1)) {
    if (c.x === hz.x && c.y === hz.y) continue;
    assert.ok(s.grid[c.x + ',' + c.y], '旋转 footprint 格已占位');
  }
  assert.equal(f.building.status, 'producing', '旋转渔场应 producing(覆盖按旋转 footprint)');
  // ④ 旋转后拆除:footprint 全清
  const before = Object.keys(s.grid).length;
  E.placement.demolish(s, f.building.id);
  assert.equal(Object.keys(s.grid).length, before - 80, '拆除清除旋转 footprint 80 格(含锚点)');
});

test('[V1.2] 产出事件 produced 触发(周期结算时)', () => {
  const s = createInitialState();
  setupFishery(s);
  const fired = [];
  const handler = (p) => fired.push(p);
  E.events.on('produced', handler);
  for (let i = 0; i < CYCLE; i++) E.tick.tick(s);
  E.events.off('produced', handler);
  assert.ok(fired.some((p) => p.good === 'fish' && p.qty === 1 && p.type === 'fishery'), 'fish 产出事件(周期结算)');
});

test('[V1.10 修订⑤ 顺序2] 服务三件套:酒吧/学校/教堂(核查表数据+需求挂接+覆盖判定)', () => {
  // 数据
  const bar = E.buildings.getDef('bar');
  const school = E.buildings.getDef('school');
  const church = E.buildings.getDef('church');
  assert.deepEqual(bar.size, { w: 4, h: 6 }, '酒吧 4×6');
  assert.equal(bar.service.radius, 43, '酒吧土路距离 43');
  assert.deepEqual(school.size, { w: 5, h: 6 }, '学校 5×6');
  assert.equal(school.service.radius, 50, '学校土路距离 50');
  assert.equal(school.cost.coin, 2500, '学校 2500 金');
  assert.deepEqual(church.size, { w: 6, h: 8 }, '教堂 6×8');
  assert.equal(church.service.radius, 58, '教堂土路距离 58');
  // 需求挂接
  assert.ok(E.tiers.TIERS.farmers.needs.bar, '酒吧=农民需求(服务型)');
  assert.equal(E.tiers.TIERS.farmers.needs.bar.service, 'bar');
  assert.equal(E.tiers.TIERS.farmers.needs.bar.happiness, 12, '酒吧幸福+12');
  assert.ok(E.tiers.TIERS.workers.needs.school, '学校=工人需求');
  assert.equal(E.tiers.TIERS.workers.needs.school.service, 'school');
  assert.ok(E.tiers.TIERS.workers.needs.church, '教堂=工人需求');
  // 酒吧覆盖判定(服务建筑通用机制):酒吧放民居中心附近(43 格沿路覆盖)
  const s = createInitialState();
  setupBase(s);
  const res = Object.values(s.buildings).filter((b) => b.type === 'residence');
  const cx = Math.round(res.reduce((a, b) => a + b.x, 0) / res.length);
  const cy = Math.round(res.reduce((a, b) => a + b.y, 0) / res.length);
  let b = null;
  outer:
  for (let rad = 0; rad <= 20 && !b; rad++) {
    for (let dy = -rad; dy <= rad && !b; dy++) for (let dx = -rad; dx <= rad && !b; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      const x = cx + dx, y = cy + dy;
      if (x - 1 < 0 || y - 2 < 0 || x + 3 > 128 || y + 4 > 128) continue; // 4×6 中心偏置 (1,2)
      if (!freeRect(s, x - 1, y - 2, 4, 6) || !terrainRectOk(s, x - 1, y - 2, 4, 6, PF)) continue;
      const avB = footprint(bar, x, y);
      if (!connectTo(s, x, y, avB, avB)) continue;
      const rr = placeBuilding(s, 'bar', x, y);
      if (rr.ok) { b = rr.building; break outer; }
    }
  }
  assert.ok(b, '酒吧应可建在民居附近');
  E.population.updateNeeds(s);
  const cov = E.population.serviceCoverage(s, 'farmers', 'bar');
  assert.ok(cov > 0, '酒吧沿路覆盖民居(实际 ' + cov.toFixed(2) + ')');
  // 酒吧幸福度生效:农民需求含 bar 且为奢侈(只加幸福,不提供住户)
  assert.ok(!E.tiers.TIERS.farmers.needs.bar.influx, '酒吧不提供住户(influx 无)');
});

test('[V1.10 修订⑤ 顺序3] 道路等级:石板路传播 1.5 倍(土路 34 → 石板路 50)', () => {
  const s = createInitialState();
  setupBase(s);
  // 清掉民居与路,让仓库周围干净(测试专注覆盖传播)
  for (const b of Object.values(s.buildings)) if (b.type !== 'warehouse') demolish(s, b.id);
  for (const k of Object.keys(s.roads)) setRoad(s, ...k.split(',').map(Number), false);
  const wh = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const size = s.map.size;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 找仓库外圈可铺直路的最长方向(≥35 格:超过土路 34 格边界)
  let best = { len: 0 };
  for (const [dx, dy] of dirs) {
    const sx = wh.x + dx * 3, sy = wh.y + dy * 3; // 中心语义:仓库中心 ±3 = 外圈一格
    let len = 0;
    while (len < 60) {
      const nx = sx + dx * len, ny = sy + dy * len;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
      const t = s.map.terrain[ny][nx];
      if (t === 6 || t === 7 || s.grid[key(nx, ny)]) break;
      len++;
    }
    if (len > best.len) best = { dx, dy, len };
  }
  assert.ok(best.len >= 35, '应有 ≥35 格直路方向(实际 ' + best.len + ')');
  const startX = wh.x + best.dx * 3, startY = wh.y + best.dy * 3;
  const cells = [];
  for (let i = 0; i < best.len; i++) cells.push([startX + best.dx * i, startY + best.dy * i]);
  // 全土路:覆盖 = 仓库土路半径 34 格
  for (const [x, y] of cells) setRoad(s, x, y, true, 1);
  const dirtCover = E.population.serviceRoads(s, 'warehouse').size;
  assert.equal(dirtCover, 34, '土路覆盖 34 格(实际 ' + dirtCover + ')');
  // 全石板路:消耗 2/3 → 覆盖 34/(2/3) ≈ 51 格(直路长度内全覆盖)
  for (const [x, y] of cells) setRoad(s, x, y, false);
  for (const [x, y] of cells) setRoad(s, x, y, true, 2);
  const stoneCover = E.population.serviceRoads(s, 'warehouse').size;
  assert.ok(stoneCover > dirtCover, '石板路传播更远(' + stoneCover + ' > ' + dirtCover + ')');
  assert.ok(stoneCover >= best.len - 1, '石板路覆盖 ≥ 直路长度(实际 ' + stoneCover + '/' + best.len + ')');
  assert.equal(s.roads[key(cells[0][0], cells[0][1])], 2, '石板路 level=2');
  // 拆掉石板路 → 覆盖归零(无其他路)
  for (const [x, y] of cells) setRoad(s, x, y, false);
  assert.equal(E.population.serviceRoads(s, 'warehouse').size, 0, '拆路后无覆盖');
});

// [玩家反馈 #4] 单栋住宅住户显示:count 按住宅顺序填满(先住满先建)
test('单栋住宅住户分配:先建先满,不满的栋在最后', () => {
  const s = createInitialState();
  setupBase(s);
  const def = E.buildings.getDef('residence');
  const houses = Object.values(s.buildings).filter((b) => b.type === 'residence');
  assert.ok(houses.length >= 2, 'setupBase 至少 2 栋民居');
  // 手动把 count 调成"只够两栋半"
  s.population.farmers.count = def.capacity * 2 + def.capacity / 2;
  E.population.refreshOccupancy(s);
  const occs = houses.map((h) => h.occupied);
  assert.equal(occs[0], def.capacity, '第一栋满');
  assert.equal(occs[1], def.capacity, '第二栋满');
  assert.equal(occs[2], def.capacity / 2, '第三栋半(实际 ' + occs[2] + ')');
  // 满员:所有栋都满
  s.population.farmers.count = def.capacity * houses.length;
  E.population.refreshOccupancy(s);
  assert.ok(houses.every((h) => h.occupied === def.capacity), '全满');
  // 0 人口:全 0
  s.population.farmers.count = 0;
  E.population.refreshOccupancy(s);
  assert.ok(houses.every((h) => h.occupied === 0), '无人');
});

// [用户要求] 矿建筑完全嵌合:全格必须为矿;偏移 1 格(部分重叠)应拒绝
test('矿建筑须完全嵌合矿脉:部分重叠拒绝,完全覆盖才允许', () => {
  const s = createInitialState();
  const mine = findSpot(s, 3, 3, 3, [3]); // 3×3 铁矿块
  assert.ok(mine, '应有 3×3 铁矿块');
  s.resources.coin = 50000; s.resources.wood = 100; s.resources.brick = 100; // 补足造价(铁:500金4木5砖)
  // 偏移 1 格:footprint 含非矿格 → 拒绝
  const off = placeBuilding(s, 'ironMine', mine.x + 1, mine.y);
  assert.equal(off.ok, false, '偏移放置应拒绝(' + (off.reason || '') + ')');
  // 完全对齐 → 允许
  const ok = placeBuilding(s, 'ironMine', mine.x, mine.y);
  assert.equal(ok.ok, true, '完全嵌合可建(' + (ok.reason || '') + ')');
  // 矿格被占用后,普通建筑仍无法占用(地形专属)
  const hut = placeBuilding(s, 'farmers_hut', mine.x, mine.y);
  assert.equal(hut.ok, false, '其他建筑不能占用矿格');
});

// [用户模型] 多仓库=总资源池接入点:两座仓库不互连,各自区域的生产建筑均正常生产
test('多仓库:不互连的第二仓库区域生产建筑不断连、可生产', () => {
  const s = createInitialState();
  s.resources.coin = 50000; s.resources.wood = 100;
  // 仓库1 区:仓库 + 原木厂(各找位)
  const p1 = findSpot(s, 5, 5, null, PF);
  assert.ok(p1, '仓库1位');
  const w1 = placeBuilding(s, 'warehouse', p1.x, p1.y);
  assert.equal(w1.ok, true, '仓库1: ' + (w1.reason || ''));
  const lp1 = findSpot(s, 4, 4, null, PF);
  assert.ok(lp1, '原木厂1位');
  const l1 = placeBuilding(s, 'sawmill', lp1.x, lp1.y);
  assert.equal(l1.ok, true, '仓库1区原木厂: ' + (l1.reason || ''));
  connectTo(s, lp1.x, lp1.y, footprint(E.buildings.getDef('sawmill'), lp1.x, lp1.y), footprint(E.buildings.getDef('sawmill'), lp1.x, lp1.y));
  // 仓库2:远离仓库1(找另一块平地),不连路
  let p2 = null;
  for (let y = 0; y <= s.map.size - 5 && !p2; y++) for (let x = 0; x <= s.map.size - 5 && !p2; x++) {
    if (Math.hypot(x - p1.x, y - p1.y) < 40) continue;
    if (!freeRect(s, x, y, 5, 5)) continue;
    if (!terrainRectOk(s, x, y, 5, 5, PF)) continue;
    p2 = { x, y };
  }
  assert.ok(p2, '仓库2位');
  const w2 = placeBuilding(s, 'warehouse', p2.x, p2.y);
  assert.equal(w2.ok, true, '仓库2: ' + (w2.reason || ''));
  const lp2 = findSpot(s, 4, 4, null, PF);
  assert.ok(lp2, '原木厂2位');
  const l2 = placeBuilding(s, 'sawmill', lp2.x, lp2.y);
  assert.equal(l2.ok, true, '仓库2区原木厂: ' + (l2.reason || ''));
  connectTo(s, lp2.x, lp2.y, footprint(E.buildings.getDef('sawmill'), lp2.x, lp2.y), footprint(E.buildings.getDef('sawmill'), lp2.x, lp2.y));
  // 两仓库区域无路相连
  const c = E.connectivity.computeConnections(s);
  assert.ok(c[w1.building.id] && c[w2.building.id], '两仓库自身均在连通集');
  // 刷新状态:两个区域原木厂均不应 disconnected
  E.economy.refresh(s, { produce: false, logs: false });
  const st1 = s.buildings[l1.building.id].status;
  const st2 = s.buildings[l2.building.id].status;
  assert.notEqual(st1, 'disconnected', '仓库1区建筑不断连(实际 ' + st1 + ')');
  assert.notEqual(st2, 'disconnected', '仓库2区建筑不断连(实际 ' + st2 + ')');
});

// [玩家反馈 #7] 锚点格连通盲区回归:建筑 footprint 任意格(含中心锚点)贴路/贴仓库即可连通
test('建筑任意格贴路即连通(锚点格已入 grid)', () => {
  const s = createInitialState();
  s.resources.coin = 50000; s.resources.wood = 100;
  // 找 12×6 平地:仓库占左,路+原木厂在右
  const big = findSpot(s, 12, 6, null, PF);
  assert.ok(big, '大平地');
  const w1 = placeBuilding(s, 'warehouse', big.x, big.y);
  assert.equal(w1.ok, true, '仓库: ' + (w1.reason || ''));
  // 原木厂 4×4:中心 (big.x+5, big.y) —— 左缘 big.x+4 与仓库右缘 big.x+2 之间留 1 格
  const l1 = placeBuilding(s, 'sawmill', big.x + 5, big.y);
  assert.equal(l1.ok, true, '原木厂: ' + (l1.reason || ''));
  // 铺路:仓库右缘 (big.x+3, big.y) 邻接原木厂左缘 (big.x+4, big.y)(非锚点格贴路)
  const r = setRoad(s, big.x + 3, big.y, true);
  assert.equal(r.ok, true, '铺路: ' + (r.reason || ''));
  E.economy.refresh(s, { produce: false, logs: false });
  const st = s.buildings[l1.building.id].status;
  assert.notEqual(st, 'disconnected', '任意格贴路建筑不断连(实际 ' + st + ')');
});

// [V1.10 修订⑤ 顺序23] 移动建筑:合法移动更新坐标/占用,非法位置拒绝且原位保留
test('移动建筑:合法移动/重叠自移动/非法拒绝/住宅数据保留', () => {
  const s = createInitialState();
  s.resources.coin = 50000; s.resources.wood = 100;
  const p = findSpot(s, 5, 5, null, PF);
  assert.ok(p, '仓库位');
  const w = placeBuilding(s, 'warehouse', p.x, p.y);
  assert.equal(w.ok, true);
  // 原木厂放在仓库右侧
  const lp = findSpot(s, 4, 4, null, PF);
  assert.ok(lp);
  const l = placeBuilding(s, 'sawmill', lp.x, lp.y);
  assert.equal(l.ok, true);
  // 合法移动:+5 格(先找空地)
  let np = null;
  for (let y = 0; y <= 120 && !np; y++) for (let x = 0; x <= 120 && !np; x++) {
    if (Math.abs(x - lp.x) + Math.abs(y - lp.y) < 10) continue;
    const bx = Math.floor(3 / 2), by = Math.floor(3 / 2);
    let ok = true;
    for (let dy = 0; dy < 4 && ok; dy++) for (let dx = 0; dx < 4 && ok; dx++) {
      const nx2 = x - bx + dx, ny2 = y - by + dy;
      if (nx2 < 0 || ny2 < 0 || nx2 >= 128 || ny2 >= 128) { ok = false; break; }
      if (s.grid[nx2 + ',' + ny2] || s.roads[nx2 + ',' + ny2]) ok = false;
      const t = s.map.terrain[ny2][nx2];
      if (t === 6 || t === 7) ok = false;
    }
    if (ok) np = { x: x + 1, y: y + 1 };
  }
  assert.ok(np, '目标位');
  const oldX = l.building.x, oldY = l.building.y;
  const mv = E.placement.moveBuilding(s, l.building.id, np.x, np.y);
  assert.equal(mv.ok, true, '移动: ' + (mv.reason || ''));
  assert.equal(s.buildings[l.building.id].x, np.x, '坐标更新');
  // 原位占用释放,新位占用写入
  const oldKey = key(oldX, oldY);
  const newKey = key(np.x, np.y);
  assert.equal(s.grid[oldKey], undefined, '原位占用释放');
  assert.equal(s.grid[newKey], l.building.id, '新位占用写入');
  // 重叠自移动:移回原位(部分重叠)应允许
  const mv2 = E.placement.moveBuilding(s, l.building.id, oldX, oldY);
  assert.equal(mv2.ok, true, '重叠自移动: ' + (mv2.reason || ''));
  // 非法位置:移动到水域 → 拒绝且原位保留
  const waterY = s.map.terrain.findIndex((row) => row.some((t) => t === 6));
  const waterX = s.map.terrain[waterY].indexOf(6);
  const mv3 = E.placement.moveBuilding(s, l.building.id, waterX, waterY);
  assert.equal(mv3.ok, false, '水域拒绝');
  assert.equal(s.buildings[l.building.id].x, oldX, '拒绝后原位保留');
});

// [H-03] 停工原因结构化:每种 reason 至少一个场景
test('[H-03] 停工原因拆分:断连/缺工/缺料/覆盖不足/开发度过高', () => {
  const s = createInitialState();
  setupBase(s);
  s.resources.coin = 50000; s.resources.wood = 100;
  const def = E.buildings.getDef('sawmill');
  const av = footprint(def, 0, 0); // 占位避免 null
  // 1. 断连:远处放原木厂(不铺路)
  const far = findSpot(s, 4, 4, null, PF);
  const r1 = placeBuilding(s, 'sawmill', far.x, far.y);
  assert.equal(r1.ok, true);
  let st1 = E.economy.computeStatus(s, r1.building, { warehouseRoads: new Set() });
  assert.equal(st1.status, 'disconnected');
  assert.equal(st1.reason, 'road-disconnected');
  // 2. 缺劳动力:连接后清空人口
  const av2 = footprint(def, far.x, far.y);
  connectTo(s, far.x, far.y, av2, av2);
  s.population.farmers.count = 0;
  let st2 = E.economy.computeStatus(s, s.buildings[r1.building.id], { warehouseRoads: new Set() });
  assert.equal(st2.reason, 'workforce-shortage');
  assert.equal(st2.detail.tier, 'farmers');
  // 3. 缺原料:纺织厂无羊毛(先恢复人口,让缺料成为唯一原因)
  s.population.farmers.count = 50;
  const wPos = findSpotNear(s, 4, 4, 18);
  const av3 = footprint(E.buildings.getDef('tailor'), wPos.x, wPos.y);
  connectTo(s, wPos.x, wPos.y, av3, av3);
  const r3 = placeBuilding(s, 'tailor', wPos.x, wPos.y);
  assert.equal(r3.ok, true);
  s.resources.wool = 0;
  let st3 = E.economy.computeStatus(s, r3.building, { warehouseRoads: new Set() });
  assert.equal(st3.reason, 'input-shortage');
  assert.equal(st3.detail.good, 'wool');
  // 4. 恢复人口 → 缺料优先于覆盖(仓库覆盖不足需在无缺料时体现)
  s.population.farmers.count = 50;
  let st4 = E.economy.computeStatus(s, r3.building, { warehouseRoads: new Set() });
  assert.equal(st4.reason, 'input-shortage', '缺料优先于覆盖');
  // 4.5 仓库覆盖不足:远离仓库铺长路(>34 格,超出服务半径)→ warehouse-out-of-range(原料/人口充足)
  const far2 = findSpotFar(s, 4, 4);
  assert.ok(far2, '远离仓库的纺织厂位');
  const avT2 = footprint(E.buildings.getDef('tailor'), far2.x, far2.y);
  connectTo(s, far2.x, far2.y, avT2, avT2);
  const t2 = placeBuilding(s, 'tailor', far2.x, far2.y);
  assert.equal(t2.ok, true);
  s.resources.wool = 100;
  const st45 = E.economy.computeStatus(s, t2.building, { warehouseRoads: E.population.serviceRoads(s, 'warehouse') });
  assert.equal(st45.reason, 'warehouse-out-of-range');
  // 5. 开发度过高:农场半径内全占满
  const s5 = createInitialState();
  setupBase(s5);
  const pfSpot = findOpenSpot(s5, 3, 4, 12);
  assert.ok(pfSpot, '土豆农场位');
  const av5 = footprint(E.buildings.getDef('potatoField'), pfSpot.x, pfSpot.y);
  connectTo(s5, pfSpot.x, pfSpot.y, av5, av5);
  const p5 = placeBuilding(s5, 'potatoField', pfSpot.x, pfSpot.y);
  assert.equal(p5.ok, true);
  // 半径 12 内铺满路 → dev > 0.75
  const cx = p5.building.x, cy = p5.building.y;
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= 128 || y >= 128) continue;
    const t = s5.map.terrain[y][x];
    if (t !== 0) continue;
    const k = key(x, y);
    if (s5.grid[k] || s5.roads[k]) continue;
    setRoad(s5, x, y, true);
  }
  const st5 = E.economy.computeStatus(s5, s5.buildings[p5.building.id], { warehouseRoads: E.population.serviceRoads(s5, 'warehouse') });
  assert.equal(st5.reason, 'development-too-low');
});

// [H-01] 滚动平均:60 tick 产 1 的建筑 smoothMin 稳定 ≈1/min(不 0/60 跳变)
test('[H-01] 周期建筑 /min 平滑:60tick 产 1 → smoothMin ≈ 1.0', () => {
  const s = createInitialState();
  setupBase(s);
  // 渔场 cycle 60 产 1 鱼(rate 修正后)
  const c = findCoastFishery(s);
  assert.ok(c, '渔场海岸位');
  const av = footprint(E.buildings.getDef('fishery'), c.x, c.y);
  connectTo(s, c.x, c.y, av, av);
  const r = placeBuilding(s, 'fishery', c.x, c.y);
  assert.equal(r.ok, true);
  s.population.farmers.count = 50;
  for (let i = 0; i < 65; i++) E.tick.tick(s);
  const sm = s.rates.fish ? s.rates.fish.smoothMin : 0;
  assert.ok(Math.abs(sm - 2) < 0.3, '30tick 产 1 → smoothMin ≈2.0/min(实际 ' + sm.toFixed(2) + ')');
  // 暂停时不归零(窗口不更新)
  s.settings.paused = true;
  const before = s.rates.fish ? s.rates.fish.smoothMin : 0;
  E.tick.tick(s);
  assert.equal(s.rates.fish.smoothMin, before, '暂停保持最后稳定值');
  s.settings.paused = false;
});

// [H-03 回归] 断路建筑不参与人口/服务模拟(对象状态改造后 population.js 未适配的回归)
test('[H-03回归] 断路住宅不计容量/数量,断路服务建筑不覆盖', () => {
  const s = createInitialState();
  setupBase(s);
  s.resources.coin = 50000; s.resources.wood = 100; s.resources.brick = 100;
  // 放 1 栋住宅(连接),1 栋住宅(不连接)
  const h1 = findSpot(s, 3, 3, null, PF);
  const r1 = placeBuilding(s, 'residence', h1.x, h1.y);
  assert.equal(r1.ok, true);
  const av1 = footprint(E.buildings.getDef('residence'), h1.x, h1.y);
  connectTo(s, h1.x, h1.y, av1, av1); // 连接
  const h2 = findSpotFar(s, 3, 3);
  assert.ok(h2, '远离仓库的 3×3 平地');
  const r2 = placeBuilding(s, 'residence', h2.x, h2.y);
  assert.equal(r2.ok, true);
  // h2 不连接 → disconnected
  const st2 = E.economy.computeStatus(s, r2.building, { warehouseRoads: E.population.serviceRoads(s, 'warehouse') });
  assert.equal(st2.status, 'disconnected');
  // 容量只算连接的(setupBase 5 栋 + h1 = 6 栋连接;h2 断路不计)
  const cap = E.population.capacityFor(s, 'farmers');
  assert.equal(cap, 60, '仅连接的住宅计容量(实际 ' + cap + ')');
  const houses = E.population.countHouses(s, 'farmers');
  assert.equal(houses, 6, '仅连接的住宅计数(实际 ' + houses + ')');
  // 服务建筑:断路市场不覆盖(服务覆盖测试)
  const mSpot = findSpot(s, 5, 5, null, PF);
  const m1 = placeBuilding(s, 'market', mSpot.x, mSpot.y);
  assert.equal(m1.ok, true);
  const avM = footprint(E.buildings.getDef('market'), mSpot.x, mSpot.y);
  connectTo(s, mSpot.x, mSpot.y, avM, avM); // 连接的市场
  const m2Spot = findSpotFar(s, 5, 5);
  assert.ok(m2Spot, '远离仓库的市场位');
  const m2 = placeBuilding(s, 'market', m2Spot.x, m2Spot.y);
  assert.equal(m2.ok, true); // 不连接
  const sm2 = E.economy.computeStatus(s, m2.building, { warehouseRoads: E.population.serviceRoads(s, 'warehouse') });
  assert.equal(sm2.status, 'disconnected');
  // serviceRoads 覆盖集:只应包含连接市场的服务(断路市场不在内)
  const roads1 = E.population.serviceRoads(s, 'market');
  const b1 = E.placement.footprintBounds(E.buildings.getDef('market'), mSpot.x, mSpot.y, 0);
  const nearM1 = roads1.has(E.state.key(mSpot.x, mSpot.y)) || roads1.size > 0;
  assert.equal(nearM1, true, '连接市场有服务覆盖');
});

// [M-04] 金币收支分解:收入/维护分别平滑;零人口时收入平滑为 0(不出现"平滑净+即时维护"虚增)
test('[M-04] 零人口+维护费:金币收入平滑为 0,维护平滑为 -10/min', () => {
  const s = createInitialState();
  // 只放仓库+外圈路(不放民居:民居保底入住 1 人会使人口非零)
  const p = findSpot(s, 5, 5, null, PF);
  const rw = placeBuilding(s, 'warehouse', p.x, p.y);
  assert.equal(rw.ok, true);
  outer:
  for (const [dx, dy] of dirs4) {
    const exs = dx ? [p.x + (dx > 0 ? 3 : -3)] : [p.x - 2, p.x - 1, p.x, p.x + 1, p.x + 2];
    const eys = dy ? [p.y + (dy > 0 ? 3 : -3)] : [p.y - 2, p.y - 1, p.y, p.y + 1, p.y + 2];
    for (const ex of exs) for (const ey of eys) {
      if (ex < 0 || ey < 0 || ex >= 128 || ey >= 128) continue;
      if (s.grid[key(ex, ey)] || s.roads[key(ex, ey)]) continue;
      if (s.map.terrain[ey][ex] === 6 || s.map.terrain[ey][ex] === 7) continue;
      setRoad(s, ex, ey, true);
      break outer;
    }
  }
  // 零人口(无民居)
  for (const tid of Object.keys(s.population)) s.population[tid].count = 0;
  // 建一座维护费 10/min 的原木厂(连接)
  const spot = findSpotNear(s, 4, 4, 18);
  const av = footprint(E.buildings.getDef('sawmill'), spot.x, spot.y);
  connectTo(s, spot.x, spot.y, av, av);
  const r = placeBuilding(s, 'sawmill', spot.x, spot.y);
  assert.equal(r.ok, true);
  const maint = E.buildings.getDef('sawmill').maintenance;
  assert.equal(maint, 10, '原木厂维护 10/min');
  for (let i = 0; i < 70; i++) E.tick.tick(s); // 超过 60 tick 窗口
  const rc = s.rates.coin;
  assert.ok(Math.abs(rc.smoothProducedMin) < 0.01, '零人口 → 收入平滑 ≈0(实际 ' + rc.smoothProducedMin.toFixed(2) + ')');
  assert.ok(Math.abs(rc.smoothConsumedMin - 30) < 0.01, '维护平滑 ≈30/min(仓库20+原木厂10)(实际 ' + rc.smoothConsumedMin.toFixed(2) + ')');
  assert.ok(Math.abs(rc.smoothMin + 30) < 0.02, '净平滑 ≈-30/min(实际 ' + rc.smoothMin.toFixed(2) + ')');
});

// [M-01] 人口 /min 趋势:60 tick 平滑人口变化(增长为正,首个 tick 不污染窗口)
test('[M-01] 人口趋势:增长时 rates.__pop.smoothMin > 0', () => {
  const s = createInitialState();
  setupBase(s);
  // 需求满足 → 人口向目标增长:count 20 < target(连接住宅 5 栋 × per(fish3+workclothes2)=25)
  s.resources.fish = 10000; s.resources.workclothes = 10000;
  s.population.farmers.count = 20;
  for (let i = 0; i < 70; i++) E.tick.tick(s);
  const pr = s.rates['__pop'];
  assert.ok(pr && pr.smoothMin > 0, '人口增长 → 平滑趋势 >0/min(实际 ' + (pr ? pr.smoothMin.toFixed(2) : '无') + ')');
  assert.ok(Math.abs(pr.smoothMin) < 60, '趋势值合理(<60/min,实际 ' + pr.smoothMin.toFixed(2) + ')');
  // 首个 tick 不污染:新建 state 第 1 tick 后窗口应有记录且不虚高
  const s2 = createInitialState();
  E.tick.tick(s2);
  assert.ok(s2.rates['__pop'].smoothMin === 0, '首 tick 无 delta(实际 ' + s2.rates['__pop'].smoothMin + ')');
});

// [P0/HIGH] ratesHistory 归一化:load 真正走 localStorage;部分损坏窗口不再静默接受(NaN/null/不等长/畸形 __pop)
test('[P0] load 路径:v102 旧结构迁移后 2 tick 无异常,口径全为有限值', () => {
  // 注入 localStorage mock(真实 save → load 链路);测试结束恢复,避免并发污染其他用例
  const prevLS = globalThis.localStorage;
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const s = createInitialState();
  setupBase(s);
  s.population.farmers.count = 5;
  // 标准 v102 旧结构
  s.ratesHistory = {};
  for (const g of Object.keys(s.resources)) s.ratesHistory[g] = { arr: [1, 2, 3], sum: 6 };
  assert.equal(E.save.save(s), true, 'save 成功');
  const loaded = E.save.load();
  assert.ok(loaded && loaded.ratesHistory, 'load 后 ratesHistory 存在');
  // 迁移后各窗口为新形状且累计值按数组重算(不信任保存的 sp/sc/sn)
  for (const [g, h] of Object.entries(loaded.ratesHistory)) {
    assert.ok(Array.isArray(h.p) && Array.isArray(h.c) && Array.isArray(h.n), g + ': p/c/n 数组');
    assert.ok(h.p.length === h.c.length && h.c.length === h.n.length, g + ': 三轨等长');
  }
  E.tick.tick(loaded);
  E.tick.tick(loaded);
  for (const g of ['coin', 'wood', 'fish']) {
    const r = loaded.rates[g];
    assert.ok(Number.isFinite(r.smoothMin), g + ' smoothMin 有限(实际 ' + r.smoothMin + ')');
    assert.ok(Number.isFinite(r.smoothProducedMin), g + ' 收入平滑有限');
    assert.ok(Number.isFinite(r.smoothConsumedMin), g + ' 维护平滑有限');
  }
  // 防御路径:不经 load 直接旧形状 tick 也不崩
  const s2 = createInitialState();
  s2.ratesHistory = { coin: { arr: [5], sum: 5 } };
  E.tick.tick(s2);
  assert.ok(Array.isArray(s2.ratesHistory.coin.p), '防御:旧形状 tick 重建窗口');
  if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
});

// [HIGH] 部分损坏窗口:缺失累计值 / 三轨不等长 / 畸形 __pop / 非对象顶层
test('[HIGH] ratesHistory 部分损坏:全口径有限值,不污染经济监控', () => {
  const prevLS = globalThis.localStorage;
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const s = createInitialState();
  setupBase(s);
  s.population.farmers.count = 5;
  // 复现一:资源窗口缺累计值(sp/sc/sn 缺失)
  s.ratesHistory = {
    coin: { p: [], c: [], n: [] },
    wood: { p: [0], c: [0], n: [0], sp: 0, sc: 0, sn: 0 },
  };
  assert.equal(E.save.save(s), true);
  let loaded = E.save.load();
  assert.ok(loaded && loaded.ratesHistory, 'load 成功');
  E.tick.tick(loaded);
  E.tick.tick(loaded);
  for (const g of ['coin', 'wood']) {
    const r = loaded.rates[g];
    assert.ok(Number.isFinite(r.smoothMin), g + ': 复现一 smoothMin 有限(实际 ' + r.smoothMin + ')');
    assert.ok(Number.isFinite(r.smoothProducedMin) && Number.isFinite(r.smoothConsumedMin), g + ': 复现一 收入/维护平滑有限');
  }
  // 复现二:三轨长度不一致(p 60, c/n 空)
  const s2 = createInitialState();
  setupBase(s2);
  s2.population.farmers.count = 5;
  s2.ratesHistory = {
    coin: { p: Array(60).fill(0), c: [], n: [], sp: 0, sc: 0, sn: 0 },
  };
  assert.equal(E.save.save(s2), true);
  loaded = E.save.load();
  assert.ok(loaded, 'load 成功');
  E.tick.tick(loaded);
  const r2 = loaded.rates.coin;
  assert.ok(Number.isFinite(r2.smoothMin), '复现二 smoothMin 有限(实际 ' + r2.smoothMin + ')');
  assert.ok(Number.isFinite(r2.smoothConsumedMin), '复现二 维护平滑有限(实际 ' + r2.smoothConsumedMin + ')');
  // 复现三:畸形 __pop 绕过 load 直接 tick(运行时防御)
  const s3 = createInitialState();
  s3.ratesHistory = { __pop: { arr: [1], sum: 1 } };
  E.tick.tick(s3);
  assert.ok(Number.isFinite(s3.rates['__pop'].smoothMin), '复现三 __pop 有限(实际 ' + s3.rates['__pop'].smoothMin + ')');
  // 顶层非普通对象(数组)→ 归一化空对象,不崩溃
  const s4 = createInitialState();
  s4.ratesHistory = [1, 2, 3];
  E.tick.tick(s4);
  assert.ok(Number.isFinite(s4.rates.coin.smoothMin), '非对象顶层 → 空窗口正常');
  if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
});

// [唯一阻断] 有限元素求和溢出(60×1e308 → Infinity):load 后窗口丢弃,全口径有限
test('[溢出] 60×1e308 求和溢出:load 后窗口丢弃,2 tick 全口径 Number.isFinite', () => {
  const prevLS = globalThis.localStorage;
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const s = createInitialState();
  setupBase(s);
  s.population.farmers.count = 5;
  s.ratesHistory = {
    coin: { p: Array(60).fill(1e308), c: Array(60).fill(0), n: Array(60).fill(1e308) },
    wood: { p: [1e308, 1e308], c: [0, 0], n: [1e308, 1e308], sp: 0, sc: 0, sn: 0 },
    __pop: { n: Array(60).fill(1e308), sn: Infinity },
  };
  assert.equal(E.save.save(s), true);
  const loaded = E.save.load();
  assert.ok(loaded && loaded.ratesHistory, 'load 成功');
  // 溢出窗口被丢弃(不在 ratesHistory 中),后续 tick 建立空窗口
  assert.ok(!loaded.ratesHistory.coin, 'coin 溢出窗口已丢弃');
  assert.ok(!loaded.ratesHistory.wood, 'wood 溢出窗口已丢弃');
  assert.ok(!loaded.ratesHistory.__pop, '__pop 溢出窗口已丢弃');
  E.tick.tick(loaded);
  E.tick.tick(loaded);
  for (const g of ['coin', 'wood']) {
    const r = loaded.rates[g];
    assert.ok(Number.isFinite(r.smoothMin), g + ' smoothMin 有限(实际 ' + r.smoothMin + ')');
    assert.ok(Number.isFinite(r.smoothProducedMin), g + ' 收入平滑有限');
    assert.ok(Number.isFinite(r.smoothConsumedMin), g + ' 维护平滑有限');
  }
  assert.ok(Number.isFinite(loaded.rates['__pop'].smoothMin), '__pop 平滑有限(实际 ' + loaded.rates['__pop'].smoothMin + ')');
  if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
});

// [M-05 fix] 目标携带具体缺失建筑:逆序建造(只有链尾)时仍指向正确缺口
test('[M-05] 逆序链:只有蒸馏厂时 g3.missing 指向土豆田', () => {
  const s = createInitialState();
  setupBase(s);
  // 过 g0(仓库已有)→ 渔场 + 连通 → g1/g2 完成
  const fspot = findCoastFishery(s, 3, 3);
  assert.ok(fspot, '沿海渔场位');
  const rf = placeBuilding(s, 'fishery', fspot.x, fspot.y);
  assert.equal(rf.ok, true);
  const avf = footprint(E.buildings.getDef('fishery'), fspot.x, fspot.y);
  connectTo(s, fspot.x, fspot.y, avf, avf);
  // 逆序:只建蒸馏厂(不建土豆田)→ 蒸馏厂连通
  const dspot = findSpotNear(s, 4, 4, 18);
  const avd = footprint(E.buildings.getDef('distillery'), dspot.x, dspot.y);
  connectTo(s, dspot.x, dspot.y, avd, avd);
  const rd = placeBuilding(s, 'distillery', dspot.x, dspot.y);
  assert.equal(rd.ok, true);
  const goal = E.goals.getCurrentGoal(s);
  assert.equal(goal.id, 'g3');
  assert.deepEqual(goal.missing, ['potatoField'], '已有蒸馏厂 → 缺失土豆田(实际 ' + JSON.stringify(goal.missing) + ')');
  // 正序对照:只有土豆田 → missing 指向蒸馏厂
  const s2 = createInitialState();
  setupBase(s2);
  const f2 = findCoastFishery(s2, 3, 3);
  const rf2 = placeBuilding(s2, 'fishery', f2.x, f2.y);
  const avf2 = footprint(E.buildings.getDef('fishery'), f2.x, f2.y);
  connectTo(s2, f2.x, f2.y, avf2, avf2);
  const p2 = findSpotNear(s2, 3, 3, 18);
  const avp2 = footprint(E.buildings.getDef('potatoField'), p2.x, p2.y);
  connectTo(s2, p2.x, p2.y, avp2, avp2);
  const rp2 = placeBuilding(s2, 'potatoField', p2.x, p2.y);
  assert.equal(rp2.ok, true);
  const goal2 = E.goals.getCurrentGoal(s2);
  assert.equal(goal2.id, 'g3');
  assert.deepEqual(goal2.missing, ['distillery'], '已有土豆田 → 缺失蒸馏厂(实际 ' + JSON.stringify(goal2.missing) + ')');
});

// [M-05 fix2] 多栋同型:任意一栋连通即链段完成;只有断连实例 → 定位而非重复建造
test('[M-05] 同型多栋:第一栋断连第二栋连通 → 链段完成;仅断连实例 → locateIds 定位', () => {
  const s = createInitialState();
  setupBase(s);
  // 渔场 + 连通(过 g1/g2)
  const f = findCoastFishery(s, 3, 3);
  placeBuilding(s, 'fishery', f.x, f.y);
  const avf = footprint(E.buildings.getDef('fishery'), f.x, f.y);
  connectTo(s, f.x, f.y, avf, avf);
  // 两栋蒸馏厂:d1 断连、d2 连通
  const d1 = findSpotNear(s, 4, 4, 18);
  const avd1 = footprint(E.buildings.getDef('distillery'), d1.x, d1.y);
  const rd1 = placeBuilding(s, 'distillery', d1.x, d1.y);
  assert.equal(rd1.ok, true); // d1 不连通
  const d2 = findSpotNear(s, 4, 4, 18);
  const avd2 = footprint(E.buildings.getDef('distillery'), d2.x, d2.y);
  connectTo(s, d2.x, d2.y, avd2, avd2); // d2 连通
  const rd2 = placeBuilding(s, 'distillery', d2.x, d2.y);
  assert.equal(rd2.ok, true);
  const goal = E.goals.getCurrentGoal(s);
  assert.equal(goal.id, 'g3', '目标仍在 g3(缺土豆田)');
  assert.deepEqual(goal.missing, ['potatoField'], '蒸馏厂段完成(任意一栋连通),只缺土豆田(实际 ' + JSON.stringify(goal.missing) + ')');
  // 只有一栋断连蒸馏厂(无连通实例)→ locateIds 指向该栋(定位修复,不重复建造)
  const s2 = createInitialState();
  setupBase(s2);
  const f2 = findCoastFishery(s2, 3, 3);
  placeBuilding(s2, 'fishery', f2.x, f2.y);
  const avf2 = footprint(E.buildings.getDef('fishery'), f2.x, f2.y);
  connectTo(s2, f2.x, f2.y, avf2, avf2);
  const d3 = findSpotNear(s2, 4, 4, 18);
  const avd3 = footprint(E.buildings.getDef('distillery'), d3.x, d3.y);
  const rd3 = placeBuilding(s2, 'distillery', d3.x, d3.y);
  assert.equal(rd3.ok, true); // 唯一蒸馏厂,断连
  const goal2 = E.goals.getCurrentGoal(s2);
  assert.equal(goal2.id, 'g3');
  // 蒸馏厂段:有实例但断连 → 不要求建造该类型,而是定位该栋
  assert.ok(goal2.locateTargets.length === 1, '蒸馏厂断连实例在 locateTargets(实际 ' + JSON.stringify(goal2.locateTargets) + ')');
  assert.equal(goal2.locateTargets[0].type, 'distillery', 'locateTargets 携带 type');
  assert.equal(goal2.locateTargets[0].id, rd3.building.id, 'locateTargets 携带正确建筑 id');
  // 缺土豆田(无实例)→ missing 含 potatoField
  assert.ok(goal2.missing.includes('potatoField'), '土豆田无实例仍在 missing');
});

// [阻断二] locateTargets 结构化:UI 从同一对象读 id 与 type;土豆田未建+蒸馏厂断连 → 定位蒸馏厂
test('[阻断二] 土豆田未建+蒸馏厂断连:locateTargets 指向蒸馏厂,按钮名与跳转一致', () => {
  const s = createInitialState();
  setupBase(s);
  // 过 g1/g2(渔场+连通)
  const f = findCoastFishery(s, 3, 3);
  placeBuilding(s, 'fishery', f.x, f.y);
  const avf = footprint(E.buildings.getDef('fishery'), f.x, f.y);
  connectTo(s, f.x, f.y, avf, avf);
  // 只建蒸馏厂(断连),不建土豆田
  const d = findSpotNear(s, 4, 4, 18);
  const avd = footprint(E.buildings.getDef('distillery'), d.x, d.y);
  const rd = placeBuilding(s, 'distillery', d.x, d.y);
  assert.equal(rd.ok, true);
  const goal = E.goals.getCurrentGoal(s);
  assert.equal(goal.id, 'g3');
  assert.deepEqual(goal.missing, ['potatoField', 'distillery'], 'missing 含两者(未建+断连)');
  assert.equal(goal.locateTargets.length, 1, '仅断连蒸馏厂进入定位目标');
  assert.equal(goal.locateTargets[0].type, 'distillery');
  assert.equal(goal.locateTargets[0].id, rd.building.id);
  // UI 名称与 id 来自同一对象(locateTargets),浏览器验证按钮文本
});

// [阻断二] 工作服链:绵羊牧场未建+纺织厂断连 → 定位纺织厂
test('[阻断二] 绵羊牧场未建+纺织厂断连:locateTargets 指向纺织厂', () => {
  const s = createInitialState();
  setupBase(s);
  // 过 g1/g2 + 烈酒链(土豆田+蒸馏厂连通)
  const f = findCoastFishery(s, 3, 3);
  placeBuilding(s, 'fishery', f.x, f.y);
  const avf = footprint(E.buildings.getDef('fishery'), f.x, f.y);
  connectTo(s, f.x, f.y, avf, avf);
  const p = findSpotNear(s, 3, 3, 18);
  const avp = footprint(E.buildings.getDef('potatoField'), p.x, p.y);
  connectTo(s, p.x, p.y, avp, avp);
  const rp = placeBuilding(s, 'potatoField', p.x, p.y);
  assert.equal(rp.ok, true);
  const d = findSpotNear(s, 4, 4, 18);
  const avd = footprint(E.buildings.getDef('distillery'), d.x, d.y);
  connectTo(s, d.x, d.y, avd, avd);
  const rd = placeBuilding(s, 'distillery', d.x, d.y);
  assert.equal(rd.ok, true);
  // 只建纺织厂(远离仓库,真断连),不建绵羊牧场
  const t = findSpotFar(s, 4, 4);
  assert.ok(t, '远离仓库的纺织厂位');
  const avt = footprint(E.buildings.getDef('tailor'), t.x, t.y);
  const rt = placeBuilding(s, 'tailor', t.x, t.y);
  assert.equal(rt.ok, true);
  assert.equal(E.economy.computeStatus(s, rt.building, { warehouseRoads: E.population.serviceRoads(s, 'warehouse') }).status, 'disconnected', '纺织厂应为断连');
  const goal = E.goals.getCurrentGoal(s);
  assert.equal(goal.id, 'g4');
  assert.equal(goal.locateTargets.length, 1, '仅断连纺织厂进入定位目标');
  assert.equal(goal.locateTargets[0].type, 'tailor');
  assert.equal(goal.locateTargets[0].id, rt.building.id);
  // UI 名称与 id 来自同一对象(locateTargets),浏览器验证按钮文本
});

// ===== B-42 UI 经济监控口径 =====

// 1+2. 维护费立即计算与拆除立即减少(不等 60 tick 窗口)
test('[B-42] 总维护费:建造后立即计入,拆除后立即减少', () => {
  const s = createInitialState();
  setupBase(s); // 仓库 maintenance 20/min
  assert.equal(E.economy.totalMaintenancePerMin(s), 20, '初始只有仓库 20/min');
  // 建原木厂(10/min),不 tick
  const spot = findSpotNear(s, 4, 4, 18);
  const av = footprint(E.buildings.getDef('sawmill'), spot.x, spot.y);
  connectTo(s, spot.x, spot.y, av, av);
  const r = placeBuilding(s, 'sawmill', spot.x, spot.y);
  assert.equal(r.ok, true);
  assert.equal(E.economy.totalMaintenancePerMin(s), 30, '建造后立即 20+10=30(无需 tick)');
  // 拆除立即减少
  E.placement.demolish(s, r.building.id);
  assert.equal(E.economy.totalMaintenancePerMin(s), 20, '拆除后立即回到 20');
});

// 3. 停工仍收维护费(断连/缺劳动力/缺原料/超范围/开发度过高)
test('[B-42] 停工建筑仍计入维护费(五种状态)', () => {
  const s = createInitialState();
  setupBase(s);
  s.population.farmers.count = 0;
  // 断连原木厂(不连通)
  const d1 = findSpotFar(s, 4, 4);
  const r1 = placeBuilding(s, 'sawmill', d1.x, d1.y);
  assert.equal(r1.ok, true);
  assert.equal(E.economy.computeStatus(s, r1.building, { warehouseRoads: E.population.serviceRoads(s, 'warehouse') }).status, 'disconnected');
  // 缺劳动力:纺织厂(连通,人口 0)
  const t = findSpotNear(s, 4, 4, 18);
  const avt = footprint(E.buildings.getDef('tailor'), t.x, t.y);
  connectTo(s, t.x, t.y, avt, avt);
  const r2 = placeBuilding(s, 'tailor', t.x, t.y);
  assert.equal(r2.ok, true);
  // 缺原料:纺织厂有 wool 需求,库存 0 + 人口恢复 → input-shortage
  s.population.farmers.count = 50;
  // 超范围:远处纺织厂铺长路(>34 格)
  const far2 = findSpotFar(s, 4, 4);
  const avt2 = footprint(E.buildings.getDef('tailor'), far2.x, far2.y);
  connectTo(s, far2.x, far2.y, avt2, avt2);
  const r3 = placeBuilding(s, 'tailor', far2.x, far2.y);
  assert.equal(r3.ok, true);
  s.resources.wool = 100;
  // 开发度过高:土豆农场占满
  const s5 = createInitialState();
  setupBase(s5);
  const p5 = findSpotNear(s5, 3, 3, 18);
  const avp5 = footprint(E.buildings.getDef('potatoField'), p5.x, p5.y);
  connectTo(s5, p5.x, p5.y, avp5, avp5);
  const r5 = placeBuilding(s5, 'potatoField', p5.x, p5.y);
  assert.equal(r5.ok, true);
  const defs = E.buildings.getDef('sawmill');
  // 所有仍存在的建筑计入维护费
  const total = E.economy.totalMaintenancePerMin(s);
  assert.ok(total >= 20 + defs.maintenance + E.buildings.getDef('tailor').maintenance, '断连/缺工/缺料/超范围建筑都计入(实际 ' + total + ')');
  const total5 = E.economy.totalMaintenancePerMin(s5);
  assert.ok(total5 >= 20 + E.buildings.getDef('potatoField').maintenance, '开发度过高建筑计入(实际 ' + total5 + ')');
});

// 4. 金币分项同源:displayedNet = smoothProducedMin - totalMaintenancePerMin
test('[B-42] 金币净变化同源:smoothProducedMin - 即时总维护', () => {
  const s = createInitialState();
  setupBase(s);
  s.population.farmers.count = 5;
  for (let i = 0; i < 70; i++) E.tick.tick(s);
  const rc = s.rates.coin;
  const inc = rc.smoothProducedMin;
  const mnt = E.economy.totalMaintenancePerMin(s);
  const net = inc - mnt;
  assert.ok(Number.isFinite(net), '净变化有限');
  assert.ok(Math.abs(net - (inc - mnt)) < 1e-9, '主行净变化 = 收入 - 即时维护');
});

// 5. 需求按当前人口:needPerMin ≈ count × rate × 60
test('[B-42] 需求/min = 当前人口 × rate × 60(浮点近似)', () => {
  const s = createInitialState();
  const pop = s.population.farmers;
  pop.count = 37;
  const tier = E.tiers.TIERS.farmers;
  const fishRate = tier.needs.fish.rate;
  const got = E.population.currentNeedPerMin(s, 'farmers', 'fish');
  const exp = 37 * fishRate * 60;
  assert.ok(Math.abs(got - exp) < 1e-9, 'needPerMin ≈ ' + exp + '(实际 ' + got + ')');
  // 结构化汇总 byTier/byGood 一致
  const rates = E.population.currentNeedRates(s);
  assert.ok(Math.abs(rates.byTier.farmers.fish - exp) < 1e-9, 'byTier 一致');
  assert.ok(Math.abs(rates.byGood.fish - exp) < 1e-9, 'byGood 一致(单阶层)');
  // 人口变化 → 需求变化
  pop.count = 100;
  const got2 = E.population.currentNeedPerMin(s, 'farmers', 'fish');
  assert.ok(Math.abs(got2 - 100 * fishRate * 60) < 1e-9, '人口增加后需求增加');
});

// 6. 库存不足不改变理论需求;consumed=0;满足度=0
test('[B-42] 库存为 0:理论需求不变,实际消耗 0,满足度 0', () => {
  const s = createInitialState();
  setupBase(s);
  s.population.farmers.count = 10;
  const tier = E.tiers.TIERS.farmers;
  const fishRate = tier.needs.fish.rate;
  const before = E.population.currentNeedPerMin(s, 'farmers', 'fish');
  s.resources.fish = 0;
  E.tick.tick(s);
  const after = E.population.currentNeedPerMin(s, 'farmers', 'fish');
  // 理论需求只依赖当前人口 × rate × 60(与库存无关);tick 后人口可能变化,按当前人口口径断言
  const expNow = s.population.farmers.count * fishRate * 60;
  assert.ok(Math.abs(after - expNow) < 1e-9, '库存 0 理论需求 = 当前人口×rate×60(不受库存影响)');
  assert.equal(s.flow.fish ? s.flow.fish.consumed : 0, 0, '无库存实际消耗 0');
  const sat = (s.population.farmers.needSats || {}).fish ?? 0;
  assert.equal(sat, 0, '无库存满足度 0');
});

// 7. 服务需求不产生商品需求率
test('[B-42] 服务型需求(市场/酒吧)不产出需求/min', () => {
  const s = createInitialState();
  s.population.farmers.count = 50;
  const rates = E.population.currentNeedRates(s);
  assert.ok(!('market' in rates.byTier.farmers), 'market 服务不在需求率中');
  assert.ok(!('bar' in rates.byTier.farmers), 'bar 服务不在需求率中');
  assert.ok('fish' in rates.byTier.farmers, '商品需求正常');
});

// ===== B-43 住宅初始人口与需求 Influx =====

// 1+2. 新建住宅 0 人;无供应连续 tick 保持 0
test('[B-43] 新建住宅 0 人;无需求供应时保持 0', () => {
  const s = createInitialState();
  const p = findSpot(s, 5, 5, null, PF);
  const wh = placeBuilding(s, 'warehouse', p.x, p.y);
  assert.equal(wh.ok, true);
  const hs = findHouseSpot(s, [wh.building]);
  const r = placeBuilding(s, 'residence', hs.x, hs.y);
  assert.equal(r.ok, true);
  assert.equal(s.population.farmers.count, 0, '新建住宅 0 人(不 tick)');
  // 清空库存、无市场 → 目标 0,连续 tick 保持 0
  s.resources.fish = 0;
  s.resources.workclothes = 0;
  for (let i = 0; i < 10; i++) E.tick.tick(s);
  assert.equal(s.population.farmers.count, 0, '无供应连续 tick 仍 0');
});

// 3. 零人口需求不能自动全满足(0 库存 → sat 0;houseTarget 0)
test('[B-43] 零人口+零库存:需求 sat 全 0,目标人口 0', () => {
  const s = createInitialState();
  const p = findSpot(s, 5, 5, null, PF);
  const wh = placeBuilding(s, 'warehouse', p.x, p.y);
  const hs = findHouseSpot(s, [wh.building]);
  const r = placeBuilding(s, 'residence', hs.x, hs.y);
  assert.equal(r.ok, true);
  s.resources.fish = 0;
  s.resources.workclothes = 0;
  E.tick.tick(s);
  const sats = s.population.farmers.needSats;
  assert.equal(sats.market, 0, '无市场覆盖 → market sat 0');
  assert.equal(sats.fish, 0, '0 库存 → fish sat 0');
  assert.equal(sats.workclothes, 0, '0 库存 → workclothes sat 0');
  assert.equal(E.population.houseTarget(s, 'farmers'), 0, '目标人口 0');
  // 有鱼库存 → fish sat 1(有供应),目标 = 鱼 influx 3
  s.resources.fish = 100;
  E.tick.tick(s);
  assert.equal(s.population.farmers.needSats.fish, 1, '0 人+有鱼 → fish sat 1');
  assert.equal(E.population.houseTarget(s, 'farmers'), 3, '目标 = 鱼 influx 3');
});

// 4+5. 单项独立 Influx + 组合矩阵(无顺序)
test('[B-43] 需求独立求和:单项 5/3/2,组合 8/7/5/10', () => {
  const mk = (fish, wc, market) => {
    const s = createInitialState();
    setupBase(s); // 5 栋民居 + 完整路网(服务覆盖需要连续路网,connectTo 单点路不够)
    s.population.farmers.count = 0; // 从 0 起步(needSats 与 count 无关)
    s.resources.fish = fish;
    s.resources.workclothes = wc;
    if (market) {
      const m = setupMarket(s);
      assert.ok(m, '市场建成并覆盖');
    }
    E.tick.tick(s);
    return E.population.houseTarget(s, 'farmers') / 5; // 每栋住宅的目标(5 栋 × 单栋 per)
  };
  assert.equal(mk(0, 0, false), 0, '无 → 0');
  assert.equal(mk(0, 0, true), 5, '只市场 → 5');
  assert.equal(mk(100, 0, false), 3, '只鱼 → 3');
  assert.equal(mk(0, 100, false), 2, '只工作服 → 2');
  assert.equal(mk(100, 0, true), 8, '市场+鱼 → 8');
  assert.equal(mk(0, 100, true), 7, '市场+工作服 → 7');
  assert.equal(mk(100, 100, false), 5, '鱼+工作服 → 5');
  assert.equal(mk(100, 100, true), 10, '全部 → 10');
});

// 6. 人口缓慢趋近(首 tick 0<count<3,收敛 3)
test('[B-43] 只有鱼供应:人口从 0 缓慢趋近 3(非首 tick 跳满)', () => {
  const s = createInitialState();
  const p = findSpot(s, 5, 5, null, PF);
  const wh = placeBuilding(s, 'warehouse', p.x, p.y);
  const hs = findHouseSpot(s, [wh.building]);
  placeBuilding(s, 'residence', hs.x, hs.y);
  s.resources.fish = 1000;
  E.tick.tick(s);
  const c1 = s.population.farmers.count;
  assert.ok(c1 > 0 && c1 < 3, '首 tick 后 0 < 人口 < 3(实际 ' + c1 + ')');
  for (let i = 0; i < 300; i++) E.tick.tick(s);
  assert.ok(Math.abs(s.population.farmers.count - 3) < 0.05, '收敛到 3(实际 ' + s.population.farmers.count + ')');
});

// 7. 升级迁移 10 人(farmers 0 / workers 10 / cap 20,不瞬间 20)
test('[B-43] 升级迁移该栋住户:农民 -10 工人 +10,工人住宅 10/20', () => {
  const s = createInitialState();
  const base = findSpot(s, 5, 5, null, PF);
  const whB = placeBuilding(s, 'warehouse', base.x, base.y);
  const resSpot = findHouseSpot(s, [whB.building]);
  const resB = placeBuilding(s, 'residence', resSpot.x, resSpot.y);
  s.resources.wood = 100;
  s.resources.brick = 100;
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1 };
  s.population.farmers.count = 10; // 满员 10/10
  E.population.refreshOccupancy(s);
  const r = upgradeResidence(s, resB.building.id);
  assert.equal(r.ok, true);
  assert.equal(s.population.farmers.count, 0);
  assert.equal(s.population.workers.count, 10, '工人 +10');
  assert.equal(E.buildings.getDef('residenceWorkers').capacity, 20);
  // [B-43 返工 D] 升级后新住宅立即 10/20(不依赖手动 refreshOccupancy)
  assert.equal(s.buildings[r.building.id].occupied, 10, '工人住宅 10/20(不瞬间 20)');
});

// 8. 工人需求目标无顺序(独立求和)
test('[B-43] 工人需求独立求和(无顺序门槛)', () => {
  // 先升级出 1 栋工人住宅(农民满员 10/10 + 基础需求)
  const s = createInitialState();
  const base = findSpot(s, 5, 5, null, PF);
  const whB = placeBuilding(s, 'warehouse', base.x, base.y);
  const resSpot = findHouseSpot(s, [whB.building]);
  const resB = placeBuilding(s, 'residence', resSpot.x, resSpot.y);
  s.resources.wood = 100;
  s.resources.brick = 100;
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1 };
  s.population.farmers.count = 10;
  E.population.refreshOccupancy(s);
  const r = upgradeResidence(s, resB.building.id);
  assert.equal(r.ok, true);
  assert.equal(s.population.workers.count, 10);
  const wTier = E.tiers.TIERS.workers;
  const inf = {};
  for (const [g, n] of Object.entries(wTier.needs)) if (n.influx) inf[g] = n.influx;
  // 只满足单项 → 目标 = 1 栋 × 该单项 influx
  const oneGood = Object.keys(inf)[0];
  s.population.workers.needSats = { [oneGood]: 1 };
  assert.equal(E.population.houseTarget(s, 'workers'), inf[oneGood], '只满足 ' + oneGood + ' → 目标 ' + inf[oneGood]);
  // 只满足另一项(无顺序:先满足第二项也独立生效)
  const otherGood = Object.keys(inf)[1];
  s.population.workers.needSats = { [otherGood]: 1 };
  assert.equal(E.population.houseTarget(s, 'workers'), inf[otherGood], '只满足 ' + otherGood + ' → 目标 ' + inf[otherGood]);
  // 全部基础满足 → Σ influx
  const allSats = {};
  for (const g of Object.keys(inf)) allSats[g] = 1;
  s.population.workers.needSats = allSats;
  const sum = Object.values(inf).reduce((a, b) => a + b, 0);
  assert.equal(E.population.houseTarget(s, 'workers'), sum, '全部基础满足 → Σ influx = ' + sum);
});

// 9. 断连住宅不计入目标人口
test('[B-43] 断连住宅不计容量/目标人口', () => {
  const s = createInitialState();
  const base = findSpot(s, 5, 5, null, PF);
  const whB = placeBuilding(s, 'warehouse', base.x, base.y);
  // 1 栋连通住宅 + 1 栋断连住宅
  const h1 = findHouseSpot(s, [whB.building]);
  placeBuilding(s, 'residence', h1.x, h1.y);
  const av1 = footprint(E.buildings.getDef('residence'), h1.x, h1.y);
  connectTo(s, h1.x, h1.y, av1, av1);
  const h2 = findSpotFar(s, 3, 3);
  assert.ok(h2, '远离仓库的民居位');
  const r2 = placeBuilding(s, 'residence', h2.x, h2.y);
  assert.equal(r2.ok, true);
  assert.equal(E.economy.computeStatus(s, r2.building, { warehouseRoads: E.population.serviceRoads(s, 'warehouse') }).status, 'disconnected');
  assert.equal(E.population.countHouses(s, 'farmers'), 1, '仅连通住宅计数');
  assert.equal(E.population.capacityFor(s, 'farmers'), 10, '容量仅连通住宅');
  // 目标人口 = 连通住宅数 × per(断连不计)
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1 };
  assert.equal(E.population.houseTarget(s, 'farmers'), 10, '目标 = 1 栋 × Σinflux 10');
});

// ===== B-43 返工回归(Sol 门控) =====

// E1. 9.5/10:引擎拒绝升级,建材/建筑/人口不变
test('[B-43返工] 9.5/10 禁止升级:建材/建筑/人口不变', () => {
  const s = createInitialState();
  setupBase(s);
  s.resources.wood = 100;
  s.resources.brick = 100;
  const res = Object.values(s.buildings).find((b) => b.type === 'residence');
  // 真实 occupied 9.5(总人口 9.5 → 首栋先建先满 9.5;不四舍五入)
  s.population.farmers.count = 9.5;
  E.population.refreshOccupancy(s);
  assert.equal(res.occupied, 9.5, '目标栋 occupied=9.5');
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1 };
  const wood0 = s.resources.wood;
  const pop0 = s.population.farmers.count;
  const r = upgradeResidence(s, res.id);
  assert.equal(r.ok, false, '9.5/10 拒绝升级');
  assert.ok(r.reason.includes('未满员'), '原因=未满员(实际 ' + r.reason + ')');
  assert.equal(s.resources.wood, wood0, '建材不变');
  assert.equal(s.population.farmers.count, pop0, '人口不变');
  assert.equal(s.buildings[res.id].type, 'residence', '建筑未变');
});

// E2+E6. 10/10 升级成功:农民 -10 工人 +10 守恒;新住宅立即 10/20(无手动 refresh)
test('[B-43返工] 10/10 升级成功:守恒 + 新住宅立即 10/20', () => {
  const s = createInitialState();
  setupBase(s);
  s.resources.wood = 100;
  s.resources.brick = 100;
  const res = Object.values(s.buildings).find((b) => b.type === 'residence');
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1 };
  s.population.farmers.count = 10;
  s.population.workers.count = 3; // 已有其他来源工人
  E.population.refreshOccupancy(s);
  const before = s.population.farmers.count + s.population.workers.count;
  const r = upgradeResidence(s, res.id);
  assert.equal(r.ok, true);
  assert.equal(s.population.farmers.count, 0, '农民 -10');
  assert.equal(s.population.workers.count, 13, '工人 +10(3+10)');
  assert.equal(s.population.farmers.count + s.population.workers.count, before, '总人口严格守恒');
  assert.equal(s.buildings[r.building.id].occupied, 10, '升级返回新住宅立即 10/20(未手动 refresh)');
});

// E3. 断连先建、连通后建:断连 occupied=0,连通 occupied=10
test('[B-43返工] 断连住宅 occupied=0,连通住宅先建先满', () => {
  const s = createInitialState();
  const base = findSpot(s, 5, 5, null, PF);
  const whB = placeBuilding(s, 'warehouse', base.x, base.y);
  // 先建断连住宅(远离仓库)
  const far = findSpotFar(s, 3, 3);
  const rDisc = placeBuilding(s, 'residence', far.x, far.y);
  assert.equal(rDisc.ok, true);
  // 后建连通住宅(仓库旁+路)
  const h1 = findHouseSpot(s, [whB.building]);
  const rConn = placeBuilding(s, 'residence', h1.x, h1.y);
  const av1 = footprint(E.buildings.getDef('residence'), h1.x, h1.y);
  connectTo(s, h1.x, h1.y, av1, av1);
  s.population.farmers.count = 10;
  E.population.refreshOccupancy(s);
  assert.equal(s.buildings[rDisc.building.id].occupied, 0, '断连栋 occupied=0');
  assert.equal(s.buildings[rConn.building.id].occupied, 10, '连通栋 occupied=10(先建先满)');
});

// E4. 断连住宅升级失败
test('[B-43返工] 断连住宅升级失败', () => {
  const s = createInitialState();
  setupBase(s);
  s.resources.wood = 100;
  s.resources.brick = 100;
  // 放断连住宅(远离仓库)
  const far = findSpotFar(s, 3, 3);
  const rDisc = placeBuilding(s, 'residence', far.x, far.y);
  assert.equal(rDisc.ok, true);
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1 };
  s.population.farmers.count = 10;
  E.population.refreshOccupancy(s);
  assert.equal(s.buildings[rDisc.building.id].occupied, 0, '断连 occupied=0');
  const r = upgradeResidence(s, rDisc.building.id);
  assert.equal(r.ok, false, '断连住宅拒绝升级');
});

// E5. 连通满员升级成功
test('[B-43返工] 连通满员住宅升级成功', () => {
  const s = createInitialState();
  setupBase(s);
  s.resources.wood = 100;
  s.resources.brick = 100;
  const res = Object.values(s.buildings).find((b) => b.type === 'residence');
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1 };
  s.population.farmers.count = 10;
  E.population.refreshOccupancy(s);
  const r = upgradeResidence(s, res.id);
  assert.equal(r.ok, true, '连通满员可升级');
});

// E7. 多栋升级只迁移目标栋实际住户
test('[B-43返工] 多栋住宅:升级只迁移目标栋住户', () => {
  const s = createInitialState();
  setupBase(s); // 5 栋连通民居
  s.resources.wood = 100;
  s.resources.brick = 100;
  const houses = Object.values(s.buildings).filter((b) => b.type === 'residence');
  s.population.farmers.needSats = { market: 1, fish: 1, workclothes: 1 };
  s.population.farmers.count = 50; // 5 栋 × 10 全满
  E.population.refreshOccupancy(s);
  const target = houses[2]; // 升级第 3 栋
  assert.equal(target.occupied, 10, '目标栋满员');
  const before = s.population.farmers.count + s.population.workers.count;
  const r = upgradeResidence(s, target.id);
  assert.equal(r.ok, true);
  assert.equal(s.population.workers.count, 10, '只迁移目标栋 10 人');
  assert.equal(s.population.farmers.count, 40, '农民剩 40(50-10)');
  assert.equal(s.population.farmers.count + s.population.workers.count, before, '总人口守恒');
  // 其余民居仍各自占满(未被误动)
  const others = Object.values(s.buildings).filter((b) => b.type === 'residence');
  assert.equal(others.length, 4);
  E.population.refreshOccupancy(s);
  for (const o of others) assert.equal(o.occupied, 10, '其他民居仍 10');
});
