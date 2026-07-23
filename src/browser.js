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
      return await chromium.launch({ headless: false, channel, args });
    } catch (e) {
      lastErr = e;
      console.log(`[browser] ${channel || 'bundled chromium'} 실행 실패: ${e.message.split('\n')[0]}`);
    }
  }
  throw lastErr;
}

module.exports = { launch };
