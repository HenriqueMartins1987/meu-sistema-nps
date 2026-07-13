const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED || 'false';
process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'log';

const { generateTemporaryPassword } = require('../utils/password');
const {
  DEFAULT_EMAIL_FROM,
  getEmailFrom,
  getEmailProvider,
  getResendFromCandidates,
  isResendSenderAuthorizationError,
  renderOperationalTestEmail,
  renderPasswordResetEmail,
  renderUserAccessEmail,
  sendWelcomeEmail
} = require('../services/emailService');
const {
  buildAppointmentReminderMessage,
  buildPasswordChangeUrl,
  buildPasswordResetMessage,
  buildWelcomeMessage,
  normalizeWhatsAppPhone
} = require('../services/whatsappService');
const {
  buildComplaintTemplateVariables,
  buildProtocolTemplateVariables,
  normalizePhoneNumber: normalizeTwilioPhoneNumber,
  normalizeTwilioWhatsAppFrom,
  describeTwilioMessageError,
  sendTemplateMessage
} = require('../services/twilioWhatsAppService');
const serverModule = require('../server');
const { __testables } = serverModule;

test('generateTemporaryPassword creates a strong temporary password', () => {
  const password = generateTemporaryPassword(10);

  assert.equal(password.length, 10);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[@#$%&*!?]/);
});

test('getEmailProvider prefers resend when API key is configured', () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousProvider = process.env.EMAIL_PROVIDER;

  process.env.RESEND_API_KEY = 'resend_test_key';
  process.env.EMAIL_PROVIDER = '';

  assert.equal(getEmailProvider(), 'resend');

  process.env.RESEND_API_KEY = previousApiKey;
  process.env.EMAIL_PROVIDER = previousProvider;
});

test('getEmailFrom uses configured sender and falls back to default', () => {
  const previousFrom = process.env.EMAIL_FROM;
  const previousSmtpFrom = process.env.SMTP_FROM;
  const previousSmtpUser = process.env.SMTP_USER;

  delete process.env.EMAIL_FROM;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_USER;
  assert.equal(getEmailFrom(), DEFAULT_EMAIL_FROM);

  process.env.EMAIL_FROM = 'GRC Consultoria <contato@grcconsultoria.net.br>';
  assert.equal(getEmailFrom(), DEFAULT_EMAIL_FROM);

  process.env.EMAIL_FROM = 'GRC Consultoria <contato@grcconsultoria.siteempresarial.com>';
  assert.equal(getEmailFrom(), DEFAULT_EMAIL_FROM);

  process.env.EMAIL_FROM = 'Grupo Sorria <contato@grcconsultoria.siteempresarial.com>';
  assert.equal(getEmailFrom(), DEFAULT_EMAIL_FROM);

  process.env.EMAIL_FROM = previousFrom;
  process.env.SMTP_FROM = previousSmtpFrom;
  process.env.SMTP_USER = previousSmtpUser;
});

test('getResendFromCandidates keeps the professional sender and configured fallback', () => {
  const previousFrom = process.env.EMAIL_FROM;
  const previousFallbackFrom = process.env.RESEND_FALLBACK_FROM;

  process.env.EMAIL_FROM = 'GRC Consultoria <contato@grcconsultoria.net.br>';
  process.env.RESEND_FALLBACK_FROM = 'Grupo Sorria <fallback@example.com>';

  assert.deepEqual(getResendFromCandidates(), [
    DEFAULT_EMAIL_FROM,
    'Grupo Sorria <fallback@example.com>'
  ]);

  if (previousFrom === undefined) {
    delete process.env.EMAIL_FROM;
  } else {
    process.env.EMAIL_FROM = previousFrom;
  }

  if (previousFallbackFrom === undefined) {
    delete process.env.RESEND_FALLBACK_FROM;
  } else {
    process.env.RESEND_FALLBACK_FROM = previousFallbackFrom;
  }
});

test('isResendSenderAuthorizationError detects unauthorized sender responses', () => {
  assert.equal(isResendSenderAuthorizationError({
    message: 'This API key is not authorized to send emails from grcconsultoria.net.br',
    statusCode: 403
  }), true);

  assert.equal(isResendSenderAuthorizationError({
    message: 'Invalid recipient',
    statusCode: 422
  }), false);
});

test('renderUserAccessEmail returns the user access template', () => {
  const template = renderUserAccessEmail({
    name: 'Maria Silva',
    email: 'maria@example.com',
    temporaryPassword: 'Tmp@12345',
    appUrl: 'https://meu-sistema-nps.vercel.app/'
  });

  assert.equal(template.subject, 'Seu acesso ao portal foi criado');
  assert.match(template.html, /Maria Silva/);
  assert.match(template.html, /maria@example.com/);
  assert.match(template.html, /Tmp@12345/);
  assert.match(template.html, /Grupo Sorria/);
  assert.match(template.html, /font-family:Georgia,'Times New Roman',serif/);
  assert.doesNotMatch(template.html, /<img\b/i);
  assert.doesNotMatch(template.html, /data:image/i);
  assert.doesNotMatch(template.html, />GRC Consultoria</);
});

test('sendWelcomeEmail forwards the rendered template to the configured sender', async () => {
  let payload = null;

  const result = await sendWelcomeEmail({
    to: 'maria@example.com',
    name: 'Maria Silva',
    loginEmail: 'maria@example.com',
    password: 'Tmp@12345',
    appUrl: 'https://meu-sistema-nps.vercel.app/',
    sender: async (message) => {
      payload = message;
      return { provider: 'mock', id: 'email-1' };
    }
  });

  assert.equal(result.provider, 'mock');
  assert.equal(payload.to, 'maria@example.com');
  assert.equal(payload.subject, 'Seu acesso ao portal foi criado');
  assert.match(payload.html, /Maria Silva/);
  assert.match(payload.html, /Tmp@12345/);
  assert.match(payload.text, /maria@example.com/);
});

test('renderOperationalTestEmail returns a dedicated channel validation template', () => {
  const template = renderOperationalTestEmail({
    name: 'Administrador Master',
    loginEmail: 'admin@example.com',
    appUrl: 'https://meu-sistema-nps.vercel.app/'
  });

  assert.equal(template.subject, 'Teste de e-mail - Sistema GRC');
  assert.match(template.html, /Canal de e-mail validado/);
  assert.match(template.html, /admin@example.com/);
  assert.doesNotMatch(template.html, /Senha tempor/iu);
});

test('normalizeWhatsAppPhone normalizes brazilian phones to E.164 digits', () => {
  assert.equal(normalizeWhatsAppPhone('+55 (62) 99966-9966'), '5562999669966');
  assert.equal(normalizeWhatsAppPhone('62999669966'), '5562999669966');
  assert.equal(normalizeWhatsAppPhone('123'), '');
});

test('parseMassWhatsAppRecipients accepts header and optional confirmation fields', () => {
  const parsed = __testables.parseMassWhatsAppRecipients([
    'nome_paciente;telefone;clinica;data_consulta;hora_consulta',
    'Maria Silva;5562999999999;Garavelo;26/05/2026;14:30',
    'Joao sem telefone;;Centro;26/05/2026;16:00'
  ].join('\n'));

  assert.equal(parsed.recipients.length, 1);
  assert.deepEqual(parsed.recipients[0], {
    patient_name: 'MARIA SILVA',
    patient_phone: '5562999999999',
    clinic_name: 'Garavelo',
    data_consulta: '26/05/2026',
    hora_consulta: '14:30'
  });
  assert.equal(parsed.invalidRows.length, 1);
});

test('parseMassWhatsAppRecipients accepts a phone-only line for simple mass send', () => {
  const parsed = __testables.parseMassWhatsAppRecipients('62999999999');

  assert.equal(parsed.recipients.length, 1);
  assert.equal(parsed.recipients[0].patient_name, 'PACIENTE');
  assert.equal(parsed.recipients[0].patient_phone, '5562999999999');
  assert.equal(parsed.invalidRows.length, 0);
});

test('buildMassCampaignBlockedMessage explains zero-queued confirmation campaigns', () => {
  const message = __testables.buildMassCampaignBlockedMessage({
    campaignType: 'confirmacao',
    unresolvedRecipients: [{ patient_phone: '5562999999999', error: 'O WhatsApp da clínica foi encontrado, mas não está logado no momento.' }],
    invalidRows: [],
    selectedClinic: { clinic_name: 'Garavelo' }
  });

  assert.match(message, /Nenhuma mensagem foi enfileirada/);
  assert.match(message, /Garavelo/);
  assert.match(message, /não está logado/i);
});

test('renderGenericWhatsAppTemplate replaces campaign variables safely', () => {
  const rendered = __testables.renderGenericWhatsAppTemplate(
    'Ola, {{nome_paciente}}. Sua consulta na {{clinica}} e {{data_consulta}} as {{hora_consulta}}.',
    {
      nome_paciente: 'Maria',
      clinica: 'Garavelo',
      data_consulta: '26/05/2026',
      hora_consulta: '14:30'
    }
  );

  assert.equal(rendered, 'Ola, MARIA. Sua consulta na Garavelo e 26/05/2026 as 14:30.');
});

test('parseMassWhatsAppRecipientsFromWorksheetRows accepts excel-like rows', () => {
  const parsed = __testables.parseMassWhatsAppRecipientsFromWorksheetRows([
    { nome_paciente: 'Maria Silva', telefone: '5562999999999', clinica: 'Garavelo', data_consulta: '26/05/2026', hora_consulta: '14:30' },
    { nome_paciente: '', telefone: '', clinica: 'Centro' }
  ]);

  assert.equal(parsed.recipients.length, 1);
  assert.equal(parsed.recipients[0].patient_name, 'MARIA SILVA');
  assert.equal(parsed.invalidRows.length, 1);
});

test('parseMassWhatsAppRecipientsFromWorksheetRows normalizes Excel serial date and time', () => {
  const parsed = __testables.parseMassWhatsAppRecipientsFromWorksheetRows([
    {
      'Nome do Paciente': 'Ana Clara',
      'Número': '62 99999-9999',
      'Clínica': 'Garavelo',
      'Data da consulta': 46168,
      'Horário': 0.6041666667
    }
  ]);

  assert.equal(parsed.recipients.length, 1);
  assert.deepEqual(parsed.recipients[0], {
    patient_name: 'ANA CLARA',
    patient_phone: '5562999999999',
    clinic_name: 'Garavelo',
    data_consulta: '26/05/2026',
    hora_consulta: '14:30'
  });
});

test('parseBulkNpsWorksheetRows accepts excel-like rows for NPS dispatch', () => {
  const parsed = __testables.parseBulkNpsWorksheetRows([
    { nome_paciente: 'Maria Silva', telefone: '5562999999999', clinica: 'Garavelo' },
    { nome_paciente: '', telefone: '', clinica: 'Centro' }
  ]);

  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    name: 'MARIA SILVA',
    phone: '+5562999999999',
    clinic: 'Garavelo'
  });
});

test('normalizeTwilioPhoneNumber keeps WhatsApp prefix and accepts fixed complaint numbers', () => {
  assert.equal(normalizeTwilioPhoneNumber('5562996807670'), 'whatsapp:+5562996807670');
  assert.equal(normalizeTwilioPhoneNumber('556299669966'), 'whatsapp:+556299669966');
  assert.equal(normalizeTwilioPhoneNumber('whatsapp:+5562996807670'), 'whatsapp:+5562996807670');
  assert.equal(normalizeTwilioPhoneNumber('123'), '');
});

test('normalizeTwilioWhatsAppFrom accepts Render values with or without whatsapp prefix', () => {
  assert.equal(normalizeTwilioWhatsAppFrom('+14155238886'), 'whatsapp:+14155238886');
  assert.equal(normalizeTwilioWhatsAppFrom('whatsapp:+14155238886'), 'whatsapp:+14155238886');
});

test('describeTwilioMessageError explains sandbox delivery failures', () => {
  assert.match(describeTwilioMessageError(63015), /Sandbox/);
  assert.match(describeTwilioMessageError(63015), /sender WhatsApp aprovado/);
});

test('sendTemplateMessage skips safely when Twilio credentials are missing', async () => {
  const previousSid = process.env.TWILIO_ACCOUNT_SID;
  const previousToken = process.env.TWILIO_AUTH_TOKEN;

  process.env.TWILIO_ACCOUNT_SID = '';
  process.env.TWILIO_AUTH_TOKEN = '';

  const result = await sendTemplateMessage({
    to: '5562996807670',
    templateSid: 'HX00000000000000000000000000000000',
    variables: { protocolo: 'GRC-2026-000001' },
    protocol: 'GRC-2026-000001'
  });

  assert.equal(result.success, false);
  assert.equal(result.skipped, true);
  assert.match(result.error, /TWILIO_ACCOUNT_SID/);

  if (previousSid === undefined) {
    delete process.env.TWILIO_ACCOUNT_SID;
  } else {
    process.env.TWILIO_ACCOUNT_SID = previousSid;
  }

  if (previousToken === undefined) {
    delete process.env.TWILIO_AUTH_TOKEN;
  } else {
    process.env.TWILIO_AUTH_TOKEN = previousToken;
  }
});

test('complaint template variables default to indexed protocol and complaint link', () => {
  const previousProtocolVariable = process.env.TWILIO_TEMPLATE_PROTOCOL_VARIABLE;
  const previousLinkVariable = process.env.TWILIO_TEMPLATE_COMPLAINT_LINK_VARIABLE;

  delete process.env.TWILIO_TEMPLATE_PROTOCOL_VARIABLE;
  delete process.env.TWILIO_TEMPLATE_COMPLAINT_LINK_VARIABLE;

  assert.deepEqual(
    buildComplaintTemplateVariables('GRC-2026-000001', 'https://meu-sistema-nps.vercel.app/gestao/1'),
    {
      1: 'GRC-2026-000001',
      2: 'https://meu-sistema-nps.vercel.app/gestao/1'
    }
  );

  process.env.TWILIO_TEMPLATE_PROTOCOL_VARIABLE = 'protocolo';
  assert.deepEqual(buildProtocolTemplateVariables('GRC-2026-000002'), {
    protocolo: 'GRC-2026-000002'
  });

  if (previousProtocolVariable === undefined) {
    delete process.env.TWILIO_TEMPLATE_PROTOCOL_VARIABLE;
  } else {
    process.env.TWILIO_TEMPLATE_PROTOCOL_VARIABLE = previousProtocolVariable;
  }

  if (previousLinkVariable === undefined) {
    delete process.env.TWILIO_TEMPLATE_COMPLAINT_LINK_VARIABLE;
  } else {
    process.env.TWILIO_TEMPLATE_COMPLAINT_LINK_VARIABLE = previousLinkVariable;
  }
});

test('complaint overdue reminder job key stays stable within the same 6-hour window', () => {
  const first = new Date('2026-05-08T00:15:00.000Z');
  const second = new Date('2026-05-08T05:59:59.000Z');
  const third = new Date('2026-05-08T06:00:00.000Z');

  assert.equal(
    __testables.buildComplaintExpiredResponsibleReminderWindowKey(first),
    __testables.buildComplaintExpiredResponsibleReminderWindowKey(second)
  );
  assert.notEqual(
    __testables.buildComplaintExpiredResponsibleReminderWindowKey(first),
    __testables.buildComplaintExpiredResponsibleReminderWindowKey(third)
  );
  assert.equal(
    __testables.buildComplaintExpiredResponsibleReminderJobKey(99, first),
    __testables.buildComplaintExpiredResponsibleReminderJobKey(99, second)
  );
  assert.notEqual(
    __testables.buildComplaintExpiredResponsibleReminderJobKey(99, second),
    __testables.buildComplaintExpiredResponsibleReminderJobKey(99, third)
  );
});

test('complaint notification templates include the complaint link and detailed WhatsApp message', () => {
  const complaint = {
    id: 123,
    protocol: 'GRC-2026-000123',
    patient_name: 'João Paciente',
    complaint_type: 'Atendimento',
    description: 'Paciente relatou demora no atendimento e falta de retorno.',
    priority: 'alta',
    due_at: '2026-05-06T15:00:00.000Z',
    created_at: '2026-05-06T12:00:00.000Z',
    clinic_name: 'Unidade Centro',
    city: 'Goiânia',
    state: 'GO',
    assigned_user_name: 'Maria Coordenadora',
    assigned_user_whatsapp: '+5562999999999'
  };

  const message = __testables.buildComplaintWhatsAppMessage(complaint, complaint.protocol);
  const email = __testables.buildComplaintNotificationEmail(complaint, complaint.protocol);
  assert.match(email.html, /\/gestao\/123/);
  assert.match(message, /NOVA RECLAMACAO REGISTRADA/);
  assert.doesNotMatch(message, /[^\x09\x0A\x0D\x20-\x7E]/);
  assert.match(message, /\*Protocolo:\* GRC-2026-000123/);
  assert.match(message, /\[UNIDADE\] Unidade Centro/);
  assert.match(message, /\[RESPONSAVEL\] Maria Coordenadora @5562999999999/);
  assert.match(message, /\[LINK DA OCORRENCIA\]/);
  assert.match(message, /PRAZOS DE ATENDIMENTO/);
  assert.match(message, /- Primeira acao: ate 24h/);
  assert.match(message, /- Atualizacao obrigatoria: ate 48h/);
  assert.match(message, /- Prazo final: 7 dias uteis/);
  assert.match(message, /\/gestao\/123/);
  assert.doesNotMatch(message, /Resumo da ocorr/);
});

test('assigned complaint notifications email only current responsible and master', async () => {
  const originalQuery = serverModule.pool.query;

  serverModule.pool.query = async (sql, params = []) => {
    if (sql.includes('SELECT coordinator_name, responsible_email, responsible_whatsapp FROM clinics')) {
      assert.equal(params[0], 5);
      return [[{
        coordinator_name: 'Coordenadora Unidade',
        responsible_email: 'responsavel@clinica.com',
        responsible_whatsapp: '+5562988887777'
      }]];
    }

    if (sql.includes('INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?')) {
      assert.equal(params[0], 5);
      return [[
        { id: 17, name: 'Coordenadora Unidade', email: 'coordenadora@clinica.com', whatsapp: '+5562999990000', phone: '', role: 'coordinator' },
        { id: 21, name: 'Gerente Unidade', email: 'gerente@clinica.com', whatsapp: '+5562999991111', phone: '', role: 'manager' }
      ]];
    }

    if (sql.includes('SELECT DISTINCT id, name, email, whatsapp, phone, role') && sql.includes('LOWER(name) = LOWER(?)')) {
      return [[
        { id: 17, name: 'Coordenadora Unidade', email: 'coordenadora@clinica.com', whatsapp: '+5562999990000', phone: '', role: 'coordinator' }
      ]];
    }

    throw new Error(`Unexpected query in test: ${sql}`);
  };

  try {
    const recipients = await __testables.buildComplaintAssignedNotificationRecipients({
      clinic_id: 5,
      responsible_email: 'responsavel@clinica.com',
      responsible_whatsapp: '+5562988887777',
      assigned_user_id: 17,
      assigned_user_name: 'Coordenadora Unidade',
      assigned_user_email: 'coordenadora@clinica.com',
      assigned_user_whatsapp: '+5562999990000',
      assigned_user_role: 'coordinator',
      assigned_coordinator_name: 'Coordenadora Unidade',
      assigned_responsible_role: 'coordinator',
      forwarded_to_role: 'coordinator'
    });

    assert.ok(recipients.some((recipient) => recipient.email === 'coordenadora@clinica.com'));
    assert.ok(recipients.some((recipient) => recipient.role === 'master_admin' && recipient.email));
    assert.ok(!recipients.some((recipient) => recipient.email === 'gerente@clinica.com'));
    assert.ok(!recipients.some((recipient) => recipient.email === 'responsavel@clinica.com'));
  } finally {
    serverModule.pool.query = originalQuery;
  }
});

test('configured complaint alert recipient keeps the complaint VPS session and selected phone', () => {
  const recipient = __testables.buildConfiguredComplaintAlertRecipient({
    coordinator_user_id: 17,
    coordinator_name: 'Ana Coordenadora',
    coordinator_phone: '5562999990000'
  }, 'coordinator', [{
    userId: 17,
    name: 'Nome anterior',
    role: 'coordinator',
    email: 'ana@example.com',
    phone: '5562888880000'
  }]);

  assert.deepEqual(recipient, {
    userId: 17,
    name: 'Ana Coordenadora',
    role: 'coordinator',
    email: 'ana@example.com',
    phone: '5562999990000',
    sessionId: 'reclamacoes'
  });
});

test('managed complaint alerts resolve coordinator and manager from saved clinic settings', async () => {
  const originalQuery = serverModule.pool.query;

  serverModule.pool.query = async (sql, params = []) => {
    if (sql.includes('FROM complaint_whatsapp_alert_settings')) {
      assert.equal(params[0], 5);
      return [[{
        clinic_id: 5,
        enabled: 1,
        notify_coordinator: 1,
        notify_manager: 1,
        coordinator_user_id: 17,
        coordinator_name: 'Ana Coordenadora',
        coordinator_phone: '5562999990000',
        manager_user_id: 21,
        manager_name: 'Bruno Gerente',
        manager_phone: '5562999991111'
      }]];
    }

    if (sql.includes('SELECT coordinator_name, responsible_email, responsible_whatsapp FROM clinics')) {
      return [[{
        coordinator_name: '',
        responsible_email: '',
        responsible_whatsapp: ''
      }]];
    }

    if (sql.includes('INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?')) {
      return [[
        { id: 17, name: 'Ana Coordenadora', email: 'ana@example.com', whatsapp: '5562888880000', phone: '', role: 'coordinator' },
        { id: 21, name: 'Bruno Gerente', email: 'bruno@example.com', whatsapp: '5562888881111', phone: '', role: 'manager' }
      ]];
    }

    throw new Error(`Unexpected query in test: ${sql}`);
  };

  try {
    const recipients = await __testables.getManagedComplaintAlertRecipients(5);

    assert.deepEqual(recipients, [
      {
        userId: 17,
        name: 'Ana Coordenadora',
        role: 'coordinator',
        email: 'ana@example.com',
        phone: '5562999990000',
        sessionId: 'reclamacoes'
      },
      {
        userId: 21,
        name: 'Bruno Gerente',
        role: 'manager',
        email: 'bruno@example.com',
        phone: '5562999991111',
        sessionId: 'reclamacoes'
      }
    ]);
  } finally {
    serverModule.pool.query = originalQuery;
  }
});

test('daily coordinator WhatsApp reminder is ASCII-safe and professional', () => {
  const message = __testables.buildDailyCoordinatorDemandReminderMessage({
    coordinator: { name: 'Joao Coordenador' },
    summary: { total: 3, overdue: 1, withoutTreatment: 2 },
    demands: [
      {
        id: 1,
        protocol: 'GRC-2026-000001',
        clinic_name: 'Clinica Centro',
        status: 'em_andamento',
        deadline_at: '2026-05-17T11:00:00.000Z'
      }
    ]
  });

  assert.match(message, /\[LEMBRETE DIARIO - DEMANDAS\]/);
  assert.match(message, /Demandas abertas: 3/);
  assert.match(message, /GRC-2026-000001/);
  assert.match(message, /\/gestao/);
  assert.doesNotMatch(message, /[^\x09\x0A\x0D\x20-\x7E]/);
});

test('partner video reminder is ASCII-safe for whatsapp-service', () => {
  const message = __testables.fillPartnerVideoTemplate(
    'Bom dia, Dr(a). {{partner_name}}.\n📌 Unidade: {{clinic_name}}\n⏰ Prazo até 09:30.\nVídeo único para amanhã.',
    {
      partner_name: 'Bruna Frazão',
      clinic_name: 'Núcleo Bandeirante'
    }
  );

  assert.match(message, /Bruna Frazao/);
  assert.match(message, /Nucleo Bandeirante/);
  assert.match(message, /Prazo ate 09:30/);
  assert.doesNotMatch(message, /\?/);
  assert.doesNotMatch(message, /[^\x09\x0A\x0D\x20-\x7E]/);
});

test('partner video clinic coverage tolerates prefixes without crossing numbered units', () => {
  assert.equal(
    __testables.partnerVideoContactCoversClinic({ clinic_name: 'Grupo Sorria Garavelo' }, { name: 'Garavelo' }),
    true
  );
  assert.equal(
    __testables.partnerVideoContactCoversClinic({ clinic_name: 'Unidade Goiania 1' }, { name: 'Goiania I' }),
    true
  );
  assert.equal(
    __testables.partnerVideoContactCoversClinic({ clinic_name: 'Anapolis' }, { name: 'Anapolis 1' }),
    false
  );
});

test('daily coordinator delivery report includes phone, units and confirmed delivery status', () => {
  const now = new Date('2026-05-20T12:00:00.000Z');
  const period = __testables.buildDailyCoordinatorDeliveryReportPeriod(now);
  const message = __testables.buildDailyCoordinatorDeliveryReportMessage([
    {
      name: 'Ana Coordenadora',
      phone: '5562999999999',
      units: [{ name: 'Garavelo' }, { name: 'Santo Hilario' }],
      demandCount: 4,
      deliveryStatus: 'confirmed_delivered',
      deliveryLabel: 'CHEGOU / ENTREGUE',
      deliveryConfirmed: true
    },
    {
      name: 'Bruno Gerente',
      phone: '5562888888888',
      units: [{ name: 'Goiania 1' }],
      demandCount: 2,
      deliveryStatus: 'sent_unconfirmed',
      deliveryLabel: 'ENVIADA SEM CONFIRMACAO',
      deliveryConfirmed: false
    }
  ], { period, now });

  assert.match(message, /\[RELATORIO DIARIO - WHATSAPP COORDENADORES\]/);
  assert.match(message, /Chegada confirmada pelo WhatsApp: 1/);
  assert.match(message, /Ana Coordenadora/);
  assert.match(message, /Tel: 5562999999999/);
  assert.match(message, /Unidades: Garavelo, Santo Hilario/);
  assert.match(message, /CHEGOU \/ ENTREGUE/);
  assert.doesNotMatch(message, /[^\x09\x0A\x0D\x20-\x7E]/);
});

test('weekly admin complaint report is ASCII-safe and summarizes the closed week', () => {
  const now = new Date('2026-05-18T11:00:00.000Z');
  const period = __testables.buildWeeklyAdminComplaintReportPeriod(now);
  const message = __testables.buildWeeklyAdminComplaintReportWhatsAppMessage([
    {
      id: 1,
      protocol: 'GRC-2026-000001',
      patient_name: 'Maria',
      clinic_name: 'Garavelo',
      status: 'em_andamento',
      created_at: '2026-05-14T12:00:00.000Z',
      resolution_due_at: '2026-05-17T12:00:00.000Z',
      assigned_responsible_name: 'Ana Admin',
      has_treatment_log: 0
    },
    {
      id: 2,
      protocol: 'GRC-2026-000002',
      patient_name: 'Joao',
      clinic_name: 'Reclamacoes',
      status: 'resolvida',
      created_at: '2026-05-13T12:00:00.000Z',
      assigned_responsible_name: 'Carlos Admin',
      has_treatment_log: 1
    }
  ], { ...period, now });

  assert.match(message, /\[RELATORIO SEMANAL - RECLAMACOES\]/);
  assert.match(message, /Periodo: 11\/05\/2026 a 17\/05\/2026/);
  assert.match(message, /Reclamacoes cadastradas: 2/);
  assert.match(message, /Abertas\/em andamento: 1/);
  assert.match(message, /Finalizadas\/canceladas: 1/);
  assert.match(message, /Garavelo/);
  assert.match(message, /\/gestao\/relatorio-semanal/);
  assert.doesNotMatch(message, /[^\x09\x0A\x0D\x20-\x7E]/);
});

test('whatsapp-service webhook extracts received whatsapp-web.js message payloads', () => {
  const event = __testables.extractWhatsAppServiceEventMessage({
    event: 'message',
    sessionId: 'garavelo',
    message: {
      id: {
        _serialized: 'false_5562993005353@c.us_ABC',
        id: 'ABC',
        remote: '5562993005353@c.us',
        fromMe: false
      },
      from: '5562993005353@c.us',
      to: '5562996943245@c.us',
      body: 'Bom dia, quero confirmar meu atendimento.',
      type: 'chat',
      notifyName: 'Paciente Teste'
    }
  });

  assert.equal(event.sessionId, 'garavelo');
  assert.equal(event.phone, '5562993005353');
  assert.equal(event.fromMe, false);
  assert.equal(event.text, 'Bom dia, quero confirmar meu atendimento.');
  assert.equal(event.messageId, 'false_5562993005353@c.us_ABC');
  assert.equal(event.pushName, 'Paciente Teste');
});

test('whatsapp-service webhook extracts nested message and ack payloads', () => {
  const event = __testables.extractWhatsAppServiceEventMessage({
    event: 'message',
    sessionId: 'reclamacoes',
    data: {
      message: {
        id: { id: 'MSG-1', remote: '5562999669966@c.us', fromMe: false },
        from: '5562999669966@c.us',
        body: 'Recebido',
        type: 'chat'
      }
    }
  });
  const status = __testables.extractWhatsAppServiceStatusEvent({
    event: 'message_ack',
    sessionId: 'reclamacoes',
    message: {
      id: { id: 'MSG-1', remote: '5562999669966@c.us', fromMe: true },
      ack: 3
    }
  });

  assert.equal(event.sessionId, 'reclamacoes');
  assert.equal(event.phone, '5562999669966');
  assert.equal(event.text, 'Recebido');
  assert.equal(event.messageId, 'MSG-1');
  assert.equal(status.messageId, 'MSG-1');
  assert.equal(status.status, 'lida');
});

test('whatsapp-service webhook extracts shared contact vCard details', () => {
  const event = __testables.extractWhatsAppServiceEventMessage({
    event: 'message',
    sessionId: 'nps',
    data: {
      message: {
        id: { id: 'VCARD-1', remote: '5562999669966@c.us', fromMe: false },
        from: '5562999669966@c.us',
        type: 'vcard',
        contactMessage: {
          displayName: 'Maria Vcard',
          vcard: 'BEGIN:VCARD\\nVERSION:3.0\\nFN:Maria Vcard\\nTEL;type=CELL:+55 62 99111-2233\\nEND:VCARD'
        }
      }
    }
  });

  assert.equal(event.sessionId, 'nps');
  assert.equal(event.phone, '5562999669966');
  assert.equal(event.text, 'Contato compartilhado: Maria Vcard +5562991112233');
  assert.equal(event.contactName, 'Maria Vcard');
  assert.equal(event.contactPhone, '+5562991112233');
  assert.match(event.vcard, /BEGIN:VCARD/);
});

test('buildWelcomeMessage includes login and temporary password', () => {
  const message = buildWelcomeMessage({
    name: 'Carlos',
    email: 'carlos@example.com',
    temporaryPassword: 'Senha@123'
  });

  assert.match(message, /Carlos/);
  assert.match(message, /carlos@example.com/);
  assert.match(message, /Senha@123/);
});

test('renderPasswordResetEmail includes the direct password change link', () => {
  const template = renderPasswordResetEmail({
    name: 'Carlos',
    temporaryPassword: 'Senha@123',
    appUrl: 'https://meu-sistema-nps.vercel.app/perfil'
  });

  assert.equal(template.subject, 'Senha reiniciada - Sistema GRC');
  assert.match(template.html, /Carlos/);
  assert.match(template.html, /Senha@123/);
  assert.match(template.html, /https:\/\/meu-sistema-nps\.vercel\.app\/perfil/);
  assert.match(template.html, /troca obrigat/iu);
});

test('buildPasswordResetMessage includes temporary password and profile link', () => {
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://meu-sistema-nps.vercel.app/';

  const message = buildPasswordResetMessage({
    name: 'Carlos',
    temporaryPassword: 'Senha@123'
  });

  assert.equal(buildPasswordChangeUrl(), 'https://meu-sistema-nps.vercel.app/perfil');
  assert.match(message, /Carlos/);
  assert.match(message, /Senha@123/);
  assert.match(message, /https:\/\/meu-sistema-nps\.vercel\.app\/perfil/);
  assert.match(message, /troca obrigat/iu);

  process.env.APP_BASE_URL = previousAppBaseUrl;
});

test('buildAppointmentReminderMessage includes patient and appointment details', () => {
  const message = buildAppointmentReminderMessage({
    patientName: 'Ana',
    clinicName: 'Clinica Centro',
    typeLabel: 'Agendamento',
    scheduledLabel: '23/04/2026 14:00'
  });

  assert.match(message, /Ana/);
  assert.match(message, /Clinica Centro/);
  assert.match(message, /23\/04\/2026 14:00/);
});

test('canReceiveComplaintNotification respects complaint permissions and hierarchy', () => {
  assert.equal(__testables.canReceiveComplaintNotification({
    role: 'admin',
    email: 'admin@example.com',
    permissions: '[]'
  }), true);

  assert.equal(__testables.canReceiveComplaintNotification({
    role: 'viewer',
    email: 'viewer@example.com',
    permissions: JSON.stringify(['home', 'complaints_dashboard'])
  }), true);

  assert.equal(__testables.canReceiveComplaintNotification({
    role: 'viewer',
    email: 'viewer@example.com',
    permissions: JSON.stringify(['home', 'nps_management'])
  }), false);
});

test('canRenotifyComplaint only allows master admin, Supervisor do CRC and Operador de SAC', () => {
  assert.equal(__testables.canRenotifyComplaint({
    role: 'master_admin',
    email: 'henrique.martins@grcconsultoria.net.br'
  }), true);

  assert.equal(__testables.canRenotifyComplaint({
    role: 'supervisor_crc',
    email: 'supervisor@example.com'
  }), true);

  assert.equal(__testables.canRenotifyComplaint({
    role: 'sac_operator',
    email: 'sac@example.com'
  }), true);

  assert.equal(__testables.canRenotifyComplaint({
    role: 'admin',
    email: 'admin@example.com'
  }), false);

  assert.equal(__testables.canRenotifyComplaint({
    role: 'manager',
    email: 'manager@example.com'
  }), false);
});

test('coordinator return status flags targeted complaints without coordinator interaction', () => {
  const status = __testables.buildComplaintCoordinatorReturnStatus({
    assigned_coordinator_user_id: 77,
    assigned_coordinator_name: 'Coordenadora Unidade',
    forwarded_to_role: 'coordinator',
    coordinator_due_date: '2026-07-20 18:00:00'
  }, [], []);

  assert.equal(status.coordinator_targeted, true);
  assert.equal(status.coordinator_has_return, false);
  assert.equal(status.coordinator_pending_without_return, true);
});

test('coordinator return status ignores only registered clinic coordinator names', () => {
  const status = __testables.buildComplaintCoordinatorReturnStatus({
    stored_coordinator_name: 'Coordenadora Unidade',
    coordinator_name: 'Coordenadora Unidade',
    status: 'aberta'
  }, [], []);

  assert.equal(status.coordinator_targeted, false);
  assert.equal(status.coordinator_has_return, false);
  assert.equal(status.coordinator_pending_without_return, false);
});

test('coordinator return status clears when coordinator has interacted', () => {
  const baseComplaint = {
    assigned_coordinator_user_id: 77,
    forwarded_to_role: 'coordinator',
    coordinator_due_date: '2026-07-20 18:00:00'
  };

  assert.equal(__testables.buildComplaintCoordinatorReturnStatus(baseComplaint, [
    { actor_role: 'coordinator', action: 'treatment_saved' }
  ], []).coordinator_pending_without_return, false);

  assert.equal(__testables.buildComplaintCoordinatorReturnStatus(baseComplaint, [], [
    { uploaded_by_role: 'coordinator' }
  ]).coordinator_pending_without_return, false);

  assert.equal(__testables.buildComplaintCoordinatorReturnStatus({
    ...baseComplaint,
    coordinator_treated_at: '2026-07-21 10:00:00'
  }, [], []).coordinator_pending_without_return, false);
});

test('evidence permissions keep marketing limited to upload only', () => {
  assert.equal(__testables.canDeleteEvidence({
    role: 'master_admin',
    email: 'henrique.martins@grcconsultoria.net.br'
  }), true);

  assert.equal(__testables.canDeleteEvidence({
    role: 'supervisor_crc',
    email: 'supervisor@example.com'
  }), true);

  assert.equal(__testables.canDeleteEvidence({
    role: 'sac_operator',
    email: 'sac@example.com'
  }), true);

  assert.equal(__testables.canDeleteEvidence({
    role: 'admin',
    email: 'admin@example.com'
  }), true);

  assert.equal(__testables.canDeleteEvidence({
    role: 'coordinator',
    email: 'coordinator@example.com'
  }), true);

  assert.equal(__testables.canDeleteEvidence({
    role: 'viewer',
    email: 'viewer@example.com'
  }), false);

  assert.equal(__testables.canAttachEvidence({
    role: 'viewer',
    email: 'viewer@example.com'
  }), true);

  assert.equal(__testables.canDeleteEvidence(null), false);
});

test('complaint creator audit keeps user or public origin trail', () => {
  assert.deepEqual(__testables.buildComplaintCreatorAudit({
    id: 15,
    name: 'Operador Teste',
    role: 'sac_operator',
    email: 'operador@example.com'
  }, 'Interno'), {
    userId: 15,
    name: 'Operador Teste',
    role: 'sac_operator',
    email: 'operador@example.com'
  });

  assert.deepEqual(__testables.buildComplaintCreatorAudit(null, 'Marketing'), {
    userId: null,
    name: 'Link público Marketing',
    role: 'marketing_publico',
    email: null
  });

  assert.deepEqual(__testables.buildComplaintCreatorAudit(null, 'Externo'), {
    userId: null,
    name: 'Link público externo',
    role: 'externo',
    email: null
  });
});

test('canChangeComplaintUnit allows operational and marketing profiles', () => {
  assert.equal(__testables.canChangeComplaintUnit({
    role: 'master_admin',
    email: 'henrique.martins@grcconsultoria.net.br'
  }), true);

  assert.equal(__testables.canChangeComplaintUnit({
    role: 'admin',
    email: 'admin@example.com'
  }), false);

  assert.equal(__testables.canChangeComplaintUnit({
    role: 'supervisor_crc',
    email: 'supervisor@example.com'
  }), true);

  assert.equal(__testables.canChangeComplaintUnit({
    role: 'sac_operator',
    actionPermissions: [],
    email: 'sac@example.com'
  }), true);

  assert.equal(__testables.canChangeComplaintUnit({
    role: 'coordinator',
    email: 'coordinator@example.com'
  }), false);

  assert.equal(__testables.canChangeComplaintUnit({
    role: 'viewer',
    email: 'viewer@example.com'
  }), true);
});

test('SAC operator can edit complaint patient phone even without individual action permission', () => {
  assert.equal(__testables.canEditComplaintPatientPhone({
    role: 'sac_operator',
    actionPermissions: [],
    email: 'sac@example.com'
  }), true);

  assert.equal(__testables.canEditComplaintPatientPhone({
    role: 'coordinator',
    actionPermissions: ['complaints_edit_patient_phone'],
    email: 'coordinator@example.com'
  }), false);
});

test('SAC operator keeps operational ficha permissions even with empty saved permissions', () => {
  const sacUser = {
    role: 'sac_operator',
    actionPermissions: [],
    email: 'sac@example.com'
  };

  assert.equal(__testables.canAttachEvidence(sacUser), true);
  assert.equal(__testables.canDeleteEvidence(sacUser), true);
  assert.equal(__testables.canChangeComplaintUnit(sacUser), true);
  assert.equal(__testables.canEditComplaintPatientPhone(sacUser), true);
});

test('Coordinator and manager keep operational ficha permissions even with empty saved permissions', () => {
  const coordinatorUser = {
    role: 'coordenador_unidade',
    actionPermissions: [],
    email: 'coordenador@example.com'
  };
  const managerUser = {
    role: 'gerente_unidade',
    actionPermissions: [],
    email: 'gerente@example.com'
  };

  assert.equal(__testables.canAttachEvidence(coordinatorUser), true);
  assert.equal(__testables.canDeleteEvidence(coordinatorUser), true);
  assert.equal(__testables.canChangeComplaintUnit(coordinatorUser), false);
  assert.equal(__testables.canEditComplaintPatientPhone(coordinatorUser), false);

  assert.equal(__testables.canAttachEvidence(managerUser), true);
  assert.equal(__testables.canDeleteEvidence(managerUser), true);
  assert.equal(__testables.canChangeComplaintUnit(managerUser), false);
  assert.equal(__testables.canEditComplaintPatientPhone(managerUser), false);
});

test('Marketing can edit complaint unit and patient phone with the same operational rule as SAC', () => {
  assert.equal(__testables.canChangeComplaintUnit({
    role: 'viewer',
    actionPermissions: [],
    email: 'marketing@example.com'
  }), true);

  assert.equal(__testables.canEditComplaintPatientPhone({
    role: 'viewer',
    actionPermissions: [],
    email: 'marketing@example.com'
  }), true);
});

test('normalizeStoredUploadUrl rewrites localhost upload links to the current public API host', () => {
  const normalized = __testables.normalizeStoredUploadUrl('http://localhost:3001/uploads/teste-anexo.png');
  const normalizedRelative = __testables.normalizeStoredUploadUrl('uploads/teste-anexo.png');

  assert.match(normalized, /\/uploads\/teste-anexo\.png$/);
  assert.match(normalizedRelative, /\/uploads\/teste-anexo\.png$/);
});

test('decodeUploadedText preserves accents from UTF-8 and Windows-1252 uploads', () => {
  const utf8Csv = Buffer.from('Nome;Telefone / WhatsApp\nJoão Clínica;+5562999999999', 'utf8');
  const windows1252Csv = Buffer.from('Nome;Telefone / WhatsApp\nJoão Clínica Canaã;+5562999999999', 'latin1');
  const utf8NameDecodedAsLatin1 = Buffer.from('comprovante clínica final.pdf', 'utf8').toString('latin1');

  assert.match(__testables.decodeUploadedText(utf8Csv), /João Clínica/);
  assert.match(__testables.decodeUploadedText(windows1252Csv), /João Clínica Canaã/);
  assert.equal(
    __testables.normalizeUploadedOriginalName({ originalname: 'comprovante clÃ­nica.pdf' }),
    'comprovante clínica.pdf'
  );
  assert.equal(
    __testables.normalizeUploadedOriginalName({ originalname: utf8NameDecodedAsLatin1 }),
    'comprovante clínica final.pdf'
  );
  assert.equal(
    __testables.normalizeUploadedOriginalName({ originalname: 'pasta\\comprovante clínica.pdf' }),
    'pasta comprovante clínica.pdf'
  );
});
