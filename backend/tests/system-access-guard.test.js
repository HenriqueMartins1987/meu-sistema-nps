'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SUSPENSION_AT,
  isMasterIdentity,
  isPdfOrExcelDescriptor,
  isSystemSuspended,
  normalizeRole,
  sendJsonResponse
} = require('../systemAccessGuard');

test('normaliza perfis equivalentes ao Administrador Master', () => {
  assert.equal(normalizeRole('Administrador Master'), 'master_admin');
  assert.equal(normalizeRole('MASTER'), 'master_admin');
  assert.equal(isMasterIdentity({ role: 'master_admin' }), true);
  assert.equal(isMasterIdentity({ role: 'admin' }), false);
});

test('considera o sistema ativo antes e suspenso a partir de 31/07/2026 08:00 BRT', () => {
  const cutoff = Date.parse(DEFAULT_SUSPENSION_AT);
  assert.equal(isSystemSuspended(cutoff - 1), false);
  assert.equal(isSystemSuspended(cutoff), true);
  assert.equal(isSystemSuspended(cutoff + 1), true);
});

test('reconhece respostas e arquivos PDF ou Excel', () => {
  assert.equal(isPdfOrExcelDescriptor('application/pdf'), true);
  assert.equal(isPdfOrExcelDescriptor('attachment; filename="relatorio.xlsx"'), true);
  assert.equal(isPdfOrExcelDescriptor('application/vnd.ms-excel'), true);
  assert.equal(isPdfOrExcelDescriptor('application/json'), false);
});

test('responde com JSON usando ServerResponse nativa sem encerrar o processo', () => {
  const headers = new Map();
  let body = '';
  const response = {
    headersSent: false,
    setHeader(name, value) {
      headers.set(name, value);
    },
    end(value) {
      body = value;
      return this;
    }
  };

  const result = sendJsonResponse(response, 503, { code: 'SYSTEM_MAINTENANCE' });

  assert.equal(result, response);
  assert.equal(response.statusCode, 503);
  assert.equal(headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(JSON.parse(body).code, 'SYSTEM_MAINTENANCE');
});
