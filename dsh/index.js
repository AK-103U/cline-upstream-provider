/**
 * Host half: report the upstream providers Cline's gateway routed to, per Session,
 * and serve the marks that identify them.
 *
 * Cline states its routing decision only inside the response body, and in two shapes:
 *   - planner pipeline (Vercel AI Gateway):
 *       choices[0].delta.provider_metadata.gateway.routing.finalProvider
 *   - direct pipeline (OpenRouter): top-level `provider`
 * Nothing durable keeps the value, and a raw response carries no Session identity,
 * so this half listens to `llm/stream` first: that waterfall sees the exact
 * `sessionId` of every model call, which makes each observed response attributable
 * to the Session that asked for it.
 *
 * It also owns the optional pin: one channel the profile prefers, or insists on, for
 * Cline calls. The pin is written into the request where it is already serialized —
 * the same `fetch` wrapper that observes the answer — because pi-ai's routing compat
 * fields (`openRouterRouting` / `vercelGatewayRouting`) are withheld by the shipped
 * profile gate, so no profile can declare them and the wire is what is left. With no
 * pin the wrapper forwards the request untouched, byte for byte.
 *
 * Finally it serves the account's Cline Pass usage: the three rolling limit windows,
 * the plan line, and the account line, read from the gateway's account endpoints with
 * the same key this profile uses for model calls (docs/cline-api.md). That read is the
 * only one this plugin makes on its own behalf, so it lives in ./host/usage.js with its
 * own cache, in-flight sharing and failure ladder — and the key never leaves this file.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { channelListOf, probeBodies, probeReasonOf } from './host/probe.js';
import { createUsageSource } from './host/usage.js';

/** The only endpoint whose responses carry a Cline route decision. */
const CLINE_CHAT = { protocol: 'https:', hostname: 'api.cline.bot', pathname: '/api/v1/chat/completions' };
/** Page-facing read routes, served inside Connection's authenticated /api fence. */
const ROUTE_PATH = '/api/cline-upstream-provider';
const ICON_PATH = '/api/cline-upstream-provider/icon';
const CHANNELS_PATH = '/api/cline-upstream-provider/channels';
/** Read or replace the pin: `GET` answers the state, `POST` writes one. */
const PIN_PATH = '/api/cline-upstream-provider/pin';
/** The account's limit windows and plan line; `?refresh=1` asks for a fresh read. */
const USAGE_PATH = '/api/cline-upstream-provider/usage';
/**
 * The environment reference the Cline route resolves for its key — the route's own
 * `apiKeyEnv` in the profile. This plugin only ever *describes* that reference (never
 * reads the value); a profile that names a different reference reports unconfigured
 * here, which the control says out loud rather than guessing.
 */
const KEY_ENV = 'CLINE_API_KEY';
/** Brand marks shipped with this bundle. */
const ICON_DIR = new URL('./icons/', import.meta.url);
/** Upstream names kept per round; older links collapse into a leading ellipsis. */
const CHAIN_LIMIT = 3;
/** How long a declared model call may wait for its HTTP request to start. */
const ATTRIBUTION_TTL = 5000;
/** Bound on declared calls that have not reached Cline yet. */
const PENDING_LIMIT = 64;
/** How long a probed channel list is reused. Probing costs a small real amount. */
const CHANNELS_TTL = 600000;
/** How long a probe that produced no list is left alone before trying again. */
const CHANNELS_RETRY = 60000;
/** The same, for a probe the user asked for by hand: long enough to swallow a double click. */
const CHANNELS_FLOOR = 5000;
/** Bound on one probe request. */
const PROBE_TIMEOUT = 20000;

/**
 * Read the request target of any `fetch` call shape.
 * @param input - string, URL, or Request.
 * @returns the absolute URL text, or undefined when it cannot be read.
 */
function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input !== null && typeof input === 'object' && typeof input.url === 'string' ? input.url : undefined;
}

/**
 * Whether one URL is the Cline chat-completions endpoint.
 * @param value - absolute URL text.
 * @returns true for the Cline route only.
 */
function isClineChat(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === CLINE_CHAT.protocol
    && url.hostname === CLINE_CHAT.hostname
    && url.pathname.replace(/\/+$/, '') === CLINE_CHAT.pathname;
}

/**
 * The Session identity of a Session or Session event subject.
 * @param session - Session object handed to `session/event`.
 * @returns its id, or undefined.
 */
function sessionIdOf(session) {
  const id = session?.id ?? session?.header?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * The requested model id of one serialized request body.
 * @param body - `init.body` of a fetch call.
 * @returns the model id, or undefined for a non-string or unparsable body.
 */
function modelOf(body) {
  if (typeof body !== 'string') return undefined;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.model === 'string' ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One header value from any `fetch` header shape.
 * @param headers - `init.headers`, a Request's Headers, or undefined.
 * @param name - lower-case header name.
 * @returns the value, or undefined.
 */
function headerOf(headers, name) {
  if (headers === undefined || headers === null) return undefined;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return typeof value === 'string' && value !== '' ? value : undefined;
  }
  if (Array.isArray(headers)) {
    const hit = headers.find((pair) => String(pair[0]).toLowerCase() === name);
    return hit === undefined ? undefined : String(hit[1]);
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name && value !== undefined) return String(value);
    }
  }
  return undefined;
}

/**
 * A list of names as the gateway stated it, order untouched.
 * @param value - any value.
 * @returns the names, or undefined when the value is not an array of names at all.
 */
function namesOf(value) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((name) => typeof name === 'string' && name !== '');
}

/**
 * The routed provider announced by one parsed response payload, if any.
 *
 * `routing.fallbacksAvailable` is the only place the gateway states an ORDER it computed
 * itself: the 0-token refusal prints the same members sorted by name, which is a roster
 * rather than a ranking. The field is present-but-empty on a strict pin, and on a
 * preferred pin it carries our own channel first, so the caller decides what to do with it.
 * @param payload - one parsed SSE data object or a whole JSON body.
 * @returns the announced provider, the pipeline that announced it, and the stated order.
 */
function routeOf(payload) {
  const root = payload !== null && typeof payload === 'object' ? payload : undefined;
  if (root === undefined) return undefined;
  const wrapped = root.data !== null && typeof root.data === 'object' ? root.data : undefined;
  for (const candidate of [root, wrapped]) {
    if (candidate === undefined) continue;
    const choice = Array.isArray(candidate.choices) ? candidate.choices[0] : undefined;
    const metadata = choice?.delta?.provider_metadata
      ?? choice?.delta?.providerMetadata
      ?? choice?.message?.provider_metadata
      ?? choice?.message?.providerMetadata
      ?? candidate.message?.provider_metadata
      ?? candidate.provider_metadata;
    const routing = metadata?.gateway?.routing;
    const final = routing?.finalProvider;
    if (typeof final === 'string' && final !== '') {
      return { provider: final, pipeline: 'planner', order: namesOf(routing?.fallbacksAvailable) };
    }
    if (typeof candidate.provider === 'string' && candidate.provider !== '') {
      return { provider: candidate.provider, pipeline: 'direct' };
    }
  }
  return undefined;
}

/**
 * Take the Session one Cline request belongs to: the model call declared just
 * before it, preferring the matching model id, else the oldest live declaration.
 * A consumed declaration stays available briefly so an SDK retry of the same
 * call is attributed to the same Session.
 * @param pending - declared model calls, oldest first.
 * @param last - holder of the most recently attributed call.
 * @param model - model id read from the request body, when available.
 * @returns the owning Session id, or undefined when nothing matches.
 */
function claim(pending, last, model) {
  const now = Date.now();
  while (pending.length > 0 && now - pending[0].at > ATTRIBUTION_TTL) pending.shift();
  const matched = model === undefined ? -1 : pending.findIndex((call) => call.model === model);
  const index = matched === -1 ? (pending.length > 0 ? 0 : -1) : matched;
  if (index !== -1) {
    const call = pending.splice(index, 1)[0];
    last.value = call;
    return call.sessionId;
  }
  const previous = last.value;
  if (previous === undefined || now - previous.at > ATTRIBUTION_TTL) return undefined;
  return model === undefined || previous.model === undefined || previous.model === model ? previous.sessionId : undefined;
}

/**
 * Record one settlement: consecutive duplicates add no link, and an older
 * request never decides after a newer one.
 * @param route - the announced provider and its pipeline.
 * @param id - the Cline request this observation belongs to.
 * @param entry - the owning Session's chain record.
 */
function settle(route, id, entry) {
  if (id < entry.settled) return;
  entry.settled = id;
  entry.at = Date.now();
  entry.pipeline = route.pipeline;
  if (entry.chain[entry.chain.length - 1] === route.provider) return;
  entry.chain.push(route.provider);
  if (entry.chain.length > CHAIN_LIMIT) {
    entry.chain.shift();
    entry.truncated = true;
  }
}

/**
 * Fold one parsed payload into one Session's chain, then hand the announcement to the
 * caller's observer — the pin reads the actual landing spot from there.
 * @param payload - parsed SSE data object or JSON body.
 * @param id - owning Cline request id.
 * @param entry - the owning Session's chain record.
 * @param onRoute - receives the announced provider and its pipeline, when there is one.
 */
function capture(payload, id, entry, onRoute) {
  const route = routeOf(payload);
  if (route === undefined) return;
  settle(route, id, entry);
  if (onRoute !== undefined) onRoute(route);
}

/**
 * Observe one cloned response without touching the model call.
 * @param response - the clone handed to this plugin.
 * @param id - owning Cline request id.
 * @param entry - the owning Session's chain record.
 * @param onRoute - receives every announced route, in arrival order.
 */
async function observe(response, id, entry, onRoute) {
  try {
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/event-stream') && response.body !== null) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const text = line.trim();
          if (!text.startsWith('data:')) continue;
          const data = text.slice(5).trim();
          if (data === '' || data === '[DONE]') continue;
          try {
            capture(JSON.parse(data), id, entry, onRoute);
          } catch {}
        }
      }
      return;
    }
    const text = await response.text();
    if (text === '') return;
    try {
      capture(JSON.parse(text), id, entry, onRoute);
    } catch {}
  } catch {
    /* Observation is best-effort and never surfaces into the model call. */
  }
}

/**
 * Answer one shipped brand mark.
 * @param request - the icon request.
 * @returns the mark with its own media type, or 404.
 */
async function serveIcon(request) {
  const name = new URL(request.url).searchParams.get('name') ?? '';
  if (!/^[a-z][a-z0-9]*$/.test(name)) return new Response('not found', { status: 404 });
  for (const [extension, type] of [['svg', 'image/svg+xml'], ['png', 'image/png']]) {
    try {
      const bytes = await readFile(fileURLToPath(new URL(name + '.' + extension, ICON_DIR)));
      return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'public, max-age=3600' } });
    } catch {
      /* try the next extension */
    }
  }
  return new Response('not found', { status: 404 });
}

export const inject = ['connection'];

/**
 * Serve one Session's chain, its brand marks, the gateway's channel list,
 * and watch every Cline response.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  /** Session id -> its current round chain. */
  const sessions = new Map();
  /** Model calls declared through `llm/stream`, oldest first. */
  const pending = [];
  /** The call that owns a request already in flight, for SDK retries. */
  const last = { value: undefined };
  /** Credentials seen on a real Cline request; a probe reuses them and nothing else. */
  const credentials = { authorization: undefined, model: undefined };
  /** The probed channel list, its pipeline, when it was taken, and the last attempt. */
  const channels = { at: 0, tried: 0, pipeline: '', list: [], attempt: undefined, pending: undefined };
  /**
   * The last channel order a real call announced: `{ at, order, finalProvider, strict }`.
   * `at === 0` means no call has been observed yet, and the card falls back to the roster.
   */
  const observed = { at: 0, order: [], finalProvider: undefined, strict: false };
  /** `fetch` as it was before this plugin wrapped it, so a probe is never observed by us. */
  let native = globalThis.fetch;
  let requestId = 0;
  /**
   * The active pin — `{ mode: 'order' | 'only', channel }` — or null. Null is the
   * default and means the wrapper forwards every request untouched.
   */
  let activePin = null;
  /** The last landing spot a Cline response announced, so the control can check the pin. */
  let lastRoute = null;
  const entryOf = (sessionId) => {
    let entry = sessions.get(sessionId);
    if (entry === undefined) {
      entry = { chain: [], truncated: false, at: 0, settled: 0, pipeline: '' };
      sessions.set(sessionId, entry);
    }
    return entry;
  };

  /**
   * Find the provider route that serves this gateway, read from the composed loader rows.
   * The match is the baseURL host, never the provider name: a profile may name the route
   * anything, and the row may be a patch layer over a bundle default. The shape read is
   * `dsh-llm-pi-ai`'s `providers.<name>.{ baseURL, apiKeyEnv, api, models }`; a row of any
   * other shape simply does not match, and the caller falls back to traffic it has seen.
   * @returns `{ provider, baseURL, apiKeyEnv, api, model }`, or undefined.
   */
  const detectRoute = () => {
    const loader = ctx.get('loader');
    if (loader === undefined) return undefined;
    for (const entry of loader.entries()) {
      const providers = entry?.options?.config?.providers;
      if (providers === null || typeof providers !== 'object') continue;
      for (const [provider, profile] of Object.entries(providers)) {
        if (profile === null || typeof profile !== 'object') continue;
        let host;
        try {
          host = new URL(String(profile.baseURL)).hostname;
        } catch {
          continue;
        }
        if (host !== CLINE_CHAT.hostname) continue;
        const models = Array.isArray(profile.models) ? profile.models : [];
        const first = models.find((model) => typeof model?.id === 'string' && model.id !== '');
        return {
          provider,
          baseURL: String(profile.baseURL),
          apiKeyEnv: typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv !== '' ? profile.apiKeyEnv : KEY_ENV,
          api: typeof profile.api === 'string' ? profile.api : 'openai-completions',
          model: first?.id,
        };
      }
    }
    return undefined;
  };

  /**
   * Resolve one route's key into the header pi-ai itself would send, so a probe can run
   * before any real call has been observed. The value stays inside this process.
   * @param route - the detected route, when there is one.
   * @returns the auth header pair, or undefined when no key resolves.
   */
  const authOf = async (route) => {
    const env = route?.apiKeyEnv ?? KEY_ENV;
    let value;
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
      try {
        value = (await credentials.resolve(env))?.value;
      } catch {
        /* fall through to the launch environment */
      }
    }
    if (value === undefined || value === '') {
      const fromEnv = process.env[env];
      value = typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : undefined;
    }
    if (value === undefined) return undefined;
    return route?.api === 'anthropic-messages' ? { 'x-api-key': value } : { authorization: 'Bearer ' + value };
  };

  /**
   * The account's usage snapshot. It shares this plugin's key resolution — the same
   * route detection and the same credential reference a model call uses — and only
   * its own cache ever holds the result: the gateway's answer, never the key.
   */
  const usage = createUsageSource({
    authorize: async () => {
      const header = await authOf(detectRoute());
      if (header === undefined) return undefined;
      return header.authorization ?? header['x-api-key'];
    },
    // Two configuration states, two different fixes: no route to the gateway at all,
    // or a route whose key does not resolve.
    explainMissing: () => (detectRoute() === undefined ? 'no-route' : 'no-key'),
  });

  /**
   * Ask the gateway for its channel list by pinning a channel that cannot exist.
   * The request is refused at the routing layer, so no model runs and no token is spent.
   * The key and the model come from traffic already seen, else from the composed route —
   * which is what lets a fresh profile list channels before its first Cline call.
   * @param fields - the pin fields of one attempt, from `probeBodies`.
   * @returns the probe response, or undefined when there is nothing to probe with.
   */
  const sendProbe = async (fields) => {
    const route = detectRoute();
    const authorization = credentials.authorization ?? (await authOf(route));
    const model = credentials.model ?? route?.model;
    if (authorization === undefined || model === undefined) return undefined;
    const headers = typeof authorization === 'string' ? { authorization } : authorization;
    return native(CLINE_CHAT.protocol + '//' + CLINE_CHAT.hostname + CLINE_CHAT.pathname, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
        ...fields,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });
  };

  /**
   * The pipeline of the most recently settled request: the two pipelines
   * answer with different channel lists, so the probe must ask the right one.
   * @returns `planner`, `direct`, or an empty string before the first answer.
   */
  const pipelineOf = () => {
    let pipeline = '';
    let at = -1;
    for (const entry of sessions.values()) {
      if (entry.pipeline !== '' && entry.at > at) {
        at = entry.at;
        pipeline = entry.pipeline;
      }
    }
    return pipeline;
  };

  /**
   * The channel list, probed at most once per TTL and never concurrently.
   *
   * One attempt per pipeline shape, in `probeBodies`' order, stopping at the first answer
   * that states a list. An attempt that states nothing is remembered as `attempt`, so the
   * surfaces can say why instead of leaving "no channel list" unexplained — and a probe the
   * user asked for by hand may come back sooner than the automatic retry floor.
   * @param force - true for a user-requested probe.
   * @returns the list, its pipeline, when it was taken, and the last attempt's outcome.
   */
  const channelsFor = async (force) => {
    const view = () => ({
      pipeline: channels.pipeline,
      list: channels.list,
      at: channels.at,
      attempt: channels.attempt,
      observed: { ...observed, order: [...observed.order] },
    });
    const now = Date.now();
    // A list is reused for the full TTL; a probe that produced nothing is retried
    // sooner, but still not on every open — each probe is a real (tiny) charge.
    const settled = channels.list.length > 0
      ? now - channels.at < CHANNELS_TTL
      : now - channels.tried < (force === true ? CHANNELS_FLOOR : CHANNELS_RETRY);
    if (settled) return view();
    if (channels.pending !== undefined) return channels.pending;
    channels.tried = now;
    channels.pipeline = pipelineOf();
    channels.pending = (async () => {
      let reason = '';
      try {
        for (const attempt of probeBodies(channels.pipeline)) {
          const response = await sendProbe(attempt.fields);
          if (response === undefined) {
            reason = '没有可用于探测的密钥或模型';
            break;
          }
          const text = await response.text();
          const found = channelListOf(text);
          if (found.list.length > 0) {
            channels.list = found.list;
            channels.pipeline = found.pipeline === '' ? channels.pipeline : found.pipeline;
            channels.at = Date.now();
            channels.attempt = { at: channels.at, pipeline: found.pipeline, ok: true, reason: '' };
            reason = '';
            break;
          }
          reason = probeReasonOf(text, response.status);
          channels.attempt = {
            at: Date.now(),
            pipeline: attempt.pipeline,
            ok: false,
            reason: reason === '' ? '网关没有报出渠道，也没有给出原因' : reason,
          };
        }
      } catch (error) {
        channels.attempt = {
          at: Date.now(),
          pipeline: channels.pipeline,
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      } finally {
        channels.pending = undefined;
      }
      return view();
    })();
    return channels.pending;
  };

  /**
   * Record the landing spot of one pinned call. Only a call that actually carried the
   * pin can judge it, and it is judged against the pin it carried — not against whatever
   * the pin has become by the time a slow answer arrives.
   * @param route - the announced provider and its pipeline.
   * @param applied - the pin that request was sent with.
   */
  const noteRoute = (route, applied) => {
    if (applied === null) return;
    lastRoute = {
      actual: route.provider,
      pipeline: route.pipeline,
      at: Date.now(),
      pinned: applied.channel,
      matched: applied.channel === route.provider,
    };
  };

  /**
   * Record the channel order the gateway itself stated, and the shape that produced it.
   *
   * Only a real call carries `routing.fallbacksAvailable`. Three cases, three meanings:
   * no pin — the gateway's own fallback order; a preferred pin (`order`) — the same order
   * with our channel moved to the front, which is what a preference is supposed to do; a
   * strict pin (`only`) — an empty array, because a strict pin has no fallbacks at all.
   * The last one is a real answer, not a missing field, and the card acts on it by hiding
   * the whole channel block instead of showing a stale list.
   * @param route - the announced provider, pipeline and stated order.
   * @param applied - the pin that request was sent with, or null.
   */
  const noteOrder = (route, applied) => {
    if (route.order === undefined) return;
    observed.at = Date.now();
    observed.order = route.order;
    observed.finalProvider = route.provider;
    observed.strict = applied !== null && applied.mode === 'only';
  };

  /**
   * Narrow one wire value into a pin.
   * @param value - `null` to clear the pin, or `{ mode, channel }`.
   * @returns the pin, or the reason the value was refused.
   */
  const normalizePin = (value) => {
    if (value === null || value === undefined) return { pin: null };
    if (typeof value !== 'object' || Array.isArray(value)) return { error: 'pin must be an object or null' };
    if (value.mode !== 'order' && value.mode !== 'only') return { error: 'mode must be "order" or "only"' };
    if (typeof value.channel !== 'string' || value.channel.trim() === '') {
      return { error: 'channel must be a non-empty string' };
    }
    return { pin: { mode: value.mode, channel: value.channel.trim() } };
  };

  /**
   * Rewrite one serialized Cline body so it carries the active pin.
   *
   * The field depends on the pipeline, and an unknown pipeline writes both: §4 of
   * docs/pinning.md measured that the field a pipeline does not read is dropped
   * silently rather than rejected, so writing both is the only honest guess. Existing
   * keys are merged over, never replaced, and nothing else in the body is touched.
   * @param body - `init.body` of one Cline chat request.
   * @returns the rewritten body text, or undefined when there is nothing to write.
   */
  const withPin = (body) => {
    if (activePin === null || typeof body !== 'string' || body === '') return undefined;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const plain = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const fields = { [activePin.mode]: [activePin.channel] };
    const pipeline = pipelineOf();
    if (pipeline !== 'direct') {
      const options = plain(parsed.providerOptions);
      parsed.providerOptions = { ...options, gateway: { ...plain(options.gateway), ...fields } };
    }
    if (pipeline !== 'planner') {
      parsed.provider = { ...plain(parsed.provider), ...fields };
    }
    return JSON.stringify(parsed);
  };

  /**
   * The pin, the key it depends on, and the last landing spot.
   * The key is only ever *described*: `describe` reports whether the Cline route's
   * environment reference resolves, and from which layer, without handing out the value.
   * @returns the state the control renders.
   */
  const pinState = async () => {
    // The key reference belongs to the route the profile actually composed, not to a
    // name this plugin assumed: that is what keeps a renamed provider working.
    const route = detectRoute();
    const env = route?.apiKeyEnv ?? KEY_ENV;
    let configured = false;
    let source;
    const credentials = ctx.get('credentials');
    if (credentials === undefined) {
      // No credential service mounted: the launch environment is the only layer left.
      const value = process.env[env];
      configured = typeof value === 'string' && value !== '';
      source = configured ? 'environment' : undefined;
    } else {
      try {
        const info = await credentials.describe(env);
        configured = info?.configured === true;
        source = info?.source;
      } catch {
        /* An unusable credential store reads as unconfigured, never as an error. */
      }
    }
    // A reading belongs only to the pin it was taken under: a slow answer that lands
    // after the pin changed must not be shown as that new pin's verdict.
    const last = lastRoute !== null && lastRoute.pinned === activePin?.channel ? lastRoute : null;
    return { pin: activePin, route, key: { env, configured, source }, last };
  };

  ctx.connection.fetch.register({
    path: ICON_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => serveIcon(request),
  });
  ctx.connection.fetch.register({
    path: PIN_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'body must be JSON' }, { status: 400 });
        }
        const next = normalizePin(body?.pin);
        if (next.error !== undefined) return Response.json({ error: next.error }, { status: 400 });
        // A new pin invalidates the previous spot: that reading belonged to the old pin.
        if (next.pin?.channel !== activePin?.channel || next.pin?.mode !== activePin?.mode) lastRoute = null;
        activePin = next.pin;
      }
      return Response.json(await pinState(), { headers: { 'cache-control': 'no-store' } });
    },
  });
  ctx.connection.fetch.register({
    path: USAGE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    // The client's own poll is the rate limit; `?refresh=1` only asks the source to
    // skip its cache, and the source still enforces its floor and its failure ladder.
    fetch: async (request) => {
      const refresh = new URL(request.url).searchParams.get('refresh') === '1';
      return Response.json(await usage.read({ force: refresh }), { headers: { 'cache-control': 'no-store' } });
    },
  });
  ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => {
      const sessionId = new URL(request.url).searchParams.get('session');
      const entry = sessionId === null ? undefined : sessions.get(sessionId);
      return Promise.resolve(Response.json(
        entry === undefined
          ? { providers: [], truncated: false, at: 0 }
          : { providers: entry.chain, truncated: entry.truncated, at: entry.at },
        { headers: { 'cache-control': 'no-store' } },
      ));
    },
  });
  ctx.connection.fetch.register({
    path: CHANNELS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    // `?refresh=1` is the user's own "probe again": it only shortens the wait after an
    // empty probe (to a few seconds), never the TTL of a list that already exists.
    fetch: async (request) => {
      const refresh = new URL(request.url).searchParams.get('refresh') === '1';
      return Response.json(await channelsFor(refresh), { headers: { 'cache-control': 'no-store' } });
    },
  });
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/start') return;
    const sessionId = sessionIdOf(session);
    const entry = sessionId === undefined ? undefined : sessions.get(sessionId);
    if (entry === undefined) return;
    entry.chain = entry.chain.slice(-1);
    entry.truncated = false;
  });
  ctx.on('llm/stream', (options, next) => {
    const sessionId = options?.sessionId;
    if (typeof sessionId === 'string' && sessionId !== '') {
      pending.push({
        sessionId,
        model: typeof options.model === 'string' ? options.model : undefined,
        at: Date.now(),
      });
      while (pending.length > PENDING_LIMIT) pending.shift();
    }
    return next();
  });
  ctx.effect(() => {
    const original = globalThis.fetch;
    native = original;
    const wrapped = async (input, init) => {
      const url = requestUrl(input);
      const mine = url !== undefined && isClineChat(url);
      let target;
      if (mine) {
        const model = modelOf(init?.body);
        // A probe needs the same key the Session already uses; nothing else is stored.
        const authorization = headerOf(init?.headers, 'authorization')
          ?? headerOf(input instanceof Request ? input.headers : undefined, 'authorization');
        if (authorization !== undefined) credentials.authorization = authorization;
        if (model !== undefined) credentials.model = model;
        const sessionId = claim(pending, last, model);
        if (sessionId !== undefined) target = { id: ++requestId, entry: entryOf(sessionId) };
      }
      // The pin is written after both halves have serialized the request and before the
      // socket sees it: with no pin these two lines change nothing at all.
      let callInput = input;
      let callInit = init;
      let applied = null;
      if (mine && activePin !== null) {
        const rewritten = init?.body !== undefined
          ? withPin(init.body)
          : input instanceof Request ? withPin(await input.clone().text()) : undefined;
        if (rewritten !== undefined) {
          applied = activePin;
          if (init?.body !== undefined) {
            callInit = { ...init, body: rewritten };
            const headers = new Headers(callInit.headers ?? undefined);
            if (headers.has('content-length')) {
              headers.delete('content-length');
              callInit.headers = headers;
            }
          } else {
            callInput = new Request(input, { body: rewritten });
          }
        }
      }
      const response = await original(callInput, callInit);
      if (target !== undefined) {
        void observe(response.clone(), target.id, target.entry, (route) => {
          noteRoute(route, applied);
          noteOrder(route, applied);
          // Real traffic just spent some of the account's windows: let the next look at
          // the card find a warm snapshot. Throttled inside the source (five minutes).
          usage.noteTraffic();
        });
      }
      return response;
    };
    globalThis.fetch = wrapped;
    return () => {
      if (globalThis.fetch === wrapped) globalThis.fetch = original;
      native = original;
    };
  }, 'cline-upstream-provider: Cline response observation + pin');
}
