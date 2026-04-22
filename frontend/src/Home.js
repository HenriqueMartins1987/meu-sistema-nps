import React from 'react';
import { useNavigate } from 'react-router-dom';
import logo from './assets/logo3.png';

function Home() {
  const navigate = useNavigate();

  return (
    <main className="app-page">
      <header className="topbar">
        <div className="brand-mark">
          <img src={logo} alt="GRC Consultoria Empresarial" />
        </div>

        <nav className="top-actions" aria-label="Navegação principal">
          <button className="ghost-action" onClick={() => navigate('/dashboard')}>
            Dashboard
          </button>
          <button className="ghost-action" onClick={() => navigate('/dashboard-nps')}>
            Dashboard NPS
          </button>
          <button className="ghost-action" onClick={() => navigate('/gestao')}>
            Painel de Gestão de Reclamações
          </button>
          <button className="ghost-action" onClick={() => navigate('/gestao-nps')}>
            Painel de Gestão NPS
          </button>
          <button className="ghost-action account-action" onClick={() => navigate('/perfil')}>
            Minha conta
          </button>
          <button
            className="outline-action"
            onClick={() => {
              localStorage.removeItem('token');
              localStorage.removeItem('user');
              navigate('/');
            }}
          >
            Sair
          </button>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-copy">
          <p className="eyebrow">Sistema GRC</p>
          <h1>Gestão profissional da voz do cliente.</h1>
          <p>
            Centralize protocolos com tratativa, prazo e auditoria. Sugestões,
            elogios e pesquisas de satisfação ficam conectados à análise executiva.
          </p>
        </div>

        <div className="home-actions">
          <button className="primary-action" onClick={() => navigate('/cadastro')}>
            Novo Protocolo
          </button>
          <button className="secondary-action" onClick={() => navigate('/gestao')}>
            Painel de Gestão de Reclamações
          </button>
          <button className="outline-action" onClick={() => navigate('/dashboard')}>
            Dashboard
          </button>
          <button className="outline-action" onClick={() => navigate('/gestao-nps')}>
            Painel de Gestão NPS
          </button>
        </div>
      </section>

      <section className="feedback-intake-panel" aria-label="Sugestões e elogios">
        <div>
          <p className="eyebrow">Sugestões e Elogios</p>
          <h2>Registros positivos e oportunidades de melhoria</h2>
          <p>Use o mesmo cadastro para manter a base unificada, com cada tipo separado para análise no dashboard.</p>
        </div>

        <div className="feedback-intake-actions">
          <button className="outline-action" onClick={() => navigate('/cadastro?tipo=sugestao&canal=nps')}>
            Cadastrar Sugestão
          </button>
          <button className="outline-action" onClick={() => navigate('/cadastro?tipo=elogio&canal=nps')}>
            Cadastrar Elogio
          </button>
        </div>
      </section>

      <section className="quick-grid" aria-label="Atalhos operacionais">
        <article className="quick-card accent-brand">
          <div className="quick-card-head">
            <span className="quick-number">Protocolos</span>
            <span className="quick-tag">Auditável</span>
          </div>
          <h2>Cadastro com governança e padrão operacional</h2>
          <p>Registre manifestações, sugestões, elogios e satisfação com protocolo, histórico e rastreabilidade.</p>
          <strong className="quick-highlight">Cada registro entra na base analítica no mesmo fluxo.</strong>
        </article>

        <article className="quick-card accent-teal">
          <div className="quick-card-head">
            <span className="quick-number">Tratativa</span>
            <span className="quick-tag">SLA</span>
          </div>
          <h2>Fila executiva com prioridade, prazo e responsável atual</h2>
          <p>Comentários, anexos, primeiro atendimento e fechamento ficam vinculados ao usuário logado.</p>
          <strong className="quick-highlight">A operação enxerga com quem o protocolo está parado e há quantos dias.</strong>
        </article>

        <article className="quick-card accent-gold">
          <div className="quick-card-head">
            <span className="quick-number">Inteligência</span>
            <span className="quick-tag">BI</span>
          </div>
          <h2>Dashboard interativo para leitura executiva</h2>
          <p>Análise por clínica, estado, região, cidade, canal, tipo, status e criticidade.</p>
          <strong className="quick-highlight">Os filtros ajudam a comparar operação, volume e recorrência.</strong>
        </article>

        <article className="quick-card accent-leaf">
          <div className="quick-card-head">
            <span className="quick-number">Experiência</span>
            <span className="quick-tag">NPS</span>
          </div>
          <h2>Gestão NPS com detratores conectados à tratativa</h2>
          <p>Acompanhe promotores, neutros e detratores, com reclassificação de detratores para reclamação quando necessário.</p>
          <strong className="quick-highlight">A satisfação vira indicador e também ação operacional.</strong>
        </article>
      </section>
    </main>
  );
}

export default Home;
