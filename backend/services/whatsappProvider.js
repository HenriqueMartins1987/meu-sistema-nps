const whatsappVpsService = require('./whatsappVpsService');
const { sendGenericNotification } = require('./twilioWhatsAppService');

function normalizeProviderName(value) {
  return String(value || '').trim().toLowerCase();
}

function getNpsSessionId() {
  return String(process.env.NPS_WHATSAPP_SESSION_ID || process.env.WHATSAPP_NPS_INSTANCE_NAME || 'nps').trim() || 'nps';
}

function shouldUseTwilio(sessionId) {
  const globalProvider = normalizeProviderName(process.env.WHATSAPP_PROVIDER || process.env.WHATSAPP_SYSTEM_NOTIFICATIONS_PROVIDER);
  if (globalProvider === 'twilio') return true;

  const npsProvider = normalizeProviderName(process.env.NPS_MESSAGING_PROVIDER);
  const normalizedSessionId = String(sessionId || '').trim();

  return npsProvider === 'twilio' && normalizedSessionId === getNpsSessionId();
}

function getProviderMessageId(response = {}) {
  return response?.providerMessageId
    || response?.twilioSid
    || response?.messageId
    || response?.id
    || response?.data?.id
    || response?.data?.messageId
    || response?.key?.id
    || response?.message?.id
    || response?.message?.key?.id
    || response?.result?.id
    || null;
}

async function sendText({ sessionId, number, message, idempotencyKey, clientRequestId }) {
  if (shouldUseTwilio(sessionId)) {
    const result = await sendGenericNotification({
      to: number,
      message,
      eventType: 'nps_invite',
      protocol: idempotencyKey || clientRequestId || '',
      verifyFinalStatus: true
    });

    return {
      provider: 'twilio',
      success: Boolean(result?.success),
      messageId: getProviderMessageId(result),
      resolvedNumber: number,
      attemptedNumbers: [number],
      error: result?.success ? null : result?.error || null,
      raw: result
    };
  }

  const response = await whatsappVpsService.sendMessage({ sessionId, number, message, idempotencyKey, clientRequestId });
  return {
    provider: 'whatsapp_service',
    success: true,
    messageId: getProviderMessageId(response),
    resolvedNumber: response.resolvedNumber || number,
    attemptedNumbers: response.attemptedNumbers || [number],
    raw: response
  };
}

async function startSession(sessionId, payload = {}) {
  if (shouldUseTwilio(sessionId)) {
    return {
      success: true,
      provider: 'twilio',
      sessionId,
      status: 'connected',
      officialApi: true,
      qrRequired: false
    };
  }

  return whatsappVpsService.createSession(sessionId, payload);
}

async function getSessionStatus(sessionId) {
  if (shouldUseTwilio(sessionId)) {
    return {
      provider: 'twilio',
      sessionId,
      status: 'connected',
      officialApi: true,
      qrRequired: false
    };
  }

  return whatsappVpsService.getSessionStatus(sessionId);
}

async function getQrImage(sessionId, config = {}) {
  return whatsappVpsService.getQrImage(sessionId, config);
}

async function waitForQrImage(sessionId, config = {}) {
  return whatsappVpsService.waitForQrImage(sessionId, config);
}

async function disconnectSession(sessionId) {
  if (shouldUseTwilio(sessionId)) {
    return {
      success: true,
      provider: 'twilio',
      sessionId,
      status: 'connected',
      officialApi: true,
      qrRequired: false
    };
  }

  return whatsappVpsService.disconnectSession(sessionId);
}

async function diagnostic(config = {}) {
  return whatsappVpsService.diagnostic(config);
}

function getQrImageUrl(sessionId, config = {}) {
  return whatsappVpsService.getQrImageUrl(sessionId, config);
}

function getConfig(config = {}) {
  return whatsappVpsService.getConfig(config);
}

function friendlyApiError(error) {
  return whatsappVpsService.friendlyApiError(error);
}

module.exports = {
  createSession: startSession,
  diagnostic,
  disconnectSession,
  friendlyApiError,
  getConfig,
  getProviderMessageId,
  getQrImage,
  getQrImageUrl,
  getSessionStatus,
  sendMessage: sendText,
  sendText,
  shouldUseTwilio,
  startSession,
  waitForQrImage
};
