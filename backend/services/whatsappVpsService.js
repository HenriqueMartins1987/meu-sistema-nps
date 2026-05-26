const axios = require('axios');

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getConfig(overrides = {}) {
  const baseURL = normalizeBaseUrl(overrides.baseURL || overrides.baseUrl || process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || 'http://2.24.101.6:3005');
  // Fallback operacional da VPS atual. Preferir sempre WHATSAPP_API_KEY/WHATSAPP_SERVICE_API_KEY no Render.
  const isAutomatedTest = process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';
  const defaultApiKey = String(process.env.WHATSAPP_SERVICE_DEFAULT_API_KEY || (isAutomatedTest ? '' : 'senha_teste_123')).trim();
  const apiKey = String(overrides.apiKey || overrides.api_key || process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_SERVICE_API_KEY || defaultApiKey || '').trim();
  const missing = [];

  if (!baseURL) missing.push('WHATSAPP_API_URL');
  if (!apiKey) missing.push('WHATSAPP_API_KEY');

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
    const missing = config.missing.length ? config.missing.join(' e ') : 'WHATSAPP_API_KEY';
    throw new Error(`Configuração whatsapp-service ausente: ${missing}.`);
  }
  return config;
}

function client(overrides = {}) {
  const config = assertConfigured(overrides);
  return axios.create({
    baseURL: config.baseURL,
    timeout: Number(overrides.timeout || process.env.WHATSAPP_SERVICE_TIMEOUT_MS || 25000),
    proxy: false,
    headers: {
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json'
    }
  });
}

function rawApiErrorMessage(error) {
  return error.response?.data?.message
    || error.response?.data?.error
    || error.message
    || 'Falha de comunicação com o whatsapp-service.';
}

function isWhatsAppCommsNotReadyMessage(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('sendiq called before startcomms')
    || normalized.includes('startcomms')
    || normalized.includes('[comms]')
    || normalized.includes('client is not ready')
    || normalized.includes('client not ready')
    || normalized.includes('session is not ready')
    || normalized.includes('sessao ainda nao esta conectada')
    || normalized.includes('sessão ainda não está conectada');
}

function friendlyApiError(error) {
  const message = rawApiErrorMessage(error);
  if (isWhatsAppCommsNotReadyMessage(message)) {
    return 'A sessão do WhatsApp está conectada, mas ainda não está pronta para envio. Clique em Reconectar ou gere o QR Code novamente e aguarde alguns segundos antes de reenviar.';
  }
  return message;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeBrazilWhatsAppNumber(value) {
  const digits = onlyDigits(value);

  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function buildWhatsAppNumberVariants(value) {
  const normalized = normalizeBrazilWhatsAppNumber(value);
  if (!normalized) return [];

  const variants = [normalized];
  if (normalized.startsWith('55')) {
    const national = normalized.slice(2);
    const ddd = national.slice(0, 2);
    const subscriber = national.slice(2);

    if (ddd.length === 2 && subscriber.length === 9 && subscriber.startsWith('9')) {
      variants.push(`55${ddd}${subscriber.slice(1)}`);
    }

    if (ddd.length === 2 && subscriber.length === 8) {
      variants.push(`55${ddd}9${subscriber}`);
    }
  }

  return uniqueValues(variants);
}

function shouldRetryWithNumberVariant(error) {
  const message = rawApiErrorMessage(error).toLowerCase();
  return message.includes('no lid for user')
    || message.includes('número não encontrado')
    || message.includes('numero nao encontrado')
    || message.includes('inválido')
    || message.includes('invalido');
}

function shouldRestartSessionAfterError(error) {
  return isWhatsAppCommsNotReadyMessage(rawApiErrorMessage(error));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getQrImageUrl(sessionId, overrides = {}) {
  const config = getConfig(overrides);
  return `${config.baseURL}/public/sessions/${encodeURIComponent(sessionId)}/qr-image`;
}

function extractHtmlText(html, pattern) {
  const match = String(html || '').match(pattern);
  if (!match) return '';

  return String(match[1] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDataImageFromHtml(html) {
  const match = String(html || '').match(/<img[^>]+src=["']data:(image\/[^;]+);base64,([^"']+)["']/i);
  if (!match) return null;

  return {
    contentType: match[1],
    bytes: Buffer.from(match[2], 'base64')
  };
}

function buildQrUnavailableError(html) {
  const title = extractHtmlText(html, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const status = extractHtmlText(html, /Status:\s*([^<]+)/i);
  const reason = [title || 'QR Code ainda não disponível', status ? `Status: ${status}` : '']
    .filter(Boolean)
    .join('. ');
  const error = new Error(reason);
  error.status = status || null;
  return error;
}

async function createSession(sessionId, payload = {}, config = {}) {
  const api = client(config);
  const body = { sessionId, ...payload };
  const attempts = [
    () => api.post('/sessions/start', body),
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
    proxy: false,
    headers: {
      Accept: 'image/png,image/jpeg,image/webp,*/*',
      ...(resolved.apiKey ? { 'x-api-key': resolved.apiKey } : {})
    }
  });

  const contentType = response.headers['content-type'] || 'image/png';
  const bytes = Buffer.from(response.data);

  if (contentType.includes('text/html') || bytes.toString('utf8', 0, Math.min(bytes.length, 80)).includes('<html')) {
    const html = bytes.toString('utf8');
    const embeddedImage = extractDataImageFromHtml(html);
    if (embeddedImage?.bytes?.length) {
      return {
        ...embeddedImage,
        source: 'html_embedded_qr'
      };
    }

    throw buildQrUnavailableError(html);
  }

  return {
    contentType,
    bytes,
    source: 'raw_image'
  };
}

async function waitForQrImage(sessionId, config = {}) {
  const attempts = Math.max(1, Number(config.attempts || 6));
  const delayMs = Math.max(500, Number(config.delayMs || 2500));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getQrImage(sessionId, config);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

function normalizeIdempotencyKey(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, 120);
}

function buildSendMessagePayload({ sessionId, number, message, idempotencyKey }) {
  const payload = { sessionId, number, message };
  const key = normalizeIdempotencyKey(idempotencyKey);
  if (key) {
    payload.idempotencyKey = key;
    payload.clientRequestId = key;
  }
  return payload;
}

function buildIdempotencyHeaders(idempotencyKey) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  return key
    ? {
        headers: {
          'Idempotency-Key': key,
          'x-idempotency-key': key,
          'x-client-request-id': key
        }
      }
    : undefined;
}

async function sendMessage({ sessionId, number, message, idempotencyKey, clientRequestId }, config = {}) {
  const api = config.apiClient || client(config);
  const fallbackEnabled = String(config.phoneFallbackEnabled ?? process.env.WHATSAPP_PHONE_FALLBACK_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  const reconnectOnCommsError = String(config.reconnectOnCommsError ?? process.env.WHATSAPP_RECONNECT_ON_COMMS_ERROR ?? 'true').trim().toLowerCase() !== 'false';
  const reconnectDelayMs = Math.max(500, Number(config.reconnectDelayMs || process.env.WHATSAPP_RECONNECT_SEND_DELAY_MS || 3500));
  const resolvedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey || clientRequestId || config.idempotencyKey || config.clientRequestId);
  const candidates = fallbackEnabled
    ? buildWhatsAppNumberVariants(number)
    : [normalizeBrazilWhatsAppNumber(number) || onlyDigits(number)];
  const attemptedNumbers = [];
  let lastError = null;
  let reconnectAttempted = false;

  for (const candidate of candidates) {
    attemptedNumbers.push(candidate);

    try {
      const response = await api.post('/messages/send', buildSendMessagePayload({
        sessionId,
        number: candidate,
        message,
        idempotencyKey: resolvedIdempotencyKey
      }), buildIdempotencyHeaders(resolvedIdempotencyKey));
      return {
        ...response.data,
        resolvedNumber: candidate,
        attemptedNumbers
      };
    } catch (error) {
      let handledError = error;

      if (reconnectOnCommsError && !reconnectAttempted && shouldRestartSessionAfterError(error)) {
        reconnectAttempted = true;
        try {
          await api.post('/sessions/start', { sessionId, qrcode: false, reason: 'auto_reconnect_before_send' });
          await sleep(reconnectDelayMs);
          const response = await api.post('/messages/send', buildSendMessagePayload({
            sessionId,
            number: candidate,
            message,
            idempotencyKey: resolvedIdempotencyKey
          }), buildIdempotencyHeaders(resolvedIdempotencyKey));
          return {
            ...response.data,
            resolvedNumber: candidate,
            attemptedNumbers,
            recoveredSession: true
          };
        } catch (retryError) {
          handledError = retryError;
        }
      }

      lastError = handledError;
      if (!shouldRetryWithNumberVariant(handledError) || attemptedNumbers.length >= candidates.length) {
        handledError.attemptedNumbers = attemptedNumbers;
        throw handledError;
      }
    }
  }

  if (lastError) {
    lastError.attemptedNumbers = attemptedNumbers;
    throw lastError;
  }

  throw new Error('Número inválido para envio pelo WhatsApp.');
}

async function disconnectSession(sessionId, config = {}) {
  const response = await client(config).post(`/sessions/${encodeURIComponent(sessionId)}/disconnect`);
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
      serviceReachable: false,
      message: 'Configuração whatsapp-service ausente.'
    };
  }

  try {
    const response = await client(config).get('/');
    return {
      configured: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      missing: [],
      serviceReachable: true,
      status: response.status,
      version: response.data?.version || response.data?.name || response.data?.environment || null,
      payload: response.data,
      message: 'whatsapp-service acessível.'
    };
  } catch (error) {
    return {
      configured: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      missing: [],
      serviceReachable: false,
      status: error.response?.status || null,
      message: friendlyApiError(error)
    };
  }
}

module.exports = {
  buildWhatsAppNumberVariants,
  buildSendMessagePayload,
  createSession,
  diagnostic,
  disconnectSession,
  friendlyApiError,
  getConfig,
  getQrImage,
  getQrImageUrl,
  getSessionStatus,
  isWhatsAppCommsNotReadyMessage,
  normalizeBrazilWhatsAppNumber,
  rawApiErrorMessage,
  sendMessage,
  shouldRestartSessionAfterError,
  shouldRetryWithNumberVariant,
  waitForQrImage
};
