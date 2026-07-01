const crypto = require('crypto');
const axios = require('axios');

const whatsappProvider = require('./whatsappProvider');
const { normalizePhone, normalizeText, maskPhone } = require('./patientEnrichmentService');

const DEFAULT_NPS_MESSAGE_TEMPLATE = 'Olá, {{nome_paciente}}! Aqui é do Grupo Sorria, unidade {{clinica}}. Queremos saber como foi sua experiência na sua última consulta. De 0 a 10, qual nota você daria para nosso atendimento? Você pode responder por aqui ou acessar a pesquisa completa: {{link_nps}}';

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function parseTimeLabel(value, fallback = '00:00') {
  const normalized = String(value || '').trim();
  if (/^\d{2}:\d{2}$/.test(normalized)) return normalized;
  if (/^\d{1}:\d{2}$/.test(normalized)) {
    const [hour, minute] = normalized.split(':');
    return `${hour.padStart(2, '0')}:${minute}`;
  }
  return fallback;
}

function getEcuroRobotClientConfig(env = process.env) {
  const baseUrl = String(env.ECURO_ROBOT_SERVICE_URL || `http://127.0.0.1:${env.ECURO_ROBOT_PORT || 3010}`).trim().replace(/\/+$/, '');
  const apiKey = String(env.ECURO_ROBOT_API_KEY || '').trim();
  return {
    baseUrl,
    apiKey,
    timeoutMs: Math.max(10000, Number(env.ECURO_ROBOT_SERVICE_TIMEOUT_MS || env.ROBOT_TIMEOUT_MS || 60000) || 60000)
  };
}

function getNpsAutomationConfig(env = process.env) {
  return {
    sessionId: String(env.NPS_WHATSAPP_SESSION_ID || env.WHATSAPP_NPS_INSTANCE_NAME || 'nps').trim() || 'nps',
    publicUrl: String(env.NPS_PUBLIC_URL || 'https://meu-sistema-nps-three.vercel.app/nps').trim().replace(/\/+$/, ''),
    dispatchEnabled: String(env.NPS_DISPATCH_ENABLED || 'true').trim().toLowerCase() !== 'false',
    dispatchWindowStart: parseTimeLabel(env.NPS_DISPATCH_WINDOW_START || '08:00', '08:00'),
    dispatchWindowEnd: parseTimeLabel(env.NPS_DISPATCH_WINDOW_END || '18:00', '18:00'),
    dispatchIntervalSeconds: Math.max(15, Number(env.NPS_DISPATCH_INTERVAL_SECONDS || 45) || 45),
    maxDailyPerSession: Math.max(1, Number(env.NPS_MAX_DAILY_PER_SESSION || 300) || 300),
    duplicateBlockHours: Math.max(1, Number(env.NPS_DUPLICATE_BLOCK_HOURS || 24) || 24),
    dryRun: String(env.ECURO_ROBOT_DRY_RUN || 'false').trim().toLowerCase() === 'true',
    cron: String(env.ECURO_ROBOT_CRON || '0 19 * * 1-6').trim() || '0 19 * * 1-6'
  };
}

function buildNpsInviteIdempotencyKey({ inviteId, phone }) {
  const normalizedPhone = normalizePhone(phone || '').normalized || `+${onlyDigits(phone)}`;
  const digits = onlyDigits(normalizedPhone);
  return `nps-${Number(inviteId || 0) || 0}-${digits}`;
}

function buildNpsInviteToken(seed = '') {
  return crypto
    .createHash('sha256')
    .update(`${Date.now()}-${seed}-${crypto.randomBytes(10).toString('hex')}`)
    .digest('hex');
}

function buildNpsInvitePublicUrl({
  clinicId,
  patientName,
  patientPhone,
  inviteId,
  token,
  source = 'ecuro_last_consultation'
}, env = process.env) {
  const config = getNpsAutomationConfig(env);
  const url = new URL(config.publicUrl);
  url.searchParams.set('clinic_id', String(clinicId || ''));
  url.searchParams.set('patient_name', String(patientName || ''));
  url.searchParams.set('patient_phone', String(patientPhone || ''));
  url.searchParams.set('source', source);
  url.searchParams.set('invite_id', String(inviteId || ''));
  url.searchParams.set('token', String(token || ''));
  return url.toString();
}

function buildNpsInviteMessage(context = {}, template = DEFAULT_NPS_MESSAGE_TEMPLATE) {
  return String(template || DEFAULT_NPS_MESSAGE_TEMPLATE)
    .replace(/\{\{\s*nome_paciente\s*\}\}/g, context.patientName || 'paciente')
    .replace(/\{\{\s*clinica\s*\}\}/g, context.clinicName || 'sua unidade')
    .replace(/\{\{\s*link_nps\s*\}\}/g, context.link || '');
}

function interpretEcuroCompletionStatus(value) {
  const normalized = normalizeText(value || '');
  if (!normalized) return 'not_completed';
  if (['completed', 'concluido', 'concluida', 'finalizado', 'finalizada', 'atendido', 'atendida', 'compareceu', 'encerrado', 'encerrada'].some((token) => normalized.includes(token))) {
    return 'completed';
  }
  if (['not_found', 'nao encontrado', 'não encontrado'].some((token) => normalized.includes(token))) {
    return 'not_found';
  }
  if (['ambiguous', 'ambiguo', 'ambíguo'].some((token) => normalized.includes(token))) {
    return 'ambiguous';
  }
  if (['out_of_date', 'invalid_phone', 'missing_phone', 'not_completed'].some((token) => normalized.includes(token))) {
    return 'not_completed';
  }
  if (['error', 'erro', 'parse_error', 'manual_action_required'].some((token) => normalized.includes(token))) {
    return normalized.includes('manual_action_required') ? 'manual_action_required' : 'error';
  }
  return 'not_completed';
}

function isCompletedEcuroStatus(value) {
  return interpretEcuroCompletionStatus(value) === 'completed';
}

function getMinutesFromTimeLabel(value) {
  const [hour, minute] = parseTimeLabel(value).split(':').map((item) => Number(item));
  return (hour * 60) + minute;
}

function isWithinDispatchWindow(now = new Date(), config = getNpsAutomationConfig()) {
  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  const start = getMinutesFromTimeLabel(config.dispatchWindowStart);
  const end = getMinutesFromTimeLabel(config.dispatchWindowEnd);
  if (start <= end) {
    return currentMinutes >= start && currentMinutes <= end;
  }
  return currentMinutes >= start || currentMinutes <= end;
}

function sanitizeRobotError(error) {
  const raw = String(error?.message || error || '').trim();
  const maskedPhone = raw.replace(/\+?\d{10,14}/g, (match) => maskPhone(match));
  return maskedPhone.replace(/password|senha|token|api[-_\s]?key/gi, '[redacted]');
}

function computeRetryState({ attempts = 0, maxAttempts = 3, delaySeconds = 45, now = new Date(), manualActionRequired = false } = {}) {
  if (manualActionRequired) {
    return {
      status: 'manual_action_required',
      attempts,
      nextAttemptAt: null
    };
  }

  if (attempts >= maxAttempts) {
    return {
      status: 'failed',
      attempts,
      nextAttemptAt: null
    };
  }

  return {
    status: 'pending',
    attempts,
    nextAttemptAt: new Date(now.getTime() + (Math.max(15, Number(delaySeconds || 45)) * 1000))
  };
}

function matchCronField(field, value) {
  const normalized = String(field || '*').trim();
  if (!normalized || normalized === '*') return true;

  return normalized.split(',').some((segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return false;

    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed) === value;
    }

    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      return value >= start && value <= end;
    }

    return false;
  });
}

function matchesCronExpression(expression, now = new Date()) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;

  return matchCronField(parts[0], now.getMinutes())
    && matchCronField(parts[1], now.getHours())
    && matchCronField(parts[2], now.getDate())
    && matchCronField(parts[3], now.getMonth() + 1)
    && matchCronField(parts[4], now.getDay());
}

function createEcuroRobotApiClient(env = process.env) {
  const config = getEcuroRobotClientConfig(env);
  return axios.create({
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    headers: {
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json'
    }
  });
}

async function callEcuroRobotLoginTest(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/login-test', payload);
  return response.data;
}

async function callEcuroRobotCheckCompleted(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/check-completed', payload);
  return response.data;
}

async function callEcuroRobotCheckCompletedAllClinics(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/check-completed/all-clinics', payload);
  return response.data;
}

async function callEcuroRobotDiscoverClinics(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/discover-clinics', payload);
  return response.data;
}

async function callEcuroRobotDiscoverNetwork(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/discover-network', payload);
  return response.data;
}

async function callEcuroRobotCheckCompletedNetwork(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/check-completed/network', payload);
  return response.data;
}

async function callEcuroRobotExcelDiscoverExport(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/excel/discover-export', payload);
  return response.data;
}

async function callEcuroRobotExcelDownloadOneClinic(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/excel/download-one-clinic', payload);
  return response.data;
}

async function callEcuroRobotExcelDryRunOneClinic(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/excel/dry-run-one-clinic', payload);
  return response.data;
}

async function callEcuroRobotExcelDryRunAllClinics(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/excel/dry-run-all-clinics', payload);
  return response.data;
}

async function callEcuroRobotExcelProcessLatest(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/excel/process-latest', payload);
  return response.data;
}

async function callEcuroRobotExcelJobs(env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.get('/ecuro/excel/jobs');
  return response.data;
}

async function callEcuroRobotExcelJobDetail(jobId, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.get(`/ecuro/excel/jobs/${encodeURIComponent(jobId)}`);
  return response.data;
}

async function callEcuroRobotMappingRun(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/mapping/run', payload);
  return response.data;
}

async function callEcuroRobotJobs(env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.get('/ecuro/jobs');
  return response.data;
}

async function callEcuroRobotJobDetail(jobId, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.get(`/ecuro/jobs/${encodeURIComponent(jobId)}`);
  return response.data;
}

async function callEcuroRobotLiveState(env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.get('/ecuro/live-state');
  return response.data;
}

async function callEcuroRobotVncStatus(env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.get('/ecuro/vnc-status');
  return response.data;
}

async function callEcuroRobotVncStart(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/vnc/start', payload);
  return response.data;
}

async function callEcuroRobotVncStop(payload = {}, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post('/ecuro/vnc/stop', payload);
  return response.data;
}

async function callEcuroRobotArtifact(jobId, artifactId, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.get(
    `/ecuro/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`,
    {
      responseType: 'arraybuffer'
    }
  );
  return {
    data: response.data,
    headers: response.headers || {},
    status: response.status
  };
}

async function callEcuroRobotArtifactByPath(filePath, env = process.env) {
  const client = createEcuroRobotApiClient(env);
  const response = await client.post(
    '/ecuro/artifacts/open',
    { path: filePath },
    {
      responseType: 'arraybuffer'
    }
  );
  return {
    data: response.data,
    headers: response.headers || {},
    status: response.status
  };
}

async function sendNpsInviteViaWhatsApp({ sessionId, number, message, idempotencyKey }) {
  return whatsappProvider.sendText({
    sessionId,
    number,
    message,
    idempotencyKey
  });
}

module.exports = {
  DEFAULT_NPS_MESSAGE_TEMPLATE,
  buildNpsInviteIdempotencyKey,
  buildNpsInviteMessage,
  buildNpsInvitePublicUrl,
  buildNpsInviteToken,
  callEcuroRobotCheckCompleted,
  callEcuroRobotCheckCompletedAllClinics,
  callEcuroRobotCheckCompletedNetwork,
  callEcuroRobotDiscoverClinics,
  callEcuroRobotDiscoverNetwork,
  callEcuroRobotExcelDiscoverExport,
  callEcuroRobotExcelDownloadOneClinic,
  callEcuroRobotExcelDryRunAllClinics,
  callEcuroRobotExcelDryRunOneClinic,
  callEcuroRobotExcelJobDetail,
  callEcuroRobotExcelJobs,
  callEcuroRobotExcelProcessLatest,
  callEcuroRobotArtifact,
  callEcuroRobotArtifactByPath,
  callEcuroRobotJobDetail,
  callEcuroRobotJobs,
  callEcuroRobotLoginTest,
  callEcuroRobotLiveState,
  callEcuroRobotMappingRun,
  callEcuroRobotVncStart,
  callEcuroRobotVncStatus,
  callEcuroRobotVncStop,
  computeRetryState,
  createEcuroRobotApiClient,
  getEcuroRobotClientConfig,
  getNpsAutomationConfig,
  interpretEcuroCompletionStatus,
  isCompletedEcuroStatus,
  isWithinDispatchWindow,
  matchesCronExpression,
  sanitizeRobotError,
  sendNpsInviteViaWhatsApp
};
