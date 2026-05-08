// ============================================
// IMPORTAÇÕES
// ============================================
require('dotenv').config({ quiet: true });

const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { performance } = require('perf_hooks');
const { z } = require('zod');
const { clinicSeed, legacyDefaultClinicNames } = require('./clinicSeed');
const emailService = require('./services/emailService');
const {
  sendComplaintNotification: sendTwilioComplaintNotification,
  sendGenericNotification: sendTwilioGenericNotification,
  sendNpsNotification: sendTwilioNpsNotification,
  normalizePhoneNumber: normalizeTwilioPhoneNumber,
  getTwilioConfigStatus
} = require('./services/twilioWhatsAppService');
const {
  buildAppointmentReminderMessage,
  buildNoShowAlertMessage,
  buildPasswordChangeUrl,
  getWhatsAppProvider,
  isWhatsAppEnabled,
  normalizeWhatsAppPhone,
  sendApprovalWhatsApp,
  sendAppointmentReminder,
  sendNoShowAlert,
  sendPasswordResetWhatsApp,
  sendWelcomeWhatsApp,
  sendWhatsAppMessage
} = require('./services/whatsappService');
const { generateTemporaryPassword } = require('./utils/password');

const app = express();
const serverStartedAt = new Date();

// ============================================
// CONFIG
// ============================================
const PORT = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const defaultPublicBaseUrl = process.env.RENDER_EXTERNAL_URL
  || (process.env.NODE_ENV === 'production'
    ? 'https://meu-sistema-nps-backend.onrender.com'
    : `http://localhost:${PORT}`);
const configuredPublicBaseUrl = String(process.env.PUBLIC_API_URL || '').trim();
const publicBaseUrl = process.env.NODE_ENV === 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configuredPublicBaseUrl)
  ? defaultPublicBaseUrl
  : configuredPublicBaseUrl || defaultPublicBaseUrl;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const appBaseUrl = process.env.APP_BASE_URL || frontendUrl;
const approvalEmail = process.env.APPROVAL_EMAIL || 'henrique.martins@grcconsultoria.net.br';
const masterAdminEmail = (process.env.MASTER_ADMIN_EMAIL || 'henrique.martins@grcconsultoria.net.br').toLowerCase();
const masterAdminWhatsapp = normalizeBrazilPhone(process.env.MASTER_ADMIN_WHATSAPP || '');
const defaultAdminEmail = masterAdminEmail;
const defaultAdminPassword = process.env.MASTER_ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || 'Zyck1987#';
// Numeros fixos que recebem apenas alertas de RECLAMACAO. Altere aqui se a regra de escalonamento mudar.
const fixedComplaintWhatsAppRecipients = ['5562996807670', '556299669966'];
// Twilio nao envia para ID de grupo do WhatsApp. Use esta lista como broadcast oficial para os participantes do grupo.
const complaintWhatsappGroupRecipients = parsePhoneRecipientList(process.env.COMPLAINT_WHATSAPP_GROUP_RECIPIENTS || process.env.WHATSAPP_GROUP_RECIPIENTS || '');
const requirePasswordChangeOnFirstLogin = String(process.env.REQUIRE_PASSWORD_CHANGE_ON_FIRST_LOGIN || 'true').toLowerCase() !== 'false';
const appointmentReminderLeadHours = Math.max(1, Number(process.env.APPOINTMENT_REMINDER_LEAD_HOURS || 24));
const appointmentReminderIntervalMinutes = Math.max(5, Number(process.env.APPOINTMENT_REMINDER_INTERVAL_MINUTES || 30));
const complaintDueReminderIntervalMinutes = Math.max(5, Number(process.env.COMPLAINT_REMINDER_INTERVAL_MINUTES || 30));
const complaintExpiredReminderIntervalHours = Math.max(1, Number(process.env.COMPLAINT_EXPIRED_REMINDER_INTERVAL_HOURS || 6));
const weeklyDemandReminderEnabled = String(process.env.WEEKLY_DEMAND_REMINDER_ENABLED || 'true').trim().toLowerCase() !== 'false';
const weeklyDemandReminderIntervalMinutes = Math.max(5, Number(process.env.WEEKLY_DEMAND_REMINDER_INTERVAL_MINUTES || 15));
const weeklyDemandReminderDay = Math.min(6, Math.max(0, Number(process.env.WEEKLY_DEMAND_REMINDER_DAY || 1)));
const weeklyDemandReminderHour = Math.min(23, Math.max(0, Number(process.env.WEEKLY_DEMAND_REMINDER_HOUR || 8)));
const weeklyDemandReminderTimeZone = String(process.env.WEEKLY_DEMAND_REMINDER_TIMEZONE || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';
const passwordRecoveryCodeExpiresMinutes = Math.max(5, Number(process.env.PASSWORD_RECOVERY_CODE_EXPIRES_MINUTES || 15));
const vercelApiToken = String(process.env.VERCEL_API_TOKEN || '').trim();
const vercelProjectId = String(process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_SLUG || '').trim();
const vercelTeamId = String(process.env.VERCEL_TEAM_ID || '').trim();
const railwayApiToken = String(process.env.RAILWAY_API_TOKEN || '').trim();
const railwayProjectAccessToken = String(process.env.RAILWAY_PROJECT_ACCESS_TOKEN || '').trim();
const railwayProjectId = String(process.env.RAILWAY_PROJECT_ID || '').trim();
const railwayEnvironmentId = String(process.env.RAILWAY_ENVIRONMENT_ID || '').trim();
const railwayServiceId = String(process.env.RAILWAY_SERVICE_ID || '').trim();
const railwayApiUrl = String(process.env.RAILWAY_API_URL || 'https://backboard.railway.app/graphql/v2').trim();
const uploadDir = path.join(__dirname, 'uploads');
const reportsDir = path.join(uploadDir, 'reports');
const maxUploadSizeBytes = 10 * 1024 * 1024;
const configuredAllowedOrigins = Array.from(new Set([
  frontendUrl,
  ...String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  'http://localhost:3000',
  'https://meu-sistema-nps.vercel.app',
  'https://grcconsultoria.net.br',
  'https://www.grcconsultoria.net.br'
]));

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(reportsDir, { recursive: true });

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (configuredAllowedOrigins.includes(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*grcconsultoria\.net\.br$/i.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i.test(origin)) return true;

  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === 'grcconsultoria.net.br'
      || hostname === 'www.grcconsultoria.net.br'
      || hostname.endsWith('.vercel.app')
      || hostname.endsWith('.grcconsultoria.net.br');
  } catch (error) {
    return false;
  }
}

// ============================================
// MIDDLEWARES
// ============================================
app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: false
}));

app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin) ? (origin || true) : false),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.get(/^\/uploads\/(.+)$/, servePersistedUploadedFile);

const initialPasswordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas de troca de senha. Aguarde alguns minutos e tente novamente.'
  }
});

const passwordRecoveryRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas solicitações de recuperação de senha. Aguarde alguns minutos e tente novamente.'
  }
});

// ============================================
// CONFIGURAÇÃO DE UPLOAD (CORRETA)
// ============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${getSafeUploadExtension(file)}`);
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
  crm_relationship: 'CRM de relacionamento',
  admin_panel: 'Painel gerencial'
};

const deadlineHoursByPriority = {
  baixa: 72,
  media: 48,
  alta: 24
};
const resolutionSlaDays = 15;
const patientInteractionTypeLabels = {
  confirmacao: 'Confirmação',
  agendamento: 'Agendamento',
  reagendamento: 'Reagendamento'
};

function isNoShowStatus(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase() === 'naocompareceu';
}

const treatmentRoles = new Set(['coordinator', 'manager', 'supervisor_crc']);
const evidenceRoles = new Set(['coordinator', 'manager', 'supervisor_crc', 'sac_operator', 'admin']);
const complaintUnitChangeRoles = new Set(['master_admin', 'supervisor_crc', 'sac_operator']);
let uploadedFilesTableReady = false;

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

function generateVerificationCode(length = 6) {
  return Array.from({ length }, () => String(crypto.randomInt(0, 10))).join('');
}

function normalizeStoredUploadUrl(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue || /^data:/i.test(rawValue)) {
    return rawValue;
  }

  const normalizedValue = rawValue.replace(/\\/g, '/');
  const uploadIndex = normalizedValue.toLowerCase().indexOf('/uploads/');
  const normalizeUploadPath = (pathname) => {
    const normalizedPath = String(pathname || '').replace(/\\/g, '/').trim();

    if (!normalizedPath) {
      return '';
    }

    return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  };

  if (/^https?:\/\//i.test(normalizedValue)) {
    try {
      const parsed = new URL(normalizedValue);
      if (parsed.pathname.toLowerCase().startsWith('/uploads/')) {
        return normalizeUploadPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
      }
      return normalizedValue;
    } catch (error) {
      return normalizedValue;
    }
  }

  if (uploadIndex >= 0) {
    return normalizeUploadPath(normalizedValue.slice(uploadIndex));
  }

  if (normalizedValue.toLowerCase().startsWith('uploads/')) {
    return normalizeUploadPath(normalizedValue);
  }

  return normalizedValue;
}

function resolveStoredUploadFilePath(value) {
  const normalizedValue = normalizeStoredUploadUrl(value);

  if (!normalizedValue || !normalizedValue.toLowerCase().startsWith('/uploads/')) {
    return '';
  }

  const pathWithoutQuery = normalizedValue.split(/[?#]/)[0];
  const relativePath = pathWithoutQuery.replace(/^\/uploads\//i, '');

  if (!relativePath) {
    return '';
  }

  let decodedPath = relativePath;

  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch (error) {
    decodedPath = relativePath;
  }

  const safeSegments = decodedPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);

  if (!safeSegments.length || safeSegments.some((segment) => segment === '..')) {
    return '';
  }

  const resolvedPath = path.resolve(uploadDir, ...safeSegments);
  const resolvedUploadDir = path.resolve(uploadDir);

  if (!resolvedPath.startsWith(`${resolvedUploadDir}${path.sep}`)) {
    return '';
  }

  return resolvedPath;
}

function getStoredUploadFilename(value) {
  const normalizedValue = normalizeStoredUploadUrl(value);

  if (!normalizedValue || !normalizedValue.toLowerCase().startsWith('/uploads/')) {
    return '';
  }

  const pathWithoutQuery = normalizedValue.split(/[?#]/)[0];
  const relativePath = pathWithoutQuery.replace(/^\/uploads\//i, '');

  if (!relativePath) {
    return '';
  }

  let decodedPath = relativePath;

  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch (error) {
    decodedPath = relativePath;
  }

  const safeSegments = decodedPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);

  if (!safeSegments.length || safeSegments.some((segment) => segment === '..')) {
    return '';
  }

  return safeSegments[safeSegments.length - 1] || '';
}

function buildInlineContentDisposition(filename) {
  const safeFilename = String(filename || 'arquivo')
    .replace(/[\r\n"]/g, '')
    .trim() || 'arquivo';

  return `inline; filename="${safeFilename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`;
}

async function ensureUploadedFilesTable() {
  if (uploadedFilesTableReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploaded_files (
      filename VARCHAR(255) PRIMARY KEY,
      original_name VARCHAR(255) NULL,
      mime_type VARCHAR(120) NULL,
      size_bytes INT UNSIGNED NULL,
      content LONGBLOB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  uploadedFilesTableReady = true;
}

async function persistUploadedFile(file) {
  if (!file?.filename || !file?.path) {
    return null;
  }

  await ensureUploadedFilesTable();

  const content = await fs.promises.readFile(file.path);
  const originalName = normalizeUploadedOriginalName(file) || file.originalname || file.filename;

  await pool.query(
    `INSERT INTO uploaded_files
       (filename, original_name, mime_type, size_bytes, content)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       original_name = VALUES(original_name),
       mime_type = VALUES(mime_type),
       size_bytes = VALUES(size_bytes),
       content = VALUES(content),
       updated_at = CURRENT_TIMESTAMP`,
    [
      file.filename,
      originalName || null,
      file.mimetype || 'application/octet-stream',
      Number(file.size || content.length || 0),
      content
    ]
  );

  return {
    filename: file.filename,
    originalName,
    sizeBytes: Number(file.size || content.length || 0)
  };
}

async function deletePersistedUploadedFile(value) {
  const filename = getStoredUploadFilename(value);

  if (!filename) {
    return;
  }

  await ensureUploadedFilesTable();

  await pool.query('DELETE FROM uploaded_files WHERE filename = ?', [filename]);
}

async function servePersistedUploadedFile(req, res, next) {
  try {
    const requestedPath = req.params?.[0]
      || req.path.replace(/^\/uploads\//i, '')
      || req.originalUrl.replace(/^\/uploads\//i, '').split(/[?#]/)[0];
    const filename = getStoredUploadFilename(`/uploads/${requestedPath}`);

    if (!filename) {
      return res.status(404).send('Arquivo não encontrado.');
    }

    await ensureUploadedFilesTable();

    const [rows] = await pool.query(
      `SELECT filename, original_name, mime_type, size_bytes, content
         FROM uploaded_files
        WHERE filename = ?
        LIMIT 1`,
      [filename]
    );

    const file = rows[0];

    if (!file?.content) {
      return res.status(404).send('Arquivo não encontrado.');
    }

    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    const displayName = file.original_name || file.filename || filename;

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', file.size_bytes || content.length);
    res.setHeader('Content-Disposition', buildInlineContentDisposition(displayName));
    res.setHeader('Cache-Control', 'private, max-age=3600');

    return res.send(content);
  } catch (error) {
    return next(error);
  }
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
  return user?.role === 'master_admin' || email === masterAdminEmail;
}

function defaultPermissionsForRole(role) {
  if (role === 'master_admin' || role === 'admin') {
    return Object.keys(screenPermissions);
  }

  if (role === 'sac_operator') {
    return ['home', 'complaints_register', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'crm_relationship'];
  }

  if (['supervisor_crc', 'coordinator', 'manager'].includes(role)) {
    return ['home', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'patient_management', 'crm_relationship'];
  }

  return ['home', 'complaints_management', 'nps_management'];
}

function canAttachEvidence(user) {
  return evidenceRoles.has(user?.role) || isAdminUser(user);
}

function canDeleteEvidence(user) {
  return Boolean(user?.id || user?.email || user?.role);
}

function canChangeComplaintUnit(user) {
  return complaintUnitChangeRoles.has(user?.role) || isMasterAdminUser(user);
}

function canEditComplaintPatientPhone(user) {
  return ['sac_operator', 'supervisor_crc', 'master_admin'].includes(user?.role) || isMasterAdminUser(user);
}

function canAddTreatment(user) {
  return treatmentRoles.has(user?.role) || isAdminUser(user);
}

function canCloseComplaint(user) {
  return ['master_admin', 'supervisor_crc', 'sac_operator'].includes(user?.role) || isMasterAdminUser(user);
}

function canSupervisorApprove(user) {
  return user?.role === 'supervisor_crc' || isAdminUser(user);
}

function canMarkPatientContact(user) {
  return ['master_admin', 'supervisor_crc', 'sac_operator'].includes(user?.role) || isMasterAdminUser(user);
}

function canRegisterFirstAttendance(user) {
  return ['master_admin', 'supervisor_crc', 'sac_operator'].includes(user?.role) || isMasterAdminUser(user);
}

function canDeleteRecords(user) {
  return isMasterAdminUser(user) || user?.role === 'supervisor_crc';
}

function canReactivateComplaint(user) {
  return isMasterAdminUser(user) || user?.role === 'supervisor_crc';
}

function canRenotifyComplaint(user) {
  return isMasterAdminUser(user) || user?.role === 'supervisor_crc' || user?.role === 'sac_operator';
}

function canViewDeletedRecords(user) {
  return isMasterAdminUser(user);
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

function parsePhoneRecipientList(value) {
  return Array.from(new Set(
    String(value || '')
      .split(/[,\n;]+/)
      .map((item) => normalizeTwilioPhoneNumber(item))
      .filter(Boolean)
      .map((item) => item.replace(/^whatsapp:/i, ''))
  ));
}

function isCompleteBrazilPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 13 && digits.startsWith('55');
}

const sensitiveActivityKeys = new Set([
  'password',
  'current_password',
  'new_password',
  'token',
  'authorization',
  'jwt',
  'secret',
  'smtp_pass',
  'db_password'
]);

function getUserEmailTarget(user) {
  return String(user?.email || '').trim().toLowerCase();
}

function getUserWhatsappTarget(user) {
  const normalized = normalizeBrazilPhone(user?.whatsapp || user?.phone || '');
  return isCompleteBrazilPhone(normalized) ? normalized : '';
}

function buildNotificationHtml(message, link) {
  const messageHtml = String(message || '').replace(/\n/g, '<br />');
  const actionLink = link || frontendUrl;
  return emailService.renderBrandedEmail({
    title: 'Atualização do sistema',
    intro: 'Olá,',
    bodyHtml: `
      <p style="margin:0 0 18px;">${messageHtml}</p>
      ${actionLink ? `<p style="margin:0;"><strong>Link direto:</strong> <a href="${actionLink}" style="color:#a56a09;text-decoration:none;">${actionLink}</a></p>` : ''}
    `,
    actionLabel: actionLink ? 'Abrir no sistema' : '',
    actionUrl: actionLink || '',
    footerText: 'O acesso ao conteúdo continua protegido por login e senha. Se você não reconhece esta mensagem, procure o Administrador Master.'
  });
}

function formatMessageDateTime(value) {
  if (!value) return 'Não informado';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function sanitizeActivityValue(value, key = '') {
  if (value === null || value === undefined) return value;
  if (sensitiveActivityKeys.has(String(key || '').toLowerCase())) return '[redacted]';
  if (Array.isArray(value)) return value.slice(0, 15).map((item) => sanitizeActivityValue(item));
  if (typeof value === 'object') {
    return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
      acc[entryKey] = sanitizeActivityValue(entryValue, entryKey);
      return acc;
    }, {});
  }

  const text = String(value);
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function shouldEmailMasterForActivity(req) {
  return false;
}

function shouldRecordSystemActivity(req) {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  const method = String(req.method || '').toUpperCase();

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return false;
  }

  const route = String(req.originalUrl || req.path || '').split('?')[0];
  if (!route || route.startsWith('/uploads')) return false;
  if (route === '/api/test-whatsapp/status') return false;

  return true;
}

function buildSystemActivityAction(req) {
  const method = String(req.method || '').toUpperCase();
  const route = String(req.originalUrl || req.path || '').split('?')[0];

  if (route === '/login') return 'Login';
  if (route.includes('/auth/request-password-reset')) return 'Solicitação de código de senha';
  if (route.includes('/auth/reset-password-with-code')) return 'Redefinição de senha';
  if (route.includes('/complaints') && route.includes('/evidences')) return method === 'DELETE' ? 'Exclusão de evidência' : 'Envio de evidência';
  if (route.includes('/complaints') && method === 'POST') return 'Registro de protocolo';
  if (route.includes('/complaints') && method === 'PATCH') return 'Atualização de protocolo';
  if (route.includes('/complaints') && method === 'DELETE') return 'Exclusão de protocolo';
  if (route.includes('/nps/bulk-dispatch')) return 'Disparo de NPS';
  if (route.includes('/nps') && method === 'POST') return 'Registro de NPS';
  if (route.includes('/nps') && method === 'PATCH') return 'Tratativa de NPS';
  if (route.includes('/nps') && method === 'DELETE') return 'Exclusão de NPS';
  if (route.includes('/patient-interactions')) return method === 'POST' ? 'Registro de relacionamento' : 'Atualização de relacionamento';
  if (route.includes('/admin/users') && method === 'POST') return 'Criação de usuário';
  if (route.includes('/admin/users') && method === 'PATCH') return 'Atualização de usuário';
  if (route.includes('/admin/users') && method === 'DELETE') return 'Exclusão de usuário';
  if (route.includes('/registration-requests')) return 'Solicitação/Aprovação de acesso';
  if (route.includes('/profile/change-password') || route.includes('/change-initial-password')) return 'Alteração de senha';
  if (route.includes('/api/test-email')) return 'Teste de e-mail';
  if (route.includes('/api/test-whatsapp')) return 'Teste de WhatsApp';

  return `${method} ${route}`;
}

function buildSystemActivitySummary(req, responseBody) {
  const route = String(req.originalUrl || req.path || '').split('?')[0];
  const responseSummary = responseBody?.message || responseBody?.error || responseBody?.protocol || responseBody?.id;

  if (responseSummary) {
    return String(responseSummary).slice(0, 500);
  }

  return `Movimentação executada em ${route || 'rota não identificada'}.`;
}

function compactPayload(value) {
  const sanitized = sanitizeActivityValue(value || {});
  const text = JSON.stringify(sanitized);
  return text && text.length > 4000 ? `${text.slice(0, 3997)}...` : text;
}

async function insertSystemActivityLog(req, res, responseBody, durationMs) {
  try {
    const route = String(req.originalUrl || req.path || '').split('?')[0] || '/';
    const fileInfo = req.file
      ? {
        original_name: normalizeUploadedOriginalName(req.file),
        stored_name: req.file.filename,
        size_bytes: req.file.size
      }
      : null;
    const requestPayload = {
      body: req.body || {},
      params: req.params || {},
      query: req.query || {},
      file: fileInfo
    };

    await pool.query(
      `INSERT INTO system_activity_logs
       (method, route, status_code, actor_user_id, actor_name, actor_email, actor_role, action, summary, request_payload, response_payload, ip_address, user_agent, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(req.method || '').toUpperCase(),
        route,
        res.statusCode || null,
        req.user?.id || null,
        req.user?.name || null,
        req.user?.email || null,
        req.user?.role || null,
        buildSystemActivityAction(req),
        buildSystemActivitySummary(req, responseBody),
        compactPayload(requestPayload),
        compactPayload(responseBody || {}),
        getRequestIp(req),
        String(req.headers['user-agent'] || '').slice(0, 500) || null,
        Math.max(0, Math.round(durationMs || 0))
      ]
    );
  } catch (error) {
    console.warn('Não foi possível gravar auditoria central:', error.message);
  }
}

function installSystemActivityLogger() {
  app.use((req, res, next) => {
    if (!shouldRecordSystemActivity(req)) {
      return next();
    }

    const startedAt = performance.now();
    let responseBody;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };

    res.send = (body) => {
      if (responseBody === undefined) {
        responseBody = normalizeActivityResponseBody(body);
      }

      return originalSend(body);
    };

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 500) return;

      setImmediate(() => {
        insertSystemActivityLog(req, res, normalizeActivityResponseBody(responseBody), performance.now() - startedAt);
      });
    });

    return next();
  });
}

function buildActivityActorLabel(req) {
  if (req.user) {
    return `${req.user.name || 'Usuario'} (${req.user.email || req.user.role || 'sem e-mail'})`;
  }

  const login = String(req.body?.email || req.body?.username || '').trim().toLowerCase();
  if (login) return `Acesso externo (${login})`;
  return 'Origem externa';
}

function buildActivityEmailHtml(req, responseBody) {
  const createdAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo'
  }).format(new Date());
  const sanitizedBody = sanitizeActivityValue(req.body || {});
  const sanitizedParams = sanitizeActivityValue(req.params || {});
  const sanitizedQuery = sanitizeActivityValue(req.query || {});
  const sanitizedResponse = sanitizeActivityValue(responseBody || {});
  const fileInfo = req.file
    ? { original_name: normalizeUploadedOriginalName(req.file), size_bytes: req.file.size }
    : null;
  const redirectLocation = typeof req.res?.getHeader === 'function'
    ? req.res.getHeader('Location')
    : null;

  return `
    <h2>Nova movimentacao registrada no Sistema GRC</h2>
    <p><strong>Data/Hora:</strong> ${createdAt} (Brasilia)</p>
    <p><strong>Usuario:</strong> ${buildActivityActorLabel(req)}</p>
    <p><strong>Metodo:</strong> ${req.method}</p>
    <p><strong>Rota:</strong> ${req.originalUrl}</p>
    <p><strong>Status HTTP:</strong> ${req.res?.statusCode || 0}</p>
    <p><strong>IP:</strong> ${getRequestIp(req)}</p>
    <p><strong>Resumo:</strong> ${sanitizeActivityValue(responseBody?.message || responseBody?.error || 'Movimentacao concluida.')}</p>
    ${redirectLocation ? `<p><strong>Destino:</strong> ${sanitizeActivityValue(redirectLocation)}</p>` : ''}
    <p><strong>Body:</strong></p>
    <pre>${JSON.stringify(sanitizedBody, null, 2)}</pre>
    <p><strong>Params:</strong></p>
    <pre>${JSON.stringify(sanitizedParams, null, 2)}</pre>
    <p><strong>Query:</strong></p>
    <pre>${JSON.stringify(sanitizedQuery, null, 2)}</pre>
    ${fileInfo ? `<p><strong>Arquivo:</strong></p><pre>${JSON.stringify(fileInfo, null, 2)}</pre>` : ''}
    <p><strong>Resposta:</strong></p>
    <pre>${JSON.stringify(sanitizedResponse, null, 2)}</pre>
  `;
}

function buildActivityEmailSubject(req, responseBody) {
  const route = String(req.path || req.originalUrl || 'rota-nao-informada').split('?')[0] || '/';
  const summary = sanitizeActivityValue(responseBody?.message || 'Movimentacao registrada');
  return `Sistema GRC | ${req.method} ${route} | ${summary}`.slice(0, 190);
}

function buildActivityWhatsAppMessage(req, responseBody) {
  const createdAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  }).format(new Date());
  const summary = sanitizeActivityValue(responseBody?.message || responseBody?.error || 'Movimentação concluída.');

  return [
    'Nova movimentação registrada no Sistema GRC',
    `Data/Hora: ${createdAt} (Brasília)`,
    `Usuário: ${buildActivityActorLabel(req)}`,
    `Método: ${req.method}`,
    `Rota: ${req.originalUrl}`,
    `Status HTTP: ${req.res?.statusCode || 0}`,
    `Resumo: ${summary}`
  ].join('\n');
}

async function getMasterAdminNotificationTarget() {
  let email = masterAdminEmail;
  let whatsapp = masterAdminWhatsapp;

  if (process.env.NODE_ENV === 'test') {
    return { email, whatsapp };
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, whatsapp, phone
         FROM users
        WHERE deleted_at IS NULL
          AND LOWER(email) = ?
        ORDER BY active DESC, id ASC
        LIMIT 1`,
      [masterAdminEmail]
    );
    const masterUser = rows[0];

    if (masterUser) {
      email = getUserEmailTarget(masterUser) || email;
      whatsapp = getUserWhatsappTarget(masterUser) || whatsapp;
    }
  } catch (error) {
    console.warn('Não foi possível carregar o destinatário do Administrador Master:', error.message);
  }

  return { email, whatsapp };
}

async function sendMasterActivityNotifications(req, responseBody) {
  const recipient = await getMasterAdminNotificationTarget();
  const subject = buildActivityEmailSubject(req, responseBody);
  const html = buildActivityEmailHtml(req, responseBody);
  const whatsappMessage = buildActivityWhatsAppMessage(req, responseBody);
  const link = frontendUrl;
  const tasks = [];

  if (recipient.email) {
    tasks.push(
      sendEmail(recipient.email, subject, html).catch((error) => {
        console.warn('Não foi possível enviar a auditoria por e-mail ao Administrador Master:', error.message);
      })
    );
  }

  if (recipient.whatsapp && isWhatsAppEnabled()) {
    tasks.push(
      sendWhatsappNotification({
        event: 'master_activity_audit',
        to: recipient.whatsapp,
        link,
        route: req.originalUrl,
        method: req.method,
        message: `${whatsappMessage}\n\nAcesse: ${link}`
      }).catch((error) => {
        console.warn('Não foi possível enviar a auditoria por WhatsApp ao Administrador Master:', error.message);
      })
    );
  }

  await Promise.all(tasks);
}

function normalizeActivityResponseBody(body) {
  if (body === undefined || body === null) return null;

  if (Buffer.isBuffer(body)) {
    return `[buffer ${body.length} bytes]`;
  }

  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (error) {
      return body;
    }
  }

  return body;
}

function installMasterActivityEmailNotifier() {
  app.use((req, res, next) => {
    if (!masterAdminEmail || !shouldEmailMasterForActivity(req)) {
      return next();
    }

    let responseBody;
    let notificationSent = false;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };

    res.send = (body) => {
      if (responseBody === undefined) {
        responseBody = body;
      }

      return originalSend(body);
    };

    res.on('finish', () => {
      if (notificationSent) return;
      notificationSent = true;

      if (res.statusCode < 200 || res.statusCode >= 400) return;

      const normalizedResponse = normalizeActivityResponseBody(responseBody);

      setImmediate(async () => {
        try {
          await sendMasterActivityNotifications(req, normalizedResponse);
        } catch (error) {
          console.warn('Não foi possível enviar a auditoria ao Administrador Master:', error.message);
        }
      });
    });

    return next();
  });
}

installMasterActivityEmailNotifier();
installSystemActivityLogger();

function decodePossiblyLatin1Text(value) {
  const text = String(value || '');

  if (!text) return '';
  if (!/[\u00c3\u00c2\u0192\u00e2\u00c5\u00f0\ufffd]/u.test(text)) return text;

  const windows1252Map = new Map([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
    [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
    [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
    [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
    [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]
  ]);

  const markerCount = (input) => (input.match(/[\u00c3\u00c2\u0192\u00e2\u00c5\u00f0\ufffd]/gu) || []).length;

  const toWindows1252Buffer = (input) => {
    const bytes = [];

    for (const ch of input) {
      const code = ch.codePointAt(0);

      if (windows1252Map.has(code)) {
        bytes.push(windows1252Map.get(code));
      } else if (code <= 0xff) {
        bytes.push(code);
      } else {
        return null;
      }
    }

    return Buffer.from(bytes);
  };

  let normalized = text;

  for (let index = 0; index < 4; index += 1) {
    const bytes = toWindows1252Buffer(normalized);

    if (!bytes) break;

    const candidate = bytes.toString('utf8');

    if (markerCount(candidate) < markerCount(normalized)) {
      normalized = candidate;
      continue;
    }

    break;
  }

  return normalized
    .replaceAll('\u00c3\u00b0\u0178\u201d\u201d', '🔔')
    .replaceAll('\u00c3\u00b0\u00c5\u00b8\u00e2\u20ac\u009d\u00e2\u20ac\u009d', '🔔')
    .replaceAll('\u00c3\u00a2\u00c5\u00a1\u00e2\u201e\u00a2', '⚙')
    .replaceAll('\u00c3\u201a\u00c2\u00b7', '·')
    .replaceAll('\u00c2\u00b7', '·');
}

function decodeWindows1252Buffer(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'binary');
  const map = {
    0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
    0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
    0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
    0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ'
  };

  let decoded = '';

  for (const byte of bytes) {
    decoded += map[byte] || String.fromCharCode(byte);
  }

  return decoded;
}

function textEncodingDamageScore(value) {
  const text = String(value || '');
  const replacementCount = (text.match(/\ufffd/g) || []).length;
  const mojibakeCount = (text.match(/[\u00c3\u00c2\u0192\u00e2\u00c5\u00f0]/gu) || []).length;
  const controlCount = (text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g) || []).length;

  return (replacementCount * 5) + (mojibakeCount * 2) + (controlCount * 3);
}

function decodeUploadedText(value) {
  if (Buffer.isBuffer(value)) {
    const utf8Text = decodePossiblyLatin1Text(value.toString('utf8')).replace(/^\uFEFF/, '');
    const windows1252Text = decodePossiblyLatin1Text(decodeWindows1252Buffer(value)).replace(/^\uFEFF/, '');

    return textEncodingDamageScore(windows1252Text) < textEncodingDamageScore(utf8Text)
      ? windows1252Text
      : utf8Text;
  }

  return decodePossiblyLatin1Text(value).replace(/^\uFEFF/, '');
}

function decodeUploadNameCandidate(value, encoding) {
  try {
    return decodePossiblyLatin1Text(Buffer.from(String(value || ''), encoding).toString('utf8'));
  } catch (error) {
    return '';
  }
}

function normalizeUploadedOriginalName(file) {
  const originalName = String(file?.originalname || '').trim();

  if (!originalName) {
    return '';
  }

  const candidates = [
    decodePossiblyLatin1Text(originalName),
    decodeUploadNameCandidate(originalName, 'latin1'),
    decodeUploadNameCandidate(originalName, 'binary')
  ].filter(Boolean);

  const normalized = candidates.reduce((best, candidate) => {
    const candidateScore = textEncodingDamageScore(candidate);
    const bestScore = textEncodingDamageScore(best);

    if (candidateScore < bestScore) {
      return candidate;
    }

    if (candidateScore === bestScore && /[\u00c3\u00c2\u0192\u00e2\u00c5\u00f0\ufffd]/u.test(best) && candidate !== best) {
      return candidate;
    }

    return best;
  }, originalName);

  return normalized
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSafeUploadExtension(file) {
  const normalizedName = normalizeUploadedOriginalName(file) || file?.originalname || '';
  const extension = path.extname(normalizedName).toLowerCase().replace(/[^.a-z0-9]/g, '');

  return extension || '';
}

function normalizeClinicLookupValue(value) {
  return decodePossiblyLatin1Text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildClinicLookupKey(clinic) {
  return [
    normalizeClinicLookupValue(clinic?.name),
    normalizeClinicLookupValue(clinic?.city),
    normalizeClinicLookupValue(clinic?.state)
  ].join('|');
}

function buildClinicCatalogCode(clinic) {
  return [
    normalizeClinicLookupValue(clinic?.name),
    normalizeClinicLookupValue(clinic?.city),
    normalizeClinicLookupValue(clinic?.state)
  ]
    .filter(Boolean)
    .join('-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 220);
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
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseBulkNpsCsv(content) {
  const normalizedContent = decodeUploadedText(content);
  const lines = normalizedContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeColumnName);
  const nameIndex = headers.findIndex((header) => ['nome', 'paciente', 'patient_name'].includes(header));
  const phoneIndex = headers.findIndex((header) => [
    'telefone',
    'whatsapp',
    'telefone / whatsapp',
    'telefone_whatsapp',
    'telefone whatsapp',
    'telefone/whatsapp',
    'patient_phone'
  ].includes(header));

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

const adminUserCreateSchema = z.object({
  name: z.string().trim().min(1, 'Preencha o nome completo.').max(160),
  email: z.string().trim().email('Informe um e-mail válido.').max(180),
  role: z.string().trim().min(1, 'Informe o perfil de acesso.').max(60),
  position: z.string().trim().min(1, 'Informe o cargo.').max(160),
  phone: z.string().trim().min(1, 'Informe o telefone.').max(40),
  whatsapp: z.string().trim().min(1, 'Informe o WhatsApp.').max(40),
  department: z.string().trim().max(160).optional().or(z.literal('')).or(z.null()),
  permissions: z.array(z.string().trim().min(1)).max(50).optional(),
  clinicIds: z.array(z.union([z.string(), z.number()])).max(200).optional()
});

const changeInitialPasswordSchema = z.object({
  current_password: z.string().trim().min(1, 'Informe a senha atual.').max(160),
  new_password: z.string().trim().min(8, 'A nova senha deve ter no mínimo 8 caracteres.').max(160)
});

const testEmailSchema = z.object({
  to: z.string().trim().email('Informe um e-mail de destino válido.').optional(),
  name: z.string().trim().max(160).optional(),
  loginEmail: z.string().trim().email('Informe um login válido.').optional(),
  password: z.string().trim().min(8, 'A senha temporária precisa ter no mínimo 8 caracteres.').max(120).optional()
});

const bulkEmailSchema = z.object({
  subject: z.string().trim().min(3, 'Informe um assunto com pelo menos 3 caracteres.').max(160),
  message: z.string().trim().min(10, 'Informe a mensagem do comunicado.').max(4000),
  userIds: z.array(z.union([z.string(), z.number()])).max(500).optional()
});

const manualWhatsAppSchema = z.object({
  telefone: z.string().trim().optional(),
  mensagem: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  message: z.string().trim().optional()
}).superRefine((payload, ctx) => {
  const phone = String(payload.telefone || payload.phone || '').trim();
  const message = String(payload.mensagem || payload.message || '').trim();

  if (!phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['telefone'],
      message: 'Informe o telefone em padrão E.164.'
    });
  }

  if (!message) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mensagem'],
      message: 'Informe a mensagem que será enviada.'
    });
  }
});

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.')
});

const passwordResetConfirmSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  code: z.string().trim().regex(/^\d{6}$/, 'Informe o código de 6 dígitos enviado por e-mail.'),
  new_password: z.string().trim().min(8, 'A nova senha deve ter no mínimo 8 caracteres.').max(160)
});

function parseBodyWithSchema(schema, payload) {
  const result = schema.safeParse(payload || {});

  if (!result.success) {
    return {
      error: result.error.issues[0]?.message || 'Dados inválidos.'
    };
  }

  return {
    data: result.data
  };
}

function isPasswordChangeRouteAllowed(req) {
  const method = String(req.method || '').toUpperCase();
  const pathname = String(req.path || '').toLowerCase();

  return method === 'POST' && (
    pathname === '/profile/change-password'
    || pathname === '/api/change-initial-password'
  );
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
  await ensureUploadedFilesTable();

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
  await ensureColumn('users', 'token_version', 'INT NOT NULL DEFAULT 1');
  await ensureColumn('users', 'active', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn('users', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('users', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await pool.query('ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NOT NULL');

  await ensureColumn('clinics', 'coordinator_name', 'VARCHAR(160) NULL');
  await ensureColumn('clinics', 'catalog_code', 'VARCHAR(220) NULL');
  await ensureColumn('clinics', 'responsible_whatsapp', 'VARCHAR(40) NULL');
  await ensureColumn('clinics', 'responsible_email', 'VARCHAR(180) NULL');

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
    CREATE TABLE IF NOT EXISTS notification_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(80) NOT NULL,
      protocol VARCHAR(80) NULL,
      channel VARCHAR(20) NOT NULL,
      recipient_phone VARCHAR(40) NULL,
      recipient_email VARCHAR(220) NULL,
      recipient_user_id INT NULL,
      recipient_role VARCHAR(80) NULL,
      status VARCHAR(40) NOT NULL,
      error_message TEXT NULL,
      twilio_sid VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notification_logs_event_type (event_type),
      INDEX idx_notification_logs_protocol (protocol),
      INDEX idx_notification_logs_channel (channel),
      INDEX idx_notification_logs_status (status),
      INDEX idx_notification_logs_created_at (created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_activity_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      method VARCHAR(12) NOT NULL,
      route VARCHAR(255) NOT NULL,
      status_code INT NULL,
      actor_user_id INT NULL,
      actor_name VARCHAR(160) NULL,
      actor_email VARCHAR(180) NULL,
      actor_role VARCHAR(80) NULL,
      action VARCHAR(160) NOT NULL,
      summary TEXT NULL,
      request_payload LONGTEXT NULL,
      response_payload LONGTEXT NULL,
      ip_address VARCHAR(120) NULL,
      user_agent VARCHAR(500) NULL,
      duration_ms INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_system_activity_logs_created_at (created_at),
      INDEX idx_system_activity_logs_route (route),
      INDEX idx_system_activity_logs_actor_user_id (actor_user_id),
      INDEX idx_system_activity_logs_action (action)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_delivery_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(60) NULL,
      status VARCHAR(40) NOT NULL,
      recipient_email VARCHAR(220) NULL,
      subject VARCHAR(255) NULL,
      sender_email VARCHAR(220) NULL,
      provider_message_id VARCHAR(255) NULL,
      error_message TEXT NULL,
      duration_ms INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_email_delivery_logs_created_at (created_at),
      INDEX idx_email_delivery_logs_status (status),
      INDEX idx_email_delivery_logs_provider (provider)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      email VARCHAR(180) NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at TIMESTAMP NULL,
      requested_ip VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_password_reset_requests_user_id (user_id),
      INDEX idx_password_reset_requests_email (email),
      INDEX idx_password_reset_requests_expires_at (expires_at)
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
  await ensureColumn('patient_interactions', 'reminder_sent_at', 'TIMESTAMP NULL');
  await ensureColumn('patient_interactions', 'no_show_alert_sent_at', 'TIMESTAMP NULL');
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
  await ensureColumn('complaints', 'assigned_responsible_user_id', 'INT NULL');
  await ensureColumn('complaints', 'assigned_responsible_name', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'assigned_responsible_role', 'VARCHAR(80) NULL');
  await ensureColumn('complaints', 'clinic_snapshot_name', 'VARCHAR(180) NULL');
  await ensureColumn('complaints', 'created_origin', "VARCHAR(80) DEFAULT 'Interno'");
  await ensureColumn('complaints', 'financial_involved', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('complaints', 'financial_description', 'TEXT NULL');
  await ensureColumn('complaints', 'financial_amount', 'DECIMAL(12,2) NULL');
  await ensureColumn('complaints', 'resolution_due_at', 'DATETIME NULL');
  await ensureColumn('complaints', 'due_warning_sent_at', 'TIMESTAMP NULL');
  await ensureColumn('complaints', 'overdue_manager_notified_at', 'TIMESTAMP NULL');
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
    CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_key VARCHAR(120) NULL,
      recipient_phone VARCHAR(32) NULL,
      related_user_id INT NULL,
      related_appointment_id INT NULL,
      related_entity_type VARCHAR(60) NULL,
      related_entity_id INT NULL,
      message_body LONGTEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      provider_message_id VARCHAR(255) NULL,
      provider_response LONGTEXT NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMP NULL,
      delivered_at TIMESTAMP NULL,
      read_at TIMESTAMP NULL,
      failed_at TIMESTAMP NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_message_logs_provider_message_id (provider_message_id),
      INDEX idx_whatsapp_message_logs_recipient_phone (recipient_phone),
      INDEX idx_whatsapp_message_logs_status (status)
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
      deleted_at TIMESTAMP NULL,
      deleted_by_name VARCHAR(160) NULL,
      deleted_by_role VARCHAR(80) NULL,
      deletion_reason TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_complaint_evidences_complaint_id (complaint_id)
    )
  `);

  await ensureColumn('complaint_evidences', 'deleted_at', 'TIMESTAMP NULL');
  await ensureColumn('complaint_evidences', 'deleted_by_name', 'VARCHAR(160) NULL');
  await ensureColumn('complaint_evidences', 'deleted_by_role', 'VARCHAR(80) NULL');
  await ensureColumn('complaint_evidences', 'deletion_reason', 'TEXT NULL');

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

async function syncClinicCatalog() {
  const [rows] = await pool.query(
    `SELECT
       id,
       name,
       city,
       state,
       region,
       coordinator_name,
       active,
       catalog_code
     FROM clinics`
  );
  const clinicsByCatalogCode = new Map();
  const clinicsByLookupKey = new Map();
  const clinicsByNormalizedName = new Map();
  const normalizedLegacyNames = new Set(legacyDefaultClinicNames.map((name) => normalizeClinicLookupValue(name)));
  const seedCatalogCodes = new Set(clinicSeed.map((clinic) => buildClinicCatalogCode(clinic)));

  rows.forEach((clinic) => {
    const catalogCode = String(clinic.catalog_code || '').trim();
    const lookupKey = buildClinicLookupKey(clinic);
    const normalizedName = normalizeClinicLookupValue(clinic.name);

    if (catalogCode) {
      clinicsByCatalogCode.set(catalogCode, clinic);
    }

    if (lookupKey) {
      clinicsByLookupKey.set(lookupKey, clinic);
    }

    if (normalizedName) {
      const bucket = clinicsByNormalizedName.get(normalizedName) || [];
      bucket.push(clinic);
      clinicsByNormalizedName.set(normalizedName, bucket);
    }
  });

  let inserted = 0;
  let updated = 0;

  for (const clinic of clinicSeed) {
    const catalogCode = buildClinicCatalogCode(clinic);
    const lookupKey = buildClinicLookupKey(clinic);
    const normalizedName = normalizeClinicLookupValue(clinic.name);
    const namedMatches = clinicsByNormalizedName.get(normalizedName) || [];
    const existingClinic = clinicsByCatalogCode.get(catalogCode)
      || clinicsByLookupKey.get(lookupKey)
      || (namedMatches.length === 1 ? namedMatches[0] : null);

    if (existingClinic) {
      await pool.query(
        `UPDATE clinics
            SET catalog_code = ?,
                name = ?,
                city = ?,
                state = ?,
                region = ?,
                coordinator_name = COALESCE(NULLIF(coordinator_name, ''), ?),
                active = 1
          WHERE id = ?`,
        [
          catalogCode,
          clinic.name,
          clinic.city,
          clinic.state,
          clinic.region,
          clinic.coordinator_name || null,
          existingClinic.id
        ]
      );
      updated += 1;
      clinicsByCatalogCode.set(catalogCode, { ...existingClinic, ...clinic, catalog_code: catalogCode, active: 1 });
      clinicsByLookupKey.set(lookupKey, { ...existingClinic, ...clinic, catalog_code: catalogCode, active: 1 });
      clinicsByNormalizedName.set(normalizedName, [{ ...existingClinic, ...clinic, catalog_code: catalogCode, active: 1 }]);
      continue;
    }

    const [result] = await pool.query(
      `INSERT INTO clinics (catalog_code, name, city, state, region, coordinator_name, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        catalogCode,
        clinic.name,
        clinic.city,
        clinic.state,
        clinic.region,
        clinic.coordinator_name || null,
        Number(clinic.active ?? 1)
      ]
    );

    inserted += 1;
    const insertedClinic = { id: result.insertId, ...clinic, catalog_code: catalogCode };
    clinicsByCatalogCode.set(catalogCode, insertedClinic);
    clinicsByLookupKey.set(lookupKey, insertedClinic);
    clinicsByNormalizedName.set(normalizedName, [...namedMatches, insertedClinic]);
  }

  const legacyClinicIds = rows
    .filter((clinic) => normalizedLegacyNames.has(normalizeClinicLookupValue(clinic.name)))
    .map((clinic) => clinic.id);

  if (legacyClinicIds.length) {
    const placeholders = legacyClinicIds.map(() => '?').join(',');
    await pool.query(
      `UPDATE clinics
          SET active = 0
        WHERE id IN (${placeholders})`,
      legacyClinicIds
    );
  }

  const staleCatalogClinicIds = rows
    .filter((clinic) => {
      const normalizedName = normalizeClinicLookupValue(clinic.name);

      if (!normalizedName || normalizedLegacyNames.has(normalizedName)) {
        return false;
      }

      if (!clinicsByNormalizedName.has(normalizedName)) {
        return false;
      }

      const hasSeedSibling = (clinicsByNormalizedName.get(normalizedName) || [])
        .some((item) => seedCatalogCodes.has(String(item.catalog_code || '')));

      return hasSeedSibling && !seedCatalogCodes.has(String(clinic.catalog_code || ''));
    })
    .map((clinic) => clinic.id);

  if (staleCatalogClinicIds.length) {
    const placeholders = staleCatalogClinicIds.map(() => '?').join(',');
    await pool.query(
      `UPDATE clinics
          SET active = 0
        WHERE id IN (${placeholders})`,
      staleCatalogClinicIds
    );
  }

  console.log(`Clínicas sincronizadas: ${inserted} novas e ${updated} atualizadas.`);
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
    `SELECT id, clinic_id, first_attendance_at, forwarded_to_role, forwarded_to_label, forwarded_at, forwarded_by, assigned_coordinator_user_id, assigned_coordinator_name, assigned_responsible_user_id, assigned_responsible_name, assigned_responsible_role, clinic_snapshot_name
       FROM complaints`
  );

  await Promise.all(rows.map(async (row) => {
    if (!row.first_attendance_at && (row.forwarded_to_role || row.assigned_responsible_user_id || row.assigned_responsible_role)) {
      await pool.query(
        `UPDATE complaints
            SET forwarded_to_role = NULL,
                forwarded_to_label = NULL,
                forwarded_at = NULL,
                forwarded_by = NULL,
                assigned_responsible_user_id = NULL,
                assigned_responsible_name = NULL,
                assigned_responsible_role = NULL
          WHERE id = ?`,
        [row.id]
      );
      row.forwarded_to_role = null;
      row.assigned_responsible_user_id = null;
      row.assigned_responsible_name = null;
      row.assigned_responsible_role = null;
    }

    if (
      row.assigned_coordinator_name
      && row.clinic_snapshot_name
      && (row.assigned_responsible_role || !row.forwarded_to_role)
    ) {
      return null;
    }

    const assignment = await resolveCoordinatorAssignment(row.clinic_id);
    const shouldBackfillResponsible = ['coordinator', 'manager', 'supervisor_crc'].includes(
      String(row.forwarded_to_role || '').toLowerCase()
    );
    const responsibleAssignment = shouldBackfillResponsible
      ? await resolveComplaintResponsibleAssignment(
          row.clinic_id,
          String(row.forwarded_to_role || '').toLowerCase()
        )
      : null;

    return pool.query(
      `UPDATE complaints
           SET assigned_coordinator_user_id = COALESCE(assigned_coordinator_user_id, ?),
               assigned_coordinator_name = COALESCE(assigned_coordinator_name, ?),
               assigned_responsible_user_id = COALESCE(assigned_responsible_user_id, ?),
               assigned_responsible_name = COALESCE(assigned_responsible_name, ?),
               assigned_responsible_role = COALESCE(assigned_responsible_role, ?),
               clinic_snapshot_name = COALESCE(clinic_snapshot_name, ?)
        WHERE id = ?`,
      [
        assignment.coordinatorUserId,
        assignment.coordinatorName || null,
        shouldBackfillResponsible ? responsibleAssignment?.userId || null : null,
        shouldBackfillResponsible ? responsibleAssignment?.name || null : null,
        shouldBackfillResponsible ? row.forwarded_to_role || 'coordinator' : null,
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
  const includeDeleted = Boolean(query.include_deleted) && canViewDeletedRecords(user);

  if (!includeDeleted) {
    filters.clause += filters.clause ? ' AND c.deleted_at IS NULL' : 'WHERE c.deleted_at IS NULL';
  }

  if (user && !isAdminUser(user) && !['sac_operator', 'supervisor_crc'].includes(user?.role)) {
    filters.clause += filters.clause ? ' AND c.assigned_responsible_user_id = ?' : 'WHERE c.assigned_responsible_user_id = ?';
    filters.params.push(user.id);
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
        c.assigned_responsible_user_id,
        c.assigned_responsible_name,
        c.assigned_responsible_role,
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
      COALESCE(
        NULLIF(acu.name, ''),
        NULLIF(c.assigned_coordinator_name, ''),
        NULLIF(cl.coordinator_name, ''),
        (
          SELECT NULLIF(u.name, '')
          FROM users u
          INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = c.clinic_id
          WHERE u.active = 1
            AND u.deleted_at IS NULL
            AND u.role = 'coordinator'
          ORDER BY u.updated_at DESC, u.id DESC
          LIMIT 1
        )
      ) AS coordinator_name,
      COALESCE(
        NULLIF(acu.whatsapp, ''),
        NULLIF(acu.phone, ''),
        (
          SELECT COALESCE(NULLIF(u.whatsapp, ''), NULLIF(u.phone, ''))
          FROM users u
          INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = c.clinic_id
          WHERE u.active = 1
            AND u.deleted_at IS NULL
            AND u.role = 'coordinator'
          ORDER BY CASE WHEN c.assigned_coordinator_user_id IS NOT NULL AND u.id = c.assigned_coordinator_user_id THEN 0 ELSE 1 END, u.updated_at DESC, u.id DESC
          LIMIT 1
        ),
        NULLIF(cl.responsible_whatsapp, '')
      ) AS coordinator_phone,
      (
        SELECT NULLIF(u.name, '')
        FROM users u
        INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = c.clinic_id
        WHERE u.active = 1
          AND u.deleted_at IS NULL
          AND u.role = 'manager'
        ORDER BY u.updated_at DESC, u.id DESC
        LIMIT 1
      ) AS manager_name,
      (
        SELECT COALESCE(NULLIF(u.whatsapp, ''), NULLIF(u.phone, ''))
        FROM users u
        INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = c.clinic_id
        WHERE u.active = 1
          AND u.deleted_at IS NULL
          AND u.role = 'manager'
        ORDER BY u.updated_at DESC, u.id DESC
        LIMIT 1
      ) AS manager_phone,
      aru.email AS assigned_responsible_email,
      aru.whatsapp AS assigned_responsible_whatsapp,
      aru.phone AS assigned_responsible_phone
    FROM complaints c
    LEFT JOIN clinics cl ON cl.id = c.clinic_id
    LEFT JOIN users acu ON acu.id = c.assigned_coordinator_user_id
    LEFT JOIN users aru ON aru.id = c.assigned_responsible_user_id
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
         AND deleted_at IS NULL
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
      attachment_url: normalizeStoredUploadUrl(row.attachment_url),
      evidences: (evidencesByComplaint[row.id] || []).map((evidence) => ({
        ...evidence,
        file_url: normalizeStoredUploadUrl(evidence.file_url)
      })),
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

function normalizeEmailRecipientForLog(to) {
  return Array.isArray(to) ? to.join(', ') : String(to || '').trim();
}

async function insertEmailDeliveryLog({ to, subject, provider, status, senderEmail, providerMessageId, errorMessage, durationMs }) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  try {
    await pool.query(
      `INSERT INTO email_delivery_logs
       (provider, status, recipient_email, subject, sender_email, provider_message_id, error_message, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        provider || null,
        status,
        normalizeEmailRecipientForLog(to).slice(0, 220) || null,
        String(subject || '').slice(0, 255) || null,
        String(senderEmail || '').slice(0, 220) || null,
        providerMessageId || null,
        errorMessage ? String(errorMessage).slice(0, 1000) : null,
        Math.max(0, Math.round(durationMs || 0))
      ]
    );
  } catch (error) {
    console.warn('Não foi possível gravar log de e-mail:', error.message);
  }
}

async function sendEmail(to, subject, html, attachments = []) {
  const startedAt = performance.now();

  try {
    const response = await emailService.sendEmail({
      to,
      subject,
      html,
      text: emailService.htmlToText(html),
      attachments
    });

    await insertEmailDeliveryLog({
      to,
      subject,
      provider: response?.provider || emailService.getEmailProvider(),
      status: response?.skipped ? 'skipped' : 'sent',
      senderEmail: response?.from || emailService.getEmailFrom(),
      providerMessageId: response?.id || null,
      durationMs: performance.now() - startedAt
    });

    return response;
  } catch (error) {
    await insertEmailDeliveryLog({
      to,
      subject,
      provider: error?.provider || emailService.getEmailProvider(),
      status: 'failed',
      senderEmail: emailService.getEmailFrom(),
      errorMessage: error.message,
      durationMs: performance.now() - startedAt
    });

    throw error;
  }
}

function escapeNotificationHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeNotificationEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidNotificationEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeNotificationEmail(email));
}

function getRecipientRoleLabel(role) {
  const normalizedRole = String(role || '').trim();

  if (normalizedRole === 'clinic_responsible') return 'Responsável da unidade';
  if (normalizedRole === 'fixed_complaint_number') return 'Número fixo de reclamação';
  if (normalizedRole === 'complaint_whatsapp_group') return 'Broadcast do grupo WhatsApp';
  if (normalizedRole === 'master_admin') return 'Administrador Master';

  return accessProfiles[normalizedRole] || normalizedRole || 'Destinatário';
}

async function insertNotificationLog({
  eventType,
  protocol,
  channel,
  recipientPhone = null,
  recipientEmail = null,
  recipientUserId = null,
  recipientRole = null,
  status,
  errorMessage = null,
  twilioSid = null
}) {
  try {
    await pool.query(
      `INSERT INTO notification_logs
       (event_type, protocol, channel, recipient_phone, recipient_email, recipient_user_id, recipient_role, status, error_message, twilio_sid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventType,
        protocol || null,
        channel,
        recipientPhone || null,
        recipientEmail || null,
        recipientUserId || null,
        recipientRole || null,
        status,
        errorMessage ? String(errorMessage).slice(0, 2000) : null,
        twilioSid || null
      ]
    );
  } catch (error) {
    console.warn('Nao foi possivel gravar notification_logs:', error.message);
  }
}

function addNotificationRecipient(recipientMap, recipient = {}) {
  const userId = recipient.userId || recipient.id || null;
  const email = normalizeNotificationEmail(recipient.email || recipient.recipient_email);
  const phone = String(recipient.whatsapp || recipient.phone || recipient.recipient_phone || '').trim();
  const normalizedPhone = normalizeTwilioPhoneNumber(phone);
  const role = recipient.role || recipient.recipientRole || 'recipient';
  const key = userId
    ? `user:${userId}`
    : email
      ? `email:${email}`
      : normalizedPhone
        ? `phone:${normalizedPhone}`
        : `${role}:${recipientMap.size + 1}`;
  const current = recipientMap.get(key) || {};

  recipientMap.set(key, {
    userId: current.userId || userId || null,
    name: current.name || recipient.name || recipient.label || getRecipientRoleLabel(role),
    role: current.role || role,
    email: current.email || email || '',
    phone: current.phone || phone || ''
  });
}

async function getAdminAndSupervisorNotificationRecipients() {
  const recipientMap = new Map();
  const [users] = await pool.query(
    `SELECT DISTINCT id, name, email, whatsapp, phone, role
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND (
          role IN ('admin', 'master_admin', 'supervisor_crc')
          OR LOWER(email) IN (?, ?)
        )`,
    [masterAdminEmail, defaultAdminEmail]
  );

  users.forEach((user) => addNotificationRecipient(recipientMap, {
    userId: user.id,
    name: user.name,
    role: user.role,
    email: user.email,
    whatsapp: user.whatsapp || user.phone
  }));

  addNotificationRecipient(recipientMap, {
    name: 'Administrador Master',
    role: 'master_admin',
    email: masterAdminEmail,
    whatsapp: masterAdminWhatsapp
  });

  return Array.from(recipientMap.values());
}

async function getComplaintNotificationContext(complaintId) {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.protocol,
       c.clinic_id,
       c.forwarded_to_role,
       c.assigned_coordinator_user_id,
       c.assigned_coordinator_name,
       c.assigned_responsible_user_id,
       c.assigned_responsible_name,
       c.assigned_responsible_role,
       c.patient_name,
       c.complaint_type,
       c.description,
       c.priority,
       c.due_at,
       c.resolution_due_at,
       c.created_origin,
       c.created_at,
       cl.name AS clinic_name,
       cl.city,
       cl.state,
       cl.responsible_whatsapp,
       cl.responsible_email,
       au.id AS assigned_user_id,
       au.name AS assigned_user_name,
       au.email AS assigned_user_email,
       au.whatsapp AS assigned_user_whatsapp,
       au.phone AS assigned_user_phone,
       au.role AS assigned_user_role
     FROM complaints c
     LEFT JOIN clinics cl ON cl.id = c.clinic_id
     LEFT JOIN users au ON au.id = COALESCE(c.assigned_responsible_user_id, c.assigned_coordinator_user_id)
     WHERE c.id = ?
     LIMIT 1`,
    [complaintId]
  );

  return rows[0] || null;
}

async function getNpsNotificationContext(npsId) {
  const [rows] = await pool.query(
    `SELECT
       n.id,
       n.nps_protocol,
       n.clinic_id,
       n.patient_name,
       n.score,
       n.nps_profile,
       n.feedback_type,
       cl.name AS clinic_name,
       cl.city,
       cl.state
     FROM nps_responses n
     LEFT JOIN clinics cl ON cl.id = n.clinic_id
     WHERE n.id = ?
     LIMIT 1`,
    [npsId]
  );

  return rows[0] || null;
}

function shouldNotifyAssignedComplaintAudience(complaint) {
  const assignedRole = String(
    complaint?.assigned_responsible_role || complaint?.forwarded_to_role || ''
  ).toLowerCase();

  return Boolean(complaint?.assigned_user_id) && ['coordinator', 'manager'].includes(assignedRole);
}

function buildComplaintAssignedAudienceRecipients(complaint) {
  const recipientMap = new Map();

  addNotificationRecipient(recipientMap, {
    name: 'Responsável da unidade',
    role: 'clinic_responsible',
    email: complaint?.responsible_email,
    whatsapp: complaint?.responsible_whatsapp
  });

  addNotificationRecipient(recipientMap, {
    userId: complaint?.assigned_user_id,
    name: complaint?.assigned_user_name || complaint?.assigned_coordinator_name,
    role: complaint?.assigned_user_role || complaint?.assigned_responsible_role || 'clinic_responsible',
    email: complaint?.assigned_user_email,
    whatsapp: complaint?.assigned_user_whatsapp || complaint?.assigned_user_phone
  });

  return Array.from(recipientMap.values());
}

async function buildComplaintNotificationRecipients(complaint) {
  const recipientMap = new Map();
  const adminAndSupervisorRecipients = await getAdminAndSupervisorNotificationRecipients();

  // Numeros fixos: altere fixedComplaintWhatsAppRecipients no topo deste arquivo se a regra mudar.
  fixedComplaintWhatsAppRecipients.forEach((phone) => {
    addNotificationRecipient(recipientMap, {
      name: `Fixo ${phone}`,
      role: 'fixed_complaint_number',
      whatsapp: phone
    });
  });

  adminAndSupervisorRecipients.forEach((recipient) => addNotificationRecipient(recipientMap, recipient));

  if (shouldNotifyAssignedComplaintAudience(complaint)) {
    buildComplaintAssignedAudienceRecipients(complaint).forEach((recipient) => addNotificationRecipient(recipientMap, recipient));
  }

  return Array.from(recipientMap.values());
}

function buildComplaintNotificationEmail(complaint, protocol) {
  const safeProtocol = protocol || complaint?.protocol || complaint?.id || 'sem protocolo';
  const details = buildComplaintNotificationDetails(complaint, safeProtocol);

  return {
    subject: `Nova demanda atribuída - protocolo ${safeProtocol}`,
    html: emailService.renderBrandedEmail({
      eyebrow: 'Reclamação',
      title: `Nova demanda ${safeProtocol}`,
      intro: 'Olá,',
      bodyHtml: `
        <p style="margin:0 0 18px;color:#2f2825;">
          Você possui uma nova demanda atribuída a você, sob número de protocolo <strong>${escapeNotificationHtml(safeProtocol)}</strong>.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 8px;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Paciente</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(complaint?.patient_name || 'Não informado')}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Unidade</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(details.unitLabel)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Responsável</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(details.responsibleLabel)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Cidade/UF</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(details.cityStateLabel)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Classificação</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(complaint?.complaint_type || 'Não informado')}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Prioridade</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(complaint?.priority || 'Não informada')}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">1ª ação</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(details.firstActionDueLabel)}</td></tr>
          <tr><td style="padding:10px 0;color:#6c5a4e;">Link da reclamação</td><td style="padding:10px 0;text-align:right;font-weight:700;color:#2f2825;"><a href="${escapeNotificationHtml(details.complaintUrl)}" style="color:#8e6731;">Abrir protocolo</a></td></tr>
        </table>
        <div style="margin:20px 0 0;padding:16px;border-radius:8px;background:#fff8ed;border:1px solid #ecd9b7;color:#4b3821;">
          <strong style="display:block;margin:0 0 8px;color:#8e6731;">Resumo da ocorrência</strong>
          <p style="margin:0;">${escapeNotificationHtml(details.summary)}</p>
        </div>
      `,
      actionLabel: 'Abrir protocolo',
      actionUrl: details.complaintUrl,
      footerText: 'Este aviso foi enviado aos responsáveis definidos para Reclamação. Falhas de e-mail e WhatsApp são registradas sem bloquear o protocolo.'
    })
  };
}

function getComplaintUrl(complaint) {
  return `${frontendUrl}/gestao/${complaint?.id}`;
}

function truncateNotificationText(value, maxLength = 900) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Resumo não informado.';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function buildComplaintResponsibleDetails(complaint) {
  const directResponsiblePhone = normalizeBrazilPhone(complaint?.responsible_whatsapp || '');
  const assignedResponsiblePhone = normalizeBrazilPhone(complaint?.assigned_user_whatsapp || complaint?.assigned_user_phone || '');
  const phone = directResponsiblePhone || assignedResponsiblePhone;
  const phoneDigits = phone.replace(/\D/g, '');
  const name = directResponsiblePhone
    ? 'Responsável da unidade'
    : complaint?.assigned_user_name || complaint?.assigned_coordinator_name || 'Responsável não informado';

  return {
    name,
    phone,
    phoneDigits,
    label: phoneDigits ? `${name} @${phoneDigits}` : name
  };
}

function buildComplaintNotificationDetails(complaint, protocol) {
  const responsible = buildComplaintResponsibleDetails(complaint);
  const city = complaint?.city || 'Cidade não informada';
  const state = complaint?.state || 'UF';

  return {
    protocol: protocol || complaint?.protocol || complaint?.id || 'sem protocolo',
    complaintUrl: getComplaintUrl(complaint),
    unitLabel: complaint?.clinic_name || 'Unidade não informada',
    responsibleLabel: responsible.label,
    responsiblePhone: responsible.phone,
    cityStateLabel: `${city}/${state}`,
    openedAtLabel: formatMessageDateTime(complaint?.created_at),
    summary: truncateNotificationText(complaint?.description),
    firstActionDueLabel: formatMessageDateTime(complaint?.due_at),
    finalReturnLabel: '7 dias úteis'
  };
}

function buildComplaintWhatsAppMessage(complaint, protocol) {
  const details = buildComplaintNotificationDetails(complaint, protocol);

  return [
    '🚨 *NOVA RECLAMAÇÃO REGISTRADA*',
    '',
    `📌 Protocolo: ${details.protocol}`,
    `🏥 Unidade: ${details.unitLabel}`,
    `👤 Responsável: ${details.responsibleLabel}`,
    `📍 Cidade/UF: ${details.cityStateLabel}`,
    `📅 Data de abertura: ${details.openedAtLabel}`,
    '',
    '📝 *Resumo da ocorrência:*',
    details.summary,
    '',
    '⚠️ *PRAZOS:*',
    `• 1ª ação: ${details.firstActionDueLabel}`,
    '• Atualização obrigatória: até 48h',
    `• Prazo final para retorno: ${details.finalReturnLabel}`,
    '',
    '🔔 *Atenção:*',
    'A ausência de atualização em até 48h implicará em escalonamento automático.',
    '',
    '📊 Acompanhe e registre a tratativa no sistema.',
    `🔗 ${details.complaintUrl}`
  ].join('\n');
}

function buildNpsNotificationEmail(nps, protocol) {
  const clinicLabel = nps?.clinic_name
    ? `${nps.clinic_name}${nps.city ? ` - ${nps.city}/${nps.state || 'UF'}` : ''}`
    : 'Unidade não informada';
  const safeProtocol = protocol || nps?.nps_protocol || nps?.id || 'sem protocolo';

  return {
    subject: `Novo NPS registrado - protocolo ${safeProtocol}`,
    html: emailService.renderBrandedEmail({
      eyebrow: 'NPS',
      title: `Novo NPS ${safeProtocol}`,
      intro: 'Olá,',
      bodyHtml: `
        <p style="margin:0 0 18px;color:#2f2825;">
          Uma nova pesquisa NPS foi registrada no sistema e já está disponível para acompanhamento.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 8px;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Paciente</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(nps?.patient_name || 'Não informado')}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Unidade</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(clinicLabel)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Nota</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(nps?.score || 'Não informada')}</td></tr>
          <tr><td style="padding:10px 0;color:#6c5a4e;">Perfil</td><td style="padding:10px 0;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(nps?.nps_profile || nps?.feedback_type || 'Não informado')}</td></tr>
        </table>
      `,
      actionLabel: 'Abrir NPS',
      actionUrl: `${frontendUrl}/gestao-nps`,
      footerText: 'Este aviso de NPS é enviado somente para administradores e Supervisor do CRC.'
    })
  };
}

async function sendLoggedTwilioNotification({ eventType, protocol, recipient, sender, message }) {
  const originalPhone = recipient?.phone || '';
  const normalizedPhone = normalizeTwilioPhoneNumber(originalPhone);

  if (!originalPhone) {
    await insertNotificationLog({
      eventType,
      protocol,
      channel: 'WHATSAPP',
      recipientUserId: recipient?.userId,
      recipientRole: recipient?.role,
      status: 'skipped',
      errorMessage: 'Destinatário sem WhatsApp cadastrado.'
    });

    return { channel: 'WHATSAPP', status: 'skipped', reason: 'missing_phone' };
  }

  if (!normalizedPhone) {
    await insertNotificationLog({
      eventType,
      protocol,
      channel: 'WHATSAPP',
      recipientPhone: originalPhone,
      recipientUserId: recipient?.userId,
      recipientRole: recipient?.role,
      status: 'failed',
      errorMessage: 'Telefone invalido para WhatsApp Twilio.'
    });

    return { channel: 'WHATSAPP', status: 'failed' };
  }

  const result = await sender({ to: normalizedPhone, protocol, message, recipient });
  const status = result?.success ? 'sent' : result?.skipped ? 'skipped' : 'failed';

  await insertNotificationLog({
    eventType,
    protocol,
    channel: 'WHATSAPP',
    recipientPhone: normalizedPhone,
    recipientUserId: recipient?.userId,
    recipientRole: recipient?.role,
    status,
    errorMessage: result?.success ? null : result?.error || 'Falha no envio pela Twilio.',
    twilioSid: result?.twilioSid || result?.providerMessageId || null
  });

  return {
    channel: 'WHATSAPP',
    status,
    success: Boolean(result?.success),
    error: result?.error || null
  };
}

async function sendLoggedNotificationEmail({ eventType, protocol, recipient, template }) {
  const email = normalizeNotificationEmail(recipient?.email);

  if (!email) {
    await insertNotificationLog({
      eventType,
      protocol,
      channel: 'EMAIL',
      recipientPhone: recipient?.phone || null,
      recipientUserId: recipient?.userId,
      recipientRole: recipient?.role,
      status: 'skipped',
      errorMessage: 'Destinatário sem e-mail cadastrado.'
    });

    return { channel: 'EMAIL', status: 'skipped', reason: 'missing_email' };
  }

  if (!isValidNotificationEmail(email)) {
    await insertNotificationLog({
      eventType,
      protocol,
      channel: 'EMAIL',
      recipientEmail: email,
      recipientUserId: recipient?.userId,
      recipientRole: recipient?.role,
      status: 'failed',
      errorMessage: 'E-mail invalido.'
    });

    return { channel: 'EMAIL', status: 'failed' };
  }

  try {
    const result = await sendEmail(email, template.subject, template.html);
    const status = result?.skipped ? 'skipped' : 'sent';

    await insertNotificationLog({
      eventType,
      protocol,
      channel: 'EMAIL',
      recipientEmail: email,
      recipientUserId: recipient?.userId,
      recipientRole: recipient?.role,
      status,
      errorMessage: result?.skipped ? 'Provider de e-mail em modo log/skipped.' : null
    });

    return { channel: 'EMAIL', status, success: status === 'sent' };
  } catch (error) {
    await insertNotificationLog({
      eventType,
      protocol,
      channel: 'EMAIL',
      recipientEmail: email,
      recipientUserId: recipient?.userId,
      recipientRole: recipient?.role,
      status: 'failed',
      errorMessage: error.message
    });

    return { channel: 'EMAIL', status: 'failed', error: error.message };
  }
}

async function sendDetailedComplaintWhatsApp({ to, protocol, message, recipient }) {
  const complaintUrl = recipient?.complaintUrl || '';

  // Reclamações em producao usam o template dedicado TWILIO_TEMPLATE_DEMANDA_SID.
  // Por padrao, a Twilio recebe {{1}} = protocolo e {{2}} = link da reclamacao.
  return sendTwilioComplaintNotification({
    to,
    protocol,
    complaintUrl
  });
}

function summarizeNotificationStatus(results = []) {
  const sentCount = results.filter((result) => result.status === 'sent').length;
  const problemCount = results.filter((result) => (
    result.status === 'failed'
    || (result.status === 'skipped' && !['missing_phone', 'missing_email'].includes(result.reason))
  )).length;

  if (sentCount && problemCount) return 'partial_error';
  if (sentCount) return 'sent';
  return 'failed';
}

async function deliverProtocolNotifications({ eventType, protocol, recipients, emailTemplate, whatsappSender, whatsappMessage }) {
  const phoneTargets = new Set();
  const emailTargets = new Set();
  const tasks = [];

  recipients.forEach((recipient) => {
    const phoneKey = normalizeTwilioPhoneNumber(recipient.phone);
    const emailKey = normalizeNotificationEmail(recipient.email);

    if (!phoneKey || !phoneTargets.has(phoneKey)) {
      if (phoneKey) phoneTargets.add(phoneKey);
      tasks.push(sendLoggedTwilioNotification({
        eventType,
        protocol,
        recipient,
        sender: whatsappSender,
        message: whatsappMessage
      }));
    }

    if (!emailKey || !emailTargets.has(emailKey)) {
      if (emailKey) emailTargets.add(emailKey);
      tasks.push(sendLoggedNotificationEmail({ eventType, protocol, recipient, template: emailTemplate }));
    }
  });

  const results = await Promise.all(tasks.map((task) => task.catch((error) => ({
    status: 'failed',
    error: error.message
  }))));

  return {
    notificationStatus: summarizeNotificationStatus(results),
    results
  };
}

function buildComplaintWhatsappGroupRecipients(existingRecipients = []) {
  const existingPhones = new Set(
    existingRecipients
      .map((recipient) => normalizeTwilioPhoneNumber(recipient.phone))
      .filter(Boolean)
  );
  const groupPhones = new Set();

  return complaintWhatsappGroupRecipients.reduce((recipients, phone) => {
    const normalized = normalizeTwilioPhoneNumber(phone);

    if (!normalized || existingPhones.has(normalized) || groupPhones.has(normalized)) {
      return recipients;
    }

    groupPhones.add(normalized);
    recipients.push({
      name: 'Broadcast do grupo WhatsApp',
      role: 'complaint_whatsapp_group',
      phone
    });
    return recipients;
  }, []);
}

async function deliverWhatsAppOnlyNotifications({ eventType, protocol, recipients, whatsappSender, whatsappMessage }) {
  if (!recipients.length) return [];

  const results = await Promise.all(recipients.map((recipient) => (
    sendLoggedTwilioNotification({
      eventType,
      protocol,
      recipient,
      sender: whatsappSender,
      message: whatsappMessage
    }).catch((error) => ({
      channel: 'WHATSAPP',
      status: 'failed',
      error: error.message
    }))
  )));

  return results;
}

async function dispatchComplaintCreatedNotifications(complaintId, protocol) {
  try {
    const complaint = await getComplaintNotificationContext(complaintId);

    if (!complaint) {
      return { notificationStatus: 'failed', results: [] };
    }

    const recipients = (await buildComplaintNotificationRecipients(complaint)).map((recipient) => ({
      ...recipient,
      complaintUrl: getComplaintUrl(complaint)
    }));
    const safeProtocol = protocol || complaint.protocol;
    const whatsappMessage = buildComplaintWhatsAppMessage(complaint, safeProtocol);

    const directDelivery = await deliverProtocolNotifications({
      eventType: 'COMPLAINT_CREATED',
      protocol: safeProtocol,
      recipients,
      emailTemplate: buildComplaintNotificationEmail(complaint, safeProtocol),
      whatsappSender: sendDetailedComplaintWhatsApp,
      whatsappMessage
    });

    const groupRecipients = buildComplaintWhatsappGroupRecipients(recipients);
    const groupResults = await deliverWhatsAppOnlyNotifications({
      eventType: 'COMPLAINT_GROUP_BROADCAST',
      protocol: safeProtocol,
      recipients: groupRecipients,
      whatsappSender: sendDetailedComplaintWhatsApp,
      whatsappMessage
    });
    const results = [...directDelivery.results, ...groupResults];

    return {
      notificationStatus: summarizeNotificationStatus(results),
      results
    };
  } catch (error) {
    console.warn('Nao foi possivel disparar notificacoes Twilio/e-mail da reclamacao:', error.message);
    return { notificationStatus: 'failed', results: [{ status: 'failed', error: error.message }] };
  }
}

async function dispatchComplaintAssignedNotifications(complaintId, protocol) {
  try {
    const complaint = await getComplaintNotificationContext(complaintId);

    if (!complaint || !shouldNotifyAssignedComplaintAudience(complaint)) {
      return { notificationStatus: 'failed', results: [] };
    }

    const recipients = buildComplaintAssignedAudienceRecipients(complaint).map((recipient) => ({
      ...recipient,
      complaintUrl: getComplaintUrl(complaint)
    }));
    const safeProtocol = protocol || complaint.protocol;
    const whatsappMessage = buildComplaintWhatsAppMessage(complaint, safeProtocol);

    const directDelivery = await deliverProtocolNotifications({
      eventType: 'COMPLAINT_ASSIGNED',
      protocol: safeProtocol,
      recipients,
      emailTemplate: buildComplaintNotificationEmail(complaint, safeProtocol),
      whatsappSender: sendDetailedComplaintWhatsApp,
      whatsappMessage
    });

    return {
      notificationStatus: summarizeNotificationStatus(directDelivery.results),
      results: directDelivery.results
    };
  } catch (error) {
    console.warn('Nao foi possivel disparar notificacoes de atribuicao da reclamacao:', error.message);
    return { notificationStatus: 'failed', results: [{ status: 'failed', error: error.message }] };
  }
}

async function dispatchNpsCreatedNotifications(npsId, protocol) {
  try {
    const nps = await getNpsNotificationContext(npsId);
    const recipients = await getAdminAndSupervisorNotificationRecipients();

    return deliverProtocolNotifications({
      eventType: 'NPS_CREATED',
      protocol: protocol || nps?.nps_protocol,
      recipients,
      emailTemplate: buildNpsNotificationEmail(nps, protocol),
      whatsappSender: sendTwilioNpsNotification
    });
  } catch (error) {
    console.warn('Nao foi possivel disparar notificacoes Twilio/e-mail do NPS:', error.message);
    return { notificationStatus: 'failed', results: [{ status: 'failed', error: error.message }] };
  }
}

async function createNpsCreatedInAppNotifications({ npsId, protocol, patientName, clinicId, npsProfile }) {
  const title = `Nova pesquisa NPS ${protocol}`;
  const message = [
    'Nova pesquisa de satisfação registrada.',
    `Paciente: ${patientName || 'Não informado'}`,
    `Unidade: ${clinicId ? `Clínica #${clinicId}` : 'Não informada'}`,
    `Perfil: ${npsProfile || 'Não informado'}`
  ].join('\n');
  const link = `${frontendUrl}/gestao-nps`;
  const payload = { npsId, protocol, profile: npsProfile };
  let notifiedUserIds = [];

  try {
    const adminIds = await createNotificationForAdmins('nps_created', title, message, link, payload);
    notifiedUserIds = [...notifiedUserIds, ...adminIds];
  } catch (error) {
    console.warn('Nao foi possivel registrar notificacao administrativa do NPS:', error.message);
  }

  try {
    const supervisorIds = await createNotificationForRoles(['supervisor_crc'], 'nps_created', title, message, link, payload);
    notifiedUserIds = [...notifiedUserIds, ...supervisorIds];
  } catch (error) {
    console.warn('Nao foi possivel registrar notificacao do Supervisor CRC para NPS:', error.message);
  }

  return Array.from(new Set(notifiedUserIds));
}

function parseSqlCount(row, key) {
  return Number(row?.[key] || 0);
}

function statusRowsToObject(rows = []) {
  return rows.reduce((acc, row) => {
    acc[row.Variable_name] = Number(row.Value || 0);
    return acc;
  }, {});
}

async function queryMysqlStatus(names = []) {
  const placeholders = names.map(() => '?').join(',');
  const [rows] = await pool.query(`SHOW GLOBAL STATUS WHERE Variable_name IN (${placeholders})`, names);
  return statusRowsToObject(rows);
}

async function queryMysqlVariables(names = []) {
  const placeholders = names.map(() => '?').join(',');
  const [rows] = await pool.query(`SHOW VARIABLES WHERE Variable_name IN (${placeholders})`, names);
  return rows.reduce((acc, row) => {
    acc[row.Variable_name] = row.Value;
    return acc;
  }, {});
}

async function getRuntimeMetrics() {
  const cpuStart = process.cpuUsage();
  const sampleStart = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 60));
  const elapsedMs = Math.max(1, performance.now() - sampleStart);
  const cpuDiff = process.cpuUsage(cpuStart);
  const cpuMs = (cpuDiff.user + cpuDiff.system) / 1000;
  const cpuCount = os.cpus().length || 1;
  const memory = process.memoryUsage();

  return {
    status: 'online',
    startedAt: serverStartedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    hostname: os.hostname(),
    cpuCount,
    cpuModel: os.cpus()[0]?.model || 'CPU não identificada',
    processCpuPercent: Number(((cpuMs / (elapsedMs * cpuCount)) * 100).toFixed(2)),
    loadAverage: os.loadavg(),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      systemFreeBytes: os.freemem(),
      systemTotalBytes: os.totalmem()
    }
  };
}

async function getDatabaseMonitoring() {
  const pingStart = performance.now();
  await pool.query('SELECT 1');
  const latencyMs = Math.round(performance.now() - pingStart);
  const status = await queryMysqlStatus([
    'Threads_connected',
    'Max_used_connections',
    'Connections',
    'Questions',
    'Slow_queries',
    'Aborted_connects',
    'Uptime',
    'Bytes_received',
    'Bytes_sent'
  ]);
  const variables = await queryMysqlVariables([
    'max_connections',
    'version',
    'innodb_buffer_pool_size',
    'table_open_cache'
  ]);
  const [sizeRows] = await pool.query(`
    SELECT
      DATABASE() AS database_name,
      COUNT(*) AS table_count,
      COALESCE(SUM(data_length + index_length), 0) AS total_bytes,
      COALESCE(SUM(data_length), 0) AS data_bytes,
      COALESCE(SUM(index_length), 0) AS index_bytes
    FROM information_schema.TABLES
    WHERE table_schema = DATABASE()
  `);
  const [tableRows] = await pool.query(`
    SELECT
      table_name,
      table_rows,
      data_length + index_length AS total_bytes,
      data_length AS data_bytes,
      index_length AS index_bytes
    FROM information_schema.TABLES
    WHERE table_schema = DATABASE()
    ORDER BY total_bytes DESC
    LIMIT 8
  `);
  const maxConnections = Number(variables.max_connections || 0);
  const connected = Number(status.Threads_connected || 0);

  return {
    status: latencyMs <= 250 ? 'online' : 'attention',
    latencyMs,
    version: variables.version || 'Não informado',
    uptimeSeconds: Number(status.Uptime || 0),
    connections: {
      current: connected,
      max: maxConnections,
      usagePercent: maxConnections ? Number(((connected / maxConnections) * 100).toFixed(2)) : null,
      maxUsed: Number(status.Max_used_connections || 0),
      total: Number(status.Connections || 0)
    },
    traffic: {
      questions: Number(status.Questions || 0),
      slowQueries: Number(status.Slow_queries || 0),
      abortedConnects: Number(status.Aborted_connects || 0),
      bytesReceived: Number(status.Bytes_received || 0),
      bytesSent: Number(status.Bytes_sent || 0)
    },
    capacity: {
      databaseName: sizeRows[0]?.database_name || process.env.DB_NAME || 'nps_system',
      tableCount: Number(sizeRows[0]?.table_count || 0),
      totalBytes: Number(sizeRows[0]?.total_bytes || 0),
      dataBytes: Number(sizeRows[0]?.data_bytes || 0),
      indexBytes: Number(sizeRows[0]?.index_bytes || 0),
      innodbBufferPoolBytes: Number(variables.innodb_buffer_pool_size || 0),
      tableOpenCache: Number(variables.table_open_cache || 0)
    },
    largestTables: tableRows.map((row) => ({
      tableName: row.table_name,
      estimatedRows: Number(row.table_rows || 0),
      totalBytes: Number(row.total_bytes || 0),
      dataBytes: Number(row.data_bytes || 0),
      indexBytes: Number(row.index_bytes || 0)
    }))
  };
}

async function getOverviewMetrics() {
  const [rows] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) AS users_total,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND active = 1) AS users_active,
      (SELECT COUNT(*) FROM complaints WHERE deleted_at IS NULL) AS complaints_total,
      (SELECT COUNT(*) FROM complaints WHERE deleted_at IS NULL AND DATE(created_at) = CURDATE()) AS complaints_today,
      (SELECT COUNT(*) FROM complaints WHERE deleted_at IS NULL AND status <> 'resolvida') AS complaints_open,
      (SELECT COUNT(*) FROM complaints WHERE deleted_at IS NULL AND resolution_due_at IS NOT NULL AND resolution_due_at < NOW() AND status <> 'resolvida') AS complaints_overdue,
      (SELECT COUNT(*) FROM nps_responses WHERE deleted_at IS NULL) AS nps_total,
      (SELECT COUNT(*) FROM nps_responses WHERE deleted_at IS NULL AND DATE(created_at) = CURDATE()) AS nps_today,
      (SELECT ROUND(AVG(score), 2) FROM nps_responses WHERE deleted_at IS NULL) AS nps_average,
      (SELECT COUNT(*) FROM patient_interactions) AS patient_interactions_total,
      (SELECT COUNT(*) FROM patient_interactions WHERE DATE(created_at) = CURDATE()) AS patient_interactions_today,
      (SELECT COUNT(*) FROM notification_events WHERE status = 'unread') AS notifications_unread,
      ((SELECT COUNT(*) FROM whatsapp_message_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))
        + (SELECT COUNT(*) FROM notification_logs WHERE channel = 'WHATSAPP' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))) AS whatsapp_24h,
      ((SELECT COUNT(*) FROM whatsapp_message_logs WHERE status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))
        + (SELECT COUNT(*) FROM notification_logs WHERE channel = 'WHATSAPP' AND status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))) AS whatsapp_failed_24h,
      (SELECT COUNT(*) FROM email_delivery_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS emails_24h,
      (SELECT COUNT(*) FROM email_delivery_logs WHERE status = 'sent' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS emails_sent_24h,
      (SELECT COUNT(*) FROM email_delivery_logs WHERE status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS emails_failed_24h,
      (SELECT COUNT(*) FROM system_activity_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS activities_24h
  `);
  const row = rows[0] || {};
  const emailFailures = parseSqlCount(row, 'emails_failed_24h');
  const whatsappFailures = parseSqlCount(row, 'whatsapp_failed_24h');
  const overdue = parseSqlCount(row, 'complaints_overdue');
  const healthScore = Math.max(0, 100 - (emailFailures * 4) - (whatsappFailures * 4) - (overdue * 2));

  return {
    healthScore,
    users: {
      total: parseSqlCount(row, 'users_total'),
      active: parseSqlCount(row, 'users_active')
    },
    complaints: {
      total: parseSqlCount(row, 'complaints_total'),
      today: parseSqlCount(row, 'complaints_today'),
      open: parseSqlCount(row, 'complaints_open'),
      overdue
    },
    nps: {
      total: parseSqlCount(row, 'nps_total'),
      today: parseSqlCount(row, 'nps_today'),
      average: Number(row.nps_average || 0)
    },
    relationships: {
      total: parseSqlCount(row, 'patient_interactions_total'),
      today: parseSqlCount(row, 'patient_interactions_today')
    },
    communications: {
      emails24h: parseSqlCount(row, 'emails_24h'),
      emailsSent24h: parseSqlCount(row, 'emails_sent_24h'),
      emailsFailed24h: emailFailures,
      whatsapp24h: parseSqlCount(row, 'whatsapp_24h'),
      whatsappFailed24h: whatsappFailures,
      unreadNotifications: parseSqlCount(row, 'notifications_unread')
    },
    activities24h: parseSqlCount(row, 'activities_24h')
  };
}

async function getEmailMonitoring() {
  const [summaryRows] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'sent') AS sent,
      SUM(status = 'failed') AS failed,
      SUM(status = 'skipped') AS skipped,
      SUM(created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS last_24h,
      SUM(DATE(created_at) = CURDATE()) AS today
    FROM email_delivery_logs
  `);
  const [providerRows] = await pool.query(`
    SELECT provider, status, COUNT(*) AS total
    FROM email_delivery_logs
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY provider, status
    ORDER BY total DESC
  `);
  const [recentRows] = await pool.query(`
    SELECT provider, status, recipient_email, subject, sender_email, provider_message_id, error_message, duration_ms, created_at
    FROM email_delivery_logs
    ORDER BY created_at DESC
    LIMIT 10
  `);
  const summary = summaryRows[0] || {};

  return {
    provider: emailService.getEmailProvider(),
    from: emailService.getEmailFrom(),
    resendConfigured: emailService.getEmailProvider() === 'resend' && Boolean(process.env.RESEND_API_KEY),
    summary: {
      total: Number(summary.total || 0),
      sent: Number(summary.sent || 0),
      failed: Number(summary.failed || 0),
      skipped: Number(summary.skipped || 0),
      last24h: Number(summary.last_24h || 0),
      today: Number(summary.today || 0)
    },
    byProviderStatus: providerRows.map((row) => ({
      provider: row.provider || 'não informado',
      status: row.status,
      total: Number(row.total || 0)
    })),
    recent: recentRows
  };
}

async function getWhatsAppMonitoring() {
  const [summaryRows] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(status IN ('sent', 'delivered', 'read')) AS sent,
      SUM(status = 'failed') AS failed,
      SUM(status = 'skipped') AS skipped,
      SUM(created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS last_24h,
      SUM(DATE(created_at) = CURDATE()) AS today
    FROM (
      SELECT status, created_at FROM whatsapp_message_logs
      UNION ALL
      SELECT status, created_at FROM notification_logs WHERE channel = 'WHATSAPP'
    ) whatsapp_events
  `);
  const config = getTwilioConfigStatus();
  const coreConfigured = config.accountSidConfigured && config.authTokenConfigured && config.fromConfigured;
  const protocolTemplatesConfigured = config.complaintTemplateConfigured && config.npsTemplateConfigured;
  const manualTemplatesConfigured = config.genericTemplateConfigured || config.testTemplateConfigured;
  const summary = summaryRows[0] || {};
  const notes = [];

  if (!coreConfigured) {
    notes.push('Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_WHATSAPP_FROM no Render.');
  }

  if (!protocolTemplatesConfigured) {
    notes.push('Configure TWILIO_TEMPLATE_DEMANDA_SID e TWILIO_TEMPLATE_NPS_SID para Reclamação e NPS.');
  }

  if (!manualTemplatesConfigured) {
    notes.push('Configure TWILIO_TEMPLATE_TESTE_SID ou TWILIO_TEMPLATE_GENERIC_SID para testes e mensagens operacionais.');
  }

  return {
    configured: coreConfigured,
    status: coreConfigured && protocolTemplatesConfigured && manualTemplatesConfigured
      ? 'online'
      : coreConfigured
        ? 'attention'
        : 'not_configured',
    label: 'Twilio WhatsApp',
    metrics: {
      from: config.fromConfigured ? config.from : 'Não configurado',
      demandaTemplate: config.complaintTemplateConfigured ? 'Configurado' : 'Ausente',
      npsTemplate: config.npsTemplateConfigured ? 'Configurado' : 'Ausente',
      testeTemplate: config.testTemplateConfigured ? 'Configurado' : 'Ausente',
      genericoTemplate: config.genericTemplateConfigured ? 'Configurado' : 'Ausente',
      total: Number(summary.total || 0),
      last24h: Number(summary.last_24h || 0),
      sent: Number(summary.sent || 0),
      failed: Number(summary.failed || 0),
      skipped: Number(summary.skipped || 0),
      today: Number(summary.today || 0)
    },
    notes
  };
}

async function getActivityMonitoring() {
  const [recent] = await pool.query(`
    SELECT *
    FROM (
      SELECT
        'Sistema' AS source,
        action,
        summary,
        actor_name,
        actor_role,
        actor_email,
        CONCAT(UPPER(method), ' ', route) AS source_detail,
        CONCAT('Status ', status_code) AS origin_detail,
        route AS context,
        status_code,
        duration_ms,
        created_at
      FROM system_activity_logs
      UNION ALL
      SELECT
        'Protocolo' AS source,
        cl.action,
        cl.message AS summary,
        cl.actor_name,
        cl.actor_role,
        NULL AS actor_email,
        COALESCE(c.protocol, CONCAT('ID ', cl.complaint_id)) AS source_detail,
        COALESCE(c.created_origin, 'Interno') AS origin_detail,
        CONCAT('Reclamação ', COALESCE(c.protocol, CONCAT('#', cl.complaint_id))) AS context,
        NULL AS status_code,
        NULL AS duration_ms,
        cl.created_at
      FROM complaint_logs cl
      LEFT JOIN complaints c ON c.id = cl.complaint_id
      UNION ALL
      SELECT
        'NPS' AS source,
        ntl.action,
        ntl.message AS summary,
        ntl.actor_name,
        ntl.actor_role,
        NULL AS actor_email,
        COALESCE(n.nps_protocol, CONCAT('ID ', ntl.nps_response_id)) AS source_detail,
        COALESCE(n.source, 'Pesquisa NPS') AS origin_detail,
        CONCAT('NPS ', COALESCE(n.nps_protocol, CONCAT('#', ntl.nps_response_id))) AS context,
        NULL AS status_code,
        NULL AS duration_ms,
        ntl.created_at
      FROM nps_treatment_logs ntl
      LEFT JOIN nps_responses n ON n.id = ntl.nps_response_id
      UNION ALL
      SELECT
        'Relacionamento' AS source,
        pil.action,
        pil.message AS summary,
        pil.actor_name,
        pil.actor_role,
        NULL AS actor_email,
        COALESCE(pi.protocol, CONCAT('ID ', pil.interaction_id)) AS source_detail,
        COALESCE(pi.channel, 'Relacionamento') AS origin_detail,
        CONCAT('Paciente ', COALESCE(pi.patient_name, CONCAT('#', pil.interaction_id))) AS context,
        NULL AS status_code,
        NULL AS duration_ms,
        pil.created_at
      FROM patient_interaction_logs pil
      LEFT JOIN patient_interactions pi ON pi.id = pil.interaction_id
      UNION ALL
      SELECT
        'WhatsApp' AS source,
        wml.status AS action,
        COALESCE(wml.error_message, wml.event_key, 'Mensagem registrada') AS summary,
        u.name AS actor_name,
        u.role AS actor_role,
        u.email AS actor_email,
        COALESCE(wml.related_entity_type, 'Mensagem avulsa') AS source_detail,
        wml.recipient_phone AS origin_detail,
        COALESCE(wml.related_entity_type, 'Registro WhatsApp') AS context,
        NULL AS status_code,
        NULL AS duration_ms,
        wml.created_at
      FROM whatsapp_message_logs wml
      LEFT JOIN users u ON u.id = wml.related_user_id
      UNION ALL
      SELECT
        'WhatsApp' AS source,
        nl.status AS action,
        COALESCE(nl.error_message, nl.event_type, 'Template Twilio registrado') AS summary,
        u.name AS actor_name,
        COALESCE(u.role, nl.recipient_role) AS actor_role,
        u.email AS actor_email,
        COALESCE(nl.protocol, nl.event_type, 'Notificação template') AS source_detail,
        nl.recipient_phone AS origin_detail,
        COALESCE(nl.channel, 'WHATSAPP') AS context,
        NULL AS status_code,
        NULL AS duration_ms,
        nl.created_at
      FROM notification_logs nl
      LEFT JOIN users u ON u.id = nl.recipient_user_id
      WHERE nl.channel = 'WHATSAPP'
      UNION ALL
      SELECT
        'E-mail' AS source,
        edl.status AS action,
        edl.subject AS summary,
        u.name AS actor_name,
        u.role AS actor_role,
        COALESCE(u.email, edl.recipient_email) AS actor_email,
        edl.subject AS source_detail,
        edl.recipient_email AS origin_detail,
        COALESCE(edl.provider, 'E-mail transacional') AS context,
        NULL AS status_code,
        edl.duration_ms,
        edl.created_at
      FROM email_delivery_logs edl
      LEFT JOIN users u ON LOWER(u.email) = LOWER(edl.recipient_email) AND u.deleted_at IS NULL
    ) timeline
    ORDER BY created_at DESC
    LIMIT 120
  `);
  const [sourceRows] = await pool.query(`
    SELECT source, COUNT(*) AS total
    FROM (
      SELECT 'Sistema' AS source, created_at FROM system_activity_logs
      UNION ALL SELECT 'Protocolo' AS source, created_at FROM complaint_logs
      UNION ALL SELECT 'NPS' AS source, created_at FROM nps_treatment_logs
      UNION ALL SELECT 'Relacionamento' AS source, created_at FROM patient_interaction_logs
      UNION ALL SELECT 'WhatsApp' AS source, created_at FROM whatsapp_message_logs
      UNION ALL SELECT 'WhatsApp' AS source, created_at FROM notification_logs WHERE channel = 'WHATSAPP'
      UNION ALL SELECT 'E-mail' AS source, created_at FROM email_delivery_logs
    ) movements
    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    GROUP BY source
    ORDER BY total DESC
  `);

  return {
    recent,
    bySource24h: sourceRows.map((row) => ({ source: row.source, total: Number(row.total || 0) }))
  };
}

async function fetchVercelMonitoring() {
  const status = {
    configured: Boolean(vercelApiToken),
    status: vercelApiToken ? 'unknown' : 'not_configured',
    label: 'Vercel',
    metrics: {},
    recentDeployments: [],
    notes: []
  };

  try {
    const publicStatus = await axios.get('https://www.vercel-status.com/api/v2/status.json', { timeout: 6000 });
    status.publicStatus = publicStatus.data?.status?.description || 'Não informado';
  } catch (error) {
    status.notes.push(`Status público indisponível: ${error.message}`);
  }

  if (!vercelApiToken) {
    status.notes.push('Configure VERCEL_API_TOKEN e, se possível, VERCEL_PROJECT_ID/VERCEL_TEAM_ID para monitorar deploys em tempo real.');
    return status;
  }

  try {
    const params = new URLSearchParams({ limit: '6' });
    if (vercelProjectId) params.set('projectId', vercelProjectId);
    if (vercelTeamId) params.set('teamId', vercelTeamId);
    const response = await axios.get(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
      timeout: 8000,
      headers: { Authorization: `Bearer ${vercelApiToken}` }
    });
    const deployments = Array.isArray(response.data?.deployments) ? response.data.deployments : [];
    const latest = deployments[0] || null;

    status.status = latest?.state === 'READY' ? 'online' : latest ? 'attention' : 'unknown';
    status.metrics = {
      latestState: latest?.state || 'Sem deploy encontrado',
      latestTarget: latest?.target || latest?.meta?.githubCommitRef || 'Não informado',
      latestUrl: latest?.url ? `https://${latest.url}` : '',
      latestCreatedAt: latest?.createdAt ? new Date(latest.createdAt).toISOString() : null,
      deploymentsLoaded: deployments.length
    };
    status.recentDeployments = deployments.map((deployment) => ({
      uid: deployment.uid,
      name: deployment.name,
      state: deployment.state,
      target: deployment.target,
      url: deployment.url ? `https://${deployment.url}` : '',
      createdAt: deployment.createdAt ? new Date(deployment.createdAt).toISOString() : null
    }));
    status.notes.push('CPU/memória de execução da Vercel não é exposta por este endpoint REST; o painel acompanha disponibilidade, deploys e status público.');
  } catch (error) {
    status.status = 'error';
    status.notes.push(`Falha ao consultar Vercel: ${error.response?.data?.error?.message || error.message}`);
  }

  return status;
}

async function fetchRailwayMonitoring() {
  const token = railwayApiToken || railwayProjectAccessToken;
  const status = {
    configured: Boolean(token && railwayProjectId),
    status: token && railwayProjectId ? 'unknown' : 'not_configured',
    label: 'Railway MySQL',
    metrics: {},
    notes: [],
    samples: []
  };

  if (!token || !railwayProjectId) {
    status.notes.push('Configure RAILWAY_API_TOKEN ou RAILWAY_PROJECT_ACCESS_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID e RAILWAY_SERVICE_ID para coletar CPU/memória/disco direto da Railway.');
    return status;
  }

  const headers = railwayProjectAccessToken
    ? { 'Project-Access-Token': railwayProjectAccessToken }
    : { Authorization: `Bearer ${railwayApiToken}` };

  try {
    const projectResponse = await axios.post(
      railwayApiUrl,
      {
        query: `
          query ProjectHealth($projectId: String!) {
            project(id: $projectId) {
              id
              name
            }
          }
        `,
        variables: { projectId: railwayProjectId }
      },
      { timeout: 8000, headers }
    );

    if (projectResponse.data?.errors?.length) {
      throw new Error(projectResponse.data.errors[0].message);
    }

    status.status = 'online';
    status.metrics.projectName = projectResponse.data?.data?.project?.name || 'Projeto Railway';
  } catch (error) {
    status.status = 'error';
    status.notes.push(`Falha ao consultar projeto Railway: ${error.response?.data?.errors?.[0]?.message || error.message}`);
    return status;
  }

  if (!railwayEnvironmentId || !railwayServiceId) {
    status.notes.push('Projeto conectado. Informe RAILWAY_ENVIRONMENT_ID e RAILWAY_SERVICE_ID para obter séries de CPU/memória/disco.');
    return status;
  }

  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 60 * 1000);
    const metricsResponse = await axios.post(
      railwayApiUrl,
      {
        query: `
          query ServiceMetrics($input: MetricsInput!) {
            metrics(input: $input) {
              measurement
              values {
                ts
                value
              }
            }
          }
        `,
        variables: {
          input: {
            projectId: railwayProjectId,
            environmentId: railwayEnvironmentId,
            serviceId: railwayServiceId,
            measurements: ['CPU_USAGE', 'MEMORY_USAGE_GB', 'DISK_USAGE_GB'],
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            sampleRate: 60
          }
        }
      },
      { timeout: 8000, headers }
    );

    if (metricsResponse.data?.errors?.length) {
      throw new Error(metricsResponse.data.errors[0].message);
    }

    status.samples = Array.isArray(metricsResponse.data?.data?.metrics) ? metricsResponse.data.data.metrics : [];
    status.metrics.samplesLoaded = status.samples.reduce((total, item) => total + (item.values?.length || 0), 0);
  } catch (error) {
    status.notes.push(`Métricas Railway indisponíveis no momento: ${error.response?.data?.errors?.[0]?.message || error.message}`);
  }

  return status;
}

async function fetchResendMonitoring(emailMonitoring) {
  const status = {
    configured: Boolean(process.env.RESEND_API_KEY),
    status: process.env.RESEND_API_KEY ? 'unknown' : 'not_configured',
    label: 'Resend',
    metrics: {
      provider: emailMonitoring.provider,
      from: emailMonitoring.from,
      volume24h: emailMonitoring.summary.last24h,
      failed24h: emailMonitoring.summary.failed
    },
    notes: []
  };

  if (!process.env.RESEND_API_KEY) {
    status.notes.push('RESEND_API_KEY não configurada; o sistema está usando o provedor de e-mail definido no ambiente.');
    return status;
  }

  try {
    const response = await axios.get('https://api.resend.com/domains', {
      timeout: 8000,
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
    });
    const domains = Array.isArray(response.data?.data) ? response.data.data : [];
    status.status = 'online';
    status.metrics.domains = domains.length;
    status.metrics.verifiedDomains = domains.filter((domain) => domain.status === 'verified').length;
    status.domains = domains.slice(0, 5).map((domain) => ({
      id: domain.id,
      name: domain.name,
      status: domain.status,
      createdAt: domain.created_at
    }));
  } catch (error) {
    const apiMessage = error.response?.data?.message || error.message;
    const lowerMessage = String(apiMessage || '').toLowerCase();
    const restrictedToSend = lowerMessage.includes('restricted to only send emails');

    status.status = restrictedToSend ? 'attention' : 'error';
    status.metrics.domainCheck = restrictedToSend ? 'Sem permissão de leitura' : 'Falha';
    status.notes.push(restrictedToSend
      ? 'A RESEND_API_KEY atual está restrita apenas ao envio de e-mails. O envio pode funcionar, mas a monitoria de domínios exige uma chave com permissão de leitura/gerenciamento de domínios.'
      : `Falha ao consultar Resend: ${apiMessage}`);
  }

  return status;
}

function parsePermissionsFromUser(user) {
  const role = user?.role || 'viewer';
  const defaultPermissions = defaultPermissionsForRole(role);
  let permissions = defaultPermissions;

  try {
    permissions = user?.permissions ? JSON.parse(user.permissions) : permissions;
  } catch (error) {
    permissions = defaultPermissions;
  }

  return Array.from(new Set(Array.isArray(permissions) ? permissions : defaultPermissions));
}

function canReceiveComplaintNotification(user) {
  if (isAdminUser(user)) {
    return true;
  }

  const permissions = parsePermissionsFromUser(user);
  return permissions.some((permission) => (
    permission === 'complaints_management'
    || permission === 'complaints_dashboard'
    || permission === 'complaints_register'
  ));
}

async function buildAuthenticatedUser(user) {
  const { password: _password, ...safeUser } = user;
  const role = safeUser.role || 'viewer';
  const permissions = parsePermissionsFromUser(safeUser);
  const clinicIds = await getUserClinicIds(user.id);
  const mustChangePassword = Boolean(user.must_change_password);
  const tokenVersion = Number(user.token_version || 1);

  return {
    ...safeUser,
    role,
    permissions,
    clinicIds,
    mustChangePassword,
    tokenVersion
  };
}

function signUserToken(user) {
  return jwt.sign({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    permissions: user.permissions,
    clinicIds: user.clinicIds,
    mustChangePassword: Boolean(user.mustChangePassword),
    tokenVersion: Number(user.tokenVersion || user.token_version || 1)
  }, SECRET);
}

async function createWhatsAppLog({
  eventKey,
  recipientPhone,
  messageBody,
  relatedUserId = null,
  relatedAppointmentId = null,
  relatedEntityType = null,
  relatedEntityId = null,
  status = 'pending'
}) {
  const [result] = await pool.query(
    `INSERT INTO whatsapp_message_logs
     (event_key, recipient_phone, related_user_id, related_appointment_id, related_entity_type, related_entity_id, message_body, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventKey || null,
      recipientPhone || null,
      relatedUserId || null,
      relatedAppointmentId || null,
      relatedEntityType || null,
      relatedEntityId || null,
      messageBody || null,
      status
    ]
  );

  return result.insertId;
}

async function updateWhatsAppLog(logId, result) {
  if (!logId) return;

  const nextStatus = result?.skipped ? 'skipped' : result?.success ? 'sent' : 'failed';
  const updateChunks = [
    'status = ?',
    'provider_message_id = ?',
    'provider_response = ?',
    'error_message = ?',
    'updated_at = NOW()'
  ];
  const values = [
    nextStatus,
    result?.providerMessageId || null,
    result?.raw ? JSON.stringify(result.raw) : null,
    result?.error || null
  ];

  if (nextStatus === 'sent') {
    updateChunks.splice(4, 0, 'sent_at = NOW()');
  }

  if (nextStatus === 'failed') {
    updateChunks.splice(4, 0, 'failed_at = NOW()');
  }

  await pool.query(
    `UPDATE whatsapp_message_logs
        SET ${updateChunks.join(', ')}
      WHERE id = ?`,
    [...values, logId]
  );
}

async function updateWhatsAppLogByProviderMessageId(providerMessageId, status, payload = {}) {
  if (!providerMessageId) return;

  const normalizedStatus = String(status || '').trim().toLowerCase();
  const updateChunks = [
    'status = ?',
    'provider_response = ?',
    'updated_at = NOW()'
  ];
  const values = [
    normalizedStatus || 'updated',
    payload ? JSON.stringify(payload) : null
  ];

  if (normalizedStatus === 'delivered') {
    updateChunks.splice(2, 0, 'delivered_at = NOW()');
  } else if (normalizedStatus === 'read') {
    updateChunks.splice(2, 0, 'read_at = NOW()');
  } else if (normalizedStatus === 'failed') {
    updateChunks.splice(2, 0, 'failed_at = NOW()');
    updateChunks.splice(2, 0, 'error_message = ?');
    values.splice(2, 0, payload?.errors?.[0]?.title || payload?.status || 'Falha reportada pelo provedor');
  }

  await pool.query(
    `UPDATE whatsapp_message_logs
        SET ${updateChunks.join(', ')}
      WHERE provider_message_id = ?`,
    [...values, providerMessageId]
  );
}

async function sendWhatsappNotification(payload = {}) {
  const message = payload?.message || '';
  const provider = getWhatsAppProvider();
  const normalizedPhone = payload?.to ? normalizeWhatsAppPhone(payload.to) : '';
  const logId = await createWhatsAppLog({
    eventKey: payload?.event || 'generic_notification',
    recipientPhone: normalizedPhone || payload?.to || null,
    messageBody: message,
    relatedUserId: payload?.userId || null,
    relatedAppointmentId: payload?.appointmentId || null,
    relatedEntityType: payload?.relatedEntityType || null,
    relatedEntityId: payload?.relatedEntityId || payload?.complaintId || payload?.npsId || null
  });

  const result = provider === 'twilio'
    ? await sendWhatsAppMessage(normalizedPhone || payload?.to, message, payload)
    : {
      success: false,
      skipped: true,
      provider,
      error: 'Somente Twilio está habilitado para WhatsApp.'
    };

  await updateWhatsAppLog(logId, result);
  return { ...result, logId };
}

async function sendWhatsappGroupNotification({ event, message, payload = null, link = null }) {
  const skippedReason = 'Envio por grupo/webhook removido. O WhatsApp oficial do sistema usa somente Twilio por template.';
  const logId = await createWhatsAppLog({
    eventKey: event || 'group_notification',
    recipientPhone: null,
    messageBody: link ? `${message}\n${link}` : message,
    relatedEntityType: 'twilio_only_group_skipped',
    relatedEntityId: payload?.complaintId || payload?.id || null,
    status: 'skipped'
  });
  await updateWhatsAppLog(logId, { skipped: true, provider: 'twilio', error: skippedReason });

  return {
    success: false,
    skipped: true,
    provider: 'twilio',
    error: 'Envio por grupo/webhook removido. Configure destinatários individuais via Twilio.'
  };
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
  return admins.map((admin) => admin.id).filter(Boolean);
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

async function notifyRolesThroughChannels(roles, type, title, message, link = null, payload = null) {
  const normalizedRoles = Array.from(new Set((roles || []).filter(Boolean)));

  if (!normalizedRoles.length) return [];

  const placeholders = normalizedRoles.map(() => '?').join(',');
  const [users] = await pool.query(
    `SELECT id, name, email, whatsapp, phone, role
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND role IN (${placeholders})`,
    normalizedRoles
  );

  await Promise.all(users.map((user) => notifyUserThroughChannels(user, type, title, message, link, payload, { role: user.role })));
  return users.map((user) => user.id);
}

async function notifyAdminsThroughChannels(type, title, message, link = null, payload = null) {
  const [users] = await pool.query(
    `SELECT DISTINCT id, name, email, whatsapp, phone, role
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND (role IN ('admin', 'master_admin') OR LOWER(email) IN (?, ?))`,
    [masterAdminEmail, defaultAdminEmail]
  );

  await Promise.all(users.map((user) => notifyUserThroughChannels(user, type, title, message, link, payload, { role: user.role })));
  return users.map((user) => user.id).filter(Boolean);
}

async function notifyUserThroughChannels(user, type, title, message, link = null, payload = null, extraWhatsappPayload = null) {
  if (!user?.id) return;

  try {
    await createNotification(user.id, type, title, message, link, payload);
  } catch (error) {
    console.warn('Nao foi possivel criar notificacao para o usuario:', error.message);
  }

  const email = getUserEmailTarget(user);
  if (email) {
    try {
      await sendEmail(email, title, buildNotificationHtml(message, link));
    } catch (error) {
      console.warn('Nao foi possivel enviar e-mail da notificacao:', error.message);
    }
  }

  const whatsapp = getUserWhatsappTarget(user);
  if (whatsapp && isWhatsAppEnabled()) {
    try {
      await sendWhatsappNotification({
        event: type,
        to: whatsapp,
        userId: user.id,
        link,
        message: link ? `${message}\n${link}` : message,
        ...(extraWhatsappPayload || {})
      });
    } catch (error) {
      console.warn('Nao foi possivel enviar WhatsApp da notificacao:', error.message);
    }
  }
}

async function sendUserAccessNotifications(user, temporaryPassword) {
  let emailSent = false;
  let whatsappSent = false;
  let emailError = null;
  let whatsappError = null;

  try {
    const emailResult = await emailService.sendWelcomeEmail({
      to: user.email,
      name: user.name,
      loginEmail: user.email,
      password: temporaryPassword,
      appUrl: appBaseUrl
    });
    emailSent = !emailResult?.skipped;
  } catch (error) {
    emailError = error.message;
    console.warn('Nao foi possivel enviar o e-mail de primeiro acesso:', error.message);
  }

  try {
    const whatsappResult = await sendWelcomeWhatsApp({
      ...user,
      temporaryPassword,
      whatsapp: user.whatsapp || user.phone
    });
    whatsappSent = Boolean(whatsappResult?.success);
    whatsappError = whatsappResult?.success ? null : whatsappResult?.error || null;
  } catch (error) {
    whatsappError = error.message;
    console.warn('Nao foi possivel enviar o WhatsApp de primeiro acesso:', error.message);
  }

  await createNotification(
    user.id,
    'password_reset',
    'Primeiro acesso liberado',
    'Seu acesso foi criado. Use a senha temporária recebida e altere a senha no primeiro login.',
    '/perfil',
    { temporaryPassword: true, firstAccess: true }
  );

  return { emailSent, whatsappSent, emailError, whatsappError };
}

async function sendRegistrationApprovedNotifications(user) {
  const emailTemplate = emailService.renderRegistrationApprovedEmail({
    name: user.name,
    appUrl: appBaseUrl
  });
  let emailSent = false;
  let whatsappSent = false;
  let emailError = null;
  let whatsappError = null;

  try {
    const emailResult = await sendEmail(user.email, emailTemplate.subject, emailTemplate.html);
    emailSent = !emailResult?.skipped;
  } catch (error) {
    emailError = error.message;
    console.warn('Nao foi possivel enviar o e-mail de aprovacao do cadastro:', error.message);
  }

  try {
    const whatsappResult = await sendApprovalWhatsApp(user);
    whatsappSent = Boolean(whatsappResult?.success);
    whatsappError = whatsappResult?.success ? null : whatsappResult?.error || null;
  } catch (error) {
    whatsappError = error.message;
    console.warn('Nao foi possivel enviar o WhatsApp de aprovacao do cadastro:', error.message);
  }

  return { emailSent, whatsappSent, emailError, whatsappError };
}

async function sendPasswordResetNotifications(user, temporaryPassword) {
  let emailSent = false;
  let whatsappSent = false;
  let emailError = null;
  let whatsappError = null;
  const changePasswordUrl = buildPasswordChangeUrl();

  try {
    const emailTemplate = emailService.renderPasswordResetEmail({
      name: user.name,
      temporaryPassword,
      appUrl: changePasswordUrl
    });
    const emailResult = await sendEmail(user.email, emailTemplate.subject, emailTemplate.html);
    emailSent = !emailResult?.skipped;
  } catch (error) {
    emailError = error.message;
    console.warn('Nao foi possivel enviar e-mail de reset de senha:', error.message);
  }

  try {
    const whatsappResult = await sendPasswordResetWhatsApp({
      ...user,
      temporaryPassword,
      whatsapp: user.whatsapp || user.phone
    });
    whatsappSent = Boolean(whatsappResult?.success);
    whatsappError = whatsappResult?.success ? null : whatsappResult?.error || null;
  } catch (error) {
    whatsappError = error.message;
    console.warn('Nao foi possivel enviar WhatsApp de reset de senha:', error.message);
  }

  await notifyMasterPasswordSecurityEvent(
    'password_reset_by_admin',
    'Senha reiniciada pelo painel',
    `${user.name || 'Colaborador'} (${user.email || 'sem e-mail'}) teve a senha reiniciada pelo painel administrativo.`,
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  );

  return { emailSent, whatsappSent, emailError, whatsappError };
}

async function sendPasswordRecoveryCodeEmail(user, code) {
  const appUrl = `${frontendUrl}/`;
  const emailTemplate = emailService.renderPasswordRecoveryCodeEmail({
    name: user.name,
    code,
    appUrl,
    expirationMinutes: passwordRecoveryCodeExpiresMinutes
  });

  return sendEmail(user.email, emailTemplate.subject, emailTemplate.html);
}

async function sendPasswordChangedNotifications(user) {
  let emailSent = false;
  let whatsappSent = false;
  let emailError = null;
  let whatsappError = null;

  const email = getUserEmailTarget(user);
  if (email) {
    try {
      const emailResult = await sendEmail(
        email,
        'Senha alterada - Sistema GRC',
        emailService.renderBrandedEmail({
          title: 'Senha alterada com sucesso',
          intro: `Olá, <strong>${user.name || 'colaborador'}</strong>.`,
          bodyHtml: `
            <p style="margin:0 0 18px;">Registramos uma alteração de senha no seu acesso ao Sistema GRC.</p>
            <p style="margin:0;">Se foi você quem realizou a mudança, nenhuma ação adicional é necessária. Se não reconhece esta alteração, procure imediatamente o administrador.</p>
          `,
          actionLabel: 'Acessar o sistema',
          actionUrl: appBaseUrl
        })
      );
      emailSent = !emailResult?.skipped;
    } catch (error) {
      emailError = error.message;
      console.warn('Não foi possível enviar e-mail de alteração de senha:', error.message);
    }
  }

  const whatsapp = getUserWhatsappTarget(user);
  if (whatsapp && isWhatsAppEnabled()) {
    try {
      const whatsappResult = await sendWhatsappNotification({
        event: 'password_changed',
        to: whatsapp,
        userId: user.id,
        message: [
          `Olá, ${user.name || 'colaborador'}.`,
          '',
          'Registramos uma alteração de senha no seu acesso ao Sistema GRC.',
          'Se foi você quem realizou a mudança, nenhuma ação adicional é necessária.',
          'Se não reconhece esta alteração, procure imediatamente o administrador.'
        ].join('\n')
      });
      whatsappSent = Boolean(whatsappResult?.success);
      whatsappError = whatsappResult?.success ? null : whatsappResult?.error || null;
    } catch (error) {
      whatsappError = error.message;
      console.warn('Não foi possível enviar WhatsApp de alteração de senha:', error.message);
    }
  }

  await notifyMasterPasswordSecurityEvent(
    'password_changed',
    'Alteração de senha registrada',
    `${user.name || 'Colaborador'} (${user.email || 'sem e-mail'}) alterou a própria senha no sistema.`,
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  );

  return { emailSent, whatsappSent, emailError, whatsappError };
}

async function notifyMasterPasswordSecurityEvent(type, title, message, payload = null) {
  const recipient = await getMasterAdminNotificationTarget();
  const link = `${frontendUrl}/admin`;
  const html = buildNotificationHtml(message, link);
  const whatsappMessage = `${message}\n\nAcesse: ${link}`;

  if (recipient.email) {
    try {
      await sendEmail(recipient.email, title, html);
    } catch (error) {
      console.warn('Não foi possível enviar e-mail de segurança ao Administrador Master:', error.message);
    }
  }

  if (recipient.whatsapp && isWhatsAppEnabled()) {
    try {
      await sendWhatsappNotification({
        event: type,
        to: recipient.whatsapp,
        userId: payload?.userId || null,
        message: whatsappMessage,
        link,
        ...(payload || {})
      });
    } catch (error) {
      console.warn('Não foi possível enviar WhatsApp de segurança ao Administrador Master:', error.message);
    }
  }
}

async function notifyClinicResponsibles(clinicId, type, title, message, link, payload = null) {
  if (!clinicId) return [];

  const [clinicRows] = await pool.query('SELECT coordinator_name FROM clinics WHERE id = ?', [clinicId]);
  const coordinatorName = String(clinicRows[0]?.coordinator_name || '').trim();
  const [users] = await pool.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.whatsapp, u.phone, u.role
      FROM users u
      INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?
      WHERE u.active = 1
        AND u.deleted_at IS NULL
        AND u.role IN ('coordinator', 'manager')`,
    [clinicId]
  );
  const filteredUsers = users.filter((user) => (
    user.id
    && (
      getUserEmailTarget(user)
      || getUserWhatsappTarget(user)
    )
  ));

  if (coordinatorName) {
    const [coordinatorUsers] = await pool.query(
      `SELECT DISTINCT id, name, email, whatsapp, phone, role
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
    await notifyUserThroughChannels(user, type, title, message, link, payload, { role: user.role });
  }));

  return filteredUsers.map((user) => user.id).filter(Boolean);
}

async function notifyOperationalComplaintTeam(title, message, link, payload = null, excludedUserIds = []) {
  const excluded = new Set((excludedUserIds || []).map((id) => Number(id)));
  const [users] = await pool.query(
    `SELECT DISTINCT id, name, email, whatsapp, phone, role
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND role IN ('sac_operator', 'supervisor_crc')`
  );
  const recipients = users.filter((user) => user.id && !excluded.has(Number(user.id)));

  await Promise.all(recipients.map(async (user) => {
    await notifyUserThroughChannels(
      user,
      'complaint_operational_alert',
      title,
      message,
      link,
      payload,
      { role: user.role }
    );
  }));

  return recipients.map((user) => user.id).filter(Boolean);
}

async function notifyComplaintAudienceByScope(clinicId, assignedResponsibleUserId, title, message, link, payload = null, excludedUserIds = []) {
  const excluded = new Set((excludedUserIds || []).map((id) => Number(id)).filter(Boolean));
  const [users] = await pool.query(
    `SELECT DISTINCT u.id, u.role, u.permissions
       FROM users u
      WHERE u.active = 1
        AND u.deleted_at IS NULL
        AND (
          u.role IN ('admin', 'master_admin')
          OR (? IS NOT NULL AND u.id = ?)
        )`,
      [assignedResponsibleUserId || null, assignedResponsibleUserId || null]
  );

  const recipients = users.filter((user) => {
    if (!user?.id || excluded.has(Number(user.id))) {
      return false;
    }

    return canReceiveComplaintNotification(user);
  });

  await Promise.all(recipients.map((user) => (
    createNotification(user.id, 'complaint_created', title, message, link, payload)
  )));

  return recipients.map((user) => user.id).filter(Boolean);
}

async function resolveClinicIdByName(clinicName) {
  if (!clinicName) return null;

  const [rows] = await pool.query(
    'SELECT id FROM clinics WHERE LOWER(name) = LOWER(?) LIMIT 1',
    [String(clinicName).trim()]
  );

  return rows[0]?.id || null;
}

async function notifyOperationalUsersForPatientEvent(record, type, title, message, payload = null) {
  const link = `${frontendUrl}/pacientes?abrir=${record.id}`;
  const clinicId = await resolveClinicIdByName(record.clinic_name);
  const notifiedUserIds = clinicId
    ? await notifyClinicResponsibles(clinicId, type, title, message, link, payload)
    : [];

  await notifyRolesThroughChannels(
    ['sac_operator', 'supervisor_crc'],
    type,
    title,
    message,
    link,
    payload
  );

  return notifiedUserIds;
}

async function dispatchAppointmentReminderForRecord(record) {
  const scheduledLabel = formatMessageDateTime(record.scheduled_at);
  const whatsappResult = await sendAppointmentReminder({
    id: record.id,
    protocol: record.protocol,
    patient: record.patient_name,
    phone: record.patient_phone,
    clinic: record.clinic_name,
    type: record.interaction_type,
    typeLabel: patientInteractionTypeLabels[record.interaction_type] || record.interaction_type,
    scheduledAt: record.scheduled_at,
    scheduledLabel
  });

  if (whatsappResult?.success) {
    await pool.query('UPDATE patient_interactions SET reminder_sent_at = NOW() WHERE id = ?', [record.id]);
  }

  return whatsappResult;
}

async function dispatchUpcomingAppointmentReminders() {
  const [rows] = await pool.query(
    `SELECT id, protocol, patient_name, patient_phone, clinic_name, interaction_type, scheduled_at
       FROM patient_interactions
      WHERE reminder_sent_at IS NULL
        AND status <> 'Cancelado'
        AND scheduled_at IS NOT NULL
        AND scheduled_at > NOW()
        AND scheduled_at <= DATE_ADD(NOW(), INTERVAL ? HOUR)`,
    [appointmentReminderLeadHours]
  );

  const results = [];

  for (const record of rows) {
    const result = await dispatchAppointmentReminderForRecord(record);
    results.push({
      id: record.id,
      protocol: record.protocol,
      success: Boolean(result?.success),
      error: result?.success ? null : result?.error || null
    });
  }

  return results;
}

async function dispatchUpcomingComplaintDeadlineReminders() {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.protocol,
       c.clinic_id,
       c.assigned_coordinator_user_id,
       c.assigned_responsible_user_id,
       c.patient_name,
       c.complaint_type,
       c.priority,
       c.created_origin,
       c.due_at,
       cl.name AS clinic_name,
       cl.city,
       cl.state
     FROM complaints c
     LEFT JOIN clinics cl ON cl.id = c.clinic_id
     WHERE c.deleted_at IS NULL
       AND c.status <> 'resolvida'
       AND c.due_at IS NOT NULL
       AND c.due_warning_sent_at IS NULL
       AND c.due_at > NOW()
       AND c.due_at <= DATE_ADD(NOW(), INTERVAL 24 HOUR)`,
    []
  );

  for (const complaint of rows) {
    const protocol = complaint.protocol || `GRC-${complaint.id}`;
    const clinic = complaint.clinic_name
      ? `${complaint.clinic_name}${complaint.city ? ` - ${complaint.city}/${complaint.state || 'UF'}` : ''}`
      : 'Unidade não informada';
    const title = `Prazo próximo de vencimento - ${protocol}`;
    const link = `${frontendUrl}/gestao/${complaint.id}`;
    const message = [
      `${title}`,
      `Paciente: ${complaint.patient_name || 'Não informado'}`,
      `Unidade: ${clinic}`,
      `Tipo: ${complaint.complaint_type || 'Não informado'}`,
      `Prioridade: ${complaint.priority || 'Não informada'}`,
      `Vencimento: ${formatMessageDateTime(complaint.due_at)}`
    ].join('\n');
    const payload = { complaintId: complaint.id, protocol, dueAt: complaint.due_at };
    const notifiedUserIds = [];

    await notifyAdminsThroughChannels('complaint_deadline_warning', title, message, link, payload).catch((error) => {
      console.warn('Não foi possível avisar administradores sobre prazo próximo:', error.message);
    });
    await notifyClinicResponsibles(complaint.clinic_id, 'complaint_deadline_warning', title, message, link, payload).catch((error) => {
      console.warn('Não foi possível avisar responsáveis da unidade sobre prazo próximo:', error.message);
    });
    await notifyOperationalComplaintTeam(title, message, link, payload, notifiedUserIds).catch((error) => {
      console.warn('Não foi possível avisar operação sobre prazo próximo:', error.message);
    });
    await notifyComplaintAudienceByScope(
      complaint.clinic_id,
        complaint.assigned_responsible_user_id || complaint.assigned_coordinator_user_id,
      title,
      message,
      link,
      payload,
      notifiedUserIds
    ).catch((error) => {
      console.warn('Não foi possível avisar audiência da reclamação sobre prazo próximo:', error.message);
    });
    await sendWhatsappGroupNotification({
      event: 'complaint_deadline_warning_group',
      message,
      payload,
      link
    }).catch((error) => {
      console.warn('Não foi possível avisar o grupo de WhatsApp sobre prazo próximo:', error.message);
    });

    await pool.query('UPDATE complaints SET due_warning_sent_at = NOW() WHERE id = ?', [complaint.id]);
  }

  return rows.length;
}

function buildExpiredComplaintManagerEmail(complaint) {
  const protocol = complaint?.protocol || `GRC-${complaint?.id || ''}`;
  const clinic = complaint?.clinic_name
    ? `${complaint.clinic_name}${complaint.city ? ` - ${complaint.city}/${complaint.state || 'UF'}` : ''}`
    : 'Unidade não informada';
  const complaintUrl = `${frontendUrl}/gestao/${complaint?.id}`;

  return {
    subject: `Reclamação vencida - protocolo ${protocol}`,
    html: emailService.renderBrandedEmail({
      eyebrow: 'Escalonamento',
      title: `Protocolo vencido ${protocol}`,
      intro: 'Olá,',
      bodyHtml: `
        <p style="margin:0 0 18px;">Uma reclamação ultrapassou o prazo configurado e requer atenção imediata da gerência.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 8px;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Paciente</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(complaint?.patient_name || 'Não informado')}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Unidade</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(clinic)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Classificação</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(complaint?.complaint_type || 'Não informado')}</td></tr>
          <tr><td style="padding:10px 0;color:#6c5a4e;">Prazo expirado em</td><td style="padding:10px 0;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(formatMessageDateTime(complaint?.due_at))}</td></tr>
        </table>
      `,
      actionLabel: 'Abrir protocolo',
      actionUrl: complaintUrl,
      footerText: 'Alerta automático de expiração de prazo do sistema Grupo Sorria.'
    })
  };
}

function buildComplaintExpiredResponsibleReminderWindowKey(now = new Date()) {
  const intervalMs = complaintExpiredReminderIntervalHours * 60 * 60 * 1000;
  return Math.floor(now.getTime() / intervalMs);
}

function buildComplaintExpiredResponsibleReminderJobKey(complaintId, now = new Date()) {
  return `complaint_expired_responsible:${complaintId}:${buildComplaintExpiredResponsibleReminderWindowKey(now)}`;
}

function buildExpiredComplaintResponsibleReminder(complaint) {
  const protocol = complaint?.protocol || `GRC-${complaint?.id || ''}`;
  const clinic = complaint?.clinic_name
    ? `${complaint.clinic_name}${complaint.city ? ` - ${complaint.city}/${complaint.state || 'UF'}` : ''}`
    : 'Unidade não informada';
  const complaintUrl = `${frontendUrl}/gestao/${complaint?.id}`;
  const responsibleName = complaint?.responsible_name || 'Responsável não informado';
  const overdueSince = formatMessageDateTime(complaint?.due_at);
  const subject = `Demanda vencida - protocolo ${protocol}`;
  const title = `Demanda vencida - ${protocol}`;
  const message = [
    `${title}`,
    `Paciente: ${complaint?.patient_name || 'Não informado'}`,
    `Unidade: ${clinic}`,
    `Responsável atual: ${responsibleName}`,
    `Prazo expirado em: ${overdueSince}`,
    '',
    'Acesse o protocolo e atualize a tratativa com urgência.',
    complaintUrl
  ].join('\n');

  return {
    protocol,
    complaintUrl,
    subject,
    title,
    message,
    html: emailService.renderBrandedEmail({
      eyebrow: 'Demanda vencida',
      title: `Protocolo vencido ${protocol}`,
      intro: `Olá, <strong>${escapeNotificationHtml(responsibleName)}</strong>.`,
      bodyHtml: `
        <p style="margin:0 0 18px;">A demanda abaixo segue vencida e requer atualização imediata no sistema.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 8px;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Paciente</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(complaint?.patient_name || 'Não informado')}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Unidade</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(clinic)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Responsável atual</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(responsibleName)}</td></tr>
          <tr><td style="padding:10px 0;color:#6c5a4e;">Prazo expirado em</td><td style="padding:10px 0;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(overdueSince)}</td></tr>
        </table>
      `,
      actionLabel: 'Abrir protocolo',
      actionUrl: complaintUrl,
      footerText: `Lembrete automático reenviado a cada ${complaintExpiredReminderIntervalHours} horas enquanto a demanda permanecer vencida.`
    })
  };
}

async function dispatchExpiredComplaintResponsibleReminders(now = new Date()) {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.protocol,
       c.patient_name,
       c.complaint_type,
       c.due_at,
       c.assigned_responsible_user_id,
       c.assigned_responsible_name,
       c.assigned_responsible_role,
       c.assigned_coordinator_user_id,
       c.assigned_coordinator_name,
       cl.name AS clinic_name,
       cl.city,
       cl.state,
       u.id AS responsible_user_id,
       u.name AS responsible_name,
       u.email AS responsible_email,
       u.whatsapp AS responsible_whatsapp,
       u.phone AS responsible_phone,
       u.role AS responsible_role
     FROM complaints c
     LEFT JOIN clinics cl ON cl.id = c.clinic_id
     LEFT JOIN users u ON u.id = COALESCE(c.assigned_responsible_user_id, c.assigned_coordinator_user_id)
     WHERE c.deleted_at IS NULL
       AND c.status <> 'resolvida'
       AND c.due_at IS NOT NULL
       AND c.due_at < NOW()
       AND u.id IS NOT NULL
       AND u.active = 1
       AND u.deleted_at IS NULL`
  );

  const results = [];

  for (const complaint of rows) {
    const jobKey = buildComplaintExpiredResponsibleReminderJobKey(complaint.id, now);
    const [existingJobRows] = await pool.query(
      'SELECT id FROM system_job_runs WHERE job_key = ? LIMIT 1',
      [jobKey]
    );

    if (existingJobRows.length) {
      continue;
    }

    const reminder = buildExpiredComplaintResponsibleReminder(complaint);
    const recipient = {
      userId: complaint.responsible_user_id,
      name: complaint.responsible_name || complaint.assigned_responsible_name || complaint.assigned_coordinator_name || 'Responsável',
      role: complaint.responsible_role || complaint.assigned_responsible_role || 'responsible',
      email: complaint.responsible_email,
      phone: complaint.responsible_whatsapp || complaint.responsible_phone
    };

    try {
      await createNotification(
        recipient.userId,
        'complaint_overdue_responsible',
        reminder.title,
        reminder.message,
        reminder.complaintUrl,
        {
          complaintId: complaint.id,
          protocol: reminder.protocol,
          dueAt: complaint.due_at,
          intervalHours: complaintExpiredReminderIntervalHours
        }
      );
    } catch (error) {
      console.warn('Não foi possível criar notificação interna de demanda vencida:', error.message);
    }

    const emailResult = await sendLoggedNotificationEmail({
      eventType: 'COMPLAINT_OVERDUE_RESPONSIBLE',
      protocol: reminder.protocol,
      recipient,
      template: {
        subject: reminder.subject,
        html: reminder.html
      }
    });

    const whatsappResult = isWhatsAppEnabled()
      ? await sendLoggedTwilioNotification({
        eventType: 'COMPLAINT_OVERDUE_RESPONSIBLE',
        protocol: reminder.protocol,
        recipient,
        message: reminder.message,
        sender: ({ to, protocol, message }) => sendTwilioGenericNotification({
          to,
          protocol,
          message,
          eventType: 'complaint_overdue_responsible',
          verifyFinalStatus: true
        })
      })
      : await (async () => {
        await insertNotificationLog({
          eventType: 'COMPLAINT_OVERDUE_RESPONSIBLE',
          protocol: reminder.protocol,
          channel: 'WHATSAPP',
          recipientPhone: recipient.phone || null,
          recipientUserId: recipient.userId,
          recipientRole: recipient.role,
          status: 'skipped',
          errorMessage: 'WhatsApp desabilitado por configuração.'
        });

        return { channel: 'WHATSAPP', status: 'skipped', reason: 'disabled' };
      })();

    await recordJobRun(jobKey, {
      complaintId: complaint.id,
      protocol: reminder.protocol,
      recipientUserId: recipient.userId,
      emailStatus: emailResult?.status || 'skipped',
      whatsappStatus: whatsappResult?.status || 'skipped'
    });

    results.push({
      complaintId: complaint.id,
      protocol: reminder.protocol,
      recipientUserId: recipient.userId,
      emailStatus: emailResult?.status || 'skipped',
      whatsappStatus: whatsappResult?.status || 'skipped'
    });
  }

  return results;
}

async function dispatchExpiredComplaintManagerAlerts() {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.protocol,
       c.clinic_id,
       c.patient_name,
       c.complaint_type,
       c.due_at,
       cl.name AS clinic_name,
       cl.city,
       cl.state
     FROM complaints c
     LEFT JOIN clinics cl ON cl.id = c.clinic_id
     WHERE c.deleted_at IS NULL
       AND c.status <> 'resolvida'
       AND c.due_at IS NOT NULL
       AND c.due_at < NOW()
       AND c.overdue_manager_notified_at IS NULL`
  );

  for (const complaint of rows) {
    const [managers] = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.email
         FROM users u
         INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?
        WHERE u.active = 1
          AND u.deleted_at IS NULL
          AND u.role = 'manager'`,
      [complaint.clinic_id]
    );

    const template = buildExpiredComplaintManagerEmail(complaint);
    const validManagers = managers.filter((manager) => isValidNotificationEmail(manager.email));

    await Promise.all(validManagers.map(async (manager) => {
      try {
        await sendEmail(manager.email, template.subject, template.html);
        await insertNotificationLog({
          eventType: 'COMPLAINT_OVERDUE_MANAGER',
          protocol: complaint.protocol,
          channel: 'EMAIL',
          recipientEmail: manager.email,
          recipientUserId: manager.id,
          recipientRole: manager.role || 'manager',
          status: 'sent'
        });
      } catch (error) {
        await insertNotificationLog({
          eventType: 'COMPLAINT_OVERDUE_MANAGER',
          protocol: complaint.protocol,
          channel: 'EMAIL',
          recipientEmail: manager.email,
          recipientUserId: manager.id,
          recipientRole: manager.role || 'manager',
          status: 'failed',
          errorMessage: error.message
        });
      }
    }));

    await pool.query('UPDATE complaints SET overdue_manager_notified_at = NOW() WHERE id = ?', [complaint.id]);
  }

  return rows.length;
}

async function dispatchNoShowNotifications(record, actor) {
  const scheduledLabel = formatMessageDateTime(record.scheduled_at);
  const payload = {
    interactionId: record.id,
    protocol: record.protocol,
    patientName: record.patient_name,
    clinicName: record.clinic_name,
    scheduledAt: record.scheduled_at,
    actorName: actor?.name || getActorName(actor)
  };
  const title = `Paciente não compareceu - ${record.protocol || `PAC-${record.id}`}`;
  const message = buildNoShowAlertMessage({
    id: record.id,
    protocol: record.protocol,
    patient: record.patient_name,
    clinic: record.clinic_name,
    scheduledAt: record.scheduled_at,
    scheduledLabel
  });

  await notifyOperationalUsersForPatientEvent(record, 'patient_no_show', title, message, payload);
  await pool.query('UPDATE patient_interactions SET no_show_alert_sent_at = NOW() WHERE id = ?', [record.id]);
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

async function resolveManagerAssignment(clinicId) {
  if (!clinicId) {
    return {
      managerUserId: null,
      managerName: 'Gerente da unidade'
    };
  }

  const [rows] = await pool.query(
    `SELECT
       u.id,
       u.name
     FROM users u
     INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?
     WHERE u.deleted_at IS NULL
       AND u.active = 1
       AND u.role = 'manager'
     ORDER BY u.name ASC
     LIMIT 1`,
    [clinicId]
  );

  return {
    managerUserId: rows[0]?.id || null,
    managerName: rows[0]?.name || 'Gerente da unidade'
  };
}

async function resolveComplaintResponsibleAssignment(clinicId, forwardRole) {
  if (forwardRole === 'coordinator') {
    const assignment = await resolveCoordinatorAssignment(clinicId);
    return {
      userId: assignment.coordinatorUserId || null,
      name: assignment.coordinatorName || 'Coordenador da unidade',
      role: 'coordinator',
      label: assignment.coordinatorName || 'Coordenador da unidade',
      clinicSnapshotName: assignment.clinicSnapshotName || null
    };
  }

  if (forwardRole === 'manager') {
    const assignment = await resolveManagerAssignment(clinicId);
    return {
      userId: assignment.managerUserId || null,
      name: assignment.managerName || 'Gerente da unidade',
      role: 'manager',
      label: assignment.managerName || 'Gerente da unidade',
      clinicSnapshotName: null
    };
  }

  if (forwardRole === 'supervisor_crc') {
    const [rows] = await pool.query(
      `SELECT id, name
         FROM users
        WHERE deleted_at IS NULL
          AND active = 1
          AND role = 'supervisor_crc'
        ORDER BY name ASC
        LIMIT 1`
    );

    return {
      userId: rows[0]?.id || null,
      name: rows[0]?.name || 'Supervisor do CRC',
      role: 'supervisor_crc',
      label: rows[0]?.name || 'Supervisor do CRC',
      clinicSnapshotName: null
    };
  }

  return {
    userId: null,
    name: null,
    role: null,
    label: null,
    clinicSnapshotName: null
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
         responsible_whatsapp,
         responsible_email,
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
       responsible_whatsapp,
       responsible_email,
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

async function getActiveClinicById(clinicId) {
  const normalizedClinicId = Number(clinicId);

  if (!Number.isInteger(normalizedClinicId) || normalizedClinicId <= 0) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT
       id,
       name,
       city,
       state,
       region,
       coordinator_name,
       responsible_whatsapp,
       responsible_email,
       active
     FROM clinics
     WHERE id = ?
       AND active = 1
     LIMIT 1`,
    [normalizedClinicId]
  );

  return rows[0] || null;
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

    const weeklyReportEmail = emailService.renderWeeklyCoordinatorReportEmail({
      coordinatorName,
      total: coordinatorRows.length,
      delayed: coordinatorRows.filter((row) => row.delayed).length,
      reportUrl: report.url
    });

    await sendEmail(
      approvalEmail,
      weeklyReportEmail.subject,
      weeklyReportEmail.html,
      [{ filename: report.fileName, path: report.filePath }]
    );
  }

  return reports;
}

function getZonedDateParts(date = new Date(), timeZone = weeklyDemandReminderTimeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return { year, month, day, hour, minute, second, dayOfWeek };
}

function getIsoWeekKeyFromLocalDate({ year, month, day }) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);

  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);

  return `${weekYear}-W${String(weekNumber).padStart(2, '0')}`;
}

function buildWeeklyUserDemandReminderJobKey(now = new Date()) {
  return `weekly_user_demand_reminder:${getIsoWeekKeyFromLocalDate(getZonedDateParts(now))}`;
}

async function shouldRunWeeklyUserDemandReminders(jobKey, now = new Date()) {
  if (!weeklyDemandReminderEnabled) return false;

  const parts = getZonedDateParts(now);

  if (parts.dayOfWeek !== weeklyDemandReminderDay || parts.hour < weeklyDemandReminderHour) {
    return false;
  }

  const [rows] = await pool.query('SELECT id FROM system_job_runs WHERE job_key = ? LIMIT 1', [jobKey]);
  return rows.length === 0;
}

async function getOpenDemandCountForUser(user) {
  const where = ["c.deleted_at IS NULL", "COALESCE(c.status, 'aberta') <> 'resolvida'"];
  const params = [];

  if (!isAdminUser(user) && user?.role !== 'sac_operator') {
    where.push('c.assigned_responsible_user_id = ?');
    params.push(user.id);
  }

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM complaints c
      WHERE ${where.join(' AND ')}`,
    params
  );

  return Number(rows[0]?.total || 0);
}

function buildWeeklyDemandReminderEmail(user, demandCount) {
  const demandLabel = demandCount === 1 ? '1 demanda aberta' : `${demandCount} demandas abertas`;

  return {
    subject: 'Lembrete semanal: verifique suas demandas',
    html: emailService.renderBrandedEmail({
      eyebrow: 'Lembrete semanal',
      title: 'Verifique suas demandas',
      intro: `Olá, <strong>${escapeNotificationHtml(user.name || 'colaborador')}</strong>.`,
      bodyHtml: `
        <p style="margin:0 0 18px;">Este é o lembrete semanal para acessar o sistema NPS/Reclamações e verificar protocolos, tratativas e retornos pendentes sob sua responsabilidade.</p>
        <div style="margin:0 0 20px;padding:16px;border:1px solid #ddcfbc;border-radius:8px;background:#ffffff;">
          <p style="margin:0;color:#6c5a4e;font-size:13px;">Resumo atual</p>
          <strong style="display:block;margin-top:4px;color:#2f2825;font-size:20px;">${escapeNotificationHtml(demandLabel)}</strong>
        </div>
        <p style="margin:0;">Acesse o painel, confira suas demandas e atualize as tratativas sempre que houver evolução.</p>
      `,
      actionLabel: 'Acessar sistema',
      actionUrl: appBaseUrl,
      footerText: 'Mensagem automática semanal do sistema Grupo Sorria.'
    })
  };
}

function buildWeeklyDemandReminderWhatsAppMessage(user, demandCount) {
  const demandLabel = demandCount === 1 ? '1 demanda aberta' : `${demandCount} demandas abertas`;

  return [
    `Olá, ${user.name || 'colaborador'}.`,
    '',
    'Lembrete semanal: acesse o sistema NPS/Reclamações e verifique suas demandas, tratativas e retornos pendentes.',
    `Resumo atual: ${demandLabel}.`,
    '',
    `Acesse: ${appBaseUrl}`
  ].join('\n');
}

async function getActiveUsersForWeeklyDemandReminder() {
  const [users] = await pool.query(
    `SELECT id, name, email, phone, whatsapp, role, active
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
      ORDER BY name ASC`
  );

  return users;
}

async function dispatchWeeklyUserDemandReminders() {
  const users = await getActiveUsersForWeeklyDemandReminder();
  const usedEmails = new Set();
  const usedPhones = new Set();
  const results = [];

  for (const user of users) {
    const demandCount = await getOpenDemandCountForUser(user);
    const email = getUserEmailTarget(user);
    const whatsapp = getUserWhatsappTarget(user);
    const userResult = {
      userId: user.id,
      email: email || null,
      whatsapp: whatsapp || null,
      demandCount,
      emailStatus: 'skipped',
      whatsappStatus: 'skipped',
      emailError: null,
      whatsappError: null
    };

    if (isValidNotificationEmail(email) && !usedEmails.has(email)) {
      usedEmails.add(email);
      const template = buildWeeklyDemandReminderEmail(user, demandCount);

      try {
        const emailResult = await sendEmail(email, template.subject, template.html);
        userResult.emailStatus = emailResult?.skipped ? 'skipped' : 'sent';
      } catch (error) {
        userResult.emailStatus = 'failed';
        userResult.emailError = error.message;
        console.warn('Não foi possível enviar lembrete semanal por e-mail:', error.message);
      }
    }

    if (whatsapp && isWhatsAppEnabled() && !usedPhones.has(whatsapp)) {
      usedPhones.add(whatsapp);

      try {
        const whatsappResult = await sendWhatsappNotification({
          event: 'weekly_user_demand_reminder',
          to: whatsapp,
          userId: user.id,
          message: buildWeeklyDemandReminderWhatsAppMessage(user, demandCount),
          relatedEntityType: 'weekly_user_demand_reminder'
        });
        userResult.whatsappStatus = whatsappResult?.skipped ? 'skipped' : whatsappResult?.success ? 'sent' : 'failed';
        userResult.whatsappError = whatsappResult?.success ? null : whatsappResult?.error || null;
      } catch (error) {
        userResult.whatsappStatus = 'failed';
        userResult.whatsappError = error.message;
        console.warn('Não foi possível enviar lembrete semanal por WhatsApp:', error.message);
      }
    }

    results.push(userResult);
  }

  return results;
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

async function runScheduledUserDemandReminders(now = new Date()) {
  const jobKey = buildWeeklyUserDemandReminderJobKey(now);

  if (!(await shouldRunWeeklyUserDemandReminders(jobKey, now))) {
    return null;
  }

  const results = await dispatchWeeklyUserDemandReminders();
  const payload = {
    users: results.length,
    emailsSent: results.filter((item) => item.emailStatus === 'sent').length,
    emailsFailed: results.filter((item) => item.emailStatus === 'failed').length,
    whatsappsSent: results.filter((item) => item.whatsappStatus === 'sent').length,
    whatsappsFailed: results.filter((item) => item.whatsappStatus === 'failed').length
  };

  await recordJobRun(jobKey, payload);

  return payload;
}

async function notifyComplaintCreated(complaintId, protocol) {
  const complaint = await getComplaintNotificationContext(complaintId) || {};
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
  let notifiedUserIds = [];

  // Canais externos de RECLAMACAO (e-mail + WhatsApp por template Twilio) ficam em
  // dispatchComplaintCreatedNotifications. Aqui mantemos apenas as notificacoes internas.
  try {
    const adminIds = await createNotificationForAdmins(
      'complaint_created',
      title,
      detailedMessage,
      link,
      payload
    );
    notifiedUserIds = [...notifiedUserIds, ...adminIds];
  } catch (error) {
    console.warn('Nao foi possivel registrar notificacao administrativa da reclamacao:', error.message);
  }

  try {
    const supervisorIds = await createNotificationForRoles(
      ['supervisor_crc'],
      'complaint_created',
      title,
      detailedMessage,
      link,
      payload
    );
    notifiedUserIds = [...notifiedUserIds, ...supervisorIds];
  } catch (error) {
    console.warn('Nao foi possivel registrar notificacao do Supervisor CRC:', error.message);
  }

  if (shouldNotifyAssignedComplaintAudience(complaint)) {
    try {
      await notifyComplaintAudienceByScope(
        complaint.clinic_id,
        complaint.assigned_responsible_user_id || null,
        title,
        detailedMessage,
        link,
        payload,
        notifiedUserIds
      );
    } catch (error) {
      console.warn('Nao foi possivel registrar notificacoes da reclamacao para a audiencia da unidade:', error.message);
    }
  }
}

async function notifyComplaintAssigned(complaintId, protocol) {
  const complaint = await getComplaintNotificationContext(complaintId);

  if (!complaint || !shouldNotifyAssignedComplaintAudience(complaint)) {
    return;
  }

  const title = `Demanda atribuída - protocolo ${protocol || complaint.protocol || complaintId}`;
  const link = `${frontendUrl}/gestao/${complaintId}`;
  const message = [
    `O protocolo ${protocol || complaint.protocol || complaintId} foi encaminhado para sua tratativa.`,
    `Paciente: ${complaint.patient_name || 'Não informado'}`,
    `Unidade: ${complaint.clinic_name || complaint.clinic_snapshot_name || 'Não informada'}`
  ].join('\n');

  try {
    await notifyComplaintAudienceByScope(
      complaint.clinic_id,
      complaint.assigned_responsible_user_id || null,
      title,
      `${message}\n\nAcesse a ficha e registre a tratativa.`,
      link,
      { complaintId, protocol: protocol || complaint.protocol || complaintId },
      []
    );
  } catch (error) {
    console.warn('Nao foi possivel registrar notificacao interna de atribuicao da reclamacao:', error.message);
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
  const includeDeleted = Boolean(query.include_deleted) && canViewDeletedRecords(user);

  if (query.id) {
    where.push('n.id = ?');
    params.push(query.id);
  }

  if (!includeDeleted) {
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

  if (user && !isAdminUser(user) && user?.role !== 'supervisor_crc') {
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
  await pool.query(
    'UPDATE nps_responses SET converted_complaint_id = ?, converted_at = NOW(), converted_by = ? WHERE id = ?',
    [result.insertId, getActorName(user), npsId]
  );
  await insertComplaintLog(result.insertId, 'nps_reclassified', `Pesquisa NPS ${npsId} reclassificada como reclamação para tratativa.`, user);
  await insertNpsLog(npsId, 'migrado_para_reclamacao', `Detrator migrado para reclamação ${protocol}.`, user);
  await notifyComplaintCreated(result.insertId, protocol);
  const notificationResult = await dispatchComplaintCreatedNotifications(result.insertId, protocol);

  return {
    complaintId: result.insertId,
    protocol,
    alreadyConverted: false,
    notificationStatus: notificationResult.notificationStatus
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

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  try {
    req.user = jwt.verify(token, SECRET);

    if (req.user?.id) {
      const [rows] = await pool.query(
        'SELECT must_change_password, token_version, active FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [req.user.id]
      );

      if (!rows.length || !rows[0]?.active) {
        return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
      }

      const tokenVersion = Number(rows[0]?.token_version || 1);

      if (Number(req.user?.tokenVersion || 1) !== tokenVersion) {
        return res.status(401).json({ error: 'Sessão expirada por atualização de segurança. Faça login novamente.' });
      }

      const mustChangePassword = Boolean(rows[0]?.must_change_password);
      req.user.tokenVersion = tokenVersion;
      req.user.mustChangePassword = mustChangePassword;

      if (mustChangePassword && !isPasswordChangeRouteAllowed(req)) {
        return res.status(403).json({
          error: 'Troca obrigatória de senha no primeiro acesso.',
          mustChangePassword: true
        });
      }
    }

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

    if (!req.user?.id) {
      return next();
    }

    return pool.query(
      'SELECT token_version, active FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    ).then(([rows]) => {
      if (!rows.length || !rows[0]?.active) {
        return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
      }

      const tokenVersion = Number(rows[0]?.token_version || 1);

      if (Number(req.user?.tokenVersion || 1) !== tokenVersion) {
        return res.status(401).json({ error: 'Sessão expirada por atualização de segurança. Faça login novamente.' });
      }

      req.user.tokenVersion = tokenVersion;
      return next();
    }).catch((error) => {
      console.error(error);
      return res.status(500).json({ error: 'Não foi possível validar a sessão.' });
    });
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

async function handleManualWhatsAppSend(req, res, eventKey = 'manual_test') {
  try {
    const parsed = parseBodyWithSchema(manualWhatsAppSchema, req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const rawPhone = parsed.data.telefone || parsed.data.phone;
    const rawMessage = parsed.data.mensagem || parsed.data.message;
    const phone = normalizeWhatsAppPhone(rawPhone);
    const message = eventKey === 'manual_test'
      ? 'Envio de mensagem teste'
      : String(rawMessage || '').trim();

    if (!phone) {
      return res.status(400).json({ error: 'Informe o telefone em padrão E.164.' });
    }

    const result = await sendWhatsappNotification({
      event: eventKey,
      to: phone,
      message,
      userId: req.user?.id,
      verifyFinalStatus: true
    });

    if (!result?.success && !result?.skipped) {
      return res.status(502).json({
        success: false,
        provider: result?.provider || getWhatsAppProvider(),
        to: phone,
        providerMessageId: result?.providerMessageId || null,
        status: result?.status || null,
        errorCode: result?.errorCode || null,
        error: result?.error || 'Falha ao enviar a mensagem de WhatsApp.'
      });
    }

    return res.json({
      success: Boolean(result?.success),
      provider: result?.provider || getWhatsAppProvider(),
      to: phone,
      providerMessageId: result?.providerMessageId || null,
      status: result?.status || null,
      errorCode: result?.errorCode || null,
      error: result?.success ? null : result?.error || null,
      warning: result?.skipped ? result?.error || 'O envio foi ignorado por configuração do provedor.' : null
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: 'Erro ao enviar WhatsApp de teste.' });
  }
}

app.post('/api/test-whatsapp', authenticate, requireAdmin, async (req, res) => {
  return handleManualWhatsAppSend(req, res, 'manual_test');
});

app.post('/api/whatsapp/enviar', authenticate, requireMasterAdmin, async (req, res) => {
  return handleManualWhatsAppSend(req, res, 'manual_send');
});

app.post('/api/test-email', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const parsed = parseBodyWithSchema(testEmailSchema, req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const payload = parsed.data;
    const to = payload.to || masterAdminEmail;
    const loginEmail = payload.loginEmail || to;

    const template = emailService.renderOperationalTestEmail({
      name: payload.name || 'Administrador Master',
      loginEmail,
      appUrl: appBaseUrl
    });

    const result = await sendEmail(to, template.subject, template.html);

    return res.json({
      success: !result?.skipped,
      provider: result?.provider || emailService.getEmailProvider(),
      to,
      messageId: result?.id || null,
      warning: result?.skipped ? 'O envio foi ignorado por configuração do provedor.' : null
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro ao enviar o e-mail de teste.'
    });
  }
});

app.post('/api/admin/bulk-email', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const parsed = parseBodyWithSchema(bulkEmailSchema, req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const { subject, message } = parsed.data;
    const platformUrl = appBaseUrl;
    const messageHtml = String(message)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br />');
    const [users] = await pool.query(
      `SELECT id, name, email
         FROM users
        WHERE active = 1
          AND deleted_at IS NULL
          AND email IS NOT NULL
          AND TRIM(email) <> ''
        ORDER BY name ASC`
    );

    const seenEmails = new Set();
    const selectedIds = new Set(
      Array.isArray(parsed.data.userIds)
        ? parsed.data.userIds.map((value) => String(value))
        : []
    );

    const recipients = users.filter((user) => {
      const email = getUserEmailTarget(user);

      if (!email || seenEmails.has(email)) {
        return false;
      }

      if (selectedIds.size > 0 && !selectedIds.has(String(user.id))) {
        return false;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return false;
      }

      seenEmails.add(email);
      return true;
    });

    if (!recipients.length) {
      return res.status(400).json({ error: 'Nenhum usuário ativo com e-mail válido foi encontrado para o disparo.' });
    }

    const html = emailService.renderBrandedEmail({
      eyebrow: 'Comunicado administrativo',
      title: subject,
      intro: 'Olá,',
      bodyHtml: `
        <p style="margin:0 0 18px;font-size:15px;color:#2f2825;">${messageHtml}</p>
        <p style="margin:0;font-size:13px;color:#6c5a4e;word-break:break-all;">
          <strong>Link da plataforma:</strong>
          <a href="${platformUrl}" style="color:#8e6731;text-decoration:none;">${platformUrl}</a>
        </p>
      `,
      actionLabel: 'Acessar plataforma',
      actionUrl: platformUrl,
      supportText: 'Portal de relacionamento e gestão de demandas',
      footerText: 'Este é um comunicado operacional do sistema. Em caso de dúvida, procure o Administrador Master.'
    });

    const results = [];

    for (const recipient of recipients) {
      try {
        const result = await sendEmail(recipient.email, subject, html);
        results.push({
          email: recipient.email,
          status: result?.skipped ? 'skipped' : 'sent',
          provider: result?.provider || emailService.getEmailProvider(),
          messageId: result?.id || null
        });
      } catch (error) {
        results.push({
          email: recipient.email,
          status: 'failed',
          provider: error?.provider || emailService.getEmailProvider(),
          error: error.message || 'Falha ao enviar o comunicado.'
        });
      }
    }

    const summary = results.reduce((accumulator, item) => {
      accumulator[item.status] = (accumulator[item.status] || 0) + 1;
      return accumulator;
    }, {});

    return res.json({
      success: (summary.sent || 0) > 0,
      subject,
      message,
      platformUrl,
      recipients: recipients.length,
      summary: {
        sent: summary.sent || 0,
        skipped: summary.skipped || 0,
        failed: summary.failed || 0
      },
      failures: results
        .filter((item) => item.status === 'failed')
        .map((item) => ({ email: item.email, error: item.error || 'Falha no envio.' }))
        .slice(0, 20)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar o disparo em massa.'
    });
  }
});

app.post('/api/test-upload', authenticate, requireMasterAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Selecione um arquivo para testar o upload.' });
    }

    await persistUploadedFile(req.file);

    const fileUrl = `/uploads/${req.file.filename}`;
    const publicUrl = `${publicBaseUrl.replace(/\/$/, '')}${fileUrl}`;

    return res.status(201).json({
      success: true,
      fileUrl,
      publicUrl,
      filename: req.file.filename,
      originalName: normalizeUploadedOriginalName(req.file) || req.file.originalname || req.file.filename,
      sizeBytes: req.file.size || null,
      mimeType: req.file.mimetype || null
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível testar o upload.' });
  }
});

app.delete('/api/test-upload/:filename', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const filename = getStoredUploadFilename(`/uploads/${req.params.filename || ''}`);

    if (!filename) {
      return res.status(400).json({ error: 'Arquivo de teste inválido.' });
    }

    await deletePersistedUploadedFile(`/uploads/${filename}`);

    const filePath = resolveStoredUploadFilePath(`/uploads/${filename}`);

    if (filePath) {
      try {
        await fs.promises.unlink(filePath);
      } catch (fileError) {
        if (fileError.code !== 'ENOENT') {
          console.warn('Não foi possível remover o arquivo físico do teste de upload:', fileError.message);
        }
      }
    }

    return res.json({ success: true, message: 'Arquivo de teste removido.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível remover o upload de teste.' });
  }
});

app.get('/admin/master-monitoring', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');

    const [overview, runtime, database, activity, email, whatsapp] = await Promise.all([
      getOverviewMetrics(),
      getRuntimeMetrics(),
      getDatabaseMonitoring(),
      getActivityMonitoring(),
      getEmailMonitoring(),
      getWhatsAppMonitoring()
    ]);
    const [vercel, railway, resend] = await Promise.all([
      fetchVercelMonitoring(),
      fetchRailwayMonitoring(),
      fetchResendMonitoring(email)
    ]);

    return res.json({
      generatedAt: new Date().toISOString(),
      refreshMs: 15000,
      overview,
      runtime,
      database,
      activity,
      email,
      whatsapp,
      providers: {
        vercel,
        railway,
        resend,
        twilio: whatsapp
      },
      monitors: [
        'Auditoria central de POST/PATCH/DELETE',
        'Movimentações de protocolos, NPS e relacionamento',
        'Volume e falhas de e-mails enviados pelo sistema',
        'Volume e falhas de WhatsApp',
        'Saúde do Node/API, CPU local e memória',
        'Latência, conexões, storage e queries lentas do MySQL',
        'Deploys e status público da Vercel',
        'CPU, memória e disco Railway quando tokens e IDs estiverem configurados'
      ]
    });
  } catch (error) {
    console.error('Erro ao carregar monitoria master:', error);
    return res.status(500).json({ error: 'Não foi possível carregar a monitoria master.' });
  }
});

app.post('/auth/request-password-reset', passwordRecoveryRequestLimiter, async (req, res) => {
  try {
    const parsed = parseBodyWithSchema(passwordResetRequestSchema, req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const normalizedEmail = String(parsed.data.email || '').trim().toLowerCase();
    const [rows] = await pool.query(
      `SELECT id, name, email, role
         FROM users
        WHERE LOWER(email) = ?
          AND active = 1
          AND deleted_at IS NULL
        LIMIT 1`,
      [normalizedEmail]
    );

    if (!rows.length) {
      return res.json({
        success: true,
        message: 'Se o e-mail estiver cadastrado, o código de recuperação será enviado.'
      });
    }

    const user = rows[0];
    const code = generateVerificationCode(6);
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + passwordRecoveryCodeExpiresMinutes * 60 * 1000);

    await pool.query(
      'UPDATE password_reset_requests SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
      [user.id]
    );
    await pool.query(
      `INSERT INTO password_reset_requests
       (user_id, email, code_hash, expires_at, requested_ip)
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, user.email, codeHash, toMysqlDateTime(expiresAt), getRequestIp(req)]
    );

    await sendPasswordRecoveryCodeEmail(user, code);
    await notifyMasterPasswordSecurityEvent(
      'password_recovery_requested',
      'Solicitação de recuperação de senha',
      `${user.name || 'Colaborador'} (${user.email}) solicitou a recuperação de senha no portal.`,
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    );

    return res.json({
      success: true,
      message: 'Código de recuperação enviado por e-mail.'
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível iniciar a recuperação de senha.' });
  }
});

app.post('/auth/reset-password-with-code', passwordRecoveryRequestLimiter, async (req, res) => {
  try {
    const parsed = parseBodyWithSchema(passwordResetConfirmSchema, req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    if (!isStrongPassword(parsed.data.new_password)) {
      return res.status(400).json({
        error: 'A nova senha deve ter no mínimo 8 caracteres, letra maiúscula, letra minúscula, número e caractere especial.'
      });
    }

    const normalizedEmail = String(parsed.data.email || '').trim().toLowerCase();
    const [userRows] = await pool.query(
      `SELECT id, name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password, token_version, created_at, updated_at
         FROM users
        WHERE LOWER(email) = ?
          AND active = 1
          AND deleted_at IS NULL
        LIMIT 1`,
      [normalizedEmail]
    );

    if (!userRows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = userRows[0];
    const [requestRows] = await pool.query(
      `SELECT id, code_hash, expires_at
         FROM password_reset_requests
        WHERE user_id = ?
          AND used_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [user.id]
    );

    if (!requestRows.length) {
      return res.status(400).json({ error: 'Solicitação de recuperação não encontrada ou já utilizada.' });
    }

    const requestRow = requestRows[0];
    if (new Date(requestRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'O código de recuperação expirou. Solicite um novo código.' });
    }

    const validCode = await bcrypt.compare(parsed.data.code, requestRow.code_hash);

    if (!validCode) {
      return res.status(401).json({ error: 'Código de recuperação inválido.' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.new_password, 10);

    await pool.query(
      'UPDATE users SET password = ?, must_change_password = 0, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
      [passwordHash, user.id]
    );
    await pool.query('UPDATE password_reset_requests SET used_at = NOW() WHERE id = ?', [requestRow.id]);

    await sendPasswordChangedNotifications(user);

    return res.json({
      success: true,
      message: 'Senha alterada com sucesso. Faça login com a nova senha.'
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível concluir a redefinição de senha.' });
  }
});

app.get('/webhook/whatsapp', (req, res) => {
  return res.status(410).json({
    success: false,
    provider: 'twilio',
    error: 'Webhook Meta removido. O WhatsApp oficial do sistema usa somente Twilio.'
  });
});

app.post('/webhook/whatsapp', async (req, res) => {
  return res.status(410).json({
    success: false,
    provider: 'twilio',
    error: 'Webhook Meta removido. O WhatsApp oficial do sistema usa somente Twilio.'
  });
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
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

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

    const registrationReviewEmail = emailService.renderRegistrationReviewEmail({
      name,
      email: normalizedEmail,
      position,
      profileLabel: accessProfiles[role],
      phone: normalizedPhone,
      whatsapp: normalizedWhatsapp,
      department,
      approvalLink
    });

    await sendEmail(approvalEmail, registrationReviewEmail.subject, registrationReviewEmail.html);
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
       (name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         role = VALUES(role),
         position = VALUES(position),
         phone = VALUES(phone),
         whatsapp = VALUES(whatsapp),
         department = VALUES(department),
         permissions = VALUES(permissions),
         must_change_password = 0,
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

    const [[approvedUser]] = await pool.query(
      'SELECT id, name, email, phone, whatsapp FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [request.email]
    );
    const notificationResult = approvedUser
      ? await sendRegistrationApprovedNotifications(approvedUser)
      : null;

    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; color: #102033;">
          <h1>Cadastro aprovado</h1>
          <p>O acesso de <strong>${request.name}</strong> foi liberado.</p>
          ${notificationResult && (!notificationResult.emailSent || !notificationResult.whatsappSent)
            ? '<p style="color:#8a6d3b;">O acesso foi aprovado, mas houve falha em uma das notificações automáticas.</p>'
            : ''}
          <a href="${frontendUrl}">Abrir Sistema GRC</a>
        </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('<h1>Erro ao aprovar cadastro.</h1>');
  }
});
app.get('/admin/options', authenticate, requireMasterAdmin, (req, res) => {
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
       (name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         role = VALUES(role),
         position = VALUES(position),
         phone = VALUES(phone),
         whatsapp = VALUES(whatsapp),
         department = VALUES(department),
         permissions = VALUES(permissions),
         must_change_password = 0,
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
    const [[approvedUser]] = await pool.query(
      'SELECT id, name, email, phone, whatsapp FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [request.email]
    );
    const notificationResult = approvedUser
      ? await sendRegistrationApprovedNotifications(approvedUser)
      : null;
    await createNotificationForAdmins(
      'registration_approved',
      'Cadastro aprovado',
      `${request.name} foi aprovado por ${getActorName(req.user)}.`,
      '/home',
      { requestId: request.id }
    );

    res.json({
      message: 'Cadastro aprovado com sucesso.',
      notifications: notificationResult
    });
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
    const rejectedEmail = emailService.renderRegistrationRejectedEmail({
      name: request.name
    });
    await sendEmail(request.email, rejectedEmail.subject, rejectedEmail.html);
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

app.get('/admin/users', authenticate, requireMasterAdmin, async (req, res) => {
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

app.post('/admin/users', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const parsed = parseBodyWithSchema(adminUserCreateSchema, req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

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
    } = parsed.data;

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
    const normalizedClinicIds = Array.isArray(clinicIds)
      ? clinicIds
        .map((clinicId) => Number(clinicId))
        .filter((clinicId) => Number.isFinite(clinicId) && clinicId > 0)
      : [];
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const [result] = await pool.query(
      `INSERT INTO users
       (name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        String(name).trim(),
        normalizedEmail,
        passwordHash,
        role,
        String(position).trim(),
        normalizedPhone,
        normalizedWhatsapp,
        String(department || '').trim() || null,
        JSON.stringify(allowedPermissions),
        requirePasswordChangeOnFirstLogin ? 1 : 0
      ]
    );

    if (normalizedClinicIds.length) {
      await Promise.all(normalizedClinicIds.map((clinicId) => (
        pool.query(
          'INSERT INTO user_clinics (user_id, clinic_id, can_edit) VALUES (?, ?, 1)',
          [result.insertId, clinicId]
        )
      )));
    }

    const notificationResult = await sendUserAccessNotifications(
      {
        id: result.insertId,
        name: String(name).trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        whatsapp: normalizedWhatsapp,
        role
      },
      temporaryPassword
    );

    const warning = !notificationResult.emailSent
      ? 'Usuário criado, mas houve falha no envio do e-mail com a senha temporária.'
      : null;

    res.status(201).json({
      message: 'Usuário criado com sucesso. O link de acesso foi enviado com a senha temporária.',
      id: result.insertId,
      notifications: notificationResult,
      ...(warning ? { warning } : {})
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});
app.patch('/admin/users/:id', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const current = rows[0];
    const requestedRole = req.body.role || current.role;
    const currentEmail = String(current.email || '').toLowerCase();
    const requestedEmail = Object.prototype.hasOwnProperty.call(req.body || {}, 'email')
      ? String(req.body.email || '').trim().toLowerCase()
      : currentEmail;

    const parsedEmail = z.string().trim().email('Informe um e-mail válido.').max(180).safeParse(requestedEmail);

    if (!parsedEmail.success) {
      return res.status(400).json({ error: parsedEmail.error.issues[0]?.message || 'Informe um e-mail válido.' });
    }

    if (requestedRole === 'master_admin' && currentEmail !== masterAdminEmail) {
      return res.status(403).json({ error: 'Administrador Master é exclusivo para henrique.martins@grcconsultoria.net.br.' });
    }

    if (currentEmail === masterAdminEmail && requestedEmail !== masterAdminEmail) {
      return res.status(403).json({ error: 'O e-mail do Administrador Master não pode ser alterado.' });
    }

    if (requestedEmail === masterAdminEmail && currentEmail !== masterAdminEmail) {
      return res.status(403).json({ error: 'O e-mail do Administrador Master é exclusivo do usuário master.' });
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

    if (requestedEmail !== currentEmail) {
      const [duplicates] = await pool.query(
        'SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? AND deleted_at IS NULL',
        [requestedEmail, current.id]
      );

      if (duplicates.length) {
        return res.status(409).json({ error: 'Já existe outro usuário ativo com este e-mail.' });
      }
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
              email = ?,
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
        requestedEmail,
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

app.post('/admin/users/:id/reset-password', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, role, email, name, phone, whatsapp FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);

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

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await pool.query(
      'UPDATE users SET password = ?, must_change_password = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
      [passwordHash, requirePasswordChangeOnFirstLogin ? 1 : 0, user.id]
    );
    await createNotification(
      user.id,
      'password_reset',
      'Senha reiniciada',
      'Sua senha foi reiniciada pelo administrador. Use a senha temporária recebida e altere no primeiro acesso.',
      '/perfil',
      { temporaryPassword: true }
    );

    const notificationResult = await sendPasswordResetNotifications(user, temporaryPassword);

    res.json({
      message: 'Senha reiniciada com sucesso.',
      notifications: notificationResult
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao reiniciar senha.' });
  }
});

app.post('/admin/users/resend-pending-passwords', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, role, email, name, phone, whatsapp
        FROM users
       WHERE active = 1
         AND deleted_at IS NULL
         AND must_change_password = 1
         AND LOWER(email) <> ?
       ORDER BY name ASC
    `, [masterAdminEmail]);

    if (!rows.length) {
      return res.json({
        message: 'Nenhum usuário pendente de troca de senha foi encontrado.',
        summary: { processed: 0, sent: 0, failed: 0 }
      });
    }

    const results = [];

    for (const user of rows) {
      try {
        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        await pool.query(
          'UPDATE users SET password = ?, must_change_password = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
          [passwordHash, requirePasswordChangeOnFirstLogin ? 1 : 0, user.id]
        );

        await createNotification(
          user.id,
          'password_reset',
          'Senha temporária reenviada',
          'Sua senha temporária foi reenviada. Use a nova senha recebida e altere-a no primeiro acesso.',
          '/perfil',
          { temporaryPassword: true, resendPending: true }
        );

        const notificationResult = await sendPasswordResetNotifications(user, temporaryPassword);
        results.push({
          id: user.id,
          email: user.email,
          emailSent: Boolean(notificationResult?.emailSent),
          whatsappSent: Boolean(notificationResult?.whatsappSent),
          error: notificationResult?.emailSent || notificationResult?.whatsappSent
            ? null
            : notificationResult?.emailError || notificationResult?.whatsappError || 'Falha ao reenviar as credenciais.'
        });
      } catch (error) {
        results.push({
          id: user.id,
          email: user.email,
          emailSent: false,
          whatsappSent: false,
          error: error.message || 'Falha ao processar o reenvio da senha temporária.'
        });
      }
    }

    const summary = results.reduce((accumulator, item) => {
      accumulator.processed += 1;
      if (item.emailSent) {
        accumulator.sent += 1;
      } else {
        accumulator.failed += 1;
      }
      return accumulator;
    }, { processed: 0, sent: 0, failed: 0 });

    return res.json({
      message: 'Reenvio das senhas temporárias processado.',
      summary,
      failures: results
        .filter((item) => !item.emailSent)
        .map((item) => ({ email: item.email, error: item.error || 'Falha ao enviar e-mail.' }))
        .slice(0, 20)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao reenviar as senhas temporárias pendentes.' });
  }
});

app.delete('/admin/users/:id', authenticate, requireMasterAdmin, async (req, res) => {
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

    const authenticatedUser = await buildAuthenticatedUser(user);
    const token = signUserToken(authenticatedUser);

    res.json({
      message: 'Login ok',
      success: true,
      token,
      passwordChangeRequired: Boolean(authenticatedUser.mustChangePassword),
      user: authenticatedUser
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

async function changeUserPassword({ userId, currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) {
    const error = new Error('Informe a senha atual e a nova senha.');
    error.statusCode = 400;
    throw error;
  }

  if (!isStrongPassword(newPassword)) {
    const error = new Error('A nova senha deve ter no mínimo 8 caracteres, letra maiúscula, letra minúscula, número e caractere especial.');
    error.statusCode = 400;
    throw error;
  }

  if (String(currentPassword) === String(newPassword)) {
    const error = new Error('A nova senha deve ser diferente da senha atual.');
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.query(
    `SELECT id, name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password, token_version, created_at, updated_at
       FROM users
      WHERE id = ? AND deleted_at IS NULL`,
    [userId]
  );

  if (!rows.length) {
    const error = new Error('Usuário não encontrado.');
    error.statusCode = 404;
    throw error;
  }

  const user = rows[0];
  const validPassword = user.password === currentPassword || await bcrypt.compare(currentPassword, user.password);

  if (!validPassword) {
    const error = new Error('Senha atual inválida.');
    error.statusCode = 401;
    throw error;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    'UPDATE users SET password = ?, must_change_password = 0, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
    [passwordHash, user.id]
  );

  await sendPasswordChangedNotifications(user);

  const [updatedRows] = await pool.query(
    `SELECT id, name, email, role, position, phone, whatsapp, department, permissions, active, must_change_password, token_version, created_at, updated_at
       FROM users
      WHERE id = ?`,
    [user.id]
  );
  const authenticatedUser = await buildAuthenticatedUser(updatedRows[0]);

  return {
    user: authenticatedUser,
    token: signUserToken(authenticatedUser)
  };
}

app.post('/api/change-initial-password', initialPasswordChangeLimiter, authenticate, async (req, res) => {
  try {
    if (!req.user?.mustChangePassword) {
      return res.status(409).json({ error: 'A troca inicial de senha já foi concluída.' });
    }

    const parsed = parseBodyWithSchema(changeInitialPasswordSchema, req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const result = await changeUserPassword({
      userId: req.user.id,
      currentPassword: parsed.data.current_password,
      newPassword: parsed.data.new_password
    });

    res.json({
      message: 'Senha inicial alterada com sucesso.',
      token: result.token,
      user: result.user
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao alterar a senha inicial.' });
  }
});

app.post('/profile/change-password', initialPasswordChangeLimiter, authenticate, async (req, res) => {
  try {
    const parsed = parseBodyWithSchema(changeInitialPasswordSchema, req.body);

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const result = await changeUserPassword({
      userId: req.user.id,
      currentPassword: parsed.data.current_password,
      newPassword: parsed.data.new_password
    });

    res.json({
      message: req.user?.mustChangePassword ? 'Senha inicial alterada com sucesso.' : 'Senha alterada com sucesso.',
      token: result.token,
      user: result.user
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao alterar senha.' });
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
    await createNpsCreatedInAppNotifications({
      npsId: npsInsert.insertId,
      protocol,
      patientName: patient_name,
      clinicId: clinic_id,
      npsProfile
    });
    const notificationResult = await dispatchNpsCreatedNotifications(npsInsert.insertId, protocol);

    res.status(201).json({
      message: 'NPS salvo com sucesso.',
      protocol,
      npsId: npsInsert.insertId,
      notificationStatus: notificationResult.notificationStatus
    });

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
         VALUES (?, ?, ?, 'NPS', ?, ?, 'Pesquisa de satisfação', 'aberta', ?, ?, ?, 'Externo')`,
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
      await dispatchComplaintCreatedNotifications(result.insertId, protocol);
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

    await createNpsCreatedInAppNotifications({
      npsId: npsInsert.insertId,
      protocol,
      patientName: patient_name,
      clinicId: clinic_id,
      npsProfile
    });
    const notificationResult = await dispatchNpsCreatedNotifications(npsInsert.insertId, protocol);

    if (duplicatePhoneEntry && Number(duplicatePhoneEntry.total) > 1) {
      await alertDuplicateNpsPhone(normalizedPatientPhone, protocol, npsInsert.insertId);
    }

    res.status(201).json({
      message: 'Pesquisa NPS salva com sucesso.',
      protocol,
      npsId: npsInsert.insertId,
      notificationStatus: notificationResult.notificationStatus,
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
      ? decodeUploadedText(fs.readFileSync(req.file.path))
      : decodeUploadedText(req.body?.content || '');

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
    const includeDeleted = Boolean(req.query.include_deleted) && canViewDeletedRecords(req.user);
    const where = [];
    const params = [];

    if (!includeDeleted) {
      where.push("status <> 'Cancelado'");
    }

    if (!isAdminUser(req.user) && !['sac_operator', 'supervisor_crc'].includes(req.user?.role)) {
      const clinicIds = await getUserClinicIds(req.user.id);

      if (clinicIds.length) {
        const [clinicRows] = await pool.query(
          'SELECT name FROM clinics WHERE id IN (?) AND active = 1',
          [clinicIds]
        );
        const clinicNames = clinicRows
          .map((row) => String(row.name || '').trim())
          .filter(Boolean);

        if (clinicNames.length) {
          where.push('clinic_name IN (?)');
          params.push(clinicNames);
        } else {
          where.push('1 = 0');
        }
      } else {
        where.push('1 = 0');
      }
    }

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
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY COALESCE(cancelled_at, created_at) DESC, id DESC`,
      params
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

    const [rows] = await pool.query(
      'SELECT id, protocol, patient_name, patient_phone, clinic_name, interaction_type, scheduled_at, no_show_alert_sent_at FROM patient_interactions WHERE id = ?',
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    const currentRecord = rows[0];

    await pool.query(
      'UPDATE patient_interactions SET status = ?, cancelled_at = NULL, cancelled_by_name = NULL, cancelled_by_role = NULL WHERE id = ?',
      [status, req.params.id]
    );
    await insertPatientInteractionLog(req.params.id, action, `Status atualizado para ${status}.`, req.user);

    if (isNoShowStatus(status) && !currentRecord.no_show_alert_sent_at) {
      await dispatchNoShowNotifications({
        ...currentRecord,
        status
      }, req.user);
    }

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

app.get('/complaints/unit-options', authenticate, async (req, res) => {
  try {
    if (!canChangeComplaintUnit(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode alterar a unidade do protocolo.' });
    }

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

    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar unidades para alteração.' });
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
      ? `/uploads/${req.file.filename}`
      : null;

    if (req.file) {
      await persistUploadedFile(req.file);
    }

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
    await insertComplaintLog(result.insertId, 'created', `Protocolo ${protocol} cadastrado com origem ${normalizedOrigin}.`, {
      name: normalizedOrigin === 'Interno' ? 'Usuário interno' : normalizedOrigin,
      role: normalizedOrigin.toLowerCase()
    });
    let notificationResult = { notificationStatus: 'failed' };

    try {
      await notifyComplaintCreated(result.insertId, protocol);
    } catch (error) {
      console.warn('Nao foi possivel concluir notificacoes internas do protocolo:', error.message);
    }

    notificationResult = await dispatchComplaintCreatedNotifications(result.insertId, protocol);

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
          const marketingProtocolEmail = emailService.renderMarketingProtocolEmail({
            protocol,
            patientName: patient_name,
            clinicName: selectedClinic?.name || clinic_name || '',
            complaintUrl: `${frontendUrl}/reclamacoes/${result.insertId}`
          });

          await sendEmail(
            approvalEmail,
            marketingProtocolEmail.subject,
            marketingProtocolEmail.html
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
      protocol,
      notificationStatus: notificationResult.notificationStatus
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

app.post('/complaints/:id/renotify', authenticate, async (req, res) => {
  try {
    if (!canRenotifyComplaint(req.user)) {
      return res.status(403).json({
        error: 'Somente o Supervisor do CRC ou Operador de SAC pode reenviar essas notificações.'
      });
    }

    const rows = await getComplaintRows({
      id: req.params.id,
      user: req.user,
      includeDeleted: false
    });
    const complaint = rows[0];

    if (!complaint) {
      return res.status(404).json({ error: 'Protocolo não encontrado.' });
    }

    let notificationResult;

    if (shouldNotifyAssignedComplaintAudience(complaint)) {
      await notifyComplaintAssigned(complaint.id, complaint.protocol);
      notificationResult = await dispatchComplaintAssignedNotifications(complaint.id, complaint.protocol);
    } else {
      await notifyComplaintCreated(complaint.id, complaint.protocol);
      notificationResult = await dispatchComplaintCreatedNotifications(complaint.id, complaint.protocol);
    }

    await insertComplaintLog(complaint.id, 'renotificado', `Notificações reenviadas por ${getActorName(req.user)}.`, req.user);

    return res.json({
      message: 'Notificações reenviadas aos responsáveis.',
      notificationStatus: notificationResult.notificationStatus
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível reenviar as notificações do protocolo.' });
  }
});

app.post('/complaints/:id/reactivate', authenticate, async (req, res) => {
  try {
    if (!canReactivateComplaint(req.user)) {
      return res.status(403).json({
        error: 'Somente o Administrador Master ou Supervisor do CRC podem reabilitar este protocolo.'
      });
    }

    const rows = await getComplaintRows({
      id: req.params.id,
      user: req.user,
      include_deleted: 1
    }, req.user);
    const complaint = rows[0];

    if (!complaint) {
      return res.status(404).json({ error: 'Protocolo não encontrado.' });
    }

    if (!complaint.deleted_at && complaint.status !== 'resolvida') {
      return res.status(409).json({ error: 'Este protocolo já está habilitado para tratativa.' });
    }

    const reactivateReason = String(req.body?.reason || '').trim();

    if (!reactivateReason) {
      return res.status(400).json({ error: 'Informe o motivo da reabertura para re-habilitar a reclamação.' });
    }

    const restoredStatus = complaint.treatment_at || complaint.first_attendance_at || complaint.patient_contacted_at
      ? 'em_andamento'
      : 'aberta';
    const actorName = getActorName(req.user);

    await pool.query(
      `UPDATE complaints
          SET status = ?,
              deleted_at = NULL,
              deleted_by = NULL,
              deletion_reason = NULL,
              closed_at = NULL,
              closed_by_role = NULL,
              sac_approval_at = NULL,
              sac_approval_by = NULL,
              updated_at = NOW()
        WHERE id = ?`,
      [restoredStatus, req.params.id]
    );

    await insertComplaintLog(
      req.params.id,
      'reactivated',
      `Protocolo reabilitado por ${actorName}. Status retomado para ${restoredStatus}. Motivo: ${reactivateReason}`,
      req.user
    );

    return res.json({
      message: 'Reclamação reabilitada com sucesso.',
      status: restoredStatus
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível reabilitar o protocolo.' });
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
      return res.status(403).json({ error: 'Seu perfil não pode anexar evidências nesta reclamação.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Selecione um arquivo de evidência.' });
    }

    const complaints = await getComplaintRows({ id }, req.user);

    if (!complaints.length) {
      return res.status(404).json({ error: 'Reclamação não encontrada' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const originalName = normalizeUploadedOriginalName(req.file);
    await persistUploadedFile(req.file);

    await pool.query(
      `INSERT INTO complaint_evidences
       (complaint_id, file_url, original_name, description, uploaded_by_name, uploaded_by_role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        fileUrl,
        originalName || null,
        description || null,
        getActorName(req.user),
        req.user.role || null
      ]
    );

    await insertComplaintLog(
      id,
      'evidence_added',
      description || originalName || 'Evidência anexada ao protocolo.',
      req.user
    );

    res.status(201).json({ message: 'Evidência anexada com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao anexar evidência' });
  }
});

app.delete('/complaints/:id/evidences/:evidenceId', authenticate, async (req, res) => {
  try {
    const { id, evidenceId } = req.params;

    if (!canDeleteEvidence(req.user)) {
      return res.status(403).json({
        error: 'Usuário não autenticado para excluir evidências.'
      });
    }

    const complaints = await getComplaintRows({ id }, req.user);

    if (!complaints.length) {
      return res.status(404).json({ error: 'Reclamação não encontrada' });
    }

    const [evidenceRows] = await pool.query(
      `SELECT id, complaint_id, file_url, original_name, description, uploaded_by_name, uploaded_by_role, created_at
         FROM complaint_evidences
        WHERE id = ?
          AND complaint_id = ?
          AND deleted_at IS NULL
        LIMIT 1`,
      [evidenceId, id]
    );

    const evidence = evidenceRows[0];

    if (!evidence) {
      return res.status(404).json({ error: 'Evidência não encontrada.' });
    }

    const actorName = getActorName(req.user);
    const actorRole = req.user?.role || null;
    const evidenceLabel = evidence.description || evidence.original_name || 'arquivo sem nome';
    const deletionReason = String(req.body?.reason || 'Exclusao de evidencia pela ficha executiva.').slice(0, 500);

    const [updateResult] = await pool.query(
      `UPDATE complaint_evidences
          SET deleted_at = NOW(),
              deleted_by_name = ?,
              deleted_by_role = ?,
              deletion_reason = ?
        WHERE id = ?
          AND complaint_id = ?
          AND deleted_at IS NULL`,
      [actorName, actorRole, deletionReason, evidenceId, id]
    );

    if (!updateResult.affectedRows) {
      return res.status(404).json({ error: 'Evidência não encontrada.' });
    }

    await insertComplaintLog(
      id,
      'evidence_deleted',
      `Evidência excluída por ${actorName} (${getRecipientRoleLabel(actorRole)}). Arquivo: ${evidenceLabel}. Motivo: ${deletionReason}`,
      req.user
    );

    const evidenceFilePath = resolveStoredUploadFilePath(evidence.file_url);
    await deletePersistedUploadedFile(evidence.file_url);

    if (evidenceFilePath) {
      try {
        await fs.promises.unlink(evidenceFilePath);
      } catch (fileError) {
        if (fileError.code !== 'ENOENT') {
          console.warn('Não foi possível remover o arquivo físico da evidência:', fileError.message);
        }
      }
    }

    return res.json({ message: 'Evidência excluída com sucesso.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir evidência.' });
  }
});

app.patch('/complaints/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      operator_comment,
      priority,
      clinic_id,
      patient_phone,
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
    let assignmentNotificationResult = null;
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
    const hasClinicChangeRequest = Object.prototype.hasOwnProperty.call(req.body || {}, 'clinic_id');
    const hasPhoneChangeRequest = Object.prototype.hasOwnProperty.call(req.body || {}, 'patient_phone');

    if (hasPhoneChangeRequest) {
      if (!canEditComplaintPatientPhone(req.user)) {
        return res.status(403).json({ error: 'Seu perfil não pode alterar o telefone do paciente.' });
      }

      if (!isCompleteBrazilPhone(patient_phone)) {
        return res.status(400).json({ error: 'Informe o telefone completo no formato +55DDDNÚMERO.' });
      }

      const normalizedPatientPhone = normalizeBrazilPhone(patient_phone);

      if (normalizedPatientPhone !== normalizeBrazilPhone(complaint.patient_phone || '')) {
        updates.push('patient_phone = ?');
        values.push(normalizedPatientPhone);
        logEntries.push({
          action: 'patient_phone_changed',
          message: `Telefone do paciente atualizado para ${normalizedPatientPhone}.`
        });
      }
    }

    if (hasClinicChangeRequest) {
      if (!canChangeComplaintUnit(req.user)) {
        return res.status(403).json({ error: 'Seu perfil não pode alterar a unidade do protocolo.' });
      }

      const nextClinicId = Number(clinic_id);

      if (!Number.isInteger(nextClinicId) || nextClinicId <= 0) {
        return res.status(400).json({ error: 'Selecione uma unidade válida.' });
      }

      const currentClinicId = Number(complaint.clinic_id || 0);

      if (nextClinicId !== currentClinicId) {
        const nextClinic = await getActiveClinicById(nextClinicId);

        if (!nextClinic) {
          return res.status(404).json({ error: 'Unidade não encontrada ou inativa.' });
        }

        const assignment = await resolveCoordinatorAssignment(nextClinicId);
        const previousClinicLabel = complaint.clinic_name
          || complaint.clinic_snapshot_name
          || (currentClinicId ? `Unidade ${currentClinicId}` : 'Unidade não informada');
        const nextClinicLabel = nextClinic.name || `Unidade ${nextClinicId}`;
        const nextCoordinatorName = assignment?.coordinatorName || nextClinic.coordinator_name || null;

        updates.push('clinic_id = ?');
        values.push(nextClinicId);
        updates.push('clinic_snapshot_name = ?');
        values.push(nextClinicLabel);
        updates.push('assigned_coordinator_user_id = ?');
        values.push(assignment?.coordinatorUserId || null);
        updates.push('assigned_coordinator_name = ?');
        values.push(nextCoordinatorName);

        if (complaint.forwarded_to_role === 'coordinator') {
          updates.push('assigned_responsible_user_id = ?');
          values.push(assignment?.coordinatorUserId || null);
          updates.push('assigned_responsible_name = ?');
          values.push(nextCoordinatorName || 'Coordenador da unidade');
          updates.push("assigned_responsible_role = 'coordinator'");
        } else if (!complaint.forwarded_to_role) {
          updates.push('assigned_responsible_user_id = NULL');
          updates.push('assigned_responsible_name = NULL');
          updates.push('assigned_responsible_role = NULL');
        } else if (complaint.forwarded_to_role === 'manager') {
          const managerAssignment = await resolveComplaintResponsibleAssignment(nextClinicId, 'manager');
          updates.push('assigned_responsible_user_id = ?');
          values.push(managerAssignment.userId || null);
          updates.push('assigned_responsible_name = ?');
          values.push(managerAssignment.name || 'Gerente da unidade');
          updates.push("assigned_responsible_role = 'manager'");
          updates.push('forwarded_to_label = ?');
          values.push(managerAssignment.label || 'Gerente da unidade');
        }

        if (complaint.forwarded_to_role === 'coordinator') {
          updates.push('forwarded_to_label = ?');
          values.push(nextCoordinatorName || 'Coordenador da unidade');
        }

        logEntries.push({
          action: 'clinic_changed',
          message: `Unidade alterada de ${previousClinicLabel} para ${nextClinicLabel}.`
        });
      }
    }

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
        return res.status(403).json({ error: 'Somente Administrador Master, Supervisor do CRC ou Operador de SAC podem registrar contato com o paciente.' });
      }

      if (!Boolean(complaint.treatment_at) && !(cleanedComment && canAddTreatment(req.user))) {
        return res.status(409).json({ error: 'Registre e salve uma tratativa antes de liberar o contato com o paciente.' });
      }

      const requiresForwardSelection = !Boolean(complaint.patient_contacted_at)
        && !Boolean(complaint.first_attendance_at)
        && canRegisterFirstAttendance(req.user);

      if (requiresForwardSelection && !forward_to_role) {
        return res.status(400).json({ error: 'Selecione o responsável que receberá a reclamação após o contato com o paciente.' });
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
        return res.status(403).json({ error: 'Somente Administrador Master, Supervisor do CRC ou Operador de SAC podem registrar o primeiro atendimento.' });
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

      assignment = await resolveComplaintResponsibleAssignment(complaint.clinic_id, forward_to_role);
      if (forward_to_role === 'coordinator') {
        forwardedLabel = complaint.assigned_coordinator_name || assignment.name || allowedForwardRoles[forward_to_role];
      } else {
        forwardedLabel = assignment.label || allowedForwardRoles[forward_to_role];
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
      updates.push('assigned_responsible_user_id = ?');
      values.push(assignment?.userId || null);
      updates.push('assigned_responsible_name = ?');
      values.push(assignment?.name || forwardedLabel);
      updates.push('assigned_responsible_role = ?');
      values.push(assignment?.role || forward_to_role);

      if (forward_to_role === 'coordinator') {
        updates.push('assigned_coordinator_user_id = ?');
        values.push(assignment?.userId || null);
        updates.push('assigned_coordinator_name = ?');
        values.push(assignment?.name || forwardedLabel);
        updates.push('clinic_snapshot_name = COALESCE(clinic_snapshot_name, ?)');
        values.push(assignment?.clinicSnapshotName || null);
      }

      logEntries.push({
        action: 'first_attendance_forwarded',
        message: `Primeiro atendimento registrado. Deadline travado e protocolo enviado para ${forwardedLabel}.`
      });
    }

    if (nextStatus === 'resolvida') {
      const isMasterRequest = isMasterAdminUser(req.user);
      const hasTreatment = Boolean(complaint.treatment_at) || (cleanedComment && canAddTreatment(req.user));
      const treatmentRole = complaint.treatment_by_role || (canAddTreatment(req.user) ? req.user.role : null);
      const hasCoordinatorOrManagerTreatment = hasTreatment && ['coordinator', 'manager'].includes(String(treatmentRole || '').toLowerCase());
      const hasSupervisorApproval = Boolean(complaint.supervisor_approval_at)
        || (supervisor_accept && canSupervisorApprove(req.user));

      if (!canCloseComplaint(req.user)) {
        return res.status(403).json({ error: 'Somente Administrador Master, Supervisor do CRC ou Operador de SAC podem fechar uma reclamacao.' });
      }

      if (!isMasterRequest && !hasCoordinatorOrManagerTreatment) {
        return res.status(409).json({
          error: 'Antes do fechamento, a reclamacao precisa ter tratativa registrada por Coordenador ou Gerente.'
        });
      }

      if (!isMasterRequest && normalizePriority(nextPriority) === 'alta' && !hasSupervisorApproval) {
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

    if (first_attendance && ['coordinator', 'manager'].includes(String(forward_to_role || '').toLowerCase())) {
      try {
        await notifyComplaintAssigned(id, complaint.protocol);
      } catch (error) {
        console.warn('Nao foi possivel concluir notificacao interna de atribuicao:', error.message);
      }

      assignmentNotificationResult = await dispatchComplaintAssignedNotifications(id, complaint.protocol);
    }

    res.json({
      message: 'Reclamação atualizada com sucesso',
      notificationStatus: assignmentNotificationResult?.notificationStatus
    });
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
    await syncClinicCatalog();
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
      console.warn('Não foi possível executar a rotina inicial de relatórios:', jobError.message);
    });
    dispatchUpcomingAppointmentReminders().catch((jobError) => {
      console.warn('Nao foi possivel executar a rotina inicial de lembretes de agendamento:', jobError.message);
    });
    dispatchUpcomingComplaintDeadlineReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de alertas de prazo das reclamações:', jobError.message);
    });
    dispatchExpiredComplaintManagerAlerts().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de expiração de reclamações para gerência:', jobError.message);
    });
    dispatchExpiredComplaintResponsibleReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de expiração de reclamações para responsáveis:', jobError.message);
    });
    runScheduledUserDemandReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de lembretes semanais aos usuários:', jobError.message);
    });
  }, 3000);

  setInterval(() => {
    runScheduledCoordinatorReports().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de relatórios:', jobError.message);
    });
  }, 15 * 60 * 1000);

  setInterval(() => {
    dispatchUpcomingAppointmentReminders().catch((jobError) => {
      console.warn('Nao foi possivel executar a rotina programada de lembretes de agendamento:', jobError.message);
    });
  }, appointmentReminderIntervalMinutes * 60 * 1000);

  setInterval(() => {
    dispatchUpcomingComplaintDeadlineReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de alertas de prazo das reclamações:', jobError.message);
    });
  }, complaintDueReminderIntervalMinutes * 60 * 1000);

  setInterval(() => {
    dispatchExpiredComplaintManagerAlerts().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de expiração de reclamações para gerência:', jobError.message);
    });
  }, complaintDueReminderIntervalMinutes * 60 * 1000);

  setInterval(() => {
    dispatchExpiredComplaintResponsibleReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de expiração de reclamações para responsáveis:', jobError.message);
    });
  }, complaintExpiredReminderIntervalHours * 60 * 60 * 1000);

  setInterval(() => {
    runScheduledUserDemandReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de lembretes semanais aos usuários:', jobError.message);
    });
  }, weeklyDemandReminderIntervalMinutes * 60 * 1000);

}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  pool,
  startServer,
  __testables: {
    buildAuthenticatedUser,
    buildComplaintNotificationEmail,
    buildComplaintExpiredResponsibleReminderJobKey,
    buildComplaintExpiredResponsibleReminderWindowKey,
    buildComplaintWhatsAppMessage,
    buildWeeklyUserDemandReminderJobKey,
    canChangeComplaintUnit,
    canDeleteEvidence,
    canRenotifyComplaint,
    canReceiveComplaintNotification,
    changeUserPassword,
    decodeUploadedText,
    isPasswordChangeRouteAllowed,
    getStoredUploadFilename,
    normalizeStoredUploadUrl,
    normalizeUploadedOriginalName,
    parseBodyWithSchema,
    persistUploadedFile,
    resolveStoredUploadFilePath,
    shouldRunWeeklyUserDemandReminders,
    sendPasswordChangedNotifications,
    sendUserAccessNotifications,
    signUserToken
  }
};
