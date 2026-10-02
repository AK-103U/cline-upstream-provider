# DSH 额度显示：设计稿

给 DeepSeek Harness 插件加“Cline Pass 额度显示”的落地方案。数据端点、字段与坑见 [cline-api.md](./cline-api.md)；视觉与状态稿见 [quota-preview.html](./quota-preview.html)（亮/暗、三档配色/只在超标时变色、正常/超 90%/刷新失败/未配置/加载中，都能在页面上直接切）；本稿只谈 DSH 这一侧怎么接。

**已定的三件事**（其余见 §9）：

1. 落点只有两个：**输入框下方悬浮卡片里的「额度区」** + **本插件设置页里的「Cline Pass 额度」块**（账号 / 三条窗口 / 套餐 / 开关，即 pi 那个面板的 DSH 版）。不做输入框下方的常驻额度段，聊天界面里除了悬浮卡片不多占位置。
2. 账号与套餐信息只进设置页，邮箱默认脱敏。
3. 先出效果稿再写代码：`docs/quota-preview.html` 已产出，配色与告警落点按它定。

## 0. 目标 / 不做

**目标**：在 DSH 里一眼看到 Cline Pass 三个限流窗口（5h / 7d / 月）的已用百分比、重置时间、套餐与周期，并且不打扰、不越权、不打爆端点。

**不做**（端点上就不存在，别自己造）：

| 想显示 | 为什么不做 |
|---|---|
| 剩余额度 / 余额 / 积分 | `docs/cline-api.md` §1：`/users/me/balance` 400、`/users/me/credits` 404，没有余额端点 |
| “还剩 xx 美元” | `plan.entitlements.cline_pass.inferenceCapThreshold.*` 名字像美元、值是 `1e9` 级哨兵整数，**不是**真实额度 |
| 逐模型用量 | 无端点 |
| `plan.name` | 内部名带 `[Internal]` 后缀，只用 `displayName` |
| 渲染期发请求 | §6.2：这是真实网络调用，只能在命令触发或低频缓存里发 |

## 1. 一条边界：key 留在宿主

额度接口要 `Authorization: Bearer <cline key>`。插件已经有解这个 key 的全部能力（`detectRoute()` 找到指向 `api.cline.bot` 的路由 → `authOf(route)` 经 `credentials.resolve(apiKeyEnv)`，再回退 `process.env`），**复用它，不要新造一套**，也不要让 key 或其派生值出现在任何响应体、DOM 或日志里。

于是分工是硬的：

```
宿主 dsh/index.js            浏览器 dsh/client.js
  ├─ 解密钥（唯一持有者）       ├─ 轮询 /usage（拿不到 key）
  ├─ 请求 api.cline.bot        ├─ 渲染 dock 常驻段 / 卡片额度区 / 设置页
  └─ 归一化 + 缓存 + 限流       └─ 倒计时本地算，不再发请求
```

## 2. 宿主半体

### 2.1 新路由

沿用现有 `/pin`、`/route` 的注册方式（Connection 的认证 `/api` 围栏内，浏览器同源可见）：

| 路由 | 方法 | 语义 |
|---|---|---|
| `/api/cline-upstream-provider/usage` | GET | 读缓存快照；宿主自己决定要不要真发请求 |
| `/api/cline-upstream-provider/usage?refresh=1` | GET | 用户主动刷新；受最小间隔约束，间隔内直接返回缓存 |

响应形状（永远是 200，错误走 `state`/`reason`，让 UI 只处理一种形状）：

```jsonc
{
  "ok": true,
  "state": "ready",            // ready | unconfigured | error
  "reason": null,              // unconfigured: no-route | no-key
                               // error: timeout | http-401 | shape | network
  "fetchedAt": 1788771075006,  // 上次成功抓取时间
  "failedAt": null,            // 上次失败时间
  "stale": false,              // 有旧值但最近一次刷新失败
  "value": {
    "windows": [
      { "type": "five_hour", "percent": 8, "resetsAt": "2026-10-02T10:52:50.252945652Z", "resetsAtMs": 1788773570252 }
    ],
    "plan": {
      "displayName": "Cline Pass (Monthly)",
      "interval": "Monthly",
      "pricePerSeatCents": 999,
      "periodStart": "2026-09-21",
      "periodEnd": "2026-10-21",
      "canceled": true
    },
    "account": { "email": "user@example.com", "maskedEmail": "us***@example.com", "displayName": "…" }
  }
}
```

- `value` 为 `null` 只在 `unconfigured` 且从未成功过时出现；`error` 但有过成功值时**仍然带上旧 `value`**，靠 `stale: true` 说明它旧了（pi 版就是“保留上次快照”，别倒退成空白）。
- `windows` 顺序固定 `five_hour → weekly → monthly`，缺哪个就少哪个（不补 0，避免把“没数据”画成“没用量”）。
- 邮箱同时给原值与脱敏值，**默认渲染脱敏那个**，除非用户显式打开“显示完整邮箱”。

### 2.2 抓取与归一化

三条端点并发，`usage-limits` 必需，`plan` / `me` 失败只降级不致命：

```
Promise.all([
  GET /users/me/plan/usage-limits     // 必需
  GET /users/me/plan      .catch(→ undefined)
  GET /users/me           .catch(→ undefined)
])
```

- `AbortSignal.timeout(10_000)`；`content-type` 先判，非 JSON 视为失败（§6.3）。
- `body.success !== true` 视为失败，取 `body.error` 作文案。
- `type` 白名单 `five_hour | weekly | monthly`，其它丢弃；三条全空 = `shape` 失败。
- `percentUsed` 非有限数丢弃该条；否则 clamp 到 `0..100`，展示时取整。
- `resetsAt` 解析成 epoch；解析不出来就 `null`，UI 只少一个倒计时，不报错。
- 金额字段一律不解析 `fee_dollars` / `inferenceCapThreshold` / `features.included`（后者是混着说明文字的模型清单，想展示再单独做）。

纯函数（归一化、等级判定、倒计时文案）单独放，配 `node:test` 单测——这是唯一值得测的部分。

### 2.3 缓存、并发与请求预算

端点是真的，费用是真的（探测都按 $0.0002 级算过，见 pinning.md §8），所以：

| 机制 | 值 | 理由 |
|---|---|---|
| 缓存 TTL | 60s | 与 pi 版一致，§6.2 的下限 |
| in-flight 合流 | 有 | 多个页面/多个入口同时读只发一次 |
| 强制刷新最小间隔 | 10s | 用户连点“刷新”不至于刷端点 |
| 失败退避 | 60s → 2m → 5m 封顶，成功清零 | 端点挂了不要每分钟锤一次 |
| 后台预热 | 仅在观察到 Cline 流量后，且 5 分钟节流 | 没人用 Cline 时不发请求 |
| 页面全关 | 不刷 | 客户端不轮询就没有请求 |

## 3. 客户端半体

### 3.1 读取时机

- `document.visibilityState === 'visible'` 时每 60s 读一次；隐藏时停；
- `visibilitychange → visible` 立即读一次（回到标签页就是新数字）；
- 悬浮卡片打开时读一次（命中宿主 TTL，便宜）；
- 卡片里的“刷新”按钮走 `?refresh=1`，按宿主返回的 `fetchedAt` 判断是否真刷新了（按钮短暂禁用即可，不猜）。

### 3.2 两处展示

**A. 悬浮卡片里的额度区（聊天界面里唯一落点）**

现有卡片头是路由、身是渠道清单，中间插入“额度”区：

```
┌ Cline Pass ────────────── deepseek → novita ┐  ← 卡片头（现有）
│  5h  ███░░░░░░░░░░░░░░░░░░   8%   21:53 重置 │
│  7d  ████████░░░░░░░░░░░░░  26%   4 天后重置 │
│  月  ███████░░░░░░░░░░░░░░  21%   20 天后重置│
│  Cline Pass (Monthly) · $9.99/Monthly · 已取消，10-21 到期 │
│  更新于 19:41:07                            刷新 │
├──────────────────────────────────────────┤
│  渠道清单（现有 4 列网格）                    │
└──────────────────────────────────────────┘
```

- 进度条自绘（track + fill，6px 圆角），`display:block` 别省——track / fill 是 `span`，行内元素会吃掉高度（效果稿里踩过）；
- 行的颜色就是该窗口的等级色，条与百分比吃 `currentColor`，窗口名与重置时间各自取固定灰阶，所以只有“条 + 数字”随等级变色；
- 倒计时**本地算**：`<24h` 显示 `HH:MM 重置`，`≥24h` 显示 `N 天后重置`，已过期显示“即将重置”；每分钟重渲染一次，不发请求；
- 页脚给“更新于 HH:MM:SS”+ 刷新按钮；`stale` 时整块降饱和，并留一行“上次刷新失败（原因），显示 xx 的数据”；
- 告警时多一行短提示（`⚠ 7d 已用 92%，约 3 小时后打满`），不铺长句；
- 未配置 / 加载中：**整块不渲染**（卡片只剩路由与渠道清单），不占位、不弹错。

**B. 插件设置页（本 bundle 的页面，`plugins.bundle.config`）—— pi 面板的 DSH 版**

在现有“渠道钉住”上方加一块“Cline Pass 额度”，走与 pin 控制同一套语法（标签左列 + 值右列）：

| 字段 | 内容 |
|---|---|
| 账号 | `us***@example.com` + 「已脱敏」小标（pi 面板里的账户行） |
| 已用 | 三条窗口：窗口名 / 进度条 / 百分比 / 重置时间；告警或陈旧时下面多一行长句 |
| 套餐 | `Cline Pass (Monthly) · $9.99/Monthly · 已取消，到期后失效`（只用 `displayName`） |
| 周期 | `09-21 → 10-21（当前计费周期）` |
| 更新 | `19:41:07` + 「刷新」按钮 |
| 诊断 | 只读一行：`路由 cline（api.cline.bot）· 密钥引用 CLINE_API_KEY（已配置，来自 keychain）· 快照 12s 前`；失败时给原因 |
| 开关 ×3 | ① 在悬浮卡片里显示额度（开）② 显示完整邮箱（关）③ 窗口超过 90% 时提醒（开） |

实现时的两处收敛：**路由与密钥合成「诊断」一行**（原先单列一行会与它重复）；告警长句先只给“⚠ 月 已用 92%，注意节奏”，**“按现在速度约 N 小时后打满”那句随 Phase 3 的燃烧率一起来**，效果稿里那句是目标形态。

偏好存哪：纯显示偏好先放**客户端 localStorage**（按浏览器，即时生效，不动宿主）；只有当某项必须跨浏览器/跨机器一致时，才升级成宿主侧存储（DSH_HOME 下的 json）或插件 Config。

**C. 不做：输入框下方的常驻额度段**

现有 pill 已经占着 dock，再挂一段百分比会把“本会话路由”和“账号额度”两种信息混在一行；额度是账号级的、变化慢，进卡片与设置页足够。

### 3.3 状态机与降级

```
loading(骨架) ─┬─→ ready        正常渲染
               ├─→ unconfigured 设置页说明缺什么；卡片里额度区整块不渲染；不弹错
               └─→ error        有旧值→旧值+stale 标记；无旧值→设置页给一行原因
```

未配置（`no-route` / `no-key`）**不是错误**：用户只是没配 Cline，插件不该弹红。

### 3.4 文案与主题

- 新字符串走客户端 `locale` 服务（`inject: ['slots','locale']` + `ctx.locale.register(NS, { zh, en })`），跟随 DSH 语言设置；顺手把卡片里现有硬编码中文一并迁进去，别留下中英混排；
- 样式只用主题令牌（`--dsw-alias-state-{success,warn,error}-primary`、`--dsw-alias-label-*`、`--dsw-alias-border-l2`、`--dsw-alias-bg-layer-1`），类名前缀统一 `cline-quota-`；
- 卡片是 `role="dialog"`（现有约定），额度区补 `aria-label`（如“Cline 额度：5h 8%，7d 26%，月 21%”）。
- 配色两选一，效果稿里可一键对照：**三档**（`<50` 常规 / `50–79` warn / `≥80` error）或**只在超标时**（常态中性灰，只有 `≥80` 变红）。前者信息量大、后者安静；默认取三档，定了就把另一套删掉。

## 4. 告警（Phase 2，可选）

- 阈值 90%，每个窗口每档只提醒一次；该窗口回落到 `<50%`（说明已经重置）后重新武装；`resetsAt` 变化时也重新武装。去重记在 localStorage，避免刷新页面重复弹。
- 效果稿已经把三档告警视觉都摆出来了，按它挑：① 只让那一行变红 + 卡片一行短提示（最安静）；② 再加设置页里那句带“按现在的速度约 3 小时后打满”的长句；③ 再加顶部帧级横幅（草样已画）。
- **`shell.quota-notice` 已排除（查过官方实现）**：它是 `ui-chat` 在 `shell.overlay` 条目里声明的 `chain` 子槽，全仓库只有一个生产者（`turn/end` 且错误码为 `QUOTA` / `ACCOUNT_QUOTA` 时发布一条通知），也只有一个占用者（`ui-settings-account` 的 `AccountQuotaNotice`，`select: owner => owner.code === 'ACCOUNT_QUOTA' ? owner : null`）。也就是说这个槽只在“一次调用因为额度失败”时才被触发，第三方注册者只会在那类通知出现时被选举，**无法**用它表达“窗口已用到 90%”这种本地条件；真去占位反而会把官方的额度失败提示顶掉。告警只落在卡片与设置页。

## 5. 本地补充指标（Phase 3，可选）

端点不给绝对值，但本地可以补两个只属于“本机本 profile”的参考量：

1. **燃烧率 / 预计打满**：客户端保留每个窗口最近 N 个 `(时间, 百分比)` 样本，线性估算 `+x%/10min` 与“按当前速度约 y 后打满”；检测到百分比下降或 `resetsAt` 变化就清样本（滚动窗口）。
2. **本地 token 累计**：宿主已在 `observe()` 里逐帧读 Cline 响应，可顺带累计 `usage` 的 prompt/completion tokens，给出“今日/本会话 token”。**只能当参考**，不能当计费依据（cline-pass 的计费单位未公开）。

两项都标注“本地统计”，别让人误以为来自账号。

## 6. 改动面与版本

| 文件 | 改动 |
|---|---|
| `dsh/index.js` | 新增 `/usage` 路由 + 抓取/缓存（嫌大就拆 `dsh/host/usage.js`，宿主是普通 ESM，可直接相对导入） |
| `dsh/client.js` | 新增 STYLE 类、卡片额度区、设置页额度块（客户端 bundle 约定单文件，dsh-context 也是打包成单文件） |
| `dsh/locale/{zh,en}.json` | 只放插件列表的 `meta`（现状），运行时词典走 `ctx.locale.register` |
| `package.json` | 需要 UI 原语时才动 `dsh.client.inject`。注意：`@deepseek-ai/dsh-client-ui-primitives` 虽然在模块表里，官方插件规范明确不让第三方插件 require 它，所以本块自绘样式；版本 → `0.1.6` |
| `docs/quota-preview.html` | ✅ 已产出：样式台（亮/暗、两套配色、五种状态） |
| `tools/sync-preview.mjs` | ✅ 已修：sprite 元素改为行首锚定匹配。原先的写法会被页面头部注释里的同名标签先命中，一路吞到真正的 sprite 结束标签，把整页样式与结构删光（本次已踩到一次） |
| `.github/workflows/ci.yml` | ✅ 已改：DSH 语法检查扩到 `dsh/host/*.js`，并新增 `node --test "tools/tests/**/*.test.mjs"` |
| `tools/tests/` | ✅ 已加：宿主模块 13 例（缓存/下限/退避/失败留旧值/容错/不泄密钥）+ 客户端纯函数 8 例（从 `client.js` 的 `qup` 标记区切片后测） |
| `README.md` / `README.en.md` | 双语补一段额度显示与预览图 |

## 7. 验收标准

1. 没配 Cline 路由或密钥：不显示额度、不报错，设置页能说明是哪一种缺失。
2. 配好后：三个百分比与 Cline 官网一致（差异只来自刷新时差）。
3. 60s 内反复轮询不产生第二次真实请求（宿主加计数器/日志自证）。
4. 断网、超时、HTTP 200 + `success:false`：保留上次数字并标 stale，不空白、不崩。
5. 字段缺失（无 `resetsAt`、多出未知 `type`）：降级显示，不崩。
6. 亮/暗主题、中/英切换、窄窗口下不溢出、不出现两次请求。
7. 全链路（响应体、DOM、日志）搜不到 key 的明文。

**已经自动覆盖的**（`node --test "tools/tests/**/*.test.mjs"`，21 例）：

| 验收 | 覆盖方式 |
|---|---|
| 3 | 宿主用例直接断言 TTL、强制刷新的 10s 下限、预热刷新的 5 分钟下限与并发合流（按请求次数计） |
| 4 | 失败后仍返回上次成功值 + `stale`，退避 60s→2m→5m 逐步放宽，成功后清零 |
| 5 | 未知 `type` 丢弃、百分比越界收敛到 0–100、`resetsAt` 缺失只掉倒计时、非 JSON 与 `success:false` 都变 `reason` |
| 7 | 宿主用例断言快照里搜不到密钥；客户端用例断言卡片树里没有原始邮箱 |
| 1、4 的 UI 面 | 用桩 React 跑真实 `client.js`：正常 / 陈旧 / 未配置三种状态都渲染出该有的东西（卡片在未配置时整块不占位，设置页给说明句） |

**仍需真机确认的**：2 和 6，以及真实网络下的一次实读。宿主半体不进热重载，所以要在正在运行的 profile 里看效果，得把本仓库装进去再**重启** dsh：

```bash
dsh plugin --profile desktop add F:\dev\blog\liu\cline-upstream-provider
# 然后重启那个 profile 的进程（Ctrl+C 后重新 dsh web / 重开桌面端）
```

**换装后必须重启的实证**：本仓库在 20:24 被装进 `web` profile（`^0.1.2` 换成指向仓库的 junction），而那个 profile 的服务进程是 20:21 启动的 —— 浏览器拿到的是新客户端（bundle 里有 `cline-quota`），宿主却仍是 0.1.2（只有 `/api/cline-upstream-provider` 与 `/icon` 两条路由，`/pin`、`/channels`、`/usage` 全 404）。`patchReload: live` 只重放 patch 层，不会把已被替换掉的模块重新 import，所以**页面看起来"卡住"，实际是新前端配旧宿主**。设置页现在会直接说明这一点（见 §3.3 的 `host-missing` 状态），而不是一直停在骨架屏。

## 8. 实施顺序

| 阶段 | 内容 | 对应验收 |
|---|---|---|
| Phase 0 | ✅ 效果稿 `docs/quota-preview.html`（定视觉、定状态、定告警档位） | — |
| Phase 1（MVP） | §2 宿主路由与缓存 + §3.2 A/B 两处展示 + §3.3 降级 | 1–5、7 |
| Phase 2 | §3.4 i18n 迁移 + §4 告警 | 6 |
| Phase 3 | §5 燃烧率 / 本地累计（可选，先看有没有人用） | — |

## 9. 还需要你拍板

1. **配色**：三档（绿/黄/红）还是只在超标时（常态灰、`≥80` 才红）？效果稿工具条上一键对照。
2. **告警做到哪一档**：只变色 / 加设置页长句 / 再加顶部帧级横幅？
3. **Phase 3** 要不要（本地燃烧率与 ETA、本机 token 累计）——都只在本地算，但会多两块 UI。
4. 实现时是否顺手把卡片里现有硬编码中文迁到 `ctx.locale`（推荐，能跟语言设置走）。
