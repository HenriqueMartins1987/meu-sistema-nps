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
const executiveReportPeriodOptions = [
  { value: 'all', label: 'Diario, semanal e mensal' },
  { value: 'day', label: 'Somente diario' },
  { value: 'week', label: 'Somente semanal' },
  { value: 'month', label: 'Somente mensal' }
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

function formatDateOnly(value) {
  if (!value) return 'Nao informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nao informado';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatPeriodRange(start, end) {
  return `${formatDateOnly(start)} a ${formatDateOnly(end)}`;
}

function getCurrentPeriodRange(period) {
  const now = new Date();
  if (period === 'day') {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (period === 'week') {
    const start = startOfWeek(now);
    return { start, end: endOfDay(addDays(start, 6)) };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function isWithinPeriod(item, range) {
  const createdAt = toDateOrNull(item?.created_at);
  return Boolean(createdAt && range?.start && range?.end && createdAt >= range.start && createdAt <= range.end);
}

function isDateValueWithinPeriod(value, range) {
  const date = toDateOrNull(value);
  return Boolean(date && range?.start && range?.end && date >= range.start && date <= range.end);
}

function getComplaintReasonLabel(item) {
  const type = item?.complaint_type_other
    ? `${item.complaint_type || 'Outros'}: ${item.complaint_type_other}`
    : item?.complaint_type;
  return type || item?.description || 'Nao informado';
}

function getComplaintServiceLabel(item) {
  return item?.service_type_other
    ? `${item.service_type || 'Outros'}: ${item.service_type_other}`
    : (item?.service_type || 'Nao informado');
}

function getCurrentResponsibleName(item) {
  return (
    item?.assigned_responsible_name
    || item?.forwarded_to_label
    || item?.coordinator_name
    || item?.manager_name
    || 'Nao informado'
  );
}

function getPartnerLabel(item) {
  return item?.coordinator_name || 'Nao informado';
}

function getComplaintSummary(item, maxLength = 280) {
  const parts = [
    item?.description,
    item?.operator_comment ? `Obs. operador: ${item.operator_comment}` : '',
    item?.treatment_comment ? `Tratativa: ${item.treatment_comment}` : '',
    item?.sac_audit_comment ? `Auditoria SAC: ${item.sac_audit_comment}` : ''
  ].filter(Boolean);
  const text = parts.join(' | ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Resumo nao informado.';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function onlyPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatPhoneForDisplay(value) {
  const digits = onlyPhoneDigits(value);
  if (!digits) return 'Telefone nao cadastrado';
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value || 'Telefone nao cadastrado';
}

function buildPhoneBookNotification(contact) {
  return [
    `Alerta de reclamacoes - ${contact.clinicName}`,
    `Responsavel: ${contact.roleLabel} ${contact.name}`,
    `Cenario filtrado: ${contact.total} protocolo(s), ${contact.overdue} vencido(s), ${contact.warning} perto de vencer.`,
    'Por favor, priorizar a tratativa e atualizar o andamento no sistema.'
  ].join('\n');
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
    || currentUserRole === 'manager'
    || currentUserRole === 'sac_operator';
  const canAccessPhoneBook = isMasterAdmin(currentUser) || currentUserRole === 'sac_operator';
  const [rows, setRows] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [evolutionGranularity, setEvolutionGranularity] = useState('month');
  const [executiveReportPeriod, setExecutiveReportPeriod] = useState('all');
  const [showPhoneBook, setShowPhoneBook] = useState(false);

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
  const byReason = useMemo(() => groupCount(filteredRows, getComplaintReasonLabel).slice(0, 10), [filteredRows]);
  const byCity = useMemo(() => groupCount(filteredRows, (item) => item.city).slice(0, 10), [filteredRows]);
  const byState = useMemo(() => groupCount(filteredRows, (item) => item.state).slice(0, 10), [filteredRows]);
  const byRegion = useMemo(() => groupCount(filteredRows, (item) => item.region), [filteredRows]);
  const byPriority = useMemo(() => groupCount(filteredRows, (item) => priorityLabel(item.priority)), [filteredRows]);
  const byChannel = useMemo(() => groupCount(filteredRows, (item) => item.channel).slice(0, 10), [filteredRows]);
  const byCoordinatorAll = useMemo(() => groupCount(filteredRows, getPartnerLabel), [filteredRows]);
  const byCoordinator = useMemo(() => byCoordinatorAll.slice(0, 10), [byCoordinatorAll]);
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
      const matchingRows = filteredRows.filter((row) => getPartnerLabel(row) === item.label);
      return {
        ...item,
        share: Math.round((item.total / total) * 100),
        overdue: matchingRows.filter((row) => buildDeadlineInfo(row) === 'overdue').length,
        inProgress: matchingRows.filter((row) => row.status === 'em_andamento').length
      };
    });
  }, [byCoordinator, filteredRows]);

  const phoneBookContacts = useMemo(() => {
    const contacts = new Map();

    const addContact = (item, role, roleLabel, name, phone) => {
      if (!name) return;
      const clinicName = item.clinic_name || 'Unidade nao informada';
      const key = `${role}|${name}|${onlyPhoneDigits(phone)}|${clinicName}`;
      const existing = contacts.get(key) || {
        key,
        role,
        roleLabel,
        name,
        phone: phone || '',
        phoneDisplay: formatPhoneForDisplay(phone),
        clinicName,
        total: 0,
        overdue: 0,
        warning: 0,
        open: 0
      };
      const deadline = buildDeadlineInfo(item);
      existing.total += 1;
      if (deadline === 'overdue') existing.overdue += 1;
      if (deadline === 'warning') existing.warning += 1;
      if (item.status !== 'resolvida') existing.open += 1;
      contacts.set(key, existing);
    };

    filteredRows.forEach((item) => {
      addContact(item, 'coordinator', 'Coordenador(a)', item.coordinator_name, item.coordinator_phone);
      addContact(item, 'manager', 'Gerente', item.manager_name, item.manager_phone);
    });

    return Array.from(contacts.values())
      .sort((a, b) => (
        a.clinicName.localeCompare(b.clinicName, 'pt-BR')
        || a.roleLabel.localeCompare(b.roleLabel, 'pt-BR')
        || a.name.localeCompare(b.name, 'pt-BR')
      ));
  }, [filteredRows]);

  const partnerRankingDetails = useMemo(() => {
    const total = filteredRows.length || 1;

    return byCoordinatorAll.slice(0, 12).map((item, index) => {
      const matchingRows = filteredRows.filter((row) => getPartnerLabel(row) === item.label);
      const phones = Array.from(new Set(matchingRows.map((row) => row.coordinator_phone).filter(Boolean)));
      const clinicsServed = Array.from(new Set(matchingRows.map((row) => row.clinic_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

      return {
        ...item,
        rank: index + 1,
        share: Math.round((item.total / total) * 100),
        phone: phones[0] || '',
        phoneDisplay: formatPhoneForDisplay(phones[0]),
        clinicsServed,
        overdue: matchingRows.filter((row) => buildDeadlineInfo(row) === 'overdue').length,
        warning: matchingRows.filter((row) => buildDeadlineInfo(row) === 'warning').length,
        inProgress: matchingRows.filter((row) => row.status === 'em_andamento').length,
        classificationRows: groupCount(matchingRows, getComplaintReasonLabel).slice(0, 8),
        serviceRows: groupCount(matchingRows, getComplaintServiceLabel).slice(0, 6),
        statusRows: groupCount(matchingRows, (row) => statusLabels[row.status] || row.status).slice(0, 6),
        samples: matchingRows.slice(0, 6)
      };
    });
  }, [byCoordinatorAll, filteredRows]);

  const executiveReportSections = useMemo(() => {
    const periodConfig = [
      { key: 'day', label: 'Diario', range: getCurrentPeriodRange('day') },
      { key: 'week', label: 'Semanal', range: getCurrentPeriodRange('week') },
      { key: 'month', label: 'Mensal', range: getCurrentPeriodRange('month') }
    ];
    const selectedPeriods = executiveReportPeriod === 'all'
      ? periodConfig
      : periodConfig.filter((period) => period.key === executiveReportPeriod);

    return selectedPeriods.map((period) => {
      const periodRows = filteredRows.filter((item) => isWithinPeriod(item, period.range));
      const scheduledRows = filteredRows
        .filter((item) => (item.appointment_due_at || item.appointment_sla_active) && isDateValueWithinPeriod(item.appointment_due_at || item.due_at, period.range))
        .sort((a, b) => new Date(a.appointment_due_at || 0).getTime() - new Date(b.appointment_due_at || 0).getTime());
      const overdueRows = filteredRows
        .filter((item) => buildDeadlineInfo(item) === 'overdue' && isDateValueWithinPeriod(item.due_at || item.appointment_due_at, period.range))
        .sort((a, b) => new Date(a.due_at || 0).getTime() - new Date(b.due_at || 0).getTime());

      return {
        ...period,
        periodLabel: formatPeriodRange(period.range.start, period.range.end),
        rows: periodRows,
        rankingClinics: groupCount(periodRows, (item) => item.clinic_name).slice(0, 12),
        rankingReasons: groupCount(periodRows, getComplaintReasonLabel).slice(0, 12),
        scheduledRows,
        overdueRows
      };
    });
  }, [executiveReportPeriod, filteredRows]);

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

  const toggleFilter = (field, value, clearValue = '') => {
    setFilters((prev) => ({
      ...prev,
      [field]: prev[field] === value ? clearValue : value
    }));
  };

  const applyToggleFilters = (updates = {}) => {
    setFilters((prev) => {
      const entries = Object.entries(updates);
      const allActive = entries.length > 0 && entries.every(([field, value]) => prev[field] === value);
      const next = { ...prev };

      entries.forEach(([field, value]) => {
        next[field] = allActive ? '' : value;
      });

      return next;
    });
  };

  const clearFilters = (fields = []) => {
    setFilters((prev) => fields.reduce((next, field) => ({
      ...next,
      [field]: ''
    }), { ...prev }));
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

  const exportExecutiveComplaintPdf = () => {
    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setFeedback('Permita pop-ups para gerar o PDF executivo.');
      return;
    }

    const printDate = new Date();
    const renderRankingRows = (rows) => (
      rows.length
        ? rows.map((row, index) => `
          <tr>
            <td>${String(index + 1).padStart(2, '0')}</td>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(String(row.total))}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="3">Nenhum registro no periodo.</td></tr>'
    );
    const renderScheduledRows = (rows) => (
      rows.length
        ? rows.slice(0, 20).map((item) => `
          <tr>
            <td>${escapeHtml(item.protocol || item.id)}</td>
            <td>${escapeHtml(item.patient_name || 'Nao informado')}</td>
            <td>${escapeHtml(item.clinic_name || 'Nao informado')}</td>
            <td>${escapeHtml(formatShortDate(item.appointment_due_at || item.due_at))}</td>
            <td>${escapeHtml(statusLabels[item.status] || item.status || 'Aberta')}</td>
            <td>${escapeHtml(getCurrentResponsibleName(item))}</td>
            <td>${escapeHtml(getComplaintServiceLabel(item))}</td>
            <td>${escapeHtml(getComplaintSummary(item, 180))}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="8">Nenhum paciente agendado para continuidade do tratamento no periodo.</td></tr>'
    );
    const renderOverdueRows = (rows) => (
      rows.length
        ? rows.slice(0, 25).map((item) => `
          <tr>
            <td>${escapeHtml(item.protocol || item.id)}</td>
            <td>${escapeHtml(item.patient_name || 'Nao informado')}</td>
            <td>${escapeHtml(item.clinic_name || 'Nao informado')}</td>
            <td>${escapeHtml(formatShortDate(item.due_at || item.appointment_due_at))}</td>
            <td>${escapeHtml(item.coordinator_name || 'Nao informado')}</td>
            <td>${escapeHtml(item.manager_name || 'Nao informado')}</td>
            <td>${escapeHtml(getCurrentResponsibleName(item))}</td>
            <td>${escapeHtml(getComplaintReasonLabel(item))}</td>
            <td>${escapeHtml(getComplaintSummary(item, 220))}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="9">Nenhum prazo vencido no periodo.</td></tr>'
    );

    const periodSectionsHtml = executiveReportSections.map((section) => `
      <section class="period-section">
        <div class="section-title">
          <div>
            <p>${escapeHtml(section.label)}</p>
            <h2>${escapeHtml(section.periodLabel)}</h2>
          </div>
          <div class="period-kpis">
            <article><strong>${section.rows.length}</strong><span>reclamacoes</span></article>
            <article><strong>${section.scheduledRows.length}</strong><span>agendados</span></article>
            <article><strong>${section.overdueRows.length}</strong><span>vencidos</span></article>
          </div>
        </div>

        <div class="two-columns">
          <article class="report-block">
            <h3>Ranking de unidades com mais reclamacoes</h3>
            <table>
              <thead><tr><th>#</th><th>Unidade</th><th>Total</th></tr></thead>
              <tbody>${renderRankingRows(section.rankingClinics)}</tbody>
            </table>
          </article>
          <article class="report-block">
            <h3>Principais motivos</h3>
            <table>
              <thead><tr><th>#</th><th>Motivo</th><th>Total</th></tr></thead>
              <tbody>${renderRankingRows(section.rankingReasons)}</tbody>
            </table>
          </article>
        </div>

        <article class="report-block">
          <h3>Pacientes agendados para continuidade do tratamento</h3>
          <table class="detail-table">
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Paciente</th>
                <th>Unidade</th>
                <th>Agendamento</th>
                <th>Status</th>
                <th>Responsavel atual</th>
                <th>Tratamento/servico</th>
                <th>Resumo</th>
              </tr>
            </thead>
            <tbody>${renderScheduledRows(section.scheduledRows)}</tbody>
          </table>
        </article>

        <article class="report-block">
          <h3>Prazos vencidos com coordenador, gerente e resumo da reclamacao</h3>
          <table class="detail-table">
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Paciente</th>
                <th>Unidade</th>
                <th>Prazo</th>
                <th>Coordenador</th>
                <th>Gerente</th>
                <th>Responsavel atual</th>
                <th>Motivo</th>
                <th>Resumo</th>
              </tr>
            </thead>
            <tbody>${renderOverdueRows(section.overdueRows)}</tbody>
          </table>
        </article>
      </section>
    `).join('');

    reportWindow.document.write(`
      <html>
        <head>
          <title>Relatorio executivo de reclamacoes</title>
          <style>
            @page { size: A4 landscape; margin: 10mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Inter, Arial, sans-serif; color: #172033; background: #fff; }
            .report-shell { display: flex; flex-direction: column; gap: 18px; }
            .report-header {
              border: 1px solid #d7b77e;
              border-radius: 18px;
              background: linear-gradient(135deg, #fff8eb 0%, #f0efe8 52%, #e6f3f0 100%);
              padding: 22px 26px;
            }
            .report-header-top { display: flex; justify-content: space-between; gap: 26px; align-items: flex-start; }
            .report-kicker { margin: 0 0 8px; color: #94651f; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .1em; }
            h1 { margin: 0 0 8px; font-size: 28px; color: #0f1f35; line-height: 1.1; }
            .report-subtitle { margin: 0; color: #53606f; font-size: 13px; max-width: 780px; }
            .report-meta {
              min-width: 260px;
              border: 1px solid #dfcba9;
              border-radius: 14px;
              background: rgba(255,255,255,.84);
              padding: 14px 16px;
            }
            .report-meta strong, .summary-card strong, .period-kpis strong {
              display: block;
              color: #0f1f35;
              font-size: 18px;
              line-height: 1;
            }
            .report-meta span, .summary-card span, .period-kpis span {
              display: block;
              margin-top: 4px;
              color: #6b7280;
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: .05em;
            }
            .summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 10px; }
            .summary-card { border: 1px solid #e4e7eb; border-radius: 14px; padding: 13px 14px; background: #fff; }
            .period-section { page-break-inside: avoid; display: flex; flex-direction: column; gap: 12px; }
            .section-title { display: flex; justify-content: space-between; gap: 18px; align-items: flex-end; border-bottom: 2px solid #0f766e; padding-bottom: 8px; }
            .section-title p { margin: 0 0 4px; color: #0f766e; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
            .section-title h2 { margin: 0; color: #111827; font-size: 19px; }
            .period-kpis { display: grid; grid-template-columns: repeat(3, minmax(92px,1fr)); gap: 8px; }
            .period-kpis article { border: 1px solid #dbe7e5; border-radius: 12px; padding: 10px 12px; background: #f8fbfa; }
            .two-columns { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
            .report-block { border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; background: #fff; }
            .report-block h3 { margin: 0; padding: 11px 13px; background: #132238; color: #f8fafc; font-size: 12px; letter-spacing: .02em; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
            th { background: #f3f5f7; color: #374151; text-align: left; padding: 8px 7px; font-size: 8px; text-transform: uppercase; letter-spacing: .04em; }
            td { border-top: 1px solid #e5e7eb; padding: 8px 7px; vertical-align: top; word-break: break-word; }
            tbody tr:nth-child(even) td { background: #fbf8f1; }
            .detail-table th, .detail-table td { font-size: 8px; }
            .report-footer { color: #6b7280; font-size: 10px; display: flex; justify-content: space-between; gap: 18px; }
          </style>
        </head>
        <body>
          <main class="report-shell">
            <section class="report-header">
              <div class="report-header-top">
                <div>
                  <p class="report-kicker">Grupo Sorria - Dashboard de reclamacoes</p>
                  <h1>Relatorio executivo de reclamacoes</h1>
                  <p class="report-subtitle">Ranking de unidades, principais motivos, pacientes agendados para continuidade do tratamento e prazos vencidos com coordenador, gerente e resumo detalhado da reclamacao. O documento respeita os filtros atuais do dashboard.</p>
                </div>
                <div class="report-meta">
                  <span>Emitido em</span>
                  <strong>${escapeHtml(printDate.toLocaleString('pt-BR'))}</strong>
                </div>
              </div>
            </section>
            <section class="summary-grid">
              <article class="summary-card"><strong>${escapeHtml(String(filteredRows.length))}</strong><span>registros filtrados</span></article>
              <article class="summary-card"><strong>${escapeHtml(String(byClinic.length))}</strong><span>unidades no ranking</span></article>
              <article class="summary-card"><strong>${escapeHtml(String(byReason.length))}</strong><span>motivos mapeados</span></article>
              <article class="summary-card"><strong>${escapeHtml(String(filteredRows.filter((item) => item.appointment_due_at || item.appointment_sla_active).length))}</strong><span>agendados</span></article>
              <article class="summary-card"><strong>${escapeHtml(String(filteredRows.filter((item) => buildDeadlineInfo(item) === 'overdue').length))}</strong><span>prazos vencidos</span></article>
            </section>
            ${periodSectionsHtml}
            <footer class="report-footer">
              <span>Base: dashboard de reclamacoes filtrado pelo usuario.</span>
              <span>Documento gerado automaticamente pelo sistema.</span>
            </footer>
          </main>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
  };

  const copyToClipboard = async (text, successMessage = 'Conteudo copiado para a area de transferencia.') => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setFeedback(successMessage);
    } catch (error) {
      setFeedback('Nao foi possivel copiar. Selecione o texto manualmente.');
    }
  };

  const openPhoneBookWhatsApp = (contact) => {
    const digits = onlyPhoneDigits(contact.phone);
    const targetPhone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
    if (!targetPhone || targetPhone.length < 12) {
      setFeedback('Telefone nao cadastrado para este responsavel.');
      return;
    }

    const message = encodeURIComponent(buildPhoneBookNotification(contact));
    window.open(`https://wa.me/${targetPhone}?text=${message}`, '_blank', 'noopener,noreferrer');
  };

  const exportPartnerRankingPdf = () => {
    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setFeedback('Permita pop-ups para gerar o PDF de parceiros.');
      return;
    }

    const printDate = new Date();
    const renderRankingRows = () => (
      partnerRankingDetails.length
        ? partnerRankingDetails.map((partner) => `
          <tr>
            <td>${String(partner.rank).padStart(2, '0')}</td>
            <td>${escapeHtml(partner.label)}</td>
            <td>${escapeHtml(partner.phoneDisplay)}</td>
            <td>${escapeHtml(String(partner.total))}</td>
            <td>${escapeHtml(`${partner.share}%`)}</td>
            <td>${escapeHtml(String(partner.inProgress))}</td>
            <td>${escapeHtml(String(partner.overdue))}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="7">Nenhum parceiro encontrado no cenario filtrado.</td></tr>'
    );
    const renderBreakdownRows = (rows) => (
      rows.length
        ? rows.map((row, index) => `
          <tr>
            <td>${String(index + 1).padStart(2, '0')}</td>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(String(row.total))}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="3">Sem classificacoes neste recorte.</td></tr>'
    );
    const partnerSections = partnerRankingDetails.map((partner) => `
      <section class="partner-section">
        <div class="partner-title">
          <div>
            <p>Parceiro #${String(partner.rank).padStart(2, '0')}</p>
            <h2>${escapeHtml(partner.label)}</h2>
            <span>${escapeHtml(partner.clinicsServed.slice(0, 8).join(', ') || 'Unidade nao informada')}</span>
          </div>
          <div class="partner-kpis">
            <article><strong>${escapeHtml(String(partner.total))}</strong><span>reclamacoes</span></article>
            <article><strong>${escapeHtml(String(partner.overdue))}</strong><span>vencidas</span></article>
            <article><strong>${escapeHtml(String(partner.warning))}</strong><span>prazo critico</span></article>
          </div>
        </div>
        <div class="three-columns">
          <article class="report-block">
            <h3>Classificacoes da reclamacao</h3>
            <table><thead><tr><th>#</th><th>Classificacao / motivo</th><th>Total</th></tr></thead><tbody>${renderBreakdownRows(partner.classificationRows)}</tbody></table>
          </article>
          <article class="report-block">
            <h3>Servicos envolvidos</h3>
            <table><thead><tr><th>#</th><th>Servico</th><th>Total</th></tr></thead><tbody>${renderBreakdownRows(partner.serviceRows)}</tbody></table>
          </article>
          <article class="report-block">
            <h3>Status dos protocolos</h3>
            <table><thead><tr><th>#</th><th>Status</th><th>Total</th></tr></thead><tbody>${renderBreakdownRows(partner.statusRows)}</tbody></table>
          </article>
        </div>
        <article class="report-block">
          <h3>Amostra de protocolos para conferencia</h3>
          <table class="detail-table">
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Paciente</th>
                <th>Unidade</th>
                <th>Classificacao</th>
                <th>Status</th>
                <th>Prazo</th>
                <th>Resumo</th>
              </tr>
            </thead>
            <tbody>
              ${partner.samples.length ? partner.samples.map((item) => `
                <tr>
                  <td>${escapeHtml(item.protocol || item.id)}</td>
                  <td>${escapeHtml(item.patient_name || 'Nao informado')}</td>
                  <td>${escapeHtml(item.clinic_name || 'Nao informado')}</td>
                  <td>${escapeHtml(getComplaintReasonLabel(item))}</td>
                  <td>${escapeHtml(statusLabels[item.status] || item.status || 'Aberta')}</td>
                  <td>${escapeHtml(slaLabel(buildDeadlineInfo(item)))}</td>
                  <td>${escapeHtml(getComplaintSummary(item, 220))}</td>
                </tr>
              `).join('') : '<tr><td colspan="7">Sem amostras neste recorte.</td></tr>'}
            </tbody>
          </table>
        </article>
      </section>
    `).join('');

    reportWindow.document.write(`
      <html>
        <head>
          <title>Ranking de parceiros com mais reclamacoes</title>
          <style>
            @page { size: A4 landscape; margin: 10mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Inter, Arial, sans-serif; color: #172033; background: #fff; }
            main { display: flex; flex-direction: column; gap: 16px; }
            .report-header {
              border: 1px solid #d7b77e;
              border-radius: 18px;
              background: linear-gradient(135deg, #fff8eb 0%, #eef7f4 100%);
              padding: 22px 26px;
            }
            .report-header-top, .partner-title { display: flex; justify-content: space-between; gap: 22px; align-items: flex-start; }
            .report-kicker, .partner-title p { margin: 0 0 6px; color: #94651f; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .1em; }
            h1 { margin: 0 0 8px; font-size: 28px; color: #0f1f35; }
            h2 { margin: 0; font-size: 18px; color: #0f1f35; }
            .report-subtitle, .partner-title span { margin: 0; color: #53606f; font-size: 11px; }
            .summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 10px; }
            .summary-card, .partner-kpis article {
              border: 1px solid #e4e7eb;
              border-radius: 14px;
              padding: 12px 14px;
              background: #fff;
            }
            .summary-card strong, .partner-kpis strong { display: block; color: #0f1f35; font-size: 18px; line-height: 1; }
            .summary-card span, .partner-kpis span { display: block; margin-top: 4px; color: #6b7280; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; }
            .partner-section { page-break-inside: avoid; display: flex; flex-direction: column; gap: 11px; border-top: 2px solid #0f766e; padding-top: 12px; }
            .partner-kpis { display: grid; grid-template-columns: repeat(3, minmax(90px,1fr)); gap: 8px; min-width: 320px; }
            .three-columns { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
            .report-block { border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; background: #fff; }
            .report-block h3 { margin: 0; padding: 10px 12px; background: #132238; color: #f8fafc; font-size: 11px; letter-spacing: .02em; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8px; }
            th { background: #f3f5f7; color: #374151; text-align: left; padding: 7px 6px; font-size: 7px; text-transform: uppercase; letter-spacing: .04em; }
            td { border-top: 1px solid #e5e7eb; padding: 7px 6px; vertical-align: top; word-break: break-word; }
            tbody tr:nth-child(even) td { background: #fbf8f1; }
            .detail-table th, .detail-table td { font-size: 8px; }
          </style>
        </head>
        <body>
          <main>
            <section class="report-header">
              <div class="report-header-top">
                <div>
                  <p class="report-kicker">Grupo Sorria - Dashboard de reclamacoes</p>
                  <h1>Ranking de parceiros com mais reclamacoes</h1>
                  <p class="report-subtitle">Documento gerado com os filtros atuais do dashboard, incluindo classificacoes, servicos, status e amostra de protocolos por parceiro.</p>
                </div>
                <div class="summary-card"><span>Emitido em</span><strong>${escapeHtml(printDate.toLocaleString('pt-BR'))}</strong></div>
              </div>
            </section>
            <section class="summary-grid">
              <article class="summary-card"><strong>${escapeHtml(String(filteredRows.length))}</strong><span>registros filtrados</span></article>
              <article class="summary-card"><strong>${escapeHtml(String(partnerRankingDetails.length))}</strong><span>parceiros ranqueados</span></article>
              <article class="summary-card"><strong>${escapeHtml(String(metrics.overdue))}</strong><span>vencidas</span></article>
              <article class="summary-card"><strong>${escapeHtml(String(metrics.inProgress))}</strong><span>em andamento</span></article>
              <article class="summary-card"><strong>${escapeHtml(formatDecimal(metrics.avgPerDay))}</strong><span>media por dia</span></article>
            </section>
            <article class="report-block">
              <h3>Ranking consolidado</h3>
              <table>
                <thead><tr><th>#</th><th>Parceiro</th><th>Telefone</th><th>Total</th><th>% carteira</th><th>Em andamento</th><th>Vencidas</th></tr></thead>
                <tbody>${renderRankingRows()}</tbody>
              </table>
            </article>
            ${partnerSections}
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
          {canAccessPhoneBook && (
            <button className="primary-action dashboard-phonebook-trigger" onClick={() => setShowPhoneBook(true)}>
              Agenda Telefonica
            </button>
          )}
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
          <div className="export-actions dashboard-report-actions">
            <select
              className="field"
              value={executiveReportPeriod}
              onChange={(event) => setExecutiveReportPeriod(event.target.value)}
              aria-label="Periodo do relatorio executivo em PDF"
            >
              {executiveReportPeriodOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button className="outline-action" onClick={exportExecutiveComplaintPdf} disabled={!filteredRows.length}>
              <span className="export-badge pdf">PDF</span>
              <span>Relatorio executivo</span>
            </button>
            <button className="outline-action" onClick={() => setFilters(initialFilters)}>
              Limpar filtros
            </button>
          </div>
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

      {canAccessPhoneBook && showPhoneBook && (
        <section className="dashboard-phonebook-overlay" role="dialog" aria-modal="true" aria-labelledby="phonebook-title">
          <div className="dashboard-phonebook-panel">
            <div className="dashboard-phonebook-header">
              <div>
                <p className="eyebrow">Agenda Telefonica</p>
                <h2 id="phonebook-title">Coordenadores e gerentes para notificacoes</h2>
                <p className="base-subtitle">Lista montada pelo cenario filtrado do dashboard, com copia rapida de telefone e mensagem para WhatsApp.</p>
              </div>
              <button className="outline-action" onClick={() => setShowPhoneBook(false)}>Fechar</button>
            </div>

            <div className="dashboard-phonebook-summary">
              <article>
                <span>Contatos</span>
                <strong>{phoneBookContacts.length}</strong>
              </article>
              <article>
                <span>Protocolos filtrados</span>
                <strong>{filteredRows.length}</strong>
              </article>
              <article>
                <span>Vencidos</span>
                <strong>{metrics.overdue}</strong>
              </article>
            </div>

            <div className="dashboard-phonebook-list">
              {phoneBookContacts.length ? phoneBookContacts.map((contact) => (
                <article className="dashboard-phonebook-card" key={contact.key}>
                  <div className="dashboard-phonebook-main">
                    <span className={`dashboard-phonebook-role ${contact.role}`}>{contact.roleLabel}</span>
                    <strong>{contact.name}</strong>
                    <small>{contact.clinicName}</small>
                  </div>
                  <div className="dashboard-phonebook-phone">
                    <span>{contact.phoneDisplay}</span>
                    <small>{contact.total} protocolo(s) - {contact.overdue} vencido(s) - {contact.warning} perto de vencer</small>
                  </div>
                  <div className="dashboard-phonebook-actions">
                    <button className="outline-action" onClick={() => copyToClipboard(contact.phone || contact.phoneDisplay, 'Telefone copiado.')}>
                      Copiar telefone
                    </button>
                    <button className="outline-action" onClick={() => copyToClipboard(buildPhoneBookNotification(contact), 'Mensagem de notificacao copiada.')}>
                      Copiar mensagem
                    </button>
                    <button className="primary-action" onClick={() => openPhoneBookWhatsApp(contact)} disabled={!onlyPhoneDigits(contact.phone)}>
                      WhatsApp
                    </button>
                  </div>
                </article>
              )) : (
                <p className="empty-state">Nenhum coordenador ou gerente com vinculo no cenario filtrado.</p>
              )}
            </div>
          </div>
        </section>
      )}

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
        <button className={`kpi-card warning kpi-button ${filters.status === 'aberta' ? 'active' : ''}`} type="button" onClick={() => toggleFilter('status', 'aberta')}>
          <span>Abertas</span>
          <strong>{metrics.opened}</strong>
          <p>{percentOf(metrics.total, metrics.opened)} DO CENÁRIO</p>
        </button>
        <button className={`kpi-card progress kpi-button ${filters.status === 'em_andamento' ? 'active' : ''}`} type="button" onClick={() => toggleFilter('status', 'em_andamento')}>
          <span>Em andamento</span>
          <strong>{metrics.inProgress}</strong>
          <p>{percentOf(metrics.total, metrics.inProgress)} DO CENÁRIO</p>
        </button>
        <button className={`kpi-card danger kpi-button ${filters.sla === 'overdue' ? 'active' : ''}`} type="button" onClick={() => toggleFilter('sla', 'overdue')}>
          <span>Vencidas</span>
          <strong>{metrics.overdue}</strong>
          <p>{percentOf(metrics.total, metrics.overdue)} DO CENÁRIO</p>
        </button>
        <button className={`kpi-card success kpi-button ${filters.status === 'resolvida' ? 'active' : ''}`} type="button" onClick={() => toggleFilter('status', 'resolvida')}>
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
          <section className="management-panel dashboard-stage-panel dashboard-ranking-report-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Ranking e relatorio</p>
                <h2>Unidades, motivos, agendados e prazos vencidos</h2>
                <p className="base-subtitle">Visao liberada para Operador de SAC com ranking das unidades que mais geram reclamacoes e leitura rapida dos pontos que entram no PDF executivo.</p>
              </div>
              <button className="outline-action" onClick={exportExecutiveComplaintPdf} disabled={!filteredRows.length}>
                <span className="export-badge pdf">PDF</span>
                <span>Baixar ranking executivo</span>
              </button>
            </div>

            <div className="dashboard-ranking-grid">
              <article className="chart-card dashboard-ranking-card">
                <div className="dashboard-section-head">
                  <div>
                    <p className="eyebrow">Ranking</p>
                    <h2>Unidades com mais reclamacoes</h2>
                  </div>
                </div>
                <div className="dashboard-coordinator-list">
                  {byClinic.length ? byClinic.map((item, index) => (
                    <article className="dashboard-coordinator-item" key={item.label}>
                      <div className="dashboard-coordinator-rank">{String(index + 1).padStart(2, '0')}</div>
                      <div className="dashboard-coordinator-copy">
                        <button className="dashboard-inline-filter" type="button" onClick={() => toggleFilter('clinic', item.label)}>
                          {item.label}
                        </button>
                        <span>{item.total} reclamacao(oes) no cenario filtrado</span>
                      </div>
                    </article>
                  )) : (
                    <p className="empty-state">Sem unidades no cenario filtrado.</p>
                  )}
                </div>
              </article>

              <article className="chart-card dashboard-ranking-card">
                <div className="dashboard-section-head">
                  <div>
                    <p className="eyebrow">Motivos</p>
                    <h2>Principais motivos de reclamacao</h2>
                  </div>
                </div>
                <div className="dashboard-coordinator-list">
                  {byReason.length ? byReason.map((item, index) => (
                    <article className="dashboard-coordinator-item" key={item.label}>
                      <div className="dashboard-coordinator-rank">{String(index + 1).padStart(2, '0')}</div>
                      <div className="dashboard-coordinator-copy">
                        <strong>{item.label}</strong>
                        <span>{item.total} ocorrencia(s) no cenario filtrado</span>
                      </div>
                    </article>
                  )) : (
                    <p className="empty-state">Sem motivos no cenario filtrado.</p>
                  )}
                </div>
              </article>

              <article className="chart-card dashboard-ranking-card compact">
                <div className="dashboard-section-head">
                  <div>
                    <p className="eyebrow">Tratamento</p>
                    <h2>Pacientes agendados</h2>
                  </div>
                </div>
                <div className="dashboard-compact-list">
                  {filteredRows.filter((item) => item.appointment_due_at || item.appointment_sla_active).slice(0, 6).map((item) => (
                    <article key={item.id}>
                      <strong>{item.patient_name || 'Paciente nao informado'}</strong>
                      <span>{item.clinic_name || 'Unidade nao informada'} - {formatShortDate(item.appointment_due_at || item.due_at)}</span>
                      <small>{statusLabels[item.status] || item.status || 'Aberta'} - {getComplaintServiceLabel(item)}</small>
                    </article>
                  ))}
                  {!filteredRows.some((item) => item.appointment_due_at || item.appointment_sla_active) && (
                    <p className="empty-state">Nenhum paciente agendado no cenario filtrado.</p>
                  )}
                </div>
              </article>

              <article className="chart-card dashboard-ranking-card compact">
                <div className="dashboard-section-head">
                  <div>
                    <p className="eyebrow">SLA</p>
                    <h2>Prazos vencidos</h2>
                  </div>
                </div>
                <div className="dashboard-compact-list">
                  {filteredRows.filter((item) => buildDeadlineInfo(item) === 'overdue').slice(0, 6).map((item) => (
                    <article key={item.id}>
                      <strong>{item.protocol || item.id} - {item.patient_name || 'Paciente nao informado'}</strong>
                      <span>Coord.: {item.coordinator_name || 'Nao informado'} - Ger.: {item.manager_name || 'Nao informado'}</span>
                      <small>{formatShortDate(item.due_at)} - {getComplaintReasonLabel(item)}</small>
                    </article>
                  ))}
                  {!filteredRows.some((item) => buildDeadlineInfo(item) === 'overdue') && (
                    <p className="empty-state">Nenhum prazo vencido no cenario filtrado.</p>
                  )}
                </div>
              </article>
            </div>
          </section>

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
              <button className="outline-action" onClick={exportPartnerRankingPdf} disabled={!partnerRankingDetails.length}>
                <span className="export-badge pdf">PDF</span>
                <span>Ranking parceiros</span>
              </button>
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
                let isActive = false;
                if (item.label === 'Protocolos') onClick = () => clearFilters(['status', 'sla', 'priority']);
                if (item.label === 'Unidades') onClick = () => clearFilters(['clinic']);
                if (item.label === 'Coordenadores') onClick = () => clearFilters(['coordinator']);
                if (item.label === 'Alta prioridade') {
                  onClick = () => applyToggleFilters({ priority: 'alta' });
                  isActive = filters.priority === 'alta';
                }
                if (item.label === 'Vencidos') {
                  onClick = () => applyToggleFilters({ sla: 'overdue' });
                  isActive = filters.sla === 'overdue';
                }

                return (
                <button className={`dashboard-summary-card dashboard-summary-button ${isActive ? 'active' : ''}`} key={item.label} type="button" onClick={onClick}>
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
