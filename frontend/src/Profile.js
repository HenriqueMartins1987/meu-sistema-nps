import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  brazilPhonePattern,
  brazilPhoneTitle,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
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
  const [feedback, setFeedback] = useState('');

  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = (event) => {
    event.preventDefault();
    const updatedUser = { ...user, ...form };
    localStorage.setItem('user', JSON.stringify(updatedUser));
    setFeedback('Dados salvos neste navegador. A sincronização com o banco pode ser conectada na próxima etapa.');
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
              WhatsApp <span className="whatsapp-symbol">☎</span>
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
