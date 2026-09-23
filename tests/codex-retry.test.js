const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailure, invokeWithRetry, waitForRetry } = require('../src/codex');
test('capacity fallback succeeds and preserves image and cancellation options', async () => {
  const calls = []; const signal = new AbortController().signal;
  const value = await invokeWithRetry('private prompt', { imagePaths: ['a.png'], signal }, async (_, opts) => {
    calls.push(opts);
    if (calls.length === 1) throw classifyFailure('private prompt\nERROR: Selected model is at capacity.');
    return 'OK';
  }, async () => {});
  assert.equal(value, 'OK'); assert.equal(calls[1].model, 'gpt-5.6-sol');
  assert.deepEqual(calls[1].imagePaths, ['a.png']); assert.equal(calls[1].signal, signal);
  assert.ok(calls[1].timeoutMs <= calls[0].timeoutMs);
});
test('capacity retries stop after three attempts without leaking prompts', async () => {
  let calls = 0;
  await assert.rejects(invokeWithRetry('secret', {}, async () => { calls++; throw classifyFailure('secret\nERROR: Selected model is at capacity.'); }, async () => {}), e => e.code === 'CAPACITY' && !e.message.includes('secret'));
  assert.equal(calls, 3);
});
test('authentication and quota errors are not retried', async () => {
  for (const message of ['ERROR: 401 authenticate', 'ERROR: usage limit exceeded']) {
    let calls = 0;
    await assert.rejects(invokeWithRetry('', {}, async () => { calls++; throw classifyFailure(message); }));
    assert.equal(calls, 1);
  }
});
test('cancel while waiting ends retry immediately', async () => {
  const c = new AbortController();
  const p = waitForRetry(10000, c.signal); c.abort();
  await assert.rejects(p, { name: 'AbortError' });
});
test('prompt text cannot itself trigger retry classification', () => {
  assert.equal(classifyFailure('article about at capacity\nERROR: unknown failure').code, 'FAILED');
});
