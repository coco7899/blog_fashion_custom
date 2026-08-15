// 건강 글 임시저장 뒤 Codex 구독 이미지 생성을 자동으로 이어서 처리한다.
// OpenAI API 키는 사용하지 않고 codex exec가 제공하는 내장 imagegen을 호출한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { imageSize } = require('image-size');

const codex = require('./codex');
const store = require('./store');

const MIN_IMAGE_BYTES = 8 * 1024;
const COVER_SIZE = 1080;
const COVER_STYLE_VERSION = 'orange-soft-v4';
const COVER_GRADIENT = 'linear-gradient(135deg,rgba(154,52,18,.58) 0%,rgba(234,88,12,.40) 48%,rgba(249,115,22,.18) 78%,rgba(251,146,60,.08) 100%)';
const GENERATED_ROOT = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images');
const DOWNLOAD_ROOT = path.join(os.homedir(), 'Downloads', '건강블로그이미지');
const inflight = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUsableImage(file) {
  try {
    return fs.statSync(file).isFile() && fs.statSync(file).size >= MIN_IMAGE_BYTES;
  } catch {
    return false;
  }
}

function isSquareCover(file) {
  if (!isUsableImage(file)) return false;
  try {
    const dimensions = imageSize(file);
    return dimensions.width === COVER_SIZE && dimensions.height === COVER_SIZE;
  } catch {
    return false;
  }
}

function safeSegment(value, maxLength = 70) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return (cleaned || '건강정보').slice(0, maxLength);
}

function localDateStamp(value) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// 같은 날 같은 제목을 다시 작성해도 이전 글의 사진을 재사용하거나 덮어쓰지 않는다.
// 현재 초안이 이미 쓰던 폴더는 재시도 때 그대로 사용하고, 다른 초안이 쓰는 폴더라면
// "재작성-2", "재작성-3" 순서로 새 폴더를 만든다.
function resolveDownloadDir(draftId, meta, title) {
  if (meta?.imageDownloadDir) return path.resolve(meta.imageDownloadDir);

  const baseDir = path.join(DOWNLOAD_ROOT, `${localDateStamp(meta?.createdAt)}-${title}`);
  const usedByAnotherDraft = (candidate) => {
    const resolved = path.resolve(candidate);
    return store.listDrafts().some((draft) =>
      draft.id !== draftId &&
      draft.imageDownloadDir &&
      path.resolve(draft.imageDownloadDir) === resolved
    );
  };

  if (!fs.existsSync(baseDir) && !usedByAnotherDraft(baseDir)) return baseDir;
  for (let number = 2; number < 100; number += 1) {
    const candidate = `${baseDir}-재작성-${number}`;
    if (!fs.existsSync(candidate) && !usedByAnotherDraft(candidate)) return candidate;
  }
  throw new Error('같은 제목의 새 이미지 폴더 이름을 만들지 못했습니다.');
}

function chooseCoreKeyword(meta, article) {
  const candidates = [
    ...(Array.isArray(meta?.topic?.keywords) ? meta.topic.keywords : []),
    meta?.keyword,
    ...(Array.isArray(article?.tags) ? article.tags : []),
  ];
  const raw = String(candidates.find((value) => String(value || '').trim()) || article?.title || '건강정보')
    .replace(/\s*(증상과 관리|증상 및 관리|관리 방법|확인 방법|확인법)$/g, '')
    .trim();
  return safeSegment(raw, 14);
}

function shortenPhrase(value, maxLength = 20) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  let out = '';
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > maxLength && out) break;
    out = next.slice(0, maxLength);
  }
  return out || '생활 속 확인 기준';
}

function chooseCoverPhrase(article, keyword) {
  let title = String(article?.title || '생활 속 건강 확인 기준');
  const questionIndex = title.indexOf('?');
  if (questionIndex >= 0 && questionIndex < title.length - 1) title = title.slice(questionIndex + 1);
  title = title
    .replace(keyword, '')
    .replace(/무엇일까요|일까요|인가요/g, '')
    .replace(/구분하는\s*확인\s*기준/g, '구분 기준')
    .replace(/확인하는\s*기준/g, '확인 기준')
    .replace(/[?:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return shortenPhrase(title, 20);
}

function imageFilesInThread(threadId) {
  if (!threadId) return [];
  const dir = path.join(GENERATED_ROOT, threadId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file) && isUsableImage(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

async function waitForGeneratedImage(threadId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const files = imageFilesInThread(threadId);
    if (files.length) return files[0];
    await sleep(500);
  }
  throw new Error(`Codex 이미지 파일을 찾지 못했습니다. thread=${threadId || 'unknown'}`);
}

async function generateBuiltInImage(prompt) {
  const request = `$imagegen\n${prompt}\n\n반드시 Codex 내장 이미지 생성 기능만 사용해 이미지 정확히 1장을 생성하세요. 외부 이미지 API, API 키, 셸 다운로드는 사용하지 마세요. 추가 질문 없이 바로 생성하고, 생성 후 설명은 쓰지 마세요.`;
  const result = await codex.invokeEvents(request, { timeoutMs: 6 * 60 * 1000 });
  if (!result.threadId) {
    throw new Error(`Codex 이미지 생성 스레드를 확인하지 못했습니다. ${result.finalText || ''}`.trim());
  }
  return waitForGeneratedImage(result.threadId);
}

function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function renderCover(backgroundFile, destination, keyword, phrase) {
  const background = fs.readFileSync(backgroundFile).toString('base64');
  const fontFile = path.join(__dirname, '..', 'public', 'fonts', 'PretendardVariable.woff2');
  const font = fs.existsSync(fontFile) ? fs.readFileSync(fontFile).toString('base64') : '';
  const keywordLength = Array.from(String(keyword || '').replace(/\s+/g, '')).length;
  // 기본 메인 키워드는 기존 88px의 정확히 두 배인 176px로 표시한다.
  // 아주 긴 키워드만 정사각형 이미지 밖으로 넘치지 않도록 단계적으로 보정한다.
  const keywordFontSize = keywordLength <= 8 ? 176 : keywordLength <= 11 ? 148 : 124;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: COVER_SIZE, height: COVER_SIZE }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><style>
      ${font ? `@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;}` : ''}
      *{box-sizing:border-box}html,body{margin:0;width:${COVER_SIZE}px;height:${COVER_SIZE}px;overflow:hidden}
      body{font-family:Pretendard,"Malgun Gothic",sans-serif;background:#9a3412}
      .cover{position:relative;width:${COVER_SIZE}px;height:${COVER_SIZE}px;background:url(data:image/png;base64,${background}) center/cover no-repeat}
      .cover:before{content:"";position:absolute;inset:0;background:${COVER_GRADIENT}}
      .copy{position:absolute;left:48px;top:0;bottom:0;width:624px;padding:18px 0;display:flex;flex-direction:column;justify-content:center;color:#fff;text-shadow:0 4px 22px rgba(0,0,0,.46)}
      .eyebrow{font-size:26px;font-weight:700;letter-spacing:.12em;color:#fff7ed;margin-bottom:12px;flex-shrink:0}
      .keyword{font-size:${keywordFontSize}px;line-height:.92;font-weight:900;letter-spacing:-.075em;word-break:keep-all;overflow-wrap:anywhere;text-wrap:balance;flex-shrink:0}
      .line{width:96px;height:8px;border-radius:9px;background:#fb923c;margin:18px 0 16px;flex-shrink:0}
      .phrase{font-size:46px;line-height:1.3;font-weight:700;letter-spacing:-.035em;word-break:keep-all;overflow-wrap:anywhere;text-wrap:balance}
    </style></head><body><div class="cover"><div class="copy"><div class="eyebrow">생활 건강 확인</div><div class="keyword">${htmlEscape(keyword)}</div><div class="line"></div><div class="phrase">${htmlEscape(phrase)}</div></div></div></body></html>`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await page.screenshot({ path: destination, type: 'png' });
  } finally {
    await browser.close().catch(() => {});
  }
  if (!isSquareCover(destination)) throw new Error(`대표이미지를 ${COVER_SIZE}×${COVER_SIZE}px로 만들지 못했습니다.`);
}

function syncToDraftRaw(sourceFile, draftId, fileName) {
  const rawDir = path.join(store.imagesDir(draftId), 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const target = path.join(rawDir, fileName);
  fs.copyFileSync(sourceFile, target);
  return target;
}

function bodyPrompt(slot, title) {
  return [
    'Use case: photorealistic-natural.',
    'Asset type: 네이버 생활 건강 블로그 본문 사진.',
    `글 주제: ${title}.`,
    `장면: ${slot.desc || slot.caption || '생활 건강을 점검하는 자연스러운 장면'}.`,
    '한국의 실제 생활 공간과 자연광, 과장되지 않은 현실적인 사진, 가로 구도.',
    '읽을 수 있는 글자, 숫자, 로고, 상표, 워터마크, 약품 포장, 의료 진단 장면은 넣지 마세요.',
  ].join('\n');
}

function coverBackgroundPrompt(meta, article, keyword, phrase) {
  const firstSlot = (article.blocks || []).find((block) => block.type === 'image');
  return [
    'Use case: photorealistic-natural.',
    'Asset type: 네이버 생활 건강 블로그 대표이미지의 배경 사진.',
    `글 주제: ${article.title}. 핵심 키워드: ${keyword}. 관련 내용: ${phrase}.`,
    `장면: ${firstSlot?.desc || '건강 정보를 확인하는 자연스러운 한국인의 생활 장면'}.`,
    '한국의 실제 생활 공간, 부드러운 자연광, 과장되지 않은 현실적인 사진, 정사각형 1:1 구도.',
    '전체 색감은 따뜻한 오렌지·앰버 계열로 구성하고 진한 초록이나 청록이 화면을 지배하지 않게 하세요.',
    '왼쪽 절반은 나중에 제목을 배치할 수 있도록 단순하고 어두운 여백으로 남기고 주요 피사체는 오른쪽에 두세요.',
    '이미지 자체에는 어떠한 글자, 숫자, 로고, 상표, 워터마크도 넣지 마세요.',
  ].join('\n');
}

async function runComplete(draftId) {
  const meta = store.getMeta(draftId);
  const article = store.getArticle(draftId);
  if (!meta || !article) throw new Error('이미지를 만들 글 정보를 찾지 못했습니다.');
  const slots = (article.blocks || []).filter((block) => block.type === 'image').slice(0, 6);
  if (slots.length < 4) throw new Error(`본문 이미지 자리가 ${slots.length}개뿐입니다.`);

  const keyword = chooseCoreKeyword(meta, article);
  const phrase = chooseCoverPhrase(article, keyword);
  const title = safeSegment(article.title || meta.title || meta.keyword, 72);
  const targetDir = resolveDownloadDir(draftId, meta, title);
  fs.mkdirSync(targetDir, { recursive: true });
  const prePublish = meta.prePublishImageGeneration === true;
  const placementRequired = meta.imagePlacementRequired === true && meta.savedAsDraft !== false;
  const finalStatus = prePublish
    ? 'images'
    : meta.savedAsDraft === false || meta.status === 'published'
      ? 'published'
      : 'saved';
  const finalLabel = prePublish
    ? '원고 작성 완료'
    : finalStatus === 'published'
      ? '발행 완료'
      : '임시저장 완료';

  store.updateDraft(draftId, {
    status: 'images',
    step: `${finalLabel} · 대표이미지와 본문 이미지 생성 시작`,
    autoImageWorkflow: true,
    imageOnlyError: false,
    imageError: null,
    imagesPending: true,
  });

  const coverName = `00-대표이미지-${safeSegment(keyword, 24)}.png`;
  const coverFile = path.join(targetDir, coverName);
  const needsOrangeCover = !isSquareCover(coverFile) || meta.coverStyleVersion !== COVER_STYLE_VERSION;
  if (needsOrangeCover) {
    store.updateDraft(draftId, { status: 'images', step: `${finalLabel} · 대표이미지 배경 생성 중 (1/${slots.length + 1})` });
    const coverBackground = await generateBuiltInImage(coverBackgroundPrompt(meta, article, keyword, phrase));
    await renderCover(coverBackground, coverFile, keyword, phrase);
  }
  syncToDraftRaw(coverFile, draftId, coverName);

  const judgments = [{
    slot: 0,
    file: coverName,
    caption: `${keyword} · ${phrase}`,
    desc: '핵심 키워드와 관련 문구가 들어간 대표이미지',
    sourceName: 'Codex built-in image generation',
    sourceUrl: '',
    ai: true,
    generated: true,
    placeholder: false,
    cover: true,
    reason: '글의 핵심 키워드와 내용을 보여 주는 대표이미지',
  }];

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const number = String(index + 1).padStart(2, '0');
    const fileName = `${number}-${safeSegment(slot.caption || `본문장면-${index + 1}`, 36)}.png`;
    const destination = path.join(targetDir, fileName);
    if (!isUsableImage(destination)) {
      store.updateDraft(draftId, {
        status: 'images',
        step: `${finalLabel} · 본문 이미지 ${index + 1}/${slots.length} 생성 중`,
        imageProgress: { current: index + 1, total: slots.length + 1 },
      });
      const generated = await generateBuiltInImage(bodyPrompt(slot, article.title));
      fs.copyFileSync(generated, destination);
    }
    if (!isUsableImage(destination)) throw new Error(`본문 이미지 저장 실패: ${fileName}`);
    syncToDraftRaw(destination, draftId, fileName);
    judgments.push({
      slot: slot.slot,
      file: fileName,
      caption: slot.caption || '',
      desc: slot.desc || '',
      sourceName: 'Codex built-in image generation',
      sourceUrl: '',
      ai: true,
      generated: true,
      placeholder: false,
      cover: false,
      reason: '본문 이미지 자리의 장면 설명에 맞춰 생성한 생활 사진',
    });
  }

  const expectedNames = judgments.map((judgment) => judgment.file);
  const missing = expectedNames.filter((name) => !isUsableImage(path.join(targetDir, name)));
  if (missing.length) throw new Error(`다운로드 폴더 이미지 누락: ${missing.join(', ')}`);
  if (!isSquareCover(coverFile)) throw new Error(`대표이미지가 ${COVER_SIZE}×${COVER_SIZE}px 정사각형이 아닙니다.`);

  store.saveJudgments(draftId, judgments);
  article.coverImage = { file: coverName, keyword, phrase };
  article.assetReview = {
    ...(article.assetReview || {}),
    passed: true,
    imageCount: expectedNames.length,
    imageSlotCount: slots.length,
    imagesPending: false,
  };
  store.saveArticle(draftId, article);
  store.updateDraft(draftId, {
    status: placementRequired || prePublish ? 'images' : finalStatus,
    step: prePublish
      ? `대표이미지 1장 + 본문 이미지 ${slots.length}장 저장 완료 · 티스토리 저장 준비`
      : placementRequired
      ? `대표이미지 1장 + 본문 이미지 ${slots.length}장 저장 완료 · 네이버 배치 준비`
      : `${finalLabel} · 대표이미지 1장 + 본문 이미지 ${slots.length}장 저장 완료`,
    imageCount: expectedNames.length,
    imageSlotCount: slots.length,
    imagesPending: false,
    imageDownloadDir: targetDir,
    imageSource: 'Codex built-in image generation (gpt-image-2)',
    coverImageFile: coverFile,
    coverKeyword: keyword,
    coverPhrase: phrase,
    coverAspectRatio: '1:1',
    coverWidth: COVER_SIZE,
    coverHeight: COVER_SIZE,
    coverStyleVersion: COVER_STYLE_VERSION,
    imageOnlyError: false,
    imageError: null,
    imagePlacementPending: placementRequired,
    error: null,
  });
  return {
    draftId,
    targetDir,
    imageCount: expectedNames.length,
    bodyImageCount: slots.length,
    coverFile,
    coverAspectRatio: '1:1',
    coverWidth: COVER_SIZE,
    coverHeight: COVER_SIZE,
    keyword,
    phrase,
  };
}

function complete(draftId) {
  if (inflight.has(draftId)) return inflight.get(draftId);
  const job = runComplete(draftId)
    .catch((error) => {
      const meta = store.getMeta(draftId) || {};
      const finalStatus = meta.prePublishImageGeneration === true
        ? 'error'
        : meta.savedAsDraft === false
          ? 'published'
          : 'error';
      store.updateDraft(draftId, {
        status: finalStatus,
        step: meta.prePublishImageGeneration === true
          ? `티스토리 저장 전 이미지 자동 생성 실패: ${error.message}`
          : `임시저장은 완료됐지만 이미지 자동 생성 실패: ${error.message}`,
        imagesPending: true,
        autoImageWorkflow: true,
        imageOnlyError: true,
        imageError: error.message,
        error: error.message,
      });
      throw error;
    })
    .finally(() => inflight.delete(draftId));
  inflight.set(draftId, job);
  return job;
}

async function resumePending() {
  const pending = store.listDrafts().filter((draft) =>
    !draft.auto &&
    draft.autoImageWorkflow &&
    !draft.imagePlacementRequired &&
    draft.imagesPending &&
    draft.articleAvailable &&
    draft.postUrl
  );
  for (const draft of pending) {
    try {
      console.log(`[health-images] ${draft.id} 미완료 이미지 작업 자동 재개`);
      await complete(draft.id);
    } catch (error) {
      console.error(`[health-images] ${draft.id} 자동 재개 실패: ${error.message}`);
    }
  }
  return pending.length;
}

module.exports = {
  complete,
  resumePending,
  chooseCoreKeyword,
  chooseCoverPhrase,
  safeSegment,
  resolveDownloadDir,
  isSquareCover,
  COVER_GRADIENT,
  COVER_STYLE_VERSION,
};
