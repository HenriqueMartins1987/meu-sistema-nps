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

test('admin user creation keeps the user when welcome e-mail fails', async () => {
  let insertedUserParams = null;

  emailService.sendWelcomeEmail = async () => {
    throw new Error('Resend indisponível');
  };

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT id FROM users WHERE LOWER(email) = ?'),
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
      email: 'admin@example.com',
      role: 'admin',
      name: 'Administrador',
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
  assert.match(insertedUserParams[2], /^\$2[aby]\$/);
  assert.equal(insertedUserParams[insertedUserParams.length - 1], 1);
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
      match: (sql) => sql.includes('SELECT must_change_password FROM users WHERE id = ?'),
      reply: async () => [[{ must_change_password: 1 }]]
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
      match: (sql) => sql.includes('SELECT must_change_password FROM users WHERE id = ?'),
      reply: async () => [[{ must_change_password: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT id, name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password, created_at, updated_at'),
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
        created_at: new Date(),
        updated_at: new Date()
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?'),
      reply: async (_sql, params) => {
        updateParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('SELECT id, name, email, role, position, phone, whatsapp, department, permissions, active, must_change_password, created_at, updated_at'),
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

test('test-email route sends a validation message through the welcome template', async () => {
  emailService.sendWelcomeEmail = async ({ to, name, loginEmail, password }) => ({
    provider: 'mock',
    id: 'email-123',
    skipped: false,
    to,
    name,
    loginEmail,
    password
  });

  const response = await request(app)
    .post('/api/test-email')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'admin@example.com',
      role: 'admin',
      name: 'Administrador',
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
});
