const test = require('node:test');
const assert = require('node:assert/strict');
const writer = require('../src/writer');

const product = { name: '불스원 EZ클린 TPE 카매트' };

test('legacy product info heading becomes just the product name', () => {
  const article = {
    title: '불스원 카매트 관리법',
    blocks: [
      { type: 'image', slot: 1 },
      { type: 'paragraph', text: '도입 하나' },
      { type: 'paragraph', text: '도입 둘' },
      { type: 'heading', text: '한눈에 보는 상품 스펙' },
      { type: 'quote', text: '불스원 EZ클린 TPE 카매트 한눈에 보는 상품 스펙\n· 소재: TPE\n· 구매 이유: 청소가 편해서' },
    ],
  };
  writer.sanitizeProductArticle(
    writer.preservePurchaseReasonContext(writer.enforceSpecQuote(article, product), '청소가 편해서'),
    product
  );
  assert.equal(article.blocks.some(block => /한눈에\s*보는\s*상품\s*스펙/.test(block.text || '')), false);
  assert.equal(article.blocks.some(block => block.type === 'heading' && !block.text), false);
  const info = article.blocks.find(block => block.type === 'quote' && block.spec);
  assert.equal(info.text, '불스원 EZ클린 TPE 카매트\n· 소재: TPE');
});

test('missing product info never inserts the old heading', () => {
  const article = { title: '불스원 카매트 관리법', blocks: [{ type: 'paragraph', text: '도입' }] };
  writer.sanitizeProductArticle(writer.enforceSpecQuote(article, product), product);
  const info = article.blocks.find(block => block.type === 'quote' && block.spec);
  assert.equal(info.text, '불스원 EZ클린 TPE 카매트');
});
