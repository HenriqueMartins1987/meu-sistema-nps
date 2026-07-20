const test = require('node:test');
const assert = require('node:assert/strict');

const { createAuthenticatedEcuroSession } = require('../services/ecuroBrowserSession');

function createResponse(status = 200) {
  return {
    status: () => status
  };
}

class FakeLocator {
  constructor(page, selector) {
    this.page = page;
    this.selector = selector;
  }

  first() {
    return this;
  }

  async isVisible() {
    const selector = this.selector.toLowerCase();
    if (selector.includes('password')) return this.page.currentUrl.includes('/login');
    if (selector.includes('button') || selector.includes('submit')) return this.page.currentUrl.includes('/login');
    if (selector.includes('username') || selector.includes('usuario') || selector.includes('login') || selector.includes('email') || selector.includes('type=text')) {
      return this.page.currentUrl.includes('/login');
    }
    return false;
  }

  async fill(value) {
    this.page.filled[this.selector] = value;
  }

  async click() {
    this.page.submitAttempts += 1;
  }

  async press(key) {
    this.page.pressedKeys.push(key);
  }
}

class FakePage {
  constructor(scenario = {}) {
    this.scenario = scenario;
    this.currentUrl = '';
    this.titleValue = scenario.title || '';
    this.filled = {};
    this.submitAttempts = 0;
    this.pressedKeys = [];
    this.defaultTimeout = null;
    this.defaultNavigationTimeout = null;
  }

  setDefaultTimeout(value) {
    this.defaultTimeout = value;
  }

  setDefaultNavigationTimeout(value) {
    this.defaultNavigationTimeout = value;
  }

  on() {}

  async waitForTimeout() {}

  async goto(url) {
    const baseUrl = this.scenario.baseUrl || 'https://ecuro.com.br';
    if (url === baseUrl) {
      this.currentUrl = this.scenario.initialUrl || `${baseUrl}/login`;
      this.titleValue = this.scenario.initialTitle || '';
      return createResponse(this.scenario.initialStatus || 200);
    }

    if (url.endsWith('/dashboard/overview')) {
      this.currentUrl = this.scenario.forceLoginOnDashboard ? `${baseUrl}/login` : url;
      this.titleValue = this.scenario.overviewTitle || '';
      return createResponse(this.scenario.overviewStatus || 200);
    }

    if (url.endsWith('/dashboard/patients')) {
      this.currentUrl = this.scenario.forceLoginOnDashboard ? `${baseUrl}/login` : url;
      this.titleValue = this.scenario.patientsTitle || '';
      return createResponse(this.scenario.patientsStatus || 200);
    }

    this.currentUrl = url;
    return createResponse(200);
  }

  async title() {
    return this.titleValue;
  }

  url() {
    return this.currentUrl;
  }

  locator(selector) {
    return new FakeLocator(this, selector);
  }

  async waitForURL(predicate) {
    if (this.scenario.staysOnLogin) {
      throw new Error('Timeout waiting for dashboard');
    }
    const baseUrl = this.scenario.baseUrl || 'https://ecuro.com.br';
    this.currentUrl = `${baseUrl}/dashboard/overview`;
    if (typeof predicate === 'function' && !predicate(this.currentUrl)) {
      throw new Error('Dashboard URL predicate did not match');
    }
  }
}

function createFakeChromium(scenario = {}) {
  const state = {
    launchOptions: null,
    contextOptions: null,
    routePattern: null,
    routeHandler: null,
    browserClosed: false,
    contextClosed: false,
    browserCloseCount: 0,
    contextCloseCount: 0,
    page: null
  };

  const chromium = {
    launch: async (options) => {
      state.launchOptions = options;
      return {
        on: () => {},
        newContext: async (contextOptions) => {
          state.contextOptions = contextOptions;
          return {
            route: async (pattern, handler) => {
              state.routePattern = pattern;
              state.routeHandler = handler;
            },
            newPage: async () => {
              state.page = new FakePage(scenario);
              return state.page;
            },
            close: async () => {
              state.contextCloseCount += 1;
              state.contextClosed = true;
            }
          };
        },
        close: async () => {
          state.browserCloseCount += 1;
          state.browserClosed = true;
        }
      };
    }
  };

  return { chromium, state };
}

function buildConfig(overrides = {}, scenario = {}) {
  const fake = createFakeChromium(scenario);
  return {
    baseUrl: 'https://ecuro.com.br',
    level1Username: 'level1-user',
    level1Password: 'level1-pass',
    level2Username: 'level2-user',
    level2Password: 'level2-pass',
    headless: true,
    timeoutMs: 1000,
    chromium: fake.chromium,
    fakeState: fake.state,
    ...overrides
  };
}

test('createAuthenticatedEcuroSession fails clearly when LEVEL1 is missing', async () => {
  const config = buildConfig({ level1Username: '' });
  await assert.rejects(
    () => createAuthenticatedEcuroSession(config),
    /EXTERNAL_PORTAL_LEVEL1_USERNAME/
  );
  assert.equal(config.fakeState.launchOptions, null);
});

test('createAuthenticatedEcuroSession fails clearly when LEVEL2 is missing', async () => {
  const config = buildConfig({ level2Password: '' });
  await assert.rejects(
    () => createAuthenticatedEcuroSession(config),
    /EXTERNAL_PORTAL_LEVEL2_PASSWORD/
  );
  assert.equal(config.fakeState.launchOptions, null);
});

test('createAuthenticatedEcuroSession fails on HTTP 401', async () => {
  const config = buildConfig({}, { initialStatus: 401 });
  await assert.rejects(
    () => createAuthenticatedEcuroSession(config),
    /HTTP 401/
  );
  assert.equal(config.fakeState.browserClosed, true);
});

test('createAuthenticatedEcuroSession fails on HTTP 403', async () => {
  const config = buildConfig({}, { initialStatus: 403 });
  await assert.rejects(
    () => createAuthenticatedEcuroSession(config),
    /HTTP 403/
  );
  assert.equal(config.fakeState.browserClosed, true);
});

test('createAuthenticatedEcuroSession fails when form remains on login after submit', async () => {
  const config = buildConfig({}, { staysOnLogin: true });
  await assert.rejects(
    () => createAuthenticatedEcuroSession(config),
    /remained on \/login/
  );
  assert.equal(config.fakeState.browserClosed, true);
});

test('createAuthenticatedEcuroSession succeeds when dashboard patients returns HTTP 200', async () => {
  const config = buildConfig();
  const session = await createAuthenticatedEcuroSession(config);

  assert.equal(session.page.url(), 'https://ecuro.com.br/dashboard/patients');
  assert.equal(config.fakeState.contextOptions.acceptDownloads, true);
  assert.equal(config.fakeState.contextOptions.httpCredentials.origin, 'https://ecuro.com.br');
  assert.equal(config.fakeState.contextOptions.httpCredentials.username, 'level1-user');
  assert.equal(config.fakeState.routePattern, '**/*');
  assert.equal(config.fakeState.page.defaultTimeout, 1000);

  await session.close();
  assert.equal(config.fakeState.contextClosed, true);
  assert.equal(config.fakeState.browserClosed, true);
});

test('createAuthenticatedEcuroSession adds Basic Authorization only to Ecuro origin', async () => {
  const config = buildConfig();
  const session = await createAuthenticatedEcuroSession(config);
  let thirdPartyContinuePayload = 'not-called';
  let ecuroContinuePayload = null;

  await config.fakeState.routeHandler({
    request: () => ({
      url: () => 'https://cdn.example.test/app.js',
      headers: () => ({ Accept: 'text/javascript' })
    }),
    continue: async (payload) => {
      thirdPartyContinuePayload = payload;
    }
  });

  await config.fakeState.routeHandler({
    request: () => ({
      url: () => 'https://ecuro.com.br/api/patients',
      headers: () => ({ Accept: 'application/json' })
    }),
    continue: async (payload) => {
      ecuroContinuePayload = payload;
    }
  });

  assert.equal(thirdPartyContinuePayload, undefined);
  assert.match(ecuroContinuePayload.headers.Authorization, /^Basic /);
  assert.equal(ecuroContinuePayload.headers.Accept, 'application/json');

  await session.close();
});

test('createAuthenticatedEcuroSession close is safe and idempotent', async () => {
  const config = buildConfig();
  const session = await createAuthenticatedEcuroSession(config);

  await session.close();
  await session.close();

  assert.equal(config.fakeState.contextClosed, true);
  assert.equal(config.fakeState.browserClosed, true);
  assert.equal(config.fakeState.contextCloseCount, 1);
  assert.equal(config.fakeState.browserCloseCount, 1);
});
