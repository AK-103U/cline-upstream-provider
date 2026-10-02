/**
 * Cline Pass usage: one shared snapshot of the account's three rolling limit
 * windows (and, best effort, its plan and account line).
 *
 * The endpoints and their fields are documented in docs/cline-api.md and are
 * real network calls, so this module is the only place allowed to make them:
 * one 60s cache, at most one request in flight, a floor between user-requested
 * refreshes, and an escalating wait after a failure. Every failure keeps the
 * last good snapshot and says it is stale rather than blanking the UI.
 *
 * The authorization header is produced by the caller (the plugin already knows
 * how to resolve the Cline route's key) and never leaves this process: nothing
 * returned here carries the key, and the account's e-mail is offered both raw
 * and masked.
 */

/** The gateway's API root — the same host the plugin observes traffic on. */
export const CLINE_API = 'https://api.cline.bot/api/v1';
/** How long a snapshot answers without a request. */
export const USAGE_TTL = 60000;
/** Floor between two user-requested refreshes, so a held button cannot hammer the gateway. */
export const FORCE_FLOOR = 10000;
/** Floor between two opportunistic refreshes after observed Cline traffic. */
export const WARM_FLOOR = 300000;
/** One read's whole budget. */
export const USAGE_TIMEOUT = 10000;
/** Waits after consecutive failures, in order; the last value repeats. */
export const FAILURE_WAITS = [60000, 120000, 300000];
/** The three windows the endpoint states, in display order. */
export const LIMIT_TYPES = ['five_hour', 'weekly', 'monthly'];

/**
 * Narrow an unknown value to a string-keyed record.
 * @param value - any value.
 * @returns the record, or undefined.
 */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

/**
 * One non-empty string.
 * @param value - any value.
 * @returns the string, or undefined.
 */
function text(value) {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Mask an e-mail for display: keep at most two leading characters and the domain.
 * @param email - the raw address.
 * @returns the masked address; an address without `@` is returned unchanged.
 */
export function maskEmail(email) {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/**
 * A `YYYY-MM-DD` slice of an ISO timestamp, for a compact period range.
 * @param value - an ISO timestamp.
 * @returns the date part, or undefined.
 */
function shortDate(value) {
  const iso = text(value);
  return iso === undefined || iso.length < 10 ? undefined : iso.slice(0, 10);
}

/**
 * The three windows of a `usage-limits` payload, in the endpoint's own order.
 * An unknown window type is dropped, a missing percentage reads as 0, and an
 * unparsable reset time keeps the window but drops its countdown.
 * @param payload - `data` of GET /users/me/plan/usage-limits.
 * @returns the windows, possibly empty.
 */
export function windowsOf(payload) {
  const list = record(payload)?.limits;
  const found = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const item = record(raw);
    const type = text(item?.type);
    if (type === undefined || !LIMIT_TYPES.includes(type)) continue;
    const percent = Number(item?.percentUsed);
    const resetsAt = text(item?.resetsAt);
    const resetsAtMs = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt);
    found.set(type, {
      type,
      percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
      resetsAt: resetsAt ?? '',
      resetsAtMs: Number.isFinite(resetsAtMs) ? resetsAtMs : undefined,
    });
  }
  return LIMIT_TYPES.filter((type) => found.has(type)).map((type) => found.get(type));
}

/**
 * The plan summary worth showing: the clean display name, the price, the
 * billing period, and whether the subscription was canceled. The internal name
 * (`[Internal]`) and the entitlement thresholds are deliberately not read: the
 * former is not for display, the latter are sentinel integers, not amounts.
 * @param payload - `data` of GET /users/me/plan.
 * @returns the summary, or undefined for an unusable payload.
 */
export function planOf(payload) {
  const data = record(payload);
  const plan = record(data?.plan);
  if (data === undefined || plan === undefined) return undefined;
  const cents = plan.pricePerSeatCents;
  return {
    displayName: text(plan.displayName) ?? text(plan.name),
    interval: text(plan.interval),
    pricePerSeatCents: typeof cents === 'number' && Number.isFinite(cents) ? cents : undefined,
    periodStart: shortDate(data.currentPeriodStart),
    periodEnd: shortDate(data.currentPeriodEnd),
    canceled: data.canceledAt !== undefined || data.cancelAt !== undefined,
  };
}

/**
 * The account line, masked and raw, so a caller can choose without asking twice.
 * @param payload - `data` of GET /users/me.
 * @returns the account line, or undefined when the payload carries neither field.
 */
export function accountOf(payload) {
  const data = record(payload);
  const email = data === undefined ? undefined : text(data.email);
  const displayName = data === undefined ? undefined : text(data.displayName);
  if (email === undefined && displayName === undefined) return undefined;
  return {
    email,
    maskedEmail: email === undefined ? undefined : maskEmail(email),
    displayName,
  };
}

/**
 * Read one endpoint, insisting on the gateway's own success envelope.
 * @param fetcher - the fetch to call.
 * @param path - endpoint path below the API root.
 * @param authorization - the ready authorization header value.
 * @returns the payload's `data`.
 * @throws Error carrying the gateway's message, or the HTTP status.
 */
async function readJson(fetcher, path, authorization) {
  const response = await fetcher(CLINE_API + path, {
    headers: { authorization, accept: 'application/json' },
    signal: AbortSignal.timeout(USAGE_TIMEOUT),
  });
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const body = contentType.includes('json') ? await response.json().catch(() => undefined) : undefined;
  if (body === undefined) {
    throw new Error(response.ok ? 'unreadable response' : `HTTP ${response.status}`);
  }
  if (body.success !== true) {
    throw new Error(text(body.error) ?? `HTTP ${response.status}`);
  }
  return body.data;
}

/**
 * Turn one thrown read into the short reason the UI speaks.
 * @param error - the thrown value.
 * @returns a reason token, stable enough for the client to map to words.
 */
function reasonOf(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  if (/^HTTP 401$/.test(message)) return 'unauthorized';
  if (/^HTTP 403$/.test(message)) return 'forbidden';
  if (/^HTTP 429$/.test(message)) return 'rate-limited';
  if (/^HTTP 5\d\d$/.test(message)) return 'gateway';
  if (/^HTTP \d+$/.test(message)) return 'http';
  if (/fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT/i.test(message)) return 'network';
  if (message === 'unreadable response') return 'shape';
  if (message === 'empty usage-limits response') return 'shape';
  return 'gateway';
}

/**
 * A snapshot's user-facing state.
 * @returns the initial state: nothing read yet, nothing configured known.
 */
function blank() {
  return {
    state: 'loading',
    reason: undefined,
    fetchedAt: undefined,
    failedAt: undefined,
    stale: false,
    value: null,
  };
}

/**
 * The usage source: one cache, one in-flight read, one failure ladder.
 *
 * @param options - the read's collaborators.
 * @param options.authorize - resolves the ready `authorization` header value, or undefined.
 * @param options.explainMissing - names the configuration state when `authorize` finds nothing.
 * @param options.fetcher - the fetch to use; defaults to the global one.
 * @param options.now - the clock; defaults to `Date.now`.
 * @returns `{ read, snapshot, noteTraffic }`.
 */
export function createUsageSource(options) {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => Date.now());

  let snapshot = blank();
  let inflight;
  let lastAttempt = 0;
  let failures = 0;

  /**
   * Wait before the next attempt after the failures seen so far.
   * @returns milliseconds to wait.
   */
  function backoff() {
    return FAILURE_WAITS[Math.min(failures, FAILURE_WAITS.length) - 1] ?? 0;
  }

  /**
   * Whether a failure is too recent to retry.
   * @returns true while the ladder is still holding the read back.
   */
  function holding() {
    return failures > 0 && snapshot.failedAt !== undefined && now() - snapshot.failedAt < backoff();
  }

  /**
   * One real read, then the state it produces.
   * @param authorization - the ready authorization header value.
   * @returns the new snapshot value.
   */
  async function fetchUsage(authorization) {
    const [limits, plan, account] = await Promise.all([
      readJson(fetcher, '/users/me/plan/usage-limits', authorization),
      readJson(fetcher, '/users/me/plan', authorization).catch(() => undefined),
      readJson(fetcher, '/users/me', authorization).catch(() => undefined),
    ]);
    const windows = windowsOf(limits);
    if (windows.length === 0) throw new Error('empty usage-limits response');
    return { windows, plan: planOf(plan), account: accountOf(account) };
  }

  /**
   * Read the snapshot, making a request only when the cache, the force floor,
   * or the failure ladder allow one.
   * @param request - `force` for a user-requested refresh; `warm` for an opportunistic one.
   * @returns the snapshot the caller should serve.
   */
  async function read(request = {}) {
    const at = now();
    if (inflight !== undefined) return inflight;
    if (holding()) return snapshot;
    if (request.force !== true) {
      if (snapshot.fetchedAt !== undefined && at - snapshot.fetchedAt < USAGE_TTL) return snapshot;
      if (request.warm === true && snapshot.fetchedAt !== undefined && at - snapshot.fetchedAt < WARM_FLOOR) {
        return snapshot;
      }
    } else if (at - lastAttempt < FORCE_FLOOR) {
      return snapshot;
    }
    lastAttempt = at;

    inflight = (async () => {
      let authorization;
      try {
        authorization = await options.authorize();
      } catch {
        authorization = undefined;
      }
      if (authorization === undefined) {
        // No route and no key is a configuration state, not a failure: the UI
        // says what is missing instead of showing an error.
        const reason = options.explainMissing === undefined ? 'no-key' : options.explainMissing();
        snapshot = { state: 'unconfigured', reason, fetchedAt: snapshot.fetchedAt, failedAt: undefined, stale: false, value: snapshot.value };
        return snapshot;
      }
      try {
        const value = await fetchUsage(authorization);
        failures = 0;
        snapshot = { state: 'ready', reason: undefined, fetchedAt: now(), failedAt: undefined, stale: false, value };
      } catch (error) {
        failures += 1;
        snapshot = {
          state: snapshot.value === null ? 'error' : 'ready',
          reason: reasonOf(error),
          fetchedAt: snapshot.fetchedAt,
          failedAt: now(),
          stale: snapshot.value !== null,
          value: snapshot.value,
        };
      }
      return snapshot;
    })().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  /**
   * Announce real Cline traffic, so a snapshot the user is about to look at is
   * already warm. Never awaited by the caller: this rides the model call.
   */
  function noteTraffic() {
    void read({ warm: true }).catch(() => {});
  }

  return {
    read,
    noteTraffic,
    snapshot: () => snapshot,
  };
}
