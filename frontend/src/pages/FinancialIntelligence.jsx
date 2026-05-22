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
import { hasPermission, readUser } from '../constants';

const chartColors = ['#8e6731', '#1f7a8c', '#6d573b', '#c89a57', '#c44536', '#4c956c', '#5d6d7e'];
const FINANCIAL_CENTRAL_CLINIC = { id: 'central-crc', name: 'Escritório Central - CRC' };

function canViewFinancial(user) {
  return hasPermission(user, 'financial_dashboard');
}

function canManageFinancial(user) {
  return hasPermission(user, 'financial_management');
}

function canViewCampaignDashboard(user) {
  return hasPermission(user, 'financial_campaigns');
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

function ebitdaTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'excelente' || normalized === 'adequado') return 'success';
  if (normalized === 'atencao') return 'warning';
  if (normalized === 'critico') return 'danger';
  return 'neutral';
}

function ebitdaStatusLabel(status) {
  const labels = {
    excelente: 'Excelente',
    adequado: 'Adequado',
    atencao: 'Atenção',
    critico: 'Crítico'
  };
  return labels[String(status || '').toLowerCase()] || 'Sem dados';
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let normalized = String(value ?? 0)
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

function selicStatus(difference) {
  if (difference >= 1) return 'above';
  if (difference <= -1) return 'below';
  return 'near';
}

function formatReferenceDate(value) {
  if (!value) return 'referência atual';
  const text = String(value);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('pt-BR');
}

function escapeCsv(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
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
              || String(item.dataKey || '').toLowerCase().includes('ebitda')
              || String(item.name || '').includes('R$')
                ? formatCurrency(item.value)
                : formatNumber(item.value)}
        </span>
      ))}
    </div>
  );
}

function MetricCard({ label, value, detail, tone = 'neutral', explanation, onOpen }) {
  return (
    <article
      className={`financial-metric-card ${tone}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.();
        }
      }}
    >
      <span className="financial-metric-title">
        <i className={`financial-metric-signal ${tone}`} aria-hidden="true" />
        {label}
        <button
          type="button"
          className="financial-help-button"
          title={explanation}
          aria-label={`Explicar ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen?.();
          }}
        >
          ?
        </button>
      </span>
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
  const canOpenCampaigns = canViewCampaignDashboard(user);
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [filters, setFilters] = useState({
    startDate: firstDay,
    endDate: today,
    clinicId: '',
    clinicName: '',
    campaign: '',
    channel: '',
    status: ''
  });
  const [clinics, setClinics] = useState([]);
  const [data, setData] = useState(null);
  const [selicInfo, setSelicInfo] = useState({ value: 0, source: 'fallback', referenceDate: null });
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [activeMetric, setActiveMetric] = useState(null);

  const loadData = useCallback(async () => {
    if (!allowed) return;

    setLoading(true);
    setFeedback('');

    try {
      const params = {
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
        view: 'dashboard'
      };
      const [financialRes, clinicsRes, selicRes] = await Promise.all([
        api.get('/financial-intelligence', { params }),
        api.get('/clinics'),
        api.get('/financial-intelligence/selic').catch(() => ({ data: null }))
      ]);

      setData(financialRes.data);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setSelicInfo({
        value: toNumber(selicRes.data?.value) || toNumber(financialRes.data?.summary?.selicRate),
        source: selicRes.data?.source || 'fallback',
        referenceDate: selicRes.data?.referenceDate || null
      });
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
      }));
      return;
    }

    setFilters((current) => ({ ...current, clinicId: value, clinicName: '' }));
  };

  const summary = data?.summary || {};
  const realSelicRate = toNumber(selicInfo.value) || toNumber(summary.selicRate);
  const realSelicDifference = toNumber(summary.roiCrc) - realSelicRate;
  const realSelicStatus = selicStatus(realSelicDifference);
  const realSelicReference = formatReferenceDate(selicInfo.referenceDate);
  const metrics = [
    {
      label: 'Receita Total CRC',
      value: formatCurrency(summary.totalRevenue),
      detail: 'Receita gerada no período',
      tone: 'neutral',
      explanation: 'Soma de toda receita atribuída ao CRC no período filtrado. Use este indicador para entender o volume financeiro gerado antes de descontar custos.'
    },
    {
      label: 'Custo Total CRC',
      value: formatCurrency(summary.totalCost),
      detail: 'Soma de todos os centros de custo',
      tone: 'warning',
      explanation: 'Consolida custos operacionais, marketing, administrativos e custos de colaboradores vinculados ao CRC no período.'
    },
    {
      label: 'Custo da Hora Trabalhada',
      value: formatCurrency(summary.averageWorkedHourCost),
      detail: `${Number(summary.totalCollaboratorWorkedHours || 0).toLocaleString('pt-BR')} h de colaboradores no periodo`,
      tone: toNumber(summary.averageWorkedHourCost) > 0 ? 'neutral' : 'warning',
      explanation: 'Custo total mensal dos colaboradores dividido pela carga horaria trabalhada estimada no periodo. A base de horas e configuravel no Centro Master > Financeiro > Custos Trabalhistas.'
    },
    {
      label: 'Lucro/Prejuízo CRC',
      value: formatCurrency(summary.profit),
      detail: 'Resultado operacional consolidado',
      tone: metricTone(summary.profit, 'money'),
      explanation: 'Receita total menos o custo total do CRC. Valor positivo indica lucro operacional; valor negativo indica prejuízo no período.'
    },
    {
      label: 'EBITDA CRC',
      value: formatCurrency(summary.ebitdaCrc),
      detail: 'Geração operacional antes de impostos',
      tone: metricTone(summary.ebitdaCrc, 'money'),
      explanation: 'Receita operacional do CRC menos custos e despesas operacionais do CRC, sem considerar impostos, juros, depreciação ou amortização.'
    },
    {
      label: 'Margem EBITDA CRC',
      value: formatPercent(summary.ebitdaMarginCrc),
      detail: 'EBITDA sobre receita do CRC',
      tone: ebitdaTone(summary.ebitdaStatus),
      explanation: 'Percentual do EBITDA em relação à receita operacional do CRC. Ajuda a medir a força operacional real do departamento.'
    },
    {
      label: 'Status EBITDA CRC',
      value: ebitdaStatusLabel(summary.ebitdaStatus),
      detail: `Margem EBITDA ${formatPercent(summary.ebitdaMarginCrc)}`,
      tone: ebitdaTone(summary.ebitdaStatus),
      explanation: 'Classificação automática: Crítico abaixo de 5% ou EBITDA negativo; Atenção entre 5% e 15%; Adequado entre 15% e 30%; Excelente acima de 30%.'
    },
    {
      label: 'ROI CRC',
      value: formatPercent(summary.roiCrc),
      detail: 'Retorno sobre o custo total',
      tone: toNumber(summary.roiCrc) < realSelicRate ? 'danger' : metricTone(summary.roiCrc, 'roi'),
      explanation: 'Mede o retorno gerado pelo CRC em relação ao custo total. Fórmula: lucro dividido pelo custo total, multiplicado por 100.'
    },
    {
      label: 'ROI CRC vs SELIC',
      value: formatPercent(realSelicDifference),
      detail: `SELIC anual fixa: ${formatPercent(realSelicRate)}`,
      tone: metricTone(realSelicDifference, 'selic'),
      explanation: 'Compara o ROI do CRC com a SELIC anual fixa de 15% definida como referência administrativa do sistema.'
    },
    {
      label: 'Investimento Marketing',
      value: formatCurrency(summary.marketingInvestment),
      detail: 'Investimento e custos de mídia',
      tone: 'neutral',
      explanation: 'Total informado como investimento de marketing, incluindo mídia e custos de campanhas associados aos lançamentos filtrados.'
    },
    {
      label: 'ROI Marketing',
      value: formatPercent(summary.marketingRoi),
      detail: 'Retorno dos custos de marketing',
      tone: metricTone(summary.marketingRoi, 'roi'),
      explanation: 'Mostra quanto a receita retornou em relação aos custos de marketing. É útil para comparar a qualidade das campanhas e canais.'
    },
    {
      label: 'ROAS',
      value: `${Number(summary.roas || 0).toFixed(2)}x`,
      detail: 'Receita sobre custo de marketing',
      tone: 'neutral',
      explanation: 'Receita dividida pelo custo de marketing. Exemplo: 4x significa que cada R$ 1,00 investido gerou R$ 4,00 em receita.'
    },
    {
      label: 'CAC Médio',
      value: formatCurrency(summary.cac),
      detail: 'Custo por fechamento',
      tone: summary.cac > 120 ? 'danger' : 'success',
      explanation: 'Custo de aquisição por cliente fechado. Quanto menor, melhor a eficiência comercial do CRC.'
    },
    {
      label: 'CPL Médio',
      value: formatCurrency(summary.cpl),
      detail: 'Custo por lead',
      tone: summary.cpl > 25 ? 'danger' : 'success',
      explanation: 'Custo médio para gerar um lead. Ajuda a avaliar campanhas, canais e qualidade do investimento de marketing.'
    },
    {
      label: 'Ticket Médio',
      value: formatCurrency(summary.averageTicket),
      detail: 'Receita média por fechamento',
      tone: 'neutral',
      explanation: 'Receita total dividida pela quantidade de fechamentos. Indica o valor médio convertido por paciente/negociação.'
    },
    {
      label: 'Margem Líquida',
      value: formatPercent(summary.netMargin),
      detail: 'Lucro sobre receita',
      tone: metricTone(summary.netMargin, 'money'),
      explanation: 'Percentual de lucro em relação à receita. Ajuda a medir se o CRC cresce com rentabilidade ou apenas com volume.'
    },
    {
      label: 'Conversão Lead > Agendamento',
      value: formatPercent(summary.leadToAppointment),
      detail: 'Eficiência do topo do funil',
      tone: summary.leadToAppointment >= 20 ? 'success' : 'warning',
      explanation: 'Percentual de leads que viraram agendamento. Quando baixo, pode indicar problema de abordagem, qualidade do lead ou campanha.'
    },
    {
      label: 'Comparecimento',
      value: formatPercent(summary.attendanceRate),
      detail: 'Agendamentos que compareceram',
      tone: summary.attendanceRate >= 70 ? 'success' : 'warning',
      explanation: 'Percentual de agendamentos que compareceram. Ajuda a medir qualidade de confirmação, aderência e preparo do paciente.'
    },
    {
      label: 'Fechamento',
      value: formatPercent(summary.closingRate),
      detail: 'Comparecimentos convertidos',
      tone: summary.closingRate >= 40 ? 'success' : 'warning',
      explanation: 'Percentual de comparecimentos que viraram fechamento. Mostra eficiência comercial depois que o paciente chega à clínica.'
    },
    {
      label: 'Receita por Clínica',
      value: formatCurrency(summary.revenueByClinic),
      detail: 'Média por clínica filtrada',
      tone: 'neutral',
      explanation: 'Receita média por clínica considerada no filtro atual. Ajuda a comparar unidade, campanha e produção regional.'
    },
    {
      label: 'Custo por Clínica',
      value: formatCurrency(summary.costByClinic),
      detail: 'Média por clínica filtrada',
      tone: 'neutral',
      explanation: 'Custo médio por clínica considerando somente investimento e custos de marketing/campanha. Custos operacionais e de colaboradores ficam no ROI geral mensal, sem distorcer a análise por unidade.'
    },
    {
      label: 'Lucro por Clínica',
      value: formatCurrency(summary.profitByClinic),
      detail: 'Média de resultado por clínica',
      tone: metricTone(summary.profitByClinic, 'money'),
      explanation: 'Lucro médio por clínica. Mostra quais recortes de unidades estão contribuindo positivamente para o resultado.'
    }
  ];

  const executiveDiagnostics = useMemo(
    () => (data?.diagnostics || []).filter((item) => !/^(Colaborador|Função)\b/i.test(item)),
    [data?.diagnostics]
  );

  const exportExcel = () => {
    const header = ['Data', 'Clínica', 'Unidade', 'Campanha', 'Canal', 'Receita', 'Custo Marketing', 'Lucro', 'EBITDA', 'Margem EBITDA', 'ROI', 'Status'];
    const rows = table.map((row) => [
      row.date,
      row.clinic_name,
      row.campaign_target_unit || row.unit_name,
      row.campaign,
      row.channel,
      row.revenue,
      row.total_marketing_cost,
      row.profit,
      row.ebitda_crc,
      row.ebitda_margin_crc,
      row.roi_crc,
      row.status
    ]);
    const summaryRows = [
      ['Resumo executivo', ''],
      ['Receita Total CRC', summary.totalRevenue],
      ['Custo Total CRC', summary.totalCost],
      ['Lucro/Prejuízo CRC', summary.profit],
      ['EBITDA CRC', summary.ebitdaCrc],
      ['Margem EBITDA CRC', summary.ebitdaMarginCrc],
      ['Status EBITDA CRC', ebitdaStatusLabel(summary.ebitdaStatus)],
      ['ROI CRC', summary.roiCrc],
      ['SELIC anual fixa', realSelicRate],
      ['Custo mensal colaboradores', summary.totalCollaboratorCost],
      ['Custo da hora trabalhada', summary.averageWorkedHourCost],
      ['Horas trabalhadas consideradas', summary.totalCollaboratorWorkedHours],
      ['Custo mensal operacional', summary.totalOperationalCost]
    ];
    const csv = [
      `Exportado em;${new Date().toLocaleString('pt-BR')}`,
      '',
      ...summaryRows.map((row) => row.map(escapeCsv).join(';')),
      '',
      header.map(escapeCsv).join(';'),
      ...rows.map((row) => row.map(escapeCsv).join(';'))
    ].join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dashboard-executivo-crc.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Dashboard Executivo CRC</title>
      <style>
        body{font-family:Arial,sans-serif;padding:28px;color:#17120f;background:#fffdfa}
        h1{margin:0;color:#2a2218}.sub{color:#6d5b4b;margin:6px 0 18px}
        .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
        .card{border:1px solid #ddcfbc;border-radius:10px;padding:12px;background:#f8f3eb}
        .card span{display:block;color:#6d5b4b;font-size:10px;text-transform:uppercase;font-weight:700}
        .card strong{font-size:18px}
        table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border:1px solid #ddcfbc;padding:7px;text-align:left}
        th{background:#efe6d8;text-transform:uppercase;font-size:9px}
      </style></head><body>
      <h1>Dashboard Executivo CRC</h1>
      <p class="sub">Relatório exportado em ${new Date().toLocaleString('pt-BR')} · SELIC anual fixa ${formatPercent(realSelicRate)}</p>
      <section class="cards">
        <article class="card"><span>Receita</span><strong>${formatCurrency(summary.totalRevenue)}</strong></article>
        <article class="card"><span>Custo</span><strong>${formatCurrency(summary.totalCost)}</strong></article>
        <article class="card"><span>Lucro</span><strong>${formatCurrency(summary.profit)}</strong></article>
        <article class="card"><span>EBITDA CRC</span><strong>${formatCurrency(summary.ebitdaCrc)}</strong></article>
        <article class="card"><span>Margem EBITDA</span><strong>${formatPercent(summary.ebitdaMarginCrc)}</strong></article>
        <article class="card"><span>Status EBITDA</span><strong>${ebitdaStatusLabel(summary.ebitdaStatus)}</strong></article>
        <article class="card"><span>ROI CRC</span><strong>${formatPercent(summary.roiCrc)}</strong></article>
      </section>
      <table><thead><tr><th>Data</th><th>Clínica</th><th>Unidade/Campanha</th><th>Campanha</th><th>Receita</th><th>Custo Marketing</th><th>Lucro</th><th>EBITDA</th><th>Margem EBITDA</th><th>ROI</th><th>Status</th></tr></thead>
      <tbody>${table.map((row) => `<tr><td>${row.date || ''}</td><td>${row.clinic_name || ''}</td><td>${row.campaign_target_unit || row.unit_name || ''}</td><td>${row.campaign || ''}</td><td>${formatCurrency(row.revenue)}</td><td>${formatCurrency(row.total_marketing_cost)}</td><td>${formatCurrency(row.profit)}</td><td>${formatCurrency(row.ebitda_crc)}</td><td>${formatPercent(row.ebitda_margin_crc)}</td><td>${formatPercent(row.roi_crc)}</td><td>${row.status || ''}</td></tr>`).join('')}</tbody></table>
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
          <p>Visão diretiva de margem, ROI, custos, funil comercial, marketing e clínicas.</p>
        </div>
        <div className="heading-actions">
          {canOpenCampaigns && (
            <button className="outline-action" onClick={() => navigate('/home/financial-intelligence/campaigns')}>
              Unidade x Campanha
            </button>
          )}
          {canManage && (
            <button className="primary-action" onClick={() => navigate('/home/financial-intelligence/manage')}>
              Gestão de dados
            </button>
          )}
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

      <section className="financial-filter-panel">
        <label>Período inicial<input className="field" type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label>Período final<input className="field" type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <label>Clínica<select className="field" value={clinicFilterValue} onChange={(event) => handleClinicFilterChange(event.target.value)}><option value="">Todas</option><option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
        <label>Campanha<select className="field" value={filters.campaign} onChange={(event) => setFilters((current) => ({ ...current, campaign: event.target.value }))}><option value="">Todas</option>{optionSets.campaigns.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Canal<select className="field" value={filters.channel} onChange={(event) => setFilters((current) => ({ ...current, channel: event.target.value }))}><option value="">Todos</option>{optionSets.channels.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Status<select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option><option value="excelente">Excelente</option><option value="adequado">Adequado</option><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></label>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}
      {loading && <div className="financial-skeleton">Carregando indicadores financeiros...</div>}

      <section className="financial-executive-overview">
        <article>
          <p className="eyebrow">Resultado consolidado</p>
          <strong>{formatCurrency(summary.profit)}</strong>
          <span>Receita {formatCurrency(summary.totalRevenue)} · Custo {formatCurrency(summary.totalCost)}</span>
        </article>
        <article>
          <p className="eyebrow">Eficiência do CRC</p>
          <strong>{formatPercent(summary.roiCrc)}</strong>
          <span>EBITDA {formatCurrency(summary.ebitdaCrc)} · Margem EBITDA {formatPercent(summary.ebitdaMarginCrc)}</span>
        </article>
        <article className={realSelicStatus}>
          <p className="eyebrow">Comparativo SELIC</p>
          <strong>{formatPercent(realSelicDifference)}</strong>
          <span>SELIC anual fixa {formatPercent(realSelicRate)} · {realSelicReference}</span>
        </article>
      </section>

      <section className="financial-metric-grid">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} onOpen={() => setActiveMetric(metric)} />
        ))}
      </section>

      <section className={`financial-selic-card ${realSelicStatus}`}>
        <div>
          <p className="eyebrow">ROI CRC vs SELIC</p>
          <h2>{realSelicStatus === 'above' ? 'CRC performando acima da SELIC' : realSelicStatus === 'below' ? 'CRC performando abaixo da SELIC' : 'CRC próximo da SELIC'}</h2>
          <p>Comparação entre o ROI operacional do CRC e a SELIC anual fixa de 15%.</p>
        </div>
        <div className="financial-selic-values">
          <strong>{formatPercent(summary.roiCrc)}</strong>
          <span>SELIC anual fixa {formatPercent(realSelicRate)} · Diferença {formatPercent(realSelicDifference)}</span>
          <small>Fonte: regra administrativa interna · {realSelicReference}</small>
          {realSelicStatus === 'below' && <em className="financial-alert-text">Alerta: ROI geral abaixo da SELIC. Revisar custos mensais, campanhas e conversão.</em>}
        </div>
      </section>

      <section className="financial-diagnostic-panel">
        <div>
          <p className="eyebrow">Diagnóstico automático</p>
          <h2>Análise executiva do período</h2>
        </div>
        <div className="financial-diagnostic-grid">
          {executiveDiagnostics.map((item) => <span key={item}>{item}</span>)}
          {!executiveDiagnostics.length && <span>Sem alertas para o período selecionado.</span>}
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

        <ChartCard title="Evolução mensal do EBITDA CRC" subtitle="Geração operacional antes de impostos" className="large">
          <ResponsiveContainer><AreaChart data={data?.charts?.ebitdaEvolution || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Area type="monotone" dataKey="ebitda" name="EBITDA R$" stroke="#4c956c" fill="#4c956633" /></AreaChart></ResponsiveContainer>
        </ChartCard>

        <ChartCard title="EBITDA CRC x Custo Total CRC"><ResponsiveContainer><ComposedChart data={data?.charts?.ebitdaCostComparison || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Legend /><Bar dataKey="cost" name="Custo Total R$" fill="#c89a57" /><Line type="monotone" dataKey="ebitda" name="EBITDA R$" stroke="#4c956c" strokeWidth={3} /></ComposedChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Receita CRC x EBITDA CRC"><ResponsiveContainer><ComposedChart data={data?.charts?.revenueEbitdaComparison || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Legend /><Bar dataKey="revenue" name="Receita R$" fill="#1f7a8c" /><Line type="monotone" dataKey="ebitda" name="EBITDA R$" stroke="#4c956c" strokeWidth={3} /></ComposedChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Margem EBITDA CRC por período"><ResponsiveContainer><LineChart data={data?.charts?.ebitdaMarginByPeriod || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Line type="monotone" dataKey="ebitdaMargin" name="Margem EBITDA %" stroke="#8e6731" strokeWidth={3} /></LineChart></ResponsiveContainer></ChartCard>
        <ChartCard title="EBITDA CRC por clínica"><ResponsiveContainer><BarChart data={data?.charts?.ebitdaByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="ebitda" name="EBITDA R$" fill="#4c956c" /></BarChart></ResponsiveContainer></ChartCard>

        <ChartCard title="ROI por campanha"><ResponsiveContainer><BarChart data={data?.charts?.campaignRoi || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="roi" name="ROI %" fill="#8e6731" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="CAC por campanha"><ResponsiveContainer><BarChart data={data?.charts?.campaignCac || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="cac" name="CAC R$" fill="#c44536" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="CPL por campanha"><ResponsiveContainer><BarChart data={data?.charts?.campaignCpl || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="cpl" name="CPL R$" fill="#d4a764" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Ranking de clínicas"><RankingList rows={data?.rankings?.clinics || []} valueKey="profit" /></ChartCard>
        <ChartCard title="Receita por clínica"><ResponsiveContainer><BarChart data={data?.charts?.revenueByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="revenue" name="Receita R$" fill="#1f7a8c" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Custo por clínica"><ResponsiveContainer><BarChart data={data?.charts?.costByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="cost" name="Custo R$" fill="#c89a57" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Lucro por clínica"><ResponsiveContainer><BarChart data={data?.charts?.profitByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="profit" name="Lucro R$" fill="#4c956c" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="ROI por clínica"><ResponsiveContainer><BarChart data={data?.charts?.roiByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="roi" name="ROI %" fill="#8e6731" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="ROI Marketing por clínica"><ResponsiveContainer><BarChart data={data?.charts?.marketingRoiByClinic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Bar dataKey="marketingRoi" name="ROI Marketing %" fill="#5d6d7e" /></BarChart></ResponsiveContainer></ChartCard>
        <ChartCard title="Ranking de canais"><RankingList rows={data?.rankings?.channels || []} valueKey="profit" /></ChartCard>
        <ChartCard title="Evolução mensal"><ResponsiveContainer><AreaChart data={data?.charts?.monthlyEvolution || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Area type="monotone" dataKey="revenue" name="Receita" stroke="#1f7a8c" fill="#1f7a8c33" /><Area type="monotone" dataKey="cost" name="Custo" stroke="#c89a57" fill="#c89a5733" /></AreaChart></ResponsiveContainer></ChartCard>
        <ChartCard title="ROI CRC vs SELIC"><ResponsiveContainer><LineChart data={data?.charts?.roiVsSelic || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip content={<CustomTooltip />} /><Legend /><Line type="monotone" dataKey="roi" name="ROI CRC" stroke="#4c956c" strokeWidth={3} /><Line type="monotone" dataKey="selicRate" name="SELIC" stroke="#c44536" strokeWidth={2} /></LineChart></ResponsiveContainer></ChartCard>
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

      {activeMetric && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setActiveMetric(null)}>
          <section className="modal-panel financial-info-modal" onClick={(event) => event.stopPropagation()}>
            <div className="financial-card-heading">
              <p className="eyebrow">Indicador financeiro</p>
              <h2>{activeMetric.label}</h2>
              <p>{activeMetric.detail}</p>
            </div>
            <strong className="financial-info-value">{activeMetric.value}</strong>
            <p>{activeMetric.explanation}</p>
            <div className="row-actions">
              <button className="primary-action" onClick={() => setActiveMetric(null)}>Fechar</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default FinancialIntelligence;

