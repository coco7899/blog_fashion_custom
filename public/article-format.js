// 생성·미리보기·에디터에서 같은 모바일 줄바꿈을 사용한다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArticleFormat = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_LINE_LENGTH = 28;
  const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
  const characters = (text) => Array.from(segmenter.segment(text), (part) => part.segment);

  function renderLine(chars) {
    let bold = false;
    let result = '';
    for (const char of chars) {
      if (char.bold !== bold) { result += '**'; bold = char.bold; }
      result += char.text;
    }
    return result + (bold ? '**' : '');
  }

  function wrapText(value, requestedLimit = MAX_LINE_LENGTH) {
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(MAX_LINE_LENGTH, Math.floor(requestedLimit)))
      : MAX_LINE_LENGTH;
    let bold = false;
    const lines = [];
    // 명시한 문단/줄 경계는 유지하고, 긴 줄만 공백을 우선해 나눈다.
    for (const source of String(value ?? '').replace(/\r\n?/g, '\n').split('\n')) {
      const chars = [];
      for (const part of source.trim().replace(/[^\S\n]+/g, ' ').split(/(\*\*)/)) {
        if (part === '**') { bold = !bold; continue; }
        for (const text of characters(part)) chars.push({ text, bold });
      }
      if (!chars.length) { lines.push(''); continue; }
      let start = 0;
      while (start < chars.length) {
        while (chars[start]?.text === ' ') start++;
        if (start >= chars.length) break;
        let end = Math.min(start + limit, chars.length);
        if (end < chars.length && chars[end].text !== ' ') {
          let boundary = end;
          while (boundary > start && chars[boundary].text !== ' ') boundary--;
          // 공백 없는 긴 단어도 누락 없이 상한을 지킨다.
          if (boundary > start) end = boundary;
        }
        let trimmedEnd = end;
        while (trimmedEnd > start && chars[trimmedEnd - 1].text === ' ') trimmedEnd--;
        lines.push(renderLine(chars.slice(start, trimmedEnd)));
        start = end;
      }
    }
    return lines.join('\n').trim();
  }

  function formatArticle(article) {
    return { ...article, blocks: (article.blocks || []).map((block) => ({
      ...block,
      ...(typeof block.text === 'string' ? { text: wrapText(block.text) } : {}),
      ...(typeof block.caption === 'string' ? { caption: wrapText(block.caption) } : {}),
    })) };
  }

  return { MAX_LINE_LENGTH, wrapText, formatArticle };
});
