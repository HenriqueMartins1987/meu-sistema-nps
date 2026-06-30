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
    manualActionPattern: /captcha|two[\s-]?factor|2fa|verifica[cç][aã]o|c[oó]digo/i,
    maxPagesPerRun: Math.max(1, Number(env.ECURO_MAX_PAGES_PER_RUN || 20) || 20),
    maxPatientsPerRun: Math.max(1, Number(env.ECURO_MAX_PATIENTS_PER_RUN || 1000) || 1000),
    stopWhenOlderThanTarget: toBoolean(env.ECURO_STOP_WHEN_OLDER_THAN_TARGET, true)
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
    apiKeyConfigured: Boolean(config.apiKey),
    maxPagesPerRun: config.maxPagesPerRun,
    maxPatientsPerRun: config.maxPatientsPerRun,
    stopWhenOlderThanTarget: config.stopWhenOlderThanTarget
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
    artifacts.push({ type: 'screenshot', path: screenshotPath });
  } catch (_error) {
    // Ignore artifact persistence issues.
  }

  try {
    fs.writeFileSync(htmlPath, await page.content(), 'utf8');
    artifacts.push({ type: 'html', path: htmlPath });
  } catch (_error) {
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

function isLikelyClinicName(value = '') {
  const text = String(value || '').trim();
  if (!text || text.length < 10 || text.length > 180) return false;
  return /^[A-Z0-9]{4,}\s*-\s+.+/i.test(text) || text.split('-').length >= 3;
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

  let eligibilityStatus = 'eligible';
  if (context.forceClinicMismatch) {
    eligibilityStatus = 'clinic_mismatch';
  } else if (!lastConsultationDate) {
    eligibilityStatus = 'missing_last_consultation';
  } else if (context.targetDate && lastConsultationDate !== context.targetDate) {
    eligibilityStatus = 'out_of_date';
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
    source: 'ecuro_last_consultation'
  };

  record.rawPayloadJson = JSON.stringify({
    patientFirstName,
    patientLastName,
    patientName,
    patientPhone: patientPhoneRaw || null,
    document: document || null,
    externalPatientId: externalPatientId || null,
    clinicName: context.clinicName || null,
    birthDate: birthDate || null,
    registrationDate: registrationDate || null,
    lastConsultationDate: lastConsultationDate || null,
    nextConsultationDate: nextConsultationDate || null,
    eligibilityStatus,
    source: 'ecuro_last_consultation',
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

async function collectPatientDirectoryRows(page, config, payload = {}) {
  const targetDate = normalizeBrazilianDate(payload.appointmentDate || payload.targetDate || '') || getYesterdaySaoPauloDateKey();
  const expectedClinicName = String(payload.externalClinicName || payload.clinicName || '').trim();
  const clinicSelection = await ensureClinicSelection(page, config, expectedClinicName);
  const clinicName = clinicSelection.clinicName || expectedClinicName || '';
  const results = [];
  let pagesVisited = 0;
  let totalRowsRead = 0;

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
      results: [{
        patientName: '',
        patientFirstName: '',
        patientLastName: '',
        patientPhone: '',
        document: null,
        externalPatientId: null,
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
        source: 'ecuro_last_consultation',
        rawPayloadJson: JSON.stringify({
          expectedClinicName,
          detectedClinicName: clinicName,
          eligibilityStatus: 'clinic_mismatch',
          source: 'ecuro_last_consultation'
        })
      }]
    };
  }

  while (pagesVisited < config.maxPagesPerRun && results.length < config.maxPatientsPerRun) {
    const table = await extractPatientTableSnapshot(page, config);
    const pageResults = mapPatientDirectoryRows(table, {
      headerIndexes: table.headerIndexes,
      clinicName,
      targetDate
    });

    totalRowsRead += pageResults.length;
    for (const item of pageResults) {
      if (results.length >= config.maxPatientsPerRun) break;
      results.push(item);
    }

    pagesVisited += 1;
    if (results.length >= config.maxPatientsPerRun) break;
    if (config.stopWhenOlderThanTarget && shouldStopWhenOlderThanTarget(pageResults, targetDate)) break;

    const moved = await clickNextPatientsPage(page, config);
    if (!moved) break;
  }

  return {
    clinicName,
    clinicMatched: clinicSelection.matched,
    targetDate,
    pagesVisited,
    totalRowsRead,
    results
  };
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
    await performEcuroBrowserLogin(page, config);
    await navigateToCompletionScreen(page, config);
    const collection = await collectPatientDirectoryRows(page, config, payload);
    const extractedRows = collection.results || [];
    const matchedResults = Array.isArray(payload.patients) && payload.patients.length
      ? matchCompletionRows(payload.patients || [], extractedRows)
      : matchCompletionRows([], extractedRows);
    return {
      status: collection.clinicMatched === false ? 'partial' : 'completed',
      extractedRows,
      results: matchedResults,
      artifacts: [],
      pagesVisited: collection.pagesVisited || 0,
      totalRowsRead: collection.totalRowsRead || 0,
      targetDate: collection.targetDate || getYesterdaySaoPauloDateKey(),
      clinicName: collection.clinicName || payload.clinicName || ''
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
          externalStatus: 'error',
          completionStatus: 'error',
          eligibilityStatus: 'error',
          matchedBy: 'manual_review',
          confidenceScore: 0,
          source: 'ecuro_last_consultation',
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
    pagesVisited: result.pagesVisited || 0,
    totalRowsRead: result.totalRowsRead || 0,
    targetDate: result.targetDate || payload.appointmentDate || getYesterdaySaoPauloDateKey(),
    detectedClinicName: result.clinicName || payload.clinicName || '',
    ...summary
  });
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

module.exports = {
  buildInviteToken,
  buildJobId,
  buildPatientDirectoryRecord,
  detectManualActionRequired,
  getEcuroRobotConfig,
  getEcuroRobotConfigStatus,
  getYesterdaySaoPauloDateKey,
  jobStore,
  mapPatientDirectoryRows,
  matchCompletionRows,
  normalizeBrazilianDate,
  normalizeEcuroCompletionStatus,
  retryRobotJob,
  runCheckCompletedBatch,
  runCheckCompletedJob,
  runLoginTest,
  summarizeCompletionResults
};
