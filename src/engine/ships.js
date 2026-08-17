/* ships.js — 海事引擎:造船订单(全额预付/取消返还)/船实体/退役/调遣/码头权限 [B-63]
 * 规则来源:REQ-38~41、AC-21~22、MI-11~16
 * 世界层实体:world.shipOrders / world.fleet / world.relocationTasks
 */
(function (root) {
  'use strict';
  const st = root.Engine.state;
  // 跨模块依赖运行时读取(加载顺序不保证,AGENTS 硬性约定 #3)
  const sd = () => root.Engine.shipsData;
  const economy = () => root.Engine.economy;
  const connectivity = () => root.Engine.connectivity;
  const buildings = () => root.Engine.buildings;

  const isShipyardType = (t) => t === 'sailingShipyard';
  const isPortType = (t) => t === 'port';
  const defOf = (t) => (buildings().getDef ? buildings().getDef(t) : null);

  // ---- 订单 ----
  // [HIGH-1] 复合身份:islandId + shipyardId(不同岛建筑 id 独立生成,可同为 b1)
  function ordersOf(world, islandId, shipyardId) {
    return Object.values(world.shipOrders || {}).filter((o) => o.islandId === islandId && o.shipyardId === shipyardId);
  }
  function firstOrder(world, islandId, shipyardId) {
    const list = ordersOf(world, islandId, shipyardId);
    return list.length ? list[0] : null; // 插入序即提交序(先来先建)
  }

  // [REQ-39/AC-21] 提交订单:原子全额扣费(全局金币 + 下单岛材料),保存付款快照与下单岛 ID
  function submitShipOrder(world, shipyardId) {
    if (!world || !world.islands) return { ok: false, reason: '世界状态异常' };
    const island = st.getActiveIsland(world);
    if (!island) return { ok: false, reason: '无活动岛' };
    const b = island.buildings[shipyardId];
    if (!b || !isShipyardType(b.type)) return { ok: false, reason: '造船厂不存在' };
    if (ordersOf(world, island.id, shipyardId).length >= sd().SHIPYARD_ORDER_LIMIT) {
      return { ok: false, reason: '订单已满(最多 ' + sd().SHIPYARD_ORDER_LIMIT + ' 份)' };
    }
    const type = sd().SHIP_TYPES[Object.keys(sd().SHIP_TYPES)[0]]; // 首版唯一船型
    if (!type) return { ok: false, reason: '船型未配置' };
    // 资源校验(全通过才扣)
    if ((world.treasury ? world.treasury.coin : 0) < type.cost.coin) return { ok: false, reason: '全局金币不足' };
    for (const [g, q] of Object.entries(type.cost)) {
      if (g === 'coin') continue;
      if ((island.resources[g] || 0) < q) return { ok: false, reason: '本岛材料不足(' + (defOf(g) ? defOf(g).name : g) + ')' };
    }
    world.treasury.coin -= type.cost.coin;
    for (const [g, q] of Object.entries(type.cost)) {
      if (g !== 'coin') island.resources[g] = (island.resources[g] || 0) - q;
    }
    world._nextOrderId = (world._nextOrderId || 0) + 1;
    const orderId = 'o' + world._nextOrderId;
    world.shipOrders = world.shipOrders || {};
    world.shipOrders[orderId] = {
      id: orderId, shipyardId, islandId: island.id, shipType: type.id,
      paidCost: Object.assign({}, type.cost), // 付款快照(配置改价不影响历史取消/退役)
      totalWork: type.workTicks, remainingWork: type.workTicks,
    };
    return { ok: true, order: world.shipOrders[orderId] };
  }

  // [REQ-39/AC-21] 取消订单:任意未完工(等待/建造中)全额返还快照;工作量清零不补偿时间
  function cancelShipOrder(world, orderId) {
    const o = world.shipOrders && world.shipOrders[orderId];
    if (!o) return { ok: false, reason: '订单不存在' };
    world.treasury.coin += o.paidCost.coin || 0;
    const island = world.islands && world.islands[o.islandId];
    for (const [g, q] of Object.entries(o.paidCost)) {
      if (g === 'coin') continue;
      if (island) island.resources[g] = (island.resources[g] || 0) + q;
    }
    delete world.shipOrders[orderId];
    return { ok: true };
  }

  // [REQ-39] 拆除造船厂:自动取消其全部未完工订单(同规则全额返还)
  // [HIGH-1] 复合身份:只取消指定岛上的该造船厂订单
  function cancelShipyardOrders(world, islandId, shipyardId) {
    for (const o of ordersOf(world, islandId, shipyardId)) cancelShipOrder(world, o.id);
    return { ok: true };
  }

  function spawnShip(world, order) {
    world.fleet = world.fleet || {};
    world._nextShipId = (world._nextShipId || 0) + 1;
    const shipId = 's' + world._nextShipId;
    world.fleet[shipId] = {
      id: shipId, type: order.shipType, currentIslandId: order.islandId,
      status: 'idle',
      constructionCostPaid: Object.assign({}, order.paidCost), // 退役按实际建造快照返还
    };
    return world.fleet[shipId];
  }

  // [REQ-39] 每完整世界 tick:每个造船厂第一份订单推进 1 工作量;断连/缺工/移动暂停并保留订单
  // [HIGH-1] 去重按复合身份(islandId:shipyardId),不同岛同名船厂各自推进
  function advanceOrders(world) {
    const seen = new Set();
    for (const o of Object.values(world.shipOrders || {})) {
      const key = o.islandId + ':' + o.shipyardId;
      if (seen.has(key)) continue; // 同一船厂只推进第一份(其余等待)
      seen.add(key);
      const island = world.islands[o.islandId];
      const b = island && island.buildings[o.shipyardId];
      if (!island || !b) continue;
      const stt = economy().computeStatus ? economy().computeStatus(island, b) : null;
      if (!stt || stt.status !== 'producing') continue; // 暂停(不推进、不取消)
      o.remainingWork -= 1;
      if (o.remainingWork <= 0) {
        spawnShip(world, o);
        delete world.shipOrders[o.id];
      }
    }
  }

  // [REQ-40/AC-22] 退役:只有停留岛上的 idle 船;返还 20 木+10 帆到当前停留岛,金币不返;不要求造船厂/码头/连仓
  function retireShip(world, shipId) {
    const ship = world.fleet && world.fleet[shipId];
    if (!ship) return { ok: false, reason: '船不存在' };
    if (ship.status !== 'idle') return { ok: false, reason: '只有空闲船可退役(运输/调遣/探索中禁止)' };
    const type = sd().SHIP_TYPES[ship.type];
    if (!type) return { ok: false, reason: '船型未配置' };
    const island = world.islands[ship.currentIslandId];
    if (!island) return { ok: false, reason: '停留岛不存在' };
    for (const [g, q] of Object.entries(type.retireRefund)) {
      island.resources[g] = (island.resources[g] || 0) + q;
    }
    delete world.fleet[shipId];
    return { ok: true, refund: type.retireRefund };
  }

  // [REQ-40] 码头权限:建成 + 陆侧道路连通本岛任意仓库才有效
  function portValid(world, islandId) {
    const island = world.islands && world.islands[islandId];
    if (!island) return false;
    const port = Object.values(island.buildings || {}).find((b) => isPortType(b.type));
    if (!port) return false;
    const conn = connectivity();
    return !!(conn.isConnected && conn.isConnected(island, port.id));
  }

  // [REQ-41/AC-22] 灰冠调遣:idle 船 + 来源有效码头 + 目标已拥有;600 世界 tick;免费持续维护不可取消
  function relocateShip(world, shipId, targetIslandId) {
    const ship = world.fleet && world.fleet[shipId];
    if (!ship) return { ok: false, reason: '船不存在' };
    if (ship.status !== 'idle') return { ok: false, reason: '只有空闲船可调遣' };
    if (!world.islands[targetIslandId]) return { ok: false, reason: '目标岛不存在' };
    if (!portValid(world, ship.currentIslandId)) return { ok: false, reason: '来源岛码头无效(需建成且连通仓库)' };
    ship.status = 'relocating';
    world._nextTaskId = (world._nextTaskId || 0) + 1;
    const taskId = 'r' + world._nextTaskId;
    world.relocationTasks = world.relocationTasks || {};
    world.relocationTasks[taskId] = {
      id: taskId, shipId, sourceIslandId: ship.currentIslandId,
      targetIslandId, remaining: sd().RELOCATION_TICKS,
    };
    return { ok: true, task: world.relocationTasks[taskId] };
  }

  // 每完整世界 tick:调遣任务推进;到 0 → 船到达目标岛 idle
  function advanceTasks(world) {
    for (const t of Object.values(world.relocationTasks || {})) {
      t.remaining -= 1;
      if (t.remaining <= 0) {
        const ship = world.fleet && world.fleet[t.shipId];
        if (ship) {
          ship.currentIslandId = t.targetIslandId;
          ship.status = 'idle';
        }
        delete world.relocationTasks[t.id];
      }
    }
  }

  // 船维护 15/min:每完整世界 tick 按分钟/60 扣全局金币
  function shipMaintenance(world) {
    if (!world.fleet) return 0;
    let total = 0;
    for (const ship of Object.values(world.fleet)) {
      const type = sd().SHIP_TYPES[ship.type];
      if (type && type.maintenance) total += type.maintenance / 60;
    }
    if (total) world.treasury.coin -= total;
    return total;
  }

  // 每完整世界 tick 统一推进(订单 + 调遣任务 + 维护);断连暂停、任务保留
  function advance(world) {
    advanceOrders(world);
    advanceTasks(world);
    return shipMaintenance(world);
  }

  const api = {
    submitShipOrder, cancelShipOrder, cancelShipyardOrders,
    retireShip, relocateShip, portValid,
    ordersOf, firstOrder, advance, spawnShip,
  };
  root.Engine = root.Engine || {};
  root.Engine.ships = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
