'use strict';

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '..');
const checks = [];

function addCheck(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'OK' : 'FAIL'} | ${name} | ${detail}`);
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

async function main() {
  console.log('============================================================');
  console.log('NPS ENTERPRISE READINESS - SOMENTE LEITURA');
  console.log('============================================================');

  const requiredFiles = [
    'backend/services/npsEnterpriseService.js',
    'backend/routes/npsEnterpriseRoutes.js',
    'backend/routes/npsEnterpriseStandaloneRouter.js',
    'backend/scripts/applyNpsEnterpriseMigration.js',
    'frontend/src/NpsDashboard.js',
    'frontend/src/NpsManagement.js',
    'frontend/src/npsEnterpriseAnalytics.js',
    'frontend/src/NpsEnterprise.css'
  ];

  requiredFiles.forEach((relativePath) => {
    addCheck(`arquivo:${relativePath}`, fileExists(relativePath), fileExists(relativePath) ? 'presente' : 'ausente');
  });

  const serverPath = path.join(backendDir, 'server.js');
  const serverSource = fs.existsSync(serverPath) ? fs.readFileSync(serverPath, 'utf8') : '';
  const mountLine = "app.use('/nps/enterprise', require('./routes/npsEnterpriseStandaloneRouter'));";
  addCheck('mount enterprise no server.js', serverSource.includes(mountLine), serverSource.includes(mountLine) ? 'montado' : 'não montado');

  const safeFlags = {
    NPS_TEST_MODE: String(process.env.NPS_TEST_MODE || '').toLowerCase(),
    NPS_DISPATCH_ENABLED: String(process.env.NPS_DISPATCH_ENABLED || '').toLowerCase(),
    ECURO_ROBOT_DRY_RUN: String(process.env.ECURO_ROBOT_DRY_RUN || '').toLowerCase()
  };

  addCheck('NPS_TEST_MODE', safeFlags.NPS_TEST_MODE === 'true', safeFlags.NPS_TEST_MODE || 'não definido');
  addCheck('NPS_DISPATCH_ENABLED', safeFlags.NPS_DISPATCH_ENABLED === 'false', safeFlags.NPS_DISPATCH_ENABLED || 'não definido');
  addCheck('ECURO_ROBOT_DRY_RUN', safeFlags.ECURO_ROBOT_DRY_RUN === 'true', safeFlags.ECURO_ROBOT_DRY_RUN || 'não definido');

  const databaseName = String(process.env.DB_NAME || '').trim();
  if (!databaseName) {
    addCheck('DB_NAME', false, 'não configurado');
  } else {
    const pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: databaseName,
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0
    });

    try {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = 'nps_responses'
          AND COLUMN_NAME IN (
            'operational_priority', 'sla_due_at', 'recovery_status',
            'experience_risk_score', 'experience_risk_level'
          )
      `, [databaseName]);
      const columnNames = new Set(columns.map((row) => row.COLUMN_NAME));
      const requiredColumns = [
        'operational_priority', 'sla_due_at', 'recovery_status',
        'experience_risk_score', 'experience_risk_level'
      ];
      requiredColumns.forEach((column) => addCheck(`db:nps_responses.${column}`, columnNames.has(column), columnNames.has(column) ? 'presente' : 'ausente'));

      const [tables] = await pool.query(`
        SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME IN (
            'nps_management_events', 'nps_sla_extensions', 'nps_cause_taxonomy',
            'nps_goals', 'nps_alerts', 'nps_referrals'
          )
      `, [databaseName]);
      const tableNames = new Set(tables.map((row) => row.TABLE_NAME));
      [
        'nps_management_events', 'nps_sla_extensions', 'nps_cause_taxonomy',
        'nps_goals', 'nps_alerts', 'nps_referrals'
      ].forEach((table) => addCheck(`db:${table}`, tableNames.has(table), tableNames.has(table) ? 'presente' : 'ausente'));

      const [causeRows] = tableNames.has('nps_cause_taxonomy')
        ? await pool.query('SELECT COUNT(*) AS total FROM nps_cause_taxonomy WHERE is_active = 1')
        : [[{ total: 0 }]];
      addCheck('taxonomia ativa', Number(causeRows?.[0]?.total || 0) > 0, `${Number(causeRows?.[0]?.total || 0)} item(ns)`);
    } catch (error) {
      addCheck('conexão/verificação DB', false, `${error.code || 'ERROR'}: ${error.message}`);
    } finally {
      await pool.end();
    }
  }

  const failed = checks.filter((check) => !check.ok);

  console.log('============================================================');
  console.log(JSON.stringify({
    status: failed.length ? 'not_ready' : 'ready',
    totalChecks: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    failedChecks: failed.map((check) => check.name)
  }, null, 2));
  console.log('============================================================');

  process.exitCode = failed.length ? 2 : 0;
}

main().catch((error) => {
  console.error('READINESS_FATAL', error);
  process.exit(1);
});
