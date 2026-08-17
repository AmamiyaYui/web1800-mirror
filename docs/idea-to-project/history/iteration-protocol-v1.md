# 迭代协议(iteration protocol)

> **非规范历史**：这是旧版独立迭代协议。当前协议已折入根目录 `AGENTS.md`；当前会话不得继续把本文件列入必读链。
> 保留本文件只为追溯当时流程，不用于覆盖 `../status.md`、`../backlog.md` 或 AGENTS。

## 版本命名

- `V1.0` = M1 脚手架垂直切片(已交付)
- `V1.1`、`V1.2` … = 每轮迭代一个版本,每轮结束都是**可玩版本**
- 版本号记录在 `status.md`,内容登记在 `backlog.md`

## 每轮标准流程(6 步)

1. **选范围**:从 `backlog.md` 挑选本轮项(**最多 3~4 项**),每项必须能绑定 REQ/AC 或明确的验收标准;超范围项不静默塞入。
2. **改文档(先行)**:`product-brief.md` / `requirements.md` 中受影响条目标注版本(如 `[V1.1]`);新决策记 `decisions.md`(ADR);旧规则按变更协议移入 `decision-history.md`。
3. **实现 + 测试**:引擎逻辑先行,`npm test` 必须保持全绿;UI/渲染随后。
4. **验证**:跑本轮绑定的 AC(`node --test` + 浏览器实测),记录 supported / refuted。
5. **收尾**:更新 `status.md`(当前版本号、本轮范围、下一轮候选)与 `backlog.md`(项状态);本轮"学到什么 / 遗留什么"记入本轮验证记录。
6. **下一轮**:从第 1 步重新开始。

## 纪律

- **范围纪律**:每轮 ≤3~4 项;被拒/推迟的项回 backlog,不允许边做边加。
- **文档先行**:先改文档再改代码;文档与实现必须一致(禁止"代码改了文档没改")。
- **验收纪律**:绑定 AC 的项,验证记录里必须写 supported 或 refuted;refuted 不算失败,记录学习并调整范围。
- **测试纪律**:任何引擎变更后 `npm test` 全绿才能收尾。
- **合规纪律**:命名改写持续生效,不得引入官方美术/原名。

## 续接规则(新会话必读)

1. `docs/idea-to-project/status.md` — 当前版本、阶段、待决策
2. `docs/idea-to-project/iteration.md` — 本协议
3. `docs/idea-to-project/backlog.md` — 需求池与项状态
4. 当前版本的 product-brief / requirements / architecture / decisions

历史版本内容只读 `decision-history.md`,不用于推断当前行为。
