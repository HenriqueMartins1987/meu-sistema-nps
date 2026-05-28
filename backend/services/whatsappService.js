const fs = require('fs');
const path = require('path');
const {
  sendGenericNotification,
  normalizePhoneNumber: normalizeTwilioPhoneNumber
} = require('./twilioWhatsAppService');

const logsDir = path.join(__dirname, '..', 'logs');
const logFilePath = path.join(logsDir, 'whatsapp.log');

fs.mkdirSync(logsDir, { recursive: true });

function getWhatsAppProvider() {
  return 'twilio';
}

function isWhatsAppEnabled() {
  return String(process.env.WHATSAPP_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function normalizeWhatsAppPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');

  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return '';
}

async function appendLog(entry) {
  const serialized = JSON.stringify({
    at: new Date().toISOString(),
    ...entry
  });

  await fs.promises.appendFile(logFilePath, `${serialized}\n`, 'utf8');
}

async function sendWhatsAppMessage(to, message, metadata = {}) {
  const normalizedPhone = normalizeWhatsAppPhone(to);
  const event = metadata.event || 'generic_notification';

  if (!normalizedPhone) {
    await appendLog({
      event,
      provider: getWhatsAppProvider(),
      to: String(to || ''),
      status: 'failed',
      metadata,
      error: 'Telefone em padrão E.164 inválido.'
    });

    return {
      success: false,
      provider: 'twilio',
      error: 'Telefone em padrão E.164 inválido.'
    };
  }

  if (!isWhatsAppEnabled()) {
    await appendLog({
      event,
      provider: getWhatsAppProvider(),
      to: normalizedPhone,
      status: 'skipped',
      metadata,
      error: 'WhatsApp desabilitado por configuração.'
    });

    return {
      success: false,
      skipped: true,
      provider: 'twilio',
      to: normalizedPhone,
      error: 'WhatsApp desabilitado.'
    };
  }

  // Integração oficial única: todo envio geral passa por template Twilio.
  // Para alterar templates, configure TWILIO_TEMPLATE_TESTE_SID ou TWILIO_TEMPLATE_GENERIC_SID.
  const result = await sendGenericNotification({
    to: normalizeTwilioPhoneNumber(normalizedPhone) || normalizedPhone,
    message,
    eventType: event,
    protocol: metadata.protocol || '',
    verifyFinalStatus: Boolean(metadata.verifyFinalStatus)
  });

  await appendLog({
    event,
    provider: 'twilio',
    to: normalizedPhone,
    status: result?.success ? 'sent' : result?.skipped ? 'skipped' : 'failed',
    metadata,
    providerMessageId: result?.providerMessageId || result?.twilioSid || null,
    error: result?.success ? null : result?.error || null,
    response: result?.raw || null
  });

  return {
    ...result,
    provider: 'twilio',
    to: normalizedPhone,
    providerMessageId: result?.providerMessageId || result?.twilioSid || null
  };
}

function buildSystemUrl() {
  return process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://meu-sistema-nps.vercel.app/';
}

function buildPasswordChangeUrl() {
  const baseUrl = buildSystemUrl().replace(/\/+$/, '');
  return `${baseUrl}/perfil`;
}

function buildWelcomeMessage(user) {
  return [
    `Olá ${user.name || 'parceiro'}, seu acesso foi criado com sucesso.`,
    '',
    `Login: ${user.email}`,
    `Senha inicial: ${user.temporaryPassword || 'Não informada'}`,
    '',
    'Acesse:',
    buildSystemUrl(),
    'No primeiro acesso altere sua senha.'
  ].join('\n');
}

function buildPasswordResetMessage(user) {
  return [
    `Olá ${user.name || 'parceiro'}, sua senha foi reiniciada.`,
    '',
    `Senha temporária: ${user.temporaryPassword || 'Não informada'}`,
    '',
    'Link para alterar a senha:',
    buildPasswordChangeUrl(),
    'Entre com a senha temporária. O sistema abrirá a troca obrigatória automaticamente.'
  ].join('\n');
}

function buildApprovalMessage(user) {
  return [
    `Olá ${user.name || 'parceiro'}, seu cadastro foi aprovado e seu acesso está liberado.`,
    '',
    'Acesse:',
    buildSystemUrl()
  ].join('\n');
}

function buildAppointmentReminderMessage(patient) {
  return [
    `Olá ${patient.patientName || patient.patient || 'paciente'}, este é um lembrete da sua próxima consulta.`,
    '',
    `Tipo: ${patient.typeLabel || patient.type || 'Atendimento'}`,
    `Unidade: ${patient.clinicName || patient.clinic || 'Não informada'}`,
    `Data e horário: ${patient.scheduledLabel || patient.scheduledAt || 'Não informado'}`
  ].join('\n');
}

function buildNoShowAlertMessage(patient) {
  return [
    'Alerta interno de não comparecimento.',
    '',
    `Paciente: ${patient.patientName || patient.patient || 'Não informado'}`,
    `Unidade: ${patient.clinicName || patient.clinic || 'Não informada'}`,
    `Data e horário: ${patient.scheduledLabel || patient.scheduledAt || 'Não informado'}`,
    `Protocolo: ${patient.protocol || 'Não informado'}`
  ].join('\n');
}

async function sendWelcomeWhatsApp(user) {
  return sendWhatsAppMessage(user.whatsapp || user.phone, buildWelcomeMessage(user), {
    event: 'user_welcome',
    userId: user.id,
    email: user.email
  });
}

async function sendPasswordResetWhatsApp(user) {
  return sendWhatsAppMessage(user.whatsapp || user.phone, buildPasswordResetMessage(user), {
    event: 'password_reset',
    userId: user.id,
    email: user.email,
    link: buildPasswordChangeUrl()
  });
}

async function sendApprovalWhatsApp(user) {
  return sendWhatsAppMessage(user.whatsapp || user.phone, buildApprovalMessage(user), {
    event: 'registration_approved',
    userId: user.id,
    email: user.email
  });
}

async function sendAppointmentReminder(patient) {
  return sendWhatsAppMessage(patient.phone, buildAppointmentReminderMessage(patient), {
    event: 'appointment_reminder',
    appointmentId: patient.id,
    protocol: patient.protocol
  });
}

async function sendNoShowAlert(patient) {
  return sendWhatsAppMessage(patient.phone, buildNoShowAlertMessage(patient), {
    event: 'patient_no_show',
    appointmentId: patient.id,
    protocol: patient.protocol
  });
}

module.exports = {
  buildAppointmentReminderMessage,
  buildNoShowAlertMessage,
  buildPasswordChangeUrl,
  buildPasswordResetMessage,
  buildWelcomeMessage,
  getWhatsAppProvider,
  isWhatsAppEnabled,
  logFilePath,
  normalizeWhatsAppPhone,
  sendApprovalWhatsApp,
  sendAppointmentReminder,
  sendNoShowAlert,
  sendPasswordResetWhatsApp,
  sendWelcomeWhatsApp,
  sendWhatsAppMessage
};
