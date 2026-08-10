/* population.js — 需求/住户/收入/幸福度
 *  - generated rate/income 已从“每住宅”原值除容量换算为每人口单位
 *  - 消耗 = 当前人口 × 每人口每秒 rate
 *  - 住户目标 = Σ栋[Σ(有供应的基础需求 Influx)];缓慢趋向,全不满足→0
 *  - 收入 = Σ(每人口每分钟 income × 满足度 × 当前人口) /60 每 tick
 *  - 幸福度 = Σ(奢侈需求 happiness × 满足度)
 *  - 服务型需求(市场)按建筑覆盖满足(0~1)
 */
(function (root) {
  'use strict';
  const { TIERS } = root.Engine.tiers;
  const st = root.Engine.state;
  const { getDef } = root.Engine.buildings;
  const { computeStatus } = root.Engine.economy;

  const POP_ADJUST_RATE = 0.02; // 住户每 tick 向目标移动的比例(缓慢增长/流失)

  // 需求满足度计算 + 消耗(每 tick;当前人口 × generated 每人口 rate)
  function updateNeeds(state) {
    for (const [tierId, tier] of Object.entries(TIERS)) {
      const pop = state.population[tierId];
      if (!pop) continue;
      const caps = capacityFor(state, tierId); // 容量(需求判定/收入上限基准)
      const count = pop.count; // [V1.10 修订⑤ 顺序8] 消耗按当前人口(原版)
      const needSats = {};
      let influxSum = 0, influxCount = 0, happiness = 0;
      for (const [good, need] of Object.entries(tier.needs || {})) {
        let sat;
        if (need.service) {
          // 服务型需求(市场):覆盖率(0~1)
          sat = serviceCoverage(state, tierId, need.service);
        } else {
          const required = count * need.rate; // 消耗 = 当前人口 × 率(非容量)
          const avail = state.resources[good] || 0;
          // [B-43] 零人口不自动全满足:0 人+0 库存 → sat 0(无供应);0 人+有库存 → sat 1(有供应)
          sat = required > 0 ? Math.min(1, avail / required) : (avail > 0 ? 1 : 0);
          const consumed = Math.min(avail, required);
          state.resources[good] = Math.max(0, avail - consumed);
          if (consumed > 0) st.addFlow(state, good, 'consumed', consumed);
        }
        needSats[good] = sat;
        if (need.influx) { influxSum += sat; influxCount++; }
        if (need.happiness) happiness += need.happiness * sat; // 奢侈幸福(按满足度比例)
      }
      pop.needSats = needSats;
      pop.satisfaction = influxCount ? influxSum / influxCount : 1; // 基础需求平均满足度(UI)
      pop.happiness = happiness;
    }
  }

  // 建筑中心(中心语义:b.x/b.y 即建筑锚点=中心,服务/距离计算直接用)
  function centerOf(b, def) {
    return { x: b.x, y: b.y };
  }
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // [V1.10 修订] 服务生效 = 路距离:从服务建筑相邻道路出发,沿道路延伸 radius 格;
  // 住宅 footprint 接触被覆盖道路(自身或 4 邻)即被服务(原版机制,用户确认)
  function serviceRoads(state, type) {
    const services = Object.values(state.buildings).filter((b) => {
      const def = getDef(b.type);
      return def && def.service && def.service.type === type && computeStatus(state, b).status !== 'disconnected';
    });
    const covered = new Set();
    const size = state.map.size;
    for (const svc of services) {
      const def = getDef(svc.type);
      const w = (def.size && def.size.w) || 1, h = (def.size && def.size.h) || 1;
      const radius = def.service.radius;
      const dist = {};
      const queue = [];
      // 起点:服务建筑 footprint 外圈的道路格(中心语义:左上角 = 中心 - 偏置)
      const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2);
      for (let dy = -1; dy <= h; dy++) for (let dx = -1; dx <= w; dx++) {
        if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue; // footprint 内
        const x = svc.x - bx + dx, y = svc.y - by + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const k = st.key(x, y);
        if (state.roads[k] && !covered.has(k)) {
          covered.add(k);
          dist[k] = state.roads[k] === 2 ? 2 / 3 : 1; // [顺序3] 石板路消耗 2/3(传播 1.5 倍)
          queue.push([x, y]);
        }
      }
      // 沿道路 BFS,最多延伸 radius 格(index 指针避免 shift O(n²))
      let qi = 0;
      while (qi < queue.length) {
        const [x, y] = queue[qi++];
        const d = dist[st.key(x, y)];
        if (d >= radius) continue;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const nk = st.key(nx, ny);
          if (!state.roads[nk] || covered.has(nk)) continue;
          covered.add(nk);
          dist[nk] = d + (state.roads[nk] === 2 ? 2 / 3 : 1); // [顺序3] 石板路消耗 2/3
          queue.push([nx, ny]);
        }
      }
    }
    return covered;
  }

  // 服务型需求覆盖率:被服务道路覆盖的连通住宅占比(如市场)
  function serviceCoverage(state, tierId, type) {
    const covered = serviceRoads(state, type);
    if (!covered.size) return 0;
    let coveredH = 0, total = 0;
    for (const b of Object.values(state.buildings)) {
      const def = getDef(b.type);
      if (!def || def.tier !== tierId || !def.capacity) continue;
      if (computeStatus(state, b).status === 'disconnected') continue;
      total++;
      if (houseTouches(state, b, def, covered)) coveredH++;
    }
    return total ? coveredH / total : 0;
  }
  // 住宅 footprint 自身或 4 邻接触被覆盖道路(中心语义:左上角 = 中心-偏置)
  function houseTouches(state, b, def, coveredRoads) {
    const size = state.map.size;
    const w = (def.size && def.size.w) || 1, h = (def.size && def.size.h) || 1;
    const bx = Math.floor((w - 1) / 2), by = Math.floor((h - 1) / 2);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const x = b.x - bx + dx, y = b.y - by + dy;
      if (coveredRoads.has(st.key(x, y))) return true;
      for (const [ddx, ddy] of DIRS4) {
        const nx = x + ddx, ny = y + ddy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size && coveredRoads.has(st.key(nx, ny))) return true;
      }
    }
    return false;
  }

  // 住宅容量:仅统计已连通(未断连)的住宅
  function capacityFor(state, tierId) {
    let cap = 0;
    for (const b of Object.values(state.buildings)) {
      const def = getDef(b.type);
      if (def && def.tier === tierId && def.capacity && computeStatus(state, b).status !== 'disconnected') {
        cap += def.capacity;
      }
    }
    return cap;
  }
  // 连通民居数
  function countHouses(state, tierId) {
    let n = 0;
    for (const b of Object.values(state.buildings)) {
      const def = getDef(b.type);
      if (def && def.tier === tierId && def.capacity && computeStatus(state, b).status !== 'disconnected') n++;
    }
    return n;
  }

  // [V1.10 修订⑤ 顺序8] 住户目标 = Σ栋[Σ(已满足基础需求的 Influx)](原版 wiki 语义)
  // 离散判定:该需求满足度 >0(有供应)即全额提供人口;不满足给 0(非比例)
  // 至少 1 个基础需求满足 → 有住户;全不满足 → 0(废墟)
  function houseTarget(state, tierId) {
    const tier = TIERS[tierId];
    const pop = state.population[tierId];
    if (!tier || !pop) return 0;
    let per = 0;
    for (const [good, need] of Object.entries(tier.needs || {})) {
      if (!need.influx) continue;
      const sat = (pop.needSats || {})[good] ?? 0;
      if (sat > 0) per += need.influx; // 满足(有供应)→ 全额人口
    }
    return countHouses(state, tierId) * per;
  }

  // 住户随时间缓慢趋向目标(增长/流失都慢);[V1.10] 收敛判定:接近目标时精确到位
  // (避免渐近永远差一点 → workforce 硬阈值永远达不到)
  function updatePopulation(state) {
    for (const [tierId] of Object.entries(TIERS)) {
      const pop = state.population[tierId];
      if (!pop) continue;
      const target = houseTarget(state, tierId);
      if (pop.count < target) {
        pop.count = Math.min(target, pop.count + Math.max(0.05, (target - pop.count) * POP_ADJUST_RATE));
      } else if (pop.count > target) {
        pop.count = Math.max(0, pop.count - Math.max(0.05, (pop.count - target) * POP_ADJUST_RATE));
      }
      if (Math.abs(target - pop.count) < 0.05) pop.count = target;
    }
    refreshOccupancy(state);
  }

  // [玩家反馈 #4] 单栋住宅住户分配:阶层 count 按住宅顺序填满(先住满先建的住宅)
  function refreshOccupancy(state) {
    for (const [tierId] of Object.entries(TIERS)) {
      const count = (state.population[tierId] || {}).count || 0;
      let remaining = count;
      for (const b of Object.values(state.buildings)) {
        const def = getDef(b.type);
        if (!def || def.tier !== tierId || !def.capacity) continue;
        // [B-43 返工 C] 断连住宅 occupied=0(不计住户,不得升级);只在连通住宅间先建先满
        if (computeStatus(state, b).status === 'disconnected') {
          b.occupied = 0;
          continue;
        }
        b.occupied = Math.max(0, Math.min(def.capacity, remaining));
        remaining -= b.occupied;
      }
    }
  }

  // [V1.10 修订⑤ 顺序8] 收入 = Σ(需求 income × 满足度 × 当前人口) 每人口每分钟 → /60 每 tick
  // (原版:需求提供收入;消耗/收入基准 = 人口而非住宅容量,用户确认)
  function collectTax(state) {
    let income = 0;
    for (const [tierId, tier] of Object.entries(TIERS)) {
      const pop = state.population[tierId];
      if (!pop) continue;
      const count = pop.count;
      for (const [good, need] of Object.entries(tier.needs || {})) {
        if (!need.income) continue;
        const sat = (pop.needSats || {})[good] ?? 0;
        income += need.income * sat * count;
      }
    }
    const perTick = income / 60; // 原版每分钟 → 每 tick
    state.resources.coin = (state.resources.coin || 0) + perTick;
    st.addFlow(state, 'coin', 'produced', perTick);
  }

  function updateHappiness(state) {
    let total = 0, weight = 0;
    for (const [tierId, tier] of Object.entries(TIERS)) {
      const pop = state.population[tierId];
      if (!pop || pop.count <= 0) continue;
      total += (pop.happiness || 0) * pop.count;
      weight += pop.count;
    }
    // [V1.10] 幸福度 = 奢侈需求贡献(原版;开局 0=Content)
    state.happiness = Math.round(weight > 0 ? total / weight : 0);
  }

  // 阶层解锁(阈值见 tiers.js)
  function checkUnlocks(state) {
    if (!state.unlocks.workers && state.population.farmers.count >= TIERS.workers.unlockAt) {
      state.unlocks.workers = true;
      st.addLog(state, '🔓 工人阶层解锁!');
    }
    if (!state.unlocks.artisans && state.population.workers.count >= TIERS.artisans.unlockAt) {
      state.unlocks.artisans = true;
      st.addLog(state, '🔓 工匠阶层解锁!');
    }
  }

  // [B-42] 理论需求/min = 当前人口 × need.rate × 60(rate 已是每人口每秒,不再除容量);
  // 按当前人口计算(不按住宅数量/容量/目标人口);服务型需求(service)无商品消耗,不产出需求率;
  // 库存不足不改变理论需求(满足度仍按实际消耗算)
  function currentNeedRates(state) {
    const byTier = {};
    const byGood = {};
    for (const [tierId, tier] of Object.entries(TIERS)) {
      const pop = state.population[tierId];
      if (!pop) continue;
      const count = pop.count;
      const tierRates = byTier[tierId] = {};
      for (const [good, need] of Object.entries(tier.needs || {})) {
        if (need.service || !need.rate) continue;
        const perMin = count * need.rate * 60;
        tierRates[good] = perMin;
        byGood[good] = (byGood[good] || 0) + perMin;
      }
    }
    return { byTier, byGood };
  }

  function currentNeedPerMin(state, tierId, goodId) {
    const tierRates = currentNeedRates(state).byTier[tierId];
    return tierRates ? (tierRates[goodId] || 0) : 0;
  }

  const api = { updateNeeds, updatePopulation, updateHappiness, collectTax, checkUnlocks, capacityFor, countHouses, houseTarget, serviceCoverage, serviceRoads, refreshOccupancy, currentNeedRates, currentNeedPerMin };
  root.Engine = root.Engine || {};
  root.Engine.population = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
