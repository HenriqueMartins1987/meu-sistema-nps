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

const defaultLaborCostRules = {
  percentualFgts: 8,
  percentual13: 8.3333,
  percentualFerias: 8.3333,
  percentualTercoFerias: 2.7778,
  aplicarInssPatronal: true,
  percentualInssPatronal: 20,
  percentualRat: 1,
  fatorFap: 1,
  percentualTerceiros: 5.8,
  percentualProvisaoRescisoria: 4,
  percentualAbsenteismo: 2,
  percentualTurnover: 2,
  monthlyWorkHours: 220
};

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

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function percentOf(value, total) {
  const divisor = toNumber(total);
  return divisor ? round((toNumber(value) / divisor) * 100) : 0;
}

function normalizeLaborReferenceMonth(value) {
  if (!value) return '';
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 7);
}

function getThirteenthProvisionPercent(item = {}, rules = defaultLaborCostRules, monthlyCost = null) {
  const defaultPercent = toNumber(rules.percentual13);
  const referenceMonth = normalizeLaborReferenceMonth(
    monthlyCost?.reference_month
    || item.reference_month
    || new Date().toISOString().slice(0, 7)
  );
  const hireDateText = item.hire_date ? String(item.hire_date).slice(0, 10) : '';
  if (!referenceMonth || !hireDateText) return defaultPercent;

  const hireDate = new Date(`${hireDateText}T12:00:00`);
  const [year, monthNumber] = referenceMonth.split('-').map(Number);
  const endOfReferenceMonth = new Date(year, monthNumber, 0, 23, 59, 59);
  if (Number.isNaN(hireDate.getTime()) || Number.isNaN(endOfReferenceMonth.getTime())) return defaultPercent;
  if (hireDate > endOfReferenceMonth) return 0;
  if (hireDate.getFullYear() === year && hireDate.getMonth() === monthNumber - 1 && hireDate.getDate() > 16) return 0;
  return defaultPercent;
}

function normalizeLaborRules(settings = {}) {
  return {
    ...defaultLaborCostRules,
    ...(settings.laborCostRules || {})
  };
}

function calculateLaborCost(item = {}, rulesSource = {}, monthlyCost = null) {
  const rules = normalizeLaborRules(rulesSource);
  const monthlyCommission = toFlag(item.receives_commission) ? toNumber(monthlyCost?.commission) : 0;
  const salarioRemuneracaoBase = round(
    toNumber(item.salary)
    + toNumber(item.fixed_commission || item.commission_default)
    + monthlyCommission
    + toNumber(item.fixed_gratification)
    + toNumber(item.fixed_additional)
  );
  const beneficiosTotais = round(
    toNumber(item.benefits)
    + toNumber(item.transport_voucher)
    + toNumber(item.food_voucher)
    + toNumber(item.meal_voucher)
    + toNumber(item.health_plan)
    + toNumber(item.dental_plan)
    + toNumber(item.cost_allowance)
    + toNumber(item.other_benefits)
    + toNumber(item.bonus)
  );
  const fgts = round(salarioRemuneracaoBase * (toNumber(rules.percentualFgts) / 100));
  const decimoTerceiroPercent = getThirteenthProvisionPercent(item, rules, monthlyCost);
  const decimoTerceiro = round(salarioRemuneracaoBase * (decimoTerceiroPercent / 100));
  const ferias = round(salarioRemuneracaoBase * (toNumber(rules.percentualFerias) / 100));
  const tercoFerias = round(salarioRemuneracaoBase * (toNumber(rules.percentualTercoFerias) / 100));
  const inssPatronal = round(salarioRemuneracaoBase * (toNumber(rules.percentualInssPatronal) / 100));
  const ratAjustado = round(salarioRemuneracaoBase * (toNumber(rules.percentualRat) / 100) * toNumber(rules.fatorFap || 1));
  const terceiros = round(salarioRemuneracaoBase * (toNumber(rules.percentualTerceiros) / 100));
  const provisaoRescisoria = round(salarioRemuneracaoBase * (toNumber(rules.percentualProvisaoRescisoria) / 100));
  const custoAbsenteismo = round(salarioRemuneracaoBase * (toNumber(rules.percentualAbsenteismo) / 100));
  const custoTurnover = round(salarioRemuneracaoBase * (toNumber(rules.percentualTurnover) / 100));
  const encargosObrigatorios = round(fgts + inssPatronal + ratAjustado + terceiros);
  const provisoesTrabalhistas = round(decimoTerceiro + ferias + tercoFerias);
  const provisoesGerenciais = round(provisaoRescisoria + custoAbsenteismo + custoTurnover);
  const custoTotalMensal = round(salarioRemuneracaoBase + beneficiosTotais + encargosObrigatorios + provisoesTrabalhistas + provisoesGerenciais);
  const components = [
    ['salario_remuneracao_base', 'Salário/Remuneração Base', salarioRemuneracaoBase],
    ['beneficios_totais', 'Benefícios', beneficiosTotais],
    ['fgts', 'FGTS', fgts],
    ['inss_patronal', 'INSS Patronal', inssPatronal],
    ['rat_ajustado', 'RAT/SAT ajustado', ratAjustado],
    ['terceiros', 'Terceiros/Sistema S', terceiros],
    ['decimo_terceiro', '13º Salário', decimoTerceiro],
    ['ferias', 'Férias', ferias],
    ['terco_ferias', '1/3 Férias', tercoFerias],
    ['provisao_rescisoria', 'Provisão Rescisória', provisaoRescisoria],
    ['custo_absenteismo', 'Absenteísmo', custoAbsenteismo],
    ['custo_turnover', 'Turnover', custoTurnover]
  ].map(([key, label, value]) => ({ key, label, value, percent: percentOf(value, custoTotalMensal) }));

  return {
    salario_remuneracao_base: salarioRemuneracaoBase,
    beneficios_totais: beneficiosTotais,
    fgts,
    decimo_terceiro: decimoTerceiro,
    decimo_terceiro_percentual_aplicado: round(decimoTerceiroPercent, 4),
    ferias,
    terco_ferias: tercoFerias,
    inss_patronal: inssPatronal,
    rat_ajustado: ratAjustado,
    terceiros,
    provisao_rescisoria: provisaoRescisoria,
    custo_absenteismo: custoAbsenteismo,
    custo_turnover: custoTurnover,
    encargos_obrigatorios: encargosObrigatorios,
    provisoes_trabalhistas: provisoesTrabalhistas,
    provisoes_gerenciais: provisoesGerenciais,
    custo_total_mensal: custoTotalMensal,
    custo_total_anual: round(custoTotalMensal * 12),
    categories: [
      { label: 'Salário', value: salarioRemuneracaoBase, percent: percentOf(salarioRemuneracaoBase, custoTotalMensal) },
      { label: 'Benefícios', value: beneficiosTotais, percent: percentOf(beneficiosTotais, custoTotalMensal) },
      { label: 'Encargos', value: encargosObrigatorios, percent: percentOf(encargosObrigatorios, custoTotalMensal) },
      { label: 'Provisões trabalhistas', value: provisoesTrabalhistas, percent: percentOf(provisoesTrabalhistas, custoTotalMensal) },
      { label: 'Provisões gerenciais', value: provisoesGerenciais, percent: percentOf(provisoesGerenciais, custoTotalMensal) }
    ],
    components
  };
}

function LaborCostComposition({ laborCosts }) {
  const data = laborCosts || calculateLaborCost();
  const summaryCards = [
    { label: 'Salario base', value: data.salario_remuneracao_base },
    { label: 'Beneficios', value: data.beneficios_totais },
    { label: 'Encargos obrigatorios', value: data.encargos_obrigatorios },
    { label: 'Provisoes trabalhistas', value: data.provisoes_trabalhistas },
    { label: 'Provisoes gerenciais', value: data.provisoes_gerenciais },
    { label: 'Custo total mensal', value: data.custo_total_mensal },
    { label: 'Custo total anual', value: data.custo_total_anual }
  ];

  return (
    <section className="financial-labor-preview">
      <div className="financial-card-heading">
        <p className="eyebrow">Custos Trabalhistas</p>
        <h3>Composicao do custo trabalhista</h3>
      </div>

      <div className="financial-labor-cards">
        {summaryCards.map((card) => (
          <article key={card.label}>
            <span>{card.label}</span>
            <strong>{formatCurrency(card.value)}</strong>
          </article>
        ))}
      </div>

      <div className="financial-labor-layout">
        <div className="financial-labor-table-wrap">
          <table className="financial-labor-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Valor R$</th>
                <th>% custo total</th>
              </tr>
            </thead>
            <tbody>
              {data.components.map((component) => (
                <tr key={component.key}>
                  <td>{component.label}</td>
                  <td>{formatCurrency(component.value)}</td>
                  <td>{component.percent.toFixed(2)}%</td>
                </tr>
              ))}
              <tr className="financial-labor-total-row">
                <td>Custo Total Mensal</td>
                <td>{formatCurrency(data.custo_total_mensal)}</td>
                <td>100,00%</td>
              </tr>
              <tr className="financial-labor-total-row">
                <td>Custo Total Anual</td>
                <td>{formatCurrency(data.custo_total_anual)}</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="financial-labor-chart" aria-label="Grafico de composicao do custo">
          {data.categories.map((category) => (
            <div className="financial-labor-bar" key={category.label}>
              <span>{category.label}</span>
              <div className="financial-labor-track">
                <div className="financial-labor-fill" style={{ width: `${Math.min(100, Math.max(0, category.percent))}%` }} />
              </div>
              <strong>{category.percent.toFixed(2)}%</strong>
            </div>
          ))}
        </div>
      </div>

      <p className="financial-labor-warning">
        Os calculos apresentados sao estimativas gerenciais. Os percentuais podem variar conforme regime tributario, CNAE, FPAS, RAT/FAP, convencao coletiva, folha de pagamento e orientacao contabil/juridica aplicavel.
      </p>
    </section>
  );
}

function collaboratorCost(item, referenceMonth = '', monthlyCost = null, settings = {}) {
  const commission = toFlag(item.receives_commission) ? toNumber(monthlyCost?.commission) : 0;
  const vacationAmount = toFlag(monthlyCost?.vacation_paid) ? toNumber(monthlyCost?.vacation_amount) : 0;
  const labor = calculateLaborCost(item, settings, monthlyCost);
  return labor.custo_total_mensal
    + calculateDsrOnCommission(commission)
    + vacationAmount
    + toNumber(item.other_costs_default)
    + toNumber(monthlyCost?.other_costs);
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
    benefits: '',
    fixed_commission: '',
    fixed_gratification: '',
    fixed_additional: '',
    transport_voucher: '',
    food_voucher: '',
    meal_voucher: '',
    health_plan: '',
    dental_plan: '',
    cost_allowance: '',
    other_benefits: '',
    bonus: '',
    receives_commission: false,
    commission_default: '',
    dsr_commission: '',
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
  const [monthlyCosts, setMonthlyCosts] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [settings, setSettings] = useState({});
  const [draft, setDraft] = useState(emptyDraft(currentMonth));
  const [detailCollaborator, setDetailCollaborator] = useState(null);
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
      const [collaboratorsRes, monthlyCostsRes, clinicsRes, settingsRes] = await Promise.all([
        api.get('/crc-collaborators'),
        api.get('/crc-collaborator-monthly-costs', { params: { referenceMonth } }),
        api.get('/clinics'),
        api.get('/admin/financial-settings').catch(() => ({ data: {} }))
      ]);
      setCollaborators(Array.isArray(collaboratorsRes.data) ? collaboratorsRes.data : []);
      setMonthlyCosts(Array.isArray(monthlyCostsRes.data) ? monthlyCostsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setSettings(settingsRes.data || {});
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a gestão de parceiros.');
    } finally {
      setLoading(false);
    }
  }, [allowed, referenceMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const rows = useMemo(() => {
    const monthlyByCollaborator = monthlyCosts.reduce((acc, item) => {
      acc[String(item.collaborator_id)] = item;
      return acc;
    }, {});

    return collaborators.filter((item) => {
      const month = item.reference_month || String(item.created_at || '').slice(0, 7);
      return !referenceMonth || !month || month <= referenceMonth;
    })
      .map((item) => {
        const monthly = monthlyByCollaborator[String(item.id)] || null;
        const commission = toFlag(item.receives_commission) ? toNumber(monthly?.commission) : 0;
        const vacationAmount = toFlag(monthly?.vacation_paid) ? toNumber(monthly?.vacation_amount) : 0;
        const laborCosts = calculateLaborCost(item, settings, monthly);
        return {
          ...item,
          laborCosts,
          monthlyCommission: commission,
          dsrCommission: calculateDsrOnCommission(commission),
          monthlyVacation: vacationAmount,
          monthlyCost: collaboratorCost(item, referenceMonth, monthly, settings)
        };
      })
      .sort((a, b) => b.monthlyCost - a.monthlyCost || String(a.name).localeCompare(String(b.name)));
  }, [collaborators, monthlyCosts, referenceMonth, settings]);

  const totalCost = useMemo(() => rows.reduce((total, item) => total + item.monthlyCost, 0), [rows]);
  const draftLaborCosts = useMemo(() => calculateLaborCost(draft, settings), [draft, settings]);

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
      payload.commission_default = '';
      payload.vacation_taken = false;
      payload.vacation_amount = '';
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
      setFeedback('Parceiro salvo com sucesso.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar o parceiro.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCollaborator = async (item) => {
    if (!window.confirm(`Confirma excluir o parceiro ${item.name}?`)) return;
    setSaving(true);
    setFeedback('');
    try {
      await api.delete(`/crc-collaborators/${item.id}`);
      await loadData();
      setFeedback('Parceiro excluído.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir o parceiro.');
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = () => {
    const header = ['Nome', 'Funcao', 'Clinica', 'Data contratacao', 'Mes/Ano', 'Salario base', 'Beneficios', 'Encargos obrigatorios', 'Provisoes trabalhistas', 'Provisoes gerenciais', 'Comissao mensal', 'DSR sobre comissao', 'Ferias pagas no mes', 'Outros custos', 'Descricao outros custos', 'Custo mensal', 'Custo anual'];
    const csv = [
      `Exportado em;${new Date().toLocaleString('pt-BR')}`,
      `Mes de referencia;${referenceMonth}`,
      `Custo total;${totalCost}`,
      '',
      header.join(';'),
      ...rows.map((row) => [
        row.name,
        row.function_name,
        row.clinic_name,
        String(row.hire_date || '').slice(0, 10),
        row.reference_month,
        row.laborCosts?.salario_remuneracao_base,
        row.laborCosts?.beneficios_totais,
        row.laborCosts?.encargos_obrigatorios,
        row.laborCosts?.provisoes_trabalhistas,
        row.laborCosts?.provisoes_gerenciais,
        toFlag(row.receives_commission) ? row.monthlyCommission : 'Nao recebe',
        toFlag(row.receives_commission) ? row.dsrCommission : 0,
        row.monthlyVacation,
        row.other_costs_default,
        row.other_costs_description,
        row.monthlyCost,
        row.laborCosts?.custo_total_anual
      ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';'))
    ].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gestao-parceiros-crc.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Gestão de Parceiros CRC</title>
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
      <h1>Gestão de Parceiros CRC</h1>
      <p class="sub">Relatório exportado em ${new Date().toLocaleString('pt-BR')} · mês ${referenceMonth}</p>
      <section class="cards">
        <article class="card"><span>Parceiros</span><strong>${rows.length}</strong></article>
        <article class="card"><span>Mês analisado</span><strong>${referenceMonth}</strong></article>
        <article class="card"><span>Custo mensal</span><strong>${formatCurrency(totalCost)}</strong></article>
      </section>
      <table><thead><tr><th>Nome</th><th>Função</th><th>Clínica</th><th>Contratação</th><th>Mês/Ano</th><th>Base</th><th>Benefícios</th><th>Encargos</th><th>Provisões</th><th>DSR</th><th>Férias</th><th>Custo mensal</th><th>Status</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${row.name || ''}</td><td>${row.function_name || ''}</td><td>${row.clinic_name || ''}</td><td>${String(row.hire_date || '').slice(0, 10)}</td><td>${row.reference_month || ''}</td><td>${formatCurrency(row.laborCosts?.salario_remuneracao_base)}</td><td>${formatCurrency(row.laborCosts?.beneficios_totais)}</td><td>${formatCurrency(row.laborCosts?.encargos_obrigatorios)}</td><td>${formatCurrency((row.laborCosts?.provisoes_trabalhistas || 0) + (row.laborCosts?.provisoes_gerenciais || 0))}</td><td>${toFlag(row.receives_commission) ? formatCurrency(row.dsrCommission) : 'Não'}</td><td>${row.monthlyVacation > 0 ? formatCurrency(row.monthlyVacation) : 'Não'}</td><td>${formatCurrency(row.monthlyCost)}</td><td>${row.status || ''}</td></tr>`).join('')}</tbody></table>
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
          <h1>Gestão de parceiros CRC</h1>
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
          <h1>Gestão de parceiros</h1>
          <p>Cadastro, edição, custos mensais, férias e comissão para análise do ROI geral.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/home/financial-intelligence/manage')}>Gestão financeira</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="financial-sheet-summary">
        <article><span>Parceiros</span><strong>{rows.length}</strong></article>
        <article><span>Mês analisado</span><strong>{referenceMonth}</strong></article>
        <article><span>Custo mensal</span><strong>{formatCurrency(totalCost)}</strong></article>
      </section>

      <section className="financial-export-bar">
        <button className="primary-action" onClick={openNew}>+ Novo parceiro</button>
        <button className="outline-action icon-action" onClick={exportExcel}><span className="file-icon xls">XLS</span>Exportar Excel</button>
        <button className="outline-action icon-action" onClick={exportPdf}><span className="file-icon pdf">PDF</span>Exportar PDF</button>
      </section>

      <section className="financial-filter-panel compact">
        <label>Mês de referência<input className="field" type="month" value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} /></label>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}

      <section className="financial-sheet-wrap">
        {loading ? <p className="empty-state">Carregando parceiros...</p> : (
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
                <th>Benefícios</th>
                <th>Encargos</th>
                <th>Provisões</th>
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
                  <td>{toFlag(item.receives_commission) ? formatCurrency(item.monthlyCommission) : 'Não recebe'}</td>
                  <td><span className={item.dsrCommission > 0 ? 'financial-dsr-highlight' : ''}>{toFlag(item.receives_commission) ? formatCurrency(item.dsrCommission) : 'Não'}</span></td>
                  <td>{formatCurrency(item.laborCosts?.beneficios_totais)}</td>
                  <td>{formatCurrency(item.laborCosts?.encargos_obrigatorios)}</td>
                  <td>{formatCurrency((item.laborCosts?.provisoes_trabalhistas || 0) + (item.laborCosts?.provisoes_gerenciais || 0))}</td>
                  <td>{toNumber(item.other_costs_default) > 0 ? formatCurrency(item.other_costs_default) : 'Não'}</td>
                  <td>{item.monthlyVacation > 0 ? formatCurrency(item.monthlyVacation) : 'Não'}</td>
                  <td>{formatCurrency(item.monthlyCost)}</td>
                  <td><span className={`financial-status-badge ${item.status === 'ativo' ? 'excelente' : 'atencao'}`}>{item.status}</span></td>
                  <td>
                    <div className="financial-row-actions">
                      <button className="outline-action mini-action" onClick={() => setDetailCollaborator(item)}>Custos</button>
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
              <p className="eyebrow">Parceiro CRC</p>
              <h2>{editingId ? 'Editar parceiro' : 'Novo parceiro'}</h2>
            </div>
            <div className="financial-editor-grid">
              <label>Nome<input className="field" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Função/Cargo<select className="field" value={draft.function_name} onChange={(event) => setDraft((current) => ({ ...current, function_name: event.target.value }))}><option value="">Selecione</option>{CRC_FUNCTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
              <label>Clínica<select className="field" value={draft.clinic_id || (draft.clinic_name === FINANCIAL_CENTRAL_CLINIC.name ? FINANCIAL_CENTRAL_CLINIC.id : '')} onChange={(event) => handleClinicChange(event.target.value)}><option value="">Selecione</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
              <label>Unidade<input className="field" value={draft.unit_name || ''} onChange={(event) => setDraft((current) => ({ ...current, unit_name: event.target.value }))} /></label>
              <label>Data de admissão<input className="field" type="date" value={String(draft.hire_date || '').slice(0, 10)} onChange={(event) => setDraft((current) => ({ ...current, hire_date: event.target.value }))} /></label>
              <label>Mês/Ano<input className="field" type="month" value={draft.reference_month || referenceMonth} onChange={(event) => setDraft((current) => ({ ...current, reference_month: event.target.value }))} /></label>
              <label>Salário<input className="field" type="number" step="0.01" value={draft.salary || ''} onChange={(event) => setDraft((current) => ({ ...current, salary: event.target.value }))} /></label>
              <label>Comissão fixa<input className="field" type="number" step="0.01" value={draft.fixed_commission || ''} onChange={(event) => setDraft((current) => ({ ...current, fixed_commission: event.target.value }))} /></label>
              <label>Gratificação fixa<input className="field" type="number" step="0.01" value={draft.fixed_gratification || ''} onChange={(event) => setDraft((current) => ({ ...current, fixed_gratification: event.target.value }))} /></label>
              <label>Adicional fixo<input className="field" type="number" step="0.01" value={draft.fixed_additional || ''} onChange={(event) => setDraft((current) => ({ ...current, fixed_additional: event.target.value }))} /></label>
              <label>Benefícios gerais<input className="field" type="number" step="0.01" value={draft.benefits || ''} onChange={(event) => setDraft((current) => ({ ...current, benefits: event.target.value }))} /></label>
              <label>Vale transporte<input className="field" type="number" step="0.01" value={draft.transport_voucher || ''} onChange={(event) => setDraft((current) => ({ ...current, transport_voucher: event.target.value }))} /></label>
              <label>Vale alimentação<input className="field" type="number" step="0.01" value={draft.food_voucher || ''} onChange={(event) => setDraft((current) => ({ ...current, food_voucher: event.target.value }))} /></label>
              <label>Vale refeição<input className="field" type="number" step="0.01" value={draft.meal_voucher || ''} onChange={(event) => setDraft((current) => ({ ...current, meal_voucher: event.target.value }))} /></label>
              <label>Plano de saúde<input className="field" type="number" step="0.01" value={draft.health_plan || ''} onChange={(event) => setDraft((current) => ({ ...current, health_plan: event.target.value }))} /></label>
              <label>Plano odontológico<input className="field" type="number" step="0.01" value={draft.dental_plan || ''} onChange={(event) => setDraft((current) => ({ ...current, dental_plan: event.target.value }))} /></label>
              <label>Ajuda de custo<input className="field" type="number" step="0.01" value={draft.cost_allowance || ''} onChange={(event) => setDraft((current) => ({ ...current, cost_allowance: event.target.value }))} /></label>
              <label>Bonificação<input className="field" type="number" step="0.01" value={draft.bonus || ''} onChange={(event) => setDraft((current) => ({ ...current, bonus: event.target.value }))} /></label>
              <label>Outros benefícios<input className="field" type="number" step="0.01" value={draft.other_benefits || ''} onChange={(event) => setDraft((current) => ({ ...current, other_benefits: event.target.value }))} /></label>
              <label>Recebe comissão?<select className="field" value={toFlag(draft.receives_commission) ? 'sim' : 'nao'} onChange={(event) => setDraft((current) => ({ ...current, receives_commission: event.target.value === 'sim', commission_default: '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {toFlag(draft.receives_commission) && <div className="financial-commission-note wide-field">Parceiro habilitado para lançamento mensal de comissão. O valor não é informado neste cadastro.</div>}
              <div className="financial-commission-note wide-field">O 13º é provisionado automaticamente mês a mês pela data de contratação. Férias são lançadas nos custos mensais.</div>
              <label>Houve outros custos?<select className="field" value={toFlag(draft.has_other_costs) ? 'sim' : 'nao'} onChange={(event) => setDraft((current) => ({ ...current, has_other_costs: event.target.value === 'sim', other_costs_default: event.target.value === 'sim' ? current.other_costs_default : '', other_costs_description: event.target.value === 'sim' ? current.other_costs_description : '' }))}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
              {toFlag(draft.has_other_costs) && <label>Valor de outros custos<input className="field" type="number" step="0.01" value={draft.other_costs_default || ''} onChange={(event) => setDraft((current) => ({ ...current, other_costs_default: event.target.value }))} /></label>}
              {toFlag(draft.has_other_costs) && <label className="wide-field">Descrição dos outros custos<input className="field" value={draft.other_costs_description || ''} onChange={(event) => setDraft((current) => ({ ...current, other_costs_description: event.target.value }))} /></label>}
              <label>Status<select className="field" value={draft.status || 'ativo'} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
            </div>
            <LaborCostComposition laborCosts={draftLaborCosts} />
            <div className="row-actions">
              <button className="outline-action" onClick={() => setModalOpen(false)} disabled={saving}>Cancelar</button>
              <button className="primary-action" onClick={saveCollaborator} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </section>
        </div>
      )}

      {detailCollaborator && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDetailCollaborator(null)}>
          <section className="modal-panel financial-collaborator-modal" onClick={(event) => event.stopPropagation()}>
            <div className="financial-card-heading">
              <p className="eyebrow">Detalhe do parceiro</p>
              <h2>{detailCollaborator.name}</h2>
              <p>{detailCollaborator.function_name || 'Função não informada'} · {detailCollaborator.clinic_name || 'Clínica não informada'}</p>
            </div>
            <LaborCostComposition laborCosts={detailCollaborator.laborCosts || calculateLaborCost(detailCollaborator, settings)} />
            <div className="row-actions">
              <button className="outline-action" onClick={() => setDetailCollaborator(null)}>Fechar</button>
              <button className="primary-action" onClick={() => { setDetailCollaborator(null); openEdit(detailCollaborator); }}>Editar cadastro</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default FinancialCollaboratorManagement;
