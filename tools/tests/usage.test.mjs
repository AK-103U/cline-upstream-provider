/**
 * dsh/host/usage.js: the cache, the floors, the failure ladder, and the narrowing.
 *
 * These are the parts that decide how often the plugin spends a real request on the
 * gateway's account endpoints, and what the surfaces are allowed to believe — the
 * wiring around them (the route, the credential resolution) is exercised by hand.
 *
 * Run: node --test tools/tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountOf,
  createUsageSource,
  maskEmail,
  planOf,
  windowsOf,
} from '../../dsh/host/usage.js';

const KEY = 'apikey-SECRET-123';

const LIMITS = {
  success: true,
  data: {
    limits: [
      { type: 'five_hour', percentUsed: 8, resetsAt: '2026-10-02T10:52:50.252945652Z' },
      { type: 'weekly', percentUsed: 26, resetsAt: '2026-10-05T23:17:49.256295078Z' },
      { type: 'monthly', percentUsed: 21, resetsAt: '2026-10-21T19:54:17.259634242Z' },
    ],
  },
};
const PLAN = {
  success: true,
  data: {
    plan: { name: 'Cline Pass (Monthly)[Internal]', displayName: 'Cline Pass (Monthly)', interval: 'Monthly', pricePerSeatCents: 999, isActive: true },
    currentPeriodStart: '2026-09-21T19:35:55Z',
    currentPeriodEnd: '2026-10-21T19:35:55Z',
    cancelAt: '2026-10-21T19:35:55Z',
    canceledAt: '2026-10-02T01:02:17Z',
  },
};
const ME = { success: true, data: { email: 'user@example.com', displayName: 'User' } };

/**
 * A Response stand-in carrying one JSON payload and its content type.
 * @param body - the payload.
 * @param options - status and content type.
 * @returns the stand-in.
 */
function json(body, { status = 200, type = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : undefined) },
    json: async () => body,
  };
}

/**
 * A fetcher over a path-suffix table, counting its calls.
 * @param table - suffix -> payload, thunk, or Error.
 * @returns the fetcher and its call log.
 */
function fakeFetch(table) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    for (const [suffix, value] of Object.entries(table)) {
      if (!url.endsWith(suffix)) continue;
      if (typeof value === 'function') return value();
      if (value instanceof Error) throw value;
      return value;
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetcher, calls };
}

const okTable = {
  '/users/me/plan/usage-limits': json(LIMITS),
  '/users/me/plan': json(PLAN),
  '/users/me': json(ME),
};

test('normalizes the happy path and never leaks the key', async () => {
  const { fetcher, calls } = fakeFetch(okTable);
  const clock = 1_000_000;
  const source = createUsageSource({ fetcher, authorize: async () => `Bearer ${KEY}`, now: () => clock });
  const snapshot = await source.read();

  assert.equal(snapshot.state, 'ready');
  assert.equal(snapshot.stale, false);
  assert.deepEqual(snapshot.value.windows.map((entry) => [entry.type, entry.percent]), [
    ['five_hour', 8], ['weekly', 26], ['monthly', 21],
  ]);
  assert.equal(snapshot.value.windows[0].resetsAtMs, Date.parse('2026-10-02T10:52:50.252945652Z'));
  assert.equal(snapshot.value.plan.displayName, 'Cline Pass (Monthly)');
  assert.equal(snapshot.value.plan.pricePerSeatCents, 999);
  assert.equal(snapshot.value.plan.canceled, true);
  assert.equal(snapshot.value.plan.periodEnd, '2026-10-21');
  assert.equal(snapshot.value.account.maskedEmail, 'us***@example.com');
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.headers.authorization === `Bearer ${KEY}`));
  assert.ok(!JSON.stringify(snapshot).includes(KEY), 'snapshot must not carry the key');
});

test('a snapshot inside the TTL costs no request; force respects its floor', async () => {
  const { fetcher, calls } = fakeFetch(okTable);
  let clock = 1_000_000;
  const source = createUsageSource({ fetcher, authorize: async () => `Bearer ${KEY}`, now: () => clock });
  await source.read();
  assert.equal(calls.length, 3);
  await source.read();
  assert.equal(calls.length, 3, 'within TTL: no new requests');
  await source.read({ force: true });
  assert.equal(calls.length, 3, 'force inside its 10s floor still serves the cache');
  clock += 11_000;
  await source.read({ force: true });
  assert.equal(calls.length, 6, 'force past the floor refreshes');
  clock += 61_000;
  await source.read();
  assert.equal(calls.length, 9, 'past TTL refreshes');
});

test('warm reads are stricter than the normal poll: five minutes', async () => {
  const { fetcher, calls } = fakeFetch(okTable);
  let clock = 1_000_000;
  const source = createUsageSource({ fetcher, authorize: async () => `Bearer ${KEY}`, now: () => clock });
  await source.read();
  assert.equal(calls.length, 3);
  clock += 61_000;
  await source.read({ warm: true });
  assert.equal(calls.length, 3, 'past the 60s TTL but inside the warm floor: no request');
  clock += 61_000;
  await source.read({ warm: true });
  assert.equal(calls.length, 3, 'still inside five minutes: no request');
  clock += 240_000;
  await source.read({ warm: true });
  assert.equal(calls.length, 6, 'past five minutes: one warm refresh');
});

test('concurrent reads share one request set', async () => {
  const { fetcher, calls } = fakeFetch(okTable);
  const source = createUsageSource({ fetcher, authorize: async () => `Bearer ${KEY}` });
  const [first, second] = await Promise.all([source.read(), source.read()]);
  assert.equal(first, second, 'both callers receive the same snapshot');
  assert.equal(calls.length, 3);
});

test('a missing key is a configuration state, not an error', async () => {
  const { fetcher, calls } = fakeFetch(okTable);
  const source = createUsageSource({ fetcher, authorize: async () => undefined });
  const snapshot = await source.read();
  assert.equal(snapshot.state, 'unconfigured');
  assert.equal(snapshot.reason, 'no-key', 'the default reason');
  assert.equal(snapshot.value, null);
  assert.equal(calls.length, 0);
});

test('explainMissing names the two configuration states', async () => {
  const { fetcher, calls } = fakeFetch(okTable);
  const source = createUsageSource({
    fetcher,
    authorize: async () => undefined,
    explainMissing: () => 'no-route',
  });
  const snapshot = await source.read();
  assert.equal(snapshot.state, 'unconfigured');
  assert.equal(snapshot.reason, 'no-route');
  assert.equal(calls.length, 0);
});

test('failures keep the last good snapshot, then the ladder holds reads back', async () => {
  let failing = false;
  const table = {
    '/users/me/plan/usage-limits': () => (failing ? json({ success: false, error: 'Invalid request format' }) : json(LIMITS)),
    '/users/me/plan': json(PLAN),
    '/users/me': json(ME),
  };
  const { fetcher, calls } = fakeFetch(table);
  let clock = 1_000_000;
  const source = createUsageSource({ fetcher, authorize: async () => `Bearer ${KEY}`, now: () => clock });
  await source.read();
  // Every attempt reads all three endpoints, so one attempt is three calls.
  const attempts = () => calls.length / 3;
  assert.equal(attempts(), 1);

  failing = true;
  clock += 61_000;
  const stale = await source.read();
  assert.equal(stale.state, 'ready', 'a known-good value keeps the ready state');
  assert.equal(stale.stale, true);
  assert.equal(stale.reason, 'gateway');
  assert.equal(stale.value.windows.length, 3, 'the old numbers survive');
  assert.equal(stale.fetchedAt, 1_000_000, 'fetchedAt still marks the last success');
  assert.equal(attempts(), 2);

  clock += 30_000;
  await source.read();
  assert.equal(attempts(), 2, 'inside the first backoff step: no request');

  clock += 31_000;
  await source.read();
  assert.equal(attempts(), 3, 'past the first backoff step: one more attempt');

  clock += 61_000;
  await source.read();
  assert.equal(attempts(), 3, 'the second step widens to two minutes');

  failing = false;
  clock += 121_000;
  const recovered = await source.read();
  assert.equal(recovered.stale, false);
  assert.equal(recovered.reason, undefined);
  assert.equal(recovered.fetchedAt, clock);
  assert.equal(attempts(), 4);

  clock += 61_000;
  await source.read();
  assert.equal(attempts(), 5, 'a success resets the ladder');
});

test('a failure with nothing known yet is an error state', async () => {
  const { fetcher } = fakeFetch({ '/users/me/plan/usage-limits': json({}, { status: 401, type: 'application/json' }) });
  const source = createUsageSource({ fetcher, authorize: async () => `Bearer ${KEY}` });
  const snapshot = await source.read();
  assert.equal(snapshot.state, 'error');
  assert.equal(snapshot.value, null);
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.reason, 'unauthorized');
});

test('timeouts, non-JSON bodies and shape drift all degrade instead of throwing', async () => {
  const timeout = new Error('This operation was aborted');
  timeout.name = 'TimeoutError';
  const source = (table) => createUsageSource({ fetcher: fakeFetch(table).fetcher, authorize: async () => 'Bearer x' });

  assert.equal((await source({ '/users/me/plan/usage-limits': timeout }).read()).reason, 'timeout');
  assert.equal((await source({ '/users/me/plan/usage-limits': json(LIMITS, { type: 'text/html' }) }).read()).reason, 'shape');
  assert.equal((await source({ '/users/me/plan/usage-limits': json({ success: true, data: { limits: [] } }) }).read()).reason, 'shape');
  assert.equal((await source({ '/users/me/plan/usage-limits': new Error('fetch failed') }).read()).reason, 'network');
});

test('a dropped plan or account read does not break the windows', async () => {
  const { fetcher } = fakeFetch({ '/users/me/plan/usage-limits': json(LIMITS) });
  const source = createUsageSource({ fetcher, authorize: async () => 'Bearer x' });
  const snapshot = await source.read();
  assert.equal(snapshot.state, 'ready');
  assert.equal(snapshot.value.windows.length, 3);
  assert.equal(snapshot.value.plan, undefined);
  assert.equal(snapshot.value.account, undefined);
});

test('windowsOf narrows hostile payloads', () => {
  const windows = windowsOf({
    limits: [
      { type: 'weekly', percentUsed: '61.5', resetsAt: '2026-10-05T23:17:49Z' },
      { type: 'weekly', percentUsed: 99, resetsAt: '2026-10-06T00:00:00Z' },
      { type: 'five_hour', percentUsed: 250 },
      { type: 'daily', percentUsed: 40, resetsAt: '2026-10-05T23:17:49Z' },
      { type: 'monthly', percentUsed: 'nope', resetsAt: 'not a date' },
      null,
      'five_hour',
    ],
  });
  assert.deepEqual(windows.map((entry) => entry.type), ['five_hour', 'weekly', 'monthly'], 'display order is fixed');
  assert.equal(windows[0].percent, 100, 'a percentage above 100 clamps');
  assert.equal(windows[0].resetsAtMs, undefined, 'a missing reset time drops only the countdown');
  assert.equal(windows[1].percent, 99, 'the last entry of a duplicated type wins');
  assert.equal(windows[2].percent, 0, 'an unparsable percentage reads as 0');
});

test('planOf ignores the internal name and the sentinel thresholds', () => {
  const plan = planOf(PLAN.data);
  assert.equal(plan.displayName, 'Cline Pass (Monthly)');
  assert.ok(!('name' in plan));
  assert.ok(!('inferenceCapThreshold' in plan));
  assert.equal(planOf({ plan: {} }).displayName, undefined);
  assert.equal(planOf(undefined), undefined);
});

test('accountOf and maskEmail', () => {
  assert.deepEqual(accountOf({ email: 'ab@example.com', displayName: 'A' }), {
    email: 'ab@example.com',
    maskedEmail: 'ab***@example.com',
    displayName: 'A',
  });
  assert.equal(accountOf({}), undefined);
  assert.equal(accountOf(undefined), undefined);
  assert.equal(maskEmail('user@example.com'), 'us***@example.com');
  assert.equal(maskEmail('a@b.c'), 'a***@b.c');
  assert.equal(maskEmail('no-at-sign'), 'no-at-sign');
  assert.equal(maskEmail('@x.com'), '@x.com');
});
