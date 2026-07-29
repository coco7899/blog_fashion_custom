// 블로그 원고 → 숏폼(세로 9:16) 대본 + 장면 이미지 준비
//
// 구성 규칙 (사이트/렌더러와 공유하는 스펙):
//   · 상단   : 짧은 후킹 문구 (영상 내내 고정 노출)
//   · 화면 정가운데에서 offsetY(기본 10px) 아래 : 장면별 대본 자막
//   · 배경   : 원고에 쓰인 사진(저작권 판정을 통과한 것) 우선, 모자라면 AI 연출 이미지
//
// 영상 인코딩은 ffmpeg 없이 브라우저(Canvas + MediaRecorder)에서 처리하므로
// 서버는 "대본 + 장면별 배경 이미지 파일"까지만 준비한다.
const fs = require('fs');
const path = require('path');
const codex = require('./codex');
const store = require('./store');
const aiimage = require('./aiimage');

// 숏폼 배경으로 쓸 AI 이미지 화풍 — 세로 컷, 자막이 얹히므로 가운데는 단순하게.
// ※ coco 방식 반영: 자막이 배경 위에 깔리므로 무조건 '밝은 하이키 조명'으로.
//    어두운 저조도/야간 장면은 자막이 안 보여 금지. 글자·로고·상표는 넣지 않는다.
const AI_BASE =
  'vertical 9:16 cinematic photo, bright airy high-key lighting, natural daylight, ' +
  'shallow depth of field, clean composition with empty space in the middle, ' +
  'no text, no letters, no watermark, no logo, no brand, no icons, no captions';

const DEFAULT_STYLE = {
  offsetY: 10,      // 화면 정가운데 기준 대본 위치(아래로 +px, 1080x1920 기준)
  hookY: 172,       // 상단 후킹 세로 위치(px)
  hookSize: 76,     // 상단 후킹 글자 크기
  hookColor: '',    // 후킹 배경(박스) 색 — 빈 값이면 테마 기본색
  hookTextColor: '',// 후킹 글자 색 — 빈 값이면 테마 기본색
  hookBoxed: true,  // 후킹 배경 박스 표시
  textSize: 60,     // 대본 자막 글자 크기
  theme: 'dark',    // dark | light | vivid
  boxed: true,      // 자막 뒤 반투명 박스
  kenBurns: true,   // 배경 확대 + 훅 시네마틱 모션
  narration: true,  // 내레이션을 하단 자막으로 표시 (coco 방식)
};

// 원고(article.blocks)를 AI에게 넘길 평문으로
function articleToText(article) {
  const parts = [`제목: ${article.title}`];
  for (const b of article.blocks || []) {
    if (b.type === 'heading') parts.push(`\n## ${b.text}`);
    else if (b.type === 'paragraph' || b.type === 'quote') parts.push(String(b.text || ''));
  }
  return parts.join('\n').slice(0, 12000);
}

/**
 * 원고를 바탕으로 숏폼 대본을 만든다.
 * @param {object} article {title, blocks, tags}
 * @param {object} meta 초안 메타 (keyword/type/products 등)
 * @param {object} opts {sceneCount, totalSeconds}
 * @returns {object} {hook, hookSub, caption, hashtags, scenes:[{text, narration, seconds, imageDesc, keyword}]}
 */
async function buildScript(article, meta = {}, opts = {}) {
  const sceneCount = Math.min(10, Math.max(4, Number(opts.sceneCount) || 7));
  const totalSeconds = Math.min(60, Math.max(15, Number(opts.totalSeconds) || 35));
  const isProduct = meta.type === 'product';

  const prompt = `아래 블로그 원고를 그대로 활용해 **세로 숏폼 영상(릴스/쇼츠) 대본**을 만드세요.

원고
------------------
${articleToText(article)}
------------------

영상 화면 구성(이미 정해져 있음, 반드시 이 틀에 맞춰 문구를 쓰세요):
- 화면 맨 위: "후킹" 한 줄이 영상 내내 고정으로 떠 있습니다. → 짧아야 합니다.
- 화면 정가운데 살짝 아래: 장면별 "대본 자막"이 한 장면씩 바뀌며 나옵니다.
- 배경: 사진 한 장이 천천히 확대됩니다. 소리(내레이션)는 시청자가 나중에 입힐 수 있습니다.

작성 규칙 (조회수 잘 나오는 한국 릴스/쇼츠 공식):
1. hook(후킹): **공백 포함 16자 이내**, 0~3초 안에 스크롤을 멈추게 하는 한 문장. 가격·후회·"사기 전엔 몰랐던 것"·의외의 반전 등으로 궁금증을 자극. 원고의 핵심을 찌르되 낚시성 거짓말은 금지.
2. hookSub: 후킹 아래 아주 작게 붙는 보조 문구. 공백 포함 20자 이내. 필요 없으면 빈 문자열.
3. scenes: 정확히 ${sceneCount}개. 전체 길이 합계가 약 ${totalSeconds}초가 되도록 각 장면 seconds를 3~6 사이로 배분하세요.
   - text(화면 자막): **한 줄 16자 이내, 최대 2줄**. 줄바꿈이 필요하면 \\n 을 넣으세요. 읽자마자 이해되는 짧은 구어체. 조사는 생략해도 됩니다.
   - **자막 안에 핵심 단어(숫자·%·금액, 또는 진짜/꿀팁/단점/후회/필수 같은 강조어)를 자연스럽게 넣으면** 영상에서 그 단어가 색으로 강조됩니다.
   - narration(내레이션 원고): 그 장면에서 말할 문장 1~2개. 자막보다 자연스럽고 길어도 됩니다(영상 하단에 자막으로도 깔립니다).
   - imageDesc: 그 장면 배경 사진을 AI로 만들 때 쓸 장면 묘사(한글, 40자 내외). **밝고 화사한 낮/자연광 장면**으로. 인물의 얼굴·실존 인물·상표·글자는 넣지 말고 분위기/장소/사물 위주. (어두운 야간·저조도 장면은 자막이 안 보이므로 금지)
   - keyword: 그 장면과 관련된 검색 키워드 1개.
4. 흐름: 1번 장면은 후킹을 이어받는 문제제기(Before/불편), 중간은 ${isProduct ? '개봉→사용→Before/After→장단점' : '핵심 정보를 단계별로'} 전개.
   - **솔직한 단점·주의점 장면을 최소 1개** 넣어 신뢰를 주세요.
   - **마지막 장면은 CTA**: 저장/공유/팔로우 유도 + ${isProduct ? '자세한 후기·구매는 프로필 링크 안내' : '더 자세한 내용은 블로그 글에서 확인 안내'}.
5. 원고에 없는 사실을 지어내지 마세요. 숫자·이름은 원고에 있는 것만 사용합니다.
6. title: 영상 상단에 쓸 짧은 제목(공백 포함 20자 이내, 없으면 hook과 달라도 됨). caption: 업로드 시 쓸 설명글 2~3문장. hashtags: 해시태그 8개(# 없이 단어만).

다음 JSON 형식으로만 출력하세요:
{
  "title": "...",
  "hook": "...",
  "hookSub": "...",
  "caption": "...",
  "hashtags": ["...", "..."],
  "scenes": [
    {"text": "첫 줄\\n둘째 줄", "narration": "...", "seconds": 4, "imageDesc": "...", "keyword": "..."}
  ]
}`;

  const raw = await codex.invokeJson(prompt, { timeoutMs: 240000 });
  return normalizeScript(raw, { sceneCount });
}

// AI 응답을 렌더러가 신뢰할 수 있는 형태로 정리 (길이/타입 방어)
function normalizeScript(raw, { sceneCount = 7 } = {}) {
  const cut = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const scenes = (Array.isArray(raw && raw.scenes) ? raw.scenes : [])
    .slice(0, 10)
    .map((s, i) => ({
      id: i + 1,
      text: String(s.text || '').replace(/\\n/g, '\n').trim().slice(0, 80) || `장면 ${i + 1}`,
      narration: cut(s.narration, 200),
      seconds: Math.min(8, Math.max(2, Number(s.seconds) || 4)),
      imageDesc: cut(s.imageDesc, 120),
      keyword: cut(s.keyword, 40),
      file: null,
      ai: false,
    }));
  if (!scenes.length) throw new Error('AI가 장면을 만들지 못했습니다. 다시 시도해주세요.');
  return {
    videoTitle: cut(raw && raw.title, 28),
    hook: cut(raw && raw.hook, 24) || '지금 이거 보세요',
    hookSub: cut(raw && raw.hookSub, 30),
    caption: cut(raw && raw.caption, 400),
    hashtags: (Array.isArray(raw && raw.hashtags) ? raw.hashtags : [])
      .map((h) => cut(h, 20).replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 10),
    scenes,
  };
}

// 원고에서 이미 검증된(워터마크 없는) 사진 파일 목록
function articleImageFiles(draftId) {
  const judged = (store.getJudgments(draftId) || []).map((j) => j && j.file).filter(Boolean);
  if (judged.length) return judged;
  const cands = store.readJson(path.join(store.imagesDir(draftId), 'candidates.json'), []) || [];
  return cands.map((c) => c.file).filter(Boolean);
}

/**
 * 장면마다 배경 이미지를 배정한다.
 *  - mode 'article' : 원고 사진 우선 배정 → 부족분만 AI 생성
 *  - mode 'ai'      : 전 장면 AI 연출 이미지 생성 (인물/저작권 걱정 없음)
 * 배정 결과를 scenes[i].file / .ai 에 채워 넣고 script를 반환.
 */
async function prepareImages(draftId, script, { mode = 'article', onStep } = {}) {
  const sfDir = store.shortformDir(draftId);
  fs.mkdirSync(sfDir, { recursive: true });

  const pool = mode === 'ai' ? [] : articleImageFiles(draftId);
  let pi = 0;
  const needAi = [];
  for (const s of script.scenes) {
    if (s.file) continue; // 이미 배정된 장면(개별 재생성 등)은 유지
    if (pi < pool.length) {
      s.file = pool[pi++];
      s.ai = false;
      s.source = 'article';
    } else {
      needAi.push(s);
    }
  }

  if (needAi.length) {
    const descs = needAi.map((s) => s.imageDesc || s.keyword || s.text.replace(/\n/g, ' '));
    const made = await aiimage.generateMany(descs, sfDir, {
      prefix: `sf-${Date.now().toString(36)}`,
      base: AI_BASE,
      width: 768,
      height: 1344,
      onProgress: (n, total) => onStep && onStep(`AI 배경 이미지 생성 중 (${n}/${total})`),
    });
    made.forEach((m, i) => {
      const s = needAi[i];
      if (!s) return;
      s.file = m.file;
      s.ai = true;
      s.source = 'ai';
    });
  }
  return script;
}

/** 장면 1개의 배경 이미지를 AI로 다시 생성 */
async function regenerateSceneImage(draftId, scene) {
  const sfDir = store.shortformDir(draftId);
  fs.mkdirSync(sfDir, { recursive: true });
  const file = `sf-${Date.now().toString(36)}-${scene.id}.jpg`;
  const ok = await aiimage.generate(
    scene.imageDesc || scene.keyword || String(scene.text || '').replace(/\n/g, ' '),
    path.join(sfDir, file),
    '',
    { base: AI_BASE, width: 768, height: 1344 }
  );
  if (!ok) throw new Error('AI 이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
  return { file, ai: true, source: 'ai' };
}

/**
 * 초안 하나에 대한 숏폼 생성 전체 흐름 (백그라운드 실행용).
 * 진행 상황은 shortform.json의 status/step으로 노출한다.
 */
async function generate(draftId, opts = {}) {
  const setStep = (step) => store.updateShortform(draftId, { status: 'building', step });
  try {
    const article = store.getArticle(draftId);
    if (!article) throw new Error('작성된 원고가 없습니다. 글쓰기를 먼저 완료해주세요.');
    const meta = store.getMeta(draftId) || {};

    store.saveShortform(draftId, {
      status: 'building',
      step: 'AI가 숏폼 대본을 쓰는 중 — 1~2분 걸릴 수 있어요',
      error: null,
      draftId,
      title: article.title,
      style: { ...DEFAULT_STYLE, ...(opts.style || {}) },
      imageMode: opts.imageMode === 'ai' ? 'ai' : 'article',
      createdAt: new Date().toISOString(),
      scenes: [],
    });

    const script = await buildScript(article, meta, opts);
    store.updateShortform(draftId, { ...script, step: '장면 배경 이미지 준비 중' });

    await prepareImages(draftId, script, {
      mode: opts.imageMode === 'ai' ? 'ai' : 'article',
      onStep: setStep,
    });

    const done = store.updateShortform(draftId, {
      ...script,
      status: 'ready',
      step: '숏폼 준비 완료',
      error: null,
    });
    console.log(`[shortform] ${draftId} 대본 ${script.scenes.length}장면 준비 완료`);
    return done;
  } catch (e) {
    console.error(`[shortform] ${draftId} 실패:`, e.message);
    store.updateShortform(draftId, { status: 'error', step: '실패: ' + e.message, error: e.message }) ||
      store.saveShortform(draftId, { status: 'error', step: '실패: ' + e.message, error: e.message, draftId, scenes: [] });
    return null;
  }
}

module.exports = {
  DEFAULT_STYLE,
  generate,
  buildScript,
  prepareImages,
  regenerateSceneImage,
  normalizeScript,
};
