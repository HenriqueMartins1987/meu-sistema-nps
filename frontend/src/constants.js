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
  { value: 'coordinator', label: 'Coordenador' },
  { value: 'manager', label: 'Gerente' },
  { value: 'viewer', label: 'Consulta' }
];

export const screenPermissions = [
  { value: 'home', label: 'Home' },
  { value: 'complaints_register', label: 'Cadastro de protocolos' },
  { value: 'complaints_management', label: 'Painel de gestão de reclamações' },
  { value: 'complaints_dashboard', label: 'Dashboard de reclamações' },
  { value: 'nps_management', label: 'Painel de gestão NPS' },
  { value: 'nps_dashboard', label: 'Dashboard NPS' },
  { value: 'patient_management', label: 'Gestão do paciente' },
  { value: 'admin_panel', label: 'Painel gerencial' }
];

export const statusLabels = statusOptions.reduce((labels, option) => {
  labels[option.value] = option.label;
  return labels;
}, {});

export const defaultBrazilPhone = '+55';
export const brazilPhonePattern = '\\+55\\d{11}';
export const brazilPhoneTitle = 'Informe o número completo no formato +55DDDNÚMERO, com 13 dígitos numéricos.';

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
    return JSON.parse(localStorage.getItem('user')) || null;
  } catch (error) {
    return null;
  }
}

export function isAdmin(user) {
  const email = String(user?.email || '').toLowerCase();
  return user?.role === 'admin'
    || user?.role === 'master_admin'
    || email === 'admin@sorria.com'
    || email === 'henrique.martins@grcconsultoria.net.br';
}

export function isMasterAdmin(user) {
  const email = String(user?.email || '').toLowerCase();
  return email === 'henrique.martins@grcconsultoria.net.br';
}

export function hasPermission(user, permission) {
  if (isAdmin(user)) return true;
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}
