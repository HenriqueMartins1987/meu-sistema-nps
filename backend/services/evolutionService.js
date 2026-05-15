const axios = require('axios');

function getConfig() {
  const baseURL = String(process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = String(process.env.EVOLUTION_API_KEY || '').trim();

  return {
    baseURL,
    apiKey,
    configured: Boolean(baseURL && apiKey)
  };
}

function assertConfigured() {
  const config = getConfig();
  if (!config.configured) {
    throw new Error('Configuração Evolution API ausente: EVOLUTION_BASE_URL e EVOLUTION_API_KEY.');
  }
  return config;
}

function client() {
  const config = assertConfigured();
  return axios.create({
    baseURL: config.baseURL,
    timeout: 30000,
    headers: {
      apikey: config.apiKey,
      'Content-Type': 'application/json'
    }
  });
}

async function createInstance(payload = {}) {
  // Configure EVOLUTION_BASE_URL and EVOLUTION_API_KEY in Render.
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

  const response = await client().post('/instance/create', {
    instanceName: payload.instanceName,
    integration: payload.integration || 'WHATSAPP-BAILEYS',
    qrcode: payload.qrcode !== false,
    number: payload.number || undefined,
    webhook,
    rejectCall: true,
    msgCall: payload.msgCall || 'No momento não recebemos chamadas por este canal. Envie uma mensagem por texto.',
    groupsIgnore: true,
    alwaysOnline: true,
    readMessages: true,
    readStatus: true,
    syncFullHistory: false
  });
  return response.data;
}

async function connectInstance(instanceName, number = '') {
  const response = await client().get(`/instance/connect/${encodeURIComponent(instanceName)}`, {
    params: number ? { number } : undefined
  });
  return response.data;
}

async function getConnectionState(instanceName) {
  const response = await client().get(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
  return response.data;
}

async function restartInstance(instanceName) {
  const response = await client().put(`/instance/restart/${encodeURIComponent(instanceName)}`);
  return response.data;
}

async function sendText(instanceName, number, text, options = {}) {
  const response = await client().post(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    number,
    textMessage: { text },
    options: {
      delay: options.delay || 800,
      presence: options.presence || 'composing',
      linkPreview: options.linkPreview !== false
    }
  });
  return response.data;
}

async function logoutInstance(instanceName) {
  const response = await client().delete(`/instance/logout/${encodeURIComponent(instanceName)}`);
  return response.data;
}

async function deleteInstance(instanceName) {
  const response = await client().delete(`/instance/delete/${encodeURIComponent(instanceName)}`);
  return response.data;
}

async function fetchInstances() {
  const response = await client().get('/instance/fetchInstances');
  return response.data;
}

module.exports = {
  createInstance,
  connectInstance,
  deleteInstance,
  fetchInstances,
  getConfig,
  getConnectionState,
  logoutInstance,
  restartInstance,
  sendText
};
