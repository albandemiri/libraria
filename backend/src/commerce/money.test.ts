import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocate, parseMinorUnits } from './money';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('allocate', () => {
  it('splits proportionally and always sums to the total', () => {
    assert.deepEqual(allocate(100, [1, 1]), [50, 50]);
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
    assert.equal(sum(allocate(87, [499, 999, 1299])), 87);
  });

  it('gives remainders to the largest fractional parts', () => {
    // 10 * [1,2] / 3 = [3.33, 6.67] -> [3, 7]
    assert.deepEqual(allocate(10, [1, 2]), [3, 7]);
  });

  it('handles zero totals, single items and zero weights', () => {
    assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
    assert.deepEqual(allocate(42, [999]), [42]);
    assert.deepEqual(allocate(42, [0, 0]), [42, 0]);
    assert.deepEqual(allocate(42, []), []);
  });

  it('rejects fractional or negative totals', () => {
    assert.throws(() => allocate(1.5, [1]));
    assert.throws(() => allocate(-1, [1]));
  });
});

describe('parseMinorUnits', () => {
  it("parses Paddle's string amounts", () => {
    assert.equal(parseMinorUnits('1299'), 1299);
    assert.equal(parseMinorUnits('0'), 0);
    assert.equal(parseMinorUnits(15), 15);
  });

  it('rejects decimals and junk rather than guessing', () => {
    for (const value of ['12.99', '1e3', '', ' 12', null, undefined, 1.5, '99999999999999999999']) {
      assert.throws(() => parseMinorUnits(value), `${JSON.stringify(value)}`);
    }
  });
});
