const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OFFICIAL_NPS_DEMO_PHONE,
  assertAllowedNpsDemoSend,
  assertNpsDemoModeConfig,
  resolveNpsDemoRecipient
} = require('../services/npsDemoModeService');
const {
  NPS_CONVERSATION_STATES,
  advanceConversationState,
  buildAudioTranscriptionConfirmationMessage,
  calculateNpsMetricsFromScores,
  classifyNpsScore,
  extractNpsScore,
  parseReferralText
} = require('../services/npsTwilioConversationService');
const {
  transcribeAudioBuffer
} = require('../services/audioTranscriptionService');
const {
  normalizeTwilioInboundPayload
} = require('../services/npsTwilioDemoFlowService');

test('nps twilio demo protects the official test number', () => {
  const env = {
    NPS_TEST_MODE: 'true',
    NPS_TEST_PHONE: OFFICIAL_NPS_DEMO_PHONE
  };

  assert.equal(assertNpsDemoModeConfig(env), OFFICIAL_NPS_DEMO_PHONE);

  const resolved = resolveNpsDemoRecipient('5562999999999', env);
  assert.equal(resolved.testMode, true);
  assert.equal(resolved.recipientPhone, OFFICIAL_NPS_DEMO_PHONE);
  assert.match(resolved.logLine, /\[NPS DEMO MODE\]/);
  assert.match(resolved.logLine, /Provider: Twilio/);
  assert.doesNotMatch(resolved.logLine, /TWILIO_AUTH_TOKEN/);

  assert.equal(assertAllowedNpsDemoSend('11999999999', env).recipientPhone, OFFICIAL_NPS_DEMO_PHONE);
});

test('nps twilio demo refuses any test phone different from the official number', () => {
  assert.throws(() => assertNpsDemoModeConfig({
    NPS_TEST_MODE: 'true',
    NPS_TEST_PHONE: '5562999669966'
  }), /5562982458072/);
});

test('nps score parser accepts numeric and textual scores', () => {
  assert.equal(extractNpsScore('0'), 0);
  assert.equal(extractNpsScore('10'), 10);
  assert.equal(extractNpsScore('Minha nota é 10'), 10);
  assert.equal(extractNpsScore('Dou 8'), 8);
  assert.equal(extractNpsScore('Nota 5'), 5);
  assert.equal(extractNpsScore('Pra mim foi 9'), 9);
  assert.equal(extractNpsScore('Eu daria nota dez'), 10);
  assert.equal(extractNpsScore('nota onze'), null);
  assert.equal(extractNpsScore('20'), null);
});

test('nps score classification follows 0-6 detractor, 7-8 neutral, 9-10 promoter', () => {
  assert.equal(classifyNpsScore(10), 'promotor');
  assert.equal(classifyNpsScore(9), 'promotor');
  assert.equal(classifyNpsScore(8), 'neutro');
  assert.equal(classifyNpsScore(7), 'neutro');
  assert.equal(classifyNpsScore(6), 'detrator');
  assert.equal(classifyNpsScore(0), 'detrator');
  assert.equal(classifyNpsScore(11), null);
});

test('nps formula ignores unanswered invites', () => {
  const metrics = calculateNpsMetricsFromScores([
    10,
    9,
    8,
    6,
    null,
    undefined,
    { status: 'sent' }
  ]);

  assert.equal(metrics.total, 4);
  assert.equal(metrics.promoters, 2);
  assert.equal(metrics.neutrals, 1);
  assert.equal(metrics.detractors, 1);
  assert.equal(metrics.nps, 25);
});

test('conversation score states branch to promoter, neutral and detractor journeys', () => {
  const promoter = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE, { text: '10' });
  assert.equal(promoter.action, 'score_received');
  assert.equal(promoter.profile, 'promotor');
  assert.equal(promoter.nextState, NPS_CONVERSATION_STATES.AWAITING_REFERRAL_DECISION);

  const neutral = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE, { text: '8' });
  assert.equal(neutral.profile, 'neutro');
  assert.equal(neutral.nextState, NPS_CONVERSATION_STATES.NEUTRAL_FEEDBACK);

  const detractor = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE, { text: '0' });
  assert.equal(detractor.profile, 'detrator');
  assert.equal(detractor.nextState, NPS_CONVERSATION_STATES.DETRACTOR_REPORT);
});

test('conversation handles invalid score without changing state', () => {
  const result = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE, { text: 'gostei' });
  assert.equal(result.action, 'invalid_score');
  assert.equal(result.nextState, NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE);
  assert.match(result.reply, /nota de 0 a 10/i);
});

test('promoter referral decision accepts and declines with textual fallback', () => {
  const accepted = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_REFERRAL_DECISION, { text: '1' });
  assert.equal(accepted.action, 'referral_accepted');
  assert.equal(accepted.nextState, NPS_CONVERSATION_STATES.AWAITING_REFERRAL_CONTACT);

  const declined = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_REFERRAL_DECISION, { text: 'Agora não' });
  assert.equal(declined.action, 'referral_declined');
  assert.equal(declined.nextState, NPS_CONVERSATION_STATES.COMPLETED);
});

test('referral parser accepts text contact and rejects invalid phone', () => {
  const valid = parseReferralText('Maria Silva\n(62) 99999-9999');
  assert.equal(valid.valid, true);
  assert.equal(valid.referralName, 'Maria Silva');
  assert.equal(valid.referralPhone, '+5562999999999');

  const phoneOnly = parseReferralText('+55 62 98245-8072');
  assert.equal(phoneOnly.valid, true);
  assert.equal(phoneOnly.referralName, 'Indicado via NPS');

  const invalid = parseReferralText('Maria sem telefone');
  assert.equal(invalid.valid, false);
  assert.equal(invalid.error, 'invalid_phone');
});

test('conversation accepts multiple referrals and finalization', () => {
  const first = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_REFERRAL_CONTACT, {
    text: 'Maria Silva 62999999999'
  });
  assert.equal(first.action, 'referral_received');
  assert.equal(first.nextState, NPS_CONVERSATION_STATES.AWAITING_MORE_REFERRALS);

  const more = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_MORE_REFERRALS, { text: '1' });
  assert.equal(more.action, 'more_referrals');
  assert.equal(more.nextState, NPS_CONVERSATION_STATES.AWAITING_REFERRAL_CONTACT);

  const finish = advanceConversationState(NPS_CONVERSATION_STATES.AWAITING_MORE_REFERRALS, { text: 'Finalizar' });
  assert.equal(finish.action, 'conversation_completed');
  assert.equal(finish.nextState, NPS_CONVERSATION_STATES.COMPLETED);
});

test('neutral and detractor text reports complete the flow', () => {
  const neutral = advanceConversationState(NPS_CONVERSATION_STATES.NEUTRAL_FEEDBACK, {
    text: 'Poderia reduzir o tempo de espera.'
  });
  assert.equal(neutral.action, 'neutral_feedback_received');
  assert.equal(neutral.nextState, NPS_CONVERSATION_STATES.COMPLETED);

  const detractor = advanceConversationState(NPS_CONVERSATION_STATES.DETRACTOR_REPORT, {
    text: 'Meu atendimento atrasou muito.'
  });
  assert.equal(detractor.action, 'detractor_feedback_received');
  assert.equal(detractor.nextState, NPS_CONVERSATION_STATES.COMPLETED);
});

test('audio payload moves neutral and detractor flows to transcription confirmation', () => {
  const neutralAudio = advanceConversationState(NPS_CONVERSATION_STATES.NEUTRAL_FEEDBACK, {
    isAudio: true,
    mediaUrl: 'https://example.com/audio.ogg',
    mimeType: 'audio/ogg'
  });
  assert.equal(neutralAudio.action, 'transcribe_audio');
  assert.equal(neutralAudio.nextState, NPS_CONVERSATION_STATES.AUDIO_TRANSCRIPTION_CONFIRMATION);

  const message = buildAudioTranscriptionConfirmationMessage('Relato transcrito.');
  assert.match(message, /Recebemos sua mensagem de áudio/);
  assert.match(message, /Relato transcrito/);
});

test('audio transcription confirmation and correction are explicit states', () => {
  const confirmed = advanceConversationState(NPS_CONVERSATION_STATES.AUDIO_TRANSCRIPTION_CONFIRMATION, {
    text: 'Sim, está correto'
  });
  assert.equal(confirmed.action, 'transcription_confirmed');
  assert.equal(confirmed.nextState, NPS_CONVERSATION_STATES.COMPLETED);

  const correction = advanceConversationState(NPS_CONVERSATION_STATES.AUDIO_TRANSCRIPTION_CONFIRMATION, {
    text: 'Preciso corrigir'
  });
  assert.equal(correction.action, 'transcription_correction_requested');
  assert.equal(correction.nextState, NPS_CONVERSATION_STATES.MANUAL_REVIEW);
});

test('audio transcription service handles success and API failure safely', async () => {
  const success = await transcribeAudioBuffer(Buffer.from('audio'), {
    config: {
      enabled: true,
      apiKey: 'test-key',
      model: 'gpt-4o-transcribe',
      timeoutMs: 1000
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: 'Transcricao teste' })
    })
  });
  assert.equal(success.success, true);
  assert.equal(success.status, 'TRANSCRIBED');
  assert.equal(success.transcript, 'Transcricao teste');

  const failure = await transcribeAudioBuffer(Buffer.from('audio'), {
    config: {
      enabled: true,
      apiKey: 'test-key',
      model: 'gpt-4o-transcribe',
      timeoutMs: 1000
    },
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'indisponivel' } })
    })
  });
  assert.equal(failure.success, false);
  assert.equal(failure.status, 'FAILED');
  assert.match(failure.error, /indisponivel/);
});

test('twilio inbound payload normalization supports MessageSid and audio media', () => {
  const payload = normalizeTwilioInboundPayload({
    MessageSid: 'SM123',
    From: 'whatsapp:+5562982458072',
    Body: 'Minha nota é 10',
    NumMedia: '1',
    MediaUrl0: 'https://api.twilio.com/media',
    MediaContentType0: 'audio/ogg'
  });

  assert.equal(payload.messageId, 'twilio:SM123');
  assert.equal(payload.patientPhone, '+5562982458072');
  assert.equal(payload.text, 'Minha nota é 10');
  assert.equal(payload.isAudio, true);
});
