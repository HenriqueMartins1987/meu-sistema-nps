const axios = require('axios');

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getConfig(overrides = {}) {
  const baseURL = normalizeBaseUrl(overrides.baseURL || overrides.baseUrl || process.env.EVOLUTION_BASE_URL);
  const apiKey = String(overrides.apiKey || overrides.api_key || process.env.EVOLUTION_API_KEY || '').trim();
  const missing = [];

  if (!baseURL) missing.push('EVOLUTION_BASE_URL');
  if (!apiKey) missing.push('EVOLUTION_API_KEY');

  return {
    baseURL,
    apiKey,
    baseUrlConfigured: Boolean(baseURL),
    apiKeyConfigured: Boolean(apiKey),
    configured: Boolean(baseURL && apiKey),
    missing
  };
}

function friendlyApiError(error) {
  return error.response?.data?.message
    || error.response?.data?.error
    || error.message
    || 'Falha de comunicacao com a Evolution API.';
}

function assertConfigured(overrides = {}) {
  const config = getConfig(overrides);
  if (!config.configured) {
    const missing = config.missing.length ? config.missing.join(' e ') : 'EVOLUTION_BASE_URL e EVOLUTION_API_KEY';
    throw new Error(`Configuracao Evolution API ausente: ${missing}.`);
  }
  return config;
}

function client(overrides = {}) {
  const config = assertConfigured(overrides);
  return axios.create({
    baseURL: config.baseURL,
    timeout: Number(overrides.timeout || process.env.EVOLUTION_TIMEOUT_MS || 30000),
    headers: {
      apikey: config.apiKey,
      'Content-Type': 'application/json'
    }
  });
}

async function withRetry(operation, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 2));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = error.code === 'ECONNABORTED'
        || error.code === 'ECONNRESET'
        || error.code === 'ETIMEDOUT'
        || Number(error.response?.status || 0) >= 500;

      if (!retryable || attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, Number(options.retryDelayMs || 900) * attempt));
    }
  }

  throw lastError;
}

async function createInstance(payload = {}) {
  // Configure EVOLUTION_BASE_URL and EVOLUTION_API_KEY in Render or in the master WhatsApp settings.
  // Optional: EVOLUTION_WEBHOOK_URL can override the backend webhook URL passed by server.js.
  const webhook = payload.webhookUrl
    ? {
        url: payload.webhookUrl,
        byEvents: true,
        base64: true,
        headers: {
          'Content-Type': 'application/json',
          ...(payload.webhookToken ? { authorization: `Bearer ${payload.webhookToken}` } : {})
        },
        events: [
          'QRCODE_UPDATED',
          'CONNECTION_UPDATE',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'SEND_MESSAGE'
        ]
      }
    : undefined;

  const response = await withRetry(
    () => client(payload.config).post('/instance/create', {
      instanceName: payload.instanceName,
      integration: payload.integration || 'WHATSAPP-BAILEYS',
      qrcode: payload.qrcode !== false,
      number: payload.number || undefined,
      webhook,
      rejectCall: true,
      msgCall: payload.msgCall || 'No momento nao recebemos chamadas por este canal. Envie uma mensagem por texto.',
      groupsIgnore: true,
      alwaysOnline: true,
      readMessages: true,
      readStatus: true,
      syncFullHistory: false
    }),
    payload.retryOptions
  );
  return response.data;
}

async function connectInstance(instanceName, number = '', config = {}) {
  const response = await withRetry(() => client(config).get(`/instance/connect/${encodeURIComponent(instanceName)}`, {
    params: number ? { number } : undefined
  }));
  return response.data;
}

async function getConnectionState(instanceName, config = {}) {
  const response = await withRetry(() => client(config).get(`/instance/connectionState/${encodeURIComponent(instanceName)}`));
  return response.data;
}

async function restartInstance(instanceName, config = {}) {
  const response = await withRetry(() => client(config).put(`/instance/restart/${encodeURIComponent(instanceName)}`));
  return response.data;
}

async function sendText(instanceName, number, text, options = {}) {
  const response = await withRetry(() => client(options.config).post(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    number,
    textMessage: { text },
    options: {
      delay: options.delay || 800,
      presence: options.presence || 'composing',
      linkPreview: options.linkPreview !== false
    }
  }), options.retryOptions);
  return response.data;
}

async function deleteMessage(instanceName, payload = {}, config = {}) {
  const response = await withRetry(() => client(config).delete(`/message/delete/${encodeURIComponent(instanceName)}`, {
    data: payload
  }));
  return response.data;
}

async function logoutInstance(instanceName, config = {}) {
  const response = await withRetry(() => client(config).delete(`/instance/logout/${encodeURIComponent(instanceName)}`));
  return response.data;
}

async function deleteInstance(instanceName, config = {}) {
  const response = await withRetry(() => client(config).delete(`/instance/delete/${encodeURIComponent(instanceName)}`));
  return response.data;
}

async function fetchInstances(config = {}) {
  const response = await withRetry(() => client(config).get('/instance/fetchInstances'));
  return response.data;
}

async function diagnostic(config = {}) {
  const resolved = getConfig(config);
  if (!resolved.configured) {
    return {
      configured: false,
      baseUrlConfigured: resolved.baseUrlConfigured,
      apiKeyConfigured: resolved.apiKeyConfigured,
      missing: resolved.missing,
      evolutionReachable: false,
      message: 'Configuracao Evolution API ausente.'
    };
  }

  const startedAt = Date.now();
  try {
    const instances = await fetchInstances(resolved);
    const instanceList = Array.isArray(instances)
      ? instances
      : Array.isArray(instances?.instances)
        ? instances.instances
        : [];

    return {
      configured: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      missing: [],
      evolutionReachable: true,
      responseTimeMs: Date.now() - startedAt,
      instanceCount: instanceList.length,
      version: instances?.version || instances?.data?.version || null,
      uptime: instances?.uptime || instances?.data?.uptime || null,
      message: 'Evolution API acessivel.'
    };
  } catch (error) {
    return {
      configured: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      missing: [],
      evolutionReachable: false,
      responseTimeMs: Date.now() - startedAt,
      message: friendlyApiError(error)
    };
  }
}

module.exports = {
  createInstance,
  connectInstance,
  deleteInstance,
  deleteMessage,
  diagnostic,
  fetchInstances,
  friendlyApiError,
  getConfig,
  getConnectionState,
  logoutInstance,
  restartInstance,
  sendText
};
