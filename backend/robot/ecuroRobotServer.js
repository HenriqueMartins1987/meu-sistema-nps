require('dotenv').config({ quiet: true });

const express = require('express');
const fs = require('fs');
const path = require('path');

const {
  getEcuroRobotConfig,
  getEcuroRobotConfigStatus,
  getRobotLiveState,
  getRobotVncStatus,
  jobStore,
  retryRobotJob,
  runCheckCompletedBatch,
  runCheckCompletedJob,
  runCheckCompletedNetworkJob,
  runDiscoverClinicsJob,
  runDiscoverNetworkJob,
  runEcuroAllClinicsNpsAutomation,
  runEcuroExcelExportAllClinicsNpsJob,
  runLoginTest,
  runMappingJob,
  startRobotVncSession,
  stopRobotVncSession
} = require('../services/ecuroRobotService');

const {
  listEcuroClinics,
  listEcuroNpsQueue,
  listEcuroPatients,
  runCurrentClinicExcelDryRun,
  runSequentialExcelClinicsJob,
  upsertClinics
} = require('../services/ecuroSequentialExcelService');

const app = express();
app.use(express.json({ limit: '2mb' }));

function unauthorized(res) {
  return res.status(401).json({ success: false, error: 'Acesso negado ao robô Ecuro.' });
}

app.use((req, res, next) => {
  const expected = String(process.env.ECURO_ROBOT_API_KEY || '').trim();
  const provided = String(req.headers['x-api-key'] || '').trim();
  if (!expected || !provided || expected !== provided) {
    return unauthorized(res);
  }
  return next();
});

app.get('/health', (_req, res) => {
  const configStatus = getEcuroRobotConfigStatus();
  return res.json({
    ok: true,
    service: 'ecuro-robot-service',
    mode: configStatus.mode,
    configured: configStatus.configured,
    browserMode: configStatus.browserMode,
    checkedAt: new Date().toISOString()
  });
});

app.get('/ecuro/live-state', (_req, res) => {
  return res.json({ success: true, live: getRobotLiveState() });
});

app.post('/ecuro/login-test', async (req, res) => {
  try {
    const result = await runLoginTest(req.body || {}, getEcuroRobotConfig());
    return res.status(result.success ? 200 : (result.status === 'manual_action_required' ? 409 : 500)).json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao validar login do Ecuro.' });
  }
});

app.post('/ecuro/check-completed', async (req, res) => {
  try {
    const job = await runCheckCompletedJob(req.body || {}, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao consultar concluídos no Ecuro.' });
  }
});

app.post('/ecuro/discover-clinics', async (req, res) => {
  try {
    const job = await runDiscoverClinicsJob(req.body || {}, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job, clinics: job.discoveredClinics || job.results || [] });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao descobrir clinicas no Ecuro.' });
  }
});

app.post('/ecuro/check-completed/all-clinics', async (req, res) => {
  try {
    const job = await runEcuroAllClinicsNpsAutomation(req.body || {}, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao consultar pacientes em todas as clinicas no Ecuro.' });
  }
});

app.post('/ecuro/discover-network', async (req, res) => {
  try {
    const job = await runDiscoverNetworkJob(req.body || {}, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, discovery: job.discovery || {}, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao descobrir endpoints Network no Ecuro.' });
  }
});

app.post('/ecuro/check-completed/network', async (req, res) => {
  try {
    const job = await runCheckCompletedNetworkJob(req.body || {}, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao consultar pacientes via Network no Ecuro.' });
  }
});

app.post('/ecuro/excel/discover-export', async (req, res) => {
  try {
    const job = await runEcuroExcelExportAllClinicsNpsJob({
      ...(req.body || {}),
      source: 'ecuro_excel_export',
      jobType: 'excel_export_discovery',
      dateMode: req.body?.dateMode || 'today',
      dryRun: true,
      maxClinics: req.body?.maxClinics || req.body?.max_clinics || 1
    }, getEcuroRobotConfig());
    const endpoints = (Array.isArray(job.clinics) ? job.clinics : []).map((clinic) => clinic.selectedExcelExportEndpoint).filter(Boolean);
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job, selectedExcelExportEndpoint: endpoints[0] || null, excelExportEndpoints: endpoints });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao descobrir exportacao Excel no Ecuro.' });
  }
});

app.post('/ecuro/excel/dry-run-current-clinic', async (req, res) => {
  try {
    const job = await runCurrentClinicExcelDryRun({
      ...(req.body || {}),
      source: req.body?.source || 'ecuro_excel_current_clinic',
      dateMode: req.body?.dateMode || 'today',
      dryRun: true
    }, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao executar dry-run Excel da clinica atual no Ecuro.' });
  }
});

app.post('/ecuro/excel/download-one-clinic', async (req, res) => {
  try {
    const job = await runSequentialExcelClinicsJob({
      ...(req.body || {}),
      source: 'ecuro_excel_export',
      jobType: 'excel_export_one_clinic',
      dateMode: req.body?.dateMode || 'today',
      dryRun: true,
      maxClinics: 1
    }, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao baixar Excel de uma clinica no Ecuro.' });
  }
});

app.post('/ecuro/excel/dry-run-one-clinic', async (req, res) => {
  try {
    const job = await runSequentialExcelClinicsJob({
      ...(req.body || {}),
      source: req.body?.source || 'ecuro_excel_export',
      jobType: 'excel_export_nps',
      dateMode: req.body?.dateMode || 'today',
      dryRun: true,
      maxClinics: 1
    }, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao executar dry-run Excel de uma clinica no Ecuro.' });
  }
});

app.post('/ecuro/excel/dry-run-sequential-clinics', async (req, res) => {
  try {
    const job = await runSequentialExcelClinicsJob({
      ...(req.body || {}),
      source: req.body?.source || 'ecuro_excel_sequential_clinics',
      jobType: 'ecuro_daily_nps_collection_job',
      dateMode: req.body?.dateMode || 'today',
      dryRun: true
    }, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao executar dry-run sequencial por clinica no Ecuro.' });
  }
});

app.post('/ecuro/excel/run-sequential-clinics', async (req, res) => {
  try {
    const job = await runSequentialExcelClinicsJob({
      ...(req.body || {}),
      source: req.body?.source || 'ecuro_excel_sequential_clinics',
      jobType: 'ecuro_daily_nps_collection_job',
      dateMode: req.body?.dateMode || 'today',
      dryRun: true
    }, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job, warning: 'Envio real bloqueado: dryRun permanece ativo no robô.' });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao executar sequencial por clinica no Ecuro.' });
  }
});

app.post('/ecuro/excel/dry-run-all-clinics', async (req, res) => {
  try {
    const job = await runSequentialExcelClinicsJob({
      ...(req.body || {}),
      source: req.body?.source || 'ecuro_excel_sequential_clinics',
      jobType: 'ecuro_daily_nps_collection_job',
      dateMode: req.body?.dateMode || 'today',
      dryRun: true
    }, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao executar dry-run Excel sequencial no Ecuro.' });
  }
});

app.post('/ecuro/excel/process-latest', async (_req, res) => {
  const latest = jobStore.list().filter((job) => String(job.jobType || '').includes('excel') || String(job.jobType || '').includes('ecuro_daily')).sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))[0];
  if (!latest) return res.status(404).json({ success: false, error: 'Nenhum job Excel encontrado para processamento.' });
  return res.json({ success: true, job: latest, dryRun: true, message: 'Ultimo job Excel localizado. O processamento real permanece bloqueado pelo dry-run.' });
});

app.get('/ecuro/excel/jobs', (_req, res) => {
  const jobs = jobStore.list().filter((job) => String(job.jobType || '').includes('excel') || String(job.jobType || '').includes('ecuro_daily'));
  return res.json({ success: true, jobs });
});

app.get('/ecuro/excel/jobs/:id', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job || !(String(job.jobType || '').includes('excel') || String(job.jobType || '').includes('ecuro_daily'))) return res.status(404).json({ success: false, error: 'Job Excel nao encontrado.' });
  return res.json({ success: true, job });
});

app.get('/ecuro/excel/artifacts/:id', (req, res) => {
  const artifactId = String(req.params.id || '');
  const artifact = jobStore.list().flatMap((job) => Array.isArray(job.artifacts) ? job.artifacts : []).find((item) => String(item.id) === artifactId);
  if (!artifact?.path) return res.status(404).json({ success: false, error: 'Artefato Excel nao encontrado.' });
  const config = getEcuroRobotConfig();
  const allowed = [config.exportDir, config.debugDir, config.screenshotDir, config.htmlDir].some((basePath) => isPathInside(basePath, artifact.path));
  if (!allowed) return res.status(403).json({ success: false, error: 'Artefato fora das areas permitidas.' });
  return res.sendFile(artifact.path, (error) => {
    if (error) res.status(error.statusCode || 500).json({ success: false, error: 'Nao foi possivel abrir o artefato Excel solicitado.' });
  });
});

app.get('/ecuro/clinics', (_req, res) => {
  return res.json({ success: true, clinics: listEcuroClinics() });
});

app.post('/ecuro/clinics', (req, res) => {
  const clinics = Array.isArray(req.body?.clinics) ? req.body.clinics : [req.body || {}];
  return res.json({ success: true, clinics: upsertClinics(clinics) });
});

app.post('/ecuro/clinics/sync', (req, res) => {
  const clinics = Array.isArray(req.body?.clinics) ? req.body.clinics : [];
  return res.json({ success: true, clinics: upsertClinics(clinics) });
});

app.get('/ecuro/patients', (req, res) => {
  const clinicCode = String(req.query.clinicCode || '').trim();
  const date = String(req.query.lastConsultationDate || req.query.date || '').trim();
  const patients = listEcuroPatients().filter((patient) => {
    if (clinicCode && String(patient.clinicCode || '') !== clinicCode) return false;
    if (date && String(patient.lastConsultationDate || '') !== date) return false;
    return true;
  });
  return res.json({ success: true, patients, total: patients.length });
});

app.get('/ecuro/nps-queue', (_req, res) => {
  const queue = listEcuroNpsQueue();
  return res.json({ success: true, queue, total: queue.length });
});

app.post('/ecuro/check-completed/batch', async (req, res) => {
  try {
    const jobs = await runCheckCompletedBatch(req.body || {}, getEcuroRobotConfig());
    return res.json({ success: true, jobs });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao processar lote do Ecuro.' });
  }
});

app.post('/ecuro/mapping/run', async (req, res) => {
  try {
    const job = await runMappingJob(req.body || {}, getEcuroRobotConfig());
    return res.status(job.status === 'manual_action_required' ? 409 : 200).json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao executar o mapeamento do Ecuro.' });
  }
});

app.get('/ecuro/jobs', (_req, res) => {
  return res.json({ success: true, jobs: jobStore.list() });
});

app.get('/ecuro/jobs/:id', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job não encontrado.' });
  return res.json({ success: true, job });
});

app.post('/ecuro/jobs/:id/retry', async (req, res) => {
  try {
    const job = await retryRobotJob(req.params.id, getEcuroRobotConfig());
    return res.json({ success: true, job });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao reprocessar job do Ecuro.' });
  }
});

app.get('/ecuro/jobs/:id/artifacts/:artifactId', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job não encontrado.' });
  const artifact = (Array.isArray(job.artifacts) ? job.artifacts : []).find((item) => String(item.id) === String(req.params.artifactId));
  if (!artifact?.path) return res.status(404).json({ success: false, error: 'Artefato não encontrado.' });
  return res.sendFile(artifact.path, (error) => {
    if (error) res.status(error.statusCode || 500).json({ success: false, error: 'Não foi possível abrir o artefato solicitado.' });
  });
});

function isPathInside(basePath, filePath) {
  if (!basePath || !filePath) return false;
  const resolvedBase = path.resolve(basePath);
  const resolvedFile = path.resolve(filePath);
  return resolvedFile === resolvedBase || resolvedFile.startsWith(`${resolvedBase}${path.sep}`);
}

app.post('/ecuro/artifacts/open', (req, res) => {
  const artifactPath = String(req.body?.path || '').trim();
  const config = getEcuroRobotConfig();
  if (!artifactPath) return res.status(400).json({ success: false, error: 'Caminho do artefato não informado.' });
  const allowed = [config.screenshotDir, config.htmlDir, config.debugDir, config.exportDir].some((basePath) => isPathInside(basePath, artifactPath));
  if (!allowed) return res.status(403).json({ success: false, error: 'Artefato fora das áreas permitidas.' });
  if (!fs.existsSync(artifactPath)) return res.status(404).json({ success: false, error: 'Arquivo do artefato não encontrado.' });
  return res.sendFile(artifactPath, (error) => {
    if (error) res.status(error.statusCode || 500).json({ success: false, error: 'Não foi possível abrir o artefato solicitado.' });
  });
});

app.get('/ecuro/vnc-status', (_req, res) => {
  return res.json({ success: true, status: getRobotVncStatus(getEcuroRobotConfig()) });
});

app.post('/ecuro/vnc/start', async (_req, res) => {
  const status = await startRobotVncSession(getEcuroRobotConfig());
  return res.json({ success: true, status });
});

app.post('/ecuro/vnc/stop', async (_req, res) => {
  const status = await stopRobotVncSession(getEcuroRobotConfig());
  return res.json({ success: true, status });
});

function startEcuroRobotServer() {
  const config = getEcuroRobotConfig();
  app.listen(config.port, config.host, () => {
    console.log(`[ecuro-robot-service] listening on ${config.host}:${config.port}`);
  });
}

if (require.main === module) {
  startEcuroRobotServer();
}

module.exports = {
  app,
  startEcuroRobotServer
};