'use strict';

require('dotenv').config({ quiet: true });

const {
  getDatabaseConfigMetadata,
  resolveDatabaseConfig
} = require('../utils/databaseConfig');

const resolved = resolveDatabaseConfig(process.env);
const metadata = getDatabaseConfigMetadata(process.env);

process.env.DB_HOST = resolved.host;
process.env.DB_PORT = String(resolved.port || 3306);
process.env.DB_USER = resolved.user;
process.env.DB_PASSWORD = resolved.password;
process.env.DB_NAME = resolved.database;

console.log('NPS_ENTERPRISE_DATABASE_RESOLVED', metadata);

require('./verifyNpsEnterpriseReadiness');
