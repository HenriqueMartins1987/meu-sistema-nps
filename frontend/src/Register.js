import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import logo from './assets/logo.png';
import {
  accessProfiles,
  brazilPhonePattern,
  brazilPhoneTitle,
  collaboratorPositions,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isCompleteBrazilPhone,
  labelFrom
} from './constants';

const initialForm = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: '',
  position: '',
  positionOther: '',
  phone: defaultBrazilPhone,
  whatsapp: defaultBrazilPhone,
  department: ''
};

function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setFeedback('');

    if (form.password !== form.confirmPassword) {
      setError('As senhas informadas não conferem.');
      return;
    }

    if (!isStrongPassword(form.password)) {
      setError('A senha deve ter no mínimo 8 caracteres, letra maiúscula, letra minúscula, número e caractere especial.');
      return;
    }

    if (!isCompleteBrazilPhone(form.phone) || !isCompleteBrazilPhone(form.whatsapp)) {
      setError('Informe telefone e WhatsApp completos no formato +55DDDNÚMERO.');
      return;
    }

    setLoading(true);

    try {
      await api.post('/registration-requests', {
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        position: form.position === 'outros' ? form.positionOther : labelFrom(collaboratorPositions, form.position),
        phone: form.phone,
        whatsapp: form.whatsapp || form.phone,
        department: form.department
      });

      setFeedback('Cadastro enviado para aprovação. Você receberá liberação após análise administrativa.');
      setForm(initialForm);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível enviar o cadastro.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="register-page">
      <section className="register-shell">
        <header className="register-heading">
          <img src={logo} alt="GRC Consultoria Empresarial" />
          <div>
            <p className="eyebrow">Primeiro cadastro</p>
            <h1>Solicitação de acesso ao Sistema GRC.</h1>
            <p>
              Preencha seus dados profissionais para análise administrativa. Após a aprovação,
              seu acesso será liberado com perfil, cargo e contato vinculados ao histórico auditável.
            </p>
            <div className="register-highlights">
              <span>Cadastro auditável</span>
              <span>Aprovação administrativa</span>
              <span>Contato com WhatsApp</span>
            </div>
          </div>
        </header>

        <form className="register-form" onSubmit={handleSubmit}>
          <section className="form-section">
            <h2>Dados pessoais</h2>

            <div className="form-grid two">
              <label>
                Nome completo
                <input
                  className="field"
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  placeholder="Nome e sobrenome"
                  required
                />
              </label>

              <label>
                E-mail corporativo
                <input
                  className="field"
                  type="email"
                  value={form.email}
                  onChange={(event) => updateForm('email', event.target.value)}
                  placeholder="nome@empresa.com.br"
                  required
                />
              </label>
            </div>

            <div className="form-grid two">
              <label>
                Telefone
                <input
                  className="field"
                  value={form.phone}
                  onChange={(event) => updateForm('phone', formatBrazilPhoneInput(event.target.value))}
                  placeholder="+55DDDNÚMERO"
                  pattern={brazilPhonePattern}
                  title={brazilPhoneTitle}
                  maxLength={14}
                  required
                />
              </label>

              <label>
                WhatsApp
                <input
                  className="field"
                  value={form.whatsapp}
                  onChange={(event) => updateForm('whatsapp', formatBrazilPhoneInput(event.target.value))}
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
            <h2>Dados profissionais</h2>

            <div className="form-grid two">
              <label>
                Cargo
                <select
                  className="field"
                  value={form.position}
                  onChange={(event) => updateForm('position', event.target.value)}
                  required
                >
                  <option value="">Selecione o cargo</option>
                  {collaboratorPositions.map((position) => (
                    <option key={position.value} value={position.value}>{position.label}</option>
                  ))}
                </select>
              </label>

              <label>
                Perfil de acesso solicitado
                <select
                  className="field"
                  value={form.role}
                  onChange={(event) => updateForm('role', event.target.value)}
                  required
                >
                  <option value="">Selecione o perfil</option>
                  {accessProfiles.map((profile) => (
                    <option key={profile.value} value={profile.value}>{profile.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {form.position === 'outros' && (
              <label>
                Informe o cargo
                <input
                  className="field"
                  value={form.positionOther}
                  onChange={(event) => updateForm('positionOther', event.target.value.slice(0, 120))}
                  placeholder="Cargo do colaborador"
                  maxLength={120}
                  required
                />
              </label>
            )}

            <label>
              Área ou unidade
              <input
                className="field"
                value={form.department}
                onChange={(event) => updateForm('department', event.target.value)}
                placeholder="Ex.: SAC, CRC, Unidade Centro, Regional GO"
              />
            </label>
          </section>

          <section className="form-section">
            <h2>Senha de acesso</h2>

            <div className="form-grid two">
              <label>
                Senha
                <input
                  className="field"
                  type="password"
                  value={form.password}
                  onChange={(event) => updateForm('password', event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}"
                  title="Use no mínimo 8 caracteres, com letra maiúscula, letra minúscula, número e caractere especial."
                  required
                />
              </label>

              <label>
                Confirmar senha
                <input
                  className="field"
                  type="password"
                  value={form.confirmPassword}
                  onChange={(event) => updateForm('confirmPassword', event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}"
                  title="Use no mínimo 8 caracteres, com letra maiúscula, letra minúscula, número e caractere especial."
                  required
                />
              </label>
            </div>
            <p className="history-note">Use uma senha forte com letras maiúsculas e minúsculas, número e caractere especial.</p>
          </section>

          {error && <p className="form-error">{error}</p>}
          {feedback && <p className="form-feedback">{feedback}</p>}

          <div className="form-actions">
            <button type="button" className="outline-action" onClick={() => navigate('/')}>
              Voltar para login
            </button>
            <button type="submit" className="primary-action" disabled={loading}>
              {loading ? 'Enviando...' : 'Solicitar aprovação'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default Register;
