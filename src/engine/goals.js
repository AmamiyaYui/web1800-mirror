/* goals.js — 目标驱动新手引导(纯函数,可单测) [V1.1 ADR-016] */
(function (root) {
  'use strict';
  const { TIERS } = root.Engine.tiers;
  const { getDef } = root.Engine.buildings;
  const { computeStatus } = root.Engine.economy;

  // [M-05 fix2] 链段状态区分三种:无实例 / 有实例但全断连 / 至少一栋连通。
  // 返回 { type, have, connected, buildingId }(多栋时任意一栋连通即完成)
  function chainStatus(state, chainTypes) {
    const buildings = Object.values(state.buildings);
    return chainTypes.map((t) => {
      const insts = buildings.filter((x) => x.type === t);
      const conn = insts.find((x) => computeStatus(state, x).status !== 'disconnected');
      return { type: t, have: insts.length > 0, connected: !!conn, buildingId: conn ? conn.id : (insts[0] ? insts[0].id : null) };
    });
  }

  // 返回当前目标: { id, text, progress:[cur,max], done, missing:[type...], locateIds:[buildingId...] }
  // [V1.8] g0 建仓库(菜单) → g1 渔场 → g2 连通 → g3 烈酒链 → g4 人口20 → g5 解锁工人 → g6 自由发展
  function getCurrentGoal(state) {
    const hasWarehouse = Object.values(state.buildings).some((b) => {
      const d = getDef(b.type);
      return d && d.special === 'warehouse';
    });
    if (!hasWarehouse) {
      return { id: 'g0', text: '建造你的仓库(建筑菜单·服务类·500金币,物流起点)', progress: [0, 1], done: false };
    }
    const farmers = state.population.farmers.count;
    const buildings = Object.values(state.buildings);
    const fishery = buildings.find((b) => b.type === 'fishery');
    // 注意:computeStatus 接收建筑对象,不是 id 字符串
    const connected = fishery && computeStatus(state, fishery).status !== 'disconnected';
    const boozeSegs = chainStatus(state, ['potatoField', 'distillery']);
    const boozeMissing = boozeSegs.filter((s) => !s.connected);
    const chainOk = 2 - boozeMissing.length;

    if (!fishery) return { id: 'g1', text: '建造一个渔场(需沿海地块)', progress: [0, 1], done: false };
    if (!connected) return { id: 'g2', text: '把渔场用道路连到仓库', progress: [0, 1], done: false };
    if (chainOk < 2) {
      return {
        id: 'g3', text: '建造烈酒链:土豆田 + 蒸馏厂(' + chainOk + '/2)', progress: [chainOk, 2], done: false,
        missing: boozeMissing.map((s) => s.type),
        // [阻断二 fix] 结构化定位目标 {id, type}:UI 从同一对象读取,避免数组错位
        locateTargets: boozeMissing.filter((s) => s.have).map((s) => ({ id: s.buildingId, type: s.type })),
      };
    }
    // [V1.10] g4:工作服链(全基础需求之一,人口模型 Influx 驱动;修订⑤ 一步链:绵羊+纺织)
    const wcSegs = chainStatus(state, ['sheepFarm', 'tailor']);
    const wcMissing = wcSegs.filter((s) => !s.connected);
    const wcChain = 2 - wcMissing.length;
    if (wcChain < 2) {
      return {
        id: 'g4', text: '建造工作服链:绵羊牧场 → 纺织厂(' + wcChain + '/2)', progress: [wcChain, 2], done: false,
        missing: wcMissing.map((s) => s.type),
        locateTargets: wcMissing.filter((s) => s.have).map((s) => ({ id: s.buildingId, type: s.type })),
      };
    }
    if (farmers < TIERS.workers.unlockAt) {
      return { id: 'g5', text: '解锁工人:农民人口达到 50(当前 ' + Math.round(farmers) + '/50)', progress: [Math.round(farmers), TIERS.workers.unlockAt], done: false };
    }
    return { id: 'g6', text: '自由发展!满足更多需求,壮大你的城市', progress: [1, 1], done: true };
  }

  const api = { getCurrentGoal };
  root.Engine = root.Engine || {};
  root.Engine.goals = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
