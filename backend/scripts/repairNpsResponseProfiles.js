require('dotenv').config({
  quiet: true
});

const mysql =
  require('mysql2/promise');

(async () => {

  const db =
    await mysql.createConnection({
      host:
        process.env.DB_HOST,

      port:
        Number(process.env.DB_PORT || 3306),

      user:
        process.env.DB_USER,

      password:
        process.env.DB_PASSWORD,

      database:
        process.env.DB_NAME
    });

  const [columns] =
    await db.query(`
      SHOW COLUMNS FROM nps_responses
    `);

  const names =
    columns.map(column => column.Field);

  console.log({
    table:
      'nps_responses',

    columns:
      names
  });

  const scoreColumn =
    names.includes('score')
      ? 'score'
      : names.includes('nps_score')
        ? 'nps_score'
        : null;

  const profileColumn =
    names.includes('nps_profile')
      ? 'nps_profile'
      : names.includes('npsClass')
        ? 'npsClass'
        : names.includes('nps_class')
          ? 'nps_class'
          : null;

  if (!scoreColumn || !profileColumn) {
    console.log({
      status:
        'NPS_PROFILE_REPAIR_SKIPPED',

      reason:
        'Coluna de nota ou perfil não encontrada.',

      scoreColumn,

      profileColumn
    });

    await db.end();
    return;
  }

  const [before] =
    await db.query(`
      SELECT
        ${profileColumn} AS profile,
        COUNT(*) total
      FROM nps_responses
      GROUP BY ${profileColumn}
      ORDER BY total DESC
    `);

  console.log('\n=== BEFORE ===');
  console.table(before);

  const [result] =
    await db.query(`
      UPDATE nps_responses
      SET ${profileColumn} =
        CASE
          WHEN ${scoreColumn} >= 9 THEN 'promoter'
          WHEN ${scoreColumn} >= 7 THEN 'neutral'
          WHEN ${scoreColumn} >= 0 THEN 'detractor'
          ELSE ${profileColumn}
        END
      WHERE ${scoreColumn} IS NOT NULL
        AND (
          ${profileColumn} IS NULL
          OR ${profileColumn} = ''
          OR ${profileColumn} NOT IN ('promoter', 'neutral', 'detractor')
        )
    `);

  const [after] =
    await db.query(`
      SELECT
        ${profileColumn} AS profile,
        COUNT(*) total
      FROM nps_responses
      GROUP BY ${profileColumn}
      ORDER BY total DESC
    `);

  console.log('\n=== AFTER ===');
  console.table(after);

  console.log({
    status:
      'NPS_PROFILE_REPAIR_DONE',

    affectedRows:
      result.affectedRows,

    scoreColumn,

    profileColumn
  });

  await db.end();

})().catch(error => {

  console.error({
    status:
      'NPS_PROFILE_REPAIR_FAILED',

    code:
      error.code || null,

    message:
      error.message
  });

  process.exit(1);
});
