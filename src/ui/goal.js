/* goal.js — 右栏目标面板(进度条) */
(function (root) {
  'use strict';

  // [M-05] 目标附可执行操作(打开建筑分类/定位);onAction(action) 由 main 提供
  // [M-05 fix] g3/g4 按当前进度指向真正缺失的链段(已有链首则引导链尾)
  // action: {type:'build', id} | {type:'locate', id} | null
  function render(el, goal, onAction) {
    const pct = Math.min(100, Math.round((goal.progress[0] / Math.max(1, goal.progress[1])) * 100));
    let actBtn = '';
    let action = null;
    if (goal.id === 'g0') { actBtn = '<button id="goal-act" class="mini-btn">🏗️ 打开建筑菜单:仓库</button>'; action = { type: 'build', id: 'warehouse' }; }
    else if (goal.id === 'g1') { actBtn = '<button id="goal-act" class="mini-btn">⛏️ 建造渔场</button>'; action = { type: 'build', id: 'fishery' }; }
    else if (goal.id === 'g2') { actBtn = '<button id="goal-act" class="mini-btn">📍 定位渔场</button>'; action = { type: 'locate', id: 'fishery' }; }
    else if (goal.id === 'g3' || goal.id === 'g4') {
      // [阻断二 fix] locateTargets 结构化 {id, type}:从同一对象读 id 和显示名,杜绝数组错位
      if (goal.locateTargets && goal.locateTargets.length) {
        const t = goal.locateTargets[0];
        const nm = { potatoField: '土豆田', distillery: '蒸馏厂', sheepFarm: '绵羊牧场', tailor: '纺织厂' }[t.type] || t.type;
        actBtn = '<button id="goal-act" class="mini-btn">📍 定位:' + nm + '(已建,待连接)</button>';
        action = { type: 'locateId', id: t.id };
      } else {
        const next = (goal.missing && goal.missing[0]) || 'potatoField';
        const nm = { potatoField: '土豆田', distillery: '蒸馏厂', sheepFarm: '绵羊牧场', tailor: '纺织厂' }[next] || next;
        actBtn = '<button id="goal-act" class="mini-btn">⛏️ 建造' + nm + '</button>';
        action = { type: 'build', id: next };
      }
    }
    else if (goal.id === 'g5') { actBtn = '<button id="goal-act" class="mini-btn">🏠 建造住宅</button>'; action = { type: 'build', id: 'residence' }; }
    el.innerHTML = '<div class="goal-text">📋 ' + goal.text + '</div>' +
      '<div class="goal-bar"><div class="goal-fill" style="width:' + pct + '%"></div></div>' + actBtn;
    const btn = el.querySelector('#goal-act');
    if (btn && onAction) btn.onclick = () => onAction(action);
  }

  root.UI = root.UI || {};
  root.UI.goal = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
