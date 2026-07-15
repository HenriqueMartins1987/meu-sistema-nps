require('dotenv').config({
  quiet: true
});

const mysql = require('mysql2/promise');

function parseNpsVCardContact(value = '') {
  const raw =
    String(value || '').trim();

  if (!raw) {
    return null;
  }

  if (
    !raw.includes('BEGIN:VCARD') &&
    !raw.includes('TEL') &&
    !raw.includes('FN:')
  ) {
    return null;
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

  if (!name && !phone) {
    return null;
  }

  return {
    name: name || 'Contato indicado',
    phone,
    readable: phone
      ? `Paciente indicou: ${name || 'Contato indicado'} — WhatsApp: ${phone}`
      : `Paciente indicou: ${name || 'Contato indicado'}`
  };
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

  const [rows] =
    await db.query(`
      SELECT
        id,
        comment,
        improvement_comment,
        detractor_feedback
      FROM nps_responses
      WHERE comment LIKE '%BEGIN:VCARD%'
         OR improvement_comment LIKE '%BEGIN:VCARD%'
         OR detractor_feedback LIKE '%BEGIN:VCARD%'
      ORDER BY id DESC
    `);

  let updated = 0;

  for (const row of rows) {
    const raw =
      row.comment ||
      row.improvement_comment ||
      row.detractor_feedback ||
      '';

    const parsed =
      parseNpsVCardContact(raw);

    if (!parsed) {
      continue;
    }

    await db.query(`
      UPDATE nps_responses
      SET
        comment = ?,
        recommend_yes = COALESCE(recommend_yes, 1),
        contact_share_allowed = COALESCE(contact_share_allowed, 1),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      parsed.readable,
      row.id
    ]);

    updated += 1;
  }

  console.log({
    status: 'NPS_VCARD_COMMENTS_CLEANED',
    found: rows.length,
    updated
  });

  await db.end();
})().catch((error) => {
  console.error({
    status: 'NPS_VCARD_COMMENTS_CLEAN_FAILED',
    code: error.code || null,
    message: error.message
  });

  process.exit(1);
});
