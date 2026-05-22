const assert = require('node:assert/strict');
const test = require('node:test');
const XLSX = require('xlsx');

const {
  buildDentalDashboard,
  normalizeDentalPhone,
  parseDentalCardWorkbook,
  resolveDentalSla
} = require('../services/dentalCardService');

test('dental card dashboard calculates core funnel rates', () => {
  const payload = buildDentalDashboard([
    {
      unidade: 'Garavelo',
      nome_lead: 'Maria',
      telefone: '5562999999999',
      quantidade_tentativas: 1,
      agendado: 1,
      agendado_por: 'IA',
      compareceu: 1,
      pagou: 'pagou',
      receita: 1000,
      status: 'Pagou',
      sla_status: 'ok'
    },
    {
      unidade: 'Garavelo',
      nome_lead: 'Joao',
      telefone: '5562888888888',
      quantidade_tentativas: 0,
      agendado: 1,
      agendado_por: 'Joyce/CRC',
      compareceu: 0,
      pagou: 'pendente',
      receita: 0,
      status: 'Faltou / No-show',
      sla_status: 'atrasado'
    }
  ]);

  assert.equal(payload.summary.totalIndicacoes, 2);
  assert.equal(payload.summary.totalAgendado, 2);
  assert.equal(payload.summary.totalComparecido, 1);
  assert.equal(payload.summary.pagantes, 1);
  assert.equal(payload.summary.receitaTotal, 1000);
  assert.equal(payload.summary.taxaAgendamento, 100);
  assert.equal(payload.summary.taxaComparecimento, 50);
  assert.equal(payload.summary.taxaConversaoFinal, 50);
  assert.equal(payload.summary.leadsCriticos, 1);
});

test('dental card dashboard highlights public indications and return SLA', () => {
  const payload = buildDentalDashboard([
    {
      unidade: 'Garavelo',
      nome_lead: 'Lead Publico',
      telefone: '5562999999999',
      created_via_public_form: 1,
      foto_url: '/uploads/foto.jpg',
      sla_retorno_status: 'vencido',
      status: 'Indicação Recebida',
      sla_status: 'atencao'
    },
    {
      unidade: 'Garavelo',
      nome_lead: 'Lead Retornado',
      telefone: '5562888888888',
      created_at: '2026-05-01T08:00:00.000Z',
      primeiro_retorno_em: '2026-05-01T09:00:00.000Z',
      sla_retorno_status: 'cumprido',
      status: 'Contato efetivo',
      sla_status: 'ok'
    }
  ]);

  assert.equal(payload.summary.publicIndications, 1);
  assert.equal(payload.summary.indicationsWithPhoto, 1);
  assert.equal(payload.summary.slaReturnExpired, 1);
  assert.equal(payload.summary.slaReturnOk, 1);
  assert.equal(payload.summary.slaReturnCompliance, 50);
  assert.equal(payload.charts.returnSla.length, 2);
});

test('dental card import maps workbook rows and removes duplicates', () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([
    {
      Data: '01/05/2026',
      Unidade: 'Garavelo',
      'Nome do paciente': 'Ana Teste',
      Telefone: '(62) 99999-0000',
      Ficha: 'A1',
      'Agendados IA': 1,
      'Comparecidos IA': 1,
      Pagantes: 'sim',
      Receita: 'R$ 500,00'
    },
    {
      Data: '01/05/2026',
      Unidade: 'Garavelo',
      'Nome do paciente': 'Ana Teste',
      Telefone: '(62) 99999-0000',
      Ficha: 'A1'
    }
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Maio 26');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const parsed = parseDentalCardWorkbook(buffer);

  assert.equal(parsed.summary.found, 2);
  assert.equal(parsed.summary.readyToImport, 1);
  assert.equal(parsed.summary.duplicates, 1);
  assert.equal(parsed.rows[0].telefone, '5562999990000');
  assert.equal(parsed.rows[0].status, 'Pagou');
});

test('dental card helpers normalize phone and classify overdue SLA', () => {
  assert.equal(normalizeDentalPhone('(62) 99999-0000'), '5562999990000');
  const sla = resolveDentalSla({
    status: 'Em follow-up',
    data_proxima_tentativa: '2026-05-01T08:00:00.000Z',
    data_ultima_tentativa: '2026-05-01T08:00:00.000Z'
  }, new Date('2026-05-03T08:00:00.000Z'));

  assert.equal(sla.sla_status, 'atrasado');
  assert.equal(sla.criticidade, 'critica');
});
