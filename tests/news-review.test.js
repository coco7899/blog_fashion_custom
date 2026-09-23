const assert = require('node:assert/strict');
const test = require('node:test');
const { inspectNewsArticle, formatNewsParagraphs } = require('../src/writer');

test('news review catches prediction wording across a mobile line break', () => {
  const article = { title: '작품 공개 소식', blocks: [
    { type: 'paragraph', text: `${'가'.repeat(24)} 흥행 성공이 예상돼요.` },
  ] };
  const issue = '흥행·관계·향후 전개 예측 표현 포함';
  assert.ok(inspectNewsArticle(article).includes(issue));
  const formatted = formatNewsParagraphs(structuredClone(article));
  assert.match(formatted.blocks.find((block) => block.text).text, /흥행\n성공/);
  assert.ok(inspectNewsArticle(formatted).includes(issue));
});

test('bold formatting does not conceal prediction wording', () => {
  const article = { title: '작품 공개 소식', blocks: [
    { type: 'paragraph', text: '흥행 **성공이** 예상돼요.' },
  ] };
  assert.ok(inspectNewsArticle(article).includes('흥행·관계·향후 전개 예측 표현 포함'));
});

test('news review rejects artificial choice commentary', () => {
  for (const text of ['가장 새로운 선택지예요.', '살펴볼 수 있어요.', '확인하면 돼요.', '이어질 차례예요.']) {
    const article = { title: '작품 공개 소식', blocks: [{ type: 'paragraph', text }] };
    assert.ok(inspectNewsArticle(article).includes('사람이 잘 쓰지 않는 선택·추천 해설 표현 포함'));
  }
});

test('news review rejects an intro that invents the reader reaction to a number', () => {
  const article = { title: '가게 운영 소식', blocks: [
    { type: 'paragraph', text: '월 매출 1억 4천만 원이라는\n숫자만 보면 가게가 순조롭게\n굴러갈 것처럼 느껴질 수 있어요.' },
  ] };
  assert.ok(inspectNewsArticle(article).includes('독자 반응을 추측하는 인위적인 서론 포함'));
});
