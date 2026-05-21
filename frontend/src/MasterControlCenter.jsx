import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from './api';
import {
  accessProfiles,
  actionPermissions,
  defaultBrazilPhone,
  formatBrazilPhoneInput,
  hasActionPermission,
  isMasterAdmin,
  readUser,
  screenPermissions
} from './constants';

const roleOptions = [
  { value: 'master_admin', label: 'Administrador Master' },
  ...accessProfiles
];

const tabs = [
  { id: 'users', label: 'Usuarios' },
  { id: 'permissions', label: 'Permissoes' },
  { id: 'releases', label: 'Liberacoes' },
  { id: 'authority', label: 'Alcadas' },
  { id: 'map', label: 'Mapa de acesso' },
  { id: 'system', label: 'Sistema' },
  { id: 'financial', label: 'Financeiro' }
];

const defaultTaxComponents = [
  { key: 'irpj', label: 'IRPJ', percent: 4.8 },
  { key: 'additional_irpj', label: 'Adicional IRPJ', percent: 0.96 },
  { key: 'csll', label: 'CSLL', percent: 2.88 },
  { key: 'pis', label: 'PIS', percent: 0.65 },
  { key: 'cofins', label: 'COFINS', percent: 3 },
  { key: 'iss', label: 'ISS', percent: 5 }
];

const permissionGroups = [
  { key: 'core', title: 'Sistema', match: (value) => ['home', 'admin_panel'].includes(value) },
  { key: 'complaints', title: 'Reclamacoes e protocolos', match: (value) => value.startsWith('complaints') },
  { key: 'nps', title: 'NPS', match: (value) => value.startsWith('nps') },
  { key: 'patients', title: 'Pacientes e CRM', match: (value) => ['patient_management', 'crm_relationship'].includes(value) },
  { key: 'financial', title: 'Financeiro CRC', match: (value) => value.startsWith('financial') },
  { key: 'whatsapp', title: 'WhatsApp CRC', match: (value) => value.startsWith('whatsapp') }
];

const defaultRolePermissions = {
  master_admin: screenPermissions.map((permission) => permission.value),
  admin: screenPermissions.map((permission) => permission.value),
  sac_operator: ['home', 'complaints_register', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'crm_relationship', 'whatsapp_management'],
  supervisor_crc: ['home', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'patient_management', 'crm_relationship', 'financial_campaigns', 'financial_management', 'whatsapp_management'],
  crc_leader: ['home', 'whatsapp_management', 'whatsapp_dashboard', 'whatsapp_instances', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history', 'whatsapp_reports'],
  crc_manager: ['home', 'whatsapp_management', 'whatsapp_dashboard', 'whatsapp_instances', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history', 'whatsapp_reports'],
  crc_operator: ['home', 'whatsapp_management', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history'],
  manager: ['home', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'patient_management', 'crm_relationship', 'financial_campaigns', 'financial_management'],
  coordinator: ['home', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'patient_management', 'crm_relationship'],
  viewer: ['home', 'complaints_management', 'nps_management']
};

const defaultRoleActionPermissions = {
  master_admin: actionPermissions.map((permission) => permission.value),
  admin: actionPermissions.map((permission) => permission.value),
  sac_operator: [
    'complaints_view_all',
    'complaints_close',
    'complaints_change_unit',
    'complaints_edit_patient_phone',
    'complaints_reassign',
    'complaints_renotify',
    'evidence_attach',
    'evidence_delete',
    'treatment_register',
    'patient_contact_register',
    'patient_treatment_manage',
    'nps_finish'
  ],
  supervisor_crc: [
    'complaints_view_all',
    'complaints_close',
    'complaints_reactivate',
    'complaints_change_unit',
    'complaints_edit_patient_phone',
    'complaints_reassign',
    'complaints_renotify',
    'evidence_attach',
    'evidence_delete',
    'treatment_register',
    'patient_contact_register',
    'patient_treatment_manage',
    'nps_finish'
  ],
  crc_leader: [
    'whatsapp_config_manage',
    'whatsapp_template_delete',
    'whatsapp_chatbot_delete',
    'whatsapp_antiban_manage'
  ],
  crc_manager: [
    'whatsapp_config_manage',
    'whatsapp_template_delete',
    'whatsapp_chatbot_delete',
    'whatsapp_antiban_manage'
  ],
  crc_operator: [],
  manager: ['complaints_reassign', 'evidence_attach', 'evidence_delete', 'treatment_register'],
  coordinator: ['complaints_reassign', 'evidence_attach', 'evidence_delete', 'treatment_register'],
  viewer: ['complaints_view_all', 'complaints_change_unit', 'complaints_edit_patient_phone', 'evidence_attach']
};

const authorityRules = [
  { area: 'Protocolos', action: 'Visualizar todas as demandas', actionPermission: 'complaints_view_all', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'viewer'], note: 'Gerente e coordenador dependem das clinicas vinculadas e/ou atribuicao da demanda.' },
  { area: 'Protocolos', action: 'Cadastrar protocolo', permission: 'complaints_register', roles: ['master_admin', 'admin', 'sac_operator'], note: 'Liberado por permissao de tela de cadastro.' },
  { area: 'Protocolos', action: 'Fechar protocolo', actionPermission: 'complaints_close', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator'], note: 'Coordenador, gerente e marketing nao finalizam protocolo.' },
  { area: 'Protocolos', action: 'Reabilitar protocolo finalizado/cancelado', actionPermission: 'complaints_reactivate', roles: ['master_admin', 'supervisor_crc'], note: 'Exige justificativa operacional.' },
  { area: 'Protocolos', action: 'Alterar unidade cadastrada', actionPermission: 'complaints_change_unit', roles: ['master_admin', 'supervisor_crc', 'sac_operator', 'viewer'], note: 'Marketing segue a mesma alçada operacional do Operador de SAC para corrigir unidade na ficha.' },
  { area: 'Protocolos', action: 'Alterar telefone do paciente', actionPermission: 'complaints_edit_patient_phone', roles: ['master_admin', 'supervisor_crc', 'sac_operator', 'viewer'], note: 'Marketing segue a mesma alçada operacional do Operador de SAC para corrigir telefone na ficha.' },
  { area: 'Protocolos', action: 'Encaminhar/reencaminhar demanda', actionPermission: 'complaints_reassign', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'coordinator', 'manager'], note: 'Coordenador e gerente devolvem ao Operador de SAC.' },
  { area: 'Protocolos', action: 'Notificar responsaveis novamente', actionPermission: 'complaints_renotify', roles: ['master_admin', 'supervisor_crc', 'sac_operator'], note: 'Reenvio manual de e-mail/WhatsApp quando permitido.' },
  { area: 'Evidencias', action: 'Anexar evidencias', actionPermission: 'evidence_attach', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'coordinator', 'manager', 'viewer'], note: 'Marketing pode anexar, mas sem alcadas de fechamento.' },
  { area: 'Evidencias', action: 'Excluir evidencias', actionPermission: 'evidence_delete', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'coordinator', 'manager'], note: 'Marketing nao exclui evidencias; exclusao deve preservar lastro.' },
  { area: 'Tratativas', action: 'Registrar tratativa', actionPermission: 'treatment_register', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'coordinator', 'manager'], note: 'Coordenador e gerente devem relatar antes de registrar contato com paciente.' },
  { area: 'Tratativas', action: 'Registrar contato com paciente', actionPermission: 'patient_contact_register', roles: ['master_admin', 'supervisor_crc', 'sac_operator'], note: 'Regra principal do atendimento SAC/CRC.' },
  { area: 'Tratamento do paciente', action: 'Cadastrar tratamento/agendamento', actionPermission: 'patient_treatment_manage', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator'], note: 'Dados alimentam a gestao de pacientes e agenda da Home.' },
  { area: 'NPS', action: 'Gerir registros NPS', permission: 'nps_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'manager', 'coordinator', 'viewer'], note: 'Controle principal por permissao de tela.' },
  { area: 'NPS', action: 'Finalizar NPS', actionPermission: 'nps_finish', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator'], note: 'Botao de finalizar fica restrito a perfis operacionais.' },
  { area: 'Excluidos', action: 'Visualizar aba excluidos', actionPermission: 'deleted_view', roles: ['master_admin'], note: 'Exclusivo do Administrador Master.' },
  { area: 'Relatorios', action: 'Relatorio semanal de reclamacoes', permission: 'complaints_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'manager'], note: 'Depende tambem de acesso ao painel de gestao de reclamacoes.' },
  { area: 'Financeiro CRC', action: 'Dashboard executivo', permission: 'financial_dashboard', roles: ['master_admin', 'admin'], note: 'Visao de diretoria.' },
  { area: 'Financeiro CRC', action: 'Unidade x campanha', permission: 'financial_campaigns', roles: ['master_admin', 'admin', 'supervisor_crc', 'manager'], note: 'Analise por unidade/campanha.' },
  { area: 'Financeiro CRC', action: 'Gestao financeira e lancamentos', permission: 'financial_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'manager'], note: 'Permite lancar/editar dados conforme perfil.' },
  { area: 'Financeiro CRC', action: 'Excluir lancamento financeiro', actionPermission: 'financial_record_delete', roles: ['master_admin'], note: 'Exclusao definitiva restrita ao Master.' },
  { area: 'Financeiro CRC', action: 'Excluir colaborador CRC', actionPermission: 'financial_collaborator_delete', roles: ['master_admin'], note: 'Preserva a base do ROI.' },
  { area: 'WhatsApp CRC', action: 'Acessar central WhatsApp', permission: 'whatsapp_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager', 'crc_operator'], note: 'Central operacional, cadastro de números, mensagens, chatbot e relatórios.' },
  { area: 'WhatsApp CRC', action: 'Configurar whatsapp-service VPS', permission: 'whatsapp_settings', actionPermission: 'whatsapp_config_manage', roles: ['master_admin'], note: 'URL do serviço, API Key, teste de conexão e anti-ban ficam em tela segura.' },
  { area: 'WhatsApp CRC', action: 'Excluir instâncias', actionPermission: 'whatsapp_instance_delete', roles: ['master_admin'], note: 'Exclusão operacional de números conectados.' },
  { area: 'WhatsApp CRC', action: 'Excluir mensagens padrão', actionPermission: 'whatsapp_template_delete', roles: ['master_admin', 'crc_leader', 'crc_manager'], note: 'Mantém biblioteca limpa sem liberar exclusão ampla.' },
  { area: 'WhatsApp CRC', action: 'Excluir fluxos de chatbot', actionPermission: 'whatsapp_chatbot_delete', roles: ['master_admin', 'crc_leader', 'crc_manager'], note: 'Controle dos fluxos automáticos.' },
  { area: 'WhatsApp CRC', action: 'Alterar parametros anti-ban', actionPermission: 'whatsapp_antiban_manage', roles: ['master_admin'], note: 'Delay, limite por minuto, tentativas e fila automatica.' },
  { area: 'Painel Gerencial', action: 'Acessar Centro Master e administracao', permission: 'admin_panel', roles: ['master_admin'], note: 'Apenas Administrador Master altera usuarios e permissoes.' }
];

const routeControls = [
  { area: 'Home', type: 'Caminho', title: 'Home', path: '/home', permission: 'home', note: 'Tela inicial do sistema.' },
  { area: 'Home', type: 'Caminho', title: 'Minha conta', path: '/perfil', permission: 'home', note: 'Dados do proprio usuario.' },
  { area: 'Protocolos', type: 'Caminho', title: 'Novo protocolo', path: '/cadastro', permission: 'complaints_register', note: 'Cadastro de nova reclamacao/demanda.' },
  { area: 'Protocolos', type: 'Caminho', title: 'Painel de gestao de reclamacoes', path: '/gestao', permission: 'complaints_management', note: 'Lista, filtros e abas de reclamacoes.' },
  { area: 'Protocolos', type: 'Caminho', title: 'Ficha executiva do protocolo', path: '/gestao/:id', permission: 'complaints_management', note: 'Abertura da demanda, evidencias e tratativas.' },
  { area: 'Protocolos', type: 'Caminho', title: 'Relatorio semanal', path: '/gestao/relatorio-semanal', permission: 'complaints_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'manager'], note: 'Relatorio semanal das reclamacoes.' },
  { area: 'Dashboards', type: 'Caminho', title: 'Dashboard de reclamacoes', path: '/dashboard', permission: 'complaints_dashboard', note: 'Indicadores gerenciais de reclamacoes.' },
  { area: 'Dashboards', type: 'Caminho', title: 'BI de reclamacoes', path: '/bi', permission: 'complaints_dashboard', note: 'Analises complementares.' },
  { area: 'NPS', type: 'Caminho', title: 'Painel de gestao NPS', path: '/gestao-nps', permission: 'nps_management', note: 'Gestao dos registros NPS.' },
  { area: 'NPS', type: 'Caminho', title: 'Dashboard NPS', path: '/dashboard-nps', permission: 'nps_dashboard', note: 'Indicadores de NPS.' },
  { area: 'Pacientes', type: 'Caminho', title: 'Gestao do paciente', path: '/pacientes', permission: 'patient_management', note: 'Pacientes oriundos de reclamacoes e tratamentos.' },
  { area: 'Pacientes', type: 'Caminho', title: 'Cadastro de paciente', path: '/pacientes/cadastro', permission: 'patient_management', note: 'Entrada operacional de paciente.' },
  { area: 'Pacientes', type: 'Caminho', title: 'Dashboard do paciente', path: '/pacientes/dashboard', permission: 'patient_management', note: 'Agenda e acompanhamento de pacientes.' },
  { area: 'CRM', type: 'Caminho', title: 'CRM de relacionamento', path: '/crm', permission: 'crm_relationship', note: 'Relacionamento e acompanhamento comercial.' },
  { area: 'Financeiro CRC', type: 'Caminho', title: 'Dashboard executivo CRC', path: '/home/financial-intelligence', permission: 'financial_dashboard', roles: ['master_admin', 'admin'], note: 'Visao financeira executiva.' },
  { area: 'Financeiro CRC', type: 'Caminho', title: 'Unidade x campanha', path: '/home/financial-intelligence/campaigns', permission: 'financial_campaigns', roles: ['master_admin', 'admin', 'supervisor_crc', 'manager'], note: 'Analise por unidade e campanha.' },
  { area: 'Financeiro CRC', type: 'Caminho', title: 'Gestao financeira CRC', path: '/home/financial-intelligence/manage', permission: 'financial_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'manager'], note: 'Lancamentos, edicoes e despesas mensais.' },
  { area: 'Financeiro CRC', type: 'Caminho', title: 'Gestao de colaboradores CRC', path: '/home/financial-intelligence/manage/collaborators', permission: 'financial_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'manager'], note: 'Cadastro e custos dos colaboradores.' },
  { area: 'Financeiro CRC', type: 'Caminho', title: 'Detalhe do lancamento financeiro', path: '/home/financial-intelligence/manage/:id', permission: 'financial_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'manager'], note: 'Analise individual do lancamento.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Gestao WhatsApp CRC', path: '/home/whatsapp-management/dashboard', permission: 'whatsapp_management', roles: ['master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager', 'crc_operator'], note: 'Central de atendimento, envio, chatbot e relatorios.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Dashboard WhatsApp', path: '/home/whatsapp-management/dashboard', permission: 'whatsapp_dashboard', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager'], note: 'Métricas por operador, clínica, número e fila.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Cadastro de Número WhatsApp', path: '/home/whatsapp-management/instances', permission: 'whatsapp_instances', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager'], note: 'Conexão, QR Code e manutenção de números.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Atendimento WhatsApp', path: '/home/whatsapp-management/attendance', permission: 'whatsapp_attendance', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'crc_operator'], note: 'Fila e conversa operacional.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Envio manual WhatsApp', path: '/home/whatsapp-management/send', permission: 'whatsapp_send', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'crc_operator'], note: 'Disparo individual com histórico.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Mensagens padrão', path: '/home/whatsapp-management/templates', permission: 'whatsapp_templates', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'crc_operator'], note: 'Biblioteca de textos operacionais.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Chatbot WhatsApp', path: '/home/whatsapp-management/chatbot', permission: 'whatsapp_chatbot', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'crc_operator'], note: 'Fluxos, gatilhos e mensagens automáticas.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Pacientes ausentes', path: '/home/whatsapp-management/absent', permission: 'whatsapp_absent', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'crc_operator'], note: 'Retorno e recuperação.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Histórico WhatsApp', path: '/home/whatsapp-management/history', permission: 'whatsapp_history', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager', 'crc_operator'], note: 'Auditoria de mensagens.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Relatórios WhatsApp', path: '/home/whatsapp-management/reports', permission: 'whatsapp_reports', roles: ['master_admin', 'admin', 'supervisor_crc', 'crc_leader', 'crc_manager'], note: 'Exportações e indicadores.' },
  { area: 'WhatsApp CRC', type: 'Caminho', title: 'Configurações WhatsApp', path: '/home/whatsapp-management/settings', permission: 'whatsapp_settings', roles: ['master_admin'], masterOnly: true, note: 'whatsapp-service VPS, anti-ban, status e diagnóstico.' },
  { area: 'Painel Gerencial', type: 'Caminho', title: 'Gestao de usuarios', path: '/admin', permission: 'admin_panel', roles: ['master_admin'], masterOnly: true, note: 'Administracao de usuarios.' },
  { area: 'Painel Gerencial', type: 'Caminho', title: 'Centro Master do Sistema', path: '/admin/controle-master', permission: 'admin_panel', roles: ['master_admin'], masterOnly: true, note: 'Controle completo de autorizacoes.' },
  { area: 'Painel Gerencial', type: 'Caminho', title: 'Configurações > WhatsApp', path: '/home/whatsapp-management/instances', permission: 'whatsapp_management', roles: ['master_admin'], masterOnly: true, note: 'Sessões do whatsapp-service, QR Code, status e mensagens de teste em tela única.' },
  { area: 'Painel Gerencial', type: 'Caminho', title: 'Monitoria Master', path: '/admin/monitoria', permission: 'admin_panel', roles: ['master_admin'], masterOnly: true, note: 'Monitoramento operacional.' }
];

const actionControls = authorityRules.map((rule) => ({
  area: rule.area,
  type: 'Botao/acao',
  title: rule.action,
  path: rule.action,
  permission: rule.permission,
  actionPermission: rule.actionPermission,
  roles: rule.roles,
  note: rule.note
}));

const accessControls = [...routeControls, ...actionControls];

function toNumber(value) {
  const parsed = Number(String(value || 0).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function permissionCategory(permission) {
  return permissionGroups.find((group) => group.match(permission.value)) || {
    key: 'other',
    title: 'Outras permissoes'
  };
}

function normalizeClinicIds(user = {}) {
  if (Array.isArray(user.clinicIds)) {
    return user.clinicIds.map((id) => String(id));
  }

  if (Array.isArray(user.clinics)) {
    return user.clinics
      .map((clinic) => clinic.clinic_id || clinic.id)
      .filter(Boolean)
      .map((id) => String(id));
  }

  return [];
}

function normalizeUser(user = {}) {
  return {
    ...user,
    active: Boolean(user.active),
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    actionPermissions: Array.isArray(user.actionPermissions) ? user.actionPermissions : (defaultRoleActionPermissions[user.role] || []),
    clinicIds: normalizeClinicIds(user)
  };
}

function normalizeTaxComponentsForView(settings = {}) {
  const current = Array.isArray(settings.taxComponents) ? settings.taxComponents : [];
  return defaultTaxComponents.map((item) => {
    const saved = current.find((component) => component.key === item.key) || {};
    return {
      ...item,
      label: saved.label || item.label,
      percent: saved.percent ?? item.percent
    };
  });
}

function roleLabel(value) {
  return roleOptions.find((role) => role.value === value)?.label || value || 'Perfil nao definido';
}

function controlPermissionLabel(permission) {
  return screenPermissions.find((item) => item.value === permission)?.label
    || actionPermissions.find((item) => item.value === permission)?.label
    || permission
    || 'Alcada por perfil';
}

function userCanAccessControl(user, control) {
  if (!user || !user.active) return false;
  if (isMasterAdmin(user)) return true;
  if (control.masterOnly) return false;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const permissionAllowed = !control.permission
    || control.permission === 'home'
    || user.role === 'admin'
    || permissions.includes(control.permission);
  const roleAllowed = !Array.isArray(control.roles) || control.roles.includes(user.role);
  const actionAllowed = !control.actionPermission || hasActionPermission(user, control.actionPermission);

  return permissionAllowed && roleAllowed && actionAllowed;
}

function MasterControlCenter() {
  const navigate = useNavigate();
  const currentUser = useMemo(() => readUser(), []);
  const [users, setUsers] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedProfile, setSelectedProfile] = useState('supervisor_crc');
  const [profilePermissionDraft, setProfilePermissionDraft] = useState(() => ({ ...defaultRolePermissions }));
  const [profileActionDraft, setProfileActionDraft] = useState(() => ({ ...defaultRoleActionPermissions }));
  const [activeTab, setActiveTab] = useState('users');
  const [filters, setFilters] = useState({ search: '', role: '', status: '' });
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [clearingTests, setClearingTests] = useState(false);

  const permissionsByGroup = useMemo(() => {
    const grouped = new Map();
    screenPermissions.forEach((permission) => {
      const group = permissionCategory(permission);
      const current = grouped.get(group.key) || { ...group, permissions: [] };
      current.permissions.push(permission);
      grouped.set(group.key, current);
    });
    return Array.from(grouped.values());
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setFeedback('');

    try {
      const [usersRes, settingsRes, collaboratorsRes, clinicsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/financial-settings'),
        api.get('/crc-collaborators'),
        api.get('/clinics').catch(() => ({ data: [] }))
      ]);
      const loadedUsers = Array.isArray(usersRes.data) ? usersRes.data.map(normalizeUser) : [];
      setUsers(loadedUsers);
      setSettings(settingsRes.data || null);
      setCollaborators(Array.isArray(collaboratorsRes.data) ? collaboratorsRes.data : []);
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
      setSelectedUserId((current) => current || loadedUsers[0]?.id || '');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel carregar o Centro Master.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isMasterAdmin(currentUser)) {
      navigate('/home');
      return;
    }
    loadData();
  }, [currentUser, loadData, navigate]);

  const filteredUsers = useMemo(() => users.filter((user) => {
    const text = [user.name, user.email, user.role, user.position, user.department].join(' ').toLowerCase();
    const searchOk = !filters.search || text.includes(filters.search.toLowerCase());
    const roleOk = !filters.role || user.role === filters.role;
    const statusOk = !filters.status || (filters.status === 'active' ? user.active : !user.active);
    return searchOk && roleOk && statusOk;
  }), [filters, users]);

  const selectedUser = useMemo(
    () => users.find((user) => String(user.id) === String(selectedUserId)) || filteredUsers[0] || null,
    [filteredUsers, selectedUserId, users]
  );

  const selectedClinicIds = normalizeClinicIds(selectedUser || {});
  const selectedPermissionCount = selectedUser?.permissions?.length || 0;
  const selectedAccessStats = useMemo(() => {
    if (!selectedUser) return { released: 0, blocked: accessControls.length };
    const released = accessControls.filter((control) => userCanAccessControl(selectedUser, control)).length;
    return { released, blocked: accessControls.length - released };
  }, [selectedUser]);

  const selectedProfileUsers = useMemo(
    () => users.filter((user) => user.role === selectedProfile),
    [selectedProfile, users]
  );

  const selectedProfilePermissions = useMemo(
    () => profilePermissionDraft[selectedProfile] || ['home'],
    [profilePermissionDraft, selectedProfile]
  );
  const selectedProfileActionPermissions = useMemo(
    () => profileActionDraft[selectedProfile] || [],
    [profileActionDraft, selectedProfile]
  );
  const selectedProfileStats = useMemo(() => {
    const profileUser = {
      role: selectedProfile,
      active: true,
      permissions: selectedProfilePermissions,
      actionPermissions: selectedProfileActionPermissions
    };
    const released = accessControls.filter((control) => userCanAccessControl(profileUser, control)).length;
    return { released, blocked: accessControls.length - released };
  }, [selectedProfile, selectedProfilePermissions, selectedProfileActionPermissions]);

  const summary = useMemo(() => ({
    users: users.length,
    active: users.filter((user) => user.active).length,
    inactive: users.filter((user) => !user.active).length,
    master: users.filter((user) => user.role === 'master_admin').length,
    permissions: screenPermissions.length,
    clinics: clinics.length,
    collaborators: collaborators.length
  }), [clinics.length, collaborators.length, users]);

  const roleStats = useMemo(() => roleOptions.map((role) => {
    const roleUsers = users.filter((user) => user.role === role.value);
    return {
      ...role,
      users: roleUsers.length,
      active: roleUsers.filter((user) => user.active).length,
      defaultPermissions: defaultRolePermissions[role.value] || ['home']
    };
  }), [users]);

  const permissionStats = useMemo(() => screenPermissions.map((permission) => ({
    ...permission,
    users: users.filter((user) => Array.isArray(user.permissions) && user.permissions.includes(permission.value)).length
  })), [users]);

  const authorizationAlerts = useMemo(() => {
    const missingPhone = users.filter((user) => !String(user.phone || '').trim() || String(user.phone || '').trim() === defaultBrazilPhone);
    const missingWhatsapp = users.filter((user) => !String(user.whatsapp || '').trim() || String(user.whatsapp || '').trim() === defaultBrazilPhone);
    const inactiveWithPermissions = users.filter((user) => !user.active && Array.isArray(user.permissions) && user.permissions.length > 1);
    const leadershipWithoutClinic = users.filter((user) => ['coordinator', 'manager'].includes(user.role) && !normalizeClinicIds(user).length);

    return [
      { title: 'Usuarios sem telefone', value: missingPhone.length, detail: 'Impacta contato operacional e cadastro completo.' },
      { title: 'Usuarios sem WhatsApp', value: missingWhatsapp.length, detail: 'Impacta testes e notificacoes.' },
      { title: 'Inativos com permissoes', value: inactiveWithPermissions.length, detail: 'Revisar se devem ficar sem acesso.' },
      { title: 'Gerencia/coordenacao sem clinica', value: leadershipWithoutClinic.length, detail: 'Pode bloquear visao por unidade.' }
    ];
  }, [users]);

  const taxComponents = useMemo(() => normalizeTaxComponentsForView(settings || {}), [settings]);
  const totalTaxRate = useMemo(
    () => taxComponents.reduce((total, item) => total + toNumber(item.percent), 0),
    [taxComponents]
  );

  const patchUser = (userId, changes) => {
    setUsers((current) => current.map((user) => (
      String(user.id) === String(userId) ? { ...user, ...changes } : user
    )));
  };

  const buildUserPayload = (user, overrides = {}) => {
    const merged = { ...user, ...overrides };
    return {
      name: merged.name,
      email: merged.email,
      role: merged.role,
      position: merged.position,
      phone: merged.phone ? formatBrazilPhoneInput(merged.phone) : defaultBrazilPhone,
      whatsapp: merged.whatsapp ? formatBrazilPhoneInput(merged.whatsapp) : defaultBrazilPhone,
      department: merged.department,
      active: Boolean(merged.active),
      permissions: merged.permissions || [],
      actionPermissions: merged.actionPermissions || [],
      clinicIds: normalizeClinicIds(merged)
    };
  };

  const toggleUserPermission = (userId, permission) => {
    const user = users.find((item) => String(item.id) === String(userId));
    const permissions = new Set(Array.isArray(user?.permissions) ? user.permissions : []);
    permissions.has(permission) ? permissions.delete(permission) : permissions.add(permission);
    patchUser(userId, { permissions: Array.from(permissions) });
  };

  const toggleUserPermissionInstant = async (userId, permission) => {
    const user = users.find((item) => String(item.id) === String(userId));
    const permissions = new Set(Array.isArray(user?.permissions) ? user.permissions : []);
    permissions.has(permission) ? permissions.delete(permission) : permissions.add(permission);
    const nextPermissions = Array.from(permissions);
    patchUser(userId, { permissions: nextPermissions });
    setSavingUserId(String(userId));
    setFeedback('');

    try {
      await api.patch(`/admin/users/${userId}`, buildUserPayload(user, { permissions: nextPermissions }));
      setFeedback('Liberacao aplicada instantaneamente.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel aplicar a liberacao.');
      await loadData();
    } finally {
      setSavingUserId('');
    }
  };

  const toggleUserActionPermission = async (userId, permission) => {
    const user = users.find((item) => String(item.id) === String(userId));
    const permissions = new Set(Array.isArray(user?.actionPermissions) ? user.actionPermissions : []);
    permissions.has(permission) ? permissions.delete(permission) : permissions.add(permission);
    const actionPermissions = Array.from(permissions);
    patchUser(userId, { actionPermissions });
    setSavingUserId(String(userId));
    setFeedback('');

    try {
      await api.patch(`/admin/users/${userId}`, buildUserPayload(user, { actionPermissions }));
      setFeedback('Botao/acao atualizado instantaneamente.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel atualizar o botao/acao.');
      await loadData();
    } finally {
      setSavingUserId('');
    }
  };

  const updateUserInstant = async (userId, changes, successMessage = 'Alteracao aplicada instantaneamente.') => {
    const user = users.find((item) => String(item.id) === String(userId));
    patchUser(userId, changes);
    setSavingUserId(String(userId));
    setFeedback('');

    try {
      await api.patch(`/admin/users/${userId}`, buildUserPayload(user, changes));
      setFeedback(successMessage);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel aplicar a alteracao.');
      await loadData();
    } finally {
      setSavingUserId('');
    }
  };

  const toggleClinic = (userId, clinicId) => {
    const user = users.find((item) => String(item.id) === String(userId));
    const ids = new Set(normalizeClinicIds(user));
    const normalizedId = String(clinicId);
    ids.has(normalizedId) ? ids.delete(normalizedId) : ids.add(normalizedId);
    patchUser(userId, { clinicIds: Array.from(ids) });
  };

  const applyAllPermissions = (userId) => {
    patchUser(userId, { permissions: screenPermissions.map((permission) => permission.value) });
  };

  const clearPermissions = (userId) => {
    patchUser(userId, { permissions: ['home'] });
  };

  const applyAllPermissionsInstant = async (userId) => {
    const user = users.find((item) => String(item.id) === String(userId));
    const permissions = screenPermissions.map((permission) => permission.value);
    patchUser(userId, { permissions });
    setSavingUserId(String(userId));
    setFeedback('');

    try {
      await api.patch(`/admin/users/${userId}`, buildUserPayload(user, { permissions }));
      setFeedback('Todas as telas foram liberadas instantaneamente.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel liberar todas as telas.');
      await loadData();
    } finally {
      setSavingUserId('');
    }
  };

  const clearPermissionsInstant = async (userId) => {
    const user = users.find((item) => String(item.id) === String(userId));
    const permissions = ['home'];
    patchUser(userId, { permissions });
    setSavingUserId(String(userId));
    setFeedback('');

    try {
      await api.patch(`/admin/users/${userId}`, buildUserPayload(user, { permissions }));
      setFeedback('Telas bloqueadas instantaneamente. Home mantida.');
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel bloquear as telas.');
      await loadData();
    } finally {
      setSavingUserId('');
    }
  };

  const toggleProfilePermission = (role, permission) => {
    setProfilePermissionDraft((current) => {
      const permissions = new Set(current[role] || ['home']);
      permissions.has(permission) ? permissions.delete(permission) : permissions.add(permission);
      permissions.add('home');
      return { ...current, [role]: Array.from(permissions) };
    });
  };

  const toggleProfileActionPermission = (role, permission) => {
    setProfileActionDraft((current) => {
      const permissions = new Set(current[role] || []);
      permissions.has(permission) ? permissions.delete(permission) : permissions.add(permission);
      return { ...current, [role]: Array.from(permissions) };
    });
  };

  const applyAllProfilePermissions = (role) => {
    setProfilePermissionDraft((current) => ({
      ...current,
      [role]: screenPermissions.map((permission) => permission.value)
    }));
  };

  const applyAllProfileActionPermissions = (role) => {
    setProfileActionDraft((current) => ({
      ...current,
      [role]: actionPermissions.map((permission) => permission.value)
    }));
  };

  const clearProfilePermissions = (role) => {
    setProfilePermissionDraft((current) => ({ ...current, [role]: ['home'] }));
  };

  const clearProfileActionPermissions = (role) => {
    setProfileActionDraft((current) => ({ ...current, [role]: [] }));
  };

  const applyProfileToUsers = async (role) => {
    const roleUsers = users.filter((user) => user.role === role);
    const permissions = profilePermissionDraft[role] || ['home'];
    const actionPermissions = profileActionDraft[role] || [];

    if (!roleUsers.length) {
      setFeedback(`Nenhum usuario encontrado no perfil ${roleLabel(role)}.`);
      return;
    }

    if (!window.confirm(`Aplicar este modelo de permissoes para ${roleUsers.length} usuario(s) do perfil ${roleLabel(role)}?`)) return;

    setSavingUserId(`profile:${role}`);
    setFeedback('');

    try {
      await Promise.all(roleUsers.map((user) => api.patch(`/admin/users/${user.id}`, {
        ...buildUserPayload(user, { permissions, actionPermissions })
      })));
      setFeedback(`Modelo do perfil ${roleLabel(role)} aplicado em ${roleUsers.length} usuario(s).`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel aplicar o modelo do perfil.');
    } finally {
      setSavingUserId('');
    }
  };

  const saveUser = async (user) => {
    setSavingUserId(String(user.id));
    setFeedback('');

    try {
      await api.patch(`/admin/users/${user.id}`, buildUserPayload(user));
      setFeedback(`Usuario ${user.name} atualizado com sucesso.`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel salvar o usuario.');
    } finally {
      setSavingUserId('');
    }
  };

  const updateSetting = (field, value) => {
    setSettings((current) => ({ ...current, [field]: value }));
  };

  const updateTaxComponent = (key, value) => {
    setSettings((current) => {
      const components = normalizeTaxComponentsForView(current).map((item) => (
        item.key === key ? { ...item, percent: value } : item
      ));
      const taxRatePercent = components.reduce((total, item) => total + toNumber(item.percent), 0);
      return { ...current, taxComponents: components, taxRatePercent };
    });
  };

  const updateMargin = (key, field, value) => {
    setSettings((current) => ({
      ...current,
      expectedMargins: {
        ...(current?.expectedMargins || {}),
        [key]: {
          ...(current?.expectedMargins?.[key] || {}),
          [field]: value
        }
      }
    }));
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setFeedback('');

    try {
      const payload = {
        ...settings,
        crcRoiExcellent: toNumber(settings?.crcRoiExcellent),
        netMarginHealthyMin: toNumber(settings?.netMarginHealthyMin),
        selicComparisonTolerance: toNumber(settings?.selicComparisonTolerance),
        taxComponents: normalizeTaxComponentsForView(settings).map((item) => ({
          ...item,
          percent: toNumber(item.percent)
        })),
        taxRatePercent: normalizeTaxComponentsForView(settings).reduce((total, item) => total + toNumber(item.percent), 0),
        costAllocationPercent: toNumber(settings?.costAllocationPercent)
      };
      const { data } = await api.put('/admin/financial-settings', payload);
      setSettings(data);
      setFeedback('Regras financeiras atualizadas.');
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel salvar as regras financeiras.');
    } finally {
      setSavingSettings(false);
    }
  };

  const clearFinancialTests = async () => {
    if (!window.confirm('Confirma remover definitivamente registros financeiros marcados como teste ou ja excluidos?')) return;
    setClearingTests(true);
    setFeedback('');

    try {
      const { data } = await api.post('/admin/financial-maintenance/clear-test-records');
      setFeedback(`${data.deleted || 0} registro(s) de teste removidos definitivamente.`);
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel limpar os registros de teste.');
    } finally {
      setClearingTests(false);
    }
  };

  const deleteCollaborator = async (collaborator) => {
    if (!window.confirm(`Confirma excluir o colaborador ${collaborator.name}?`)) return;
    setFeedback('');

    try {
      await api.delete(`/crc-collaborators/${collaborator.id}`);
      setFeedback(`Colaborador ${collaborator.name} excluido.`);
      await loadData();
    } catch (error) {
      setFeedback(error.response?.data?.error || 'Nao foi possivel excluir o colaborador.');
    }
  };

  if (!isMasterAdmin(currentUser)) return null;

  return (
    <main className="app-page master-control-page master-console-page">
      <header className="page-heading master-console-heading">
        <div>
          <p className="eyebrow">Painel Gerencial</p>
          <h1>Centro Master do Sistema</h1>
          <p>Controle executivo de usuarios, permissoes, clinicas, rotinas administrativas e regras financeiras do sistema.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-action" onClick={() => navigate('/admin')}>Gestao de usuarios</button>
          <button className="outline-action" onClick={() => navigate('/home')}>Home</button>
        </div>
      </header>

      {feedback && <p className="form-feedback admin-feedback master-console-feedback">{feedback}</p>}
      {loading && <section className="management-panel master-console-shell"><p className="empty-state">Carregando Centro Master...</p></section>}

      {!loading && (
        <section className="master-console-shell">
          <div className="master-console-summary">
            <article><span>Usuarios</span><strong>{summary.users}</strong><small>{summary.active} ativos</small></article>
            <article><span>Perfis Master</span><strong>{summary.master}</strong><small>{summary.inactive} inativos</small></article>
            <article><span>Telas controladas</span><strong>{summary.permissions}</strong><small>Autorizacao por usuario</small></article>
            <article><span>Clinicas</span><strong>{summary.clinics}</strong><small>Vinculo operacional</small></article>
            <article><span>Colaboradores CRC</span><strong>{summary.collaborators}</strong><small>Base financeira</small></article>
          </div>

          {selectedUser && (
            <div className="master-selected-strip">
              <article>
                <span>Usuario em edicao</span>
                <strong>{selectedUser.name}</strong>
                <small>{selectedUser.email}</small>
              </article>
              <article>
                <span>Perfil</span>
                <strong>{roleLabel(selectedUser.role)}</strong>
                <small>{selectedUser.position || selectedUser.department || 'Sem cargo informado'}</small>
              </article>
              <article>
                <span>Permissoes</span>
                <strong>{selectedPermissionCount}/{screenPermissions.length}</strong>
                <small>Telas liberadas</small>
              </article>
              <article>
                <span>Clinicas</span>
                <strong>{selectedClinicIds.length}</strong>
                <small>{selectedClinicIds.length ? 'Acesso limitado por unidade' : 'Sem clinica vinculada'}</small>
              </article>
            </div>
          )}

          <nav className="master-console-tabs" aria-label="Seções do Centro Master">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab === 'users' && (
            <section className="master-console-panel master-users-panel">
              <aside className="master-user-directory">
                <div className="master-section-heading">
                  <div>
                    <p className="eyebrow">Usuarios</p>
                    <h2>Lista de acesso</h2>
                  </div>
                </div>
                <div className="master-filter-stack">
                  <input className="field" placeholder="Buscar por nome, e-mail ou perfil" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
                  <select className="field" value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}>
                    <option value="">Todos os perfis</option>
                    {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                  <select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                    <option value="">Todos os status</option>
                    <option value="active">Ativos</option>
                    <option value="inactive">Inativos</option>
                  </select>
                </div>
                <div className="master-scroll-list">
                  {filteredUsers.map((user) => (
                    <button
                      type="button"
                      key={user.id}
                      className={`master-user-option ${String(selectedUser?.id) === String(user.id) ? 'selected' : ''}`}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                      <em>{roleLabel(user.role)} | {user.active ? 'Ativo' : 'Inativo'}</em>
                    </button>
                  ))}
                  {!filteredUsers.length && <p className="empty-state">Nenhum usuario encontrado.</p>}
                </div>
              </aside>

              {selectedUser && (
                <article className="master-user-workspace">
                  <div className="master-section-heading">
                    <div>
                      <p className="eyebrow">Cadastro e perfil</p>
                      <h2>{selectedUser.name}</h2>
                    </div>
                    <button className="primary-action" onClick={() => saveUser(selectedUser)} disabled={savingUserId === String(selectedUser.id)}>
                      {savingUserId === String(selectedUser.id) ? 'Salvando...' : 'Salvar usuario'}
                    </button>
                  </div>
                  <div className="master-form-grid">
                    <label>Nome<input className="field" value={selectedUser.name || ''} onChange={(event) => patchUser(selectedUser.id, { name: event.target.value })} /></label>
                    <label>E-mail<input className="field" value={selectedUser.email || ''} onChange={(event) => patchUser(selectedUser.id, { email: event.target.value })} /></label>
                    <label>Perfil<select className="field" value={selectedUser.role || ''} onChange={(event) => patchUser(selectedUser.id, { role: event.target.value })}>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                    <label>Status<select className="field" value={selectedUser.active ? 'active' : 'inactive'} onChange={(event) => patchUser(selectedUser.id, { active: event.target.value === 'active' })}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
                    <label>Cargo/Funcao<input className="field" value={selectedUser.position || ''} onChange={(event) => patchUser(selectedUser.id, { position: event.target.value })} /></label>
                    <label>Departamento<input className="field" value={selectedUser.department || ''} onChange={(event) => patchUser(selectedUser.id, { department: event.target.value })} /></label>
                    <label>Telefone<input className="field" value={selectedUser.phone || ''} onChange={(event) => patchUser(selectedUser.id, { phone: event.target.value })} /></label>
                    <label>WhatsApp<input className="field" value={selectedUser.whatsapp || ''} onChange={(event) => patchUser(selectedUser.id, { whatsapp: event.target.value })} /></label>
                  </div>
                </article>
              )}
            </section>
          )}

          {activeTab === 'permissions' && selectedUser && (
            <section className="master-console-panel master-permissions-panel">
              <div className="master-permission-command">
                <div>
                  <p className="eyebrow">Autorizacoes</p>
                  <h2>{selectedUser.name}</h2>
                  <p>Controle quais telas, botoes principais e areas operacionais ficam disponiveis para este usuario.</p>
                </div>
                <div className="master-command-actions">
                  <button className="outline-action" onClick={() => applyAllPermissions(selectedUser.id)}>Liberar tudo</button>
                  <button className="outline-action" onClick={() => clearPermissions(selectedUser.id)}>Somente Home</button>
                  <button className="primary-action" onClick={() => saveUser(selectedUser)} disabled={savingUserId === String(selectedUser.id)}>Salvar permissoes</button>
                </div>
              </div>

              <div className="master-permission-board">
                {permissionsByGroup.map((group) => (
                  <article className="master-permission-card" key={group.key}>
                    <header>
                      <strong>{group.title}</strong>
                      <span>{group.permissions.filter((permission) => selectedUser.permissions?.includes(permission.value)).length}/{group.permissions.length}</span>
                    </header>
                    <div>
                      {group.permissions.map((permission) => (
                        <label className="master-check-row" key={permission.value}>
                          <input
                            type="checkbox"
                            checked={Array.isArray(selectedUser.permissions) && selectedUser.permissions.includes(permission.value)}
                            onChange={() => toggleUserPermission(selectedUser.id, permission.value)}
                          />
                          <span>{permission.label}</span>
                        </label>
                      ))}
                    </div>
                  </article>
                ))}
              </div>

              <article className="master-clinic-card">
                <header>
                  <div>
                    <p className="eyebrow">Clinicas vinculadas</p>
                    <h2>Acesso por unidade</h2>
                    <p>Use para limitar a visualizacao operacional por clinica quando o perfil exigir esse controle.</p>
                  </div>
                </header>
                <div className="master-clinic-board">
                  {clinics.map((clinic) => (
                    <label className="master-check-row" key={clinic.id}>
                      <input
                        type="checkbox"
                        checked={normalizeClinicIds(selectedUser).includes(String(clinic.id))}
                        onChange={() => toggleClinic(selectedUser.id, clinic.id)}
                      />
                      <span>{clinic.name}</span>
                    </label>
                  ))}
                  {!clinics.length && <p className="empty-state">Nenhuma clinica encontrada.</p>}
                </div>
              </article>
            </section>
          )}

          {activeTab === 'releases' && (
            <section className="master-console-panel master-release-panel">
              <article className="master-profile-control">
                <div className="master-release-header">
                  <div>
                    <p className="eyebrow">Controle por perfil</p>
                    <h2>Modelo de acesso por cargo</h2>
                    <p>Defina o que cada perfil deve acessar e aplique o modelo nos usuarios daquele perfil. As telas sao gravadas como permissao real do usuario; os botoes por alcada seguem o perfil operacional exibido na matriz.</p>
                  </div>
                  <div className="master-release-actions">
                    <select className="field" value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)}>
                      {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                    <button className="outline-action" onClick={() => applyAllProfilePermissions(selectedProfile)}>Liberar telas do perfil</button>
                    <button className="outline-action" onClick={() => clearProfilePermissions(selectedProfile)}>Bloquear telas do perfil</button>
                    <button className="outline-action" onClick={() => applyAllProfileActionPermissions(selectedProfile)}>Liberar botoes</button>
                    <button className="outline-action" onClick={() => clearProfileActionPermissions(selectedProfile)}>Bloquear botoes</button>
                    <button className="primary-action" onClick={() => applyProfileToUsers(selectedProfile)} disabled={savingUserId === `profile:${selectedProfile}`}>
                      {savingUserId === `profile:${selectedProfile}` ? 'Aplicando...' : 'Aplicar aos usuarios'}
                    </button>
                  </div>
                </div>

                <div className="master-release-kpis">
                  <article><span>Perfil selecionado</span><strong>{roleLabel(selectedProfile)}</strong><small>{selectedProfileUsers.length} usuario(s) neste perfil</small></article>
                  <article><span>Telas liberadas</span><strong>{selectedProfilePermissions.length}/{screenPermissions.length}</strong><small>Modelo que sera aplicado</small></article>
                  <article><span>Botoes liberados</span><strong>{selectedProfileActionPermissions.length}/{actionPermissions.length}</strong><small>{selectedProfileStats.blocked} bloqueado(s) por perfil/permissao</small></article>
                </div>

                <div className="master-profile-grid">
                  <section className="master-profile-card">
                    <header>
                      <strong>Telas e caminhos do perfil</strong>
                      <span>{selectedProfilePermissions.length}/{screenPermissions.length}</span>
                    </header>
                    <div className="master-profile-scroll">
                      {screenPermissions.map((permission) => (
                        <label className="master-check-row" key={permission.value}>
                          <input
                            type="checkbox"
                            checked={permission.value === 'home' || selectedProfilePermissions.includes(permission.value)}
                            disabled={permission.value === 'home'}
                            onChange={() => toggleProfilePermission(selectedProfile, permission.value)}
                          />
                          <span>{permission.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="master-profile-card">
                    <header>
                      <strong>Botoes e acoes por perfil</strong>
                      <span>{selectedProfileActionPermissions.length}/{actionPermissions.length}</span>
                    </header>
                    <div className="master-profile-scroll">
                      {actionPermissions.map((permission) => {
                        const rule = authorityRules.find((item) => item.actionPermission === permission.value);
                        const allowed = selectedProfileActionPermissions.includes(permission.value);
                        const roleAllowed = !rule?.roles || rule.roles.includes(selectedProfile);
                        return (
                          <label className={`master-profile-action ${allowed ? 'allowed' : 'blocked'}`} key={permission.value}>
                            <strong>{permission.label}</strong>
                            <span>{permission.area}</span>
                            <small>{allowed ? 'Botao liberado no modelo' : 'Botao bloqueado no modelo'} | {roleAllowed ? 'Perfil compativel' : 'Perfil fora da alcada original'}</small>
                            <input
                              type="checkbox"
                              checked={allowed}
                              onChange={() => toggleProfileActionPermission(selectedProfile, permission.value)}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </article>

              <aside className="master-release-users">
                <div className="master-section-heading">
                  <div>
                    <p className="eyebrow">Liberar ou bloquear</p>
                    <h2>Usuarios</h2>
                    <p>Selecione um usuario para controlar telas, caminhos e botoes operacionais.</p>
                  </div>
                </div>

                <div className="master-filter-stack">
                  <input className="field" placeholder="Buscar usuario" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
                  <select className="field" value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}>
                    <option value="">Todos os perfis</option>
                    {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                  <select className="field" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                    <option value="">Todos os status</option>
                    <option value="active">Ativos</option>
                    <option value="inactive">Inativos</option>
                  </select>
                </div>

                <div className="master-release-user-list">
                  {filteredUsers.map((user) => {
                    const released = accessControls.filter((control) => userCanAccessControl(user, control)).length;
                    return (
                      <button
                        type="button"
                        key={user.id}
                        className={`master-release-user ${String(selectedUser?.id) === String(user.id) ? 'selected' : ''}`}
                        onClick={() => setSelectedUserId(user.id)}
                      >
                        <strong>{user.name}</strong>
                        <span>{roleLabel(user.role)}</span>
                        <small>{released}/{accessControls.length} liberacoes | {user.active ? 'Ativo' : 'Bloqueado'}</small>
                      </button>
                    );
                  })}
                  {!filteredUsers.length && <p className="empty-state">Nenhum usuario encontrado.</p>}
                </div>
              </aside>

              {selectedUser && (
                <article className="master-release-workspace">
                  <div className="master-release-header">
                    <div>
                      <p className="eyebrow">Matriz completa</p>
                      <h2>{selectedUser.name}</h2>
                      <p>Todos os caminhos e botoes conhecidos ficam listados aqui. Itens com permissao podem ser liberados direto; itens por alcada seguem o perfil operacional selecionado.</p>
                    </div>
                    <div className="master-release-actions">
                      <select className="field" value={selectedUser.role || ''} onChange={(event) => updateUserInstant(selectedUser.id, { role: event.target.value }, 'Perfil aplicado instantaneamente.')}>
                        {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                      </select>
                      <select className="field" value={selectedUser.active ? 'active' : 'inactive'} onChange={(event) => updateUserInstant(selectedUser.id, { active: event.target.value === 'active' }, 'Status aplicado instantaneamente.')}>
                        <option value="active">Usuario ativo</option>
                        <option value="inactive">Usuario bloqueado</option>
                      </select>
                      <button className="outline-action" onClick={() => applyAllPermissionsInstant(selectedUser.id)} disabled={savingUserId === String(selectedUser.id)}>Liberar telas</button>
                      <button className="outline-action" onClick={() => clearPermissionsInstant(selectedUser.id)} disabled={savingUserId === String(selectedUser.id)}>Bloquear telas</button>
                      <button className="primary-action" onClick={() => saveUser(selectedUser)} disabled={savingUserId === String(selectedUser.id)}>
                        {savingUserId === String(selectedUser.id) ? 'Salvando...' : 'Salvar liberacoes'}
                      </button>
                    </div>
                  </div>

                  <div className="master-release-kpis">
                    <article><span>Liberados</span><strong>{selectedAccessStats.released}</strong><small>Caminhos e botoes ativos</small></article>
                    <article><span>Bloqueados</span><strong>{selectedAccessStats.blocked}</strong><small>Pelo perfil, status ou permissao</small></article>
                    <article><span>Perfil atual</span><strong>{roleLabel(selectedUser.role)}</strong><small>{selectedUser.active ? 'Usuario ativo' : 'Usuario bloqueado'}</small></article>
                  </div>

                  <div className="master-release-board">
                    {accessControls.map((control) => {
                      const allowed = userCanAccessControl(selectedUser, control);
                      const editable = Boolean(control.permission) && !control.masterOnly && control.permission !== 'home';
                      const actionEditable = Boolean(control.actionPermission) && !control.masterOnly;
                      const checked = control.permission === 'home'
                        ? true
                        : Array.isArray(selectedUser.permissions) && selectedUser.permissions.includes(control.permission);
                      const actionChecked = Array.isArray(selectedUser.actionPermissions) && selectedUser.actionPermissions.includes(control.actionPermission);
                      return (
                        <article className={`master-release-card ${allowed ? 'allowed' : 'blocked'}`} key={`${control.type}-${control.area}-${control.path}`}>
                          <header>
                            <div>
                              <span>{control.area}</span>
                              <strong>{control.title}</strong>
                            </div>
                            <em className={allowed ? 'allowed' : 'blocked'}>{allowed ? 'Liberado' : 'Bloqueado'}</em>
                          </header>
                          <div className="master-release-meta">
                            <small>{control.type}</small>
                            <code>{control.path}</code>
                          </div>
                          <p>{control.note}</p>
                          <footer>
                            <small>{control.actionPermission ? controlPermissionLabel(control.actionPermission) : controlPermissionLabel(control.permission)}</small>
                            {actionEditable ? (
                              <label className="master-release-switch">
                                <input
                                  type="checkbox"
                                  checked={actionChecked}
                                  onChange={() => toggleUserActionPermission(selectedUser.id, control.actionPermission)}
                                  disabled={savingUserId === String(selectedUser.id)}
                                />
                                <span>{actionChecked ? 'Botao liberado' : 'Botao bloqueado'}</span>
                              </label>
                            ) : editable ? (
                              <label className="master-release-switch">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleUserPermissionInstant(selectedUser.id, control.permission)}
                                  disabled={savingUserId === String(selectedUser.id)}
                                />
                                <span>{checked ? 'Tela liberada' : 'Tela bloqueada'}</span>
                              </label>
                            ) : (
                              <span className="master-release-lock">{control.masterOnly ? 'Apenas Master' : 'Controlado por perfil'}</span>
                            )}
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                </article>
              )}
            </section>
          )}

          {activeTab === 'authority' && (
            <section className="master-console-panel master-authority-panel">
              <div className="master-section-heading">
                <div>
                  <p className="eyebrow">Alcadas operacionais</p>
                  <h2>Regras que exigem autorizacao</h2>
                  <p>Resumo das acoes sensiveis do sistema, perfis autorizados e dependencia de permissao de tela quando existir.</p>
                </div>
              </div>

              <div className="master-authority-grid">
                {authorityRules.map((rule) => (
                  <article className="master-authority-card" key={`${rule.area}-${rule.action}`}>
                    <header>
                      <span>{rule.area}</span>
                      {rule.permission && <em>{screenPermissions.find((item) => item.value === rule.permission)?.label || rule.permission}</em>}
                    </header>
                    <strong>{rule.action}</strong>
                    <div className="master-role-chip-list">
                      {rule.roles.map((role) => <small key={role}>{roleLabel(role)}</small>)}
                    </div>
                    <p>{rule.note}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'map' && (
            <section className="master-console-panel master-access-map-panel">
              <div className="master-section-heading">
                <div>
                  <p className="eyebrow">Mapa de acesso</p>
                  <h2>Perfis, permissoes e pontos de atencao</h2>
                  <p>Use esta visao para revisar rapidamente quem possui acesso, quais telas estao mais liberadas e onde falta dado operacional.</p>
                </div>
              </div>

              <div className="master-alert-grid">
                {authorizationAlerts.map((item) => (
                  <article key={item.title}>
                    <span>{item.title}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </article>
                ))}
              </div>

              <div className="master-map-grid">
                <article className="master-map-card">
                  <header>
                    <strong>Perfis cadastrados</strong>
                    <span>{users.length} usuario(s)</span>
                  </header>
                  <div className="master-map-scroll">
                    {roleStats.map((role) => (
                      <div className="master-map-row" key={role.value}>
                        <strong>{role.label}</strong>
                        <span>{role.active}/{role.users} ativos</span>
                        <small>{role.defaultPermissions.length} permissoes padrao</small>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="master-map-card">
                  <header>
                    <strong>Telas por quantidade de usuarios</strong>
                    <span>{screenPermissions.length} tela(s)</span>
                  </header>
                  <div className="master-map-scroll">
                    {permissionStats.map((permission) => (
                      <div className="master-map-row" key={permission.value}>
                        <strong>{permission.label}</strong>
                        <span>{permission.users} usuario(s)</span>
                        <small>{permission.value}</small>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="master-map-card wide">
                  <header>
                    <strong>Permissoes padrao por perfil</strong>
                    <span>Referencia para auditoria</span>
                  </header>
                  <div className="master-role-permission-grid">
                    {roleStats.map((role) => (
                      <section key={role.value}>
                        <strong>{role.label}</strong>
                        <div>
                          {role.defaultPermissions.map((permission) => (
                            <span key={permission}>{screenPermissions.find((item) => item.value === permission)?.label || permission}</span>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </article>
              </div>
            </section>
          )}

          {activeTab === 'system' && (
            <section className="master-console-panel master-system-panel">
              <article className="master-action-card">
                <div className="master-section-heading">
                  <div>
                    <p className="eyebrow">Rotina administrativa</p>
                    <h2>Acoes rapidas</h2>
                    <p>Acessos uteis para manutencao diaria, monitoria e auditoria operacional.</p>
                  </div>
                </div>
                <div className="master-action-grid">
                  <button className="outline-action" onClick={() => navigate('/admin/monitoria')}>Monitoria Master</button>
                  <button className="outline-action" onClick={() => navigate('/home/financial-intelligence')}>Dashboard Financeiro</button>
                  <button className="outline-action" onClick={() => navigate('/home/financial-intelligence/manage')}>Gestao Financeira</button>
                  <button className="outline-action danger-action" onClick={clearFinancialTests} disabled={clearingTests}>{clearingTests ? 'Limpando...' : 'Limpar testes financeiros'}</button>
                </div>
              </article>

              <article className="master-action-card">
                <div className="master-section-heading">
                  <div>
                    <p className="eyebrow">Colaboradores CRC</p>
                    <h2>Exclusao controlada</h2>
                    <p>Remocao restrita ao Administrador Master para preservar a base financeira.</p>
                  </div>
                </div>
                <div className="master-collaborator-scroll">
                  {collaborators.map((collaborator) => (
                    <div className="master-collaborator-row" key={collaborator.id}>
                      <strong>{collaborator.name}<small>{collaborator.function_name || 'Funcao nao informada'}</small></strong>
                      <button className="outline-action danger-action mini-action" onClick={() => deleteCollaborator(collaborator)}>Excluir</button>
                    </div>
                  ))}
                  {!collaborators.length && <p className="empty-state">Nenhum colaborador cadastrado.</p>}
                </div>
              </article>
            </section>
          )}

          {activeTab === 'financial' && settings && (
            <section className="master-console-panel master-financial-panel">
              <div className="master-section-heading">
                <div>
                  <p className="eyebrow">Regras de calculo</p>
                  <h2>Inteligencia Financeira CRC</h2>
                  <p>Parametros usados para status, diagnosticos, margens e comparativos do painel financeiro. A SELIC permanece travada em 15% ao ano.</p>
                </div>
                <button className="primary-action" onClick={saveSettings} disabled={savingSettings}>{savingSettings ? 'Salvando...' : 'Salvar regras'}</button>
              </div>

              <div className="master-financial-policy-box">
                <article className="master-tax-policy-card">
                  <span>Impostos</span>
                  <strong>{Number(totalTaxRate || 0).toFixed(2)}%</strong>
                  <small>Percentual consolidado aplicado sobre a receita. Edite cada tributo abaixo para atualizar o total automaticamente.</small>
                  <div className="master-tax-grid">
                    {taxComponents.map((tax) => (
                      <label key={tax.key}>
                        {tax.label}
                        <input className="field" type="number" step="0.01" min="0" value={tax.percent ?? ''} onChange={(event) => updateTaxComponent(tax.key, event.target.value)} />
                      </label>
                    ))}
                  </div>
                </article>
                <article>
                  <span>Rateio de custos</span>
                  <strong>{Number(settings.costAllocationPercent || 100).toFixed(2)}%</strong>
                  <small>Define quanto dos custos compartilhados entra no CRC. Preparado para novos departamentos.</small>
                  <label>Percentual de rateio do CRC (%)<input className="field" type="number" step="0.01" min="0" value={settings.costAllocationPercent ?? ''} onChange={(event) => updateSetting('costAllocationPercent', event.target.value)} /></label>
                </article>
              </div>

              <div className="master-form-grid compact">
                <label>ROI CRC excelente (%)<input className="field" type="number" step="0.01" value={settings.crcRoiExcellent ?? ''} onChange={(event) => updateSetting('crcRoiExcellent', event.target.value)} /></label>
                <label>Margem liquida minima (%)<input className="field" type="number" step="0.01" value={settings.netMarginHealthyMin ?? ''} onChange={(event) => updateSetting('netMarginHealthyMin', event.target.value)} /></label>
                <label>Tolerancia ROI vs SELIC (%)<input className="field" type="number" step="0.01" value={settings.selicComparisonTolerance ?? ''} onChange={(event) => updateSetting('selicComparisonTolerance', event.target.value)} /></label>
              </div>

              <div className="master-margin-board">
                {Object.entries(settings.expectedMargins || {}).map(([key, item]) => (
                  <article key={key}>
                    <strong>{item.label}</strong>
                    <label>Minimo<input className="field" type="number" step="0.01" value={item.min ?? ''} onChange={(event) => updateMargin(key, 'min', event.target.value)} /></label>
                    <label>Maximo<input className="field" type="number" step="0.01" value={item.max ?? ''} onChange={(event) => updateMargin(key, 'max', event.target.value)} /></label>
                  </article>
                ))}
              </div>
            </section>
          )}
        </section>
      )}
    </main>
  );
}

export default MasterControlCenter;
