// 커스텀 사본(블로그 자동화 + 숏폼) 전용 실행 파일.
// 3000=원본 블로그, 3001~30xx=상세페이지 자동화(Next.js가 위로 자동 잠식)와 겹치지 않도록
// 기본 포트를 4000으로 둔다. 필요하면 PORT 환경변수로 덮어쓸 수 있다. 예) PORT=4005 node server-custom.js
process.env.PORT = process.env.PORT || '4000';
require('./server.js');
