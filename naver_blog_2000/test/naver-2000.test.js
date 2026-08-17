const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const serverCustom = read('server-custom.js');
const server = read('server.js');
const scheduler = read('src/scheduler.js');
const pipeline = read('src/pipeline.js');
const publisher = read('src/publisher.js');
const app = read('public/app.js');
const index = read('public/index.html');

assert.match(serverCustom, /process\.env\.PORT = process\.env\.PORT \|\| '2000'/);
assert.match(serverCustom, /naver-health-blog-2000/);
assert.match(serverCustom, /naver_blog_2000_data/);
assert.match(server, /require\('\.\/src\/naverAuth'\)/);
assert.doesNotMatch(server, /tistoryAuth/);
assert.match(server, /app\.post\('\/api\/schedule\/control'/);
assert.match(server, /const login = await auth\.verify\(\)/);
assert.match(server, /if \(!login\.loggedIn\)/);
assert.match(server, /status\(401\).*네이버 로그인이 필요합니다/s);
assert.match(scheduler, /require\('\.\/naverAuth'\)/);
assert.doesNotMatch(scheduler, /tistoryAuth/);
assert.match(publisher, /blog\.naver\.com|GoBlogWrite\.naver/);
assert.match(pipeline, /suggestHealthProductKeywords/);
assert.match(pipeline, /getBestProduct\(\{ keywords: \[keyword\] \}\)/);
assert.match(pipeline, /issueAffiliateLink\(candidate\.url\)/);
assert.match(pipeline, /for \(let index = 0; index < keywords\.length; index \+= 1\)/);
assert.match(pipeline, /fallbackUsed: selectedKeyword !== keywords\[0\]/);
assert.match(pipeline, /products: \[linkedProduct\]/);
assert.match(pipeline, /affiliateSelectionMode: affiliateProduct \? 'manual' : 'auto'/);
assert.doesNotMatch(pipeline, /상품 검색·제휴 링크 발급 없이/);
assert.match(publisher, /findBestShoppingConnectItem/);
assert.match(publisher, /searchKeyword, productName\.slice\(0, 36\)/);
assert.match(publisher, /insertedProductName = await insertShoppingConnectProduct\(frame, page, linkProducts\[0\]\)/);
assert.match(publisher, /await typeRich\(page, deferredCtaText\)/);
assert.match(publisher, /verifyConclusionBeforeProductCard/);
assert.match(publisher, /미리보기의 결론 문단 전체가 네이버 본문에 입력되지 않아 저장·발행을 중단했습니다/);
assert.match(index, /1순위 상품이 없으면 글과 관련된 2순위 상품군/);
assert.match(index, /네이버 · 2000/);
assert.match(index, /네이버 로그인/);
assert.doesNotMatch(index, /id="naverLoginBtn"/);
assert.doesNotMatch(app, /naverLoginBtn|naverLogoutBtn|naverSession/);
assert.doesNotMatch(`${index}\n${app}`, /티스토리/);

console.log('naver 2000 configuration tests passed');
