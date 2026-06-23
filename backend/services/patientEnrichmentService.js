const { normalizeText } = require('./agendaImportService');

const DEFAULT_COUNTRY_CODE = String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '55').replace(/\D/g, '') || '55';

const CONTACT_STATUS_LABELS = {
  updated: 'Contato atualizado',
  found_by_robot: 'Encontrado pelo robô',
  pending: 'Telefone pendente',
  review_required: 'Revisão necessária',
  outdated: 'Telefone desatualizado',
  not_found: 'Não encontrado',
  access_denied: 'Acesso negado',
  clinic_mismatch: 'Clínica divergente',
  date_mismatch: 'Data divergente',
  error: 'Erro'
};

const APPOINTMENT_DATE_MATCH_LABELS = {
  matched: 'Data validada',
  not_available: 'Data não localizada',
  mismatch: 'Data divergente',
  not_checked: 'Data não verificada',
  review_required: 'Data em revisão'
};

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizePhone(value, options = {}) {
  const defaultCountryCode = onlyDigits(options.defaultCountryCode || DEFAULT_COUNTRY_CODE) || '55';
  let digits = onlyDigits(value);

  if (!digits) {
    return {
      raw: value ?? '',
      nationalDigits: '',
      normalized: '',
      valid: false,
      reason: 'empty'
    };
  }

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith(defaultCountryCode) && digits.length > 11) {
    digits = digits.slice(defaultCountryCode.length);
  }

  if (digits.length === 8 || digits.length === 9) {
    return {
      raw: value ?? '',
      nationalDigits: digits,
      normalized: '',
      valid: false,
      reason: 'missing_ddd'
    };
  }

  if (digits.length < 10 || digits.length > 11) {
    return {
      raw: value ?? '',
      nationalDigits: digits,
      normalized: '',
      valid: false,
      reason: 'invalid_length'
    };
  }

  const ddd = digits.slice(0, 2);
  if (!/^[1-9][1-9]$/.test(ddd)) {
    return {
      raw: value ?? '',
      nationalDigits: digits,
      normalized: '',
      valid: false,
      reason: 'invalid_ddd'
    };
  }

  const normalized = `+${defaultCountryCode}${digits}`;
  return {
    raw: value ?? '',
    nationalDigits: digits,
    normalized,
    valid: true,
    reason: null
  };
}

function maskPhone(value) {
  const normalized = normalizePhone(value);
  if (!normalized.valid) return 'Pendente';
  const digits = normalized.normalized.replace('+', '');
  const countryCode = digits.slice(0, 2);
  const ddd = digits.slice(2, 4);
  const local = digits.slice(4);
  const prefix = local.slice(0, Math.max(0, local.length - 4)).replace(/\d/g, '*');
  const suffix = local.slice(-4);
  return `+${countryCode} ${ddd} ${prefix}-${suffix}`.trim();
}

function normalizeDateOnly(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) {
    return String(value).trim();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function resolveAppointmentDateMatchStatus({
  appointmentDate,
  externalDate,
  strongIdentity = false
} = {}) {
  const normalizedAppointmentDate = normalizeDateOnly(appointmentDate);
  const normalizedExternalDate = normalizeDateOnly(externalDate);

  if (!normalizedAppointmentDate) return 'not_checked';
  if (!normalizedExternalDate) return strongIdentity ? 'not_available' : 'review_required';
  if (normalizedAppointmentDate === normalizedExternalDate) return 'matched';
  return 'mismatch';
}

function deriveContactStatus({
  phoneNormalized = '',
  reviewRequired = false,
  accessDenied = false,
  clinicMismatch = false,
  dateMatchStatus = 'not_checked',
  foundByRobot = false,
  lastCheckedAt = null
} = {}) {
  if (accessDenied) return 'access_denied';
  if (clinicMismatch) return 'clinic_mismatch';
  if (dateMatchStatus === 'mismatch') return 'date_mismatch';
  if (reviewRequired || dateMatchStatus === 'review_required') return 'review_required';
  if (!phoneNormalized) return 'pending';
  if (!lastCheckedAt) return foundByRobot ? 'found_by_robot' : 'updated';

  const checkedAt = new Date(lastCheckedAt);
  if (Number.isNaN(checkedAt.getTime())) return foundByRobot ? 'found_by_robot' : 'updated';
  const ageMs = Date.now() - checkedAt.getTime();
  if (ageMs > 30 * 24 * 60 * 60 * 1000) return 'outdated';
  return foundByRobot ? 'found_by_robot' : 'updated';
}

function getContactStatusLabel(value) {
  return CONTACT_STATUS_LABELS[value] || 'Status indisponível';
}

function getAppointmentDateMatchLabel(value) {
  return APPOINTMENT_DATE_MATCH_LABELS[value] || 'Não verificado';
}

function buildWhatsAppMessage(template = '', context = {}) {
  const defaultTemplate = [
    'Olá, {nomePaciente}! Tudo bem?',
    'Aqui é da central de atendimento do Grupo Sorria.',
    'Estamos entrando em contato sobre seu agendamento na unidade {clinica}, previsto para {dataAgendamento} às {horaAgendamento}.',
    'Podemos confirmar seu comparecimento?'
  ].join('\n');

  return String(template || defaultTemplate).replace(/\{(\w+)\}/g, (_, key) => {
    if (key === 'nomePaciente') return context.patientName || 'paciente';
    if (key === 'clinica') return context.clinicName || 'sua unidade';
    if (key === 'dataAgendamento') return context.appointmentDateLabel || 'data informada';
    if (key === 'horaAgendamento') return context.appointmentTimeLabel || 'horário informado';
    return context[key] || '';
  });
}

function buildWhatsAppUrl(phone, message) {
  const normalized = normalizePhone(phone);
  if (!normalized.valid) return '';
  const waPhone = normalized.normalized.replace(/\D/g, '');
  const encodedMessage = encodeURIComponent(String(message || '').trim());
  return encodedMessage
    ? `https://wa.me/${waPhone}?text=${encodedMessage}`
    : `https://wa.me/${waPhone}`;
}

function buildQueueSummary(rows = []) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    const normalizedStatus = String(row.status || 'pending').trim().toLowerCase();
    if (normalizedStatus === 'pending') summary.pending += 1;
    if (normalizedStatus === 'processing') summary.processing += 1;
    if (['found', 'contact_updated', 'found_by_robot'].includes(normalizedStatus)) summary.found += 1;
    if (normalizedStatus === 'review_required') summary.reviewRequired += 1;
    if (normalizedStatus === 'not_found') summary.notFound += 1;
    if (normalizedStatus === 'error') summary.errors += 1;
    return summary;
  }, {
    total: 0,
    pending: 0,
    processing: 0,
    found: 0,
    reviewRequired: 0,
    notFound: 0,
    errors: 0
  });
}

function deriveRobotProvider(baseUrl = '', explicitProvider = '') {
  const normalizedExplicitProvider = String(explicitProvider || '').trim().toLowerCase();
  if (normalizedExplicitProvider) return normalizedExplicitProvider;
  return /(^|\/\/)([^/]+\.)?ecuro\.com\.br(\/|$)/i.test(String(baseUrl || '').trim()) ? 'ecuro' : 'generic';
}

function resolveEcuroApiBaseUrl(baseUrl = '', explicitApiUrl = '', prefix = '') {
  const normalizedExplicitApiUrl = String(explicitApiUrl || '').trim();
  if (normalizedExplicitApiUrl) {
    return normalizedExplicitApiUrl.replace(/\/$/, '');
  }

  try {
    const parsedBaseUrl = new URL(String(baseUrl || '').trim());
    const hostname = parsedBaseUrl.hostname.replace(/^www\./i, '');
    if (!hostname) return '';
    return `${parsedBaseUrl.protocol}//${prefix}.api.${hostname}`;
  } catch (error) {
    return '';
  }
}

function getRobotConfig(env = process.env) {
  const explicitBaseUrl = String(env.EXTERNAL_PORTAL_BASE_URL || '').trim();
  const provider = deriveRobotProvider(explicitBaseUrl, env.EXTERNAL_PORTAL_PROVIDER);
  const baseUrl = explicitBaseUrl || (provider === 'ecuro' ? 'https://ecuro.com.br' : '');
  return {
    provider,
    baseUrl,
    authApiUrl: resolveEcuroApiBaseUrl(baseUrl, env.EXTERNAL_PORTAL_AUTH_API_URL, 'auth'),
    clinicsApiUrl: resolveEcuroApiBaseUrl(baseUrl, env.EXTERNAL_PORTAL_CLINICS_API_URL, 'clinics'),
    patientsApiUrl: resolveEcuroApiBaseUrl(baseUrl, env.EXTERNAL_PORTAL_PATIENTS_API_URL, 'patients'),
    level1Username: String(env.EXTERNAL_PORTAL_LEVEL1_USERNAME || '').trim(),
    level1Password: String(env.EXTERNAL_PORTAL_LEVEL1_PASSWORD || '').trim(),
    level2Username: String(env.EXTERNAL_PORTAL_LEVEL2_USERNAME || '').trim(),
    level2Password: String(env.EXTERNAL_PORTAL_LEVEL2_PASSWORD || '').trim(),
    level1Path: String(env.EXTERNAL_PORTAL_LEVEL1_PATH || (provider === 'ecuro' ? '/' : '/login')).trim(),
    level2Path: String(env.EXTERNAL_PORTAL_LEVEL2_PATH || (provider === 'ecuro' ? '/api/v1/login' : '/login/secondary')).trim(),
    appointmentsPath: String(env.EXTERNAL_PORTAL_APPOINTMENTS_PATH || '/api/v1/appointments').trim(),
    searchPath: String(env.EXTERNAL_PORTAL_SEARCH_PATH || '/api/patients/search').trim(),
    queryParam: String(env.EXTERNAL_PORTAL_PATIENT_QUERY_PARAM || 'q').trim(),
    clinicParam: String(env.EXTERNAL_PORTAL_CLINIC_QUERY_PARAM || 'clinicId').trim(),
    dateParam: String(env.EXTERNAL_PORTAL_DATE_QUERY_PARAM || 'appointmentDate').trim(),
    timezoneOffsetMinutes: String(env.EXTERNAL_PORTAL_TIMEZONE_OFFSET_MINUTES || '-180').trim() || '-180',
    userIp: String(env.EXTERNAL_PORTAL_USER_IP || '127.0.0.1').trim() || '127.0.0.1',
    headless: String(env.ROBOT_HEADLESS || 'true').trim().toLowerCase() !== 'false',
    timeoutMs: Math.max(10000, Number(env.ROBOT_TIMEOUT_MS || 60000) || 60000),
    maxAttempts: Math.max(1, Number(env.ROBOT_MAX_ATTEMPTS || 3) || 3),
    autoAfterUpload: String(env.ROBOT_ENABLE_AUTO_AFTER_UPLOAD || 'true').trim().toLowerCase() !== 'false',
    whatsappOpenMode: String(env.WHATSAPP_OPEN_MODE || 'web').trim().toLowerCase() || 'web'
  };
}

function getRobotConfigStatus(env = process.env) {
  const config = getRobotConfig(env);
  return {
    configured: Boolean(
      config.baseUrl
      && config.level1Username
      && config.level1Password
      && config.level2Username
      && config.level2Password
    ),
    provider: config.provider,
    authApiUrl: config.authApiUrl || '',
    clinicsApiUrl: config.clinicsApiUrl || '',
    patientsApiUrl: config.patientsApiUrl || '',
    autoAfterUpload: config.autoAfterUpload,
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
    headless: config.headless,
    whatsappOpenMode: config.whatsappOpenMode,
    timezoneOffsetMinutes: config.timezoneOffsetMinutes
  };
}

module.exports = {
  buildQueueSummary,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  deriveContactStatus,
  getAppointmentDateMatchLabel,
  getContactStatusLabel,
  getRobotConfig,
  getRobotConfigStatus,
  maskPhone,
  normalizePhone,
  normalizeText,
  resolveAppointmentDateMatchStatus
};
