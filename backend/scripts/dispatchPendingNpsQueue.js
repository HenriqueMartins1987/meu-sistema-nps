require('dotenv').config({
  quiet: true
});

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const {
  enrichClinicFields
} = require('../services/npsClinicRegistry');

const queueFile =
  path.join(
    __dirname,
    '..',
    'runtime',
    'ecuro-db',
    'ecuro-nps-queue.json'
  );

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function nowSaoPaulo() {
  return new Date(
    new Date().toLocaleString(
      'en-US',
      {
        timeZone: 'America/Sao_Paulo'
      }
    )
  );
}

function todaySaoPaulo() {
  const date = nowSaoPaulo();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function hhmm(date = nowSaoPaulo()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isWithinWindow() {
  if (String(process.env.FORCE_DISPATCH || '').toLowerCase() === 'true') {
    return true;
  }

  const day = nowSaoPaulo().getDay();
  const time = hhmm();

  const start = process.env.NPS_DISPATCH_WINDOW_START || '06:00';
  const end = process.env.NPS_DISPATCH_WINDOW_END || '18:00';

  const isMondayToSaturday = day >= 1 && day <= 6;

  return isMondayToSaturday && time >= start && time <= end;
}

function buildMessage(item) {
  const patientName =
    String(item.patientName || 'Paciente').trim();

  const clinicName =
    String(item.clinicName || 'nossa unidade').trim();

  return [
    `Olá, ${patientName}! 😊`,
    '',
    `Aqui é a equipe de Experiência do Paciente da unidade ${clinicName}.`,
    '',
    'Queremos saber como foi sua experiência conosco.',
    '',
    `De 0 a 10, qual nota você dá para seu atendimento na unidade ${clinicName}?`,
    '',
    'Responda apenas com um número de 0 a 10.'
  ].join('\n');
}

async function openDbIfConfigured() {
  const required = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
  ];

  const hasAll = required.every(key => process.env[key]);

  if (!hasAll) {
    return null;
  }

  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
}

async function ensureInvite(db, item, sessionId) {
  if (!db) {
    return null;
  }

  const phone =
    normalizePhone(item.patientPhone);

  const source =
    item.source ||
    'ecuro_robot';

  const idempotencyKey =
    crypto
      .createHash('sha256')
      .update(
        [
          'nps-auto',
          source,
          item.id || '',
          item.clinicCode || '',
          phone
        ].join(':')
      )
      .digest('hex');

  const [existing] = await db.query(`
    SELECT id
    FROM nps_invites
    WHERE idempotency_key = ?
    LIMIT 1
  `, [
    idempotencyKey
  ]);

  if (existing.length) {
    await db.query(`
      UPDATE nps_invites
      SET
        status = 'sent',
        sent_at = COALESCE(sent_at, NOW()),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      existing[0].id
    ]);

    return existing[0].id;
  }

  const token =
    crypto
      .randomBytes(32)
      .toString('hex');

  const [result] = await db.query(`
    INSERT INTO nps_invites
    (
      token,
      clinic_id,
      clinic_name,
      patient_name,
      patient_phone,
      source,
      session_id,
      status,
      idempotency_key,
      attempts,
      sent_at,
      created_by
    )
    VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
  `, [
    token,
    null,
    item.clinicName || null,
    item.patientName || null,
    phone,
    source,
    sessionId,
    'sent',
    idempotencyKey,
    1,
    'dispatcher_pending_nps_queue'
  ]);

  return result.insertId;
}

async function main() {
  if (!fs.existsSync(queueFile)) {
    console.log({
      status: 'QUEUE_FILE_NOT_FOUND',
      queueFile
    });

    return;
  }

  if (
    String(process.env.NPS_DISPATCH_ENABLED || 'false').toLowerCase() !== 'true'
  ) {
    console.log({
      status: 'DISPATCH_DISABLED',
      NPS_DISPATCH_ENABLED: process.env.NPS_DISPATCH_ENABLED || null
    });

    return;
  }

  if (!isWithinWindow()) {
    console.log({
      status: 'OUTSIDE_DISPATCH_WINDOW',
      now: hhmm(),
      windowStart: process.env.NPS_DISPATCH_WINDOW_START,
      windowEnd: process.env.NPS_DISPATCH_WINDOW_END
    });

    return;
  }

  const baseUrl =
    process.env.WHATSAPP_API_URL ||
    process.env.WHATSAPP_SERVICE_BASE_URL ||
    'http://127.0.0.1:3005';

  const apiKey =
    process.env.WHATSAPP_API_KEY;

  const sessionId =
    process.env.NPS_SESSION_ID ||
    process.env.NPS_WHATSAPP_SESSION_ID ||
    'nps';

  if (!apiKey) {
    throw new Error('WHATSAPP_API_KEY ausente.');
  }

  const sessionStatus = await fetch(
    `${baseUrl}/sessions/${sessionId}/status`,
    {
      headers: {
        'x-api-key': apiKey
      }
    }
  );

  const sessionBody = await sessionStatus.text();

  if (
    !sessionStatus.ok ||
    !sessionBody.toLowerCase().includes('conect')
  ) {
    console.log({
      status: 'WHATSAPP_SESSION_NOT_CONNECTED',
      sessionId,
      httpStatus: sessionStatus.status,
      body: sessionBody
    });

    process.exit(1);
  }

  const queue =
    JSON.parse(
      fs.readFileSync(
        queueFile,
        'utf8'
      )
    );

  const today =
    todaySaoPaulo();

  const alreadySentToday =
    queue.filter(item =>
      String(item.sessionId || sessionId) === sessionId &&
      ['sent', 'responded'].includes(String(item.status || '')) &&
      String(item.sentAt || '').startsWith(today)
    ).length;

  const maxDaily =
    Number(process.env.NPS_MAX_DAILY_PER_SESSION || 300);

  const maxPerRun =
    Number(process.env.NPS_DISPATCH_MAX_PER_RUN || 10);

  const remainingDaily =
    Math.max(0, maxDaily - alreadySentToday);

  const limit =
    Math.min(maxPerRun, remainingDaily);

  if (limit <= 0) {
    console.log({
      status: 'DAILY_LIMIT_REACHED',
      alreadySentToday,
      maxDaily
    });

    return;
  }

  const candidates = [];

  for (const rawItem of queue) {
    const item =
      enrichClinicFields(rawItem);

    Object.assign(rawItem, item);

    const phone =
      normalizePhone(rawItem.patientPhone);

    const source =
      String(rawItem.source || '');

    const status =
      String(rawItem.status || '');

    const stage =
      String(rawItem.npsConversationStage || '');

    if (status !== 'pending') continue;
    if (stage === 'finished') continue;
    if (!rawItem.clinicRegistryResolved) continue;
    if (!String(rawItem.clinicName || '').startsWith('Sorria ')) continue;
    if (String(rawItem.clinicName || '').length > 180) continue;
    if (phone.length < 12 || phone.length > 13) continue;
    if (/homolog|teste|test/i.test(source)) continue;

    candidates.push(rawItem);
  }

  const selected =
    candidates
      .sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      )
      .slice(0, limit);

  console.log({
    status: 'DISPATCH_SELECTION',
    sessionId,
    totalPendingCandidates: candidates.length,
    selected: selected.length,
    alreadySentToday,
    maxDaily,
    maxPerRun,
    intervalSeconds: Number(process.env.NPS_DISPATCH_INTERVAL_SECONDS || 60)
  });

  if (!selected.length) {
    return;
  }

  const db =
    await openDbIfConfigured();

  const intervalSeconds =
    Number(process.env.NPS_DISPATCH_INTERVAL_SECONDS || 60);

  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];

    const phone =
      normalizePhone(item.patientPhone);

    const message =
      buildMessage(item);

    try {
      const inviteId =
        await ensureInvite(db, item, sessionId);

      const response =
        await fetch(
          `${baseUrl}/messages/send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey
            },
            body: JSON.stringify({
              sessionId,
              number: phone,
              message
            })
          }
        );

      const text =
        await response.text();

      let parsed = null;

      try {
        parsed = JSON.parse(text);
      } catch (_) {}

      if (!response.ok) {
        item.status = 'send_failed';
        item.npsResponseStatus = 'send_failed';
        item.sendFailedAt = new Date().toISOString();
        item.sendError = text;

        results.push({
          id: item.id,
          phone,
          clinicCode: item.clinicCode,
          success: false,
          httpStatus: response.status
        });

      } else {
        item.status = 'sent';
        item.sessionId = sessionId;
        item.npsConversationStage = 'awaiting_score';
        item.npsResponseStatus = 'pending';
        item.sentAt = new Date().toISOString();
        item.inviteId = inviteId || item.inviteId || null;
        item.sendResult = parsed || text;

        if (parsed?.chatId) {
          item.responseChatId = parsed.chatId;
          item.responseFrom = parsed.chatId;
          item.chatId = parsed.chatId;
          item.resolvedChatId = parsed.chatId;
        }

        results.push({
          id: item.id,
          phone,
          clinicCode: item.clinicCode,
          success: true,
          httpStatus: response.status
        });
      }

      fs.writeFileSync(
        queueFile,
        JSON.stringify(queue, null, 2)
      );

    } catch (error) {
      item.status = 'send_error';
      item.npsResponseStatus = 'send_error';
      item.sendFailedAt = new Date().toISOString();
      item.sendError = error.message;

      fs.writeFileSync(
        queueFile,
        JSON.stringify(queue, null, 2)
      );

      results.push({
        id: item.id,
        phone,
        clinicCode: item.clinicCode,
        success: false,
        error: error.message
      });
    }

    console.table(
      results.slice(-1)
    );

    if (index < selected.length - 1) {
      await sleep(intervalSeconds * 1000);
    }
  }

  if (db) {
    await db.end();
  }

  console.log({
    status: 'DISPATCH_DONE',
    attempted: results.length,
    success: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
}

main().catch(error => {
  console.error({
    status: 'DISPATCH_FAILED',
    message: error.message
  });

  process.exit(1);
});
