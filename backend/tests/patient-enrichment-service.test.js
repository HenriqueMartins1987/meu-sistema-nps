const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  deriveContactStatus,
  getRobotConfigStatus,
  maskPhone,
  normalizePhone,
  resolveAppointmentDateMatchStatus
} = require('../services/patientEnrichmentService');

test('normalizePhone converts common brazilian formats to E.164', () => {
  assert.deepEqual(
    normalizePhone('(62) 99999-1234'),
    {
      raw: '(62) 99999-1234',
      nationalDigits: '62999991234',
      normalized: '+5562999991234',
      valid: true,
      reason: null
    }
  );

  assert.equal(normalizePhone('5562999991234').normalized, '+5562999991234');
  assert.equal(normalizePhone('999991234').valid, false);
});

test('resolveAppointmentDateMatchStatus respects strong identity rules', () => {
  assert.equal(resolveAppointmentDateMatchStatus({
    appointmentDate: '2026-06-22',
    externalDate: '2026-06-22',
    strongIdentity: true
  }), 'matched');

  assert.equal(resolveAppointmentDateMatchStatus({
    appointmentDate: '2026-06-22',
    externalDate: null,
    strongIdentity: false
  }), 'review_required');

  assert.equal(resolveAppointmentDateMatchStatus({
    appointmentDate: '2026-06-22',
    externalDate: '2026-06-21',
    strongIdentity: true
  }), 'mismatch');
});

test('deriveContactStatus prioritizes blockers before freshness', () => {
  assert.equal(deriveContactStatus({ accessDenied: true }), 'access_denied');
  assert.equal(deriveContactStatus({ clinicMismatch: true }), 'clinic_mismatch');
  assert.equal(deriveContactStatus({ dateMatchStatus: 'mismatch' }), 'date_mismatch');
  assert.equal(deriveContactStatus({ reviewRequired: true, phoneNormalized: '+5562999991234' }), 'review_required');
  assert.equal(deriveContactStatus({ phoneNormalized: '+5562999991234', foundByRobot: true }), 'found_by_robot');
});

test('buildWhatsAppUrl and message use normalized phone and encoded body', () => {
  const message = buildWhatsAppMessage('', {
    patientName: 'João Silva',
    clinicName: 'Unidade Centro',
    appointmentDateLabel: '22/06/2026',
    appointmentTimeLabel: '08:15'
  });

  assert.match(message, /João Silva/);
  assert.match(message, /22\/06\/2026 às 08:15/);

  const url = buildWhatsAppUrl('(62) 99999-1234', message);
  assert.match(url, /^https:\/\/wa\.me\/5562999991234\?text=/);
  assert.match(maskPhone('+5562999991234'), /^\+55 62 \*+\-1234$/);
});

test('getRobotConfigStatus only reports readiness without exposing secrets', () => {
  const status = getRobotConfigStatus({
    EXTERNAL_PORTAL_BASE_URL: 'https://portal.externo.test',
    EXTERNAL_PORTAL_LEVEL1_USERNAME: 'nivel1',
    EXTERNAL_PORTAL_LEVEL1_PASSWORD: 'secret',
    EXTERNAL_PORTAL_LEVEL2_USERNAME: 'nivel2',
    EXTERNAL_PORTAL_LEVEL2_PASSWORD: 'secret2',
    ROBOT_ENABLE_AUTO_AFTER_UPLOAD: 'true'
  });

  assert.equal(status.configured, true);
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'level1Password'), false);
  assert.equal(status.autoAfterUpload, true);
});
