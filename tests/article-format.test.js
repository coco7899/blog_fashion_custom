const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_LINE_LENGTH, wrapText, formatArticle } = require('../public/article-format');

const graphemes = new Intl.Segmenter('ko', { granularity: 'grapheme' });
const visibleText = (text) => text.replace(/\*\*/g, '');
const visibleCharacters = (text) => Array.from(graphemes.segment(visibleText(text)), (part) => part.segment);

function assertMobileLines(text, maxLength = 28) {
  for (const line of text.split('\n')) {
    assert.ok(visibleCharacters(line).length <= maxLength, `Line exceeds ${maxLength} characters: ${line}`);
    assert.equal((line.match(/\*\*/g) || []).length % 2, 0, `Bold is not balanced on line: ${line}`);
  }
}

// Compare every displayed character and its emphasis, ignoring only whitespace
// that can move to the next line when a sentence wraps.
function styledCharacters(text) {
  let bold = false;
  const result = [];
  for (const part of text.split(/(\*\*)/)) {
    if (part === '**') {
      bold = !bold;
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      if (!/^\s+$/u.test(segment)) result.push({ text: segment, bold });
    }
  }
  assert.equal(bold, false, 'Input or output has an unclosed bold span');
  return result;
}

test('28 characters stay on one line; character 29 starts a new line without loss', () => {
  assert.equal(MAX_LINE_LENGTH, 28);
  const exact = '가'.repeat(28);
  assert.equal(wrapText(exact), exact);
  assert.equal(wrapText(`${exact}나`), `${exact}\n나`);
  assert.equal(wrapText(`${exact}나`, 100), `${exact}\n나`);
  assert.equal(wrapText('가'.repeat(13), 12), `${'가'.repeat(12)}\n가`);
});

test('sentences wrap at a word boundary while keeping all words', () => {
  const source = `${'가'.repeat(14)} ${'나'.repeat(14)} 다`;
  const actual = wrapText(source);
  assert.equal(actual, `${'가'.repeat(14)}\n${'나'.repeat(14)} 다`);
  assert.equal(actual.replace(/\s+/g, ' '), source);
  assertMobileLines(actual);
});

test('a long bold phrase keeps character-level emphasis across wrapped lines', () => {
  const source = `시작 **${'기억할말'.repeat(20)}** 뒤에는 보통 글씨예요.`;
  const actual = wrapText(source);
  assert.ok(actual.split('\n').length > 2);
  assertMobileLines(actual);
  assert.deepEqual(styledCharacters(actual), styledCharacters(source));
  assert.ok(actual.includes('**'), 'Emphasis must survive wrapping');
});

test('bold spanning explicit newlines and paragraphs is balanced on each output line', () => {
  const source = '첫 문장 **이 부분부터 강조하고\n다음 줄에도 강조를 이어가요.\n\n마지막 강조까지** 읽고 나면 보통 글씨예요.';
  const actual = wrapText(source);
  assert.ok(actual.includes('\n\n'), 'The paragraph break must remain');
  assertMobileLines(actual);
  assert.deepEqual(styledCharacters(actual), styledCharacters(source));
  for (const line of actual.split('\n')) {
    assert.doesNotThrow(() => styledCharacters(line), 'Each line must render independently');
  }
});

test('long strings without spaces are split without truncation', () => {
  const source = '넷플릭스'.repeat(23) + 'ABC0123456789'.repeat(4);
  const actual = wrapText(source);
  assertMobileLines(actual);
  assert.equal(actual.replace(/\n/g, ''), source);
});

test('emoji and combining sequences remain whole and count as displayed characters', () => {
  const family = '👨‍👩‍👧‍👦';
  const source = `${family.repeat(28)}👍🏽🇰🇷e\u0301`;
  const actual = wrapText(source);
  assert.equal(actual, `${family.repeat(28)}\n👍🏽🇰🇷e\u0301`);
  assertMobileLines(actual);
  assert.equal(actual.replace(/\n/g, ''), source);
});

test('explicit line breaks and empty paragraphs survive newline normalization', () => {
  const source = '첫 번째 줄이에요.\r\n둘째 줄도 그대로예요.\r\n\r\n새 문단이에요.\n\n\n마지막 문단이에요.';
  assert.equal(wrapText(source), source.replace(/\r\n/g, '\n'));
});

test('formatting an already wrapped draft does not change its text or emphasis', () => {
  const sources = [
    '한 줄은 짧게 읽히도록 하고 문장이 길면 어색하지 않은 띄어쓰기에서 다음 줄로 넘겨요.',
    `일반 문장 **${'굵게표시'.repeat(17)}** 다시 일반 문장`,
    '**강조한 첫 줄\n\n강조한 다음 줄**\n보통 문장',
    '👍🏽'.repeat(71),
  ];
  for (const source of sources) {
    const once = wrapText(source);
    assert.equal(wrapText(once), once);
    assertMobileLines(once);
    assert.deepEqual(styledCharacters(once), styledCharacters(source));
  }
});

test('article formatting preserves the exact title and metadata while wrapping every text and caption', () => {
  const title = '추석 연휴 넷플릭스 선택이 어렵다면, 9월 셋째 주 장르별 기대작부터';
  const longText = '연휴에 어떤 작품을 볼지 고민될 때 취향에 맞춰 하나씩 골라봐도 좋겠어요.';
  const source = {
    title,
    titleAlternatives: ['제목 대안'],
    tags: ['넷플릭스추천', '추석연휴볼거리'],
    frameKey: 'ott-guide',
    blocks: [
      { type: 'heading', text: longText },
      { type: 'paragraph', text: `${longText}\n\n**${longText}**` },
      { type: 'quote', text: longText },
      { type: 'image', slot: 1, caption: longText, desc: 'Image search context must remain unchanged.' },
      { type: 'divider' },
      { type: 'custom', text: longText, caption: longText, customData: { keep: true } },
    ],
  };
  const original = structuredClone(source);
  const actual = formatArticle(source);
  assert.equal(actual.title, title);
  assert.deepEqual(actual.titleAlternatives, source.titleAlternatives);
  assert.deepEqual(actual.tags, source.tags);
  assert.equal(actual.frameKey, source.frameKey);
  assert.equal(actual.blocks.length, source.blocks.length);
  for (let i = 0; i < actual.blocks.length; i++) {
    const block = actual.blocks[i];
    const input = source.blocks[i];
    assert.equal(block.type, input.type);
    for (const field of ['text', 'caption']) {
      if (typeof input[field] === 'string') {
        assertMobileLines(block[field]);
        assert.deepEqual(styledCharacters(block[field]), styledCharacters(input[field]));
      }
    }
  }
  assert.deepEqual(actual.blocks[3], { ...source.blocks[3], caption: wrapText(longText) });
  assert.deepEqual(actual.blocks[4], source.blocks[4]);
  assert.deepEqual(actual.blocks[5].customData, source.blocks[5].customData);
  assert.deepEqual(source, original, 'Formatting must not mutate the stored input');
  assert.deepEqual(formatArticle(actual), actual);
});
