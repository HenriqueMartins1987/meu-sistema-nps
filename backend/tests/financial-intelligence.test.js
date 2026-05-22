const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFinancialIntelligencePayload,
  calculateLaborCostComposition,
  calculateFinancialMetrics,
  normalizeFinancialRules
} = require('../services/financialIntelligenceService');

test('financial rules use detailed default tax parameters', () => {
  const rules = normalizeFinancialRules({});

  assert.equal(rules.taxRatePercent, 17.29);
  assert.deepEqual(
    rules.taxComponents.map((item) => [item.label, item.percent]),
    [
      ['IRPJ', 4.8],
      ['Adicional IRPJ', 0.96],
      ['CSLL', 2.88],
      ['PIS', 0.65],
      ['COFINS', 3],
      ['ISS', 5]
    ]
  );
});

test('labor cost composition calculates default payroll provisions', () => {
  const labor = calculateLaborCostComposition({ salary: 2000 }, normalizeFinancialRules({}));

  assert.equal(labor.salario_remuneracao_base, 2000);
  assert.equal(labor.fgts, 160);
  assert.equal(labor.decimo_terceiro, 166.67);
  assert.equal(labor.ferias, 166.67);
  assert.equal(labor.terco_ferias, 55.56);
  assert.equal(labor.inss_patronal, 400);
  assert.equal(labor.rat_ajustado, 20);
  assert.equal(labor.terceiros, 116);
  assert.equal(labor.provisao_rescisoria, 80);
  assert.equal(labor.custo_absenteismo, 40);
  assert.equal(labor.custo_turnover, 40);
  assert.equal(labor.custo_total_mensal, 3244.9);
  assert.equal(labor.custo_total_anual, 38938.8);
  assert.equal(labor.components.find((component) => component.key === 'fgts').percent, 4.93);
});

test('labor cost composition respects Simples Nacional payroll toggle', () => {
  const labor = calculateLaborCostComposition(
    { salary: 2000 },
    normalizeFinancialRules({ laborCostRules: { aplicarInssPatronal: false } })
  );

  assert.equal(labor.inss_patronal, 0);
  assert.equal(labor.rat_ajustado, 0);
  assert.equal(labor.terceiros, 0);
  assert.equal(labor.encargos_obrigatorios, 160);
});

test('financial intelligence calculates campaign ROI without duplicating monthly CRC costs', () => {
  const metrics = calculateFinancialMetrics({
    revenue: 10000,
    marketing_investment: 1000,
    salary: 2000,
    charges: 500,
    benefits: 500,
    phone_cost: 200,
    system_cost: 300,
    google_ads: 500,
    supervision_cost: 500,
    leads: 100,
    appointments: 40,
    attendances: 30,
    closings: 10,
    selic_rate: 15
  });

  assert.equal(metrics.total_tax_cost, 1729);
  assert.equal(metrics.total_crc_cost, 3229);
  assert.equal(metrics.profit, 6771);
  assert.equal(metrics.roi_crc, 209.69);
  assert.equal(metrics.roi_crc_vs_selic, 194.69);
  assert.equal(metrics.cac, 150);
  assert.equal(metrics.cpl, 15);
  assert.equal(metrics.average_ticket, 1000);
});

test('financial intelligence parses decimal points without multiplying values', () => {
  const metrics = calculateFinancialMetrics({
    revenue: '10000.00',
    marketing_investment: '1000.00',
    leads: 10,
    appointments: 5,
    attendances: 4,
    closings: 2,
    selic_rate: 15
  });

  assert.equal(metrics.total_marketing_cost, 1000);
  assert.equal(metrics.total_tax_cost, 1729);
  assert.equal(metrics.profit, 7271);
  assert.equal(metrics.roas, 10);
});

test('financial intelligence payload keeps historical monthly series with monthly costs', () => {
  const payload = buildFinancialIntelligencePayload([
    {
      date: '2026-04-10',
      clinic_name: 'Clinica A',
      collaborator_name: 'Ana',
      function_name: 'Operador',
      campaign: 'Meta',
      channel: 'WhatsApp',
      revenue: 1000,
      salary: 200,
      leads: 10,
      appointments: 5,
      attendances: 4,
      closings: 2
    },
    {
      date: '2026-05-10',
      clinic_name: 'Clinica A',
      collaborator_name: 'Ana',
      function_name: 'Operador',
      campaign: 'Meta',
      channel: 'WhatsApp',
      revenue: 2000,
      salary: 500,
      leads: 20,
      appointments: 10,
      attendances: 8,
      closings: 4
    }
  ], undefined, {
    byMonth: {
      '2026-04': { collaboratorCost: 200, operationalCost: 100 },
      '2026-05': { collaboratorCost: 500, operationalCost: 100 }
    },
    totalCollaboratorCost: 700,
    totalOperationalCost: 200,
    collaboratorRows: [
      { reference_month: '2026-04', collaborator_name: 'Ana', total_cost: 200 },
      { reference_month: '2026-05', collaborator_name: 'Ana', total_cost: 500 }
    ]
  });

  assert.equal(payload.summary.totalRevenue, 3000);
  assert.equal(payload.summary.totalCollaboratorCost, 700);
  assert.equal(payload.summary.totalOperationalCost, 200);
  assert.equal(payload.historicalSeries.length, 2);
  assert.deepEqual(payload.historicalSeries.map((item) => item.label), ['2026-04', '2026-05']);
  assert.equal(payload.rankings.clinics[0].label, 'Clinica A');
});
