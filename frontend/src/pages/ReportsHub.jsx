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
      description: 'Acesse os painéis de acompanhamento das manifestações, prazos, unidades e tratativas do SAC.',
      items: [
        {
          label: 'Relatório diário, semanal e mensal',
          path: '/gestao/relatorio-semanal',
          visible: canOpenWeeklyComplaintReport(user) && hasPermission(user, 'complaints_management'),
          meta: 'Prazos vencidos, responsáveis, rankings, motivos e protocolos detalhados.'
        },
        {
          label: 'Dashboard de Reclamações',
          path: '/dashboard',
          visible: hasPermission(user, 'complaints_dashboard'),
          meta: 'Visão executiva com filtros, evolução, indicadores e recortes por unidade.'
        },
        {
          label: 'BI de Reclamações',
          path: '/bi',
          visible: hasPermission(user, 'complaints_dashboard'),
          meta: 'Análise gerencial para leitura estratégica da voz do cliente.'
        },
        {
          label: 'Gestão de Reclamações',
          path: '/gestao',
          visible: hasPermission(user, 'complaints_management'),
          meta: 'Fila operacional para cadastro, movimentação, tratativa e encerramento.'
        }
      ]
    },
    {
      key: 'nps',
      eyebrow: 'Experiência',
      title: 'Relatórios NPS',
      description: 'Acompanhe satisfação, perfis de resposta, detratores e indicações geradas pelo fluxo NPS.',
      items: [
        {
          label: 'Gestão de NPS',
          path: '/gestao-nps',
          visible: hasPermission(user, 'nps_management'),
          meta: 'Respostas, tratativas, envios com êxito e acompanhamento dos detratores.'
        },
        {
          label: 'Dashboard NPS',
          path: '/dashboard-nps',
          visible: hasPermission(user, 'nps_dashboard'),
          meta: 'Indicadores, evolução, distribuição por perfil e leitura por clínica.'
        },
        {
          label: 'Pesquisa NPS pública',
          path: '/pesquisa-nps',
          visible: hasPermission(user, 'nps_management'),
          meta: 'Link público da pesquisa para apoio operacional e validações.'
        }
      ]
    },
    {
      key: 'financial',
      eyebrow: 'CRC',
      title: 'Relatórios Financeiros CRC',
      description: 'Monitore produtividade, campanhas, gestão financeira e performance operacional do CRC.',
      items: [
        {
          label: 'Dashboard Executivo CRC',
          path: '/home/financial-intelligence',
          visible: hasPermission(user, 'financial_dashboard'),
          meta: 'Resumo executivo de produtividade, conversões e performance financeira.'
        },
        {
          label: 'Produtividade x Campanha',
          path: '/home/financial-intelligence/campaigns',
          visible: hasPermission(user, 'financial_campaigns'),
          meta: 'Comparativo entre campanhas, unidades, retornos e resultado operacional.'
        },
        {
          label: 'Gestão Financeira CRC',
          path: '/home/financial-intelligence/manage',
          visible: hasPermission(user, 'financial_management'),
          meta: 'Controle de metas, custos, receitas e parâmetros financeiros do CRC.'
        }
      ]
    },
    {
      key: 'whatsapp',
      eyebrow: 'WhatsApp',
      title: 'Relatórios e Operação WhatsApp',
      description: 'Centralize gestão de sessões, confirmações, histórico, filas e auditoria dos disparos.',
      items: [
        {
          label: 'Dashboard WhatsApp CRC',
          path: '/home/whatsapp-management/dashboard',
          visible: whatsappVisible && hasPermission(user, 'whatsapp_dashboard'),
          meta: 'Indicadores de atendimento, sessões, volume de mensagens e disponibilidade.'
        },
        {
          label: 'Confirmação e Agendamento',
          path: '/home/whatsapp-management/confirmation',
          visible: whatsappVisible && !isNpsOperator && hasPermission(user, 'whatsapp_reports'),
          meta: 'Acompanhamento de confirmações, retornos, agendamentos e pendências.'
        },
        {
          label: 'Histórico de mensagens',
          path: '/home/whatsapp-management/history',
          visible: whatsappVisible && hasPermission(user, 'whatsapp_history'),
          meta: 'Auditoria de conversas, entregas, falhas e mensagens enviadas.'
        },
        {
          label: 'Sessões / QR Code',
          path: '/home/whatsapp-management/instances',
          visible: whatsappVisible && hasPermission(user, 'whatsapp_instances'),
          meta: 'Controle das conexões, QR Code, status e sessões vinculadas.'
        }
      ]
    },
    {
      key: 'patients',
      eyebrow: 'Pacientes',
      title: 'Relatórios de Pacientes',
      description: 'Consulte bases, agenda, duplicidades e indicadores relacionados ao acompanhamento de pacientes.',
      items: [
        {
          label: 'Gestão de Pacientes',
          path: '/pacientes',
          visible: hasPermission(user, 'patient_management'),
          meta: 'Cadastro, agenda do paciente, histórico e vínculos operacionais.'
        },
        {
          label: 'Dashboard de Pacientes',
          path: '/pacientes/dashboard',
          visible: hasPermission(user, 'patient_management'),
          meta: 'Indicadores de pacientes, duplicidades, pendências e acompanhamento.'
        }
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
  const primaryActions = groups
    .flatMap((group) => group.items.map((item) => ({ ...item, group: group.title, groupEyebrow: group.eyebrow })))
    .slice(0, 4);

  return (
    <main className="reports-hub-page">
      <section className="reports-hub-hero">
        <div>
          <p className="eyebrow">Central executiva</p>
          <h1>Central de relatórios</h1>
          <p>Relatórios e dashboards liberados para seu perfil, organizados por finalidade para consulta rápida e padronizada.</p>
        </div>
      </section>

      {primaryActions.length ? (
        <section className="reports-featured-actions reports-featured-link-grid" aria-label="Atalhos recomendados">
          <div>
            <p className="eyebrow">Acessos principais</p>
            <h2>Escolha o relatório pelo objetivo da análise</h2>
            <p className="base-subtitle">Os cards abaixo levam diretamente às visões mais usadas do seu perfil.</p>
          </div>
          <div>
            {primaryActions.map((item) => (
              <button type="button" key={`featured-${item.path}`} onClick={() => navigate(item.path)}>
                <span>{item.label}</span>
                <small>{item.meta}</small>
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
