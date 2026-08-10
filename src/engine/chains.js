/* chains.js — 生产链总览数据(纯函数,可单测) [V1.2 ADR-017] */
(function (root) {
  'use strict';
  const { BUILDINGS } = root.Engine.buildings;
  const { TIERS } = root.Engine.tiers;

  // 按商品聚合: { good: { good, producers: [建筑def], consumers: [建筑def 或 {name, tier}] } }
  function buildChains() {
    const chains = {};
    const get = (g) => (chains[g] = chains[g] || { good: g, producers: [], consumers: [] });
    for (const def of Object.values(BUILDINGS)) {
      if (!def.production) continue;
      for (const g of Object.keys(def.production.outputs || {})) get(g).producers.push(def);
      for (const g of Object.keys(def.production.inputs || {})) get(g).consumers.push(def);
    }
    for (const [tierId, tier] of Object.entries(TIERS)) {
      for (const g of Object.keys(tier.needs || {})) {
        get(g).consumers.push({ name: tier.name + '需求', tier: tierId });
      }
    }
    return chains;
  }

  const api = { buildChains };
  root.Engine = root.Engine || {};
  root.Engine.chains = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
