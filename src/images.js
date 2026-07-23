// 다운로드된 후보 이미지들을 claude -p (Read 툴 = vision)로 보고
// 쓸 만한 것만 골라 본문 이미지 슬롯에 고루 나눠 배치한다.
const path = require('path');
const claude = require('./claude');

/**
 * @param {object} article {title, blocks} — image 블록의 slot/caption/desc 사용
 * @param {Array} candidates [{file, width, height, sourceUrl, sourceName}]
 * @param {string} rawDir 후보 이미지가 저장된 절대경로 디렉토리
 * @returns {Array} [{slot, file|null, caption, sourceName, sourceUrl, reason}]
 */
async function judgeImages(article, candidates, rawDir) {
  const slots = article.blocks.filter((b) => b.type === 'image');
  if (!slots.length) return [];
  if (!candidates.length) {
    return slots.map((s) => ({ slot: s.slot, file: null, caption: s.caption || '', reason: '후보 이미지 없음' }));
  }

  const slotDesc = slots
    .map((s) => `- 슬롯 ${s.slot}: ${s.desc || s.caption || '글 내용에 어울리는 이미지'}`)
    .join('\n');
  const fileList = candidates
    .map(
      (c) =>
        `- ${path.join(rawDir, c.file)} (${c.width}x${c.height}${c.alt ? `, 설명: ${c.alt.slice(0, 60)}` : ''})`
    )
    .join('\n');

  const prompt = `블로그 글에 넣을 이미지를 고르고 배치하는 작업입니다.

글 제목: "${article.title}"

이미지가 들어갈 자리(슬롯)와 각 자리의 내용 힌트:
${slotDesc}

후보 이미지 파일 목록 (Read 툴로 각 파일을 반드시 직접 열어서 눈으로 확인한 뒤 판단하세요):
${fileList}

작업 방법:
1. 먼저 후보 중 '실제로 블로그에 쓸 만한 사진'을 골라내세요.
   - 탈락: 광고/배너(가로로 길쭉한 띠 이미지), 로고, 텍스트만 있는 이미지, UI 캡처, 화질이 매우 나쁜 것
   - **반드시 탈락(저작권 위험)**: 이미지 위에 워터마크가 찍혀 있는 것, 반투명 로고/사이트명/기자명이 겹쳐 있는 것, © 저작권 표기나 "무단전재 금지"·언론사명·사진작가명 같은 글자가 사진에 새겨져 있는 것, 스톡사진 견본(getty/shutterstock 등 워터마크) — 이런 이미지는 절대 통과시키지 마세요.
   - 통과: 워터마크·저작권 표시가 없고 글 주제(연예인/패션/뷰티 등)와 관련된 깨끗한 실제 인물/제품/현장 사진
2. 통과한 사진들을 슬롯에 나눠 배치하세요. 핵심 규칙:
   - **각 슬롯에는 그 슬롯 힌트(및 파일 설명)와 가장 잘 맞는 사진을 고르세요.** 사진의 '설명' 텍스트와 실제 이미지 내용을 모두 보고, 슬롯 주제에 제일 가까운 것을 우선 배치합니다.
   - 글에 등장하는 연예인/인물의 사진이면, 슬롯의 세부 상황(옷차림·장소)이 조금 달라도 그 인물이 맞으면 배치 가능합니다. 단, **더 잘 맞는 사진이 있으면 그쪽을 우선**하세요.
   - 슬롯 주제와 **전혀 무관한 사진(다른 사건·다른 인물·의미 없는 썸네일)은 넣지 말고 비우세요.** 어설프게 안 맞는 사진을 억지로 채우지 마세요.
   - 여러 슬롯에 **고루** 나누고, 같은 이미지를 두 슬롯에 중복 사용하지 마세요.
   - 잘 맞는 사진이 슬롯 수보다 적으면 일부 슬롯은 비워도 됩니다(안 맞는 것보다 비우는 게 낫습니다).

다음 JSON 형식으로만 출력하세요:
{
  "usable": ["raw-1.jpg", "raw-6.jpg", "raw-7.jpg"],  // 쓸 만한 사진을 좋은 순서대로 (파일명만)
  "assignments": [
    {"slot": 1, "file": "raw-1.jpg", "reason": "배치 이유 한 줄"},
    {"slot": 2, "file": "raw-6.jpg", "reason": "배치 이유 한 줄"}
  ]
}
file에는 파일명만 쓰세요(경로 제외).`;

  const result = await claude.invokeJson(prompt, {
    timeoutMs: 300000,
    allowedTools: ['Read'],
  });

  const byFile = new Map(candidates.map((c) => [c.file, c]));
  const clean = (f) => (f ? String(f).replace(/^.*[\\/]/, '') : null);

  // AI가 배열만 반환하는 경우도 허용 (assignments 로 간주)
  const assignments = Array.isArray(result) ? result : Array.isArray(result.assignments) ? result.assignments : [];
  const usableRanked = (Array.isArray(result) ? [] : result.usable || [])
    .map(clean)
    .filter((f) => f && byFile.has(f));

  // 슬롯 → 파일 초기 배정 (AI assignments 기준, 유효/중복 검증)
  const used = new Set();
  const slotFile = new Map();
  for (const s of slots) {
    const j = assignments.find((x) => Number(x.slot) === s.slot) || {};
    let file = clean(j.file);
    if (file && byFile.has(file) && !used.has(file)) {
      used.add(file);
      slotFile.set(s.slot, { file, reason: String(j.reason || '') });
    }
  }

  // 남은 쓸 만한 이미지로 빈 슬롯 채우기 (본문 전체에 고루 퍼지도록)
  // usable 목록이 비면 후보 순서를 폴백으로 사용
  const pool = (usableRanked.length ? usableRanked : candidates.map((c) => c.file)).filter((f) => !used.has(f));
  let pi = 0;
  for (const s of slots) {
    if (slotFile.has(s.slot)) continue;
    if (pi >= pool.length) break;
    const file = pool[pi++];
    used.add(file);
    slotFile.set(s.slot, { file, reason: '본문에 이미지를 고루 배치하기 위해 추가 배정' });
  }

  return slots.map((s) => {
    const picked = slotFile.get(s.slot);
    const meta = picked ? byFile.get(picked.file) : {};
    return {
      slot: s.slot,
      file: picked ? picked.file : null,
      caption: s.caption || '',
      sourceName: meta.sourceName || '',
      sourceUrl: meta.sourceUrl || '',
      reason: picked ? picked.reason : '쓸 만한 이미지가 부족해 비움',
    };
  });
}

module.exports = { judgeImages };
