// 커스텀 사본(블로그 자동화 + 숏폼) 전용 실행 파일.
// 3000=원본 블로그, 3001~30xx=상세페이지 자동화(Next.js가 위로 자동 잠식)와 겹치지 않도록
// 기본 포트를 4000으로 둔다. 필요하면 PORT 환경변수로 덮어쓸 수 있다. 예) PORT=4005 node server-custom.js
const path = require('path');

process.env.PORT = process.env.PORT || '4000';
// Git 저장소 밖의 형제 폴더에 작업 이력을 보관한다.
// 필요하면 BLOG_FASHION_DATA_DIR 환경변수로 다른 위치를 지정할 수 있다.
process.env.BLOG_FASHION_DATA_DIR =
  process.env.BLOG_FASHION_DATA_DIR || path.join(__dirname, '..', 'blog_fashion_data');
require('./server.js');
