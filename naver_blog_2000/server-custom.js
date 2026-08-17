// 네이버 건강블로그 자동화 + 숏폼 전용 실행 파일.
// 기본 포트는 2000이며 필요하면 PORT 환경변수로 덮어쓸 수 있다.
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

process.env.PORT = process.env.PORT || '2000';

// 다른 네이버 앱과 작업 이력, 검색 결과, 초안, 로그인 세션을 섞지 않는다.
const DATA_PROFILE = 'naver-health-blog-2000';
const NAVER_2000_DATA_DIR = path.resolve(
  process.env.NAVER_BLOG_2000_DATA_DIR || path.join(__dirname, '..', 'naver_blog_2000_data')
);
const DATA_PROFILE_FILE = path.join(NAVER_2000_DATA_DIR, '.app-profile.json');

fs.mkdirSync(NAVER_2000_DATA_DIR, { recursive: true });
if (fs.existsSync(DATA_PROFILE_FILE)) {
  const savedProfile = JSON.parse(fs.readFileSync(DATA_PROFILE_FILE, 'utf8'));
  if (savedProfile.profile !== DATA_PROFILE) {
    throw new Error(`2000 네이버 전용 데이터 폴더가 아닙니다: ${NAVER_2000_DATA_DIR}`);
  }
} else {
  fs.writeFileSync(
    DATA_PROFILE_FILE,
    JSON.stringify({ profile: DATA_PROFILE, createdAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

process.env.BLOG_FASHION_DATA_DIR = NAVER_2000_DATA_DIR;
console.log(`[setup] 2000 네이버 전용 데이터 폴더: ${NAVER_2000_DATA_DIR}`);
require('./server.js');
