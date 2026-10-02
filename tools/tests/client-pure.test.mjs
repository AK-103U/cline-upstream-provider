/**
 * dsh/client.js, the pure region: the narrowing every surface believes, the level
 * bands, and the countdown words.
 *
 * The browser half is one bundle with no build step, so the helpers cannot live in a
 * module of their own. They are marked with `/* qup:pure-begin *\/ … `/* qup:pure-end *\/`
 * markers instead, and this file slices that region (plus the constants it reads) out
 * of the shipped source into a temporary module. Testing the shipped text, not a copy:
 * if a marker moves, this fails loudly rather than testing yesterday's code.
 *
 * Run: node --test tools/tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPORTED = [
  'maskEmail', 'quotaLevel', 'pad2', 'clockText', 'resetText', 'reasonText',
  'usageOf', 'usageNote', 'emailOf', 'planLine', 'periodLine', 'shortDate',
];

/** The constants the pure region reads, up to its closing marker. */
const REGION_ANCHOR = '/** A window at or above this share earns a warning line. */';
const REGION_END = '/* qup:pure-end */';

const source = await readFile(join(ROOT, 'dsh', 'client.js'), 'utf8');
const start = source.indexOf(REGION_ANCHOR);
const end = source.indexOf(REGION_END);
assert.ok(start >= 0 && end > start, 'dsh/client.js: the pure region markers moved');
const region = source.slice(start, end + REGION_END.length);

for (const name of EXPORTED) {
  assert.match(region, new RegExp(`function ${name}\\(`), `${name} must live inside the pure region`);
}
// Comments may name the globals they explain; the code in the region must not touch them.
const bare = region.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert.doesNotMatch(bare, /\bdocument\b|\bwindow\b|\bfetch\(|React\./, 'the pure region must stay pure');

const dir = await mkdtemp(join(tmpdir(), 'cline-upstream-provider-'));
const modulePath = join(dir, 'pure.mjs');
await writeFile(modulePath, `${region}\nexport { ${EXPORTED.join(', ')} };\n`, 'utf8');
const {
  clockText,
  emailOf,
  maskEmail,
  periodLine,
  planLine,
  quotaLevel,
  reasonText,
  resetText,
  shortDate,
  usageNote,
  usageOf,
} = await import(pathToFileURL(modulePath).href);

const HOUR = 3600000;
const DAY = 24 * HOUR;

test('usageOf narrows one host answer', () => {
  const usage = usageOf({
    state: 'ready',
    reason: null,
    fetchedAt: 1_700_000_000_000,
    stale: false,
    value: {
      windows: [
        { type: 'five_hour', percent: 8, resetsAtMs: 1_700_000_000_000 + HOUR },
        { type: 'weekly', percent: 26.4, resetsAtMs: 1_700_000_000_000 + 3 * DAY },
        { type: 'monthly', percent: 250, resetsAtMs: null },
        { type: 'daily', percent: 40, resetsAtMs: 1 },
        null,
      ],
      plan: {
        displayName: 'Cline Pass (Monthly)',
        interval: 'Monthly',
        pricePerSeatCents: 999,
        periodStart: '2026-09-21',
        periodEnd: '2026-10-21',
        canceled: true,
      },
      account: { email: 'user@example.com', maskedEmail: 'us***@example.com', displayName: 'U' },
    },
  });
  assert.equal(usage.state, 'ready');
  assert.deepEqual(usage.windows.map((entry) => entry.type), ['five_hour', 'weekly', 'monthly'], 'unknown types drop');
  assert.equal(usage.windows[2].percent, 100, 'a percentage above 100 clamps');
  assert.equal(usage.windows[2].resetsAtMs, undefined, 'an unusable reset time only costs the countdown');
  assert.equal(usage.plan.price, '$9.99/Monthly');
  assert.equal(usage.plan.canceled, true);
  assert.equal(usage.plan.periodStart, '09-21', 'dates read short, like the card');
  assert.equal(usage.plan.periodEnd, '10-21');
  assert.equal(usage.account.maskedEmail, 'us***@example.com');
  assert.equal(usage.stale, false);
  assert.equal(shortDate('2026-10-21T19:35:55Z'), '10-21');
  assert.equal(shortDate('10-21'), '10-21', 'an already-short date is left alone');
  assert.equal(shortDate(''), undefined);
  assert.equal(shortDate(7), undefined);
});

test('usageOf degrades instead of throwing', () => {
  assert.equal(usageOf(undefined).state, 'error');
  assert.equal(usageOf({ state: 'nonsense' }).state, 'error');
  assert.equal(usageOf({}).windows.length, 0);
  assert.equal(usageOf({ value: 'nope' }).windows.length, 0);
  assert.equal(usageOf({ value: { windows: [{ type: 'weekly', percent: 'abc' }] } }).windows[0].percent, 0);
  assert.equal(usageOf({ value: { windows: [] }, fetchedAt: 'x' }).fetchedAt, undefined);
  assert.equal(usageOf({ value: { windows: [] }, fetchedAt: null }).fetchedAt, undefined, 'null is not epoch 0');
  assert.equal(
    usageOf({ value: { windows: [{ type: 'weekly', percent: 10, resetsAtMs: null }] } }).windows[0].resetsAtMs,
    undefined,
    'a null reset time is not epoch 0 either',
  );
  assert.equal(resetText(0, Date.now()), '', 'and it renders as no countdown, not as "any moment now"');
  assert.equal(usageOf({ value: { plan: {} } }).plan.price, undefined);
  assert.equal(usageOf({ value: { plan: { pricePerSeatCents: 100 } } }).plan.price, '$1.00');
  assert.equal(usageOf({ value: { account: {} } }).account.maskedEmail, undefined);
  assert.equal(usageOf({ state: 'unconfigured', reason: 'no-route' }).reason, 'no-route');
});

test('quotaLevel bands', () => {
  assert.equal(quotaLevel(0), 'ok');
  assert.equal(quotaLevel(49.9), 'ok');
  assert.equal(quotaLevel(50), 'warn');
  assert.equal(quotaLevel(79.9), 'warn');
  assert.equal(quotaLevel(80), 'bad');
  assert.equal(quotaLevel(100), 'bad');
});

test('resetText speaks clock time, then days, then now', () => {
  const now = new Date(2026, 9, 2, 19, 0, 0).getTime();
  assert.equal(resetText(now + 2 * HOUR + 14 * 60000, now), '21:14 重置');
  assert.equal(resetText(now + 25 * HOUR, now), '2 天后重置');
  assert.equal(resetText(now + 24 * HOUR, now), '1 天后重置');
  assert.equal(resetText(now - 1000, now), '即将重置');
  assert.equal(resetText(undefined, now), '');
  assert.equal(clockText(now), '19:00:00');
  assert.equal(clockText(undefined), '');
});

test('usageNote says why the numbers are old, or who is nearly spent', () => {
  const windows = [
    { type: 'five_hour', percent: 34 },
    { type: 'weekly', percent: 92 },
  ];
  const stale = usageNote(
    { stale: true, reason: 'timeout', fetchedAt: new Date(2026, 9, 2, 18, 2, 41).getTime(), windows },
    { notify90: true },
  );
  assert.match(stale.text, /上次刷新失败（请求超时）/);
  assert.match(stale.text, /18:02:41/);
  assert.equal(stale.level, '');

  const hot = usageNote({ stale: false, windows }, { notify90: true });
  assert.equal(hot.level, 'bad');
  assert.match(hot.text, /7d 已用 92%/);

  assert.equal(usageNote({ stale: false, windows }, { notify90: false }), null, 'the switch silences it');
  assert.equal(usageNote({ stale: false, windows: [{ type: 'weekly', percent: 89 }] }, { notify90: true }), null);
  assert.equal(usageNote({ stale: false, windows: [{ type: 'weekly', percent: 90 }] }, { notify90: true }).level, 'bad');
});

test('emailOf honours the switch, and never invents an address', () => {
  const account = { email: 'user@example.com', maskedEmail: 'us***@example.com' };
  assert.deepEqual(emailOf(account, false), { text: 'us***@example.com', masked: true });
  assert.deepEqual(emailOf(account, true), { text: 'user@example.com', masked: false });
  assert.deepEqual(emailOf({ email: 'user@example.com' }, false), { text: 'user@example.com', masked: false });
  assert.equal(emailOf(null, true), null);
  assert.equal(maskEmail('user@example.com'), 'us***@example.com');
});

test('planLine and periodLine keep the internal name and sentinels out', () => {
  assert.equal(planLine({ displayName: 'Cline Pass (Monthly)', price: '$9.99/Monthly' }), 'Cline Pass (Monthly) · $9.99/Monthly');
  assert.equal(planLine(null), null);
  assert.equal(planLine({}), null);
  assert.equal(periodLine({ periodStart: '2026-09-21', periodEnd: '2026-10-21' }), '2026-09-21 → 2026-10-21');
  assert.equal(
    periodLine({ periodStart: '2026-09-21', periodEnd: '2026-10-21', canceled: true }),
    '2026-09-21 → 2026-10-21 · 已取消，到期后失效',
  );
  assert.equal(periodLine({ canceled: true }), '已取消，到期后失效');
  assert.equal(periodLine(null), null);
});

test('reasonText maps the host tokens, with a fallback', () => {
  assert.equal(reasonText('timeout'), '请求超时');
  assert.equal(reasonText('no-route'), '这个 profile 里没有指向 api.cline.bot 的路由');
  assert.equal(reasonText('something-new'), '读取失败');
  assert.equal(reasonText(undefined), '读取失败');
});
