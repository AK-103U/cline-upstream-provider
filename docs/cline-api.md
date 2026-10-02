# Cline 账户接口手册

pi 扩展读取 Cline Pass 套餐与额度所用的 REST 端点、字段说明与实测样例。所有样例来自 2026-10-02 的真实调用（个人信息已打码）。

## 0. 认证与 base URL

| 项 | 值 |
|---|---|
| Base URL | `https://api.cline.bot/api/v1` |
| 认证头 | `Authorization: Bearer <apiKey>` |
| 返回包裹 | `{ "data": ..., "success": true }`，失败时 `success: false` 且带 `error` |

API key 存在 pi 的 `<agent-dir>/models.json` → `providers.cline.apiKey`。agent-dir 默认 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 覆盖。

```bash
# shell 里取 key
CLINE_KEY=$(node -p "require(process.env.HOME+'/.pi/agent/models.json').providers.cline.apiKey")

# 扩展里取 key：getAgentDir() 由 @earendil-works/pi-coding-agent 导出，已解析 PI_CODING_AGENT_DIR
import { getAgentDir } from "@earendil-works/pi-coding-agent";
// 注意 models.json 的 apiKey 还可能是 $ENV 插值或 !command，见 docs/models.md
const raw = JSON.parse(readFileSync(join(getAgentDir(), "models.json"), "utf8")).providers?.cline?.apiKey;
```

## 1. 端点一览

| 端点 | 方法 | 用途 | 状态 |
|---|---|---|---|
| `/users/me/plan/usage-limits` | GET | 三个限流窗口的**已用百分比**与重置时间 | ✅ 200 |
| `/users/me/plan` | GET | 套餐、订阅周期、取消状态、额度阈值 | ✅ 200 |
| `/users/me` | GET | 账户资料（邮箱、显示名、组织） | ✅ 200 |
| `/users/me/balance` | GET | — | ❌ 400 `Invalid request format` |
| `/users/me/credits` | GET | — | ❌ 404 `Not Found` |

**没有**余额、剩余 token、积分或按模型用量端点。额度信息只有百分比。

## 2. GET /users/me/plan/usage-limits

```bash
curl -sS 'https://api.cline.bot/api/v1/users/me/plan/usage-limits' \
  -H "Authorization: Bearer $CLINE_KEY"
```

```json
{
  "data": {
    "limits": [
      { "type": "five_hour", "percentUsed": 8,  "resetsAt": "2026-10-02T10:52:50.252945652Z" },
      { "type": "weekly",    "percentUsed": 26, "resetsAt": "2026-10-05T23:17:49.256295078Z" },
      { "type": "monthly",   "percentUsed": 21, "resetsAt": "2026-10-21T19:54:17.259634242Z" }
    ]
  },
  "success": true
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `data.limits[].type` | `"five_hour" \| "weekly" \| "monthly"` | 限流窗口，固定三项 |
| `data.limits[].percentUsed` | number | 已用百分比，0–100；实测为整数，但不保证 |
| `data.limits[].resetsAt` | string | 窗口滚动重置时间，ISO 8601 UTC，含纳秒精度 |

`resetsAt` 是**滚动窗口**的到期点：five_hour 从现在起 5 小时内最早一次请求的落地时间加 5 小时；weekly / monthly 同理。倒计时按 `Date.now()` 与它求差即可。

## 3. GET /users/me/plan

```bash
curl -sS 'https://api.cline.bot/api/v1/users/me/plan' \
  -H "Authorization: Bearer $CLINE_KEY"
```

```json
{
  "data": {
    "planHistoryId": "iph-01M32QFQQTCKXE348WSR6C9DQH",
    "userId": "usr-01JZKS8QWYZFFE3FM6V49EFYVN",
    "plan": {
      "id": "pln-01KSJCW4BF730CP27KRA82CFDN",
      "name": "Cline Pass (Monthly)[Internal]",
      "displayName": "Cline Pass (Monthly)",
      "description": "Cline Pass brings agentic coding to programmers around the world. ...",
      "type": "individual",
      "interval": "Monthly",
      "pricePerSeatCents": 999,
      "priceId": "price_1Tk52FJvJ1E14BGMhDWMHlmv",
      "maxSeats": 1000000,
      "features": {
        "fee_dollars": 0.61,
        "free_seats": 0,
        "included": ["Low cost subscription pricing", "...", "GLM-5.3", "Kimi K3", "Qwen3.8 Max", "MiniMax-M3", "MiMo-V2.5-Pro", "..."]
      },
      "entitlements": {
        "cline_pass": {
          "enabled": true,
          "inferenceCapThreshold": {
            "last5HoursUsageCostUSDPerUser": 1000000000,
            "last7daysUsageCostUSDPerUser": 2500000000,
            "last30daysUsageCostUSDPerUser": 5000000000
          }
        }
      },
      "isActive": true,
      "createdAt": "2026-05-26T09:34:05.877169Z",
      "updatedAt": "2026-09-21T10:11:10.680596Z"
    },
    "subscriptionId": "sub_1UID0NJvJ1E14BGMpObYPgTL",
    "currentPeriodStart": "2026-09-21T19:35:55Z",
    "currentPeriodEnd": "2026-10-21T19:35:55Z",
    "cancelAt": "2026-10-21T19:35:55Z",
    "canceledAt": "2026-10-02T01:02:17Z"
  },
  "success": true
}
```

| 字段 | 说明 |
|---|---|
| `plan.name` / `displayName` | 内部名带 `[Internal]` 后缀，`displayName` 是干净版；UI 应优先用 `displayName` |
| `plan.type` / `interval` | `individual` / `Monthly`；也见 `pricePerSeatCents`（分）与 `maxSeats` |
| `plan.features.fee_dollars` | 支付附加费（$0.61） |
| `plan.features.included` | 套餐说明 + **可用模型清单**（字符串数组，非结构化） |
| `plan.entitlements.cline_pass.enabled` | 是否有 Cline Pass 权益 |
| `…inferenceCapThreshold.*` | 5h / 7d / 30d 成本上限。字段名虽为 USD，值却是无单位大整数；本账号为 `1e9`/`2.5e9`/`5e9`，属 Internal 哨兵值，**不要**当作真实美元额度展示 |
| `plan.isActive` | 套餐定义是否启用（不代表订阅未取消） |
| `currentPeriodStart` / `currentPeriodEnd` | 当前计费周期 |
| `cancelAt` / `canceledAt` | **出现即已取消**：`canceledAt` 是取消操作时间，`cancelAt` 是生效（周期结束）时间 |

## 4. GET /users/me

```json
{
  "data": {
    "id": "usr-...",
    "email": "...",
    "displayName": "...",
    "termsAcceptedAt": "2026-09-18T10:06:40.838066Z",
    "clineBenchConsent": true,
    "organizations": [],
    "createdAt": "2025-06-05T23:19:43Z",
    "updatedAt": "2026-10-02T01:00:43.768887Z"
  },
  "success": true
}
```

只在需要账户标识时用；额度面板不需要它。

## 5. TypeScript 类型速写

```ts
type UsageLimitType = "five_hour" | "weekly" | "monthly";

interface UsageLimitsResponse {
  data: { limits: Array<{ type: UsageLimitType; percentUsed: number; resetsAt: string }> };
  success: boolean;
}

interface PlanResponse {
  data: {
    plan: {
      name: string;
      displayName: string;
      type: string;
      interval: string;
      pricePerSeatCents: number;
      features?: { fee_dollars?: number; included?: string[] };
      isActive: boolean;
    };
    subscriptionId: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAt?: string;
    canceledAt?: string;
  };
  success: boolean;
}
```

## 6. 注意事项

1. **只有百分比**：没有剩余额度绝对值、token 数或逐模型用量；想显示"用了多少"只能自己做本地累计。
2. **不要按帧请求**：这两条是真实网络调用，适合命令触发或低频缓存（≥60s），不要在 render / message_update 里裸调。
3. **失败形态**：HTTP 200 但 `success: false`、或非 JSON 错误体都可能出现；解析前先判 `content-type`，超时用 `AbortSignal.timeout()`。
4. **端点可能变**：本手册基于 2026-10-02 实测；字段增删不做兼容承诺，UI 应对缺字段降级。
