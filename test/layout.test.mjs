import { deepStrictEqual, equal, strictEqual } from 'node:assert';
import { test } from 'node:test';
import { moveCamera, normalizeLayout, resizeWidth } from '../web/layout.mjs';

test('saved layout keeps valid choices and appends newly added cameras', () => {
  deepStrictEqual(normalizeLayout(['a', 'b', 'c'], {
    order: ['b', 'removed', 'b', 'a'],
    sizes: { a: 3, b: '2', c: 0.725, removed: 2 },
  }), { order: ['b', 'a', 'c'], sizes: { a: 3, c: 0.725 } });
  deepStrictEqual(normalizeLayout(['a', 'b', 'c'], { sizes: { a: 0.499, b: 3.001, c: Infinity } }),
    { order: ['a', 'b', 'c'], sizes: {} });
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

test('corner movement continuously changes width using the feed aspect ratio', () => {
  equal(resizeWidth(600, -12, -9, 4 / 3), 588);
  equal(resizeWidth(600, -24, -18, 4 / 3), 576);
  equal(resizeWidth(600, 0, 50, 4 / 3), 624);
  equal(resizeWidth(600, 18, 32, 9 / 16), 618);
  equal(resizeWidth(600, 12, -16, 4 / 3), 600);
});
