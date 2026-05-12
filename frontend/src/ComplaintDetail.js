import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api, { apiBaseUrl } from './api';
import { isAdmin as isAdminUser, isMasterAdmin, priorityOptions, readUser, statusLabels } from './constants';

const maxUploadSizeBytes = 10 * 1024 * 1024;
const detailTablePageSize = 10;
const treatmentRoles = ['coordinator', 'manager', 'supervisor_crc'];
const evidenceRoles = ['coordinator', 'manager', 'supervisor_crc', 'sac_operator', 'admin'];
const previewableImagePattern = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?.*)?$/i;

const dentalProcedureOptions = [
  'Avaliação odontológica',
  'Consulta de retorno',
  'Profilaxia / limpeza',
  'Raspagem periodontal',
  'Aplicação de flúor',
  'Restauração em resina',
  'Restauração em amálgama',
  'Clareamento dental',
  'Tratamento de canal',
  'Retratamento de canal',
  'Extração simples',
  'Extração de siso',
  'Cirurgia periodontal',
  'Enxerto ósseo',
  'Implante dentário',
  'Prótese sobre implante',
  'Prótese total',
  'Prótese parcial removível',
  'Coroa dentária',
  'Lente de contato dental',
  'Faceta em resina',
  'Faceta em porcelana',
  'Aparelho ortodôntico',
  'Manutenção ortodôntica',
  'Alinhadores transparentes',
  'Placa de bruxismo',
  'Tratamento de DTM',
  'Odontopediatria',
  'Radiografia odontológica',
  'Tomografia odontológica',
  'Biópsia oral',
  'Urgência odontológica',
  'Reparo de prótese',
  'Ajuste oclusal',
  'Remoção de tártaro',
  'Outro procedimento odontológico'
];

const roleLabels = {
  master_admin: 'Administrador Master',
  admin: 'Administrador',
  sac_operator: 'Operador de SAC',
  supervisor_crc: 'Supervisor do CRC',
  coordinator: 'Coordenador',
  manager: 'Gerente',
  viewer: 'Marketing'
};

const forwardingOptions = [
  { value: 'coordinator', label: 'Coordenador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'supervisor_crc', label: 'Supervisor do CRC' }
];

const reassignForwardingOptions = forwardingOptions.filter((option) => ['coordinator', 'manager'].includes(option.value));
const returnToSacOption = [{ value: 'sac_operator', label: 'Operador de SAC' }];
const channelIconMap = {
  whatsapp: '💬',
  telefone: '📞',
  email: '✉️',
  google: '🔎',
  facebook: 'Ⓕ',
  instagram: '📷',
  reclame_aqui: '📢',
  nps: '📊',
  presencial: '📍'
};

function formatProtocol(complaint) {
  if (complaint?.protocol) return complaint.protocol;
  const year = complaint?.created_at ? new Date(complaint.created_at).getFullYear() : new Date().getFullYear();
  return `GRC-${year}-${String(complaint?.id || 0).padStart(6, '0')}`;
}

function formatDate(value) {
  if (!value) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatCurrency(value) {
  const number = Number(value || 0);

  if (!number) return 'Sem valor informado';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(number);
}

function normalizePriority(priority) {
  const value = String(priority || 'media').toLowerCase();
  return ['baixa', 'media', 'alta'].includes(value) ? value : 'media';
}

function getPriorityOption(priority) {
  return priorityOptions.find((option) => option.value === normalizePriority(priority)) || priorityOptions[1];
}

function buildWhatsappUrl(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${normalized}`;
}

function formatPhoneDisplay(phone) {
  const digits = String(phone || '').replace(/\D/g, '');

  if (!digits) return 'Não informado';

  const normalized = digits.startsWith('55') ? digits : `55${digits}`;

  if (normalized.length === 13) {
    return `+${normalized.slice(0, 2)} (${normalized.slice(2, 4)}) ${normalized.slice(4, 9)}-${normalized.slice(9)}`;
  }

  if (normalized.length === 12) {
    return `+${normalized.slice(0, 2)} (${normalized.slice(2, 4)}) ${normalized.slice(4, 8)}-${normalized.slice(8)}`;
  }

  return `+${normalized}`;
}

function normalizeChannelKey(channel) {
  return String(channel || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function renderChannelLabel(channel) {
  const label = String(channel || '').trim();

  if (!label) return 'Não informado';

  const normalizedKey = normalizeChannelKey(label);
  const icon = channelIconMap[normalizedKey];

  if (!icon || normalizedKey === 'outros') {
    return label;
  }

  return `${icon} ${label}`;
}

function resolveUploadedFileUrl(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) return '';
  if (/^data:/i.test(rawValue)) return rawValue;
  if (/^https?:\/\//i.test(rawValue)) return rawValue;

  const normalizedPath = rawValue.startsWith('/') ? rawValue : `/${rawValue}`;
  const absoluteApiBase = String(apiBaseUrl || '').trim();

  if (/^https?:\/\//i.test(absoluteApiBase)) {
    return new URL(normalizedPath, absoluteApiBase.replace(/\/api\/?$/i, '/')).toString();
  }

   if (absoluteApiBase.startsWith('/api') && typeof window !== 'undefined') {
    const apiPrefix = absoluteApiBase.replace(/\/$/, '');
    return new URL(`${apiPrefix}${normalizedPath}`, window.location.origin).toString();
  }

  return normalizedPath;
}

function isPreviewableImage(value) {
  return previewableImagePattern.test(String(value || ''));
}

function buildDeadlineInfo(complaint) {
  const dueAt = complaint?.due_at ? new Date(complaint.due_at) : null;

  if (!dueAt || Number.isNaN(dueAt.getTime())) {
    return {
      state: 'neutral',
      label: 'Prazo não calculado',
      detail: 'Sem vencimento registrado'
    };
  }

  if (complaint.status === 'resolvida') {
    return {
      state: 'closed',
      label: 'Fechada',
      detail: `Encerrada em ${formatDate(complaint.closed_at)}`
    };
  }

  const diffMs = dueAt.getTime() - Date.now();
  const absHours = Math.ceil(Math.abs(diffMs) / (1000 * 60 * 60));

  if (diffMs < 0) {
    return {
      state: 'overdue',
      label: 'Prazo vencido',
      detail: `Vencido há ${absHours}h`
    };
  }

  if (diffMs <= 12 * 60 * 60 * 1000) {
    return {
      state: 'warning',
      label: 'Prazo crítico',
      detail: `Restam ${Math.max(absHours, 1)}h`
    };
  }

  return {
    state: 'ontime',
    label: 'Dentro do prazo',
    detail: `Restam ${absHours}h`
  };
}

function daysSince(value) {
  if (!value) return 0;
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 0;

  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function buildBriefText(value, maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildComplaintNextAction({
  complaint,
  hasTreatment,
  hasPatientContact,
  hasFirstAttendance,
  hasSupervisorApproval,
  isHighPriority
}) {
  if (!complaint) return 'Validar o protocolo e definir o próximo responsável.';
  if (complaint.status === 'resolvida') return 'Protocolo finalizado. Validar apenas se toda a devolutiva foi registrada.';
  if (!hasFirstAttendance) return 'Registrar o primeiro atendimento e encaminhar a demanda para o responsável da tratativa.';
  if (!hasTreatment) return 'Salvar uma tratativa com evidência objetiva para liberar o avanço do fluxo.';
  if (isHighPriority && !hasSupervisorApproval) return 'Registrar o aceite do Supervisor do CRC antes do fechamento.';
  if (!hasPatientContact) return 'Registrar o contato com o paciente e documentar o retorno dado.';
  return 'Conferir se a tratativa está completa e, estando tudo validado, seguir para o fechamento do protocolo.';
}

function buildComplaintExecutiveSummary(complaint, options = {}) {
  if (!complaint) return [];

  const {
    stage,
    priority,
    deadline,
    hasTreatment,
    hasPatientContact,
    hasFirstAttendance,
    hasSupervisorApproval,
    isHighPriority
  } = options;
  const lastLog = Array.isArray(complaint.logs) && complaint.logs.length ? complaint.logs[0] : null;
  const evidenceCount = Array.isArray(complaint.evidences) ? complaint.evidences.length : 0;
  const baseOccurrence = buildBriefText(complaint.description, 240) || 'Sem descrição detalhada registrada.';
  const lastMovement = lastLog
    ? `${formatDate(lastLog.created_at)} · ${lastLog.actor_name || 'Usuário do sistema'} · ${buildBriefText(lastLog.message, 180)}`
    : 'Sem movimentações adicionais registradas até o momento.';

  return [
    `Demanda ${formatProtocol(complaint)} registrada para ${complaint.patient_name || 'paciente não informado'} na unidade ${complaint.clinic_name || 'não informada'}, via ${complaint.channel || 'canal não informado'}, com classificação ${complaint.complaint_type || 'não informada'} e prioridade ${priority?.label || 'não informada'}.`,
    `Relato principal: ${baseOccurrence}`,
    `Situação atual: ${statusLabels[complaint.status] || 'Aberta'}, ${stage?.label || 'sem etapa definida'}, ${deadline?.label || 'prazo sem cálculo'}${deadline?.detail ? ` (${deadline.detail})` : ''}.`,
    `Última movimentação: ${lastMovement}`,
    `Evidências anexadas: ${evidenceCount}. Próxima ação recomendada: ${buildComplaintNextAction({ complaint, hasTreatment, hasPatientContact, hasFirstAttendance, hasSupervisorApproval, isHighPriority })}`
  ];
}

function buildOperationalStage(complaint) {
  if (!complaint) {
    return {
      owner: 'Não identificado',
      label: 'Sem dados do protocolo',
      since: null
    };
  }

  if (complaint.status === 'resolvida') {
    return {
      owner: 'Protocolo encerrado',
      label: 'Fechada pelo SAC',
      since: complaint.closed_at || complaint.updated_at || complaint.created_at
    };
  }

  if (!complaint.treatment_at) {
    return {
      owner: complaint.forwarded_to_label || 'Coordenador, Gerente ou Supervisor CRC',
      label: complaint.forwarded_to_label ? 'Encaminhada para tratativa' : 'Aguardando tratativa da gestão',
      since: complaint.forwarded_at || complaint.first_attendance_at || complaint.created_at
    };
  }

  if (normalizePriority(complaint.priority) === 'alta' && !complaint.supervisor_approval_at) {
    return {
      owner: 'Supervisor do CRC',
      label: 'Aguardando aceite de prioridade alta',
      since: complaint.treatment_at
    };
  }

  if (!complaint.patient_contacted_at) {
    return {
      owner: 'Operador de SAC',
      label: 'Aguardando contato com paciente',
      since: complaint.supervisor_approval_at || complaint.treatment_at
    };
  }

  return {
    owner: 'Operador de SAC',
    label: 'Aguardando fechamento do protocolo',
    since: complaint.patient_contacted_at
  };
}

function ComplaintDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = readUser();
  const [complaint, setComplaint] = useState(null);
  const [comment, setComment] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidenceDescription, setEvidenceDescription] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingUnit, setSavingUnit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingEvidenceId, setDeletingEvidenceId] = useState(null);
  const [unitOptions, setUnitOptions] = useState([]);
  const [unitOptionsLoading, setUnitOptionsLoading] = useState(false);
  const [selectedClinicId, setSelectedClinicId] = useState('');
  const [editablePatientPhone, setEditablePatientPhone] = useState('');
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardModalMode, setForwardModalMode] = useState('contact');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [showExecutiveSummary, setShowExecutiveSummary] = useState(false);
  const [forwardToRole, setForwardToRole] = useState('');
  const [reactivateReason, setReactivateReason] = useState('');
  const [assetPreview, setAssetPreview] = useState(null);
  const [assetPreviewZoom, setAssetPreviewZoom] = useState(1);
  const [linkedPatientTreatments, setLinkedPatientTreatments] = useState([]);
  const [savingPatientTreatment, setSavingPatientTreatment] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [evidencePage, setEvidencePage] = useState(1);
  const [patientTreatmentDraft, setPatientTreatmentDraft] = useState({
    procedure_name: '',
    scheduled_at: '',
    note: ''
  });

  const protocol = useMemo(() => formatProtocol(complaint), [complaint]);
  const normalizedUserRole = String(user?.role || '').trim().toLowerCase();
  const deadline = useMemo(() => buildDeadlineInfo(complaint), [complaint]);
  const stage = useMemo(() => buildOperationalStage(complaint), [complaint]);
  const priority = useMemo(() => getPriorityOption(complaint?.priority), [complaint]);
  const whatsappUrl = useMemo(() => buildWhatsappUrl(complaint?.patient_phone), [complaint]);
  const includeDeleted = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('include_deleted') === '1';
  }, [location.search]);
  const initialAttachmentUrl = useMemo(
    () => resolveUploadedFileUrl(complaint?.attachment_url),
    [complaint?.attachment_url]
  );

  const isAdmin = isAdminUser(user);
  const isMasterUser = isMasterAdmin(user);
  const canOperationalClose = isMasterUser || ['admin', 'master_admin', 'supervisor_crc', 'sac_operator'].includes(normalizedUserRole);
  const canFormalTreatment = treatmentRoles.includes(user?.role) || isAdmin;
  const canRecordTreatment = Boolean(user?.role);
  const canAttachEvidence = evidenceRoles.includes(user?.role) || isAdmin;
  const canSupervisorAccept = normalizedUserRole === 'supervisor_crc' || isAdmin;
  const canDeleteComplaint = isMasterUser || user?.role === 'supervisor_crc';
  const canDeleteEvidence = Boolean(user?.id || user?.email || user?.role);
  const canChangeComplaintUnit = isMasterUser || ['master_admin', 'supervisor_crc', 'sac_operator'].includes(normalizedUserRole);
  const canEditPatientPhone = isMasterUser || ['sac_operator', 'supervisor_crc', 'master_admin'].includes(normalizedUserRole);
  const canRenotifyComplaint = isMasterUser || normalizedUserRole === 'supervisor_crc' || normalizedUserRole === 'sac_operator';
  const canReactivateComplaint = isMasterUser || normalizedUserRole === 'supervisor_crc';
  const canCreatePatientTreatment = isMasterUser || ['admin', 'master_admin', 'supervisor_crc', 'sac_operator'].includes(normalizedUserRole);
  const canReturnToSac = ['coordinator', 'manager'].includes(String(user?.role || '').toLowerCase());
  const canReassignForward = canReturnToSac || isAdmin || isMasterUser || ['master_admin', 'supervisor_crc', 'sac_operator'].includes(normalizedUserRole);
  const reassignOptions = canReturnToSac ? returnToSacOption : reassignForwardingOptions;
  const activeUnitOptions = useMemo(() => (
    unitOptions
      .filter((unit) => unit?.name && String(unit.active ?? 1) !== '0')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  ), [unitOptions]);
  const hasUnitChange = String(selectedClinicId || '') !== String(complaint?.clinic_id || '');
  const hasTreatment = Boolean(complaint?.treatment_at);
  const hasCoordinatorOrManagerTreatment = hasTreatment
    && ['coordinator', 'manager'].includes(String(complaint?.treatment_by_role || '').toLowerCase());
  const isHighPriority = normalizePriority(complaint?.priority) === 'alta';
  const hasSupervisorApproval = Boolean(complaint?.supervisor_approval_at);
  const hasSacApproval = Boolean(complaint?.sac_approval_at);
  const hasPatientContact = Boolean(complaint?.patient_contacted_at);
  const isDeletedRecord = Boolean(complaint?.deleted_at);
  const canMarkPatientContact = canOperationalClose
    && complaint?.status !== 'resolvida'
    && !hasPatientContact
    && hasTreatment;
  const hasFirstAttendance = Boolean(complaint?.first_attendance_at);
  const closeBlockedReason = isMasterUser
    ? ''
    : !canOperationalClose
    ? 'Apenas Administrador, Administrador Master, Supervisor do CRC ou Operador de SAC podem fechar este protocolo.'
    : !hasCoordinatorOrManagerTreatment
      ? 'Aguarde a tratativa registrada por Coordenador ou Gerente para liberar o fechamento.'
      : isHighPriority && !hasSupervisorApproval
        ? 'Prioridade alta exige aceite do Supervisor do CRC.'
        : '';
  const canCloseNow = canOperationalClose && !closeBlockedReason && complaint?.status !== 'resolvida';
  const executiveSummary = useMemo(() => buildComplaintExecutiveSummary(complaint, {
    stage,
    priority,
    deadline,
    hasTreatment,
    hasPatientContact,
    hasFirstAttendance,
    hasSupervisorApproval,
    isHighPriority
  }), [
    complaint,
    stage,
    priority,
    deadline,
    hasTreatment,
    hasPatientContact,
    hasFirstAttendance,
    hasSupervisorApproval,
    isHighPriority
  ]);
  const historyRecords = useMemo(() => (
    Array.isArray(complaint?.logs) ? complaint.logs : []
  ), [complaint?.logs]);
  const evidenceRecords = useMemo(() => (
    Array.isArray(complaint?.evidences) ? complaint.evidences : []
  ), [complaint?.evidences]);
  const totalHistoryPages = Math.max(1, Math.ceil(historyRecords.length / detailTablePageSize));
  const currentHistoryPage = Math.min(historyPage, totalHistoryPages);
  const paginatedHistoryRecords = useMemo(() => {
    const start = (currentHistoryPage - 1) * detailTablePageSize;
    return historyRecords.slice(start, start + detailTablePageSize);
  }, [currentHistoryPage, historyRecords]);
  const historyStart = historyRecords.length ? (currentHistoryPage - 1) * detailTablePageSize + 1 : 0;
  const historyEnd = historyRecords.length ? Math.min(currentHistoryPage * detailTablePageSize, historyRecords.length) : 0;
  const totalEvidencePages = Math.max(1, Math.ceil(evidenceRecords.length / detailTablePageSize));
  const currentEvidencePage = Math.min(evidencePage, totalEvidencePages);
  const paginatedEvidenceRecords = useMemo(() => {
    const start = (currentEvidencePage - 1) * detailTablePageSize;
    return evidenceRecords.slice(start, start + detailTablePageSize);
  }, [currentEvidencePage, evidenceRecords]);
  const evidenceStart = evidenceRecords.length ? (currentEvidencePage - 1) * detailTablePageSize + 1 : 0;
  const evidenceEnd = evidenceRecords.length ? Math.min(currentEvidencePage * detailTablePageSize, evidenceRecords.length) : 0;

  const loadComplaint = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const res = await api.get(`/complaints/${id}${includeDeleted ? '?include_deleted=1' : ''}`);
      const data = res.data;
      setComplaint(data);
      setSelectedClinicId(data?.clinic_id ? String(data.clinic_id) : '');
      setEditablePatientPhone(data?.patient_phone || '');
      setComment('');
      setShowExecutiveSummary(false);
    } catch (error) {
      setFeedback('Não foi possível carregar este protocolo.');
    } finally {
      setLoading(false);
    }
  }, [id, includeDeleted]);

  const loadLinkedPatientTreatments = useCallback(async () => {
    try {
      const res = await api.get('/patient-interactions', {
        params: { complaint_id: id }
      });
      setLinkedPatientTreatments(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      setLinkedPatientTreatments([]);
    }
  }, [id]);

  const openUploadedItem = useCallback((url, label = 'Arquivo do protocolo') => {
    if (!url) return;

    if (isPreviewableImage(url)) {
      setAssetPreview({ url, label, type: 'image' });
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const closeAssetPreview = useCallback(() => {
    setAssetPreview(null);
    setAssetPreviewZoom(1);
  }, []);

  const changeAssetPreviewZoom = useCallback((delta) => {
    setAssetPreviewZoom((current) => {
      const next = Math.min(3, Math.max(0.75, Number((current + delta).toFixed(2))));
      return next;
    });
  }, []);

  const resetAssetPreviewZoom = useCallback(() => {
    setAssetPreviewZoom(1);
  }, []);

  useEffect(() => {
    loadComplaint();
  }, [loadComplaint]);

  useEffect(() => {
    loadLinkedPatientTreatments();
  }, [loadLinkedPatientTreatments]);

  useEffect(() => {
    setHistoryPage(1);
  }, [id, historyRecords.length]);

  useEffect(() => {
    setEvidencePage(1);
  }, [id, evidenceRecords.length]);

  useEffect(() => {
    if (!canChangeComplaintUnit) {
      setUnitOptions([]);
      return;
    }

    let active = true;
    setUnitOptionsLoading(true);

    api.get('/complaints/unit-options')
      .then((res) => {
        if (active) {
          setUnitOptions(Array.isArray(res.data) ? res.data : []);
        }
      })
      .catch(() => {
        if (active) {
          setFeedback('Não foi possível carregar as unidades para alteração.');
        }
      })
      .finally(() => {
        if (active) {
          setUnitOptionsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [canChangeComplaintUnit]);

  const handleSaveTreatment = async () => {
    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/complaints/${id}`, {
        status: complaint?.status === 'aberta' && canFormalTreatment ? 'em_andamento' : complaint?.status,
        operator_comment: comment
      });
      setFeedback(canFormalTreatment ? 'Tratativa acrescentada ao histórico.' : 'Atualização acrescentada ao histórico.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao atualizar o protocolo.');
    } finally {
      setSaving(false);
    }
  };

  const handleSupervisorAccept = async () => {
    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/complaints/${id}`, {
        status: 'em_andamento',
        operator_comment: comment,
        supervisor_accept: true
      });
      setFeedback('Aceite do Supervisor do CRC registrado.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao registrar aceite.');
    } finally {
      setSaving(false);
    }
  };

  const handlePatientContact = async () => {
    if (!canMarkPatientContact) {
      return;
    }

    setFeedback('');
    setForwardModalMode('contact');
    setForwardToRole('');
    setShowForwardModal(true);
  };

  const handleOpenReassignForward = () => {
    if (!canReassignForward || complaint?.status === 'resolvida') {
      return;
    }

    setFeedback('');
    setForwardModalMode('reassign');
    setForwardToRole('');
    setShowForwardModal(true);
  };

  const handleUnitChange = async () => {
    if (!canChangeComplaintUnit || !selectedClinicId || !hasUnitChange) {
      return;
    }

    setSavingUnit(true);
    setFeedback('');

    try {
      await api.patch(`/complaints/${id}`, {
        clinic_id: Number(selectedClinicId)
      });
      setFeedback('Unidade do protocolo atualizada com histórico de auditoria.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao alterar a unidade do protocolo.');
    } finally {
      setSavingUnit(false);
    }
  };

  const handlePatientPhoneSave = async () => {
    if (!canEditPatientPhone) {
      return;
    }

    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/complaints/${id}`, {
        patient_phone: editablePatientPhone
      });
      setFeedback('Telefone do paciente atualizado com sucesso.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao atualizar o telefone do paciente.');
    } finally {
      setSaving(false);
    }
  };

  const handleContactForward = async () => {
    if (!forwardToRole) {
      setFeedback('Selecione para quem a reclamação será encaminhada.');
      return;
    }

    setSaving(true);
    setFeedback('');

    try {
      const payload = forwardModalMode === 'reassign'
        ? {
            status: complaint?.status === 'aberta' ? 'em_andamento' : complaint?.status,
            reassign_forward: true,
            forward_to_role: forwardToRole
          }
        : {
            status: 'em_andamento',
            patient_contacted: true,
            first_attendance: true,
            forward_to_role: forwardToRole
          };

      await api.patch(`/complaints/${id}`, payload);
      setShowForwardModal(false);
      setForwardModalMode('contact');
      setForwardToRole('');
      setFeedback(
        forwardModalMode === 'reassign'
          ? 'Demanda reencaminhada com sucesso para a unidade.'
          : 'Contato com o paciente registrado e reclamação encaminhada para tratativa.'
      );
      await loadComplaint();
    } catch (error) {
      setFeedback(
        error.response?.data?.error
        || (forwardModalMode === 'reassign'
          ? 'Erro ao reencaminhar a reclamação.'
          : 'Erro ao registrar contato com o paciente.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEvidenceUpload = async () => {
    if (!evidenceFile) {
      setFeedback('Selecione um arquivo para anexar.');
      return;
    }

    if (evidenceFile.size > maxUploadSizeBytes) {
      setFeedback('A evidência deve ter no máximo 10 MB.');
      return;
    }

    setUploading(true);
    setFeedback('');

    try {
      const formData = new FormData();
      formData.append('file', evidenceFile);
      formData.append('description', evidenceDescription);
      await api.post(`/complaints/${id}/evidences`, formData);
      setEvidenceFile(null);
      setEvidenceDescription('');
      setFeedback('Evidência anexada com sucesso.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao anexar evidência.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteEvidence = async (evidence) => {
    if (!canDeleteEvidence || !evidence?.id) {
      return;
    }

    const label = evidence.description || evidence.original_name || 'esta evidência';
    const confirmed = window.confirm(`Excluir ${label}? O arquivo sai da ficha ativa, mas o histórico de exclusão fica registrado no protocolo.`);

    if (!confirmed) {
      return;
    }

    setDeletingEvidenceId(evidence.id);
    setFeedback('');

    try {
      await api.delete(`/complaints/${id}/evidences/${evidence.id}`, {
        data: { reason: 'Exclusão solicitada na ficha executiva do protocolo.' }
      });
      setFeedback('Evidência excluída com sucesso.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao excluir evidência.');
    } finally {
      setDeletingEvidenceId(null);
    }
  };

  const handleRenotify = async () => {
    setSaving(true);
    setFeedback('');

    try {
      const response = await api.post(`/complaints/${id}/renotify`);
      setFeedback(response.data?.message || 'Notificações reenviadas aos responsáveis.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível reenviar as notificações do protocolo.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/complaints/${id}`, {
        status: 'resolvida',
        sac_accept: true
      });
      setFeedback('Protocolo fechado com sucesso.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao fechar o protocolo.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteComplaint = async () => {
    if (!canDeleteComplaint) return;

    setSaving(true);
    setFeedback('');

    try {
      await api.delete(`/complaints/${id}`, {
        data: { reason: 'Exclusão administrativa pela ficha executiva.' }
      });
      setShowDeleteModal(false);
      navigate('/gestao');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível excluir este protocolo.');
    } finally {
      setSaving(false);
    }
  };

  const handleReactivateComplaint = async () => {
    if (!canReactivateComplaint) return;

    if (!reactivateReason.trim()) {
      setFeedback('Informe o motivo da reabertura antes de re-habilitar a reclamação.');
      return;
    }

    setSaving(true);
    setFeedback('');

    try {
      const response = await api.post(`/complaints/${id}/reactivate`, {
        reason: reactivateReason.trim()
      });
      setFeedback(response.data?.message || 'Reclamação reabilitada com sucesso.');
      setShowReactivateModal(false);
      setReactivateReason('');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível reabilitar esta reclamação.');
    } finally {
      setSaving(false);
    }
  };

  const handlePatientTreatmentDraft = (field, value) => {
    setPatientTreatmentDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSavePatientTreatment = async () => {
    if (!canCreatePatientTreatment) {
      return;
    }

    if (!patientTreatmentDraft.procedure_name.trim() || !patientTreatmentDraft.scheduled_at.trim()) {
      setFeedback('Informe o procedimento e a data agendada do paciente.');
      return;
    }

    setSavingPatientTreatment(true);
    setFeedback('');

    try {
      const response = await api.post(`/complaints/${id}/patient-treatment`, {
        procedure_name: patientTreatmentDraft.procedure_name.trim(),
        scheduled_at: patientTreatmentDraft.scheduled_at,
        note: patientTreatmentDraft.note.trim()
      });

      setPatientTreatmentDraft({
        procedure_name: '',
        scheduled_at: '',
        note: ''
      });
      setFeedback(response.data?.message || 'Tratamento do paciente registrado com sucesso.');
      await loadLinkedPatientTreatments();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível registrar o tratamento do paciente.');
    } finally {
      setSavingPatientTreatment(false);
    }
  };

  const handleExportComplaintPdf = () => {
    const reportWindow = window.open('', '_blank');

    if (!reportWindow) {
      setFeedback('Permita pop-ups para exportar a ficha em PDF.');
      return;
    }

    const printDate = new Date();
    const historyRows = historyRecords.length
      ? historyRecords.map((log) => `
        <tr>
          <td>${escapeHtml(formatDate(log.created_at))}</td>
          <td>${escapeHtml(log.actor_name || 'Usuário do sistema')}</td>
          <td>${escapeHtml(roleLabels[log.actor_role] || log.actor_role || 'Atualização')}</td>
          <td>${escapeHtml(log.message || 'Atualização registrada no protocolo.')}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4">Sem histórico complementar registrado.</td></tr>';
    const evidenceRows = evidenceRecords.length
      ? evidenceRecords.map((evidence) => `
        <tr>
          <td>${escapeHtml(evidence.description || evidence.original_name || 'Evidência anexada')}</td>
          <td>${escapeHtml(formatDate(evidence.created_at))}</td>
          <td>${escapeHtml(evidence.uploaded_by_name || 'Não informado')}</td>
          <td>${escapeHtml(evidence.original_name || evidence.file_url || 'Arquivo vinculado')}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4">Sem evidências complementares anexadas.</td></tr>';
    const evidenceCards = evidenceRecords.length
      ? evidenceRecords.map((evidence, index) => {
        const evidenceUrl = resolveUploadedFileUrl(evidence.file_url);
        const evidenceLabel = evidence.description || evidence.original_name || `Evidência ${index + 1}`;
        const evidenceFile = evidence.original_name || evidence.file_url || 'Arquivo vinculado ao protocolo';
        const evidenceLink = evidenceUrl
          ? `<small class="evidence-url">${escapeHtml(evidenceUrl)}</small>`
          : '';
        const imagePreview = evidenceUrl && isPreviewableImage(evidenceUrl)
          ? `<img src="${escapeHtml(evidenceUrl)}" alt="${escapeHtml(evidenceLabel)}" />`
          : '<div class="file-placeholder">Arquivo anexado</div>';

        return `
          <article class="evidence-preview-card">
            <div class="evidence-preview-media">${imagePreview}</div>
            <div>
              <strong>${escapeHtml(evidenceLabel)}</strong>
              <span>${escapeHtml(formatDate(evidence.created_at))}</span>
              <span>${escapeHtml(evidence.uploaded_by_name || 'Responsável não informado')}</span>
              <small>${escapeHtml(evidenceFile)}</small>
              ${evidenceLink}
            </div>
          </article>
        `;
      }).join('')
      : '<p class="muted">Sem evidências complementares anexadas.</p>';
    const treatmentRows = linkedPatientTreatments.length
      ? linkedPatientTreatments.map((item) => `
        <tr>
          <td>${escapeHtml(item.protocol || `PAC-${item.id}`)}</td>
          <td>${escapeHtml(item.procedureName || 'Procedimento não informado')}</td>
          <td>${escapeHtml(item.scheduledAt ? formatDate(item.scheduledAt) : 'Data não informada')}</td>
          <td>${escapeHtml(item.status || 'Em tratamento')}</td>
          <td>${escapeHtml(item.note || 'Sem observações')}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5">Sem tratamento do paciente vinculado.</td></tr>';

    reportWindow.document.write(`
      <html>
        <head>
          <title>Ficha executiva ${escapeHtml(protocol)}</title>
          <style>
            @page { size: A4; margin: 14mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, sans-serif; color: #1f2937; background: #fff; }
            .report-shell { display: grid; gap: 18px; }
            .report-header { padding: 20px 22px; border: 1px solid #d9c4a0; border-radius: 12px; background: #fffaf2; }
            .report-kicker { margin: 0 0 8px; color: #9a6b22; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
            h1 { margin: 0 0 6px; font-size: 25px; color: #111827; }
            h2 { margin: 0 0 10px; font-size: 17px; color: #111827; }
            p { margin: 0; line-height: 1.55; }
            .muted { color: #667085; font-size: 12px; }
            .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
            .summary-card { border: 1px solid #eadcc7; border-radius: 10px; padding: 12px; background: #fff; }
            .summary-card span { display: block; margin-bottom: 4px; color: #8a632d; font-size: 10px; font-weight: 800; text-transform: uppercase; }
            .summary-card strong { display: block; color: #111827; font-size: 13px; line-height: 1.35; }
            .section { display: grid; gap: 10px; padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
            th { padding: 8px 7px; background: #132238; color: #fff; text-align: left; text-transform: uppercase; font-size: 9px; letter-spacing: .03em; }
            td { padding: 8px 7px; border-top: 1px solid #e5e7eb; vertical-align: top; word-break: break-word; }
            tr:nth-child(even) td { background: #faf7f2; }
            .description { padding: 12px; border: 1px solid #eadcc7; border-radius: 10px; background: #fffaf2; }
            .evidence-preview-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
            .evidence-preview-card { break-inside: avoid; display: grid; grid-template-columns: 96px 1fr; gap: 10px; padding: 10px; border: 1px solid #eadcc7; border-radius: 10px; background: #fffaf2; }
            .evidence-preview-media { width: 96px; min-height: 76px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; display: grid; place-items: center; overflow: hidden; }
            .evidence-preview-media img { width: 100%; height: 100%; object-fit: contain; display: block; background: #fff; }
            .file-placeholder { color: #8a632d; font-size: 10px; font-weight: 800; text-transform: uppercase; text-align: center; padding: 8px; }
            .evidence-preview-card strong, .evidence-preview-card span, .evidence-preview-card small { display: block; line-height: 1.4; }
            .evidence-preview-card strong { color: #111827; font-size: 11px; }
            .evidence-preview-card span { color: #4b5563; font-size: 10px; }
            .evidence-preview-card small { margin-top: 4px; color: #667085; font-size: 9px; word-break: break-word; overflow-wrap: anywhere; }
            .evidence-preview-card .evidence-url { color: #8a632d; }
          </style>
        </head>
        <body>
          <main class="report-shell">
            <section class="report-header">
              <p class="report-kicker">Ficha executiva do protocolo</p>
              <h1>${escapeHtml(protocol)}</h1>
              <p>${escapeHtml(complaint.patient_name || 'Paciente não informado')} | ${escapeHtml(complaint.clinic_name || 'Unidade não informada')}</p>
              <p class="muted">Exportado em ${escapeHtml(formatDate(printDate))}</p>
            </section>

            <section class="summary-grid">
              <article class="summary-card"><span>Status</span><strong>${escapeHtml(statusLabels[complaint.status] || 'Aberta')}</strong></article>
              <article class="summary-card"><span>Canal</span><strong>${escapeHtml(String(renderChannelLabel(complaint.channel)).replace(/[^\x20-\x7EÀ-ÿ]/g, ''))}</strong></article>
              <article class="summary-card"><span>Prazo</span><strong>${escapeHtml(formatDate(complaint.due_at))}</strong></article>
              <article class="summary-card"><span>Responsável atual</span><strong>${escapeHtml(stage.owner)}</strong></article>
            </section>

            <section class="section">
              <h2>Dados principais</h2>
              <table>
                <tbody>
                  <tr><td><strong>Telefone</strong></td><td>${escapeHtml(complaint.patient_phone || 'Não informado')}</td><td><strong>Serviço</strong></td><td>${escapeHtml(complaint.service_type || 'Não informado')}</td></tr>
                  <tr><td><strong>Tipo</strong></td><td>${escapeHtml(complaint.complaint_type || 'Não informado')}</td><td><strong>Valor financeiro</strong></td><td>${escapeHtml(complaint.financial_involved ? formatCurrency(complaint.financial_amount) : 'Não envolve')}</td></tr>
                  <tr><td><strong>Coordenador</strong></td><td>${escapeHtml(complaint.coordinator_name || 'Não informado')}</td><td><strong>Gerente</strong></td><td>${escapeHtml(complaint.manager_name || 'Não informado')}</td></tr>
                </tbody>
              </table>
            </section>

            <section class="section">
              <h2>Relato original</h2>
              <p class="description">${escapeHtml(complaint.description || 'Sem descrição registrada.')}</p>
            </section>

            <section class="section">
              <h2>Tratamento do paciente</h2>
              <table>
                <thead><tr><th>Protocolo</th><th>Procedimento</th><th>Agenda</th><th>Status</th><th>Observações</th></tr></thead>
                <tbody>${treatmentRows}</tbody>
              </table>
            </section>

            <section class="section">
              <h2>Evidências</h2>
              <div class="evidence-preview-grid">${evidenceCards}</div>
              <table>
                <thead><tr><th>Descrição</th><th>Data</th><th>Responsável</th><th>Arquivo</th></tr></thead>
                <tbody>${evidenceRows}</tbody>
              </table>
            </section>

            <section class="section">
              <h2>Histórico imutável</h2>
              <table>
                <thead><tr><th>Data</th><th>Usuário</th><th>Perfil</th><th>Registro</th></tr></thead>
                <tbody>${historyRows}</tbody>
              </table>
            </section>
          </main>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    setTimeout(() => reportWindow.print(), 900);
  };

  if (loading) {
    return (
      <main className="app-page">
        <section className="management-panel">
          <p className="empty-state">Carregando protocolo...</p>
        </section>
      </main>
    );
  }

  if (!complaint) {
    return (
      <main className="app-page">
        <section className="restricted-panel">
          <p className="eyebrow">Gestão de protocolos</p>
          <h1>Protocolo não encontrado</h1>
          <p>Volte para a lista e selecione outro protocolo.</p>
          <button className="primary-action" onClick={() => navigate('/gestao')}>
            Voltar para gestão
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page">
      <header className="page-heading complaint-heading">
        <div className="complaint-heading-copy">
          <p className="eyebrow">Ficha executiva do protocolo</p>
          <h1>{protocol}</h1>
          <div className="complaint-heading-meta" aria-label="Dados resumidos do protocolo">
            <span>{complaint.clinic_name || 'Clínica não informada'}</span>
            <span>{complaint.city || 'Cidade'} / {complaint.state || 'UF'}</span>
            <span>{statusLabels[complaint.status] || 'Aberta'}</span>
          </div>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
          <button className="outline-action" onClick={() => navigate('/gestao')}>
            Voltar para gestão
          </button>
          <button className="outline-action" onClick={() => setShowExecutiveSummary((prev) => !prev)}>
            {showExecutiveSummary ? 'Ocultar resumo' : 'Resumo rápido'}
          </button>
          <button className="outline-action" onClick={handleExportComplaintPdf}>
            Exportar PDF
          </button>
          {canRenotifyComplaint && !isDeletedRecord && (
            <button className="outline-action" onClick={handleRenotify} disabled={saving}>
              Notificar responsáveis
            </button>
          )}
          {whatsappUrl && (
            <a className="primary-action whatsapp-action" href={whatsappUrl} target="_blank" rel="noreferrer">
              Chamar no WhatsApp
            </a>
          )}
          {canDeleteComplaint && !isDeletedRecord && (
            <button
              className="outline-action danger-action"
              onClick={() => setShowDeleteModal(true)}
              disabled={saving}
            >
              Excluir protocolo
            </button>
          )}
        </div>
      </header>

      {isDeletedRecord && (
        <section className="management-panel">
          <div className="history-item">
            <div className="history-item-head">
              <strong>Protocolo excluído da operação</strong>
              <span>{formatDate(complaint.deleted_at)}</span>
            </div>
            <small>{complaint.deleted_by || 'Usuário não informado'}</small>
            <p>{complaint.deletion_reason || 'Sem motivo informado.'}</p>
          </div>
        </section>
      )}

      <section className="sla-grid">
        <article className={`deadline-card ${deadline.state}`}>
          <span>Data do cadastro</span>
          <strong>{formatDate(complaint.created_at)}</strong>
          <p>Data fixa para controle do prazo.</p>
        </article>
        <article className={`deadline-card ${deadline.state}`}>
          <span>Deadline</span>
          <strong>{formatDate(complaint.due_at)}</strong>
          <p>{deadline.label} · {deadline.detail}</p>
        </article>
        <article className={`deadline-card priority-${priority.value}`}>
          <span>Prioridade</span>
          <strong>{priority.label}</strong>
          <p>Tratativa em até {priority.deadline}.</p>
        </article>
        <article className={`deadline-card ${complaint.status || 'aberta'}`}>
          <span>Status</span>
          <strong>{statusLabels[complaint.status] || 'Aberta'}</strong>
          <p>{complaint.status === 'resolvida' ? 'Protocolo encerrado.' : 'Em controle operacional.'}</p>
        </article>
        <article className="deadline-card stage">
          <span>Parada com</span>
          <strong>{stage.owner}</strong>
          <p>{stage.label} há {daysSince(stage.since)} {daysSince(stage.since) === 1 ? 'dia' : 'dias'}.</p>
        </article>
      </section>

      {showExecutiveSummary && (
        <section className="management-panel summary-panel">
          <div className="detail-title-row">
            <div>
              <p className="eyebrow">Resumo executivo</p>
              <h2>Leitura rápida da reclamação</h2>
              <p className="history-note">Síntese automática da demanda para agilizar o atendimento.</p>
            </div>
          </div>
          <div className="executive-summary-list">
            {executiveSummary.map((item, index) => (
              <article className="executive-summary-item" key={`complaint-summary-${index}`}>
                <span>{index + 1}</span>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="complaint-detail-grid executive-detail-grid">
        <article className="detail-card executive-patient-card">
          <div className="detail-title-row">
            <div>
              <p className="eyebrow">Paciente</p>
              <h2>{complaint.patient_name || 'Não informado'}</h2>
              <p className="history-note">Visão consolidada do protocolo com paciente, operação e responsáveis da unidade.</p>
            </div>
            <span className={`status-pill ${complaint.status || 'aberta'}`}>
              {statusLabels[complaint.status] || 'Aberta'}
            </span>
          </div>

          <div className="summary-chip-grid">
            <article className="summary-chip">
              <span>Protocolo</span>
              <strong>{protocol}</strong>
              <small>Identificador oficial da demanda.</small>
            </article>
            <article className="summary-chip">
              <span>Unidade</span>
              <strong>{complaint.clinic_name || 'Não informada'}</strong>
              <small>{complaint.region || 'Região não informada'}</small>
            </article>
            <article className="summary-chip">
              <span>Canal</span>
              <strong>{renderChannelLabel(complaint.channel)}</strong>
              <small>{complaint.created_origin || 'Interno'}</small>
            </article>
            <article className="summary-chip">
              <span>Serviço</span>
              <strong>{complaint.service_type || 'Não informado'}</strong>
              <small>{complaint.complaint_type || 'Tipo não informado'}</small>
            </article>
          </div>

          {canChangeComplaintUnit && (
            <div className="unit-change-inline">
              <label>
                Unidade cadastrada
                <select
                  className="field"
                  value={selectedClinicId}
                  onChange={(event) => setSelectedClinicId(event.target.value)}
                  disabled={savingUnit || unitOptionsLoading || isDeletedRecord}
                >
                  <option value="">Selecione a unidade</option>
                  {activeUnitOptions.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}{unit.city ? ` - ${unit.city}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary-action"
                onClick={handleUnitChange}
                disabled={savingUnit || unitOptionsLoading || !selectedClinicId || !hasUnitChange || isDeletedRecord}
              >
                {savingUnit ? 'Alterando...' : 'Alterar unidade'}
              </button>
            </div>
          )}

          <div className="meta-section-head executive-section-title">
            <p className="eyebrow">Dados operacionais</p>
            <h3>Controle da tratativa</h3>
          </div>

          <dl className="meta-grid operational-meta-grid">
            <div>
              <dt>Unidade</dt>
              <dd>{complaint.clinic_name || 'Não informada'}</dd>
            </div>
            <div>
              <dt>Telefone</dt>
              {canEditPatientPhone && !isDeletedRecord && (
                <dd>
                  <div className="unit-change-inline">
                    <input
                      className="field"
                      value={editablePatientPhone}
                      onChange={(event) => setEditablePatientPhone(event.target.value)}
                      placeholder="+5562999999999"
                    />
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={handlePatientPhoneSave}
                      disabled={saving || !editablePatientPhone || editablePatientPhone === (complaint.patient_phone || '')}
                    >
                      {saving ? 'Salvando...' : 'Salvar telefone'}
                    </button>
                  </div>
                </dd>
              )}
              {!canEditPatientPhone && <dd>{complaint.patient_phone || 'Não informado'}</dd>}
            </div>
            <div>
              <dt>Contato SAC</dt>
              <dd>{hasPatientContact ? formatDate(complaint.patient_contacted_at) : 'Pendente'}</dd>
            </div>
            <div>
              <dt>Primeiro atendimento</dt>
              <dd>{hasFirstAttendance ? formatDate(complaint.first_attendance_at) : 'Pendente'}</dd>
            </div>
            <div>
              <dt>Encaminhado para</dt>
              <dd>{complaint.forwarded_to_label || 'Não encaminhado'}</dd>
            </div>
            <div>
              <dt>Coordenador responsável</dt>
              <dd>{complaint.coordinator_name || 'Não informado'}</dd>
            </div>
            <div>
              <dt>Telefone do coordenador</dt>
              <dd>{formatPhoneDisplay(complaint.coordinator_phone)}</dd>
            </div>
            <div>
              <dt>Gerente responsável</dt>
              <dd>{complaint.manager_name || 'Não informado'}</dd>
            </div>
            <div>
              <dt>Telefone do gerente</dt>
              <dd>{formatPhoneDisplay(complaint.manager_phone)}</dd>
            </div>
            <div>
              <dt>Canal</dt>
              <dd className="channel-display">{renderChannelLabel(complaint.channel)}</dd>
            </div>
            <div>
              <dt>Origem do cadastro</dt>
              <dd>{complaint.created_origin || 'Interno'}</dd>
            </div>
            <div>
              <dt>Tipo</dt>
              <dd>{complaint.complaint_type || 'Não informado'}</dd>
            </div>
            <div>
              <dt>Valor financeiro</dt>
              <dd>{complaint.financial_involved ? formatCurrency(complaint.financial_amount) : 'Não envolve'}</dd>
            </div>
            <div>
              <dt>Serviço</dt>
              <dd>{complaint.service_type || 'Não informado'}</dd>
            </div>
            <div>
              <dt>Região</dt>
              <dd>{complaint.region || 'Não informada'}</dd>
            </div>
            <div>
              <dt>Atualizada em</dt>
              <dd>{formatDate(complaint.updated_at)}</dd>
            </div>
          </dl>

          <div className="detail-subsection responsibles-section">
            <div className="meta-section-head">
              <p className="eyebrow">Responsáveis da unidade</p>
              <h3>Coordenação e gerência</h3>
            </div>
            <dl className="meta-grid responsibles-grid">
              <div>
                <dt>Coordenador responsável</dt>
                <dd>{complaint.coordinator_name || 'Não informado'}</dd>
              </div>
              <div>
                <dt>Telefone do coordenador</dt>
                <dd>{formatPhoneDisplay(complaint.coordinator_phone)}</dd>
              </div>
              <div>
                <dt>Gerente responsável</dt>
                <dd>{complaint.manager_name || 'Não informado'}</dd>
              </div>
              <div>
                <dt>Telefone do gerente</dt>
                <dd>{formatPhoneDisplay(complaint.manager_phone)}</dd>
              </div>
            </dl>
          </div>
        </article>

        <article className="detail-card narrative-card">
          <div className="detail-title-row">
            <div>
              <p className="eyebrow">Relato original</p>
              <h2>Contexto da ocorrência</h2>
              <p className="history-note">Descrição oficial do caso com o material anexado no cadastro inicial.</p>
            </div>
          </div>
          <p className="complaint-description">{complaint.description || 'Sem descrição registrada.'}</p>

          {Boolean(complaint.financial_involved) && (
            <div className="financial-summary">
              <strong>Impacto financeiro: {formatCurrency(complaint.financial_amount)}</strong>
              <p>{complaint.financial_description || 'Sem descrição financeira detalhada.'}</p>
            </div>
          )}

          <div className="attachment-stack">
            {initialAttachmentUrl ? (
              <>
                {isPreviewableImage(initialAttachmentUrl) && (
                  <button
                    type="button"
                    className="attachment-preview-button"
                    onClick={() => openUploadedItem(initialAttachmentUrl, 'Anexo inicial do protocolo')}
                  >
                    <img
                      className="attachment-preview"
                      src={initialAttachmentUrl}
                      alt="Anexo inicial do protocolo"
                      loading="lazy"
                    />
                  </button>
                )}
                <button
                  type="button"
                  className="attachment-link"
                  onClick={() => openUploadedItem(initialAttachmentUrl, 'Anexo inicial do protocolo')}
                >
                  Ver anexo inicial do protocolo
                </button>
              </>
            ) : (
              <p className="empty-mini">Sem anexo inicial.</p>
            )}
          </div>
        </article>

        <article className="detail-card patient-treatment-card">
          <div className="detail-title-row">
            <div>
              <p className="eyebrow">Tratamento do paciente</p>
              <h2>Agenda vinculada à reclamação</h2>
              <p className="history-note">Ao salvar, o paciente entra automaticamente na Gestão de Pacientes como oriundo de reclamação.</p>
            </div>
            <span className="mini-badge">{linkedPatientTreatments.length} registro(s)</span>
          </div>

          {canCreatePatientTreatment && !isDeletedRecord ? (
            <div className="patient-treatment-form">
              <label>
                Procedimento
                <select
                  className="field"
                  value={patientTreatmentDraft.procedure_name}
                  onChange={(event) => handlePatientTreatmentDraft('procedure_name', event.target.value)}
                >
                  <option value="">Selecione o procedimento</option>
                  {dentalProcedureOptions.map((procedure) => (
                    <option key={procedure} value={procedure}>{procedure}</option>
                  ))}
                </select>
              </label>
              <label>
                Data e hora agendada
                <input
                  className="field"
                  type="datetime-local"
                  value={patientTreatmentDraft.scheduled_at}
                  onChange={(event) => handlePatientTreatmentDraft('scheduled_at', event.target.value)}
                />
              </label>
              <label className="patient-treatment-full">
                Observações
                <textarea
                  className="field textarea"
                  value={patientTreatmentDraft.note}
                  onChange={(event) => handlePatientTreatmentDraft('note', event.target.value)}
                  placeholder="Registre informacoes relevantes para o tratamento do paciente."
                  rows={4}
                />
              </label>
              <div className="row-actions patient-treatment-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={handleSavePatientTreatment}
                  disabled={savingPatientTreatment || !patientTreatmentDraft.procedure_name.trim() || !patientTreatmentDraft.scheduled_at.trim()}
                >
                  {savingPatientTreatment ? 'Salvando...' : 'Salvar na gestão de pacientes'}
                </button>
              </div>
            </div>
          ) : (
            <p className="permission-note">Este cadastro fica disponível apenas para Operador de SAC, Supervisor do CRC, Administrador e Administrador Master.</p>
          )}

          <div className="patient-treatment-linked-list">
            {linkedPatientTreatments.length ? linkedPatientTreatments.map((item) => (
              <button
                key={item.id}
                type="button"
                className="patient-treatment-linked-item"
                onClick={() => navigate(`/pacientes?abrir=${item.id}`)}
              >
                <div className="patient-treatment-linked-head">
                  <strong>{item.protocol || `PAC-${item.id}`}</strong>
                  <span>{item.status || 'Em tratamento'}</span>
                </div>
                <p>{item.procedureName || 'Procedimento não informado'}</p>
                <small>
                  {item.scheduledAt ? `Agendado para ${formatDate(item.scheduledAt)}` : 'Data não informada'}
                  {item.note ? ` · ${item.note}` : ''}
                </small>
              </button>
            )) : (
              <p className="empty-mini">Nenhum tratamento do paciente foi vinculado a esta reclamação até o momento.</p>
            )}
          </div>
        </article>

        <article className="detail-card evidence-card">
          <div className="detail-title-row">
            <div>
              <p className="eyebrow">Evidências</p>
              <h2>Documentos da tratativa</h2>
            </div>
            <span className="mini-badge">Max. 10 MB</span>
          </div>
          <p className="permission-note">Exclusões ficam registradas no histórico do protocolo.</p>

          {canAttachEvidence ? (
            <div className="evidence-uploader">
              <label>
                Descrição da evidência
                <input
                  className="field"
                  value={evidenceDescription}
                  onChange={(event) => setEvidenceDescription(event.target.value)}
                  placeholder="Ex.: comprovante de contato, termo, foto, retorno da unidade"
                />
              </label>
              <label>
                Arquivo
                <input
                  className="field"
                  type="file"
                  onChange={(event) => setEvidenceFile(event.target.files[0] || null)}
                />
              </label>
              <button className="secondary-action" onClick={handleEvidenceUpload} disabled={uploading}>
                {uploading ? 'Anexando...' : 'Anexar evidência'}
              </button>
            </div>
          ) : (
            <p className="permission-note">Seu perfil pode consultar as evidências, mas não anexar novos documentos.</p>
          )}

          {evidenceRecords.length ? (
            <>
              <div className="detail-table-scroll">
                <table className="detail-data-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th>Responsável</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedEvidenceRecords.map((evidence) => {
                      const evidenceUrl = resolveUploadedFileUrl(evidence.file_url);
                      const evidenceLabel = evidence.description || evidence.original_name || 'Evidência anexada';

                      return (
                        <tr key={evidence.id}>
                          <td>{formatDate(evidence.created_at)}</td>
                          <td>
                            <button
                              type="button"
                              className="table-link-button"
                              onClick={() => openUploadedItem(evidenceUrl, evidenceLabel)}
                            >
                              {evidenceLabel}
                            </button>
                            <small>{evidence.original_name || 'Arquivo vinculado ao protocolo'}</small>
                          </td>
                          <td>{evidence.uploaded_by_name || 'Não informado'}</td>
                          <td>
                            <div className="table-action-stack">
                              <button
                                type="button"
                                className="outline-action compact-action"
                                onClick={() => openUploadedItem(evidenceUrl, evidenceLabel)}
                              >
                                Abrir
                              </button>
                              {canDeleteEvidence && (
                                <button
                                  type="button"
                                  className="evidence-delete-button"
                                  onClick={() => handleDeleteEvidence(evidence)}
                                  disabled={deletingEvidenceId === evidence.id}
                                >
                                  {deletingEvidenceId === evidence.id ? 'Excluindo...' : 'Excluir'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="pagination-bar compact-pagination">
                <span>Mostrando {evidenceStart} a {evidenceEnd} de {evidenceRecords.length} evidências</span>
                <div className="pagination-actions">
                  <button className="outline-action" type="button" onClick={() => setEvidencePage((page) => Math.max(1, page - 1))} disabled={currentEvidencePage <= 1}>
                    Anterior
                  </button>
                  <strong>{currentEvidencePage} / {totalEvidencePages}</strong>
                  <button className="outline-action" type="button" onClick={() => setEvidencePage((page) => Math.min(totalEvidencePages, page + 1))} disabled={currentEvidencePage >= totalEvidencePages}>
                    Próxima
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="empty-mini">Nenhuma evidência complementar anexada.</p>
          )}

        </article>

        <article className="detail-card timeline-card">
          <div className="detail-title-row">
            <div>
              <p className="eyebrow">Histórico imutável</p>
              <h2>Tratativas e atualizações do protocolo</h2>
              <p className="history-note">Cada descrição salva permanece vinculada ao usuário, data e perfil. Não há exclusão de relatos pela tela.</p>
            </div>
            <span className="mini-badge">{complaint.logs?.length || 0} registros</span>
          </div>

          {historyRecords.length ? (
            <>
              <div className="detail-table-scroll history-table-scroll">
                <table className="detail-data-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Usuário</th>
                      <th>Perfil</th>
                      <th>Registro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHistoryRecords.map((log) => (
                      <tr key={log.id}>
                        <td>{formatDate(log.created_at)}</td>
                        <td>{log.actor_name || 'Usuário do sistema'}</td>
                        <td>{roleLabels[log.actor_role] || log.actor_role || 'Atualização'}</td>
                        <td>{log.message || 'Atualização registrada no protocolo.'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination-bar compact-pagination">
                <span>Mostrando {historyStart} a {historyEnd} de {historyRecords.length} registros</span>
                <div className="pagination-actions">
                  <button className="outline-action" type="button" onClick={() => setHistoryPage((page) => Math.max(1, page - 1))} disabled={currentHistoryPage <= 1}>
                    Anterior
                  </button>
                  <strong>{currentHistoryPage} / {totalHistoryPages}</strong>
                  <button className="outline-action" type="button" onClick={() => setHistoryPage((page) => Math.min(totalHistoryPages, page + 1))} disabled={currentHistoryPage >= totalHistoryPages}>
                    Próxima
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="empty-mini">Ainda não existem registros complementares na linha do tempo.</p>
          )}

        </article>

        <article className="detail-card detail-actions-card command-center-card">
          <div className="command-center-header">
            <div>
              <p className="eyebrow">Tratativa e fechamento</p>
              <h2>Centro de decisão</h2>
            </div>
            <span className="mini-badge">{statusLabels[complaint.status] || 'Aberta'}</span>
          </div>

          <div className="approval-grid">
            <div className={`approval-card ${hasTreatment ? 'done' : 'pending'}`}>
              <span>Tratativa gestão</span>
              <strong>{hasTreatment ? 'Registrada' : 'Pendente'}</strong>
              <p>
                {hasTreatment
                  ? `${roleLabels[complaint.treatment_by_role] || complaint.treatment_by_role || 'Gestão'} · ${formatDate(complaint.treatment_at)}`
                  : 'Coordenador, Gerente ou Supervisor do CRC deve registrar a tratativa.'}
              </p>
            </div>
            <div className={`approval-card ${hasPatientContact ? 'done' : 'pending'}`}>
              <span>Contato com paciente</span>
              <strong>{hasPatientContact ? 'Realizado' : 'Pendente'}</strong>
              <p>{hasPatientContact ? `${complaint.patient_contacted_by || 'SAC'} · ${formatDate(complaint.patient_contacted_at)}` : 'Registro exclusivo do Operador de SAC.'}</p>
            </div>
            <div className={`approval-card ${hasFirstAttendance ? 'done' : 'pending'}`}>
              <span>Primeiro atendimento</span>
              <strong>{hasFirstAttendance ? 'Realizado' : 'Pendente'}</strong>
              <p>{hasFirstAttendance ? `${complaint.first_attendance_by || 'Atendimento'} · ${formatDate(complaint.first_attendance_at)} · ${complaint.forwarded_to_label || 'Tratativa'}` : 'Administrador Master, Supervisor do CRC ou Operador de SAC registram e encaminham para tratativa.'}</p>
            </div>
            <div className={`approval-card ${!isHighPriority ? 'neutral' : hasSupervisorApproval ? 'done' : 'pending'}`}>
              <span>Aceite Supervisor CRC</span>
              <strong>{!isHighPriority ? 'Não aplicável' : hasSupervisorApproval ? 'Aprovado' : 'Obrigatório'}</strong>
              <p>{hasSupervisorApproval ? `${complaint.supervisor_approval_by || 'Supervisor'} · ${formatDate(complaint.supervisor_approval_at)}` : 'Exigido para prioridade alta.'}</p>
            </div>
            <div className={`approval-card ${hasSacApproval ? 'done' : 'pending'}`}>
              <span>Aceite SAC</span>
              <strong>{hasSacApproval ? 'Concluído' : 'Pendente'}</strong>
              <p>{hasSacApproval ? `${complaint.sac_approval_by || 'SAC'} · ${formatDate(complaint.sac_approval_at)}` : 'Gerado no fechamento pelo Operador de SAC.'}</p>
            </div>
          </div>

          <label>
            Acrescentar descrição das tratativas
            <textarea
              className="field textarea treatment-textarea"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Digite uma nova tratativa. O conteúdo será acrescentado ao histórico do protocolo."
              disabled={complaint.status === 'resolvida'}
            />
          </label>

          <p className="permission-note">
            Perfil atual: {roleLabels[user?.role] || user?.role || 'Não identificado'}.
            {canFormalTreatment
              ? ' Sua atualização conta como tratativa formal para o fluxo operacional.'
              : ' Sua atualização fica salva no histórico; fechamento e aceite seguem a hierarquia configurada.'}
          </p>

          {feedback && <p className="form-feedback">{feedback}</p>}

          <div className="row-actions">
            {canRecordTreatment && complaint.status !== 'resolvida' && (
              <button className="secondary-action" onClick={handleSaveTreatment} disabled={saving || !comment.trim() || isDeletedRecord}>
                {saving ? 'Salvando...' : 'Salvar atualização'}
              </button>
            )}
            {canSupervisorAccept && isHighPriority && complaint.status !== 'resolvida' && (
              <button className="outline-action" onClick={handleSupervisorAccept} disabled={saving || !comment.trim() || isDeletedRecord}>
                Registrar aceite CRC
              </button>
            )}
            {canOperationalClose && complaint.status !== 'resolvida' && (
              <button className="outline-action" onClick={handlePatientContact} disabled={saving || !canMarkPatientContact || isDeletedRecord}>
                {hasPatientContact ? 'Contato ja registrado' : 'Registrar contato com paciente'}
              </button>
            )}
            {canReassignForward && complaint.status !== 'resolvida' && !isDeletedRecord && (
              <button className="outline-action" onClick={handleOpenReassignForward} disabled={saving}>
                {canReturnToSac ? 'Devolver para Operador de SAC' : 'Encaminhar para unidade'}
              </button>
            )}
            {canOperationalClose && (
              <button className="primary-action" onClick={handleClose} disabled={saving || !canCloseNow || isDeletedRecord}>
                {saving ? 'Fechando...' : 'Fechar protocolo'}
              </button>
            )}
            {canReactivateComplaint && (isDeletedRecord || complaint.status === 'resolvida') && (
              <button
                className="secondary-action"
                onClick={() => {
                  setFeedback('');
                  setShowReactivateModal(true);
                }}
                disabled={saving}
              >
                Re-habilitar reclamação
              </button>
            )}
          </div>

          {closeBlockedReason && complaint.status !== 'resolvida' && (
            <p className="blocking-note">{closeBlockedReason}</p>
          )}
        </article>
      </section>

      {showForwardModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Encaminhar para tratativa" onClick={() => setShowForwardModal(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Encaminhamento da reclamação</p>
            <h2>
              {forwardModalMode === 'reassign'
                ? canReturnToSac
                  ? 'Devolver para o Operador de SAC'
                  : 'Reencaminhar demanda'
                : 'Selecionar próximo responsável'}
            </h2>
            <p>
              {forwardModalMode === 'reassign'
                ? canReturnToSac
                  ? 'Ao confirmar, a demanda voltará para o Operador de SAC e o histórico da tratativa ficará registrado.'
                  : 'Ao confirmar, a reclamação será enviada novamente para o coordenador ou gerente da unidade e o histórico ficará registrado.'
                : 'Ao confirmar, o contato com o paciente será registrado e a reclamação será encaminhada para o responsável escolhido.'}
            </p>

            <label>
              Responsavel pela tratativa
              <select className="field" value={forwardToRole} onChange={(event) => setForwardToRole(event.target.value)} required>
                <option value="">Selecione o destino</option>
                {(forwardModalMode === 'reassign' ? reassignOptions : forwardingOptions).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => setShowForwardModal(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="primary-action" type="button" onClick={handleContactForward} disabled={saving || !forwardToRole}>
                {saving ? 'Salvando...' : 'Confirmar encaminhamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {assetPreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Visualizar arquivo do protocolo" onClick={closeAssetPreview}>
          <div className="modal-panel attachment-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="detail-title-row">
              <div>
                <p className="eyebrow">Arquivo do protocolo</p>
                <h2>{assetPreview.label}</h2>
              </div>
              <div className="attachment-preview-toolbar" aria-label="Controles da imagem">
                <button type="button" className="outline-action compact-action" onClick={() => changeAssetPreviewZoom(-0.25)} disabled={assetPreviewZoom <= 0.75}>
                  Reduzir
                </button>
                <strong>{Math.round(assetPreviewZoom * 100)}%</strong>
                <button type="button" className="outline-action compact-action" onClick={() => changeAssetPreviewZoom(0.25)} disabled={assetPreviewZoom >= 3}>
                  Ampliar
                </button>
                <button type="button" className="outline-action compact-action" onClick={resetAssetPreviewZoom} disabled={assetPreviewZoom === 1}>
                  Restaurar
                </button>
                <button type="button" className="outline-action compact-action" onClick={closeAssetPreview}>
                  Fechar
                </button>
              </div>
            </div>

            <div className="attachment-preview-modal-body">
              <div
                className="attachment-preview-zoom-stage"
                style={{
                  '--preview-zoom': String(assetPreviewZoom),
                  minWidth: `${assetPreviewZoom * 100}%`,
                  minHeight: `${assetPreviewZoom * 100}%`
                }}
              >
                <img src={assetPreview.url} alt={assetPreview.label} className="attachment-preview-fullscreen" />
              </div>
            </div>

            <div className="row-actions">
              <button type="button" className="outline-action" onClick={closeAssetPreview}>
                Voltar
              </button>
              <button type="button" className="primary-action" onClick={() => window.open(assetPreview.url, '_blank', 'noopener,noreferrer')}>
                Abrir em nova janela
              </button>
            </div>
          </div>
        </div>
      )}

      {showReactivateModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Informar motivo da reabertura" onClick={() => setShowReactivateModal(false)}>
          <div className="modal-panel modal-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Re-habilitar reclamação</p>
            <h2>Informe o motivo da reabertura</h2>
            <label>
              Motivo obrigatório
              <textarea
                className="field textarea"
                value={reactivateReason}
                onChange={(event) => setReactivateReason(event.target.value)}
                placeholder="Descreva por que este protocolo está sendo reaberto."
                rows={4}
              />
            </label>
            <div className="row-actions">
              <button
                className="outline-action"
                type="button"
                onClick={() => {
                  setShowReactivateModal(false);
                  setReactivateReason('');
                }}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={handleReactivateComplaint}
                disabled={saving || !reactivateReason.trim()}
              >
                {saving ? 'Reabilitando...' : 'Confirmar reabertura'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar exclusão do protocolo" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-panel modal-confirm-panel" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">Excluir protocolo</p>
            <h2>Tem certeza que deseja excluir?</h2>
            <div className="row-actions">
              <button
                className="outline-action"
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                className="outline-action danger-action"
                type="button"
                onClick={handleDeleteComplaint}
                disabled={saving}
              >
                {saving ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default ComplaintDetail;


