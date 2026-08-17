/* goods.js — 商品数据表(改写命名,规避育碧 IP) */
(function (root) {
  'use strict';

  // 货币与商品。coin 为货币,不进商品库存体系
  // cat: currency=货币 material=建材 raw=需求原料 basic=基础需求 luxury=奢侈需求
  const GOODS = {
    // [修订⑤ 顺序8] 原木(原料,原木厂产)与木材(建材,木板厂产)分离
    log: { name: '原木', icon: '🪵', cat: 'raw' },
    // [B-63] 船帆(原料,制帆厂产;通用帆船订单消耗)[MI-08]
    sail: { name: '船帆', icon: '⛵', cat: 'raw' },
    fish: { name: '鱼', icon: '🐟', cat: 'basic' },
    wood: { name: '木材', icon: '🪵', cat: 'material' },
    potato: { name: '土豆', icon: '🥔', cat: 'raw' },
    schnapps: { name: '烈酒', icon: '🥃', cat: 'luxury' },
    clay: { name: '黏土', icon: '🪨', cat: 'raw' },
    brick: { name: '砖块', icon: '🧱', cat: 'material' },
    ironOre: { name: '铁矿石', icon: '⛏️', cat: 'raw' },
    tools: { name: '工具', icon: '🔧', cat: 'raw' },
    wool: { name: '羊毛', icon: '🐑', cat: 'raw' },
    cloth: { name: '布料', icon: '🧵', cat: 'raw' },
    workclothes: { name: '工作服', icon: '👕', cat: 'basic' },
    // [V1.10 修订⑤ 顺序4] 工人层商品
    pig: { name: '猪', icon: '🐖', cat: 'raw' },
    grain: { name: '谷物', icon: '🌾', cat: 'raw' },
    hops: { name: '啤酒花', icon: '🍀', cat: 'raw' },
    sausage: { name: '香肠', icon: '🌭', cat: 'basic' },
    flour: { name: '面粉', icon: '🫓', cat: 'raw' },
    bread: { name: '面包', icon: '🍞', cat: 'basic' },
    lard: { name: '动物油脂', icon: '🧈', cat: 'raw' },
    soap: { name: '肥皂', icon: '🧼', cat: 'basic' },
    malt: { name: '麦芽', icon: '🌱', cat: 'raw' },
    beer: { name: '啤酒', icon: '🍺', cat: 'luxury' },
    coal: { name: '煤', icon: '⚫', cat: 'raw' },
    steelBar: { name: '钢铁', icon: '🔩', cat: 'raw' },
    steel: { name: '钢材', icon: '⚙️', cat: 'material' },
    windows: { name: '窗户', icon: '🪟', cat: 'material' },
    concrete: { name: '混凝土', icon: '🏗️', cat: 'material' },
    // [V1.10 修订⑤ 顺序6] 工匠层商品
    sand: { name: '石英砂', icon: '🏖️', cat: 'raw' },
    glass: { name: '玻璃', icon: '🍶', cat: 'raw' },
    beef: { name: '牛肉', icon: '🥩', cat: 'raw' },
    pepper: { name: '红椒', icon: '🌶️', cat: 'raw' },
    cannedFood: { name: '红椒炖肉', icon: '🍲', cat: 'raw' },
    canned: { name: '罐头', icon: '🥫', cat: 'basic' },
    sewingMachine: { name: '缝纫机', icon: '🪡', cat: 'basic' },
    // [V1.10 修订⑤ 顺序7] 工程师/投资人商品
    cement: { name: '水泥', icon: '🧱', cat: 'raw' },
    zincOre: { name: '锌矿石', icon: '🪨', cat: 'raw' },
    copperOre: { name: '铜矿石', icon: '🥉', cat: 'raw' },
    brass: { name: '黄铜', icon: '🟨', cat: 'raw' },
    goldOre: { name: '金矿石', icon: '🪙', cat: 'raw' },
    glasses: { name: '眼镜', icon: '👓', cat: 'basic' },
    pocketWatch: { name: '怀表', icon: '⌚', cat: 'basic' },
    filament: { name: '灯丝', icon: '🧵', cat: 'raw' },
    lightBulb: { name: '灯泡', icon: '💡', cat: 'basic' },
    steamEngine: { name: '蒸汽机', icon: '🚂', cat: 'raw' },
    saltpeter: { name: '硝石', icon: '🧂', cat: 'raw' },
    oil: { name: '石油', icon: '🛢️', cat: 'raw' },
    grapes: { name: '葡萄', icon: '🍇', cat: 'raw' },
    champagne: { name: '香槟', icon: '🍾', cat: 'basic' },
    veneer: { name: '薄木片', icon: '🪚', cat: 'raw' },
    phonograph: { name: '留声机', icon: '📻', cat: 'luxury' },
    // [修订⑤ 顺序8] 需求子表新增商品(wiki;建筑待实装)
    furCoat: { name: '皮草大衣', icon: '🧥', cat: 'basic' },
    university: { name: '大学', icon: '🎓', cat: 'service' },
    theater: { name: '剧院', icon: '🎭', cat: 'service' },
    rum: { name: '朗姆酒', icon: '🥤', cat: 'luxury' },
    coffee: { name: '咖啡', icon: '☕', cat: 'basic' },
    electricity: { name: '电力', icon: '⚡', cat: 'service' },
    bicycle: { name: '脚踏车', icon: '🚲', cat: 'luxury' },
    bank: { name: '银行', icon: '🏦', cat: 'service' },
    cigar: { name: '雪茄', icon: '🚬', cat: 'basic' },
    chocolate: { name: '巧克力', icon: '🍫', cat: 'basic' },
    steamCarriage: { name: '蒸汽车', icon: '🚗', cat: 'basic' },
    club: { name: '会员俱乐部', icon: '🎩', cat: 'service' },
    jewelry: { name: '首饰', icon: '💎', cat: 'luxury' },
  };

  // 展示分组顺序
  // [V1.10 修订⑤ 顺序8] 基础/奢侈合并为「需求」(同物品不同阶层类型不同,UI 不再分)
  const CATS = [
    { id: 'currency', name: '货币' },
    { id: 'material', name: '🧱 建材' },
    { id: 'raw', name: '🌾 原料' },
    { id: 'needs', name: '🍞 需求' },
  ];

  function name(good) {
    return GOODS[good] ? GOODS[good].name : good;
  }

  const api = { GOODS, CATS, name };
  root.Engine = root.Engine || {};
  root.Engine.goods = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
