'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEntityRanking,
  calculateExperienceRisk,
  calculateNpsMetrics,
  calculateSlaState,
  classifyNpsScore,
  deriveOperationalPriority
} = require('../services/npsEnterpriseService');

test('classifica corretamente toda a escala NPS', () => {
  for (let score = 0; score <= 6; score += 1) {
    assert.equal(classifyNpsScore(score), 'detrator');
  }

  assert.equal(classifyNpsScore(7), 'neutro');
  assert.equal(classifyNpsScore(8), 'neutro');
  assert.equal(classifyNpsScore(9), 'promotor');
  assert.equal(classifyNpsScore(10), 'promotor');
  assert.equal(classifyNpsScore(-1), null);
  assert.equal(classifyNpsScore(11), null);
  assert.equal(classifyNpsScore('abc'), null);
});

test('calcula NPS somente sobre respostas válidas e não sobre convites sem resposta', () => {
  const rows = [
    { score: 10 },
    { score: 9 },
    { score: 8 },
    { score: 7 },
    { score: 5 },
    { score: null },
    { score: 99 }
  ];

  const metrics = calculateNpsMetrics(rows, {
    sentInvites: 8,
    respondedInvites: 2
  });

  assert.equal(metrics.totalResponses, 5);
  assert.equal(metrics.promoters, 2);
  assert.equal(metrics.neutrals, 2);
  assert.equal(metrics.detractors, 1);
  assert.equal(metrics.nps, 20);
  assert.equal(metrics.sentInvites, 10);
  assert.equal(metrics.responseRate, 50);
});

test('calcula taxa de reversão sem alterar o NPS histórico', () => {
  const rows = [
    { score: 4, nps_status: 'tratado', recovery_status: 'recuperado' },
    { score: 3, nps_status: 'tratado', recovery_status: 'nao_recuperado' },
    { score: 10, nps_status: 'registrado' }
  ];

  const metrics = calculateNpsMetrics(rows);

  assert.equal(metrics.nps, -33);
  assert.equal(metrics.treatedDetractors, 2);
  assert.equal(metrics.recoveredDetractors, 1);
  assert.equal(metrics.recoveryRate, 50);
});

test('calcula estado de SLA com vencido, aviso e dentro do prazo', () => {
  const now = new Date('2026-07-08T12:00:00.000Z');

  assert.equal(calculateSlaState({ sla_due_at: '2026-07-08T10:00:00.000Z' }, { now }).code, 'overdue');
  assert.equal(calculateSlaState({ sla_due_at: '2026-07-08T18:00:00.000Z' }, { now, warningHours: 12 }).code, 'warning');
  assert.equal(calculateSlaState({ sla_due_at: '2026-07-10T12:00:00.000Z' }, { now }).code, 'on_time');
  assert.equal(calculateSlaState({ nps_status: 'tratado', sla_due_at: '2026-07-01T00:00:00.000Z' }, { now }).code, 'closed');
});

test('separa prioridade operacional da classificação NPS', () => {
  const item = {
    score: 5,
    detractor_feedback: 'Paciente menciona processo e advogado por cobrança indevida.'
  };

  assert.equal(classifyNpsScore(item.score), 'detrator');
  assert.equal(deriveOperationalPriority(item), 'critica');
  assert.equal(calculateExperienceRisk(item).level, 'alto');
});

test('ranking sinaliza amostra reduzida sem esconder o NPS', () => {
  const rows = [
    { clinic_name: 'A', score: 10 },
    { clinic_name: 'A', score: 9 },
    { clinic_name: 'B', score: 0 },
    { clinic_name: 'B', score: 10 },
    { clinic_name: 'B', score: 9 },
    { clinic_name: 'B', score: 8 },
    { clinic_name: 'B', score: 7 }
  ];

  const ranking = buildEntityRanking(rows, (row) => row.clinic_name, { minimumSample: 5 });
  const clinicA = ranking.find((item) => item.name === 'A');
  const clinicB = ranking.find((item) => item.name === 'B');

  assert.equal(clinicA.sampleStatus, 'amostra_reduzida');
  assert.equal(clinicA.nps, 100);
  assert.equal(clinicB.sampleStatus, 'adequada');
  assert.equal(clinicB.sample, 5);
});
