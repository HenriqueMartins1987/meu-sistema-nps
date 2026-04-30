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
  assert.equal(getEmailFrom(), 'GRC Consultoria <contato@grcconsultoria.siteempresarial.com>');

  process.env.EMAIL_FROM = previousFrom;
  process.env.SMTP_FROM = previousSmtpFrom;
  process.env.SMTP_USER = previousSmtpUser;
});

test('getResendFromCandidates keeps the professional sender and configured fallback', () => {
  const previousFrom = process.env.EMAIL_FROM;
  const previousFallbackFrom = process.env.RESEND_FALLBACK_FROM;

  process.env.EMAIL_FROM = 'GRC Consultoria <contato@grcconsultoria.net.br>';
  process.env.RESEND_FALLBACK_FROM = 'GRC Consultoria <fallback@example.com>';

  assert.deepEqual(getResendFromCandidates(), [
    DEFAULT_EMAIL_FROM,
    'GRC Consultoria <fallback@example.com>',
    'GRC Consultoria <contato@grcconsultoria.net.br>'
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

test('canDeleteEvidence only allows master admin, Supervisor do CRC and Operador de SAC', () => {
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
  }), false);

  assert.equal(__testables.canDeleteEvidence({
    role: 'coordinator',
    email: 'coordinator@example.com'
  }), false);
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
