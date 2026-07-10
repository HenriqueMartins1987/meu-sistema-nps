import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasPermission, isMasterAdmin, normalizeRoleValue, readUser } from '../constants';

function canOpenWeeklyComplaintReport(user) {
  if (isMasterAdmin(user)) return true;
  return ['admin', 'supervisor_crc', 'sac_operator', 'manager'].includes(normalizeRoleValue(user?.role));
}

function canAccessWhatsApp(user) {
  const role = normalizeRoleValue(user?.role);
  return hasPermission(user, 'whatsapp_management') || ['crc_leader', 'crc_manager', 'crc_operator', 'nps_operator', 'admin', 'supervisor_crc', 'sac_operator'].includes(role);
}

function buildReportGroups(user) {
  const role = normalizeRoleValue(user?.role);
  const isNpsOperator = role === 'nps_operator';
  const whatsappVisible = canAccessWhatsApp(user);

  const groups = [
    {
      key: 'complaints',
      eyebrow: 'Atendimento',
      title: 'Relatórios de Reclamações',
      description: 'Acompanhamento semanal, dashboards operacionais e BI da voz do cliente.',
      items: [
        { label: 'Relatório diário, semanal e mensal', path: '/gestao/relatorio-semanal', visible: canOpenWeeklyComplaintReport(user) && hasPermission(user, 'complaints_management'), meta: 'rotina operacional' },
        { label: 'Dashboard de Reclamações', path: '/dashboard', visible: hasPermission(user, 'complaints_dashboard'), meta: 'visão executiva' },
        { label: 'BI de Reclamações', path: '/bi', visible: hasPermission(user, 'complaints_dashboard'), meta: 'análise gerencial' },
        { label: 'Gestão de Reclamações', path: '/gestao', visible: hasPermission(user, 'complaints_management'), meta: 'fila operacional' }
      ]
    },
    {
      key: 'nps',
      eyebrow: 'Experiência',
      title: 'Relatórios NPS',
      description: 'Indicadores de satisfação, pesquisas ativas e gestão de respostas dos pacientes.',
      items: [
        { label: 'Gestão de NPS', path: '/gestao-nps', visible: hasPermission(user, 'nps_management'), meta: 'respostas e tratativas' },
        { label: 'Dashboard NPS', path: '/dashboard-nps', visible: hasPermission(user, 'nps_dashboard'), meta: 'indicadores NPS' },
        { label: 'Pesquisa NPS pública', path: '/pesquisa-nps', visible: hasPermission(user, 'nps_management'), meta: 'link de pesquisa' }
      ]
    },
    {
      key: 'financial',
      eyebrow: 'CRC',
      title: 'Relatórios Financeiros CRC',
      description: 'Produtividade, campanhas e gestão financeira da operação CRC.',
      items: [
        { label: 'Dashboard Executivo CRC', path: '/home/financial-intelligence', visible: hasPermission(user, 'financial_dashboard'), meta: 'resumo executivo' },
        { label: 'Produtividade x Campanha', path: '/home/financial-intelligence/campaigns', visible: hasPermission(user, 'financial_campaigns'), meta: 'campanhas e unidades' },
        { label: 'Gestão Financeira CRC', path: '/home/financial-intelligence/manage', visible: hasPermission(user, 'financial_management'), meta: 'controle financeiro' }
      ]
    },
    {
      key: 'whatsapp',
      eyebrow: 'WhatsApp',
      title: 'Relatórios e Operação WhatsApp',
      description: 'BI de sessões, confirmações, histórico de mensagens e filas de disparo.',
      items: [
        { label: 'Dashboard WhatsApp CRC', path: '/home/whatsapp-management/dashboard', visible: whatsappVisible && hasPermission(user, 'whatsapp_dashboard'), meta: 'BI operacional' },
        { label: 'Confirmação e Agendamento', path: '/home/whatsapp-management/confirmation', visible: whatsappVisible && !isNpsOperator && hasPermission(user, 'whatsapp_reports'), meta: 'confirmações' },
        { label: 'Histórico de mensagens', path: '/home/whatsapp-management/history', visible: whatsappVisible && hasPermission(user, 'whatsapp_history'), meta: 'auditoria' },
        { label: 'Sessões / QR Code', path: '/home/whatsapp-management/instances', visible: whatsappVisible && hasPermission(user, 'whatsapp_instances'), meta: 'conexões' }
      ]
    },
    {
      key: 'patients',
      eyebrow: 'Pacientes',
      title: 'Relatórios de Pacientes',
      description: 'Bases e dashboards de acompanhamento do paciente.',
      items: [
        { label: 'Gestão de Pacientes', path: '/pacientes', visible: hasPermission(user, 'patient_management'), meta: 'cadastro e agenda' },
        { label: 'Dashboard de Pacientes', path: '/pacientes/dashboard', visible: hasPermission(user, 'patient_management'), meta: 'indicadores' }
      ]
    }
  ];

  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.visible) }))
    .filter((group) => group.items.length);
}

export default function ReportsHub() {
  const navigate = useNavigate();
  const user = useMemo(() => readUser(), []);
  const groups = useMemo(() => buildReportGroups(user), [user]);
  const totalLinks = groups.reduce((sum, group) => sum + group.items.length, 0);
  const totalDashboards = groups.reduce((sum, group) => (
    sum + group.items.filter((item) => String(item.label || '').toLowerCase().includes('dashboard')).length
  ), 0);
  const totalOperationalReports = Math.max(totalLinks - totalDashboards, 0);
  const primaryActions = groups
    .flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })))
    .slice(0, 4);

  return (
    <main className="reports-hub-page">
      <section className="reports-hub-hero">
        <div>
          <p className="eyebrow">Central executiva</p>
          <h1>Central de relatórios</h1>
          <p>Todos os relatórios e dashboards liberados para seu perfil em um único ponto de acesso.</p>
        </div>
        <div className="reports-hub-summary">
          <span>Links liberados</span>
          <strong>{totalLinks}</strong>
          <small>{groups.length} módulos disponíveis</small>
        </div>
      </section>

      <section className="reports-command-center" aria-label="Resumo da central de relatorios">
        <article>
          <span>Dashboards</span>
          <strong>{totalDashboards}</strong>
          <small>visoes executivas liberadas</small>
        </article>
        <article>
          <span>Relatorios operacionais</span>
          <strong>{totalOperationalReports}</strong>
          <small>rotinas, auditoria e acompanhamento</small>
        </article>
        <article>
          <span>Perfil</span>
          <strong>{normalizeRoleValue(user?.role) || 'usuario'}</strong>
          <small>acesso calculado por permissao</small>
        </article>
      </section>

      {primaryActions.length ? (
        <section className="reports-featured-actions" aria-label="Atalhos recomendados">
          <div>
            <p className="eyebrow">Atalhos recomendados</p>
            <h2>Acesse rapidamente as frentes mais usadas</h2>
          </div>
          <div>
            {primaryActions.map((item) => (
              <button type="button" key={`featured-${item.path}`} onClick={() => navigate(item.path)}>
                <span>{item.label}</span>
                <small>{item.group} - {item.meta}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="reports-hub-grid">
        {groups.map((group) => (
          <article className="reports-hub-card" key={group.key}>
            <header>
              <span>{group.eyebrow}</span>
              <h2>{group.title}</h2>
              <p>{group.description}</p>
            </header>
            <div className="reports-hub-links">
              {group.items.map((item) => (
                <button type="button" key={item.path} onClick={() => navigate(item.path)}>
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
