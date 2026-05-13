import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api';
import { isAdmin, isMasterAdmin, readUser } from '../constants';

const DEFAULT_SELIC = 13.75;
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
  ['clinic_id', 'Clínica', 'clinic'],
  ['unit_name', 'Unidade', 'text'],
  ['operator_name', 'Operador', 'readonly'],
  ['function_name', 'Função/Cargo', 'readonly'],
  ['campaign', 'Campanha', 'text'],
  ['channel', 'Canal', 'select', ['WhatsApp', 'Instagram', 'Facebook', 'Google', 'Indicação', 'Telefone', 'Presencial', 'Outros']],
  ['selic_rate', 'SELIC anual', 'readonlyPercent']
];

const productionFields = [
  ['leads', 'Leads', 'integer'],
  ['appointments', 'Agendamentos', 'integer'],
  ['attendances', 'Comparecimentos', 'integer'],
  ['closings', 'Fechamentos', 'integer'],
  ['revenue', 'Receita Gerada', 'currency'],
  ['marketing_investment', 'Investimento Marketing', 'currency']
];

const collaboratorCostFields = [
  ['salary', 'Salário'],
  ['charges', 'Encargos'],
  ['benefits', 'Benefícios'],
  ['commission', 'Comissão'],
  ['bonus', 'Bonificação'],
  ['overtime', 'Horas Extras'],
  ['transport_voucher', 'Vale Transporte'],
  ['food_voucher', 'Vale Alimentação'],
  ['meal_voucher', 'Vale Refeição'],
  ['health_plan', 'Plano de Saúde'],
  ['dental_plan', 'Plano Odontológico'],
  ['training', 'Treinamento'],
  ['uniforms', 'Uniformes'],
  ['individual_equipment', 'Equipamento Individual'],
  ['other_collaborator_costs', 'Outros Custos Colaborador']
];

const collaboratorDefaultCostFields = [
  ['salary', 'Salário'],
  ['charges', 'Encargos'],
  ['benefits', 'Benefícios'],
  ['commission_default', 'Comissão padrão'],
  ['phone_cost_default', 'Telefonia padrão'],
  ['system_cost_default', 'Sistema padrão'],
  ['infrastructure_cost_default', 'Infraestrutura padrão'],
  ['other_costs_default', 'Outros custos padrão']
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

const administrativeCostFields = [
  ['management_cost', 'Gerência'],
  ['consulting_cost', 'Consultoria'],
  ['other_administrative_costs', 'Outros Custos Administrativos']
];

const allExportFields = [
  ...generalFields.map(([field, label]) => [field, label]),
  ...productionFields.map(([field, label]) => [field, label]),
  ...operationalCostFields,
  ...marketingCostFields,
  ...administrativeCostFields,
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
  return isAdmin(user) || isMasterAdmin(user);
}

function canManageFinancial(user) {
  const role = String(user?.role || '').toLowerCase();
  return isAdmin(user) || isMasterAdmin(user) || ['manager', 'supervisor_crc'].includes(role);
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
  const parsed = Number(String(value || 0).replace(',', '.'));
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
  return collaboratorDefaultCostFields.reduce((total, [field]) => total + toNumber(collaborator[field]), 0);
}

function applyCollaboratorDefaults(record, collaborator) {
  if (!collaborator) return record;

  return {
    ...record,
    collaborator_id: collaborator.id || record.collaborator_id || '',
    collaborator_name: collaborator.name || record.collaborator_name || '',
    function_name: collaborator.function_name || record.function_name || '',
    salary: collaborator.salary || 0,
    charges: collaborator.charges || 0,
    benefits: collaborator.benefits || 0,
    commission: collaborator.commission_default || 0,
    phone_cost: collaborator.phone_cost_default || 0,
    system_cost: collaborator.system_cost_default || 0,
    infrastructure_cost: collaborator.infrastructure_cost_default || 0,
    other_collaborator_costs: collaborator.other_costs_default || 0
  };
}

function calculate(row) {
  const totalCollaborator = sum(row, collaboratorCostFields);
  const totalOperational = sum(row, operationalCostFields);
  const totalMarketing = toNumber(row.marketing_investment) + sum(row, marketingCostFields);
  const totalAdministrative = sum(row, administrativeCostFields);
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
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ search: '', clinicId: '', clinicName: '', status: '' });
  const [openGroups, setOpenGroups] = useState({
    general: true,
    production: true,
    operational: false,
    marketing: false,
    administrative: false,
    results: true
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [toast, setToast] = useState('');
  const [collaboratorModalOpen, setCollaboratorModalOpen] = useState(false);
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
    salary: '',
    charges: '',
    benefits: '',
    commission_default: '',
    phone_cost_default: '',
    system_cost_default: '',
    infrastructure_cost_default: '',
    other_costs_default: '',
    status: 'ativo'
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
      const [financialRes, collaboratorsRes, clinicsRes, selicRes] = await Promise.all([
        api.get('/financial-intelligence'),
        api.get('/crc-collaborators'),
        api.get('/clinics'),
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
      unit_name: clinic?.city || ''
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
    setToast('Novo lançamento criado com operador e SELIC preenchidos automaticamente.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const duplicateRecord = () => {
    if (!selectedRecord) return;
    const duplicated = normalizeRecord(applyCollaboratorDefaults({
      ...selectedRecord,
      id: `draft-${Date.now()}`,
      __draft: true,
      __dirty: true,
      date: new Date().toISOString().slice(0, 10),
      operator_id: user?.id || '',
      operator_name: getActorName(user),
      function_name: currentUserCollaborator?.function_name || getUserFunctionLabel(user),
      role: user?.role || selectedRecord.role || ''
    }, currentUserCollaborator));
    setRecords((current) => [duplicated, ...current]);
    setSelectedId(duplicated.id);
    setToast('Linha duplicada para novo lançamento.');
  };

  const deleteSelected = async () => {
    if (!selectedRecord) return;
    if (!canDelete) {
      setFeedback('Somente Administrador Master pode excluir lançamentos.');
      return;
    }
    if (!window.confirm('Confirma a exclusão deste lançamento? O histórico será preservado no banco.')) return;

    if (selectedRecord.__draft) {
      setRecords((current) => current.filter((record) => String(record.id) !== String(selectedRecord.id)));
      setSelectedId(records.find((record) => String(record.id) !== String(selectedRecord.id))?.id || null);
      return;
    }

    setSaving(true);
    try {
      await api.delete(`/financial-intelligence/${selectedRecord.id}`);
      setToast('Lançamento excluído.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir o lançamento.');
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async ({ resetAfter = false } = {}) => {
    const dirtyRows = records.filter((record) => record.__dirty || record.__draft);
    if (!dirtyRows.length) {
      setToast('Não há alterações pendentes.');
      return;
    }

    setSaving(true);
    setFeedback('');

    try {
      for (const row of dirtyRows) {
        const payload = { ...row };
        delete payload.__dirty;
        delete payload.__draft;

        if (row.__draft) {
          await api.post('/financial-intelligence', payload);
        } else {
          await api.put(`/financial-intelligence/${row.id}`, payload);
        }
      }
      setToast(resetAfter ? 'Lançamento salvo. A tela foi limpa para um novo registro.' : 'Alterações salvas com sucesso.');
      await loadData();

      if (resetAfter) {
        const draft = buildDraftRecord();
        setRecords((current) => [draft, ...current]);
        setSelectedId(draft.id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar as alterações.');
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
      salary: '',
      charges: '',
      benefits: '',
      commission_default: '',
      phone_cost_default: '',
      system_cost_default: '',
      infrastructure_cost_default: '',
      other_costs_default: '',
      status: 'ativo'
    });
  };

  const saveCollaborator = async () => {
    setSaving(true);
    setFeedback('');

    try {
      const payload = { ...collaboratorDraft };
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

  const refreshSelic = async () => {
    try {
      const { data } = await api.get('/financial-intelligence/selic');
      const value = toNumber(data?.value) || DEFAULT_SELIC;
      setSelicInfo({ value, source: data?.source || 'fallback', referenceDate: data?.referenceDate || null });
      if (selectedRecord?.__draft) {
        patchRecord(selectedRecord.id, { selic_rate: value });
      }
      setToast('SELIC atualizada pelo Banco Central.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível consultar a SELIC agora.');
    }
  };

  const exportExcel = () => {
    const header = allExportFields.map(([, label]) => escapeCsv(label)).join(';');
    const rows = filteredRecords.map((record) => {
      const calculated = normalizeRecord(record);
      return allExportFields.map(([field]) => escapeCsv(calculated[field])).join(';');
    });
    const blob = new Blob([`\ufeff${[header, ...rows].join('\n')}`], { type: 'text/csv;charset=utf-8;' });
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
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#161218}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddcfbc;padding:6px;text-align:left}th{background:#f8f3eb}h1{margin:0 0 16px}</style>
      </head><body><h1>Inteligência Financeira CRC</h1>
      <p>Receita: ${formatCurrency(totals.revenue)} · Custo: ${formatCurrency(totals.cost)} · Lucro: ${formatCurrency(totals.profit)}</p>
      <table><thead><tr><th>Data</th><th>Clínica</th><th>Operador</th><th>Campanha</th><th>Receita</th><th>Custo</th><th>Lucro</th><th>ROI</th><th>Status</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.date || ''}</td><td>${row.clinic_name || ''}</td><td>${row.operator_name || ''}</td><td>${row.campaign || ''}</td><td>${formatCurrency(row.revenue)}</td><td>${formatCurrency(row.total_crc_cost)}</td><td>${formatCurrency(row.profit)}</td><td>${formatPercent(row.roi_crc)}</td><td>${row.status || ''}</td></tr>`).join('')}</tbody></table>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const renderField = (record, [field, label, type = 'currency', options = []]) => {
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
      return (
        <label key={field}>{label}
          <select className="field" value={record[field] || ''} onChange={(event) => patchRecord(record.id, { [field]: event.target.value })}>
            <option value="">Selecione</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
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
          <p>Lançamento profissional com custos centralizados no cadastro do colaborador, ROI de mercado e SELIC automática.</p>
        </div>
        <div className="heading-actions">
          {canOpenDashboard && <button className="outline-action" onClick={() => navigate('/home/financial-intelligence')}>Dashboard</button>}
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="financial-toolbar">
        <button className="primary-action" onClick={addRecord}>+ Novo Lançamento</button>
        <button className="secondary-action" onClick={() => setCollaboratorModalOpen(true)}>+ Cadastrar Colaborador</button>
        <button className="outline-action" onClick={() => saveAll()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
        <button className="outline-action" onClick={() => saveAll({ resetAfter: true })} disabled={saving}>Salvar e novo lançamento</button>
        <button className="outline-action" onClick={duplicateRecord} disabled={!selectedRecord}>Duplicar linha</button>
        <button className="outline-action danger-action" onClick={deleteSelected} disabled={!selectedRecord || saving}>Excluir</button>
        <button className="outline-action" onClick={exportExcel}>Exportar Excel</button>
        <button className="outline-action" onClick={exportPdf}>Exportar PDF</button>
        <button className="outline-action" onClick={() => setFilters({ search: '', clinicId: '', clinicName: '', status: '' })}>Limpar filtros</button>
      </section>

      <section className="financial-filter-panel compact">
        <label>Buscar<input className="field" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Clínica, operador, campanha..." /></label>
        <label>Clínica<select className="field" value={clinicFilterValue} onChange={(event) => handleClinicFilterChange(event.target.value)}><option value="">Todas</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
        <label>Status<select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option><option value="excelente">Excelente</option><option value="adequado">Adequado</option><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></label>
        <label>SELIC Banco Central
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
        <article><span>Linhas</span><strong>{totals.rows}</strong></article>
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
      </section>

      <section className="financial-management-layout">
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
                  <th>Custo Total</th>
                  <th>Lucro</th>
                  <th>ROI</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className={`${String(record.id) === String(selectedId) ? 'selected' : ''} ${record.__dirty ? 'dirty' : ''}`} onClick={() => setSelectedId(record.id)}>
                    <td><input value={record.date || ''} type="date" onChange={(event) => patchRecord(record.id, { date: event.target.value })} /></td>
                    <td><select value={record.clinic_name === FINANCIAL_CENTRAL_CLINIC.name ? FINANCIAL_CENTRAL_CLINIC.id : record.clinic_id || ''} onChange={(event) => handleClinicChange(record.id, event.target.value)}><option value="">Selecione</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></td>
                    <td><span className="financial-readonly-cell">{record.operator_name || '-'}</span></td>
                    <td><input value={record.campaign || ''} onChange={(event) => patchRecord(record.id, { campaign: event.target.value })} /></td>
                    <td><input value={record.leads || ''} type="number" onChange={(event) => patchRecord(record.id, { leads: event.target.value })} /></td>
                    <td><input value={record.revenue || ''} type="number" step="0.01" onChange={(event) => patchRecord(record.id, { revenue: event.target.value })} /></td>
                    <td>{formatCurrency(record.total_crc_cost)}</td>
                    <td>{formatCurrency(record.profit)}</td>
                    <td>{formatPercent(record.roi_crc)}</td>
                    <td><span className={`financial-status-badge ${record.status}`}>{record.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="financial-editor-panel">
          {selectedRecord ? (
            <>
              <div className="financial-card-heading">
                <h2>Editor do lançamento</h2>
                <p>{selectedRecord.__draft ? 'Novo registro' : `Registro #${selectedRecord.id}`} · operador, função e SELIC preenchidos automaticamente.</p>
              </div>
              {renderGroup('general', '1. Dados Gerais', generalFields, selectedRecord)}
              {renderGroup('production', '2. Produção CRC', productionFields, selectedRecord)}
              {renderGroup('operational', '3. Custos Operacionais', operationalCostFields, selectedRecord)}
              {renderGroup('marketing', '4. Custos de Marketing', marketingCostFields, selectedRecord)}
              {renderGroup('administrative', '5. Custos Administrativos', administrativeCostFields, selectedRecord)}
              <section className="financial-editor-group">
                <button type="button" className="financial-group-toggle" onClick={() => setOpenGroups((current) => ({ ...current, results: !current.results }))}>
                  <span>6. Resultados Calculados</span>
                  <strong>{openGroups.results ? 'Recolher' : 'Expandir'}</strong>
                </button>
                {openGroups.results && (
                  <div className="financial-calculated-grid">
                    <span>Custo Total Colaborador<strong>{formatCurrency(selectedRecord.total_collaborator_cost)}</strong></span>
                    <span>Custo Total Operacional<strong>{formatCurrency(selectedRecord.total_operational_cost)}</strong></span>
                    <span>Custo Total Marketing<strong>{formatCurrency(selectedRecord.total_marketing_cost)}</strong></span>
                    <span>Custo Total Administrativo<strong>{formatCurrency(selectedRecord.total_administrative_cost)}</strong></span>
                    <span>Custo Total CRC<strong>{formatCurrency(selectedRecord.total_crc_cost)}</strong></span>
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
              <label>Observações<textarea className="field textarea" value={selectedRecord.notes || ''} onChange={(event) => patchRecord(selectedRecord.id, { notes: event.target.value })} /></label>
              <div className="financial-editor-footer">
                <button className="outline-action" onClick={() => saveAll()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
                <button className="primary-action" onClick={() => saveAll({ resetAfter: true })} disabled={saving}>Salvar, limpar e novo lançamento</button>
              </div>
            </>
          ) : (
            <p className="empty-state">Selecione uma linha para editar.</p>
          )}
        </aside>
      </section>

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
              <label>Salário<input className="field" type="number" step="0.01" value={collaboratorDraft.salary} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, salary: event.target.value }))} /></label>
              <label>Status<select className="field" value={collaboratorDraft.status} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, status: event.target.value }))}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
              <label>Encargos<input className="field" type="number" step="0.01" value={collaboratorDraft.charges} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, charges: event.target.value }))} /></label>
              <label>Benefícios<input className="field" type="number" step="0.01" value={collaboratorDraft.benefits} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, benefits: event.target.value }))} /></label>
              <label>Comissão padrão<input className="field" type="number" step="0.01" value={collaboratorDraft.commission_default} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, commission_default: event.target.value }))} /></label>
              <label>Telefonia padrão<input className="field" type="number" step="0.01" value={collaboratorDraft.phone_cost_default} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, phone_cost_default: event.target.value }))} /></label>
              <label>Sistema padrão<input className="field" type="number" step="0.01" value={collaboratorDraft.system_cost_default} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, system_cost_default: event.target.value }))} /></label>
              <label>Infraestrutura padrão<input className="field" type="number" step="0.01" value={collaboratorDraft.infrastructure_cost_default} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, infrastructure_cost_default: event.target.value }))} /></label>
              <label>Outros custos padrão<input className="field" type="number" step="0.01" value={collaboratorDraft.other_costs_default} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, other_costs_default: event.target.value }))} /></label>
            </div>
            <div className="row-actions">
              <button className="outline-action" onClick={() => { setCollaboratorModalOpen(false); resetCollaboratorDraft(); }} disabled={saving}>Cancelar</button>
              <button className="primary-action" onClick={saveCollaborator} disabled={saving}>{saving ? 'Salvando...' : 'Salvar colaborador'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default FinancialIntelligenceManage;
