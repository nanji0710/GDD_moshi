# 06 · GitHub 开源参考（末世列车 × 车厢武器 × 打丧尸）

> **核实方式**：本文每一条都是 2026-11-12 通过 GitHub REST API 现场核验的（`search/repositories` 与 `repos/{owner}/{repo}`），★ 数、许可、最近提交均取自 API 返回值，**没有一条是凭记忆写的**。许可一栏是 API 的 `license.spdx_id`：`NONE` = 仓库里没有许可证文件（= 默认保留所有权利，**代码不能抄**），`NOASSERTION` = GitHub 识别不出标准许可证（需要人工读 LICENSE）。
> **原型快照**：`本仓库\prototype` 于 14:48 的只读检查（该目录正被并行开发，`v2.js` 是 14:42 新增的技能卡/撬轨者实验层）。本文所有"原型缺陷"结论都在该快照上复核过。
> **限制说明**：搜索 API 未认证限速 10 次/分钟、core API 60 次/小时。本文共用 **约 43 次搜索**（含 1 次 403 限速后重试）+ **约 35 次 core**，全部按组批处理，未耗尽额度。

---

## §0 先说结论

1. **不存在**一个开源项目和你玩法一一对应（列车沿铁路推进 + 车顶挂点装武器 + 尸潮涌来）。我试了 20+ 组关键词，`zombie train`、`armored train` 这类直白组合返回的全是 **trainer / cheat / 破解工具**（和你上次踩的坑一模一样），`on-rails` 返回的全是 Ruby on Rails 建站教程。**唯一主题对应的项目 `BenHaddley/battlestations`（"Railway-themed tower defense — spiders vs. trains"）只有 0 星、无许可证、未完成。**
2. 所以正确策略是 **逐子系统找参考**，而不是找一个成品抄。原型现在缺的 12 项（§1 的 D1–D12），每一项都能指到一个具体仓库的**具体文件**。
3. 最大发现：**`ricardo-foundry/canvas-vampire-survivors`**（仅 8★，但完全命中）——纯 Canvas + 原生 JS + 零依赖，`src/` 里正好有原型缺的东西：`spatial-hash.js`、`pool.js`、`replay.js`、`weapons.js`、`stages.js`，还有 16 个零依赖测试文件。这是**第一优先要读的仓库**。
4. 第二优先是 **`jackrugile/radius-raid-js13k`**（271★，MIT，最终构建 13,278 字节）：13 种敌人 + 5 种 powerup + 粒子 + 程序化音效，全部拆在 `js/` 下 17 个文件里，是"一个完整射击循环怎么组织"的最省时间范本。
5. 法务提醒：**3 个 GPL 项目只能看不能抄**（Mindustry、OpenTTD、Stronghold-Protocol），**4 个无许可证项目连抄代码都不能**（dead-valley、PathFinding.js、flow-field、battlestations）。详见 §5。

---

## §1 原型现状与 12 个缺口（D1–D12）

原型已经有的（别重复造）：固定 1/60 步长 + 累加器（`main.js:116-126`）、弧长参数化轨道与车厢展开（`train.js:53-70`）、车顶挂点世界坐标（`train.js:72-79`）、5 种武器 5 种开火模式（`cfg.js:31-62`、`train.js:214-270`）、按投影 y 排序的遮挡（`main.js:397-440`）、波次导演（`zombies.js:43-67`）。

| 编号 | 症状 | 证据 | 需要什么 | 对应条目 |
|---|---|---|---|---|
| **D1** | 丧尸只会沿直线冲向最近车厢，**没有避让/分离**，一群会挤成一条线并互相穿模 | `zombies.js:101-102` | 群体转向（separation / cohesion / alignment） | §3 yuka、D1 行 |
| **D2** | **没有空间索引**：索敌每次都遍历全表（`pickTarget`）、溅射遍历全表（`damageArea`）、每帧统计 `zsAhead` 再遍历全表 | `train.js:179-184`、`273-281`、`294-302`；`main.js:132-140`；`zombies.js:133` | 空间哈希 / R-tree | §3 rbush、flatbush、check2d |
| **D3** | 每只丧尸都 `new` 字面量对象，死亡用 `splice` 删除；无对象池 | `zombies.js:26-40`、`76`、`129` | 对象池 | §2 canvas-vampire-survivors 的 `src/pool.js` |
| **D4** | **完全没有音频**（全仓 `AudioContext`/`<audio>` 命中 0 次） | 14:48 grep | 程序化音效 | §3 jsfxr、§2 radius-raid `js/audio.js` |
| **D5** | 实体层满屏 `Math.random()`，无种子 → 无法回放、无法复现 bug、无法自动断言 | `zombies.js:29-38,63,84,142-152`；`fx.js:40-41` | 确定性 RNG | §3 prando、§2 canvas-vampire-survivors `replay.js` |
| **D6** | 敌人只有 "elite" 一档（血量 ×3.4、伤害 ×2.2），`kind` 只影响画法 → 打起来全是同一种敌人 | `zombies.js:28-29,37` | 行为型敌人（状态机） | §2 quiver TD 状态机结构、radius-raid `enemy.js` |
| **D7** | 丧尸无视地形：可以直穿废墟、桥栏、河流（只有生成点参考了桥） | `zombies.js:98-103` | 流场/导航网格 | §3 vector-field、navmesh |
| **D8** | 丧尸之间、丧尸与车厢之间只有"中心距离 < reach"的判定，没有碰撞体 | `zombies.js:96-98` | 宽相位碰撞 | §3 check2d |
| **D9** | 行为是内联 if 链，加 3 种敌人 / 5 种弹道后必然失控 | `zombies.js:83-122`；`train.js:214-270` | 状态机 / ECS | §3 bitECS、miniplex |
| **D10** | 改任何数值都要改 `cfg.js` 再刷新 | `cfg.js` 全文 | 运行时调参面板 | §3 tweakpane |
| **D11** | 只有截图审计（`tools/shoot.mjs`）与冒烟（`tools/smoke.mjs`），**没有"跑 5 分钟模拟断言数值"** | `prototype/tools/` | 无头仿真 + 断言 | §2 canvas-vampire-survivors 的 `test/` |
| **D12** | 地形用单层整数 hash 噪声（有确定性，但只有块状、无分层） | `main.js:57-61`、`world.js:161-174` | 分层噪声 | §3 simplex-noise |

> 用这张表当索引：**先挑你打不过去的那一行**，再去对应仓库钻进去。

---

## §2 同类玩法项目（14 个）

### 2.0 先看清"你的游戏在坐标轴上的位置"

把"基地是否移动"×"开火是否自动"拉成二维，现有开源项目会落在四格里：

| | **自动开火** | **手动瞄准** |
|---|---|---|
| **固定基地** | Vampire Survivors 类（`canvas-vampire-survivors`、`no-survivor-game`） | 经典塔防（`canvas-td`、`elematter-js13k`、`quiver TD`） |
| **移动基地** | **★ 你的游戏（这一格基本空缺）** | on-rails 射击 / 载具射击（`radius-raid` 是自由移动而非轨道） |

结论：**你落在右上角那格，它没有成熟开源作品**——这既是坏消息（没有现成架构可抄），也是好消息（选题不撞车）。所以下面的阅读策略是：**从左边两格偷系统，从右上角偷不到就自己设计**。具体地说——自动索敌/弹道模式偷塔防的（塔=挂点），尸潮压力与升级曲线偷 survivor 的，载具推进与路况偷你自己原型已有的。

### 2.1 精读级（3 个，值得花半天读代码）

#### ① `ricardo-foundry/canvas-vampire-survivors` — 8★ · MIT · JS · 2026-07-20
<https://github.com/ricardo-foundry/canvas-vampire-survivors>

纯 Canvas + 原生 JS、**零依赖**、`index.html` 直接双击可玩，`src/` 22 个文件。作者自称 bullet-heaven survivors，检查和你的原型几乎是同一套技术栈。

| 文件 | 大小 | 为什么对你重要 |
|---|---|---|
| `src/spatial-hash.js` | 4.3 KB | **D2 的答案**：一个完整空间哈希，还配了 `test/spatial-hash.test.js`，可以直接读它怎么选 cell 大小、怎么查相邻格 |
| `src/pool.js` | 4.3 KB | **D3 的答案**：对象池 + 测试 `test/pool.test.js`，解决丧尸/子弹/飘字不断 new 的问题 |
| `src/weapons.js` | 16.5 KB | 武器定义与开火，和你的 5 种武器对位；对比你的 `train.js:214-270` 看它怎么把"弹道模式"从 if 链拆成数据 |
| `src/entities.js` | 35.7 KB | 敌人/玩家实体组织方式 |
| `src/stages.js` | 12.4 KB | **波次/关卡编排**，你的 `cfg.js:79-82` 只有 4 个数字，这里能看到工程化的写法 |
| `src/effects.js` | 8.9 KB | 粒子/飘字，对照你的 `fx.js` |
| `src/audio.js` | 8.7 KB | **D4 的答案**：零依赖的 WebAudio 封装 |
| `src/replay.js` | 10 KB | **D5 的答案**：确定性录像/回放，正是"没有种子 RNG"的解法 |
| `test/*.js` | 16 个文件 | **D11 的答案**：`node --test` 风格的零依赖断言，把"跑一局"变成可回归的测试 |

**借鉴动作**：先把 `spatial-hash.js` + `pool.js` 两个文件照结构重写进 `prototype/js/`（各 ~60 行），再把 `test/spatial-hash.test.js` 的断言搬过来当第一份回归测试。
**注意**：GitHub API 把许可识别成 `NOASSERTION`，我拉了 `LICENSE` 原文确认首行是 `SPDX-License-Identifier: MIT` + 标准 MIT 正文 → **实际是 MIT，可以放心抄**（这正好说明 `NOASSERTION` 必须人工核）。

#### ② `jackrugile/radius-raid-js13k` — 271★ · MIT · JS · 2024-04-23
<https://github.com/jackrugile/radius-raid-js13k>

js13k 2013 参赛作品，**最终构建 13,278 字节**，13 种敌人 + 5 种 powerup + 视差背景 + 音效 + 本地存档。它把"一个完整射击游戏"压进了 17 个文件，是读起来最快的范本：

| 文件 | 借鉴点 |
|---|---|
| `js/enemy.js` | **D6**：13 种敌人怎么用一张配置表 + 少量分支表达，而不是 13 个类 |
| `js/bullet.js` / `js/hero.js` | 武器/子弹与角色分离 |
| `js/explosion.js` / `js/particle.js` / `js/particleemitter.js` | **粒子三件套**，可以直接对照你的 `fx.js` 补"发射器"概念（你现在是到处手写 `Fx.text/boom`） |
| `js/textpop.js` | 飘字（对应你 `fx.js:114` 的 `Fx.text`） |
| `js/jsfxr.js` + `js/audio.js` | **D4**：程序化音效的现成用法（见 §3 jsfxr） |
| `js/levelpop.js` | 升级/选卡弹窗 |
| `js/storage.js` | localStorage 存档封装 |

**借鉴动作**：读 `enemy.js` 的敌人配置表 + `particleemitter.js` 的发射器写法；这两个概念能立刻把你的敌人种类和特效从"hardcode"变成"配表"。

#### ③ `quiver-dev/tower-defense-godot4` — 98★ · MIT · GDScript · 2026-08-21
<https://github.com/quiver-dev/tower-defense-godot4>

Godot 4 塔防模板（1159 个文件）。**语言不同，但结构是同类项目里最清楚的一份**，专治 D6/D9：

```
entities/enemies/enemy.gd + enemy_fsm.gd          ← 敌人基类 + 状态机
entities/enemies/states/{idle,move,hit,die}.gd    ← 每个状态一个文件
entities/enemies/shooting/states/{move,shoot,shoot_still,hit,die}.gd
entities/projectiles/{bullet,homing_missile}/     ← 弹道与追踪弹分开
entities/explosion_vfx/
```

**借鉴动作**：把"敌人状态"抄成 JS 对象字面量（`{ idle(){}, move(){}, hit(){}, die(){} }` + 当前状态字段），比 if 链好维护一个数量级；不要抄它的资源组织（Godot 场景文件对 Canvas 无用）。

### 2.2 表格级（10 个，按"能借什么"取舍）

| 仓库 | ★ | 许可 | 最近提交 | 语言 | 一句话 | 能借什么 / 借鉴动作 |
|---|---|---|---|---|---|---|
| [`KilledByAPixel/LittleJS`](https://github.com/KilledByAPixel/LittleJS) | 4381 | MIT | 2026-11-12 | JS | 极小 2D/3D 引擎 + 大量完整小游戏 | **D2/D3/D4 一站式**：碰撞（tile/ray）、粒子、sound；`examples/` 里每个都是一个完整循环。动作：只读 `src/` 里碰撞与粒子两章，别整套引入 |
| [`pshenok/server-survival`](https://github.com/pshenok/server-survival) | 6492 | MIT | 2026-11-04 | JS | 教云架构的塔防（真能玩） | 塔防的**经济/升级/波次三件套**怎么用数据驱动；但它首先是教学项目，玩法参考价值 < 架构参考价值 |
| [`matthiasbroske/VampireSurvivorsClone`](https://github.com/matthiasbroske/VampireSurvivorsClone) | 284 | MIT | 2024-04-29 | C# | Unity 版 VS 克隆（手游） | **武器进化/升级选卡**的数值与 UI 流程；C# 不能直接抄，读设计 |
| [`tddyco/canvas-td`](https://github.com/tddyco/canvas-td) | 41 | MIT | 2019-02-10 | JS | 60 KB 完整 canvas 塔防 | `scripts/{defs,game,ui,utils}.js` 四文件分层，**极小项目的分层样板**；`future/mathrandom.js` 是作者留的"以后要换种子随机"笔记，正好印证 D5 |
| [`victorqribeiro/towerDefense`](https://github.com/victorqribeiro/towerDefense) | 28 | MIT | 2023-10-14 | JS | 原生 JS 单文件塔防 | 塔位选择 + 建造预览的交互最小实现（对照你的挂点交互） |
| [`Mocas-12/no-survivor-game`](https://github.com/Mocas-12/no-survivor-game) | 35 | MIT | 2026-11-09 | GDScript | Godot 4 竞技场生存 | 波次 + XP 拾取 + 升级的闭环（读结构，不抄语言） |
| [`jackrugile/elematter-js13k`](https://github.com/jackrugile/elematter-js13k) | 53 | MIT | 2014-09-13 | JS | js13k 塔防 | 13 KB 内怎么做"波次 + 塔 + 元素克制"；极简数据表写法 |
| [`migalvalm/vampire-survivors-clone`](https://github.com/migalvalm/vampire-survivors-clone) | 28 | MIT | 2023-04-18 | GDScript | Godot VS 克隆 | 自动开火的索敌与冷却组织 |
| [`DanMat/Alienix`](https://github.com/DanMat/Alienix) | 0 | MIT | 2026-08-18 | JS | **零依赖原生 JS** 竞技场生存 | 和你原型同构（vanilla + canvas + 升级），可以对照它的文件切分；星少，只当结构参考 |
| [`chop-prog/void-pulse`](https://github.com/chop-prog/void-pulse) | 0 | MIT | 2026-10-19 | JS | 原生 JS 双摇杆 + 合成音频 + 零依赖 | **D4 + D12**：零依赖下怎么用 WebAudio 合成全部音效；星少，只读音频那部分 |

> 另有 `KilledByAPixel/SpaceHuggers`（289★）与 `BounceBack`（235★）质量很高，但它们是 **GPL-2.0/3.0**，见 §5，只能读思路。

### 2.3 主题唯一对应，但不能用

| 仓库 | ★ | 许可 | 最近提交 | 说明 |
|---|---|---|---|---|
| [`BenHaddley/battlestations`](https://github.com/BenHaddley/battlestations) | 0 | **NONE** | 2026-10-07 | 描述就是 "Railway-themed tower defense — spiders vs. trains"，全 GitHub 唯一。但 0 星、无许可证、Godot、未完成 → **只能确认"这个细分没人做"这个事实**，代码不能碰（无许可证 = 保留所有权利） |

---

## §3 技术库（推荐 17 个 + 明确排除 5 个，按"解决哪个 D"排）

**包体积一栏**：优先用 jsDelivr 上真实的 `*.min.js` 大小；拿不到的标注 npm 解压大小。

### 3.1 空间索引与碰撞（D2、D8）

| 库 | ★ | 许可 | 最近提交 | 体积 | 解决什么 | 借鉴动作 |
|---|---|---|---|---|---|---|
| [`mourner/rbush`](https://github.com/mourner/rbush) | 2789 | MIT | 2026-10-02 | **5.9 KB** min | **D2**：动态 R-tree，点/矩形范围查询 | 给"丧尸"建一棵树，武器索敌从"遍历 260 只"变成"查半径 95 m 内的几个格子"；比自写哈希更省事，5.9 KB 无脑上 |
| [`mourner/flatbush`](https://github.com/mourner/flatbush) | 1611 | ISC | 2026-11-06 | 21.6 KB | **D2**：**静态**索引（一次建好、只查询） | 适合"废墟/货车残骸/补给点"这种一局不变的东西；丧尸是动态的，用 rbush 或 canvas-vampire-survivors 的 spatial-hash |
| [`nenjack/check2d`](https://github.com/nenjack/check2d) | 264 | MIT | 2026-04-15 | 121 KB esm | **D8**：宽相位 + 碰撞检测（圆/多边形） | ⚠ **这个仓库原来叫 `Prozi/detect-collisions`，已改名/迁移**——按旧名搜会 404，API 会重定向到 `nenjack/check2d`。想给丧尸加"互相推开 + 扒车接触"就读它的 broad-phase |
| [`mourner/kdbush`](https://github.com/mourner/kdbush) | 715 | ISC | 2026-10-16 | 38 KB npm | 静态 k-d 索引 | 你已经有两个索引选项了，这个一般用不上；列出来是为了说明**同作者三件套别混用**（rbush 动态 / flatbush 静态矩形 / kdbush 静态点） |

### 3.2 群体 AI（D1、D7）

| 库 | ★ | 许可 | 最近提交 | 体积 | 解决什么 | 借鉴动作 |
|---|---|---|---|---|---|---|
| [`Mugen87/yuka`](https://github.com/Mugen87/yuka) | 1466 | MIT | 2026-10-20 | **120.3 KB** min | **D1**：steering behaviors（seek/flee/separation/cohesion/flocking）+ 感知 + 导航网格 + 状态机 | 别整套引入，**只抄它的 `SteeringBehavior` 类族**（separation/cohesion/wander 三个各 ~20 行）；把 `zombies.js:101-102` 的直线改成"seek 目标 + separation 邻居 + 少量 wander" |
| [`dmnsgn/vector-field`](https://github.com/dmnsgn/vector-field) | 41 | MIT | 2024-07-07 | 小 | **D7**：流场数据结构 | 如果要做"丧尸绕废墟/沿街道涌来"，流场比 A* 便宜：预计算一次方向场，每只丧尸只查表。思路可抄，代码量很小 |
| [`mikewesthad/navmesh`](https://github.com/mikewesthad/navmesh) | 377 | MIT | 2023-11-01 | 中 | **D7**：navmesh 寻路（Phaser 封装） | 只在"丧尸要绕整张图走"时才需要；你的世界是线性的，**大概率用不上**——列在这里是帮你排除 |

### 3.3 ECS / 对象池（D3、D9）

| 库 | ★ | 许可 | 最近提交 | 体积 | 解决什么 | 借鉴动作 |
|---|---|---|---|---|---|---|
| [`NateTheGreatt/bitECS`](https://github.com/NateTheGreatt/bitECS) | 1535 | **MPL-2.0** | 2026-08-24 | 构建产物需自 build | **D3/D9**：SoA 式 ECS，上千实体不抖 | ⚠ **MPL-2.0 是弱 copyleft**：改了它的文件必须开源那些文件（可以和新代码链接）。如果你想零许可负担，用下面的 miniplex 或自己写池 |
| [`hmans/miniplex`](https://github.com/hmans/miniplex) | 1066 | MIT | 2026-04-05 | **24.4 KB** | **D3/D9**：对象式 ECS，API 友好 | 比 bitECS 慢但更好读；**如果只是想让"丧尸/武器/弹丸"有统一更新循环，24 KB 换掉 if 链很值** |
| （无库做法） | — | — | — | — | **D3** 最小解 | 就是 canvas-vampire-survivors 的 `src/pool.js`：一个 `get()/release()` 的数组池，60 行。**先抄这个，再考虑 ECS** |

### 3.4 地形与随机（D5、D12）

| 库 | ★ | 许可 | 最近提交 | 体积 | 解决什么 | 借鉴动作 |
|---|---|---|---|---|---|---|
| [`jwagner/simplex-noise.js`](https://github.com/jwagner/simplex-noise.js) | 1854 | MIT | 2024-07-26 | **18.6 KB** | **D12**：Simplex 噪声（2D/3D） | 你 `world.js:161-174` 现在是单层整数 hash；换成 2~3 层 simplex 叠加（fbm）立刻有"起伏的废土"而不是"方块" |
| [`joshforisha/open-simplex-noise`](https://github.com/joshforisha/open-simplex-noise) | 160 | Unlicense | 2026-08-23 | 83 KB npm | D12 备选 | Unlicense（公共领域）更无负担，但更新慢；二选一即可 |
| [`zeh/prando`](https://github.com/zeh/prando) | 141 | MIT | 2023-01-07 | 极小 | **D5**：可设种子的确定性 PRNG | 把 `zombies.js`/`fx.js` 里所有 `Math.random()` 换成 `rng.next()`，你立刻能做"同一局重新播放"和"跑 100 次取均值"的平衡测试 |
| [`ondras/rot.js`](https://github.com/ondras/rot.js) | 2729 | BSD-3-Clause | 2024-11-13 | 67.1 KB min | 地图生成/FOV/网格 A* | 只在你要做"废墟内部探索/视野"时才用；塔防+列车用不上，**列出来是为了让你别被它的 star 数带偏** |

### 3.5 音频（D4）

| 库 | ★ | 许可 | 最近提交 | 体积 | 解决什么 | 借鉴动作 |
|---|---|---|---|---|---|---|
| [`chr15m/jsfxr`](https://github.com/chr15m/jsfxr) | 464 | **Unlicense** | 2026-05-05 | 小（radius-raid 直接内嵌） | **D4**：**程序化生成音效**（枪声/爆炸/惨叫） | 最省事的正解：给它一组参数生成 8-bit 风格音效，零音频文件。**原型现在是 0 音频，这是投入产出比最高的一步**（半天出"有声音"的版本） |
| [`goldfire/howler.js`](https://github.com/goldfire/howler.js) | 25442 | MIT | 2025-11-23 | **35.3 KB** min | 采样音频播放（不是合成） | 只有当你以后要放真实录音（丧尸吼叫）时才需要；它不管合成 |
| [`Tonejs/Tone.js`](https://github.com/Tonejs/Tone.js) | 14897 | MIT | 2026-11-01 | **337 KB**（build 未压缩） | 完整音乐/合成框架 | **性能上不建议**：为了几个枪声拉 300 KB 框架不划算；你完全可以 80 行手写 oscillator+noise（前提文档 05 里有现成配方） |
| [`cocopon/tweakpane`](https://github.com/cocopon/tweakpane) | 4675 | MIT | 2026-03-15 | 148.5 KB min | **D10**：运行时调参面板 | **开发期神器**：把 `cfg.js` 的武器/波次参数挂上去，边玩边调，不用改文件刷新。**建议只在 dev 分支引入，发布时去掉** |

### 3.6 明确"先别上"的（重要程度不亚于推荐）

| 库 | ★ | 许可 | 为什么先别上 |
|---|---|---|---|
| [`liabru/matter-js`](https://github.com/liabru/matter-js) | 18619 | MIT | 81.5 KB 全物理引擎。你只需要"圆-圆推开"和"子弹命中"，上物理引擎会让 260 只丧尸的迭代成本翻倍，还必须把整个移动逻辑改写。**除非要做"车厢脱轨/翻滚"这种表演** |
| [`piqnt/planck.js`](https://github.com/piqnt/planck.js) | 5318 | MIT | 290 KB（Box2D 移植），同上，且更大 |
| [`prettymuchbryce/easystarjs`](https://github.com/prettymuchbryce/easystarjs) | 1936 | MIT | 网格 A*。**丧尸不走网格**——你的世界是 11.6 km 的自由平面，A* 需要先栅格化，反而更慢更假。用 steering + 流场 |
| [`pixijs-userland/particle-emitter`](https://github.com/pixijs-userland/particle-emitter) | 853 | MIT | 37.1 KB，但**绑定 Pixi 渲染器**；你是纯 Canvas 2D，用不了。粒子自己写 80 行就够（你的 `fx.js` 已有雏形） |
| [`creativelifeform/three-nebula`](https://github.com/creativelifeform/three-nebula) | 1249 | MIT | 1.7 MB，Three.js 专用，无关 |

---

## §4 小体量完整示例（按"能整份读完"排序）

| 仓库 | 体积 | 为什么值得整份读 | 读法建议 |
|---|---|---|---|
| [`jackrugile/radius-raid-js13k`](https://github.com/jackrugile/radius-raid-js13k) | 仓库 61 KB，产物 **13,278 B** | 一个完整射击游戏的**最小完整形态**（敌人/子弹/粒子/音效/存档全有） | 按 `definitions.js → hero → enemy → bullet → particleemitter → game.js` 顺序读，2 小时能读完 |
| [`tddyco/canvas-td`](https://github.com/tddyco/canvas-td) | 60 KB | 塔防的最小分层（defs/game/ui/utils 四文件） | 先读 `defs.js`（数据表），再读 `game.js` 主循环 |
| [`ricardo-foundry/canvas-vampire-survivors`](https://github.com/ricardo-foundry/canvas-vampire-survivors) | 130 个文件但 `src/` 只有 22 个 | **同栈同玩法 + 有测试**，最接近"你想要的成品长什么样" | 只读 `src/spatial-hash.js`、`pool.js`、`weapons.js`、`stages.js` 四个文件 |
| [`KilledByAPixel/LittleJS`](https://github.com/KilledByAPixel/LittleJS) | 34 MB（含示例） | 4381★ 的极小引擎，`examples/` 每个都是完整游戏 | **别整份读**，只挑 `examples/` 里 2~3 个射击类看主循环 |
| [`quiver-dev/tower-defense-godot4`](https://github.com/quiver-dev/tower-defense-godot4) | 1159 文件 | 状态机/实体目录结构最清楚 | 只看 `entities/enemies/` 的目录树 + `enemy_fsm.gd`，10 分钟 |
| [`jackrugile/elematter-js13k`](https://github.com/jackrugile/elematter-js13k) | 极小 | 13 KB 塔防，看"元素克制/波次"怎么塞进极小体量 | 15 分钟扫一遍 |

---

### 4.1 读别人仓库的三小时法（省时间，也避免"读了个寂寞"）

1. **15 分钟定生死**：`README` → 目录树 → `package.json`/`index.html`。只看三件事：许可、代码量级、有没有测试。许可 `NONE` 直接退出（§5）。
2. **40 分钟只读一个文件**：挑"你最缺的那一块"，比如 `spatial-hash.js`。**不要按顺序读全仓**——你 90% 的时间会浪费在和你无关的 UI 上。
3. **40 分钟抄结构不抄实现**：在纸上写清它的接口（`get(x,y,r) → ids[]`），然后**自己重写**。这样既避开许可问题（虽然 MIT 允许抄），也保证代码长在你的架构上。
4. **30 分钟加一条测试**：把它的断言改写成你项目里的第一份回归测试（原型现在只有截图审计，没有数值断言，见 D11）。
5. **剩下时间**：只用来回答一个问题——"它的哪个设计是我没想到的？"记下来，这就是这次阅读的真实收益。

---

## §5 不要用清单（附原因）

### 5.1 GPL / AGPL：**代码一行都不能抄进你的项目**（除非你的项目也 GPL）

| 仓库 | ★ | 许可 | 最近提交 | 说明 |
|---|---|---|---|---|
| [`Anuken/Mindustry`](https://github.com/Anuken/Mindustry) | 29775 | **GPL-3.0** | 2026-11-04 | 自动化塔防 RTS，玩法参考价值极高（波次/资源/塔链），但 GPL-3.0 传染：抄进去你的游戏就必须 GPL。**只读设计，不读实现** |
| [`OpenTTD/OpenTTD`](https://github.com/OpenTTD/OpenTTD) | 8497 | **GPL-2.0**（API 报 NOASSERTION） | 2026-11-10 | 铁路信号/闭塞/站场调度是全网最好的教材；同样是 GPL，**只能读概念**（"区间闭塞"可以变成你的"波次门"设计） |
| [`sganggs/Stronghold-Protocol`](https://github.com/sganggs/Stronghold-Protocol) | 1896 | **GPL-3.0** | 2026-11-12 | 浏览器自走棋塔防（明日方舟同人）。**双重风险**：GPL + 二次创作（同人）——玩法和素材都可能踩原作版权 |
| [`KilledByAPixel/SpaceHuggers`](https://github.com/KilledByAPixel/SpaceHuggers) | 289 | **GPL-3.0** | 2022-12-17 | ⚠ **同作者的 LittleJS 是 MIT，但这个示例游戏是 GPL** ——最容易踩的坑：以为"同一作者就同一许可" |
| [`KilledByAPixel/BounceBack`](https://github.com/KilledByAPixel/BounceBack) | 235 | **GPL-2.0** | 2021-09-14 | 同上 |

### 5.2 没有许可证（`NONE`）：**默认保留所有权利，比 GPL 更严格**

| 仓库 | ★ | 最近提交 | 说明 |
|---|---|---|---|
| [`dmcinnes/dead-valley`](https://github.com/dmcinnes/dead-valley) | 67 | 2023-12-19 | HTML5 版 GTA 式僵尸生存，代码质量看着不错——**但无许可证，不能抄**。只可以"玩一玩找感觉" |
| [`qiao/PathFinding.js`](https://github.com/qiao/PathFinding.js) | 8728 | 2024-06-20 | 8728★ 的寻路库却没有 LICENSE（npm 上 `pathfinding` 也是空许可）。**高星 ≠ 可用**，这是最好的反面教材 |
| [`vonWolfehaus/flow-field`](https://github.com/vonWolfehaus/flow-field) | 106 | 2016-04-20 | 流场 + steering 的实验项目，思路可以看，但 2016 年停更 + 无许可 |
| [`BenHaddley/battlestations`](https://github.com/BenHaddley/battlestations) | 0 | 2026-10-07 | 唯一主题对应项目，无许可 + 未完成 |

### 5.3 名字骗人的（搜索关键词陷阱，值得单独记一笔）

| 仓库 | ★ | 真相 |
|---|---|---|
| `assaf/zombie` | 5621 | **不是僵尸游戏**，是 Node 的无头浏览器测试工具（"zombie" = 僵尸进程）。搜 `zombie` 必踩 |
| `keymetrics/pm2-server-monit` | 265 | "zombie process" 监控，同上 |
| `pshenok/server-survival` | 6492 | 是**云架构教学**游戏，塔防只是外壳；架构可看，玩法参考价值低 |
| `egret-labs/egret-core` | 4029 | 2022 年停更的旧引擎，NOASSERTION 许可 → 别碰 |

---

### 5.4 许可证速查卡（看到新仓库先对这张表）

| 许可 | 能抄代码吗 | 义务 | 本文涉及 |
|---|---|---|---|
| **MIT / ISC** | ✅ 可以，含商用 | 保留版权声明与许可原文 | 绝大多数（rbush、yuka、canvas-vampire-survivors…） |
| **Unlicense / CC0** | ✅ 随便用 | 无（建议仍署名） | jsfxr、open-simplex-noise |
| **Apache-2.0** | ✅ 可以 | 保留声明 + NOTICE 文件 + 专利授权条款 | （本文备选里有，如 arcomage-hd） |
| **BSD-3-Clause** | ✅ 可以 | 保留声明，不得用作者名背书 | rot.js |
| **MPL-2.0** | ⚠ **文件级** copyleft | 改了它的**文件**就必须公开那些文件；可以和新代码链接 | bitECS |
| **GPL-2.0 / GPL-3.0** | ❌ 除非你的游戏也 GPL | 整个衍生物必须 GPL 开源 | Mindustry、OpenTTD、SpaceHuggers、Stronghold-Protocol |
| **AGPL-3.0** | ❌ 更严格 | 同上，且"网络提供服务"也算分发 | （本文未采用） |
| **`NONE`** | ❌ **不能抄** | 默认保留所有权利，比 GPL 更严格 | dead-valley、PathFinding.js、flow-field、battlestations |
| **`NOASSERTION`** | ⚠ 必须先读 LICENSE | GitHub 只是"识别不出"，**不代表没许可** | OpenTTD（实为 GPL-2.0）、canvas-vampire-survivors（实为 MIT） |

> 一句话记法：**MIT/ISC/Unlicense 随便抄（署名）；MPL 抄了别改它文件；GPL/AGPL 只读不抄；NONE 连看代码都别照搬。**

---

## §6 "缺什么 → 抄哪里"速查表

| 你的缺口 | 第一选择 | 备选 | 预计工时 |
|---|---|---|---|
| D1 群体转向 | `Mugen87/yuka` 的 separation/cohesion/wander | `dmnsgn/vector-field` 流场 | 1 天 |
| D2 空间索引 | `ricardo-foundry/canvas-vampire-survivors` 的 `src/spatial-hash.js` | `mourner/rbush`（5.9 KB） | 0.5 天 |
| D3 对象池 | 同上 `src/pool.js`（60 行） | `hmans/miniplex` | 0.5 天 |
| D4 音频 | `chr15m/jsfxr`（Unlicense） | `radius-raid` 的 `js/audio.js` + `js/jsfxr.js` | 1 天 |
| D5 确定性 RNG | `zeh/prando` | 自己写 15 行 mulberry32 | 0.5 天 |
| D6 敌人种类 | `quiver-dev/tower-defense-godot4` 的状态机目录 + `radius-raid` 的 `enemy.js` 配置表 | `Mocas-12/no-survivor-game` | 1–2 天 |
| D7 地形绕行 | `dmnsgn/vector-field`（流场） | `mikewesthad/navmesh`（大概率不需要） | 1 天 |
| D8 碰撞 | `nenjack/check2d`（原 detect-collisions） | 自己写圆-圆推开（30 行） | 0.5–1 天 |
| D9 行为/武器结构 | `hmans/miniplex`（24 KB）或手写状态机 | `NateTheGreatt/bitECS`（MPL-2.0，注意） | 1–2 天 |
| D10 调参 | `cocopon/tweakpane` 148 KB（dev only） | 手写 input 面板 | 0.5 天 |
| D11 自动测试 | `canvas-vampire-survivors` 的 `test/` 组织 | 自有 `tools/smoke.mjs` 扩展 | 1 天 |
| D12 地形噪声 | `jwagner/simplex-noise.js`（18.6 KB） | `joshforisha/open-simplex-noise`（Unlicense） | 0.5 天 |

---

## §7 如果只能看 5 个仓库，是哪 5 个

1. **`ricardo-foundry/canvas-vampire-survivors`** — <https://github.com/ricardo-foundry/canvas-vampire-survivors>
   *先看 `src/spatial-hash.js` 和 `src/pool.js`*。同栈、同玩法、零依赖，且正好补上你最大的两个性能隐患。8★ 但含金量远超星数。
2. **`jackrugile/radius-raid-js13k`** — <https://github.com/jackrugile/radius-raid-js13k>
   *先看 `js/enemy.js` 和 `js/particleemitter.js`*。13 KB 教你"敌人种类 + 粒子"怎么用配置表而不是 hardcode。
3. **`quiver-dev/tower-defense-godot4`** — <https://github.com/quiver-dev/tower-defense-godot4>
   *先看 `entities/enemies/` 目录树和 `enemy_fsm.gd`*。语言不同但结构最清楚：敌人状态机 + 塔位/弹道分离，直接对应你的 D6/D9。
4. **`Mugen87/yuka`** — <https://github.com/Mugen87/yuka>
   *先看 `src/steering/` 下的 `SeparationBehavior`、`CohesionBehavior`、`WanderBehavior`*。三个文件一共不到 100 行，抄进 `zombies.js` 就能让尸群"散开涌来"而不是"排成一条线"。
5. **`chr15m/jsfxr`** — <https://github.com/chr15m/jsfxr>
   *先看 README 的在线 demo*。原型现在**一个音效都没有**，这是投入产出比最高的一步：半天让枪声、爆炸、丧尸嚎叫全部有声音，且零音频文件。

> 第 6 个备选：`KilledByAPixel/LittleJS`（<https://github.com/KilledByAPixel/LittleJS>，4381★ MIT）——如果上面 5 个看完还想要"引擎级"的碰撞/粒子/音频，再进去看 `src/`。

---

## §8 搜索方法学（给下次的自己）

这次踩过的关键词坑与有效的查询，记下来省时间：

| 查询 | 结果 | 判定 |
|---|---|---|
| `zombie train in:description` | 全是 trainer / cheat / 破解（"Zombies Trainer 2026"） | ❌ 关键词组合越"像游戏"，越容易命中外挂营销站 |
| `armored train in:description` | 同样是 trainer + 检测模型 | ❌ |
| `train defense in:name,description` | 混进政治宣传仓库 | ❌ 多词自然语言查询噪声极大 |
| `convoy in:name,description` | 1638 条全是 DevOps / Webhook 网关 | ❌ |
| `on-rails in:name,description` | 全是 Ruby on Rails 教程 | ❌ 经典歧义 |
| `railway defense in:description` | 17 条，仅 1 条主题相关（0★ 无许可） | ⚠ 稀缺但能验证"没人做" |
| `topic:tower-defense stars:>500` | Mindustry / server-survival / Stronghold | ✅ **topic + stars 过滤最有效** |
| `topic:spatial-index language:JavaScript` | mourner 三件套 + geo 索引 | ✅ |
| `vampire survivors in:name` | 786 条，绝大多数 Unity/Godot | ⚠ 要再叠 `language:JavaScript` |
| `topic:survivors-like` / `topic:bullet-heaven` | 65 / 35 条，星都低但**命中率高** | ✅ 小众 topic 适合挖宝 |
| `topic:js13k language:JavaScript` | LittleJS / radius-raid / elematter | ✅ |
| 直接 `repos/{owner}/{repo}` 核验 | 35+ 个候选逐条过 | ✅ 必做：`NONE`/`NOASSERTION` 只有这一步能看出问题 |

**三条经验**：① 少用自然语言多词查询，多用 `topic:` + `language:` + `stars:>N`；② 星数是过滤噪声的最便宜工具（`stars:>100` 就能砍掉 90% 的垃圾）；③ **搜到的名字必须回查 `/repos/` 接口**——`detect-collisions` 已改名 `check2d`、`canvas-vampire-survivors` 的 MIT 被 API 报成 NOASSERTION，这两条都是只有回查才会发现的。

---

*本文所有仓库信息为 2026-11-12 API 快照；★ 数与 pushed_at 会变，引用前请复核。原型目录与 city-and-metro 均未修改。*
