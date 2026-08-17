/* tick.js — 固定步进游戏循环(1s × 速度倍率,暂停时跳过) */
/* [B-62] 世界 tick:逐岛精确模拟;完整世界 tick 结束才统一推进时间/提交结算(REQ-32/AC-17) */
(function (root) {
  'use strict';
  const economy = root.Engine.economy;
  const population = root.Engine.population;
  const events = root.Engine.events;
  const st = root.Engine.state;

  // [V1.7] 时间流速:12 tick = 1 游戏小时(一天 288 tick;默认 2x 下小时显示每 6 秒变化一次)
  const TICKS_PER_HOUR = 12;

  // 单岛完整精确模拟(生产 → 需求消耗 → 人口 → 幸福度 → 需求收入 → 解锁)+ 岛级 rates 汇总
  // [B-62] 每岛独立 flow/rates/ratesHistory/__prevPop;岛模拟直接写 treasury(金币全局,见 architecture 12.1)
  // [优化] 慢变量低频结算:需求满足度/人口/幸福度/解锁每 slowEvery tick 结算(默认 3),
  // 中间 tick 用最近缓存值;生产/收入 collectTax 仍每 tick(收入用缓存 sat/pop,数值平滑)
  function simulateIsland(island, opts) {
    const o = opts || {};
    const slowEvery = o.slowEvery || 3;
    st.initFlow(island);
    economy.refresh(island, { produce: true, logs: true });
    island._simTick = (island._simTick || 0) + 1;
    if (slowEvery <= 1 || island._simTick % slowEvery === 1) { // [修复] slowEvery=1(全精度)恒结算;>1 时每 slowEvery tick 结算
      population.updateNeeds(island);
      population.updatePopulation(island);
      population.updateHappiness(island);
      population.checkUnlocks(island);
    }
    population.collectTax(island);
    // [V1.2] 汇总每 tick 流量 → island.rates(ADR-018)
    // [H-01] 滚动平均:60 tick 窗口平滑净速率(周期建筑不再 0/60 跳变);暂停时窗口不更新=保持最后稳定值
    // [M-04 fix] 收入/维护分别平滑(smoothProducedMin/smoothConsumedMin),避免"平滑净+即时维护"时间窗口不一致
    const rates = {};
    // [P0/HIGH] 运行时同规则归一化(与 load 一致):部分损坏窗口(缺失累计值/三轨不等长/NaN/null 污染)安全重建
    const norm = (root.Engine.save && root.Engine.save.normalizeRatesHistory) || (() => ({}));
    const win = island.ratesHistory = norm(island.ratesHistory);
    for (const [g, v] of Object.entries(island.resources)) {
      const f = island.flow[g] || { produced: 0, consumed: 0 };
      const net = f.produced - f.consumed;
      const h = win[g] = win[g] || { p: [], c: [], n: [], sp: 0, sc: 0, sn: 0 };
      h.p.push(f.produced); h.sp += f.produced;
      h.c.push(f.consumed); h.sc += f.consumed;
      h.n.push(net); h.sn += net;
      if (h.p.length > 60) {
        h.sp -= h.p.shift(); h.sc -= h.c.shift(); h.sn -= h.n.shift();
      }
      rates[g] = {
        produced: f.produced, consumed: f.consumed, net, stock: v,
        smoothMin: (h.sn / h.n.length) * 60,
        smoothProducedMin: (h.sp / h.p.length) * 60,
        smoothConsumedMin: (h.sc / h.c.length) * 60,
      };
    }
    island.rates = rates;
    // [M-01] 人口 /min 趋势:60 tick 窗口平滑人口变化(UI 显示 ↑↓ + 数值)
    const nowPop = Object.values(island.population).reduce((s, p) => s + p.count, 0);
    const ph = win['__pop'] = win['__pop'] || { n: [], sn: 0 };
    if (island.__prevPop != null) {
      const popDelta = nowPop - island.__prevPop;
      ph.n.push(popDelta);
      ph.sn += popDelta;
      if (ph.n.length > 60) { ph.sn -= ph.n.shift(); }
    }
    island.__prevPop = nowPop;
    rates['__pop'] = { smoothMin: ph.n.length ? (ph.sn / ph.n.length) * 60 : 0 };
  }

  // 完整世界 tick 统一提交:运输结果 + 海事推进(订单/调遣/维护)+ 时间推进 + state-changed
  function finalizeWorldTick(world) {
    // [B-65] 运输统一提交(tick 开始已按库存快照计算分配;岛模拟不改变本次分配)
    if (root.Engine.transport && root.Engine.transport.commitTransport) root.Engine.transport.commitTransport(world);
    // [B-63] 海事推进:每完整世界 tick 一次(订单工作量/调遣任务/船维护 15/min)
    if (root.Engine.ships && root.Engine.ships.advance) root.Engine.ships.advance(world);
    world.time.tickAcc = (world.time.tickAcc || 0) + 1;
    if (world.time.tickAcc >= TICKS_PER_HOUR) {
      world.time.tickAcc = 0;
      world.time.hour = (world.time.hour + 1) % 24;
      if (world.time.hour === 0) world.time.day++;
    }
    events.emit('state-changed', world);
  }

  // [B-62] 世界 tick:默认一帧执行全部岛(与旧单岛语义一致);opts.frameBudget 启用逐岛分帧(AC-17)。
  // 分帧中(world._tickCursor>0)不推进时间、不 emit;全部岛完成(完整世界 tick)才统一提交。
  // main.js 默认不使用分帧 → 每定时器回调即完整世界 tick,自动存档/beforeunload 永远在完整边界。
  function tick(world, opts) {
    if (world.settings.paused) return { ticked: false, complete: false };
    const o = opts || {};
    const budget = o.frameBudget && o.frameBudget > 0 ? o.frameBudget : Infinity;
    // [B-62] 新增岛(如探索获得)可能未挂金币别名 → 世界 tick 补挂(幂等,保证岛内 spend/收入走全局 treasury)
    for (const isl of Object.values(world.islands)) st.attachCoinAlias(world, isl);
    // [B-65] 世界 tick 开始(首帧):基于 tick 开始库存计算运输分配(暂存,完整 tick 结束统一提交)
    if ((world._tickCursor || 0) === 0 && root.Engine.transport && root.Engine.transport.beginTransport) {
      root.Engine.transport.beginTransport(world);
    }
    const islandIds = Object.keys(world.islands).sort();
    let cursor = world._tickCursor || 0;
    if (cursor >= islandIds.length) cursor = 0; // 防御:上一轮已结束但光标未清
    const end = Math.min(cursor + budget, islandIds.length);
    for (let i = cursor; i < end; i++) simulateIsland(world.islands[islandIds[i]], opts); // [优化] slowEvery 等 opts 透传
    cursor = end;
    if (cursor >= islandIds.length) {
      world._tickCursor = 0;
      finalizeWorldTick(world);
      return { ticked: true, complete: true };
    }
    world._tickCursor = cursor;
    return { ticked: false, complete: false, cursor };
  }

  // [Sol 轮2/AC-17] 跨帧调度器:每浏览器帧调 frame(ts) 一片;分片未完成不启动下一世界 tick;
  // 只有 complete=true 才计数完整世界 tick(自动保存资格)。DOM-free,main.js 用 rAF 驱动。
  function createScheduler(world, opts) {
    const o = opts || {};
    const budget = o.frameBudget && o.frameBudget > 0 ? o.frameBudget : 3;
    let pending = false; // 世界 tick 分片进行中(未完成前不得启动下一 tick)
    let lastCompleteAt = 0;
    let ticks = 0;
    return {
      // 每帧调用 now(ms):返回 { started, complete, ticks }
      frame(now) {
        if (world.settings.paused) { pending = false; return { started: false, complete: true, ticks }; }
        const interval = 1000 / world.settings.speed;
        if (pending) {
          const r = tick(world, { frameBudget: budget });
          if (r.complete) { pending = false; lastCompleteAt = now; ticks++; return { started: true, complete: true, ticks }; }
          return { started: true, complete: false, ticks };
        }
        if (now - lastCompleteAt >= interval) {
          const r = tick(world, { frameBudget: budget });
          if (r.complete) { lastCompleteAt = now; ticks++; return { started: true, complete: true, ticks }; }
          pending = true;
          return { started: true, complete: false, ticks };
        }
        return { started: false, complete: true, ticks };
      },
      reset() { pending = false; lastCompleteAt = 0; ticks = 0; },
      getTicks: () => ticks,
      isPending: () => pending,
    };
  }

  // [Sol 轮3] 补完当前未完成世界 tick:分片中退出(含暂停中)必须完成半截 tick 才能存档。
  // 暂停时也推进剩余岛(临时解除暂停,完成后恢复);不额外启动新 tick;带 guard 防死循环。
  function finishPendingTick(world) {
    if (!world || !(world._tickCursor > 0)) return { completed: false, cursor: world ? world._tickCursor : 0 };
    const wasPaused = world.settings.paused;
    world.settings.paused = false;
    try {
      const maxFrames = Object.keys(world.islands).length + 1; // 每帧至少完成 1 岛
      let r = null;
      for (let i = 0; i < maxFrames; i++) {
        r = tick(world); // 无 frameBudget:一次完成剩余岛
        if (r.complete) break;
      }
      return { completed: !!r && r.complete, cursor: world._tickCursor };
    } finally {
      world.settings.paused = wasPaused; // 恢复原暂停状态(半截 tick 已完成)
    }
  }

  const api = { tick, createScheduler, finishPendingTick };
  root.Engine = root.Engine || {};
  root.Engine.tick = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
