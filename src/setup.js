// 실행 환경 점검: Playwright Chromium / Codex CLI 설치 확인 및 자동 설치
const fs = require('fs');
const { spawnSync } = require('child_process');
const codex = require('./codex');

let cachedCheck = null;

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

function checkAll(force = false) {
  // 대시보드가 상태를 주기적으로 확인할 때마다 Codex CLI를 새 프로세스로 실행하면
  // 요청이 겹쳐 사이트 전체가 느려질 수 있다. 서버 시작 때 확인한 결과를 재사용한다.
  if (!force && cachedCheck) return cachedCheck;
  cachedCheck = {
    chromium: chromiumInstalled(),
    codex: codex.checkCli(),
  };
  return cachedCheck;
}

module.exports = { ensureChromium, chromiumInstalled, checkAll };
