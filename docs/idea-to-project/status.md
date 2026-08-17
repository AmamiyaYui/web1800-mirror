# Project Status — 蒸汽都市

Last updated: 2026-08-12

## Approved through / Current focus / Current capability / Verification baseline

- **Phase**: 下一版本"开荒新岛"**B-61~B-65 全部通过独立复验并批准**(B-61 第四轮独立复验 2026-08-12; B-62~65 经 4 轮定向复验闭环:轮1 7HIGH+1MEDIUM → 轮2 4HIGH → 轮3 2HIGH → 轮4 0 HIGH / 0 MEDIUM / 0 LOW 批准)
- **Current version label**: V1.10 修订⑧；之后的审计返工未另开玩法版本
- **Approved through**: 多岛核心需求 MI-01～MI-25；B-61 实现基于完整 SHA `3a2e396c8b6b40e15263b11b51728329aa8573b4`，第四轮独立复验 0 HIGH / 0 MEDIUM / 0 LOW 并批准，提交于 `d9ee6109e96e76168f2aaad8c91686bf66b9b01a`；B-62~B-65 经 Sol 四轮定向复验(末轮 0 HIGH / 0 MEDIUM / 0 LOW)批准于 `0062394`
- **Current focus**: **多岛版本已批准交付**：切岛与世界 tick(B-62)、海事生产与舰队(B-63)、灰冠探索与岛屿生成(B-64)、岛间持续运输(B-65)全部闭环；下一步从 backlog 剩余项或玩家反馈选择范围
- **Current capability**: 新游戏创建单座随机160×160主岛；状态使用World/Island schema与全局金币钱包，现有引擎经活动岛兼容别名运行；v1单岛档可安全迁移为v2世界档；切岛/世界tick/海事(造船·探索·调遣·运输)引擎与UI已落地。67建筑、64商品、5阶层数据，工程师/投资人保持锁定
- **Current simulation**: 多仓库总资源池、沿道路物流/服务、周期生产、开发度、离散 Influx 人口、单栋住宅升级、需求驱动收入
- **Current player shell**: Canvas 地图、可伸缩侧栏+Tab 切换、渐进披露 HUD、60 tick 平滑趋势、结构化异常与修复目标、localStorage v2存档、迁移前永久原档下载/恢复/确认删除、留言 Worker + D1

## Verification baseline

- `npm test`: **169/169**(轮2 基线 166 + 轮3 回归 3 项:抽定值校验/真实生成器 drawnGroups/暂停补完公共路径)
- 浏览器资源: `index.html` **33个**、工具页 **12个**，均统一 `v164`，无缺失资产
- 浏览器: v164 页面正常启动、rAF 调度循环实测时间推进正常、控制台 0 错误
- 失败路径: Sol-3-1 抽 4 实 3 拒绝/抽 3 实 3·抽 4 实 4 通过/真实生成器达到抽定值 / Sol-3-2 暂停中补完半截 tick·cursor=0·不启动新 tick
- 部署隔离: `deploy/` **43 个运行文件**(Sol 临时部署验证)，白名单与源文件一致；这只证明本地组装，不证明线上已发布
- 独立复验: B-61 第四轮独立复验批准(0/0/0)；B-62~65 经 4 轮定向复验闭环,轮4 **0 HIGH / 0 MEDIUM / 0 LOW 批准**(`0062394`)

## Known gaps

- **Approved deferrals（不阻断当前基线）**: 无(H-07 侧栏折叠、H-04 小地图遮挡、M-03 锁定阶层阈值均已随 B-43/B-38 完成)
- **Low debt**: `ratesHistory` 为 `null/false/0/""` 时由首个 tick 而非 deserialize 归一化；不崩溃且统计有限，列入 B-40
- **Product limits**: 工程师/投资人暂锁；仓库容量和运输车辆未实现
- **Open conflicts**: 无

## Next decision

多岛版本(B-61~B-65)已全部批准;下一轮从 backlog 剩余候选(如 B-36 平衡实测/B-40 存档归一化/B-37 仓库容量设计)或玩家反馈中选择 3~4 项,走需求迭代协议。

## Sources

- 当前范围: [backlog.md](backlog.md)
- 当前规范: [requirements.md](requirements.md) · [architecture.md](architecture.md) · [decisions.md](decisions.md)
- 按需机制说明: [references/](references/)
- 非规范历史与审计证据: [history/](history/)
