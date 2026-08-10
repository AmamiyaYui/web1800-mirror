/* tiers.js — 阶层与需求表(查询层)
 * 需求数据由 tools/gen-needs-js.py 从 data/人工核查表.xlsx「需求」子表生成(needs-data.js),
 * 勿手改 needs。阶层结构:unlockAt 解锁人口阈值。 */
(function (root) {
  'use strict';
  var NEEDS = (root.Engine && root.Engine.needsData && root.Engine.needsData.NEEDS) || {};

  var TIERS = {
    farmers: {
      id: 'farmers', name: '农民', unlockAt: 0,
      needs: NEEDS.farmers || {},
    },
    workers: {
      id: 'workers', name: '工人', unlockAt: 50,
      needs: NEEDS.workers || {},
    },
    artisans: {
      id: 'artisans', name: '工匠', unlockAt: 150,
      needs: NEEDS.artisans || {},
    },
    engineers: {
      id: 'engineers', name: '工程师', unlockAt: 999999, // [顺序8] 暂不开放(用户指令;数据已备)
      needs: NEEDS.engineers || {},
    },
    investors: {
      id: 'investors', name: '投资人', unlockAt: 999999, // [顺序8] 暂不开放
      needs: NEEDS.investors || {},
    },
  };

  var api = { TIERS };
  root.Engine = root.Engine || {};
  root.Engine.tiers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
