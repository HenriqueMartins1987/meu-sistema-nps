let playwrightChromium = null;

function getPlaywrightChromium() {
  if (!playwrightChromium) {
    ({ chromium: playwrightChromium } = require('playwright'));
  }
  return playwrightChromium;
}

function normalizeBaseUrl(value = '') {
  const baseUrl = String(value || 'https://ecuro.com.br').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('EXTERNAL_PORTAL_BASE_URL is required for Ecuro authentication.');
  }
  return baseUrl;
}

function getTimeout(config = {}) {
  return Math.max(1000, Number(config.timeoutMs || 60000) || 60000);
}

function assertCredential(value, envName, description) {
  if (String(value || '').trim()) return;
  throw new Error(`${envName} is required for ${description}.`);
}

function validateEcuroCredentials(config = {}) {
  assertCredential(config.level1Username, 'EXTERNAL_PORTAL_LEVEL1_USERNAME', 'Ecuro HTTP Basic Auth');
  assertCredential(config.level1Password, 'EXTERNAL_PORTAL_LEVEL1_PASSWORD', 'Ecuro HTTP Basic Auth');
  assertCredential(config.level2Username, 'EXTERNAL_PORTAL_LEVEL2_USERNAME', 'Ecuro HTML login');
  assertCredential(config.level2Password, 'EXTERNAL_PORTAL_LEVEL2_PASSWORD', 'Ecuro HTML login');
}

function logAuthStage(stage) {
  console.info(`ECURO_AUTH_STAGE=${stage}`);
}

function buildEcuroAuthError(message, code = 'ecuro_auth_failed') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function getSafePageTitle(page) {
  try {
    return await page.title();
  } catch (_error) {
    return '';
  }
}

async function validateEcuroPageState(page, response, label, options = {}) {
  const status = typeof response?.status === 'function' ? response.status() : null;
  if (status === 401) {
    throw buildEcuroAuthError(`Ecuro authentication failed at ${label}: HTTP 401.`, 'ecuro_basic_auth_failed');
  }
  if (status === 403) {
    throw buildEcuroAuthError(`Ecuro authentication failed at ${label}: HTTP 403.`, 'ecuro_access_forbidden');
  }

  const title = await getSafePageTitle(page);
  if (/authorization required/i.test(title)) {
    throw buildEcuroAuthError(`Ecuro authentication failed at ${label}: Authorization Required page returned.`, 'ecuro_basic_auth_failed');
  }

  const currentUrl = typeof page.url === 'function' ? page.url() : '';
  if (!options.allowLogin && /\/login(?:[/?#]|$)/i.test(currentUrl)) {
    throw buildEcuroAuthError(`Ecuro authentication failed at ${label}: application remained on /login.`, 'ecuro_application_login_failed');
  }
  if (options.requireDashboard && !/\/dashboard\//i.test(currentUrl)) {
    throw buildEcuroAuthError(`Ecuro authentication failed at ${label}: final URL is not inside /dashboard/.`, 'ecuro_application_login_failed');
  }

  return { status, title, currentUrl };
}

async function firstVisibleLocator(page, selectors = [], timeout = 800) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout })) return locator;
    } catch (_error) {
      // Selector did not match or visibility check timed out; keep trying.
    }
  }
  return null;
}

async function hasVisiblePasswordInput(page) {
  const password = await firstVisibleLocator(page, ['input[type=password]:visible'], 500);
  return Boolean(password);
}

async function fillRequiredLoginFields(page, config) {
  const usernameSelectors = [
    'input[autocomplete="username"]',
    'input[type="email"]',
    'input[name*="username" i]',
    'input[name*="usuario" i]',
    'input[name*="login" i]',
    'input[type="text"]:visible'
  ];
  const username = await firstVisibleLocator(page, usernameSelectors, 1000);
  if (!username) {
    throw buildEcuroAuthError('Ecuro HTML login failed: visible username field was not found.', 'ecuro_application_login_failed');
  }

  const password = await firstVisibleLocator(page, ['input[type=password]:visible'], 1000);
  if (!password) {
    throw buildEcuroAuthError('Ecuro HTML login failed: visible password field was not found.', 'ecuro_application_login_failed');
  }

  await username.fill(String(config.level2Username || ''));
  await password.fill(String(config.level2Password || ''));
  return { password };
}

async function waitForDashboardUrl(page, timeout) {
  try {
    await page.waitForURL((url) => String(url || '').includes('/dashboard/'), { timeout });
    return true;
  } catch (_error) {
    return /\/dashboard\//i.test(typeof page.url === 'function' ? page.url() : '');
  }
}

async function submitEcuroLogin(page, passwordLocator, timeout) {
  const submitSelectors = [
    'button:has-text("ENTRAR")',
    'button[type=submit]',
    'input[type=submit]'
  ];

  for (const selector of submitSelectors) {
    const button = await firstVisibleLocator(page, [selector], 700);
    if (!button) continue;
    await button.click();
    if (await waitForDashboardUrl(page, timeout)) return;
  }

  await passwordLocator.press('Enter');
  if (await waitForDashboardUrl(page, timeout)) return;

  throw buildEcuroAuthError('Ecuro HTML login failed: form remained on /login after submit.', 'ecuro_application_login_failed');
}

async function ensureEcuroApplicationLogin(page, config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const timeout = getTimeout(config);

  const initialResponse = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout });
  await validateEcuroPageState(page, initialResponse, 'baseUrl', { allowLogin: true });
  logAuthStage('basic_ok');

  const currentUrl = typeof page.url === 'function' ? page.url() : '';
  const requiresLevel2Login = /\/login(?:[/?#]|$)/i.test(currentUrl) || await hasVisiblePasswordInput(page);

  if (requiresLevel2Login) {
    logAuthStage('level2_required');
    const { password } = await fillRequiredLoginFields(page, config);
    await submitEcuroLogin(page, password, timeout);
    await validateEcuroPageState(page, null, 'level2', { requireDashboard: true });
    logAuthStage('level2_ok');
  } else {
    await validateEcuroPageState(page, null, 'level2', { requireDashboard: /\/dashboard\//i.test(currentUrl) });
    logAuthStage('level2_ok');
  }

  const overviewResponse = await page.goto(`${baseUrl}/dashboard/overview`, { waitUntil: 'domcontentloaded', timeout });
  await validateEcuroPageState(page, overviewResponse, 'dashboard_overview', { requireDashboard: true });
  logAuthStage('overview_ok');

  const patientsResponse = await page.goto(`${baseUrl}/dashboard/patients`, { waitUntil: 'domcontentloaded', timeout });
  await validateEcuroPageState(page, patientsResponse, 'dashboard_patients', { requireDashboard: true });
  logAuthStage('patients_ok');

  return { authenticated: true, currentUrl: typeof page.url === 'function' ? page.url() : '' };
}

async function createAuthenticatedEcuroSession(config = {}) {
  validateEcuroCredentials(config);

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const origin = new URL(baseUrl).origin;
  const timeout = getTimeout(config);
  const chromium = config.chromium || getPlaywrightChromium();
  let browser;
  let context;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    await context?.close().catch(() => null);
    await browser?.close().catch(() => null);
  };

  try {
    browser = await chromium.launch({
      headless: config.headless,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    context = await browser.newContext({
      viewport: {
        width: 1440,
        height: 960
      },
      userAgent: config.userAgent || undefined,
      acceptDownloads: true,
      httpCredentials: {
        username: config.level1Username,
        password: config.level1Password,
        origin
      }
    });

    const basicToken = Buffer.from(`${config.level1Username}:${config.level1Password}`).toString('base64');
    await context.route('**/*', async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      if (requestUrl.origin !== origin) {
        await route.continue();
        return;
      }

      await route.continue({
        headers: {
          ...request.headers(),
          Authorization: `Basic ${basicToken}`
        }
      });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    await ensureEcuroApplicationLogin(page, { ...config, baseUrl });

    return {
      browser,
      context,
      page,
      close
    };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = {
  createAuthenticatedEcuroSession,
  ensureEcuroApplicationLogin
};
