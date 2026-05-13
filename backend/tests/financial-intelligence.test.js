const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFinancialIntelligencePayload,
  calculateFinancialMetrics
} = require('../services/financialIntelligenceService');

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
    selic_rate: 1.08
  });

  assert.equal(metrics.total_crc_cost, 1500);
  assert.equal(metrics.profit, 8500);
  assert.equal(metrics.roi_crc, 566.67);
  assert.equal(metrics.roi_crc_vs_selic, 565.59);
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
    selic_rate: 1.08
  });

  assert.equal(metrics.total_marketing_cost, 1000);
  assert.equal(metrics.profit, 9000);
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
