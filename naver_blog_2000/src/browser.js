// 브라우저 실행 헬퍼
// - headless 작업: 번들 Chromium(headless shell) 사용 — 문제 없음
// - headed(창 표시) 작업: 이 PC의 번들 chrome.exe가 SxS 오류로 실행 불가라서
//   시스템에 설치된 Chrome → Edge → 번들 Chromium 순으로 시도한다.
const { chromium } = require('playwright');

async function launch({ headless = true, args = [] } = {}) {
  if (headless) {
    return chromium.launch({ headless: true });
  }
  const channels = ['chrome', 'msedge', undefined]; // undefined = 번들 Chromium
  let lastErr;
  for (const channel of channels) {
    try {
      // 이 PC의 Chrome 자동 시작 설정이 --no-startup-window를 붙이면
      // 로그인 브라우저 프로세스만 생기고 실제 창은 보이지 않는다.
      // headed 로그인에서는 해당 기본 인자를 제외해 반드시 창을 표시한다.
      return await chromium.launch({
        headless: false,
        channel,
        args,
        ignoreDefaultArgs: ['--no-startup-window'],
      });
    } catch (e) {
      lastErr = e;
      console.log(`[browser] ${channel || 'bundled chromium'} 실행 실패: ${e.message.split('\n')[0]}`);
    }
  }
  throw lastErr;
}

module.exports = { launch };
