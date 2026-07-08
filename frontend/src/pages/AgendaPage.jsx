import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import api, { getApiErrorMessage } from '../api';
import { ActionButtons, Card, DashboardGrid, KPICard, PageHeader, SectionContainer } from '../components/DesignSystem';
import { getUserDisplayName, isMasterAdmin, normalizeRoleValue, readUser } from '../constants';

const agendaColumns = [
  { key: 'todo', label: 'A fazer', helper: 'Ideias, pendências e próximas ações', eyebrow: 'Backlog' },
  { key: 'today', label: 'Hoje', helper: 'Prioridade do dia', eyebrow: 'Focus' },
  { key: 'doing', label: 'Em andamento', helper: 'Itens em execução', eyebrow: 'Running' },
  { key: 'done', label: 'Concluído', helper: 'Finalizados', eyebrow: 'Closed' }
];

const priorityOptions = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' }
];

const agendaDashboardWindowOptions = [
  { value: '7', label: '7 dias' },
  { value: '15', label: '15 dias' },
  { value: '30', label: '30 dias' },
  { value: '60', label: '60 dias' }
];

const recurrenceWeekdayOptions = [
  { value: 1, shortLabel: 'Seg', fullLabel: 'Segunda' },
  { value: 2, shortLabel: 'Ter', fullLabel: 'Terça' },
  { value: 3, shortLabel: 'Qua', fullLabel: 'Quarta' },
  { value: 4, shortLabel: 'Qui', fullLabel: 'Quinta' },
  { value: 5, shortLabel: 'Sex', fullLabel: 'Sexta' },
  { value: 6, shortLabel: 'Sab', fullLabel: 'Sábado' },
  { value: 0, shortLabel: 'Dom', fullLabel: 'Domingo' }
];

const agendaDemandTypeOptions = [
  { value: 'general', label: 'Demanda geral' },
  { value: 'patient', label: 'Paciente' }
];

const agendaConfirmationStatusOptions = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'nao_confirmado', label: 'Não confirmou' }
];

const agendaPatientQueueOptions = [
  { value: 'all', label: 'Visão geral', helper: 'Todas as demandas da agenda' },
  { value: 'pending_confirmation', label: 'Confirmação', helper: 'Pacientes aguardando retorno' },
  { value: 'evasion', label: 'Evasão', helper: 'Pacientes que não confirmaram para tratativa' }
];

const agendaConfirmationMonitorFilterOptions = [
  { value: 'all', label: 'Todos' },
  { value: 'pendente', label: 'Sem confirmacao' },
  { value: 'confirmado', label: 'Confirmados' },
  { value: 'nao_confirmado', label: 'Nao confirmados' },
  { value: 'reagendamento', label: 'Reagendamento' },
  { value: 'falha_envio', label: 'Falha de envio' },
  { value: 'sem_whatsapp', label: 'Sem WhatsApp' }
];

const agendaImportTypeOptions = [
  { value: 'demands', label: 'Demandas' },
  { value: 'patient_agenda', label: 'Agenda de Pacientes' }
];

const agendaDuplicateStrategyOptions = [
  { value: 'ignore', label: 'Ignorar duplicados' },
  { value: 'update', label: 'Atualizar duplicados' },
  { value: 'import_anyway', label: 'Importar mesmo assim' }
];

const emptyDraft = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'normal',
  demand_type: 'general',
  patient_name: '',
  patient_phone: '',
  patient_has_scheduled: false,
  patient_scheduled_at: '',
  patient_fake_appointment: false,
  confirmation_status: 'pendente',
  confirmation_notes: '',
  free_notes: '',
  due_at: '',
  reminder_at: '',
  assigned_user_id: '',
  tags: '',
  is_daily_recurring: false,
  requires_completion: true,
  recurrence_base_status: 'todo',
  recurrence_weekdays: []
};

const emptyImportDraft = {
  source_mode: 'clipboard',
  file: null,
  raw_text: '',
  import_type: 'patient_agenda',
  duplicate_strategy: 'ignore',
  clinic_id: '',
  agenda_date: '',
  default_assigned_user_id: '',
  create_tasks: true,
  dispatch_whatsapp: false,
  message_text: ''
};

const emptyReplicationDraft = {
  source_user_id: '',
  target_user_id: '',
  include_done: false,
  skip_duplicates: true
};

function toDatetimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function isOverdue(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function normalizeDraftFromItem(item = {}) {
  const demandType = item.demand_type || (item.patient_name || item.patient_phone ? 'patient' : 'general');
  return {
    title: item.title || '',
    description: item.description || '',
    status: item.status || 'todo',
    priority: item.priority || 'normal',
    demand_type: demandType,
    patient_name: item.patient_name || '',
    patient_phone: item.patient_phone || '',
    patient_has_scheduled: Boolean(item.patient_has_scheduled),
    patient_scheduled_at: toDatetimeLocal(item.patient_scheduled_at),
    patient_fake_appointment: Boolean(item.patient_fake_appointment),
    confirmation_status: item.confirmation_status || 'pendente',
    confirmation_notes: item.confirmation_notes || '',
    free_notes: item.free_notes || '',
    due_at: toDatetimeLocal(item.due_at),
    reminder_at: toDatetimeLocal(item.reminder_at),
    assigned_user_id: item.assigned_user_id ? String(item.assigned_user_id) : '',
    tags: Array.isArray(item.tags) ? item.tags.join(', ') : '',
    is_daily_recurring: Boolean(item.is_daily_recurring),
    requires_completion: item.requires_completion !== false,
    recurrence_base_status: item.recurrence_base_status || 'todo',
    recurrence_weekdays: normalizeAgendaRecurrenceWeekdays(item.recurrence_weekdays)
  };
}

function normalizeAgendaRecurrenceWeekdays(value = []) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
  )).sort((left, right) => left - right);
}

function formatAgendaAssignee(item = {}) {
  return item.assigned_user_name || item.assignedUser?.name || item.owner_name || 'Sem responsável';
}

function formatAgendaUserOption(user = {}) {
  const name = user.name || user.email || `Usuário ${user.id}`;
  const detail = user.position || user.role || user.department || user.email;
  return detail ? `${name} - ${detail}` : name;
}

function formatExecutionStamp(item = {}) {
  if (!item?.completed_at) return '';
  const actor = item.completed_by_name ? ` por ${item.completed_by_name}` : '';
  return `Executado em ${formatDateTime(item.completed_at)}${actor}`;
}

function formatRecurrenceWeekdaySummary(weekdays = []) {
  const normalizedWeekdays = normalizeAgendaRecurrenceWeekdays(weekdays);
  if (!normalizedWeekdays.length) return 'Todos os dias';
  return normalizedWeekdays
    .map((weekday) => recurrenceWeekdayOptions.find((option) => option.value === weekday)?.shortLabel || '')
    .filter(Boolean)
    .join(', ');
}

function formatAgendaRecurrenceSummary(item = {}) {
  if (!item?.is_daily_recurring) return '';
  const recurrenceDaysLabel = formatRecurrenceWeekdaySummary(item.recurrence_weekdays);
  return `Volta para A fazer: ${recurrenceDaysLabel}`;
}

function canAccessAgendaAnalytics(user) {
  if (isMasterAdmin(user)) return true;
  return ['admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'manager'].includes(normalizeRoleValue(user?.role));
}

function canUseAgendaImport(user) {
  if (canAccessAgendaAnalytics(user)) return true;
  return normalizeRoleValue(user?.role) === 'crc_operator';
}

function canUseAgendaConfirmationMonitor(user) {
  if (canAccessAgendaAnalytics(user)) return true;
  return normalizeRoleValue(user?.role) === 'crc_operator';
}

function canUseAgendaOperatorTabs(user) {
  if (isMasterAdmin(user)) return true;
  return ['admin', 'supervisor_crc', 'crc_leader'].includes(normalizeRoleValue(user?.role));
}

function canReplicateAgendaItems(user) {
  if (isMasterAdmin(user)) return true;
  return normalizeRoleValue(user?.role) === 'supervisor_crc';
}

function normalizeAgendaBoardUserId(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function buildAgendaBoardIdentity(item = {}, assigneeDirectory = new Map()) {
  const assignedUserId = normalizeAgendaBoardUserId(item.assigned_user_id || item.assignedUser?.id);
  const ownerUserId = normalizeAgendaBoardUserId(item.owner_user_id);
  const responsibleUserId = assignedUserId || ownerUserId;

  if (!responsibleUserId) {
    return {
      key: 'unassigned',
      label: 'Sem responsável definido',
      userId: null,
      roleLabel: '',
      delegatedBy: null,
      ownerOnly: false
    };
  }

  const directoryUser = assigneeDirectory.get(String(responsibleUserId)) || null;
  const label = directoryUser?.name || item.assigned_user_name || item.owner_name || directoryUser?.email || `Usuário ${responsibleUserId}`;
  const roleLabel = directoryUser?.position || directoryUser?.department || directoryUser?.role || '';

  return {
    key: `user-${responsibleUserId}`,
    label,
    userId: responsibleUserId,
    roleLabel,
    delegatedBy: assignedUserId && ownerUserId && assignedUserId !== ownerUserId ? (item.owner_name || null) : null,
    ownerOnly: !assignedUserId && Boolean(ownerUserId)
  };
}

function buildAgendaBoardHelper(board = {}) {
  if (!board.userId) {
    return 'Itens sem responsável operacional definido.';
  }

  const delegatedOwners = Array.isArray(board.delegatedOwners) ? board.delegatedOwners.filter(Boolean) : [];

  if (delegatedOwners.length && board.hasOwnerOnlyItems) {
    return 'Recebe demandas repassadas e também conduz rotinas próprias.';
  }

  if (delegatedOwners.length === 1) {
    return `Demandas em execução com acompanhamento de ${delegatedOwners[0]}.`;
  }

  if (delegatedOwners.length > 1) {
    return `Demandas acompanhadas por ${delegatedOwners.length} solicitante(s).`;
  }

  if (board.hasOwnerOnlyItems) {
    return 'Rotina própria sem repasse formal.';
  }

  return 'Carteira operacional consolidada deste colaborador.';
}

function buildAgendaBoards(items = [], assigneeDirectory = new Map(), currentUserId = '') {
  const boards = new Map();

  items.forEach((item) => {
    const identity = buildAgendaBoardIdentity(item, assigneeDirectory);
    if (!boards.has(identity.key)) {
      boards.set(identity.key, {
        ...identity,
        items: [],
        delegatedOwners: new Set(),
        hasOwnerOnlyItems: false
      });
    }

    const board = boards.get(identity.key);
    board.items.push(item);
    if (identity.delegatedBy) {
      board.delegatedOwners.add(identity.delegatedBy);
    }
    if (identity.ownerOnly) {
      board.hasOwnerOnlyItems = true;
    }
  });

  return Array.from(boards.values())
    .map((board) => {
      const delegatedOwners = Array.from(board.delegatedOwners);
      return {
        ...board,
        delegatedOwners,
        helper: buildAgendaBoardHelper({ ...board, delegatedOwners }),
        total: board.items.length,
        open: board.items.filter((item) => item.status !== 'done').length,
        overdue: board.items.filter((item) => item.status !== 'done' && isOverdue(item.due_at)).length,
        done: board.items.filter((item) => item.status === 'done').length,
        columns: agendaColumns.reduce((acc, column) => {
          acc[column.key] = board.items.filter((item) => item.status === column.key);
          return acc;
        }, {})
      };
    })
    .sort((a, b) => {
      const aIsCurrent = a.userId && String(a.userId) === String(currentUserId || '');
      const bIsCurrent = b.userId && String(b.userId) === String(currentUserId || '');
      if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1;
      if (a.open !== b.open) return b.open - a.open;
      return a.label.localeCompare(b.label, 'pt-BR');
    });
}

function buildAgendaClinicGroups(items = []) {
  const groups = new Map();

  items.forEach((item) => {
    const clinicName = item.clinic_name || 'Sem clínica definida';
    const clinicKey = item.clinic_id ? `clinic-${item.clinic_id}` : `clinic-name-${clinicName}`;
    if (!groups.has(clinicKey)) {
      groups.set(clinicKey, {
        key: clinicKey,
        clinicName,
        clinicId: item.clinic_id || null,
        items: [],
        total: 0,
        confirmed: 0,
        pending: 0,
        notConfirmed: 0,
        fake: 0
      });
    }

    const group = groups.get(clinicKey);
    group.items.push(item);
    group.total += 1;
    if (item.confirmation_status === 'confirmado') group.confirmed += 1;
    else if (item.confirmation_status === 'nao_confirmado') group.notConfirmed += 1;
    else group.pending += 1;
    if (item.patient_fake_appointment) group.fake += 1;
  });

  return Array.from(groups.values()).sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total;
    return left.clinicName.localeCompare(right.clinicName, 'pt-BR');
  });
}

function formatAgendaDashboardDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function formatAgendaPercent(value) {
  const numeric = Number(value || 0);
  return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 1)}%`;
}

function getAgendaEvolutionToneClass(value) {
  const numeric = Number(value || 0);
  if (numeric >= 4) return 'strong';
  if (numeric >= 2) return 'steady';
  if (numeric >= 1) return 'light';
  return 'idle';
}

function getAgendaConfirmationToneClass(value) {
  const normalized = String(value || '').trim();
  if (normalized === 'confirmado') return 'success';
  if (['nao_confirmado', 'reagendamento', 'humano', 'falha_envio', 'sem_whatsapp'].includes(normalized)) return 'danger';
  if (['pendente_envio', 'aguardando_resposta'].includes(normalized)) return 'warning';
  return 'neutral';
}

function AgendaDashboardTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="agenda-chart-tooltip">
      <strong>{label || payload[0]?.payload?.label || '-'}</strong>
      <div>
        {payload.map((entry) => (
          <span key={`${entry.dataKey}-${entry.name}`} style={{ color: entry.color || '#10213b' }}>
            {entry.name}: {entry.value}
          </span>
        ))}
      </div>
    </div>
  );
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function canExecuteAgendaItem(currentUserId, item = {}) {
  const responsibleId = String(item.assigned_user_id || item.owner_user_id || '');
  return responsibleId && String(currentUserId || '') === responsibleId;
}

function getPriorityLabel(priority = 'normal') {
  if (priority === 'urgente') return 'Urgente';
  if (priority === 'alta') return 'Alta';
  if (priority === 'baixa') return 'Baixa';
  return 'Normal';
}

function getAgendaDemandTypeLabel(value = 'general') {
  return value === 'patient' ? 'Paciente' : 'Demanda';
}

function getAgendaConfirmationStatusLabel(value = '') {
  if (value === 'confirmado') return 'Confirmado';
  if (value === 'nao_confirmado') return 'Evasão';
  return 'Pendente';
}

function getAgendaImportResultLabel(value = '') {
  if (value === 'valid') return 'Válido';
  if (value === 'duplicate') return 'Duplicado';
  return 'Erro';
}

function getAgendaContactStatusLabel(value = '') {
  if (value === 'updated') return 'Contato atualizado';
  if (value === 'found_by_robot') return 'Encontrado pelo robo';
  if (value === 'review_required') return 'Revisao necessaria';
  if (value === 'outdated') return 'Desatualizado';
  if (value === 'not_found') return 'Nao encontrado';
  if (value === 'access_denied') return 'Acesso negado';
  if (value === 'clinic_mismatch') return 'Clinica divergente';
  if (value === 'date_mismatch') return 'Data divergente';
  if (value === 'error') return 'Erro';
  return 'Telefone pendente';
}

function getAgendaContactStatusTone(value = '') {
  if (['updated', 'found_by_robot'].includes(value)) return 'success';
  if (['review_required', 'outdated'].includes(value)) return 'warning';
  if (['access_denied', 'clinic_mismatch', 'date_mismatch', 'error'].includes(value)) return 'danger';
  return 'neutral';
}

function getAgendaDateMatchLabel(value = '') {
  if (value === 'matched') return 'Data validada';
  if (value === 'not_available') return 'Data nao localizada';
  if (value === 'mismatch') return 'Data divergente';
  if (value === 'review_required') return 'Data em revisao';
  return 'Data nao verificada';
}

function getAgendaDateMatchTone(value = '') {
  if (value === 'matched') return 'success';
  if (['not_available', 'review_required'].includes(value)) return 'warning';
  if (value === 'mismatch') return 'danger';
  return 'neutral';
}

function formatAgendaConfidence(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? `${Math.round(numeric)}%` : '-';
}

function buildAgendaPreviewPayload(item = {}, source = 'task') {
  return {
    source,
    title: item.patient_name || item.title || 'Demanda',
    subtitle: item.clinic_name || item.assigned_user_name || 'Sem contexto adicional',
    lines: [
      item.patient_scheduled_at || item.due_at ? `Consulta: ${formatDateTime(item.patient_scheduled_at || item.due_at)}` : 'Consulta: Sem data',
      `Telefone: ${item.contact_phone_masked || item.patient_phone || '-'}`,
      `Status do contato: ${getAgendaContactStatusLabel(item.contact_status || '')}`,
      `Data da agenda: ${getAgendaDateMatchLabel(item.appointment_date_match_status || '')}`,
      `Agendamento: ${item.patient_fake_appointment ? 'Fake' : 'Regular'}`,
      `Observações: ${item.free_notes || '-'}`,
      `Fonte: ${item.contact_source || item.whatsapp_status_label || 'Aguardando atualização'}`,
      `Confiança: ${formatAgendaConfidence(item.contact_confidence_score || item.confidence_score)}`
    ]
  };
}

function matchesAgendaPatientQueue(item = {}, queue = 'all') {
  if (queue === 'all') return true;
  const isPatientDemand = (item.demand_type || 'general') === 'patient' || item.patient_name || item.patient_phone;
  if (!isPatientDemand) return false;
  if (queue === 'pending_confirmation') {
    return item.confirmation_status !== 'confirmado' && item.confirmation_status !== 'nao_confirmado';
  }
  if (queue === 'evasion') {
    return item.confirmation_status === 'nao_confirmado';
  }
  return true;
}

function getAgendaDeadlineState(item = {}) {
  if (item.status === 'done') {
    return { label: 'Concluído', tone: 'done' };
  }

  if (!item?.due_at) {
    return { label: 'Sem prazo', tone: 'neutral' };
  }

  const dueAt = new Date(item.due_at);
  if (Number.isNaN(dueAt.getTime())) {
    return { label: 'Prazo invalido', tone: 'neutral' };
  }

  const diffMs = dueAt.getTime() - Date.now();
  if (diffMs < 0) {
    return { label: 'Atrasado', tone: 'late' };
  }

  if (diffMs <= 24 * 60 * 60 * 1000) {
    return { label: 'Vence hoje', tone: 'today' };
  }

  if (diffMs <= 48 * 60 * 60 * 1000) {
    return { label: 'Em 48h', tone: 'warning' };
  }

  return { label: 'No prazo', tone: 'ok' };
}

function AgendaCard({
  item,
  currentUserId,
  onOpen,
  onStatus,
  onDragStart,
  onOpenWhatsApp,
  onReprocessContact,
  onPreviewEnter,
  onPreviewLeave,
  onPreviewPin,
  openingWhatsappId,
  reprocessingContactId
}) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const deadline = getAgendaDeadlineState(item);
  const ownerFollowUp = item.owner_name && item.owner_user_id && item.assigned_user_id && Number(item.owner_user_id) !== Number(item.assigned_user_id)
    ? `Acompanhamento mantido por ${item.owner_name}`
    : '';
  const executionStamp = formatExecutionStamp(item);
  const canExecute = canExecuteAgendaItem(currentUserId, item);
  const recurrenceSummary = formatAgendaRecurrenceSummary(item);
  const contactStatusTone = getAgendaContactStatusTone(item.contact_status);
  const dateMatchTone = getAgendaDateMatchTone(item.appointment_date_match_status);
  const canOpenWhatsApp = Boolean((item.contact_whatsapp_available || item.patient_phone) && !item.patient_do_not_contact && item.patient_name);
  const previewPayload = buildAgendaPreviewPayload(item, 'task');
  const handleCardOpen = (event) => {
    if (event?.defaultPrevented) return;
    const target = event?.target;
    if (target instanceof Element && target.closest('button, a, input, select, textarea, label')) {
      return;
    }
    onOpen(item);
  };

  const handleCardKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen(item);
  };
  return (
    <article
      className={`agenda-task-card priority-${item.priority || 'normal'} ${isOverdue(item.due_at) && item.status !== 'done' ? 'overdue' : ''} ${item.patient_fake_appointment ? 'fake-appointment' : ''}`}
      draggable
      role="button"
      tabIndex={0}
      aria-label={`Abrir detalhes de ${item.patient_name || item.title || 'item da agenda'}`}
      onDragStart={() => onDragStart(item.id)}
      onClick={handleCardOpen}
      onKeyDown={handleCardKeyDown}
      onMouseEnter={(event) => onPreviewEnter(event, previewPayload)}
      onMouseLeave={onPreviewLeave}
    >
      <div className="agenda-card-topline">
        <span className={`agenda-priority priority-${item.priority || 'normal'}`}>{getPriorityLabel(item.priority)}</span>
        <span className={`agenda-deadline-pill ${deadline.tone}`}>{deadline.label}</span>
      </div>
      <div className="agenda-card-identity">
        <div className="agenda-card-title-stack">
          <span className="agenda-card-type">{item.patient_name ? 'Paciente em agenda' : 'Demanda operacional'}</span>
          <button type="button" className="agenda-task-main" onClick={(event) => {
            event.stopPropagation();
            onOpen(item);
          }}
          >
            <strong>{item.title}</strong>
            {item.description ? <p>{item.description}</p> : null}
          </button>
        </div>
        <div className="agenda-card-highlight">
          <strong>{item.patient_name || 'Sem paciente'}</strong>
          <span>{item.patient_scheduled_at ? formatDateTime(item.patient_scheduled_at) : 'Sem consulta vinculada'}</span>
        </div>
      </div>
      <div className="agenda-card-pill-row">
        <button
          type="button"
          className={`agenda-inline-pill agenda-inline-pill-button ${contactStatusTone}`}
          onClick={(event) => onPreviewPin(event, previewPayload)}
        >
          {getAgendaContactStatusLabel(item.contact_status)}
        </button>
        <button
          type="button"
          className={`agenda-inline-pill agenda-inline-pill-button ${dateMatchTone}`}
          onClick={(event) => onPreviewPin(event, previewPayload)}
        >
          {getAgendaDateMatchLabel(item.appointment_date_match_status)}
        </button>
        {item.confirmation_status ? (
          <button
            type="button"
            className="agenda-inline-pill agenda-inline-pill-button neutral"
            onClick={(event) => onPreviewPin(event, previewPayload)}
          >
            {getAgendaConfirmationStatusLabel(item.confirmation_status)}
          </button>
        ) : null}
        {item.patient_fake_appointment ? (
          <button
            type="button"
            className="agenda-inline-pill agenda-inline-pill-button danger"
            onClick={(event) => onPreviewPin(event, previewPayload)}
          >
            Agendamento fake
          </button>
        ) : null}
      </div>
      <div className="agenda-card-secondary-meta">
        {recurrenceSummary ? <small>{recurrenceSummary}</small> : null}
        {item.requires_completion ? <small>Execução obrigatória</small> : null}
      </div>
      <div className="agenda-card-secondary-meta">
        {item.demand_type === 'patient' ? <small>{getAgendaDemandTypeLabel(item.demand_type)}</small> : null}
        {item.demand_type === 'patient' ? <small>{getAgendaConfirmationStatusLabel(item.confirmation_status)}</small> : null}
        {item.patient_specialty ? <small>{item.patient_specialty}</small> : null}
        {item.patient_channel ? <small>{item.patient_channel}</small> : null}
      </div>
      <div className="agenda-contact-grid">
        <article>
          <span>Telefone</span>
          <strong>{item.contact_phone_masked || 'Pendente'}</strong>
          <small>{item.contact_source || 'Busca automatica pendente'}</small>
        </article>
        <article>
          <span>Ultima validacao</span>
          <strong>{item.contact_last_checked_at ? formatDateTime(item.contact_last_checked_at) : 'Ainda nao validado'}</strong>
          <small>Confianca {formatAgendaConfidence(item.contact_confidence_score)}</small>
        </article>
      </div>
      <div className="agenda-assignee">
        <div>
          <span>Responsável principal</span>
          <strong>{formatAgendaAssignee(item)}</strong>
        </div>
        {ownerFollowUp ? <small>{ownerFollowUp}</small> : null}
      </div>
      <div className="agenda-task-meta">
        <span>{item.due_at ? `Prazo ${formatDateTime(item.due_at)}` : 'Sem prazo definido'}</span>
        {item.reminder_at ? <span>Lembrete {formatDateTime(item.reminder_at)}</span> : null}
        {item.clinic_name ? <span>Unidade {item.clinic_name}</span> : null}
        {item.patient_name ? <span>Paciente {item.patient_name}</span> : null}
        {item.patient_has_scheduled && item.patient_scheduled_at ? <span>Agendado para {formatDateTime(item.patient_scheduled_at)}</span> : null}
        {item.patient_fake_appointment ? <span className="agenda-fake-meta">Agendamento fake</span> : null}
        {executionStamp ? <span>{executionStamp}</span> : null}
      </div>
      {tags.length ? (
        <div className="agenda-tag-row">
          {tags.map((tag) => <small key={tag}>{tag}</small>)}
        </div>
      ) : null}
      <div className="agenda-card-actions">
        <button type="button" className="outline-action" onClick={(event) => onPreviewPin(event, previewPayload)}>
          Previa
        </button>
        <button
          type="button"
          className="outline-action"
          onClick={(event) => {
            event.stopPropagation();
            onOpenWhatsApp(item);
          }}
          disabled={!canOpenWhatsApp || openingWhatsappId === item.id}
          title={!canOpenWhatsApp ? 'Telefone nao disponivel. Execute a busca automatica ou atualize manualmente.' : 'Abrir WhatsApp'}
        >
          {openingWhatsappId === item.id ? 'Abrindo...' : 'Abrir WhatsApp'}
        </button>
        <button
          type="button"
          className="outline-action"
          onClick={(event) => {
            event.stopPropagation();
            onReprocessContact(item);
          }}
          disabled={reprocessingContactId === item.id}
        >
          {reprocessingContactId === item.id ? 'Atualizando...' : 'Atualizar telefone'}
        </button>
        {item.status !== 'doing' && item.status !== 'done' ? (
          <button type="button" onClick={(event) => {
            event.stopPropagation();
            onStatus(item, 'doing');
          }}
          >
            Iniciar
          </button>
        ) : null}
        {item.status !== 'done' ? (
          <button type="button" onClick={(event) => {
            event.stopPropagation();
            onStatus(item, 'done', { markExecuted: true });
          }}
          disabled={!canExecute}
          >
            {canExecute ? 'Registrar execução' : 'Aguardando responsável'}
          </button>
        ) : (
          <button type="button" onClick={(event) => {
            event.stopPropagation();
            onStatus(item, item.is_daily_recurring ? (item.recurrence_base_status || 'today') : 'todo');
          }}
          >
            {item.is_daily_recurring ? 'Reabrir ciclo' : 'Reabrir'}
          </button>
        )}
      </div>
    </article>
  );
}

export default function AgendaPage() {
  const currentUser = useMemo(() => readUser(), []);
  const currentUserId = String(currentUser?.id || '');
  const canDeleteAgendaItem = Boolean(currentUser?.id);
  const canUseAgendaAnalytics = canAccessAgendaAnalytics(currentUser);
  const canUseAgendaImportPanel = canUseAgendaImport(currentUser);
  const canUseAgendaConfirmationPanel = canUseAgendaConfirmationMonitor(currentUser);
  const canUseOperatorTabs = canUseAgendaOperatorTabs(currentUser);
  const canReplicateAgenda = canReplicateAgendaItems(currentUser);
  const [items, setItems] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [clinicOptions, setClinicOptions] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardDays, setDashboardDays] = useState('30');
  const [selectedEvolutionCollaboratorKey, setSelectedEvolutionCollaboratorKey] = useState('');
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [confirmationReport, setConfirmationReport] = useState(null);
  const [confirmationDays, setConfirmationDays] = useState('30');
  const [confirmationSearch, setConfirmationSearch] = useState('');
  const [confirmationStatus, setConfirmationStatus] = useState('all');
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [enrichmentReport, setEnrichmentReport] = useState(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [confirmationActiveTab, setConfirmationActiveTab] = useState(canUseAgendaAnalytics ? 'dashboard' : 'monitor');
  const [exportingReport, setExportingReport] = useState('');
  const [importDraft, setImportDraft] = useState(emptyImportDraft);
  const [importing, setImporting] = useState(false);
  const [validatingImport, setValidatingImport] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [importValidation, setImportValidation] = useState(null);
  const [replicationDraft, setReplicationDraft] = useState(emptyReplicationDraft);
  const [replicatingAgenda, setReplicatingAgenda] = useState(false);
  const [replicationSummary, setReplicationSummary] = useState(null);
  const [showAnalyticsPanel, setShowAnalyticsPanel] = useState(false);
  const [showConfirmationPanel, setShowConfirmationPanel] = useState(false);
  const [showEnrichmentPanel, setShowEnrichmentPanel] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [showReplicationPanel, setShowReplicationPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState('');
  const [activePatientQueue, setActivePatientQueue] = useState('all');
  const [activeAssignee, setActiveAssignee] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [reminderItem, setReminderItem] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [openingWhatsappId, setOpeningWhatsappId] = useState(null);
  const [reprocessingContactId, setReprocessingContactId] = useState(null);
  const [previewPopover, setPreviewPopover] = useState(null);
  const previewPopoverRef = useRef(null);
  const notifiedReminderIds = useRef(new Set());
  const titleInputRef = useRef(null);
  const previewCloseTimerRef = useRef(null);

  const loadItems = async () => {
    setLoading(true);
    setFeedback('');
    try {
      const response = await api.get('/api/agenda/items', {
        params: {
          search: search.trim() || undefined,
          status: activeStatus || undefined
        }
      });
      setItems(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Não foi possível carregar a agenda.'));
    } finally {
      setLoading(false);
    }
  };

  const loadAssignableUsers = async () => {
    try {
      const response = await api.get('/api/agenda/users');
      setAssignableUsers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setAssignableUsers(currentUser?.id ? [{
        id: currentUser.id,
        name: getUserDisplayName(currentUser),
        email: currentUser.email || null,
        role: currentUser.role || null
      }] : []);
      setFeedback(getApiErrorMessage(error, 'Não foi possível carregar usuários para atribuição.'));
    }
  };

  const loadClinics = async () => {
    if (!canUseAgendaImportPanel) {
      setClinicOptions([]);
      return;
    }

    try {
      const response = await api.get('/clinics');
      setClinicOptions(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setClinicOptions([]);
    }
  };

  const loadDashboard = async () => {
    if (!canUseAgendaAnalytics) {
      setDashboard(null);
      return;
    }

    setDashboardLoading(true);
    try {
      const response = await api.get('/api/agenda/dashboard', {
        params: {
          days: dashboardDays
        }
      });
      setDashboard(response.data || null);
    } catch (error) {
      setDashboard(null);
      setFeedback(getApiErrorMessage(error, 'Não foi possível carregar o dashboard da agenda.'));
    } finally {
      setDashboardLoading(false);
    }
  };

  const loadConfirmationReport = async () => {
    if (!canUseAgendaConfirmationPanel) {
      setConfirmationReport(null);
      return;
    }

    setConfirmationLoading(true);
    try {
      const endpoint = canUseAgendaAnalytics ? '/api/agenda/confirmations/dashboard' : '/api/agenda/confirmations';
      const response = await api.get(endpoint, {
        params: {
          days: confirmationDays,
          search: confirmationSearch.trim() || undefined,
          confirmationStatus: confirmationStatus !== 'all' ? confirmationStatus : undefined
        }
      });
      setConfirmationReport(response.data || null);
    } catch (error) {
      setConfirmationReport(null);
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel carregar a agenda de confirmacoes.'));
    } finally {
      setConfirmationLoading(false);
    }
  };

  const loadEnrichmentReport = async () => {
    if (!canUseAgendaImportPanel && !canUseAgendaConfirmationPanel) {
      setEnrichmentReport(null);
      return;
    }

    setEnrichmentLoading(true);
    try {
      const response = await api.get('/api/agenda/enrichment/overview');
      setEnrichmentReport(response.data || null);
    } catch (error) {
      setEnrichmentReport(null);
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel carregar o enriquecimento de telefones.'));
    } finally {
      setEnrichmentLoading(false);
    }
  };

  const runEnrichmentNow = async () => {
    setEnrichmentLoading(true);
    setFeedback('');
    try {
      const response = await api.post('/api/agenda/enrichment/run');
      await Promise.all([loadItems(), loadEnrichmentReport()]);
      setFeedback(response.data?.message || 'Busca de telefones executada com sucesso.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel executar a busca de telefones.'));
    } finally {
      setEnrichmentLoading(false);
    }
  };

  const reprocessContact = async (item) => {
    setReprocessingContactId(item.id);
    setFeedback('');
    try {
      const response = await api.post(`/api/agenda/items/${item.id}/reprocess-contact`);
      await Promise.all([loadItems(), loadEnrichmentReport()]);
      setFeedback(response.data?.message || 'Item enviado para nova busca de telefone.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel atualizar o telefone do paciente.'));
    } finally {
      setReprocessingContactId(null);
    }
  };

  const openAgendaWhatsApp = async (item) => {
    setOpeningWhatsappId(item.id);
    setFeedback('');
    try {
      const response = await api.post(`/api/agenda/items/${item.id}/open-whatsapp`);
      if (response.data?.url) {
        window.open(response.data.url, '_blank', 'noopener,noreferrer');
      }
      setFeedback('WhatsApp preparado com sucesso.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel abrir o WhatsApp deste agendamento.'));
    } finally {
      setOpeningWhatsappId(null);
    }
  };

  const clearPreviewCloseTimer = useCallback(() => {
    if (previewCloseTimerRef.current) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
  }, []);

  const schedulePreviewClose = () => {
    clearPreviewCloseTimer();
    previewCloseTimerRef.current = window.setTimeout(() => {
      setPreviewPopover((current) => (current?.pinned ? current : null));
      previewCloseTimerRef.current = null;
    }, 140);
  };

  const openPreviewPopover = (event, payload, pinned = false) => {
    if (!event?.currentTarget || !payload) return;
    clearPreviewCloseTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    const cardWidth = 320;
    const viewportWidth = window.innerWidth || 1440;
    const viewportHeight = window.innerHeight || 900;
    const preferredRight = rect.right + 14;
    const preferredLeft = rect.left - cardWidth - 14;
    const left = preferredRight + cardWidth <= viewportWidth - 16
      ? preferredRight
      : Math.max(16, Math.min(preferredLeft, viewportWidth - cardWidth - 16));
    const estimatedHeight = 232;
    const top = Math.max(88, Math.min(rect.top - 8, viewportHeight - estimatedHeight - 24));

    setPreviewPopover({
      pinned,
      left,
      top,
      width: cardWidth,
      payload
    });
  };

  const handlePreviewEnter = (event, payload) => openPreviewPopover(event, payload, false);
  const handlePreviewPin = (event, payload) => {
    event.preventDefault();
    event.stopPropagation();
    openPreviewPopover(event, payload, true);
  };
  const handlePreviewLeave = () => schedulePreviewClose();
  const closePreviewPopover = useCallback(() => {
    clearPreviewCloseTimer();
    setPreviewPopover(null);
  }, [clearPreviewCloseTimer]);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  useEffect(() => {
    loadAssignableUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadClinics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAgendaImportPanel]);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAgendaAnalytics, dashboardDays]);

  useEffect(() => {
    loadConfirmationReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAgendaConfirmationPanel, canUseAgendaAnalytics, confirmationDays, confirmationStatus]);

  useEffect(() => {
    loadEnrichmentReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAgendaImportPanel, canUseAgendaConfirmationPanel]);

  useEffect(() => {
    if (!canUseAgendaConfirmationPanel) return undefined;
    const timer = window.setTimeout(loadConfirmationReport, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmationSearch]);

  useEffect(() => {
    const collaboratorOptions = dashboard?.collaborators || [];
    if (!collaboratorOptions.length) {
      if (selectedEvolutionCollaboratorKey) {
        setSelectedEvolutionCollaboratorKey('');
      }
      return;
    }

    if (collaboratorOptions.some((item) => item.key === selectedEvolutionCollaboratorKey)) {
      return;
    }

    const preferredCollaborator = collaboratorOptions.find((item) => String(item.user_id || '') === currentUserId)
      || collaboratorOptions[0];
    setSelectedEvolutionCollaboratorKey(preferredCollaborator?.key || '');
  }, [currentUserId, dashboard, selectedEvolutionCollaboratorKey]);

  useEffect(() => {
    const timer = window.setTimeout(loadItems, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => () => clearPreviewCloseTimer(), [clearPreviewCloseTimer]);

  useEffect(() => {
    if (!previewPopover?.payload) return undefined;

    const handleWindowClick = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (previewPopoverRef.current?.contains(target)) return;
      if (target.closest('.agenda-task-card')) return;
      if (target.closest('.agenda-confirmation-preview-trigger')) return;
      if (target.closest('.agenda-inline-pill-button')) return;
      closePreviewPopover();
    };

    const handleWindowKeyDown = (event) => {
      if (event.key === 'Escape') {
        closePreviewPopover();
      }
    };

    window.addEventListener('click', handleWindowClick);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [closePreviewPopover, previewPopover?.payload]);

  useEffect(() => {
    const evaluateReminders = () => {
      const dueReminder = items
        .filter((item) => item.status !== 'done' && item.reminder_at && !item.reminder_acknowledged_at)
        .filter((item) => new Date(item.reminder_at).getTime() <= Date.now())
        .sort((a, b) => new Date(a.reminder_at) - new Date(b.reminder_at))[0];

      if (!dueReminder) return;
      setReminderItem(dueReminder);

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && !notifiedReminderIds.current.has(dueReminder.id)) {
        new Notification('Lembrete da Agenda', {
          body: dueReminder.title,
          tag: `agenda-${dueReminder.id}`
        });
        notifiedReminderIds.current.add(dueReminder.id);
      }
    };

    evaluateReminders();
    const timer = window.setInterval(evaluateReminders, 60000);
    return () => window.clearInterval(timer);
  }, [items]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [editorOpen]);

  const assigneeOptions = useMemo(() => {
    const byId = new Map();
    if (currentUser?.id) {
      byId.set(String(currentUser.id), {
        id: currentUser.id,
        name: getUserDisplayName(currentUser),
        email: currentUser.email || null,
        role: currentUser.role || null,
        position: currentUser.position || null,
        department: currentUser.department || null
      });
    }
    assignableUsers.forEach((user) => {
      if (user?.id) byId.set(String(user.id), user);
    });
    return Array.from(byId.values());
  }, [assignableUsers, currentUser]);

  const assigneeDirectory = useMemo(() => {
    const byId = new Map();
    assigneeOptions.forEach((user) => {
      if (user?.id) {
        byId.set(String(user.id), user);
      }
    });
    return byId;
  }, [assigneeOptions]);

  const replicationUserOptions = useMemo(() => (
    assigneeOptions
      .filter((user) => user?.id)
      .sort((left, right) => formatAgendaUserOption(left).localeCompare(formatAgendaUserOption(right), 'pt-BR'))
  ), [assigneeOptions]);

  const queueFilteredItems = useMemo(() => (
    items.filter((item) => matchesAgendaPatientQueue(item, activePatientQueue))
  ), [activePatientQueue, items]);

  const allAgendaBoards = useMemo(() => (
    buildAgendaBoards(queueFilteredItems, assigneeDirectory, currentUserId)
  ), [assigneeDirectory, currentUserId, queueFilteredItems]);

  useEffect(() => {
    if (!activeAssignee) return;
    if (allAgendaBoards.some((item) => item.key === activeAssignee)) return;
    setActiveAssignee('');
  }, [activeAssignee, allAgendaBoards]);

  const filteredItems = useMemo(() => (
    activeAssignee
      ? queueFilteredItems.filter((item) => buildAgendaBoardIdentity(item, assigneeDirectory).key === activeAssignee)
      : queueFilteredItems
  ), [activeAssignee, assigneeDirectory, queueFilteredItems]);

  const globalStats = useMemo(() => {
    const open = queueFilteredItems.filter((item) => item.status !== 'done').length;
    const overdue = queueFilteredItems.filter((item) => item.status !== 'done' && isOverdue(item.due_at)).length;
    const reminders = queueFilteredItems.filter((item) => item.status !== 'done' && item.reminder_at && !item.reminder_acknowledged_at).length;
    const done = queueFilteredItems.filter((item) => item.status === 'done').length;
    return { total: queueFilteredItems.length, open, overdue, reminders, done };
  }, [queueFilteredItems]);

  const stats = useMemo(() => {
    const open = filteredItems.filter((item) => item.status !== 'done').length;
    const overdue = filteredItems.filter((item) => item.status !== 'done' && isOverdue(item.due_at)).length;
    const reminders = filteredItems.filter((item) => item.status !== 'done' && item.reminder_at && !item.reminder_acknowledged_at).length;
    const done = filteredItems.filter((item) => item.status === 'done').length;
    return { total: filteredItems.length, open, overdue, reminders, done };
  }, [filteredItems]);

  const patientWorkflowStats = useMemo(() => {
    const patientItems = filteredItems.filter((item) => (item.demand_type || 'general') === 'patient' || item.patient_name || item.patient_phone);
    const confirmed = patientItems.filter((item) => item.confirmation_status === 'confirmado').length;
    const pending = patientItems.filter((item) => item.confirmation_status !== 'confirmado' && item.confirmation_status !== 'nao_confirmado').length;
    const evasion = patientItems.filter((item) => item.confirmation_status === 'nao_confirmado').length;
    const scheduled = patientItems.filter((item) => item.patient_has_scheduled).length;
    return {
      total: patientItems.length,
      confirmed,
      pending,
      evasion,
      scheduled,
      confirmationRate: patientItems.length ? Math.round((confirmed * 1000) / patientItems.length) / 10 : 0
    };
  }, [filteredItems]);

  const agendaBoards = useMemo(() => (
    activeAssignee
      ? allAgendaBoards.filter((board) => board.key === activeAssignee)
      : allAgendaBoards
  ), [activeAssignee, allAgendaBoards]);

  const activeAgendaBoard = useMemo(() => (
    allAgendaBoards.find((board) => board.key === activeAssignee) || null
  ), [activeAssignee, allAgendaBoards]);

  const operatorTabs = useMemo(() => {
    const summaryTabs = [{
      key: '',
      label: 'Visão geral',
      helper: 'Relatório consolidado da equipe',
      total: globalStats.total,
      open: globalStats.open,
      overdue: globalStats.overdue
    }];

    return summaryTabs.concat(allAgendaBoards.map((board) => ({
      key: board.key,
      label: board.label,
      helper: board.roleLabel || board.helper,
      total: board.total,
      open: board.open,
      overdue: board.overdue
    })));
  }, [allAgendaBoards, globalStats.open, globalStats.overdue, globalStats.total]);

  const teamDailySeries = useMemo(() => (
    Array.isArray(dashboard?.daily_series) ? dashboard.daily_series : []
  ), [dashboard]);

  const selectedEvolutionCollaborator = useMemo(() => (
    (dashboard?.collaborators || []).find((item) => item.key === selectedEvolutionCollaboratorKey) || null
  ), [dashboard, selectedEvolutionCollaboratorKey]);

  const selectedEvolutionSeries = useMemo(() => (
    Array.isArray(selectedEvolutionCollaborator?.daily_series) ? selectedEvolutionCollaborator.daily_series : []
  ), [selectedEvolutionCollaborator]);

  const dailyEvolutionMatrixDays = useMemo(() => (
    teamDailySeries.slice(-7)
  ), [teamDailySeries]);

  const dashboardSummaryCards = useMemo(() => ([
    { label: 'Demandas totais', value: dashboard?.summary?.total || 0, helper: 'base visível no período', tone: 'neutral' },
    { label: 'Abertas', value: dashboard?.summary?.open || 0, helper: 'em acompanhamento', tone: 'progress' },
    { label: 'Atrasadas', value: dashboard?.summary?.overdue || 0, helper: 'fora do prazo', tone: 'danger' },
    { label: 'Vencendo em 24h', value: dashboard?.summary?.due_24h || 0, helper: 'ação imediata', tone: 'warning' },
    { label: 'Concluídas em 7 dias', value: dashboard?.summary?.completed_7d || 0, helper: 'produtividade recente', tone: 'success' },
    { label: 'Média diária', value: dashboard?.summary?.daily_average_completed || 0, helper: 'entregas por dia', tone: 'success' },
    { label: 'Taxa de execução', value: formatAgendaPercent(dashboard?.summary?.completion_rate_period || 0), helper: 'concluídas sobre programadas', tone: 'progress' },
    { label: 'Confirmação', value: formatAgendaPercent(dashboard?.summary?.patient_confirmation_rate || 0), helper: 'pacientes confirmados por operador', tone: 'progress' },
    { label: 'Evasão', value: dashboard?.summary?.patient_evasion || 0, helper: 'não confirmaram e exigem tratativa', tone: 'danger' },
    { label: 'Rotinas recorrentes', value: dashboard?.summary?.recurring || 0, helper: 'voltam automaticamente ao fluxo', tone: 'neutral' }
  ]), [dashboard]);

  const agendaExecutiveHighlights = useMemo(() => ([
    {
      label: 'Performance operacional',
      value: formatAgendaPercent(dashboard?.summary?.completion_rate_period || 0),
      helper: `${dashboard?.summary?.completed_7d || 0} concluidas nos ultimos 7 dias`,
      accent: 'performance'
    },
    {
      label: 'Pressao imediata',
      value: dashboard?.summary?.due_24h || 0,
      helper: `${dashboard?.summary?.overdue || 0} atrasada(s) na agenda`,
      accent: 'attention'
    },
    {
      label: 'Fluxo de pacientes',
      value: formatAgendaPercent(dashboard?.summary?.patient_confirmation_rate || 0),
      helper: `${dashboard?.summary?.patient_evasion || 0} paciente(s) em evasao no periodo`,
      accent: 'patients'
    }
  ]), [dashboard]);

  const confirmationItems = useMemo(() => (
    Array.isArray(confirmationReport?.items) ? confirmationReport.items : []
  ), [confirmationReport]);

  const confirmationDailySeries = useMemo(() => (
    Array.isArray(confirmationReport?.daily_series) ? confirmationReport.daily_series : []
  ), [confirmationReport]);

  const confirmationSummaryCards = useMemo(() => ([
    { label: 'Pacientes', value: confirmationReport?.summary?.total || 0, helper: 'base monitorada', tone: 'neutral' },
    { label: 'Confirmados', value: confirmationReport?.summary?.confirmed || 0, helper: 'presenca validada', tone: 'success' },
    { label: 'Sem confirmacao', value: confirmationReport?.summary?.without_confirmation || 0, helper: 'precisam acompanhamento', tone: 'warning' },
    { label: 'WhatsApp enviado', value: confirmationReport?.summary?.sent || 0, helper: 'com data de disparo', tone: 'progress' },
    { label: 'Acao necessaria', value: confirmationReport?.summary?.action_required || 0, helper: 'prioridade operacional', tone: 'danger' },
    { label: 'Taxa de confirmacao', value: formatAgendaPercent(confirmationReport?.summary?.confirmation_rate || 0), helper: 'confirmados sobre total', tone: 'progress' }
  ]), [confirmationReport]);

  const openCreate = (status = 'todo', assignedUserId = currentUserId || '') => {
    setSelectedItem(null);
    setDraft({
      ...emptyDraft,
      status,
      assigned_user_id: assignedUserId,
      recurrence_base_status: 'todo'
    });
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    setSelectedItem(item);
    setDraft(normalizeDraftFromItem(item));
    setEditorOpen(true);
  };

  const openAgendaItemDetails = async (itemOrId) => {
    const itemId = Number(typeof itemOrId === 'object' ? itemOrId?.id : itemOrId);
    if (!itemId) return;

    const cachedItem = typeof itemOrId === 'object' && itemOrId?.id
      ? itemOrId
      : items.find((row) => Number(row.id) === itemId);

    if (cachedItem) {
      openEdit(cachedItem);
      return;
    }

    try {
      const response = await api.get(`/api/agenda/items/${itemId}`);
      openEdit(response.data || null);
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel abrir o detalhe do agendamento.'));
    }
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setSelectedItem(null);
    setDraft(emptyDraft);
  };

  const toggleRecurrenceWeekday = (weekdayValue) => {
    setDraft((current) => {
      const currentWeekdays = normalizeAgendaRecurrenceWeekdays(current.recurrence_weekdays);
      const hasWeekday = currentWeekdays.includes(weekdayValue);
      return {
        ...current,
        recurrence_weekdays: hasWeekday
          ? currentWeekdays.filter((weekday) => weekday !== weekdayValue)
          : [...currentWeekdays, weekdayValue].sort((left, right) => left - right)
      };
    });
  };

  const saveItem = async () => {
    if (!draft.title.trim()) {
      setFeedback('Informe um título para o item da agenda.');
      return;
    }
    if (draft.demand_type === 'patient' && !draft.patient_name.trim()) {
      setFeedback('Informe o nome do paciente para a demanda.');
      return;
    }

    setSaving(true);
    setFeedback('');

    const payload = {
      title: draft.title,
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      demand_type: draft.demand_type,
      patient_name: draft.demand_type === 'patient' ? draft.patient_name : null,
      patient_phone: draft.demand_type === 'patient' ? draft.patient_phone : null,
      patient_has_scheduled: draft.demand_type === 'patient' ? Boolean(draft.patient_has_scheduled) : false,
      patient_scheduled_at: draft.demand_type === 'patient' && draft.patient_has_scheduled ? (draft.patient_scheduled_at || null) : null,
      patient_fake_appointment: draft.demand_type === 'patient' ? Boolean(draft.patient_fake_appointment) : false,
      confirmation_status: draft.demand_type === 'patient' ? draft.confirmation_status : null,
      confirmation_notes: draft.demand_type === 'patient' ? draft.confirmation_notes : null,
      free_notes: draft.free_notes,
      due_at: draft.due_at || null,
      reminder_at: draft.reminder_at || null,
      assigned_user_id: draft.assigned_user_id || null,
      tags: draft.tags,
      is_daily_recurring: Boolean(draft.is_daily_recurring),
      requires_completion: Boolean(draft.is_daily_recurring || draft.requires_completion),
      recurrence_base_status: draft.is_daily_recurring ? (draft.recurrence_base_status || 'todo') : null,
      recurrence_weekdays: draft.is_daily_recurring ? normalizeAgendaRecurrenceWeekdays(draft.recurrence_weekdays) : []
    };

    try {
      if (selectedItem?.id) {
        await api.patch(`/api/agenda/items/${selectedItem.id}`, payload);
      } else {
        await api.post('/api/agenda/items', payload);
      }
      closeEditor();
      await Promise.all([loadItems(), loadDashboard(), loadEnrichmentReport()]);
      setFeedback('Agenda atualizada com sucesso.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Não foi possível salvar o item da agenda.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async () => {
    if (!selectedItem?.id) return;
    const confirmed = window.confirm(`Excluir "${selectedItem.title}" da agenda?`);
    if (!confirmed) return;
    const reason = window.prompt('Motivo da exclusao para auditoria:', 'Exclusao operacional do agendamento');
    setSaving(true);
    try {
      await api.delete(`/api/agenda/items/${selectedItem.id}`, {
        data: {
          reason: reason?.trim() || 'Exclusao operacional do agendamento'
        }
      });
      closeEditor();
      await Promise.all([loadItems(), loadDashboard()]);
      setFeedback('Agendamento excluido com auditoria registrada.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Não foi possível excluir o item.'));
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (item, status, extraPayload = {}) => {
    try {
      const response = await api.patch(`/api/agenda/items/${item.id}`, { status, ...extraPayload });
      const updatedItem = response.data;
      setItems((current) => current.map((row) => row.id === item.id ? updatedItem : row));
      if (canUseAgendaAnalytics) {
        loadDashboard();
      }
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Não foi possível mover o item.'));
    }
  };

  const handleDrop = async (status) => {
    const item = items.find((row) => row.id === draggingId);
    setDraggingId(null);
    if (!item || item.status === status) return;
    await updateStatus(item, status);
  };

  const acknowledgeReminder = async () => {
    if (!reminderItem?.id) return;
    try {
      await api.patch(`/api/agenda/items/${reminderItem.id}`, { ackReminder: true });
      setReminderItem(null);
      await loadItems();
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Não foi possível confirmar o lembrete.'));
    }
  };

  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      setFeedback('Este navegador não suporta notificações nativas.');
      return;
    }
    const permission = await Notification.requestPermission();
    setFeedback(permission === 'granted' ? 'Notificações da Agenda ativadas.' : 'Notificações não foram autorizadas.');
  };

  const updateImportDraft = (field, value) => {
    setImportDraft((current) => ({ ...current, [field]: value }));
    setImportValidation(null);
  };

  const downloadReport = async (format) => {
    setExportingReport(format);
    try {
      const response = await api.get(`/api/agenda/report/${format}`, {
        params: { days: dashboardDays },
        responseType: 'blob'
      });
      downloadBlob(
        response.data,
        format === 'pdf'
          ? `agenda-dashboard-${dashboardDays}d.pdf`
          : `agenda-dashboard-${dashboardDays}d.xlsx`
      );
    } catch (error) {
      setFeedback(getApiErrorMessage(error, `Não foi possível exportar o relatório da agenda em ${format.toUpperCase()}.`));
    } finally {
      setExportingReport('');
    }
  };

  const downloadTaskExport = async (format) => {
    const exportKey = `tasks-${format}`;
    setExportingReport(exportKey);
    try {
      const response = await api.get(`/api/agenda/items/export/${format}`, {
        params: {
          search: search.trim() || undefined,
          status: activeStatus || undefined,
          queue: activePatientQueue !== 'all' ? activePatientQueue : undefined,
          assignee: activeAssignee || undefined
        },
        responseType: 'blob'
      });
      downloadBlob(response.data, format === 'pdf' ? 'agenda-tarefas.pdf' : 'agenda-tarefas.xlsx');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, `Nao foi possivel exportar as tarefas em ${format.toUpperCase()}.`));
    } finally {
      setExportingReport('');
    }
  };

  const downloadConfirmationReport = async (format) => {
    const exportKey = `confirmations-${format}`;
    setExportingReport(exportKey);
    try {
      const response = await api.get(`/api/agenda/confirmations/export/${format}`, {
        params: {
          days: confirmationDays,
          search: confirmationSearch.trim() || undefined,
          confirmationStatus: confirmationStatus !== 'all' ? confirmationStatus : undefined
        },
        responseType: 'blob'
      });
      downloadBlob(response.data, format === 'pdf' ? 'agenda-confirmacoes.pdf' : 'agenda-confirmacoes.xlsx');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, `Nao foi possivel exportar as confirmacoes em ${format.toUpperCase()}.`));
    } finally {
      setExportingReport('');
    }
  };

  const downloadImportTemplate = async () => {
    setExportingReport('template');
    try {
      const response = await api.get('/api/agenda/import-template', {
        responseType: 'blob'
      });
      downloadBlob(response.data, 'template-importacao-agenda.xlsx');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Não foi possível baixar o template da agenda.'));
    } finally {
      setExportingReport('');
    }
  };

  const hasImportSourceContent = importDraft.source_mode === 'clipboard'
    ? Boolean(importDraft.raw_text.trim())
    : Boolean(importDraft.file);

  const buildAgendaImportFormData = () => {
    const formData = new FormData();
    if (importDraft.source_mode === 'clipboard') {
      formData.append('raw_text', importDraft.raw_text.trim());
    } else if (importDraft.file) {
      formData.append('file', importDraft.file);
    }
    formData.append('import_type', importDraft.import_type);
    formData.append('campaign_clinic_id', importDraft.clinic_id);
    formData.append('agenda_date', importDraft.agenda_date);
    if (importDraft.default_assigned_user_id) {
      formData.append('default_assigned_user_id', importDraft.default_assigned_user_id);
    }
    return formData;
  };

  const validateImport = async () => {
    if (!hasImportSourceContent) {
      setFeedback(importDraft.source_mode === 'clipboard'
        ? 'Cole o conteúdo bruto da agenda para validar.'
        : 'Selecione a planilha para validar a agenda.'
      );
      return null;
    }
    if (!importDraft.clinic_id) {
      setFeedback('Selecione a unidade da planilha antes de validar.');
      return null;
    }
    if (!importDraft.agenda_date) {
      setFeedback('Informe a data da agenda antes de validar.');
      return null;
    }

    setValidatingImport(true);
    setFeedback('');
    setImportSummary(null);

    try {
      const formData = buildAgendaImportFormData();

      const response = await api.post('/api/agenda/import/validate', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setImportValidation(response.data || null);
      setFeedback(response.data?.summary?.total_error
        ? 'Validação concluída com pendências. Corrija a planilha antes de importar.'
        : 'Validação concluída. A planilha está pronta para importação.'
      );
      return response.data || null;
    } catch (error) {
      setImportValidation(null);
      setFeedback(getApiErrorMessage(error, 'Não foi possível validar a planilha da agenda.'));
      return null;
    } finally {
      setValidatingImport(false);
    }
  };

  const submitImport = async () => {
    if (!hasImportSourceContent) {
      setFeedback(importDraft.source_mode === 'clipboard'
        ? 'Cole o conteúdo bruto da agenda para importar.'
        : 'Selecione a planilha para importar a agenda.'
      );
      return;
    }
    if (!importDraft.clinic_id) {
      setFeedback('Selecione a unidade da planilha antes de importar.');
      return;
    }
    if (!importDraft.agenda_date) {
      setFeedback('Informe a data da agenda antes de importar.');
      return;
    }

    const validation = importValidation || await validateImport();
    if (!validation) {
      return;
    }
    if (validation?.summary?.total_error) {
      setFeedback('A importação foi bloqueada porque ainda existem erros de validação na planilha.');
      return;
    }

    setImporting(true);
    setFeedback('');
    setImportSummary(null);

    try {
      const formData = buildAgendaImportFormData();
      formData.append('duplicate_strategy', importDraft.duplicate_strategy);
      formData.append('create_tasks', importDraft.create_tasks ? 'true' : 'false');
      formData.append('dispatch_whatsapp', importDraft.dispatch_whatsapp ? 'true' : 'false');
      if (importDraft.message_text.trim()) {
        formData.append('message_text', importDraft.message_text.trim());
      }

      const response = await api.post('/api/agenda/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setImportSummary(response.data || null);
      setImportDraft(emptyImportDraft);
      setImportValidation(null);
      await Promise.all([loadItems(), loadDashboard()]);
      setFeedback(response.data?.message || 'Importação da agenda concluída.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Não foi possível importar a planilha da agenda.'));
    } finally {
      setImporting(false);
    }
  };

  const updateReplicationDraft = (field, value) => {
    setReplicationDraft((current) => ({ ...current, [field]: value }));
    setReplicationSummary(null);
  };

  const replicateAgendaItems = async () => {
    if (!replicationDraft.source_user_id || !replicationDraft.target_user_id) {
      setFeedback('Selecione a pessoa de origem e a pessoa de destino para replicar a agenda.');
      return;
    }
    if (String(replicationDraft.source_user_id) === String(replicationDraft.target_user_id)) {
      setFeedback('Origem e destino precisam ser pessoas diferentes.');
      return;
    }

    const sourceUser = replicationUserOptions.find((user) => String(user.id) === String(replicationDraft.source_user_id));
    const targetUser = replicationUserOptions.find((user) => String(user.id) === String(replicationDraft.target_user_id));
    const confirmed = window.confirm(
      `Replicar tarefas de ${sourceUser?.name || 'origem'} para ${targetUser?.name || 'destino'}? As tarefas atuais serao mantidas.`
    );
    if (!confirmed) return;

    setReplicatingAgenda(true);
    setFeedback('');
    setReplicationSummary(null);

    try {
      const response = await api.post('/api/agenda/items/replicate', {
        source_user_id: replicationDraft.source_user_id,
        target_user_id: replicationDraft.target_user_id,
        include_done: Boolean(replicationDraft.include_done),
        skip_duplicates: Boolean(replicationDraft.skip_duplicates)
      });
      setReplicationSummary(response.data || null);
      setReplicationDraft(emptyReplicationDraft);
      await Promise.all([loadItems(), loadDashboard()]);
      setFeedback(response.data?.message || 'Agenda replicada com sucesso.');
    } catch (error) {
      setFeedback(getApiErrorMessage(error, 'Nao foi possivel replicar a agenda.'));
    } finally {
      setReplicatingAgenda(false);
    }
  };

  return (
    <main className="app-page agenda-page">
      <PageHeader
        eyebrow="Workspace"
        title="Agenda"
        description=""
        actions={(
          <>
            <button type="button" className="outline-action" onClick={requestNotifications}>Ativar lembretes</button>
            <button type="button" className="outline-action" onClick={() => downloadTaskExport('excel')} disabled={exportingReport === 'tasks-excel'}>
              Excel tarefas
            </button>
            <button type="button" className="outline-action" onClick={() => downloadTaskExport('pdf')} disabled={exportingReport === 'tasks-pdf'}>
              PDF tarefas
            </button>
            {canUseAgendaImportPanel ? (
              <button type="button" className="outline-action" onClick={() => setShowImportPanel(true)}>Importar agenda</button>
            ) : null}
            {canReplicateAgenda ? (
              <button type="button" className="outline-action" onClick={() => setShowReplicationPanel((current) => !current)}>
                Replicar agenda
              </button>
            ) : null}
            <button
              type="button"
              className="primary-action"
              onClick={() => openCreate('today', activeAgendaBoard?.userId ? String(activeAgendaBoard.userId) : (currentUserId || ''))}
            >
              Novo item
            </button>
          </>
        )}
      />

      {reminderItem ? (
        <section className="agenda-reminder-toast">
          <div>
            <span>Lembrete ativo</span>
            <strong>{reminderItem.title}</strong>
            <small>{formatDateTime(reminderItem.reminder_at)}</small>
          </div>
          <ActionButtons>
            <button type="button" className="outline-action" onClick={() => openAgendaItemDetails(reminderItem)}>Abrir</button>
            <button type="button" className="secondary-action" onClick={acknowledgeReminder}>Marcar como visto</button>
          </ActionButtons>
        </section>
      ) : null}

      {canReplicateAgenda && showReplicationPanel ? (
        <SectionContainer className="agenda-import-panel agenda-replication-panel">
          <div className="agenda-intelligence-head">
            <div>
              <span className="agenda-panel-kicker">Operacao assistida</span>
              <strong>Replicar tarefas entre colaboradores</strong>
              <small>Copie a agenda ativa de uma pessoa para outra sem mover, excluir ou alterar as tarefas originais.</small>
            </div>
            <div className="agenda-intelligence-actions">
              <button type="button" className="outline-action" onClick={() => setShowReplicationPanel(false)}>
                Fechar
              </button>
            </div>
          </div>

          <div className="agenda-import-grid">
            <label>
              Pessoa de origem
              <select
                className="field"
                value={replicationDraft.source_user_id}
                onChange={(event) => updateReplicationDraft('source_user_id', event.target.value)}
              >
                <option value="">Selecione quem sera copiado</option>
                {replicationUserOptions.map((user) => (
                  <option key={`replication-source-${user.id}`} value={String(user.id)}>{formatAgendaUserOption(user)}</option>
                ))}
              </select>
            </label>
            <label>
              Pessoa de destino
              <select
                className="field"
                value={replicationDraft.target_user_id}
                onChange={(event) => updateReplicationDraft('target_user_id', event.target.value)}
              >
                <option value="">Selecione quem recebera as tarefas</option>
                {replicationUserOptions.map((user) => (
                  <option key={`replication-target-${user.id}`} value={String(user.id)}>{formatAgendaUserOption(user)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="agenda-import-options">
            <label className="agenda-toggle-card">
              <input
                type="checkbox"
                checked={Boolean(replicationDraft.skip_duplicates)}
                onChange={(event) => updateReplicationDraft('skip_duplicates', event.target.checked)}
              />
              <div>
                <strong>Ignorar tarefas ja existentes</strong>
                <small>Evita criar copias quando o destino ja possui uma tarefa equivalente.</small>
              </div>
            </label>
            <label className="agenda-toggle-card">
              <input
                type="checkbox"
                checked={Boolean(replicationDraft.include_done)}
                onChange={(event) => updateReplicationDraft('include_done', event.target.checked)}
              />
              <div>
                <strong>Incluir concluidas</strong>
                <small>Quando marcado, tarefas concluidas da origem tambem serao copiadas, mas reabertas no destino.</small>
              </div>
            </label>
          </div>

          <div className="agenda-import-actions">
            <button
              type="button"
              className="primary-action"
              onClick={replicateAgendaItems}
              disabled={replicatingAgenda || replicationUserOptions.length < 2}
            >
              {replicatingAgenda ? 'Replicando...' : 'Replicar tarefas'}
            </button>
          </div>

          {replicationSummary ? (
            <div className="agenda-import-summary">
              <article>
                <span>Tarefas analisadas</span>
                <strong>{replicationSummary.sourceTotal || 0}</strong>
              </article>
              <article>
                <span>Tarefas criadas</span>
                <strong>{replicationSummary.created || 0}</strong>
              </article>
              <article>
                <span>Duplicidades ignoradas</span>
                <strong>{replicationSummary.skippedDuplicates || 0}</strong>
              </article>
              <article>
                <span>Destino</span>
                <strong>{replicationSummary.targetUser?.name || '-'}</strong>
              </article>
            </div>
          ) : null}
        </SectionContainer>
      ) : null}

      {canUseAgendaAnalytics || canUseAgendaImportPanel || canUseAgendaConfirmationPanel ? (
        <section className="agenda-executive-dock" aria-label="Atalhos executivos da agenda">
          {canUseAgendaAnalytics ? (
          <article className={`agenda-executive-toggle-card ${showAnalyticsPanel ? 'active' : ''}`}>
            <span>Inteligência</span>
            <strong>Dashboard executivo</strong>
            <small>Indicadores, evolução diária, produtividade por operador e demandas críticas.</small>
            <button type="button" className="outline-action" onClick={() => setShowAnalyticsPanel((current) => !current)}>
              {showAnalyticsPanel ? 'Ocultar painel' : 'Abrir painel'}
            </button>
          </article>
          ) : null}
          {canUseAgendaConfirmationPanel ? (
          <article className={`agenda-executive-toggle-card ${showConfirmationPanel ? 'active' : ''}`}>
            <span>Confirmacoes CRC</span>
            <strong>Agenda de confirmacao geral</strong>
            <small>Monitore pacientes confirmados, pendentes e datas de envio das mensagens pelo WhatsApp.</small>
            <button type="button" className="outline-action" onClick={() => setShowConfirmationPanel((current) => !current)}>
              {showConfirmationPanel ? 'Ocultar confirmacoes' : 'Abrir confirmacoes'}
            </button>
          </article>
          ) : null}
          {(canUseAgendaImportPanel || canUseAgendaConfirmationPanel) ? (
          <article className={`agenda-executive-toggle-card ${showEnrichmentPanel ? 'active' : ''}`}>
            <span>Enriquecimento</span>
            <strong>Telefones de pacientes</strong>
            <small>Monitore pendencias, buscas automaticas, revisoes e abertura do WhatsApp por paciente.</small>
            <div className="agenda-executive-card-actions">
              <button type="button" className="outline-action" onClick={() => setShowEnrichmentPanel((current) => !current)}>
                {showEnrichmentPanel ? 'Ocultar painel' : 'Abrir painel'}
              </button>
              <button type="button" className="secondary-action" onClick={runEnrichmentNow} disabled={enrichmentLoading}>
                {enrichmentLoading ? 'Buscando...' : 'Buscar telefones agora'}
              </button>
            </div>
          </article>
          ) : null}
          {canUseAgendaImportPanel ? (
          <article className={`agenda-executive-toggle-card ${showImportPanel ? 'active' : ''}`}>
            <span>Operação em lote</span>
            <strong>Importação profissional</strong>
            <small>Valide planilhas, trate duplicidades e alimente a agenda oficial com confirmação via WhatsApp.</small>
            <div className="agenda-executive-card-actions">
              <button type="button" className="outline-action" onClick={() => setShowImportPanel((current) => !current)}>
                {showImportPanel ? 'Ocultar importação' : 'Abrir importação'}
              </button>
              <button type="button" className="secondary-action" onClick={downloadImportTemplate} disabled={exportingReport === 'template'}>
                Template
              </button>
            </div>
          </article>
          ) : null}
        </section>
      ) : null}

      {(canUseAgendaAnalytics && showAnalyticsPanel) || (canUseAgendaConfirmationPanel && showConfirmationPanel) || showEnrichmentPanel || (canUseAgendaImportPanel && showImportPanel) ? (
        <section className="agenda-intelligence-stack">
          {canUseAgendaAnalytics && showAnalyticsPanel ? (
          <SectionContainer className="agenda-intelligence-panel">
            <div className="agenda-intelligence-head">
              <div>
                <span className="agenda-panel-kicker">Dashboard executivo</span>
                <strong>Visibilidade operacional da equipe CRC</strong>
                <small>Leitura rápida de produtividade, vencimentos e entregas por colaborador.</small>
              </div>
              <div className="agenda-intelligence-actions">
                <select className="field" value={dashboardDays} onChange={(event) => setDashboardDays(event.target.value)}>
                  {agendaDashboardWindowOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button type="button" className="outline-action" onClick={loadDashboard}>Atualizar painel</button>
                <button type="button" className="outline-action" onClick={() => downloadReport('excel')} disabled={exportingReport === 'excel'}>
                  Excel
                </button>
                <button type="button" className="outline-action" onClick={() => downloadReport('pdf')} disabled={exportingReport === 'pdf'}>
                  PDF
                </button>
              </div>
            </div>

            <div className="agenda-executive-highlight-grid">
              {agendaExecutiveHighlights.map((item) => (
                <article key={item.label} className={`agenda-executive-highlight-card ${item.accent}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.helper}</small>
                </article>
              ))}
            </div>

            <DashboardGrid className="agenda-intelligence-kpis">
              {dashboardSummaryCards.map((card) => (
                <KPICard key={card.label} label={card.label} value={card.value} helper={card.helper} tone={card.tone} />
              ))}
            </DashboardGrid>

            <div className="agenda-daily-dashboard-grid">
              <Card className="agenda-daily-chart-panel agenda-daily-chart-panel-wide">
                <div className="agenda-panel-headline">
                  <div>
                    <strong>Evolução diária da equipe</strong>
                    <span>Comparativo profissional entre demandas criadas, programadas e concluídas na janela selecionada.</span>
                  </div>
                  <small>{teamDailySeries.length} dia(s) monitorados</small>
                </div>
                <div className="agenda-chart-shell">
                  {teamDailySeries.length ? (
                    <ResponsiveContainer>
                      <ComposedChart data={teamDailySeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
                        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
                        <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 11 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 11 }} />
                        <Tooltip content={<AgendaDashboardTooltip />} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="created" name="Criadas" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                        <Bar yAxisId="left" dataKey="scheduled" name="Programadas" fill="#c89a57" radius={[6, 6, 0, 0]} />
                        <Line yAxisId="left" type="monotone" dataKey="completed" name="Concluidas" stroke="#1d8f6a" strokeWidth={3} dot={false} />
                        <Line yAxisId="right" type="monotone" dataKey="completion_rate" name="Taxa %" stroke="#4965ff" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="empty-state">Ainda não há histórico diário suficiente para gerar a evolução da equipe.</p>
                  )}
                </div>
              </Card>

              <Card className="agenda-daily-chart-panel">
                <div className="agenda-panel-headline">
                  <div>
                    <strong>Evolução individual</strong>
                    <span>Foco diário do colaborador para acompanhar ritmo, consistência e capacidade de entrega.</span>
                  </div>
                </div>
                <label className="agenda-dashboard-inline-filter">
                  Colaborador
                  <select
                    className="field"
                    value={selectedEvolutionCollaboratorKey}
                    onChange={(event) => setSelectedEvolutionCollaboratorKey(event.target.value)}
                  >
                    {(dashboard?.collaborators || []).map((item) => (
                      <option key={item.key} value={item.key}>{item.name}</option>
                    ))}
                  </select>
                </label>
                {selectedEvolutionCollaborator ? (
                  <>
                    <div className="agenda-daily-focus-metrics">
                      <article>
                        <span>Média diária</span>
                        <strong>{selectedEvolutionCollaborator.daily_average_completed || 0}</strong>
                        <small>conclusões por dia</small>
                      </article>
                      <article>
                        <span>Melhor dia</span>
                        <strong>{selectedEvolutionCollaborator.best_day_completed || 0}</strong>
                        <small>{selectedEvolutionCollaborator.best_day_date || 'Sem registro'}</small>
                      </article>
                      <article>
                        <span>Ritmo 7d</span>
                        <strong>{selectedEvolutionCollaborator.last_7d_completed || 0}</strong>
                        <small>{selectedEvolutionCollaborator.momentum_delta >= 0 ? `+${selectedEvolutionCollaborator.momentum_delta}` : selectedEvolutionCollaborator.momentum_delta} vs 7d anteriores</small>
                      </article>
                      <article>
                        <span>Taxa de execução</span>
                        <strong>{formatAgendaPercent(selectedEvolutionCollaborator.completion_rate_period || 0)}</strong>
                        <small>{selectedEvolutionCollaborator.current_streak || 0} dia(s) seguidos com entrega</small>
                      </article>
                    </div>
                    <div className="agenda-chart-shell agenda-chart-shell-compact">
                      {selectedEvolutionSeries.length ? (
                        <ResponsiveContainer>
                          <ComposedChart data={selectedEvolutionSeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
                            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
                            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                            <Tooltip content={<AgendaDashboardTooltip />} />
                            <Legend />
                            <Bar dataKey="created" name="Criadas" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
                            <Line type="monotone" dataKey="completed" name="Concluidas" stroke="#1d8f6a" strokeWidth={3} dot={false} />
                            <Line type="monotone" dataKey="scheduled" name="Programadas" stroke="#c89a57" strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="empty-state">Sem histórico diário para este colaborador na janela selecionada.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="empty-state">Selecione um colaborador para acompanhar a evolução diária.</p>
                )}
              </Card>
            </div>

            <Card className="agenda-daily-matrix-panel">
              <div className="agenda-panel-headline">
                <div>
                  <strong>Painel diário por colaborador</strong>
                  <span>Leitura comparativa das conclusões diárias para verificar evolução, consistência e variação operacional da equipe.</span>
                </div>
                <small>Últimos {dailyEvolutionMatrixDays.length || 0} dias</small>
              </div>
              <div className="agenda-daily-matrix-wrap">
                <table className="agenda-daily-matrix-table">
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      {dailyEvolutionMatrixDays.map((day) => (
                        <th key={day.date_key}>{day.label}</th>
                      ))}
                      <th>Média</th>
                      <th>Ritmo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dashboard?.collaborators || []).map((item) => (
                      <tr key={`${item.key}-daily-row`}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>{item.role || 'Equipe CRC'}</small>
                        </td>
                        {dailyEvolutionMatrixDays.map((day) => {
                          const point = (item.daily_series || []).find((entry) => entry.date_key === day.date_key);
                          const completed = Number(point?.completed || 0);
                          return (
                            <td key={`${item.key}-${day.date_key}`}>
                              <span className={`agenda-daily-metric-chip ${getAgendaEvolutionToneClass(completed)}`}>
                                {completed}
                              </span>
                            </td>
                          );
                        })}
                        <td>{item.daily_average_completed || 0}</td>
                        <td className={item.momentum_delta < 0 ? 'danger-cell' : ''}>
                          {item.momentum_delta >= 0 ? `+${item.momentum_delta}` : item.momentum_delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!dashboardLoading && !(dashboard?.collaborators || []).length ? <p className="empty-state">Nenhuma série diária disponível para os colaboradores.</p> : null}
              </div>
            </Card>

            <div className="agenda-intelligence-grid">
              <Card className="agenda-collaborator-panel">
                <div className="agenda-panel-headline">
                  <div>
                    <strong>Métricas por colaborador</strong>
                    <span>Produtividade individual, vencimentos e execução obrigatória.</span>
                  </div>
                  <small>{dashboardLoading ? 'Atualizando...' : `${dashboard?.collaborators?.length || 0} colaborador(es)`}</small>
                </div>
                <div className="agenda-collaborator-table-wrap">
                  <table className="agenda-collaborator-table">
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Abertas</th>
                        <th>Atrasadas</th>
                        <th>Confirmação</th>
                        <th>Evasão</th>
                        <th>24h</th>
                        <th>48h</th>
                        <th>Concl. 7d</th>
                        <th>Índice</th>
                        <th>Última execução</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dashboard?.collaborators || []).map((item) => (
                        <tr key={item.key}>
                          <td>
                            <strong>{item.name}</strong>
                            <small>{item.role || 'Equipe CRC'}</small>
                          </td>
                          <td>{item.open}</td>
                          <td className={item.overdue ? 'danger-cell' : ''}>{item.overdue}</td>
                          <td>{formatAgendaPercent(item.patient_confirmation_rate || 0)}</td>
                          <td className={item.patient_evasion ? 'danger-cell' : ''}>{item.patient_evasion || 0}</td>
                          <td>{item.due_24h}</td>
                          <td>{item.due_48h}</td>
                          <td>{item.completed_7d}</td>
                          <td>{item.productivity_index}%</td>
                          <td>{formatAgendaDashboardDate(item.last_completed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!dashboardLoading && !(dashboard?.collaborators || []).length ? <p className="empty-state">Nenhuma métrica de colaborador disponível.</p> : null}
                </div>
              </Card>

              <div className="agenda-insight-column">
                <Card className="agenda-ranking-panel">
                  <div className="agenda-panel-headline">
                    <div>
                      <strong>Destaques de entrega</strong>
                      <span>Quem mais executou no período selecionado.</span>
                    </div>
                  </div>
                  <div className="agenda-ranking-list">
                    {(dashboard?.top_performers || []).map((item, index) => (
                      <article key={`${item.key}-top`}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.completed_7d} entrega(s) nos últimos 7 dias</small>
                        </div>
                      </article>
                    ))}
                    {!dashboardLoading && !(dashboard?.top_performers || []).length ? <p className="empty-state">Sem destaques ainda.</p> : null}
                  </div>
                </Card>

                <Card className="agenda-urgent-panel">
                  <div className="agenda-panel-headline">
                    <div>
                      <strong>Demandas críticas</strong>
                      <span>Itens vencidos ou prestes a vencer para acompanhamento imediato.</span>
                    </div>
                  </div>
                  <div className="agenda-urgent-list">
                    {(dashboard?.urgent_items || []).map((item) => (
                      <article key={`urgent-${item.id}`} className={getAgendaDeadlineState(item).tone === 'late' ? 'late' : ''}>
                        <strong>{item.title}</strong>
                        <small>{item.assigned_user_name || 'Sem responsável'} · {item.clinic_name || 'Sem unidade'}</small>
                        <span>{item.due_at ? `Prazo ${formatAgendaDashboardDate(item.due_at)}` : 'Sem prazo definido'}</span>
                      </article>
                    ))}
                    {!dashboardLoading && !(dashboard?.urgent_items || []).length ? <p className="empty-state">Sem demandas críticas na janela atual.</p> : null}
                  </div>
                </Card>

                <Card className="agenda-urgent-panel">
                  <div className="agenda-panel-headline">
                    <div>
                      <strong>Lista de evasao</strong>
                      <span>Pacientes que não confirmaram e exigem retorno ativo do operador.</span>
                    </div>
                  </div>
                  <div className="agenda-urgent-list">
                    {(dashboard?.evasion_items || []).map((item) => (
                      <article key={`evasion-${item.id}`} className="late">
                        <strong>{item.patient_name || item.title}</strong>
                        <small>{item.assigned_user_name || 'Sem responsável'} · {item.clinic_name || 'Sem unidade'}</small>
                        <span>{item.confirmation_notes || 'Registrar motivo e plano de reversao.'}</span>
                      </article>
                    ))}
                    {!dashboardLoading && !(dashboard?.evasion_items || []).length ? <p className="empty-state">Nenhum paciente em evasao na janela atual.</p> : null}
                  </div>
                </Card>
              </div>
            </div>
          </SectionContainer>
          ) : null}

          {canUseAgendaConfirmationPanel && showConfirmationPanel ? (
          <SectionContainer className="agenda-intelligence-panel agenda-confirmation-panel">
            <div className="agenda-intelligence-head">
              <div>
                <span className="agenda-panel-kicker">Confirmacoes CRC</span>
                <strong>Agenda de confirmacao geral</strong>
                <small>Pacientes com status de confirmacao, datas de envio no WhatsApp e acao recomendada para acompanhamento proximo.</small>
              </div>
              <div className="agenda-intelligence-actions">
                <select className="field" value={confirmationDays} onChange={(event) => setConfirmationDays(event.target.value)}>
                  {agendaDashboardWindowOptions.map((option) => (
                    <option key={`confirmation-days-${option.value}`} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button type="button" className="outline-action" onClick={loadConfirmationReport} disabled={confirmationLoading}>
                  {confirmationLoading ? 'Atualizando...' : 'Atualizar'}
                </button>
                <button type="button" className="outline-action" onClick={() => downloadConfirmationReport('excel')} disabled={exportingReport === 'confirmations-excel'}>
                  Excel
                </button>
                <button type="button" className="outline-action" onClick={() => downloadConfirmationReport('pdf')} disabled={exportingReport === 'confirmations-pdf'}>
                  PDF
                </button>
              </div>
            </div>

            <div className="agenda-confirmation-tabs" role="tablist" aria-label="Confirmacoes da agenda">
              <button
                type="button"
                className={confirmationActiveTab === 'monitor' ? 'active' : ''}
                onClick={() => setConfirmationActiveTab('monitor')}
                role="tab"
                aria-selected={confirmationActiveTab === 'monitor'}
              >
                Monitor geral
              </button>
              {canUseAgendaAnalytics ? (
                <button
                  type="button"
                  className={confirmationActiveTab === 'dashboard' ? 'active' : ''}
                  onClick={() => setConfirmationActiveTab('dashboard')}
                  role="tab"
                  aria-selected={confirmationActiveTab === 'dashboard'}
                >
                  Dashboard lideranca
                </button>
              ) : null}
            </div>

            <DashboardGrid className="agenda-intelligence-kpis">
              {confirmationSummaryCards.map((card) => (
                <KPICard key={`confirmation-${card.label}`} label={card.label} value={card.value} helper={card.helper} tone={card.tone} />
              ))}
            </DashboardGrid>

            {confirmationActiveTab === 'dashboard' && canUseAgendaAnalytics ? (
              <div className="agenda-confirmation-dashboard">
                <Card className="agenda-daily-chart-panel agenda-daily-chart-panel-wide">
                  <div className="agenda-panel-headline">
                    <div>
                      <strong>Evolucao das confirmacoes</strong>
                      <span>Confirmados, pendentes e mensagens enviadas por dia na janela selecionada.</span>
                    </div>
                    <small>{confirmationDailySeries.length} dia(s)</small>
                  </div>
                  <div className="agenda-chart-shell">
                    {confirmationDailySeries.length ? (
                      <ResponsiveContainer>
                        <ComposedChart data={confirmationDailySeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.22)" />
                          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} />
                          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                          <Tooltip content={<AgendaDashboardTooltip />} />
                          <Legend />
                          <Bar dataKey="total" name="Pacientes" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
                          <Bar dataKey="sent" name="WhatsApp enviado" fill="#c89a57" radius={[6, 6, 0, 0]} />
                          <Line type="monotone" dataKey="confirmed" name="Confirmados" stroke="#1d8f6a" strokeWidth={3} dot={false} />
                          <Line type="monotone" dataKey="action_required" name="Acao necessaria" stroke="#dc2626" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="empty-state">Ainda nao ha dados suficientes para montar a evolucao diaria de confirmacoes.</p>
                    )}
                  </div>
                </Card>

                <div className="agenda-confirmation-dashboard-grid">
                  <Card className="agenda-dashboard-table-card">
                    <div className="agenda-panel-headline">
                      <div>
                        <strong>Evolucao por colaborador</strong>
                        <span>Taxa de confirmacao, envios e pacientes que exigem acao.</span>
                      </div>
                    </div>
                    <div className="agenda-dashboard-table-wrapper">
                      <table className="agenda-dashboard-table">
                        <thead>
                          <tr>
                            <th>Colaborador</th>
                            <th>Total</th>
                            <th>Confirmados</th>
                            <th>Sem confirmacao</th>
                            <th>Enviados</th>
                            <th>Acao</th>
                            <th>Taxa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(confirmationReport?.collaborators || []).map((item) => (
                            <tr key={`confirmation-user-${item.user_id || item.name}`}>
                              <td><strong>{item.name || item.label}</strong></td>
                              <td>{item.total}</td>
                              <td>{item.confirmed}</td>
                              <td className={item.without_confirmation ? 'danger-cell' : ''}>{item.without_confirmation}</td>
                              <td>{item.sent}</td>
                              <td className={item.action_required ? 'danger-cell' : ''}>{item.action_required}</td>
                              <td>{formatAgendaPercent(item.confirmation_rate || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!confirmationLoading && !(confirmationReport?.collaborators || []).length ? <p className="empty-state">Sem dados por colaborador na janela selecionada.</p> : null}
                    </div>
                  </Card>

                  <Card className="agenda-dashboard-table-card">
                    <div className="agenda-panel-headline">
                      <div>
                        <strong>Evolucao por clinica</strong>
                        <span>Comparativo das confirmacoes por unidade responsavel.</span>
                      </div>
                    </div>
                    <div className="agenda-dashboard-table-wrapper">
                      <table className="agenda-dashboard-table">
                        <thead>
                          <tr>
                            <th>Clinica</th>
                            <th>Total</th>
                            <th>Confirmados</th>
                            <th>Sem confirmacao</th>
                            <th>Enviados</th>
                            <th>Acao</th>
                            <th>Taxa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(confirmationReport?.clinics || []).map((item) => (
                            <tr key={`confirmation-clinic-${item.clinic_id || item.clinic_name}`}>
                              <td><strong>{item.clinic_name || item.label}</strong></td>
                              <td>{item.total}</td>
                              <td>{item.confirmed}</td>
                              <td className={item.without_confirmation ? 'danger-cell' : ''}>{item.without_confirmation}</td>
                              <td>{item.sent}</td>
                              <td className={item.action_required ? 'danger-cell' : ''}>{item.action_required}</td>
                              <td>{formatAgendaPercent(item.confirmation_rate || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!confirmationLoading && !(confirmationReport?.clinics || []).length ? <p className="empty-state">Sem dados por clinica na janela selecionada.</p> : null}
                    </div>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="agenda-confirmation-monitor">
                <div className="agenda-confirmation-filters">
                  <input
                    className="field"
                    value={confirmationSearch}
                    onChange={(event) => setConfirmationSearch(event.target.value)}
                    placeholder="Buscar paciente, telefone, clinica ou responsavel"
                  />
                  <select className="field" value={confirmationStatus} onChange={(event) => setConfirmationStatus(event.target.value)}>
                    {agendaConfirmationMonitorFilterOptions.map((option) => (
                      <option key={`confirmation-filter-${option.value}`} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div className="agenda-dashboard-table-wrapper agenda-confirmation-table-wrapper">
                  <table className="agenda-dashboard-table agenda-confirmation-table">
                    <thead>
                      <tr>
                        <th>Paciente</th>
                        <th>Clinica</th>
                        <th>Responsavel</th>
                        <th>Consulta</th>
                        <th>WhatsApp enviado</th>
                        <th>Status envio</th>
                        <th>Confirmacao</th>
                        <th>Ultima resposta</th>
                        <th>Acao recomendada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confirmationItems.slice(0, 150).map((item) => (
                        <tr
                          key={`confirmation-row-${item.agenda_item_id}`}
                          className={item.agenda_item_id ? 'agenda-confirmation-row-clickable' : ''}
                          onClick={() => {
                            if (item.agenda_item_id) {
                              openAgendaItemDetails(item.agenda_item_id);
                            }
                          }}
                          onMouseEnter={(event) => handlePreviewEnter(event, buildAgendaPreviewPayload(item, 'confirmation'))}
                          onMouseLeave={handlePreviewLeave}
                        >
                          <td>
                            <button
                              type="button"
                              className="agenda-confirmation-preview-trigger"
                              onClick={(event) => {
                                event.stopPropagation();
                                openAgendaItemDetails(item.agenda_item_id || item.id);
                              }}
                            >
                              {item.patient_name || '-'}
                            </button>
                            <small>{item.patient_phone || '-'}</small>
                          </td>
                          <td>{item.clinic_name || '-'}</td>
                          <td>{item.assigned_user_name || '-'}</td>
                          <td>{formatAgendaDashboardDate(item.patient_scheduled_at || item.due_at)}</td>
                          <td>{formatAgendaDashboardDate(item.whatsapp_sent_at)}</td>
                          <td>{item.whatsapp_status_label || '-'}</td>
                          <td>
                            <button
                              type="button"
                              className={`agenda-confirmation-badge agenda-inline-pill-button ${getAgendaConfirmationToneClass(item.confirmation_status)}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                handlePreviewPin(event, buildAgendaPreviewPayload(item, 'confirmation'));
                              }}
                            >
                              {item.confirmation_label || '-'}
                            </button>
                            {item.chatbot_decision_label && item.chatbot_decision_label !== '-' ? <small>{item.chatbot_decision_label}</small> : null}
                          </td>
                          <td>{formatAgendaDashboardDate(item.last_response_at)}</td>
                          <td className={item.needs_attention ? 'danger-cell' : ''}>{item.action_label || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!confirmationLoading && !confirmationItems.length ? <p className="empty-state">Nenhum paciente encontrado para os filtros selecionados.</p> : null}
                  {confirmationItems.length > 150 ? <p className="empty-state">Mostrando os primeiros 150 registros. Use a exportacao em Excel para analisar a base completa.</p> : null}
                </div>
              </div>
            )}
          </SectionContainer>
          ) : null}

          {showEnrichmentPanel ? (
          <SectionContainer className="agenda-intelligence-panel agenda-enrichment-panel">
            <div className="agenda-intelligence-head">
              <div>
                <span className="agenda-panel-kicker">Enriquecimento de telefones</span>
                <strong>Status do contato por paciente e por agenda</strong>
                <small>Visualize busca automatica, pendencias, revisoes, fonte do telefone e liberacao para WhatsApp.</small>
              </div>
              <div className="agenda-intelligence-actions">
                <button type="button" className="outline-action" onClick={loadEnrichmentReport} disabled={enrichmentLoading}>
                  Atualizar painel
                </button>
                <button type="button" className="secondary-action" onClick={runEnrichmentNow} disabled={enrichmentLoading}>
                  {enrichmentLoading ? 'Buscando...' : 'Buscar telefones agora'}
                </button>
              </div>
            </div>

            <div className="agenda-import-summary">
              <article>
                <span>Total na fila</span>
                <strong>{enrichmentReport?.summary?.total || 0}</strong>
              </article>
              <article>
                <span>Pendentes</span>
                <strong>{enrichmentReport?.summary?.pending || 0}</strong>
              </article>
              <article>
                <span>Em processamento</span>
                <strong>{enrichmentReport?.summary?.processing || 0}</strong>
              </article>
              <article>
                <span>Encontrados</span>
                <strong>{enrichmentReport?.summary?.found || 0}</strong>
              </article>
              <article>
                <span>Revisao</span>
                <strong>{enrichmentReport?.summary?.reviewRequired || 0}</strong>
              </article>
              <article>
                <span>Erros</span>
                <strong>{enrichmentReport?.summary?.errors || 0}</strong>
              </article>
            </div>

            <div className="agenda-card-secondary-meta">
              <small>{enrichmentReport?.robot?.configured ? 'Robo configurado' : 'Robo pendente de configuracao'}</small>
              <small>{enrichmentReport?.robot?.autoAfterUpload ? 'Busca automatica ativa' : 'Busca automatica desativada'}</small>
              <small>{enrichmentReport?.robot?.whatsappOpenMode === 'web' ? 'WhatsApp Web habilitado' : 'WhatsApp com modo customizado'}</small>
            </div>

            <div className="agenda-import-table-shell">
              <table className="agenda-import-table">
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Clinica</th>
                    <th>Agenda</th>
                    <th>Telefone</th>
                    <th>Status</th>
                    <th>Data</th>
                    <th>Fonte</th>
                    <th>Confianca</th>
                    <th>Metodo</th>
                    <th>Tentativas</th>
                    <th>Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {(enrichmentReport?.rows || []).slice(0, 120).map((row) => (
                    <tr key={`enrichment-${row.id}`}>
                      <td>{row.patient_name || '-'}</td>
                      <td>{row.clinic_name || '-'}</td>
                      <td>{row.appointment_label || '-'}</td>
                      <td>{row.phone_masked || 'Pendente'}</td>
                      <td>{getAgendaContactStatusLabel(row.contact_status || row.status)}</td>
                      <td>{getAgendaDateMatchLabel(row.appointment_date_match_status)}</td>
                      <td>{row.contact_source || row.source || '-'}</td>
                      <td>{formatAgendaConfidence(row.contact_confidence_score || row.confidence_score)}</td>
                      <td>{row.match_method || '-'}</td>
                      <td>{row.attempts || 0}</td>
                      <td>{row.error_message || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!enrichmentLoading && !(enrichmentReport?.rows || []).length ? <p className="empty-state">Nenhum item na fila de enriquecimento para os filtros atuais.</p> : null}
            </div>
          </SectionContainer>
          ) : null}

          {canUseAgendaImportPanel && showImportPanel ? (
          <SectionContainer className="agenda-import-panel">
            <div className="agenda-intelligence-head">
              <div>
                <span className="agenda-panel-kicker">Importação profissional</span>
                <strong>Planilha para demandas e confirmação via WhatsApp</strong>
                <small>Use a mesma base para cadastrar tarefas por colaborador e disparar confirmações em massa com unidade selecionada.</small>
              </div>
              <div className="agenda-intelligence-actions">
                <button type="button" className="outline-action" onClick={downloadImportTemplate} disabled={exportingReport === 'template'}>
                  Baixar template
                </button>
              </div>
            </div>

            <div className="agenda-import-grid">
              <label>
                Origem da importacao
                <select className="field" value={importDraft.source_mode} onChange={(event) => updateImportDraft('source_mode', event.target.value)}>
                  <option value="clipboard">Importar por Colagem Direta</option>
                  <option value="file">Importar por Planilha</option>
                </select>
              </label>
              {importDraft.source_mode === 'file' ? (
              <label>
                Planilha
                <input
                  className="field"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => updateImportDraft('file', event.target.files?.[0] || null)}
                />
              </label>
              ) : null}
              <label>
                Tipo de importação
                <select className="field" value={importDraft.import_type} onChange={(event) => updateImportDraft('import_type', event.target.value)}>
                  {agendaImportTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Unidade da planilha
                <select className="field" value={importDraft.clinic_id} onChange={(event) => updateImportDraft('clinic_id', event.target.value)}>
                  <option value="">Selecione a unidade</option>
                  {clinicOptions.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                  ))}
                </select>
                {!clinicOptions.length ? <small>Nenhuma clinica vinculada ao seu usuario. Peca ao Administrador Master para definir suas unidades.</small> : null}
              </label>
              <label>
                Responsável padrão
                <select className="field" value={importDraft.default_assigned_user_id} onChange={(event) => updateImportDraft('default_assigned_user_id', event.target.value)}>
                  <option value="">Usar colaborador da planilha</option>
                  {assigneeOptions.map((user) => (
                    <option key={user.id} value={user.id}>{formatAgendaUserOption(user)}</option>
                  ))}
                </select>
              </label>
              <label>
                Data da agenda
                <input
                  className="field"
                  type="date"
                  value={importDraft.agenda_date}
                  onChange={(event) => updateImportDraft('agenda_date', event.target.value)}
                />
                <small>Essa data sera aplicada a todos os pacientes reconstruidos pelo parser.</small>
              </label>
              <label>
                Duplicidade
                <select className="field" value={importDraft.duplicate_strategy} onChange={(event) => updateImportDraft('duplicate_strategy', event.target.value)}>
                  {agendaDuplicateStrategyOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {importDraft.source_mode === 'clipboard' ? (
              <label>
                Conteudo bruto da agenda
                <textarea
                  className="field agenda-import-message"
                  value={importDraft.raw_text}
                  onChange={(event) => updateImportDraft('raw_text', event.target.value)}
                  placeholder={'Cole aqui a agenda copiada do sistema externo.\n\nExemplo:\nWHRV6\nLidiane Freitas Cardoso\n08:15\nA Confirmar\nReavaliacao\nFollow up\nFachada'}
                  rows={14}
                />
                <small>O sistema ignora linhas tecnicas, remonta os blocos por paciente e usa a data informada acima.</small>
              </label>
            ) : null}

            <div className="agenda-import-options">
              <label className="agenda-toggle-card">
                <input type="checkbox" checked={importDraft.create_tasks} onChange={(event) => updateImportDraft('create_tasks', event.target.checked)} />
                <div>
                  <strong>Cadastrar demandas</strong>
                  <small>Cria as tarefas da agenda por colaborador, mantendo prazo, rotina diária e unidade.</small>
                </div>
              </label>
              <label className="agenda-toggle-card">
                <input type="checkbox" checked={importDraft.dispatch_whatsapp} onChange={(event) => updateImportDraft('dispatch_whatsapp', event.target.checked)} />
                <div>
                  <strong>Enviar confirmação via WhatsApp</strong>
                  <small>Usa a mesma planilha para enfileirar as mensagens padrão de confirmação para os pacientes.</small>
                </div>
              </label>
            </div>

            {importDraft.dispatch_whatsapp ? (
              <label>
                Mensagem padrão de confirmação
                <textarea
                  className="field agenda-import-message"
                  value={importDraft.message_text}
                  onChange={(event) => updateImportDraft('message_text', event.target.value)}
                  placeholder="Deixe em branco para usar a mensagem padrão profissional de confirmação."
                />
              </label>
            ) : null}

            <div className="agenda-import-actions">
              <button type="button" className="outline-action" onClick={validateImport} disabled={validatingImport || importing}>
                {validatingImport ? 'Validando...' : 'Validar dados'}
              </button>
              <button type="button" className="primary-action" onClick={submitImport} disabled={importing}>
                {importing ? 'Importando...' : 'Importar agenda'}
              </button>
            </div>

            {importValidation ? (
              <>
                <div className="agenda-import-summary">
                  <article>
                    <span>Total encontrado</span>
                    <strong>{importValidation.summary?.total_found || 0}</strong>
                  </article>
                  <article>
                    <span>Total valido</span>
                    <strong>{importValidation.summary?.total_valid || 0}</strong>
                  </article>
                  <article>
                    <span>Total duplicado</span>
                    <strong>{importValidation.summary?.total_duplicate || 0}</strong>
                  </article>
                  <article>
                    <span>Total com erro</span>
                    <strong>{importValidation.summary?.total_error || 0}</strong>
                  </article>
                  <article>
                    <span>Total com alerta</span>
                    <strong>{importValidation.summary?.total_alert || 0}</strong>
                  </article>
                </div>
                <div className="agenda-dashboard-table-wrapper">
                  <table className="agenda-dashboard-table">
                    <thead>
                      <tr>
                        <th>Paciente</th>
                        <th>Telefone</th>
                        <th>Data</th>
                        <th>Hora</th>
                        <th>Status</th>
                        <th>Especialidade</th>
                        <th>Dentista</th>
                        <th>Canal</th>
                        <th>Resultado</th>
                        <th>Observacoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(importValidation.rows || []).slice(0, 25).map((row) => (
                        <tr key={`agenda-import-validation-${row.line}`}>
                          <td>
                            <strong>{row.patient_name || `Linha ${row.line}`}</strong>
                          </td>
                          <td>{row.patient_phone || '-'}</td>
                          <td>{row.data_consulta || '-'}</td>
                          <td>{row.hora_consulta || '-'}</td>
                          <td>{row.status || '-'}</td>
                          <td>{row.patient_specialty || '-'}</td>
                          <td>{row.patient_dentist || '-'}</td>
                          <td>{row.patient_channel || '-'}</td>
                          <td>{getAgendaImportResultLabel(row.result)}</td>
                          <td>
                            {[...(row.reasons || []), ...(row.warnings || [])].length
                              ? <small className="table-helper">{[...(row.reasons || []), ...(row.warnings || [])].join(' | ')}</small>
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {importSummary ? (
              <div className="agenda-import-summary">
                <article>
                  <span>Demandas criadas</span>
                  <strong>{importSummary.created || 0}</strong>
                </article>
                <article>
                  <span>Demandas atualizadas</span>
                  <strong>{importSummary.updated || 0}</strong>
                </article>
                <article>
                  <span>WhatsApp enfileirado</span>
                  <strong>{importSummary.whatsappQueued || 0}</strong>
                </article>
                <article>
                  <span>Busca de telefones</span>
                  <strong>{importSummary.phoneEnrichmentQueued || 0}</strong>
                </article>
                <article>
                  <span>Duplicidades ignoradas</span>
                  <strong>{importSummary.duplicateSkipped || 0}</strong>
                </article>
              </div>
            ) : null}

            {importSummary?.invalidRows?.length ? (
              <div className="agenda-import-issues">
                <strong>Linhas com pendência</strong>
                <div className="agenda-import-issue-list">
                  {importSummary.invalidRows.map((item, index) => (
                    <p key={`${item.line || index}-${item.reason}`}>{item.reason}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </SectionContainer>
          ) : null}
        </section>
      ) : null}

      <section className="agenda-command-center">
        <div className="agenda-command-head">
          <div>
            <span>Central de operação</span>
            <strong>Agenda ativa</strong>
            <small>Filtre, priorize e acompanhe as filas antes de movimentar os cartões.</small>
          </div>
          <div className="agenda-command-summary">
            <span>{stats.total} item(ns)</span>
            <span>{stats.open} aberto(s)</span>
            <span>{stats.overdue} atrasado(s)</span>
          </div>
        </div>

      <div className="agenda-box-visual-grid">
        <article className="agenda-box-visual-card backlog">
          <span>Volume visivel</span>
          <strong>{stats.total}</strong>
          <small>{stats.done} concluido(s) no recorte atual</small>
        </article>
        <article className="agenda-box-visual-card confirmation">
          <span>Confirmacoes</span>
          <strong>{patientWorkflowStats.pending}</strong>
          <small>{patientWorkflowStats.confirmed} confirmado(s)</small>
        </article>
        <article className="agenda-box-visual-card reminders">
          <span>Lembretes</span>
          <strong>{stats.reminders}</strong>
          <small>{patientWorkflowStats.evasion} caso(s) em evasao</small>
        </article>
        <article className="agenda-box-visual-card team">
          <span>Responsaveis</span>
          <strong>{agendaBoards.length}</strong>
          <small>boxes organizados por operador</small>
        </article>
      </div>

      <DashboardGrid className="agenda-kpis">
        <KPICard label="Total" value={stats.total} helper="itens na agenda" tone="neutral" />
        <KPICard label="Abertos" value={stats.open} helper="em acompanhamento" tone="progress" />
        <KPICard label="Lembretes" value={stats.reminders} helper="ativos ou programados" tone="warning" />
        <KPICard label="Atrasados" value={stats.overdue} helper="fora do prazo" tone="danger" />
        <KPICard label="Concluídos" value={stats.done} helper="finalizados" tone="success" />
        <KPICard label="Confirmação" value={formatAgendaPercent(patientWorkflowStats.confirmationRate)} helper={`${patientWorkflowStats.confirmed}/${patientWorkflowStats.total || 0} pacientes confirmados`} tone="progress" />
        <KPICard label="Pendentes" value={patientWorkflowStats.pending} helper="pacientes aguardando retorno" tone="warning" />
        <KPICard label="Evasão" value={patientWorkflowStats.evasion} helper="não confirmaram e pedem tratativa" tone="danger" />
      </DashboardGrid>

      <SectionContainer className="agenda-control-panel">
        <div className="agenda-toolbar">
          <div className="agenda-toolbar-copy">
            <strong>Controle operacional</strong>
            <span>Filtre, acompanhe e mova as tarefas entre etapas.</span>
          </div>
          <div className="agenda-toolbar-filters">
            <input
              className="field"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar item, paciente, unidade, descrição ou tag"
            />
            <select className="field" value={activeStatus} onChange={(event) => setActiveStatus(event.target.value)}>
              <option value="">Todos os status</option>
              {agendaColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
            </select>
            <select className="field" value={activeAssignee} onChange={(event) => setActiveAssignee(event.target.value)}>
              <option value="">{canUseOperatorTabs ? 'Todas as agendas' : 'Todos os usuários'}</option>
              {allAgendaBoards.map((board) => (
                <option key={board.key} value={board.key}>{board.label}</option>
              ))}
            </select>
            <button type="button" className="outline-action" onClick={loadItems}>Atualizar</button>
          </div>
        </div>
      </SectionContainer>

      <SectionContainer className="agenda-tabs-panel">
        <div className="agenda-tabs-head">
          <div>
            <strong>Filas da agenda</strong>
            <span>Separe a operacao geral, as confirmacoes pendentes e a lista de evasao para tratativa.</span>
          </div>
        </div>
        <div className="agenda-tabs-strip" role="tablist" aria-label="Filas da agenda">
          {agendaPatientQueueOptions.map((tab) => {
            const isActive = activePatientQueue === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                className={`agenda-tab-button ${isActive ? 'active' : ''}`}
                onClick={() => setActivePatientQueue(tab.value)}
                role="tab"
                aria-selected={isActive}
              >
                <strong>{tab.label}</strong>
                <span>{tab.helper}</span>
                <small>
                  {tab.value === 'pending_confirmation'
                    ? `${patientWorkflowStats.pending} pendente(s)`
                    : tab.value === 'evasion'
                      ? `${patientWorkflowStats.evasion} caso(s)`
                      : `${stats.total} item(ns)`}
                </small>
              </button>
            );
          })}
        </div>
      </SectionContainer>

      {canUseOperatorTabs && operatorTabs.length > 2 ? (
        <SectionContainer className="agenda-tabs-panel">
          <div className="agenda-tabs-head">
            <div>
              <strong>Abas por operador</strong>
              <span>Troque rapidamente entre as agendas individuais. O relatório executivo continua sintético e consolidado com todos os operadores em uso.</span>
            </div>
          </div>
          <div className="agenda-tabs-strip" role="tablist" aria-label="Agendas por operador">
            {operatorTabs.map((tab) => {
              const isActive = activeAssignee === tab.key;
              return (
                <button
                  key={tab.key || 'all'}
                  type="button"
                  className={`agenda-tab-button ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveAssignee(tab.key)}
                  role="tab"
                  aria-selected={isActive}
                >
                  <strong>{tab.label}</strong>
                  <span>{tab.helper}</span>
                  <small>{tab.open} aberta(s) · {tab.overdue} atrasada(s)</small>
                </button>
              );
            })}
          </div>
        </SectionContainer>
      ) : null}
      </section>

      {feedback && !editorOpen ? <p className="form-feedback">{feedback}</p> : null}

      <section className="agenda-workspace">
        <div className="agenda-user-groups">
          {agendaBoards.map((group) => (
            <section key={group.key} className="agenda-user-section">
              <header className="agenda-user-header">
                <div className="agenda-user-copy">
                  <span className="agenda-user-kicker">Responsável</span>
                  <strong>{group.label}</strong>
                  <small>{group.roleLabel ? `${group.roleLabel} · ${group.helper}` : group.helper}</small>
                </div>
                <div className="agenda-user-stats">
                  <article>
                    <span>Total</span>
                    <strong>{group.total}</strong>
                  </article>
                  <article>
                    <span>Abertos</span>
                    <strong>{group.open}</strong>
                  </article>
                  <article>
                    <span>Atrasados</span>
                    <strong>{group.overdue}</strong>
                  </article>
                  <article>
                    <span>Concluídos</span>
                    <strong>{group.done}</strong>
                  </article>
                </div>
              </header>

              <div className="agenda-board-scroller">
                <div className="agenda-board">
                  {agendaColumns.map((column) => (
                    <section
                      key={`${group.key}-${column.key}`}
                      className={`agenda-column agenda-column-${column.key}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop(column.key)}
                    >
                      <header>
                        <div>
                          <p className="agenda-column-kicker">{column.eyebrow}</p>
                          <strong>{column.label}</strong>
                          <small>{column.helper}</small>
                        </div>
                        <span>{group.columns[column.key]?.length || 0}</span>
                      </header>
                      <button
                        type="button"
                        className="agenda-add-card"
                        onClick={() => openCreate(column.key, group.userId ? String(group.userId) : '')}
                      >
                        + adicionar
                      </button>
                      <div className="agenda-card-list">
                        {loading ? <p className="empty-mini">Carregando agenda...</p> : null}
                        {!loading && group.columns[column.key]?.length ? buildAgendaClinicGroups(group.columns[column.key]).map((clinicGroup) => (
                          <section key={`${group.key}-${column.key}-${clinicGroup.key}`} className="agenda-clinic-bucket">
                            <header className="agenda-clinic-bucket-head">
                              <div>
                                <span>Clínica</span>
                                <strong>{clinicGroup.clinicName}</strong>
                              </div>
                              <div className="agenda-clinic-bucket-stats">
                                <small>{clinicGroup.total} total</small>
                                <small>{clinicGroup.confirmed} conf.</small>
                                <small>{clinicGroup.pending} pend.</small>
                                {clinicGroup.fake ? <small className="danger">{clinicGroup.fake} fake</small> : null}
                              </div>
                            </header>
                            <div className="agenda-clinic-bucket-list">
                              {clinicGroup.items.map((item) => (
                                <AgendaCard
                                  key={item.id}
                                  item={item}
                                  currentUserId={currentUserId}
                                  onOpen={openAgendaItemDetails}
                                  onStatus={updateStatus}
                                  onDragStart={setDraggingId}
                                  onOpenWhatsApp={openAgendaWhatsApp}
                                  onReprocessContact={reprocessContact}
                                  onPreviewEnter={handlePreviewEnter}
                                  onPreviewLeave={handlePreviewLeave}
                                  onPreviewPin={handlePreviewPin}
                                  openingWhatsappId={openingWhatsappId}
                                  reprocessingContactId={reprocessingContactId}
                                />
                              ))}
                            </div>
                          </section>
                        )) : null}
                        {!loading && !group.columns[column.key]?.length ? <p className="empty-mini">Sem itens nesta etapa.</p> : null}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </section>
          ))}
          {!loading && agendaBoards.length === 0 ? <p className="empty-state">Nenhum item encontrado para os filtros selecionados.</p> : null}
        </div>
      </section>

      {editorOpen ? (
        <section className="agenda-editor-shell" role="dialog" aria-modal="true" aria-label={selectedItem?.id ? 'Editar item da agenda' : 'Criar item da agenda'}>
          <button type="button" className="agenda-editor-backdrop" aria-label="Fechar agenda" onClick={closeEditor} />
          <aside className="agenda-editor-panel">
            <header className="agenda-editor-hero">
              <div>
                <p className="eyebrow">{selectedItem?.id ? 'Detalhe da tarefa' : 'Novo item'}</p>
                <h2>{selectedItem?.id ? selectedItem.title : 'Criar item na agenda'}</h2>
                <span>Cadastre a tarefa com prazo, prioridade, lembrete e contexto operacional.</span>
              </div>
              <button type="button" className="agenda-editor-close" onClick={closeEditor} aria-label="Fechar">×</button>
            </header>

            {feedback ? <p className="form-feedback agenda-editor-feedback">{feedback}</p> : null}

            <div className="agenda-editor-body">
              <div className="agenda-editor-main">
                <div className="agenda-editor-summary-strip">
                  <article>
                    <span>Responsável</span>
                    <strong>{draft.assigned_user_id ? (assigneeOptions.find((user) => String(user.id) === String(draft.assigned_user_id))?.name || 'Selecionado') : 'Sem responsável'}</strong>
                  </article>
                  <article>
                    <span>Fluxo</span>
                    <strong>{agendaColumns.find((column) => column.key === draft.status)?.label || 'A fazer'}</strong>
                  </article>
                  <article className={draft.patient_fake_appointment ? 'danger' : ''}>
                    <span>Agenda</span>
                    <strong>{draft.patient_fake_appointment ? 'Fake' : draft.patient_has_scheduled ? 'Agendada' : 'Sem agendamento'}</strong>
                  </article>
                </div>
                <label>
                  Titulo da tarefa
                  <input
                    ref={titleInputRef}
                    className="field agenda-title-field"
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Ex.: Retornar paciente, revisar protocolo, cobrar evidência"
                  />
                </label>
                <label>
                  Descricao
                  <textarea
                    className="field agenda-textarea"
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Descreva o objetivo, contexto, combinados e qualquer detalhe importante."
                  />
                </label>
                <label>
                  Observações livres
                  <textarea
                    className="field agenda-textarea agenda-free-notes"
                    value={draft.free_notes}
                    onChange={(event) => setDraft((current) => ({ ...current, free_notes: event.target.value }))}
                    placeholder="Registre observações operacionais, combinados internos, exceções e detalhes para acompanhamento."
                  />
                </label>
                <label>
                  Tipo da demanda
                  <select
                    className="field"
                    value={draft.demand_type}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      demand_type: event.target.value,
                      confirmation_status: event.target.value === 'patient' ? current.confirmation_status || 'pendente' : 'pendente',
                      patient_has_scheduled: event.target.value === 'patient' ? current.patient_has_scheduled : false,
                      patient_scheduled_at: event.target.value === 'patient' ? current.patient_scheduled_at : '',
                      patient_fake_appointment: event.target.value === 'patient' ? current.patient_fake_appointment : false,
                      patient_name: event.target.value === 'patient' ? current.patient_name : '',
                      patient_phone: event.target.value === 'patient' ? current.patient_phone : '',
                      confirmation_notes: event.target.value === 'patient' ? current.confirmation_notes : ''
                    }))}
                  >
                    {agendaDemandTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {draft.demand_type === 'patient' ? (
                  <div className="agenda-editor-grid">
                    <label>
                      Paciente
                      <input className="field" value={draft.patient_name} onChange={(event) => setDraft((current) => ({ ...current, patient_name: event.target.value }))} placeholder="Nome do paciente" />
                    </label>
                    <label>
                      Telefone
                      <input className="field" value={draft.patient_phone} onChange={(event) => setDraft((current) => ({ ...current, patient_phone: event.target.value }))} placeholder="WhatsApp do paciente" />
                    </label>
                    <label className="agenda-toggle-card">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.patient_has_scheduled)}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          patient_has_scheduled: event.target.checked,
                          patient_scheduled_at: event.target.checked ? current.patient_scheduled_at : ''
                        }))}
                      />
                      <div>
                        <strong>Paciente agendou</strong>
                        <small>Marque quando já houver data reservada para o paciente.</small>
                      </div>
                    </label>
                    <button
                      type="button"
                      className={`agenda-fake-appointment-button ${draft.patient_fake_appointment ? 'active' : ''}`}
                      onClick={() => setDraft((current) => ({
                        ...current,
                        patient_fake_appointment: !current.patient_fake_appointment
                      }))}
                      aria-pressed={Boolean(draft.patient_fake_appointment)}
                    >
                      <strong>Agendamento Fake</strong>
                      <small>Marque quando a data informada não representar comparecimento real ou exigir revisão.</small>
                    </button>
                    <label>
                      Status da confirmação
                      <select className="field" value={draft.confirmation_status} onChange={(event) => setDraft((current) => ({ ...current, confirmation_status: event.target.value }))}>
                        {agendaConfirmationStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Data do agendamento
                      <input
                        className="field"
                        type="datetime-local"
                        value={draft.patient_scheduled_at}
                        disabled={!draft.patient_has_scheduled}
                        onChange={(event) => setDraft((current) => ({ ...current, patient_scheduled_at: event.target.value }))}
                      />
                    </label>
                    <label className="agenda-span-2">
                      Observação da confirmação
                      <textarea
                        className="field agenda-textarea"
                        value={draft.confirmation_notes}
                        onChange={(event) => setDraft((current) => ({ ...current, confirmation_notes: event.target.value }))}
                        placeholder="Registre se confirmou, pediu retorno, não atendeu ou entrou em evasão."
                      />
                    </label>
                  </div>
                ) : null}
                <label>
                  Tags
                  <input
                    className="field"
                    value={draft.tags}
                    onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="Ex.: CRC, urgente, retorno"
                  />
                </label>
              </div>

              <Card className="agenda-editor-side">
                <div className="agenda-editor-side-head">
                  <strong>Propriedades</strong>
                  <span>{selectedItem?.id ? `ID ${selectedItem.id}` : 'Novo'}</span>
                </div>
                <label>
                  Responsável
                  <select
                    className="field"
                    value={draft.assigned_user_id}
                    onChange={(event) => setDraft((current) => ({ ...current, assigned_user_id: event.target.value }))}
                  >
                    <option value="">Sem responsável definido</option>
                    {assigneeOptions.map((user) => (
                      <option key={user.id} value={String(user.id)}>{formatAgendaUserOption(user)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select className="field" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                    {agendaColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                  </select>
                </label>
                <label>
                  Prioridade
                  <select className="field" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}>
                    {priorityOptions.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
                  </select>
                </label>
                <label>
                  Prazo
                  <input className="field" type="datetime-local" value={draft.due_at} onChange={(event) => setDraft((current) => ({ ...current, due_at: event.target.value }))} />
                </label>
                <label>
                  Lembrete
                  <input className="field" type="datetime-local" value={draft.reminder_at} onChange={(event) => setDraft((current) => ({ ...current, reminder_at: event.target.value }))} />
                </label>
                <div className="agenda-property-grid">
                  <label className="agenda-toggle-card">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.is_daily_recurring)}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        is_daily_recurring: event.target.checked,
                        requires_completion: event.target.checked ? true : current.requires_completion,
                        recurrence_base_status: event.target.checked ? (current.recurrence_base_status || 'todo') : current.recurrence_base_status
                      }))}
                    />
                    <div>
                      <strong>Rotina recorrente</strong>
                      <small>Reabre automaticamente a tarefa e preserva o histórico de entrega do responsável.</small>
                    </div>
                  </label>
                  <label className="agenda-toggle-card">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.is_daily_recurring || draft.requires_completion)}
                      disabled={Boolean(draft.is_daily_recurring)}
                      onChange={(event) => setDraft((current) => ({ ...current, requires_completion: event.target.checked }))}
                    />
                    <div>
                      <strong>Execução obrigatória</strong>
                      <small>O trabalho só entra na medição quando o responsável registrar a execução.</small>
                    </div>
                  </label>
                </div>
                {draft.is_daily_recurring ? (
                  <>
                    <div className="agenda-weekday-picker">
                      <div className="agenda-weekday-head">
                        <strong>Dias para voltar ao A fazer</strong>
                        <small>Se nenhum dia for marcado, a tarefa retorna todos os dias.</small>
                      </div>
                      <div className="agenda-weekday-chips">
                        {recurrenceWeekdayOptions.map((weekday) => {
                          const isActive = normalizeAgendaRecurrenceWeekdays(draft.recurrence_weekdays).includes(weekday.value);
                          return (
                            <button
                              key={weekday.value}
                              type="button"
                              className={`agenda-weekday-chip ${isActive ? 'active' : ''}`}
                              onClick={() => toggleRecurrenceWeekday(weekday.value)}
                              aria-pressed={isActive}
                              title={weekday.fullLabel}
                            >
                              {weekday.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label>
                      Coluna de retorno
                      <select
                        className="field"
                        value={draft.recurrence_base_status}
                        onChange={(event) => setDraft((current) => ({ ...current, recurrence_base_status: event.target.value }))}
                      >
                        {agendaColumns.filter((column) => column.key !== 'done').map((column) => (
                          <option key={column.key} value={column.key}>{column.label}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                {selectedItem?.completed_at ? (
                  <div className="agenda-completion-note">
                    <strong>Última execução registrada</strong>
                    <small>{formatExecutionStamp(selectedItem)}</small>
                  </div>
                ) : null}
                <div className="agenda-editor-guide">
                  <strong>Fluxo recomendado</strong>
                  <small>Use os dias da semana para definir quando a tarefa volta para A fazer e manter a cobrança de execução do responsável.</small>
                </div>
              </Card>
            </div>

            <footer className="agenda-editor-footer">
              <div>
                {canDeleteAgendaItem && selectedItem?.id ? <button type="button" className="outline-action" onClick={deleteItem} disabled={saving}>Excluir agendamento</button> : null}
              </div>
              <ActionButtons>
                <button type="button" className="secondary-action" onClick={closeEditor} disabled={saving}>Cancelar</button>
                <button type="button" className="primary-action" onClick={saveItem} disabled={saving}>{saving ? 'Salvando...' : 'Salvar na agenda'}</button>
              </ActionButtons>
            </footer>
          </aside>
        </section>
      ) : null}

      {previewPopover?.payload ? (
        <div
          ref={previewPopoverRef}
          className={`agenda-preview-popover ${previewPopover.pinned ? 'pinned' : ''}`}
          style={{
            top: `${previewPopover.top}px`,
            left: `${previewPopover.left}px`,
            width: `${previewPopover.width}px`
          }}
          onMouseEnter={clearPreviewCloseTimer}
          onMouseLeave={handlePreviewLeave}
        >
          <div className="agenda-preview-popover-head">
            <div>
              <span>{previewPopover.payload.source === 'confirmation' ? 'Previa da confirmacao' : 'Previa da demanda'}</span>
              <strong>{previewPopover.payload.title}</strong>
              <small>{previewPopover.payload.subtitle}</small>
            </div>
            <button type="button" className="ghost-action" onClick={closePreviewPopover}>Fechar</button>
          </div>
          <div className="agenda-preview-popover-body">
            {previewPopover.payload.lines.map((line) => (
              <span key={`${previewPopover.payload.title}-${line}`}>{line}</span>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}
