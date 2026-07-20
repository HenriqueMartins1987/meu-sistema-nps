require('dotenv').config({
  quiet: true
});

const mysql = require('mysql2/promise');

function normalizePhone(value) {
  let digits =
    String(value || '').replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (!digits.startsWith('55')) {
    digits = `55${digits}`;
  }

  return digits.slice(0, 13);
}

function parseNpsVCardContact(value = '') {
  const raw =
    String(value || '').trim();

  if (!raw) {
    return {
      name: null,
      phone: null,
      readable: ''
    };
  }

  const isVcard =
    raw.includes('BEGIN:VCARD') ||
    raw.includes('TEL') ||
    raw.includes('FN:');

  if (!isVcard) {
    const phoneMatch =
      raw.match(/(?:\+?55)?[\s().-]*(?:\d[\s().-]*){10,13}/);

    const phone =
      phoneMatch
        ? normalizePhone(phoneMatch[0])
        : '';

    const name =
      raw
        .replace(phoneMatch?.[0] || '', ' ')
        .replace(/(?:nome|telefone|fone|celular|whatsapp|zap)\s*[:=-]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
      name: name || 'Indicado via NPS',
      phone,
      readable: phone
        ? `${name || 'Indicado via NPS'} — WhatsApp: +${phone}`
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

      const phone =
        normalizePhone(valuePart);

      if (phone) {
        phones.push(phone);
      }
    }
  }

  const phone =
    [...new Set(phones)][0] || '';

  return {
    name: name || 'Contato indicado',
    phone,
    readable: phone
      ? `${name || 'Contato indicado'} — WhatsApp: +${phone}`
      : name || 'Contato indicado'
  };
}

async function getTables(db) {
  const [tables] =
    await db.query('SHOW TABLES');

  return tables.map((row) => Object.values(row)[0]);
}

async function getColumns(db, table) {
  const [columns] =
    await db.query(`SHOW COLUMNS FROM ${table}`);

  return columns.map((column) => column.Field);
}

async function resolveDentalTable(db) {
  const tables =
    await getTables(db);

  const candidates = [];

  for (const table of tables) {
    const lower =
      String(table).toLowerCase();

    if (
      !lower.includes('dental')
    ) {
      continue;
    }

    const columns =
      await getColumns(db, table);

    const set =
      new Set(columns);

    if (
      set.has('nome_lead') &&
      set.has('telefone')
    ) {
      candidates.push({
        table,
        columns
      });
    }
  }

  if (!candidates.length) {
    throw new Error(
      'Tabela do Dental Card não encontrada. Esperado tabela com colunas nome_lead e telefone.'
    );
  }

  return candidates[0];
}

function pickInsertPayload(columns, response, referral) {
  const set =
    new Set(columns);

  const payload = {
    data_indicacao:
      new Date().toISOString().slice(0, 10),

    unidade:
      response.clinic_name || null,

    nome_lead:
      referral.name || 'Indicado via NPS',

    telefone:
      referral.phone || null,

    nome_indicador:
      response.patient_name || null,

    origem:
      'NPS - Promotor',

    responsavel:
      'Equipe Follow Dental Card',

    status:
      'Indicação Recebida',

    quantidade_tentativas:
      0,

    observacoes:
      [
        `Indicação recebida automaticamente via NPS.`,
        `Paciente indicador: ${response.patient_name || 'Não informado'}.`,
        `Telefone do indicador: ${response.patient_phone || 'Não informado'}.`,
        `Unidade: ${response.clinic_name || 'Não informada'}.`,
        `Nota NPS: ${response.score || 'Não informada'}.`,
        `Contato indicado: ${referral.readable || 'Não informado'}.`
      ].join('\n'),

    origem_cadastro:
      'NPS Automático',

    created_via_public_form:
      0
  };

  const insert = {};

  for (const [key, value] of Object.entries(payload)) {
    if (set.has(key)) {
      insert[key] = value;
    }
  }

  return insert;
}

(async () => {
  const db =
    await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

  const dental =
    await resolveDentalTable(db);

  console.log({
    status: 'DENTAL_TABLE_FOUND',
    table: dental.table
  });

  const [responses] =
    await db.query(`
      SELECT
        id,
        clinic_name,
        patient_name,
        patient_phone,
        score,
        nps_profile,
        comment,
        source,
        created_at
      FROM nps_responses
      WHERE score >= 9
        AND (
          recommend_yes = 1
          OR contact_share_allowed = 1
          OR comment LIKE '%Paciente indicou:%'
          OR comment LIKE '%BEGIN:VCARD%'
          OR comment LIKE '%TEL%'
        )
      ORDER BY id DESC
      LIMIT 500
    `);

  let inserted = 0;
  let skipped = 0;
  const details = [];

  for (const response of responses) {
    const referral =
      parseNpsVCardContact(response.comment || '');

    if (!referral.phone) {
      skipped += 1;
      details.push({
        npsResponseId: response.id,
        status: 'skipped_no_referral_phone'
      });
      continue;
    }

    const [existing] =
      await db.query(`
        SELECT id
        FROM ${dental.table}
        WHERE telefone = ?
        LIMIT 1
      `, [
        referral.phone
      ]);

    if (existing.length) {
      skipped += 1;
      details.push({
        npsResponseId: response.id,
        status: 'already_exists_dental_card',
        dentalId: existing[0].id
      });
      continue;
    }

    const payload =
      pickInsertPayload(
        dental.columns,
        response,
        referral
      );

    if (!payload.nome_lead || !payload.telefone) {
      skipped += 1;
      details.push({
        npsResponseId: response.id,
        status: 'skipped_missing_required_payload'
      });
      continue;
    }

    const columns =
      Object.keys(payload);

    const values =
      Object.values(payload);

    const placeholders =
      columns.map(() => '?').join(', ');

    const [result] =
      await db.query(`
        INSERT INTO ${dental.table}
        (${columns.join(', ')})
        VALUES
        (${placeholders})
      `, values);

    inserted += 1;

    details.push({
      npsResponseId: response.id,
      status: 'inserted_dental_card',
      dentalId: result.insertId,
      referralName: referral.name,
      referralPhone: referral.phone
    });
  }

  console.log({
    status: 'NPS_REFERRALS_TO_DENTAL_CARD_DONE',
    scanned: responses.length,
    inserted,
    skipped
  });

  console.table(details.slice(0, 50));

  await db.end();
})().catch((error) => {
  console.error({
    status: 'NPS_REFERRALS_TO_DENTAL_CARD_FAILED',
    code: error.code || null,
    message: error.message
  });

  process.exit(1);
});
