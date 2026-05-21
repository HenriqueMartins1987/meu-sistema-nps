export const complaintTypes = [
  { value: 'sugestao', label: 'Sugestão' },
  { value: 'elogio', label: 'Elogio' },
  { value: 'pesquisa_satisfacao', label: 'Pesquisa de satisfação / NPS' },
  { value: 'atendimento_acolhimento', label: 'Atendimento e acolhimento' },
  { value: 'agendamento_espera', label: 'Agendamento, atraso ou tempo de espera' },
  { value: 'comunicacao_tratamento', label: 'Comunicação e explicação do tratamento' },
  { value: 'orcamento_cobranca', label: 'Orçamento, cobrança ou contrato' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'qualidade_tratamento', label: 'Qualidade do tratamento realizado' },
  { value: 'dor_complicacao', label: 'Dor, complicação ou pós-atendimento' },
  { value: 'resultado_expectativa', label: 'Resultado estético ou expectativa' },
  { value: 'higiene_estrutura', label: 'Higiene, biossegurança ou estrutura' },
  { value: 'documentacao_prontuario', label: 'Documentação, laudos ou prontuário' },
  { value: 'conduta_equipe', label: 'Conduta da equipe clínica' },
  { value: 'outros', label: 'Outros' }
];

export const serviceTypes = [
  { value: 'clinico_geral', label: 'Clínico geral' },
  { value: 'ortodontia', label: 'Ortodontia' },
  { value: 'implante', label: 'Implante' },
  { value: 'endodontia', label: 'Endodontia' },
  { value: 'protese', label: 'Prótese' },
  { value: 'estetica', label: 'Estética' },
  { value: 'cirurgia', label: 'Cirurgia' },
  { value: 'periodontia', label: 'Periodontia' },
  { value: 'radiologia', label: 'Radiologia' },
  { value: 'outros', label: 'Outros' }
];

export const channels = [
  { value: 'telefone', label: 'Telefone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'google', label: 'Google' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'reclame_aqui', label: 'Reclame Aqui' },
  { value: 'nps', label: 'NPS' },
  { value: 'presencial', label: 'Presencial' },
  { value: 'outros', label: 'Outros' }
];

export const statusOptions = [
  { value: 'aberta', label: 'Aberta' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'resolvida', label: 'Fechada' }
];

export const priorityOptions = [
  { value: 'baixa', label: 'Baixa', deadline: '72 horas' },
  { value: 'media', label: 'Média', deadline: '48 horas' },
  { value: 'alta', label: 'Alta', deadline: '24 horas' }
];

export const collaboratorPositions = [
  { value: 'operador_sac', label: 'Operador de SAC' },
  { value: 'supervisor_crc', label: 'Supervisor do CRC' },
  { value: 'coordenador_unidade', label: 'Coordenador de unidade' },
  { value: 'gerente_unidade', label: 'Gerente de unidade' },
  { value: 'gerente_regional', label: 'Gerente regional' },
  { value: 'qualidade_nps', label: 'Analista de Qualidade / NPS' },
  { value: 'recepcao_atendimento', label: 'Recepção / Atendimento' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'diretoria', label: 'Diretoria' },
  { value: 'outros', label: 'Outros' }
];

export const accessProfiles = [
  { value: 'admin', label: 'Administrador' },
  { value: 'sac_operator', label: 'Operador de SAC' },
  { value: 'supervisor_crc', label: 'Supervisor do CRC' },
  { value: 'crc_leader', label: 'Lider de CRC' },
  { value: 'crc_manager', label: 'Gerente de CRC' },
  { value: 'crc_operator', label: 'Operador de CRC' },
  { value: 'coordinator', label: 'Coordenador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'viewer', label: 'Marketing' }
];

export function normalizeRoleValue(role) {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const aliases = {
    administrador: 'admin',
    administrador_master: 'master_admin',
    master: 'master_admin',
    operador_sac: 'sac_operator',
    operador_de_sac: 'sac_operator',
    operador_crc: 'crc_operator',
    operador_de_crc: 'crc_operator',
    lider_crc: 'crc_leader',
    lider_de_crc: 'crc_leader',
    gerente_crc: 'crc_manager',
    gerente_de_crc: 'crc_manager',
    supervisor_crc: 'supervisor_crc',
    supervisor_de_crc: 'supervisor_crc',
    coordenador: 'coordinator',
    coordenador_unidade: 'coordinator',
    coordenador_de_unidade: 'coordinator',
    gerente: 'manager',
    gerente_unidade: 'manager',
    gerente_de_unidade: 'manager',
    marketing: 'viewer'
  };

  return aliases[normalized] || normalized;
}

export const screenPermissions = [
  { value: 'home', label: 'Home' },
  { value: 'complaints_register', label: 'Cadastro de protocolos' },
  { value: 'complaints_management', label: 'Painel de gestão de reclamações' },
  { value: 'complaints_dashboard', label: 'Dashboard de reclamações' },
  { value: 'nps_management', label: 'Painel de gestão NPS' },
  { value: 'nps_dashboard', label: 'Dashboard NPS' },
  { value: 'patient_management', label: 'Gestão do paciente' },
  { value: 'crm_relationship', label: 'CRM de relacionamento' },
  { value: 'financial_dashboard', label: 'Financeiro CRC - Dashboard executivo' },
  { value: 'financial_campaigns', label: 'Financeiro CRC - Unidade x Campanha' },
  { value: 'financial_management', label: 'Financeiro CRC - Gestão financeira' },
  { value: 'whatsapp_management', label: 'Gestão WhatsApp CRC' },
  { value: 'whatsapp_dashboard', label: 'WhatsApp CRC - Dashboard' },
  { value: 'whatsapp_instances', label: 'WhatsApp CRC - Cadastro de Número' },
  { value: 'whatsapp_attendance', label: 'WhatsApp CRC - Atendimento' },
  { value: 'whatsapp_send', label: 'WhatsApp CRC - Envio manual' },
  { value: 'whatsapp_templates', label: 'WhatsApp CRC - Mensagens padrão' },
  { value: 'whatsapp_chatbot', label: 'WhatsApp CRC - Chatbot' },
  { value: 'whatsapp_absent', label: 'WhatsApp CRC - Ausentes' },
  { value: 'whatsapp_history', label: 'WhatsApp CRC - Histórico' },
  { value: 'whatsapp_reports', label: 'WhatsApp CRC - Relatórios' },
  { value: 'whatsapp_settings', label: 'WhatsApp CRC - Configurações' },
  { value: 'admin_panel', label: 'Painel gerencial' }
];

export const actionPermissions = [
  { value: 'complaints_view_all', label: 'Visualizar todas as demandas', area: 'Protocolos' },
  { value: 'complaints_close', label: 'Fechar protocolo', area: 'Protocolos' },
  { value: 'complaints_reactivate', label: 'Reabilitar protocolo', area: 'Protocolos' },
  { value: 'complaints_change_unit', label: 'Alterar unidade', area: 'Protocolos' },
  { value: 'complaints_edit_patient_phone', label: 'Alterar telefone do paciente', area: 'Protocolos' },
  { value: 'complaints_reassign', label: 'Encaminhar/reencaminhar demanda', area: 'Protocolos' },
  { value: 'complaints_renotify', label: 'Notificar responsaveis', area: 'Protocolos' },
  { value: 'evidence_attach', label: 'Anexar evidencias', area: 'Evidencias' },
  { value: 'evidence_delete', label: 'Excluir evidencias', area: 'Evidencias' },
  { value: 'treatment_register', label: 'Registrar tratativa', area: 'Tratativas' },
  { value: 'patient_contact_register', label: 'Registrar contato com paciente', area: 'Tratativas' },
  { value: 'patient_treatment_manage', label: 'Cadastrar tratamento/agendamento', area: 'Tratamento do paciente' },
  { value: 'nps_finish', label: 'Finalizar NPS', area: 'NPS' },
  { value: 'deleted_view', label: 'Visualizar aba excluidos', area: 'Excluidos' },
  { value: 'financial_record_delete', label: 'Excluir lancamento financeiro', area: 'Financeiro CRC' },
  { value: 'financial_collaborator_delete', label: 'Excluir colaborador CRC', area: 'Financeiro CRC' },
  { value: 'whatsapp_config_manage', label: 'Configurar WhatsApp CRC', area: 'WhatsApp CRC' },
  { value: 'whatsapp_instance_delete', label: 'Excluir instancia WhatsApp', area: 'WhatsApp CRC' },
  { value: 'whatsapp_template_delete', label: 'Excluir mensagem padrao', area: 'WhatsApp CRC' },
  { value: 'whatsapp_chatbot_delete', label: 'Excluir fluxo chatbot', area: 'WhatsApp CRC' },
  { value: 'whatsapp_antiban_manage', label: 'Alterar anti-ban WhatsApp', area: 'WhatsApp CRC' }
];

export function defaultActionPermissionsForRole(role) {
  role = normalizeRoleValue(role);

  if (role === 'master_admin' || role === 'admin') {
    return actionPermissions.map((permission) => permission.value);
  }

  if (role === 'sac_operator') {
    return [
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
    ];
  }

  if (role === 'supervisor_crc') {
    return [
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
    ];
  }

  if (role === 'crc_leader' || role === 'crc_manager') {
    return [
      'whatsapp_config_manage',
      'whatsapp_template_delete',
      'whatsapp_chatbot_delete',
      'whatsapp_antiban_manage'
    ];
  }

  if (role === 'crc_operator') {
    return [];
  }

  if (role === 'manager' || role === 'coordinator') {
    return ['complaints_reassign', 'evidence_attach', 'evidence_delete', 'treatment_register'];
  }

  if (role === 'viewer') {
    return ['complaints_view_all', 'complaints_change_unit', 'complaints_edit_patient_phone', 'evidence_attach'];
  }

  return ['complaints_view_all', 'evidence_attach'];
}

export const statusLabels = statusOptions.reduce((labels, option) => {
  labels[option.value] = option.label;
  return labels;
}, {});

export const defaultBrazilPhone = '+55';
export const brazilPhonePattern = '\\+55\\d{11}';
export const brazilPhoneTitle = 'Informe o número completo no formato +55DDDNÚMERO, com 13 dígitos numéricos.';

const masterAdminEmail = 'henrique.martins@grcconsultoria.net.br';

export function formatBrazilPhoneInput(value) {
  let digits = String(value || '').replace(/\D/g, '');

  if (!digits.startsWith('55')) {
    digits = `55${digits}`;
  }

  return `+${digits.slice(0, 13)}`;
}

export function isCompleteBrazilPhone(value) {
  return /^\+55\d{11}$/.test(String(value || ''));
}

export function labelFrom(list, value) {
  return list.find((item) => item.value === value)?.label || value || 'Não informado';
}

export function readUser() {
  try {
    const parsed = JSON.parse(localStorage.getItem('user')) || null;

    if (parsed?.user && !parsed?.email && !parsed?.id) {
      return parsed.user;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

export function getUserDisplayName(user) {
  return String(user?.name || '').trim() || String(user?.email || '').trim() || 'Usuário';
}

export function isMasterAdmin(user) {
  const email = String(user?.email || '').toLowerCase();
  return normalizeRoleValue(user?.role) === 'master_admin' || email === masterAdminEmail;
}

export function isAdmin(user) {
  const email = String(user?.email || '').toLowerCase();
  const role = normalizeRoleValue(user?.role);
  return role === 'admin'
    || role === 'master_admin'
    || email === 'admin@sorria.com'
    || email === masterAdminEmail;
}

export function hasActionPermission(user, permission) {
  if (!user || !permission) return false;
  if (isMasterAdmin(user)) return true;
  const role = normalizeRoleValue(user.role);
  const fixedComplaintUnitAndPhoneRoles = ['sac_operator', 'viewer'];
  const fixedComplaintUnitAndPhonePermissions = [
    'complaints_change_unit',
    'complaints_edit_patient_phone'
  ];

  if (role === 'sac_operator' && defaultActionPermissionsForRole(role).includes(permission)) return true;
  if (fixedComplaintUnitAndPhoneRoles.includes(role) && fixedComplaintUnitAndPhonePermissions.includes(permission)) return true;

  const permissions = Array.isArray(user.actionPermissions) ? user.actionPermissions : defaultActionPermissionsForRole(user.role);
  return permissions.includes(permission);
}

export function hasPermission(user, permission) {
  if (!user || !permission) return false;
  if (isMasterAdmin(user)) return true;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const role = normalizeRoleValue(user.role);
  const sacOperatorDefaults = ['home', 'complaints_register', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'crm_relationship', 'whatsapp_management'];
  const crcLeaderDefaults = ['home', 'whatsapp_management', 'whatsapp_dashboard', 'whatsapp_instances', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history', 'whatsapp_reports'];
  const crcOperatorDefaults = ['home', 'whatsapp_management', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history'];

  if (['manager', 'coordinator', 'viewer'].includes(role) && permission.startsWith('whatsapp')) {
    return false;
  }

  if (role === 'crc_leader' || role === 'crc_manager') {
    return crcLeaderDefaults.includes(permission);
  }

  if (role === 'crc_operator') {
    return crcOperatorDefaults.includes(permission);
  }

  if (role === 'sac_operator' && sacOperatorDefaults.includes(permission)) {
    return true;
  }

  if (permission === 'admin_panel') {
    return false;
  }

  if (permission === 'home') {
    return true;
  }

  if (role === 'admin') {
    return true;
  }

  return permissions.includes(permission);
}
