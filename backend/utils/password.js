const crypto = require('crypto');

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const NUMBERS = '23456789';
const SYMBOLS = '@#$%&*!?';
const ALL_CHARS = `${UPPERCASE}${LOWERCASE}${NUMBERS}${SYMBOLS}`;

function randomChar(charset) {
  return charset[crypto.randomInt(0, charset.length)];
}

function shuffle(values) {
  const next = [...values];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function generateTemporaryPassword(length = Number(process.env.INITIAL_PASSWORD_LENGTH || 10)) {
  const safeLength = Number.isFinite(length) ? Math.max(8, Number(length)) : 10;
  const seed = [
    randomChar(UPPERCASE),
    randomChar(LOWERCASE),
    randomChar(NUMBERS),
    randomChar(SYMBOLS)
  ];

  while (seed.length < safeLength) {
    seed.push(randomChar(ALL_CHARS));
  }

  return shuffle(seed).join('');
}

module.exports = {
  generateTemporaryPassword
};
