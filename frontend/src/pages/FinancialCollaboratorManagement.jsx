import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api';
import { hasPermission, isMasterAdmin, readUser } from '../constants';

const FINANCIAL_CENTRAL_CLINIC = { id: 'central-crc', name: 'Escritório Central - CRC', unit: 'CRC' };

const CRC_FUNCTION_OPTIONS = [
  'Operador de CRC',
  'Operador de SAC',
  'Atendente de Relacionamento',
  'Analista de Relacionamento',
  'Analista de Qualidade CRC',
  'Assistente de Back Office',
  'SDR CRC',
  'Consultor de Vendas CRC',
  'Analista de CRM',
  'Supervisor de CRC',
  'Coordenador de CRC',
  'Gerente de CRC'
];

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let normalized = String(value || 0).trim().replace(/\s+/g, '').replace(/[R$%]/g, '');
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

function toFlag(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function calculateDsrOnCommission(commission) {
  return toNumber(commission) / 6;
}

function calculateThirteenthSalary(item = {}, referenceMonth = '') {
  const salary = toNumber(item.salary);
  if (!salary) return 0;
  const month = referenceMonth || item.reference_month || new Date().toISOString().slice(0, 7);
  const hireText = String(item.hire_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}$/.test(month) || !hireText) return salary / 12;

  const hireDate = new Date(`${hireText}T12:00:00`);
  const [year, monthNumber] = month.split('-').map(Number);
  const endOfMonth = new Date(year, monthNumber, 0, 23, 59, 59);
  if (Number.isNaN(hireDate.getTime()) || Number.isNaN(endOfMonth.getTime())) return salary / 12;
  if (hireDate > endOfMonth) return 0;
  if (hireDate.getFullYear() === year && hireDate.getMonth() === monthNumber - 1 && hireDate.getDate() > 16) return 0;
  return salary / 12;
}

function collaboratorCost(item, referenceMonth = '') {
  const commission = toFlag(item.receives_commission) ? toNumber(item.commission_default) : 0;
  return toNumber(item.salary)
    + toNumber(item.charges)
    + toNumber(item.benefits)
    + commission
    + calculateDsrOnCommission(commission)
    + calculateThirteenthSalary(item, referenceMonth)
    + (toFlag(item.vacation_taken) ? toNumber(item.vacation_amount) : 0)
    + toNumber(item.other_costs_default);
}

function emptyDraft(referenceMonth) {
  return {
    name: '',
    role: 'CRC',
    function_name: '',
    clinic_id: '',
    clinic_name: '',
    unit_name: '',
    hire_date: '',
    reference_month: referenceMonth,
    salary: '',
    charges: '',
    benefits: '',
    receives_commission: false,
    commission_default: '',
    dsr_commission: '',
    thirteenth_salary: '',
    vacation_taken: false,
    vacation_amount: '',
    has_other_costs: false,
    other_costs_default: '',
    other_costs_description: '',
    status: 'ativo'
  };
}

function FinancialCollaboratorManagement() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const allowed = hasPermission(user, 'financial_management');
  const canDelete = isMasterAdmin(user);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [referenceMonth, setReferenceMonth] = useState(currentMonth);
  const [collaborators, setCollaborators] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [draft, setDraft] = useState(emptyDraft(currentMonth));
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  const loadData = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setFeedback('');
    try {
      const [collaboratorsRes, clinicsRes] = await Promise.all([
        api.get('/crc-collaborators'),
        api.get('/clinics')
      ]);
      setCollaborators(Array.isArray(collaboratorsRes.data) ? collaboratorsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a gestão de colaboradores.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const rows = useMemo(() => collaborators
    .filter((item) => {
      const month = item.reference_month || String(item.created_at || '').slice(0, 7);
      return !referenceMonth || !month || month <= referenceMonth;
    })
    .map((item) => ({ ...item, monthlyCost: collaboratorCost(item, referenceMonth) }))
    .sort((a, b) => b.monthlyCost - a.monthlyCost || String(a.name).localeCompare(String(b.name))), [collaborators, referenceMonth]);

  const totalCost = useMemo(() => rows.reduce((total, item) => total + item.monthlyCost, 0), [rows]);

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft(referenceMonth || currentMonth));
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setDraft({
      ...emptyDraft(referenceMonth || currentMonth),
      ...item,
      receives_commission: toFlag(item.receives_commission),
      vacation_taken: toFlag(item.vacation_taken),
      has_other_costs: toNumber(item.other_costs_default) > 0 || Boolean(item.other_costs_description)
    });
    setModalOpen(true);
  };

  const handleClinicChange = (clinicId) => {
    if (clinicId === FINANCIAL_CENTRAL_CLINIC.id) {
      setDraft((current) => ({
        ...current,
        clinic_id: FINANCIAL_CENTRAL_CLINIC.id,
        clinic_name: FINANCIAL_CENTRAL_CLINIC.name,
        unit_name: FINANCIAL_CENTRAL_CLINIC.unit
      }));
      return;
    }
    const clinic = clinics.find((item) => String(item.id) === String(clinicId));
    setDraft((current) => ({
      ...current,
      clinic_id: clinic?.id || '',
      clinic_name: clinic?.name || '',
      unit_name: clinic?.city || ''
    }));
  };

  const saveCollaborator = async () => {
    setSaving(true);
    setFeedback('');
    try {
      const payload = { ...draft };
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
      if (editingId) {
        await api.put(`/crc-collaborators/${editingId}`, payload);
      } else {
        await api.post('/crc-collaborators', payload);
      }
      setModalOpen(false);
      await loadData();
      setFeedback('Colaborador salvo com sucesso.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar o colaborador.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCollaborator = async (item) => {
    if (!window.confirm(`Confirma excluir o colaborador ${item.name}?`)) return;
    setSaving(true);
    setFeedback('');
    try {
      await api.delete(`/crc-collaborators/${item.id}`);
      await loadData();
      setFeedback('Colaborador excluído.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir o colaborador.');
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = () => {
    const header = ['Nome', 'Função', 'Clínica', 'Data contratação', 'Mês/Ano', 'Salário', 'Encargos', 'Benefícios', 'Comissão', 'DSR sobre comissão', '13º proporcional', 'Férias', 'Outros custos', 'Descrição outros custos', 'Custo mensal'];
    const csv = [
      `Exportado em;${new Date().toLocaleString('pt-BR')}`,
      `Mês de referência;${referenceMonth}`,
      `Custo total;${totalCost}`,
      '',
      header.join(';'),
      ...rows.map((row) => [
        row.name,
        row.function_name,
        row.clinic_name,
        String(row.hire_date || '').slice(0, 10),
        row.reference_month,
        row.salary,
        row.charges,
        row.benefits,
        toFlag(row.receives_commission) ? row.commission_default : 'Não recebe',
        toFlag(row.receives_commission) ? calculateDsrOnCommission(row.commission_default) : 0,
        calculateThirteenthSalary(row, referenceMonth),
        row.vacation_amount,
        row.other_costs_default,
        row.other_costs_description,
        row.monthlyCost
      ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';'))
    ].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gestao-colaboradores-crc.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Gestão de Colaboradores CRC</title>
      <style>
        body{font-family:Arial,sans-serif;padding:28px;color:#17120f;background:#fffdfa}
        h1{margin:0;color:#2a2218}.sub{color:#6d5b4b;margin:6px 0 18px}
        .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}
        .card{border:1px solid #ddcfbc;border-radius:10px;padding:12px;background:#f8f3eb}
        .card span{display:block;color:#6d5b4b;font-size:10px;text-transform:uppercase;font-weight:700}
        .card strong{font-size:18px}
        table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddcfbc;padding:7px;text-align:left}
        th{background:#efe6d8;text-transform:uppercase;font-size:9px}
      </style></head><body>
      <h1>Gestão de Colaboradores CRC</h1>
      <p class="sub">Relatório exportado em ${new Date().toLocaleString('pt-BR')} · mês ${referenceMonth}</p>
      <section class="cards">
        <article class="card"><span>Colaboradores</span><strong>${rows.length}</strong></article>
        <article class="card"><span>Mês analisado</span><strong>${referenceMonth}</strong></article>
        <article class="card"><span>Custo mensal</span><strong>${formatCurrency(totalCost)}</strong></article>
      </section>
      <table><thead><tr><th>Nome</th><th>Função</th><th>Clínica</th><th>Contratação</th><th>Mês/Ano</th><th>Comissão</th><th>DSR</th><th>13º</th><th>Férias</th><th>Custo mensal</th><th>Status</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.name || ''}</td><td>${row.function_name || ''}</td><td>${row.clinic_name || ''}</td><td>${String(row.hire_date || '').slice(0, 10)}</td><td>${row.reference_month || ''}</td><td>${toFlag(row.receives_commission) ? formatCurrency(row.commission_default) : 'Não'}</td><td>${toFlag(row.receives_commission) ? formatCurrency(calculateDsrOnCommission(row.commission_default)) : 'Não'}</td><td>${formatCurrency(calculateThirteenthSalary(row, referenceMonth))}</td><td>${toFlag(row.vacation_taken) ? formatCurrency(row.vacation_amount) : 'Não'}</td><td>${formatCurrency(row.monthlyCost)}</td><td>${row.status || ''}</td></tr>`).join('')}</tbody></table>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  if (!allowed) {
    return (
      <main className="app-page">
        <section className="restricted-panel">
          <p className="eyebrow">Acesso restrito</p>
          <h1>Gestão de colaboradores CRC</h1>
          <p>Seu perfil não possui autorização para acessar esta página.</p>
          <button className="primary-action" onClick={() => navigate('/home')}>Voltar para Home</button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page financial-page">
      <header className="page-heading financial-heading">
        <div>
          <p className="eyebrow">Gestão Financeira CRC</p>
          <h1>Gestão de colaboradores</h1>
          <p>Cadastro, edição, custos mensais, férias e comissão para análise do ROI geral.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/home/financial-intelligence/manage')}>Gestão financeira</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="financial-sheet-summary">
        <article><span>Colaboradores</span><strong>{rows.length}</strong></article>
        <article><span>Mês analisado</span><strong>{referenceMonth}</strong></article>
        <article><span>Custo mensal</span><strong>{formatCurrency(totalCost)}</strong></article>
      </section>

      <section className="financial-export-bar">
        <button className="primary-action" onClick={openNew}>+ Novo colaborador</button>
        <button className="outline-action icon-action" onClick={exportExcel}><span className="file-icon xls">XLS</span>Exportar Excel</button>
        <button className="outline-action icon-action" onClick={exportPdf}><span className="file-icon pdf">PDF</span>Exportar PDF</button>
      </section>

      <section className="financial-filter-panel compact">
        <label>Mês de referência<input className="field" type="month" value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} /></label>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}

      <section className="financial-sheet-wrap">
        {loading ? <p className="empty-state">Carregando colaboradores...</p> : (
          <table className="financial-sheet-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Função</th>
                <th>Clínica</th>
                <th>Contratação</th>
                <th>Mês/Ano</th>
                <th>Comissão</th>
                <th>DSR</th>
                <th>13º</th>
                <th>Outros custos</th>
                <th>Férias</th>
                <th>Custo mensal</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong></td>
                  <td>{item.function_name || '-'}</td>
                  <td>{item.clinic_name || '-'}</td>
                  <td>{String(item.hire_date || '').slice(0, 10) || '-'}</td>
                  <td>{item.reference_month || '-'}</td>
                  <td>{toFlag(item.receives_commission) ? formatCurrency(item.commission_default) : 'Não recebe'}</td>
                  <td>{toFlag(item.receives_commission) ? formatCurrency(calculateDsrOnCommission(item.commission_default)) : 'Não'}</td>
                  <td>{formatCurrency(calculateThirteenthSalary(item, referenceMonth))}</td>
                  <td>{toNumber(item.other_costs_default) > 0 ? formatCurrency(item.other_costs_default) : 'Não'}</td>
                  <td>{toFlag(item.vacation_taken) ? formatCurrency(item.vacation_amount) : 'Não'}</td>
                  <td>{formatCurrency(item.monthlyCost)}</td>
                  <td><span className={`financial-status-badge ${item.status === 'ativo' ? 'excelente' : 'atencao'}`}>{item.status}</span></td>
                  <td>
                    <div className="financial-row-actions">
                      <button className="outline-action mini-action" onClick={() => openEdit(item)}>Editar</button>
                      {canDelete && <button className="outline-action danger-action mini-action" onClick={() => deleteCollaborator(item)} disabled={saving}>Excluir</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setModalOpen(false)}>
          <section className="modal-panel financial-collaborator-modal" onClick={(event) => event.stopPropagation()}>
            <div className="financial-card-heading">
              <p className="eyebrow">Colaborador CRC</p>
              <h2>{editingId ? 'Editar colaborador' : 'Novo colaborador'}</h2>
            </div>
            <div className="financial-editor-grid">
              <label>Nome<input className="field" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Função/Cargo<select className="field" value={draft.function_name} onChange={(event) => setDraft((current) => ({ ...current, function_name: event.target.value }))}><option value="">Selecione</option>{CRC_FUNCTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
              <label>Clínica<select className="field" value={draft.clinic_id || (draft.clinic_name === FINANCIAL_CENTRAL_CLINIC.name ? FINANCIAL_CENTRAL_CLINIC.id : '')} onChange={(event) => handleClinicChange(event.target.value)}><option value="">Selecione</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
              <label>Unidade<input className="field" value={draft.unit_name || ''} onChange={(event) => setDraft((current) => ({ ...current, unit_name: event.target.value }))} /></label>
              <label>Data de contratação<input className="field" type="date" value={String(draft.hire_date || '').slice(0, 10)} onChange={(event) => setDraft((current) => ({ ...current, hire_date: event.target.value }))} /></label>
              <label>Mês/Ano<input className="field" type="month" value={draft.reference_month || referenceMonth} onChange={(event) => setDraft((current) => ({ ...current, reference_month: event.target.value }))} /></label>
              <label>Salário<input className="field" type="number" step="0.01" value={draft.salary || ''} onChange={(event) => setDraft((current) => ({ ...current, salary: event.target.value }))} /></label>
              <label>Encargos<input className="field" type="number" step="0.01" value={draft.charges || ''} onChange={(event) => setDraft((current) => ({ ...current, charges: event.target.value }))} /></label>
              <label>Benefícios<input className="field" type="number" step="0.01" value={draft.benefits || ''} onChange={(event) => setDraft((current) => ({ ...current, benefits: event.target.value }))} /></label>
              <label>Recebe comissão?<select className="field" value={toFlag(draft.receives_commission) ? 'sim' : 'nao'} onChange={(event) => setDraft((current) => ({ ...current, receives_commission: event.target.value === 'sim', commission_default: event.target.value === 'sim' ? current.commission_default : '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {toFlag(draft.receives_commission) && <label>Comissão<input className="field" type="number" step="0.01" value={draft.commission_default || ''} onChange={(event) => setDraft((current) => ({ ...current, commission_default: event.target.value }))} /></label>}
              {toFlag(draft.receives_commission) && <label>DSR sobre comissão<input className="field" value={formatCurrency(calculateDsrOnCommission(draft.commission_default))} readOnly /></label>}
              <label>13º proporcional<input className="field" value={formatCurrency(calculateThirteenthSalary(draft, draft.reference_month || referenceMonth))} readOnly /></label>
              <label>Férias?<select className="field" value={toFlag(draft.vacation_taken) ? 'sim' : 'nao'} onChange={(event) => setDraft((current) => ({ ...current, vacation_taken: event.target.value === 'sim' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {toFlag(draft.vacation_taken) && <label>Valor das férias<input className="field" type="number" step="0.01" value={draft.vacation_amount || ''} onChange={(event) => setDraft((current) => ({ ...current, vacation_amount: event.target.value }))} /></label>}
              <label>Houve outros custos?<select className="field" value={toFlag(draft.has_other_costs) ? 'sim' : 'nao'} onChange={(event) => setDraft((current) => ({ ...current, has_other_costs: event.target.value === 'sim', other_costs_default: event.target.value === 'sim' ? current.other_costs_default : '', other_costs_description: event.target.value === 'sim' ? current.other_costs_description : '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {toFlag(draft.has_other_costs) && <label>Valor de outros custos<input className="field" type="number" step="0.01" value={draft.other_costs_default || ''} onChange={(event) => setDraft((current) => ({ ...current, other_costs_default: event.target.value }))} /></label>}
              {toFlag(draft.has_other_costs) && <label className="wide-field">Descrição dos outros custos<input className="field" value={draft.other_costs_description || ''} onChange={(event) => setDraft((current) => ({ ...current, other_costs_description: event.target.value }))} /></label>}
              <label>Status<select className="field" value={draft.status || 'ativo'} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
            </div>
            <div className="row-actions">
              <button className="outline-action" onClick={() => setModalOpen(false)} disabled={saving}>Cancelar</button>
              <button className="primary-action" onClick={saveCollaborator} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default FinancialCollaboratorManagement;
