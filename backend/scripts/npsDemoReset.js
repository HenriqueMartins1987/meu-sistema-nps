require('dotenv').config({ quiet: true });

const { pool } = require('../server');
const {
  assertNpsDemoModeConfig
} = require('../services/npsDemoModeService');
const {
  resetNpsDemo
} = require('../services/npsTwilioDemoFlowService');

async function main() {
  assertNpsDemoModeConfig();
  console.log('==> Limpando somente dados ficticios da demonstracao NPS Twilio');
  const result = await resetNpsDemo(pool);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error('Falha ao limpar demonstracao NPS:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
