const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.WHATSAPP_ENABLED = 'false';
process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'log';

const emailService = require('../services/emailService');
const serverModule = require('../server');

const { app, pool } = serverModule;

const originalPoolQuery = pool.query.bind(pool);
const originalSendWelcomeEmail = emailService.sendWelcomeEmail;
const originalSendEmail = emailService.sendEmail;

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
  emailService.sendWelcomeEmail = originalSendWelcomeEmail;
  emailService.sendEmail = originalSendEmail;
});

test('weekly demand reminder schedule runs once on Monday after configured hour', async () => {
  const mondayAtEightSaoPaulo = new Date('2026-05-04T11:00:00.000Z');
  const mondayBeforeEightSaoPaulo = new Date('2026-05-04T10:59:00.000Z');
  const jobKey = serverModule.__testables.buildWeeklyUserDemandReminderJobKey(mondayAtEightSaoPaulo);

  assert.equal(jobKey, 'weekly_user_demand_reminder:2026-W19');
  assert.equal(
    await serverModule.__testables.shouldRunWeeklyUserDemandReminders(jobKey, mondayBeforeEightSaoPaulo),
    false
  );

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT id FROM system_job_runs WHERE job_key = ?'),
      reply: async () => [[]]
    }
  ]);

  assert.equal(
    await serverModule.__testables.shouldRunWeeklyUserDemandReminders(jobKey, mondayAtEightSaoPaulo),
    true
  );

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT id FROM system_job_runs WHERE job_key = ?'),
      reply: async () => [[{ id: 1 }]]
    }
  ]);

  assert.equal(
    await serverModule.__testables.shouldRunWeeklyUserDemandReminders(jobKey, mondayAtEightSaoPaulo),
    false
  );
});

test('admin user creation keeps the user when welcome e-mail fails', async () => {
  let insertedUserParams = null;

  emailService.sendWelcomeEmail = async () => {
    throw new Error('Resend indisponível');
  };

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM users WHERE LOWER(email) = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM users WHERE LOWER(username) = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO users'),
      reply: async (_sql, params) => {
        insertedUserParams = params;
        return [{ insertId: 77 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO notification_events'),
      reply: async () => [{ insertId: 1 }]
    }
  ]);

  const response = await request(app)
    .post('/admin/users')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['admin_panel'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      name: 'Maria Silva',
      email: 'maria@example.com',
      role: 'viewer',
      position: 'Marketing',
      phone: '+5562999999999',
      whatsapp: '+5562999999999',
      department: 'Relacionamento'
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.id, 77);
  assert.equal(response.body.notifications.emailSent, false);
  assert.match(response.body.warning, /falha no envio do e-mail/i);
  assert.ok(insertedUserParams);
  assert.equal(insertedUserParams[1], 'maria');
  assert.match(insertedUserParams[3], /^\$2[aby]\$/);
  assert.equal(insertedUserParams[insertedUserParams.length - 1], 1);
});

test('CRC operator self-registration stays inactive and notifies master for approval', async () => {
  let insertedUserSql = null;
  let insertedUserParams = null;
  let notificationParams = null;
  let emailSent = null;

  emailService.sendEmail = async (payload) => {
    emailSent = payload;
    return { provider: 'test', from: 'noreply@example.com', id: 'email-1' };
  };

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT id') && sql.includes('LOWER(username) = ?') && sql.includes('FROM users'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO users') && sql.includes("'crc_operator'"),
      reply: async (sql, params) => {
        insertedUserSql = sql;
        insertedUserParams = params;
        return [{ insertId: 155 }];
      }
    },
    {
      match: (sql) => sql.includes('SELECT id') && sql.includes('role IN') && sql.includes('deleted_at IS NULL') && sql.includes('FROM users'),
      reply: async () => [[{ id: 1 }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO notification_events'),
      reply: async (_sql, params) => {
        notificationParams = params;
        return [{ insertId: 900 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO email_delivery_logs'),
      reply: async () => [{ insertId: 22 }]
    }
  ]);

  const response = await request(app)
    .post('/auth/crc-operator/register')
    .send({
      name: 'Paula Operadora CRC',
      username: 'paula.crc',
      email: 'paula.crc@example.com',
      phone: '+5562999999999',
      password: 'Senha@123'
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.pendingAuthorization, true);
  assert.match(response.body.message, /Administrador Master foi notificado/i);
  assert.match(insertedUserSql, /active,\s*must_change_password,\s*authorization_status\)\s*VALUES[\s\S]+0,\s*0,\s*'pendente'\)/);
  assert.equal(insertedUserParams[0], 'Paula Operadora CRC');
  assert.equal(insertedUserParams[1], 'paula.crc');
  assert.equal(insertedUserParams[2], 'paula.crc@example.com');
  assert.match(insertedUserParams[3], /^\$2[aby]\$/);
  assert.equal(notificationParams[0], 1);
  assert.equal(notificationParams[1], 'crc_operator_approval_required');
  assert.match(notificationParams[3], /Paula Operadora CRC solicitou acesso/);
  assert.ok(emailSent);
  assert.match(emailSent.subject, /Operador de CRC aguardando autorização/);
});

test('master admin can update a user e-mail from user management', async () => {
  let updateUserSql = null;
  let updateUserParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL'),
      reply: async () => [[{
        id: 44,
        name: 'Maria Silva',
        email: 'maria.antigo@example.com',
        role: 'viewer',
        position: 'Marketing',
        phone: '+5562999999999',
        whatsapp: '+5562999999999',
        department: 'Relacionamento',
        permissions: '[]',
        active: 1
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? AND deleted_at IS NULL'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM users WHERE LOWER(username) = ? AND id <> ? LIMIT 1'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('UPDATE users') && sql.includes('email = ?'),
      reply: async (sql, params) => {
        updateUserSql = sql;
        updateUserParams = params;
        return [{ affectedRows: 1 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/admin/users/44')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['admin_panel'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      name: 'Maria Silva',
      email: 'maria.novo@example.com',
      role: 'viewer',
      position: 'Marketing',
      phone: '+5562999999999',
      whatsapp: '+5562999999999',
      department: 'Relacionamento',
      active: true,
      permissions: []
    });

  assert.equal(response.status, 200);
  assert.match(updateUserSql, /email = \?/);
  assert.equal(updateUserParams[0], 'Maria Silva');
  assert.equal(updateUserParams[1], 'maria.novo');
  assert.equal(updateUserParams[2], 'maria.novo@example.com');
  assert.equal(updateUserParams.at(-1), 44);
});

test('master admin cannot update a user to duplicated e-mail', async () => {
  let updateAttempted = false;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL'),
      reply: async () => [[{
        id: 44,
        name: 'Maria Silva',
        email: 'maria.antigo@example.com',
        role: 'viewer',
        position: 'Marketing',
        phone: '+5562999999999',
        whatsapp: '+5562999999999',
        department: 'Relacionamento',
        permissions: '[]',
        active: 1
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? AND deleted_at IS NULL'),
      reply: async () => [[{ id: 88 }]]
    },
    {
      match: (sql) => sql.includes('UPDATE users'),
      reply: async () => {
        updateAttempted = true;
        return [{ affectedRows: 1 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/admin/users/44')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['admin_panel'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      email: 'duplicado@example.com',
      phone: '+5562999999999',
      whatsapp: '+5562999999999'
    });

  assert.equal(response.status, 409);
  assert.equal(updateAttempted, false);
});

test('login reports first access requirement and blocks protected routes', async () => {
  const temporaryPassword = 'Tmp@12345';
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT * FROM users WHERE LOWER(email) = ?'),
      reply: async () => [[{
        id: 9,
        name: 'Ana Teste',
        email: 'ana@example.com',
        password: passwordHash,
        role: 'viewer',
        permissions: '[]',
        active: 1,
        deleted_at: null,
        must_change_password: 1
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 1, token_version: 1, active: 1 }]]
    }
  ]);

  const loginResponse = await request(app)
    .post('/login')
    .send({
      email: 'ana@example.com',
      password: temporaryPassword
    });

  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.body.passwordChangeRequired, true);
  assert.equal(loginResponse.body.user.mustChangePassword, true);

  const blockedResponse = await request(app)
    .get('/admin/options')
    .set('Authorization', `Bearer ${loginResponse.body.token}`);

  assert.equal(blockedResponse.status, 403);
  assert.equal(blockedResponse.body.mustChangePassword, true);
});

test('change-initial-password clears must_change_password and returns refreshed auth payload', async () => {
  const currentPassword = 'Tmp@12345';
  const passwordHash = await bcrypt.hash(currentPassword, 10);
  let updateParams = null;

  emailService.sendEmail = async () => ({ provider: 'mock', id: 'mail-1' });

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 1, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT id, name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password, token_version, created_at, updated_at'),
      reply: async () => [[{
        id: 9,
        name: 'Ana Teste',
        email: 'ana@example.com',
        password: passwordHash,
        role: 'viewer',
        position: 'Marketing',
        phone: '+5562999999999',
        whatsapp: '+5562999999999',
        department: null,
        permissions: '[]',
        active: 1,
        must_change_password: 1,
        token_version: 1,
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE users SET password = ?, must_change_password = 0, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?'),
      reply: async (_sql, params) => {
        updateParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('SELECT id, name, email, role, position, phone, whatsapp, department, permissions, active, must_change_password, token_version, created_at, updated_at'),
      reply: async () => [[{
        id: 9,
        name: 'Ana Teste',
        email: 'ana@example.com',
        role: 'viewer',
        position: 'Marketing',
        phone: '+5562999999999',
        whatsapp: '+5562999999999',
        department: null,
        permissions: '[]',
        active: 1,
        must_change_password: 0,
        token_version: 2,
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    }
  ]);

  const response = await request(app)
    .post('/api/change-initial-password')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'ana@example.com',
      role: 'viewer',
      name: 'Ana Teste',
      permissions: [],
      clinicIds: [],
      mustChangePassword: true
    })}`)
    .send({
      current_password: currentPassword,
      new_password: 'Nova@12345'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.mustChangePassword, false);
  assert.ok(response.body.token);
  assert.ok(updateParams);
  assert.match(updateParams[0], /^\$2[aby]\$/);
  assert.equal(updateParams[1], 9);
});

test('test-email route sends a dedicated validation message', async () => {
  let emailPayload = null;

  emailService.sendEmail = async (payload) => {
    emailPayload = payload;
    return {
      provider: 'mock',
      id: 'email-123',
      skipped: false,
      to: payload.to
    };
  };

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_message_logs'),
      reply: async () => [{ insertId: 1 }]
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_message_logs'),
      reply: async () => [{ affectedRows: 1 }]
    }
  ]);

  const response = await request(app)
    .post('/api/test-email')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['admin_panel'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      to: 'teste@example.com',
      name: 'Usuário Teste',
      loginEmail: 'teste@example.com',
      password: 'Tmp@12345'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.to, 'teste@example.com');
  assert.equal(response.body.messageId, 'email-123');
  assert.equal(emailPayload.to, 'teste@example.com');
  assert.equal(emailPayload.subject, 'Teste de e-mail - Sistema GRC');
  assert.match(emailPayload.html, /Canal de e-mail validado/);
  assert.doesNotMatch(emailPayload.html, /Tmp@12345/);
});

test('manual WhatsApp route accepts telefone and mensagem payload', async () => {
  const previousWhatsAppEnabled = process.env.WHATSAPP_ENABLED;
  const previousTwilioSid = process.env.TWILIO_ACCOUNT_SID;
  const previousTwilioToken = process.env.TWILIO_AUTH_TOKEN;

  process.env.WHATSAPP_ENABLED = 'true';
  process.env.TWILIO_ACCOUNT_SID = '';
  process.env.TWILIO_AUTH_TOKEN = '';

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_message_logs'),
      reply: async () => [{ insertId: 1 }]
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_message_logs'),
      reply: async () => [{ affectedRows: 1 }]
    }
  ]);

  try {
    const response = await request(app)
      .post('/api/whatsapp/enviar')
      .set('Authorization', `Bearer ${signToken({
        id: 1,
        email: 'henrique.martins@grcconsultoria.net.br',
        role: 'master_admin',
        name: 'Administrador Master',
        permissions: ['admin_panel'],
        clinicIds: [],
        mustChangePassword: false
      })}`)
      .send({
        telefone: '+55 (62) 99966-9966',
        mensagem: 'Teste manual de WhatsApp'
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, false);
    assert.equal(response.body.provider, 'twilio');
    assert.equal(response.body.to, '5562999669966');
    assert.match(response.body.warning, /twilio|configur/i);
  } finally {
    if (previousWhatsAppEnabled === undefined) {
      delete process.env.WHATSAPP_ENABLED;
    } else {
      process.env.WHATSAPP_ENABLED = previousWhatsAppEnabled;
    }

    if (previousTwilioSid === undefined) {
      delete process.env.TWILIO_ACCOUNT_SID;
    } else {
      process.env.TWILIO_ACCOUNT_SID = previousTwilioSid;
    }

    if (previousTwilioToken === undefined) {
      delete process.env.TWILIO_AUTH_TOKEN;
    } else {
      process.env.TWILIO_AUTH_TOKEN = previousTwilioToken;
    }
  }
});

test('test WhatsApp route sends the fixed management message', async () => {
  let whatsappLogParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO whatsapp_message_logs'),
      reply: async (_sql, params) => {
        whatsappLogParams = params;
        return [{ insertId: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE whatsapp_message_logs'),
      reply: async () => [{ affectedRows: 1 }]
    }
  ]);

  const response = await request(app)
    .post('/api/test-whatsapp')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['admin_panel'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      telefone: '+55 (62) 99966-9966',
      mensagem: 'Mensagem ignorada pelo teste'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.to, '5562999669966');
  assert.ok(whatsappLogParams);
  assert.equal(whatsappLogParams[0], 'manual_test');
  assert.equal(whatsappLogParams[6], 'Envio de mensagem teste');
});

test('master admin can resend temporary passwords to users pending first password change', async () => {
  const updatedUsers = [];

  emailService.sendEmail = async () => ({ provider: 'mock', id: 'mail-bulk-1' });

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('FROM users') && sql.includes('must_change_password = 1'),
      reply: async () => [[
        {
          id: 21,
          role: 'viewer',
          email: 'ana@example.com',
          name: 'Ana Teste',
          phone: '+5562999999999',
          whatsapp: '+5562999999999'
        },
        {
          id: 22,
          role: 'coordinator',
          email: 'bruno@example.com',
          name: 'Bruno Gestor',
          phone: '+5562888888888',
          whatsapp: '+5562888888888'
        }
      ]]
    },
    {
      match: (sql) => sql.includes('UPDATE users SET password = ?, must_change_password = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?'),
      reply: async (_sql, params) => {
        updatedUsers.push(params[2]);
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO notification_events'),
      reply: async () => [{ insertId: 1 }]
    },
    {
      match: (sql) => sql.includes('INSERT INTO email_delivery_logs'),
      reply: async () => [{ insertId: 1 }]
    }
  ]);

  const response = await request(app)
    .post('/admin/users/resend-pending-passwords')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['admin_panel'],
      clinicIds: [],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.summary.processed, 2);
  assert.equal(response.body.summary.sent, 2);
  assert.equal(response.body.summary.failed, 0);
  assert.deepEqual(updatedUsers, [21, 22]);
});

test('authenticated operational user can delete complaint evidence with audit trail', async () => {
  let updateEvidenceParams = null;
  let complaintLogParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async () => [[{
        id: 45,
        protocol: 'GRC-2026-000045',
        attachment_url: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('WHERE id = ?') && sql.includes('deleted_at IS NULL'),
      reply: async () => [[{
        id: 22,
        complaint_id: 45,
        file_url: '/uploads/evidencia-inexistente.txt',
        original_name: 'comprovante.pdf',
        description: 'Comprovante da tratativa',
        uploaded_by_name: 'Ana',
        uploaded_by_role: 'viewer',
        created_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE complaint_evidences') && sql.includes('deleted_at = NOW()'),
      reply: async (_sql, params) => {
        updateEvidenceParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO complaint_logs'),
      reply: async (_sql, params) => {
        complaintLogParams = params;
        return [{ insertId: 2 }];
      }
    },
    {
      match: (sql) => sql.includes('CREATE TABLE IF NOT EXISTS uploaded_files'),
      reply: async () => [{ affectedRows: 0 }]
    },
    {
      match: (sql) => sql.includes('DELETE FROM uploaded_files WHERE filename = ?'),
      reply: async () => [{ affectedRows: 1 }]
    }
  ]);

  const response = await request(app)
    .delete('/complaints/45/evidences/22')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({ reason: 'Arquivo anexado incorretamente.' });

  assert.equal(response.status, 200);
  assert.equal(response.body.message, 'Evidência excluída com sucesso.');
  assert.deepEqual(updateEvidenceParams.slice(0, 3), [
    'Operador SAC',
    'sac_operator',
    'Arquivo anexado incorretamente.'
  ]);
  assert.equal(updateEvidenceParams[3], '22');
  assert.equal(updateEvidenceParams[4], '45');
  assert.equal(complaintLogParams[1], 'evidence_deleted');
  assert.match(complaintLogParams[2], /Comprovante da tratativa/);
  assert.match(complaintLogParams[2], /Arquivo anexado incorretamente/);
  assert.equal(complaintLogParams[3], 'Operador SAC');
  assert.equal(complaintLogParams[4], 'sac_operator');
});

test('marketing viewer can list every complaint without assignment scope', async () => {
  let complaintQuerySql = '';
  let complaintQueryParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('c.deleted_at IS NULL'),
      reply: async (sql, params) => {
        complaintQuerySql = sql;
        complaintQueryParams = params;

        return [[{
          id: 77,
          protocol: 'GRC-2026-000077',
          patient_name: 'Paciente Marketing',
          status: 'aberta',
          forwarded_to_role: 'coordinator',
          assigned_responsible_user_id: 44,
          attachment_url: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date()
        }]];
      }
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    }
  ]);

  const response = await request(app)
    .get('/complaints')
    .set('Authorization', `Bearer ${signToken({
      id: 12,
      email: 'marketing@example.com',
      role: 'viewer',
      name: 'Marketing Teste',
      permissions: ['complaints_management'],
      clinicIds: [],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body[0].id, 77);
  assert.doesNotMatch(complaintQuerySql, /assigned_responsible_user_id = \?/);
  assert.doesNotMatch(complaintQuerySql, /forwarded_to_role = \?/);
  assert.doesNotMatch(complaintQuerySql, /clinic_id IN \(\?\)/);
});

test('marketing viewer cannot edit complaint data', async () => {
  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async () => [[{
        id: 45,
        protocol: 'GRC-2026-000045',
        patient_name: 'Paciente Marketing',
        status: 'aberta',
        priority: 'media',
        operator_comment: null,
        attachment_url: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    }
  ]);

  const response = await request(app)
    .patch('/complaints/45')
    .set('Authorization', `Bearer ${signToken({
      id: 12,
      email: 'marketing@example.com',
      role: 'viewer',
      name: 'Marketing Teste',
      permissions: ['complaints_management'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({ priority: 'alta', operator_comment: 'Tentativa de alteração' });

  assert.equal(response.status, 403);
  assert.match(response.body.error, /Marketing pode consultar protocolos, anexar evidências e corrigir unidade\/telefone/);
});

test('coordinator can open complaint assigned through coordinator scope', async () => {
  let complaintQuerySql = '';
  let complaintQueryParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 5 }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async (sql, params) => {
        complaintQuerySql = sql;
        complaintQueryParams = params;

        return [[{
          id: 88,
          protocol: 'GRC-2026-000088',
          clinic_id: 5,
          patient_name: 'Paciente Teste',
          patient_phone: '+5562999999999',
          status: 'em_andamento',
          forwarded_to_role: 'coordinator',
          forwarded_to_label: 'Coordenador Teste',
          assigned_coordinator_user_id: 17,
          assigned_coordinator_name: 'Coordenador Teste',
          assigned_responsible_user_id: null,
          assigned_responsible_name: 'Coordenador Teste',
          assigned_responsible_role: 'coordinator',
          attachment_url: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date()
        }]];
      }
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    }
  ]);

  const response = await request(app)
    .get('/complaints/88')
    .set('Authorization', `Bearer ${signToken({
      id: 17,
      email: 'coordenador@example.com',
      role: 'coordinator',
      name: 'Coordenador Teste',
      permissions: [],
      clinicIds: [5],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.id, 88);
  assert.match(complaintQuerySql, /assigned_coordinator_user_id = \?/);
  assert.match(complaintQuerySql, /c\.forwarded_to_role/);
  assert.match(complaintQuerySql, /c\.clinic_id IN \(\?\)/);
  assert.ok(Array.isArray(complaintQueryParams));
  assert.ok(complaintQueryParams.includes('88'));
  assert.ok(complaintQueryParams.includes(17));
  assert.ok(complaintQueryParams.includes('Coordenador Teste'));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes(5)));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes('coordinator')));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes('coordenador_unidade')));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes('gerente_unidade')));
});

test('coordinator keeps clinic scope from token when user_clinics is empty', async () => {
  let complaintQuerySql = '';
  let complaintQueryParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, role: 'coordinator' }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async (sql, params) => {
        complaintQuerySql = sql;
        complaintQueryParams = params;

        return [[{
          id: 188,
          protocol: 'GRC-2026-000188',
          clinic_id: 5,
          patient_name: 'Paciente Escopo Token',
          patient_phone: '+5562999999999',
          status: 'em_andamento',
          forwarded_to_role: 'coordinator',
          forwarded_to_label: 'Coordenador Token',
          assigned_coordinator_user_id: 17,
          assigned_coordinator_name: 'Coordenador Token',
          assigned_responsible_user_id: 17,
          assigned_responsible_name: 'Coordenador Token',
          assigned_responsible_role: 'coordinator',
          attachment_url: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date()
        }]];
      }
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    }
  ]);

  const response = await request(app)
    .get('/complaints/188')
    .set('Authorization', `Bearer ${signToken({
      id: 17,
      email: 'coordenador.token@example.com',
      role: 'coordinator',
      name: 'Coordenador Token',
      permissions: [],
      clinicIds: [5],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.id, 188);
  assert.match(complaintQuerySql, /c\.clinic_id IN \(\?\)/);
  assert.ok(Array.isArray(complaintQueryParams));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes(5)));
});

test('coordinator keeps visibility after complaint is returned to SAC', async () => {
  let complaintQuerySql = '';
  let complaintQueryParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 5 }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async (sql, params) => {
        complaintQuerySql = sql;
        complaintQueryParams = params;

        return [[{
          id: 89,
          protocol: 'GRC-2026-000089',
          clinic_id: 5,
          patient_name: 'Paciente em acompanhamento',
          patient_phone: '+5562999999999',
          status: 'em_andamento',
          forwarded_to_role: 'sac_operator',
          forwarded_to_label: 'Operador SAC',
          assigned_coordinator_user_id: 17,
          assigned_coordinator_name: 'Coordenador Teste',
          assigned_responsible_user_id: 9,
          assigned_responsible_name: 'Operador SAC',
          assigned_responsible_role: 'sac_operator',
          attachment_url: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date()
        }]];
      }
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    }
  ]);

  const response = await request(app)
    .get('/complaints/89')
    .set('Authorization', `Bearer ${signToken({
      id: 17,
      email: 'coordenador@example.com',
      role: 'coordinator',
      name: 'Coordenador Teste',
      permissions: [],
      clinicIds: [5],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.id, 89);
  assert.match(complaintQuerySql, /assigned_coordinator_user_id = \?/);
  assert.ok(Array.isArray(complaintQueryParams));
  assert.ok(complaintQueryParams.includes(17));
});

test('coordinator can return assigned complaint to SAC after saved treatment', async () => {
  let updateComplaintSql = null;
  let updateComplaintParams = null;
  let complaintLogParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 5 }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async () => [[{
        id: 88,
        protocol: 'GRC-2026-000088',
        clinic_id: 5,
        patient_name: 'Paciente Teste',
        patient_phone: '+5562999999999',
        status: 'em_andamento',
        priority: 'media',
        operator_comment: 'Tratativa registrada pelo coordenador.',
        treatment_at: new Date('2026-05-10T12:00:00.000Z'),
        treatment_by_role: 'coordinator',
        forwarded_to_role: 'coordinator',
        forwarded_to_label: 'Coordenador Teste',
        assigned_coordinator_user_id: 17,
        assigned_coordinator_name: 'Coordenador Teste',
        assigned_responsible_user_id: 17,
        assigned_responsible_name: 'Coordenador Teste',
        assigned_responsible_role: 'coordinator',
        attachment_url: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM users') && sql.includes("role = 'sac_operator'"),
      reply: async () => [[{
        id: 9,
        name: 'Operador SAC'
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE complaints') && sql.includes('forwarded_to_role = ?'),
      reply: async (sql, params) => {
        updateComplaintSql = sql;
        updateComplaintParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO complaint_logs'),
      reply: async (_sql, params) => {
        complaintLogParams = params;
        return [{ insertId: 4 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/complaints/88')
    .set('Authorization', `Bearer ${signToken({
      id: 17,
      email: 'coordenador@example.com',
      role: 'coordinator',
      name: 'Coordenador Teste',
      permissions: [],
      clinicIds: [5],
      mustChangePassword: false
    })}`)
    .send({
      status: 'em_andamento',
      reassign_forward: true,
      forward_to_role: 'sac_operator'
    });

  assert.equal(response.status, 200);
  assert.match(updateComplaintSql, /forwarded_to_role = \?/);
  assert.match(updateComplaintSql, /assigned_responsible_role = \?/);
  assert.ok(updateComplaintParams.includes('sac_operator'));
  assert.ok(updateComplaintParams.includes('Operador SAC'));
  assert.equal(updateComplaintParams.at(-1), '88');
  assert.equal(complaintLogParams[1], 'reassigned_forward');
  assert.match(complaintLogParams[2], /Operador SAC/);
});

test('manager keeps visibility of complaints inside selected clinics', async () => {
  let complaintQuerySql = '';
  let complaintQueryParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 9 }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('c.clinic_id IN (?)'),
      reply: async (sql, params) => {
        complaintQuerySql = sql;
        complaintQueryParams = params;

        return [[{
          id: 91,
          protocol: 'GRC-2026-000091',
          clinic_id: 9,
          patient_name: 'Paciente Finalizada',
          patient_phone: '+5562999999999',
          status: 'resolvida',
          forwarded_to_role: 'sac_operator',
          forwarded_to_label: 'Operador de SAC',
          assigned_coordinator_user_id: 17,
          assigned_coordinator_name: 'Coordenador Teste',
          assigned_responsible_user_id: null,
          assigned_responsible_name: null,
          assigned_responsible_role: null,
          attachment_url: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
          closed_at: new Date()
        }]];
      }
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    }
  ]);

  const response = await request(app)
    .get('/complaints')
    .set('Authorization', `Bearer ${signToken({
      id: 33,
      email: 'gerente@example.com',
      role: 'manager',
      name: 'Gerente Teste',
      permissions: [],
      clinicIds: [9],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body[0].id, 91);
  assert.match(complaintQuerySql, /c\.clinic_id IN \(\?\)/);
  assert.doesNotMatch(complaintQuerySql, /c\.status = 'resolvida'/);
  assert.ok(Array.isArray(complaintQueryParams));
  assert.ok(complaintQueryParams.includes('Gerente Teste'));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes(9)));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes('manager')));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes('coordenador_unidade')));
  assert.ok(complaintQueryParams.some((param) => Array.isArray(param) && param.includes('gerente_unidade')));
});

test('supervisor crc can assign agenda item to crc operator', async () => {
  let insertedAgendaParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, role: 'supervisor_crc' }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM users u') && sql.includes('WHERE u.id = ?') && sql.includes('u.active = 1'),
      reply: async () => [[{
        id: 55,
        name: 'Operador CRC',
        email: 'crc.operator@example.com',
        role: 'crc_operator',
        position: 'Operador de CRC',
        department: 'CRC'
      }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO agenda_items'),
      reply: async (_sql, params) => {
        insertedAgendaParams = params;
        return [{ insertId: 91 }];
      }
    },
    {
      match: (sql) => sql.includes('SELECT * FROM agenda_items WHERE id = ? LIMIT 1'),
      reply: async () => [[{
        id: 91,
        owner_user_id: 9,
        owner_name: 'Supervisor CRC',
        assigned_user_id: 55,
        assigned_user_name: 'Operador CRC',
        assigned_user_email: 'crc.operator@example.com',
        title: 'Acompanhar agenda vencida',
        description: 'Verificar protocolos com SLA em atraso',
        status: 'today',
        priority: 'alta',
        due_at: null,
        reminder_at: null,
        reminder_acknowledged_at: null,
        tags_json: '[]',
        checklist_json: '[]',
        board_order: 0
      }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO notification_events'),
      reply: async () => [{ insertId: 1 }]
    }
  ]);

  const response = await request(app)
    .post('/api/agenda/items')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'supervisor@example.com',
      role: 'supervisor_crc',
      name: 'Supervisor CRC',
      permissions: ['home'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      title: 'Acompanhar agenda vencida',
      status: 'today',
      priority: 'alta',
      assigned_user_id: 55,
      description: 'Verificar protocolos com SLA em atraso'
    });

  assert.equal(response.status, 201);
  assert.ok(Array.isArray(insertedAgendaParams));
  assert.equal(insertedAgendaParams[1], 9);
  assert.equal(insertedAgendaParams[3], 55);
  assert.equal(insertedAgendaParams[4], 'Operador CRC');
  assert.equal(response.body.assigned_user_id, 55);
});

test('daily recurring agenda item is created with mandatory completion', async () => {
  let insertedAgendaParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, role: 'manager' }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM users u') && sql.includes('WHERE u.id = ?') && sql.includes('u.active = 1'),
      reply: async () => [[{
        id: 14,
        name: 'Gerente Agenda',
        email: 'gerente.agenda@example.com',
        role: 'manager',
        position: 'Gerente Operacional',
        department: 'Operacoes'
      }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO agenda_items'),
      reply: async (_sql, params) => {
        insertedAgendaParams = params;
        return [{ insertId: 144 }];
      }
    },
    {
      match: (sql) => sql.includes('SELECT * FROM agenda_items WHERE id = ? LIMIT 1'),
      reply: async () => [[{
        id: 144,
        owner_user_id: 14,
        owner_name: 'Gerente Agenda',
        assigned_user_id: 14,
        assigned_user_name: 'Gerente Agenda',
        assigned_user_email: 'gerente.agenda@example.com',
        title: 'Fechamento diario de pendencias',
        description: 'Validar agenda e registrar entregas da equipe',
        status: 'today',
        priority: 'alta',
        is_daily_recurring: 1,
        requires_completion: 1,
        recurrence_base_status: 'doing',
        recurrence_cycle_date: '2026-06-03',
        recurrence_weekdays_json: '[1,3,5]',
        due_at: null,
        reminder_at: null,
        reminder_acknowledged_at: null,
        completed_at: null,
        completed_by_user_id: null,
        completed_by_name: null,
        tags_json: '[]',
        checklist_json: '[]',
        board_order: 0
      }]]
    }
  ]);

  const response = await request(app)
    .post('/api/agenda/items')
    .set('Authorization', `Bearer ${signToken({
      id: 14,
      email: 'gerente.agenda@example.com',
      role: 'manager',
      name: 'Gerente Agenda',
      permissions: ['home'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      title: 'Fechamento diario de pendencias',
      status: 'today',
      priority: 'alta',
      description: 'Validar agenda e registrar entregas da equipe',
      is_daily_recurring: true,
      requires_completion: false,
      recurrence_base_status: 'doing',
      recurrence_weekdays: [1, 3, 5]
    });

  assert.equal(response.status, 201);
  assert.ok(Array.isArray(insertedAgendaParams));
  assert.equal(insertedAgendaParams[28], 1);
  assert.equal(insertedAgendaParams[29], 1);
  assert.equal(insertedAgendaParams[30], 'doing');
  assert.match(String(insertedAgendaParams[31] || ''), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(insertedAgendaParams[32], '[1,3,5]');
  assert.equal(response.body.is_daily_recurring, true);
  assert.equal(response.body.requires_completion, true);
  assert.equal(response.body.recurrence_base_status, 'doing');
  assert.match(String(response.body.recurrence_cycle_date || ''), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(response.body.recurrence_weekdays, [1, 3, 5]);
});

test('agenda recurrence weekdays only generate return cycles on selected days', () => {
  assert.deepEqual(
    serverModule.__testables.normalizeAgendaRecurrenceWeekdays([1, '3', 5, 5, 'x', 9]),
    [1, 3, 5]
  );
  assert.deepEqual(
    serverModule.__testables.normalizeAgendaRecurrenceWeekdays('seg, qua, sexta-feira'),
    [1, 3, 5]
  );
  assert.deepEqual(
    serverModule.__testables.listAgendaScheduledDatesBetween('2026-06-02', '2026-06-08', [1, 4]),
    ['2026-06-04', '2026-06-08']
  );
  assert.deepEqual(
    serverModule.__testables.listAgendaScheduledDatesBetween('2026-06-04', '2026-06-05', []),
    ['2026-06-05']
  );
});

test('agenda dashboard snapshot groups collaborator productivity and urgent items', () => {
  const now = new Date();
  const snapshot = serverModule.__testables.buildAgendaDashboardSnapshot(
    [
      {
        id: 1,
        assigned_user_id: 10,
        assigned_user_name: 'Ana CRC',
        assigned_user_role: 'crc_operator',
        title: 'Confirmar Maria',
        status: 'today',
        priority: 'alta',
        created_at: new Date(now.getTime() - (1 * 86400000)).toISOString(),
        due_at: new Date(Date.now() + (4 * 60 * 60 * 1000)).toISOString(),
        requires_completion: 1,
        is_daily_recurring: 1,
        recurrence_weekdays_json: '[1,2,3,4,5]'
      },
      {
        id: 2,
        assigned_user_id: 11,
        assigned_user_name: 'Bruna CRC',
        assigned_user_role: 'crc_operator',
        title: 'Retornar paciente',
        status: 'doing',
        priority: 'normal',
        created_at: now.toISOString(),
        due_at: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
        requires_completion: 1,
        is_daily_recurring: 0
      }
    ],
    [
      {
        agenda_item_id: 1,
        title: 'Confirmar Maria',
        completed_at: new Date().toISOString(),
        completed_by_user_id: 10,
        completed_by_name: 'Ana CRC',
        responsible_user_id: 10,
        responsible_user_name: 'Ana CRC'
      }
    ],
    { days: 30 }
  );

  assert.equal(snapshot.summary.total, 2);
  assert.equal(snapshot.summary.open, 2);
  assert.equal(snapshot.summary.overdue, 1);
  assert.equal(snapshot.summary.due_24h, 1);
  assert.equal(snapshot.summary.completed_today, 1);
  assert.equal(snapshot.summary.created_period, 2);
  assert.ok(Array.isArray(snapshot.daily_series));
  assert.equal(snapshot.daily_series.length, 30);
  assert.equal(snapshot.collaborators.length, 2);
  assert.ok(Array.isArray(snapshot.collaborators[0].daily_series));
  assert.equal(snapshot.collaborators[0].daily_series.length, 30);
  assert.equal(snapshot.urgent_items.length, 2);
});

test('agenda import worksheet parser normalizes collaborator, recurring days and whatsapp intent', () => {
  const rows = serverModule.__testables.parseAgendaImportRowsFromWorksheetRows([
    {
      colaborador: 'Ana CRC',
      email_responsavel: 'ana.crc@empresa.com.br',
      titulo_tarefa: 'Confirmar atendimento',
      descricao: 'Contato ativo',
      prioridade: 'alta',
      recorrente_diario: 'sim',
      dias_semana: 'seg, qua, sex',
      nome_paciente: 'Maria Silva',
      telefone: '5562999999999',
      clinica: 'Garavelo',
      data_consulta: '12/06/2026',
      hora_consulta: '10:00',
      enviar_confirmacao_whatsapp: 'sim'
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].assignee_email, 'ana.crc@empresa.com.br');
  assert.equal(rows[0].is_daily_recurring, true);
  assert.deepEqual(rows[0].recurrence_weekdays, [1, 3, 5]);
  assert.equal(rows[0].patient_name, 'MARIA SILVA');
  assert.equal(rows[0].whatsapp_preference, true);
  assert.equal(rows[0].due_at, '2026-06-12 10:00:00');
});

test('responsible user execution stores completion timestamp for recurring agenda item', async () => {
  let updateAgendaParams = null;
  let completionLogParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, role: 'crc_operator' }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM agenda_items a') && sql.includes('a.is_daily_recurring = 1'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM agenda_items WHERE id = ? AND deleted_at IS NULL'),
      reply: async () => [[{
        id: 91,
        owner_user_id: 9,
        owner_name: 'Supervisor CRC',
        assigned_user_id: 55,
        assigned_user_name: 'Operador CRC',
        assigned_user_email: 'crc.operator@example.com',
        title: 'Contato diario com clinicas criticas',
        description: 'Executar a rodada diaria e registrar evidencia',
        status: 'doing',
        priority: 'alta',
        is_daily_recurring: 1,
        requires_completion: 1,
        recurrence_base_status: 'today',
        recurrence_cycle_date: '2026-06-03',
        recurrence_weekdays_json: '[1,3,5]',
        due_at: '2026-06-03 11:00:00',
        reminder_at: null,
        reminder_acknowledged_at: null,
        completed_at: null,
        completed_by_user_id: null,
        completed_by_name: null,
        tags_json: '[]',
        checklist_json: '[]',
        board_order: 0
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE agenda_items') && sql.includes('WHERE id = ?'),
      reply: async (_sql, params) => {
        updateAgendaParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('SELECT * FROM agenda_items WHERE id = ? LIMIT 1'),
      reply: async () => [[{
        id: 91,
        owner_user_id: 9,
        owner_name: 'Supervisor CRC',
        assigned_user_id: 55,
        assigned_user_name: 'Operador CRC',
        assigned_user_email: 'crc.operator@example.com',
        title: 'Contato diario com clinicas criticas',
        description: 'Executar a rodada diaria e registrar evidencia',
        status: 'done',
        priority: 'alta',
        is_daily_recurring: 1,
        requires_completion: 1,
        recurrence_base_status: 'today',
        recurrence_cycle_date: '2026-06-03',
        recurrence_weekdays_json: '[1,3,5]',
        due_at: '2026-06-03 11:00:00',
        reminder_at: null,
        reminder_acknowledged_at: null,
        completed_at: '2026-06-03 12:45:00',
        completed_by_user_id: 55,
        completed_by_name: 'Operador CRC',
        tags_json: '[]',
        checklist_json: '[]',
        board_order: 0
      }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO agenda_item_completion_logs'),
      reply: async (_sql, params) => {
        completionLogParams = params;
        return [{ insertId: 1 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/api/agenda/items/91')
    .set('Authorization', `Bearer ${signToken({
      id: 55,
      email: 'crc.operator@example.com',
      role: 'crc_operator',
      name: 'Operador CRC',
      permissions: ['home'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      markExecuted: true
    });

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(updateAgendaParams));
  assert.equal(response.body.status, 'done');
  assert.equal(response.body.completed_by_user_id, 55);
  assert.equal(response.body.completed_by_name, 'Operador CRC');
  assert.equal(response.body.completed_at, '2026-06-03 12:45:00');
  assert.ok(Array.isArray(completionLogParams));
  assert.equal(completionLogParams[0], 91);
  assert.equal(completionLogParams[1], '2026-06-03');
  assert.equal(completionLogParams[3], '2026-06-03 12:45:00');
  assert.equal(completionLogParams[4], 55);
  assert.equal(completionLogParams[5], 'Operador CRC');
  assert.equal(completionLogParams[6], 55);
  assert.equal(completionLogParams[7], 'Operador CRC');
  assert.equal(completionLogParams[8], 1);
});

test('SAC operator can change complaint unit with audit trail', async () => {
  let updateComplaintSql = null;
  let updateComplaintParams = null;
  let complaintLogParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 1 }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async () => [[{
        id: 45,
        protocol: 'GRC-2026-000045',
        clinic_id: 1,
        clinic_name: 'Unidade Antiga',
        clinic_snapshot_name: null,
        status: 'aberta',
        priority: 'media',
        operator_comment: null,
        forwarded_to_role: 'coordinator',
        forwarded_to_label: 'Coordenador Antigo',
        deleted_at: null,
        attachment_url: null,
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM clinics') && sql.includes('AND active = 1') && sql.includes('LIMIT 1'),
      reply: async () => [[{
        id: 2,
        name: 'Unidade Nova',
        city: 'Goiânia',
        state: 'GO',
        region: 'Centro',
        coordinator_name: 'Coordenadora Nova',
        active: 1
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT id, name, coordinator_name FROM clinics WHERE id = ? LIMIT 1'),
      reply: async () => [[{
        id: 2,
        name: 'Unidade Nova',
        coordinator_name: 'Coordenadora Nova'
      }]]
    },
    {
      match: (sql) => sql.includes('FROM users u') && sql.includes('INNER JOIN user_clinics') && sql.includes('ORDER BY CASE'),
      reply: async () => [[{
        id: 81,
        name: 'Coordenadora Nova'
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE complaints') && sql.includes('clinic_id = ?'),
      reply: async (sql, params) => {
        updateComplaintSql = sql;
        updateComplaintParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO complaint_logs'),
      reply: async (_sql, params) => {
        complaintLogParams = params;
        return [{ insertId: 3 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/complaints/45')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [1],
      mustChangePassword: false
    })}`)
    .send({ clinic_id: 2 });

  assert.equal(response.status, 200);
  assert.match(updateComplaintSql, /clinic_id = \?/);
  assert.match(updateComplaintSql, /clinic_snapshot_name = \?/);
  assert.match(updateComplaintSql, /assigned_coordinator_user_id = \?/);
  assert.match(updateComplaintSql, /forwarded_to_label = \?/);
  assert.deepEqual(updateComplaintParams.slice(3, 10), [
    2,
    'Unidade Nova',
    81,
    'Coordenadora Nova',
    81,
    'Coordenadora Nova',
    'Coordenadora Nova'
  ]);
  assert.equal(updateComplaintParams.at(-1), '45');
  assert.equal(complaintLogParams[1], 'clinic_changed');
  assert.match(complaintLogParams[2], /Unidade Antiga/);
  assert.match(complaintLogParams[2], /Unidade Nova/);
  assert.equal(complaintLogParams[3], 'Operador SAC');
  assert.equal(complaintLogParams[4], 'sac_operator');
});

test('SAC operator can save formal treatment even with empty saved action permissions', async () => {
  let updateComplaintSql = null;
  let updateComplaintParams = null;
  let treatmentLogParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{
        must_change_password: 0,
        token_version: 1,
        active: 1,
        role: 'sac_operator',
        permissions: JSON.stringify(['complaints_management']),
        action_permissions: JSON.stringify([])
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async () => [[{
        id: 46,
        protocol: 'GRC-2026-000046',
        clinic_id: 1,
        patient_name: 'Paciente SAC',
        patient_phone: '+5562999999999',
        status: 'aberta',
        priority: 'media',
        operator_comment: null,
        treatment_at: null,
        attachment_url: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('UPDATE complaints') && sql.includes('treatment_comment = ?'),
      reply: async (sql, params) => {
        updateComplaintSql = sql;
        updateComplaintParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO complaint_logs'),
      reply: async (_sql, params) => {
        treatmentLogParams = params;
        return [{ insertId: 5 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/complaints/46')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'sac@example.com',
      role: 'Operador de SAC',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({ operator_comment: 'Tratativa registrada pelo SAC antes do contato.' });

  assert.equal(response.status, 200);
  assert.match(updateComplaintSql, /treatment_comment = \?/);
  assert.match(updateComplaintSql, /treatment_by_role = \?/);
  assert.match(updateComplaintSql, /treatment_by_name = \?/);
  assert.equal(updateComplaintParams[0], 'em_andamento');
  assert.ok(updateComplaintParams.includes('Tratativa registrada pelo SAC antes do contato.'));
  assert.ok(updateComplaintParams.includes('sac_operator'));
  assert.ok(updateComplaintParams.includes('Operador SAC'));
  assert.equal(treatmentLogParams[1], 'treatment_saved');
  assert.equal(treatmentLogParams[3], 'Operador SAC');
});

test('complaint detail exposes normalized SAC access when role is stored as label', async () => {
  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{
        must_change_password: 0,
        token_version: 1,
        active: 1,
        role: 'Operador de SAC',
        permissions: JSON.stringify([]),
        action_permissions: JSON.stringify([])
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async () => [[{
        id: 47,
        protocol: 'GRC-2026-000047',
        clinic_id: 1,
        patient_name: 'Paciente SAC',
        patient_phone: '+5562999999999',
        status: 'em_andamento',
        priority: 'media',
        operator_comment: null,
        treatment_at: new Date('2026-05-10T12:00:00.000Z'),
        treatment_by_role: 'manager',
        attachment_url: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN (?)'),
      reply: async () => [[]]
    }
  ]);

  const response = await request(app)
    .get('/complaints/47')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'sac@example.com',
      role: 'Operador de SAC',
      name: 'Operador SAC',
      permissions: [],
      clinicIds: [],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.access.role, 'sac_operator');
  assert.equal(response.body.access.canAddTreatment, true);
  assert.equal(response.body.access.canChangeComplaintUnit, true);
  assert.equal(response.body.access.canEditPatientPhone, true);
  assert.equal(response.body.access.canCloseComplaint, true);
  assert.equal(response.body.access.canMarkPatientContact, true);
  assert.equal(response.body.access.canReassignComplaint, true);
});

test('uploaded file route serves persisted database fallback when disk file is missing', async () => {
  const content = Buffer.from('arquivo persistido');

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('CREATE TABLE IF NOT EXISTS uploaded_files'),
      reply: async () => [{ affectedRows: 0 }]
    },
    {
      match: (sql) => sql.includes('FROM uploaded_files') && sql.includes('WHERE filename = ?'),
      reply: async (_sql, params) => {
        assert.equal(params[0], 'teste-persistido.txt');

        return [[{
          filename: 'teste-persistido.txt',
          original_name: 'comprovante clínica.txt',
          mime_type: 'text/plain; charset=utf-8',
          size_bytes: content.length,
          content
        }]];
      }
    }
  ]);

  const response = await request(app)
    .get('/uploads/teste-persistido.txt');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/plain/);
  assert.match(response.headers['content-disposition'], /inline/);
  assert.equal(response.text, 'arquivo persistido');
});

test('sac operator can close complaint when manager treatment exists in immutable history', async () => {
  let updateComplaintSql = '';
  let updateComplaintParams = null;
  let closeLogParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{
        must_change_password: 0,
        token_version: 1,
        active: 1,
        role: 'sac_operator',
        permissions: JSON.stringify(['complaints_management']),
        action_permissions: null
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE') && sql.includes('c.id = ?'),
      reply: async () => [[{
        id: 45,
        protocol: 'GRC-2026-000045',
        clinic_id: 1,
        patient_name: 'Paciente Teste',
        status: 'em_andamento',
        operator_comment: 'SAC acompanhando',
        priority: 'media',
        treatment_at: new Date('2026-05-10T12:00:00.000Z'),
        treatment_by_role: 'sac_operator',
        supervisor_approval_at: null,
        deleted_at: null,
        created_at: new Date('2026-05-09T12:00:00.000Z')
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_evidences'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes('complaint_id IN'),
      reply: async () => [[{
        id: 10,
        complaint_id: 45,
        action: 'treatment_saved',
        message: 'Tratativa registrada pelo gerente.',
        actor_name: 'Gerente Unidade',
        actor_role: 'manager',
        created_at: new Date('2026-05-10T12:05:00.000Z')
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaint_logs') && sql.includes("action = 'treatment_saved'"),
      reply: async () => [[{
        actor_role: 'manager'
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE complaints') && sql.includes('closed_at = NOW()'),
      reply: async (sql, params) => {
        updateComplaintSql = sql;
        updateComplaintParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO complaint_logs'),
      reply: async (_sql, params) => {
        closeLogParams = params;
        return [{ insertId: 4 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/complaints/45')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({ status: 'resolvida' });

  assert.equal(response.status, 200);
  assert.match(updateComplaintSql, /closed_at = NOW\(\)/);
  assert.equal(updateComplaintParams[0], 'resolvida');
  assert.ok(updateComplaintParams.includes('sac_operator'));
  assert.equal(closeLogParams[1], 'closed');
  assert.equal(closeLogParams[3], 'Operador SAC');
});

