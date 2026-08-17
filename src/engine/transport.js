/* transport.js — 岛间持续运输 [B-65]
 * 规则来源:REQ-39(运输段)/REQ-40、AC-24、MI-13、architecture 14 节
 * 世界层实体:world.transportTasks;命令(编辑/暂停/恢复/取消)排到下一完整世界 tick 边界原子提交
 */
(function (root) {
  'use strict';
  const st = root.Engine.state;
  // 跨模块依赖运行时读取(AGENTS 硬性约定 #3)
  const ships = () => root.Engine.ships;
  const goodsApi = () => root.Engine.goods;

  const SLOT_MAX = 5;       // [MI-13] 每槽 0~5 单位/min
  const SLOT_STEP = 0.1;    // 配置步长
  const SHIP_MAX = 10;      // 双槽整船最大 10 单位/min
  const MAX_SLOTS = 2;

  // 槽配置校验:≤2 槽、rate ∈ [0,5] 且步长 0.1、整船 ≤10、商品不重复
  function validateSlots(slots) {
    if (!Array.isArray(slots) || slots.length > MAX_SLOTS) return '槽位最多 ' + MAX_SLOTS + ' 个';
    const seen = new Set();
    let total = 0;
    for (const s of slots) {
      const rate = Number(s.rate);
      if (!(rate >= 0 && rate <= SLOT_MAX)) return '速率须在 0~' + SLOT_MAX + ' 单位/min';
      if (Math.round(rate * 10) / 10 !== rate) return '速率步长须为 0.1';
      if (!s.good || seen.has(s.good)) return '商品不可重复';
      seen.add(s.good);
      total += rate;
    }
    if (total > SHIP_MAX) return '双槽整船最大 ' + SHIP_MAX + ' 单位/min';
    return null;
  }

  // [REQ-39/AC-24] 创建航线:绑定 idle 船 + 来源岛(船当前岛)+ 目标岛 + 两槽配置
  function createTransportTask(world, shipId, targetIslandId, slots) {
    const ship = world.fleet && world.fleet[shipId];
    if (!ship) return { ok: false, reason: '船不存在' };
    if (ship.status !== 'idle') return { ok: false, reason: '需要空闲船' };
    if (!world.islands[targetIslandId]) return { ok: false, reason: '目标岛不存在' };
    if (targetIslandId === ship.currentIslandId) return { ok: false, reason: '目标岛不能是来源岛' };
    if (!ships().portValid(world, ship.currentIslandId)) return { ok: false, reason: '来源码头无效(需建成且连通仓库)' };
    const err = validateSlots(slots || []);
    if (err) return { ok: false, reason: err };
    world._nextTaskId = (world._nextTaskId || 0) + 1;
    const taskId = 't' + world._nextTaskId;
    world.transportTasks = world.transportTasks || {};
    world.transportTasks[taskId] = {
      id: taskId, shipId, sourceIslandId: ship.currentIslandId, targetIslandId,
      slots: slots.map((s) => ({ good: s.good, rate: Number(s.rate) })),
      userPaused: false,
      blockedReason: null,
      carried: {},
      _pending: null, // 下一完整世界 tick 原子提交
    };
    ship.status = 'transport';
    return { ok: true, task: world.transportTasks[taskId] };
  }

  // [REQ-39] 编辑:只允许改两槽商品与速率(来源/目标/分配船不可热改,须取消重建)
  function editTransportTask(world, taskId, slots) {
    const t = world.transportTasks && world.transportTasks[taskId];
    if (!t) return { ok: false, reason: '航线不存在' };
    const err = validateSlots(slots || []);
    if (err) return { ok: false, reason: err };
    t._pending = Object.assign({}, t._pending, { slots: slots.map((s) => ({ good: s.good, rate: Number(s.rate) })) });
    return { ok: true };
  }

  // [REQ-39] 主动暂停:停止运输但保留航线与绑定,继续支付维护,暂停中可编辑
  function pauseTransportTask(world, taskId) {
    const t = world.transportTasks && world.transportTasks[taskId];
    if (!t) return { ok: false, reason: '航线不存在' };
    t._pending = Object.assign({}, t._pending, { userPaused: true });
    return { ok: true };
  }

  // [REQ-39] 恢复:清除主动暂停;来源码头仍无效则继续阻塞(两状态独立)
  function resumeTransportTask(world, taskId) {
    const t = world.transportTasks && world.transportTasks[taskId];
    if (!t) return { ok: false, reason: '航线不存在' };
    t._pending = Object.assign({}, t._pending, { userPaused: false });
    return { ok: true };
  }

  // [REQ-39] 取消:活动/暂停/阻塞均可无条件取消;不要求码头、不收费;下一边界船解绑为来源岛 idle;不回滚
  function cancelTransportTask(world, taskId) {
    const t = world.transportTasks && world.transportTasks[taskId];
    if (!t) return { ok: false, reason: '航线不存在' };
    t._pending = Object.assign({}, t._pending, { cancel: true });
    return { ok: true };
  }

  // [architecture 12] 世界 tick 开始:基于 tick 开始库存计算运输请求与比例分配(暂存,不立即扣/加);
  // 完整世界 tick 结束时统一提交(岛模拟后的库存变化不影响本次分配)
  function beginTransport(world) {
    if (!world.transportTasks) return;
    // ① 边界提交
    for (const t of Object.values(world.transportTasks)) {
      const p = t._pending;
      if (!p) continue;
      if (p.cancel) {
        const ship = world.fleet && world.fleet[t.shipId];
        if (ship) { ship.status = 'idle'; ship.currentIslandId = t.sourceIslandId; }
        delete world.transportTasks[t.id];
        continue;
      }
      if (p.slots) t.slots = p.slots;
      if (p.userPaused !== undefined) t.userPaused = p.userPaused;
      t._pending = null;
    }
    // ② 派生阻塞(来源码头失效;复连自动解除;与 userPaused 独立)
    for (const t of Object.values(world.transportTasks)) {
      t.blockedReason = ships().portValid(world, t.sourceIslandId) ? null : 'port-invalid';
    }
    // ③ 活动任务按 (来源, 商品) 汇总请求,比例原子分配(结果不依赖遍历顺序)
    const demand = {};
    const plan = [];
    for (const t of Object.values(world.transportTasks)) {
      if (t.userPaused || t.blockedReason) continue;
      for (const s of t.slots) {
        if (!s.rate) continue;
        const k = t.sourceIslandId + '\u0000' + s.good;
        (demand[k] = demand[k] || []).push({ task: t, good: s.good, req: s.rate / 60 });
      }
    }
    for (const [k, list] of Object.entries(demand)) {
      const sep = k.indexOf('\u0000');
      const srcId = k.slice(0, sep), good = k.slice(sep + 1);
      const island = world.islands[srcId];
      if (!island) continue;
      const available = island.resources[good] || 0; // tick 开始库存快照
      const totalReq = list.reduce((s, x) => s + x.req, 0);
      if (totalReq <= 0) continue;
      const ratio = Math.min(1, available / totalReq);
      for (const item of list) {
        const amount = item.req * ratio;
        if (amount) plan.push({ task: item.task, good, source: srcId, target: item.task.targetIslandId, amount });
      }
    }
    world._transportPlan = plan;
    // ④ 船状态同步(绑定/暂停/阻塞均不可退役)
    for (const t of Object.values(world.transportTasks)) {
      const ship = world.fleet && world.fleet[t.shipId];
      if (ship) ship.status = (t.userPaused || t.blockedReason) ? 'transport-paused' : 'transport';
    }
  }

  // 完整世界 tick 结束:统一提交运输结果(扣来源/加目标/累计 carried)
  function commitTransport(world) {
    const plan = world._transportPlan;
    world._transportPlan = null;
    if (!plan) return;
    for (const item of plan) {
      const src = world.islands[item.source];
      const tgt = world.islands[item.target];
      if (src) src.resources[item.good] = (src.resources[item.good] || 0) - item.amount;
      if (tgt) tgt.resources[item.good] = (tgt.resources[item.good] || 0) + item.amount;
      item.task.carried = item.task.carried || {};
      item.task.carried[item.good] = (item.task.carried[item.good] || 0) + item.amount;
    }
  }

  const api = {
    SLOT_MAX, SLOT_STEP, SHIP_MAX, MAX_SLOTS,
    validateSlots, createTransportTask, editTransportTask,
    pauseTransportTask, resumeTransportTask, cancelTransportTask,
    beginTransport, commitTransport,
  };
  root.Engine = root.Engine || {};
  root.Engine.transport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
