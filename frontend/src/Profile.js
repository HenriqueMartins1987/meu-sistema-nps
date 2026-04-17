import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import {
  brazilPhonePattern,
  brazilPhoneTitle,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  isCompleteBrazilPhone,
  readUser
} from './constants';

function Profile() {
  const navigate = useNavigate();
  const user = readUser() || {};
  const [form, setForm] = useState({
    name: user.name || user.email || '',
    email: user.email || '',
    phone: user.phone ? formatBrazilPhoneInput(user.phone) : defaultBrazilPhone,
    whatsapp: user.whatsapp ? formatBrazilPhoneInput(user.whatsapp) : defaultBrazilPhone
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  const [feedback, setFeedback] = useState('');

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updatePasswordForm = (field, value) => {
    setPasswordForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!isCompleteBrazilPhone(form.phone) || !isCompleteBrazilPhone(form.whatsapp)) {
      setFeedback('Informe telefone e WhatsApp completos no formato +55DDDNÚMERO.');
      return;
    }

    try {
      const res = await api.patch('/profile', form);
      const updatedUser = { ...user, ...(res.data?.user || form) };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setFeedback('Dados atualizados com sucesso.');
      return;
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível atualizar os dados.');
      return;
    }
  };

  const handlePasswordChange = async () => {
    setFeedback('');

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setFeedback('A confirmação da nova senha não confere.');
      return;
    }

    try {
      await api.post('/profile/change-password', {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password
      });
      const updatedUser = { ...user, mustChangePassword: false };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setFeedback('Senha alterada com sucesso.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Não foi possível alterar a senha.');
    }
  };

  return (
    <main className="app-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Minha conta</p>
          <h1>Dados pessoais e comunicação</h1>
          <p>Mantenha os dados de contato atualizados para auditoria e notificações operacionais.</p>
        </div>

        <button className="outline-action" onClick={() => navigate('/home')}>
          Voltar para Home
        </button>
      </header>

      <form className="form-shell" onSubmit={handleSave}>
        <section className="form-section">
          <h2>Identificação</h2>

          <div className="form-grid two">
            <label>
              Nome completo
              <input
                className="field"
                value={form.name}
                onChange={(event) => updateForm('name', event.target.value)}
                placeholder="Nome completo"
                required
              />
            </label>

            <label>
              E-mail
              <input
                className="field"
                type="email"
                value={form.email}
                onChange={(event) => updateForm('email', event.target.value)}
                placeholder="email@empresa.com.br"
                required
              />
            </label>
          </div>
        </section>

        <section className="form-section">
          <h2>Contato</h2>

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
          <h2>Alterar senha</h2>

          <div className="form-grid three">
            <label>
              Senha atual
              <input
                className="field"
                type="password"
                value={passwordForm.current_password}
                onChange={(event) => updatePasswordForm('current_password', event.target.value)}
                autoComplete="current-password"
              />
            </label>

            <label>
              Nova senha
              <input
                className="field"
                type="password"
                value={passwordForm.new_password}
                onChange={(event) => updatePasswordForm('new_password', event.target.value)}
                autoComplete="new-password"
              />
            </label>

            <label>
              Confirmar senha
              <input
                className="field"
                type="password"
                value={passwordForm.confirm_password}
                onChange={(event) => updatePasswordForm('confirm_password', event.target.value)}
                autoComplete="new-password"
              />
            </label>
          </div>

          <button type="button" className="secondary-action" onClick={handlePasswordChange}>
            Alterar senha
          </button>
        </section>

        {feedback && <p className="form-feedback">{feedback}</p>}

        <div className="form-actions">
          <button type="button" className="outline-action" onClick={() => navigate('/home')}>
            Cancelar
          </button>
          <button type="submit" className="primary-action">
            Salvar dados
          </button>
        </div>
      </form>
    </main>
  );
}

export default Profile;
