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
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** The only endpoint whose responses carry a Cline route decision. */
const CLINE_CHAT = { protocol: 'https:', hostname: 'api.cline.bot', pathname: '/api/v1/chat/completions' };
/** Page-facing read routes, served inside Connection's authenticated /api fence. */
const ROUTE_PATH = '/api/cline-upstream-provider';
const ICON_PATH = '/api/cline-upstream-provider/icon';
/** Brand marks shipped with this bundle. */
const ICON_DIR = new URL('./icons/', import.meta.url);
/** Upstream names kept per round; older links collapse into a leading ellipsis. */
const CHAIN_LIMIT = 3;
/** How long a declared model call may wait for its HTTP request to start. */
const ATTRIBUTION_TTL = 5000;
/** Bound on declared calls that have not reached Cline yet. */
const PENDING_LIMIT = 64;

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
 * The routed provider announced by one parsed response payload, if any.
 * @param payload - one parsed SSE data object or a whole JSON body.
 * @returns the planner's finalProvider, else the direct pipeline's provider.
 */
function providerOf(payload) {
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
    const final = metadata?.gateway?.routing?.finalProvider;
    if (typeof final === 'string' && final !== '') return final;
    if (typeof candidate.provider === 'string' && candidate.provider !== '') return candidate.provider;
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
 * @param provider - the announced upstream provider.
 * @param id - the Cline request this observation belongs to.
 * @param entry - the owning Session's chain record.
 */
function settle(provider, id, entry) {
  if (id < entry.settled) return;
  entry.settled = id;
  entry.at = Date.now();
  if (entry.chain[entry.chain.length - 1] === provider) return;
  entry.chain.push(provider);
  if (entry.chain.length > CHAIN_LIMIT) {
    entry.chain.shift();
    entry.truncated = true;
  }
}

/**
 * Fold one parsed payload into one Session's chain.
 * @param payload - parsed SSE data object or JSON body.
 * @param id - owning Cline request id.
 * @param entry - the owning Session's chain record.
 */
function capture(payload, id, entry) {
  const provider = providerOf(payload);
  if (provider !== undefined) settle(provider, id, entry);
}

/**
 * Observe one cloned response without touching the model call.
 * @param response - the clone handed to this plugin.
 * @param id - owning Cline request id.
 * @param entry - the owning Session's chain record.
 */
async function observe(response, id, entry) {
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
            capture(JSON.parse(data), id, entry);
          } catch {}
        }
      }
      return;
    }
    const text = await response.text();
    if (text === '') return;
    try {
      capture(JSON.parse(text), id, entry);
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
 * Serve one Session's chain, its brand marks, and watch every Cline response.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  /** Session id -> its current round chain. */
  const sessions = new Map();
  /** Model calls declared through `llm/stream`, oldest first. */
  const pending = [];
  /** The call that owns a request already in flight, for SDK retries. */
  const last = { value: undefined };
  let requestId = 0;
  const entryOf = (sessionId) => {
    let entry = sessions.get(sessionId);
    if (entry === undefined) {
      entry = { chain: [], truncated: false, at: 0, settled: 0 };
      sessions.set(sessionId, entry);
    }
    return entry;
  };
  ctx.connection.fetch.register({
    path: ICON_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => serveIcon(request),
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
    const wrapped = async (input, init) => {
      const url = requestUrl(input);
      const mine = url !== undefined && isClineChat(url);
      let target;
      if (mine) {
        const sessionId = claim(pending, last, modelOf(init?.body));
        if (sessionId !== undefined) target = { id: ++requestId, entry: entryOf(sessionId) };
      }
      const response = await original(input, init);
      if (target !== undefined) void observe(response.clone(), target.id, target.entry);
      return response;
    };
    globalThis.fetch = wrapped;
    return () => {
      if (globalThis.fetch === wrapped) globalThis.fetch = original;
    };
  }, 'cline-upstream-provider: Cline response observation');
}
