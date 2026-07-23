// 실행 환경 점검: Playwright Chromium / claude CLI 설치 확인 및 자동 설치
const fs = require('fs');
const { spawnSync } = require('child_process');
const claude = require('./claude');

function chromiumInstalled() {
  try {
    const { chromium } = require('playwright');
    const p = chromium.executablePath();
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

async function ensureChromium() {
  if (chromiumInstalled()) return { ok: true };
  console.log('[setup] Playwright Chromium이 없어 설치를 시작합니다... (수 분 소요될 수 있음)');
  const r = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    stdio: 'inherit',
    shell: true,
    timeout: 10 * 60 * 1000,
  });
  if (r.status === 0 && chromiumInstalled()) {
    console.log('[setup] Chromium 설치 완료');
    return { ok: true };
  }
  return { ok: false, error: 'Chromium 자동 설치에 실패했습니다. 터미널에서 "npx playwright install chromium"을 직접 실행해주세요.' };
}

function checkAll() {
  return {
    chromium: chromiumInstalled(),
    claude: claude.checkCli(),
  };
}

module.exports = { ensureChromium, chromiumInstalled, checkAll };
