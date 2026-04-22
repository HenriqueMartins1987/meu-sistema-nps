import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from './api';
import logo from './assets/logo3.png';
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

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeModule, setActiveModule] = useState(experienceModules[0].id);

  const selectedModule = useMemo(
    () => experienceModules.find((item) => item.id === activeModule) || experienceModules[0],
    [activeModule]
  );
  const redirectPath = location.state?.from || '/home';
  const timedOut = location.state?.reason === 'idle_timeout';

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/login', {
        email,
        username: email,
        password
      });

      if (res.data.token || res.data.success) {
        saveSession(res.data.token || '', res.data.user || { email, role: 'viewer', permissions: [] });
        navigate(redirectPath, { replace: true });
        return;
      }

      setError('Login inválido');
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

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="login-brand-shell">
          <img src={logo} alt="GRC Consultoria Empresarial" className="login-brand-logo" />
          <p className="eyebrow">Voz do cliente e experiência do paciente</p>
          <h1>Gestão completa de sugestões, elogios, reclamações e satisfação.</h1>
          <p>
            Centralize todos os sinais da jornada do cliente, acompanhe tratativas por prazo
            e transforme cada registro em indicador para decisão.
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
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-card-header">
            <img src={logo} alt="GRC Consultoria Empresarial" className="form-logo" />
            <span className="system-chip">Portal seguro</span>
          </div>

          <h2>Login</h2>
          <p>Entre para acompanhar e analisar a experiência do cliente com rastreabilidade.</p>

          {timedOut && !error && (
            <p className="form-feedback">Sua sessão expirou após 20 minutos sem atividade. Faça login novamente.</p>
          )}

          <label className="login-field">
            E-mail corporativo
            <input
              className="field"
              type="email"
              placeholder="nome@empresa.com.br"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
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
        </form>
      </section>
    </main>
  );
}

export default Login;
