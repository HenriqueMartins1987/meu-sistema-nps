import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isMasterAdmin, readUser } from './constants';
import './SystemAccessGate.css';

export const SYSTEM_SUSPENSION_AT = '2026-07-31T11:00:00.000Z'; // 31/07/2026 08:00 America/Sao_Paulo

function isSystemSuspended(now = Date.now()) {
  return Number(now) >= Date.parse(SYSTEM_SUSPENSION_AT);
}

function controlDescriptor(element) {
  if (!element) return '';
  return [
    element.textContent,
    element.getAttribute?.('title'),
    element.getAttribute?.('aria-label'),
    element.getAttribute?.('href'),
    element.getAttribute?.('download'),
    element.getAttribute?.('data-format'),
    element.getAttribute?.('data-export'),
    element.getAttribute?.('name'),
    element.getAttribute?.('id'),
    element.className
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isProtectedExportControl(element) {
  const descriptor = controlDescriptor(element);
  if (!descriptor) return false;

  const directFile = /\.(?:pdf|xlsx?|xls)(?:\?|$|\s)/i.test(descriptor);
  const protectedFormat = /(?:\bpdf\b|\bxlsx?\b|\bexcel\b|planilha|spreadsheet)/i.test(descriptor);
  const exportIntent = /(?:exportar|exportacao|export|download|baixar|gerar arquivo|imprimir relatorio)/i.test(descriptor);

  return directFile || protectedFormat || exportIntent;
}

function markProtectedExportControls() {
  document.querySelectorAll('button, a, [role="button"]').forEach((element) => {
    if (isProtectedExportControl(element)) {
      element.classList.add('master-export-restricted-control');
      element.setAttribute('aria-disabled', 'true');
      element.setAttribute('title', 'Exportação de PDF e Excel disponível somente ao Administrador Master.');
    }
  });
}

function MasterExportGuard({ onBlocked }) {
  useEffect(() => {
    if (isMasterAdmin(readUser())) return undefined;

    markProtectedExportControls();

    const observer = new MutationObserver(() => {
      markProtectedExportControls();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    const blockProtectedDownload = (event) => {
      const control = event.target?.closest?.('button, a, [role="button"]');
      if (!control || !isProtectedExportControl(control)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      onBlocked();
    };

    document.addEventListener('click', blockProtectedDownload, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', blockProtectedDownload, true);
    };
  }, [onBlocked]);

  return null;
}

function SuspensionPage() {
  return (
    <main className="system-suspension-page" role="main">
      <section className="system-suspension-card" role="alert" aria-live="assertive">
        <div className="system-suspension-icon" aria-hidden="true">!</div>
        <p className="system-suspension-eyebrow">Acesso restrito</p>
        <h1>Sistema GRC temporariamente indisponivel</h1>
        <p>
          Em razão da ausência de regularização contratual, o acesso ao sistema foi suspenso
          a partir de <strong>31/07/2026, às 08:00</strong>.
        </p>
        <p>
          Durante o período de suspensão, a plataforma permanece acessível exclusivamente ao
          <strong> Administrador Master</strong> para fins de administração, auditoria e preservação dos dados.
        </p>
        <div className="system-suspension-notice">
          Para restabelecimento dos demais acessos, será necessária a regularização formal do contrato.
        </div>
        <a className="system-suspension-login" href="/">Acessar como Administrador Master</a>
      </section>
    </main>
  );
}

function ExportRestrictionModal({ onClose }) {
  return (
    <div className="master-export-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="master-export-title">
      <section className="master-export-modal">
        <div className="master-export-modal-icon" aria-hidden="true">!</div>
        <p className="system-suspension-eyebrow">Permissão restrita</p>
        <h2 id="master-export-title">Download não autorizado</h2>
        <p>
          A exportação e o download de arquivos em <strong>PDF ou Excel</strong> estão disponíveis
          exclusivamente ao Administrador Master.
        </p>
        <button type="button" className="master-export-modal-button" onClick={onClose}>Entendido</button>
      </section>
    </div>
  );
}

export default function SystemAccessGate({ children }) {
  const location = useLocation();
  const [now, setNow] = useState(Date.now());
  const [downloadBlocked, setDownloadBlocked] = useState(false);
  const user = readUser();
  const master = isMasterAdmin(user);
  const suspended = isSystemSuspended(now);

  useEffect(() => {
    const suspensionAt = Date.parse(SYSTEM_SUSPENSION_AT);
    const delay = Math.max(0, suspensionAt - Date.now());
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(delay + 100, 2147483647));
    const interval = window.setInterval(() => setNow(Date.now()), 30000);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  const loginRoute = location.pathname === '/';

  return (
    <>
      <MasterExportGuard onBlocked={() => setDownloadBlocked(true)} />
      {suspended && !master && !loginRoute ? <SuspensionPage /> : children}
      {downloadBlocked && <ExportRestrictionModal onClose={() => setDownloadBlocked(false)} />}
    </>
  );
}

export { isProtectedExportControl, isSystemSuspended };
