const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const DEFAULT_EMAIL_FROM = 'GRC Consultoria <contato@grcconsultoria.net.br>';
const LEGACY_EMAIL_FROM_PATTERN = /contato@grcconsultoria\.siteempresarial\.com/i;
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
  const configuredFrom = String(
    process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || DEFAULT_EMAIL_FROM
  ).trim();

  if (!configuredFrom || LEGACY_EMAIL_FROM_PATTERN.test(configuredFrom)) {
    return DEFAULT_EMAIL_FROM;
  }

  return configuredFrom;
}

function getConfiguredEmailFrom() {
  return String(process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
}

function pushUniqueEmailFrom(list, value) {
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return;
  }

  const normalizedKey = normalizedValue.toLowerCase();

  if (!list.some((item) => item.toLowerCase() === normalizedKey)) {
    list.push(normalizedValue);
  }
}

function getResendFromCandidates() {
  const candidates = [];

  pushUniqueEmailFrom(candidates, getEmailFrom());
  pushUniqueEmailFrom(candidates, process.env.RESEND_FALLBACK_FROM || process.env.EMAIL_FALLBACK_FROM);
  pushUniqueEmailFrom(candidates, getConfiguredEmailFrom());

  return candidates;
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

function getResendErrorMessage(error) {
  if (!error) {
    return '';
  }

  return String(error.message || error.name || error || '').trim();
}

function getResendErrorStatus(error) {
  return error?.statusCode || error?.status_code || error?.status || null;
}

function isResendSenderAuthorizationError(error) {
  const message = getResendErrorMessage(error).toLowerCase();
  const status = Number(getResendErrorStatus(error) || 0);

  return status === 403 && message.includes('not authorized to send emails from');
}

function buildResendError(error, from) {
  const message = getResendErrorMessage(error) || 'Falha no envio pelo Resend.';
  const status = getResendErrorStatus(error);
  const resendError = new Error(status ? `Resend (${status}) recusou ${from}: ${message}` : `Resend recusou ${from}: ${message}`);

  resendError.provider = 'resend';
  resendError.statusCode = status || undefined;
  resendError.raw = error;

  return resendError;
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
  const fromCandidates = getResendFromCandidates();
  let lastError = null;

  for (const from of fromCandidates) {
    const response = await resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      attachments: resendAttachments.length ? resendAttachments : undefined
    });

    if (response?.error) {
      lastError = buildResendError(response.error, from);

      if (isResendSenderAuthorizationError(response.error)) {
        console.warn(`Resend recusou o remetente ${from}; tentando remetente alternativo configurado.`);
        continue;
      }

      throw lastError;
    }

    return {
      provider: 'resend',
      id: response?.data?.id || response?.id || null,
      from,
      fallbackFrom: from !== fromCandidates[0],
      raw: response
    };
  }

  throw lastError || new Error('Nenhum remetente autorizado foi encontrado para envio pelo Resend.');
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMetricGrid(items = []) {
  const safeItems = Array.isArray(items)
    ? items.filter((item) => item && item.label && item.value !== undefined && item.value !== null && item.value !== '')
    : [];

  if (!safeItems.length) {
    return '';
  }

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border-collapse:separate;border-spacing:0 10px;">
      ${safeItems.map((item) => `
        <tr>
          <td style="padding:16px 18px;border-radius:8px;border:1px solid #ddcfbc;background:#fffdfa;">
            <p style="margin:0 0 7px;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#8e6731;">${escapeHtml(item.label)}</p>
            <strong style="display:block;font-size:16px;line-height:1.45;color:#161218;">${escapeHtml(item.value)}</strong>
          </td>
        </tr>
      `).join('')}
    </table>
  `.trim();
}

function renderCodePanel(label, code) {
  return `
    <div style="margin:24px 0;padding:22px 20px;border-radius:8px;background:#fffdfa;border:1px solid #ddcfbc;text-align:center;">
      <p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#816038;">${escapeHtml(label)}</p>
      <strong style="display:block;font-size:34px;letter-spacing:0.12em;color:#161218;">${escapeHtml(code)}</strong>
    </div>
  `.trim();
}

function renderBrandedEmail({
  eyebrow = 'GRC Consultoria',
  title,
  intro = '',
  bodyHtml = '',
  actionLabel = '',
  actionUrl = '',
  supportText = 'Portal de relacionamento e experiência',
  footerText = 'Este é um e-mail transacional do sistema. Se você não reconhece esta comunicação, procure o Administrador Master.'
}) {
  const logoDataUrl = getBrandLogoDataUrl();
  const actionBlock = actionLabel && actionUrl
    ? `
      <div style="margin:28px 0 0;">
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#8e6731;color:#ffffff;text-decoration:none;font-weight:800;">
          ${escapeHtml(actionLabel)}
        </a>
      </div>
    `
    : '';

  return `
    <div style="margin:0;padding:28px 16px;background:#f6efe4;font-family:Arial,Helvetica,sans-serif;color:#161218;line-height:1.65;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #ddcfbc;border-radius:8px;overflow:hidden;box-shadow:0 18px 42px rgba(22,18,24,0.12);">
        <div style="padding:28px 32px 26px;background:linear-gradient(135deg,#171b21 0%,#262b32 68%,#8e6731 100%);color:#ffffff;border-bottom:4px solid #c89a57;">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="GRC Consultoria" style="display:block;max-width:182px;height:auto;margin:0 0 20px;" />` : ''}
          <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:0.11em;text-transform:uppercase;color:#e0bc82;">${escapeHtml(eyebrow)}</p>
          <h1 style="margin:0 0 10px;font-size:28px;line-height:1.2;color:#ffffff;">${escapeHtml(title)}</h1>
          <p style="margin:0;color:rgba(255,255,255,0.76);font-size:14px;">${escapeHtml(supportText)}</p>
        </div>
        <div style="padding:32px;background:#fffdfa;">
          ${intro ? `<p style="margin:0 0 18px;font-size:16px;color:#2f2825;">${intro}</p>` : ''}
          ${bodyHtml}
          ${actionBlock}
          <div style="margin:30px 0 0;padding-top:18px;border-top:1px solid #ddcfbc;">
            <p style="margin:0;color:#6c5a4e;font-size:13px;">${escapeHtml(footerText)}</p>
          </div>
        </div>
      </div>
    </div>
  `.trim();
}

function renderUserAccessEmail({ name, email, temporaryPassword, appUrl }) {
  const portalUrl = normalizeAppUrl(appUrl);
  return {
    subject: 'Seu acesso ao portal foi criado',
    html: renderBrandedEmail({
      title: 'Seu acesso ao portal foi criado',
      intro: `Olá, <strong>${escapeHtml(name || 'colaborador')}</strong>.`,
      bodyHtml: `
        <p style="margin:0 0 20px;">Seu acesso ao portal foi criado com sucesso. Use as credenciais abaixo para entrar no sistema com segurança.</p>
        ${renderMetricGrid([
          { label: 'Login', value: email },
          { label: 'Senha temporária', value: temporaryPassword },
          { label: 'Portal', value: portalUrl }
        ])}
        <div style="padding:16px 18px;border-radius:14px;background:#fff8ed;border:1px solid #ecd9b7;color:#6a512c;">
          <strong style="display:block;margin:0 0 6px;color:#8e6731;">Atenção</strong>
          <span>No primeiro acesso, a troca de senha será obrigatória. Recomendamos concluir a alteração imediatamente.</span>
        </div>
      `,
      actionLabel: 'Acessar o sistema',
      actionUrl: portalUrl
    })
  };
}

function renderRegistrationApprovedEmail({ name, appUrl }) {
  const approvedUrl = normalizeAppUrl(appUrl);
  return {
    subject: 'Seu cadastro foi aprovado',
    html: renderBrandedEmail({
      title: 'Seu cadastro foi aprovado',
      intro: `Olá, <strong>${escapeHtml(name || 'colaborador')}</strong>.`,
      bodyHtml: `
        <p style="margin:0 0 18px;">Seu cadastro foi aprovado e o acesso ao sistema já está liberado.</p>
        ${renderMetricGrid([{ label: 'Portal', value: approvedUrl }])}
      `,
      actionLabel: 'Entrar no portal',
      actionUrl: approvedUrl
    })
  };
}

function renderPasswordResetEmail({ name, temporaryPassword, appUrl }) {
  const changePasswordUrl = normalizeAppUrl(appUrl);
  return {
    subject: 'Senha reiniciada - Sistema GRC',
    html: renderBrandedEmail({
      title: 'Sua senha foi reiniciada',
      intro: `Olá, <strong>${escapeHtml(name || 'colaborador')}</strong>.`,
      bodyHtml: `
        <p style="margin:0 0 20px;">Uma nova senha temporária foi gerada para o seu acesso. Entre no portal e conclua a alteração para manter sua conta protegida.</p>
        ${renderMetricGrid([
          { label: 'Senha temporária', value: temporaryPassword },
          { label: 'Link para alteração', value: changePasswordUrl }
        ])}
        <div style="padding:16px 18px;border-radius:14px;background:#fff8ed;border:1px solid #ecd9b7;color:#6a512c;">
          <strong style="display:block;margin:0 0 6px;color:#8e6731;">Próximo passo</strong>
          <span>Entre com a senha temporária. O sistema abrirá a troca obrigatória automaticamente.</span>
        </div>
      `,
      actionLabel: 'Acessar e alterar senha',
      actionUrl: changePasswordUrl
    })
  };
}

function renderPasswordRecoveryCodeEmail({ name, code, appUrl, expirationMinutes }) {
  const loginUrl = normalizeAppUrl(appUrl);
  return {
    subject: 'Código para redefinição de senha - Sistema GRC',
    html: renderBrandedEmail({
      title: 'Recuperação de senha',
      intro: `Olá, <strong>${escapeHtml(name || 'colaborador')}</strong>.`,
      bodyHtml: `
        <p style="margin:0 0 20px;">Recebemos uma solicitação para redefinir a senha do seu acesso.</p>
        ${renderCodePanel('Código de confirmação', code)}
        <div style="padding:16px 18px;border-radius:14px;background:#fff8ed;border:1px solid #ecd9b7;color:#6a512c;">
          <strong style="display:block;margin:0 0 6px;color:#8e6731;">Como usar</strong>
          <span>Informe esse código na tela de login para cadastrar uma nova senha forte. O código expira em ${escapeHtml(expirationMinutes)} minutos.</span>
        </div>
      `,
      actionLabel: 'Abrir tela de login',
      actionUrl: loginUrl
    })
  };
}

function renderRegistrationReviewEmail({ name, email, position, profileLabel, phone, whatsapp, department, approvalLink }) {
  return {
    subject: 'Novo cadastro aguardando aprovação - Sistema GRC',
    html: renderBrandedEmail({
      eyebrow: 'Solicitação de acesso',
      title: 'Novo cadastro aguardando aprovação',
      intro: 'Um novo colaborador solicitou acesso ao sistema.',
      bodyHtml: renderMetricGrid([
        { label: 'Nome', value: name },
        { label: 'E-mail', value: email },
        { label: 'Cargo', value: position },
        { label: 'Perfil solicitado', value: profileLabel },
        { label: 'Telefone', value: phone || 'Não informado' },
        { label: 'WhatsApp', value: whatsapp || 'Não informado' },
        { label: 'Área / unidade', value: department || 'Não informado' }
      ]),
      actionLabel: 'Aprovar cadastro',
      actionUrl: approvalLink,
      footerText: 'O acesso ao conteúdo permanece protegido por login e senha. Revise os dados antes de aprovar.'
    })
  };
}

function renderRegistrationRejectedEmail({ name }) {
  return {
    subject: 'Cadastro não aprovado - Sistema GRC',
    html: renderBrandedEmail({
      eyebrow: 'Solicitação encerrada',
      title: 'Cadastro não aprovado',
      intro: `Olá, <strong>${escapeHtml(name || 'colaborador')}</strong>.`,
      bodyHtml: `
        <p style="margin:0;">Seu cadastro foi analisado e não foi aprovado neste momento. Se precisar de esclarecimentos, procure o responsável pela administração do sistema.</p>
      `
    })
  };
}

function renderWeeklyCoordinatorReportEmail({ coordinatorName, total, delayed, reportUrl = '' }) {
  return {
    subject: `Relatório semanal - ${coordinatorName}`,
    html: renderBrandedEmail({
      eyebrow: 'Relatório operacional',
      title: `Relatório semanal de ${coordinatorName}`,
      intro: 'Segue o resumo da carteira do coordenador para acompanhamento da operação.',
      bodyHtml: renderMetricGrid([
        { label: 'Total de protocolos', value: String(total) },
        { label: 'Atrasadas', value: String(delayed) }
      ]),
      actionLabel: reportUrl ? 'Abrir relatório' : '',
      actionUrl: reportUrl || ''
    })
  };
}

function renderMarketingProtocolEmail({ protocol, patientName, clinicName, complaintUrl }) {
  return {
    subject: `Protocolo ${protocol} registrado pelo Marketing`,
    html: renderBrandedEmail({
      eyebrow: 'Link externo',
      title: 'Novo protocolo registrado pelo Marketing',
      intro: 'Um novo protocolo foi criado a partir do link externo do Marketing.',
      bodyHtml: renderMetricGrid([
        { label: 'Protocolo', value: protocol },
        { label: 'Paciente', value: patientName },
        { label: 'Clínica', value: clinicName || 'Não informada' }
      ]),
      actionLabel: complaintUrl ? 'Abrir no sistema' : '',
      actionUrl: complaintUrl || '',
      footerText: 'O acesso ao protocolo continua protegido por login e senha.'
    })
  };
}

function renderOperationalTestEmail({ name, loginEmail, appUrl }) {
  const portalUrl = normalizeAppUrl(appUrl);
  return {
    subject: 'Teste de e-mail - Sistema GRC',
    html: renderBrandedEmail({
      eyebrow: 'Teste operacional',
      title: 'Canal de e-mail validado',
      intro: `Olá, <strong>${escapeHtml(name || 'Administrador Master')}</strong>.`,
      bodyHtml: `
        <p style="margin:0 0 18px;color:#2f2825;">Este é um envio de teste do Sistema GRC para confirmar a configuração do provedor, do remetente padrão e do layout transacional.</p>
        ${renderMetricGrid([
          { label: 'Destinatário', value: loginEmail || 'Administrador Master' },
          { label: 'Remetente padrão', value: getEmailFrom() },
          { label: 'Portal', value: portalUrl }
        ])}
      `,
      actionLabel: 'Abrir sistema',
      actionUrl: portalUrl,
      footerText: 'Este teste confirma o canal de e-mail do sistema. Nenhuma ação operacional é necessária.'
    })
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
  getResendFromCandidates,
  htmlToText,
  isResendSenderAuthorizationError,
  renderBrandedEmail,
  renderMarketingProtocolEmail,
  renderOperationalTestEmail,
  renderPasswordRecoveryCodeEmail,
  renderPasswordResetEmail,
  renderRegistrationApprovedEmail,
  renderRegistrationRejectedEmail,
  renderRegistrationReviewEmail,
  renderUserAccessEmail,
  renderWeeklyCoordinatorReportEmail,
  sendEmail,
  sendWelcomeEmail
};
