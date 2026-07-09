'use strict';

function firstConfigured(env, names) {
  for (const name of names) {
    const value = String(env[name] || '').trim();
    if (value) return { name, value };
  }
  return null;
}

function parseDatabaseUrl(rawUrl, sourceName) {
  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    throw new Error(`URL de banco inválida em ${sourceName}.`);
  }

  if (!['mysql:', 'mysql2:'].includes(parsed.protocol)) {
    throw new Error(`Protocolo de banco não suportado em ${sourceName}: ${parsed.protocol}`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));

  if (!parsed.hostname || !parsed.username || !database) {
    throw new Error(`Configuração incompleta em ${sourceName}.`);
  }

  return {
    source: `url:${sourceName}`,
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password || ''),
    database,
    ssl: undefined
  };
}

function resolveFieldSet(env, prefix, source) {
  const host = String(env[`${prefix}HOST`] || '').trim();
  const port = String(env[`${prefix}PORT`] || '').trim();
  const user = String(env[`${prefix}USER`] || '').trim();
  const password = String(env[`${prefix}PASSWORD`] || '').trim();
  const database = String(env[`${prefix}NAME`] || '').trim();

  if (!host || !user || !database) return null;

  return {
    source,
    host,
    port: Number(port || 3306),
    user,
    password,
    database,
    ssl: undefined
  };
}

function resolveRailwayFields(env) {
  const host = String(env.MYSQLHOST || '').trim();
  const port = String(env.MYSQLPORT || '').trim();
  const user = String(env.MYSQLUSER || '').trim();
  const password = String(env.MYSQLPASSWORD || '').trim();
  const database = String(env.MYSQLDATABASE || '').trim();

  if (!host || !user || !database) return null;

  return {
    source: 'fields:RAILWAY_MYSQL',
    host,
    port: Number(port || 3306),
    user,
    password,
    database,
    ssl: undefined
  };
}

function resolveDatabaseConfig(env = process.env) {
  const urlCandidate = firstConfigured(env, [
    'DATABASE_URL',
    'MYSQL_URL',
    'MYSQL_PUBLIC_URL',
    'MYSQL_PRIVATE_URL',
    'PROD_DATABASE_URL',
    'PRODUCTION_DATABASE_URL'
  ]);

  if (urlCandidate) {
    return parseDatabaseUrl(urlCandidate.value, urlCandidate.name);
  }

  const standard = resolveFieldSet(env, 'DB_', 'fields:DB');
  if (standard) return standard;

  const production = resolveFieldSet(env, 'PROD_DB_', 'fields:PROD_DB');
  if (production) return production;

  const railway = resolveRailwayFields(env);
  if (railway) return railway;

  throw new Error(
    'Nenhuma configuração de banco compatível foi encontrada. ' +
    'Aceitos: DATABASE_URL, MYSQL_URL, MYSQL_PUBLIC_URL, MYSQL_PRIVATE_URL, ' +
    'PROD_DATABASE_URL, PRODUCTION_DATABASE_URL, DB_*, PROD_DB_* ou MYSQLHOST/MYSQLUSER/MYSQLDATABASE.'
  );
}

function buildMysqlPoolConfig(env = process.env, overrides = {}) {
  const resolved = resolveDatabaseConfig(env);

  return {
    host: resolved.host,
    port: resolved.port,
    user: resolved.user,
    password: resolved.password,
    database: resolved.database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    timezone: 'Z',
    ...overrides
  };
}

function getDatabaseConfigMetadata(env = process.env) {
  const resolved = resolveDatabaseConfig(env);

  return {
    source: resolved.source,
    host: resolved.host,
    port: resolved.port,
    database: resolved.database,
    userConfigured: Boolean(resolved.user),
    passwordConfigured: Boolean(resolved.password)
  };
}

module.exports = {
  buildMysqlPoolConfig,
  getDatabaseConfigMetadata,
  resolveDatabaseConfig
};
