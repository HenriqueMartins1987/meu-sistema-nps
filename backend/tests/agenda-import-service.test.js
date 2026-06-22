const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAgendaClipboard,
  parseAgendaTime
} = require('../services/agendaImportService');

test('agenda clipboard parser rebuilds patient blocks from copied raw stream', () => {
  const rawText = `WHRV6
Lidiane Freitas Cardoso
0.34375
A Confirmar
Reavaliação
Follow up
Fachada
mode_comment
1
more_horiz
GSSFE
Michele Encarnação De Carvalho
0.3645833333333333
Confirmado
Ortodontia
Não Especificado
Indicação
mode_comment
3
more_horiz
1HMWL
Kauan Garcia De Souza Silva
0.375
A Confirmar
Clinico Geral
Carolina Honorato
Fachada
mode_comment
1
more_horiz`;

  const parsed = parseAgendaClipboard(rawText, {
    unidadeId: 7,
    dataAgenda: '2026-06-22'
  });

  assert.equal(parsed.totalEncontrado, 3);
  assert.equal(parsed.totalComErro, 0);
  assert.equal(parsed.totalValido, 3);

  assert.deepEqual(
    parsed.registros.map((item) => ({
      paciente: item.paciente,
      hora: item.hora,
      status: item.status,
      especialidade: item.especialidade,
      dentista: item.dentista,
      canal: item.canal
    })),
    [
      {
        paciente: 'Lidiane Freitas Cardoso',
        hora: '08:15',
        status: 'A Confirmar',
        especialidade: 'Reavaliação',
        dentista: 'Follow up',
        canal: 'Fachada'
      },
      {
        paciente: 'Michele Encarnação De Carvalho',
        hora: '08:45',
        status: 'Confirmado',
        especialidade: 'Ortodontia',
        dentista: 'Não Especificado',
        canal: 'Indicação'
      },
      {
        paciente: 'Kauan Garcia De Souza Silva',
        hora: '09:00',
        status: 'A Confirmar',
        especialidade: 'Clinico Geral',
        dentista: 'Carolina Honorato',
        canal: 'Fachada'
      }
    ]
  );

  assert.ok(parsed.registros.every((item) => item.errors.length === 0));
  assert.ok(parsed.registros.every((item) => item.warnings.includes('Telefone não informado na origem.')));
});

test('agenda clipboard parser extracts only time from excel javascript base date strings', () => {
  assert.equal(parseAgendaTime('Sat Dec 30 1899 09:00:00 GMT+0000'), '09:00');
  assert.equal(parseAgendaTime('8:15'), '08:15');
});
