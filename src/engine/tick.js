/* tick.js — 固定步进游戏循环(1s × 速度倍率,暂停时跳过) */
(function (root) {
  'use strict';
  const economy = root.Engine.economy;
  const population = root.Engine.population;
  const events = root.Engine.events;
  const st = root.Engine.state;

  // [V1.7] 时间流速:12 tick = 1 游戏小时(一天 288 tick;默认 2x 下小时显示每 6 秒变化一次)
  const TICKS_PER_HOUR = 12;
  // 顺序:生产 → 需求消耗 → 人口 → 幸福度 → 需求收入 → 解锁 → 速率汇总
  function tick(state) {
    if (state.settings.paused) return { ticked: false };
    st.initFlow(state);
    economy.refresh(state, { produce: true, logs: true });
    population.updateNeeds(state);
    population.updatePopulation(state);
    population.updateHappiness(state);
    population.collectTax(state);
    population.checkUnlocks(state);
    // [V1.2] 汇总每 tick 流量 → state.rates(ADR-018)
    // [H-01] 滚动平均:60 tick 窗口平滑净速率(周期建筑不再 0/60 跳变);暂停时窗口不更新=保持最后稳定值
    // [M-04 fix] 收入/维护分别平滑(smoothProducedMin/smoothConsumedMin),避免"平滑净+即时维护"时间窗口不一致
    const rates = {};
    // [P0/HIGH] 运行时同规则归一化(与 load 一致):部分损坏窗口(缺失累计值/三轨不等长/NaN/null 污染)安全重建
    const norm = (root.Engine.save && root.Engine.save.normalizeRatesHistory) || (() => ({}));
    const win = state.ratesHistory = norm(state.ratesHistory);
    for (const [g, v] of Object.entries(state.resources)) {
      const f = state.flow[g] || { produced: 0, consumed: 0 };
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
    state.rates = rates;
    // [M-01] 人口 /min 趋势:60 tick 窗口平滑人口变化(UI 显示 ↑↓ + 数值)
    const nowPop = Object.values(state.population).reduce((s, p) => s + p.count, 0);
    const ph = win['__pop'] = win['__pop'] || { n: [], sn: 0 };
    if (state.__prevPop != null) {
      const popDelta = nowPop - state.__prevPop;
      ph.n.push(popDelta);
      ph.sn += popDelta;
      if (ph.n.length > 60) { ph.sn -= ph.n.shift(); }
    }
    state.__prevPop = nowPop;
    rates['__pop'] = { smoothMin: ph.n.length ? (ph.sn / ph.n.length) * 60 : 0 };
    // [V1.7] 时间推进:12 tick = 1 小时(暂停时 tick 提前返回,时间不推进)
    state.time.tickAcc = (state.time.tickAcc || 0) + 1;
    if (state.time.tickAcc >= TICKS_PER_HOUR) {
      state.time.tickAcc = 0;
      state.time.hour = (state.time.hour + 1) % 24;
      if (state.time.hour === 0) state.time.day++;
    }
    events.emit('state-changed', state);
    return { ticked: true };
  }

  const api = { tick };
  root.Engine = root.Engine || {};
  root.Engine.tick = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
