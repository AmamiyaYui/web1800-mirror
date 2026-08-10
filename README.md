# 蒸汽都市

> EN: **web1800** · 零依赖浏览器工业时代城市模拟经营游戏

《蒸汽都市》是一款运行在浏览器中的生产链与城市规划模拟游戏。玩家在随机生成的海岛上建设道路、仓库、住宅和产业链，通过物流覆盖、劳动力与居民需求推动城市发展。

在线试玩：<https://web1800.top>

## 当前内容

- **随机海岛**：128×128 种子地图，包含平地、水域、山脉、黏土及铁/铜/金/煤/锌/石灰岩矿脉；森林地形已移除
- **空岛开局**：10000 金币、60 木材、300 鱼、0 人口、0 建筑；第一个目标是在菜单中建造仓库
- **生产与物流**：49 种生产建筑、周期制生产、劳动力门槛、维护费、断连停工和仓库路距离覆盖
- **人口与需求**：农民/工人/工匠可推进；工程师/投资人数据已准备但暂时锁定
- **住宅升级**：住宅均为 3×3，容量依次为 10/20/30/40/50；只能新建农民住宅，其余通过满员、需求和建材升级
- **道路**：土路 3 金币/格；石板路只能从土路升级，12 金币/格，服务传播约为土路的 1.5 倍
- **建筑操作**：多格 footprint、以几何中心为锚点的四向旋转、所见即所得预览、两阶段移动建筑
- **信息界面**：资源与 `/min` 速率、目标、生产链、机制速览、图例、小地图、昼夜、速度控制
- **存档与社区**：localStorage 自动存档、倒计时重置、公告、固定金额打赏码、留言板和管理页

当前数据规模：**64 种建筑、63 种商品/资源、5 个人口阶层**。

## 技术特点

- **零依赖、零构建**：原生 JavaScript + Canvas + DOM，双击 `index.html` 即可运行
- **双端引擎**：`src/engine/` 同时挂载 `globalThis.Engine` 与 `module.exports`，浏览器和 Node 使用同一份逻辑
- **引擎可测试**：核心模拟与 DOM 解耦，`npm test` 是唯一标准自动化入口（当前 83/83 通过）
- **数据驱动**：人工核查 Excel 经 `tools/gen-*.py` 生成 `buildings-data.js` / `needs-data.js`
- **渐进联网**：游戏主体可离线运行；留言板单独使用 Cloudflare Worker + D1，失败时优雅降级

## 项目结构

```text
web1800/
├─ index.html / style.css       浏览器入口与界面样式
├─ admin.html                   留言管理页
├─ src/
│  ├─ engine/                   DOM-free 模拟引擎
│  │  ├─ data/                  商品、需求、建筑、地图和平衡数据
│  │  ├─ state.js / tick.js     状态与顶层模拟编排
│  │  ├─ economy.js             生产、状态、维护费
│  │  ├─ population.js          需求、住户、幸福度、收入
│  │  ├─ placement.js           footprint、旋转、放置、移动、道路
│  │  ├─ connectivity.js        多仓库连通缓存
│  │  └─ goals.js / save.js     目标与存档
│  ├─ render/                   Canvas 地图渲染
│  ├─ ui/                       DOM 面板
│  └─ main.js                   浏览器装配、输入、自动保存
├─ tests/engine.test.mjs        Node 引擎测试
├─ tools/                       数据生成、部署与管理脚本
└─ workers/messages-worker.js   留言板 Worker + D1 API
```

## 运行与测试

```bash
# 本地服务器（推荐）
python -m http.server 8000
# 打开 http://localhost:8000

# 引擎测试（Node >= 18）
npm test

# 也可直接双击 index.html 离线游玩
```

## 操作

| 操作 | 说明 |
|---|---|
| 左键 | 选择、建造、放置或查看建筑 |
| 拖拽 | 连续铺路/拆除 |
| `R` | 建造或移动预览时旋转 |
| 滚轮 | 以鼠标位置为焦点缩放地图 |
| 右键拖拽 | 平移地图 |
| 🚚 移动 | 先选择建筑，再选择目标位置 |

## 数据配置

游戏数值由外部表格人工核查后经生成脚本产出，生成文件不直接手改：

```text
tools/gen-buildings-js.py → src/engine/data/buildings-data.js
tools/gen-needs-js.py     → src/engine/data/needs-data.js
```

需求表中的消耗和收入是“每住宅”原始口径；生成器按住宅容量换算为引擎的“每人口”口径。

## 部署

Cloudflare Pages 当前配置：

```text
Build command: bash tools/deploy.sh
Output directory: deploy
```

`deploy.sh` 仅组装 `index.html`、`admin.html`、`style.css`、`src/` 和 `assets/`，不会发布文档、工具、原始表格或 Git 元数据。

## 当前版本

当前处于 **V1.10 稳定化阶段**（2026-08）。

## 合规声明

本项目为原创独立开发的学习与作品集项目。界面、命名和文本不使用任何商业游戏的官方美术、角色或受版权保护内容，与任何商业作品无官方关联。
