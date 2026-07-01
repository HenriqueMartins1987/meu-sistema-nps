const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { normalizePhone, normalizeText } = require('./patientEnrichmentService');

const DEFAULT_SELECTORS = {
  login: {
    level1Username: ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', 'input[type="text"]'],
    level1Password: ['input[name="password"]', 'input[type="password"]'],
    level1Submit: ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Entrar")', 'button:has-text("Login")'],
    level2Username: ['input[name="username"]', 'input[name="login"]', 'input[type="email"]', 'input[type="text"]'],
    level2Password: ['input[name="password"]', 'input[type="password"]'],
    level2Submit: ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Entrar")', 'button:has-text("Acessar")'],
    authenticatedIndicators: ['[data-testid="dashboard"]', 'nav', 'aside', 'main', 'body.authenticated'],
    manualActionIndicators: ['text=/captcha/i', 'text=/2fa/i', 'text=/verifica/i', 'text=/c[oó]digo/i']
  },
  navigation: {
    completedPagePath: 'https://ecuro.com.br/dashboard/patients',
    currentClinic: [
      '[data-testid="clinic-current"]',
      'header [class*="clinic"]',
      'header [class*="unit"]',
      'header strong',
      'main h1',
      'main h2'
    ],
    clinicSelector: [
      '[data-testid="clinic-selector"]',
      'button[aria-haspopup="listbox"]',
      'header button',
      'header [role="button"]'
    ],
    clinicFilter: [
      'input[name="clinic"]',
      'input[placeholder*="Clinica"]',
      'input[placeholder*="clínica"]',
      'input[placeholder*="Unidade"]',
      'input[placeholder*="Pesquisar"]',
      'input[type="search"]',
      '[data-testid="clinic-filter"]'
    ],
    clinicOptions: ['[role="option"]', '.v-list-item', 'li'],
    dateFilter: ['input[name="date"]', 'input[type="date"]', '[data-testid="date-filter"]'],
    searchField: ['input[name="search"]', 'input[type="search"]', '[placeholder*="paciente"]'],
    applyFilters: ['button:has-text("Filtrar")', 'button:has-text("Buscar")', 'button:has-text("Aplicar")'],
    nextPage: [
      'button[aria-label*="Next"]',
      'button[aria-label*="Próxima"]',
      'button[aria-label*="Proxima"]',
      'button:has-text("Próxima")',
      'button:has-text("Proxima")',
      '.v-pagination__next button',
      '[data-testid="pagination-next"]'
    ],
    paginationSummary: ['text=/\\d+\\s*-\\s*\\d+\\s+de\\s+\\d+/i', '.v-data-footer__pagination']
  },
  results: {
    tables: ['table'],
    headers: ['thead th', 'thead td'],
    rows: ['tbody tr'],
    emptyStates: ['text=/nenhum registro/i', 'text=/sem registros/i', 'text=/no results/i']
  }
};

const PATIENT_TABLE_HEADER_MATCHERS = {
  patientFirstName: [{ includes: 'primeiro nome' }],
  patientLastName: [{ includes: 'sobrenome' }],
  document: [{ exact: 'cpf' }],
  externalPatientId: [{ exact: 'id' }],
  patientPhone: [
    { includes: 'numero de telef' },
    { includes: 'numero de telefone' },
    { includes: 'telefone' },
    { includes: 'whatsapp' }
  ],
  birthDate: [
    { includes: 'data de nascimento' },
    { includes: 'data de nasc' }
  ],
  registrationDate: [{ includes: 'data de cadastro' }],
  lastConsultationDate: [{ includes: 'ultima consulta' }],
  nextConsultationDate: [{ includes: 'proxima consulta' }]
};

const ELIGIBILITY_TO_COMPLETION_STATUS = {
  eligible: 'completed',
  out_of_date: 'not_completed',
  invalid_phone: 'not_completed',
  duplicate: 'ambiguous',
  missing_last_consultation: 'not_found',
  clinic_mismatch: 'error',
  error: 'error'
};

const ECURO_PATIENT_TABLE_COLUMNS = [
  { field: 'patientFirstName', label: 'PRIMEIRO NOME' },
  { field: 'patientLastName', label: 'SOBRENOME' },
  { field: 'document', label: 'CPF' },
  { field: 'externalPatientId', label: 'ID' },
  { field: 'patientPhone', label: 'NUMERO DE TELEFONE' },
  { field: 'birthDate', label: 'DATA DE NASCIMENTO' },
  { field: 'registrationDate', label: 'DATA DE CADASTRO' },
  { field: 'lastConsultationDate', label: 'ULTIMA CONSULTA' },
  { field: 'nextConsultationDate', label: 'PROXIMA CONSULTA' }
];

const ECURO_PATIENT_FIELD_ORDER = ECURO_PATIENT_TABLE_COLUMNS.map((column) => column.field);
const ECURO_PATIENT_HEADER_TEXTS = ECURO_PATIENT_TABLE_COLUMNS.map((column) => column.label);

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function ensureDir(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).trim().toLowerCase() !== 'false';
}

function mergeDeep(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  const result = { ...(base && typeof base === 'object' ? base : {}) };
  Object.entries(override).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      result[key] = value.slice();
      return;
    }

    if (value && typeof value === 'object') {
      result[key] = mergeDeep(result[key], value);
      return;
    }

    result[key] = value;
  });
  return result;
}

function readSelectorsConfig(env = process.env) {
  let selectors = DEFAULT_SELECTORS;
  const rawJson = String(env.ECURO_ROBOT_SELECTORS_JSON || '').trim();
  const rawFile = String(env.ECURO_ROBOT_SELECTORS_FILE || '').trim();

  if (rawFile) {
    try {
      const filePayload = JSON.parse(fs.readFileSync(path.resolve(rawFile), 'utf8'));
      selectors = mergeDeep(selectors, filePayload);
    } catch (_error) {
      // Optional override file.
    }
  }

  if (rawJson) {
    try {
      selectors = mergeDeep(selectors, JSON.parse(rawJson));
    } catch (_error) {
      // Optional inline override payload.
    }
  }

  return selectors;
}

function getEcuroRobotConfig(env = process.env) {
  const mode = String(env.EXTERNAL_PORTAL_MODE || 'browser').trim().toLowerCase() || 'browser';
  const baseUrl = String(env.EXTERNAL_PORTAL_BASE_URL || 'https://ecuro.com.br').trim().replace(/\/+$/, '');
  const profileDir = path.resolve(String(env.ECURO_BROWSER_PROFILE_DIR || path.join(process.cwd(), 'runtime', 'ecuro-profile')).trim());
  const screenshotDir = path.resolve(String(env.ECURO_ROBOT_SCREENSHOT_DIR || path.join(process.cwd(), 'runtime', 'ecuro-screenshots')).trim());
  const htmlDir = path.resolve(String(env.ECURO_ROBOT_HTML_DIR || path.join(process.cwd(), 'runtime', 'ecuro-html')).trim());
  const debugDir = path.resolve(String(env.ECURO_ROBOT_DEBUG_DIR || path.join(process.cwd(), 'runtime', 'ecuro-debug')).trim());
  const apiKey = String(env.ECURO_ROBOT_API_KEY || '').trim();

  return {
    mode,
    baseUrl,
    level1Username: String(env.EXTERNAL_PORTAL_LEVEL1_USERNAME || '').trim(),
    level1Password: String(env.EXTERNAL_PORTAL_LEVEL1_PASSWORD || '').trim(),
    level2Username: String(env.EXTERNAL_PORTAL_LEVEL2_USERNAME || '').trim(),
    level2Password: String(env.EXTERNAL_PORTAL_LEVEL2_PASSWORD || '').trim(),
    headless: toBoolean(env.ROBOT_HEADLESS, true),
    timeoutMs: Math.max(10000, Number(env.ROBOT_TIMEOUT_MS || 60000) || 60000),
    maxAttempts: Math.max(1, Number(env.ROBOT_MAX_ATTEMPTS || 3) || 3),
    dryRun: toBoolean(env.ECURO_ROBOT_DRY_RUN, true),
    profileDir,
    screenshotDir,
    htmlDir,
    debugDir,
    apiKey,
    host: String(env.ECURO_ROBOT_HOST || '127.0.0.1').trim() || '127.0.0.1',
    port: Math.max(1, Number(env.ECURO_ROBOT_PORT || 3010) || 3010),
    cron: String(env.ECURO_ROBOT_CRON || '0 19 * * 1-6').trim() || '0 19 * * 1-6',
    selectors: readSelectorsConfig(env),
    userAgent: String(env.ECURO_ROBOT_USER_AGENT || '').trim(),
    manualActionPattern: /captcha|two[\s-]?factor|2fa|verifica[cç][aã]o|c[oó]digo/i,
    discoverAllClinics: toBoolean(env.ECURO_DISCOVER_ALL_CLINICS, true),
    clinicListScrollEnabled: toBoolean(env.ECURO_CLINIC_LIST_SCROLL_ENABLED, true),
    maxClinicsPerRun: Math.max(1, Number(env.ECURO_MAX_CLINICS_PER_RUN || 200) || 200),
    clinicSelectionMaxAttempts: Math.max(1, Number(env.ECURO_CLINIC_SELECTION_MAX_ATTEMPTS || 3) || 3),
    clinicSelectionWaitMs: Math.max(500, Number(env.ECURO_CLINIC_SELECTION_WAIT_MS || 3000) || 3000),
    npsDateMode: String(env.ECURO_NPS_DATE_MODE || 'today').trim() || 'today',
    npsTimezone: String(env.ECURO_NPS_TIMEZONE || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo',
    includeToday: toBoolean(env.ECURO_NPS_INCLUDE_TODAY, true),
    includeYesterday: toBoolean(env.ECURO_NPS_INCLUDE_YESTERDAY, false),
    patientsPageSize: Math.max(1, Number(env.ECURO_PATIENTS_PAGE_SIZE || 500) || 500),
    maxPagesPerClinic: Math.max(1, Number(env.ECURO_MAX_PAGES_PER_CLINIC || env.ECURO_MAX_PAGES_PER_RUN || 5) || 5),
    maxPatientsPerClinic: Math.max(1, Number(env.ECURO_MAX_PATIENTS_PER_CLINIC || env.ECURO_MAX_PATIENTS_PER_RUN || 1000) || 1000),
    maxTotalPatientsPerRun: Math.max(1, Number(env.ECURO_MAX_TOTAL_PATIENTS_PER_RUN || 10000) || 10000),
    maxPagesPerRun: Math.max(1, Number(env.ECURO_MAX_PAGES_PER_RUN || env.ECURO_MAX_PAGES_PER_CLINIC || 20) || 20),
    maxPatientsPerRun: Math.max(1, Number(env.ECURO_MAX_PATIENTS_PER_RUN || env.ECURO_MAX_PATIENTS_PER_CLINIC || 1000) || 1000),
    stopWhenOlderThanTarget: toBoolean(env.ECURO_STOP_WHEN_OLDER_THAN_TARGET, true),
    mappingEnabled: toBoolean(env.ECURO_MAPPING_ENABLED, false),
    mappingCron: String(env.ECURO_MAPPING_CRON || '0 2 * * *').trim() || '0 2 * * *',
    mappingMaxPages: Math.max(1, Number(env.ECURO_MAPPING_MAX_PAGES || 10) || 10),
    mappingMaxDepth: Math.max(1, Number(env.ECURO_MAPPING_MAX_DEPTH || 3) || 3),
    mappingCaptureScreenshots: toBoolean(env.ECURO_MAPPING_CAPTURE_SCREENSHOTS, true),
    mappingCaptureHtml: toBoolean(env.ECURO_MAPPING_CAPTURE_HTML, true),
    mappingReadOnly: toBoolean(env.ECURO_MAPPING_READ_ONLY, true),
    visualMode: toBoolean(env.ECURO_ROBOT_VISUAL_MODE, false),
    vncEnabled: toBoolean(env.ECURO_ROBOT_VNC_ENABLED, false),
    vncHost: String(env.ECURO_ROBOT_VNC_HOST || '127.0.0.1').trim() || '127.0.0.1',
    vncPort: Math.max(1, Number(env.ECURO_ROBOT_VNC_PORT || 6080) || 6080),
    captureIntervalSeconds: Math.max(1, Number(env.ECURO_ROBOT_CAPTURE_INTERVAL_SECONDS || 5) || 5),
    debugCapture: toBoolean(env.ECURO_ROBOT_DEBUG_CAPTURE, false),
    discoveryMode: String(env.ECURO_ROBOT_DISCOVERY_MODE || 'visual').trim().toLowerCase() || 'visual',
    captureNetwork: toBoolean(env.ECURO_ROBOT_CAPTURE_NETWORK, false),
    networkSaveSamples: toBoolean(env.ECURO_ROBOT_NETWORK_SAVE_SAMPLES, true),
    networkMaskSensitive: toBoolean(env.ECURO_ROBOT_NETWORK_MASK_SENSITIVE, true),
    networkWaitMs: Math.max(1000, Number(env.ECURO_ROBOT_NETWORK_WAIT_MS || 6000) || 6000),
    networkMaxResponses: Math.max(10, Number(env.ECURO_ROBOT_NETWORK_MAX_RESPONSES || 80) || 80),
    networkMaxSampleItems: Math.max(1, Number(env.ECURO_ROBOT_NETWORK_MAX_SAMPLE_ITEMS || 3) || 3)
  };
}

function getEcuroRobotConfigStatus(env = process.env) {
  const config = getEcuroRobotConfig(env);
  return {
    mode: config.mode,
    configured: Boolean(
      config.baseUrl
      && config.level1Username
      && config.level1Password
      && config.level2Username
      && config.level2Password
      && config.apiKey
    ),
    browserMode: config.mode === 'browser',
    headless: config.headless,
    dryRun: config.dryRun,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
    profileDir: config.profileDir,
    screenshotDir: config.screenshotDir,
    htmlDir: config.htmlDir,
    debugDir: config.debugDir,
    apiKeyConfigured: Boolean(config.apiKey),
    maxPagesPerRun: config.maxPagesPerRun,
    maxPatientsPerRun: config.maxPatientsPerRun,
    discoverAllClinics: config.discoverAllClinics,
    clinicListScrollEnabled: config.clinicListScrollEnabled,
    maxClinicsPerRun: config.maxClinicsPerRun,
    clinicSelectionMaxAttempts: config.clinicSelectionMaxAttempts,
    clinicSelectionWaitMs: config.clinicSelectionWaitMs,
    npsDateMode: config.npsDateMode,
    npsTimezone: config.npsTimezone,
    includeToday: config.includeToday,
    includeYesterday: config.includeYesterday,
    patientsPageSize: config.patientsPageSize,
    maxPagesPerClinic: config.maxPagesPerClinic,
    maxPatientsPerClinic: config.maxPatientsPerClinic,
    maxTotalPatientsPerRun: config.maxTotalPatientsPerRun,
    stopWhenOlderThanTarget: config.stopWhenOlderThanTarget,
    mappingEnabled: config.mappingEnabled,
    mappingCron: config.mappingCron,
    mappingMaxPages: config.mappingMaxPages,
    mappingMaxDepth: config.mappingMaxDepth,
    mappingCaptureScreenshots: config.mappingCaptureScreenshots,
    mappingCaptureHtml: config.mappingCaptureHtml,
    mappingReadOnly: config.mappingReadOnly,
    visualMode: config.visualMode,
    vncEnabled: config.vncEnabled,
    vncHost: config.vncHost,
    vncPort: config.vncPort,
    captureIntervalSeconds: config.captureIntervalSeconds,
    debugCapture: config.debugCapture,
    discoveryMode: config.discoveryMode,
    captureNetwork: config.captureNetwork,
    networkSaveSamples: config.networkSaveSamples,
    networkMaskSensitive: config.networkMaskSensitive,
    networkWaitMs: config.networkWaitMs,
    networkMaxResponses: config.networkMaxResponses,
    networkMaxSampleItems: config.networkMaxSampleItems
  };
}

function normalizeEcuroCompletionStatus(value) {
  const normalized = normalizeText(value || '');
  if (!normalized) return 'unknown';
  if (['eligible', 'completed', 'concluido', 'concluida', 'atendido', 'atendida', 'compareceu'].some((token) => normalized.includes(token))) return 'completed';
  if (['out_of_date', 'not_completed', 'invalid_phone'].some((token) => normalized.includes(token))) return 'not_completed';
  if (['missing_last_consultation', 'not_found'].some((token) => normalized.includes(token))) return 'not_found';
  if (['duplicate', 'ambiguous', 'ambiguo'].some((token) => normalized.includes(token))) return 'ambiguous';
  if (['clinic_mismatch', 'error', 'manual_action_required'].some((token) => normalized.includes(token))) return 'error';
  return 'unknown';
}

function buildInviteToken(seed = '') {
  return crypto
    .createHash('sha256')
    .update(`${Date.now()}-${seed}-${crypto.randomBytes(8).toString('hex')}`)
    .digest('hex');
}

function buildJobId() {
  return `ecuro-job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildArtifactBaseName(jobId) {
  return `${jobId}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

async function loadPlaywright() {
  const moduleRef = await import('playwright');
  return moduleRef.chromium ? moduleRef : moduleRef.default;
}

class EcuroRobotJobStore {
  constructor() {
    this.jobs = new Map();
    this.runtime = {
      status: 'idle',
      currentJobId: null,
      currentJobType: null,
      currentStep: 'idle',
      currentUrl: '',
      clinicName: '',
      action: 'idle',
      pageProgress: {
        current: 0,
        total: 0
      },
      recordsRead: 0,
      eligibleFound: 0,
      recentEvents: [],
      updatedAt: new Date().toISOString()
    };
  }

  create(payload = {}) {
    const job = {
      id: buildJobId(),
      jobType: payload.jobType || 'check_completed',
      clinicId: payload.clinicId || null,
      clinicName: payload.clinicName || '',
      appointmentDate: payload.appointmentDate || '',
      status: 'pending',
      totalChecked: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalNotCompleted: 0,
      totalAmbiguous: 0,
      totalNotFound: 0,
      totalEligible: 0,
      totalInvalidPhone: 0,
      totalOutOfDate: 0,
      totalDuplicate: 0,
      totalMissingLastConsultation: 0,
      totalClinicMismatch: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      artifacts: [],
      logs: [],
      currentStep: 'pending',
      currentUrl: '',
      action: 'pending',
      pageProgress: {
        current: 0,
        total: 0
      },
      totalRowsRead: 0,
      eligibleFound: 0,
      payload
    };
    this.jobs.set(job.id, job);
    return job;
  }

  update(jobId, patch = {}) {
    const current = this.jobs.get(jobId);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(jobId, next);
    return next;
  }

  get(jobId) {
    return this.jobs.get(jobId) || null;
  }

  list() {
    return Array.from(this.jobs.values())
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  setRuntime(patch = {}) {
    const recentEvents = Array.isArray(patch.recentEvents) ? patch.recentEvents.slice(-25) : this.runtime.recentEvents;
    this.runtime = {
      ...this.runtime,
      ...patch,
      recentEvents,
      updatedAt: new Date().toISOString()
    };
    return this.runtime;
  }

  resetRuntime() {
    return this.setRuntime({
      status: 'idle',
      currentJobId: null,
      currentJobType: null,
      currentStep: 'idle',
      currentUrl: '',
      clinicName: '',
      action: 'idle',
      pageProgress: { current: 0, total: 0 },
      recordsRead: 0,
      eligibleFound: 0
    });
  }

  addLog(jobId, entry = {}) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const nextEntry = {
      id: `${jobId}-log-${job.logs.length + 1}`,
      level: entry.level || 'info',
      step: entry.step || job.currentStep || 'processing',
      message: entry.message || '',
      url: entry.url || job.currentUrl || '',
      metadata: entry.metadata || null,
      createdAt: new Date().toISOString()
    };
    const nextLogs = [...(job.logs || []), nextEntry].slice(-250);
    this.update(jobId, { logs: nextLogs });
    const runtimeEvents = [...(this.runtime.recentEvents || []), {
      jobId,
      jobType: job.jobType,
      ...nextEntry
    }].slice(-25);
    this.setRuntime({
      currentJobId: jobId,
      currentJobType: job.jobType,
      currentStep: nextEntry.step,
      currentUrl: nextEntry.url || this.runtime.currentUrl,
      clinicName: job.clinicName || this.runtime.clinicName,
      action: entry.action || this.runtime.action || nextEntry.step,
      recentEvents: runtimeEvents
    });
    return nextEntry;
  }

  addArtifacts(jobId, artifacts = []) {
    const job = this.jobs.get(jobId);
    if (!job || !Array.isArray(artifacts) || !artifacts.length) return job;
    const currentArtifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
    const nextArtifacts = [...currentArtifacts, ...artifacts.map((artifact, index) => ({
      id: artifact.id || `${jobId}-artifact-${currentArtifacts.length + index + 1}`,
      ...artifact
    }))];
    return this.update(jobId, { artifacts: nextArtifacts });
  }

  getRuntime() {
    return {
      ...this.runtime,
      recentEvents: Array.isArray(this.runtime.recentEvents) ? this.runtime.recentEvents.slice(-25) : []
    };
  }
}

const jobStore = new EcuroRobotJobStore();

function updateRobotJobStep(jobId, patch = {}) {
  const current = jobStore.get(jobId);
  if (!current) return null;
  const next = jobStore.update(jobId, {
    currentStep: patch.currentStep || current.currentStep,
    currentUrl: patch.currentUrl === undefined ? current.currentUrl : patch.currentUrl,
    action: patch.action || current.action,
    pageProgress: patch.pageProgress || current.pageProgress,
    totalRowsRead: patch.totalRowsRead === undefined ? current.totalRowsRead : patch.totalRowsRead,
    eligibleFound: patch.eligibleFound === undefined ? current.eligibleFound : patch.eligibleFound
  });
  jobStore.setRuntime({
    status: patch.status || next.status || 'running',
    currentJobId: jobId,
    currentJobType: next.jobType,
    currentStep: next.currentStep || 'processing',
    currentUrl: next.currentUrl || '',
    clinicName: next.clinicName || '',
    action: next.action || next.currentStep || 'processing',
    pageProgress: next.pageProgress || { current: 0, total: 0 },
    recordsRead: Number(next.totalRowsRead || 0),
    eligibleFound: Number(next.eligibleFound || 0)
  });
  return next;
}

function logRobotJobEvent(jobId, entry = {}) {
  const current = jobStore.get(jobId);
  if (!current) return null;
  if (entry.currentStep || entry.currentUrl || entry.action || entry.pageProgress || entry.totalRowsRead !== undefined || entry.eligibleFound !== undefined) {
    updateRobotJobStep(jobId, {
      currentStep: entry.currentStep,
      currentUrl: entry.currentUrl,
      action: entry.action,
      pageProgress: entry.pageProgress,
      totalRowsRead: entry.totalRowsRead,
      eligibleFound: entry.eligibleFound,
      status: entry.status || current.status || 'running'
    });
  }
  return jobStore.addLog(jobId, entry);
}

function buildManualActionError(message = 'Manual action required in Ecuro.') {
  const error = new Error(message);
  error.code = 'manual_action_required';
  return error;
}

async function saveRobotArtifacts(page, config, jobId, reason = 'error') {
  ensureDir(config.screenshotDir);
  ensureDir(config.htmlDir);
  const baseName = `${buildArtifactBaseName(jobId)}-${reason}`;
  const screenshotPath = path.join(config.screenshotDir, `${baseName}.png`);
  const htmlPath = path.join(config.htmlDir, `${baseName}.html`);
  const artifacts = [];

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    artifacts.push({ id: `${jobId}-${reason}-screenshot`, type: 'screenshot', path: screenshotPath, step: reason, createdAt: new Date().toISOString() });
  } catch (_error) {
    // Ignore artifact persistence issues.
  }

  try {
    fs.writeFileSync(htmlPath, await page.content(), 'utf8');
    artifacts.push({ id: `${jobId}-${reason}-html`, type: 'html', path: htmlPath, step: reason, createdAt: new Date().toISOString() });
  } catch (_error) {
    // Ignore artifact persistence issues.
  }

  return artifacts;
}

function saveRobotDebugArtifacts(config, jobId, reason = 'debug', payload = {}) {
  ensureDir(config.debugDir);
  const baseName = `${buildArtifactBaseName(jobId)}-${reason}`;
  const jsonPath = path.join(config.debugDir, `${baseName}.json`);
  const textPath = path.join(config.debugDir, `${baseName}.txt`);
  const artifacts = [];

  try {
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    artifacts.push({ id: `${jobId}-${reason}-debug-json`, type: 'debug_json', path: jsonPath, step: reason, createdAt: new Date().toISOString() });
  } catch (_error) {
    // Ignore debug persistence issues.
  }

  try {
    const bodyText = String(payload.bodyText || '').trim();
    const candidateRows = Array.isArray(payload.candidateRowTexts) ? payload.candidateRowTexts : [];
    const textPayload = [
      `reason=${reason}`,
      `currentUrl=${payload.currentUrl || ''}`,
      `clinicName=${payload.clinicName || ''}`,
      `targetDate=${payload.targetDate || ''}`,
      `candidateElementsCount=${payload.candidateElementsCount || 0}`,
      '',
      'candidateRowTexts:',
      ...candidateRows.slice(0, 10),
      '',
      'bodyText:',
      bodyText
    ].join('\n');
    fs.writeFileSync(textPath, textPayload, 'utf8');
    artifacts.push({ id: `${jobId}-${reason}-debug-text`, type: 'debug_text', path: textPath, step: reason, createdAt: new Date().toISOString() });
  } catch (_error) {
    // Ignore debug persistence issues.
  }

  return artifacts;
}

async function capturePatientExtractionArtifacts(page, config, jobId, reason = 'debug', diagnostics = {}) {
  const artifacts = await saveRobotArtifacts(page, config, jobId, reason);
  const debugArtifacts = saveRobotDebugArtifacts(config, jobId, reason, diagnostics);
  return [...artifacts, ...debugArtifacts];
}

async function firstVisibleLocator(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1200 })) {
        return { selector, locator };
      }
    } catch (_error) {
      // Keep trying the next selector candidate.
    }
  }
  return null;
}

async function fillFirstVisible(page, selectors, value) {
  const target = await firstVisibleLocator(page, selectors);
  if (!target) return false;
  await target.locator.fill(String(value || ''));
  return true;
}

async function clickFirstVisible(page, selectors) {
  const target = await firstVisibleLocator(page, selectors);
  if (!target) return false;
  await target.locator.click();
  return true;
}

async function hasAnyVisible(page, selectors = []) {
  const target = await firstVisibleLocator(page, selectors);
  return Boolean(target);
}

async function waitForPostSubmit(page) {
  await Promise.race([
    page.waitForLoadState('networkidle').catch(() => null),
    page.waitForTimeout(1800)
  ]);
}

async function isAuthenticated(page, selectors) {
  if (await hasAnyVisible(page, selectors.login.authenticatedIndicators)) {
    return true;
  }

  const loginVisible = await hasAnyVisible(page, [
    ...selectors.login.level1Username,
    ...selectors.login.level1Password,
    ...selectors.login.level2Username,
    ...selectors.login.level2Password
  ]);
  return !loginVisible;
}

async function detectManualActionRequired(page, config) {
  const selectors = config.selectors.login.manualActionIndicators || [];
  if (await hasAnyVisible(page, selectors)) {
    return true;
  }

  const bodyText = normalizeText(await page.locator('body').innerText().catch(() => ''));
  return config.manualActionPattern.test(bodyText);
}

async function performEcuroBrowserLogin(page, config) {
  if (config.mode !== 'browser') {
    throw new Error(`Unsupported Ecuro robot mode: ${config.mode}.`);
  }

  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
  if (await detectManualActionRequired(page, config)) {
    throw buildManualActionError();
  }

  if (await isAuthenticated(page, config.selectors)) {
    return { authenticated: true, reusedSession: true };
  }

  const level1UserFilled = await fillFirstVisible(page, config.selectors.login.level1Username, config.level1Username);
  const level1PassFilled = await fillFirstVisible(page, config.selectors.login.level1Password, config.level1Password);

  if (level1UserFilled || level1PassFilled) {
    await clickFirstVisible(page, config.selectors.login.level1Submit);
    await waitForPostSubmit(page);
  }

  if (await detectManualActionRequired(page, config)) {
    throw buildManualActionError();
  }

  if (!(await isAuthenticated(page, config.selectors))) {
    const level2UserFilled = await fillFirstVisible(page, config.selectors.login.level2Username, config.level2Username);
    const level2PassFilled = await fillFirstVisible(page, config.selectors.login.level2Password, config.level2Password);

    if (level2UserFilled || level2PassFilled) {
      await clickFirstVisible(page, config.selectors.login.level2Submit);
      await waitForPostSubmit(page);
    }
  }

  if (await detectManualActionRequired(page, config)) {
    throw buildManualActionError();
  }

  if (!(await isAuthenticated(page, config.selectors))) {
    throw new Error('Could not confirm Ecuro authentication.');
  }

  return { authenticated: true, reusedSession: false };
}

function getDateKeyInSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateKeyToUtc(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  return new Date(`${dateKey}T12:00:00Z`);
}

function shiftDateKey(dateKey, days = 0) {
  const base = parseDateKeyToUtc(dateKey);
  if (!base) return '';
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

function getYesterdaySaoPauloDateKey(date = new Date()) {
  return shiftDateKey(getDateKeyInSaoPaulo(date), -1);
}

function formatDateKeyToBrazilian(dateKey = '') {
  const normalized = normalizeBrazilianDate(dateKey);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
}

function normalizeBrazilianDate(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-' || raw.toLowerCase() === 'null') return '';

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const brMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (brMatch) {
    const day = String(brMatch[1]).padStart(2, '0');
    const month = String(brMatch[2]).padStart(2, '0');
    const year = String(brMatch[3]).length === 2 ? `20${brMatch[3]}` : brMatch[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return getDateKeyInSaoPaulo(parsed);
  }

  return '';
}

function resolveEcuroTargetDate(payload = {}, now = new Date()) {
  const explicitTargetDate = normalizeBrazilianDate(payload.targetDate || '');
  if (explicitTargetDate) return explicitTargetDate;

  const appointmentDate = normalizeBrazilianDate(payload.appointmentDate || '');
  if (appointmentDate) return appointmentDate;

  const targetDateMode = normalizeText(payload.targetDateMode || '');
  if (!targetDateMode || targetDateMode === 'today') {
    return getDateKeyInSaoPaulo(now);
  }

  if (targetDateMode === 'yesterday') {
    return getYesterdaySaoPauloDateKey(now);
  }

  return getDateKeyInSaoPaulo(now);
}

function getNpsEligibleDates(config = getEcuroRobotConfig(), payload = {}, now = new Date()) {
  const explicitTargetDate = normalizeBrazilianDate(payload.targetDate || payload.target_date || '');
  if (explicitTargetDate) return [explicitTargetDate];

  const explicitDates = Array.isArray(payload.targetDates)
    ? payload.targetDates
    : (Array.isArray(payload.target_dates) ? payload.target_dates : []);
  const normalizedExplicitDates = Array.from(new Set(
    explicitDates
      .map((date) => normalizeBrazilianDate(date))
      .filter(Boolean)
  ));
  if (normalizedExplicitDates.length) return normalizedExplicitDates;

  const dateMode = normalizeText(payload.dateMode || payload.date_mode || config.npsDateMode || 'today');
  const today = getDateKeyInSaoPaulo(now);
  const yesterday = shiftDateKey(today, -1);
  const dates = [];
  const includeOnlyToday = dateMode === 'today';
  const includeOnlyYesterday = dateMode === 'yesterday';

  if ((config.includeToday || includeOnlyToday) && !includeOnlyYesterday) {
    dates.push(today);
  }
  if ((config.includeYesterday || includeOnlyYesterday) && !includeOnlyToday) {
    dates.push(yesterday);
  }

  if (!dates.length) dates.push(today);

  return Array.from(new Set(dates.filter(Boolean)));
}

function formatEligibleDatesForPayload(eligibleDates = []) {
  return eligibleDates.map((date) => formatDateKeyToBrazilian(date)).filter(Boolean);
}

function isEligibleByLastConsultationDate(lastConsultationDate = '', targetDate = '') {
  const normalizedLastConsultationDate = normalizeBrazilianDate(lastConsultationDate || '');
  const normalizedTargetDate = normalizeBrazilianDate(targetDate || '');

  if (!normalizedLastConsultationDate) return 'missing_last_consultation';
  if (!normalizedTargetDate) return 'out_of_date';
  if (normalizedLastConsultationDate === normalizedTargetDate) return 'eligible';
  return 'out_of_date';
}

function isEligibleByLastConsultationDates(lastConsultationDate = '', eligibleDates = []) {
  const normalizedLastConsultationDate = normalizeBrazilianDate(lastConsultationDate || '');
  if (!normalizedLastConsultationDate) return 'missing_last_consultation';
  const normalizedEligibleDates = new Set((eligibleDates || []).map((date) => normalizeBrazilianDate(date)).filter(Boolean));
  if (!normalizedEligibleDates.size) return 'out_of_date';
  return normalizedEligibleDates.has(normalizedLastConsultationDate) ? 'eligible' : 'out_of_date';
}

function normalizeEcuroCellText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const ECURO_NETWORK_ENDPOINT_TERMS = [
  'patient',
  'patients',
  'paciente',
  'pacientes',
  'customer',
  'customers',
  'client',
  'clients',
  'clinic',
  'clinics',
  'clinica',
  'clinicas',
  'unidade',
  'unidades',
  'attendance',
  'attendances',
  'appointment',
  'appointments',
  'consulta',
  'consultas'
];

const ECURO_PATIENT_API_ALIASES = {
  patientFirstName: ['firstName', 'first_name', 'primeiroNome', 'primeiro_nome', 'nome', 'patientFirstName'],
  patientLastName: ['lastName', 'last_name', 'sobrenome', 'patientLastName'],
  patientName: ['patientName', 'patient_name', 'fullName', 'full_name', 'nomeCompleto', 'nome_completo', 'name', 'nome', 'paciente', 'cliente'],
  patientPhone: ['patientPhone', 'patient_phone', 'phone', 'telefone', 'numeroTelefone', 'numero_telefone', 'cellphone', 'cellPhone', 'mobile', 'celular', 'whatsapp', 'numeroDeTelefone'],
  document: ['document', 'documentNumber', 'document_number', 'cpf', 'patientDocument', 'patient_document', 'documento'],
  externalPatientId: ['externalPatientId', 'external_patient_id', 'patientId', 'patient_id', 'idPaciente', 'id_paciente', 'codigoPaciente', 'codigo_paciente', 'id', 'code', 'codigo'],
  clinicCode: ['clinicCode', 'clinic_code', 'clinic', 'unit', 'codigoClinica', 'codigo_clinica', 'unitCode', 'unit_code', 'codigoUnidade', 'codigo_unidade'],
  clinicName: ['clinicName', 'clinic_name', 'clinic', 'unit', 'clinica', 'clínica', 'unidade', 'unitName', 'unit_name', 'nomeClinica', 'nome_clinica'],
  birthDate: ['birthDate', 'birth_date', 'dataNascimento', 'data_nascimento', 'nascimento'],
  registrationDate: ['registrationDate', 'registration_date', 'dataCadastro', 'data_cadastro', 'createdAt', 'created_at', 'cadastro'],
  lastConsultationDate: ['lastConsultationDate', 'last_consultation_date', 'lastConsultation', 'last_consultation', 'lastAppointment', 'last_appointment', 'lastVisit', 'last_visit', 'lastAttendance', 'last_attendance', 'ultimaConsulta', 'ultima_consulta', 'dataUltimaConsulta', 'data_ultima_consulta', 'últimaConsulta', 'última_consulta'],
  nextConsultationDate: ['nextConsultationDate', 'next_consultation_date', 'nextConsultation', 'next_consultation', 'nextAppointment', 'next_appointment', 'nextVisit', 'next_visit', 'proximaConsulta', 'proxima_consulta', 'dataProximaConsulta', 'data_proxima_consulta', 'próximaConsulta', 'próxima_consulta']
};

function normalizeApiFieldKey(value = '') {
  return normalizeText(value || '').replace(/[^a-z0-9]/g, '');
}

function shouldMaskSensitiveKey(key = '') {
  const normalized = normalizeApiFieldKey(key);
  return [
    'authorization',
    'cookie',
    'setcookie',
    'token',
    'accesstoken',
    'refreshtoken',
    'apikey',
    'apiKey',
    'secret',
    'password',
    'senha',
    'credential',
    'credencial'
  ].some((token) => normalized.includes(normalizeApiFieldKey(token)));
}

function maskDocumentValue(value = '') {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return String(value || '');
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
}

function maskPhoneValue(value = '') {
  const digits = onlyDigits(value);
  if (digits.length < 10) return String(value || '');
  return `+${digits.slice(0, 4)}*****${digits.slice(-4)}`;
}

function maskSensitiveString(value = '') {
  const text = String(value || '');
  if (!text) return text;
  if (/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(text)) {
    return text.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, (match) => maskDocumentValue(match));
  }
  if (/\+?\d[\d\s().-]{9,20}/.test(text)) {
    return text.replace(/\+?\d[\d\s().-]{9,20}/g, (match) => maskPhoneValue(match));
  }
  if (/bearer\s+[a-z0-9._-]+/i.test(text)) {
    return text.replace(/bearer\s+[a-z0-9._-]+/ig, 'Bearer ***');
  }
  return text;
}

function maskSensitiveObject(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => maskSensitiveObject(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, child]) => {
      if (shouldMaskSensitiveKey(key)) return [key, '***'];
      const normalizedKey = normalizeApiFieldKey(key);
      if (normalizedKey.includes('cpf') || normalizedKey.includes('document')) return [key, maskDocumentValue(child)];
      if (normalizedKey.includes('phone') || normalizedKey.includes('telefone') || normalizedKey.includes('celular') || normalizedKey.includes('whatsapp')) return [key, maskPhoneValue(child)];
      return [key, maskSensitiveObject(child, depth + 1)];
    }));
  }
  if (typeof value === 'string') return maskSensitiveString(value);
  return value;
}

function sanitizeNetworkHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => (
    shouldMaskSensitiveKey(key) ? [key, '***'] : [key, maskSensitiveString(value)]
  )));
}

function parseNetworkQueryParams(url = '') {
  try {
    const parsed = new URL(url);
    return Object.fromEntries(Array.from(parsed.searchParams.entries()).map(([key, value]) => (
      shouldMaskSensitiveKey(key) ? [key, '***'] : [key, maskSensitiveString(value)]
    )));
  } catch (_error) {
    return {};
  }
}

function isEcuroNetworkCandidateUrl(url = '') {
  const normalizedUrl = normalizeText(url || '');
  return ECURO_NETWORK_ENDPOINT_TERMS.some((term) => normalizedUrl.includes(normalizeText(term)));
}

function collectJsonObjects(value, output = [], depth = 0, maxItems = 3000) {
  if (output.length >= maxItems || depth > 8 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (output.length >= maxItems) break;
      collectJsonObjects(item, output, depth + 1, maxItems);
    }
    return output;
  }
  if (typeof value !== 'object') return output;
  output.push(value);
  for (const child of Object.values(value)) {
    if (output.length >= maxItems) break;
    if (child && typeof child === 'object') collectJsonObjects(child, output, depth + 1, maxItems);
  }
  return output;
}

function collectJsonArrays(value, output = [], pathParts = [], depth = 0) {
  if (depth > 7 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    output.push({ path: pathParts.join('.') || '$', length: value.length, sample: value[0] || null });
    value.slice(0, 5).forEach((item, index) => collectJsonArrays(item, output, [...pathParts, String(index)], depth + 1));
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => collectJsonArrays(child, output, [...pathParts, key], depth + 1));
  }
  return output;
}

function summarizeNetworkResponseShape(value) {
  if (Array.isArray(value)) {
    const sample = value[0];
    return {
      type: 'array',
      length: value.length,
      itemKeys: sample && typeof sample === 'object' && !Array.isArray(sample) ? Object.keys(sample).slice(0, 40) : []
    };
  }
  if (value && typeof value === 'object') {
    const arrays = collectJsonArrays(value).sort((left, right) => right.length - left.length).slice(0, 10);
    return {
      type: 'object',
      keys: Object.keys(value).slice(0, 50),
      arrays: arrays.map((item) => ({
        path: item.path,
        length: item.length,
        sampleKeys: item.sample && typeof item.sample === 'object' && !Array.isArray(item.sample) ? Object.keys(item.sample).slice(0, 30) : []
      }))
    };
  }
  return { type: typeof value };
}

function getAllJsonKeys(value, output = new Set(), depth = 0) {
  if (depth > 6 || value === null || value === undefined || output.size > 300) return output;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item) => getAllJsonKeys(item, output, depth + 1));
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      output.add(key);
      getAllJsonKeys(child, output, depth + 1);
    });
  }
  return output;
}

function aliasMatchesKey(key = '', aliases = []) {
  const normalizedKey = normalizeApiFieldKey(key);
  return aliases.some((alias) => {
    const normalizedAlias = normalizeApiFieldKey(alias);
    return normalizedKey === normalizedAlias || normalizedKey.includes(normalizedAlias);
  });
}

function findDirectValueByAliases(raw = {}, aliases = []) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  for (const [key, value] of Object.entries(raw)) {
    if (aliasMatchesKey(key, aliases) && value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return undefined;
}

function findNestedValueByAliases(raw, aliases = [], depth = 0) {
  if (!raw || typeof raw !== 'object' || depth > 5) return undefined;
  const direct = findDirectValueByAliases(raw, aliases);
  if (direct !== undefined) return direct;
  const children = Array.isArray(raw) ? raw : Object.values(raw);
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const found = findNestedValueByAliases(child, aliases, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function stringifyEcuroApiField(value, preferredAliases = []) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const nested = findDirectValueByAliases(value, preferredAliases)
      ?? findDirectValueByAliases(value, ['name', 'nome', 'label', 'descricao', 'description', 'code', 'codigo', 'id']);
    if (nested !== undefined && nested !== value) return stringifyEcuroApiField(nested, preferredAliases);
    return '';
  }
  return normalizeEcuroCellText(value);
}

function findEcuroPatientApiValue(raw = {}, field = '') {
  const aliases = ECURO_PATIENT_API_ALIASES[field] || [];
  const direct = findDirectValueByAliases(raw, aliases);
  if (direct !== undefined) return direct;
  const nestedAliases = aliases.filter((alias) => !['name', 'nome', 'id', 'code', 'codigo'].includes(normalizeApiFieldKey(alias)));
  return findNestedValueByAliases(raw, nestedAliases);
}

function splitPatientName(fullName = '') {
  const parts = normalizeEcuroCellText(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { patientFirstName: '', patientLastName: '' };
  return {
    patientFirstName: parts[0],
    patientLastName: parts.slice(1).join(' ')
  };
}

function normalizeEcuroPatientFromApi(raw = {}, context = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hasDirectPatientSignal = [
    'patientFirstName',
    'patientLastName',
    'patientName',
    'patientPhone',
    'document',
    'externalPatientId',
    'lastConsultationDate'
  ].some((field) => findDirectValueByAliases(raw, ECURO_PATIENT_API_ALIASES[field] || []) !== undefined);
  if (!hasDirectPatientSignal && Object.values(raw).some((value) => Array.isArray(value))) return null;

  const directFirstName = stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'patientFirstName'));
  const directLastName = stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'patientLastName'));
  const directName = stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'patientName'));
  const nameParts = directName ? splitPatientName(directName) : { patientFirstName: '', patientLastName: '' };
  const patientFirstName = directFirstName || nameParts.patientFirstName;
  const patientLastName = directLastName || nameParts.patientLastName;
  const patientName = [patientFirstName, patientLastName].filter(Boolean).join(' ').trim() || directName;
  const patientPhoneRaw = stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'patientPhone'));
  const normalizedPhone = normalizePhone(patientPhoneRaw || '');
  const clinicName = stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'clinicName'), ['name', 'nome', 'label']) || context.clinicName || '';
  const clinicCode = stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'clinicCode'), ['code', 'codigo', 'id']) || context.clinicCode || '';
  const birthDate = normalizeBrazilianDate(stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'birthDate')));
  const registrationDate = normalizeBrazilianDate(stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'registrationDate')));
  const lastConsultationDate = normalizeBrazilianDate(stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'lastConsultationDate')));
  const nextConsultationDate = normalizeBrazilianDate(stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'nextConsultationDate')));
  const document = stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'document'));
  const externalPatientId = stringifyEcuroApiField(findEcuroPatientApiValue(raw, 'externalPatientId'));

  if (!patientName && !patientPhoneRaw && !document && !externalPatientId && !lastConsultationDate) {
    return null;
  }

  return {
    patientName,
    patientFirstName,
    patientLastName,
    patientPhone: normalizedPhone.valid ? normalizedPhone.normalized : patientPhoneRaw,
    document: document || null,
    externalPatientId: externalPatientId || null,
    clinicCode: clinicCode || null,
    clinicName: clinicName || null,
    birthDate: birthDate || null,
    registrationDate: registrationDate || null,
    lastConsultationDate: lastConsultationDate || null,
    nextConsultationDate: nextConsultationDate || null,
    rawPayloadJson: JSON.stringify(maskSensitiveObject(raw))
  };
}

function evaluateNpsEligibility(patient = {}, targetDate = '', options = {}) {
  const normalizedTargetDate = normalizeBrazilianDate(targetDate);
  const lastConsultationDate = normalizeBrazilianDate(patient.lastConsultationDate || '');
  const normalizedPhone = normalizePhone(patient.patientPhone || '');
  const duplicateKey = [
    patient.clinicCode || patient.clinicName || '',
    patient.externalPatientId || '',
    normalizedPhone.normalized || patient.patientPhone || '',
    lastConsultationDate || ''
  ].map((part) => normalizeText(part)).join('|');

  let eligibilityStatus = 'eligible';
  if (!lastConsultationDate) eligibilityStatus = 'missing_last_consultation';
  else if (normalizedTargetDate && lastConsultationDate !== normalizedTargetDate) eligibilityStatus = 'out_of_date';
  else if (!normalizedPhone.valid) eligibilityStatus = 'invalid_phone';
  else if (!patient.clinicName && !patient.clinicCode) eligibilityStatus = 'parse_error';
  else if (options.seenKeys && options.seenKeys.has(duplicateKey)) eligibilityStatus = 'duplicate';

  if (eligibilityStatus === 'eligible' && options.seenKeys) {
    options.seenKeys.add(duplicateKey);
  }

  return eligibilityStatus;
}

function normalizeNetworkPatientRecord(raw = {}, context = {}) {
  const patient = normalizeEcuroPatientFromApi(raw, context);
  if (!patient) return null;
  const eligibilityStatus = evaluateNpsEligibility(patient, context.targetDate, { seenKeys: context.seenKeys });
  return {
    ...patient,
    eligibilityStatus,
    completionStatus: mapEligibilityToCompletionStatus(eligibilityStatus),
    externalStatus: eligibilityStatus,
    matchedBy: patient.externalPatientId ? 'external_id' : (normalizePhone(patient.patientPhone || '').valid ? 'phone' : 'manual_review'),
    confidenceScore: eligibilityStatus === 'eligible'
      ? 100
      : eligibilityStatus === 'out_of_date'
        ? 92
        : eligibilityStatus === 'invalid_phone'
          ? 88
          : eligibilityStatus === 'missing_last_consultation'
            ? 72
            : 0,
    source: context.source || 'ecuro_network_patients',
    rawPayloadJson: patient.rawPayloadJson || JSON.stringify(maskSensitiveObject(raw))
  };
}

function scoreNetworkResponseCandidate({ url = '', json = null, status = 0, contentType = '' }) {
  const keys = Array.from(getAllJsonKeys(json)).map((key) => normalizeApiFieldKey(key));
  const objects = collectJsonObjects(json, [], 0, 800);
  const patientLikeCount = objects
    .map((item) => normalizeEcuroPatientFromApi(item))
    .filter((item) => item && (item.patientName || item.patientPhone || item.externalPatientId) && (item.lastConsultationDate || item.patientPhone))
    .length;
  const clinicLikeCount = objects.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const label = stringifyEcuroApiField(findNestedValueByAliases(item, ECURO_PATIENT_API_ALIASES.clinicName), ['name', 'nome', 'label']);
    const code = stringifyEcuroApiField(findNestedValueByAliases(item, ECURO_PATIENT_API_ALIASES.clinicCode), ['code', 'codigo', 'id']);
    return Boolean(label && (code || isLikelyClinicName(label)));
  }).length;
  const normalizedUrl = normalizeText(url);
  let confidenceScore = 0;
  if (status >= 200 && status < 300) confidenceScore += 5;
  if (contentType.includes('json')) confidenceScore += 5;
  if (['patient', 'patients', 'paciente', 'pacientes', 'client', 'customer'].some((term) => normalizedUrl.includes(term))) confidenceScore += 25;
  if (['clinic', 'clinics', 'clinica', 'unidade'].some((term) => normalizedUrl.includes(term))) confidenceScore += 12;
  if (patientLikeCount > 0) confidenceScore += Math.min(45, 20 + patientLikeCount);
  if (clinicLikeCount > 0) confidenceScore += Math.min(25, 10 + clinicLikeCount);
  if (keys.some((key) => ['ultimaconsulta', 'dataultimaconsulta', 'lastconsultation', 'lastappointment', 'lastvisit'].includes(key))) confidenceScore += 15;
  if (keys.some((key) => ['telefone', 'phone', 'cellphone', 'whatsapp', 'mobile'].includes(key))) confidenceScore += 10;

  return {
    confidenceScore: Math.min(100, confidenceScore),
    containsPatientLikeData: patientLikeCount > 0,
    containsClinicLikeData: clinicLikeCount > 0,
    patientLikeCount,
    clinicLikeCount,
    detectedFields: keys.slice(0, 120)
  };
}

function safeRequestPayload(request) {
  try {
    if (typeof request.postDataJSON === 'function') return request.postDataJSON();
  } catch (_error) {
    // Fall back to text payload when the request body is not JSON.
  }
  try {
    if (typeof request.postData === 'function') return request.postData();
  } catch (_error) {
    // Ignore optional payload extraction failures.
  }
  return null;
}

function buildNetworkEndpointCandidate(request, response, json, config = getEcuroRobotConfig()) {
  const url = response.url();
  const method = request.method();
  const contentType = String(response.headers()?.['content-type'] || '').toLowerCase();
  const shape = summarizeNetworkResponseShape(json);
  const allKeys = Array.from(getAllJsonKeys(json)).slice(0, 120);
  const sampleObjects = collectJsonObjects(json, [], 0, Number(config.networkMaxSampleItems || 3))
    .filter((item) => item && typeof item === 'object')
    .slice(0, Number(config.networkMaxSampleItems || 3));
  const scoring = scoreNetworkResponseCandidate({ url, json, status: response.status(), contentType });
  const candidate = {
    url,
    method,
    status: response.status(),
    contentType,
    queryParams: parseNetworkQueryParams(url),
    requestPayload: maskSensitiveObject(safeRequestPayload(request)),
    responseShape: shape,
    sampleKeys: allKeys,
    sampleSize: Array.isArray(json) ? json.length : collectJsonObjects(json, [], 0, 2000).length,
    containsPatientLikeData: scoring.containsPatientLikeData,
    containsClinicLikeData: scoring.containsClinicLikeData,
    confidenceScore: scoring.confidenceScore,
    detectedFields: scoring.detectedFields,
    sample: config.networkSaveSamples ? maskSensitiveObject(sampleObjects) : undefined
  };
  Object.defineProperty(candidate, '_rawJson', { value: json, enumerable: false });
  Object.defineProperty(candidate, '_requestHeaders', { value: sanitizeNetworkHeaders(request.headers()), enumerable: false });
  return candidate;
}

function extractPatientsFromNetworkResponses(responses = [], context = {}) {
  const seenKeys = context.seenKeys || new Set();
  const candidates = [];
  const rawObjects = [];

  responses.forEach((response) => {
    const json = response?._rawJson || response?.rawJson || null;
    if (!json) return;
    collectJsonObjects(json, rawObjects, 0, 5000);
  });

  rawObjects.forEach((item) => {
    const record = normalizeNetworkPatientRecord(item, {
      ...context,
      seenKeys
    });
    if (!record) return;
    const hasPatientSignal = Boolean(record.patientName || record.patientPhone || record.externalPatientId || record.document);
    const hasClinicalSignal = Boolean(record.lastConsultationDate || record.nextConsultationDate || record.registrationDate);
    if (!hasPatientSignal || !hasClinicalSignal) return;
    candidates.push(record);
  });

  const unique = [];
  const seenRows = new Set();
  candidates.forEach((row) => {
    const key = [
      row.clinicCode || row.clinicName || '',
      row.externalPatientId || '',
      row.patientPhone || '',
      row.patientName || '',
      row.lastConsultationDate || ''
    ].map((part) => normalizeText(part)).join('|');
    if (seenRows.has(key)) return;
    seenRows.add(key);
    unique.push(row);
  });

  return unique;
}

function isEcuroPaginationSummaryLine(value = '') {
  return /^\s*(itens?|items?)\s*\d+\s*-\s*\d+\s*(de|of)\s*\d+/i.test(String(value || '').trim());
}

function isEcuroDateToken(value = '') {
  return value === '-' || Boolean(normalizeBrazilianDate(value));
}

function isEcuroDocumentToken(value = '') {
  const trimmed = String(value || '').trim();
  return trimmed === '-' || /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(trimmed) || /^\d{11}$/.test(onlyDigits(trimmed));
}

function isEcuroExternalIdToken(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '-') return false;
  return /^[A-Z0-9]{4,8}$/i.test(trimmed);
}

function isEcuroPhoneToken(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '-') return true;
  const digits = onlyDigits(trimmed);
  return /^\+?\d/.test(trimmed) && digits.length >= 10 && digits.length <= 15;
}

function isEcuroHeaderToken(value = '') {
  const normalizedValue = normalizeHeaderLabel(value);
  if (!normalizedValue) return false;
  return ECURO_PATIENT_HEADER_TEXTS.some((label) => normalizedValue === normalizeHeaderLabel(label));
}

function filterEcuroCandidateTokens(tokens = []) {
  return tokens
    .map((token) => normalizeEcuroCellText(token))
    .filter((token) => (
      token
      && !isEcuroHeaderToken(token)
      && !isEcuroPaginationSummaryLine(token)
      && !isLikelyClinicName(token)
      && !['proxima pagina', 'pagina seguinte', 'previous page', 'next page', 'rows per page', 'linhas por pagina'].includes(normalizeText(token))
    ));
}

function repairEcuroCandidateRow(row = []) {
  const cleanedRow = filterEcuroCandidateTokens(row);
  if (cleanedRow.length === ECURO_PATIENT_FIELD_ORDER.length) {
    return cleanedRow;
  }

  if (
    cleanedRow.length === ECURO_PATIENT_FIELD_ORDER.length - 1
    && isEcuroDocumentToken(cleanedRow[2])
    && isEcuroExternalIdToken(cleanedRow[3])
    && isEcuroDateToken(cleanedRow[4])
    && isEcuroDateToken(cleanedRow[5])
    && isEcuroDateToken(cleanedRow[6])
    && isEcuroDateToken(cleanedRow[7])
  ) {
    return [
      cleanedRow[0],
      cleanedRow[1],
      cleanedRow[2],
      cleanedRow[3],
      '-',
      cleanedRow[4],
      cleanedRow[5],
      cleanedRow[6],
      cleanedRow[7]
    ];
  }

  return cleanedRow;
}

function looksLikeEcuroPatientRow(row = []) {
  if (!Array.isArray(row) || row.length !== ECURO_PATIENT_FIELD_ORDER.length) return false;
  if (!row[0] || !row[1]) return false;
  if (!isEcuroDocumentToken(row[2])) return false;
  if (!isEcuroExternalIdToken(row[3])) return false;
  if (!isEcuroPhoneToken(row[4])) return false;
  if (!isEcuroDateToken(row[5])) return false;
  if (!isEcuroDateToken(row[6])) return false;
  if (!isEcuroDateToken(row[7])) return false;
  if (!isEcuroDateToken(row[8])) return false;
  return true;
}

function extractEcuroPatientRowFromTokenWindow(tokens = []) {
  const cleanedTokens = filterEcuroCandidateTokens(tokens);
  const maxOffset = Math.max(0, Math.min(3, cleanedTokens.length - (ECURO_PATIENT_FIELD_ORDER.length - 1)));

  for (let start = 0; start <= maxOffset; start += 1) {
    for (const rowLength of [ECURO_PATIENT_FIELD_ORDER.length, ECURO_PATIENT_FIELD_ORDER.length - 1]) {
      const candidate = repairEcuroCandidateRow(cleanedTokens.slice(start, start + rowLength));
      if (!looksLikeEcuroPatientRow(candidate)) continue;
      return {
        row: candidate,
        start,
        end: start + rowLength - 1
      };
    }
  }

  return null;
}

function buildEcuroPatientTableFromCandidateRows(candidateRows = []) {
  const headers = ECURO_PATIENT_TABLE_COLUMNS.map((column) => column.label);
  const headerIndexes = resolvePatientTableHeaderIndexes(headers);
  const rows = [];
  const seenRows = new Set();

  candidateRows.forEach((candidateRow) => {
    const row = repairEcuroCandidateRow(Array.isArray(candidateRow) ? candidateRow : []);
    if (!looksLikeEcuroPatientRow(row)) return;
    const rowKey = row.join('|');
    if (seenRows.has(rowKey)) return;
    seenRows.add(rowKey);
    rows.push(row);
  });

  return {
    headers,
    headerIndexes,
    rows
  };
}

function parseEcuroPatientRowFromTextLine(line = '') {
  const normalizedLine = normalizeEcuroCellText(line);
  if (!normalizedLine || !/\+?\d{10,15}/.test(normalizedLine)) return null;

  const rowMatch = normalizedLine.match(/^(.*?)\s+(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|-)\s+([A-Z0-9]{4,8})\s+(\+?\d[\d\s().-]{9,20}|-)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|-)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|-)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|-)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|-)\s*$/i);
  if (!rowMatch) return null;

  const nameParts = normalizeEcuroCellText(rowMatch[1]).split(/\s+/).filter(Boolean);
  if (!nameParts.length) return null;
  const patientFirstName = nameParts[0];
  const patientLastName = nameParts.slice(1).join(' ');

  return [
    patientFirstName,
    patientLastName,
    rowMatch[2],
    rowMatch[3],
    normalizeEcuroCellText(rowMatch[4]),
    rowMatch[5],
    rowMatch[6],
    rowMatch[7],
    rowMatch[8]
  ];
}

function extractEcuroPatientRowsFromText(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeEcuroCellText(line))
    .filter(Boolean);

  const lastHeaderIndex = lines.reduce((lastIndex, line, index) => (isEcuroHeaderToken(line) ? index : lastIndex), -1);
  const candidateLines = filterEcuroCandidateTokens(lastHeaderIndex >= 0 ? lines.slice(lastHeaderIndex + 1) : lines);
  const rows = [];
  const rawCandidateRows = [];

  candidateLines.forEach((line) => {
    const parsedLineRow = parseEcuroPatientRowFromTextLine(line);
    if (!parsedLineRow) return;
    rows.push(parsedLineRow);
    rawCandidateRows.push(parsedLineRow.join(' | '));
  });

  for (let index = 0; index < candidateLines.length; index += 1) {
    const match = extractEcuroPatientRowFromTokenWindow(candidateLines.slice(index, index + 14));
    if (!match) continue;
    rows.push(match.row);
    rawCandidateRows.push(match.row.join(' | '));
    index += match.end;
  }

  return {
    rows,
    candidateLines,
    rawCandidateRows
  };
}

function isLikelyClinicName(value = '') {
  const text = String(value || '').trim();
  if (!text || text.length < 10 || text.length > 180) return false;
  return /^[A-Z0-9]{4,}\s*-\s+.+/i.test(text) || text.split('-').length >= 3;
}

function parseEcuroClinicLabel(value = '', index = 0) {
  const fullLabel = normalizeEcuroCellText(value);
  if (!isLikelyClinicName(fullLabel)) return null;
  const parts = fullLabel.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const clinicCode = /^[A-Z0-9]{3,10}$/i.test(parts[0] || '') ? parts[0] : '';
  const clinicName = clinicCode ? parts.slice(1).join(' - ') : fullLabel;

  return {
    clinicCode,
    clinicName: clinicName || fullLabel,
    fullLabel,
    normalizedLabel: normalizeText(fullLabel),
    index,
    visibleText: fullLabel
  };
}

function clinicOptionMatches(candidate = {}, target = {}) {
  const candidateCode = normalizeText(candidate.clinicCode || '');
  const targetCode = normalizeText(target.clinicCode || target.externalClinicId || target.external_clinic_id || '');
  if (candidateCode && targetCode && candidateCode === targetCode) return true;

  const candidateLabel = normalizeText(candidate.fullLabel || candidate.visibleText || candidate.clinicName || '');
  const targetLabel = normalizeText(target.fullLabel || target.visibleText || target.clinicName || target.clinic_name || '');
  if (!candidateLabel || !targetLabel) return false;
  return candidateLabel === targetLabel || candidateLabel.includes(targetLabel) || targetLabel.includes(candidateLabel);
}

async function clickEcuroClinicSelector(page, config) {
  if (await clickFirstVisible(page, config.selectors.navigation.clinicSelector || [])) {
    await page.waitForTimeout(700);
    return true;
  }

  const clicked = await page.evaluate(() => {
    const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], header *, nav *'))
      .filter((element) => isVisible(element))
      .filter((element) => /^[A-Z0-9]{4,}\s*-\s+.+/i.test(textOf(element.innerText || element.textContent)));
    const target = candidates[0];
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);

  if (clicked) {
    await page.waitForTimeout(700);
  }
  return Boolean(clicked);
}

async function collectVisibleEcuroClinicOptions(page) {
  return page.evaluate(() => {
    const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const optionSelectors = [
      '[role="option"]',
      '[role="listbox"] *',
      '.v-overlay *',
      '.v-menu__content *',
      '.mat-mdc-option',
      '.mat-option',
      'li',
      'button',
      '[role="button"]'
    ];
    const labels = [];
    optionSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (!isVisible(element)) return;
        const text = textOf(element.innerText || element.textContent);
        if (/^[A-Z0-9]{4,}\s*-\s+.+/i.test(text)) labels.push(text);
      });
    });
    return Array.from(new Set(labels));
  }).catch(() => []);
}

async function scrollEcuroClinicDropdown(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const containers = Array.from(document.querySelectorAll('[role="listbox"], .v-overlay, .v-menu__content, .cdk-overlay-pane, .mat-mdc-select-panel, body *'))
      .filter((element) => isVisible(element) && element.scrollHeight > element.clientHeight + 20)
      .sort((left, right) => (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight));
    const target = containers[0];
    if (!target) return false;
    const before = target.scrollTop;
    target.scrollTop = Math.min(target.scrollHeight, target.scrollTop + Math.max(180, target.clientHeight * 0.8));
    return target.scrollTop !== before;
  }).catch(() => false);
}

async function discoverEcuroClinics(page, config = getEcuroRobotConfig()) {
  const opened = await clickEcuroClinicSelector(page, config);
  if (!opened) return [];

  const clinicsByKey = new Map();
  const maxScrolls = config.clinicListScrollEnabled ? Math.max(1, Math.min(80, config.maxClinicsPerRun || 200)) : 1;
  let stableScrolls = 0;

  for (let index = 0; index < maxScrolls && clinicsByKey.size < config.maxClinicsPerRun; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const visibleOptions = await collectVisibleEcuroClinicOptions(page);
    const beforeSize = clinicsByKey.size;
    visibleOptions.forEach((label) => {
      const parsed = parseEcuroClinicLabel(label, clinicsByKey.size);
      if (!parsed) return;
      const key = parsed.clinicCode || parsed.normalizedLabel;
      if (!clinicsByKey.has(key)) clinicsByKey.set(key, parsed);
    });

    if (!config.clinicListScrollEnabled) break;
    if (clinicsByKey.size === beforeSize) stableScrolls += 1;
    else stableScrolls = 0;
    if (stableScrolls >= 3) break;

    // eslint-disable-next-line no-await-in-loop
    const moved = await scrollEcuroClinicDropdown(page);
    if (!moved) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
  }

  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(300).catch(() => null);
  return Array.from(clinicsByKey.values()).slice(0, config.maxClinicsPerRun);
}

async function selectEcuroClinic(page, clinic = {}, config = getEcuroRobotConfig()) {
  const attempts = Math.max(1, Number(config.clinicSelectionMaxAttempts || 3) || 3);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clickEcuroClinicSelector(page, config);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);

    const selected = await page.evaluate((targetClinic) => {
      const normalizeValue = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const targetCode = normalizeValue(targetClinic.clinicCode || '');
      const targetLabel = normalizeValue(targetClinic.fullLabel || targetClinic.clinicName || '');
      const options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] *, .v-overlay *, .v-menu__content *, .mat-mdc-option, .mat-option, li, button, [role="button"]'))
        .filter((element) => isVisible(element))
        .map((element) => ({ element, text: textOf(element.innerText || element.textContent) }))
        .filter((item) => /^[A-Z0-9]{4,}\s*-\s+.+/i.test(item.text));
      const match = options.find((item) => {
        const normalized = normalizeValue(item.text);
        return (targetCode && normalized.startsWith(targetCode)) || (targetLabel && (normalized === targetLabel || normalized.includes(targetLabel) || targetLabel.includes(normalized)));
      });
      if (!match) return false;
      match.element.click();
      return true;
    }, clinic).catch(() => false);

    if (selected) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([
        page.waitForLoadState('networkidle').catch(() => null),
        page.waitForTimeout(config.clinicSelectionWaitMs)
      ]);
      // eslint-disable-next-line no-await-in-loop
      const currentClinicName = await extractCurrentClinicName(page, config);
      const parsedCurrent = parseEcuroClinicLabel(currentClinicName);
      if (clinicOptionMatches(parsedCurrent || { fullLabel: currentClinicName }, clinic)) {
        return {
          selected: true,
          attempts: attempt,
          clinicName: currentClinicName || clinic.fullLabel || clinic.clinicName || '',
          clinicCode: clinic.clinicCode || parsedCurrent?.clinicCode || ''
        };
      }
    }

    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape').catch(() => null);
  }

  return {
    selected: false,
    attempts,
    clinicName: await extractCurrentClinicName(page, config).catch(() => ''),
    clinicCode: clinic.clinicCode || ''
  };
}

async function extractCurrentClinicName(page, config) {
  const explicitTarget = await firstVisibleLocator(page, config.selectors.navigation.currentClinic || []);
  if (explicitTarget) {
    const text = String(await explicitTarget.locator.innerText().catch(() => '')).trim();
    if (isLikelyClinicName(text)) return text;
  }

  const text = await page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('header, main, nav')).slice(0, 12);
    const candidates = [];
    roots.forEach((root) => {
      root.querySelectorAll('*').forEach((element) => {
        const value = String(element.innerText || '').trim();
        if (value) candidates.push(value);
      });
    });
    return candidates.find((value) => /^[A-Z0-9]{4,}\s*-\s+.+/i.test(value) || value.split('-').length >= 3) || '';
  }).catch(() => '');

  return String(text || '').trim();
}

function clinicNamesMatch(currentClinicName = '', expectedClinicName = '') {
  const current = normalizeText(currentClinicName);
  const expected = normalizeText(expectedClinicName);
  if (!current || !expected) return false;
  return current === expected || current.includes(expected) || expected.includes(current);
}

async function ensureClinicSelection(page, config, expectedClinicName = '') {
  let currentClinicName = await extractCurrentClinicName(page, config);
  if (!expectedClinicName) {
    return {
      clinicName: currentClinicName || '',
      matched: Boolean(currentClinicName),
      changed: false
    };
  }

  if (clinicNamesMatch(currentClinicName, expectedClinicName)) {
    return {
      clinicName: currentClinicName,
      matched: true,
      changed: false
    };
  }

  let changed = false;
  const filled = await fillFirstVisible(page, config.selectors.navigation.clinicFilter || [], expectedClinicName);
  if (filled) {
    changed = true;
    const target = await firstVisibleLocator(page, config.selectors.navigation.clinicFilter || []);
    if (target) {
      await target.locator.press('Enter').catch(() => null);
      await waitForPostSubmit(page);
    }
  }

  if (!filled && await clickFirstVisible(page, config.selectors.navigation.clinicSelector || [])) {
    changed = true;
    await waitForPostSubmit(page);
    const option = page.getByText(expectedClinicName, { exact: false }).first();
    if (await option.isVisible().catch(() => false)) {
      await option.click().catch(() => null);
      await waitForPostSubmit(page);
    }
  }

  currentClinicName = await extractCurrentClinicName(page, config);
  return {
    clinicName: currentClinicName || expectedClinicName,
    matched: clinicNamesMatch(currentClinicName, expectedClinicName),
    changed
  };
}

async function navigateToCompletionScreen(page, config) {
  const completedPagePath = String(config.selectors.navigation.completedPagePath || '').trim();
  if (completedPagePath) {
    const targetUrl = completedPagePath.startsWith('http')
      ? completedPagePath
      : `${config.baseUrl}${completedPagePath.startsWith('/') ? '' : '/'}${completedPagePath}`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await page.waitForTimeout(1200);
    return;
  }

  if (await clickFirstVisible(page, config.selectors.navigation.patientsMenu || [])) {
    await waitForPostSubmit(page);
  }
}

async function applyFilters(page, config, payload = {}) {
  if (payload.search) {
    await fillFirstVisible(page, config.selectors.navigation.searchField, payload.search);
  }
  if (payload.appointmentDate) {
    await fillFirstVisible(page, config.selectors.navigation.dateFilter, payload.appointmentDate);
  }
  if (await clickFirstVisible(page, config.selectors.navigation.applyFilters || [])) {
    await waitForPostSubmit(page);
  }
}

async function setPatientsPageSize(page, preferredSize = 500) {
  const preferredOrder = Array.from(new Set([
    Number(preferredSize || 0),
    500,
    300,
    200,
    100,
    50
  ].filter((value) => Number(value) > 0)));

  const result = await page.evaluate((sizes) => {
    const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };

    const nativeSelects = Array.from(document.querySelectorAll('select')).filter((element) => isVisible(element));
    for (const select of nativeSelects) {
      const options = Array.from(select.options || [])
        .map((option) => Number(textOf(option.textContent || option.value).match(/\d+/)?.[0] || 0))
        .filter(Boolean);
      const selected = sizes.find((size) => options.includes(size)) || Math.max(0, ...options);
      if (selected) {
        const option = Array.from(select.options || []).find((item) => Number(textOf(item.textContent || item.value).match(/\d+/)?.[0] || 0) === selected);
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            changed: true,
            pageSizeBefore: null,
            pageSizeAfter: selected,
            optionsFound: options
          };
        }
      }
    }

    const clickable = Array.from(document.querySelectorAll('button, [role="button"], [aria-haspopup="listbox"], .v-select, .mat-mdc-select'))
      .filter((element) => isVisible(element))
      .find((element) => /mostrar|itens|items|rows|linhas/i.test(textOf(element.innerText || element.textContent || element.getAttribute('aria-label'))));
    if (clickable) {
      clickable.click();
      return {
        changed: false,
        opened: true,
        pageSizeBefore: textOf(clickable.innerText || clickable.textContent),
        pageSizeAfter: null,
        optionsFound: []
      };
    }

    return {
      changed: false,
      pageSizeBefore: null,
      pageSizeAfter: null,
      optionsFound: []
    };
  }, preferredOrder).catch(() => ({
    changed: false,
    pageSizeBefore: null,
    pageSizeAfter: null,
    optionsFound: []
  }));

  if (result.opened) {
    await page.waitForTimeout(500);
    const selected = await page.evaluate((sizes) => {
      const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const options = Array.from(document.querySelectorAll('[role="option"], .v-list-item, .mat-mdc-option, .mat-option, li, button'))
        .filter((element) => isVisible(element))
        .map((element) => ({
          element,
          value: Number(textOf(element.innerText || element.textContent).match(/^\d+$/)?.[0] || 0)
        }))
        .filter((item) => item.value);
      const values = options.map((item) => item.value);
      const bestValue = sizes.find((size) => values.includes(size)) || Math.max(0, ...values);
      const match = options.find((item) => item.value === bestValue);
      if (!match) return { selected: false, optionsFound: values, pageSizeAfter: null };
      match.element.click();
      return { selected: true, optionsFound: values, pageSizeAfter: bestValue };
    }, preferredOrder).catch(() => ({ selected: false, optionsFound: [], pageSizeAfter: null }));

    if (selected.selected) {
      await waitForPostSubmit(page);
      return {
        changed: true,
        pageSizeBefore: result.pageSizeBefore || null,
        pageSizeAfter: selected.pageSizeAfter || null,
        optionsFound: selected.optionsFound || []
      };
    }
  }

  return result;
}

function normalizeHeaderLabel(value = '') {
  return normalizeText(String(value || '').replace(/\s+/g, ' ').trim());
}

function findHeaderIndex(headers = [], matcherList = []) {
  const normalizedHeaders = headers.map((header) => normalizeHeaderLabel(header));
  for (const matcher of matcherList) {
    const index = normalizedHeaders.findIndex((header) => {
      if (matcher.exact) return header === normalizeHeaderLabel(matcher.exact);
      if (matcher.includes) return header.includes(normalizeHeaderLabel(matcher.includes));
      return false;
    });
    if (index >= 0) return index;
  }
  return -1;
}

function resolvePatientTableHeaderIndexes(headers = []) {
  return Object.fromEntries(
    Object.entries(PATIENT_TABLE_HEADER_MATCHERS).map(([field, matcherList]) => [field, findHeaderIndex(headers, matcherList)])
  );
}

function pickPatientTable(tables = []) {
  const candidates = tables
    .map((table) => ({
      ...table,
      headerIndexes: resolvePatientTableHeaderIndexes(table.headers || [])
    }))
    .filter((table) => (
      table.headerIndexes.patientFirstName >= 0
      && table.headerIndexes.patientLastName >= 0
      && table.headerIndexes.lastConsultationDate >= 0
    ))
    .sort((left, right) => (right.rows?.length || 0) - (left.rows?.length || 0));

  return candidates[0] || null;
}

async function extractPatientTableSnapshot(page, config) {
  const tableSelectors = config.selectors.results.tables || [];
  for (const selector of tableSelectors) {
    const rowCount = await page.locator(selector).count().catch(() => 0);
    if (!rowCount) continue;

    const tables = await page.$$eval(selector, (nodes) => nodes.map((table) => {
      const headerNodes = Array.from(table.querySelectorAll('thead th, thead td'));
      const headers = headerNodes.map((cell) => String(cell.innerText || '').trim()).filter(Boolean);
      const rowNodes = Array.from(table.querySelectorAll('tbody tr'));
      const rows = rowNodes.map((row) => Array.from(row.children).map((cell) => String(cell.innerText || '').trim()));
      return {
        headers,
        rows
      };
    })).catch(() => []);

    const selected = pickPatientTable(tables);
    if (selected) return selected;
  }

  throw new Error('Could not locate the Ecuro patient table.');
}

function chooseBestEcuroPatientTable(candidateTables = []) {
  return candidateTables
    .filter((table) => table && Array.isArray(table.rows) && table.rows.length)
    .sort((left, right) => (right.rows.length - left.rows.length))
    [0] || null;
}

async function waitForEcuroPatientsPageReady(page, config) {
  await page.waitForFunction(() => {
    const bodyText = String(document.body?.innerText || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    return bodyText.includes('PRIMEIRO NOME') && bodyText.includes('ULTIMA CONSULTA');
  }, { timeout: Math.min(config.timeoutMs, 15000) }).catch(() => null);
  await page.waitForTimeout(1000);
}

async function extractPatientsFromEcuroPatientsPage(page, config, payload = {}) {
  await waitForEcuroPatientsPageReady(page, config);

  const diagnostics = await page.evaluate((columnDefinitions) => {
    const headerTexts = columnDefinitions.map((column) => column.label);
    const normalizeTextContent = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizeKey = (value) => normalizeTextContent(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const headerMatchesField = (field, value) => {
      const normalized = normalizeKey(value);
      if (!normalized) return false;
      const matchers = {
        patientFirstName: ['primeiro nome'],
        patientLastName: ['sobrenome'],
        document: ['cpf'],
        externalPatientId: ['id'],
        patientPhone: ['numero de telef', 'telefone', 'whatsapp'],
        birthDate: ['data de nasc'],
        registrationDate: ['data de cadastro'],
        lastConsultationDate: ['ultima consulta'],
        nextConsultationDate: ['proxima consul', 'proxima consulta']
      };
      return (matchers[field] || []).some((token) => normalized.includes(token));
    };
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const hasHeaderHints = (text) => {
      const normalized = normalizeKey(text);
      return normalized.includes('primeiro nome') && normalized.includes('ultima consulta');
    };
    const uniqueRows = (rows) => {
      const seen = new Set();
      return rows.filter((row) => {
        const texts = Array.isArray(row) ? row.map((value) => normalizeTextContent(value)).filter(Boolean) : [];
        if (!texts.length) return false;
        const key = texts.join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const rootCandidates = Array.from(document.querySelectorAll('main, [role="main"], .content, .container, .v-main, body'))
      .filter((element) => isVisible(element))
      .map((element) => ({
        element,
        area: Math.round(element.getBoundingClientRect().width * element.getBoundingClientRect().height),
        text: normalizeTextContent(element.innerText)
      }))
      .filter((item) => hasHeaderHints(item.text))
      .sort((left, right) => left.area - right.area || left.text.length - right.text.length);

    const root = rootCandidates[0]?.element || document.body;
    const rawRootText = String(root?.innerText || document.body?.innerText || '');
    const rootText = normalizeTextContent(rawRootText);
    const currentUrl = window.location.href;

    const discoveredHeaders = Array.from(root.querySelectorAll('th, td, div, span, strong, p, h1, h2, h3'))
      .map((element) => normalizeTextContent(element.innerText))
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .filter((value) => headerTexts.some((label) => normalizeKey(value).includes(normalizeKey(label))))
      .slice(0, 20);

    const semanticRowSelectors = [
      'table tbody tr',
      'table tr',
      '[role="rowgroup"] [role="row"]',
      '[role="grid"] [role="row"]',
      '[role="table"] [role="row"]',
      '.mat-mdc-row',
      '.mat-row',
      '.cdk-row',
      '.v-data-table__tr',
      '.ag-row'
    ];
    const cellSelectors = ['td', '[role="cell"]', '[role="gridcell"]', '.mat-mdc-cell', '.mat-cell', '.v-data-table__td', '.ag-cell'];
    const semanticRows = [];

    semanticRowSelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((row) => {
        if (!isVisible(row)) return;
        let cells = [];
        cellSelectors.forEach((cellSelector) => {
          if (cells.length) return;
          cells = Array.from(row.querySelectorAll(cellSelector));
        });
        if (!cells.length) {
          cells = Array.from(row.children || []);
        }
        const texts = cells
          .map((cell) => normalizeTextContent(cell.innerText))
          .filter((value) => value || value === '-');
        if (texts.length) semanticRows.push(texts);
      });
    });

    const leafElements = Array.from(root.querySelectorAll('td, th, div, span, p, strong, small, a'))
      .filter((element) => isVisible(element))
      .filter((element) => {
        const text = normalizeTextContent(element.innerText);
        if (!text) return false;
        return !Array.from(element.children || []).some((child) => isVisible(child) && normalizeTextContent(child.innerText));
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: normalizeTextContent(element.innerText),
          top: Math.round(rect.top),
          left: Math.round(rect.left)
        };
      });

    const groupedRows = [];
    const sortedLeafElements = leafElements.sort((left, right) => left.top - right.top || left.left - right.left);
    sortedLeafElements.forEach((item) => {
      const previousGroup = groupedRows[groupedRows.length - 1];
      if (previousGroup && Math.abs(previousGroup.top - item.top) <= 6) {
        previousGroup.items.push(item);
        previousGroup.top = Math.min(previousGroup.top, item.top);
        return;
      }
      groupedRows.push({ top: item.top, items: [item] });
    });

    const visualRows = groupedRows
      .map((group) => group.items.sort((left, right) => left.left - right.left).map((item) => item.text))
      .filter((texts) => texts.length);

    const headerCandidates = [];
    Array.from(root.querySelectorAll('th, td, div, span, strong, p'))
      .filter((element) => isVisible(element))
      .forEach((element) => {
        const text = normalizeTextContent(element.innerText || element.textContent);
        if (!text) return;
        const rect = element.getBoundingClientRect();
        columnDefinitions.forEach((column) => {
          if (!headerMatchesField(column.field, text)) return;
          headerCandidates.push({
            field: column.field,
            text,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            centerX: Math.round(rect.left + (rect.width / 2))
          });
        });
      });

    const headersByField = columnDefinitions.reduce((accumulator, column) => {
      const candidates = headerCandidates
        .filter((candidate) => candidate.field === column.field)
        .sort((left, right) => left.top - right.top || left.left - right.left);
      if (candidates[0]) accumulator[column.field] = candidates[0];
      return accumulator;
    }, {});
    const orderedHeaders = columnDefinitions
      .map((column) => headersByField[column.field])
      .filter(Boolean)
      .sort((left, right) => left.centerX - right.centerX);
    const headerBottom = orderedHeaders.length ? Math.max(...orderedHeaders.map((header) => header.bottom)) : 0;
    const columnCenters = columnDefinitions
      .map((column) => headersByField[column.field] ? {
        field: column.field,
        centerX: headersByField[column.field].centerX,
        left: headersByField[column.field].left,
        right: headersByField[column.field].right
      } : null)
      .filter(Boolean)
      .sort((left, right) => left.centerX - right.centerX);
    const columnBoundaries = columnCenters.map((column, index) => {
      const previous = columnCenters[index - 1];
      const next = columnCenters[index + 1];
      return {
        ...column,
        minX: previous ? Math.floor((previous.centerX + column.centerX) / 2) : -Infinity,
        maxX: next ? Math.ceil((next.centerX + column.centerX) / 2) : Infinity
      };
    });
    const assignFieldByX = (centerX) => {
      const bounded = columnBoundaries.find((column) => centerX >= column.minX && centerX < column.maxX);
      if (bounded) return bounded.field;
      const nearest = columnBoundaries
        .slice()
        .sort((left, right) => Math.abs(left.centerX - centerX) - Math.abs(right.centerX - centerX))[0];
      return nearest?.field || '';
    };
    const isNoiseText = (text) => {
      const normalized = normalizeKey(text);
      if (!normalized) return true;
      if (headerTexts.some((label) => headerMatchesField(columnDefinitions.find((column) => normalizeKey(column.label) === normalizeKey(label))?.field, text))) return true;
      if (/^(itens?|items?)\s+\d+\s*-\s*\d+\s*(de|of)\s*\d+/i.test(text)) return true;
      if (normalized.includes('proxima pagina') || normalized.includes('pagina anterior')) return true;
      if (/^[A-Z0-9]{4,}\s*-\s+.+/i.test(text)) return true;
      return false;
    };
    const coordinateElements = Array.from(root.querySelectorAll('td, [role="cell"], [role="gridcell"], div, span, p, strong, small, a'))
      .filter((element) => isVisible(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: normalizeTextContent(element.innerText || element.textContent),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left),
          centerX: Math.round(rect.left + (rect.width / 2)),
          centerY: Math.round(rect.top + (rect.height / 2))
        };
      })
      .filter((item) => item.text && item.centerY > headerBottom - 2 && !isNoiseText(item.text));
    const buildRowFromItems = (items) => {
      const rowByField = {};
      items
        .sort((left, right) => left.left - right.left)
        .forEach((item) => {
          const field = assignFieldByX(item.centerX);
          if (!field) return;
          const current = rowByField[field] || '';
          rowByField[field] = current && current !== item.text ? `${current} ${item.text}` : item.text;
        });
      return columnDefinitions.map((column) => rowByField[column.field] || '');
    };
    const coordinateGroupedRows = [];
    coordinateElements
      .slice()
      .sort((left, right) => left.centerY - right.centerY || left.left - right.left)
      .forEach((item) => {
        const current = coordinateGroupedRows[coordinateGroupedRows.length - 1];
        if (current && Math.abs(current.centerY - item.centerY) <= 14) {
          current.items.push(item);
          current.centerY = Math.round((current.centerY + item.centerY) / 2);
          return;
        }
        coordinateGroupedRows.push({ centerY: item.centerY, items: [item] });
      });
    const coordinateRows = coordinateGroupedRows
      .map((group) => buildRowFromItems(group.items))
      .filter((row) => row.some(Boolean));
    const phoneAnchorRows = coordinateElements
      .filter((item) => /\+?\d[\d\s().-]{9,20}/.test(item.text))
      .map((phoneItem) => buildRowFromItems(coordinateElements.filter((item) => Math.abs(item.centerY - phoneItem.centerY) <= 22)))
      .filter((row) => row.some(Boolean));

    const paginationMatch = rootText.match(/(Itens?\s*\d+\s*-\s*\d+\s*de\s*\d+|Items?\s*\d+\s*-\s*\d+\s*of\s*\d+)/i);
    const clinicNameMatch = rootText.match(/[A-Z0-9]{4,}\s*-\s+.+?\s+-\s+.+?\s+-\s+.+/);
    const domSimplified = leafElements
      .slice(0, 250)
      .map((item) => `${item.top}:${item.left}:${item.text}`)
      .join('\n');

    return {
      currentUrl,
      bodyText: rawRootText,
      headerTexts: discoveredHeaders,
      detectedHeaders: Object.values(headersByField),
      coordinateRows: uniqueRows([...phoneAnchorRows, ...coordinateRows]),
      semanticRows: uniqueRows(semanticRows),
      visualRows: uniqueRows(visualRows),
      candidateElementsCount: leafElements.length,
      clinicNameCandidate: clinicNameMatch ? normalizeTextContent(clinicNameMatch[0]) : '',
      paginationSummary: paginationMatch ? normalizeTextContent(paginationMatch[0]) : '',
      domSimplified,
      rootPreview: rawRootText.split(/\r?\n/).slice(0, 80).map((line) => normalizeTextContent(line)).filter(Boolean).slice(0, 80)
    };
  }, ECURO_PATIENT_TABLE_COLUMNS);

  const textStrategy = extractEcuroPatientRowsFromText(diagnostics.bodyText || '');
  const candidateTables = [
    { strategy: 'headers_coordinates', table: buildEcuroPatientTableFromCandidateRows(diagnostics.coordinateRows || []) },
    { strategy: 'semantic_dom_rows', table: buildEcuroPatientTableFromCandidateRows(diagnostics.semanticRows || []) },
    { strategy: 'visible_text_rows', table: buildEcuroPatientTableFromCandidateRows(diagnostics.visualRows || []) },
    { strategy: 'raw_text_regex', table: buildEcuroPatientTableFromCandidateRows(textStrategy.rows || []) }
  ];

  const fallbackTable = await extractPatientTableSnapshot(page, config).catch(() => null);
  if (fallbackTable) {
    candidateTables.push({
      strategy: 'html_table_fallback',
      table: {
        headers: fallbackTable.headers || ECURO_PATIENT_TABLE_COLUMNS.map((column) => column.label),
        headerIndexes: fallbackTable.headerIndexes || resolvePatientTableHeaderIndexes(fallbackTable.headers || []),
        rows: Array.isArray(fallbackTable.rows) ? fallbackTable.rows : []
      }
    });
  }

  const selectedCandidate = candidateTables
    .filter((candidate) => candidate?.table && Array.isArray(candidate.table.rows) && candidate.table.rows.length)
    .sort((left, right) => right.table.rows.length - left.table.rows.length)[0] || null;
  const table = selectedCandidate?.table || chooseBestEcuroPatientTable(candidateTables.map((candidate) => candidate.table)) || buildEcuroPatientTableFromCandidateRows([]);
  const candidateRowTexts = [
    ...(diagnostics.coordinateRows || []).map((row) => row.join(' | ')),
    ...(diagnostics.semanticRows || []).map((row) => row.join(' | ')),
    ...(diagnostics.visualRows || []).map((row) => row.join(' | ')),
    ...(textStrategy.rawCandidateRows || [])
  ].slice(0, 10);

  return {
    table,
    diagnostics: {
      ...diagnostics,
      targetDate: formatDateKeyToBrazilian(resolveEcuroTargetDate(payload)),
      extractionStrategyUsed: selectedCandidate?.strategy || 'none',
      detectedHeaders: diagnostics.detectedHeaders || [],
      textStrategyCandidateLines: (textStrategy.candidateLines || []).slice(0, 40),
      textStrategyRows: (textStrategy.rows || []).slice(0, 10),
      coordinateRowCount: Array.isArray(diagnostics.coordinateRows) ? diagnostics.coordinateRows.length : 0,
      semanticRowCount: Array.isArray(diagnostics.semanticRows) ? diagnostics.semanticRows.length : 0,
      visualRowCount: Array.isArray(diagnostics.visualRows) ? diagnostics.visualRows.length : 0,
      textRowCount: Array.isArray(textStrategy.rows) ? textStrategy.rows.length : 0,
      extractedRowCount: Array.isArray(table.rows) ? table.rows.length : 0,
      candidateRowTexts
    }
  };
}

function safeRowValue(row = [], index = -1) {
  if (!Array.isArray(row) || index < 0 || index >= row.length) return '';
  return String(row[index] || '').trim();
}

function mapEligibilityToCompletionStatus(eligibilityStatus = '') {
  return ELIGIBILITY_TO_COMPLETION_STATUS[eligibilityStatus] || 'error';
}

function buildPatientDirectoryRecord(row = [], context = {}) {
  const headerIndexes = context.headerIndexes || {};
  const patientFirstName = safeRowValue(row, headerIndexes.patientFirstName);
  const patientLastName = safeRowValue(row, headerIndexes.patientLastName);
  const patientName = [patientFirstName, patientLastName].filter(Boolean).join(' ').trim();
  const document = safeRowValue(row, headerIndexes.document);
  const externalPatientId = safeRowValue(row, headerIndexes.externalPatientId);
  const patientPhoneRaw = safeRowValue(row, headerIndexes.patientPhone);
  const birthDate = normalizeBrazilianDate(safeRowValue(row, headerIndexes.birthDate));
  const registrationDate = normalizeBrazilianDate(safeRowValue(row, headerIndexes.registrationDate));
  const lastConsultationDate = normalizeBrazilianDate(safeRowValue(row, headerIndexes.lastConsultationDate));
  const nextConsultationDate = normalizeBrazilianDate(safeRowValue(row, headerIndexes.nextConsultationDate));
  const normalizedPhone = normalizePhone(patientPhoneRaw || '');

  if (!patientName && !document && !externalPatientId && !patientPhoneRaw && !lastConsultationDate && !nextConsultationDate) {
    return null;
  }

  let eligibilityStatus = Array.isArray(context.eligibleDates) && context.eligibleDates.length
    ? isEligibleByLastConsultationDates(lastConsultationDate, context.eligibleDates)
    : isEligibleByLastConsultationDate(lastConsultationDate, context.targetDate);
  if (context.forceClinicMismatch) {
    eligibilityStatus = 'clinic_mismatch';
  } else if (!normalizedPhone.valid) {
    eligibilityStatus = 'invalid_phone';
  }

  const record = {
    patientName,
    patientFirstName,
    patientLastName,
    patientPhone: normalizedPhone.valid ? normalizedPhone.normalized : patientPhoneRaw,
    document: document || null,
    externalPatientId: externalPatientId || null,
    clinicCode: context.clinicCode || null,
    clinicName: context.clinicName || null,
    birthDate: birthDate || null,
    registrationDate: registrationDate || null,
    lastConsultationDate: lastConsultationDate || null,
    nextConsultationDate: nextConsultationDate || null,
    eligibilityStatus,
    completionStatus: mapEligibilityToCompletionStatus(eligibilityStatus),
    externalStatus: eligibilityStatus,
    matchedBy: externalPatientId ? 'external_id' : (normalizedPhone.valid ? 'phone' : 'manual_review'),
    confidenceScore: eligibilityStatus === 'eligible'
      ? 100
      : eligibilityStatus === 'out_of_date'
        ? 92
        : eligibilityStatus === 'invalid_phone'
          ? 88
          : eligibilityStatus === 'missing_last_consultation'
            ? 72
            : 0,
    source: context.source || 'ecuro_last_consultation'
  };

  record.rawPayloadJson = JSON.stringify({
    patientFirstName,
    patientLastName,
    patientName,
    patientPhone: patientPhoneRaw || null,
    document: document || null,
    externalPatientId: externalPatientId || null,
    clinicCode: context.clinicCode || null,
    clinicName: context.clinicName || null,
    birthDate: birthDate || null,
    registrationDate: registrationDate || null,
    lastConsultationDate: lastConsultationDate || null,
    nextConsultationDate: nextConsultationDate || null,
    eligibilityStatus,
    source: context.source || 'ecuro_last_consultation',
    rawCells: row
  });

  return record;
}

function mapPatientDirectoryRows(table = {}, context = {}) {
  const rows = Array.isArray(table.rows) ? table.rows : [];
  return rows
    .map((row) => buildPatientDirectoryRecord(row, { ...context, headerIndexes: table.headerIndexes || context.headerIndexes || {} }))
    .filter(Boolean);
}

function summarizeCompletionResults(results = []) {
  return results.reduce((summary, row) => {
    const eligibilityStatus = String(row.eligibilityStatus || '').trim().toLowerCase();
    const completionStatus = String(row.completionStatus || '').trim().toLowerCase();

    summary.totalChecked += 1;
    if (eligibilityStatus === 'eligible' || completionStatus === 'completed') {
      summary.totalEligible += 1;
      summary.totalCompleted += 1;
    }
    if (eligibilityStatus === 'invalid_phone') {
      summary.totalInvalidPhone += 1;
      summary.totalNotCompleted += 1;
    }
    if (eligibilityStatus === 'out_of_date') {
      summary.totalOutOfDate += 1;
      summary.totalNotCompleted += 1;
    }
    if (eligibilityStatus === 'duplicate') {
      summary.totalDuplicate += 1;
      summary.totalAmbiguous += 1;
    }
    if (eligibilityStatus === 'missing_last_consultation' || completionStatus === 'not_found') {
      summary.totalMissingLastConsultation += 1;
      summary.totalNotFound += 1;
    }
    if (eligibilityStatus === 'clinic_mismatch') {
      summary.totalClinicMismatch += 1;
      summary.totalFailed += 1;
    }
    if (!eligibilityStatus && completionStatus === 'not_completed') {
      summary.totalNotCompleted += 1;
    }
    if (completionStatus === 'ambiguous' && eligibilityStatus !== 'duplicate') {
      summary.totalAmbiguous += 1;
    }
    if (completionStatus === 'error' && eligibilityStatus !== 'clinic_mismatch') {
      summary.totalFailed += 1;
    }

    return summary;
  }, {
    totalChecked: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalNotCompleted: 0,
    totalNotFound: 0,
    totalAmbiguous: 0,
    totalEligible: 0,
    totalInvalidPhone: 0,
    totalOutOfDate: 0,
    totalDuplicate: 0,
    totalMissingLastConsultation: 0,
    totalClinicMismatch: 0
  });
}

async function clickNextPatientsPage(page, config) {
  for (const selector of config.selectors.navigation.nextPage || []) {
    const locator = page.locator(selector).first();
    try {
      if (!(await locator.isVisible({ timeout: 800 }))) continue;
      if (!(await locator.isEnabled().catch(() => true))) continue;
      const disabled = await locator.getAttribute('disabled').catch(() => null);
      const ariaDisabled = await locator.getAttribute('aria-disabled').catch(() => null);
      if (disabled !== null || String(ariaDisabled || '').toLowerCase() === 'true') continue;
      await locator.click();
      await waitForPostSubmit(page);
      return true;
    } catch (_error) {
      // Try next selector.
    }
  }
  return false;
}

function shouldStopWhenOlderThanTarget(pageResults = [], targetDate = '') {
  const datedRows = pageResults
    .map((row) => row.lastConsultationDate || '')
    .filter(Boolean);

  if (!datedRows.length) return false;
  if (datedRows.some((dateKey) => dateKey === targetDate)) return false;
  return datedRows.every((dateKey) => dateKey < targetDate);
}

function shouldStopWhenOlderThanEligibleDates(pageResults = [], eligibleDates = []) {
  const normalizedDates = (eligibleDates || []).map((date) => normalizeBrazilianDate(date)).filter(Boolean).sort();
  const oldestEligibleDate = normalizedDates[0] || '';
  if (!oldestEligibleDate) return false;
  return shouldStopWhenOlderThanTarget(pageResults, oldestEligibleDate);
}

async function collectPatientDirectoryRows(page, config, payload = {}) {
  const targetDate = resolveEcuroTargetDate(payload);
  const eligibleDates = getNpsEligibleDates(config, payload);
  const expectedClinicName = String(payload.externalClinicName || payload.clinicName || '').trim();
  const clinicSelection = await ensureClinicSelection(page, config, expectedClinicName);
  const clinicName = clinicSelection.clinicName || expectedClinicName || '';
  const parsedClinic = parseEcuroClinicLabel(clinicName);
  const clinicCode = payload.clinicCode || parsedClinic?.clinicCode || '';
  const results = [];
  let pagesVisited = 0;
  let totalRowsRead = 0;
  const maxPages = Math.max(1, Number(payload.maxPagesPerClinic || config.maxPagesPerClinic || config.maxPagesPerRun || 1) || 1);
  const maxPatients = Math.max(1, Number(payload.maxPatientsPerClinic || config.maxPatientsPerClinic || config.maxPatientsPerRun || 1000) || 1000);
  const pageSize = await setPatientsPageSize(page, Number(payload.pageSize || config.patientsPageSize || 500) || 500).catch(() => ({
    changed: false,
    pageSizeBefore: null,
    pageSizeAfter: null,
    optionsFound: []
  }));
  let diagnostics = {
    currentUrl: page.url(),
    clinicName,
    clinicCode,
    targetDate: formatDateKeyToBrazilian(targetDate),
    eligibleDates: formatEligibleDatesForPayload(eligibleDates),
    pageSize,
    candidateElementsCount: 0,
    candidateRowTexts: []
  };

  if (payload.search) {
    await applyFilters(page, config, { search: payload.search, appointmentDate: payload.appointmentDate });
  }

  if (expectedClinicName && !clinicSelection.matched) {
    return {
      clinicName,
      clinicMatched: false,
      targetDate,
      pagesVisited: 0,
      totalRowsRead: 0,
      diagnostics: {
        ...diagnostics,
        clinicName,
        clinicCode,
        clinicMatched: false
      },
      results: [{
        patientName: '',
        patientFirstName: '',
        patientLastName: '',
        patientPhone: '',
        document: null,
        externalPatientId: null,
        clinicCode,
        clinicName,
        birthDate: null,
        registrationDate: null,
        lastConsultationDate: null,
        nextConsultationDate: null,
        eligibilityStatus: 'clinic_mismatch',
        completionStatus: 'error',
        externalStatus: 'clinic_mismatch',
        matchedBy: 'manual_review',
        confidenceScore: 0,
        source: payload.source || 'ecuro_last_consultation',
        rawPayloadJson: JSON.stringify({
          expectedClinicName,
          detectedClinicName: clinicName,
          eligibilityStatus: 'clinic_mismatch',
          source: payload.source || 'ecuro_last_consultation'
        })
      }]
    };
  }

  while (pagesVisited < maxPages && results.length < maxPatients) {
    const extractedPage = await extractPatientsFromEcuroPatientsPage(page, config, payload);
    const table = extractedPage.table || buildEcuroPatientTableFromCandidateRows([]);
    const pageResults = mapPatientDirectoryRows(table, {
      headerIndexes: table.headerIndexes,
      clinicCode,
      clinicName,
      targetDate,
      eligibleDates,
      source: payload.source || 'ecuro_last_consultation'
    });
    diagnostics = {
      ...diagnostics,
      ...(extractedPage.diagnostics || {}),
      clinicName,
      clinicCode,
      targetDate: formatDateKeyToBrazilian(targetDate),
      eligibleDates: formatEligibleDatesForPayload(eligibleDates),
      pageSize
    };

    totalRowsRead += pageResults.length;
    for (const item of pageResults) {
      if (results.length >= maxPatients) break;
      results.push(item);
    }

    pagesVisited += 1;
    if (results.length >= maxPatients) break;
    if (config.stopWhenOlderThanTarget && shouldStopWhenOlderThanEligibleDates(pageResults, eligibleDates)) break;

    const moved = await clickNextPatientsPage(page, config);
    if (!moved) break;
  }

  return {
    clinicName,
    clinicCode,
    clinicMatched: clinicSelection.matched,
    targetDate,
    eligibleDates,
    pageSize,
    pagesVisited,
    totalRowsRead,
    diagnostics,
    results
  };
}

function selectBestNetworkEndpoint(candidates = [], type = 'patient') {
  const scored = candidates
    .filter((candidate) => type === 'clinic' ? candidate.containsClinicLikeData : candidate.containsPatientLikeData)
    .slice()
    .sort((left, right) => Number(right.confidenceScore || 0) - Number(left.confidenceScore || 0));
  return scored[0]?.url || '';
}

function buildNetworkDiscoverySummary(candidates = []) {
  const patientEndpoints = candidates
    .filter((candidate) => candidate.containsPatientLikeData)
    .sort((left, right) => Number(right.confidenceScore || 0) - Number(left.confidenceScore || 0));
  const clinicEndpoints = candidates
    .filter((candidate) => candidate.containsClinicLikeData)
    .sort((left, right) => Number(right.confidenceScore || 0) - Number(left.confidenceScore || 0));
  const detectedFields = Array.from(new Set(
    candidates.flatMap((candidate) => Array.isArray(candidate.detectedFields) ? candidate.detectedFields : [])
  )).slice(0, 200);
  const confidenceScore = Math.max(0, ...candidates.map((candidate) => Number(candidate.confidenceScore || 0)));

  return {
    patientEndpoints,
    clinicEndpoints,
    candidateResponses: candidates,
    selectedPatientEndpoint: selectBestNetworkEndpoint(candidates, 'patient'),
    selectedClinicEndpoint: selectBestNetworkEndpoint(candidates, 'clinic'),
    detectedFields,
    confidenceScore
  };
}

async function discoverEcuroNetworkEndpoints(page, config = getEcuroRobotConfig(), payload = {}) {
  const candidateResponses = [];
  const capturedRequests = [];
  const pendingCaptures = [];
  const maxResponses = Number(config.networkMaxResponses || 80);

  const captureResponse = async (response) => {
    if (candidateResponses.length >= maxResponses) return;
    const request = response.request();
    const resourceType = request.resourceType();
    if (!['xhr', 'fetch'].includes(resourceType)) return;
    const url = response.url();
    const contentType = String(response.headers()?.['content-type'] || '').toLowerCase();
    if (!contentType.includes('json')) return;
    if (!isEcuroNetworkCandidateUrl(url)) return;

    try {
      const json = await response.json();
      const candidate = buildNetworkEndpointCandidate(request, response, json, config);
      if (candidate.confidenceScore > 0 || candidate.containsPatientLikeData || candidate.containsClinicLikeData) {
        candidateResponses.push(candidate);
      }
    } catch (_error) {
      // Some XHRs are JSON-like but not parseable; ignore and keep listening.
    }
  };

  page.on('request', (request) => {
    try {
      if (capturedRequests.length >= maxResponses) return;
      if (!['xhr', 'fetch'].includes(request.resourceType())) return;
      const url = request.url();
      if (!isEcuroNetworkCandidateUrl(url)) return;
      capturedRequests.push({
        url,
        method: request.method(),
        queryParams: parseNetworkQueryParams(url),
        headers: sanitizeNetworkHeaders(request.headers()),
        requestPayload: maskSensitiveObject(safeRequestPayload(request))
      });
    } catch (_error) {
      // Request diagnostics are best-effort only.
    }
  });

  page.on('response', (response) => {
    const pending = captureResponse(response);
    pendingCaptures.push(pending);
  });

  const destination = String(config.selectors.navigation.completedPagePath || `${config.baseUrl}/dashboard/patients`).trim();
  const targetUrl = destination.startsWith('http')
    ? destination
    : `${config.baseUrl}${destination.startsWith('/') ? '' : '/'}${destination}`;

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
  await Promise.race([
    page.waitForLoadState('networkidle').catch(() => null),
    page.waitForTimeout(Number(config.networkWaitMs || 6000))
  ]);
  await waitForEcuroPatientsPageReady(page, config).catch(() => null);

  // Opening the clinic selector often triggers the endpoint that feeds available units.
  if (config.captureNetwork || payload.captureClinics !== false) {
    await clickEcuroClinicSelector(page, config).catch(() => false);
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape').catch(() => null);
  }

  await page.waitForTimeout(Math.min(2500, Number(config.networkWaitMs || 6000)));
  await Promise.allSettled(pendingCaptures);

  const uniqueCandidates = Array.from(new Map(
    candidateResponses
      .sort((left, right) => Number(right.confidenceScore || 0) - Number(left.confidenceScore || 0))
      .map((candidate) => [`${candidate.method}:${candidate.url}`, candidate])
  ).values()).slice(0, maxResponses);

  return {
    ...buildNetworkDiscoverySummary(uniqueCandidates),
    capturedRequests: capturedRequests.slice(0, 40),
    requestCount: capturedRequests.length
  };
}

async function tryFetchSelectedNetworkEndpoint(page, endpointUrl = '', config = getEcuroRobotConfig()) {
  if (!endpointUrl) return null;
  try {
    const result = await page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json'
        }
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('json')) {
        return { ok: response.ok, status: response.status, contentType, json: null };
      }
      return {
        ok: response.ok,
        status: response.status,
        contentType,
        json: await response.json()
      };
    }, endpointUrl);

    if (!result?.json) return result;
    const request = {
      method: () => 'GET',
      resourceType: () => 'fetch',
      headers: () => ({}),
      postData: () => null
    };
    const response = {
      url: () => endpointUrl,
      status: () => result.status,
      headers: () => ({ 'content-type': result.contentType || 'application/json' }),
      request: () => request
    };
    return {
      ...result,
      candidate: buildNetworkEndpointCandidate(request, response, result.json, config)
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

function buildNetworkJobTotals(results = []) {
  const summary = summarizeCompletionResults(results);
  return {
    totalRead: summary.totalChecked,
    totalChecked: summary.totalChecked,
    totalEligible: summary.totalEligible,
    totalCompleted: summary.totalCompleted,
    totalOutOfDate: summary.totalOutOfDate,
    totalInvalidPhone: summary.totalInvalidPhone,
    totalDuplicate: summary.totalDuplicate,
    totalMissingLastConsultation: summary.totalMissingLastConsultation,
    totalFailed: summary.totalFailed,
    totalNotFound: summary.totalNotFound,
    totalAmbiguous: summary.totalAmbiguous
  };
}

async function executeBrowserNetworkDiscovery(job, payload = {}, config = getEcuroRobotConfig()) {
  const playwright = await loadPlaywright();
  ensureDir(config.profileDir);
  const context = await playwright.chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    userAgent: config.userAgent || undefined
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);

  try {
    logRobotJobEvent(job.id, { level: 'info', step: 'login', action: 'login', currentStep: 'login', message: 'Login do robo Ecuro iniciado para descoberta Network.' });
    await performEcuroBrowserLogin(page, config);
    logRobotJobEvent(job.id, { level: 'info', step: 'network_discovery', action: 'capturing', currentStep: 'network_discovery', message: 'Capturando requisicoes XHR/Fetch da tela de pacientes.' });
    const discovery = await discoverEcuroNetworkEndpoints(page, config, payload);
    const artifacts = config.debugCapture || config.captureNetwork
      ? await capturePatientExtractionArtifacts(page, config, job.id, 'network-discovery', {
        currentUrl: page.url(),
        discovery: maskSensitiveObject(discovery),
        bodyText: await page.locator('body').innerText().catch(() => ''),
        candidateRowTexts: (discovery.candidateResponses || []).slice(0, 10).map((candidate) => `${candidate.method} ${candidate.status} ${candidate.url} score=${candidate.confidenceScore}`)
      })
      : [];
    if (artifacts.length) jobStore.addArtifacts(job.id, artifacts);

    logRobotJobEvent(job.id, {
      level: discovery.selectedPatientEndpoint ? 'info' : 'warning',
      step: 'network_discovery',
      action: 'completed',
      currentStep: 'network_discovery',
      currentUrl: page.url(),
      totalRowsRead: Number(discovery.candidateResponses?.length || 0),
      eligibleFound: Number(discovery.patientEndpoints?.length || 0),
      message: `Descoberta Network concluida com ${discovery.candidateResponses?.length || 0} respostas candidatas.`
    });

    return {
      status: discovery.selectedPatientEndpoint ? 'completed' : 'partial',
      discovery,
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      currentUrl: page.url(),
      errorMessage: discovery.selectedPatientEndpoint ? null : 'Robo autenticou no Ecuro, mas nao identificou endpoint de pacientes via Network.'
    };
  } catch (error) {
    const artifacts = await saveRobotArtifacts(page, config, job.id, error.code || 'network-discovery-error');
    if (artifacts.length) jobStore.addArtifacts(job.id, artifacts);
    return {
      status: error.code === 'manual_action_required' ? 'manual_action_required' : 'failed',
      discovery: buildNetworkDiscoverySummary([]),
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      currentUrl: page.url(),
      errorMessage: error.message
    };
  } finally {
    await context.close().catch(() => null);
  }
}

async function executeBrowserNetworkCompletionCheck(job, payload = {}, config = getEcuroRobotConfig()) {
  const playwright = await loadPlaywright();
  ensureDir(config.profileDir);
  const context = await playwright.chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    userAgent: config.userAgent || undefined
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);

  try {
    const targetDate = resolveEcuroTargetDate(payload);
    logRobotJobEvent(job.id, { level: 'info', step: 'login', action: 'login', currentStep: 'login', message: 'Login do robo Ecuro iniciado para coleta Network.' });
    await performEcuroBrowserLogin(page, config);
    logRobotJobEvent(job.id, { level: 'info', step: 'network_collect', action: 'capturing', currentStep: 'network_collect', message: 'Capturando endpoints e respostas JSON da tela de pacientes.' });
    const discovery = await discoverEcuroNetworkEndpoints(page, config, payload);
    const directFetch = await tryFetchSelectedNetworkEndpoint(page, discovery.selectedPatientEndpoint, config);
    const responseSources = directFetch?.candidate
      ? [directFetch.candidate, ...(discovery.candidateResponses || [])]
      : (discovery.candidateResponses || []);
    const capturedClinicName = await extractCurrentClinicName(page, config).catch(() => payload.clinicName || '');
    const parsedClinic = parseEcuroClinicLabel(capturedClinicName);
    const extractedRows = extractPatientsFromNetworkResponses(responseSources, {
      targetDate,
      clinicName: payload.clinicName || capturedClinicName || '',
      clinicCode: payload.clinicCode || parsedClinic?.clinicCode || '',
      source: payload.source || 'ecuro_network_patients'
    });
    const matchedResults = Array.isArray(payload.patients) && payload.patients.length
      ? matchCompletionRows(payload.patients || [], extractedRows)
      : matchCompletionRows([], extractedRows);
    const totals = buildNetworkJobTotals(matchedResults);
    const artifacts = config.debugCapture || config.captureNetwork || !extractedRows.length
      ? await capturePatientExtractionArtifacts(page, config, job.id, !extractedRows.length ? 'network-empty-extraction' : 'network-debug-capture', {
        currentUrl: page.url(),
        clinicName: capturedClinicName || '',
        targetDate: formatDateKeyToBrazilian(targetDate),
        discovery: maskSensitiveObject(discovery),
        directFetch: maskSensitiveObject(directFetch),
        candidateRowTexts: extractedRows.slice(0, 10).map((row) => `${row.patientName || ''} | ${row.patientPhone || ''} | ${formatDateKeyToBrazilian(row.lastConsultationDate || '')} | ${row.eligibilityStatus || ''}`),
        bodyText: await page.locator('body').innerText().catch(() => '')
      })
      : [];
    if (artifacts.length) jobStore.addArtifacts(job.id, artifacts);

    const status = !discovery.selectedPatientEndpoint || !extractedRows.length ? 'partial' : 'completed';
    const errorMessage = !discovery.selectedPatientEndpoint
      ? 'Robo autenticou no Ecuro, mas nao identificou endpoint de pacientes via Network.'
      : !extractedRows.length
        ? 'Robo autenticou no Ecuro e capturou endpoints, mas nao extraiu pacientes do JSON.'
        : null;

    logRobotJobEvent(job.id, {
      level: status === 'completed' ? 'info' : 'warning',
      step: 'network_collect',
      action: 'completed',
      currentStep: 'network_collect',
      currentUrl: page.url(),
      totalRowsRead: totals.totalRead,
      eligibleFound: totals.totalEligible,
      message: `Coleta Network concluida com ${totals.totalRead} pacientes lidos e ${totals.totalEligible} elegiveis.`
    });

    return {
      status,
      extractionMode: 'network',
      targetDate,
      extractedRows,
      results: matchedResults,
      discovery,
      selectedPatientEndpoint: discovery.selectedPatientEndpoint || '',
      selectedClinicEndpoint: discovery.selectedClinicEndpoint || '',
      capturedClinicName,
      directFetchStatus: directFetch ? {
        ok: Boolean(directFetch.ok),
        status: directFetch.status || 0,
        error: directFetch.error || null
      } : null,
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      currentUrl: page.url(),
      errorMessage,
      ...totals
    };
  } catch (error) {
    const artifacts = await saveRobotArtifacts(page, config, job.id, error.code || 'network-error');
    if (artifacts.length) jobStore.addArtifacts(job.id, artifacts);
    return {
      status: error.code === 'manual_action_required' ? 'manual_action_required' : 'failed',
      extractionMode: 'network',
      targetDate: resolveEcuroTargetDate(payload),
      extractedRows: [],
      results: [],
      discovery: buildNetworkDiscoverySummary([]),
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      currentUrl: page.url(),
      errorMessage: error.message
    };
  } finally {
    await context.close().catch(() => null);
  }
}

function resolveEcuroSameOriginUrl(baseUrl = '', href = '') {
  const raw = String(href || '').trim();
  if (!raw || raw.startsWith('javascript:') || raw.startsWith('#')) return '';
  try {
    const resolved = new URL(raw, baseUrl);
    const base = new URL(baseUrl);
    if (resolved.origin !== base.origin) return '';
    return resolved.toString();
  } catch (_error) {
    return '';
  }
}

function isWriteActionLabel(value = '') {
  const normalized = normalizeText(value || '');
  if (!normalized) return false;
  return ['salvar', 'editar', 'excluir', 'cancelar', 'confirmar', 'enviar', 'atualizar', 'remover', 'deletar', 'criar', 'gravar'].some((token) => normalized.includes(token));
}

function inferMappedPageType(snapshot = {}) {
  if (Array.isArray(snapshot.tableHeaders) && snapshot.tableHeaders.length) return 'table';
  if (snapshot.hasExportButton) return 'report';
  if (Array.isArray(snapshot.filters) && snapshot.filters.length) return 'filterable_view';
  if (Array.isArray(snapshot.buttons) && snapshot.buttons.length) return 'action_panel';
  return 'page';
}

async function captureMappingArtifacts(page, config, jobId, step, slug = '') {
  const artifacts = [];
  const safeSlug = String(slug || step || 'page').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  if (config.mappingCaptureScreenshots) {
    ensureDir(config.screenshotDir);
    const screenshotPath = path.join(config.screenshotDir, `${buildArtifactBaseName(jobId)}-${safeSlug}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
    if (fs.existsSync(screenshotPath)) {
      artifacts.push({ id: `${jobId}-${safeSlug}-screenshot`, type: 'screenshot', path: screenshotPath, step, createdAt: new Date().toISOString() });
    }
  }
  if (config.mappingCaptureHtml) {
    ensureDir(config.htmlDir);
    const htmlPath = path.join(config.htmlDir, `${buildArtifactBaseName(jobId)}-${safeSlug}.html`);
    fs.writeFileSync(htmlPath, await page.content(), 'utf8');
    if (fs.existsSync(htmlPath)) {
      artifacts.push({ id: `${jobId}-${safeSlug}-html`, type: 'html', path: htmlPath, step, createdAt: new Date().toISOString() });
    }
  }
  return artifacts;
}

async function extractMappingPageSnapshot(page, config, context = {}) {
  const currentUrl = page.url();
  const baseUrl = config.baseUrl;
  const payload = await page.evaluate(() => {
    const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const title = textOf(document.title);
    const headers = Array.from(document.querySelectorAll('thead th, thead td'))
      .map((cell) => textOf(cell.innerText))
      .filter(Boolean)
      .slice(0, 30);
    const filters = Array.from(document.querySelectorAll('input, select, textarea'))
      .map((field) => textOf(field.getAttribute('placeholder')) || textOf(field.getAttribute('name')) || textOf(field.getAttribute('aria-label')))
      .filter(Boolean)
      .slice(0, 30);
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .map((button) => textOf(button.innerText || button.getAttribute('aria-label') || button.getAttribute('title')))
      .filter(Boolean)
      .slice(0, 40);
    const routes = Array.from(document.querySelectorAll('a[href]'))
      .map((link) => ({
        href: String(link.getAttribute('href') || '').trim(),
        label: textOf(link.innerText || link.getAttribute('aria-label') || link.getAttribute('title'))
      }))
      .filter((link) => link.href)
      .slice(0, 200);
    const headline = textOf(document.querySelector('main h1, main h2, h1, h2')?.innerText);
    return {
      title,
      headline,
      headers,
      filters,
      buttons,
      routes
    };
  });

  const normalizedRoutes = Array.from(new Map(
    (payload.routes || [])
      .map((route) => ({
        url: resolveEcuroSameOriginUrl(baseUrl, route.href),
        label: String(route.label || '').trim() || 'Rota interna'
      }))
      .filter((route) => route.url)
      .map((route) => [route.url, route])
  ).values());
  const buttons = (payload.buttons || []).slice(0, 30);
  const filters = (payload.filters || []).slice(0, 30);
  const tableHeaders = (payload.headers || []).slice(0, 30);
  const hasExportButton = buttons.some((label) => ['exportar', 'download', 'csv', 'xlsx', 'excel', 'pdf'].some((token) => normalizeText(label).includes(token)));
  const hasDateFilter = filters.some((label) => ['data', 'periodo', 'período'].some((token) => normalizeText(label).includes(normalizeText(token))));
  const hasClinicFilter = filters.some((label) => ['clinica', 'clínica', 'unidade'].some((token) => normalizeText(label).includes(normalizeText(token))));
  const riskLevel = buttons.some((label) => isWriteActionLabel(label)) ? 'write_action' : 'read_only';

  return {
    url: currentUrl,
    title: payload.title || payload.headline || currentUrl,
    menuLabel: context.menuLabel || payload.headline || payload.title || 'Tela Ecuro',
    pageType: inferMappedPageType({ tableHeaders, buttons, filters, hasExportButton }),
    tableHeaders,
    filters,
    buttons,
    routes: normalizedRoutes,
    hasExportButton,
    hasDateFilter,
    hasClinicFilter,
    riskLevel,
    capturedAt: new Date().toISOString()
  };
}

async function executeBrowserMappingJob(job, payload = {}, config = getEcuroRobotConfig()) {
  const playwright = await loadPlaywright();
  const maxPages = Math.max(1, Number(payload.maxPages || config.mappingMaxPages || 10) || 10);
  const maxDepth = Math.max(1, Number(payload.maxDepth || config.mappingMaxDepth || 3) || 3);
  ensureDir(config.profileDir);
  const context = await playwright.chromium.launchPersistentContext(config.profileDir, {
    headless: !config.visualMode,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    userAgent: config.userAgent || undefined
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);

  try {
    logRobotJobEvent(job.id, { level: 'info', step: 'login', action: 'login', message: 'Login do mapeamento iniciado.' });
    await performEcuroBrowserLogin(page, config);
    logRobotJobEvent(job.id, { level: 'info', step: 'login', action: 'authenticated', message: 'Login do mapeamento concluído.', currentUrl: page.url() });

    const startUrl = resolveEcuroSameOriginUrl(config.baseUrl, payload.startUrl || config.selectors.navigation.completedPagePath || `${config.baseUrl}/dashboard/patients`) || `${config.baseUrl}/dashboard/patients`;
    const queue = [{ url: startUrl, depth: 0, menuLabel: 'Pacientes' }];
    const visited = new Set();
    const pages = [];
    const discoveredRoutes = new Set();
    let totalErrors = 0;

    while (queue.length && pages.length < maxPages) {
      const current = queue.shift();
      if (!current?.url || visited.has(current.url)) continue;
      visited.add(current.url);
      discoveredRoutes.add(current.url);

      logRobotJobEvent(job.id, {
        level: 'info',
        step: 'mapping_page',
        action: 'navigating',
        currentStep: 'mapping_page',
        currentUrl: current.url,
        pageProgress: { current: pages.length + 1, total: maxPages },
        message: `Mapeando ${current.url}`
      });

      await page.goto(current.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
      await page.waitForTimeout(1200);

      if (await detectManualActionRequired(page, config)) {
        throw buildManualActionError();
      }

      const snapshot = await extractMappingPageSnapshot(page, config, current);
      const artifacts = await captureMappingArtifacts(page, config, job.id, 'mapping_page', `${pages.length + 1}-${current.depth}`);
      if (artifacts.length) {
        jobStore.addArtifacts(job.id, artifacts);
      }
      const screenshotArtifact = artifacts.find((artifact) => artifact.type === 'screenshot');
      const htmlArtifact = artifacts.find((artifact) => artifact.type === 'html');
      pages.push({
        ...snapshot,
        screenshotPath: screenshotArtifact?.path || null,
        htmlPath: htmlArtifact?.path || null,
        depth: current.depth
      });
      updateRobotJobStep(job.id, {
        currentStep: 'mapping_page',
        currentUrl: current.url,
        action: 'capturing',
        pageProgress: { current: pages.length, total: maxPages },
        totalRowsRead: pages.length,
        eligibleFound: 0,
        status: 'running'
      });
      logRobotJobEvent(job.id, {
        level: snapshot.riskLevel === 'write_action' ? 'warning' : 'info',
        step: 'mapping_page',
        action: 'captured',
        currentUrl: current.url,
        message: `Tela mapeada com ${snapshot.tableHeaders.length} colunas e ${snapshot.routes.length} rotas internas.`,
        metadata: {
          title: snapshot.title,
          pageType: snapshot.pageType,
          riskLevel: snapshot.riskLevel
        }
      });

      if (current.depth >= maxDepth) {
        continue;
      }

      snapshot.routes.forEach((route) => {
        if (!route?.url || visited.has(route.url) || queue.some((item) => item.url === route.url)) return;
        discoveredRoutes.add(route.url);
        queue.push({
          url: route.url,
          depth: current.depth + 1,
          menuLabel: route.label || snapshot.menuLabel || 'Rota interna'
        });
      });
    }

    return {
      status: 'completed',
      pages,
      totalPages: pages.length,
      totalRoutes: discoveredRoutes.size,
      totalErrors,
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      clinicName: await extractCurrentClinicName(page, config).catch(() => payload.clinicName || ''),
      currentUrl: page.url()
    };
  } catch (error) {
    const artifacts = await saveRobotArtifacts(page, config, job.id, error.code || 'mapping-error');
    if (artifacts.length) {
      jobStore.addArtifacts(job.id, artifacts);
    }
    if (error.code === 'manual_action_required') {
      return {
        status: 'manual_action_required',
        pages: [],
        totalPages: 0,
        totalRoutes: 0,
        totalErrors: 1,
        artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
        errorMessage: error.message
      };
    }
    return {
      status: 'failed',
      pages: [],
      totalPages: 0,
      totalRoutes: 0,
      totalErrors: 1,
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      errorMessage: error.message
    };
  } finally {
    await context.close().catch(() => null);
  }
}

function buildMatchCandidates(patient = {}) {
  return {
    externalPatientId: String(patient.externalPatientId || patient.external_patient_id || '').trim().toLowerCase(),
    phone: normalizePhone(patient.patientPhone || patient.patient_phone || '').normalized,
    name: normalizeText(patient.patientName || patient.patient_name || ''),
    appointmentDate: normalizeBrazilianDate(patient.appointmentDate || patient.appointment_date || patient.lastConsultationDate || patient.last_consultation_date || ''),
    appointmentTime: String(patient.appointmentTime || patient.appointment_time || '').trim()
  };
}

function scoreExtractedMatch(patient, extracted) {
  const candidate = buildMatchCandidates(patient);
  const extractedPhone = normalizePhone(extracted.patientPhone || '').normalized;
  const extractedName = normalizeText(extracted.patientName || '');
  const extractedExternalId = String(extracted.externalPatientId || '').trim().toLowerCase();
  const extractedDate = normalizeBrazilianDate(extracted.lastConsultationDate || extracted.appointmentDate || '');
  const extractedTime = String(extracted.appointmentTime || '').trim();

  let score = 0;
  let matchedBy = 'manual_review';

  if (candidate.externalPatientId && extractedExternalId && candidate.externalPatientId === extractedExternalId) {
    score = 100;
    matchedBy = 'external_id';
  } else if (candidate.phone && extractedPhone && candidate.phone === extractedPhone) {
    score = 99;
    matchedBy = 'phone';
  } else if (candidate.name && extractedName && candidate.name === extractedName) {
    score = 92;
    matchedBy = 'name_date';
  }

  if (candidate.appointmentDate && extractedDate && candidate.appointmentDate === extractedDate) {
    score += 4;
  }

  if (candidate.appointmentTime && extractedTime && candidate.appointmentTime === extractedTime) {
    score += 3;
  }

  return {
    score,
    matchedBy
  };
}

function matchCompletionRows(patients = [], extractedRows = []) {
  if (!Array.isArray(patients) || !patients.length) {
    return extractedRows.map((row) => ({
      patientName: row.patientName,
      patientFirstName: row.patientFirstName || '',
      patientLastName: row.patientLastName || '',
      patientPhone: row.patientPhone,
      document: row.document || null,
      clinicName: row.clinicName || '',
      appointmentDate: row.lastConsultationDate || row.appointmentDate || '',
      lastConsultationDate: row.lastConsultationDate || row.appointmentDate || '',
      nextConsultationDate: row.nextConsultationDate || '',
      appointmentTime: row.appointmentTime || '',
      externalPatientId: row.externalPatientId || '',
      externalStatus: row.externalStatus || row.eligibilityStatus || '',
      completionStatus: row.completionStatus || mapEligibilityToCompletionStatus(row.eligibilityStatus),
      eligibilityStatus: row.eligibilityStatus || '',
      matchedBy: row.matchedBy || (row.externalPatientId ? 'external_id' : (normalizePhone(row.patientPhone || '').valid ? 'phone' : 'manual_review')),
      confidenceScore: row.confidenceScore ?? (row.eligibilityStatus === 'eligible' ? 100 : 70),
      source: row.source || 'ecuro_last_consultation',
      rawPayloadJson: row.rawPayloadJson || JSON.stringify(row)
    }));
  }

  return patients.map((patient) => {
    const matches = extractedRows
      .map((row) => ({
        row,
        ...scoreExtractedMatch(patient, row)
      }))
      .filter((match) => match.score >= 92)
      .sort((left, right) => right.score - left.score);

    if (!matches.length) {
      return {
        patientName: patient.patientName || patient.patient_name || '',
        patientPhone: patient.patientPhone || patient.patient_phone || '',
        clinicName: patient.clinicName || patient.clinic_name || '',
        appointmentDate: patient.appointmentDate || patient.appointment_date || '',
        appointmentTime: patient.appointmentTime || patient.appointment_time || '',
        externalPatientId: patient.externalPatientId || patient.external_patient_id || '',
        externalStatus: '',
        completionStatus: 'not_found',
        eligibilityStatus: 'missing_last_consultation',
        matchedBy: 'manual_review',
        confidenceScore: 0,
        source: 'ecuro_last_consultation',
        rawPayloadJson: JSON.stringify({ patient, extractedRows: [] })
      };
    }

    if (matches.length > 1 && matches[0].score === matches[1].score) {
      return {
        patientName: patient.patientName || patient.patient_name || '',
        patientPhone: patient.patientPhone || patient.patient_phone || '',
        clinicName: patient.clinicName || patient.clinic_name || '',
        appointmentDate: patient.appointmentDate || patient.appointment_date || '',
        appointmentTime: patient.appointmentTime || patient.appointment_time || '',
        externalPatientId: patient.externalPatientId || patient.external_patient_id || '',
        externalStatus: matches[0].row.externalStatus || '',
        completionStatus: 'ambiguous',
        eligibilityStatus: 'duplicate',
        matchedBy: 'manual_review',
        confidenceScore: matches[0].score,
        source: 'ecuro_last_consultation',
        rawPayloadJson: JSON.stringify({ patient, candidates: matches.map((item) => item.row) })
      };
    }

    const best = matches[0];
    const normalizedStatus = normalizeEcuroCompletionStatus(best.row.externalStatus || best.row.eligibilityStatus || '');
    return {
      patientName: patient.patientName || patient.patient_name || best.row.patientName || '',
      patientPhone: patient.patientPhone || patient.patient_phone || best.row.patientPhone || '',
      clinicName: patient.clinicName || patient.clinic_name || best.row.clinicName || '',
      appointmentDate: patient.appointmentDate || patient.appointment_date || best.row.lastConsultationDate || best.row.appointmentDate || '',
      appointmentTime: patient.appointmentTime || patient.appointment_time || best.row.appointmentTime || '',
      externalPatientId: best.row.externalPatientId || patient.externalPatientId || patient.external_patient_id || '',
      externalStatus: best.row.externalStatus || best.row.eligibilityStatus || '',
      completionStatus: best.row.completionStatus || (normalizedStatus !== 'unknown' ? normalizedStatus : mapEligibilityToCompletionStatus(best.row.eligibilityStatus)),
      eligibilityStatus: best.row.eligibilityStatus || '',
      matchedBy: best.matchedBy,
      confidenceScore: best.score,
      source: best.row.source || 'ecuro_last_consultation',
      rawPayloadJson: best.row.rawPayloadJson || JSON.stringify(best.row)
    };
  });
}

async function executeBrowserCompletionCheck(job, payload = {}, config = getEcuroRobotConfig()) {
  const playwright = await loadPlaywright();
  ensureDir(config.profileDir);
  const context = await playwright.chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    userAgent: config.userAgent || undefined
  });

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);

  try {
    logRobotJobEvent(job.id, { level: 'info', step: 'login', action: 'login', currentStep: 'login', message: 'Login do robô Ecuro iniciado.' });
    await performEcuroBrowserLogin(page, config);
    logRobotJobEvent(job.id, { level: 'info', step: 'login', action: 'authenticated', currentStep: 'authenticated', currentUrl: page.url(), message: 'Login do robô Ecuro concluído.' });
    logRobotJobEvent(job.id, { level: 'info', step: 'navigate_patients', action: 'navigating', currentStep: 'navigate_patients', message: 'Navegando para a tela de pacientes do Ecuro.' });
    await navigateToCompletionScreen(page, config);
    logRobotJobEvent(job.id, { level: 'info', step: 'collect_patients', action: 'collecting', currentStep: 'collect_patients', currentUrl: page.url(), message: 'Lendo a tabela de pacientes para montar a elegibilidade NPS.' });
    const collection = await collectPatientDirectoryRows(page, config, payload);
    const extractedRows = collection.results || [];
    const shouldCaptureDiagnostics = Boolean(config.debugCapture || !extractedRows.length);
    if (shouldCaptureDiagnostics) {
      const artifacts = await capturePatientExtractionArtifacts(page, config, job.id, !extractedRows.length ? 'empty-extraction' : 'debug-capture', {
        ...(collection.diagnostics || {}),
        currentUrl: page.url(),
        clinicName: collection.clinicName || payload.clinicName || '',
        targetDate: formatDateKeyToBrazilian(collection.targetDate || resolveEcuroTargetDate(payload)),
        candidateRowTexts: Array.isArray(collection.diagnostics?.candidateRowTexts) ? collection.diagnostics.candidateRowTexts : [],
        bodyText: collection.diagnostics?.bodyText || ''
      });
      if (artifacts.length) {
        jobStore.addArtifacts(job.id, artifacts);
      }
    }
    logRobotJobEvent(job.id, {
      level: collection.clinicMatched === false ? 'warning' : 'info',
      step: 'collect_patients',
      action: 'collected',
      currentStep: 'collect_patients',
      currentUrl: page.url(),
      pageProgress: { current: Number(collection.pagesVisited || 0), total: Number(config.maxPagesPerRun || 0) },
      totalRowsRead: Number(collection.totalRowsRead || 0),
      eligibleFound: extractedRows.filter((row) => row.eligibilityStatus === 'eligible').length,
      message: `Tabela lida com ${collection.totalRowsRead || 0} registros e ${extractedRows.filter((row) => row.eligibilityStatus === 'eligible').length} elegíveis.`,
      metadata: {
        clinicName: collection.clinicName || '',
        clinicMatched: collection.clinicMatched !== false,
        targetDate: collection.targetDate || ''
      }
    });
    let collectionErrorMessage = null;
    if (!extractedRows.length) {
      collectionErrorMessage = 'Robo autenticou no Ecuro, mas nao conseguiu extrair linhas da tabela de pacientes. Verifique seletores/estrutura DOM.';
      logRobotJobEvent(job.id, {
        level: 'warning',
        step: 'collect_patients',
        action: 'empty_extraction',
        currentStep: 'collect_patients',
        currentUrl: page.url(),
        totalRowsRead: Number(collection.totalRowsRead || 0),
        eligibleFound: 0,
        message: collectionErrorMessage,
        metadata: {
          clinicName: collection.clinicName || '',
          targetDate: collection.targetDate || '',
          candidateElementsCount: Number(collection.diagnostics?.candidateElementsCount || 0)
        }
      });
    }
    const matchedResults = Array.isArray(payload.patients) && payload.patients.length
      ? matchCompletionRows(payload.patients || [], extractedRows)
      : matchCompletionRows([], extractedRows);
    const summary = summarizeCompletionResults(matchedResults);
    logRobotJobEvent(job.id, {
      level: 'info',
      step: 'finalize',
      action: 'completed',
      currentStep: 'finalize',
      currentUrl: page.url(),
      totalRowsRead: Number(collection.totalRowsRead || 0),
      eligibleFound: Number(summary.totalEligible || 0),
      message: `Processamento concluído com ${summary.totalEligible || 0} elegíveis e ${summary.totalFailed || 0} falhas.`
    });
    return {
      status: collection.clinicMatched === false || !extractedRows.length ? 'partial' : 'completed',
      extractedRows,
      results: matchedResults,
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      pagesVisited: collection.pagesVisited || 0,
      totalRowsRead: collection.totalRowsRead || 0,
      totalRead: collection.totalRowsRead || 0,
      targetDate: collection.targetDate || getDateKeyInSaoPaulo(),
      clinicName: collection.clinicName || payload.clinicName || '',
      capturedClinicName: collection.clinicName || payload.clinicName || '',
      detectedHeaders: collection.diagnostics?.detectedHeaders || collection.diagnostics?.headerTexts || [],
      extractionStrategyUsed: collection.diagnostics?.extractionStrategyUsed || 'none',
      diagnostics: collection.diagnostics || null,
      errorMessage: collectionErrorMessage
    };
  } catch (error) {
    const artifacts = await saveRobotArtifacts(page, config, job.id, error.code || 'error');
    if (artifacts.length) {
      jobStore.addArtifacts(job.id, artifacts);
    }
    logRobotJobEvent(job.id, {
      level: 'error',
      step: error.code === 'manual_action_required' ? 'manual_action_required' : 'error',
      action: 'failed',
      currentStep: error.code === 'manual_action_required' ? 'manual_action_required' : 'error',
      currentUrl: page.url(),
      message: error.message
    });
    if (error.code === 'manual_action_required') {
      return {
        status: 'manual_action_required',
        extractedRows: [],
        results: [],
        artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
        errorMessage: error.message
      };
    }

    return {
      status: 'failed',
      extractedRows: [],
      results: Array.isArray(payload.patients)
        ? payload.patients.map((patient) => ({
          patientName: patient.patientName || patient.patient_name || '',
          patientPhone: patient.patientPhone || patient.patient_phone || '',
          clinicName: patient.clinicName || patient.clinic_name || '',
          appointmentDate: patient.appointmentDate || patient.appointment_date || '',
          appointmentTime: patient.appointmentTime || patient.appointment_time || '',
          externalPatientId: patient.externalPatientId || patient.external_patient_id || '',
          externalStatus: 'error',
          completionStatus: 'error',
          eligibilityStatus: 'error',
          matchedBy: 'manual_review',
          confidenceScore: 0,
          source: 'ecuro_last_consultation',
          rawPayloadJson: JSON.stringify({ reason: error.message })
        }))
        : [],
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      errorMessage: error.message
    };
  } finally {
    await context.close().catch(() => null);
  }
}

function buildClinicRunSummary(clinic = {}, patch = {}) {
  return {
    clinicCode: clinic.clinicCode || '',
    clinicName: clinic.clinicName || '',
    fullLabel: clinic.fullLabel || clinic.visibleText || clinic.clinicName || '',
    status: patch.status || 'pending',
    totalRead: Number(patch.totalRead || 0),
    totalEligible: Number(patch.totalEligible || 0),
    totalOutOfDate: Number(patch.totalOutOfDate || 0),
    totalInvalidPhone: Number(patch.totalInvalidPhone || 0),
    totalDuplicate: Number(patch.totalDuplicate || 0),
    totalMissingLastConsultation: Number(patch.totalMissingLastConsultation || 0),
    totalSent: Number(patch.totalSent || 0),
    totalFailed: Number(patch.totalFailed || 0),
    pageSizeUsed: patch.pageSizeUsed || null,
    pagesRead: Number(patch.pagesRead || 0),
    errorMessage: patch.errorMessage || null
  };
}

function summarizeClinicResults(results = []) {
  const summary = summarizeCompletionResults(results);
  return {
    totalRead: summary.totalChecked,
    totalEligible: summary.totalEligible,
    totalOutOfDate: summary.totalOutOfDate,
    totalInvalidPhone: summary.totalInvalidPhone,
    totalDuplicate: summary.totalDuplicate,
    totalMissingLastConsultation: summary.totalMissingLastConsultation,
    totalFailed: summary.totalFailed,
    totalSent: 0
  };
}

function markDuplicateEcuroPatients(results = [], seenKeys = new Set()) {
  return results.map((row) => {
    const duplicateKey = [
      row.clinicCode || row.clinicName || '',
      row.externalPatientId || '',
      normalizePhone(row.patientPhone || '').normalized || row.patientPhone || '',
      row.lastConsultationDate || ''
    ].map((part) => normalizeText(part)).join('|');

    if (!duplicateKey.replace(/\|/g, '')) return row;
    if (seenKeys.has(duplicateKey)) {
      return {
        ...row,
        eligibilityStatus: 'duplicate',
        completionStatus: 'ambiguous',
        externalStatus: 'duplicate',
        confidenceScore: Math.min(Number(row.confidenceScore || 0), 80)
      };
    }
    seenKeys.add(duplicateKey);
    return row;
  });
}

async function executeBrowserAllClinicsNpsAutomation(job, payload = {}, config = getEcuroRobotConfig()) {
  const playwright = await loadPlaywright();
  ensureDir(config.profileDir);
  const context = await playwright.chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    userAgent: config.userAgent || undefined
  });

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);

  const source = 'ecuro_all_clinics_last_consultation';
  const eligibleDates = getNpsEligibleDates(config, payload);
  const eligibleDateLabels = formatEligibleDatesForPayload(eligibleDates);
  const startedAt = new Date().toISOString();
  const clinics = [];
  const results = [];
  const extractedRows = [];
  const seenDuplicateKeys = new Set();
  let discoveredClinics = [];
  let totalRead = 0;
  let totalFailed = 0;
  let capturedClinicName = '';
  let detectedHeaders = [];
  let extractionStrategyUsed = 'none';

  try {
    logRobotJobEvent(job.id, { level: 'info', step: 'login', action: 'login', currentStep: 'login', message: 'Login do robo Ecuro iniciado para varredura multi-clinicas.' });
    await performEcuroBrowserLogin(page, config);
    logRobotJobEvent(job.id, { level: 'info', step: 'login', action: 'authenticated', currentStep: 'authenticated', currentUrl: page.url(), message: 'Login do robo Ecuro concluido.' });

    await navigateToCompletionScreen(page, config);
    await waitForEcuroPatientsPageReady(page, config);
    logRobotJobEvent(job.id, {
      level: 'info',
      step: 'discover_clinics',
      action: 'discovering',
      currentStep: 'discover_clinics',
      currentUrl: page.url(),
      message: 'Descobrindo clinicas disponiveis no seletor superior.'
    });

    discoveredClinics = await discoverEcuroClinics(page, config);
    const filteredClinics = discoveredClinics.filter((clinic) => {
      if (payload.clinicCode && normalizeText(clinic.clinicCode) !== normalizeText(payload.clinicCode)) return false;
      if (payload.clinicName && !clinicOptionMatches(clinic, { clinicName: payload.clinicName })) return false;
      return true;
    });
    const maxClinics = Math.max(1, Number(payload.maxClinics || payload.max_clinics || config.maxClinicsPerRun || 1) || 1);
    const clinicsToProcess = (filteredClinics.length ? filteredClinics : discoveredClinics).slice(0, maxClinics);

    if (!clinicsToProcess.length) {
      const artifacts = await capturePatientExtractionArtifacts(page, config, job.id, 'clinics-not-found', {
        currentUrl: page.url(),
        bodyText: await page.locator('body').innerText().catch(() => ''),
        clinicName: await extractCurrentClinicName(page, config).catch(() => ''),
        targetDate: eligibleDateLabels.join(', '),
        candidateRowTexts: []
      });
      if (artifacts.length) jobStore.addArtifacts(job.id, artifacts);
      return {
        status: 'partial',
        jobType: 'all_clinics_nps_last_consultation',
        startedAt,
        finishedAt: new Date().toISOString(),
        eligibleDates,
        totalClinicsDiscovered: discoveredClinics.length,
        totalClinicsProcessed: 0,
        totalRead: 0,
        totalFailed: 1,
        clinics: [],
        results: [],
        extractedRows: [],
        artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
        errorMessage: 'Robo autenticou no Ecuro, mas nao conseguiu descobrir clinicas no seletor superior.'
      };
    }

    logRobotJobEvent(job.id, {
      level: 'info',
      step: 'discover_clinics',
      action: 'discovered',
      currentStep: 'discover_clinics',
      currentUrl: page.url(),
      pageProgress: { current: 0, total: clinicsToProcess.length },
      message: `Clinicas descobertas: ${discoveredClinics.length}. Clinicas selecionadas para processamento: ${clinicsToProcess.length}.`,
      metadata: {
        discoveredClinics: discoveredClinics.slice(0, 30),
        eligibleDates: eligibleDateLabels
      }
    });

    for (let index = 0; index < clinicsToProcess.length; index += 1) {
      const clinic = clinicsToProcess[index];
      if (totalRead >= config.maxTotalPatientsPerRun) break;

      updateRobotJobStep(job.id, {
        currentStep: 'select_clinic',
        action: 'selecting_clinic',
        currentUrl: page.url(),
        pageProgress: { current: index + 1, total: clinicsToProcess.length },
        totalRowsRead: totalRead,
        eligibleFound: results.filter((row) => row.eligibilityStatus === 'eligible').length,
        status: 'running'
      });
      logRobotJobEvent(job.id, {
        level: 'info',
        step: 'select_clinic',
        action: 'selecting_clinic',
        currentStep: 'select_clinic',
        currentUrl: page.url(),
        message: `Selecionando clinica ${clinic.fullLabel || clinic.clinicName}.`,
        metadata: { clinic }
      });

      let selection = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        selection = await selectEcuroClinic(page, clinic, config);
        if (!selection.selected) {
          const summary = buildClinicRunSummary(clinic, {
            status: 'clinic_selection_failed',
            totalFailed: 1,
            errorMessage: 'Nao foi possivel confirmar a selecao da clinica no topo da tela.'
          });
          clinics.push(summary);
          totalFailed += 1;
          logRobotJobEvent(job.id, {
            level: 'warning',
            step: 'select_clinic',
            action: 'clinic_selection_failed',
            currentStep: 'select_clinic',
            currentUrl: page.url(),
            message: summary.errorMessage,
            metadata: { clinic, selection }
          });
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const collection = await collectPatientDirectoryRows(page, config, {
          ...payload,
          source,
          clinicCode: clinic.clinicCode || selection.clinicCode || '',
          clinicName: selection.clinicName || clinic.fullLabel || clinic.clinicName || '',
          externalClinicName: selection.clinicName || clinic.fullLabel || clinic.clinicName || '',
          targetDates: eligibleDateLabels,
          maxPagesPerClinic: payload.maxPagesPerClinic || config.maxPagesPerClinic,
          maxPatientsPerClinic: Math.min(
            Number(payload.maxPatientsPerClinic || config.maxPatientsPerClinic || 1000),
            Math.max(1, config.maxTotalPatientsPerRun - totalRead)
          )
        });
        capturedClinicName = capturedClinicName || collection.clinicName || '';
        detectedHeaders = detectedHeaders.length ? detectedHeaders : (collection.diagnostics?.detectedHeaders || collection.diagnostics?.headerTexts || []);
        if (extractionStrategyUsed === 'none' && collection.diagnostics?.extractionStrategyUsed) {
          extractionStrategyUsed = collection.diagnostics.extractionStrategyUsed;
        }
        const clinicRows = markDuplicateEcuroPatients(collection.results || [], seenDuplicateKeys);
        const matchedRows = matchCompletionRows([], clinicRows).map((row) => ({
          ...row,
          clinicCode: clinic.clinicCode || selection.clinicCode || row.clinicCode || '',
          clinicName: row.clinicName || selection.clinicName || clinic.fullLabel || clinic.clinicName || '',
          source
        }));
        const clinicSummary = summarizeClinicResults(matchedRows);
        totalRead += Number(collection.totalRowsRead || matchedRows.length || 0);
        results.push(...matchedRows);
        extractedRows.push(...clinicRows);
        clinics.push(buildClinicRunSummary(clinic, {
          ...clinicSummary,
          status: collection.totalRowsRead > 0 ? 'completed' : 'partial',
          pageSizeUsed: collection.pageSize?.pageSizeAfter || collection.pageSize?.pageSizeBefore || null,
          pagesRead: collection.pagesVisited || 0,
          errorMessage: collection.totalRowsRead > 0 ? null : 'Nenhuma linha de paciente foi extraida para esta clinica.'
        }));

        if (config.debugCapture || !collection.totalRowsRead) {
          // eslint-disable-next-line no-await-in-loop
          const artifacts = await capturePatientExtractionArtifacts(page, config, job.id, `clinic-${clinic.clinicCode || index + 1}`, {
            ...(collection.diagnostics || {}),
            currentUrl: page.url(),
            clinicName: selection.clinicName || clinic.fullLabel || clinic.clinicName || '',
            clinicCode: clinic.clinicCode || '',
            targetDate: eligibleDateLabels.join(', '),
            candidateRowTexts: Array.isArray(collection.diagnostics?.candidateRowTexts) ? collection.diagnostics.candidateRowTexts : [],
            bodyText: collection.diagnostics?.bodyText || ''
          });
          if (artifacts.length) jobStore.addArtifacts(job.id, artifacts);
        }

        logRobotJobEvent(job.id, {
          level: collection.totalRowsRead > 0 ? 'info' : 'warning',
          step: 'collect_patients',
          action: 'clinic_collected',
          currentStep: 'collect_patients',
          currentUrl: page.url(),
          pageProgress: { current: index + 1, total: clinicsToProcess.length },
          totalRowsRead: totalRead,
          eligibleFound: results.filter((row) => row.eligibilityStatus === 'eligible').length,
          message: `Clinica ${clinic.fullLabel || clinic.clinicName}: ${collection.totalRowsRead || 0} lidos, ${clinicSummary.totalEligible || 0} elegiveis.`,
          metadata: {
            clinic,
            pagesVisited: collection.pagesVisited || 0,
            pageSize: collection.pageSize || null,
            eligibleDates: eligibleDateLabels
          }
        });
      } catch (clinicError) {
        totalFailed += 1;
        clinics.push(buildClinicRunSummary(clinic, {
          status: 'error',
          totalFailed: 1,
          errorMessage: clinicError.message
        }));
        logRobotJobEvent(job.id, {
          level: 'error',
          step: 'collect_patients',
          action: 'clinic_error',
          currentStep: 'collect_patients',
          currentUrl: page.url(),
          message: clinicError.message,
          metadata: { clinic }
        });
      }
    }

    const summary = summarizeCompletionResults(results);
    return {
      status: totalFailed || clinics.some((clinic) => clinic.status !== 'completed') ? 'partial' : 'completed',
      jobType: 'all_clinics_nps_last_consultation',
      dateMode: payload.dateMode || payload.date_mode || config.npsDateMode,
      eligibleDates,
      totalClinicsDiscovered: discoveredClinics.length,
      totalClinicsProcessed: clinics.length,
      totalRead,
      totalSent: 0,
      totalFailed: Number(summary.totalFailed || 0) + totalFailed,
      capturedClinicName,
      detectedHeaders,
      extractionStrategyUsed,
      totalEligible: summary.totalEligible,
      totalOutOfDate: summary.totalOutOfDate,
      totalInvalidPhone: summary.totalInvalidPhone,
      totalDuplicate: summary.totalDuplicate,
      totalMissingLastConsultation: summary.totalMissingLastConsultation,
      totalCompleted: summary.totalCompleted,
      totalNotCompleted: summary.totalNotCompleted,
      totalNotFound: summary.totalNotFound,
      totalAmbiguous: summary.totalAmbiguous,
      clinics,
      results,
      extractedRows,
      discoveredClinics,
      logs: (jobStore.get(job.id)?.logs || []).slice(),
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      startedAt,
      finishedAt: new Date().toISOString(),
      currentUrl: page.url()
    };
  } catch (error) {
    const artifacts = await saveRobotArtifacts(page, config, job.id, error.code || 'all-clinics-error');
    if (artifacts.length) {
      jobStore.addArtifacts(job.id, artifacts);
    }
    logRobotJobEvent(job.id, {
      level: 'error',
      step: error.code === 'manual_action_required' ? 'manual_action_required' : 'error',
      action: 'failed',
      currentStep: error.code === 'manual_action_required' ? 'manual_action_required' : 'error',
      currentUrl: page.url(),
      message: error.message
    });
    return {
      status: error.code === 'manual_action_required' ? 'manual_action_required' : 'failed',
      jobType: 'all_clinics_nps_last_consultation',
      eligibleDates,
      totalClinicsDiscovered: discoveredClinics.length,
      totalClinicsProcessed: clinics.length,
      totalRead,
      totalFailed: Math.max(1, totalFailed),
      capturedClinicName,
      detectedHeaders,
      extractionStrategyUsed,
      clinics,
      results,
      extractedRows,
      logs: (jobStore.get(job.id)?.logs || []).slice(),
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      startedAt,
      finishedAt: new Date().toISOString(),
      currentUrl: page.url(),
      errorMessage: error.message
    };
  } finally {
    await context.close().catch(() => null);
  }
}

async function runDiscoverClinicsJob(payload = {}, config = getEcuroRobotConfig()) {
  const job = jobStore.create({
    jobType: 'discover_clinics',
    clinicName: payload.clinicName || '',
    payload
  });

  jobStore.update(job.id, {
    status: 'running',
    startedAt: new Date().toISOString()
  });
  updateRobotJobStep(job.id, {
    currentStep: 'starting_discovery',
    action: 'starting_discovery',
    status: 'running'
  });

  const playwright = await loadPlaywright();
  ensureDir(config.profileDir);
  const context = await playwright.chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    userAgent: config.userAgent || undefined
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);

  try {
    await performEcuroBrowserLogin(page, config);
    await navigateToCompletionScreen(page, config);
    const clinics = await discoverEcuroClinics(page, config);
    const artifacts = config.debugCapture
      ? await capturePatientExtractionArtifacts(page, config, job.id, 'discover-clinics', {
        currentUrl: page.url(),
        clinicName: await extractCurrentClinicName(page, config).catch(() => ''),
        candidateRowTexts: clinics.map((clinic) => clinic.fullLabel),
        bodyText: await page.locator('body').innerText().catch(() => '')
      })
      : [];
    if (artifacts.length) jobStore.addArtifacts(job.id, artifacts);
    const updated = jobStore.update(job.id, {
      status: clinics.length ? 'completed' : 'partial',
      finishedAt: new Date().toISOString(),
      results: clinics,
      discoveredClinics: clinics,
      totalChecked: clinics.length,
      totalRead: clinics.length,
      totalRowsRead: clinics.length,
      currentUrl: page.url(),
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice(),
      errorMessage: clinics.length ? null : 'Nenhuma clinica foi encontrada no seletor superior.'
    });
    jobStore.resetRuntime();
    return updated;
  } catch (error) {
    const artifacts = await saveRobotArtifacts(page, config, job.id, error.code || 'discover-clinics-error');
    if (artifacts.length) jobStore.addArtifacts(job.id, artifacts);
    const updated = jobStore.update(job.id, {
      status: error.code === 'manual_action_required' ? 'manual_action_required' : 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: error.message,
      artifacts: (jobStore.get(job.id)?.artifacts || []).slice()
    });
    jobStore.resetRuntime();
    return updated;
  } finally {
    await context.close().catch(() => null);
  }
}

async function runEcuroAllClinicsNpsAutomation(payload = {}, config = getEcuroRobotConfig()) {
  const job = jobStore.create({
    jobType: payload.jobType || 'all_clinics_nps_last_consultation',
    clinicId: payload.clinicId || null,
    clinicName: payload.clinicName || '',
    appointmentDate: payload.appointmentDate || '',
    payload: {
      ...payload,
      source: payload.source || 'ecuro_all_clinics_last_consultation',
      dryRun: payload.dryRun !== undefined ? Boolean(payload.dryRun) : config.dryRun
    }
  });

  jobStore.update(job.id, {
    status: 'running',
    startedAt: new Date().toISOString()
  });
  updateRobotJobStep(job.id, {
    currentStep: 'starting_all_clinics',
    action: 'starting_all_clinics',
    status: 'running'
  });

  const result = await executeBrowserAllClinicsNpsAutomation(job, {
    ...payload,
    source: payload.source || 'ecuro_all_clinics_last_consultation'
  }, config);
  const summary = summarizeCompletionResults(result.results || []);
  const updated = jobStore.update(job.id, {
    status: result.status,
    finishedAt: result.finishedAt || new Date().toISOString(),
    errorMessage: result.errorMessage || null,
    artifacts: result.artifacts || [],
    logs: result.logs || (jobStore.get(job.id)?.logs || []),
    extractedRows: result.extractedRows || [],
    results: result.results || [],
    clinics: result.clinics || [],
    discoveredClinics: result.discoveredClinics || [],
    dateMode: result.dateMode || config.npsDateMode,
    eligibleDates: result.eligibleDates || [],
    totalClinicsDiscovered: Number(result.totalClinicsDiscovered || 0),
    totalClinicsProcessed: Number(result.totalClinicsProcessed || 0),
    totalRowsRead: Number(result.totalRead || summary.totalChecked || 0),
    totalRead: Number(result.totalRead || summary.totalChecked || 0),
    totalSent: Number(result.totalSent || 0),
    capturedClinicName: result.capturedClinicName || '',
    detectedHeaders: result.detectedHeaders || [],
    extractionStrategyUsed: result.extractionStrategyUsed || 'none',
    targetDate: Array.isArray(result.eligibleDates) ? result.eligibleDates.join(',') : '',
    currentUrl: result.currentUrl || '',
    ...summary,
    totalFailed: Number(result.totalFailed || summary.totalFailed || 0)
  });
  jobStore.resetRuntime();
  return updated;
}

async function runDiscoverNetworkJob(payload = {}, config = getEcuroRobotConfig()) {
  const job = jobStore.create({
    jobType: payload.jobType || 'network_discovery',
    clinicId: payload.clinicId || null,
    clinicName: payload.clinicName || '',
    appointmentDate: payload.appointmentDate || '',
    payload: {
      ...payload,
      source: payload.source || 'ecuro_network_discovery',
      dryRun: true
    }
  });

  jobStore.update(job.id, {
    status: 'running',
    startedAt: new Date().toISOString()
  });
  updateRobotJobStep(job.id, {
    currentStep: 'starting_network_discovery',
    action: 'starting_network_discovery',
    status: 'running'
  });

  const result = await executeBrowserNetworkDiscovery(job, {
    ...payload,
    source: payload.source || 'ecuro_network_discovery',
    dryRun: true
  }, {
    ...config,
    captureNetwork: true,
    discoveryMode: 'network'
  });

  const updated = jobStore.update(job.id, {
    status: result.status,
    finishedAt: new Date().toISOString(),
    errorMessage: result.errorMessage || null,
    artifacts: result.artifacts || [],
    discovery: result.discovery || buildNetworkDiscoverySummary([]),
    results: result.discovery?.candidateResponses || [],
    totalRowsRead: Number(result.discovery?.candidateResponses?.length || 0),
    totalRead: Number(result.discovery?.candidateResponses?.length || 0),
    totalChecked: Number(result.discovery?.candidateResponses?.length || 0),
    currentUrl: result.currentUrl || '',
    selectedPatientEndpoint: result.discovery?.selectedPatientEndpoint || '',
    selectedClinicEndpoint: result.discovery?.selectedClinicEndpoint || '',
    confidenceScore: Number(result.discovery?.confidenceScore || 0)
  });
  jobStore.resetRuntime();
  return updated;
}

async function runCheckCompletedNetworkJob(payload = {}, config = getEcuroRobotConfig()) {
  const job = jobStore.create({
    jobType: payload.jobType || 'network_patients',
    clinicId: payload.clinicId || null,
    clinicName: payload.clinicName || '',
    appointmentDate: payload.targetDate || payload.appointmentDate || '',
    payload: {
      ...payload,
      source: payload.source || 'ecuro_network_patients',
      dateMode: payload.dateMode || 'today',
      dryRun: payload.dryRun !== undefined ? Boolean(payload.dryRun) : true
    }
  });

  jobStore.update(job.id, {
    status: 'running',
    startedAt: new Date().toISOString()
  });
  updateRobotJobStep(job.id, {
    currentStep: 'starting_network_collect',
    action: 'starting_network_collect',
    status: 'running'
  });

  const result = await executeBrowserNetworkCompletionCheck(job, {
    ...payload,
    source: payload.source || 'ecuro_network_patients',
    dateMode: payload.dateMode || 'today',
    dryRun: payload.dryRun !== undefined ? Boolean(payload.dryRun) : true
  }, {
    ...config,
    captureNetwork: true,
    discoveryMode: 'network'
  });
  const summary = summarizeCompletionResults(result.results || []);
  const updated = jobStore.update(job.id, {
    status: result.status,
    finishedAt: new Date().toISOString(),
    errorMessage: result.errorMessage || null,
    artifacts: result.artifacts || [],
    extractedRows: result.extractedRows || [],
    results: result.results || [],
    discovery: result.discovery || buildNetworkDiscoverySummary([]),
    extractionMode: 'network',
    targetDate: result.targetDate || resolveEcuroTargetDate(payload),
    detectedClinicName: result.capturedClinicName || payload.clinicName || '',
    capturedClinicName: result.capturedClinicName || payload.clinicName || '',
    selectedPatientEndpoint: result.selectedPatientEndpoint || '',
    selectedClinicEndpoint: result.selectedClinicEndpoint || '',
    directFetchStatus: result.directFetchStatus || null,
    totalRowsRead: Number(result.totalRead || summary.totalChecked || 0),
    totalRead: Number(result.totalRead || summary.totalChecked || 0),
    currentUrl: result.currentUrl || '',
    ...summary,
    totalFailed: Number(result.totalFailed || summary.totalFailed || 0)
  });
  jobStore.resetRuntime();
  return updated;
}

async function runLoginTest(_payload = {}, config = getEcuroRobotConfig()) {
  if (config.mode !== 'browser') {
    return {
      success: false,
      status: 'failed',
      message: `Unsupported Ecuro robot mode for login-test: ${config.mode}.`,
      browserMode: false
    };
  }

  const playwright = await loadPlaywright();
  ensureDir(config.profileDir);
  const context = await playwright.chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 960 },
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    userAgent: config.userAgent || undefined
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  page.setDefaultNavigationTimeout(config.timeoutMs);

  try {
    const result = await performEcuroBrowserLogin(page, config);
    const targetUrl = String(config.selectors.navigation.completedPagePath || '').trim();
    if (targetUrl) {
      const destination = targetUrl.startsWith('http')
        ? targetUrl
        : `${config.baseUrl}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
      await page.goto(destination, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
      await page.waitForTimeout(1200);
    }
    const clinicName = await extractCurrentClinicName(page, config);
    return {
      success: true,
      status: 'authenticated',
      browserMode: true,
      reusedSession: Boolean(result.reusedSession),
      checkedAt: new Date().toISOString(),
      destination: targetUrl || null,
      clinicName: clinicName || null
    };
  } catch (error) {
    const artifacts = await saveRobotArtifacts(page, config, buildJobId(), error.code || 'login-test');
    return {
      success: false,
      status: error.code === 'manual_action_required' ? 'manual_action_required' : 'failed',
      browserMode: true,
      checkedAt: new Date().toISOString(),
      message: error.message,
      artifacts
    };
  } finally {
    await context.close().catch(() => null);
  }
}

async function runCheckCompletedJob(payload = {}, config = getEcuroRobotConfig()) {
  const job = jobStore.create({
    jobType: payload.jobType || 'check_completed',
    clinicId: payload.clinicId || null,
    clinicName: payload.clinicName || '',
    appointmentDate: payload.appointmentDate || '',
    payload
  });

  jobStore.update(job.id, {
    status: 'running',
    startedAt: new Date().toISOString()
  });
  updateRobotJobStep(job.id, {
    currentStep: 'starting',
    action: 'starting',
    status: 'running'
  });

  const result = await executeBrowserCompletionCheck(job, payload, config);
  const summary = summarizeCompletionResults(result.results || []);
  const finalStatus = result.status === 'completed' && summary.totalFailed
    ? 'partial'
    : result.status;

  const updated = jobStore.update(job.id, {
    status: finalStatus,
    finishedAt: new Date().toISOString(),
    errorMessage: result.errorMessage || null,
    artifacts: result.artifacts || [],
    extractedRows: result.extractedRows || [],
    results: result.results || [],
    pagesVisited: result.pagesVisited || 0,
    totalRowsRead: result.totalRowsRead || 0,
    totalRead: result.totalRowsRead || 0,
    targetDate: result.targetDate || payload.appointmentDate || getDateKeyInSaoPaulo(),
    detectedClinicName: result.clinicName || payload.clinicName || '',
    capturedClinicName: result.capturedClinicName || result.clinicName || payload.clinicName || '',
    detectedHeaders: result.detectedHeaders || [],
    extractionStrategyUsed: result.extractionStrategyUsed || 'none',
    diagnostics: result.diagnostics || null,
    ...summary
  });
  jobStore.resetRuntime();
  return updated;
}

async function runCheckCompletedBatch(payload = {}, config = getEcuroRobotConfig()) {
  const batches = Array.isArray(payload.jobs) ? payload.jobs : [];
  if (!batches.length) {
    throw new Error('No Ecuro jobs were provided for batch processing.');
  }

  const results = [];
  for (const item of batches) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runCheckCompletedJob(item, config));
  }
  return results;
}

async function retryRobotJob(jobId, config = getEcuroRobotConfig()) {
  const job = jobStore.get(jobId);
  if (!job) {
    const error = new Error('Robot job not found.');
    error.statusCode = 404;
    throw error;
  }
  return runCheckCompletedJob(job.payload || {}, config);
}

async function runMappingJob(payload = {}, config = getEcuroRobotConfig()) {
  const job = jobStore.create({
    jobType: payload.jobType || 'ecuro_mapping',
    clinicId: payload.clinicId || null,
    clinicName: payload.clinicName || '',
    appointmentDate: payload.appointmentDate || '',
    payload
  });

  jobStore.update(job.id, {
    status: 'running',
    startedAt: new Date().toISOString()
  });
  updateRobotJobStep(job.id, {
    currentStep: 'starting_mapping',
    action: 'starting_mapping',
    status: 'running'
  });

  const result = await executeBrowserMappingJob(job, payload, config);
  const finalStatus = result.status === 'completed' && Number(result.totalErrors || 0) > 0
    ? 'partial'
    : result.status;

  const updated = jobStore.update(job.id, {
    status: finalStatus,
    finishedAt: new Date().toISOString(),
    errorMessage: result.errorMessage || null,
    artifacts: result.artifacts || [],
    mappedPages: result.pages || [],
    totalPages: Number(result.totalPages || 0),
    totalRoutes: Number(result.totalRoutes || 0),
    totalErrors: Number(result.totalErrors || 0),
    detectedClinicName: result.clinicName || payload.clinicName || '',
    currentUrl: result.currentUrl || ''
  });
  jobStore.resetRuntime();
  return updated;
}

function getRobotLiveState() {
  return jobStore.getRuntime();
}

function getRobotVncStatus(config = getEcuroRobotConfig()) {
  return {
    enabled: Boolean(config.vncEnabled),
    visualMode: Boolean(config.visualMode),
    host: config.vncHost,
    port: config.vncPort,
    captureIntervalSeconds: config.captureIntervalSeconds,
    mode: config.vncEnabled ? 'novnc' : 'screenshots_only',
    available: Boolean(config.vncEnabled && config.visualMode),
    message: config.vncEnabled
      ? 'Visualização do robô controlada por configuração do ambiente.'
      : 'VNC desabilitado. O monitor master deve usar screenshots e HTML capturados.'
  };
}

async function startRobotVncSession(config = getEcuroRobotConfig()) {
  return {
    success: Boolean(config.vncEnabled && config.visualMode),
    status: config.vncEnabled ? 'configured' : 'disabled',
    ...getRobotVncStatus(config)
  };
}

async function stopRobotVncSession(config = getEcuroRobotConfig()) {
  return {
    success: true,
    status: config.vncEnabled ? 'configured' : 'disabled',
    ...getRobotVncStatus(config)
  };
}

module.exports = {
  buildInviteToken,
  buildJobId,
  buildPatientDirectoryRecord,
  detectManualActionRequired,
  discoverEcuroNetworkEndpoints,
  discoverEcuroClinics,
  evaluateNpsEligibility,
  extractEcuroPatientRowsFromText,
  extractPatientsFromNetworkResponses,
  extractPatientsFromEcuroPatientsPage,
  getNpsEligibleDates,
  getRobotLiveState,
  getRobotVncStatus,
  getEcuroRobotConfig,
  getEcuroRobotConfigStatus,
  getYesterdaySaoPauloDateKey,
  isEligibleByLastConsultationDate,
  isEligibleByLastConsultationDates,
  jobStore,
  mapPatientDirectoryRows,
  matchCompletionRows,
  normalizeBrazilianDate,
  normalizeEcuroCompletionStatus,
  normalizeEcuroPatientFromApi,
  resolveEcuroTargetDate,
  runDiscoverClinicsJob,
  runDiscoverNetworkJob,
  runEcuroAllClinicsNpsAutomation,
  retryRobotJob,
  runCheckCompletedBatch,
  runCheckCompletedJob,
  runCheckCompletedNetworkJob,
  runMappingJob,
  runLoginTest,
  startRobotVncSession,
  stopRobotVncSession,
  summarizeCompletionResults
};
