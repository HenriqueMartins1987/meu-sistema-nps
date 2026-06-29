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
    completedPagePath: '',
    agendaMenu: ['a:has-text("Agenda")', 'button:has-text("Agenda")', '[href*="agenda"]'],
    patientsMenu: ['a:has-text("Pacientes")', 'button:has-text("Pacientes")', '[href*="patients"]'],
    reportsMenu: ['a:has-text("Relat")', 'button:has-text("Relat")', '[href*="report"]'],
    clinicFilter: ['select[name="clinic"]', 'input[name="clinic"]', '[data-testid="clinic-filter"]'],
    dateFilter: ['input[name="date"]', 'input[type="date"]', '[data-testid="date-filter"]'],
    searchField: ['input[name="search"]', 'input[type="search"]', '[placeholder*="paciente"]'],
    statusFilter: ['select[name="status"]', '[data-testid="status-filter"]'],
    applyFilters: ['button:has-text("Filtrar")', 'button:has-text("Buscar")', 'button:has-text("Aplicar")']
  },
  results: {
    rows: ['table tbody tr', '[role="row"]', '.table-row', '.agenda-row'],
    patientName: ['[data-col="patient"]', '[data-column="patientName"]', '.patient-name', '.name'],
    patientPhone: ['[data-col="phone"]', '[data-column="phone"]', '.patient-phone', '.phone'],
    appointmentDate: ['[data-col="date"]', '[data-column="date"]', '.appointment-date', '.date'],
    appointmentTime: ['[data-col="time"]', '[data-column="time"]', '.appointment-time', '.time'],
    externalPatientId: ['[data-col="id"]', '[data-column="externalId"]', '.external-id', '.patient-id'],
    clinicName: ['[data-col="clinic"]', '[data-column="clinic"]', '.clinic-name', '.clinic'],
    status: ['[data-col="status"]', '[data-column="status"]', '.status', '.appointment-status']
  }
};

const COMPLETED_STATUS_KEYWORDS = [
  'concluido',
  'concluida',
  'finalizado',
  'finalizada',
  'atendido',
  'atendida',
  'compareceu',
  'encerrado',
  'encerrada',
  'realizado',
  'realizada'
];

const NOT_COMPLETED_STATUS_KEYWORDS = [
  'agendado',
  'agendada',
  'pendente',
  'remarcado',
  'remarcada',
  'cancelado',
  'cancelada',
  'faltou',
  'nao compareceu',
  'não compareceu'
];

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
    } catch (error) {
      // Ignore malformed optional selector override file.
    }
  }

  if (rawJson) {
    try {
      selectors = mergeDeep(selectors, JSON.parse(rawJson));
    } catch (error) {
      // Ignore malformed optional inline selector override payload.
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
    dryRun: toBoolean(env.ECURO_ROBOT_DRY_RUN, false),
    profileDir,
    screenshotDir,
    htmlDir,
    apiKey,
    host: String(env.ECURO_ROBOT_HOST || '127.0.0.1').trim() || '127.0.0.1',
    port: Math.max(1, Number(env.ECURO_ROBOT_PORT || 3010) || 3010),
    cron: String(env.ECURO_ROBOT_CRON || '0 19 * * 1-6').trim() || '0 19 * * 1-6',
    selectors: readSelectorsConfig(env),
    userAgent: String(env.ECURO_ROBOT_USER_AGENT || '').trim(),
    manualActionPattern: /captcha|two[\s-]?factor|2fa|verifica[cç][aã]o|c[oó]digo/i
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
    apiKeyConfigured: Boolean(config.apiKey)
  };
}

function normalizeEcuroCompletionStatus(value) {
  const normalized = normalizeText(value || '');
  if (!normalized) return 'unknown';
  if (COMPLETED_STATUS_KEYWORDS.some((keyword) => normalized.includes(keyword))) return 'completed';
  if (NOT_COMPLETED_STATUS_KEYWORDS.some((keyword) => normalized.includes(keyword))) return 'not_completed';
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      artifacts: [],
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
}

const jobStore = new EcuroRobotJobStore();

function buildManualActionError(message = 'Ação manual necessária no Ecuro.') {
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
    artifacts.push({ type: 'screenshot', path: screenshotPath });
  } catch (error) {
    // Ignore artifact persistence issues.
  }

  try {
    fs.writeFileSync(htmlPath, await page.content(), 'utf8');
    artifacts.push({ type: 'html', path: htmlPath });
  } catch (error) {
    // Ignore artifact persistence issues.
  }

  return artifacts;
}

async function firstVisibleLocator(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1200 })) {
        return { selector, locator };
      }
    } catch (error) {
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
    throw new Error(`Modo ${config.mode} não suportado pelo robô de navegador.`);
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
    throw new Error('Não foi possível confirmar a autenticação no Ecuro.');
  }

  return { authenticated: true, reusedSession: false };
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

  const navigationSelectors = [
    ...config.selectors.navigation.agendaMenu,
    ...config.selectors.navigation.patientsMenu,
    ...config.selectors.navigation.reportsMenu
  ];

  if (await clickFirstVisible(page, navigationSelectors)) {
    await waitForPostSubmit(page);
  }
}

async function applyFilters(page, config, payload = {}) {
  if (payload.clinicName) {
    await fillFirstVisible(page, config.selectors.navigation.clinicFilter, payload.clinicName);
  }
  if (payload.appointmentDate) {
    await fillFirstVisible(page, config.selectors.navigation.dateFilter, payload.appointmentDate);
  }
  if (payload.search) {
    await fillFirstVisible(page, config.selectors.navigation.searchField, payload.search);
  }
  if (payload.status) {
    await fillFirstVisible(page, config.selectors.navigation.statusFilter, payload.status);
  }

  await clickFirstVisible(page, config.selectors.navigation.applyFilters);
  await waitForPostSubmit(page);
}

function parseRowTextHeuristics(rowText = '') {
  const tokens = String(rowText || '')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const statusToken = tokens.find((item) => normalizeEcuroCompletionStatus(item) !== 'unknown') || '';
  const phoneToken = tokens.find((item) => normalizePhone(item).valid) || '';
  const timeToken = tokens.find((item) => /\b\d{1,2}:\d{2}\b/.test(item)) || '';
  const dateToken = tokens.find((item) => /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(item) || /\b\d{4}-\d{2}-\d{2}\b/.test(item)) || '';
  const externalIdToken = tokens.find((item) => /^[A-Z0-9-]{4,20}$/i.test(item)) || '';
  const patientNameToken = tokens.find((item) => {
    const normalized = normalizeText(item);
    return normalized
      && !phoneToken.includes(item)
      && !timeToken.includes(item)
      && !dateToken.includes(item)
      && normalizeEcuroCompletionStatus(normalized) === 'unknown'
      && /[a-zà-ÿ]{2,}/i.test(item)
      && item.split(/\s+/).length >= 2;
  }) || tokens[0] || '';

  return {
    patientName: patientNameToken,
    patientPhone: phoneToken,
    appointmentDate: dateToken,
    appointmentTime: timeToken,
    externalPatientId: externalIdToken,
    externalStatus: statusToken
  };
}

async function extractCompletionRows(page, config) {
  const rowSelectors = config.selectors.results.rows || [];
  for (const selector of rowSelectors) {
    const rowCount = await page.locator(selector).count().catch(() => 0);
    if (!rowCount) continue;

    return page.$$eval(selector, (rows) => rows.map((row) => ({
      rowText: row.innerText || '',
      html: row.innerHTML || ''
    }))).then((rows) => rows.map((row) => {
      const parsed = parseRowTextHeuristics(row.rowText);
      return {
        patientName: parsed.patientName,
        patientPhone: parsed.patientPhone,
        clinicName: '',
        appointmentDate: parsed.appointmentDate,
        appointmentTime: parsed.appointmentTime,
        externalPatientId: parsed.externalPatientId,
        externalStatus: parsed.externalStatus,
        rawRow: row.rowText,
        rawHtml: row.html
      };
    }));
  }

  return [];
}

function buildMatchCandidates(patient = {}) {
  return {
    externalPatientId: String(patient.externalPatientId || patient.external_patient_id || '').trim().toLowerCase(),
    phone: normalizePhone(patient.patientPhone || patient.patient_phone || '').normalized,
    name: normalizeText(patient.patientName || patient.patient_name || ''),
    appointmentDate: String(patient.appointmentDate || patient.appointment_date || '').trim(),
    appointmentTime: String(patient.appointmentTime || patient.appointment_time || '').trim()
  };
}

function scoreExtractedMatch(patient, extracted) {
  const candidate = buildMatchCandidates(patient);
  const extractedPhone = normalizePhone(extracted.patientPhone || '').normalized;
  const extractedName = normalizeText(extracted.patientName || '');
  const extractedExternalId = String(extracted.externalPatientId || '').trim().toLowerCase();
  const extractedDate = String(extracted.appointmentDate || '').trim();
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
      patientPhone: row.patientPhone,
      clinicName: row.clinicName || '',
      appointmentDate: row.appointmentDate || '',
      appointmentTime: row.appointmentTime || '',
      externalPatientId: row.externalPatientId || '',
      externalStatus: row.externalStatus || '',
      completionStatus: normalizeEcuroCompletionStatus(row.externalStatus) === 'completed' ? 'completed' : 'not_completed',
      matchedBy: row.externalPatientId ? 'external_id' : (normalizePhone(row.patientPhone || '').valid ? 'phone' : 'manual_review'),
      confidenceScore: normalizeEcuroCompletionStatus(row.externalStatus) === 'completed' ? 95 : 70,
      rawPayloadJson: JSON.stringify(row)
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
        matchedBy: 'manual_review',
        confidenceScore: 0,
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
        matchedBy: 'manual_review',
        confidenceScore: matches[0].score,
        rawPayloadJson: JSON.stringify({ patient, candidates: matches.map((item) => item.row) })
      };
    }

    const best = matches[0];
    const normalizedStatus = normalizeEcuroCompletionStatus(best.row.externalStatus);
    return {
      patientName: patient.patientName || patient.patient_name || best.row.patientName || '',
      patientPhone: patient.patientPhone || patient.patient_phone || best.row.patientPhone || '',
      clinicName: patient.clinicName || patient.clinic_name || best.row.clinicName || '',
      appointmentDate: patient.appointmentDate || patient.appointment_date || best.row.appointmentDate || '',
      appointmentTime: patient.appointmentTime || patient.appointment_time || best.row.appointmentTime || '',
      externalPatientId: best.row.externalPatientId || patient.externalPatientId || patient.external_patient_id || '',
      externalStatus: best.row.externalStatus || '',
      completionStatus: normalizedStatus === 'completed' ? 'completed' : 'not_completed',
      matchedBy: best.matchedBy,
      confidenceScore: best.score,
      rawPayloadJson: JSON.stringify(best.row)
    };
  });
}

function summarizeCompletionResults(results = []) {
  return results.reduce((summary, row) => {
    summary.totalChecked += 1;
    if (row.completionStatus === 'completed') summary.totalCompleted += 1;
    if (row.completionStatus === 'not_completed') summary.totalNotCompleted += 1;
    if (row.completionStatus === 'not_found') summary.totalNotFound += 1;
    if (row.completionStatus === 'ambiguous') summary.totalAmbiguous += 1;
    if (row.completionStatus === 'error') summary.totalFailed += 1;
    return summary;
  }, {
    totalChecked: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalNotCompleted: 0,
    totalNotFound: 0,
    totalAmbiguous: 0
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
    await performEcuroBrowserLogin(page, config);
    await navigateToCompletionScreen(page, config);
    await applyFilters(page, config, {
      clinicName: payload.clinicName || '',
      appointmentDate: payload.appointmentDate || '',
      status: 'concluido'
    });
    const extractedRows = await extractCompletionRows(page, config);
    const matchedResults = matchCompletionRows(payload.patients || [], extractedRows);
    return {
      status: 'completed',
      extractedRows,
      results: matchedResults,
      artifacts: []
    };
  } catch (error) {
    const artifacts = await saveRobotArtifacts(page, config, job.id, error.code || 'error');
    if (error.code === 'manual_action_required') {
      return {
        status: 'manual_action_required',
        extractedRows: [],
        results: [],
        artifacts,
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
          externalStatus: '',
          completionStatus: 'error',
          matchedBy: 'manual_review',
          confidenceScore: 0,
          rawPayloadJson: JSON.stringify({ reason: error.message })
        }))
        : [],
      artifacts,
      errorMessage: error.message
    };
  } finally {
    await context.close().catch(() => null);
  }
}

async function runLoginTest(payload = {}, config = getEcuroRobotConfig()) {
  if (config.mode !== 'browser') {
    return {
      success: false,
      status: 'failed',
      message: `Modo ${config.mode} não suportado para login-test sem API explícita.`,
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
    return {
      success: true,
      status: 'authenticated',
      browserMode: true,
      reusedSession: Boolean(result.reusedSession),
      checkedAt: new Date().toISOString()
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

  const result = await executeBrowserCompletionCheck(job, payload, config);
  const summary = summarizeCompletionResults(result.results || []);
  const finalStatus = result.status === 'completed' && summary.totalFailed
    ? 'partial'
    : result.status;

  return jobStore.update(job.id, {
    status: finalStatus,
    finishedAt: new Date().toISOString(),
    errorMessage: result.errorMessage || null,
    artifacts: result.artifacts || [],
    extractedRows: result.extractedRows || [],
    results: result.results || [],
    ...summary
  });
}

async function runCheckCompletedBatch(payload = {}, config = getEcuroRobotConfig()) {
  const batches = Array.isArray(payload.jobs) ? payload.jobs : [];
  if (!batches.length) {
    throw new Error('Nenhum job informado para o lote do Ecuro.');
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
    const error = new Error('Job não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  return runCheckCompletedJob(job.payload || {}, config);
}

module.exports = {
  buildInviteToken,
  buildJobId,
  detectManualActionRequired,
  getEcuroRobotConfig,
  getEcuroRobotConfigStatus,
  jobStore,
  matchCompletionRows,
  normalizeEcuroCompletionStatus,
  retryRobotJob,
  runCheckCompletedBatch,
  runCheckCompletedJob,
  runLoginTest,
  summarizeCompletionResults
};
