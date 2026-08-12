function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&(?:quot|apos|amp);/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function titleVariants(value) {
  const raw = String(value || '').normalize('NFKC').trim();
  const variants = new Set([raw]);

  // 언론사·기자명처럼 제목 뒤에 붙는 꼬리를 제외한 본문 제목도 비교한다.
  for (const part of raw.split(/\s+\|\s+|\s+[-–—]\s+|::+/)) {
    if (normalizeTitle(part).length >= 8) variants.add(part.trim());
  }
  return [...variants].filter(Boolean);
}

function ngrams(value, size) {
  const out = new Set();
  for (let index = 0; index <= value.length - size; index += 1) {
    out.add(value.slice(index, index + size));
  }
  return out;
}

function normalizedSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shortest = Math.min(left.length, right.length);
  if (shortest < 6) return 0;

  // 2글자 묶음은 한국어 조사·어미가 조금 바뀌거나 어순이 달라져도
  // 기사 제목의 핵심 구절을 재사용한 경우를 안정적으로 잡아낸다.
  const size = 2;
  const leftGrams = ngrams(left, size);
  const rightGrams = ngrams(right, size);
  let common = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) common += 1;
  }

  const dice = (2 * common) / (leftGrams.size + rightGrams.size);
  const containment = common / Math.min(leftGrams.size, rightGrams.size);
  return Math.max(dice, containment * 0.9);
}

function titleSimilarity(left, right) {
  let best = 0;
  for (const leftVariant of titleVariants(left)) {
    for (const rightVariant of titleVariants(right)) {
      best = Math.max(
        best,
        normalizedSimilarity(normalizeTitle(leftVariant), normalizeTitle(rightVariant))
      );
    }
  }
  return best;
}

function isTitleTooSimilar(left, right) {
  const leftNormalized = normalizeTitle(left);
  const rightNormalized = normalizeTitle(right);
  const shortest = Math.min(leftNormalized.length, rightNormalized.length);
  if (shortest < 10) return leftNormalized === rightNormalized && shortest > 0;
  return titleSimilarity(left, right) >= 0.55;
}

function isTitleTooSimilarToAny(title, sources) {
  return (sources || []).some((source) =>
    isTitleTooSimilar(title, source && source.title)
  );
}

module.exports = {
  normalizeTitle,
  titleSimilarity,
  isTitleTooSimilar,
  isTitleTooSimilarToAny,
};
