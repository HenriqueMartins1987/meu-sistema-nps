import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import logo from './assets/logo3.png';
import api from './api';
import { saveSession } from './session';

const experienceModules = [
  {
    id: 'reclamacoes',
    label: 'Reclamações',
    title: 'Tratativa com prazo, protocolo e auditoria.',
    text: 'Controle cada ocorrência desde o cadastro até o fechamento, com SLA, evidências e responsáveis.'
  },
  {
    id: 'sugestoes',
    label: 'Sugestões',
    title: 'Ideias do cliente viram melhoria operacional.',
    text: 'Capture oportunidades de melhoria por unidade, região, canal e tipo de atendimento.'
  },
  {
    id: 'elogios',
    label: 'Elogios',
    title: 'Reconhecimento também precisa de gestão.',
    text: 'Registre boas experiências para identificar equipes, clínicas e práticas que geram encantamento.'
  },
  {
    id: 'satisfacao',
    label: 'Pesquisa de satisfação',
    title: 'Indicadores para entender a jornada do paciente.',
    text: 'Acompanhe percepção, NPS e sinais de experiência para orientar decisões executivas.'
  }
];

const initialRecoveryForm = {
  email: '',
  code: '',
  new_password: '',
  confirm_password: ''
};

const initialCrcOperatorForm = {
  name: '',
  username: '',
  phone: '+55',
  email: '',
  password: '',
  confirm_password: ''
};

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeModule, setActiveModule] = useState(experienceModules[0].id);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState('request');
  const [recoveryForm, setRecoveryForm] = useState(initialRecoveryForm);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [crcRegisterOpen, setCrcRegisterOpen] = useState(false);
  const [crcRegisterForm, setCrcRegisterForm] = useState(initialCrcOperatorForm);
  const [crcRegisterLoading, setCrcRegisterLoading] = useState(false);

  const selectedModule = useMemo(
    () => experienceModules.find((item) => item.id === activeModule) || experienceModules[0],
    [activeModule]
  );

  const redirectPath = location.state?.from || '/home';
  const timedOut = location.state?.reason === 'idle_timeout';

  const updateRecoveryField = (field, value) => {
    setRecoveryForm((prev) => ({ ...prev, [field]: value }));
  };

  const openRecovery = () => {
    setRecoveryOpen(true);
    setRecoveryStep('request');
    setRecoveryForm((prev) => ({ ...prev, email }));
    setError('');
    setInfo('');
  };

  const closeRecovery = () => {
    setRecoveryOpen(false);
    setRecoveryStep('request');
    setRecoveryForm(initialRecoveryForm);
    setError('');
    setInfo('');
  };

  const updateCrcRegisterField = (field, value) => {
    setCrcRegisterForm((prev) => ({ ...prev, [field]: value }));
  };

  const openCrcRegister = () => {
    setCrcRegisterOpen(true);
    setCrcRegisterForm(initialCrcOperatorForm);
    setError('');
    setInfo('');
  };

  const closeCrcRegister = () => {
    setCrcRegisterOpen(false);
    setCrcRegisterForm(initialCrcOperatorForm);
    setError('');
    setInfo('');
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      const response = await api.post('/login', {
        email,
        username: email,
        password
      });

      if (response.data.token || response.data.success) {
        saveSession(response.data.token || '', response.data.user || { email, role: 'viewer', permissions: [] });
        navigate(redirectPath, { replace: true });
        return;
      }

      setError('Login inválido.');
    } catch (err) {
      const message = err.response?.data?.message
        || err.response?.data?.error
        || (err.code === 'ECONNABORTED'
          ? 'A conexão com a API expirou. Verifique se o backend está publicado e ativo.'
          : 'Não foi possível conectar com a API de autenticação.');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestRecovery = async (event) => {
    event.preventDefault();
    setRecoveryLoading(true);
    setError('');
    setInfo('');

    try {
      const response = await api.post('/auth/request-password-reset', {
        email: recoveryForm.email
      });
      setRecoveryStep('confirm');
      setInfo(response.data?.message || 'Enviamos um código de confirmação para o seu e-mail.');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível solicitar a recuperação de senha.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleConfirmRecovery = async (event) => {
    event.preventDefault();
    setRecoveryLoading(true);
    setError('');
    setInfo('');

    if (recoveryForm.new_password !== recoveryForm.confirm_password) {
      setError('A confirmação da nova senha não confere.');
      setRecoveryLoading(false);
      return;
    }

    try {
      const response = await api.post('/auth/reset-password-with-code', {
        email: recoveryForm.email,
        code: recoveryForm.code,
        new_password: recoveryForm.new_password
      });

      closeRecovery();
      setInfo(response.data?.message || 'Senha redefinida com sucesso. Faça login com a nova senha.');
      setEmail(recoveryForm.email);
      setPassword('');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível redefinir a senha.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleCrcOperatorRegister = async (event) => {
    event.preventDefault();
    setCrcRegisterLoading(true);
    setError('');
    setInfo('');

    if (crcRegisterForm.password !== crcRegisterForm.confirm_password) {
      setError('A confirmação de senha não confere.');
      setCrcRegisterLoading(false);
      return;
    }

    try {
      const response = await api.post('/auth/crc-operator/register', {
        name: crcRegisterForm.name,
        username: crcRegisterForm.username,
        phone: crcRegisterForm.phone,
        email: crcRegisterForm.email,
        password: crcRegisterForm.password
      });
      closeCrcRegister();
      setEmail(response.data?.username || crcRegisterForm.username);
      setPassword('');
      setInfo(response.data?.message || 'Operador CRC cadastrado. Faça login com seu usuário.');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível cadastrar o Operador CRC.');
    } finally {
      setCrcRegisterLoading(false);
    }
  };

  return (
    <main className="login-page clean-login-page">
      <section className="login-brand">
        <div className="login-brand-shell">
          <div className="login-brand-logo-frame">
            <img className="login-brand-logo" src={logo} alt="GRC Consultoria" />
          </div>
          <p className="eyebrow">Portal de relacionamento e experiência</p>
          <h1>Gestão profissional da voz do cliente.</h1>
          <p>
            Centralize reclamações, sugestões, elogios, pesquisas NPS e agendas do paciente
            com rastreabilidade, prioridade e visão executiva.
          </p>

          <div className="login-module-grid" aria-label="Módulos de experiência">
            {experienceModules.map((item) => (
              <button
                className={`login-module-card ${activeModule === item.id ? 'active' : ''}`}
                key={item.id}
                type="button"
                onClick={() => setActiveModule(item.id)}
              >
                <span>{item.label}</span>
                <strong>{item.title}</strong>
              </button>
            ))}
          </div>

          <article className="login-insight-card">
            <span>{selectedModule.label}</span>
            <h2>{selectedModule.title}</h2>
            <p>{selectedModule.text}</p>
          </article>

          <div className="login-highlights">
            <span>Protocolos</span>
            <span>SLA</span>
            <span>Auditoria</span>
            <span>Dashboard</span>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-label="Acesso ao sistema">
        <form className="login-card clean-login-card" onSubmit={handleLogin}>
          <div className="login-card-header clean-login-header">
            <span className="system-chip">Portal seguro</span>
          </div>

          <h2>Login</h2>
          <p>Entre para acompanhar e analisar a experiência do cliente com rastreabilidade.</p>

          {timedOut && !error && (
            <p className="form-feedback">Sua sessão expirou após 20 minutos sem atividade. Faça login novamente.</p>
          )}

          {info && <p className="form-feedback">{info}</p>}

          <label className="login-field">
            E-mail corporativo ou usuário
            <input
              className="field"
              type="text"
              placeholder="nome@empresa.com.br ou usuário"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label className="login-field">
            Senha
            <input
              className="field"
              type="password"
              placeholder="Digite sua senha"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <button className="primary-action full-width" type="submit" disabled={loading}>
            {loading ? 'Entrando...' : 'Login'}
          </button>

          <button
            className="ghost-action full-width login-link-button"
            type="button"
            onClick={openRecovery}
          >
            Esqueceu sua senha?
          </button>

          <div className="login-divider">
            <span>Primeiro acesso</span>
          </div>

          <button
            className="outline-action full-width"
            type="button"
            onClick={() => navigate('/primeiro-cadastro')}
          >
            Solicitar cadastro
          </button>

          <button
            className="outline-action full-width"
            type="button"
            onClick={openCrcRegister}
          >
            Cadastro Operador CRC
          </button>
        </form>
      </section>

      {recoveryOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeRecovery}>
          <form
            className="modal-panel password-recovery-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={recoveryStep === 'request' ? handleRequestRecovery : handleConfirmRecovery}
          >
            <p className="eyebrow">Recuperação de senha</p>
            <h2>{recoveryStep === 'request' ? 'Solicitar código por e-mail' : 'Definir nova senha'}</h2>
            <p>
              {recoveryStep === 'request'
                ? 'Informe seu e-mail corporativo para receber um código de confirmação.'
                : 'Digite o código recebido por e-mail e cadastre sua nova senha.'}
            </p>

            <label>
              E-mail corporativo
              <input
                className="field"
                type="email"
                value={recoveryForm.email}
                onChange={(event) => updateRecoveryField('email', event.target.value)}
                placeholder="nome@empresa.com.br"
                required
              />
            </label>

            {recoveryStep === 'confirm' && (
              <>
                <label>
                  Código de confirmação
                  <input
                    className="field"
                    type="text"
                    value={recoveryForm.code}
                    onChange={(event) => updateRecoveryField('code', event.target.value)}
                    placeholder="Digite o código recebido"
                    maxLength={6}
                    required
                  />
                </label>

                <label>
                  Nova senha
                  <input
                    className="field"
                    type="password"
                    value={recoveryForm.new_password}
                    onChange={(event) => updateRecoveryField('new_password', event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>

                <label>
                  Confirmar nova senha
                  <input
                    className="field"
                    type="password"
                    value={recoveryForm.confirm_password}
                    onChange={(event) => updateRecoveryField('confirm_password', event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>
              </>
            )}

            {error && <p className="form-error">{error}</p>}
            {info && <p className="form-feedback">{info}</p>}

            <div className="row-actions">
              <button type="button" className="outline-action" onClick={closeRecovery}>
                Cancelar
              </button>
              {recoveryStep === 'confirm' && (
                <button type="button" className="ghost-action" onClick={() => setRecoveryStep('request')}>
                  Solicitar novo código
                </button>
              )}
              <button className="primary-action" type="submit" disabled={recoveryLoading}>
                {recoveryLoading
                  ? 'Processando...'
                  : recoveryStep === 'request'
                    ? 'Enviar código'
                    : 'Salvar nova senha'}
              </button>
            </div>
          </form>
        </div>
      )}

      {crcRegisterOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeCrcRegister}>
          <form
            className="modal-panel password-recovery-modal crc-operator-register-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleCrcOperatorRegister}
          >
            <p className="eyebrow">Acesso WhatsApp CRC</p>
            <h2>Cadastro de Operador CRC</h2>
            <p>Crie seu usuário de acesso. O e-mail será usado apenas para recuperação de senha.</p>

            <div className="login-modal-grid">
              <label>
                Nome completo
                <input className="field" value={crcRegisterForm.name} onChange={(event) => updateCrcRegisterField('name', event.target.value)} required />
              </label>
              <label>
                Usuário de acesso
                <input className="field" value={crcRegisterForm.username} onChange={(event) => updateCrcRegisterField('username', event.target.value)} placeholder="ex.: operador.crc" autoComplete="username" required />
              </label>
              <label>
                Celular
                <input className="field" value={crcRegisterForm.phone} onChange={(event) => updateCrcRegisterField('phone', event.target.value)} placeholder="+5562999999999" required />
              </label>
              <label>
                E-mail de recuperação
                <input className="field" type="email" value={crcRegisterForm.email} onChange={(event) => updateCrcRegisterField('email', event.target.value)} placeholder="nome@empresa.com.br" required />
              </label>
              <label>
                Senha
                <input className="field" type="password" value={crcRegisterForm.password} onChange={(event) => updateCrcRegisterField('password', event.target.value)} autoComplete="new-password" required />
              </label>
              <label>
                Confirmar senha
                <input className="field" type="password" value={crcRegisterForm.confirm_password} onChange={(event) => updateCrcRegisterField('confirm_password', event.target.value)} autoComplete="new-password" required />
              </label>
            </div>

            {error && <p className="form-error">{error}</p>}
            {info && <p className="form-feedback">{info}</p>}

            <div className="row-actions">
              <button type="button" className="outline-action" onClick={closeCrcRegister}>Cancelar</button>
              <button className="primary-action" type="submit" disabled={crcRegisterLoading}>
                {crcRegisterLoading ? 'Cadastrando...' : 'Criar usuário'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

export default Login;
