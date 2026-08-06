import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import logo from './assets/grc-brand.svg';
import api, { getApiErrorMessage } from './api';
import { saveSession } from './session';
import { formatBrazilPhoneInput, isCompleteBrazilPhone } from './constants';

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
  phone: '+55',
  cpf: '',
  crcOperatorArea: '',
  email: ''
};

const crcOperatorAreaOptions = [
  { value: 'confirmacao_agendamento', label: 'Confirmação e Agendamento' },
  { value: 'ortodontia', label: 'Ortodontia' }
];

function normalizeUsernamePreview(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}

function buildUsernamePreviewFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  return normalizeUsernamePreview(`${parts[0]}.${parts[parts.length - 1]}`);
}

function onlyCpfDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

function formatCpfInput(value) {
  const digits = onlyCpfDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function isValidCpf(value) {
  const cpf = onlyCpfDigits(value);
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
}

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
  const [maintenanceNotice, setMaintenanceNotice] = useState({ open: false, message: 'Sistema em Manutenção' });

  const selectedModule = useMemo(
    () => experienceModules.find((item) => item.id === activeModule) || experienceModules[0],
    [activeModule]
  );
  const generatedCrcUsername = useMemo(
    () => buildUsernamePreviewFromName(crcRegisterForm.name),
    [crcRegisterForm.name]
  );

  const redirectPath = location.state?.from || '/home';
  const timedOut = location.state?.reason === 'idle_timeout';

  const updateRecoveryField = (field, value) => {
    setRecoveryForm((prev) => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    let active = true;

    api.get('/system/maintenance-status')
      .then((response) => {
        if (!active) return;
        if (response.data?.maintenanceMode || response.data?.enabled) {
          setMaintenanceNotice({
            open: true,
            message: response.data?.message || 'Sistema em Manutenção'
          });
        }
      })
      .catch(() => {});

    const handleMaintenanceMode = (event) => {
      setMaintenanceNotice({
        open: true,
        message: event.detail?.message || 'Sistema em Manutenção'
      });
    };

    window.addEventListener('nps:maintenance-mode', handleMaintenanceMode);

    return () => {
      active = false;
      window.removeEventListener('nps:maintenance-mode', handleMaintenanceMode);
    };
  }, []);

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
      if (err.response?.data?.code === 'SYSTEM_MAINTENANCE' || err.response?.data?.maintenanceMode) {
        setMaintenanceNotice({
          open: true,
          message: err.response?.data?.error || 'Sistema em Manutenção'
        });
      }
      setError(getApiErrorMessage(err, 'Nao foi possivel conectar com a API de autenticacao.'));
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

    if (!generatedCrcUsername) {
      setError('Informe nome e sobrenome para gerar seu usuario de acesso.');
      setCrcRegisterLoading(false);
      return;
    }

    if (!isCompleteBrazilPhone(crcRegisterForm.phone)) {
      setError('Informe o celular completo no formato +55DDDNÚMERO.');
      setCrcRegisterLoading(false);
      return;
    }

    if (!isValidCpf(crcRegisterForm.cpf)) {
      setError('Informe um CPF válido.');
      setCrcRegisterLoading(false);
      return;
    }

    if (!crcRegisterForm.crcOperatorArea) {
      setError('Selecione a área de atuação do Operador CRC.');
      setCrcRegisterLoading(false);
      return;
    }

    try {
      const response = await api.post('/auth/crc-operator/register', {
        name: crcRegisterForm.name,
        phone: crcRegisterForm.phone,
        cpf: crcRegisterForm.cpf,
        crcOperatorArea: crcRegisterForm.crcOperatorArea,
        email: crcRegisterForm.email
      });
      closeCrcRegister();
      setEmail(response.data?.pendingAuthorization ? '' : (response.data?.username || generatedCrcUsername));
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

      {maintenanceNotice.open && (
        <div className="modal-backdrop maintenance-modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel maintenance-modal-panel" onClick={(event) => event.stopPropagation()}>
            <span className="system-chip maintenance-chip">Manutencao programada</span>
            <h2>{maintenanceNotice.message || 'Sistema em Manutenção'}</h2>
            <p>
              O acesso operacional esta temporariamente bloqueado para manutencao.
              Apenas o Administrador Master pode acessar o sistema neste periodo.
            </p>
            <button
              type="button"
              className="primary-action full-width"
              onClick={() => setMaintenanceNotice((current) => ({ ...current, open: false }))}
            >
              Entendi
            </button>
          </section>
        </div>
      )}

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
            <p>Informe nome completo, celular, CPF e área. O usuário será gerado automaticamente e a senha inicial será o CPF.</p>

            <div className="login-modal-grid">
              <label>
                Nome completo
                <input className="field" value={crcRegisterForm.name} onChange={(event) => updateCrcRegisterField('name', event.target.value)} required />
                <small>Usuario gerado: <strong>{generatedCrcUsername || 'informe nome e sobrenome'}</strong></small>
              </label>
              <label>
                Celular
                <input className="field" value={crcRegisterForm.phone} onChange={(event) => updateCrcRegisterField('phone', formatBrazilPhoneInput(event.target.value))} placeholder="+5562999999999" maxLength={14} required />
              </label>
              <label>
                CPF
                <input className="field" value={crcRegisterForm.cpf} onChange={(event) => updateCrcRegisterField('cpf', formatCpfInput(event.target.value))} placeholder="000.000.000-00" maxLength={14} required />
              </label>
              <label>
                Área de atuação
                <select className="field" value={crcRegisterForm.crcOperatorArea} onChange={(event) => updateCrcRegisterField('crcOperatorArea', event.target.value)} required>
                  <option value="">Selecione</option>
                  {crcOperatorAreaOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                E-mail opcional
                <input className="field" type="email" value={crcRegisterForm.email} onChange={(event) => updateCrcRegisterField('email', event.target.value)} placeholder="opcional" />
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
