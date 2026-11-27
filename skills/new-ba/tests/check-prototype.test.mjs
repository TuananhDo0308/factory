import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limiter, pool } from '../scripts/check-prototype.mjs';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('pool runs every job, never more than n at once', async () => {
  let running = 0;
  let most = 0;
  const ran = [];
  const jobs = Array.from({ length: 10 }, (_, i) => async () => {
    running += 1;
    most = Math.max(most, running);
    await tick();
    ran.push(i);
    running -= 1;
  });
  let done = 0;
  await pool(jobs, 3, () => (done += 1));
  assert.equal(most, 3);
  assert.equal(done, 10);
  assert.deepEqual([...ran].sort((a, b) => a - b), [...Array(10).keys()]);
});

test('pool with no jobs returns', async () => {
  await pool([], 4);
});

test('limiter holds at most n and hands one back in order', async () => {
  const gate = limiter(2);
  const order = [];
  await gate.take();
  await gate.take();
  const third = gate.take().then(() => order.push('third'));
  const fourth = gate.take().then(() => order.push('fourth'));
  await tick();
  assert.deepEqual(order, []);
  gate.give();
  await third;
  assert.deepEqual(order, ['third']);
  gate.give();
  await fourth;
  assert.deepEqual(order, ['third', 'fourth']);
});
