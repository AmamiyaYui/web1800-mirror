/* state.js — 游戏状态容器与变更(唯一修改状态处) */
(function (root) {
  'use strict';
  const { generateIsland } = root.Engine.mapTemplate;
  const { getDef } = root.Engine.buildings;
  const events = root.Engine.events;

  function key(x, y) { return x + ',' + y; }

  const ISLAND_ALIAS_FIELDS = [
    'map', 'resources', 'buildings', 'grid', 'roads', 'population', 'happiness',
    'unlocks', 'log', 'nextId', '_conn', 'flow', 'rates', 'ratesHistory', '_wf', '__prevPop',
  ];

  function createPopulation() {
    return {
      farmers: { count: 0, satisfaction: 0 },
      workers: { count: 0, satisfaction: 0 },
      artisans: { count: 0, satisfaction: 0 },
      engineers: { count: 0, satisfaction: 0 },
      investors: { count: 0, satisfaction: 0 },
    };
  }

  // [B-64] 确定性 LCG 选择(seed 派生;不依赖地图 rng 序列)
  function pickN(seed, pool, n) {
    const arr = pool.slice();
    const out = [];
    let s = (seed >>> 0) || 1;
    for (let i = 0; i < n && arr.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out.push(arr.splice(s % arr.length, 1)[0]);
    }
    return out;
  }

  // [B-64] createIslandState(id, seed, size, resources, deposits, fertilities, name)
  // deposits/fertilities 省略 = 全矿物 + 空禀赋(兼容旧调用);主岛与新岛由调用方按 REQ-37 传入
  // [B-62] 多岛同名问题:默认名 '新岛'(主岛由 createInitialState 显式传 '主岛')
  function createIslandState(id, seed, size, resources, deposits, fertilities, name) {
    return {
      id,
      name: name || '新岛',
      map: { size, terrain: generateIsland(size, seed, deposits || null), seed },
      resources: Object.assign({}, resources),
      buildings: {},
      grid: {},
      roads: {},
      population: createPopulation(),
      happiness: 60,
      unlocks: { farmers: true, workers: false, artisans: false, engineers: false, investors: false },
      log: [],
      nextId: 1,
      _conn: { dirty: true, ids: {} },
      fertilities: (fertilities || []).slice(),
      deposits: (deposits || []).slice(),
    };
  }

  function getActiveIsland(world) {
    if (!world || !world.islands) return world || null;
    return world.islands[world.activeIslandId] || null;
  }

  function attachCoinAlias(world, island) {
    const resources = island.resources || (island.resources = {});
    const legacyCoin = Object.prototype.hasOwnProperty.call(resources, 'coin') ? resources.coin : undefined;
    if (legacyCoin !== undefined && (!world.treasury || typeof world.treasury.coin !== 'number')) {
      world.treasury = { coin: legacyCoin };
    }
    delete resources.coin;
    Object.defineProperty(resources, 'coin', {
      enumerable: true,
      configurable: true,
      get: () => world.treasury.coin,
      set: (value) => { world.treasury.coin = value; },
    });
    Object.defineProperty(resources, 'toJSON', {
      enumerable: false,
      configurable: true,
      value: function () {
        const out = {};
        for (const k of Object.keys(this)) if (k !== 'coin') out[k] = this[k];
        return out;
      },
    });
  }

  // 兼容层只暴露活动岛，不进入JSON；B-62会让世界tick显式逐岛运行。
  function attachWorldAliases(world) {
    if (!world || !world.islands || !world.activeIslandId) return world;
    const island = getActiveIsland(world);
    if (!island) throw new Error('活动岛不存在');
    for (const ownedIsland of Object.values(world.islands)) attachCoinAlias(world, ownedIsland);
    for (const field of ISLAND_ALIAS_FIELDS) {
      Object.defineProperty(world, field, {
        enumerable: false,
        configurable: true,
        get: () => {
          const active = getActiveIsland(world);
          return active ? active[field] : undefined;
        },
        set: (value) => {
          const active = getActiveIsland(world);
          if (active) active[field] = value;
        },
      });
    }
    return world;
  }

  // [B-61] 新游戏:World根对象 + 单座160×160主岛；旧引擎通过活动岛兼容别名继续工作。
  function createInitialState(seed) {
    const worldData = root.Engine.worldData;
    if (!worldData) throw new Error('world-data未加载');
    const size = worldData.MAP_SIZE;
    seed = (seed === undefined || seed === null) ? ((Math.random() * 0xFFFFFFFF) >>> 0) : (seed >>> 0);
    const initial = worldData.MAIN_INITIAL_RESOURCES;
    // [B-64/REQ-37] 主岛 4 植物/4 矿物:保底(土豆/谷物/啤酒花 + 黏土/铁)+ 确定性随机补满
    const deposits = worldData.MAIN_BASE_DEPOSITS.concat(
      pickN(seed, worldData.MAIN_DEPOSIT_POOL, worldData.ISLAND_MAX_DEPOSITS - worldData.MAIN_BASE_DEPOSITS.length)
    );
    const fertilities = worldData.MAIN_BASE_FERTILITIES.concat(
      pickN(seed + 1, worldData.MAIN_FERTILITY_POOL, worldData.ISLAND_MAX_FERTILITIES - worldData.MAIN_BASE_FERTILITIES.length)
    );
    const island = createIslandState(
      worldData.MAIN_ISLAND_ID,
      seed,
      size,
      { wood: initial.wood, fish: initial.fish },
      deposits,
      fertilities,
      '灰冠岛 1'
    );
    const world = {
      version: worldData.SCHEMA_VERSION,
      schemaVersion: worldData.SCHEMA_VERSION,
      activeIslandId: worldData.MAIN_ISLAND_ID,
      maxOwnedIslands: worldData.MAX_OWNED_ISLANDS,
      treasury: { coin: initial.coin },
      islands: { [worldData.MAIN_ISLAND_ID]: island },
      migrations: { legacy128To160: false },
      settings: { speed: 1, paused: false },
      time: { day: 1, hour: 0, tickAcc: 0 }, // [V1.7] tickAcc:距下一小时已累计的 tick(12 tick/小时)
    };
    return attachWorldAliases(world);
  }

  function addBuildingRaw(state, type, x, y) {
    const def = getDef(type);
    if (!def) return null;
    const id = 'b' + (state.nextId++);
    const b = { id, type, x, y, level: 1, status: 'idle' };
    state.buildings[id] = b;
    state.grid[key(x, y)] = id;
    return b;
  }

  function removeBuildingRaw(state, id) {
    const b = state.buildings[id];
    if (!b) return;
    delete state.grid[key(b.x, b.y)];
    delete state.buildings[id];
  }

  function addLog(state, msg) {
    state.log.unshift(msg);
    if (state.log.length > 50) state.log.length = 50;
    events.emit('log', msg);
  }

  function canAfford(state, cost) {
    for (const [g, q] of Object.entries(cost || {})) {
      if ((state.resources[g] || 0) < q) return false;
    }
    return true;
  }

  function spend(state, cost) {
    for (const [g, q] of Object.entries(cost || {})) {
      state.resources[g] = (state.resources[g] || 0) - q;
    }
  }

  function setRoad(state, x, y, on, level) {
    const k = key(x, y);
    // [V1.10 修订⑤ 顺序3] 道路等级:1=土路(默认),2=石板路(服务传播 1.5 倍)
    if (on) state.roads[k] = level || 1;
    else delete state.roads[k];
  }

  // [V1.2] 每 tick 流量统计(ADR-018)
  function initFlow(state) {
    state.flow = {};
  }
  function addFlow(state, good, kind, qty) {
    if (!state.flow) state.flow = {};
    const f = state.flow[good] = state.flow[good] || { produced: 0, consumed: 0 };
    f[kind] = (f[kind] || 0) + qty;
  }

  const api = {
    key,
    createInitialState,
    createIslandState,
    getActiveIsland,
    attachWorldAliases,
    attachCoinAlias,
    addBuildingRaw,
    removeBuildingRaw,
    addLog,
    canAfford,
    spend,
    setRoad,
    initFlow,
    addFlow,
  };
  root.Engine = root.Engine || {};
  root.Engine.state = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
