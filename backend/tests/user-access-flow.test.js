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
const originalPoolGetConnection = pool.getConnection.bind(pool);
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
  pool.getConnection = originalPoolGetConnection;
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

test('complaint appointment SLA reminder uses previous business day', () => {
  const mondayAppointment = new Date('2026-07-06T13:00:00.000Z');
  const fridayBefore = new Date('2026-07-03T12:00:00.000Z');
  const thursdayBefore = new Date('2026-07-02T12:00:00.000Z');

  assert.equal(serverModule.__testables.shouldSendAppointmentSlaReminder(mondayAppointment, fridayBefore), true);
  assert.equal(serverModule.__testables.shouldSendAppointmentSlaReminder(mondayAppointment, thursdayBefore), false);
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
      match: (sql) => sql.includes('SELECT id FROM users WHERE cpf = ? AND deleted_at IS NULL'),
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
  assert.equal(insertedUserParams.at(-2), 1);
  assert.equal(insertedUserParams.at(-1), 'aprovado');
});

test('master admin creates CRC operator with phone only and pending authorization', async () => {
  let insertedUserParams = null;
  let notificationParams = null;

  emailService.sendEmail = async () => ({ provider: 'test', from: 'noreply@example.com', id: 'email-1' });

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM users WHERE LOWER(username) = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM users WHERE cpf = ? AND deleted_at IS NULL'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO users'),
      reply: async (_sql, params) => {
        insertedUserParams = params;
        return [{ insertId: 156 }];
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
        return [{ insertId: 901 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO email_delivery_logs'),
      reply: async () => [{ insertId: 23 }]
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
      name: 'Paula Operadora CRC',
      role: 'crc_operator',
      phone: '+5562999999999',
      cpf: '529.982.247-25',
      crcOperatorArea: 'confirmacao_agendamento'
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.pendingAuthorization, true);
  assert.equal(response.body.username, 'paula.crc');
  assert.ok(insertedUserParams);
  assert.equal(insertedUserParams[1], 'paula.crc');
  assert.equal(insertedUserParams[2], null);
  assert.match(insertedUserParams[3], /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare('52998224725', insertedUserParams[3]), true);
  assert.equal(insertedUserParams[8], '52998224725');
  assert.equal(insertedUserParams[9], 'confirmacao_agendamento');
  assert.equal(insertedUserParams[10], 'Confirmação e Agendamento');
  assert.equal(insertedUserParams.at(-3), 0);
  assert.equal(insertedUserParams.at(-2), 0);
  assert.equal(insertedUserParams.at(-1), 'pendente');
  assert.equal(notificationParams[1], 'crc_operator_approval_required');
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
      match: (sql) => sql.includes('SELECT id') && sql.includes('cpf = ?') && sql.includes('FROM users'),
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
      phone: '+5562999999999',
      cpf: '529.982.247-25',
      crcOperatorArea: 'ortodontia'
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.pendingAuthorization, true);
  assert.match(response.body.message, /Administrador Master foi notificado/i);
  assert.match(insertedUserSql, /active,\s*must_change_password,\s*authorization_status\)\s*VALUES[\s\S]+0,\s*0,\s*'pendente'\)/);
  assert.equal(insertedUserParams[0], 'Paula Operadora CRC');
  assert.equal(insertedUserParams[1], 'paula.crc');
  assert.equal(insertedUserParams[2], null);
  assert.match(insertedUserParams[3], /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare('52998224725', insertedUserParams[3]), true);
  assert.equal(insertedUserParams[6], '52998224725');
  assert.equal(insertedUserParams[7], 'ortodontia');
  assert.equal(insertedUserParams[8], 'Ortodontia');
  assert.equal(notificationParams[0], 1);
  assert.equal(notificationParams[1], 'crc_operator_approval_required');
  assert.match(notificationParams[3], /Paula Operadora CRC solicitou acesso/);
  assert.ok(emailSent);
  assert.match(emailSent.subject, /Operador de CRC aguardando autorização/);
});

test('master admin reset uses CPF as CRC operator password', async () => {
  let passwordHash = null;
  let updateParams = null;

  emailService.sendEmail = async () => ({ provider: 'test', from: 'noreply@example.com', id: 'email-reset' });

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT id, role, email, name, phone, whatsapp, cpf FROM users WHERE id = ?'),
      reply: async () => [[{
        id: 155,
        role: 'crc_operator',
        email: null,
        name: 'Paula Operadora CRC',
        phone: '+5562999999999',
        whatsapp: '+5562999999999',
        cpf: '52998224725'
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE users SET password = ?'),
      reply: async (_sql, params) => {
        updateParams = params;
        passwordHash = params[0];
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO notification_events'),
      reply: async () => [{ insertId: 902 }]
    },
    {
      match: (sql) => sql.includes('INSERT INTO email_delivery_logs'),
      reply: async () => [{ insertId: 24 }]
    }
  ]);

  const response = await request(app)
    .post('/admin/users/155/reset-password')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['admin_panel'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({ password: 'OutraSenha@123' });

  assert.equal(response.status, 200);
  assert.match(response.body.message, /CPF cadastrado/i);
  assert.equal(updateParams[1], 0);
  assert.equal(await bcrypt.compare('52998224725', passwordHash), true);
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

test('SAC operator can update only clinic links for partner/coordinator/manager users', async () => {
  const insertedClinics = [];
  let deletedUserClinicLinks = false;
  let operatorClinicSyncUpdated = false;

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
        email: 'maria@example.com',
        role: 'partner',
        active: 1
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM clinics WHERE active = 1 AND id IN (?)'),
      reply: async () => [[{ id: 2 }, { id: 3 }]]
    },
    {
      match: (sql) => sql.includes('DELETE FROM user_clinics WHERE user_id = ?'),
      reply: async () => {
        deletedUserClinicLinks = true;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO user_clinics'),
      reply: async (sql, params) => {
        insertedClinics.push(params[1]);
        return [{ insertId: insertedClinics.length }];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE operator_clinics SET active = 0'),
      reply: async () => {
        operatorClinicSyncUpdated = true;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO operator_clinics'),
      reply: async () => [{ insertId: 1 }]
    }
  ]);

  const response = await request(app)
    .patch('/admin/users/44')
    .set('Authorization', `Bearer ${signToken({
      id: 7,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [1],
      mustChangePassword: false
    })}`)
    .send({ clinicIds: [2, 3] });

  assert.equal(response.status, 200);
  assert.equal(deletedUserClinicLinks, true);
  assert.equal(operatorClinicSyncUpdated, true);
  assert.deepEqual(insertedClinics, [2, 3]);
  assert.deepEqual(response.body.clinicIds, [2, 3]);
});

test('SAC operator clinic link update creates missing operator_clinics table', async () => {
  let deleteUserClinicLinks = false;
  let createOperatorClinicsTable = false;
  let operatorSyncAttempts = 0;
  const insertedClinics = [];

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL'),
      reply: async () => [[{
        id: 81,
        name: 'Murilo Soares',
        email: 'murilo.soares@gci.com.br',
        role: 'manager',
        active: 1
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT role, name FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1'),
      reply: async () => [[{ role: 'manager', name: 'Murilo Soares' }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('c.manager_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM clinics') && sql.includes('manager'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM clinics WHERE active = 1 AND id IN (?)'),
      reply: async () => [[{ id: 7 }, { id: 8 }]]
    },
    {
      match: (sql) => sql.includes('DELETE FROM user_clinics WHERE user_id = ?'),
      reply: async () => {
        deleteUserClinicLinks = true;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO user_clinics'),
      reply: async (sql, params) => {
        insertedClinics.push(params[1]);
        return [{ insertId: insertedClinics.length }];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE operator_clinics SET active = 0'),
      reply: async () => {
        operatorSyncAttempts += 1;
        if (operatorSyncAttempts === 1) {
          const error = new Error("Table 'nps_system.operator_clinics' doesn't exist");
          error.code = 'ER_NO_SUCH_TABLE';
          throw error;
        }
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('CREATE TABLE IF NOT EXISTS operator_clinics'),
      reply: async () => {
        createOperatorClinicsTable = true;
        return [{ affectedRows: 0 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO operator_clinics'),
      reply: async () => [{ insertId: 1 }]
    },
    {
      match: (sql) => sql.includes('UPDATE clinics') && sql.includes('SET manager = ?'),
      reply: async () => [{ affectedRows: 2 }]
    }
  ]);

  const response = await request(app)
    .patch('/admin/users/81')
    .set('Authorization', `Bearer ${signToken({
      id: 7,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [1],
      mustChangePassword: false
    })}`)
    .send({ clinicIds: [7, 8] });

  assert.equal(response.status, 200);
  assert.equal(deleteUserClinicLinks, true);
  assert.equal(createOperatorClinicsTable, true);
  assert.equal(operatorSyncAttempts, 2);
  assert.deepEqual(insertedClinics, [7, 8]);
});

test('master admin clinic-only update bypasses profile validation and auxiliary failures', async () => {
  const insertedClinics = [];
  let deletedUserClinicLinks = false;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL'),
      reply: async () => [[{
        id: 81,
        name: 'Murilo Soares',
        email: 'murilo.soares@gci.com.br',
        role: 'manager',
        phone: '',
        whatsapp: '',
        active: 1
      }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM clinics WHERE active = 1 AND id IN (?)'),
      reply: async () => [[{ id: 7 }, { id: 8 }]]
    },
    {
      match: (sql) => sql.includes('DELETE FROM user_clinics WHERE user_id = ?'),
      reply: async () => {
        deletedUserClinicLinks = true;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO user_clinics'),
      reply: async (sql, params) => {
        insertedClinics.push(params[1]);
        return [{ insertId: insertedClinics.length }];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE operator_clinics SET active = 0'),
      reply: async () => {
        const error = new Error('operator_clinics unavailable');
        error.code = 'ER_LOCK_WAIT_TIMEOUT';
        throw error;
      }
    },
    {
      match: (sql) => sql.includes('UPDATE clinics') && sql.includes('SET manager = ?'),
      reply: async () => {
        throw new Error('clinics leadership sync unavailable');
      }
    }
  ]);

  const response = await request(app)
    .patch('/admin/users/81')
    .set('Authorization', `Bearer ${signToken({
      id: 1,
      email: 'henrique.martins@grcconsultoria.net.br',
      role: 'master_admin',
      name: 'Administrador Master',
      permissions: ['admin_panel'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({ clinicIds: [7, 8] });

  assert.equal(response.status, 200);
  assert.equal(deletedUserClinicLinks, true);
  assert.deepEqual(insertedClinics, [7, 8]);
  assert.equal(response.body.auxiliarySync.operatorClinicSync.ok, false);
  assert.equal(response.body.auxiliarySync.clinicLeadershipSync.ok, false);
});

test('SAC operator user-clinic screen lists only partner coordinator and manager users', async () => {
  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT id, name, username') && sql.includes('FROM users') && sql.includes('ORDER BY name ASC'),
      reply: async () => [[
        { id: 1, name: 'Parceiro', email: 'parceiro@example.com', role: 'partner', active: 1 },
        { id: 2, name: 'Coordenadora', email: 'coordenadora@example.com', role: 'coordinator', active: 1 },
        { id: 3, name: 'Gerente', email: 'gerente@example.com', role: 'manager', active: 1 },
        { id: 4, name: 'Operador CRC', email: 'crc@example.com', role: 'crc_operator', active: 1 },
        { id: 5, name: 'Operador SAC', email: 'sac2@example.com', role: 'sac_operator', active: 1 },
        { id: 6, name: 'Administrador', email: 'admin@sorria.com', role: 'admin', active: 1 }
      ]]
    },
    {
      match: (sql) => sql.includes('SELECT user_id, clinic_id, can_edit FROM user_clinics'),
      reply: async () => [[
        { user_id: 1, clinic_id: 10, can_edit: 1 },
        { user_id: 2, clinic_id: 11, can_edit: 1 },
        { user_id: 3, clinic_id: 12, can_edit: 1 }
      ]]
    }
  ]);

  const response = await request(app)
    .get('/admin/users')
    .set('Authorization', `Bearer ${signToken({
      id: 7,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [1],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.map((user) => user.role), ['partner', 'coordinator', 'manager']);
});

test('SAC operator cannot change clinic links for roles outside partner/coordinator/manager', async () => {
  let clinicUpdateAttempted = false;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL'),
      reply: async () => [[{
        id: 46,
        name: 'Operador CRC',
        email: 'crc@example.com',
        role: 'crc_operator',
        active: 1
      }]]
    },
    {
      match: (sql) => sql.includes('DELETE FROM user_clinics') || sql.includes('INSERT INTO user_clinics'),
      reply: async () => {
        clinicUpdateAttempted = true;
        return [{ affectedRows: 1 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/admin/users/46')
    .set('Authorization', `Bearer ${signToken({
      id: 7,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [1],
      mustChangePassword: false
    })}`)
    .send({ clinicIds: [2, 3] });

  assert.equal(response.status, 403);
  assert.equal(clinicUpdateAttempted, false);
});

test('SAC operator cannot change clinic links for admin users', async () => {
  let clinicUpdateAttempted = false;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL'),
      reply: async () => [[{
        id: 45,
        name: 'Administrador',
        email: 'admin@sorria.com',
        role: 'admin',
        active: 1
      }]]
    },
    {
      match: (sql) => sql.includes('DELETE FROM user_clinics') || sql.includes('INSERT INTO user_clinics'),
      reply: async () => {
        clinicUpdateAttempted = true;
        return [{ affectedRows: 1 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/admin/users/45')
    .set('Authorization', `Bearer ${signToken({
      id: 7,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [1],
      mustChangePassword: false
    })}`)
    .send({ clinicIds: [2, 3] });

  assert.equal(response.status, 403);
  assert.equal(clinicUpdateAttempted, false);
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
      match: (sql) => sql.includes('SELECT id, name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password, token_version')
        && sql.includes('FROM users')
        && sql.includes('WHERE id = ? AND deleted_at IS NULL'),
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
      match: (sql) => sql.includes('SELECT id, name, email, role, position, phone, whatsapp, department, permissions, active, must_change_password, token_version')
        && sql.includes('FROM users')
        && sql.includes('WHERE id = ?'),
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
  assert.match(complaintQuerySql, /created_by_role/);
  assert.match(complaintQuerySql, /created_by_email/);
  assert.equal(
    complaintQueryParams.filter((value) => value === 'henrique.martins@grcconsultoria.net.br').length,
    2
  );
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

test('SAC operator can reassign complaint directly to administration', async () => {
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
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async () => [[{
        id: 89,
        protocol: 'GRC-2026-000089',
        clinic_id: 5,
        patient_name: 'Paciente Administrativo',
        patient_phone: '+5562999999999',
        status: 'em_andamento',
        priority: 'media',
        forwarded_to_role: 'manager',
        forwarded_to_label: 'Gerente Teste',
        assigned_coordinator_user_id: 17,
        assigned_coordinator_name: 'Coordenador Teste',
        assigned_responsible_user_id: 23,
        assigned_responsible_name: 'Gerente Teste',
        assigned_responsible_role: 'manager',
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
    },
    {
      match: (sql) => sql.includes('FROM users') && sql.includes("role = 'admin'"),
      reply: async () => [[
        {
          id: 41,
          name: 'Willian Administrador',
          role: 'admin'
        },
        {
          id: 42,
          name: 'Anna Administradora',
          role: 'admin'
        }
      ]]
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
        return [{ insertId: 5 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/complaints/89')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'sac@example.com',
      role: 'sac_operator',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({
      status: 'em_andamento',
      reassign_forward: true,
      forward_to_role: 'admin'
    });

  assert.equal(response.status, 200);
  assert.match(updateComplaintSql, /forwarded_to_role = \?/);
  assert.match(updateComplaintSql, /admin_escalated_at = COALESCE\(admin_escalated_at, NOW\(\)\)/);
  assert.ok(updateComplaintParams.includes('admin'));
  assert.ok(updateComplaintParams.includes('Willian Administrador'));
  assert.ok(updateComplaintParams.includes('escalonada_administracao'));
  assert.equal(updateComplaintParams.at(-1), '89');
  assert.equal(complaintLogParams[1], 'reassigned_forward');
  assert.match(complaintLogParams[2], /Willian Administrador/);
  assert.equal(complaintLogParams[6], 'escalonada_administracao');
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

test('management profiles can replicate agenda items while operational profiles cannot', () => {
  assert.equal(serverModule.__testables.canReplicateAgendaItems({
    email: 'henrique.martins@grcconsultoria.net.br',
    role: 'admin'
  }), true);
  assert.equal(serverModule.__testables.canReplicateAgendaItems({ role: 'master_admin' }), true);
  assert.equal(serverModule.__testables.canReplicateAgendaItems({ role: 'supervisor_crc' }), true);
  assert.equal(serverModule.__testables.canReplicateAgendaItems({ role: 'admin' }), true);
  assert.equal(serverModule.__testables.canReplicateAgendaItems({ role: 'crc_leader' }), true);
  assert.equal(serverModule.__testables.canReplicateAgendaItems({ role: 'crc_manager' }), true);
  assert.equal(serverModule.__testables.canReplicateAgendaItems({ role: 'manager' }), true);
  assert.equal(serverModule.__testables.canReplicateAgendaItems({ role: 'coordinator' }), true);
  assert.equal(serverModule.__testables.canReplicateAgendaItems({ role: 'crc_operator' }), false);
});

test('CRC and SAC operators access only scoped agenda dashboards', () => {
  assert.equal(serverModule.__testables.canAccessAgendaDashboard({ role: 'crc_operator' }), true);
  assert.equal(serverModule.__testables.canAccessAgendaDashboard({ role: 'sac_operator' }), true);
  assert.equal(serverModule.__testables.canAccessAgendaDashboard({ role: 'viewer' }), false);
  assert.equal(serverModule.__testables.canAccessAgendaConfirmationDashboard({ role: 'crc_operator' }), true);
  assert.equal(serverModule.__testables.canAccessAgendaConfirmationDashboard({ role: 'sac_operator' }), true);

  assert.equal(serverModule.__testables.canImportAgendaWorkbook({ role: 'crc_operator' }), true);
  assert.equal(serverModule.__testables.canImportAgendaWorkbook({ role: 'sac_operator' }), false);
  assert.equal(serverModule.__testables.canImportAgendaWorkbook({ role: 'viewer' }), false);
  assert.equal(serverModule.__testables.canImportAgendaWorkbook({ role: 'supervisor_crc' }), true);

  const visibility = serverModule.__testables.buildAgendaVisibilityWhere({
    id: 88,
    role: 'crc_operator',
    company_id: 1,
    clinicIds: [7, 9]
  }, 'a');

  assert.match(visibility.sql, /a\.assigned_user_id = \?/);
  assert.match(visibility.sql, /a\.clinic_id IS NULL OR a\.clinic_id IN \(\?\)/);
  assert.deepEqual(visibility.params, [1, 88, 88, [7, 9]]);

  const sacVisibility = serverModule.__testables.buildAgendaVisibilityWhere({
    id: 77,
    role: 'sac_operator',
    company_id: 1
  }, 'a');
  assert.match(sacVisibility.sql, /a\.owner_user_id = \?/);
  assert.match(sacVisibility.sql, /a\.assigned_user_id = \?/);
  assert.doesNotMatch(sacVisibility.sql, /a\.clinic_id IN/);
  assert.deepEqual(sacVisibility.params, [1, 77, 77]);
});

test('CRC operator downloads agenda template and sees only linked clinics', async () => {
  const clinicQueryParams = [];

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, company_id: 1, role: 'crc_operator', permissions: '["home"]', action_permissions: '[]' }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 7 }, { clinic_id: 9 }]]
    },
    {
      match: (sql) => sql.includes('SELECT setting_value, updated_by, updated_at FROM system_settings'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM clinics') && sql.includes('id IN'),
      reply: async (_sql, params) => {
        clinicQueryParams.push(params);
        return [[
          { id: 7, name: 'Garavelo', city: 'Aparecida', state: 'GO', active: 1 },
          { id: 9, name: 'Centro', city: 'Goiania', state: 'GO', active: 1 }
        ]];
      }
    }
  ]);

  const token = signToken({
    id: 88,
    email: null,
    username: 'paula.crc',
    role: 'crc_operator',
    name: 'Paula CRC',
    permissions: ['home'],
    clinicIds: [],
    mustChangePassword: false
  });

  const templateResponse = await request(app)
    .get('/api/agenda/import-template')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(templateResponse.status, 200);
  assert.match(templateResponse.headers['content-type'], /spreadsheetml\.sheet/);

  const clinicsResponse = await request(app)
    .get('/clinics')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(clinicsResponse.status, 200);
  assert.deepEqual(clinicsResponse.body.map((clinic) => clinic.id), [7, 9]);
  assert.ok(clinicQueryParams.some((params) => Array.isArray(params) && params.includes(7) && params.includes(9)));
});

test('CRC operator first access loads active clinics for initial selection', async () => {
  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, company_id: 1, role: 'crc_operator', permissions: '["home"]', action_permissions: '[]' }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT setting_value, updated_by, updated_at FROM system_settings'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT crc_clinic_selection_completed_at FROM users'),
      reply: async () => [[{ crc_clinic_selection_completed_at: null }]]
    },
    {
      match: (sql) => sql.includes('FROM clinics') && sql.includes('WHERE active = 1') && sql.includes('ORDER BY name ASC'),
      reply: async () => [[
        { id: 7, name: 'Garavelo', city: 'Aparecida', state: 'GO', region: 'Metropolitana', active: 1 },
        { id: 9, name: 'Centro', city: 'Goiania', state: 'GO', region: 'Capital', active: 1 }
      ]]
    }
  ]);

  const response = await request(app)
    .get('/api/crc/initial-clinic-selection')
    .set('Authorization', `Bearer ${signToken({
      id: 88,
      email: null,
      username: 'paula.crc',
      role: 'crc_operator',
      name: 'Paula CRC',
      permissions: ['home'],
      clinicIds: [],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.required, true);
  assert.equal(response.body.completed, false);
  assert.deepEqual(response.body.selectedClinicIds, []);
  assert.deepEqual(response.body.clinics.map((clinic) => clinic.id), [7, 9]);
});

test('CRC operator saves initial clinic selection once and receives refreshed session', async () => {
  const insertedLinks = [];
  const operatorClinicWrites = [];
  let operatorClinicResetParams = null;
  let deleteParams = null;
  let completedUpdateParams = null;
  let transactionStarted = false;
  let transactionCommitted = false;
  let transactionRolledBack = false;
  let connectionReleased = false;

  const transactionQuery = buildQueryStub([
    {
      match: (sql) => sql.includes('DELETE FROM user_clinics WHERE user_id = ?'),
      reply: async (_sql, params) => {
        deleteParams = params;
        return [{ affectedRows: 2 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO user_clinics'),
      reply: async (_sql, params) => {
        insertedLinks.push(params);
        return [{ insertId: insertedLinks.length }];
      }
    },
    {
      match: (sql) => sql.includes('UPDATE users SET crc_clinic_selection_completed_at'),
      reply: async (_sql, params) => {
        completedUpdateParams = params;
        return [{ affectedRows: 1 }];
      }
    }
  ]);

  pool.getConnection = async () => ({
    beginTransaction: async () => {
      transactionStarted = true;
    },
    query: transactionQuery,
    commit: async () => {
      transactionCommitted = true;
    },
    rollback: async () => {
      transactionRolledBack = true;
    },
    release: () => {
      connectionReleased = true;
    }
  });

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, company_id: 1, role: 'crc_operator', permissions: '["home"]', action_permissions: '[]' }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 7 }, { clinic_id: 9 }]]
    },
    {
      match: (sql) => sql.includes('SELECT setting_value, updated_by, updated_at FROM system_settings'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT crc_clinic_selection_completed_at FROM users'),
      reply: async () => [[{ crc_clinic_selection_completed_at: null }]]
    },
    {
      match: (sql) => sql.includes('SELECT id FROM clinics WHERE active = 1 AND id IN (?)'),
      reply: async (_sql, params) => [[
        { id: params[0][0] },
        { id: params[0][1] }
      ]]
    },
    {
      match: (sql) => sql.includes('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1'),
      reply: async () => [[{
        id: 88,
        name: 'Paula CRC',
        username: 'paula.crc',
        email: null,
        role: 'crc_operator',
        company_id: 1,
        permissions: '["home"]',
        action_permissions: '[]',
        active: 1,
        must_change_password: 0,
        token_version: 1,
        crc_clinic_selection_completed_at: '2026-06-17 10:00:00'
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE operator_clinics SET active = 0'),
      reply: async (_sql, params) => {
        operatorClinicResetParams = params;
        return [{ affectedRows: 2 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO operator_clinics'),
      reply: async (_sql, params) => {
        operatorClinicWrites.push(params);
        return [{ insertId: operatorClinicWrites.length }];
      }
    }
  ]);

  const response = await request(app)
    .post('/api/crc/initial-clinic-selection')
    .set('Authorization', `Bearer ${signToken({
      id: 88,
      email: null,
      username: 'paula.crc',
      role: 'crc_operator',
      name: 'Paula CRC',
      permissions: ['home'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({ clinicIds: [7, 9] });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(transactionStarted, true);
  assert.equal(transactionCommitted, true);
  assert.equal(transactionRolledBack, false);
  assert.equal(connectionReleased, true);
  assert.deepEqual(deleteParams, [88]);
  assert.deepEqual(insertedLinks, [[88, 7], [88, 9]]);
  assert.deepEqual(operatorClinicResetParams, ['Paula CRC', 88]);
  assert.deepEqual(operatorClinicWrites, [
    [88, 7, 'Paula CRC', 'Paula CRC'],
    [88, 9, 'Paula CRC', 'Paula CRC']
  ]);
  assert.deepEqual(completedUpdateParams, [88]);
  assert.deepEqual(response.body.clinicIds, [7, 9]);
  assert.deepEqual(response.body.user.clinicIds, [7, 9]);
  assert.equal(response.body.user.crcClinicSelectionCompletedAt, '2026-06-17 10:00:00');
  assert.ok(response.body.token);
});

test('CRC operator completed initial clinic selection no longer receives popup payload', async () => {
  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, company_id: 1, role: 'crc_operator', permissions: '["home"]', action_permissions: '[]' }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 7 }]]
    },
    {
      match: (sql) => sql.includes('SELECT setting_value, updated_by, updated_at FROM system_settings'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('SELECT crc_clinic_selection_completed_at FROM users'),
      reply: async () => [[{ crc_clinic_selection_completed_at: '2026-06-17 10:00:00' }]]
    }
  ]);

  const response = await request(app)
    .get('/api/crc/initial-clinic-selection')
    .set('Authorization', `Bearer ${signToken({
      id: 88,
      email: null,
      username: 'paula.crc',
      role: 'crc_operator',
      name: 'Paula CRC',
      permissions: ['home'],
      clinicIds: [],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.required, false);
  assert.equal(response.body.completed, true);
  assert.deepEqual(response.body.clinics, []);
  assert.deepEqual(response.body.selectedClinicIds, [7]);
});

test('supervisor crc can replicate open agenda items between users without duplicating existing task', async () => {
  const insertedAgendaParams = [];

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
      reply: async (_sql, params) => {
        const requestedId = Number(params[0]);
        if (requestedId === 55) {
          return [[{
            id: 55,
            name: 'Operador Origem',
            email: 'origem@example.com',
            role: 'crc_operator',
            position: 'Operador de CRC',
            department: 'CRC'
          }]];
        }
        if (requestedId === 56) {
          return [[{
            id: 56,
            name: 'Operador Destino',
            email: 'destino@example.com',
            role: 'crc_operator',
            position: 'Operador de CRC',
            department: 'CRC'
          }]];
        }
        return [[]];
      }
    },
    {
      match: (sql) => sql.includes('FROM agenda_items a') && sql.includes('a.is_daily_recurring = 1'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM agenda_items a') && sql.includes('a.assigned_user_id = ?') && sql.includes("a.status <> 'done'"),
      reply: async () => [[
        {
          id: 201,
          company_id: 1,
          owner_user_id: 9,
          owner_name: 'Supervisor CRC',
          assigned_user_id: 55,
          assigned_user_name: 'Operador Origem',
          assigned_user_email: 'origem@example.com',
          clinic_id: 7,
          clinic_name: 'Garavelo',
          demand_type: 'general',
          source_external_id: null,
          patient_name: null,
          patient_phone: null,
          patient_specialty: null,
          patient_dentist: null,
          patient_channel: null,
          patient_has_scheduled: 0,
          patient_scheduled_at: null,
          confirmation_status: null,
          confirmation_notes: null,
          source_label: 'manual',
          source_batch_id: null,
          title: 'Confirmar agenda da unidade',
          description: 'Duplicada no destino',
          status: 'today',
          priority: 'alta',
          is_daily_recurring: 0,
          requires_completion: 1,
          recurrence_base_status: null,
          recurrence_cycle_date: null,
          recurrence_weekdays_json: null,
          due_at: '2026-06-16 09:00:00',
          reminder_at: null,
          tags_json: '["CRC"]',
          checklist_json: '[]',
          board_order: 0
        },
        {
          id: 202,
          company_id: 1,
          owner_user_id: 9,
          owner_name: 'Supervisor CRC',
          assigned_user_id: 55,
          assigned_user_name: 'Operador Origem',
          assigned_user_email: 'origem@example.com',
          clinic_id: 7,
          clinic_name: 'Garavelo',
          demand_type: 'patient',
          source_external_id: null,
          patient_name: 'Maria Silva',
          patient_phone: '5562999999999',
          patient_specialty: 'Ortodontia',
          patient_dentist: 'Dr. Ana',
          patient_channel: 'WhatsApp',
          patient_has_scheduled: 1,
          patient_scheduled_at: '2026-06-17 10:00:00',
          confirmation_status: 'pendente',
          confirmation_notes: 'Aguardando retorno.',
          source_label: 'manual',
          source_batch_id: null,
          title: 'Retornar paciente Maria Silva',
          description: 'Contato ativo de confirmacao.',
          status: 'doing',
          priority: 'normal',
          is_daily_recurring: 1,
          requires_completion: 1,
          recurrence_base_status: 'today',
          recurrence_cycle_date: '2026-06-16',
          recurrence_weekdays_json: '[1,2,3,4,5]',
          due_at: '2026-06-17 10:00:00',
          reminder_at: '2026-06-17 09:00:00',
          tags_json: '["Garavelo"]',
          checklist_json: '[]',
          board_order: 2
        }
      ]]
    },
    {
      match: (sql) => sql.includes('FROM agenda_items a') && sql.includes('LIMIT 1000'),
      reply: async () => [[{
        title: 'Confirmar agenda da unidade',
        demand_type: 'general',
        due_at: '2026-06-16 09:00:00',
        patient_scheduled_at: null,
        patient_name: null,
        patient_phone: null,
        clinic_id: 7,
        is_daily_recurring: 0
      }]]
    },
    {
      match: (sql) => sql.includes('INSERT INTO agenda_items'),
      reply: async (_sql, params) => {
        insertedAgendaParams.push(params);
        return [{ insertId: 777 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO notification_events'),
      reply: async () => [{ insertId: 88 }]
    },
    {
      match: (sql) => sql.includes('INSERT INTO security_audit_logs'),
      reply: async () => [{ insertId: 89 }]
    }
  ]);

  const response = await request(app)
    .post('/api/agenda/items/replicate')
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
      source_user_id: 55,
      target_user_id: 56,
      skip_duplicates: true
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.sourceTotal, 2);
  assert.equal(response.body.created, 1);
  assert.equal(response.body.skippedDuplicates, 1);
  assert.equal(insertedAgendaParams.length, 1);
  assert.equal(insertedAgendaParams[0][1], 9);
  assert.equal(insertedAgendaParams[0][3], 56);
  assert.equal(insertedAgendaParams[0][4], 'Operador Destino');
  assert.equal(insertedAgendaParams[0][22], 'agenda_replication');
  assert.equal(insertedAgendaParams[0][24], 'Retornar paciente Maria Silva');
  assert.equal(insertedAgendaParams[0][27], 'normal');
  assert.equal(insertedAgendaParams[0][28], 1);
  assert.equal(insertedAgendaParams[0][29], 1);
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

test('agenda import worksheet parser accepts vertical patient blocks', () => {
  const rows = serverModule.__testables.parseAgendaImportRowsFromWorksheetRows([
    { campo: 'id_externo', valor: 'Q9MC7' },
    { campo: 'nome_paciente', valor: 'Maria Helena Ramos Da Silva' },
    { campo: 'consulta', valor: '14:00' },
    { campo: 'status', valor: 'Confirmado' },
    { campo: 'especialidade', valor: 'Primeira Avaliacao' },
    { campo: 'dentista', valor: 'Nao Especificado' },
    { campo: 'canal', valor: 'Internet' },
    {},
    { campo: 'id_externo', valor: 'VMC7V' },
    { campo: 'nome_paciente', valor: 'Henrique Sampaio Da Costa' },
    { campo: 'consulta', valor: '15:00' }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_external_id, 'Q9MC7');
  assert.equal(rows[0].patient_name, 'MARIA HELENA RAMOS DA SILVA');
  assert.equal(rows[0].hora_consulta, '14:00');
  assert.equal(rows[0].line, 2);
  assert.equal(rows[1].source_external_id, 'VMC7V');
  assert.equal(rows[1].patient_name, 'HENRIQUE SAMPAIO DA COSTA');
  assert.equal(rows[1].line, 10);
});

test('agenda import worksheet parser ignores copied interface rows between vertical patients', () => {
  const rows = serverModule.__testables.parseAgendaImportRowsFromWorksheetRows([
    { campo: 'id_externo', valor: 'WHRV6' },
    { campo: 'nome_paciente', valor: 'Lidiane Freitas Cardoso' },
    { campo: 'consulta', valor: '08:15' },
    { campo: 'status', valor: 'A Confirmar' },
    { campo: 'especialidade', valor: 'Reavaliacao' },
    { campo: 'dentista', valor: 'Follow up' },
    { campo: 'canal', valor: 'Fachada' },
    { campo: 'ignorar_interface_1', valor: 'mode_comment' },
    { campo: 'ignorar_interface_2', valor: '' },
    { campo: 'ignorar_interface_3', valor: 'more_horiz' },
    { campo: 'id_externo', valor: 'GSSFE' },
    { campo: 'nome_paciente', valor: 'Michele Encarnacao De Carvalho' },
    { campo: 'consulta', valor: '08:45' },
    { campo: 'status', valor: 'Confirmado' },
    { campo: 'especialidade', valor: 'Ortodontia' },
    { campo: 'dentista', valor: 'Nao Especificado' },
    { campo: 'canal', valor: 'Indicacao' }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_external_id, 'WHRV6');
  assert.equal(rows[0].patient_name, 'LIDIANE FREITAS CARDOSO');
  assert.equal(rows[1].source_external_id, 'GSSFE');
  assert.equal(rows[1].patient_name, 'MICHELE ENCARNACAO DE CARVALHO');
  assert.equal(rows[1].hora_consulta, '08:45');
});

test('agenda import worksheet parser rebuilds patients from pasted value stream even when labels look misaligned', () => {
  const rows = serverModule.__testables.parseAgendaImportRowsFromWorksheetRows([
    { campo: 'id_externo', valor: 'WHRV6' },
    { campo: 'nome_paciente', valor: 'Lidiane Freitas Cardoso' },
    { campo: 'consulta', valor: '08:15' },
    { campo: 'status', valor: 'A Confirmar' },
    { campo: 'especialidade', valor: 'Reavaliacao' },
    { campo: 'dentista', valor: 'Follow up' },
    { campo: 'canal', valor: 'Fachada' },
    { campo: 'ignorar_interface_1', valor: 'mode_comment' },
    { campo: 'ignorar_interface_2', valor: '' },
    { campo: 'ignorar_interface_3', valor: 'more_horiz' },
    { campo: 'id_externo', valor: 'GSSFE' },
    { campo: 'nome_paciente', valor: 'Michele Encarnacao De Carvalho' },
    { campo: 'consulta', valor: '08:45' },
    { campo: 'status', valor: 'Confirmado' },
    { campo: 'especialidade', valor: 'Ortodontia' },
    { campo: 'dentista', valor: 'Nao Especificado' },
    { campo: 'canal', valor: 'Indicacao' },
    { campo: 'ignorar_interface_1', valor: 'mode_comment' },
    { campo: 'ignorar_interface_2', valor: '' },
    { campo: 'ignorar_interface_3', valor: 'more_horiz' }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_external_id, 'WHRV6');
  assert.equal(rows[0].patient_name, 'LIDIANE FREITAS CARDOSO');
  assert.equal(rows[0].hora_consulta, '08:15');
  assert.equal(rows[1].source_external_id, 'GSSFE');
  assert.equal(rows[1].patient_name, 'MICHELE ENCARNACAO DE CARVALHO');
  assert.equal(rows[1].hora_consulta, '08:45');
});

test('agenda import worksheet parser accepts direct paste value stream sheet', () => {
  const rows = serverModule.__testables.parseAgendaImportRowsFromWorksheetRows([
    { valor: 'WHRV6' },
    { valor: 'Lidiane Freitas Cardoso' },
    { valor: '08:15' },
    { valor: 'A Confirmar' },
    { valor: 'Reavaliacao' },
    { valor: 'Follow up' },
    { valor: 'Fachada' },
    { valor: 'mode_comment' },
    { valor: '' },
    { valor: 'more_horiz' },
    { valor: 'GSSFE' },
    { valor: 'Michele Encarnacao De Carvalho' },
    { valor: '08:45' },
    { valor: 'Confirmado' },
    { valor: 'Ortodontia' },
    { valor: 'Nao Especificado' },
    { valor: 'Indicacao' }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_external_id, 'WHRV6');
  assert.equal(rows[0].patient_name, 'LIDIANE FREITAS CARDOSO');
  assert.equal(rows[1].source_external_id, 'GSSFE');
  assert.equal(rows[1].patient_name, 'MICHELE ENCARNACAO DE CARVALHO');
  assert.equal(rows[1].hora_consulta, '08:45');
});

test('agenda import prefers organized sheet when workbook contains formula output tab', () => {
  const preferredSheet = serverModule.__testables.resolveAgendaImportWorkbookSheetName({
    SheetNames: ['Colagem Direta', 'Dados Organizados', 'Exemplo Real']
  });

  const fallbackSheet = serverModule.__testables.resolveAgendaImportWorkbookSheetName({
    SheetNames: ['Colagem Direta', 'Exemplo Real']
  });

  assert.equal(preferredSheet, 'Dados Organizados');
  assert.equal(fallbackSheet, 'Colagem Direta');
});

test('agenda import applies one agenda date to vertical rows with consulta hour', () => {
  const parsedRows = serverModule.__testables.parseAgendaImportRowsFromWorksheetRows([
    { campo: 'id_externo', valor: 'GSSFE' },
    { campo: 'nome_paciente', valor: 'Michele Encarnacao De Carvalho' },
    { campo: 'consulta', valor: '08:45' },
    { campo: 'status', valor: 'Confirmado' },
    { campo: 'especialidade', valor: 'Ortodontia' },
    { campo: 'dentista', valor: 'Nao Especificado' },
    { campo: 'canal', valor: 'Indicacao' }
  ]);
  const rows = serverModule.__testables.applyAgendaImportSelectedDate(parsedRows, '2026-06-22');

  assert.equal(rows[0].data_consulta, '22/06/2026');
  assert.equal(rows[0].hora_consulta, '08:45');
  assert.equal(rows[0].due_at, '2026-06-22 08:45:00');
  assert.equal(rows[0].patient_scheduled_at, '2026-06-22 08:45:00');
  assert.equal(rows[0].patient_has_scheduled, true);
});

test('crc operator can delete visible agenda item with audit trail', async () => {
  let deleteParams = null;
  let auditInserted = false;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{ must_change_password: 0, token_version: 1, active: 1, role: 'crc_operator', company_id: 1 }]]
    },
    {
      match: (sql) => sql.includes('SELECT clinic_id FROM user_clinics WHERE user_id = ?'),
      reply: async () => [[{ clinic_id: 7 }]]
    },
    {
      match: (sql) => sql.includes('FROM agenda_items') && sql.includes('WHERE id = ?') && sql.includes('deleted_at IS NULL'),
      reply: async () => [[{
        id: 44,
        title: 'Confirmar paciente premium',
        assigned_user_id: 88,
        owner_user_id: 88,
        clinic_id: 7,
        deleted_at: null
      }]]
    },
    {
      match: (sql) => sql.includes('UPDATE agenda_items') && sql.includes('deleted_by_name'),
      reply: async (_sql, params) => {
        deleteParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO security_audit_logs'),
      reply: async () => {
        auditInserted = true;
        return [{ insertId: 1 }];
      }
    }
  ]);

  const response = await request(app)
    .delete('/api/agenda/items/44')
    .set('Authorization', `Bearer ${signToken({
      id: 88,
      email: 'operador.crc@example.com',
      role: 'crc_operator',
      name: 'Operador CRC',
      permissions: ['home'],
      clinicIds: [7],
      mustChangePassword: false
    })}`)
    .send({ reason: 'Registro importado em duplicidade' });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(Array.isArray(deleteParams));
  assert.equal(deleteParams[0], 'Operador CRC');
  assert.equal(deleteParams[1], 'crc_operator');
  assert.equal(deleteParams[2], 'Registro importado em duplicidade');
  assert.equal(deleteParams[3], '44');
  assert.equal(auditInserted, true);
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

test('sac operator can move complaint to waiting attendance follow-up after treatment and contact', async () => {
  let updateComplaintSql = '';
  let updateComplaintParams = null;
  let statusLogParams = null;

  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{
        must_change_password: 0,
        token_version: 1,
        active: 1,
        role: 'Operador de SAC',
        permissions: JSON.stringify(['complaints_management']),
        action_permissions: null
      }]]
    },
    {
      match: (sql) => sql.includes('FROM complaints c') && sql.includes('WHERE c.id = ?'),
      reply: async () => [[{
        id: 48,
        protocol: 'GRC-2026-000048',
        clinic_id: 1,
        patient_name: 'Paciente Acompanhamento',
        patient_phone: '+5562999999999',
        status: 'em_andamento',
        priority: 'media',
        operator_comment: 'Paciente em tratativa.',
        treatment_at: new Date('2026-05-10T12:00:00.000Z'),
        treatment_by_role: 'manager',
        patient_contacted_at: new Date('2026-05-11T09:00:00.000Z'),
        first_attendance_at: new Date('2026-05-11T09:00:00.000Z'),
        attachment_url: null,
        deleted_at: null,
        created_at: new Date('2026-05-09T12:00:00.000Z'),
        updated_at: new Date('2026-05-11T09:30:00.000Z')
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
      match: (sql) => sql.includes('UPDATE complaints') && sql.includes('status = ?'),
      reply: async (sql, params) => {
        updateComplaintSql = sql;
        updateComplaintParams = params;
        return [{ affectedRows: 1 }];
      }
    },
    {
      match: (sql) => sql.includes('INSERT INTO complaint_logs'),
      reply: async (_sql, params) => {
        statusLogParams = params;
        return [{ insertId: 7 }];
      }
    }
  ]);

  const response = await request(app)
    .patch('/complaints/48')
    .set('Authorization', `Bearer ${signToken({
      id: 9,
      email: 'sac@example.com',
      role: 'Operador de SAC',
      name: 'Operador SAC',
      permissions: ['complaints_management'],
      clinicIds: [],
      mustChangePassword: false
    })}`)
    .send({ mark_waiting_attendance: true });

  assert.equal(response.status, 200);
  assert.match(updateComplaintSql, /status = \?/);
  assert.equal(updateComplaintParams[0], 'aguardando_comparecimento_conclusao_atendimento');
  assert.equal(statusLogParams[1], 'awaiting_attendance_followup');
  assert.equal(statusLogParams[5], 'em_andamento');
  assert.equal(statusLogParams[6], 'aguardando_comparecimento_conclusao_atendimento');
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
  assert.equal(response.body.access.canCloseComplaint, false);
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
  assert.match(response.headers['content-disposition'], /attachment/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.text, 'arquivo persistido');
});

test('sac operator cannot close complaint even when manager treatment exists in immutable history', async () => {
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

  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'Somente Administrador ou Administrador Master podem fechar uma reclamacao.');
  assert.equal(updateComplaintSql, '');
  assert.equal(updateComplaintParams, null);
  assert.equal(closeLogParams, null);
});

test('CRC operator exports visible agenda tasks in Excel without e-mail dependency', async () => {
  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{
        must_change_password: 0,
        token_version: 1,
        active: 1,
        role: 'crc_operator',
        permissions: JSON.stringify(['home']),
        action_permissions: null
      }]]
    },
    {
      match: (sql) => sql.includes('FROM agenda_items a') && sql.includes('is_daily_recurring = 1'),
      reply: async () => [[]]
    },
    {
      match: (sql) => sql.includes('FROM agenda_items a') && sql.includes('LEFT JOIN users u') && sql.includes('ORDER BY COALESCE(a.due_at'),
      reply: async () => [[{
        id: 10,
        company_id: 1,
        title: 'Confirmar paciente Ana',
        description: 'Confirmacao de agenda',
        status: 'todo',
        priority: 'alta',
        owner_user_id: 21,
        owner_name: 'Operadora CRC',
        assigned_user_id: 21,
        assigned_user_name: 'Operadora CRC',
        assigned_user_email: null,
        clinic_id: 7,
        clinic_name: 'Clinica Centro',
        demand_type: 'patient',
        patient_name: 'Ana Paciente',
        patient_phone: '5562999999999',
        patient_specialty: 'Ortodontia',
        patient_dentist: 'Dra. Teste',
        patient_channel: 'WhatsApp',
        patient_has_scheduled: 1,
        patient_scheduled_at: new Date('2026-06-20T13:00:00.000Z'),
        confirmation_status: 'pendente',
        due_at: new Date('2026-06-19T12:00:00.000Z'),
        reminder_at: null,
        completed_at: null,
        created_at: new Date('2026-06-17T12:00:00.000Z'),
        updated_at: new Date('2026-06-17T12:10:00.000Z')
      }]]
    }
  ]);

  const response = await request(app)
    .get('/api/agenda/items/export/excel')
    .set('Authorization', `Bearer ${signToken({
      id: 21,
      role: 'crc_operator',
      name: 'Operadora CRC',
      permissions: ['home'],
      clinicIds: [7],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /spreadsheetml\.sheet/);
  assert.match(response.headers['content-disposition'], /agenda-tarefas\.xlsx/);
});

test('agenda confirmations dashboard summarizes WhatsApp sent dates by collaborator and clinic', async () => {
  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{
        must_change_password: 0,
        token_version: 1,
        active: 1,
        role: 'admin',
        permissions: JSON.stringify(['home']),
        action_permissions: null
      }]]
    },
    {
      match: (sql) => sql.includes('FROM agenda_items a') && sql.includes('LEFT JOIN whatsapp_campaign_recipients wcr'),
      reply: async () => [[{
        id: 22,
        company_id: 1,
        title: 'Confirmar Joao',
        description: null,
        status: 'today',
        priority: 'normal',
        owner_user_id: 3,
        owner_name: 'Lider CRC',
        assigned_user_id: 31,
        assigned_user_name: 'Colaborador CRC',
        assigned_user_email: null,
        clinic_id: 8,
        clinic_name: 'Clinica Norte',
        demand_type: 'patient',
        patient_name: 'Joao Paciente',
        patient_phone: '5562888888888',
        patient_has_scheduled: 1,
        patient_scheduled_at: new Date('2026-06-22T13:00:00.000Z'),
        confirmation_status: 'pendente',
        due_at: new Date('2026-06-21T12:00:00.000Z'),
        reminder_at: null,
        source_batch_id: 'agenda-import-test',
        created_at: new Date('2026-06-17T12:00:00.000Z'),
        updated_at: new Date('2026-06-17T12:10:00.000Z'),
        whatsapp_recipient_id: 70,
        whatsapp_batch_id: 'agenda-import-test',
        whatsapp_recipient_status: 'queued',
        routing_error: null,
        whatsapp_recipient_created_at: new Date('2026-06-17T12:20:00.000Z'),
        whatsapp_recipient_updated_at: new Date('2026-06-17T12:20:00.000Z'),
        whatsapp_queue_status: 'processed',
        whatsapp_send_status: 'sent',
        whatsapp_scheduled_at: new Date('2026-06-17T12:19:00.000Z'),
        whatsapp_sent_at: new Date('2026-06-17T12:21:00.000Z'),
        whatsapp_processed_at: new Date('2026-06-17T12:21:00.000Z'),
        whatsapp_error: null,
        message_status: 'sent',
        message_sent_at: new Date('2026-06-17T12:21:00.000Z'),
        message_delivered_at: null,
        message_read_at: null,
        message_responded_at: new Date('2026-06-17T12:25:00.000Z'),
        message_error: null,
        chatbot_status: 'completed',
        chatbot_collected_data: JSON.stringify({ confirmation_decision: 'confirmado' }),
        chatbot_completed_at: new Date('2026-06-17T12:25:00.000Z'),
        chatbot_last_interaction_at: new Date('2026-06-17T12:25:00.000Z')
      }]]
    }
  ]);

  const response = await request(app)
    .get('/api/agenda/confirmations/dashboard?days=30')
    .set('Authorization', `Bearer ${signToken({
      id: 3,
      role: 'admin',
      name: 'Administrador',
      permissions: ['home'],
      clinicIds: [],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.summary.total, 1);
  assert.equal(response.body.summary.confirmed, 1);
  assert.equal(response.body.summary.confirmation_rate, 100);
  assert.equal(response.body.items[0].confirmation_status, 'confirmado');
  assert.ok(response.body.items[0].whatsapp_sent_at);
  assert.equal(response.body.collaborators[0].name, 'Colaborador CRC');
  assert.equal(response.body.clinics[0].clinic_name, 'Clinica Norte');
});

test('CRC operator opens confirmations dashboard scoped to own agenda demands', async () => {
  let confirmationSql = '';
  let confirmationParams = [];
  pool.query = buildQueryStub([
    {
      match: (sql) => sql.includes('SELECT must_change_password, token_version, active') && sql.includes('FROM users'),
      reply: async () => [[{
        must_change_password: 0,
        token_version: 1,
        active: 1,
        role: 'crc_operator',
        permissions: JSON.stringify(['home']),
        action_permissions: null
      }]]
    },
    {
      match: (sql) => sql.includes('FROM agenda_items a') && sql.includes('LEFT JOIN whatsapp_campaign_recipients wcr'),
      reply: async (sql, params) => {
        confirmationSql = sql;
        confirmationParams = params;
        return [[]];
      }
    }
  ]);

  const response = await request(app)
    .get('/api/agenda/confirmations/dashboard')
    .set('Authorization', `Bearer ${signToken({
      id: 21,
      role: 'crc_operator',
      name: 'Operadora CRC',
      permissions: ['home'],
      clinicIds: [7],
      mustChangePassword: false
    })}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.summary.total, 0);
  assert.match(confirmationSql, /a\.owner_user_id = \?/);
  assert.match(confirmationSql, /a\.assigned_user_id = \?/);
  assert.match(confirmationSql, /a\.clinic_id IS NULL OR a\.clinic_id IN \(\?\)/);
  assert.deepEqual(confirmationParams.slice(0, 4), [1, 21, 21, [7]]);
});

