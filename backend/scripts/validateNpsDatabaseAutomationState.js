require('dotenv').config({
  quiet: true
});

const mysql = require('mysql2/promise');

async function tableExists(db, tableName) {
  const [rows] = await db.query(
    `SHOW TABLES LIKE ?`,
    [tableName]
  );

  return rows.length > 0;
}

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const [summary] = await db.query(`
    SELECT
      nps_profile,
      COUNT(*) total
    FROM nps_responses
    WHERE score IS NOT NULL
    GROUP BY nps_profile
    ORDER BY total DESC
  `);

  const [rawVcards] = await db.query(`
    SELECT
      COUNT(*) total
    FROM nps_responses
    WHERE comment LIKE '%BEGIN:VCARD%'
       OR improvement_comment LIKE '%BEGIN:VCARD%'
       OR detractor_feedback LIKE '%BEGIN:VCARD%'
  `);

  const [latestResponses] = await db.query(`
    SELECT
      id,
      clinic_name,
      patient_name,
      patient_phone,
      score,
      nps_profile,
      comment,
      recommend_yes,
      contact_share_allowed,
      created_at
    FROM nps_responses
    ORDER BY id DESC
    LIMIT 10
  `);

  let dentalSummary = [];

  const [tables] = await db.query('SHOW TABLES');

  const tableNames = tables.map((row) => Object.values(row)[0]);

  const dentalCandidates = [];

  for (const table of tableNames) {
    if (!String(table).toLowerCase().includes('dental')) {
      continue;
    }

    const [columns] = await db.query(`SHOW COLUMNS FROM ${table}`);
    const names = columns.map((column) => column.Field);

    if (names.includes('nome_lead') && names.includes('telefone')) {
      dentalCandidates.push({
        table,
        columns: names
      });
    }
  }

  for (const candidate of dentalCandidates) {
    const [rows] = await db.query(`
      SELECT
        COUNT(*) total
      FROM ${candidate.table}
      WHERE origem LIKE '%NPS%'
         OR observacoes LIKE '%NPS%'
         OR status = 'Indicação Recebida'
    `);

    dentalSummary.push({
      table: candidate.table,
      totalNpsReferrals: rows[0]?.total || 0
    });
  }

  console.log('\n=== VALIDACAO_AUTOMATICA_NPS_BANCO ===');

  console.log({
    checkedAt: new Date().toISOString(),
    rawVcardsRemaining: rawVcards[0]?.total || 0
  });

  console.log('\n=== RESUMO PERFIS NPS ===');
  console.table(summary);

  console.log('\n=== ULTIMAS RESPOSTAS ===');
  console.table(
    latestResponses.map((item) => ({
      id: item.id,
      clinic_name: item.clinic_name,
      patient_name: item.patient_name,
      patient_phone: item.patient_phone,
      score: item.score,
      nps_profile: item.nps_profile,
      comment: String(item.comment || '').slice(0, 120),
      recommend_yes: item.recommend_yes,
      contact_share_allowed: item.contact_share_allowed,
      created_at: item.created_at
    }))
  );

  console.log('\n=== DENTAL CARD NPS ===');
  console.table(dentalSummary);

  await db.end();
})().catch((error) => {
  console.error({
    status: 'NPS_DATABASE_AUTOMATION_VALIDATION_FAILED',
    code: error.code || null,
    message: error.message
  });

  process.exit(1);
});
