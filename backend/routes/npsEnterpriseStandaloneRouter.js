'use strict';

const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { createNpsEnterpriseRouter } = require('./npsEnterpriseRoutes');

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Math.max(2, Number(process.env.NPS_ENTERPRISE_DB_POOL_SIZE || 5)),
  queueLimit: 0,
  timezone: 'Z'
});

function authenticate(req, res, next) {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const secret = String(process.env.JWT_SECRET || '').trim();

  if (!token || !secret) {
    return res.status(401).json({ error: 'Autenticação obrigatória.' });
  }

  try {
    req.user = jwt.verify(token, secret, {
      issuer: process.env.JWT_ISSUER || undefined
    });
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

function authorizeManagement(req, res, next) {
  const role = String(req.user?.role || req.user?.perfil || '').toLowerCase();
  const allowed = new Set([
    'master_admin',
    'admin',
    'supervisor_crc',
    'gerente',
    'gerente_crc',
    'lider_crc',
    'coordenador',
    'crc'
  ]);

  if (!allowed.has(role)) {
    return res.status(403).json({ error: 'Perfil sem permissão para gestão NPS enterprise.' });
  }

  return next();
}

module.exports = createNpsEnterpriseRouter({
  db,
  authenticate,
  authorizeManagement
});
