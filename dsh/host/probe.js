/**
 * The gateway channel probe: how a request is shaped so the gateway states its channel
 * list, and how that answer is read back.
 *
 * Cline exposes no "list the channels" endpoint — the list only ever appears in the
 * refusal of a request pinned to a channel that cannot exist (docs/pinning.md §2). Which
 * field carries that pin depends on the pipeline, and the pipeline is unknown until a
 * real call has been observed.
 *
 * Writing both fields into one request (the §5 recipe for an unknown pipeline) turned out
 * to be the wrong move for the probe: measured on a fresh install (2026-10-02, web
 * profile, no traffic yet) the gateway refused that request without stating any channel,
 * the empty answer was cached for the retry floor, and pressing "probe again" inside that
 * window appeared to hang on "no channel list". So an unknown pipeline now asks each
 * shape **in turn**, one request each, stopping at the first answer that states a list —
 * and the answer that stated nothing is kept, so the surfaces can say why.
 */

/** A channel name that cannot exist, so the gateway lists the real ones instead of routing. */
export const PROBE_CHANNEL = '__probe__';
/** How much of a refusing answer is kept as the probe's reason. */
export const PROBE_REASON_LIMIT = 200;

/**
 * Split a gateway channel list without reordering it.
 * @param value - comma or whitespace separated channel names.
 * @returns the names in the order the gateway stated them; anything that is not a
 * non-empty string is no list at all (never `String(value)`, which would turn an absent
 * field into the channel "undefined").
 */
export function splitChannels(value) {
  if (typeof value !== 'string' || value === '') return [];
  return value
    .split(/[,\s]+/u)
    .map((name) => name.trim())
    .filter((name) => /^[a-z0-9][a-z0-9-]*$/iu.test(name));
}

/**
 * The channel list a probe response states, in the gateway's own order.
 * Both pipelines answer a nonexistent channel with the real list: the planner inside its
 * error text, the direct pipeline inside `error.metadata`, so the shape that answered
 * also says which pipeline was just probed.
 * @param text - the probe response body, SSE or JSON.
 * @returns the names and the pipeline that stated them.
 */
export function channelListOf(text) {
  const stated = /Available providers are:\s*([^."]+)/iu.exec(String(text));
  if (stated !== null) return { list: splitChannels(stated[1]), pipeline: 'planner' };
  const fromBody = (value) => {
    const list = value?.error?.metadata?.available_providers ?? value?.metadata?.available_providers;
    return Array.isArray(list) ? splitChannels(list.join(',')) : undefined;
  };
  const found = (list) => (list === undefined ? undefined : { list, pipeline: 'direct' });
  try {
    const parsed = found(fromBody(JSON.parse(String(text))));
    if (parsed !== undefined) return parsed;
  } catch {
    /* not a whole JSON body; an SSE stream carries one JSON object per line */
  }
  for (const line of String(text).split(/\r?\n/u)) {
    const trimmed = line.trim();
    const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : '';
    if (data === '' || data === '[DONE]') continue;
    try {
      const parsed = found(fromBody(JSON.parse(data)));
      if (parsed !== undefined) return parsed;
    } catch {
      /* one unparsable frame is not the whole answer */
    }
  }
  return { list: [], pipeline: '' };
}

/**
 * Why an answer stated no channel, in as few words as the answer itself offers: the
 * gateway's own message when there is one, else a slice of the body, else nothing.
 * @param text - the probe response body.
 * @param status - the HTTP status that carried it.
 * @returns a short reason, or an empty string when the body says nothing useful.
 */
export function probeReasonOf(text, status) {
  const body = String(text ?? '').trim();
  const messageOf = (value) => {
    const message = value?.error?.message ?? value?.error ?? value?.message;
    return typeof message === 'string' && message !== '' ? message : undefined;
  };
  try {
    const message = messageOf(JSON.parse(body));
    if (message !== undefined) return message.slice(0, PROBE_REASON_LIMIT);
  } catch {
    /* an SSE stream or a plain body: fall through to the frame scan */
  }
  for (const line of body.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (data === '' || data === '[DONE]') continue;
    try {
      const message = messageOf(JSON.parse(data));
      if (message !== undefined) return message.slice(0, PROBE_REASON_LIMIT);
    } catch {
      /* keep scanning */
    }
  }
  if (body === '') return status === undefined ? '' : `HTTP ${status}`;
  return body.slice(0, PROBE_REASON_LIMIT);
}

/**
 * The request shapes a probe should try, in order, for one known-or-unknown pipeline.
 * @param pipeline - `planner`, `direct`, or an empty string while nothing has been observed.
 * @param channel - the impossible channel to pin.
 * @returns one body fragment per attempt; the first answer that states a list wins.
 */
export function probeBodies(pipeline, channel = PROBE_CHANNEL) {
  const planner = { pipeline: 'planner', fields: { providerOptions: { gateway: { only: [channel] } } } };
  const direct = { pipeline: 'direct', fields: { provider: { only: [channel] } } };
  if (pipeline === 'planner') return [planner];
  if (pipeline === 'direct') return [direct];
  // Unknown pipeline: the planner shape answers with its list inside the error text and is
  // the only one that has ever worked on a fresh install, so it is asked first.
  return [planner, direct];
}
