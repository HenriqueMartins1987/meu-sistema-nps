'use strict';

const VALID_PROFILES = Object.freeze({
  DETRACTOR: 'detrator',
  NEUTRAL: 'neutro',
  PROMOTER: 'promotor'
});

const VALID_RECOVERY_STATUS = Object.freeze([
  'nao_iniciado',
  'em_tratativa',
  'recuperado',
  'nao_recuperado',
  'sem_retorno'
]);

const VALID_PRIORITIES = Object.freeze(['normal', 'media', 'alta', 'critica']);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function classifyNpsScore(score) {
  const numericScore = Number(score);

  if (!Number.isInteger(numericScore) || numericScore < 0 || numericScore > 10) {
    return null;
  }

  if (numericScore <= 6) return VALID_PROFILES.DETRACTOR;
  if (numericScore <= 8) return VALID_PROFILES.NEUTRAL;
  return VALID_PROFILES.PROMOTER;
}

function isValidNpsResponse(row = {}) {
  return classifyNpsScore(row.score ?? row.npsScore ?? row.nps_score) !== null;
}

function calculateNpsMetrics(rows = [], inviteSummary = {}) {
  const validRows = rows.filter(isValidNpsResponse);
  const totalResponses = validRows.length;
  const promoters = validRows.filter((row) => classifyNpsScore(row.score ?? row.npsScore ?? row.nps_score) === VALID_PROFILES.PROMOTER).length;
  const neutrals = validRows.filter((row) => classifyNpsScore(row.score ?? row.npsScore ?? row.nps_score) === VALID_PROFILES.NEUTRAL).length;
  const detractors = validRows.filter((row) => classifyNpsScore(row.score ?? row.npsScore ?? row.nps_score) === VALID_PROFILES.DETRACTOR).length;
  const nps = totalResponses
    ? Math.round(((promoters - detractors) / totalResponses) * 100)
    : 0;

  const sentInvites = Math.max(0, toNumber(inviteSummary.sentInvites) + toNumber(inviteSummary.respondedInvites));
  const responseRate = sentInvites
    ? Math.round((totalResponses / sentInvites) * 10000) / 100
    : 0;

  const treatedDetractors = validRows.filter((row) => {
    const profile = classifyNpsScore(row.score ?? row.npsScore ?? row.nps_score);
    const status = String(row.nps_status || row.status || '').toLowerCase();
    return profile === VALID_PROFILES.DETRACTOR && status === 'tratado';
  });
  const recoveredDetractors = treatedDetractors.filter((row) => String(row.recovery_status || '') === 'recuperado').length;
  const recoveryRate = treatedDetractors.length
    ? Math.round((recoveredDetractors / treatedDetractors.length) * 10000) / 100
    : 0;

  return {
    totalResponses,
    promoters,
    neutrals,
    detractors,
    promotersPercent: totalResponses ? Math.round((promoters / totalResponses) * 10000) / 100 : 0,
    neutralsPercent: totalResponses ? Math.round((neutrals / totalResponses) * 10000) / 100 : 0,
    detractorsPercent: totalResponses ? Math.round((detractors / totalResponses) * 10000) / 100 : 0,
    nps,
    sentInvites,
    responseRate,
    recoveredDetractors,
    treatedDetractors: treatedDetractors.length,
    recoveryRate
  };
}

function calculateSlaState(item = {}, options = {}) {
  const now = toDate(options.now) || new Date();
  const warningHours = Math.max(1, toNumber(options.warningHours, 12));
  const defaultSlaHours = Math.max(1, toNumber(options.defaultSlaHours, 48));
  const status = String(item.nps_status || item.status || 'registrado').toLowerCase();

  if (status === 'tratado' || item.resolved_at || item.closed_at) {
    return {
      code: 'closed',
      label: 'Concluído',
      remainingHours: null,
      dueAt: toDate(item.sla_due_at)
    };
  }

  const createdAt = toDate(item.responded_at || item.created_at || item.createdAt);
  const explicitDueAt = toDate(item.sla_due_at || item.slaDueAt);
  const dueAt = explicitDueAt || (createdAt ? new Date(createdAt.getTime() + defaultSlaHours * 3600000) : null);

  if (!dueAt) {
    return { code: 'unknown', label: 'Sem prazo', remainingHours: null, dueAt: null };
  }

  const remainingHours = Math.round(((dueAt.getTime() - now.getTime()) / 3600000) * 10) / 10;

  if (remainingHours < 0) {
    return { code: 'overdue', label: 'Vencido', remainingHours, dueAt };
  }

  if (remainingHours <= warningHours) {
    return { code: 'warning', label: 'Próximo do vencimento', remainingHours, dueAt };
  }

  return { code: 'on_time', label: 'Dentro do prazo', remainingHours, dueAt };
}

const CRITICAL_TERMS = [
  'processo',
  'advogado',
  'ministerio publico',
  'procon',
  'denuncia',
  'morte',
  'infeccao',
  'lesao',
  'dano',
  'fraude',
  'cobranca indevida',
  'exposicao publica',
  'rede social',
  'imprensa'
];

const HIGH_TERMS = [
  'dor',
  'abandono',
  'cancelamento',
  'estorno',
  'reembolso',
  'atraso',
  'erro',
  'tratamento incompleto',
  'sem retorno'
];

function deriveOperationalPriority(item = {}) {
  const explicit = normalizeText(item.operational_priority || item.priority);
  if (VALID_PRIORITIES.includes(explicit)) return explicit;

  const text = normalizeText([
    item.detractor_feedback,
    item.improvement_comment,
    item.comment,
    item.nps_treatment_comment,
    item.cause_category,
    item.cause_subcategory
  ].filter(Boolean).join(' '));

  const score = toNumber(item.score ?? item.npsScore ?? item.nps_score, 10);
  const recurrence = toNumber(item.recurrence_count || item.recurrenceCount, 0);

  if (CRITICAL_TERMS.some((term) => text.includes(normalizeText(term))) || recurrence >= 3) return 'critica';
  if (score <= 2 || HIGH_TERMS.some((term) => text.includes(normalizeText(term))) || recurrence >= 2) return 'alta';
  if (score <= 4) return 'media';
  return 'normal';
}

function calculateExperienceRisk(item = {}, options = {}) {
  const profile = classifyNpsScore(item.score ?? item.npsScore ?? item.nps_score);
  const priority = deriveOperationalPriority(item);
  const sla = calculateSlaState(item, options);
  const recurrence = Math.min(5, Math.max(0, toNumber(item.recurrence_count || item.recurrenceCount, 0)));
  const neutralGrowthSignal = Boolean(item.neutral_growth_signal || item.neutralGrowthSignal);

  let score = 0;
  if (profile === VALID_PROFILES.DETRACTOR) score += 35;
  if (profile === VALID_PROFILES.NEUTRAL) score += 12;
  if (priority === 'critica') score += 30;
  else if (priority === 'alta') score += 20;
  else if (priority === 'media') score += 10;
  if (sla.code === 'overdue') score += 20;
  else if (sla.code === 'warning') score += 10;
  score += recurrence * 3;
  if (neutralGrowthSignal) score += 5;

  score = Math.min(100, Math.round(score));

  let level = 'baixo';
  if (score >= 75) level = 'critico';
  else if (score >= 50) level = 'alto';
  else if (score >= 25) level = 'moderado';

  return { score, level };
}

function groupRows(rows = [], selector) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = String(selector(row) || 'Não informado').trim() || 'Não informado';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

function buildEntityRanking(rows = [], selector, options = {}) {
  const minimumSample = Math.max(1, toNumber(options.minimumSample, 5));
  const groups = groupRows(rows.filter(isValidNpsResponse), selector);

  return Array.from(groups.entries()).map(([name, groupRowsValue]) => {
    const metrics = calculateNpsMetrics(groupRowsValue);
    const pendingDetractors = groupRowsValue.filter((row) => classifyNpsScore(row.score ?? row.npsScore ?? row.nps_score) === VALID_PROFILES.DETRACTOR
      && String(row.nps_status || row.status || 'registrado') !== 'tratado').length;
    const overdue = groupRowsValue.filter((row) => calculateSlaState(row, options).code === 'overdue').length;
    const risks = groupRowsValue.map((row) => calculateExperienceRisk(row, options).score);
    const averageRisk = risks.length ? Math.round(risks.reduce((sum, value) => sum + value, 0) / risks.length) : 0;

    return {
      name,
      sample: metrics.totalResponses,
      sampleStatus: metrics.totalResponses < minimumSample ? 'amostra_reduzida' : 'adequada',
      nps: metrics.nps,
      promotersPercent: metrics.promotersPercent,
      neutralsPercent: metrics.neutralsPercent,
      detractorsPercent: metrics.detractorsPercent,
      pendingDetractors,
      overdue,
      averageRisk
    };
  }).sort((left, right) => {
    if (left.sampleStatus !== right.sampleStatus) return left.sampleStatus === 'adequada' ? -1 : 1;
    if (right.nps !== left.nps) return right.nps - left.nps;
    return right.sample - left.sample;
  });
}

function buildPareto(rows = []) {
  const counts = new Map();

  rows.forEach((row) => {
    if (classifyNpsScore(row.score ?? row.npsScore ?? row.nps_score) !== VALID_PROFILES.DETRACTOR) return;
    const source = row.cause_category || row.cause_subcategory || row.detractor_feedback || 'Não classificado';
    const values = Array.isArray(source) ? source : [source];
    values.filter(Boolean).forEach((value) => {
      const label = String(value).trim();
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  });

  const sorted = Array.from(counts.entries())
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
  const grandTotal = sorted.reduce((sum, item) => sum + item.total, 0);
  let cumulative = 0;

  return sorted.map((item) => {
    cumulative += item.total;
    return {
      ...item,
      cumulativePercent: grandTotal ? Math.round((cumulative / grandTotal) * 10000) / 100 : 0
    };
  });
}

module.exports = {
  CRITICAL_TERMS,
  HIGH_TERMS,
  VALID_PRIORITIES,
  VALID_PROFILES,
  VALID_RECOVERY_STATUS,
  buildEntityRanking,
  buildPareto,
  calculateExperienceRisk,
  calculateNpsMetrics,
  calculateSlaState,
  classifyNpsScore,
  deriveOperationalPriority,
  isValidNpsResponse,
  normalizeText
};
