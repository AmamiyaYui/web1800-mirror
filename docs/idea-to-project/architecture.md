# Architecture — 蒸汽都市

Last updated: 2026-08-11 · Normative: current

## 1. 系统上下文

```text
玩家浏览器
├─ 静态游戏（index.html + style.css + src/ + assets/）
│  ├─ Canvas 地图
│  ├─ DOM HUD / 面板
│  ├─ DOM-free 模拟引擎
│  └─ localStorage 存档
├─ 留言管理页（admin.html）
└─ 可选网络调用 /api/messages
                 │
                 ▼
       Cloudflare Worker + D1
```

游戏主体是零依赖静态应用，可在 `file://` 或任意静态服务器运行。留言板是唯一网络后端；API 不可用时只隐藏/降级留言功能，不影响模拟和存档。

## 2. 仓库结构

```text
web1800/
├─ index.html                 浏览器脚本加载顺序与 HUD DOM
├─ admin.html                 留言管理界面
├─ style.css                  固定覆盖层与响应式样式
├─ src/
│  ├─ main.js                浏览器装配、输入、计时、自动存档、留言请求
│  ├─ engine/
│  │  ├─ data/
│  │  │  ├─ goods.js         63 种商品/资源
│  │  │  ├─ needs-data.js    generated：5 阶层需求
│  │  │  ├─ tiers.js         阶层查询与解锁阈值
│  │  │  ├─ buildings-data.js generated：64 种建筑
│  │  │  ├─ buildings.js     建筑查询
│  │  │  ├─ map-template.js  160×160 种子地图(v1 旧档 128×128 迁移居中)
│  │  │  └─ balance.js       道路等平衡常量
│  │  ├─ state.js            初始状态、资源/日志/flow 辅助函数
│  │  ├─ tick.js             顶层模拟编排与时间推进
│  │  ├─ economy.js          生产状态、周期、维护费、开发度
│  │  ├─ population.js       需求、服务覆盖、住户、幸福度、收入
│  │  ├─ placement.js        footprint、放置、旋转、道路、升级、移动
│  │  ├─ connectivity.js     多仓库 BFS 与惰性缓存
│  │  ├─ goals.js            g0~g6 新手目标
│  │  ├─ chains.js           生产链聚合
│  │  ├─ save.js             JSON 存档与迁移
│  │  └─ events.js           事件总线
│  ├─ render/map-renderer.js Canvas 地形、道路、建筑、预览、范围、昼夜
│  └─ ui/                    资源、目标、菜单、详情、指南、生产链、小地图
├─ tests/engine.test.mjs      Node 内置 test runner；当前数量见 status
├─ tools/                     Excel 生成器、部署和管理脚本
└─ workers/messages-worker.js Worker + D1 留言 API
```

## 3. 双端引擎边界

引擎文件以 IIFE 同时支持浏览器和 Node：

```js
root.Engine.moduleName = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
```

约束：

- `src/engine/` 不直接读取 DOM；`save.js` 仅通过 `typeof localStorage` 能力检测访问存储
- 浏览器 `<script>` 顺序等于依赖顺序；测试文件按同样顺序 `require`
- 可能晚加载的跨模块依赖在函数调用时读取，不在 IIFE 顶部提前解构
- UI/renderer 可以读 state 并调用引擎 API，但不复制模拟公式

## 4. 顶层数据流

### 4.1 新游戏

```text
createInitialState(seed)
→ generateMap(160, seed)
→ 5000 coin / 60 wood / 100 fish
→ 0 population / 0 buildings / 0 roads
→ g0：从菜单建造仓库
```

### 4.2 每 tick

```text
state.initFlow
→ economy.refresh(produce=true)      生产周期 + 维护费 + 建筑状态
→ population.updateNeeds             当前人口消费 + 服务满足度
→ population.updatePopulation        离散 Influx 目标 + 2% 趋近
→ population.updateHappiness         阶层幸福度人口加权
→ population.collectTax              需求收入（不是旧幸福度税率）
→ population.checkUnlocks
→ 汇总 flow 为 rates，并更新 60 tick 平滑窗口
→ 目标检查 / 时间累加 / state-changed
```

浏览器计时器按 `1000 / speed` 毫秒调用 tick；Canvas 由独立 `requestAnimationFrame` 循环渲染。每 30 个逻辑 tick 自动保存一次，`beforeunload` 再保存。

## 5. 领域模型

### State

```text
state = {
  map: { size, seed, terrain[][] },
  resources: { coin, goods... },
  population: { tier: { count, needSats, satisfaction, happiness } },
  buildings: { id: { id, type, x, y, rot, status, cycleAcc, occupied... } },
  grid: { "x,y": buildingId },
  roads: { "x,y": 1|2 },
  unlocks, goals, flow, rates, time, settings, log, _conn
}
```

- `x/y` 是建筑几何中心；footprint 是唯一占地真相
- `roads=1` 为土路，`2` 为石板路
- `resources` 是全局总资源池，不按仓库拆分
- `occupied` 是按先建先满从阶层总人口派生的单栋住户显示

### 地形

| 代码 | 含义 |
|---:|---|
| 0 | 平地 |
| 1 | 旧森林兼容码；新图不生成，读档迁移为平地 |
| 2 | 黏土 |
| 3/4/5 | 铁/铜/金 |
| 6 | 水域 |
| 7 | 山脉 |
| 8/9/10 | 煤/锌/石灰岩 |

### 放置与连通

- 普通建筑只建于平地
- 矿场必须完整覆盖对应矿床
- 海岸建筑 footprint 全水且邻接陆地
- BFS 从所有仓库 footprint 出发，可通过道路和建筑 footprint 传播
- 拓扑修改调用 `markDirty`，首次查询重建缓存
- 生产建筑还需接触仓库 `serviceRoads('warehouse')` 覆盖

## 6. 人口与服务

- 每个阶层拥有独立需求表，下层需求不自动继承
- 服务建筑从 footprint 外圈道路开始加权 BFS
- 土路每格消耗 1 距离，石板路每格消耗 2/3
- 住宅触碰覆盖道路即获得该服务
- 基础需求有供应即提供完整 Influx；人口向所有连通住宅的目标缓慢收敛
- 收入由 `population.collectTax` 结算：`need.income × satisfaction × current population / 60`

## 7. 浏览器 UI

- Canvas 是全窗口背景；顶部、左右栏和底部为 fixed overlay
- renderer 提供相机、0.5~4 倍焦点缩放、preview、radius 和 debug getter
- `window.__game` 暴露 state/redraw/renderer/getMode，供浏览器 smoke 使用
- HUD 使用渐进披露：顶栏显示关键即时状态，次级面板解释趋势/分项，建筑详情承载局部诊断，地图负责定位和高亮
- 模式切换统一经 `setMode`，移动成功/失败/取消/对象消失必须同步内部状态、按钮高亮和提示条
- 已知延期：小地图与右栏重叠、左右栏未折叠、锁定阶层未显示具体阈值；等待 B-38 UI 重构

## 8. 存档与迁移

- Key：`web1800-save-v1`
- JSON 包含完整地图和状态；坏档原文写入备份 key 后返回新游戏
- 迁移补充 time、道路等级、建筑 rot、连接缓存，并把旧森林格转换为平地
- `normalizeRatesHistory` 由 load 与 tick 共用：窗口数组/长度/有限值/重算累计值不合法时丢弃窗口，后续 tick 安全重建
- 重置流程必须先替换自动保存函数，再清 key 和 reload，避免 beforeunload 写回旧档

## 9. 留言后端

- `GET /api/messages`：公开读取
- `POST /api/messages`：玩家留言；管理员回复/状态更新需 `X-Admin-Key`
- `DELETE /api/messages[/id]`：管理员删除
- D1 字段：`id,nick,text,ts,is_dev,parent_id,status`
- 客户端只在内存保存管理员输入的 key；仓库中不得出现真实密钥

## 10. 部署

Cloudflare Pages 使用：

```text
Build command: bash tools/deploy.sh
Output directory: deploy
```

`deploy/` 仅包含 `index.html`、`admin.html`、`save-transfer.html`、`style.css`、`src/`、`assets/`。Worker 与 D1 独立部署并路由到 `web1800.top/api/*`。

## 11. 已批准的多岛目标架构（尚未实现）

```text
World
├─ treasury.coin
├─ maxOwnedIslands          配置值，首版12；schema不写死
├─ activeIslandId
├─ islands[islandId]
│  ├─ map / buildings / roads / grid
│  ├─ resources             岛内多仓库共享，岛间隔离
│  ├─ population
│  ├─ fertilities / deposits
│  └─ camera
├─ fleet[shipId]
├─ shipOrders[orderId]
├─ transportTasks[taskId]
├─ relocationTasks[taskId]
└─ expeditionTasks[taskId]
```

- 现有单岛 `state.resources.coin` 迁移到 `world.treasury.coin`；其他商品、人口、地图和建筑包装为主岛。
- 船舶订单保存 `paidCost/orderIslandId/totalWork/remainingWork`；提交时原子全额扣款。任意未完工订单取消都按 `paidCost` 全额返还全局金币和 `orderIslandId` 的材料，工作进度直接丢弃；成品船保存 `constructionCostPaid`，配置改价不得反向改变历史取消或退役依据。
- 船只不绑定永久造船厂；造船厂面板管理订单，世界舰队面板管理成品船和任务。
- 运输槽保存玩家配置速率，范围 0～5 单位/min、步长 0.1；双槽最大 10 单位/min。容量 50 只作为货仓规格，不参与虚构航次换算。
- 来源码头只有在建成且经陆侧道路连通本岛任意仓库时有效；失效时保留并阻塞来源任务，恢复有效后继续，移动和拆除不得级联删除任务或船实体。
- `transportTask` 固定保存 `sourceIslandId/targetIslandId/shipId`，只允许更新槽位商品和速率，并把编辑、暂停、恢复、取消命令排到下一完整世界 tick 边界原子提交。船绑定期间逻辑停留来源岛；`userPaused` 与码头派生的 `blockedReason` 独立，只有前者由玩家恢复清除。取消不依赖码头，边界提交时删除任务、将船置为来源岛 `idle`，不创建返航任务。

## 12. 世界 tick 与运输原子阶段

```text
产生一个世界逻辑 tick
→ 基于 tick 开始库存计算持续运输请求与比例分配
→ 按帧预算逐岛执行精确生产/需求/人口/服务
→ 所有岛完成后统一提交运输、全局财政、flow/rates、UI 与保存资格
```

- 只渲染当前岛；离岛不得冻结或换成未验证的近似公式。
- 同一来源岛、同一商品被多条航线争抢时先汇总请求，再按比例原子扣减和增加，禁止边遍历边扣货。
- 自动保存只能发生在完整世界 tick 边界，不能序列化部分岛已推进的状态。
- 高负载时不得静默丢 tick；具体积压提示/自动降速交互仍待批准。

### 12.1 B-62 实现：世界 tick 分帧与切岛（已启动）

```text
tick(world, { frameBudget? })
→ 若 paused 直接返回 { ticked:false, complete:false }
→ 取岛稳定顺序(islands 键排序)
→ 本轮从 world._tickCursor 起执行 frameBudget 个岛(默认 Infinity=一帧全部)
→ 每个岛执行完整单岛模拟:
    initFlow → refresh(produce) → updateNeeds → updatePopulation
    → updateHappiness → collectTax → checkUnlocks → 岛级 rates/ratesHistory 汇总
→ cursor 到达末尾(完整世界 tick):
    world._tickCursor = 0
    统一推进 world.time、emit state-changed
    返回 { ticked:true, complete:true }
→ 未到达(分帧中):world._tickCursor = cursor,返回 { ticked:false, complete:false }
```

- 分帧状态 `world._tickCursor` 不落盘：`serialize` 前清零，`normalizeWorld` 清理旧值；默认（无 frameBudget）一帧完成全部岛，main.js 每定时器回调即完整世界 tick，保存门与 beforeunload 语义与旧单岛一致。
- 财政统一提交语义：金币在 `world.treasury`（岛 `resources.coin` 为别名），岛模拟即时写 treasury；可观测统一由"UI 与自动存档只在完整世界 tick 后刷新"保证（REQ-32/AC-17）。
- 每岛 flow/rates/ratesHistory 独立；世界级不聚合（UI 只展示活动岛）。
- 切岛入口（REQ-33）：顶部 `island-select` 下拉 + 世界航图 overlay 骨架（岛列表：名称/人口/摘要）。`switchIsland(id)`：写 `world.activeIslandId` → 清理选中建筑/范围圆/放置预览/工具模式/旋转 → 相机 `focusInitialArea()` 定位新岛 → 刷新下拉/航图/redraw。切岛不清空离岛任何模拟状态。

## 13. 岛屿生成与资源禀赋

```text
区域/开局保底
→ 计算玩家世界缺失植物和矿物
→ 仍有缺失时各强制选择至少1种
→ 随机填充剩余槽（每类最多4种）
→ 只为入选矿物生成真实矿床
→ 运行连通、平地、合法海岸和矿场嵌合坏图门
```

- 当前灰冠植物候选来自运行生产配置：`potato/grain/hops/pepper/grapes`。
- 当前灰冠矿物候选来自运行地图与矿场配置：`clay/iron/coal/limestone/zinc/copper/gold`。
- `fertilities` 是岛级种植权限；`deposits` 是允许生成的矿物类型；`terrain` 才是真实矿床格，三者不得混成一个字段。只为 `deposits` 中的入选类型生成矿床；数量配置为黏土3～4、铁5～6、煤4～5、铜3～4、锌2～3、石灰岩2～3、金1～2组。黏土使用5×5海岸候选，其余使用3×3山缘候选，每个候选块必须能被对应矿场完整嵌合。
- 同 tick 完成多个探索时按稳定任务顺序逐个生成，每成功一个岛就重算缺失集合。
- 地图生成返回前必须校验每种入选矿物达到本次抽定组数；候选不足时用原 seed 派生的确定性 attempt seed 重试，达到上限后走确定性合法兜底布局。不得沿用当前 `placeBlocks()` 返回数量但调用方忽略的静默减组行为。

## 14. 旧 128×128 主岛迁移

```text
oldSize = 128
newSize = 160
offset = 16

newTerrain = 160×160 全水
newTerrain[y+16][x+16] = oldTerrain[y][x]
所有持久化地图坐标 += 16
```

- 中央旧地图不得按 seed 重生；外圈不生成任何陆地、资源、装饰、道路或建筑。
- 迁移后重建 grid、道路连通、服务覆盖、小地图和渲染缓存。
- 旧主岛固定植物清单为 `potato/grain/hops/pepper/grapes`，不用通配符；未来作物不自动补入。
- 保存明确 `schemaVersion` 和迁移完成标识；失败不得覆盖可用旧档，二次加载不得再次偏移。首次多岛迁移先把主存档原始字符串写入不可自动覆盖的 `web1800-save-v1.pre-multi-island`，已存在则保持原值；写入失败即中止迁移。自动保存、新游戏和 `clearSave()`只操作主键，不碰迁移前备份。`save-transfer.html`负责下载、可选导出、恢复和二次确认删除；恢复前必须先把当前主存档成功写入普通 `.bak`。

## 15. 规划配置模块

```text
goods.js                 sail 商品
buildings-data.js        sailMaker / port / sailingShipyard
ships-data.js            船型、订单成本、维护、货仓规格
expeditions-data.js      探索时长、成功率、四档补给
world-data.js            岛屿尺寸、上限、灰冠候选与初始包
```

- 每座造船厂订单队列固定 4 份（1 建造＋3 等待）；断连、缺工和移动只暂停并保留队列。拆除造船厂时，等待中和建造中的未完工订单统一取消，按各自付款快照全额返还，已投入时间与进度清零。
- 只有岛上空闲船可退役；按付款快照返还 20 木材＋10 船帆到当前停留岛，金币不返；海上状态必须先结束任务并回岛。
- 探索成功直接取得新岛，不再付费且不自动切岛；任务发起时预留岛屿名额。

- 新模块必须继续双端导出，并同步登记 `index.html` 与测试加载顺序。跨模块配置引用在运行时解析；建筑/需求 generated JS 仍由可维护来源生成，不直接手改。

### 15.2 B-64 实现：灰冠探索与岛屿生成（已实现）

```text
world.expeditionTasks[taskId] = { id, shipId, sourceIslandId, tier, successRate,
                                   roll, remaining }   // roll 创建时确定性掷骰
```

- 主岛与新岛统一 4 植物/4 矿物（REQ-37）：主岛保底 `potato/grain/hops` + 黏土/铁，其余槽位用 seed 派生 LCG 确定性补满（煤矿不保底，煤商品由炭窑获得）；`generateIsland(size, seed, deposits)` 只生成入选矿物的矿床（分级组数，黏土 5×5 其余 3×3）；旧档迁移主岛仍固定 5 植物/既有矿床不重生。
- 探索四档（REQ-42/MI-17）：60/70/80/90% 成功率，成本递增（船 + 鱼/木/工作服/烈酒/船帆），金币均 0；发起时从来源岛一次性扣除、船占用、预留 12 岛名额；成功/失败/放弃均不返还。
- 探索推进独立于暂停（REQ-42）：main.js 每真实秒推进 1 tick，游戏暂停仍推进，关闭页面停止；确定性 roll 使读档结果不变。
- 成功 → 直接获得灰冠岛（不自动切岛）：补缺（世界缺失植物/矿物至少各 1 种）+ 随机填满 4+4；`generateNewIsland` 用派生 seed 重试矿床组数，不足时确定性兜底（组数最多的一次）；初始鱼 100/木材 20/其他 0，金币走全局钱包（`attachCoinAlias`）。
- 失败/放弃：船损失、投入不返还；失败与放弃释放名额。
- UI：世界航图舰队区空闲船可发起探索（四档选择），探索任务区显示剩余时间与放弃按钮。

### 15.3 B-65 实现：岛间持续运输（已实现）

```text
world.transportTasks[taskId] = { id, shipId, sourceIslandId, targetIslandId,
                                 slots:[{good,rate}], userPaused, blockedReason,
                                 carried, _pending }   // _pending 下一完整 tick 原子提交
```

- 创建：绑定 idle 船 + 来源码头有效（REQ-40）+ 目标已拥有岛（可无码头）；槽 ≤2、每槽 0~5/min 步长 0.1、整船 ≤10/min、商品不重复；来源/目标/分配船不可热改（编辑仅改槽）。
- 命令（编辑/暂停/恢复/取消）写入 `_pending`，下一完整世界 tick 边界原子提交（AC-24）；取消任意状态无条件，下一边界船解绑为来源岛 `idle`，不回滚。
- 结算两阶段（architecture 12）：tick 开始 `beginTransport` 基于**tick 开始库存**汇总 (来源,商品) 请求并按比例原子分配（暂存 `_transportPlan`，结果不依赖遍历顺序）；完整 tick 结束 `commitTransport` 统一扣来源/加目标/累计 carried。岛模拟的库存变化不影响本次分配。
- `userPaused` 与码头派生的 `blockedReason` 独立：暂停保留绑定并继续维护、可编辑；拆/断码头派生阻塞，复连自动解除（不解除主动暂停）；恢复清除暂停，码头无效仍阻塞。
- UI：世界航图空闲船可创建航线（目标岛 + 商品 + 速率），航线任务区显示状态/槽摘要与暂停/恢复/取消。

### 15.1 B-63 实现：海事引擎（已实现）

```text
world.shipOrders[orderId] = { id, shipyardId, islandId, shipType,
                               paidCost, totalWork, remainingWork }
world.fleet[shipId] = { id, type, currentIslandId, status, constructionCostPaid }
world.relocationTasks[taskId] = { id, shipId, sourceIslandId, targetIslandId, remaining }
```

- `ships-data.js` 配置船型：通用帆船 5000 全局金币 + 本岛 20 木/10 帆、180 世界 tick、维护 15/min、2 槽×容量 50、退役返还 20 木+10 帆；每厂订单上限 4；调遣 600 tick。
- 订单提交原子全额扣费并保存付款快照与下单岛；任意未完工取消按快照全额返还（金币回 treasury、材料回下单岛）；拆除造船厂由 UI 联动 `cancelShipyardOrders`；断连/缺工/移动时订单暂停不推进（`advanceOrders` 只推进 `producing` 船厂的首份订单）。
- 船实体为世界层；只有 `idle` 船可退役（材料进当前停留岛，金币不返）；调遣需来源有效码头（建成+连通仓库），目标岛无需码头，600 tick 到达后 idle，途中禁止退役。
- 每完整世界 tick 在 `finalizeWorldTick` 统一推进：订单工作量、调遣任务、船维护（15/min÷60）。
- 码头每岛最多 1 座（`canPlace` 校验）；船厂订单区 UI 在详情面板（下单/取消），舰队区在世界航图（船状态+退役）。
