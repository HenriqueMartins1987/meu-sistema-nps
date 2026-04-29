const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const DEFAULT_EMAIL_FROM = 'GRC Consultoria <contato@grcconsultoria.siteempresarial.com>';
const BRAND_LOGO_PATH = path.resolve(__dirname, '../../frontend/src/assets/logo3.png');

let cachedBrandLogoDataUrl = null;

function getEmailProvider() {
  const configuredProvider = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();

  if (configuredProvider) return configuredProvider;
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'log';
}

function getEmailFrom() {
  return process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || DEFAULT_EMAIL_FROM;
}

function getBrandLogoDataUrl() {
  if (cachedBrandLogoDataUrl !== null) {
    return cachedBrandLogoDataUrl;
  }

  try {
    const fileBuffer = fs.readFileSync(BRAND_LOGO_PATH);
    cachedBrandLogoDataUrl = `data:image/png;base64,${fileBuffer.toString('base64')}`;
  } catch (error) {
    cachedBrandLogoDataUrl = '';
  }

  return cachedBrandLogoDataUrl;
}

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createSmtpTransporter() {
  if (!isSmtpConfigured()) {
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

async function normalizeAttachments(attachments = []) {
  const safeAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];

  const resolved = await Promise.all(
    safeAttachments.map(async (attachment) => {
      if (attachment.path) {
        const filePath = path.resolve(attachment.path);
        const content = await fs.promises.readFile(filePath);

        return {
          filename: attachment.filename || path.basename(filePath),
          content,
          contentType: attachment.contentType
        };
      }

      if (attachment.content) {
        return {
          filename: attachment.filename,
          content: Buffer.isBuffer(attachment.content)
            ? attachment.content
            : Buffer.from(String(attachment.content), attachment.encoding || 'utf8'),
          contentType: attachment.contentType
        };
      }

      return null;
    })
  );

  return resolved.filter(Boolean);
}

async function sendWithResend({ to, subject, html, text, attachments = [] }) {
  if (!isResendConfigured()) {
    throw new Error('RESEND_API_KEY não configurada para o envio de e-mail.');
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const normalizedAttachments = await normalizeAttachments(attachments);
  const resendAttachments = normalizedAttachments.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content.toString('base64'),
    ...(attachment.contentType ? { contentType: attachment.contentType } : {})
  }));

  const response = await resend.emails.send({
    from: getEmailFrom(),
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
    attachments: resendAttachments.length ? resendAttachments : undefined
  });

  return {
    provider: 'resend',
    id: response?.data?.id || response?.id || null,
    raw: response
  };
}

async function sendWithSmtp({ to, subject, html, text, attachments = [] }) {
  const transporter = createSmtpTransporter();

  if (!transporter) {
    throw new Error('SMTP não configurado para o envio de e-mail.');
  }

  const response = await transporter.sendMail({
    from: getEmailFrom(),
    to,
    subject,
    html,
    text,
    attachments
  });

  return {
    provider: 'smtp',
    id: response?.messageId || null,
    raw: response
  };
}

async function sendEmail({ to, subject, html, text = '', attachments = [] }) {
  const provider = getEmailProvider();

  if (!to || !subject || !html) {
    throw new Error('Parâmetros obrigatórios de e-mail ausentes.');
  }

  if (provider === 'resend') {
    return sendWithResend({ to, subject, html, text, attachments });
  }

  if (provider === 'smtp') {
    return sendWithSmtp({ to, subject, html, text, attachments });
  }

  console.log(`[email pendente] Para: ${to} | Assunto: ${subject}`);
  return {
    provider: 'log',
    skipped: true,
    id: null,
    raw: null
  };
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAppUrl(appUrl) {
  return String(appUrl || '').trim() || process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://meu-sistema-nps.vercel.app/';
}

function renderBrandedEmail({
  eyebrow = 'GRC Consultoria',
  title,
  intro = '',
  bodyHtml = '',
  actionLabel = '',
  actionUrl = '',
  footerText = 'Este é um e-mail transacional do sistema. Se você não reconhece esta comunicação, procure o Administrador Master.'
}) {
  const logoDataUrl = getBrandLogoDataUrl();
  const actionBlock = actionLabel && actionUrl
    ? `
      <div style="margin:28px 0 0;">
        <a href="${actionUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#c89a57;color:#ffffff;text-decoration:none;font-weight:700;">
          ${actionLabel}
        </a>
      </div>
    `
    : '';

  return `
    <div style="margin:0;padding:24px;background:#f4efe6;font-family:Arial,Helvetica,sans-serif;color:#231f20;line-height:1.65;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e7dcc8;border-radius:18px;overflow:hidden;box-shadow:0 18px 36px rgba(35,31,32,0.08);">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#1f2329 0%,#2b3038 100%);color:#ffffff;">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="GRC Consultoria" style="display:block;max-width:170px;height:auto;margin:0 0 18px;" />` : ''}
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#d5a24c;">${eyebrow}</p>
          <h1 style="margin:0;font-size:28px;line-height:1.2;">${title}</h1>
        </div>
        <div style="padding:32px;">
          ${intro ? `<p style="margin:0 0 18px;">${intro}</p>` : ''}
          ${bodyHtml}
          ${actionBlock}
          <p style="margin:28px 0 0;color:#6a6360;">${footerText}</p>
        </div>
      </div>
    </div>
  `.trim();
}

function renderUserAccessEmail({ name, email, temporaryPassword, appUrl }) {
  const portalUrl = normalizeAppUrl(appUrl);
  const html = renderBrandedEmail({
    title: 'Seu acesso ao portal foi criado',
    intro: `Olá, <strong>${name || 'colaborador'}</strong>.`,
    bodyHtml: `
      <p style="margin:0 0 20px;">Seu acesso ao portal foi criado com sucesso. Abaixo estão os dados iniciais para o primeiro acesso.</p>
      <div style="margin:24px 0;padding:20px;border-radius:14px;background:#fbf8f2;border:1px solid #eadfc8;">
        <p style="margin:0 0 10px;"><strong>Login:</strong> ${email}</p>
        <p style="margin:0 0 10px;"><strong>Senha temporária:</strong> ${temporaryPassword}</p>
        <p style="margin:0;"><strong>Acesse:</strong> <a href="${portalUrl}" style="color:#a56a09;text-decoration:none;">${portalUrl}</a></p>
      </div>
      <p style="margin:0;">No primeiro acesso, a troca de senha será obrigatória por segurança.</p>
    `,
    actionLabel: 'Acessar o sistema',
    actionUrl: portalUrl
  });

  return {
    subject: 'Seu acesso ao portal foi criado',
    html
  };
}

function renderRegistrationApprovedEmail({ name, appUrl }) {
  const approvedUrl = normalizeAppUrl(appUrl);
  const html = renderBrandedEmail({
    title: 'Seu cadastro foi aprovado',
    intro: `Olá, <strong>${name || 'colaborador'}</strong>.`,
    bodyHtml: `
      <p style="margin:0 0 18px;">Seu cadastro foi aprovado e seu acesso já está liberado.</p>
      <p style="margin:0;"><strong>Acesse:</strong> <a href="${approvedUrl}" style="color:#a56a09;text-decoration:none;">${approvedUrl}</a></p>
    `,
    actionLabel: 'Entrar no portal',
    actionUrl: approvedUrl
  });

  return {
    subject: 'Seu cadastro foi aprovado',
    html
  };
}

function renderPasswordResetEmail({ name, temporaryPassword, appUrl }) {
  const changePasswordUrl = normalizeAppUrl(appUrl);
  const html = renderBrandedEmail({
    title: 'Sua senha foi reiniciada',
    intro: `Olá, <strong>${name || 'colaborador'}</strong>.`,
    bodyHtml: `
      <p style="margin:0 0 20px;">Seu acesso recebeu uma nova senha temporária. Entre no sistema e conclua a alteração da senha no primeiro acesso.</p>
      <div style="margin:24px 0;padding:20px;border-radius:14px;background:#fbf8f2;border:1px solid #eadfc8;">
        <p style="margin:0 0 10px;"><strong>Senha temporária:</strong> ${temporaryPassword}</p>
        <p style="margin:0 0 12px;"><strong>Link para alteração da senha:</strong> <a href="${changePasswordUrl}" style="color:#a56a09;text-decoration:none;">${changePasswordUrl}</a></p>
        <p style="margin:0;color:#6a6360;">Ao acessar o link, entre com a senha temporária. O sistema abrirá a troca obrigatória automaticamente.</p>
      </div>
    `,
    actionLabel: 'Acessar e alterar senha',
    actionUrl: changePasswordUrl
  });

  return {
    subject: 'Senha reiniciada - Sistema GRC',
    html
  };
}

async function sendWelcomeEmail({
  to,
  name,
  password,
  loginEmail = to,
  appUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://meu-sistema-nps.vercel.app/',
  sender = sendEmail
}) {
  if (!to || !password) {
    throw new Error('Destinatário e senha temporária são obrigatórios para o e-mail de boas-vindas.');
  }

  const template = renderUserAccessEmail({
    name,
    email: loginEmail,
    temporaryPassword: password,
    appUrl
  });

  return sender({
    to,
    subject: template.subject,
    html: template.html,
    text: htmlToText(template.html)
  });
}

module.exports = {
  DEFAULT_EMAIL_FROM,
  getBrandLogoDataUrl,
  getEmailFrom,
  getEmailProvider,
  htmlToText,
  renderBrandedEmail,
  renderPasswordResetEmail,
  renderRegistrationApprovedEmail,
  renderUserAccessEmail,
  sendEmail,
  sendWelcomeEmail
};
