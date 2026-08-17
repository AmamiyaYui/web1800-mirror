# Decision History — 蒸汽都市

> **非规范历史**：以下内容按时间保留截至 V1.10 修订⑦前的完整 ADR 流水，其中多项已被后续决策取代。
> 当前实现只能以 `../decisions.md`、`../requirements.md`、`../architecture.md`、代码和测试为准；不得从本文件推断现行规则。

# Decisions — 蒸汽都市

当前仅保留 accepted / proposed 决策。历史决策见 decision-history.md(首次反转后创建)。

## ADR-001: 展示定位——游戏本体由 AI agent 开发
Status: accepted
Context: 作者核心目标是展示指挥 AI agent 做产品的能力;游戏玩法与画面服务于这一展示目标。
Decision: 整个游戏由 AI agent 完成开发与验证;产品成品即展示物。
Alternatives: 在游戏里内置 AI 角色(未选);做成纯技术演示(未选)。
Consequences: 开发过程需可复述(作者自用存档);成品游戏本身即展示物,不设专门展示页(用户 2026-08-05 确认)。

## ADR-002: 产品形态——复刻纪元1800 内容逻辑
Status: accepted
Context: 用户明确要求复刻《纪元1800》的游戏内容逻辑,做成 Web 端轻量形态。
Decision: 复刻核心经济模拟逻辑(生产链/人口阶层/需求/幸福度/税收/劳动力 + 空间规划),命名与美术全部改写规避 IP。
Alternatives: 全新原创玩法(未选);完整高保真复刻(规模不可行,未选)。
Consequences: 玩法规则可借鉴,资产与名称必须原创改写;数据表以"逻辑等价"为原则,数值不必与原版一致。

## ADR-003: 界面形态——L2 方块地图
Status: accepted
Context: 用户在 L1 面板 / L2 方块地图 / L3 装饰化 中选择了 L2。
Decision: 2D 网格(建议 30×30)+ 色块/文字标签建筑,无美术资产;保留空间规划玩法。
Alternatives: L1 纯面板(无地图,开发最快);L3 等距/动画(好看但成本高)。
Consequences: 渲染与交互复杂度中等;需实现放置/道路/连通性逻辑。

## ADR-004: v1 范围——旧世界单岛 + 核心生产链,阶层至工匠
Status: accepted
Context: 完整复刻规模不可行;用户批准切分方案。
Decision: v1 = 旧世界单岛、固定地图、建设 3 + 农民 3 + 工人 4 + 工匠 2 条生产链、阶层止步工匠;新世界/航运/工程师/投资人/眼镜/珠宝/随机地图 → v2。
Alternatives: 含新世界与航运(工作量翻倍,未选)。
Consequences: 咖啡/香槟等依赖新世界的商品不在 v1 出现;工匠需求由罐头/蜡烛支撑。

## ADR-005: 道路系统——方案 A 真实道路
Status: accepted
Context: 用户在 A 真实道路 / B 隐式连通 / C 自动铺路 中选择 A。
Decision: 手动铺路(点击/拖拽画路)+ 建筑贴路自动接路 + 仓库洪泛填充连通判定;断连 → 停工 + ⚠️;民居断连保留人口但停止需求统计。
Alternatives: B 隐式连通(无铺路玩法);C 自动铺路(零操作)。
Consequences: 多 15~20% 工作量,获得原版空间规划体验;连通性 BFS 为可展示的逻辑亮点。

## ADR-006: 命名与美术合规
Status: accepted
Context: 纪元1800 为育碧 IP,公开发布需规避资产与名称直用。
Decision: 建筑/商品采用改写命名(如 麦芽厂→酿造坊),全部美术为程序生成色块/文字,不使用官方素材。
Alternatives: 原名直用(有侵权风险,未选)。
Consequences: 不影响玩法逻辑复刻效果;"致敬"定位在展示页中说明。

## ADR-007(proposed): 存档方案——localStorage 自动存档
Status: proposed
Context: 无后端约束下需要进度持久化。
Decision: 每 30 秒 + 关键事件自动写 localStorage;JSON 版本号校验;损坏则备份重置。
Alternatives: IndexedDB(更重,无必要);无存档(体验差)。
Consequences: 单浏览器单机存档,符合 v1 定位。

## ADR-008(proposed): 打赏入口
Status: proposed
Context: 变现目标,渠道未定。
Decision: 页面常驻"打赏"按钮,链接配置化占位;后续接入爱发电/收款码等。
Alternatives: 平台内支付(需后端/平台,超范围)。
Consequences: 零成本可替换;实际渠道由用户决定后填入配置。

## ADR-009: 模块分层 engine / render / ui
Status: accepted
Context: 方案 A(零依赖原生 JS)批准后,需要明确代码组织。
Decision: 三层分离——engine 纯逻辑(无 DOM,Node 可测)、render Canvas 绘制、ui DOM 面板;main.js 唯一组装点;引擎独立于渲染,未来换框架/加后端不重写引擎。
Alternatives: 单文件全耦合(不可测,未选);Phaser 框架内组织(方案 B,未选)。
Consequences: 引擎可单测;文件职责单一,agent 开发错误率低。

## ADR-010(proposed): 固定步进 tick
Status: proposed
Context: 游戏循环策略。
Decision: 1s 固定步进 × 速度倍率(1x/2x/3x/暂停);顺序:生产→消耗→需求→幸福度→人口→税收→解锁;逻辑与渲染解耦,不依赖 rAF。
Alternatives: requestAnimationFrame 每帧模拟(渲染与逻辑耦合,未选)。
Consequences: 确定性好、易测试;手感为"回合感"而非连续动画,符合轻量定位。

## ADR-011(proposed): 存档 JSON schema 版本化
Status: proposed
Context: 存档演进需要向前兼容。
Decision: 存档带 `v` 字段与时间戳;save.js 唯一读写点;损坏/版本不兼容 → 备份 + 重置提示。
Alternatives: 无版本裸 JSON(升级即废档,未选)。
Consequences: 未来加内容(新商品/新地图)可写迁移函数,不丢档。

## ADR-012(proposed): Node 内置 test runner 零依赖单测引擎
Status: proposed
Context: 引擎正确性是"逻辑复刻"的核心卖点,必须有可执行验证。
Decision: tests/ 用 `node --test`(Node ≥18)跑引擎纯函数测试;覆盖守恒律/连通性/解锁/放置规则。
Alternatives: 浏览器内手测(不系统,未选);引入 Vitest/Jest(与零依赖定位冲突,未选)。
Consequences: 引擎行为可回归验证;测试即"规则说明书"。

## ADR-013(proposed): 事件总线解耦引擎与 UI
Status: proposed
Context: 引擎不应知道 UI 存在。
Decision: engine/events.js 提供 on/emit;UI 订阅 log/building-status/population-change/unlock/save-needed 事件。
Alternatives: 直接调用 UI 函数(耦合,未选)。
Consequences: UI 可整体替换;事件清单即引擎对外契约。

## ADR-014: V1.1 改进包范围(B-01/B-02/B-03)
Status: accepted
Context: V1.0 验证后用户不满意,要求补齐体验与内容;用户批准迭代协议与 V1.1 范围。
Decision: V1.1 = 体验急救包(教程目标系统/放置预览/拖拽操作)+ 开局平衡 + 经济闭环包(伐木营地/烈酒链/市场范围加成)。信息反馈包与其余内容留后续轮次。
Alternatives: 直接继续 M2 内容补全(用户否决);一次性做全部改进(违反每轮 ≤4 项纪律)。
Consequences: V1.1 交付后仍是可玩版本;新增 REQ-27~34;后续轮次从 backlog 续接。

## ADR-015: 市场范围加成机制
Status: accepted
Context: 空间规划需要"覆盖"维度(不只是连通)。
Decision: 市场建筑 radius=4(Euclidean);范围内已连通住宅占比 = 覆盖率;该阶层满足度 += 0.2×覆盖率(封顶 1.0)。断连市场不生效。
Alternatives: 覆盖内住宅直接+幸福度(与需求脱钩,未选);无市场机制(空间规划单薄,未选)。
Consequences: 需求短缺时市场可托底满足度;摆位成为有效决策。

## ADR-016: 目标驱动新手引导
Status: accepted
Context: V1.0 无目标感,玩家不知道为何玩/下一步做什么。
Decision: engine/goals.js 纯函数 getCurrentGoal(state) 输出当前目标与进度;UI 顶部目标面板显示进度条;目标序列:建渔场→连通→人口20→解锁工人→自由发展。
Alternatives: 步骤弹窗强引导(打断感强,未选);无引导(保持现状,未选)。
Consequences: 目标逻辑可单测;引导与状态解耦,后续可加更多目标。

## ADR-017: V1.2 信息反馈包范围(B-04)
Status: accepted
Context: V1.1 后经济变复杂,玩家缺乏"我缺什么/下一步建什么"的信息反馈。
Decision: V1.2 = 全局库存面板(库存+产出/消耗/净速率)+ 生产链总览(生产者→商品→消费者)+ 产出飘字动画。新增 REQ-35~37。
Alternatives: 直接补内容链(信息不足时玩家体验差,未选);一次性做全部 backlog(违反轮次纪律)。
Consequences: 信息透明化后,玩家决策有依据;为后续内容扩充打基础。

## ADR-018: 每 tick 流量统计机制
Status: accepted
Context: 库存面板需要 产出/消耗/净速率,而非仅瞬时库存。
Decision: tick 开始时初始化 state.flow = {};economy.refresh(produce) 记 produced/consumed,population.updateNeeds 记 consumed,collectTax 记 coin produced;tick 末汇总为 state.rates = { good: {produced, consumed, net, stock} }。addFlow 助手在 state.js。
Alternatives: 前后快照差值(无法区分产/耗,未选);滑动窗口平均(复杂,未选)。
Consequences: 速率是当 tick 的瞬时值,简单可测;UI 显示净速率正负颜色。

## ADR-019: 产出事件与飘字
Status: accepted
Context: 产出需要即时视觉反馈。
Decision: economy.refresh 产出时 emit 'produced' {id, good, qty};渲染器维护浮字列表(1.2s 上升淡出,上限 30 条),main.js 用 rAF 循环驱动。
Alternatives: 轮询库存差值(延迟一帧且逻辑耦合,未选);CSS 动画 DOM 层(需同步画布坐标,未选)。
Consequences: 引擎与反馈解耦;事件即契约(计入 AGENTS.md 事件清单)。

## ADR-020: V1.3 建设材料链范围(B-05)
Status: accepted
Context: 木材已可再生,但砖/工具仍是死资源;建筑成本单一(仅金币/木材),材料链无消耗出口。
Decision: V1.3 = 砖块链(黏土坑→砖厂)+ 工具链(铁矿场→工具厂);砖/工具接入建筑成本(蒸馏厂/市场 +砖,工具厂 +砖);伐木营地已在 V1.1 完成,不在本轮重复。新增 REQ-38~40。
Alternatives: 建链但成本不接入(链条无意义,未选);一次性做全部 12 链(违反轮次纪律)。
Consequences: 玩家需先建砖链才能建高级建筑,形成自然进阶;现有测试需补砖链前置(更新 setupSchnapps 等)。

## ADR-021: V1.4 工作服链与需求平衡(B-06)
Status: accepted
Context: 农民需求 3 项齐备(鱼/烈酒/工作服)后,仅渔场满足度 0.33,会卡死增长;教程目标也未覆盖烈酒链。
Decision: V1.4 = 工作服链(牧羊场→织布厂→缝纫厂)+ 目标序列插入烈酒链步骤 + 流失阈值 0.4→0.3。新增 REQ-41~43。
Alternatives: 不加工作服需求(链条无意义,未选);保持阈值不动(新手只建渔场会流失人口,体验差,未选)。
Consequences: 增长曲线:渔场止血 → 烈酒链启动增长 → 工作服链提速;教程与三需求一致。

## ADR-022: V1.5 UI 架构重构(B-19)
Status: accepted
Context: 固定网格三栏布局中,中央地图固定 900×900,窗口留白;且地图扩大(未来 60×60 等)会破坏布局——边栏与地图互相牵制。
Decision: V1.5 = UI 架构重构:① 地图画布铺满全窗为背景底(瓦片随窗口等比缩放);② 渲染器引入相机 {x,y}(平移 + 边界钳制 + 地图小于视口自动居中);③ 右键拖拽平移视野(左键交互不变);④ 所有边栏改为 position:fixed 浮动覆盖层(上=设置/信息/打赏,左=经济,右=目标/反馈,下=操作/建设)。新增 REQ-44~46。
Alternatives: 保留三栏网格 + 仅加平移(边栏仍占固定列,地图扩大后视口被挤压,未选);边栏移入画布内嵌(与地图重叠冲突,未选)。
Consequences: 布局与地图解耦——地图可任意扩大/缩放/移动,边栏永远悬浮;渲染器承担相机逻辑(浏览器层,引擎不变);左键建造/铺路/拆除交互不变,右键专用于平移。

## ADR-023: V1.6 税收重构 + 时间系统(B-20~22)
Status: accepted
Context: ① 可调税率滑杆非原版机制,且与"收入随人口/满足度自然变化"的纪元1800 逻辑不符;② 玩家无法感知时间流逝;③ 左栏速率显示需核对。
Decision: V1.6 = ① 移除税率滑杆与 taxRate,税收 = TAX_PER_POP(0.3)× 总人口 × 幸福度;② 时间系统:state.time {day, hour},tick 推进小时(24/天),顶部 📅 显示,地图昼夜明暗(夜晚 0.45 遮罩);③ 左栏速率全面审计(库存实测 vs rates 一致性),发现问题即修。新增 REQ-47~49。
Alternatives: 保留滑杆但默认 30%(冗余 UI,未选);时间仅数字不渲染昼夜(感受不强烈,未选)。
Consequences: 设置面板只剩速度控制;收入随人口增长自然上升;夜间地图变暗增强沉浸;速率审计结果以测试固化。

## ADR-024: V1.7 时间流速调整(B-23)
Status: accepted
Context: V1.6 时间流速 1 tick = 1 小时,默认 2x 速度下时间显示每 0.5 秒跳一次,玩家反馈"跳得太快"。
Decision: 流速改为 TICKS_PER_HOUR = 12(一天 = 288 tick):默认 2x 下每小时显示变化间隔 6 秒,一昼夜约 2.4 分钟——既保留"明显感受时间流逝"(昼夜明暗),又不再闪烁跳变。state.time 增加 tickAcc 累加器(旧档迁移默认 0)。
Alternatives: 4/8 tick/小时(仍偏快,未选);纯减速不改结构(未选,保持引擎 tick 1s 节奏不变)。
Consequences: 引擎 tick 节奏(生产/消耗 1s)不变,仅时间显示与昼夜节奏放慢;时间相关测试按新流速更新。

## ADR-025: V1.8 地图系统大更新(B-24~28)
Status: accepted
Context: 30×30 固定模板地图限制空间规划;随机生成/多岛/资源约束是"逻辑复刻"卖点的核心;V1.5 相机已为大地图铺垫。
Decision: V1.8 = ① 生成器重写:256×256、种子确定性(fBm+径向衰减+单连通主岛+全岛总量约束);② 山脉地形(7)+矿脉贴山(铁/铜/金只生成于山脉边缘,按山脉大小分层);③ 开局玩家点选放初始仓库(免费,自动附带民居,旧档兼容);④ 拆除返还(非金币 100%,金币 0,可配置);⑤ 渲染视口裁剪+小地图;⑥ 连通性惰性缓存。多岛/储量/迷雾本轮不做。
Alternatives: 多仓库(用户否决,选 A 单仓库锚点);候选出生点/资源保证(上帝视角下不需要,用户指出);局部资源保证(同前)。
Consequences: 每局不同(种子可复现);山脉形成天然阻隔与扩张节奏;256×256 性能达标依赖裁剪与小地图;旧档 30×30 继续可玩。

## ADR-026: V1.9 UI 反馈完善(B-29~30)
Status: accepted
Context: 速度按钮 active 高亮为 HTML 静态写死,点击后 redraw 不更新 → 玩家无法确认当前速度;地形颜色无图例,新玩家不知道颜色含义。
Decision: V1.9 = ① 速度反馈:redraw 时按 state.settings.speed 更新 1x/2x/3x 按钮 active 高亮,并新增"▶ Nx"当前速度文字(暂停时显示"⏸ 暂停");② 地块图例:顶栏"信息"区新增 🎨 图例按钮,弹层(复用 overlay 模式)展示地形 8 色/建筑 4 色/道路与状态标记。
Alternatives: 图例放左栏/右栏常驻(占空间,否决);仅按钮高亮不加文字(用户明确要"多加一个显示",否决)。
Consequences: 纯 UI 轮,引擎零改动;测试 29/29 回归保持。

## ADR-027: V1.9 人口模型重做——民居驱动(REQ-60)
Status: accepted
Context: 原模型"开局白送 10 人 + 全局阈值(增长≥0.5/流失<0.3)"导致开局死锁(鱼耗尽→人口流失→渔场缺劳动力→鱼断供→永久死锁);且不符合原版语义。
Decision: 改为民居驱动:开局人口 0;每栋连通民居保底 1 人(造房即入住);目标人口 = 容量 × 需求满意度(不低于保底),每 tick 以 2% 缓慢趋向(增长/流失都慢,永不归零);渔场劳动力 2→1 保证保底 1 人即可开工。
Alternatives: 仅调鱼库存/流失下限(治标,用户指出模型本身错误);workforce 全降 1(失去劳动力压力)。
Consequences: 人口曲线 = 原版"造房保底+需求驱动增长";需求消失回落保底,重建供给即恢复,无死锁;旧档(人口 0+民居连通)自动恢复 1 人。

## ADR-028: V1.10 数值对齐原版(数据来源:Anno 1800 Fandom Wiki,2026-08-08 抓取存档于 docs/wiki-reference/)
Status: accepted
Context: 用户要求 10 项(人口模型/住宅尺寸容量升级/产出节奏/需求清单消耗/满意度/市场覆盖/税收公式)在模式与系数上对齐原版。
Decision:
- ① 住户模型 = `Σ栋[Σ(基础需求 Influx×满足度)]`（市场+5/鱼+3/工作服+2=10=容量）;至少 1 基础需求不塌;2%/tick 渐近 + 收敛判定(差<0.05 精确到位,避免渐近达不到 workforce 硬阈值)
- ② 住宅 3×3、容量 10(农民),升级=全基础需求满足+4 木材→工人住宅(容量 20);开局 5 栋民居(原版初始住宅区)+初始入住=容量(50 人)
- ③ 周期制:production.cycle(60 tick),满周期结算;维护费=原版每分钟÷60 每 tick
- ④ 需求率原值直搬(鱼 0.0004166667/工作服 0.000512821/烈酒 0.000555556 每人每秒);消耗按住宅最大容量(原版语义)
- ⑤ 收入=Σ(需求 income×满足度×住宅数)÷60 每 tick(鱼1.25/工作服3.75/烈酒3.75);幸福度=奢侈需求贡献(烈酒+8)
- ⑥ 市场 5×6、范围半径 15(原版范围未抓到,暂定);服务型需求按覆盖率满足
- ⑦ 建筑成本/维护/劳动力/尺寸 = wiki 原值;缝纫厂原版 9000/200 为后期 Tailor's Shop,农民期用 500/25(偏离记录在案);工具厂/织布厂 wiki 被 Cloudflare 拦截,按比例近似
- ⑧ 换算:1 tick=1 游戏秒=原版 1 秒;1 现实分钟=60 tick
Alternatives: 开局白送人口(否);全局阈值增长(否,Influx 更贴原版)。
Consequences: 开局 50 人但需求不足会流失(原版语义);劳动力硬阈值与人口渐近已通过收敛判定解决;市场范围/缝纫厂数值为近似,待 wiki 补充或玩家校准。

## ADR-029: 收入结算只保留需求驱动公式
Status: accepted
Context: V1.10 已在 population.js 实现并单测需求收入公式,但 tick.js 仍调用 economy.js 中 V1.6 遗留的“人口×幸福度”公式;叶子单测全绿却未覆盖实际游戏接线。
Decision: 顶层 tick 改为调用 `population.collectTax(state)`;删除 economy.js 的旧收入实现与导出,避免两套公式再次分叉;新增从 `tick(state)` 进入的金币增量集成测试。
Alternatives: 保留两套函数并仅修改调用点(拒绝,重复实现会继续漂移);继续使用旧公式(拒绝,不符合已批准的 V1.10 需求收入模型)。
Consequences: 浏览器实际收入与需求表、满足度和当前人口一致;测试从叶子函数覆盖提升到主循环接线覆盖;无需迁移存档。

## ADR-030: 建立当前规范基线,历史规则与现行规则分离
Status: accepted
Context: 代码已迭代至随机 128×128 地图、多仓库、需求收入等机制,但早期 30×30/固定地图/旧税收/赠送仓库等 ADR 仍混在现行文档,后续 agent 容易读取错误规则。
Decision: 将截至 ADR-030 前的完整决策流水保存到 `decision-history.md` 并标记为非规范历史;重写 `decisions.md` 为当前有效决策集合;README、Product Brief、Requirements、Architecture、Backlog、Roadmap、Economy Systems 和 AGENTS 同步到代码事实。
Consequences: `status.md` + 当前核心文档恢复为唯一续接入口;历史仍可追溯但不得用于推断现行行为。
