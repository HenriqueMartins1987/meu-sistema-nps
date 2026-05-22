const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const repoRoot = path.join(__dirname, '..', '..');
const backupRoot = path.join(repoRoot, 'backups', 'mysql');

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

function escapeId(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function toMysqlDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (number) => String(number).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(':');
}

function localDbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nps_system',
    multipleStatements: false
  };
}

function productionDbConfig() {
  if (process.env.PROD_DATABASE_URL || process.env.PRODUCTION_DATABASE_URL || process.env.MYSQL_PUBLIC_URL) {
    const url = new URL(process.env.PROD_DATABASE_URL || process.env.PRODUCTION_DATABASE_URL || process.env.MYSQL_PUBLIC_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      multipleStatements: false,
      ssl: process.env.PROD_DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    };
  }

  if (!process.env.PROD_DB_HOST || !process.env.PROD_DB_USER || !process.env.PROD_DB_NAME) {
    return null;
  }

  return {
    host: process.env.PROD_DB_HOST,
    port: Number(process.env.PROD_DB_PORT || 3306),
    user: process.env.PROD_DB_USER,
    password: process.env.PROD_DB_PASSWORD || '',
    database: process.env.PROD_DB_NAME,
    multipleStatements: false,
    ssl: process.env.PROD_DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  };
}

function sameDatabase(a, b) {
  return [
    String(a.host || '').toLowerCase() === String(b.host || '').toLowerCase(),
    Number(a.port || 3306) === Number(b.port || 3306),
    String(a.database || '').toLowerCase() === String(b.database || '').toLowerCase(),
    String(a.user || '').toLowerCase() === String(b.user || '').toLowerCase()
  ].every(Boolean);
}

async function listTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`
  );
  return rows.map((row) => row.tableName);
}

async function listColumns(connection, table) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME AS columnName
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows.map((row) => row.columnName);
}

async function backupLocalDatabase(connection, label = 'local') {
  fs.mkdirSync(backupRoot, { recursive: true });
  const dir = path.join(backupRoot, `${stamp()}-${label}`);
  fs.mkdirSync(dir, { recursive: true });

  const tables = await listTables(connection);
  const manifest = {
    createdAt: new Date().toISOString(),
    database: localDbConfig().database,
    tables: []
  };

  for (const table of tables) {
    const [rows] = await connection.query(`SELECT * FROM ${escapeId(table)}`);
    fs.writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2), 'utf8');
    manifest.tables.push({ table, rows: rows.length });
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return dir;
}

async function ensureTable(local, remote, table) {
  const localColumns = await listColumns(local, table);
  if (localColumns.length) return localColumns;

  const [ddlRows] = await remote.query(`SHOW CREATE TABLE ${escapeId(table)}`);
  const ddl = ddlRows[0]?.['Create Table'];
  if (!ddl) throw new Error(`Nao foi possivel obter DDL da tabela ${table}.`);
  await local.query(ddl);
  return listColumns(local, table);
}

async function copyTable(remote, local, table) {
  const remoteColumns = await listColumns(remote, table);
  const localColumns = await ensureTable(local, remote, table);
  const commonColumns = remoteColumns.filter((column) => localColumns.includes(column));

  if (!commonColumns.length) {
    return { table, copied: 0, skipped: true };
  }

  await local.query(`DELETE FROM ${escapeId(table)}`);

  let copied = 0;
  const chunkSize = Number(process.env.SYNC_CHUNK_SIZE || 500);
  for (let offset = 0; ; offset += chunkSize) {
    const [rows] = await remote.query(
      `SELECT ${commonColumns.map(escapeId).join(', ')}
         FROM ${escapeId(table)}
        LIMIT ? OFFSET ?`,
      [chunkSize, offset]
    );

    if (!rows.length) break;

    const values = rows.map((row) => commonColumns.map((column) => row[column]));
    await local.query(
      `INSERT INTO ${escapeId(table)} (${commonColumns.map(escapeId).join(', ')}) VALUES ?`,
      [values]
    );
    copied += rows.length;
  }

  return { table, copied, skipped: false };
}

async function syncDirectDatabase() {
  const localConfig = localDbConfig();
  const prodConfig = productionDbConfig();

  if (!prodConfig) return null;
  if (sameDatabase(localConfig, prodConfig)) {
    throw new Error('Banco de producao e banco local parecem ser o mesmo. Sincronizacao abortada por seguranca.');
  }

  const local = await mysql.createConnection(localConfig);
  const remote = await mysql.createConnection(prodConfig);

  try {
    const backupDir = await backupLocalDatabase(local, 'antes-sync-producao');
    const tables = await listTables(remote);
    const result = [];
    await local.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of tables) {
      result.push(await copyTable(remote, local, table));
    }

    await local.query('SET FOREIGN_KEY_CHECKS = 1');
    return { mode: 'database', backupDir, tables: result };
  } finally {
    await local.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    await remote.end();
    await local.end();
  }
}

async function loginProductionApi(baseUrl) {
  const email = process.env.MASTER_ADMIN_EMAIL;
  const password = process.env.MASTER_ADMIN_PASSWORD;
  if (!baseUrl || !email || !password) {
    throw new Error('PUBLIC_API_URL, MASTER_ADMIN_EMAIL e MASTER_ADMIN_PASSWORD sao necessarios para sincronizacao via API.');
  }

  const response = await axios.post(`${baseUrl.replace(/\/$/, '')}/login`, { email, password }, { timeout: 30000 });
  const token = response.data?.token || response.data?.accessToken;
  if (!token) throw new Error('Login na API de producao nao retornou token.');
  return token;
}

async function upsertClinics(local, clinics = []) {
  const localColumns = await listColumns(local, 'clinics');
  const allowed = ['id', 'name', 'city', 'state', 'region', 'responsible_name', 'responsible_email', 'responsible_whatsapp', 'coordinator_name', 'manager_name', 'active', 'created_at', 'updated_at']
    .filter((column) => localColumns.includes(column));
  let changed = 0;

  for (const clinic of clinics) {
    if (!clinic?.name || !allowed.length) continue;
    const payload = Object.fromEntries(allowed.map((column) => [column, clinic[column] ?? null]));
    if (payload.created_at) payload.created_at = toMysqlDateTime(payload.created_at);
    if (payload.updated_at) payload.updated_at = toMysqlDateTime(payload.updated_at);
    const columns = Object.keys(payload);
    const updates = columns.filter((column) => column !== 'id').map((column) => `${escapeId(column)} = VALUES(${escapeId(column)})`).join(', ');
    await local.query(
      `INSERT INTO clinics (${columns.map(escapeId).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${updates || 'name = VALUES(name)'}`,
      columns.map((column) => payload[column])
    );
    changed += 1;
  }

  return changed;
}

async function upsertUsers(local, users = []) {
  const localColumns = await listColumns(local, 'users');
  const selectable = ['name', 'email', 'role', 'position', 'phone', 'whatsapp', 'department', 'permissions', 'action_permissions', 'active', 'must_change_password', 'created_at', 'updated_at']
    .filter((column) => localColumns.includes(column));
  const hash = await bcrypt.hash(`sync-${crypto.randomBytes(16).toString('hex')}`, 10);
  let changed = 0;

  for (const user of users) {
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) continue;

    const [existing] = await local.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
    const payload = {
      name: user.name || email,
      email,
      role: user.role || 'viewer',
      position: user.position || '',
      phone: user.phone || '',
      whatsapp: user.whatsapp || '',
      department: user.department || '',
      permissions: JSON.stringify(user.permissions || []),
      action_permissions: JSON.stringify(user.actionPermissions || user.action_permissions || []),
      active: Number(user.active) ? 1 : 0,
      must_change_password: Number(user.must_change_password) ? 1 : 0,
      created_at: toMysqlDateTime(user.created_at) || toMysqlDateTime(new Date()),
      updated_at: toMysqlDateTime(user.updated_at) || toMysqlDateTime(new Date())
    };

    if (existing.length) {
      const columns = selectable.filter((column) => column !== 'email' && column !== 'created_at');
      await local.query(
        `UPDATE users SET ${columns.map((column) => `${escapeId(column)} = ?`).join(', ')} WHERE id = ?`,
        [...columns.map((column) => payload[column]), existing[0].id]
      );
    } else {
      const insertColumns = [...selectable, 'password_hash'].filter((column) => localColumns.includes(column));
      const values = insertColumns.map((column) => (column === 'password_hash' ? hash : payload[column]));
      await local.query(
        `INSERT INTO users (${insertColumns.map(escapeId).join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`,
        values
      );
    }
    changed += 1;
  }

  return changed;
}

async function syncViaProductionApi() {
  const baseUrl = process.env.PUBLIC_API_URL;
  const token = await loginProductionApi(baseUrl);
  const client = axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    timeout: 60000,
    headers: { Authorization: `Bearer ${token}` }
  });
  const local = await mysql.createConnection(localDbConfig());

  try {
    const backupDir = await backupLocalDatabase(local, 'antes-sync-api');
    const [usersRes, clinicsRes] = await Promise.all([
      client.get('/admin/users'),
      client.get('/clinics')
    ]);
    const snapshotDir = path.join(backupDir, 'snapshot-producao-api');
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(path.join(snapshotDir, 'users.json'), JSON.stringify(usersRes.data || [], null, 2), 'utf8');
    fs.writeFileSync(path.join(snapshotDir, 'clinics.json'), JSON.stringify(clinicsRes.data || [], null, 2), 'utf8');

    const clinics = await upsertClinics(local, Array.isArray(clinicsRes.data) ? clinicsRes.data : []);
    const users = await upsertUsers(local, Array.isArray(usersRes.data) ? usersRes.data : []);
    return { mode: 'api', backupDir, users, clinics };
  } finally {
    await local.end();
  }
}

async function main() {
  const direct = await syncDirectDatabase();
  const result = direct || await syncViaProductionApi();
  console.log(JSON.stringify({
    ok: true,
    finishedAt: new Date().toISOString(),
    ...result
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    finishedAt: new Date().toISOString(),
    error: error.message
  }, null, 2));
  process.exitCode = 1;
});
