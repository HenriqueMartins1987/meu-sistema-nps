import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api';
import { isAdmin, isMasterAdmin, readUser } from '../constants';

const DEFAULT_SELIC = 13.75;

const generalFields = [
  ['date', 'Data', 'date'],
  ['clinic_id', 'Clínica', 'clinic'],
  ['unit_name', 'Unidade', 'text'],
  ['supervisor_name', 'Supervisor', 'text'],
  ['operator_name', 'Operador', 'text'],
  ['collaborator_id', 'Colaborador', 'collaborator'],
  ['function_name', 'Função/Cargo', 'text'],
  ['campaign', 'Campanha', 'text'],
  ['channel', 'Canal', 'select', ['WhatsApp', 'Instagram', 'Facebook', 'Google', 'Indicação', 'Telefone', 'Presencial', 'Outros']],
  ['selic_rate', 'SELIC anual', 'percent']
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
  ['supervision_cost', 'Supervisão'],
  ['management_cost', 'Gerência'],
  ['coordination_cost', 'Coordenação'],
  ['audit_cost', 'Auditoria'],
  ['consulting_cost', 'Consultoria'],
  ['legal_cost', 'Jurídico'],
  ['compliance_cost', 'Compliance'],
  ['finance_cost', 'Financeiro'],
  ['accounting_cost', 'Contabilidade'],
  ['other_administrative_costs', 'Outros Custos Administrativos']
];

const allExportFields = [
  ...generalFields.map(([field, label]) => [field, label]),
  ...productionFields.map(([field, label]) => [field, label]),
  ...collaboratorCostFields,
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

function buildEmptyRecord(user) {
  const actorName = user?.name || user?.email || '';
  return {
    id: `draft-${Date.now()}`,
    __draft: true,
    __dirty: true,
    date: new Date().toISOString().slice(0, 10),
    selic_rate: DEFAULT_SELIC,
    supervisor_name: String(user?.role || '').toLowerCase() === 'supervisor_crc' ? actorName : '',
    operator_name: String(user?.role || '').toLowerCase() === 'sac_operator' ? actorName : '',
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
  const [records, setRecords] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ search: '', clinicId: '', collaboratorId: '', status: '' });
  const [openGroups, setOpenGroups] = useState({
    general: true,
    production: true,
    collaborator: false,
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
  const [collaboratorDraft, setCollaboratorDraft] = useState({
    name: '',
    role: 'CRC',
    function_name: '',
    clinic_id: '',
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

  const loadData = useCallback(async () => {
    if (!allowed) return;

    setLoading(true);
    setFeedback('');

    try {
      const [financialRes, collaboratorsRes, clinicsRes] = await Promise.all([
        api.get('/financial-intelligence'),
        api.get('/crc-collaborators'),
        api.get('/clinics')
      ]);
      const rows = Array.isArray(financialRes.data?.table) ? financialRes.data.table.map(normalizeRecord) : [];
      setRecords(rows);
      setSelectedId((current) => current || rows[0]?.id || null);
      setCollaborators(Array.isArray(collaboratorsRes.data) ? collaboratorsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
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
  const filteredRecords = useMemo(() => records.filter((record) => {
    const text = [record.clinic_name, record.unit_name, record.collaborator_name, record.operator_name, record.campaign, record.channel, record.function_name].join(' ').toLowerCase();
    const searchOk = !filters.search || text.includes(filters.search.toLowerCase());
    const clinicOk = !filters.clinicId || String(record.clinic_id || '') === String(filters.clinicId);
    const collaboratorOk = !filters.collaboratorId || String(record.collaborator_id || '') === String(filters.collaboratorId);
    const statusOk = !filters.status || record.status === filters.status;
    return searchOk && clinicOk && collaboratorOk && statusOk;
  }), [records, filters]);

  const totals = useMemo(() => filteredRecords.reduce((acc, row) => {
    const calculated = calculate(row);
    acc.revenue += toNumber(row.revenue);
    acc.cost += calculated.total_crc_cost;
    acc.profit += calculated.profit;
    return acc;
  }, { revenue: 0, cost: 0, profit: 0 }), [filteredRecords]);

  const patchRecord = (id, changes) => {
    setRecords((current) => current.map((record) => {
      if (String(record.id) !== String(id)) return record;
      const next = normalizeRecord({ ...record, ...changes, __dirty: true });
      return next;
    }));
  };

  const handleClinicChange = (id, clinicId) => {
    const clinic = clinics.find((item) => String(item.id) === String(clinicId));
    patchRecord(id, {
      clinic_id: clinic?.id || '',
      clinic_name: clinic?.name || '',
      unit_name: clinic?.city || ''
    });
  };

  const handleCollaboratorChange = (id, collaboratorId) => {
    const collaborator = collaborators.find((item) => String(item.id) === String(collaboratorId));

    if (!collaborator) {
      patchRecord(id, { collaborator_id: '', collaborator_name: '' });
      return;
    }

    patchRecord(id, {
      collaborator_id: collaborator.id,
      collaborator_name: collaborator.name,
      function_name: collaborator.function_name,
      role: collaborator.role,
      clinic_id: collaborator.clinic_id || '',
      clinic_name: collaborator.clinic_name || '',
      unit_name: collaborator.unit_name || '',
      salary: collaborator.salary || 0,
      charges: collaborator.charges || 0,
      benefits: collaborator.benefits || 0,
      commission: collaborator.commission_default || 0,
      phone_cost: collaborator.phone_cost_default || 0,
      system_cost: collaborator.system_cost_default || 0,
      infrastructure_cost: collaborator.infrastructure_cost_default || 0,
      other_collaborator_costs: collaborator.other_costs_default || 0
    });
  };

  const addRecord = () => {
    const draft = normalizeRecord(buildEmptyRecord(user));
    setRecords((current) => [draft, ...current]);
    setSelectedId(draft.id);
    setToast('Novo lançamento criado. Preencha os dados e salve.');
  };

  const duplicateRecord = () => {
    if (!selectedRecord) return;
    const duplicated = normalizeRecord({
      ...selectedRecord,
      id: `draft-${Date.now()}`,
      __draft: true,
      __dirty: true,
      date: new Date().toISOString().slice(0, 10)
    });
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

  const saveAll = async () => {
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
      setToast('Alterações salvas com sucesso.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar as alterações.');
    } finally {
      setSaving(false);
    }
  };

  const saveCollaborator = async () => {
    setSaving(true);
    setFeedback('');

    try {
      await api.post('/crc-collaborators', collaboratorDraft);
      setCollaboratorModalOpen(false);
      setCollaboratorDraft({
        name: '',
        role: 'CRC',
        function_name: '',
        clinic_id: '',
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
      setToast('Colaborador cadastrado com sucesso.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível cadastrar o colaborador.');
    } finally {
      setSaving(false);
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
      <table><thead><tr><th>Data</th><th>Clínica</th><th>Colaborador</th><th>Campanha</th><th>Receita</th><th>Custo</th><th>Lucro</th><th>ROI</th><th>Status</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.date || ''}</td><td>${row.clinic_name || ''}</td><td>${row.collaborator_name || ''}</td><td>${row.campaign || ''}</td><td>${formatCurrency(row.revenue)}</td><td>${formatCurrency(row.total_crc_cost)}</td><td>${formatCurrency(row.profit)}</td><td>${formatPercent(row.roi_crc)}</td><td>${row.status || ''}</td></tr>`).join('')}</tbody></table>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const renderField = (record, [field, label, type = 'currency', options = []]) => {
    if (type === 'clinic') {
      return (
        <label key={field}>{label}
          <select className="field" value={record.clinic_id || ''} onChange={(event) => handleClinicChange(record.id, event.target.value)}>
            <option value="">Selecione</option>
            {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
          </select>
        </label>
      );
    }

    if (type === 'collaborator') {
      return (
        <label key={field}>{label}
          <select className="field" value={record.collaborator_id || ''} onChange={(event) => handleCollaboratorChange(record.id, event.target.value)}>
            <option value="">Selecione</option>
            {collaborators.filter((item) => item.status !== 'inativo').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
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
          <p>Lançamento inteligente de custos, produção, marketing, colaboradores e resultados calculados.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/home/financial-intelligence')}>Dashboard</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="financial-toolbar">
        <button className="primary-action" onClick={addRecord}>+ Novo Lançamento</button>
        <button className="secondary-action" onClick={() => setCollaboratorModalOpen(true)}>+ Cadastrar Colaborador</button>
        <button className="outline-action" onClick={saveAll} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
        <button className="outline-action" onClick={duplicateRecord} disabled={!selectedRecord}>Duplicar linha</button>
        <button className="outline-action danger-action" onClick={deleteSelected} disabled={!selectedRecord || saving}>Excluir</button>
        <button className="outline-action" onClick={exportExcel}>Exportar Excel</button>
        <button className="outline-action" onClick={exportPdf}>Exportar PDF</button>
        <button className="outline-action" onClick={() => setFilters({ search: '', clinicId: '', collaboratorId: '', status: '' })}>Limpar filtros</button>
      </section>

      <section className="financial-filter-panel compact">
        <label>Buscar<input className="field" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Clínica, colaborador, campanha..." /></label>
        <label>Clínica<select className="field" value={filters.clinicId} onChange={(event) => setFilters((current) => ({ ...current, clinicId: event.target.value }))}><option value="">Todas</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
        <label>Colaborador<select className="field" value={filters.collaboratorId} onChange={(event) => setFilters((current) => ({ ...current, collaboratorId: event.target.value }))}><option value="">Todos</option>{collaborators.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Status<select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option><option value="excelente">Excelente</option><option value="adequado">Adequado</option><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></label>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}
      {toast && <p className="form-feedback success-feedback">{toast}</p>}

      <section className="financial-sheet-summary">
        <article><span>Receita</span><strong>{formatCurrency(totals.revenue)}</strong></article>
        <article><span>Custo</span><strong>{formatCurrency(totals.cost)}</strong></article>
        <article><span>Lucro</span><strong>{formatCurrency(totals.profit)}</strong></article>
        <article><span>Linhas</span><strong>{filteredRecords.length}</strong></article>
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
                  <th>Colaborador</th>
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
                    <td><select value={record.clinic_id || ''} onChange={(event) => handleClinicChange(record.id, event.target.value)}><option value="">Selecione</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></td>
                    <td><select value={record.collaborator_id || ''} onChange={(event) => handleCollaboratorChange(record.id, event.target.value)}><option value="">Selecione</option>{collaborators.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
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
                <p>{selectedRecord.__draft ? 'Novo registro' : `Registro #${selectedRecord.id}`} · campos calculados bloqueados.</p>
              </div>
              {renderGroup('general', '1. Dados Gerais', generalFields, selectedRecord)}
              {renderGroup('production', '2. Produção CRC', productionFields, selectedRecord)}
              {renderGroup('collaborator', '3. Custos do Colaborador', collaboratorCostFields, selectedRecord)}
              {renderGroup('operational', '4. Custos Operacionais', operationalCostFields, selectedRecord)}
              {renderGroup('marketing', '5. Custos de Marketing', marketingCostFields, selectedRecord)}
              {renderGroup('administrative', '6. Custos Administrativos', administrativeCostFields, selectedRecord)}
              <section className="financial-editor-group">
                <button type="button" className="financial-group-toggle" onClick={() => setOpenGroups((current) => ({ ...current, results: !current.results }))}>
                  <span>7. Resultados Calculados</span>
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
              <p>Os valores padrão serão puxados automaticamente ao selecionar o colaborador no lançamento.</p>
            </div>
            <div className="financial-editor-grid">
              <label>Nome do colaborador<input className="field" value={collaboratorDraft.name} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Função/Cargo<input className="field" value={collaboratorDraft.function_name} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, function_name: event.target.value }))} /></label>
              <label>Clínica<select className="field" value={collaboratorDraft.clinic_id} onChange={(event) => setCollaboratorDraft((current) => ({ ...current, clinic_id: event.target.value }))}><option value="">Selecione</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
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
              <button className="outline-action" onClick={() => setCollaboratorModalOpen(false)} disabled={saving}>Cancelar</button>
              <button className="primary-action" onClick={saveCollaborator} disabled={saving}>{saving ? 'Salvando...' : 'Salvar colaborador'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default FinancialIntelligenceManage;
