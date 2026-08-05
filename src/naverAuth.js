// 네이버 로그인: headed 브라우저에서 사용자가 직접 로그인 → 세션(storageState) 로컬 저장
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');
const browserHelper = require('./browser');
const store = require('./store');

const STATE_PATH = path.join(store.SESSION_DIR, 'naver-state.json');
const PROFILE_PATH = path.join(store.SESSION_DIR, 'profile.json');

let loginInProgress = false;
let lastLoginError = null;
let lastVerify = null; // { at, result }

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
      if (error) console.log('[login] 로그인 창 앞으로 가져오기 실패:', error.message.split('\n')[0]);
    }
  );
}

function hasState() {
  const state = store.readJson(STATE_PATH);
  if (!state || !Array.isArray(state.cookies)) return false;
  return state.cookies.some((c) => c.name === 'NID_AUT');
}

function getProfile() {
  return store.readJson(PROFILE_PATH, {});
}

/**
 * 로그인 브라우저 창을 띄우고 사용자가 로그인을 마칠 때까지 대기(최대 5분).
 * NID_AUT 쿠키가 생기면 storageState 저장.
 */
async function startLogin() {
  if (loginInProgress) return { ok: false, error: '이미 로그인 창이 열려 있습니다.' };
  loginInProgress = true;
  lastLoginError = null;
  let browser;
  try {
    browser = await browserHelper.launch({ headless: false, args: ['--window-size=900,800'] });
    const context = await browser.newContext({ viewport: { width: 880, height: 760 } });
    const page = await context.newPage();
    await page.bringToFront().catch(() => {});
    // 로딩이 느려도 창은 떠 있으므로 실패해도 계속 진행 (쿠키 폴링이 로그인을 감지)
    await page
      .goto('https://nid.naver.com/nidlogin.login?mode=form&url=https://www.naver.com', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      .catch((e) => console.log('[login] 로그인 페이지 로딩 지연:', e.message.split('\n')[0]));
    showLoginWindow();

    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      let cookies;
      try {
        cookies = await context.cookies();
      } catch {
        lastLoginError = '로그인 창이 닫혔습니다. 다시 시도해주세요.';
        return { ok: false, error: lastLoginError };
      }
      if (cookies.some((c) => c.name === 'NID_AUT')) {
        await context.storageState({ path: STATE_PATH });
        lastVerify = null;
        return { ok: true };
      }
      try {
        await page.waitForTimeout(1000);
      } catch {
        // 페이지가 닫혀도 컨텍스트가 살아있으면 쿠키 폴링 계속
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    lastLoginError = '5분 안에 로그인이 완료되지 않았습니다.';
    return { ok: false, error: lastLoginError };
  } catch (e) {
    lastLoginError = '로그인 브라우저 실행 실패: ' + e.message.split('\n')[0];
    return { ok: false, error: lastLoginError };
  } finally {
    loginInProgress = false;
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * 저장된 세션이 실제로 유효한지 headless로 확인하고 블로그 ID를 알아낸다.
 * GoBlogWrite.naver 는 로그인 상태면 자기 블로그 글쓰기 URL로 리다이렉트된다.
 */
async function verify(force = false) {
  if (!hasState()) return { loggedIn: false, inProgress: loginInProgress };
  if (!force && lastVerify && Date.now() - lastVerify.at < 10 * 60 * 1000) {
    return { ...lastVerify.result, inProgress: loginInProgress };
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: STATE_PATH });
    const page = await context.newPage();
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(1500);
    await persistState(context); // 갱신된 쿠키 저장 (세션 연장)
    const url = page.url();
    let result;
    const m = url.match(/blog\.naver\.com\/([^/?#]+)\?Redirect=Write/i);
    if (m) {
      store.writeJson(PROFILE_PATH, { blogId: m[1], verifiedAt: new Date().toISOString() });
      result = { loggedIn: true, blogId: m[1] };
    } else if (/nid\.naver\.com/.test(url)) {
      result = { loggedIn: false, expired: true };
    } else {
      // 판별 불가 — 세션 파일 기준으로 낙관적 판단
      result = { loggedIn: true, blogId: getProfile().blogId || null };
    }
    lastVerify = { at: Date.now(), result };
    return { ...result, inProgress: loginInProgress };
  } catch (e) {
    return { loggedIn: hasState(), blogId: getProfile().blogId || null, warn: e.message, inProgress: loginInProgress };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * 브라우저 컨텍스트 사용 후 갱신된 쿠키를 다시 저장해 세션 수명을 연장한다.
 * (정적 storageState만 재사용하면 단기 쿠키가 만료돼 로그인이 자주 풀림)
 */
async function persistState(context) {
  try {
    await context.storageState({ path: STATE_PATH });
  } catch {}
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
};
