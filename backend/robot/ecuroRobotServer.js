require('dotenv').config({ quiet: true });

const express = require('express');

const {
  getEcuroRobotConfig,
  getEcuroRobotConfigStatus,
  jobStore,
  retryRobotJob,
  runCheckCompletedBatch,
  runCheckCompletedJob,
  runLoginTest
} = require('../services/ecuroRobotService');

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

app.post('/ecuro/check-completed/batch', async (req, res) => {
  try {
    const jobs = await runCheckCompletedBatch(req.body || {}, getEcuroRobotConfig());
    return res.json({ success: true, jobs });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erro ao processar lote do Ecuro.' });
  }
});

app.get('/ecuro/jobs', (_req, res) => {
  return res.json({ success: true, jobs: jobStore.list() });
});

app.get('/ecuro/jobs/:id', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job não encontrado.' });
  }
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
