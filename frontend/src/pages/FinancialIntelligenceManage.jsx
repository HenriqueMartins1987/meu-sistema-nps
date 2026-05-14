import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api';
import { hasPermission, isMasterAdmin, readUser } from '../constants';

const DEFAULT_SELIC = 15;
const FINANCIAL_CENTRAL_CLINIC = { id: 'central-crc', name: 'Escritório Central - CRC', unit: 'CRC' };

const CRC_FUNCTION_OPTIONS = [
  'Operador de CRC',
  'Operador de SAC',
  'Atendente de Relacionamento',
  'Analista de Relacionamento',
  'Analista de Qualidade CRC',
  'Assistente de Back Office',
  'Assistente de Control Desk',
  'SDR CRC',
  'Consultor de Vendas CRC',
  'Operador de Retenção',
  'Operador de Cobrança',
  'Analista de CRM',
  'Analista de Planejamento/BI CRC',
  'Supervisor de CRC',
  'Coordenador de CRC',
  'Gerente de CRC',
  'Gerente Executivo CRC'
];

const generalFields = [
  ['date', 'Data', 'date'],
  ['campaign_start_date', 'Início da campanha', 'date'],
  ['campaign_end_date', 'Fim da campanha', 'date'],
  ['clinic_id', 'Clínica', 'clinic'],
  ['unit_name', 'Unidade', 'text'],
  ['campaign_target_unit', 'Unidade direcionada da campanha', 'targetUnit'],
  ['operator_name', 'Operador', 'readonly'],
  ['function_name', 'Função/Cargo', 'readonly'],
  ['campaign', 'Campanha', 'text'],
  ['channel', 'Canal', 'select', ['WhatsApp', 'Instagram', 'Facebook', 'Google', 'Indicação', 'Telefone', 'Presencial', 'Outros']],
  ['selic_rate', 'SELIC anual fixa', 'readonlyPercent']
];

const productionFields = [
  ['leads', 'Leads', 'integer'],
  ['appointments', 'Agendamentos', 'integer'],
  ['attendances', 'Comparecimentos', 'integer'],
  ['closings', 'Fechamentos', 'integer'],
  ['revenue', 'Receita Gerada', 'currency'],
  ['marketing_investment', 'Investimento Marketing', 'currency']
];

const operationalCostFields = [
  ['phone_cost', 'Telefonia'],
  ['system_cost', 'Sistema'],
  ['crm_cost', 'CRM'],
  ['whatsapp_cost', 'WhatsApp'],
  ['internet_cost', 'Internet'],
  ['allocated_energy', 'Energia Rateada'],
  ['infrastructure_cost', 'Infraestrutura'],
  ['allocated_rent', 'Aluguel Rateado'],
  ['furniture_cost', 'Mobiliário'],
  ['maintenance_cost', 'Manutenção'],
  ['equipment_cost', 'Equipamentos'],
  ['software_licenses', 'Licenças Software'],
  ['technical_support', 'Suporte Técnico'],
  ['other_operational_costs', 'Outros Custos Operacionais']
];

const marketingCostFields = [
  ['google_ads', 'Google Ads'],
  ['meta_ads', 'Meta Ads'],
  ['tv', 'TV'],
  ['radio', 'Rádio'],
  ['agency', 'Agência'],
  ['designer', 'Designer'],
  ['video_production', 'Produção de Vídeo'],
  ['influencers', 'Influenciadores'],
  ['landing_page', 'Landing Page'],
  ['automation_tools', 'Automação'],
  ['other_marketing_costs', 'Outros Custos Marketing']
];

const allExportFields = [
  ...generalFields.map(([field, label]) => [field, label]),
  ...productionFields.map(([field, label]) => [field, label]),
  ...marketingCostFields,
  ['notes', 'Observações'],
  ['total_collaborator_cost', 'Custo Total Colaborador'],
  ['total_operational_cost', 'Custo Total Operacional'],
  ['total_marketing_cost', 'Custo Total Marketing'],
  ['total_administrative_cost', 'Custo Total Administrativo'],
  ['total_crc_cost', 'Custo Total CRC'],
  ['profit', 'Lucro/Prejuízo'],
  ['roi_crc', 'ROI CRC'],
  ['roi_crc_vs_selic', 'ROI CRC vs SELIC'],
  ['marketing_roi', 'ROI Marketing'],
  ['roas', 'ROAS'],
  ['cac', 'CAC'],
  ['cpl', 'CPL'],
  ['average_ticket', 'Ticket Médio'],
  ['lead_to_appointment', 'Conversão Lead > Agendamento'],
  ['attendance_rate', 'Comparecimento'],
  ['closing_rate', 'Fechamento'],
  ['net_margin', 'Margem Líquida'],
  ['status', 'Status'],
  ['diagnosis', 'Diagnóstico']
];

function canViewFinancialDashboard(user) {
  return hasPermission(user, 'financial_dashboard');
}

function canManageFinancial(user) {
  return hasPermission(user, 'financial_management');
}

function canDeleteFinancial(user) {
  return isMasterAdmin(user);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let normalized = String(value || 0)
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

function sum(row, fields) {
  return fields.reduce((total, [field]) => total + toNumber(row[field]), 0);
}

function divide(numerator, denominator, multiplier = 1) {
  const base = toNumber(denominator);
  if (!base) return 0;
  return Math.round((toNumber(numerator) / base) * multiplier * 100) / 100;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function toBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function getActorName(user) {
  return user?.name || user?.full_name || user?.email || '';
}

function getUserFunctionLabel(user = {}) {
  if (user?.position || user?.function_name || user?.department) {
    return user.position || user.function_name || user.department;
  }

  const labels = {
    master_admin: 'Administrador Master',
    admin: 'Administrador',
    supervisor_crc: 'Supervisor de CRC',
    sac_operator: 'Operador de CRC',
    manager: 'Gerente de CRC',
    coordinator: 'Coordenador de CRC'
  };

  return labels[String(user?.role || '').toLowerCase()] || 'Profissional CRC';
}

function collaboratorMonthlyCost(collaborator = {}) {
  return toNumber(collaborator.salary)
    + toNumber(collaborator.charges)
    + toNumber(collaborator.benefits)
    + (toBooleanFlag(collaborator.receives_commission) ? toNumber(collaborator.commission_default) : 0)
    + (toBooleanFlag(collaborator.vacation_taken) ? toNumber(collaborator.vacation_amount) : 0)
    + toNumber(collaborator.other_costs_default);
}

function operationalMonthlyCost(row = {}) {
  return operationalCostFields.reduce((total, [field]) => total + toNumber(row[field]), 0);
}

function applyCollaboratorDefaults(record, collaborator) {
  if (!collaborator) return record;

  return {
    ...record,
    collaborator_id: collaborator.id || record.collaborator_id || '',
    collaborator_name: collaborator.name || record.collaborator_name || '',
    function_name: collaborator.function_name || record.function_name || ''
  };
}

function calculate(row) {
  const totalCollaborator = 0;
  const totalOperational = 0;
  const totalMarketing = toNumber(row.marketing_investment) + sum(row, marketingCostFields);
  const totalAdministrative = 0;
  const total = totalCollaborator + totalOperational + totalMarketing + totalAdministrative;
  const profit = toNumber(row.revenue) - total;
  const roi = divide(profit, total, 100);
  const selic = toNumber(row.selic_rate) || DEFAULT_SELIC;

  return {
    total_collaborator_cost: totalCollaborator,
    total_operational_cost: totalOperational,
    total_marketing_cost: totalMarketing,
    total_administrative_cost: totalAdministrative,
    total_crc_cost: total,
    profit,
    roi_crc: roi,
    roi_crc_vs_selic: roi - selic,
    marketing_roi: divide(toNumber(row.revenue) - totalMarketing, totalMarketing, 100),
    roas: divide(row.revenue, totalMarketing),
    cac: divide(totalMarketing, row.closings),
    cpl: divide(totalMarketing, row.leads),
    average_ticket: divide(row.revenue, row.closings),
    lead_to_appointment: divide(row.appointments, row.leads, 100),
    attendance_rate: divide(row.attendances, row.appointments, 100),
    closing_rate: divide(row.closings, row.attendances, 100),
    net_margin: divide(profit, row.revenue, 100),
    status: profit < 0 || roi < 0 ? 'critico' : roi >= 150 ? 'excelente' : roi >= selic ? 'adequado' : 'atencao',
    diagnosis: profit < 0 ? 'CRC deficitário no período.' : roi >= selic ? 'CRC lucrativo e acima da SELIC.' : 'CRC lucrativo, porém abaixo da SELIC.'
  };
}

function buildEmptyRecord(user, selicRate = DEFAULT_SELIC) {
  const actorName = getActorName(user);

  return {
    id: `draft-${Date.now()}`,
    __draft: true,
    __dirty: true,
    date: new Date().toISOString().slice(0, 10),
    selic_rate: selicRate,
    operator_id: user?.id || '',
    operator_name: actorName,
    function_name: getUserFunctionLabel(user),
    role: user?.role || '',
    status: 'atencao'
  };
}

function normalizeRecord(row) {
  return { ...row, ...calculate(row) };
}

function escapeCsv(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function FinancialIntelligenceManage() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const allowed = canManageFinancial(user);
  const canDelete = canDeleteFinancial(user);
  const canOpenDashboard = canViewFinancialDashboard(user);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [records, setRecords] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [operationalCosts, setOperationalCosts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ search: '', clinicId: '', clinicName: '', status: '' });
  const [openGroups, setOpenGroups] = useState({
    general: true,
    production: true,
    marketing: false,
    results: true
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [toast, setToast] = useState('');
  const [collaboratorModalOpen, setCollaboratorModalOpen] = useState(false);
  const [commissionModalOpen, setCommissionModalOpen] = useState(false);
  const [operationalCostModalOpen, setOperationalCostModalOpen] = useState(false);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState('');
  const [collaboratorMonth, setCollaboratorMonth] = useState(currentMonth);
  const [selicInfo, setSelicInfo] = useState({ value: DEFAULT_SELIC, source: 'fallback', referenceDate: null });
  const [collaboratorDraft, setCollaboratorDraft] = useState({
    name: '',
    role: 'CRC',
    function_name: '',
    clinic_id: '',
    clinic_name: '',
    unit_name: '',
    reference_month: currentMonth,
    salary: '',
    charges: '',
    benefits: '',
    receives_commission: false,
    commission_default: '',
    vacation_taken: false,
    vacation_amount: '',
    has_other_costs: false,
    other_costs_default: '',
    other_costs_description: '',
    status: 'ativo'
  });
  const [commissionDraft, setCommissionDraft] = useState({
    collaborator_id: '',
    reference_month: currentMonth,
    commission: '',
    vacation_paid: false,
    vacation_amount: '',
    has_other_costs: false,
    other_costs: '',
    notes: ''
  });
  const [operationalCostDraft, setOperationalCostDraft] = useState({
    reference_month: currentMonth,
    notes: ''
  });

  const currentUserCollaborator = useMemo(() => {
    const actorName = normalizeText(getActorName(user));
    const emailName = normalizeText(String(user?.email || '').split('@')[0]);

    return collaborators.find((item) => {
      const name = normalizeText(item.name);
      const nameMatches = name === actorName
        || name === emailName
        || (actorName.length > 5 && name.includes(actorName))
        || (emailName.length > 5 && name.includes(emailName));
      return item.status !== 'inativo' && name && nameMatches;
    }) || null;
  }, [collaborators, user]);

  const loadData = useCallback(async () => {
    if (!allowed) return;

    setLoading(true);
    setFeedback('');

    try {
      const [financialRes, collaboratorsRes, clinicsRes, operationalCostsRes, selicRes] = await Promise.all([
        api.get('/financial-intelligence'),
        api.get('/crc-collaborators'),
        api.get('/clinics'),
        api.get('/crc-operational-costs'),
        api.get('/financial-intelligence/selic').catch(() => ({ data: null }))
      ]);
      const selicValue = toNumber(selicRes.data?.value) || DEFAULT_SELIC;
      const rows = Array.isArray(financialRes.data?.table)
        ? financialRes.data.table.map((row) => normalizeRecord({ ...row, selic_rate: row.selic_rate || selicValue }))
        : [];

      setRecords(rows);
      setSelectedId((current) => current || rows[0]?.id || null);
      setCollaborators(Array.isArray(collaboratorsRes.data) ? collaboratorsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setOperationalCosts(Array.isArray(operationalCostsRes.data) ? operationalCostsRes.data : []);
      setSelicInfo({
        value: selicValue,
        source: selicRes.data?.source || 'fallback',
        referenceDate: selicRes.data?.referenceDate || null
      });
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a gestão financeira.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedRecord = useMemo(() => records.find((record) => String(record.id) === String(selectedId)) || null, [records, selectedId]);
  const clinicFilterValue = filters.clinicName || filters.clinicId;

  const filteredRecords = useMemo(() => records.filter((record) => {
    const text = [record.clinic_name, record.unit_name, record.operator_name, record.campaign, record.channel, record.function_name].join(' ').toLowerCase();
    const searchOk = !filters.search || text.includes(filters.search.toLowerCase());
    const clinicOk = filters.clinicName
      ? record.clinic_name === filters.clinicName
      : !filters.clinicId || String(record.clinic_id || '') === String(filters.clinicId);
    const statusOk = !filters.status || record.status === filters.status;
    return searchOk && clinicOk && statusOk;
  }), [records, filters]);

  const totals = useMemo(() => filteredRecords.reduce((acc, row) => {
    const calculated = calculate(row);
    acc.revenue += toNumber(row.revenue);
    acc.cost += calculated.total_crc_cost;
    acc.profit += calculated.profit;
    acc.rows += 1;
    return acc;
  }, { revenue: 0, cost: 0, profit: 0, rows: 0 }), [filteredRecords]);

  const campaignGroups = useMemo(() => {
    const grouped = new Map();
    filteredRecords.forEach((row) => {
      const key = row.campaign || 'Sem campanha';
      const current = grouped.get(key) || { name: key, rows: [], revenue: 0, cost: 0, profit: 0, leads: 0, closings: 0 };
      current.rows.push(row);
      current.revenue += toNumber(row.revenue);
      current.cost += toNumber(row.total_crc_cost);
      current.profit += toNumber(row.profit);
      current.leads += toNumber(row.leads);
      current.closings += toNumber(row.closings);
      grouped.set(key, current);
    });

    return Array.from(grouped.values()).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  }, [filteredRecords]);

  const collaboratorCostRows = useMemo(() => {
    const selectedMonth = collaboratorMonth || currentMonth;

    return collaborators
      .filter((item) => {
        if (!selectedMonth || !item.created_at) return true;
        return String(item.created_at).slice(0, 7) <= selectedMonth;
      })
      .map((item) => ({ ...item, monthlyCost: collaboratorMonthlyCost(item) }))
      .sort((a, b) => b.monthlyCost - a.monthlyCost || String(a.name).localeCompare(String(b.name)));
  }, [collaborators, collaboratorMonth, currentMonth]);

  const collaboratorCostTotal = useMemo(
    () => collaboratorCostRows.reduce((total, item) => total + toNumber(item.monthlyCost), 0),
    [collaboratorCostRows]
  );

  const monthlyExpenseRows = useMemo(() => {
    const grouped = new Map();

    operationalCosts.forEach((item) => {
      const month = item.reference_month || 'Sem mês';
      const current = grouped.get(month) || {
        reference_month: month,
        rows: [],
        total: 0,
        lastUpdated: ''
      };
      const total = operationalMonthlyCost(item);
      current.rows.push({ ...item, total });
      current.total += total;
      current.lastUpdated = [current.lastUpdated, item.updated_at || item.created_at || '']
        .filter(Boolean)
        .sort()
        .pop() || '';
      grouped.set(month, current);
    });

    return Array.from(grouped.values())
      .map((item) => ({
        ...item,
        total: Math.round(item.total * 100) / 100,
        mainRows: item.rows.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
      }))
      .sort((a, b) => String(b.reference_month).localeCompare(String(a.reference_month)));
  }, [operationalCosts]);

  const currentMonthExpenses = useMemo(() => {
    const row = monthlyExpenseRows.find((item) => item.reference_month === currentMonth) || monthlyExpenseRows[0];
    return row || { reference_month: currentMonth, rows: [], mainRows: [], total: 0 };
  }, [currentMonth, monthlyExpenseRows]);

  const totalOperationalExpenses = useMemo(
    () => operationalCosts.reduce((total, item) => total + operationalMonthlyCost(item), 0),
    [operationalCosts]
  );

  const patchRecord = (id, changes) => {
    setRecords((current) => current.map((record) => {
      if (String(record.id) !== String(id)) return record;
      return normalizeRecord({ ...record, ...changes, __dirty: true });
    }));
  };

  const handleClinicChange = (id, clinicId) => {
    if (clinicId === FINANCIAL_CENTRAL_CLINIC.id) {
      patchRecord(id, {
        clinic_id: '',
        clinic_name: FINANCIAL_CENTRAL_CLINIC.name,
        unit_name: FINANCIAL_CENTRAL_CLINIC.unit
      });
      return;
    }

    const clinic = clinics.find((item) => String(item.id) === String(clinicId));
    patchRecord(id, {
      clinic_id: clinic?.id || '',
      clinic_name: clinic?.name || '',
      unit_name: clinic?.city || '',
      campaign_target_unit: ''
    });
  };

  const handleClinicFilterChange = (value) => {
    if (value === FINANCIAL_CENTRAL_CLINIC.id) {
      setFilters((current) => ({
        ...current,
        clinicId: '',
        clinicName: FINANCIAL_CENTRAL_CLINIC.name
      }));
      return;
    }

    setFilters((current) => ({ ...current, clinicId: value, clinicName: '' }));
  };

  const handleCollaboratorClinicChange = (clinicId) => {
    if (clinicId === FINANCIAL_CENTRAL_CLINIC.id) {
      setCollaboratorDraft((current) => ({
        ...current,
        clinic_id: FINANCIAL_CENTRAL_CLINIC.id,
        clinic_name: FINANCIAL_CENTRAL_CLINIC.name,
        unit_name: FINANCIAL_CENTRAL_CLINIC.unit
      }));
      return;
    }

    const clinic = clinics.find((item) => String(item.id) === String(clinicId));
    setCollaboratorDraft((current) => ({
      ...current,
      clinic_id: clinic?.id || '',
      clinic_name: clinic?.name || '',
      unit_name: clinic?.city || ''
    }));
  };

  const buildDraftRecord = () => normalizeRecord(applyCollaboratorDefaults(
    buildEmptyRecord(user, selicInfo.value || DEFAULT_SELIC),
    currentUserCollaborator
  ));

  const addRecord = () => {
    const draft = buildDraftRecord();
    setRecords((current) => [draft, ...current]);
    setSelectedId(draft.id);
    setEditorModalOpen(true);
    setToast('Novo lançamento aberto com operador e SELIC preenchidos automaticamente.');
  };

  const openEditRecord = (record) => {
    setSelectedId(record.id);
    setEditorModalOpen(true);
  };

  const closeEditor = () => {
    if (selectedRecord?.__draft) {
      setRecords((current) => current.filter((record) => String(record.id) !== String(selectedRecord.id)));
      setSelectedId((current) => (String(current) === String(selectedRecord.id) ? null : current));
    }
    setEditorModalOpen(false);
  };

  const deleteRecord = async (record) => {
    if (!record) return;
    if (!canDelete) {
      setFeedback('Somente Administrador Master pode excluir lançamentos.');
      return;
    }
    if (!window.confirm('Confirma a exclusão definitiva deste lançamento? Ele será retirado dos dashboards.')) return;

    if (record.__draft) {
      setRecords((current) => current.filter((item) => String(item.id) !== String(record.id)));
      setSelectedId((current) => (String(current) === String(record.id) ? null : current));
      return;
    }

    setSaving(true);
    try {
      await api.delete(`/financial-intelligence/${record.id}`);
      setToast('Lançamento excluído.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir o lançamento.');
    } finally {
      setSaving(false);
    }
  };

  const saveCurrentRecord = async () => {
    if (!selectedRecord) return;

    setSaving(true);
    setFeedback('');

    try {
      const payload = { ...selectedRecord };
      if (payload.channel === 'Outros' && payload.channel_other) {
        payload.channel = payload.channel_other;
      }
      delete payload.__dirty;
      delete payload.__draft;
      delete payload.channel_other;

      if (selectedRecord.__draft) {
        await api.post('/financial-intelligence', payload);
      } else {
        await api.put(`/financial-intelligence/${selectedRecord.id}`, payload);
      }

      setToast('Lançamento salvo com sucesso.');
      setEditorModalOpen(false);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar o lançamento.');
    } finally {
      setSaving(false);
    }
  };

  const resetCollaboratorDraft = () => {
    setCollaboratorDraft({
      name: '',
      role: 'CRC',
      function_name: '',
      clinic_id: '',
      clinic_name: '',
      unit_name: '',
      reference_month: currentMonth,
      salary: '',
      charges: '',
      benefits: '',
      receives_commission: false,
      commission_default: '',
      vacation_taken: false,
      vacation_amount: '',
      has_other_costs: false,
      other_costs_default: '',
      other_costs_description: '',
      status: 'ativo'
    });
  };

  const saveCollaborator = async () => {
    setSaving(true);
    setFeedback('');

    try {
      const payload = { ...collaboratorDraft };
      if (!payload.receives_commission) {
        payload.commission_default = '';
      }
      if (!payload.has_other_costs) {
        payload.other_costs_default = '';
        payload.other_costs_description = '';
      }
      delete payload.has_other_costs;
      if (payload.clinic_id === FINANCIAL_CENTRAL_CLINIC.id) {
        payload.clinic_id = '';
        payload.clinic_name = FINANCIAL_CENTRAL_CLINIC.name;
        payload.unit_name = FINANCIAL_CENTRAL_CLINIC.unit;
      }

      await api.post('/crc-collaborators', payload);
      setCollaboratorModalOpen(false);
      resetCollaboratorDraft();
      setToast('Colaborador cadastrado com sucesso.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível cadastrar o colaborador.');
    } finally {
      setSaving(false);
    }
  };

  const saveCommission = async () => {
    setSaving(true);
    setFeedback('');

    try {
      const payload = { ...commissionDraft };
      if (!payload.has_other_costs) {
        payload.other_costs = '';
        payload.notes = '';
      }
      delete payload.has_other_costs;
      await api.post('/crc-collaborator-monthly-costs', payload);
      setCommissionModalOpen(false);
      setCommissionDraft({
        collaborator_id: '',
        reference_month: currentMonth,
        commission: '',
        vacation_paid: false,
        vacation_amount: '',
        has_other_costs: false,
        other_costs: '',
        notes: ''
      });
      setToast('Comissão mensal lançada com sucesso.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível lançar a comissão.');
    } finally {
      setSaving(false);
    }
  };

  const saveOperationalCost = async () => {
    setSaving(true);
    setFeedback('');

    try {
      await api.post('/crc-operational-costs', operationalCostDraft);
      setOperationalCostModalOpen(false);
      setOperationalCostDraft({ reference_month: currentMonth, notes: '' });
      setToast('Custo operacional mensal cadastrado.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível lançar o custo operacional.');
    } finally {
      setSaving(false);
    }
  };

  const refreshSelic = async () => {
    try {
      const { data } = await api.get('/financial-intelligence/selic');
      const value = toNumber(data?.value) || DEFAULT_SELIC;
      setSelicInfo({ value, source: data?.source || 'fallback', referenceDate: data?.referenceDate || null });
      if (selectedRecord?.__draft) {
        patchRecord(selectedRecord.id, { selic_rate: value });
      }
      setToast('SELIC fixa de 15% ao ano aplicada.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível consultar a SELIC agora.');
    }
  };

  const exportExcel = () => {
    const period = `Exportado em;${new Date().toLocaleString('pt-BR')}`;
    const summaryRows = [
      ['Resumo executivo', ''],
      ['Receita filtrada', totals.revenue],
      ['Custo filtrado', totals.cost],
      ['Lucro filtrado', totals.profit],
      ['Lançamentos', totals.rows],
      ['SELIC anual fixa', selicInfo.value]
    ].map((row) => row.map(escapeCsv).join(';'));
    const header = allExportFields.map(([, label]) => escapeCsv(label)).join(';');
    const rows = filteredRecords.map((record) => {
      const calculated = normalizeRecord(record);
      return allExportFields.map(([field]) => escapeCsv(calculated[field])).join(';');
    });
    const blob = new Blob([`\ufeff${[period, '', ...summaryRows, '', header, ...rows].join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inteligencia-financeira-crc.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const rows = filteredRecords.map((record) => normalizeRecord(record));
    printWindow.document.write(`
      <html><head><title>Inteligência Financeira CRC</title>
      <style>
        body{font-family:Arial,sans-serif;padding:28px;color:#161218;background:#fffdfa}
        h1{margin:0;color:#2a2218;font-size:26px} .sub{color:#6d5b4b;margin:6px 0 20px}
        .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0 22px}
        .card{border:1px solid #ddcfbc;border-radius:10px;padding:12px;background:#f8f3eb}
        .card span{display:block;color:#6d5b4b;font-size:10px;text-transform:uppercase;font-weight:700}
        .card strong{font-size:18px;color:#161218}
        table{width:100%;border-collapse:collapse;font-size:10.5px;background:#fff}
        th,td{border:1px solid #ddcfbc;padding:7px;text-align:left;vertical-align:top}
        th{background:#efe6d8;color:#6d573b;text-transform:uppercase;font-size:9px}
      </style>
      </head><body><h1>Inteligência Financeira CRC</h1>
      <p class="sub">Relatório executivo exportado em ${new Date().toLocaleString('pt-BR')} · SELIC anual fixa ${formatPercent(selicInfo.value)}</p>
      <section class="cards">
        <article class="card"><span>Receita</span><strong>${formatCurrency(totals.revenue)}</strong></article>
        <article class="card"><span>Custo</span><strong>${formatCurrency(totals.cost)}</strong></article>
        <article class="card"><span>Lucro</span><strong>${formatCurrency(totals.profit)}</strong></article>
        <article class="card"><span>Lançamentos</span><strong>${totals.rows}</strong></article>
      </section>
      <table><thead><tr><th>Data</th><th>Clínica</th><th>Unidade</th><th>Operador</th><th>Campanha</th><th>Canal</th><th>Leads</th><th>Agend.</th><th>Comp.</th><th>Fech.</th><th>Receita</th><th>Custo</th><th>Lucro</th><th>ROI</th><th>ROAS</th><th>CAC</th><th>CPL</th><th>Status</th><th>Diagnóstico</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.date || ''}</td><td>${row.clinic_name || ''}</td><td>${row.unit_name || ''}</td><td>${row.operator_name || ''}</td><td>${row.campaign || ''}</td><td>${row.channel || ''}</td><td>${row.leads || 0}</td><td>${row.appointments || 0}</td><td>${row.attendances || 0}</td><td>${row.closings || 0}</td><td>${formatCurrency(row.revenue)}</td><td>${formatCurrency(row.total_crc_cost)}</td><td>${formatCurrency(row.profit)}</td><td>${formatPercent(row.roi_crc)}</td><td>${Number(row.roas || 0).toFixed(2)}x</td><td>${formatCurrency(row.cac)}</td><td>${formatCurrency(row.cpl)}</td><td>${row.status || ''}</td><td>${row.diagnosis || ''}</td></tr>`).join('')}</tbody></table>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const renderField = (record, [field, label, type = 'currency', options = []]) => {
    if (type === 'targetUnit' && record.clinic_name !== FINANCIAL_CENTRAL_CLINIC.name) {
      return null;
    }

    if (type === 'clinic') {
      const value = record.clinic_name === FINANCIAL_CENTRAL_CLINIC.name ? FINANCIAL_CENTRAL_CLINIC.id : record.clinic_id || '';
      return (
        <label key={field}>{label}
          <select className="field" value={value} onChange={(event) => handleClinicChange(record.id, event.target.value)}>
            <option value="">Selecione</option>
            <option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>
            {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
          </select>
        </label>
      );
    }

    if (type === 'readonly' || type === 'readonlyPercent') {
      return (
        <label key={field}>{label}
          <input
            className="field readonly-field"
            value={type === 'readonlyPercent' ? formatPercent(record[field]) : record[field] || ''}
            readOnly
          />
        </label>
      );
    }

    if (type === 'select') {
      const isCustomChannel = field === 'channel' && record[field] && !options.includes(record[field]);
      const selectValue = isCustomChannel ? 'Outros' : (record[field] || '');
      return (
        <React.Fragment key={field}>
          <label>{label}
            <select
              className="field"
              value={selectValue}
              onChange={(event) => patchRecord(record.id, {
                [field]: event.target.value,
                ...(field === 'channel' && event.target.value !== 'Outros' ? { channel_other: '' } : {})
              })}
            >
              <option value="">Selecione</option>
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          {field === 'channel' && selectValue === 'Outros' && (
            <label>Descreva o canal
              <input
                className="field"
                value={record.channel_other || (isCustomChannel ? record.channel : '')}
                onChange={(event) => patchRecord(record.id, { channel_other: event.target.value })}
                placeholder="Informe a origem do canal"
              />
            </label>
          )}
        </React.Fragment>
      );
    }

    return (
      <label key={field}>{label}
        <input
          className="field"
          type={type === 'date' ? 'date' : type === 'text' ? 'text' : 'number'}
          step={type === 'integer' ? '1' : '0.01'}
          inputMode={type === 'currency' || type === 'percent' ? 'decimal' : undefined}
          value={record[field] ?? ''}
          onChange={(event) => patchRecord(record.id, { [field]: event.target.value })}
          placeholder={type === 'currency' ? 'R$ 0,00' : type === 'percent' ? '0,00%' : ''}
        />
      </label>
    );
  };

  const renderGroup = (key, title, fields, record) => (
    <section className="financial-editor-group" key={key}>
      <button type="button" className="financial-group-toggle" onClick={() => setOpenGroups((current) => ({ ...current, [key]: !current[key] }))}>
        <span>{title}</span>
        <strong>{openGroups[key] ? 'Recolher' : 'Expandir'}</strong>
      </button>
      {openGroups[key] && (
        <div className="financial-editor-grid">
          {fields.map((field) => renderField(record, field.length === 2 ? [...field, 'currency'] : field))}
        </div>
      )}
    </section>
  );

  if (!allowed) {
    return (
      <main className="app-page">
        <section className="restricted-panel">
          <p className="eyebrow">Acesso restrito</p>
          <h1>Gestão Financeira CRC</h1>
          <p>Seu perfil não pode lançar ou editar dados financeiros do CRC.</p>
          <button className="primary-action" onClick={() => navigate('/home')}>Voltar para Home</button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page financial-page">
      <header className="page-heading financial-heading">
        <div>
          <p className="eyebrow">Inteligência Financeira CRC</p>
          <h1>Gestão Financeira CRC</h1>
          <p>Lançamento profissional com custos centralizados no cadastro do colaborador, ROI de mercado e SELIC fixa de 15% ao ano.</p>
        </div>
        <div className="heading-actions">
          {canOpenDashboard && <button className="outline-action" onClick={() => navigate('/home/financial-intelligence')}>Dashboard</button>}
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="financial-export-bar">
        <button className="outline-action icon-action" onClick={exportExcel}>
          <span className="file-icon xls">XLS</span>
          Exportar Excel
        </button>
        <button className="outline-action icon-action" onClick={exportPdf}>
          <span className="file-icon pdf">PDF</span>
          Exportar PDF
        </button>
      </section>

      <section className="financial-toolbar">
        <button className="primary-action" onClick={addRecord}>+ Novo Lançamento</button>
        <button className="secondary-action" onClick={() => setCollaboratorModalOpen(true)}>+ Cadastrar Colaborador</button>
        <button className="secondary-action" onClick={() => setCommissionModalOpen(true)}>Lançar comissão</button>
        <button className="secondary-action" onClick={() => setOperationalCostModalOpen(true)}>Custos operacionais</button>
        <button className="outline-action" onClick={() => navigate('/home/financial-intelligence/manage/collaborators')}>Gestão de colaboradores</button>
        <button className="outline-action" onClick={() => setFilters({ search: '', clinicId: '', clinicName: '', status: '' })}>Limpar filtros</button>
      </section>

      <section className="financial-filter-panel compact">
        <label>Buscar<input className="field" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Clínica, operador, campanha..." /></label>
        <label>Clínica<select className="field" value={clinicFilterValue} onChange={(event) => handleClinicFilterChange(event.target.value)}><option value="">Todas</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
        <label>Status<select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option><option value="excelente">Excelente</option><option value="adequado">Adequado</option><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></label>
        <label>SELIC anual fixa
          <button type="button" className="outline-action mini-action" onClick={refreshSelic}>
            {formatPercent(selicInfo.value)}
          </button>
        </label>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}
      {toast && <p className="form-feedback success-feedback">{toast}</p>}

      <section className="financial-sheet-summary">
        <article><span>Receita</span><strong>{formatCurrency(totals.revenue)}</strong></article>
        <article><span>Custo</span><strong>{formatCurrency(totals.cost)}</strong></article>
        <article><span>Lucro</span><strong>{formatCurrency(totals.profit)}</strong></article>
        <article><span>Despesas mensais CRC</span><strong>{formatCurrency(currentMonthExpenses.total)}</strong></article>
      </section>

      <section className="financial-insight-grid">
        <article className="financial-campaign-panel">
          <div className="financial-card-heading">
            <p className="eyebrow">Campanhas</p>
            <h2>Análise por linha</h2>
            <p>Clique em uma campanha para abrir os lançamentos vinculados.</p>
          </div>
          <div className="financial-campaign-list">
            {campaignGroups.map((campaign) => (
              <div key={campaign.name} className="financial-campaign-item">
                <button type="button" onClick={() => setExpandedCampaign((current) => current === campaign.name ? '' : campaign.name)}>
                  <span>{campaign.name}</span>
                  <strong>{formatCurrency(campaign.revenue)}</strong>
                  <em>{campaign.rows.length} linha(s)</em>
                </button>
                {expandedCampaign === campaign.name && (
                  <div className="financial-mini-table">
                    <div className="financial-mini-row header"><span>Data</span><span>Operador</span><span>Receita</span><span>ROI</span></div>
                    {campaign.rows.map((row) => (
                      <div className="financial-mini-row" key={`${campaign.name}-${row.id}`}>
                        <span>{row.date || '-'}</span>
                        <span>{row.operator_name || '-'}</span>
                        <span>{formatCurrency(row.revenue)}</span>
                        <span>{formatPercent(row.roi_crc)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!campaignGroups.length && <p className="empty-state">Sem campanhas no período filtrado.</p>}
          </div>
        </article>

        <article className="financial-collaborator-cost-panel">
          <div className="financial-card-heading">
            <p className="eyebrow">Colaboradores</p>
            <h2>Custo mensal cadastrado</h2>
            <p>Base usada para compor o custo de colaborador no ROI do CRC.</p>
          </div>
          <label>Mês de referência<input className="field" type="month" value={collaboratorMonth} onChange={(event) => setCollaboratorMonth(event.target.value)} /></label>
          <strong className="financial-total-line">{formatCurrency(collaboratorCostTotal)}</strong>
          <div className="financial-mini-table collaborator-list">
            <div className="financial-mini-row header"><span>Nome</span><span>Função</span><span>Clínica</span><span>Custo</span></div>
            {collaboratorCostRows.map((item) => (
              <div className="financial-mini-row" key={item.id}>
                <span>{item.name}</span>
                <span>{item.function_name || '-'}</span>
                <span>{item.clinic_name || '-'}</span>
                <span>{formatCurrency(item.monthlyCost)}</span>
              </div>
            ))}
            {!collaboratorCostRows.length && <p className="empty-state">Nenhum colaborador cadastrado.</p>}
          </div>
        </article>

        <article className="financial-monthly-expense-panel">
          <div className="financial-card-heading">
            <p className="eyebrow">Despesas mensais</p>
            <h2>CRC operacional</h2>
            <p>Acompanhe os custos mensais que entram uma única vez no ROI geral do CRC.</p>
          </div>
          <div className="financial-expense-kpis">
            <span>Mês em destaque<strong>{currentMonthExpenses.reference_month}</strong></span>
            <span>Total do mês<strong>{formatCurrency(currentMonthExpenses.total)}</strong></span>
            <span>Total lançado<strong>{formatCurrency(totalOperationalExpenses)}</strong></span>
          </div>
          <div className="financial-expense-list">
            {monthlyExpenseRows.map((month) => (
              <article key={month.reference_month} className={month.reference_month === currentMonthExpenses.reference_month ? 'active' : ''}>
                <button type="button" onClick={() => setOperationalCostDraft((current) => ({ ...current, reference_month: month.reference_month }))}>
                  <span>{month.reference_month}</span>
                  <strong>{formatCurrency(month.total)}</strong>
                  <em>{month.rows.length} lançamento(s)</em>
                </button>
                {month.reference_month === currentMonthExpenses.reference_month && (
                  <div className="financial-expense-breakdown">
                    {month.mainRows.slice(0, 3).map((row) => (
                      <div key={row.id}>
                        <span>{row.created_by || 'Sistema'}</span>
                        <strong>{formatCurrency(row.total)}</strong>
                        <small>{row.notes || 'Sem observações'}</small>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {!monthlyExpenseRows.length && <p className="empty-state">Nenhuma despesa mensal lançada para o CRC.</p>}
          </div>
          <button className="outline-action" onClick={() => setOperationalCostModalOpen(true)}>Lançar despesas mensais</button>
        </article>
      </section>

      <section className="financial-management-layout single">
        <div className="financial-sheet-wrap">
          {loading ? (
            <p className="empty-state">Carregando planilha financeira...</p>
          ) : (
            <table className="financial-sheet-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Clínica</th>
                  <th>Operador</th>
                  <th>Campanha</th>
                  <th>Leads</th>
                  <th>Receita</th>
                  <th>Custo Marketing</th>
                  <th>Lucro</th>
                  <th>ROI</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className={`${String(record.id) === String(selectedId) ? 'selected' : ''} ${record.__dirty ? 'dirty' : ''}`} onClick={() => setSelectedId(record.id)}>
                    <td>{record.date || '-'}</td>
                    <td><strong>{record.clinic_name || '-'}</strong><small>{record.unit_name || ''}</small></td>
                    <td><span className="financial-readonly-cell">{record.operator_name || '-'}</span></td>
                    <td>{record.campaign || '-'}</td>
                    <td>{record.leads || 0}</td>
                    <td>{formatCurrency(record.revenue)}</td>
                    <td>{formatCurrency(record.total_crc_cost)}</td>
                    <td>{formatCurrency(record.profit)}</td>
                    <td>{formatPercent(record.roi_crc)}</td>
                    <td><span className={`financial-status-badge ${record.status}`}>{record.status}</span></td>
                    <td>
                      <div className="financial-row-actions">
                        {!record.__draft && (
                          <button
                            type="button"
                            className="outline-action mini-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/home/financial-intelligence/manage/${record.id}`);
                            }}
                          >
                            Abrir
                          </button>
                        )}
                        <button
                          type="button"
                          className="outline-action mini-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditRecord(record);
                          }}
                        >
                          Editar
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            className="outline-action danger-action mini-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteRecord(record);
                            }}
                            disabled={saving}
                          >
                            Excluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </section>

      {editorModalOpen && selectedRecord && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeEditor}>
          <section className="modal-panel financial-launch-modal" onClick={(event) => event.stopPropagation()}>
            <div className="financial-card-heading">
              <p className="eyebrow">Lançamento CRC</p>
              <h2>{selectedRecord.__draft ? 'Novo lançamento' : `Editar lançamento #${selectedRecord.id}`}</h2>
              <p>Operador, função e SELIC fixa de 15% ao ano são preenchidos automaticamente para manter o histórico padronizado.</p>
            </div>

            {renderGroup('general', '1. Dados Gerais', generalFields, selectedRecord)}
            {renderGroup('production', '2. Produção CRC', productionFields, selectedRecord)}
            {renderGroup('marketing', '3. Custos de Marketing', marketingCostFields, selectedRecord)}
            <section className="financial-editor-group">
              <button type="button" className="financial-group-toggle" onClick={() => setOpenGroups((current) => ({ ...current, results: !current.results }))}>
                <span>4. Resultados Calculados</span>
                <strong>{openGroups.results ? 'Recolher' : 'Expandir'}</strong>
              </button>
              {openGroups.results && (
                <div className="financial-calculated-grid">
                  <span>Custo Total Marketing<strong>{formatCurrency(selectedRecord.total_marketing_cost)}</strong></span>
                  <span>Custo do Lançamento<strong>{formatCurrency(selectedRecord.total_crc_cost)}</strong></span>
                  <span>Lucro/Prejuízo<strong>{formatCurrency(selectedRecord.profit)}</strong></span>
                  <span>ROI CRC<strong>{formatPercent(selectedRecord.roi_crc)}</strong></span>
                  <span>ROI CRC vs SELIC<strong>{formatPercent(selectedRecord.roi_crc_vs_selic)}</strong></span>
                  <span>ROI Marketing<strong>{formatPercent(selectedRecord.marketing_roi)}</strong></span>
                  <span>ROAS<strong>{Number(selectedRecord.roas || 0).toFixed(2)}x</strong></span>
                  <span>CAC<strong>{formatCurrency(selectedRecord.cac)}</strong></span>
                  <span>CPL<strong>{formatCurrency(selectedRecord.cpl)}</strong></span>
                  <span>Ticket Médio<strong>{formatCurrency(selectedRecord.average_ticket)}</strong></span>
                  <span>Lead > Agendamento<strong>{formatPercent(selectedRecord.lead_to_appointment)}</strong></span>
                  <span>Comparecimento<strong>{formatPercent(selectedRecord.attendance_rate)}</strong></span>
                  <span>Fechamento<strong>{formatPercent(selectedRecord.closing_rate)}</strong></span>
                  <span>Margem Líquida<strong>{formatPercent(selectedRecord.net_margin)}</strong></span>
                  <span>Status<strong>{selectedRecord.status}</strong></span>
                  <span className="wide">Diagnóstico<strong>{selectedRecord.diagnosis}</strong></span>
                </div>
              )}
            </section>
            <label className="financial-notes-field">Observações<textarea className="field textarea" value={selectedRecord.notes || ''} onChange={(event) => patchRecord(selectedRecord.id, { notes: event.target.value })} /></label>
            <div className="financial-editor-footer">
              <button className="outline-action" onClick={closeEditor} disabled={saving}>Cancelar</button>
              <button className="primary-action" onClick={saveCurrentRecord} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </section>
        </div>
      )}

      {collaboratorModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setCollaboratorModalOpen(false)}>
          <section className="modal-panel financial-collaborator-modal" onClick={(event) => event.stopPropagation()}>
            <div className="financial-card-heading">
              <p className="eyebrow">Cadastro CRC</p>
              <h2>Novo colaborador</h2>
              <p>Os custos do colaborador ficam centralizados aqui e entram no ROI dos lançamentos automaticamente quando houver vínculo pelo nome do usuário.</p>
            </div>
            <div className="financial-editor-grid">
              <label>Nome do colaborador<input className="field" value={collaboratorDraft.name} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Função/Cargo<select className="field" value={collaboratorDraft.function_name} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, function_name: event.target.value }))}><option value="">Selecione</option>{CRC_FUNCTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
              <label>Clínica<select className="field" value={collaboratorDraft.clinic_id} onChange={(event) => handleCollaboratorClinicChange(event.target.value)}><option value="">Selecione</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
              <label>Unidade<input className="field" value={collaboratorDraft.unit_name} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, unit_name: event.target.value }))} /></label>
              <label>Mês/Ano de referência<input className="field" type="month" value={collaboratorDraft.reference_month} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, reference_month: event.target.value }))} /></label>
              <label>Salário<input className="field" type="number" step="0.01" value={collaboratorDraft.salary} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, salary: event.target.value }))} /></label>
              <label>Status<select className="field" value={collaboratorDraft.status} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, status: event.target.value }))}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
              <label>Encargos<input className="field" type="number" step="0.01" value={collaboratorDraft.charges} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, charges: event.target.value }))} /></label>
              <label>Benefícios<input className="field" type="number" step="0.01" value={collaboratorDraft.benefits} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, benefits: event.target.value }))} /></label>
              <label>Recebe comissão?<select className="field" value={collaboratorDraft.receives_commission ? 'sim' : 'nao'} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, receives_commission: event.target.value === 'sim', commission_default: event.target.value === 'sim' ? current.commission_default : '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {collaboratorDraft.receives_commission && <label>Comissão<input className="field" type="number" step="0.01" value={collaboratorDraft.commission_default} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, commission_default: event.target.value }))} /></label>}
              <label>Férias no mês?<select className="field" value={collaboratorDraft.vacation_taken ? 'sim' : 'nao'} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, vacation_taken: event.target.value === 'sim', vacation_amount: event.target.value === 'sim' ? current.vacation_amount : '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {collaboratorDraft.vacation_taken && <label>Valor das férias<input className="field" type="number" step="0.01" value={collaboratorDraft.vacation_amount} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, vacation_amount: event.target.value }))} /></label>}
              <label>Possui outros custos?<select className="field" value={collaboratorDraft.has_other_costs ? 'sim' : 'nao'} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, has_other_costs: event.target.value === 'sim', other_costs_default: event.target.value === 'sim' ? current.other_costs_default : '', other_costs_description: event.target.value === 'sim' ? current.other_costs_description : '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {collaboratorDraft.has_other_costs && <label>Valor de outros custos<input className="field" type="number" step="0.01" value={collaboratorDraft.other_costs_default} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, other_costs_default: event.target.value }))} /></label>}
              {collaboratorDraft.has_other_costs && <label className="wide-field">Descrição de outros custos<input className="field" value={collaboratorDraft.other_costs_description} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, other_costs_description: event.target.value }))} placeholder="Descreva o custo adicional" /></label>}
            </div>
            <div className="row-actions">
              <button className="outline-action" onClick={() => { setCollaboratorModalOpen(false); resetCollaboratorDraft(); }} disabled={saving}>Cancelar</button>
              <button className="primary-action" onClick={saveCollaborator} disabled={saving}>{saving ? 'Salvando...' : 'Salvar colaborador'}</button>
            </div>
          </section>
        </div>
      )}

      {commissionModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setCommissionModalOpen(false)}>
          <section className="modal-panel financial-collaborator-modal" onClick={(event) => event.stopPropagation()}>
            <div className="financial-card-heading">
              <p className="eyebrow">Custo variável</p>
              <h2>Lançar comissão mensal</h2>
              <p>Use este lançamento para ajustar comissões variáveis por mês sem alterar o cadastro base do colaborador.</p>
            </div>
            <div className="financial-editor-grid">
              <label>Colaborador<select className="field" value={commissionDraft.collaborator_id} onChange={(event) => setCommissionDraft((current) => ({ ...current, collaborator_id: event.target.value }))}><option value="">Selecione</option>{collaborators.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Mês/Ano<input className="field" type="month" value={commissionDraft.reference_month} onChange={(event) => setCommissionDraft((current) => ({ ...current, reference_month: event.target.value }))} /></label>
              <label>Comissão<input className="field" type="number" step="0.01" value={commissionDraft.commission} onChange={(event) => setCommissionDraft((current) => ({ ...current, commission: event.target.value }))} /></label>
              <label>Férias pagas?<select className="field" value={commissionDraft.vacation_paid ? 'sim' : 'nao'} onChange={(event) => setCommissionDraft((current) => ({ ...current, vacation_paid: event.target.value === 'sim', vacation_amount: event.target.value === 'sim' ? current.vacation_amount : '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {commissionDraft.vacation_paid && <label>Valor das férias<input className="field" type="number" step="0.01" value={commissionDraft.vacation_amount} onChange={(event) => setCommissionDraft((current) => ({ ...current, vacation_amount: event.target.value }))} /></label>}
              <label>Houve outros custos?<select className="field" value={commissionDraft.has_other_costs ? 'sim' : 'nao'} onChange={(event) => setCommissionDraft((current) => ({ ...current, has_other_costs: event.target.value === 'sim', other_costs: event.target.value === 'sim' ? current.other_costs : '', notes: event.target.value === 'sim' ? current.notes : '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {commissionDraft.has_other_costs && <label>Valor de outros custos<input className="field" type="number" step="0.01" value={commissionDraft.other_costs} onChange={(event) => setCommissionDraft((current) => ({ ...current, other_costs: event.target.value }))} /></label>}
            </div>
            {commissionDraft.has_other_costs && <label className="financial-notes-field">Descrição dos outros custos<textarea className="field textarea" value={commissionDraft.notes} onChange={(event) => setCommissionDraft((current) => ({ ...current, notes: event.target.value }))} /></label>}
            <div className="row-actions">
              <button className="outline-action" onClick={() => setCommissionModalOpen(false)} disabled={saving}>Cancelar</button>
              <button className="primary-action" onClick={saveCommission} disabled={saving}>{saving ? 'Salvando...' : 'Salvar comissão'}</button>
            </div>
          </section>
        </div>
      )}

      {operationalCostModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setOperationalCostModalOpen(false)}>
          <section className="modal-panel financial-launch-modal" onClick={(event) => event.stopPropagation()}>
            <div className="financial-card-heading">
              <p className="eyebrow">Custo mensal</p>
              <h2>Custos operacionais do CRC</h2>
              <p>Esses valores entram uma única vez no mês para o ROI geral, sem impactar o custo por clínica.</p>
            </div>
            <div className="financial-editor-grid">
              <label>Mês/Ano<input className="field" type="month" value={operationalCostDraft.reference_month} onChange={(event) => setOperationalCostDraft((current) => ({ ...current, reference_month: event.target.value }))} /></label>
              {operationalCostFields.map(([field, label]) => (
                <label key={field}>{label}<input className="field" type="number" step="0.01" value={operationalCostDraft[field] || ''} onChange={(event) => setOperationalCostDraft((current) => ({ ...current, [field]: event.target.value }))} /></label>
              ))}
            </div>
            <label className="financial-notes-field">Observações<textarea className="field textarea" value={operationalCostDraft.notes || ''} onChange={(event) => setOperationalCostDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
            <div className="row-actions">
              <button className="outline-action" onClick={() => setOperationalCostModalOpen(false)} disabled={saving}>Cancelar</button>
              <button className="primary-action" onClick={saveOperationalCost} disabled={saving}>{saving ? 'Salvando...' : 'Salvar custo mensal'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default FinancialIntelligenceManage;
