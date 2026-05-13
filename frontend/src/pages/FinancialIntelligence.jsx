import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import api from '../api';
import { isAdmin, isMasterAdmin, readUser } from '../constants';

const chartColors = ['#8e6731', '#1f7a8c', '#6d573b', '#c89a57', '#c44536', '#4c956c', '#5d6d7e'];
const FINANCIAL_CENTRAL_CLINIC = { id: 'central-crc', name: 'Escritório Central - CRC', unit: 'CRC' };

function canViewFinancial(user) {
  return isAdmin(user) || isMasterAdmin(user);
}

function canManageFinancial(user) {
  const role = String(user?.role || '').toLowerCase();
  return isAdmin(user) || isMasterAdmin(user) || ['manager', 'supervisor_crc'].includes(role);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function metricTone(value, type = 'neutral') {
  if (type === 'money') return Number(value || 0) >= 0 ? 'success' : 'danger';
  if (type === 'roi') return Number(value || 0) >= 150 ? 'success' : Number(value || 0) >= 0 ? 'warning' : 'danger';
  if (type === 'selic') return Number(value || 0) >= 1 ? 'success' : Number(value || 0) >= -1 ? 'warning' : 'danger';
  return 'neutral';
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="financial-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={`${item.name}-${item.dataKey}`}>
          {item.name}: {String(item.dataKey || '').toLowerCase().includes('roi') || String(item.name || '').includes('%')
            ? formatPercent(item.value)
            : String(item.dataKey || '').toLowerCase().includes('cost')
              || String(item.dataKey || '').toLowerCase().includes('revenue')
              || String(item.dataKey || '').toLowerCase().includes('profit')
              || String(item.name || '').includes('R$')
                ? formatCurrency(item.value)
                : formatNumber(item.value)}
        </span>
      ))}
    </div>
  );
}

function MetricCard({ label, value, detail, tone = 'neutral' }) {
  return (
    <article className={`financial-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <article className={`financial-chart-card ${className}`}>
      <div className="financial-card-heading">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="financial-chart-box">
        {children}
      </div>
    </article>
  );
}

function RankingList({ rows = [], valueKey = 'profit', formatter = formatCurrency }) {
  return (
    <div className="financial-ranking-list">
      {rows.slice(0, 8).map((item, index) => (
        <div className="financial-ranking-row" key={`${item.label}-${index}`}>
          <span>{index + 1}</span>
          <strong>{item.label}</strong>
          <em>{formatter(item[valueKey])}</em>
        </div>
      ))}
      {!rows.length && <p className="empty-state">Sem dados no período filtrado.</p>}
    </div>
  );
}

function FinancialIntelligence() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const allowed = canViewFinancial(user);
  const canManage = canManageFinancial(user);
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [filters, setFilters] = useState({
    startDate: firstDay,
    endDate: today,
    clinicId: '',
    clinicName: '',
    unit: '',
    operatorId: '',
    role: '',
    functionName: '',
    supervisorId: '',
    campaign: '',
    channel: '',
    status: ''
  });
  const [clinics, setClinics] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');

  const loadData = useCallback(async () => {
    if (!allowed) return;

    setLoading(true);
    setFeedback('');

    try {
      const params = {
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
        view: 'dashboard'
      };
      const [financialRes, clinicsRes] = await Promise.all([
        api.get('/financial-intelligence', { params }),
        api.get('/clinics')
      ]);

      setData(financialRes.data);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar a Inteligência Financeira CRC.');
    } finally {
      setLoading(false);
    }
  }, [allowed, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const table = useMemo(() => data?.table || [], [data?.table]);
  const optionSets = useMemo(() => {
    const unique = (field) => Array.from(new Set(table.map((row) => row[field]).filter(Boolean))).sort();

    return {
      units: unique('unit_name'),
      operators: Array.from(new Map(table.filter((row) => row.operator_name).map((row) => [row.operator_id || row.operator_name, row.operator_name])).entries()),
      supervisors: Array.from(new Map(table.filter((row) => row.supervisor_name).map((row) => [row.supervisor_id || row.supervisor_name, row.supervisor_name])).entries()),
      roles: unique('role'),
      functions: unique('function_name'),
      campaigns: unique('campaign'),
      channels: unique('channel')
    };
  }, [table]);

  const clinicFilterValue = filters.clinicName || filters.clinicId;
  const handleClinicFilterChange = (value) => {
    if (value === FINANCIAL_CENTRAL_CLINIC.id) {
      setFilters((current) => ({
        ...current,
        clinicId: '',
        clinicName: FINANCIAL_CENTRAL_CLINIC.name,
        unit: FINANCIAL_CENTRAL_CLINIC.unit
      }));
      return;
    }

    setFilters((current) => ({ ...current, clinicId: value, clinicName: '' }));
  };

  const summary = data?.summary || {};
  const metrics = [
    ['Receita Total CRC', formatCurrency(summary.totalRevenue), 'Receita gerada no período', 'neutral'],
    ['Custo Total CRC', formatCurrency(summary.totalCost), 'Soma de todos os centros de custo', 'warning'],
    ['Lucro/Prejuízo CRC', formatCurrency(summary.profit), 'Resultado operacional consolidado', metricTone(summary.profit, 'money')],
    ['ROI CRC', formatPercent(summary.roiCrc), 'Retorno sobre o custo total', metricTone(summary.roiCrc, 'roi')],
    ['ROI CRC vs SELIC', formatPercent(summary.roiCrcVsSelic), `SELIC: ${formatPercent(summary.selicRate)}`, metricTone(summary.roiCrcVsSelic, 'selic')],
    ['Investimento Marketing', formatCurrency(summary.marketingInvestment), 'Investimento e custos de mídia', 'neutral'],
    ['ROI Marketing', formatPercent(summary.marketingRoi), 'Retorno dos custos de marketing', metricTone(summary.marketingRoi, 'roi')],
    ['ROAS', `${Number(summary.roas || 0).toFixed(2)}x`, 'Receita sobre custo de marketing', 'neutral'],
    ['CAC Médio', formatCurrency(summary.cac), 'Custo por fechamento', summary.cac > 120 ? 'danger' : 'success'],
    ['CPL Médio', formatCurrency(summary.cpl), 'Custo por lead', summary.cpl > 25 ? 'danger' : 'success'],
    ['Ticket Médio', formatCurrency(summary.averageTicket), 'Receita média por fechamento', 'neutral'],
    ['Margem Líquida', formatPercent(summary.netMargin), 'Lucro sobre receita', metricTone(summary.netMargin, 'money')],
    ['Conversão Lead > Agendamento', formatPercent(summary.leadToAppointment), 'Eficiência do topo do funil', summary.leadToAppointment >= 20 ? 'success' : 'warning'],
    ['Comparecimento', formatPercent(summary.attendanceRate), 'Agendamentos que compareceram', summary.attendanceRate >= 70 ? 'success' : 'warning'],
    ['Fechamento', formatPercent(summary.closingRate), 'Comparecimentos convertidos', summary.closingRate >= 40 ? 'success' : 'warning'],
    ['Receita por Clínica', formatCurrency(summary.revenueByClinic), 'Média por clínica filtrada', 'neutral'],
    ['Custo por Clínica', formatCurrency(summary.costByClinic), 'Média por clínica filtrada', 'neutral'],
    ['Lucro por Clínica', formatCurrency(summary.profitByClinic), 'Média de resultado por clínica', metricTone(summary.profitByClinic, 'money')],
    ['Custo Total com Colaboradores', formatCurrency(summary.totalCollaboratorCost), 'Folha e custos vinculados', 'neutral'],
    ['Custo Médio por Colaborador', formatCurrency(summary.averageCollaboratorCost), 'Média por colaborador', 'neutral'],
    ['Receita por Colaborador', formatCurrency(summary.revenueByCollaborator), 'Produtividade média', 'neutral'],
    ['ROI por Colaborador', formatPercent(summary.roiByCollaborator), 'Média de retorno individual', metricTone(summary.roiByCollaborator, 'roi')]
  ];

  if (!allowed) {
    return (
      <main className="app-page">
        <section className="restricted-panel">
          <p className="eyebrow">Acesso restrito</p>
          <h1>Inteligência Financeira CRC</h1>
          <p>Seu perfil não possui acesso aos indicadores financeiros do CRC.</p>
          <button className="primary-action" onClick={() => navigate('/home')}>Voltar para Home</button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page financial-page">
      <header className="page-heading financial-heading">
        <div>
          <p className="eyebrow">Inteligência Financeira do CRC</p>
          <h1>Dashboard Executivo</h1>
          <p>BI financeiro para margem, ROI, custos, funil comercial, marketing, clínicas e colaboradores.</p>
        </div>
        <div className="heading-actions">
          {canManage && (
            <button className="primary-action" onClick={() => navigate('/home/financial-intelligence/manage')}>
              Gestão de dados
            </button>
          )}
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="financial-filter-panel">
        <label>Período inicial<input className="field" type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label>Período final<input className="field" type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <label>Clínica<select className="field" value={clinicFilterValue} onChange={(event) => handleClinicFilterChange(event.target.value)}><option value="">Todas</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
        <label>Unidade<select className="field" value={filters.unit} onChange={(event) => setFilters((current) => ({ ...current, unit: event.target.value }))}><option value="">Todas</option>{optionSets.units.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Operador<select className="field" value={filters.operatorId} onChange={(event) => setFilters((current) => ({ ...current, operatorId: event.target.value }))}><option value="">Todos</option>{optionSets.operators.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Função/Cargo<select className="field" value={filters.functionName} onChange={(event) => setFilters((current) => ({ ...current, functionName: event.target.value }))}><option value="">Todos</option>{optionSets.functions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Supervisor<select className="field" value={filters.supervisorId} onChange={(event) => setFilters((current) => ({ ...current, supervisorId: event.target.value }))}><option value="">Todos</option>{optionSets.supervisors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Campanha<select className="field" value={filters.campaign} onChange={(event) => setFilters((current) => ({ ...current, campaign: event.target.value }))}><option value="">Todas</option>{optionSets.campaigns.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Canal<select className="field" value={filters.channel} onChange={(event) => setFilters((current) => ({ ...current, channel: event.target.value }))}><option value="">Todos</option>{optionSets.channels.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Status<select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option><option value="excelente">Excelente</option><option value="adequado">Adequado</option><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></label>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}
      {loading && <div className="financial-skeleton">Carregando indicadores financeiros...</div>}

      <section className="financial-metric-grid">
        {metrics.map(([label, value, detail, tone]) => (
          <MetricCard key={label} label={label} value={value} detail={detail} tone={tone} />
        ))}
      </section>

      <section className={`financial-selic-card ${data?.roiVsSelic?.status || 'near'}`}>
        <div>
          <p className="eyebrow">ROI CRC vs SELIC</p>
          <h2>{data?.roiVsSelic?.status === 'above' ? 'CRC performando acima da SELIC' : data?.roiVsSelic?.status === 'below' ? 'CRC performando abaixo da SELIC' : 'CRC próximo da SELIC'}</h2>
          <p>Comparação entre o ROI operacional do CRC e a taxa SELIC configurada nos lançamentos.</p>
        </div>
        <div className="financial-selic-values">
          <strong>{formatPercent(data?.roiVsSelic?.roiCrc)}</strong>
          <span>SELIC {formatPercent(data?.roiVsSelic?.selicRate)} · Diferença {formatPercent(data?.roiVsSelic?.difference)}</span>
        </div>
      </section>

      <section className="financial-diagnostic-panel">
        <div>
          <p className="eyebrow">Diagnóstico automático</p>
          <h2>Análise executiva do período</h2>
        </div>
        <div className="financial-diagnostic-grid">
          {(data?.diagnostics || []).map((item) => <span key={item}>{item}</span>)}
          {!data?.diagnostics?.length && <span>Sem alertas para o período selecionado.</span>}
        </div>
      </section>

      <section className="financial-chart-grid">
        <ChartCard title="Funil CRC" subtitle="Leads > agendamentos > comparecimentos > fechamentos" className="large">
          <ResponsiveContainer>
            <FunnelChart>
              <Tooltip content={<CustomTooltip />} />
              <Funnel dataKey="value" data={data?.charts?.funnel || []} nameKey="label">
                <LabelList position="right" fill="#161218" stroke="none" dataKey="label" />
                {(data?.charts?.funnel || []).map((entry, index) => <Cell key={entry.label} fill={chartColors[index % chartColors.length]} />)}
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Receita x Custo x Lucro" subtitle="Série mensal consolidada" className="large">
          <ResponsiveContainer><ComposedChart data={data?.charts?.revenueCostProfit || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Legend /><Bar dataKey="revenue" name="Receita" fill="#1f7a8c" /><Bar dataKey="cost" name="Custo" fill="#c89a57" /><Line type="monotone" dataKey="profit" name="Lucro" stroke="#4c956c" strokeWidth={3} /></ComposedChart></ResponsiveContainer>
        </ChartCard>

        <ChartCard title="ROI por campanha"><ResponsiveContainer><BarChart data={data?.charts?.campaignRoi || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="roi" name="ROI %" fill="#8e6731" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="CAC por campanha"><ResponsiveContainer><BarChart data={data?.charts?.campaignCac || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="cac" name="CAC R$" fill="#c44536" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="CPL por campanha"><ResponsiveContainer><BarChart data={data?.charts?.campaignCpl || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="cpl" name="CPL R$" fill="#d4a764" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Ranking de operadores"><RankingList rows={data?.rankings?.operators || []} valueKey="closings" formatter={formatNumber} /></ChartCard>
        <ChartCard title="Ranking de clínicas"><RankingList rows={data?.rankings?.clinics || []} valueKey="profit" /></ChartCard>
        <ChartCard title="Receita por clínica"><ResponsiveContainer><BarChart data={data?.charts?.revenueByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="revenue" name="Receita R$" fill="#1f7a8c" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Custo por clínica"><ResponsiveContainer><BarChart data={data?.charts?.costByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="cost" name="Custo R$" fill="#c89a57" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Lucro por clínica"><ResponsiveContainer><BarChart data={data?.charts?.profitByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="profit" name="Lucro R$" fill="#4c956c" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="ROI por clínica"><ResponsiveContainer><BarChart data={data?.charts?.roiByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="roi" name="ROI %" fill="#8e6731" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="ROI Marketing por clínica"><ResponsiveContainer><BarChart data={data?.charts?.marketingRoiByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="marketingRoi" name="ROI Marketing %" fill="#5d6d7e" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Ranking de canais"><RankingList rows={data?.rankings?.channels || []} valueKey="profit" /></ChartCard>
        <ChartCard title="Evolução mensal"><ResponsiveContainer><AreaChart data={data?.charts?.monthlyEvolution || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Area type="monotone" dataKey="revenue" name="Receita" stroke="#1f7a8c" fill="#1f7a8c33" /><Area type="monotone" dataKey="cost" name="Custo" stroke="#c89a57" fill="#c89a5733" /></AreaChart></ResponsiveContainer></ChartCard>
        <ChartCard title="ROI CRC vs SELIC"><ResponsiveContainer><LineChart data={data?.charts?.roiVsSelic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Legend /><Line type="monotone" dataKey="roi" name="ROI CRC" stroke="#4c956c" strokeWidth={3} /><Line type="monotone" dataKey="selicRate" name="SELIC" stroke="#c44536" strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Custo por colaborador"><ResponsiveContainer><BarChart data={data?.charts?.costByCollaborator || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="collaboratorCost" name="Custo R$" fill="#c89a57" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="ROI por colaborador"><ResponsiveContainer><BarChart data={data?.charts?.roiByCollaborator || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="roi" name="ROI %" fill="#8e6731" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Receita por colaborador"><ResponsiveContainer><BarChart data={data?.charts?.revenueByCollaborator || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="revenue" name="Receita R$" fill="#1f7a8c" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Custo por função/cargo"><ResponsiveContainer><BarChart data={data?.charts?.costByRole || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="collaboratorCost" name="Custo R$" fill="#6d573b" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Série histórica" subtitle="Receita, custo, lucro e ROI" className="large"><ResponsiveContainer><ComposedChart data={data?.charts?.historicalSeries || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Legend /><Bar dataKey="revenue" name="Receita" fill="#1f7a8c" /><Bar dataKey="cost" name="Custo" fill="#c89a57" /><Line dataKey="profit" name="Lucro" stroke="#4c956c" strokeWidth={3} /><Line dataKey="roi" name="ROI" stroke="#8e6731" strokeWidth={2} /></ComposedChart></ResponsiveContainer></ChartCard>
      </section>

      <section className="financial-margins-panel">
        <div>
          <p className="eyebrow">Margens Previstas</p>
          <h2>Referências internas de performance</h2>
        </div>
        <div className="financial-margin-grid">
          {Object.entries(data?.expectedMargins || {}).map(([key, item]) => (
            <article key={key}>
              <strong>{item.label}</strong>
              <span>{item.prefix || ''}{item.min}{item.suffix || ''}{item.max ? ` a ${item.prefix || ''}${item.max}${item.suffix || ''}` : '+'}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default FinancialIntelligence;
