const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  buildJobId,
  getEcuroRobotConfig,
  jobStore,
  normalizeBrazilianDate,
  parseEcuroPatientsExcel,
  resolveEcuroTargetDate,
  summarizeCompletionResults
} = require('./ecuroRobotService');
const { normalizePhone, normalizeText } = require('./patientEnrichmentService');
const { createAuthenticatedEcuroSession } = require('./ecuroBrowserSession');

function ensureDir(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function getStorePaths(config = getEcuroRobotConfig()) {
  const baseDir = path.resolve(String(process.env.ECURO_ROBOT_DB_DIR || path.join(process.cwd(), 'runtime', 'ecuro-db')).trim());
  ensureDir(baseDir);
  return {
    baseDir,
    clinics: path.join(baseDir, 'ecuro-clinics.json'),
    patients: path.join(baseDir, 'ecuro-patients.json'),
    queue: path.join(baseDir, 'ecuro-nps-queue.json'),
    clinicRuns: path.join(baseDir, 'ecuro-clinic-processing-runs.json'),
    config
  };
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function maskDocument(value = '') {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return value || null;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
}

function hashValue(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function buildJobStoreArtifact(jobId, type, filePath, step = 'sequential_excel', metadata = {}) {
  return {
    id: `${jobId}-${step}-${type}-${hashValue(filePath || `${Date.now()}`).slice(0, 10)}`,
    type,
    path: filePath,
    step,
    metadata,
    createdAt: new Date().toISOString()
  };
}

function addLog(job, entry = {}) {
  const nextEntry = {
    id: `${job.id}-log-${(job.logs || []).length + 1}`,
    level: entry.level || 'info',
    step: entry.step || job.currentStep || 'processing',
    message: entry.message || '',
    url: entry.url || job.currentUrl || '',
    metadata: entry.metadata || null,
    createdAt: new Date().toISOString()
  };
  job.logs = [...(job.logs || []), nextEntry].slice(-500);
  jobStore.update(job.id, { logs: job.logs, currentStep: nextEntry.step, action: entry.action || nextEntry.step, currentUrl: nextEntry.url || job.currentUrl || '' });
  return nextEntry;
}

function parseClinicLabel(value = '', index = 0) {
  const fullLabel = String(value || '').replace(/\s+/g, ' ').trim();
  if (!fullLabel) return null;
  const parts = fullLabel.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const codeMatch = fullLabel.match(/\b([A-Z]{1,3}\d{3,5}|[A-Z0-9]{4,8})\b/i);
  const clinicCode = parts[0] && /^[A-Z0-9]{3,10}$/i.test(parts[0]) ? parts[0] : (codeMatch ? codeMatch[1] : '');
  const clinicName = clinicCode && parts[0] === clinicCode ? parts.slice(1).join(' - ') : fullLabel;
  return {
    id: clinicCode || hashValue(fullLabel).slice(0, 12),
    clinicCode,
    clinicName: clinicName || fullLabel,
    fullLabel,
    normalizedLabel: normalizeText(fullLabel),
    isActive: true,
    processingOrder: index + 1,
    source: 'runtime'
  };
}

function parseEnvClinics() {
  const raw = String(process.env.ECURO_CLINICS_JSON || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((clinic, index) => parseClinicLabel(clinic.fullLabel || clinic.full_label || clinic.label || clinic.clinicName || clinic.clinic_name || clinic.clinicCode || clinic.clinic_code || '', index))
      .map((clinic, index) => ({
        ...clinic,
        ...(parsed[index] || {}),
        clinicCode: parsed[index]?.clinicCode || parsed[index]?.clinic_code || clinic?.clinicCode || '',
        clinicName: parsed[index]?.clinicName || parsed[index]?.clinic_name || clinic?.clinicName || '',
        fullLabel: parsed[index]?.fullLabel || parsed[index]?.full_label || clinic?.fullLabel || '',
        isActive: parsed[index]?.isActive !== false && parsed[index]?.is_active !== false,
        processingOrder: Number(parsed[index]?.processingOrder || parsed[index]?.processing_order || index + 1)
      }))
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function normalizeClinicRecord(clinic = {}, index = 0) {
  const label = clinic.fullLabel || clinic.full_label || clinic.label || clinic.clinicName || clinic.clinic_name || clinic.clinicCode || clinic.clinic_code || '';
  const parsed = parseClinicLabel(label, index) || parseClinicLabel(`CL${String(index + 1).padStart(4, '0')} - Clinica ${index + 1}`, index);
  return {
    ...parsed,
    ...clinic,
    clinicCode: clinic.clinicCode || clinic.clinic_code || parsed.clinicCode || '',
    clinicName: clinic.clinicName || clinic.clinic_name || parsed.clinicName || '',
    fullLabel: clinic.fullLabel || clinic.full_label || parsed.fullLabel || label,
    normalizedLabel: normalizeText(clinic.fullLabel || clinic.full_label || parsed.fullLabel || label),
    isActive: clinic.isActive !== false && clinic.is_active !== false,
    processingOrder: Number(clinic.processingOrder || clinic.processing_order || parsed.processingOrder || index + 1),
    source: clinic.source || parsed.source || 'payload'
  };
}

function readClinicsFromStore() {
  const paths = getStorePaths();
  return readJsonFile(paths.clinics, []).map(normalizeClinicRecord).filter((clinic) => clinic.isActive !== false);
}

function upsertClinics(clinics = []) {
  const paths = getStorePaths();
  const current = readJsonFile(paths.clinics, []);
  const byKey = new Map(current.map((clinic) => [normalizeText(clinic.clinicCode || clinic.fullLabel || clinic.clinicName), clinic]));
  const now = new Date().toISOString();
  clinics.map(normalizeClinicRecord).forEach((clinic, index) => {
    const key = normalizeText(clinic.clinicCode || clinic.fullLabel || clinic.clinicName || `clinic-${index}`);
    const previous = byKey.get(key) || {};
    byKey.set(key, {
      ...previous,
      ...clinic,
      id: previous.id || clinic.id || key,
      normalizedLabel: normalizeText(clinic.fullLabel || clinic.clinicName || clinic.clinicCode || key),
      createdAt: previous.createdAt || now,
      updatedAt: now
    });
  });
  const next = Array.from(byKey.values()).sort((left, right) => Number(left.processingOrder || 9999) - Number(right.processingOrder || 9999));
  writeJsonFile(paths.clinics, next);
  return next;
}

function resolveClinicsForSequentialRun(payload = {}) {
  if (Array.isArray(payload.clinics) && payload.clinics.length) {
    return upsertClinics(payload.clinics).filter((clinic) => clinic.isActive !== false);
  }
  if (payload.clinicCode || payload.clinicName || payload.fullLabel) {
    const clinic = normalizeClinicRecord({
      clinicCode: payload.clinicCode || payload.clinic_code || '',
      clinicName: payload.clinicName || payload.clinic_name || '',
      fullLabel: payload.fullLabel || payload.full_label || payload.clinicName || payload.clinicCode || 'clinica_atual',
      source: 'payload'
    }, 0);
    upsertClinics([clinic]);
    return [clinic];
  }
  const stored = readClinicsFromStore();
  if (stored.length) return stored;
  const envClinics = parseEnvClinics();
  if (envClinics.length) return upsertClinics(envClinics).filter((clinic) => clinic.isActive !== false);
  return [];
}

async function loadPlaywright() {
  const moduleRef = await import('playwright');
  return moduleRef.chromium ? moduleRef : moduleRef.default;
}

async function firstVisibleLocator(page, selectors = [], timeout = 900) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout })) return locator;
    } catch (_error) {
      // keep trying
    }
  }
  return null;
}

async function fillFirstVisible(page, selectors, value) {
  const locator = await firstVisibleLocator(page, selectors);
  if (!locator) return false;
  await locator.fill(String(value || ''));
  return true;
}

async function clickFirstVisible(page, selectors) {
  const locator = await firstVisibleLocator(page, selectors);
  if (!locator) return false;
  await locator.click();
  return true;
}

async function waitForPageSettled(page, ms = 1200) {
  await Promise.race([
    page.waitForLoadState('networkidle').catch(() => null),
    page.waitForTimeout(ms)
  ]);
}

async function performLogin(page, config) {
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
  await waitForPageSettled(page, 1200);
  const bodyText = normalizeText(await page.locator('body').innerText().catch(() => ''));
  if (!bodyText.includes('login') && !bodyText.includes('entrar') && (await page.locator('main, nav, aside').count().catch(() => 0))) {
    return { authenticated: true, reusedSession: true };
  }
  const userFilled = await fillFirstVisible(page, config.selectors.login.level1Username, config.level1Username);
  const passFilled = await fillFirstVisible(page, config.selectors.login.level1Password, config.level1Password);
  if (userFilled || passFilled) {
    await clickFirstVisible(page, config.selectors.login.level1Submit);
    await waitForPageSettled(page, 1800);
  }
  const stillHasPassword = await firstVisibleLocator(page, config.selectors.login.level2Password, 700);
  if (stillHasPassword) {
    await fillFirstVisible(page, config.selectors.login.level2Username, config.level2Username || config.level1Username);
    await fillFirstVisible(page, config.selectors.login.level2Password, config.level2Password || config.level1Password);
    await clickFirstVisible(page, config.selectors.login.level2Submit);
    await waitForPageSettled(page, 1800);
  }
  return { authenticated: true, reusedSession: false };
}

async function navigatePatients(page, config) {
  const destination = String(config.selectors.navigation.completedPagePath || `${config.baseUrl}/dashboard/patients`).trim();
  const targetUrl = destination.startsWith('http') ? destination : `${config.baseUrl}${destination.startsWith('/') ? '' : '/'}${destination}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
  await waitForPageSettled(page, 2500);
  await page.waitForTimeout(1500);
}

async function getCurrentClinicFromPage(page, payloadClinic = {}) {
  const raw = await page.evaluate(() => {
    const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const candidates = Array.from(document.querySelectorAll('body *'))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: textOf(element.innerText || element.textContent), top: rect.top, left: rect.left };
      })
      .filter((item) => item.text && item.top >= 0 && item.top < 240)
      .filter((item) => /[A-Z0-9]{4,}\s*-\s+.+/i.test(item.text))
      .sort((left, right) => left.top - right.top || left.left - right.left);
    return candidates[0]?.text || '';
  }).catch(() => '');
  const parsed = parseClinicLabel(raw || payloadClinic.fullLabel || payloadClinic.clinicName || payloadClinic.clinicCode || '');
  return parsed || normalizeClinicRecord(payloadClinic, 0);
}

async function clickClinicSelector(page) {
  return page.evaluate(() => {
    const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], body *'))
      .filter(isVisible)
      .filter((element) => /[A-Z0-9]{4,}\s*-\s+.+/i.test(textOf(element.innerText || element.textContent)))
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
    const target = candidates[0];
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);
}

async function selectClinicIfNeeded(page, clinic, config) {
  const current = await getCurrentClinicFromPage(page, clinic);
  if (!clinic?.clinicCode && !clinic?.fullLabel && !clinic?.clinicName) {
    return { selected: true, usedCurrent: true, clinic: current };
  }
  const currentText = normalizeText(current.fullLabel || current.clinicName || '');
  const targetCode = normalizeText(clinic.clinicCode || '');
  const targetText = normalizeText(clinic.fullLabel || clinic.clinicName || '');
  if ((targetCode && normalizeText(current.clinicCode || '').includes(targetCode)) || (targetText && (currentText.includes(targetText) || targetText.includes(currentText)))) {
    return { selected: true, usedCurrent: true, clinic: { ...clinic, ...current, fullLabel: current.fullLabel || clinic.fullLabel } };
  }

  for (let attempt = 1; attempt <= Math.max(1, config.clinicSelectionMaxAttempts || 3); attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const opened = await clickClinicSelector(page);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(700);
    if (!opened) continue;

    // eslint-disable-next-line no-await-in-loop
    const selected = await page.evaluate((target) => {
      const normalizeValue = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const targetCodeNorm = normalizeValue(target.clinicCode || '');
      const targetTextNorm = normalizeValue(target.fullLabel || target.clinicName || '');
      const options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] *, .v-overlay *, .v-menu__content *, .cdk-overlay-pane *, li, button, [role="button"]'))
        .filter(isVisible)
        .map((element) => ({ element, text: textOf(element.innerText || element.textContent) }))
        .filter((item) => item.text);
      const match = options.find((item) => {
        const normalized = normalizeValue(item.text);
        return (targetCodeNorm && normalized.includes(targetCodeNorm)) || (targetTextNorm && (normalized.includes(targetTextNorm) || targetTextNorm.includes(normalized)));
      });
      if (!match) return false;
      match.element.click();
      return true;
    }, clinic).catch(() => false);

    if (selected) {
      // eslint-disable-next-line no-await-in-loop
      await waitForPageSettled(page, config.clinicSelectionWaitMs || 3000);
      // eslint-disable-next-line no-await-in-loop
      const after = await getCurrentClinicFromPage(page, clinic);
      return { selected: true, attempts: attempt, clinic: { ...clinic, ...after, fullLabel: after.fullLabel || clinic.fullLabel || clinic.clinicName || clinic.clinicCode } };
    }
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape').catch(() => null);
  }

  if (process.env.ECURO_ALLOW_CURRENT_CLINIC_FALLBACK !== 'false') {
    return { selected: true, usedCurrentFallback: true, clinic: current };
  }
  return { selected: false, clinic: current };
}

async function getDownloadCandidates(page) {
  return page.evaluate(() => {
    const textOf = (element) => String(
      element?.innerText
      || element?.textContent
      || element?.getAttribute?.('aria-label')
      || element?.getAttribute?.('title')
      || element?.getAttribute?.('download')
      || element?.className
      || ''
    ).replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('button, a, [role="button"], [title], [aria-label], [download]'))
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const text = textOf(element);
        const attrs = [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('download'), element.getAttribute('href'), element.className].map(textOf).join(' ');
        const haystack = `${text} ${attrs}`;
        let score = 0;
        if (/excel|xlsx|xls/i.test(haystack)) score += 100;
        if (/export|exportar|download|baixar|arquivo|file|document/i.test(haystack)) score += 40;
        if (/pdf/i.test(haystack)) score -= 80;
        if (rect.top < 420 && rect.left > window.innerWidth * 0.65) score += 15;
        if (rect.width > 0 && rect.height > 0) score += 5;
        return { index, text, attrs, score, top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 30);
  }).catch(() => []);
}

function buildExportPath(config, clinic, targetDate, suggestedFilename = '') {
  const dateKey = normalizeBrazilianDate(targetDate) || resolveEcuroTargetDate({ targetDate });
  const clinicCode = String(clinic.clinicCode || clinic.id || 'clinica-atual').replace(/[^a-z0-9_-]/gi, '_');
  const dir = path.join(config.exportDir, dateKey, clinicCode);
  ensureDir(dir);
  const ext = path.extname(String(suggestedFilename || '')).toLowerCase() || '.xlsx';
  const safeExt = ['.xlsx', '.xls', '.csv'].includes(ext) ? ext : '.xlsx';
  return path.join(dir, `ecuro-patients-${clinicCode}-${dateKey}-${Date.now()}${safeExt}`);
}

async function clickCandidateByIndex(page, index) {
  return page.evaluate((candidateIndex) => {
    const elements = Array.from(document.querySelectorAll('button, a, [role="button"], [title], [aria-label], [download]'));
    const target = elements[candidateIndex];
    if (!target) return false;
    target.click();
    return true;
  }, index).catch(() => false);
}

async function tryDownloadAfterClick(page, clickFn, timeoutMs) {
  const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
  const clicked = await clickFn();
  if (!clicked) {
    downloadPromise.catch(() => null);
    return null;
  }
  try {
    return await downloadPromise;
  } catch (_error) {
    return null;
  }
}

async function downloadExcelFromCurrentPage(page, clinic, config, targetDate, job) {
  const candidates = await getDownloadCandidates(page);
  addLog(job, { level: 'info', step: 'download_excel', action: 'candidates', message: `Candidatos de exportacao encontrados: ${candidates.length}.`, metadata: { candidates: candidates.slice(0, 10) }, url: page.url() });

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    let download = await tryDownloadAfterClick(page, () => clickCandidateByIndex(page, candidate.index), Math.min(12000, config.excelDownloadTimeoutMs || 60000));
    if (!download) {
      // It may have opened a menu. Try menu item containing Excel.
      // eslint-disable-next-line no-await-in-loop
      download = await tryDownloadAfterClick(page, () => page.evaluate(() => {
        const textOf = (element) => String(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || element?.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const target = Array.from(document.querySelectorAll('button, a, [role="menuitem"], [role="option"], [role="button"], li'))
          .filter(isVisible)
          .find((element) => /excel|xlsx|xls/i.test(textOf(element)) && !/pdf/i.test(textOf(element)));
        if (!target) return false;
        target.click();
        return true;
      }), Math.min(12000, config.excelDownloadTimeoutMs || 60000));
    }
    if (!download) continue;
    const suggested = download.suggestedFilename() || '';
    if (/\.pdf$/i.test(suggested)) {
      addLog(job, { level: 'warning', step: 'download_excel', action: 'pdf_ignored', message: `Download PDF ignorado: ${suggested}.`, metadata: { candidate } });
      continue;
    }
    const filePath = buildExportPath(config, clinic, targetDate, suggested);
    // eslint-disable-next-line no-await-in-loop
    await download.saveAs(filePath);
    return { filePath, suggestedFilename: suggested, candidate, clickResult: { clicked: true, selector: `candidate_${candidate.index}` } };
  }

  const error = new Error('Nao foi possivel encontrar/clicar no botao Excel ou obter download da tela atual do Ecuro.');
  error.code = 'excel_download_failed';
  error.candidates = candidates.slice(0, 20);
  throw error;
}

function buildPatientKey(patient = {}) {
  const phone = normalizePhone(patient.patientPhone || '').normalized || String(patient.patientPhone || '');
  return [patient.clinicCode || '', patient.externalPatientId || '', phone, patient.document || patient.patientName || ''].map((part) => normalizeText(part)).join('|');
}

function persistPatientsAndQueue({ patients = [], clinic = {}, targetDate = '', source = 'ecuro_excel_sequential', dryRun = true }) {
  const paths = getStorePaths();
  const now = new Date().toISOString();
  const storedPatients = readJsonFile(paths.patients, []);
  const storedQueue = readJsonFile(paths.queue, []);
  const byPatientKey = new Map(storedPatients.map((patient) => [buildPatientKey(patient), patient]));
  const queueByPhoneDate = new Set(storedQueue.map((item) => `${normalizePhone(item.patientPhone || '').normalized || item.patientPhone}|${item.lastConsultationDate || item.targetDate}|${item.source || source}`));
  const runPhoneDate = new Set();
  const savedPatients = [];
  const queueItems = [];
  const normalizedTargetDate = normalizeBrazilianDate(targetDate);

  patients.forEach((patient) => {
    const normalizedPhone = normalizePhone(patient.patientPhone || '');
    const lastConsultationDate = normalizeBrazilianDate(patient.lastConsultationDate || '');
    let nextPatient = {
      ...patient,
      clinicCode: patient.clinicCode || clinic.clinicCode || '',
      clinicName: patient.clinicName || clinic.fullLabel || clinic.clinicName || '',
      patientPhoneNormalized: normalizedPhone.normalized || null,
      documentMasked: maskDocument(patient.document || ''),
      source,
      firstSeenAt: patient.firstSeenAt || now,
      lastSeenAt: now,
      updatedAt: now
    };
    const patientKey = buildPatientKey(nextPatient);
    const previous = byPatientKey.get(patientKey);
    nextPatient = { ...(previous || {}), ...nextPatient, createdAt: previous?.createdAt || now };
    byPatientKey.set(patientKey, nextPatient);
    savedPatients.push(nextPatient);

    if (nextPatient.eligibilityStatus !== 'eligible') return;
    const phoneKey = `${normalizedPhone.normalized || nextPatient.patientPhone}|${lastConsultationDate}|${source}`;
    if (!normalizedPhone.valid || !lastConsultationDate || lastConsultationDate !== normalizedTargetDate || queueByPhoneDate.has(phoneKey) || runPhoneDate.has(phoneKey)) {
      nextPatient.eligibilityStatus = 'duplicate';
      return;
    }
    runPhoneDate.add(phoneKey);
    queueByPhoneDate.add(phoneKey);
    queueItems.push({
      id: `nps-${hashValue(phoneKey).slice(0, 16)}`,
      clinicCode: nextPatient.clinicCode,
      clinicName: nextPatient.clinicName,
      externalPatientId: nextPatient.externalPatientId || null,
      patientName: nextPatient.patientName,
      patientPhone: nextPatient.patientPhone,
      patientPhoneNormalized: normalizedPhone.normalized,
      lastConsultationDate,
      targetDate: normalizedTargetDate,
      status: dryRun ? 'dry_run' : 'pending',
      source,
      idempotencyKey: phoneKey,
      createdAt: now,
      updatedAt: now
    });
  });

  writeJsonFile(paths.patients, Array.from(byPatientKey.values()));
  writeJsonFile(paths.queue, [...storedQueue, ...queueItems]);
  return { savedPatients, queueItems };
}

function saveClinicRun(run) {
  const paths = getStorePaths();
  const current = readJsonFile(paths.clinicRuns, []);
  const next = [...current, { ...run, createdAt: run.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }].slice(-5000);
  writeJsonFile(paths.clinicRuns, next);
}

async function captureFailureArtifacts(page, config, job, reason, payload = {}) {
  ensureDir(config.screenshotDir);
  ensureDir(config.htmlDir);
  ensureDir(config.debugDir);
  const safeReason = String(reason || 'error').replace(/[^a-z0-9_-]/gi, '-');
  const base = `${job.id}-${new Date().toISOString().replace(/[:.]/g, '-')}-${safeReason}`;
  const screenshotPath = path.join(config.screenshotDir, `${base}.png`);
  const htmlPath = path.join(config.htmlDir, `${base}.html`);
  const debugPath = path.join(config.debugDir, `${base}.json`);
  const artifacts = [];
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    artifacts.push(buildJobStoreArtifact(job.id, 'screenshot', screenshotPath, safeReason));
  } catch (_error) {}
  try {
    fs.writeFileSync(htmlPath, await page.content(), 'utf8');
    artifacts.push(buildJobStoreArtifact(job.id, 'html', htmlPath, safeReason));
  } catch (_error) {}
  try {
    fs.writeFileSync(debugPath, JSON.stringify({
      ...payload,
      currentUrl: page.url(),
      bodyText: await page.locator('body').innerText().catch(() => '')
    }, null, 2), 'utf8');
    artifacts.push(buildJobStoreArtifact(job.id, 'debug_json', debugPath, safeReason));
  } catch (_error) {}
  if (artifacts.length) {
    job.artifacts = [...(job.artifacts || []), ...artifacts];
    jobStore.update(job.id, { artifacts: job.artifacts });
  }
  return artifacts;
}

function createSequentialJob(payload, type = 'ecuro_daily_nps_collection_job') {
  const job = jobStore.create({
    jobType: type,
    clinicId: payload.clinicId || null,
    clinicName: payload.clinicName || payload.clinicCode || '',
    appointmentDate: payload.targetDate || '',
    payload: { ...payload, dryRun: true }
  });
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.logs = [];
  job.artifacts = [];
  jobStore.update(job.id, { status: 'running', startedAt: job.startedAt, logs: [], artifacts: [] });
  return job;
}

async function processClinicExcel({ page, config, job, clinic, targetDate, source, dryRun, selectClinic = true, index = 0, total = 1 }) {
  const startedAt = new Date().toISOString();
  let activeClinic = clinic;
  addLog(job, { level: 'info', step: 'clinic_start', action: 'processing', message: `Iniciando clínica ${clinic.fullLabel || clinic.clinicName || clinic.clinicCode || 'atual'} (${index + 1}/${total}).`, url: page.url(), metadata: { clinic } });

  if (selectClinic) {
    const selection = await selectClinicIfNeeded(page, clinic, config);
    if (!selection.selected) {
      const error = new Error('Nao foi possivel selecionar a clinica no Ecuro.');
      error.code = 'clinic_selection_failed';
      throw error;
    }
    activeClinic = normalizeClinicRecord(selection.clinic || clinic, index);
  } else {
    activeClinic = normalizeClinicRecord(await getCurrentClinicFromPage(page, clinic), index);
  }
  upsertClinics([{ ...activeClinic, lastSelectedAt: new Date().toISOString() }]);
  await waitForPageSettled(page, 2000);

  const download = await downloadExcelFromCurrentPage(page, activeClinic, config, targetDate, job);
  job.artifacts = [...(job.artifacts || []), buildJobStoreArtifact(job.id, 'excel_export', download.filePath, 'excel_export', { clinic: activeClinic, targetDate })];
  jobStore.update(job.id, { artifacts: job.artifacts });

  const parsed = parseEcuroPatientsExcel(download.filePath, activeClinic, config, { targetDate, dateMode: 'today', source, seenKeys: new Set() });
  const patients = (parsed.patients || []).map((patient) => ({
    ...patient,
    clinicCode: patient.clinicCode || activeClinic.clinicCode || '',
    clinicName: patient.clinicName || activeClinic.fullLabel || activeClinic.clinicName || '',
    source
  }));
  const persisted = persistPatientsAndQueue({ patients, clinic: activeClinic, targetDate, source, dryRun });
  const summary = summarizeCompletionResults(patients);
  const run = {
    id: `${job.id}-${activeClinic.clinicCode || index + 1}`,
    jobId: job.id,
    clinicCode: activeClinic.clinicCode || '',
    clinicName: activeClinic.fullLabel || activeClinic.clinicName || '',
    status: parsed.rowsRead > 0 ? 'completed' : 'partial',
    startedAt,
    finishedAt: new Date().toISOString(),
    excelFilePath: download.filePath,
    totalRowsRead: parsed.rowsRead || patients.length || 0,
    totalPatientsSaved: persisted.savedPatients.length,
    totalEligible: summary.totalEligible || 0,
    totalNpsQueued: persisted.queueItems.length,
    totalOutOfDate: summary.totalOutOfDate || 0,
    totalInvalidPhone: summary.totalInvalidPhone || 0,
    totalDuplicatePhone: summary.totalDuplicate || 0,
    totalDuplicateNps: Math.max(0, (summary.totalEligible || 0) - persisted.queueItems.length),
    totalFailed: summary.totalFailed || 0,
    exportFilePath: download.filePath,
    selectedExcelExportEndpoint: download.selectedExcelExportEndpoint || null,
    errorMessage: parsed.rowsRead > 0 ? null : 'Excel baixado, mas nenhuma linha de paciente foi lida.'
  };
  saveClinicRun(run);
  addLog(job, { level: run.totalRowsRead > 0 ? 'info' : 'warning', step: 'clinic_completed', action: 'completed', message: `Clínica ${run.clinicName}: ${run.totalRowsRead} linhas, ${run.totalEligible} elegíveis, ${run.totalNpsQueued} na fila dry-run.`, url: page.url(), metadata: run });
  return { run, patients, download, parsed, queueItems: persisted.queueItems };
}

async function runSequentialExcelClinicsJob(payload = {}, config = getEcuroRobotConfig()) {
  const dryRun = true;
  const source = payload.source || 'ecuro_excel_sequential_clinics';
  const targetDate = resolveEcuroTargetDate({ ...payload, dateMode: 'today' });
  const job = createSequentialJob({ ...payload, targetDate, source, dryRun }, 'ecuro_daily_nps_collection_job');
  const clinicsFromConfig = resolveClinicsForSequentialRun(payload);
  const maxClinics = Math.max(1, Number(payload.maxClinics || payload.max_clinics || config.maxClinicsPerRunHomolog || 2) || 2);
  const clinicsToProcess = clinicsFromConfig.slice(0, maxClinics);
  ensureDir(config.exportDir);
  let session;
  let page;

  const clinicRuns = [];
  const results = [];
  const queueItems = [];
  let totalFilesDownloaded = 0;
  let totalClinicsFailed = 0;

  try {
    addLog(job, { level: 'info', step: 'login', action: 'login', message: 'Login Ecuro iniciado para processamento sequencial por clínica.' });
    session = await createAuthenticatedEcuroSession(config);
    ({ page } = session);
    addLog(job, { level: 'info', step: 'login', action: 'authenticated', message: 'Sessao autenticada Ecuro criada para processamento sequencial por clínica.', url: page.url() });
    await navigatePatients(page, config);

    let effectiveClinics = clinicsToProcess;
    if (!effectiveClinics.length) {
      const current = await getCurrentClinicFromPage(page, {});
      effectiveClinics = [current];
      upsertClinics([current]);
      addLog(job, { level: 'warning', step: 'clinics', action: 'current_fallback', message: 'Nenhuma lista de clínicas configurada. Processando apenas a clínica atual da tela.', metadata: { current } });
    }

    for (let index = 0; index < effectiveClinics.length; index += 1) {
      const clinic = effectiveClinics[index];
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await processClinicExcel({ page, config, job, clinic, targetDate, source, dryRun, selectClinic: true, index, total: effectiveClinics.length });
        clinicRuns.push(result.run);
        results.push(...result.patients);
        queueItems.push(...result.queueItems);
        totalFilesDownloaded += result.download?.filePath ? 1 : 0;
      } catch (clinicError) {
        totalClinicsFailed += 1;
        const run = {
          id: `${job.id}-${clinic.clinicCode || index + 1}`,
          jobId: job.id,
          clinicCode: clinic.clinicCode || '',
          clinicName: clinic.fullLabel || clinic.clinicName || '',
          status: clinicError.code || 'failed',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          totalRowsRead: 0,
          totalPatientsSaved: 0,
          totalEligible: 0,
          totalFailed: 1,
          errorMessage: clinicError.message
        };
        clinicRuns.push(run);
        saveClinicRun(run);
        // eslint-disable-next-line no-await-in-loop
        await captureFailureArtifacts(page, config, job, `sequential-clinic-${clinic.clinicCode || index + 1}-error`, { clinic, error: clinicError.message, candidates: clinicError.candidates || [] });
        addLog(job, { level: 'error', step: 'clinic_failed', action: clinicError.code || 'failed', message: clinicError.message, url: page.url(), metadata: { clinic } });
      }
      const delayMs = Math.max(0, Number(process.env.ECURO_DELAY_BETWEEN_CLINICS_SECONDS || 10) || 10) * 1000;
      if (delayMs) {
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(delayMs);
      }
    }

    const summary = summarizeCompletionResults(results);
    const finalStatus = results.length > 0 && totalClinicsFailed === 0 ? 'completed' : (results.length > 0 ? 'partial' : 'partial');
    const updated = jobStore.update(job.id, {
      status: finalStatus,
      finishedAt: new Date().toISOString(),
      jobType: 'ecuro_daily_nps_collection_job',
      processingMode: 'sequential',
      collectionMode: 'excel_export',
      targetDate,
      targetDateBr: targetDate.split('-').reverse().join('/'),
      dryRun,
      clinics: clinicRuns,
      results,
      extractedRows: results,
      npsQueuePreview: queueItems,
      totalClinicsQueued: clinicsToProcess.length || 1,
      totalClinicsProcessed: clinicRuns.length,
      totalClinicsCompleted: clinicRuns.filter((run) => run.status === 'completed').length,
      totalClinicsFailed,
      totalFilesDownloaded,
      totalRowsRead: results.length,
      totalRead: results.length,
      totalPatientsSaved: results.length,
      totalNpsQueued: queueItems.length,
      totalSent: 0,
      artifacts: job.artifacts || [],
      logs: job.logs || [],
      currentUrl: page.url(),
      errorMessage: results.length ? null : 'Processamento sequencial finalizado sem pacientes lidos. Verifique botão Excel, clínica selecionada e artefatos.' ,
      ...summary,
      totalFailed: Number(summary.totalFailed || 0) + totalClinicsFailed
    });
    return updated;
  } finally {
    await session?.close().catch(() => null);
    jobStore.resetRuntime();
  }
}

async function runCurrentClinicExcelDryRun(payload = {}, config = getEcuroRobotConfig()) {
  const dryRun = true;
  const source = payload.source || 'ecuro_excel_current_clinic';
  const targetDate = resolveEcuroTargetDate({ ...payload, dateMode: 'today' });
  const job = createSequentialJob({ ...payload, targetDate, source, dryRun }, 'excel_export_current_clinic');
  ensureDir(config.exportDir);
  let session;
  let page;

  try {
    addLog(job, { level: 'info', step: 'login', action: 'login', message: 'Login Ecuro iniciado para Excel da clínica atual.' });
    session = await createAuthenticatedEcuroSession(config);
    ({ page } = session);
    addLog(job, { level: 'info', step: 'login', action: 'authenticated', message: 'Sessao autenticada Ecuro criada para Excel da clínica atual.', url: page.url() });
    await navigatePatients(page, config);
    const currentClinic = await getCurrentClinicFromPage(page, payload);
    const result = await processClinicExcel({ page, config, job, clinic: currentClinic, targetDate, source, dryRun, selectClinic: false, index: 0, total: 1 });
    const summary = summarizeCompletionResults(result.patients || []);
    const updated = jobStore.update(job.id, {
      status: result.run.totalRowsRead > 0 ? 'completed' : 'partial',
      finishedAt: new Date().toISOString(),
      jobType: 'excel_export_current_clinic',
      processingMode: 'single_current_clinic',
      collectionMode: 'excel_export',
      targetDate,
      targetDateBr: targetDate.split('-').reverse().join('/'),
      dryRun,
      clinics: [result.run],
      results: result.patients,
      extractedRows: result.patients,
      npsQueuePreview: result.queueItems,
      totalClinicsQueued: 1,
      totalClinicsProcessed: 1,
      totalClinicsCompleted: result.run.status === 'completed' ? 1 : 0,
      totalClinicsFailed: result.run.status === 'completed' ? 0 : 1,
      totalFilesDownloaded: result.download?.filePath ? 1 : 0,
      totalRowsRead: result.patients.length,
      totalRead: result.patients.length,
      totalPatientsSaved: result.patients.length,
      totalNpsQueued: result.queueItems.length,
      totalSent: 0,
      artifacts: job.artifacts || [],
      logs: job.logs || [],
      currentUrl: page.url(),
      errorMessage: result.run.totalRowsRead > 0 ? null : result.run.errorMessage,
      ...summary
    });
    return updated;
  } catch (error) {
    await captureFailureArtifacts(page, config, job, error.code || 'current-clinic-excel-error', { error: error.message, candidates: error.candidates || [] });
    const updated = jobStore.update(job.id, {
      status: error.code === 'manual_action_required' ? 'manual_action_required' : 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: error.message,
      artifacts: job.artifacts || [],
      logs: job.logs || [],
      totalFailed: 1,
      totalRowsRead: 0,
      totalRead: 0,
      totalFilesDownloaded: 0
    });
    return updated;
  } finally {
    await session?.close().catch(() => null);
    jobStore.resetRuntime();
  }
}

function listEcuroClinics() {
  const stored = readClinicsFromStore();
  const envClinics = parseEnvClinics();
  if (envClinics.length) upsertClinics(envClinics);
  return readClinicsFromStore().length ? readClinicsFromStore() : stored;
}

function listEcuroPatients() {
  const paths = getStorePaths();
  return readJsonFile(paths.patients, []);
}

function listEcuroNpsQueue() {
  const paths = getStorePaths();
  return readJsonFile(paths.queue, []);
}

module.exports = {
  listEcuroClinics,
  listEcuroNpsQueue,
  listEcuroPatients,
  runCurrentClinicExcelDryRun,
  runSequentialExcelClinicsJob,
  upsertClinics
};
