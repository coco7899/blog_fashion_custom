// 커스텀 사본(블로그 자동화 + 숏폼) 전용 실행 파일.
// 3000=원본 블로그, 3001~30xx=상세페이지 자동화(Next.js가 위로 자동 잠식)와 겹치지 않도록
// 이 건강 블로그 사본은 기본 포트 8000에서 실행한다. 필요하면 PORT 환경변수로 덮어쓸 수 있다.
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

process.env.PORT = process.env.PORT || '8000';

// 8000 건강 앱은 연예·쇼핑커넥트 앱과 작업 이력, 검색 결과, 초안,
// 네이버 세션을 절대 같은 폴더에 저장하지 않는다.
// 범용 BLOG_FASHION_DATA_DIR 값은 무시하고 건강 전용 환경변수만 허용한다.
const DATA_PROFILE = 'health-blog-8000';
const HEALTH_DATA_DIR = path.resolve(
  process.env.HEALTH_BLOG_DATA_DIR || path.join(__dirname, '..', 'health_blog_data')
);
const DATA_PROFILE_FILE = path.join(HEALTH_DATA_DIR, '.app-profile.json');

fs.mkdirSync(HEALTH_DATA_DIR, { recursive: true });
if (fs.existsSync(DATA_PROFILE_FILE)) {
  const savedProfile = JSON.parse(fs.readFileSync(DATA_PROFILE_FILE, 'utf8'));
  if (savedProfile.profile !== DATA_PROFILE) {
    throw new Error(`8000 건강 전용 데이터 폴더가 아닙니다: ${HEALTH_DATA_DIR}`);
  }
} else {
  fs.writeFileSync(
    DATA_PROFILE_FILE,
    JSON.stringify({ profile: DATA_PROFILE, createdAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

process.env.BLOG_FASHION_DATA_DIR = HEALTH_DATA_DIR;
console.log(`[setup] 8000 건강 전용 데이터 폴더: ${HEALTH_DATA_DIR}`);
require('./server.js');
