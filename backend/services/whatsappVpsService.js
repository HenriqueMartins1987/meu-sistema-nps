const axios = require('axios');

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getConfig(overrides = {}) {
  const baseURL = normalizeBaseUrl(overrides.baseURL || overrides.baseUrl || process.env.WHATSAPP_SERVICE_BASE_URL || 'http://2.24.101.6:3005');
  const apiKey = String(overrides.apiKey || overrides.api_key || process.env.WHATSAPP_SERVICE_API_KEY || '').trim();
  const missing = [];

  if (!baseURL) missing.push('WHATSAPP_SERVICE_BASE_URL');
  if (!apiKey) missing.push('WHATSAPP_SERVICE_API_KEY');

  return {
    baseURL,
    apiKey,
    baseUrlConfigured: Boolean(baseURL),
    apiKeyConfigured: Boolean(apiKey),
    configured: Boolean(baseURL && apiKey),
    missing
  };
}

function assertConfigured(overrides = {}) {
  const config = getConfig(overrides);
  if (!config.configured) {
    const missing = config.missing.length ? config.missing.join(' e ') : 'WHATSAPP_SERVICE_API_KEY';
    throw new Error(`Configuração whatsapp-service ausente: ${missing}.`);
  }
  return config;
}

function client(overrides = {}) {
  const config = assertConfigured(overrides);
  return axios.create({
    baseURL: config.baseURL,
    timeout: Number(overrides.timeout || process.env.WHATSAPP_SERVICE_TIMEOUT_MS || 25000),
    headers: {
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json'
    }
  });
}

function friendlyApiError(error) {
  return error.response?.data?.message
    || error.response?.data?.error
    || error.message
    || 'Falha de comunicação com o whatsapp-service.';
}

function getQrImageUrl(sessionId, overrides = {}) {
  const config = getConfig(overrides);
  return `${config.baseURL}/public/sessions/${encodeURIComponent(sessionId)}/qr-image`;
}

async function createSession(sessionId, payload = {}, config = {}) {
  const api = client(config);
  const body = { sessionId, ...payload };
  const attempts = [
    () => api.post('/sessions', body),
    () => api.post(`/sessions/${encodeURIComponent(sessionId)}/start`, payload),
    () => api.post(`/sessions/${encodeURIComponent(sessionId)}`, payload)
  ];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const response = await attempt();
      return response.data;
    } catch (error) {
      lastError = error;
      const status = Number(error.response?.status || 0);
      if (![404, 405].includes(status)) break;
    }
  }

  throw lastError;
}

async function getSessionStatus(sessionId, config = {}) {
  const response = await client(config).get(`/sessions/${encodeURIComponent(sessionId)}/status`);
  return response.data;
}

async function getQrImage(sessionId, config = {}) {
  const resolved = getConfig(config);
  const response = await axios.get(`${resolved.baseURL}/public/sessions/${encodeURIComponent(sessionId)}/qr-image`, {
    responseType: 'arraybuffer',
    timeout: Number(config.timeout || process.env.WHATSAPP_SERVICE_TIMEOUT_MS || 25000),
    headers: {
      Accept: 'image/png,image/jpeg,image/webp,*/*',
      ...(resolved.apiKey ? { 'x-api-key': resolved.apiKey } : {})
    }
  });

  return {
    contentType: response.headers['content-type'] || 'image/png',
    bytes: Buffer.from(response.data)
  };
}

async function sendMessage({ sessionId, number, message }, config = {}) {
  const response = await client(config).post('/messages/send', {
    sessionId,
    number,
    message
  });
  return response.data;
}

module.exports = {
  createSession,
  friendlyApiError,
  getConfig,
  getQrImage,
  getQrImageUrl,
  getSessionStatus,
  sendMessage
};
