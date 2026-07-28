import React, { useEffect, useRef, useState } from 'react';
import HomeShellFixed from './HomeShellFixed';
import './HomeContractNotice.css';

const CONTRACT_DEADLINE = '31/07/2026';

function ContractNoticeModal({ onAcknowledge }) {
  const acknowledgeButtonRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      acknowledgeButtonRef.current?.focus();
    }, 120);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onAcknowledge();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onAcknowledge]);

  return (
    <div className="contract-notice-backdrop" role="presentation">
      <section
        className="contract-notice-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="contract-notice-title"
        aria-describedby="contract-notice-description"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="contract-notice-close"
          onClick={onAcknowledge}
          aria-label="Fechar comunicado"
        >
          ×
        </button>

        <div className="contract-notice-alert-icon" aria-hidden="true">
          <span>!</span>
        </div>

        <p className="contract-notice-eyebrow">Aviso administrativo prioritário</p>
        <h2 id="contract-notice-title">Comunicado Importante — Regularização Contratual do Sistema</h2>

        <div id="contract-notice-description" className="contract-notice-copy">
          <p>
            Informamos que, caso não haja a devida regularização contratual do sistema,
            sua utilização será suspensa a partir do dia <strong>{CONTRACT_DEADLINE}</strong>.
          </p>
          <p>
            Para evitar interrupções operacionais e garantir a continuidade do acesso às
            funcionalidades, relatórios e rotinas da plataforma, solicitamos que a
            regularização seja providenciada com a máxima brevidade.
          </p>
          <p>
            Em caso de dúvidas, tratativas ou alinhamentos, orientamos que o responsável
            entre em contato imediatamente para as providências necessárias.
          </p>
        </div>

        <div className="contract-notice-deadline" aria-label={`Data limite para regularização: ${CONTRACT_DEADLINE}`}>
          <span>Data limite para regularização</span>
          <strong>{CONTRACT_DEADLINE}</strong>
          <small>Após essa data, o sistema poderá ser suspenso sem novo aviso.</small>
        </div>

        <div className="contract-notice-actions">
          <button
            ref={acknowledgeButtonRef}
            type="button"
            className="contract-notice-acknowledge"
            onClick={onAcknowledge}
          >
            Ciente
          </button>
        </div>
      </section>
    </div>
  );
}

function HomeContractNotice() {
  const [noticeOpen, setNoticeOpen] = useState(true);

  return (
    <>
      <HomeShellFixed />
      {noticeOpen && <ContractNoticeModal onAcknowledge={() => setNoticeOpen(false)} />}
    </>
  );
}

export default HomeContractNotice;
