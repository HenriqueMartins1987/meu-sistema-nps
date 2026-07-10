'use strict';

require('dotenv').config({ quiet: true });

const mysql = require('mysql2/promise');

const databaseName = String(process.env.DB_NAME || '').trim();

if (!databaseName) {
  throw new Error('DB_NAME não configurado. Migração NPS Enterprise cancelada.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 2,
  queueLimit: 0,
  multipleStatements: false
});

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(`
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
  `, [databaseName, tableName, columnName]);
  return rows.length > 0;
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.query(`
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
    LIMIT 1
  `, [databaseName, tableName, indexName]);
  return rows.length > 0;
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(`
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = ?
    LIMIT 1
  `, [databaseName, tableName]);
  return rows.length > 0;
}

async function ensureColumn(connection, tableName, columnName, definition) {
  if (await columnExists(connection, tableName, columnName)) {
    console.log(`SKIP column ${tableName}.${columnName}`);
    return;
  }
  await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  console.log(`ADD column ${tableName}.${columnName}`);
}

async function ensureIndex(connection, tableName, indexName, columns) {
  if (await indexExists(connection, tableName, indexName)) {
    console.log(`SKIP index ${indexName}`);
    return;
  }
  const safeColumns = columns.map((column) => `\`${column}\``).join(', ');
  await connection.query(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${safeColumns})`);
  console.log(`ADD index ${indexName}`);
}

async function ensureBaseTables(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS nps_management_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      nps_response_id INT NOT NULL,
      action VARCHAR(80) NOT NULL,
      event_type VARCHAR(80) NOT NULL DEFAULT 'management',
      previous_value_json LONGTEXT NULL,
      new_value_json LONGTEXT NULL,
      message TEXT NULL,
      actor_user_id INT NULL,
      actor_name VARCHAR(180) NULL,
      actor_role VARCHAR(80) NULL,
      source_ip VARCHAR(80) NULL,
      source_channel VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_nps_management_events_response (nps_response_id, created_at),
      INDEX idx_nps_management_events_action (action, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS nps_sla_extensions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      nps_response_id INT NOT NULL,
      previous_due_at DATETIME NOT NULL,
      new_due_at DATETIME NOT NULL,
      reason TEXT NOT NULL,
      requested_by_user_id INT NULL,
      requested_by_name VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_nps_sla_extensions_response (nps_response_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS nps_cause_taxonomy (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(120) NOT NULL,
      subcategory VARCHAR(160) NOT NULL,
      description TEXT NULL,
      owner_area VARCHAR(160) NULL,
      default_priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 999,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_nps_cause_taxonomy (category, subcategory),
      INDEX idx_nps_cause_taxonomy_active (is_active, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS nps_goals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      scope_type VARCHAR(40) NOT NULL,
      scope_id VARCHAR(120) NULL,
      scope_name VARCHAR(180) NULL,
      metric_key VARCHAR(80) NOT NULL,
      target_value DECIMAL(12,4) NOT NULL,
      valid_from DATE NOT NULL,
      valid_until DATE NULL,
      created_by_user_id INT NULL,
      created_by_name VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_nps_goals_scope (scope_type, scope_id, metric_key, valid_from),
      INDEX idx_nps_goals_validity (valid_from, valid_until)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS nps_alerts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      alert_type VARCHAR(80) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'warning',
      nps_response_id INT NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'open',
      idempotency_key VARCHAR(180) NOT NULL,
      assigned_user_id INT NULL,
      assigned_name VARCHAR(180) NULL,
      read_at DATETIME NULL,
      resolved_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_nps_alerts_idempotency (idempotency_key),
      INDEX idx_nps_alerts_status (status, severity, created_at),
      INDEX idx_nps_alerts_response (nps_response_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS nps_referrals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      nps_response_id INT NULL,
      nps_invite_id BIGINT NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      referrer_patient_name VARCHAR(180) NULL,
      referrer_patient_phone VARCHAR(40) NULL,
      referral_name VARCHAR(180) NULL,
      referral_phone VARCHAR(40) NULL,
      referral_status VARCHAR(40) NOT NULL DEFAULT 'nova',
      responsible_user_id INT NULL,
      responsible_name VARCHAR(180) NULL,
      last_contact_at DATETIME NULL,
      next_action_at DATETIME NULL,
      referral_accepted_at DATETIME NULL,
      referral_received_at DATETIME NULL,
      scheduled_at DATETIME NULL,
      attended_at DATETIME NULL,
      converted_at DATETIME NULL,
      lost_reason TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_nps_referrals_status (referral_status, created_at),
      INDEX idx_nps_referrals_clinic (clinic_id, clinic_name),
      INDEX idx_nps_referrals_response (nps_response_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureNpsResponseColumns(connection) {
  if (!await tableExists(connection, 'nps_responses')) {
    throw new Error('Tabela nps_responses não existe. Execute as migrations base antes da NPS Enterprise.');
  }

  const columns = [
    ['operational_priority', "VARCHAR(20) NOT NULL DEFAULT 'normal'"],
    ['management_substatus', 'VARCHAR(40) NULL'],
    ['cause_category', 'VARCHAR(120) NULL'],
    ['cause_subcategory', 'VARCHAR(160) NULL'],
    ['root_cause', 'TEXT NULL'],
    ['responsible_user_id', 'INT NULL'],
    ['responsible_name', 'VARCHAR(180) NULL'],
    ['sla_due_at', 'DATETIME NULL'],
    ['sla_status', 'VARCHAR(30) NULL'],
    ['first_action_at', 'DATETIME NULL'],
    ['resolved_at', 'DATETIME NULL'],
    ['closed_at', 'DATETIME NULL'],
    ['reopened_at', 'DATETIME NULL'],
    ['recovery_status', "VARCHAR(30) NOT NULL DEFAULT 'nao_iniciado'"],
    ['recovered_at', 'DATETIME NULL'],
    ['recurrence_count', 'INT NOT NULL DEFAULT 0'],
    ['experience_risk_score', 'INT NOT NULL DEFAULT 0'],
    ['experience_risk_level', "VARCHAR(20) NOT NULL DEFAULT 'baixo'"]
  ];

  for (const [name, definition] of columns) {
    // Sequencial por segurança operacional e logs determinísticos.
    // eslint-disable-next-line no-await-in-loop
    await ensureColumn(connection, 'nps_responses', name, definition);
  }

  await ensureIndex(connection, 'nps_responses', 'idx_nps_responses_management', ['nps_status', 'operational_priority', 'sla_due_at']);
  await ensureIndex(connection, 'nps_responses', 'idx_nps_responses_cause', ['cause_category', 'cause_subcategory']);
  await ensureIndex(connection, 'nps_responses', 'idx_nps_responses_recovery', ['recovery_status', 'recovered_at']);
}

async function ensureReferralColumns(connection) {
  const columns = [
    ['responsible_user_id', 'INT NULL'],
    ['responsible_name', 'VARCHAR(180) NULL'],
    ['last_contact_at', 'DATETIME NULL'],
    ['next_action_at', 'DATETIME NULL'],
    ['scheduled_at', 'DATETIME NULL'],
    ['attended_at', 'DATETIME NULL'],
    ['lost_reason', 'TEXT NULL']
  ];

  for (const [name, definition] of columns) {
    // eslint-disable-next-line no-await-in-loop
    await ensureColumn(connection, 'nps_referrals', name, definition);
  }
}

async function seedCauseTaxonomy(connection) {
  const rows = [
    ['Atendimento', 'Postura e cordialidade', 'Operacional', 'media', 10],
    ['Espera', 'Tempo de espera na unidade', 'Operacional', 'media', 20],
    ['Agenda', 'Dificuldade de agendamento', 'CRC', 'media', 30],
    ['Comercial', 'Abordagem comercial', 'Comercial', 'media', 40],
    ['Financeiro', 'Cobrança e negociação', 'Financeiro', 'alta', 50],
    ['Tratamento', 'Insatisfação com tratamento', 'Clínico', 'alta', 60],
    ['Resultado clínico', 'Resultado percebido', 'Clínico', 'alta', 70],
    ['Comunicação', 'Falta de informação ou retorno', 'Operacional', 'media', 80],
    ['Orçamento', 'Divergência ou incompreensão', 'Comercial', 'media', 90],
    ['Recepção', 'Atendimento de recepção', 'Operacional', 'media', 100],
    ['Ortodontia', 'Fluxo de ortodontia', 'Ortodontia', 'media', 110],
    ['Implante', 'Fluxo de implante', 'Implante', 'alta', 120],
    ['Prótese', 'Prazo ou adaptação de prótese', 'Prótese', 'alta', 130],
    ['Estrutura', 'Conforto, limpeza ou infraestrutura', 'Administrativo', 'media', 140],
    ['Pós-venda', 'Ausência de acompanhamento', 'CX', 'media', 150],
    ['Outros', 'Não classificado', 'Gestão', 'normal', 999]
  ];

  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await connection.query(`
      INSERT INTO nps_cause_taxonomy
        (category, subcategory, owner_area, default_priority, sort_order)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        owner_area = VALUES(owner_area),
        default_priority = VALUES(default_priority),
        sort_order = VALUES(sort_order),
        is_active = 1
    `, row);
  }
}

async function main() {
  const connection = await pool.getConnection();

  try {
    const [versionRows] = await connection.query('SELECT VERSION() AS version, DATABASE() AS database_name');
    console.log('NPS_ENTERPRISE_MIGRATION_START', versionRows[0]);

    await ensureBaseTables(connection);
    await ensureNpsResponseColumns(connection);
    await ensureReferralColumns(connection);
    await seedCauseTaxonomy(connection);

    const [verification] = await connection.query(`
      SELECT
        (SELECT COUNT(*) FROM nps_cause_taxonomy WHERE is_active = 1) AS active_causes,
        (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'nps_responses' AND COLUMN_NAME = 'experience_risk_score') AS risk_column,
        (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'nps_management_events') AS management_events_table
    `, [databaseName, databaseName]);

    console.log('NPS_ENTERPRISE_MIGRATION_OK', verification[0]);
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('NPS_ENTERPRISE_MIGRATION_FAILED', {
    message: error.message,
    code: error.code || null,
    errno: error.errno || null,
    sqlState: error.sqlState || null
  });
  process.exit(1);
});
