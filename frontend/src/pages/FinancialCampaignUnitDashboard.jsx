import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import api from '../api';
import { isAdmin, isMasterAdmin, readUser } from '../constants';

const FINANCIAL_CENTRAL_CLINIC = { id: 'central-crc', name: 'Escritório Central - CRC', unit: 'CRC' };
const chartColors = ['#8e6731', '#1f7a8c', '#4c956c', '#c89a57', '#c44536', '#5d6d7e'];

function canViewCampaignDashboard(user) {
  const role = String(user?.role || '').toLowerCase();
  return isAdmin(user) || isMasterAdmin(user) || ['manager', 'supervisor_crc'].includes(role);
}

function canViewExecutiveDashboard(user) {
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

function toNumber(value) {
  const parsed = Number(String(value || 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function divide(numerator, denominator, multiplier = 1) {
  const base = toNumber(denominator);
  if (!base) return 0;
  return Math.round((toNumber(numerator) / base) * multiplier * 100) / 100;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="financial-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => {
        const key = String(item.dataKey || '').toLowerCase();
        const name = String(item.name || '');
        const isMoney = key.includes('revenue') || key.includes('cost') || key.includes('profit') || name.includes('R$');
        const isPercent = key.includes('roi') || name.includes('%') || key.includes('rate');

        return (
          <span key={`${name}-${item.dataKey}`}>
            {name}: {isPercent ? formatPercent(item.value) : isMoney ? formatCurrency(item.value) : formatNumber(item.value)}
          </span>
        );
      })}
    </div>
  );
}

function buildUnitCampaignRows(rows = []) {
  const grouped = new Map();

  rows.forEach((row) => {
    const unit = row.unit_name || row.clinic_name || 'Sem unidade';
    const campaign = row.campaign || 'Sem campanha';
    const key = `${unit}__${campaign}`;
    const current = grouped.get(key) || {
      unit,
      campaign,
      revenue: 0,
      cost: 0,
      marketingCost: 0,
      profit: 0,
      leads: 0,
      appointments: 0,
      attendances: 0,
      closings: 0,
      rows: 0
    };

    current.revenue += toNumber(row.revenue);
    current.cost += toNumber(row.total_crc_cost);
    current.marketingCost += toNumber(row.total_marketing_cost);
    current.profit += toNumber(row.profit);
    current.leads += toNumber(row.leads);
    current.appointments += toNumber(row.appointments);
    current.attendances += toNumber(row.attendances);
    current.closings += toNumber(row.closings);
    current.rows += 1;
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    roi: divide(item.profit, item.cost, 100),
    marketingRoi: divide(item.revenue - item.marketingCost, item.marketingCost, 100),
    cac: divide(item.marketingCost, item.closings),
    cpl: divide(item.marketingCost, item.leads),
    conversion: divide(item.closings, item.leads, 100)
  })).sort((a, b) => b.revenue - a.revenue || a.unit.localeCompare(b.unit));
}

function groupBy(rows, key) {
  const grouped = new Map();

  rows.forEach((row) => {
    const label = row[key] || 'Não informado';
    const current = grouped.get(label) || {
      label,
      revenue: 0,
      cost: 0,
      marketingCost: 0,
      profit: 0,
      leads: 0,
      closings: 0,
      campaigns: new Set()
    };

    current.revenue += toNumber(row.revenue);
    current.cost += toNumber(row.cost);
    current.marketingCost += toNumber(row.marketingCost);
    current.profit += toNumber(row.profit);
    current.leads += toNumber(row.leads);
    current.closings += toNumber(row.closings);
    current.campaigns.add(row.campaign);
    grouped.set(label, current);
  });

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    campaigns: item.campaigns.size,
    roi: divide(item.profit, item.cost, 100),
    cac: divide(item.marketingCost, item.closings),
    cpl: divide(item.marketingCost, item.leads)
  })).sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label));
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

function FinancialCampaignUnitDashboard() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const allowed = canViewCampaignDashboard(user);
  const canOpenExecutive = canViewExecutiveDashboard(user);
  const canManage = canManageFinancial(user);
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [filters, setFilters] = useState({
    startDate: firstDay,
    endDate: today,
    clinicId: '',
    clinicName: '',
    unit: '',
    campaign: '',
    channel: '',
    status: ''
  });
  const [data, setData] = useState(null);
  const [clinics, setClinics] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const clinicFilterValue = filters.clinicName || filters.clinicId;

  const loadData = useCallback(async () => {
    if (!allowed) return;

    setLoading(true);
    setFeedback('');

    try {
      const params = {
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
        view: 'campaign_unit'
      };
      const [financialRes, clinicsRes] = await Promise.all([
        api.get('/financial-intelligence', { params }),
        api.get('/clinics')
      ]);

      setData(financialRes.data);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar o dashboard Unidade x Campanha.');
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
      campaigns: unique('campaign'),
      channels: unique('channel')
    };
  }, [table]);

  const unitCampaignRows = useMemo(() => buildUnitCampaignRows(table), [table]);
  const unitRows = useMemo(() => groupBy(unitCampaignRows, 'unit'), [unitCampaignRows]);
  const campaignRows = useMemo(() => groupBy(unitCampaignRows, 'campaign'), [unitCampaignRows]);
  const topCampaigns = useMemo(() => campaignRows.slice(0, 5).map((item) => item.label), [campaignRows]);
  const stackedRevenueData = useMemo(() => unitRows.slice(0, 12).map((unit) => {
    const row = { unit: unit.label };
    topCampaigns.forEach((campaign) => {
      row[campaign] = unitCampaignRows
        .filter((item) => item.unit === unit.label && item.campaign === campaign)
        .reduce((total, item) => total + toNumber(item.revenue), 0);
    });
    return row;
  }), [topCampaigns, unitCampaignRows, unitRows]);

  const summary = useMemo(() => {
    const revenue = unitCampaignRows.reduce((total, row) => total + toNumber(row.revenue), 0);
    const cost = unitCampaignRows.reduce((total, row) => total + toNumber(row.cost), 0);
    const profit = unitCampaignRows.reduce((total, row) => total + toNumber(row.profit), 0);
    const marketingCost = unitCampaignRows.reduce((total, row) => total + toNumber(row.marketingCost), 0);
    const leads = unitCampaignRows.reduce((total, row) => total + toNumber(row.leads), 0);
    const closings = unitCampaignRows.reduce((total, row) => total + toNumber(row.closings), 0);

    return {
      units: unitRows.length,
      campaigns: campaignRows.length,
      revenue,
      cost,
      profit,
      marketingCost,
      roi: divide(profit, cost, 100),
      cac: divide(marketingCost, closings),
      cpl: divide(marketingCost, leads),
      conversion: divide(closings, leads, 100)
    };
  }, [campaignRows.length, unitCampaignRows, unitRows.length]);

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

  if (!allowed) {
    return (
      <main className="app-page">
        <section className="restricted-panel">
          <p className="eyebrow">Acesso restrito</p>
          <h1>Dashboard Unidade x Campanha</h1>
          <p>Seu perfil não possui acesso à visão de unidade por campanha.</p>
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
          <h1>Dashboard Unidade x Campanha</h1>
          <p>Leitura executiva de campanhas por unidade, com receita, custo, ROI, CAC, CPL e conversão.</p>
        </div>
        <div className="heading-actions">
          {canOpenExecutive && <button className="outline-action" onClick={() => navigate('/home/financial-intelligence')}>Dashboard Executivo</button>}
          {canManage && <button className="primary-action" onClick={() => navigate('/home/financial-intelligence/manage')}>Gestão de dados</button>}
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      <section className="financial-filter-panel">
        <label>Período inicial<input className="field" type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label>Período final<input className="field" type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <label>Clínica<select className="field" value={clinicFilterValue} onChange={(event) => handleClinicFilterChange(event.target.value)}><option value="">Todas</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
        <label>Unidade<select className="field" value={filters.unit} onChange={(event) => setFilters((current) => ({ ...current, unit: event.target.value }))}><option value="">Todas</option>{optionSets.units.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Campanha<select className="field" value={filters.campaign} onChange={(event) => setFilters((current) => ({ ...current, campaign: event.target.value }))}><option value="">Todas</option>{optionSets.campaigns.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Canal<select className="field" value={filters.channel} onChange={(event) => setFilters((current) => ({ ...current, channel: event.target.value }))}><option value="">Todos</option>{optionSets.channels.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Status<select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option><option value="excelente">Excelente</option><option value="adequado">Adequado</option><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></label>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}
      {loading && <div className="financial-skeleton">Carregando campanhas por unidade...</div>}

      <section className="financial-metric-grid campaign-dashboard-metrics">
        <MetricCard label="Unidades com campanha" value={formatNumber(summary.units)} detail={`${formatNumber(summary.campaigns)} campanha(s) ativas`} />
        <MetricCard label="Receita atribuída" value={formatCurrency(summary.revenue)} detail={`Lucro ${formatCurrency(summary.profit)}`} tone={summary.profit >= 0 ? 'success' : 'danger'} />
        <MetricCard label="ROI consolidado" value={formatPercent(summary.roi)} detail={`Custo total ${formatCurrency(summary.cost)}`} tone={summary.roi >= 0 ? 'success' : 'danger'} />
        <MetricCard label="CAC / CPL" value={`${formatCurrency(summary.cac)} / ${formatCurrency(summary.cpl)}`} detail={`Conversão ${formatPercent(summary.conversion)}`} />
      </section>

      <section className="financial-campaign-dashboard-grid">
        <article className="financial-chart-card large">
          <div className="financial-card-heading">
            <h2>Receita por unidade e campanha</h2>
            <p>Campanhas com maior receita agrupadas por unidade.</p>
          </div>
          <div className="financial-chart-box">
            <ResponsiveContainer>
              <BarChart data={stackedRevenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="unit" />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                {topCampaigns.map((campaign, index) => (
                  <Bar key={campaign} dataKey={campaign} stackId="revenue" name={`${campaign} R$`} fill={chartColors[index % chartColors.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="financial-chart-card">
          <div className="financial-card-heading">
            <h2>ROI por unidade</h2>
            <p>Retorno financeiro consolidado de cada unidade.</p>
          </div>
          <div className="financial-chart-box">
            <ResponsiveContainer>
              <BarChart data={unitRows.slice(0, 12)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="roi" name="ROI %" fill="#8e6731" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="financial-chart-card">
          <div className="financial-card-heading">
            <h2>Campanhas com maior retorno</h2>
            <p>Receita, lucro e ROI das principais campanhas.</p>
          </div>
          <div className="financial-chart-box">
            <ResponsiveContainer>
              <ComposedChart data={campaignRows.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="revenue" name="Receita R$" fill="#1f7a8c" />
                <Line dataKey="roi" name="ROI %" stroke="#8e6731" strokeWidth={3} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="financial-chart-card">
          <div className="financial-card-heading">
            <h2>Conversão por campanha</h2>
            <p>Fechamentos sobre leads informados.</p>
          </div>
          <div className="financial-chart-box">
            <ResponsiveContainer>
              <BarChart data={campaignRows.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="closings" name="Fechamentos" fill="#4c956c">
                  {campaignRows.slice(0, 10).map((entry, index) => <Cell key={entry.label} fill={chartColors[index % chartColors.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="financial-campaign-matrix">
        <div className="financial-card-heading">
          <p className="eyebrow">Matriz executiva</p>
          <h2>Unidade, campanha e resultado</h2>
          <p>Tabela organizada para leitura rápida de performance por unidade e campanha.</p>
        </div>
        <div className="financial-campaign-table-wrap">
          <table className="financial-campaign-table">
            <thead>
              <tr>
                <th>Unidade</th>
                <th>Campanha</th>
                <th>Receita</th>
                <th>Custo total</th>
                <th>Lucro</th>
                <th>ROI</th>
                <th>CAC</th>
                <th>CPL</th>
                <th>Leads</th>
                <th>Fechamentos</th>
              </tr>
            </thead>
            <tbody>
              {unitCampaignRows.map((row) => (
                <tr key={`${row.unit}-${row.campaign}`}>
                  <td>{row.unit}</td>
                  <td>{row.campaign}</td>
                  <td>{formatCurrency(row.revenue)}</td>
                  <td>{formatCurrency(row.cost)}</td>
                  <td>{formatCurrency(row.profit)}</td>
                  <td>{formatPercent(row.roi)}</td>
                  <td>{formatCurrency(row.cac)}</td>
                  <td>{formatCurrency(row.cpl)}</td>
                  <td>{formatNumber(row.leads)}</td>
                  <td>{formatNumber(row.closings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!unitCampaignRows.length && <p className="empty-state">Sem lançamentos financeiros para os filtros selecionados.</p>}
        </div>
      </section>
    </main>
  );
}

export default FinancialCampaignUnitDashboard;
