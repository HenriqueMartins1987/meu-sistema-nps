'use strict';

/**
 * Trava operacional central do sistema NPS.
 *
 * 1) A partir de 31/07/2026 às 08:00 (America/Sao_Paulo), somente o
 *    Administrador Master pode autenticar e utilizar a API.
 * 2) A partir da publicação deste arquivo, qualquer entrega de PDF ou
 *    Excel é permitida somente ao Administrador Master.
 *
 * Este módulo é carregado com `node -r` antes do servidor principal para
 * que as regras sejam aplicadas inclusive a rotas legadas.
 */

require('dotenv').config();

const express = require('express');
const jwt = require('jsonwebtoken');

const DEFAULT_SUSPENSION_AT = '2026-07-31T11:00:00.000Z'; // 31/07/2026 08:00 BRT
const SUSPENSION_MESSAGE = 'O sistema encontra-se suspenso por ausência de regularização contratual. O acesso permanece disponível exclusivamente ao Administrador Master.';
const EXPORT_RESTRICTION_MESSAGE = 'A exportação ou o download de arquivos PDF e Excel está disponível exclusivamente ao Administrador Master.';

function normalizeRole(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const aliases = {
    administrador_master: 'master_admin',
    master: 'master_admin',
    masteradmin: 'master_admin'
  };

  return aliases[normalized] || normalized;
}

function suspensionTimestamp() {
  const configured = String(process.env.SYSTEM_SUSPENSION_AT || DEFAULT_SUSPENSION_AT).trim();
  const parsed = Date.parse(configured);
  return Number.isFinite(parsed) ? parsed : Date.parse(DEFAULT_SUSPENSION_AT);
}

function isSystemSuspended(now = Date.now()) {
  return Number(now) >= suspensionTimestamp();
}

function isMasterIdentity(identity) {
  if (!identity || typeof identity !== 'object') return false;

  const role = normalizeRole(
    identity.role
    || identity.profile
    || identity.accessProfile
    || identity.access_profile
    || identity.userRole
    || identity.user_role
  );

  if (role === 'master_admin') return true;
  if (identity.isMasterAdmin === true || identity.is_master_admin === true || identity.master === true) return true;

  const configuredMasterEmail = String(process.env.MASTER_ADMIN_EMAIL || '').trim().toLowerCase();
  const identityEmail = String(identity.email || identity.username || '').trim().toLowerCase();
  return Boolean(configuredMasterEmail && identityEmail && configuredMasterEmail === identityEmail);
}

function extractBearerToken(req) {
  const authorization = String(req?.headers?.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function verifyToken(token) {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!token || !secret) return null;

  try {
    return jwt.verify(token, secret);
  } catch (error) {
    return null;
  }
}

function readRequestIdentity(req) {
  if (isMasterIdentity(req?.user)) return req.user;
  return verifyToken(extractBearerToken(req));
}

function requestPath(req) {
  return String(req?.originalUrl || req?.url || '/')
    .split('#')[0]
    .toLowerCase();
}

function isHealthRequest(path) {
  return /(?:^|\/)health(?:\?|$)/.test(path);
}

function isMaintenanceStatusRequest(path) {
  return path.includes('/system/maintenance-status');
}

function isLoginRequest(path, method) {
  return String(method || 'GET').toUpperCase() === 'POST' && /(?:^|\/)login(?:\?|$)/.test(path);
}

function isPdfOrExcelDescriptor(value) {
  const descriptor = String(value || '').toLowerCase();
  if (!descriptor) return false;

  return (
    descriptor.includes('application/pdf')
    || descriptor.includes('application/vnd.ms-excel')
    || descriptor.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    || /(?:^|[^a-z0-9])pdf(?:[^a-z0-9]|$)/.test(descriptor)
    || /(?:^|[^a-z0-9])xlsx?(?:[^a-z0-9]|$)/.test(descriptor)
    || /(?:^|[^a-z0-9])excel(?:[^a-z0-9]|$)/.test(descriptor)
  );
}

function isExportRequest(req) {
  const path = requestPath(req);
  const accept = String(req?.headers?.accept || '');
  const contentType = String(req?.headers?.['content-type'] || '');

  if (/\.(?:pdf|xlsx?|xls)(?:\?|$)/i.test(path)) return true;
  if (isPdfOrExcelDescriptor(accept)) return true;
  if (isPdfOrExcelDescriptor(contentType) && /(?:export|download|report|relatorio)/i.test(path)) return true;

  const hasExportIntent = /(?:export|exports|download|downloads|report|reports|relatorio|relatorios|imprimir|print)/i.test(path);
  const hasProtectedFormat = /(?:pdf|xlsx?|excel|planilha|spreadsheet)/i.test(path);
  return hasExportIntent && hasProtectedFormat;
}

function suspensionPayload() {
  return {
    error: SUSPENSION_MESSAGE,
    message: SUSPENSION_MESSAGE,
    code: 'SYSTEM_MAINTENANCE',
    maintenanceMode: true,
    enabled: true,
    suspended: true,
    suspensionAt: new Date(suspensionTimestamp()).toISOString(),
    masterOnly: true
  };
}

function sendJsonResponse(res, statusCode, payload) {
  if (typeof res?.status === 'function' && typeof res?.json === 'function') {
    return res.status(statusCode).json(payload);
  }

  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  if (!res.headersSent && typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(body));
  }
  return res.end(body);
}

function sendSuspended(res) {
  return sendJsonResponse(res, 503, suspensionPayload());
}

function sendMaintenanceStatus(res) {
  return sendJsonResponse(res, 200, suspensionPayload());
}

function sendExportDenied(res) {
  return sendJsonResponse(res, 403, {
    error: EXPORT_RESTRICTION_MESSAGE,
    code: 'MASTER_EXPORT_ONLY',
    masterOnly: true
  });
}

function wrapLoginResponse(res) {
  if (typeof res?.json !== 'function') {
    const originalEnd = res.end.bind(res);

    res.end = (chunk, encoding, callback) => {
      let payload = null;
      try {
        const body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
        payload = body ? JSON.parse(body) : null;
      } catch (_error) {
        return originalEnd(chunk, encoding, callback);
      }

      const token = payload?.token || payload?.data?.token || '';
      const identity = payload?.user || payload?.data?.user || verifyToken(token) || payload;
      const successfulLogin = Boolean(token || payload?.success);

      if (successfulLogin && !isMasterIdentity(identity)) {
        const body = JSON.stringify(suspensionPayload());
        res.statusCode = 503;
        if (!res.headersSent && typeof res.setHeader === 'function') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', Buffer.byteLength(body));
        }
        return originalEnd(body, 'utf8', callback);
      }

      return originalEnd(chunk, encoding, callback);
    };
    return;
  }

  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    const token = payload?.token || payload?.data?.token || '';
    const identity = payload?.user || payload?.data?.user || verifyToken(token) || payload;
    const successfulLogin = Boolean(token || payload?.success);

    if (successfulLogin && !isMasterIdentity(identity)) {
      res.status(503);
      return originalJson(suspensionPayload());
    }

    return originalJson(payload);
  };
}

function exportDeniedPayload() {
  return JSON.stringify({
    error: EXPORT_RESTRICTION_MESSAGE,
    code: 'MASTER_EXPORT_ONLY',
    masterOnly: true
  });
}

function protectBinaryResponse(res) {
  const originalSetHeader = res.setHeader.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  let protectedDownloadDetected = false;
  let denialHeadersWritten = false;

  res.setHeader = (name, value) => {
    const headerName = String(name || '').toLowerCase();
    if ((headerName === 'content-type' || headerName === 'content-disposition') && isPdfOrExcelDescriptor(value)) {
      protectedDownloadDetected = true;
    }
    return originalSetHeader(name, value);
  };

  res.writeHead = (statusCode, ...args) => {
    const headers = args.find((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (headers) {
      Object.entries(headers).forEach(([name, value]) => {
        const headerName = String(name || '').toLowerCase();
        if ((headerName === 'content-type' || headerName === 'content-disposition') && isPdfOrExcelDescriptor(value)) {
          protectedDownloadDetected = true;
        }
      });
    }

    if (protectedDownloadDetected && !res.headersSent) {
      denialHeadersWritten = true;
      res.statusCode = 403;
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Length');
      originalSetHeader('Content-Type', 'application/json; charset=utf-8');
      return originalWriteHead(403);
    }

    return originalWriteHead(statusCode, ...args);
  };

  res.write = (chunk, encoding, callback) => {
    if (protectedDownloadDetected || denialHeadersWritten) {
      if (typeof callback === 'function') callback();
      return true;
    }
    return originalWrite(chunk, encoding, callback);
  };

  res.end = (chunk, encoding, callback) => {
    if (protectedDownloadDetected || denialHeadersWritten) {
      if (!res.headersSent) {
        res.statusCode = 403;
        res.removeHeader('Content-Disposition');
        res.removeHeader('Content-Length');
        originalSetHeader('Content-Type', 'application/json; charset=utf-8');
      }
      return originalEnd(exportDeniedPayload(), 'utf8', callback);
    }

    return originalEnd(chunk, encoding, callback);
  };
}

function installSystemAccessGuard() {
  if (express.application.__npsSystemAccessGuardInstalled) return;
  express.application.__npsSystemAccessGuardInstalled = true;

  const originalHandle = express.application.handle;

  express.application.handle = function guardedHandle(req, res, callback) {
    const path = requestPath(req);
    const identity = readRequestIdentity(req);
    const master = isMasterIdentity(identity);

    if (!master) {
      protectBinaryResponse(res);
    }

    if (isExportRequest(req) && !master) {
      return sendExportDenied(res);
    }

    if (isSystemSuspended()) {
      if (String(req.method || '').toUpperCase() === 'OPTIONS' || isHealthRequest(path)) {
        return originalHandle.call(this, req, res, callback);
      }

      if (isMaintenanceStatusRequest(path)) {
        return sendMaintenanceStatus(res);
      }

      if (isLoginRequest(path, req.method)) {
        wrapLoginResponse(res);
        return originalHandle.call(this, req, res, callback);
      }

      if (!master) {
        return sendSuspended(res);
      }
    }

    return originalHandle.call(this, req, res, callback);
  };
}

installSystemAccessGuard();

module.exports = {
  DEFAULT_SUSPENSION_AT,
  EXPORT_RESTRICTION_MESSAGE,
  SUSPENSION_MESSAGE,
  isExportRequest,
  isMasterIdentity,
  isPdfOrExcelDescriptor,
  isSystemSuspended,
  normalizeRole,
  sendJsonResponse,
  wrapLoginResponse,
  suspensionTimestamp
};
