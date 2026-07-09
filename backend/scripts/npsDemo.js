require('dotenv').config({ quiet: true });

const { pool } = require('../server');
const {
  OFFICIAL_NPS_DEMO_PHONE,
  assertNpsDemoModeConfig
} = require('../services/npsDemoModeService');
const {
  startNpsDemo
} = require('../services/npsTwilioDemoFlowService');

function parseArgs(argv = []) {
  const result = {};
  for (const arg of argv) {
    const scenario = arg.match(/^--scenario=(.+)$/);
    if (scenario) result.scenario = scenario[1];
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertNpsDemoModeConfig();

  console.log('==> Iniciando demonstracao NPS via Twilio');
  console.log(`==> Numero oficial de teste: ${OFFICIAL_NPS_DEMO_PHONE}`);
  if (args.scenario) console.log(`==> Cenario tecnico: ${args.scenario}`);

  const result = await startNpsDemo(pool, {
    scenario: args.scenario || null,
    patientName: 'Mariana Oliveira',
    clinicName: 'Unidade Demonstracao',
    patientPhone: OFFICIAL_NPS_DEMO_PHONE
  });

  console.log('==> Resultado:');
  console.log(JSON.stringify({
    success: result.success,
    skipped: result.skipped,
    error: result.error,
    inviteId: result.inviteId,
    conversationId: result.conversationId,
    recipient: result.recipient,
    state: result.state,
    providerMessageId: result.providerMessageId
  }, null, 2));

  if (!result.success) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Falha ao executar demonstracao NPS:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
