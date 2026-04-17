// ============================================
// IMPORTAÇÕES
// ============================================
require('dotenv').config({ quiet: true });

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const axios = require('axios');

const app = express();

// ============================================
// CONFIG
// ============================================
const PORT = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET || 'segredo_super_forte';
const publicBaseUrl = process.env.PUBLIC_API_URL || `http://localhost:${PORT}`;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const approvalEmail = process.env.APPROVAL_EMAIL || 'henrique.martins@grcconsultoria.net.br';
const masterAdminEmail = (process.env.MASTER_ADMIN_EMAIL || 'henrique.martins@grcconsultoria.net.br').toLowerCase();
const defaultAdminEmail = masterAdminEmail;
const defaultAdminPassword = process.env.MASTER_ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || 'Zyck1987#';
const whatsappWebhookUrl = process.env.WHATSAPP_WEBHOOK_URL || '';
const whatsappGroupId = process.env.WHATSAPP_GROUP_ID || '';
const uploadDir = path.join(__dirname, 'uploads');
const reportsDir = path.join(uploadDir, 'reports');
const maxUploadSizeBytes = 10 * 1024 * 1024;

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(reportsDir, { recursive: true });

// ============================================
// MIDDLEWARES
// ============================================
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://meu-sistema-nps.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.use(express.json());
app.use('/uploads', express.static(uploadDir));

// ============================================
// CONFIGURAÇÃO DE UPLOAD (CORRETA)
// ============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: maxUploadSizeBytes
  }
});

// ============================================
// BANCO
// ============================================
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'nps_system',
  waitForConnections: true,
  connectionLimit: 10
});

const complaintTypeSuggestions = [
  'Atendimento e acolhimento',
  'Agendamento, atraso ou tempo de espera',
  'Comunicação e explicação do tratamento',
  'Orçamento, cobrança ou contrato',
  'Qualidade do tratamento realizado',
  'Dor, complicação ou pós-atendimento',
  'Resultado estético ou expectativa',
  'Higiene, biossegurança ou estrutura',
  'Documentação, laudos ou prontuário',
  'Conduta da equipe clínica',
  'Outros'
];

const collaboratorPositions = [
  'Operador de SAC',
  'Supervisor do CRC',
  'Coordenador de unidade',
  'Gerente de unidade',
  'Gerente regional',
  'Analista de Qualidade / NPS',
  'Recepção / Atendimento',
  'Administrativo',
  'Diretoria',
  'Outros'
];

const accessProfiles = {
  admin: 'Administrador',
  sac_operator: 'Operador de SAC',
  supervisor_crc: 'Supervisor do CRC',
  coordinator: 'Coordenador',
  manager: 'Gerente',
  viewer: 'Marketing'
};

const screenPermissions = {
  home: 'Home',
  complaints_register: 'Cadastro de protocolos',
  complaints_management: 'Painel de gestão de reclamações',
  complaints_dashboard: 'Dashboard de reclamações',
  nps_management: 'Painel de gestão NPS',
  nps_dashboard: 'Dashboard NPS',
  patient_management: 'Gestão do paciente',
  admin_panel: 'Painel gerencial'
};

const deadlineHoursByPriority = {
  baixa: 72,
  media: 48,
  alta: 24
};
const resolutionSlaDays = 15;

const treatmentRoles = new Set(['coordinator', 'manager', 'supervisor_crc']);
const evidenceRoles = new Set(['coordinator', 'manager', 'supervisor_crc', 'sac_operator', 'admin']);

function normalizePriority(priority) {
  const value = String(priority || 'media').toLowerCase();
  return deadlineHoursByPriority[value] ? value : 'media';
}

function calculateDueAt(priority) {
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + deadlineHoursByPriority[normalizePriority(priority)]);
  return dueAt;
}

function calculateResolutionDueAt(baseDate = new Date()) {
  const dueAt = new Date(baseDate);
  dueAt.setDate(dueAt.getDate() + resolutionSlaDays);
  return dueAt;
}

function getRequestIp(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  const remoteAddress = String(req.socket?.remoteAddress || req.ip || '').trim();
  return forwardedFor || realIp || remoteAddress || 'ip-nao-informado';
}

function toMysqlDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');

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

function formatNpsProtocol(id, createdAt) {
  const year = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
  return `NPS-${year}-${String(id).padStart(6, '0')}`;
}

function formatPatientProtocol(id, createdAt) {
  const year = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
  return `PAC-${year}-${String(id).padStart(6, '0')}`;
}

function normalizeNpsStatus(value) {
  const normalized = String(value || 'registrado').toLowerCase();
  const allowed = new Set(['registrado', 'em_tratativa', 'tratado']);
  return allowed.has(normalized) ? normalized : 'registrado';
}

function getActorName(user) {
  return user?.name || user?.email || 'Usuário autenticado';
}

function isAdminUser(user) {
  const email = String(user?.email || '').toLowerCase();
  return user?.role === 'admin'
    || user?.role === 'master_admin'
    || email === 'admin@sorria.com'
    || email === masterAdminEmail
    || email === defaultAdminEmail;
}

function isMasterAdminUser(user) {
  const email = String(user?.email || '').toLowerCase();
  return email === masterAdminEmail;
}

function defaultPermissionsForRole(role) {
  if (role === 'master_admin' || role === 'admin') {
    return Object.keys(screenPermissions);
  }

  if (role === 'sac_operator') {
    return ['home', 'complaints_register', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard'];
  }

  if (['supervisor_crc', 'coordinator', 'manager'].includes(role)) {
    return ['home', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'patient_management'];
  }

  return ['home', 'complaints_management', 'nps_management'];
}

function canAttachEvidence(user) {
  return evidenceRoles.has(user?.role) || isAdminUser(user);
}

function canAddTreatment(user) {
  return treatmentRoles.has(user?.role) || isAdminUser(user);
}

function canCloseComplaint(user) {
  return user?.role === 'sac_operator' || isAdminUser(user);
}

function canSupervisorApprove(user) {
  return user?.role === 'supervisor_crc' || isAdminUser(user);
}

function canMarkPatientContact(user) {
  return user?.role === 'sac_operator' || isAdminUser(user);
}

function canRegisterFirstAttendance(user) {
  return user?.role === 'sac_operator' || isAdminUser(user);
}

function canDeleteRecords(user) {
  return isMasterAdminUser(user) || user?.role === 'supervisor_crc';
}

function canViewDeletedRecords(user) {
  return isAdminUser(user) || user?.role === 'supervisor_crc';
}

function classifyNpsFeedback(score, feedbackType) {
  const normalized = String(feedbackType || '').toLowerCase();

  if (normalized.includes('elog')) return 'Elogio';
  if (normalized.includes('sug')) return 'Sugestão';
  if (normalized.includes('reclam')) return 'Reclamação';

  const numericScore = Number(score);

  if (numericScore >= 9) return 'Elogio';
  if (numericScore >= 7) return 'Sugestão';
  return 'Reclamação';
}

function priorityForNpsFeedback(score, classification) {
  if (classification === 'Reclamação' && Number(score) <= 6) return 'alta';
  return 'baixa';
}

function normalizeCreatedOrigin(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized.includes('marketing')) return 'Marketing';
  if (normalized.includes('extern')) return 'Externo';
  return 'Interno';
}

function normalizeBrazilPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (!digits) return '';

  return `+${digits.startsWith('55') ? digits : `55${digits}`}`.slice(0, 14);
}

function isCompleteBrazilPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 13 && digits.startsWith('55');
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if ((char === ';' || char === ',') && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((value) => value.replace(/^"|"$/g, '').trim());
}

function normalizeColumnName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseBulkNpsCsv(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeColumnName);
  const nameIndex = headers.findIndex((header) => ['nome', 'paciente', 'patient_name'].includes(header));
  const phoneIndex = headers.findIndex((header) => ['telefone', 'whatsapp', 'telefone / whatsapp', 'telefone_whatsapp', 'patient_phone'].includes(header));

  if (nameIndex === -1 || phoneIndex === -1) {
    throw new Error('A planilha precisa conter as colunas Nome e Telefone / WhatsApp.');
  }

  return lines.slice(1).map((line) => {
    const columns = splitCsvLine(line);
    return {
      name: String(columns[nameIndex] || '').trim(),
      phone: normalizeBrazilPhone(columns[phoneIndex] || '')
    };
  }).filter((row) => row.name && row.phone);
}

function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function inferNpsProfile(score) {
  const numericScore = Number(score);

  if (numericScore >= 9) return 'promotor';
  if (numericScore >= 7) return 'neutro';
  return 'detrator';
}

function buildNpsNarrative(payload, classification, profile) {
  const notes = [`Registro originado da pesquisa NPS com classificação ${classification}.`];
  const comment = String(payload.comment || '').trim();
  const improvement = String(payload.improvement_comment || '').trim();
  const detractorFeedback = String(payload.detractor_feedback || '').trim();
  const reasons = Array.isArray(payload.detractor_reasons)
    ? payload.detractor_reasons.filter(Boolean)
    : [];

  if (comment) {
    notes.push(comment);
  }

  if (profile === 'promotor' && payload.recommend_yes) {
    const referralName = String(payload.referral_name || '').trim();
    const referralPhone = String(payload.referral_phone || '').trim();
    const referralParts = [referralName, referralPhone].filter(Boolean);

    notes.push(
      referralParts.length
        ? `Cliente informou que indicaria ${referralParts.join(' - ')}.`
        : 'Cliente informou que indicaria a experiência para um familiar ou amigo.'
    );
  }

  if (profile === 'neutro' && improvement) {
    notes.push(`Oportunidade de melhoria apontada: ${improvement}`);
  }

  if (profile === 'detrator') {
    if (reasons.length) {
      notes.push(`Pontos críticos sinalizados: ${reasons.join(', ')}.`);
    }

    if (detractorFeedback) {
      notes.push(detractorFeedback);
    }
  }

  return notes.join(' ');
}

async function insertComplaintLog(complaintId, action, message, user) {
  await pool.query(
    `INSERT INTO complaint_logs
     (complaint_id, action, message, actor_name, actor_role)
     VALUES (?, ?, ?, ?, ?)`,
    [
      complaintId,
      action,
      message || null,
      getActorName(user),
      user?.role || null
    ]
  );
}

async function insertNpsLog(npsResponseId, action, message, user) {
  await pool.query(
    `INSERT INTO nps_treatment_logs
     (nps_response_id, action, message, actor_name, actor_role)
     VALUES (?, ?, ?, ?, ?)`,
    [
      npsResponseId,
      action,
      message || null,
      getActorName(user),
      user?.role || null
    ]
  );
}

async function insertPatientInteractionLog(interactionId, action, message, user) {
  await pool.query(
    `INSERT INTO patient_interaction_logs
     (interaction_id, action, message, actor_name, actor_role)
     VALUES (?, ?, ?, ?, ?)`,
    [
      interactionId,
      action,
      message || null,
      getActorName(user),
      user?.role || null
    ]
  );
}

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);

  if (rows.length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinics (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(180) NOT NULL,
      city VARCHAR(120) NULL,
      state VARCHAR(2) NULL,
      region VARCHAR(80) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      email VARCHAR(180) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(60) NOT NULL DEFAULT 'viewer',
      position VARCHAR(160) NULL,
      phone VARCHAR(40) NULL,
      whatsapp VARCHAR(40) NULL,
      department VARCHAR(160) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureColumn('users', 'role', "VARCHAR(60) NOT NULL DEFAULT 'viewer'");
  await pool.query("ALTER TABLE users MODIFY COLUMN role VARCHAR(60) NOT NULL DEFAULT 'viewer'");
  await ensureColumn('users', 'position', 'VARCHAR(160) NULL');
  await ensureColumn('users', 'phone', 'VARCHAR(40) NULL');
  await ensureColumn('users', 'whatsapp', 'VARCHAR(40) NULL');
  await ensureColumn('users', 'department', 'VARCHAR(160) NULL');
  await ensureColumn('users', 'permissions', 'LONGTEXT NULL');
  await ensureColumn('users', 'deleted_at', 'TIMESTAMP NULL');
  await ensureColumn('users', 'deleted_by', 'VARCHAR(160) NULL');
  await ensureColumn('users', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('users', 'active', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn('users', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('users', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await pool.query('ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NOT NULL');

  await ensureColumn('clinics', 'coordinator_name', 'VARCHAR(160) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_clinics (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      clinic_id INT NOT NULL,
      can_edit TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_clinic (user_id, clinic_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      type VARCHAR(80) NOT NULL,
      title VARCHAR(180) NOT NULL,
      message TEXT NULL,
      link VARCHAR(255) NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'unread',
      payload LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP NULL,
      INDEX idx_notification_events_user_id (user_id),
      INDEX idx_notification_events_status (status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_hidden (
      id INT AUTO_INCREMENT PRIMARY KEY,
      notification_id INT NOT NULL,
      user_id INT NOT NULL,
      hidden_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_notification_hidden (notification_id, user_id),
      INDEX idx_notification_hidden_user_id (user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patient_interactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      protocol VARCHAR(40) NULL,
      patient_name VARCHAR(160) NOT NULL,
      patient_phone VARCHAR(40) NOT NULL,
      channel VARCHAR(80) NOT NULL,
      clinic_name VARCHAR(180) NOT NULL,
      interaction_type VARCHAR(80) NOT NULL,
      scheduled_at DATETIME NULL,
      note TEXT NULL,
      status VARCHAR(60) NOT NULL DEFAULT 'Registrado',
      created_by_name VARCHAR(160) NULL,
      created_by_role VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_patient_interactions_created_at (created_at),
      INDEX idx_patient_interactions_status (status)
    )
  `);
  await ensureColumn('patient_interactions', 'protocol', 'VARCHAR(40) NULL');
  await ensureColumn('patient_interactions', 'cancelled_at', 'TIMESTAMP NULL');
  await ensureColumn('patient_interactions', 'cancelled_by_name', 'VARCHAR(160) NULL');
  await ensureColumn('patient_interactions', 'cancelled_by_role', 'VARCHAR(80) NULL');
  await ensureColumn('patient_interactions', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('patient_interactions', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patient_interaction_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      interaction_id INT NOT NULL,
      action VARCHAR(120) NOT NULL,
      message TEXT NULL,
      actor_name VARCHAR(160) NULL,
      actor_role VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_patient_interaction_logs_interaction_id (interaction_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS registration_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      email VARCHAR(180) NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(60) NOT NULL,
      position VARCHAR(160) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      whatsapp VARCHAR(40) NOT NULL,
      department VARCHAR(160) NULL,
      token VARCHAR(120) NOT NULL UNIQUE,
      status VARCHAR(30) NOT NULL DEFAULT 'pendente',
      approved_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nps_responses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clinic_id INT NULL,
      patient_name VARCHAR(160) NULL,
      score INT NOT NULL,
      comment TEXT NULL,
      feedback_type VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureColumn('nps_responses', 'feedback_type', 'VARCHAR(80) NULL');
  await ensureColumn('nps_responses', 'patient_phone', 'VARCHAR(40) NULL');
  await ensureColumn('nps_responses', 'nps_profile', 'VARCHAR(30) NULL');
  await ensureColumn('nps_responses', 'recommend_yes', 'TINYINT(1) NULL');
  await ensureColumn('nps_responses', 'referral_name', 'VARCHAR(160) NULL');
  await ensureColumn('nps_responses', 'referral_phone', 'VARCHAR(40) NULL');
  await ensureColumn('nps_responses', 'improvement_comment', 'TEXT NULL');
  await ensureColumn('nps_responses', 'detractor_reasons', 'TEXT NULL');
  await ensureColumn('nps_responses', 'detractor_feedback', 'LONGTEXT NULL');
  await ensureColumn('nps_responses', 'source', 'VARCHAR(80) NULL');
  await ensureColumn('nps_responses', 'nps_protocol', 'VARCHAR(40) NULL');
  await ensureColumn('nps_responses', 'nps_status', "VARCHAR(40) NOT NULL DEFAULT 'registrado'");
  await ensureColumn('nps_responses', 'nps_treatment_comment', 'LONGTEXT NULL');
  await ensureColumn('nps_responses', 'nps_treatment_at', 'TIMESTAMP NULL');
  await ensureColumn('nps_responses', 'nps_treatment_by', 'VARCHAR(160) NULL');
  await ensureColumn('nps_responses', 'nps_treatment_by_role', 'VARCHAR(80) NULL');
  await ensureColumn('nps_responses', 'deleted_at', 'TIMESTAMP NULL');
  await ensureColumn('nps_responses', 'deleted_by', 'VARCHAR(160) NULL');
  await ensureColumn('nps_responses', 'deletion_reason', 'TEXT NULL');
  await ensureColumn('nps_responses', 'converted_complaint_id', 'INT NULL');
  await ensureColumn('nps_responses', 'converted_at', 'TIMESTAMP NULL');
  await ensureColumn('nps_responses', 'converted_by', 'VARCHAR(160) NULL');
  await ensureColumn('nps_responses', 'contact_share_allowed', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('nps_responses', 'linked_patient_interaction_id', 'INT NULL');
  await ensureColumn('nps_responses', 'ip_address', 'VARCHAR(120) NULL');
  await ensureColumn('nps_responses', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nps_treatment_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nps_response_id INT NOT NULL,
      action VARCHAR(120) NOT NULL,
      message TEXT NULL,
      actor_name VARCHAR(160) NULL,
      actor_role VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_nps_treatment_logs_response_id (nps_response_id)
    )
  `);

  await pool.query(`
    UPDATE nps_responses
       SET nps_status = 'em_tratativa'
     WHERE converted_complaint_id IS NOT NULL
       AND (nps_status IS NULL OR nps_status = '' OR nps_status = 'registrado')
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clinic_id INT NULL,
      patient_name VARCHAR(160) NOT NULL,
      patient_phone VARCHAR(40) NULL,
      channel VARCHAR(80) NULL,
      complaint_type VARCHAR(160) NULL,
      description LONGTEXT NULL,
      service_type VARCHAR(160) NULL,
      attachment_url TEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'aberta',
      protocol VARCHAR(40) NULL,
      operator_comment TEXT NULL,
      priority VARCHAR(40) DEFAULT 'media',
      due_at DATETIME NULL,
      created_origin VARCHAR(80) DEFAULT 'Interno',
      financial_involved TINYINT(1) NOT NULL DEFAULT 0,
      financial_description TEXT NULL,
      financial_amount DECIMAL(12,2) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      closed_at TIMESTAMP NULL,
      INDEX idx_complaints_protocol (protocol),
      INDEX idx_complaints_created_at (created_at),
      INDEX idx_complaints_status (status),
      INDEX idx_complaints_clinic_id (clinic_id)
    )
  `);

  await ensureColumn('complaints', 'complaint_type', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'protocol', 'VARCHAR(40) NULL');
  await ensureColumn('complaints', 'operator_comment', 'TEXT NULL');
  await ensureColumn('complaints', 'priority', "VARCHAR(40) DEFAULT 'media'");
  await ensureColumn('complaints', 'due_at', 'DATETIME NULL');
  await ensureColumn('complaints', 'treatment_comment', 'TEXT NULL');
  await ensureColumn('complaints', 'treatment_by_role', 'VARCHAR(80) NULL');
  await ensureColumn('complaints', 'treatment_by_name', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'treatment_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'supervisor_approval_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'supervisor_approval_by', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'sac_approval_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'sac_approval_by', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'closed_by_role', 'VARCHAR(80) NULL');
  await ensureColumn('complaints', 'patient_contacted_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'patient_contacted_by', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'patient_contacted_by_role', 'VARCHAR(80) NULL');
  await ensureColumn('complaints', 'first_attendance_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'first_attendance_by', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'first_attendance_by_role', 'VARCHAR(80) NULL');
  await ensureColumn('complaints', 'deadline_locked_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'forwarded_to_role', 'VARCHAR(80) NULL');
  await ensureColumn('complaints', 'forwarded_to_label', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'forwarded_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'forwarded_by', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'assigned_coordinator_user_id', 'INT NULL');
  await ensureColumn('complaints', 'assigned_coordinator_name', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'clinic_snapshot_name', 'VARCHAR(180) NULL');
  await ensureColumn('complaints', 'created_origin', "VARCHAR(80) DEFAULT 'Interno'");
  await ensureColumn('complaints', 'financial_involved', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('complaints', 'financial_description', 'TEXT NULL');
  await ensureColumn('complaints', 'financial_amount', 'DECIMAL(12,2) NULL');
  await ensureColumn('complaints', 'resolution_due_at', 'DATETIME NULL');
  await ensureColumn('complaints', 'deleted_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'deleted_by', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'deletion_reason', 'TEXT NULL');
  await ensureColumn('complaints', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('complaints', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await ensureColumn('complaints', 'closed_at', 'TIMESTAMP NULL');
  await pool.query('ALTER TABLE complaints MODIFY COLUMN channel VARCHAR(160) NULL');
  await pool.query('ALTER TABLE complaints MODIFY COLUMN complaint_type VARCHAR(160) NULL');
  await pool.query('ALTER TABLE complaints MODIFY COLUMN service_type VARCHAR(160) NULL');
  await pool.query("ALTER TABLE complaints MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'aberta'");
  await pool.query("ALTER TABLE complaints MODIFY COLUMN priority VARCHAR(40) DEFAULT 'media'");
  await pool.query("ALTER TABLE complaints MODIFY COLUMN created_origin VARCHAR(80) DEFAULT 'Interno'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_job_runs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      job_key VARCHAR(120) NOT NULL UNIQUE,
      last_run_at TIMESTAMP NULL,
      last_payload LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_evidences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      complaint_id INT NOT NULL,
      file_url TEXT NOT NULL,
      original_name VARCHAR(255) NULL,
      description TEXT NULL,
      uploaded_by_name VARCHAR(160) NULL,
      uploaded_by_role VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_complaint_evidences_complaint_id (complaint_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      complaint_id INT NOT NULL,
      action VARCHAR(120) NOT NULL,
      message TEXT NULL,
      actor_name VARCHAR(160) NULL,
      actor_role VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_complaint_logs_complaint_id (complaint_id)
    )
  `);

  await pool.query(
    "UPDATE clinics SET state = 'GO', region = 'Centro-Oeste' WHERE LOWER(city) = 'trindade' OR LOWER(name) LIKE '%trindade%'"
  );
}

async function ensureDefaultClinics() {
  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM clinics');
  const total = Number(rows[0]?.total || 0);

  if (total > 0) {
    return;
  }

  await pool.query(
    `INSERT INTO clinics (name, city, state, region, coordinator_name, active)
     VALUES
     (?, ?, ?, ?, ?, 1),
     (?, ?, ?, ?, ?, 1),
     (?, ?, ?, ?, ?, 1)`,
    [
      'Clínica Centro', 'Goiânia', 'GO', 'Centro-Oeste', 'Coordenação Centro',
      'Clínica Trindade', 'Trindade', 'GO', 'Centro-Oeste', 'Coordenação Trindade',
      'Clínica Aparecida', 'Aparecida de Goiânia', 'GO', 'Centro-Oeste', 'Coordenação Aparecida'
    ]
  );

  console.log('Clínicas padrão inseridas com sucesso.');
}

async function ensureDefaultAdminUser() {
  const passwordHash = await bcrypt.hash(defaultAdminPassword, 10);

  await pool.query(
    `INSERT INTO users
     (name, email, password, role, position, phone, whatsapp, department, permissions, active)
     VALUES (?, ?, ?, 'master_admin', 'Administrador Master', '+5562999999999', '+5562999999999', 'Administração', ?, 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       password = VALUES(password),
       role = 'master_admin',
       position = VALUES(position),
       permissions = VALUES(permissions),
       active = 1`,
    [
      'Henrique Martins',
      masterAdminEmail,
      passwordHash,
      JSON.stringify(Object.keys(screenPermissions))
    ]
  );

  await pool.query(
    'UPDATE users SET must_change_password = 0 WHERE LOWER(email) = ?',
    [masterAdminEmail]
  );

  await pool.query(
    "UPDATE users SET role = 'admin', position = COALESCE(NULLIF(position, 'Administrador master'), 'Administrador') WHERE role = 'master_admin' AND LOWER(email) <> ?",
    [masterAdminEmail]
  );
}

async function backfillComplaintProtocols() {
  const [rows] = await pool.query('SELECT id, created_at FROM complaints WHERE protocol IS NULL OR protocol = ""');

  await Promise.all(rows.map((row) => {
    const year = row.created_at ? new Date(row.created_at).getFullYear() : new Date().getFullYear();
    const protocol = `GRC-${year}-${String(row.id).padStart(6, '0')}`;

    return pool.query('UPDATE complaints SET protocol = ? WHERE id = ?', [protocol, row.id]);
  }));
}

async function backfillNpsProtocols() {
  const [rows] = await pool.query('SELECT id, created_at FROM nps_responses WHERE nps_protocol IS NULL OR nps_protocol = ""');

  await Promise.all(rows.map((row) => (
    pool.query('UPDATE nps_responses SET nps_protocol = ? WHERE id = ?', [
      formatNpsProtocol(row.id, row.created_at),
      row.id
    ])
  )));
}

async function backfillPatientProtocols() {
  const [rows] = await pool.query('SELECT id, created_at FROM patient_interactions WHERE protocol IS NULL OR protocol = ""');

  await Promise.all(rows.map((row) => (
    pool.query('UPDATE patient_interactions SET protocol = ? WHERE id = ?', [
      formatPatientProtocol(row.id, row.created_at),
      row.id
    ])
  )));
}

async function backfillComplaintDeadlines() {
  const [rows] = await pool.query('SELECT id, created_at, priority FROM complaints');

  await Promise.all(rows.map((row) => {
    const createdAt = row.created_at ? new Date(row.created_at) : new Date();
    const dueAt = new Date(createdAt);
    dueAt.setHours(dueAt.getHours() + deadlineHoursByPriority[normalizePriority(row.priority)]);
    const resolutionDueAt = calculateResolutionDueAt(createdAt);

    return pool.query('UPDATE complaints SET priority = ?, due_at = ?, resolution_due_at = ? WHERE id = ?', [
      normalizePriority(row.priority),
      toMysqlDateTime(dueAt),
      toMysqlDateTime(resolutionDueAt),
      row.id
    ]);
  }));
}

async function backfillComplaintAssignments() {
  const [rows] = await pool.query(
    `SELECT id, clinic_id, assigned_coordinator_name, clinic_snapshot_name
       FROM complaints`
  );

  await Promise.all(rows.map(async (row) => {
    if (row.assigned_coordinator_name && row.clinic_snapshot_name) {
      return null;
    }

    const assignment = await resolveCoordinatorAssignment(row.clinic_id);

    return pool.query(
      `UPDATE complaints
          SET assigned_coordinator_user_id = COALESCE(assigned_coordinator_user_id, ?),
              assigned_coordinator_name = COALESCE(assigned_coordinator_name, ?),
              clinic_snapshot_name = COALESCE(clinic_snapshot_name, ?)
        WHERE id = ?`,
      [
        assignment.coordinatorUserId,
        assignment.coordinatorName || null,
        assignment.clinicSnapshotName || null,
        row.id
      ]
    );
  }));
}

function buildComplaintFilters(query) {
  const where = [];
  const params = [];

  if (query.id) {
    where.push('c.id = ?');
    params.push(query.id);
  }

  if (query.status) {
    where.push('c.status = ?');
    params.push(query.status);
  }

  if (query.channel) {
    where.push('c.channel = ?');
    params.push(query.channel);
  }

  if (query.clinic_id) {
    where.push('c.clinic_id = ?');
    params.push(query.clinic_id);
  }

  if (query.complaint_type) {
    where.push('c.complaint_type = ?');
    params.push(query.complaint_type);
  }

  if (query.search) {
    where.push(`(
      c.protocol LIKE ? OR
      c.patient_name LIKE ? OR
      c.patient_phone LIKE ? OR
      c.description LIKE ? OR
      cl.name LIKE ? OR
      cl.city LIKE ? OR
      cl.state LIKE ? OR
      cl.region LIKE ?
    )`);
    const search = `%${query.search}%`;
    params.push(search, search, search, search, search, search, search, search);
  }

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

async function getComplaintRows(query = {}, user = null) {
  const filters = buildComplaintFilters(query);

  if (!query.include_deleted) {
    filters.clause += filters.clause ? ' AND c.deleted_at IS NULL' : 'WHERE c.deleted_at IS NULL';
  }

  if (user && !isAdminUser(user)) {
    const clinicIds = await getUserClinicIds(user.id);

    if (clinicIds.length) {
      filters.clause += filters.clause ? ' AND (c.clinic_id IN (?) OR c.assigned_coordinator_user_id = ?)' : 'WHERE (c.clinic_id IN (?) OR c.assigned_coordinator_user_id = ?)';
      filters.params.push(clinicIds, user.id);
    } else {
      filters.clause += filters.clause ? ' AND c.assigned_coordinator_user_id = ?' : 'WHERE c.assigned_coordinator_user_id = ?';
      filters.params.push(user.id);
    }
  }

  const [rows] = await pool.query(
    `SELECT
      c.id,
      c.protocol,
      c.clinic_id,
      c.patient_name,
      c.patient_phone,
      c.channel,
      c.complaint_type,
      c.description,
      c.service_type,
      c.attachment_url,
      c.status,
      c.operator_comment,
      c.priority,
      c.due_at,
      c.resolution_due_at,
      c.treatment_comment,
      c.treatment_by_role,
      c.treatment_by_name,
      c.treatment_at,
      c.supervisor_approval_at,
      c.supervisor_approval_by,
      c.sac_approval_at,
      c.sac_approval_by,
      c.closed_by_role,
      c.patient_contacted_at,
      c.patient_contacted_by,
      c.patient_contacted_by_role,
      c.first_attendance_at,
      c.first_attendance_by,
      c.first_attendance_by_role,
      c.deadline_locked_at,
      c.forwarded_to_role,
      c.forwarded_to_label,
      c.forwarded_at,
      c.forwarded_by,
      c.assigned_coordinator_user_id,
      c.assigned_coordinator_name,
      c.clinic_snapshot_name,
      c.created_origin,
      c.financial_involved,
      c.financial_description,
      c.financial_amount,
      c.deleted_at,
      c.deleted_by,
      c.deletion_reason,
      c.created_at,
      c.updated_at,
      c.closed_at,
      COALESCE(c.clinic_snapshot_name, cl.name) AS clinic_name,
      cl.city,
      cl.state,
      cl.region,
      COALESCE(c.assigned_coordinator_name, cl.coordinator_name) AS coordinator_name
    FROM complaints c
    LEFT JOIN clinics cl ON cl.id = c.clinic_id
    ${filters.clause}
    ORDER BY c.created_at DESC, c.id DESC`,
    filters.params
  );

  if (rows.length) {
    const complaintIds = rows.map((row) => row.id);
    const [evidences] = await pool.query(
      `SELECT
        id,
        complaint_id,
        file_url,
        original_name,
        description,
        uploaded_by_name,
        uploaded_by_role,
        created_at
       FROM complaint_evidences
       WHERE complaint_id IN (?)
       ORDER BY created_at DESC, id DESC`,
      [complaintIds]
    );
    const evidencesByComplaint = evidences.reduce((acc, evidence) => {
      acc[evidence.complaint_id] = acc[evidence.complaint_id] || [];
      acc[evidence.complaint_id].push(evidence);
      return acc;
    }, {});
    const [logs] = await pool.query(
      `SELECT
        id,
        complaint_id,
        action,
        message,
        actor_name,
        actor_role,
        created_at
       FROM complaint_logs
       WHERE complaint_id IN (?)
       ORDER BY created_at DESC, id DESC`,
      [complaintIds]
    );
    const logsByComplaint = logs.reduce((acc, log) => {
      acc[log.complaint_id] = acc[log.complaint_id] || [];
      acc[log.complaint_id].push(log);
      return acc;
    }, {});

    return rows.map((row) => ({
      ...row,
      evidences: evidencesByComplaint[row.id] || [],
      logs: logsByComplaint[row.id] || []
    }));
  }

  return rows;
}

function groupRows(rows, field) {
  return rows.reduce((acc, row) => {
    const label = row[field] || 'Não informado';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

function toCsv(rows) {
  const headers = [
    'id',
    'protocol',
    'clinic_name',
    'city',
    'state',
    'region',
    'patient_name',
    'patient_phone',
    'channel',
    'complaint_type',
    'service_type',
    'status',
    'priority',
    'due_at',
    'resolution_due_at',
    'operator_comment',
    'treatment_by_role',
    'treatment_by_name',
    'treatment_at',
    'supervisor_approval_at',
    'supervisor_approval_by',
    'sac_approval_at',
    'sac_approval_by',
    'patient_contacted_at',
    'patient_contacted_by',
    'patient_contacted_by_role',
    'first_attendance_at',
    'first_attendance_by',
    'first_attendance_by_role',
    'deadline_locked_at',
    'forwarded_to_role',
    'forwarded_to_label',
    'forwarded_at',
    'forwarded_by',
    'created_origin',
    'financial_involved',
    'financial_description',
    'financial_amount',
    'created_at',
    'updated_at',
    'closed_at'
  ];

  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))
  ];

  return lines.join('\n');
}

function escapePdfText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildSimplePdfBuffer(title, lines) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginLeft = 36;
  const startY = 800;
  const lineHeight = 16;
  const contentLines = [title, '', ...lines].slice(0, 42);
  const content = contentLines.map((line, index) => {
    const y = startY - (index * lineHeight);
    return `BT /F1 11 Tf 1 0 0 1 ${marginLeft} ${y} Tm (${escapePdfText(line)}) Tj ET`;
  }).join('\n');
  const stream = `${content}\n`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`,
    `4 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}endstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${object}\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function toMonthRange(monthRef) {
  const base = monthRef && /^\d{4}-\d{2}$/.test(String(monthRef))
    ? new Date(`${monthRef}-01T00:00:00`)
    : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function slugify(value) {
  return String(value || 'sem-coordenador')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sem-coordenador';
}

function createEmailTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendEmail(to, subject, html, attachments = []) {
  const transporter = createEmailTransporter();

  if (!transporter) {
    console.log(`[email pendente] Para: ${to} | Assunto: ${subject}`);
    console.log(html);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    attachments
  });
}

async function sendWhatsappNotification(payload) {
  const message = payload?.message || '';

  if (!whatsappWebhookUrl) {
    console.log(`[whatsapp pendente] ${message}`);
    return;
  }

  try {
    await axios.post(whatsappWebhookUrl, {
      groupId: whatsappGroupId || undefined,
      ...payload
    }, {
      timeout: 8000
    });
  } catch (error) {
    console.warn('Não foi possível enviar notificação por WhatsApp:', error.message);
  }
}

async function createNotification(userId, type, title, message, link = null, payload = null) {
  await pool.query(
    `INSERT INTO notification_events
     (user_id, type, title, message, link, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId || null,
      type,
      title,
      message || null,
      link || null,
      payload ? JSON.stringify(payload) : null
    ]
  );
}

async function createNotificationForAdmins(type, title, message, link = null, payload = null) {
  const [admins] = await pool.query(
    "SELECT id FROM users WHERE active = 1 AND (role IN ('admin', 'master_admin') OR LOWER(email) IN (?, ?))",
    [masterAdminEmail, defaultAdminEmail]
  );

  await Promise.all(admins.map((admin) => createNotification(admin.id, type, title, message, link, payload)));
}

async function createNotificationForRoles(roles, type, title, message, link = null, payload = null) {
  const normalizedRoles = Array.from(new Set((roles || []).filter(Boolean)));

  if (!normalizedRoles.length) return [];

  const placeholders = normalizedRoles.map(() => '?').join(',');
  const [users] = await pool.query(
    `SELECT id
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND role IN (${placeholders})`,
    normalizedRoles
  );

  await Promise.all(users.map((user) => createNotification(user.id, type, title, message, link, payload)));
  return users.map((user) => user.id);
}

async function notifyClinicResponsibles(clinicId, type, title, message, link, payload = null) {
  if (!clinicId) return [];

  const [clinicRows] = await pool.query('SELECT coordinator_name FROM clinics WHERE id = ?', [clinicId]);
  const coordinatorName = String(clinicRows[0]?.coordinator_name || '').trim();
  const [users] = await pool.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.whatsapp
      FROM users u
       LEFT JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?
      WHERE u.active = 1
        AND u.deleted_at IS NULL
        AND uc.user_id IS NOT NULL`,
    [clinicId]
  );
  const filteredUsers = users.filter((user) => (
    user.id
    && (
      user.email
      || user.whatsapp
    )
  ));

  if (coordinatorName) {
    const [coordinatorUsers] = await pool.query(
      `SELECT DISTINCT id, name, email, whatsapp
         FROM users
        WHERE active = 1
          AND deleted_at IS NULL
          AND (LOWER(name) = LOWER(?) OR LOWER(email) = LOWER(?))`,
      [coordinatorName, coordinatorName]
    );

    coordinatorUsers.forEach((coordinator) => {
      if (!filteredUsers.some((user) => user.id === coordinator.id)) {
        filteredUsers.push(coordinator);
      }
    });
  }

  await Promise.all(filteredUsers.map(async (user) => {
    try {
      await createNotification(user.id, type, title, message, link, payload);
    } catch (error) {
      console.warn('Nao foi possivel criar notificacao para responsavel da unidade:', error.message);
    }

    if (user.email) {
      try {
        await sendEmail(
          user.email,
          title,
          `<p>${message.replace(/\n/g, '<br />')}</p><p><a href="${link}">Abrir no sistema</a></p>`
        );
      } catch (error) {
        console.warn('Nao foi possivel enviar e-mail para responsavel da unidade:', error.message);
      }
    }

    if (user.whatsapp) {
      try {
        await sendWhatsappNotification({
          event: type,
          to: user.whatsapp,
          userId: user.id,
          link,
          message: `${message}\n${link}`
        });
      } catch (error) {
        console.warn('Nao foi possivel enviar WhatsApp para responsavel da unidade:', error.message);
      }
    }
  }));

  return filteredUsers.map((user) => user.id).filter(Boolean);
}

async function notifyOperationalComplaintTeam(title, message, link, payload = null, excludedUserIds = []) {
  const excluded = new Set((excludedUserIds || []).map((id) => Number(id)));
  const [users] = await pool.query(
    `SELECT DISTINCT id, name, email, whatsapp, role
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND role IN ('sac_operator', 'supervisor_crc')`
  );
  const recipients = users.filter((user) => user.id && !excluded.has(Number(user.id)));

  await Promise.all(recipients.map(async (user) => {
    try {
      await createNotification(user.id, 'complaint_operational_alert', title, message, link, payload);
    } catch (error) {
      console.warn('Nao foi possivel criar notificacao operacional da reclamacao:', error.message);
    }

    if (user.email) {
      try {
        await sendEmail(
          user.email,
          title,
          `<p>${message.replace(/\n/g, '<br />')}</p><p><a href="${link}">Abrir no sistema</a></p>`
        );
      } catch (error) {
        console.warn('Nao foi possivel enviar e-mail operacional da reclamacao:', error.message);
      }
    }

    if (user.whatsapp) {
      try {
        await sendWhatsappNotification({
          event: 'complaint_operational_alert',
          to: user.whatsapp,
          userId: user.id,
          role: user.role,
          link,
          message: `${message}\n${link}`
        });
      } catch (error) {
        console.warn('Nao foi possivel enviar WhatsApp operacional da reclamacao:', error.message);
      }
    }
  }));
}

async function getUserClinicIds(userId) {
  if (!userId) return [];

  const [rows] = await pool.query(
    'SELECT clinic_id FROM user_clinics WHERE user_id = ?',
    [userId]
  );

  return rows
    .map((row) => Number(row.clinic_id))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function resolveCoordinatorAssignment(clinicId) {
  if (!clinicId) {
    return {
      coordinatorUserId: null,
      coordinatorName: 'Coordenador da unidade',
      clinicSnapshotName: null
    };
  }

  const [clinicRows] = await pool.query(
    'SELECT id, name, coordinator_name FROM clinics WHERE id = ? LIMIT 1',
    [clinicId]
  );
  const clinic = clinicRows[0] || {};
  const configuredCoordinatorName = String(clinic.coordinator_name || '').trim();

  const [coordinatorRows] = await pool.query(
    `SELECT
       u.id,
       u.name
     FROM users u
     INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?
     WHERE u.deleted_at IS NULL
       AND u.active = 1
       AND u.role = 'coordinator'
     ORDER BY CASE
       WHEN ? <> '' AND LOWER(TRIM(u.name)) = LOWER(TRIM(?)) THEN 0
       ELSE 1
     END,
     u.name ASC
     LIMIT 1`,
    [clinicId, configuredCoordinatorName, configuredCoordinatorName]
  );

  const coordinator = coordinatorRows[0] || null;

  return {
    coordinatorUserId: coordinator?.id || null,
    coordinatorName: coordinator?.name || configuredCoordinatorName || 'Coordenador da unidade',
    clinicSnapshotName: clinic?.name || null
  };
}

async function getClinicsForUser(user) {
  if (!user) return [];

  if (isAdminUser(user)) {
    const [rows] = await pool.query(
      `SELECT
         id,
         name,
         city,
         state,
         region,
         coordinator_name,
         active,
         created_at,
         updated_at
       FROM clinics
       WHERE active = 1
       ORDER BY name ASC`
    );

    return rows;
  }

  const clinicIds = await getUserClinicIds(user.id);

  if (!clinicIds.length) {
    return [];
  }

  const placeholders = clinicIds.map(() => '?').join(',');

  const [rows] = await pool.query(
    `SELECT
       id,
       name,
       city,
       state,
       region,
       coordinator_name,
       active,
       created_at,
       updated_at
     FROM clinics
     WHERE active = 1
       AND id IN (${placeholders})
     ORDER BY name ASC`,
    clinicIds
  );

  return rows;
}

async function getMonthlyDuplicateNpsPhones(monthRef) {
  const { start, end } = toMonthRange(monthRef);
  const [rows] = await pool.query(
    `SELECT
       n.patient_phone,
       COUNT(*) AS total,
       GROUP_CONCAT(DISTINCT n.patient_name ORDER BY n.patient_name SEPARATOR ' | ') AS patient_names,
       GROUP_CONCAT(DISTINCT COALESCE(n.nps_protocol, CONCAT('NPS-', n.id)) ORDER BY n.created_at DESC SEPARATOR ' | ') AS protocols,
       MAX(n.created_at) AS last_created_at
     FROM nps_responses n
     WHERE n.patient_phone IS NOT NULL
       AND n.patient_phone <> ''
       AND n.created_at BETWEEN ? AND ?
     GROUP BY n.patient_phone
     HAVING COUNT(*) > 1
     ORDER BY total DESC, last_created_at DESC`,
    [toMysqlDateTime(start), toMysqlDateTime(end)]
  );

  return rows.map((row) => ({
    phone: row.patient_phone,
    total: Number(row.total || 0),
    patient_names: row.patient_names || '',
    protocols: row.protocols || '',
    last_created_at: row.last_created_at
  }));
}

async function alertDuplicateNpsPhone(phone, protocol, npsId) {
  const monthRef = new Date().toISOString().slice(0, 7);
  const title = `Alerta NPS: telefone repetido ${phone}`;
  const message = `O telefone ${phone} apareceu mais de uma vez nas pesquisas NPS deste mês. Último protocolo: ${protocol}.`;
  const payload = { phone, protocol, npsId, month: monthRef };
  await createNotificationForRoles(
    ['supervisor_crc', 'admin', 'master_admin'],
    'nps_duplicate_phone',
    title,
    message,
    '/gestao-nps',
    payload
  );
}

async function createPromoterAgendaRecord({ npsId, patientName, patientPhone, clinicName }) {
  const scheduledAt = new Date();
  const note = 'Contato compartilhado pelo paciente promotor na pesquisa de satisfação.';
  const [result] = await pool.query(
    `INSERT INTO patient_interactions
     (patient_name, patient_phone, channel, clinic_name, interaction_type, scheduled_at, note, status, created_by_name, created_by_role)
     VALUES (?, ?, 'NPS', ?, 'agendamento', ?, ?, 'Registrado', 'Pesquisa NPS', 'externo')`,
    [
      patientName || 'Paciente promotor',
      patientPhone,
      clinicName || 'Unidade não informada',
      toMysqlDateTime(scheduledAt),
      note
    ]
  );
  const protocol = formatPatientProtocol(result.insertId, scheduledAt);
  await pool.query('UPDATE patient_interactions SET protocol = ? WHERE id = ?', [protocol, result.insertId]);
  await insertPatientInteractionLog(result.insertId, 'Registro criado', `${note} Protocolo ${protocol}.`, {
    name: 'Pesquisa NPS',
    role: 'externo'
  });
  await pool.query('UPDATE nps_responses SET linked_patient_interaction_id = ? WHERE id = ?', [result.insertId, npsId]);
  return { id: result.insertId, protocol };
}

async function getCoordinatorComplaintRows({ onlyOverdue = false } = {}) {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.protocol,
       c.patient_name,
       c.status,
       c.priority,
       c.created_at,
       c.resolution_due_at,
        COALESCE(c.clinic_snapshot_name, cl.name) AS clinic_name,
        COALESCE(c.assigned_coordinator_name, cl.coordinator_name) AS coordinator_name
      FROM complaints c
      LEFT JOIN clinics cl ON cl.id = c.clinic_id
      WHERE c.deleted_at IS NULL
        AND c.status <> 'resolvida'
        ${onlyOverdue ? 'AND c.resolution_due_at IS NOT NULL AND c.resolution_due_at < NOW()' : ''}
      ORDER BY COALESCE(c.assigned_coordinator_name, cl.coordinator_name, 'Sem coordenador') ASC, c.resolution_due_at ASC, c.created_at ASC`
  );

  return rows.map((row) => ({
    ...row,
    coordinator_name: row.coordinator_name || 'Sem coordenador',
    delayed: Boolean(row.resolution_due_at && new Date(row.resolution_due_at).getTime() < Date.now())
  }));
}

async function writeCoordinatorReportPdf(coordinatorName, rows, referenceDate = new Date()) {
  const title = `Relatorio semanal - ${coordinatorName}`;
  const lines = [
    `Gerado em: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(referenceDate)}`,
    `SLA de resolucao: ${resolutionSlaDays} dias`,
    `Total de protocolos abertos: ${rows.length}`,
    ''
  ];

  rows.forEach((row) => {
    lines.push(
      `${row.delayed ? '[ATRASADA]' : '[NO PRAZO]'} ${row.protocol || `GRC-${row.id}`} | ${row.clinic_name || 'Unidade'} | ${row.patient_name || 'Paciente'} | SLA ${row.resolution_due_at ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.resolution_due_at)) : 'Nao informado'}`
    );
  });

  const fileName = `coordenador-${slugify(coordinatorName)}-${referenceDate.toISOString().slice(0, 10)}.pdf`;
  const filePath = path.join(reportsDir, fileName);
  fs.writeFileSync(filePath, buildSimplePdfBuffer(title, lines));
  return {
    fileName,
    filePath,
    url: `${publicBaseUrl}/uploads/reports/${fileName}`
  };
}

async function dispatchCoordinatorDelayNotifications() {
  const rows = await getCoordinatorComplaintRows({ onlyOverdue: true });
  const grouped = rows.reduce((acc, row) => {
    acc[row.coordinator_name] = acc[row.coordinator_name] || [];
    acc[row.coordinator_name].push(row);
    return acc;
  }, {});
  const coordinators = Object.keys(grouped);

  await Promise.all(coordinators.map(async (coordinatorName) => {
    const coordinatorRows = grouped[coordinatorName];
    const message = [
      `Atenção: demandas em atraso do coordenador ${coordinatorName}.`,
      ...coordinatorRows.slice(0, 10).map((row) => `- ${row.protocol || `GRC-${row.id}`} | ${row.clinic_name || 'Unidade'} | SLA ${row.resolution_due_at ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.resolution_due_at)) : 'Nao informado'}`)
    ].join('\n');

    await sendWhatsappNotification({
      event: 'coordinator_delay_alert',
      coordinator: coordinatorName,
      link: `${frontendUrl}/gestao`,
      message
    });
  }));

  return coordinators.length;
}

async function dispatchWeeklyCoordinatorReports() {
  const rows = await getCoordinatorComplaintRows();
  const grouped = rows.reduce((acc, row) => {
    acc[row.coordinator_name] = acc[row.coordinator_name] || [];
    acc[row.coordinator_name].push(row);
    return acc;
  }, {});
  const coordinators = Object.keys(grouped);
  const reports = [];

  for (const coordinatorName of coordinators) {
    const coordinatorRows = grouped[coordinatorName];
    const report = await writeCoordinatorReportPdf(coordinatorName, coordinatorRows, new Date());
    reports.push({ coordinatorName, ...report, total: coordinatorRows.length, delayed: coordinatorRows.filter((row) => row.delayed).length });

    await sendWhatsappNotification({
      event: 'weekly_coordinator_report',
      coordinator: coordinatorName,
      attachmentUrl: report.url,
      link: report.url,
      message: `Relatório semanal do coordenador ${coordinatorName}. Total de protocolos: ${coordinatorRows.length}. Atrasadas: ${coordinatorRows.filter((row) => row.delayed).length}.`
    });

    await sendEmail(
      approvalEmail,
      `Relatório semanal - ${coordinatorName}`,
      `<p>Segue o relatório semanal do coordenador <strong>${coordinatorName}</strong>.</p><p>Total de protocolos: ${coordinatorRows.length}</p><p>Atrasadas: ${coordinatorRows.filter((row) => row.delayed).length}</p>`,
      [{ filename: report.fileName, path: report.filePath }]
    );
  }

  return reports;
}

async function recordJobRun(jobKey, payload = null) {
  await pool.query(
    `INSERT INTO system_job_runs (job_key, last_run_at, last_payload)
     VALUES (?, NOW(), ?)
     ON DUPLICATE KEY UPDATE last_run_at = NOW(), last_payload = VALUES(last_payload)`,
    [jobKey, payload ? JSON.stringify(payload) : null]
  );
}

async function shouldRunWeeklyCoordinatorReports(jobKey, now = new Date()) {
  if (now.getDay() !== 1 || now.getHours() < 8) return false;

  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));

  const [rows] = await pool.query('SELECT last_run_at FROM system_job_runs WHERE job_key = ?', [jobKey]);

  if (!rows.length || !rows[0].last_run_at) return true;

  return new Date(rows[0].last_run_at).getTime() < weekStart.getTime();
}

async function runScheduledCoordinatorReports() {
  const jobKey = 'weekly_coordinator_report';

  if (!(await shouldRunWeeklyCoordinatorReports(jobKey))) {
    return;
  }

  const reports = await dispatchWeeklyCoordinatorReports();
  if (reports.length) {
    await dispatchCoordinatorDelayNotifications();
  }
  await recordJobRun(jobKey, { reports: reports.length });
}

async function notifyComplaintCreated(complaintId, protocol) {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.protocol,
       c.clinic_id,
       c.patient_name,
       c.complaint_type,
       c.priority,
       c.created_origin,
       cl.name AS clinic_name,
       cl.city,
       cl.state
     FROM complaints c
     LEFT JOIN clinics cl ON cl.id = c.clinic_id
     WHERE c.id = ?`,
    [complaintId]
  );
  const complaint = rows[0] || {};
  const clinic = complaint.clinic_name
    ? `${complaint.clinic_name}${complaint.city ? ` - ${complaint.city}/${complaint.state || 'UF'}` : ''}`
    : 'Unidade não informada';
  const title = `Novo protocolo ${protocol || complaint.protocol || complaintId}`;
  const link = `${frontendUrl}/gestao/${complaintId}`;
  const message = [
    title,
    `Paciente: ${complaint.patient_name || 'Não informado'}`,
    `Unidade: ${clinic}`,
    `Tipo: ${complaint.complaint_type || 'Não informado'}`,
    `Prioridade: ${complaint.priority || 'Não informada'}`,
    `Origem: ${complaint.created_origin || 'Interno'}`
  ].join('\n');
  const payload = { complaintId, protocol: protocol || complaint.protocol || complaintId };
  const detailedMessage = `${message}\n\nAcesse o protocolo para dar ciência e iniciar a tratativa.`;
  const operationalMessage = `${message}\n\nSupervisor do CRC e Operador de SAC devem acompanhar o protocolo ate a conclusao.`;

  try {
    await sendWhatsappNotification({
      event: 'complaint_created',
      protocol: protocol || complaint.protocol || complaintId,
      complaintId,
      message
    });
  } catch (error) {
    console.warn('Nao foi possivel enviar notificacao geral da reclamacao:', error.message);
  }

  let notifiedUserIds = [];

  try {
    notifiedUserIds = await notifyClinicResponsibles(
      complaint.clinic_id,
      'complaint_assigned',
      title,
      detailedMessage,
      link,
      payload
    );
  } catch (error) {
    console.warn('Nao foi possivel notificar responsaveis da unidade:', error.message);
  }

  try {
    await notifyOperationalComplaintTeam(
      title,
      operationalMessage,
      link,
      payload,
      notifiedUserIds
    );
  } catch (error) {
    console.warn('Nao foi possivel notificar Supervisor CRC e Operador SAC:', error.message);
  }
}

function buildNpsComplaintDescription(nps) {
  const notes = [
    `Reclassificação de cliente detrator da pesquisa de satisfação. Nota NPS: ${nps.score}.`
  ];

  if (nps.detractor_feedback) {
    notes.push(`Relato do cliente: ${nps.detractor_feedback}`);
  }

  if (nps.detractor_reasons) {
    try {
      const reasons = JSON.parse(nps.detractor_reasons);
      if (Array.isArray(reasons) && reasons.length) {
        notes.push(`Motivos sinalizados: ${reasons.join(', ')}.`);
      }
    } catch (error) {
      notes.push(`Motivos sinalizados: ${nps.detractor_reasons}`);
    }
  }

  if (nps.comment) {
    notes.push(`Observação adicional: ${nps.comment}`);
  }

  return notes.join('\n\n');
}

async function getNpsRows(query = {}, user = null) {
  const where = [];
  const params = [];

  if (query.id) {
    where.push('n.id = ?');
    params.push(query.id);
  }

  if (!query.include_deleted) {
    where.push('n.deleted_at IS NULL');
  }

  if (query.profile) {
    where.push('COALESCE(n.nps_profile, CASE WHEN n.score >= 9 THEN "promotor" WHEN n.score >= 7 THEN "neutro" ELSE "detrator" END) = ?');
    params.push(query.profile);
  }

  if (query.clinic_id) {
    where.push('n.clinic_id = ?');
    params.push(query.clinic_id);
  }

  if (user && !isAdminUser(user)) {
    const clinicIds = await getUserClinicIds(user.id);

    if (clinicIds.length) {
      where.push('n.clinic_id IN (?)');
      params.push(clinicIds);
    } else {
      where.push('1 = 0');
    }
  }

  if (query.status) {
    where.push('n.nps_status = ?');
    params.push(normalizeNpsStatus(query.status));
  }

  if (query.search) {
    where.push(`(
      n.nps_protocol LIKE ? OR
      n.patient_name LIKE ? OR
      n.patient_phone LIKE ? OR
      n.comment LIKE ? OR
      n.improvement_comment LIKE ? OR
      n.detractor_feedback LIKE ? OR
      n.nps_treatment_comment LIKE ? OR
      cl.name LIKE ? OR
      cl.city LIKE ? OR
      cl.state LIKE ? OR
      cl.region LIKE ?
    )`);
    const search = `%${query.search}%`;
    params.push(search, search, search, search, search, search, search, search, search, search, search);
  }

  const [rows] = await pool.query(
    `SELECT
      n.id,
      n.nps_protocol,
      n.clinic_id,
      n.patient_name,
      n.patient_phone,
      n.score,
      n.comment,
      n.feedback_type,
      COALESCE(n.nps_profile, CASE WHEN n.score >= 9 THEN 'promotor' WHEN n.score >= 7 THEN 'neutro' ELSE 'detrator' END) AS nps_profile,
      n.recommend_yes,
      n.referral_name,
      n.referral_phone,
      n.improvement_comment,
      n.detractor_reasons,
      n.detractor_feedback,
      n.source,
      n.nps_status,
      n.nps_treatment_comment,
      n.nps_treatment_at,
      n.nps_treatment_by,
      n.nps_treatment_by_role,
      n.deleted_at,
      n.deleted_by,
      n.deletion_reason,
      n.converted_complaint_id,
      n.converted_at,
      n.converted_by,
      n.created_at,
      cl.name AS clinic_name,
      cl.city,
      cl.state,
      cl.region,
      cl.coordinator_name,
      c.protocol AS converted_protocol,
      c.status AS converted_status
    FROM nps_responses n
    LEFT JOIN clinics cl ON cl.id = n.clinic_id
    LEFT JOIN complaints c ON c.id = n.converted_complaint_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY n.created_at DESC, n.id DESC`,
    params
  );

  if (!rows.length) {
    return rows;
  }

  const npsIds = rows.map((row) => row.id);
  const [logs] = await pool.query(
    `SELECT
      id,
      nps_response_id,
      action,
      message,
      actor_name,
      actor_role,
      created_at
     FROM nps_treatment_logs
     WHERE nps_response_id IN (?)
     ORDER BY created_at DESC, id DESC`,
    [npsIds]
  );
  const logsByNps = logs.reduce((acc, log) => {
    acc[log.nps_response_id] = acc[log.nps_response_id] || [];
    acc[log.nps_response_id].push(log);
    return acc;
  }, {});

  return rows.map((row) => ({
    ...row,
    nps_protocol: row.nps_protocol || formatNpsProtocol(row.id, row.created_at),
    nps_status: normalizeNpsStatus(row.nps_status),
    logs: logsByNps[row.id] || []
  }));
}

async function convertNpsToComplaint(npsId, user) {
  const [rows] = await pool.query('SELECT * FROM nps_responses WHERE id = ?', [npsId]);

  if (!rows.length) {
    const error = new Error('Pesquisa NPS não encontrada.');
    error.statusCode = 404;
    throw error;
  }

  const nps = rows[0];
  const profile = nps.nps_profile || inferNpsProfile(nps.score);

  if (profile !== 'detrator') {
    const error = new Error('Apenas clientes detratores podem ser reclassificados como reclamação.');
    error.statusCode = 409;
    throw error;
  }

  if (nps.converted_complaint_id) {
    return {
      complaintId: nps.converted_complaint_id,
      alreadyConverted: true
    };
  }

  const priority = priorityForNpsFeedback(nps.score, 'Reclamação');
  const dueAt = calculateDueAt(priority);
  const resolutionDueAt = calculateResolutionDueAt();
  const description = buildNpsComplaintDescription(nps);
  const assignment = await resolveCoordinatorAssignment(nps.clinic_id || null);
  const [result] = await pool.query(
    `INSERT INTO complaints
     (clinic_id, patient_name, patient_phone, channel, complaint_type, description, service_type, status, priority, due_at, resolution_due_at, created_origin)
     VALUES (?, ?, ?, 'NPS', 'Reclamação NPS', ?, 'Pesquisa de satisfação', 'aberta', ?, ?, ?, 'Externo')`,
    [
      nps.clinic_id || null,
      nps.patient_name || 'Paciente NPS',
      nps.patient_phone || null,
      description,
      priority,
      toMysqlDateTime(dueAt),
      toMysqlDateTime(resolutionDueAt)
    ]
  );
  const protocol = `GRC-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
  await pool.query('UPDATE complaints SET protocol = ? WHERE id = ?', [protocol, result.insertId]);
  await pool.query(
    'UPDATE complaints SET assigned_coordinator_user_id = ?, assigned_coordinator_name = ?, clinic_snapshot_name = ? WHERE id = ?',
    [assignment.coordinatorUserId, assignment.coordinatorName, assignment.clinicSnapshotName, result.insertId]
  );
  const coordinatorLabel = assignment.coordinatorName || 'Coordenador da unidade';
  await pool.query(
    `UPDATE complaints
        SET forwarded_to_role = 'coordinator',
            forwarded_to_label = ?,
            forwarded_at = NOW(),
            forwarded_by = ?
      WHERE id = ?`,
    [coordinatorLabel, getActorName(user), result.insertId]
  );
  await pool.query(
    'UPDATE nps_responses SET converted_complaint_id = ?, converted_at = NOW(), converted_by = ? WHERE id = ?',
    [result.insertId, getActorName(user), npsId]
  );
  await insertComplaintLog(result.insertId, 'nps_reclassified', `Pesquisa NPS ${npsId} reclassificada como reclamação para tratativa.`, user);
  await insertComplaintLog(result.insertId, 'assigned_to_coordinator', `Protocolo vinculado ao responsável ${coordinatorLabel}.`, {
    name: 'Sistema GRC',
    role: 'sistema'
  });
  await insertNpsLog(npsId, 'migrado_para_reclamacao', `Detrator migrado para reclamação ${protocol}.`, user);
  await notifyComplaintCreated(result.insertId, protocol);

  return {
    complaintId: result.insertId,
    protocol,
    alreadyConverted: false
  };
}

async function saveNpsTreatment(npsId, user, payload = {}, options = {}) {
  const [rows] = await pool.query('SELECT * FROM nps_responses WHERE id = ?', [npsId]);

  if (!rows.length) {
    const error = new Error('Pesquisa NPS não encontrada.');
    error.statusCode = 404;
    throw error;
  }

  const nps = rows[0];
  const profile = nps.nps_profile || inferNpsProfile(nps.score);

  if (profile !== 'detrator') {
    const error = new Error('A tratativa de NPS está disponível para clientes detratores.');
    error.statusCode = 409;
    throw error;
  }

  const comment = String(payload.treatment_comment || payload.comment || '').trim();

  if (options.requireComment !== false && !comment) {
    const error = new Error('Descreva a tratativa realizada antes de salvar.');
    error.statusCode = 400;
    throw error;
  }

  const requestedStatus = normalizeNpsStatus(payload.status || 'em_tratativa');
  const nextStatus = requestedStatus === 'registrado' ? 'em_tratativa' : requestedStatus;
  const protocol = nps.nps_protocol || formatNpsProtocol(nps.id, nps.created_at);
  const actorName = getActorName(user);
  const lastComment = comment || nps.nps_treatment_comment || null;

  await pool.query(
    `UPDATE nps_responses
        SET nps_protocol = ?,
            nps_status = ?,
            nps_treatment_comment = ?,
            nps_treatment_at = NOW(),
            nps_treatment_by = ?,
            nps_treatment_by_role = ?
      WHERE id = ?`,
    [
      protocol,
      nextStatus,
      lastComment,
      actorName,
      user?.role || null,
      npsId
    ]
  );

  await insertNpsLog(
    npsId,
    comment ? 'tratativa_registrada' : 'tratativa_aberta',
    comment || `Relato do detrator aberto para tratamento no protocolo ${protocol}.`,
    user
  );

  const [updated] = await getNpsRows({ id: npsId });
  return updated;
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  try {
    req.user = jwt.verify(token, SECRET);
    return next();

  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return next();
  }

  try {
    req.user = jwt.verify(token, SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
  }
}

function requireAdmin(req, res, next) {
  if (isAdminUser(req.user)) {
    return next();
  }

  return res.status(403).json({ error: 'Acesso restrito ao administrador' });
}

function requireMasterAdmin(req, res, next) {
  if (isMasterAdminUser(req.user)) {
    return next();
  }

  return res.status(403).json({ error: 'Acesso restrito ao Administrador Master' });
}

// ============================================
// TESTE
// ============================================
app.get('/', (req, res) => {
  res.send('API funcionando 🚀');
});

// ============================================
// CLINICS
// ============================================
app.get('/clinics', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    const rows = await getClinicsForUser(req.user);

    if (!rows.length) {
      console.warn('[GET /clinics] Nenhuma clínica encontrada.', {
        userId: req.user?.id,
        email: req.user?.email,
        role: req.user?.role
      });
    }

    return res.status(200).json(rows);
  } catch (error) {
    console.error('[GET /clinics] Erro ao buscar clínicas:', error);
    return res.status(500).json({ error: 'Erro ao buscar clínicas' });
  }
});

app.get('/public/clinics', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         name,
         city,
         state,
         region,
         coordinator_name,
         active
       FROM clinics
       WHERE active = 1
       ORDER BY name ASC`
    );

    res.json(rows);
  } catch (error) {
    console.error('[GET /public/clinics] Erro ao buscar clínicas públicas:', error);
    res.status(500).json({ error: 'Erro ao buscar clínicas públicas.' });
  }
});

app.get('/complaint-types', (req, res) => {
  res.json(complaintTypeSuggestions);
});

app.get('/registration-options', (req, res) => {
  res.json({
    positions: collaboratorPositions,
    accessProfiles,
    screenPermissions
  });
});

app.post('/registration-requests', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      position,
      phone,
      whatsapp,
      department
    } = req.body;

    if (!name || !email || !password || !role || !position || !phone || !whatsapp) {
      return res.status(400).json({
        error: 'Preencha nome completo, e-mail, senha, perfil de acesso, cargo, telefone e WhatsApp.'
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'A senha deve ter no mínimo 8 caracteres, letra maiúscula, letra minúscula, número e caractere especial.'
      });
    }

    if (!accessProfiles[role]) {
      return res.status(400).json({ error: 'Perfil de acesso inválido.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = normalizeBrazilPhone(phone);
    const normalizedWhatsapp = normalizeBrazilPhone(whatsapp);

    if (!isCompleteBrazilPhone(normalizedPhone) || !isCompleteBrazilPhone(normalizedWhatsapp)) {
      return res.status(400).json({ error: 'Informe telefone e WhatsApp completos no formato +55DDDNÚMERO.' });
    }

    const [users] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    const [pending] = await pool.query(
      'SELECT id FROM registration_requests WHERE email = ? AND status = ?',
      [normalizedEmail, 'pendente']
    );

    if (users.length || pending.length) {
      return res.status(409).json({ error: 'Já existe usuário ou cadastro pendente para este e-mail.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO registration_requests
       (name, email, password, role, position, phone, whatsapp, department, token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        normalizedEmail,
        passwordHash,
        role,
        position,
        normalizedPhone,
        normalizedWhatsapp,
        department || null,
        token
      ]
    );

    const approvalLink = `${publicBaseUrl}/registration-requests/${token}/approve`;

    await sendEmail(
      approvalEmail,
      'Novo cadastro aguardando aprovação - Sistema GRC',
      `
        <h2>Novo cadastro aguardando aprovação</h2>
        <p><strong>Nome:</strong> ${name}</p>
        <p><strong>E-mail:</strong> ${normalizedEmail}</p>
        <p><strong>Cargo:</strong> ${position}</p>
        <p><strong>Perfil solicitado:</strong> ${accessProfiles[role]}</p>
        <p><strong>Telefone:</strong> ${normalizedPhone}</p>
        <p><strong>WhatsApp:</strong> ${normalizedWhatsapp}</p>
        <p><strong>Área/unidade:</strong> ${department || 'Não informado'}</p>
        <p><a href="${approvalLink}">Aprovar cadastro</a></p>
      `
    );
    await createNotificationForAdmins(
      'registration_request',
      'Novo cadastro aguardando aprovação',
      `${name} solicitou acesso como ${accessProfiles[role]}.`,
      '/home',
      { requestEmail: normalizedEmail }
    );

    res.status(201).json({
      message: 'Cadastro enviado para aprovação. O administrador será notificado por e-mail.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao solicitar cadastro.' });
  }
});

app.get('/registration-requests/:token/approve', async (req, res) => {
  try {
    const { token } = req.params;
    const [rows] = await pool.query(
      'SELECT * FROM registration_requests WHERE token = ? AND status = ?',
      [token, 'pendente']
    );

    if (!rows.length) {
      return res.status(404).send('<h1>Cadastro não encontrado ou já aprovado.</h1>');
    }

    const request = rows[0];
    await pool.query(
      `INSERT INTO users
       (name, email, password, role, position, phone, whatsapp, department, permissions, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         role = VALUES(role),
         position = VALUES(position),
         phone = VALUES(phone),
         whatsapp = VALUES(whatsapp),
         department = VALUES(department),
         permissions = VALUES(permissions),
         active = 1,
         deleted_at = NULL,
         deleted_by = NULL`,
      [
        request.name,
        request.email,
        request.password,
        request.role,
        request.position,
        request.phone,
        request.whatsapp,
        request.department,
        JSON.stringify(defaultPermissionsForRole(request.role))
      ]
    );
    await pool.query(
      'UPDATE registration_requests SET status = ?, approved_at = NOW() WHERE id = ?',
      ['aprovado', request.id]
    );

    await sendEmail(
      request.email,
      'Cadastro aprovado - Sistema GRC',
      `<p>Seu cadastro foi aprovado.</p><p>Acesse o sistema: <a href="${frontendUrl}">${frontendUrl}</a></p>`
    );

    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; color: #102033;">
          <h1>Cadastro aprovado</h1>
          <p>O acesso de <strong>${request.name}</strong> foi liberado.</p>
          <a href="${frontendUrl}">Abrir Sistema GRC</a>
        </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('<h1>Erro ao aprovar cadastro.</h1>');
  }
});

app.get('/admin/options', authenticate, requireAdmin, (req, res) => {
  res.json({
    accessProfiles: {
      master_admin: 'Administrador Master',
      ...accessProfiles
    },
    screenPermissions
  });
});

app.get('/admin/registration-requests', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pendente';
    const [rows] = await pool.query(
      `SELECT id, name, email, role, position, phone, whatsapp, department, status, created_at
       FROM registration_requests
       WHERE status = ?
       ORDER BY created_at DESC`,
      [status]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar cadastros pendentes.' });
  }
});

app.post('/admin/registration-requests/:id/approve', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM registration_requests WHERE id = ? AND status = ?',
      [req.params.id, 'pendente']
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Cadastro não encontrado ou já analisado.' });
    }

    const request = rows[0];
    await pool.query(
      `INSERT INTO users
       (name, email, password, role, position, phone, whatsapp, department, permissions, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         role = VALUES(role),
         position = VALUES(position),
         phone = VALUES(phone),
         whatsapp = VALUES(whatsapp),
         department = VALUES(department),
         permissions = VALUES(permissions),
         active = 1,
         deleted_at = NULL,
         deleted_by = NULL`,
      [
        request.name,
        request.email,
        request.password,
        request.role,
        request.position,
        request.phone,
        request.whatsapp,
        request.department,
        JSON.stringify(defaultPermissionsForRole(request.role))
      ]
    );
    await pool.query(
      'UPDATE registration_requests SET status = ?, approved_at = NOW() WHERE id = ?',
      ['aprovado', request.id]
    );
    await sendEmail(
      request.email,
      'Cadastro aprovado - Sistema GRC',
      `<p>Seu cadastro foi aprovado.</p><p>Acesse o sistema: <a href="${frontendUrl}">${frontendUrl}</a></p>`
    );
    await createNotificationForAdmins(
      'registration_approved',
      'Cadastro aprovado',
      `${request.name} foi aprovado por ${getActorName(req.user)}.`,
      '/home',
      { requestId: request.id }
    );

    res.json({ message: 'Cadastro aprovado com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao aprovar cadastro.' });
  }
});

app.post('/admin/registration-requests/:id/reject', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM registration_requests WHERE id = ? AND status = ?',
      [req.params.id, 'pendente']
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Cadastro não encontrado ou já analisado.' });
    }

    const request = rows[0];
    await pool.query(
      'UPDATE registration_requests SET status = ? WHERE id = ?',
      ['rejeitado', request.id]
    );
    await sendEmail(
      request.email,
      'Cadastro não aprovado - Sistema GRC',
      '<p>Seu cadastro foi analisado e não foi aprovado neste momento.</p>'
    );
    await createNotificationForAdmins(
      'registration_rejected',
      'Cadastro rejeitado',
      `${request.name} foi rejeitado por ${getActorName(req.user)}.`,
      '/home',
      { requestId: request.id }
    );

    res.json({ message: 'Cadastro rejeitado.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao rejeitar cadastro.' });
  }
});

app.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, name, email, role, position, phone, whatsapp, department, permissions, active, must_change_password, created_at, updated_at
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY name ASC`
    );
    const [links] = await pool.query('SELECT user_id, clinic_id, can_edit FROM user_clinics');
    const clinicsByUser = links.reduce((acc, link) => {
      acc[link.user_id] = acc[link.user_id] || [];
      acc[link.user_id].push({ clinic_id: link.clinic_id, can_edit: Boolean(link.can_edit) });
      return acc;
    }, {});

    res.json(users.map((user) => {
      let permissions = defaultPermissionsForRole(user.role);

      try {
        permissions = user.permissions ? JSON.parse(user.permissions) : permissions;
      } catch (error) {
        permissions = defaultPermissionsForRole(user.role);
      }

      return {
        ...user,
        permissions,
        clinics: clinicsByUser[user.id] || []
      };
    }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

app.post('/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      email,
      role,
      position,
      phone,
      whatsapp,
      department,
      permissions,
      clinicIds
    } = req.body || {};

    if (!name || !email || !role || !position || !phone || !whatsapp) {
      return res.status(400).json({
        error: 'Preencha nome completo, e-mail, perfil, cargo, telefone e WhatsApp.'
      });
    }

    if (role === 'master_admin') {
      return res.status(403).json({ error: 'Administrador Master é exclusivo para o usuário master.' });
    }

    if (!accessProfiles[role]) {
      return res.status(400).json({ error: 'Perfil de acesso inválido.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = normalizeBrazilPhone(phone);
    const normalizedWhatsapp = normalizeBrazilPhone(whatsapp);

    if (!isCompleteBrazilPhone(normalizedPhone) || !isCompleteBrazilPhone(normalizedWhatsapp)) {
      return res.status(400).json({ error: 'Informe telefone e WhatsApp completos no formato +55DDDNÚMERO.' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = ? AND deleted_at IS NULL',
      [normalizedEmail]
    );

    if (existing.length) {
      return res.status(409).json({ error: 'Já existe um usuário ativo com este e-mail.' });
    }

    const allowedPermissions = Array.isArray(permissions)
      ? permissions.filter((permission) => screenPermissions[permission])
      : defaultPermissionsForRole(role);
    const passwordHash = await bcrypt.hash('123456789', 10);
    const [result] = await pool.query(
      `INSERT INTO users
       (name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [
        String(name).trim(),
        normalizedEmail,
        passwordHash,
        role,
        String(position).trim(),
        normalizedPhone,
        normalizedWhatsapp,
        String(department || '').trim() || null,
        JSON.stringify(allowedPermissions)
      ]
    );

    if (Array.isArray(clinicIds) && clinicIds.length) {
      await Promise.all(clinicIds.map((clinicId) => (
        pool.query(
          'INSERT INTO user_clinics (user_id, clinic_id, can_edit) VALUES (?, ?, 1)',
          [result.insertId, clinicId]
        )
      )));
    }

    try {
      await sendEmail(
        normalizedEmail,
        'Primeiro acesso liberado - Sistema GRC',
        `
          <h2>Seu acesso foi criado no Sistema GRC</h2>
          <p><strong>Link do sistema:</strong> <a href="${frontendUrl}">${frontendUrl}</a></p>
          <p><strong>E-mail de acesso:</strong> ${normalizedEmail}</p>
          <p><strong>Senha temporária:</strong> 123456789</p>
          <p>Por segurança, a alteração da senha será obrigatória no primeiro acesso.</p>
        `
      );
    } catch (error) {
      console.warn('Nao foi possivel enviar o e-mail de primeiro acesso:', error.message);
    }

    await createNotification(
      result.insertId,
      'password_reset',
      'Primeiro acesso liberado',
      'Seu acesso foi criado. Use a senha temporária 123456789 e altere a senha no primeiro login.',
      '/perfil',
      { temporaryPassword: true, firstAccess: true }
    );

    res.status(201).json({
      message: 'Usuário criado com sucesso. O link de acesso foi enviado com a senha temporária.',
      id: result.insertId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

app.patch('/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const current = rows[0];
    const requestedRole = req.body.role || current.role;
    const currentEmail = String(current.email || '').toLowerCase();

    if (requestedRole === 'master_admin' && currentEmail !== masterAdminEmail) {
      return res.status(403).json({ error: 'Administrador Master é exclusivo para henrique.martins@grcconsultoria.net.br.' });
    }

    if (currentEmail === masterAdminEmail && requestedRole !== 'master_admin') {
      return res.status(403).json({ error: 'O usuário master não pode ser rebaixado para outro perfil.' });
    }

    if (currentEmail === masterAdminEmail && req.body.active === false) {
      return res.status(403).json({ error: 'O Administrador Master não pode ser desabilitado.' });
    }

    if ((current.role === 'master_admin' || requestedRole === 'master_admin') && !isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode alterar esse perfil.' });
    }

    const normalizedPhone = req.body.phone ? normalizeBrazilPhone(req.body.phone) : current.phone;
    const normalizedWhatsapp = req.body.whatsapp ? normalizeBrazilPhone(req.body.whatsapp) : current.whatsapp;

    if (!isCompleteBrazilPhone(normalizedPhone) || !isCompleteBrazilPhone(normalizedWhatsapp)) {
      return res.status(400).json({ error: 'Informe telefone e WhatsApp completos no formato +55DDDNÚMERO.' });
    }

    const nextRole = currentEmail === masterAdminEmail ? 'master_admin' : requestedRole;
    const permissions = Array.isArray(req.body.permissions)
      ? req.body.permissions.filter((permission) => screenPermissions[permission])
      : defaultPermissionsForRole(nextRole);

    await pool.query(
      `UPDATE users
          SET name = ?,
              role = ?,
              position = ?,
              phone = ?,
              whatsapp = ?,
              department = ?,
              permissions = ?,
              active = ?
        WHERE id = ?`,
      [
        req.body.name || current.name,
        nextRole,
        req.body.position || current.position,
        normalizedPhone,
        normalizedWhatsapp,
        req.body.department || current.department,
        JSON.stringify(permissions),
        req.body.active === undefined ? current.active : (req.body.active ? 1 : 0),
        current.id
      ]
    );

    if (Array.isArray(req.body.clinicIds)) {
      await pool.query('DELETE FROM user_clinics WHERE user_id = ?', [current.id]);
      await Promise.all(req.body.clinicIds.map((clinicId) => (
        pool.query(
          'INSERT INTO user_clinics (user_id, clinic_id, can_edit) VALUES (?, ?, 1)',
          [current.id, clinicId]
        )
      )));
    }

    res.json({ message: 'Usuário atualizado com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

app.post('/admin/users/:id/reset-password', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, role, email FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = rows[0];

    if (String(user.email).toLowerCase() === masterAdminEmail) {
      return res.status(403).json({ error: 'A senha do Administrador Master não pode ser reiniciada pelo painel.' });
    }

    if (user.role === 'master_admin' && !isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode reiniciar a senha deste usuário.' });
    }

    const passwordHash = await bcrypt.hash('123456789', 10);
    await pool.query('UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?', [passwordHash, user.id]);
    await createNotification(
      user.id,
      'password_reset',
      'Senha reiniciada',
      'Sua senha foi reiniciada pelo administrador. Use a senha temporária 123456789 e altere no primeiro acesso.',
      '/perfil',
      { temporaryPassword: true }
    );

    res.json({ message: 'Senha reiniciada para 123456789.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao reiniciar senha.' });
  }
});

app.delete('/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, role, email FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = rows[0];

    if (String(user.email).toLowerCase() === masterAdminEmail) {
      return res.status(403).json({ error: 'O Administrador Master não pode ser excluído ou desabilitado.' });
    }

    if ((user.role === 'master_admin' || String(user.email).toLowerCase() === masterAdminEmail) && !isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode excluir esse usuário.' });
    }

    await pool.query(
      'UPDATE users SET active = 0, deleted_at = NOW(), deleted_by = ? WHERE id = ?',
      [getActorName(req.user), user.id]
    );
    await pool.query('DELETE FROM user_clinics WHERE user_id = ?', [user.id]);

    res.json({ message: 'Usuário excluído com lastro de auditoria.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir usuário.' });
  }
});

app.get('/notifications', authenticate, async (req, res) => {
  try {
    const requestedStatus = String(req.query.status || 'unread').toLowerCase();
    const statusFilter = ['read', 'unread'].includes(requestedStatus) ? requestedStatus : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 500);
    const params = [req.user.id, isAdminUser(req.user) ? 1 : 0];
    const statusClause = statusFilter ? 'AND status = ?' : '';

    if (statusFilter) {
      params.push(statusFilter);
    }

    params.push(limit);

    const [rows] = await pool.query(
      `SELECT id, type, title, message, link, status, payload, created_at, read_at
       FROM notification_events
       WHERE (user_id = ? OR (? = 1 AND user_id IS NULL))
         AND NOT EXISTS (
           SELECT 1
           FROM notification_hidden nh
           WHERE nh.notification_id = notification_events.id
             AND nh.user_id = ?
         )
         ${statusClause}
       ORDER BY COALESCE(read_at, created_at) DESC
       LIMIT ?`,
      [req.user.id, isAdminUser(req.user) ? 1 : 0, req.user.id, ...params.slice(2)]
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar notificações.' });
  }
});

app.post('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notification_events
          SET status = 'read', read_at = NOW()
        WHERE id = ? AND (user_id = ? OR ? = 1)`,
      [req.params.id, req.user.id, isAdminUser(req.user) ? 1 : 0]
    );
    res.json({ message: 'Notificação marcada como lida.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar notificação.' });
  }
});

app.delete('/notifications/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id
         FROM notification_events
        WHERE id = ?
          AND (user_id = ? OR (? = 1 AND user_id IS NULL))`,
      [req.params.id, req.user.id, isAdminUser(req.user) ? 1 : 0]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Notificação não encontrada.' });
    }

    await pool.query(
      `INSERT INTO notification_hidden (notification_id, user_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE hidden_at = CURRENT_TIMESTAMP`,
      [req.params.id, req.user.id]
    );

    res.json({ message: 'Notificação removida do histórico.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir notificação.' });
  }
});

app.delete('/patient-interactions/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, status, protocol, created_at FROM patient_interactions WHERE id = ?', [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    const record = rows[0];

    if (record.status === 'Cancelado') {
      return res.json({ message: 'Agendamento já está na aba de cancelados.' });
    }

    await pool.query(
      `UPDATE patient_interactions
          SET status = 'Cancelado',
              cancelled_at = NOW(),
              cancelled_by_name = ?,
              cancelled_by_role = ?
        WHERE id = ?`,
      [getActorName(req.user), req.user?.role || null, req.params.id]
    );
    await insertPatientInteractionLog(
      req.params.id,
      'Cancelado',
      `Agendamento ${record.protocol || formatPatientProtocol(record.id, record.created_at)} movido para cancelados.`,
      req.user
    );

    res.json({ message: 'Agendamento movido para cancelados com lastro.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao cancelar agendamento.' });
  }
});

// ============================================
// LOGIN
// ============================================
app.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const login = String(email || username || '').trim().toLowerCase();

    if (!login || !password) {
      return res.status(400).json({ message: 'Informe e-mail e senha' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = ?',
      [login]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Usuário não encontrado' });
    }

    const user = rows[0];

    if (!user.active || user.deleted_at) {
      return res.status(403).json({ message: 'Usuário desabilitado. Procure o administrador.' });
    }

    let validPassword = false;

    if (user.password === password) {
      validPassword = true;
      const migratedHash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password = ? WHERE id = ?', [migratedHash, user.id]);
      user.password = migratedHash;
    } else {
      validPassword = await bcrypt.compare(password, user.password);
    }

    if (!validPassword) {
      return res.status(401).json({ message: 'Senha inválida' });
    }

    const { password: _password, ...safeUser } = user;
    const role = safeUser.role || 'viewer';
    let permissions = defaultPermissionsForRole(role);

    try {
      permissions = safeUser.permissions ? JSON.parse(safeUser.permissions) : permissions;
    } catch (error) {
      permissions = defaultPermissionsForRole(role);
    }

    const clinicIds = await getUserClinicIds(user.id);
    const mustChangePassword = Boolean(user.must_change_password);
    const token = jwt.sign({ id: user.id, email: user.email, role, name: user.name, permissions, clinicIds, mustChangePassword }, SECRET);

    res.json({
      message: 'Login ok',
      success: true,
      token,
      user: {
        ...safeUser,
        role,
        permissions,
        clinicIds,
        mustChangePassword
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro no login' });
  }
});

app.patch('/profile', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.user.id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const current = rows[0];
    const currentEmail = String(current.email || '').toLowerCase();
    const requestedEmail = String(req.body.email || current.email).trim().toLowerCase();

    if (currentEmail === masterAdminEmail && requestedEmail !== masterAdminEmail) {
      return res.status(403).json({ error: 'O e-mail do Administrador Master não pode ser alterado.' });
    }

    if (requestedEmail !== currentEmail) {
      const [duplicates] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ? AND deleted_at IS NULL', [requestedEmail, current.id]);

      if (duplicates.length) {
        return res.status(409).json({ error: 'Já existe outro usuário com este e-mail.' });
      }
    }

    const normalizedPhone = normalizeBrazilPhone(req.body.phone || current.phone);
    const normalizedWhatsapp = normalizeBrazilPhone(req.body.whatsapp || current.whatsapp);

    if (!isCompleteBrazilPhone(normalizedPhone) || !isCompleteBrazilPhone(normalizedWhatsapp)) {
      return res.status(400).json({ error: 'Informe telefone e WhatsApp completos no formato +55DDDNÚMERO.' });
    }

    await pool.query(
      `UPDATE users
          SET name = ?,
              email = ?,
              phone = ?,
              whatsapp = ?
        WHERE id = ?`,
      [
        req.body.name || current.name,
        requestedEmail,
        normalizedPhone,
        normalizedWhatsapp,
        current.id
      ]
    );

    const [updatedRows] = await pool.query(
      `SELECT id, name, email, role, position, phone, whatsapp, department, permissions, active, must_change_password, created_at, updated_at
       FROM users
       WHERE id = ?`,
      [current.id]
    );
    const updated = updatedRows[0];
    let permissions = defaultPermissionsForRole(updated.role);

    try {
      permissions = updated.permissions ? JSON.parse(updated.permissions) : permissions;
    } catch (error) {
      permissions = defaultPermissionsForRole(updated.role);
    }

    const clinicIds = await getUserClinicIds(updated.id);

    res.json({
      message: 'Perfil atualizado com sucesso.',
      user: {
        ...updated,
        permissions,
        clinicIds,
        mustChangePassword: Boolean(updated.must_change_password)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar perfil.' });
  }
});

app.post('/profile/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Informe a senha atual e a nova senha.' });
    }

    if (!isStrongPassword(new_password)) {
      return res.status(400).json({ error: 'A nova senha deve ter no mínimo 8 caracteres, letra maiúscula, letra minúscula, número e caractere especial.' });
    }

    const [rows] = await pool.query('SELECT id, password FROM users WHERE id = ? AND deleted_at IS NULL', [req.user.id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = rows[0];
    const validPassword = user.password === current_password || await bcrypt.compare(current_password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Senha atual inválida.' });
    }

    const passwordHash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?', [passwordHash, user.id]);

    res.json({ message: 'Senha alterada com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao alterar senha.' });
  }
});

// ============================================
// NPS
// ============================================
app.post('/nps', async (req, res) => {
  try {
    const { clinic_id, patient_name, score, comment, feedback_type } = req.body;
    const numericScore = Number(score);

    if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 10) {
      return res.status(400).json({ error: 'Informe uma nota NPS entre 1 e 10.' });
    }

    const classification = classifyNpsFeedback(score, feedback_type);
    const npsProfile = inferNpsProfile(numericScore);

    const [npsInsert] = await pool.query(
      `INSERT INTO nps_responses
       (clinic_id, patient_name, score, comment, feedback_type, nps_profile, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [clinic_id, patient_name, numericScore, comment, classification, npsProfile, 'interno']
    );

    const protocol = formatNpsProtocol(npsInsert.insertId);
    await pool.query('UPDATE nps_responses SET nps_protocol = ? WHERE id = ?', [protocol, npsInsert.insertId]);
    await insertNpsLog(npsInsert.insertId, 'created', `Pesquisa NPS registrada no protocolo ${protocol}.`, {
      name: 'Registro NPS interno',
      role: 'interno'
    });

    res.status(201).json({ message: 'NPS salvo com sucesso.', protocol, npsId: npsInsert.insertId });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao salvar NPS' });
  }
});

app.post('/nps/public', async (req, res) => {
  try {
    const {
      clinic_id,
      patient_name,
      patient_phone,
      score,
      comment,
      feedback_type,
      recommend_yes,
      contact_share_allowed,
      referral_name,
      referral_phone,
      improvement_comment,
      detractor_reasons,
      detractor_feedback
    } = req.body;
    const numericScore = Number(score);

    if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 10) {
      return res.status(400).json({ error: 'Informe uma nota NPS entre 1 e 10.' });
    }

    if (!clinic_id || !patient_name || !isCompleteBrazilPhone(patient_phone)) {
      return res.status(400).json({ error: 'Informe clínica, nome e telefone completo no formato +55DDDNÚMERO.' });
    }

    const normalizedPatientPhone = normalizeBrazilPhone(patient_phone);
    const normalizedReferralPhone = referral_phone ? normalizeBrazilPhone(referral_phone) : '';
    const npsProfile = inferNpsProfile(numericScore);
    const requestIp = getRequestIp(req);

    const [sameDayPhoneRows] = await pool.query(
      `SELECT id, nps_protocol
         FROM nps_responses
        WHERE patient_phone = ?
          AND DATE(created_at) = CURDATE()
        ORDER BY created_at DESC
        LIMIT 1`,
      [normalizedPatientPhone]
    );

    if (sameDayPhoneRows.length) {
      return res.status(409).json({
        error: 'Já existe uma avaliação registrada hoje para este telefone.'
      });
    }

    if (requestIp && requestIp !== 'ip-nao-informado') {
      const [sameDayIpRows] = await pool.query(
        `SELECT id, nps_protocol
           FROM nps_responses
          WHERE ip_address = ?
            AND DATE(created_at) = CURDATE()
          ORDER BY created_at DESC
          LIMIT 1`,
        [requestIp]
      );

      if (sameDayIpRows.length) {
        return res.status(409).json({
          error: 'Já recebemos uma avaliação deste dispositivo hoje. Tente novamente amanhã.'
        });
      }
    }

    if (npsProfile === 'promotor' && recommend_yes && (!referral_name || !isCompleteBrazilPhone(referral_phone))) {
      return res.status(400).json({ error: 'Informe nome e telefone completo da indicação.' });
    }

    if (npsProfile === 'detrator' && !String(detractor_feedback || '').trim()) {
      return res.status(400).json({ error: 'Informe a reclamação detalhada para concluir a pesquisa.' });
    }

    const normalizedReasons = Array.isArray(detractor_reasons)
      ? detractor_reasons.filter(Boolean).slice(0, 10)
      : [];
    const classification = classifyNpsFeedback(
      numericScore,
      feedback_type || (npsProfile === 'promotor' ? 'elogio' : npsProfile === 'neutro' ? 'sugestao' : 'reclamacao')
    );
    const narrative = buildNpsNarrative(
      {
        comment,
        improvement_comment,
        detractor_feedback,
        detractor_reasons: normalizedReasons,
        recommend_yes,
        referral_name,
        referral_phone
      },
      classification,
      npsProfile
    );
    const [clinicRows] = await pool.query(
      'SELECT name FROM clinics WHERE id = ? LIMIT 1',
      [clinic_id]
    );
    const clinicName = clinicRows[0]?.name || 'Unidade não informada';

    const [npsInsert] = await pool.query(
      `INSERT INTO nps_responses
       (clinic_id, patient_name, patient_phone, score, comment, feedback_type, nps_profile, recommend_yes, contact_share_allowed, referral_name, referral_phone, improvement_comment, detractor_reasons, detractor_feedback, source, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clinic_id || null,
        patient_name || null,
        normalizedPatientPhone,
        numericScore,
        comment || null,
        classification,
        npsProfile,
        recommend_yes ? 1 : 0,
        contact_share_allowed ? 1 : 0,
        referral_name || null,
        normalizedReferralPhone || null,
        improvement_comment || null,
        normalizedReasons.length ? JSON.stringify(normalizedReasons) : null,
        detractor_feedback || null,
        'link_publico',
        requestIp || null
      ]
    );

    const shouldCreateManifestation = false;

    if (shouldCreateManifestation) {
      const priority = priorityForNpsFeedback(numericScore, classification);
      const resolutionDueAt = calculateResolutionDueAt();
      const [result] = await pool.query(
        `INSERT INTO complaints
         (clinic_id, patient_name, patient_phone, channel, complaint_type, description, service_type, status, priority, due_at, resolution_due_at, created_origin)
         VALUES (?, ?, ?, 'NPS', ?, ?, 'Pesquisa de satisfaÃ§Ã£o', 'aberta', ?, ?, ?, 'Externo')`,
        [
          clinic_id || null,
          patient_name || 'Paciente NPS',
          normalizedPatientPhone,
          classification,
          narrative,
          priority,
          toMysqlDateTime(calculateDueAt(priority)),
          toMysqlDateTime(resolutionDueAt)
        ]
      );
      const protocol = `GRC-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
      await pool.query('UPDATE complaints SET protocol = ? WHERE id = ?', [protocol, result.insertId]);
      await pool.query(
        'UPDATE nps_responses SET converted_complaint_id = ?, converted_at = NOW(), converted_by = ? WHERE id = ?',
        [result.insertId, 'Link público NPS', npsInsert.insertId]
      );
      await insertComplaintLog(result.insertId, 'created', `Protocolo ${protocol} criado pelo link público de NPS.`, {
        name: 'Link público NPS',
        role: 'externo'
      });
      await notifyComplaintCreated(result.insertId, protocol);
    }

    const protocol = formatNpsProtocol(npsInsert.insertId);
    await pool.query('UPDATE nps_responses SET nps_protocol = ? WHERE id = ?', [protocol, npsInsert.insertId]);
    await insertNpsLog(npsInsert.insertId, 'created', `Pesquisa de satisfação registrada no protocolo ${protocol}.`, {
      name: 'Link público NPS',
      role: 'externo'
    });

    let linkedPatientRecord = null;

    if (npsProfile === 'promotor' && contact_share_allowed) {
      linkedPatientRecord = await createPromoterAgendaRecord({
        npsId: npsInsert.insertId,
        patientName: patient_name,
        patientPhone: normalizedPatientPhone,
        clinicName
      });
      await insertNpsLog(
        npsInsert.insertId,
        'agenda_compartilhada',
        `Paciente autorizou compartilhar o contato com a agenda. Protocolo vinculado: ${linkedPatientRecord.protocol}.`,
        {
          name: 'Link público NPS',
          role: 'externo'
        }
      );
    }

    await sendWhatsappNotification({
      event: 'nps_protocol_patient',
      to: normalizedPatientPhone,
      protocol,
      npsId: npsInsert.insertId,
      message: `Sua pesquisa de satisfacao foi registrada com o protocolo ${protocol}.`
    });

    const duplicatePhones = await getMonthlyDuplicateNpsPhones(new Date());
    const duplicatePhoneEntry = duplicatePhones.find((item) => item.patient_phone === normalizedPatientPhone);

    if (duplicatePhoneEntry && Number(duplicatePhoneEntry.total) > 1) {
      await alertDuplicateNpsPhone(normalizedPatientPhone, protocol, npsInsert.insertId);
    }

    if (npsProfile === 'detrator') {
      await notifyClinicResponsibles(
        clinic_id,
        'nps_detractor_assigned',
        `Novo detrator NPS ${protocol}`,
        `Novo detrator registrado na pesquisa NPS.\nPaciente: ${patient_name}\nProtocolo NPS: ${protocol}`,
        `${frontendUrl}/gestao-nps`,
        { npsId: npsInsert.insertId, protocol }
      );
    }

    res.status(201).json({
      message: 'Pesquisa NPS salva com sucesso.',
      protocol,
      npsId: npsInsert.insertId,
      linkedPatientProtocol: linkedPatientRecord?.protocol || null,
      linkedPatientInteractionId: linkedPatientRecord?.id || null
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao salvar a pesquisa NPS.' });
  }
});

// ============================================
// CALCULAR NPS
// ============================================
app.get('/nps/score', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT score FROM nps_responses');

    let promoters = 0;
    let detractors = 0;

    rows.forEach(r => {
      if (r.score >= 9) promoters++;
      else if (r.score <= 6) detractors++;
    });

    const total = rows.length;
    const nps = total > 0 ? ((promoters - detractors) / total) * 100 : 0;

    res.json({ total, promoters, detractors, nps });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao calcular NPS' });
  }
});

app.get('/nps/responses', authenticate, async (req, res) => {
  try {
    const rows = await getNpsRows(req.query, req.user);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar pesquisas NPS.' });
  }
});

app.get('/nps/duplicate-report', authenticate, async (req, res) => {
  try {
    if (!isAdminUser(req.user) && req.user?.role !== 'supervisor_crc') {
      return res.status(403).json({ error: 'Apenas Supervisor do CRC, Administrador e Administrador Master podem visualizar este relatório.' });
    }

    const rows = await getMonthlyDuplicateNpsPhones(req.query?.month);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao gerar o relatório de telefones duplicados do NPS.' });
  }
});

app.get('/nps/bulk-template', authenticate, async (req, res) => {
  try {
    const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];

    if (!permissions.includes('nps_management') && !isAdminUser(req.user)) {
      return res.status(403).json({ error: 'Seu perfil nao possui acesso ao envio em massa de NPS.' });
    }

    const csv = [
      'Nome;Telefone / WhatsApp',
      'Paciente Exemplo;+5562999999999'
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="template-envio-nps.csv"');
    res.send(`\uFEFF${csv}`);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao gerar o template de envio em massa.' });
  }
});

app.post('/nps/bulk-dispatch', authenticate, upload.single('file'), async (req, res) => {
  const permissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];

  if (!permissions.includes('nps_management') && !isAdminUser(req.user)) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return res.status(403).json({ error: 'Seu perfil nao possui acesso ao envio em massa de NPS.' });
  }

  try {
    const publicNpsLink = `${frontendUrl}/pesquisa-nps`;
    const content = req.file?.path
      ? fs.readFileSync(req.file.path, 'utf8')
      : String(req.body?.content || '');

    if (!String(content || '').trim()) {
      return res.status(400).json({ error: 'Envie uma planilha CSV com nome e telefone dos pacientes.' });
    }

    const recipients = parseBulkNpsCsv(content);

    if (!recipients.length) {
      return res.status(400).json({ error: 'Nenhum paciente valido foi encontrado na planilha.' });
    }

    const invalidRecipients = recipients.filter((recipient) => !isCompleteBrazilPhone(recipient.phone));
    const validRecipients = recipients.filter((recipient) => isCompleteBrazilPhone(recipient.phone));

    if (!validRecipients.length) {
      return res.status(400).json({ error: 'Nenhum telefone valido foi encontrado na planilha.' });
    }

    const baseMessage = 'Sua opinião é fundamental para melhorarmos nossos processos. Poderia dedicar 1 minuto para avaliar sua experiência conosco?';

    await Promise.all(validRecipients.map((recipient) => (
      sendWhatsappNotification({
        event: 'nps_bulk_invite',
        to: recipient.phone,
        patientName: recipient.name,
        link: publicNpsLink,
        message: `${baseMessage}\n${publicNpsLink}`
      })
    )));

    res.json({
      message: `Envio em massa preparado para ${validRecipients.length} paciente(s).`,
      total: recipients.length,
      sent: validRecipients.length,
      invalid: invalidRecipients.length,
      link: publicNpsLink
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || 'Erro ao processar a planilha de envio em massa.' });
  } finally {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
  }
});

app.post('/reports/coordinator-delays/dispatch', authenticate, async (req, res) => {
  try {
    if (!isAdminUser(req.user) && req.user?.role !== 'supervisor_crc') {
      return res.status(403).json({ error: 'Acesso restrito para o disparo de alertas por coordenador.' });
    }

    await dispatchCoordinatorDelayNotifications();
    res.json({ message: 'Alertas de atraso por coordenador enviados com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao enviar alertas de atraso por coordenador.' });
  }
});

app.post('/reports/coordinator-weekly/dispatch', authenticate, async (req, res) => {
  try {
    if (!isAdminUser(req.user) && req.user?.role !== 'supervisor_crc') {
      return res.status(403).json({ error: 'Acesso restrito para o disparo do relatório semanal por coordenador.' });
    }

    const reports = await dispatchWeeklyCoordinatorReports();
    res.json({
      message: 'Relatórios semanais por coordenador enviados com sucesso.',
      total: reports.length,
      reports
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao enviar o relatório semanal por coordenador.' });
  }
});

app.post('/nps/responses/:id/convert', authenticate, async (req, res) => {
  try {
    const response = await saveNpsTreatment(req.params.id, req.user, {
      status: 'em_tratativa',
      treatment_comment: req.body?.treatment_comment
    }, {
      requireComment: false
    });
    res.status(200).json({
      message: 'Relato do detrator aberto para tratamento no painel NPS.',
      protocol: response?.nps_protocol,
      response
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao abrir tratativa NPS.' });
  }
});

app.post('/nps/responses/:id/convert-complaint', authenticate, async (req, res) => {
  try {
    const result = await convertNpsToComplaint(req.params.id, req.user);
    res.status(result.alreadyConverted ? 200 : 201).json({
      message: result.alreadyConverted
        ? 'Pesquisa NPS já estava vinculada a uma reclamação.'
        : 'Detrator migrado para reclamação.',
      ...result
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao migrar NPS para reclamação.' });
  }
});

app.patch('/nps/responses/:id/treatment', authenticate, async (req, res) => {
  try {
    const response = await saveNpsTreatment(req.params.id, req.user, req.body);
    res.json({
      message: 'Tratativa NPS salva com sucesso.',
      protocol: response?.nps_protocol,
      response
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao salvar tratativa NPS.' });
  }
});

app.delete('/nps/responses/:id', authenticate, async (req, res) => {
  try {
    if (!canDeleteRecords(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master ou Supervisor do CRC pode excluir NPS.' });
    }

    const reason = String(req.body?.reason || 'Exclusão administrativa').slice(0, 500);
    await pool.query(
      'UPDATE nps_responses SET deleted_at = NOW(), deleted_by = ?, deletion_reason = ? WHERE id = ?',
      [getActorName(req.user), reason, req.params.id]
    );
    await insertNpsLog(req.params.id, 'excluido', `NPS excluído por ${getActorName(req.user)}. Motivo: ${reason}`, req.user);
    res.json({ message: 'NPS excluído com lastro de auditoria.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir NPS.' });
  }
});

app.get('/patient-interactions', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        id,
        protocol,
        patient_name,
        patient_phone,
        channel,
        clinic_name,
        interaction_type,
        scheduled_at,
        note,
        status,
        created_by_name,
        created_by_role,
        cancelled_at,
        cancelled_by_name,
        cancelled_by_role,
        created_at,
        updated_at
       FROM patient_interactions
       ORDER BY COALESCE(cancelled_at, created_at) DESC, id DESC`
    );

    if (!rows.length) {
      return res.json([]);
    }

    const ids = rows.map((row) => row.id);
    const [logs] = await pool.query(
      `SELECT id, interaction_id, action, message, actor_name, actor_role, created_at
       FROM patient_interaction_logs
       WHERE interaction_id IN (?)
       ORDER BY created_at DESC, id DESC`,
      [ids]
    );
    const logsByInteraction = logs.reduce((acc, log) => {
      acc[log.interaction_id] = acc[log.interaction_id] || [];
      acc[log.interaction_id].push({
        action: log.action,
        at: log.created_at,
        note: log.message,
        actor_name: log.actor_name,
        actor_role: log.actor_role
      });
      return acc;
    }, {});

    res.json(rows.map((row) => ({
      id: row.id,
      protocol: row.protocol || formatPatientProtocol(row.id, row.created_at),
      patient: row.patient_name,
      phone: row.patient_phone,
      channel: row.channel,
      clinic: row.clinic_name,
      type: row.interaction_type,
      scheduledAt: row.scheduled_at,
      note: row.note,
      status: row.status,
      createdByName: row.created_by_name,
      createdByRole: row.created_by_role,
      cancelledAt: row.cancelled_at,
      cancelledByName: row.cancelled_by_name,
      cancelledByRole: row.cancelled_by_role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      history: logsByInteraction[row.id] || [],
      lastActorName: logsByInteraction[row.id]?.[0]?.actor_name || row.cancelled_by_name || row.created_by_name || null,
      lastActorRole: logsByInteraction[row.id]?.[0]?.actor_role || row.cancelled_by_role || row.created_by_role || null,
      lastActionAt: logsByInteraction[row.id]?.[0]?.at || row.cancelled_at || row.updated_at || row.created_at
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar gestão do paciente.' });
  }
});

app.post('/patient-interactions', authenticate, async (req, res) => {
  try {
    const {
      patient,
      phone,
      channel,
      clinic,
      type,
      scheduledAt,
      note
    } = req.body;

    if (!patient || !phone || !channel || !clinic || !type || !scheduledAt) {
      return res.status(400).json({ error: 'Preencha paciente, telefone, canal, unidade, tipo e data.' });
    }

    let scheduledDate;

    if (/^\d{4}-\d{2}-\d{2}$/.test(String(scheduledAt || '').trim())) {
      scheduledDate = new Date(`${scheduledAt}T00:00:00`);
      const now = new Date();
      scheduledDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
    } else {
      scheduledDate = new Date(scheduledAt);
    }

    if (Number.isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'Informe uma data válida.' });
    }

    const [result] = await pool.query(
      `INSERT INTO patient_interactions
       (patient_name, patient_phone, channel, clinic_name, interaction_type, scheduled_at, note, status, created_by_name, created_by_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Registrado', ?, ?)`,
      [
        patient,
        phone,
        channel,
        clinic,
        type,
        toMysqlDateTime(scheduledDate),
        note || null,
        getActorName(req.user),
        req.user?.role || null
      ]
    );
    const protocol = formatPatientProtocol(result.insertId, scheduledDate);
    await pool.query('UPDATE patient_interactions SET protocol = ? WHERE id = ?', [protocol, result.insertId]);
    await insertPatientInteractionLog(result.insertId, 'Registro criado', note || `Agendamento registrado no protocolo ${protocol}.`, req.user);

    res.status(201).json({ message: 'Agendamento do paciente registrado.', id: result.insertId, protocol });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao salvar gestão do paciente.' });
  }
});

app.patch('/patient-interactions/:id', authenticate, async (req, res) => {
  try {
    const status = String(req.body.status || '').trim();
    const action = String(req.body.action || status || 'Atualização').trim();

    if (!status) {
      return res.status(400).json({ error: 'Informe o novo status.' });
    }

    await pool.query(
      'UPDATE patient_interactions SET status = ?, cancelled_at = NULL, cancelled_by_name = NULL, cancelled_by_role = NULL WHERE id = ?',
      [status, req.params.id]
    );
    await insertPatientInteractionLog(req.params.id, action, `Status atualizado para ${status}.`, req.user);

    res.json({ message: 'Agendamento atualizado.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar gestão do paciente.' });
  }
});

// ============================================
// LISTAR RECLAMAÇÕES
// ============================================
app.get('/complaints', authenticate, async (req, res) => {
  try {
    const rows = await getComplaintRows(req.query, req.user);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar reclamações' });
  }
});

// ============================================
// CRIAR RECLAMAÇÃO (COM UPLOAD)
// ============================================
app.post('/complaints', optionalAuthenticate, upload.single('file'), async (req, res) => {
  try {
    const {
      clinic_id,
      patient_name,
      patient_phone,
      channel,
      complaint_type,
      description,
      service_type,
      priority,
      created_origin,
      financial_involved,
      financial_description,
      financial_amount
    } = req.body;
    const hasFinancialValue = ['1', 'true', 'sim', 'yes'].includes(String(financial_involved || '').trim().toLowerCase());
    const normalizedPriority = hasFinancialValue ? 'alta' : normalizePriority(priority);
    const normalizedOrigin = normalizeCreatedOrigin(created_origin);
    const dueAt = calculateDueAt(normalizedPriority);
    const resolutionDueAt = calculateResolutionDueAt();

    if (!req.user && normalizedOrigin !== 'Marketing') {
      return res.status(401).json({ error: 'Faça login para registrar protocolos internos.' });
    }

    if (!clinic_id || !patient_name || !channel || !complaint_type || !description) {
      return res.status(400).json({ error: 'Preencha clínica, paciente, canal, classificação e descrição.' });
    }

    if (!isCompleteBrazilPhone(patient_phone)) {
      return res.status(400).json({ error: 'Informe o telefone completo no formato +55DDDNÚMERO.' });
    }

    if (hasFinancialValue && (!String(financial_description || '').trim() || Number(financial_amount || 0) <= 0)) {
      return res.status(400).json({ error: 'Informe a descrição e o valor envolvido no registro financeiro.' });
    }

    const normalizedPatientPhone = normalizeBrazilPhone(patient_phone);

    const file_url = req.file
      ? `${publicBaseUrl}/uploads/${req.file.filename}`
      : null;
    const assignment = await resolveCoordinatorAssignment(clinic_id);

    const [result] = await pool.query(
      `INSERT INTO complaints 
      (clinic_id, patient_name, patient_phone, channel, complaint_type, description, service_type, attachment_url, status, priority, due_at, resolution_due_at, created_origin, financial_involved, financial_description, financial_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, ?, ?, ?)`,
      [
        clinic_id,
        patient_name,
        normalizedPatientPhone,
        channel,
        complaint_type,
        description,
        service_type,
        file_url,
        normalizedPriority,
        toMysqlDateTime(dueAt),
        toMysqlDateTime(resolutionDueAt),
        normalizedOrigin,
        hasFinancialValue ? 1 : 0,
        hasFinancialValue ? financial_description || null : null,
        hasFinancialValue ? Number(financial_amount || 0) : null
      ]
    );

    const protocol = `GRC-${new Date().getFullYear()}-${String(result.insertId).padStart(6, '0')}`;
    await pool.query('UPDATE complaints SET protocol = ? WHERE id = ?', [protocol, result.insertId]);
    await pool.query(
      'UPDATE complaints SET assigned_coordinator_user_id = ?, assigned_coordinator_name = ?, clinic_snapshot_name = ? WHERE id = ?',
      [assignment.coordinatorUserId, assignment.coordinatorName, assignment.clinicSnapshotName, result.insertId]
    );
    const coordinatorLabel = assignment.coordinatorName || 'Coordenador da unidade';
    await pool.query(
      `UPDATE complaints
          SET forwarded_to_role = 'coordinator',
              forwarded_to_label = ?,
              forwarded_at = NOW(),
              forwarded_by = ?
        WHERE id = ?`,
      [coordinatorLabel, normalizedOrigin === 'Interno' ? 'Cadastro interno' : normalizedOrigin, result.insertId]
    );
    await insertComplaintLog(result.insertId, 'created', `Protocolo ${protocol} cadastrado com origem ${normalizedOrigin}.`, {
      name: normalizedOrigin === 'Interno' ? 'Usuário interno' : normalizedOrigin,
      role: normalizedOrigin.toLowerCase()
    });
    await insertComplaintLog(result.insertId, 'assigned_to_coordinator', `Protocolo vinculado ao responsável ${coordinatorLabel}.`, {
      name: 'Sistema GRC',
      role: 'sistema'
    });
    try {
      await notifyComplaintCreated(result.insertId, protocol);
    } catch (error) {
      console.warn('Nao foi possivel concluir notificacoes do protocolo:', error.message);
    }

    try {
      await sendWhatsappNotification({
        event: 'complaint_protocol_patient',
        to: normalizedPatientPhone,
        protocol,
        complaintId: result.insertId,
        message: `Seu protocolo ${protocol} foi registrado e sera acompanhado pela equipe responsavel.`
      });
    } catch (error) {
      console.warn('Nao foi possivel enviar protocolo ao paciente por WhatsApp:', error.message);
    }

    if (normalizedOrigin === 'Marketing') {
      try {
        await sendEmail(
          approvalEmail,
          `Protocolo ${protocol} registrado pelo Marketing`,
          `<p>Um novo protocolo foi registrado pelo link externo de Marketing.</p><p><strong>Paciente:</strong> ${patient_name}</p><p><strong>Protocolo:</strong> ${protocol}</p>`
        );
      } catch (error) {
        console.warn('Nao foi possivel enviar e-mail do protocolo de Marketing:', error.message);
      }

      try {
        await sendWhatsappNotification({
          event: 'marketing_protocol_created',
          protocol,
          complaintId: result.insertId,
          message: `Marketing registrou o protocolo ${protocol} para o paciente ${patient_name}.`
        });
      } catch (error) {
        console.warn('Nao foi possivel enviar WhatsApp do protocolo de Marketing:', error.message);
      }
    }

    res.json({
      message: 'Reclamação salva com sucesso',
      id: result.insertId,
      protocol
    });

  } catch (error) {
    console.error("ERRO:", error);
    res.status(500).json({ error: 'Erro ao salvar reclamação' });
  }
});

app.get('/complaints/:id', authenticate, async (req, res) => {
  try {
    const rows = await getComplaintRows({
      id: req.params.id,
      include_deleted: req.query.include_deleted || (canViewDeletedRecords(req.user) ? '1' : undefined)
    }, req.user);

    if (!rows.length) {
      return res.status(404).json({ error: 'Reclamação não encontrada' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar reclamação' });
  }
});

app.delete('/complaints/:id', authenticate, async (req, res) => {
  try {
    if (!canDeleteRecords(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master ou Supervisor do CRC pode excluir reclamações.' });
    }

    const reason = String(req.body?.reason || 'Exclusão administrativa').slice(0, 500);
    await pool.query(
      'UPDATE complaints SET deleted_at = NOW(), deleted_by = ?, deletion_reason = ? WHERE id = ?',
      [getActorName(req.user), reason, req.params.id]
    );
    await insertComplaintLog(req.params.id, 'excluido', `Reclamação excluída por ${getActorName(req.user)}. Motivo: ${reason}`, req.user);

    res.json({ message: 'Reclamação excluída com lastro de auditoria.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir reclamação.' });
  }
});

// ============================================
// ATUALIZAR RECLAMAÇÃO
// ============================================
app.post('/complaints/:id/evidences', authenticate, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { description } = req.body;

    if (!canAttachEvidence(req.user)) {
      return res.status(403).json({ error: 'Seu perfil nÃ£o pode anexar evidÃªncias nesta reclamaÃ§Ã£o.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Selecione um arquivo de evidÃªncia.' });
    }

    const complaints = await getComplaintRows({ id }, req.user);

    if (!complaints.length) {
      return res.status(404).json({ error: 'ReclamaÃ§Ã£o nÃ£o encontrada' });
    }

    const fileUrl = `${publicBaseUrl}/uploads/${req.file.filename}`;

    await pool.query(
      `INSERT INTO complaint_evidences
       (complaint_id, file_url, original_name, description, uploaded_by_name, uploaded_by_role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        fileUrl,
        req.file.originalname || null,
        description || null,
        getActorName(req.user),
        req.user.role || null
      ]
    );

    await insertComplaintLog(
      id,
      'evidence_added',
      description || req.file.originalname || 'Evidencia anexada ao protocolo.',
      req.user
    );

    res.status(201).json({ message: 'EvidÃªncia anexada com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao anexar evidÃªncia' });
  }
});

app.patch('/complaints/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      operator_comment,
      priority,
      supervisor_accept,
      sac_accept,
      patient_contacted,
      first_attendance,
      forward_to_role
    } = req.body;
    const rows = await getComplaintRows({ id }, req.user);

    if (!rows.length) {
      return res.status(404).json({ error: 'Reclamacao nao encontrada' });
    }

    const complaint = rows[0];
    const cleanedComment = typeof operator_comment === 'string' ? operator_comment.trim() : '';
    const hasCommentChange = Boolean(cleanedComment) && cleanedComment !== String(complaint.operator_comment || '').trim();
    const nextPriority = priority ? normalizePriority(priority) : normalizePriority(complaint.priority);
    const nextStatus = status || (cleanedComment && canAddTreatment(req.user) ? 'em_andamento' : complaint.status || 'aberta');
    const actorName = getActorName(req.user);
    const logEntries = [];
    const updates = [
      'status = ?',
      'operator_comment = ?',
      'priority = ?'
    ];
    const values = [
      nextStatus,
      cleanedComment || complaint.operator_comment || null,
      nextPriority
    ];

    if (priority && !complaint.deadline_locked_at) {
      const createdAt = complaint.created_at ? new Date(complaint.created_at) : new Date();
      const dueAt = new Date(createdAt);
      dueAt.setHours(dueAt.getHours() + deadlineHoursByPriority[nextPriority]);
      updates.push('due_at = ?');
      values.push(toMysqlDateTime(dueAt));
    }

    if (cleanedComment && canAddTreatment(req.user)) {
      updates.push('treatment_comment = ?');
      values.push(cleanedComment);
      updates.push('treatment_by_role = ?');
      values.push(req.user.role);
      updates.push('treatment_by_name = ?');
      values.push(actorName);
      updates.push('treatment_at = COALESCE(treatment_at, NOW())');
    }

    if (hasCommentChange) {
      logEntries.push({
        action: canAddTreatment(req.user) ? 'treatment_saved' : 'comment_saved',
        message: cleanedComment
      });
    }

    if (supervisor_accept) {
      if (!canSupervisorApprove(req.user)) {
        return res.status(403).json({ error: 'Somente o Supervisor do CRC pode registrar este aceite.' });
      }

      updates.push('supervisor_approval_at = COALESCE(supervisor_approval_at, NOW())');
      updates.push('supervisor_approval_by = ?');
      values.push(actorName);
      logEntries.push({
        action: 'supervisor_accept',
        message: 'Aceite de prioridade alta registrado.'
      });
    }

    if (sac_accept) {
      if (!canCloseComplaint(req.user)) {
        return res.status(403).json({ error: 'Somente o Operador de SAC pode registrar este aceite.' });
      }

      updates.push('sac_approval_at = COALESCE(sac_approval_at, NOW())');
      updates.push('sac_approval_by = ?');
      values.push(actorName);
    }

    if (patient_contacted) {
      if (!canMarkPatientContact(req.user)) {
        return res.status(403).json({ error: 'Somente o Operador de SAC pode registrar contato com o paciente.' });
      }

      updates.push('patient_contacted_at = COALESCE(patient_contacted_at, NOW())');
      updates.push('patient_contacted_by = COALESCE(patient_contacted_by, ?)');
      values.push(actorName);
      updates.push('patient_contacted_by_role = COALESCE(patient_contacted_by_role, ?)');
      values.push(req.user.role);
      logEntries.push({
        action: 'patient_contacted',
        message: 'Contato Realizado'
      });
    }

    if (first_attendance) {
      if (!canRegisterFirstAttendance(req.user)) {
        return res.status(403).json({ error: 'Somente Operador de SAC ou Administrador pode registrar o primeiro atendimento.' });
      }

      const allowedForwardRoles = {
        coordinator: 'Coordenador',
        manager: 'Gerente',
        supervisor_crc: 'Supervisor do CRC'
      };

      if (!allowedForwardRoles[forward_to_role]) {
        return res.status(400).json({ error: 'Selecione o responsável para a tratativa.' });
      }

      let assignment = null;
      let forwardedLabel = allowedForwardRoles[forward_to_role];

      if (forward_to_role === 'coordinator') {
        assignment = await resolveCoordinatorAssignment(complaint.clinic_id);
        forwardedLabel = complaint.assigned_coordinator_name || assignment.coordinatorName || allowedForwardRoles[forward_to_role];
      }

      updates.push('first_attendance_at = COALESCE(first_attendance_at, NOW())');
      updates.push('first_attendance_by = COALESCE(first_attendance_by, ?)');
      values.push(actorName);
      updates.push('first_attendance_by_role = COALESCE(first_attendance_by_role, ?)');
      values.push(req.user.role);
      updates.push('deadline_locked_at = COALESCE(deadline_locked_at, NOW())');
      updates.push('forwarded_to_role = ?');
      values.push(forward_to_role);
      updates.push('forwarded_to_label = ?');
      values.push(forwardedLabel);
      updates.push('forwarded_at = NOW()');
      updates.push('forwarded_by = ?');
      values.push(actorName);

      if (forward_to_role === 'coordinator' && !complaint.assigned_coordinator_name) {
        updates.push('assigned_coordinator_user_id = ?');
        values.push(assignment?.coordinatorUserId || null);
        updates.push('assigned_coordinator_name = ?');
        values.push(assignment?.coordinatorName || forwardedLabel);
        updates.push('clinic_snapshot_name = COALESCE(clinic_snapshot_name, ?)');
        values.push(assignment?.clinicSnapshotName || null);
      }

      logEntries.push({
        action: 'first_attendance_forwarded',
        message: `Primeiro atendimento registrado. Deadline travado e protocolo enviado para ${forwardedLabel}.`
      });
    }

    if (nextStatus === 'resolvida') {
      const hasTreatment = Boolean(complaint.treatment_at) || (cleanedComment && canAddTreatment(req.user));
      const treatmentRole = complaint.treatment_by_role || (canAddTreatment(req.user) ? req.user.role : null);
      const hasManagementTreatment = hasTreatment && (
        treatmentRoles.has(treatmentRole)
        || treatmentRole === 'admin'
        || treatmentRole === 'master_admin'
      );
      const hasSupervisorApproval = Boolean(complaint.supervisor_approval_at)
        || (supervisor_accept && canSupervisorApprove(req.user));

      if (!canCloseComplaint(req.user)) {
        return res.status(403).json({ error: 'Somente o Operador de SAC pode fechar uma reclamacao.' });
      }

      if (!hasManagementTreatment) {
        return res.status(409).json({
          error: 'Antes do fechamento, a reclamacao precisa ter tratativa registrada por Coordenador, Gerente ou Supervisor do CRC.'
        });
      }

      if (normalizePriority(nextPriority) === 'alta' && !hasSupervisorApproval) {
        return res.status(409).json({
          error: 'Reclamacoes de prioridade alta exigem aceite do Supervisor do CRC antes do fechamento pelo SAC.'
        });
      }

      updates.push('closed_at = NOW()');
      updates.push('closed_by_role = ?');
      values.push(req.user.role);
      updates.push('sac_approval_at = COALESCE(sac_approval_at, NOW())');
      updates.push('sac_approval_by = COALESCE(sac_approval_by, ?)');
      values.push(actorName);
      logEntries.push({
        action: 'closed',
        message: 'Protocolo encerrado na ficha executiva.'
      });
    } else {
      updates.push('closed_at = NULL');
      updates.push('closed_by_role = NULL');
    }

    values.push(id);

    await pool.query(
      `UPDATE complaints
       SET ${updates.join(', ')}
       WHERE id = ?`,
      values
    );

    await Promise.all(logEntries.map((entry) => (
      insertComplaintLog(id, entry.action, entry.message, req.user)
    )));

    res.json({ message: 'Reclamação atualizada com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar reclamação' });
  }
});

// ============================================
// DASHBOARD / BI
// ============================================
app.get('/dashboard/summary', async (req, res) => {
  try {
    const rows = await getComplaintRows(req.query);
    const total = rows.length;
    const resolved = rows.filter((row) => row.status === 'resolvida').length;

    res.json({
      total,
      abertas: rows.filter((row) => row.status === 'aberta').length,
      em_andamento: rows.filter((row) => row.status === 'em_andamento').length,
      resolvidas: resolved,
      taxa_resolucao: total ? Math.round((resolved / total) * 100) : 0,
      por_tipo: groupRows(rows, 'complaint_type'),
      por_clinica: groupRows(rows, 'clinic_name'),
      por_cidade: groupRows(rows, 'city'),
      por_estado: groupRows(rows, 'state'),
      por_regiao: groupRows(rows, 'region')
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao gerar dashboard' });
  }
});

app.get('/bi/complaints', authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await getComplaintRows(req.query);

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="reclamacoes.csv"');
      return res.send(toCsv(rows));
    }

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao gerar base de BI' });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'O arquivo deve ter no maximo 10 MB.' });
  }

  return next(error);
});

// ============================================
// START
// ============================================
async function startServer() {
  try {
    await ensureDatabaseSchema();
    console.log('Schema validado para gestão GRC');
  } catch (error) {
    console.warn('Não foi possível validar o schema do banco:', error.message);
  }

  try {
    await ensureDefaultAdminUser();
    console.log('Administrador Master validado');
  } catch (error) {
    console.warn('Não foi possível validar o Administrador Master:', error.message);
  }

  try {
    await ensureDefaultClinics();
    await backfillComplaintProtocols();
    await backfillNpsProtocols();
    await backfillPatientProtocols();
    await backfillComplaintDeadlines();
    await backfillComplaintAssignments();
    console.log('Backfills operacionais validados');
  } catch (error) {
    console.warn('Não foi possível executar os backfills:', error.message);
  }

  app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

  setTimeout(() => {
    runScheduledCoordinatorReports().catch((jobError) => {
      console.warn('NÃ£o foi possÃ­vel executar a rotina inicial de relatÃ³rios:', jobError.message);
    });
  }, 3000);

  setInterval(() => {
    runScheduledCoordinatorReports().catch((jobError) => {
      console.warn('NÃ£o foi possÃ­vel executar a rotina programada de relatÃ³rios:', jobError.message);
    });
  }, 15 * 60 * 1000);

}

startServer();
