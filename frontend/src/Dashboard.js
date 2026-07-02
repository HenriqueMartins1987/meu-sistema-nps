import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import 'chart.js/auto';
import api from './api';
import {
  channels,
  complaintTypes,
  priorityOptions,
  readUser,
  serviceTypes,
  statusLabels,
  statusOptions,
  isAdmin,
  isMasterAdmin,
  normalizeRoleValue
} from './constants';

const chartColors = ['#0b6f5f', '#1f7a8c', '#4c956c', '#d08c31', '#8a4f7d', '#5d6d7e', '#c44536', '#247ba0'];
const pageSizeOptions = [10, 25, 50, 100];
const monthOptions = [
  { value: '01', label: 'Janeiro' },
  { value: '02', label: 'Fevereiro' },
  { value: '03', label: 'Marco' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Maio' },
  { value: '06', label: 'Junho' },
  { value: '07', label: 'Julho' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' }
];
const evolutionGranularityOptions = [
  { value: 'month', label: 'Mensal' },
  { value: 'week', label: 'Semanal' },
  { value: 'day', label: 'Diaria' }
];

const initialFilters = {
  clinic: '',
  city: '',
  state: '',
  region: '',
  coordinator: '',
  status: '',
  type: '',
  priority: '',
  channel: '',
  sla: '',
  year: '',
  month: '',
  startDate: '',
  endDate: '',
  search: ''
};

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function normalizeOptionKey(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function dedupeDisplayValues(values) {
  const seen = new Set();

  return values.filter((value) => {
    const key = normalizeOptionKey(value);

    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueValues(rows, key) {
  return Array.from(new Set(rows.map((row) => row[key]).filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function mergeValues(...lists) {
  return Array.from(new Set(lists.flat().filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function orderOtherLast(values) {
  const normalized = Array.from(new Set(values.filter(Boolean)));
  const others = normalized.filter((value) => normalizeText(value) === 'outros' || normalizeText(value) === 'outro');
  const regular = normalized
    .filter((value) => !others.includes(value))
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

  return [...regular, ...others];
}

function groupCount(items, key) {
  const map = new Map();

  items.forEach((item) => {
    const value = key(item) || 'Não informado';
    map.set(value, (map.get(value) || 0) + 1);
  });

  return Array.from(map.entries())
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function buildBarData(rows, color = '#0b6f5f') {
  return {
    labels: rows.map((row) => row.label),
    datasets: [{
      label: 'Reclamações',
      data: rows.map((row) => row.total),
      backgroundColor: color,
      borderRadius: 6
    }]
  };
}

function buildDoughnutData(rows) {
  return {
    labels: rows.map((row) => row.label),
    datasets: [{
      data: rows.map((row) => row.total),
      backgroundColor: rows.map((_, index) => chartColors[index % chartColors.length]),
      borderWidth: 0
    }]
  };
}

function formatPercent(value) {
  return `${Math.round(value || 0)}%`;
}

function percentOf(total, value) {
  return total ? formatPercent((value / total) * 100) : '0%';
}

function slaLabel(value) {
  switch (value) {
    case 'overdue':
      return 'Vencidas';
    case 'warning':
      return 'Prazo crítico';
    case 'ontime':
      return 'No prazo';
    case 'closed':
      return 'Fechadas';
    default:
      return 'Sem SLA';
  }
}

function formatShortDate(value) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatShortDay(value) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit'
  }).format(new Date(value));
}

function formatMonthLabel(year, monthIndex) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: 'numeric'
  }).format(new Date(year, monthIndex, 1));
}

function toDateOrNull(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value) {
  const date = toDateOrNull(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  const date = toDateOrNull(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function diffInDaysInclusive(start, end) {
  const startDate = startOfDay(start);
  const endDate = startOfDay(end);
  if (!startDate || !endDate) return 0;
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

function formatDecimal(value, digits = 1) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDaysMetric(value) {
  if (!Number.isFinite(value) || value <= 0) return '0,0 dia';
  const safeValue = Math.max(0, value);
  return `${formatDecimal(safeValue, safeValue >= 10 ? 0 : 1)} dia${safeValue >= 1.5 ? 's' : ''}`;
}

function resolutionDateForItem(item) {
  if (item?.status !== 'resolvida') return null;
  return toDateOrNull(item?.closed_at || item?.resolved_at || item?.updated_at);
}

function startOfWeek(value) {
  const date = startOfDay(value);
  if (!date) return null;
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function buildTimelineBuckets(items, granularity) {
  const buckets = new Map();

  items.forEach((item) => {
    const createdAt = toDateOrNull(item.created_at);
    if (!createdAt) return;

    let key = '';
    let label = '';

    if (granularity === 'day') {
      key = startOfDay(createdAt).toISOString();
      label = formatShortDay(createdAt);
    } else if (granularity === 'week') {
      const weekStart = startOfWeek(createdAt);
      key = weekStart.toISOString();
      label = `Sem ${formatShortDay(weekStart)}`;
    } else {
      key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      label = formatMonthLabel(createdAt.getFullYear(), createdAt.getMonth());
    }

    const current = buckets.get(key) || { label, total: 0 };
    current.total += 1;
    buckets.set(key, current);
  });

  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
}

function buildLineData(rows, label, color = '#0b6f5f', fill = true) {
  return {
    labels: rows.map((row) => row.label),
    datasets: [{
      label,
      data: rows.map((row) => row.total),
      borderColor: color,
      backgroundColor: fill ? `${color}22` : color,
      fill,
      tension: 0.32,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 3
    }]
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildDeadlineInfo(item) {
  if (item.status === 'resolvida') return 'closed';
  const dueAt = item.due_at ? new Date(item.due_at) : null;

  if (!dueAt || Number.isNaN(dueAt.getTime())) return 'neutral';

  const diffMs = dueAt.getTime() - Date.now();

  if (diffMs < 0) return 'overdue';
  if (diffMs <= 12 * 60 * 60 * 1000) return 'warning';
  return 'ontime';
}

function priorityLabel(value) {
  return priorityOptions.find((option) => option.value === value)?.label || value || 'Não informado';
}

function serviceLabel(value) {
  return serviceTypes.find((option) => option.value === value)?.label || value || 'Não informado';
}

function lastComplaintActor(item) {
  return item?.logs?.[0]?.actor_name
    || item?.treatment_by_name
    || item?.patient_contacted_by
    || item?.first_attendance_by
    || item?.sac_approval_by
    || item?.supervisor_approval_by
    || item?.forwarded_to_label
    || 'Sem tratativa';
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom'
    }
  }
};

function Dashboard() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => readUser(), []);
  const currentUserRole = normalizeRoleValue(currentUser?.role);
  const canViewCollaboratorWorkload = isMasterAdmin(currentUser)
    || isAdmin(currentUser)
    || currentUserRole === 'manager';
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [evolutionGranularity, setEvolutionGranularity] = useState('month');

  useEffect(() => {
    const loadRows = async () => {
      setLoading(true);
      setFeedback('');

      try {
        const [complaintsRes, clinicsRes] = await Promise.all([
          api.get('/complaints'),
          api.get('/clinics')
        ]);
        setRows(Array.isArray(complaintsRes.data) ? complaintsRes.data : []);
        setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      } catch (error) {
        setFeedback('Não foi possível carregar os indicadores.');
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, []);

  const options = useMemo(() => ({
    clinics: mergeValues(uniqueValues(clinics, 'name'), uniqueValues(rows, 'clinic_name')),
    cities: mergeValues(uniqueValues(clinics, 'city'), uniqueValues(rows, 'city')),
    states: mergeValues(uniqueValues(clinics, 'state'), uniqueValues(rows, 'state')),
    regions: mergeValues(uniqueValues(clinics, 'region'), uniqueValues(rows, 'region')),
    coordinators: mergeValues(uniqueValues(clinics, 'coordinator_name'), uniqueValues(rows, 'coordinator_name')),
    types: mergeValues(complaintTypes.map((item) => item.label), uniqueValues(rows, 'complaint_type')),
    channels: orderOtherLast(dedupeDisplayValues(mergeValues(channels.map((item) => item.label), uniqueValues(rows, 'channel')))),
    years: Array.from(new Set(rows
      .map((row) => toDateOrNull(row.created_at)?.getFullYear())
      .filter(Boolean)))
      .sort((a, b) => b - a)
      .map((year) => String(year))
  }), [clinics, rows]);

  const filteredRows = useMemo(() => rows.filter((item) => {
    const createdAt = toDateOrNull(item.created_at);
    const startDate = filters.startDate ? startOfDay(`${filters.startDate}T00:00:00`) : null;
    const endDate = filters.endDate ? endOfDay(`${filters.endDate}T23:59:59`) : null;
    const createdYear = createdAt ? String(createdAt.getFullYear()) : '';
    const createdMonth = createdAt ? String(createdAt.getMonth() + 1).padStart(2, '0') : '';
    const searchable = [
      item.protocol,
      item.patient_name,
      item.patient_phone,
      item.description,
      item.clinic_name,
      item.city,
      item.state,
      item.region,
      item.coordinator_name,
      item.complaint_type,
      item.channel
    ].map(normalizeText).join(' ');

    return (
      (!filters.clinic || item.clinic_name === filters.clinic)
      && (!filters.city || item.city === filters.city)
      && (!filters.state || item.state === filters.state)
      && (!filters.region || item.region === filters.region)
      && (!filters.coordinator || item.coordinator_name === filters.coordinator)
      && (!filters.status || item.status === filters.status)
      && (!filters.type || item.complaint_type === filters.type)
      && (!filters.priority || item.priority === filters.priority)
      && (!filters.channel || item.channel === filters.channel)
      && (!filters.sla || buildDeadlineInfo(item) === filters.sla)
      && (!filters.year || createdYear === filters.year)
      && (!filters.month || createdMonth === filters.month)
      && (!startDate || (createdAt && createdAt >= startDate))
      && (!endDate || (createdAt && createdAt <= endDate))
      && (!filters.search || searchable.includes(normalizeText(filters.search)))
    );
  }), [rows, filters]);

  const metrics = useMemo(() => {
    const total = filteredRows.length;
    const closed = filteredRows.filter((item) => item.status === 'resolvida').length;
    const opened = filteredRows.filter((item) => item.status === 'aberta').length;
    const inProgress = filteredRows.filter((item) => item.status === 'em_andamento').length;
    const overdue = filteredRows.filter((item) => buildDeadlineInfo(item) === 'overdue').length;
    const warning = filteredRows.filter((item) => buildDeadlineInfo(item) === 'warning').length;
    const open = filteredRows.filter((item) => item.status !== 'resolvida').length;
    const createdDates = filteredRows
      .map((item) => startOfDay(item.created_at))
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime());
    const resolvedRows = filteredRows.filter((item) => resolutionDateForItem(item) && toDateOrNull(item.created_at));
    const shelfLifeDays = resolvedRows.map((item) => {
      const createdAt = startOfDay(item.created_at);
      const resolvedAt = startOfDay(resolutionDateForItem(item));
      return createdAt && resolvedAt ? diffInDaysInclusive(createdAt, resolvedAt) : 0;
    }).filter((value) => value > 0);
    const openAgingDays = filteredRows
      .filter((item) => item.status !== 'resolvida' && toDateOrNull(item.created_at))
      .map((item) => diffInDaysInclusive(item.created_at, new Date()));
    const periodStart = filters.startDate
      ? startOfDay(`${filters.startDate}T00:00:00`)
      : createdDates[0] || null;
    const periodEnd = filters.endDate
      ? endOfDay(`${filters.endDate}T23:59:59`)
      : createdDates[createdDates.length - 1] || null;
    const periodDays = periodStart && periodEnd ? diffInDaysInclusive(periodStart, periodEnd) : 0;
    const distinctDays = new Set(createdDates.map((date) => date.toISOString().slice(0, 10))).size;
    const avgPerDay = periodDays ? total / periodDays : 0;
    const avgShelfLifeDays = shelfLifeDays.length
      ? shelfLifeDays.reduce((sum, value) => sum + value, 0) / shelfLifeDays.length
      : 0;
    const avgOpenAgingDays = openAgingDays.length
      ? openAgingDays.reduce((sum, value) => sum + value, 0) / openAgingDays.length
      : 0;

    return {
      total,
      open,
      opened,
      inProgress,
      closed,
      overdue,
      warning,
      closeRate: total ? (closed / total) * 100 : 0,
      distinctDays,
      periodDays,
      avgPerDay,
      avgShelfLifeDays,
      avgOpenAgingDays,
      resolvedCount: resolvedRows.length
    };
  }, [filteredRows, filters.startDate, filters.endDate]);

  const searchSuggestions = useMemo(() => (
    mergeValues(
      uniqueValues(rows, 'protocol'),
      uniqueValues(rows, 'patient_name'),
      uniqueValues(rows, 'clinic_name'),
      uniqueValues(rows, 'city'),
      uniqueValues(rows, 'complaint_type')
    ).slice(0, 120)
  ), [rows]);

  const byStatus = useMemo(() => groupCount(filteredRows, (item) => statusLabels[item.status] || item.status), [filteredRows]);
  const byType = useMemo(() => groupCount(filteredRows, (item) => item.complaint_type).slice(0, 10), [filteredRows]);
  const byService = useMemo(() => groupCount(filteredRows, (item) => serviceLabel(item.service_type)).slice(0, 10), [filteredRows]);
  const byClinic = useMemo(() => groupCount(filteredRows, (item) => item.clinic_name).slice(0, 10), [filteredRows]);
  const byCity = useMemo(() => groupCount(filteredRows, (item) => item.city).slice(0, 10), [filteredRows]);
  const byState = useMemo(() => groupCount(filteredRows, (item) => item.state).slice(0, 10), [filteredRows]);
  const byRegion = useMemo(() => groupCount(filteredRows, (item) => item.region), [filteredRows]);
  const byPriority = useMemo(() => groupCount(filteredRows, (item) => priorityLabel(item.priority)), [filteredRows]);
  const byChannel = useMemo(() => groupCount(filteredRows, (item) => item.channel).slice(0, 10), [filteredRows]);
  const byCoordinator = useMemo(() => groupCount(filteredRows, (item) => item.coordinator_name).slice(0, 10), [filteredRows]);
  const bySla = useMemo(() => groupCount(filteredRows, (item) => slaLabel(buildDeadlineInfo(item))), [filteredRows]);
  const evolutionSeries = useMemo(
    () => buildTimelineBuckets(filteredRows, evolutionGranularity),
    [filteredRows, evolutionGranularity]
  );
  const treatmentLifecycle = useMemo(() => ([
    { label: 'Abertas', total: filteredRows.filter((item) => item.status === 'aberta').length },
    { label: 'Em andamento', total: filteredRows.filter((item) => item.status === 'em_andamento').length },
    { label: 'Resolvidas', total: filteredRows.filter((item) => item.status === 'resolvida').length }
  ]), [filteredRows]);
  const baseRows = useMemo(() => filteredRows, [filteredRows]);
  const baseExportRows = useMemo(() => baseRows.map((item) => {
    const deadline = buildDeadlineInfo(item);

    return {
      protocolo: item.protocol || item.id,
      paciente: item.patient_name || 'Não informado',
      telefone: item.patient_phone || 'Telefone não informado',
      unidade: item.clinic_name || 'Unidade não informada',
      localizacao: `${item.city || 'Cidade não informada'} / ${item.state || 'UF'} - ${item.region || 'Região não informada'}`,
      classificacao: item.complaint_type || 'Não informado',
      detalhe_classificacao: item.complaint_type_other || '',
      prioridade_origem: `${priorityLabel(item.priority)} - ${item.created_origin || 'Interno'}`,
      status: statusLabels[item.status] || item.status || 'Aberta',
      prazo: deadline === 'overdue' ? 'Vencida' : deadline === 'warning' ? 'Perto de vencer' : deadline === 'closed' ? 'Fechada' : 'No prazo',
      responsavel: item.coordinator_name || 'Não vinculado',
      encaminhamento: item.forwarded_to_label || 'Sem encaminhamento',
      ultima_tratativa: lastComplaintActor(item),
      especialidade: item.service_type || 'Sem especialidade informada',
      detalhe_servico: item.service_type_other || '',
      sla_agendamento: item.appointment_sla_active ? formatShortDate(item.appointment_due_at) : '',
      cadastro: formatShortDate(item.created_at)
    };
  }), [baseRows]);
  const baseTableHighlights = useMemo(() => {
    const units = new Set(filteredRows.map((item) => item.clinic_name).filter(Boolean)).size;
    const coordinators = new Set(filteredRows.map((item) => item.coordinator_name).filter(Boolean)).size;
    const highPriority = filteredRows.filter((item) => item.priority === 'alta').length;
    const overdue = filteredRows.filter((item) => buildDeadlineInfo(item) === 'overdue').length;

    return [
      { label: 'Protocolos', value: filteredRows.length },
      { label: 'Unidades', value: units },
      { label: 'Coordenadores', value: coordinators },
      { label: 'Alta prioridade', value: highPriority },
      { label: 'Vencidos', value: overdue }
    ];
  }, [filteredRows]);

  const serviceHighlights = useMemo(() => {
    const total = filteredRows.length || 1;

    return byService.slice(0, 4).map((item) => {
      const matchingRows = filteredRows.filter((row) => serviceLabel(row.service_type) === item.label);
      return {
        ...item,
        share: Math.round((item.total / total) * 100),
        overdue: matchingRows.filter((row) => buildDeadlineInfo(row) === 'overdue').length,
        inProgress: matchingRows.filter((row) => row.status === 'em_andamento').length
      };
    });
  }, [byService, filteredRows]);

  const coordinatorHighlights = useMemo(() => {
    const total = filteredRows.length || 1;

    return byCoordinator.slice(0, 8).map((item) => {
      const matchingRows = filteredRows.filter((row) => (row.coordinator_name || 'Não informado') === item.label);
      return {
        ...item,
        share: Math.round((item.total / total) * 100),
        overdue: matchingRows.filter((row) => buildDeadlineInfo(row) === 'overdue').length,
        inProgress: matchingRows.filter((row) => row.status === 'em_andamento').length
      };
    });
  }, [byCoordinator, filteredRows]);

  useEffect(() => {
    setTablePage(1);
  }, [filteredRows]);

  const totalTablePages = Math.max(1, Math.ceil(baseRows.length / tablePageSize));
  const currentTablePage = Math.min(tablePage, totalTablePages);
  const paginatedBaseRows = useMemo(() => {
    const start = (currentTablePage - 1) * tablePageSize;
    return baseRows.slice(start, start + tablePageSize);
  }, [baseRows, currentTablePage, tablePageSize]);
  const tableStart = baseRows.length ? (currentTablePage - 1) * tablePageSize + 1 : 0;
  const tableEnd = baseRows.length ? Math.min(currentTablePage * tablePageSize, baseRows.length) : 0;

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const applyFilters = (updates = {}) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  };

  const toggleCoordinatorFilter = (label) => {
    setFilters((prev) => ({
      ...prev,
      coordinator: prev.coordinator === label ? '' : label
    }));
  };

  const exportBaseExcel = () => {
    const headers = Object.keys(baseExportRows[0] || {
      protocolo: '',
      paciente: '',
      telefone: '',
      unidade: '',
      localizacao: '',
      classificacao: '',
      prioridade_origem: '',
      status: '',
      prazo: '',
      responsavel: '',
      encaminhamento: '',
      ultima_tratativa: '',
      especialidade: '',
      cadastro: ''
    });
    const html = `
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${baseExportRows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    `;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dashboard-reclamacoes-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportBasePdf = () => {
    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setFeedback('Permita pop-ups para gerar o PDF.');
      return;
    }

    const printDate = new Date();
    const headers = ['Protocolo', 'Paciente', 'Unidade', 'Classificação', 'Status', 'Prazo', 'Responsável', 'Cadastro'];
    const rowsToPrint = baseExportRows.map((row) => [
      row.protocolo,
      `${row.paciente} | ${row.telefone}`,
      `${row.unidade} | ${row.localizacao}`,
      `${row.classificacao} | ${row.prioridade_origem}`,
      row.status,
      row.prazo,
      `${row.responsavel} | ${row.encaminhamento}`,
      row.cadastro
    ]);

    reportWindow.document.write(`
      <html>
        <head>
          <title>Dashboard de Reclamações</title>
          <style>
            @page { size: A4 landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Inter, Arial, sans-serif; color: #1f2937; background: #fff; }
            .report-shell { display: flex; flex-direction: column; gap: 18px; }
            .report-header { border: 1px solid #d9c4a0; border-radius: 14px; background: linear-gradient(135deg, #fffaf2 0%, #f6eddd 100%); padding: 20px 24px; }
            .report-header-top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
            .report-kicker { margin: 0 0 8px; color: #9a6b22; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
            h1 { margin: 0 0 6px; font-size: 26px; line-height: 1.12; color: #111827; }
            .report-subtitle { margin: 0; color: #5b6472; font-size: 13px; }
            .report-meta, .summary-card { border: 1px solid #e6d6bd; border-radius: 12px; background: rgba(255,255,255,.92); padding: 14px 16px; }
            .report-meta strong, .summary-card strong { display: block; margin-bottom: 4px; color: #8a632d; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
            .report-meta span, .summary-card span { display: block; color: #111827; font-size: 14px; font-weight: 700; }
            .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
            .report-table-wrap { border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
            thead th { background: #132238; color: #f8fafc; padding: 10px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
            tbody td { border-top: 1px solid #e5e7eb; padding: 9px 8px; vertical-align: top; word-break: break-word; }
            tbody tr:nth-child(even) td { background: #faf7f2; }
          </style>
        </head>
        <body>
          <main class="report-shell">
            <section class="report-header">
              <div class="report-header-top">
                <div>
                  <p class="report-kicker">Grupo Sorria · Dashboard de Reclamações</p>
                  <h1>Relação analítica filtrada</h1>
                  <p class="report-subtitle">Exportação da base operacional exibida na parte inferior do dashboard.</p>
                </div>
                <div class="report-meta">
                  <strong>Emitido em</strong>
                  <span>${escapeHtml(printDate.toLocaleString('pt-BR'))}</span>
                </div>
              </div>
            </section>
            <section class="summary-grid">
              <article class="summary-card"><strong>Registros exportados</strong><span>${escapeHtml(String(baseExportRows.length))}</span></article>
              <article class="summary-card"><strong>Base filtrada</strong><span>${escapeHtml(String(filteredRows.length))}</span></article>
              <article class="summary-card"><strong>Clínica</strong><span>${escapeHtml(filters.clinic || 'Todas')}</span></article>
              <article class="summary-card"><strong>Status</strong><span>${escapeHtml(filters.status || 'Todos')}</span></article>
            </section>
            <section class="report-table-wrap">
              <table>
                <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
                <tbody>${rowsToPrint.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
              </table>
            </section>
          </main>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
  };

  return (
    <main className="app-page complaints-dashboard-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Dashboard de Reclamações</h1>
          <p>Combine filtros para analisar por unidade, localidade, classificação, criticidade e prazo.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/gestao')}>
            Gestão
          </button>
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
        </div>
      </header>

      <section className="dashboard-filter-panel">
        <div className="dashboard-filter-heading">
          <div>
            <p className="eyebrow">Filtros</p>
            <h2>Recorte executivo da carteira</h2>
            <p className="base-subtitle">Cruze filtros operacionais com mes, ano e periodo para ler a pressao real das reclamacoes.</p>
          </div>
          <button className="outline-action" onClick={() => setFilters(initialFilters)}>
            Limpar filtros
          </button>
        </div>

        <div className="dashboard-filters">
          <div className="search-field">
            <input
              className="field"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Buscar protocolo, paciente, clínica ou relato"
              list="dashboard-search-suggestions"
            />
            <button type="button" aria-label="Buscar" onClick={() => updateFilter('search', filters.search.trim())}>🔎</button>
            <datalist id="dashboard-search-suggestions">
              {searchSuggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <select className="field" value={filters.clinic} onChange={(event) => updateFilter('clinic', event.target.value)}>
            <option value="">Todas as clínicas</option>
            {options.clinics.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.region} onChange={(event) => updateFilter('region', event.target.value)}>
            <option value="">Todas as regiões</option>
            {options.regions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.state} onChange={(event) => updateFilter('state', event.target.value)}>
            <option value="">Todos os estados</option>
            {options.states.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.city} onChange={(event) => updateFilter('city', event.target.value)}>
            <option value="">Todas as cidades</option>
            {options.cities.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.coordinator} onChange={(event) => updateFilter('coordinator', event.target.value)}>
            <option value="">Todos os coordenadores</option>
            {options.coordinators.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">Todos os status</option>
            {statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <select className="field" value={filters.type} onChange={(event) => updateFilter('type', event.target.value)}>
            <option value="">Todos os tipos</option>
            {options.types.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.priority} onChange={(event) => updateFilter('priority', event.target.value)}>
            <option value="">Todas as prioridades</option>
            {priorityOptions.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
          </select>
          <select className="field" value={filters.channel} onChange={(event) => updateFilter('channel', event.target.value)}>
            <option value="">Todos os canais</option>
            {options.channels.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.sla} onChange={(event) => updateFilter('sla', event.target.value)}>
            <option value="">Todos os prazos</option>
            <option value="overdue">Vencidas</option>
            <option value="warning">Perto de vencer</option>
            <option value="ontime">No prazo</option>
            <option value="closed">Fechadas</option>
          </select>
          <select className="field" value={filters.year} onChange={(event) => updateFilter('year', event.target.value)}>
            <option value="">Todos os anos</option>
            {options.years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="field" value={filters.month} onChange={(event) => updateFilter('month', event.target.value)}>
            <option value="">Todos os meses</option>
            {monthOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input className="field" type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
          <input className="field" type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
        </div>
      </section>

      {feedback && <p className="form-feedback">{feedback}</p>}

      <section className="kpi-grid dashboard-kpi-grid" aria-label="Resumo filtrado">
        <button className="kpi-card kpi-button" type="button" onClick={() => setFilters(initialFilters)}>
          <span>Total filtrado</span>
          <strong>{metrics.total}</strong>
          <p>{percentOf(rows.length, metrics.total)} DA BASE TOTAL</p>
        </button>
        <article className="kpi-card dashboard-insight-card">
          <span>Media por dia</span>
          <strong>{formatDecimal(metrics.avgPerDay)}</strong>
          <p>{metrics.periodDays || 0} dias avaliados no recorte</p>
        </article>
        <article className="kpi-card dashboard-insight-card">
          <span>Shelf life medio</span>
          <strong>{formatDaysMetric(metrics.avgShelfLifeDays)}</strong>
          <p>{metrics.resolvedCount} demandas resolvidas no calculo</p>
        </article>
        <article className="kpi-card dashboard-insight-card">
          <span>Backlog medio</span>
          <strong>{formatDaysMetric(metrics.avgOpenAgingDays)}</strong>
          <p>{metrics.open} protocolos ainda em aberto</p>
        </article>
        <button className="kpi-card warning kpi-button" type="button" onClick={() => updateFilter('status', 'aberta')}>
          <span>Abertas</span>
          <strong>{metrics.opened}</strong>
          <p>{percentOf(metrics.total, metrics.opened)} DO CENÁRIO</p>
        </button>
        <button className="kpi-card progress kpi-button" type="button" onClick={() => updateFilter('status', 'em_andamento')}>
          <span>Em andamento</span>
          <strong>{metrics.inProgress}</strong>
          <p>{percentOf(metrics.total, metrics.inProgress)} DO CENÁRIO</p>
        </button>
        <button className="kpi-card danger kpi-button" type="button" onClick={() => updateFilter('sla', 'overdue')}>
          <span>Vencidas</span>
          <strong>{metrics.overdue}</strong>
          <p>{percentOf(metrics.total, metrics.overdue)} DO CENÁRIO</p>
        </button>
        <button className="kpi-card success kpi-button" type="button" onClick={() => updateFilter('status', 'resolvida')}>
          <span>Fechadas</span>
          <strong>{metrics.closed}</strong>
          <p>{formatPercent(metrics.closeRate)} DE RESOLUÇÃO</p>
        </button>
      </section>

      {loading ? (
        <section className="management-panel">
          <p className="empty-state">Carregando indicadores...</p>
        </section>
      ) : (
        <>
          <section className="management-panel dashboard-stage-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Visao executiva</p>
                <h2>Panorama principal da operacao</h2>
                <p className="base-subtitle">Os indicadores mais importantes ficam agrupados primeiro para leitura rapida e tomada de decisao.</p>
              </div>
            </div>

            <div className="chart-grid dashboard-chart-grid dashboard-chart-grid-executive">
            <article className="chart-card dashboard-evolution-card large">
              <div className="dashboard-section-head">
                <div>
                  <p className="eyebrow">Evolucao</p>
                  <h2>Ritmo das reclamacoes por dia, semana e mes</h2>
                  <p className="base-subtitle">Alterne a granularidade para enxergar sazonalidade, picos de demanda e tendencia operacional no mesmo dashboard.</p>
                </div>
                <div className="dashboard-segmented-control" role="tablist" aria-label="Granularidade da evolucao">
                  {evolutionGranularityOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={evolutionGranularity === item.value ? 'active' : ''}
                      onClick={() => setEvolutionGranularity(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dashboard-type-highlight-grid dashboard-executive-highlight-grid">
                <article className="dashboard-type-highlight-card">
                  <span>Dias com volume</span>
                  <strong>{metrics.distinctDays}</strong>
                  <p>dias com reclamacoes registradas</p>
                </article>
                <article className="dashboard-type-highlight-card">
                  <span>Resolucao</span>
                  <strong>{formatPercent(metrics.closeRate)}</strong>
                  <p>taxa de encerramento no recorte</p>
                </article>
                <article className="dashboard-type-highlight-card">
                  <span>Prazos criticos</span>
                  <strong>{metrics.warning + metrics.overdue}</strong>
                  <p>demandas em alerta ou vencidas</p>
                </article>
                <article className="dashboard-type-highlight-card">
                  <span>Periodo</span>
                  <strong>{metrics.periodDays || 0}</strong>
                  <p>dias corridos analisados</p>
                </article>
              </div>

              <div className="dashboard-inner-grid">
                <div className="chart-box">
                  <Line data={buildLineData(evolutionSeries, 'Volume de reclamacoes', '#0b6f5f')} options={chartOptions} />
                </div>
                <div className="chart-box">
                  <Bar data={buildBarData(treatmentLifecycle, '#8a4f7d')} options={chartOptions} />
                </div>
              </div>
            </article>

            <article className="chart-card dashboard-resolution-card">
              <div className="dashboard-section-head">
                <div>
                  <p className="eyebrow">Tratativas</p>
                  <h2>Shelf life medio das resolucoes</h2>
                  <p className="base-subtitle">Tempo medio gasto entre a abertura e o encerramento definitivo das demandas selecionadas.</p>
                </div>
              </div>

              <div className="dashboard-resolution-grid">
                <article className="dashboard-summary-card">
                  <span>Media de resolucao</span>
                  <strong>{formatDaysMetric(metrics.avgShelfLifeDays)}</strong>
                  <p>tempo medio para concluir a demanda</p>
                </article>
                <article className="dashboard-summary-card">
                  <span>Resolvidas no periodo</span>
                  <strong>{metrics.resolvedCount}</strong>
                  <p>base usada no calculo do shelf life</p>
                </article>
                <article className="dashboard-summary-card">
                  <span>Backlog aberto</span>
                  <strong>{metrics.open}</strong>
                  <p>protocolos ainda exigindo tratativa</p>
                </article>
              </div>
            </article>
            </div>
          </section>

          <section className="management-panel dashboard-stage-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Leituras analiticas</p>
                <h2>Classificacao, status e servicos</h2>
                <p className="base-subtitle">A demanda deixa de ficar espalhada e passa a ser lida por blocos analiticos coerentes.</p>
              </div>
            </div>

            <div className="chart-grid dashboard-chart-grid dashboard-chart-grid-analytics">
            <article className="chart-card dashboard-type-intelligence-card large">
              <div className="dashboard-section-head">
                <div>
                  <p className="eyebrow">Serviço envolvido</p>
                  <h2>Radar dos serviços envolvidos</h2>
                  <p className="base-subtitle">Resumo executivo por serviço, com participação na carteira, volume em andamento e pressão de atraso.</p>
                </div>
              </div>

              <div className="dashboard-type-highlight-grid">
                {serviceHighlights.length ? serviceHighlights.map((item) => (
                  <article className="dashboard-type-highlight-card" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.total}</strong>
                    <p>{item.share}% da carteira filtrada</p>
                    <small>{item.inProgress} em andamento · {item.overdue} vencidas</small>
                  </article>
                )) : (
                  <p className="empty-state">Sem volume suficiente para leitura por serviço.</p>
                )}
              </div>

              <div className="dashboard-inner-grid">
                <div className="chart-box">
                  <Bar data={buildBarData(byService)} options={chartOptions} />
                </div>
                <div className="chart-box">
                  <Doughnut data={buildDoughnutData(bySla)} options={chartOptions} />
                </div>
              </div>
            </article>

            <article className="chart-card status-chart-card">
              <h2>Status das reclamações</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byStatus)} options={chartOptions} />
              </div>
            </article>
            </div>
          </section>

          <section className="management-panel dashboard-stage-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Distribuicao operacional</p>
                <h2>Territorio, prioridade, canal e SLA</h2>
                <p className="base-subtitle">Os cortes de distribuicao ficam agrupados para reduzir ruido e facilitar a leitura territorial e de criticidade.</p>
              </div>
            </div>

            <div className="chart-grid dashboard-chart-grid dashboard-chart-grid-territory">
            <article className="chart-card">
              <h2>Classificação da ocorrência</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byType)} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Volume por clínica</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byClinic, '#1f7a8c')} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Volume por cidade</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byCity, '#4c956c')} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Volume por estado</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byState, '#d08c31')} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Volume por região</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byRegion)} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Prioridade</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(byPriority)} options={chartOptions} />
              </div>
            </article>

            <article className="chart-card">
              <h2>Canal de entrada</h2>
              <div className="chart-box">
                <Bar data={buildBarData(byChannel, '#5d6d7e')} options={chartOptions} />
              </div>
            </article>
            </div>
          </section>

          <section className="management-panel dashboard-stage-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Ownership</p>
                <h2>Responsaveis e parceiros pressionados</h2>
                <p className="base-subtitle">Os graficos de ownership ficam isolados para facilitar a leitura de responsabilizacao e carga da carteira.</p>
              </div>
            </div>

            <div className="chart-grid dashboard-chart-grid dashboard-chart-grid-ownership">

            {canViewCollaboratorWorkload && (
              <>
                <article className="chart-card">
                  <h2>Carteira por parceiro</h2>
                  <div className="chart-box">
                    <Bar data={buildBarData(byCoordinator, '#8a4f7d')} options={chartOptions} />
                  </div>
                </article>
              </>
            )}
            <article className="chart-card">
              <h2>Leitura de SLA</h2>
              <div className="chart-box">
                <Doughnut data={buildDoughnutData(bySla)} options={chartOptions} />
              </div>
            </article>

            {canViewCollaboratorWorkload && (
              <article className="chart-card dashboard-coordinator-card">
                <div className="dashboard-section-head">
                  <div>
                    <p className="eyebrow">Parceiros</p>
                    <h2>Parceiros com mais reclamações</h2>
                    <p className="base-subtitle">Clique no nome do parceiro para filtrar a carteira e aprofundar a análise do responsável.</p>
                  </div>
                </div>
                <div className="dashboard-coordinator-list">
                  {coordinatorHighlights.length ? coordinatorHighlights.map((item, index) => (
                    <article className="dashboard-coordinator-item" key={item.label}>
                      <div className="dashboard-coordinator-rank">{String(index + 1).padStart(2, '0')}</div>
                      <div className="dashboard-coordinator-copy">
                        <button
                          className="dashboard-inline-filter"
                          type="button"
                          onClick={() => toggleCoordinatorFilter(item.label)}
                        >
                          {item.label}
                        </button>
                        <span>{item.total} reclamações · {item.share}% da carteira filtrada</span>
                      </div>
                      <div className="dashboard-coordinator-meta">
                        <span>{item.inProgress} em andamento</span>
                        <span>{item.overdue} vencidas</span>
                      </div>
                    </article>
                  )) : (
                    <p className="empty-state">Sem parceiros vinculados na base filtrada.</p>
                  )}
                </div>
              </article>
            )}
            </div>
          </section>

          <section className="management-panel dashboard-base-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Base filtrada</p>
                <h2 className="table-title-with-help">
                  Registros do cenário selecionado
                  <span className="tooltip-help inline-help" tabIndex="0" aria-label="Horário de Brasília">
                    ?
                    <span>O horário exibido segue o horário oficial de Brasília.</span>
                  </span>
                </h2>
                <p className="base-subtitle">{filteredRows.length} protocolos na seleção atual.</p>
              </div>
              <div className="export-actions">
                <button className="outline-action" onClick={exportBaseExcel} disabled={!baseExportRows.length}>
                  <span className="export-badge excel">XLS</span>
                  <span>Baixar Excel</span>
                </button>
                <button className="outline-action" onClick={exportBasePdf} disabled={!baseExportRows.length}>
                  <span className="export-badge pdf">PDF</span>
                  <span>Baixar PDF</span>
                </button>
              </div>
            </div>

            <div className="dashboard-base-summary">
              {baseTableHighlights.map((item) => {
                let onClick = () => {};
                if (item.label === 'Protocolos') onClick = () => applyFilters({ status: '', sla: '' });
                if (item.label === 'Unidades') onClick = () => applyFilters({ clinic: '' });
                if (item.label === 'Coordenadores') onClick = () => applyFilters({ coordinator: '' });
                if (item.label === 'Alta prioridade') onClick = () => applyFilters({ priority: 'alta' });
                if (item.label === 'Vencidos') onClick = () => applyFilters({ sla: 'overdue' });

                return (
                <button className="dashboard-summary-card dashboard-summary-button" key={item.label} type="button" onClick={onClick}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </button>
                );
              })}
            </div>

            <div className="data-table-wrap dashboard-table-wrap">
              <table className="data-table dashboard-clean-table">
                <thead>
                  <tr>
                    <th>Protocolo</th>
                    <th>Paciente</th>
                    <th>Unidade e localização</th>
                    <th>Classificação</th>
                    <th>Status e prazo</th>
                    <th>Responsável</th>
                    <th>Última tratativa por</th>
                    <th>Cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedBaseRows.map((item) => {
                    const deadline = buildDeadlineInfo(item);

                    return (
                    <tr key={item.id}>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.protocol || item.id}</span>
                          <span className="cell-secondary">{item.channel || 'Canal não informado'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.patient_name || 'Não informado'}</span>
                          <span className="cell-secondary">{item.patient_phone || 'Telefone não informado'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.clinic_name || 'Unidade não informada'}</span>
                          <span className="cell-secondary">{item.city || 'Cidade não informada'} / {item.state || 'UF'} - {item.region || 'Região não informada'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.complaint_type || 'Não informado'}</span>
                          <span className="cell-secondary">{priorityLabel(item.priority)} - {item.created_origin || 'Interno'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className={`status-pill ${item.status || 'aberta'}`}>
                            {statusLabels[item.status] || item.status || 'Aberta'}
                          </span>
                          <span className={`deadline-chip ${deadline}`}>
                            {deadline === 'overdue' ? 'Vencida' : deadline === 'warning' ? 'Perto de vencer' : deadline === 'closed' ? 'Fechada' : 'No prazo'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{item.coordinator_name || 'Não vinculado'}</span>
                          <span className="cell-secondary">{item.forwarded_to_label || 'Sem encaminhamento'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{lastComplaintActor(item)}</span>
                          <span className="cell-secondary">{item.service_type || 'Sem especialidade informada'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          <span className="cell-primary">{formatShortDate(item.created_at)}</span>
                          <span className="cell-secondary">{item.created_origin || 'Interno'}</span>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination-bar">
              <div className="pagination-summary">
                <label className="pagination-page-size">
                  <span>Por pagina</span>
                  <select
                    className="field"
                    value={tablePageSize}
                    onChange={(event) => {
                      setTablePageSize(Number(event.target.value));
                      setTablePage(1);
                    }}
                  >
                    {pageSizeOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <span>Mostrando {tableStart} a {tableEnd} de {baseRows.length} registros</span>
              </div>

              <div className="pagination-actions">
                <button
                  className="outline-action"
                  type="button"
                  onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}
                  disabled={currentTablePage <= 1}
                >
                  Anterior
                </button>
                <strong>Página {currentTablePage} de {totalTablePages}</strong>
                <button
                  className="outline-action"
                  type="button"
                  onClick={() => setTablePage((prev) => Math.min(totalTablePages, prev + 1))}
                  disabled={currentTablePage >= totalTablePages}
                >
                  Proxima
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default Dashboard;
