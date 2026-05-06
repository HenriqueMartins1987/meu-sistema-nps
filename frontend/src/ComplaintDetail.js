import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import api, { apiBaseUrl } from './api';
import { isAdmin as isAdminUser, isMasterAdmin, priorityOptions, readUser, statusLabels } from './constants';

const maxUploadSizeBytes = 10 * 1024 * 1024;
const treatmentRoles = ['coordinator', 'manager', 'supervisor_crc'];
const evidenceRoles = ['coordinator', 'manager', 'supervisor_crc', 'sac_operator', 'admin'];
const previewableImagePattern = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?.*)?$/i;

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
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [forwardToRole, setForwardToRole] = useState('');
  const [assetPreview, setAssetPreview] = useState(null);

  const protocol = useMemo(() => formatProtocol(complaint), [complaint]);
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
  const canFormalTreatment = treatmentRoles.includes(user?.role) || isAdmin;
  const canRecordTreatment = Boolean(user?.role);
  const canAttachEvidence = evidenceRoles.includes(user?.role) || isAdmin;
  const canSupervisorAccept = user?.role === 'supervisor_crc' || isAdmin;
  const canSacClose = user?.role === 'sac_operator' || isAdmin;
  const canDeleteComplaint = isMasterAdmin(user) || user?.role === 'supervisor_crc';
  const canDeleteEvidence = Boolean(user?.id || user?.email || user?.role);
  const canChangeComplaintUnit = isAdmin || user?.role === 'supervisor_crc' || user?.role === 'sac_operator';
  const canRenotifyComplaint = isMasterAdmin(user) || user?.role === 'supervisor_crc' || user?.role === 'sac_operator';
  const activeUnitOptions = useMemo(() => (
    unitOptions
      .filter((unit) => unit?.name && String(unit.active ?? 1) !== '0')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  ), [unitOptions]);
  const hasUnitChange = String(selectedClinicId || '') !== String(complaint?.clinic_id || '');
  const hasTreatment = Boolean(complaint?.treatment_at);
  const isHighPriority = normalizePriority(complaint?.priority) === 'alta';
  const hasSupervisorApproval = Boolean(complaint?.supervisor_approval_at);
  const hasSacApproval = Boolean(complaint?.sac_approval_at);
  const hasPatientContact = Boolean(complaint?.patient_contacted_at);
  const isDeletedRecord = Boolean(complaint?.deleted_at);
  const canMarkPatientContact = canSacClose && complaint?.status !== 'resolvida' && !hasPatientContact;
  const hasFirstAttendance = Boolean(complaint?.first_attendance_at);
  const canRegisterFirstAttendance = canSacClose
    && complaint?.status !== 'resolvida'
    && !hasFirstAttendance;
  const closeBlockedReason = !canSacClose
    ? 'Apenas o Operador de SAC ou o Administrador pode fechar este protocolo.'
    : !hasTreatment
      ? 'Aguarde a tratativa de Coordenador, Gerente ou Supervisor do CRC.'
      : isHighPriority && !hasSupervisorApproval
        ? 'Prioridade alta exige aceite do Supervisor do CRC.'
        : '';
  const canCloseNow = canSacClose && !closeBlockedReason && complaint?.status !== 'resolvida';

  const loadComplaint = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const res = await api.get(`/complaints/${id}${includeDeleted ? '?include_deleted=1' : ''}`);
      const data = res.data;
      setComplaint(data);
      setSelectedClinicId(data?.clinic_id ? String(data.clinic_id) : '');
      setComment('');
    } catch (error) {
      setFeedback('Não foi possível carregar este protocolo.');
    } finally {
      setLoading(false);
    }
  }, [id, includeDeleted]);

  const openUploadedItem = useCallback((url, label = 'Arquivo do protocolo') => {
    if (!url) return;

    if (isPreviewableImage(url)) {
      setAssetPreview({ url, label, type: 'image' });
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  useEffect(() => {
    loadComplaint();
  }, [loadComplaint]);

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
    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/complaints/${id}`, {
        status: 'em_andamento',
        patient_contacted: true
      });
      setFeedback('Contato Realizado');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao registrar contato com o paciente.');
    } finally {
      setSaving(false);
    }
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

  const handleFirstAttendanceForward = async () => {
    if (!forwardToRole) {
      setFeedback('Selecione para quem o protocolo será enviado para tratativa.');
      return;
    }

    setSaving(true);
    setFeedback('');

    try {
      await api.patch(`/complaints/${id}`, {
        status: 'em_andamento',
        first_attendance: true,
        forward_to_role: forwardToRole
      });
      setShowForwardModal(false);
      setForwardToRole('');
      setFeedback('Primeiro atendimento registrado, deadline travado e protocolo encaminhado para tratativa.');
      await loadComplaint();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Erro ao registrar primeiro atendimento.');
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
        <div>
          <p className="eyebrow">Ficha executiva do protocolo</p>
          <h1>{protocol}</h1>
          <p>{complaint.clinic_name || 'Clínica não informada'} · {complaint.city || 'Cidade'} / {complaint.state || 'UF'}</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
          <button className="outline-action" onClick={() => navigate('/gestao')}>
            Voltar para gestão
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

      <section className="complaint-detail-grid executive-detail-grid">
        <article className="detail-card">
          <div className="detail-title-row">
            <div>
              <p className="eyebrow">Paciente</p>
              <h2>{complaint.patient_name || 'Não informado'}</h2>
            </div>
            <span className={`status-pill ${complaint.status || 'aberta'}`}>
              {statusLabels[complaint.status] || 'Aberta'}
            </span>
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

          <dl className="meta-grid">
            <div>
              <dt>Unidade</dt>
              <dd>{complaint.clinic_name || 'Não informada'}</dd>
            </div>
            <div>
              <dt>Telefone</dt>
              <dd>{complaint.patient_phone || 'Não informado'}</dd>
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
              <dd>{complaint.channel || 'Não informado'}</dd>
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
        </article>

        <article className="detail-card">
          <p className="eyebrow">Relato original</p>
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

          <div className="evidence-list">
            {complaint.evidences?.length ? complaint.evidences.map((evidence) => {
              const evidenceUrl = resolveUploadedFileUrl(evidence.file_url);

              return (
                <article className="evidence-item" key={evidence.id}>
                  <button
                    type="button"
                    className="evidence-open-button"
                    onClick={() => openUploadedItem(evidenceUrl, evidence.description || evidence.original_name || 'Evidência anexada')}
                  >
                    {isPreviewableImage(evidenceUrl) && (
                      <img
                        className="evidence-preview"
                        src={evidenceUrl}
                        alt={evidence.description || evidence.original_name || 'Evidência anexada'}
                        loading="lazy"
                      />
                    )}
                    <span>{evidence.description || evidence.original_name || 'Evidência anexada'}</span>
                    <small>
                      {formatDate(evidence.created_at)}
                      {evidence.uploaded_by_name ? ` · ${evidence.uploaded_by_name}` : ''}
                    </small>
                  </button>
                  {canDeleteEvidence && (
                    <button
                      type="button"
                      className="evidence-delete-button"
                      onClick={() => handleDeleteEvidence(evidence)}
                      disabled={deletingEvidenceId === evidence.id}
                    >
                      {deletingEvidenceId === evidence.id ? 'Excluindo...' : 'Excluir evidência'}
                    </button>
                  )}
                </article>
              );
            }) : (
              <p className="empty-mini">Nenhuma evidência complementar anexada.</p>
            )}
          </div>
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

          <div className="history-list">
            {complaint.logs?.length ? complaint.logs.map((log) => (
              <article className="history-item" key={log.id}>
                <div className="history-item-head">
                  <strong>{formatDate(log.created_at)}</strong>
                  <span>{roleLabels[log.actor_role] || log.actor_role || 'Atualização'}</span>
                </div>
                <p>{log.message || 'Atualização registrada no protocolo.'}</p>
                <small>{log.actor_name || 'Usuário do sistema'}</small>
              </article>
            )) : (
              <p className="empty-mini">Ainda não existem registros complementares na linha do tempo.</p>
            )}
          </div>
        </article>

        <article className="detail-card detail-actions-card command-center-card">
          <p className="eyebrow">Tratativa e fechamento</p>
          <h2>Centro de decisão</h2>

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
              <p>{hasFirstAttendance ? `${complaint.first_attendance_by || 'Atendimento'} · ${formatDate(complaint.first_attendance_at)} · ${complaint.forwarded_to_label || 'Tratativa'}` : 'Operador de SAC ou administrador registra e encaminha para tratativa.'}</p>
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
            {canSacClose && complaint.status !== 'resolvida' && (
              <button className="outline-action" onClick={handlePatientContact} disabled={saving || !canMarkPatientContact || isDeletedRecord}>
                {hasPatientContact ? 'Contato já registrado' : 'Registrar contato com paciente'}
              </button>
            )}
            {canSacClose && complaint.status !== 'resolvida' && (
              <button className="outline-action" onClick={() => setShowForwardModal(true)} disabled={saving || !canRegisterFirstAttendance || isDeletedRecord}>
                {hasFirstAttendance ? 'Primeiro atendimento registrado' : 'Registrar primeiro atendimento'}
              </button>
            )}
            <button className="primary-action" onClick={handleClose} disabled={saving || !canCloseNow || isDeletedRecord}>
              {saving ? 'Fechando...' : 'Fechar protocolo'}
            </button>
          </div>

          {closeBlockedReason && complaint.status !== 'resolvida' && (
            <p className="blocking-note">{closeBlockedReason}</p>
          )}
        </article>
      </section>

      {showForwardModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Encaminhar para tratativa">
          <div className="modal-panel">
            <p className="eyebrow">Primeiro atendimento</p>
            <h2>Enviar protocolo para tratativa</h2>
            <p>
              Ao confirmar, o primeiro atendimento será registrado, o deadline ficará travado e o log será criado para auditoria.
            </p>

            <label>
              Responsável pela tratativa
              <select className="field" value={forwardToRole} onChange={(event) => setForwardToRole(event.target.value)} required>
                <option value="">Selecione o destino</option>
                {forwardingOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <div className="row-actions">
              <button className="outline-action" type="button" onClick={() => setShowForwardModal(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="primary-action" type="button" onClick={handleFirstAttendanceForward} disabled={saving || !forwardToRole}>
                {saving ? 'Salvando...' : 'Confirmar encaminhamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {assetPreview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Visualizar arquivo do protocolo">
          <div className="modal-panel attachment-preview-modal">
            <div className="detail-title-row">
              <div>
                <p className="eyebrow">Arquivo do protocolo</p>
                <h2>{assetPreview.label}</h2>
              </div>
              <button type="button" className="outline-action" onClick={() => setAssetPreview(null)}>
                Fechar
              </button>
            </div>

            <div className="attachment-preview-modal-body">
              <img src={assetPreview.url} alt={assetPreview.label} className="attachment-preview-fullscreen" />
            </div>

            <div className="row-actions">
              <button type="button" className="outline-action" onClick={() => setAssetPreview(null)}>
                Voltar
              </button>
              <button type="button" className="primary-action" onClick={() => window.open(assetPreview.url, '_blank', 'noopener,noreferrer')}>
                Abrir em nova janela
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar exclusão do protocolo">
          <div className="modal-panel modal-confirm-panel">
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


