const test = require('node:test');
const assert = require('node:assert/strict');

const whatsappVpsService = require('../services/whatsappVpsService');

test('getConfig keeps the VPS fallback configured without exposing it to the frontend', () => {
  const previousApiKey = process.env.WHATSAPP_API_KEY;
  const previousServiceApiKey = process.env.WHATSAPP_SERVICE_API_KEY;
  const previousDefaultApiKey = process.env.WHATSAPP_SERVICE_DEFAULT_API_KEY;
  delete process.env.WHATSAPP_API_KEY;
  delete process.env.WHATSAPP_SERVICE_API_KEY;
  process.env.WHATSAPP_SERVICE_DEFAULT_API_KEY = 'senha_teste_123';

  const config = whatsappVpsService.getConfig({ baseURL: 'http://2.24.101.6:3005' });

  assert.equal(config.configured, true);
  assert.equal(config.apiKeyConfigured, true);
  assert.deepEqual(config.missing, []);

  if (previousApiKey === undefined) delete process.env.WHATSAPP_API_KEY;
  else process.env.WHATSAPP_API_KEY = previousApiKey;
  if (previousServiceApiKey === undefined) delete process.env.WHATSAPP_SERVICE_API_KEY;
  else process.env.WHATSAPP_SERVICE_API_KEY = previousServiceApiKey;
  if (previousDefaultApiKey === undefined) delete process.env.WHATSAPP_SERVICE_DEFAULT_API_KEY;
  else process.env.WHATSAPP_SERVICE_DEFAULT_API_KEY = previousDefaultApiKey;
});

test('buildWhatsAppNumberVariants tries Brazilian mobile with and without ninth digit', () => {
  assert.deepEqual(
    whatsappVpsService.buildWhatsAppNumberVariants('5562999669966'),
    ['5562999669966', '556299669966']
  );
  assert.deepEqual(
    whatsappVpsService.buildWhatsAppNumberVariants('556299669966'),
    ['556299669966', '5562999669966']
  );
  assert.deepEqual(
    whatsappVpsService.buildWhatsAppNumberVariants('(62) 99966-9966'),
    ['5562999669966', '556299669966']
  );
});

test('sendMessage retries the alternate phone format when whatsapp-service cannot resolve LID', async () => {
  const calls = [];
  const apiClient = {
    async post(path, payload, options) {
      calls.push({ path, payload, options });
      if (calls.length === 1) {
        const error = new Error('Request failed');
        error.response = { data: { error: 'No LID for user' } };
        throw error;
      }
      return { data: { success: true } };
    }
  };

  const result = await whatsappVpsService.sendMessage({
    sessionId: 'reclamacoes',
    number: '5562999669966',
    message: 'teste'
  }, { apiClient });

  assert.deepEqual(calls.map((call) => call.payload.number), ['5562999669966', '556299669966']);
  assert.equal(result.success, true);
  assert.equal(result.resolvedNumber, '556299669966');
  assert.deepEqual(result.attemptedNumbers, ['5562999669966', '556299669966']);
});

test('sendMessage forwards idempotency key to whatsapp-service payload and headers', async () => {
  const calls = [];
  const apiClient = {
    async post(path, payload, options) {
      calls.push({ path, payload, options });
      return { data: { success: true, messageId: 'idem-1' } };
    }
  };

  const result = await whatsappVpsService.sendMessage({
    sessionId: 'canaa',
    number: '5562999669966',
    message: 'teste',
    idempotencyKey: 'dispatch-key-123'
  }, { apiClient });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.idempotencyKey, 'dispatch-key-123');
  assert.equal(calls[0].payload.clientRequestId, 'dispatch-key-123');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'dispatch-key-123');
  assert.equal(calls[0].options.headers['x-idempotency-key'], 'dispatch-key-123');
});

test('friendlyApiError hides whatsapp-web.js internal comms stack', () => {
  const error = new Error('[comms] sendIq called before startComms s (https://static.whatsapp.net/example.js:79:180)');

  const message = whatsappVpsService.friendlyApiError(error);

  assert.match(message, /sessão do WhatsApp/i);
  assert.doesNotMatch(message, /static\.whatsapp\.net/i);
  assert.doesNotMatch(message, /sendIq/i);
});

test('sendMessage reconnects once when whatsapp-web.js comms are not ready', async () => {
  const calls = [];
  const apiClient = {
    async post(path, payload) {
      calls.push({ path, payload });
      if (path === '/messages/send' && calls.filter((call) => call.path === '/messages/send').length === 1) {
        const error = new Error('[comms] sendIq called before startComms');
        error.response = { data: { error: '[comms] sendIq called before startComms' } };
        throw error;
      }
      return { data: { success: true, messageId: 'ok-1' } };
    }
  };

  const result = await whatsappVpsService.sendMessage({
    sessionId: 'garavelo',
    number: '5562993005353',
    message: 'teste'
  }, { apiClient, reconnectDelayMs: 1 });

  assert.deepEqual(calls.map((call) => call.path), ['/messages/send', '/sessions/start', '/messages/send']);
  assert.equal(calls[1].payload.sessionId, 'garavelo');
  assert.equal(result.success, true);
  assert.equal(result.recoveredSession, true);
});
