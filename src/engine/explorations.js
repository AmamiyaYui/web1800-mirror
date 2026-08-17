/* explorations.js — 灰冠探索与新岛生成 [B-64]
 * 规则来源:REQ-37/42~43、AC-20/23、MI-17~20
 * 世界层实体:world.expeditionTasks;探索进度独立于暂停(REQ-42),由 main.js 独立定时器推进
 */
(function (root) {
  'use strict';
  const st = root.Engine.state;
  // 跨模块依赖运行时读取(AGENTS 硬性约定 #3)
  const wd = () => root.Engine.worldData;
  const mt = () => root.Engine.mapTemplate;

  const EXPEDITION_TICKS = 600; // [MI-18] 10 分钟(1 真实秒推进 1 tick)
  // [REQ-42/MI-17] 四档:成功率 = 档位;金币均 0;商品从来源岛一次性扣除;船被占用(失败/放弃损失)
  const TIERS = {
    '60': Object.freeze({ success: 0.6, cost: Object.freeze({}) }),
    '70': Object.freeze({ success: 0.7, cost: Object.freeze({ fish: 20, wood: 10 }) }),
    '80': Object.freeze({ success: 0.8, cost: Object.freeze({ fish: 40, wood: 20, workclothes: 10 }) }),
    '90': Object.freeze({ success: 0.9, cost: Object.freeze({ fish: 60, wood: 30, workclothes: 20, schnapps: 20, sail: 5 }) }),
  };
  // 矿物 → 地形码(黏土 5×5 块用 DEPOSIT_GROUPS.size)
  const TERRAIN_CODE = { clay: 2, iron: 3, copper: 4, gold: 5, coal: 8, zinc: 9, limestone: 10 };

  // 确定性 LCG 选择(与 state.pickN 同算法,独立实现避免跨模块依赖)
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

  // [REQ-43] 发起探索:来源岛 idle 船 + 档位;扣来源岛商品;船占用;预留 12 岛名额
  // [HIGH-2] 来源岛必须由船停留岛决定(不得用活动岛),并要求该岛码头有效(建成+连通仓库);不满足不扣费不建任务
  function startExpedition(world, shipId, tierKey) {
    const tier = TIERS[tierKey];
    if (!tier) return { ok: false, reason: '档位无效' };
    const ship = world.fleet && world.fleet[shipId];
    if (!ship) return { ok: false, reason: '船不存在' };
    if (ship.status !== 'idle') return { ok: false, reason: '只有空闲船可探索' };
    const island = world.islands && world.islands[ship.currentIslandId];
    if (!island) return { ok: false, reason: '船停留岛不存在' };
    const shipsMod = root.Engine.ships;
    if (!shipsMod || !shipsMod.portValid || !shipsMod.portValid(world, ship.currentIslandId)) {
      return { ok: false, reason: '来源岛码头无效(需建成且连通仓库)' };
    }
    const activeTasks = Object.keys(world.expeditionTasks || {}).length;
    if (Object.keys(world.islands).length + activeTasks >= wd().MAX_OWNED_ISLANDS) {
      return { ok: false, reason: '岛屿名额已满(' + wd().MAX_OWNED_ISLANDS + ')' };
    }
    for (const [g, q] of Object.entries(tier.cost)) {
      if ((island.resources[g] || 0) < q) return { ok: false, reason: '来源岛材料不足' };
    }
    for (const [g, q] of Object.entries(tier.cost)) island.resources[g] = (island.resources[g] || 0) - q;
    ship.status = 'expedition';
    world._nextTaskId = (world._nextTaskId || 0) + 1;
    const taskId = 'e' + world._nextTaskId;
    world.expeditionTasks = world.expeditionTasks || {};
    // 确定性成功判定:任务创建时掷骰(刷新/读档不改变结果)
    // [Sol-2 轮2] roll 种子取来源岛(船停留岛)seed——活动岛只决定渲染目标,不得改变世界权威结果
    world._expeditionRoll = (world._expeditionRoll || 0) + 1;
    const base = (typeof world.seed === 'number' ? world.seed : (island && island.map ? island.map.seed : 20260808)) >>> 0;
    const roll = ((base + world._expeditionRoll * 7919) >>> 0) % 10000 / 10000;
    world.expeditionTasks[taskId] = {
      id: taskId, shipId, sourceIslandId: island.id,
      tier: tierKey, successRate: tier.success,
      roll,
      remaining: EXPEDITION_TICKS,
    };
    return { ok: true, task: world.expeditionTasks[taskId] };
  }

  // [REQ-42/AC-23] 主动放弃:不返还投入,释放名额,船损失
  function abortExpedition(world, taskId) {
    const t = world.expeditionTasks && world.expeditionTasks[taskId];
    if (!t) return { ok: false, reason: '任务不存在' };
    if (world.fleet) delete world.fleet[t.shipId];
    delete world.expeditionTasks[taskId];
    return { ok: true };
  }

  // [REQ-37] 世界缺失集合(所有岛禀赋并集,排除已拥有)
  function worldMissing(world, kind) {
    const have = new Set();
    for (const isl of Object.values(world.islands)) {
      const list = kind === 'fertility' ? (isl.fertilities || []) : (isl.deposits || []);
      for (const x of list) have.add(x);
    }
    const pool = kind === 'fertility' ? wd().MAIN_FERTILITIES : wd().MINERAL_TYPES;
    return pool.filter((x) => !have.has(x));
  }

  // [REQ-37/AC-20] 新岛禀赋:缺失时至少补 1 种,其余随机填满 4+4(确定性 seed)
  function pickNewIslandEndowments(world, seed) {
    const missF = worldMissing(world, 'fertility');
    const missD = worldMissing(world, 'deposit');
    const fert = missF.length ? pickN(seed, missF, 1) : [];
    const dep = missD.length ? pickN(seed + 2, missD, 1) : [];
    const restF = wd().MAIN_FERTILITIES.filter((x) => fert.indexOf(x) < 0);
    const restD = wd().MINERAL_TYPES.filter((x) => dep.indexOf(x) < 0);
    fert.push(...pickN(seed + 1, restF, wd().ISLAND_MAX_FERTILITIES - fert.length));
    dep.push(...pickN(seed + 3, restD, wd().ISLAND_MAX_DEPOSITS - dep.length));
    return { fertilities: fert, deposits: dep };
  }

  // [HIGH-3/Sol 轮2] 完整矿床组计数:互不重叠的完整 N×N 全矿块(散格不计入)
  function countDepositGroups(terrain, size, code, groupSize) {
    let groups = 0;
    const used = new Uint8Array(size * size);
    for (let y = 0; y <= size - groupSize; y++) {
      for (let x = 0; x <= size - groupSize; x++) {
        if (used[y * size + x]) continue;
        let full = true;
        const cells = [];
        for (let dy = 0; dy < groupSize && full; dy++) {
          for (let dx = 0; dx < groupSize && full; dx++) {
            const idx = (y + dy) * size + (x + dx);
            if (used[idx] || terrain[y + dy][x + dx] !== code) full = false;
            else cells.push(idx);
          }
        }
        if (full) { for (const idx of cells) used[idx] = 1; groups++; }
      }
    }
    return groups;
  }

  // [HIGH-3/Sol 轮3] 逐矿物独立校验:每种入选矿物的实际完整组数必须达到**本次抽定值**
  // (terrain.drawnGroups 由生成器暴露;无 drawnGroups 的旧 terrain 回退到下限 min)
  function depositsSatisfied(terrain, size, deposits) {
    const drawn = terrain && terrain.drawnGroups;
    for (const m of deposits) {
      const g = wd().DEPOSIT_GROUPS[m];
      const code = TERRAIN_CODE[m];
      if (!g || code === undefined) continue;
      const groups = countDepositGroups(terrain, size, code, g.size);
      const target = (drawn && drawn[m] != null) ? drawn[m] : g.min;
      if (groups < target) return false;
    }
    return true;
  }

  // [REQ-37] 新岛生成:确定性派生 seed 重试;任一矿物不足则重试,全部满足才成功
  // [Sol 轮2/AC-20] 候选不足时不得静默减组、残缺或删掉已选矿物;重试上限内全败 → 返回 null,调用方不得授予
  function generateNewIsland(world, sourceSeed) {
    const w = wd();
    const size = w.MAP_SIZE;
    const endow = pickNewIslandEndowments(world, sourceSeed);
    for (let attempt = 0; attempt < 64; attempt++) {
      const attemptSeed = (sourceSeed + attempt * 104729) >>> 0;
      const terrain = mt().generateIsland(size, attemptSeed, endow.deposits);
      if (depositsSatisfied(terrain, size, endow.deposits)) {
        return { terrain, seed: attemptSeed, endow };
      }
    }
    return null; // [AC-20] 不得删矿物/残缺;无法合法兜底时不得授予岛屿
  }

  // [REQ-43] 探索完成:成功 → 直接获得新岛(不自动切岛);失败 → 船损失
  // [HIGH-3] 兜底失败(gen null)按失败处理:不授予残缺岛,船损失
  function settleExpedition(world, t) {
    if (t.roll < t.successRate) {
      const island = acquireIsland(world, t);
      if (island) return island;
    }
    if (world.fleet) delete world.fleet[t.shipId];
    return null;
  }

  // 新岛:初始鱼 100/木材 20/其他 0;金币走全局钱包;挂金币别名
  function acquireIsland(world, t) {
    const w = wd();
    // 稳定 id:island-N(N 递增,跳过已占用)
    let n = Object.keys(world.islands).length + 1;
    let id = 'island-' + n;
    while (world.islands[id]) { n++; id = 'island-' + n; }
    const base = ((t.sourceIslandId ? world.islands[t.sourceIslandId] : null) || {}).map ? world.islands[t.sourceIslandId].map.seed : 20260808;
    const gen = generateNewIsland(world, ((base + Math.floor(t.roll * 1e6)) >>> 0));
    if (!gen) return null; // [HIGH-3] 兜底失败:不授予残缺岛
    const island = st.createIslandState(
      id, gen.seed, w.MAP_SIZE,
      Object.assign({}, w.NEW_ISLAND_INITIAL_RESOURCES),
      gen.endow.deposits, gen.endow.fertilities
    );
    island.name = '灰冠岛 ' + n;
    world.islands[id] = island;
    st.attachCoinAlias(world, island);
    // 探索船到达新岛(空闲);失败时船已删
    if (world.fleet && world.fleet[t.shipId]) {
      world.fleet[t.shipId].currentIslandId = id;
      world.fleet[t.shipId].status = 'idle';
    }
    return island;
  }

  // [REQ-42] 每真实秒推进 1 tick(暂停游戏仍推进;关闭页面停止)。成功/失败/放弃时删除任务。
  // 注意:成功后不自动切岛(REQ-43)
  function advanceExpeditions(world) {
    if (!world.expeditionTasks) return [];
    const done = [];
    for (const t of Object.values(world.expeditionTasks)) {
      t.remaining -= 1;
      if (t.remaining <= 0) {
        const island = settleExpedition(world, t);
        delete world.expeditionTasks[t.id];
        done.push({ taskId: t.id, ok: !!island, islandId: island ? island.id : null });
      }
    }
    return done;
  }

  const api = {
    EXPEDITION_TICKS, TIERS,
    startExpedition, abortExpedition, advanceExpeditions,
    worldMissing, pickNewIslandEndowments, generateNewIsland, acquireIsland,
    depositsSatisfied,
  };
  root.Engine = root.Engine || {};
  root.Engine.expeditions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
