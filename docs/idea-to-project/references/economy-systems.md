# 需求、住户、幸福度与收入系统

Last updated: 2026-08-10 · Reference

> **按需参考**：用于解释公式和数据链，不是当前版本/范围入口；若与 `../requirements.md` 或代码测试冲突，以后者为准。

数据链：

```text
人工核查表.xlsx「需求」
→ tools/gen-needs-js.py
→ src/engine/data/needs-data.js
→ tiers.js
→ population.js
```

## 1. 单位口径

人工表使用 wiki 原始“每住宅”口径：

| 原表字段 | 原表单位 | 引擎换算 |
|---|---|---|
| 消耗/住宅(每秒) | 每栋满住宅每秒 | `raw / capacity` → 每人口每秒 `rate` |
| 收入/住宅(每分钟) | 每栋满住宅每分钟 | `raw / capacity` → 每人口每分钟 `income` |
| Influx | 满足需求时每住宅提供住户 | 原值直接使用 |
| Happiness | 满足奢侈需求时幸福度 | 原值直接使用 |

阶层住宅容量：农民 10、工人 20、工匠 30、工程师 40、投资人 50。

> generated 文件中的 `rate` 和 `income` 已经是每人口单位；运行时不得再次除容量，也不得把原表值直接当每人口值。

## 2. 需求满足与消费

每 tick，`population.updateNeeds(state)` 对每阶层、每个需求计算：

### 商品需求

```text
required = currentPopulation × need.rate
satisfaction = required > 0 ? min(1, inventory / required) : 1
consumed = min(inventory, required)
```

- 消耗按**当前人口**，不是住宅容量、住宅数量或最大人口
- `consumed` 从库存扣除并写入 `flow[good].consumed`
- 满足度记录在 `population[tier].needSats[good]`

### 服务需求

```text
satisfaction = 被服务道路覆盖的连通住宅数 / 连通住宅总数
```

服务从建筑 footprint 外圈的道路出发，沿道路做加权 BFS：土路每格成本 1，石板路每格成本 2/3。住宅 footprint 自身或四邻触碰覆盖道路即算获得服务。

## 3. 住户目标

基础需求使用**离散 Influx**：

```text
某需求 satisfaction > 0 → 获得完整 need.influx
某需求 satisfaction = 0 → 获得 0
每栋目标住户 = Σ 已有供应的基础需求 influx
阶层总目标 = 连通住宅数 × 每栋目标住户
```

农民示例：

```text
市场 +5
鱼   +3
工作服 +2
合计 10 = 农民住宅容量
```

`updatePopulation` 每 tick 让总人口向目标移动剩余差值的 2%，且最少移动 0.05；差值小于 0.05 时直接吸附到目标，避免劳动力阈值永远差一点。

`refreshOccupancy` 再把阶层总人口按住宅建造顺序分配到 `building.occupied`：先建先满，最后一栋可能部分入住。

## 4. 住宅升级

只能从菜单新建农民住宅。升级必须同时满足：

1. 该栋住宅 `occupied >= capacity`
2. 当前阶层全部基础需求满足
3. 库存拥有升级建材

成功后建筑类型变为下一阶住宅，保留锚点和旋转；相应住户从旧阶层迁移到新阶层。

## 5. 幸福度

奢侈需求不增加人口，只增加阶层幸福度：

```text
tierHappiness = Σ(need.happiness × satisfaction)
state.happiness = Σ(tierHappiness × tierPopulation) / totalPopulation
```

幸福度目前用于显示，不参与收入公式。

## 6. 收入

收入由 `population.collectTax(state)` 每 tick 结算：

```text
incomePerTick = Σtier Σneed(
  need.income × needSatisfaction × currentTierPopulation
) / 60
```

例：10 个农民，鱼和工作服都完全满足：

```text
鱼：      0.125 × 10 = 1.25 /min
工作服：  0.375 × 10 = 3.75 /min
合计：                     5.00 /min
每 tick：                  5 / 60
```

V1.10 修订⑥已删除 `economy.collectTax` 的旧“总人口×0.3×幸福度”公式，并增加从顶层 `tick(state)` 进入的集成测试。

## 7. 生产、维护与速率

- `economy.refresh({produce:true})` 推进生产周期并结算输出
- 维护费字段是每分钟值，每 tick 扣 `maintenance / 60`
- `state.flow` 记录本 tick 生产/消费
- `tick.js` 汇总为 `state.rates`
- 左侧 UI 把每 tick 净值乘以 60，显示 `/min`

## 8. 开局

```text
10000 金币
60 木材
300 鱼
0 人口
0 建筑
```

建造农民住宅后会先按建筑定义满员入住；随后需求不足会使住户向当前 Influx 目标流失。鱼库存提供开局缓冲，但市场和工作服仍需玩家建设。

## 9. 当前缺口

| 项 | 当前状态 |
|---|---|
| 农民/工人/工匠 | 可推进，但完整平衡仍需实玩验证 |
| 工程师/投资人 | 需求和部分产线数据存在，解锁阈值暂设 999999 |
| 皮草/朗姆酒/咖啡/电力等 | 部分需求无可用生产或服务建筑，无法形成高阶闭环 |
| 幸福度等级/暴动 | 未实现 |
| 仓库容量/运输车辆 | 未实现，当前为全局无限资源池 |
