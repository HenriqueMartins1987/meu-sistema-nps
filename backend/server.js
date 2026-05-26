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
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const http = require('http');
const { performance } = require('perf_hooks');
const { z } = require('zod');
const { Server } = require('socket.io');
const { clinicSeed, legacyDefaultClinicNames } = require('./clinicSeed');
const emailService = require('./services/emailService');
const evolutionService = require('./services/evolutionService');
const whatsappProvider = require('./services/whatsappProvider');
const whatsappVpsService = whatsappProvider;
const {
  DEFAULT_SELIC_RATE,
  DEFAULT_FINANCIAL_RULES,
  calculateLaborCostComposition,
  buildFinancialIntelligencePayload,
  collaboratorDefaultFields,
  editableFinancialFields,
  enrichFinancialRow,
  integerFields: financialIntegerFields,
  matchesFinancialStatus,
  moneyFields: financialMoneyFields,
  normalizeFinancialRules,
  operationalCostFields,
  toNumber: toFinancialNumber
} = require('./services/financialIntelligenceService');
const {
  buildDentalCardImportTemplateBuffer,
  buildDentalDashboard,
  dentalCardStatuses,
  dentalCardTemplateSeeds,
  deriveDentalStatus,
  nextAttemptFromCount,
  normalizeDentalDate,
  normalizeDentalPhone,
  normalizeDentalText,
  normalizeDentalTime,
  parseDentalCardWorkbook,
  resolveDentalSla,
  toDentalBoolean,
  toDentalNumber
} = require('./services/dentalCardService');
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
const httpServer = http.createServer(app);
const serverStartedAt = new Date();
let io = null;

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
const complaintStalledTreatmentReminderHours = Math.max(1, Number(process.env.COMPLAINT_STALLED_TREATMENT_REMINDER_HOURS || 6));
const complaintStalledTreatmentThresholdHours = Math.max(1, Number(process.env.COMPLAINT_STALLED_TREATMENT_THRESHOLD_HOURS || 48));
const weeklyDemandReminderEnabled = String(process.env.WEEKLY_DEMAND_REMINDER_ENABLED || 'true').trim().toLowerCase() !== 'false';
const weeklyDemandReminderIntervalMinutes = Math.max(5, Number(process.env.WEEKLY_DEMAND_REMINDER_INTERVAL_MINUTES || 15));
const weeklyDemandReminderDay = Math.min(6, Math.max(0, Number(process.env.WEEKLY_DEMAND_REMINDER_DAY || 1)));
const weeklyDemandReminderHour = Math.min(23, Math.max(0, Number(process.env.WEEKLY_DEMAND_REMINDER_HOUR || 8)));
const weeklyDemandReminderTimeZone = String(process.env.WEEKLY_DEMAND_REMINDER_TIMEZONE || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';
const weeklyAdminComplaintReportEnabled = String(process.env.WEEKLY_ADMIN_COMPLAINT_REPORT_ENABLED || 'true').trim().toLowerCase() !== 'false';
const weeklyAdminComplaintReportDay = Math.min(6, Math.max(0, Number(process.env.WEEKLY_ADMIN_COMPLAINT_REPORT_DAY || 1)));
const weeklyAdminComplaintReportHour = Math.min(23, Math.max(0, Number(process.env.WEEKLY_ADMIN_COMPLAINT_REPORT_HOUR || 8)));
const weeklyAdminComplaintReportTimeZone = String(process.env.WEEKLY_ADMIN_COMPLAINT_REPORT_TIMEZONE || weeklyDemandReminderTimeZone || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';
const weeklyAdminComplaintReportIntervalMinutes = Math.max(5, Number(process.env.WEEKLY_ADMIN_COMPLAINT_REPORT_INTERVAL_MINUTES || 15));
const weeklyAdminComplaintReportSpacingSeconds = Math.max(30, Number(process.env.WEEKLY_ADMIN_COMPLAINT_REPORT_SPACING_SECONDS || 90));
const dailyCoordinatorDemandReminderEnabled = String(process.env.DAILY_COORDINATOR_DEMAND_REMINDER_ENABLED || 'true').trim().toLowerCase() !== 'false';
const dailyCoordinatorDemandReminderHour = Math.min(23, Math.max(0, Number(process.env.DAILY_COORDINATOR_DEMAND_REMINDER_HOUR || 8)));
const dailyCoordinatorDemandReminderTimeZone = String(process.env.DAILY_COORDINATOR_DEMAND_REMINDER_TIMEZONE || weeklyDemandReminderTimeZone || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';
const dailyCoordinatorDemandReminderIntervalMinutes = Math.max(5, Number(process.env.DAILY_COORDINATOR_DEMAND_REMINDER_INTERVAL_MINUTES || 15));
const dailyCoordinatorDemandReminderSpacingSeconds = Math.max(30, Number(process.env.DAILY_COORDINATOR_DEMAND_REMINDER_SPACING_SECONDS || 90));
const dailyCoordinatorDeliveryReportEnabled = String(process.env.DAILY_COORDINATOR_DELIVERY_REPORT_ENABLED || 'true').trim().toLowerCase() !== 'false';
const dailyCoordinatorDeliveryReportHour = Math.min(23, Math.max(0, Number(process.env.DAILY_COORDINATOR_DELIVERY_REPORT_HOUR || 9)));
const dailyCoordinatorDeliveryReportTimeZone = String(process.env.DAILY_COORDINATOR_DELIVERY_REPORT_TIMEZONE || dailyCoordinatorDemandReminderTimeZone || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';
const dailyCoordinatorDeliveryReportIntervalMinutes = Math.max(5, Number(process.env.DAILY_COORDINATOR_DELIVERY_REPORT_INTERVAL_MINUTES || 15));
const dailyCoordinatorDeliveryReportSpacingSeconds = Math.max(30, Number(process.env.DAILY_COORDINATOR_DELIVERY_REPORT_SPACING_SECONDS || 90));
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
const dentalCardPublicPhotoMaxBytes = Math.max(1, Number(process.env.DENTAL_CARD_PUBLIC_PHOTO_MAX_MB || 6)) * 1024 * 1024;
const dentalCardSlaHours = Math.max(1, Number(process.env.DENTAL_CARD_SLA_HOURS || 24));
const dentalCardSlaWarningHours = Math.max(1, Number(process.env.DENTAL_CARD_SLA_WARNING_HOURS || 12));
const dentalCardSlaCriticalHours = Math.max(1, Number(process.env.DENTAL_CARD_SLA_CRITICAL_HOURS || 20));
const dentalCardSlaRepeatHours = Math.max(1, Number(process.env.DENTAL_CARD_SLA_REPEAT_HOURS || 6));
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

io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin) ? (origin || true) : false),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
  },
  path: '/socket.io'
});

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

const publicDentalCardPhotoUpload = multer({
  storage,
  limits: {
    fileSize: dentalCardPublicPhotoMaxBytes
  },
  fileFilter: (req, file, cb) => {
    const extension = getSafeUploadExtension(file);
    const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/') || !allowedExtensions.has(extension)) {
      return cb(new Error('A foto precisa ser uma imagem válida.'));
    }
    return cb(null, true);
  }
});

const publicDentalCardLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas indicações enviadas em pouco tempo. Aguarde alguns minutos e tente novamente.'
  }
});

function handlePublicDentalCardPhotoUpload(req, res, next) {
  publicDentalCardPhotoUpload.single('foto')(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        error: error.code === 'LIMIT_FILE_SIZE'
          ? 'A foto precisa respeitar o limite de tamanho configurado.'
          : error.message || 'Não foi possível receber a foto da indicação.'
      });
    }
    return next();
  });
}

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

const WHATSAPP_EVOLUTION_SETTINGS_KEY = 'whatsapp_service_settings';
let whatsappSettingsCache = null;
const WHATSAPP_SERVICE_DEFAULT_BASE_URL = 'http://2.24.101.6:3005';
const WHATSAPP_NOTIFICATION_INSTANCE_NAME = 'reclamacoes';
const WHATSAPP_NOTIFICATION_SENDER_PHONE = normalizeWhatsAppPhone(process.env.WHATSAPP_NOTIFICATION_SENDER_PHONE || '+55 62 9680-7670');
const WHATSAPP_NPS_INSTANCE_NAME = String(process.env.WHATSAPP_NPS_INSTANCE_NAME || 'nps').trim() || 'nps';
const WHATSAPP_NPS_DISPLAY_NAME = String(process.env.WHATSAPP_NPS_DISPLAY_NAME || 'NPS').trim() || 'NPS';
const WHATSAPP_NPS_SENDER_PHONE = normalizeWhatsAppPhone(process.env.WHATSAPP_NPS_SENDER_PHONE || process.env.WHATSAPP_NOTIFICATION_SENDER_PHONE || '556296807670');
const WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME = 'confirmacao-agendamento';
const WHATSAPP_CONFIRMATION_APPOINTMENT_DISPLAY_NAME = 'Confirmação e Agendamento';
const WHATSAPP_CONFIRMATION_APPOINTMENT_SENDER_PHONE = normalizeWhatsAppPhone(process.env.WHATSAPP_CONFIRMATION_APPOINTMENT_SENDER_PHONE || '+55 62 99864-7043');
const WHATSAPP_TEST_CLINIC_PHONE = normalizeWhatsAppPhone(process.env.WHATSAPP_TEST_CLINIC_PHONE || '62999669966');
const DEFAULT_COMPLAINT_REPORT_WHATSAPP_RECIPIENTS = [
  '5562999669966',
  '556481598113',
  '556298852865',
  '556282458072'
];
const defaultWhatsAppCrcSessions = [
  ['castelo-branco', 'Castelo Branco', WHATSAPP_TEST_CLINIC_PHONE],
  ['santo-hilario', 'Santo Hilário', WHATSAPP_TEST_CLINIC_PHONE],
  ['vila-brasilia', 'Vila Brasília', WHATSAPP_TEST_CLINIC_PHONE],
  ['independencia', 'Independência', WHATSAPP_TEST_CLINIC_PHONE],
  ['mangalo', 'Mangalô', WHATSAPP_TEST_CLINIC_PHONE],
  ['gold-bueno', 'Gold Bueno', WHATSAPP_TEST_CLINIC_PHONE],
  ['santa-rita', 'Santa Rita', WHATSAPP_TEST_CLINIC_PHONE],
  ['garavelo', 'Garavelo', WHATSAPP_TEST_CLINIC_PHONE],
  ['senador-canedo', 'Senador Canedo', WHATSAPP_TEST_CLINIC_PHONE],
  ['goiania-1', 'Goiânia 1', WHATSAPP_TEST_CLINIC_PHONE],
  ['goiania-2', 'Goiânia 2', WHATSAPP_TEST_CLINIC_PHONE],
  ['catalao', 'Catalão', WHATSAPP_TEST_CLINIC_PHONE],
  ['parque-anhanguera', 'Parque Anhanguera', WHATSAPP_TEST_CLINIC_PHONE],
  ['inhumas', 'Inhumas', WHATSAPP_TEST_CLINIC_PHONE],
  ['goiania-3', 'Goiânia 3', WHATSAPP_TEST_CLINIC_PHONE],
  ['porto-velho', 'Porto Velho', WHATSAPP_TEST_CLINIC_PHONE],
  ['canaa', 'Canaã', WHATSAPP_TEST_CLINIC_PHONE],
  ['maysa', 'Maysa', WHATSAPP_TEST_CLINIC_PHONE],
  [WHATSAPP_NOTIFICATION_INSTANCE_NAME, 'Reclamações', WHATSAPP_NOTIFICATION_SENDER_PHONE],
  [WHATSAPP_NPS_INSTANCE_NAME, WHATSAPP_NPS_DISPLAY_NAME, WHATSAPP_NPS_SENDER_PHONE],
  [WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME, WHATSAPP_CONFIRMATION_APPOINTMENT_DISPLAY_NAME, WHATSAPP_CONFIRMATION_APPOINTMENT_SENDER_PHONE]
];
const partnerVideoContactSeeds = [
  ['ÁGUAS LINDAS', 'MATHEUS SHIMIZU', '5561981270634'],
  ['BARREIRAS', 'TARDELY', '5561995094773'],
  ['CEILÂNDIA', 'RICARDO CAIADO', '5564984791683'],
  ['FORMOSA', 'MARCELO JUNS', '5561993779149'],
  ['JARDIM INGÁ', 'FERNANDO FEITOSA', '5561991321556'],
  ['LUZIÂNIA', 'DEMÉCRITO NETO', '5577998504580'],
  ['NOVO GAMA', 'BRUNA FRAZÃO E HUMBERTO OLIVEIRA', '5564996489213'],
  ['NÚCLEO BANDEIRANTE', 'BRUNO LACERDA', '5538992355404'],
  ['PARACATU', 'GILBERTO', '5534991790681'],
  ['PARANOÁ', 'CAMILA FRAZÃO', '5561995411010'],
  ['PLANALTINA', 'MATEUS RODRIGUES', '5562992425124'],
  ['PLANO PILOTO', 'MATHEUS CUNHA', '5561994222014'],
  ['SANTO ANTÔNIO', 'SAMUEL COSTA', '5561993285236'],
  ['TAGUATINGA', 'RAYANE CUNHA', '5563992600464'],
  ['CASTELO BRANCO', 'FÁBIO RANDRYS', '5564999811495'],
  ['GOIÂNIA 1', 'ARTHUR FAQUINETI E GEOVANNA SILVA', '5567981661856'],
  ['GOIÂNIA 2', 'KÉVILLY MARTINS', '5538998078510'],
  ['JACIARA', 'JOÃO PEDRO E JEFFERSON', '5517981497766'],
  ['JATAÍ', 'JORDANA ARAUJO', '5562991747887'],
  ['TRINDADE MAYSA', 'CLARA BORGES', '5564992450141'],
  ['PORTO VELHO', 'SAMUEL SANTOS', '5562981332609'],
  ['RIO VERDE 01', 'JOÃO VICTOR SOUZA', '5564981479448'],
  ['RIO VERDE 03', 'CLÁUDIO OLIVEIRA', '5564996752025'],
  ['VILA BRASÍLIA', 'LETÍCIA MARTINS E RARYEL UNGARETTE', '5517981718265'],
  ['VILA CONCÓRDIA', 'EDILENE ARAUJO', '5562996999360'],
  ['VILA NOVA', 'IANY PARAISO', '5538999170545'],
  ['CANAÃ', 'LAYNE CARLA SILVA', '5517981637347'],
  ['CATALÃO', 'VITÓRIA LUIZ', '5517996145410'],
  ['GARAVELO', 'RENATO FREITAS E SUENNE PONTES', '5564992911185'],
  ['GOIÂNIA 3', 'BRUNA MARANGONI, NATHAN ALENCAR E NATHALIA ALVES', '5517996107659'],
  ['ITUMBIARA', 'CLÁUDIO OLIVEIRA', '5564996752025'],
  ['MADRE GERMANA', 'ANA JÚLIA MENDONÇA', '5562981059051'],
  ['MANGALÔ', 'JOÃO GABRIEL', '5562982427235'],
  ['MORRINHOS', 'LUCAS OLIVEIRA', '5563984100649'],
  ['ORAL GOLD', 'BARRUÍNO NETO', '5562991816969'],
  ['PARQUE ANHANGUERA', 'PLÍNIO FILHO', '5562995431106'],
  ['SANTA RITA', 'RODOLFO NETO', '5514996209824'],
  ['TRINDADE CENTRO', 'ANA JÚLIA VIEIRA', '5564984271524'],
  ['ANÁPOLIS 1', 'BETHÂNIA FERNANDES', '5517997672662'],
  ['ANÁPOLIS 2', 'BETHÂNIA FERNANDES', '5517997672662'],
  ['GOIANIRA', 'MATEUS MARTINS', '5517996548642'],
  ['APARECIDA', 'VITOR JUNQUEIRA', '5564993065313'],
  ['INHUMAS', 'ANA BEATRIZ', '5518981488602'],
  ['QUIRINÓPOLIS', 'THIAGO RIBEIRO', '5534988916619'],
  ['SENADOR CANEDO', 'GABRIEL LOPES', '5517981119054']
];
const closedComplaintStatuses = new Set(['resolvida', 'cancelada', 'finalizada', 'finalizado', 'fechada', 'fechado', 'encerrada', 'encerrado']);

function normalizeComplaintStatusValue(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isClosedComplaintStatus(status) {
  return closedComplaintStatuses.has(normalizeComplaintStatusValue(status));
}

function buildOpenComplaintStatusWhere(alias = 'c') {
  return `LOWER(TRIM(COALESCE(${alias}.status, 'aberta'))) NOT IN ('resolvida', 'cancelada', 'finalizada', 'finalizado', 'fechada', 'fechado', 'encerrada', 'encerrado')`;
}

async function isComplaintClosedOrDeleted(complaintId) {
  const id = Number(complaintId || 0);
  if (!id) return false;

  const [rows] = await pool.query(
    'SELECT status, deleted_at FROM complaints WHERE id = ? LIMIT 1',
    [id]
  );
  const complaint = rows[0];
  if (!complaint) return true;
  return Boolean(complaint.deleted_at) || isClosedComplaintStatus(complaint.status);
}

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
  crc_leader: 'Líder de CRC',
  crc_manager: 'Gerente de CRC',
  crc_operator: 'Operador de CRC',
  partner: 'Parceiro',
  coordinator: 'Coordenador',
  manager: 'Gerente',
  viewer: 'Marketing'
};

const dentalCardDefaultResponsible = 'Igor Silva Cruz';

function normalizeAccessRole(role) {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const aliases = {
    administrador: 'admin',
    administrador_master: 'master_admin',
    master: 'master_admin',
    operador_sac: 'sac_operator',
    operador_de_sac: 'sac_operator',
    operador_crc: 'crc_operator',
    operador_de_crc: 'crc_operator',
    lider_crc: 'crc_leader',
    lider_de_crc: 'crc_leader',
    gerente_crc: 'crc_manager',
    gerente_de_crc: 'crc_manager',
    parceiro: 'partner',
    dentista_parceiro: 'partner',
    parceiro_dentista: 'partner',
    supervisor_crc: 'supervisor_crc',
    supervisor_de_crc: 'supervisor_crc',
    coordenador: 'coordinator',
    coordenador_unidade: 'coordinator',
    coordenador_de_unidade: 'coordinator',
    gerente: 'manager',
    gerente_unidade: 'manager',
    gerente_de_unidade: 'manager',
    marketing: 'viewer'
  };

  return aliases[normalized] || normalized;
}

const coordinatorAccessRoleAliases = [
  'coordinator',
  'coordenador',
  'coordenador_unidade',
  'coordenador_de_unidade'
];
const managerAccessRoleAliases = [
  'manager',
  'gerente',
  'gerente_unidade',
  'gerente_de_unidade'
];
const coordinatorManagerAccessRoleAliases = [
  ...coordinatorAccessRoleAliases,
  ...managerAccessRoleAliases
];

function buildRoleAliasWhere(column, aliases) {
  return `(${column} IN (?) OR LOWER(REPLACE(REPLACE(TRIM(${column}), ' ', '_'), '-', '_')) IN (?))`;
}

function getRoleAliasParams(aliases) {
  return [aliases, aliases];
}

function normalizeComparableText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isPlaceholderCoordinatorName(value) {
  const normalized = normalizeComparableText(value);
  return !normalized || [
    'coordenador',
    'coordenador_da_unidade',
    'sem_coordenador',
    'responsavel',
    'responsavel_nao_informado'
  ].includes(normalized);
}

const whatsappOperatorRoleAliases = [
  'crc_operator',
  'crc_leader',
  'crc_manager',
  'supervisor_crc',
  'sac_operator',
  'operador_crc',
  'operador_de_crc',
  'operador crc',
  'operador de crc',
  'lider_crc',
  'lider de crc',
  'gerente_crc',
  'gerente de crc',
  'supervisor de crc',
  'operador_sac',
  'operador de sac',
  'Operador CRC',
  'Operador de CRC',
  'Lider CRC',
  'Gerente CRC',
  'Supervisor de CRC',
  'Operador de SAC'
];
const whatsappOperatorNormalizedRoleAliases = [
  'crc_operator',
  'crc_leader',
  'crc_manager',
  'supervisor_crc',
  'sac_operator',
  'operador_crc',
  'operador_de_crc',
  'lider_crc',
  'lider_de_crc',
  'gerente_crc',
  'gerente_de_crc',
  'supervisor_de_crc',
  'operador_sac',
  'operador_de_sac'
];

function buildWhatsAppOperatorRoleWhere(alias = '') {
  const column = alias ? `${alias}.role` : 'role';
  return `(${column} IN (?) OR LOWER(REPLACE(REPLACE(TRIM(${column}), ' ', '_'), '-', '_')) IN (?))`;
}

function getWhatsAppOperatorRoleParams() {
  return [whatsappOperatorRoleAliases, whatsappOperatorNormalizedRoleAliases];
}

const screenPermissions = {
  home: 'Home',
  complaints_register: 'Cadastro de protocolos',
  complaints_management: 'Painel de gestão de reclamações',
  complaints_dashboard: 'Dashboard de reclamações',
  nps_management: 'Painel de gestão NPS',
  nps_dashboard: 'Dashboard NPS',
  patient_management: 'Gestão do paciente',
  crm_relationship: 'CRM de relacionamento',
  financial_dashboard: 'Financeiro CRC - Dashboard executivo',
  financial_campaigns: 'Financeiro CRC - Unidade x Campanha',
  financial_management: 'Financeiro CRC - Gestão financeira',
  dental_card: 'Dental Card',
  whatsapp_management: 'Gestão WhatsApp CRC',
  whatsapp_dashboard: 'WhatsApp CRC - Dashboard',
  whatsapp_instances: 'WhatsApp CRC - Cadastro de Número',
  whatsapp_attendance: 'WhatsApp CRC - Atendimento',
  whatsapp_send: 'WhatsApp CRC - Envio manual',
  whatsapp_templates: 'WhatsApp CRC - Mensagens padrão',
  whatsapp_chatbot: 'WhatsApp CRC - Chatbot',
  whatsapp_absent: 'WhatsApp CRC - Ausentes',
  whatsapp_history: 'WhatsApp CRC - Histórico',
  whatsapp_reports: 'WhatsApp CRC - Relatórios',
  whatsapp_settings: 'WhatsApp CRC - Configurações',
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

const treatmentRoles = new Set(['coordinator', 'manager', 'supervisor_crc', 'sac_operator']);
const evidenceRoles = new Set(['coordinator', 'manager', 'supervisor_crc', 'sac_operator', 'admin', 'viewer']);
const complaintUnitChangeRoles = new Set(['master_admin', 'supervisor_crc', 'sac_operator', 'viewer']);
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

function normalizeNullableMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toMysqlDateTime(value);
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  const mysqlDateTimeMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (mysqlDateTimeMatch && !raw.endsWith('Z')) {
    return `${mysqlDateTimeMatch[1]} ${mysqlDateTimeMatch[2].length === 5 ? `${mysqlDateTimeMatch[2]}:00` : mysqlDateTimeMatch[2]}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return toMysqlDateTime(parsed);
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

function buildComplaintCreatorAudit(user, origin = 'Interno') {
  if (user && (user.id || user.email || user.name || user.role)) {
    const numericUserId = Number(user.id);

    return {
      userId: Number.isInteger(numericUserId) && numericUserId > 0 ? numericUserId : null,
      name: getActorName(user),
      role: user.role || null,
      email: user.email || null
    };
  }

  const normalizedOrigin = normalizeCreatedOrigin(origin);

  if (normalizedOrigin === 'Marketing') {
    return {
      userId: null,
      name: 'Link público Marketing',
      role: 'marketing_publico',
      email: null
    };
  }

  if (normalizedOrigin === 'Externo') {
    return {
      userId: null,
      name: 'Link público externo',
      role: 'externo',
      email: null
    };
  }

  return {
    userId: null,
    name: 'Usuário interno não identificado',
    role: 'interno',
    email: null
  };
}

function isAdminUser(user) {
  const email = String(user?.email || '').toLowerCase();
  const role = normalizeAccessRole(user?.role);
  return role === 'admin'
    || role === 'master_admin'
    || email === 'admin@sorria.com'
    || email === masterAdminEmail
    || email === defaultAdminEmail;
}

function isMasterAdminUser(user) {
  const email = String(user?.email || '').toLowerCase();
  return normalizeAccessRole(user?.role) === 'master_admin' || email === masterAdminEmail;
}

function isMarketingUser(user) {
  return normalizeAccessRole(user?.role) === 'viewer';
}

function defaultPermissionsForRole(role) {
  role = normalizeAccessRole(role);

  if (role === 'master_admin' || role === 'admin') {
    return Object.keys(screenPermissions);
  }

  if (role === 'sac_operator') {
    return ['home', 'complaints_register', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'crm_relationship', 'whatsapp_management', 'dental_card'];
  }

  if (role === 'supervisor_crc') {
    return ['home', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'patient_management', 'crm_relationship', 'financial_campaigns', 'financial_management', 'whatsapp_management', 'dental_card'];
  }

  if (role === 'crc_leader' || role === 'crc_manager') {
    return ['home', 'whatsapp_management', 'whatsapp_dashboard', 'whatsapp_instances', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history', 'whatsapp_reports', 'dental_card'];
  }

  if (role === 'crc_operator') {
    return ['home', 'whatsapp_management', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history', 'dental_card'];
  }

  if (role === 'partner') {
    return ['home'];
  }

  if (role === 'manager') {
    return ['home', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'patient_management', 'crm_relationship', 'financial_campaigns', 'financial_management', 'dental_card'];
  }

  if (['supervisor_crc', 'coordinator', 'manager'].includes(role)) {
    return ['home', 'complaints_management', 'complaints_dashboard', 'nps_management', 'nps_dashboard', 'patient_management', 'crm_relationship'];
  }

  return ['home', 'complaints_management', 'nps_management'];
}

const actionPermissions = {
  complaints_view_all: true,
  complaints_close: true,
  complaints_reactivate: true,
  complaints_change_unit: true,
  complaints_edit_patient_phone: true,
  complaints_reassign: true,
  complaints_renotify: true,
  evidence_attach: true,
  evidence_delete: true,
  treatment_register: true,
  patient_contact_register: true,
  patient_treatment_manage: true,
  nps_finish: true,
  deleted_view: true,
  financial_record_delete: true,
  financial_collaborator_delete: true,
  whatsapp_config_manage: true,
  whatsapp_instance_delete: true,
  whatsapp_template_delete: true,
  whatsapp_chatbot_delete: true,
  whatsapp_antiban_manage: true,
  receber_notificacao_video: true,
  visualizar_proprias_pendencias: true,
  confirmar_envio_video: true,
  responder_cobranca_video: true
};

function defaultActionPermissionsForRole(role) {
  role = normalizeAccessRole(role);

  if (role === 'master_admin' || role === 'admin') return Object.keys(actionPermissions);

  if (role === 'sac_operator') {
    return [
      'complaints_view_all',
      'complaints_close',
      'complaints_change_unit',
      'complaints_edit_patient_phone',
      'complaints_reassign',
      'complaints_renotify',
      'evidence_attach',
      'evidence_delete',
      'treatment_register',
      'patient_contact_register',
      'patient_treatment_manage',
      'nps_finish'
    ];
  }

  if (role === 'supervisor_crc') {
    return [
      'complaints_view_all',
      'complaints_close',
      'complaints_reactivate',
      'complaints_change_unit',
      'complaints_edit_patient_phone',
      'complaints_reassign',
      'complaints_renotify',
      'evidence_attach',
      'evidence_delete',
      'treatment_register',
      'patient_contact_register',
      'patient_treatment_manage',
      'nps_finish'
    ];
  }

  if (role === 'crc_leader' || role === 'crc_manager') {
    return [
      'whatsapp_config_manage',
      'whatsapp_template_delete',
      'whatsapp_chatbot_delete',
      'whatsapp_antiban_manage'
    ];
  }

  if (role === 'crc_operator') {
    return [];
  }

  if (role === 'partner') {
    return [
      'receber_notificacao_video',
      'visualizar_proprias_pendencias',
      'confirmar_envio_video',
      'responder_cobranca_video'
    ];
  }

  if (role === 'manager' || role === 'coordinator') {
    return ['complaints_reassign', 'evidence_attach', 'evidence_delete', 'treatment_register'];
  }

  if (role === 'viewer') {
    return ['complaints_view_all', 'complaints_change_unit', 'complaints_edit_patient_phone', 'evidence_attach'];
  }

  return ['complaints_view_all', 'evidence_attach'];
}

function getUserActionPermissions(user = {}) {
  const normalizedRole = normalizeAccessRole(user.role);
  const defaults = defaultActionPermissionsForRole(normalizedRole);
  let permissions = defaults;

  try {
    permissions = user?.action_permissions ? JSON.parse(user.action_permissions) : permissions;
  } catch (error) {
    permissions = defaults;
  }

  const parsedPermissions = Array.isArray(permissions)
    ? permissions.filter((permission) => actionPermissions[permission])
    : defaults;

  if (['sac_operator', 'coordinator', 'manager'].includes(normalizedRole)) {
    return Array.from(new Set([...parsedPermissions, ...defaults]));
  }

  return Array.from(new Set(parsedPermissions));
}

function hasActionPermission(user, permission) {
  if (!user || !permission) return false;
  if (isMasterAdminUser(user)) return true;
  const normalizedRole = normalizeAccessRole(user.role);
  const fixedComplaintUnitAndPhoneRoles = new Set(['sac_operator', 'viewer']);
  const fixedComplaintUnitAndPhonePermissions = new Set([
    'complaints_change_unit',
    'complaints_edit_patient_phone'
  ]);

  if (['sac_operator', 'coordinator', 'manager'].includes(normalizedRole)
    && defaultActionPermissionsForRole(normalizedRole).includes(permission)) return true;
  if (fixedComplaintUnitAndPhoneRoles.has(normalizedRole) && fixedComplaintUnitAndPhonePermissions.has(permission)) return true;

  const permissions = Array.isArray(user.actionPermissions)
    ? user.actionPermissions
    : getUserActionPermissions(user);
  return permissions.includes(permission);
}

function canAttachEvidence(user) {
  const normalizedRole = normalizeAccessRole(user?.role);
  return (evidenceRoles.has(normalizedRole) || isAdminUser(user)) && hasActionPermission(user, 'evidence_attach');
}

function canDeleteEvidence(user) {
  if (!Boolean(user?.id || user?.email || user?.role)) return false;
  return (!isMarketingUser(user) || isAdminUser(user)) && hasActionPermission(user, 'evidence_delete');
}

function canChangeComplaintUnit(user) {
  const normalizedRole = normalizeAccessRole(user?.role);
  return (complaintUnitChangeRoles.has(normalizedRole) || isMasterAdminUser(user)) && hasActionPermission(user, 'complaints_change_unit');
}

function canEditComplaintPatientPhone(user) {
  const normalizedRole = normalizeAccessRole(user?.role);
  return (['sac_operator', 'supervisor_crc', 'master_admin', 'viewer'].includes(normalizedRole) || isMasterAdminUser(user)) && hasActionPermission(user, 'complaints_edit_patient_phone');
}

function canManageComplaintPatientTreatment(user) {
  const normalizedRole = normalizeAccessRole(user?.role);
  return (['sac_operator', 'supervisor_crc', 'admin', 'master_admin'].includes(normalizedRole) || isMasterAdminUser(user)) && hasActionPermission(user, 'patient_treatment_manage');
}

function canAddTreatment(user) {
  return (treatmentRoles.has(normalizeAccessRole(user?.role)) || isAdminUser(user)) && hasActionPermission(user, 'treatment_register');
}

function canCloseComplaint(user) {
  const normalizedRole = normalizeAccessRole(user?.role);
  return (['admin', 'master_admin', 'supervisor_crc', 'sac_operator'].includes(normalizedRole) || isMasterAdminUser(user)) && hasActionPermission(user, 'complaints_close');
}

function canSupervisorApprove(user) {
  return normalizeAccessRole(user?.role) === 'supervisor_crc' || isAdminUser(user);
}

function canMarkPatientContact(user) {
  return (['master_admin', 'supervisor_crc', 'sac_operator'].includes(normalizeAccessRole(user?.role)) || isMasterAdminUser(user)) && hasActionPermission(user, 'patient_contact_register');
}

function canRegisterFirstAttendance(user) {
  return ['master_admin', 'supervisor_crc', 'sac_operator'].includes(normalizeAccessRole(user?.role)) || isMasterAdminUser(user);
}

function canReassignComplaint(user) {
  return (['admin', 'master_admin', 'supervisor_crc', 'sac_operator', 'coordinator', 'manager'].includes(normalizeAccessRole(user?.role))
    || isMasterAdminUser(user)
    || isAdminUser(user)) && hasActionPermission(user, 'complaints_reassign');
}

function getUserScreenPermissions(user = {}) {
  if (Array.isArray(user.permissions)) {
    return user.permissions;
  }

  if (typeof user.permissions === 'string' && user.permissions.trim()) {
    try {
      const parsed = JSON.parse(user.permissions);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      return defaultPermissionsForRole(user.role);
    }
  }

  return defaultPermissionsForRole(user.role);
}

function hasScreenPermission(user, permission) {
  if (!user || !permission) return false;
  if (isAdminUser(user)) return true;
  const role = normalizeAccessRole(user.role);
  if (role === 'crc_leader' || role === 'crc_manager') {
    return ['home', 'whatsapp_management', 'whatsapp_dashboard', 'whatsapp_instances', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history', 'whatsapp_reports', 'dental_card'].includes(permission);
  }
  if (role === 'crc_operator') {
    return ['home', 'whatsapp_management', 'whatsapp_attendance', 'whatsapp_send', 'whatsapp_templates', 'whatsapp_chatbot', 'whatsapp_absent', 'whatsapp_history', 'dental_card'].includes(permission);
  }
  if (['manager', 'coordinator', 'viewer'].includes(role) && String(permission || '').startsWith('whatsapp')) return false;
  return getUserScreenPermissions(user).includes(permission);
}

function canDeleteRecords(user) {
  return (isMasterAdminUser(user) || normalizeAccessRole(user?.role) === 'supervisor_crc') && hasActionPermission(user, 'deleted_view');
}

function canReactivateComplaint(user) {
  return (isMasterAdminUser(user) || normalizeAccessRole(user?.role) === 'supervisor_crc') && hasActionPermission(user, 'complaints_reactivate');
}

function canViewFinancialIntelligence(user) {
  return isAdminUser(user)
    || hasScreenPermission(user, 'financial_dashboard')
    || hasScreenPermission(user, 'financial_campaigns')
    || hasScreenPermission(user, 'financial_management');
}

function canViewFinancialDashboard(user) {
  return hasScreenPermission(user, 'financial_dashboard');
}

function canViewFinancialCampaignDashboard(user) {
  return hasScreenPermission(user, 'financial_campaigns');
}

function canManageFinancialIntelligence(user) {
  return hasScreenPermission(user, 'financial_management');
}

function canDeleteFinancialIntelligence(user) {
  return isMasterAdminUser(user) && hasActionPermission(user, 'financial_record_delete');
}

function canManageCrcCollaborators(user) {
  return hasScreenPermission(user, 'financial_management');
}

function canDeleteCrcCollaborators(user) {
  return isMasterAdminUser(user) && hasActionPermission(user, 'financial_collaborator_delete');
}

function canViewWhatsAppManagement(user) {
  const role = normalizeAccessRole(user?.role);
  return isAdminUser(user)
    || ['supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager', 'crc_operator'].includes(role)
    || (hasScreenPermission(user, 'whatsapp_management') && !['manager', 'coordinator', 'viewer'].includes(role));
}

function canConfigureWhatsAppManagement(user) {
  return isAdminUser(user)
    || hasActionPermission(user, 'whatsapp_config_manage')
    || ['supervisor_crc', 'crc_leader', 'crc_manager'].includes(normalizeAccessRole(user?.role));
}

function canViewAllWhatsAppAttendance(user) {
  return isAdminUser(user) || ['supervisor_crc', 'crc_leader', 'crc_manager'].includes(normalizeAccessRole(user?.role));
}

function canRenotifyComplaint(user) {
  const normalizedRole = normalizeAccessRole(user?.role);
  return (isMasterAdminUser(user) || normalizedRole === 'supervisor_crc' || normalizedRole === 'sac_operator') && hasActionPermission(user, 'complaints_renotify');
}

function buildComplaintAccessPayload(user) {
  return {
    role: normalizeAccessRole(user?.role),
    permissions: getUserScreenPermissions(user),
    actionPermissions: getUserActionPermissions(user),
    canAddTreatment: canAddTreatment(user),
    canRecordTreatment: canAddTreatment(user),
    canAttachEvidence: canAttachEvidence(user),
    canDeleteEvidence: canDeleteEvidence(user),
    canChangeComplaintUnit: canChangeComplaintUnit(user),
    canEditPatientPhone: canEditComplaintPatientPhone(user),
    canCloseComplaint: canCloseComplaint(user),
    canMarkPatientContact: canMarkPatientContact(user),
    canRegisterFirstAttendance: canRegisterFirstAttendance(user),
    canReassignComplaint: canReassignComplaint(user),
    canRenotifyComplaint: canRenotifyComplaint(user),
    canReactivateComplaint: canReactivateComplaint(user),
    canManagePatientTreatment: canManageComplaintPatientTreatment(user)
  };
}

function canViewDeletedRecords(user) {
  return isMasterAdminUser(user) && hasActionPermission(user, 'deleted_view');
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

function parseBulkNpsWorksheetRows(rows = []) {
  return rows.map((row) => ({
    name: normalizeWhatsAppPatientName(
      row.nome_paciente || row.nome || row.paciente || row.patient_name || row.patient || ''
    ),
    phone: normalizeBrazilPhone(
      row.telefone || row.phone || row.patient_phone || row.whatsapp || row.celular || ''
    ),
    clinic: String(row.clinica || row.clinic || row.unidade || '').trim()
  })).filter((row) => row.name && row.phone);
}

function parseBulkNpsUpload(filePath, originalName = '') {
  const extension = String(path.extname(originalName || filePath || '')).trim().toLowerCase();
  if (['.xlsx', '.xls'].includes(extension)) {
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName] || {}, { defval: '' });
    return parseBulkNpsWorksheetRows(rows);
  }

  return parseBulkNpsCsv(fs.readFileSync(filePath));
}

function isStrongPassword(value) {
  const password = String(value || '');
  return password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
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
  actionPermissions: z.array(z.string().trim().min(1)).max(80).optional(),
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

const crcOperatorRegistrationSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome completo.').max(160),
  username: z.string().trim().min(4, 'O usuário deve ter pelo menos 4 caracteres.').max(80),
  email: z.string().trim().email('Informe um e-mail válido para recuperação de senha.').max(180),
  phone: z.string().trim().min(1, 'Informe o celular.').max(40),
  password: z.string().trim().min(8, 'A senha deve ter no mínimo 8 caracteres.').max(160)
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

async function complaintHasCoordinatorOrManagerTreatment(complaint, pendingTreatmentUser = null) {
  const acceptedRoles = new Set(['coordinator', 'manager']);
  const currentTreatmentRole = normalizeAccessRole(complaint?.treatment_by_role);

  if (complaint?.treatment_at && acceptedRoles.has(currentTreatmentRole)) {
    return true;
  }

  if (pendingTreatmentUser && acceptedRoles.has(normalizeAccessRole(pendingTreatmentUser.role))) {
    return true;
  }

  const loadedLogs = Array.isArray(complaint?.logs) ? complaint.logs : [];
  if (loadedLogs.some((log) => log?.action === 'treatment_saved' && acceptedRoles.has(normalizeAccessRole(log.actor_role)))) {
    return true;
  }

  if (!complaint?.id) {
    return false;
  }

  const [rows] = await pool.query(
    `SELECT actor_role
     FROM complaint_logs
     WHERE complaint_id = ?
       AND action = 'treatment_saved'
       AND actor_role IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    [complaint.id]
  );

  return rows.some((log) => acceptedRoles.has(normalizeAccessRole(log.actor_role)));
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

function getDefaultWhatsAppSessionSector(sessionId) {
  if (sessionId === WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME) return 'Confirmação e Agendamento';
  if (sessionId === WHATSAPP_NOTIFICATION_INSTANCE_NAME) return 'Reclamações';
  if (sessionId === WHATSAPP_NPS_INSTANCE_NAME) return 'NPS';
  return 'CRC';
}

async function ensureDefaultWhatsAppCrcSessions() {
  const actor = 'Sistema';
  const [sacOperators] = await pool.query(
    `SELECT id, name
       FROM users
      WHERE role = 'sac_operator'
        AND COALESCE(active, 1) = 1
        AND deleted_at IS NULL
      ORDER BY id ASC
      LIMIT 1`
  );
  const defaultSacOperator = sacOperators[0] || null;

  for (const [sessionId, displayName, phoneNumber = null] of defaultWhatsAppCrcSessions) {
    const normalizedPhone = phoneNumber ? normalizeWhatsAppPhone(phoneNumber) : null;
    const sector = getDefaultWhatsAppSessionSector(sessionId);
    await pool.query(
      `INSERT INTO whatsapp_service_sessions
       (session_id, display_name, clinic_name, unit_name, phone_number, status, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 'nao_iniciada', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(NULLIF(display_name, ''), VALUES(display_name)),
         clinic_name = COALESCE(NULLIF(clinic_name, ''), VALUES(clinic_name)),
         unit_name = COALESCE(NULLIF(unit_name, ''), VALUES(unit_name)),
         phone_number = CASE
           WHEN VALUES(phone_number) IS NOT NULL AND VALUES(phone_number) <> '' THEN VALUES(phone_number)
           ELSE phone_number
         END,
         updated_by = COALESCE(updated_by, VALUES(updated_by))`,
      [
        sessionId,
        displayName,
        displayName,
        displayName,
        normalizedPhone,
        'Sessão padrão criada para a Gestão WhatsApp CRC.',
        actor,
        actor
      ]
    );

    await pool.query(
      `INSERT INTO whatsapp_instances
       (instance_name, display_name, sector, clinic_name, unit_name, phone_number, status, operator_id, operator_name, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'nao_iniciada', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(NULLIF(display_name, ''), VALUES(display_name)),
         sector = COALESCE(NULLIF(sector, ''), VALUES(sector)),
         clinic_name = COALESCE(NULLIF(clinic_name, ''), VALUES(clinic_name)),
         unit_name = COALESCE(NULLIF(unit_name, ''), VALUES(unit_name)),
         operator_id = CASE
           WHEN VALUES(operator_id) IS NOT NULL AND (operator_id IS NULL OR instance_name = ?)
             THEN VALUES(operator_id)
           ELSE operator_id
         END,
         operator_name = CASE
           WHEN VALUES(operator_name) IS NOT NULL AND (operator_name IS NULL OR instance_name = ?)
             THEN VALUES(operator_name)
           ELSE operator_name
         END,
         phone_number = CASE
           WHEN VALUES(phone_number) IS NOT NULL AND VALUES(phone_number) <> '' THEN VALUES(phone_number)
           ELSE phone_number
         END,
         updated_by = COALESCE(updated_by, VALUES(updated_by))`,
      [
        sessionId,
        displayName,
        sector,
        displayName,
        displayName,
        normalizedPhone,
        sessionId === WHATSAPP_NPS_INSTANCE_NAME ? defaultSacOperator?.id || null : null,
        sessionId === WHATSAPP_NPS_INSTANCE_NAME ? defaultSacOperator?.name || null : null,
        'Número padrão do CRC para conexão via whatsapp-service.',
        actor,
        actor,
        WHATSAPP_NPS_INSTANCE_NAME,
        WHATSAPP_NPS_INSTANCE_NAME
      ]
    );
  }

  await pool.query(
    'UPDATE whatsapp_instances SET sector = ?, phone_number = ? WHERE instance_name = ?',
    ['Confirmação e Agendamento', WHATSAPP_CONFIRMATION_APPOINTMENT_SENDER_PHONE, WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME]
  );
  await pool.query(
    'UPDATE whatsapp_service_sessions SET phone_number = ? WHERE session_id = ?',
    [WHATSAPP_CONFIRMATION_APPOINTMENT_SENDER_PHONE, WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME]
  );
}

async function ensurePartnerVideoContactSeeds() {
  for (const [clinicName, partnerName, phoneNumber] of partnerVideoContactSeeds) {
    const normalizedPhone = normalizeWhatsAppPhone(phoneNumber);
    await pool.query(
      `INSERT INTO partner_video_contacts
       (clinic_name, partner_name, phone_number, active, receives_automatic_message, default_send_time, allowed_weekdays, notes)
       VALUES (?, ?, ?, 1, ?, '08:00:00', '1,2,3,4,5,6', ?)
       ON DUPLICATE KEY UPDATE
         phone_number = VALUES(phone_number),
         active = 1,
         receives_automatic_message = VALUES(receives_automatic_message),
         updated_at = CURRENT_TIMESTAMP`,
      [
        clinicName,
        partnerName,
        normalizedPhone || null,
        normalizedPhone ? 1 : 0,
        'Cadastro inicial automático da rotina Confirmação e Agendamento.'
      ]
    );
  }
}

function getDefaultWhatsAppSessionClinicAliases(sessionId, displayName) {
  const aliases = [displayName];
  if (sessionId === 'vila-brasilia') aliases.push('Villa Brasília', 'Vila Brasília');
  if (sessionId === 'goiania-1') aliases.push('Goiânia I', 'Goiânia 1');
  if (sessionId === 'goiania-2') aliases.push('Goiânia II', 'Goiânia 2');
  if (sessionId === 'maysa') aliases.push('Trindade Maysa');
  return aliases.map(normalizeClinicLookupValue).filter(Boolean);
}

async function syncDefaultWhatsAppSessionsWithClinics() {
  const [clinics] = await pool.query('SELECT id, name, city, state FROM clinics WHERE active = 1');

  for (const [sessionId, displayName, phoneNumber = null] of defaultWhatsAppCrcSessions) {
    const aliases = getDefaultWhatsAppSessionClinicAliases(sessionId, displayName);
    const clinic = clinics.find((item) => aliases.includes(normalizeClinicLookupValue(item.name)));
    const normalizedPhone = phoneNumber ? normalizeWhatsAppPhone(phoneNumber) : null;

    if (clinic) {
      await pool.query(
        `UPDATE whatsapp_service_sessions
            SET clinic_id = ?,
                clinic_name = ?,
                unit_name = ?,
                phone_number = CASE
                  WHEN ? IS NOT NULL AND ? <> '' THEN ?
                  ELSE phone_number
                END,
                updated_by = COALESCE(updated_by, 'Sistema')
          WHERE session_id = ?`,
        [clinic.id, clinic.name, clinic.city || displayName, normalizedPhone, normalizedPhone, normalizedPhone, sessionId]
      );

      await pool.query(
        `UPDATE whatsapp_instances
            SET clinic_id = ?,
                clinic_name = ?,
                unit_name = ?,
                phone_number = CASE
                  WHEN ? IS NOT NULL AND ? <> '' THEN ?
                  ELSE phone_number
                END,
                updated_by = COALESCE(updated_by, 'Sistema')
          WHERE instance_name = ?`,
        [clinic.id, clinic.name, clinic.city || displayName, normalizedPhone, normalizedPhone, normalizedPhone, sessionId]
      );
      continue;
    }

    if (normalizedPhone) {
      await pool.query(
        `UPDATE whatsapp_service_sessions
            SET phone_number = ?,
                updated_by = COALESCE(updated_by, 'Sistema')
          WHERE session_id = ?`,
        [normalizedPhone, sessionId]
      );
      await pool.query(
        `UPDATE whatsapp_instances
            SET phone_number = ?,
                updated_by = COALESCE(updated_by, 'Sistema')
          WHERE instance_name = ?`,
        [normalizedPhone, sessionId]
      );
    }
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
  await ensureColumn('users', 'username', 'VARCHAR(80) NULL');
  await ensureColumn('users', 'position', 'VARCHAR(160) NULL');
  await ensureColumn('users', 'phone', 'VARCHAR(40) NULL');
  await ensureColumn('users', 'whatsapp', 'VARCHAR(40) NULL');
  await ensureColumn('users', 'department', 'VARCHAR(160) NULL');
  await ensureColumn('users', 'permissions', 'LONGTEXT NULL');
  await ensureColumn('users', 'action_permissions', 'LONGTEXT NULL');
  await ensureColumn('users', 'deleted_at', 'TIMESTAMP NULL');
  await ensureColumn('users', 'deleted_by', 'VARCHAR(160) NULL');
  await ensureColumn('users', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('users', 'token_version', 'INT NOT NULL DEFAULT 1');
  await ensureColumn('users', 'active', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn('users', 'authorization_status', "VARCHAR(30) NOT NULL DEFAULT 'aprovado'");
  await ensureColumn('users', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('users', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await pool.query('ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NOT NULL');
  await pool.query(`
    UPDATE users
       SET authorization_status = 'pendente'
     WHERE role = 'crc_operator'
       AND active = 0
       AND deleted_at IS NULL
       AND (authorization_status IS NULL OR authorization_status = '' OR authorization_status = 'aprovado')
  `);

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
    CREATE TABLE IF NOT EXISTS dental_card_leads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      data_indicacao DATE NULL,
      unidade VARCHAR(180) NOT NULL,
      nome_lead VARCHAR(180) NOT NULL,
      telefone VARCHAR(40) NOT NULL,
      ficha VARCHAR(80) NULL,
      nome_indicador VARCHAR(180) NULL,
      tipo_indicador VARCHAR(80) NULL,
      dentista_responsavel VARCHAR(180) NULL,
      origem VARCHAR(120) NULL,
      responsavel VARCHAR(180) NULL,
      responsavel_user_id INT NULL,
      status VARCHAR(80) NOT NULL DEFAULT 'Novo Lead',
      status_contato VARCHAR(80) NULL,
      canal_contato VARCHAR(80) NULL,
      quantidade_tentativas INT NOT NULL DEFAULT 0,
      data_primeiro_contato DATETIME NULL,
      data_ultima_tentativa DATETIME NULL,
      data_proxima_tentativa DATETIME NULL,
      agendado TINYINT(1) NOT NULL DEFAULT 0,
      agendado_por VARCHAR(80) NULL,
      data_agendamento DATE NULL,
      hora_agendamento TIME NULL,
      ecuro_lancado TINYINT(1) NOT NULL DEFAULT 0,
      endereco_enviado TINYINT(1) NOT NULL DEFAULT 0,
      confirmacao_enviada TINYINT(1) NOT NULL DEFAULT 0,
      confirmou_presenca VARCHAR(40) NULL,
      compareceu TINYINT(1) NOT NULL DEFAULT 0,
      motivo_falta VARCHAR(500) NULL,
      tentativa_recuperacao TINYINT(1) NOT NULL DEFAULT 0,
      data_reagendamento DATE NULL,
      pagou VARCHAR(40) NOT NULL DEFAULT 'pendente',
      valor_pago DECIMAL(14,2) NOT NULL DEFAULT 0,
      forma_pagamento VARCHAR(80) NULL,
      receita DECIMAL(14,2) NOT NULL DEFAULT 0,
      pesquisa_satisfacao_enviada TINYINT(1) NOT NULL DEFAULT 0,
      nova_indicacao_solicitada TINYINT(1) NOT NULL DEFAULT 0,
      nova_indicacao_recebida TINYINT(1) NOT NULL DEFAULT 0,
      observacoes TEXT NULL,
      sla_status VARCHAR(40) NOT NULL DEFAULT 'ok',
      dias_sem_contato INT NOT NULL DEFAULT 0,
      encerrado_em DATETIME NULL,
      encerrado_por VARCHAR(180) NULL,
      motivo_encerramento VARCHAR(500) NULL,
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      deleted_at TIMESTAMP NULL,
      deleted_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_dental_card_data (data_indicacao),
      INDEX idx_dental_card_unidade (unidade),
      INDEX idx_dental_card_status (status),
      INDEX idx_dental_card_telefone (telefone),
      INDEX idx_dental_card_proxima (data_proxima_tentativa)
    )
  `);

  await ensureColumn('dental_card_leads', 'vinculo_indicador', 'VARCHAR(120) NULL');
  await ensureColumn('dental_card_leads', 'email', 'VARCHAR(220) NULL');
  await ensureColumn('dental_card_leads', 'responsavel_cadastro', 'VARCHAR(180) NULL');
  await ensureColumn('dental_card_leads', 'foto_url', 'VARCHAR(500) NULL');
  await ensureColumn('dental_card_leads', 'origem_cadastro', 'VARCHAR(160) NULL');
  await ensureColumn('dental_card_leads', 'ip_origem', 'VARCHAR(80) NULL');
  await ensureColumn('dental_card_leads', 'user_agent', 'VARCHAR(500) NULL');
  await ensureColumn('dental_card_leads', 'link_origem', 'VARCHAR(500) NULL');
  await ensureColumn('dental_card_leads', 'unidade_slug', 'VARCHAR(180) NULL');
  await ensureColumn('dental_card_leads', 'data_status', 'DATETIME NULL');
  await ensureColumn('dental_card_leads', 'public_form_token', 'VARCHAR(120) NULL');
  await ensureColumn('dental_card_leads', 'created_via_public_form', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('dental_card_leads', 'data_limite_retorno', 'DATETIME NULL');
  await ensureColumn('dental_card_leads', 'primeiro_retorno_em', 'DATETIME NULL');
  await ensureColumn('dental_card_leads', 'sla_retorno_status', "VARCHAR(40) NOT NULL DEFAULT 'pendente'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dental_card_attempts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lead_id INT NOT NULL,
      responsavel VARCHAR(180) NULL,
      responsavel_user_id INT NULL,
      tipo_contato VARCHAR(80) NULL,
      canal VARCHAR(80) NULL,
      resultado VARCHAR(120) NULL,
      observacao TEXT NULL,
      proxima_acao VARCHAR(180) NULL,
      data_proxima_acao DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dental_attempt_lead (lead_id),
      CONSTRAINT fk_dental_attempt_lead FOREIGN KEY (lead_id) REFERENCES dental_card_leads(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dental_card_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lead_id INT NOT NULL,
      file_name VARCHAR(255) NULL,
      file_url VARCHAR(500) NOT NULL,
      file_type VARCHAR(120) NULL,
      file_size INT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      uploaded_by VARCHAR(180) NULL,
      source VARCHAR(80) NULL,
      INDEX idx_dental_attachment_lead (lead_id),
      CONSTRAINT fk_dental_attachment_lead FOREIGN KEY (lead_id) REFERENCES dental_card_leads(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dental_card_notification_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      recebe_notificacao_sistema TINYINT(1) NOT NULL DEFAULT 1,
      recebe_notificacao_whatsapp TINYINT(1) NOT NULL DEFAULT 0,
      telefone_whatsapp VARCHAR(40) NULL,
      unidade VARCHAR(180) NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_dental_notification_user_unit (user_id, unidade),
      INDEX idx_dental_notification_active (ativo)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dental_card_notification_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lead_id INT NULL,
      user_id INT NULL,
      tipo_notificacao VARCHAR(80) NOT NULL,
      canal VARCHAR(40) NOT NULL,
      mensagem TEXT NULL,
      status_envio VARCHAR(40) NOT NULL DEFAULT 'pendente',
      data_envio DATETIME NULL,
      erro TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dental_notification_lead (lead_id),
      INDEX idx_dental_notification_user (user_id),
      INDEX idx_dental_notification_tipo (tipo_notificacao)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dental_card_message_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(160) NOT NULL,
      tipo VARCHAR(80) NOT NULL,
      mensagem TEXT NOT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_dental_card_template_tipo (tipo)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dental_card_audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lead_id INT NULL,
      user_id INT NULL,
      user_name VARCHAR(180) NULL,
      user_role VARCHAR(80) NULL,
      action VARCHAR(120) NOT NULL,
      ip VARCHAR(80) NULL,
      details LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dental_audit_lead (lead_id),
      INDEX idx_dental_audit_action (action)
    )
  `);

  for (const template of dentalCardTemplateSeeds) {
    await pool.query(
      `INSERT INTO dental_card_message_templates (nome, tipo, mensagem, ativo, created_by, updated_by)
       VALUES (?, ?, ?, 1, 'Sistema', 'Sistema')
       ON DUPLICATE KEY UPDATE
         nome = VALUES(nome),
         mensagem = VALUES(mensagem),
         ativo = COALESCE(ativo, VALUES(ativo))`,
      [template.nome, template.tipo, template.mensagem]
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crc_collaborators (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(180) NOT NULL,
      role VARCHAR(120) NULL,
      function_name VARCHAR(160) NOT NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      unit_name VARCHAR(180) NULL,
      hire_date DATE NULL,
      reference_month CHAR(7) NULL,
      salary DECIMAL(14,2) NOT NULL DEFAULT 0,
      charges DECIMAL(14,2) NOT NULL DEFAULT 0,
      benefits DECIMAL(14,2) NOT NULL DEFAULT 0,
      receives_commission TINYINT(1) NOT NULL DEFAULT 0,
      commission_default DECIMAL(14,2) NOT NULL DEFAULT 0,
      dsr_commission DECIMAL(14,2) NOT NULL DEFAULT 0,
      thirteenth_salary DECIMAL(14,2) NOT NULL DEFAULT 0,
      phone_cost_default DECIMAL(14,2) NOT NULL DEFAULT 0,
      system_cost_default DECIMAL(14,2) NOT NULL DEFAULT 0,
      infrastructure_cost_default DECIMAL(14,2) NOT NULL DEFAULT 0,
      vacation_taken TINYINT(1) NOT NULL DEFAULT 0,
      vacation_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      other_costs_default DECIMAL(14,2) NOT NULL DEFAULT 0,
      other_costs_description VARCHAR(500) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'ativo',
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      deleted_at TIMESTAMP NULL,
      deleted_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_crc_collaborators_name (name),
      INDEX idx_crc_collaborators_clinic (clinic_id),
      INDEX idx_crc_collaborators_status (status)
    )
  `);

  await ensureColumn('crc_collaborators', 'reference_month', 'CHAR(7) NULL');
  await ensureColumn('crc_collaborators', 'hire_date', 'DATE NULL');
  await ensureColumn('crc_collaborators', 'receives_commission', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'dsr_commission', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'thirteenth_salary', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'vacation_taken', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'vacation_amount', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'other_costs_description', 'VARCHAR(500) NULL');
  await ensureColumn('crc_collaborators', 'fixed_commission', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'fixed_gratification', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'fixed_additional', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'transport_voucher', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'food_voucher', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'meal_voucher', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'health_plan', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'dental_plan', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'cost_allowance', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'other_benefits', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await ensureColumn('crc_collaborators', 'bonus', 'DECIMAL(14,2) NOT NULL DEFAULT 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS financial_intelligence (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL,
      campaign_start_date DATE NULL,
      campaign_end_date DATE NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      unit_name VARCHAR(180) NULL,
      campaign_target_unit VARCHAR(180) NULL,
      supervisor_id INT NULL,
      supervisor_name VARCHAR(180) NULL,
      operator_id INT NULL,
      operator_name VARCHAR(180) NULL,
      collaborator_id INT NULL,
      collaborator_name VARCHAR(180) NULL,
      role VARCHAR(120) NULL,
      function_name VARCHAR(160) NULL,
      campaign VARCHAR(180) NULL,
      channel VARCHAR(120) NULL,
      leads INT NOT NULL DEFAULT 0,
      appointments INT NOT NULL DEFAULT 0,
      attendances INT NOT NULL DEFAULT 0,
      closings INT NOT NULL DEFAULT 0,
      revenue DECIMAL(14,2) NOT NULL DEFAULT 0,
      marketing_investment DECIMAL(14,2) NOT NULL DEFAULT 0,
      salary DECIMAL(14,2) NOT NULL DEFAULT 0,
      charges DECIMAL(14,2) NOT NULL DEFAULT 0,
      benefits DECIMAL(14,2) NOT NULL DEFAULT 0,
      commission DECIMAL(14,2) NOT NULL DEFAULT 0,
      bonus DECIMAL(14,2) NOT NULL DEFAULT 0,
      overtime DECIMAL(14,2) NOT NULL DEFAULT 0,
      transport_voucher DECIMAL(14,2) NOT NULL DEFAULT 0,
      food_voucher DECIMAL(14,2) NOT NULL DEFAULT 0,
      meal_voucher DECIMAL(14,2) NOT NULL DEFAULT 0,
      health_plan DECIMAL(14,2) NOT NULL DEFAULT 0,
      dental_plan DECIMAL(14,2) NOT NULL DEFAULT 0,
      training DECIMAL(14,2) NOT NULL DEFAULT 0,
      uniforms DECIMAL(14,2) NOT NULL DEFAULT 0,
      individual_equipment DECIMAL(14,2) NOT NULL DEFAULT 0,
      other_collaborator_costs DECIMAL(14,2) NOT NULL DEFAULT 0,
      phone_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      system_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      crm_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      whatsapp_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      internet_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      allocated_energy DECIMAL(14,2) NOT NULL DEFAULT 0,
      infrastructure_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      allocated_rent DECIMAL(14,2) NOT NULL DEFAULT 0,
      furniture_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      maintenance_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      equipment_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      software_licenses DECIMAL(14,2) NOT NULL DEFAULT 0,
      technical_support DECIMAL(14,2) NOT NULL DEFAULT 0,
      other_operational_costs DECIMAL(14,2) NOT NULL DEFAULT 0,
      google_ads DECIMAL(14,2) NOT NULL DEFAULT 0,
      meta_ads DECIMAL(14,2) NOT NULL DEFAULT 0,
      tv DECIMAL(14,2) NOT NULL DEFAULT 0,
      radio DECIMAL(14,2) NOT NULL DEFAULT 0,
      agency DECIMAL(14,2) NOT NULL DEFAULT 0,
      designer DECIMAL(14,2) NOT NULL DEFAULT 0,
      video_production DECIMAL(14,2) NOT NULL DEFAULT 0,
      influencers DECIMAL(14,2) NOT NULL DEFAULT 0,
      landing_page DECIMAL(14,2) NOT NULL DEFAULT 0,
      automation_tools DECIMAL(14,2) NOT NULL DEFAULT 0,
      other_marketing_costs DECIMAL(14,2) NOT NULL DEFAULT 0,
      supervision_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      management_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      coordination_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      audit_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      consulting_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      legal_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      compliance_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      finance_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      accounting_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      other_administrative_costs DECIMAL(14,2) NOT NULL DEFAULT 0,
      selic_rate DECIMAL(8,2) NOT NULL DEFAULT ${DEFAULT_SELIC_RATE},
      notes TEXT NULL,
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      deleted_at TIMESTAMP NULL,
      deleted_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_financial_date (date),
      INDEX idx_financial_clinic (clinic_id),
      INDEX idx_financial_operator (operator_id),
      INDEX idx_financial_collaborator (collaborator_id),
      INDEX idx_financial_campaign (campaign),
      INDEX idx_financial_channel (channel)
    )
  `);

  await ensureColumn('financial_intelligence', 'campaign_start_date', 'DATE NULL');
  await ensureColumn('financial_intelligence', 'campaign_end_date', 'DATE NULL');
  await ensureColumn('financial_intelligence', 'campaign_target_unit', 'VARCHAR(180) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crc_collaborator_monthly_costs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      collaborator_id INT NOT NULL,
      collaborator_name VARCHAR(180) NULL,
      reference_month CHAR(7) NOT NULL,
      commission DECIMAL(14,2) NOT NULL DEFAULT 0,
      vacation_paid TINYINT(1) NOT NULL DEFAULT 0,
      vacation_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
      other_costs DECIMAL(14,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      deleted_at TIMESTAMP NULL,
      deleted_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_crc_collaborator_month (collaborator_id, reference_month),
      INDEX idx_crc_collaborator_month_ref (reference_month)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crc_monthly_operational_costs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reference_month CHAR(7) NOT NULL,
      phone_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      system_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      crm_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      whatsapp_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      internet_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      allocated_energy DECIMAL(14,2) NOT NULL DEFAULT 0,
      infrastructure_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      allocated_rent DECIMAL(14,2) NOT NULL DEFAULT 0,
      furniture_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      maintenance_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      equipment_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
      software_licenses DECIMAL(14,2) NOT NULL DEFAULT 0,
      technical_support DECIMAL(14,2) NOT NULL DEFAULT 0,
      other_operational_costs DECIMAL(14,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      deleted_at TIMESTAMP NULL,
      deleted_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_crc_operational_month_ref (reference_month)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(120) PRIMARY KEY,
      setting_value LONGTEXT NULL,
      updated_by VARCHAR(180) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_service_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(120) NOT NULL UNIQUE,
      display_name VARCHAR(180) NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      unit_name VARCHAR(180) NULL,
      phone_number VARCHAR(40) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'iniciando',
      last_status_payload LONGTEXT NULL,
      last_status_check_at DATETIME NULL,
      notes TEXT NULL,
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_service_sessions_status (status),
      INDEX idx_whatsapp_service_sessions_clinic (clinic_id)
    )
  `);

  await ensureColumn('whatsapp_service_sessions', 'phone_number', 'VARCHAR(40) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_service_message_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(120) NOT NULL,
      patient_phone VARCHAR(40) NOT NULL,
      message_text TEXT NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pendente',
      provider_message_id VARCHAR(180) NULL,
      response_payload LONGTEXT NULL,
      error_message TEXT NULL,
      created_by VARCHAR(180) NULL,
      sent_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_service_history_session (session_id),
      INDEX idx_whatsapp_service_history_phone (patient_phone),
      INDEX idx_whatsapp_service_history_status (status),
      INDEX idx_whatsapp_service_history_created (created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_instances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      instance_name VARCHAR(120) NOT NULL UNIQUE,
      display_name VARCHAR(160) NULL,
      sector VARCHAR(80) NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      unit_name VARCHAR(180) NULL,
      phone_number VARCHAR(40) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'desconectado',
      last_connection_at DATETIME NULL,
      last_status_check_at DATETIME NULL,
      notes TEXT NULL,
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_instances_status (status),
      INDEX idx_whatsapp_instances_sector (sector),
      INDEX idx_whatsapp_instances_clinic (clinic_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(180) NOT NULL,
      category VARCHAR(120) NULL,
      sector VARCHAR(80) NULL,
      message_text TEXT NOT NULL,
      variables LONGTEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'ativo',
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_templates_status (status),
      INDEX idx_whatsapp_templates_category (category)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      patient_name VARCHAR(180) NOT NULL,
      patient_phone VARCHAR(40) NOT NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      unit_name VARCHAR(180) NULL,
      campaign VARCHAR(180) NULL,
      source VARCHAR(120) NULL,
      operator_id INT NULL,
      operator_name VARCHAR(180) NULL,
      instance_name VARCHAR(120) NULL,
      status VARCHAR(80) NOT NULL DEFAULT 'Novo',
      last_message_at DATETIME NULL,
      next_follow_up_at DATETIME NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_conversations_phone (patient_phone),
      INDEX idx_whatsapp_conversations_operator (operator_id),
      INDEX idx_whatsapp_conversations_status (status),
      INDEX idx_whatsapp_conversations_instance (instance_name)
    )
  `);

  await ensureColumn('whatsapp_conversations', 'nps_invite_sent_at', 'DATETIME NULL');
  await ensureColumn('whatsapp_conversations', 'nps_invite_message_id', 'INT NULL');
  await ensureColumn('whatsapp_conversations', 'session_id', 'VARCHAR(120) NULL');
  await ensureColumn('whatsapp_conversations', 'phone', 'VARCHAR(40) NULL');
  await ensureColumn('whatsapp_conversations', 'protocol', 'VARCHAR(60) NULL');
  await ensureColumn('whatsapp_conversations', 'assigned_operator_id', 'INT NULL');
  await ensureColumn('whatsapp_conversations', 'unread_count', 'INT NOT NULL DEFAULT 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NULL,
      instance_name VARCHAR(120) NULL,
      patient_phone VARCHAR(40) NOT NULL,
      direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
      message_text TEXT NOT NULL,
      message_type VARCHAR(80) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pendente',
      evolution_message_id VARCHAR(180) NULL,
      operator_id INT NULL,
      operator_name VARCHAR(180) NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      campaign VARCHAR(180) NULL,
      sent_at DATETIME NULL,
      delivered_at DATETIME NULL,
      read_at DATETIME NULL,
      responded_at DATETIME NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_messages_conversation (conversation_id),
      INDEX idx_whatsapp_messages_status (status),
      INDEX idx_whatsapp_messages_operator (operator_id),
      INDEX idx_whatsapp_messages_created (created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_chatbot_flows (
      id INT AUTO_INCREMENT PRIMARY KEY,
      flow_name VARCHAR(180) NOT NULL,
      instance_name VARCHAR(120) NULL,
      sector VARCHAR(80) NULL,
      trigger_type VARCHAR(80) NULL,
      trigger_value VARCHAR(180) NULL,
      initial_message TEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'ativo',
      created_by VARCHAR(180) NULL,
      updated_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_flows_status (status),
      INDEX idx_whatsapp_flows_trigger (trigger_type, trigger_value)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_chatbot_steps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      flow_id INT NOT NULL,
      step_order INT NOT NULL DEFAULT 1,
      message_text TEXT NULL,
      option_value VARCHAR(80) NULL,
      next_step_id INT NULL,
      action_type VARCHAR(80) NULL,
      action_payload LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_steps_flow (flow_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_chatbot_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      flow_id INT NOT NULL,
      conversation_id INT NULL,
      instance_name VARCHAR(120) NULL,
      patient_phone VARCHAR(40) NOT NULL,
      patient_name VARCHAR(180) NULL,
      current_step_order INT NOT NULL DEFAULT 1,
      current_step_id INT NULL,
      last_inbound_message_id INT NULL,
      collected_data LONGTEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'ativo',
      started_at DATETIME NULL,
      last_interaction_at DATETIME NULL,
      completed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_chatbot_sessions_flow (flow_id),
      INDEX idx_whatsapp_chatbot_sessions_conversation (conversation_id),
      INDEX idx_whatsapp_chatbot_sessions_phone (patient_phone),
      INDEX idx_whatsapp_chatbot_sessions_status (status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_campaign_recipients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      batch_id VARCHAR(80) NOT NULL,
      campaign_type VARCHAR(40) NOT NULL,
      template_id INT NULL,
      patient_name VARCHAR(180) NOT NULL,
      patient_phone VARCHAR(40) NOT NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      instance_name VARCHAR(120) NULL,
      source VARCHAR(120) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pendente',
      routing_error TEXT NULL,
      conversation_id INT NULL,
      message_id INT NULL,
      dispatch_queue_id INT NULL,
      created_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_campaign_batch (batch_id),
      INDEX idx_whatsapp_campaign_phone (patient_phone),
      INDEX idx_whatsapp_campaign_status (status),
      INDEX idx_whatsapp_campaign_instance (instance_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_absent_patients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NULL,
      patient_name VARCHAR(180) NOT NULL,
      patient_phone VARCHAR(40) NOT NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      reason VARCHAR(180) NULL,
      attempt_count INT NOT NULL DEFAULT 1,
      last_attempt_at DATETIME NULL,
      next_attempt_at DATETIME NULL,
      operator_id INT NULL,
      operator_name VARCHAR(180) NULL,
      status VARCHAR(80) NOT NULL DEFAULT 'Ausente primeira tentativa',
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_absent_status (status),
      INDEX idx_whatsapp_absent_operator (operator_id),
      INDEX idx_whatsapp_absent_next (next_attempt_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_nps_invites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NULL,
      patient_name VARCHAR(180) NULL,
      patient_phone VARCHAR(40) NOT NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      operator_id INT NULL,
      operator_name VARCHAR(180) NULL,
      invite_link TEXT NULL,
      message_id INT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'enviado',
      sent_at DATETIME NULL,
      responded_at DATETIME NULL,
      nps_response_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_nps_invites_conversation (conversation_id),
      INDEX idx_whatsapp_nps_invites_phone (patient_phone),
      INDEX idx_whatsapp_nps_invites_status (status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_attendance_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL UNIQUE,
      patient_name VARCHAR(180) NOT NULL,
      patient_phone VARCHAR(40) NOT NULL,
      clinic_id INT NULL,
      clinic_name VARCHAR(180) NULL,
      instance_name VARCHAR(120) NULL,
      operator_id INT NULL,
      operator_name VARCHAR(180) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'aguardando',
      priority INT NOT NULL DEFAULT 0,
      source VARCHAR(120) NULL,
      queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      assigned_at DATETIME NULL,
      closed_at DATETIME NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_queue_status (status),
      INDEX idx_whatsapp_queue_operator (operator_id),
      INDEX idx_whatsapp_queue_priority (priority, queued_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_operator_limits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      max_simultaneous INT NOT NULL DEFAULT 5,
      active TINYINT(1) NOT NULL DEFAULT 1,
      updated_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_dispatch_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id INT NULL,
      conversation_id INT NULL,
      instance_name VARCHAR(120) NOT NULL,
      recipient_phone VARCHAR(40) NOT NULL,
      message_text TEXT NOT NULL,
      message_type VARCHAR(80) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pendente',
      attempts INT NOT NULL DEFAULT 0,
      scheduled_at DATETIME NOT NULL,
      locked_at DATETIME NULL,
      sent_at DATETIME NULL,
      operator_id INT NULL,
      operator_name VARCHAR(180) NULL,
      anti_ban_delay_ms INT NOT NULL DEFAULT 0,
      humanization_profile VARCHAR(80) NULL,
      error_message TEXT NULL,
      payload LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_dispatch_status_schedule (status, scheduled_at),
      INDEX idx_whatsapp_dispatch_instance (instance_name),
      INDEX idx_whatsapp_dispatch_message (message_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_evolution_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(80) NOT NULL,
      instance_name VARCHAR(120) NULL,
      conversation_id INT NULL,
      message_id INT NULL,
      queue_id INT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'info',
      duration_ms INT NULL,
      request_payload LONGTEXT NULL,
      response_payload LONGTEXT NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_evolution_logs_event (event_type),
      INDEX idx_whatsapp_evolution_logs_instance (instance_name),
      INDEX idx_whatsapp_evolution_logs_status (status),
      INDEX idx_whatsapp_evolution_logs_created (created_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_video_contacts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clinic_name VARCHAR(180) NOT NULL,
      partner_name VARCHAR(220) NOT NULL,
      phone_number VARCHAR(40) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      receives_automatic_message TINYINT(1) NOT NULL DEFAULT 1,
      default_send_time TIME NULL DEFAULT '08:00:00',
      allowed_weekdays VARCHAR(40) NULL DEFAULT '1,2,3,4,5,6',
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_partner_video_contact (clinic_name, partner_name),
      INDEX idx_partner_video_contacts_active (active),
      INDEX idx_partner_video_contacts_clinic (clinic_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_video_daily_controls (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL,
      clinic_name VARCHAR(180) NOT NULL,
      partner_id INT NULL,
      partner_name VARCHAR(220) NOT NULL,
      phone_number VARCHAR(40) NULL,
      message_sent_at DATETIME NULL,
      message_status VARCHAR(60) NULL,
      video_due_time TIME NULL DEFAULT '09:30:00',
      video_received TINYINT(1) NOT NULL DEFAULT 0,
      video_received_at DATETIME NULL,
      status VARCHAR(80) NOT NULL DEFAULT 'aguardando envio',
      leader_notified_at DATETIME NULL,
      coordinator_notified_at DATETIME NULL,
      manager_notified_at DATETIME NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_partner_video_daily (date, partner_id),
      INDEX idx_partner_video_daily_date (date),
      INDEX idx_partner_video_daily_status (status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_video_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contact_id INT NULL,
      control_id INT NULL,
      event_type VARCHAR(80) NOT NULL,
      channel VARCHAR(40) NULL DEFAULT 'whatsapp',
      recipient_phone VARCHAR(40) NULL,
      message_text TEXT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'info',
      response_payload LONGTEXT NULL,
      error_message TEXT NULL,
      created_by VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_partner_video_logs_event (event_type),
      INDEX idx_partner_video_logs_control (control_id),
      INDEX idx_partner_video_logs_created (created_at)
    )
  `);

  await ensureColumn('whatsapp_instances', 'warmup_level', 'INT NOT NULL DEFAULT 1');
  await ensureColumn('whatsapp_instances', 'daily_send_limit', 'INT NOT NULL DEFAULT 30');
  await ensureColumn('whatsapp_instances', 'messages_sent_today', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('whatsapp_instances', 'last_warmup_reset', 'DATE NULL');
  await ensureColumn('whatsapp_instances', 'anti_ban_notes', 'TEXT NULL');
  await ensureColumn('whatsapp_instances', 'operator_id', 'INT NULL');
  await ensureColumn('whatsapp_instances', 'operator_name', 'VARCHAR(180) NULL');
  await ensureColumn('whatsapp_instances', 'uptime_started_at', 'DATETIME NULL');
  await ensureColumn('whatsapp_conversations', 'assigned_at', 'DATETIME NULL');
  await ensureColumn('whatsapp_conversations', 'assignment_source', 'VARCHAR(80) NULL');
  await ensureColumn('whatsapp_conversations', 'priority', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('whatsapp_messages', 'media_url', 'TEXT NULL');
  await ensureColumn('whatsapp_messages', 'media_mime_type', 'VARCHAR(120) NULL');
  await ensureColumn('whatsapp_messages', 'deleted_at', 'DATETIME NULL');
  await ensureColumn('whatsapp_messages', 'session_id', 'VARCHAR(120) NULL');
  await ensureColumn('whatsapp_messages', 'phone', 'VARCHAR(40) NULL');
  await ensureColumn('whatsapp_messages', 'patient_name', 'VARCHAR(180) NULL');
  await ensureColumn('whatsapp_messages', 'message', 'TEXT NULL');
  await ensureColumn('whatsapp_messages', 'source', 'VARCHAR(80) NULL');
  await ensureColumn('whatsapp_messages', 'whatsapp_message_id', 'VARCHAR(180) NULL');
  await ensureColumn('whatsapp_messages', 'client_request_id', 'VARCHAR(120) NULL');
  await ensureColumn('whatsapp_messages', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await ensureDefaultWhatsAppCrcSessions();
  await ensurePartnerVideoContactSeeds();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_operator_status (
      user_id INT PRIMARY KEY,
      operator_name VARCHAR(180) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'online',
      reason VARCHAR(120) NULL,
      auto_reply_message TEXT NULL,
      updated_by VARCHAR(180) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_whatsapp_operator_status_status (status)
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
      complaint_id INT NULL,
      patient_name VARCHAR(160) NOT NULL,
      patient_phone VARCHAR(40) NOT NULL,
      channel VARCHAR(80) NOT NULL,
      clinic_name VARCHAR(180) NOT NULL,
      interaction_type VARCHAR(80) NOT NULL,
      procedure_name VARCHAR(180) NULL,
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
  await ensureColumn('patient_interactions', 'complaint_id', 'INT NULL');
  await ensureColumn('patient_interactions', 'procedure_name', 'VARCHAR(180) NULL');
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
  await ensureColumn('nps_responses', 'whatsapp_conversation_id', 'INT NULL');
  await ensureColumn('nps_responses', 'whatsapp_nps_invite_id', 'INT NULL');
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
      created_by_user_id INT NULL,
      created_by_name VARCHAR(160) NULL,
      created_by_role VARCHAR(80) NULL,
      created_by_email VARCHAR(190) NULL,
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
  await ensureColumn('complaints', 'created_by_user_id', 'INT NULL');
  await ensureColumn('complaints', 'created_by_name', 'VARCHAR(160) NULL');
  await ensureColumn('complaints', 'created_by_role', 'VARCHAR(80) NULL');
  await ensureColumn('complaints', 'created_by_email', 'VARCHAR(190) NULL');
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
    UPDATE complaints
       SET created_by_name = CASE
             WHEN created_by_name IS NULL OR TRIM(created_by_name) = '' THEN
               CASE
                 WHEN created_origin = 'Marketing' THEN 'Link público Marketing'
                 WHEN created_origin = 'Externo' THEN 'Link público externo'
                 ELSE 'Usuário interno não identificado'
               END
             ELSE created_by_name
           END,
           created_by_role = CASE
             WHEN created_by_role IS NULL OR TRIM(created_by_role) = '' THEN
               CASE
                 WHEN created_origin = 'Marketing' THEN 'marketing_publico'
                 WHEN created_origin = 'Externo' THEN 'externo'
                 ELSE 'interno'
               END
             ELSE created_by_role
           END
  `);

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
    let inferredForwardRole = String(row.forwarded_to_role || '').toLowerCase();
    let inferredForwardedBy = row.forwarded_by || null;

    if (!inferredForwardRole) {
      const [forwardLogs] = await pool.query(
        `SELECT message, actor_name
           FROM complaint_logs
          WHERE complaint_id = ?
            AND action IN ('reassigned_forward', 'first_attendance_forwarded', 'patient_contact_forwarded')
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [row.id]
      );
      const lastForwardLog = forwardLogs[0] || null;
      const logMessage = String(lastForwardLog?.message || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

      if (logMessage.includes('gerente')) {
        inferredForwardRole = 'manager';
      } else if (logMessage.includes('coordenador')) {
        inferredForwardRole = 'coordinator';
      }

      if (inferredForwardRole) {
        row.forwarded_to_role = inferredForwardRole;
        inferredForwardedBy = inferredForwardedBy || lastForwardLog?.actor_name || null;
      }
    }

    if (!row.first_attendance_at && !inferredForwardRole && (row.forwarded_to_role || row.assigned_responsible_user_id || row.assigned_responsible_role)) {
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

    const currentForwardRole = inferredForwardRole || String(row.forwarded_to_role || '').toLowerCase();
    const currentResponsibleRole = normalizeAccessRole(row.assigned_responsible_role);

    const coordinatorNameLooksFinal = row.assigned_coordinator_name
      && !isPlaceholderCoordinatorName(row.assigned_coordinator_name);
    const responsibleLooksFinal = !currentForwardRole
      || (
        currentResponsibleRole === currentForwardRole
        && row.assigned_responsible_name
        && !isPlaceholderCoordinatorName(row.assigned_responsible_name)
        && (currentForwardRole !== 'coordinator' || row.assigned_responsible_user_id)
      );

    if (coordinatorNameLooksFinal && row.clinic_snapshot_name && responsibleLooksFinal) {
      return null;
    }

    const assignment = await resolveCoordinatorAssignment(row.clinic_id);
    const shouldBackfillResponsible = ['coordinator', 'manager', 'supervisor_crc', 'sac_operator'].includes(
      currentForwardRole
    );
    const responsibleAssignment = shouldBackfillResponsible
      ? await resolveComplaintResponsibleAssignment(
          row.clinic_id,
          currentForwardRole,
          { preferredName: row.forwarded_by }
        )
      : null;

    if (shouldBackfillResponsible) {
      return pool.query(
        `UPDATE complaints
             SET assigned_coordinator_user_id = COALESCE(assigned_coordinator_user_id, ?),
                 assigned_coordinator_name = CASE
                   WHEN assigned_coordinator_name IS NULL OR TRIM(assigned_coordinator_name) = '' OR LOWER(TRIM(assigned_coordinator_name)) IN ('coordenador', 'coordenador da unidade', 'sem coordenador')
                   THEN ?
                   ELSE assigned_coordinator_name
                 END,
                 assigned_responsible_user_id = ?,
                 assigned_responsible_name = ?,
                 assigned_responsible_role = ?,
                 forwarded_to_role = ?,
                 forwarded_to_label = ?,
                 forwarded_at = COALESCE(forwarded_at, NOW()),
                 forwarded_by = COALESCE(forwarded_by, ?),
                 clinic_snapshot_name = COALESCE(clinic_snapshot_name, ?)
          WHERE id = ?`,
        [
          assignment.coordinatorUserId,
          assignment.coordinatorName || null,
          responsibleAssignment?.userId || null,
          responsibleAssignment?.name || null,
          currentForwardRole,
          currentForwardRole,
          responsibleAssignment?.label || responsibleAssignment?.name || row.forwarded_to_label || null,
          inferredForwardedBy,
          assignment.clinicSnapshotName || null,
          row.id
        ]
      );
    }

    return pool.query(
      `UPDATE complaints
           SET assigned_coordinator_user_id = COALESCE(assigned_coordinator_user_id, ?),
               assigned_coordinator_name = CASE
                 WHEN assigned_coordinator_name IS NULL OR TRIM(assigned_coordinator_name) = '' OR LOWER(TRIM(assigned_coordinator_name)) IN ('coordenador', 'coordenador da unidade', 'sem coordenador')
                 THEN ?
                 ELSE assigned_coordinator_name
               END,
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

async function repairPendingCoordinatorAssignments() {
  const [rows] = await pool.query(
    `SELECT id, protocol, clinic_id, status, first_attendance_at, forwarded_to_role, forwarded_to_label,
            assigned_coordinator_user_id, assigned_coordinator_name,
            assigned_responsible_user_id, assigned_responsible_name, assigned_responsible_role,
            clinic_snapshot_name
       FROM complaints
      WHERE deleted_at IS NULL
        AND clinic_id IS NOT NULL`
  );

  const result = {
    checked: rows.length,
    updated: 0,
    unresolved: 0,
    skippedClosed: 0
  };

  for (const row of rows) {
    if (isClosedComplaintStatus(row.status)) {
      result.skippedClosed += 1;
      continue;
    }

    const assignment = await resolveCoordinatorAssignment(row.clinic_id);
    const currentForwardRole = normalizeAccessRole(row.forwarded_to_role || row.assigned_responsible_role);
    const hasCoordinatorTarget = currentForwardRole === 'coordinator'
      || (
        isPlaceholderCoordinatorName(row.assigned_responsible_name)
        && Boolean(row.first_attendance_at || row.forwarded_to_role || row.assigned_responsible_role)
      );

    if (!assignment.coordinatorUserId && isPlaceholderCoordinatorName(assignment.coordinatorName)) {
      result.unresolved += 1;
      continue;
    }

    const coordinatorNameDiffers = normalizeComparableText(row.assigned_coordinator_name)
      !== normalizeComparableText(assignment.coordinatorName);
    const coordinatorNeedsRepair = !row.assigned_coordinator_user_id
      || (assignment.coordinatorUserId && Number(row.assigned_coordinator_user_id) !== Number(assignment.coordinatorUserId))
      || isPlaceholderCoordinatorName(row.assigned_coordinator_name)
      || coordinatorNameDiffers;
    const responsibleNeedsRepair = hasCoordinatorTarget && (
      !row.assigned_responsible_user_id
      || (assignment.coordinatorUserId && Number(row.assigned_responsible_user_id) !== Number(assignment.coordinatorUserId))
      || isPlaceholderCoordinatorName(row.assigned_responsible_name)
      || normalizeComparableText(row.assigned_responsible_name) !== normalizeComparableText(assignment.coordinatorName)
      || normalizeAccessRole(row.assigned_responsible_role) !== 'coordinator'
    );

    if (!coordinatorNeedsRepair && !responsibleNeedsRepair) {
      continue;
    }

    const updates = [
      'assigned_coordinator_user_id = ?',
      'assigned_coordinator_name = ?',
      'clinic_snapshot_name = COALESCE(clinic_snapshot_name, ?)'
    ];
    const params = [
      assignment.coordinatorUserId || null,
      assignment.coordinatorName || null,
      assignment.clinicSnapshotName || null
    ];

    if (hasCoordinatorTarget) {
      updates.push('assigned_responsible_user_id = ?');
      updates.push('assigned_responsible_name = ?');
      updates.push("assigned_responsible_role = 'coordinator'");
      updates.push("forwarded_to_role = 'coordinator'");
      updates.push('forwarded_to_label = ?');
      updates.push('forwarded_at = COALESCE(forwarded_at, NOW())');
      params.push(
        assignment.coordinatorUserId || null,
        assignment.coordinatorName || null,
        assignment.coordinatorName || row.forwarded_to_label || 'Coordenador da unidade'
      );
    }

    params.push(row.id);
    await pool.query(
      `UPDATE complaints
          SET ${updates.join(', ')}
        WHERE id = ?`,
      params
    );
    result.updated += 1;
  }

  return result;
}

async function handleRepairCoordinatorAssignments(req, res) {
  try {
    const result = await repairPendingCoordinatorAssignments();
    return res.json({ message: 'Encaminhamentos de coordenadores revisados.', ...result });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao revisar encaminhamentos de coordenadores.' });
  }
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

  const normalizedAccessRole = normalizeAccessRole(user?.role);

  if (user && !isAdminUser(user) && !['sac_operator', 'supervisor_crc', 'viewer'].includes(normalizedAccessRole)) {
    const role = normalizedAccessRole;
    const userName = String(user?.name || '').trim();
    const clinicIds = ['coordinator', 'manager'].includes(role)
      ? await getUserClinicIds(user.id)
      : [];
    const accessClauses = [];
    const accessParams = [];

    const getComplaintRoleAliases = (targetRole) => {
      if (targetRole === 'manager') return managerAccessRoleAliases;
      if (targetRole === 'coordinator') return coordinatorAccessRoleAliases;
      return [targetRole];
    };

    const addNameFallback = (targetRole, scopedClinicIds = []) => {
      if (!userName) return;

      const roleAliases = getComplaintRoleAliases(targetRole);
      const clinicScope = scopedClinicIds.length ? 'c.clinic_id IN (?) AND ' : '';
      const clinicParams = scopedClinicIds.length ? [scopedClinicIds] : [];

      accessClauses.push(`(
        ${clinicScope}${buildRoleAliasWhere('c.assigned_responsible_role', roleAliases)}
        AND LOWER(TRIM(c.assigned_responsible_name)) = LOWER(TRIM(?))
      )`);
      accessParams.push(...clinicParams, ...getRoleAliasParams(roleAliases), userName);
      accessClauses.push(`(
        ${clinicScope}${buildRoleAliasWhere('c.forwarded_to_role', roleAliases)}
        AND LOWER(TRIM(c.forwarded_to_label)) = LOWER(TRIM(?))
      )`);
      accessParams.push(...clinicParams, ...getRoleAliasParams(roleAliases), userName);
    };

    if (role === 'manager') {
      if (clinicIds.length) {
        accessClauses.push('(c.clinic_id IN (?))');
        accessParams.push(
          clinicIds
        );
        addNameFallback('manager', clinicIds);
      } else {
        accessClauses.push('1 = 0');
      }
    } else if (role === 'coordinator') {
      if (clinicIds.length) {
        accessClauses.push(`(
          c.clinic_id IN (?)
          AND (
            c.status = 'resolvida'
            OR (
              c.assigned_responsible_user_id = ?
              AND ${buildRoleAliasWhere('COALESCE(c.assigned_responsible_role, c.forwarded_to_role)', coordinatorAccessRoleAliases)}
            )
            OR ${buildRoleAliasWhere('c.assigned_responsible_role', coordinatorAccessRoleAliases)}
            OR ${buildRoleAliasWhere('c.forwarded_to_role', coordinatorAccessRoleAliases)}
            OR c.assigned_coordinator_user_id = ?
          )
        )`);
        accessParams.push(
          clinicIds,
          user.id,
          ...getRoleAliasParams(coordinatorAccessRoleAliases),
          ...getRoleAliasParams(coordinatorAccessRoleAliases),
          ...getRoleAliasParams(coordinatorAccessRoleAliases),
          user.id
        );
        addNameFallback('coordinator', clinicIds);
      } else {
        accessClauses.push('1 = 0');
      }
    } else {
      accessClauses.push('c.assigned_responsible_user_id = ?');
      accessParams.push(user.id);
    }

    filters.clause += filters.clause ? ` AND (${accessClauses.join(' OR ')})` : `WHERE (${accessClauses.join(' OR ')})`;
    filters.params.push(...accessParams);
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
      c.created_by_user_id,
      c.created_by_name,
      c.created_by_role,
      c.created_by_email,
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
            AND ${buildRoleAliasWhere('u.role', coordinatorAccessRoleAliases)}
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
            AND ${buildRoleAliasWhere('u.role', coordinatorAccessRoleAliases)}
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
          AND ${buildRoleAliasWhere('u.role', managerAccessRoleAliases)}
        ORDER BY u.updated_at DESC, u.id DESC
        LIMIT 1
      ) AS manager_name,
      (
        SELECT COALESCE(NULLIF(u.whatsapp, ''), NULLIF(u.phone, ''))
        FROM users u
        INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = c.clinic_id
        WHERE u.active = 1
          AND u.deleted_at IS NULL
          AND ${buildRoleAliasWhere('u.role', managerAccessRoleAliases)}
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
    [
      ...getRoleAliasParams(coordinatorAccessRoleAliases),
      ...getRoleAliasParams(coordinatorAccessRoleAliases),
      ...getRoleAliasParams(managerAccessRoleAliases),
      ...getRoleAliasParams(managerAccessRoleAliases),
      ...filters.params
    ]
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
    'created_by_user_id',
    'created_by_name',
    'created_by_role',
    'created_by_email',
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

async function getClinicCoordinatorManagerNotificationRecipients(clinicId) {
  if (!clinicId) return [];

  const recipientMap = new Map();
  const [clinicRows] = await pool.query(
    'SELECT coordinator_name, responsible_email, responsible_whatsapp FROM clinics WHERE id = ? LIMIT 1',
    [clinicId]
  );
  const clinic = clinicRows[0] || {};
  const coordinatorName = String(clinic.coordinator_name || '').trim();

  addNotificationRecipient(recipientMap, {
    name: 'Responsável da unidade',
    role: 'clinic_responsible',
    email: clinic.responsible_email,
    whatsapp: clinic.responsible_whatsapp
  });

  const [users] = await pool.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.whatsapp, u.phone, u.role
      FROM users u
      INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?
      WHERE u.active = 1
        AND u.deleted_at IS NULL
        AND ${buildRoleAliasWhere('u.role', coordinatorManagerAccessRoleAliases)}`,
    [clinicId, ...getRoleAliasParams(coordinatorManagerAccessRoleAliases)]
  );

  users.forEach((user) => addNotificationRecipient(recipientMap, {
    userId: user.id,
    name: user.name,
    role: user.role,
    email: user.email,
    whatsapp: user.whatsapp || user.phone
  }));

  if (coordinatorName) {
    const [coordinatorUsers] = await pool.query(
      `SELECT DISTINCT id, name, email, whatsapp, phone, role
         FROM users
        WHERE active = 1
          AND deleted_at IS NULL
          AND (LOWER(name) = LOWER(?) OR LOWER(email) = LOWER(?))`,
      [coordinatorName, coordinatorName]
    );

    coordinatorUsers.forEach((user) => addNotificationRecipient(recipientMap, {
      userId: user.id,
      name: user.name,
      role: user.role || 'coordinator',
      email: user.email,
      whatsapp: user.whatsapp || user.phone
    }));
  }

  return Array.from(recipientMap.values()).filter((recipient) => recipient.email || recipient.phone);
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
       c.status,
       c.deleted_at,
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
  return Boolean(complaint?.assigned_user_id || complaint?.assigned_user_email);
}

function isMasterNotificationRecipient(recipient) {
  return normalizeAccessRole(recipient?.role || recipient?.recipientRole) === 'master_admin'
    || normalizeNotificationEmail(recipient?.email || recipient?.recipient_email) === masterAdminEmail;
}

function isComplaintAssignedEmailRecipient(complaint, recipient) {
  const recipientUserId = Number(recipient?.userId || recipient?.id || recipient?.recipient_user_id || 0);
  const assignedUserId = Number(complaint?.assigned_user_id || complaint?.assigned_responsible_user_id || 0);
  const recipientEmail = normalizeNotificationEmail(recipient?.email || recipient?.recipient_email);
  const assignedEmail = normalizeNotificationEmail(complaint?.assigned_user_email);

  return Boolean(assignedUserId && recipientUserId === assignedUserId)
    || Boolean(assignedEmail && recipientEmail === assignedEmail);
}

function applyComplaintEmailResponsibilityPolicy(complaint, recipients = []) {
  return recipients.map((recipient) => {
    if (isMasterNotificationRecipient(recipient) || isComplaintAssignedEmailRecipient(complaint, recipient)) {
      return recipient;
    }

    return { ...recipient, email: '' };
  });
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

async function buildComplaintAssignedNotificationRecipients(complaint) {
  const recipientMap = new Map();
  const clinicRecipients = await getClinicCoordinatorManagerNotificationRecipients(complaint?.clinic_id);

  clinicRecipients.forEach((recipient) => addNotificationRecipient(recipientMap, recipient));
  buildComplaintAssignedAudienceRecipients(complaint).forEach((recipient) => addNotificationRecipient(recipientMap, recipient));
  addNotificationRecipient(recipientMap, {
    name: 'Administrador Master',
    role: 'master_admin',
    email: masterAdminEmail,
    whatsapp: masterAdminWhatsapp
  });

  return applyComplaintEmailResponsibilityPolicy(complaint, Array.from(recipientMap.values()));
}

async function buildComplaintNotificationRecipients(complaint) {
  const recipientMap = new Map();
  const adminAndSupervisorRecipients = await getAdminAndSupervisorNotificationRecipients();
  const clinicCoordinatorManagerRecipients = await getClinicCoordinatorManagerNotificationRecipients(complaint?.clinic_id);

  // Numeros fixos: altere fixedComplaintWhatsAppRecipients no topo deste arquivo se a regra mudar.
  fixedComplaintWhatsAppRecipients.forEach((phone) => {
    addNotificationRecipient(recipientMap, {
      name: `Fixo ${phone}`,
      role: 'fixed_complaint_number',
      whatsapp: phone
    });
  });

  adminAndSupervisorRecipients.forEach((recipient) => addNotificationRecipient(recipientMap, recipient));
  clinicCoordinatorManagerRecipients.forEach((recipient) => addNotificationRecipient(recipientMap, recipient));

  if (shouldNotifyAssignedComplaintAudience(complaint)) {
    buildComplaintAssignedAudienceRecipients(complaint).forEach((recipient) => addNotificationRecipient(recipientMap, recipient));
  }

  return applyComplaintEmailResponsibilityPolicy(complaint, Array.from(recipientMap.values()));
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

function toWhatsAppAscii(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trim();
}

function buildComplaintWhatsAppMessage(complaint, protocol) {
  const details = buildComplaintNotificationDetails(complaint, protocol);
  const safe = (value) => toWhatsAppAscii(value) || 'Nao informado';

  return [
    '[!] *NOVA RECLAMACAO REGISTRADA*',
    '----------------------------------------',
    '',
    `[#] *Protocolo:* ${safe(details.protocol)}`,
    `[UNIDADE] ${safe(details.unitLabel)}`,
    `[RESPONSAVEL] ${safe(details.responsibleLabel)}`,
    `[LOCAL] ${safe(details.cityStateLabel)}`,
    `[ABERTURA] ${safe(details.openedAtLabel)}`,
    '',
    '[LINK DA OCORRENCIA]',
    safe(details.complaintUrl),
    '',
    '[PRAZOS DE ATENDIMENTO]',
    '- Primeira acao: ate 24h',
    '- Atualizacao obrigatoria: ate 48h',
    '- Prazo final: 7 dias uteis',
    '',
    '[ATENCAO]',
    'A ausencia de atualizacao em ate 48h implicara em escalonamento automatico.',
    '',
    '[ACAO]',
    'Acompanhe e registre a tratativa no sistema.'
  ].join('\n');
}

function buildDefaultComplaintWhatsAppTemplateMessage() {
  return [
    '[!] *NOVA RECLAMACAO REGISTRADA*',
    '----------------------------------------',
    '',
    '[#] *Protocolo:* {{protocolo}}',
    '[UNIDADE] {{unidade}}',
    '[RESPONSAVEL] {{responsavel}}',
    '[LOCAL] {{cidade_uf}}',
    '[ABERTURA] {{data_abertura}}',
    '',
    '[LINK DA OCORRENCIA]',
    '{{link_ocorrencia}}',
    '',
    '[PRAZOS DE ATENDIMENTO]',
    '- Primeira acao: ate 24h',
    '- Atualizacao obrigatoria: ate 48h',
    '- Prazo final: 7 dias uteis',
    '',
    '[ATENCAO]',
    'A ausencia de atualizacao em ate 48h implicara em escalonamento automatico.',
    '',
    '[ACAO]',
    'Acompanhe e registre a tratativa no sistema.'
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

  let result;
  try {
    result = shouldUseWhatsAppServiceForSystemNotifications()
      ? await sendWhatsAppServiceSystemNotification({
        to: originalPhone,
        protocol,
        message,
        eventType,
        recipient
      })
      : await sender({ to: normalizedPhone, protocol, message, recipient });
  } catch (error) {
    result = {
      success: false,
      provider: shouldUseWhatsAppServiceForSystemNotifications() ? 'whatsapp_service' : 'twilio',
      error: whatsappVpsService.friendlyApiError(error)
    };
  }
  const status = result?.success ? 'sent' : result?.skipped ? 'skipped' : 'failed';

  await insertNotificationLog({
    eventType,
    protocol,
    channel: 'WHATSAPP',
    recipientPhone: normalizedPhone,
    recipientUserId: recipient?.userId,
    recipientRole: recipient?.role,
    status,
    errorMessage: result?.success ? null : result?.error || (result?.provider === 'whatsapp_service' ? 'Falha no envio pelo whatsapp-service.' : 'Falha no envio pela Twilio.'),
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

function shouldUseWhatsAppServiceForSystemNotifications() {
  const provider = String(process.env.WHATSAPP_SYSTEM_NOTIFICATIONS_PROVIDER || 'whatsapp_service').trim().toLowerCase();
  return provider !== 'twilio' && isWhatsAppServiceProviderConfigured();
}

async function sendWhatsAppServiceSystemNotification({ to, protocol, message, eventType, recipient }) {
  const number = normalizeWhatsAppPhone(to);

  if (!number) {
    return {
      success: false,
      provider: 'whatsapp_service',
      error: 'Telefone inválido para envio pelo whatsapp-service.'
    };
  }

  const npsEvent = String(eventType || '').toLowerCase().startsWith('nps_');
  const sessionId = String(
    recipient?.sessionId
      || recipient?.instanceName
      || (npsEvent ? WHATSAPP_NPS_INSTANCE_NAME : WHATSAPP_NOTIFICATION_INSTANCE_NAME)
  ).trim() || WHATSAPP_NOTIFICATION_INSTANCE_NAME;
  const serviceResponse = await whatsappProvider.sendText({
    sessionId,
    number,
    message
  });
  const providerMessageId = serviceResponse.messageId || null;

  try {
    await pool.query(
      `INSERT INTO whatsapp_service_message_history
       (session_id, patient_phone, message_text, status, provider_message_id, response_payload, created_by, sent_at)
       VALUES (?, ?, ?, 'enviado', ?, ?, ?, NOW())`,
      [
        sessionId,
        number,
        message,
        providerMessageId,
        JSON.stringify(serviceResponse.raw || serviceResponse),
        `Notificação do sistema${protocol ? ` - ${protocol}` : ''}`
      ]
    );
  } catch (error) {
    console.warn('Não foi possível gravar histórico do whatsapp-service para notificação:', error.message);
  }

  await logEvolutionEvent('system_notification_whatsapp_service', {
    instanceName: sessionId,
    status: 'success',
    request: {
      eventType,
      protocol,
      recipientRole: recipient?.role,
      number,
      textLength: String(message || '').length
    },
    response: serviceResponse
  });

  return {
    success: true,
    provider: 'whatsapp_service',
    providerMessageId,
    serviceResponse
  };
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

    if (isClosedComplaintStatus(complaint.status) || complaint.deleted_at) {
      return { notificationStatus: 'skipped', results: [] };
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

    if (isClosedComplaintStatus(complaint.status) || complaint.deleted_at) {
      return { notificationStatus: 'skipped', results: [] };
    }

    const recipients = (await buildComplaintAssignedNotificationRecipients(complaint)).map((recipient) => ({
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
      (SELECT COUNT(*) FROM complaints c WHERE c.deleted_at IS NULL AND ${buildOpenComplaintStatusWhere('c')}) AS complaints_open,
      (SELECT COUNT(*) FROM complaints c WHERE c.deleted_at IS NULL AND c.resolution_due_at IS NOT NULL AND c.resolution_due_at < NOW() AND ${buildOpenComplaintStatusWhere('c')}) AS complaints_overdue,
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

async function getEvolutionMonitoring() {
  const config = getWhatsAppServiceConfigStatus();
  const diagnostic = await whatsappVpsService.diagnostic();
  const [summaryRows] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM whatsapp_instances) AS instances_total,
      (SELECT COUNT(*) FROM whatsapp_instances WHERE status = 'conectado') AS instances_connected,
      (SELECT COUNT(*) FROM whatsapp_conversations WHERE DATE(created_at) = CURDATE()) AS conversations_today,
      (SELECT COUNT(*) FROM whatsapp_messages WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS messages_24h,
      (SELECT COUNT(*) FROM whatsapp_messages WHERE status = 'erro' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS errors_24h,
      (SELECT COUNT(*) FROM whatsapp_attendance_queue WHERE status = 'aguardando') AS queue_waiting
  `);
  const row = summaryRows[0] || {};
  return {
    configured: diagnostic.configured,
    status: diagnostic.configured
      ? diagnostic.serviceReachable
        ? 'online'
        : 'error'
      : 'not_configured',
    label: 'WhatsApp Service Hostinger',
    metrics: {
      baseUrl: config.baseUrlConfigured ? config.baseURL : 'Não configurado',
      pingMs: diagnostic.responseTimeMs || null,
      version: diagnostic.version || 'Não informado',
      instances: Number(row.instances_total || diagnostic.instanceCount || 0),
      connected: Number(row.instances_connected || 0),
      messages24h: Number(row.messages_24h || 0),
      errors24h: Number(row.errors_24h || 0),
      queueWaiting: Number(row.queue_waiting || 0),
      conversationsToday: Number(row.conversations_today || 0)
    },
    notes: diagnostic.serviceReachable
      ? ['whatsapp-service da Hostinger respondendo pelo backend.']
      : [diagnostic.message || 'whatsapp-service indisponível ou configuração ausente.']
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
  const normalizedRole = normalizeAccessRole(role);
  const defaultPermissions = defaultPermissionsForRole(role);
  let permissions = defaultPermissions;

  try {
    permissions = user?.permissions ? JSON.parse(user.permissions) : permissions;
  } catch (error) {
    permissions = defaultPermissions;
  }

  const parsedPermissions = Array.isArray(permissions) ? permissions : defaultPermissions;
  const identity = [user?.username, user?.email, user?.name]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const normalizedIdentity = identity.map((value) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, ''));
  const hasDentalCardNamedAccess = normalizedIdentity.some((value) => (
    value === 'joyce.crc'
    || value === 'igor.silva.cruz'
    || value.includes('igor.silva.cruz')
  ));

  if (hasDentalCardNamedAccess) {
    return Array.from(new Set([...parsedPermissions, 'home', 'dental_card']));
  }

  if (['sac_operator', 'coordinator', 'manager'].includes(normalizedRole)) {
    return Array.from(new Set([...parsedPermissions, ...defaultPermissions]));
  }

  return Array.from(new Set(parsedPermissions));
}

function parseActionPermissionsFromUser(user) {
  return getUserActionPermissions(user);
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
  const actionPermissions = parseActionPermissionsFromUser(safeUser);
  const clinicIds = await getUserClinicIds(user.id);
  const mustChangePassword = Boolean(user.must_change_password);
  const tokenVersion = Number(user.token_version || 1);

  return {
    ...safeUser,
    role,
    permissions,
    actionPermissions,
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
    actionPermissions: user.actionPermissions,
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

  let result;
  if (shouldUseWhatsAppServiceForSystemNotifications() && normalizedPhone) {
    try {
      result = await sendWhatsAppServiceSystemNotification({
        to: normalizedPhone,
        protocol: payload?.protocol,
        message,
        eventType: payload?.event || 'generic_notification',
        recipient: {
          userId: payload?.userId || null,
          role: payload?.role || null,
          sessionId: payload?.sessionId || null,
          instanceName: payload?.instanceName || null
        }
      });
    } catch (error) {
      result = {
        success: false,
        provider: 'whatsapp_service',
        error: whatsappVpsService.friendlyApiError(error)
      };
    }
  } else {
    result = provider === 'twilio'
      ? await sendWhatsAppMessage(normalizedPhone || payload?.to, message, payload)
      : {
        success: false,
        skipped: true,
        provider,
        error: 'Somente Twilio está habilitado para WhatsApp.'
      };
  }

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

function isCrcOperatorUser(user) {
  return normalizeAccessRole(user?.role) === 'crc_operator';
}

function clinicIdsFromUser(user) {
  return (Array.isArray(user?.clinicIds) ? user.clinicIds : [])
    .map((clinicId) => Number(clinicId))
    .filter((clinicId) => Number.isInteger(clinicId) && clinicId > 0);
}

async function getCurrentUserClinicIds(user) {
  if (!user?.id) return [];
  const tokenClinicIds = clinicIdsFromUser(user);
  if (tokenClinicIds.length) return tokenClinicIds;
  return getUserClinicIds(user.id);
}

async function assertCrcOperatorClinicAccess(user, clinicId) {
  if (!isCrcOperatorUser(user)) return;
  const normalizedClinicId = Number(clinicId || 0);
  const clinicIds = await getCurrentUserClinicIds(user);

  if (!clinicIds.length) {
    throw new Error('Seu usuário de Operador CRC não possui clínicas vinculadas para envio.');
  }

  if (!Number.isInteger(normalizedClinicId) || normalizedClinicId <= 0) {
    throw new Error('Selecione uma clínica vinculada ao seu usuário para enviar ou registrar atendimento.');
  }

  if (!clinicIds.includes(normalizedClinicId)) {
    throw new Error('Você só pode enviar mensagens para clínicas vinculadas ao seu usuário.');
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

async function notifyCrcOperatorApprovalRequired(operator) {
  const title = 'Operador de CRC aguardando autorização';
  const link = '/admin';
  const message = `${operator.name} solicitou acesso como Operador de CRC. Usuário: ${operator.username}. Acesse a gestão de usuários para revisar e ativar o cadastro.`;
  const payload = {
    userId: operator.id,
    username: operator.username,
    email: operator.email,
    phone: operator.phone,
    role: 'crc_operator',
    requiresAuthorization: true
  };

  try {
    await createNotificationForRoles(
      ['master_admin'],
      'crc_operator_approval_required',
      title,
      message,
      link,
      payload
    );
  } catch (error) {
    console.warn('Não foi possível criar notificação de autorização do Operador CRC:', error.message);
  }

  try {
    await notifyMasterPasswordSecurityEvent(
      'crc_operator_approval_required',
      title,
      message,
      payload
    );
  } catch (error) {
    console.warn('Não foi possível notificar o Administrador Master sobre Operador CRC:', error.message);
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
        AND ${buildRoleAliasWhere('u.role', coordinatorManagerAccessRoleAliases)}`,
    [clinicId, ...getRoleAliasParams(coordinatorManagerAccessRoleAliases)]
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
          OR (
            ? IS NOT NULL
            AND u.id IN (
              SELECT uc.user_id
                FROM user_clinics uc
               WHERE uc.clinic_id = ?
            )
            AND ${buildRoleAliasWhere('u.role', coordinatorManagerAccessRoleAliases)}
          )
        )`,
      [
        assignedResponsibleUserId || null,
        assignedResponsibleUserId || null,
        clinicId || null,
        clinicId || null,
        ...getRoleAliasParams(coordinatorManagerAccessRoleAliases)
      ]
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
        AND ${buildOpenComplaintStatusWhere('c')}
        AND c.due_at IS NOT NULL
       AND c.due_warning_sent_at IS NULL
       AND c.due_at > NOW()
       AND c.due_at <= DATE_ADD(NOW(), INTERVAL 24 HOUR)`,
    []
  );

  for (const complaint of rows) {
    if (await isComplaintClosedOrDeleted(complaint.id)) {
      continue;
    }

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
       AND ${buildOpenComplaintStatusWhere('c')}
       AND c.due_at IS NOT NULL
       AND c.due_at < NOW()
       AND u.id IS NOT NULL
       AND u.active = 1
       AND u.deleted_at IS NULL`
  );

  const results = [];

  for (const complaint of rows) {
    if (await isComplaintClosedOrDeleted(complaint.id)) {
      continue;
    }

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

function buildComplaintStalledTreatmentReminderWindowKey(now = new Date()) {
  const intervalMs = complaintStalledTreatmentReminderHours * 60 * 60 * 1000;
  return Math.floor(now.getTime() / intervalMs);
}

function buildComplaintStalledTreatmentReminderJobKey(complaintId, now = new Date()) {
  return `complaint_stalled_treatment:${complaintId}:${buildComplaintStalledTreatmentReminderWindowKey(now)}`;
}

function buildStalledComplaintTreatmentReminder(complaint) {
  const protocol = complaint?.protocol || `GRC-${complaint?.id || ''}`;
  const clinic = complaint?.clinic_name
    ? `${complaint.clinic_name}${complaint.city ? ` - ${complaint.city}/${complaint.state || 'UF'}` : ''}`
    : 'Unidade não informada';
  const complaintUrl = `${frontendUrl}/gestao/${complaint?.id}`;
  const openedAt = formatMessageDateTime(complaint?.created_at);
  const responsibleName = complaint?.assigned_responsible_name
    || complaint?.assigned_coordinator_name
    || complaint?.assigned_user_name
    || 'Responsável não definido';
  const subject = `Demanda sem tratativa - protocolo ${protocol}`;
  const title = `Demanda sem tratativa - ${protocol}`;
  const message = [
    '⏰ *LEMBRETE DE DEMANDA SEM TRATATIVA*',
    '',
    `📌 Protocolo: ${protocol}`,
    `🏥 Unidade: ${clinic}`,
    `👤 Responsável atual: ${responsibleName}`,
    `📅 Data de abertura: ${openedAt}`,
    '',
    '📝 *Link da ocorrência:*',
    complaintUrl,
    '',
    `⚠️ Esta demanda está há mais de ${complaintStalledTreatmentThresholdHours}h sem tratativa registrada.`,
    '',
    '📊 Acesse o sistema, registre a evolução e atualize a responsabilidade da demanda.'
  ].join('\n');

  return {
    protocol,
    complaintUrl,
    subject,
    title,
    message,
    html: emailService.renderBrandedEmail({
      eyebrow: 'Demanda sem tratativa',
      title: `Protocolo sem tratativa ${protocol}`,
      intro: 'Olá,',
      bodyHtml: `
        <p style="margin:0 0 18px;">A demanda abaixo está há mais de ${complaintStalledTreatmentThresholdHours}h sem tratativa registrada no sistema.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 8px;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Paciente</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(complaint?.patient_name || 'Não informado')}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Unidade</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(clinic)}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eadcca;color:#6c5a4e;">Responsável atual</td><td style="padding:10px 0;border-bottom:1px solid #eadcca;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(responsibleName)}</td></tr>
          <tr><td style="padding:10px 0;color:#6c5a4e;">Aberta em</td><td style="padding:10px 0;text-align:right;font-weight:700;color:#2f2825;">${escapeNotificationHtml(openedAt)}</td></tr>
        </table>
        <p style="margin:18px 0 0;">Acesse o protocolo, registre a evolução e mantenha o lastro da tratativa atualizado.</p>
      `,
      actionLabel: 'Abrir protocolo',
      actionUrl: complaintUrl,
      footerText: `Lembrete automático reenviado a cada ${complaintStalledTreatmentReminderHours} horas enquanto a demanda permanecer sem tratativa.`
    })
  };
}

async function buildStalledComplaintTreatmentRecipients(complaint) {
  const recipientMap = new Map();
  const [adminAndSupervisorRecipients, clinicRecipients] = await Promise.all([
    getAdminAndSupervisorNotificationRecipients(),
    getClinicCoordinatorManagerNotificationRecipients(complaint?.clinic_id)
  ]);

  adminAndSupervisorRecipients.forEach((recipient) => addNotificationRecipient(recipientMap, recipient));
  clinicRecipients.forEach((recipient) => addNotificationRecipient(recipientMap, recipient));

  addNotificationRecipient(recipientMap, {
    userId: complaint?.assigned_user_id,
    name: complaint?.assigned_user_name || complaint?.assigned_responsible_name || complaint?.assigned_coordinator_name,
    role: complaint?.assigned_user_role || complaint?.assigned_responsible_role || 'responsible',
    email: complaint?.assigned_user_email,
    whatsapp: complaint?.assigned_user_whatsapp || complaint?.assigned_user_phone
  });

  return Array.from(recipientMap.values()).filter((recipient) => recipient.email || recipient.phone);
}

async function dispatchStalledComplaintTreatmentReminders(now = new Date()) {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.protocol,
       c.clinic_id,
       c.patient_name,
       c.complaint_type,
       c.priority,
       c.created_at,
       c.due_at,
       c.assigned_coordinator_user_id,
       c.assigned_coordinator_name,
       c.assigned_responsible_user_id,
       c.assigned_responsible_name,
       c.assigned_responsible_role,
       cl.name AS clinic_name,
       cl.city,
       cl.state,
       u.id AS assigned_user_id,
       u.name AS assigned_user_name,
       u.email AS assigned_user_email,
       u.whatsapp AS assigned_user_whatsapp,
       u.phone AS assigned_user_phone,
       u.role AS assigned_user_role
     FROM complaints c
     LEFT JOIN clinics cl ON cl.id = c.clinic_id
     LEFT JOIN users u ON u.id = COALESCE(c.assigned_responsible_user_id, c.assigned_coordinator_user_id)
     WHERE c.deleted_at IS NULL
       AND ${buildOpenComplaintStatusWhere('c')}
       AND c.treatment_at IS NULL
       AND c.created_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
       AND NOT EXISTS (
         SELECT 1
           FROM complaint_logs clg
          WHERE clg.complaint_id = c.id
            AND clg.action = 'treatment_saved'
       )`,
    [complaintStalledTreatmentThresholdHours]
  );

  const results = [];

  for (const complaint of rows) {
    if (await isComplaintClosedOrDeleted(complaint.id)) {
      continue;
    }

    const jobKey = buildComplaintStalledTreatmentReminderJobKey(complaint.id, now);
    const [existingJobRows] = await pool.query(
      'SELECT id FROM system_job_runs WHERE job_key = ? LIMIT 1',
      [jobKey]
    );

    if (existingJobRows.length) {
      continue;
    }

    const reminder = buildStalledComplaintTreatmentReminder(complaint);
    const recipients = await buildStalledComplaintTreatmentRecipients(complaint);
    const delivery = await deliverProtocolNotifications({
      eventType: 'COMPLAINT_STALLED_NO_TREATMENT',
      protocol: reminder.protocol,
      recipients,
      emailTemplate: {
        subject: reminder.subject,
        html: reminder.html
      },
      whatsappSender: ({ to, protocol, message }) => sendTwilioGenericNotification({
        to,
        protocol,
        message,
        eventType: 'complaint_stalled_no_treatment',
        verifyFinalStatus: true
      }),
      whatsappMessage: reminder.message
    });

    await recordJobRun(jobKey, {
      complaintId: complaint.id,
      protocol: reminder.protocol,
      recipients: recipients.length,
      notificationStatus: delivery.notificationStatus
    });

    results.push({
      complaintId: complaint.id,
      protocol: reminder.protocol,
      recipients: recipients.length,
      notificationStatus: delivery.notificationStatus
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
       AND ${buildOpenComplaintStatusWhere('c')}
       AND c.due_at IS NOT NULL
       AND c.due_at < NOW()
       AND c.overdue_manager_notified_at IS NULL`
  );

  for (const complaint of rows) {
    if (await isComplaintClosedOrDeleted(complaint.id)) {
      continue;
    }

    const [managers] = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.email
         FROM users u
         INNER JOIN user_clinics uc ON uc.user_id = u.id AND uc.clinic_id = ?
        WHERE u.active = 1
          AND u.deleted_at IS NULL
          AND ${buildRoleAliasWhere('u.role', managerAccessRoleAliases)}`,
      [complaint.clinic_id, ...getRoleAliasParams(managerAccessRoleAliases)]
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

function normalizeClinicIds(ids = []) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((clinicId) => Number(clinicId))
    .filter((clinicId) => Number.isInteger(clinicId) && clinicId > 0)));
}

async function syncClinicLeadershipForUser({
  userId,
  previousRole,
  nextRole,
  previousName,
  nextName,
  previousClinicIds = [],
  nextClinicIds = []
}) {
  const oldRole = normalizeAccessRole(previousRole);
  const role = normalizeAccessRole(nextRole);
  const oldName = String(previousName || '').trim();
  const name = String(nextName || '').trim();
  const oldIds = normalizeClinicIds(previousClinicIds);
  const ids = normalizeClinicIds(nextClinicIds);

  const configs = [
    { role: 'coordinator', column: 'coordinator_name' },
    { role: 'manager', column: 'manager' }
  ];

  for (const config of configs) {
    const removedIds = oldRole === config.role
      ? oldIds.filter((clinicId) => !ids.includes(clinicId) || role !== config.role)
      : [];

    if (removedIds.length && oldName) {
      await pool.query(
        `UPDATE clinics
            SET ${config.column} = NULL
          WHERE id IN (?)
            AND LOWER(TRIM(COALESCE(${config.column}, ''))) = LOWER(TRIM(?))`,
        [removedIds, oldName]
      );
    }

    if (role === config.role && ids.length && name) {
      await pool.query(
        `UPDATE clinics
            SET ${config.column} = ?
          WHERE id IN (?)`,
        [name, ids]
      );
    }
  }
}

async function syncClinicLeadershipNamesFromUserLinks() {
  const [rows] = await pool.query(
    `SELECT
       uc.clinic_id,
       u.id,
       u.name,
       u.role
     FROM user_clinics uc
     INNER JOIN users u ON u.id = uc.user_id
     WHERE u.active = 1
       AND u.deleted_at IS NULL
       AND ${buildRoleAliasWhere('u.role', coordinatorManagerAccessRoleAliases)}
     ORDER BY uc.clinic_id ASC, u.updated_at DESC, u.id DESC`,
    getRoleAliasParams(coordinatorManagerAccessRoleAliases)
  );

  const selected = new Map();
  rows.forEach((row) => {
    const role = normalizeAccessRole(row.role);
    const key = `${role}:${row.clinic_id}`;
    if (!selected.has(key)) selected.set(key, row);
  });

  for (const row of selected.values()) {
    const role = normalizeAccessRole(row.role);
    const column = role === 'manager' ? 'manager' : 'coordinator_name';
    const name = String(row.name || '').trim();

    if (!name) continue;

    await pool.query(
      `UPDATE clinics
          SET ${column} = ?
        WHERE id = ?
          AND (
            ${column} IS NULL
            OR TRIM(${column}) = ''
            OR LOWER(TRIM(${column})) <> LOWER(TRIM(?))
          )`,
      [name, row.clinic_id, name]
    );
  }
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
       AND ${buildRoleAliasWhere('u.role', coordinatorAccessRoleAliases)}
     ORDER BY CASE
       WHEN ? <> '' AND LOWER(TRIM(u.name)) = LOWER(TRIM(?)) THEN 0
       ELSE 1
     END,
     u.name ASC
     LIMIT 1`,
    [clinicId, ...getRoleAliasParams(coordinatorAccessRoleAliases), configuredCoordinatorName, configuredCoordinatorName]
  );

  let coordinator = coordinatorRows[0] || null;

  if (!coordinator && configuredCoordinatorName) {
    const [fallbackRows] = await pool.query(
      `SELECT
         u.id,
         u.name
       FROM users u
       WHERE u.deleted_at IS NULL
         AND u.active = 1
         AND ${buildRoleAliasWhere('u.role', coordinatorAccessRoleAliases)}
         AND LOWER(TRIM(u.name)) = LOWER(TRIM(?))
       ORDER BY u.updated_at DESC, u.id DESC
       LIMIT 1`,
      [...getRoleAliasParams(coordinatorAccessRoleAliases), configuredCoordinatorName]
    );
    coordinator = fallbackRows[0] || null;
  }

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
       AND ${buildRoleAliasWhere('u.role', managerAccessRoleAliases)}
     ORDER BY u.name ASC
     LIMIT 1`,
    [clinicId, ...getRoleAliasParams(managerAccessRoleAliases)]
  );

  return {
    managerUserId: rows[0]?.id || null,
    managerName: rows[0]?.name || 'Gerente da unidade'
  };
}

async function resolveComplaintResponsibleAssignment(clinicId, forwardRole, options = {}) {
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

  if (forwardRole === 'sac_operator') {
    const preferredName = String(options.preferredName || '').trim();
    const [rows] = await pool.query(
      `SELECT id, name
         FROM users
        WHERE deleted_at IS NULL
          AND active = 1
          AND role = 'sac_operator'
        ORDER BY CASE
          WHEN ? <> '' AND LOWER(TRIM(name)) = LOWER(TRIM(?)) THEN 0
          ELSE 1
        END,
        name ASC
        LIMIT 1`,
      [preferredName, preferredName]
    );

    return {
      userId: rows[0]?.id || null,
      name: rows[0]?.name || preferredName || 'Operador de SAC',
      role: 'sac_operator',
      label: rows[0]?.name || preferredName || 'Operador de SAC',
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

  if (isAdminUser(user) || ['supervisor_crc', 'crc_leader', 'crc_manager'].includes(normalizeAccessRole(user?.role))) {
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
        AND ${buildOpenComplaintStatusWhere('c')}
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
  const where = ['c.deleted_at IS NULL', buildOpenComplaintStatusWhere('c')];
  const params = [];

  if (!isAdminUser(user) && normalizeAccessRole(user?.role) !== 'sac_operator') {
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

    if (demandCount <= 0) {
      results.push(userResult);
      continue;
    }

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

function buildDailyCoordinatorDemandReminderJobKey(now = new Date()) {
  const parts = getZonedDateParts(now, dailyCoordinatorDemandReminderTimeZone);
  return [
    'daily_coordinator_demand_reminder',
    parts.year,
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0')
  ].join(':');
}

async function shouldRunDailyCoordinatorDemandReminders(jobKey, now = new Date()) {
  if (!dailyCoordinatorDemandReminderEnabled) return false;

  const parts = getZonedDateParts(now, dailyCoordinatorDemandReminderTimeZone);
  if (parts.hour < dailyCoordinatorDemandReminderHour) return false;

  const [rows] = await pool.query('SELECT id FROM system_job_runs WHERE job_key = ? LIMIT 1', [jobKey]);
  return rows.length === 0;
}

async function getActiveCoordinatorsForDailyDemandReminder() {
  const [users] = await pool.query(
    `SELECT id, name, email, phone, whatsapp, role, active
      FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND ${buildRoleAliasWhere('role', coordinatorManagerAccessRoleAliases)}
      ORDER BY
        CASE
          WHEN role IN ('coordinator', 'coordenador', 'coordenador_unidade', 'coordenador_de_unidade') THEN 0
          WHEN role IN ('manager', 'gerente', 'gerente_unidade', 'gerente_de_unidade') THEN 1
          ELSE 2
        END,
        name ASC`,
    getRoleAliasParams(coordinatorManagerAccessRoleAliases)
  );

  return users;
}

function buildCoordinatorDemandReminderScope(responsibleUser, clinicIds) {
  const responsibleName = String(responsibleUser?.name || '').trim();
  const targetRole = normalizeAccessRole(responsibleUser?.role) === 'manager' ? 'manager' : 'coordinator';
  const responsibleClauses = [
    'c.assigned_responsible_user_id = ?',
    `(
      c.assigned_responsible_role = ?
      AND COALESCE(c.assigned_responsible_user_id, 0) = 0
    )`,
    `(
      c.forwarded_to_role = ?
      AND (
        c.forwarded_to_label IS NULL
        OR TRIM(c.forwarded_to_label) = ''
        OR LOWER(TRIM(c.forwarded_to_label)) = LOWER(TRIM(?))
      )
    )`,
    `(
      ? <> ''
      AND LOWER(TRIM(COALESCE(c.assigned_responsible_name, ''))) = LOWER(TRIM(?))
    )`
  ];
  const responsibleParams = [
    responsibleUser.id,
    targetRole,
    targetRole,
    responsibleName,
    responsibleName,
    responsibleName
  ];

  if (targetRole === 'coordinator') {
    responsibleClauses.push(`(
      c.assigned_coordinator_user_id = ?
      AND COALESCE(NULLIF(c.assigned_responsible_role, ''), NULLIF(c.forwarded_to_role, ''), 'coordinator') = 'coordinator'
    )`);
    responsibleParams.push(responsibleUser.id);
  }

  return {
    where: [
      'c.deleted_at IS NULL',
      buildOpenComplaintStatusWhere('c'),
      'c.clinic_id IN (?)',
      `(${responsibleClauses.join(' OR ')})`
    ],
    params: [clinicIds, ...responsibleParams]
  };
}

async function getCoordinatorDemandReminderStats(coordinator) {
  const clinicIds = await getUserClinicIds(coordinator.id);
  if (!clinicIds.length) {
    return { total: 0, overdue: 0, withoutTreatment: 0, demands: [] };
  }

  const scope = buildCoordinatorDemandReminderScope(coordinator, clinicIds);
  const whereSql = scope.where.join(' AND ');
  const [summaryRows] = await pool.query(
    `SELECT
        COUNT(DISTINCT c.id) AS total,
        SUM(CASE WHEN COALESCE(c.resolution_due_at, c.due_at) IS NOT NULL AND COALESCE(c.resolution_due_at, c.due_at) < NOW() THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN c.treatment_at IS NULL THEN 1 ELSE 0 END) AS without_treatment
       FROM complaints c
       LEFT JOIN clinics cl ON cl.id = c.clinic_id
      WHERE ${whereSql}`,
    scope.params
  );
  const [demands] = await pool.query(
    `SELECT
        c.id,
        COALESCE(c.protocol, CONCAT('GRC-', c.id)) AS protocol,
        COALESCE(c.clinic_snapshot_name, cl.name, 'Unidade nao informada') AS clinic_name,
        c.status,
        c.treatment_at,
        COALESCE(c.resolution_due_at, c.due_at) AS deadline_at
       FROM complaints c
       LEFT JOIN clinics cl ON cl.id = c.clinic_id
      WHERE ${whereSql}
      ORDER BY
        CASE WHEN COALESCE(c.resolution_due_at, c.due_at) IS NOT NULL AND COALESCE(c.resolution_due_at, c.due_at) < NOW() THEN 0 ELSE 1 END,
        COALESCE(c.resolution_due_at, c.due_at) ASC,
        c.created_at ASC,
        c.id ASC
      LIMIT 8`,
    scope.params
  );
  const summary = summaryRows[0] || {};

  return {
    total: parseSqlCount(summary, 'total'),
    overdue: parseSqlCount(summary, 'overdue'),
    withoutTreatment: parseSqlCount(summary, 'without_treatment'),
    demands
  };
}

function buildDailyCoordinatorDemandReminderMessage({ coordinator, summary, demands }) {
  const safe = (value) => toWhatsAppAscii(value) || 'Nao informado';
  const name = safe(coordinator?.name || 'coordenador');
  const total = Number(summary?.total || 0);
  const visibleDemands = Array.isArray(demands) ? demands : [];
  const lines = [
    '[LEMBRETE DIARIO - DEMANDAS]',
    '----------------------------------------',
    '',
    `Bom dia, ${name}.`,
    '',
    '[RESUMO DO DIA]',
    `- Demandas abertas: ${total}`,
    `- Demandas vencidas: ${Number(summary?.overdue || 0)}`,
    `- Sem tratativa registrada: ${Number(summary?.withoutTreatment || 0)}`,
    '',
    '[PRIORIDADES]'
  ];

  if (visibleDemands.length) {
    visibleDemands.forEach((demand, index) => {
      const deadline = demand.deadline_at ? safe(formatMessageDateTime(demand.deadline_at)) : 'Sem prazo definido';
      const overdue = demand.deadline_at && new Date(demand.deadline_at).getTime() < Date.now();
      const status = overdue ? 'VENCIDA' : safe(demand.status || 'em andamento');
      lines.push(`${index + 1}. ${safe(demand.protocol)} | ${safe(demand.clinic_name)} | ${status} | Prazo: ${deadline}`);
    });
  } else {
    lines.push('Nenhuma prioridade aberta localizada para o seu usuario.');
  }

  const hiddenTotal = Math.max(0, total - visibleDemands.length);
  if (hiddenTotal > 0) {
    lines.push(`... e mais ${hiddenTotal} demanda(s) no sistema.`);
  }

  lines.push(
    '',
    '[ACAO]',
    'Acesse o sistema, atualize as tratativas e registre a evolucao de cada protocolo.',
    `${frontendUrl}/gestao`
  );

  return lines.join('\n');
}

async function getDailyCoordinatorReminderInstance() {
  if (!isWhatsAppEnabled() || !isWhatsAppServiceProviderConfigured()) return null;

  const preferredInstance = String(process.env.WHATSAPP_DAILY_REMINDER_INSTANCE_NAME || WHATSAPP_NOTIFICATION_INSTANCE_NAME).trim();
  const allowFallback = String(process.env.WHATSAPP_DAILY_REMINDER_ALLOW_FALLBACK || 'true').trim().toLowerCase() === 'true';
  const where = ["status = 'conectado'"];
  const params = [preferredInstance];

  if (!allowFallback) {
    where.push('instance_name = ?');
    params.push(preferredInstance);
  }

  const [rows] = await pool.query(
    `SELECT *
       FROM whatsapp_instances
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE
          WHEN instance_name = ? THEN 0
          WHEN instance_name = 'reclamacoes' THEN 1
          ELSE 2
        END,
        updated_at DESC
      LIMIT 1`,
    params
  );

  return rows[0] || null;
}

async function dispatchDailyCoordinatorDemandReminders() {
  const instance = await getDailyCoordinatorReminderInstance();
  if (!instance) {
    return {
      coordinators: 0,
      queued: 0,
      skipped: true,
      reason: 'no_connected_whatsapp_instance'
    };
  }

  const coordinators = await getActiveCoordinatorsForDailyDemandReminder();
  const usedPhones = new Set();
  const results = [];
  let queueIndex = 0;

  for (const coordinator of coordinators) {
    const phone = getUserWhatsappTarget(coordinator);
    const result = {
      userId: coordinator.id,
      name: coordinator.name,
      phone: phone || null,
      demandCount: 0,
      status: 'skipped',
      queueId: null,
      error: null
    };

    if (!phone || usedPhones.has(phone)) {
      results.push(result);
      continue;
    }

    usedPhones.add(phone);
    const summary = await getCoordinatorDemandReminderStats(coordinator);
    result.demandCount = summary.total;

    if (!summary.total) {
      results.push(result);
      continue;
    }

    try {
      const messageText = buildDailyCoordinatorDemandReminderMessage({
        coordinator,
        summary,
        demands: summary.demands
      });
      const messageId = await insertWhatsAppMessage({
        conversation_id: null,
        instance_name: instance.instance_name,
        session_id: instance.instance_name,
        patient_phone: phone,
        phone,
        patient_name: coordinator.name,
        direction: 'outbound',
        message_text: messageText,
        message_type: 'daily_coordinator_demand_reminder',
        source: 'system_daily_reminder',
        status: 'pendente',
        operator_name: 'Sistema - lembrete diario',
        clinic_name: 'Demandas do responsavel'
      });
      const scheduledDelaySeconds = (queueIndex * dailyCoordinatorDemandReminderSpacingSeconds) + randomIntegerBetween(8, 25);
      const queued = await enqueueWhatsAppDispatch({
        message_id: messageId,
        conversation_id: null,
        instance_name: instance.instance_name,
        recipient_phone: phone,
        message_text: messageText,
        message_type: 'daily_coordinator_demand_reminder',
        operator_name: 'Sistema - lembrete diario',
        scheduleDelaySeconds: scheduledDelaySeconds,
        payload: {
          source: 'daily_coordinator_demand_reminder',
          coordinatorId: coordinator.id,
          demandCount: summary.total,
          spacingSeconds: dailyCoordinatorDemandReminderSpacingSeconds
        }
      });

      queueIndex += 1;
      result.status = 'queued';
      result.queueId = queued?.id || null;
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
      console.warn('Nao foi possivel enfileirar lembrete diario ao coordenador:', error.message);
    }

    results.push(result);
  }

  return {
    coordinators: coordinators.length,
    queued: results.filter((item) => item.status === 'queued').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results
  };
}

async function runScheduledDailyCoordinatorDemandReminders(now = new Date()) {
  const jobKey = buildDailyCoordinatorDemandReminderJobKey(now);

  if (!(await shouldRunDailyCoordinatorDemandReminders(jobKey, now))) {
    return null;
  }

  const payload = await dispatchDailyCoordinatorDemandReminders();
  if (payload?.reason === 'no_connected_whatsapp_instance') {
    return payload;
  }

  await recordJobRun(jobKey, payload);
  return payload;
}

async function handleRunDailyOpenDemandWhatsAppReminders(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode disparar avisos diários manualmente.' });
    }

    const payload = await dispatchDailyCoordinatorDemandReminders();
    return res.json({
      success: true,
      message: payload?.reason === 'no_connected_whatsapp_instance'
        ? 'Nenhuma sessão WhatsApp conectada para enviar os avisos.'
        : `${payload?.queued || 0} aviso(s) diário(s) enfileirado(s) com espaçamento anti-ban.`,
      payload
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao disparar avisos diários de demandas abertas.' });
  }
}

function buildDailyCoordinatorDeliveryReportPeriod(now = new Date()) {
  const parts = getZonedDateParts(now, dailyCoordinatorDeliveryReportTimeZone);
  const start = new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
  const end = new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999);
  return { start, end };
}

function buildDailyCoordinatorDeliveryReportJobKey(now = new Date()) {
  const parts = getZonedDateParts(now, dailyCoordinatorDeliveryReportTimeZone);
  return [
    'daily_coordinator_delivery_report',
    parts.year,
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0')
  ].join(':');
}

async function shouldRunDailyCoordinatorDeliveryReport(jobKey, now = new Date()) {
  if (!dailyCoordinatorDeliveryReportEnabled) return false;

  const parts = getZonedDateParts(now, dailyCoordinatorDeliveryReportTimeZone);
  if (parts.hour < dailyCoordinatorDeliveryReportHour) return false;

  const [rows] = await pool.query('SELECT id FROM system_job_runs WHERE job_key = ? LIMIT 1', [jobKey]);
  return rows.length === 0;
}

function classifyDailyCoordinatorReminderDelivery(message = null) {
  if (!message) {
    return {
      key: 'not_sent',
      label: 'NAO ENFILEIRADO',
      confirmed: false
    };
  }

  const status = normalizeComplaintStatusValue(message.status || message.queue_status || '');
  if (message.read_at || message.responded_at || ['lida', 'respondida', 'read'].includes(status)) {
    return { key: 'confirmed_read', label: 'CHEGOU / LIDA', confirmed: true };
  }
  if (message.delivered_at || ['entregue', 'delivered'].includes(status)) {
    return { key: 'confirmed_delivered', label: 'CHEGOU / ENTREGUE', confirmed: true };
  }
  if (message.sent_at || message.queue_sent_at || ['enviada', 'enviado', 'sent'].includes(status)) {
    return { key: 'sent_unconfirmed', label: 'ENVIADA SEM CONFIRMACAO', confirmed: false };
  }
  if (['erro', 'failed', 'falha'].includes(status)) {
    return { key: 'failed', label: 'FALHOU', confirmed: false };
  }
  if (['cancelada', 'cancelado', 'canceled'].includes(status)) {
    return { key: 'cancelled', label: 'CANCELADA', confirmed: false };
  }

  return {
    key: 'pending',
    label: 'PENDENTE / FILA',
    confirmed: false
  };
}

async function getCoordinatorUnitsForReport(userId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.city, c.state
       FROM user_clinics uc
       INNER JOIN clinics c ON c.id = uc.clinic_id
      WHERE uc.user_id = ?
        AND c.active = 1
      ORDER BY c.name ASC`,
    [userId]
  );

  return rows;
}

async function getDailyCoordinatorDeliveryReportRows({ now = new Date(), start = null, end = null } = {}) {
  const period = start && end ? { start, end } : buildDailyCoordinatorDeliveryReportPeriod(now);
  const coordinators = await getActiveCoordinatorsForDailyDemandReminder();
  const rows = [];

  for (const coordinator of coordinators) {
    const phone = getUserWhatsappTarget(coordinator);
    const units = await getCoordinatorUnitsForReport(coordinator.id);
    const summary = await getCoordinatorDemandReminderStats(coordinator);
    const [messageRows] = phone
      ? await pool.query(
        `SELECT m.id,
                m.status,
                m.sent_at,
                m.delivered_at,
                m.read_at,
                m.responded_at,
                m.error_message,
                m.whatsapp_message_id,
                m.created_at,
                q.status AS queue_status,
                q.sent_at AS queue_sent_at,
                q.error_message AS queue_error_message
           FROM whatsapp_messages m
           LEFT JOIN whatsapp_dispatch_queue q ON q.message_id = m.id
          WHERE m.message_type = 'daily_coordinator_demand_reminder'
            AND m.patient_phone = ?
            AND m.created_at >= ?
            AND m.created_at <= ?
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1`,
        [phone, toMysqlDateTime(period.start), toMysqlDateTime(period.end)]
      )
      : [[]];
    const message = messageRows[0] || null;
    const delivery = !phone
      ? { key: 'no_phone', label: 'SEM TELEFONE', confirmed: false }
      : !summary.total
        ? { key: 'no_open_demands', label: 'SEM DEMANDAS ABERTAS', confirmed: false }
        : classifyDailyCoordinatorReminderDelivery(message);

    rows.push({
      userId: coordinator.id,
      name: coordinator.name,
      role: coordinator.role,
      phone: phone || null,
      units,
      unitNames: units.map((unit) => unit.name),
      demandCount: summary.total,
      overdue: summary.overdue,
      withoutTreatment: summary.withoutTreatment,
      messageId: message?.id || null,
      providerMessageId: message?.whatsapp_message_id || null,
      messageStatus: message?.status || null,
      queueStatus: message?.queue_status || null,
      sentAt: message?.sent_at || message?.queue_sent_at || null,
      deliveredAt: message?.delivered_at || null,
      readAt: message?.read_at || null,
      respondedAt: message?.responded_at || null,
      error: message?.error_message || message?.queue_error_message || null,
      deliveryStatus: delivery.key,
      deliveryLabel: delivery.label,
      deliveryConfirmed: delivery.confirmed
    });
  }

  return {
    period: {
      start: period.start,
      end: period.end
    },
    rows
  };
}

function compactDailyCoordinatorUnitList(units = []) {
  const safe = (value) => toWhatsAppAscii(value) || 'Nao informado';
  const names = units.map((unit) => safe(unit.name)).filter(Boolean);
  if (!names.length) return 'Sem unidades vinculadas';

  const text = names.join(', ');
  if (text.length <= 150) return text;
  return `${text.slice(0, 147)}...`;
}

function buildDailyCoordinatorDeliveryReportMessage(rows = [], { period = null, now = new Date() } = {}) {
  const safe = (value) => toWhatsAppAscii(value) || 'Nao informado';
  const validRows = Array.isArray(rows) ? rows : [];
  const withDemands = validRows.filter((row) => Number(row.demandCount || 0) > 0);
  const sentRows = validRows.filter((row) => ['confirmed_read', 'confirmed_delivered', 'sent_unconfirmed'].includes(row.deliveryStatus));
  const confirmedRows = validRows.filter((row) => row.deliveryConfirmed);
  const pendingRows = validRows.filter((row) => ['pending', 'not_sent'].includes(row.deliveryStatus));
  const failedRows = validRows.filter((row) => ['failed', 'cancelled', 'no_phone'].includes(row.deliveryStatus));
  const periodStart = period?.start || buildDailyCoordinatorDeliveryReportPeriod(now).start;
  const periodEnd = period?.end || buildDailyCoordinatorDeliveryReportPeriod(now).end;
  const sortedRows = validRows.slice().sort((a, b) => {
    const priority = {
      failed: 0,
      cancelled: 1,
      no_phone: 2,
      pending: 3,
      not_sent: 4,
      sent_unconfirmed: 5,
      confirmed_delivered: 6,
      confirmed_read: 7,
      no_open_demands: 8
    };
    return (priority[a.deliveryStatus] ?? 9) - (priority[b.deliveryStatus] ?? 9)
      || Number(b.demandCount || 0) - Number(a.demandCount || 0)
      || String(a.name || '').localeCompare(String(b.name || ''));
  });
  const visibleRows = sortedRows.slice(0, 30);
  const hiddenRows = Math.max(0, sortedRows.length - visibleRows.length);

  return [
    '[RELATORIO DIARIO - WHATSAPP COORDENADORES]',
    '----------------------------------------',
    `Periodo: ${formatWeeklyReportDate(periodStart)} 00:00 a ${formatWeeklyReportDate(periodEnd)} 23:59`,
    `Gerado em: ${safe(formatMessageDateTime(now))}`,
    '',
    '[RESUMO DE ENTREGA]',
    `- Coordenadores/Gerentes ativos: ${validRows.length}`,
    `- Com demandas abertas: ${withDemands.length}`,
    `- Mensagens enviadas: ${sentRows.length}`,
    `- Chegada confirmada pelo WhatsApp: ${confirmedRows.length}`,
    `- Pendentes/sem disparo: ${pendingRows.length}`,
    `- Falhas/sem telefone: ${failedRows.length}`,
    '',
    '[DETALHAMENTO]',
    ...(visibleRows.length
      ? visibleRows.map((row, index) => {
        const units = compactDailyCoordinatorUnitList(row.units || []);
        const phone = row.phone || 'Sem telefone';
        const status = row.deliveryLabel || 'Nao informado';
        const error = row.error ? ` | Erro: ${safe(row.error).slice(0, 90)}` : '';
        return `${index + 1}. ${safe(row.name)} | Tel: ${safe(phone)} | Unidades: ${units} | Demandas: ${Number(row.demandCount || 0)} | Status: ${status}${error}`;
      })
      : ['- Nenhum coordenador ou gerente ativo encontrado.']),
    ...(hiddenRows > 0 ? [`... e mais ${hiddenRows} registro(s) no sistema.`] : []),
    '',
    '[LEGENDA]',
    '- CHEGOU: mensagem entregue/lida ou resposta registrada pelo WhatsApp.',
    '- ENVIADA SEM CONFIRMACAO: saiu do sistema, mas ainda sem retorno de entrega.',
    '',
    `[ACOMPANHAR] ${frontendUrl}/home/whatsapp-management/history`
  ].join('\n');
}

async function dispatchDailyCoordinatorDeliveryReport({ actor = null, now = new Date() } = {}) {
  const instance = await getWeeklyAdminComplaintReportInstance();
  if (!instance) {
    return {
      administrators: 0,
      queued: 0,
      skipped: true,
      reason: 'no_connected_whatsapp_instance'
    };
  }

  const administrators = await getActiveAdministratorsForWeeklyComplaintReport();
  const report = await getDailyCoordinatorDeliveryReportRows({ now });
  const messageText = buildDailyCoordinatorDeliveryReportMessage(report.rows, {
    period: report.period,
    now
  });
  const usedPhones = new Set();
  const results = [];
  let queueIndex = 0;

  for (const admin of administrators) {
    const phone = getUserWhatsappTarget(admin);
    const result = {
      userId: admin.id,
      name: admin.name,
      role: admin.role,
      phone: phone || null,
      status: 'skipped',
      queueId: null,
      error: null
    };

    if (!phone || usedPhones.has(phone)) {
      results.push(result);
      continue;
    }

    usedPhones.add(phone);

    try {
      const messageId = await insertWhatsAppMessage({
        conversation_id: null,
        instance_name: instance.instance_name,
        session_id: instance.instance_name,
        patient_phone: phone,
        phone,
        patient_name: admin.name,
        direction: 'outbound',
        message_text: messageText,
        message_type: 'daily_coordinator_delivery_report',
        source: 'system_daily_coordinator_delivery_report',
        status: 'pendente',
        operator_id: actor?.id || null,
        operator_name: actor?.name || 'Sistema - relatorio diario',
        clinic_name: 'Administradores'
      });
      const scheduledDelaySeconds = (queueIndex * dailyCoordinatorDeliveryReportSpacingSeconds) + randomIntegerBetween(8, 25);
      const queued = await enqueueWhatsAppDispatch({
        message_id: messageId,
        conversation_id: null,
        instance_name: instance.instance_name,
        recipient_phone: phone,
        message_text: messageText,
        message_type: 'daily_coordinator_delivery_report',
        operator_id: actor?.id || null,
        operator_name: actor?.name || 'Sistema - relatorio diario',
        scheduleDelaySeconds: scheduledDelaySeconds,
        payload: {
          source: 'daily_coordinator_delivery_report',
          adminId: admin.id,
          periodStart: report.period.start.toISOString(),
          periodEnd: report.period.end.toISOString(),
          coordinatorCount: report.rows.length,
          confirmedCount: report.rows.filter((row) => row.deliveryConfirmed).length,
          spacingSeconds: dailyCoordinatorDeliveryReportSpacingSeconds
        }
      });

      queueIndex += 1;
      result.status = 'queued';
      result.queueId = queued?.id || null;
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
      console.warn('Nao foi possivel enfileirar relatorio diario de entregas:', error.message);
    }

    results.push(result);
  }

  return {
    administrators: administrators.length,
    queued: results.filter((item) => item.status === 'queued').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    failed: results.filter((item) => item.status === 'failed').length,
    period: {
      start: report.period.start.toISOString(),
      end: report.period.end.toISOString()
    },
    coordinatorReport: report.rows,
    results
  };
}

async function runScheduledDailyCoordinatorDeliveryReport(now = new Date()) {
  const jobKey = buildDailyCoordinatorDeliveryReportJobKey(now);

  if (!(await shouldRunDailyCoordinatorDeliveryReport(jobKey, now))) {
    return null;
  }

  const payload = await dispatchDailyCoordinatorDeliveryReport({ now });
  if (payload?.reason === 'no_connected_whatsapp_instance') {
    return payload;
  }

  await recordJobRun(jobKey, payload);
  return payload;
}

async function handleRunDailyCoordinatorDeliveryReport(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode disparar o relatório diário de entregas.' });
    }

    const payload = await dispatchDailyCoordinatorDeliveryReport({ actor: req.user });
    return res.json({
      success: true,
      message: payload?.reason === 'no_connected_whatsapp_instance'
        ? 'Nenhuma sessão WhatsApp conectada para enviar o relatório diário.'
        : `${payload?.queued || 0} relatório(s) diário(s) enfileirado(s) para administradores com espaçamento anti-ban.`,
      payload
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao disparar relatório diário de entregas aos administradores.' });
  }
}

function canSendComplaintWhatsAppReport(user) {
  const role = normalizeAccessRole(user?.role);
  return isAdminUser(user)
    || ['supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager'].includes(role)
    || hasScreenPermission(user, 'whatsapp_reports');
}

function getDefaultComplaintReportRecipients() {
  return String(process.env.WHATSAPP_COMPLAINT_REPORT_RECIPIENTS || '')
    .split(/[,\n;]/)
    .map((phone) => normalizeWhatsAppPhone(phone))
    .filter(Boolean)
    .concat(DEFAULT_COMPLAINT_REPORT_WHATSAPP_RECIPIENTS.map((phone) => normalizeWhatsAppPhone(phone)))
    .filter((phone, index, list) => phone && list.indexOf(phone) === index);
}

function formatWeeklyReportDate(value) {
  if (!value) return 'Nao informado';
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return 'Nao informado';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function buildComplaintReportWhatsAppMessage(rows = [], now = new Date()) {
  const safe = (value) => toWhatsAppAscii(value) || 'Nao informado';
  const validRows = rows.filter((row) => !row.deleted_at);
  const activeRows = validRows.filter((row) => !isClosedComplaintStatus(row.status));
  const closedRows = validRows.filter((row) => isClosedComplaintStatus(row.status));
  const overdueRows = activeRows.filter((row) => {
    const deadlineAt = row.resolution_due_at || row.due_at || row.due_date || null;
    return deadlineAt && new Date(deadlineAt).getTime() < now.getTime();
  });
  const noTreatmentRows = activeRows.filter((row) => !row.treatment_at && !Number(row.has_treatment_log || 0));
  const statusCounts = validRows.reduce((acc, row) => {
    const key = row.status || 'sem_status';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const groupActive = (labelForRow) => {
    const grouped = new Map();
    activeRows.forEach((row) => {
      const label = safe(labelForRow(row));
      const current = grouped.get(label) || { label, total: 0, overdue: 0 };
      current.total += 1;
      const deadlineAt = row.resolution_due_at || row.due_at || row.due_date || null;
      if (deadlineAt && new Date(deadlineAt).getTime() < now.getTime()) {
        current.overdue += 1;
      }
      grouped.set(label, current);
    });
    return Array.from(grouped.values())
      .sort((a, b) => b.total - a.total || b.overdue - a.overdue || a.label.localeCompare(b.label))
      .slice(0, 8);
  };
  const clinicRanking = groupActive((row) => row.clinic_name || row.clinic_snapshot_name || 'Sem unidade');
  const responsibleRanking = groupActive((row) => row.assigned_responsible_name || row.assigned_coordinator_name || row.forwarded_to_label || 'Sem responsavel');
  const recentRows = activeRows
    .slice()
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);

  return [
    '*RELATORIO ATUAL - RECLAMACOES*',
    `Atualizado em: ${safe(formatMessageDateTime(now))}`,
    '',
    '*Resumo geral*',
    `- Total cadastrado: ${validRows.length}`,
    `- Abertas/em andamento: ${activeRows.length}`,
    `- Finalizadas: ${closedRows.length}`,
    `- Vencidas: ${overdueRows.length}`,
    `- Sem tratativa: ${noTreatmentRows.length}`,
    '',
    '*Status*',
    ...Object.entries(statusCounts).map(([status, total]) => `- ${safe(status)}: ${total}`),
    '',
    '*Unidades com mais demandas abertas*',
    ...(clinicRanking.length
      ? clinicRanking.map((item, index) => `${index + 1}. ${item.label}: ${item.total} aberta(s), ${item.overdue} vencida(s)`)
      : ['- Nenhuma demanda aberta.']),
    '',
    '*Responsaveis atuais*',
    ...(responsibleRanking.length
      ? responsibleRanking.map((item, index) => `${index + 1}. ${item.label}: ${item.total} aberta(s), ${item.overdue} vencida(s)`)
      : ['- Nenhum responsavel com demanda aberta.']),
    '',
    '*Ultimas demandas abertas*',
    ...(recentRows.length
      ? recentRows.map((row) => `- ${safe(row.protocol || `#${row.id}`)} | ${safe(row.clinic_name || 'Unidade')} | ${safe(row.patient_name || 'Paciente')} | ${safe(row.status || 'aberta')}`)
      : ['- Nenhuma demanda aberta.']),
    '',
    `Acompanhe: ${frontendUrl}/gestao`
  ].join('\n');
}

function buildWeeklyAdminComplaintReportPeriod(now = new Date()) {
  const parts = getZonedDateParts(now, weeklyAdminComplaintReportTimeZone);
  const currentLocalDate = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0);
  const day = currentLocalDate.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0);

  // O relatório automático de segunda-feira consolida a semana já encerrada
  // (segunda a domingo), evitando enviar dados parciais da semana atual.
  start.setDate(start.getDate() + diffToMonday - 7);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function buildWeeklyAdminComplaintReportWhatsAppMessage(rows = [], { start, end, now = new Date() } = {}) {
  const safe = (value) => toWhatsAppAscii(value) || 'Nao informado';
  const periodStart = start || buildWeeklyAdminComplaintReportPeriod(now).start;
  const periodEnd = end || buildWeeklyAdminComplaintReportPeriod(now).end;
  const validRows = rows.filter((row) => !row.deleted_at);
  const activeRows = validRows.filter((row) => !isClosedComplaintStatus(row.status));
  const closedRows = validRows.filter((row) => isClosedComplaintStatus(row.status));
  const overdueRows = activeRows.filter((row) => {
    const deadlineAt = row.resolution_due_at || row.due_at || row.due_date || null;
    return deadlineAt && new Date(deadlineAt).getTime() < now.getTime();
  });
  const noTreatmentRows = activeRows.filter((row) => !row.treatment_at && !Number(row.has_treatment_log || 0));
  const groupActive = (labelForRow) => {
    const grouped = new Map();
    activeRows.forEach((row) => {
      const label = safe(labelForRow(row));
      const current = grouped.get(label) || { label, total: 0, overdue: 0 };
      current.total += 1;
      const deadlineAt = row.resolution_due_at || row.due_at || row.due_date || null;
      if (deadlineAt && new Date(deadlineAt).getTime() < now.getTime()) current.overdue += 1;
      grouped.set(label, current);
    });
    return Array.from(grouped.values())
      .sort((a, b) => b.total - a.total || b.overdue - a.overdue || a.label.localeCompare(b.label))
      .slice(0, 6);
  };
  const clinicRanking = groupActive((row) => row.clinic_name || row.clinic_snapshot_name || 'Sem unidade');
  const responsibleRanking = groupActive((row) => row.assigned_responsible_name || row.assigned_coordinator_name || row.forwarded_to_label || 'Sem responsavel');
  const recentRows = validRows
    .slice()
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 6);

  return [
    '[RELATORIO SEMANAL - RECLAMACOES]',
    '----------------------------------------',
    `Periodo: ${formatWeeklyReportDate(periodStart)} a ${formatWeeklyReportDate(periodEnd)}`,
    `Gerado em: ${safe(formatMessageDateTime(now))}`,
    '',
    '[RESUMO EXECUTIVO]',
    `- Reclamacoes cadastradas: ${validRows.length}`,
    `- Abertas/em andamento: ${activeRows.length}`,
    `- Finalizadas/canceladas: ${closedRows.length}`,
    `- Vencidas: ${overdueRows.length}`,
    `- Sem tratativa registrada: ${noTreatmentRows.length}`,
    '',
    '[UNIDADES COM MAIOR VOLUME ABERTO]',
    ...(clinicRanking.length
      ? clinicRanking.map((item, index) => `${index + 1}. ${item.label}: ${item.total} aberta(s), ${item.overdue} vencida(s)`)
      : ['- Nenhuma demanda aberta no periodo.']),
    '',
    '[RESPONSAVEIS ATUAIS]',
    ...(responsibleRanking.length
      ? responsibleRanking.map((item, index) => `${index + 1}. ${item.label}: ${item.total} aberta(s), ${item.overdue} vencida(s)`)
      : ['- Nenhum responsavel com demanda aberta no periodo.']),
    '',
    '[ULTIMAS DEMANDAS DA SEMANA]',
    ...(recentRows.length
      ? recentRows.map((row) => `- ${safe(row.protocol || `#${row.id}`)} | ${safe(row.clinic_name || 'Unidade')} | ${safe(row.patient_name || 'Paciente')} | ${safe(row.status || 'aberta')}`)
      : ['- Nenhuma reclamacao cadastrada no periodo.']),
    '',
    '[ACAO]',
    'Acompanhe a base completa no relatorio semanal do sistema.',
    `${frontendUrl}/gestao/relatorio-semanal`
  ].join('\n');
}

async function getComplaintReportRows({ startDate = null, endDate = null } = {}) {
  const where = ['c.deleted_at IS NULL'];
  const params = [];

  if (startDate) {
    where.push('c.created_at >= ?');
    params.push(toMysqlDateTime(startDate));
  }

  if (endDate) {
    where.push('c.created_at <= ?');
    params.push(toMysqlDateTime(endDate));
  }

  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.protocol,
       c.patient_name,
       c.status,
       c.due_at,
       c.due_date,
       c.resolution_due_at,
       c.treatment_at,
       c.assigned_responsible_name,
       c.assigned_coordinator_name,
       c.forwarded_to_label,
       c.clinic_snapshot_name,
       c.created_at,
       c.deleted_at,
       COALESCE(c.clinic_snapshot_name, cl.name, 'Sem unidade') AS clinic_name,
       EXISTS (
         SELECT 1
           FROM complaint_logs clg
          WHERE clg.complaint_id = c.id
            AND clg.action = 'treatment_saved'
          LIMIT 1
       ) AS has_treatment_log
      FROM complaints c
      LEFT JOIN clinics cl ON cl.id = c.clinic_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.created_at DESC, c.id DESC`,
    params
  );

  return rows;
}

async function sendComplaintReportToWhatsAppRecipients({ recipients, actor }) {
  if (!isWhatsAppServiceProviderConfigured()) {
    throw new Error('whatsapp-service não configurado. Configure WHATSAPP_API_URL e WHATSAPP_API_KEY.');
  }

  const normalizedRecipients = (Array.isArray(recipients) && recipients.length ? recipients : getDefaultComplaintReportRecipients())
    .map((phone) => normalizeWhatsAppPhone(phone))
    .filter((phone, index, list) => phone && list.indexOf(phone) === index);

  if (!normalizedRecipients.length) {
    throw new Error('Nenhum telefone válido foi informado para o relatório.');
  }

  const instanceName = String(process.env.WHATSAPP_COMPLAINT_REPORT_INSTANCE_NAME || 'reclamacoes').trim() || 'reclamacoes';
  const reportRows = await getComplaintReportRows();
  const message = buildComplaintReportWhatsAppMessage(reportRows);
  const results = [];

  for (let index = 0; index < normalizedRecipients.length; index += 1) {
    const phone = normalizedRecipients[index];
    const logId = await createWhatsAppLog({
      eventKey: 'complaint_report_whatsapp',
      recipientPhone: phone,
      messageBody: message,
      relatedUserId: actor?.id || null,
      relatedEntityType: 'complaint_report'
    });

    try {
      const response = await whatsappProvider.sendText({
        sessionId: instanceName,
        number: phone,
        message
      });
      await updateWhatsAppLog(logId, { success: true, provider: 'whatsapp_service', providerMessageId: response.messageId, response });
      try {
        await pool.query(
          `INSERT INTO whatsapp_service_message_history
           (session_id, patient_phone, message_text, status, provider_message_id, response_payload, created_by, sent_at)
           VALUES (?, ?, ?, 'enviado', ?, ?, ?, NOW())`,
          [
            instanceName,
            phone,
            message,
            response.messageId || null,
            JSON.stringify(response.raw || response),
            actor?.name || 'Relatório de reclamações'
          ]
        );
      } catch (historyError) {
        console.warn('Não foi possível gravar histórico do relatório WhatsApp:', historyError.message);
      }
      results.push({ phone, status: 'sent', providerMessageId: response.messageId || null });
    } catch (error) {
      const errorMessage = whatsappProvider.friendlyApiError(error);
      await updateWhatsAppLog(logId, { success: false, provider: 'whatsapp_service', error: errorMessage });
      results.push({ phone, status: 'failed', error: errorMessage });
    }

    if (index < normalizedRecipients.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, randomIntegerBetween(4500, 12000)));
    }
  }

  const sent = results.filter((item) => item.status === 'sent').length;
  return {
    message,
    recipients: normalizedRecipients.length,
    sent,
    failed: results.length - sent,
    status: sent === results.length ? 'sent' : sent ? 'partial_error' : 'failed',
    results
  };
}

async function handleSendComplaintSummaryWhatsAppReport(req, res) {
  try {
    if (!canSendComplaintWhatsAppReport(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode enviar relatório de reclamações por WhatsApp.' });
    }

    const recipients = Array.isArray(req.body?.recipients)
      ? req.body.recipients
      : String(req.body?.recipients || '')
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const result = await sendComplaintReportToWhatsAppRecipients({
      recipients,
      actor: req.user
    });

    return res.json({
      success: result.sent > 0,
      message: `${result.sent} relatório(s) enviado(s) por WhatsApp${result.failed ? `; ${result.failed} falharam.` : '.'}`,
      ...result,
      preview: result.message.slice(0, 2000)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Erro ao enviar relatório de reclamações por WhatsApp.' });
  }
}

async function getWeeklyAdminComplaintReportInstance() {
  if (!isWhatsAppEnabled() || !isWhatsAppServiceProviderConfigured()) return null;

  const preferredInstance = String(process.env.WHATSAPP_COMPLAINT_REPORT_INSTANCE_NAME || WHATSAPP_NOTIFICATION_INSTANCE_NAME).trim() || WHATSAPP_NOTIFICATION_INSTANCE_NAME;
  const [rows] = await pool.query(
    `SELECT *
       FROM whatsapp_instances
      WHERE instance_name = ?
        AND status = 'conectado'
      ORDER BY updated_at DESC
      LIMIT 1`,
    [preferredInstance]
  );

  if (rows[0]) return rows[0];

  return null;
}

async function getActiveAdministratorsForWeeklyComplaintReport() {
  const [users] = await pool.query(
    `SELECT id, name, email, phone, whatsapp, role, active
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND (
          role IN ('admin', 'master_admin')
          OR LOWER(email) IN (?, ?)
        )
      ORDER BY FIELD(role, 'master_admin', 'admin'), name ASC`,
    [masterAdminEmail, defaultAdminEmail]
  );

  return users;
}

function buildWeeklyAdminComplaintReportJobKey(now = new Date()) {
  const parts = getZonedDateParts(now, weeklyAdminComplaintReportTimeZone);
  return `weekly_admin_complaint_report:${getIsoWeekKeyFromLocalDate(parts)}`;
}

async function shouldRunWeeklyAdminComplaintReport(jobKey, now = new Date()) {
  if (!weeklyAdminComplaintReportEnabled) return false;

  const parts = getZonedDateParts(now, weeklyAdminComplaintReportTimeZone);
  if (parts.dayOfWeek !== weeklyAdminComplaintReportDay || parts.hour < weeklyAdminComplaintReportHour) {
    return false;
  }

  const [rows] = await pool.query('SELECT id FROM system_job_runs WHERE job_key = ? LIMIT 1', [jobKey]);
  return rows.length === 0;
}

async function dispatchWeeklyAdminComplaintReport({ actor = null, now = new Date() } = {}) {
  const instance = await getWeeklyAdminComplaintReportInstance();
  if (!instance) {
    return {
      administrators: 0,
      queued: 0,
      skipped: true,
      reason: 'no_connected_whatsapp_instance'
    };
  }

  const administrators = await getActiveAdministratorsForWeeklyComplaintReport();
  const period = buildWeeklyAdminComplaintReportPeriod(now);
  const rows = await getComplaintReportRows({ startDate: period.start, endDate: period.end });
  const messageText = buildWeeklyAdminComplaintReportWhatsAppMessage(rows, { ...period, now });
  const usedPhones = new Set();
  const results = [];
  let queueIndex = 0;

  for (const admin of administrators) {
    const phone = getUserWhatsappTarget(admin);
    const result = {
      userId: admin.id,
      name: admin.name,
      role: admin.role,
      phone: phone || null,
      status: 'skipped',
      queueId: null,
      error: null
    };

    if (!phone || usedPhones.has(phone)) {
      results.push(result);
      continue;
    }

    usedPhones.add(phone);

    try {
      const messageId = await insertWhatsAppMessage({
        conversation_id: null,
        instance_name: instance.instance_name,
        session_id: instance.instance_name,
        patient_phone: phone,
        phone,
        patient_name: admin.name,
        direction: 'outbound',
        message_text: messageText,
        message_type: 'weekly_admin_complaint_report',
        source: 'system_weekly_report',
        status: 'pendente',
        operator_id: actor?.id || null,
        operator_name: actor?.name || 'Sistema - relatorio semanal',
        clinic_name: 'Administradores'
      });
      const scheduledDelaySeconds = (queueIndex * weeklyAdminComplaintReportSpacingSeconds) + randomIntegerBetween(8, 25);
      const queued = await enqueueWhatsAppDispatch({
        message_id: messageId,
        conversation_id: null,
        instance_name: instance.instance_name,
        recipient_phone: phone,
        message_text: messageText,
        message_type: 'weekly_admin_complaint_report',
        operator_id: actor?.id || null,
        operator_name: actor?.name || 'Sistema - relatorio semanal',
        scheduleDelaySeconds: scheduledDelaySeconds,
        payload: {
          source: 'weekly_admin_complaint_report',
          adminId: admin.id,
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
          totalRows: rows.length,
          spacingSeconds: weeklyAdminComplaintReportSpacingSeconds
        }
      });

      queueIndex += 1;
      result.status = 'queued';
      result.queueId = queued?.id || null;
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
      console.warn('Nao foi possivel enfileirar relatorio semanal para administrador:', error.message);
    }

    results.push(result);
  }

  return {
    administrators: administrators.length,
    queued: results.filter((item) => item.status === 'queued').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    failed: results.filter((item) => item.status === 'failed').length,
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString()
    },
    results
  };
}

async function runScheduledWeeklyAdminComplaintReport(now = new Date()) {
  const jobKey = buildWeeklyAdminComplaintReportJobKey(now);

  if (!(await shouldRunWeeklyAdminComplaintReport(jobKey, now))) {
    return null;
  }

  const payload = await dispatchWeeklyAdminComplaintReport({ now });
  if (payload?.reason === 'no_connected_whatsapp_instance') {
    return payload;
  }

  await recordJobRun(jobKey, payload);
  return payload;
}

async function handleRunWeeklyAdminComplaintReport(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode disparar o relatório semanal aos administradores.' });
    }

    const payload = await dispatchWeeklyAdminComplaintReport({ actor: req.user });
    return res.json({
      success: true,
      message: payload?.reason === 'no_connected_whatsapp_instance'
        ? 'Nenhuma sessão WhatsApp conectada para enviar o relatório semanal.'
        : `${payload?.queued || 0} relatório(s) semanal(is) enfileirado(s) para administradores com espaçamento anti-ban.`,
      payload
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao disparar relatório semanal para administradores.' });
  }
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

  if (user && !isAdminUser(user) && !['supervisor_crc', 'sac_operator'].includes(normalizeAccessRole(user?.role))) {
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
  const creatorAudit = buildComplaintCreatorAudit(user, 'Externo');
  const [result] = await pool.query(
    `INSERT INTO complaints
     (clinic_id, patient_name, patient_phone, channel, complaint_type, description, service_type, status, priority, due_at, resolution_due_at, created_origin, created_by_user_id, created_by_name, created_by_role, created_by_email)
     VALUES (?, ?, ?, 'NPS', 'Reclamação NPS', ?, 'Pesquisa de satisfação', 'aberta', ?, ?, ?, 'Externo', ?, ?, ?, ?)`,
    [
      nps.clinic_id || null,
      nps.patient_name || 'Paciente NPS',
      nps.patient_phone || null,
      description,
      priority,
      toMysqlDateTime(dueAt),
      toMysqlDateTime(resolutionDueAt),
      creatorAudit.userId,
      creatorAudit.name,
      creatorAudit.role,
      creatorAudit.email
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

  if (nextStatus === 'tratado' && !hasActionPermission(user, 'nps_finish')) {
    const error = new Error('Seu usuário não possui liberação para finalizar NPS.');
    error.statusCode = 403;
    throw error;
  }

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
        'SELECT must_change_password, token_version, active, role, permissions, action_permissions FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
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
      req.user.role = rows[0]?.role || req.user.role;
      req.user.permissions = parsePermissionsFromUser({ role: req.user.role, permissions: rows[0]?.permissions });
      req.user.actionPermissions = getUserActionPermissions({ role: req.user.role, action_permissions: rows[0]?.action_permissions });
      try {
        req.user.clinicIds = await getUserClinicIds(req.user.id);
      } catch (clinicScopeError) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Não foi possível carregar clínicas vinculadas ao usuário autenticado.', clinicScopeError?.message || clinicScopeError);
        }
        req.user.clinicIds = Array.isArray(req.user.clinicIds) ? req.user.clinicIds : [];
      }
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
      'SELECT role, permissions, action_permissions, token_version, active FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    ).then(([rows]) => {
      if (!rows.length || !rows[0]?.active) {
        return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
      }

      const tokenVersion = Number(rows[0]?.token_version || 1);

      if (Number(req.user?.tokenVersion || 1) !== tokenVersion) {
        return res.status(401).json({ error: 'Sessão expirada por atualização de segurança. Faça login novamente.' });
      }

      req.user.role = rows[0]?.role || req.user.role;
      req.user.permissions = parsePermissionsFromUser({ role: req.user.role, permissions: rows[0]?.permissions });
      req.user.actionPermissions = getUserActionPermissions({ role: req.user.role, action_permissions: rows[0]?.action_permissions });
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

function requireFinancialView(req, res, next) {
  if (canViewFinancialIntelligence(req.user)) {
    return next();
  }

  return res.status(403).json({ error: 'Acesso restrito à Inteligência Financeira do CRC.' });
}

function requireWhatsAppView(req, res, next) {
  if (canViewWhatsAppManagement(req.user)) {
    return next();
  }

  return res.status(403).json({ error: 'Acesso restrito à Gestão WhatsApp CRC.' });
}

async function authenticateSocketUser(socket) {
  const rawHeader = socket.handshake.headers?.authorization || '';
  const token = socket.handshake.auth?.token
    || (String(rawHeader).startsWith('Bearer ') ? String(rawHeader).slice(7) : '');

  if (!token) {
    throw new Error('Token não informado');
  }

  const decoded = jwt.verify(token, SECRET);
  if (!decoded?.id) {
    throw new Error('Token inválido');
  }

  const [rows] = await pool.query(
    'SELECT must_change_password, token_version, active, role, permissions, action_permissions FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [decoded.id]
  );

  if (!rows.length || !rows[0]?.active) {
    throw new Error('Sessão inválida');
  }

  const tokenVersion = Number(rows[0]?.token_version || 1);
  if (Number(decoded?.tokenVersion || 1) !== tokenVersion) {
    throw new Error('Sessão expirada');
  }

  const user = {
    ...decoded,
    role: rows[0]?.role || decoded.role,
    permissions: parsePermissionsFromUser({ role: rows[0]?.role || decoded.role, permissions: rows[0]?.permissions }),
    actionPermissions: getUserActionPermissions({ role: rows[0]?.role || decoded.role, action_permissions: rows[0]?.action_permissions }),
    tokenVersion,
    mustChangePassword: Boolean(rows[0]?.must_change_password)
  };

  if (!canViewWhatsAppManagement(user)) {
    throw new Error('Acesso restrito à Gestão WhatsApp CRC');
  }

  return user;
}

function setupRealtimeSockets() {
  io.use(async (socket, next) => {
    try {
      socket.user = await authenticateSocketUser(socket);
      return next();
    } catch (error) {
      return next(new Error(error.message || 'Socket não autorizado'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    socket.join(`whatsapp:user:${user.id}`);
    socket.join(canViewAllWhatsAppAttendance(user) ? 'whatsapp:all' : `whatsapp:operator:${user.id}`);

    socket.emit('whatsapp:connected', {
      userId: user.id,
      canViewAll: canViewAllWhatsAppAttendance(user),
      connectedAt: new Date().toISOString()
    });

    socket.on('whatsapp:join-conversation', (conversationId) => {
      if (conversationId) socket.join(`whatsapp:conversation:${conversationId}`);
    });

    socket.on('whatsapp:leave-conversation', (conversationId) => {
      if (conversationId) socket.leave(`whatsapp:conversation:${conversationId}`);
    });
  });
}

function emitWhatsAppRealtime(event, payload = {}, options = {}) {
  if (!io) return;
  if (options.broadcast !== false) {
    io.to('whatsapp:all').emit(event, payload);
  }
  if (options.operatorId) {
    io.to(`whatsapp:operator:${options.operatorId}`).emit(event, payload);
    io.to(`whatsapp:user:${options.operatorId}`).emit(event, payload);
  }
  if (options.conversationId) {
    io.to(`whatsapp:conversation:${options.conversationId}`).emit(event, payload);
  }
}

function emitWhatsAppDashboardRefresh(reason, payload = {}) {
  emitWhatsAppRealtime('whatsapp:dashboard:refresh', {
    reason,
    at: new Date().toISOString(),
    ...payload
  });
}

function emitWhatsAppConversationChange(action, conversation, extra = {}) {
  if (!conversation?.id) return;
  const payload = {
    action,
    conversation,
    at: new Date().toISOString(),
    ...extra
  };
  emitWhatsAppRealtime('whatsapp:conversation:changed', payload, {
    operatorId: conversation.operator_id,
    conversationId: conversation.id
  });
  emitWhatsAppDashboardRefresh(action, { conversationId: conversation.id });
}

function emitWhatsAppMessageChange(action, message, conversation = {}) {
  const payload = {
    action,
    message,
    conversationId: message?.conversation_id || conversation?.id,
    at: new Date().toISOString()
  };
  emitWhatsAppRealtime('whatsapp:message:changed', payload, {
    operatorId: conversation?.operator_id || message?.operator_id,
    conversationId: message?.conversation_id || conversation?.id
  });
  emitWhatsAppDashboardRefresh(action, { conversationId: message?.conversation_id || conversation?.id });
}

setupRealtimeSockets();

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

function normalizeEvolutionInstanceName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeWhatsAppStatus(value, fallback = 'Novo') {
  return sanitizeFinancialString(value || fallback, 80) || fallback;
}

function getEvolutionMessageId(response = {}) {
  return response?.key?.id
    || response?.message?.key?.id
    || response?.id
    || response?.messageId
    || null;
}

function mapEvolutionConnectionStatus(response = {}) {
  const raw = response?.instance?.state
    || response?.state
    || response?.status
    || response?.connection
    || response?.instance?.status
    || '';
  const normalized = String(raw || '').toLowerCase();

  if (normalized.includes('open') || normalized.includes('connect')) return 'conectado';
  if (normalized.includes('close') || normalized.includes('disconnect')) return 'desconectado';
  if (normalized.includes('connecting')) return 'conectando';
  return raw ? String(raw).slice(0, 40) : 'desconhecido';
}

function renderWhatsAppTemplateText(text = '', variables = {}) {
  const source = typeof variables === 'string'
    ? (() => {
      try { return JSON.parse(variables); } catch (error) { return {}; }
    })()
    : variables;
  const normalizedSource = { ...(source || {}) };
  if (normalizedSource.nome_paciente) {
    normalizedSource.nome_paciente = normalizeWhatsAppPatientName(normalizedSource.nome_paciente);
  }

  return String(text || '').replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_, key) => {
    const value = normalizedSource?.[key] ?? normalizedSource?.[key.toLowerCase()] ?? '';
    return value === null || value === undefined ? '' : String(value);
  });
}

function normalizeWhatsAppVariables(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value && typeof value === 'object') return JSON.stringify(value);
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed);
  } catch (error) {
    return JSON.stringify(text.split(/[,\n;]+/).map((item) => item.trim()).filter(Boolean));
  }
}

async function getWhatsAppConversationById(id) {
  const conversationId = Number(id || 0);
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  const [rows] = await pool.query('SELECT * FROM whatsapp_conversations WHERE id = ? LIMIT 1', [conversationId]);
  return rows[0] || null;
}

async function findOrCreateWhatsAppConversation(payload = {}, user = {}) {
  const phone = normalizeWhatsAppPhone(payload.patient_phone || payload.phone || payload.to);
  if (!phone) {
    throw new Error('Informe o telefone do paciente com DDI e DDD. Exemplo: 5562999999999.');
  }

  if (payload.conversation_id) {
    const existingById = await getWhatsAppConversationById(payload.conversation_id);
    if (existingById) return existingById;
  }

  const requestedInstanceName = sanitizeFinancialString(payload.instance_name || payload.instanceName || payload.session_id || payload.sessionId);
  const existingWhere = ['patient_phone = ?', "status <> 'Encerrado'"];
  const existingParams = [phone];
  if (requestedInstanceName) {
    existingWhere.push('(instance_name = ? OR session_id = ? OR instance_name IS NULL OR instance_name = "")');
    existingParams.push(requestedInstanceName, requestedInstanceName);
  }
  const [existing] = await pool.query(
    `SELECT *
       FROM whatsapp_conversations
      WHERE ${existingWhere.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT 1`,
    existingParams
  );

  if (existing[0]) {
    await assertCrcOperatorClinicAccess(user, payload.clinic_id || existing[0].clinic_id);
    const update = {
      patient_name: sanitizeFinancialString(payload.patient_name || payload.name || existing[0].patient_name),
      clinic_id: payload.clinic_id || existing[0].clinic_id || null,
      clinic_name: sanitizeFinancialString(payload.clinic_name || existing[0].clinic_name),
      unit_name: sanitizeFinancialString(payload.unit_name || existing[0].unit_name),
      campaign: sanitizeFinancialString(payload.campaign || existing[0].campaign),
      protocol: sanitizeFinancialString(payload.protocol || existing[0].protocol, 60),
      source: sanitizeFinancialString(payload.source || existing[0].source),
      operator_id: payload.operator_id || existing[0].operator_id || user?.id || null,
      operator_name: sanitizeFinancialString(payload.operator_name || existing[0].operator_name || (user?.id ? getActorName(user) : null)),
      instance_name: sanitizeFinancialString(payload.instance_name || payload.instanceName || payload.session_id || payload.sessionId || existing[0].instance_name),
      status: normalizeWhatsAppStatus(payload.status || existing[0].status)
    };
    await pool.query(
      `UPDATE whatsapp_conversations
          SET patient_name = ?,
              clinic_id = ?,
              clinic_name = ?,
              unit_name = ?,
              campaign = ?,
              protocol = ?,
              source = ?,
              operator_id = ?,
              operator_name = ?,
              instance_name = ?,
              session_id = ?,
              phone = ?,
              assigned_operator_id = ?,
              status = ?
        WHERE id = ?`,
      [
        update.patient_name || existing[0].patient_name,
        update.clinic_id,
        update.clinic_name,
        update.unit_name,
        update.campaign,
        update.protocol,
        update.source,
        update.operator_id,
        update.operator_name,
        update.instance_name,
        update.instance_name,
        phone,
        update.operator_id,
        update.status,
        existing[0].id
      ]
    );
    return { ...existing[0], ...update };
  }

  const clinic = payload.clinic_id ? await getClinicSnapshot(payload.clinic_id) : null;
  await assertCrcOperatorClinicAccess(user, clinic?.id || payload.clinic_id);
  const patientName = sanitizeFinancialString(payload.patient_name || payload.name || 'Paciente sem nome');
  const actorName = user?.id ? getActorName(user) : null;

  const [result] = await pool.query(
    `INSERT INTO whatsapp_conversations
     (patient_name, patient_phone, phone, clinic_id, clinic_name, unit_name, campaign, protocol, source, operator_id, assigned_operator_id, operator_name, instance_name, session_id, status, notes, unread_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
    [
      patientName,
      phone,
      phone,
      clinic?.id || payload.clinic_id || null,
      clinic?.name || sanitizeFinancialString(payload.clinic_name),
      sanitizeFinancialString(payload.unit_name) || clinic?.city || null,
      sanitizeFinancialString(payload.campaign),
      sanitizeFinancialString(payload.protocol, 60),
      sanitizeFinancialString(payload.source || 'Manual'),
      payload.operator_id || user?.id || null,
      payload.operator_id || user?.id || null,
      sanitizeFinancialString(payload.operator_name || actorName),
      requestedInstanceName,
      requestedInstanceName,
      normalizeWhatsAppStatus(payload.status || 'Novo'),
      sanitizeFinancialString(payload.notes, 2000)
    ]
  );

  return getWhatsAppConversationById(result.insertId);
}

async function getDefaultWhatsAppInstance(user = null, options = {}) {
  const preferredInstanceName = String(options.preferredInstanceName || WHATSAPP_NOTIFICATION_INSTANCE_NAME).trim() || WHATSAPP_NOTIFICATION_INSTANCE_NAME;
  const preferredPhone = normalizeWhatsAppPhone(options.preferredPhone || WHATSAPP_NOTIFICATION_SENDER_PHONE) || WHATSAPP_NOTIFICATION_SENDER_PHONE;
  const fallbackInstanceName = String(options.fallbackInstanceName || WHATSAPP_NOTIFICATION_INSTANCE_NAME).trim() || WHATSAPP_NOTIFICATION_INSTANCE_NAME;
  const fallbackPhone = normalizeWhatsAppPhone(options.fallbackPhone || WHATSAPP_NOTIFICATION_SENDER_PHONE) || WHATSAPP_NOTIFICATION_SENDER_PHONE;
  const params = [preferredInstanceName, preferredPhone, fallbackInstanceName, fallbackPhone];
  let assignmentOrder = '1';
  if (user?.id) {
    assignmentOrder = 'CASE WHEN operator_id = ? THEN 0 ELSE 1 END';
    params.unshift(user.id);
  }
  const [rows] = await pool.query(
    `SELECT *
       FROM whatsapp_instances
      ORDER BY ${assignmentOrder},
               CASE
                 WHEN instance_name = ? OR phone_number = ? THEN 0
                 WHEN instance_name = ? OR phone_number = ? THEN 1
                 ELSE 2
               END,
               CASE WHEN status = 'conectado' THEN 0 ELSE 1 END,
               updated_at DESC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function getNpsWhatsAppInstance(user = null) {
  return getDefaultWhatsAppInstance(user, {
    preferredInstanceName: WHATSAPP_NPS_INSTANCE_NAME,
    preferredPhone: WHATSAPP_NPS_SENDER_PHONE,
    fallbackInstanceName: WHATSAPP_NOTIFICATION_INSTANCE_NAME,
    fallbackPhone: WHATSAPP_NOTIFICATION_SENDER_PHONE
  });
}

async function insertWhatsAppMessage(payload = {}) {
  const [result] = await pool.query(
    `INSERT INTO whatsapp_messages
     (conversation_id, instance_name, session_id, patient_phone, phone, patient_name, direction, message_text, message, message_type, source, status, evolution_message_id, whatsapp_message_id,
      operator_id, operator_name, clinic_id, clinic_name, campaign, media_url, media_mime_type, sent_at, delivered_at, read_at, responded_at, error_message, client_request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.conversation_id || null,
      payload.instance_name || null,
      payload.session_id || payload.sessionId || payload.instance_name || null,
      payload.patient_phone,
      payload.phone || payload.patient_phone,
      normalizeWhatsAppPatientName(payload.patient_name || ''),
      payload.direction || 'outbound',
      payload.message_text,
      payload.message || payload.message_text,
      payload.message_type || 'manual',
      payload.source || payload.message_type || 'manual',
      payload.status || 'pendente',
      payload.evolution_message_id || null,
      payload.whatsapp_message_id || payload.evolution_message_id || null,
      payload.operator_id || null,
      payload.operator_name || null,
      payload.clinic_id || null,
      payload.clinic_name || null,
      payload.campaign || null,
      payload.media_url || payload.mediaUrl || null,
      payload.media_mime_type || payload.mediaMimeType || null,
      payload.sent_at || null,
      payload.delivered_at || null,
      payload.read_at || null,
      payload.responded_at || null,
      payload.error_message || null,
      sanitizeFinancialString(payload.client_request_id || payload.clientRequestId, 120)
    ]
  );
  return result.insertId;
}

function formatPhoneForNpsLink(phone) {
  const normalized = normalizeWhatsAppPhone(phone);
  return normalized ? `+${normalized}` : '';
}

async function sendWhatsAppNpsInviteForConversation(conversation, actor = {}) {
  if (!conversation?.id || conversation.nps_invite_sent_at) return null;
  const patientPhone = normalizeWhatsAppPhone(conversation.patient_phone);
  if (!patientPhone || !conversation.clinic_id) return null;
  const defaultInstance = await getNpsWhatsAppInstance(actor);
  const instanceName = defaultInstance?.instance_name || conversation.instance_name || null;
  if (!instanceName) return null;

  const [existing] = await pool.query(
    'SELECT * FROM whatsapp_nps_invites WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
    [conversation.id]
  );
  if (existing[0]) return existing[0];

  const [inviteInsert] = await pool.query(
    `INSERT INTO whatsapp_nps_invites
     (conversation_id, patient_name, patient_phone, clinic_id, clinic_name, operator_id, operator_name, status, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', NOW())`,
    [
      conversation.id,
      conversation.patient_name || null,
      patientPhone,
      conversation.clinic_id || null,
      conversation.clinic_name || null,
      conversation.operator_id || actor?.id || null,
      conversation.operator_name || getActorName(actor)
    ]
  );

  const inviteId = inviteInsert.insertId;
  const params = new URLSearchParams({
    source: 'whatsapp_atendimento',
    invite_id: String(inviteId),
    conversation_id: String(conversation.id),
    clinic_id: String(conversation.clinic_id || ''),
    patient_name: conversation.patient_name || '',
    patient_phone: formatPhoneForNpsLink(patientPhone)
  });
  const inviteLink = `${frontendUrl}/pesquisa-nps?${params.toString()}`;
  const messageText = [
    `Olá, ${conversation.patient_name || 'paciente'}!`,
    'Seu atendimento no Grupo Sorria foi finalizado.',
    'Para melhorarmos continuamente, responda nossa pesquisa NPS:',
    inviteLink
  ].join('\n');

  const messageId = await insertWhatsAppMessage({
    conversation_id: conversation.id,
    instance_name: instanceName,
    patient_phone: patientPhone,
    direction: 'outbound',
    message_text: messageText,
    message_type: 'nps_automatico',
    status: 'pendente',
    operator_id: conversation.operator_id || actor?.id || null,
    operator_name: conversation.operator_name || getActorName(actor),
    clinic_id: conversation.clinic_id,
    clinic_name: conversation.clinic_name,
    campaign: conversation.campaign
  });

  const dispatch = await enqueueWhatsAppDispatch({
    message_id: messageId,
    conversation_id: conversation.id,
    instance_name: instanceName,
    recipient_phone: patientPhone,
    message_text: messageText,
    message_type: 'nps_automatico',
    operator_id: conversation.operator_id || actor?.id || null,
    operator_name: conversation.operator_name || getActorName(actor),
    payload: { source: 'nps_after_attendance', inviteId, antiBan: getWhatsAppAntiBanConfig() }
  });

  await pool.query(
    `UPDATE whatsapp_nps_invites
        SET invite_link = ?,
            message_id = ?,
            status = 'enfileirado'
      WHERE id = ?`,
    [inviteLink, messageId, inviteId]
  );
  await pool.query(
    `UPDATE whatsapp_conversations
        SET nps_invite_sent_at = NOW(),
            nps_invite_message_id = ?
      WHERE id = ?`,
    [messageId, conversation.id]
  );

  await logEvolutionEvent('nps_invite_queued', {
    conversationId: conversation.id,
    messageId,
    queueId: dispatch.id,
    status: 'info',
    response: { inviteId, inviteLink }
  });

  return { inviteId, messageId, inviteLink, dispatchId: dispatch.id };
}

function sanitizeWhatsAppSettings(raw = {}) {
  const antiBan = raw.antiBan || {};
  const baseUrl = String(raw.baseUrl || raw.baseURL || raw.base_url || '').trim().replace(/\/+$/, '');
  const apiKey = String(raw.apiKey || raw.api_key || '').trim();
  const minDelayMs = Math.max(1000, Number(antiBan.minDelayMs || process.env.WHATSAPP_MIN_SEND_DELAY_MS || 4500));
  const maxDelayMs = Math.max(minDelayMs, Number(antiBan.maxDelayMs || process.env.WHATSAPP_MAX_SEND_DELAY_MS || 14000));

  return {
    baseUrl,
    apiKey,
    antiBan: {
      minDelayMs,
      maxDelayMs,
      rateLimitPerMinute: Math.max(1, Number(antiBan.rateLimitPerMinute || process.env.WHATSAPP_RATE_LIMIT_PER_MINUTE || 8)),
      maxAttempts: Math.max(1, Number(antiBan.maxAttempts || process.env.WHATSAPP_DISPATCH_MAX_ATTEMPTS || 3)),
      defaultMaxSimultaneous: Math.max(1, Number(antiBan.defaultMaxSimultaneous || process.env.WHATSAPP_MAX_SIMULTANEOUS_ATTENDANCES || 5)),
      autoAssignEnabled: antiBan.autoAssignEnabled === undefined
        ? String(process.env.WHATSAPP_AUTO_ASSIGN_ENABLED || 'true').trim().toLowerCase() !== 'false'
        : Boolean(antiBan.autoAssignEnabled)
    },
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null
  };
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

async function loadWhatsAppSettingsCache(force = false) {
  if (whatsappSettingsCache && !force) return whatsappSettingsCache;

  try {
    const [rows] = await pool.query(
      'SELECT setting_value, updated_by, updated_at FROM system_settings WHERE setting_key = ? LIMIT 1',
      [WHATSAPP_EVOLUTION_SETTINGS_KEY]
    );
    const row = rows[0];
    const parsed = row?.setting_value ? JSON.parse(row.setting_value) : {};
    whatsappSettingsCache = sanitizeWhatsAppSettings({
      ...parsed,
      updatedAt: row?.updated_at || parsed.updatedAt || null,
      updatedBy: row?.updated_by || parsed.updatedBy || null
    });
    if (whatsappSettingsCache.baseUrl) process.env.WHATSAPP_API_URL = whatsappSettingsCache.baseUrl;
    if (whatsappSettingsCache.apiKey) process.env.WHATSAPP_API_KEY = whatsappSettingsCache.apiKey;
  } catch (error) {
    console.warn('[WhatsApp settings] Falha ao carregar configuração salva:', error.message);
    whatsappSettingsCache = sanitizeWhatsAppSettings({});
  }

  return whatsappSettingsCache;
}

async function getEvolutionServiceConfig(force = false) {
  const settings = await loadWhatsAppSettingsCache(force);
  return evolutionService.getConfig({
    baseURL: settings.baseUrl || process.env.EVOLUTION_BASE_URL,
    apiKey: settings.apiKey || process.env.EVOLUTION_API_KEY
  });
}

function getWhatsAppAntiBanConfig() {
  const antiBan = whatsappSettingsCache?.antiBan || {};
  const minDelayMs = Math.max(1000, Number(antiBan.minDelayMs || process.env.WHATSAPP_MIN_SEND_DELAY_MS || 4500));
  const maxDelayMs = Math.max(minDelayMs, Number(antiBan.maxDelayMs || process.env.WHATSAPP_MAX_SEND_DELAY_MS || 14000));
  return {
    minDelayMs,
    maxDelayMs,
    rateLimitPerMinute: Math.max(1, Number(antiBan.rateLimitPerMinute || process.env.WHATSAPP_RATE_LIMIT_PER_MINUTE || 8)),
    maxAttempts: Math.max(1, Number(antiBan.maxAttempts || process.env.WHATSAPP_DISPATCH_MAX_ATTEMPTS || 3)),
    defaultMaxSimultaneous: Math.max(1, Number(antiBan.defaultMaxSimultaneous || process.env.WHATSAPP_MAX_SIMULTANEOUS_ATTENDANCES || 5)),
    autoAssignEnabled: antiBan.autoAssignEnabled === undefined
      ? String(process.env.WHATSAPP_AUTO_ASSIGN_ENABLED || 'true').trim().toLowerCase() !== 'false'
      : Boolean(antiBan.autoAssignEnabled)
  };
}

function randomIntegerBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function serializeEvolutionPayload(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value).slice(0, 60000);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message }).slice(0, 60000);
  }
}

function parseSerializedPayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

async function logEvolutionEvent(eventType, payload = {}) {
  const status = payload.status || (payload.error ? 'error' : 'info');
  const errorMessage = payload.error?.response?.data?.message
    || payload.error?.response?.data?.error
    || payload.error?.message
    || payload.error_message
    || null;
  try {
    await pool.query(
      `INSERT INTO whatsapp_evolution_logs
       (event_type, instance_name, conversation_id, message_id, queue_id, status, duration_ms, request_payload, response_payload, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventType,
        payload.instanceName || payload.instance_name || null,
        payload.conversationId || payload.conversation_id || null,
        payload.messageId || payload.message_id || null,
        payload.queueId || payload.queue_id || null,
        status,
        payload.durationMs === undefined ? null : Math.round(Number(payload.durationMs || 0)),
        serializeEvolutionPayload(payload.request || null),
        serializeEvolutionPayload(payload.response || null),
        errorMessage
      ]
    );
  } catch (logError) {
    console.warn('[Evolution log] Falha ao gravar log:', logError.message);
  }

  const line = `[Evolution:${eventType}] ${status}${payload.instanceName ? ` instance=${payload.instanceName}` : ''}${errorMessage ? ` error=${errorMessage}` : ''}`;
  if (status === 'error' || status === 'timeout') console.warn(line);
  else console.info(line);
}

async function getWhatsAppMessageById(messageId) {
  const [rows] = await pool.query('SELECT * FROM whatsapp_messages WHERE id = ? LIMIT 1', [messageId]);
  return rows[0] || null;
}

async function syncWhatsAppAttendanceQueue(conversation, status = null) {
  if (!conversation?.id) return null;
  const queueStatus = status || (conversation.operator_id ? 'em_atendimento' : 'aguardando');
  await pool.query(
    `INSERT INTO whatsapp_attendance_queue
     (conversation_id, patient_name, patient_phone, clinic_id, clinic_name, instance_name, operator_id, operator_name, status, priority, source, assigned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NOT NULL THEN NOW() ELSE NULL END)
     ON DUPLICATE KEY UPDATE
       patient_name = VALUES(patient_name),
       patient_phone = VALUES(patient_phone),
       clinic_id = VALUES(clinic_id),
       clinic_name = VALUES(clinic_name),
       instance_name = VALUES(instance_name),
       operator_id = VALUES(operator_id),
       operator_name = VALUES(operator_name),
       status = VALUES(status),
       priority = VALUES(priority),
       source = VALUES(source),
       assigned_at = CASE WHEN VALUES(operator_id) IS NOT NULL AND assigned_at IS NULL THEN NOW() ELSE assigned_at END,
       closed_at = CASE WHEN VALUES(status) = 'encerrado' THEN NOW() ELSE closed_at END`,
    [
      conversation.id,
      conversation.patient_name || 'Paciente sem nome',
      conversation.patient_phone,
      conversation.clinic_id || null,
      conversation.clinic_name || null,
      conversation.instance_name || null,
      conversation.operator_id || null,
      conversation.operator_name || null,
      queueStatus,
      Number(conversation.priority || 0),
      conversation.source || 'WhatsApp',
      conversation.operator_id || null
    ]
  );
  const [rows] = await pool.query('SELECT * FROM whatsapp_attendance_queue WHERE conversation_id = ? LIMIT 1', [conversation.id]);
  emitWhatsAppRealtime('whatsapp:queue:changed', { action: 'sync', item: rows[0] || null, at: new Date().toISOString() }, {
    operatorId: conversation.operator_id,
    conversationId: conversation.id
  });
  return rows[0] || null;
}

function buildQueueScopeWhere(user, alias = 'q') {
  if (canViewAllWhatsAppAttendance(user)) {
    return { clause: '1=1', params: [] };
  }

  if (isCrcOperatorUser(user)) {
    const clinicIds = clinicIdsFromUser(user);
    if (!clinicIds.length) return { clause: '0=1', params: [] };
    return {
      clause: `(${alias}.operator_id = ? OR ${alias}.status = "aguardando") AND ${alias}.clinic_id IN (${clinicIds.map(() => '?').join(',')})`,
      params: [user?.id || 0, ...clinicIds]
    };
  }

  return {
    clause: `(${alias}.operator_id = ? OR ${alias}.status = "aguardando")`,
    params: [user?.id || 0]
  };
}

function buildWhatsAppInstanceScopeWhere(user, alias = 'wi') {
  if (canViewAllWhatsAppAttendance(user) || canConfigureWhatsAppManagement(user)) {
    return { clause: '1=1', params: [] };
  }

  const clinicIds = clinicIdsFromUser(user);
  if (!clinicIds.length) {
    return { clause: '0=1', params: [] };
  }

  return {
    clause: `${alias}.clinic_id IN (${clinicIds.map(() => '?').join(',')})`,
    params: clinicIds
  };
}

async function getWhatsAppOperatorMaxSimultaneous(userId) {
  const config = getWhatsAppAntiBanConfig();
  const [rows] = await pool.query('SELECT max_simultaneous FROM whatsapp_operator_limits WHERE user_id = ? AND active = 1 LIMIT 1', [userId]);
  return Number(rows[0]?.max_simultaneous || config.defaultMaxSimultaneous);
}

async function getActiveWhatsAppAttendanceCount(userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM whatsapp_conversations
      WHERE operator_id = ?
        AND status NOT IN ('Encerrado', 'Compareceu', 'Não compareceu', 'Ausente', 'Cancelado')`,
    [userId]
  );
  return parseSqlCount(rows[0], 'total');
}

async function getWhatsAppOperatorCapacity(userId) {
  const maxSimultaneous = await getWhatsAppOperatorMaxSimultaneous(userId);
  const activeCount = await getActiveWhatsAppAttendanceCount(userId);
  return {
    maxSimultaneous,
    activeCount,
    available: Math.max(0, maxSimultaneous - activeCount),
    canAccept: activeCount < maxSimultaneous
  };
}

async function getWhatsAppOperatorById(userId) {
  const [rows] = await pool.query(
      `SELECT id, name, email, role, active
       FROM users
      WHERE id = ?
        AND active = 1
        AND ${buildWhatsAppOperatorRoleWhere()}
        AND deleted_at IS NULL
      LIMIT 1`,
    [userId, ...getWhatsAppOperatorRoleParams()]
  );
  return rows[0] || null;
}

async function ensureWhatsAppOperatorClinicLink(operatorId, clinicId, actor = null) {
  const normalizedOperatorId = Number(operatorId || 0);
  const normalizedClinicId = Number(clinicId || 0);
  if (!normalizedOperatorId || !normalizedClinicId) return { linked: false, reason: 'missing_data' };

  const operatorClinicIds = await getUserClinicIds(normalizedOperatorId);
  if (operatorClinicIds.includes(normalizedClinicId)) return { linked: false, reason: 'already_linked' };

  await pool.query(
    'INSERT IGNORE INTO user_clinics (user_id, clinic_id, can_edit) VALUES (?, ?, 1)',
    [normalizedOperatorId, normalizedClinicId]
  );
  await logEvolutionEvent('operator_clinic_auto_link', {
    status: 'info',
    response: {
      operatorId: normalizedOperatorId,
      clinicId: normalizedClinicId,
      actor: getActorName(actor) || 'Sistema'
    }
  });
  return { linked: true, reason: 'auto_linked' };
}

async function assignWhatsAppConversation(conversationId, operatorUser, actor, source = 'manual') {
  const conversation = await getWhatsAppConversationById(conversationId);
  if (!conversation) {
    const error = new Error('Atendimento não encontrado.');
    error.status = 404;
    throw error;
  }

  const operatorClinicIds = await getUserClinicIds(operatorUser.id);
  const conversationClinicId = Number(conversation.clinic_id || 0);
  if (!operatorClinicIds.length || !operatorClinicIds.includes(conversationClinicId)) {
    const error = new Error(`${operatorUser.name} não possui acesso à clínica deste atendimento.`);
    error.status = 403;
    error.details = { operatorClinicIds, conversationClinicId };
    throw error;
  }

  const capacity = await getWhatsAppOperatorCapacity(operatorUser.id);
  if (!capacity.canAccept && Number(conversation.operator_id) !== Number(operatorUser.id)) {
    const error = new Error(`Limite de atendimentos simultâneos atingido para ${operatorUser.name}.`);
    error.status = 409;
    error.details = capacity;
    throw error;
  }

  await pool.query(
    `UPDATE whatsapp_conversations
        SET operator_id = ?,
            assigned_operator_id = ?,
            operator_name = ?,
            status = CASE WHEN status = 'Novo' THEN 'Em atendimento' ELSE status END,
            assigned_at = NOW(),
            assignment_source = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [operatorUser.id, operatorUser.id, operatorUser.name, source, conversationId]
  );

  const updated = await getWhatsAppConversationById(conversationId);
  await syncWhatsAppAttendanceQueue(updated, 'em_atendimento');
  await logEvolutionEvent(source === 'transferencia' ? 'transfer_attendance' : 'claim_attendance', {
    status: 'info',
    conversationId,
    response: {
      operatorId: operatorUser.id,
      operatorName: operatorUser.name,
      actor: getActorName(actor),
      source
    }
  });
  emitWhatsAppConversationChange(source === 'transferencia' ? 'transfer' : 'claim', updated);
  return updated;
}

async function autoAssignWhatsAppQueue(actor = null) {
  if (!getWhatsAppAntiBanConfig().autoAssignEnabled) return [];

  const [waiting] = await pool.query(
    `SELECT *
       FROM whatsapp_attendance_queue
      WHERE status = 'aguardando'
      ORDER BY priority DESC, queued_at ASC
      LIMIT 50`
  );
  if (!waiting.length) return [];

  const [operators] = await pool.query(
    `SELECT u.id, u.name, u.email, u.role
      FROM users u
       LEFT JOIN whatsapp_operator_status s ON s.user_id = u.id
      WHERE u.active = 1
        AND u.deleted_at IS NULL
        AND ${buildWhatsAppOperatorRoleWhere('u')}
        AND COALESCE(s.status, 'online') = 'online'
      ORDER BY u.name ASC`,
    getWhatsAppOperatorRoleParams()
  );
  const assigned = [];

  for (const item of waiting) {
    let chosen = null;
    let chosenCapacity = null;
    for (const operator of operators) {
      const operatorClinicIds = await getUserClinicIds(operator.id);
      const itemClinicId = Number(item.clinic_id || 0);
      if (!operatorClinicIds.length || !operatorClinicIds.includes(itemClinicId)) continue;
      const capacity = await getWhatsAppOperatorCapacity(operator.id);
      if (!capacity.canAccept) continue;
      if (!chosen || capacity.activeCount < chosenCapacity.activeCount) {
        chosen = operator;
        chosenCapacity = capacity;
      }
    }

    if (!chosen) break;
    const updated = await assignWhatsAppConversation(item.conversation_id, chosen, actor || { name: 'Fila automática', role: 'system' }, 'fila_automatica');
    assigned.push({ conversationId: item.conversation_id, operatorId: chosen.id, operatorName: chosen.name, conversation: updated });
  }

  if (assigned.length) {
    emitWhatsAppDashboardRefresh('auto_assign', { totalAssigned: assigned.length });
  }
  return assigned;
}

async function enqueueWhatsAppDispatch(payload = {}) {
  const config = getWhatsAppAntiBanConfig();
  const antiBanDelayMs = randomIntegerBetween(config.minDelayMs, config.maxDelayMs);
  const requestedDelaySeconds = Number(
    payload.scheduleDelaySeconds
      || payload.scheduledDelaySeconds
      || payload.delaySeconds
      || 0
  );
  const scheduledDelaySeconds = Math.max(1, Number.isFinite(requestedDelaySeconds) && requestedDelaySeconds > 0
    ? Math.ceil(requestedDelaySeconds)
    : Math.ceil(antiBanDelayMs / 1000));
  const [result] = await pool.query(
    `INSERT INTO whatsapp_dispatch_queue
     (message_id, conversation_id, instance_name, recipient_phone, message_text, message_type, status, scheduled_at,
      operator_id, operator_name, anti_ban_delay_ms, humanization_profile, payload)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente', DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?, ?, ?, ?)`,
    [
      payload.message_id || payload.messageId || null,
      payload.conversation_id || payload.conversationId || null,
      payload.instance_name || payload.instanceName,
      payload.recipient_phone || payload.recipientPhone,
      payload.message_text || payload.messageText,
      payload.message_type || payload.messageType || 'manual',
      scheduledDelaySeconds,
      payload.operator_id || payload.operatorId || null,
      payload.operator_name || payload.operatorName || null,
      antiBanDelayMs,
      payload.humanization_profile || 'humano_padrao',
      serializeEvolutionPayload(payload.payload || {})
    ]
  );

  const [rows] = await pool.query('SELECT * FROM whatsapp_dispatch_queue WHERE id = ? LIMIT 1', [result.insertId]);
  emitWhatsAppRealtime('whatsapp:dispatch:queued', { item: rows[0], at: new Date().toISOString() }, {
    operatorId: payload.operator_id || payload.operatorId,
    conversationId: payload.conversation_id || payload.conversationId
  });
  emitWhatsAppDashboardRefresh('dispatch_queued', { queueId: result.insertId });
  return rows[0];
}

const PARTNER_VIDEO_SETTINGS_KEY = 'partner_video_settings';
const PARTNER_VIDEO_LAST_RUN_KEY = 'partner_video_daily_last_run';
const DEFAULT_PARTNER_VIDEO_TEST_NUMBERS = ['5562999669966', '5562998852865', '5564981598113'];
const PARTNER_VIDEO_COMPLIANCE_GOAL = 40;
const DEFAULT_PARTNER_VIDEO_TEMPLATE = `*CONFIRMACAO E AGENDAMENTO - GRUPO SORRIA*

Bom dia, Dr(a). {{partner_name}}.

Solicitamos o envio dos videos personalizados dos pacientes com avaliacoes/reavaliacoes do dia seguinte.

Unidade: {{clinic_name}}
Prazo de envio: ate 09:30.

O video deve ser unico e personalizado para cada paciente, seguindo o roteiro padrao:

"Ola, {{nome_paciente}}, tudo bem?
Aqui e o Dr(a). {{nome_dentista}}.

Estou passando para avisar que nosso compromisso esta confirmado para amanha as {{horario}}.

Estou deixando tudo organizado para seu atendimento.
Te espero amanha."

Apos gravar, favor enviar o video para a CRC realizar o encaminhamento ao paciente.

Mensagem automatica do sistema.`;

function getDefaultPartnerVideoSettings() {
  return {
    automationEnabled: false,
    standardTime: '08:00',
    allowedTimes: ['08:00', '18:00'],
    allowedWeekdays: [1, 2, 3, 4, 5, 6],
    sessionId: WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME,
    senderPhone: WHATSAPP_CONFIRMATION_APPOINTMENT_SENDER_PHONE,
    minDelaySeconds: 20,
    maxDelaySeconds: 60,
    limitPerMinute: 2,
    limitPerHour: 60,
    testMode: false,
    testNumbers: DEFAULT_PARTNER_VIDEO_TEST_NUMBERS,
    template: DEFAULT_PARTNER_VIDEO_TEMPLATE
  };
}

function normalizePartnerVideoTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizePartnerVideoAllowedTimes(value, fallback = ['08:00', '18:00']) {
  const rawTimes = Array.isArray(value)
    ? value
    : String(value || '').split(/\n|,|;/);
  const times = Array.from(new Set(rawTimes.map(normalizePartnerVideoTime).filter(Boolean)))
    .sort((left, right) => {
      const [leftHour, leftMinute] = left.split(':').map(Number);
      const [rightHour, rightMinute] = right.split(':').map(Number);
      return (leftHour * 60 + leftMinute) - (rightHour * 60 + rightMinute);
    });
  return times.length ? times : fallback;
}

function normalizePartnerVideoMessageText(value = '') {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function sanitizePartnerVideoSettings(raw = {}) {
  const defaults = getDefaultPartnerVideoSettings();
  const allowedWeekdays = Array.isArray(raw.allowedWeekdays)
    ? raw.allowedWeekdays.map((item) => Number(item)).filter((item) => item >= 0 && item <= 6)
    : defaults.allowedWeekdays;
  const minDelaySeconds = Math.max(20, Number(raw.minDelaySeconds || defaults.minDelaySeconds));
  const maxDelaySeconds = Math.max(minDelaySeconds, Number(raw.maxDelaySeconds || defaults.maxDelaySeconds));

  return {
    ...defaults,
    ...raw,
    automationEnabled: raw.automationEnabled === undefined ? defaults.automationEnabled : Boolean(raw.automationEnabled),
    allowedWeekdays,
    allowedTimes: normalizePartnerVideoAllowedTimes(raw.allowedTimes || raw.allowed_times || defaults.allowedTimes, defaults.allowedTimes),
    standardTime: normalizePartnerVideoTime(raw.standardTime || defaults.standardTime) || defaults.standardTime,
    sessionId: String(raw.sessionId || defaults.sessionId).trim() || defaults.sessionId,
    senderPhone: normalizeWhatsAppPhone(raw.senderPhone || defaults.senderPhone),
    minDelaySeconds,
    maxDelaySeconds,
    limitPerMinute: Math.max(1, Number(raw.limitPerMinute || defaults.limitPerMinute)),
    limitPerHour: Math.max(1, Number(raw.limitPerHour || defaults.limitPerHour)),
    testMode: Boolean(raw.testMode),
    testNumbers: Array.isArray(raw.testNumbers)
      ? raw.testNumbers.map(normalizeWhatsAppPhone).filter(Boolean)
      : defaults.testNumbers,
    template: normalizePartnerVideoMessageText(raw.template || defaults.template)
  };
}

async function getPartnerVideoSettings() {
  const [rows] = await pool.query(
    'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
    [PARTNER_VIDEO_SETTINGS_KEY]
  );
  if (!rows.length || !rows[0].setting_value) return getDefaultPartnerVideoSettings();
  try {
    return sanitizePartnerVideoSettings(JSON.parse(rows[0].setting_value));
  } catch (error) {
    return getDefaultPartnerVideoSettings();
  }
}

function getSaoPauloParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    weekday: weekdayMap[parts.weekday] ?? date.getDay()
  };
}

function getSaoPauloDateKey(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) return getSaoPauloParts(date).dateKey;
  return String(value || '').slice(0, 10);
}

function getPartnerVideoMinuteOfDay(parts = getSaoPauloParts()) {
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

function partnerVideoTimeToMinute(time) {
  const normalized = normalizePartnerVideoTime(time);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return (hour * 60) + minute;
}

function getPartnerVideoEligibleScheduleSlot(settings = {}, parts = getSaoPauloParts()) {
  const allowedTimes = normalizePartnerVideoAllowedTimes(settings.allowedTimes || settings.standardTime);
  const currentMinute = getPartnerVideoMinuteOfDay(parts);
  const windowMinutes = Math.max(1, Number(process.env.PARTNER_VIDEO_SEND_WINDOW_MINUTES || 30));
  return allowedTimes
    .map((time) => ({ time, minute: partnerVideoTimeToMinute(time) }))
    .filter((slot) => slot.minute !== null)
    .find((slot) => currentMinute >= slot.minute && currentMinute <= slot.minute + windowMinutes) || null;
}

function fillPartnerVideoTemplate(template, contact = {}) {
  const message = String(template || DEFAULT_PARTNER_VIDEO_TEMPLATE)
    .replace(/\{\{partner_name\}\}/g, contact.partner_name || contact.partnerName || 'Parceiro(a)')
    .replace(/\{\{clinic_name\}\}/g, contact.clinic_name || contact.clinicName || 'Unidade')
    .replace(/\{\{nome_paciente\}\}/g, '{{nome_paciente}}')
    .replace(/\{\{nome_dentista\}\}/g, contact.partner_name || contact.partnerName || 'dentista')
    .replace(/\{\{horario\}\}/g, '{{horario}}');
  return normalizePartnerVideoMessageText(message);
}

async function logPartnerVideoEvent(event = {}) {
  await pool.query(
    `INSERT INTO partner_video_logs
     (contact_id, control_id, event_type, channel, recipient_phone, message_text, status, response_payload, error_message, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.contactId || null,
      event.controlId || null,
      event.eventType || 'info',
      event.channel || 'whatsapp',
      event.recipientPhone || null,
      event.messageText || null,
      event.status || 'info',
      event.responsePayload ? JSON.stringify(event.responsePayload) : null,
      event.errorMessage || null,
      event.createdBy || 'Sistema'
    ]
  );
}

async function ensurePartnerVideoDailyControl(contact, dateKey) {
  await pool.query(
    `INSERT INTO partner_video_daily_controls
     (date, clinic_name, partner_id, partner_name, phone_number, message_status, video_due_time, status)
     VALUES (?, ?, ?, ?, ?, 'pendente', '09:30:00', 'aguardando envio')
     ON DUPLICATE KEY UPDATE
       clinic_name = VALUES(clinic_name),
       partner_name = VALUES(partner_name),
       phone_number = VALUES(phone_number),
       updated_at = CURRENT_TIMESTAMP`,
    [dateKey, contact.clinic_name, contact.id, contact.partner_name, contact.phone_number]
  );
  const [rows] = await pool.query(
    'SELECT * FROM partner_video_daily_controls WHERE date = ? AND partner_id = ? LIMIT 1',
    [dateKey, contact.id]
  );
  return rows[0];
}

async function enqueuePartnerVideoMessage({ contact, control, number, message, delaySeconds = 20, actor = null, type = 'partner_video_reminder' }) {
  const normalizedPhone = normalizeWhatsAppPhone(number || contact?.phone_number);
  if (!normalizedPhone) {
    await logPartnerVideoEvent({
      contactId: contact?.id,
      controlId: control?.id,
      eventType: `${type}_skipped`,
      status: 'erro',
      errorMessage: 'Parceiro sem telefone válido.',
      createdBy: actor ? getActorName(actor) : 'Sistema'
    });
    return null;
  }

  const messageId = await insertWhatsAppMessage({
    instance_name: WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME,
    patient_phone: normalizedPhone,
    patient_name: contact?.partner_name || 'Parceiro',
    direction: 'outbound',
    message_text: message,
    message_type: type,
    source: 'confirmacao_agendamento',
    status: 'pendente',
    operator_id: actor?.id || null,
    operator_name: actor ? getActorName(actor) : 'Rotina Confirmação e Agendamento',
    clinic_name: contact?.clinic_name || null
  });
  const dispatch = await enqueueWhatsAppDispatch({
    message_id: messageId,
    instance_name: WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME,
    recipient_phone: normalizedPhone,
    message_text: message,
    message_type: type,
    operator_id: actor?.id || null,
    operator_name: actor ? getActorName(actor) : 'Rotina Confirmação e Agendamento',
    scheduleDelaySeconds: delaySeconds,
    payload: {
      source: type,
      contactId: contact?.id || null,
      controlId: control?.id || null,
      antiBan: { delaySeconds }
    }
  });

  if (control?.id) {
    await pool.query(
      `UPDATE partner_video_daily_controls
          SET message_status = 'enfileirado',
              message_sent_at = COALESCE(message_sent_at, NOW()),
              status = CASE WHEN status = 'aguardando envio' THEN 'aguardando envio' ELSE status END
        WHERE id = ?`,
      [control.id]
    );
  }
  await logPartnerVideoEvent({
    contactId: contact?.id,
    controlId: control?.id,
    eventType: type,
    recipientPhone: normalizedPhone,
    messageText: message,
    status: 'enfileirado',
    responsePayload: { queueId: dispatch?.id, messageId, delaySeconds },
    createdBy: actor ? getActorName(actor) : 'Sistema'
  });
  return { messageId, dispatch };
}

async function dispatchPartnerVideoDailyReminders({ actor = null, force = false, testNumbers = null } = {}) {
  const settings = await getPartnerVideoSettings();
  const nowParts = getSaoPauloParts();
  const dateKey = nowParts.dateKey;
  const isTest = Array.isArray(testNumbers) && testNumbers.length > 0;
  if (!force && !isTest && !settings.automationEnabled) {
    return { queued: 0, skipped: 0, message: 'Rotina de vídeos desativada.' };
  }

  const [contacts] = await pool.query(
    `SELECT *
       FROM partner_video_contacts
      WHERE active = 1
        AND receives_automatic_message = 1
      ORDER BY clinic_name ASC, partner_name ASC`
  );

  let delayCursor = 0;
  const queued = [];
  const skipped = [];
  const template = normalizePartnerVideoMessageText(settings.template || DEFAULT_PARTNER_VIDEO_TEMPLATE);

  if (isTest) {
    for (const phone of testNumbers.map(normalizeWhatsAppPhone).filter(Boolean)) {
      const testContact = {
        id: null,
        partner_name: 'Teste operacional',
        clinic_name: WHATSAPP_CONFIRMATION_APPOINTMENT_DISPLAY_NAME,
        phone_number: phone
      };
      delayCursor += randomIntegerBetween(settings.minDelaySeconds, settings.maxDelaySeconds);
      const result = await enqueuePartnerVideoMessage({
        contact: testContact,
        control: null,
        number: phone,
        message: fillPartnerVideoTemplate(template, testContact),
        delaySeconds: delayCursor,
        actor,
        type: 'partner_video_test'
      });
      if (result) queued.push({ phone, queueId: result.dispatch?.id });
    }
    return { queued: queued.length, skipped: 0, items: queued, message: 'Mensagens de teste enfileiradas com anti-ban.' };
  }

  for (const contact of contacts) {
    const phone = normalizeWhatsAppPhone(contact.phone_number);
    if (!phone) {
      skipped.push({ contactId: contact.id, reason: 'sem telefone' });
      await logPartnerVideoEvent({
        contactId: contact.id,
        eventType: 'partner_video_reminder_skipped',
        status: 'erro',
        errorMessage: 'Contato sem telefone válido.',
        createdBy: actor ? getActorName(actor) : 'Sistema'
      });
      continue;
    }
    const control = await ensurePartnerVideoDailyControl(contact, dateKey);
    const message = fillPartnerVideoTemplate(template, contact);
    delayCursor += randomIntegerBetween(settings.minDelaySeconds, settings.maxDelaySeconds);
    const result = await enqueuePartnerVideoMessage({
      contact,
      control,
      number: phone,
      message,
      delaySeconds: delayCursor,
      actor,
      type: 'partner_video_reminder'
    });
    if (result) queued.push({ contactId: contact.id, controlId: control?.id, queueId: result.dispatch?.id, phone });
  }

  return { queued: queued.length, skipped: skipped.length, items: queued, skippedItems: skipped };
}

async function runScheduledPartnerVideoDailyReminders() {
  const settings = await getPartnerVideoSettings();
  if (!settings.automationEnabled) return { skipped: true, reason: 'disabled' };
  const parts = getSaoPauloParts();
  if (!settings.allowedWeekdays.includes(parts.weekday)) return { skipped: true, reason: 'weekday' };
  const slot = getPartnerVideoEligibleScheduleSlot(settings, parts);
  if (!slot) return { skipped: true, reason: 'outside_allowed_times', allowedTimes: settings.allowedTimes || ['08:00', '18:00'] };
  const runKey = `${parts.dateKey}|${slot.time}`;

  const [rows] = await pool.query(
    'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
    [PARTNER_VIDEO_LAST_RUN_KEY]
  );
  if (rows[0]?.setting_value === runKey) return { skipped: true, reason: 'already_ran', slot: slot.time };

  const result = await dispatchPartnerVideoDailyReminders({ force: true });
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, 'Sistema')
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
    [PARTNER_VIDEO_LAST_RUN_KEY, runKey]
  );
  return { ...result, slot: slot.time };
}

async function runPartnerVideoOperationalEscalationSweep() {
  const parts = getSaoPauloParts();
  const dateKey = parts.dateKey;
  const minuteOfDay = getPartnerVideoMinuteOfDay(parts);
  if (minuteOfDay < 570) return { skipped: true, reason: 'before_0930' };

  const [controls] = await pool.query(
    `SELECT *
       FROM partner_video_daily_controls
      WHERE date = ?
        AND COALESCE(video_received, 0) = 0
        AND status NOT IN ('finalizado', 'enviado no prazo', 'enviado com atraso')`,
    [dateKey]
  );

  let updated = 0;
  for (const control of controls) {
    const transitions = [];
    if (minuteOfDay >= 570 && !['não enviado', 'acionado líder', 'acionado coordenador', 'acionado gerente'].includes(control.status)) {
      transitions.push({
        sql: `UPDATE partner_video_daily_controls SET status = 'não enviado', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params: [control.id],
        eventType: 'auto_not_sent',
        status: 'warning'
      });
    }
    if (minuteOfDay >= 600 && !control.leader_notified_at) {
      transitions.push({
        sql: `UPDATE partner_video_daily_controls SET leader_notified_at = NOW(), status = 'acionado líder', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params: [control.id],
        eventType: 'leader_auto_notified',
        status: 'warning'
      });
    }
    if (minuteOfDay >= 660 && !control.coordinator_notified_at) {
      transitions.push({
        sql: `UPDATE partner_video_daily_controls SET coordinator_notified_at = NOW(), status = 'acionado coordenador', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params: [control.id],
        eventType: 'coordinator_auto_notified',
        status: 'warning'
      });
    }
    if (minuteOfDay >= 720 && !control.manager_notified_at) {
      transitions.push({
        sql: `UPDATE partner_video_daily_controls SET manager_notified_at = NOW(), status = 'acionado gerente', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params: [control.id],
        eventType: 'manager_auto_notified',
        status: 'warning'
      });
    }

    for (const transition of transitions) {
      await pool.query(transition.sql, transition.params);
      await logPartnerVideoEvent({
        contactId: control.partner_id,
        controlId: control.id,
        eventType: transition.eventType,
        status: transition.status,
        createdBy: 'Sistema'
      });
      updated += 1;
    }
  }

  return { updated };
}

async function getPartnerVideoDashboardData() {
  await ensurePartnerVideoContactSeeds();
  const dateKey = getSaoPauloParts().dateKey;
  const [[summary]] = await pool.query(
    `SELECT
       COUNT(*) AS totalContacts,
       SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS activeContacts,
       SUM(CASE WHEN active = 1 AND (phone_number IS NULL OR phone_number = '') THEN 1 ELSE 0 END) AS withoutPhone
     FROM partner_video_contacts`
  );
  const [controls] = await pool.query(
    `SELECT *
       FROM partner_video_daily_controls
      WHERE date = ?
      ORDER BY clinic_name ASC, partner_name ASC`,
    [dateKey]
  );
  const [contacts] = await pool.query(
    'SELECT * FROM partner_video_contacts ORDER BY active DESC, clinic_name ASC, partner_name ASC'
  );
  const [clinicRows] = await pool.query(
    'SELECT name FROM clinics WHERE active = 1 ORDER BY name ASC'
  );
  const [logs] = await pool.query(
    `SELECT *
       FROM partner_video_logs
      ORDER BY created_at DESC
      LIMIT 40`
  );
  const [sessionRows] = await pool.query(
    'SELECT * FROM whatsapp_service_sessions WHERE session_id = ? LIMIT 1',
    [WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME]
  );
  const activePartnerClinicKeys = new Set(
    contacts
      .filter((item) => Number(item.active))
      .map((item) => normalizeClinicLookupValue(item.clinic_name))
      .filter(Boolean)
  );
  const unitsWithoutPartner = clinicRows
    .filter((clinic) => !activePartnerClinicKeys.has(normalizeClinicLookupValue(clinic.name)))
    .map((clinic) => clinic.name);
  const pendingControls = controls.filter((item) => !Number(item.video_received) && !String(item.status || '').includes('finalizado'));
  const activeContacts = parseSqlCount(summary, 'activeContacts');
  const receivedOnTimeCount = controls.filter((item) => Number(item.video_received) && String(item.status || '').includes('prazo')).length;
  const complianceBase = controls.length || activeContacts;
  const complianceRate = complianceBase > 0 ? (receivedOnTimeCount / complianceBase) * 100 : 0;

  return {
    settings: await getPartnerVideoSettings(),
    session: sessionRows[0] || null,
    summary: {
      totalContacts: parseSqlCount(summary, 'totalContacts'),
      activeContacts,
      withoutPhone: parseSqlCount(summary, 'withoutPhone'),
      sentToday: controls.filter((item) => ['enfileirado', 'enviada'].includes(String(item.message_status || '').toLowerCase())).length,
      receivedOnTime: receivedOnTimeCount,
      complianceGoal: PARTNER_VIDEO_COMPLIANCE_GOAL,
      complianceBase,
      complianceRate: Number(complianceRate.toFixed(2)),
      complianceMissing: Math.max(0, Math.ceil(((PARTNER_VIDEO_COMPLIANCE_GOAL / 100) * complianceBase) - receivedOnTimeCount)),
      complianceStatus: complianceRate >= PARTNER_VIDEO_COMPLIANCE_GOAL ? 'cumprida' : 'abaixo_meta',
      pendingToday: pendingControls.length,
      pendingUntil930: pendingControls.filter((item) => String(item.status || '').toLowerCase() === 'aguardando envio').length,
      pendingAfter10: pendingControls.filter((item) => ['não enviado', 'acionado líder', 'acionado coordenador', 'acionado gerente'].includes(String(item.status || '').toLowerCase())).length,
      leaderActions: controls.filter((item) => item.leader_notified_at).length,
      coordinatorActions: controls.filter((item) => item.coordinator_notified_at).length,
      managerActions: controls.filter((item) => item.manager_notified_at).length,
      failuresToday: logs.filter((item) => String(item.status || '').toLowerCase() === 'erro' && getSaoPauloDateKey(item.created_at) === dateKey).length,
      unitsWithoutPartner: unitsWithoutPartner.length,
      unitsWithoutPartnerNames: unitsWithoutPartner
    },
    contacts,
    controls,
    logs
  };
}

async function ensureWhatsAppInstanceDailyWindow(instanceName) {
  await pool.query(
    `UPDATE whatsapp_instances
        SET messages_sent_today = CASE WHEN last_warmup_reset = CURDATE() THEN messages_sent_today ELSE 0 END,
            last_warmup_reset = CURDATE()
      WHERE instance_name = ?`,
    [instanceName]
  );
}

async function getWhatsAppDispatchThrottle(instanceName) {
  const config = getWhatsAppAntiBanConfig();
  await ensureWhatsAppInstanceDailyWindow(instanceName);
  const [instances] = await pool.query('SELECT * FROM whatsapp_instances WHERE instance_name = ? LIMIT 1', [instanceName]);
  const instance = instances[0] || {};
  const dailyLimit = Math.max(1, Number(instance.daily_send_limit || 30));
  const sentToday = Number(instance.messages_sent_today || 0);
  if (sentToday >= dailyLimit) {
    return {
      allowed: false,
      reason: 'daily_warmup_limit',
      retrySeconds: 60 * 30,
      dailyLimit,
      sentToday
    };
  }

  const [minuteRows] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM whatsapp_dispatch_queue
      WHERE instance_name = ?
        AND status = 'enviada'
        AND sent_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)`,
    [instanceName]
  );
  const sentLastMinute = parseSqlCount(minuteRows[0], 'total');
  if (sentLastMinute >= config.rateLimitPerMinute) {
    return {
      allowed: false,
      reason: 'minute_rate_limit',
      retrySeconds: randomIntegerBetween(20, 45),
      sentLastMinute,
      rateLimitPerMinute: config.rateLimitPerMinute
    };
  }

  return {
    allowed: true,
    dailyLimit,
    sentToday,
    sentLastMinute,
    rateLimitPerMinute: config.rateLimitPerMinute
  };
}

async function prepareWhatsAppDispatchItem(item) {
  const payload = parseSerializedPayload(item.payload);
  const complaintId = Number(payload.complaintId || payload.complaint_id || 0);

  if (complaintId && await isComplaintClosedOrDeleted(complaintId)) {
    return {
      skip: true,
      reason: 'complaint_closed',
      errorMessage: 'Disparo cancelado automaticamente porque a demanda foi fechada.'
    };
  }

  if (payload.source === 'daily_coordinator_demand_reminder' && payload.coordinatorId) {
    const [users] = await pool.query(
      `SELECT id, name, email, phone, whatsapp, role, active
         FROM users
        WHERE id = ?
          AND active = 1
          AND deleted_at IS NULL
        LIMIT 1`,
      [payload.coordinatorId]
    );
    const responsibleUser = users[0];

    if (!responsibleUser) {
      return {
        skip: true,
        reason: 'responsible_inactive',
        errorMessage: 'Responsável do lembrete diário está inativo ou removido.'
      };
    }

    const summary = await getCoordinatorDemandReminderStats(responsibleUser);
    if (!summary.total) {
      return {
        skip: true,
        reason: 'no_open_demands',
        errorMessage: 'Disparo cancelado automaticamente porque não há demandas abertas para este responsável.'
      };
    }

    const messageText = buildDailyCoordinatorDemandReminderMessage({
      coordinator: responsibleUser,
      summary,
      demands: summary.demands
    });

    if (messageText && messageText !== item.message_text) {
      const refreshedPayload = serializeEvolutionPayload({
        ...payload,
        demandCount: summary.total,
        refreshedAt: new Date().toISOString()
      });

      await pool.query(
        'UPDATE whatsapp_dispatch_queue SET message_text = ?, payload = ? WHERE id = ?',
        [messageText, refreshedPayload, item.id]
      );

      if (item.message_id) {
        await pool.query(
          'UPDATE whatsapp_messages SET message_text = ?, message = ? WHERE id = ?',
          [messageText, messageText, item.message_id]
        );
      }

      item.message_text = messageText;
      item.payload = refreshedPayload;
    }
  }

  return { skip: false, item };
}

let whatsappDispatchProcessing = false;

async function processWhatsAppDispatchQueue() {
  if (whatsappDispatchProcessing) return;
  whatsappDispatchProcessing = true;
  try {
    const [items] = await pool.query(
      `SELECT *
         FROM whatsapp_dispatch_queue
        WHERE status = 'pendente'
          AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC, id ASC
        LIMIT 5`
    );

    for (const item of items) {
      const dispatchPreparation = await prepareWhatsAppDispatchItem(item);
      if (dispatchPreparation.skip) {
        await pool.query(
          `UPDATE whatsapp_dispatch_queue
              SET status = 'cancelada',
                  error_message = ?
            WHERE id = ?`,
          [dispatchPreparation.errorMessage, item.id]
        );
        if (item.message_id) {
          await pool.query(
            `UPDATE whatsapp_messages
                SET status = 'cancelada',
                    error_message = ?
              WHERE id = ?`,
            [dispatchPreparation.errorMessage, item.message_id]
          );
        }
        await logEvolutionEvent('dispatch_skipped_closed_demand', {
          queueId: item.id,
          messageId: item.message_id,
          conversationId: item.conversation_id,
          instanceName: item.instance_name,
          status: 'skipped',
          response: { reason: dispatchPreparation.reason }
        });
        continue;
      }

      const throttle = await getWhatsAppDispatchThrottle(item.instance_name);
      if (!throttle.allowed) {
        await pool.query(
          `UPDATE whatsapp_dispatch_queue
              SET scheduled_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                  error_message = ?
            WHERE id = ?`,
          [throttle.retrySeconds, throttle.reason, item.id]
        );
        await logEvolutionEvent('anti_ban_throttle', {
          queueId: item.id,
          messageId: item.message_id,
          conversationId: item.conversation_id,
          instanceName: item.instance_name,
          status: 'info',
          response: throttle
        });
        continue;
      }

      const [lockResult] = await pool.query(
        `UPDATE whatsapp_dispatch_queue
            SET status = 'processando',
                attempts = attempts + 1,
                locked_at = NOW()
          WHERE id = ?
            AND status = 'pendente'`,
        [item.id]
      );
      if (!lockResult?.affectedRows) {
        continue;
      }

      const startedAt = performance.now();
      try {
        const useServiceProvider = isWhatsAppServiceProviderConfigured();
        const providerResponse = useServiceProvider
          ? await whatsappProvider.sendText({
              sessionId: item.instance_name,
              number: item.recipient_phone,
              message: item.message_text
            })
          : await evolutionService.sendText(item.instance_name, item.recipient_phone, item.message_text, {
              delay: item.anti_ban_delay_ms || undefined,
              presence: 'composing',
              linkPreview: true,
              config: await getEvolutionServiceConfig()
            });
        const providerMessageId = useServiceProvider
          ? providerResponse.messageId
          : getEvolutionMessageId(providerResponse);
        await pool.query(
          `UPDATE whatsapp_dispatch_queue
              SET status = 'enviada',
                  sent_at = NOW(),
                  error_message = NULL
            WHERE id = ?`,
          [item.id]
        );
        await pool.query(
          `UPDATE whatsapp_messages
              SET status = 'enviada',
                  evolution_message_id = ?,
                  whatsapp_message_id = ?,
                  sent_at = NOW(),
                  error_message = NULL
            WHERE id = ?`,
          [providerMessageId, providerMessageId, item.message_id]
        );
        if (useServiceProvider) {
          await pool.query(
            `INSERT INTO whatsapp_service_message_history
             (session_id, patient_phone, message_text, status, provider_message_id, response_payload, created_by, sent_at)
             VALUES (?, ?, ?, 'enviado', ?, ?, ?, NOW())`,
            [
              item.instance_name,
              item.recipient_phone,
              item.message_text,
              providerMessageId,
              JSON.stringify(providerResponse.raw || providerResponse),
              item.operator_name || 'Fila WhatsApp CRC'
            ]
          );
        }
        if (item.message_type === 'nps_automatico') {
          await pool.query(
            `UPDATE whatsapp_nps_invites
                SET status = 'enviado',
                    sent_at = NOW()
              WHERE message_id = ?`,
            [item.message_id]
          );
        }
        await pool.query(
          `UPDATE whatsapp_instances
              SET messages_sent_today = messages_sent_today + 1,
                  last_warmup_reset = CURDATE(),
                  updated_at = NOW()
            WHERE instance_name = ?`,
          [item.instance_name]
        );
        await pool.query(
          `UPDATE whatsapp_conversations
              SET last_message_at = NOW(),
                  status = CASE WHEN status = 'Novo' THEN 'Em atendimento' ELSE status END
            WHERE id = ?`,
          [item.conversation_id]
        );
        await logEvolutionEvent('send_message', {
          queueId: item.id,
          messageId: item.message_id,
          conversationId: item.conversation_id,
          instanceName: item.instance_name,
          status: 'success',
          durationMs: performance.now() - startedAt,
          request: { provider: useServiceProvider ? 'whatsapp_service' : 'evolution', number: item.recipient_phone, textLength: String(item.message_text || '').length, antiBanDelayMs: item.anti_ban_delay_ms },
          response: providerResponse
        });
        const message = await getWhatsAppMessageById(item.message_id);
        const conversation = item.conversation_id ? await getWhatsAppConversationById(item.conversation_id) : null;
        emitWhatsAppMessageChange('sent', message, conversation || {});
      } catch (error) {
        const maxAttempts = getWhatsAppAntiBanConfig().maxAttempts;
        const nextStatus = Number(item.attempts || 0) + 1 >= maxAttempts ? 'erro' : 'pendente';
        const retrySeconds = randomIntegerBetween(45, 120);
        await pool.query(
          `UPDATE whatsapp_dispatch_queue
              SET status = ?,
                  scheduled_at = CASE WHEN ? = 'pendente' THEN DATE_ADD(NOW(), INTERVAL ? SECOND) ELSE scheduled_at END,
                  error_message = ?
            WHERE id = ?`,
          [nextStatus, nextStatus, retrySeconds, error.response?.data?.message || error.message, item.id]
        );
        await pool.query(
          `UPDATE whatsapp_messages
              SET status = ?,
                  error_message = ?
            WHERE id = ?`,
          [nextStatus === 'erro' ? 'erro' : 'pendente', error.response?.data?.message || error.message, item.message_id]
        );
        if (item.message_type === 'nps_automatico') {
          await pool.query(
            `UPDATE whatsapp_nps_invites
                SET status = ?
              WHERE message_id = ?`,
            [nextStatus === 'erro' ? 'erro' : 'pendente', item.message_id]
          );
        }
        await logEvolutionEvent(error.code === 'ECONNABORTED' ? 'timeout' : 'send_message_error', {
          queueId: item.id,
          messageId: item.message_id,
          conversationId: item.conversation_id,
          instanceName: item.instance_name,
          status: error.code === 'ECONNABORTED' ? 'timeout' : 'error',
          durationMs: performance.now() - startedAt,
          request: { number: item.recipient_phone, textLength: String(item.message_text || '').length },
          error
        });
        const message = await getWhatsAppMessageById(item.message_id);
        const conversation = item.conversation_id ? await getWhatsAppConversationById(item.conversation_id) : null;
        emitWhatsAppMessageChange(nextStatus === 'erro' ? 'error' : 'retry', message, conversation || {});
      }
    }
  } catch (error) {
    console.warn('Falha ao processar fila de disparo WhatsApp:', error.message);
  } finally {
    whatsappDispatchProcessing = false;
  }
}

function buildWhatsAppScopeWhere(user, alias = 'c') {
  if (canViewAllWhatsAppAttendance(user)) {
    return { clause: '1=1', params: [] };
  }

  if (isCrcOperatorUser(user)) {
    const clinicIds = clinicIdsFromUser(user);
    if (!clinicIds.length) {
      return { clause: '0=1', params: [] };
    }
    return {
      clause: `(${alias}.clinic_id IN (${clinicIds.map(() => '?').join(',')}) AND (${alias}.operator_id = ? OR ${alias}.operator_id IS NULL OR ${alias}.assigned_operator_id IS NULL OR ${alias}.status = 'Novo'))`,
      params: [...clinicIds, user?.id || 0]
    };
  }

  return {
    clause: `(${alias}.operator_id = ?)`,
    params: [user?.id || 0]
  };
}

function buildDateFilter(query = {}, column = 'created_at') {
  const where = [];
  const params = [];
  if (query.startDate) {
    where.push(`${column} >= ?`);
    params.push(query.startDate);
  }
  if (query.endDate) {
    where.push(`${column} < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(query.endDate);
  }
  return { where, params };
}

function buildWhatsAppDashboardFilters(query = {}, alias = 'c') {
  const where = [];
  const params = [];
  if (query.operatorId) {
    where.push(`${alias}.operator_id = ?`);
    params.push(query.operatorId);
  }
  if (query.clinicId) {
    where.push(`${alias}.clinic_id = ?`);
    params.push(query.clinicId);
  }
  if (query.instanceName) {
    where.push(`${alias}.instance_name = ?`);
    params.push(query.instanceName);
  }
  if (query.status) {
    where.push(`${alias}.status = ?`);
    params.push(query.status);
  }
  if (query.campaign) {
    where.push(`${alias}.campaign LIKE ?`);
    params.push(`%${query.campaign}%`);
  }
  return { where, params };
}

async function handleGetWhatsAppConfigStatus(req, res) {
  try {
    const serviceStatus = getWhatsAppServiceConfigStatus();
    const serviceDiagnostics = serviceStatus.configured
      ? await whatsappVpsService.diagnostic()
      : { ...serviceStatus, serviceReachable: false, message: 'Configuração whatsapp-service ausente.' };
    const webhookConfig = getWhatsAppServiceWebhookConfig();
    let webhookDiagnostics = {
      url: webhookConfig.webhookUrl,
      tokenConfigured: Boolean(webhookConfig.webhookToken),
      lastInboundEventAt: null,
      lastEventStatus: null,
      lastEventType: null,
      lastError: null
    };
    try {
      const [events] = await pool.query(
        `SELECT event_type, status, error_message, created_at
           FROM whatsapp_evolution_logs
          WHERE event_type IN ('whatsapp_service_message_event', 'whatsapp_service_event_error', 'whatsapp_service_message_status', 'whatsapp_service_event_ignored')
          ORDER BY created_at DESC, id DESC
          LIMIT 1`
      );
      if (events[0]) {
        webhookDiagnostics = {
          ...webhookDiagnostics,
          lastInboundEventAt: events[0].created_at,
          lastEventStatus: events[0].status,
          lastEventType: events[0].event_type,
          lastError: events[0].error_message || null
        };
      }
    } catch (diagnosticError) {
      webhookDiagnostics.lastError = diagnosticError.message;
    }
    const evolutionConfig = await getEvolutionServiceConfig();
    const evolutionStatus = {
      configured: evolutionConfig.configured,
      baseUrlConfigured: evolutionConfig.baseUrlConfigured,
      apiKeyConfigured: evolutionConfig.apiKeyConfigured,
      missing: evolutionConfig.missing || [],
      evolutionReachable: false,
      skipped: true,
      message: 'Diagnóstico legado ignorado porque o sistema usa o whatsapp-service VPS.'
    };
    const provider = 'whatsapp_service';

    return res.json({
      ...serviceStatus,
      ...serviceDiagnostics,
      configured: Boolean(serviceStatus.configured),
      provider,
      providerLabel: 'whatsapp-service VPS',
      missing: serviceStatus.missing,
      whatsappService: { ...serviceStatus, ...serviceDiagnostics },
      webhook: webhookDiagnostics,
      evolution: evolutionStatus,
      evolutionReachable: false,
      serviceReachable: Boolean(serviceDiagnostics.serviceReachable)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ configured: false, message: 'Erro ao verificar configuração WhatsApp.' });
  }
}

async function handleGetWhatsAppAdminSettings(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode acessar configurações WhatsApp.' });
    }

    const saved = await loadWhatsAppSettingsCache(true);
    const serviceConfigOverrides = {
      baseURL: saved.baseUrl || process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL
    };
    const serviceApiKey = String(saved.apiKey || process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_SERVICE_API_KEY || '').trim();
    if (serviceApiKey) serviceConfigOverrides.apiKey = serviceApiKey;
    const serviceConfig = whatsappVpsService.getConfig(serviceConfigOverrides);
    const diagnostics = await whatsappVpsService.diagnostic(serviceConfig);
    return res.json({
      baseUrl: saved.baseUrl || process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL,
      apiKeyConfigured: serviceConfig.apiKeyConfigured,
      apiKeyMasked: maskSecret(serviceConfig.apiKey),
      antiBan: getWhatsAppAntiBanConfig(),
      diagnostics,
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar configurações WhatsApp.' });
  }
}

async function handleUpdateWhatsAppAdminSettings(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode alterar configurações WhatsApp.' });
    }

    const current = await loadWhatsAppSettingsCache(true);
    const submittedApiKey = String(req.body.apiKey || req.body.api_key || req.body.whatsapp_api_key || req.body.evolution_api_key || '').trim();
    const keepCurrentApiKey = !submittedApiKey || submittedApiKey.includes('*') || submittedApiKey.includes('...');
    const merged = sanitizeWhatsAppSettings({
      baseUrl: req.body.baseUrl || req.body.baseURL || req.body.whatsapp_api_url || req.body.evolution_base_url || current.baseUrl || process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL,
      apiKey: keepCurrentApiKey ? (current.apiKey || process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_SERVICE_API_KEY || '') : submittedApiKey,
      antiBan: {
        ...current.antiBan,
        ...(req.body.antiBan || {})
      },
      updatedAt: new Date().toISOString(),
      updatedBy: getActorName(req.user)
    });

    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [
        WHATSAPP_EVOLUTION_SETTINGS_KEY,
        JSON.stringify({
          baseUrl: merged.baseUrl,
          apiKey: merged.apiKey,
          antiBan: merged.antiBan,
          updatedAt: merged.updatedAt,
          updatedBy: merged.updatedBy
        }),
        getActorName(req.user)
      ]
    );

    whatsappSettingsCache = merged;
    process.env.WHATSAPP_API_URL = merged.baseUrl;
    if (merged.apiKey) process.env.WHATSAPP_API_KEY = merged.apiKey;

    const diagnosticsOverrides = { baseURL: merged.baseUrl };
    if (merged.apiKey) diagnosticsOverrides.apiKey = merged.apiKey;
    const diagnostics = await whatsappVpsService.diagnostic(diagnosticsOverrides);
    await logEvolutionEvent('settings_updated', {
      status: diagnostics.serviceReachable ? 'success' : 'warning',
      request: {
        baseUrlConfigured: Boolean(merged.baseUrl),
        apiKeyConfigured: Boolean(merged.apiKey),
        antiBan: merged.antiBan
      },
      response: diagnostics
    });

    return res.json({
      success: true,
      baseUrl: merged.baseUrl,
      apiKeyConfigured: Boolean(merged.apiKey),
      apiKeyMasked: maskSecret(merged.apiKey),
      antiBan: merged.antiBan,
      diagnostics,
      updatedAt: merged.updatedAt,
      updatedBy: merged.updatedBy
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao salvar configurações WhatsApp.' });
  }
}

async function handleTestWhatsAppAdminSettings(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode testar configurações WhatsApp.' });
    }
    const settings = await loadWhatsAppSettingsCache(true);
    const diagnosticsOverrides = {
      baseURL: settings.baseUrl || process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL
    };
    const diagnosticsApiKey = String(settings.apiKey || process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_SERVICE_API_KEY || '').trim();
    if (diagnosticsApiKey) diagnosticsOverrides.apiKey = diagnosticsApiKey;
    const diagnostics = await whatsappVpsService.diagnostic(diagnosticsOverrides);
    await logEvolutionEvent('settings_test', {
      status: diagnostics.serviceReachable ? 'success' : 'error',
      response: diagnostics
    });
    return res.json(diagnostics);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao testar conexão com o whatsapp-service.' });
  }
}

function normalizeWhatsAppServiceSessionId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 120);
}

function mapWhatsAppServiceStatus(payload, fallback = 'iniciando') {
  const raw = String(
    payload?.status
    || payload?.state
    || payload?.connection
    || payload?.data?.status
    || payload?.data?.state
    || payload?.session?.status
    || fallback
    || ''
  ).trim().toLowerCase();

  if (['connected', 'conectado', 'open', 'ready', 'authenticated', 'online'].some((item) => raw.includes(item))) return 'conectado';
  if (['qr', 'qrcode', 'scan', 'aguardando', 'pairing'].some((item) => raw.includes(item))) return 'aguardando_qrcode';
  if (['starting', 'iniciando', 'loading', 'initializing', 'connecting', 'criando'].some((item) => raw.includes(item))) return 'iniciando';
  if (['disconnect', 'desconect', 'close', 'closed', 'offline', 'stopped', 'not_found'].some((item) => raw.includes(item))) return 'desconectado';

  return fallback || 'iniciando';
}

function getWhatsAppServiceConfigStatus() {
  const apiKey = String(process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_SERVICE_API_KEY || '').trim();
  const configOverrides = {
    baseURL: process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL
  };
  if (apiKey) configOverrides.apiKey = apiKey;
  const config = whatsappVpsService.getConfig(configOverrides);

  return {
    configured: config.configured,
    baseUrlConfigured: config.baseUrlConfigured,
    apiKeyConfigured: config.apiKeyConfigured,
    missing: config.missing,
    baseUrl: config.baseURL,
    qrRoutePattern: `${config.baseURL}/public/sessions/{sessionId}/qr-image`
  };
}

function isWhatsAppServiceProviderConfigured() {
  return getWhatsAppServiceConfigStatus().configured;
}

function getWhatsAppServiceWebhookConfig() {
  const serviceConfig = whatsappVpsService.getConfig();
  const token = String(
    process.env.WHATSAPP_EVENTS_TOKEN
      || process.env.WHATSAPP_SERVICE_WEBHOOK_TOKEN
      || process.env.WHATSAPP_WEBHOOK_TOKEN
      || process.env.WHATSAPP_API_KEY
      || process.env.WHATSAPP_SERVICE_API_KEY
      || serviceConfig.apiKey
      || ''
  ).trim();

  return {
    webhookUrl: String(process.env.WHATSAPP_SERVICE_WEBHOOK_URL || `${publicBaseUrl}/api/whatsapp/events`).trim(),
    webhook_url: String(process.env.WHATSAPP_SERVICE_WEBHOOK_URL || `${publicBaseUrl}/api/whatsapp/events`).trim(),
    eventsUrl: String(process.env.WHATSAPP_SERVICE_WEBHOOK_URL || `${publicBaseUrl}/api/whatsapp/events`).trim(),
    callbackUrl: String(process.env.WHATSAPP_SERVICE_WEBHOOK_URL || `${publicBaseUrl}/api/whatsapp/events`).trim(),
    webhookToken: token || null,
    webhook_token: token || null,
    eventsToken: token || null,
    headers: token ? { 'x-api-key': token } : {}
  };
}

function getWhatsAppServiceMessageId(response) {
  return response?.id
    || response?.messageId
    || response?.message_id
    || response?.raw?.id
    || response?.raw?.messageId
    || response?.data?.id
    || response?.data?.messageId
    || response?.raw?.data?.id
    || response?.raw?.data?.messageId
    || response?.key?.id
    || response?.data?.key?.id
    || null;
}

async function refreshWhatsAppServiceSessionStatus(row) {
  try {
    const statusResponse = await whatsappVpsService.getSessionStatus(row.session_id);
    const status = mapWhatsAppServiceStatus(statusResponse, row.status || 'iniciando');
    await pool.query(
      `UPDATE whatsapp_service_sessions
          SET status = ?,
              last_status_payload = ?,
              last_status_check_at = NOW(),
              updated_at = NOW()
        WHERE session_id = ?`,
      [status, JSON.stringify(statusResponse), row.session_id]
    );
    return {
      ...row,
      status,
      status_payload: statusResponse,
      last_status_check_at: new Date().toISOString(),
      status_error: null
    };
  } catch (error) {
    return {
      ...row,
      status_error: whatsappVpsService.friendlyApiError(error)
    };
  }
}

async function refreshWhatsAppInstanceStatusFromService(row) {
  try {
    const statusResponse = await whatsappVpsService.getSessionStatus(row.instance_name);
    const status = mapWhatsAppServiceStatus(statusResponse, row.status || 'iniciando');
    const keepReconnectWarning = row.status === 'reconectar'
      && status === 'conectado'
      && String(row.notes || '').toLowerCase().includes('sem canal de comunica');
    const effectiveStatus = keepReconnectWarning ? 'reconectar' : status;
    await pool.query(
      `UPDATE whatsapp_instances
          SET status = ?,
              last_connection_at = CASE WHEN ? = 'conectado' THEN NOW() ELSE last_connection_at END,
              uptime_started_at = CASE WHEN ? = 'conectado' AND uptime_started_at IS NULL THEN NOW() WHEN ? <> 'conectado' THEN NULL ELSE uptime_started_at END,
              last_status_check_at = NOW(),
              updated_at = NOW()
        WHERE instance_name = ?`,
      [effectiveStatus, effectiveStatus, effectiveStatus, effectiveStatus, row.instance_name]
    );
    await pool.query(
      `UPDATE whatsapp_service_sessions
          SET status = ?,
              last_status_payload = ?,
              last_status_check_at = NOW()
        WHERE session_id = ?`,
      [effectiveStatus, JSON.stringify(statusResponse), row.instance_name]
    );
    return {
      ...row,
      status: effectiveStatus,
      provider: 'whatsapp_service',
      status_payload: statusResponse,
      status_error: keepReconnectWarning ? 'Sessão exige reconexão antes de enviar novas mensagens.' : null
    };
  } catch (error) {
    return {
      ...row,
      provider: 'whatsapp_service',
      status_error: whatsappVpsService.friendlyApiError(error)
    };
  }
}

async function handleListWhatsAppServiceSessions(req, res) {
  try {
    const config = getWhatsAppServiceConfigStatus();
    const [rows] = await pool.query(
      `SELECT ws.*,
              (SELECT COUNT(*) FROM whatsapp_service_message_history h WHERE h.session_id = ws.session_id) AS message_count,
              (SELECT MAX(h.created_at) FROM whatsapp_service_message_history h WHERE h.session_id = ws.session_id) AS last_message_at
         FROM whatsapp_service_sessions ws
        ORDER BY ws.clinic_name ASC, ws.session_id ASC`
    );

    const sessions = config.configured
      ? await Promise.all(rows.map((row) => refreshWhatsAppServiceSessionStatus(row)))
      : rows.map((row) => ({ ...row, status_error: 'WHATSAPP_API_KEY ausente.' }));

    return res.json({ config, sessions });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar sessões do whatsapp-service.' });
  }
}

function serializeWhatsAppWebSession(row = {}) {
  const status = mapWhatsAppServiceStatus(row.status || row.last_status_payload, row.status || 'nao_iniciada');
  return {
    id: row.session_id,
    sessionId: row.session_id,
    name: row.display_name || row.clinic_name || row.session_id,
    connected: status === 'conectado',
    hasQr: status === 'aguardando_qrcode',
    status,
    clinicId: row.clinic_id || null,
    clinicName: row.clinic_name || null,
    unitName: row.unit_name || null,
    phoneNumber: row.phone_number || null,
    lastStatusCheckAt: row.last_status_check_at || null,
    lastConnectedAt: row.last_connected_at || null,
    messageCount: Number(row.message_count || 0),
    lastMessageAt: row.last_message_at || null
  };
}

async function handleListWhatsAppWebSessions(req, res) {
  try {
    await ensureDefaultWhatsAppCrcSessions();
    await syncDefaultWhatsAppSessionsWithClinics();
    const config = getWhatsAppServiceConfigStatus();
    const [rows] = await pool.query(
      `SELECT ws.*,
              (SELECT COUNT(*) FROM whatsapp_service_message_history h WHERE h.session_id = ws.session_id) AS message_count,
              (SELECT MAX(h.created_at) FROM whatsapp_service_message_history h WHERE h.session_id = ws.session_id) AS last_message_at
         FROM whatsapp_service_sessions ws
        ORDER BY
          CASE ws.session_id
            WHEN 'garavelo' THEN 0
            WHEN 'vila-brasilia' THEN 1
            ELSE 2
          END,
          ws.clinic_name ASC,
          ws.session_id ASC`
    );

    const sessions = config.configured
      ? await Promise.all(rows.map((row) => refreshWhatsAppServiceSessionStatus(row)))
      : rows.map((row) => ({ ...row, status_error: 'Configure WHATSAPP_API_KEY ou WHATSAPP_SERVICE_API_KEY no backend.' }));

    return res.json(sessions.map(serializeWhatsAppWebSession));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar sessões WhatsApp Web.' });
  }
}

async function handleGetWhatsAppWebSessionQr(req, res) {
  const sessionId = normalizeWhatsAppServiceSessionId(req.params.id || req.params.sessionId);

  try {
    if (!sessionId) {
      return res.status(400).json({
        sessionId: null,
        name: null,
        connected: false,
        qr: null,
        message: 'Informe a sessão WhatsApp.'
      });
    }

    await ensureDefaultWhatsAppCrcSessions();
    await syncDefaultWhatsAppSessionsWithClinics();

    const [rows] = await pool.query('SELECT * FROM whatsapp_service_sessions WHERE session_id = ? LIMIT 1', [sessionId]);
    const session = rows[0];
    if (!session) {
      return res.status(404).json({
        sessionId,
        name: sessionId,
        connected: false,
        qr: null,
        message: 'Sessão WhatsApp não encontrada.'
      });
    }

    const sessionName = session.display_name || session.clinic_name || sessionId;
    const config = getWhatsAppServiceConfigStatus();
    if (!config.configured) {
      return res.status(503).json({
        sessionId,
        name: sessionName,
        connected: false,
        qr: null,
        message: `Configuração whatsapp-service ausente: ${config.missing.join(', ') || 'WHATSAPP_API_KEY'}.`
      });
    }

    let statusPayload = null;
    let status = session.status || 'nao_iniciada';

    try {
      statusPayload = await whatsappVpsService.getSessionStatus(sessionId);
      status = mapWhatsAppServiceStatus(statusPayload, status);
      await pool.query(
        `UPDATE whatsapp_service_sessions
            SET status = ?,
                last_status_payload = ?,
                last_status_check_at = NOW(),
                updated_by = ?
          WHERE session_id = ?`,
        [status, JSON.stringify(statusPayload), getActorName(req.user), sessionId]
      );
    } catch (statusError) {
      statusPayload = { warning: whatsappVpsService.friendlyApiError(statusError) };
    }

    if (status === 'conectado') {
      await pool.query(
        `UPDATE whatsapp_instances
            SET status = 'conectado',
                last_connection_at = COALESCE(last_connection_at, NOW()),
                last_status_check_at = NOW(),
                updated_by = ?
          WHERE instance_name = ?`,
        [getActorName(req.user), sessionId]
      );

      return res.json({
        sessionId,
        name: sessionName,
        connected: true,
        qr: null,
        message: 'WhatsApp conectado.'
      });
    }

    await whatsappVpsService.createSession(sessionId, {
      source: 'system_qr_route',
      clinicId: session.clinic_id || null,
      clinicName: session.clinic_name || null,
      displayName: sessionName,
      ...getWhatsAppServiceWebhookConfig()
    });

    const image = await whatsappVpsService.waitForQrImage(sessionId, {
      baseURL: process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL,
      attempts: Number(process.env.WHATSAPP_QR_ATTEMPTS || 6),
      delayMs: Number(process.env.WHATSAPP_QR_RETRY_DELAY_MS || 2500)
    });
    const qr = `data:${image.contentType};base64,${image.bytes.toString('base64')}`;

    await pool.query(
      `UPDATE whatsapp_service_sessions
          SET status = 'aguardando_qrcode',
              last_status_payload = ?,
              last_status_check_at = NOW(),
              updated_by = ?
        WHERE session_id = ?`,
      [JSON.stringify({ statusPayload, qrSource: image.source || 'whatsapp_service' }), getActorName(req.user), sessionId]
    );
    await pool.query(
      `UPDATE whatsapp_instances
          SET status = 'aguardando_qrcode',
              last_status_check_at = NOW(),
              updated_by = ?
        WHERE instance_name = ?`,
      [getActorName(req.user), sessionId]
    );

    return res.json({
      sessionId,
      name: sessionName,
      connected: false,
      qr,
      message: 'QR Code disponível para leitura.'
    });
  } catch (error) {
    console.error(error);
    return res.status(200).json({
      sessionId,
      name: sessionId,
      connected: false,
      qr: null,
      message: whatsappVpsService.friendlyApiError(error) || 'Aguardando geração do QR Code.'
    });
  }
}

async function handleCreateWhatsAppServiceSession(req, res) {
  try {
    const sessionId = normalizeWhatsAppServiceSessionId(req.body.sessionId || req.body.session_id);
    if (!sessionId || sessionId.length < 3) {
      return res.status(400).json({ error: 'Informe um sessionId com pelo menos 3 caracteres.' });
    }

    const clinic = req.body.clinic_id ? await getClinicSnapshot(req.body.clinic_id) : null;
    const phone = normalizeWhatsAppPhone(req.body.phone_number || req.body.phoneNumber);
    const displayName = sanitizeFinancialString(req.body.display_name || req.body.displayName || sessionId);
    const unitName = sanitizeFinancialString(req.body.unit_name || req.body.unitName || clinic?.city);
    const actorName = getActorName(req.user);
    let serviceResponse = null;
    let warning = null;

    try {
      serviceResponse = await whatsappVpsService.createSession(sessionId, {
        phone,
        clinicId: clinic?.id || req.body.clinic_id || null,
        clinicName: clinic?.name || sanitizeFinancialString(req.body.clinic_name),
        unitName,
        displayName,
        ...getWhatsAppServiceWebhookConfig()
      });
    } catch (error) {
      warning = whatsappVpsService.friendlyApiError(error);
    }

    const status = serviceResponse ? mapWhatsAppServiceStatus(serviceResponse, 'iniciando') : 'iniciando';
    await pool.query(
      `INSERT INTO whatsapp_service_sessions
       (session_id, display_name, clinic_id, clinic_name, unit_name, phone_number, status, last_status_payload, last_status_check_at, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         clinic_id = VALUES(clinic_id),
         clinic_name = VALUES(clinic_name),
         unit_name = VALUES(unit_name),
         phone_number = VALUES(phone_number),
         status = VALUES(status),
         last_status_payload = VALUES(last_status_payload),
         last_status_check_at = NOW(),
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [
        sessionId,
        displayName,
        clinic?.id || req.body.clinic_id || null,
        clinic?.name || sanitizeFinancialString(req.body.clinic_name),
        unitName,
        phone,
        status,
        serviceResponse ? JSON.stringify(serviceResponse) : null,
        sanitizeFinancialString(req.body.notes, 2000),
        actorName,
        actorName
      ]
    );

    await pool.query(
      `INSERT INTO whatsapp_instances
       (instance_name, display_name, sector, clinic_id, clinic_name, unit_name, phone_number, status, notes, created_by, updated_by)
       VALUES (?, ?, 'CRC', ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         clinic_id = VALUES(clinic_id),
         clinic_name = VALUES(clinic_name),
         unit_name = VALUES(unit_name),
         phone_number = VALUES(phone_number),
         status = VALUES(status),
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [
        sessionId,
        displayName,
        clinic?.id || req.body.clinic_id || null,
        clinic?.name || sanitizeFinancialString(req.body.clinic_name),
        unitName,
        phone,
        status,
        sanitizeFinancialString(req.body.notes, 2000),
        actorName,
        actorName
      ]
    );

    const [rows] = await pool.query('SELECT * FROM whatsapp_service_sessions WHERE session_id = ? LIMIT 1', [sessionId]);
    return res.status(201).json({
      session: rows[0],
      serviceResponse,
      warning,
      qrImageUrl: whatsappVpsService.getQrImageUrl(sessionId, { baseURL: process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL })
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao criar sessão do whatsapp-service.' });
  }
}

async function handleUpdateWhatsAppServiceSession(req, res) {
  try {
    const sessionId = normalizeWhatsAppServiceSessionId(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ error: 'Informe o sessionId.' });
    }

    const clinic = req.body.clinic_id ? await getClinicSnapshot(req.body.clinic_id) : null;
    const displayName = sanitizeFinancialString(req.body.display_name || req.body.displayName || sessionId);
    const unitName = sanitizeFinancialString(req.body.unit_name || req.body.unitName || clinic?.city);
    const actorName = getActorName(req.user);

    const [currentRows] = await pool.query('SELECT * FROM whatsapp_service_sessions WHERE session_id = ? LIMIT 1', [sessionId]);
    if (!currentRows[0]) {
      return res.status(404).json({ error: 'Sessão não encontrada.' });
    }
    const phone = normalizeWhatsAppPhone(req.body.phone_number || req.body.phoneNumber || currentRows[0].phone_number);

    await pool.query(
      `UPDATE whatsapp_service_sessions
          SET display_name = ?,
              clinic_id = ?,
              clinic_name = ?,
              unit_name = ?,
              phone_number = ?,
              notes = ?,
              updated_by = ?
        WHERE session_id = ?`,
      [
        displayName,
        clinic?.id || req.body.clinic_id || null,
        clinic?.name || sanitizeFinancialString(req.body.clinic_name),
        unitName,
        phone,
        sanitizeFinancialString(req.body.notes, 2000),
        actorName,
        sessionId
      ]
    );

    await pool.query(
      `UPDATE whatsapp_instances
          SET display_name = ?,
              clinic_id = ?,
              clinic_name = ?,
              unit_name = ?,
              phone_number = ?,
              notes = ?,
              updated_by = ?
        WHERE instance_name = ?`,
      [
        displayName,
        clinic?.id || req.body.clinic_id || null,
        clinic?.name || sanitizeFinancialString(req.body.clinic_name),
        unitName,
        phone,
        sanitizeFinancialString(req.body.notes, 2000),
        actorName,
        sessionId
      ]
    );

    const [rows] = await pool.query('SELECT * FROM whatsapp_service_sessions WHERE session_id = ? LIMIT 1', [sessionId]);
    return res.json({ success: true, session: rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar sessão do whatsapp-service.' });
  }
}

async function handleDeleteWhatsAppServiceSession(req, res) {
  try {
    const sessionId = normalizeWhatsAppServiceSessionId(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ error: 'Informe o sessionId.' });
    }

    await pool.query('DELETE FROM whatsapp_service_sessions WHERE session_id = ?', [sessionId]);
    await pool.query('DELETE FROM whatsapp_instances WHERE instance_name = ?', [sessionId]);
    await logEvolutionEvent('delete_whatsapp_service_session', {
      instanceName: sessionId,
      status: 'success',
      request: { sessionId },
      response: { localDelete: true, vpsSessionPreserved: true }
    });
    emitWhatsAppDashboardRefresh('delete_whatsapp_service_session', { sessionId });
    return res.json({
      success: true,
      message: 'Sessão excluída do cadastro do sistema. A sessão local da VPS não foi apagada.'
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir sessão do whatsapp-service.' });
  }
}

async function handleGetWhatsAppServiceSessionStatus(req, res) {
  try {
    const sessionId = normalizeWhatsAppServiceSessionId(req.params.sessionId);
    const statusResponse = await whatsappVpsService.getSessionStatus(sessionId);
    const status = mapWhatsAppServiceStatus(statusResponse, 'iniciando');
    await pool.query(
      `UPDATE whatsapp_service_sessions
          SET status = ?,
              last_status_payload = ?,
              last_status_check_at = NOW(),
              updated_by = ?
        WHERE session_id = ?`,
      [status, JSON.stringify(statusResponse), getActorName(req.user), sessionId]
    );
    return res.json({ sessionId, status, service: statusResponse });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: whatsappVpsService.friendlyApiError(error) || 'Erro ao verificar status da sessão.' });
  }
}

async function handleGetWhatsAppServiceQrImage(req, res) {
  try {
    const sessionId = normalizeWhatsAppServiceSessionId(req.params.sessionId);
    await whatsappVpsService.createSession(sessionId, { source: 'qr_image_request', ...getWhatsAppServiceWebhookConfig() });
    const image = await whatsappVpsService.waitForQrImage(sessionId, {
      baseURL: process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL,
      attempts: Number(process.env.WHATSAPP_QR_ATTEMPTS || 6),
      delayMs: Number(process.env.WHATSAPP_QR_RETRY_DELAY_MS || 2500)
    });
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(image.bytes);
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: whatsappVpsService.friendlyApiError(error) || 'Erro ao carregar QR Code.' });
  }
}

async function handleSendWhatsAppServiceMessage(req, res) {
  let historyId = null;
  try {
    const sessionId = normalizeWhatsAppServiceSessionId(req.body.sessionId || req.body.session_id);
    const phone = normalizeWhatsAppPhone(req.body.patient_phone || req.body.phone || req.body.number);
    const message = String(req.body.message || req.body.message_text || '').trim();

    if (!sessionId) return res.status(400).json({ error: 'Selecione a sessão de envio.' });
    if (!phone) return res.status(400).json({ error: 'Número inválido. Use DDI e DDD. Exemplo: 5562999999999.' });
    if (!message) return res.status(400).json({ error: 'Informe a mensagem de teste.' });

    const [sessionRows] = await pool.query('SELECT session_id FROM whatsapp_service_sessions WHERE session_id = ? LIMIT 1', [sessionId]);
    if (!sessionRows[0]) return res.status(404).json({ error: 'Sessão não cadastrada no sistema.' });

    const [insert] = await pool.query(
      `INSERT INTO whatsapp_service_message_history
       (session_id, patient_phone, message_text, status, created_by)
       VALUES (?, ?, ?, 'pendente', ?)`,
      [sessionId, phone, message, getActorName(req.user)]
    );
    historyId = insert.insertId;

    const serviceResponse = await whatsappVpsService.sendMessage({ sessionId, number: phone, message });
    const providerMessageId = getWhatsAppServiceMessageId(serviceResponse);
    await pool.query(
      `UPDATE whatsapp_service_message_history
          SET status = 'enviado',
              provider_message_id = ?,
              response_payload = ?,
              sent_at = NOW()
        WHERE id = ?`,
      [providerMessageId, JSON.stringify(serviceResponse), historyId]
    );

    return res.status(202).json({
      success: true,
      message: 'Mensagem enviada pelo whatsapp-service.',
      historyId,
      providerMessageId,
      serviceResponse
    });
  } catch (error) {
    console.error(error);
    if (historyId) {
      await pool.query(
        `UPDATE whatsapp_service_message_history
            SET status = 'erro',
                error_message = ?,
                response_payload = ?
          WHERE id = ?`,
        [
          whatsappVpsService.friendlyApiError(error),
          error.response?.data ? JSON.stringify(error.response.data) : null,
          historyId
        ]
      );
    }
    return res.status(502).json({ error: whatsappVpsService.friendlyApiError(error) || 'Erro ao enviar mensagem pelo whatsapp-service.' });
  }
}

async function handleListWhatsAppServiceHistory(req, res) {
  try {
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
    const [rows] = await pool.query(
      `SELECT *
         FROM whatsapp_service_message_history
        ORDER BY created_at DESC
        LIMIT ${limit}`
    );
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar histórico de mensagens do whatsapp-service.' });
  }
}

async function handleGetWhatsAppInstances(req, res) {
  try {
    const scope = buildWhatsAppInstanceScopeWhere(req.user, 'wi');
    const [rows] = await pool.query(
      `SELECT wi.*,
              (SELECT COUNT(*) FROM whatsapp_messages m WHERE m.instance_name = wi.instance_name) AS message_count,
              (SELECT MAX(m.created_at) FROM whatsapp_messages m WHERE m.instance_name = wi.instance_name) AS last_activity_at,
              (SELECT COUNT(*) FROM whatsapp_attendance_queue q WHERE q.instance_name = wi.instance_name AND q.status = 'aguardando') AS queue_count
         FROM whatsapp_instances wi
        WHERE ${scope.clause}
        ORDER BY wi.sector ASC, wi.display_name ASC, wi.instance_name ASC`,
      scope.params
    );
    if (isWhatsAppServiceProviderConfigured()) {
      const enriched = await Promise.all(rows.map((row) => refreshWhatsAppInstanceStatusFromService(row)));
      return res.json(enriched);
    }
    return res.json(rows.map((row) => ({
      ...row,
      provider: 'whatsapp_service',
      status_error: 'Configure WHATSAPP_API_KEY ou WHATSAPP_SERVICE_API_KEY no backend para consultar o whatsapp-service.'
    })));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar instâncias WhatsApp.' });
  }
}

async function handleCreateWhatsAppInstance(req, res) {
  const startedAt = performance.now();
  let instanceName = '';
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode configurar instâncias WhatsApp.' });
    }

    instanceName = normalizeEvolutionInstanceName(req.body.instance_name || req.body.instanceName);
    if (!instanceName) return res.status(400).json({ error: 'Informe o nome da instância.' });

    const clinic = req.body.clinic_id ? await getClinicSnapshot(req.body.clinic_id) : null;
    const phone = normalizeWhatsAppPhone(req.body.phone_number || req.body.phoneNumber);
    const operatorId = Number(req.body.operator_id || req.body.operatorId || 0) || null;
    let operatorName = null;
    if (operatorId) {
      const [operatorRows] = await pool.query(
        `SELECT id, name
           FROM users
          WHERE id = ?
            AND ${buildWhatsAppOperatorRoleWhere()}
            AND COALESCE(active, 1) = 1
            AND deleted_at IS NULL
          LIMIT 1`,
        [operatorId, ...getWhatsAppOperatorRoleParams()]
      );
      if (!operatorRows[0]) return res.status(400).json({ error: 'Selecione um Operador de CRC ativo para direcionar o número.' });
      operatorName = operatorRows[0].name;
      const instanceClinicId = Number(clinic?.id || req.body.clinic_id || 0);
      await ensureWhatsAppOperatorClinicLink(operatorId, instanceClinicId, req.user);
    }
    const serviceConfigured = isWhatsAppServiceProviderConfigured();
    let providerResponse = null;
    let providerWarning = null;
    let providerStatus = serviceConfigured ? 'iniciando' : 'pendente_configuracao';

    if (serviceConfigured) {
      try {
        providerResponse = await whatsappVpsService.createSession(instanceName, {
          phone,
          clinicId: clinic?.id || req.body.clinic_id || null,
          clinicName: clinic?.name || sanitizeFinancialString(req.body.clinic_name),
          unitName: sanitizeFinancialString(req.body.unit_name) || clinic?.city || null,
          displayName: sanitizeFinancialString(req.body.display_name || req.body.displayName || instanceName),
          ...getWhatsAppServiceWebhookConfig()
        });
        providerStatus = mapWhatsAppServiceStatus(providerResponse, 'iniciando');
      } catch (error) {
        providerWarning = whatsappVpsService.friendlyApiError(error);
        await logEvolutionEvent('create_whatsapp_service_session', {
          instanceName,
          status: error.code === 'ECONNABORTED' ? 'timeout' : 'warning',
          durationMs: performance.now() - startedAt,
          request: { sessionId: instanceName, number: phone },
          error
        });
      }
    } else {
      providerWarning = 'Cadastro salvo no sistema. Configure WHATSAPP_API_URL e WHATSAPP_API_KEY para iniciar a sessão e gerar QR Code.';
      await logEvolutionEvent('create_whatsapp_service_session', {
        instanceName,
        status: 'pending_configuration',
        durationMs: performance.now() - startedAt,
        request: { sessionId: instanceName, number: phone },
        response: { localOnly: true }
      });
    }

    await pool.query(
      `INSERT INTO whatsapp_instances
       (instance_name, display_name, sector, clinic_id, clinic_name, unit_name, phone_number, status, operator_id, operator_name, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         sector = VALUES(sector),
         clinic_id = VALUES(clinic_id),
         clinic_name = VALUES(clinic_name),
         unit_name = VALUES(unit_name),
         phone_number = VALUES(phone_number),
         operator_id = VALUES(operator_id),
         operator_name = VALUES(operator_name),
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [
        instanceName,
        sanitizeFinancialString(req.body.display_name || req.body.displayName || instanceName),
        sanitizeFinancialString(req.body.sector || 'CRC', 80),
        clinic?.id || req.body.clinic_id || null,
        clinic?.name || sanitizeFinancialString(req.body.clinic_name),
        sanitizeFinancialString(req.body.unit_name) || clinic?.city || null,
        phone,
        providerStatus,
        operatorId,
        operatorName,
        sanitizeFinancialString(req.body.notes, 2000),
        getActorName(req.user),
        getActorName(req.user)
      ]
    );

    await pool.query(
      `INSERT INTO whatsapp_service_sessions
       (session_id, display_name, clinic_id, clinic_name, unit_name, phone_number, status, last_status_payload, last_status_check_at, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         clinic_id = VALUES(clinic_id),
         clinic_name = VALUES(clinic_name),
         unit_name = VALUES(unit_name),
         phone_number = VALUES(phone_number),
         status = VALUES(status),
         last_status_payload = VALUES(last_status_payload),
         last_status_check_at = NOW(),
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [
        instanceName,
        sanitizeFinancialString(req.body.display_name || req.body.displayName || instanceName),
        clinic?.id || req.body.clinic_id || null,
        clinic?.name || sanitizeFinancialString(req.body.clinic_name),
        sanitizeFinancialString(req.body.unit_name) || clinic?.city || null,
        phone,
        providerStatus,
        providerResponse ? JSON.stringify(providerResponse) : null,
        sanitizeFinancialString(req.body.notes, 2000),
        getActorName(req.user),
        getActorName(req.user)
      ]
    );

    const [rows] = await pool.query('SELECT * FROM whatsapp_instances WHERE instance_name = ? LIMIT 1', [instanceName]);
    if (!providerWarning) {
      await logEvolutionEvent('create_whatsapp_service_session', {
        instanceName,
        status: 'success',
        durationMs: performance.now() - startedAt,
        request: { instanceName, number: phone },
        response: providerResponse
      });
    }
    emitWhatsAppDashboardRefresh('instance_created', { instanceName });
    return res.status(201).json({
      instance: rows[0],
      provider: 'whatsapp_service',
      service: providerResponse,
      evolution: null,
      warning: providerWarning
    });
  } catch (error) {
    console.error(error);
    await logEvolutionEvent('create_instance', {
      instanceName,
      status: 'error',
      durationMs: performance.now() - startedAt,
      request: req.body,
      error
    });
    return res.status(400).json({ error: error.message || 'Erro ao criar instância WhatsApp.' });
  }
}

async function handleUpdateWhatsAppInstance(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode editar números WhatsApp.' });
    }

    const instanceName = normalizeEvolutionInstanceName(req.params.instanceName);
    if (!instanceName) return res.status(400).json({ error: 'Informe a instância WhatsApp.' });

    const [currentRows] = await pool.query('SELECT * FROM whatsapp_instances WHERE instance_name = ? LIMIT 1', [instanceName]);
    if (!currentRows[0]) return res.status(404).json({ error: 'Número WhatsApp não encontrado.' });

    const clinic = req.body.clinic_id ? await getClinicSnapshot(req.body.clinic_id) : null;
    const phone = normalizeWhatsAppPhone(req.body.phone_number || req.body.phoneNumber || currentRows[0].phone_number);
    const operatorId = Number(req.body.operator_id || req.body.operatorId || 0) || null;
    let operatorName = null;

    if (operatorId) {
      const [operatorRows] = await pool.query(
        `SELECT id, name
           FROM users
          WHERE id = ?
            AND ${buildWhatsAppOperatorRoleWhere()}
            AND COALESCE(active, 1) = 1
            AND deleted_at IS NULL
          LIMIT 1`,
        [operatorId, ...getWhatsAppOperatorRoleParams()]
      );
      if (!operatorRows[0]) return res.status(400).json({ error: 'Selecione um Operador de CRC ativo para direcionar o número.' });
      operatorName = operatorRows[0].name;
      const instanceClinicId = Number(clinic?.id || req.body.clinic_id || 0);
      await ensureWhatsAppOperatorClinicLink(operatorId, instanceClinicId, req.user);
    }

    const displayName = sanitizeFinancialString(req.body.display_name || req.body.displayName || currentRows[0].display_name || instanceName);
    const clinicId = clinic?.id || req.body.clinic_id || null;
    const clinicName = clinic?.name || sanitizeFinancialString(req.body.clinic_name || currentRows[0].clinic_name);
    const unitName = sanitizeFinancialString(req.body.unit_name || req.body.unitName || currentRows[0].unit_name) || clinic?.city || null;
    const notes = sanitizeFinancialString(req.body.notes, 2000);
    const actorName = getActorName(req.user);

    await pool.query(
      `UPDATE whatsapp_instances
          SET display_name = ?,
              sector = ?,
              clinic_id = ?,
              clinic_name = ?,
              unit_name = ?,
              phone_number = ?,
              operator_id = ?,
              operator_name = ?,
              notes = ?,
              updated_by = ?
        WHERE instance_name = ?`,
      [
        displayName,
        sanitizeFinancialString(req.body.sector || currentRows[0].sector || 'CRC', 80),
        clinicId,
        clinicName,
        unitName,
        phone,
        operatorId,
        operatorName,
        notes,
        actorName,
        instanceName
      ]
    );

    await pool.query(
      `UPDATE whatsapp_service_sessions
          SET display_name = ?,
              clinic_id = ?,
              clinic_name = ?,
              unit_name = ?,
              phone_number = ?,
              notes = ?,
              updated_by = ?
        WHERE session_id = ?`,
      [displayName, clinicId, clinicName, unitName, phone, notes, actorName, instanceName]
    );

    const [rows] = await pool.query('SELECT * FROM whatsapp_instances WHERE instance_name = ? LIMIT 1', [instanceName]);
    emitWhatsAppDashboardRefresh('instance_updated', { instanceName });
    return res.json({ success: true, instance: rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar número WhatsApp.' });
  }
}

async function handleUpdateWhatsAppInstanceAssignment(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode direcionar números WhatsApp.' });
    }

    const instanceName = normalizeEvolutionInstanceName(req.params.instanceName);
    const operatorId = Number(req.body.operator_id || req.body.operatorId || 0);
    let operator = null;

    if (operatorId) {
      const [rows] = await pool.query(
        `SELECT id, name, role
           FROM users
          WHERE id = ?
            AND ${buildWhatsAppOperatorRoleWhere()}
            AND active = 1
            AND deleted_at IS NULL
          LIMIT 1`,
        [operatorId, ...getWhatsAppOperatorRoleParams()]
      );
      operator = rows[0] || null;
      if (!operator) return res.status(404).json({ error: 'Operador de CRC não encontrado ou inativo.' });
      const [instanceRows] = await pool.query('SELECT clinic_id FROM whatsapp_instances WHERE instance_name = ? LIMIT 1', [instanceName]);
      const instanceClinicId = Number(instanceRows[0]?.clinic_id || 0);
      await ensureWhatsAppOperatorClinicLink(operatorId, instanceClinicId, req.user);
    }

    await pool.query(
      `UPDATE whatsapp_instances
          SET operator_id = ?,
              operator_name = ?,
              updated_by = ?,
              updated_at = NOW()
        WHERE instance_name = ?`,
      [operator?.id || null, operator?.name || null, getActorName(req.user), instanceName]
    );

    await logEvolutionEvent('assign_instance_operator', {
      instanceName,
      status: 'info',
      response: { operatorId: operator?.id || null, operatorName: operator?.name || null, actor: getActorName(req.user) }
    });

    const [updated] = await pool.query('SELECT * FROM whatsapp_instances WHERE instance_name = ? LIMIT 1', [instanceName]);
    emitWhatsAppDashboardRefresh('instance_assignment', { instanceName, operatorId: operator?.id || null });
    return res.json(updated[0] || { success: true });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao direcionar número WhatsApp.' });
  }
}

async function handleWhatsAppInstanceQrCode(req, res) {
  const startedAt = performance.now();
  const instanceName = normalizeEvolutionInstanceName(req.params.instanceName);
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode gerar QR Code de instância.' });
    }

    const [rows] = await pool.query('SELECT phone_number FROM whatsapp_instances WHERE instance_name = ? LIMIT 1', [instanceName]);
    if (isWhatsAppServiceProviderConfigured()) {
      const currentStatusPayload = await whatsappVpsService.getSessionStatus(instanceName).catch(() => null);
      const currentStatus = mapWhatsAppServiceStatus(currentStatusPayload, '');
      if (currentStatus === 'conectado') {
        await pool.query(
          'UPDATE whatsapp_instances SET status = ?, last_status_check_at = NOW(), updated_by = ? WHERE instance_name = ?',
          ['conectado', getActorName(req.user), instanceName]
        );
        await pool.query(
          `UPDATE whatsapp_service_sessions
              SET status = 'conectado',
                  last_status_payload = ?,
                  last_status_check_at = NOW(),
                  updated_by = ?
            WHERE session_id = ?`,
          [JSON.stringify(currentStatusPayload || { status: 'conectado' }), getActorName(req.user), instanceName]
        );
        return res.json({
          provider: 'whatsapp_service',
          connected: true,
          status: 'conectado',
          base64: null,
          qrcode: null,
          message: 'Este WhatsApp ja esta conectado. O QR Code so e exibido quando a sessao precisa de pareamento.',
          qrImageUrl: whatsappVpsService.getQrImageUrl(instanceName, {
            baseURL: process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL
          })
        });
      }

      const serviceResponse = await whatsappVpsService.createSession(instanceName, {
        phone: rows[0]?.phone_number || null,
        source: 'qrcode_button',
        ...getWhatsAppServiceWebhookConfig()
      });
      const image = await whatsappVpsService.waitForQrImage(instanceName, {
        baseURL: process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL,
        attempts: Number(process.env.WHATSAPP_QR_ATTEMPTS || 6),
        delayMs: Number(process.env.WHATSAPP_QR_RETRY_DELAY_MS || 2500)
      });
      const data = {
        provider: 'whatsapp_service',
        base64: `data:${image.contentType};base64,${image.bytes.toString('base64')}`,
        source: image.source || 'whatsapp_service',
        qrImageUrl: whatsappVpsService.getQrImageUrl(instanceName, {
          baseURL: process.env.WHATSAPP_API_URL || process.env.WHATSAPP_SERVICE_BASE_URL || WHATSAPP_SERVICE_DEFAULT_BASE_URL
        }),
        service: serviceResponse
      };
      await pool.query(
        'UPDATE whatsapp_instances SET status = ?, last_status_check_at = NOW(), updated_by = ? WHERE instance_name = ?',
        ['aguardando_qrcode', getActorName(req.user), instanceName]
      );
      await pool.query(
        `UPDATE whatsapp_service_sessions
            SET status = 'aguardando_qrcode',
                last_status_check_at = NOW(),
                updated_by = ?
          WHERE session_id = ?`,
        [getActorName(req.user), instanceName]
      );
      await logEvolutionEvent('generate_whatsapp_service_qrcode', {
        instanceName,
        status: 'success',
        durationMs: performance.now() - startedAt,
        request: { sessionId: instanceName },
        response: { contentType: image.contentType, bytes: image.bytes.length }
      });
      emitWhatsAppDashboardRefresh('qrcode_generated', { instanceName });
      return res.json(data);
    }

    const data = await evolutionService.connectInstance(instanceName, rows[0]?.phone_number || req.query.number || '', await getEvolutionServiceConfig());
    await pool.query(
      'UPDATE whatsapp_instances SET status = ?, last_status_check_at = NOW(), updated_by = ? WHERE instance_name = ?',
      ['aguardando_qrcode', getActorName(req.user), instanceName]
    );
    await logEvolutionEvent('generate_qrcode', {
      instanceName,
      status: 'success',
      durationMs: performance.now() - startedAt,
      request: { instanceName },
      response: data
    });
    emitWhatsAppDashboardRefresh('qrcode_generated', { instanceName });
    return res.json(data);
  } catch (error) {
    console.error(error);
    await logEvolutionEvent('generate_qrcode', {
      instanceName,
      status: error.code === 'ECONNABORTED' ? 'timeout' : 'error',
      durationMs: performance.now() - startedAt,
      request: { instanceName },
      error
    });
    return res.status(502).json({ error: whatsappVpsService.friendlyApiError(error) || 'Erro ao gerar QR Code.' });
  }
}

async function handleWhatsAppInstanceStatus(req, res) {
  const startedAt = performance.now();
  const instanceName = normalizeEvolutionInstanceName(req.params.instanceName);
  try {
    if (isWhatsAppServiceProviderConfigured()) {
      const data = await whatsappVpsService.getSessionStatus(instanceName);
      const status = mapWhatsAppServiceStatus(data);
      await pool.query(
        `UPDATE whatsapp_instances
            SET status = ?,
                last_connection_at = CASE WHEN ? = 'conectado' THEN NOW() ELSE last_connection_at END,
                uptime_started_at = CASE WHEN ? = 'conectado' AND uptime_started_at IS NULL THEN NOW() WHEN ? <> 'conectado' THEN NULL ELSE uptime_started_at END,
                last_status_check_at = NOW(),
                updated_by = ?
          WHERE instance_name = ?`,
        [status, status, status, status, getActorName(req.user), instanceName]
      );
      await pool.query(
        `UPDATE whatsapp_service_sessions
            SET status = ?,
                last_status_payload = ?,
                last_status_check_at = NOW(),
                updated_by = ?
          WHERE session_id = ?`,
        [status, JSON.stringify(data), getActorName(req.user), instanceName]
      );
      await logEvolutionEvent('whatsapp_service_status', {
        instanceName,
        status: 'success',
        durationMs: performance.now() - startedAt,
        request: { sessionId: instanceName },
        response: { status, service: data }
      });
      emitWhatsAppDashboardRefresh('connection_status', { instanceName, status });
      return res.json({ status, provider: 'whatsapp_service', service: data });
    }

    const data = await evolutionService.getConnectionState(instanceName, await getEvolutionServiceConfig());
    const status = mapEvolutionConnectionStatus(data);
    await pool.query(
      `UPDATE whatsapp_instances
          SET status = ?,
              last_connection_at = CASE WHEN ? = 'conectado' THEN NOW() ELSE last_connection_at END,
              uptime_started_at = CASE WHEN ? = 'conectado' AND uptime_started_at IS NULL THEN NOW() WHEN ? <> 'conectado' THEN NULL ELSE uptime_started_at END,
              last_status_check_at = NOW(),
              updated_by = ?
        WHERE instance_name = ?`,
      [status, status, status, status, getActorName(req.user), instanceName]
    );
    await logEvolutionEvent('connection_status', {
      instanceName,
      status: 'success',
      durationMs: performance.now() - startedAt,
      request: { instanceName },
      response: { status, evolution: data }
    });
    emitWhatsAppDashboardRefresh('connection_status', { instanceName, status });
    return res.json({ status, evolution: data });
  } catch (error) {
    console.error(error);
    await logEvolutionEvent('connection_status', {
      instanceName,
      status: error.code === 'ECONNABORTED' ? 'timeout' : 'error',
      durationMs: performance.now() - startedAt,
      request: { instanceName },
      error
    });
    return res.status(502).json({ error: error.response?.data?.message || error.message || 'Erro ao verificar status.' });
  }
}

async function handleWhatsAppInstanceReconnect(req, res) {
  const startedAt = performance.now();
  const instanceName = normalizeEvolutionInstanceName(req.params.instanceName);
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode reconectar instâncias.' });
    }

    if (isWhatsAppServiceProviderConfigured()) {
      let data = null;
      let warning = null;
      try {
        data = await whatsappVpsService.createSession(instanceName, { source: 'reconnect', ...getWhatsAppServiceWebhookConfig() });
      } catch (error) {
        warning = whatsappVpsService.friendlyApiError(error);
      }
      await pool.query(
        'UPDATE whatsapp_instances SET status = ?, notes = NULL, updated_by = ?, last_status_check_at = NOW() WHERE instance_name = ?',
        ['iniciando', getActorName(req.user), instanceName]
      );
      await pool.query(
        'UPDATE whatsapp_service_sessions SET status = ?, updated_by = ?, last_status_check_at = NOW() WHERE session_id = ?',
        ['iniciando', getActorName(req.user), instanceName]
      );
      await logEvolutionEvent('whatsapp_service_reconnect', {
        instanceName,
        status: warning ? 'warning' : 'success',
        durationMs: performance.now() - startedAt,
        request: { sessionId: instanceName },
        response: data,
        error: warning ? new Error(warning) : null
      });
      emitWhatsAppDashboardRefresh('reconnect', { instanceName });
      return res.json({ success: true, provider: 'whatsapp_service', service: data, warning });
    }

    let data = null;
    try {
      data = await evolutionService.restartInstance(instanceName, await getEvolutionServiceConfig());
    } catch (error) {
      await logEvolutionEvent('reconnect', {
        instanceName,
        status: error.code === 'ECONNABORTED' ? 'timeout' : 'error',
        durationMs: performance.now() - startedAt,
        request: { instanceName },
        error
      });
      throw error;
    }
    await pool.query(
      'UPDATE whatsapp_instances SET status = ?, updated_by = ?, last_status_check_at = NOW() WHERE instance_name = ?',
      ['reconectando', getActorName(req.user), instanceName]
    );
    await logEvolutionEvent('reconnect', {
      instanceName,
      status: 'success',
      durationMs: performance.now() - startedAt,
      request: { instanceName },
      response: data
    });
    emitWhatsAppDashboardRefresh('reconnect', { instanceName });
    return res.json({ success: true, evolution: data });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: error.response?.data?.message || error.message || 'Erro ao reconectar instância.' });
  }
}

async function handleWhatsAppInstanceLogout(req, res) {
  const startedAt = performance.now();
  const instanceName = normalizeEvolutionInstanceName(req.params.instanceName);
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode desconectar instâncias.' });
    }

    if (isWhatsAppServiceProviderConfigured()) {
      let data = null;
      let warning = null;
      try {
        data = await whatsappVpsService.disconnectSession(instanceName);
      } catch (error) {
        warning = whatsappVpsService.friendlyApiError(error);
      }
      await pool.query(
        'UPDATE whatsapp_instances SET status = ?, updated_by = ?, last_status_check_at = NOW() WHERE instance_name = ?',
        ['desconectado', getActorName(req.user), instanceName]
      );
      await pool.query(
        'UPDATE whatsapp_service_sessions SET status = ?, updated_by = ?, last_status_check_at = NOW() WHERE session_id = ?',
        ['desconectado', getActorName(req.user), instanceName]
      );
      await logEvolutionEvent('whatsapp_service_logout', {
        instanceName,
        status: warning ? 'warning' : 'success',
        durationMs: performance.now() - startedAt,
        request: { sessionId: instanceName },
        response: data || { localStatusOnly: true },
        error: warning ? new Error(warning) : null
      });
      emitWhatsAppDashboardRefresh('logout_instance', { instanceName });
      return res.json({
        success: true,
        provider: 'whatsapp_service',
        service: data,
        warning: warning || null
      });
    }

    let warning = null;
    try {
      await evolutionService.logoutInstance(instanceName, await getEvolutionServiceConfig());
    } catch (error) {
      warning = error.response?.data?.message || error.message;
      await logEvolutionEvent('logout_instance', {
        instanceName,
        status: error.code === 'ECONNABORTED' ? 'timeout' : 'error',
        durationMs: performance.now() - startedAt,
        request: { instanceName },
        error
      });
    }
    await pool.query(
      'UPDATE whatsapp_instances SET status = ?, updated_by = ?, last_status_check_at = NOW() WHERE instance_name = ?',
      ['desconectado', getActorName(req.user), instanceName]
    );
    if (!warning) {
      await logEvolutionEvent('logout_instance', {
        instanceName,
        status: 'success',
        durationMs: performance.now() - startedAt,
        request: { instanceName }
      });
    }
    emitWhatsAppDashboardRefresh('logout_instance', { instanceName });
    return res.json({ success: true, warning });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao desconectar instância.' });
  }
}

async function handleDeleteWhatsAppInstance(req, res) {
  const startedAt = performance.now();
  const instanceName = normalizeEvolutionInstanceName(req.params.instanceName);
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode excluir instâncias.' });
    }

    if (isWhatsAppServiceProviderConfigured()) {
      await pool.query('DELETE FROM whatsapp_instances WHERE instance_name = ?', [instanceName]);
      await pool.query('DELETE FROM whatsapp_service_sessions WHERE session_id = ?', [instanceName]);
      await logEvolutionEvent('whatsapp_service_delete_instance', {
        instanceName,
        status: 'success',
        durationMs: performance.now() - startedAt,
        request: { sessionId: instanceName },
        response: { localDelete: true }
      });
      emitWhatsAppDashboardRefresh('delete_instance', { instanceName });
      return res.json({ success: true, provider: 'whatsapp_service', warning: 'Cadastro excluído do sistema. Se precisar remover a sessão na VPS, faça pelo painel do serviço.' });
    }

    let warning = null;
    try {
      await evolutionService.deleteInstance(instanceName, await getEvolutionServiceConfig());
    } catch (error) {
      warning = error.response?.data?.message || error.message;
      await logEvolutionEvent('delete_instance', {
        instanceName,
        status: error.code === 'ECONNABORTED' ? 'timeout' : 'error',
        durationMs: performance.now() - startedAt,
        request: { instanceName },
        error
      });
    }
    await pool.query('DELETE FROM whatsapp_instances WHERE instance_name = ?', [instanceName]);
    if (!warning) {
      await logEvolutionEvent('delete_instance', {
        instanceName,
        status: 'success',
        durationMs: performance.now() - startedAt,
        request: { instanceName }
      });
    }
    emitWhatsAppDashboardRefresh('delete_instance', { instanceName });
    return res.json({ success: true, warning });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir instância.' });
  }
}

async function handleGetWhatsAppTemplates(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM whatsapp_templates ORDER BY status ASC, category ASC, title ASC');
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar mensagens padrão.' });
  }
}

async function handleCreateWhatsAppTemplate(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode criar mensagens padrão.' });
    }
    const title = sanitizeFinancialString(req.body.title);
    const messageText = String(req.body.message_text || req.body.messageText || '').trim();
    if (!title || !messageText) return res.status(400).json({ error: 'Informe título e texto da mensagem.' });
    const [result] = await pool.query(
      `INSERT INTO whatsapp_templates
       (title, category, sector, message_text, variables, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        sanitizeFinancialString(req.body.category, 120),
        sanitizeFinancialString(req.body.sector || 'CRC', 80),
        messageText,
        normalizeWhatsAppVariables(req.body.variables),
        normalizeWhatsAppStatus(req.body.status || 'ativo', 'ativo'),
        getActorName(req.user),
        getActorName(req.user)
      ]
    );
    const [rows] = await pool.query('SELECT * FROM whatsapp_templates WHERE id = ? LIMIT 1', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao salvar mensagem padrão.' });
  }
}

async function handleUpdateWhatsAppTemplate(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode editar mensagens padrão.' });
    }
    await pool.query(
      `UPDATE whatsapp_templates
          SET title = ?,
              category = ?,
              sector = ?,
              message_text = ?,
              variables = ?,
              status = ?,
              updated_by = ?
        WHERE id = ?`,
      [
        sanitizeFinancialString(req.body.title),
        sanitizeFinancialString(req.body.category, 120),
        sanitizeFinancialString(req.body.sector || 'CRC', 80),
        String(req.body.message_text || req.body.messageText || '').trim(),
        normalizeWhatsAppVariables(req.body.variables),
        normalizeWhatsAppStatus(req.body.status || 'ativo', 'ativo'),
        getActorName(req.user),
        req.params.id
      ]
    );
    const [rows] = await pool.query('SELECT * FROM whatsapp_templates WHERE id = ? LIMIT 1', [req.params.id]);
    return res.json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar mensagem padrão.' });
  }
}

async function handleSendWhatsAppManagementMessage(req, res, options = {}) {
  try {
    const messageText = String(req.body.message_text || req.body.message || '').trim();
    if (!messageText) return res.status(400).json({ error: 'Informe a mensagem para envio.' });
    const clientRequestId = sanitizeFinancialString(req.body.client_request_id || req.body.clientRequestId, 120);

    const phone = normalizeWhatsAppPhone(req.body.patient_phone || req.body.phone || req.body.to);
    if (!phone) return res.status(400).json({ error: 'Número inválido. Use DDI e DDD. Exemplo: 5562999999999.' });

    const defaultInstance = await getDefaultWhatsAppInstance(req.user);
    const instanceName = sanitizeFinancialString(
      req.body.instance_name
      || req.body.instanceName
      || req.body.sessionId
      || req.body.session_id
      || defaultInstance?.instance_name
    );
    if (!instanceName) return res.status(400).json({ error: 'Selecione uma instância WhatsApp para envio.' });

    const [instanceRows] = await pool.query('SELECT status, display_name FROM whatsapp_instances WHERE instance_name = ? LIMIT 1', [instanceName]);
    const instanceStatus = String(instanceRows[0]?.status || '').toLowerCase();
    if (instanceStatus === 'reconectar' || instanceStatus === 'desconectado' || instanceStatus === 'aguardando_qrcode') {
      return res.status(409).json({
        success: false,
        requiresReconnect: true,
        instanceName,
        error: `A sessão ${instanceRows[0]?.display_name || instanceName} está com status "${instanceRows[0]?.status}". Reconecte o número antes de enviar.`
      });
    }

    if (clientRequestId) {
      const existingByRequestId = await findWhatsAppMessageByClientRequestId(clientRequestId);
      if (existingByRequestId) {
        return res.json({
          success: true,
          queued: true,
          duplicateSuppressed: true,
          messageId: existingByRequestId.id,
          conversationId: existingByRequestId.conversation_id || null,
          provider: 'whatsapp_dispatch_queue'
        });
      }
    }

    const duplicateMessage = await findRecentDuplicateWhatsAppMessage({
      instanceName,
      patientPhone: phone,
      messageText,
      messageType: options.messageType || req.body.message_type || 'manual',
      maxAgeSeconds: 45
    });
    if (duplicateMessage) {
      return res.json({
        success: true,
        queued: false,
        duplicateSuppressed: true,
        messageId: duplicateMessage.id,
        conversationId: duplicateMessage.conversation_id || null,
        provider: 'whatsapp_service'
      });
    }

    const conversation = await findOrCreateWhatsAppConversation({
      ...req.body,
      patient_phone: phone,
      patient_name: normalizeWhatsAppPatientName(req.body.patient_name || req.body.patientName || ''),
      instance_name: instanceName,
      status: req.body.status || 'Em atendimento'
    }, req.user);

    const messageId = await insertWhatsAppMessage({
      conversation_id: conversation.id,
      instance_name: instanceName,
      patient_phone: phone,
      direction: 'outbound',
      message_text: messageText,
      message_type: options.messageType || req.body.message_type || 'manual',
      status: 'pendente',
      operator_id: req.user?.id || null,
      operator_name: getActorName(req.user),
      clinic_id: conversation.clinic_id,
      clinic_name: conversation.clinic_name,
      campaign: conversation.campaign,
      client_request_id: clientRequestId
    });

    await pool.query(
      `UPDATE whatsapp_conversations
          SET last_message_at = NOW(),
              status = CASE WHEN status = 'Novo' THEN 'Em atendimento' ELSE status END,
              operator_id = COALESCE(operator_id, ?),
              assigned_operator_id = COALESCE(assigned_operator_id, ?),
              operator_name = COALESCE(operator_name, ?),
              instance_name = ?,
              session_id = ?
        WHERE id = ?`,
      [req.user?.id || null, req.user?.id || null, getActorName(req.user), instanceName, instanceName, conversation.id]
    );

    const updatedConversation = await getWhatsAppConversationById(conversation.id);
    await syncWhatsAppAttendanceQueue(updatedConversation, updatedConversation.operator_id ? 'em_atendimento' : 'aguardando');
    const message = await getWhatsAppMessageById(messageId);
    emitWhatsAppConversationChange('message_pending', updatedConversation);
    emitWhatsAppMessageChange('pending', message, updatedConversation);

    const dispatch = await enqueueWhatsAppDispatch({
      message_id: messageId,
      conversation_id: conversation.id,
      instance_name: instanceName,
      recipient_phone: phone,
      message_text: messageText,
      message_type: options.messageType || req.body.message_type || 'manual',
      operator_id: req.user?.id || null,
      operator_name: getActorName(req.user),
      scheduleDelaySeconds: 0,
      payload: {
        source: 'manual_send',
        clientRequestId
      }
    });
    processWhatsAppDispatchQueue().catch((jobError) => {
      console.warn('Nao foi possivel processar imediatamente a fila de disparo WhatsApp:', jobError.message);
    });

    return res.json({
      success: true,
      queued: true,
      queueId: dispatch?.id || null,
      messageId,
      conversationId: conversation.id,
      provider: 'whatsapp_dispatch_queue'
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao enviar mensagem WhatsApp.' });
  }
}

async function handleSendWhatsAppTemplate(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM whatsapp_templates WHERE id = ? LIMIT 1', [req.body.template_id || req.body.templateId]);
    if (!rows[0]) return res.status(404).json({ error: 'Mensagem padrão não encontrada.' });
    req.body.message_text = renderWhatsAppTemplateText(rows[0].message_text, req.body.variables || {});
    req.body.message_type = 'template';
    return handleSendWhatsAppManagementMessage(req, res, { messageType: 'template' });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao enviar mensagem padrão.' });
  }
}

async function handleDeleteWhatsAppMessage(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM whatsapp_messages WHERE id = ? LIMIT 1', [req.params.id]);
    const message = rows[0];
    if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    const conversation = message.conversation_id ? await getWhatsAppConversationById(message.conversation_id) : null;
    if (conversation?.clinic_id) {
      await assertCrcOperatorClinicAccess(req.user, conversation.clinic_id);
    }
    const ownsConversation = conversation?.operator_id && Number(conversation.operator_id) === Number(req.user?.id);
    const ownsMessage = message.operator_id && Number(message.operator_id) === Number(req.user?.id);
    if (!canViewAllWhatsAppAttendance(req.user) && !ownsMessage && !ownsConversation) {
      return res.status(403).json({ error: 'Você só pode apagar mensagens sob sua responsabilidade.' });
    }

    let warning = null;
    if (message.evolution_message_id && message.instance_name) {
      try {
        await evolutionService.deleteMessage(message.instance_name, {
          id: message.evolution_message_id,
          remoteJid: `${message.patient_phone}@s.whatsapp.net`,
          fromMe: message.direction === 'outbound'
        }, await getEvolutionServiceConfig());
      } catch (error) {
        warning = evolutionService.friendlyApiError(error);
        await logEvolutionEvent('delete_message', {
          instanceName: message.instance_name,
          messageId: message.id,
          conversationId: message.conversation_id,
          status: 'error',
          error
        });
      }
    }

    await pool.query(
      `UPDATE whatsapp_messages
          SET status = 'apagada',
              deleted_at = NOW(),
              error_message = ?
        WHERE id = ?`,
      [warning, message.id]
    );
    const updatedMessage = await getWhatsAppMessageById(message.id);
    emitWhatsAppMessageChange('deleted', updatedMessage, conversation || {});
    return res.json({ success: true, warning });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao apagar mensagem.' });
  }
}

async function handleResendWhatsAppMessage(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM whatsapp_messages WHERE id = ? LIMIT 1', [req.params.id]);
    const message = rows[0];
    if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    const conversation = message.conversation_id ? await getWhatsAppConversationById(message.conversation_id) : null;
    if (conversation?.clinic_id) {
      await assertCrcOperatorClinicAccess(req.user, conversation.clinic_id);
    }
    if (!canViewAllWhatsAppAttendance(req.user) && Number(conversation?.operator_id || message.operator_id) !== Number(req.user?.id)) {
      return res.status(403).json({ error: 'Você só pode reenviar mensagens sob sua responsabilidade.' });
    }

    const sessionId = message.instance_name || conversation?.instance_name;
    const phone = normalizeWhatsAppPhone(message.patient_phone || conversation?.patient_phone);
    const text = String(message.message_text || '').trim();
    if (!sessionId || !phone || !text) return res.status(400).json({ error: 'Mensagem sem sessão, telefone ou texto para reenvio.' });

    await pool.query(
      `UPDATE whatsapp_messages
          SET status = 'pendente',
              error_message = NULL,
              updated_at = NOW()
        WHERE id = ?`,
      [message.id]
    );
    emitWhatsAppMessageChange('resend_pending', await getWhatsAppMessageById(message.id), conversation || {});

    try {
      const providerResponse = await whatsappProvider.sendText({ sessionId, number: phone, message: text });
      const providerMessageId = providerResponse.messageId || null;
      await pool.query(
        `UPDATE whatsapp_messages
            SET status = 'enviada',
                evolution_message_id = ?,
                whatsapp_message_id = ?,
                sent_at = NOW(),
                error_message = NULL,
                updated_at = NOW()
          WHERE id = ?`,
        [providerMessageId, providerMessageId, message.id]
      );
      const updatedMessage = await getWhatsAppMessageById(message.id);
      emitWhatsAppMessageChange('resent', updatedMessage, conversation || {});
      return res.json({ success: true, message: updatedMessage, providerMessageId });
    } catch (error) {
      const friendlyError = whatsappProvider.friendlyApiError(error);
      await pool.query(
        `UPDATE whatsapp_messages
            SET status = 'erro',
                error_message = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [friendlyError, message.id]
      );
      const updatedMessage = await getWhatsAppMessageById(message.id);
      emitWhatsAppMessageChange('resend_error', updatedMessage, conversation || {});
      return res.status(502).json({ success: false, error: friendlyError || 'Erro ao reenviar mensagem.' });
    }
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao reenviar mensagem WhatsApp.' });
  }
}

async function handleGetWhatsAppConversations(req, res) {
  try {
    const scope = buildWhatsAppScopeWhere(req.user, 'c');
    const where = [scope.clause];
    const params = [...scope.params];
    if (req.query.status) {
      where.push('c.status = ?');
      params.push(req.query.status);
    }
    if (req.query.search) {
      where.push('(c.patient_name LIKE ? OR c.patient_phone LIKE ? OR c.clinic_name LIKE ? OR c.protocol LIKE ? OR c.operator_name LIKE ?)');
      const search = `%${req.query.search}%`;
      params.push(search, search, search, search, search);
    }
    const limit = Math.min(300, Math.max(20, Number(req.query.limit || 120)));
    const [rows] = await pool.query(
      `SELECT c.*,
              (SELECT message_text FROM whatsapp_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_text
         FROM whatsapp_conversations c
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC
        LIMIT ${limit}`,
      params
    );
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar atendimentos WhatsApp.' });
  }
}

async function handleGetWhatsAppQueue(req, res) {
  try {
    const scope = buildQueueScopeWhere(req.user, 'q');
    const [rows] = await pool.query(
      `SELECT q.*, c.status AS conversation_status, c.last_message_at, c.next_follow_up_at
         FROM whatsapp_attendance_queue q
         LEFT JOIN whatsapp_conversations c ON c.id = q.conversation_id
        WHERE ${scope.clause}
          AND q.status <> 'encerrado'
        ORDER BY q.priority DESC, q.queued_at ASC
        LIMIT 300`,
      scope.params
    );
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar fila de atendimento WhatsApp.' });
  }
}

async function handleGetWhatsAppOperators(req, res) {
  try {
    const operatorWhere = [];
    const operatorParams = [...getWhatsAppOperatorRoleParams()];
    if (isCrcOperatorUser(req.user)) {
      operatorWhere.push('u.id = ?');
      operatorParams.push(req.user.id || 0);
    }
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.email, u.role,
              COALESCE(s.status, 'online') AS operator_status,
              s.reason AS operator_reason,
              s.updated_at AS operator_status_updated_at
         FROM users u
         LEFT JOIN whatsapp_operator_status s ON s.user_id = u.id
        WHERE u.active = 1
          AND u.deleted_at IS NULL
          AND ${buildWhatsAppOperatorRoleWhere('u')}
          ${operatorWhere.length ? `AND ${operatorWhere.join(' AND ')}` : ''}
        ORDER BY u.name ASC`,
      operatorParams
    );
    const enriched = [];
    for (const user of users) {
      const capacity = await getWhatsAppOperatorCapacity(user.id);
      const [clinicRows] = await pool.query(
        `SELECT c.id, c.name, c.city, c.state
           FROM user_clinics uc
           INNER JOIN clinics c ON c.id = uc.clinic_id
          WHERE uc.user_id = ?
            AND c.active = 1
          ORDER BY c.name ASC`,
        [user.id]
      );
      enriched.push({
        ...user,
        ...capacity,
        clinicIds: clinicRows.map((clinic) => Number(clinic.id)),
        clinics: clinicRows
      });
    }
    return res.json(enriched);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar operadores WhatsApp.' });
  }
}

async function handleUpdateWhatsAppOperatorClinics(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode vincular clínicas ao Operador CRC.' });
    }

    const operatorId = Number(req.params.id || 0);
    const [operatorRows] = await pool.query(
      `SELECT id, name
         FROM users
        WHERE id = ?
          AND ${buildWhatsAppOperatorRoleWhere()}
          AND active = 1
          AND deleted_at IS NULL
        LIMIT 1`,
      [operatorId, ...getWhatsAppOperatorRoleParams()]
    );
    if (!operatorRows[0]) return res.status(404).json({ error: 'Operador CRC não encontrado.' });

    const clinicIds = Array.isArray(req.body.clinicIds)
      ? req.body.clinicIds.map((clinicId) => Number(clinicId)).filter((clinicId) => Number.isInteger(clinicId) && clinicId > 0)
      : [];

    await pool.query('DELETE FROM user_clinics WHERE user_id = ?', [operatorId]);
    if (clinicIds.length) {
      await Promise.all(clinicIds.map((clinicId) => (
        pool.query('INSERT INTO user_clinics (user_id, clinic_id, can_edit) VALUES (?, ?, 1)', [operatorId, clinicId])
      )));
    }

    await createNotification(
      operatorId,
      'whatsapp_operator_clinics',
      'Clínicas atualizadas',
      'Suas clínicas de atendimento no WhatsApp CRC foram atualizadas.',
      '/home/whatsapp-management/attendance',
      { clinicIds }
    );

    return res.json({ success: true, clinicIds });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar clínicas do operador.' });
  }
}

async function handleGetWhatsAppOperatorStatus(req, res) {
  try {
    const targetUserId = Number(req.query.userId || req.user?.id || 0);
    if (!targetUserId) return res.status(400).json({ error: 'Usuário não identificado.' });
    if (targetUserId !== Number(req.user?.id) && !canViewAllWhatsAppAttendance(req.user)) {
      return res.status(403).json({ error: 'Você só pode visualizar seu próprio status.' });
    }
    const [rows] = await pool.query('SELECT * FROM whatsapp_operator_status WHERE user_id = ? LIMIT 1', [targetUserId]);
    return res.json(rows[0] || {
      user_id: targetUserId,
      operator_name: targetUserId === Number(req.user?.id) ? getActorName(req.user) : null,
      status: 'online',
      reason: null,
      auto_reply_message: null
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar status do operador.' });
  }
}

async function handleUpdateWhatsAppOperatorStatus(req, res) {
  try {
    const allowedStatuses = new Set(['online', 'almoco', 'treinamento', 'reuniao', 'ausente', 'offline', 'pausa']);
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!allowedStatuses.has(status)) return res.status(400).json({ error: 'Status de operador inválido.' });

    const targetUserId = Number(req.body.userId || req.body.user_id || req.user?.id || 0);
    if (!targetUserId) return res.status(400).json({ error: 'Usuário não identificado.' });
    if (targetUserId !== Number(req.user?.id) && !canViewAllWhatsAppAttendance(req.user)) {
      return res.status(403).json({ error: 'Você só pode alterar seu próprio status.' });
    }
    const operator = await getWhatsAppOperatorById(targetUserId);
    if (!operator) return res.status(404).json({ error: 'Operador não encontrado.' });
    const autoReply = String(req.body.autoReplyMessage || req.body.auto_reply_message || '').trim()
      || 'No momento estou ausente. Seu atendimento foi mantido na fila e retornaremos em breve.';

    await pool.query(
      `INSERT INTO whatsapp_operator_status
       (user_id, operator_name, status, reason, auto_reply_message, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         operator_name = VALUES(operator_name),
         status = VALUES(status),
         reason = VALUES(reason),
         auto_reply_message = VALUES(auto_reply_message),
         updated_by = VALUES(updated_by)`,
      [
        operator.id,
        operator.name,
        status,
        sanitizeFinancialString(req.body.reason || status, 120),
        autoReply,
        getActorName(req.user)
      ]
    );

    if (status !== 'online') {
      await pool.query(
        `UPDATE whatsapp_conversations
            SET operator_id = NULL,
                assigned_operator_id = NULL,
                operator_name = NULL,
                assignment_source = 'ausencia_operador',
                status = CASE WHEN status = 'Encerrado' THEN status ELSE 'Aguardando operador' END
          WHERE operator_id = ?
            AND status NOT IN ('Encerrado', 'Compareceu', 'Não compareceu', 'Ausente')`,
        [operator.id]
      );
      const [affectedConversations] = await pool.query(
        `SELECT * FROM whatsapp_conversations
          WHERE assignment_source = 'ausencia_operador'
          ORDER BY updated_at DESC
          LIMIT 50`
      );
      for (const conversation of affectedConversations.filter((item) => !item.operator_id)) {
        await syncWhatsAppAttendanceQueue(conversation, 'aguardando');
      }
    }

    const [rows] = await pool.query('SELECT * FROM whatsapp_operator_status WHERE user_id = ? LIMIT 1', [operator.id]);
    emitWhatsAppDashboardRefresh('operator_status_changed', { userId: operator.id, status });
    return res.json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar status do operador.' });
  }
}

async function handleClaimWhatsAppConversation(req, res) {
  try {
    const conversation = await getWhatsAppConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Atendimento não encontrado.' });
    await assertCrcOperatorClinicAccess(req.user, conversation.clinic_id);
    if (conversation.operator_id && Number(conversation.operator_id) !== Number(req.user?.id) && !canViewAllWhatsAppAttendance(req.user)) {
      return res.status(409).json({ error: 'Este atendimento já possui operador responsável.' });
    }
    const operator = await getWhatsAppOperatorById(req.user.id);
    if (!operator) return res.status(404).json({ error: 'Operador não encontrado.' });
    const updated = await assignWhatsAppConversation(conversation.id, operator, req.user, 'assumido');
    return res.json({ success: true, conversation: updated });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 400).json({ error: error.message || 'Erro ao assumir atendimento.', details: error.details || null });
  }
}

async function handleTransferWhatsAppConversation(req, res) {
  try {
    const conversation = await getWhatsAppConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Atendimento não encontrado.' });
    await assertCrcOperatorClinicAccess(req.user, conversation.clinic_id);
    if (!canViewAllWhatsAppAttendance(req.user) && Number(conversation.operator_id) !== Number(req.user?.id)) {
      return res.status(403).json({ error: 'Você só pode transferir atendimentos sob sua responsabilidade.' });
    }

    const targetUserId = Number(req.body.operator_id || req.body.operatorId || 0);
    if (!targetUserId) {
      await pool.query(
        `UPDATE whatsapp_conversations
            SET operator_id = NULL,
                assigned_operator_id = NULL,
                operator_name = NULL,
                assignment_source = 'fila',
                status = CASE WHEN status = 'Encerrado' THEN status ELSE 'Aguardando operador' END
          WHERE id = ?`,
        [conversation.id]
      );
      const updated = await getWhatsAppConversationById(conversation.id);
      await syncWhatsAppAttendanceQueue(updated, 'aguardando');
      await logEvolutionEvent('transfer_to_queue', {
        status: 'info',
        conversationId: conversation.id,
        response: { actor: getActorName(req.user) }
      });
      emitWhatsAppConversationChange('transfer_to_queue', updated);
      return res.json({ success: true, conversation: updated });
    }

    const target = await getWhatsAppOperatorById(targetUserId);
    if (!target) return res.status(404).json({ error: 'Operador destino não encontrado ou inativo.' });
    const updated = await assignWhatsAppConversation(conversation.id, target, req.user, 'transferencia');
    return res.json({ success: true, conversation: updated });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 400).json({ error: error.message || 'Erro ao transferir atendimento.', details: error.details || null });
  }
}

async function handleAutoAssignWhatsAppQueue(req, res) {
  try {
    if (!canViewAllWhatsAppAttendance(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode executar distribuição automática.' });
    }

    const assigned = await autoAssignWhatsAppQueue(req.user);
    return res.json({ success: true, assigned });
  } catch (error) {
    console.error(error);
    return res.status(error.status || 400).json({ error: error.message || 'Erro ao executar fila automática.', details: error.details || null });
  }
}

async function handleCreateWhatsAppConversation(req, res) {
  try {
    const conversation = await findOrCreateWhatsAppConversation(req.body, req.user);
    await syncWhatsAppAttendanceQueue(conversation, conversation.operator_id ? 'em_atendimento' : 'aguardando');
    emitWhatsAppConversationChange('created', conversation);
    return res.status(201).json(conversation);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao criar atendimento.' });
  }
}

async function handleUpdateWhatsAppConversation(req, res) {
  try {
    const conversation = await getWhatsAppConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Atendimento não encontrado.' });
    if (!canViewAllWhatsAppAttendance(req.user) && Number(conversation.operator_id) !== Number(req.user?.id)) {
      return res.status(403).json({ error: 'Você só pode editar seus atendimentos.' });
    }
    const nextClinicId = req.body.clinic_id || conversation.clinic_id || null;
    await assertCrcOperatorClinicAccess(req.user, nextClinicId);
    const hasNextFollowUp = Object.prototype.hasOwnProperty.call(req.body, 'next_follow_up_at')
      || Object.prototype.hasOwnProperty.call(req.body, 'nextFollowUpAt');
    await pool.query(
      `UPDATE whatsapp_conversations
          SET patient_name = ?,
              clinic_id = ?,
              clinic_name = ?,
              unit_name = ?,
              campaign = ?,
              protocol = ?,
              source = ?,
              operator_id = ?,
              assigned_operator_id = ?,
              operator_name = ?,
              instance_name = ?,
              session_id = ?,
              phone = ?,
              status = ?,
              next_follow_up_at = ?,
              notes = ?
        WHERE id = ?`,
      [
        sanitizeFinancialString(req.body.patient_name || conversation.patient_name),
        nextClinicId,
        sanitizeFinancialString(req.body.clinic_name || conversation.clinic_name),
        sanitizeFinancialString(req.body.unit_name || conversation.unit_name),
        sanitizeFinancialString(req.body.campaign || conversation.campaign),
        sanitizeFinancialString(req.body.protocol || conversation.protocol, 60),
        sanitizeFinancialString(req.body.source || conversation.source),
        req.body.operator_id || conversation.operator_id || req.user?.id || null,
        req.body.operator_id || conversation.operator_id || req.user?.id || null,
        sanitizeFinancialString(req.body.operator_name || conversation.operator_name || getActorName(req.user)),
        sanitizeFinancialString(req.body.instance_name || conversation.instance_name),
        sanitizeFinancialString(req.body.instance_name || conversation.instance_name),
        conversation.patient_phone,
        normalizeWhatsAppStatus(req.body.status || conversation.status),
        hasNextFollowUp
          ? normalizeNullableMysqlDateTime(req.body.next_follow_up_at || req.body.nextFollowUpAt)
          : normalizeNullableMysqlDateTime(conversation.next_follow_up_at),
        sanitizeFinancialString(req.body.notes || conversation.notes, 2000),
        req.params.id
      ]
    );
    const updated = await getWhatsAppConversationById(req.params.id);
    await syncWhatsAppAttendanceQueue(updated, updated.status === 'Encerrado' ? 'encerrado' : (updated.operator_id ? 'em_atendimento' : 'aguardando'));
    if (updated.status === 'Encerrado' && conversation.status !== 'Encerrado') {
      try {
        await sendWhatsAppNpsInviteForConversation(updated, req.user);
      } catch (inviteError) {
        await logEvolutionEvent('nps_invite_error', {
          conversationId: updated.id,
          status: 'error',
          error: inviteError
        });
      }
    }
    emitWhatsAppConversationChange('updated', updated);
    return res.json(updated);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar atendimento.' });
  }
}

async function handleGetWhatsAppConversationMessages(req, res) {
  try {
    const conversation = await getWhatsAppConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Atendimento não encontrado.' });
    await assertCrcOperatorClinicAccess(req.user, conversation.clinic_id);
    if (!canViewAllWhatsAppAttendance(req.user) && Number(conversation.operator_id) !== Number(req.user?.id)) {
      return res.status(403).json({ error: 'Você só pode visualizar seus atendimentos.' });
    }
    await pool.query('UPDATE whatsapp_conversations SET unread_count = 0, updated_at = NOW() WHERE id = ?', [conversation.id]);
    const limit = Math.min(100, Math.max(20, Number(req.query.limit || 80)));
    const params = [req.params.id];
    const beforeId = Number(req.query.beforeId || req.query.before_id || 0);
    const beforeClause = beforeId > 0 ? 'AND id < ?' : '';
    if (beforeId > 0) params.push(beforeId);
    const [rows] = await pool.query(
      `SELECT *
         FROM whatsapp_messages
        WHERE conversation_id = ?
          ${beforeClause}
        ORDER BY id DESC
        LIMIT ${limit}`,
      params
    );
    rows.reverse();
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar mensagens.' });
  }
}

async function handleGetWhatsAppHistory(req, res) {
  try {
    const scope = buildWhatsAppScopeWhere(req.user, 'c');
    const dateFilter = buildDateFilter(req.query, 'm.created_at');
    const where = [scope.clause, ...dateFilter.where];
    const params = [...scope.params, ...dateFilter.params];
    if (req.query.status) {
      where.push('m.status = ?');
      params.push(req.query.status);
    }
    if (req.query.instanceName) {
      where.push('m.instance_name = ?');
      params.push(req.query.instanceName);
    }
    if (req.query.clinicId) {
      where.push('c.clinic_id = ?');
      params.push(req.query.clinicId);
    }
    if (req.query.operatorId) {
      where.push('c.operator_id = ?');
      params.push(req.query.operatorId);
    }
    if (req.query.patient) {
      where.push('(c.patient_name LIKE ? OR m.patient_phone LIKE ? OR c.protocol LIKE ? OR c.clinic_name LIKE ? OR c.operator_name LIKE ?)');
      const search = `%${req.query.patient}%`;
      params.push(search, search, search, search, search);
    }
    const limit = Math.min(500, Math.max(20, Number(req.query.limit || 200)));
    const [rows] = await pool.query(
      `SELECT m.*, c.patient_name, c.unit_name, c.source
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_conversations c ON c.id = m.conversation_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.created_at DESC
        LIMIT ${limit}`,
      params
    );
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar histórico WhatsApp.' });
  }
}

async function handleGetWhatsAppAbsent(req, res) {
  try {
    const scope = buildWhatsAppScopeWhere(req.user, 'a');
    const [rows] = await pool.query(
      `SELECT a.*
         FROM whatsapp_absent_patients a
        WHERE ${scope.clause}
        ORDER BY COALESCE(a.next_attempt_at, a.updated_at) ASC
        LIMIT 300`,
      scope.params
    );
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar pacientes ausentes.' });
  }
}

async function handleCreateWhatsAppAbsent(req, res) {
  try {
    const conversation = req.body.conversation_id ? await getWhatsAppConversationById(req.body.conversation_id) : null;
    const phone = normalizeWhatsAppPhone(req.body.patient_phone || conversation?.patient_phone);
    if (!phone) return res.status(400).json({ error: 'Informe o telefone do paciente ausente.' });
    const [result] = await pool.query(
      `INSERT INTO whatsapp_absent_patients
       (conversation_id, patient_name, patient_phone, clinic_id, clinic_name, reason, attempt_count, last_attempt_at, next_attempt_at, operator_id, operator_name, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [
        conversation?.id || req.body.conversation_id || null,
        sanitizeFinancialString(req.body.patient_name || conversation?.patient_name || 'Paciente sem nome'),
        phone,
        req.body.clinic_id || conversation?.clinic_id || null,
        sanitizeFinancialString(req.body.clinic_name || conversation?.clinic_name),
        sanitizeFinancialString(req.body.reason || 'Sem retorno', 180),
        Number(req.body.attempt_count || req.body.attemptCount || 1),
        normalizeNullableMysqlDateTime(req.body.next_attempt_at || req.body.nextAttemptAt),
        req.body.operator_id || conversation?.operator_id || req.user?.id || null,
        sanitizeFinancialString(req.body.operator_name || conversation?.operator_name || getActorName(req.user)),
        normalizeWhatsAppStatus(req.body.status || 'Ausente primeira tentativa'),
        sanitizeFinancialString(req.body.notes, 2000)
      ]
    );
    if (conversation?.id) {
      await pool.query('UPDATE whatsapp_conversations SET status = ? WHERE id = ?', ['Ausente', conversation.id]);
    }
    const [rows] = await pool.query('SELECT * FROM whatsapp_absent_patients WHERE id = ? LIMIT 1', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao registrar paciente ausente.' });
  }
}

async function handleUpdateWhatsAppAbsent(req, res) {
  try {
    const [currentRows] = await pool.query('SELECT * FROM whatsapp_absent_patients WHERE id = ? LIMIT 1', [req.params.id]);
    if (!currentRows[0]) return res.status(404).json({ error: 'Paciente ausente não encontrado.' });
    const current = currentRows[0];
    if (!canViewAllWhatsAppAttendance(req.user) && Number(current.operator_id) !== Number(req.user?.id)) {
      return res.status(403).json({ error: 'Você só pode editar seus pacientes ausentes.' });
    }
    const hasNextAttempt = Object.prototype.hasOwnProperty.call(req.body, 'next_attempt_at')
      || Object.prototype.hasOwnProperty.call(req.body, 'nextAttemptAt');
    await pool.query(
      `UPDATE whatsapp_absent_patients
          SET reason = ?,
              attempt_count = ?,
              last_attempt_at = ?,
              next_attempt_at = ?,
              operator_id = ?,
              operator_name = ?,
              status = ?,
              notes = ?
        WHERE id = ?`,
      [
        sanitizeFinancialString(req.body.reason || current.reason, 180),
        Number(req.body.attempt_count || req.body.attemptCount || current.attempt_count || 1),
        normalizeNullableMysqlDateTime(req.body.last_attempt_at || req.body.lastAttemptAt || current.last_attempt_at),
        hasNextAttempt
          ? normalizeNullableMysqlDateTime(req.body.next_attempt_at || req.body.nextAttemptAt)
          : normalizeNullableMysqlDateTime(current.next_attempt_at),
        req.body.operator_id || current.operator_id,
        sanitizeFinancialString(req.body.operator_name || current.operator_name),
        normalizeWhatsAppStatus(req.body.status || current.status),
        sanitizeFinancialString(req.body.notes || current.notes, 2000),
        req.params.id
      ]
    );
    const [rows] = await pool.query('SELECT * FROM whatsapp_absent_patients WHERE id = ? LIMIT 1', [req.params.id]);
    return res.json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar paciente ausente.' });
  }
}

async function handleGetWhatsAppFlows(req, res) {
  try {
    const [flows] = await pool.query('SELECT * FROM whatsapp_chatbot_flows ORDER BY status ASC, flow_name ASC');
    const [steps] = await pool.query('SELECT * FROM whatsapp_chatbot_steps ORDER BY flow_id ASC, step_order ASC');
    const byFlow = steps.reduce((acc, step) => {
      acc[step.flow_id] = acc[step.flow_id] || [];
      acc[step.flow_id].push(step);
      return acc;
    }, {});
    return res.json(flows.map((flow) => ({ ...flow, steps: byFlow[flow.id] || [] })));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar fluxos de chatbot.' });
  }
}

function normalizeWhatsAppChatbotTriggerType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'palavra-chave';
  return normalized;
}

function parseWhatsAppChatbotPayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function stringifyWhatsAppChatbotPayload(value) {
  if (!value || typeof value !== 'object') return JSON.stringify({});
  return JSON.stringify(value);
}

function normalizeChatbotSessionData(value) {
  const parsed = parseWhatsAppChatbotPayload(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function buildChatbotAllowedChoices(optionValue) {
  return String(optionValue || '')
    .split(/[\n,;|]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeChatbotInboundValue(value) {
  return String(value || '').trim().toLowerCase();
}

function validateChatbotStepResponse(step, inboundText) {
  const payload = parseWhatsAppChatbotPayload(step?.action_payload);
  const text = String(inboundText || '').trim();
  const normalized = normalizeChatbotInboundValue(text);
  const validation = String(payload.validation || '').trim().toLowerCase();
  const allowedChoices = buildChatbotAllowedChoices(step?.option_value);

  if (validation === 'nps_score') {
    const score = Number(normalized);
    if (!Number.isInteger(score) || score < 0 || score > 10) {
      return { valid: false, error: 'Responda com uma nota de 0 a 10 para a sua experiência.' };
    }
    return { valid: true, normalizedValue: String(score), parsedValue: score };
  }

  if (validation === 'phone') {
    const phone = normalizeWhatsAppPhone(text);
    if (!phone || phone.length < 12) {
      return { valid: false, error: 'Envie um número válido com DDD. Exemplo: 5562999999999.' };
    }
    return { valid: true, normalizedValue: phone, parsedValue: phone };
  }

  if (validation === 'choice' || allowedChoices.length) {
    if (allowedChoices.length && !allowedChoices.includes(normalized)) {
      const choicesLabel = allowedChoices.join(', ');
      return { valid: false, error: `Resposta inválida. Use uma das opções: ${choicesLabel}.` };
    }
    return { valid: true, normalizedValue: normalized, parsedValue: normalized };
  }

  return { valid: true, normalizedValue: text, parsedValue: text };
}

function renderGenericWhatsAppTemplate(message, variables = {}) {
  const source = String(message || '');
  const normalizedVariables = { ...variables };
  if (normalizedVariables.nome_paciente) {
    normalizedVariables.nome_paciente = String(normalizedVariables.nome_paciente).trim().toUpperCase();
  }
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = normalizedVariables[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function normalizeWhatsAppPatientName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 180);
}

function parseMassWhatsAppRecipients(rawText = '') {
  const decoded = String(rawText || '').replace(/\r/g, '').trim();
  if (!decoded) return { recipients: [], invalidRows: [] };

  const lines = decoded.split('\n').map((item) => item.trim()).filter(Boolean);
  if (!lines.length) return { recipients: [], invalidRows: [] };

  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('telefone') || firstLine.includes('phone') || firstLine.includes('nome');
  const contentLines = hasHeader ? lines.slice(1) : lines;
  const recipients = [];
  const invalidRows = [];

  contentLines.forEach((line, index) => {
    const columns = line.split(/[;,|\t]+/).map((item) => item.trim());
    const patientName = columns[0] || '';
    const patientPhone = normalizeWhatsAppPhone(columns[1] || columns[0] || '');
    const thirdColumn = columns[2] || '';
    const fourthColumn = columns[3] || '';
    const fifthColumn = columns[4] || '';
    const thirdLooksLikeDate = /^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(thirdColumn)
      || /^\d{4}-\d{2}-\d{2}$/.test(thirdColumn);
    const fourthLooksLikeTime = /^\d{1,2}:\d{2}/.test(fourthColumn);
    const clinicName = thirdLooksLikeDate && fourthLooksLikeTime ? '' : thirdColumn;
    const appointmentDate = thirdLooksLikeDate && fourthLooksLikeTime ? thirdColumn : fourthColumn;
    const appointmentTime = thirdLooksLikeDate && fourthLooksLikeTime ? fourthColumn : fifthColumn;

    if (!patientName || !patientPhone) {
      invalidRows.push({ line: hasHeader ? index + 2 : index + 1, content: line });
      return;
    }

    recipients.push({
      patient_name: normalizeWhatsAppPatientName(patientName),
      patient_phone: patientPhone,
      clinic_name: clinicName,
      data_consulta: appointmentDate,
      hora_consulta: appointmentTime
    });
  });

  return { recipients, invalidRows };
}

function parseMassWhatsAppRecipientsFromWorksheetRows(rows = []) {
  const recipients = [];
  const invalidRows = [];

  rows.forEach((row, index) => {
    const patientName = normalizeWhatsAppPatientName(
      row.nome_paciente || row.nome || row.paciente || row.patient_name || row.patient || ''
    );
    const patientPhone = normalizeWhatsAppPhone(
      row.telefone || row.phone || row.patient_phone || row.whatsapp || row.celular || ''
    );
    const clinicName = String(row.clinica || row.clinic || row.unidade || '').trim();
    const appointmentDate = String(row.data_consulta || row.data || '').trim();
    const appointmentTime = String(row.hora_consulta || row.hora || '').trim();

    if (!patientName || !patientPhone) {
      invalidRows.push({ line: index + 2, content: JSON.stringify(row) });
      return;
    }

    recipients.push({
      patient_name: patientName,
      patient_phone: patientPhone,
      clinic_name: clinicName,
      data_consulta: appointmentDate,
      hora_consulta: appointmentTime
    });
  });

  return { recipients, invalidRows };
}

function parseMassWhatsAppRecipientsFromUpload(filePath, originalName = '') {
  const extension = String(path.extname(originalName || filePath || '')).trim().toLowerCase();
  if (['.xlsx', '.xls'].includes(extension)) {
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName] || {}, { defval: '' });
    return parseMassWhatsAppRecipientsFromWorksheetRows(rows);
  }
  return parseMassWhatsAppRecipients(decodeUploadedText(fs.readFileSync(filePath)));
}

function normalizeMassCampaignRecipientInput(recipient = {}) {
  const patientName = normalizeWhatsAppPatientName(
    recipient.patient_name || recipient.nome_paciente || recipient.nome || recipient.patientName || ''
  );
  const patientPhone = normalizeWhatsAppPhone(
    recipient.patient_phone || recipient.telefone || recipient.phone || recipient.patientPhone || ''
  );
  const clinicName = sanitizeFinancialString(recipient.clinic_name || recipient.clinica || recipient.clinicName || recipient.clinic || '', 180);
  const clinicId = Number(recipient.clinic_id || recipient.clinicId || 0) || null;
  return {
    patient_name: patientName,
    patient_phone: patientPhone,
    clinic_name: clinicName || '',
    clinic_id: clinicId,
    data_consulta: String(recipient.data_consulta || recipient.dataConsulta || '').trim(),
    hora_consulta: String(recipient.hora_consulta || recipient.horaConsulta || '').trim()
  };
}

async function resolveMassCampaignSelectedClinic(req, user = null) {
  const clinicId = Number(
    req.body?.campaign_clinic_id
    || req.body?.campaignClinicId
    || req.body?.default_clinic_id
    || req.body?.defaultClinicId
    || 0
  ) || null;
  const clinicName = sanitizeFinancialString(
    req.body?.campaign_clinic_name
    || req.body?.campaignClinicName
    || req.body?.default_clinic_name
    || req.body?.defaultClinicName
    || '',
    180
  );

  if (!clinicId && !clinicName) return null;

  let clinic = clinicId ? await getActiveClinicById(clinicId) : null;
  if (!clinic && clinicName) {
    const resolvedClinicId = await resolveClinicIdByName(clinicName);
    clinic = resolvedClinicId ? await getActiveClinicById(resolvedClinicId) : null;
  }

  if (!clinic) {
    throw new Error('A clínica selecionada para a campanha não foi encontrada ou está inativa.');
  }

  await assertCrcOperatorClinicAccess(user, clinic.id);

  return {
    clinic_id: clinic.id,
    clinic_name: clinic.name
  };
}

function applyMassCampaignSelectedClinic(recipients = [], selectedClinic = null) {
  if (!selectedClinic) return recipients;
  return recipients.map((recipient) => ({
    ...recipient,
    clinic_id: selectedClinic.clinic_id,
    clinic_name: selectedClinic.clinic_name,
    clinica: selectedClinic.clinic_name
  }));
}

async function findWhatsAppInstanceByClinic({ clinicId = null, clinicName = '', preferredSector = null } = {}) {
  if (clinicId) {
    const [rows] = await pool.query(
      `SELECT *
         FROM whatsapp_instances
        WHERE clinic_id = ?
        ORDER BY CASE WHEN status = 'conectado' THEN 0 ELSE 1 END,
                 CASE WHEN ? IS NOT NULL AND sector = ? THEN 0 ELSE 1 END,
                 updated_at DESC
        LIMIT 1`,
      [clinicId, preferredSector, preferredSector]
    );
    if (rows[0]) return rows[0];
  }

  const normalizedClinicName = normalizeClinicLookupValue(clinicName);
  if (!normalizedClinicName) return null;

  const [rows] = await pool.query(
    `SELECT *
       FROM whatsapp_instances
      WHERE clinic_name IS NOT NULL
      ORDER BY CASE WHEN status = 'conectado' THEN 0 ELSE 1 END,
               CASE WHEN ? IS NOT NULL AND sector = ? THEN 0 ELSE 1 END,
               updated_at DESC`,
    [preferredSector, preferredSector]
  );

  return rows.find((row) => normalizeClinicLookupValue(row.clinic_name) === normalizedClinicName) || null;
}

async function resolveMassCampaignRecipientRoute(recipient, campaignType, user = null, requestedSessionId = '') {
  const normalizedRecipient = normalizeMassCampaignRecipientInput(recipient);
  const requestedSession = sanitizeFinancialString(requestedSessionId);
  if (campaignType === 'confirmacao') {
    const clinicId = normalizedRecipient.clinic_id || await resolveClinicIdByName(normalizedRecipient.clinic_name);
    if (isCrcOperatorUser(user)) {
      try {
        await assertCrcOperatorClinicAccess(user, clinicId);
      } catch (error) {
        return {
          ...normalizedRecipient,
          clinic_id: clinicId || null,
          resolved: false,
          routing_error: error.message || 'A clínica informada não está vinculada ao operador CRC.'
        };
      }
    }
    const clinicInstance = await findWhatsAppInstanceByClinic({
      clinicId,
      clinicName: normalizedRecipient.clinic_name,
      preferredSector: 'Confirmacao e Agendamento'
    });

    if (!clinicInstance) {
      return {
        ...normalizedRecipient,
        clinic_id: clinicId,
        resolved: false,
        routing_error: clinicId || normalizedRecipient.clinic_name
          ? 'Nenhum WhatsApp de clínica foi encontrado para este paciente.'
          : 'Informe a clínica para enviar a confirmação pelo número correto.'
      };
    }

    if (String(clinicInstance.status || '').trim().toLowerCase() !== 'conectado') {
      return {
        ...normalizedRecipient,
        clinic_id: clinicId || clinicInstance.clinic_id || null,
        clinic_name: normalizedRecipient.clinic_name || clinicInstance.clinic_name || '',
        resolved: false,
        resolved_instance_name: clinicInstance.instance_name,
        resolved_instance_display_name: clinicInstance.display_name || clinicInstance.instance_name,
        resolved_instance_status: clinicInstance.status || '',
        routing_error: 'O WhatsApp da clínica foi encontrado, mas não está logado no momento.'
      };
    }

    return {
      ...normalizedRecipient,
      clinic_id: clinicId || clinicInstance.clinic_id || null,
      clinic_name: normalizedRecipient.clinic_name || clinicInstance.clinic_name || '',
      resolved: true,
      resolved_instance_name: clinicInstance.instance_name,
      resolved_instance_display_name: clinicInstance.display_name || clinicInstance.instance_name,
      resolved_instance_status: clinicInstance.status || '',
      routing_note: 'Envio automático pelo WhatsApp vinculado à clínica.'
    };
  }

  const defaultInstance = await getNpsWhatsAppInstance(user);
  const instanceName = requestedSession || defaultInstance?.instance_name || WHATSAPP_NPS_INSTANCE_NAME;
  return {
    ...normalizedRecipient,
    resolved: true,
    resolved_instance_name: instanceName,
    resolved_instance_display_name: defaultInstance?.display_name || instanceName,
    resolved_instance_status: defaultInstance?.status || ''
  };
}

async function saveWhatsAppCampaignRecipientRecord({
  batchId,
  campaignType,
  templateId = null,
  route = {},
  status = 'pendente',
  routingError = null,
  source = 'whatsapp_campaign',
  createdBy = null,
  conversationId = null,
  messageId = null,
  dispatchQueueId = null
} = {}) {
  await pool.query(
    `INSERT INTO whatsapp_campaign_recipients
     (batch_id, campaign_type, template_id, patient_name, patient_phone, clinic_id, clinic_name, instance_name, source, status, routing_error, conversation_id, message_id, dispatch_queue_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sanitizeFinancialString(batchId, 80) || `batch-${Date.now()}`,
      sanitizeFinancialString(campaignType, 40) || 'confirmacao',
      templateId || null,
      sanitizeFinancialString(route.patient_name, 180) || 'Paciente',
      normalizeWhatsAppPhone(route.patient_phone || ''),
      route.clinic_id || null,
      sanitizeFinancialString(route.clinic_name, 180) || null,
      sanitizeFinancialString(route.resolved_instance_name || route.instance_name, 120) || null,
      sanitizeFinancialString(source, 120) || 'whatsapp_campaign',
      sanitizeFinancialString(status, 40) || 'pendente',
      routingError ? String(routingError).slice(0, 4000) : null,
      conversationId || null,
      messageId || null,
      dispatchQueueId || null,
      sanitizeFinancialString(createdBy, 180) || null
    ]
  );
}

async function buildMassWhatsAppCampaignPreview({ recipients = [], invalidRows = [], campaignType = 'confirmacao', sessionId = '', user = null } = {}) {
  const previewRows = [];
  const skippedRows = [];

  for (const [index, recipient] of recipients.entries()) {
    const resolvedRecipient = await resolveMassCampaignRecipientRoute(recipient, campaignType, user, sessionId);
    const previewId = `recipient-${index + 1}-${resolvedRecipient.patient_phone || 'sem-telefone'}`;
    if (!resolvedRecipient.patient_name || !resolvedRecipient.patient_phone) {
      skippedRows.push({
        preview_id: previewId,
        line: index + 1,
        content: recipient,
        reason: 'Campos obrigatórios: nome_paciente e telefone.'
      });
      continue;
    }
    previewRows.push({
      ...resolvedRecipient,
      preview_id: previewId,
      selected: Boolean(resolvedRecipient.resolved)
    });
  }

  return {
    recipients: previewRows,
    invalidRows,
    skippedRows,
    summary: {
      total: previewRows.length,
      ready: previewRows.filter((item) => item.resolved).length,
      blocked: previewRows.filter((item) => !item.resolved).length,
      invalid: invalidRows.length + skippedRows.length
    }
  };
}

function parseSelectedCampaignRecipients(req) {
  const rawSelection = req.body?.selected_recipients || req.body?.selectedRecipients || null;
  if (!rawSelection) return [];
  if (Array.isArray(rawSelection)) return rawSelection.map(normalizeMassCampaignRecipientInput).filter((item) => item.patient_name && item.patient_phone);
  try {
    const parsed = JSON.parse(rawSelection);
    return Array.isArray(parsed) ? parsed.map(normalizeMassCampaignRecipientInput).filter((item) => item.patient_name && item.patient_phone) : [];
  } catch (_error) {
    return [];
  }
}

function buildProgressiveDispatchDelaySeconds(index, antiBan = null) {
  const config = antiBan || getWhatsAppAntiBanConfig();
  const minSeconds = Math.max(10, Math.round(Number(config.minDelayMs || 4500) / 1000));
  const maxSeconds = Math.max(minSeconds + 5, Math.round(Number(config.maxDelayMs || 14000) / 1000) + 25);
  let total = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    total += randomIntegerBetween(minSeconds, maxSeconds);
  }
  return total;
}

async function findRecentDuplicateWhatsAppMessage({
  instanceName,
  patientPhone,
  messageText,
  messageType = null,
  maxAgeSeconds = 45
}) {
  if (!instanceName || !patientPhone || !String(messageText || '').trim()) return null;
  const [rows] = await pool.query(
    `SELECT *
       FROM whatsapp_messages
      WHERE instance_name = ?
        AND patient_phone = ?
        AND message_text = ?
        AND (? IS NULL OR message_type = ?)
        AND direction IN ('outbound', 'outgoing')
        AND status IN ('pendente', 'processando', 'enviada', 'entregue', 'lida')
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
      ORDER BY id DESC
      LIMIT 1`,
    [instanceName, patientPhone, String(messageText || '').trim(), messageType, messageType, Math.max(5, Number(maxAgeSeconds || 45))]
  );
  return rows[0] || null;
}

async function findWhatsAppMessageByClientRequestId(clientRequestId) {
  const requestId = String(clientRequestId || '').trim();
  if (!requestId) return null;
  const [rows] = await pool.query(
    'SELECT * FROM whatsapp_messages WHERE client_request_id = ? ORDER BY id DESC LIMIT 1',
    [requestId]
  );
  return rows[0] || null;
}

async function queueManagedWhatsAppMessage({
  actor = null,
  conversationPayload = {},
  instanceName,
  patientPhone,
  patientName,
  clinicName = null,
  clinicId = null,
  messageText,
  messageType = 'manual',
  source = 'whatsapp_management',
  scheduleDelaySeconds = 0,
  payload = {}
}) {
  const normalizedPhone = normalizeWhatsAppPhone(patientPhone);
  const text = String(messageText || '').trim();
  if (!instanceName || !normalizedPhone || !text) {
    throw new Error('Não foi possível enfileirar a mensagem do WhatsApp.');
  }

  const duplicateMessage = await findRecentDuplicateWhatsAppMessage({
    instanceName,
    patientPhone: normalizedPhone,
    messageText: text,
    messageType,
    maxAgeSeconds: 180
  });
  if (duplicateMessage) {
    return {
      conversation: duplicateMessage.conversation_id ? await getWhatsAppConversationById(duplicateMessage.conversation_id) : null,
      messageId: duplicateMessage.id,
      dispatch: null,
      duplicateSuppressed: true
    };
  }

  const conversation = await findOrCreateWhatsAppConversation({
    ...conversationPayload,
    patient_name: normalizeWhatsAppPatientName(patientName || conversationPayload.patient_name || 'Paciente WhatsApp'),
    patient_phone: normalizedPhone,
    phone: normalizedPhone,
    clinic_id: clinicId || conversationPayload.clinic_id || null,
    clinic_name: clinicName || conversationPayload.clinic_name || null,
    instance_name: instanceName,
    session_id: instanceName,
    source,
    status: conversationPayload.status || 'Em atendimento'
  }, actor || { id: null, name: 'Sistema WhatsApp', role: 'system' });

  const messageId = await insertWhatsAppMessage({
    conversation_id: conversation.id,
    instance_name: instanceName,
    session_id: instanceName,
    patient_phone: normalizedPhone,
    phone: normalizedPhone,
    patient_name: patientName || conversation.patient_name || null,
    direction: 'outbound',
    message_text: text,
    message: text,
    message_type: messageType,
    source,
    status: 'pendente',
    operator_id: actor?.id || conversation.operator_id || null,
    operator_name: actor ? getActorName(actor) : (conversation.operator_name || 'Sistema WhatsApp'),
    clinic_id: conversation.clinic_id,
    clinic_name: conversation.clinic_name,
    campaign: conversation.campaign
  });

  const dispatch = await enqueueWhatsAppDispatch({
    message_id: messageId,
    conversation_id: conversation.id,
    instance_name: instanceName,
    recipient_phone: normalizedPhone,
    message_text: text,
    message_type: messageType,
    operator_id: actor?.id || conversation.operator_id || null,
    operator_name: actor ? getActorName(actor) : (conversation.operator_name || 'Sistema WhatsApp'),
    scheduleDelaySeconds,
    payload: { source, ...payload }
  });

  return { conversation, messageId, dispatch };
}

async function getWhatsAppChatbotRecentSessions(limit = 40, user = null) {
  const scope = buildWhatsAppScopeWhere(user, 'c');
  const [rows] = await pool.query(
    `SELECT s.*, f.flow_name, c.status AS conversation_status, c.operator_name AS conversation_operator_name
       FROM whatsapp_chatbot_sessions s
       LEFT JOIN whatsapp_chatbot_flows f ON f.id = s.flow_id
       LEFT JOIN whatsapp_conversations c ON c.id = s.conversation_id
      WHERE ${scope.clause}
      ORDER BY COALESCE(s.last_interaction_at, s.started_at, s.created_at) DESC
      LIMIT ?`,
    [...scope.params, Math.max(1, Number(limit || 40))]
  );
  return rows.map((row) => ({
    ...row,
    collected_data: normalizeChatbotSessionData(row.collected_data)
  }));
}

async function getWhatsAppChatbotFlowByTriggerType({ instanceName = null, triggerType = 'palavra-chave' } = {}) {
  const [rows] = await pool.query(
    `SELECT *
       FROM whatsapp_chatbot_flows
      WHERE status = 'ativo'
        AND trigger_type = ?
        AND (instance_name IS NULL OR instance_name = '' OR instance_name = ?)
      ORDER BY CASE WHEN instance_name = ? THEN 0 ELSE 1 END, id ASC
      LIMIT 1`,
    [triggerType, instanceName || null, instanceName || null]
  );
  return rows[0] || null;
}

async function getWhatsAppChatbotTriggerTypeForConversation({ instanceName = null, conversation = null } = {}) {
  const campaign = String(conversation?.campaign || '').trim().toLowerCase();
  if (campaign === 'confirmacao') return 'confirmacao de consulta';
  if (campaign === 'nps') return 'nps';
  if (instanceName === WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME) return 'confirmacao de consulta';
  if (instanceName === WHATSAPP_NPS_INSTANCE_NAME) return 'nps';
  return 'palavra-chave';
}

async function findWhatsAppChatbotFlowByTrigger({ instanceName, inboundText, conversation = null }) {
  const triggerType = await getWhatsAppChatbotTriggerTypeForConversation({ instanceName, conversation });
  const normalizedText = normalizeChatbotInboundValue(inboundText);
  const [rows] = await pool.query(
    `SELECT *
       FROM whatsapp_chatbot_flows
      WHERE status = 'ativo'
        AND trigger_type = ?
        AND (instance_name IS NULL OR instance_name = '' OR instance_name = ?)
      ORDER BY CASE WHEN instance_name = ? THEN 0 ELSE 1 END, id ASC`,
    [triggerType, instanceName || null, instanceName || null]
  );

  return rows.find((row) => {
    const flowTrigger = normalizeWhatsAppChatbotTriggerType(row.trigger_type);
    if (flowTrigger === triggerType && triggerType !== 'palavra-chave') return true;
    if (flowTrigger !== 'palavra-chave') return false;
    const value = normalizeChatbotInboundValue(row.trigger_value);
    return value && normalizedText.includes(value);
  }) || null;
}

async function getWhatsAppChatbotSteps(flowId) {
  const [rows] = await pool.query(
    'SELECT * FROM whatsapp_chatbot_steps WHERE flow_id = ? ORDER BY step_order ASC, id ASC',
    [flowId]
  );
  return rows;
}

function getWhatsAppChatbotNextStep(currentStep, steps, normalizedValue) {
  const payload = parseWhatsAppChatbotPayload(currentStep?.action_payload);
  const nextByValue = payload.next_step_by_value || payload.nextStepByValue || {};
  const explicitNext = nextByValue?.[normalizedValue];
  if (explicitNext) {
    return steps.find((item) => Number(item.step_order) === Number(explicitNext)) || null;
  }
  if (currentStep?.next_step_id) {
    return steps.find((item) => Number(item.id) === Number(currentStep.next_step_id)) || null;
  }
  const currentOrder = Number(currentStep?.step_order || 0);
  return steps.find((item) => Number(item.step_order) > currentOrder) || null;
}

async function saveWhatsAppChatbotSession(sessionId, fields = {}) {
  const assignments = [];
  const params = [];
  Object.entries(fields).forEach(([key, value]) => {
    assignments.push(`${key} = ?`);
    params.push(value);
  });
  if (!assignments.length) return null;
  params.push(sessionId);
  await pool.query(
    `UPDATE whatsapp_chatbot_sessions
        SET ${assignments.join(', ')},
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    params
  );
  const [rows] = await pool.query('SELECT * FROM whatsapp_chatbot_sessions WHERE id = ? LIMIT 1', [sessionId]);
  return rows[0] || null;
}

async function findActiveWhatsAppChatbotSession({ conversationId, phone, instanceName }) {
  const [rows] = await pool.query(
    `SELECT *
       FROM whatsapp_chatbot_sessions
      WHERE status = 'ativo'
        AND (
          (conversation_id IS NOT NULL AND conversation_id = ?)
          OR (patient_phone = ? AND (instance_name = ? OR instance_name IS NULL))
        )
      ORDER BY id DESC
      LIMIT 1`,
    [conversationId || 0, phone || '', instanceName || null]
  );
  return rows[0] || null;
}

async function assignConversationToSacOperator(conversationId) {
  if (!conversationId) return null;
  const [operators] = await pool.query(
    `SELECT id, name
       FROM users
      WHERE role = 'sac_operator'
        AND COALESCE(active, 1) = 1
        AND deleted_at IS NULL
      ORDER BY id ASC
      LIMIT 1`
  );
  const operator = operators[0];
  if (!operator) return null;
  await pool.query(
    `UPDATE whatsapp_conversations
        SET operator_id = ?,
            assigned_operator_id = ?,
            operator_name = ?,
            status = 'Em atendimento',
            updated_at = NOW()
      WHERE id = ?`,
    [operator.id, operator.id, operator.name, conversationId]
  );
  return operator;
}

async function applyWhatsAppChatbotStepAction({ session, step, normalizedValue, parsedValue, conversation }) {
  const payload = parseWhatsAppChatbotPayload(step?.action_payload);
  const currentData = normalizeChatbotSessionData(session?.collected_data);
  const nextData = { ...currentData };
  const field = String(payload.field || payload.captureField || '').trim();

  if (String(step?.action_type || '').trim() === 'capture_field' && field) {
    nextData[field] = parsedValue;
    if (field === 'patient_name') {
      await pool.query('UPDATE whatsapp_conversations SET patient_name = ?, updated_at = NOW() WHERE id = ?', [String(parsedValue || '').slice(0, 180), conversation.id]);
    }
    if (field === 'patient_phone') {
      await pool.query('UPDATE whatsapp_conversations SET patient_phone = ?, updated_at = NOW() WHERE id = ?', [normalizeWhatsAppPhone(parsedValue), conversation.id]);
    }
  }

  if (String(step?.action_type || '').trim() === 'assign_operator_role') {
    const operator = await assignConversationToSacOperator(conversation.id);
    nextData.assigned_operator = operator?.name || 'Operador de SAC';
  }

  const statusByValue = payload.save_conversation_status_by_value || payload.saveConversationStatusByValue || {};
  if (statusByValue && typeof statusByValue === 'object' && statusByValue[normalizedValue]) {
    await pool.query('UPDATE whatsapp_conversations SET status = ?, updated_at = NOW() WHERE id = ?', [statusByValue[normalizedValue], conversation.id]);
    nextData.conversation_status = statusByValue[normalizedValue];
  }

  return nextData;
}

async function startWhatsAppChatbotSession({ flow, conversation, inboundMessage }) {
  const steps = await getWhatsAppChatbotSteps(flow.id);
  if (!steps.length) return null;
  const firstStep = steps[0];
  const [result] = await pool.query(
    `INSERT INTO whatsapp_chatbot_sessions
     (flow_id, conversation_id, instance_name, patient_phone, patient_name, current_step_order, current_step_id, last_inbound_message_id, collected_data, status, started_at, last_interaction_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', NOW(), NOW())`,
    [
      flow.id,
      conversation.id,
      conversation.instance_name || inboundMessage.session_id || null,
      conversation.patient_phone,
      conversation.patient_name,
      Number(firstStep.step_order || 1),
      firstStep.id,
      inboundMessage?.id || null,
      stringifyWhatsAppChatbotPayload({})
    ]
  );

  const templateVariables = {
    nome_paciente: conversation.patient_name || 'Paciente',
    telefone: conversation.patient_phone,
    clinica: conversation.clinic_name || '',
    data_consulta: '',
    hora_consulta: ''
  };

  const openingMessages = [flow.initial_message, firstStep.message_text]
    .map((item) => renderGenericWhatsAppTemplate(item, templateVariables).trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);

  for (const [index, text] of openingMessages.entries()) {
    await queueManagedWhatsAppMessage({
      actor: null,
      conversationPayload: conversation,
      instanceName: conversation.instance_name,
      patientPhone: conversation.patient_phone,
      patientName: conversation.patient_name,
      clinicName: conversation.clinic_name,
      clinicId: conversation.clinic_id,
      messageText: text,
      messageType: 'chatbot',
      source: 'chatbot_start',
      scheduleDelaySeconds: index * 4,
      payload: { flowId: flow.id, chatbotSessionStart: true }
    });
  }

  return result.insertId;
}

async function processWhatsAppChatbotInbound({ conversation, inboundMessage }) {
  const activeSession = await findActiveWhatsAppChatbotSession({
    conversationId: conversation.id,
    phone: conversation.patient_phone,
    instanceName: conversation.instance_name
  });

  if (!activeSession) {
    const flow = await findWhatsAppChatbotFlowByTrigger({
      instanceName: conversation.instance_name,
      inboundText: inboundMessage.message_text || inboundMessage.message,
      conversation
    });
    if (!flow) return { matched: false };
    const sessionId = await startWhatsAppChatbotSession({ flow, conversation, inboundMessage });
    return { matched: Boolean(sessionId), started: Boolean(sessionId) };
  }

  const steps = await getWhatsAppChatbotSteps(activeSession.flow_id);
  const currentStep = steps.find((item) => Number(item.id) === Number(activeSession.current_step_id))
    || steps.find((item) => Number(item.step_order) === Number(activeSession.current_step_order))
    || steps[0];
  if (!currentStep) return { matched: false, reason: 'missing_step' };

  const validation = validateChatbotStepResponse(currentStep, inboundMessage.message_text || inboundMessage.message);
  if (!validation.valid) {
    await queueManagedWhatsAppMessage({
      actor: null,
      conversationPayload: conversation,
      instanceName: conversation.instance_name,
      patientPhone: conversation.patient_phone,
      patientName: conversation.patient_name,
      clinicName: conversation.clinic_name,
      clinicId: conversation.clinic_id,
      messageText: validation.error,
      messageType: 'chatbot',
      source: 'chatbot_validation',
      scheduleDelaySeconds: 2,
      payload: { chatbotSessionId: activeSession.id, flowId: activeSession.flow_id }
    });
    return { matched: true, validationError: true };
  }

  const currentPayload = parseWhatsAppChatbotPayload(currentStep?.action_payload);
  const normalizedValueMap = currentPayload.normalize_value_map || currentPayload.normalizeValueMap || {};
  const effectiveNormalizedValue = normalizedValueMap[validation.normalizedValue] || validation.normalizedValue;
  const effectiveParsedValue = normalizedValueMap[validation.normalizedValue] || validation.parsedValue;

  const nextData = await applyWhatsAppChatbotStepAction({
    session: activeSession,
    step: currentStep,
    normalizedValue: effectiveNormalizedValue,
    parsedValue: effectiveParsedValue,
    conversation
  });

  const nextStep = getWhatsAppChatbotNextStep(currentStep, steps, effectiveNormalizedValue);
  if (!nextStep) {
    await saveWhatsAppChatbotSession(activeSession.id, {
      collected_data: stringifyWhatsAppChatbotPayload(nextData),
      last_inbound_message_id: inboundMessage.id,
      last_interaction_at: new Date(),
      status: 'concluido',
      completed_at: new Date()
    });
    return { matched: true, completed: true, data: nextData };
  }

  await saveWhatsAppChatbotSession(activeSession.id, {
    collected_data: stringifyWhatsAppChatbotPayload(nextData),
    last_inbound_message_id: inboundMessage.id,
    last_interaction_at: new Date(),
    current_step_order: Number(nextStep.step_order || 1),
    current_step_id: nextStep.id
  });

  const renderedNextMessage = renderGenericWhatsAppTemplate(nextStep.message_text, {
    nome_paciente: conversation.patient_name || 'Paciente',
    telefone: conversation.patient_phone,
    clinica: conversation.clinic_name || '',
    ...nextData
  }).trim();

  if (renderedNextMessage) {
    await queueManagedWhatsAppMessage({
      actor: null,
      conversationPayload: conversation,
      instanceName: conversation.instance_name,
      patientPhone: conversation.patient_phone,
      patientName: conversation.patient_name,
      clinicName: conversation.clinic_name,
      clinicId: conversation.clinic_id,
      messageText: renderedNextMessage,
      messageType: 'chatbot',
      source: 'chatbot_step',
      scheduleDelaySeconds: 2,
      payload: { chatbotSessionId: activeSession.id, flowId: activeSession.flow_id, stepOrder: nextStep.step_order }
    });
  }

  if (String(nextStep.action_type || '').trim() !== 'capture_field') {
    const autoAdvancedData = await applyWhatsAppChatbotStepAction({
      session: { ...activeSession, collected_data: stringifyWhatsAppChatbotPayload(nextData) },
      step: nextStep,
      normalizedValue: '',
      parsedValue: '',
      conversation
    });
    const chainedStep = getWhatsAppChatbotNextStep(nextStep, steps, '');
    if (!chainedStep) {
      await saveWhatsAppChatbotSession(activeSession.id, {
        collected_data: stringifyWhatsAppChatbotPayload(autoAdvancedData),
        last_inbound_message_id: inboundMessage.id,
        last_interaction_at: new Date(),
        current_step_order: Number(nextStep.step_order || activeSession.current_step_order || 1),
        current_step_id: nextStep.id,
        status: 'concluido',
        completed_at: new Date()
      });
      return { matched: true, completed: true, data: autoAdvancedData };
    }
  }

  return { matched: true, completed: false, data: nextData };
}

async function saveWhatsAppFlowSteps(flowId, steps = []) {
  await pool.query('DELETE FROM whatsapp_chatbot_steps WHERE flow_id = ?', [flowId]);
  for (const [index, step] of steps.entries()) {
    await pool.query(
      `INSERT INTO whatsapp_chatbot_steps
       (flow_id, step_order, message_text, option_value, next_step_id, action_type, action_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        flowId,
        Number(step.step_order || step.stepOrder || index + 1),
        String(step.message_text || step.messageText || '').trim(),
        sanitizeFinancialString(step.option_value || step.optionValue, 80),
        step.next_step_id || step.nextStepId || null,
        sanitizeFinancialString(step.action_type || step.actionType, 80),
        step.action_payload ? JSON.stringify(step.action_payload) : null
      ]
    );
  }
}

async function handleCreateWhatsAppFlow(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode criar fluxos de chatbot.' });
    }
    const [result] = await pool.query(
      `INSERT INTO whatsapp_chatbot_flows
       (flow_name, instance_name, sector, trigger_type, trigger_value, initial_message, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sanitizeFinancialString(req.body.flow_name || req.body.flowName),
        sanitizeFinancialString(req.body.instance_name || req.body.instanceName),
        sanitizeFinancialString(req.body.sector || 'CRC', 80),
        sanitizeFinancialString(req.body.trigger_type || req.body.triggerType, 80),
        sanitizeFinancialString(req.body.trigger_value || req.body.triggerValue),
        String(req.body.initial_message || req.body.initialMessage || '').trim(),
        normalizeWhatsAppStatus(req.body.status || 'ativo', 'ativo'),
        getActorName(req.user),
        getActorName(req.user)
      ]
    );
    await saveWhatsAppFlowSteps(result.insertId, Array.isArray(req.body.steps) ? req.body.steps : []);
    const [rows] = await pool.query('SELECT * FROM whatsapp_chatbot_flows WHERE id = ? LIMIT 1', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao salvar fluxo.' });
  }
}

async function handleUpdateWhatsAppFlow(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode editar fluxos de chatbot.' });
    }
    await pool.query(
      `UPDATE whatsapp_chatbot_flows
          SET flow_name = ?,
              instance_name = ?,
              sector = ?,
              trigger_type = ?,
              trigger_value = ?,
              initial_message = ?,
              status = ?,
              updated_by = ?
        WHERE id = ?`,
      [
        sanitizeFinancialString(req.body.flow_name || req.body.flowName),
        sanitizeFinancialString(req.body.instance_name || req.body.instanceName),
        sanitizeFinancialString(req.body.sector || 'CRC', 80),
        sanitizeFinancialString(req.body.trigger_type || req.body.triggerType, 80),
        sanitizeFinancialString(req.body.trigger_value || req.body.triggerValue),
        String(req.body.initial_message || req.body.initialMessage || '').trim(),
        normalizeWhatsAppStatus(req.body.status || 'ativo', 'ativo'),
        getActorName(req.user),
        req.params.id
      ]
    );
    if (Array.isArray(req.body.steps)) {
      await saveWhatsAppFlowSteps(req.params.id, req.body.steps);
    }
    const [rows] = await pool.query('SELECT * FROM whatsapp_chatbot_flows WHERE id = ? LIMIT 1', [req.params.id]);
    return res.json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar fluxo.' });
  }
}

async function handleGetWhatsAppChatbotSessions(req, res) {
  try {
    const sessions = await getWhatsAppChatbotRecentSessions(60, req.user);
    return res.json(sessions);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar as sessões do chatbot.' });
  }
}

async function handleGetWhatsAppConfirmationResponses(req, res) {
  try {
    const rows = await getRecentConfirmationChatbotResponses(200, req.user);
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar as confirmações registradas pelo WhatsApp.' });
  }
}

async function handleBootstrapProfessionalWhatsAppFlows(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode preparar os fluxos profissionais do chatbot.' });
    }
    await ensureDefaultWhatsAppContent();
    return res.json({ success: true, message: 'Fluxos profissionais de NPS e confirmação atualizados na Gestão de WhatsApp.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao preparar os fluxos profissionais do chatbot.' });
  }
}

async function handleMassWhatsAppCampaignSend(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user) && !hasPermission(req.user, 'whatsapp_send')) {
      return res.status(403).json({ error: 'Seu perfil não pode disparar campanhas em massa pelo WhatsApp.' });
    }

    const campaignType = String(req.body.campaign_type || req.body.campaignType || 'confirmacao').trim().toLowerCase();
    const templateId = Number(req.body.template_id || req.body.templateId || 0) || null;
    const sessionId = sanitizeFinancialString(req.body.session_id || req.body.sessionId);
    const messageText = String(req.body.message_text || req.body.messageText || '').trim();
    const selectedRecipients = parseSelectedCampaignRecipients(req);
    const selectedClinic = await resolveMassCampaignSelectedClinic(req, req.user);
    const parsedUpload = selectedRecipients.length
      ? { recipients: selectedRecipients, invalidRows: [] }
      : req.file?.path
      ? parseMassWhatsAppRecipientsFromUpload(req.file.path, req.file.originalname)
      : parseMassWhatsAppRecipients(decodeUploadedText(req.body.recipients || req.body.content || ''));

    const { invalidRows } = parsedUpload;
    const recipients = applyMassCampaignSelectedClinic(parsedUpload.recipients, selectedClinic);
    if (!recipients.length) {
      return res.status(400).json({ error: 'Informe uma lista com nome e telefone para disparo em massa.' });
    }

    const [templateRows] = templateId
      ? await pool.query('SELECT * FROM whatsapp_templates WHERE id = ? LIMIT 1', [templateId])
      : [[]];
    const template = templateRows[0] || null;
    const resolvedMessage = messageText || template?.message_text || '';
    if (!resolvedMessage) {
      return res.status(400).json({ error: 'Selecione um template ou informe o texto base da campanha.' });
    }

    const defaultInstance = campaignType === 'nps'
      ? await getNpsWhatsAppInstance(req.user)
      : await getDefaultWhatsAppInstance(req.user, {
          preferredInstanceName: WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME,
          preferredPhone: WHATSAPP_CONFIRMATION_APPOINTMENT_SENDER_PHONE,
          fallbackInstanceName: WHATSAPP_NOTIFICATION_INSTANCE_NAME,
          fallbackPhone: WHATSAPP_NOTIFICATION_SENDER_PHONE
        });
    const antiBan = getWhatsAppAntiBanConfig();
    const publicNpsLink = `${frontendUrl}/pesquisa-nps`;
    const confirmationFlow = campaignType === 'confirmacao'
      ? await getWhatsAppChatbotFlowByTriggerType({ triggerType: 'confirmacao de consulta' })
      : null;
    const batchId = `campaign-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const campaignSource = campaignType === 'nps' ? 'nps_bulk_dispatch' : 'confirmacao_massa';
    const unresolvedRecipients = [];
    let queuedCount = 0;

    for (const [index, recipient] of recipients.entries()) {
      const route = await resolveMassCampaignRecipientRoute(recipient, campaignType, req.user, sessionId);
      if (!route.resolved || !route.resolved_instance_name) {
        const routingError = route.routing_error || 'Roteamento da clínica não encontrado.';
        await saveWhatsAppCampaignRecipientRecord({
          batchId,
          campaignType,
          templateId,
          route,
          status: 'bloqueado',
          routingError,
          source: campaignSource,
          createdBy: getActorName(req.user)
        });
        unresolvedRecipients.push({
          patient_name: route.patient_name,
          patient_phone: route.patient_phone,
          clinic_name: route.clinic_name,
          error: routingError
        });
        continue;
      }

      const instanceName = route.resolved_instance_name;
      const rendered = renderGenericWhatsAppTemplate(resolvedMessage, {
        nome_paciente: route.patient_name,
        telefone: route.patient_phone,
        clinica: route.clinic_name || '',
        data_consulta: route.data_consulta || '',
        hora_consulta: route.hora_consulta || '',
        link_nps: publicNpsLink
      }).trim();
      const queued = await queueManagedWhatsAppMessage({
        actor: req.user,
        conversationPayload: {
          patient_name: route.patient_name,
          patient_phone: route.patient_phone,
          clinic_id: route.clinic_id || null,
          clinic_name: route.clinic_name || null,
          instance_name: instanceName,
          campaign: campaignType,
          status: campaignType === 'nps' ? 'NPS' : 'Em atendimento'
        },
        instanceName,
        patientPhone: route.patient_phone,
        patientName: route.patient_name,
        clinicName: route.clinic_name || null,
        clinicId: route.clinic_id || null,
        messageText: rendered,
        messageType: campaignType === 'nps' ? 'nps_bulk_invite' : 'confirmacao_massa',
        source: campaignSource,
        scheduleDelaySeconds: buildProgressiveDispatchDelaySeconds(index, antiBan),
        payload: {
          batchId,
          campaignType,
          templateId,
          link: publicNpsLink,
          triggerChatbot: campaignType !== 'nps'
        }
      });
      await saveWhatsAppCampaignRecipientRecord({
        batchId,
        campaignType,
        templateId,
        route,
        status: queued?.duplicateSuppressed ? 'duplicado' : 'enfileirado',
        source: campaignSource,
        createdBy: getActorName(req.user),
        conversationId: queued?.conversation?.id || null,
        messageId: queued?.messageId || null,
        dispatchQueueId: queued?.dispatch?.id || null
      });
      queuedCount += 1;

      if (campaignType === 'confirmacao' && confirmationFlow && queued?.conversation) {
        await primeWhatsAppChatbotSessionForFlow({
          flow: confirmationFlow,
          conversation: queued.conversation,
          collectedData: {
            campaign_type: campaignType,
            data_consulta: route.data_consulta || '',
            hora_consulta: route.hora_consulta || '',
            clinic_name: route.clinic_name || '',
            routed_instance_name: instanceName
          }
        });
      }
    }

    return res.json({
      success: true,
      message: `Campanha ${campaignType} enfileirada para ${queuedCount} paciente(s).`,
      queued: queuedCount,
      invalid: invalidRows.length + unresolvedRecipients.length,
      invalidRows,
      unresolvedRecipients,
      batchId,
      selectedClinic,
      sessionId: campaignType === 'nps' ? (sessionId || defaultInstance?.instance_name || WHATSAPP_NPS_INSTANCE_NAME) : 'automatico-por-clinica',
      antiBan
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao preparar o disparo em massa do WhatsApp.' });
  } finally {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
  }
}

async function handlePreviewMassWhatsAppCampaign(req, res) {
  try {
    if (!canConfigureWhatsAppManagement(req.user) && !hasPermission(req.user, 'whatsapp_send')) {
      return res.status(403).json({ error: 'Seu perfil não pode visualizar campanhas em massa pelo WhatsApp.' });
    }

    const campaignType = String(req.body.campaign_type || req.body.campaignType || 'confirmacao').trim().toLowerCase();
    const sessionId = sanitizeFinancialString(req.body.session_id || req.body.sessionId);
    const selectedClinic = await resolveMassCampaignSelectedClinic(req, req.user);
    const parsedUpload = req.file?.path
      ? parseMassWhatsAppRecipientsFromUpload(req.file.path, req.file.originalname)
      : parseMassWhatsAppRecipients(decodeUploadedText(req.body.recipients || req.body.content || ''));
    const recipients = applyMassCampaignSelectedClinic(parsedUpload.recipients, selectedClinic);

    if (!recipients.length) {
      return res.status(400).json({ error: 'Informe uma lista com nome e telefone para conferência da campanha.' });
    }

    const preview = await buildMassWhatsAppCampaignPreview({
      recipients,
      invalidRows: parsedUpload.invalidRows,
      campaignType,
      sessionId,
      user: req.user
    });

    return res.json({
      success: true,
      selectedClinic,
      ...preview
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao montar a prévia da campanha em massa.' });
  } finally {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
  }
}

async function handleDownloadWhatsAppCampaignTemplate(req, res) {
  try {
    const campaignType = String(req.query?.campaign_type || req.query?.campaignType || 'confirmacao').trim().toLowerCase();
    const rows = campaignType === 'nps'
      ? [
          {
            nome_paciente: 'MARIA SILVA',
            telefone: '5562999999999',
            clinica: 'GARAVELO',
            data_consulta: '',
            hora_consulta: '',
            observacao: 'Campos obrigatorios: nome_paciente e telefone'
          }
        ]
      : [
          {
            nome_paciente: 'MARIA SILVA',
            telefone: '5562999999999',
            clinica: 'GARAVELO',
            data_consulta: '26/05/2026',
            hora_consulta: '14:30',
            observacao: 'Campos obrigatorios: nome_paciente e telefone'
          }
        ];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 26 },
      { wch: 18 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
      { wch: 48 }
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pacientes');
    const filename = campaignType === 'nps'
      ? 'template-whatsapp-nps.xlsx'
      : 'template-whatsapp-confirmacao.xlsx';
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=\"${filename}\"`);
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao gerar o template Excel da campanha WhatsApp.' });
  }
}

async function ensureDefaultWhatsAppContent() {
  const defaultTemplates = [
    {
      title: 'Primeiro contato - avaliação',
      category: 'Primeiro contato',
      sector: 'CRC',
      message_text: 'Olá, {{nome_paciente}}! Tudo bem? Aqui é {{nome_operador}}, do Grupo Sorria Goiás. Estou entrando em contato para ajudar no seu atendimento e verificar a melhor agenda para você.',
      variables: ['nome_paciente', 'nome_operador']
    },
    {
      title: 'Confirmação de consulta',
      category: 'Confirmação de consulta',
      sector: 'CRC',
      message_text: 'Olá, {{nome_paciente}}! Passando para confirmar sua consulta na unidade {{clinica}} em {{data_consulta}} às {{hora_consulta}}. Podemos confirmar?',
      variables: ['nome_paciente', 'clinica', 'data_consulta', 'hora_consulta']
    },
    {
      title: 'Confirmação de atendimento em massa',
      category: 'Confirmação de consulta',
      sector: 'Confirmacao e Agendamento',
      message_text: 'Olá, {{nome_paciente}}! Tudo bem? Sou a assistente de confirmação da unidade {{clinica}} no Grupo Sorria. Seu atendimento está reservado para {{data_consulta}} às {{hora_consulta}}. Se estiver tudo certo, responda SIM. Se quiser remarcar, escreva REMARCAR. Se preferir falar com nossa equipe, responda ATENDENTE.',
      variables: ['nome_paciente', 'clinica', 'data_consulta', 'hora_consulta'],
      force_update: true
    },
    {
      title: 'NPS WhatsApp em massa',
      category: 'NPS',
      sector: 'NPS',
      message_text: 'Olá, {{nome_paciente}}! Sua opinião é essencial para nós. Em uma escala de 0 a 10, qual a nota para sua experiência na unidade {{clinica}}? Se preferir, também pode responder pela pesquisa: {{link_nps}}',
      variables: ['nome_paciente', 'clinica', 'link_nps']
    },
    {
      title: 'Retorno de ausente',
      category: 'Retorno de ausente',
      sector: 'CRC',
      message_text: 'Olá, {{nome_paciente}}! Tentamos falar com você e não conseguimos retorno. Quando puder, responda esta mensagem para darmos continuidade ao seu atendimento.',
      variables: ['nome_paciente']
    },
    {
      title: 'Nova reclamação registrada',
      category: 'Reclamação',
      sector: 'CRC',
      message_text: buildDefaultComplaintWhatsAppTemplateMessage(),
      variables: ['protocolo', 'unidade', 'responsavel', 'cidade_uf', 'data_abertura', 'link_ocorrencia'],
      force_update: true
    },
    {
      title: 'Reagendamento',
      category: 'Reagendamento',
      sector: 'CRC',
      message_text: 'Olá, {{nome_paciente}}! Sem problema, podemos verificar uma nova data para sua avaliação. Qual melhor período para você?',
      variables: ['nome_paciente']
    },
    {
      title: 'Encerramento cordial',
      category: 'Pós-atendimento',
      sector: 'CRC',
      message_text: 'Obrigada pelo retorno, {{nome_paciente}}. Seu atendimento ficou registrado em nossa central. Permanecemos à disposição pelo Grupo Sorria Goiás.',
      variables: ['nome_paciente']
    }
  ];

  for (const template of defaultTemplates) {
    await pool.query(
      `INSERT INTO whatsapp_templates
       (title, category, sector, message_text, variables, status, created_by, updated_by)
       SELECT ?, ?, ?, ?, ?, 'ativo', 'Sistema', 'Sistema'
       WHERE NOT EXISTS (SELECT 1 FROM whatsapp_templates WHERE title = ? LIMIT 1)`,
      [template.title, template.category, template.sector, template.message_text, JSON.stringify(template.variables), template.title]
    );

    if (template.force_update) {
      await pool.query(
        `UPDATE whatsapp_templates
            SET message_text = ?,
                variables = ?,
                updated_by = 'Sistema',
                updated_at = NOW()
          WHERE title = ?`,
        [template.message_text, JSON.stringify(template.variables), template.title]
      );
    }
  }

  const defaultFlows = [
    {
      flow_name: 'Confirmação automática profissional',
      instance_name: WHATSAPP_CONFIRMATION_APPOINTMENT_INSTANCE_NAME,
      sector: 'Confirmacao e Agendamento',
      trigger_type: 'confirmacao de consulta',
      trigger_value: 'confirmar',
      initial_message: 'Olá, {{nome_paciente}}! Vou cuidar da sua confirmação por aqui de forma rápida e segura.'
    },
    {
      flow_name: 'NPS conversacional profissional',
      instance_name: WHATSAPP_NPS_INSTANCE_NAME,
      sector: 'NPS',
      trigger_type: 'nps',
      trigger_value: 'nps',
      initial_message: 'Olá, {{nome_paciente}}! Obrigado por responder por aqui. Vou registrar sua percepção em poucos passos.'
    },
    {
      flow_name: 'Paciente ausente',
      instance_name: null,
      sector: 'CRC',
      trigger_type: 'paciente ausente',
      trigger_value: 'ausente',
      initial_message: 'Olá, {{nome_paciente}}! Não conseguimos falar com você. Responda esta mensagem quando puder para retomarmos seu atendimento.'
    },
    {
      flow_name: 'Fallback humano',
      instance_name: null,
      sector: 'CRC',
      trigger_type: 'palavra-chave',
      trigger_value: 'atendente',
      initial_message: 'Certo. Vou direcionar seu atendimento para um operador do CRC.'
    }
  ];

  for (const flow of defaultFlows) {
    await pool.query(
      `INSERT INTO whatsapp_chatbot_flows
       (flow_name, instance_name, sector, trigger_type, trigger_value, initial_message, status, created_by, updated_by)
       SELECT ?, ?, ?, ?, ?, ?, 'ativo', 'Sistema', 'Sistema'
       WHERE NOT EXISTS (SELECT 1 FROM whatsapp_chatbot_flows WHERE flow_name = ? LIMIT 1)`,
      [flow.flow_name, flow.instance_name || null, flow.sector || 'CRC', flow.trigger_type, flow.trigger_value, flow.initial_message, flow.flow_name]
    );
    const [savedFlowRows] = await pool.query('SELECT id FROM whatsapp_chatbot_flows WHERE flow_name = ? LIMIT 1', [flow.flow_name]);
    const savedFlowId = savedFlowRows[0]?.id || null;
    if (!savedFlowId) continue;

    await pool.query(
      `UPDATE whatsapp_chatbot_flows
          SET instance_name = ?,
              sector = ?,
              trigger_type = ?,
              trigger_value = ?,
              initial_message = ?,
              status = 'ativo',
              updated_by = 'Sistema',
              updated_at = NOW()
        WHERE id = ?`,
      [flow.instance_name || null, flow.sector || 'CRC', flow.trigger_type, flow.trigger_value, flow.initial_message, savedFlowId]
    );

    if (flow.flow_name === 'Confirmação automática profissional') {
      await saveWhatsAppFlowSteps(savedFlowId, [
          {
            step_order: 1,
            message_text: 'Para eu registrar certinho: responda SIM para confirmar, REMARCAR se quiser ajustar o horário ou ATENDENTE para falar com nossa equipe.',
            option_value: 'sim|s|ok|confirmo|confirmado|1|remarcar|reagendar|nao|não|2|atendente|humano|ajuda|3',
            action_type: 'capture_field',
            action_payload: {
              field: 'confirmation_decision',
              validation: 'choice',
              normalize_value_map: {
                sim: 'confirmado',
                s: 'confirmado',
                ok: 'confirmado',
                confirmo: 'confirmado',
                confirmado: 'confirmado',
                '1': 'confirmado',
                remarcar: 'reagendar',
                reagendar: 'reagendar',
                nao: 'reagendar',
                'não': 'reagendar',
                '2': 'reagendar',
                atendente: 'humano',
                humano: 'humano',
                ajuda: 'humano',
                '3': 'humano'
              },
              next_step_by_value: { confirmado: 2, reagendar: 3, humano: 4 },
              save_conversation_status_by_value: {
                confirmado: 'Confirmado no WhatsApp',
                reagendar: 'Retornar depois',
                humano: 'Em atendimento'
              }
            }
          },
          {
            step_order: 2,
            message_text: 'Perfeito, {{nome_paciente}}! Sua confirmação já ficou registrada no sistema da unidade {{clinica}}. Se surgir qualquer imprevisto, pode me chamar por aqui.',
            option_value: '',
            action_type: 'complete_session',
            action_payload: {}
          },
          {
            step_order: 3,
            message_text: 'Sem problema, {{nome_paciente}}. Vou encaminhar agora para nossa equipe ajustar o melhor horário com você.',
            option_value: '',
            action_type: 'assign_operator_role',
            action_payload: { role: 'sac_operator' }
          },
          {
            step_order: 4,
            message_text: 'Claro, {{nome_paciente}}. Já estou direcionando sua conversa para o Operador de SAC continuar o atendimento com você.',
            option_value: '',
            action_type: 'assign_operator_role',
            action_payload: { role: 'sac_operator' }
          }
        ]);
    } else if (flow.flow_name === 'NPS conversacional profissional') {
      await saveWhatsAppFlowSteps(savedFlowId, [
          {
            step_order: 1,
            message_text: 'De 0 a 10, qual nota você dá para a sua experiência?',
            option_value: '',
            action_type: 'capture_field',
            action_payload: { field: 'nps_score', validation: 'nps_score' }
          },
          {
            step_order: 2,
            message_text: 'Obrigado. Se quiser, escreva em uma frase o principal motivo da sua nota.',
            option_value: '',
            action_type: 'capture_field',
            action_payload: { field: 'nps_comment' }
          },
          {
            step_order: 3,
            message_text: 'Recebi sua avaliação, {{nome_paciente}}. Muito obrigado por nos ajudar a melhorar.',
            option_value: '',
            action_type: 'complete_session',
            action_payload: {}
          }
        ]);
    } else {
      await saveWhatsAppFlowSteps(savedFlowId, [
        { step_order: 1, message_text: flow.initial_message, option_value: '', action_type: 'mensagem' }
      ]);
    }
  }
}

async function handleClearWhatsAppManagementData(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode limpar a Gestão WhatsApp CRC.' });
    }

    await pool.query('DELETE FROM whatsapp_chatbot_steps');
    await pool.query('DELETE FROM whatsapp_chatbot_flows');
    await pool.query('DELETE FROM whatsapp_chatbot_sessions');
    await pool.query('DELETE FROM whatsapp_absent_patients');
    await pool.query('DELETE FROM whatsapp_dispatch_queue');
    await pool.query('DELETE FROM whatsapp_attendance_queue');
    await pool.query('DELETE FROM whatsapp_messages');
    await pool.query('DELETE FROM whatsapp_conversations');
    await pool.query('DELETE FROM whatsapp_instances');
    await pool.query('DELETE FROM whatsapp_service_message_history');
    await pool.query('DELETE FROM whatsapp_service_sessions');
    await pool.query('DELETE FROM whatsapp_templates');
    await pool.query('DELETE FROM whatsapp_evolution_logs');
    await pool.query('DELETE FROM whatsapp_operator_status');
    await pool.query('DELETE FROM whatsapp_nps_invites');
    await ensureDefaultWhatsAppCrcSessions();
    await syncDefaultWhatsAppSessionsWithClinics();
    await ensureDefaultWhatsAppContent();
    emitWhatsAppDashboardRefresh('whatsapp_management_cleared', { actor: getActorName(req.user) });
    return res.json({ success: true, message: 'Gestão WhatsApp CRC limpa, sessões oficiais e conteúdo inicial recriados.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao limpar Gestão WhatsApp CRC.' });
  }
}

async function handleGetWhatsAppDashboard(req, res) {
  try {
    const scope = buildWhatsAppScopeWhere(req.user, 'c');
    const instanceScope = buildWhatsAppInstanceScopeWhere(req.user, 'wi');
    const dashboardFilters = buildWhatsAppDashboardFilters(req.query, 'c');
    const conversationWhere = [scope.clause, ...dashboardFilters.where];
    const conversationParams = [...scope.params, ...dashboardFilters.params];
    const [instances] = await pool.query(
      `SELECT * FROM whatsapp_instances wi WHERE ${instanceScope.clause} ORDER BY display_name ASC`,
      instanceScope.params
    );
    const [conversations] = await pool.query(
      `SELECT * FROM whatsapp_conversations c WHERE ${conversationWhere.join(' AND ')}`,
      conversationParams
    );
    const [messages] = await pool.query(
      `SELECT m.*, c.status AS conversation_status
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_conversations c ON c.id = m.conversation_id
        WHERE ${conversationWhere.join(' AND ')}`,
      conversationParams
    );
    const absentScope = buildWhatsAppScopeWhere(req.user, 'a');
    const absentWhere = [absentScope.clause];
    const absentParams = [...absentScope.params];
    if (req.query.operatorId) {
      absentWhere.push('a.operator_id = ?');
      absentParams.push(req.query.operatorId);
    }
    if (req.query.clinicId) {
      absentWhere.push('a.clinic_id = ?');
      absentParams.push(req.query.clinicId);
    }
    if (req.query.status) {
      absentWhere.push('a.status = ?');
      absentParams.push(req.query.status);
    }
    const [absent] = await pool.query(
      `SELECT a.* FROM whatsapp_absent_patients a WHERE ${absentWhere.join(' AND ')}`,
      absentParams
    );
    const queueScope = buildQueueScopeWhere(req.user, 'q');
    const queueWhere = [queueScope.clause];
    const queueParams = [...queueScope.params];
    if (req.query.operatorId) {
      queueWhere.push('q.operator_id = ?');
      queueParams.push(req.query.operatorId);
    }
    if (req.query.clinicId) {
      queueWhere.push('q.clinic_id = ?');
      queueParams.push(req.query.clinicId);
    }
    if (req.query.instanceName) {
      queueWhere.push('q.instance_name = ?');
      queueParams.push(req.query.instanceName);
    }
    const [queueRows] = await pool.query(
      `SELECT q.* FROM whatsapp_attendance_queue q WHERE ${queueWhere.join(' AND ')}`,
      queueParams
    );
    const [dispatchRows] = await pool.query(
      `SELECT status, COUNT(*) AS total
         FROM whatsapp_dispatch_queue
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY status`
    );
    const [npsInviteRows] = await pool.query(
      `SELECT status, COUNT(*) AS total
         FROM whatsapp_nps_invites
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY status`
    );
    const [operatorStatusRows] = await pool.query(
      `SELECT u.id,
              u.name,
              COALESCE(wos.status, 'offline') AS status
         FROM users u
         LEFT JOIN whatsapp_operator_status wos ON wos.user_id = u.id
        WHERE ${buildWhatsAppOperatorRoleWhere('u')}
          AND COALESCE(u.active, 1) = 1
          AND u.deleted_at IS NULL`,
      getWhatsAppOperatorRoleParams()
    );
    const dispatchSummary = dispatchRows.reduce((acc, row) => {
      acc[row.status] = parseSqlCount(row, 'total');
      return acc;
    }, {});
    const npsInviteSummary = npsInviteRows.reduce((acc, row) => {
      acc[row.status] = parseSqlCount(row, 'total');
      return acc;
    }, {});

    const today = new Date().toISOString().slice(0, 10);
    const isToday = (value) => String(value || '').slice(0, 10) === today;
    const sent = messages.filter((item) => ['outbound', 'outgoing'].includes(String(item.direction || '').toLowerCase()));
    const received = messages.filter((item) => ['inbound', 'incoming'].includes(String(item.direction || '').toLowerCase()));
    const sentToday = sent.filter((item) => isToday(item.sent_at || item.created_at));
    const receivedToday = received.filter((item) => isToday(item.created_at));
    const read = messages.filter((item) => item.status === 'lida' || item.read_at);
    const erro = messages.filter((item) => item.status === 'erro');
    const waiting = conversations.filter((item) => !['Encerrado', 'Agendado', 'Compareceu'].includes(item.status));
    const responseRate = received.length ? Math.round((messages.filter((item) => item.status === 'respondida').length / received.length) * 10000) / 100 : 0;
    const readRate = sent.length ? Math.round((read.length / sent.length) * 10000) / 100 : 0;
    const errorRate = sent.length ? Math.round((erro.length / sent.length) * 10000) / 100 : 0;

    const groupBy = (items, keyFn, valueKey = 'total') => {
      const grouped = new Map();
      items.forEach((item) => {
        const key = keyFn(item) || 'Não informado';
        const current = grouped.get(key) || { label: key, [valueKey]: 0 };
        current[valueKey] += 1;
        grouped.set(key, current);
      });
      return Array.from(grouped.values()).sort((a, b) => b[valueKey] - a[valueKey]);
    };

    return res.json({
      summary: {
        totalInstances: instances.length,
        activeInstances: instances.filter((item) => item.status === 'conectado').length,
        disconnectedInstances: instances.filter((item) => item.status !== 'conectado').length,
        sentToday: sentToday.length,
        receivedToday: receivedToday.length,
        answered: messages.filter((item) => item.status === 'respondida').length,
        waitingPatients: waiting.length,
        absentPatients: absent.filter((item) => item.status !== 'Recuperado' && item.status !== 'Encerrado sem contato').length,
        averageResponseTime: 0,
        slaOk: conversations.filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at) >= new Date()).length,
        slaExpired: conversations.filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at) < new Date()).length,
        responseRate,
        readRate,
        errorRate,
        scheduledConversions: conversations.filter((item) => item.status === 'Agendado').length,
        queueWaiting: queueRows.filter((item) => item.status === 'aguardando').length,
        queueInProgress: queueRows.filter((item) => item.status === 'em_atendimento').length,
        dispatchPending: dispatchSummary.pendente || 0,
        dispatchProcessing: dispatchSummary.processando || 0,
        dispatchSent24h: dispatchSummary.enviada || 0,
        dispatchErrors24h: dispatchSummary.erro || 0,
        npsInvites24h: Object.values(npsInviteSummary).reduce((sum, value) => sum + Number(value || 0), 0),
        npsInvitesResponded24h: npsInviteSummary.respondido || 0,
        operatorsOnline: operatorStatusRows.filter((item) => item.status === 'online').length,
        operatorsAbsent: operatorStatusRows.filter((item) => item.status !== 'online').length,
        antiBan: getWhatsAppAntiBanConfig()
      },
      charts: {
        messagesByDay: groupBy(messages, (item) => String(item.created_at || '').slice(0, 10), 'messages').slice(0, 30).reverse(),
        messagesByOperator: groupBy(messages, (item) => item.operator_name, 'messages').slice(0, 15),
        messagesByInstance: groupBy(messages, (item) => item.instance_name, 'messages').slice(0, 15),
        attendanceByStatus: groupBy(conversations, (item) => item.status, 'attendances'),
        absentByPeriod: groupBy(absent, (item) => String(item.created_at || '').slice(0, 10), 'absent').slice(0, 30).reverse(),
        responseByCampaign: groupBy(conversations, (item) => item.campaign, 'attendances').slice(0, 15),
        rankingOperators: groupBy(messages, (item) => item.operator_name, 'messages').slice(0, 10),
        rankingNumbers: groupBy(messages, (item) => item.instance_name, 'messages').slice(0, 10),
        queueByStatus: groupBy(queueRows, (item) => item.status, 'attendances')
      },
      instances,
      queue: queueRows.slice(0, 50),
      recentMessages: messages.slice(-20).reverse()
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar dashboard WhatsApp.' });
  }
}

function extractEvolutionInboundMessage(body = {}) {
  const data = body.data || body;
  const key = data.key || data.message?.key || {};
  const message = data.message || data.messages?.[0]?.message || {};
  const text = message.conversation
    || message.extendedTextMessage?.text
    || message.audioMessage?.caption
    || message.documentMessage?.caption
    || message.imageMessage?.caption
    || data.text
    || data.messageText
    || '';
  const audioMessage = message.audioMessage || data.audioMessage || null;
  const mediaUrl = audioMessage?.url || data.mediaUrl || data.media_url || null;
  const remote = key.remoteJid || data.remoteJid || data.from || data.sender || '';
  const phone = normalizeWhatsAppPhone(remote);
  const fromMe = Boolean(key.fromMe || data.fromMe);

  return {
    instanceName: body.instance || body.instanceName || data.instance || data.instanceName,
    phone,
    text: text || (audioMessage ? 'Áudio recebido' : ''),
    fromMe,
    messageId: key.id || data.id || data.messageId || null,
    pushName: data.pushName || data.senderName || data.name || null,
    messageType: audioMessage ? 'audio' : 'recebida',
    mediaUrl,
    mediaMimeType: audioMessage?.mimetype || audioMessage?.mimeType || data.mediaMimeType || null
  };
}

function extractEvolutionMessageStatus(body = {}) {
  const data = body.data || body;
  const key = data.key || data.message?.key || data.update?.key || {};
  const rawStatus = String(data.status || data.message?.status || data.update?.status || body.status || '').toLowerCase();
  const messageId = key.id || data.id || data.messageId || data.message?.id || data.update?.id || null;
  let status = '';

  if (rawStatus.includes('read') || rawStatus.includes('played')) status = 'lida';
  else if (rawStatus.includes('deliver')) status = 'entregue';
  else if (rawStatus.includes('send') || rawStatus.includes('server') || rawStatus.includes('pending')) status = 'enviada';
  else if (rawStatus.includes('error') || rawStatus.includes('fail')) status = 'erro';

  return { messageId, status };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

async function primeWhatsAppChatbotSessionForFlow({ flow, conversation, collectedData = {} } = {}) {
  if (!flow?.id || !conversation?.id) return null;
  const existingSession = await findActiveWhatsAppChatbotSession({
    conversationId: conversation.id,
    phone: conversation.patient_phone,
    instanceName: conversation.instance_name
  });
  if (existingSession) return existingSession.id;

  const steps = await getWhatsAppChatbotSteps(flow.id);
  if (!steps.length) return null;
  const firstStep = steps[0];
  const [result] = await pool.query(
    `INSERT INTO whatsapp_chatbot_sessions
     (flow_id, conversation_id, instance_name, patient_phone, patient_name, current_step_order, current_step_id, last_inbound_message_id, collected_data, status, started_at, last_interaction_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'ativo', NOW(), NOW())`,
    [
      flow.id,
      conversation.id,
      conversation.instance_name || null,
      conversation.patient_phone,
      conversation.patient_name,
      Number(firstStep.step_order || 1),
      firstStep.id,
      stringifyWhatsAppChatbotPayload(collectedData || {})
    ]
  );
  return result.insertId;
}

async function getRecentConfirmationChatbotResponses(limit = 120, user = null) {
  const scope = buildWhatsAppScopeWhere(user, 'c');
  const [rows] = await pool.query(
    `SELECT s.*,
            f.flow_name,
            c.status AS conversation_status,
            c.clinic_name,
            c.instance_name,
            c.operator_name
       FROM whatsapp_chatbot_sessions s
       INNER JOIN whatsapp_chatbot_flows f ON f.id = s.flow_id
       LEFT JOIN whatsapp_conversations c ON c.id = s.conversation_id
      WHERE f.trigger_type = 'confirmacao de consulta'
        AND ${scope.clause}
      ORDER BY COALESCE(s.completed_at, s.last_interaction_at, s.started_at) DESC
      LIMIT ?`,
    [...scope.params, Math.max(1, Number(limit || 120))]
  );

  return rows.map((row) => {
    const collected = normalizeChatbotSessionData(row.collected_data);
    const decision = String(collected.confirmation_decision || '').trim().toLowerCase();
    const decisionLabel = decision === 'confirmado'
      ? 'Confirmado'
      : decision === 'reagendar'
        ? 'Pediu reagendamento'
        : decision === 'humano'
          ? 'Solicitou atendimento humano'
          : 'Sem resposta conclusiva';
    return {
      ...row,
      collected_data: collected,
      confirmation_decision: decision || null,
      confirmation_label: decisionLabel,
      confirmation_confirmed: decision === 'confirmado'
    };
  });
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function normalizeWhatsAppJidPhone(value) {
  const raw = String(value || '').split('@')[0];
  return normalizeWhatsAppPhone(raw);
}

function toBooleanValue(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'sim'].includes(text);
}

function mapWhatsAppServiceAckStatus(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (['-1', 'error', 'failed', 'failure'].includes(raw)) return 'erro';
  if (['0', 'pending', 'queued'].includes(raw)) return 'pendente';
  if (['1', 'server', 'sent', 'send', 'enviada'].includes(raw)) return 'enviada';
  if (['2', 'delivered', 'delivery', 'entregue'].includes(raw)) return 'entregue';
  if (['3', '4', 'read', 'played', 'lida'].includes(raw)) return 'lida';
  return '';
}

function extractWhatsAppServiceMessageId(data = {}) {
  const id = data.id
    || data.key
    || data.messageId
    || data.whatsapp_message_id
    || data.whatsappMessageId
    || data._serialized
    || data._data?.id
    || data.message?.id
    || data.message?.key
    || data.message?.messageId;
  if (typeof id === 'string') return id;
  return id?._serialized || id?.id || data.key?.id || data.message?.key?.id || data.message?.id || null;
}

function getWhatsAppServiceEventCandidates(body = {}) {
  const data = body.data || {};
  const eventData = body.eventData || body.event_data || {};
  const payload = body.payload || {};
  const candidates = [
    body,
    data,
    eventData,
    payload,
    typeof body.message === 'object' ? body.message : null,
    typeof data.message === 'object' ? data.message : null,
    typeof eventData.message === 'object' ? eventData.message : null,
    typeof payload.message === 'object' ? payload.message : null,
    Array.isArray(data.messages) ? data.messages[0] : null,
    Array.isArray(eventData.messages) ? eventData.messages[0] : null,
    Array.isArray(payload.messages) ? payload.messages[0] : null,
    data.message?.message,
    eventData.message?.message,
    payload.message?.message,
    body.message?.message,
    data._data,
    eventData._data,
    payload._data,
    body._data
  ].filter((item) => item && typeof item === 'object');

  return candidates;
}

function extractWhatsAppServiceEventMessage(body = {}) {
  const candidates = getWhatsAppServiceEventCandidates(body);
  const primary = candidates[0] || body;
  const messageNode = candidates.find((item) => item.body || item.from || item.to || item.id || item.key || item._data?.id) || primary;
  const idObject = messageNode.id
    || messageNode.key
    || messageNode._data?.id
    || primary.id
    || primary.key
    || {};
  const fromMe = toBooleanValue(firstNonEmpty(...candidates.map((item) => item.fromMe), idObject.fromMe));
  const from = firstNonEmpty(
    ...candidates.flatMap((item) => [
      item.from,
      item.author,
      item.sender,
      item.remoteJid,
      item._data?.from,
      item._data?.id?.remote,
      item._data?.id?.remoteJid
    ]),
    idObject.remote,
    idObject.remoteJid
  );
  const to = firstNonEmpty(
    ...candidates.flatMap((item) => [
      item.to,
      item.recipient,
      item._data?.to
    ])
  );
  const phone = normalizeWhatsAppJidPhone(fromMe ? to || from : from || to);
  const text = firstNonEmptyString(
    typeof body.message === 'string' ? body.message : null,
    ...candidates.flatMap((item) => [
      item.body,
      item.text,
      item.message,
      item.message?.text,
      item.message?.body,
      item.content,
      item.caption,
      item._data?.body,
      item.rawData?.body,
      item.extendedTextMessage?.text,
      item.conversation,
      item.message?.conversation,
      item.message?.extendedTextMessage?.text,
      item.message?.imageMessage?.caption,
      item.message?.documentMessage?.caption,
      item.message?.videoMessage?.caption
    ])
  );
  const type = firstNonEmpty(...candidates.map((item) => item.type), ...candidates.map((item) => item.messageType), body.messageType) || 'chat';
  const hasMedia = candidates.some((item) => Boolean(item.hasMedia || item.mediaUrl || item.media_url || item.downloadUrl || item.url));
  const mediaUrl = firstNonEmpty(...candidates.flatMap((item) => [item.mediaUrl, item.media_url, item.downloadUrl, item.url]));
  const mediaMimeType = firstNonEmpty(...candidates.flatMap((item) => [item.mimetype, item.mimeType, item.mediaMimeType, item.media_mime_type]));

  return {
    sessionId: firstNonEmpty(
      body.sessionId,
      body.session_id,
      body.instanceName,
      body.instance,
      ...candidates.flatMap((item) => [item.sessionId, item.session_id, item.instanceName, item.instance])
    ),
    phone,
    text: text || (hasMedia ? `[Mídia recebida: ${type}]` : ''),
    fromMe,
    messageId: extractWhatsAppServiceMessageId(messageNode) || extractWhatsAppServiceMessageId(primary),
    pushName: firstNonEmpty(...candidates.flatMap((item) => [item.notifyName, item.pushName, item.senderName, item.name]), body.patientName, body.patient_name),
    messageType: String(type || '').toLowerCase(),
    mediaUrl,
    mediaMimeType,
    raw: messageNode
  };
}

function extractWhatsAppServiceStatusEvent(body = {}) {
  const candidates = getWhatsAppServiceEventCandidates(body);
  const data = candidates[0] || body;
  const eventName = String(firstNonEmpty(body.event, body.type, ...candidates.flatMap((item) => [item.event, item.type])) || '').toLowerCase();
  const messageId = candidates.map((item) => extractWhatsAppServiceMessageId(item)).find(Boolean) || null;
  const status = mapWhatsAppServiceAckStatus(firstNonEmpty(...candidates.flatMap((item) => [item.ack, item.status]), body.ack, body.status));
  return {
    eventName,
    messageId,
    status,
    sessionId: firstNonEmpty(body.sessionId, body.session_id, body.instanceName, body.instance, ...candidates.flatMap((item) => [item.sessionId, item.session_id, item.instanceName, item.instance]))
  };
}

async function assertWhatsAppServiceEventAuthorized(req) {
  const settings = await loadWhatsAppSettingsCache();
  const acceptedTokens = [
    process.env.WHATSAPP_EVENTS_TOKEN,
    process.env.WHATSAPP_SERVICE_WEBHOOK_TOKEN,
    process.env.WHATSAPP_WEBHOOK_TOKEN,
    process.env.WHATSAPP_API_KEY,
    process.env.WHATSAPP_SERVICE_API_KEY,
    whatsappVpsService.getConfig().apiKey,
    settings?.apiKey
  ].map((token) => String(token || '').trim()).filter(Boolean);

  if (!acceptedTokens.length && process.env.NODE_ENV !== 'production') return true;

  const provided = String(
    req.headers['x-api-key']
      || req.headers['x-webhook-token']
      || req.headers['x-whatsapp-token']
      || req.query?.token
      || req.query?.api_key
      || req.body?.token
      || req.body?.apiKey
      || req.body?.api_key
      || req.headers.authorization
      || ''
  ).replace(/^Bearer\s+/i, '').trim();

  if (provided && acceptedTokens.includes(provided)) return true;

  const allowedIps = String(process.env.WHATSAPP_SERVICE_ALLOWED_IPS || '2.24.101.6')
    .split(/[,\s;]+/)
    .map((item) => item.trim().replace(/^::ffff:/, ''))
    .filter(Boolean);
  const forwardedFor = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((item) => item.trim());
  const remoteCandidates = [
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
    ...forwardedFor
  ].map((item) => String(item || '').replace(/^::ffff:/, '').trim()).filter(Boolean);

  return remoteCandidates.some((ip) => allowedIps.includes(ip));
}

async function getWhatsAppInstanceSnapshot(instanceName) {
  if (!instanceName) return null;
  const [rows] = await pool.query(
    `SELECT instance_name, display_name, clinic_id, clinic_name, unit_name, status, operator_id, operator_name
       FROM whatsapp_instances
      WHERE instance_name = ?
      LIMIT 1`,
    [instanceName]
  );
  return rows[0] || null;
}

async function updateWhatsAppServiceSessionStatusFromEvent(sessionId, status, rawPayload = {}) {
  if (!sessionId || !status) return null;
  await pool.query(
    `INSERT INTO whatsapp_instances
     (instance_name, display_name, sector, status, last_status_check_at, created_by, updated_by)
     VALUES (?, ?, 'CRC', ?, NOW(), 'whatsapp-service', 'whatsapp-service')
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       last_status_check_at = NOW(),
       updated_by = VALUES(updated_by)`,
    [sessionId, sessionId, status]
  );
  await pool.query(
    `INSERT INTO whatsapp_service_sessions
     (session_id, display_name, status, last_status_payload, last_status_check_at, last_connected_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, NOW(), CASE WHEN ? = 'conectado' THEN NOW() ELSE NULL END, 'whatsapp-service', 'whatsapp-service')
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       last_status_payload = VALUES(last_status_payload),
       last_status_check_at = NOW(),
       last_connected_at = CASE WHEN VALUES(status) = 'conectado' THEN NOW() ELSE last_connected_at END,
       updated_by = VALUES(updated_by)`,
    [sessionId, sessionId, status, serializeEvolutionPayload(rawPayload), status]
  );
  emitWhatsAppRealtime('whatsapp:session:changed', {
    sessionId,
    status,
    at: new Date().toISOString()
  });
  emitWhatsAppDashboardRefresh('session_status', { sessionId, status });
  return { sessionId, status };
}

async function updateWhatsAppMessageStatusFromProvider(messageId, status, rawPayload = {}) {
  if (!messageId || !status) return null;
  await pool.query(
    `UPDATE whatsapp_messages
        SET status = ?,
            delivered_at = CASE WHEN ? IN ('entregue', 'lida') THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
            read_at = CASE WHEN ? = 'lida' THEN COALESCE(read_at, NOW()) ELSE read_at END,
            updated_at = NOW()
      WHERE whatsapp_message_id = ?
         OR evolution_message_id = ?`,
    [status, status, status, messageId, messageId]
  );
  const [messages] = await pool.query(
    `SELECT *
       FROM whatsapp_messages
      WHERE whatsapp_message_id = ?
         OR evolution_message_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [messageId, messageId]
  );
  if (messages[0]) {
    const conversation = messages[0].conversation_id ? await getWhatsAppConversationById(messages[0].conversation_id) : null;
    emitWhatsAppMessageChange('status', messages[0], conversation || {});
  }
  await logEvolutionEvent('whatsapp_service_message_status', {
    status: 'info',
    instanceName: rawPayload.sessionId || rawPayload.instanceName || null,
    messageId: messages[0]?.id || null,
    conversationId: messages[0]?.conversation_id || null,
    response: rawPayload
  });
  return messages[0] || null;
}

async function persistWhatsAppServiceMessageEvent(body = {}) {
  const inbound = extractWhatsAppServiceEventMessage(body);
  if (!inbound.sessionId || !inbound.phone || !inbound.text) {
    return { ignored: true, reason: 'missing_message_fields', extracted: inbound };
  }

  if (inbound.messageId) {
    const [existing] = await pool.query(
      `SELECT *
         FROM whatsapp_messages
        WHERE whatsapp_message_id = ?
           OR evolution_message_id = ?
        LIMIT 1`,
      [inbound.messageId, inbound.messageId]
    );
    if (existing[0]) {
      const status = inbound.fromMe ? 'enviada' : 'recebida';
      await updateWhatsAppMessageStatusFromProvider(inbound.messageId, status, { ...body, sessionId: inbound.sessionId });
      return { ignored: true, duplicate: true, messageId: existing[0].id, conversationId: existing[0].conversation_id };
    }
  }

  const instance = await getWhatsAppInstanceSnapshot(inbound.sessionId);
  const conversation = await findOrCreateWhatsAppConversation({
    patient_name: inbound.pushName || 'Paciente WhatsApp',
    patient_phone: inbound.phone,
    phone: inbound.phone,
    clinic_id: instance?.clinic_id || null,
    clinic_name: instance?.clinic_name || instance?.display_name || null,
    unit_name: instance?.unit_name || null,
    operator_id: instance?.operator_id || null,
    operator_name: instance?.operator_name || null,
    instance_name: inbound.sessionId,
    session_id: inbound.sessionId,
    source: inbound.fromMe ? 'WhatsApp conectado' : 'WhatsApp paciente',
    status: inbound.fromMe || instance?.operator_id ? 'Em atendimento' : 'Novo'
  }, { id: null, name: 'whatsapp-service', role: 'webhook' });

  const messageId = await insertWhatsAppMessage({
    conversation_id: conversation.id,
    instance_name: inbound.sessionId,
    session_id: inbound.sessionId,
    patient_phone: inbound.phone,
    phone: inbound.phone,
    patient_name: conversation.patient_name || inbound.pushName || null,
    direction: inbound.fromMe ? 'outbound' : 'inbound',
    message_text: inbound.text,
    message: inbound.text,
    message_type: inbound.messageType || (inbound.fromMe ? 'whatsapp_device' : 'paciente'),
    source: inbound.fromMe ? 'whatsapp_device' : 'patient',
    status: inbound.fromMe ? 'enviada' : 'recebida',
    evolution_message_id: inbound.messageId,
    whatsapp_message_id: inbound.messageId,
    operator_id: inbound.fromMe ? conversation.operator_id || null : null,
    operator_name: inbound.fromMe ? conversation.operator_name || 'WhatsApp conectado' : null,
    clinic_id: conversation.clinic_id,
    clinic_name: conversation.clinic_name,
    campaign: conversation.campaign,
    sent_at: inbound.fromMe ? new Date() : null,
    media_url: inbound.mediaUrl,
    media_mime_type: inbound.mediaMimeType
  });

  if (!inbound.fromMe) {
    await pool.query(
      `UPDATE whatsapp_messages
          SET status = 'respondida',
              responded_at = NOW(),
              updated_at = NOW()
        WHERE conversation_id = ?
          AND direction IN ('outbound', 'outgoing')
          AND status IN ('pendente', 'enviada', 'entregue', 'lida')
        ORDER BY created_at DESC
        LIMIT 1`,
      [conversation.id]
    );
  }

  await pool.query(
    `UPDATE whatsapp_conversations
        SET last_message_at = NOW(),
            unread_count = CASE WHEN ? = 1 THEN unread_count + 1 ELSE unread_count END,
            status = CASE WHEN status = 'Encerrado' AND ? = 1 THEN 'Novo' ELSE status END,
            updated_at = NOW()
      WHERE id = ?`,
    [inbound.fromMe ? 0 : 1, inbound.fromMe ? 0 : 1, conversation.id]
  );

  const updatedConversation = await getWhatsAppConversationById(conversation.id);
  await syncWhatsAppAttendanceQueue(updatedConversation, updatedConversation.operator_id ? 'em_atendimento' : 'aguardando');
  if (!inbound.fromMe) {
    await autoAssignWhatsAppQueue({ name: 'Fila automática', role: 'system' });
  }
  const message = await getWhatsAppMessageById(messageId);
  if (!inbound.fromMe && updatedConversation && message) {
    await processWhatsAppChatbotInbound({ conversation: updatedConversation, inboundMessage: message });
  }
  emitWhatsAppConversationChange(inbound.fromMe ? 'provider_outgoing_message' : 'inbound_message', updatedConversation);
  emitWhatsAppMessageChange(inbound.fromMe ? 'sent_from_device' : 'received', message, updatedConversation);
  await logEvolutionEvent('whatsapp_service_message_event', {
    status: 'success',
    instanceName: inbound.sessionId,
    messageId,
    conversationId: conversation.id,
    response: body
  });

  return { success: true, messageId, conversationId: conversation.id, direction: message.direction };
}

async function handleWhatsAppServiceEvents(req, res) {
  try {
    const authorized = await assertWhatsAppServiceEventAuthorized(req);
    if (!authorized) {
      return res.status(401).json({ error: 'Evento WhatsApp não autorizado.' });
    }

    const statusEvent = extractWhatsAppServiceStatusEvent(req.body || {});
    const eventName = statusEvent.eventName;

    if (statusEvent.messageId
      && statusEvent.status
      && (!eventName || eventName.includes('ack') || eventName.includes('status') || eventName.includes('delivered') || eventName.includes('read'))) {
      const message = await updateWhatsAppMessageStatusFromProvider(statusEvent.messageId, statusEvent.status, {
        ...req.body,
        sessionId: statusEvent.sessionId
      });
      return res.json({ success: true, type: 'message_status', updated: Boolean(message) });
    }

    if (eventName.includes('session') || eventName.includes('qr') || eventName.includes('connect') || eventName.includes('disconnect')) {
      const rawStatus = firstNonEmpty(req.body?.status, req.body?.data?.status, req.body?.state, req.body?.data?.state, eventName);
      const mappedStatus = mapWhatsAppServiceStatus({ status: rawStatus }, eventName.includes('qr') ? 'aguardando_qrcode' : 'iniciando');
      const sessionId = statusEvent.sessionId || req.body?.sessionId || req.body?.session_id;
      const updated = await updateWhatsAppServiceSessionStatusFromEvent(sessionId, mappedStatus, req.body);
      return res.json({ success: true, type: 'session_status', updated: Boolean(updated), status: mappedStatus });
    }

    const persisted = await persistWhatsAppServiceMessageEvent(req.body || {});
    if (persisted?.ignored) {
      await logEvolutionEvent('whatsapp_service_event_ignored', {
        status: 'warning',
        request: req.body,
        response: persisted
      });
    }
    return res.json(persisted);
  } catch (error) {
    console.error(error);
    await logEvolutionEvent('whatsapp_service_event_error', {
      status: 'error',
      request: req.body,
      error
    });
    return res.status(500).json({ error: 'Erro ao processar evento do whatsapp-service.' });
  }
}

async function handleEvolutionWebhook(req, res) {
  try {
    const configuredToken = String(process.env.EVOLUTION_WEBHOOK_TOKEN || '').trim();
    if (configuredToken) {
      const provided = String(req.headers.authorization || req.headers['x-webhook-token'] || '').replace(/^Bearer\s+/i, '').trim();
      if (provided !== configuredToken) {
        return res.status(401).json({ error: 'Webhook não autorizado.' });
      }
    }

    const eventName = String(req.body?.event || req.body?.type || '').toUpperCase();

    if (eventName.includes('MESSAGES_UPDATE') || eventName.includes('SEND_MESSAGE')) {
      const update = extractEvolutionMessageStatus(req.body || {});
      if (update.messageId && update.status) {
        await pool.query(
          `UPDATE whatsapp_messages
              SET status = ?,
                  delivered_at = CASE WHEN ? IN ('entregue', 'lida') THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
                  read_at = CASE WHEN ? = 'lida' THEN COALESCE(read_at, NOW()) ELSE read_at END
            WHERE evolution_message_id = ?`,
          [update.status, update.status, update.status, update.messageId]
        );
        const [messages] = await pool.query('SELECT * FROM whatsapp_messages WHERE evolution_message_id = ? LIMIT 1', [update.messageId]);
        if (messages[0]) {
          const conversation = messages[0].conversation_id ? await getWhatsAppConversationById(messages[0].conversation_id) : null;
          emitWhatsAppMessageChange('status', messages[0], conversation || {});
        }
      }
      return res.json({ success: true, statusUpdated: Boolean(update.messageId && update.status) });
    }

    const inbound = extractEvolutionInboundMessage(req.body || {});
    if (!inbound.phone || !inbound.text || inbound.fromMe) {
      return res.json({ ignored: true });
    }

    const conversation = await findOrCreateWhatsAppConversation({
      patient_name: inbound.pushName || 'Paciente WhatsApp',
      patient_phone: inbound.phone,
      instance_name: inbound.instanceName,
      source: 'WhatsApp',
      status: 'Novo'
    }, { id: null, name: 'Integração WhatsApp', role: 'webhook' });

    const inboundMessageId = await insertWhatsAppMessage({
      conversation_id: conversation.id,
      instance_name: inbound.instanceName,
      patient_phone: inbound.phone,
      direction: 'inbound',
      message_text: inbound.text,
      message_type: inbound.messageType || 'paciente',
      status: 'recebida',
      evolution_message_id: inbound.messageId,
      clinic_id: conversation.clinic_id,
      clinic_name: conversation.clinic_name,
      campaign: conversation.campaign,
      media_url: inbound.mediaUrl,
      media_mime_type: inbound.mediaMimeType
    });

    await pool.query(
      `UPDATE whatsapp_messages
          SET status = 'respondida',
              responded_at = NOW()
        WHERE conversation_id = ?
          AND direction = 'outbound'
          AND status IN ('pendente', 'enviada', 'entregue', 'lida')
        ORDER BY created_at DESC
        LIMIT 1`,
      [conversation.id]
    );

    await pool.query(
      'UPDATE whatsapp_conversations SET last_message_at = NOW(), status = CASE WHEN status = "Encerrado" THEN "Novo" ELSE status END WHERE id = ?',
      [conversation.id]
    );

    const updatedConversation = await getWhatsAppConversationById(conversation.id);
    await syncWhatsAppAttendanceQueue(updatedConversation, updatedConversation.operator_id ? 'em_atendimento' : 'aguardando');
    await autoAssignWhatsAppQueue({ name: 'Fila automática', role: 'system' });
    const inboundMessage = await getWhatsAppMessageById(inboundMessageId);
    if (updatedConversation && inboundMessage) {
      await processWhatsAppChatbotInbound({ conversation: updatedConversation, inboundMessage });
    }
    emitWhatsAppConversationChange('inbound_message', updatedConversation);
    emitWhatsAppMessageChange('received', inboundMessage, updatedConversation);

    return res.json({ success: true, conversationId: conversation.id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao processar webhook Evolution.' });
  }
}

app.post('/api/test-whatsapp', authenticate, requireAdmin, async (req, res) => {
  return handleManualWhatsAppSend(req, res, 'manual_test');
});

app.post('/api/whatsapp/enviar', authenticate, requireMasterAdmin, async (req, res) => {
  return handleManualWhatsAppSend(req, res, 'manual_send');
});

app.get('/api/whatsapp/config/status', authenticate, requireWhatsAppView, handleGetWhatsAppConfigStatus);
app.get('/api/admin/whatsapp-settings', authenticate, handleGetWhatsAppAdminSettings);
app.put('/api/admin/whatsapp-settings', authenticate, handleUpdateWhatsAppAdminSettings);
app.post('/api/admin/whatsapp-settings/test', authenticate, handleTestWhatsAppAdminSettings);
app.delete('/api/admin/whatsapp-management/data', authenticate, handleClearWhatsAppManagementData);
app.post('/api/admin/whatsapp-reminders/daily-open-demands/run', authenticate, requireMasterAdmin, handleRunDailyOpenDemandWhatsAppReminders);
app.post('/api/admin/whatsapp-reports/daily-coordinator-delivery/run', authenticate, requireMasterAdmin, handleRunDailyCoordinatorDeliveryReport);
app.post('/api/admin/whatsapp-reports/weekly-complaints/run', authenticate, requireMasterAdmin, handleRunWeeklyAdminComplaintReport);
app.post('/api/admin/complaints/repair-coordinator-assignments', authenticate, requireMasterAdmin, handleRepairCoordinatorAssignments);
app.get('/api/whatsapp/sessions', authenticate, requireWhatsAppView, handleListWhatsAppWebSessions);
app.get('/api/whatsapp/sessions/:id/qr', authenticate, requireWhatsAppView, handleGetWhatsAppWebSessionQr);
app.get('/api/admin/whatsapp-service/sessions', authenticate, requireMasterAdmin, handleListWhatsAppServiceSessions);
app.post('/api/admin/whatsapp-service/sessions', authenticate, requireMasterAdmin, handleCreateWhatsAppServiceSession);
app.put('/api/admin/whatsapp-service/sessions/:sessionId', authenticate, requireMasterAdmin, handleUpdateWhatsAppServiceSession);
app.delete('/api/admin/whatsapp-service/sessions/:sessionId', authenticate, requireMasterAdmin, handleDeleteWhatsAppServiceSession);
app.get('/api/admin/whatsapp-service/sessions/:sessionId/status', authenticate, requireMasterAdmin, handleGetWhatsAppServiceSessionStatus);
app.get('/api/admin/whatsapp-service/sessions/:sessionId/qr-image', authenticate, requireMasterAdmin, handleGetWhatsAppServiceQrImage);
app.post('/api/admin/whatsapp-service/messages/send', authenticate, requireMasterAdmin, handleSendWhatsAppServiceMessage);
app.get('/api/admin/whatsapp-service/messages/history', authenticate, requireMasterAdmin, handleListWhatsAppServiceHistory);

app.get('/api/whatsapp/instances', authenticate, requireWhatsAppView, handleGetWhatsAppInstances);
app.post('/api/whatsapp/instances', authenticate, requireWhatsAppView, handleCreateWhatsAppInstance);
app.put('/api/whatsapp/instances/:instanceName', authenticate, requireWhatsAppView, handleUpdateWhatsAppInstance);
app.get('/api/whatsapp/instances/:instanceName/qrcode', authenticate, requireWhatsAppView, handleWhatsAppInstanceQrCode);
app.get('/api/whatsapp/instances/:instanceName/status', authenticate, requireWhatsAppView, handleWhatsAppInstanceStatus);
app.post('/api/whatsapp/instances/:instanceName/reconnect', authenticate, requireWhatsAppView, handleWhatsAppInstanceReconnect);
app.post('/api/whatsapp/instances/:instanceName/logout', authenticate, requireWhatsAppView, handleWhatsAppInstanceLogout);
app.put('/api/whatsapp/instances/:instanceName/assignment', authenticate, requireWhatsAppView, handleUpdateWhatsAppInstanceAssignment);
app.delete('/api/whatsapp/instances/:instanceName', authenticate, requireWhatsAppView, handleDeleteWhatsAppInstance);

app.post('/api/whatsapp/send', authenticate, requireWhatsAppView, handleSendWhatsAppManagementMessage);
app.post('/api/whatsapp/send-template', authenticate, requireWhatsAppView, handleSendWhatsAppTemplate);
app.post('/api/whatsapp/messages/:id/resend', authenticate, requireWhatsAppView, handleResendWhatsAppMessage);
app.delete('/api/whatsapp/messages/:id', authenticate, requireWhatsAppView, handleDeleteWhatsAppMessage);

app.get('/api/whatsapp/operators', authenticate, requireWhatsAppView, handleGetWhatsAppOperators);
app.put('/api/whatsapp/operators/:id/clinics', authenticate, requireWhatsAppView, handleUpdateWhatsAppOperatorClinics);
app.get('/api/whatsapp/operator-status', authenticate, requireWhatsAppView, handleGetWhatsAppOperatorStatus);
app.put('/api/whatsapp/operator-status', authenticate, requireWhatsAppView, handleUpdateWhatsAppOperatorStatus);
app.get('/api/whatsapp/queue', authenticate, requireWhatsAppView, handleGetWhatsAppQueue);
app.post('/api/whatsapp/queue/auto-assign', authenticate, requireWhatsAppView, handleAutoAssignWhatsAppQueue);

app.get('/api/whatsapp/templates', authenticate, requireWhatsAppView, handleGetWhatsAppTemplates);
app.post('/api/whatsapp/templates', authenticate, requireWhatsAppView, handleCreateWhatsAppTemplate);
app.put('/api/whatsapp/templates/:id', authenticate, requireWhatsAppView, handleUpdateWhatsAppTemplate);
app.delete('/api/whatsapp/templates/:id', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode excluir mensagens padrão.' });
    }
    await pool.query('DELETE FROM whatsapp_templates WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir mensagem padrão.' });
  }
});

app.get('/api/whatsapp/conversations', authenticate, requireWhatsAppView, handleGetWhatsAppConversations);
app.post('/api/whatsapp/conversations', authenticate, requireWhatsAppView, handleCreateWhatsAppConversation);
app.put('/api/whatsapp/conversations/:id', authenticate, requireWhatsAppView, handleUpdateWhatsAppConversation);
app.post('/api/whatsapp/conversations/:id/claim', authenticate, requireWhatsAppView, handleClaimWhatsAppConversation);
app.post('/api/whatsapp/conversations/:id/transfer', authenticate, requireWhatsAppView, handleTransferWhatsAppConversation);
app.get('/api/whatsapp/conversations/:id/messages', authenticate, requireWhatsAppView, handleGetWhatsAppConversationMessages);

app.get('/api/whatsapp/absent', authenticate, requireWhatsAppView, handleGetWhatsAppAbsent);
app.post('/api/whatsapp/absent', authenticate, requireWhatsAppView, handleCreateWhatsAppAbsent);
app.put('/api/whatsapp/absent/:id', authenticate, requireWhatsAppView, handleUpdateWhatsAppAbsent);

app.get('/api/whatsapp/chatbot/flows', authenticate, requireWhatsAppView, handleGetWhatsAppFlows);
app.get('/api/whatsapp/chatbot/sessions', authenticate, requireWhatsAppView, handleGetWhatsAppChatbotSessions);
app.get('/api/whatsapp/confirmation/responses', authenticate, requireWhatsAppView, handleGetWhatsAppConfirmationResponses);
app.post('/api/whatsapp/chatbot/bootstrap-defaults', authenticate, requireWhatsAppView, handleBootstrapProfessionalWhatsAppFlows);
app.post('/api/whatsapp/chatbot/flows', authenticate, requireWhatsAppView, handleCreateWhatsAppFlow);
app.put('/api/whatsapp/chatbot/flows/:id', authenticate, requireWhatsAppView, handleUpdateWhatsAppFlow);
app.delete('/api/whatsapp/chatbot/flows/:id', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode excluir fluxos de chatbot.' });
    }
    await pool.query('DELETE FROM whatsapp_chatbot_steps WHERE flow_id = ?', [req.params.id]);
    await pool.query('DELETE FROM whatsapp_chatbot_flows WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir fluxo.' });
  }
});

app.get('/api/whatsapp/dashboard', authenticate, requireWhatsAppView, handleGetWhatsAppDashboard);
app.get('/api/whatsapp/history', authenticate, requireWhatsAppView, handleGetWhatsAppHistory);
app.get('/api/whatsapp/campaigns/template', authenticate, requireWhatsAppView, handleDownloadWhatsAppCampaignTemplate);
app.post('/api/whatsapp/campaigns/preview', authenticate, requireWhatsAppView, upload.single('file'), handlePreviewMassWhatsAppCampaign);
app.post('/api/whatsapp/campaigns/mass-send', authenticate, requireWhatsAppView, upload.single('file'), handleMassWhatsAppCampaignSend);
app.get('/api/whatsapp/evolution-logs', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode visualizar logs da integração WhatsApp.' });
    }
    const limit = Math.min(300, Math.max(20, Number(req.query.limit || 120)));
    const [rows] = await pool.query(
      `SELECT *
         FROM whatsapp_evolution_logs
        ORDER BY created_at DESC
        LIMIT ${limit}`
    );
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar logs da integração WhatsApp.' });
  }
});

app.get('/api/partners-video/contacts', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM partner_video_contacts ORDER BY active DESC, clinic_name ASC, partner_name ASC');
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar parceiros de vídeo.' });
  }
});

app.post('/api/partners-video/contacts', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode cadastrar parceiros.' });
    }
    const clinicName = sanitizeFinancialString(req.body.clinic_name || req.body.clinicName, 180);
    const partnerName = sanitizeFinancialString(req.body.partner_name || req.body.partnerName, 220);
    if (!clinicName || !partnerName) return res.status(400).json({ error: 'Informe unidade e parceiro.' });
    const phone = normalizeWhatsAppPhone(req.body.phone_number || req.body.phoneNumber || '');
    const [result] = await pool.query(
      `INSERT INTO partner_video_contacts
       (clinic_name, partner_name, phone_number, active, receives_automatic_message, default_send_time, allowed_weekdays, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clinicName,
        partnerName,
        phone || null,
        req.body.active === undefined ? 1 : (req.body.active ? 1 : 0),
        req.body.receives_automatic_message === undefined ? 1 : (req.body.receives_automatic_message ? 1 : 0),
        req.body.default_send_time || req.body.defaultSendTime || '08:00:00',
        req.body.allowed_weekdays || req.body.allowedWeekdays || '1,2,3,4,5,6',
        sanitizeFinancialString(req.body.notes, 2000)
      ]
    );
    await logPartnerVideoEvent({ contactId: result.insertId, eventType: 'contact_created', status: 'info', createdBy: getActorName(req.user) });
    const [rows] = await pool.query('SELECT * FROM partner_video_contacts WHERE id = ? LIMIT 1', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao cadastrar parceiro.' });
  }
});

app.put('/api/partners-video/contacts/:id', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode editar parceiros.' });
    }
    const phone = normalizeWhatsAppPhone(req.body.phone_number || req.body.phoneNumber || '');
    await pool.query(
      `UPDATE partner_video_contacts
          SET clinic_name = ?,
              partner_name = ?,
              phone_number = ?,
              active = ?,
              receives_automatic_message = ?,
              default_send_time = ?,
              allowed_weekdays = ?,
              notes = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        sanitizeFinancialString(req.body.clinic_name || req.body.clinicName, 180),
        sanitizeFinancialString(req.body.partner_name || req.body.partnerName, 220),
        phone || null,
        req.body.active ? 1 : 0,
        req.body.receives_automatic_message ? 1 : 0,
        req.body.default_send_time || req.body.defaultSendTime || '08:00:00',
        req.body.allowed_weekdays || req.body.allowedWeekdays || '1,2,3,4,5,6',
        sanitizeFinancialString(req.body.notes, 2000),
        req.params.id
      ]
    );
    await logPartnerVideoEvent({ contactId: req.params.id, eventType: 'contact_updated', status: 'info', createdBy: getActorName(req.user) });
    const [rows] = await pool.query('SELECT * FROM partner_video_contacts WHERE id = ? LIMIT 1', [req.params.id]);
    return res.json(rows[0] || null);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao editar parceiro.' });
  }
});

app.delete('/api/partners-video/contacts/:id', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode excluir parceiros.' });
    }
    await pool.query('DELETE FROM partner_video_contacts WHERE id = ?', [req.params.id]);
    await logPartnerVideoEvent({ contactId: req.params.id, eventType: 'contact_deleted', status: 'info', createdBy: getActorName(req.user) });
    return res.json({ message: 'Parceiro removido.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir parceiro.' });
  }
});

app.get('/api/partners-video/dashboard', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    return res.json(await getPartnerVideoDashboardData());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar dashboard de vídeos dos parceiros.' });
  }
});

app.get('/api/partners-video/settings', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    return res.json(await getPartnerVideoSettings());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar configurações de vídeos.' });
  }
});

app.put('/api/partners-video/settings', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode alterar configurações de vídeos.' });
    }
    const settings = sanitizePartnerVideoSettings(req.body || {});
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`,
      [PARTNER_VIDEO_SETTINGS_KEY, JSON.stringify(settings), getActorName(req.user)]
    );
    await logPartnerVideoEvent({ eventType: 'settings_updated', status: 'info', createdBy: getActorName(req.user), responsePayload: { automationEnabled: settings.automationEnabled } });
    return res.json(settings);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao salvar configurações de vídeos.' });
  }
});

app.get('/api/partners-video/daily-controls', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    const date = req.query.date || getSaoPauloParts().dateKey;
    const [rows] = await pool.query('SELECT * FROM partner_video_daily_controls WHERE date = ? ORDER BY clinic_name ASC', [date]);
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar controles diários.' });
  }
});

app.post('/api/partners-video/send-daily-reminders', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode disparar a rotina.' });
    }
    const settings = await getPartnerVideoSettings();
    const slot = getPartnerVideoEligibleScheduleSlot(settings, getSaoPauloParts());
    if (!slot) {
      return res.status(409).json({
        error: 'Envio diário permitido apenas nas janelas de 08:00 e 18:00.',
        allowedTimes: settings.allowedTimes || ['08:00', '18:00']
      });
    }
    const result = await dispatchPartnerVideoDailyReminders({ actor: req.user, force: true });
    return res.json({ message: 'Cobranças de vídeo enfileiradas com controle anti-ban.', slot: slot.time, ...result });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao enfileirar cobranças de vídeo.' });
  }
});

app.post('/api/partners-video/test-send', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode enviar testes.' });
    }
    const numbers = Array.isArray(req.body?.numbers) && req.body.numbers.length
      ? req.body.numbers
      : DEFAULT_PARTNER_VIDEO_TEST_NUMBERS;
    const result = await dispatchPartnerVideoDailyReminders({ actor: req.user, force: true, testNumbers: numbers });
    return res.json({ message: 'Teste enfileirado para Confirmação e Agendamento.', ...result });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao enviar teste de Confirmação e Agendamento.' });
  }
});

app.post('/api/partners-video/mark-not-sent-bulk', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const dateKey = getSaoPauloDateKey(req.body?.date) || getSaoPauloParts().dateKey;
    const notes = sanitizeFinancialString(
      req.body?.notes || 'Marcado pela tela de Confirmação e Agendamento como vídeo não enviado.',
      2000
    );

    if (!rawItems.length) {
      return res.status(400).json({ error: 'Selecione ao menos uma unidade/parceiro para marcar como não enviado.' });
    }

    const updatedItems = [];
    const skippedItems = [];

    for (const rawItem of rawItems) {
      const controlId = rawItem?.controlId || rawItem?.control_id || null;
      const contactId = rawItem?.contactId || rawItem?.contact_id || null;
      let control = null;
      let contact = null;

      if (controlId) {
        const [controlRows] = await pool.query(
          `SELECT control.*,
                  contact.id AS contact_id,
                  contact.clinic_name AS contact_clinic_name,
                  contact.partner_name AS contact_partner_name,
                  contact.phone_number AS contact_phone_number
             FROM partner_video_daily_controls control
             LEFT JOIN partner_video_contacts contact ON contact.id = control.partner_id
            WHERE control.id = ?
            LIMIT 1`,
          [controlId]
        );
        control = controlRows[0] || null;
        if (control) {
          contact = {
            id: control.contact_id || control.partner_id,
            clinic_name: control.contact_clinic_name || control.clinic_name,
            partner_name: control.contact_partner_name || control.partner_name,
            phone_number: control.contact_phone_number || control.phone_number
          };
        }
      } else if (contactId) {
        const [contactRows] = await pool.query('SELECT * FROM partner_video_contacts WHERE id = ? LIMIT 1', [contactId]);
        contact = contactRows[0] || null;
        if (contact) control = await ensurePartnerVideoDailyControl(contact, dateKey);
      }

      if (!control?.id) {
        skippedItems.push({ controlId, contactId, reason: 'controle ou parceiro não encontrado' });
        continue;
      }

      await pool.query(
        `UPDATE partner_video_daily_controls
            SET video_received = 0,
                status = 'não enviado',
                notes = COALESCE(?, notes),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [notes || null, control.id]
      );

      await logPartnerVideoEvent({
        contactId: contact?.id || control.partner_id,
        controlId: control.id,
        eventType: 'video_not_sent_bulk',
        status: 'warning',
        createdBy: getActorName(req.user),
        responsePayload: { clinicName: contact?.clinic_name || control.clinic_name, date: dateKey }
      });

      updatedItems.push({
        controlId: control.id,
        contactId: contact?.id || control.partner_id,
        clinicName: contact?.clinic_name || control.clinic_name,
        partnerName: contact?.partner_name || control.partner_name
      });
    }

    return res.json({
      message: 'Unidades marcadas como vídeo não enviado.',
      updated: updatedItems.length,
      skipped: skippedItems.length,
      items: updatedItems,
      skippedItems
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao marcar vídeos não enviados em lote.' });
  }
});

app.post('/api/partners-video/:id/resend', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    if (!canConfigureWhatsAppManagement(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode reenviar cobranças.' });
    }
    const [rows] = await pool.query(
      `SELECT control.*,
              contact.id AS contact_id,
              contact.clinic_name AS contact_clinic_name,
              contact.partner_name AS contact_partner_name,
              contact.phone_number AS contact_phone_number
         FROM partner_video_daily_controls control
         LEFT JOIN partner_video_contacts contact ON contact.id = control.partner_id
        WHERE control.id = ?
        LIMIT 1`,
      [req.params.id]
    );
    const control = rows[0];
    if (!control) return res.status(404).json({ error: 'Controle diário não encontrado.' });

    const settings = await getPartnerVideoSettings();
    const contact = {
      id: control.contact_id || control.partner_id,
      clinic_name: control.contact_clinic_name || control.clinic_name,
      partner_name: control.contact_partner_name || control.partner_name,
      phone_number: control.contact_phone_number || control.phone_number
    };
    const delaySeconds = randomIntegerBetween(settings.minDelaySeconds, settings.maxDelaySeconds);
    const result = await enqueuePartnerVideoMessage({
      contact,
      control,
      number: contact.phone_number,
      message: fillPartnerVideoTemplate(settings.template, contact),
      delaySeconds,
      actor: req.user,
      type: 'partner_video_resend'
    });
    if (!result) return res.status(400).json({ error: 'Não foi possível reenviar: telefone inválido ou ausente.' });
    return res.json({ message: 'Cobrança reenfileirada com controle anti-ban.', delaySeconds, queueId: result.dispatch?.id || null });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao reenfileirar cobrança de vídeo.' });
  }
});

app.post('/api/partners-video/:id/mark-video-received', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    await pool.query(
      `UPDATE partner_video_daily_controls
          SET video_received = 1,
              video_received_at = NOW(),
              status = CASE WHEN TIME(NOW()) <= video_due_time THEN 'enviado no prazo' ELSE 'enviado com atraso' END,
              notes = COALESCE(?, notes)
        WHERE id = ?`,
      [sanitizeFinancialString(req.body?.notes, 2000) || null, req.params.id]
    );
    await logPartnerVideoEvent({ controlId: req.params.id, eventType: 'video_received', status: 'success', createdBy: getActorName(req.user) });
    return res.json({ message: 'Vídeo marcado como recebido.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao marcar vídeo recebido.' });
  }
});

app.post('/api/partners-video/:id/mark-not-sent', authenticate, requireWhatsAppView, async (req, res) => {
  try {
    await pool.query(
      `UPDATE partner_video_daily_controls
          SET video_received = 0,
              status = 'não enviado',
              notes = COALESCE(?, notes)
        WHERE id = ?`,
      [sanitizeFinancialString(req.body?.notes, 2000) || null, req.params.id]
    );
    await logPartnerVideoEvent({ controlId: req.params.id, eventType: 'video_not_sent', status: 'warning', createdBy: getActorName(req.user) });
    return res.json({ message: 'Pendência marcada como não enviada.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao marcar pendência.' });
  }
});

async function markPartnerVideoNotification(req, res, field, status, eventType) {
  try {
    await pool.query(
      `UPDATE partner_video_daily_controls
          SET ${field} = NOW(),
              status = ?
        WHERE id = ?`,
      [status, req.params.id]
    );
    await logPartnerVideoEvent({ controlId: req.params.id, eventType, status: 'info', createdBy: getActorName(req.user) });
    return res.json({ message: 'Acionamento registrado.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao registrar acionamento.' });
  }
}

app.post('/api/partners-video/:id/notify-leader', authenticate, requireWhatsAppView, (req, res) => markPartnerVideoNotification(req, res, 'leader_notified_at', 'acionado líder', 'leader_notified'));
app.post('/api/partners-video/:id/notify-coordinator', authenticate, requireWhatsAppView, (req, res) => markPartnerVideoNotification(req, res, 'coordinator_notified_at', 'acionado coordenador', 'coordinator_notified'));
app.post('/api/partners-video/:id/notify-manager', authenticate, requireWhatsAppView, (req, res) => markPartnerVideoNotification(req, res, 'manager_notified_at', 'acionado gerente', 'manager_notified'));
app.post('/api/whatsapp/events', handleWhatsAppServiceEvents);
app.post('/api/whatsapp/evolution-webhook', handleEvolutionWebhook);

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

    const [overview, runtime, database, activity, email, whatsapp, evolution] = await Promise.all([
      getOverviewMetrics(),
      getRuntimeMetrics(),
      getDatabaseMonitoring(),
      getActivityMonitoring(),
      getEmailMonitoring(),
      getWhatsAppMonitoring(),
      getEvolutionMonitoring()
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
      evolution,
      providers: {
        vercel,
        railway,
        resend,
        twilio: whatsapp,
        evolution
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
       (name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password, authorization_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'aprovado')
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         role = VALUES(role),
         position = VALUES(position),
         phone = VALUES(phone),
         whatsapp = VALUES(whatsapp),
         department = VALUES(department),
         permissions = VALUES(permissions),
         must_change_password = 0,
         authorization_status = 'aprovado',
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
    const params = [];
    const statusFilter = status === 'todos' || status === 'all' ? '' : 'WHERE status = ?';

    if (statusFilter) {
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT id, name, email, role, position, phone, whatsapp, department, status, approved_at, created_at
       FROM registration_requests
       ${statusFilter}
       ORDER BY FIELD(status, 'pendente', 'rejeitado', 'aprovado'), created_at DESC`,
      params
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
       (name, email, password, role, position, phone, whatsapp, department, permissions, active, must_change_password, authorization_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'aprovado')
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         role = VALUES(role),
         position = VALUES(position),
         phone = VALUES(phone),
         whatsapp = VALUES(whatsapp),
         department = VALUES(department),
         permissions = VALUES(permissions),
         must_change_password = 0,
         authorization_status = 'aprovado',
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

app.delete('/admin/registration-requests/:id', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM registration_requests WHERE id = ?',
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Cadastro não encontrado.' });
    }

    await pool.query('DELETE FROM registration_requests WHERE id = ?', [req.params.id]);
    await createNotificationForAdmins(
      'registration_deleted',
      'Cadastro removido da fila',
      `${rows[0].name} foi removido da fila de autorizações por ${getActorName(req.user)}.`,
      '/home',
      { requestId: rows[0].id, requestEmail: rows[0].email }
    );

    return res.json({ message: 'Cadastro removido da lista de autorizações.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir cadastro da fila.' });
  }
});

app.get('/admin/users', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT id, name, username, email, role, position, phone, whatsapp, department, permissions, action_permissions, active, authorization_status, must_change_password, created_at, updated_at
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
      let actionPermissionList = defaultActionPermissionsForRole(user.role);

      try {
        permissions = user.permissions ? JSON.parse(user.permissions) : permissions;
      } catch (error) {
        permissions = defaultPermissionsForRole(user.role);
      }

      try {
        actionPermissionList = user.action_permissions ? JSON.parse(user.action_permissions) : actionPermissionList;
      } catch (error) {
        actionPermissionList = defaultActionPermissionsForRole(user.role);
      }

      return {
        ...user,
        permissions,
        actionPermissions: Array.isArray(actionPermissionList) ? actionPermissionList : defaultActionPermissionsForRole(user.role),
        clinics: clinicsByUser[user.id] || []
      };
    }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

function getAccessProfileLabel(role) {
  if (role === 'master_admin') return 'Administrador Master';
  return accessProfiles[role] || role || 'Perfil não informado';
}

function formatAdminUserPermissionList(value, fallback = []) {
  let parsed = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      parsed = [];
    }
  }

  const list = Array.isArray(parsed) ? parsed : fallback;
  return list.filter(Boolean).join(', ');
}

async function getAdminUsersExportRows() {
  const [rows] = await pool.query(
    `SELECT
        u.id,
        u.name,
        u.username,
        u.email,
        u.role,
        u.position,
        u.phone,
        u.whatsapp,
        u.department,
        u.permissions,
        u.action_permissions,
        u.active,
        u.authorization_status,
        u.must_change_password,
        u.created_at,
        u.updated_at,
        (
          SELECT GROUP_CONCAT(
            CONCAT(
              c.name,
              CASE
                WHEN COALESCE(c.city, '') <> '' OR COALESCE(c.state, '') <> ''
                  THEN CONCAT(' - ', COALESCE(c.city, ''), CASE WHEN COALESCE(c.state, '') <> '' THEN CONCAT('/', c.state) ELSE '' END)
                ELSE ''
              END,
              CASE WHEN COALESCE(uc.can_edit, 0) = 1 THEN ' (edita)' ELSE '' END
            )
            ORDER BY c.name
            SEPARATOR '; '
          )
            FROM user_clinics uc
            INNER JOIN clinics c ON c.id = uc.clinic_id
           WHERE uc.user_id = u.id
        ) AS clinics
       FROM users u
      WHERE u.deleted_at IS NULL
      ORDER BY u.name ASC, u.email ASC`
  );

  return rows.map((user) => {
    const defaultScreens = defaultPermissionsForRole(user.role);
    const defaultActions = defaultActionPermissionsForRole(user.role);

    return {
      id: user.id,
      nome: user.name || '',
      usuario: user.username || '',
      email: user.email || '',
      telefone: user.phone || '',
      whatsapp: user.whatsapp || '',
      perfil: getAccessProfileLabel(user.role),
      perfil_codigo: user.role || '',
      cargo: user.position || '',
      departamento: user.department || '',
      status: Number(user.active) ? 'Ativo' : 'Desabilitado',
      autorizacao: user.authorization_status || (Number(user.active) ? 'aprovado' : 'pendente'),
      senha_inicial: Number(user.must_change_password) ? 'Pendente de troca' : 'Regular',
      clinicas: user.clinics || '',
      telas_liberadas: formatAdminUserPermissionList(user.permissions, defaultScreens),
      acoes_liberadas: formatAdminUserPermissionList(user.action_permissions, defaultActions),
      criado_em: user.created_at,
      atualizado_em: user.updated_at
    };
  });
}

function buildAdminUsersExcelBuffer(rows = []) {
  const data = rows.map((user) => ({
    ID: user.id,
    'Nome completo': user.nome,
    Usuário: user.usuario,
    'E-mail': user.email,
    Telefone: user.telefone,
    WhatsApp: user.whatsapp,
    Perfil: user.perfil,
    'Código do perfil': user.perfil_codigo,
    Cargo: user.cargo,
    'Departamento / área': user.departamento,
    Status: user.status,
    'Status de autorização': user.autorizacao,
    'Senha inicial': user.senha_inicial,
    'Clínicas sob responsabilidade': user.clinicas,
    'Telas liberadas': user.telas_liberadas,
    'Botões e ações liberados': user.acoes_liberadas,
    'Criado em': user.criado_em ? formatMessageDateTime(user.criado_em) : '',
    'Atualizado em': user.atualizado_em ? formatMessageDateTime(user.atualizado_em) : ''
  }));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 34 },
    { wch: 22 },
    { wch: 34 },
    { wch: 18 },
    { wch: 18 },
    { wch: 22 },
    { wch: 22 },
    { wch: 24 },
    { wch: 24 },
    { wch: 14 },
    { wch: 20 },
    { wch: 22 },
    { wch: 64 },
    { wch: 64 },
    { wch: 72 },
    { wch: 20 },
    { wch: 20 }
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Usuários');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function buildAdminUsersPdfBuffer(rows = []) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true });
    const chunks = [];
    const ink = '#211a16';
    const muted = '#6c5a4d';
    const gold = '#b07a35';
    const teal = '#0e5966';
    const line = '#dfcfba';
    const pageWidth = doc.page.width - 64;
    const columns = [
      ['Nome', 128],
      ['E-mail', 150],
      ['Contato', 100],
      ['Perfil / cargo', 126],
      ['Clínicas', 188],
      ['Permissões', pageWidth - 692]
    ];
    let y = 120;

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const drawHeader = () => {
      doc.rect(0, 0, doc.page.width, 78).fill('#fff8ef');
      doc.fillColor(gold).font('Helvetica-Bold').fontSize(9).text('PAINEL GERENCIAL', 32, 26);
      doc.fillColor(ink).fontSize(22).text('Relação de usuários cadastrados', 32, 39);
      doc.fillColor(muted).font('Helvetica').fontSize(9)
        .text(`Emitido em ${formatMessageDateTime(new Date())} · ${rows.length} usuário(s)`, 32, 66);
      y = 98;
    };

    const drawTableHeader = () => {
      let x = 32;
      doc.rect(32, y, pageWidth, 24).fill('#f5ead9');
      doc.fillColor('#5e4321').font('Helvetica-Bold').fontSize(7);
      columns.forEach(([label, width]) => {
        doc.text(label.toUpperCase(), x + 4, y + 8, { width: width - 8 });
        x += width;
      });
      y += 24;
    };

    drawHeader();
    drawTableHeader();
    doc.font('Helvetica').fontSize(7);
    rows.forEach((user, index) => {
      if (y > doc.page.height - 64) {
        doc.addPage();
        drawHeader();
        drawTableHeader();
      }
      const rowHeight = 66;
      doc.rect(32, y, pageWidth, rowHeight).fill(index % 2 === 0 ? '#ffffff' : '#fffaf4');
      doc.strokeColor(line).lineWidth(0.4).moveTo(32, y + rowHeight).lineTo(32 + pageWidth, y + rowHeight).stroke();
      let x = 32;
      const values = [
        `${user.nome}\nUsuário: ${user.usuario || '-'}\n${user.status} · ${user.autorizacao} · ${user.senha_inicial}`,
        user.email,
        `Tel.: ${user.telefone || '-'}\nWhats.: ${user.whatsapp || '-'}`,
        `${user.perfil}\n${user.cargo || '-'}\n${user.departamento || '-'}`,
        user.clinicas || '-',
        `Telas: ${user.telas_liberadas || '-'}\nAções: ${user.acoes_liberadas || '-'}`
      ];
      doc.fillColor(ink);
      values.forEach((value, valueIndex) => {
        const width = columns[valueIndex][1];
        doc.text(String(value || '-'), x + 4, y + 8, { width: width - 8, height: rowHeight - 12 });
        x += width;
      });
      y += rowHeight;
    });

    if (!rows.length) {
      doc.fillColor(muted).fontSize(10).text('Nenhum usuário encontrado.', 32, y + 12);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.fillColor(teal).font('Helvetica-Bold').fontSize(8)
        .text('Sistema NPS - Grupo Sorria | Gestão de Usuários', 32, doc.page.height - 24);
      doc.fillColor(muted).font('Helvetica').text(`Página ${i + 1} de ${range.count}`, doc.page.width - 100, doc.page.height - 24);
    }

    doc.end();
  });
}

app.get(['/admin/users/export/excel', '/api/admin/users/export/excel'], authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const rows = await getAdminUsersExportRows();
    const buffer = buildAdminUsersExcelBuffer(rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="usuarios-cadastrados.xlsx"');
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao exportar usuários em Excel.' });
  }
});

app.get(['/admin/users/export/pdf', '/api/admin/users/export/pdf'], authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const rows = await getAdminUsersExportRows();
    const buffer = await buildAdminUsersPdfBuffer(rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="usuarios-cadastrados.pdf"');
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao exportar usuários em PDF.' });
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
      actionPermissions: requestedActionPermissions,
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
    const allowedActionPermissions = Array.isArray(requestedActionPermissions)
      ? requestedActionPermissions.filter((permission) => actionPermissions[permission])
      : defaultActionPermissionsForRole(role);
    const normalizedClinicIds = Array.isArray(clinicIds)
      ? clinicIds
        .map((clinicId) => Number(clinicId))
        .filter((clinicId) => Number.isFinite(clinicId) && clinicId > 0)
      : [];
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const [result] = await pool.query(
      `INSERT INTO users
       (name, email, password, role, position, phone, whatsapp, department, permissions, action_permissions, active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
        JSON.stringify(allowedActionPermissions),
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

    await syncClinicLeadershipForUser({
      userId: result.insertId,
      previousRole: null,
      nextRole: role,
      previousName: null,
      nextName: String(name).trim(),
      previousClinicIds: [],
      nextClinicIds: normalizedClinicIds
    });

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
    const nextActionPermissions = Array.isArray(req.body.actionPermissions)
      ? req.body.actionPermissions.filter((permission) => actionPermissions[permission])
      : getUserActionPermissions({ ...current, role: nextRole });

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
              action_permissions = ?,
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
        JSON.stringify(nextActionPermissions),
        req.body.active === undefined ? current.active : (req.body.active ? 1 : 0),
        current.id
      ]
    );

    if (Array.isArray(req.body.clinicIds)) {
      const previousClinicIds = await getUserClinicIds(current.id);
      const normalizedNextClinicIds = normalizeClinicIds(req.body.clinicIds);
      await pool.query('DELETE FROM user_clinics WHERE user_id = ?', [current.id]);
      await Promise.all(normalizedNextClinicIds.map((clinicId) => (
        pool.query(
          'INSERT INTO user_clinics (user_id, clinic_id, can_edit) VALUES (?, ?, 1)',
          [current.id, clinicId]
        )
      )));
      await syncClinicLeadershipForUser({
        userId: current.id,
        previousRole: current.role,
        nextRole,
        previousName: current.name,
        nextName: req.body.name || current.name,
        previousClinicIds,
        nextClinicIds: normalizedNextClinicIds
      });
    }

    res.json({ message: 'Usuário atualizado com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

app.post('/admin/users/:id/activate', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, phone, whatsapp, active, authorization_status FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = rows[0];

    if (String(user.email || '').toLowerCase() === masterAdminEmail) {
      return res.status(403).json({ error: 'O Administrador Master já possui acesso permanente.' });
    }

    await pool.query(
      `UPDATE users
          SET active = 1,
              authorization_status = 'aprovado',
              token_version = COALESCE(token_version, 1) + 1
        WHERE id = ?`,
      [user.id]
    );

    await createNotification(
      user.id,
      'access_approved',
      'Acesso liberado',
      'Seu acesso foi liberado pelo Administrador Master.',
      '/home',
      { approvedBy: getActorName(req.user) }
    );

    const notificationResult = await sendRegistrationApprovedNotifications(user);

    return res.json({
      message: 'Usuário liberado com sucesso.',
      notifications: notificationResult
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao liberar acesso do usuário.' });
  }
});

app.post('/admin/users/:id/block', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = rows[0];

    if (String(user.email || '').toLowerCase() === masterAdminEmail || user.role === 'master_admin') {
      return res.status(403).json({ error: 'O Administrador Master não pode ser bloqueado.' });
    }

    await pool.query(
      `UPDATE users
          SET active = 0,
              authorization_status = 'bloqueado',
              token_version = COALESCE(token_version, 1) + 1
        WHERE id = ?`,
      [user.id]
    );

    await createNotificationForAdmins(
      'user_blocked',
      'Usuário bloqueado',
      `${user.name} foi bloqueado por ${getActorName(req.user)}.`,
      '/admin',
      { userId: user.id, userEmail: user.email }
    );

    return res.json({ message: 'Usuário bloqueado com sucesso.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao bloquear usuário.' });
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
    const [rows] = await pool.query('SELECT id, name, role, email FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);

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

    const previousClinicIds = await getUserClinicIds(user.id);

    await pool.query(
      'UPDATE users SET active = 0, deleted_at = NOW(), deleted_by = ? WHERE id = ?',
      [getActorName(req.user), user.id]
    );
    await syncClinicLeadershipForUser({
      userId: user.id,
      previousRole: user.role,
      nextRole: null,
      previousName: user.name,
      nextName: null,
      previousClinicIds,
      nextClinicIds: []
    });
    await pool.query('DELETE FROM user_clinics WHERE user_id = ?', [user.id]);

    res.json({ message: 'Usuário excluído com lastro de auditoria.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir usuário.' });
  }
});

app.post('/admin/users/restore', authenticate, requireMasterAdmin, async (req, res) => {
  try {
    const lookupEmail = String(req.body.current_email || req.body.email || '').trim().toLowerCase();
    const nextEmail = String(req.body.new_email || req.body.email || '').trim().toLowerCase();

    if (!lookupEmail) {
      return res.status(400).json({ error: 'Informe o e-mail atual do usuário para reabilitação.' });
    }

    const parsedEmail = z.string().trim().email('Informe um e-mail válido.');
    const lookupResult = parsedEmail.safeParse(lookupEmail);
    const nextEmailResult = parsedEmail.safeParse(nextEmail);

    if (!lookupResult.success || !nextEmailResult.success) {
      return res.status(400).json({ error: 'Informe e-mails válidos para reabilitação.' });
    }

    const [rows] = await pool.query(
      `SELECT id, name, email, role
         FROM users
        WHERE LOWER(email) = ?
        LIMIT 1`,
      [lookupEmail]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Usuário não encontrado para reabilitação.' });
    }

    const targetUser = rows[0];
    const currentEmail = String(targetUser.email || '').toLowerCase();

    if (currentEmail === masterAdminEmail || targetUser.role === 'master_admin') {
      return res.status(403).json({ error: 'O Administrador Master não pode ser reabilitado por esta rota.' });
    }

    if (nextEmail !== currentEmail) {
      const [duplicates] = await pool.query(
        `SELECT id
           FROM users
          WHERE LOWER(email) = ?
            AND id <> ?
            AND deleted_at IS NULL
          LIMIT 1`,
        [nextEmail, targetUser.id]
      );

      if (duplicates.length) {
        return res.status(409).json({ error: 'Já existe outro usuário ativo com o e-mail informado.' });
      }
    }

    await pool.query(
      `UPDATE users
          SET email = ?,
              active = 1,
              deleted_at = NULL,
              deleted_by = NULL
        WHERE id = ?`,
      [nextEmail, targetUser.id]
    );

    res.json({
      message: 'Usuário reabilitado com sucesso.',
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: nextEmail,
        role: targetUser.role,
        active: 1
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao reabilitar usuário.' });
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

app.post('/auth/crc-operator/register', async (req, res) => {
  try {
    const parsed = parseBodyWithSchema(crcOperatorRegistrationSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const username = normalizeUsername(parsed.data.username);
    if (!/^[a-z0-9._-]{4,80}$/.test(username)) {
      return res.status(400).json({ error: 'Use um usuário com letras, números, ponto, hífen ou underline.' });
    }

    if (!isStrongPassword(parsed.data.password)) {
      return res.status(400).json({
        error: 'A senha deve ter no mínimo 8 caracteres, letra maiúscula, letra minúscula, número e caractere especial.'
      });
    }

    const normalizedEmail = String(parsed.data.email || '').trim().toLowerCase();
    const normalizedPhone = normalizeBrazilPhone(parsed.data.phone);
    if (!isCompleteBrazilPhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Informe o celular completo no formato +55DDDNÚMERO.' });
    }

    const [duplicates] = await pool.query(
      `SELECT id
         FROM users
        WHERE deleted_at IS NULL
          AND (LOWER(email) = ? OR LOWER(username) = ?)
        LIMIT 1`,
      [normalizedEmail, username]
    );
    if (duplicates.length) {
      return res.status(409).json({ error: 'Já existe um usuário ou cadastro pendente com este usuário ou e-mail.' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const permissions = defaultPermissionsForRole('crc_operator');
    const actionPermissionList = defaultActionPermissionsForRole('crc_operator');
    const [result] = await pool.query(
      `INSERT INTO users
       (name, username, email, password, role, position, phone, whatsapp, department, permissions, action_permissions, active, must_change_password, authorization_status)
       VALUES (?, ?, ?, ?, 'crc_operator', 'Operador de CRC', ?, ?, 'CRC WhatsApp', ?, ?, 0, 0, 'pendente')`,
      [
        parsed.data.name,
        username,
        normalizedEmail,
        passwordHash,
        normalizedPhone,
        normalizedPhone,
        JSON.stringify(permissions),
        JSON.stringify(actionPermissionList)
      ]
    );

    await notifyCrcOperatorApprovalRequired({
      id: result.insertId,
      name: parsed.data.name,
      username,
      email: normalizedEmail,
      phone: normalizedPhone
    });

    return res.status(201).json({
      success: true,
      pendingAuthorization: true,
      message: 'Cadastro recebido. O Administrador Master foi notificado para autorizar seu acesso antes do primeiro login.',
      username
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível cadastrar o Operador CRC.' });
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
      return res.status(400).json({ message: 'Informe e-mail/usuário e senha' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1',
      [login, normalizeUsername(login)]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Usuário não encontrado' });
    }

    const user = rows[0];

    if (!user.active || user.deleted_at) {
      const authorizationStatus = String(user.authorization_status || '').toLowerCase();
      if (!user.deleted_at && normalizeAccessRole(user.role) === 'crc_operator' && authorizationStatus !== 'bloqueado') {
        return res.status(403).json({ message: 'Cadastro de Operador CRC aguardando autorização do Administrador Master.' });
      }

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
      detractor_feedback,
      source,
      whatsapp_conversation_id,
      whatsapp_nps_invite_id
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
    const whatsappConversationId = Number(whatsapp_conversation_id || req.body.conversation_id || 0) || null;
    const whatsappNpsInviteId = Number(whatsapp_nps_invite_id || req.body.invite_id || 0) || null;
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
       (clinic_id, patient_name, patient_phone, score, comment, feedback_type, nps_profile, recommend_yes, contact_share_allowed, referral_name, referral_phone, improvement_comment, detractor_reasons, detractor_feedback, source, ip_address, whatsapp_conversation_id, whatsapp_nps_invite_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        source === 'whatsapp_atendimento' ? 'whatsapp_atendimento' : 'link_publico',
        requestIp || null,
        whatsappConversationId,
        whatsappNpsInviteId
      ]
    );

    const shouldCreateManifestation = false;

    if (shouldCreateManifestation) {
      const priority = priorityForNpsFeedback(numericScore, classification);
      const resolutionDueAt = calculateResolutionDueAt();
      const creatorAudit = buildComplaintCreatorAudit(null, 'Externo');
      const [result] = await pool.query(
        `INSERT INTO complaints
         (clinic_id, patient_name, patient_phone, channel, complaint_type, description, service_type, status, priority, due_at, resolution_due_at, created_origin, created_by_user_id, created_by_name, created_by_role, created_by_email)
         VALUES (?, ?, ?, 'NPS', ?, ?, 'Pesquisa de satisfação', 'aberta', ?, ?, ?, 'Externo', ?, ?, ?, ?)`,
        [
          clinic_id || null,
          patient_name || 'Paciente NPS',
          normalizedPatientPhone,
          classification,
          narrative,
          priority,
          toMysqlDateTime(calculateDueAt(priority)),
          toMysqlDateTime(resolutionDueAt),
          creatorAudit.userId,
          creatorAudit.name,
          creatorAudit.role,
          creatorAudit.email
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
    if (whatsappNpsInviteId) {
      await pool.query(
        `UPDATE whatsapp_nps_invites
            SET status = 'respondido',
                responded_at = NOW(),
                nps_response_id = ?
          WHERE id = ?`,
        [npsInsert.insertId, whatsappNpsInviteId]
      );
    }
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
    if (!isAdminUser(req.user) && normalizeAccessRole(req.user?.role) !== 'supervisor_crc') {
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

    if (String(req.query?.format || '').trim().toLowerCase() === 'csv') {
      const csv = [
        'Nome;Telefone / WhatsApp;Clinica',
        'Paciente Exemplo;+5562999999999;Garavelo'
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="template-envio-nps.csv"');
      return res.send(`\uFEFF${csv}`);
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet([
      {
        nome_paciente: 'MARIA SILVA',
        telefone: '5562999999999',
        clinica: 'GARAVELO',
        observacao: 'Campos obrigatorios: nome_paciente e telefone'
      }
    ]);
    worksheet['!cols'] = [
      { wch: 28 },
      { wch: 18 },
      { wch: 20 },
      { wch: 48 }
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pacientes');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template-envio-nps.xlsx"');
    return res.send(buffer);
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
    const npsInstance = await getNpsWhatsAppInstance(req.user);
    const npsSessionId = npsInstance?.instance_name || WHATSAPP_NPS_INSTANCE_NAME;
    const recipients = req.file?.path
      ? parseBulkNpsUpload(req.file.path, req.file.originalname)
      : parseBulkNpsCsv(req.body?.content || '');

    if (!recipients.length) {
      return res.status(400).json({ error: 'Envie uma planilha com nome e telefone dos pacientes.' });
    }

    const invalidRecipients = recipients.filter((recipient) => !isCompleteBrazilPhone(recipient.phone));
    const validRecipients = recipients.filter((recipient) => isCompleteBrazilPhone(recipient.phone));

    if (!validRecipients.length) {
      return res.status(400).json({ error: 'Nenhum telefone valido foi encontrado na planilha.' });
    }

    const baseMessage = 'Sua opinião é fundamental para melhorarmos nossos processos. Poderia dedicar 1 minuto para avaliar sua experiência conosco?';

    for (const [index, recipient] of validRecipients.entries()) {
      await queueManagedWhatsAppMessage({
        actor: req.user,
        conversationPayload: {
          patient_name: recipient.name,
          patient_phone: recipient.phone,
          clinic_name: recipient.clinic || null,
          instance_name: npsSessionId,
          status: 'NPS'
        },
        instanceName: npsSessionId,
        patientPhone: recipient.phone,
        patientName: recipient.name,
        clinicName: recipient.clinic || null,
        messageText: `${baseMessage}\n${publicNpsLink}`,
        messageType: 'nps_bulk_invite',
        source: 'nps_bulk_dispatch',
        scheduleDelaySeconds: buildProgressiveDispatchDelaySeconds(index),
        payload: {
          link: publicNpsLink,
          triggerChatbot: true,
          campaignType: 'nps'
        }
      });
    }

    res.json({
      message: `Envio em massa preparado para ${validRecipients.length} paciente(s).`,
      total: recipients.length,
      sent: validRecipients.length,
      invalid: invalidRecipients.length,
      link: publicNpsLink,
      sessionId: npsSessionId,
      antiBan: getWhatsAppAntiBanConfig()
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
    if (!isAdminUser(req.user) && normalizeAccessRole(req.user?.role) !== 'supervisor_crc') {
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
    if (!isAdminUser(req.user) && normalizeAccessRole(req.user?.role) !== 'supervisor_crc') {
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
    const complaintId = Number(req.query.complaint_id || 0);
    const where = [];
    const params = [];

    if (!includeDeleted) {
      where.push("status <> 'Cancelado'");
    }

    if (complaintId > 0) {
      where.push('complaint_id = ?');
      params.push(complaintId);
    }

    if (!isAdminUser(req.user) && !['sac_operator', 'supervisor_crc'].includes(normalizeAccessRole(req.user?.role))) {
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
        complaint_id,
        patient_name,
        patient_phone,
        channel,
        clinic_name,
        interaction_type,
        procedure_name,
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
      complaintId: row.complaint_id,
      patient: row.patient_name,
      phone: row.patient_phone,
      channel: row.channel,
      clinic: row.clinic_name,
      type: row.interaction_type,
      procedureName: row.procedure_name,
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
      procedureName,
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
       (patient_name, patient_phone, channel, clinic_name, interaction_type, procedure_name, scheduled_at, note, status, created_by_name, created_by_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Registrado', ?, ?)`,
      [
        patient,
        phone,
        channel,
        clinic,
        type,
        String(procedureName || '').trim() || null,
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
    const scheduledAtInput = String(req.body.scheduledAt || req.body.scheduled_at || '').trim();
    const note = String(req.body.note || '').trim();
    let nextScheduledAt = null;

    if (!status) {
      return res.status(400).json({ error: 'Informe o novo status.' });
    }

    if (scheduledAtInput) {
      const scheduledDate = /^\d{4}-\d{2}-\d{2}$/.test(scheduledAtInput)
        ? new Date(`${scheduledAtInput}T00:00:00`)
        : new Date(scheduledAtInput);

      if (Number.isNaN(scheduledDate.getTime())) {
        return res.status(400).json({ error: 'Informe uma data válida para o reagendamento.' });
      }

      nextScheduledAt = toMysqlDateTime(scheduledDate);
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
      'UPDATE patient_interactions SET status = ?, scheduled_at = COALESCE(?, scheduled_at), cancelled_at = NULL, cancelled_by_name = NULL, cancelled_by_role = NULL WHERE id = ?',
      [status, nextScheduledAt, req.params.id]
    );
    const scheduleNote = nextScheduledAt ? ` Nova agenda: ${formatMessageDateTime(nextScheduledAt)}.` : '';
    const detailNote = note ? ` Observação: ${note}` : '';
    await insertPatientInteractionLog(req.params.id, action, `Status atualizado para ${status}.${scheduleNote}${detailNote}`, req.user);

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

app.post('/complaints/:id/patient-treatment', authenticate, async (req, res) => {
  try {
    if (!canManageComplaintPatientTreatment(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode cadastrar tratamento do paciente pela ficha executiva.' });
    }

    const procedureName = String(req.body?.procedure_name || '').trim();
    const scheduledAt = String(req.body?.scheduled_at || '').trim();
    const note = String(req.body?.note || '').trim();

    if (!procedureName || !scheduledAt) {
      return res.status(400).json({ error: 'Informe o procedimento e a data agendada do paciente.' });
    }

    const complaintRows = await getComplaintRows({ id: req.params.id }, req.user);
    const complaint = complaintRows[0];

    if (!complaint) {
      return res.status(404).json({ error: 'Reclamação não encontrada.' });
    }

    let scheduledDate;

    if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledAt)) {
      scheduledDate = new Date(`${scheduledAt}T00:00:00`);
      const now = new Date();
      scheduledDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
    } else {
      scheduledDate = new Date(scheduledAt);
    }

    if (Number.isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ error: 'Informe uma data válida para o agendamento.' });
    }

    const [result] = await pool.query(
      `INSERT INTO patient_interactions
       (protocol, complaint_id, patient_name, patient_phone, channel, clinic_name, interaction_type, procedure_name, scheduled_at, note, status, created_by_name, created_by_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Em tratamento', ?, ?)`,
      [
        null,
        Number(req.params.id),
        complaint.patient_name || 'Paciente não informado',
        complaint.patient_phone || '',
        'reclamacao',
        complaint.clinic_name || 'Unidade não informada',
        'agendamento',
        procedureName,
        toMysqlDateTime(scheduledDate),
        note || `Acompanhamento de tratamento vinculado ao protocolo ${complaint.protocol || complaint.id}.`,
        getActorName(req.user),
        req.user?.role || null
      ]
    );

    const protocol = formatPatientProtocol(result.insertId, scheduledDate);
    await pool.query('UPDATE patient_interactions SET protocol = ? WHERE id = ?', [protocol, result.insertId]);

    await insertPatientInteractionLog(
      result.insertId,
      'Tratamento criado pela ficha executiva',
      `Procedimento ${procedureName} agendado para ${formatMessageDateTime(scheduledDate)}. ${note || ''}`.trim(),
      req.user
    );

    await insertComplaintLog(
      req.params.id,
      'patient_treatment_created',
      `Tratamento do paciente registrado na gestão de pacientes. Procedimento: ${procedureName}. Agenda: ${formatMessageDateTime(scheduledDate)}. Protocolo paciente: ${protocol}.`,
      req.user
    );

    return res.status(201).json({
      message: 'Tratamento do paciente registrado com sucesso na gestão de pacientes.',
      interactionId: result.insertId,
      protocol
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao registrar tratamento do paciente pela ficha executiva.' });
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
    const creatorAudit = buildComplaintCreatorAudit(req.user, normalizedOrigin);

    const [result] = await pool.query(
      `INSERT INTO complaints 
      (clinic_id, patient_name, patient_phone, channel, complaint_type, description, service_type, attachment_url, status, priority, due_at, resolution_due_at, created_origin, created_by_user_id, created_by_name, created_by_role, created_by_email, financial_involved, financial_description, financial_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        creatorAudit.userId,
        creatorAudit.name,
        creatorAudit.role,
        creatorAudit.email,
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
      name: creatorAudit.name,
      role: creatorAudit.role
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
            clinicName: assignment?.clinicSnapshotName || '',
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

    res.json({
      ...rows[0],
      access: buildComplaintAccessPayload(req.user)
    });
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

    if (isClosedComplaintStatus(complaint.status) || complaint.deleted_at) {
      return res.status(400).json({ error: 'Não é permitido reenviar notificações de protocolo finalizado, cancelado ou encerrado.' });
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
      forward_to_role,
      reassign_forward
    } = req.body;
    const rows = await getComplaintRows({ id }, req.user);

    if (!rows.length) {
      return res.status(404).json({ error: 'Reclamacao nao encontrada' });
    }

    if (isMarketingUser(req.user) && !isAdminUser(req.user)) {
      const allowedMarketingPatchFields = new Set(['clinic_id', 'patient_phone']);
      const requestedMarketingPatchFields = Object.keys(req.body || {}).filter((key) => req.body[key] !== undefined);
      const onlyAllowedMarketingPatchFields = requestedMarketingPatchFields.length > 0
        && requestedMarketingPatchFields.every((key) => allowedMarketingPatchFields.has(key));

      if (!onlyAllowedMarketingPatchFields) {
        return res.status(403).json({
          error: 'Marketing pode consultar protocolos, anexar evidências e corrigir unidade/telefone do paciente, mas não alterar demais dados da reclamação.'
        });
      }
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

      const patientContactForwardRoles = {
        coordinator: 'Coordenador',
        manager: 'Gerente',
        supervisor_crc: 'Supervisor do CRC'
      };

      if (requiresForwardSelection && !first_attendance && !patientContactForwardRoles[forward_to_role]) {
        return res.status(400).json({ error: 'Selecione Coordenador, Gerente ou Supervisor do CRC para receber a reclamação.' });
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

      if (requiresForwardSelection && !first_attendance) {
        const assignment = await resolveComplaintResponsibleAssignment(complaint.clinic_id, forward_to_role);
        const forwardedLabel = forward_to_role === 'coordinator'
          ? assignment.name || complaint.assigned_coordinator_name || patientContactForwardRoles[forward_to_role]
          : assignment.label || patientContactForwardRoles[forward_to_role];

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
          action: 'patient_contact_forwarded',
          message: `Contato com paciente registrado e protocolo encaminhado para ${forwardedLabel}.`
        });
      }
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
        forwardedLabel = assignment.name || complaint.assigned_coordinator_name || allowedForwardRoles[forward_to_role];
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

    if (reassign_forward) {
      if (!canReassignComplaint(req.user)) {
        return res.status(403).json({ error: 'Seu perfil não pode reencaminhar a reclamação.' });
      }

      const requesterRole = normalizeAccessRole(req.user?.role);
      const requesterIsOperational = ['coordinator', 'manager'].includes(requesterRole);
      const allowedReassignRoles = requesterIsOperational
        ? { sac_operator: 'Operador de SAC' }
        : {
            coordinator: 'Coordenador',
            manager: 'Gerente'
          };
      const willSaveCoordinatorManagerTreatment = Boolean(cleanedComment) && canAddTreatment(req.user);
      const hasCoordinatorManagerTreatment = await complaintHasCoordinatorOrManagerTreatment(
        complaint,
        willSaveCoordinatorManagerTreatment ? req.user : null
      );

      if (!allowedReassignRoles[forward_to_role]) {
        return res.status(400).json({
          error: requesterIsOperational
            ? 'Selecione o Operador de SAC para devolver a demanda.'
            : 'Selecione Coordenador ou Gerente para reencaminhar a demanda.'
        });
      }

      if (requesterIsOperational && !hasCoordinatorManagerTreatment && !willSaveCoordinatorManagerTreatment) {
        return res.status(400).json({
          error: 'Coordenador e Gerente precisam registrar a tratativa antes de devolver a demanda ao Operador de SAC.'
        });
      }

      const assignment = await resolveComplaintResponsibleAssignment(complaint.clinic_id, forward_to_role, {
        preferredName: complaint.first_attendance_by || complaint.patient_contacted_by || complaint.forwarded_by
      });
      const forwardedLabel = forward_to_role === 'coordinator'
        ? assignment.name || complaint.assigned_coordinator_name || allowedReassignRoles[forward_to_role]
        : assignment.label || allowedReassignRoles[forward_to_role];

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
      }

      logEntries.push({
        action: 'reassigned_forward',
        message: `Demanda reencaminhada para ${forwardedLabel}.`
      });
    }

    if (nextStatus === 'resolvida') {
      const isMasterRequest = isMasterAdminUser(req.user);
      const pendingTreatmentUser = cleanedComment && canAddTreatment(req.user) ? req.user : null;
      const hasCoordinatorOrManagerTreatment = await complaintHasCoordinatorOrManagerTreatment(complaint, pendingTreatmentUser);
      const hasSupervisorApproval = Boolean(complaint.supervisor_approval_at)
        || (supervisor_accept && canSupervisorApprove(req.user));

      if (!canCloseComplaint(req.user)) {
        return res.status(403).json({ error: 'Somente Administrador, Administrador Master, Supervisor do CRC ou Operador de SAC podem fechar uma reclamacao.' });
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

    if ((first_attendance || reassign_forward) && ['coordinator', 'manager'].includes(String(forward_to_role || '').toLowerCase())) {
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
// INTELIGÊNCIA FINANCEIRA CRC
// ============================================
function normalizeFinancialDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function sanitizeFinancialString(value, maxLength = 180) {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function toFinancialBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'sim', 'yes', 'on'].includes(text);
}

function getFinancialFunctionLabel(user = {}) {
  const position = sanitizeFinancialString(user.position || user.function_name || user.department);
  if (position) return position;

  const roleLabels = {
    master_admin: 'Administrador Master',
    admin: 'Administrador',
    supervisor_crc: 'Supervisor de CRC',
    sac_operator: 'Operador de CRC',
    manager: 'Gerente de CRC',
    coordinator: 'Coordenador de CRC',
    viewer: 'Marketing'
  };

  return roleLabels[normalizeAccessRole(user?.role)] || 'Profissional CRC';
}

let cachedSelicRate = {
  value: null,
  source: 'fixed_admin_rate',
  updatedAt: 0,
  referenceDate: null,
  periodType: 'annual_fixed'
};

let cachedSelicMonthlySeries = {
  rows: [],
  updatedAt: 0
};

function parseBrazilianDate(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function toFinancialMonthKey(value) {
  if (!value) return null;

  const brazilianDate = parseBrazilianDate(value);
  const date = brazilianDate || new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeFinancialMonth(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const date = normalizeFinancialDate(value);
  return date ? date.slice(0, 7) : new Date().toISOString().slice(0, 7);
}

function compareMonthKey(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function expandFinancialRowMonthKeys(row = {}) {
  const start = toFinancialMonthKey(row.campaign_start_date || row.date);
  const end = toFinancialMonthKey(row.campaign_end_date || row.campaign_start_date || row.date);
  if (!start || !end || compareMonthKey(start, end) > 0) {
    return [toFinancialMonthKey(row.date)].filter(Boolean);
  }

  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  const cursor = new Date(startYear, startMonth - 1, 1);
  const endDate = new Date(endYear, endMonth - 1, 1);
  const months = [];

  while (cursor <= endDate) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function calculateDsrOnCommission(commission) {
  return toFinancialNumber(commission) / 6;
}

function calculateThirteenthProvision(collaborator = {}, referenceMonth = '') {
  const salary = toFinancialNumber(collaborator.salary);
  if (!salary) return 0;

  const month = normalizeFinancialMonth(referenceMonth);
  const hireDateText = collaborator.hire_date ? String(collaborator.hire_date).slice(0, 10) : '';
  if (!month || !hireDateText) return salary / 12;

  const hireDate = new Date(`${hireDateText}T12:00:00`);
  const [year, monthNumber] = month.split('-').map(Number);
  const endOfReferenceMonth = new Date(year, monthNumber, 0, 23, 59, 59);

  if (Number.isNaN(hireDate.getTime()) || Number.isNaN(endOfReferenceMonth.getTime())) return salary / 12;
  if (hireDate > endOfReferenceMonth) return 0;
  if (hireDate.getFullYear() === year && hireDate.getMonth() === monthNumber - 1 && hireDate.getDate() > 16) return 0;

  return salary / 12;
}

function collaboratorBaseMonthlyCost(collaborator = {}, monthly = null, referenceMonth = '', rules = DEFAULT_FINANCIAL_RULES) {
  const receivesCommission = Boolean(Number(collaborator.receives_commission || 0));
  const monthlyCommission = monthly ? toFinancialNumber(monthly.commission) : 0;
  const dsrCommission = receivesCommission ? calculateDsrOnCommission(monthlyCommission) : 0;
  const vacationAmount = monthly && Number(monthly.vacation_paid || 0)
    ? toFinancialNumber(monthly.vacation_amount)
    : 0;
  const laborCost = calculateLaborCostComposition(collaborator, rules, monthly, referenceMonth);

  return toFinancialNumber(laborCost.custo_total_mensal)
    + dsrCommission
    + vacationAmount
    + (monthly ? toFinancialNumber(monthly.other_costs) : 0);
}

function sumOperationalCost(row = {}) {
  return operationalCostFields.reduce((total, field) => total + toFinancialNumber(row[field]), 0);
}

async function getSelicMonthlySeries() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  cachedSelicMonthlySeries = {
    rows: [{ month: currentMonth, value: DEFAULT_SELIC_RATE, referenceDate: currentMonth }],
    updatedAt: Date.now()
  };
  return cachedSelicMonthlySeries.rows;
}

async function getCurrentSelicRate() {
  cachedSelicRate = {
    value: DEFAULT_SELIC_RATE,
    source: 'fixed_admin_rate',
    updatedAt: Date.now(),
    referenceDate: `${new Date().getFullYear()}`,
    periodType: 'annual_fixed',
    description: 'SELIC travada em 15% ao ano por regra administrativa do sistema'
  };
  return cachedSelicRate;
}

async function applyMonthlySelicToRows(rows = []) {
  const current = await getCurrentSelicRate();

  return rows.map((row) => ({
    ...row,
    selic_rate: current.value
  }));
}

async function getFinancialMonthlyCostContext(rows = [], financialRules = DEFAULT_FINANCIAL_RULES) {
  const monthKeys = Array.from(new Set(
    rows.flatMap((row) => expandFinancialRowMonthKeys(row)).filter(Boolean)
  )).sort(compareMonthKey);

  if (!monthKeys.length) {
    return {
      byMonth: {},
      totalCollaboratorCost: 0,
      totalOperationalCost: 0,
      totalAdministrativeCost: 0,
      collaboratorRows: [],
      operationalRows: []
    };
  }

  const [collaborators] = await pool.query(
    `SELECT *
       FROM crc_collaborators
      WHERE deleted_at IS NULL
        AND status <> 'inativo'
      ORDER BY name ASC`
  );

  const [monthlyCollaboratorRows] = await pool.query(
    `SELECT *
       FROM crc_collaborator_monthly_costs
      WHERE deleted_at IS NULL
        AND reference_month IN (?)
      ORDER BY reference_month DESC, collaborator_name ASC`,
    [monthKeys]
  );

  const [operationalRows] = await pool.query(
    `SELECT *
       FROM crc_monthly_operational_costs
      WHERE deleted_at IS NULL
        AND reference_month IN (?)
      ORDER BY reference_month DESC, id DESC`,
    [monthKeys]
  );

  const monthlyByCollaborator = monthlyCollaboratorRows.reduce((acc, row) => {
    acc[`${row.reference_month}:${row.collaborator_id}`] = row;
    return acc;
  }, {});
  const byMonth = {};
  const collaboratorCostRows = [];

  monthKeys.forEach((month) => {
    byMonth[month] = {
      collaboratorCost: 0,
      operationalCost: 0,
      administrativeCost: 0
    };

    collaborators.forEach((collaborator) => {
      const referenceMonth = normalizeFinancialMonth(collaborator.reference_month || collaborator.created_at);
      if (referenceMonth && compareMonthKey(referenceMonth, month) > 0) return;

      const monthly = monthlyByCollaborator[`${month}:${collaborator.id}`] || null;
      const totalCost = collaboratorBaseMonthlyCost(collaborator, monthly, month, financialRules);
      if (!totalCost) return;
      const laborCost = calculateLaborCostComposition(collaborator, financialRules, monthly, month);

      byMonth[month].collaboratorCost += totalCost;
      collaboratorCostRows.push({
        reference_month: month,
        collaborator_id: collaborator.id,
        collaborator_name: collaborator.name,
        function_name: collaborator.function_name,
        clinic_name: collaborator.clinic_name,
        commission: monthly ? toFinancialNumber(monthly.commission) : 0,
        dsr_commission: monthly ? calculateDsrOnCommission(monthly.commission) : 0,
        thirteenth_salary: laborCost.decimo_terceiro,
        labor_costs: laborCost,
        total_cost: totalCost
      });
    });
  });

  operationalRows.forEach((row) => {
    const month = normalizeFinancialMonth(row.reference_month);
    if (!byMonth[month]) {
      byMonth[month] = { collaboratorCost: 0, operationalCost: 0, administrativeCost: 0 };
    }
    byMonth[month].operationalCost += sumOperationalCost(row);
  });

  return {
    byMonth,
    totalCollaboratorCost: Object.values(byMonth).reduce((total, item) => total + toFinancialNumber(item.collaboratorCost), 0),
    totalOperationalCost: Object.values(byMonth).reduce((total, item) => total + toFinancialNumber(item.operationalCost), 0),
    totalAdministrativeCost: Object.values(byMonth).reduce((total, item) => total + toFinancialNumber(item.administrativeCost), 0),
    collaboratorRows: collaboratorCostRows,
    operationalRows
  };
}

async function getFinancialSettings() {
  try {
    const [rows] = await pool.query(
      'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
      ['financial_rules']
    );
    const parsed = rows[0]?.setting_value ? JSON.parse(rows[0].setting_value) : {};
    return normalizeFinancialRules(parsed);
  } catch (error) {
    console.warn('Não foi possível carregar regras financeiras:', error.message);
    return normalizeFinancialRules(DEFAULT_FINANCIAL_RULES);
  }
}

async function saveFinancialSettings(settings, user) {
  const normalized = normalizeFinancialRules(settings);
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    ['financial_rules', JSON.stringify(normalized), getActorName(user)]
  );
  return normalized;
}

async function getClinicSnapshot(clinicId) {
  const id = Number(clinicId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;

  const [rows] = await pool.query(
    'SELECT id, name, city, state, region FROM clinics WHERE id = ? LIMIT 1',
    [id]
  );

  return rows[0] || null;
}

async function getCrcCollaboratorById(collaboratorId) {
  const id = Number(collaboratorId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;

  const [rows] = await pool.query(
    'SELECT * FROM crc_collaborators WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id]
  );

  return rows[0] || null;
}

function applyCollaboratorDefaults(payload, collaborator, sourceBody = {}) {
  if (!collaborator) return payload;

  const next = { ...payload };
  const defaults = {
    collaborator_name: collaborator.name,
    role: collaborator.role,
    function_name: collaborator.function_name
  };

  Object.entries(defaults).forEach(([field, value]) => {
    if ((sourceBody[field] === undefined || sourceBody[field] === '') && (next[field] === undefined || next[field] === null || next[field] === '')) {
      next[field] = value ?? null;
    }
  });

  return next;
}

async function buildFinancialPayload(body = {}, user = {}) {
  const payload = {};
  const date = normalizeFinancialDate(body.date);

  if (!date) {
    throw new Error('Informe uma data válida para o lançamento.');
  }

  payload.date = date;

  editableFinancialFields.forEach((field) => {
    if (field === 'date') return;

    if (field === 'notes') {
      payload.notes = sanitizeFinancialString(body.notes, 2000);
      return;
    }

    if (['campaign_start_date', 'campaign_end_date'].includes(field)) {
      payload[field] = body[field] ? normalizeFinancialDate(body[field]) : null;
      return;
    }

    if (financialIntegerFields.includes(field)) {
      payload[field] = Math.max(0, Math.trunc(toFinancialNumber(body[field])));
      return;
    }

    if (financialMoneyFields.includes(field) || field === 'selic_rate') {
      payload[field] = toFinancialNumber(body[field]);
      return;
    }

    if (['clinic_id', 'supervisor_id', 'operator_id', 'collaborator_id'].includes(field)) {
      const numericValue = Number(body[field] || 0);
      payload[field] = Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
      return;
    }

    payload[field] = sanitizeFinancialString(body[field]);
  });

  const fixedSelic = await getCurrentSelicRate();
  payload.selic_rate = fixedSelic.value || DEFAULT_SELIC_RATE;

  const collaborator = await getCrcCollaboratorById(payload.collaborator_id);
  const withDefaults = applyCollaboratorDefaults(payload, collaborator, body);
  const clinic = await getClinicSnapshot(withDefaults.clinic_id);

  if (clinic) {
    withDefaults.clinic_id = clinic.id;
    withDefaults.clinic_name = clinic.name;
  }

  if (!withDefaults.operator_name) {
    withDefaults.operator_id = user.id || withDefaults.operator_id || null;
    withDefaults.operator_name = getActorName(user);
  }

  if (!withDefaults.function_name) {
    withDefaults.function_name = getFinancialFunctionLabel(user);
  }

  if (!withDefaults.role) {
    withDefaults.role = String(user?.role || '').trim() || null;
  }

  return withDefaults;
}

function buildFinancialWhere(query = {}, user = {}) {
  const where = ['deleted_at IS NULL'];
  const params = [];

  if (query.startDate) {
    where.push('date >= ?');
    params.push(normalizeFinancialDate(query.startDate));
  }

  if (query.endDate) {
    where.push('date <= ?');
    params.push(normalizeFinancialDate(query.endDate));
  }

  const numericFilters = {
    clinicId: 'clinic_id',
    operatorId: 'operator_id',
    collaboratorId: 'collaborator_id',
    supervisorId: 'supervisor_id'
  };

  Object.entries(numericFilters).forEach(([queryKey, column]) => {
    const value = Number(query[queryKey] || 0);
    if (Number.isInteger(value) && value > 0) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  });

  const textFilters = {
    role: 'role',
    functionName: 'function_name',
    unitName: 'unit_name',
    unit: 'unit_name',
    clinicName: 'clinic_name',
    campaign: 'campaign',
    channel: 'channel'
  };

  Object.entries(textFilters).forEach(([queryKey, column]) => {
    const value = sanitizeFinancialString(query[queryKey]);
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  });

  if (normalizeAccessRole(user?.role) === 'sac_operator' && !isAdminUser(user)) {
    where.push('(operator_id = ? OR operator_name = ? OR created_by = ?)');
    params.push(user.id || 0, getActorName(user), getActorName(user));
  }

  return { where, params };
}

function canEditFinancialRecord(user) {
  return canManageFinancialIntelligence(user);
}

const dentalCardLeadFields = [
  'data_indicacao',
  'unidade',
  'nome_lead',
  'telefone',
  'ficha',
  'nome_indicador',
  'vinculo_indicador',
  'email',
  'responsavel_cadastro',
  'foto_url',
  'origem_cadastro',
  'ip_origem',
  'user_agent',
  'link_origem',
  'unidade_slug',
  'data_status',
  'public_form_token',
  'created_via_public_form',
  'data_limite_retorno',
  'primeiro_retorno_em',
  'sla_retorno_status',
  'tipo_indicador',
  'dentista_responsavel',
  'origem',
  'responsavel',
  'responsavel_user_id',
  'status',
  'status_contato',
  'canal_contato',
  'quantidade_tentativas',
  'data_primeiro_contato',
  'data_ultima_tentativa',
  'data_proxima_tentativa',
  'agendado',
  'agendado_por',
  'data_agendamento',
  'hora_agendamento',
  'ecuro_lancado',
  'endereco_enviado',
  'confirmacao_enviada',
  'confirmou_presenca',
  'compareceu',
  'motivo_falta',
  'tentativa_recuperacao',
  'data_reagendamento',
  'pagou',
  'valor_pago',
  'forma_pagamento',
  'receita',
  'pesquisa_satisfacao_enviada',
  'nova_indicacao_solicitada',
  'nova_indicacao_recebida',
  'observacoes',
  'sla_status',
  'dias_sem_contato',
  'encerrado_em',
  'encerrado_por',
  'motivo_encerramento'
];

const dentalCardBooleanFields = [
  'agendado',
  'ecuro_lancado',
  'endereco_enviado',
  'confirmacao_enviada',
  'compareceu',
  'tentativa_recuperacao',
  'pesquisa_satisfacao_enviada',
  'nova_indicacao_solicitada',
  'nova_indicacao_recebida'
];

function canViewDentalCard(user) {
  return isAdminUser(user) || hasScreenPermission(user, 'dental_card');
}

function canManageDentalCard(user) {
  if (isAdminUser(user)) return true;
  const role = normalizeAccessRole(user?.role);
  return ['sac_operator', 'supervisor_crc', 'crc_leader', 'crc_manager', 'crc_operator', 'manager'].includes(role)
    && hasScreenPermission(user, 'dental_card');
}

function canExportDentalCard(user) {
  return canViewDentalCard(user);
}

function canDeleteDentalCard(user) {
  return isMasterAdminUser(user) || normalizeAccessRole(user?.role) === 'admin';
}

function requireDentalCardView(req, res, next) {
  if (!canViewDentalCard(req.user)) {
    return res.status(403).json({ error: 'Acesso ao Dental Card não autorizado para este perfil.' });
  }

  return next();
}

function normalizeDentalDateTimeValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toMysqlDateTime(value);
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return text.length === 16 ? `${text}:00` : text;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : toMysqlDateTime(date);
}

function normalizeDentalTimeValue(value) {
  const time = normalizeDentalTime(value);
  return time ? `${time}:00` : null;
}

function normalizeDentalPaymentStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['sim', 'pagou', 'pago', '1', 'true'].includes(normalized)) return 'pagou';
  if (['parcial', 'parcialmente'].includes(normalized)) return 'parcial';
  if (['nao', 'não', 'nao pagou', 'não pagou', '0', 'false'].includes(normalized)) return 'nao';
  return normalized || 'pendente';
}

function resolveDentalReturnSla(lead = {}, now = new Date()) {
  const firstReturn = lead.primeiro_retorno_em || lead.data_primeiro_contato || null;
  const createdAt = lead.created_at ? new Date(lead.created_at) : new Date();
  const limit = lead.data_limite_retorno
    ? new Date(lead.data_limite_retorno)
    : new Date(createdAt.getTime() + dentalCardSlaHours * 60 * 60 * 1000);

  if (firstReturn) {
    const firstReturnDate = new Date(firstReturn);
    return {
      data_limite_retorno: Number.isNaN(limit.getTime()) ? null : toMysqlDateTime(limit),
      sla_retorno_status: !Number.isNaN(firstReturnDate.getTime()) && !Number.isNaN(limit.getTime()) && firstReturnDate <= limit
        ? 'cumprido'
        : 'cumprido_atrasado',
      tempo_restante_minutos: 0
    };
  }

  if (Number.isNaN(limit.getTime())) {
    return {
      data_limite_retorno: null,
      sla_retorno_status: 'pendente',
      tempo_restante_minutos: null
    };
  }

  const remainingMinutes = Math.floor((limit.getTime() - now.getTime()) / 60000);
  if (remainingMinutes <= 0) {
    return {
      data_limite_retorno: toMysqlDateTime(limit),
      sla_retorno_status: 'vencido',
      tempo_restante_minutos: remainingMinutes
    };
  }

  if (remainingMinutes <= 4 * 60) {
    return {
      data_limite_retorno: toMysqlDateTime(limit),
      sla_retorno_status: 'atencao',
      tempo_restante_minutos: remainingMinutes
    };
  }

  return {
    data_limite_retorno: toMysqlDateTime(limit),
    sla_retorno_status: 'pendente',
    tempo_restante_minutos: remainingMinutes
  };
}

function normalizeDentalEmail(value) {
  const email = normalizeDentalText(value, 220);
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null;
}

function buildDentalCardPayload(body = {}, user = {}, existing = {}) {
  const merged = { ...existing, ...body };
  const unidade = normalizeDentalText(merged.unidade, 180);
  const nomeLead = normalizeDentalText(merged.nome_lead || merged.nomeLead || merged.nome_paciente, 180);
  const telefone = normalizeDentalPhone(merged.telefone || merged.phone);

  if (!unidade || !nomeLead || !telefone) {
    throw new Error('Informe unidade, nome do lead e telefone para cadastrar o Dental Card.');
  }

  const payload = {
    data_indicacao: normalizeDentalDate(merged.data_indicacao || merged.dataIndicacao) || new Date().toISOString().slice(0, 10),
    unidade,
    nome_lead: nomeLead,
    telefone,
    ficha: normalizeDentalText(merged.ficha, 80),
    nome_indicador: normalizeDentalText(merged.nome_indicador || merged.nomeIndicador, 180),
    vinculo_indicador: normalizeDentalText(merged.vinculo_indicador || merged.vinculoIndicador || merged.vinculo, 120),
    email: normalizeDentalEmail(merged.email || merged.endereco_email || merged.enderecoEmail),
    responsavel_cadastro: normalizeDentalText(merged.responsavel_cadastro || merged.responsavelCadastro, 180),
    foto_url: normalizeStoredUploadUrl(merged.foto_url || merged.fotoUrl),
    origem_cadastro: normalizeDentalText(merged.origem_cadastro || merged.origemCadastro, 160),
    ip_origem: normalizeDentalText(merged.ip_origem || merged.ipOrigem, 80),
    user_agent: normalizeDentalText(merged.user_agent || merged.userAgent, 500),
    link_origem: normalizeDentalText(merged.link_origem || merged.linkOrigem, 500),
    unidade_slug: normalizeDentalText(merged.unidade_slug || merged.unidadeSlug, 180),
    data_status: normalizeDentalDateTimeValue(merged.data_status || merged.dataStatus),
    public_form_token: normalizeDentalText(merged.public_form_token || merged.publicFormToken, 120),
    created_via_public_form: toDentalBoolean(merged.created_via_public_form || merged.createdViaPublicForm),
    data_limite_retorno: normalizeDentalDateTimeValue(merged.data_limite_retorno || merged.dataLimiteRetorno),
    primeiro_retorno_em: normalizeDentalDateTimeValue(merged.primeiro_retorno_em || merged.primeiroRetornoEm),
    sla_retorno_status: normalizeDentalText(merged.sla_retorno_status || merged.slaRetornoStatus, 40) || 'pendente',
    tipo_indicador: normalizeDentalText(merged.tipo_indicador || merged.tipoIndicador, 80),
    dentista_responsavel: normalizeDentalText(merged.dentista_responsavel || merged.dentistaResponsavel, 180),
    origem: normalizeDentalText(merged.origem, 120) || 'Indicação manual',
    responsavel: normalizeDentalText(merged.responsavel, 180) || dentalCardDefaultResponsible,
    responsavel_user_id: Number(merged.responsavel_user_id || merged.responsavelUserId || user?.id || 0) || null,
    status: normalizeDentalText(merged.status, 80) || deriveDentalStatus(merged),
    status_contato: normalizeDentalText(merged.status_contato || merged.statusContato, 80),
    canal_contato: normalizeDentalText(merged.canal_contato || merged.canalContato, 80),
    quantidade_tentativas: Math.max(0, Number.parseInt(merged.quantidade_tentativas || merged.quantidadeTentativas || 0, 10) || 0),
    data_primeiro_contato: normalizeDentalDateTimeValue(merged.data_primeiro_contato || merged.dataPrimeiroContato),
    data_ultima_tentativa: normalizeDentalDateTimeValue(merged.data_ultima_tentativa || merged.dataUltimaTentativa),
    data_proxima_tentativa: normalizeDentalDateTimeValue(merged.data_proxima_tentativa || merged.dataProximaTentativa),
    agendado: toDentalBoolean(merged.agendado),
    agendado_por: normalizeDentalText(merged.agendado_por || merged.agendadoPor, 80),
    data_agendamento: normalizeDentalDate(merged.data_agendamento || merged.dataAgendamento),
    hora_agendamento: normalizeDentalTimeValue(merged.hora_agendamento || merged.horaAgendamento),
    ecuro_lancado: toDentalBoolean(merged.ecuro_lancado || merged.ecuroLancado),
    endereco_enviado: toDentalBoolean(merged.endereco_enviado || merged.enderecoEnviado),
    confirmacao_enviada: toDentalBoolean(merged.confirmacao_enviada || merged.confirmacaoEnviada),
    confirmou_presenca: normalizeDentalText(merged.confirmou_presenca || merged.confirmouPresenca, 40) || 'pendente',
    compareceu: toDentalBoolean(merged.compareceu),
    motivo_falta: normalizeDentalText(merged.motivo_falta || merged.motivoFalta, 500),
    tentativa_recuperacao: toDentalBoolean(merged.tentativa_recuperacao || merged.tentativaRecuperacao),
    data_reagendamento: normalizeDentalDate(merged.data_reagendamento || merged.dataReagendamento),
    pagou: normalizeDentalPaymentStatus(merged.pagou),
    valor_pago: toDentalNumber(merged.valor_pago || merged.valorPago),
    forma_pagamento: normalizeDentalText(merged.forma_pagamento || merged.formaPagamento, 80),
    receita: toDentalNumber(merged.receita || merged.valor_pago || merged.valorPago),
    pesquisa_satisfacao_enviada: toDentalBoolean(merged.pesquisa_satisfacao_enviada || merged.pesquisaSatisfacaoEnviada),
    nova_indicacao_solicitada: toDentalBoolean(merged.nova_indicacao_solicitada || merged.novaIndicacaoSolicitada),
    nova_indicacao_recebida: toDentalBoolean(merged.nova_indicacao_recebida || merged.novaIndicacaoRecebida),
    observacoes: normalizeDentalText(merged.observacoes, 5000),
    encerrado_em: normalizeDentalDateTimeValue(merged.encerrado_em || merged.encerradoEm),
    encerrado_por: normalizeDentalText(merged.encerrado_por || merged.encerradoPor, 180),
    motivo_encerramento: normalizeDentalText(merged.motivo_encerramento || merged.motivoEncerramento, 500)
  };

  if (!payload.data_proxima_tentativa && payload.quantidade_tentativas > 0) {
    payload.data_proxima_tentativa = toMysqlDateTime(nextAttemptFromCount(payload.quantidade_tentativas));
  }

  const sla = resolveDentalSla(payload);
  payload.sla_status = sla.sla_status;
  payload.dias_sem_contato = sla.dias_sem_contato;
  return payload;
}

function buildDentalCardWhere(query = {}) {
  const where = ['deleted_at IS NULL'];
  const params = [];
  const startDate = normalizeDentalDate(query.startDate || query.start_date);
  const endDate = normalizeDentalDate(query.endDate || query.end_date);

  if (startDate) {
    where.push('(data_indicacao >= ? OR data_agendamento >= ?)');
    params.push(startDate, startDate);
  }

  if (endDate) {
    where.push('(data_indicacao <= ? OR data_agendamento <= ?)');
    params.push(endDate, endDate);
  }

  [
    ['unidade', query.unidade],
    ['origem', query.origem],
    ['origem_cadastro', query.origemCadastro || query.origem_cadastro],
    ['nome_indicador', query.indicador],
    ['responsavel', query.responsavel],
    ['status', query.status],
    ['pagou', query.pagamento || query.pagou],
    ['sla_status', query.slaStatus || query.sla_status],
    ['sla_retorno_status', query.slaRetornoStatus || query.sla_retorno_status]
  ].forEach(([column, value]) => {
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  });

  if (query.retornoHoje === 'true' || query.retornoHoje === true) {
    where.push('DATE(data_proxima_tentativa) = CURDATE()');
  }

  if (query.atrasados === 'true' || query.atrasados === true) {
    where.push("sla_status IN ('atrasado', 'atencao')");
  }

  if (query.createdViaPublicForm === 'true' || query.created_via_public_form === 'true' || query.publico === 'true') {
    where.push('created_via_public_form = 1');
  }

  if (query.comFoto === 'true' || query.withPhoto === 'true') {
    where.push("foto_url IS NOT NULL AND TRIM(foto_url) <> ''");
  }

  if (query.semFoto === 'true' || query.withoutPhoto === 'true') {
    where.push("(foto_url IS NULL OR TRIM(foto_url) = '')");
  }

  if (query.search) {
    where.push('(nome_lead LIKE ? OR telefone LIKE ? OR ficha LIKE ? OR unidade LIKE ? OR nome_indicador LIKE ? OR email LIKE ?)');
    const search = `%${String(query.search).trim()}%`;
    params.push(search, search, search, search, search, search);
  }

  return { where, params };
}

async function refreshDentalCardSlaForRows(rows = []) {
  return rows.map((row) => ({ ...row, ...resolveDentalSla(row), ...resolveDentalReturnSla(row) }));
}

async function getDentalCardRows(query = {}) {
  const { where, params } = buildDentalCardWhere(query);
  const [rows] = await pool.query(
    `SELECT *
       FROM dental_card_leads
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(data_proxima_tentativa, data_agendamento, data_indicacao, created_at) DESC, id DESC`,
    params
  );

  return refreshDentalCardSlaForRows(rows);
}

async function insertDentalCardAudit(req, action, leadId = null, details = {}) {
  try {
    await pool.query(
      `INSERT INTO dental_card_audit_logs (lead_id, user_id, user_name, user_role, action, ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        leadId,
        req.user?.id || null,
        getActorName(req.user),
        req.user?.role || null,
        action,
        getRequestIp(req),
        JSON.stringify(details || {})
      ]
    );
  } catch (error) {
    console.warn('Não foi possível registrar auditoria Dental Card:', error.message);
  }
}

function buildDentalCardPublicLink(leadId = '') {
  return `/dental-card${leadId ? `?leadId=${leadId}` : ''}`;
}

function formatDentalSlaLimit(value) {
  if (!value) return 'Não informado';
  return formatMessageDateTime(value);
}

async function getDentalCardNotificationRecipients(lead = {}) {
  const unidade = normalizeDentalText(lead.unidade, 180);
  const [settings] = await pool.query(
    `SELECT s.*, u.id AS user_id, u.name, u.role, u.whatsapp, u.phone
       FROM dental_card_notification_settings s
       INNER JOIN users u ON u.id = s.user_id
      WHERE s.ativo = 1
        AND s.recebe_notificacao_sistema = 1
        AND u.active = 1
        AND u.deleted_at IS NULL
        AND (s.unidade IS NULL OR TRIM(s.unidade) = '' OR s.unidade = ?)`,
    [unidade || '']
  );

  if (settings.length) {
    return settings;
  }

  const [fallbackUsers] = await pool.query(
    `SELECT id AS user_id, name, role, whatsapp, phone
       FROM users
      WHERE active = 1
        AND deleted_at IS NULL
        AND (
          role IN ('master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager', 'crc_operator')
          OR permissions LIKE '%dental_card%'
        )`
  );

  return fallbackUsers.map((user) => ({
    ...user,
    recebe_notificacao_sistema: 1,
    recebe_notificacao_whatsapp: 0,
    telefone_whatsapp: user.whatsapp || user.phone || null,
    unidade: null
  }));
}

async function notifyDentalCardRecipients(lead = {}, tipo = 'nova_indicacao') {
  const recipients = await getDentalCardNotificationRecipients(lead);
  const titleByType = {
    nova_indicacao: 'Nova indicação Dental Card',
    pendente_12h: 'Indicação Dental Card pendente há 12 horas',
    proxima_vencimento: 'Dental Card próximo do vencimento',
    sla_vencido: 'SLA Dental Card vencido'
  };
  const messageByType = {
    nova_indicacao: 'Nova indicação recebida no Programa Dental Card. Prazo de retorno: 24 horas.',
    pendente_12h: 'Indicação Dental Card pendente há 12 horas. O retorno ainda não foi registrado.',
    proxima_vencimento: 'Atenção: indicação Dental Card próxima do vencimento do SLA.',
    sla_vencido: 'SLA vencido: indicação sem retorno dentro de 24 horas.'
  };
  const title = titleByType[tipo] || titleByType.nova_indicacao;
  const message = messageByType[tipo] || messageByType.nova_indicacao;
  const payload = {
    leadId: lead.id,
    nome_lead: lead.nome_lead,
    telefone: lead.telefone,
    unidade: lead.unidade,
    nome_indicador: lead.nome_indicador,
    created_at: lead.created_at,
    data_limite_retorno: lead.data_limite_retorno,
    sla_retorno_status: lead.sla_retorno_status,
    link: buildDentalCardPublicLink(lead.id)
  };

  await Promise.all(recipients.map(async (recipient) => {
    await createNotification(
      recipient.user_id,
      tipo === 'nova_indicacao' ? 'dental_card_new_indication' : 'dental_card_sla_alert',
      title,
      `${message} Paciente: ${lead.nome_lead}. Unidade: ${lead.unidade}.`,
      buildDentalCardPublicLink(lead.id),
      payload
    );

    await pool.query(
      `INSERT INTO dental_card_notification_logs
       (lead_id, user_id, tipo_notificacao, canal, mensagem, status_envio, data_envio, erro)
       VALUES (?, ?, ?, 'SISTEMA', ?, 'enviado', NOW(), NULL)`,
      [lead.id || null, recipient.user_id || null, tipo, message]
    );

    if (Number(recipient.recebe_notificacao_whatsapp || 0)) {
      await pool.query(
        `INSERT INTO dental_card_notification_logs
         (lead_id, user_id, tipo_notificacao, canal, mensagem, status_envio, data_envio, erro)
         VALUES (?, ?, ?, 'WHATSAPP', ?, 'pendente_configuracao', NOW(), ?)`,
        [
          lead.id || null,
          recipient.user_id || null,
          tipo,
          `Nova indicação Dental Card recebida.\nPaciente: ${lead.nome_lead}\nTelefone: ${lead.telefone}\nUnidade: ${lead.unidade}\nIndicado por: ${lead.nome_indicador || 'Não informado'}\nPrazo de retorno: ${formatDentalSlaLimit(lead.data_limite_retorno)}`,
          'Sessão/número remetente do WhatsApp Dental Card ainda não configurado.'
        ]
      );
    }
  }));

  return recipients.length;
}

async function runDentalCardSlaNotificationSweep() {
  const [rows] = await pool.query(
    `SELECT *
       FROM dental_card_leads
      WHERE deleted_at IS NULL
        AND created_via_public_form = 1
        AND primeiro_retorno_em IS NULL
        AND data_primeiro_contato IS NULL
        AND status NOT IN ('Encerrado', 'Cancelado', 'Pagou')
      ORDER BY COALESCE(data_limite_retorno, created_at) ASC
      LIMIT 200`
  );

  let notified = 0;
  const now = new Date();

  for (const row of rows) {
    const createdAt = row.created_at ? new Date(row.created_at) : now;
    const elapsedHours = Number.isNaN(createdAt.getTime()) ? 0 : (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
    const returnSla = resolveDentalReturnSla(row, now);
    await pool.query(
      `UPDATE dental_card_leads
          SET data_limite_retorno = ?,
              sla_retorno_status = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [returnSla.data_limite_retorno, returnSla.sla_retorno_status, row.id]
    );

    const lead = { ...row, ...returnSla };
    let tipo = null;
    if (elapsedHours >= dentalCardSlaHours) tipo = 'sla_vencido';
    else if (elapsedHours >= dentalCardSlaCriticalHours) tipo = 'proxima_vencimento';
    else if (elapsedHours >= dentalCardSlaWarningHours) tipo = 'pendente_12h';
    if (!tipo) continue;

    const [recentLogs] = await pool.query(
      `SELECT id, created_at
         FROM dental_card_notification_logs
        WHERE lead_id = ?
          AND tipo_notificacao = ?
          AND canal = 'SISTEMA'
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        LIMIT 1`,
      [
        row.id,
        tipo,
        tipo === 'sla_vencido' ? dentalCardSlaRepeatHours : Math.max(24, dentalCardSlaHours)
      ]
    );

    if (recentLogs.length) continue;
    await notifyDentalCardRecipients(lead, tipo);
    notified += 1;
  }

  return { checked: rows.length, notified };
}

function sanitizePublicDentalText(value, maxLength = 255) {
  return normalizeDentalText(String(value || '').replace(/[<>]/g, ' '), maxLength);
}

function isValidPublicDentalPhoto(file) {
  if (!file?.path || !file?.mimetype?.startsWith('image/')) return false;
  try {
    const header = fs.readFileSync(file.path).subarray(0, 16);
    const hex = header.toString('hex');
    const ascii = header.toString('ascii');
    return hex.startsWith('ffd8ff')
      || hex.startsWith('89504e47')
      || ascii.startsWith('GIF8')
      || ascii.includes('WEBP')
      || ascii.includes('ftyp');
  } catch (error) {
    return false;
  }
}

async function handleGetPublicDentalCardConfig(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, city, state
         FROM clinics
        ORDER BY name ASC`
    );

    return res.json({
      title: 'Programa Dental Card - Indicação de Pacientes',
      slaHours: dentalCardSlaHours,
      clinics: rows.map((clinic) => ({
        id: clinic.id,
        name: clinic.name,
        city: clinic.city,
        state: clinic.state,
        slug: slugify(clinic.name)
      }))
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível carregar as unidades Dental Card.' });
  }
}

async function handleCreatePublicDentalCardLead(req, res) {
  try {
    if (req.body?.website || req.body?.company_site || req.body?.hp_field) {
      return res.status(400).json({ error: 'Não foi possível receber a indicação.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Envie a foto com quem indicou para concluir a indicação.' });
    }

    if (!isValidPublicDentalPhoto(req.file)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'A foto enviada não é uma imagem válida.' });
    }

    const emailInput = sanitizePublicDentalText(req.body.email || req.body.endereco_email || req.body.enderecoEmail, 220);
    if (emailInput && !normalizeDentalEmail(emailInput)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Informe um e-mail válido ou deixe o campo em branco.' });
    }

    const telefone = normalizeDentalPhone(req.body.telefone || req.body.phone || req.body.whatsapp);
    if (!/^55\d{10,11}$/.test(telefone)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Informe o telefone com DDD no padrão brasileiro.' });
    }

    const nomeLead = sanitizePublicDentalText(req.body.nome_lead || req.body.nomeLead || req.body.nome_indicado || req.body.nomeIndicado, 180);
    const unidade = sanitizePublicDentalText(req.body.unidade, 180);
    const nomeIndicador = sanitizePublicDentalText(req.body.nome_indicador || req.body.nomeIndicador || req.body.quem_indicou || req.body.quemIndicou, 180);
    const vinculoIndicador = sanitizePublicDentalText(req.body.vinculo_indicador || req.body.vinculoIndicador || req.body.vinculo, 120);

    if (!nomeLead || !unidade || !nomeIndicador || !vinculoIndicador) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Preencha quem indicou, vínculo, nome do indicado, telefone e unidade.' });
    }

    const [duplicates] = await pool.query(
      `SELECT id
         FROM dental_card_leads
        WHERE deleted_at IS NULL
          AND telefone = ?
          AND created_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR)
        LIMIT 1`,
      [telefone]
    );

    if (duplicates.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(409).json({ error: 'Já recebemos uma indicação recente para este telefone. Nossa equipe fará o acompanhamento.' });
    }

    const now = new Date();
    const slaLimit = new Date(now.getTime() + dentalCardSlaHours * 60 * 60 * 1000);
    const fileUrl = `/uploads/${req.file.filename}`;
    const publicToken = crypto.randomBytes(18).toString('hex');
    const payload = buildDentalCardPayload({
      data_indicacao: now.toISOString().slice(0, 10),
      unidade,
      nome_lead: nomeLead,
      telefone,
      nome_indicador: nomeIndicador,
      vinculo_indicador: vinculoIndicador,
      tipo_indicador: sanitizePublicDentalText(req.body.tipo_indicador || req.body.tipoIndicador, 80),
      email: emailInput,
      responsavel_cadastro: sanitizePublicDentalText(req.body.responsavel_cadastro || req.body.responsavelCadastro, 180),
      status: 'Indicação Recebida',
      origem: 'Formulário Público Dental Card',
      origem_cadastro: 'Formulário Público Dental Card',
      foto_url: fileUrl,
      ip_origem: getRequestIp(req),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
      link_origem: String(req.headers.referer || req.body.link_origem || req.body.linkOrigem || '').slice(0, 500),
      unidade_slug: sanitizePublicDentalText(req.params.unidadeSlug || req.body.unidade_slug || req.body.unidadeSlug || slugify(unidade), 180),
      data_status: normalizeDentalDateTimeValue(req.body.data || req.body.data_status || req.body.dataStatus) || toMysqlDateTime(now),
      public_form_token: publicToken,
      created_via_public_form: 1,
      data_limite_retorno: toMysqlDateTime(slaLimit),
      sla_retorno_status: 'pendente',
      observacoes: sanitizePublicDentalText(req.body.observacoes, 5000)
    }, { name: 'Formulário Público Dental Card' });

    const columns = [...dentalCardLeadFields, 'created_by', 'updated_by'];
    const values = dentalCardLeadFields.map((field) => payload[field] ?? null);
    values.push('Formulário Público Dental Card', 'Formulário Público Dental Card');
    const [result] = await pool.query(
      `INSERT INTO dental_card_leads (${columns.map((column) => `\`${column}\``).join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
      values
    );

    await pool.query(
      `INSERT INTO dental_card_attachments
       (lead_id, file_name, file_url, file_type, file_size, uploaded_by, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        result.insertId,
        normalizeUploadedOriginalName(req.file) || req.file.originalname || req.file.filename,
        fileUrl,
        req.file.mimetype,
        req.file.size,
        'Formulário Público Dental Card',
        'public_form'
      ]
    );

    await pool.query(
      `INSERT INTO dental_card_attempts
       (lead_id, responsavel, tipo_contato, canal, resultado, observacao)
       VALUES (?, 'Formulário Público', 'cadastro_publico', 'Formulário Público', 'Lead criado via formulário público Dental Card.', ?)`,
      [result.insertId, payload.observacoes || null]
    );

    await insertDentalCardAudit(req, 'public_lead_created', result.insertId, {
      telefone,
      unidade,
      nome_lead: nomeLead,
      nome_indicador: nomeIndicador,
      ip: getRequestIp(req)
    });

    const [rows] = await pool.query('SELECT * FROM dental_card_leads WHERE id = ? LIMIT 1', [result.insertId]);
    const lead = { ...rows[0], ...resolveDentalReturnSla(rows[0]) };
    await notifyDentalCardRecipients(lead, 'nova_indicacao');

    return res.status(201).json({
      success: true,
      message: 'Indicação recebida com sucesso. Nossa equipe entrará em contato.',
      protocol: `DC-${String(result.insertId).padStart(6, '0')}`
    });
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    console.error(error);
    return res.status(400).json({ error: error.message || 'Não foi possível receber a indicação Dental Card.' });
  }
}

async function handleGetDentalCardDashboard(req, res) {
  try {
    const rows = await getDentalCardRows(req.query);
    return res.json(buildDentalDashboard(rows));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar dashboard Dental Card.' });
  }
}

async function handleGetDentalCardLeads(req, res) {
  try {
    const rows = await getDentalCardRows(req.query);
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar leads Dental Card.' });
  }
}

async function handleGetDentalCardLead(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM dental_card_leads WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Lead Dental Card não encontrado.' });

    const [attempts] = await pool.query(
      'SELECT * FROM dental_card_attempts WHERE lead_id = ? ORDER BY created_at DESC, id DESC',
      [req.params.id]
    );
    const [audit] = await pool.query(
      'SELECT * FROM dental_card_audit_logs WHERE lead_id = ? ORDER BY created_at DESC, id DESC LIMIT 50',
      [req.params.id]
    );
    const [attachments] = await pool.query(
      'SELECT * FROM dental_card_attachments WHERE lead_id = ? ORDER BY uploaded_at DESC, id DESC',
      [req.params.id]
    );

    return res.json({ ...rows[0], ...resolveDentalSla(rows[0]), ...resolveDentalReturnSla(rows[0]), attempts, audit, attachments });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar lead Dental Card.' });
  }
}

async function handleCreateDentalCardLead(req, res) {
  try {
    if (!canManageDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode cadastrar leads Dental Card.' });
    }

    const payload = buildDentalCardPayload(req.body, req.user);
    const [duplicateRows] = await pool.query(
      `SELECT id FROM dental_card_leads
        WHERE deleted_at IS NULL
          AND telefone = ?
          AND COALESCE(data_agendamento, data_indicacao) = COALESCE(?, ?)
          AND COALESCE(ficha, '') = COALESCE(?, '')
        LIMIT 1`,
      [payload.telefone, payload.data_agendamento, payload.data_indicacao, payload.ficha]
    );

    if (duplicateRows.length) {
      return res.status(409).json({ error: 'Lead duplicado por telefone, data e ficha.', duplicateId: duplicateRows[0].id });
    }

    const columns = [...dentalCardLeadFields, 'created_by', 'updated_by'];
    const values = dentalCardLeadFields.map((field) => payload[field] ?? null);
    values.push(getActorName(req.user), getActorName(req.user));

    const [result] = await pool.query(
      `INSERT INTO dental_card_leads (${columns.map((column) => `\`${column}\``).join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
      values
    );

    await insertDentalCardAudit(req, 'lead_created', result.insertId, payload);
    const [rows] = await pool.query('SELECT * FROM dental_card_leads WHERE id = ? LIMIT 1', [result.insertId]);
    return res.status(201).json({ ...rows[0], ...resolveDentalSla(rows[0]), ...resolveDentalReturnSla(rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao cadastrar lead Dental Card.' });
  }
}

async function handleUpdateDentalCardLead(req, res) {
  try {
    if (!canManageDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode editar leads Dental Card.' });
    }

    const [existingRows] = await pool.query(
      'SELECT * FROM dental_card_leads WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );
    if (!existingRows.length) return res.status(404).json({ error: 'Lead Dental Card não encontrado.' });

    const payload = buildDentalCardPayload(req.body, req.user, existingRows[0]);
    const columns = [...dentalCardLeadFields, 'updated_by'];
    const values = dentalCardLeadFields.map((field) => payload[field] ?? null);
    values.push(getActorName(req.user), req.params.id);

    await pool.query(
      `UPDATE dental_card_leads
          SET ${columns.map((column) => `\`${column}\` = ?`).join(', ')}
        WHERE id = ?`,
      values
    );

    await insertDentalCardAudit(req, 'lead_updated', req.params.id, payload);
    const [rows] = await pool.query('SELECT * FROM dental_card_leads WHERE id = ? LIMIT 1', [req.params.id]);
    return res.json({ ...rows[0], ...resolveDentalSla(rows[0]), ...resolveDentalReturnSla(rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao editar lead Dental Card.' });
  }
}

async function handleDeleteDentalCardLead(req, res) {
  try {
    if (!canDeleteDentalCard(req.user)) {
      return res.status(403).json({ error: 'Somente administradores podem excluir leads Dental Card.' });
    }

    await pool.query(
      `UPDATE dental_card_leads
          SET deleted_at = NOW(), deleted_by = ?, updated_by = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [getActorName(req.user), getActorName(req.user), req.params.id]
    );
    await insertDentalCardAudit(req, 'lead_deleted', req.params.id, { deleted: true });
    return res.json({ message: 'Lead Dental Card excluído com histórico preservado.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir lead Dental Card.' });
  }
}

async function handleCreateDentalCardAttempt(req, res) {
  try {
    if (!canManageDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode registrar tentativa no Dental Card.' });
    }

    const [leadRows] = await pool.query(
      'SELECT * FROM dental_card_leads WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );
    if (!leadRows.length) return res.status(404).json({ error: 'Lead Dental Card não encontrado.' });

    const attemptCount = Number(leadRows[0].quantidade_tentativas || 0) + 1;
    const now = new Date();
    const nextAction = normalizeDentalDateTimeValue(req.body.data_proxima_acao || req.body.dataProximaAcao)
      || toMysqlDateTime(nextAttemptFromCount(attemptCount, now));
    const payload = {
      responsavel: normalizeDentalText(req.body.responsavel, 180) || getActorName(req.user),
      responsavel_user_id: req.user?.id || null,
      tipo_contato: normalizeDentalText(req.body.tipo_contato || req.body.tipoContato, 80),
      canal: normalizeDentalText(req.body.canal, 80) || 'WhatsApp',
      resultado: normalizeDentalText(req.body.resultado, 120) || 'Tentativa registrada',
      observacao: normalizeDentalText(req.body.observacao, 5000),
      proxima_acao: normalizeDentalText(req.body.proxima_acao || req.body.proximaAcao, 180),
      data_proxima_acao: nextAction
    };

    const [result] = await pool.query(
      `INSERT INTO dental_card_attempts
       (lead_id, responsavel, responsavel_user_id, tipo_contato, canal, resultado, observacao, proxima_acao, data_proxima_acao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        payload.responsavel,
        payload.responsavel_user_id,
        payload.tipo_contato,
        payload.canal,
        payload.resultado,
        payload.observacao,
        payload.proxima_acao,
        payload.data_proxima_acao
      ]
    );

    const updatePayload = {
      quantidade_tentativas: attemptCount,
      data_primeiro_contato: leadRows[0].data_primeiro_contato || toMysqlDateTime(now),
      primeiro_retorno_em: leadRows[0].primeiro_retorno_em || toMysqlDateTime(now),
      data_ultima_tentativa: toMysqlDateTime(now),
      data_proxima_tentativa: nextAction,
      status_contato: payload.resultado,
      canal_contato: payload.canal,
      status: req.body.status || leadRows[0].status || 'Em follow-up',
      updated_by: getActorName(req.user)
    };
    const sla = resolveDentalSla({ ...leadRows[0], ...updatePayload });
    const returnSla = resolveDentalReturnSla({ ...leadRows[0], ...updatePayload }, now);
    await pool.query(
      `UPDATE dental_card_leads
          SET quantidade_tentativas = ?,
              data_primeiro_contato = COALESCE(data_primeiro_contato, ?),
              primeiro_retorno_em = COALESCE(primeiro_retorno_em, ?),
              data_ultima_tentativa = ?,
              data_proxima_tentativa = ?,
              status_contato = ?,
              canal_contato = ?,
              status = ?,
              sla_status = ?,
              dias_sem_contato = ?,
              sla_retorno_status = ?,
              updated_by = ?
        WHERE id = ?`,
      [
        updatePayload.quantidade_tentativas,
        updatePayload.data_primeiro_contato,
        updatePayload.primeiro_retorno_em,
        updatePayload.data_ultima_tentativa,
        updatePayload.data_proxima_tentativa,
        updatePayload.status_contato,
        updatePayload.canal_contato,
        updatePayload.status,
        sla.sla_status,
        sla.dias_sem_contato,
        returnSla.sla_retorno_status,
        updatePayload.updated_by,
        req.params.id
      ]
    );

    await insertDentalCardAudit(req, 'attempt_created', req.params.id, payload);
    const [rows] = await pool.query('SELECT * FROM dental_card_attempts WHERE id = ? LIMIT 1', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao registrar tentativa.' });
  }
}

async function handleUpdateDentalCardStatus(req, res) {
  try {
    if (!canManageDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode alterar status Dental Card.' });
    }

    const status = normalizeDentalText(req.body.status, 80);
    if (!status || !dentalCardStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status Dental Card inválido.' });
    }

    const [leadRows] = await pool.query('SELECT * FROM dental_card_leads WHERE id = ? AND deleted_at IS NULL LIMIT 1', [req.params.id]);
    if (!leadRows.length) return res.status(404).json({ error: 'Lead Dental Card não encontrado.' });

    const patch = {
      status,
      agendado: ['Agendado IA', 'Agendado Joyce/CRC', 'Confirmado'].includes(status) ? 1 : leadRows[0].agendado,
      compareceu: status === 'Compareceu' || status === 'Pagou' ? 1 : leadRows[0].compareceu,
      pagou: status === 'Pagou' ? 'pagou' : leadRows[0].pagou,
      encerrado_em: status === 'Encerrado' ? toMysqlDateTime(new Date()) : leadRows[0].encerrado_em,
      encerrado_por: status === 'Encerrado' ? getActorName(req.user) : leadRows[0].encerrado_por
    };
    const sla = resolveDentalSla({ ...leadRows[0], ...patch });
    await pool.query(
      `UPDATE dental_card_leads
          SET status = ?,
              agendado = ?,
              compareceu = ?,
              pagou = ?,
              encerrado_em = ?,
              encerrado_por = ?,
              motivo_encerramento = COALESCE(?, motivo_encerramento),
              sla_status = ?,
              dias_sem_contato = ?,
              updated_by = ?
        WHERE id = ?`,
      [
        patch.status,
        patch.agendado,
        patch.compareceu,
        patch.pagou,
        patch.encerrado_em,
        patch.encerrado_por,
        normalizeDentalText(req.body.motivo_encerramento || req.body.motivoEncerramento, 500),
        sla.sla_status,
        sla.dias_sem_contato,
        getActorName(req.user),
        req.params.id
      ]
    );

    await insertDentalCardAudit(req, 'status_updated', req.params.id, { status });
    const [rows] = await pool.query('SELECT * FROM dental_card_leads WHERE id = ? LIMIT 1', [req.params.id]);
    return res.json({ ...rows[0], ...resolveDentalSla(rows[0]) });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao alterar status Dental Card.' });
  }
}

async function handleImportDentalCard(req, res) {
  try {
    if (!canManageDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode importar planilhas Dental Card.' });
    }

    if (!req.file) return res.status(400).json({ error: 'Envie uma planilha .xlsx ou .xls.' });

    const extension = path.extname(req.file.originalname || '').toLowerCase();
    if (!['.xlsx', '.xls'].includes(extension)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Formato inválido. Use .xlsx ou .xls.' });
    }

    const parsed = parseDentalCardWorkbook(fs.readFileSync(req.file.path));
    fs.unlink(req.file.path, () => {});
    const commit = String(req.body.commit || req.query.commit || '').toLowerCase() === 'true';

    if (!commit) {
      await insertDentalCardAudit(req, 'import_preview', null, parsed.summary);
      return res.json({ ...parsed, preview: parsed.rows.slice(0, 50), committed: false });
    }

    let imported = 0;
    let skipped = 0;
    for (const row of parsed.rows) {
      const payload = buildDentalCardPayload(row, req.user);
      const [duplicateRows] = await pool.query(
        `SELECT id FROM dental_card_leads
          WHERE deleted_at IS NULL
            AND telefone = ?
            AND COALESCE(data_agendamento, data_indicacao) = COALESCE(?, ?)
            AND COALESCE(ficha, '') = COALESCE(?, '')
          LIMIT 1`,
        [payload.telefone, payload.data_agendamento, payload.data_indicacao, payload.ficha]
      );
      if (duplicateRows.length) {
        skipped += 1;
        continue;
      }

      const columns = [...dentalCardLeadFields, 'created_by', 'updated_by'];
      const values = dentalCardLeadFields.map((field) => payload[field] ?? null);
      values.push(getActorName(req.user), getActorName(req.user));
      await pool.query(
        `INSERT INTO dental_card_leads (${columns.map((column) => `\`${column}\``).join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`,
        values
      );
      imported += 1;
    }

    const report = { ...parsed.summary, imported, skipped };
    await insertDentalCardAudit(req, 'import_committed', null, report);
    return res.json({ summary: report, committed: true });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao importar planilha Dental Card.' });
  }
}

function buildDentalCardCsv(rows = []) {
  const headers = [
    ['id', 'ID'],
    ['data_indicacao', 'Data da indicação'],
    ['unidade', 'Unidade'],
    ['nome_lead', 'Lead'],
    ['telefone', 'Telefone'],
    ['ficha', 'Ficha'],
    ['origem', 'Origem'],
    ['responsavel', 'Responsável'],
    ['status', 'Status'],
    ['quantidade_tentativas', 'Tentativas'],
    ['data_agendamento', 'Data do agendamento'],
    ['hora_agendamento', 'Hora'],
    ['compareceu', 'Compareceu'],
    ['pagou', 'Pagamento'],
    ['receita', 'Receita'],
    ['sla_status', 'SLA'],
    ['dias_sem_contato', 'Dias sem contato']
  ];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [
    headers.map(([, label]) => escape(label)).join(';'),
    ...rows.map((row) => headers.map(([key]) => escape(row[key])).join(';'))
  ].join('\n');
}

function buildDentalCardExcelBuffer(rows = []) {
  const data = rows.map((row) => ({
    'Carimbo de data/hora': row.created_at,
    'Quem indicou': row.nome_indicador,
    'Vínculo/Grau de parentesco': row.vinculo_indicador,
    'Nome do indicado': row.nome_lead,
    'Telefone/WhatsApp': row.telefone,
    Unidade: row.unidade,
    'Link da foto': row.foto_url ? `${publicBaseUrl}${normalizeStoredUploadUrl(row.foto_url)}` : '',
    'E-mail': row.email,
    'Responsável pelo cadastro': row.responsavel_cadastro || row.responsavel,
    Status: row.status,
    Data: row.data_status || row.data_indicacao,
    Origem: row.origem_cadastro || row.origem,
    Observações: row.observacoes,
    'Data de criação': row.created_at,
    'Última atualização': row.updated_at,
    'SLA retorno': row.sla_retorno_status,
    'Prazo de retorno': row.data_limite_retorno
  }));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data.length ? data : [{
    'Carimbo de data/hora': '',
    'Quem indicou': '',
    'Vínculo/Grau de parentesco': '',
    'Nome do indicado': '',
    'Telefone/WhatsApp': '',
    Unidade: '',
    'Link da foto': '',
    'E-mail': '',
    'Responsável pelo cadastro': '',
    Status: '',
    Data: '',
    Origem: '',
    Observações: '',
    'Data de criação': '',
    'Última atualização': '',
    'SLA retorno': '',
    'Prazo de retorno': ''
  }]);
  worksheet['!cols'] = Object.keys(data[0] || {}).map((key) => ({
    wch: Math.max(16, Math.min(34, key.length + 6))
  }));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Dental Card');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

function formatDentalReportDate(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(String(value).includes('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatDentalReportMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
}

function formatDentalReportPercent(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

function truncateDentalPdfText(value, maxLength = 70) {
  const text = String(value || '-').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function buildDentalCardPdfBuffer(rows = [], query = {}) {
  return new Promise((resolve, reject) => {
    const dashboard = buildDentalDashboard(rows);
    const summary = dashboard.summary || {};
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
      margin: 32,
      info: {
        Title: 'Relatório Dental Card',
        Author: 'Sistema NPS - Grupo Sorria'
      }
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const gold = '#b07a35';
    const teal = '#1f7a8c';
    const line = '#e5d2b7';
    const ink = '#211a16';
    const muted = '#6b594b';
    const filters = [
      query.startDate ? `Início: ${formatDentalReportDate(query.startDate)}` : null,
      query.endDate ? `Fim: ${formatDentalReportDate(query.endDate)}` : null,
      query.unidade ? `Unidade: ${query.unidade}` : null,
      query.status ? `Status: ${query.status}` : null,
      query.responsavel ? `Responsável: ${query.responsavel}` : null
    ].filter(Boolean).join(' | ') || 'Todos os registros filtrados';

    doc.rect(0, 0, doc.page.width, 88).fill('#fff7eb');
    doc.fillColor(gold).font('Helvetica-Bold').fontSize(10).text('RELATÓRIO EXECUTIVO', 32, 26);
    doc.fillColor(ink).fontSize(24).text('Dental Card', 32, 40);
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(`Gerado em ${formatMessageDateTime(new Date())} | ${filters}`, 32, 68, { width: pageWidth });

    const cards = [
      ['Indicações', summary.totalIndicacoes],
      ['Agendados', summary.totalAgendado],
      ['Comparecidos', summary.totalComparecido],
      ['Pagantes', summary.pagantes],
      ['Receita', formatDentalReportMoney(summary.receitaTotal)],
      ['Conversão final', formatDentalReportPercent(summary.taxaConversaoFinal)]
    ];
    const cardWidth = (pageWidth - 30) / 6;
    let y = 112;
    cards.forEach(([label, value], index) => {
      const x = 32 + index * (cardWidth + 6);
      doc.roundedRect(x, y, cardWidth, 56, 6).fillAndStroke('#ffffff', '#ead9c0');
      doc.fillColor(muted).font('Helvetica-Bold').fontSize(7).text(label.toUpperCase(), x + 10, y + 10, { width: cardWidth - 20 });
      doc.fillColor(ink).fontSize(13).text(String(value ?? 0), x + 10, y + 27, { width: cardWidth - 20 });
    });

    y += 84;
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(14).text('Base operacional', 32, y);
    y += 20;

    const columns = [
      ['Data', 58],
      ['Unidade', 95],
      ['Paciente', 125],
      ['Telefone', 82],
      ['Responsável', 100],
      ['Status', 92],
      ['Próxima ação', 76],
      ['Receita', 72],
      ['Observação', pageWidth - 700]
    ];

    const drawTableHeader = () => {
      let x = 32;
      doc.rect(32, y, pageWidth, 24).fill('#f5ead9');
      doc.fillColor('#5e4321').font('Helvetica-Bold').fontSize(7);
      columns.forEach(([label, width]) => {
        doc.text(label.toUpperCase(), x + 4, y + 8, { width: width - 8 });
        x += width;
      });
      y += 24;
    };

    drawTableHeader();
    doc.font('Helvetica').fontSize(7);
    rows.forEach((row, index) => {
      if (y > doc.page.height - 76) {
        doc.addPage();
        y = 36;
        drawTableHeader();
      }
      const rowHeight = 42;
      doc.rect(32, y, pageWidth, rowHeight).fill(index % 2 === 0 ? '#ffffff' : '#fffaf4');
      doc.strokeColor(line).lineWidth(0.4).moveTo(32, y + rowHeight).lineTo(32 + pageWidth, y + rowHeight).stroke();
      let x = 32;
      const values = [
        formatDentalReportDate(row.data_indicacao),
        truncateDentalPdfText(row.unidade, 24),
        truncateDentalPdfText(row.nome_lead, 32),
        row.telefone || '-',
        truncateDentalPdfText(row.responsavel, 24),
        truncateDentalPdfText(row.status, 26),
        formatDentalReportDate(row.data_proxima_tentativa),
        formatDentalReportMoney(row.receita || row.valor_pago),
        truncateDentalPdfText(row.observacoes || row.status_contato || row.motivo_falta, 54)
      ];
      doc.fillColor(ink);
      values.forEach((value, valueIndex) => {
        const width = columns[valueIndex][1];
        doc.text(String(value), x + 4, y + 8, { width: width - 8, height: rowHeight - 12 });
        x += width;
      });
      y += rowHeight;
    });

    if (!rows.length) {
      doc.fillColor(muted).fontSize(10).text('Nenhum lead encontrado para os filtros informados.', 32, y + 12);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.fillColor(teal).font('Helvetica-Bold').fontSize(8)
        .text('Sistema NPS - Grupo Sorria | Dental Card', 32, doc.page.height - 28);
      doc.fillColor(muted).font('Helvetica').text(`Página ${i + 1} de ${range.count}`, doc.page.width - 100, doc.page.height - 28);
    }

    doc.end();
  });
}

async function handleExportDentalCard(req, res) {
  try {
    if (!canExportDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode exportar Dental Card.' });
    }

    const rows = await getDentalCardRows(req.query);
    await insertDentalCardAudit(req, 'export_csv', null, { total: rows.length, query: req.query });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dental-card.csv"');
    return res.send(`\uFEFF${buildDentalCardCsv(rows)}`);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao exportar Dental Card.' });
  }
}

async function handleExportDentalCardExcel(req, res) {
  try {
    if (!canExportDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode exportar Dental Card.' });
    }

    const rows = await getDentalCardRows(req.query);
    const buffer = buildDentalCardExcelBuffer(rows);
    await insertDentalCardAudit(req, 'export_excel', null, { total: rows.length, query: req.query });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="dental-card.xlsx"');
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao exportar Excel Dental Card.' });
  }
}

async function handleExportDentalCardPdf(req, res) {
  try {
    if (!canExportDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode exportar Dental Card.' });
    }

    const rows = await getDentalCardRows(req.query);
    const buffer = await buildDentalCardPdfBuffer(rows, req.query);
    await insertDentalCardAudit(req, 'export_pdf', null, { total: rows.length, query: req.query });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="dental-card.pdf"');
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao exportar relatório PDF Dental Card.' });
  }
}

async function handleExportDentalCardLeadPdf(req, res) {
  try {
    if (!canExportDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode exportar Dental Card.' });
    }

    const [rows] = await pool.query('SELECT * FROM dental_card_leads WHERE id = ? AND deleted_at IS NULL LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Lead Dental Card não encontrado.' });
    const [attempts] = await pool.query('SELECT * FROM dental_card_attempts WHERE lead_id = ? ORDER BY created_at ASC, id ASC', [req.params.id]);
    const [attachments] = await pool.query('SELECT * FROM dental_card_attachments WHERE lead_id = ? ORDER BY uploaded_at ASC, id ASC', [req.params.id]);
    const lead = { ...rows[0], ...resolveDentalSla(rows[0]), ...resolveDentalReturnSla(rows[0]) };

    const buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 42 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.fillColor('#b07a35').font('Helvetica-Bold').fontSize(10).text('FICHA INDIVIDUAL DENTAL CARD');
      doc.fillColor('#211a16').fontSize(22).text(lead.nome_lead || 'Lead Dental Card');
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10).fillColor('#5e5147')
        .text(`Unidade: ${lead.unidade || '-'} | Telefone: ${lead.telefone || '-'} | Status: ${lead.status || '-'}`);
      doc.moveDown();
      [
        ['Quem indicou', lead.nome_indicador],
        ['Vínculo/Grau de parentesco', lead.vinculo_indicador],
        ['E-mail', lead.email],
        ['Origem', lead.origem_cadastro || lead.origem],
        ['Data da indicação', formatDentalReportDate(lead.data_indicacao)],
        ['Prazo de retorno', formatDentalSlaLimit(lead.data_limite_retorno)],
        ['SLA retorno', lead.sla_retorno_status],
        ['Responsável', lead.responsavel || lead.responsavel_cadastro],
        ['Observações', lead.observacoes]
      ].forEach(([label, value]) => {
        doc.font('Helvetica-Bold').fillColor('#6d573b').text(`${label}:`, { continued: true });
        doc.font('Helvetica').fillColor('#211a16').text(` ${value || '-'}`);
      });
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#211a16').text('Histórico');
      if (attempts.length) {
        attempts.forEach((attempt) => {
          doc.font('Helvetica-Bold').fontSize(9).fillColor('#6d573b').text(formatMessageDateTime(attempt.created_at));
          doc.font('Helvetica').fillColor('#211a16').text(`${attempt.responsavel || '-'} | ${attempt.canal || '-'} | ${attempt.resultado || '-'}`);
          if (attempt.observacao) doc.fillColor('#5e5147').text(attempt.observacao);
          doc.moveDown(0.4);
        });
      } else {
        doc.font('Helvetica').fontSize(10).text('Nenhum histórico registrado.');
      }
      const photo = attachments.find((item) => /\.(png|jpe?g)$/i.test(item.file_url || ''));
      if (photo) {
        const imagePath = resolveStoredUploadFilePath(photo.file_url);
        if (imagePath && fs.existsSync(imagePath)) {
          doc.addPage();
          doc.font('Helvetica-Bold').fontSize(14).fillColor('#211a16').text('Foto anexada');
          doc.moveDown();
          doc.image(imagePath, { fit: [430, 520], align: 'center' });
        }
      }
      doc.end();
    });

    await insertDentalCardAudit(req, 'export_individual_pdf', req.params.id, { leadId: req.params.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dental-card-${req.params.id}.pdf"`);
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao exportar PDF individual Dental Card.' });
  }
}

async function handleDownloadDentalCardImportTemplate(req, res) {
  try {
    if (!canViewDentalCard(req.user)) {
      return res.status(403).json({ error: 'Acesso ao modelo Dental Card não autorizado.' });
    }

    const buffer = buildDentalCardImportTemplateBuffer();
    await insertDentalCardAudit(req, 'template_download', null, { type: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-dental-card.xlsx"');
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao gerar modelo de importação Dental Card.' });
  }
}

async function handleGetDentalCardAttachment(req, res) {
  try {
    if (!canViewDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode visualizar anexos Dental Card.' });
    }

    const [rows] = await pool.query(
      `SELECT a.*, l.id AS lead_exists
         FROM dental_card_attachments a
         INNER JOIN dental_card_leads l ON l.id = a.lead_id AND l.deleted_at IS NULL
        WHERE a.id = ?
        LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Anexo Dental Card não encontrado.' });

    await insertDentalCardAudit(req, 'attachment_viewed', rows[0].lead_id, { attachmentId: req.params.id });
    const filePath = resolveStoredUploadFilePath(rows[0].file_url);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo não encontrado no armazenamento.' });
    }
    res.setHeader('Content-Type', rows[0].file_type || 'application/octet-stream');
    return res.sendFile(filePath);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao abrir anexo Dental Card.' });
  }
}

async function handleGetDentalCardNotificationSettings(req, res) {
  try {
    if (!isAdminUser(req.user) && !hasScreenPermission(req.user, 'dental_card')) {
      return res.status(403).json({ error: 'Acesso não autorizado às configurações Dental Card.' });
    }

    const [rows] = await pool.query(
      `SELECT
         u.id AS user_id,
         u.name,
         u.email,
         u.role,
         u.whatsapp,
         u.phone,
         s.id AS setting_id,
         COALESCE(s.recebe_notificacao_sistema, 0) AS recebe_notificacao_sistema,
         COALESCE(s.recebe_notificacao_whatsapp, 0) AS recebe_notificacao_whatsapp,
         COALESCE(s.telefone_whatsapp, u.whatsapp, u.phone) AS telefone_whatsapp,
         s.unidade,
         COALESCE(s.ativo, 0) AS ativo
       FROM users u
       LEFT JOIN dental_card_notification_settings s ON s.user_id = u.id
       WHERE u.deleted_at IS NULL
         AND u.active = 1
         AND (
           u.role IN ('master_admin', 'admin', 'supervisor_crc', 'sac_operator', 'crc_leader', 'crc_manager', 'crc_operator')
           OR u.permissions LIKE '%dental_card%'
         )
       ORDER BY u.name ASC, s.unidade ASC`
    );

    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar configurações Dental Card.' });
  }
}

async function handleUpsertDentalCardNotificationSetting(req, res) {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ error: 'Somente administradores podem alterar notificações Dental Card.' });
    }

    const userId = Number(req.body.user_id || req.body.userId || req.params.userId || 0);
    if (!userId) return res.status(400).json({ error: 'Informe o usuário da configuração.' });

    const unidade = normalizeDentalText(req.body.unidade, 180) || '';
    const values = [
      toDentalBoolean(req.body.recebe_notificacao_sistema ?? req.body.recebeNotificacaoSistema ?? 1),
      toDentalBoolean(req.body.recebe_notificacao_whatsapp ?? req.body.recebeNotificacaoWhatsapp ?? 0),
      normalizeWhatsAppPhone(req.body.telefone_whatsapp || req.body.telefoneWhatsapp || ''),
      unidade,
      toDentalBoolean(req.body.ativo ?? 1)
    ];
    const settingId = Number(req.body.setting_id || req.body.settingId || 0);

    if (settingId) {
      await pool.query(
        `UPDATE dental_card_notification_settings
            SET recebe_notificacao_sistema = ?,
                recebe_notificacao_whatsapp = ?,
                telefone_whatsapp = ?,
                unidade = ?,
                ativo = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?`,
        [...values, settingId, userId]
      );
    } else {
      await pool.query(
        `INSERT INTO dental_card_notification_settings
         (user_id, recebe_notificacao_sistema, recebe_notificacao_whatsapp, telefone_whatsapp, unidade, ativo)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           recebe_notificacao_sistema = VALUES(recebe_notificacao_sistema),
           recebe_notificacao_whatsapp = VALUES(recebe_notificacao_whatsapp),
           telefone_whatsapp = VALUES(telefone_whatsapp),
           ativo = VALUES(ativo),
           updated_at = CURRENT_TIMESTAMP`,
        [userId, ...values]
      );
    }
    return res.json({ message: 'Configuração Dental Card atualizada.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao salvar configuração Dental Card.' });
  }
}

async function handleGetDentalCardTemplates(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM dental_card_message_templates ORDER BY ativo DESC, nome ASC'
    );
    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar mensagens padrão Dental Card.' });
  }
}

async function handleCreateDentalCardTemplate(req, res) {
  try {
    if (!canManageDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode criar mensagens padrão Dental Card.' });
    }

    const nome = normalizeDentalText(req.body.nome, 160);
    const tipo = normalizeDentalText(req.body.tipo, 80);
    const mensagem = normalizeDentalText(req.body.mensagem, 5000);
    if (!nome || !tipo || !mensagem) {
      return res.status(400).json({ error: 'Informe nome, tipo e mensagem.' });
    }

    const [result] = await pool.query(
      `INSERT INTO dental_card_message_templates (nome, tipo, mensagem, ativo, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nome, tipo, mensagem, toDentalBoolean(req.body.ativo ?? 1), getActorName(req.user), getActorName(req.user)]
    );
    const [rows] = await pool.query('SELECT * FROM dental_card_message_templates WHERE id = ? LIMIT 1', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao criar mensagem padrão.' });
  }
}

async function handleUpdateDentalCardTemplate(req, res) {
  try {
    if (!canManageDentalCard(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode editar mensagens padrão Dental Card.' });
    }

    const nome = normalizeDentalText(req.body.nome, 160);
    const tipo = normalizeDentalText(req.body.tipo, 80);
    const mensagem = normalizeDentalText(req.body.mensagem, 5000);
    if (!nome || !tipo || !mensagem) {
      return res.status(400).json({ error: 'Informe nome, tipo e mensagem.' });
    }

    await pool.query(
      `UPDATE dental_card_message_templates
          SET nome = ?, tipo = ?, mensagem = ?, ativo = ?, updated_by = ?
        WHERE id = ?`,
      [nome, tipo, mensagem, toDentalBoolean(req.body.ativo ?? 1), getActorName(req.user), req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM dental_card_message_templates WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Mensagem padrão não encontrada.' });
    return res.json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao editar mensagem padrão.' });
  }
}

async function handleGetFinancialSelic(req, res) {
  try {
    const selic = await getCurrentSelicRate();
    return res.json(selic);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao consultar a taxa SELIC.' });
  }
}

async function handleGetFinancialIntelligence(req, res) {
  try {
    const view = String(req.query.view || '').toLowerCase();

    if (view === 'dashboard' && !canViewFinancialDashboard(req.user)) {
      return res.status(403).json({ error: 'Dashboard financeiro restrito ao Administrador Master e Administradores.' });
    }

    if (view === 'campaign_unit' && !canViewFinancialCampaignDashboard(req.user)) {
      return res.status(403).json({ error: 'Dashboard por unidade e campanha restrito à Gerência CRC, Supervisão CRC e Administradores.' });
    }

    const { where, params } = buildFinancialWhere(req.query, req.user);
    const [rows] = await pool.query(
      `SELECT *
         FROM financial_intelligence
        WHERE ${where.join(' AND ')}
        ORDER BY date DESC, id DESC`,
      params
    );
    const financialRules = await getFinancialSettings();
    const rowsWithMonthlySelic = await applyMonthlySelicToRows(rows);
    const enrichedRows = rowsWithMonthlySelic.map((row) => enrichFinancialRow(row, financialRules))
      .filter((row) => matchesFinancialStatus(row, req.query.status));
    const monthlyCostContext = await getFinancialMonthlyCostContext(enrichedRows, financialRules);

    return res.json(buildFinancialIntelligencePayload(enrichedRows, financialRules, monthlyCostContext));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar Inteligência Financeira CRC.' });
  }
}

async function handleGetFinancialIntelligenceRecord(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM financial_intelligence WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Lançamento financeiro não encontrado.' });
    }

    const financialRules = await getFinancialSettings();
    const [rowWithSelic] = await applyMonthlySelicToRows(rows);
    return res.json(enrichFinancialRow(rowWithSelic, financialRules));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar lançamento financeiro.' });
  }
}

async function handleCreateFinancialIntelligence(req, res) {
  try {
    if (!canManageFinancialIntelligence(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode lançar dados financeiros do CRC.' });
    }

    const payload = await buildFinancialPayload(req.body, req.user);
    const actorName = getActorName(req.user);
    const columns = [...editableFinancialFields, 'created_by', 'updated_by'];
    const values = editableFinancialFields.map((field) => payload[field] ?? null);
    values.push(actorName, actorName);

    const [result] = await pool.query(
      `INSERT INTO financial_intelligence (${columns.map((column) => `\`${column}\``).join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
      values
    );

    const [rows] = await pool.query('SELECT * FROM financial_intelligence WHERE id = ? LIMIT 1', [result.insertId]);
    const financialRules = await getFinancialSettings();
    const [rowWithSelic] = await applyMonthlySelicToRows(rows);
    return res.status(201).json(enrichFinancialRow(rowWithSelic, financialRules));
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao criar lançamento financeiro.' });
  }
}

async function handleUpdateFinancialIntelligence(req, res) {
  try {
    if (!canManageFinancialIntelligence(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode editar dados financeiros do CRC.' });
    }

    const [existingRows] = await pool.query(
      'SELECT * FROM financial_intelligence WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );

    if (!existingRows.length) {
      return res.status(404).json({ error: 'Lançamento financeiro não encontrado.' });
    }

    if (!canEditFinancialRecord(req.user, existingRows[0])) {
      return res.status(403).json({ error: 'Seu perfil não pode editar este lançamento financeiro.' });
    }

    const payload = await buildFinancialPayload({ ...existingRows[0], ...req.body }, req.user);
    const actorName = getActorName(req.user);
    const updates = editableFinancialFields.map((field) => `\`${field}\` = ?`);
    const values = editableFinancialFields.map((field) => payload[field] ?? null);
    updates.push('updated_by = ?');
    values.push(actorName, req.params.id);

    await pool.query(
      `UPDATE financial_intelligence
          SET ${updates.join(', ')}
        WHERE id = ?`,
      values
    );

    const [rows] = await pool.query('SELECT * FROM financial_intelligence WHERE id = ? LIMIT 1', [req.params.id]);
    const financialRules = await getFinancialSettings();
    const [rowWithSelic] = await applyMonthlySelicToRows(rows);
    return res.json(enrichFinancialRow(rowWithSelic, financialRules));
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar lançamento financeiro.' });
  }
}

async function handleDeleteFinancialIntelligence(req, res) {
  try {
    if (!canDeleteFinancialIntelligence(req.user)) {
      return res.status(403).json({ error: 'Somente Administrador Master pode excluir lançamentos financeiros.' });
    }

    await pool.query(
      'DELETE FROM financial_intelligence WHERE id = ?',
      [req.params.id]
    );

    return res.json({ message: 'Lançamento financeiro excluído definitivamente e removido dos dashboards.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir lançamento financeiro.' });
  }
}

async function handleGetFinancialSettings(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Acesso restrito ao Administrador Master.' });
    }

    return res.json(await getFinancialSettings());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar regras financeiras.' });
  }
}

async function handleUpdateFinancialSettings(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Acesso restrito ao Administrador Master.' });
    }

    const settings = await saveFinancialSettings(req.body || {}, req.user);
    return res.json(settings);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao atualizar regras financeiras.' });
  }
}

async function handleClearFinancialTestRecords(req, res) {
  try {
    if (!isMasterAdminUser(req.user)) {
      return res.status(403).json({ error: 'Acesso restrito ao Administrador Master.' });
    }

    const [result] = await pool.query(
      `DELETE FROM financial_intelligence
        WHERE deleted_at IS NOT NULL
           OR LOWER(COALESCE(campaign, '')) LIKE '%teste%'
           OR LOWER(COALESCE(notes, '')) LIKE '%teste%'
           OR LOWER(COALESCE(clinic_name, '')) LIKE '%teste%'
           OR LOWER(COALESCE(operator_name, '')) LIKE '%teste%'`
    );

    return res.json({
      message: 'Registros financeiros de teste removidos definitivamente.',
      deleted: result.affectedRows || 0
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao limpar registros financeiros de teste.' });
  }
}

async function buildCrcCollaboratorPayload(body = {}, user = {}) {
  const name = sanitizeFinancialString(body.name);
  const functionName = sanitizeFinancialString(body.function_name || body.functionName);

  if (!name || !functionName) {
    throw new Error('Informe nome do colaborador e função/cargo.');
  }

  const clinic = await getClinicSnapshot(body.clinic_id);
  const unitName = sanitizeFinancialString(body.unit_name) || clinic?.city || null;

  if (!clinic && !sanitizeFinancialString(body.clinic_name)) {
    throw new Error('Selecione a clínica do colaborador.');
  }

  if (!unitName) {
    throw new Error('Informe a unidade do colaborador.');
  }

  if (body.salary === undefined || body.salary === null || body.salary === '') {
    throw new Error('Informe o salário do colaborador.');
  }

  const receivesCommission = toFinancialBoolean(body.receives_commission ?? body.receivesCommission) ? 1 : 0;
  const defaultCommission = 0;

  return {
    name,
    role: sanitizeFinancialString(body.role),
    function_name: functionName,
    clinic_id: clinic?.id || null,
    clinic_name: clinic?.name || sanitizeFinancialString(body.clinic_name),
    unit_name: unitName,
    hire_date: body.hire_date || body.hireDate || null,
    reference_month: normalizeFinancialMonth(body.reference_month || body.referenceMonth),
    salary: toFinancialNumber(body.salary),
    charges: toFinancialNumber(body.charges),
    benefits: toFinancialNumber(body.benefits),
    receives_commission: receivesCommission,
    commission_default: defaultCommission,
    fixed_commission: toFinancialNumber(body.fixed_commission || body.fixedCommission),
    fixed_gratification: toFinancialNumber(body.fixed_gratification || body.fixedGratification || body.gratificacao),
    fixed_additional: toFinancialNumber(body.fixed_additional || body.fixedAdditional || body.adicional_fixo),
    transport_voucher: toFinancialNumber(body.transport_voucher || body.transportVoucher || body.vale_transporte),
    food_voucher: toFinancialNumber(body.food_voucher || body.foodVoucher || body.vale_alimentacao),
    meal_voucher: toFinancialNumber(body.meal_voucher || body.mealVoucher || body.vale_refeicao),
    health_plan: toFinancialNumber(body.health_plan || body.healthPlan || body.plano_saude),
    dental_plan: toFinancialNumber(body.dental_plan || body.dentalPlan || body.plano_odontologico),
    cost_allowance: toFinancialNumber(body.cost_allowance || body.costAllowance || body.ajuda_custo),
    other_benefits: toFinancialNumber(body.other_benefits || body.otherBenefits || body.outros_beneficios),
    bonus: toFinancialNumber(body.bonus || body.bonificacao),
    dsr_commission: receivesCommission ? calculateDsrOnCommission(defaultCommission) : 0,
    thirteenth_salary: calculateThirteenthProvision(
      { salary: body.salary, hire_date: body.hire_date || body.hireDate },
      body.reference_month || body.referenceMonth
    ),
    phone_cost_default: toFinancialNumber(body.phone_cost_default),
    system_cost_default: toFinancialNumber(body.system_cost_default),
    infrastructure_cost_default: toFinancialNumber(body.infrastructure_cost_default),
    vacation_taken: 0,
    vacation_amount: 0,
    other_costs_default: toFinancialNumber(body.other_costs_default),
    other_costs_description: sanitizeFinancialString(body.other_costs_description || body.otherCostsDescription, 500),
    status: sanitizeFinancialString(body.status, 40) || 'ativo',
    updated_by: getActorName(user)
  };
}

async function handleGetCrcCollaborators(req, res) {
  try {
    if (!canViewFinancialIntelligence(req.user)) {
      return res.status(403).json({ error: 'Acesso restrito aos colaboradores do CRC.' });
    }

    const [rows] = await pool.query(
      `SELECT *
         FROM crc_collaborators
        WHERE deleted_at IS NULL
        ORDER BY status ASC, name ASC`
    );

    const financialRules = await getFinancialSettings();
    return res.json(rows.map((row) => ({
      ...row,
      labor_costs: calculateLaborCostComposition(row, financialRules, null, row.reference_month || new Date().toISOString().slice(0, 7))
    })));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar colaboradores do CRC.' });
  }
}

async function handleCreateCrcCollaborator(req, res) {
  try {
    if (!canManageCrcCollaborators(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode cadastrar colaboradores do CRC.' });
    }

    const payload = await buildCrcCollaboratorPayload(req.body, req.user);
    payload.created_by = getActorName(req.user);
    const columns = Object.keys(payload);
    const values = Object.values(payload);
    const [result] = await pool.query(
      `INSERT INTO crc_collaborators (${columns.map((column) => `\`${column}\``).join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
      values
    );
    const [rows] = await pool.query('SELECT * FROM crc_collaborators WHERE id = ? LIMIT 1', [result.insertId]);
    const financialRules = await getFinancialSettings();
    return res.status(201).json({
      ...rows[0],
      labor_costs: calculateLaborCostComposition(rows[0], financialRules, null, rows[0].reference_month || new Date().toISOString().slice(0, 7))
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao cadastrar colaborador.' });
  }
}

async function handleUpdateCrcCollaborator(req, res) {
  try {
    if (!canManageCrcCollaborators(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode editar colaboradores do CRC.' });
    }

    const [existingRows] = await pool.query(
      'SELECT * FROM crc_collaborators WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id]
    );

    if (!existingRows.length) {
      return res.status(404).json({ error: 'Colaborador não encontrado.' });
    }

    const payload = await buildCrcCollaboratorPayload({ ...existingRows[0], ...req.body }, req.user);
    const columns = Object.keys(payload);
    const values = Object.values(payload);
    values.push(req.params.id);

    await pool.query(
      `UPDATE crc_collaborators
          SET ${columns.map((column) => `\`${column}\` = ?`).join(', ')}
        WHERE id = ?`,
      values
    );

    const [rows] = await pool.query('SELECT * FROM crc_collaborators WHERE id = ? LIMIT 1', [req.params.id]);
    const financialRules = await getFinancialSettings();
    return res.json({
      ...rows[0],
      labor_costs: calculateLaborCostComposition(rows[0], financialRules, null, rows[0].reference_month || new Date().toISOString().slice(0, 7))
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao editar colaborador.' });
  }
}

async function handleDeleteCrcCollaborator(req, res) {
  try {
    if (!canDeleteCrcCollaborators(req.user)) {
      return res.status(403).json({ error: 'Somente Administrador Master pode excluir colaboradores.' });
    }

    await pool.query(
      `UPDATE crc_collaborators
          SET status = 'inativo', deleted_at = NOW(), deleted_by = ?, updated_by = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [getActorName(req.user), getActorName(req.user), req.params.id]
    );

    return res.json({ message: 'Colaborador excluído com histórico preservado.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao excluir colaborador.' });
  }
}

async function handleGetCrcCollaboratorMonthlyCosts(req, res) {
  try {
    if (!canViewFinancialIntelligence(req.user)) {
      return res.status(403).json({ error: 'Acesso restrito aos custos mensais do CRC.' });
    }

    const month = req.query.referenceMonth || req.query.reference_month;
    const params = [];
    const where = ['m.deleted_at IS NULL'];
    if (month) {
      where.push('m.reference_month = ?');
      params.push(normalizeFinancialMonth(month));
    }

    const [rows] = await pool.query(
      `SELECT m.*, c.function_name, c.clinic_name
         FROM crc_collaborator_monthly_costs m
         LEFT JOIN crc_collaborators c ON c.id = m.collaborator_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.reference_month DESC, m.collaborator_name ASC`,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar comissões mensais.' });
  }
}

async function handleUpsertCrcCollaboratorMonthlyCost(req, res) {
  try {
    if (!canManageCrcCollaborators(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode lançar comissões do CRC.' });
    }

    const collaborator = await getCrcCollaboratorById(req.body.collaborator_id || req.body.collaboratorId);
    if (!collaborator) {
      return res.status(404).json({ error: 'Colaborador não encontrado.' });
    }

    const commission = toFinancialNumber(req.body.commission);
    if (commission > 0 && !Number(collaborator.receives_commission || 0)) {
      return res.status(400).json({ error: 'Este colaborador não está marcado para receber comissão.' });
    }

    const referenceMonth = normalizeFinancialMonth(req.body.reference_month || req.body.referenceMonth);
    const payload = {
      collaboratorId: collaborator.id,
      collaboratorName: collaborator.name,
      referenceMonth,
      commission,
      vacationPaid: toFinancialBoolean(req.body.vacation_paid ?? req.body.vacationPaid) ? 1 : 0,
      vacationAmount: toFinancialNumber(req.body.vacation_amount || req.body.vacationAmount),
      otherCosts: toFinancialNumber(req.body.other_costs || req.body.otherCosts),
      notes: sanitizeFinancialString(req.body.notes, 2000),
      actor: getActorName(req.user)
    };

    await pool.query(
      `INSERT INTO crc_collaborator_monthly_costs
       (collaborator_id, collaborator_name, reference_month, commission, vacation_paid, vacation_amount, other_costs, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         collaborator_name = VALUES(collaborator_name),
         commission = VALUES(commission),
         vacation_paid = VALUES(vacation_paid),
         vacation_amount = VALUES(vacation_amount),
         other_costs = VALUES(other_costs),
         notes = VALUES(notes),
         updated_by = VALUES(updated_by),
         deleted_at = NULL,
         deleted_by = NULL`,
      [
        payload.collaboratorId,
        payload.collaboratorName,
        payload.referenceMonth,
        payload.commission,
        payload.vacationPaid,
        payload.vacationAmount,
        payload.otherCosts,
        payload.notes,
        payload.actor,
        payload.actor
      ]
    );

    const [rows] = await pool.query(
      'SELECT * FROM crc_collaborator_monthly_costs WHERE collaborator_id = ? AND reference_month = ? LIMIT 1',
      [payload.collaboratorId, payload.referenceMonth]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao lançar comissão mensal.' });
  }
}

async function handleGetCrcOperationalCosts(req, res) {
  try {
    if (!canViewFinancialIntelligence(req.user)) {
      return res.status(403).json({ error: 'Acesso restrito aos custos operacionais do CRC.' });
    }

    const month = req.query.referenceMonth || req.query.reference_month;
    const params = [];
    const where = ['deleted_at IS NULL'];
    if (month) {
      where.push('reference_month = ?');
      params.push(normalizeFinancialMonth(month));
    }

    const [rows] = await pool.query(
      `SELECT *
         FROM crc_monthly_operational_costs
        WHERE ${where.join(' AND ')}
        ORDER BY reference_month DESC, id DESC`,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Erro ao carregar custos operacionais mensais.' });
  }
}

async function handleCreateCrcOperationalCost(req, res) {
  try {
    if (!canManageFinancialIntelligence(req.user)) {
      return res.status(403).json({ error: 'Seu perfil não pode lançar custos operacionais.' });
    }

    const payload = {
      reference_month: normalizeFinancialMonth(req.body.reference_month || req.body.referenceMonth),
      notes: sanitizeFinancialString(req.body.notes, 2000),
      created_by: getActorName(req.user),
      updated_by: getActorName(req.user)
    };
    operationalCostFields.forEach((field) => {
      payload[field] = toFinancialNumber(req.body[field]);
    });

    const columns = Object.keys(payload);
    const values = Object.values(payload);
    const [result] = await pool.query(
      `INSERT INTO crc_monthly_operational_costs (${columns.map((column) => `\`${column}\``).join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
      values
    );

    const [rows] = await pool.query('SELECT * FROM crc_monthly_operational_costs WHERE id = ? LIMIT 1', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Erro ao lançar custo operacional.' });
  }
}

app.get(['/public/dental-card/config', '/public/dental-card/config/:unidadeSlug', '/api/public/dental-card/config', '/api/public/dental-card/config/:unidadeSlug'], publicDentalCardLimiter, handleGetPublicDentalCardConfig);
app.post(['/public/dental-card', '/public/dental-card/:unidadeSlug', '/api/public/dental-card', '/api/public/dental-card/:unidadeSlug'], publicDentalCardLimiter, handlePublicDentalCardPhotoUpload, handleCreatePublicDentalCardLead);

app.get(['/dental-card/dashboard', '/api/dental-card/dashboard'], authenticate, requireDentalCardView, handleGetDentalCardDashboard);
app.get(['/dental-card/leads', '/api/dental-card/leads', '/dental-card', '/api/dental-card'], authenticate, requireDentalCardView, handleGetDentalCardLeads);
app.get(['/dental-card/leads/:id', '/api/dental-card/leads/:id'], authenticate, requireDentalCardView, handleGetDentalCardLead);
app.post(['/dental-card/leads', '/api/dental-card/leads'], authenticate, requireDentalCardView, handleCreateDentalCardLead);
app.put(['/dental-card/leads/:id', '/api/dental-card/leads/:id'], authenticate, requireDentalCardView, handleUpdateDentalCardLead);
app.delete(['/dental-card/leads/:id', '/api/dental-card/leads/:id'], authenticate, requireDentalCardView, handleDeleteDentalCardLead);
app.post(['/dental-card/leads/:id/attempts', '/api/dental-card/leads/:id/attempts'], authenticate, requireDentalCardView, handleCreateDentalCardAttempt);
app.post(['/dental-card/leads/:id/status', '/api/dental-card/leads/:id/status'], authenticate, requireDentalCardView, handleUpdateDentalCardStatus);
app.post(['/dental-card/import', '/api/dental-card/import'], authenticate, requireDentalCardView, upload.single('file'), handleImportDentalCard);
app.get(['/dental-card/export', '/api/dental-card/export'], authenticate, requireDentalCardView, handleExportDentalCard);
app.get(['/dental-card/export/excel', '/api/dental-card/export/excel'], authenticate, requireDentalCardView, handleExportDentalCardExcel);
app.get(['/dental-card/export/pdf', '/api/dental-card/export/pdf'], authenticate, requireDentalCardView, handleExportDentalCardPdf);
app.get(['/dental-card/report/:id/pdf', '/api/dental-card/report/:id/pdf'], authenticate, requireDentalCardView, handleExportDentalCardLeadPdf);
app.get(['/dental-card/attachments/:id', '/api/dental-card/attachments/:id'], authenticate, requireDentalCardView, handleGetDentalCardAttachment);
app.get(['/dental-card/import-template', '/api/dental-card/import-template'], authenticate, requireDentalCardView, handleDownloadDentalCardImportTemplate);
app.get(['/dental-card/notification-settings', '/api/dental-card/notification-settings'], authenticate, requireDentalCardView, handleGetDentalCardNotificationSettings);
app.put(['/dental-card/notification-settings/:userId', '/api/dental-card/notification-settings/:userId'], authenticate, requireDentalCardView, handleUpsertDentalCardNotificationSetting);
app.get(['/dental-card/templates', '/api/dental-card/templates'], authenticate, requireDentalCardView, handleGetDentalCardTemplates);
app.post(['/dental-card/templates', '/api/dental-card/templates'], authenticate, requireDentalCardView, handleCreateDentalCardTemplate);
app.put(['/dental-card/templates/:id', '/api/dental-card/templates/:id'], authenticate, requireDentalCardView, handleUpdateDentalCardTemplate);

app.get(['/financial-intelligence', '/api/financial-intelligence'], authenticate, requireFinancialView, handleGetFinancialIntelligence);
app.get(['/financial-intelligence/selic', '/api/financial-intelligence/selic'], authenticate, requireFinancialView, handleGetFinancialSelic);
app.get(['/financial-intelligence/:id', '/api/financial-intelligence/:id'], authenticate, requireFinancialView, handleGetFinancialIntelligenceRecord);
app.post(['/financial-intelligence', '/api/financial-intelligence'], authenticate, requireFinancialView, handleCreateFinancialIntelligence);
app.put(['/financial-intelligence/:id', '/api/financial-intelligence/:id'], authenticate, requireFinancialView, handleUpdateFinancialIntelligence);
app.delete(['/financial-intelligence/:id', '/api/financial-intelligence/:id'], authenticate, requireFinancialView, handleDeleteFinancialIntelligence);

app.get(['/admin/financial-settings', '/api/admin/financial-settings'], authenticate, handleGetFinancialSettings);
app.put(['/admin/financial-settings', '/api/admin/financial-settings'], authenticate, handleUpdateFinancialSettings);
app.post(['/admin/financial-maintenance/clear-test-records', '/api/admin/financial-maintenance/clear-test-records'], authenticate, handleClearFinancialTestRecords);

app.get(['/crc-collaborators', '/api/crc-collaborators'], authenticate, requireFinancialView, handleGetCrcCollaborators);
app.post(['/crc-collaborators', '/api/crc-collaborators'], authenticate, requireFinancialView, handleCreateCrcCollaborator);
app.put(['/crc-collaborators/:id', '/api/crc-collaborators/:id'], authenticate, requireFinancialView, handleUpdateCrcCollaborator);
app.delete(['/crc-collaborators/:id', '/api/crc-collaborators/:id'], authenticate, requireFinancialView, handleDeleteCrcCollaborator);
app.get(['/crc-collaborator-monthly-costs', '/api/crc-collaborator-monthly-costs'], authenticate, requireFinancialView, handleGetCrcCollaboratorMonthlyCosts);
app.post(['/crc-collaborator-monthly-costs', '/api/crc-collaborator-monthly-costs'], authenticate, requireFinancialView, handleUpsertCrcCollaboratorMonthlyCost);
app.get(['/crc-operational-costs', '/api/crc-operational-costs'], authenticate, requireFinancialView, handleGetCrcOperationalCosts);
app.post(['/crc-operational-costs', '/api/crc-operational-costs'], authenticate, requireFinancialView, handleCreateCrcOperationalCost);

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
    await loadWhatsAppSettingsCache(true);
    await ensureDefaultWhatsAppContent();
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
    await syncClinicLeadershipNamesFromUserLinks();
    await syncDefaultWhatsAppSessionsWithClinics();
    await backfillComplaintProtocols();
    await backfillNpsProtocols();
    await backfillPatientProtocols();
    await backfillComplaintDeadlines();
    await backfillComplaintAssignments();
    const coordinatorRepair = await repairPendingCoordinatorAssignments();
    console.log(`Backfills operacionais validados. Coordenadores revisados: ${coordinatorRepair.updated}/${coordinatorRepair.checked}`);
  } catch (error) {
    console.warn('Não foi possível executar os backfills:', error.message);
  }

  httpServer.listen(PORT, () => {
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
    dispatchStalledComplaintTreatmentReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de demandas sem tratativa:', jobError.message);
    });
    runScheduledUserDemandReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de lembretes semanais aos usuários:', jobError.message);
    });
    runScheduledWeeklyAdminComplaintReport().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de relatório semanal aos administradores:', jobError.message);
    });
    runScheduledDailyCoordinatorDemandReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de lembretes diários aos coordenadores:', jobError.message);
    });
    runScheduledDailyCoordinatorDeliveryReport().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de relatório diário de entregas aos administradores:', jobError.message);
    });
    runDentalCardSlaNotificationSweep().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de SLA do Dental Card:', jobError.message);
    });
    runScheduledPartnerVideoDailyReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina inicial de vídeos dos parceiros:', jobError.message);
    });
    processWhatsAppDispatchQueue().catch((jobError) => {
      console.warn('Não foi possível executar a fila inicial de disparos WhatsApp:', jobError.message);
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
    dispatchStalledComplaintTreatmentReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de demandas sem tratativa:', jobError.message);
    });
  }, complaintStalledTreatmentReminderHours * 60 * 60 * 1000);

  setInterval(() => {
    runScheduledUserDemandReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de lembretes semanais aos usuários:', jobError.message);
    });
  }, weeklyDemandReminderIntervalMinutes * 60 * 1000);

  setInterval(() => {
    runScheduledWeeklyAdminComplaintReport().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de relatório semanal aos administradores:', jobError.message);
    });
  }, weeklyAdminComplaintReportIntervalMinutes * 60 * 1000);

  setInterval(() => {
    runScheduledDailyCoordinatorDemandReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de lembretes diários aos coordenadores:', jobError.message);
    });
  }, dailyCoordinatorDemandReminderIntervalMinutes * 60 * 1000);

  setInterval(() => {
    runScheduledDailyCoordinatorDeliveryReport().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de relatório diário de entregas:', jobError.message);
    });
  }, dailyCoordinatorDeliveryReportIntervalMinutes * 60 * 1000);

  setInterval(() => {
    runDentalCardSlaNotificationSweep().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de SLA do Dental Card:', jobError.message);
    });
  }, Math.max(5, Number(process.env.DENTAL_CARD_SLA_SWEEP_INTERVAL_MINUTES || 15)) * 60 * 1000);

  setInterval(() => {
    runScheduledPartnerVideoDailyReminders().catch((jobError) => {
      console.warn('Não foi possível executar a rotina programada de vídeos dos parceiros:', jobError.message);
    });
    runPartnerVideoOperationalEscalationSweep().catch((jobError) => {
      console.warn('Não foi possível executar o fluxo operacional de vídeos dos parceiros:', jobError.message);
    });
  }, Math.max(5, Number(process.env.PARTNER_VIDEO_SWEEP_INTERVAL_MINUTES || 15)) * 60 * 1000);

  setInterval(() => {
    processWhatsAppDispatchQueue().catch((jobError) => {
      console.warn('Não foi possível processar a fila de disparos WhatsApp:', jobError.message);
    });
  }, Math.max(3000, Number(process.env.WHATSAPP_DISPATCH_INTERVAL_MS || 5000)));

}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  httpServer,
  io,
  pool,
  startServer,
  __testables: {
    buildAuthenticatedUser,
    buildComplaintNotificationEmail,
    buildComplaintExpiredResponsibleReminderJobKey,
    buildComplaintExpiredResponsibleReminderWindowKey,
    buildComplaintStalledTreatmentReminderJobKey,
    buildComplaintStalledTreatmentReminderWindowKey,
    buildComplaintCreatorAudit,
    buildComplaintWhatsAppMessage,
    buildDailyCoordinatorDemandReminderJobKey,
    buildDailyCoordinatorDemandReminderMessage,
    buildDailyCoordinatorDeliveryReportJobKey,
    buildDailyCoordinatorDeliveryReportMessage,
    buildDailyCoordinatorDeliveryReportPeriod,
    buildDefaultComplaintWhatsAppTemplateMessage,
    buildWeeklyAdminComplaintReportJobKey,
    buildWeeklyAdminComplaintReportPeriod,
    buildWeeklyAdminComplaintReportWhatsAppMessage,
    buildWeeklyUserDemandReminderJobKey,
    canAttachEvidence,
    canChangeComplaintUnit,
    canDeleteEvidence,
    canEditComplaintPatientPhone,
    canRenotifyComplaint,
    canReceiveComplaintNotification,
    buildComplaintAssignedNotificationRecipients,
    changeUserPassword,
    decodeUploadedText,
    extractWhatsAppServiceEventMessage,
    extractWhatsAppServiceStatusEvent,
    isPasswordChangeRouteAllowed,
    getStoredUploadFilename,
    normalizeStoredUploadUrl,
    normalizeUploadedOriginalName,
    parseBodyWithSchema,
    persistUploadedFile,
    resolveStoredUploadFilePath,
    dispatchDailyCoordinatorDemandReminders,
    dispatchDailyCoordinatorDeliveryReport,
    dispatchWeeklyAdminComplaintReport,
    processWhatsAppDispatchQueue,
    parseMassWhatsAppRecipientsFromWorksheetRows,
    parseBulkNpsWorksheetRows,
    fillPartnerVideoTemplate,
    normalizePartnerVideoMessageText,
    parseMassWhatsAppRecipients,
    runScheduledDailyCoordinatorDemandReminders,
    runScheduledDailyCoordinatorDeliveryReport,
    runScheduledWeeklyAdminComplaintReport,
    renderGenericWhatsAppTemplate,
    shouldRunWeeklyUserDemandReminders,
    shouldRunDailyCoordinatorDemandReminders,
    shouldRunDailyCoordinatorDeliveryReport,
    shouldRunWeeklyAdminComplaintReport,
    sendPasswordChangedNotifications,
    sendUserAccessNotifications,
    signUserToken
  }
};
