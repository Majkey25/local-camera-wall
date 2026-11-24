import { deepStrictEqual, equal, strictEqual } from 'node:assert';
import { test } from 'node:test';
import { moveCamera, normalizeLayout, resizeStep } from '../web/layout.mjs';

test('saved layout keeps valid choices and appends newly added cameras', () => {
  deepStrictEqual(normalizeLayout(['a', 'b', 'c'], {
    order: ['b', 'removed', 'b', 'a'],
    sizes: { a: 3, b: '2', removed: 2 },
  }), { order: ['b', 'a', 'c'], sizes: { a: 3 } });
  deepStrictEqual(normalizeLayout(['a', 'b'], { b: 2 }), { order: ['a', 'b'], sizes: { b: 2 } });
  deepStrictEqual(normalizeLayout(['a', 'b'], null, ['a', 'removed']), { order: ['a', 'b'], sizes: { a: 2 } });
  deepStrictEqual(normalizeLayout(['a', 'b'], { order: [], sizes: {} }, ['a']), { order: ['a', 'b'], sizes: {} });
});

test('moving a camera inserts it at the target position without mutating the original order', () => {
  const order = ['a', 'b', 'c', 'd'];
  deepStrictEqual(moveCamera(order, 'a', 2), ['b', 'c', 'a', 'd']);
  deepStrictEqual(moveCamera(order, 'd', 1), ['a', 'd', 'b', 'c']);
  strictEqual(moveCamera(order, 'b', 1), order);
  strictEqual(moveCamera(order, 'a', 4), order);
  strictEqual(moveCamera(order, 'missing', 0), order);
  deepStrictEqual(order, ['a', 'b', 'c', 'd']);
});

test('resize responds to the dominant axis and stays within the supported sizes', () => {
  equal(resizeStep(1, 30, 0, 100), 1);
  equal(resizeStep(1, 80, 0, 100), 2);
  equal(resizeStep(2, 0, 40, 100), 3);
  equal(resizeStep(3, -170, 20, 100), 1);
  equal(resizeStep(2, 500, 0, 100), 3);
});
