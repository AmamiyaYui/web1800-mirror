/* save.js — 存档:JSON schema 版本化,损坏备份+重置 */
(function (root) {
  'use strict';

  const SAVE_KEY = 'web1800-save-v1';
  const BAK_KEY = 'web1800-save-v1.bak';
  const PRE_MULTI_BACKUP_KEY = 'web1800-save-v1.pre-multi-island';
  const SAVE_VERSION = 2;

  function serialize(state) {
    return JSON.stringify({ v: SAVE_VERSION, ts: Date.now(), state });
  }

  // [P0/HIGH] ratesHistory 统一归一化(load 与 tick 运行时共用):
  // 顶层非普通对象 → 空对象;资源窗口要求 p/c/n 均为有限数值数组、三轨等长、≤60;
  // 不信任保存的 sp/sc/sn,按数组重算;重算结果须有限(有限元素求和仍可溢出 → 丢弃窗口);
  // __pop 单独验证 {n,sn}(n 为有限数值数组,sn 重算后同样须有限)
  function normalizeRatesHistory(rh) {
    if (!rh || typeof rh !== 'object' || Array.isArray(rh)) return {};
    const out = {};
    const isFiniteArr = (a) => Array.isArray(a) && a.every((v) => typeof v === 'number' && Number.isFinite(v));
    const sumFinite = (a) => {
      let s = 0;
      for (const v of a) s += v;
      return Number.isFinite(s) ? s : null; // 有限元素求和仍可能溢出(60×1e308 → Infinity)
    };
    for (const [g, h] of Object.entries(rh)) {
      if (g === '__pop') {
        if (!h || typeof h !== 'object' || !isFiniteArr(h.n)) continue;
        const n = h.n.slice(-60);
        const sn = sumFinite(n);
        if (sn === null) continue; // 溢出 → 丢弃窗口
        out[g] = { n, sn };
        continue;
      }
      if (!h || typeof h !== 'object' || !isFiniteArr(h.p) || !isFiniteArr(h.c) || !isFiniteArr(h.n)) continue;
      const L = Math.min(60, h.p.length, h.c.length, h.n.length);
      if (L <= 0) { out[g] = { p: [], c: [], n: [], sp: 0, sc: 0, sn: 0 }; continue; }
      const p = h.p.slice(-L), c = h.c.slice(-L), n = h.n.slice(-L);
      const sp = sumFinite(p), sc = sumFinite(c), sn = sumFinite(n);
      if (sp === null || sc === null || sn === null) continue; // 任一轨道溢出 → 丢弃整窗口
      out[g] = { p, c, n, sp, sc, sn };
    }
    return out;
  }

  function parseEnvelope(text) {
    const obj = JSON.parse(text);
    if (!obj || (obj.v !== 1 && obj.v !== SAVE_VERSION) || !obj.state) throw new Error('存档格式不兼容');
    return obj;
  }

  function plainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function tierIds() {
    const tiers = root.Engine && root.Engine.tiers && root.Engine.tiers.TIERS;
    if (!tiers) throw new Error('tiers未加载');
    return Object.keys(tiers);
  }

  function validateSettingsAndTime(settings, time) {
    if (!plainObject(settings) || ![1, 2, 3].includes(settings.speed) || typeof settings.paused !== 'boolean') {
      throw new Error('存档速度设置不兼容');
    }
    if (!plainObject(time) || !Number.isInteger(time.day) || time.day < 1 ||
        !Number.isInteger(time.hour) || time.hour < 0 || time.hour > 23 ||
        !Number.isInteger(time.tickAcc) || time.tickAcc < 0 || time.tickAcc >= 12) {
      throw new Error('存档时间格式不兼容');
    }
  }

  function validatePopulation(population) {
    if (!plainObject(population)) throw new Error('存档人口格式不兼容');
    for (const id of tierIds()) {
      const pop = population[id];
      if (!plainObject(pop) || !finiteNumber(pop.count) || pop.count < 0 ||
          (pop.satisfaction !== undefined && !finiteNumber(pop.satisfaction))) {
        throw new Error('存档人口阶层格式不兼容:' + id);
      }
    }
  }

  function validateUnlocks(unlocks) {
    if (!plainObject(unlocks)) throw new Error('存档解锁格式不兼容');
    for (const id of tierIds()) if (typeof unlocks[id] !== 'boolean') throw new Error('存档解锁格式不兼容:' + id);
  }

  function validateResources(resources) {
    if (!plainObject(resources)) throw new Error('存档资源格式不兼容');
    for (const [good, value] of Object.entries(resources)) {
      if (!good || !finiteNumber(value)) throw new Error('存档资源数值不兼容:' + good);
    }
  }

  function validateTerrain(map, size) {
    if (!plainObject(map) || map.size !== size || !Array.isArray(map.terrain) || map.terrain.length !== size) {
      throw new Error('存档地图尺寸不兼容');
    }
    for (const row of map.terrain) {
      if (!Array.isArray(row) || row.length !== size) throw new Error('存档地图尺寸不兼容');
      for (const cell of row) if (!Number.isInteger(cell) || cell < 0 || cell > 10) throw new Error('存档地形单元不兼容');
    }
  }

  function validateBuildings(buildings, requireKnownType, size) {
    if (!plainObject(buildings)) throw new Error('存档建筑格式不兼容');
    const defs = root.Engine && root.Engine.buildings;
    if (!defs) throw new Error('buildings未加载');
    for (const [id, building] of Object.entries(buildings)) {
      if (!id || !plainObject(building) || building.id !== id || typeof building.type !== 'string' || !building.type ||
          (requireKnownType && !defs.getDef(building.type)) ||
          !Number.isInteger(building.x) || !Number.isInteger(building.y) ||
          building.x < 0 || building.y < 0 || building.x >= size || building.y >= size ||
          (building.rot !== undefined && (!Number.isInteger(building.rot) || building.rot < 0 || building.rot > 3)) ||
          (building.level !== undefined && (!Number.isInteger(building.level) || building.level < 1))) {
        throw new Error('存档建筑字段不兼容:' + id);
      }
      if (building.rot === undefined) building.rot = 0;
    }
  }

  function validateNextId(buildings, nextId) {
    if (!Number.isInteger(nextId) || nextId < 1) throw new Error('存档nextId不兼容');
    let maxGeneratedId = 0;
    for (const id of Object.keys(buildings)) {
      const match = id.match(/^b([1-9]\d*)$/);
      if (match) maxGeneratedId = Math.max(maxGeneratedId, Number(match[1]));
    }
    if (nextId <= maxGeneratedId) throw new Error('存档nextId与建筑ID冲突');
  }

  function validateRoads(roads, size) {
    if (!plainObject(roads)) throw new Error('存档道路格式不兼容');
    for (const [key, level] of Object.entries(roads)) {
      const parts = key.split(',');
      const x = Number(parts[0]), y = Number(parts[1]);
      if (parts.length !== 2 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size ||
          (level !== 1 && level !== 2)) throw new Error('存档道路字段不兼容:' + key);
    }
  }

  function validateIslandRuntime(island, islandId, size) {
    if (!plainObject(island) || island.id !== islandId || typeof island.name !== 'string') throw new Error('岛屿存档格式不兼容');
    validateTerrain(island.map, size);
    validateResources(island.resources);
    validateBuildings(island.buildings, true, size);
    validateRoads(island.roads, size);
    validatePopulation(island.population);
    validateUnlocks(island.unlocks);
    if (!Array.isArray(island.log) || island.log.some((entry) => typeof entry !== 'string') ||
        !finiteNumber(island.happiness) ||
        !Array.isArray(island.fertilities) || !Array.isArray(island.deposits)) {
      throw new Error('岛屿运行时字段不兼容');
    }
    validateNextId(island.buildings, island.nextId);
  }

  function validateSerialized(text) {
    const obj = parseEnvelope(text);
    const state = obj.v === 1 ? migrateLegacyState(obj.state) : normalizeWorld(obj.state);
    return { version: obj.v, ts: obj.ts || 0, state };
  }

  function validateLegacyState(legacy) {
    const worldData = root.Engine && root.Engine.worldData;
    if (!worldData) throw new Error('world-data未加载');
    if (!plainObject(legacy)) throw new Error('旧存档格式不兼容');
    validateTerrain(legacy.map, worldData.LEGACY_MAP_SIZE);
    validateResources(legacy.resources);
    if (!Object.prototype.hasOwnProperty.call(legacy.resources, 'coin') || !finiteNumber(legacy.resources.coin)) {
      throw new Error('旧存档金币格式不兼容');
    }
    validateBuildings(legacy.buildings, false, worldData.LEGACY_MAP_SIZE);
    validateRoads(legacy.roads, worldData.LEGACY_MAP_SIZE);
    validatePopulation(legacy.population);
    validateUnlocks(legacy.unlocks);
    validateSettingsAndTime(legacy.settings, legacy.time);
    if (!Array.isArray(legacy.log) || legacy.log.some((entry) => typeof entry !== 'string') ||
        !finiteNumber(legacy.happiness)) {
      throw new Error('旧存档运行时字段不兼容');
    }
    validateNextId(legacy.buildings, legacy.nextId);
  }

  function migrateTerrain(oldTerrain, oldSize, newSize, offset) {
    const terrain = Array.from({ length: newSize }, () => Array(newSize).fill(6));
    for (let y = 0; y < oldSize; y++) for (let x = 0; x < oldSize; x++) {
      terrain[y + offset][x + offset] = oldTerrain[y][x] === 1 ? 0 : oldTerrain[y][x];
    }
    return terrain;
  }

  function shiftRoads(roads, offset, oldSize) {
    const shifted = {};
    for (const [k, level] of Object.entries(roads || {})) {
      const parts = k.split(',');
      const x = Number(parts[0]), y = Number(parts[1]);
      if (parts.length !== 2 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= oldSize || y >= oldSize) {
        throw new Error('旧存档道路坐标非法');
      }
      shifted[(x + offset) + ',' + (y + offset)] = level;
    }
    return shifted;
  }

  function shiftLegacyLog(log, offset, oldSize) {
    const patterns = [
      /^(建造:.+ \()(\d+),(\d+)(\))$/,
      /^(🚚 .+ 移动到 \()(\d+),(\d+)(\))$/,
    ];
    return log.map((entry) => {
      for (const pattern of patterns) {
        const match = entry.match(pattern);
        if (!match) continue;
        const x = Number(match[2]), y = Number(match[3]);
        if (x < oldSize && y < oldSize) {
          return match[1] + (x + offset) + ',' + (y + offset) + match[4];
        }
      }
      return entry;
    });
  }

  function rebuildGrid(buildings, size) {
    const engine = root.Engine || {};
    if (!engine.buildings || !engine.placement) throw new Error('建筑迁移依赖未加载');
    const grid = {};
    for (const b of Object.values(buildings || {})) {
      const def = engine.buildings.getDef(b.type);
      if (!def) throw new Error('旧存档包含未知建筑:' + b.type);
      for (const c of engine.placement.footprint(def, b.x, b.y, b.rot || 0)) {
        if (c.x < 0 || c.y < 0 || c.x >= size || c.y >= size) throw new Error('迁移后建筑越界:' + b.id);
        const k = c.x + ',' + c.y;
        if (grid[k] && grid[k] !== b.id) throw new Error('迁移后建筑重叠');
        grid[k] = b.id;
      }
    }
    return grid;
  }

  function deriveDeposits(terrain, mineralTypes) {
    const codeByType = { clay: 2, iron: 3, copper: 4, gold: 5, coal: 8, zinc: 9, limestone: 10 };
    const present = new Set();
    for (const row of terrain) for (const v of row) {
      for (const [type, code] of Object.entries(codeByType)) if (v === code) present.add(type);
    }
    return mineralTypes.filter((type) => present.has(type));
  }

  function migrateLegacyState(legacy) {
    validateLegacyState(legacy);
    const worldData = root.Engine.worldData;
    const offset = worldData.LEGACY_MAP_OFFSET;
    const oldSize = worldData.LEGACY_MAP_SIZE;
    const newSize = worldData.MAP_SIZE;
    const buildings = legacy.buildings;
    for (const b of Object.values(buildings)) {
      if (!Number.isInteger(b.x) || !Number.isInteger(b.y)) throw new Error('旧存档建筑坐标非法');
      b.x += offset;
      b.y += offset;
    }
    const terrain = migrateTerrain(legacy.map.terrain, oldSize, newSize, offset);
    const resources = {};
    for (const [good, qty] of Object.entries(legacy.resources)) if (good !== 'coin') resources[good] = qty;
    const island = {
      id: worldData.MAIN_ISLAND_ID,
      name: '灰冠岛 1',
      map: { size: newSize, terrain, seed: legacy.map.seed },
      resources,
      buildings,
      grid: {},
      roads: shiftRoads(legacy.roads, offset, oldSize),
      population: legacy.population,
      happiness: legacy.happiness,
      unlocks: legacy.unlocks,
      log: shiftLegacyLog(legacy.log, offset, oldSize),
      nextId: legacy.nextId,
      _conn: { dirty: true, ids: {} },
      fertilities: worldData.MAIN_FERTILITIES.slice(),
      deposits: deriveDeposits(terrain, worldData.MINERAL_TYPES),
    };
    for (const field of ['flow', 'rates', 'ratesHistory', '_wf', '__prevPop']) {
      if (Object.prototype.hasOwnProperty.call(legacy, field)) island[field] = legacy[field];
    }
    island.grid = rebuildGrid(buildings, newSize);
    const world = {
      version: worldData.SCHEMA_VERSION,
      schemaVersion: worldData.SCHEMA_VERSION,
      activeIslandId: worldData.MAIN_ISLAND_ID,
      maxOwnedIslands: worldData.MAX_OWNED_ISLANDS,
      treasury: { coin: legacy.resources.coin },
      islands: { [worldData.MAIN_ISLAND_ID]: island },
      migrations: { legacy128To160: true },
      settings: legacy.settings,
      time: legacy.time,
    };
    return normalizeWorld(world);
  }

  // [HIGH-6] 海事实体校验:fleet/shipOrders/relocationTasks/expeditionTasks/transportTasks
  // 结构合法 + 引用完整(岛/船存在)+ 计数合理;非法状态读档阶段拒绝(不得先接受后崩溃)
  function validateMaritime(world) {
    const islandIds = new Set(Object.keys(world.islands));
    const shipIds = new Set(Object.keys(world.fleet || {}));
    // [Sol 轮2] transport-paused = 运输中主动暂停/码头阻塞(transport.js 合法状态)
    const SHIP_STATUS = ['idle', 'transport', 'relocating', 'expedition', 'transport-paused'];
    for (const [id, ship] of Object.entries(world.fleet || {})) {
      if (!plainObject(ship) || ship.id !== id || typeof ship.type !== 'string' ||
          !islandIds.has(ship.currentIslandId) || !SHIP_STATUS.includes(ship.status) ||
          !plainObject(ship.constructionCostPaid)) {
        throw new Error('船队状态不兼容');
      }
      // [Sol 轮2] transport-paused 必须存在对应运输任务(暂停/阻塞来自航线状态)
      if (ship.status === 'transport-paused') {
        const hasTask = Object.values(world.transportTasks || {}).some((t) => t.shipId === ship.id);
        if (!hasTask) throw new Error('船队状态不兼容(transport-paused 无对应航线)');
      }
    }
    for (const [id, o] of Object.entries(world.shipOrders || {})) {
      if (!plainObject(o) || o.id !== id || !islandIds.has(o.islandId) ||
          typeof o.shipyardId !== 'string' || typeof o.shipType !== 'string' ||
          !plainObject(o.paidCost) || !Number.isInteger(o.totalWork) || !Number.isInteger(o.remainingWork) ||
          o.totalWork < 1 || o.remainingWork < 0 || o.remainingWork > o.totalWork) {
        throw new Error('造船订单状态不兼容');
      }
    }
    for (const [id, t] of Object.entries(world.relocationTasks || {})) {
      if (!plainObject(t) || t.id !== id || !shipIds.has(t.shipId) ||
          !islandIds.has(t.sourceIslandId) || !islandIds.has(t.targetIslandId) ||
          !Number.isInteger(t.remaining) || t.remaining < 0) {
        throw new Error('调遣任务状态不兼容');
      }
    }
    for (const [id, t] of Object.entries(world.expeditionTasks || {})) {
      if (!plainObject(t) || t.id !== id || !shipIds.has(t.shipId) ||
          !islandIds.has(t.sourceIslandId) || !['60', '70', '80', '90'].includes(t.tier) ||
          typeof t.successRate !== 'number' || typeof t.roll !== 'number' ||
          t.roll < 0 || t.roll >= 1 || !Number.isInteger(t.remaining) || t.remaining < 0) {
        throw new Error('探索任务状态不兼容');
      }
    }
    for (const [id, t] of Object.entries(world.transportTasks || {})) {
      if (!plainObject(t) || t.id !== id || !shipIds.has(t.shipId) ||
          !islandIds.has(t.sourceIslandId) || !islandIds.has(t.targetIslandId) ||
          !Array.isArray(t.slots) || t.slots.length > 2 ||
          t.slots.some((s) => !plainObject(s) || typeof s.good !== 'string' || typeof s.rate !== 'number')) {
        throw new Error('运输任务状态不兼容');
      }
    }
  }

  function normalizeWorld(world) {
    const worldData = root.Engine && root.Engine.worldData;
    if (!worldData || !world || world.schemaVersion !== SAVE_VERSION || !plainObject(world.islands) ||
        !world.islands[world.activeIslandId] || !plainObject(world.treasury) ||
        typeof world.treasury.coin !== 'number' || !Number.isFinite(world.treasury.coin) ||
        !Number.isInteger(world.maxOwnedIslands) || world.maxOwnedIslands < Object.keys(world.islands).length) {
      throw new Error('存档格式不兼容');
    }
    validateSettingsAndTime(world.settings, world.time);
    // [B-62] 分帧光标不落盘(半结算状态);加载时清理旧值
    delete world._tickCursor;
    // [修复] serviceRoads 运行时缓存不落盘:Set 被 JSON 序列化成数组,读档不清会命中数组 → touchesRoads 崩
    for (const island of Object.values(world.islands)) {
      delete island._serviceCache;
      if (island._layoutVer !== undefined) delete island._layoutVer; // 布局版本是运行时增量,读档重建
    }
    validateMaritime(world); // [HIGH-6] 海事实体结构/引用校验(读档拒绝非法状态)
    for (const [islandId, island] of Object.entries(world.islands)) {
      validateIslandRuntime(island, islandId, worldData.MAP_SIZE);
      // [B-62a] 主岛正式名「灰冠岛 1」:旧 v2 档主岛曾用名 '主岛',统一改名
      if (islandId === worldData.MAIN_ISLAND_ID && island.name === '主岛') island.name = '灰冠岛 1';
      if (Object.prototype.hasOwnProperty.call(island.resources, 'coin')) throw new Error('岛内不得保存金币');
      if (island.ratesHistory) island.ratesHistory = normalizeRatesHistory(island.ratesHistory);
      island.roads = shiftRoads(island.roads, 0, island.map.size);
      island.grid = rebuildGrid(island.buildings, island.map.size);
      island._conn = { dirty: true, ids: {} };
    }
    const stateApi = root.Engine && root.Engine.state;
    return stateApi && stateApi.attachWorldAliases ? stateApi.attachWorldAliases(world) : world;
  }

  // 抛错 = 存档非法；v1只在内存迁移，localStorage事务由load负责。
  function deserialize(text) {
    const obj = parseEnvelope(text);
    if (obj.v === 1) return migrateLegacyState(obj.state);
    return normalizeWorld(obj.state);
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.setItem(SAVE_KEY, serialize(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function migrationBlocked(message) {
    const e = new Error(message);
    e.code = 'MIGRATION_BLOCKED';
    return e;
  }

  // 返回存档 state;无存档/损坏/不可用 → null。迁移保护失败会抛出，阻止新游戏覆盖旧档。
  function load() {
    if (typeof localStorage === 'undefined') return null;
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      const envelope = parseEnvelope(raw);
      let state;
      if (envelope.v === 1) {
        validateLegacyState(envelope.state);
        try {
          const existingBackup = localStorage.getItem(PRE_MULTI_BACKUP_KEY);
          if (existingBackup === null) {
            localStorage.setItem(PRE_MULTI_BACKUP_KEY, raw);
            if (localStorage.getItem(PRE_MULTI_BACKUP_KEY) !== raw) throw new Error('永久备份写入未生效');
          }
        } catch (e) {
          throw migrationBlocked('无法保护并写入迁移存档，迁移已中止');
        }
        try {
          state = migrateLegacyState(envelope.state);
        } catch (e) {
          throw migrationBlocked('旧存档迁移失败，原始存档已保留，迁移已中止');
        }
        try {
          const migratedRaw = serialize(state);
          localStorage.setItem(SAVE_KEY, migratedRaw);
          if (localStorage.getItem(SAVE_KEY) !== migratedRaw) throw new Error('迁移主档写入未生效');
        } catch (e) {
          throw migrationBlocked('无法保护并写入迁移存档，迁移已中止');
        }
      } else {
        state = normalizeWorld(envelope.state);
      }
      return state;
    } catch (e) {
      if (e && e.code === 'MIGRATION_BLOCKED') throw e;
      try { localStorage.setItem(BAK_KEY, raw); } catch (e2) { /* 忽略 */ }
      return null;
    }
  }

  function clearSave() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 忽略 */ }
  }

  function restorePreMigrationBackup() {
    if (typeof localStorage === 'undefined') return false;
    let backup, current;
    try {
      backup = localStorage.getItem(PRE_MULTI_BACKUP_KEY);
      current = localStorage.getItem(SAVE_KEY);
    } catch (e) { throw new Error('无法读取本地存档'); }
    if (!backup) throw new Error('没有迁移前备份');
    if (!current) throw new Error('当前主存档不存在，未执行恢复');
    try {
      localStorage.setItem(BAK_KEY, current);
      if (localStorage.getItem(BAK_KEY) !== current) throw new Error('保护副本写入未生效');
    } catch (e) { throw new Error('无法保护当前主存档，未执行恢复'); }
    try {
      localStorage.setItem(SAVE_KEY, backup);
      if (localStorage.getItem(SAVE_KEY) !== backup) throw new Error('主档恢复写入未生效');
    } catch (e) { throw new Error('无法恢复迁移前备份'); }
    return true;
  }

  function deletePreMigrationBackup() {
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.removeItem(PRE_MULTI_BACKUP_KEY);
      return localStorage.getItem(PRE_MULTI_BACKUP_KEY) === null;
    } catch (e) { return false; }
  }


  const api = {
    SAVE_KEY,
    BAK_KEY,
    PRE_MULTI_BACKUP_KEY,
    SAVE_VERSION,
    serialize,
    deserialize,
    validateSerialized,
    migrateLegacyState,
    save,
    load,
    clearSave,
    restorePreMigrationBackup,
    deletePreMigrationBackup,
    normalizeRatesHistory,
  };
  root.Engine = root.Engine || {};
  root.Engine.save = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
