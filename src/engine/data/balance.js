/* balance.js — 可配置平衡参数(数据驱动,逻辑不硬编码) */
(function (root) {
  'use strict';

  // [V1.8] 拆除返还比例:key=商品,未列出的商品默认 1.0(全额返还);coin 不返还
  const DEMOLISH_REFUND = { coin: 0 };

  // [V1.10 修订⑤ 顺序13] 道路费用:土路建造 3/格;石板路不能在空地直接建,
  // 只能在已有土路上升级(12/格,服务传播 1.5 倍)
  const ROAD_COST = { dirt: 3, stone: 12 };

  function refundRatio(good) {
    return good in DEMOLISH_REFUND ? DEMOLISH_REFUND[good] : 1.0;
  }

  const api = { DEMOLISH_REFUND, refundRatio, ROAD_COST };
  root.Engine = root.Engine || {};
  root.Engine.balance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
