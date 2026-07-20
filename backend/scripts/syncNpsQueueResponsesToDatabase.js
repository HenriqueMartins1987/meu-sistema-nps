require('dotenv').config({
  quiet: true
});

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const queueFile = path.join(
  __dirname,
  '..',
  'runtime',
  'ecuro-db',
  'ecuro-nps-queue.json'
);

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function profileFromScore(score) {
  const numeric = Number(score);

  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 10) {
    return null;
  }

  if (numeric >= 9) return 'promotor';
  if (numeric >= 7) return 'neutro';
  return 'detrator';
}

function feedbackTypeFromProfile(profile) {
  if (profile === 'promotor') return 'Elogio';
  if (profile === 'neutro') return 'Sugestao';
  if (profile === 'detrator') return 'Reclamacao';
  return 'NPS';
}


function parseNpsVCardContact(value = '') {
  const raw =
    String(value || '').trim();

  if (!raw) {
    return {
      raw,
      name: null,
      phone: null,
      readable: ''
    };
  }

  const isVcard =
    raw.includes('BEGIN:VCARD') ||
    raw.includes('END:VCARD') ||
    raw.includes('TEL') ||
    raw.includes('FN:');

  if (!isVcard) {
    const phoneMatch =
      raw.match(/(?:\+?55)?[\s().-]*(?:\d[\s().-]*){10,13}/);

    const phoneDigits =
      phoneMatch
        ? String(phoneMatch[0] || '').replace(/\D/g, '')
        : '';

    const name =
      raw
        .replace(phoneMatch?.[0] || '', ' ')
        .replace(/(?:nome|telefone|fone|celular|whatsapp|zap)\s*[:=-]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const phone =
      phoneDigits
        ? `+${phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`}`
        : null;

    return {
      raw,
      name: name || 'Indicado via NPS',
      phone,
      readable: phone
        ? `${name || 'Indicado via NPS'} — WhatsApp: ${phone}`
        : raw
    };
  }

  const lines =
    raw
      .split(/\r?\n|(?=TEL)|(?=FN:)|(?=N:)|(?=END:VCARD)/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);

  let name = '';
  const phones = [];

  for (const line of lines) {
    if (line.startsWith('FN:')) {
      name =
        line
          .replace(/^FN:/, '')
          .trim();
    }

    if (line.startsWith('N:') && !name) {
      name =
        line
          .replace(/^N:/, '')
          .replace(/;/g, ' ')
          .trim();
    }

    if (/TEL/i.test(line)) {
      const valuePart =
        line.includes(':')
          ? line.split(':').slice(1).join(':')
          : line;

      const digits =
        valuePart.replace(/\D/g, '');

      if (digits) {
        phones.push(
          `+${digits.startsWith('55') ? digits : `55${digits}`}`
        );
      }
    }
  }

  const phone =
    [...new Set(phones)][0] || null;

  const readable =
    phone
      ? `${name || 'Contato indicado'} — WhatsApp: ${phone}`
      : name || 'Contato indicado sem telefone estruturado';

  return {
    raw,
    name: name || 'Contato indicado',
    phone,
    readable
  };
}


function buildReferralComment(value = '') {
  const parsed =
    parseNpsVCardContact(value);

  if (!parsed.readable) {
    return null;
  }

  return `Paciente indicou: ${parsed.readable}`;
}


function extractReferral(value = '') {
  const parsed =
    parseNpsVCardContact(value);

  return {
    name: parsed.name || 'Indicado via NPS',
    phone: parsed.phone,
    readable: parsed.readable,
    raw: parsed.raw
  };
}


function toMysqlDateTime(value) {
  if (!value) {
    return new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
  }

  return date
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}


function normalizeDbPhone(phone) {
  const digits = normalizePhone(phone);
  return digits ? `+${digits.startsWith('55') ? digits : `55${digits}`}` : null;
}

function commentForItem(item, profile) {
  if (profile === 'neutro') {
    return item.neutralReason || item.improvementComment || item.comment || null;
  }

  if (profile === 'detrator') {
    return item.detractorReason || item.detractorFeedback || item.comment || null;
  }

  return item.comment || null;
}

async function getColumns(db, table) {
  const [columns] = await db.query(`SHOW COLUMNS FROM ${table}`);
  return new Set(columns.map(column => column.Field));
}

async function findInvite(db, item) {
  if (item.inviteId) {
    const [rows] = await db.query(
      'SELECT * FROM nps_invites WHERE id = ? LIMIT 1',
      [item.inviteId]
    );

    if (rows[0]) return rows[0];
  }

  const phone = normalizePhone(item.patientPhone);

  const [rows] = await db.query(`
    SELECT *
    FROM nps_invites
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(patient_phone, '+', ''), '-', ''), ' ', ''), '(', '') LIKE ?
      AND (
        source = ?
        OR clinic_name = ?
        OR session_id = ?
      )
    ORDER BY id DESC
    LIMIT 1
  `, [
    `%${phone.slice(-11)}%`,
    item.source || '',
    item.clinicName || '',
    item.sessionId || 'nps'
  ]);

  return rows[0] || null;
}

async function responseExists(db, item, invite) {
  if (item.npsResponseId) {
    const [rows] = await db.query(
      'SELECT id FROM nps_responses WHERE id = ? LIMIT 1',
      [item.npsResponseId]
    );

    if (rows[0]) return rows[0].id;
  }

  if (invite?.id) {
    const [rows] = await db.query(
      'SELECT id FROM nps_responses WHERE ecuro_nps_invite_id = ? LIMIT 1',
      [invite.id]
    );

    if (rows[0]) return rows[0].id;
  }

  const phone = normalizeDbPhone(item.patientPhone);
  const score = Number(item.npsScore);

  const [rows] = await db.query(`
    SELECT id
    FROM nps_responses
    WHERE patient_phone IN (?, ?)
      AND score = ?
      AND created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
    ORDER BY id DESC
    LIMIT 1
  `, [
    phone,
    normalizePhone(item.patientPhone),
    score
  ]);

  return rows[0]?.id || null;
}

async function insertResponse(db, item, invite, responseColumns) {
  const score = Number(item.npsScore);
  const profile = profileFromScore(score);

  if (!profile) {
    throw new Error(`Nota inválida para item ${item.id}: ${item.npsScore}`);
  }

  const referralComment =
    item.referralContact
      ? buildReferralComment(item.referralContact)
      : null;

  const comment =
    referralComment ||
    commentForItem(item, profile);

  const values = {
    clinic_id: invite?.clinic_id || null,
    clinic_name: item.clinicName || invite?.clinic_name || null,
    patient_name: item.patientName || invite?.patient_name || null,
    patient_phone: normalizeDbPhone(item.patientPhone || invite?.patient_phone),
    score,
    comment: comment || null,
    feedback_type: feedbackTypeFromProfile(profile),
    nps_profile: profile,
    source: item.source || invite?.source || 'whatsapp_service_nps',
    ecuro_nps_invite_id: invite?.id || null,
    whatsapp_inbound_message_id: item.lastInboundMessageId || item.responseMessageId || null,
    response_channel: 'whatsapp',
    nps_status: 'registrado',
    responded_at: toMysqlDateTime(item.respondedAt || item.responseReceivedAt || item.updatedAt || new Date()),
    improvement_comment: profile === 'neutro' ? comment || null : null,
    detractor_feedback: profile === 'detrator' ? comment || null : null,
    recommend_yes: item.referralContact ? 1 : null,
    contact_share_allowed: item.referralContact ? 1 : null
  };

  const insertColumns = [];
  const insertValues = [];

  for (const [key, value] of Object.entries(values)) {
    if (responseColumns.has(key)) {
      insertColumns.push(key);
      insertValues.push(value);
    }
  }

  const placeholders = insertColumns.map(() => '?').join(', ');

  const [result] = await db.query(`
    INSERT INTO nps_responses
    (${insertColumns.join(', ')})
    VALUES
    (${placeholders})
  `, insertValues);

  const responseId = Number(result.insertId || 0) || null;

  if (responseId && responseColumns.has('nps_protocol')) {
    await db.query(
      'UPDATE nps_responses SET nps_protocol = ? WHERE id = ?',
      [`NPS-${String(responseId).padStart(6, '0')}`, responseId]
    );
  }

  return responseId;
}

async function saveReferral(db, item, invite, responseId) {
  if (!item.referralContact) return null;

  const [tables] = await db.query(`
    SHOW TABLES LIKE 'nps_referrals'
  `);

  if (!tables.length) return null;

  const referral = extractReferral(item.referralContact);

  if (!referral.phone) return null;

  const [existing] = await db.query(`
    SELECT id
    FROM nps_referrals
    WHERE referral_phone = ?
      AND (
        (? IS NOT NULL AND nps_response_id = ?)
        OR
        (? IS NOT NULL AND nps_invite_id = ?)
      )
    LIMIT 1
  `, [
    referral.phone,
    responseId,
    responseId,
    invite?.id || null,
    invite?.id || null
  ]);

  if (existing[0]) return existing[0].id;

  const [result] = await db.query(`
    INSERT INTO nps_referrals
    (
      nps_response_id,
      nps_invite_id,
      clinic_id,
      clinic_name,
      referrer_patient_name,
      referrer_patient_phone,
      referral_name,
      referral_phone,
      referral_status,
      referral_accepted_at,
      referral_received_at
    )
    VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, 'received', NOW(), NOW())
  `, [
    responseId || null,
    invite?.id || null,
    invite?.clinic_id || null,
    item.clinicName || invite?.clinic_name || null,
    item.patientName || invite?.patient_name || null,
    normalizeDbPhone(item.patientPhone || invite?.patient_phone),
    referral.name,
    referral.phone
  ]);

  return Number(result.insertId || 0) || null;
}

async function main() {
  if (!fs.existsSync(queueFile)) {
    console.log({
      status: 'QUEUE_FILE_NOT_FOUND',
      queueFile
    });

    return;
  }

  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));

  const answered = queue.filter(item =>
    item.npsScore !== undefined &&
    item.npsScore !== null &&
    item.npsScore !== '' &&
    !item.npsDatabaseSyncedAt
  );

  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const responseColumns = await getColumns(db, 'nps_responses');

  const results = [];

  for (const item of answered) {
    try {
      const profile = profileFromScore(item.npsScore);

      if (!profile) {
        results.push({
          id: item.id,
          status: 'skipped_invalid_score',
          npsScore: item.npsScore
        });

        continue;
      }

      const invite = await findInvite(db, item);
      const existingResponseId = await responseExists(db, item, invite);

      let responseId = existingResponseId;

      if (!responseId) {
        responseId = await insertResponse(db, item, invite, responseColumns);
      }

      await saveReferral(db, item, invite, responseId);

      if (invite?.id) {
        await db.query(`
          UPDATE nps_invites
          SET
            status = 'responded',
            responded_at = COALESCE(responded_at, NOW()),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [
          invite.id
        ]);
      }

      item.npsDatabaseSyncedAt = new Date().toISOString();
      item.npsResponseId = responseId;
      item.npsProfile = profile;
      item.npsClass = profile;
      item.npsResponseStatus = 'synced_to_database';

      results.push({
        id: item.id,
        patientName: item.patientName,
        phone: item.patientPhone,
        score: item.npsScore,
        profile,
        responseId,
        inviteId: invite?.id || null,
        status: existingResponseId ? 'already_exists_marked_synced' : 'inserted'
      });

    } catch (error) {
      item.npsDatabaseSyncError = error.message;
      item.npsDatabaseSyncErrorAt = new Date().toISOString();

      results.push({
        id: item.id,
        status: 'sync_failed',
        error: error.message
      });
    }
  }

  fs.writeFileSync(
    queueFile,
    JSON.stringify(queue, null, 2)
  );

  console.log({
    status: 'NPS_QUEUE_RESPONSES_SYNC_DONE',
    candidates: answered.length,
    insertedOrSynced: results.filter(item =>
      ['inserted', 'already_exists_marked_synced'].includes(item.status)
    ).length,
    failed: results.filter(item => item.status === 'sync_failed').length
  });

  console.table(results);

  await db.end();
}

main().catch(error => {
  console.error({
    status: 'NPS_QUEUE_RESPONSES_SYNC_FAILED',
    code: error.code || null,
    message: error.message
  });

  process.exit(1);
});
