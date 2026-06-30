const test = require('node:test');
const assert = require('node:assert/strict');

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
  getEcuroRobotConfigStatus,
  matchCompletionRows,
  mapPatientDirectoryRows,
  normalizeBrazilianDate,
  normalizeEcuroCompletionStatus,
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

test('getNpsAutomationConfig prioritizes the configured whatsapp session', () => {
  const config = getNpsAutomationConfig({
    NPS_WHATSAPP_SESSION_ID: 'reclamacoes',
    WHATSAPP_NPS_INSTANCE_NAME: 'nps'
  });

  assert.equal(config.sessionId, 'reclamacoes');
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
});
