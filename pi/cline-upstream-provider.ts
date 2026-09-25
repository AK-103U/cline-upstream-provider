/**
 * Cline upstream provider — the pi half of the `cline-upstream-provider` repo.
 *
 * Shows which upstream provider Cline's gateway actually routed to. It is a
 * monitor only: it does not register or replace a provider, and the request the
 * provider sends is untouched. The normal pi message is observed, and for exact
 * pipeline detection the raw Cline SSE/JSON response is observed before pi
 * consumes it (that raw body is the only place the gateway's decision exists).
 *
 * Install:
 *   pi install npm:@ak-103u/cline-upstream-provider
 *   pi install git:github.com/AK-103U/cline-upstream-provider
 *   pi -e ./extensions/index.ts                 # try once, without settings
 *   # or copy ./pi/cline-upstream-provider.ts into ~/.pi/agent/extensions/
 *
 * It replaces pi's default footer with two lines:
 *   line 1: cwd, git branch, model, and the Cline route chain
 *           (spinner-prefixed while the agent is running)
 *   line 2: context usage, tokens, cache usage, and cost (left)
 *           plus the last-response throughput (right-aligned)
 *
 * The DeepSeek Harness half of the same repository shows the same decision under
 * the composer, per Session; see the repository README.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const CLINE_CHAT_URL = "https://api.cline.bot/api/v1/chat/completions";
const CLINE_BASE_URL = "https://api.cline.bot/api/v1";
const ROUTE_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEBUG = process.env.PI_CLINE_ROUTE_DEBUG === "1";

type Pipeline = "direct" | "planner" | "unknown";

type RouteInfo = {
  upstream: string;
  pipeline: Pipeline;
  responseModel?: string;
};

type Routing = {
  finalProvider?: unknown;
};

type Capture = {
  createdAt: number;
  requestId: number;
  responseModel?: string;
  route?: RouteInfo;
  claimed: boolean;
  notifiedRoute?: string;
  onRoute: (route: RouteInfo) => void;
  done: Promise<void>;
  resolveDone: () => void;
};

type AssistantLike = {
  role?: string;
  provider?: string;
  model?: string;
  responseModel?: string;
  stopReason?: string;
};

function record(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, any>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function isClineChatUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "api.cline.bot" &&
      normalizeUrl(url.pathname) === "/api/v1/chat/completions";
  } catch {
    return false;
  }
}

function isClineBaseUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "api.cline.bot" &&
      normalizeUrl(url.pathname) === "/api/v1";
  } catch {
    return normalizeUrl(value) === CLINE_BASE_URL;
  }
}

function requestUrl(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  const object = record(input);
  return stringValue(object?.url);
}

function unwrap(value: unknown): Record<string, any> | undefined {
  const root = record(value);
  const data = record(root?.data);
  if (data && (data.choices || data.model || data.object)) return data;
  return root;
}

function responseModelFrom(value: Record<string, any>): string | undefined {
  return stringValue(value.model) ??
    stringValue(value.responseModel) ??
    stringValue(value.choices?.[0]?.message?.model) ??
    stringValue(value.choices?.[0]?.delta?.model);
}

function routingFrom(value: Record<string, any>): Routing | undefined {
  const candidates: unknown[] = [
    value.provider_metadata?.gateway?.routing,
    value.providerMetadata?.gateway?.routing,
    value.message?.provider_metadata?.gateway?.routing,
    value.message?.providerMetadata?.gateway?.routing,
    value.choices?.[0]?.message?.provider_metadata?.gateway?.routing,
    value.choices?.[0]?.message?.providerMetadata?.gateway?.routing,
    value.choices?.[0]?.delta?.provider_metadata?.gateway?.routing,
    value.choices?.[0]?.delta?.providerMetadata?.gateway?.routing,
  ];

  for (const candidate of candidates) {
    const routing = record(candidate);
    if (routing) return routing as Routing;
  }
  return undefined;
}

function directProviderFrom(value: Record<string, any>): string | undefined {
  return stringValue(value.provider) ??
    stringValue(value.message?.provider) ??
    stringValue(value.choices?.[0]?.message?.provider) ??
    stringValue(value.choices?.[0]?.delta?.provider);
}

function upstreamFromResponseModel(responseModel: string | undefined): string | undefined {
  if (!responseModel) return undefined;
  const slash = responseModel.indexOf("/");
  return slash > 0 ? responseModel.slice(0, slash) : responseModel;
}

function routeKey(route: RouteInfo): string {
  return `${route.upstream}\u0000${route.pipeline}`;
}

function publishRoute(capture: Capture): void {
  if (!capture.route) return;
  const key = `${capture.route.upstream}\u0000${capture.route.pipeline}\u0000${capture.route.responseModel ?? ""}`;
  if (capture.notifiedRoute === key) return;
  capture.notifiedRoute = key;
  capture.onRoute(capture.route);
}

function inspectPayload(value: unknown, capture: Capture): boolean {
  const root = record(value);
  if (!root) return false;

  const candidates = [root, unwrap(root)].filter(
    (candidate): candidate is Record<string, any> => Boolean(candidate),
  );

  let foundRoute = false;
  for (const candidate of candidates) {
    const responseModel = responseModelFrom(candidate);
    if (responseModel) capture.responseModel = responseModel;

    // Planner has the authoritative finalProvider. Prefer it over all fallback
    // guesses because this is the value selected by Vercel AI Gateway.
    const routing = routingFrom(candidate);
    const finalProvider = stringValue(routing?.finalProvider);
    if (finalProvider) {
      capture.route = {
        upstream: finalProvider,
        pipeline: "planner",
        responseModel: capture.responseModel,
      };
      foundRoute = true;
      continue;
    }

    // Direct/OpenRouter responses expose the provider at the response level.
    const provider = directProviderFrom(candidate);
    if (provider && !capture.route) {
      capture.route = {
        upstream: provider,
        pipeline: "direct",
        responseModel: capture.responseModel,
      };
      foundRoute = true;
    }
  }

  publishRoute(capture);
  return foundRoute;
}

function finishRoute(capture: Capture): void {
  if (capture.route) {
    capture.route.responseModel ??= capture.responseModel;
    publishRoute(capture);
    return;
  }

  const upstream = upstreamFromResponseModel(capture.responseModel);
  if (upstream) {
    capture.route = {
      upstream,
      pipeline: "unknown",
      responseModel: capture.responseModel,
    };
    publishRoute(capture);
  }
}

function parseSseLine(line: string, capture: Capture): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return false;

  const data = trimmed.slice("data:".length).trim();
  if (!data || data === "[DONE]") return false;

  try {
    return inspectPayload(JSON.parse(data), capture);
  } catch {
    return false;
  }
}

async function inspectResponse(response: Response, capture: Capture): Promise<void> {
  try {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    // SSE is used by normal pi requests. Read the clone incrementally so the
    // original response body remains untouched for pi.
    if (contentType.includes("text/event-stream") && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let directFound = false;

      while (true) {
        const part = await reader.read();
        if (part.done) break;

        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (parseSseLine(line, capture) && capture.route?.pipeline === "direct") {
            // Direct responses include provider in the first chunks. We do not
            // need to duplicate the rest of a potentially large completion.
            directFound = true;
            break;
          }
        }
        if (directFound) {
          await reader.cancel();
          break;
        }
      }

      if (!directFound && buffer) parseSseLine(buffer, capture);
      finishRoute(capture);
      return;
    }

    const text = await response.text();
    if (text) {
      try {
        inspectPayload(JSON.parse(text), capture);
      } catch {
        // Non-JSON error bodies do not contain routing metadata.
      }
    }
    finishRoute(capture);
  } catch (error) {
    if (DEBUG) console.error(`[cline-route] raw response inspection failed: ${String(error)}`);
    finishRoute(capture);
  }
}

function waitFor<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
}

type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

function numericValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addUsage(value: unknown, totals: UsageTotals): void {
  const usage = record(value);
  if (!usage) return;
  totals.input += numericValue(usage.input);
  totals.output += numericValue(usage.output);
  totals.cacheRead += numericValue(usage.cacheRead);
  totals.cacheWrite += numericValue(usage.cacheWrite);

  const cost = record(usage.cost);
  if (!cost) return;
  if (typeof cost.total === "number" && Number.isFinite(cost.total)) {
    totals.cost += cost.total;
  } else {
    totals.cost += numericValue(cost.input) + numericValue(cost.output) +
      numericValue(cost.cacheRead) + numericValue(cost.cacheWrite);
  }
}

function usageTotals(ctx: any): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const entry of ctx.sessionManager.getBranch()) {
    const item = record(entry);
    if (!item) continue;

    if (item.type === "message") {
      const message = record(item.message);
      if (message?.role === "assistant") addUsage(message.usage, totals);
    } else if (item.type === "usage" || item.type === "compaction" || item.type === "branch_summary") {
      addUsage(item.usage, totals);
    }
  }
  return totals;
}

function formatTokenCount(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1000) return `${Math.round(value)}`;
  if (abs < 1_000_000) {
    const thousands = value / 1000;
    const text = thousands.toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, "");
    if (text !== "1000") return `${text}k`;
  }
  const millions = value / 1_000_000;
  return `${millions.toFixed(1).replace(/\.0$/, "")}M`;
}

// Cache R/W always reads in millions with two decimals so the scale stays
// comparable at a glance, even for small sessions.
function formatCacheTokens(value: number): string {
  return `${(value / 1_000_000).toFixed(2)}M`;
}

function formatThroughput(value: number): string {
  return value >= 10 ? `${Math.round(value)}` : value.toFixed(1);
}

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const text = Number.isInteger(millions) || millions >= 10
      ? `${Math.round(millions)}`
      : millions.toFixed(1);
    return `${text.replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1000)}K`;
  return `${Math.round(value)}`;
}

function formatPath(cwd: string): string {
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (!home) return cwd;
  const rest = cwd.slice(home.length);
  if (cwd.toLowerCase().startsWith(home.toLowerCase()) &&
      (!rest || rest.startsWith("/") || rest.startsWith("\\"))) {
    return `~${rest}`;
  }
  return cwd;
}

function formatContext(ctx: any): string {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  if (!contextWindow) return "?";
  const window = formatContextWindow(contextWindow);
  if (!usage || typeof usage.percent !== "number") return `? / ${window}`;
  return `${usage.percent.toFixed(1)}% / ${window}`;
}

function alignLeftAndRight(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  if (!right) return truncateToWidth(left, width);
  const rightLimit = Math.max(1, Math.min(visibleWidth(right), Math.floor(width * 0.45)));
  const fittedRight = truncateToWidth(right, rightLimit);
  const leftLimit = Math.max(0, width - visibleWidth(fittedRight) - 1);
  const fittedLeft = truncateToWidth(left, leftLimit);
  const gap = Math.max(0, width - visibleWidth(fittedLeft) - visibleWidth(fittedRight));
  return truncateToWidth(`${fittedLeft}${" ".repeat(gap)}${fittedRight}`, width);
}

export default function (pi: ExtensionAPI) {
  const captures: Capture[] = [];
  const originalFetch = globalThis.fetch;
  let wrappedFetch: typeof fetch;
  let nextClineRequest = 0;
  let latestClineRequest = 0;
  let routeChain: RouteInfo[] = [];
  let routeChainTruncated = false;
  let routeRunning = false;
  let routeSpinnerIndex = 0;
  let routeSpinnerTimer: ReturnType<typeof setInterval> | undefined;
  let requestFooterRender: (() => void) | undefined;
  let streamStartedAt: number | undefined;
  let firstChunkAt: number | undefined;
  let liveThroughput: number | undefined;
  let lastThroughput: number | undefined;
  let lastThroughputRender = 0;

  const refreshFooter = () => requestFooterRender?.();
  const stopRouteSpinner = () => {
    if (routeSpinnerTimer) {
      clearInterval(routeSpinnerTimer);
      routeSpinnerTimer = undefined;
    }
  };
  const startRouteSpinner = () => {
    routeSpinnerIndex = 0;
    stopRouteSpinner();
    routeSpinnerTimer = setInterval(() => {
      if (!routeRunning) {
        stopRouteSpinner();
        return;
      }
      routeSpinnerIndex = (routeSpinnerIndex + 1) % ROUTE_SPINNER_FRAMES.length;
      refreshFooter();
    }, 80);
    refreshFooter();
  };
  // Route history for the current run. Consecutive duplicates are ignored, and
  // only the last three entries are kept so long tool loops stay bounded.
  const pushRoute = (route: RouteInfo) => {
    const last = routeChain[routeChain.length - 1];
    if (last && routeKey(last) === routeKey(route)) return;
    routeChain.push(route);
    if (routeChain.length > 3) {
      routeChain.shift();
      routeChainTruncated = true;
    }
    refreshFooter();
  };
  // Pipelines are dropped once the label becomes a chain, except when two
  // adjacent entries share an upstream (then they are needed to tell them apart).
  const formatRouteChain = () => {
    const text = routeChain.map((route, index) => {
      const ambiguous = routeChain.length === 1 ||
        routeChain[index - 1]?.upstream === route.upstream ||
        routeChain[index + 1]?.upstream === route.upstream;
      return ambiguous ? `${route.upstream} (${route.pipeline})` : route.upstream;
    }).join(" → ");
    return routeChainTruncated ? `… → ${text}` : text;
  };
  const createCapture = (response: Response, requestId: number): Capture => {
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const capture: Capture = {
      createdAt: Date.now(),
      requestId,
      claimed: false,
      onRoute: (route) => {
        if (requestId !== latestClineRequest) return;
        pushRoute(route);
        if (DEBUG) {
          console.error(
            `[cline-route] 🔀 Cline → ${route.upstream} (${route.pipeline}) ` +
            `responseModel=${route.responseModel ?? "-"}`,
          );
        }
      },
      done,
      resolveDone,
    };

    let clone: Response;
    try {
      clone = response.clone();
    } catch {
      finishRoute(capture);
      capture.resolveDone();
      return capture;
    }

    void inspectResponse(clone, capture)
      .catch((error) => {
        if (DEBUG) console.error(`[cline-route] inspection error: ${String(error)}`);
        finishRoute(capture);
      })
      .finally(() => {
        capture.resolveDone();
      });

    return capture;
  };

  wrappedFetch = async (input, init) => {
    const url = requestUrl(input);
    const requestId = url && isClineChatUrl(url) ? ++nextClineRequest : 0;
    // Sticky route: another sub-request inside the same run must not clear the
    // current label or restart the spinner.
    if (requestId) latestClineRequest = requestId;

    const response = await originalFetch(input, init);

    if (requestId) {
      captures.push(createCapture(response, requestId));
      // Keep memory bounded if a long-lived pi process makes many requests.
      while (captures.length > 32) captures.shift();
    }

    return response;
  };

  // The provider is still pi's normal provider. This wrapper only clones the
  // Cline response body for observation and returns the untouched response.
  globalThis.fetch = wrappedFetch;

  const providerUsesCline = (ctx: any, providerId: string | undefined): boolean => {
    if (!providerId) return false;
    try {
      const provider = ctx.modelRegistry?.getProvider?.(providerId);
      return isClineBaseUrl(provider?.baseUrl ?? provider?.baseURL);
    } catch {
      return false;
    }
  };

  pi.on("session_start", (_event, ctx) => {
    captures.length = 0;
    latestClineRequest = 0;
    routeChain = [];
    routeChainTruncated = false;
    routeRunning = false;
    streamStartedAt = undefined;
    firstChunkAt = undefined;
    liveThroughput = undefined;
    lastThroughput = undefined;
    stopRouteSpinner();
    refreshFooter();

    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const renderFooter = () => tui.requestRender();
      requestFooterRender = renderFooter;
      const unsubscribeBranch = footerData.onBranchChange(renderFooter);

      return {
        dispose: () => {
          unsubscribeBranch();
          if (requestFooterRender === renderFooter) requestFooterRender = undefined;
        },
        invalidate: () => {},
        render: (width: number): string[] => {
          const branch = footerData.getGitBranch();
          const model = ctx.model?.id ?? "no model";
          const left = [
            theme.fg("accent", `📁 ${formatPath(ctx.cwd)}`),
            branch ? theme.fg("success", `🌿 ${branch}`) : undefined,
            theme.fg("muted", `🤖 ${model}`),
          ].filter((part): part is string => Boolean(part)).join(theme.fg("dim", "  │  "));

          const routeText = routeChain.length > 0 ? formatRouteChain() : "";
          const routeLabel = routeRunning
            ? `${ROUTE_SPINNER_FRAMES[routeSpinnerIndex]}${routeText ? ` ${routeText}` : ""}`
            : routeText;
          const right = routeLabel ? theme.fg("accent", routeLabel) : "";
          const firstLine = alignLeftAndRight(left, right, width);

          const totals = usageTotals(ctx);
          const secondLeft = [
            theme.fg("accent", formatContext(ctx)),
            theme.fg("success", `↑${formatTokenCount(totals.input)} ↓${formatTokenCount(totals.output)} tokens`),
            theme.fg("muted", totals.cacheWrite > 0
              ? `R ${formatCacheTokens(totals.cacheRead)} / W ${formatCacheTokens(totals.cacheWrite)}`
              : `R ${formatCacheTokens(totals.cacheRead)}`),
            // Hide the cost entirely when the rounded display would be $0.000.
            totals.cost >= 0.0005 ? theme.fg("warning", `$${totals.cost.toFixed(3)}`) : undefined,
          ].filter((part): part is string => Boolean(part)).join(theme.fg("dim", "  │  "));

          const throughput = liveThroughput ?? lastThroughput;
          const throughputLabel = throughput !== undefined
            ? theme.fg("accent", `⚡ ${formatThroughput(throughput)} tok/s`)
            : "";

          return [
            firstLine,
            alignLeftAndRight(secondLeft, throughputLabel, width),
          ];
        },
      };
    });
  });

  const findCapture = async (message: AssistantLike): Promise<Capture | undefined> => {
    const targetModel = stringValue(message.responseModel);
    const deadline = Date.now() + 1200;

    while (Date.now() < deadline) {
      const exact = [...captures].reverse().find(
        (capture) => !capture.claimed &&
          targetModel &&
          capture.responseModel === targetModel,
      );
      const candidate = exact ?? [...captures].reverse().find(
        (capture) => !capture.claimed && Date.now() - capture.createdAt < 30_000,
      );

      if (candidate) {
        candidate.claimed = true;
        await waitFor(candidate.done, Math.max(50, deadline - Date.now()));
        return candidate;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return undefined;
  };

  pi.on("agent_start", () => {
    // A new run starts a fresh chain, but the previous route stays visible
    // until the first sub-request of this run resolves.
    routeChain = routeChain.slice(-1);
    routeChainTruncated = false;
    routeRunning = true;
    startRouteSpinner();
  });

  pi.on("agent_settled", () => {
    routeRunning = false;
    stopRouteSpinner();
    refreshFooter();
  });

  pi.on("model_select", () => refreshFooter());

  pi.on("message_start", (event) => {
    const message = event.message as AssistantLike | undefined;
    if (message?.role !== "assistant") return;
    streamStartedAt = Date.now();
    firstChunkAt = undefined;
    liveThroughput = undefined;
  });

  pi.on("message_update", (event) => {
    const message = event.message as AssistantLike | undefined;
    if (message?.role !== "assistant") return;

    const now = Date.now();
    streamStartedAt ??= now;
    firstChunkAt ??= now;

    const output = numericValue(record(message)?.usage?.output);
    if (output > 0) {
      const seconds = (now - firstChunkAt) / 1000;
      if (seconds >= 0.1) liveThroughput = output / seconds;
    }

    // At most ~5 footer renders per second while streaming; usageTotals scans
    // the whole branch, so rendering on every delta would be wasteful.
    if (now - lastThroughputRender >= 200) {
      lastThroughputRender = now;
      refreshFooter();
    }
  });

  pi.on("message_end", (event) => {
    const message = event.message as AssistantLike | undefined;
    if (message?.role === "assistant") {
      const output = numericValue(record(message)?.usage?.output);
      const reference = firstChunkAt ?? streamStartedAt;
      const seconds = reference ? (Date.now() - reference) / 1000 : 0;
      // Decode speed: output tokens over the time from first chunk to finish.
      if (output > 0 && seconds >= 0.1) lastThroughput = output / seconds;
    }
    streamStartedAt = undefined;
    firstChunkAt = undefined;
    liveThroughput = undefined;
    refreshFooter();
  });

  pi.on("message_end", async (event, ctx) => {
    const message = event.message as AssistantLike | undefined;
    if (!message || message.role !== "assistant") return;
    if (!message.model?.toLowerCase().startsWith("cline-pass/")) return;

    const capture = await findCapture(message);
    const isCline = Boolean(capture) || providerUsesCline(ctx, message.provider);
    if (!isCline) return;

    let route = capture?.route;
    if (!route) {
      const responseModel = stringValue(message.responseModel);
      const upstream = upstreamFromResponseModel(responseModel);
      if (!upstream) return;
      route = {
        upstream,
        pipeline: "unknown",
        responseModel,
      };
    }

    const requestId = capture?.requestId ?? latestClineRequest;
    if (requestId === latestClineRequest) pushRoute(route);
    if (DEBUG) {
      console.error(`[cline-route] 🔀 Cline → ${route.upstream} (${route.pipeline}) responseModel=${route.responseModel ?? "-"}`);
    }
  });

  pi.registerCommand("cline-route", {
    description: "Show the Cline Pass upstream route chain",
    handler: async (_args, ctx) => {
      if (routeChain.length > 0) {
        ctx.ui.notify(formatRouteChain(), "info");
      } else {
        ctx.ui.notify("尚未捕获到 cline-pass/* 的 Cline 路由", "info");
      }
    },
  });

  pi.on("session_shutdown", () => {
    routeRunning = false;
    stopRouteSpinner();
    requestFooterRender = undefined;
    if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
  });
}
