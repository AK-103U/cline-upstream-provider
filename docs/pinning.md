# 钉住与校验：curl 判定手册

用 `curl` 直接判定：模型走哪条管道、有哪些渠道、钉住是否生效、失败属于哪一类。

## 0. 准备

```bash
KEY=apikey
U=https://api.cline.bot/api/v1/chat/completions
M=cline-pass/deepseek-v4.1-flash

# 附带额外字段发一次请求，$1 形如 '"providerOptions":{...}'
J(){ curl -s -X POST "$U" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"model\":\"$M\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":200${1:+,$1}}" --max-time 120; }

# 打印 pipeline / 实际渠道 / 错误
show(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s),d=j.data&&j.data.choices?j.data:j,rt=d.choices?.[0]?.message?.provider_metadata?.gateway?.routing;console.log("pipeline:",rt?.finalProvider?"planner":(typeof d.provider==="string"?"direct":"?"),"| actual:",rt?.finalProvider||d.provider||"-",d.error?("| "+String(d.error.message||d.error).slice(0,140)):"")}catch{console.log(s.slice(0,200))}})'; }
```

## 1. 判定管道

```bash
J | show
```

- `pipeline: planner` → 用 `providerOptions.gateway.{only,order,sort}` 钉住
- `pipeline: direct`  → 用顶层 `provider.{only,order,sort}` 钉住

## 2. 列渠道（零 token）

故意钉一个不存在的渠道，让网关在路由层报错并列出清单。

```bash
# planner
J '"providerOptions":{"gateway":{"only":["__probe__"]}}' | show

# direct
J '"provider":{"only":["__probe__"]}' | show
```

从错误里提取渠道清单：

```bash
J '"providerOptions":{"gateway":{"only":["__probe__"]}}' \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=/Available providers are:\s*([^.]+)/.exec(s);console.log(m?m[1].split(/, */).filter(t=>/^[a-z0-9][a-z0-9-]*$/.test(t)).join(" "):"(未捕获)")})'
```

- planner：错误文本 `Available providers are: a, b, c`
- direct：错误 JSON `error.metadata.available_providers`
- 两条管道清单不一致，分别取
- 管道未知时（全新安装、还没有任何 Cline 调用）**先试 planner，再试 direct**：planner 形状的清单在错误文本里，是最稳的一条
- **2026-10-02 实测（同一 key、同一模型 `cline-pass/deepseek-v4.1-flash`）**：
  - planner 形状 `HTTP 500`，文本为 `Available providers are: alibaba, baseten, boundless, deepinfra, deepseek, fireworks, gmicloud, modal, morph, novita, parasail, particle, relace, runinfra, runware, togetherai, wafer` —— **17 个，严格字母序**。也就是说清单顺序是**网关自己排的**，插件照抄不重排（渠道卡片那份字母序就是这个来源）。
  - 双写（planner + direct 两个字段同一条请求）拿到的是**同一份** planner 清单：被忽略的字段确实是被丢掉而不是被拒绝（§4/§5 的说法成立）。
  - **但 direct 形状不保证零 token**：planner 网关上 `provider.only` 被静默丢弃，那条请求就成了一次真实调用 —— 实测返回上游错误 `failed to invoke model 'deepseek/deepseek-v4.1-flash' from Vercel: request failed with status 429 … Rate limit exceeded`。所以"探测零 token"只对**当前生效的那条管线**成立；未知管线时先发 planner、只有它没给出清单才发 direct，正是为了把这种真实调用的机会压到最小（`max_tokens: 1`，代价上限是一次最小调用）。

## 3. 正钉（看 actual 是否等于目标）

钉一个**非默认**渠道，避免假阳性：

```bash
J '"providerOptions":{"gateway":{"only":["novita"]}}' | show   # planner
# J '"provider":{"only":["novita"]}' | show                    # direct
```

`actual: novita` → 钉住生效。

## 4. 反证：判定**字段是否被网关采纳**

正钉会被"路由黏性"污染（见 §8），不能用来判断字段是否有效。用假渠道：

```bash
J '"providerOptions":{"gateway":{"only":["__probe__"]}}' | show   # planner 字段
J '"provider":{"only":["__probe__"]}'                     | show   # direct 字段
```

| 结果 | 含义 |
|---|---|
| 报错（No available providers / invalid） | **字段被采纳** |
| 静默成功（`empty response content` 或正常返回） | **字段被丢弃** |

实测：planner 管道下 `providerOptions.gateway.only` 被采纳；顶层 `provider.only` 被**静默丢弃**。

## 5. 钉住字段矩阵

| 场景 | planner | direct | 未知管道 |
|---|---|---|---|
| 严格钉住 | `providerOptions.gateway.only=[u]` | `provider.only=[u]` | 两处同写 |
| 优先+回退 | `providerOptions.gateway.order=[u,...]` | `provider.order=[u,...]` | 两处同写 |
| 排除 | 换算成 `only=已知渠道−排除` | 同左 | 两处同写 |
| 排序 | `sort: cost\|ttft\|tps` | `sort: price\|latency\|throughput` | 按管道各取 |

- 网关**不支持** `exclude/ignore`，排除只能换算成 `only` 白名单。
- `provider` 显示名要 `slugify`（小写、空格转 `-`）才能和渠道 slug 对齐。
- **上表的"两处同写"只适用于真实请求**：被忽略的字段是被静默丢掉而不是被拒绝，§2 的实测也确认双写拿到的是生效那条管线的清单，所以双写**不是**探测拿不到清单的原因（早先按此归因过，已撤销）。探测仍改成逐条管线试，理由是两个：① 管道未知时**先发最稳的 planner 形状**，把"字段被丢掉、于是变成一次真实调用"的机会压到最小（§2 的 direct 实测就撞上了上游 429）；② 失败时能说清**是哪条形状、网关回了什么**（`/channels` 的 `attempt`），而不是只报一句"没拿到结果"。

## 6. 校验：逐渠道状态分类

对清单里每个渠道，各发一条最小请求单独钉一次（`max_tokens:16`，并发 5，单条超时 60s），按错误文本分类：

```js
function classify(msg) {
  const m = String(msg || '');
  if (/empty response content/i.test(m)) return 'ok';       // 已到达模型，推理吃光 max_tokens
  if (/429|rate-?limited|temporarily rate/i.test(m)) return 'limited';
  if (/invalid_request|modelid|no allowed providers|no available providers|not found|unsupported/i.test(m)) return 'bad';
  if (/unauthorized|re-authenticate|401/i.test(m)) return 'auth';
  return 'unknown';
}
```

| 状态 | 含义 | 处置 |
|---|---|---|
| `ok` | 可钉 | ✔ |
| `limited` | 渠道有效但限流中 | ⏳ 临时标记，不拉黑 |
| `bad` | 确定性不可钉 | ✘ 拉黑 |
| `auth` | 账号 key 问题，与渠道无关 | 修账号 |
| `unknown` | 不确定 | 不拉黑 |

## 7. 失败预期

| 现象 | 判定 | 处理 |
|---|---|---|
| `invalid_request_error` / `modelid` / `no allowed providers` / `no available providers` / `not found` / `unsupported` | `bad` | 换候选 |
| `429` / `rate-limited` / `temporarily rate` | `limited` | 换候选，不拉黑 |
| `empty response content` | `ok` | 请求已到达；调大 max_tokens |
| `unauthorized` / `re-authenticate` / `401` | `auth` | 账号级，与渠道无关 |
| 网络失败 / 超时 / 非 JSON | 可重试 | 切下一候选 |
| 200 + `text/event-stream`，首块是 `data: {"error":…}` | 流式失败 | 首包前仍可切换 |
| SSE 已开始 | 不可重试 | 直接透传 |
| 严格钉住 + 唯一候选失败 | 无回退 | 透传错误（预期） |

## 8. 实测坑

1. **路由黏性**：同一 key 短时间内的自动请求会复用上一渠道几十秒。钉住 A 之后紧接的顶层写法请求也会命中 A，造成"顶层也生效"的假象。**判定字段只认 §4 的假渠道报错。**
2. **最小请求 ≠ 真实载荷**：某渠道用最小 curl 可钉，但带完整客户端载荷（tools/reasoning/stream_options）时报 `stream_initialization_failed`。批量校验会高估可用性。
3. **管道会漂移**：探测结果带时间戳，定期重探；未知管道时双写两种字段。
4. **探测/校验有真实小额费用**（每次约 $0.0002 级）。
