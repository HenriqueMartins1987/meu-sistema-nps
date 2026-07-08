'use strict';

const express = require('express');
const { z } = require('zod');
const {
  VALID_PRIORITIES,
  VALID_RECOVERY_STATUS,
  calculateExperienceRisk,
  calculateSlaState,
  deriveOperationalPriority
} = require('../services/npsEnterpriseService');

const managementSchema = z.object({
  operational_priority: z.enum(VALID_PRIORITIES).optional(),
  management_substatus: z.string().trim().max(40).nullable().optional(),
  cause_category: z.string().trim().max(120).nullable().optional(),
  cause_subcategory: z.string().trim().max(160).nullable().optional(),
  root_cause: z.string().trim().max(5000).nullable().optional(),
  responsible_user_id: z.coerce.number().int().positive().nullable().optional(),
  responsible_name: z.string().trim().max(180).nullable().optional(),
  sla_due_at: z.string().datetime({ offset: true }).nullable().optional(),
  recovery_status: z.enum(VALID_RECOVERY_STATUS).optional(),
  treatment_comment: z.string().trim().max(5000).nullable().optional(),
  nps_status: z.enum(['registrado', 'em_tratativa', 'tratado']).optional()
});

const extensionSchema = z.object({
  new_due_at: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(10).max(3000)
});

function actorFromRequest(req = {}) {
  const user = req.user || {};
  return {
    id: user.id || user.user_id || null,
    name: user.name || user.nome || user.email || 'Usuário não identificado',
    role: user.role || user.perfil || null,
    ip: req.ip || req.headers?.['x-forwarded-for'] || null
  };
}

function asSqlDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function createNpsEnterpriseRouter({ db, authenticate, authorizeManagement } = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('createNpsEnterpriseRouter requer db.query().');
  }
  if (typeof authenticate !== 'function') {
    throw new Error('createNpsEnterpriseRouter requer middleware de autenticação.');
  }

  const router = express.Router();
  const managementGuard = typeof authorizeManagement === 'function'
    ? [authenticate, authorizeManagement]
    : [authenticate];

  router.get('/causes', ...managementGuard, async (_req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT id, category, subcategory, description, owner_area, default_priority, sort_order
        FROM nps_cause_taxonomy
        WHERE is_active = 1
        ORDER BY sort_order ASC, category ASC, subcategory ASC
      `);
      return res.json(rows || []);
    } catch (error) {
      console.error('[nps-enterprise] causes:', error);
      return res.status(500).json({ error: 'Não foi possível carregar a taxonomia NPS.' });
    }
  });

  router.patch('/responses/:id/management', ...managementGuard, async (req, res) => {
    const responseId = Number(req.params.id);
    if (!Number.isInteger(responseId) || responseId <= 0) {
      return res.status(400).json({ error: 'ID NPS inválido.' });
    }

    const parsed = managementSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados de gestão NPS inválidos.', details: parsed.error.flatten() });
    }

    const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;
    const actor = actorFromRequest(req);

    try {
      if (typeof connection.beginTransaction === 'function') await connection.beginTransaction();

      const [existingRows] = await connection.query('SELECT * FROM nps_responses WHERE id = ? LIMIT 1 FOR UPDATE', [responseId]);
      const current = existingRows?.[0];
      if (!current) {
        if (typeof connection.rollback === 'function') await connection.rollback();
        return res.status(404).json({ error: 'Pesquisa NPS não encontrada.' });
      }

      const payload = parsed.data;
      const next = { ...current, ...payload };
      const priority = payload.operational_priority || current.operational_priority || deriveOperationalPriority(next);
      const slaState = calculateSlaState({ ...next, operational_priority: priority });
      const risk = calculateExperienceRisk({ ...next, operational_priority: priority });
      const nowSql = asSqlDateTime(new Date().toISOString());

      const fields = [];
      const values = [];
      const setField = (name, value) => {
        fields.push(`${name} = ?`);
        values.push(value);
      };

      setField('operational_priority', priority);
      setField('experience_risk_score', risk.score);
      setField('experience_risk_level', risk.level);
      setField('sla_status', slaState.code);

      [
        'management_substatus', 'cause_category', 'cause_subcategory', 'root_cause',
        'responsible_user_id', 'responsible_name', 'recovery_status'
      ].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(payload, key)) setField(key, payload[key]);
      });

      if (Object.prototype.hasOwnProperty.call(payload, 'sla_due_at')) {
        setField('sla_due_at', asSqlDateTime(payload.sla_due_at));
      }

      if (payload.nps_status) {
        setField('nps_status', payload.nps_status);
        if (payload.nps_status === 'em_tratativa' && !current.first_action_at) setField('first_action_at', nowSql);
        if (payload.nps_status === 'tratado') {
          setField('resolved_at', current.resolved_at || nowSql);
          setField('closed_at', nowSql);
        }
      }

      if (payload.recovery_status === 'recuperado') setField('recovered_at', nowSql);
      if (payload.treatment_comment) {
        setField('nps_treatment_comment', payload.treatment_comment);
        setField('nps_treatment_at', nowSql);
        setField('nps_treatment_by', actor.name);
      }

      if (fields.length) {
        values.push(responseId);
        await connection.query(`UPDATE nps_responses SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
      }

      await connection.query(`
        INSERT INTO nps_management_events
          (nps_response_id, action, event_type, previous_value_json, new_value_json, message,
           actor_user_id, actor_name, actor_role, source_ip, source_channel)
        VALUES (?, 'management_update', 'management', ?, ?, ?, ?, ?, ?, ?, 'web')
      `, [
        responseId,
        JSON.stringify(current),
        JSON.stringify({ ...payload, operational_priority: priority, sla_status: slaState.code, experience_risk_score: risk.score, experience_risk_level: risk.level }),
        payload.treatment_comment || 'Atualização gerencial do registro NPS.',
        actor.id,
        actor.name,
        actor.role,
        actor.ip
      ]);

      if (typeof connection.commit === 'function') await connection.commit();
      const [updatedRows] = await db.query('SELECT * FROM nps_responses WHERE id = ? LIMIT 1', [responseId]);
      return res.json({ response: updatedRows?.[0] || null, risk, sla: slaState });
    } catch (error) {
      if (typeof connection.rollback === 'function') await connection.rollback().catch(() => null);
      console.error('[nps-enterprise] management update:', error);
      return res.status(500).json({ error: 'Não foi possível salvar a gestão NPS.' });
    } finally {
      if (connection !== db && typeof connection.release === 'function') connection.release();
    }
  });

  router.post('/responses/:id/sla-extension', ...managementGuard, async (req, res) => {
    const responseId = Number(req.params.id);
    const parsed = extensionSchema.safeParse(req.body || {});
    if (!Number.isInteger(responseId) || responseId <= 0 || !parsed.success) {
      return res.status(400).json({ error: 'Dados de prorrogação inválidos.' });
    }

    const actor = actorFromRequest(req);
    const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;

    try {
      if (typeof connection.beginTransaction === 'function') await connection.beginTransaction();
      const [rows] = await connection.query('SELECT id, sla_due_at FROM nps_responses WHERE id = ? LIMIT 1 FOR UPDATE', [responseId]);
      const current = rows?.[0];
      if (!current) {
        if (typeof connection.rollback === 'function') await connection.rollback();
        return res.status(404).json({ error: 'Pesquisa NPS não encontrada.' });
      }
      if (!current.sla_due_at) {
        if (typeof connection.rollback === 'function') await connection.rollback();
        return res.status(409).json({ error: 'O registro ainda não possui SLA definido.' });
      }

      const newDueAt = asSqlDateTime(parsed.data.new_due_at);
      await connection.query(`
        INSERT INTO nps_sla_extensions
          (nps_response_id, previous_due_at, new_due_at, reason, requested_by_user_id, requested_by_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [responseId, current.sla_due_at, newDueAt, parsed.data.reason, actor.id, actor.name]);

      await connection.query(`
        UPDATE nps_responses
        SET sla_due_at = ?, sla_status = 'extended', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [newDueAt, responseId]);

      await connection.query(`
        INSERT INTO nps_management_events
          (nps_response_id, action, event_type, previous_value_json, new_value_json, message,
           actor_user_id, actor_name, actor_role, source_ip, source_channel)
        VALUES (?, 'sla_extended', 'sla', ?, ?, ?, ?, ?, ?, ?, 'web')
      `, [
        responseId,
        JSON.stringify({ sla_due_at: current.sla_due_at }),
        JSON.stringify({ sla_due_at: newDueAt }),
        parsed.data.reason,
        actor.id,
        actor.name,
        actor.role,
        actor.ip
      ]);

      if (typeof connection.commit === 'function') await connection.commit();
      return res.json({ success: true, previousDueAt: current.sla_due_at, newDueAt });
    } catch (error) {
      if (typeof connection.rollback === 'function') await connection.rollback().catch(() => null);
      console.error('[nps-enterprise] SLA extension:', error);
      return res.status(500).json({ error: 'Não foi possível prorrogar o SLA.' });
    } finally {
      if (connection !== db && typeof connection.release === 'function') connection.release();
    }
  });

  router.get('/responses/:id/timeline', ...managementGuard, async (req, res) => {
    const responseId = Number(req.params.id);
    if (!Number.isInteger(responseId) || responseId <= 0) {
      return res.status(400).json({ error: 'ID NPS inválido.' });
    }

    try {
      const [rows] = await db.query(`
        SELECT id, action, event_type, message, actor_user_id, actor_name, actor_role,
               previous_value_json, new_value_json, created_at
        FROM nps_management_events
        WHERE nps_response_id = ?
        ORDER BY created_at DESC, id DESC
      `, [responseId]);
      return res.json(rows || []);
    } catch (error) {
      console.error('[nps-enterprise] timeline:', error);
      return res.status(500).json({ error: 'Não foi possível carregar a timeline NPS.' });
    }
  });

  return router;
}

module.exports = {
  createNpsEnterpriseRouter,
  managementSchema
};
