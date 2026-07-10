export const NPS_PROFILE_LABELS = Object.freeze({
  detrator: 'Detrator',
  neutro: 'Neutro',
  promotor: 'Promotor'
});

export const NPS_STATUS_LABELS = Object.freeze({
  registrado: 'Registrado',
  em_tratativa: 'Em tratamento',
  tratado: 'Tratado'
});

export const PRIORITY_LABELS = Object.freeze({
  normal: 'Normal',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica'
});

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function classifyNps(score) {
  const numeric = Number(score);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 10) return null;
  if (numeric <= 6) return 'detrator';
  if (numeric <= 8) return 'neutro';
  return 'promotor';
}

export function getNpsStatus(item) {
  return item?.nps_status || item?.status || 'registrado';
}

export function getSlaState(item, options = {}) {
  const now = toDate(options.now) || new Date();
  const warningHours = Math.max(1, toNumber(options.warningHours, 12));
  const defaultSlaHours = Math.max(1, toNumber(options.defaultSlaHours, 48));
  const status = getNpsStatus(item);

  if (status === 'tratado' || item?.resolved_at || item?.closed_at) {
    return { code: 'closed', label: 'Concluído', remainingHours: null, dueAt: toDate(item?.sla_due_at) };
  }

  const createdAt = toDate(item?.responded_at || item?.created_at);
  const dueAt = toDate(item?.sla_due_at)
    || (createdAt ? new Date(createdAt.getTime() + defaultSlaHours * 3600000) : null);

  if (!dueAt) return { code: 'unknown', label: 'Sem prazo', remainingHours: null, dueAt: null };

  const remainingHours = Math.round(((dueAt.getTime() - now.getTime()) / 3600000) * 10) / 10;
  if (remainingHours < 0) return { code: 'overdue', label: 'Vencido', remainingHours, dueAt };
  if (remainingHours <= warningHours) return { code: 'warning', label: 'Próximo do vencimento', remainingHours, dueAt };
  return { code: 'on_time', label: 'Dentro do prazo', remainingHours, dueAt };
}

const criticalTerms = [
  'processo', 'advogado', 'procon', 'ministerio publico', 'denuncia', 'morte',
  'infeccao', 'lesao', 'dano', 'fraude', 'cobranca indevida', 'rede social', 'imprensa'
];

const highTerms = [
  'dor', 'abandono', 'cancelamento', 'estorno', 'reembolso', 'erro',
  'tratamento incompleto', 'sem retorno', 'atraso'
];

export function derivePriority(item) {
  const explicit = normalizeText(item?.operational_priority || item?.priority);
  if (['normal', 'media', 'alta', 'critica'].includes(explicit)) return explicit;

  const text = normalizeText([
    item?.detractor_feedback,
    item?.improvement_comment,
    item?.comment,
    item?.nps_treatment_comment,
    item?.cause_category,
    item?.cause_subcategory
  ].filter(Boolean).join(' '));
  const score = toNumber(item?.score, 10);
  const recurrence = toNumber(item?.recurrence_count, 0);

  if (criticalTerms.some((term) => text.includes(term)) || recurrence >= 3) return 'critica';
  if (score <= 2 || highTerms.some((term) => text.includes(term)) || recurrence >= 2) return 'alta';
  if (score <= 4) return 'media';
  return 'normal';
}

export function calculateRisk(item) {
  const profile = classifyNps(item?.score);
  const priority = derivePriority(item);
  const sla = getSlaState(item);
  const recurrence = Math.min(5, Math.max(0, toNumber(item?.recurrence_count, 0)));

  let score = 0;
  if (profile === 'detrator') score += 35;
  if (profile === 'neutro') score += 12;
  if (priority === 'critica') score += 30;
  else if (priority === 'alta') score += 20;
  else if (priority === 'media') score += 10;
  if (sla.code === 'overdue') score += 20;
  else if (sla.code === 'warning') score += 10;
  score += recurrence * 3;
  score = Math.min(100, Math.round(score));

  return {
    score,
    level: score >= 75 ? 'critico' : score >= 50 ? 'alto' : score >= 25 ? 'moderado' : 'baixo'
  };
}

export function calculateMetrics(rows = [], automationSummary = {}) {
  const validRows = rows.filter((item) => classifyNps(item?.score) !== null);
  const total = validRows.length;
  const promoters = validRows.filter((item) => classifyNps(item.score) === 'promotor').length;
  const neutrals = validRows.filter((item) => classifyNps(item.score) === 'neutro').length;
  const detractors = validRows.filter((item) => classifyNps(item.score) === 'detrator').length;
  const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;
  const pendingDetractors = validRows.filter((item) => classifyNps(item.score) === 'detrator' && getNpsStatus(item) !== 'tratado').length;
  const inTreatment = validRows.filter((item) => getNpsStatus(item) === 'em_tratativa').length;
  const treated = validRows.filter((item) => getNpsStatus(item) === 'tratado').length;
  const overdue = validRows.filter((item) => getSlaState(item).code === 'overdue').length;
  const slaManaged = validRows.filter((item) => ['on_time', 'warning', 'overdue'].includes(getSlaState(item).code));
  const withinSla = slaManaged.filter((item) => ['on_time', 'warning'].includes(getSlaState(item).code)).length;
  const slaCompliance = slaManaged.length ? Math.round((withinSla / slaManaged.length) * 10000) / 100 : 0;

  const sentInvites = Math.max(0,
    toNumber(automationSummary.sentInvites)
    + toNumber(automationSummary.respondedInvites)
  );
  const responseRate = sentInvites ? Math.round((total / sentInvites) * 10000) / 100 : 0;

  const referrals = validRows.reduce((sum, item) => sum + toNumber(item.referral_count || (item.recommend_yes ? 1 : 0), 0), 0);
  const referralConversions = validRows.reduce((sum, item) => sum + toNumber(item.referral_converted_count, 0), 0);
  const referralConversionRate = referrals ? Math.round((referralConversions / referrals) * 10000) / 100 : 0;

  const treatedDetractors = validRows.filter((item) => classifyNps(item.score) === 'detrator' && getNpsStatus(item) === 'tratado');
  const recovered = treatedDetractors.filter((item) => String(item.recovery_status || '') === 'recuperado').length;
  const recoveryRate = treatedDetractors.length ? Math.round((recovered / treatedDetractors.length) * 10000) / 100 : 0;

  return {
    total,
    promoters,
    neutrals,
    detractors,
    nps,
    promotersPercent: total ? Math.round((promoters / total) * 10000) / 100 : 0,
    neutralsPercent: total ? Math.round((neutrals / total) * 10000) / 100 : 0,
    detractorsPercent: total ? Math.round((detractors / total) * 10000) / 100 : 0,
    pendingDetractors,
    inTreatment,
    treated,
    overdue,
    slaCompliance,
    sentInvites,
    responseRate,
    referrals,
    referralConversions,
    referralConversionRate,
    recovered,
    recoveryRate
  };
}

export function groupBy(items = [], selector) {
  const map = new Map();
  items.forEach((item) => {
    const key = String(selector(item) || 'Não informado').trim() || 'Não informado';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

export function buildEntityRanking(rows = [], selector, minimumSample = 5) {
  const groups = groupBy(rows.filter((item) => classifyNps(item.score) !== null), selector);

  return Array.from(groups.entries()).map(([name, groupRows]) => {
    const metrics = calculateMetrics(groupRows);
    const risks = groupRows.map((item) => calculateRisk(item).score);
    const averageRisk = risks.length ? Math.round(risks.reduce((sum, value) => sum + value, 0) / risks.length) : 0;

    return {
      name,
      sample: metrics.total,
      nps: metrics.nps,
      promotersPercent: metrics.promotersPercent,
      neutralsPercent: metrics.neutralsPercent,
      detractorsPercent: metrics.detractorsPercent,
      pendingDetractors: metrics.pendingDetractors,
      overdue: metrics.overdue,
      slaCompliance: metrics.slaCompliance,
      averageRisk,
      sampleStatus: metrics.total < minimumSample ? 'amostra_reduzida' : 'adequada'
    };
  }).sort((left, right) => {
    if (left.sampleStatus !== right.sampleStatus) return left.sampleStatus === 'adequada' ? -1 : 1;
    if (right.nps !== left.nps) return right.nps - left.nps;
    return right.sample - left.sample;
  });
}

function periodKey(value, granularity = 'month') {
  const date = toDate(value);
  if (!date) return null;

  if (granularity === 'day') {
    return date.toISOString().slice(0, 10);
  }

  if (granularity === 'week') {
    const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
    return `${copy.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function buildTrendSeries(rows = [], granularity = 'month') {
  const buckets = groupBy(
    rows.filter((item) => classifyNps(item.score) !== null && (item.responded_at || item.created_at)),
    (item) => periodKey(item.responded_at || item.created_at, granularity)
  );

  return Array.from(buckets.entries())
    .filter(([key]) => Boolean(key))
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([period, periodRows]) => ({ period, ...calculateMetrics(periodRows) }));
}

export function buildPareto(rows = []) {
  const counts = new Map();

  rows.forEach((item) => {
    if (classifyNps(item.score) !== 'detrator') return;
    const raw = item.cause_category || item.cause_subcategory || item.detractor_feedback || 'Não classificado';
    const label = String(raw).trim() || 'Não classificado';
    counts.set(label, (counts.get(label) || 0) + 1);
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

export function buildPriorityQueue(rows = []) {
  return rows
    .filter((item) => classifyNps(item.score) === 'detrator' && getNpsStatus(item) !== 'tratado')
    .map((item) => ({
      ...item,
      enterprisePriority: derivePriority(item),
      enterpriseSla: getSlaState(item),
      enterpriseRisk: calculateRisk(item)
    }))
    .sort((left, right) => {
      const priorityOrder = { critica: 4, alta: 3, media: 2, normal: 1 };
      const priorityDiff = priorityOrder[right.enterprisePriority] - priorityOrder[left.enterprisePriority];
      if (priorityDiff !== 0) return priorityDiff;
      if (right.enterpriseRisk.score !== left.enterpriseRisk.score) return right.enterpriseRisk.score - left.enterpriseRisk.score;
      return new Date(left.responded_at || left.created_at || 0) - new Date(right.responded_at || right.created_at || 0);
    });
}

export function buildExecutiveAlerts(rows = []) {
  const alerts = [];
  const queue = buildPriorityQueue(rows);
  const critical = queue.filter((item) => item.enterprisePriority === 'critica');
  const overdue = queue.filter((item) => item.enterpriseSla.code === 'overdue');
  const unassigned = queue.filter((item) => !item.responsible_user_id && !item.responsible_name && !item.nps_treatment_by);
  const noFirstAction = queue.filter((item) => !item.first_action_at && !item.nps_treatment_at);

  if (critical.length) alerts.push({ type: 'critical_detractors', severity: 'critical', title: `${critical.length} detrator(es) crítico(s)`, count: critical.length });
  if (overdue.length) alerts.push({ type: 'sla_overdue', severity: 'critical', title: `${overdue.length} SLA(s) vencido(s)`, count: overdue.length });
  if (unassigned.length) alerts.push({ type: 'unassigned', severity: 'warning', title: `${unassigned.length} caso(s) sem responsável`, count: unassigned.length });
  if (noFirstAction.length) alerts.push({ type: 'no_first_action', severity: 'warning', title: `${noFirstAction.length} caso(s) sem primeira ação`, count: noFirstAction.length });

  return alerts;
}
