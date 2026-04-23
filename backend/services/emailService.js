const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const DEFAULT_EMAIL_FROM = 'GRC Consultoria <contato@grcconsultoria.net.br>';

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

  return Promise.all(safeAttachments.map(async (attachment) => {
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
  })).then((results) => results.filter(Boolean));
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

function renderUserAccessEmail({ name, email, temporaryPassword, appUrl }) {
  return {
    subject: 'Seu acesso ao portal foi criado',
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; color: #1b1b1f; line-height: 1.6;">
        <h2 style="margin-bottom: 16px;">Olá, ${name || 'colaborador'}.</h2>
        <p>Seu acesso ao portal foi criado com sucesso.</p>
        <p><strong>Login:</strong> ${email}</p>
        <p><strong>Senha temporária:</strong> ${temporaryPassword}</p>
        <p><strong>Acesse:</strong> <a href="${appUrl}">${appUrl}</a></p>
        <p>No primeiro acesso, altere sua senha para continuar usando o sistema.</p>
      </div>
    `.trim()
  };
}

function renderRegistrationApprovedEmail({ name, appUrl }) {
  return {
    subject: 'Seu cadastro foi aprovado',
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; color: #1b1b1f; line-height: 1.6;">
        <h2 style="margin-bottom: 16px;">Olá, ${name || 'colaborador'}.</h2>
        <p>Seu cadastro foi aprovado e seu acesso já está liberado.</p>
        <p><strong>Acesse:</strong> <a href="${appUrl}">${appUrl}</a></p>
      </div>
    `.trim()
  };
}

function renderPasswordResetEmail({ name, temporaryPassword, appUrl }) {
  return {
    subject: 'Senha reiniciada - Sistema GRC',
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; color: #1b1b1f; line-height: 1.6;">
        <h2 style="margin-bottom: 16px;">Olá, ${name || 'colaborador'}.</h2>
        <p>Sua senha foi reiniciada pelo administrador.</p>
        <p><strong>Senha temporária:</strong> ${temporaryPassword}</p>
        <p><strong>Acesse:</strong> <a href="${appUrl}">${appUrl}</a></p>
        <p>No próximo acesso, a alteração da senha será obrigatória.</p>
      </div>
    `.trim()
  };
}

module.exports = {
  DEFAULT_EMAIL_FROM,
  getEmailFrom,
  getEmailProvider,
  sendEmail,
  renderUserAccessEmail,
  renderRegistrationApprovedEmail,
  renderPasswordResetEmail
};
