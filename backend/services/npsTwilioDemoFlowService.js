const crypto = require('crypto');
const axios = require('axios');

const {
  OFFICIAL_NPS_DEMO_PHONE,
  assertAllowedNpsDemoSend,
  assertNpsDemoModeConfig,
  normalizeBrazilPhoneDigits,
  resolveNpsDemoRecipient
} = require('./npsDemoModeService');
const {
  AUDIO_TRANSCRIPTION_STATUSES,
  NPS_CONVERSATION_STATES,
  advanceConversationState,
  buildAudioTranscriptionConfirmationMessage,
  buildInitialNpsMessage,
  classifyNpsScore,
  extractNpsScore,
  isAudioPayload,
  parseReferralText
} = require('./npsTwilioConversationService');
const {
  sendGenericNotification
} = require('./twilioWhatsAppService');
const {
  transcribeAudioBuffer
} = require('./audioTranscriptionService');

const DEMO_SOURCE = 'twilio_nps_demo';
const DEMO_PATIENT_NAME = 'Mariana Oliveira';
const DEMO_CLINIC_NAME = 'Unidade Demonstracao';
const DEMO_IDEMPOTENCY_KEY = `nps-demo-${OFFICIAL_NPS_DEMO_PHONE}`;

function toMysqlDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizePatientPhoneForDb(value) {
  const digits = normalizeBrazilPhoneDigits(value);
  return digits ? `+${digits}` : '';
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch (error) {
    return '{}';
  }
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);
}

function normalizeTwilioInboundPayload(body = {}) {
  const rawFrom = body.From || body.from || body.WaId || body.phone || body.patient_phone || '';
  const rawText = body.Body || body.body || body.message || body.text || body.ButtonPayload || body.ButtonText || '';
  const messageSid = body.MessageSid || body.SmsMessageSid || body.SmsSid || body.messageSid || body.messageId || body.message_id || '';
  const mediaUrl = body.MediaUrl0 || body.mediaUrl || body.media_url || '';
  const mimeType = body.MediaContentType0 || body.mimeType || body.media_mime_type || '';
  const phoneDigits = normalizeBrazilPhoneDigits(rawFrom);

  return {
    messageSid: String(messageSid || '').trim(),
    messageId: String(messageSid || '').trim() ? `twilio:${String(messageSid).trim()}` : '',
    from: rawFrom,
    phoneDigits,
    patientPhone: phoneDigits ? `+${phoneDigits}` : '',
    text: String(rawText || '').trim(),
    mediaUrl: String(mediaUrl || '').trim(),
    mimeType: String(mimeType || '').trim(),
    isAudio: isAudioPayload({ mediaUrl, mimeType, MediaUrl0: mediaUrl, MediaContentType0: mimeType }),
    rawPayload: body
  };
}

async function sendNpsTwilioText({ to, message, eventType = 'NPS_DEMO_CONVERSATION', sendTextImpl = null }) {
  assertNpsDemoModeConfig();
  const recipient = assertAllowedNpsDemoSend(to);
  if (recipient.logLine) {
    console.info(recipient.logLine);
  }

  const sender = sendTextImpl || (async (payload) => sendGenericNotification({
    to: payload.to,
    message: payload.message,
    eventType: payload.eventType
  }));

  return sender({
    to: recipient.recipientPhone,
    message,
    eventType,
    provider: 'twilio'
  });
}

async function findDemoInvite(pool) {
  const [rows] = await pool.query(
    `SELECT *
       FROM nps_invites
      WHERE idempotency_key = ?
      ORDER BY id DESC
      LIMIT 1`,
    [DEMO_IDEMPOTENCY_KEY]
  );
  return rows[0] || null;
}

async function createOrReuseDemoInvite(pool, payload = {}) {
  const existing = await findDemoInvite(pool);
  if (existing) return existing;

  const token = `demo-${hashToken(`${DEMO_IDEMPOTENCY_KEY}-${Date.now()}`)}`;
  const patientName = payload.patientName || DEMO_PATIENT_NAME;
  const patientPhone = normalizePatientPhoneForDb(payload.patientPhone || OFFICIAL_NPS_DEMO_PHONE);
  const clinicName = payload.clinicName || DEMO_CLINIC_NAME;

  const [result] = await pool.query(
    `INSERT INTO nps_invites
     (token, clinic_id, clinic_name, patient_name, patient_phone, source, session_id, status, public_url, idempotency_key, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token,
      payload.clinicId || null,
      clinicName,
      patientName,
      patientPhone,
      DEMO_SOURCE,
      'twilio_nps_demo',
      'pending',
      null,
      DEMO_IDEMPOTENCY_KEY,
      'NPS Twilio Demo'
    ]
  );

  const [rows] = await pool.query('SELECT * FROM nps_invites WHERE id = ? LIMIT 1', [result.insertId]);
  return rows[0] || {
    id: result.insertId,
    token,
    patient_name: patientName,
    patient_phone: patientPhone,
    clinic_name: clinicName,
    source: DEMO_SOURCE,
    session_id: 'twilio_nps_demo'
  };
}

async function createOrReuseDemoConversation(pool, inviteRow, payload = {}) {
  const [existingRows] = await pool.query(
    `SELECT *
       FROM nps_twilio_conversations
      WHERE nps_invite_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [inviteRow.id]
  );

  if (existingRows[0]) return existingRows[0];

  const conversationId = `demo-${hashToken(`${inviteRow.id}-${OFFICIAL_NPS_DEMO_PHONE}`)}`;
  const [result] = await pool.query(
    `INSERT INTO nps_twilio_conversations
     (conversation_id, nps_invite_id, patient_name, patient_phone, patient_phone_normalized, clinic_id, clinic_name, provider, source, state, is_demo, demo_scenario, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'TWILIO', ?, ?, 1, ?, ?)`,
    [
      conversationId,
      inviteRow.id,
      inviteRow.patient_name || DEMO_PATIENT_NAME,
      inviteRow.patient_phone || normalizePatientPhoneForDb(OFFICIAL_NPS_DEMO_PHONE),
      normalizePatientPhoneForDb(inviteRow.patient_phone || OFFICIAL_NPS_DEMO_PHONE),
      inviteRow.clinic_id || null,
      inviteRow.clinic_name || DEMO_CLINIC_NAME,
      DEMO_SOURCE,
      NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE,
      payload.scenario || null,
      safeJson({ demo: true })
    ]
  );

  const [rows] = await pool.query('SELECT * FROM nps_twilio_conversations WHERE id = ? LIMIT 1', [result.insertId]);
  return rows[0] || {
    id: result.insertId,
    conversation_id: conversationId,
    nps_invite_id: inviteRow.id,
    state: NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE,
    patient_name: inviteRow.patient_name || DEMO_PATIENT_NAME,
    patient_phone_normalized: normalizePatientPhoneForDb(inviteRow.patient_phone || OFFICIAL_NPS_DEMO_PHONE),
    clinic_name: inviteRow.clinic_name || DEMO_CLINIC_NAME
  };
}

async function updateConversation(pool, conversationId, payload = {}) {
  await pool.query(
    `UPDATE nps_twilio_conversations
        SET state = COALESCE(?, state),
            nps_score = COALESCE(?, nps_score),
            nps_profile = COALESCE(?, nps_profile),
            nps_response_id = COALESCE(?, nps_response_id),
            last_message_sid = COALESCE(?, last_message_sid),
            last_inbound_at = COALESCE(?, last_inbound_at),
            last_outbound_at = COALESCE(?, last_outbound_at),
            metadata_json = COALESCE(?, metadata_json),
            updated_at = NOW()
      WHERE id = ?`,
    [
      payload.state || null,
      payload.npsScore === undefined ? null : payload.npsScore,
      payload.npsProfile || null,
      payload.npsResponseId || null,
      payload.lastMessageSid || null,
      payload.lastInboundAt || null,
      payload.lastOutboundAt || null,
      payload.metadataJson || null,
      conversationId
    ]
  );
}

async function insertConversationEvent(pool, payload = {}) {
  const [result] = await pool.query(
    `INSERT INTO nps_twilio_conversation_events
     (conversation_id, nps_invite_id, nps_response_id, message_sid, direction, provider, state_before, state_after, message_type, source_type, body, transcription_text, transcription_status, metadata_json)
     VALUES (?, ?, ?, ?, ?, 'TWILIO', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.conversationId || null,
      payload.npsInviteId || null,
      payload.npsResponseId || null,
      payload.messageSid || null,
      payload.direction || 'inbound',
      payload.stateBefore || null,
      payload.stateAfter || null,
      payload.messageType || null,
      payload.sourceType || 'TEXT',
      payload.body || null,
      payload.transcriptionText || null,
      payload.transcriptionStatus || null,
      payload.metadataJson || null
    ]
  );
  return Number(result.insertId || 0) || null;
}

async function insertInboundEvent(pool, payload = {}) {
  try {
    const [result] = await pool.query(
      `INSERT INTO nps_whatsapp_inbound_events
       (message_id, session_id, patient_phone, message_text, processed_status, raw_payload_json, nps_invite_id, nps_response_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.messageId,
        'twilio_nps_demo',
        payload.patientPhone || null,
        payload.messageText || null,
        payload.processedStatus || 'pending',
        payload.rawPayloadJson || null,
        payload.npsInviteId || null,
        payload.npsResponseId || null
      ]
    );
    return { duplicate: false, id: Number(result.insertId || 0) || null };
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return { duplicate: true, id: null };
    }
    throw error;
  }
}

async function updateInboundEvent(pool, id, payload = {}) {
  if (!id) return;
  await pool.query(
    `UPDATE nps_whatsapp_inbound_events
        SET processed_status = COALESCE(?, processed_status),
            raw_payload_json = COALESCE(?, raw_payload_json),
            nps_invite_id = COALESCE(?, nps_invite_id),
            nps_response_id = COALESCE(?, nps_response_id),
            updated_at = NOW()
      WHERE id = ?`,
    [
      payload.processedStatus || null,
      payload.rawPayloadJson || null,
      payload.npsInviteId || null,
      payload.npsResponseId || null,
      id
    ]
  );
}

async function findActiveConversationByPhone(pool, phoneDigits) {
  const normalized = normalizePatientPhoneForDb(phoneDigits);
  if (!normalized) return null;
  const [rows] = await pool.query(
    `SELECT c.*, i.patient_name AS invite_patient_name, i.clinic_name AS invite_clinic_name, i.patient_phone AS invite_patient_phone
       FROM nps_twilio_conversations c
       LEFT JOIN nps_invites i ON i.id = c.nps_invite_id
      WHERE c.patient_phone_normalized = ?
      ORDER BY CASE WHEN c.state IN ('COMPLETED') THEN 1 ELSE 0 END, c.updated_at DESC, c.id DESC
      LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
}

async function createOrUpdateNpsResponseForScore(pool, conversation, score, inboundPayload) {
  if (conversation.nps_response_id) {
    return { id: conversation.nps_response_id, duplicate: true };
  }

  const profile = classifyNpsScore(score);
  const feedbackType = profile === 'promotor' ? 'Elogio' : profile === 'neutro' ? 'Sugestao' : 'Reclamacao';
  const [result] = await pool.query(
    `INSERT INTO nps_responses
     (clinic_id, clinic_name, patient_name, patient_phone, score, comment, feedback_type, nps_profile, source, ecuro_nps_invite_id, whatsapp_inbound_message_id, response_channel, nps_status, responded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'whatsapp', 'registrado', NOW())`,
    [
      conversation.clinic_id || null,
      conversation.clinic_name || conversation.invite_clinic_name || DEMO_CLINIC_NAME,
      conversation.patient_name || conversation.invite_patient_name || DEMO_PATIENT_NAME,
      conversation.patient_phone_normalized || normalizePatientPhoneForDb(inboundPayload.phoneDigits),
      score,
      null,
      feedbackType,
      profile,
      DEMO_SOURCE,
      conversation.nps_invite_id || null,
      inboundPayload.messageId || null
    ]
  );
  const responseId = Number(result.insertId || 0) || null;
  await pool.query('UPDATE nps_responses SET nps_protocol = ? WHERE id = ?', [`NPS-${String(responseId).padStart(6, '0')}`, responseId]);
  await pool.query(
    `UPDATE nps_invites
        SET status = 'responded',
            responded_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [conversation.nps_invite_id]
  );
  return { id: responseId, duplicate: false };
}

async function appendNpsTextField(pool, responseId, column, value) {
  if (!responseId || !value) return;
  const safeColumns = new Set(['comment', 'improvement_comment', 'detractor_feedback']);
  if (!safeColumns.has(column)) throw new Error('Coluna NPS invalida para comentario.');
  await pool.query(
    `UPDATE nps_responses
        SET \`${column}\` = CASE
              WHEN \`${column}\` IS NULL OR \`${column}\` = '' THEN ?
              ELSE CONCAT(\`${column}\`, '\n\n', ?)
            END
      WHERE id = ?`,
    [value, value, responseId]
  );
}

async function saveNpsReferral(pool, conversation, referral) {
  const responseId = Number(conversation.nps_response_id || 0) || null;
  const inviteId = Number(conversation.nps_invite_id || 0) || null;
  const referralPhone = referral.referralPhone || null;
  const [existingRows] = await pool.query(
    `SELECT id
       FROM nps_referrals
      WHERE ((? IS NOT NULL AND nps_response_id = ?) OR (? IS NOT NULL AND nps_invite_id = ?))
        AND referral_phone = ?
      LIMIT 1`,
    [responseId, responseId, inviteId, inviteId, referralPhone]
  );

  if (existingRows[0]) {
    return { saved: true, duplicate: true, id: Number(existingRows[0].id) };
  }

  const [result] = await pool.query(
    `INSERT INTO nps_referrals
     (nps_response_id, nps_invite_id, clinic_id, clinic_name, referrer_patient_name, referrer_patient_phone, referral_name, referral_phone, referral_status, referral_accepted_at, referral_received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', NOW(), NOW())`,
    [
      responseId,
      inviteId,
      conversation.clinic_id || null,
      conversation.clinic_name || conversation.invite_clinic_name || DEMO_CLINIC_NAME,
      conversation.patient_name || conversation.invite_patient_name || DEMO_PATIENT_NAME,
      conversation.patient_phone_normalized || null,
      referral.referralName || 'Indicado via NPS',
      referralPhone
    ]
  );

  if (responseId) {
    await pool.query(
      `UPDATE nps_responses
          SET recommend_yes = 1,
              contact_share_allowed = 1,
              referral_name = ?,
              referral_phone = ?
        WHERE id = ?`,
      [referral.referralName || 'Indicado via NPS', referralPhone, responseId]
    );
  }

  return { saved: true, duplicate: false, id: Number(result.insertId || 0) || null };
}

async function createDentalCardLeadFromReferral(pool, conversation, referral, npsReferralId = null) {
  const referralPhoneDigits = normalizeBrazilPhoneDigits(referral.referralPhone || '');
  if (!referralPhoneDigits) return { created: false, reason: 'invalid_phone' };

  const [existingRows] = await pool.query(
    `SELECT id
       FROM dental_card_leads
      WHERE telefone = ?
        AND origem_cadastro = 'NPS_WHATSAPP_REFERRAL'
        AND deleted_at IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    [referralPhoneDigits]
  );
  if (existingRows[0]) {
    return { created: false, duplicate: true, id: Number(existingRows[0].id) };
  }

  const [result] = await pool.query(
    `INSERT INTO dental_card_leads
     (data_indicacao, unidade, nome_lead, telefone, nome_indicador, tipo_indicador, origem, origem_cadastro, responsavel_cadastro, status, canal_contato, observacoes, created_by, updated_by)
     VALUES (CURDATE(), ?, ?, ?, ?, 'Paciente NPS Promotor', 'NPS', 'NPS_WHATSAPP_REFERRAL', 'Automacao NPS Twilio', 'Novo Lead', 'WhatsApp', ?, 'NPS Twilio Demo', 'NPS Twilio Demo')`,
    [
      conversation.clinic_name || conversation.invite_clinic_name || DEMO_CLINIC_NAME,
      referral.referralName || 'Indicado via NPS',
      referralPhoneDigits,
      conversation.patient_name || conversation.invite_patient_name || DEMO_PATIENT_NAME,
      [
        'Indicacao recebida pelo fluxo conversacional NPS via WhatsApp/Twilio.',
        `Invite NPS: ${conversation.nps_invite_id || 'nao informado'}.`,
        `Conversa: ${conversation.conversation_id || 'nao informada'}.`,
        npsReferralId ? `Referencia NPS: ${npsReferralId}.` : ''
      ].filter(Boolean).join('\n')
    ]
  );

  if (npsReferralId) {
    await pool.query(
      `INSERT INTO nps_referral_dental_card_links
       (nps_referral_id, dental_card_lead_id, nps_response_id, nps_invite_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE dental_card_lead_id = VALUES(dental_card_lead_id), updated_at = NOW()`,
      [
        npsReferralId,
        result.insertId,
        conversation.nps_response_id || null,
        conversation.nps_invite_id || null
      ]
    );
  }

  return { created: true, id: Number(result.insertId || 0) || null };
}

async function downloadTwilioMedia(mediaUrl) {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!accountSid || !authToken) {
    throw new Error('Credenciais Twilio ausentes para baixar midia.');
  }
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    auth: {
      username: accountSid,
      password: authToken
    }
  });
  return Buffer.from(response.data || []);
}

async function handleAudioInbound(pool, conversation, inbound, options = {}) {
  const targetState = conversation.state;
  let transcriptionResult;
  try {
    const audioBuffer = options.mediaBuffer || await downloadTwilioMedia(inbound.mediaUrl);
    transcriptionResult = await transcribeAudioBuffer(audioBuffer, {
      mimeType: inbound.mimeType,
      fileName: 'twilio-audio.ogg',
      fetchImpl: options.fetchImpl
    });
  } catch (error) {
    transcriptionResult = {
      success: false,
      status: AUDIO_TRANSCRIPTION_STATUSES.FAILED,
      error: error.message || 'Falha ao processar audio.'
    };
  }

  const [result] = await pool.query(
    `INSERT INTO nps_audio_transcriptions
     (conversation_id, nps_response_id, message_sid, media_url, mime_type, status, model, transcript, error_message, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conversation.id,
      conversation.nps_response_id || null,
      inbound.messageSid || null,
      inbound.mediaUrl || null,
      inbound.mimeType || null,
      transcriptionResult.status || AUDIO_TRANSCRIPTION_STATUSES.FAILED,
      transcriptionResult.model || process.env.AUDIO_TRANSCRIPTION_MODEL || null,
      transcriptionResult.transcript || null,
      transcriptionResult.success ? null : transcriptionResult.error || null,
      safeJson({ targetState })
    ]
  );

  if (!transcriptionResult.success) {
    await updateConversation(pool, conversation.id, {
      state: NPS_CONVERSATION_STATES.MANUAL_REVIEW,
      metadataJson: safeJson({ audioTargetState: targetState, transcriptionId: result.insertId, transcriptionStatus: transcriptionResult.status })
    });
    return {
      action: 'audio_transcription_failed',
      transcriptionId: result.insertId,
      reply: 'Recebemos seu áudio, mas não conseguimos transcrever automaticamente neste momento. Para garantir o registro correto, por favor envie seu relato também por texto.',
      nextState: NPS_CONVERSATION_STATES.MANUAL_REVIEW
    };
  }

  const reply = buildAudioTranscriptionConfirmationMessage(transcriptionResult.transcript);
  await updateConversation(pool, conversation.id, {
    state: NPS_CONVERSATION_STATES.AUDIO_TRANSCRIPTION_CONFIRMATION,
    metadataJson: safeJson({ audioTargetState: targetState, transcriptionId: result.insertId, transcript: transcriptionResult.transcript })
  });

  return {
    action: 'audio_transcribed',
    transcriptionId: result.insertId,
    transcript: transcriptionResult.transcript,
    reply,
    nextState: NPS_CONVERSATION_STATES.AUDIO_TRANSCRIPTION_CONFIRMATION
  };
}

async function confirmLatestAudioTranscription(pool, conversation, confirmed) {
  const [rows] = await pool.query(
    `SELECT *
       FROM nps_audio_transcriptions
      WHERE conversation_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [conversation.id]
  );
  const transcription = rows[0] || null;
  if (!transcription) return { updated: false, reason: 'not_found' };

  if (!confirmed) {
    await pool.query(
      `UPDATE nps_audio_transcriptions
          SET status = 'CORRECTION_REQUESTED',
              correction_requested_at = NOW(),
              updated_at = NOW()
        WHERE id = ?`,
      [transcription.id]
    );
    return { updated: true, confirmed: false };
  }

  await pool.query(
    `UPDATE nps_audio_transcriptions
        SET status = 'CONFIRMED',
            confirmed_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [transcription.id]
  );

  const metadata = JSON.parse(conversation.metadata_json || '{}');
  const targetState = metadata.audioTargetState;
  const transcriptText = `[Audio transcrito e confirmado]\n${transcription.transcript || metadata.transcript || ''}`;
  if (targetState === NPS_CONVERSATION_STATES.NEUTRAL_FEEDBACK) {
    await appendNpsTextField(pool, conversation.nps_response_id, 'improvement_comment', transcriptText);
  }
  if (targetState === NPS_CONVERSATION_STATES.DETRACTOR_REPORT) {
    await appendNpsTextField(pool, conversation.nps_response_id, 'detractor_feedback', transcriptText);
  }

  return { updated: true, confirmed: true, targetState };
}

async function startNpsDemo(pool, options = {}) {
  assertNpsDemoModeConfig();
  const recipient = resolveNpsDemoRecipient(options.patientPhone || OFFICIAL_NPS_DEMO_PHONE);
  if (recipient.logLine) console.info(recipient.logLine);

  const invite = await createOrReuseDemoInvite(pool, {
    patientName: options.patientName || DEMO_PATIENT_NAME,
    clinicName: options.clinicName || DEMO_CLINIC_NAME,
    patientPhone: recipient.recipientPhone,
    scenario: options.scenario || null
  });
  const conversation = await createOrReuseDemoConversation(pool, invite, options);
  const message = buildInitialNpsMessage(invite.patient_name || DEMO_PATIENT_NAME);

  const sendResult = await sendNpsTwilioText({
    to: recipient.recipientPhone,
    message,
    eventType: 'NPS_DEMO_START',
    sendTextImpl: options.sendTextImpl || null
  });

  await updateConversation(pool, conversation.id, {
    state: NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE,
    lastOutboundAt: toMysqlDateTime(new Date()),
    lastMessageSid: sendResult?.providerMessageId || sendResult?.twilioSid || null
  });
  await pool.query(
    `UPDATE nps_invites
        SET status = ?,
            provider_message_id = COALESCE(?, provider_message_id),
            sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, NOW()) ELSE sent_at END,
            updated_at = NOW()
      WHERE id = ?`,
    [
      sendResult?.success ? 'sent' : 'pending',
      sendResult?.providerMessageId || sendResult?.twilioSid || null,
      sendResult?.success ? 'sent' : 'pending',
      invite.id
    ]
  );

  return {
    success: Boolean(sendResult?.success),
    skipped: Boolean(sendResult?.skipped),
    error: sendResult?.error || null,
    inviteId: invite.id,
    conversationId: conversation.conversation_id,
    recipient: recipient.recipientPhone,
    state: NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE,
    providerMessageId: sendResult?.providerMessageId || sendResult?.twilioSid || null
  };
}

async function resetNpsDemo(pool) {
  const [inviteRows] = await pool.query(
    'SELECT id FROM nps_invites WHERE source = ? OR idempotency_key = ?',
    [DEMO_SOURCE, DEMO_IDEMPOTENCY_KEY]
  );
  const inviteIds = inviteRows.map((row) => Number(row.id)).filter(Boolean);

  if (inviteIds.length) {
    await pool.query(`DELETE FROM nps_referral_dental_card_links WHERE nps_invite_id IN (${inviteIds.map(() => '?').join(',')})`, inviteIds);
    await pool.query(`DELETE FROM nps_referrals WHERE nps_invite_id IN (${inviteIds.map(() => '?').join(',')})`, inviteIds);
    await pool.query(`DELETE FROM nps_responses WHERE ecuro_nps_invite_id IN (${inviteIds.map(() => '?').join(',')})`, inviteIds);
    await pool.query(`DELETE FROM nps_whatsapp_inbound_events WHERE nps_invite_id IN (${inviteIds.map(() => '?').join(',')})`, inviteIds);
    await pool.query(`DELETE FROM nps_audio_transcriptions WHERE conversation_id IN (SELECT id FROM nps_twilio_conversations WHERE nps_invite_id IN (${inviteIds.map(() => '?').join(',')}))`, inviteIds);
    await pool.query(`DELETE FROM nps_twilio_conversation_events WHERE nps_invite_id IN (${inviteIds.map(() => '?').join(',')})`, inviteIds);
    await pool.query(`DELETE FROM nps_twilio_conversations WHERE nps_invite_id IN (${inviteIds.map(() => '?').join(',')})`, inviteIds);
    await pool.query(`DELETE FROM nps_invites WHERE id IN (${inviteIds.map(() => '?').join(',')})`, inviteIds);
  }

  return {
    success: true,
    deletedInvites: inviteIds.length
  };
}

async function processTwilioNpsInbound(pool, body = {}, options = {}) {
  const inbound = normalizeTwilioInboundPayload(body);
  if (!inbound.messageId || !inbound.phoneDigits) {
    return { ignored: true, reason: 'missing_twilio_fields' };
  }

  const inboundEvent = await insertInboundEvent(pool, {
    messageId: inbound.messageId,
    patientPhone: inbound.patientPhone,
    messageText: inbound.text,
    processedStatus: 'pending',
    rawPayloadJson: safeJson(body)
  });

  if (inboundEvent.duplicate) {
    return { ignored: true, duplicate: true, reason: 'duplicate_message' };
  }

  let conversation = await findActiveConversationByPhone(pool, inbound.phoneDigits);
  if (!conversation) {
    await updateInboundEvent(pool, inboundEvent.id, { processedStatus: 'ignored_no_conversation' });
    return { ignored: true, reason: 'conversation_not_found', inboundEventId: inboundEvent.id };
  }

  if (inbound.isAudio) {
    const audioResult = await handleAudioInbound(pool, conversation, inbound, options);
    if (audioResult.reply) {
      await sendNpsTwilioText({ to: inbound.phoneDigits, message: audioResult.reply, eventType: 'NPS_DEMO_AUDIO', sendTextImpl: options.sendTextImpl });
    }
    await updateInboundEvent(pool, inboundEvent.id, {
      processedStatus: audioResult.action,
      npsInviteId: conversation.nps_invite_id,
      npsResponseId: conversation.nps_response_id || null
    });
    return { success: true, ...audioResult, inboundEventId: inboundEvent.id };
  }

  const stateBefore = conversation.state || NPS_CONVERSATION_STATES.AWAITING_NPS_SCORE;
  let transition = advanceConversationState(stateBefore, { text: inbound.text });
  let responseId = conversation.nps_response_id || null;
  let dentalCard = null;

  if (transition.action === 'score_received') {
    const scoreResult = await createOrUpdateNpsResponseForScore(pool, conversation, transition.score, inbound);
    responseId = scoreResult.id;
    await updateConversation(pool, conversation.id, {
      state: transition.nextState,
      npsScore: transition.score,
      npsProfile: transition.profile,
      npsResponseId: responseId,
      lastInboundAt: toMysqlDateTime(new Date()),
      lastMessageSid: inbound.messageSid || null
    });
  } else if (transition.action === 'referral_accepted') {
    await pool.query(
      `UPDATE nps_responses
          SET recommend_yes = 1,
              contact_share_allowed = 1
        WHERE id = ?`,
      [responseId]
    );
    await updateConversation(pool, conversation.id, { state: transition.nextState, lastInboundAt: toMysqlDateTime(new Date()) });
  } else if (transition.action === 'referral_declined' || transition.action === 'conversation_completed') {
    await pool.query('UPDATE nps_responses SET recommend_yes = COALESCE(recommend_yes, 0) WHERE id = ?', [responseId]);
    await updateConversation(pool, conversation.id, { state: transition.nextState, lastInboundAt: toMysqlDateTime(new Date()) });
  } else if (transition.action === 'referral_received') {
    const referralResult = await saveNpsReferral(pool, conversation, transition.referral);
    dentalCard = await createDentalCardLeadFromReferral(pool, conversation, transition.referral, referralResult.id);
    await updateConversation(pool, conversation.id, { state: transition.nextState, lastInboundAt: toMysqlDateTime(new Date()) });
    transition = { ...transition, referralResult, dentalCard };
  } else if (transition.action === 'neutral_feedback_received') {
    await appendNpsTextField(pool, responseId, 'improvement_comment', transition.feedback);
    await updateConversation(pool, conversation.id, { state: transition.nextState, lastInboundAt: toMysqlDateTime(new Date()) });
  } else if (transition.action === 'detractor_feedback_received') {
    await appendNpsTextField(pool, responseId, 'detractor_feedback', transition.feedback);
    await updateConversation(pool, conversation.id, { state: transition.nextState, lastInboundAt: toMysqlDateTime(new Date()) });
  } else if (transition.action === 'transcription_confirmed' || transition.action === 'transcription_correction_requested') {
    const confirmed = transition.action === 'transcription_confirmed';
    const confirmation = await confirmLatestAudioTranscription(pool, conversation, confirmed);
    transition = {
      ...transition,
      confirmation
    };
    await updateConversation(pool, conversation.id, { state: transition.nextState, lastInboundAt: toMysqlDateTime(new Date()) });
  } else {
    await updateConversation(pool, conversation.id, { state: transition.nextState || stateBefore, lastInboundAt: toMysqlDateTime(new Date()) });
  }

  await insertConversationEvent(pool, {
    conversationId: conversation.id,
    npsInviteId: conversation.nps_invite_id,
    npsResponseId: responseId,
    messageSid: inbound.messageSid || null,
    direction: 'inbound',
    stateBefore,
    stateAfter: transition.nextState || stateBefore,
    messageType: transition.action,
    sourceType: 'TEXT',
    body: inbound.text,
    metadataJson: safeJson({ raw: body, transition })
  });

  if (transition.reply) {
    await sendNpsTwilioText({
      to: inbound.phoneDigits,
      message: transition.reply,
      eventType: 'NPS_DEMO_REPLY',
      sendTextImpl: options.sendTextImpl || null
    });
  }

  await updateInboundEvent(pool, inboundEvent.id, {
    processedStatus: transition.action,
    rawPayloadJson: safeJson({ ...body, transition, dentalCard }),
    npsInviteId: conversation.nps_invite_id,
    npsResponseId: responseId
  });

  return {
    success: true,
    action: transition.action,
    stateBefore,
    stateAfter: transition.nextState || stateBefore,
    score: transition.score ?? extractNpsScore(inbound.text),
    profile: transition.profile || null,
    responseId,
    inviteId: conversation.nps_invite_id,
    inboundEventId: inboundEvent.id,
    dentalCard
  };
}

module.exports = {
  DEMO_CLINIC_NAME,
  DEMO_IDEMPOTENCY_KEY,
  DEMO_PATIENT_NAME,
  DEMO_SOURCE,
  createDentalCardLeadFromReferral,
  createOrReuseDemoConversation,
  createOrReuseDemoInvite,
  normalizeTwilioInboundPayload,
  processTwilioNpsInbound,
  resetNpsDemo,
  saveNpsReferral,
  sendNpsTwilioText,
  startNpsDemo
};
