import React, { useEffect, useMemo, useState } from 'react';
import api from './api';
import logo from './assets/logo2.png';
import {
  brazilPhonePattern,
  brazilPhoneTitle,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isCompleteBrazilPhone
} from './constants';

const detractorReasonOptions = [
  'Tempo de espera ou agendamento',
  'Atendimento e acolhimento',
  'Comunicação sobre tratamento',
  'Orçamento ou cobrança',
  'Resultado do tratamento',
  'Estrutura, conforto ou higiene',
  'Outro'
];

const initialForm = {
  clinic_id: '',
  patient_name: '',
  patient_phone: defaultBrazilPhone,
  score: null,
  recommend_yes: '',
  contact_share_allowed: '',
  referral_name: '',
  referral_phone: defaultBrazilPhone,
  improvement_comment: '',
  detractor_reasons: [],
  detractor_other: '',
  detractor_feedback: ''
};

function NpsSurveyPage() {
  const [clinics, setClinics] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/public/clinics')
      .then((res) => setClinics(Array.isArray(res.data) ? res.data : []))
      .catch(() => setError('Não foi possível carregar as clínicas.'));
  }, []);

  const activeClinics = useMemo(() => (
    clinics
      .filter((clinic) => clinic?.name && String(clinic.active ?? 1) !== '0' && !clinic.name.includes('INATIVA'))
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [clinics]);

  const profile = useMemo(() => {
    if (form.score === null || form.score === '') return '';
    if (Number(form.score) >= 9) return 'promotor';
    if (Number(form.score) >= 7) return 'neutro';
    return 'detrator';
  }, [form.score]);

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleReason = (reason) => {
    setForm((prev) => ({
      ...prev,
      detractor_reasons: prev.detractor_reasons.includes(reason)
        ? prev.detractor_reasons.filter((item) => item !== reason)
        : [...prev.detractor_reasons, reason]
    }));
  };

  const handleScoreSelect = (score) => {
    setForm((prev) => ({
      ...prev,
      score,
      recommend_yes: score >= 9 ? prev.recommend_yes : '',
      contact_share_allowed: score >= 9 ? prev.contact_share_allowed : '',
      referral_name: score >= 9 ? prev.referral_name : '',
      referral_phone: score >= 9 ? prev.referral_phone || defaultBrazilPhone : defaultBrazilPhone,
      improvement_comment: score >= 7 && score <= 8 ? prev.improvement_comment : '',
      detractor_reasons: score <= 6 ? prev.detractor_reasons : [],
      detractor_other: score <= 6 ? prev.detractor_other : '',
      detractor_feedback: score <= 6 ? prev.detractor_feedback : ''
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setFeedback('');
    setError('');

    try {
      if (form.score === null) {
        setError('Selecione a nota NPS antes de enviar.');
        setLoading(false);
        return;
      }

      if (profile === 'promotor' && form.recommend_yes === 'sim' && (!form.referral_name || !form.referral_phone)) {
        setError('Informe nome e telefone para a indicação.');
        setLoading(false);
        return;
      }

      if (!isCompleteBrazilPhone(form.patient_phone)) {
        setError('Informe o telefone completo no formato +55DDDNÚMERO.');
        setLoading(false);
        return;
      }

      if (profile === 'promotor' && form.recommend_yes === 'sim' && !isCompleteBrazilPhone(form.referral_phone)) {
        setError('Informe o telefone da indicação no formato +55DDDNÚMERO.');
        setLoading(false);
        return;
      }

      if (profile === 'detrator' && !form.detractor_feedback.trim()) {
        setError('Descreva a reclamação final para concluirmos a pesquisa.');
        setLoading(false);
        return;
      }

      const detractorReasons = form.detractor_reasons.includes('Outro') && form.detractor_other.trim()
        ? [...form.detractor_reasons.filter((item) => item !== 'Outro'), `Outro: ${form.detractor_other.trim()}`]
        : form.detractor_reasons;
      const feedbackType = profile === 'promotor' ? 'elogio' : profile === 'neutro' ? 'sugestao' : 'reclamacao';

      const res = await api.post('/nps/public', {
        clinic_id: form.clinic_id,
        patient_name: form.patient_name,
        patient_phone: form.patient_phone,
        score: Number(form.score),
        feedback_type: feedbackType,
        recommend_yes: form.recommend_yes === 'sim',
        contact_share_allowed: form.contact_share_allowed === 'sim',
        referral_name: form.referral_name,
        referral_phone: form.referral_phone,
        improvement_comment: form.improvement_comment,
        detractor_reasons: detractorReasons,
        detractor_feedback: form.detractor_feedback,
        comment: ''
      });

      const linkedAgendaMessage = res.data?.linkedPatientProtocol
        ? ` Seu contato foi compartilhado com a agenda sob o protocolo ${res.data.linkedPatientProtocol}.`
        : '';

      setFeedback(`Obrigado. Sua pesquisa foi registrada com sucesso. Protocolo: ${res.data?.protocol || 'em processamento'}.${linkedAgendaMessage}`);
      setForm(initialForm);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Não foi possível enviar a pesquisa NPS.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="public-page nps-public-page">
      <section className="public-shell">
        <header className="public-hero public-hero-centered nps-hero">
          <div className="public-hero-copy">
            <img src={logo} alt="GRC Consultoria Empresarial" className="public-hero-logo" />
            <p className="eyebrow">Pesquisa de Satisfação</p>
            <h1>Como foi a sua experiência com o Grupo Sorria?</h1>
            <p>
              Sua resposta nos ajuda a corrigir falhas, reconhecer equipes e identificar
              oportunidades reais de melhoria em cada unidade.
            </p>
          </div>
        </header>

        <form className="public-form-shell" onSubmit={handleSubmit}>
          <section className="public-form-band">
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
                Nome do paciente
                <input
                  className="field"
                  value={form.patient_name}
                  onChange={(event) => updateForm('patient_name', event.target.value)}
                  placeholder="Nome completo"
                  required
                />
              </label>
            </div>

            <label>
              Telefone / WhatsApp
              <input
                className="field"
                value={form.patient_phone}
                onChange={(event) => updateForm('patient_phone', formatBrazilPhoneInput(event.target.value))}
                placeholder="+55DDDNÚMERO"
                pattern={brazilPhonePattern}
                title={brazilPhoneTitle}
                minLength={14}
                maxLength={14}
                required
              />
            </label>
          </section>

          <section className="public-form-band">
            <div className="public-form-title">
              <p className="eyebrow">Pergunta principal</p>
              <h2>De 1 a 10, o quanto você indicaria nossa clínica para um amigo ou familiar?</h2>
            </div>

            <div className="score-grid" role="radiogroup" aria-label="Nota NPS">
              {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                <button
                  key={score}
                  type="button"
                  className={`score-button ${form.score === score ? 'active' : ''} ${score >= 9 ? 'promoter' : score >= 7 ? 'neutral' : 'detractor'}`}
                  onClick={() => handleScoreSelect(score)}
                >
                  {score}
                </button>
              ))}
            </div>
          </section>

          {profile === 'promotor' && (
            <section className="public-form-band survey-flow-card promoter-card">
              <div className="public-form-title">
                <p className="eyebrow">Promotor</p>
                <h2>Você teria alguém para indicar para uma avaliação?</h2>
              </div>

              <div className="segmented-choice">
                {['sim', 'nao'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`segment-button ${form.recommend_yes === option ? 'active' : ''}`}
                    onClick={() => updateForm('recommend_yes', option)}
                  >
                    {option === 'sim' ? 'Sim' : 'Não'}
                  </button>
                ))}
              </div>

              {form.recommend_yes === 'sim' && (
                <div className="form-grid two">
                  <label>
                    Nome para indicação
                    <input
                      className="field"
                      value={form.referral_name}
                      onChange={(event) => updateForm('referral_name', event.target.value)}
                      placeholder="Nome do familiar ou amigo"
                      required
                    />
                  </label>

                  <label>
                    Telefone / WhatsApp
                    <input
                      className="field"
                      value={form.referral_phone}
                      onChange={(event) => updateForm('referral_phone', formatBrazilPhoneInput(event.target.value))}
                      placeholder="+55DDDNÚMERO"
                      pattern={brazilPhonePattern}
                      title={brazilPhoneTitle}
                      minLength={14}
                      maxLength={14}
                      required
                    />
                  </label>
                </div>
              )}

              <div className="public-form-title">
                <p className="eyebrow">Contato</p>
                <h2>Autoriza compartilhar seu contato com nossa agenda?</h2>
              </div>

              <div className="segmented-choice">
                {['sim', 'nao'].map((option) => (
                  <button
                    key={`share-${option}`}
                    type="button"
                    className={`segment-button ${form.contact_share_allowed === option ? 'active' : ''}`}
                    onClick={() => updateForm('contact_share_allowed', option)}
                  >
                    {option === 'sim' ? 'Sim' : 'Não'}
                  </button>
                ))}
              </div>
            </section>
          )}

          {profile === 'neutro' && (
            <section className="public-form-band survey-flow-card neutral-card">
              <div className="public-form-title">
                <p className="eyebrow">Neutro</p>
                <h2>O que faltou para sua experiência ser excelente?</h2>
              </div>

              <label>
                Comentário de melhoria
                <textarea
                  className="field textarea public-textarea"
                  value={form.improvement_comment}
                  onChange={(event) => updateForm('improvement_comment', event.target.value.slice(0, 2000))}
                  placeholder="Conte o principal ponto que precisa melhorar."
                  maxLength={2000}
                />
                <small className="field-counter">{form.improvement_comment.length}/2000 caracteres</small>
              </label>
            </section>
          )}

          {profile === 'detrator' && (
            <section className="public-form-band survey-flow-card detractor-card">
              <div className="public-form-title">
                <p className="eyebrow">Detrator</p>
                <h2>O que mais impactou negativamente sua experiência?</h2>
              </div>

              <div className="checkbox-grid">
                {detractorReasonOptions.map((reason) => (
                  <label className="checkbox-chip" key={reason}>
                    <input
                      type="checkbox"
                      checked={form.detractor_reasons.includes(reason)}
                      onChange={() => toggleReason(reason)}
                    />
                    <span>{reason}</span>
                  </label>
                ))}
              </div>

              {form.detractor_reasons.includes('Outro') && (
                <label>
                  Outro motivo
                  <input
                    className="field"
                    value={form.detractor_other}
                    onChange={(event) => updateForm('detractor_other', event.target.value.slice(0, 240))}
                    placeholder="Descreva o outro motivo"
                    maxLength={240}
                  />
                </label>
              )}

              <label>
                Reclamação detalhada
                <textarea
                  className="field textarea public-textarea"
                  value={form.detractor_feedback}
                  onChange={(event) => updateForm('detractor_feedback', event.target.value.slice(0, 5000))}
                  placeholder="Descreva sua reclamação com o máximo de objetividade."
                  maxLength={5000}
                  required
                />
                <small className="field-counter">{form.detractor_feedback.length}/5000 caracteres</small>
              </label>
            </section>
          )}

          {error && <p className="form-error">{error}</p>}
          {feedback && <p className="form-feedback">{feedback}</p>}

          <div className="form-actions">
            <button className="primary-action" type="submit" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar pesquisa'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default NpsSurveyPage;
