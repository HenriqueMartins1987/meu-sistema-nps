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
const { __testables } = require('../server');

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
