/* ships-data.js — 海事配置(船型/订单/退役返还/调遣)[B-63]
 * 数值来源:multi-island-decision-ledger.md MI-11~MI-16 + REQ-38~41(用户批准)
 */
(function (root) {
  'use strict';

  // 首版只有通用帆船[MI-11]:每单 5000 全局金币、本岛 20 木材 + 10 船帆;180 世界 tick(3 分钟);维护 15/min
  const SHIP_TYPES = {
    genericSailShip: Object.freeze({
      id: 'genericSailShip',
      name: '通用帆船',
      cost: Object.freeze({ coin: 5000, wood: 20, sail: 10 }), // coin=全局钱包;wood/sail=下单岛
      workTicks: 180,
      maintenance: 15,
      cargoSlots: 2,   // [MI-12] 每槽原型容量 50;首版无风力/航速波动
      capacity: 50,
      retireRefund: Object.freeze({ wood: 20, sail: 10 }), // 退役返还(材料进当前停留岛;金币不返)
    }),
  };

  const SHIPYARD_ORDER_LIMIT = 4; // [MI-14] 每厂最多 4 份订单:1 份建造 + 3 份等待
  const RELOCATION_TICKS = 600;   // [MI-16] 灰冠调遣 10 分钟(600 普通世界 tick)

  const api = { SHIP_TYPES, SHIPYARD_ORDER_LIMIT, RELOCATION_TICKS };
  root.Engine = root.Engine || {};
  root.Engine.shipsData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
