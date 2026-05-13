const DEFAULT_SELIC_RATE = 1.08;

const collaboratorCostFields = [
  'salary',
  'charges',
  'benefits',
  'commission',
  'bonus',
  'overtime',
  'transport_voucher',
  'food_voucher',
  'meal_voucher',
  'health_plan',
  'dental_plan',
  'training',
  'uniforms',
  'individual_equipment',
  'other_collaborator_costs'
];

const operationalCostFields = [
  'phone_cost',
  'system_cost',
  'crm_cost',
  'whatsapp_cost',
  'internet_cost',
  'allocated_energy',
  'infrastructure_cost',
  'allocated_rent',
  'furniture_cost',
  'maintenance_cost',
  'equipment_cost',
  'software_licenses',
  'technical_support',
  'other_operational_costs'
];

const marketingCostFields = [
  'marketing_investment',
  'google_ads',
  'meta_ads',
  'tv',
  'radio',
  'agency',
  'designer',
  'video_production',
  'influencers',
  'landing_page',
  'automation_tools',
  'other_marketing_costs'
];

const administrativeCostFields = [
  'management_cost',
  'consulting_cost',
  'other_administrative_costs'
];

const integerFields = ['leads', 'appointments', 'attendances', 'closings'];

const moneyFields = [
  'revenue',
  ...collaboratorCostFields,
  ...operationalCostFields,
  ...marketingCostFields,
  ...administrativeCostFields
];

const editableFinancialFields = [
  'date',
  'clinic_id',
  'clinic_name',
  'unit_name',
  'supervisor_id',
  'supervisor_name',
  'operator_id',
  'operator_name',
  'collaborator_id',
  'collaborator_name',
  'role',
  'function_name',
  'campaign',
  'channel',
  ...integerFields,
  'revenue',
  'marketing_investment',
  ...collaboratorCostFields,
  ...operationalCostFields,
  'google_ads',
  'meta_ads',
  'tv',
  'radio',
  'agency',
  'designer',
  'video_production',
  'influencers',
  'landing_page',
  'automation_tools',
  'other_marketing_costs',
  ...administrativeCostFields,
  'selic_rate',
  'notes'
];

const collaboratorDefaultFields = [
  'salary',
  'charges',
  'benefits',
  'commission_default',
  'phone_cost_default',
  'system_cost_default',
  'infrastructure_cost_default',
  'other_costs_default'
];

const expectedMargins = {
  netMargin: { label: 'Margem líquida saudável', min: 20, max: 35, suffix: '%' },
  marketingRoi: { label: 'ROI Marketing previsto', min: 400, max: 800, suffix: '%' },
  roas: { label: 'ROAS previsto', min: 4, max: 8, suffix: 'x' },
  cac: { label: 'CAC previsto', min: 80, max: 120, prefix: 'R$' },
  cpl: { label: 'CPL previsto', min: 15, max: 25, prefix: 'R$' },
  leadToAppointment: { label: 'Lead > Agendamento previsto', min: 20, max: 40, suffix: '%' },
  attendanceRate: { label: 'Comparecimento previsto', min: 70, max: 85, suffix: '%' },
  closingRate: { label: 'Fechamento previsto', min: 40, max: 60, suffix: '%' },
  crcRoi: { label: 'ROI CRC previsto', min: 150, max: null, suffix: '%' }
};

const DEFAULT_FINANCIAL_RULES = {
  crcRoiExcellent: 150,
  netMarginHealthyMin: 20,
  selicComparisonTolerance: 1,
  expectedMargins
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  let normalized = String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[R$%]/g, '');

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }

  normalized = normalized.replace(/[^\d.-]/g, '');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function safeDivide(numerator, denominator, multiplier = 1) {
  const divisor = toNumber(denominator);
  if (!divisor) return 0;
  return round((toNumber(numerator) / divisor) * multiplier);
}

function sumFields(row, fields) {
  return fields.reduce((total, field) => total + toNumber(row[field]), 0);
}

function normalizeFinancialRules(rules = {}) {
  const expected = {};

  Object.keys(expectedMargins).forEach((key) => {
    const merged = {
      ...expectedMargins[key],
      ...(rules.expectedMargins?.[key] || {})
    };
    expected[key] = {
      ...merged,
      min: toNumber(merged.min),
      max: merged.max === null || merged.max === '' || merged.max === undefined ? null : toNumber(merged.max)
    };
  });

  return {
    crcRoiExcellent: toNumber(rules.crcRoiExcellent) || DEFAULT_FINANCIAL_RULES.crcRoiExcellent,
    netMarginHealthyMin: toNumber(rules.netMarginHealthyMin) || DEFAULT_FINANCIAL_RULES.netMarginHealthyMin,
    selicComparisonTolerance: toNumber(rules.selicComparisonTolerance) || DEFAULT_FINANCIAL_RULES.selicComparisonTolerance,
    expectedMargins: expected
  };
}

function classifyFinancialStatus(metrics, rules = DEFAULT_FINANCIAL_RULES) {
  if (metrics.profit < 0 || metrics.roi_crc < 0) return 'critico';
  if (metrics.roi_crc >= rules.crcRoiExcellent && metrics.net_margin >= rules.netMarginHealthyMin) return 'excelente';
  if (metrics.roi_crc >= metrics.selic_rate && metrics.profit >= 0) return 'adequado';
  return 'atencao';
}

function buildRowDiagnosis(row, metrics, rules = DEFAULT_FINANCIAL_RULES) {
  const margins = rules.expectedMargins || expectedMargins;
  const diagnostics = [];

  if (metrics.profit >= 0) diagnostics.push('CRC lucrativo no período.');
  if (metrics.profit < 0) diagnostics.push('CRC deficitário no período.');
  diagnostics.push(metrics.roi_crc >= metrics.selic_rate ? 'ROI do CRC acima da SELIC.' : 'ROI do CRC abaixo da SELIC.');
  if (metrics.marketing_roi < margins.marketingRoi.min && metrics.total_marketing_cost > 0) diagnostics.push('ROI de marketing abaixo da margem prevista.');
  if (metrics.cac > margins.cac.max) diagnostics.push('CAC elevado.');
  if (metrics.cpl > margins.cpl.max) diagnostics.push('CPL elevado.');
  if (metrics.lead_to_appointment < margins.leadToAppointment.min && toNumber(row.leads) > 0) diagnostics.push('Baixa conversão de leads.');
  if (metrics.attendance_rate < margins.attendanceRate.min && toNumber(row.appointments) > 0) diagnostics.push('Baixo comparecimento.');
  if (metrics.closing_rate < margins.closingRate.min && toNumber(row.attendances) > 0) diagnostics.push('Baixo fechamento.');

  return diagnostics;
}

function calculateFinancialMetrics(row, rules = DEFAULT_FINANCIAL_RULES) {
  const normalizedRules = normalizeFinancialRules(rules);
  const revenue = toNumber(row.revenue);
  const totalCollaboratorCost = sumFields(row, collaboratorCostFields);
  const totalOperationalCost = sumFields(row, operationalCostFields);
  const totalMarketingCost = sumFields(row, marketingCostFields);
  const totalAdministrativeCost = sumFields(row, administrativeCostFields);
  const totalCrcCost = totalCollaboratorCost + totalOperationalCost + totalMarketingCost + totalAdministrativeCost;
  const profit = revenue - totalCrcCost;
  const selicRate = toNumber(row.selic_rate) || DEFAULT_SELIC_RATE;
  const metrics = {
    total_collaborator_cost: round(totalCollaboratorCost),
    total_operational_cost: round(totalOperationalCost),
    total_marketing_cost: round(totalMarketingCost),
    total_administrative_cost: round(totalAdministrativeCost),
    total_crc_cost: round(totalCrcCost),
    profit: round(profit),
    roi_crc: safeDivide(profit, totalCrcCost, 100),
    roi_crc_vs_selic: round(safeDivide(profit, totalCrcCost, 100) - selicRate),
    marketing_roi: safeDivide(revenue - totalMarketingCost, totalMarketingCost, 100),
    roas: safeDivide(revenue, totalMarketingCost),
    cac: safeDivide(totalMarketingCost, row.closings),
    cpl: safeDivide(totalMarketingCost, row.leads),
    average_ticket: safeDivide(revenue, row.closings),
    lead_to_appointment: safeDivide(row.appointments, row.leads, 100),
    attendance_rate: safeDivide(row.attendances, row.appointments, 100),
    closing_rate: safeDivide(row.closings, row.attendances, 100),
    net_margin: safeDivide(profit, revenue, 100),
    selic_rate: selicRate
  };

  metrics.status = classifyFinancialStatus(metrics, normalizedRules);
  metrics.diagnosis = buildRowDiagnosis(row, metrics, normalizedRules).join(' ');
  return metrics;
}

function enrichFinancialRow(row, rules = DEFAULT_FINANCIAL_RULES) {
  const metrics = calculateFinancialMetrics(row, rules);

  return {
    ...row,
    ...metrics
  };
}

function monthKey(value) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function groupFinancialRows(rows, getKey) {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = getKey(row) || 'Não informado';
    const current = grouped.get(key) || {
      label: key,
      revenue: 0,
      cost: 0,
      profit: 0,
      marketingCost: 0,
      collaboratorCost: 0,
      leads: 0,
      appointments: 0,
      attendances: 0,
      closings: 0,
      selicRateTotal: 0,
      rows: 0
    };

    current.revenue += toNumber(row.revenue);
    current.cost += toNumber(row.total_crc_cost);
    current.profit += toNumber(row.profit);
    current.marketingCost += toNumber(row.total_marketing_cost);
    current.collaboratorCost += toNumber(row.total_collaborator_cost);
    current.leads += toNumber(row.leads);
    current.appointments += toNumber(row.appointments);
    current.attendances += toNumber(row.attendances);
    current.closings += toNumber(row.closings);
    current.selicRateTotal += toNumber(row.selic_rate || DEFAULT_SELIC_RATE);
    current.rows += 1;
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    revenue: round(item.revenue),
    cost: round(item.cost),
    profit: round(item.profit),
    marketingCost: round(item.marketingCost),
    collaboratorCost: round(item.collaboratorCost),
    roi: safeDivide(item.profit, item.cost, 100),
    marketingRoi: safeDivide(item.revenue - item.marketingCost, item.marketingCost, 100),
    roas: safeDivide(item.revenue, item.marketingCost),
    cac: safeDivide(item.marketingCost, item.closings),
    cpl: safeDivide(item.marketingCost, item.leads),
    averageTicket: safeDivide(item.revenue, item.closings),
    leadToAppointment: safeDivide(item.appointments, item.leads, 100),
    attendanceRate: safeDivide(item.attendances, item.appointments, 100),
    closingRate: safeDivide(item.closings, item.attendances, 100),
    selicRate: item.rows ? round(item.selicRateTotal / item.rows) : DEFAULT_SELIC_RATE
  }));
}

function sortBy(field, direction = 'desc') {
  return (a, b) => direction === 'asc'
    ? toNumber(a[field]) - toNumber(b[field])
    : toNumber(b[field]) - toNumber(a[field]);
}

function buildFinancialDiagnostics(summary, clinicFinancials, collaboratorFinancials, roleFinancials, rules = DEFAULT_FINANCIAL_RULES) {
  const normalizedRules = normalizeFinancialRules(rules);
  const margins = normalizedRules.expectedMargins;
  const diagnostics = [];
  diagnostics.push(summary.profit >= 0 ? 'CRC lucrativo no período.' : 'CRC deficitário no período.');
  diagnostics.push(summary.roiCrc >= summary.selicRate ? 'ROI do CRC acima da SELIC.' : 'ROI do CRC abaixo da SELIC.');

  if (summary.marketingRoi < margins.marketingRoi.min && summary.totalMarketingCost > 0) diagnostics.push('ROI de marketing abaixo da margem prevista.');
  if (summary.cac > margins.cac.max) diagnostics.push('CAC elevado.');
  if (summary.cpl > margins.cpl.max) diagnostics.push('CPL elevado.');
  if (summary.leadToAppointment < margins.leadToAppointment.min && summary.leads > 0) diagnostics.push('Baixa conversão de leads.');
  if (summary.attendanceRate < margins.attendanceRate.min && summary.appointments > 0) diagnostics.push('Baixo comparecimento.');
  if (summary.closingRate < margins.closingRate.min && summary.attendances > 0) diagnostics.push('Baixo fechamento.');

  const deficitClinic = clinicFinancials.find((clinic) => clinic.profit < 0);
  if (deficitClinic) diagnostics.push(`Clínica ${deficitClinic.label} apresenta prejuízo operacional.`);

  const bestClinic = [...clinicFinancials].sort(sortBy('roi'))[0];
  if (bestClinic) diagnostics.push(`Clínica ${bestClinic.label} apresenta maior ROI da rede.`);

  const highestCostCollaborator = [...collaboratorFinancials].sort(sortBy('collaboratorCost'))[0];
  if (highestCostCollaborator) diagnostics.push(`Colaborador ${highestCostCollaborator.label} apresenta maior custo operacional.`);

  const bestCollaborator = [...collaboratorFinancials].sort(sortBy('roi'))[0];
  if (bestCollaborator) diagnostics.push(`Colaborador ${bestCollaborator.label} apresenta melhor ROI.`);

  const highestCostRole = [...roleFinancials].sort(sortBy('collaboratorCost'))[0];
  if (highestCostRole) diagnostics.push(`Função ${highestCostRole.label} concentra maior custo no período.`);

  return diagnostics;
}

function buildSummary(rows) {
  const revenue = rows.reduce((total, row) => total + toNumber(row.revenue), 0);
  const cost = rows.reduce((total, row) => total + toNumber(row.total_crc_cost), 0);
  const profit = revenue - cost;
  const marketingCost = rows.reduce((total, row) => total + toNumber(row.total_marketing_cost), 0);
  const collaboratorCost = rows.reduce((total, row) => total + toNumber(row.total_collaborator_cost), 0);
  const leads = rows.reduce((total, row) => total + toNumber(row.leads), 0);
  const appointments = rows.reduce((total, row) => total + toNumber(row.appointments), 0);
  const attendances = rows.reduce((total, row) => total + toNumber(row.attendances), 0);
  const closings = rows.reduce((total, row) => total + toNumber(row.closings), 0);
  const selicRate = rows.length
    ? round(rows.reduce((total, row) => total + toNumber(row.selic_rate || DEFAULT_SELIC_RATE), 0) / rows.length)
    : DEFAULT_SELIC_RATE;
  const roiCrc = safeDivide(profit, cost, 100);

  return {
    totalRevenue: round(revenue),
    totalCost: round(cost),
    profit: round(profit),
    roiCrc,
    selicRate,
    roiCrcVsSelic: round(roiCrc - selicRate),
    marketingInvestment: round(marketingCost),
    marketingRoi: safeDivide(revenue - marketingCost, marketingCost, 100),
    roas: safeDivide(revenue, marketingCost),
    cac: safeDivide(marketingCost, closings),
    cpl: safeDivide(marketingCost, leads),
    averageTicket: safeDivide(revenue, closings),
    netMargin: safeDivide(profit, revenue, 100),
    leadToAppointment: safeDivide(appointments, leads, 100),
    attendanceRate: safeDivide(attendances, appointments, 100),
    closingRate: safeDivide(closings, attendances, 100),
    revenueByClinic: 0,
    costByClinic: 0,
    profitByClinic: 0,
    totalCollaboratorCost: round(collaboratorCost),
    averageCollaboratorCost: 0,
    revenueByCollaborator: 0,
    roiByCollaborator: 0,
    leads,
    appointments,
    attendances,
    closings,
    records: rows.length
  };
}

function buildFinancialIntelligencePayload(rawRows, rules = DEFAULT_FINANCIAL_RULES) {
  const normalizedRules = normalizeFinancialRules(rules);
  const table = rawRows.map((row) => enrichFinancialRow(row, normalizedRules));
  const summary = buildSummary(table);
  const clinicFinancials = groupFinancialRows(table, (row) => row.clinic_name).sort(sortBy('profit'));
  const collaboratorFinancials = groupFinancialRows(table, (row) => row.collaborator_name).sort(sortBy('profit'));
  const operatorFinancials = groupFinancialRows(table, (row) => row.operator_name).sort(sortBy('closings'));
  const campaignFinancials = groupFinancialRows(table, (row) => row.campaign).sort(sortBy('profit'));
  const channelFinancials = groupFinancialRows(table, (row) => row.channel).sort(sortBy('profit'));
  const roleFinancials = groupFinancialRows(table, (row) => row.function_name || row.role).sort(sortBy('collaboratorCost'));
  const monthlySeries = groupFinancialRows(table, (row) => monthKey(row.date))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .map((item) => ({
      ...item,
      roiVsSelic: round(item.roi - item.selicRate)
    }));

  summary.revenueByClinic = clinicFinancials.length ? round(summary.totalRevenue / clinicFinancials.length) : 0;
  summary.costByClinic = clinicFinancials.length ? round(summary.totalCost / clinicFinancials.length) : 0;
  summary.profitByClinic = clinicFinancials.length ? round(summary.profit / clinicFinancials.length) : 0;
  summary.averageCollaboratorCost = collaboratorFinancials.length ? round(summary.totalCollaboratorCost / collaboratorFinancials.length) : 0;
  summary.revenueByCollaborator = collaboratorFinancials.length ? round(summary.totalRevenue / collaboratorFinancials.length) : 0;
  summary.roiByCollaborator = collaboratorFinancials.length ? round(collaboratorFinancials.reduce((total, item) => total + item.roi, 0) / collaboratorFinancials.length) : 0;

  return {
    summary,
    rankings: {
      operators: operatorFinancials.slice(0, 15),
      clinics: clinicFinancials.slice(0, 15),
      campaigns: campaignFinancials.slice(0, 15),
      channels: channelFinancials.slice(0, 15),
      collaborators: collaboratorFinancials.slice(0, 15),
      roles: roleFinancials.slice(0, 15)
    },
    charts: {
      funnel: [
        { label: 'Leads', value: summary.leads },
        { label: 'Agendamentos', value: summary.appointments },
        { label: 'Comparecimentos', value: summary.attendances },
        { label: 'Fechamentos', value: summary.closings }
      ],
      revenueCostProfit: monthlySeries,
      campaignRoi: campaignFinancials,
      campaignCac: campaignFinancials,
      campaignCpl: campaignFinancials,
      operatorRanking: operatorFinancials,
      clinicRanking: clinicFinancials,
      revenueByClinic: clinicFinancials,
      costByClinic: clinicFinancials,
      profitByClinic: clinicFinancials,
      roiByClinic: clinicFinancials,
      marketingRoiByClinic: clinicFinancials,
      channelRanking: channelFinancials,
      monthlyEvolution: monthlySeries,
      roiVsSelic: monthlySeries,
      costByCollaborator: collaboratorFinancials,
      roiByCollaborator: collaboratorFinancials,
      revenueByCollaborator: collaboratorFinancials,
      costByRole: roleFinancials,
      historicalSeries: monthlySeries
    },
    diagnostics: buildFinancialDiagnostics(summary, clinicFinancials, collaboratorFinancials, roleFinancials, normalizedRules),
    table,
    clinicFinancials,
    collaboratorFinancials,
    roiVsSelic: {
      roiCrc: summary.roiCrc,
      selicRate: summary.selicRate,
      difference: summary.roiCrcVsSelic,
      status: summary.roiCrcVsSelic >= normalizedRules.selicComparisonTolerance
        ? 'above'
        : summary.roiCrcVsSelic >= -normalizedRules.selicComparisonTolerance
          ? 'near'
          : 'below'
    },
    historicalSeries: monthlySeries,
    expectedMargins: normalizedRules.expectedMargins,
    financialRules: normalizedRules
  };
}

function matchesFinancialStatus(row, status) {
  if (!status) return true;
  return String(row.status || '').toLowerCase() === String(status).toLowerCase();
}

module.exports = {
  DEFAULT_SELIC_RATE,
  DEFAULT_FINANCIAL_RULES,
  administrativeCostFields,
  buildFinancialIntelligencePayload,
  calculateFinancialMetrics,
  collaboratorCostFields,
  collaboratorDefaultFields,
  editableFinancialFields,
  enrichFinancialRow,
  expectedMargins,
  normalizeFinancialRules,
  integerFields,
  matchesFinancialStatus,
  moneyFields,
  operationalCostFields,
  marketingCostFields,
  toNumber
};
