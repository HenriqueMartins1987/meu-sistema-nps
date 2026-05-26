const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'test-key';

const whatsappProvider = require('../services/whatsappProvider');
const serverModule = require('../server');

const { app, pool } = serverModule;

const originalPoolQuery = pool.query.bind(pool);
const originalGetSessionStatus = whatsappProvider.getSessionStatus;
const originalSendMessage = whatsappProvider.sendMessage;

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

function buildQueryStub(handlers) {
  return async (sql, params) => {
    for (const handler of handlers) {
      if (handler.match(sql, params)) {
        return handler.reply(sql, params);
      }
    }

    throw new Error(`Unexpected query during test: ${sql}`);
  };
}

test.afterEach(() => {
  pool.query = originalPoolQuery;
  whatsappProvider.getSessionStatus = originalGetSessionStatus;
  whatsappProvider.sendMessage = originalSendMessage;
});

test('instance test route sends directly through whatsapp-service VPS', async () => {
  let sendPayload = null;
  let historyInsertParams = null;

  whatsappProvider.getSessionStatus = async (sessionId) => ({ status: 'connected', sessionId });
  whatsappProvider.sendMessage = async (payload) => {
    sendPayload = payload;
    return {
      provider: 'whatsapp_service',
      success: true,
      messageId: 'provider-msg-1',
      resolvedNumber: payload.number,
      attemptedNumbers: [payload.number],
      raw: { messageId: 'provider-msg-1' }
    };
  };

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{
        must_change_password: 0,
        token_version: 1,
        active: 1,
        role: 'master_admin',
        permissions: null,
        action_permissions: null
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM whatsapp_instances wi') && sql.includes('wi.instance_name = ?'),
      reply: async () => [[{
        instance_name: 'clinica-teste',
        display_name: 'Clinica Teste',
        clinic_id: 7,
        clinic_name: 'Clinica Teste',
        unit_name: 'Unidade Teste',
        phone_number: '5562999999999',
        status: 'conectado'
      }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_service_sessions'),
      reply: async () => [{ insertId: 90 }]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM whatsapp_service_sessions WHERE session_id = ?'),
      reply: async () => [[{ session_id: 'clinica-teste', status: 'conectado' }]]
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_instances') && sql.includes('last_connection_at'),
      reply: async () => [{ affectedRows: 1 }]
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_service_sessions') && sql.includes('last_status_payload'),
      reply: async () => [{ affectedRows: 1 }]
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_service_message_history'),
      reply: async (_sql, params) => {
        historyInsertParams = params;
        return [{ insertId: 45 }];
      }
    },
    {
      match: (sql) => sql.includes("UPDATE whatsapp_service_message_history") && sql.includes("status = 'enviado'"),
      reply: async () => [{ affectedRows: 1 }]
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_evolution_logs'),
      reply: async () => [{ insertId: 300 }]
    }
  ]);

  const response = await request(app)
    .post('/api/whatsapp/instances/clinica-teste/test')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['whatsapp_management'],
      clinicIds: [],
      tokenVersion: 1,
      mustChangePassword: false
    })}`)
    .send({
      patient_phone: '(62) 99966-9966',
      message_text: 'Envio de mensagem teste'
    });

  assert.equal(response.status, 202);
  assert.equal(response.body.success, true);
  assert.equal(response.body.provider, 'whatsapp_service');
  assert.equal(response.body.providerMessageId, 'provider-msg-1');
  assert.deepEqual(sendPayload, {
    sessionId: 'clinica-teste',
    number: '5562999669966',
    message: 'Envio de mensagem teste'
  });
  assert.deepEqual(historyInsertParams.slice(0, 4), [
    'clinica-teste',
    '5562999669966',
    'Envio de mensagem teste',
    'Administrador Master'
  ]);
});
