const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const {
  buildNpsInviteIdempotencyKey,
  buildNpsInviteMessage,
  buildNpsInvitePublicUrl,
  buildNpsInviteToken,
  computeRetryState,
  getNpsAutomationConfig,
  interpretEcuroCompletionStatus,
  isWithinDispatchWindow,
  matchesCronExpression
} = require('../services/ecuroCompletionService');
const {
  computeLastConsultationDateRange,
  detectSortOrderViolation,
  extractEcuroPatientRowsFromText,
  extractPatientsFromNetworkResponses,
  getNpsEligibleDates,
  getEcuroRobotConfigStatus,
  evaluateNpsEligibility,
  evaluateNpsEligibilityFromExcel,
  isEligibleByLastConsultationDate,
  isEligibleByLastConsultationDates,
  matchCompletionRows,
  mapPatientDirectoryRows,
  normalizeBrazilianDate,
  normalizeEcuroCompletionStatus,
  normalizeEcuroPatientFromApi,
  normalizeExcelDate,
  parseEcuroPatientsExcel,
  resolveEcuroTargetDate,
  shouldStopWhenOlderThanEligibleDates,
  summarizeCompletionResults
} = require('../services/ecuroRobotService');

test('buildNpsInvitePublicUrl keeps required public params', () => {
  const url = buildNpsInvitePublicUrl({
    clinicId: 7,
    patientName: 'Maria Silva',
    patientPhone: '+5562999991111',
    inviteId: 42,
    token: 'token-abc'
  }, {
    NPS_PUBLIC_URL: 'https://meu-sistema-nps-three.vercel.app/nps'
  });

  assert.match(url, /clinic_id=7/);
  assert.match(url, /patient_name=Maria/);
  assert.match(url, /patient_phone=%2B5562999991111/);
  assert.match(url, /source=ecuro_last_consultation/);
  assert.match(url, /invite_id=42/);
  assert.match(url, /token=token-abc/);
});

test('buildNpsInviteIdempotencyKey uses invite id and normalized phone', () => {
  const key = buildNpsInviteIdempotencyKey({
    inviteId: 91,
    phone: '(62) 99966-9966'
  });

  assert.equal(key, 'nps-91-5562999669966');
});

test('getNpsAutomationConfig uses the dedicated NPS whatsapp session by default', () => {
  const config = getNpsAutomationConfig({});

  assert.equal(config.sessionId, 'nps');
});

test('getNpsAutomationConfig still honors an explicit whatsapp session override', () => {
  const config = getNpsAutomationConfig({
    NPS_WHATSAPP_SESSION_ID: 'nps-homolog',
    WHATSAPP_NPS_INSTANCE_NAME: 'nps'
  });

  assert.equal(config.sessionId, 'nps-homolog');
});

test('buildNpsInviteMessage renders the professional default template', () => {
  const message = buildNpsInviteMessage({
    patientName: 'Joao',
    clinicName: 'Centro',
    link: 'https://example.test/nps'
  });

  assert.match(message, /Joao/);
  assert.match(message, /Centro/);
  assert.match(message, /última consulta|Ãºltima consulta/);
  assert.match(message, /https:\/\/example\.test\/nps/);
});

test('interpretEcuroCompletionStatus recognizes completed and review states', () => {
  assert.equal(interpretEcuroCompletionStatus('Concluído'), 'completed');
  assert.equal(interpretEcuroCompletionStatus('Paciente não encontrado'), 'not_found');
  assert.equal(interpretEcuroCompletionStatus('manual_action_required'), 'manual_action_required');
  assert.equal(normalizeEcuroCompletionStatus('Atendida'), 'completed');
});

test('matchCompletionRows prioritizes phone and external id', () => {
  const [result] = matchCompletionRows(
    [{
      patient_name: 'Maria Silva',
      patient_phone: '+5562999669966',
      external_patient_id: 'ABC123',
      appointment_date: '2026-06-29',
      appointment_time: '09:00'
    }],
    [{
      patientName: 'Maria Silva',
      patientPhone: '+5562999669966',
      externalPatientId: 'ABC123',
      appointmentDate: '2026-06-29',
      appointmentTime: '09:00',
      externalStatus: 'Concluído'
    }]
  );

  assert.equal(result.completionStatus, 'completed');
  assert.equal(result.matchedBy, 'external_id');
  assert.equal(result.confidenceScore >= 100, true);
});

test('summarizeCompletionResults counts completed and failures', () => {
  const summary = summarizeCompletionResults([
    { completionStatus: 'completed', eligibilityStatus: 'eligible' },
    { completionStatus: 'completed', eligibilityStatus: 'eligible' },
    { completionStatus: 'error', eligibilityStatus: 'clinic_mismatch' },
    { completionStatus: 'ambiguous', eligibilityStatus: 'duplicate' }
  ]);

  assert.equal(summary.totalChecked, 4);
  assert.equal(summary.totalCompleted, 2);
  assert.equal(summary.totalFailed, 1);
  assert.equal(summary.totalAmbiguous, 1);
  assert.equal(summary.totalEligible, 2);
  assert.equal(summary.totalDuplicate, 1);
});

test('normalizeBrazilianDate converts dashboard labels to ISO', () => {
  assert.equal(normalizeBrazilianDate('29/06/2026'), '2026-06-29');
  assert.equal(normalizeBrazilianDate('2026-06-29'), '2026-06-29');
  assert.equal(normalizeBrazilianDate('-'), '');
});

test('mapPatientDirectoryRows flags yesterday patients as eligible and invalid phone when needed', () => {
  const rows = mapPatientDirectoryRows({
    headerIndexes: {
      patientFirstName: 0,
      patientLastName: 1,
      document: 2,
      externalPatientId: 3,
      patientPhone: 4,
      registrationDate: 5,
      lastConsultationDate: 6,
      nextConsultationDate: 7
    },
    rows: [
      ['Maria', 'Silva', '123.456.789-00', 'ABC123', '(62) 99966-9966', '10/01/2026', '29/06/2026', '05/07/2026'],
      ['Joao', 'Souza', '987.654.321-00', 'XYZ987', '', '10/01/2026', '29/06/2026', '-'],
      ['Ana', 'Lima', '111.222.333-44', 'LMN444', '(62) 98888-7777', '10/01/2026', '28/06/2026', '-']
    ]
  }, {
    clinicName: 'G0007 - Sorriso do Povo - Goiânia II - Goiás',
    targetDate: '2026-06-29'
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].eligibilityStatus, 'eligible');
  assert.equal(rows[0].completionStatus, 'completed');
  assert.equal(rows[1].eligibilityStatus, 'invalid_phone');
  assert.equal(rows[2].eligibilityStatus, 'out_of_date');
});

test('extractEcuroPatientRowsFromText parses the Ecuro patients page text layout', () => {
  const extracted = extractEcuroPatientRowsFromText([
    'PRIMEIRO NOME',
    'SOBRENOME',
    'CPF',
    'ID',
    'NUMERO DE TELEFONE',
    'DATA DE NASCIMENTO',
    'DATA DE CADASTRO',
    'ULTIMA CONSULTA',
    'PROXIMA CONSULTA',
    'George',
    'Marques De Fre...',
    '008.597.431-52',
    'DPAWQ',
    '+5577998433088',
    '27/02/1984',
    '29/06/2026',
    '29/06/2026',
    '29/12/2026',
    'Pablyne',
    'Martins Dos Sa...',
    '702.886.011-65',
    'B05FF',
    '+5562994296004',
    '12/01/1998',
    '27/06/2026',
    '-',
    '-'
  ].join('\n'));

  assert.equal(extracted.rows.length, 2);
  assert.deepEqual(extracted.rows[0], [
    'George',
    'Marques De Fre...',
    '008.597.431-52',
    'DPAWQ',
    '+5577998433088',
    '27/02/1984',
    '29/06/2026',
    '29/06/2026',
    '29/12/2026'
  ]);
  assert.equal(extracted.rows[1][7], '-');
});

test('extractEcuroPatientRowsFromText parses a single visual row line', () => {
  const extracted = extractEcuroPatientRowsFromText(
    'George Marques De Freitas 008.597.431-52 DPAWQ +5577998433088 27/02/1984 29/06/2026 01/07/2026 29/12/2026'
  );

  assert.equal(extracted.rows.length, 1);
  assert.equal(extracted.rows[0][0], 'George');
  assert.equal(extracted.rows[0][1], 'Marques De Freitas');
  assert.equal(extracted.rows[0][4], '+5577998433088');
  assert.equal(extracted.rows[0][7], '01/07/2026');
});

test('isEligibleByLastConsultationDate uses the current target day as the NPS rule', () => {
  assert.equal(isEligibleByLastConsultationDate('01/07/2026', '2026-07-01'), 'eligible');
  assert.equal(isEligibleByLastConsultationDate('-', '2026-07-01'), 'missing_last_consultation');
  assert.equal(isEligibleByLastConsultationDate('30/06/2026', '2026-07-01'), 'out_of_date');
});

test('resolveEcuroTargetDate honors explicit target date and defaults to today', () => {
  assert.equal(resolveEcuroTargetDate({ targetDate: '01/07/2026' }, new Date('2026-07-01T12:00:00Z')), '2026-07-01');
  assert.equal(resolveEcuroTargetDate({}, new Date('2026-07-01T12:00:00Z')), '2026-07-01');
  assert.equal(resolveEcuroTargetDate({ targetDateMode: 'yesterday' }, new Date('2026-07-01T12:00:00Z')), '2026-06-30');
});

test('getNpsEligibleDates returns only today unless target dates are explicit', () => {
  assert.deepEqual(getNpsEligibleDates({
    npsDateMode: 'today',
    includeToday: true,
    includeYesterday: false
  }, {}, new Date('2026-07-01T12:00:00Z')), ['2026-07-01']);
  assert.deepEqual(getNpsEligibleDates({}, { targetDate: '01/07/2026' }, new Date('2026-06-30T12:00:00Z')), ['2026-07-01']);
  assert.equal(isEligibleByLastConsultationDates('30/06/2026', ['2026-07-01']), 'out_of_date');
});

test('normalizeEcuroPatientFromApi maps Ecuro network patient payloads safely', () => {
  const patient = normalizeEcuroPatientFromApi({
    firstName: 'George',
    lastName: 'Marques De Freitas',
    cpf: '008.597.431-52',
    id: 'DPAWQ',
    phone: '+5577998433088',
    registrationDate: '29/06/2026',
    lastConsultation: '01/07/2026',
    nextAppointment: '29/12/2026',
    clinic: { code: 'G0007', name: 'G0007 - Sorriso do Povo - Goiania II - Goias' }
  });

  assert.equal(patient.patientName, 'George Marques De Freitas');
  assert.equal(patient.patientPhone, '+5577998433088');
  assert.equal(patient.document, '008.597.431-52');
  assert.equal(patient.externalPatientId, 'DPAWQ');
  assert.equal(patient.lastConsultationDate, '2026-07-01');
  assert.equal(patient.nextConsultationDate, '2026-12-29');
  assert.match(patient.rawPayloadJson, /\*\*\*/);
});

test('extractPatientsFromNetworkResponses reads JSON candidates and applies today eligibility', () => {
  const candidate = {
    url: 'https://ecuro.com.br/api/patients',
    method: 'GET'
  };
  Object.defineProperty(candidate, '_rawJson', {
    enumerable: false,
    value: {
      data: [
        {
          firstName: 'George',
          lastName: 'Marques',
          cpf: '008.597.431-52',
          id: 'DPAWQ',
          phone: '+5577998433088',
          lastConsultation: '01/07/2026',
          clinicName: 'G0007 - Sorriso do Povo - Goiania II - Goias'
        },
        {
          name: 'Maria Silva',
          phone: '+5562999669966',
          lastConsultation: '30/06/2026',
          clinicName: 'G0007 - Sorriso do Povo - Goiania II - Goias'
        }
      ]
    }
  });

  const rows = extractPatientsFromNetworkResponses([candidate], {
    targetDate: '2026-07-01',
    source: 'ecuro_network_patients'
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].eligibilityStatus, 'eligible');
  assert.equal(rows[0].completionStatus, 'completed');
  assert.equal(rows[1].eligibilityStatus, 'out_of_date');
});

test('evaluateNpsEligibility blocks yesterday and invalid phone in network mode', () => {
  assert.equal(evaluateNpsEligibility({
    patientName: 'George Marques',
    patientPhone: '+5577998433088',
    clinicName: 'G0007 - Sorriso do Povo',
    lastConsultationDate: '2026-07-01'
  }, '2026-07-01'), 'eligible');
  assert.equal(evaluateNpsEligibility({
    patientName: 'George Marques',
    patientPhone: '+5577998433088',
    clinicName: 'G0007 - Sorriso do Povo',
    lastConsultationDate: '2026-06-30'
  }, '2026-07-01'), 'out_of_date');
  assert.equal(evaluateNpsEligibility({
    patientName: 'George Marques',
    patientPhone: '',
    clinicName: 'G0007 - Sorriso do Povo',
    lastConsultationDate: '2026-07-01'
  }, '2026-07-01'), 'invalid_phone');
});

test('normalizeExcelDate supports strings, ISO values and Excel serial numbers', () => {
  assert.equal(normalizeExcelDate('01/07/2026'), '01/07/2026');
  assert.equal(normalizeExcelDate('2026-07-01'), '01/07/2026');
  assert.equal(normalizeExcelDate(46204), '01/07/2026');
  assert.equal(normalizeExcelDate(new Date(Date.UTC(2026, 6, 1))), '01/07/2026');
  assert.equal(normalizeExcelDate('-'), '');
});

test('parseEcuroPatientsExcel maps exported Ecuro columns and applies today eligibility', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecuro-excel-'));
  const filePath = path.join(tempDir, 'patients.xlsx');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['PRIMEIRO NOME', 'SOBRENOME', 'CPF', 'ID', 'NÚMERO DE TELEFONE', 'DATA DE NASCIMENTO', 'DATA DE CADASTRO', 'ÚLTIMA CONSULTA', 'PRÓXIMA CONSULTA'],
    ['George', 'Marques De Freitas', '008.597.431-52', 'DPAWQ', '+5577998433088', '27/02/1984', '29/06/2026', '01/07/2026', '29/12/2026'],
    ['Maria', 'Silva', '123.456.789-00', 'ABC12', '+5562999669966', '10/01/1990', '01/07/2026', '30/06/2026', '-'],
    ['Sem', 'Telefone', '987.654.321-00', 'SEM01', '', '10/01/1991', '01/07/2026', '01/07/2026', '-']
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Pacientes');
  XLSX.writeFile(workbook, filePath);

  const parsed = parseEcuroPatientsExcel(filePath, {
    clinicCode: 'G0007',
    fullLabel: 'G0007 - Sorriso do Povo - Goiania II - Goias'
  }, {}, {
    targetDate: '2026-07-01',
    source: 'ecuro_excel_export'
  });

  assert.equal(parsed.rowsRead, 3);
  assert.equal(parsed.targetDate, '2026-07-01');
  assert.equal(parsed.patients[0].patientName, 'George Marques De Freitas');
  assert.equal(parsed.patients[0].patientPhone, '+5577998433088');
  assert.equal(parsed.patients[0].lastConsultationDate, '2026-07-01');
  assert.equal(parsed.patients[0].eligibilityStatus, 'eligible');
  assert.equal(parsed.patients[1].eligibilityStatus, 'out_of_date');
  assert.equal(parsed.patients[2].eligibilityStatus, 'missing_phone');
  assert.equal(parsed.summary.totalEligible, 1);
  assert.equal(parsed.summary.totalOutOfDate, 1);
  assert.equal(parsed.summary.totalMissingPhone, 1);
});

test('evaluateNpsEligibilityFromExcel blocks duplicates and missing clinic context', () => {
  const seenKeys = new Set();
  const patient = {
    patientName: 'George Marques',
    patientPhone: '+5577998433088',
    clinicCode: 'G0007',
    clinicName: 'G0007 - Sorriso do Povo',
    externalPatientId: 'DPAWQ',
    lastConsultationDate: '2026-07-01'
  };
  assert.equal(evaluateNpsEligibilityFromExcel(patient, '2026-07-01', { seenKeys }), 'eligible');
  assert.equal(evaluateNpsEligibilityFromExcel(patient, '2026-07-01', { seenKeys }), 'duplicate');
  assert.equal(evaluateNpsEligibilityFromExcel({
    ...patient,
    clinicCode: '',
    clinicName: '',
    externalPatientId: 'NEW01',
    patientPhone: '+5562999669966'
  }, '2026-07-01'), 'parse_error');
});

test('computeRetryState stops after max attempts and handles manual action', () => {
  assert.equal(computeRetryState({ attempts: 3, maxAttempts: 3 }).status, 'failed');
  assert.equal(computeRetryState({ attempts: 1, manualActionRequired: true }).status, 'manual_action_required');
  assert.equal(computeRetryState({ attempts: 1, maxAttempts: 3, delaySeconds: 45 }).status, 'pending');
});

test('isWithinDispatchWindow respects configured window', () => {
  const config = getNpsAutomationConfig({
    NPS_DISPATCH_WINDOW_START: '08:00',
    NPS_DISPATCH_WINDOW_END: '18:00'
  });

  assert.equal(isWithinDispatchWindow(new Date('2026-06-29T12:00:00'), config), true);
  assert.equal(isWithinDispatchWindow(new Date('2026-06-29T21:00:00'), config), false);
});

test('matchesCronExpression supports monday-saturday nightly execution', () => {
  assert.equal(matchesCronExpression('0 19 * * 1-6', new Date('2026-06-29T19:00:00')), true);
  assert.equal(matchesCronExpression('0 19 * * 1-6', new Date('2026-06-28T19:00:00')), false);
});

test('buildNpsInviteToken yields long opaque values', () => {
  const token = buildNpsInviteToken('sample');
  assert.equal(token.length, 64);
});

test('computeLastConsultationDateRange ignores rows without a parsed date', () => {
  assert.equal(computeLastConsultationDateRange([{ lastConsultationDate: null }, { lastConsultationDate: '' }]), null);
  assert.deepEqual(computeLastConsultationDateRange([
    { lastConsultationDate: '2026-06-29' },
    { lastConsultationDate: '2026-06-27' },
    { lastConsultationDate: '2026-06-30' }
  ]), { min: '2026-06-27', max: '2026-06-30' });
});

test('detectSortOrderViolation catches a newer date appearing after older pages were already read', () => {
  const page1Range = computeLastConsultationDateRange([{ lastConsultationDate: '2026-06-29' }, { lastConsultationDate: '2026-06-28' }]);
  const sortedNextPageRange = computeLastConsultationDateRange([{ lastConsultationDate: '2026-06-27' }]);
  const outOfOrderNextPageRange = computeLastConsultationDateRange([{ lastConsultationDate: '2026-06-30' }]);

  assert.equal(detectSortOrderViolation(page1Range, sortedNextPageRange), false);
  assert.equal(detectSortOrderViolation(page1Range, outOfOrderNextPageRange), true);
  assert.equal(detectSortOrderViolation(null, sortedNextPageRange), false);
});

test('regression: a patients table not sorted by last consultation must not let pagination stop early and drop eligible patients', () => {
  // Reproduces the reported bug: the Ecuro directory returns a page full of
  // old patients (say, sorted alphabetically) followed by a page that still
  // has patients eligible for today's NPS dispatch. The naive "stop when the
  // whole page is older than target" heuristic would quit after page 1 and
  // silently drop the eligible patient on page 2.
  const targetDate = '2026-07-01';
  const page1 = mapPatientDirectoryRows({
    headerIndexes: { patientFirstName: 0, patientLastName: 1, patientPhone: 2, lastConsultationDate: 3 },
    rows: [['Ana', 'Alves', '(62) 99966-9966', '20/06/2026']]
  }, { targetDate });
  const page2 = mapPatientDirectoryRows({
    headerIndexes: { patientFirstName: 0, patientLastName: 1, patientPhone: 2, lastConsultationDate: 3 },
    rows: [['Bruno', 'Costa', '(62) 98888-7777', '01/07/2026']]
  }, { targetDate });

  assert.equal(shouldStopWhenOlderThanEligibleDates(page1, [targetDate]), true);

  const page1Range = computeLastConsultationDateRange(page1);
  const page2Range = computeLastConsultationDateRange(page2);
  assert.equal(detectSortOrderViolation(page1Range, page2Range), true, 'the out-of-order page must be detected so early stop is disabled');
});

test('getEcuroRobotConfigStatus exposes safe mapping and visual defaults', () => {
  const status = getEcuroRobotConfigStatus({
    EXTERNAL_PORTAL_BASE_URL: 'https://ecuro.com.br',
    EXTERNAL_PORTAL_LEVEL1_USERNAME: 'user1',
    EXTERNAL_PORTAL_LEVEL1_PASSWORD: 'secret1',
    EXTERNAL_PORTAL_LEVEL2_USERNAME: 'user2',
    EXTERNAL_PORTAL_LEVEL2_PASSWORD: 'secret2',
    ECURO_ROBOT_API_KEY: 'api-key',
    ECURO_MAPPING_ENABLED: 'false',
    ECURO_MAPPING_MAX_PAGES: '10',
    ECURO_ROBOT_VISUAL_MODE: 'false',
    ECURO_ROBOT_VNC_ENABLED: 'false'
  });

  assert.equal(status.mappingEnabled, false);
  assert.equal(status.mappingMaxPages, 10);
  assert.equal(status.visualMode, false);
  assert.equal(status.vncEnabled, false);
  assert.equal(status.debugCapture, false);
});
