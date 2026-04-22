import React, { useEffect, useMemo, useState } from 'react';
import api from './api';
import logo from './assets/logo3.png';
import {
  brazilPhonePattern,
  brazilPhoneTitle,
  complaintTypes,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isCompleteBrazilPhone,
  labelFrom,
  priorityOptions,
  serviceTypes
} from './constants';

const maxUploadSizeBytes = 10 * 1024 * 1024;
const manifestationOptions = [
  { value: 'reclamacao', label: 'Reclamação' },
  { value: 'sugestao', label: 'Sugestão' },
  { value: 'elogio', label: 'Elogio' }
];
const channelOptions = [
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Instagram', label: 'Instagram' },
  { value: 'Facebook', label: 'Facebook' },
  { value: 'Google', label: 'Google' },
  { value: 'WhatsApp', label: 'WhatsApp' },
  { value: 'Email', label: 'Email' },
  { value: 'Telefone', label: 'Telefone' },
  { value: 'Site', label: 'Site' },
  { value: 'Outro', label: 'Outro' }
];
const complaintCategories = complaintTypes.filter((item) => (
  !['sugestao', 'elogio', 'pesquisa_satisfacao'].includes(item.value)
));
const manifestationLabels = manifestationOptions.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

const initialForm = {
  clinic_id: '',
  patient_name: '',
  patient_phone: defaultBrazilPhone,
  manifestation_kind: 'reclamacao',
  complaint_category: '',
  channel: 'Marketing',
  channel_other: '',
  service_type: '',
  priority: 'media',
  financial_involved: 'nao',
  financial_description: '',
  financial_amount: '',
  description: '',
  file: null
};

function MarketingIntake() {
  const [clinics, setClinics] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [savedProtocol, setSavedProtocol] = useState('');

  useEffect(() => {
    api.get('/clinics')
      .then((res) => setClinics(Array.isArray(res.data) ? res.data : []))
      .catch(() => setError('Não foi possível carregar as clínicas.'));
  }, []);

  const activeClinics = useMemo(() => (
    clinics
      .filter((clinic) => clinic?.name && String(clinic.active ?? 1) !== '0' && !clinic.name.includes('INATIVA'))
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [clinics]);

  const isComplaint = form.manifestation_kind === 'reclamacao';
  const isFinancialComplaint = isComplaint && (form.financial_involved === 'sim' || form.complaint_category === 'financeiro');

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleTypeChange = (value) => {
    setForm((prev) => ({
      ...prev,
      manifestation_kind: value,
      complaint_category: value === 'reclamacao' ? prev.complaint_category : '',
      financial_involved: value === 'reclamacao' ? prev.financial_involved : 'nao',
      financial_description: value === 'reclamacao' ? prev.financial_description : '',
      financial_amount: value === 'reclamacao' ? prev.financial_amount : '',
      priority: value === 'reclamacao' ? prev.priority : 'baixa'
    }));
  };

  const handleCategoryChange = (value) => {
    setForm((prev) => ({
      ...prev,
      complaint_category: value,
      financial_involved: value === 'financeiro' ? 'sim' : prev.financial_involved,
      priority: value === 'financeiro' ? 'alta' : prev.priority
    }));
  };

  const handleFinancialChange = (value) => {
    setForm((prev) => ({
      ...prev,
      financial_involved: value,
      financial_description: value === 'sim' ? prev.financial_description : '',
      financial_amount: value === 'sim' ? prev.financial_amount : '',
      priority: value === 'sim' ? 'alta' : prev.priority
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setLoading(true);
    setFeedback('');
    setError('');
    setSavedProtocol('');

    try {
      if (form.file && form.file.size > maxUploadSizeBytes) {
        setError('O anexo deve ter no máximo 10 MB.');
        setLoading(false);
        return;
      }

      if (!isCompleteBrazilPhone(form.patient_phone)) {
        setError('Informe o telefone completo no formato +55DDDNÚMERO.');
        setLoading(false);
        return;
      }

      if (isFinancialComplaint && (!form.financial_description.trim() || Number(form.financial_amount || 0) <= 0)) {
        setError('Informe a descrição e o valor envolvido no protocolo financeiro.');
        setLoading(false);
        return;
      }

      if (form.channel === 'Outro' && !form.channel_other.trim()) {
        setError('Informe o canal de origem.');
        setLoading(false);
        return;
      }

      const formData = new FormData();
      const complaintType = isComplaint
        ? labelFrom(complaintCategories, form.complaint_category)
        : manifestationLabels[form.manifestation_kind];
      const description = form.description.trim();

      Object.entries({
        clinic_id: form.clinic_id,
        patient_name: form.patient_name,
        patient_phone: form.patient_phone,
        channel: form.channel === 'Outro' ? form.channel_other.trim() : form.channel,
        complaint_type: complaintType,
        priority: isComplaint ? (isFinancialComplaint ? 'alta' : form.priority) : 'baixa',
        service_type: form.service_type ? labelFrom(serviceTypes, form.service_type) : '',
        description,
        created_origin: 'Marketing',
        financial_involved: isFinancialComplaint ? 'sim' : 'nao',
        financial_description: isFinancialComplaint ? form.financial_description : '',
        financial_amount: isFinancialComplaint ? form.financial_amount : ''
      }).forEach(([key, value]) => {
        if (value) formData.append(key, value);
      });

      if (form.file) {
        formData.append('file', form.file);
      }

      const res = await api.post('/complaints', formData);
      const protocol = res.data?.protocol || '';
      setSavedProtocol(protocol);
      setFeedback(`Protocolo ${protocol} registrado com sucesso.`);
      setForm(initialForm);
      formElement.reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Não foi possível registrar o protocolo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="public-page marketing-public-page">
      <section className="public-shell">
        <header className="public-hero public-hero-centered">
          <div className="public-hero-copy">
            <img src={logo} alt="GRC Consultoria Empresarial" className="public-hero-logo" />
            <p className="eyebrow">Link externo</p>
            <h1>Registre Manifestação</h1>
            <p>
              Registre reclamações, sugestões e elogios recebidos por campanhas,
              mídia, redes sociais e canais de relacionamento.
            </p>
          </div>
        </header>

        <form className="public-form-shell" onSubmit={handleSubmit}>
          <section className="public-form-band">
            <div className="public-form-title">
              <p className="eyebrow">Classificação</p>
              <h2>Tipo de manifestação</h2>
            </div>

            <div className="segmented-choice" role="radiogroup" aria-label="Tipo de manifestação">
              {manifestationOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`segment-button ${form.manifestation_kind === option.value ? 'active' : ''}`}
                  onClick={() => handleTypeChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="public-form-band">
            <div className="public-form-title">
              <p className="eyebrow">Origem</p>
              <h2>Dados do registro</h2>
            </div>

            <div className="form-grid two">
              <label>
                Clínica
                <select
                  className="field"
                  value={form.clinic_id}
                  onChange={(event) => updateForm('clinic_id', event.target.value)}
                  required
                >
                  <option value="">Selecione a clínica</option>
                  {activeClinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name} ({clinic.city}/{clinic.state})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Canal de origem
                <select
                  className="field"
                  value={form.channel}
                  onChange={(event) => updateForm('channel', event.target.value)}
                  required
                >
                  {channelOptions.map((channel) => (
                    <option key={channel.value} value={channel.value}>{channel.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {form.channel === 'Outro' && (
              <label>
                Descreva o canal de origem
                <input
                  className="field"
                  value={form.channel_other}
                  onChange={(event) => updateForm('channel_other', event.target.value.slice(0, 120))}
                  placeholder="Informe o canal de origem"
                  maxLength={120}
                  required
                />
              </label>
            )}

            <div className="form-grid two">
              <label>
                Nome do paciente
                <input
                  className="field"
                  value={form.patient_name}
                  onChange={(event) => updateForm('patient_name', event.target.value)}
                  placeholder="Nome completo"
                  required
                />
              </label>

              <label>
                Telefone / WhatsApp
                <input
                  className="field"
                  value={form.patient_phone}
                  onChange={(event) => updateForm('patient_phone', formatBrazilPhoneInput(event.target.value))}
                  placeholder="+55DDDNÚMERO"
                  pattern={brazilPhonePattern}
                  title={brazilPhoneTitle}
                  maxLength={14}
                  required
                />
              </label>
            </div>

            {isComplaint && (
              <div className="form-grid two">
                <label>
                  Classificação da reclamação
                  <select
                    className="field"
                    value={form.complaint_category}
                    onChange={(event) => handleCategoryChange(event.target.value)}
                    required
                  >
                    <option value="">Selecione a classificação</option>
                    {complaintCategories.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Serviço envolvido
                  <select
                    className="field"
                    value={form.service_type}
                    onChange={(event) => updateForm('service_type', event.target.value)}
                  >
                    <option value="">Selecione o serviço</option>
                    {serviceTypes.map((service) => (
                      <option key={service.value} value={service.value}>{service.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {!isComplaint && (
              <label>
                Serviço envolvido
                <select
                  className="field"
                  value={form.service_type}
                  onChange={(event) => updateForm('service_type', event.target.value)}
                >
                  <option value="">Selecione o serviço, se houver</option>
                  {serviceTypes.map((service) => (
                    <option key={service.value} value={service.value}>{service.label}</option>
                  ))}
                </select>
              </label>
            )}
          </section>

          {isComplaint && (
            <section className="public-form-band">
              <div className="public-form-title">
                <p className="eyebrow">Financeiro</p>
                <h2>Valores envolvidos</h2>
              </div>

              <div className="form-grid two">
                <label>
                  Envolve valor financeiro?
                  <select
                    className="field"
                    value={form.financial_involved}
                    onChange={(event) => handleFinancialChange(event.target.value)}
                    required
                  >
                    <option value="nao">Não</option>
                    <option value="sim">Sim</option>
                  </select>
                </label>

                <label>
                  Valor envolvido
                  <input
                    className="field"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.financial_amount}
                    onChange={(event) => updateForm('financial_amount', event.target.value)}
                    placeholder="0,00"
                    disabled={!isFinancialComplaint}
                    required={isFinancialComplaint}
                  />
                </label>
              </div>

              {isFinancialComplaint && (
                <label>
                  Descrição do impacto financeiro
                  <textarea
                    className="field textarea small"
                    value={form.financial_description}
                    onChange={(event) => updateForm('financial_description', event.target.value.slice(0, 1000))}
                    placeholder="Descreva cobrança, reembolso, contrato, orçamento ou outro valor envolvido."
                    maxLength={1000}
                    required
                  />
                </label>
              )}
            </section>
          )}

          {isComplaint && (
            <section className="public-form-band">
              <div className="public-form-title">
                <p className="eyebrow">Criticidade</p>
                <h2>Prioridade da tratativa</h2>
                {isFinancialComplaint && <p className="permission-note">Protocolos com valor financeiro ficam travados como prioridade alta.</p>}
              </div>

              <div className="priority-options" role="radiogroup" aria-label="Prioridade do protocolo">
                {priorityOptions.map((option) => (
                  <label className={`priority-option ${(isFinancialComplaint ? 'alta' : form.priority) === option.value ? 'selected' : ''}`} key={option.value}>
                    <input
                      type="radio"
                      name="priority"
                      value={option.value}
                      checked={(isFinancialComplaint ? 'alta' : form.priority) === option.value}
                      onChange={(event) => updateForm('priority', event.target.value)}
                      disabled={isFinancialComplaint}
                    />
                    <span>{option.label}</span>
                    <strong>{option.deadline}</strong>
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="public-form-band">
            <div className="public-form-title">
              <p className="eyebrow">Relato</p>
              <h2>Descrição do Relato</h2>
            </div>

            <label>
              Conte o contexto
              <textarea
                className="field textarea public-textarea"
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value.slice(0, 5000))}
                placeholder="Descreva o ocorrido com objetividade, apontando data, contexto e evidências recebidas."
                maxLength={5000}
                required
              />
              <small className="field-counter">{form.description.length}/5000 caracteres</small>
            </label>

            <label>
              Anexo opcional (máximo 10 MB)
              <input
                className="field"
                type="file"
                onChange={(event) => updateForm('file', event.target.files[0] || null)}
              />
            </label>
          </section>

          {error && <p className="form-error">{error}</p>}
          {feedback && <p className="form-feedback">{feedback}</p>}

          <div className="form-actions">
            <button className="primary-action" type="submit" disabled={loading}>
              {loading ? 'Registrando...' : 'Gerar protocolo'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default MarketingIntake;
