const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyBodyBlocks } = require('../src/publisher');

function editorFrame(text) {
  return { locator: () => ({ allInnerTexts: async () => [text] }) };
}

const article = { blocks: [
  { type: 'paragraph', text: '도입 문단' },
  { type: 'image', slot: 1 },
  { type: 'heading', text: '클래파 청소기 요점정리' },
  { type: 'paragraph', text: '· 무선 스틱·핸디형 구조\n· **거치대 자동 먼지 비움**' },
] };

test('all preview text in order passes editor verification', async () => {
  await assert.doesNotReject(verifyBodyBlocks(
    editorFrame('도입 문단\n사진 설명\n클래파 청소기 요점정리\n· 무선 스틱·핸디형 구조\n· 거치대 자동 먼지 비움'),
    article
  ));
});

test('missing summary heading prevents an incomplete draft save', async () => {
  await assert.rejects(
    verifyBodyBlocks(editorFrame('도입 문단\n· 무선 스틱·핸디형 구조\n· 거치대 자동 먼지 비움'), article),
    /네이버 에디터 본문 누락: heading "클래파 청소기 요점정리"/
  );
});
