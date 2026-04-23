const test = require('node:test');
const assert = require('node:assert/strict');

const { generateTemporaryPassword } = require('../utils/password');
const {
  DEFAULT_EMAIL_FROM,
  getEmailFrom,
  getEmailProvider,
  renderUserAccessEmail
} = require('../services/emailService');
const {
  buildAppointmentReminderMessage,
  buildWelcomeMessage,
  normalizeWhatsAppPhone
} = require('../services/whatsappService');

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

  delete process.env.EMAIL_FROM;
  assert.equal(getEmailFrom(), DEFAULT_EMAIL_FROM);

  process.env.EMAIL_FROM = 'GRC Consultoria <contato@grcconsultoria.net.br>';
  assert.equal(getEmailFrom(), 'GRC Consultoria <contato@grcconsultoria.net.br>');

  process.env.EMAIL_FROM = previousFrom;
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
