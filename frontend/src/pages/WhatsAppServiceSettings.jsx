import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function WhatsAppServiceSettings() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/home/whatsapp-management/instances', { replace: true });
  }, [navigate]);

  return (
    <main className="whatsapp-management-page">
      <section className="whatsapp-panel">
        <p className="eyebrow">Configuracoes WhatsApp</p>
        <h1>Redirecionando para a central oficial</h1>
        <p>
          A gestao de QR Code, numeros, testes e conexao foi unificada em
          Gestao WhatsApp CRC para evitar telas duplicadas e botoes sem retorno.
        </p>
        <button
          type="button"
          className="primary-action"
          onClick={() => navigate('/home/whatsapp-management/instances', { replace: true })}
        >
          Abrir Gestao WhatsApp CRC
        </button>
      </section>
    </main>
  );
}

export default WhatsAppServiceSettings;
