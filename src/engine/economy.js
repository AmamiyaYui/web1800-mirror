/* economy.js — 生产/建筑状态/维护费 */
(function (root) {
  'use strict';
  const { getDef } = root.Engine.buildings;
  const st = root.Engine.state;
  const { isConnected } = root.Engine.connectivity;
  const events = root.Engine.events;
  // [顺序11] placement 在 economy 之后加载,须函数内引用 root.Engine.placement

  // 计算单个建筑状态:
  //   idle          无生产(民居/仓库)
  //   disconnected  未连通仓库(⚠️)
  //   waiting       缺原料/缺劳动力/超出仓库服务范围
  //   producing     正常生产中
  // [H-03] 返回结构化原因:reason(机器可读)+ detail(数值/名称),UI 据此显示中文主因
  // [V1.10 修订⑤] 仓库=服务建筑:生产建筑必须在仓库服务范围(沿路延伸 radius 格)内才能生产
  function computeStatus(state, b, opts) {
    const def = getDef(b.type);
    if (!def) return { status: 'idle', reason: 'unknown' };
    if (def.special === 'warehouse') return { status: 'idle', reason: 'none' };
    if (!isConnected(state, b.id)) return { status: 'disconnected', reason: 'road-disconnected' };
    if (!def.production) return { status: 'idle', reason: 'none' };
    for (const [tier, need] of Object.entries(def.production.workforce || {})) {
      const have = state.population[tier] ? state.population[tier].count : 0;
      if (have < need) return { status: 'waiting', reason: 'workforce-shortage', detail: { tier, need, have } };
    }
    for (const [good, qty] of Object.entries(def.production.inputs || {})) {
      if ((state.resources[good] || 0) < qty) return { status: 'waiting', reason: 'input-shortage', detail: { good, need: qty, have: state.resources[good] || 0 } };
    }
    // 仓库服务覆盖(仅 refresh 传入 opts 时检查,住宅/服务判定不检查)
    if (opts && opts.warehouseRoads && !touchesRoads(state, b, def, opts.warehouseRoads)) return { status: 'waiting', reason: 'warehouse-out-of-range' };
    // [V1.10 修订②] 伐木营地/农场:半径内开发度 >75% → 停止生产(未开发区域被占满)
    if (def.production.radius && developmentRatio(state, b, def) > 0.75) {
      return { status: 'waiting', reason: 'development-too-low', detail: { dev: developmentRatio(state, b, def) } };
    }
    return { status: 'producing', reason: 'ok' };
  }
  // 建筑 footprint 自身或 4 邻接触给定道路集(仓库服务覆盖判定)
  // [V1.10 修订⑤ 顺序11] 按 b.rot 旋转后的 footprint 判定
  function touchesRoads(state, b, def, roads) {
    const size = state.map.size;
    for (const c of root.Engine.placement.footprint(def, b.x, b.y, b.rot)) {
      if (roads.has(st.key(c.x, c.y))) return true;
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + ddx, ny = c.y + ddy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size && roads.has(st.key(nx, ny))) return true;
      }
    }
    return false;
  }

  // [V1.10 修订②] 伐木营地未开发度:半径(方形)内可开发格(非水非山)中被建筑/道路占据的比例
  // 自身 footprint 计入占据(营地本身也是开发)
  function developmentRatio(state, b, def) {
    const r = def.production.radius;
    const bb = root.Engine.placement.footprintBounds(def, b.x, b.y, b.rot || 0); // [顺序11] 旋转后包围盒中心
    const cx = bb.x + Math.floor(bb.w / 2), cy = bb.y + Math.floor(bb.h / 2);
    const size = state.map.size;
    let developable = 0, occupied = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const fx = cx + dx, fy = cy + dy;
      if (fx < 0 || fy < 0 || fx >= size || fy >= size) continue;
      const t = state.map.terrain[fy][fx];
      // [用户反馈] 非平地(水/山/矿/黏土)全部计入占用:这些地块不能种田/放牧,
      // 区域内的矿脉、水面、山脉都会降低开发度(可开发格 = 平地)
      if (t !== 0) { occupied++; continue; }
      developable++;
      if (state.grid[st.key(fx, fy)] || state.roads[st.key(fx, fy)]) occupied++;
    }
    return developable > 0 ? occupied / developable : 1;
  }
  // 开发度 → 效率:≤25% 全效,≤50% 半效,≤75% 四分之一,>75% 停产
  function efficiencyFor(dev) {
    if (dev > 0.75) return 0;
    if (dev > 0.5) return 0.25;
    if (dev > 0.25) return 0.5;
    return 1;
  }

  // 刷新全部建筑状态;produce=true 时执行实际消耗/产出
  // [V1.10] 周期制:production.cycle(秒/tick)满周期结算一次;维护费按分钟/60 每 tick 扣除
  function refresh(state, opts) {
    const o = opts || {};
    // [V1.10 修订⑤] 仓库服务覆盖道路(沿仓库路距离 radius 延伸),每 tick 算一次
    const warehouseRoads = root.Engine.population.serviceRoads(state, 'warehouse');
    for (const b of Object.values(state.buildings)) {
      const def = getDef(b.type);
      const ns = computeStatus(state, b, { warehouseRoads });
      // [H-03] ns 为对象 {status, reason, detail};b.status 保持字符串兼容旧断言,b.reason/b.detail 供 UI 诊断
      const status = typeof ns === 'object' ? ns.status : ns;
      if (status !== b.status) {
        const prev = b.status;
        b.status = status;
        b.reason = typeof ns === 'object' ? ns.reason : 'ok';
        b.detail = typeof ns === 'object' ? ns.detail : null;
        if (o.logs !== false && def) {
          // [M-06] 日志带结构化原因(模板可聚合):名称:原因模板
          const REASON_LOG = {
            'road-disconnected': '道路断开',
            'workforce-shortage': '劳动力不足',
            'input-shortage': '缺少原料',
            'warehouse-out-of-range': '超出仓库服务范围',
            'development-too-low': '开发度过高停产',
          };
          if (status === 'disconnected') {
            st.addLog(state, '⚠️ ' + def.name + ':' + (REASON_LOG[ns.reason] || '道路断开'));
          } else if (prev === 'disconnected') {
            st.addLog(state, def.name + ':已恢复连通');
          } else if (status === 'waiting' && prev === 'producing') {
            const d = ns.detail;
            let suffix = '';
            if (ns.reason === 'input-shortage' && d) suffix = '(' + (root.Engine.goods.name(d.good) || d.good) + ')';
            st.addLog(state, '⏳ ' + def.name + ':' + (REASON_LOG[ns.reason] || '等待中') + suffix);
          } else if (status === 'producing' && prev === 'waiting') {
            st.addLog(state, def.name + ':开始生产');
          }
        }
      } else if (typeof ns === 'object') {
        // 状态未变也同步 reason(原因可能变化:如缺的原料换了)
        b.reason = ns.reason;
        b.detail = ns.detail;
      }
      if (o.produce) {
        // 维护费:原版每分钟 → 每 tick 扣 1/60
        if (def && def.maintenance) {
          const m = def.maintenance / 60;
          state.resources.coin = (state.resources.coin || 0) - m;
          st.addFlow(state, 'coin', 'consumed', m);
        }
        if (status === 'producing' && def && def.production) {
          const cycle = def.production.cycle || 1;
          b.cycleAcc = (b.cycleAcc || 0) + 1;
          if (b.cycleAcc >= cycle) {
            b.cycleAcc = 0;
            for (const [g, q] of Object.entries(def.production.inputs || {})) {
              state.resources[g] = (state.resources[g] || 0) - q;
              st.addFlow(state, g, 'consumed', q);
            }
            // [V1.10 修订②] 半径模式(伐木营地):固定周期产出 × 未开发度效率(树不消耗)
            // 开发度 ≤25% 全效 / ≤50% 半效 / ≤75% 四分之一 / >75% 停产(computeStatus 已判 waiting)
            let outputs = def.production.outputs;
            if (def.production.radius) {
              const dev = developmentRatio(state, b, def);
              const eff = efficiencyFor(dev);
              b.devRatio = dev;
              b.devEfficiency = eff;
              outputs = {};
              if (eff > 0) {
                for (const g of Object.keys(def.production.outputs)) outputs[g] = def.production.outputs[g] * eff;
              }
            }
            for (const [g, q] of Object.entries(outputs)) {
              state.resources[g] = (state.resources[g] || 0) + q;
              st.addFlow(state, g, 'produced', q);
              events.emit('produced', { id: b.id, type: b.type, good: g, qty: q }); // [V1.2] 飘字事件(ADR-019)
            }
          }
        }
      }
    }
  }

  // [B-42] 每分钟总维护费:遍历当前所有建筑(含 producing/waiting/disconnected/idle/仓库/服务建筑),
  // 只要存在且定义 maintenance 就计入;建造/拆除后立即反映,不等 60 tick 窗口
  function totalMaintenancePerMin(state) {
    let total = 0;
    for (const b of Object.values(state.buildings)) {
      const def = root.Engine.buildings.getDef(b.type);
      if (def && def.maintenance) total += def.maintenance;
    }
    return total;
  }

  const api = { computeStatus, refresh, developmentRatio, efficiencyFor, totalMaintenancePerMin };
  root.Engine = root.Engine || {};
  root.Engine.economy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
