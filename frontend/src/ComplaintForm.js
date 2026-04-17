import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from './api';
import {
  brazilPhonePattern,
  brazilPhoneTitle,
  channels,
  complaintTypes,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isCompleteBrazilPhone,
  labelFrom,
  priorityOptions,
  serviceTypes
} from './constants';

const initialForm = {
  clinic_id: '',
  city: '',
  state: '',
  region: '',
  patient_name: '',
  patient_phone: defaultBrazilPhone,
  channel: '',
  channel_other: '',
  complaint_type: '',
  complaint_type_other: '',
  priority: 'media',
  service_type: '',
  financial_involved: 'nao',
  financial_description: '',
  financial_amount: '',
  description: '',
  file: null
};

const maxUploadSizeBytes = 10 * 1024 * 1024;
const simpleManifestationTypes = ['sugestao', 'elogio'];

function ComplaintForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [clinics, setClinics] = useState([]);
  const [form, setForm] = useState(() => ({
    ...initialForm,
    complaint_type: complaintTypes.some((type) => type.value === searchParams.get('tipo')) ? searchParams.get('tipo') : '',
    channel: channels.some((channel) => channel.value === searchParams.get('canal')) ? searchParams.get('canal') : ''
  }));
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [savedProtocol, setSavedProtocol] = useState('');

  useEffect(() => {
    api.get('/clinics')
      .then((res) => setClinics(Array.isArray(res.data) ? res.data : []))
      .catch(() => setFeedback('Não foi possível carregar as clínicas.'));
  }, []);

  useEffect(() => {
    const type = searchParams.get('tipo');
    const channel = searchParams.get('canal');
    const validType = complaintTypes.some((item) => item.value === type) ? type : '';
    const validChannel = channels.some((item) => item.value === channel) ? channel : '';

    if (validType || validChannel) {
      setForm((prev) => ({
        ...prev,
        complaint_type: validType || prev.complaint_type,
        channel: validChannel || prev.channel
      }));
    }
  }, [searchParams]);

  const activeClinics = useMemo(() => (
    clinics
      .filter((clinic) => clinic?.name && String(clinic.active ?? 1) !== '0' && !clinic.name.includes('INATIVA'))
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [clinics]);
  const isSimpleManifestation = simpleManifestationTypes.includes(form.complaint_type);
  const isFinancialComplaint = form.financial_involved === 'sim' || form.complaint_type === 'financeiro';
  const submitLabel = 'Salvar Protocolo';
  const pageTitle = form.complaint_type === 'sugestao'
    ? 'Nova Sugestão'
    : form.complaint_type === 'elogio'
      ? 'Novo Elogio'
      : 'Novo Protocolo';

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleComplaintTypeChange = (event) => {
    const value = event.target.value;

    setForm((prev) => ({
      ...prev,
      complaint_type: value,
      complaint_type_other: value === 'outros' ? prev.complaint_type_other : '',
      financial_involved: value === 'financeiro' ? 'sim' : prev.financial_involved,
      priority: value === 'financeiro' ? 'alta' : prev.priority
    }));
  };

  const handleFinancialChange = (event) => {
    const value = event.target.value;

    setForm((prev) => ({
      ...prev,
      financial_involved: value,
      financial_description: value === 'sim' ? prev.financial_description : '',
      financial_amount: value === 'sim' ? prev.financial_amount : '',
      priority: value === 'sim' ? 'alta' : prev.priority
    }));
  };

  const handleChannelChange = (event) => {
    const value = event.target.value;

    setForm((prev) => ({
      ...prev,
      channel: value,
      channel_other: value === 'outros' ? prev.channel_other : ''
    }));
  };

  const handleClinicChange = (event) => {
    const clinic = clinics.find((item) => String(item.id) === event.target.value);

    setForm((prev) => ({
      ...prev,
      clinic_id: clinic?.id || '',
      city: clinic?.city || '',
      state: clinic?.state || '',
      region: clinic?.region || ''
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setLoading(true);
    setFeedback('');
    setSavedProtocol('');

    try {
      const formData = new FormData();
      const complaintType = form.complaint_type === 'outros'
        ? form.complaint_type_other || 'Outros'
        : labelFrom(complaintTypes, form.complaint_type);
      const channel = form.channel === 'outros'
        ? form.channel_other || 'Outros'
        : labelFrom(channels, form.channel);
      const serviceType = form.service_type ? labelFrom(serviceTypes, form.service_type) : '';
      const protocolLabel = 'Protocolo';

      if (form.file && form.file.size > maxUploadSizeBytes) {
        setFeedback('O anexo deve ter no máximo 10 MB.');
        setLoading(false);
        return;
      }

      if (!isCompleteBrazilPhone(form.patient_phone)) {
        setFeedback('Informe o telefone completo no formato +55DDDNÚMERO.');
        setLoading(false);
        return;
      }

      Object.entries({
        clinic_id: form.clinic_id,
        patient_name: form.patient_name,
        patient_phone: form.patient_phone,
        channel,
        complaint_type: complaintType,
        priority: isSimpleManifestation ? 'baixa' : isFinancialComplaint ? 'alta' : form.priority,
        service_type: serviceType,
        description: form.description,
        created_origin: 'Interno',
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
      setFeedback(
        `${protocolLabel} ${protocol} cadastrado com sucesso. `
        + `A tela foi limpa para um novo ${isSimpleManifestation ? 'protocolo' : 'registro'}.`
      );
      setForm(initialForm);
      formElement.reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      const backendError = error.response?.data?.error;
      const simpleError = backendError
        ?.replaceAll('Reclamação', 'Protocolo')
        ?.replaceAll('reclamação', 'protocolo')
        ?.replaceAll('Reclamacao', 'Protocolo')
        ?.replaceAll('reclamacao', 'protocolo');

      setFeedback(
        (isSimpleManifestation ? simpleError : backendError)
        || 'Erro ao salvar o protocolo.'
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h1>{pageTitle}</h1>
        </div>

        <button className="outline-action" onClick={() => navigate('/home')}>
          Voltar para Home
        </button>
      </header>

      {savedProtocol && (
        <section className="protocol-success-card" aria-live="polite">
          <span>Protocolo cadastrado com sucesso</span>
          <strong>{savedProtocol}</strong>
          <p>A tela foi limpa e já está pronta para um novo cadastro.</p>
        </section>
      )}

      {feedback && <p className="form-feedback page-form-feedback">{feedback}</p>}

      <form className="form-shell" onSubmit={handleSubmit}>
        <section className="form-section">
          <h2>Origem do registro</h2>

          <label>
            Clínica
            <select className="field" value={form.clinic_id} onChange={handleClinicChange} required>
              <option value="">Selecione a clínica</option>
              {activeClinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name} ({clinic.city}/{clinic.state})
                </option>
              ))}
            </select>
          </label>

          <div className="form-grid three">
            <label>
              Cidade
              <input className="field" value={form.city} placeholder="Cidade" disabled />
            </label>
            <label>
              Estado
              <input className="field" value={form.state} placeholder="Estado" disabled />
            </label>
            <label>
              Região
              <input className="field" value={form.region} placeholder="Região" disabled />
            </label>
          </div>
        </section>

        <section className="form-section">
          <h2>Dados do paciente</h2>

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
              Telefone
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
        </section>

        <section className="form-section">
          <h2>Classificação</h2>

          <div className="form-grid two">
            <label>
              Canal de entrada
              <select
                className="field"
                value={form.channel}
                onChange={handleChannelChange}
                required
              >
                <option value="">Selecione o canal</option>
                {channels.map((channel) => (
                  <option key={channel.value} value={channel.value}>{channel.label}</option>
                ))}
              </select>
            </label>

            <label>
              Tipo de registro
              <select
                className="field"
                value={form.complaint_type}
                onChange={handleComplaintTypeChange}
                required
              >
                <option value="">Selecione o tipo</option>
                {complaintTypes.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </label>
          </div>

          {form.channel === 'outros' && (
            <label>
              Descreva o outro canal
              <input
                className="field"
                value={form.channel_other}
                onChange={(event) => updateForm('channel_other', event.target.value.slice(0, 200))}
                placeholder="Informe o canal de entrada"
                maxLength={200}
                required
              />
              <small className="field-counter">
                {form.channel_other.length}/200 caracteres
              </small>
            </label>
          )}

          {form.complaint_type === 'outros' && (
            <label>
              Descreva o outro tipo
              <input
                className="field"
                value={form.complaint_type_other}
                onChange={(event) => updateForm('complaint_type_other', event.target.value.slice(0, 200))}
                placeholder="Informe o tipo do registro"
                maxLength={200}
                required
              />
              <small className="field-counter">
                {form.complaint_type_other.length}/200 caracteres
              </small>
            </label>
          )}

          {!isSimpleManifestation && (
            <div className="financial-box">
              <div className="form-grid two">
                <label>
                  Envolve valor financeiro?
                  <select
                    className="field"
                    value={form.financial_involved}
                    onChange={handleFinancialChange}
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
            </div>
          )}

          {!isSimpleManifestation && (
          <div className="priority-selector">
            <div>
              <p className="eyebrow">Nível de criticidade</p>
              <h3>Prioridade</h3>
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
          </div>
          )}

          <label>
            Serviço envolvido{isSimpleManifestation ? ' (opcional)' : ''}
            <select
              className="field"
              value={form.service_type}
              onChange={(event) => updateForm('service_type', event.target.value)}
              required={!isSimpleManifestation}
            >
              <option value="">{isSimpleManifestation ? 'Selecione o serviço, se houver' : 'Selecione o serviço'}</option>
              {serviceTypes.map((service) => (
                <option key={service.value} value={service.value}>{service.label}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="form-section">
          <h2>Relato e evidências</h2>

          <label>
            Descrição do registro
            <textarea
              className="field textarea"
              value={form.description}
              onChange={(event) => updateForm('description', event.target.value)}
              placeholder="Descreva o ocorrido, a sugestão, o elogio ou os pontos de atenção."
              required
            />
          </label>

          <label>
            Anexo inicial (máximo 10 MB)
            <input
              className="field"
              type="file"
              onChange={(event) => updateForm('file', event.target.files[0] || null)}
            />
          </label>
        </section>

        <div className="form-actions">
          <button type="button" className="outline-action" onClick={() => navigate('/home')}>
            Cancelar
          </button>
          <button type="submit" className="primary-action" disabled={loading}>
            {loading ? 'Salvando...' : submitLabel}
          </button>
        </div>
      </form>
    </main>
  );
}

export default ComplaintForm;
