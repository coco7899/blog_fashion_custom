// 커스텀 사본 전용 실행 파일 — 원본(3000)과 동시에 띄우기 위해 기본 포트를 3001로 둔다.
// 필요하면  PORT 환경변수로 덮어쓸 수 있다.  예) PORT=3005 node server-custom.js
process.env.PORT = process.env.PORT || '3001';
require('./server.js');
