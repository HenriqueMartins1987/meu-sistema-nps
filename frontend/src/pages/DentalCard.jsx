import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import api from '../api';
import { hasPermission, readUser } from '../constants';
import './DentalCard.css';

const tabs = [
  { id: 'dashboard', label: 'Dashboard Executivo' },
  { id: 'lead', label: 'Lançamento de Indicação' },
  { id: 'pipeline', label: 'Controle Operacional' },
  { id: 'reports', label: 'Relatórios e Exportação' }
];

const statusOptions = [
  'Novo Lead',
  'Contato IA iniciado',
  'Aguardando resposta',
  'Contato efetivo',
  'Em follow-up',
  'Agendado IA',
  'Agendado Joyce/CRC',
  'Confirmado',
  'Compareceu',
  'Faltou / No-show',
  'Reagendado',
  'Cancelado',
  'Pagou',
  'Nao pagou',
  'Encerrado',
  'Follow-up quinzenal'
];

const originOptions = ['IA', 'Joyce', 'CRC', 'Dentista', 'Indicação manual', 'Planilha', 'Outro'];
const indicatorTypes = ['paciente', 'colaborador', 'dentista', 'visitante', 'outro'];
const contactChannels = ['WhatsApp', 'Ligação', 'Presencial', 'Outro'];
const paymentOptions = ['pendente', 'pagou', 'parcial', 'nao'];
const pageSizeOptions = [10, 25, 50, 100];
const chartColors = ['#8e6731', '#1f7a8c', '#c79544', '#4c956c', '#c44536', '#5d6d7e', '#9a6fb0'];

const defaultLead = {
  data_indicacao: new Date().toISOString().slice(0, 10),
  unidade: '',
  nome_lead: '',
  telefone: '',
  ficha: '',
  nome_indicador: '',
  tipo_indicador: 'paciente',
  dentista_responsavel: '',
  origem: 'Indicação manual',
  responsavel: '',
  status: 'Novo Lead',
  status_contato: '',
  canal_contato: 'WhatsApp',
  quantidade_tentativas: 0,
  data_primeiro_contato: '',
  data_ultima_tentativa: '',
  data_proxima_tentativa: '',
  agendado: false,
  agendado_por: '',
  data_agendamento: '',
  hora_agendamento: '',
  ecuro_lancado: false,
  endereco_enviado: false,
  confirmacao_enviada: false,
  confirmou_presenca: 'pendente',
  compareceu: false,
  motivo_falta: '',
  tentativa_recuperacao: false,
  data_reagendamento: '',
  pagou: 'pendente',
  valor_pago: '',
  forma_pagamento: '',
  receita: '',
  pesquisa_satisfacao_enviada: false,
  nova_indicacao_solicitada: false,
  nova_indicacao_recebida: false,
  observacoes: ''
};

const defaultTemplate = {
  nome: '',
  tipo: '',
  mensagem: '',
  ativo: true
};

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(String(value).includes('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('pt-BR');
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits && !digits.startsWith('55')) digits = `55${digits}`;
  return digits.slice(0, 13);
}

function toDateInput(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function toDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}

function badgeTone(status = '') {
  const normalized = String(status).toLowerCase();
  if (['pagou', 'compareceu', 'confirmado'].some((item) => normalized.includes(item))) return 'success';
  if (['agendado', 'contato efetivo'].some((item) => normalized.includes(item))) return 'info';
  if (['follow', 'aguardando', 'novo', 'retorno'].some((item) => normalized.includes(item))) return 'warning';
  if (['faltou', 'no-show', 'cancelado', 'atrasado', 'crítico', 'critico'].some((item) => normalized.includes(item))) return 'danger';
  return 'neutral';
}

function Badge({ children, tone }) {
  return <span className={`dental-badge ${tone || badgeTone(children)}`}>{children || 'Não informado'}</span>;
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`dental-field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function KpiCard({ label, value, note, tone = 'neutral' }) {
  return (
    <article className={`dental-card ${tone}`}>
      <div className="dental-card-label">{label}</div>
      <div className="dental-card-value">{value}</div>
      {note ? <div className="dental-card-note">{note}</div> : null}
    </article>
  );
}

function Panel({ title, note, actions, children }) {
  return (
    <section className="dental-panel">
      <div className="dental-panel-header">
        <div>
          <h2 className="dental-panel-title">{title}</h2>
          {note ? <p className="dental-panel-note">{note}</p> : null}
        </div>
        {actions ? <div className="dental-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function ChartPanel({ title, note, children }) {
  return (
    <Panel title={title} note={note}>
      <div className="dental-chart">{children}</div>
    </Panel>
  );
}

function DentalCard() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const canManage = hasPermission(user, 'dental_card');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    unidade: '',
    origem: '',
    status: '',
    pagamento: '',
    slaStatus: '',
    search: ''
  });
  const [dashboard, setDashboard] = useState(null);
  const [leads, setLeads] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [leadDraft, setLeadDraft] = useState(defaultLead);
  const [editingLeadId, setEditingLeadId] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [attemptLead, setAttemptLead] = useState(null);
  const [attemptDraft, setAttemptDraft] = useState({
    canal: 'WhatsApp',
    resultado: 'Tentativa registrada',
    observacao: '',
    proxima_acao: '',
    data_proxima_acao: ''
  });
  const [templateDraft, setTemplateDraft] = useState(defaultTemplate);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const queryParams = useMemo(() => {
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined));
  }, [filters]);

  const unidadeOptions = useMemo(() => {
    const values = new Set([
      ...clinics.map((clinic) => clinic.name).filter(Boolean),
      ...leads.map((lead) => lead.unidade).filter(Boolean)
    ]);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [clinics, leads]);

  const responsavelOptions = useMemo(() => {
    return Array.from(new Set(leads.map((lead) => lead.responsavel).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboardRes, leadsRes, clinicsRes, templatesRes] = await Promise.all([
        api.get('/dental-card/dashboard', { params: queryParams }),
        api.get('/dental-card/leads', { params: queryParams }),
        api.get('/clinics').catch(() => ({ data: [] })),
        api.get('/dental-card/templates').catch(() => ({ data: [] }))
      ]);
      setDashboard(dashboardRes.data || null);
      setLeads(Array.isArray(leadsRes.data) ? leadsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível carregar o Dental Card.');
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    setFilters({
      startDate: '',
      endDate: '',
      unidade: '',
      origem: '',
      status: '',
      pagamento: '',
      slaStatus: '',
      search: ''
    });
  }

  function setLeadField(field, value) {
    setLeadDraft((current) => ({ ...current, [field]: value }));
  }

  function setBooleanLeadField(field, checked) {
    setLeadDraft((current) => ({ ...current, [field]: checked }));
  }

  async function saveLead(event) {
    event?.preventDefault();
    setError('');
    setFeedback('');
    try {
      const payload = {
        ...leadDraft,
        telefone: normalizePhone(leadDraft.telefone)
      };
      if (editingLeadId) {
        await api.put(`/dental-card/leads/${editingLeadId}`, payload);
        setFeedback('Lead Dental Card atualizado com sucesso.');
      } else {
        await api.post('/dental-card/leads', payload);
        setFeedback('Lead Dental Card cadastrado com sucesso.');
      }
      setLeadDraft(defaultLead);
      setEditingLeadId(null);
      setActiveTab('pipeline');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao salvar lead Dental Card.');
    }
  }

  function editLead(lead) {
    setEditingLeadId(lead.id);
    setLeadDraft({
      ...defaultLead,
      ...lead,
      data_indicacao: toDateInput(lead.data_indicacao),
      data_agendamento: toDateInput(lead.data_agendamento),
      data_reagendamento: toDateInput(lead.data_reagendamento),
      data_primeiro_contato: toDateTimeInput(lead.data_primeiro_contato),
      data_ultima_tentativa: toDateTimeInput(lead.data_ultima_tentativa),
      data_proxima_tentativa: toDateTimeInput(lead.data_proxima_tentativa),
      agendado: Boolean(Number(lead.agendado)),
      ecuro_lancado: Boolean(Number(lead.ecuro_lancado)),
      endereco_enviado: Boolean(Number(lead.endereco_enviado)),
      confirmacao_enviada: Boolean(Number(lead.confirmacao_enviada)),
      compareceu: Boolean(Number(lead.compareceu)),
      tentativa_recuperacao: Boolean(Number(lead.tentativa_recuperacao)),
      pesquisa_satisfacao_enviada: Boolean(Number(lead.pesquisa_satisfacao_enviada)),
      nova_indicacao_solicitada: Boolean(Number(lead.nova_indicacao_solicitada)),
      nova_indicacao_recebida: Boolean(Number(lead.nova_indicacao_recebida))
    });
    setActiveTab('lead');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function updateStatus(lead, status) {
    setError('');
    try {
      await api.post(`/dental-card/leads/${lead.id}/status`, { status });
      setFeedback(`Status atualizado para ${status}.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao alterar status.');
    }
  }

  async function deleteLead(lead) {
    if (!window.confirm(`Excluir o lead "${lead.nome_lead}" do Dental Card?`)) return;
    setError('');
    try {
      await api.delete(`/dental-card/leads/${lead.id}`);
      setFeedback('Lead excluído com histórico preservado.');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao excluir lead.');
    }
  }

  async function saveAttempt(event) {
    event?.preventDefault();
    if (!attemptLead) return;
    setError('');
    try {
      await api.post(`/dental-card/leads/${attemptLead.id}/attempts`, attemptDraft);
      setFeedback('Tentativa registrada com sucesso.');
      setAttemptLead(null);
      setAttemptDraft({
        canal: 'WhatsApp',
        resultado: 'Tentativa registrada',
        observacao: '',
        proxima_acao: '',
        data_proxima_acao: ''
      });
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao registrar tentativa.');
    }
  }

  async function loadLeadDetails(lead) {
    setError('');
    try {
      const response = await api.get(`/dental-card/leads/${lead.id}`);
      setSelectedLead(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao abrir detalhes.');
    }
  }

  function openWhatsApp(lead) {
    const digits = normalizePhone(lead.telefone);
    if (!digits) {
      setError('Telefone inválido para abrir WhatsApp.');
      return;
    }
    window.open(`https://wa.me/${digits}`, '_blank', 'noopener,noreferrer');
  }

  async function exportCsv() {
    setError('');
    try {
      const response = await api.get('/dental-card/export', {
        params: queryParams,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'dental-card.csv';
      link.click();
      window.URL.revokeObjectURL(url);
      setFeedback('Exportação Dental Card gerada.');
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao exportar Dental Card.');
    }
  }

  async function importSpreadsheet(commit = false) {
    if (!importFile) {
      setError('Selecione a planilha Todos os meses.xlsx para importar.');
      return;
    }
    setError('');
    setFeedback('');
    const form = new FormData();
    form.append('file', importFile);
    form.append('commit', commit ? 'true' : 'false');
    try {
      const response = await api.post('/dental-card/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setImportResult(response.data);
      setFeedback(commit ? 'Importação salva no banco.' : 'Prévia da importação gerada para conferência.');
      if (commit) await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao importar planilha.');
    }
  }

  function applyTemplateToLead(template) {
    const text = String(template.mensagem || '')
      .replaceAll('{{nome_lead}}', leadDraft.nome_lead || 'paciente')
      .replaceAll('{{nome_paciente}}', leadDraft.nome_lead || 'paciente')
      .replaceAll('{{unidade}}', leadDraft.unidade || 'unidade')
      .replaceAll('{{data_agendamento}}', leadDraft.data_agendamento || 'data')
      .replaceAll('{{hora_agendamento}}', leadDraft.hora_agendamento || 'horário')
      .replaceAll('{{operador}}', leadDraft.responsavel || user?.name || 'CRC');
    setLeadField('observacoes', `${leadDraft.observacoes ? `${leadDraft.observacoes}\n\n` : ''}${text}`);
  }

  async function saveTemplate(event) {
    event?.preventDefault();
    setError('');
    try {
      if (editingTemplateId) {
        await api.put(`/dental-card/templates/${editingTemplateId}`, templateDraft);
        setFeedback('Mensagem padrão atualizada.');
      } else {
        await api.post('/dental-card/templates', templateDraft);
        setFeedback('Mensagem padrão criada.');
      }
      setTemplateDraft(defaultTemplate);
      setEditingTemplateId(null);
      const response = await api.get('/dental-card/templates');
      setTemplates(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao salvar mensagem padrão.');
    }
  }

  const summary = dashboard?.summary || {};
  const charts = dashboard?.charts || {};
  const routine = dashboard?.routineToday || {};
  const totalPages = Math.max(1, Math.ceil(leads.length / pageSize));
  const paginatedLeads = leads.slice((page - 1) * pageSize, page * pageSize);

  const kpis = [
    ['Total de indicações', formatNumber(summary.totalIndicacoes), 'Base filtrada no período.', 'neutral'],
    ['Leads trabalhados', formatNumber(summary.leadsTrabalhados), 'Com contato ou tentativa registrada.', 'info'],
    ['Total agendado', formatNumber(summary.totalAgendado), `${formatPercent(summary.taxaAgendamento)} de taxa de agendamento.`, 'info'],
    ['Total comparecido', formatNumber(summary.totalComparecido), `${formatPercent(summary.taxaComparecimento)} de comparecimento.`, 'success'],
    ['Faltas / no-show', formatNumber(summary.faltasNoShow), `${formatPercent(summary.taxaEvasao)} de evasão.`, 'danger'],
    ['Pagantes', formatNumber(summary.pagantes), `${formatPercent(summary.taxaPagamento)} de pagamento.`, 'success'],
    ['Receita total', formatCurrency(summary.receitaTotal), 'Receita confirmada no filtro.', 'success'],
    ['Ticket médio', formatCurrency(summary.ticketMedio), 'Receita dividida pelos pagantes.', 'neutral'],
    ['Conversão final', formatPercent(summary.taxaConversaoFinal), 'Pagantes sobre indicações.', 'info'],
    ['Sem contato', formatNumber(summary.leadsSemContato), 'Leads que precisam de primeira ação.', 'warning'],
    ['Retorno hoje', formatNumber(summary.leadsRetornoHoje), 'Fila operacional do dia.', 'warning'],
    ['Críticos', formatNumber(summary.leadsCriticos), 'Atrasados, faltosos ou no-show.', 'danger']
  ];

  return (
    <main className="dental-page">
      <div className="dental-shell">
        <header className="dental-hero">
          <div>
            <p className="dental-eyebrow">CRM operacional + BI executivo</p>
            <h1 className="dental-title">Dental Card</h1>
            <p className="dental-subtitle">
              Controle de indicações, follow-up, agendamento, comparecimento, pagamento, evasão, produtividade e SLA do Programa Dental Card.
            </p>
          </div>
          <div className="dental-actions">
            <button type="button" className="dental-button" onClick={loadData} disabled={loading}>Atualizar</button>
            <button type="button" className="dental-button" onClick={() => navigate('/home')}>Home</button>
          </div>
        </header>

        <nav className="dental-tabs" aria-label="Dental Card">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`dental-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {feedback ? <div className="dental-feedback">{feedback}</div> : null}
        {error ? <div className="dental-feedback error">{error}</div> : null}

        <section className="dental-filters">
          <Field label="Período inicial"><input className="dental-input" type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} /></Field>
          <Field label="Período final"><input className="dental-input" type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} /></Field>
          <Field label="Unidade"><select className="dental-select" value={filters.unidade} onChange={(event) => updateFilter('unidade', event.target.value)}><option value="">Todas</option>{unidadeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field label="Origem"><select className="dental-select" value={filters.origem} onChange={(event) => updateFilter('origem', event.target.value)}><option value="">Todas</option>{originOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field label="Status"><select className="dental-select" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}><option value="">Todos</option>{statusOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field label="Busca"><input className="dental-input" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Paciente, telefone, ficha..." /></Field>
          <Field label="Responsável"><select className="dental-select" value={filters.responsavel || ''} onChange={(event) => updateFilter('responsavel', event.target.value)}><option value="">Todos</option>{responsavelOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field label="Pagamento"><select className="dental-select" value={filters.pagamento} onChange={(event) => updateFilter('pagamento', event.target.value)}><option value="">Todos</option>{paymentOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field label="SLA"><select className="dental-select" value={filters.slaStatus} onChange={(event) => updateFilter('slaStatus', event.target.value)}><option value="">Todos</option><option value="ok">No prazo</option><option value="retorno_hoje">Retorno hoje</option><option value="atencao">Atenção</option><option value="atrasado">Atrasado</option></select></Field>
          <div className="dental-actions dental-span-2">
            <button type="button" className="dental-button" onClick={resetFilters}>Limpar filtros</button>
            <button type="button" className="dental-button primary" onClick={exportCsv}>Exportar CSV</button>
          </div>
        </section>

        {activeTab === 'dashboard' ? (
          <>
            <section className="dental-kpis">
              {kpis.map(([label, value, note, tone]) => <KpiCard key={label} label={label} value={value} note={note} tone={tone} />)}
            </section>

            <div className="dental-grid-2">
              <ChartPanel title="Funil Dental Card" note="Indicações > contatados > agendados > comparecidos > pagantes.">
                <ResponsiveContainer>
                  <BarChart data={charts.funnel || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#1f7a8c" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>
              <ChartPanel title="IA x Joyce/CRC" note="Comparativo de agendamentos e comparecimentos por origem operacional.">
                <ResponsiveContainer>
                  <BarChart data={charts.iaVsCrc || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="agendados" fill="#c79544" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="comparecidos" fill="#2f8f62" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>
              <ChartPanel title="Desempenho por unidade" note="Volume de indicações por unidade.">
                <ResponsiveContainer>
                  <BarChart data={(charts.byUnit || []).slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#8e6731" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>
              <ChartPanel title="Status dos leads" note="Distribuição operacional do funil.">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={(charts.status || []).slice(0, 8)} dataKey="value" nameKey="name" outerRadius={105} label>
                      {(charts.status || []).slice(0, 8).map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartPanel>
              <ChartPanel title="Receita por mês" note="Série histórica para análise de evolução.">
                <ResponsiveContainer>
                  <LineChart data={charts.revenueByMonth || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Line type="monotone" dataKey="receita" stroke="#2f8f62" strokeWidth={3} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartPanel>
              <Panel title="Rotina de Hoje" note="Fila prática para o CRC agir sem perder SLA.">
                <div className="dental-routine">
                  {[
                    ['Leads novos', routine.novosHoje],
                    ['Retornos hoje', routine.retornosHoje],
                    ['Agendamentos hoje', routine.agendamentosHoje],
                    ['Confirmações pendentes', routine.confirmacoesPendentes],
                    ['Faltosos para recuperar', routine.faltososRecuperar],
                    ['Follow-ups atrasados', routine.followUpsAtrasados],
                    ['Pagamentos pendentes', routine.pagamentosPendentes],
                    ['Sem resposta há 48h', routine.semResposta48h]
                  ].map(([label, value]) => (
                    <div className="dental-routine-item" key={label}>
                      <strong>{formatNumber(value)}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        ) : null}

        {activeTab === 'lead' ? (
          <Panel
            title={editingLeadId ? 'Editar indicação Dental Card' : 'Novo lead / indicação'}
            note="Cadastro rápido com os dados operacionais do POP, SLA e histórico do contato."
            actions={editingLeadId ? <button type="button" className="dental-button" onClick={() => { setEditingLeadId(null); setLeadDraft(defaultLead); }}>Novo lançamento</button> : null}
          >
            <form className="dental-form-grid" onSubmit={saveLead}>
              <h3 className="dental-section-title">Dados da indicação</h3>
              <Field label="Data da indicação"><input className="dental-input" type="date" value={leadDraft.data_indicacao || ''} onChange={(event) => setLeadField('data_indicacao', event.target.value)} required /></Field>
              <Field label="Unidade"><select className="dental-select" value={leadDraft.unidade || ''} onChange={(event) => setLeadField('unidade', event.target.value)} required><option value="">Selecione</option>{unidadeOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="Nome do lead"><input className="dental-input" value={leadDraft.nome_lead || ''} onChange={(event) => setLeadField('nome_lead', event.target.value)} required /></Field>
              <Field label="Telefone"><input className="dental-input" value={leadDraft.telefone || ''} onChange={(event) => setLeadField('telefone', normalizePhone(event.target.value))} placeholder="5562999999999" required /></Field>
              <Field label="Nome do indicador"><input className="dental-input" value={leadDraft.nome_indicador || ''} onChange={(event) => setLeadField('nome_indicador', event.target.value)} /></Field>
              <Field label="Tipo do indicador"><select className="dental-select" value={leadDraft.tipo_indicador || ''} onChange={(event) => setLeadField('tipo_indicador', event.target.value)}>{indicatorTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="Dentista responsável"><input className="dental-input" value={leadDraft.dentista_responsavel || ''} onChange={(event) => setLeadField('dentista_responsavel', event.target.value)} /></Field>
              <Field label="Origem"><select className="dental-select" value={leadDraft.origem || ''} onChange={(event) => setLeadField('origem', event.target.value)}>{originOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>

              <h3 className="dental-section-title">Contato e SLA</h3>
              <Field label="Status do contato"><input className="dental-input" value={leadDraft.status_contato || ''} onChange={(event) => setLeadField('status_contato', event.target.value)} /></Field>
              <Field label="Canal"><select className="dental-select" value={leadDraft.canal_contato || ''} onChange={(event) => setLeadField('canal_contato', event.target.value)}>{contactChannels.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="Responsável"><input className="dental-input" value={leadDraft.responsavel || ''} onChange={(event) => setLeadField('responsavel', event.target.value)} placeholder={user?.name || 'CRC'} /></Field>
              <Field label="Tentativas"><input className="dental-input" type="number" min="0" value={leadDraft.quantidade_tentativas || 0} onChange={(event) => setLeadField('quantidade_tentativas', event.target.value)} /></Field>
              <Field label="Primeiro contato"><input className="dental-input" type="datetime-local" value={leadDraft.data_primeiro_contato || ''} onChange={(event) => setLeadField('data_primeiro_contato', event.target.value)} /></Field>
              <Field label="Última tentativa"><input className="dental-input" type="datetime-local" value={leadDraft.data_ultima_tentativa || ''} onChange={(event) => setLeadField('data_ultima_tentativa', event.target.value)} /></Field>
              <Field label="Próxima tentativa"><input className="dental-input" type="datetime-local" value={leadDraft.data_proxima_tentativa || ''} onChange={(event) => setLeadField('data_proxima_tentativa', event.target.value)} /></Field>
              <Field label="Status"><select className="dental-select" value={leadDraft.status || ''} onChange={(event) => setLeadField('status', event.target.value)}>{statusOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>

              <h3 className="dental-section-title">Agendamento e comparecimento</h3>
              <Field label="Agendado?"><select className="dental-select" value={leadDraft.agendado ? '1' : '0'} onChange={(event) => setBooleanLeadField('agendado', event.target.value === '1')}><option value="0">Não</option><option value="1">Sim</option></select></Field>
              <Field label="Agendado por"><select className="dental-select" value={leadDraft.agendado_por || ''} onChange={(event) => setLeadField('agendado_por', event.target.value)}><option value="">Selecione</option><option value="IA">IA</option><option value="Joyce/CRC">Joyce/CRC</option><option value="CRC">CRC</option><option value="Outro">Outro</option></select></Field>
              <Field label="Data do agendamento"><input className="dental-input" type="date" value={leadDraft.data_agendamento || ''} onChange={(event) => setLeadField('data_agendamento', event.target.value)} /></Field>
              <Field label="Horário"><input className="dental-input" type="time" value={String(leadDraft.hora_agendamento || '').slice(0, 5)} onChange={(event) => setLeadField('hora_agendamento', event.target.value)} /></Field>
              <Field label="Ficha/código"><input className="dental-input" value={leadDraft.ficha || ''} onChange={(event) => setLeadField('ficha', event.target.value)} /></Field>
              <Field label="Ecuro lançado?"><select className="dental-select" value={leadDraft.ecuro_lancado ? '1' : '0'} onChange={(event) => setBooleanLeadField('ecuro_lancado', event.target.value === '1')}><option value="0">Não</option><option value="1">Sim</option></select></Field>
              <Field label="Endereço enviado?"><select className="dental-select" value={leadDraft.endereco_enviado ? '1' : '0'} onChange={(event) => setBooleanLeadField('endereco_enviado', event.target.value === '1')}><option value="0">Não</option><option value="1">Sim</option></select></Field>
              <Field label="Confirmação enviada?"><select className="dental-select" value={leadDraft.confirmacao_enviada ? '1' : '0'} onChange={(event) => setBooleanLeadField('confirmacao_enviada', event.target.value === '1')}><option value="0">Não</option><option value="1">Sim</option></select></Field>
              <Field label="Confirmou presença?"><select className="dental-select" value={leadDraft.confirmou_presenca || 'pendente'} onChange={(event) => setLeadField('confirmou_presenca', event.target.value)}><option value="pendente">Pendente</option><option value="sim">Sim</option><option value="nao">Não</option></select></Field>
              <Field label="Compareceu?"><select className="dental-select" value={leadDraft.compareceu ? '1' : '0'} onChange={(event) => setBooleanLeadField('compareceu', event.target.value === '1')}><option value="0">Não/Pendente</option><option value="1">Sim</option></select></Field>
              <Field label="Motivo da falta" className="dental-span-2"><input className="dental-input" value={leadDraft.motivo_falta || ''} onChange={(event) => setLeadField('motivo_falta', event.target.value)} /></Field>
              <Field label="Reagendamento"><input className="dental-input" type="date" value={leadDraft.data_reagendamento || ''} onChange={(event) => setLeadField('data_reagendamento', event.target.value)} /></Field>

              <h3 className="dental-section-title">Pagamento e pós-atendimento</h3>
              <Field label="Pagamento"><select className="dental-select" value={leadDraft.pagou || 'pendente'} onChange={(event) => setLeadField('pagou', event.target.value)}>{paymentOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="Valor pago"><input className="dental-input" value={leadDraft.valor_pago || ''} onChange={(event) => setLeadField('valor_pago', event.target.value)} /></Field>
              <Field label="Receita gerada"><input className="dental-input" value={leadDraft.receita || ''} onChange={(event) => setLeadField('receita', event.target.value)} /></Field>
              <Field label="Forma de pagamento"><input className="dental-input" value={leadDraft.forma_pagamento || ''} onChange={(event) => setLeadField('forma_pagamento', event.target.value)} /></Field>
              <Field label="Pesquisa enviada?"><select className="dental-select" value={leadDraft.pesquisa_satisfacao_enviada ? '1' : '0'} onChange={(event) => setBooleanLeadField('pesquisa_satisfacao_enviada', event.target.value === '1')}><option value="0">Não</option><option value="1">Sim</option></select></Field>
              <Field label="Nova indicação solicitada?"><select className="dental-select" value={leadDraft.nova_indicacao_solicitada ? '1' : '0'} onChange={(event) => setBooleanLeadField('nova_indicacao_solicitada', event.target.value === '1')}><option value="0">Não</option><option value="1">Sim</option></select></Field>
              <Field label="Nova indicação recebida?"><select className="dental-select" value={leadDraft.nova_indicacao_recebida ? '1' : '0'} onChange={(event) => setBooleanLeadField('nova_indicacao_recebida', event.target.value === '1')}><option value="0">Não</option><option value="1">Sim</option></select></Field>
              <Field label="Mensagem padrão"><select className="dental-select" value="" onChange={(event) => { const template = templates.find((item) => String(item.id) === event.target.value); if (template) applyTemplateToLead(template); }}><option value="">Inserir nas observações</option>{templates.filter((item) => Number(item.ativo)).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></Field>
              <Field label="Observações" className="dental-span-4"><textarea className="dental-textarea" value={leadDraft.observacoes || ''} onChange={(event) => setLeadField('observacoes', event.target.value)} /></Field>
              <div className="dental-actions dental-span-4">
                <button type="submit" className="dental-button primary" disabled={!canManage}>Salvar Dental Card</button>
              </div>
            </form>
          </Panel>
        ) : null}

        {activeTab === 'pipeline' ? (
          <Panel title="Controle Operacional / Funil" note="Tabela CRM com paginação, ações rápidas, SLA e histórico por lead.">
            <div className="dental-table-wrap">
              <div className="dental-table-scroll">
                <table className="dental-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Unidade</th>
                      <th>Paciente</th>
                      <th>Telefone</th>
                      <th>Origem</th>
                      <th>Responsável</th>
                      <th>Status</th>
                      <th>Agendamento</th>
                      <th>Pagamento</th>
                      <th>Próxima ação</th>
                      <th>SLA</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLeads.map((lead) => (
                      <tr key={lead.id}>
                        <td>{formatDate(lead.data_indicacao)}</td>
                        <td><strong>{lead.unidade}</strong><br /><small>{lead.ficha || 'Sem ficha'}</small></td>
                        <td><strong>{lead.nome_lead}</strong><br /><small>{lead.nome_indicador ? `Indicado por ${lead.nome_indicador}` : 'Sem indicador'}</small></td>
                        <td>{lead.telefone}</td>
                        <td>{lead.origem || '-'}</td>
                        <td>{lead.responsavel || '-'}</td>
                        <td><Badge>{lead.status}</Badge></td>
                        <td>{lead.data_agendamento ? `${formatDate(lead.data_agendamento)} ${String(lead.hora_agendamento || '').slice(0, 5)}` : '-'}</td>
                        <td><Badge tone={lead.pagou === 'pagou' || lead.pagou === 'parcial' ? 'success' : 'warning'}>{lead.pagou || 'pendente'}</Badge><br /><small>{formatCurrency(lead.receita || lead.valor_pago)}</small></td>
                        <td>{lead.data_proxima_tentativa ? formatDate(lead.data_proxima_tentativa) : '-'}<br /><small>{lead.quantidade_tentativas || 0} tentativa(s)</small></td>
                        <td><Badge tone={badgeTone(lead.sla_status)}>{lead.sla_status}</Badge><br /><small>{lead.dias_sem_contato || 0} dia(s) sem contato</small></td>
                        <td>
                          <div className="dental-row-actions">
                            <button type="button" className="dental-mini-button" onClick={() => loadLeadDetails(lead)}>Detalhes</button>
                            <button type="button" className="dental-mini-button" onClick={() => editLead(lead)}>Editar</button>
                            <button type="button" className="dental-mini-button" onClick={() => { setAttemptLead(lead); setAttemptDraft((current) => ({ ...current, data_proxima_acao: '' })); }}>Tentativa</button>
                            <button type="button" className="dental-mini-button" onClick={() => openWhatsApp(lead)}>WhatsApp</button>
                            <button type="button" className="dental-mini-button" onClick={() => updateStatus(lead, 'Agendado Joyce/CRC')}>Agendado</button>
                            <button type="button" className="dental-mini-button" onClick={() => updateStatus(lead, 'Compareceu')}>Compareceu</button>
                            <button type="button" className="dental-mini-button" onClick={() => updateStatus(lead, 'Faltou / No-show')}>Faltou</button>
                            <button type="button" className="dental-mini-button" onClick={() => updateStatus(lead, 'Pagou')}>Pagou</button>
                            <button type="button" className="dental-mini-button" onClick={() => updateStatus(lead, 'Encerrado')}>Encerrar</button>
                            <button type="button" className="dental-mini-button" onClick={() => deleteLead(lead)}>Excluir</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!paginatedLeads.length ? (
                      <tr><td colSpan="12"><div className="dental-empty">Nenhum lead Dental Card encontrado para os filtros atuais.</div></td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="dental-pagination">
                <span>{formatNumber(leads.length)} registro(s) filtrado(s)</span>
                <div className="dental-actions">
                  <select className="dental-select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{pageSizeOptions.map((item) => <option key={item} value={item}>{item} por página</option>)}</select>
                  <button type="button" className="dental-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Anterior</button>
                  <span>Página {page} de {totalPages}</span>
                  <button type="button" className="dental-button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>Próxima</button>
                </div>
              </div>
            </div>
          </Panel>
        ) : null}

        {activeTab === 'reports' ? (
          <div className="dental-grid-2">
            <Panel title="Importação da planilha" note="Leia todas as abas da planilha Todos os meses.xlsx, gere uma prévia e salve apenas após conferência.">
              <div className="dental-form-grid">
                <Field label="Arquivo .xlsx" className="dental-span-4"><input className="dental-input" type="file" accept=".xlsx,.xls" onChange={(event) => setImportFile(event.target.files?.[0] || null)} /></Field>
                <div className="dental-actions dental-span-4">
                  <button type="button" className="dental-button" onClick={() => importSpreadsheet(false)}>Gerar prévia</button>
                  <button type="button" className="dental-button primary" onClick={() => importSpreadsheet(true)} disabled={!importResult}>Salvar importação</button>
                </div>
              </div>
              {importResult?.summary ? (
                <div className="dental-import-report">
                  {Object.entries(importResult.summary).map(([key, value]) => (
                    <div className="dental-routine-item" key={key}>
                      <strong>{Array.isArray(value) ? value.length : formatNumber(value)}</strong>
                      <span>{key}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Panel>

            <Panel title="Exportações e relatórios" note="Bases operacionais filtradas para análise diária, por unidade, por operador e por conversão.">
              <div className="dental-routine">
                <div className="dental-routine-item"><strong>{formatNumber(summary.totalIndicacoes)}</strong><span>Relatório diário</span></div>
                <div className="dental-routine-item"><strong>{formatNumber(summary.totalAgendado)}</strong><span>Relatório por unidade</span></div>
                <div className="dental-routine-item"><strong>{formatPercent(summary.taxaConversaoFinal)}</strong><span>Conversão final</span></div>
                <div className="dental-routine-item"><strong>{formatCurrency(summary.receitaTotal)}</strong><span>Receita filtrada</span></div>
              </div>
              <div className="dental-actions" style={{ marginTop: 16 }}>
                <button type="button" className="dental-button primary" onClick={exportCsv}>Exportar CSV</button>
              </div>
            </Panel>

            <Panel title="Mensagens padrão Dental Card" note="Textos para contato inicial, reforços, confirmações, recuperação de falta e pós-atendimento.">
              <form className="dental-form-grid" onSubmit={saveTemplate}>
                <Field label="Nome" className="dental-span-2"><input className="dental-input" value={templateDraft.nome} onChange={(event) => setTemplateDraft((current) => ({ ...current, nome: event.target.value }))} /></Field>
                <Field label="Tipo"><input className="dental-input" value={templateDraft.tipo} onChange={(event) => setTemplateDraft((current) => ({ ...current, tipo: event.target.value }))} /></Field>
                <Field label="Ativo?"><select className="dental-select" value={templateDraft.ativo ? '1' : '0'} onChange={(event) => setTemplateDraft((current) => ({ ...current, ativo: event.target.value === '1' }))}><option value="1">Sim</option><option value="0">Não</option></select></Field>
                <Field label="Mensagem" className="dental-span-4"><textarea className="dental-textarea" value={templateDraft.mensagem} onChange={(event) => setTemplateDraft((current) => ({ ...current, mensagem: event.target.value }))} placeholder="Use variáveis como {{nome_lead}}, {{unidade}}, {{data_agendamento}}, {{hora_agendamento}} e {{operador}}." /></Field>
                <div className="dental-actions dental-span-4">
                  <button type="submit" className="dental-button primary">{editingTemplateId ? 'Salvar mensagem' : 'Criar mensagem'}</button>
                  {editingTemplateId ? <button type="button" className="dental-button" onClick={() => { setEditingTemplateId(null); setTemplateDraft(defaultTemplate); }}>Cancelar edição</button> : null}
                </div>
              </form>
            </Panel>

            <Panel title="Biblioteca de mensagens" note="Mensagens disponíveis para uso no cadastro e no atendimento.">
              <div className="dental-table-wrap">
                <div className="dental-table-scroll">
                  <table className="dental-table">
                    <thead><tr><th>Nome</th><th>Tipo</th><th>Status</th><th>Ação</th></tr></thead>
                    <tbody>
                      {templates.map((template) => (
                        <tr key={template.id}>
                          <td><strong>{template.nome}</strong><br /><small>{template.mensagem}</small></td>
                          <td>{template.tipo}</td>
                          <td><Badge tone={Number(template.ativo) ? 'success' : 'neutral'}>{Number(template.ativo) ? 'Ativa' : 'Inativa'}</Badge></td>
                          <td><button type="button" className="dental-mini-button" onClick={() => { setTemplateDraft({ nome: template.nome, tipo: template.tipo, mensagem: template.mensagem, ativo: Boolean(Number(template.ativo)) }); setEditingTemplateId(template.id); }}>Editar</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          </div>
        ) : null}

        {selectedLead ? (
          <div className="dental-modal-backdrop" onClick={() => setSelectedLead(null)}>
            <section className="dental-modal" onClick={(event) => event.stopPropagation()}>
              <div className="dental-panel-header">
                <div>
                  <p className="dental-eyebrow">Detalhes do lead</p>
                  <h2 className="dental-panel-title">{selectedLead.nome_lead}</h2>
                  <p className="dental-panel-note">{selectedLead.unidade} · {selectedLead.telefone}</p>
                </div>
                <button type="button" className="dental-button" onClick={() => setSelectedLead(null)}>Fechar</button>
              </div>
              <div className="dental-grid-3">
                <KpiCard label="Status" value={selectedLead.status} note={selectedLead.sla_status} tone={badgeTone(selectedLead.status)} />
                <KpiCard label="Tentativas" value={formatNumber(selectedLead.quantidade_tentativas)} note={`Última: ${formatDate(selectedLead.data_ultima_tentativa)}`} tone="warning" />
                <KpiCard label="Receita" value={formatCurrency(selectedLead.receita || selectedLead.valor_pago)} note={selectedLead.pagou} tone="success" />
              </div>
              <Panel title="Histórico de tentativas" note="Linha do tempo operacional do lead.">
                {(selectedLead.attempts || []).length ? (
                  <div className="dental-table-scroll">
                    <table className="dental-table">
                      <thead><tr><th>Data</th><th>Responsável</th><th>Canal</th><th>Resultado</th><th>Próxima ação</th></tr></thead>
                      <tbody>{selectedLead.attempts.map((attempt) => <tr key={attempt.id}><td>{formatDate(attempt.created_at)}</td><td>{attempt.responsavel}</td><td>{attempt.canal}</td><td>{attempt.resultado}<br /><small>{attempt.observacao}</small></td><td>{attempt.proxima_acao}<br /><small>{formatDate(attempt.data_proxima_acao)}</small></td></tr>)}</tbody>
                    </table>
                  </div>
                ) : <div className="dental-empty">Nenhuma tentativa registrada.</div>}
              </Panel>
            </section>
          </div>
        ) : null}

        {attemptLead ? (
          <div className="dental-modal-backdrop" onClick={() => setAttemptLead(null)}>
            <form className="dental-modal" onClick={(event) => event.stopPropagation()} onSubmit={saveAttempt}>
              <div className="dental-panel-header">
                <div>
                  <p className="dental-eyebrow">Registrar tentativa</p>
                  <h2 className="dental-panel-title">{attemptLead.nome_lead}</h2>
                </div>
                <button type="button" className="dental-button" onClick={() => setAttemptLead(null)}>Fechar</button>
              </div>
              <div className="dental-form-grid">
                <Field label="Canal"><select className="dental-select" value={attemptDraft.canal} onChange={(event) => setAttemptDraft((current) => ({ ...current, canal: event.target.value }))}>{contactChannels.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
                <Field label="Resultado"><input className="dental-input" value={attemptDraft.resultado} onChange={(event) => setAttemptDraft((current) => ({ ...current, resultado: event.target.value }))} /></Field>
                <Field label="Próxima ação"><input className="dental-input" value={attemptDraft.proxima_acao} onChange={(event) => setAttemptDraft((current) => ({ ...current, proxima_acao: event.target.value }))} /></Field>
                <Field label="Data da próxima ação"><input className="dental-input" type="datetime-local" value={attemptDraft.data_proxima_acao} onChange={(event) => setAttemptDraft((current) => ({ ...current, data_proxima_acao: event.target.value }))} /></Field>
                <Field label="Observação" className="dental-span-4"><textarea className="dental-textarea" value={attemptDraft.observacao} onChange={(event) => setAttemptDraft((current) => ({ ...current, observacao: event.target.value }))} /></Field>
                <div className="dental-actions dental-span-4">
                  <button type="submit" className="dental-button primary">Registrar tentativa</button>
                </div>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default DentalCard;
