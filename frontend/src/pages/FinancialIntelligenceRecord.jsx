import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import api from '../api';
import { hasPermission, readUser } from '../constants';

const FINANCIAL_CENTRAL_CLINIC = { id: 'central-crc', name: 'Escritório Central - CRC', unit: 'CRC' };

const generalFields = [
  ['date', 'Data', 'date'],
  ['campaign_start_date', 'Início da campanha', 'date'],
  ['campaign_end_date', 'Fim da campanha', 'date'],
  ['clinic_id', 'Clínica', 'clinic'],
  ['unit_name', 'Unidade', 'text'],
  ['campaign_target_unit', 'Unidade direcionada da campanha', 'targetUnit'],
  ['operator_name', 'Operador', 'readonly'],
  ['function_name', 'Função/Cargo', 'readonly'],
  ['campaign', 'Campanha', 'text'],
  ['channel', 'Canal', 'select', ['WhatsApp', 'Instagram', 'Facebook', 'Google', 'Indicação', 'Telefone', 'Presencial', 'Outros']],
  ['selic_rate', 'SELIC anual fixa', 'readonlyPercent']
];

const productionFields = [
  ['leads', 'Leads', 'integer'],
  ['appointments', 'Agendamentos', 'integer'],
  ['attendances', 'Comparecimentos', 'integer'],
  ['closings', 'Fechamentos', 'integer'],
  ['revenue', 'Receita Gerada', 'currency'],
  ['marketing_investment', 'Investimento Marketing', 'currency']
];

const marketingCostFields = [
  ['google_ads', 'Google Ads'],
  ['meta_ads', 'Meta Ads'],
  ['tv', 'TV'],
  ['radio', 'Rádio'],
  ['agency', 'Agência'],
  ['designer', 'Designer'],
  ['video_production', 'Produção de Vídeo'],
  ['influencers', 'Influenciadores'],
  ['landing_page', 'Landing Page'],
  ['automation_tools', 'Automação'],
  ['other_marketing_costs', 'Outros Custos Marketing']
];

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function FinancialIntelligenceRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const allowed = hasPermission(user, 'financial_management');
  const canOpenDashboard = hasPermission(user, 'financial_dashboard');
  const [record, setRecord] = useState(null);
  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [openGroups, setOpenGroups] = useState({
    general: true,
    production: true,
    marketing: true
  });

  const loadRecord = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setFeedback('');

    try {
      const [recordRes, clinicsRes] = await Promise.all([
        api.get(`/financial-intelligence/${id}`),
        api.get('/clinics')
      ]);
      setRecord(recordRes.data || null);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível carregar o lançamento financeiro.');
    } finally {
      setLoading(false);
    }
  }, [allowed, id]);

  useEffect(() => {
    loadRecord();
  }, [loadRecord]);

  const patchRecord = (changes) => {
    setRecord((current) => ({ ...current, ...changes }));
  };

  const handleClinicChange = (clinicId) => {
    if (clinicId === FINANCIAL_CENTRAL_CLINIC.id) {
      patchRecord({
        clinic_id: '',
        clinic_name: FINANCIAL_CENTRAL_CLINIC.name,
        unit_name: FINANCIAL_CENTRAL_CLINIC.unit
      });
      return;
    }

    const clinic = clinics.find((item) => String(item.id) === String(clinicId));
    patchRecord({
      clinic_id: clinic?.id || '',
      clinic_name: clinic?.name || '',
      unit_name: clinic?.city || '',
      campaign_target_unit: ''
    });
  };

  const saveRecord = async () => {
    if (!record) return;
    setSaving(true);
    setFeedback('');

    try {
      const payload = { ...record };
      await api.put(`/financial-intelligence/${id}`, payload);
      setFeedback('Lançamento financeiro atualizado com sucesso.');
      await loadRecord();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível salvar o lançamento.');
    } finally {
      setSaving(false);
    }
  };

  const renderField = ([field, label, type = 'currency', options = []]) => {
    if (!record) return null;

    if (type === 'targetUnit' && record.clinic_name !== FINANCIAL_CENTRAL_CLINIC.name) {
      return null;
    }

    if (type === 'clinic') {
      const value = record.clinic_name === FINANCIAL_CENTRAL_CLINIC.name ? FINANCIAL_CENTRAL_CLINIC.id : record.clinic_id || '';
      return (
        <label key={field}>{label}
          <select className="field" value={value} onChange={(event) => handleClinicChange(event.target.value)}>
            <option value="">Selecione</option>
            <option value={FINANCIAL_CENTRAL_CLINIC.id}>{FINANCIAL_CENTRAL_CLINIC.name}</option>
            {clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
          </select>
        </label>
      );
    }

    if (type === 'readonly' || type === 'readonlyPercent') {
      return (
        <label key={field}>{label}
          <input className="field readonly-field" value={type === 'readonlyPercent' ? formatPercent(record[field]) : record[field] || ''} readOnly />
        </label>
      );
    }

    if (type === 'select') {
      return (
        <label key={field}>{label}
          <select className="field" value={record[field] || ''} onChange={(event) => patchRecord({ [field]: event.target.value })}>
            <option value="">Selecione</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      );
    }

    return (
      <label key={field}>{label}
        <input
          className="field"
          type={type === 'date' ? 'date' : type === 'text' ? 'text' : 'number'}
          step={type === 'integer' ? '1' : '0.01'}
          value={record[field] ?? ''}
          onChange={(event) => patchRecord({ [field]: event.target.value })}
        />
      </label>
    );
  };

  const renderGroup = (key, title, fields) => (
    <section className="financial-editor-group" key={key}>
      <button type="button" className="financial-group-toggle" onClick={() => setOpenGroups((current) => ({ ...current, [key]: !current[key] }))}>
        <span>{title}</span>
        <strong>{openGroups[key] ? 'Recolher' : 'Expandir'}</strong>
      </button>
      {openGroups[key] && (
        <div className="financial-editor-grid">
          {fields.map((field) => renderField(field.length === 2 ? [...field, 'currency'] : field))}
        </div>
      )}
    </section>
  );

  if (!allowed) {
    return (
      <main className="app-page">
        <section className="restricted-panel">
          <p className="eyebrow">Acesso restrito</p>
          <h1>Lançamento financeiro</h1>
          <p>Seu perfil não possui autorização para analisar ou editar lançamentos financeiros.</p>
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
          <h1>Análise do lançamento #{id}</h1>
          <p>Visão analítica do registro, com edição controlada e recálculo automático pelo backend.</p>
        </div>
        <div className="heading-actions">
          {canOpenDashboard && <button className="outline-action" onClick={() => navigate('/home/financial-intelligence')}>Dashboard</button>}
          <button className="outline-action" onClick={() => navigate('/home/financial-intelligence/manage')}>Gestão financeira</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback">{feedback}</p>}
      {loading && <div className="financial-skeleton">Carregando lançamento financeiro...</div>}

      {record && (
        <>
          <section className="financial-sheet-summary">
            <article><span>Receita</span><strong>{formatCurrency(record.revenue)}</strong></article>
            <article><span>Custo total</span><strong>{formatCurrency(record.total_crc_cost)}</strong></article>
            <article><span>Lucro</span><strong>{formatCurrency(record.profit)}</strong></article>
            <article><span>ROI CRC</span><strong>{formatPercent(record.roi_crc)}</strong></article>
          </section>

          <section className="financial-record-layout">
            <article className="financial-record-analysis">
              <div className="financial-card-heading">
                <p className="eyebrow">Diagnóstico</p>
                <h2>{record.status || 'Sem status'}</h2>
                <p>{record.diagnosis || 'Sem diagnóstico operacional consolidado.'}</p>
              </div>
              <div className="financial-calculated-grid">
                <span>ROAS<strong>{Number(record.roas || 0).toFixed(2)}x</strong></span>
                <span>CAC<strong>{formatCurrency(record.cac)}</strong></span>
                <span>CPL<strong>{formatCurrency(record.cpl)}</strong></span>
                <span>Ticket médio<strong>{formatCurrency(record.average_ticket)}</strong></span>
                <span>Lead > Agendamento<strong>{formatPercent(record.lead_to_appointment)}</strong></span>
                <span>Comparecimento<strong>{formatPercent(record.attendance_rate)}</strong></span>
                <span>Fechamento<strong>{formatPercent(record.closing_rate)}</strong></span>
                <span>Margem líquida<strong>{formatPercent(record.net_margin)}</strong></span>
              </div>
            </article>

            <section className="financial-record-editor">
              {renderGroup('general', '1. Dados Gerais', generalFields)}
              {renderGroup('production', '2. Produção CRC', productionFields)}
              {renderGroup('marketing', '3. Custos de Marketing', marketingCostFields)}
              <label className="financial-notes-field">Observações<textarea className="field textarea" value={record.notes || ''} onChange={(event) => patchRecord({ notes: event.target.value })} /></label>
              <div className="financial-editor-footer">
                <button className="outline-action" onClick={loadRecord} disabled={saving}>Desfazer alterações</button>
                <button className="primary-action" onClick={saveRecord} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
              </div>
            </section>
          </section>
        </>
      )}
    </main>
  );
}

export default FinancialIntelligenceRecord;
