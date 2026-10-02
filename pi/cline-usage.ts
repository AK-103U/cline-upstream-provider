/**
 * Cline Pass usage — the account half of the `cline-upstream-provider` pi
 * extension. Endpoints and response fields are documented in docs/cline-api.md.
 *
 * Read-only telemetry: it never touches the chat pipeline, and network access
 * is lazy and shared (one 60s cache, at most one in-flight request, background
 * refreshes throttle to five minutes).
 *
 * Surfaces (one slash command, `/cline-upstream-provider`):
 *   `/cline-upstream-provider`       TUI overlay panel: bilingual (`l` toggles),
 *                  account, live route chain, plan, the three limits with bars,
 *                  and an `n` switch for event notifications (persisted in
 *                  <agent-dir>/cline-usage.json); `q`/`esc` closes, `r` refreshes
 *   `/cline-upstream-provider route` prints the current upstream route chain as
 *                  a notification
 *   footer badge   `5h 8% · 7d 26% · 月 21%`, text-only, colored by level,
 *                  windows drop when the line runs out of width
 *   notifications  a window above 90%, plan canceled within a day of expiry,
 *                  fetch failure; at most once per state change per process,
 *                  and silenced entirely while the panel switch is off
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type ClineUsageBadgeTheme = { fg(color: string, text: string): string };

export type ClineUsageApi = {
  /** Footer segment for the cached snapshot, or undefined when unavailable. */
  getBadge(theme: ClineUsageBadgeTheme, maxWidth: number): string | undefined;
};

const CLINE_BASE_URL = "https://api.cline.bot/api/v1";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const REFRESH_THROTTLE_MS = 5 * 60_000;
const CANCEL_NOTICE_WINDOW_MS = 24 * 3_600_000;
const NOTIFY_ABOVE_PCT = 90;
const SETTINGS_FILE = "cline-usage.json";
const PANEL_WIDTH = 62;
const BAR_WIDTH = 18;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type Lang = "zh" | "en";
type LimitType = "five_hour" | "weekly" | "monthly";
type Level = "ok" | "warn" | "bad";

type UsageLimit = { type: LimitType; percentUsed: number; resetsAt: string };
type AccountInfo = { email?: string; displayName?: string };
type PlanSummary = {
  displayName?: string;
  pricePerSeatCents?: number;
  interval?: string;
  periodStart?: string;
  periodEnd?: string;
  /** Epoch ms of the exact period end, for the cancel notice window. */
  periodEndsAt?: number;
  canceled: boolean;
};
type UsageSnapshot = {
  limits: UsageLimit[];
  account: AccountInfo;
  plan?: PlanSummary;
  fetchedAt: number;
};

const LIMIT_ORDER: LimitType[] = ["five_hour", "weekly", "monthly"];

const LIMIT_LABELS: Record<Lang, Record<LimitType, string>> = {
  zh: { five_hour: "5h", weekly: "7d", monthly: "月" },
  en: { five_hour: "5h", weekly: "7d", monthly: "mo" },
};

const STRINGS = {
  zh: {
    loading: "额度加载中…",
    updated: "更新于",
    plan: "套餐",
    period: "周期",
    canceled: "已取消，到期后失效",
    route: "路由",
    routeEmpty: "尚未捕获到 cline-pass/* 的 Cline 路由",
    notify: "通知",
    notifyOn: "开 (n 切换)",
    notifyOff: "关 (n 切换)",
    close: "q/esc 关闭 · r 刷新 · l English",
    summary: "Cline 额度",
    noKey: "models.json 里没有 providers.cline.apiKey",
    empty: "usage-limits 返回为空",
    threshold: (label: string, pct: number, reset: string) =>
      `Cline ${label} 已用 ${pct}%（${reset}），注意节奏`,
    canceledNotice: (end?: string) => `Cline Pass 已取消${end ? ` · ${end} 到期后失效` : ""}`,
    error: (message: string) => `Cline 额度获取失败：${message}`,
  },
  en: {
    loading: "Loading usage…",
    updated: "Updated",
    plan: "Plan",
    period: "Period",
    canceled: "canceled, ends at period end",
    route: "Route",
    routeEmpty: "no cline-pass/* route captured yet",
    notify: "Notify",
    notifyOn: "on (n)",
    notifyOff: "off (n)",
    close: "q/esc close · r refresh · l 中文",
    summary: "Cline usage",
    noKey: "no providers.cline.apiKey in models.json",
    empty: "empty usage-limits response",
    threshold: (label: string, pct: number, reset: string) =>
      `Cline ${label} usage ${pct}% (${reset})`,
    canceledNotice: (end?: string) => `Cline Pass canceled${end ? ` · expires ${end}` : ""}`,
    error: (message: string) => `Cline usage fetch failed: ${message}`,
  },
};

function record(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, any>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detectLang(): Lang {
  const raw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
  const locale = raw || (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      return "";
    }
  })();
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function levelFor(percent: number): Level {
  if (percent >= 80) return "bad";
  if (percent >= 50) return "warn";
  return "ok";
}

function colorFor(level: Level): string {
  return level === "bad" ? "error" : level === "warn" ? "warning" : "success";
}

function barText(percent: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function sortedLimits(limits: UsageLimit[]): UsageLimit[] {
  return [...limits].sort((a, b) => LIMIT_ORDER.indexOf(a.type) - LIMIT_ORDER.indexOf(b.type));
}

function padVisible(text: string, width: number): string {
  return text + " ".repeat(Math.max(1, width - visibleWidth(text)));
}

function shortDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 10) return undefined;
  return `${value.slice(5, 7)}-${value.slice(8, 10)}`;
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

function displayEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  return process.env.PI_CLINE_USAGE_MASK === "1" ? maskEmail(email) : email;
}

function timeText(timestamp: number): string {
  const at = new Date(timestamp);
  const clock = [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return `${clock}.${String(at.getMilliseconds()).padStart(3, "0")}`;
}

function resetText(iso: string, lang: Lang): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "-";
  const ms = time - Date.now();
  if (ms <= 0) return lang === "zh" ? "即将重置" : "resets soon";
  const hours = ms / 3_600_000;
  if (hours < 24) {
    const at = new Date(time);
    const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    return lang === "zh" ? `${clock} 重置` : `resets ${clock}`;
  }
  const days = Math.ceil(hours / 24);
  return lang === "zh" ? `${days} 天后重置` : `resets in ${days}d`;
}

// models.json accepts `$ENV` interpolation and `!command` next to literals.
function clineApiKey(): string | undefined {
  try {
    const models = JSON.parse(readFileSync(join(getAgentDir(), "models.json"), "utf8"));
    const raw = models?.providers?.cline?.apiKey;
    if (typeof raw !== "string" || !raw) return undefined;
    if (raw.startsWith("!")) {
      return execSync(raw.slice(1), { encoding: "utf8", timeout: 5_000 }).trim() || undefined;
    }
    const env = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(raw);
    return env ? process.env[env[1]!] || undefined : raw;
  } catch {
    return undefined;
  }
}

type UsageSettings = { notifications: boolean };

function settingsPath(): string {
  return join(getAgentDir(), SETTINGS_FILE);
}

function readUsageSettings(): UsageSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8"));
    return { notifications: raw?.notifications !== false };
  } catch {
    return { notifications: true };
  }
}

function writeUsageSettings(settings: UsageSettings): void {
  try {
    writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch {
    // Best effort: the toggle still applies for this process.
  }
}

class UsageError extends Error {
  constructor(message: string, readonly silent = false) {
    super(message);
  }
}

async function fetchJson(path: string, key: string): Promise<any> {
  const response = await fetch(`${CLINE_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => undefined);
  if (!body || body.success !== true) {
    throw new Error(stringValue(body?.error) ?? `HTTP ${response.status}`);
  }
  return body.data;
}

export type ClineUsageOptions = {
  onChange?: () => void;
  /** Live upstream route chain for the panel and `route` subcommand, if captured. */
  route?: () => string | undefined;
};

export function registerClineUsage(
  pi: ExtensionAPI,
  options?: ClineUsageOptions,
): ClineUsageApi {
  const onChange = options?.onChange ?? (() => {});
  const routeSummary = options?.route;

  let lang: Lang | undefined;
  const getLang = (): Lang => (lang ??= detectLang());
  const toggleLang = () => {
    lang = getLang() === "zh" ? "en" : "zh";
  };

  let cache: UsageSnapshot | undefined;
  let inflight: Promise<UsageSnapshot> | undefined;
  const notified: { thresholds: Set<LimitType>; canceled?: string; error: boolean } = {
    thresholds: new Set(),
    error: false,
  };
  const usageSettings = readUsageSettings();
  const toggleNotifications = () => {
    usageSettings.notifications = !usageSettings.notifications;
    writeUsageSettings(usageSettings);
  };

  async function fetchUsage(): Promise<UsageSnapshot> {
    const key = clineApiKey();
    if (!key) throw new UsageError(STRINGS[getLang()].noKey, true);

    const [limitsData, planData, accountData] = await Promise.all([
      fetchJson("/users/me/plan/usage-limits", key),
      fetchJson("/users/me/plan", key).catch(() => undefined),
      fetchJson("/users/me", key).catch(() => undefined),
    ]);

    const limits: UsageLimit[] = [];
    for (const raw of Array.isArray(limitsData?.limits) ? limitsData.limits : []) {
      const item = record(raw);
      const type = item?.type;
      if (type !== "five_hour" && type !== "weekly" && type !== "monthly") continue;
      const percent = Number(item?.percentUsed);
      limits.push({
        type,
        percentUsed: Number.isFinite(percent) ? percent : 0,
        resetsAt: stringValue(item?.resetsAt) ?? "",
      });
    }
    if (limits.length === 0) throw new UsageError(STRINGS[getLang()].empty);

    const plan = record(planData?.plan);
    const account = record(accountData);
    const periodEndsAt = Date.parse(stringValue(planData?.currentPeriodEnd) ?? "");
    return {
      limits,
      account: {
        email: stringValue(account?.email),
        displayName: stringValue(account?.displayName),
      },
      plan: plan
        ? {
            displayName: stringValue(plan.displayName) ?? stringValue(plan.name),
            pricePerSeatCents:
              typeof plan.pricePerSeatCents === "number" ? plan.pricePerSeatCents : undefined,
            interval: stringValue(plan.interval),
            periodStart: shortDate(planData?.currentPeriodStart),
            periodEnd: shortDate(planData?.currentPeriodEnd),
            periodEndsAt: Number.isFinite(periodEndsAt) ? periodEndsAt : undefined,
            canceled: Boolean(planData?.canceledAt ?? planData?.cancelAt),
          }
        : undefined,
      fetchedAt: Date.now(),
    };
  }

  function notifyEvents(ctx: any, data: UsageSnapshot): void {
    if (!ctx?.hasUI || !usageSettings.notifications) return;
    const langNow = getLang();
    const strings = STRINGS[langNow];

    for (const limit of data.limits) {
      const percent = Math.round(limit.percentUsed);
      // A window that dropped below half has reset; allow the next crossing.
      if (percent < 50) {
        notified.thresholds.delete(limit.type);
        continue;
      }
      if (percent <= NOTIFY_ABOVE_PCT || notified.thresholds.has(limit.type)) continue;
      notified.thresholds.add(limit.type);
      ctx.ui.notify(
        strings.threshold(LIMIT_LABELS[langNow][limit.type], percent, resetText(limit.resetsAt, langNow)),
        "warning",
      );
    }

    // Only warn once the canceled plan is a day (or less) from expiring, and
    // only once per distinct expiry date, no matter how often we refetch or how
    // many sessions the process opens.
    const plan = data.plan;
    if (plan?.canceled && plan.periodEndsAt !== undefined) {
      const noticeKey = plan.periodEnd ?? "canceled";
      if (plan.periodEndsAt - Date.now() <= CANCEL_NOTICE_WINDOW_MS && notified.canceled !== noticeKey) {
        notified.canceled = noticeKey;
        ctx.ui.notify(strings.canceledNotice(plan.periodEnd), "warning");
      }
    }
  }

  async function load(ctx: any, force: boolean): Promise<UsageSnapshot> {
    if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
    if (inflight) return inflight;

    inflight = fetchUsage()
      .then((data) => {
        cache = data;
        notified.error = false;
        notifyEvents(ctx, data);
        onChange();
        return data;
      })
      .catch((error: unknown) => {
        const silent = error instanceof UsageError && error.silent;
        if (ctx?.hasUI && usageSettings.notifications && !silent && !notified.error) {
          notified.error = true;
          ctx.ui.notify(STRINGS[getLang()].error(errorText(error)), "error");
        }
        throw error;
      })
      .finally(() => {
        inflight = undefined;
      });

    return inflight;
  }

  function summaryLine(data: UsageSnapshot): string {
    const langNow = getLang();
    const badge = sortedLimits(data.limits)
      .map((limit) => `${LIMIT_LABELS[langNow][limit.type]} ${Math.round(limit.percentUsed)}%`)
      .join(" · ");
    return [STRINGS[langNow].summary, displayEmail(data.account.email), badge]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }

  class UsagePanel {
    private data?: UsageSnapshot;
    private error?: string;
    private loading = false;
    private closed = false;
    private frame = 0;
    private spinner?: ReturnType<typeof setInterval>;

    constructor(
      private readonly tui: any,
      private readonly theme: any,
      private readonly ctx: any,
      private readonly done: () => void,
    ) {
      this.data = cache;
      if (!this.data) void this.refresh();
    }

    invalidate(): void {}

    private close(): void {
      if (this.closed) return;
      this.closed = true;
      this.stopSpinner();
      this.done();
    }

    private startSpinner(): void {
      if (this.spinner) return;
      this.spinner = setInterval(() => {
        this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
        if (!this.closed) this.tui.requestRender();
      }, 80);
    }

    private stopSpinner(): void {
      if (!this.spinner) return;
      clearInterval(this.spinner);
      this.spinner = undefined;
    }

    handleInput(input: string): void {
      if (matchesKey(input, "escape") || matchesKey(input, "ctrl+c") || input === "q") {
        return this.close();
      }
      if (input === "r") return void this.refresh();
      if (input === "l") {
        toggleLang();
        onChange();
        this.tui.requestRender();
      }
      if (input === "n") {
        toggleNotifications();
        this.tui.requestRender();
      }
    }

    private async refresh(): Promise<void> {
      this.loading = true;
      this.error = undefined;
      this.startSpinner();
      this.tui.requestRender();
      try {
        this.data = await load(this.ctx, true);
      } catch (error) {
        this.error = errorText(error);
      } finally {
        this.loading = false;
        this.stopSpinner();
        if (!this.closed) this.tui.requestRender();
      }
    }

    render(width: number): string[] {
      const theme = this.theme;
      const langNow = getLang();
      const strings = STRINGS[langNow];
      const inner = Math.max(12, width - 4);
      const fit = (text: string) => {
        const fitted = truncateToWidth(text, inner);
        return fitted + " ".repeat(Math.max(0, inner - visibleWidth(fitted)));
      };
      const row = (text = "") =>
        `${theme.fg("accent", "│")} ${fit(text)} ${theme.fg("accent", "│")}`;

      const lines: string[] = [
        theme.fg("accent", `╭─ Cline Pass ${"─".repeat(Math.max(0, inner - 11))}╮`),
        row(),
      ];

      if (this.data) {
        const email = displayEmail(this.data.account.email);
        const name = this.data.account.displayName;
        lines.push(row(`👤 ${
          langNow === "zh"
            ? `${name ? `${name} · ` : ""}${email ?? "?"}`
            : `Account  ${email ?? "?"}`
        }`));
        lines.push(row());

        const routeText = routeSummary?.();
        if (routeText) {
          lines.push(row(`${theme.fg("muted", padVisible(strings.route, 8))}${routeText}`));
          lines.push(row());
        }

        for (const limit of sortedLimits(this.data.limits)) {
          const percent = Math.round(limit.percentUsed);
          const color = colorFor(levelFor(percent));
          lines.push(row(
            `  ${theme.fg("muted", padVisible(LIMIT_LABELS[langNow][limit.type], 4))}` +
            `${theme.fg(color, barText(percent, BAR_WIDTH))}  ` +
            `${theme.fg(color, `${String(percent).padStart(3)}%`)}  ` +
            theme.fg("muted", resetText(limit.resetsAt, langNow)),
          ));
        }
        lines.push(row());

        const plan = this.data.plan;
        if (plan) {
          const price = typeof plan.pricePerSeatCents === "number"
            ? `$${(plan.pricePerSeatCents / 100).toFixed(2)}${plan.interval ? `/${plan.interval}` : ""}`
            : undefined;
          lines.push(row(
            `${theme.fg("muted", padVisible(strings.plan, 8))}` +
            [plan.displayName, price].filter(Boolean).join(" · "),
          ));
          const range = plan.periodStart && plan.periodEnd
            ? `${plan.periodStart} → ${plan.periodEnd}`
            : plan.periodEnd ?? plan.periodStart;
          const period = [range, plan.canceled ? strings.canceled : undefined]
            .filter(Boolean)
            .join(" · ");
          if (period) {
            lines.push(row(`${theme.fg("muted", padVisible(strings.period, 8))}${period}`));
          }
          lines.push(row());
        }

        lines.push(row(
          this.error
            ? theme.fg("error", `⚠ ${this.error}`)
            : theme.fg("dim",
                `${padVisible(strings.updated, 8)}${timeText(this.data.fetchedAt)}` +
                (this.loading ? `  ${SPINNER_FRAMES[this.frame]}` : "")),
        ));
        lines.push(row());
      } else {
        lines.push(
          row(),
          row(this.error
            ? theme.fg("error", `⚠ ${this.error}`)
            : theme.fg("muted", `${SPINNER_FRAMES[this.frame]} ${strings.loading}`)),
          row(),
        );
      }

      lines.push(row(
        theme.fg("muted", padVisible(strings.notify, 8)) +
        theme.fg(usageSettings.notifications ? "success" : "dim",
          usageSettings.notifications ? strings.notifyOn : strings.notifyOff),
      ));
      lines.push(row());

      const hint = truncateToWidth(strings.close, Math.max(0, width - 6));
      lines.push(
        `${theme.fg("accent", "╰─")} ${hint} ` +
        theme.fg("accent", `${"─".repeat(Math.max(0, width - visibleWidth(hint) - 5))}╯`),
      );
      return lines;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) void load(ctx, false).catch(() => {});
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (cache && Date.now() - cache.fetchedAt < REFRESH_THROTTLE_MS) return;
    void load(ctx, false).catch(() => {});
  });

  pi.registerCommand("cline-upstream-provider", {
    description: "Cline Pass panel, or `route` for the upstream chain",
    getArgumentCompletions: (prefix) => {
      const matches = ["usage", "route"].filter((value) => value.startsWith(prefix.toLowerCase()));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const sub = args.trim().toLowerCase();
      if (sub === "route" || sub === "r") {
        const summary = routeSummary?.();
        ctx.ui.notify(summary ?? STRINGS[getLang()].routeEmpty, "info");
        return;
      }

      if (ctx.mode !== "tui" || !ctx.hasUI) {
        try {
          ctx.ui.notify(summaryLine(await load(ctx, false)), "info");
        } catch (error) {
          // Non-silent failures were already announced by load(); when event
          // notifications are off, the explicit command still reports them.
          const silent = error instanceof UsageError && error.silent;
          if (silent || !usageSettings.notifications) {
            ctx.ui.notify(STRINGS[getLang()].error(errorText(error)), "error");
          }
        }
        return;
      }

      await ctx.ui.custom<void>((tui, theme, _kb, done) => new UsagePanel(tui, theme, ctx, done), {
        overlay: true,
        overlayOptions: { anchor: "center", width: PANEL_WIDTH, maxHeight: 20 },
      });
    },
  });

  return {
    getBadge(theme, maxWidth) {
      if (!cache || maxWidth <= 0) return undefined;
      const langNow = getLang();
      const pieces = sortedLimits(cache.limits).map((limit) => ({
        text: `${LIMIT_LABELS[langNow][limit.type]} ${Math.round(limit.percentUsed)}%`,
        level: levelFor(limit.percentUsed),
      }));
      // Drop the wider windows instead of cutting the badge mid-percentage.
      for (let count = pieces.length; count > 0; count--) {
        const styled = pieces
          .slice(0, count)
          .map((piece) => theme.fg(colorFor(piece.level), piece.text))
          .join(theme.fg("dim", " · "));
        if (visibleWidth(styled) <= maxWidth) return styled;
      }
      return undefined;
    },
  };
}
