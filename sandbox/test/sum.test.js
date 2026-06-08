'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sum } = require('../src/sum');

test('sum adds two positive numbers', () => {
  assert.strictEqual(sum(2, 3), 5);
});

test('sum handles negatives', () => {
  assert.strictEqual(sum(-1, 1), 0);
});
