const whatsappVpsService = require('./whatsappVpsService');

function getProviderMessageId(response = {}) {
  return response?.messageId
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
  return whatsappVpsService.createSession(sessionId, payload);
}

async function getSessionStatus(sessionId) {
  return whatsappVpsService.getSessionStatus(sessionId);
}

async function getQrImage(sessionId, config = {}) {
  return whatsappVpsService.getQrImage(sessionId, config);
}

async function waitForQrImage(sessionId, config = {}) {
  return whatsappVpsService.waitForQrImage(sessionId, config);
}

async function disconnectSession(sessionId) {
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
  startSession,
  waitForQrImage
};
