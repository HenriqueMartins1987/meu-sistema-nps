const assert = require('node:assert/strict');
const test = require('node:test');

const { generateTemporaryPassword } = require('../utils/password');

test('generateTemporaryPassword defaults to a 10-character password', () => {
  const password = generateTemporaryPassword();

  assert.equal(password.length, 10);
});

test('generateTemporaryPassword respects a longer requested length', () => {
  const password = generateTemporaryPassword(16);

  assert.equal(password.length, 16);
});

test('generateTemporaryPassword enforces an 8-character minimum', () => {
  const password = generateTemporaryPassword(4);

  assert.equal(password.length, 8);
});

test('generateTemporaryPassword falls back to 10 characters for invalid input', () => {
  assert.equal(generateTemporaryPassword(NaN).length, 10);
  assert.equal(generateTemporaryPassword(undefined).length, 10);
  assert.equal(generateTemporaryPassword('abc').length, 10);
});

test('generateTemporaryPassword only uses unambiguous characters', () => {
  const password = generateTemporaryPassword(50);

  assert.doesNotMatch(password, /[IOl01]/);
  assert.match(password, /^[A-HJ-NP-Za-km-z2-9@#$%&*!?]+$/);
});

test('generateTemporaryPassword produces different values across calls', () => {
  const passwords = new Set(
    Array.from({ length: 20 }, () => generateTemporaryPassword())
  );

  assert.ok(passwords.size > 1);
});
