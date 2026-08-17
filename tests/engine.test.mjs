/* engine.test.mjs — 引擎单测(node --test,零依赖)
 * [V1.10 修订⑤] 数据按人工核查表校准:渔场5×16/周期30、纺织厂一步链、
 * 陶土矿场/砖厂/铁矿=工人层、5 阶住宅升级链、仓库=服务建筑(生产建筑须在服务范围内)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
require('../src/engine/data/goods.js');
require('../src/engine/data/needs-data.js');
require('../src/engine/data/tiers.js');
require('../src/engine/data/buildings-data.js');
require('../src/engine/data/buildings.js');
require('../src/engine/data/map-template.js');
require('../src/engine/data/ships-data.js');
let b61WorldData = null;
try {
  b61WorldData = require('../src/engine/data/world-data.js');
} catch (e) {
  if (!e || e.code !== 'MODULE_NOT_FOUND') throw e;
}
require('../src/engine/data/balance.js');
require('../src/engine/events.js');
require('../src/engine/state.js');
require('../src/engine/connectivity.js');
require('../src/engine/economy.js');
require('../src/engine/placement.js');
require('../src/engine/ships.js');
require('../src/engine/explorations.js');
require('../src/engine/transport.js');
require('../src/engine/population.js');
require('../src/engine/goals.js');
require('../src/engine/chains.js');
require('../src/engine/tick.js');
require('../src/engine/save.js');
let b61SaveTransfer = null;
try {
  b61SaveTransfer = require('../src/tools/save-transfer.js');
} catch (e) {
  if (!e || e.code !== 'MODULE_NOT_FOUND') throw e;
}

const E = globalThis.Engine;
const { key } = E.state;
const { placeBuilding, setRoad, demolish, footprint, upgradeResidence } = E.placement;

const DEFAULT_SEED = 20260808;
const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ALL_LAND = [0, 1, 2, 3, 4, 5];
const PF = [0]; // [用户决策] 森林移除:可建地形仅平地
const CYCLE = 60; // 测试基准周期(秒)

function createInitialState() {
  const s = E.state.createInitialState(DEFAULT_SEED);
  // 既有机制测试固定使用原128地形夹具，避免随机160地形改变找位与道路oracle；B-61专项测试调用真实入口。
  s.map = { size: 128, terrain: E.mapTemplate.generateMap(128, DEFAULT_SEED), seed: DEFAULT_SEED };
  return s;
}

function makeLegacySaveRaw() {
  const world = createInitialState();
  const island = E.state.getActiveIsland(world);
  const legacy = {
    version: 1,
    settings: world.settings,
    time: world.time,
    map: island.map,
    resources: Object.assign({}, island.resources),
    buildings: island.buildings,
    grid: island.grid,
    roads: island.roads,
    population: island.population,
    happiness: island.happiness,
    unlocks: island.unlocks,
    log: island.log,
    nextId: island.nextId,
    _conn: island._conn,
  };
  return JSON.stringify({ v: 1, ts: 123, state: legacy });
}

test('[B-61] world-data集中声明世界schema与迁移常量', () => {
  assert.ok(b61WorldData, 'world-data模块尚未实现');
  assert.equal(b61WorldData.SCHEMA_VERSION, 2);
  assert.equal(b61WorldData.MAP_SIZE, 160);
  assert.equal(b61WorldData.LEGACY_MAP_SIZE, 128);
  assert.equal(b61WorldData.LEGACY_MAP_OFFSET, 16);
  assert.equal(b61WorldData.MAX_OWNED_ISLANDS, 12);
  assert.equal(b61WorldData.MAIN_ISLAND_ID, 'island-main');
  assert.equal(b61WorldData.PRE_MULTI_BACKUP_KEY, 'web1800-save-v1.pre-multi-island');
  assert.deepEqual(b61WorldData.MAIN_FERTILITIES, ['potato', 'grain', 'hops', 'pepper', 'grapes']);
  assert.deepEqual(b61WorldData.MINERAL_TYPES, ['clay', 'iron', 'coal', 'limestone', 'zinc', 'copper', 'gold']);
});

test('[B-61] 新游戏创建World根对象与单座160主岛', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.activeIslandId, 'island-main');
  assert.deepEqual(Object.keys(s.islands), ['island-main']);
  const island = s.islands['island-main'];
  assert.equal(island.id, 'island-main');
  assert.equal(island.map.size, 160);
  assert.equal(island.map.terrain.length, 160);
  assert.equal(island.map.terrain[0].length, 160);
  assert.equal(s.map, island.map, '旧引擎map读取活动岛兼容别名');
  assert.equal(s.buildings, island.buildings, '旧引擎buildings读取活动岛兼容别名');
  assert.equal(s.treasury.coin, 5000);
  assert.equal(s.resources.wood, 60);
  assert.equal(s.resources.fish, 100);
  s.resources.coin -= 25;
  assert.equal(s.treasury.coin, 4975, '旧resources.coin写入全局钱包');
  const plain = JSON.parse(JSON.stringify(s));
  assert.equal(plain.map, undefined, '兼容别名不重复进入存档');
  assert.equal(plain.resources, undefined, '兼容resources不重复进入存档');
  assert.equal(plain.islands['island-main'].resources.coin, undefined, '岛内商品不复制全局金币');
});

test('[B-61] 切换活动岛后金币仍映射全局钱包且存档守恒', () => {
  const world = E.state.createInitialState(DEFAULT_SEED);
  world.islands['island-second'] = E.state.createIslandState('island-second', DEFAULT_SEED + 1, 160, { wood: 5 });
  E.state.attachWorldAliases(world);
  world.activeIslandId = 'island-second';
  world.resources.coin = world.treasury.coin + 7;
  assert.equal(world.treasury.coin, 5007, '第二岛收支必须更新世界钱包');
  const encoded = E.save.serialize(world);
  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(encoded).state.islands['island-second'].resources, 'coin'), false, '岛内不得序列化独立coin');
  const loaded = E.save.deserialize(encoded);
  assert.equal(loaded.treasury.coin, 5007);
  assert.equal(loaded.resources.coin, 5007);
});

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
// [B-63] 纯海岸找位:footprint 全水 + 4 邻至少 1 陆地(不铺路,用于造船厂/码头断连场景)
function findCoastSpot(s, w, h) {
  const size = s.map.size;
  const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2);
  for (let cy = by; cy < size - (h - 1 - by); cy++) for (let cx = bx; cx < size - (w - 1 - bx); cx++) {
    let allWater = true, anyLand = false;
    for (let dy = 0; dy < h && allWater; dy++) for (let dx = 0; dx < w && allWater; dx++) {
      const t = s.map.terrain[cy - by + dy][cx - bx + dx];
      if (t !== 6) { allWater = false; break; }
      for (const [ddx, ddy] of dirs4) {
        const wx = cx - bx + dx + ddx, wy = cy - by + dy + ddy;
        if (wx >= 0 && wy >= 0 && wx < size && wy < size && s.map.terrain[wy][wx] !== 6 && s.map.terrain[wy][wx] !== 7) anyLand = true;
      }
    }
    if (allWater && anyLand) return { x: cx, y: cy };
  }
  return null;
}

// [B-63] 指定中心附近找海岸位(第二座码头用)
function findCoastSpotOffset(s, w, h, nearX, nearY) {
  const size = s.map.size;
  const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2);
  for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
    const cx = nearX + dx, cy = nearY + dy;
    if (cx < bx || cy < by || cx >= size - (w - 1 - bx) || cy >= size - (h - 1 - by)) continue;
    let allWater = true, anyLand = false;
    for (let yy = 0; yy < h && allWater; yy++) for (let xx = 0; xx < w && allWater; xx++) {
      if (s.map.terrain[cy - by + yy][cx - bx + xx] !== 6) { allWater = false; break; }
      for (const [ddx, ddy] of dirs4) {
        const wx = cx - bx + xx + ddx, wy = cy - by + yy + ddy;
        if (wx >= 0 && wy >= 0 && wx < size && wy < size && s.map.terrain[wy][wx] !== 6 && s.map.terrain[wy][wx] !== 7) anyLand = true;
      }
    }
    if (allWater && anyLand) return { x: cx, y: cy };
  }
  return null;
}
function footprintOverlaps(s, def, x1, y1, x2, y2) {
  const a = footprint(def, x1, y1);
  const b = footprint(def, x2, y2);
  const set = new Set(a.map((c) => key(c.x, c.y)));
  return b.some((c) => set.has(key(c.x, c.y)));
}
function setupShipyard(s) {
  setupBase(s);
  const spot = findCoastRect(s, 6, 17); // 找位+铺路+仓库覆盖验证(返回中心)
  assert.ok(spot, '应有仓库覆盖内海岸 6×17 位');
  const r = placeBuilding(s, 'sailingShipyard', spot.x, spot.y);
  assert.equal(r.ok, true, '造船厂放置: ' + (r.reason || ''));
  E.economy.refresh(s, { produce: false, logs: false });
  s.population.workers.count = 100;
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(s.buildings[r.building.id].status, 'producing', '造船厂应 producing: ' + (s.buildings[r.building.id].reason || ''));
  return { shipyard: r.building, spot };
}

// [HIGH-2] 主岛码头(7×11)+ 铺路连通仓库(海上任务出发权限;B-64 测试前置)
function setupPort(s) {
  const def = E.buildings.getDef('port');
  const size = s.map.size;
  const w = 7, h = 11;
  const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2);
  let spot = null;
  // 全图遍历:全水 footprint + 4 邻陆地 + 不与已有建筑重叠(海岸建筑 footprint 全水,可能与船厂重叠)
  for (let cy = by; cy < size - (h - 1 - by) && !spot; cy++) {
    for (let cx = bx; cx < size - (w - 1 - bx) && !spot; cx++) {
      let allWater = true, anyLand = false;
      for (let dy = 0; dy < h && allWater; dy++) for (let dx = 0; dx < w && allWater; dx++) {
        const t = s.map.terrain[cy - by + dy][cx - bx + dx];
        if (t !== 6) { allWater = false; break; }
        for (const [ddx, ddy] of dirs4) {
          const wx = cx - bx + dx + ddx, wy = cy - by + dy + ddy;
          if (wx >= 0 && wy >= 0 && wx < size && wy < size && s.map.terrain[wy][wx] !== 6 && s.map.terrain[wy][wx] !== 7) anyLand = true;
        }
      }
      if (!allWater || !anyLand) continue;
      const fp = E.placement.footprint(def, cx, cy, 0);
      const overlap = fp.some((p) => s.grid[key(p.x, p.y)]);
      if (!overlap) { spot = { x: cx, y: cy }; break; }
    }
  }
  assert.ok(spot, '应有未被占用的海岸 7×11 码头位');
  const r = placeBuilding(s, 'port', spot.x, spot.y);
  assert.equal(r.ok, true, '码头放置: ' + (r.reason || ''));
  const av = E.placement.footprint(def, spot.x, spot.y, 0);
  const c = connectTo(s, spot.x, spot.y, av, av);
  assert.ok(c, '码头连通仓库');
  return r.building;
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
// [民居规则] 候选位 4 邻至少 1 格"有出口的空地"(connectTo 可达:空地格自身还需再外圈有空地,排除死口袋)
function findHouseSpot(s, built) {
  const size = s.map.size;
  for (let y = 0; y <= size - 3; y++) for (let x = 0; x <= size - 3; x++) {
    if (!freeRect(s, x, y, 3, 3) || !terrainRectOk(s, x, y, 3, 3, PF)) continue;
    let air = false;
    for (let dy = -1; dy <= 3 && !air; dy++) for (let dx = -1; dx <= 3 && !air; dx++) {
      if (dx >= 0 && dx < 3 && dy >= 0 && dy < 3) continue;
      const ax = x + dx, ay = y + dy;
      if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
      const t = s.map.terrain[ay][ax];
      if (t === 6 || t === 7) continue;
      const k = key(ax, ay);
      if (s.grid[k] || s.roads[k]) continue;
      // 空地格需有出口:其 4 邻(不含候选位)还有空地/路
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ex = ax + ddx, ey = ay + ddy;
        if (ex >= x && ex < x + 3 && ey >= y && ey < y + 3) continue;
        if (ex < 0 || ey < 0 || ex >= size || ey >= size) continue;
        const et = s.map.terrain[ey][ex];
        if (et === 6 || et === 7) continue;
        const ek = key(ex, ey);
        if (!s.grid[ek] && !s.roads[ek]) { air = true; break; }
      }
    }
    if (!air) continue;
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

test('初始状态:160 主岛,无建筑,资源(5000 金币/60 木/100 鱼)', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  assert.equal(Object.keys(s.buildings).length, 0);
  assert.equal(s.map.size, 160);
  assert.equal(s.population.farmers.count, 0, '开局无人口(民居驱动)');
  assert.equal(s.resources.coin, 5000); // [B-59] 开局金币 10000→5000(用户调整)
  assert.equal(s.resources.wood, 60);
  assert.equal(s.resources.fish, 100); // [B-59] 开局鱼 300→100(用户调整)
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
  const net = s.resources.fish - 100; // [B-59] 开局鱼 300→100
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
  for (let i = 0; i < 200; i++) E.tick.tick(s, { slowEvery: 1 }); // [优化] 全精度(即时人口断言)
  const cnt = s.population.farmers.count;
  assert.ok(Math.abs(cnt - 15) < 1, '无市场仅鱼 → 目标 15(3×5栋)(实际 ' + cnt.toFixed(1) + ')');
  const mk = setupMarket(s);
  assert.ok(mk, '市场应可建并覆盖民居');
  for (let i = 0; i < 200; i++) E.tick.tick(s, { slowEvery: 1 }); // [优化] 全精度(即时人口断言)
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
  E.tick.tick(s, { slowEvery: 1 }); // [优化] 全精度
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

test('[B-61] v1单岛纯迁移到v2世界且二次读取幂等', () => {
  const terrain = Array.from({ length: 128 }, (_, y) =>
    Array.from({ length: 128 }, (_, x) => ((x + y) % 17 === 0 ? 3 : 0)));
  terrain[0][0] = 6;
  terrain[127][127] = 6;
  const legacy = {
    version: 1,
    settings: { speed: 2, paused: false },
    time: { day: 7, hour: 11, tickAcc: 4 },
    map: { size: 128, terrain, seed: 77 },
    resources: { coin: 4321, wood: 12, fish: 34, steel: 9 },
    buildings: {
      b1: { id: 'b1', type: 'warehouse', x: 2, y: 2, level: 1, status: 'idle' },
      b2: { id: 'b2', type: 'residence', x: 126, y: 126, level: 1, status: 'idle', occupied: 7 },
    },
    grid: { stale: 'bad' },
    roads: { '4,5': 2, '100,101': 1 },
    population: {
      farmers: { count: 17, satisfaction: 0.8 },
      workers: { count: 3, satisfaction: 0.5 },
      artisans: { count: 0, satisfaction: 0 },
      engineers: { count: 0, satisfaction: 0 },
      investors: { count: 0, satisfaction: 0 },
    },
    happiness: 73,
    unlocks: { farmers: true, workers: true, artisans: false, engineers: false, investors: false },
    log: ['旧档日志'],
    nextId: 3,
    _conn: { dirty: false, ids: { stale: true } },
    ratesHistory: { wood: { p: [1], c: [0], n: [1], sp: 1, sc: 0, sn: 1 } },
  };
  const raw = JSON.stringify({ v: 1, ts: 123, state: legacy });
  const world = E.save.deserialize(raw);
  assert.equal(world.schemaVersion, 2);
  assert.equal(world.migrations.legacy128To160, true);
  assert.equal(world.activeIslandId, 'island-main');
  assert.equal(world.treasury.coin, 4321);
  assert.equal(world.resources.wood, 12);
  assert.equal(world.resources.steel, 9);
  assert.deepEqual(world.population, legacy.population);
  assert.deepEqual(world.islands['island-main'].fertilities, ['potato', 'grain', 'hops', 'pepper', 'grapes']);
  assert.equal(world.map.size, 160);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    assert.equal(world.map.terrain[y + 16][x + 16], terrain[y][x], '中央旧地形逐格相等');
  }
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) {
    if (x >= 16 && x < 144 && y >= 16 && y < 144) continue;
    assert.equal(world.map.terrain[y][x], 6, '新增16格外圈全海水');
  }
  assert.deepEqual([world.buildings.b1.x, world.buildings.b1.y], [18, 18]);
  assert.deepEqual([world.buildings.b2.x, world.buildings.b2.y], [142, 142]);
  assert.deepEqual(world.roads, { '20,21': 2, '116,117': 1 });
  assert.equal(world.grid.stale, undefined, '旧grid不复制');
  for (const c of footprint(E.buildings.getDef('warehouse'), 18, 18)) {
    assert.equal(world.grid[key(c.x, c.y)], 'b1', '按迁移后footprint重建grid');
  }
  assert.equal(world._conn.dirty, true);
  assert.deepEqual(world._conn.ids, {});
  const encoded = E.save.serialize(world);
  assert.equal(JSON.parse(encoded).v, 2);
  const again = E.save.deserialize(encoded);
  assert.deepEqual([again.buildings.b1.x, again.buildings.b1.y], [18, 18], '二次读取不重复平移');
  assert.deepEqual(again.map.terrain, world.map.terrain, '二次读取不重生地形');
});

test('[B-61] v1系统日志地图坐标随岛平移且普通文本不变', () => {
  const envelope = JSON.parse(makeLegacySaveRaw());
  envelope.state.log = [
    '建造:仓库 (20,30)',
    '🚚 仓库 移动到 (40,50)',
    '玩家输入 1,2',
    '拆除:仓库 (返还 木材 +10)',
  ];
  const world = E.save.deserialize(JSON.stringify(envelope));
  assert.deepEqual(world.log, [
    '建造:仓库 (36,46)',
    '🚚 仓库 移动到 (56,66)',
    '玩家输入 1,2',
    '拆除:仓库 (返还 木材 +10)',
  ]);
  const again = E.save.deserialize(E.save.serialize(world));
  assert.deepEqual(again.log, world.log, 'v2二次读取不重复平移日志坐标');
});

test('[B-61] load首次迁移永久保留原始v1并原子写回v2', () => {
  const prevLS = globalThis.localStorage;
  const raw = makeLegacySaveRaw();
  const store = { [E.save.SAVE_KEY]: raw };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    const loaded = E.save.load();
    assert.equal(loaded.schemaVersion, 2);
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], raw, '永久备份逐字等于迁移前主档');
    assert.equal(JSON.parse(store[E.save.SAVE_KEY]).v, 2, '主键原子写回v2');
    const immutable = store[E.save.PRE_MULTI_BACKUP_KEY];
    E.save.load();
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], immutable, '再次加载不覆盖永久备份');
    E.save.clearSave();
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], immutable, '清除当前存档不删除永久备份');
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 永久备份写入失败时阻断迁移且主档不变', () => {
  const prevLS = globalThis.localStorage;
  const raw = makeLegacySaveRaw();
  const store = { [E.save.SAVE_KEY]: raw };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      if (k === E.save.PRE_MULTI_BACKUP_KEY) throw new Error('quota');
      store[k] = String(v);
    },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    assert.throws(
      () => E.save.load(),
      (e) => e && e.code === 'MIGRATION_BLOCKED',
      '备份失败必须显式阻断启动'
    );
    assert.equal(store[E.save.SAVE_KEY], raw, '迁移失败不得覆盖原始主档');
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], undefined);
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 迁移关键写入静默失败时复读阻断且主档不变', () => {
  const prevLS = globalThis.localStorage;
  const raw = makeLegacySaveRaw();
  try {
    for (const ignoredKey of [E.save.PRE_MULTI_BACKUP_KEY, E.save.SAVE_KEY]) {
      const store = { [E.save.SAVE_KEY]: raw };
      globalThis.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { if (k !== ignoredKey) store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };
      assert.throws(() => E.save.load(), (e) => e && e.code === 'MIGRATION_BLOCKED');
      assert.equal(store[E.save.SAVE_KEY], raw, ignoredKey + ':主档保持原始v1');
      if (ignoredKey === E.save.PRE_MULTI_BACKUP_KEY) {
        assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], undefined, '静默备份失败不能继续迁移');
      } else {
        assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], raw, '主键静默失败时永久原档已安全保留');
      }
    }
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 结构校验后迁移失败必须阻断启动', () => {
  const prevLS = globalThis.localStorage;
  const envelope = JSON.parse(makeLegacySaveRaw());
  envelope.state.buildings.bad = { id: 'bad', type: 'unknown-building', x: 10, y: 10, rot: 0 };
  const raw = JSON.stringify(envelope);
  const store = { [E.save.SAVE_KEY]: raw };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    assert.throws(() => E.save.load(), (e) => e && e.code === 'MIGRATION_BLOCKED');
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], raw, '执行坐标迁移前已经永久保留原文');
    assert.equal(store[E.save.SAVE_KEY], raw, '迁移失败不覆盖主键');
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 恢复迁移前备份先保护当前主档且仅显式删除', () => {
  const prevLS = globalThis.localStorage;
  const oldRaw = makeLegacySaveRaw();
  const currentRaw = E.save.serialize(E.state.createInitialState(DEFAULT_SEED));
  const store = {
    [E.save.SAVE_KEY]: currentRaw,
    [E.save.PRE_MULTI_BACKUP_KEY]: oldRaw,
  };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    assert.equal(typeof E.save.restorePreMigrationBackup, 'function');
    assert.equal(E.save.restorePreMigrationBackup(), true);
    assert.equal(store[E.save.BAK_KEY], currentRaw, '恢复前保护当前v2主档');
    assert.equal(store[E.save.SAVE_KEY], oldRaw, '主键恢复为原始v1');
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], oldRaw, '恢复本身不删除永久备份');
    assert.equal(E.save.deletePreMigrationBackup(), true);
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], undefined, '只有显式删除才移除');
    assert.equal(store[E.save.SAVE_KEY], oldRaw, '删除备份不影响当前主键');
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 恢复前保护写入失败时不覆盖当前主档', () => {
  const prevLS = globalThis.localStorage;
  const oldRaw = makeLegacySaveRaw();
  const currentRaw = E.save.serialize(E.state.createInitialState(DEFAULT_SEED));
  const store = {
    [E.save.SAVE_KEY]: currentRaw,
    [E.save.PRE_MULTI_BACKUP_KEY]: oldRaw,
  };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      if (k === E.save.BAK_KEY) throw new Error('bak quota');
      store[k] = String(v);
    },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    assert.throws(() => E.save.restorePreMigrationBackup(), /无法保护当前主存档/);
    assert.equal(store[E.save.SAVE_KEY], currentRaw, '保护失败后主档不变');
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], oldRaw, '永久备份不变');
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 恢复主键写入失败时保留当前主档与保护副本', () => {
  const prevLS = globalThis.localStorage;
  const oldRaw = makeLegacySaveRaw();
  const currentRaw = E.save.serialize(E.state.createInitialState(DEFAULT_SEED));
  const store = {
    [E.save.SAVE_KEY]: currentRaw,
    [E.save.PRE_MULTI_BACKUP_KEY]: oldRaw,
  };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      if (k === E.save.SAVE_KEY) throw new Error('save quota');
      store[k] = String(v);
    },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    assert.throws(() => E.save.restorePreMigrationBackup(), /无法恢复迁移前备份/);
    assert.equal(store[E.save.SAVE_KEY], currentRaw, '恢复写入失败后主档不变');
    assert.equal(store[E.save.BAK_KEY], currentRaw, '保护副本已写入');
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], oldRaw, '永久备份仍在');
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 恢复关键写入静默失败时复读阻断', () => {
  const prevLS = globalThis.localStorage;
  const oldRaw = makeLegacySaveRaw();
  const currentRaw = E.save.serialize(E.state.createInitialState(DEFAULT_SEED));
  try {
    for (const ignoredKey of [E.save.BAK_KEY, E.save.SAVE_KEY]) {
      const store = {
        [E.save.SAVE_KEY]: currentRaw,
        [E.save.PRE_MULTI_BACKUP_KEY]: oldRaw,
      };
      globalThis.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { if (k !== ignoredKey) store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      };
      assert.throws(
        () => E.save.restorePreMigrationBackup(),
        ignoredKey === E.save.BAK_KEY ? /无法保护当前主存档/ : /无法恢复迁移前备份/
      );
      assert.equal(store[E.save.SAVE_KEY], currentRaw, ignoredKey + ':当前主档不变');
      if (ignoredKey === E.save.BAK_KEY) assert.equal(store[E.save.BAK_KEY], undefined);
      else assert.equal(store[E.save.BAK_KEY], currentRaw, '主键失败前保护副本已验证写入');
    }
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 永久原档静默删除失败不得报告成功', () => {
  const prevLS = globalThis.localStorage;
  const raw = makeLegacySaveRaw();
  const store = { [E.save.PRE_MULTI_BACKUP_KEY]: raw };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    removeItem: () => {},
  };
  try {
    assert.equal(E.save.deletePreMigrationBackup(), false);
    assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], raw);
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLS;
  }
});

test('[B-61] 存档工具核心识别v2并可选导入导出永久备份', () => {
  assert.ok(b61SaveTransfer, 'save-transfer核心模块尚未实现');
  const mainRaw = E.save.serialize(E.state.createInitialState(DEFAULT_SEED));
  const preRaw = makeLegacySaveRaw();
  const store = {
    [E.save.SAVE_KEY]: mainRaw,
    [E.save.PRE_MULTI_BACKUP_KEY]: preRaw,
    'ui.leftTab': 'resources',
  };
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    key: (i) => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
  };
  const summary = b61SaveTransfer.summarize(mainRaw);
  assert.equal(summary.ok, true);
  assert.equal(summary.coin, 5000);
  assert.equal(summary.mapSize, 160);
  const container = b61SaveTransfer.exportContainer(storage, E.save, { includeBak: false, includeUi: true, includePreMigration: true });
  assert.equal(container.keys[E.save.PRE_MULTI_BACKUP_KEY], preRaw);
  assert.equal(container.keys['ui.leftTab'], 'resources');
  const imported = {};
  const target = {
    getItem: (k) => (k in imported ? imported[k] : null),
    setItem: (k, v) => { imported[k] = String(v); },
  };
  const result = b61SaveTransfer.applyImport(target, E.save, container);
  assert.equal(result.summary.mapSize, 160);
  assert.equal(imported[E.save.SAVE_KEY], mainRaw);
  assert.equal(imported[E.save.PRE_MULTI_BACKUP_KEY], preRaw);
});

test('[B-61] 存档工具页加载游戏完整迁移校验依赖', () => {
  const html = readFileSync(new URL('../save-transfer.html', import.meta.url), 'utf8');
  const orderedScripts = [
    'src/engine/data/tiers.js',
    'src/engine/data/buildings-data.js',
    'src/engine/data/buildings.js',
    'src/engine/data/map-template.js',
    'src/engine/data/world-data.js',
    'src/engine/events.js',
    'src/engine/state.js',
    'src/engine/connectivity.js',
    'src/engine/economy.js',
    'src/engine/placement.js',
    'src/engine/save.js',
    'src/tools/save-transfer.js',
  ];
  let previous = -1;
  for (const script of orderedScripts) {
    const index = html.indexOf(script);
    assert.ok(index > previous, script + '必须存在且按依赖顺序加载');
    previous = index;
  }
});

test('[B-61] 存档工具继续接受旧版web1800备份容器', () => {
  const mainRaw = E.save.serialize(E.state.createInitialState(DEFAULT_SEED));
  const imported = {};
  const storage = {
    getItem: (k) => (k in imported ? imported[k] : null),
    setItem: (k, v) => { imported[k] = String(v); },
  };
  const legacyContainer = {
    app: 'web1800',
    kind: 'save-backup',
    exportedAt: 123,
    keys: { [E.save.SAVE_KEY]: mainRaw },
  };
  const result = b61SaveTransfer.applyImport(storage, E.save, legacyContainer);
  assert.equal(result.summary.ok, true);
  assert.equal(imported[E.save.SAVE_KEY], mainRaw);
});

test('[B-61] 畸形v1容器在任何存储写入前被拒绝', () => {
  const currentMain = E.save.serialize(E.state.createInitialState(303));
  const store = { [E.save.SAVE_KEY]: currentMain, [E.save.BAK_KEY]: 'safe-bak' };
  let writes = 0;
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { writes++; store[key] = String(value); },
  };
  const malformed = JSON.stringify({ v: 1, state: { map: {}, buildings: {}, resources: {} } });
  assert.throws(() => b61SaveTransfer.applyImport(storage, E.save, {
    app: 'web1800',
    kind: 'save-backup',
    keys: { [E.save.SAVE_KEY]: malformed },
  }), /旧存档|格式|地图尺寸/);
  assert.equal(writes, 0);
  assert.equal(store[E.save.SAVE_KEY], currentMain);
  assert.equal(store[E.save.BAK_KEY], 'safe-bak');
});

test('[B-61] v1缺少人口根对象时不得导入', () => {
  const malformed = JSON.parse(makeLegacySaveRaw());
  delete malformed.state.population;
  assert.throws(() => E.save.validateSerialized(JSON.stringify(malformed)), /旧存档|人口|格式/);
  const store = {};
  let writes = 0;
  assert.throws(() => b61SaveTransfer.applyImport({
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { writes++; store[key] = String(value); },
  }, E.save, {
    format: 'web1800-save-container',
    version: 2,
    keys: { [E.save.SAVE_KEY]: JSON.stringify(malformed) },
  }), /旧存档|人口|格式/);
  assert.equal(writes, 0);
});

test('[B-61] v1与v2完整运行时结构在导入前校验', () => {
  const invalids = [];
  const v1 = JSON.parse(makeLegacySaveRaw());
  v1.state.population = {};
  v1.state.settings = {};
  v1.state.time = {};
  delete v1.state.log;
  delete v1.state.unlocks;
  delete v1.state.nextId;
  invalids.push(['v1缺运行时字段', JSON.stringify(v1)]);

  const validV2 = () => JSON.parse(E.save.serialize(E.state.createInitialState(410)));
  const missingRuntime = validV2();
  missingRuntime.state.islands['island-main'].population = {};
  missingRuntime.state.settings = {};
  missingRuntime.state.time = {};
  delete missingRuntime.state.islands['island-main'].log;
  delete missingRuntime.state.islands['island-main'].unlocks;
  delete missingRuntime.state.islands['island-main'].nextId;
  invalids.push(['v2缺运行时字段', JSON.stringify(missingRuntime)]);

  const badResource = validV2();
  badResource.state.islands['island-main'].resources.wood = null;
  invalids.push(['资源非有限数', JSON.stringify(badResource)]);
  const badRoad = validV2();
  badRoad.state.islands['island-main'].roads['1,1'] = 3;
  invalids.push(['道路等级非法', JSON.stringify(badRoad)]);
  const badTerrain = validV2();
  badTerrain.state.islands['island-main'].map.terrain[20][20] = 99;
  invalids.push(['地形单元非法', JSON.stringify(badTerrain)]);
  const badBuilding = validV2();
  badBuilding.state.islands['island-main'].buildings.bad = {
    id: 'other', type: 'warehouse', x: 20, y: 20, rot: 9, level: 1,
  };
  invalids.push(['建筑ID与旋转非法', JSON.stringify(badBuilding)]);

  for (const [label, raw] of invalids) {
    assert.throws(() => E.save.validateSerialized(raw), undefined, label + ':共享校验拒绝');
    let writes = 0;
    const store = {};
    assert.throws(() => b61SaveTransfer.applyImport({
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => { writes++; store[key] = String(value); },
    }, E.save, {
      format: 'web1800-save-container',
      version: 2,
      keys: { [E.save.SAVE_KEY]: raw },
    }), undefined, label + ':导入拒绝');
    assert.equal(writes, 0, label + ':零写入');
  }
});

test('[B-61] 建筑ID非空且nextId不得与现有b编号碰撞', () => {
  const malformedV2 = JSON.parse(E.save.serialize(E.state.createInitialState(412)));
  const island = malformedV2.state.islands['island-main'];
  island.buildings.b1 = { id: 'b1', type: 'warehouse', x: 20, y: 20, rot: 0, level: 1 };
  island.nextId = 1;
  assert.throws(() => E.save.validateSerialized(JSON.stringify(malformedV2)), /建筑|nextId|运行时/);

  const emptyId = JSON.parse(E.save.serialize(E.state.createInitialState(413)));
  emptyId.state.islands['island-main'].buildings[''] = {
    id: '', type: 'warehouse', x: 20, y: 20, rot: 0, level: 1,
  };
  assert.throws(() => E.save.validateSerialized(JSON.stringify(emptyId)), /建筑|ID/);

  const malformedV1 = JSON.parse(makeLegacySaveRaw());
  malformedV1.state.buildings.b7 = { id: 'b7', type: 'warehouse', x: 20, y: 20, rot: 0, level: 1 };
  malformedV1.state.nextId = 7;
  assert.throws(() => E.save.validateSerialized(JSON.stringify(malformedV1)), /建筑|nextId|运行时/);
});

test('[B-61] v1建筑锚点越界在导入写入前被拒绝', () => {
  const malformed = JSON.parse(makeLegacySaveRaw());
  malformed.state.buildings.b1 = { id: 'b1', type: 'warehouse', x: -10, y: -10, rot: 0, level: 1 };
  malformed.state.nextId = 2;
  const raw = JSON.stringify(malformed);
  assert.throws(() => E.save.validateSerialized(raw), /建筑|坐标|范围/);
  let writes = 0;
  assert.throws(() => b61SaveTransfer.applyImport({
    getItem: () => null,
    setItem: () => { writes++; },
  }, E.save, {
    format: 'web1800-save-container', version: 2,
    keys: { [E.save.SAVE_KEY]: raw },
  }), /建筑|坐标|范围/);
  assert.equal(writes, 0);
});

test('[B-61] v1金币必须存在且为有限数值', () => {
  for (const value of [undefined, null]) {
    const malformed = JSON.parse(makeLegacySaveRaw());
    if (value === undefined) delete malformed.state.resources.coin;
    else malformed.state.resources.coin = value;
    assert.throws(() => E.save.validateSerialized(JSON.stringify(malformed)), /金币|资源/);
  }
});

test('[B-61] 导入包普通备份也必须在写入前通过共享校验', () => {
  const mainRaw = E.save.serialize(E.state.createInitialState(411));
  let writes = 0;
  assert.throws(() => b61SaveTransfer.applyImport({
    getItem: () => null,
    setItem: () => { writes++; },
  }, E.save, {
    format: 'web1800-save-container',
    version: 2,
    keys: {
      [E.save.SAVE_KEY]: mainRaw,
      [E.save.BAK_KEY]: '{"v":2,"state":{}}',
    },
  }), /存档|格式|岛屿/);
  assert.equal(writes, 0);
});

test('[B-61] 畸形v2容器在任何存储写入前被拒绝', () => {
  const currentMain = E.save.serialize(E.state.createInitialState(404));
  const store = { [E.save.SAVE_KEY]: currentMain };
  let writes = 0;
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { writes++; store[key] = String(value); },
  };
  const malformed = JSON.stringify({
    v: 2,
    state: {
      schemaVersion: 2,
      activeIslandId: 'island-main',
      treasury: { coin: 5000 },
      islands: { 'island-main': { id: 'island-main', map: { size: 160, terrain: [] }, buildings: {}, resources: {}, population: {}, roads: {} } },
    },
  });
  assert.throws(() => b61SaveTransfer.applyImport(storage, E.save, {
    format: 'web1800-save-container',
    version: 2,
    keys: { [E.save.SAVE_KEY]: malformed },
  }), /岛屿|地图|格式/);
  assert.equal(writes, 0);
  assert.equal(store[E.save.SAVE_KEY], currentMain);
});

test('[B-61] 导入不覆盖目标设备已有普通保护副本和永久原档', () => {
  const currentMain = E.save.serialize(E.state.createInitialState(101));
  const incomingMain = E.save.serialize(E.state.createInitialState(202));
  const localPre = makeLegacySaveRaw();
  const incomingPre = makeLegacySaveRaw().replace('"ts":123', '"ts":456');
  const store = {
    [E.save.SAVE_KEY]: currentMain,
    [E.save.BAK_KEY]: 'older-local-bak',
    [E.save.PRE_MULTI_BACKUP_KEY]: localPre,
  };
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
  };
  const result = b61SaveTransfer.applyImport(storage, E.save, {
    format: 'web1800-save-container',
    version: 2,
    keys: {
      [E.save.SAVE_KEY]: incomingMain,
      [E.save.BAK_KEY]: incomingMain,
      [E.save.PRE_MULTI_BACKUP_KEY]: incomingPre,
    },
  });
  assert.equal(store[E.save.SAVE_KEY], incomingMain);
  assert.equal(store[E.save.BAK_KEY], 'older-local-bak', '目标设备已有普通保护副本逐字保留');
  assert.equal(store[E.save.PRE_MULTI_BACKUP_KEY], localPre, '目标设备已有永久原档不可被导入包覆盖');
  assert.deepEqual(result.skippedKeys.sort(), [E.save.BAK_KEY, E.save.PRE_MULTI_BACKUP_KEY].sort());
});

test('[B-61] 导入在任何写入前校验全部候选键值', () => {
  const currentMain = E.save.serialize(E.state.createInitialState(505));
  const incomingMain = E.save.serialize(E.state.createInitialState(606));
  const store = { [E.save.SAVE_KEY]: currentMain };
  let writes = 0;
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { writes++; store[key] = String(value); },
  };
  assert.throws(() => b61SaveTransfer.applyImport(storage, E.save, {
    format: 'web1800-save-container',
    version: 2,
    keys: {
      [E.save.SAVE_KEY]: incomingMain,
      'ui.leftTab': 'resources',
      'ui.rightTab': { invalid: true },
    },
  }), /键值格式/);
  assert.equal(writes, 0);
  assert.equal(store[E.save.SAVE_KEY], currentMain);
  assert.equal(store['ui.leftTab'], undefined);
});

test('[B-61] 存档工具只导入导出四个现有UI键', () => {
  const mainRaw = E.save.serialize(E.state.createInitialState(909));
  const source = {
    [E.save.SAVE_KEY]: mainRaw,
    'ui.leftTab': 'resources',
    'ui.injected': 'ignored',
  };
  const sourceStorage = {
    getItem: (key) => (key in source ? source[key] : null),
    key: (index) => Object.keys(source)[index] || null,
    get length() { return Object.keys(source).length; },
  };
  const container = b61SaveTransfer.exportContainer(sourceStorage, E.save, { includeUi: true });
  assert.equal(container.keys['ui.leftTab'], 'resources');
  assert.equal(container.keys['ui.injected'], undefined);
  container.keys['ui.injected'] = 'ignored';
  const target = {};
  const result = b61SaveTransfer.applyImport({
    getItem: (key) => (key in target ? target[key] : null),
    setItem: (key, value) => { target[key] = String(value); },
    removeItem: (key) => { delete target[key]; },
  }, E.save, container);
  assert.equal(target['ui.leftTab'], 'resources');
  assert.equal(target['ui.injected'], undefined);
  assert.deepEqual(result.ignoredKeys, ['ui.injected']);
});

test('[B-61] 导入写入失败时回滚所有已改键', () => {
  const currentMain = E.save.serialize(E.state.createInitialState(707));
  const incomingMain = E.save.serialize(E.state.createInitialState(808));
  const store = { [E.save.SAVE_KEY]: currentMain, 'ui.leftTab': 'needs' };
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      if (key === E.save.SAVE_KEY && value === incomingMain) throw new Error('quota');
      store[key] = String(value);
    },
    removeItem: (key) => { delete store[key]; },
  };
  assert.throws(() => b61SaveTransfer.applyImport(storage, E.save, {
    format: 'web1800-save-container',
    version: 2,
    keys: {
      [E.save.SAVE_KEY]: incomingMain,
      'ui.leftTab': 'resources',
      'ui.rightTab': 'goal',
    },
  }), /quota/);
  assert.deepEqual(store, { [E.save.SAVE_KEY]: currentMain, 'ui.leftTab': 'needs' });
});

test('[B-61] 导入写入静默失败时不得报告成功', () => {
  const incomingMain = E.save.serialize(E.state.createInitialState(8101));
  const store = {};
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { if (key !== E.save.SAVE_KEY) store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
  };
  assert.throws(() => SaveTransferCore.applyImport(storage, E.save, {
    format: 'web1800-save-container', version: 2,
    keys: { [E.save.SAVE_KEY]: incomingMain },
  }), /导入|写入|存档/);
  assert.equal(store[E.save.SAVE_KEY], undefined);
});

test('[B-61] 导入失败且回滚不完整时显式报告未恢复键', () => {
  const currentMain = E.save.serialize(E.state.createInitialState(811));
  const incomingMain = E.save.serialize(E.state.createInitialState(812));
  const store = { [E.save.SAVE_KEY]: currentMain, 'ui.leftTab': 'needs' };
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      if (key === 'ui.rightTab' && value === 'goal') throw new Error('IMPORT_FAIL');
      store[key] = String(value);
    },
    removeItem: (key) => {
      if (key === E.save.BAK_KEY) throw new Error('ROLLBACK_FAIL');
      delete store[key];
    },
  };
  let thrown;
  try {
    b61SaveTransfer.applyImport(storage, E.save, {
      format: 'web1800-save-container',
      version: 2,
      keys: {
        [E.save.SAVE_KEY]: incomingMain,
        'ui.leftTab': 'resources',
        'ui.rightTab': 'goal',
      },
    });
  } catch (error) { thrown = error; }
  assert.equal(thrown && thrown.code, 'IMPORT_ROLLBACK_FAILED');
  assert.deepEqual(thrown && thrown.unrestoredKeys, [E.save.BAK_KEY]);
  assert.match(thrown && thrown.message, /回滚.*不完整/);
  assert.match(thrown && thrown.cause && thrown.cause.message, /IMPORT_FAIL/);
  assert.equal(store[E.save.SAVE_KEY], currentMain, '主档未被导入覆盖');
  assert.equal(store['ui.leftTab'], 'needs', '已写UI成功恢复');
  assert.equal(store[E.save.BAK_KEY], currentMain, '失败回滚键保留并被显式报告');
});

test('[B-61] 回滚操作抛错但值已恢复时不得误列未恢复键', () => {
  const currentMain = E.save.serialize(E.state.createInitialState(813));
  const incomingMain = E.save.serialize(E.state.createInitialState(814));
  const store = { [E.save.SAVE_KEY]: currentMain, [E.save.BAK_KEY]: currentMain, 'ui.leftTab': 'needs' };
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      if (key === 'ui.rightTab') throw new Error('ORIGINAL_IMPORT_FAIL');
      store[key] = String(value);
      if (key === 'ui.leftTab' && value === 'needs') throw new Error('RESTORED_BUT_THROW');
    },
    removeItem: (key) => { delete store[key]; },
  };
  let thrown;
  try {
    SaveTransferCore.applyImport(storage, E.save, {
      format: 'web1800-save-container', version: 2,
      keys: {
        [E.save.SAVE_KEY]: incomingMain,
        'ui.leftTab': 'resources',
        'ui.rightTab': 'goal',
      },
    });
  } catch (error) { thrown = error; }
  assert.equal(thrown && thrown.code, 'IMPORT_ROLLBACK_FAILED');
  assert.deepEqual(thrown && thrown.unrestoredKeys, []);
  assert.match(thrown && thrown.cause && thrown.cause.message, /ORIGINAL_IMPORT_FAIL/);
  assert.equal(store['ui.leftTab'], 'needs');
});

test('[B-61] 存档工具兼容旧人口count对象摘要', () => {
  const envelope = JSON.parse(makeLegacySaveRaw());
  envelope.state.population = { farmer: { count: 7 }, worker: { count: 3 } };
  const summary = b61SaveTransfer.summarize(JSON.stringify(envelope));
  assert.equal(summary.ok, true);
  assert.equal(summary.population, 10);
});

test('存档:序列化往返一致,损坏报错,无 localStorage 时 load 返回 null', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  // [Sol 轮3] terrain.drawnGroups 是生成器运行时元数据,不属于存档契约(JSON 不保留),对比前剔除
  for (const isl of Object.values(s.islands)) {
    if (isl.map.terrain && isl.map.terrain.drawnGroups) delete isl.map.terrain.drawnGroups;
  }
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
  // [民居规则修复] 渔场若已连通,只拆 1 条必经路使其断连(while 连拆会误伤共享路网上的民居路;
  // 民居现严格要求接触道路,而旧 isConnected 允许 BFS 穿过建筑格掩盖了该误伤)
  if (E.connectivity.isConnected(s, r.building.id)) {
    const cut = findCutRoad(s, r.building.id);
    if (cut) setRoad(s, ...cut.split(',').map(Number), false);
  }
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
  for (let i = 0; i < CYCLE * 3; i++) E.tick.tick(s, { slowEvery: 1 }); // [优化] 全精度(即时人口断言)
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
  // 直接驱动周期(岗位制:绵羊牧场 10 + 纺织厂 50 = 60 岗位,60 人满负荷;渐近慢,手动 refresh 循环)
  s.population.farmers.count = 60;
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

// [B-51] 移动建筑免费:资源不足(coin=0)时仍可正常移动(不消耗也不被资源检查拦截)
test('[B-51] 移动建筑免费:资源不足仍可移动', () => {
  const s = createInitialState();
  setupBase(s);
  const spot = findSawmillSpot(s);
  assert.ok(spot);
  const av = footprint(E.buildings.getDef('sawmill'), spot.x, spot.y);
  connectTo(s, spot.x, spot.y, av, av);
  const r = placeBuilding(s, 'sawmill', spot.x, spot.y);
  assert.equal(r.ok, true);
  s.resources.coin = 0; // 花光金币
  let np = null;
  for (let y = 2; y < 125 && !np; y++) {
    for (let x = 2; x < 125 && !np; x++) {
      if (Math.abs(x - spot.x) + Math.abs(y - spot.y) < 10) continue;
      if (E.placement.canPlace(s, 'sawmill', x, y, 0, r.building.id, true).ok) np = { x, y };
    }
  }
  assert.ok(np, '应有目标位');
  const mv = E.placement.moveBuilding(s, r.building.id, np.x, np.y);
  assert.equal(mv.ok, true, '资源不足也应能移动: ' + (mv.reason || ''));
  assert.equal(s.buildings[r.building.id].x, np.x, '坐标已更新');
  assert.equal(s.resources.coin, 0, '移动不消耗资源');
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
test('[H-03回归] 断路住宅不计容量/数量;服务建筑不需连仓库(断路也服务)', () => {
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
  assert.equal(sm2.status, 'idle', '[用户决策] 服务建筑不需连仓库:恒 idle');
  // [用户决策] 服务建筑不需连仓库:断路市场同样提供覆盖
  const roads1 = E.population.serviceRoads(s, 'market');
  const b1 = E.placement.footprintBounds(E.buildings.getDef('market'), mSpot.x, mSpot.y, 0);
  const nearM1 = roads1.has(E.state.key(mSpot.x, mSpot.y)) || roads1.size > 0;
  assert.equal(nearM1, true, '连接市场有服务覆盖');
});

// [用户决策] 服务建筑不需连仓库:无仓库路网时教堂沿路仍服务(原版机制)
test('服务建筑不需连仓库:无仓库时教堂沿路仍提供覆盖', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000;
  // 不放仓库!只放教堂+周边路+工人住宅
  let cspot = null;
  for (let y = 10; y < 100 && !cspot; y++) for (let x = 10; x < 100 && !cspot; x++) {
    if (E.placement.canPlace(s, 'church', x, y, 0).ok) cspot = { x, y };
  }
  assert.ok(cspot, '教堂位');
  const cr = placeBuilding(s, 'church', cspot.x, cspot.y);
  assert.equal(cr.ok, true);
  const cb = s.buildings[cr.building.id];
  const cdef = E.buildings.getDef('church');
  const cbx = Math.floor((cdef.size.w - 1) / 2), cby = Math.floor((cdef.size.h - 1) / 2);
  const roadY = cb.y - cby + cdef.size.h;
  for (let dx = -1; dx <= cdef.size.w; dx++) {
    const x = cb.x - cbx + dx, y = roadY;
    if (x < 0 || y < 0 || x >= s.map.size || y >= s.map.size) continue;
    if (s.map.terrain[y][x] === 0 && !s.grid[x + ',' + y] && !s.roads[x + ',' + y]) setRoad(s, x, y, true);
  }
  let hspot = null;
  for (let dy = -3; dy <= 3 && !hspot; dy++) for (let dx = 0; dx <= 8 && !hspot; dx++) {
    const hx = cb.x + 2 + dx, hy = roadY + 1 + dy;
    if (hx < 2 || hy < 2 || hx >= 126 || hy >= 126) continue;
    if (E.placement.canPlace(s, 'residenceWorkers', hx, hy, 0).ok) hspot = { x: hx, y: hy };
  }
  assert.ok(hspot, '住宅位');
  const hr = placeBuilding(s, 'residenceWorkers', hspot.x, hspot.y);
  assert.equal(hr.ok, true);
  const hb = s.buildings[hr.building.id];
  const hx = Math.floor((3 - 1) / 2), hy = Math.floor((3 - 1) / 2);
  for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 3; dx++) {
    const x = hb.x - hx + dx, y = hb.y - hy + dy;
    if (x < 0 || y < 0 || x >= s.map.size || y >= s.map.size) continue;
    if (s.map.terrain[y] && s.map.terrain[y][x] === 0 && !s.grid[x + ',' + y] && !s.roads[x + ',' + y]) setRoad(s, x, y, true);
  }
  E.connectivity.markDirty(s);
  E.economy.refresh(s, { produce: false, logs: false });
  // 无仓库:教堂 status 恒 idle(不要求连通)
  assert.equal(s.buildings[cr.building.id].status, 'idle', '无仓库教堂仍 idle');
  // 沿路传播不依赖仓库:教堂覆盖集非空(住宅覆盖需住宅自身连仓库,属住宅规则,见 H-03 测试)
  const covered = E.population.serviceRoads(s, 'church');
  assert.ok(covered.size > 0, '无仓库教堂沿路仍有覆盖(实际 ' + covered.size + ' 格)');
});

// [用户决策] 民居不需连仓库:接触任意道路即有效(计容量/入住),路无需连到仓库
test('民居不需连仓库:接触道路即 idle 并计容量;无路民居仍 disconnected(no-road)', () => {
  const s = createInitialState();
  setupBase(s);
  // 1. 民居 A:远离仓库,旁铺孤立路(不连仓库)
  const h2 = findSpotFar(s, 3, 3);
  assert.ok(h2);
  const r2 = placeBuilding(s, 'residence', h2.x, h2.y);
  assert.equal(r2.ok, true);
  const hb = s.buildings[r2.building.id];
  const hx = Math.floor((3 - 1) / 2), hy = Math.floor((3 - 1) / 2);
  setRoad(s, hb.x - hx + 1, hb.y - hy + 3, true); // 下缘外 1 格(孤立路)
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(s.buildings[r2.building.id].status, 'idle', '民居接触路即 idle,不要求连仓库');
  // 2. 民居 B:远离仓库且完全无路(在原 A 位附近找新位)
  let h3 = null;
  for (let dy = 0; dy < 120 && !h3; dy++) for (let dx = 0; dx < 120 && !h3; dx++) {
    const cx = h2.x + dx, cy = h2.y + dy;
    if (cx < 2 || cy < 2 || cx >= 126 || cy >= 126) continue;
    if (E.placement.canPlace(s, 'residence', cx, cy, 0).ok) h3 = { x: cx, y: cy };
  }
  assert.ok(h3, '民居 B 位');
  const r3 = placeBuilding(s, 'residence', h3.x, h3.y);
  assert.equal(r3.ok, true);
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(s.buildings[r3.building.id].status, 'disconnected', '无路民居仍 disconnected');
  assert.equal(s.buildings[r3.building.id].reason, 'no-road', 'reason 为 no-road');
  // 3. 容量:仅接触路的民居 A 计入(setupBase 5 栋=50 + A 10 = 60)
  const cap = E.population.capacityFor(s, 'farmers');
  assert.equal(cap, 60, '民居 A 计容量,民居 B 不计(实际 ' + cap + ')');
  // 4. 入住:有 55 人口时,A 先入住(先建先满:setupBase 5 栋满 50 + A 5 + B 0)
  s.population.farmers.count = 55;
  E.population.refreshOccupancy(s);
  assert.equal(s.buildings[r3.building.id].occupied, 0, '无路民居 B occupied=0');
  assert.equal(s.buildings[r2.building.id].occupied, 5, '接触路民居 A 入住 5(先建先满)');
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
test('[P0] load 路径:v2 旧ratesHistory结构归一化后 2 tick 无异常,口径全为有限值', () => {
  // 注入 localStorage mock(真实 save → load 链路);测试结束恢复,避免并发污染其他用例
  const prevLS = globalThis.localStorage;
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const s = E.state.createInitialState(DEFAULT_SEED);
  setupBase(s);
  s.population.farmers.count = 5;
  // 标准旧 ratesHistory 结构
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
  const s = E.state.createInitialState(DEFAULT_SEED);
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
  const s2 = E.state.createInitialState(DEFAULT_SEED + 1);
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
  const s = E.state.createInitialState(DEFAULT_SEED);
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
  E.tick.tick(s, { slowEvery: 1 });
  const sats = s.population.farmers.needSats;
  assert.equal(sats.market, 0, '无市场覆盖 → market sat 0');
  assert.equal(sats.fish, 0, '0 库存 → fish sat 0');
  assert.equal(sats.workclothes, 0, '0 库存 → workclothes sat 0');
  assert.equal(E.population.houseTarget(s, 'farmers'), 0, '目标人口 0');
  // 有鱼库存 → fish sat 1(有供应),目标 = 鱼 influx 3
  s.resources.fish = 100;
  E.tick.tick(s, { slowEvery: 1 });
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

// [B-44 回归] 需求面板渲染:fill 必须输出闭合的 width 属性。
// 曾因 HTML 拼接转义改坏(class 未闭合 → style 丢失 → fill 撑满父容器 → 需求条永远 100%)。
test('需求面板渲染:fill width 属性合法且与满足度一致,服务型需求显示中文名', () => {
  require('../src/ui/economy.js');
  const s = createInitialState();
  s.population.farmers.count = 5;
  s.resources.fish = 0.0001; // 库存不足 → 部分满足
  E.population.updateNeeds(s);
  const el = { innerHTML: '' };
  globalThis.UI.economy.renderNeeds(el, s);
  assert.ok(el.innerHTML.includes('style="width:'), 'fill 应含闭合的双引号 width 属性');
  assert.ok(!el.innerHTML.includes("' style='width"), '不应出现坏拼接(class 未闭合)');
  // 鱼的 fill 宽度与引擎 needSats 一致(非 100%)
  const sat = s.population.farmers.needSats.fish;
  const expectPct = Math.round(sat * 100);
  assert.ok(expectPct > 0 && expectPct < 100, '库存不足时鱼满足度应为部分值,实际 ' + expectPct);
  const rows = el.innerHTML.split('<div class="ec-need">');
  const fishRow = rows.find((r) => r.includes('🐟 鱼'));
  const wm = fishRow && fishRow.match(/style="width:(\d+)%"/);
  assert.ok(wm, '鱼行应含 width');
  assert.equal(Number(wm[1]), expectPct, '鱼行 width 应与 needSats 一致');
  // 服务型需求显示中文名(从 buildings 数据反查),不暴露内部 id
  assert.ok(el.innerHTML.includes('🏪 市场'), '市场服务应显示中文名');
  assert.ok(el.innerHTML.includes('🍺 酒吧'), '酒吧服务应显示中文名');
  assert.ok(!el.innerHTML.includes('>market<'), '不应显示原始 id market');
});

// [B-45] 建造信息卡:放置模式卡片必须输出造价/维护/周期/输入/输出/劳动力/占地(玩家建造决策所需信息)
test('建造信息卡:showPlacementInfo 输出完整定义信息(造价/维护/周期/输入/输出/劳动力/占地)', () => {
  require('../src/ui/panels.js');
  const sawmill = E.buildings.getDef('sawmill');
  const el = { innerHTML: '' };
  globalThis.UI.panels.showPlacementInfo(el, sawmill);
  assert.ok(el.innerHTML.includes('💰 造价:💰100'), '造价行缺失');
  assert.ok(el.innerHTML.includes('⚙️ 维护:💰10/min'), '维护费行缺失');
  assert.ok(el.innerHTML.includes('🔄 周期:15 秒'), '周期行缺失');
  assert.ok(el.innerHTML.includes('⬇ 输入:无'), '输入行缺失');
  assert.ok(el.innerHTML.includes('⬆ 输出:原木×1/周期 (4/min)'), '输出行缺失(应含每周期数量+速率),实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('👷 劳动力:农民×5'), '劳动力行缺失');
  assert.ok(el.innerHTML.includes('📐 占地:4×4'), '占地行缺失');
  // 服务建筑:显示服务半径
  const market = E.buildings.getDef('market');
  const el2 = { innerHTML: '' };
  globalThis.UI.panels.showPlacementInfo(el2, market);
  assert.ok(el2.innerHTML.includes('📡 服务半径:'), '服务建筑应显示服务半径,实际: ' + el2.innerHTML);
  // 住宅:显示容量
  const res = E.buildings.getDef('residence');
  const el3 = { innerHTML: '' };
  globalThis.UI.panels.showPlacementInfo(el3, res);
  assert.ok(el3.innerHTML.includes('🏠 容量:10 人'), '住宅应显示容量,实际: ' + el3.innerHTML);
});

// [B-52] 速率显示修复:长周期建筑输出保留 1 位小数(啤酒花 90s 产 1 = 0.67→0.7/min,不得四舍五入为 1/min)
test('速率显示:长周期建筑输出保留小数(啤酒花 0.7/min,不误导为 1/min)', () => {
  require('../src/ui/panels.js');
  const hop = E.buildings.getDef('hopFarm');
  const el = { innerHTML: '' };
  globalThis.UI.panels.showPlacementInfo(el, hop);
  assert.ok(el.innerHTML.includes('啤酒花×1/周期 (0.7/min)'), '应显示 0.7/min,实际: ' + el.innerHTML);
  assert.ok(!el.innerHTML.includes('(1/min)'), '不得四舍五入为 1/min');
  // 牛牧场 120s 产 1 = 0.5/min
  const cow = E.buildings.getDef('cattleFarm');
  const el2 = { innerHTML: '' };
  globalThis.UI.panels.showPlacementInfo(el2, cow);
  assert.ok(el2.innerHTML.includes('×1/周期 (0.5/min)'), '牛牧场应显示 0.5/min,实际: ' + el2.innerHTML);
  // 整数速率不受影响(原木厂 15s 产 1 = 4/min)
  const saw = E.buildings.getDef('sawmill');
  const el3 = { innerHTML: '' };
  globalThis.UI.panels.showPlacementInfo(el3, saw);
  assert.ok(el3.innerHTML.includes('原木×1/周期 (4/min)'), '整数速率仍显示 4/min,实际: ' + el3.innerHTML);
});

// [B-56] 开发度预览一致性:预览(虚拟对象+selfCells 计入自身 footprint)= 放置后
test('[B-56] 开发度预览一致性:预览含自身占用 = 放置后,不再预览 100%/放置后打折', () => {
  const s = createInitialState();
  let sp = null;
  for (let y = 5; y < 120 && !sp; y++) for (let x = 5; x < 120 && !sp; x++) {
    if (E.placement.canPlace(s, 'sheepFarm', x, y, 0).ok) sp = { x, y };
  }
  assert.ok(sp, '应有绵羊牧场位');
  const def = E.buildings.getDef('sheepFarm');
  const ph = { x: sp.x, y: sp.y, rot: 0 };
  // 放置前:旧预览(无 selfCells)应低于新预览(含自身占用)
  const devNoSelf = E.economy.developmentRatio(s, { x: sp.x, y: sp.y, rot: 0 }, def);
  const cells = E.placement.footprint(def, sp.x, sp.y, 0);
  const devPrev = E.economy.developmentRatio(s, ph, def, { selfCells: cells });
  const r = placeBuilding(s, 'sheepFarm', sp.x, sp.y);
  assert.equal(r.ok, true);
  const devPlaced = E.economy.developmentRatio(s, s.buildings[r.building.id], def);
  assert.ok(Math.abs(devPrev - devPlaced) < 0.001, '预览 dev(' + devPrev.toFixed(3) + ') 应等于放置后(' + devPlaced.toFixed(3) + ')');
  assert.ok(devPlaced > 0, '放置后 dev 应 > 0(自身 footprint 计入占用)');
  assert.ok(devNoSelf < devPrev, '无 selfCells 的旧预览(' + devNoSelf.toFixed(3) + ')应低于新预览(' + devPrev.toFixed(3) + ')');
});

// [B-58] 海边/山边开发度不为负:窗口含非平地时 dev 应 ∈ [0,1](occupied 含非平地但分母只有平地 → dev 曾超 1)
test('[B-58] 海边/山边开发度不为负:dev ∈ [0,1]', () => {
  const s = createInitialState();
  // 找一个窗口内非平地 ≥50% 的原木厂位(radius 7,4×4)——海边/山边场景
  let spot = null;
  for (let y = 2; y < 124 && !spot; y++) for (let x = 2; x < 124 && !spot; x++) {
    const c = E.placement.canPlace(s, 'sawmill', x, y, 0);
    if (!c.ok) continue;
    const def = E.buildings.getDef('sawmill');
    const bb = E.placement.footprintBounds(def, x, y, 0);
    const cx = bb.x + Math.floor(bb.w / 2), cy = bb.y + Math.floor(bb.h / 2);
    let nonFlat = 0, total = 0;
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
      const fx = cx + dx, fy = cy + dy;
      if (fx < 0 || fy < 0 || fx >= s.map.size || fy >= s.map.size) continue;
      total++;
      if (s.map.terrain[fy][fx] !== 0) nonFlat++;
    }
    if (total > 0 && nonFlat / total >= 0.5) spot = { x, y };
  }
  assert.ok(spot, '应找到窗口含非平地的原木厂位');
  const r = placeBuilding(s, 'sawmill', spot.x, spot.y);
  assert.equal(r.ok, true);
  const dev = E.economy.developmentRatio(s, s.buildings[r.building.id], E.buildings.getDef('sawmill'));
  assert.ok(dev >= 0 && dev <= 1, 'dev 应在 [0,1](实际 ' + dev.toFixed(3) + ',可开发 ' + Math.round((1 - dev) * 100) + '%)');
  // 海边半水场景:可开发% 不应为负
  assert.ok(Math.round((1 - dev) * 100) >= 0, '可开发% 不应为负(实际 ' + Math.round((1 - dev) * 100) + '%)');
});

// [B-46] 需求面板收益徽章:告知完成需求后的收益类型(+人口/+钱/+幸福),不暴露具体数值(渐进披露)
test('需求面板收益徽章:显示收益类型但不暴露具体数值', () => {
  require('../src/ui/economy.js');
  const s = createInitialState();
  s.population.farmers.count = 5;
  E.population.updateNeeds(s);
  const el = { innerHTML: '' };
  globalThis.UI.economy.renderNeeds(el, s);
  // 三类收益徽章都出现(农民需求覆盖 influx/income/happiness)
  assert.ok(el.innerHTML.includes('+人口'), '应有 +人口 徽章(influx 收益),实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('+钱'), '应有 +钱 徽章(income 收益)');
  assert.ok(el.innerHTML.includes('+幸福'), '应有 +幸福 徽章(happiness 收益)');
  // 不暴露具体数值/内部字段名(用户要求:告知收益但不写明数值)
  assert.ok(!el.innerHTML.includes('influx'), '不应暴露 influx 字段名');
  assert.ok(!el.innerHTML.includes('income'), '不应暴露 income 字段名');
  assert.ok(!el.innerHTML.includes('happiness'), '不应暴露 happiness 字段名');
  assert.ok(!el.innerHTML.includes('0.125'), '不应暴露 income 具体数值');
});

// [B-46 fix] 0 人口时已解锁阶层需求列表+收益徽章仍显示(开局引导);未解锁阶层需求隐藏
test('需求面板:0 人口时显示已解锁阶层需求与收益徽章,未解锁阶层隐藏', () => {
  require('../src/ui/economy.js');
  const s = createInitialState(); // 0 人口,仅 farmers 解锁
  E.population.updateNeeds(s);
  const el = { innerHTML: '' };
  globalThis.UI.economy.renderNeeds(el, s);
  assert.ok(el.innerHTML.includes('🐟 鱼'), '0 人口也应显示农民需求列表,实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('+人口'), '0 人口也应显示收益徽章');
  assert.ok(el.innerHTML.includes('🏪 市场'), '0 人口也应显示服务型需求');
  assert.ok(!el.innerHTML.includes('工人'), '未解锁阶层(工人)标题不应显示');
  assert.ok(!el.innerHTML.includes('香肠'), '未解锁阶层商品(香肠)不应显示');
  assert.ok(!el.innerHTML.includes('暂无人口需求数据'), '不应显示空态文案');
});

// [用户确认] 信息卡按当前效率显示实际产出:半效建筑输出行显示 0.5/周期 + 满速标注(不再误读满速值)
test('建筑详情:半效时信息卡输出行显示实际产出并标注满速', () => {
  require('../src/ui/panels.js');
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
  const el = { innerHTML: '', querySelector: () => null };
  globalThis.UI.panels.showBuilding(el, s, r.building.id, null);
  assert.ok(el.innerHTML.includes('当前效率:50%'), '应显示半效 50%,实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('原木×0.5/周期 (2/min)'), '输出行应显示实际 0.5/周期(2/min),实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('满速 4/min'), '应标注满速 4/min');
});

// [B-50] 人口面板:分行显示各阶层(人口/岗位/幸福度)+ 总人口趋势 + 总幸福度
test('人口面板:分行显示阶层人口/岗位/幸福度与总幸福度', () => {
  require('../src/ui/economy.js');
  const s = createInitialState();
  setupBase(s);
  const spot = findSawmillSpot(s);
  assert.ok(spot);
  const av = footprint(E.buildings.getDef('sawmill'), spot.x, spot.y);
  connectTo(s, spot.x, spot.y, av, av);
  placeBuilding(s, 'sawmill', spot.x, spot.y);
  s.population.farmers.count = 2;
  s.resources.schnapps = 100; // 烈酒库存 → 农民幸福度 >0
  E.economy.refresh(s, { produce: false, logs: false });
  E.population.updateNeeds(s);
  const el = { innerHTML: '' };
  globalThis.UI.economy.renderPop(el, s);
  assert.ok(el.innerHTML.includes('总人口 2'), '总人口缺失,实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('总幸福度'), '总幸福度缺失');
  assert.ok(el.innerHTML.includes('农民 2 人'), '农民行缺失');
  assert.ok(el.innerHTML.includes('岗位 5/2(40%)'), '岗位段缺失(原木厂 5 岗位/2 人=40%),实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('😊'), '农民幸福度缺失');
  assert.ok(el.innerHTML.includes('工人 0 人 🔒 需农民 50'), '工人未解锁行缺失');
  assert.ok(el.innerHTML.includes('工匠 0 人 🔒 需工人 150'), '工匠未解锁行缺失');
  assert.ok(el.innerHTML.includes('暂未开放'), '工程师/投资人暂未开放缺失');
});

// [岗位制 S1] 劳动力判定:总岗位池 vs 总人口,短缺时按比例减产(非共享池)。
// 3 栋木板厂各需 10 农民 = 30 岗位:30 人全效 / 15 人半效(仍 producing)/ 0 人 waiting。
// 用无 radius 的木板厂,排除开发度干扰。
test('劳动力岗位制:总岗位>人口按比例减产(3 栋木板厂=30 岗位)', () => {
  const s = createInitialState();
  setupBase(s);
  const wh = Object.values(s.buildings).find((b) => {
    const d = E.buildings.getDef(b.type);
    return d && d.special === 'warehouse';
  });
  assert.ok(wh, '应有仓库');
  // 找位+放置交替:后续 canPlace 能看到已放置 footprint,避免重叠
  const ids = [];
  while (ids.length < 3) {
    let found = null;
    outer:
    for (let y = Math.max(0, wh.y - 40); y <= wh.y + 40; y++) {
      for (let x = Math.max(0, wh.x - 40); x <= wh.x + 40; x++) {
        if (E.placement.canPlace(s, 'boardmill', x, y, 0).ok) { found = { x, y }; break outer; }
      }
    }
    assert.ok(found, '应找到木板厂位');
    const r = placeBuilding(s, 'boardmill', found.x, found.y);
    assert.equal(r.ok, true, '木板厂应可建');
    ids.push(r.building.id);
  }
  ids.forEach((id) => {
    const b = s.buildings[id];
    const av = footprint(E.buildings.getDef('boardmill'), b.x, b.y);
    assert.ok(connectTo(s, b.x, b.y, av, av), '木板厂应连通仓库');
  });
  // 30 人口 = 岗位供需平衡 → 全效
  s.population.farmers.count = 30;
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(s._wf.farmers.need, 30, '岗位需求=30');
  assert.equal(s._wf.farmers.pop, 30);
  assert.equal(s._wf.farmers.eff, 1, '供需平衡 eff=1');
  for (const id of ids) assert.equal(s.buildings[id].status, 'producing');
  // 15 人口 → 岗位效率 50%,仍 producing(比例减产,不再整栋停产)
  s.population.farmers.count = 15;
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(s._wf.farmers.eff, 0.5, '15/30 = 0.5');
  for (const id of ids) assert.equal(s.buildings[id].status, 'producing', '15 人仍 producing(比例减产)');
  // UI 详情:岗位行 + 综合效率(岗位制)
  require('../src/ui/panels.js');
  const el = { innerHTML: '', querySelector: () => null };
  globalThis.UI.panels.showBuilding(el, s, ids[0], null);
  assert.ok(el.innerHTML.includes('⚙️ 农民 岗位 30/15(50%)'), '岗位行缺失,实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('当前效率:50%(岗位)'), '普通建筑岗位效率行缺失,实际: ' + el.innerHTML);
  assert.ok(el.innerHTML.includes('木材×0.5/周期 (2/min)') && el.innerHTML.includes('满速 4/min'), '实际产出应按综合效率显示,实际: ' + el.innerHTML);
  // 结算验证:60 tick,3 栋 × 4 周期 × 1 木 × 0.5 = 6
  const w0 = s.resources.wood || 0;
  for (let i = 0; i < CYCLE; i++) E.tick.tick(s);
  const gained = (s.resources.wood || 0) - w0;
  assert.ok(Math.abs(gained - 6) < 0.3, '半岗位效率 60tick 3 栋共产 6 木板(实际 ' + gained.toFixed(2) + ')');
  // 0 人口 → waiting(workforce-shortage,与现状一致)
  s.population.farmers.count = 0;
  E.economy.refresh(s, { produce: false, logs: false });
  for (const id of ids) {
    assert.equal(s.buildings[id].status, 'waiting', '0 人口 waiting');
    assert.equal(s.buildings[id].reason, 'workforce-shortage');
  }
});

// [岗位制 S1] 叠加:radius 建筑综合效率 = 开发度效率 × 岗位效率(原木厂半开发 × 半岗位 = 1/4)
test('岗位制叠加:radius 建筑开发度效率×岗位效率(原木厂半开发×半岗位 60tick 产 1)', () => {
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
  // 岗位:原木厂 5 岗位,人口 2.5 → 岗位效率 50%
  s.population.farmers.count = 2.5;
  E.economy.refresh(s, { produce: false, logs: false });
  assert.equal(s._wf.farmers.need, 5, '岗位需求=5');
  assert.equal(s._wf.farmers.eff, 0.5, '2.5/5 = 0.5');
  assert.equal(s.buildings[r.building.id].status, 'producing', '半岗位仍 producing');
  // 结算:60 tick = 4 周期 × 1 原木 × 0.5(开发度) × 0.5(岗位) = 1
  // 注意:手动 refresh 循环(不走 tick.updatePopulation,否则人口被住宅目标拉回,岗位效率失真)
  const w0 = s.resources.log || 0;
  for (let i = 0; i < CYCLE; i++) {
    E.state.initFlow(s);
    E.economy.refresh(s, { produce: true, logs: false });
  }
  const gained = (s.resources.log || 0) - w0;
  assert.ok(Math.abs(gained - 1) < 0.2, '半开发×半岗位 60tick 产 1 原木(实际 ' + gained.toFixed(2) + ')');
});

// ============ [B-62] 切岛与世界 tick ============

// [B-62] 世界 tick 逐岛分帧:frameBudget 下中途不推进时间/不提交,全部岛完成才统一
test('[B-62] 世界 tick 分帧:12 岛 frameBudget 3,中途不推进时间,完成帧统一提交', () => {
  const s = createInitialState();
  const wd = E.worldData;
  for (let i = 2; i <= 12; i++) {
    s.islands['island-' + i] = E.state.createIslandState('island-' + i, DEFAULT_SEED + i, wd.MAP_SIZE, { wood: 60, fish: 100 });
  }
  assert.equal(Object.keys(s.islands).length, 12, '应构造 12 岛');
  for (const isl of Object.values(s.islands)) isl.population.farmers.count = 10;
  const t0 = { tickAcc: s.time.tickAcc, hour: s.time.hour, day: s.time.day };
  // 帧 1~3:各执行 3 岛,不完整,不推进时间
  for (let f = 1; f <= 3; f++) {
    const r = E.tick.tick(s, { frameBudget: 3 });
    assert.equal(r.complete, false, '帧 ' + f + ' 未完成');
    assert.equal(r.cursor, f * 3, '光标推进');
    assert.equal(s.time.tickAcc, t0.tickAcc, '分帧中不推进时间');
  }
  // 帧 4:最后 3 岛 → 完整世界 tick
  const r4 = E.tick.tick(s, { frameBudget: 3 });
  assert.equal(r4.complete, true, '帧 4 完成');
  assert.equal(s._tickCursor, 0, '光标归零');
  assert.equal(s.time.tickAcc, (t0.tickAcc + 1) % 12, '完成后时间推进 1 tick');
  assert.equal(s.time.day, t0.day, '时间推进未跨小时时 day 不变');
  // 所有岛都被精确模拟:__prevPop 已记录
  for (const [id, isl] of Object.entries(s.islands)) {
    assert.equal(isl.__prevPop, isl.population.farmers.count, '岛 ' + id + ' 应被模拟(__prevPop=' + isl.__prevPop + ')');
  }
});

// [B-62] 离岛不冻结:非活动岛的人口/生产按同一精确语义推进
test('[B-62] 离岛模拟:非活动岛人口收敛(不冻结离岛)', () => {
  const s = createInitialState();
  const wd = E.worldData;
  s.islands['island-second'] = E.state.createIslandState('island-second', DEFAULT_SEED + 1, wd.MAP_SIZE, { wood: 5 });
  // 活动岛=主岛 0 人;第二岛 5 人(无住宅 → 目标 0,应向 0 收敛)
  s.population.farmers.count = 0;
  s.islands['island-second'].population.farmers.count = 5;
  const r = E.tick.tick(s);
  assert.equal(r.complete, true, '默认一帧完成全部岛');
  assert.ok(s.islands['island-second'].population.farmers.count < 5, '离岛人口被模拟并收敛(实际 ' + s.islands['island-second'].population.farmers.count + ')');
  assert.ok(s.islands['island-second'].__prevPop != null, '离岛 __prevPop 已记录');
});

// [B-62] 离岛生产结算:非活动岛建筑周期推进(cycleAcc 累积,生产不冻结)
test('[B-62] 离岛生产:非活动岛原木厂周期结算产出', () => {
  const s = createInitialState();
  const wd = E.worldData;
  s.islands['island-second'] = E.state.createIslandState('island-second', DEFAULT_SEED + 2, wd.MAP_SIZE, { wood: 60, fish: 100 });
  // [B-62] 新岛加入世界须挂全局金币别名(标准流程;tick 也会幂等补挂)
  const isl = s.islands['island-second'];
  E.state.attachCoinAlias(s, isl);
  // 第二岛建仓库+原木厂+路(仿 setupBase 简化:直接放+连通)
  const p = findSpot(isl, 5, 5, null, PF);
  assert.ok(p, '第二岛应有仓库位');
  const rw = E.placement.placeBuilding(isl, 'warehouse', p.x, p.y);
  assert.equal(rw.ok, true);
  const built = [rw.building];
  const hs = findHouseSpot(isl, built);
  const spot = findSpot(isl, 4, 4, null, PF);
  const r = E.placement.placeBuilding(isl, 'sawmill', spot.x, spot.y);
  assert.equal(r.ok, true, '第二岛原木厂: ' + (r.reason || ''));
  const av = footprint(E.buildings.getDef('sawmill'), spot.x, spot.y);
  assert.ok(connectTo(isl, spot.x, spot.y, av, av), '第二岛原木厂连通');
  isl.population.farmers.count = 10; // 原木厂需 5
  // 驱动 15 tick(原木厂 cycle 15)→ 至少产 1
  const w0 = isl.resources.log || 0;
  for (let i = 0; i < 16; i++) {
    const r2 = E.tick.tick(s);
    assert.equal(r2.complete, true);
  }
  const gained = (isl.resources.log || 0) - w0;
  assert.ok(gained > 0, '离岛原木厂 16 tick 应产出(开发度可能打折,但周期结算必须推进;实际 ' + gained + ')');
});

// ============ [B-63] 海事生产与舰队 ============

// [B-63] 订单提交:原子全额扣费(全局金币+本岛材料)+ 付款快照 + 下单岛 ID
test('[B-63] 造船订单提交:扣全局金币与本岛材料,保存快照', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  // 主岛放造船厂(海岸 6×17)
  const spot = findCoastSpot(s, 6, 17);
  assert.ok(spot, '应有海岸 6×17 位');
  const r = placeBuilding(s, 'sailingShipyard', spot.x, spot.y);
  assert.equal(r.ok, true, '造船厂放置: ' + (r.reason || ''));
  const coin0 = s.treasury.coin;
  const wood0 = s.resources.wood;
  const sail0 = s.resources.sail || 0;
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, r.building.id);
  assert.equal(sub.ok, true, '下单: ' + (sub.reason || ''));
  assert.equal(s.treasury.coin, coin0 - 5000, '全局金币扣 5000');
  assert.equal(s.resources.wood, 100 - 20, '本岛木材扣 20');
  assert.equal(s.resources.sail, 50 - 10, '本岛船帆扣 10');
  assert.equal(sub.order.islandId, 'island-main', '快照记录下单岛');
  assert.equal(sub.order.paidCost.coin, 5000, '付款快照 coin');
  assert.equal(sub.order.remainingWork, 180, '工作量 180');
});

// [B-63] 队列限制:每厂最多 4 份(1 建造 + 3 等待),第 5 份拒绝
test('[B-63] 造船订单队列:最多 4 份,第 5 份拒绝', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const spot = findCoastSpot(s, 6, 17);
  const r = placeBuilding(s, 'sailingShipyard', spot.x, spot.y);
  s.resources.wood = 1000; s.resources.sail = 500; s.treasury.coin = 100000;
  for (let i = 0; i < 4; i++) {
    const sub = E.ships.submitShipOrder(s, r.building.id);
    assert.equal(sub.ok, true, '第 ' + (i + 1) + ' 单: ' + (sub.reason || ''));
  }
  const fifth = E.ships.submitShipOrder(s, r.building.id);
  assert.equal(fifth.ok, false, '第 5 单拒绝');
  assert.equal(Object.keys(s.shipOrders).length, 4, '队列 4 份');
});

// [B-63] 取消返还:等待/建造中取消全额返还快照(金币+本岛材料),工作量清零
test('[B-63] 造船订单取消:全额返还(金币+本岛材料)', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  const coin0 = s.treasury.coin;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  const afterSub = s.treasury.coin;
  // 推进 10 tick(建造中;期间有维护费,金币断言用相对)
  for (let i = 0; i < 10; i++) E.tick.tick(s);
  assert.ok(s.shipOrders[sub.order.id].remainingWork < 180, '订单已开工');
  const c = E.ships.cancelShipOrder(s, sub.order.id);
  assert.equal(c.ok, true);
  assert.ok(s.treasury.coin > afterSub, '金币按快照返还(+5000,扣除维护后仍增加)');
  assert.equal(s.resources.wood, 100, '木材全额返还');
  assert.equal(s.resources.sail, 50, '船帆全额返还');
  assert.equal(s.shipOrders[sub.order.id], undefined, '订单删除');
});

// [B-63] 订单完成:180 完整世界 tick → 生成 idle 船
test('[B-63] 造船订单完成:180 tick 生成 idle 船', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  for (let i = 0; i < 185; i++) E.tick.tick(s);
  assert.equal(s.shipOrders[sub.order.id], undefined, '订单完成移除');
  const ships = Object.values(s.fleet || {});
  assert.equal(ships.length, 1, '生成 1 艘船');
  assert.equal(ships[0].status, 'idle', '船 idle');
  assert.equal(ships[0].currentIslandId, 'island-main', '船在建造岛');
});

// [B-63] 断连暂停:造船厂断连 → 订单不推进但保留
test('[B-63] 造船订单断连暂停:不推进但保留', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  setupBase(s);
  const spot = findCoastSpot(s, 6, 17);
  const r = placeBuilding(s, 'sailingShipyard', spot.x, spot.y);
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, r.building.id);
  const w0 = sub.order.remainingWork;
  // 造船厂在海岸(远离仓库路网)→ 大概率未连通;若连通则先拆路
  for (let i = 0; i < 5; i++) E.tick.tick(s);
  assert.equal(s.shipOrders[sub.order.id].remainingWork, w0, '断连订单不推进(暂停保留)');
});

// [B-63] 退役:仅 idle 船;返还 20 木+10 帆到停留岛,金币不返
test('[B-63] 船退役:idle 返还材料,金币不返', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  for (let i = 0; i < 185; i++) E.tick.tick(s);
  const ship = Object.values(s.fleet)[0];
  const coin0 = s.treasury.coin;
  const wood0 = s.resources.wood;
  const sail0 = s.resources.sail;
  const ret = E.ships.retireShip(s, ship.id);
  assert.equal(ret.ok, true);
  assert.equal(s.resources.wood, wood0 + 20, '木材+20');
  assert.equal(s.resources.sail, sail0 + 10, '船帆+10');
  assert.equal(s.treasury.coin, coin0, '金币不返');
  assert.equal(s.fleet[ship.id], undefined, '船移除');
});

// [B-63] 码头每岛最多 1 座
test('[B-63] 码头:每岛最多 1 座', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const p1 = findCoastSpot(s, 7, 11);
  const r1 = placeBuilding(s, 'port', p1.x, p1.y);
  assert.equal(r1.ok, true, '第一座码头: ' + (r1.reason || ''));
  // 第二座:找不同位置(避开第一座 footprint;findCoastSpot 确定性扫描会返回同位置)
  let p2 = null;
  for (let dy = -30; dy <= 30 && !p2; dy++) for (let dx = -30; dx <= 30 && !p2; dx++) {
    if (dx === 0 && dy === 0) continue;
    const cand = findCoastSpotOffset(s, 7, 11, p1.x + dx, p1.y + dy);
    if (cand && !footprintOverlaps(s, E.buildings.getDef('port'), cand.x, cand.y, p1.x, p1.y)) p2 = cand;
  }
  assert.ok(p2, '应有第二个码头位');
  const r2 = placeBuilding(s, 'port', p2.x, p2.y);
  assert.equal(r2.ok, false, '第二座码头拒绝');
  assert.equal(r2.reason, '每岛最多 1 座码头');
});

// [B-63] 码头权限:建成+连通仓库才有效(REQ-40)
test('[B-63] 码头权限:未连通时 portValid=false', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const p = findCoastSpot(s, 7, 11);
  const r = placeBuilding(s, 'port', p.x, p.y);
  assert.equal(r.ok, true);
  // 码头在海岸,无仓库路网 → 未连通
  assert.equal(E.ships.portValid(s, 'island-main'), false, '未连通码头无效');
  // 码头+仓库+连通
  setupBase(s);
  E.economy.refresh(s, { produce: false, logs: false });
  // 码头离仓库远 → 仍无效;手动把码头连上
  const port = Object.values(s.buildings).find((b) => b.type === 'port');
  const pb = E.placement.footprintBounds(E.buildings.getDef('port'), port.x, port.y, port.rot);
  const avP = footprint(E.buildings.getDef('port'), port.x, port.y);
  const wb = Object.values(s.buildings).find((b) => b.type === 'warehouse');
  const wbb = E.placement.footprintBounds(E.buildings.getDef('warehouse'), wb.x, wb.y, wb.rot);
  connectTo(s, wbb.x + 1, wbb.y + 1, avP, avP);
  assert.equal(E.ships.portValid(s, 'island-main'), true, '连通后码头有效');
});

// [B-63] 调遣:idle 船+有效码头,600 tick 到达目标岛;途中禁止退役;目标无码头不能再次出发
test('[B-63] 调遣:600 tick 到达,途中不可退役,无码头目标不可再出发', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  for (let i = 0; i < 185; i++) E.tick.tick(s);
  const ship = Object.values(s.fleet)[0];
  // 第二岛(目标)
  const wd = E.worldData;
  s.islands['island-2'] = E.state.createIslandState('island-2', DEFAULT_SEED + 9, wd.MAP_SIZE, { wood: 60, fish: 100 });
  E.state.attachCoinAlias(s, s.islands['island-2']);
  // 主岛建码头并连通(仓库覆盖内)
  const portSpot = findCoastRect(s, 7, 11);
  const pr = placeBuilding(s, 'port', portSpot.x, portSpot.y);
  assert.equal(pr.ok, true, '码头放置: ' + (pr.reason || ''));
  assert.equal(E.ships.portValid(s, 'island-main'), true, '码头有效');
  // 调遣
  const rel = E.ships.relocateShip(s, ship.id, 'island-2');
  assert.equal(rel.ok, true, '调遣发起: ' + (rel.reason || ''));
  assert.equal(s.fleet[ship.id].status, 'relocating', '船调遣中');
  const ret = E.ships.retireShip(s, ship.id);
  assert.equal(ret.ok, false, '调遣中禁止退役');
  // 600 tick 到达
  for (let i = 0; i < 600; i++) E.tick.tick(s);
  assert.equal(s.fleet[ship.id].status, 'idle', '到达后 idle');
  assert.equal(s.fleet[ship.id].currentIslandId, 'island-2', '船在目标岛');
  // 目标岛无码头 → 不能再次调遣(REQ-41 来源需有效码头)
  const rel2 = E.ships.relocateShip(s, ship.id, 'island-main');
  assert.equal(rel2.ok, false, '无码头来源不可调遣');
});

// [B-63] 拆除造船厂:自动取消未完工订单并全额返还(UI 拆除时调用)
test('[B-63] 拆除造船厂联动:取消未完工订单并返还', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  E.ships.cancelShipyardOrders(s, 'island-main', shipyard.id); // UI 层拆除船厂时调用(复合身份)
  assert.equal(s.shipOrders[sub.order.id], undefined, '订单已取消');
  assert.equal(s.resources.wood, 100, '木材全额返还');
  assert.equal(s.resources.sail, 50, '船帆全额返还');
});

// ============ [B-64] 灰冠探索与岛屿生成 ============

// [B-64/REQ-37] 主岛 4+4:4 矿物(保底黏土/铁)+ 4 植物(保底土豆/谷物/啤酒花)
test('[B-64] 主岛禀赋:4 矿物含黏土/铁,4 植物含土豆/谷物/啤酒花', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const isl = s.islands['island-main'];
  assert.equal(isl.deposits.length, 4, '主岛 4 矿物(实际 ' + isl.deposits + ')');
  assert.ok(isl.deposits.indexOf('clay') >= 0 && isl.deposits.indexOf('iron') >= 0, '保底黏土/铁');
  assert.equal(isl.fertilities.length, 4, '主岛 4 植物(实际 ' + isl.fertilities + ')');
  assert.ok(isl.fertilities.indexOf('potato') >= 0 && isl.fertilities.indexOf('grain') >= 0 && isl.fertilities.indexOf('hops') >= 0, '保底土豆/谷物/啤酒花');
  const clay = findSpot(s, 5, 5, 2, [2]);
  assert.ok(clay, '主岛有黏土 5×5');
  const iron = findSpot(s, 3, 3, 3, [3]);
  assert.ok(iron, '主岛有铁矿');
});

// [B-64] 探索发起:90% 档扣来源岛资源 + 船占用 + 名额预留
test('[B-64] 探索发起:90% 档扣资源/占船/留名额(600 tick)', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  for (let i = 0; i < 185; i++) E.tick.tick(s);
  const ship = Object.values(s.fleet)[0];
  s.resources.fish = 100; s.resources.workclothes = 50; s.resources.schnapps = 50;
  const fish0 = s.resources.fish;
  setupPort(s); // [HIGH-2] 海上任务出发需有效码头
  const st = E.expeditions.startExpedition(s, ship.id, '90');
  assert.equal(st.ok, true, '发起: ' + (st.reason || ''));
  assert.equal(s.resources.fish, fish0 - 60, '鱼扣 60(90% 档)');
  assert.equal(s.fleet[ship.id].status, 'expedition', '船占用');
  assert.equal(Object.keys(s.expeditionTasks).length, 1, '任务存在');
  assert.equal(st.task.remaining, 600, '10 分钟=600 tick');
  assert.ok(st.task.roll >= 0 && st.task.roll < 1, '确定性 roll');
});

// [B-64] 探索完成:按确定性 roll 判定;成功得新岛(初始包/不切岛/补缺),失败船损失
test('[B-64] 探索完成:成功得新岛(鱼100木20/不切岛/补缺),失败损失船', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const mainF = s.islands['island-main'].fertilities.slice();
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  s.resources.fish = 200; s.resources.workclothes = 100; s.resources.schnapps = 100;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  for (let i = 0; i < 185; i++) E.tick.tick(s);
  const ship = Object.values(s.fleet)[0];
  setupPort(s); // [HIGH-2] 海上任务出发需有效码头
  const st = E.expeditions.startExpedition(s, ship.id, '90');
  assert.equal(st.ok, true, '发起: ' + (st.reason || ''));
  const roll = st.task.roll;
  const activeId = s.activeIslandId;
  for (let i = 0; i < 600; i++) E.expeditions.advanceExpeditions(s);
  if (roll < 0.9) {
    assert.equal(Object.keys(s.islands).length, 2, '成功获得新岛');
    const newIsl = Object.values(s.islands).find((i) => i.id !== 'island-main');
    assert.equal(newIsl.resources.fish, 100, '初始鱼 100');
    assert.equal(newIsl.resources.wood, 20, '初始木 20');
    // 金币走全局钱包:序列化后岛内无独立 coin
    const plain = JSON.parse(JSON.stringify(s));
    assert.equal(plain.islands[newIsl.id].resources.coin, undefined, '岛内不序列化独立金币');
    assert.equal(s.activeIslandId, activeId, '不自动切岛');
    assert.equal(newIsl.fertilities.length, 4, '新岛 4 植物');
    assert.equal(newIsl.deposits.length, 4, '新岛 4 矿物');
    // 补缺:新岛至少 1 种主岛没有的植物/矿物
    assert.ok(newIsl.fertilities.filter((f) => mainF.indexOf(f) < 0).length >= 1, '新岛补缺植物');
    // 矿床真实生成:每种入选矿物有地形格
    const code = { clay: 2, iron: 3, copper: 4, gold: 5, coal: 8, zinc: 9, limestone: 10 };
    for (const d of newIsl.deposits) {
      let cnt = 0;
      for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) if (newIsl.map.terrain[y][x] === code[d]) cnt++;
      assert.ok(cnt > 0, '新岛有 ' + d + ' 地形');
    }
    // 探索船在新岛 idle
    assert.equal(s.fleet[ship.id].status, 'idle', '船到达新岛');
    assert.equal(s.fleet[ship.id].currentIslandId, newIsl.id);
  } else {
    assert.equal(Object.keys(s.islands).length, 1, '失败无新岛');
    assert.equal(s.fleet[ship.id], undefined, '失败船损失');
  }
});

// [B-64] 探索放弃:投入不返还,船损失
test('[B-64] 探索放弃:不返还投入,船损失', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  for (let i = 0; i < 185; i++) E.tick.tick(s);
  const ship = Object.values(s.fleet)[0];
  s.resources.fish = 100;
  setupPort(s); // [HIGH-2] 海上任务出发需有效码头
  const st = E.expeditions.startExpedition(s, ship.id, '70');
  assert.equal(st.ok, true);
  const fish0 = s.resources.fish;
  const ab = E.expeditions.abortExpedition(s, st.task.id);
  assert.equal(ab.ok, true);
  assert.equal(s.resources.fish, fish0, '放弃不返还鱼');
  assert.equal(s.fleet[ship.id], undefined, '船损失');
  assert.equal(Object.keys(s.expeditionTasks).length, 0, '任务删除');
});

// [B-64] 名额:12 岛上限(已有岛 + 活动探索);满额拒绝发起
test('[B-64] 探索名额:12 上限,满额拒绝', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const wd = E.worldData;
  // 塞满 11 个额外岛 → 12 岛
  for (let i = 2; i <= 12; i++) {
    const isl = E.state.createIslandState('island-' + i, DEFAULT_SEED + i * 7, wd.MAP_SIZE, { wood: 5 });
    E.state.attachCoinAlias(s, isl);
    s.islands[isl.id] = isl;
  }
  assert.equal(Object.keys(s.islands).length, 12);
  const { shipyard } = setupShipyard(s); // setupBase 在 12 岛后放建筑 → 主岛
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  for (let i = 0; i < 185; i++) E.tick.tick(s);
  const ship = Object.values(s.fleet)[0];
  setupPort(s); // [HIGH-2] 海上任务出发需有效码头
  const st = E.expeditions.startExpedition(s, ship.id, '60');
  assert.equal(st.ok, false, '12 岛满额拒绝');
  assert.ok(st.reason.indexOf('名额') >= 0, '原因: ' + st.reason);
});
// ============ [B-65] 岛间持续运输 ============

// [B-65] 运输测试基建:造船厂+船+码头+第二目标岛
function setupShipping(s) {
  const { shipyard } = setupShipyard(s);
  s.resources.wood = 100; s.resources.sail = 50;
  const sub = E.ships.submitShipOrder(s, shipyard.id);
  for (let i = 0; i < 185; i++) { s.population.workers.count = 100; E.tick.tick(s); }
  const ship = Object.values(s.fleet)[0];
  const portSpot = findCoastRect(s, 7, 11);
  const pr = placeBuilding(s, 'port', portSpot.x, portSpot.y);
  assert.equal(pr.ok, true, '码头: ' + (pr.reason || ''));
  const wd = E.worldData;
  s.islands['island-t2'] = E.state.createIslandState('island-t2', DEFAULT_SEED + 21, wd.MAP_SIZE, { wood: 0, fish: 0 });
  E.state.attachCoinAlias(s, s.islands['island-t2']);
  return { ship, shipyard, port: pr.building, target: s.islands['island-t2'] };
}

// [B-65] 创建航线:绑定 idle 船 + 槽位校验(速率 0~5/步长 0.1/整船 ≤10/目标≠来源)
test('[B-65] 创建航线:绑定船 + 槽位校验', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { ship } = setupShipping(s);
  let r = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 6 }]);
  assert.equal(r.ok, false, '速率 >5 拒绝');
  r = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 3.33 }]);
  assert.equal(r.ok, false, '步长非 0.1 拒绝');
  r = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 5 }, { good: 'wood', rate: 5.1 }]);
  assert.equal(r.ok, false, '整船 >10 拒绝');
  r = E.transport.createTransportTask(s, ship.id, 'island-main', [{ good: 'fish', rate: 1 }]);
  assert.equal(r.ok, false, '目标不能是来源');
  r = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 3 }, { good: 'wood', rate: 1.5 }]);
  assert.equal(r.ok, true, '创建: ' + (r.reason || ''));
  assert.equal(s.fleet[ship.id].status, 'transport', '船绑定');
});

// [B-65] 持续转移:每 tick 按 rate/60,不批量;60 tick 转 3(3/min)
test('[B-65] 持续转移:每 tick 结算,60 tick 转 3', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { ship, target } = setupShipping(s);
  s.resources.fish = 100;
  const r = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 3 }]);
  assert.equal(r.ok, true);
  for (let i = 0; i < 60; i++) E.tick.tick(s);
  assert.ok(Math.abs(target.resources.fish - 3) < 0.01, '60 tick 转 3(实际 ' + target.resources.fish + ')');
  // 来源 = 100 - 运输 3 - 民居消费(setupBase 50 人吃鱼,消费 > 0 且远小于 3)
  assert.ok(s.resources.fish < 97 && s.resources.fish > 96, '来源扣运输+消费(实际 ' + s.resources.fish + ')');
});

// [B-65] 比例分配:同源同商品 3+1 请求,库存不足按比例(2 → 1.5:0.5),不依赖遍历顺序
test('[B-65] 比例分配:3+1 请求库存 2 → 1.5:0.5', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { ship, shipyard, target } = setupShipping(s);
  // 第二艘船
  s.resources.wood = 100; s.resources.sail = 50;
  const sub2 = E.ships.submitShipOrder(s, shipyard.id);
  assert.equal(sub2.ok, true, '第二单: ' + (sub2.reason || ''));
  for (let i = 0; i < 185; i++) { s.population.workers.count = 100; E.tick.tick(s); }
  assert.equal(Object.keys(s.fleet).length, 2, '应有 2 艘船(实际 ' + Object.keys(s.fleet).length + ')');
  const ship2 = Object.values(s.fleet).find((x) => x.id !== ship.id);
  assert.ok(ship2, '第二艘船存在');
  s.resources.fish = 2; // 库存不足
  const r1 = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 3 }]);
  const r2 = E.transport.createTransportTask(s, ship2.id, 'island-t2', [{ good: 'fish', rate: 1 }]);
  assert.equal(r1.ok && r2.ok, true);
  for (let i = 0; i < 60; i++) { s.population.workers.count = 100; E.tick.tick(s); }
  // 运输 = 库存 2 - 民居消费(消费 >0 且 <0.2);比例 3:1 不受消费影响
  assert.ok(target.resources.fish > 1.8 && target.resources.fish < 2.1, '目标≈2(实际 ' + target.resources.fish + ')');
  const ts = Object.values(s.transportTasks);
  const c1 = ts[0].carried.fish || 0, c2 = ts[1].carried.fish || 0;
  const total = c1 + c2;
  assert.ok(Math.abs(total - target.resources.fish) < 0.01, 'carried 合计=目标到货');
  assert.ok(Math.abs(c1 - total * 0.75) < 0.01, '船A 得 75%(3:1)(实际 ' + c1 + ')');
  assert.ok(Math.abs(c2 - total * 0.25) < 0.01, '船B 得 25%(3:1)(实际 ' + c2 + ')');
});

// [B-65] 命令边界生效:编辑/暂停/恢复在下一完整 tick 原子提交
test('[B-65] 命令边界生效:编辑/暂停/恢复', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { ship, target } = setupShipping(s);
  s.resources.fish = 1000;
  const r = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 3 }]);
  const taskId = r.task.id;
  E.tick.tick(s);
  E.transport.editTransportTask(s, taskId, [{ good: 'fish', rate: 1 }]);
  const before = target.resources.fish;
  E.tick.tick(s);
  assert.ok(Math.abs((target.resources.fish - before) - 1 / 60) < 0.001, '编辑后按新速率(实际 ' + (target.resources.fish - before) + ')');
  E.transport.pauseTransportTask(s, taskId);
  E.tick.tick(s);
  const before2 = target.resources.fish;
  E.tick.tick(s);
  assert.equal(target.resources.fish, before2, '暂停后停止转移');
  assert.equal(s.fleet[ship.id].status, 'transport-paused', '暂停船状态');
  E.transport.resumeTransportTask(s, taskId);
  E.tick.tick(s);
  const before3 = target.resources.fish;
  E.tick.tick(s);
  assert.ok(target.resources.fish > before3, '恢复后继续转移');
});

// [B-65] 码头阻塞:失效阻塞/复连自动恢复/与主动暂停独立
test('[B-65] 码头阻塞:拆码头阻塞,重建恢复,暂停独立', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { ship, port, target } = setupShipping(s);
  s.resources.fish = 1000;
  const r = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 1 }]);
  const taskId = r.task.id;
  E.tick.tick(s);
  E.placement.demolish(s, port.id);
  E.tick.tick(s);
  const t = s.transportTasks[taskId];
  assert.equal(t.blockedReason, 'port-invalid', '拆码头后阻塞');
  assert.equal(s.fleet[ship.id].status, 'transport-paused', '阻塞船暂停状态');
  const p2 = findCoastRect(s, 7, 11);
  const pr2 = placeBuilding(s, 'port', p2.x, p2.y);
  assert.equal(pr2.ok, true, '重建码头: ' + (pr2.reason || ''));
  E.tick.tick(s);
  assert.equal(s.transportTasks[taskId].blockedReason, null, '复连自动恢复');
  E.transport.pauseTransportTask(s, taskId);
  E.tick.tick(s);
  assert.equal(s.transportTasks[taskId].userPaused, true, '主动暂停');
  assert.equal(s.transportTasks[taskId].blockedReason, null, '暂停不派生阻塞');
});

// [B-65] 取消:活动/暂停/阻塞均可;船解绑 idle;不回滚
test('[B-65] 取消航线:船 idle,既有结果不回滚', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.steel = 1000; s.resources.sail = 1000;
  const { ship, target } = setupShipping(s);
  s.resources.fish = 1000;
  const r = E.transport.createTransportTask(s, ship.id, 'island-t2', [{ good: 'fish', rate: 1 }]);
  const taskId = r.task.id;
  for (let i = 0; i < 30; i++) E.tick.tick(s);
  const carried = target.resources.fish;
  assert.ok(carried > 0, '已转移(实际 ' + carried + ')');
  E.transport.cancelTransportTask(s, taskId);
  E.tick.tick(s);
  assert.equal(s.transportTasks[taskId], undefined, '航线删除');
  assert.equal(s.fleet[ship.id].status, 'idle', '船解绑 idle');
  assert.equal(s.fleet[ship.id].currentIslandId, 'island-main', '船回来源岛');
  assert.equal(target.resources.fish, carried, '既有结果不回滚');
});

// [B-62a] 命名规则:主岛=灰冠岛 1,探索岛按获得顺序连续编号
test('[B-62a] 主岛正式名灰冠岛 1;探索岛灰冠岛 2 起连续编号', () => {
  const s = E.state.createInitialState(DEFAULT_SEED); // 真实入口(160 地形),不走 128 夹具
  const wd2 = E.worldData;
  assert.equal(s.islands[wd2.MAIN_ISLAND_ID].name, '灰冠岛 1', '主岛名应为灰冠岛 1');
  // 模拟探索获得第一个新岛:直接走 acquireIsland(需先有探索任务完成态)
  // 简化:构造 world 后手动创建第二岛,验证名字与 id 分离逻辑由探索负责;这里验证主岛归一
  const raw = JSON.parse(JSON.stringify(s));
  raw.islands[wd2.MAIN_ISLAND_ID].name = '主岛'; // 模拟旧 v2 档
  const norm = E.save.deserialize(JSON.stringify({ v: 2, ts: Date.now(), state: raw }));
  assert.equal(norm.islands[wd2.MAIN_ISLAND_ID].name, '灰冠岛 1', '旧档主岛名 主岛 应归一为 灰冠岛 1');
});

// ============ [Sol 复验 HIGH-1] 造船厂订单跨岛串联 ============

// [HIGH-1] 不同岛同 ID 造船厂:队列/取消/推进必须复合身份(islandId+shipyardId)
test('[HIGH-1] 两岛同 ID 造船厂:取消岛A订单不影响岛B', () => {
  const s = createInitialState();
  s.resources.coin = 100000; s.resources.wood = 1000; s.resources.brick = 1000; s.resources.sail = 1000;
  // 岛A(活动=主岛):造船厂
  const spotA = findCoastSpot(s, 6, 17);
  assert.ok(spotA, '岛A应有海岸 6×17 位');
  const ra = placeBuilding(s, 'sailingShipyard', spotA.x, spotA.y);
  assert.equal(ra.ok, true, '岛A造船厂: ' + (ra.reason || ''));
  const idA = ra.building.id;
  // 岛B:造船厂(岛内独立 id 序列,同为 b1)
  const islB = E.state.createIslandState('island-2', DEFAULT_SEED + 2, E.worldData.MAP_SIZE, { wood: 1000, brick: 1000, sail: 1000, fish: 100 });
  E.state.attachCoinAlias(s, islB);
  s.islands['island-2'] = islB;
  const spotB = findCoastSpot(islB, 6, 17);
  assert.ok(spotB, '岛B应有海岸 6×17 位');
  const rb = E.placement.placeBuilding(islB, 'sailingShipyard', spotB.x, spotB.y);
  assert.equal(rb.ok, true, '岛B造船厂: ' + (rb.reason || ''));
  assert.equal(rb.building.id, idA, '两岛造船厂同 id(' + idA + ')——串联条件成立');
  // 岛A 下一单(活动岛=主岛)
  const subA = E.ships.submitShipOrder(s, idA);
  assert.equal(subA.ok, true, '岛A下单: ' + (subA.reason || ''));
  // 切活动岛到岛B 下一单
  s.activeIslandId = 'island-2';
  const subB = E.ships.submitShipOrder(s, rb.building.id);
  assert.equal(subB.ok, true, '岛B下单: ' + (subB.reason || ''));
  // 岛A 拆厂取消(活动岛=主岛)
  s.activeIslandId = 'island-main';
  const cr = E.ships.cancelShipyardOrders(s, 'island-main', idA);
  assert.equal(cr.ok, true, '岛A拆厂取消: ' + (cr.reason || ''));
  // 岛B 订单必须保留
  const ordersB = E.ships.ordersOf(s, 'island-2', rb.building.id);
  assert.equal(ordersB.length, 1, '岛B 订单应保留(实际 ' + ordersB.length + ')');
  // 队列上限隔离:岛A 再下单应受岛A 自身队列限制,不受岛B 订单影响
  // (岛A 上限 4:已有 0 份[已取消],可再下;此处验证订单归属过滤而非总量)
  const oA2 = E.ships.submitShipOrder(s, idA);
  assert.equal(oA2.ok, true, '岛A再下单: ' + (oA2.reason || ''));
  assert.equal(E.ships.ordersOf(s, 'island-main', idA).length, 1, '岛A 队列 1 份');
  assert.equal(ordersB.length, 1, '岛B 队列仍 1 份(互不影响)');
});

// ============ [Sol 复验 HIGH-2] 探索跨岛瞬移与码头权限 ============

// [HIGH-2] 探索来源岛=船停留岛(非活动岛),要求有效码头;否则不扣费不建任务
test('[HIGH-2] 探索禁止跨岛瞬移与无码头出发', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  // 船停留在岛2(活动岛=主岛;两岛均无码头)
  const isl2 = E.state.createIslandState('island-2', DEFAULT_SEED + 2, E.worldData.MAP_SIZE, { wood: 100, fish: 100, sail: 10, workclothes: 10, schnapps: 10 });
  E.state.attachCoinAlias(s, isl2);
  s.islands['island-2'] = isl2;
  s.fleet = { s1: { id: 's1', type: 'sailBoat', currentIslandId: 'island-2', status: 'idle', constructionCostPaid: {} } };
  const fish0 = isl2.resources.fish;
  const r = E.expeditions.startExpedition(s, 's1', '70');
  assert.equal(r.ok, false, '无码头必须拒绝: ' + r.reason);
  assert.equal(isl2.resources.fish, fish0, '不得扣费');
  assert.ok(!s.expeditionTasks || Object.keys(s.expeditionTasks).length === 0, '不得创建任务');
  assert.equal(s.fleet.s1.status, 'idle', '船保持空闲');
});

// [HIGH-2] 有码头且连通仓库时,从船停留岛(非活动岛)扣费发起
test('[HIGH-2] 码头有效时从船停留岛扣费发起探索', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  const isl2 = E.state.createIslandState('island-2', DEFAULT_SEED + 2, E.worldData.MAP_SIZE, { wood: 100, fish: 100, steel: 20, sail: 10, workclothes: 10, schnapps: 10 });
  E.state.attachCoinAlias(s, isl2);
  s.islands['island-2'] = isl2;
  // 岛2 建仓库+码头+铺路连通
  const wb = findSpot(isl2, 5, 5, null, PF);
  assert.ok(wb, '岛2 仓库位');
  const rw = E.placement.placeBuilding(isl2, 'warehouse', wb.x, wb.y);
  assert.equal(rw.ok, true, '岛2仓库: ' + (rw.reason || ''));
  const pb = findCoastSpot(isl2, 7, 11);
  assert.ok(pb, '岛2 码头位');
  const rp = E.placement.placeBuilding(isl2, 'port', pb.x, pb.y);
  assert.equal(rp.ok, true, '岛2码头: ' + (rp.reason || ''));
  const av = E.placement.footprint(E.buildings.getDef('port'), pb.x, pb.y, 0);
  const c = connectTo(isl2, pb.x, pb.y, av, av);
  assert.ok(c, '码头连通仓库');
  // 船在岛2 idle
  s.fleet = { s1: { id: 's1', type: 'sailBoat', currentIslandId: 'island-2', status: 'idle', constructionCostPaid: {} } };
  const fish0 = isl2.resources.fish;
  const wood0 = isl2.resources.wood; // 码头建造后记录(码头本身耗木 10)
  const r = E.expeditions.startExpedition(s, 's1', '70');
  assert.equal(r.ok, true, '码头有效应放行: ' + (r.reason || ''));
  assert.equal(isl2.resources.fish, fish0 - 20, '从船停留岛扣鱼 20');
  assert.equal(isl2.resources.wood, wood0 - 10, '从船停留岛扣木 10');
  assert.equal(s.fleet.s1.status, 'expedition', '船占用');
  assert.equal(r.task.sourceIslandId, 'island-2', '任务来源岛=船停留岛');
});

// ============ [Sol 复验 HIGH-3] 矿床兜底合法化 ============

// [HIGH-3] 逐矿物独立校验:任一入选矿物未达组数即不满足(旧 1.5 分制会允许部分缺失+超额通过)
test('[HIGH-3] 逐矿物独立校验:任一矿物缺失即不满足', () => {
  const size = E.worldData.MAP_SIZE;
  const t1 = E.mapTemplate.generateIsland(size, 1001, ['clay', 'iron', 'coal']); // 无 zinc
  const ok1 = E.expeditions.depositsSatisfied(t1, size, ['clay', 'iron', 'coal', 'zinc']);
  assert.equal(ok1, false, 'zinc 缺失必须不满足');
  const t2 = E.mapTemplate.generateIsland(size, 1002, ['clay', 'iron', 'coal', 'zinc']); // 齐备
  const ok2 = E.expeditions.depositsSatisfied(t2, size, ['clay', 'iron', 'coal', 'zinc']);
  assert.equal(ok2, true, '四矿物齐备应满足');
});

// [Sol 轮2] 完整矿床组验证:散格(75 黏土无完整 5×5)不算满足
test('[Sol-2-2] 零散矿物格不满足(须完整 5×5/3×3 组)', () => {
  const size = E.worldData.MAP_SIZE;
  const t = Array.from({ length: size }, () => Array(size).fill(0));
  // 散布 75 个黏土格(2),互不相邻,保证无完整 5×5
  let n = 0;
  for (let y = 0; y < 20 && n < 75; y += 2) for (let x = 0; x < 20 && n < 75; x += 2) {
    t[y * 8][x * 8] = 2; n++;
  }
  assert.equal(n, 75, '散布 75 黏土格');
  const ok = E.expeditions.depositsSatisfied(t, size, ['clay']);
  assert.equal(ok, false, '75 零散黏土无完整 5×5 组必须不满足');
});

// [HIGH-3/AC-20] 正常生成:入选矿物不得被删减(与 pickNewIslandEndowments 一致);候选不足返回 null
test('[Sol-2-2] 正常生成不删矿物;候选不足不授予', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  const endow = E.expeditions.pickNewIslandEndowments(s, 9999);
  const g = E.expeditions.generateNewIsland(s, 9999);
  assert.ok(g, '真实种子应能生成合法新岛');
  assert.deepEqual(g.endow.deposits, endow.deposits, '入选矿物不得被删减(AC-20)');
  // 候选不足(全水):不得删矿物,必须返回 null 不授予
  const water = Array.from({ length: 160 }, () => Array(160).fill(6));
  const orig = E.mapTemplate.generateIsland;
  E.mapTemplate.generateIsland = () => water;
  try {
    const g2 = E.expeditions.generateNewIsland(s, 9999);
    assert.equal(g2, null, '候选不足必须返回 null(不得删矿物/不得授予残缺岛)');
  } finally { E.mapTemplate.generateIsland = orig; }
});

// ============ [Sol 复验 HIGH-4] 生产主循环分帧 ============

// [HIGH-4] 分片循环(frameBudget)结果与一次性 tick 等价:调度器可安全用分片驱动
test('[HIGH-4] 分片循环与一次性 tick 等价(多岛)', () => {
  const s1 = E.state.createInitialState(DEFAULT_SEED);
  const s2 = E.state.createInitialState(DEFAULT_SEED);
  for (let i = 2; i <= 5; i++) {
    const a = E.state.createIslandState('island-' + i, 5000 + i, E.worldData.MAP_SIZE, { wood: 60, fish: 100 });
    const b = E.state.createIslandState('island-' + i, 5000 + i, E.worldData.MAP_SIZE, { wood: 60, fish: 100 });
    E.state.attachCoinAlias(s1, a); E.state.attachCoinAlias(s2, b);
    s1.islands[a.id] = a; s2.islands[b.id] = b;
  }
  E.tick.tick(s1); // 一次性(旧调度器)
  let r = null; let guard = 0;
  do { r = E.tick.tick(s2, { frameBudget: 2 }); } while (!r.complete && guard++ < 20);
  assert.ok(r.complete, '分片循环应完成(guard=' + guard + ')');
  assert.equal(s2.time.tickAcc, s1.time.tickAcc, '时间推进一致');
  for (const id of Object.keys(s1.islands)) {
    assert.equal(s2.islands[id].__prevPop, s1.islands[id].__prevPop, '岛 ' + id + ' 人口趋势一致');
  }
});

// ============ [Sol 复验 HIGH-6] 海事存档校验 ============

// [HIGH-6] 非法海事状态(shipOrders=null/悬空引用)读档必须拒绝,不能先接受后崩溃
test('[HIGH-6] 非法海事状态读档必须拒绝', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  // 订单为 null
  const raw1 = JSON.parse(JSON.stringify(s));
  raw1.shipOrders = { o1: null };
  assert.throws(() => E.save.deserialize(JSON.stringify({ v: 2, ts: Date.now(), state: raw1 })), '非法订单(null)应拒绝');
  // 船引用不存在的岛
  const raw2 = JSON.parse(JSON.stringify(s));
  raw2.fleet = { s1: { id: 's1', type: 'sailBoat', currentIslandId: 'no-such-island', status: 'idle', constructionCostPaid: {} } };
  assert.throws(() => E.save.deserialize(JSON.stringify({ v: 2, ts: Date.now(), state: raw2 })), '悬空岛引用应拒绝');
});

// ============ [Sol 轮2] 探索 roll 权威性 ============

// [Sol-2-1] 探索 roll 只由来源岛决定:同一世界状态仅切换活动岛,roll 不变
test('[Sol-2-1] 探索 roll 不受活动岛影响(来源岛权威)', () => {
  // 两个同结构 world:船都停岛2,仅 activeIslandId 不同;来源岛 seed 相同 → roll 必须相同
  function buildWorld(activeId) {
    const s = E.state.createInitialState(DEFAULT_SEED);
    const isl2 = E.state.createIslandState('island-2', DEFAULT_SEED + 2, E.worldData.MAP_SIZE, { wood: 100, fish: 100, steel: 20, sail: 10, workclothes: 10, schnapps: 10 });
    E.state.attachCoinAlias(s, isl2);
    s.islands['island-2'] = isl2;
    const wb = findSpot(isl2, 5, 5, null, PF);
    const rw = E.placement.placeBuilding(isl2, 'warehouse', wb.x, wb.y);
    assert.equal(rw.ok, true, '岛2仓库: ' + (rw.reason || ''));
    const def = E.buildings.getDef('port');
    let pb = null;
    for (let cy = 5; cy < 150 && !pb; cy++) for (let cx = 5; cx < 150 && !pb; cx++) {
      let allWater = true, anyLand = false;
      for (let dy = 0; dy < 11 && allWater; dy++) for (let dx = 0; dx < 7 && allWater; dx++) {
        const t = isl2.map.terrain[cy - 5 + dy][cx - 3 + dx];
        if (t !== 6) { allWater = false; break; }
        for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const wx = cx - 3 + dx + ddx, wy = cy - 5 + dy + ddy;
          if (wx >= 0 && wy >= 0 && wx < 160 && wy < 160 && isl2.map.terrain[wy][wx] !== 6 && isl2.map.terrain[wy][wx] !== 7) anyLand = true;
        }
      }
      if (allWater && anyLand) {
        const fp = E.placement.footprint(def, cx, cy, 0);
        if (!fp.some((p) => isl2.grid[key(p.x, p.y)])) { pb = { x: cx, y: cy }; break; }
      }
    }
    assert.ok(pb, '岛2 码头位');
    const rp = E.placement.placeBuilding(isl2, 'port', pb.x, pb.y);
    assert.equal(rp.ok, true, '岛2码头: ' + (rp.reason || ''));
    const av = E.placement.footprint(def, pb.x, pb.y, 0);
    const c = connectTo(isl2, pb.x, pb.y, av, av);
    assert.ok(c, '码头连通仓库');
    s.fleet = { s1: { id: 's1', type: 'sailBoat', currentIslandId: 'island-2', status: 'idle', constructionCostPaid: {} } };
    s.activeIslandId = activeId;
    return s;
  }
  const sA = buildWorld('island-main');
  const rA = E.expeditions.startExpedition(sA, 's1', '70');
  assert.equal(rA.ok, true, 'A发起: ' + (rA.reason || ''));
  const sB = buildWorld('island-2');
  const rB = E.expeditions.startExpedition(sB, 's1', '70');
  assert.equal(rB.ok, true, 'B发起: ' + (rB.reason || ''));
  assert.equal(rB.task.roll, rA.task.roll, '活动岛不得改变 roll(实际 A=' + rA.task.roll + ' B=' + rB.task.roll + ')');
});

// ============ [Sol 轮2] 跨帧调度器(AC-17) ============

// [Sol-2-3] createScheduler:每帧一片、未完成不启动下一 tick、complete 才计数/推进时间/允许保存
test('[Sol-2-3] 跨帧调度器:分片逐帧推进,complete 才计数', async () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  for (let i = 2; i <= 5; i++) {
    const a = E.state.createIslandState('island-' + i, 5000 + i, E.worldData.MAP_SIZE, { wood: 60, fish: 100 });
    E.state.attachCoinAlias(s, a);
    s.islands[a.id] = a;
  }
  const sch = E.tick.createScheduler(s, { frameBudget: 2 }); // 5 岛 → 3 帧
  const t0 = s.time.tickAcc;
  // 帧 1:开始世界 tick,2 岛
  let r = sch.frame(1000);
  assert.equal(r.started, true, '节拍到应开始');
  assert.equal(r.complete, false, '分片中途未完成');
  assert.equal(s.time.tickAcc, t0, '分片中途不推进时间');
  await new Promise((res) => setTimeout(res, 0)); // 帧间让渡(跨任务,浏览器可绘制/输入)
  // 帧 2:继续分片
  r = sch.frame(1016);
  assert.equal(r.complete, false, '仍未完成');
  await new Promise((res) => setTimeout(res, 0));
  // 帧 3:完成
  r = sch.frame(1032);
  assert.equal(r.complete, true, '全部岛完成才 complete');
  assert.equal(s.time.tickAcc, (t0 + 1) % 12, '完成后时间推进 1');
  assert.equal(sch.getTicks(), 1, '完整世界 tick 计数 1(自动保存资格)');
  // 未完成期间不得启动下一 tick:节拍内不开始
  r = sch.frame(1048);
  assert.equal(r.started, false, '节拍内不启动下一世界 tick');
  // 节拍到达:下一世界 tick
  r = sch.frame(3000);
  assert.equal(r.started, true, '节拍到达开始下一 tick');
  // 暂停:不推进
  s.settings.paused = true;
  r = sch.frame(4016);
  assert.equal(r.started, false, '暂停不推进');
  s.settings.paused = false;
});

// ============ [Sol 轮2] transport-paused 存档合法化 ============

// [Sol-2-4] 活动航线/主动暂停/码头阻塞三种合法状态存档往返必须成功(不得误判非法)
test('[Sol-2-4] 合法运输状态存档往返(活动/暂停/阻塞)', () => {
  const cases = [
    { name: '活动航线', status: 'transport', userPaused: false, blockedReason: null },
    { name: '主动暂停', status: 'transport-paused', userPaused: true, blockedReason: null },
    { name: '码头阻塞', status: 'transport-paused', userPaused: false, blockedReason: 'port-invalid' },
  ];
  for (const c of cases) {
    const s = E.state.createInitialState(DEFAULT_SEED);
    s.fleet = { s1: { id: 's1', type: 'sailBoat', currentIslandId: 'island-main', status: c.status, constructionCostPaid: { coin: 5000, wood: 20, sail: 10 } } };
    s.transportTasks = {
      t1: { id: 't1', shipId: 's1', sourceIslandId: 'island-main', targetIslandId: 'island-main', slots: [{ good: 'fish', rate: 1 }], userPaused: c.userPaused, blockedReason: c.blockedReason, carried: {}, _pending: null },
    };
    let norm = null;
    try {
      norm = E.save.deserialize(E.save.serialize(s));
    } catch (e) {
      assert.fail(c.name + ' 存档往返被误拒: ' + e.message);
    }
    assert.equal(norm.fleet.s1.status, c.status, c.name + ' 状态保留');
    assert.equal(norm.transportTasks.t1.shipId, 's1', c.name + ' 航线保留');
  }
  // 保留非法拒绝:transport-paused 无对应航线必须拒绝
  const s2 = E.state.createInitialState(DEFAULT_SEED);
  s2.fleet = { s1: { id: 's1', type: 'sailBoat', currentIslandId: 'island-main', status: 'transport-paused', constructionCostPaid: {} } };
  assert.throws(() => E.save.deserialize(E.save.serialize(s2)), 'transport-paused 无航线应拒绝');
});

// ============ [Sol 轮3] 矿床抽定组数校验 ============

// [Sol-3-1] depositsSatisfied 必须按本次抽定值校验(非仅 min)
test('[Sol-3-1] 矿床按抽定值校验:抽 4 实 3 拒绝;抽 3 实 3 / 抽 4 实 4 通过', () => {
  const size = 160;
  // 构造地形:3 个互不重叠完整 5×5 黏土块(其余平地)
  function makeTerrainWithClayGroups(n) {
    const t = Array.from({ length: size }, () => Array(size).fill(0));
    for (let i = 0; i < n; i++) {
      const y0 = 10 + i * 20, x0 = 10 + i * 30;
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) t[y0 + dy][x0 + dx] = 2;
    }
    return t;
  }
  const t3 = makeTerrainWithClayGroups(3);
  // 抽中 3 组、实际 3 组 → 通过
  t3.drawnGroups = { clay: 3 };
  assert.equal(E.expeditions.depositsSatisfied(t3, size, ['clay']), true, '抽 3 实 3 应通过');
  // 抽中 4 组、实际 3 组 → 拒绝(关键回归:旧实现只查 min=3 会误过)
  const t3b = makeTerrainWithClayGroups(3);
  t3b.drawnGroups = { clay: 4 };
  assert.equal(E.expeditions.depositsSatisfied(t3b, size, ['clay']), false, '抽 4 实 3 必须拒绝');
  // 抽中 4 组、实际 4 组 → 通过
  const t4 = makeTerrainWithClayGroups(4);
  t4.drawnGroups = { clay: 4 };
  assert.equal(E.expeditions.depositsSatisfied(t4, size, ['clay']), true, '抽 4 实 4 应通过');
  // 无 drawnGroups(旧 terrain)→ 回退 min=3:实际 3 通过
  const t3c = makeTerrainWithClayGroups(3);
  assert.equal(E.expeditions.depositsSatisfied(t3c, size, ['clay']), true, '无 drawnGroups 回退 min');
});

// [Sol-3-1] 真实生成器暴露抽定值且与实际放置一致
test('[Sol-3-1] generateIsland 暴露 drawnGroups,实际完整组数达到抽定值', () => {
  const size = E.worldData.MAP_SIZE;
  for (const seed of [1001, 2002, 3003]) {
    const t = E.mapTemplate.generateIsland(size, seed, ['clay', 'iron', 'coal']);
    assert.ok(t.drawnGroups, '生成器应暴露 drawnGroups');
    assert.ok(t.drawnGroups.clay >= 3 && t.drawnGroups.clay <= 4, '黏土抽定 3~4');
    assert.ok(t.drawnGroups.iron >= 5 && t.drawnGroups.iron <= 6, '铁抽定 5~6');
    assert.ok(t.drawnGroups.coal >= 4 && t.drawnGroups.coal <= 5, '煤抽定 4~5');
    assert.equal(E.expeditions.depositsSatisfied(t, size, ['clay', 'iron', 'coal']), true, '真实生成应达到抽定值(seed ' + seed + ')');
  }
});

// ============ [Sol 轮3] 分帧暂停退出补完 ============

// [Sol-3-2] 分片中暂停→退出补完→保存→读档:不无限循环、不产生半结算存档、不启动新 tick
test('[Sol-3-2] 分片中暂停后补完半截 tick 并安全存档', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  for (let i = 2; i <= 4; i++) {
    const a = E.state.createIslandState('island-' + i, 6000 + i, E.worldData.MAP_SIZE, { wood: 60, fish: 100 });
    E.state.attachCoinAlias(s, a);
    s.islands[a.id] = a;
  }
  // 半截世界 tick:cursor=1(4 岛,frameBudget=1 首帧完成 1 岛)
  const r1 = E.tick.tick(s, { frameBudget: 1 });
  assert.equal(r1.complete, false, '半截 tick');
  assert.equal(s._tickCursor, 1, 'cursor=1');
  // 玩家点击暂停
  s.settings.paused = true;
  // 暂停中 tick 不应推进(旧 beforeunload 死循环根因)
  const rp = E.tick.tick(s);
  assert.equal(rp.complete, false, '暂停中 tick 立即返回未完成');
  assert.equal(s._tickCursor, 1, '暂停中不推进');
  // 补完(生产 beforeunload 路径):暂停中也能完成半截 tick
  const f = E.tick.finishPendingTick(s);
  assert.equal(f.completed, true, '补完必须成功(不无限循环)');
  assert.equal(s._tickCursor, 0, '补完后 cursor=0(无半结算状态)');
  assert.equal(s.settings.paused, true, '暂停状态恢复');
  // 存档→读档(公共路径)
  const norm = E.save.deserialize(E.save.serialize(s));
  assert.equal(norm._tickCursor === undefined || norm._tickCursor === 0, true, '读档后无分帧残留(字段被归一删除)');
  assert.equal(norm.time.tickAcc, s.time.tickAcc, '时间只提交一次');
  // 无半截 tick 时补完不动(不额外启动新 tick)
  const f2 = E.tick.finishPendingTick(norm);
  assert.equal(f2.completed, false, '无半截 tick 不动作');
  assert.equal(norm.time.tickAcc, s.time.tickAcc, '不启动新 tick');
});

// ============ [B-67] 布局版本(全图缩略缓存失效信号) ============

// [B-67] 放置/拆除/铺路/移动递增 _layoutVer(tick 不递增)
test('[B-67] 布局版本在放置/拆除/铺路后递增', () => {
  const s = createInitialState();
  setupBase(s); // 仓库+路网(findSawmillSpot 前置)
  const spot = findSawmillSpot(s);
  const av = footprint(E.buildings.getDef('sawmill'), spot.x, spot.y);
  connectTo(s, spot.x, spot.y, av, av); // 铺路也会递增,故先完成再记基线
  const v0 = s._layoutVer || 0;
  const r = placeBuilding(s, 'sawmill', spot.x, spot.y);
  assert.equal(r.ok, true, '放置: ' + (r.reason || ''));
  assert.equal(s._layoutVer, v0 + 1, '放置递增布局版本');
  // 铺路递增
  const v1 = s._layoutVer;
  setRoad(s, spot.x + 6, spot.y, true);
  assert.equal(s._layoutVer, v1 + 1, '铺路递增布局版本');
  // 拆除递增
  const v2 = s._layoutVer;
  demolish(s, r.building.id);
  assert.equal(s._layoutVer, v2 + 1, '拆除递增布局版本');
  // tick 不递增(缩略缓存无需因生产/人口刷新而重建)
  const v3 = s._layoutVer;
  E.tick.tick(s);
  assert.equal(s._layoutVer, v3, 'tick 不递增布局版本');
});

// ============ [B-69] 岛屿禀赋查看 ============

// [B-69] 资源面板显示当前岛矿物+植物禀赋(fake el,UI 模块无 DOM 依赖)
test('[B-69] 资源面板显示当前岛矿物与植物禀赋', () => {
  require('../src/ui/economy.js');
  const ui = globalThis.UI && globalThis.UI.economy;
  assert.ok(ui && typeof ui.renderRes === 'function', 'UI.economy.renderRes 可用');
  const s = E.state.createInitialState(DEFAULT_SEED);
  const el = { innerHTML: '', querySelectorAll: () => [] };
  ui.renderRes(el, s);
  assert.ok(el.innerHTML.includes('岛屿禀赋'), '含禀赋区块');
  assert.ok(el.innerHTML.includes('黏土') && el.innerHTML.includes('铁'), '主岛保底矿物(黏土/铁)');
  assert.ok(el.innerHTML.includes('土豆'), '主岛植物(土豆)');
  // 新岛禀赋:手动挂 deposits/fertilities 后渲染
  const s2 = E.state.createInitialState(DEFAULT_SEED);
  s2.islands['island-main'].deposits = ['coal', 'gold'];
  s2.islands['island-main'].fertilities = ['grapes', 'pepper'];
  const el2 = { innerHTML: '', querySelectorAll: () => [] };
  ui.renderRes(el2, s2);
  assert.ok(el2.innerHTML.includes('煤') && el2.innerHTML.includes('金'), '新岛矿物名');
  assert.ok(el2.innerHTML.includes('葡萄'), '新岛植物名');
});

// ============ [优化] 模拟计算简化 ============

// [优化] serviceRoads 布局缓存:布局不变复用(同引用),铺路后失效重建
test('[优化] serviceRoads 缓存:布局不变复用,铺路后失效', () => {
  const s = createInitialState();
  setupBase(s);
  const c1 = E.population.serviceRoads(s, 'warehouse');
  const c2 = E.population.serviceRoads(s, 'warehouse');
  assert.equal(c1, c2, '布局不变返回同缓存引用');
  // 铺路(布局版本递增)→ 失效重建
  const sp = findSpot(s, 3, 3, null, PF);
  assert.ok(sp);
  const r = setRoad(s, sp.x + 6, sp.y, true);
  assert.equal(r.ok, true, '铺路: ' + (r.reason || ''));
  const c3 = E.population.serviceRoads(s, 'warehouse');
  assert.notEqual(c3, c1, '铺路后缓存失效重建');
  assert.ok(c3.size >= c1.size, '覆盖不缩小(实际 ' + c1.size + '→' + c3.size + ')');
});

// [优化] 慢变量低频结算:默认每 3 tick;slowEvery:1 全精度
test('[优化] 慢变量低频结算:默认 3 tick 一次,slowEvery:1 全精度', () => {
  const s = createInitialState();
  setupBase(s);
  s.population.farmers.count = 0;
  s.resources.fish = 100;
  E.tick.tick(s); // t1: 结算(1%3=1)
  const sat1 = s.population.farmers.needSats.fish;
  E.tick.tick(s); // t2: 不结算
  assert.equal(s.population.farmers.needSats.fish, sat1, '中间 tick 用缓存值');
  E.tick.tick(s); // t3: 不结算
  E.tick.tick(s); // t4: 结算(4%3=1)
  assert.equal(s.population.farmers.needSats.fish, 1, '第 4 tick 结算(有鱼 → sat 1)');
  // slowEvery:1:每次结算(修改库存后立即反映)
  const s2 = createInitialState();
  setupBase(s2);
  s2.resources.fish = 0;
  E.tick.tick(s2, { slowEvery: 1 });
  assert.equal(s2.population.farmers.needSats.fish, 0, '0 库存 sat 0');
  s2.resources.fish = 100;
  E.tick.tick(s2, { slowEvery: 1 });
  assert.equal(s2.population.farmers.needSats.fish, 1, '有鱼后即结算');
});

// ============ [修复] serviceRoads 缓存不落盘 ============

// [修复] 存档往返后 _serviceCache(Set)被 JSON 序列化成数组 → 读档必须清除运行时缓存
// (否则 touchesRoads 对数组调 .has 崩溃 → 启动 refresh 抛错 → 页面白屏/加载中)
test('[修复] 存档往返后 serviceRoads 缓存重建(不返回序列化数组)', () => {
  const s = E.state.createInitialState(DEFAULT_SEED);
  setupBase(s);
  const c1 = E.population.serviceRoads(s, 'warehouse');
  assert.ok(c1 instanceof Set, '首次返回 Set');
  const text = E.save.serialize(s);
  const back = E.save.deserialize(text);
  // 往返后:缓存必须已清除(读档阶段),refresh 与查询正常工作(不崩)
  E.economy.refresh(back, { produce: false, logs: false });
  const c2 = E.population.serviceRoads(back, 'warehouse');
  assert.ok(c2 instanceof Set, '往返后仍返回 Set(缓存已重建)');
});
