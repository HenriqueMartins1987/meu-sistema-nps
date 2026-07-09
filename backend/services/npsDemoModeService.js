const OFFICIAL_NPS_DEMO_PHONE = '5562982458072';

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeBrazilPhoneDigits(value) {
  let digits = onlyDigits(value);
  if (!digits) return '';
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  return /^55\d{10,11}$/.test(digits) ? digits : '';
}

function maskPhone(value) {
  const digits = onlyDigits(value);
  if (!digits) return '';
  const tail = digits.slice(-4);
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${tail}`;
}

function isNpsTestMode(env = process.env) {
  return String(env.NPS_TEST_MODE || '').trim().toLowerCase() === 'true';
}

function getConfiguredNpsTestPhone(env = process.env) {
  return normalizeBrazilPhoneDigits(env.NPS_TEST_PHONE || '');
}

function assertNpsDemoModeConfig(env = process.env) {
  if (!isNpsTestMode(env)) {
    throw new Error('NPS_TEST_MODE precisa estar true para executar o modo demonstracao da NPS.');
  }

  const configuredPhone = getConfiguredNpsTestPhone(env);
  if (!configuredPhone) {
    throw new Error('NPS_TEST_PHONE precisa estar configurado para o modo demonstracao da NPS.');
  }

  if (configuredPhone !== OFFICIAL_NPS_DEMO_PHONE) {
    throw new Error(`NPS_TEST_PHONE deve ser exatamente ${OFFICIAL_NPS_DEMO_PHONE} no modo demonstracao.`);
  }

  return configuredPhone;
}

function resolveNpsDemoRecipient(originalPhone, env = process.env) {
  if (!isNpsTestMode(env)) {
    const normalized = normalizeBrazilPhoneDigits(originalPhone);
    return {
      testMode: false,
      originalPhoneMasked: maskPhone(originalPhone),
      recipientPhone: normalized,
      recipientTwilio: normalized ? `whatsapp:+${normalized}` : ''
    };
  }

  const configuredPhone = assertNpsDemoModeConfig(env);
  return {
    testMode: true,
    originalPhoneMasked: maskPhone(originalPhone),
    recipientPhone: configuredPhone,
    recipientTwilio: `whatsapp:+${configuredPhone}`,
    logLine: [
      '[NPS DEMO MODE]',
      `Destinatario original: ${maskPhone(originalPhone) || 'nao informado'}`,
      `Destinatario utilizado: ${configuredPhone}`,
      'Provider: Twilio',
      'Cenario: inicio do NPS',
      `Timestamp: ${new Date().toISOString()}`
    ].join(' | ')
  };
}

function assertAllowedNpsDemoSend(targetPhone, env = process.env) {
  const resolved = resolveNpsDemoRecipient(targetPhone, env);
  if (resolved.testMode && resolved.recipientPhone !== OFFICIAL_NPS_DEMO_PHONE) {
    throw new Error('Envio bloqueado: numero de demonstracao NPS invalido.');
  }
  return resolved;
}

module.exports = {
  OFFICIAL_NPS_DEMO_PHONE,
  assertAllowedNpsDemoSend,
  assertNpsDemoModeConfig,
  getConfiguredNpsTestPhone,
  isNpsTestMode,
  maskPhone,
  normalizeBrazilPhoneDigits,
  resolveNpsDemoRecipient
};
