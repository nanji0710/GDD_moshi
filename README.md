# 末世列车 · The Last Train

> 火车推进 · 车厢编组 · 尸潮防御 —— 一个用原生 JavaScript 写的可玩原型，**零依赖、双击即玩**。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Smoke test](https://github.com/nanji0710/GDD_moshi/actions/workflows/smoke.yml/badge.svg)](https://github.com/nanji0710/GDD_moshi/actions/workflows/smoke.yml)
[![Deploy](https://github.com/nanji0710/GDD_moshi/actions/workflows/deploy-cloudflare.yml/badge.svg)](https://github.com/nanji0710/GDD_moshi/actions/workflows/deploy-cloudflare.yml)
[![No dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./prototype)

**▶ 在线试玩：[last-train-87y.pages.dev](https://last-train-87y.pages.dev)**（Cloudflare Pages，推 `main` 自动部署）
　备用：[GitHub Pages](https://nanji0710.github.io/GDD_moshi/) ｜ 想绑自己的域名？见 [发布指南](docs/发布指南.md)。

![标题页](docs/img/title.png)

## 这是什么

一列末世火车，车顶装武器，一路把孩子和老送到安全点。

- **你操作的不是列车，是编组。** 每 2.0 km 随机三选一获得一节车厢（武器 / 人员 / 动力 / 装甲 / 修理），挂得越多越慢，动力车厢能把速度拉回来。
- **停车只有两种**：站台（安全停靠，全局暂停，点「继续出发」才开走）和撬轨（强制停 15 秒，刷怪 ×2.2，10% 出小 Boss，修满自动出发）。
- **12 关各有变异**：铁桥（丧尸只能沿轨道来）、夜战（能见度 165 m）、隧道（顶灯光池）、连续弯道（山体挡住射界）、雨战（刹车变长、火焰 -30%）、长直道（速度 +20%、迎面冲锋者）。
- **局外 6 条独立强化线**，一次通关拿到的里程点只够点满其中 2 条。

![战斗中](docs/img/gameplay.png)

## 快速开始

```
双击 prototype/index.html
```

没有构建、没有 npm install、没有服务器要求。

首屏只同步加载界面脚本与样式（实测 **481,922 B / 26 个请求（470.6 KiB）**，4× CPU 降速下 DCL≈0.09s（83–107ms）、标题可交互≈0.19s（161–201ms））；
**进关不下载模型**：1.3MB 的 3D 模型数据（`assets/models-data.js`）只在**首次切 3D** 时异步加载（视网速约 1–5s），
加载期间底部有「模型资源加载中…」提示；失败时提示变「模型加载失败，点此重试」（10s 超时、脚本 404 自动重试 1 次），
3D 按钮在就绪前不会硬切。复测命令见「开发」里的 `node tools/perf.mjs`。
（#7 前首屏为 478,428 B / 26 请求，差值来自 index.html 内联的启动失败守卫。）

| 操作 | 键 |
| --- | --- |
| 暂停 / 继续 | `空格` |
| 倍速 | `1` `2` `3` |
| 改装（车厢 / 武器 / 形态） | `Tab` 或点底部车厢条 |
| 技能 | `Q` 紧急制动 · `W` 全弹齐射 · `E` 强制过载 |
| 静音 | `M` |
| 2D / 2.5D 切换 | `T` |
| 显示射程 | `G` |
| 镜头回到列车 | `F` |
| 缩放 / 平移 | 滚轮 / 拖拽 |

**手机能玩**：横屏最佳。触摸拖拽平移、点车厢改装；窄屏会自动换行 HUD、把站台收成底部抽屉、矮屏压薄车厢条。

## 特性

- **程序化地形**：轨道用弧长参数化，车厢沿曲线排布；2.5D 斜投影，相机跟随。
- **5 种武器 × 10 级 × 2 形态**（Lv3 二选一，Lv4–10 纯数值），5 种开火模式（hitscan / 锥形 / 连发 / 链式 / 迫击）。
- **7 种丧尸 + 精英 + Boss**，导演按关卡密度刷怪，停车时加压。
- **能见度系统**：黑暗层 + 挖洞灯光，车灯、枪口、爆炸、废墟火堆都是光源。
- **程序化音频**：全部 WebAudio 现场合成，无任何音频文件；引擎轰鸣随车速变化。
- **局内存档**：站台 / 停车 / 获得车厢即时落盘，每 15 秒自动存，刷新后「继续上一局」。
- **涂装**：4 款，只改车身不改车顶类型色（保证"一眼认出这是什么车厢"）。

## 目录结构

```
.
├── index.html              跳转页（本地打开用）
├── prototype/              ← 游戏本体（Pages 部署的就是这个目录）
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── cfg.js          全部数值（改数值只改这里）
│   │   ├── state.js        局内状态机 / 车厢 / 武器 / 难民 / 结算 / 存档
│   │   ├── train.js        车厢排布、挂点、开火
│   │   ├── zombies.js      丧尸与刷怪导演
│   │   ├── world.js        程序化地图、轨道、废墟、山体、铁桥
│   │   ├── lighting.js     夜战/隧道/雨水
│   │   ├── sound.js        程序化音频
│   │   ├── meta.js         局外 6 条强化线 + 涂装 + 存档
│   │   ├── save.js         局内存档
│   │   ├── glb.js          GLB 解析 + 模型数据异步加载（file:// 用 classic script）
│   │   ├── ui.js  main.js  fx.js  skills.js  util.js
│   ├── assets/
│   │   └── models-data.js  内嵌 GLB 资产（1.3MB，进游戏后异步加载，不进首屏）
│   └── tools/
│       ├── smoke.mjs       181 条断言的冒烟测试（CDP）
│       ├── shoot.mjs       33 张截图 + console 报错审计（CDP）
│       ├── perf.mjs        首屏同步字节 / DCL / 加载态 / 404 实测（CDP）
│       └── export-glb.cjs  程序化模型导出 → models/glb/*.glb + assets/models-data.js
├── models/glb/             40 个 .glb 源资产（导出/第三方查看用，不进部署目录）
└── docs/                   设计文档（GDD、借鉴报告、灵感、数值）
```

## 开发

测试与截图都走系统 Edge 的 headless 模式 + CDP，**零依赖**：

```bash
cd prototype
node tools/smoke.mjs        # 181 条断言，含存档往返、关卡变异、速度公式、模型懒加载与失败重试
node tools/shoot.mjs        # 出 33 张截图并审计 console 报错
node tools/perf.mjs         # 首屏实测：同步字节 / DCL / 标题时间 / 加载态 / 404
node tools/export-glb.cjs   # 重出 3D 资产：models/glb/*.glb + assets/models-data.js
```

部署装配与线上验收（在**仓库根**跑，不属于游戏运行时）：

```bash
node tools/stage-site.mjs --out _site                     # 白名单装配 + 写 version.json
node tools/verify-deploy.mjs --url https://last-train-87y.pages.dev  # 线上 commit/内容/工具暴露校验
```

## 发布

游戏是纯静态站点（一个 `index.html` + `css/` + `js/` + `assets/models-data.js`，零构建），推 `main` 会自动发到两个地方：

| 平台 | 触发方式 | 地址 |
| --- | --- | --- |
| **Cloudflare Pages** | `.github/workflows/deploy-cloudflare.yml`（`node tools/stage-site.mjs` 装配 `_site/` 后上传） | https://last-train-87y.pages.dev |
| **GitHub Pages** | `.github/workflows/pages.yml`（同一份 `_site/`） | https://nanji0710.github.io/GDD_moshi/ |

两个入口都**先过门禁、再装配**：`node tools/check-release.mjs prototype`（失败即中止发布：models-data 同步引用 0 个、classic script=22、首屏同步 ≤921,600 B、白名单/`_headers`/`404.html`/部署项数齐全）→ `node tools/stage-site.mjs`（白名单唯一实现，来自 `tools/release-manifest.mjs`；`prototype/tools/` 与 `shots-*` 一律不上线）。
部署产物固定 **31 项**：`index.html` + `js/` 22 个 + `css/` 3 个 + `assets/models-data.js` + `_headers` + `404.html` + 由 stage-site 生成的 `version.json` 与 `functions/[[path]].js`（测试面 404 守卫：Cloudflare 会把上一版删掉的文件继续留在边缘缓存里，路由层直接 404 才能保证马上不可达）。

发版同版本与缓存（**不做 `?v=`**：同一提交内 sha 自指不可能，且会让线上 index 与仓库 index 不再逐字节相等）：
- `_headers` 对 `/*.js`、`/*.css`、`/index.html`、`/assets/models-data.js` 设 `Cache-Control: no-cache`，发版即取新，杜绝新旧混跑；
- `GET /version.json` 返回 `application/json`，`commit` == 本次部署 sha；
- `GET /` 的字节数与 sha256 应等于仓库 `prototype/index.html`；
- `/tools/smoke.mjs`、`/freeze-smoke.log` 等测试面必须不可达；`/nope` 返回 `404.html`，不再由 `index.html` 200 兜底。
CI 部署后由 `tools/verify-deploy.mjs` 自动复验，最多重试 3 分钟。

CI 需要两个仓库密钥（Settings → Secrets and variables → Actions）：

| Name | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API 令牌，权限仅 `Account · Cloudflare Pages · Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | 账户 ID（Workers & Pages 页右侧） |

本地手动发一次（需要 node；装配与 CI 共用 `tools/stage-site.mjs`）：`$env:CF_API_TOKEN=...; $env:CF_ACCOUNT_ID=...; pwsh -File tools/deploy-cloudflare.ps1`

`release/last-train-prototype.zip` 是**只含游戏本体**的发布包：**324,403 B（316.8 KiB，白名单 29 项）**，
sha256 `2231c4f8da6d8175ee6d8937eb1a3ea4f1ccab15befc09aaae17a7d118c7a962`，用
`node tools/package-release.mjs` 可逐字节重复重出（与 CI 上传共用 `tools/release-manifest.mjs` 白名单）；
29 项 = `index.html` + `js/` 22 + `css/` 3 + `assets/models-data.js` + `404.html` + `_headers`。
解压后根目录就是 `index.html`，可直接拖进 Cloudflare Pages 的 Upload assets。
模型数据在部署产物里只有 `assets/models-data.js` 一份（40 个 `.glb` 源文件在 `models/glb/`，不进部署目录）。
完整步骤（含绑域名、国内加速取舍）见 [docs/发布指南.md](docs/发布指南.md)。

## 设计文档

| 文档 | 内容 |
| --- | --- |
| [GDD](docs/GDD-末世列车-v1.md) | **权威设计文档**：核心循环、局内 10 大系统、12 关、数值总表、排期、验收标准 |
| [借鉴总览](docs/00-借鉴总览与游戏提案.md) | 底座评估、许可红线、可借鉴清单、技术方案 |
| [玩法评审](docs/design/01-玩法方案评审.md) | 第一版方案的 3 个洞与 54 城地图可行性 |
| [数值落地](docs/design/02-方案修订与数值落地.md) | 已作废的历史版本，仅作数值推导存档 |
| [细节灵感](docs/inspire/00-细节设计灵感.md) | 三个岔路口 + 25 个能马上动手的点子 |
| [同类拆解](docs/inspire/07-同类游戏拆解.md) | Last Train Home / Highfleet / FTL 等 8 个商业游戏 |
| [渲染与镜头](docs/borrow/01-渲染与镜头.md) · [列车与轨迹](docs/borrow/02-列车与轨迹.md) | 技术实现笔记 |
| [数值与节奏](docs/inspire/09-数值与节奏模板.md) · [美术](docs/inspire/10-美术与表现方案.md) | 调参与配色 |

## 许可

代码 MIT（见 [LICENSE](./LICENSE)）。原型**不含**第三方源码、美术或音频；
玩法与技术方案参考了 `city-and-metro` 的公开实现思路，其源码为禁止商用许可，
本项目为独立重写，商用前请自行复核。详见 LICENSE 末尾的「第三方与致谢」。
