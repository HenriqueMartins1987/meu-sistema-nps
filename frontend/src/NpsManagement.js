import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';

const profileLabels = {
  detrator: 'Detrator',
  neutro: 'Neutro',
  promotor: 'Promotor'
};

const statusLabels = {
  registrado: 'Registrado',
  em_tratativa: 'Em tratamento',
  tratado: 'Tratado'
};

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function formatDate(value) {
  if (!value) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function profileFromScore(score) {
  const value = Number(score || 0);
  if (value >= 9) return 'promotor';
  if (value >= 7) return 'neutro';
  return 'detrator';
}

function getNpsStatus(item) {
  return item?.nps_status || 'registrado';
}

function protocolLabel(item) {
  if (item?.nps_protocol) return item.nps_protocol;

  const year = item?.created_at ? new Date(item.created_at).getFullYear() : new Date().getFullYear();
  return `NPS-${year}-${String(item?.id || 0).padStart(6, '0')}`;
}

function parseReasons(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [String(value)];
  } catch (error) {
    return [String(value)];
  }
}

function NpsManagement() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({
    profile: '',
    clinic: '',
    status: '',
    search: ''
  });
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [selectedNps, setSelectedNps] = useState(null);
  const [treatmentText, setTreatmentText] = useState('');
  const [treatmentStatus, setTreatmentStatus] = useState('em_tratativa');
  const [feedback, setFeedback] = useState('');

  const loadRows = async () => {
    setLoading(true);
    setFeedback('');

    try {
      const res = await api.get('/nps/responses');
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar as pesquisas NPS.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const clinicOptions = useMemo(() => (
    Array.from(new Set(rows.map((item) => item.clinic_name).filter(Boolean)))
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))
  ), [rows]);

  const filteredRows = useMemo(() => rows.filter((item) => {
    const profile = item.nps_profile || profileFromScore(item.score);
    const status = getNpsStatus(item);
    const searchable = [
      protocolLabel(item),
      item.patient_name,
      item.patient_phone,
      item.clinic_name,
      item.city,
      item.state,
      item.region,
      item.detractor_feedback,
      item.improvement_comment,
      item.comment,
      item.nps_treatment_comment,
      ...(item.logs || []).map((log) => log.message)
    ].map(normalizeText).join(' ');

    return (
      (!filters.profile || profile === filters.profile)
      && (!filters.clinic || item.clinic_name === filters.clinic)
      && (!filters.status || status === filters.status)
      && (!filters.search || searchable.includes(normalizeText(filters.search)))
    );
  }), [rows, filters]);

  const metrics = useMemo(() => {
    const total = rows.length;
    const promoters = rows.filter((item) => Number(item.score) >= 9).length;
    const neutrals = rows.filter((item) => Number(item.score) >= 7 && Number(item.score) <= 8).length;
    const detractors = rows.filter((item) => Number(item.score) <= 6).length;
    const inTreatment = rows.filter((item) => getNpsStatus(item) === 'em_tratativa').length;
    const treated = rows.filter((item) => getNpsStatus(item) === 'tratado').length;
    const pendingDetractors = rows.filter((item) => Number(item.score) <= 6 && getNpsStatus(item) !== 'tratado').length;
    const nps = total ? Math.round(((promoters - detractors) / total) * 100) : 0;

    return { total, promoters, neutrals, detractors, inTreatment, treated, pendingDetractors, nps };
  }, [rows]);

  const updateFilter = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const openTreatment = (item) => {
    setSelectedNps(item);
    setTreatmentText('');
    setTreatmentStatus(getNpsStatus(item) === 'tratado' ? 'tratado' : 'em_tratativa');
    setFeedback('');
  };

  const closeTreatment = () => {
    setSelectedNps(null);
    setTreatmentText('');
    setTreatmentStatus('em_tratativa');
  };

  const handleSaveTreatment = async () => {
    const comment = treatmentText.trim();

    if (!comment) {
      setFeedback('Descreva a tratativa realizada antes de salvar.');
      return;
    }

    setSavingId(selectedNps.id);
    setFeedback('');

    try {
      const res = await api.patch(`/nps/responses/${selectedNps.id}/treatment`, {
        treatment_comment: comment,
        status: treatmentStatus
      });
      const updated = res.data?.response;

      if (updated) {
        setRows((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        await loadRows();
      }

      setFeedback(`Tratativa salva no protocolo ${res.data?.protocol || protocolLabel(selectedNps)}.`);
      closeTreatment();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar a tratativa NPS.');
    } finally {
      setSavingId(null);
    }
  };

  const handleConvertToComplaint = async () => {
    setSavingId(selectedNps.id);
    setFeedback('');

    try {
      const res = await api.post(`/nps/responses/${selectedNps.id}/convert-complaint`);
      await loadRows();
      closeTreatment();
      setFeedback(`Detrator migrado para reclamação no protocolo ${res.data?.protocol || ''}.`);

      if (res.data?.complaintId) {
        navigate(`/gestao/${res.data.complaintId}`);
      }
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível migrar este NPS para reclamação.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Gestão NPS</p>
          <h1>Painel de Gestão NPS</h1>
          <p>Trate clientes detratores em protocolo próprio, sem misturar com a gestão de reclamações.</p>
        </div>

        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/dashboard-nps')}>
            Dashboard NPS
          </button>
          <button className="outline-action" onClick={() => navigate('/home')}>
            Home
          </button>
        </div>
      </header>

      <section className="kpi-grid management-kpi-grid" aria-label="Resumo NPS">
        <article className="kpi-card">
          <span>NPS</span>
          <strong>{metrics.nps}</strong>
          <p>ÍNDICE ATUAL</p>
        </article>
        <article className="kpi-card success">
          <span>Promotores</span>
          <strong>{metrics.promoters}</strong>
          <p>NOTAS 9 E 10</p>
        </article>
        <article className="kpi-card progress">
          <span>Neutros</span>
          <strong>{metrics.neutrals}</strong>
          <p>NOTAS 7 E 8</p>
        </article>
        <article className="kpi-card danger">
          <span>Detratores</span>
          <strong>{metrics.detractors}</strong>
          <p>NOTAS 1 A 6</p>
        </article>
        <article className="kpi-card warning">
          <span>Pendentes</span>
          <strong>{metrics.pendingDetractors}</strong>
          <p>DETRATORES EM ABERTO</p>
        </article>
        <article className="kpi-card">
          <span>Tratados</span>
          <strong>{metrics.treated}</strong>
          <p>PROTOCOLOS NPS</p>
        </article>
      </section>

      <section className="management-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Pesquisas</p>
            <h2>Lista de respostas NPS</h2>
          </div>

          <div className="filters nps-management-filters">
            <input
              className="field"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
              placeholder="Buscar protocolo, paciente, unidade, telefone ou relato"
            />
            <select className="field" value={filters.clinic} onChange={(event) => updateFilter('clinic', event.target.value)}>
              <option value="">Todas as unidades</option>
              {clinicOptions.map((clinic) => (
                <option key={clinic} value={clinic}>{clinic}</option>
              ))}
            </select>
            <select className="field" value={filters.profile} onChange={(event) => updateFilter('profile', event.target.value)}>
              <option value="">Todos os perfis</option>
              <option value="detrator">Detratores</option>
              <option value="neutro">Neutros</option>
              <option value="promotor">Promotores</option>
            </select>
            <select className="field" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">Todos os status</option>
              <option value="registrado">Registrado</option>
              <option value="em_tratativa">Em tratamento</option>
              <option value="tratado">Tratado</option>
            </select>
          </div>
        </div>

        {feedback && <p className="form-feedback">{feedback}</p>}

        {loading ? (
          <p className="empty-state">Carregando pesquisas NPS...</p>
        ) : filteredRows.length === 0 ? (
          <p className="empty-state">Nenhuma pesquisa encontrada com os filtros atuais.</p>
        ) : (
          <div className="nps-list">
            {filteredRows.map((item) => {
              const profile = item.nps_profile || profileFromScore(item.score);
              const status = getNpsStatus(item);
              const reasons = parseReasons(item.detractor_reasons);
              const isDetractor = profile === 'detrator';

              return (
                <article className={`nps-list-item ${profile}`} key={item.id}>
                  <div className="nps-score-block">
                    <span className={`nps-score-pill ${profile}`}>{item.score}</span>
                    <strong>{profileLabels[profile]}</strong>
                    <small>{formatDate(item.created_at)}</small>
                  </div>

                  <div className="nps-list-content">
                    <div className="nps-list-headline">
                      <span className="nps-protocol-label">{protocolLabel(item)}</span>
                      <span className={`nps-status-chip ${status}`}>{statusLabels[status] || status}</span>
                    </div>
                    <span className="person-label">Paciente</span>
                    <h3>{item.patient_name || 'Paciente não informado'}</h3>
                    <p>{item.clinic_name || 'Unidade não informada'} · {item.city || 'Cidade'} / {item.state || 'UF'}</p>

                    {item.detractor_feedback && <p className="nps-relato">{item.detractor_feedback}</p>}
                    {item.improvement_comment && <p className="nps-relato">{item.improvement_comment}</p>}
                    {item.comment && <p className="nps-relato">{item.comment}</p>}
                    {reasons.length > 0 && (
                      <div className="nps-reason-row">
                        {reasons.map((reason) => <span key={reason}>{reason}</span>)}
                      </div>
                    )}
                  </div>

                  <div className="nps-action-stack">
                    <span className={`deadline-chip ${status === 'tratado' ? 'closed' : isDetractor ? 'danger' : 'neutral'}`}>
                      {isDetractor ? 'Relato para tratamento' : 'Registro NPS'}
                    </span>
                    {item.nps_treatment_at && (
                      <small>Última tratativa: {formatDate(item.nps_treatment_at)}</small>
                    )}
                    <button
                      className={isDetractor ? 'primary-action' : 'outline-action'}
                      onClick={() => openTreatment(item)}
                    >
                      {isDetractor ? 'Abrir relato para tratamento' : 'Abrir avaliação'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedNps && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel nps-treatment-modal">
            <div className="nps-modal-title">
              <div>
                <p className="eyebrow">Tratativa NPS</p>
                <h2>{protocolLabel(selectedNps)}</h2>
              </div>
              <span className={`nps-status-chip ${getNpsStatus(selectedNps)}`}>
                {statusLabels[getNpsStatus(selectedNps)] || getNpsStatus(selectedNps)}
              </span>
            </div>

            <div className="nps-treatment-summary">
              <div>
                <span>Paciente</span>
                <strong>{selectedNps.patient_name || 'Não informado'}</strong>
              </div>
              <div>
                <span>Telefone</span>
                <strong>{selectedNps.patient_phone || 'Não informado'}</strong>
              </div>
              <div>
                <span>Unidade</span>
                <strong>{selectedNps.clinic_name || 'Não informada'}</strong>
              </div>
              <div>
                <span>Nota</span>
                <strong>{selectedNps.score}</strong>
              </div>
            </div>

            <div className="nps-treatment-relato">
              <strong>Relato do cliente</strong>
              <p>{selectedNps.detractor_feedback || selectedNps.improvement_comment || selectedNps.comment || 'Sem comentário detalhado.'}</p>
              {parseReasons(selectedNps.detractor_reasons).length > 0 && (
                <div className="nps-reason-row">
                  {parseReasons(selectedNps.detractor_reasons).map((reason) => <span key={reason}>{reason}</span>)}
                </div>
              )}
              {selectedNps.recommend_yes ? (
                <p className="history-note">
                  Houve indicação: {selectedNps.referral_name || 'nome não informado'} · {selectedNps.referral_phone || 'telefone não informado'}
                </p>
              ) : (
                <p className="history-note">Sem indicação registrada.</p>
              )}
            </div>

            {(selectedNps.nps_profile || profileFromScore(selectedNps.score)) === 'detrator' && (
              <>
                <label>
                  Status da tratativa
                  <select className="field" value={treatmentStatus} onChange={(event) => setTreatmentStatus(event.target.value)}>
                    <option value="em_tratativa">Em tratamento</option>
                    <option value="tratado">Tratado</option>
                  </select>
                </label>

                <label>
                  Descrição da tratativa
                  <textarea
                    className="field textarea treatment-textarea"
                    value={treatmentText}
                    onChange={(event) => setTreatmentText(event.target.value.slice(0, 5000))}
                    placeholder="Registre a ação realizada, contato feito, retorno dado ao cliente e próximos passos."
                    maxLength={5000}
                  />
                  <small className="field-counter">{treatmentText.length}/5000 caracteres</small>
                </label>
              </>
            )}

            <div className="nps-treatment-history">
              <strong>Histórico do protocolo</strong>
              {selectedNps.logs?.length ? (
                <div className="history-list">
                  {selectedNps.logs.map((log) => (
                    <article className="history-item" key={log.id}>
                      <div className="history-item-head">
                        <strong>{log.actor_name || 'Usuário'}</strong>
                        <span>{formatDate(log.created_at)}</span>
                      </div>
                      <small>{log.actor_role || 'Perfil não informado'} · {log.action}</small>
                      <p>{log.message}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-mini">Ainda não há tratativas registradas.</p>
              )}
            </div>

            <div className="heading-actions">
              <button className="outline-action" onClick={closeTreatment} disabled={savingId === selectedNps.id}>
                Fechar
              </button>
              {selectedNps.converted_complaint_id ? (
                <button className="outline-action" onClick={() => navigate(`/gestao/${selectedNps.converted_complaint_id}`)}>
                  Abrir reclamação vinculada
                </button>
              ) : (selectedNps.nps_profile || profileFromScore(selectedNps.score)) === 'detrator' && (
                <button className="secondary-action" onClick={handleConvertToComplaint} disabled={savingId === selectedNps.id}>
                  Migrar para reclamação
                </button>
              )}
              {(selectedNps.nps_profile || profileFromScore(selectedNps.score)) === 'detrator' && (
                <button className="primary-action" onClick={handleSaveTreatment} disabled={savingId === selectedNps.id}>
                  {savingId === selectedNps.id ? 'Salvando...' : 'Salvar tratativa'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default NpsManagement;
