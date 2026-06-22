function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const technicalTokens = new Set(['mode_comment', 'more_horiz']);

const statusAliases = new Map([
  ['a confirmar', 'A Confirmar'],
  ['confirmado', 'Confirmado'],
  ['remarcado', 'Remarcado'],
  ['cancelado', 'Cancelado'],
  ['faltou', 'Faltou'],
  ['encaixe', 'Encaixe'],
  ['nao especificado', 'Não Especificado']
]);

const specialtyAliases = new Map([
  ['reavaliacao', 'Reavaliação'],
  ['ortodontia', 'Ortodontia'],
  ['clinico geral', 'Clinico Geral'],
  ['clinica geral', 'Clinico Geral'],
  ['avaliacao', 'Avaliação'],
  ['implante', 'Implante'],
  ['protese', 'Prótese'],
  ['endodontia', 'Endodontia'],
  ['periodontia', 'Periodontia'],
  ['cirurgia', 'Cirurgia'],
  ['harmonizacao', 'Harmonização'],
  ['clareamento', 'Clareamento']
]);

const channelAliases = new Map([
  ['fachada', 'Fachada'],
  ['indicacao', 'Indicação'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['whatsapp', 'WhatsApp'],
  ['google', 'Google'],
  ['site', 'Site'],
  ['lead frio', 'Lead Frio'],
  ['lead quente', 'Lead Quente'],
  ['retorno', 'Retorno'],
  ['follow up', 'Follow up']
]);

function isAgendaTechnicalToken(value) {
  return technicalTokens.has(normalizeText(value));
}

function isExternalCode(value) {
  const raw = String(value || '').trim();
  if (!raw || raw !== raw.toUpperCase()) return false;
  return /^[A-Z0-9]{4,8}$/.test(raw);
}

function parseExcelTimeDecimal(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const totalMinutes = Math.round(numeric * 24 * 60);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseAgendaTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [hour, minute] = raw.split(':').map(Number);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  if (/^\d+(\.\d+)?$/.test(raw) && Number(raw) >= 0 && Number(raw) < 1) {
    return parseExcelTimeDecimal(raw);
  }

  const parsedDate = new Date(raw);
  if (!Number.isNaN(parsedDate.getTime())) {
    return `${String(parsedDate.getUTCHours()).padStart(2, '0')}:${String(parsedDate.getUTCMinutes()).padStart(2, '0')}`;
  }

  return '';
}

function toDisplayDate(dateValue) {
  if (!dateValue) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month, day] = dateValue.split('-');
    return `${day}/${month}/${year}`;
  }
  return String(dateValue);
}

function toSqlDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  const [hour, minute] = String(timeValue).split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return `${dateValue} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function normalizeDictionaryValue(value, dictionary) {
  const normalized = normalizeText(value);
  return dictionary.get(normalized) || '';
}

function sanitizeLine(value) {
  return String(value ?? '').replace(/\r/g, '').trim();
}

function collectClipboardLines(rawText) {
  return String(rawText || '')
    .split('\n')
    .map(sanitizeLine);
}

function cleanClipboardLines(lines = []) {
  const cleaned = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = sanitizeLine(lines[index]);
    if (!line) continue;

    if (isAgendaTechnicalToken(line)) continue;

    const previous = sanitizeLine(lines[index - 1] || '');
    const next = sanitizeLine(lines[index + 1] || '');
    const numericOnly = /^\d+$/.test(line);
    if (numericOnly && (isAgendaTechnicalToken(previous) || isAgendaTechnicalToken(next))) {
      continue;
    }

    cleaned.push(line);
  }

  return cleaned;
}

function groupAgendaBlocks(lines = []) {
  const blocks = [];
  let currentBlock = [];

  lines.forEach((line) => {
    if (isExternalCode(line) && currentBlock.length) {
      blocks.push(currentBlock);
      currentBlock = [line];
      return;
    }

    currentBlock.push(line);
  });

  if (currentBlock.length) {
    blocks.push(currentBlock);
  }

  return blocks;
}

function parseAgendaBlock(block = [], options = {}) {
  const [codigoExterno = '', paciente = '', rawHora = '', rawStatus = '', rawEspecialidade = '', rawDentista = '', rawCanal = ''] = block;
  const warnings = [];
  const errors = [];
  const hora = parseAgendaTime(rawHora);
  const status = normalizeDictionaryValue(rawStatus, statusAliases) || rawStatus || '';
  const especialidade = normalizeDictionaryValue(rawEspecialidade, specialtyAliases) || rawEspecialidade || '';
  const dentista = rawDentista || '';
  const canal = normalizeDictionaryValue(rawCanal, channelAliases) || rawCanal || '';
  const data = toDisplayDate(options.dataAgenda);
  const scheduledAt = toSqlDateTime(options.dataAgenda, hora);

  if (!codigoExterno || !isExternalCode(codigoExterno)) errors.push('Código externo inválido.');
  if (!paciente) errors.push('Paciente obrigatório.');
  if (!hora) errors.push('Hora obrigatória.');
  if (!data) errors.push('Data da agenda obrigatória.');
  if (!especialidade) warnings.push('Especialidade pendente de mapeamento.');
  if (!dentista || normalizeText(dentista) === 'nao especificado') warnings.push('Dentista não especificado.');
  if (!canal) warnings.push('Canal não identificado.');
  warnings.push('Telefone não informado na origem.');

  return {
    codigoExterno,
    paciente,
    telefone: '',
    data,
    hora,
    status,
    especialidade,
    dentista,
    canal,
    warnings,
    errors,
    rawBlock: block,
    line: Number(options.line || 0) || 0,
    patient_scheduled_at: scheduledAt
  };
}

function parseAgendaClipboard(rawText, options = {}) {
  const rawLines = collectClipboardLines(rawText);
  const cleanedLines = cleanClipboardLines(rawLines);
  const blocks = groupAgendaBlocks(cleanedLines);
  const registros = blocks
    .filter((block) => block.length)
    .map((block, index) => parseAgendaBlock(block, { ...options, line: index + 2 }));

  return {
    totalEncontrado: registros.length,
    totalValido: registros.filter((item) => !item.errors.length).length,
    totalDuplicado: 0,
    totalComErro: registros.filter((item) => item.errors.length).length,
    registros
  };
}

function buildClipboardTextFromWorksheetRows(rows = []) {
  return rows
    .reduce((lines, row) => {
      const values = Object.values(row || {})
        .map((value) => sanitizeLine(value))
        .filter(Boolean);
      if (!values.length) return lines;
      lines.push(values[0]);
      return lines;
    }, [])
    .join('\n');
}

module.exports = {
  buildClipboardTextFromWorksheetRows,
  channelAliases,
  normalizeText,
  parseAgendaClipboard,
  parseAgendaTime,
  specialtyAliases,
  statusAliases
};
