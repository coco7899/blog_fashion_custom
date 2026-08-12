// 커스텀 사본(블로그 자동화 + 숏폼) 전용 실행 파일.
// 3000=원본 블로그, 3001~30xx=상세페이지 자동화(Next.js가 위로 자동 잠식)와 겹치지 않도록
// 기본 포트를 4000으로 둔다. 필요하면 PORT 환경변수로 덮어쓸 수 있다. 예) PORT=4005 node server-custom.js
const fs = require('fs');
const path = require('path');
const util = require('util');

// 자동 실행 상태에서도 오류 원인을 확인할 수 있도록 서버 로그를 파일에 남긴다.
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const SILENT_CONSOLE = process.env.BLOG_FASHION_SILENT === '1';
fs.mkdirSync(LOG_DIR, { recursive: true });
try {
  if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
    fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'server.previous.log'));
  }
} catch {}

for (const level of ['log', 'error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    if (!SILENT_CONSOLE) original(...args);
    try {
      fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${level}] ${util.format(...args)}\n`, 'utf8');
    } catch {}
  };
}

process.on('unhandledRejection', (reason) => {
  console.error('[process] 처리되지 않은 비동기 오류:', reason && reason.stack ? reason.stack : reason);
});

process.on('uncaughtException', (error) => {
  console.error('[process] 서버를 종료시킨 오류:', error && error.stack ? error.stack : error);
  // 손상된 상태로 계속 실행하지 않고 종료해 예약 작업의 자동 재시작을 사용한다.
  setTimeout(() => process.exit(1), 100);
});

process.env.PORT = process.env.PORT || '4000';

// 4000(연예·쇼핑커넥트) 앱은 건강 블로그와 코드 저장소를 공유하더라도
// 작업 이력, 검색 결과, 초안, 네이버 세션을 절대 같은 폴더에 저장하지 않는다.
// 범용 BLOG_FASHION_DATA_DIR 값은 의도치 않은 교차 연결을 만들 수 있으므로
// 이 진입점에서는 4000 전용 환경변수만 허용하고 내부 저장 경로를 강제로 고정한다.
const DATA_PROFILE = 'fashion-custom-4000';
const DATA_DIR = path.resolve(
  process.env.BLOG_FASHION_4000_DATA_DIR ||
    path.join(__dirname, '..', 'blog_fashion_custom_4000_data')
);
const DATA_PROFILE_FILE = path.join(DATA_DIR, '.app-profile.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (fs.existsSync(DATA_PROFILE_FILE)) {
  const savedProfile = JSON.parse(fs.readFileSync(DATA_PROFILE_FILE, 'utf8'));
  if (savedProfile.profile !== DATA_PROFILE) {
    throw new Error(`4000 전용 데이터 폴더가 아닙니다: ${DATA_DIR}`);
  }
} else {
  fs.writeFileSync(
    DATA_PROFILE_FILE,
    JSON.stringify({ profile: DATA_PROFILE, createdAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

process.env.BLOG_FASHION_DATA_DIR = DATA_DIR;
console.log(`[setup] 4000 전용 데이터 폴더: ${DATA_DIR}`);
require('./server.js');
