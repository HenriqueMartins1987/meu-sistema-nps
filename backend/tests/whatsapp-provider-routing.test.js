const test = require('node:test');
const assert = require('node:assert/strict');

const whatsappProvider = require('../services/whatsappProvider');

const trackedEnvKeys = [
  'WHATSAPP_PROVIDER',
  'WHATSAPP_SYSTEM_NOTIFICATIONS_PROVIDER',
  'NPS_MESSAGING_PROVIDER',
  'NPS_WHATSAPP_SESSION_ID',
  'WHATSAPP_NPS_INSTANCE_NAME'
];

function snapshotEnv() {
  return Object.fromEntries(trackedEnvKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of trackedEnvKeys) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function clearProviderEnv() {
  for (const key of trackedEnvKeys) delete process.env[key];
}

test('routes only the configured NPS session to Twilio during phased migration', () => {
  const previous = snapshotEnv();

  try {
    clearProviderEnv();
    process.env.NPS_MESSAGING_PROVIDER = 'twilio';
    process.env.NPS_WHATSAPP_SESSION_ID = 'nps';

    assert.equal(whatsappProvider.shouldUseTwilio('nps'), true);
    assert.equal(whatsappProvider.shouldUseTwilio('garavelo'), false);
    assert.equal(whatsappProvider.shouldUseTwilio('reclamacoes'), false);
  } finally {
    restoreEnv(previous);
  }
});

test('global Twilio provider routes every WhatsApp session to Twilio', () => {
  const previous = snapshotEnv();

  try {
    clearProviderEnv();
    process.env.WHATSAPP_PROVIDER = 'twilio';

    assert.equal(whatsappProvider.shouldUseTwilio('nps'), true);
    assert.equal(whatsappProvider.shouldUseTwilio('garavelo'), true);
    assert.equal(whatsappProvider.shouldUseTwilio('qualquer-sessao'), true);
  } finally {
    restoreEnv(previous);
  }
});

test('keeps VPS routing when Twilio migration flags are not enabled', () => {
  const previous = snapshotEnv();

  try {
    clearProviderEnv();

    assert.equal(whatsappProvider.shouldUseTwilio('nps'), false);
    assert.equal(whatsappProvider.shouldUseTwilio('garavelo'), false);
  } finally {
    restoreEnv(previous);
  }
});
