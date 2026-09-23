const test = require('node:test');
const assert = require('node:assert/strict');
const codex = require('../src/codex');
const writer = require('../src/writer');

test('long and filler product titles are rejected while a short search title passes', () => {
  assert.equal(writer.productTitleIssue('불스원 EZ클린 TPE 카매트, 세척법과 차종 선택'), null);
  assert.equal(writer.productTitleIssue('코일매트를 아무리 털어도 작은 돌이 남는다면? 불스원 EZ클린 TPE 카매트 살펴봤어요'), '제목 길이');
  assert.equal(writer.productTitleIssue('불스원 카매트 살펴봤어요'), '빈 설명 표현');
  assert.equal(writer.productTitleIssue('불스원 카매트 관리', 'TPE 카매트'), '지정 키워드 누락');
  assert.equal(writer.productTitleIssue('정확히 검색할 모델명이 매우 긴 제품 ABCDEFGHIJKLMNOPQRSTUVWXYZ, 크기 선택', '정확히 검색할 모델명이 매우 긴 제품 ABCDEFGHIJKLMNOPQRSTUVWXYZ'), null);
});

test('title suggestions retry once when long and keep user keyword', async () => {
  const original = codex.invokeJson;
  const base = { concern:'청소가 번거로움', situation:'차 안 청소', purchaseReason:'물로 씻을 수 있음', angle:'관리법', keywords:[] };
  let calls = 0;
  codex.invokeJson = async prompt => {
    calls++;
    assert.match(prompt, /상품명·제품군 \+ 궁금한 점 하나/);
    const titles = calls === 1
      ? Array(4).fill('코일매트를 아무리 털어도 작은 돌이 남는다면? 불스원 EZ클린 TPE 카매트 살펴봤어요')
      : ['불스원 TPE 카매트, 코일매트 청소 대안', '불스원 TPE 카매트, 차종 고르는 법', '불스원 TPE 카매트, 물세척은 어떻게?', '불스원 TPE 카매트, 관리법과 호환'];
    return { recommendedIndex: 3, choices: titles.map(title => ({ ...base, title })) };
  };
  try {
    const result = await writer.suggestProductHooks({name:'불스원 EZ클린 TPE 카매트',query:'카매트'}, {description:'TPE, 물세척, 차량별 옵션'});
    assert.equal(calls, 2);
    assert.equal(result.choices.length, 4);
    assert.equal(result.recommendedIndex, 3);
    assert.ok(result.choices.every(choice => !writer.productTitleIssue(choice.title)));
  } finally { codex.invokeJson = original; }
});
