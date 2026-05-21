const XLSX = require('xlsx');

const dentalCardStatuses = [
  'Novo Lead',
  'Contato IA iniciado',
  'Aguardando resposta',
  'Contato efetivo',
  'Em follow-up',
  'Agendado IA',
  'Agendado Joyce/CRC',
  'Confirmado',
  'Compareceu',
  'Faltou / No-show',
  'Reagendado',
  'Cancelado',
  'Pagou',
  'Nao pagou',
  'Encerrado',
  'Follow-up quinzenal'
];

const dentalCardTemplateSeeds = [
  {
    nome: 'Mensagem inicial',
    tipo: 'mensagem_inicial',
    mensagem: 'Ola, {{nome_lead}}! Tudo bem? Recebemos sua indicacao para o Programa Dental Card da unidade {{unidade}}. Posso ajudar a encontrar o melhor horario para sua avaliacao?'
  },
  {
    nome: 'Reforco 12h',
    tipo: 'reforco_12h',
    mensagem: 'Ola, {{nome_lead}}! Passando para confirmar se voce conseguiu ver nossa mensagem sobre o Dental Card. Posso te ajudar com o agendamento?'
  },
  {
    nome: 'Tentativa 36h',
    tipo: 'tentativa_36h',
    mensagem: 'Ola, {{nome_lead}}. Ainda temos disponibilidade para sua avaliacao Dental Card. Me avise o melhor horario para retornarmos.'
  },
  {
    nome: 'Tentativa 48h',
    tipo: 'tentativa_48h',
    mensagem: 'Ola, {{nome_lead}}. Esta e nossa ultima tentativa inicial de contato. Se ainda tiver interesse, seguimos a disposicao para agendar sua avaliacao.'
  },
  {
    nome: 'Confirmacao 1 dia antes',
    tipo: 'confirmacao_1_dia',
    mensagem: 'Ola, {{nome_lead}}! Confirmando sua avaliacao na unidade {{unidade}} em {{data_agendamento}} as {{hora_agendamento}}. Podemos contar com sua presenca?'
  },
  {
    nome: 'Lembrete 1h antes',
    tipo: 'lembrete_1h',
    mensagem: 'Ola, {{nome_lead}}! Sua avaliacao Dental Card sera em breve na unidade {{unidade}}. Estamos aguardando voce.'
  },
  {
    nome: 'Recuperacao de falta',
    tipo: 'recuperacao_falta',
    mensagem: 'Ola, {{nome_lead}}. Sentimos sua falta na avaliacao Dental Card. Posso reagendar para um horario melhor?'
  },
  {
    nome: 'Pos-atendimento',
    tipo: 'pos_atendimento',
    mensagem: 'Ola, {{nome_lead}}! Obrigado por comparecer. Sua opiniao e muito importante para melhorarmos nosso atendimento.'
  },
  {
    nome: 'Solicitacao de nova indicacao',
    tipo: 'nova_indicacao',
    mensagem: 'Ola, {{nome_lead}}! Caso conheca alguem que tambem precise de atendimento odontologico, ficaremos felizes em ajudar.'
  }
];

function normalizeDentalText(value, maxLength = 255) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeDentalKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeDentalPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55')) digits = `55${digits}`;
  return digits.slice(0, 13);
}

function toDentalNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value)
    .replace(/[R$\s]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDentalInteger(value) {
  return Math.max(0, Math.round(toDentalNumber(value)));
}

function toDentalBoolean(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'sim', 's', 'yes', 'true', 'ok', 'x'].includes(text) ? 1 : 0;
}

function normalizeDentalDate(value) {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  const text = String(value).trim();
  const br = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (br) {
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    return `${year}-${String(br[2]).padStart(2, '0')}-${String(br[1]).padStart(2, '0')}`;
  }

  const parsedDate = new Date(text);
  if (!Number.isNaN(parsedDate.getTime())) return parsedDate.toISOString().slice(0, 10);
  return null;
}

function normalizeDentalTime(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toTimeString().slice(0, 5);
  }
  if (typeof value === 'number') {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  return match ? `${String(match[1]).padStart(2, '0')}:${match[2]}` : null;
}

function resolveDentalSla(lead, now = new Date()) {
  const status = normalizeDentalText(lead.status) || 'Novo Lead';
  const closed = ['Encerrado', 'Pagou', 'Compareceu', 'Cancelado'].includes(status);
  if (closed) return { sla_status: 'ok', dias_sem_contato: 0, criticidade: 'baixa' };

  const lastAttempt = lead.data_ultima_tentativa || lead.data_primeiro_contato || lead.updated_at || lead.created_at || lead.data_indicacao;
  const lastDate = lastAttempt ? new Date(lastAttempt) : null;
  const daysWithoutContact = lastDate && !Number.isNaN(lastDate.getTime())
    ? Math.max(0, Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000)))
    : 0;

  const nextAttempt = lead.data_proxima_tentativa ? new Date(lead.data_proxima_tentativa) : null;
  const overdue = nextAttempt && !Number.isNaN(nextAttempt.getTime()) && nextAttempt.getTime() < now.getTime();
  const dueToday = nextAttempt && !Number.isNaN(nextAttempt.getTime())
    && nextAttempt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  const noShow = status === 'Faltou / No-show' || String(lead.compareceu || '').toLowerCase() === 'nao';

  if (noShow || overdue) return { sla_status: 'atrasado', dias_sem_contato: daysWithoutContact, criticidade: 'critica' };
  if (dueToday) return { sla_status: 'retorno_hoje', dias_sem_contato: daysWithoutContact, criticidade: 'alta' };
  if (daysWithoutContact >= 2) return { sla_status: 'atencao', dias_sem_contato: daysWithoutContact, criticidade: 'media' };
  return { sla_status: 'ok', dias_sem_contato: daysWithoutContact, criticidade: 'baixa' };
}

function nextAttemptFromCount(count, base = new Date()) {
  const hoursByAttempt = [0, 12, 36, 48];
  const safeCount = Math.min(Math.max(Number(count || 0), 0), hoursByAttempt.length - 1);
  const next = new Date(base);
  next.setHours(next.getHours() + hoursByAttempt[safeCount]);
  return next;
}

function deriveDentalStatus(payload = {}) {
  if (payload.status) return payload.status;
  if (toDentalBoolean(payload.pagou) || ['parcial', 'pagou'].includes(String(payload.pagou || '').toLowerCase())) return 'Pagou';
  if (toDentalBoolean(payload.compareceu)) return 'Compareceu';
  if (String(payload.compareceu || '').toLowerCase() === 'nao') return 'Faltou / No-show';
  if (toDentalBoolean(payload.agendado)) return payload.agendado_por === 'IA' ? 'Agendado IA' : 'Agendado Joyce/CRC';
  return 'Novo Lead';
}

function buildDentalDashboard(rows = []) {
  const total = rows.length;
  const worked = rows.filter((row) => Number(row.quantidade_tentativas || 0) > 0 || row.data_primeiro_contato).length;
  const scheduledIa = rows.filter((row) => row.agendado_por === 'IA' && Number(row.agendado || 0)).length;
  const scheduledCrc = rows.filter((row) => ['Joyce', 'CRC', 'Joyce/CRC'].includes(row.agendado_por) && Number(row.agendado || 0)).length;
  const totalScheduled = rows.filter((row) => Number(row.agendado || 0) || row.data_agendamento).length;
  const attendedIa = rows.filter((row) => row.agendado_por === 'IA' && Number(row.compareceu || 0)).length;
  const attendedCrc = rows.filter((row) => ['Joyce', 'CRC', 'Joyce/CRC'].includes(row.agendado_por) && Number(row.compareceu || 0)).length;
  const totalAttended = rows.filter((row) => Number(row.compareceu || 0)).length;
  const noShows = rows.filter((row) => String(row.status || '').includes('Faltou') || String(row.compareceu || '').toLowerCase() === 'nao').length;
  const payers = rows.filter((row) => ['pagou', 'parcial', '1', 'sim'].includes(String(row.pagou || '').toLowerCase())).length;
  const revenue = rows.reduce((sum, row) => sum + toDentalNumber(row.receita || row.valor_pago), 0);
  const attempts = rows.reduce((sum, row) => sum + toDentalInteger(row.quantidade_tentativas), 0);
  const withoutContact = rows.filter((row) => !row.data_primeiro_contato && toDentalInteger(row.quantidade_tentativas) === 0).length;
  const late = rows.filter((row) => row.sla_status === 'atrasado').length;
  const today = new Date().toISOString().slice(0, 10);
  const returnsToday = rows.filter((row) => String(row.data_proxima_tentativa || '').slice(0, 10) === today).length;
  const critical = rows.filter((row) => row.sla_status === 'atrasado' || row.status === 'Faltou / No-show').length;

  const rate = (part, base) => (base > 0 ? Number(((part / base) * 100).toFixed(2)) : 0);
  const groupBy = (field, valueField = null) => {
    const map = new Map();
    rows.forEach((row) => {
      const key = row[field] || 'Nao informado';
      const current = map.get(key) || 0;
      map.set(key, current + (valueField ? toDentalNumber(row[valueField]) : 1));
    });
    return Array.from(map, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const monthly = new Map();
  rows.forEach((row) => {
    const month = String(row.data_indicacao || row.data_agendamento || row.created_at || '').slice(0, 7) || 'Sem mes';
    const item = monthly.get(month) || { name: month, indicacoes: 0, receita: 0, agendados: 0, comparecidos: 0 };
    item.indicacoes += 1;
    item.receita += toDentalNumber(row.receita || row.valor_pago);
    item.agendados += Number(row.agendado || 0) ? 1 : 0;
    item.comparecidos += Number(row.compareceu || 0) ? 1 : 0;
    monthly.set(month, item);
  });

  return {
    summary: {
      totalIndicacoes: total,
      leadsTrabalhados: worked,
      ligacoesFollowUp: attempts,
      agendadosIa: scheduledIa,
      agendadosCrc: scheduledCrc,
      totalAgendado: totalScheduled,
      comparecidosIa: attendedIa,
      comparecidosCrc: attendedCrc,
      totalComparecido: totalAttended,
      faltasNoShow: noShows,
      pagantes: payers,
      receitaTotal: Number(revenue.toFixed(2)),
      ticketMedio: payers > 0 ? Number((revenue / payers).toFixed(2)) : 0,
      taxaAgendamento: rate(totalScheduled, total),
      taxaComparecimento: rate(totalAttended, totalScheduled),
      taxaPagamento: rate(payers, totalAttended),
      taxaEvasao: rate(noShows, totalScheduled),
      taxaConversaoFinal: rate(payers, total),
      leadsSemContato: withoutContact,
      leadsEmAtraso: late,
      leadsRetornoHoje: returnsToday,
      leadsCriticos: critical
    },
    charts: {
      funnel: [
        { name: 'Indicacoes', value: total },
        { name: 'Contatados', value: worked },
        { name: 'Agendados', value: totalScheduled },
        { name: 'Comparecidos', value: totalAttended },
        { name: 'Pagantes', value: payers }
      ],
      byUnit: groupBy('unidade'),
      status: groupBy('status'),
      revenueByUnit: groupBy('unidade', 'receita'),
      attendanceByUnit: groupBy('unidade').map((item) => ({
        ...item,
        value: rows.filter((row) => (row.unidade || 'Nao informado') === item.name && Number(row.compareceu || 0)).length
      })),
      operatorConversion: groupBy('responsavel'),
      noShowByUnit: groupBy('unidade').map((item) => ({
        ...item,
        value: rows.filter((row) => (row.unidade || 'Nao informado') === item.name && (row.status === 'Faltou / No-show' || String(row.compareceu).toLowerCase() === 'nao')).length
      })),
      revenueByMonth: Array.from(monthly.values()).sort((a, b) => a.name.localeCompare(b.name)),
      source: groupBy('origem'),
      iaVsCrc: [
        { name: 'IA', agendados: scheduledIa, comparecidos: attendedIa },
        { name: 'Joyce/CRC', agendados: scheduledCrc, comparecidos: attendedCrc }
      ]
    },
    routineToday: {
      novosHoje: rows.filter((row) => String(row.data_indicacao || '').slice(0, 10) === today).length,
      retornosHoje: returnsToday,
      agendamentosHoje: rows.filter((row) => String(row.data_agendamento || '').slice(0, 10) === today).length,
      confirmacoesPendentes: rows.filter((row) => Number(row.agendado || 0) && String(row.confirmou_presenca || '').toLowerCase() === 'pendente').length,
      faltososRecuperar: rows.filter((row) => row.status === 'Faltou / No-show' && !Number(row.tentativa_recuperacao || 0)).length,
      followUpsAtrasados: late,
      pagamentosPendentes: rows.filter((row) => Number(row.compareceu || 0) && !['pagou', 'parcial', '1', 'sim'].includes(String(row.pagou || '').toLowerCase())).length,
      semResposta48h: rows.filter((row) => !row.data_primeiro_contato && row.dias_sem_contato >= 2).length
    }
  };
}

const columnMap = {
  data: 'data_indicacao',
  data_indicacao: 'data_indicacao',
  numero_de_indicacao: 'nome_indicador',
  unidade: 'unidade',
  nome_do_paciente: 'nome_lead',
  nome_paciente: 'nome_lead',
  paciente: 'nome_lead',
  telefone: 'telefone',
  ficha: 'ficha',
  agendamento: 'data_agendamento',
  status: 'status',
  valor: 'valor_pago',
  receita: 'receita',
  ligacoes_follow: 'quantidade_tentativas',
  ligacoes_follow_up: 'quantidade_tentativas',
  agendados_ia: 'agendado_ia',
  agendados_joyce: 'agendado_joyce',
  comparecidos_ia: 'comparecido_ia',
  comparecidos_joyce: 'comparecido_joyce',
  pagantes: 'pagou'
};

const dentalCardImportTemplateColumns = [
  'Data',
  'Unidade',
  'Nome do paciente',
  'Telefone',
  'Ficha',
  'Número de indicação',
  'Origem',
  'Responsável',
  'Status',
  'Ligações Follow',
  'Agendamento',
  'Agendado por',
  'Compareceu',
  'Pagou',
  'Valor',
  'Receita',
  'Forma de pagamento',
  'Observações'
];

function buildDentalCardImportTemplateBuffer() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet([
    {
      Data: '2026-05-01',
      Unidade: 'Garavelo',
      'Nome do paciente': 'Maria Exemplo',
      Telefone: '5562999999999',
      Ficha: 'DC-0001',
      'Número de indicação': 'Indicador ou número da indicação',
      Origem: 'Indicação manual',
      Responsável: 'Operador CRC',
      Status: 'Novo Lead',
      'Ligações Follow': 0,
      Agendamento: '2026-05-02',
      'Agendado por': 'Joyce/CRC',
      Compareceu: 'não',
      Pagou: 'pendente',
      Valor: 0,
      Receita: 0,
      'Forma de pagamento': '',
      Observações: 'Preencha uma linha por lead.'
    }
  ], { header: dentalCardImportTemplateColumns });

  worksheet['!cols'] = dentalCardImportTemplateColumns.map((header) => ({
    wch: Math.max(14, Math.min(28, header.length + 6))
  }));

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Modelo Dental Card');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

function normalizeImportedDentalRow(row, sheetName = '') {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const mapped = columnMap[normalizeDentalKey(key)];
    if (mapped) normalized[mapped] = value;
  });

  const phone = normalizeDentalPhone(normalized.telefone);
  const hasPatientSignal = normalized.nome_lead || phone || normalized.ficha;
  if (!hasPatientSignal) return null;

  const agendadoIa = toDentalInteger(normalized.agendado_ia);
  const agendadoJoyce = toDentalInteger(normalized.agendado_joyce);
  const comparecidoIa = toDentalInteger(normalized.comparecido_ia);
  const comparecidoJoyce = toDentalInteger(normalized.comparecido_joyce);

  const payload = {
    data_indicacao: normalizeDentalDate(normalized.data_indicacao) || null,
    unidade: normalizeDentalText(normalized.unidade || sheetName, 180),
    nome_lead: normalizeDentalText(normalized.nome_lead || `Lead ${phone || normalized.ficha || ''}`.trim(), 180),
    telefone: phone,
    ficha: normalizeDentalText(normalized.ficha, 80),
    nome_indicador: normalizeDentalText(normalized.nome_indicador, 180),
    origem: agendadoIa || comparecidoIa ? 'IA' : agendadoJoyce || comparecidoJoyce ? 'Joyce/CRC' : 'Planilha',
    responsavel: agendadoJoyce || comparecidoJoyce ? 'Joyce/CRC' : agendadoIa || comparecidoIa ? 'IA' : null,
    quantidade_tentativas: toDentalInteger(normalized.quantidade_tentativas),
    agendado: agendadoIa || agendadoJoyce || normalized.data_agendamento ? 1 : 0,
    agendado_por: agendadoIa ? 'IA' : agendadoJoyce ? 'Joyce/CRC' : null,
    data_agendamento: normalizeDentalDate(normalized.data_agendamento),
    hora_agendamento: normalizeDentalTime(normalized.data_agendamento),
    compareceu: comparecidoIa || comparecidoJoyce ? 1 : 0,
    pagou: toDentalBoolean(normalized.pagou),
    valor_pago: toDentalNumber(normalized.valor_pago || normalized.receita),
    receita: toDentalNumber(normalized.receita || normalized.valor_pago),
    status: normalizeDentalText(normalized.status, 80)
  };

  payload.status = deriveDentalStatus(payload);
  return payload;
}

function parseDentalCardWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const rows = [];
  const errors = [];
  let ignored = 0;

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    jsonRows.forEach((row, index) => {
      const normalized = normalizeImportedDentalRow(row, sheetName);
      if (normalized) {
        rows.push({ ...normalized, sheetName, rowNumber: index + 2 });
      } else {
        ignored += 1;
      }
    });
  });

  const seen = new Set();
  const uniqueRows = [];
  const duplicates = [];
  rows.forEach((row) => {
    const key = `${row.telefone || ''}|${row.data_agendamento || row.data_indicacao || ''}|${row.ficha || ''}`;
    if (seen.has(key)) {
      duplicates.push(row);
      return;
    }
    seen.add(key);
    uniqueRows.push(row);
  });

  return {
    rows: uniqueRows,
    summary: {
      sheets: workbook.SheetNames,
      found: rows.length,
      readyToImport: uniqueRows.length,
      ignored,
      duplicates: duplicates.length,
      errors
    },
    duplicates
  };
}

module.exports = {
  buildDentalCardImportTemplateBuffer,
  buildDentalDashboard,
  dentalCardStatuses,
  dentalCardTemplateSeeds,
  deriveDentalStatus,
  nextAttemptFromCount,
  normalizeDentalDate,
  normalizeDentalPhone,
  normalizeDentalText,
  normalizeDentalTime,
  parseDentalCardWorkbook,
  resolveDentalSla,
  toDentalBoolean,
  toDentalNumber
};
