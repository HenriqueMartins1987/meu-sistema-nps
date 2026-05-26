const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

const whatsappProvider = require('../services/whatsappProvider');
const serverModule = require('../server');

const { app, pool } = serverModule;

const originalPoolQuery = pool.query.bind(pool);
const originalGetSessionStatus = whatsappProvider.getSessionStatus;
const originalSendMessage = whatsappProvider.sendMessage;
const originalSendText = whatsappProvider.sendText;

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
  whatsappProvider.sendText = originalSendText;
});

test('instance test route sends directly through whatsapp-service VPS', async (t) => {
  const previousApiKey = process.env.WHATSAPP_API_KEY;
  process.env.WHATSAPP_API_KEY = previousApiKey || 'test-key';
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.WHATSAPP_API_KEY;
    else process.env.WHATSAPP_API_KEY = previousApiKey;
  });

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

test('dispatch queue does not retry after VPS accepted a message and history logging fails', async (t) => {
  const previousApiKey = process.env.WHATSAPP_API_KEY;
  process.env.WHATSAPP_API_KEY = previousApiKey || 'test-key';
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.WHATSAPP_API_KEY;
    else process.env.WHATSAPP_API_KEY = previousApiKey;
  });

  let sendCount = 0;
  let retryUpdateSeen = false;
  let sentQueueUpdateSeen = false;
  let sentMessageUpdateSeen = false;

  whatsappProvider.sendText = async (payload) => {
    sendCount += 1;
    assert.equal(payload.sessionId, 'garavelo');
    assert.equal(payload.number, '5562999669966');
    return {
      provider: 'whatsapp_service',
      success: true,
      messageId: 'provider-ok-1',
      raw: { messageId: 'provider-ok-1' }
    };
  };

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('FROM whatsapp_dispatch_queue') && sql.includes("WHERE status = 'pendente'") && sql.includes('scheduled_at <= NOW()'),
      reply: async () => [[{
        id: 900,
        message_id: 901,
        conversation_id: 902,
        instance_name: 'garavelo',
        recipient_phone: '5562999669966',
        message_text: 'Mensagem de confirmacao',
        message_type: 'confirmacao_massa',
        status: 'pendente',
        attempts: 0,
        anti_ban_delay_ms: 1000,
        operator_name: 'Fila WhatsApp CRC',
        payload: '{}'
      }]]
    },
    {
      match: (sql) => sql.includes('FROM whatsapp_dispatch_queue') && sql.includes("status = 'enviada'") && sql.includes('id <> ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_instances') && sql.includes('messages_sent_today = CASE'),
      reply: async () => [{ affectedRows: 1 }]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM whatsapp_instances WHERE instance_name = ? LIMIT 1'),
      reply: async () => [[{ instance_name: 'garavelo', daily_send_limit: 30, messages_sent_today: 0 }]]
    },
    {
      match: (sql) => sql.includes('SELECT COUNT(*) AS total') && sql.includes('FROM whatsapp_dispatch_queue'),
      reply: async () => [[{ total: 0 }]]
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_dispatch_queue') && sql.includes("SET status = 'processando'"),
      reply: async () => [{ affectedRows: 1 }]
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_dispatch_queue') && sql.includes("SET status = 'enviada'"),
      reply: async () => {
        sentQueueUpdateSeen = true;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_messages') && sql.includes("SET status = 'enviada'"),
      reply: async () => {
        sentMessageUpdateSeen = true;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_service_message_history'),
      reply: async () => {
        throw new Error('history db down');
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_evolution_logs'),
      reply: async (_sql, params) => {
        assert.equal(params[0], 'send_message_postprocess_error');
        assert.equal(params[5], 'warning');
        return [{ insertId: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_dispatch_queue') && sql.includes('SET status = ?'),
      reply: async () => {
        retryUpdateSeen = true;
        return [{ affectedRows: 1 }];
      }
    }
  ]);

  await serverModule.__testables.processWhatsAppDispatchQueue();

  assert.equal(sendCount, 1);
  assert.equal(sentQueueUpdateSeen, true);
  assert.equal(sentMessageUpdateSeen, true);
  assert.equal(retryUpdateSeen, false);
});

test('enqueueWhatsAppDispatch suppresses recent duplicate before inserting queue item', async () => {
  let messageCanceled = false;
  let duplicateLogged = false;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('FROM whatsapp_dispatch_queue') && sql.includes("status IN ('pendente', 'processando', 'enviada')"),
      reply: async (_sql, params) => {
        assert.deepEqual(params.slice(0, 4), [
          'garavelo',
          '5562999669966',
          'Mensagem de confirmacao',
          'confirmacao_massa'
        ]);
        return [[{
          id: 700,
          message_id: 701,
          instance_name: 'garavelo',
          recipient_phone: '5562999669966',
          message_text: 'Mensagem de confirmacao',
          message_type: 'confirmacao_massa',
          status: 'pendente'
        }]];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_messages') && sql.includes("SET status = 'cancelada'"),
      reply: async (_sql, params) => {
        messageCanceled = true;
        assert.equal(params[1], 702);
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_evolution_logs'),
      reply: async (_sql, params) => {
        duplicateLogged = true;
        assert.equal(params[0], 'dispatch_duplicate_enqueue_suppressed');
        return [{ insertId: 1 }];
      }
    }
  ]);

  const result = await serverModule.__testables.enqueueWhatsAppDispatch({
    message_id: 702,
    instance_name: 'garavelo',
    recipient_phone: '(62) 99966-9966',
    message_text: 'Mensagem de confirmacao',
    message_type: 'confirmacao_massa'
  });

  assert.equal(result.id, 700);
  assert.equal(result.duplicateSuppressed, true);
  assert.equal(messageCanceled, true);
  assert.equal(duplicateLogged, true);
});

test('mass campaign routing refreshes stale clinic status from VPS before blocking', async () => {
  const previousApiKey = process.env.WHATSAPP_API_KEY;
  process.env.WHATSAPP_API_KEY = 'test-key';
  let statusChecked = false;
  let instanceStatusUpdated = false;

  whatsappProvider.getSessionStatus = async (sessionId) => {
    statusChecked = true;
    assert.equal(sessionId, 'garavelo');
    return { status: 'connected', sessionId };
  };

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT *') && sql.includes('FROM whatsapp_instances') && sql.includes('WHERE clinic_id = ?'),
      reply: async (_sql, params) => {
        assert.equal(params[0], 5);
        return [[{
          instance_name: 'garavelo',
          display_name: 'Garavelo',
          clinic_id: 5,
          clinic_name: 'Garavelo',
          sector: 'Confirmação e Agendamento',
          status: 'desconectado',
          updated_at: '2026-05-26 10:00:00'
        }]];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_instances') && sql.includes('last_connection_at'),
      reply: async (_sql, params) => {
        instanceStatusUpdated = true;
        assert.equal(params[0], 'conectado');
        assert.equal(params[5], 'garavelo');
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_service_sessions') && sql.includes('last_status_payload'),
      reply: async (_sql, params) => {
        assert.equal(params[0], 'conectado');
        assert.equal(params[3], 'garavelo');
        return [{ affectedRows: 1 }];
      }
    }
  ]);

  try {
    const instance = await serverModule.__testables.findWhatsAppInstanceByClinic({
      clinicId: 5,
      clinicName: 'Garavelo',
      preferredSector: 'Confirmacao e Agendamento'
    });

    assert.equal(statusChecked, true);
    assert.equal(instanceStatusUpdated, true);
    assert.equal(instance.status, 'conectado');
    assert.equal(serverModule.__testables.isWhatsAppConnectedStatus(instance.status), true);
  } finally {
    if (previousApiKey === undefined) delete process.env.WHATSAPP_API_KEY;
    else process.env.WHATSAPP_API_KEY = previousApiKey;
  }
});
