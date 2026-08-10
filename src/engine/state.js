/* state.js — 游戏状态容器与变更(唯一修改状态处) */
(function (root) {
  'use strict';
  const { generateMap } = root.Engine.mapTemplate;
  const { getDef } = root.Engine.buildings;
  const events = root.Engine.events;

  function key(x, y) { return x + ',' + y; }

  // [V1.8] 新游戏:128×128 种子随机岛(椭圆骨架,紧凑),无预置建筑;[V1.10] 仓库=建筑菜单(服务类),开局自由建造
  function createInitialState(seed) {
    const size = 128;
    seed = (seed === undefined || seed === null) ? ((Math.random() * 0xFFFFFFFF) >>> 0) : (seed >>> 0);
    const state = {
      version: 1,
      settings: { speed: 1, paused: false },
      time: { day: 1, hour: 0, tickAcc: 0 }, // [V1.7] tickAcc:距下一小时已累计的 tick(12 tick/小时)
      map: { size, terrain: generateMap(size, seed), seed }, // [V1.8] 种子存档
      resources: { coin: 10000, wood: 60, fish: 300 }, // [V1.10] 开局金币 10000(玩家反馈:2500 太紧);鱼 300 缓冲(原版无库存,建渔场前用)
      buildings: {},   // id -> building
      grid: {},        // "x,y" -> buildingId
      roads: {},       // "x,y" -> 1=土路 2=石板路(truthy 兼容旧判断)
      population: {
        farmers: { count: 0, satisfaction: 0 }, // [B-43] 人口由需求满足驱动增长(新建住宅 0 人,无保底)
        workers: { count: 0, satisfaction: 0 },
        artisans: { count: 0, satisfaction: 0 },
        engineers: { count: 0, satisfaction: 0 },
        investors: { count: 0, satisfaction: 0 },
      },
      happiness: 60,
      unlocks: { farmers: true, workers: false, artisans: false, engineers: false, investors: false },
      log: [],
      nextId: 1,
      _conn: { dirty: true, ids: {} }, // [V1.8] 连通性惰性缓存(transient,存档序列化后 load 时 dirty 重建)
    };
    return state;
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

  const api = { key, createInitialState, addBuildingRaw, removeBuildingRaw, addLog, canAfford, spend, setRoad, initFlow, addFlow };
  root.Engine = root.Engine || {};
  root.Engine.state = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
