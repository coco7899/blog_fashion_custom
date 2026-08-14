const assert = require('assert');
const fs = require('fs');
const path = require('path');
const publisher = require('../src/publisher')._internals;
const auth = require('../src/tistoryAuth')._internals;
const brandconnect = require('../src/brandconnect');
const healthImages = require('../src/healthImages');
const writer = require('../src/writer');
const scheduler = require('../src/scheduler')._internals;

const article = {
  title: '테스트 제목',
  tags: ['건강 정보', '#생활건강'],
  blocks: [
    { type: 'heading', text: '소제목 <확인>' },
    { type: 'paragraph', text: '첫 줄\n둘째 줄 & 확인' },
    { type: 'quote', text: '핵심 문장' },
    { type: 'divider' },
    { type: 'heading', text: '마무리 정리' },
    { type: 'image', slot: 1, desc: '손 씻는 장면' },
  ],
};

const html = publisher.buildArticleHtml(article, [{ slot: 1, desc: '안전한 장면' }], {
  sources: [{ title: '기사', url: 'https://example.com/news' }],
  products: [{ name: '상품', image: 'https://shop-phinf.pstatic.net/product.jpg', price: '15900', link: 'https://naver.me/Test1234' }],
});

assert.match(html, /소제목 &lt;확인&gt;/);
assert.match(html, /<nav data-blog-toc="true"/);
assert.match(html, /href="#health-section-1"/);
assert.match(html, />목차</);
assert.match(html, /<h2 id="health-section-1"[^>]*>1\. 소제목 &lt;확인&gt;<\/h2>/);
assert.match(html, /첫 줄<br>둘째 줄 &amp; 확인/);
assert.match(html, /이미지 1 추천 장면/);
assert.match(html, /rel="nofollow sponsored noopener"/);
assert.match(html, /href="https:\/\/naver\.me\/Test1234"/);
assert.match(html, /내 생활에 정말 필요한 선택일까요\? 실제 구성과 현재 가격을 지금 확인해 보세요/);
assert.match(html, /data-ke-type="opengraph"/);
assert.match(html, /data-og-image="https:\/\/shop-phinf\.pstatic\.net\/product\.jpg"/);
assert.match(html, /<img src="https:\/\/shop-phinf\.pstatic\.net\/product\.jpg"/);
assert.match(html, /referrerpolicy="no-referrer"/);
assert.match(html, /15,900원 · 상품 상세 정보 보기/);
assert.doesNotMatch(html, /#건강정보|#생활건강/);
const signedImageCard = publisher.affiliateCardHtml({
  name: '서명 이미지 상품',
  image: 'https://blog.kakaocdn.net/img.png?credential=test&expires=123',
  link: 'https://naver.me/AbCd1234',
}, 1);
assert.match(signedImageCard, /credential=test&amp;expires=123/);
assert.doesNotMatch(signedImageCard, /&amp;amp;/);
assert.doesNotMatch(html, /추천 제휴상품 확인하기|참고 자료|https:\/\/example\.com\/news/);
assert.doesNotMatch(html, /javascript:/i);
assert.strictEqual((html.match(/nofollow sponsored noopener/g) || []).length, 1);
assert.ok(html.indexOf('data-blog-toc="true"') > html.indexOf('<b>'));
assert.ok(html.indexOf('data-ke-type="opengraph"') > html.lastIndexOf('마무리 정리'));

const sourceOnlyHtml = publisher.buildArticleHtml(article, [], {
  sources: [{ title: '공식 건강자료', url: 'https://example.com/health' }],
  products: [],
});
assert.doesNotMatch(sourceOnlyHtml, /참고 자료|공식 건강자료|example\.com\/health/);
assert.strictEqual(publisher.issuedAffiliateUrl('https://naver.me/AbCd1234'), 'https://naver.me/AbCd1234');
assert.strictEqual(publisher.issuedAffiliateUrl('https://example.com/product'), '');

assert.strictEqual(publisher.postIdFromUrl('https://sample.tistory.com/manage/newpost/123?type=post'), '123');
assert.strictEqual(publisher.postIdFromUrl('https://sample.tistory.com/456'), '456');
assert.strictEqual(publisher.postIdFromUrl('https://sample.tistory.com/hello'), null);

assert.deepStrictEqual(auth.normalizeBlogProfile('https://my-blog.tistory.com/manage'), {
  blogName: 'my-blog',
  blogUrl: 'https://my-blog.tistory.com',
});
assert.strictEqual(auth.normalizeBlogProfile('https://example.com'), null);
assert.deepStrictEqual(auth.configuredBlogProfile(), {
  blogName: 'lalachocho',
  blogUrl: 'https://lalachocho.tistory.com',
});

assert.strictEqual(brandconnect.CREATOR_ID, '981491868759168');
assert.match(healthImages.COVER_GRADIENT, /249,115,22/);
assert.match(healthImages.COVER_GRADIENT, /251,146,60,.08/);
assert.strictEqual(healthImages.COVER_STYLE_VERSION, 'orange-soft-v4');
assert.doesNotMatch(healthImages.COVER_GRADIENT, /(?:6,78,59|20,83,45|22,101,52)/);

const cleanedHealthArticle = writer.removeHealthBodyPromotions(
  writer.ensureKeySummary({
    blocks: [
      { type: 'paragraph', text: '아침 식사에서 단백질 식품을 나누어 먹는 방법을 설명합니다.' },
      { type: 'paragraph', text: '이 글에서 확인할 핵심 3가지\n1. 계산값 확인\n2. 식사 배분\n3. 주의 기준' },
      { type: 'heading', text: '식사 준비 부담을 줄이려면 무엇을 확인할까요?' },
      { type: 'paragraph', text: '별도 조리 없이 먹는 무가당 플레인 그릭요거트는 식품 후보입니다.' },
      { type: 'paragraph', text: '제품을 고를 때는 단백질 함량과 첨가당 여부를 확인하세요.' },
      { type: 'heading', text: '주의사항과 마무리' },
      { type: 'paragraph', text: '신장질환이 있다면 개인 상태에 맞는 섭취 기준을 확인하세요.' },
    ],
  }),
  { affiliateProduct: '무가당 플레인 그릭요거트' }
);
const cleanedHealthText = cleanedHealthArticle.blocks.map((block) => block.text || '').join(' ');
assert.doesNotMatch(cleanedHealthText, /이 글에서 확인할 핵심/);
assert.doesNotMatch(cleanedHealthText, /그릭요거트|제품을 고를 때|식사 준비 부담/);
assert.match(cleanedHealthText, /주의사항과 마무리/);

const dashboardScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const publisherSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'publisher.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const brandconnectSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'brandconnect.js'), 'utf8');
const pipelineSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pipeline.js'), 'utf8');
assert.match(dashboardScript, /btn-republish/);
assert.match(dashboardScript, />다시발행<\/button>/);
assert.match(dashboardScript, /retry-publish/);
assert.doesNotMatch(dashboardScript, /글 보기 →/);
assert.doesNotMatch(dashboardScript, /appendNewsRefs|참고한 건강 기사|선택 기준 확인하기/);
assert.match(dashboardScript, /내 생활에 정말 필요한 선택일까요/);
assert.match(dashboardScript, /nofollow sponsored noopener/);
assert.match(publisherSource, /data-codex-upload-marker/);
assert.match(publisherSource, /uploadedSources\.has\(uploadedSrc\)/);
assert.match(publisherSource, /uploadAffiliateThumbnails/);
assert.match(publisherSource, /affiliate-thumbnail-/);
assert.match(publisherSource, /fillTags\(page, article\.tags/);
assert.match(publisherSource, /setRepresentativeCover/);
assert.match(publisherSource, /오렌지 대표이미지를 티스토리 대표로 지정 중/);
assert.match(publisherSource, /representative_image_callback/);
assert.match(publisherSource, /mce-represent-image-btn/);
assert.match(publisherSource, /verifyRepresentativeCover/);
assert.match(publisherSource, /발행창의 대표이미지가 오렌지 대표이미지와 일치하지 않습니다/);
assert.match(pipelineSource, /representativeImageSet: Boolean\(result\.representativeImageSet\)/);
assert.match(serverSource, /insertCover: completeHealthImages/);
assert.match(serverSource, /strictImages: completeHealthImages/);

const continuousSettings = { minIntervalMin: 30, maxIntervalMin: 75 };
assert.strictEqual(scheduler.nextInterval(continuousSettings, () => 0), 30);
assert.strictEqual(scheduler.nextInterval(continuousSettings, () => 0.999999), 75);
assert.strictEqual(scheduler.normalizeCommand(' 시작 '), 'start');
assert.strictEqual(scheduler.normalizeCommand('중지'), 'stop');
assert.strictEqual(scheduler.normalizeCommand('아무거나'), null);
assert.match(serverSource, /\/api\/schedule\/control/);
assert.match(serverSource, /!d\.auto/);
assert.match(dashboardScript, /autoCommandInput/);
assert.match(dashboardScript, /refreshAutoPublishStatus/);
assert.match(brandconnectSource, /식품이나 건강기능식품을 우선하지 마세요/);
assert.match(brandconnectSource, /생활용품·주방도구·운동용품·수면환경용품/);
assert.match(brandconnectSource, /supplementFallbackKeywords/);
assert.match(brandconnectSource, /직접 매칭 상품이 쇼핑커넥트에 없을 때/);
assert.match(pipelineSource, /관련 건강식품·영양제를 찾는 중/);
assert.match(pipelineSource, /productPlan\?\.supplementFallbackKeywords/);

console.log('tistory unit tests passed');
