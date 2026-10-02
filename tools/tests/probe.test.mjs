/**
 * dsh/host/probe.js: how a probe is shaped and how its answer is read.
 *
 * This is the code that decides whether the pin control can offer a channel at all on a
 * fresh install — the case that failed on 2026-10-02 (web profile, no traffic yet): the
 * combined planner+direct shape was refused without stating a list, so the surfaces said
 * "no channel list" and the retry floor made the button look dead.
 *
 * Run: node --test tools/tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  channelListOf,
  probeBodies,
  probeReasonOf,
  splitChannels,
} from '../../dsh/host/probe.js';

test('splitChannels keeps the gateway order and drops junk', () => {
  assert.deepEqual(splitChannels('novita, deepseek,baseten'), ['novita', 'deepseek', 'baseten']);
  assert.deepEqual(splitChannels('novita deepseek  baseten'), ['novita', 'deepseek', 'baseten']);
  assert.deepEqual(splitChannels('novita,,deepseek, ,baseten'), ['novita', 'deepseek', 'baseten']);
  // The probe's own impossible channel can never come back as a real one: a leading `_`
  // fails the name shape, so it is dropped like any other junk.
  assert.deepEqual(splitChannels('novita, __probe__, -bad-, ok-2'), ['novita', 'ok-2']);
  assert.deepEqual(splitChannels(''), []);
  assert.deepEqual(splitChannels(undefined), []);
});

test('channelListOf reads the planner refusal', () => {
  const answer = JSON.stringify({
    error: { message: 'No available providers for this request. Available providers are: novita, deepseek, baseten.' },
  });
  const found = channelListOf(answer);
  assert.equal(found.pipeline, 'planner');
  assert.deepEqual(found.list, ['novita', 'deepseek', 'baseten'], 'the trailing period is not a channel');
});

test('channelListOf reads the direct refusal, whole body or SSE frame', () => {
  const whole = JSON.stringify({ error: { metadata: { available_providers: ['novita', 'modal'] } } });
  assert.deepEqual(channelListOf(whole), { list: ['novita', 'modal'], pipeline: 'direct' });

  const stream = 'data: {"id":"x"}\n\ndata: {"error":{"metadata":{"available_providers":["novita","modal"]}}}\n\ndata: [DONE]\n';
  assert.deepEqual(channelListOf(stream), { list: ['novita', 'modal'], pipeline: 'direct' });

  const topLevel = JSON.stringify({ metadata: { available_providers: ['runinfra'] } });
  assert.deepEqual(channelListOf(topLevel), { list: ['runinfra'], pipeline: 'direct' });
});

test('channelListOf states nothing rather than guessing', () => {
  assert.deepEqual(channelListOf(''), { list: [], pipeline: '' });
  assert.deepEqual(channelListOf('{"success":true}'), { list: [], pipeline: '' });
  assert.deepEqual(channelListOf('data: {"delta":"hello"}\n'), { list: [], pipeline: '' });
  assert.deepEqual(channelListOf(undefined), { list: [], pipeline: '' });
});

test('probeReasonOf quotes the gateway, not the whole body', () => {
  assert.equal(
    probeReasonOf(JSON.stringify({ error: { message: 'invalid_request_error: no such provider' } }), 400),
    'invalid_request_error: no such provider',
  );
  assert.equal(probeReasonOf('data: {"error":{"message":"stream failed"}}\n', 200), 'stream failed');
  assert.equal(probeReasonOf('plain text refusal', 500), 'plain text refusal');
  const long = probeReasonOf('x'.repeat(500), 200);
  assert.equal(long.length, 200, 'a body is sliced, never echoed whole');
  assert.equal(probeReasonOf('', 502), 'HTTP 502');
  assert.equal(probeReasonOf('', undefined), '');
});

test('probeBodies asks each shape in turn while the pipeline is unknown', () => {
  assert.deepEqual(
    probeBodies('').map((attempt) => attempt.pipeline),
    ['planner', 'direct'],
    'the planner shape goes first: it answers with the list inside its error text',
  );
  assert.deepEqual(probeBodies('planner').map((attempt) => attempt.pipeline), ['planner']);
  assert.deepEqual(probeBodies('direct').map((attempt) => attempt.pipeline), ['direct']);
});

test('probeBodies writes exactly one pipeline field per attempt', () => {
  const [planner] = probeBodies('planner');
  assert.deepEqual(planner.fields, { providerOptions: { gateway: { only: ['__probe__'] } } });
  const [direct] = probeBodies('direct', 'some-channel');
  assert.deepEqual(direct.fields, { provider: { only: ['some-channel'] } });
  for (const attempt of probeBodies('')) {
    const keys = Object.keys(attempt.fields);
    assert.equal(keys.length, 1, 'never both shapes in one request — that is what broke the probe');
  }
});
