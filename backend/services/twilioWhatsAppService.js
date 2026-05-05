const axios = require('axios');

const TWILIO_MESSAGES_API_VERSION = '2010-04-01';
const DEFAULT_TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';

function getTwilioConfig() {
  return {
    accountSid: String(process.env.TWILIO_ACCOUNT_SID || '').trim(),
    authToken: String(process.env.TWILIO_AUTH_TOKEN || '').trim(),
    from: String(process.env.TWILIO_WHATSAPP_FROM || DEFAULT_TWILIO_WHATSAPP_FROM).trim(),
    complaintTemplateSid: String(process.env.TWILIO_TEMPLATE_DEMANDA_SID || '').trim(),
    npsTemplateSid: String(process.env.TWILIO_TEMPLATE_NPS_SID || '').trim(),
    genericTemplateSid: String(process.env.TWILIO_TEMPLATE_GENERIC_SID || '').trim(),
    testTemplateSid: String(process.env.TWILIO_TEMPLATE_TESTE_SID || '').trim()
  };
}

function getTwilioConfigStatus() {
  const config = getTwilioConfig();

  return {
    accountSidConfigured: Boolean(config.accountSid),
    authTokenConfigured: Boolean(config.authToken),
    fromConfigured: Boolean(config.from),
    from: config.from || '',
    complaintTemplateConfigured: Boolean(config.complaintTemplateSid),
    npsTemplateConfigured: Boolean(config.npsTemplateSid),
    genericTemplateConfigured: Boolean(config.genericTemplateSid),
    testTemplateConfigured: Boolean(config.testTemplateSid)
  };
}

function normalizePhoneNumber(phone) {
  const rawValue = String(phone || '').trim();
  const digits = rawValue.replace(/^whatsapp:/i, '').replace(/\D/g, '');

  if (!digits) return '';

  let normalizedDigits = digits;

  if (!normalizedDigits.startsWith('55')) {
    if (normalizedDigits.length === 10 || normalizedDigits.length === 11) {
      normalizedDigits = `55${normalizedDigits}`;
    } else {
      return '';
    }
  }

  if (!/^55\d{10,11}$/.test(normalizedDigits)) {
    return '';
  }

  return `whatsapp:+${normalizedDigits}`;
}

function getMissingConfigKeys(config, templateSid, templateLabel = 'TWILIO_TEMPLATE_DEMANDA_SID ou TWILIO_TEMPLATE_NPS_SID') {
  const missing = [];

  if (!config.accountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!config.authToken) missing.push('TWILIO_AUTH_TOKEN');
  if (!config.from) missing.push('TWILIO_WHATSAPP_FROM');
  if (!templateSid) missing.push(templateLabel);

  return missing;
}

function buildProtocolTemplateVariables(protocol) {
  const protocolVariableKey = String(process.env.TWILIO_TEMPLATE_PROTOCOL_VARIABLE || 'protocolo').trim() || 'protocolo';

  // Altere TWILIO_TEMPLATE_PROTOCOL_VARIABLE para "1" se o template da Twilio usar {{1}}
  // em vez de {{protocolo}}.
  return {
    [protocolVariableKey]: String(protocol || '')
  };
}

function buildMessageTemplateVariables(message) {
  const messageVariableKey = String(process.env.TWILIO_TEMPLATE_MESSAGE_VARIABLE || 'mensagem').trim() || 'mensagem';

  // Para mensagens simples, configure o template Twilio com a variavel {{mensagem}}
  // ou ajuste TWILIO_TEMPLATE_MESSAGE_VARIABLE para o nome/indice usado no Content Template.
  return {
    [messageVariableKey]: String(message || '')
  };
}

function resolveGenericTemplate(eventType) {
  const config = getTwilioConfig();
  const normalizedEvent = String(eventType || '').trim().toLowerCase();

  if (normalizedEvent === 'manual_test') {
    return {
      templateSid: config.testTemplateSid || config.genericTemplateSid,
      templateLabel: 'TWILIO_TEMPLATE_TESTE_SID ou TWILIO_TEMPLATE_GENERIC_SID'
    };
  }

  return {
    templateSid: config.genericTemplateSid,
    templateLabel: 'TWILIO_TEMPLATE_GENERIC_SID'
  };
}

async function sendTemplateMessage({
  to,
  templateSid,
  variables = {},
  eventType = 'TEMPLATE_NOTIFICATION',
  protocol = '',
  templateLabel
}) {
  const config = getTwilioConfig();
  const normalizedTo = normalizePhoneNumber(to);

  if (!normalizedTo) {
    return {
      success: false,
      skipped: true,
      to: String(to || ''),
      error: 'Telefone vazio ou invalido para WhatsApp Twilio.'
    };
  }

  const missing = getMissingConfigKeys(config, templateSid, templateLabel);

  if (missing.length) {
    return {
      success: false,
      skipped: true,
      to: normalizedTo,
      error: `Configuracao Twilio ausente: ${missing.join(', ')}.`
    };
  }

  const endpoint = `https://api.twilio.com/${TWILIO_MESSAGES_API_VERSION}/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    From: config.from,
    To: normalizedTo,
    ContentSid: templateSid,
    ContentVariables: JSON.stringify(variables || {})
  });

  try {
    const response = await axios.post(endpoint, body, {
      timeout: 15000,
      auth: {
        username: config.accountSid,
        password: config.authToken
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const errorMessage = response.data?.message
        || response.data?.error_message
        || response.data?.detail
        || `Twilio retornou HTTP ${response.status}.`;

      return {
        success: false,
        provider: 'twilio',
        to: normalizedTo,
        statusCode: response.status,
        error: errorMessage,
        raw: response.data || null
      };
    }

    return {
      success: true,
      provider: 'twilio',
      to: normalizedTo,
      eventType,
      protocol,
      providerMessageId: response.data?.sid || null,
      twilioSid: response.data?.sid || null,
      raw: response.data || null
    };
  } catch (error) {
    return {
      success: false,
      provider: 'twilio',
      to: normalizedTo,
      error: error.response?.data?.message || error.message || 'Falha desconhecida ao enviar WhatsApp pela Twilio.',
      raw: error.response?.data || null
    };
  }
}

async function sendGenericNotification({ to, message, eventType = 'GENERIC_NOTIFICATION', protocol = '' }) {
  const { templateSid, templateLabel } = resolveGenericTemplate(eventType);

  // Mensagens gerais e testes manuais usam exclusivamente template Twilio.
  // Altere TWILIO_TEMPLATE_TESTE_SID para o teste "Envio de mensagem teste" e
  // TWILIO_TEMPLATE_GENERIC_SID para mensagens operacionais com a variavel {{mensagem}}.
  return sendTemplateMessage({
    to,
    templateSid,
    templateLabel,
    variables: buildMessageTemplateVariables(message),
    eventType,
    protocol
  });
}

async function sendComplaintNotification({ to, protocol }) {
  const config = getTwilioConfig();

  // RECLAMACAO: altere o template em TWILIO_TEMPLATE_DEMANDA_SID no Render/ambiente.
  // Este template deve conter a variavel de protocolo configurada em buildProtocolTemplateVariables.
  return sendTemplateMessage({
    to,
    templateSid: config.complaintTemplateSid,
    variables: buildProtocolTemplateVariables(protocol),
    eventType: 'COMPLAINT_CREATED',
    protocol
  });
}

async function sendNpsNotification({ to, protocol }) {
  const config = getTwilioConfig();

  // NPS: altere o template em TWILIO_TEMPLATE_NPS_SID no Render/ambiente.
  // Diferente da reclamacao, o NPS e enviado somente para administradores e Supervisor CRC.
  return sendTemplateMessage({
    to,
    templateSid: config.npsTemplateSid,
    variables: buildProtocolTemplateVariables(protocol),
    eventType: 'NPS_CREATED',
    protocol
  });
}

module.exports = {
  sendComplaintNotification,
  sendGenericNotification,
  sendNpsNotification,
  getTwilioConfigStatus,
  sendTemplateMessage,
  normalizePhoneNumber
};
