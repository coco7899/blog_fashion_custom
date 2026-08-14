// 티스토리 로그인: 사용자가 카카오 로그인 창에서 직접 인증하면 세션을 로컬에 저장한다.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');
const browserHelper = require('./browser');
const store = require('./store');

const STATE_PATH = path.join(store.SESSION_DIR, 'tistory-state.json');
const PROFILE_PATH = path.join(store.SESSION_DIR, 'tistory-profile.json');

let loginInProgress = false;
let lastLoginError = null;
let lastVerify = null;

function showLoginWindow() {
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const script = path.join(__dirname, 'show-login-window.ps1');
  execFile(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: true },
    (error) => {
      if (error) console.log('[tistory-login] 로그인 창 앞으로 가져오기 실패:', error.message.split('\n')[0]);
    }
  );
}

function hasState() {
  const state = store.readJson(STATE_PATH);
  return Boolean(state && Array.isArray(state.cookies) && state.cookies.length);
}

function normalizeBlogProfile(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/(?:https?:\/\/)?([a-z0-9-]+)\.tistory\.com/i);
  if (!match) return null;
  return {
    blogName: match[1],
    blogUrl: `https://${match[1]}.tistory.com`,
  };
}

function configuredBlogProfile() {
  return normalizeBlogProfile(
    process.env.TISTORY_BLOG_URL || process.env.TISTORY_BLOG_NAME || 'https://lalachocho.tistory.com'
  );
}

function getProfile() {
  const saved = store.readJson(PROFILE_PATH, {});
  const savedProfile = normalizeBlogProfile(saved.blogUrl || (saved.blogName ? `${saved.blogName}.tistory.com` : ''));
  if (savedProfile) return { ...saved, ...savedProfile };
  return configuredBlogProfile() || {};
}

async function discoverBlog(page) {
  const configured = configuredBlogProfile();
  if (configured) return configured;

  const saved = getProfile();
  if (saved.blogName) {
    const savedProfile = normalizeBlogProfile(saved.blogUrl || `${saved.blogName}.tistory.com`);
    if (savedProfile) return savedProfile;
  }

  const candidates = [
    'https://www.tistory.com/manage',
    'https://www.tistory.com/member/blog',
    'https://www.tistory.com/',
  ];
  for (const url of candidates) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});

    const fromUrl = normalizeBlogProfile(page.url());
    if (fromUrl) return fromUrl;

    const hrefs = await page
      .locator('a[href*=".tistory.com"]')
      .evaluateAll((links) => links.map((link) => link.href).filter(Boolean))
      .catch(() => []);
    const preferred = hrefs.find((href) => /\.tistory\.com\/manage(?:\/|$)/i.test(href));
    const profile = normalizeBlogProfile(preferred || hrefs[0]);
    if (profile) return profile;
  }
  return null;
}

async function persistState(context) {
  const state = await context.storageState();
  if (!state || !Array.isArray(state.cookies) || state.cookies.length === 0) {
    throw new Error('티스토리 로그인 쿠키가 만들어지지 않았습니다.');
  }
  store.writeJson(STATE_PATH, state);
  return state.cookies.length;
}

async function startLogin() {
  if (loginInProgress) return { ok: false, error: '이미 로그인 창이 열려 있습니다.' };
  loginInProgress = true;
  lastLoginError = null;
  let browser;
  try {
    browser = await browserHelper.launch({ headless: false, args: ['--window-size=980,820'] });
    const context = await browser.newContext({ viewport: { width: 960, height: 780 } });
    const page = await context.newPage();
    await page.bringToFront().catch(() => {});
    try {
      await page.goto('https://www.tistory.com/auth/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } catch (error) {
      const reason = error.message.split('\n')[0];
      console.error('[tistory-login] 로그인 페이지 연결 실패:', reason);
      throw new Error(`티스토리 로그인 페이지에 연결하지 못했습니다: ${reason}`);
    }
    showLoginWindow();

    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      if (page.isClosed()) {
        lastLoginError = '로그인 창이 닫혔습니다. 다시 시도해주세요.';
        return { ok: false, error: lastLoginError };
      }
      const currentUrl = page.url();
      const leftLoginPage = /^https:\/\/([a-z0-9-]+\.)?tistory\.com\//i.test(currentUrl) &&
        !/tistory\.com\/auth\/login/i.test(currentUrl);
      if (leftLoginPage) {
        const profile = await discoverBlog(page);
        if (profile) {
          const writeUrl = `${profile.blogUrl}/manage/newpost/?type=post&returnURL=%2Fmanage%2Fposts%2F`;
          await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(1000);
          const editorReady = await page.locator('#post-title-inp').isVisible().catch(() => false);
          if (!editorReady) {
            console.log('[tistory-login] 로그인 후 편집기 권한 확인 대기:', page.url());
            await page.waitForTimeout(1000).catch(() => {});
            continue;
          }
          const cookieCount = await persistState(context);
          store.writeJson(PROFILE_PATH, { ...profile, verifiedAt: new Date().toISOString() });
          console.log(`[tistory-login] 편집기 접근 및 세션 저장 완료(쿠키 ${cookieCount}개)`);
          lastVerify = null;
          return { ok: true, ...profile };
        }
      }
      await page.waitForTimeout(1000).catch(() => {});
    }
    lastLoginError = '5분 안에 티스토리 로그인이 완료되지 않았습니다.';
    return { ok: false, error: lastLoginError };
  } catch (error) {
    lastLoginError = error.message.split('\n')[0];
    return { ok: false, error: lastLoginError };
  } finally {
    loginInProgress = false;
    if (browser) await browser.close().catch(() => {});
  }
}

async function verify(force = false) {
  if (!hasState()) return { loggedIn: false, ...getProfile(), inProgress: loginInProgress };
  if (!force && lastVerify && Date.now() - lastVerify.at < 10 * 60 * 1000) {
    return { ...lastVerify.result, inProgress: loginInProgress };
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: STATE_PATH });
    const page = await context.newPage();
    const profile = await discoverBlog(page);
    const url = page.url();
    if (!profile || /tistory\.com\/auth\/login|accounts\.kakao\.com\/login/i.test(url)) {
      const result = { loggedIn: false, expired: true };
      lastVerify = { at: Date.now(), result };
      return { ...result, inProgress: loginInProgress };
    }

    const writeUrl = `${profile.blogUrl}/manage/newpost/?type=post&returnURL=%2Fmanage%2Fposts%2F`;
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
    const loggedIn = await page.locator('#post-title-inp').isVisible().catch(() => false);
    const result = loggedIn
      ? { loggedIn: true, ...profile }
      : { loggedIn: false, expired: /auth\/login|accounts\.kakao\.com/i.test(page.url()) };
    if (loggedIn) {
      store.writeJson(PROFILE_PATH, { ...profile, verifiedAt: new Date().toISOString() });
      await persistState(context);
    }
    lastVerify = { at: Date.now(), result };
    return { ...result, inProgress: loginInProgress };
  } catch (error) {
    const profile = getProfile();
    return {
      loggedIn: false,
      ...profile,
      warn: error.message,
      inProgress: loginInProgress,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function logout() {
  try { fs.unlinkSync(STATE_PATH); } catch {}
  try { fs.unlinkSync(PROFILE_PATH); } catch {}
  lastVerify = null;
}

module.exports = {
  STATE_PATH,
  hasState,
  startLogin,
  verify,
  logout,
  getProfile,
  persistState,
  isLoginInProgress: () => loginInProgress,
  getLastLoginError: () => lastLoginError,
  _internals: { normalizeBlogProfile, configuredBlogProfile },
};
