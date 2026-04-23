const fs = require('fs');
const path = require('path');
const axios = require('axios');

const logsDir = path.join(__dirname, '..', 'logs');
const logFilePath = path.join(logsDir, 'whatsapp.log');
const metaApiVersion = process.env.WHATSAPP_META_VERSION || 'v20.0';

fs.mkdirSync(logsDir, { recursive: true });

function getWhatsAppProvider() {
  const configuredProvider = String(process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase();

  if (configuredProvider) return configuredProvider;
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) return 'meta';
  if (process.env.WHATSAPP_WEBHOOK_URL) return 'webhook';
  return 'log';
}

function isWhatsAppEnabled() {
  return String(process.env.WHATSAPP_ENABLED || 'false').trim().toLowerCase() === 'true';
}

function normalizeWhatsAppPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');

  if (!digits) return '';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return '';
}

function sanitizeText(value, limit = 4096) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendLog(entry) {
  const serialized = JSON.stringify({
    at: new Date().toISOString(),
    ...entry
  });

  await fs.promises.appendFile(logFilePath, `${serialized}\n`, 'utf8');
}

async function sendViaMeta({ to, message, event, metadata }) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      success: false,
      error: 'Meta WhatsApp Cloud API não configurada.'
    };
  }

  const endpoint = `https://graph.facebook.com/${metaApiVersion}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      body: sanitizeText(message)
    }
  };

  let lastError = 'Falha desconhecida no envio via Meta Cloud API.';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.post(endpoint, payload, {
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      await appendLog({
        event,
        provider: 'meta',
        to,
        status: 'sent',
        attempt,
        providerMessageId: response.data?.messages?.[0]?.id || null,
        metadata,
        response: response.data
      });

      return {
        success: true,
        provider: 'meta',
        to,
        providerMessageId: response.data?.messages?.[0]?.id || null,
        raw: response.data
      };
    } catch (error) {
      lastError = error.response?.data?.error?.message || error.message || lastError;

      await appendLog({
        event,
        provider: 'meta',
        to,
        status: 'retry',
        attempt,
        metadata,
        error: lastError,
        response: error.response?.data || null
      });

      if (attempt < 3) {
        await sleep(attempt * 500);
      }
    }
  }

  return {
    success: false,
    provider: 'meta',
    to,
    error: lastError
  };
}

async function sendViaWebhook({ to, message, event, metadata }) {
  const webhookUrl = String(process.env.WHATSAPP_WEBHOOK_URL || '').trim();

  if (!webhookUrl) {
    return {
      success: false,
      error: 'Webhook de WhatsApp não configurado.'
    };
  }

  try {
    const response = await axios.post(webhookUrl, {
      to,
      event,
      message: sanitizeText(message),
      groupId: process.env.WHATSAPP_GROUP_ID || undefined,
      metadata
    }, {
      timeout: 8000
    });

    await appendLog({
      event,
      provider: 'webhook',
      to,
      status: 'sent',
      metadata,
      response: response.data
    });

    return {
      success: true,
      provider: 'webhook',
      to,
      providerMessageId: response.data?.id || null,
      raw: response.data
    };
  } catch (error) {
    const lastError = error.response?.data?.error || error.message || 'Falha ao enviar via webhook.';

    await appendLog({
      event,
      provider: 'webhook',
      to,
      status: 'failed',
      metadata,
      error: lastError,
      response: error.response?.data || null
    });

    return {
      success: false,
      provider: 'webhook',
      to,
      error: lastError
    };
  }
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
      to: normalizedPhone,
      error: 'WhatsApp desabilitado.'
    };
  }

  const provider = getWhatsAppProvider();

  if (provider === 'meta') {
    return sendViaMeta({ to: normalizedPhone, message, event, metadata });
  }

  if (provider === 'webhook') {
    return sendViaWebhook({ to: normalizedPhone, message, event, metadata });
  }

  await appendLog({
    event,
    provider: 'log',
    to: normalizedPhone,
    status: 'skipped',
    metadata,
    error: 'Nenhum provedor de WhatsApp configurado.'
  });

  return {
    success: false,
    skipped: true,
    to: normalizedPhone,
    error: 'Nenhum provedor de WhatsApp configurado.'
  };
}

function buildSystemUrl() {
  return process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://meu-sistema-nps.vercel.app/';
}

function buildWelcomeMessage(user) {
  return [
    `Olá ${user.name || 'colaborador'}, seu acesso foi criado com sucesso.`,
    '',
    `Login: ${user.email}`,
    `Senha inicial: ${user.temporaryPassword || 'Não informada'}`,
    '',
    'Acesse:',
    buildSystemUrl(),
    'No primeiro acesso altere sua senha.'
  ].join('\n');
}

function buildApprovalMessage(user) {
  return [
    `Olá ${user.name || 'colaborador'}, seu cadastro foi aprovado e seu acesso está liberado.`,
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
  buildWelcomeMessage,
  getWhatsAppProvider,
  isWhatsAppEnabled,
  logFilePath,
  normalizeWhatsAppPhone,
  sendApprovalWhatsApp,
  sendAppointmentReminder,
  sendNoShowAlert,
  sendWelcomeWhatsApp,
  sendWhatsAppMessage
};
