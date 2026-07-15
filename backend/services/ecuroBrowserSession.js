const fs = require('fs');
const path = require('path');

let playwrightChromium = null;
let sessionInUse = false;

function getPlaywrightChromium() {
  if (!playwrightChromium) {
    ({ chromium: playwrightChromium } = require('playwright'));
  }

  return playwrightChromium;
}

function normalizeBaseUrl(value = '') {
  const baseUrl = String(value || 'https://ecuro.com.br')
    .trim()
    .replace(/\/+$/, '');

  if (!baseUrl) {
    throw new Error('EXTERNAL_PORTAL_BASE_URL ausente.');
  }

  return baseUrl;
}

function getTimeout(config = {}) {
  return Math.max(
    10000,
    Number(config.timeoutMs || process.env.ROBOT_TIMEOUT_MS || 60000) || 60000
  );
}

function buildAuthError(message, code = 'ecuro_auth_failed', statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertCredential(value, envName) {
  if (String(value || '').trim()) return;

  throw buildAuthError(
    `${envName} não configurada.`,
    'ecuro_credentials_missing'
  );
}

function validateCredentials(config = {}) {
  assertCredential(
    config.level1Username,
    'EXTERNAL_PORTAL_LEVEL1_USERNAME'
  );

  assertCredential(
    config.level1Password,
    'EXTERNAL_PORTAL_LEVEL1_PASSWORD'
  );

  assertCredential(
    config.level2Username,
    'EXTERNAL_PORTAL_LEVEL2_USERNAME'
  );

  assertCredential(
    config.level2Password,
    'EXTERNAL_PORTAL_LEVEL2_PASSWORD'
  );
}

function sleep(page, milliseconds) {
  return page.waitForTimeout(
    Math.max(0, Number(milliseconds || 0) || 0)
  );
}

async function firstVisibleLocator(page, selectors = [], timeout = 800) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      if (await locator.isVisible({ timeout })) {
        return locator;
      }
    } catch (_error) {
      // Continua procurando.
    }
  }

  return null;
}

async function getBodyPreview(page) {
  const body = await page
    .locator('body')
    .innerText()
    .catch(() => '');

  return String(body || '')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

function isDashboardUrl(value = '') {
  return /\/dashboard(?:[/?#]|$)/i.test(String(value || ''));
}

function isPatientsUrl(value = '') {
  return /\/dashboard\/patients(?:[/?#]|$)/i.test(
    String(value || '')
  );
}

function isLoginUrl(value = '') {
  return /\/login(?:[/?#]|$)/i.test(String(value || ''));
}

async function isLoginScreen(page) {
  if (isLoginUrl(page.url())) {
    return true;
  }

  const password = await firstVisibleLocator(
    page,
    ['input[type="password"]:visible'],
    300
  );

  return Boolean(password);
}

async function captureDiagnostic(page, config, name, metadata = {}) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const debugDir = path.resolve(
    config.debugDir
      || process.env.ECURO_ROBOT_DEBUG_DIR
      || path.join(process.cwd(), 'runtime', 'ecuro-debug')
  );

  const screenshotDir = path.resolve(
    config.screenshotDir
      || process.env.ECURO_ROBOT_SCREENSHOT_DIR
      || '/var/log/ecuro-robot/screenshots'
  );

  fs.mkdirSync(debugDir, { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });

  const debugFile = path.join(
    debugDir,
    `${timestamp}-${name}.json`
  );

  const screenshotFile = path.join(
    screenshotDir,
    `${timestamp}-${name}.png`
  );

  const payload = {
    ...metadata,
    url: page.url(),
    bodyPreview: await getBodyPreview(page),
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(
    debugFile,
    JSON.stringify(payload, null, 2),
    'utf8'
  );

  await page
    .screenshot({
      path: screenshotFile,
      fullPage: true
    })
    .catch(() => null);

  console.error(
    `ECURO_AUTH_DIAGNOSTIC debug=${debugFile} screenshot=${screenshotFile}`
  );

  return {
    debugFile,
    screenshotFile
  };
}

async function waitForLevel2LoginOrDashboard(page, maximumWaitMs) {
  const deadline = Date.now() + maximumWaitMs;

  while (Date.now() < deadline) {
    const currentUrl = page.url();

    if (isDashboardUrl(currentUrl)) {
      return {
        state: 'dashboard'
      };
    }

    const password = await firstVisibleLocator(
      page,
      ['input[type="password"]:visible'],
      500
    );

    if (password) {
      const username = await firstVisibleLocator(
        page,
        [
          'input[autocomplete="username"]:visible',
          'input[type="email"]:visible',
          'input[name*="username" i]:visible',
          'input[name*="usuario" i]:visible',
          'input[name*="login" i]:visible',
          'input[type="text"]:visible'
        ],
        700
      );

      if (username) {
        return {
          state: 'level2_login',
          username,
          password
        };
      }
    }

    await sleep(page, 1000);
  }

  return {
    state: 'timeout'
  };
}

async function submitLevel2Login(page, username, password, config, timeout) {
  console.info(
    `ECURO_AUTH_FLOW=LEVEL2_FILL url=${page.url()}`
  );

  await username.fill(
    String(config.level2Username || '')
  );

  await password.fill(
    String(config.level2Password || '')
  );

  const submit = await firstVisibleLocator(
    page,
    [
      'button:has-text("ENTRAR")',
      'button[type="submit"]',
      'input[type="submit"]'
    ],
    1000
  );

  console.info(
    `ECURO_AUTH_FLOW=LEVEL2_SUBMIT url=${page.url()}`
  );

  if (submit) {
    await submit.click();
  } else {
    await password.press('Enter');
  }

  try {
    await page.waitForURL(
      (url) => isDashboardUrl(String(url || '')),
      { timeout }
    );
  } catch (_error) {
    if (!isDashboardUrl(page.url())) {
      throw buildAuthError(
        'Segundo login não alcançou o dashboard.',
        'ecuro_level2_login_failed'
      );
    }
  }

  console.info(
    `ECURO_AUTH_FLOW=LEVEL2_DASHBOARD_REACHED url=${page.url()}`
  );
}

async function assertStableDashboard(
  page,
  milliseconds,
  phase,
  authFailures
) {
  const deadline = Date.now() + milliseconds;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw buildAuthError(
        `Página fechada durante ${phase}.`,
        'ecuro_page_closed'
      );
    }

    const currentUrl = page.url();

    if (isLoginUrl(currentUrl) || await isLoginScreen(page)) {
      throw buildAuthError(
        `Ecuro retornou para /login durante ${phase}. `
        + `Falhas HTTP recentes: ${JSON.stringify(authFailures.slice(-10))}`,
        'ecuro_session_invalidated'
      );
    }

    await sleep(page, 1000);
  }

  if (!isDashboardUrl(page.url())) {
    throw buildAuthError(
      `Página não permaneceu no dashboard durante ${phase}: ${page.url()}`,
      'ecuro_dashboard_unstable'
    );
  }

  console.info(
    `ECURO_AUTH_FLOW=${phase.toUpperCase()}_OK url=${page.url()}`
  );
}

async function ensureEcuroApplicationLogin(page, config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const timeout = getTimeout(config);

  const firstLoginWaitMs = Math.max(
    0,
    Number(
      process.env.ECURO_FIRST_LOGIN_WAIT_MS || 35000
    ) || 35000
  );

  const secondLoginMaxWaitMs = Math.max(
    10000,
    Number(
      process.env.ECURO_SECOND_LOGIN_MAX_WAIT_MS || 60000
    ) || 60000
  );

  const postLoginStabilityMs = Math.max(
    5000,
    Number(
      process.env.ECURO_POST_LOGIN_STABILITY_MS || 20000
    ) || 20000
  );

  const patientsStabilityMs = Math.max(
    5000,
    Number(
      process.env.ECURO_PATIENTS_STABILITY_MS || 10000
    ) || 10000
  );

  const authFailures = Array.isArray(config.authFailures)
    ? config.authFailures
    : [];

  console.info(
    `ECURO_AUTH_FLOW=FIRST_ENTRY_START url=${baseUrl}`
  );

  const firstResponse = await page.goto(
    `${baseUrl}/`,
    {
      waitUntil: 'domcontentloaded',
      timeout
    }
  );

  const firstStatus =
    typeof firstResponse?.status === 'function'
      ? firstResponse.status()
      : null;

  if (firstStatus === 401 || firstStatus === 403) {
    throw buildAuthError(
      `Primeiro nível retornou HTTP ${firstStatus}.`,
      'ecuro_level1_login_failed'
    );
  }

  console.info(
    `ECURO_AUTH_FLOW=FIRST_ENTRY_LOADED `
    + `url=${page.url()} waitMs=${firstLoginWaitMs}`
  );

  /*
   * Regra funcional confirmada:
   * o Ecuro precisa permanecer aproximadamente 35 segundos
   * após o primeiro nível antes do segundo login.
   */
  await sleep(page, firstLoginWaitMs);

  console.info(
    `ECURO_AUTH_FLOW=WAIT_AFTER_LEVEL1_DONE url=${page.url()}`
  );

  /*
   * Não chamar novamente page.goto(baseUrl).
   * O segundo login deve acontecer sobre a mesma página/contexto.
   */
  const detected = await waitForLevel2LoginOrDashboard(
    page,
    secondLoginMaxWaitMs
  );

  if (detected.state === 'timeout') {
    await captureDiagnostic(
      page,
      config,
      'level2-login-not-found',
      {
        firstLoginWaitMs,
        secondLoginMaxWaitMs,
        authFailures
      }
    );

    throw buildAuthError(
      'Segundo login não apareceu após o período de espera.',
      'ecuro_level2_login_not_found'
    );
  }

  if (detected.state === 'level2_login') {
    await submitLevel2Login(
      page,
      detected.username,
      detected.password,
      config,
      timeout
    );
  } else {
    console.info(
      `ECURO_AUTH_FLOW=SESSION_ALREADY_ON_DASHBOARD url=${page.url()}`
    );
  }

  /*
   * O dashboard só é considerado autenticado depois de permanecer
   * estável. Apenas enxergar a URL por alguns milissegundos não basta.
   */
  await assertStableDashboard(
    page,
    postLoginStabilityMs,
    'post_login_stability',
    authFailures
  );

  const patientsUrl = `${baseUrl}/dashboard/patients`;

  if (!isPatientsUrl(page.url())) {
    console.info(
      `ECURO_AUTH_FLOW=PATIENTS_NAVIGATION_START `
      + `from=${page.url()} to=${patientsUrl}`
    );

    await page.goto(
      patientsUrl,
      {
        waitUntil: 'domcontentloaded',
        timeout
      }
    );
  }

  await assertStableDashboard(
    page,
    patientsStabilityMs,
    'patients_stability',
    authFailures
  );

  if (!isPatientsUrl(page.url())) {
    await captureDiagnostic(
      page,
      config,
      'patients-url-not-reached',
      {
        expected: patientsUrl,
        authFailures
      }
    );

    throw buildAuthError(
      `URL final diferente da tela de pacientes: ${page.url()}`,
      'ecuro_patients_navigation_failed'
    );
  }

  console.info(
    `ECURO_AUTH_FLOW=AUTHENTICATED_AND_STABLE url=${page.url()}`
  );

  return {
    authenticated: true,
    stable: true,
    currentUrl: page.url()
  };
}

async function createAuthenticatedEcuroSession(config = {}) {
  if (sessionInUse) {
    throw buildAuthError(
      'Já existe uma sessão Ecuro em execução.',
      'ecuro_session_busy',
      409
    );
  }

  sessionInUse = true;
  validateCredentials(config);

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const origin = new URL(baseUrl).origin;
  const timeout = getTimeout(config);
  const chromium = config.chromium || getPlaywrightChromium();

  const usePersistentContext =
    String(
      process.env.ECURO_USE_PERSISTENT_CONTEXT || 'false'
    ).toLowerCase() === 'true';

  const authFailures = [];

  let browser = null;
  let context = null;
  let page = null;
  let closed = false;

  const close = async () => {
    if (closed) return;

    closed = true;

    await context?.close().catch(() => null);
    await browser?.close().catch(() => null);

    sessionInUse = false;
  };

  try {
    const contextOptions = {
      headless: config.headless !== false,
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
      },
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage'
      ]
    };

    if (usePersistentContext) {
      const profileDir = path.resolve(
        config.profileDir
          || process.env.ECURO_BROWSER_PROFILE_DIR
          || path.join(process.cwd(), 'runtime', 'ecuro-profile')
      );

      fs.mkdirSync(profileDir, { recursive: true });

      context = await chromium.launchPersistentContext(
        profileDir,
        contextOptions
      );

      browser = context.browser();

      page = context.pages()[0] || await context.newPage();
    } else {
      browser = await chromium.launch({
        headless: contextOptions.headless,
        args: contextOptions.args
      });

      const {
        headless,
        args,
        ...newContextOptions
      } = contextOptions;

      context = await browser.newContext(
        newContextOptions
      );

      page = await context.newPage();
    }

    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);

    page.on('response', (response) => {
      const status = response.status();

      if (status !== 401 && status !== 403) {
        return;
      }

      let responseOrigin = '';

      try {
        responseOrigin = new URL(response.url()).origin;
      } catch (_error) {
        return;
      }

      if (responseOrigin !== origin) {
        return;
      }

      const failure = {
        status,
        url: response.url(),
        at: new Date().toISOString()
      };

      authFailures.push(failure);

      console.error(
        `ECURO_AUTH_HTTP_FAILURE `
        + `status=${status} url=${response.url()}`
      );
    });

    page.on('pageerror', (error) => {
      console.error(
        `ECURO_PAGE_ERROR message=${error.message}`
      );
    });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        console.error(
          `ECURO_BROWSER_CONSOLE_ERROR text=${message.text()}`
        );
      }
    });

    await ensureEcuroApplicationLogin(
      page,
      {
        ...config,
        baseUrl,
        authFailures
      }
    );

    return {
      browser,
      context,
      page,
      authFailures,
      close
    };
  } catch (error) {
    await captureDiagnostic(
      page || {
        url: () => '',
        locator: () => ({
          innerText: async () => ''
        }),
        screenshot: async () => null
      },
      config,
      'authentication-failed',
      {
        error: error.message,
        code: error.code || null,
        authFailures
      }
    ).catch(() => null);

    await close();

    throw error;
  }
}

module.exports = {
  createAuthenticatedEcuroSession,
  ensureEcuroApplicationLogin
};
