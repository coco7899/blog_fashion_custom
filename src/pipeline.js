// 수집 → AI 작성 → 이미지 판정(본문 곳곳 배치) → 임시저장/발행 파이프라인
const path = require('path');
const store = require('./store');
const collector = require('./collector');
const writer = require('./writer');
const images = require('./images');
const publisher = require('./publisher');
const brandconnect = require('./brandconnect');
const aiimage = require('./aiimage');

// 이미지 검색어 만들기 — 글에 실제 등장하는 구체적 키워드(고유명사 포함) 위주로.
// 너무 일반적인 키워드("연예인 패션")만 쓰면 관련 없는 이미지가 나오므로,
// 제목/키워드에서 사람 이름 등 구체어를 우선한다.
function buildImageQueries(topic, article) {
  const out = [];
  const kws = (topic.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  // 구체적인(긴) 키워드 우선 — 보통 고유명사/구체 주제가 여기 들어있음
  const sorted = [...kws].sort((a, b) => b.length - a.length);
  for (const k of sorted) {
    if (out.length >= 2) break;
    if (!out.includes(k)) out.push(k);
  }
  // 제목 앞부분(첫 구절)도 후보로 — 사람 이름/핵심 소재가 담긴 경우가 많음
  const titleHead = String(topic.title || article.title || '')
    .split(/[,·:\-–—]/)[0]
    .replace(/["'"']/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ');
  if (titleHead && titleHead.length >= 3 && !out.includes(titleHead)) out.push(titleHead);
  return out.slice(0, 3);
}

// 임시저장/발행 (파이프라인 마지막 단계 — 저장만 재시도할 때도 사용)
// mode 기본값 'draft'(임시저장). 'publish'면 즉시 발행.
async function publishAndNotify(draftId, article, judgments, visibility, mode = 'draft') {
  const savingLabel = mode === 'publish' ? '발행' : '임시저장';
  store.updateDraft(draftId, { status: 'publishing', step: `네이버 블로그 에디터에 작성/${savingLabel} 중` });
  // 출처: 참고한 뉴스 기사 링크 (글 맨 아래에 클릭 가능한 링크로 추가)
  const meta = store.getMeta(draftId) || {};
  const sources = (meta.refs || [])
    .filter((r) => r && r.url && r.kind === 'news')
    .map((r) => ({ title: r.title, url: r.url }));
  const products = Array.isArray(meta.products) ? meta.products : [];
  const result = await publisher.publish(article, judgments, {
    mode,
    visibility,
    imagesDir: store.imagesDir(draftId),
    errorShotPath: path.join(store.draftDir(draftId), 'publish-error.png'),
    onStep: (s) => store.updateDraft(draftId, { step: s }),
    sources,
    products,
  });
  const { savedAsDraft, postUrl } = result;
  const doneStatus = savedAsDraft ? 'saved' : 'published';
  const doneLabel = savedAsDraft ? '임시저장 완료' : '발행 완료';
  store.updateDraft(draftId, { status: doneStatus, step: doneLabel, postUrl, savedAsDraft, error: null });
  console.log(`[pipeline] ${draftId} ${doneLabel}: ${postUrl}`);

  return postUrl;
}

/**
 * 파이프라인 실행. 예외를 던지지 않고 {ok, postUrl?, error?} 를 반환한다.
 * @param {string} draftId
 * @param {object} search {sources}
 * @param {object} topic {title, angle, refs, keywords}
 * @param {string} visibility 'public'|'private'
 * @param {object} opts {mode}
 */
// 중지 요청 감지 — 단계 전환마다 호출. 요청됐으면 예외를 던져 파이프라인을 멈춘다.
function checkStop(draftId) {
  const m = store.getMeta(draftId);
  if (m && m.stopRequested) throw new Error('사용자 요청으로 중지됨');
}

async function run(draftId, search, topic, visibility, opts = {}) {
  const setStep = (status, step) => { checkStop(draftId); store.updateDraft(draftId, { status, step }); };
  try {
    // 1. 참고자료 본문 수집
    setStep('collecting', '참고자료 본문 수집 중');
    let refSources = (topic.refs || []).map((i) => search.sources[i]).filter(Boolean);
    if (!refSources.length) refSources = search.sources.slice(0, 3);
    const refs = await collector.collectReferences(refSources);
    if (!refs.length) throw new Error('참고자료 본문을 하나도 수집하지 못했습니다.');
    store.updateDraft(draftId, {
      refs: refs.map((r) => ({ title: r.title, url: r.url, source: r.source, kind: r.kind })),
    });

    // 2. AI 글 작성
    setStep('writing', `AI가 글 작성 중 (참고자료 ${refs.length}건) — 수 분 걸릴 수 있어요`);
    const article = await writer.writeArticle(topic, refs);
    store.saveArticle(draftId, article);
    store.updateDraft(draftId, {
      title: article.title,
      frameKey: article.frameKey,
      frameLabel: article.frameLabel,
    });

    // 3. 이미지 수집 + AI 판정
    //    ※ 타인 블로그 이미지는 절대 사용 금지 — 뉴스 이미지에서만.
    //    ① 참고 뉴스 본문 이미지 + ② 네이버 이미지검색(주제 맞춤) 으로 넉넉한 후보 풀을 만든다.
    setStep('images', '주제에 맞는 뉴스 이미지 검색 중');
    const imageList = [];
    for (const r of refs) {
      if (r.kind !== 'news') continue; // 블로그 참고글의 이미지는 제외
      for (const u of r.images || []) {
        if (collector.isBlogImage(u)) continue;
        imageList.push({ url: u, referer: r.url, sourceName: r.source || r.title });
      }
    }
    // 주제 맞춤 이미지 검색 — 글에 실제로 등장하는 구체 키워드로 검색해 관련 이미지를 폭넓게 확보
    const queries = buildImageQueries(topic, article);
    for (const q of queries) {
      try {
        const found = await collector.searchImages(q, { maxCount: 15 });
        imageList.push(...found);
        console.log(`[pipeline] 이미지검색 "${q}" → ${found.length}건`);
      } catch (e) {
        console.log(`[pipeline] 이미지검색 실패 (${q}): ${e.message}`);
      }
    }
    const rawDir = path.join(store.imagesDir(draftId), 'raw');
    // 슬롯 수에 여유를 둔 만큼 후보를 넉넉히 받아 AI가 잘 맞는 것을 고르게 한다
    const slotCount = article.blocks.filter((b) => b.type === 'image').length;
    const candidates = await collector.downloadImages(imageList, rawDir, { maxCount: Math.max(12, slotCount * 3) });
    store.writeJson(path.join(store.imagesDir(draftId), 'candidates.json'), candidates);
    let judgments = [];
    if (candidates.length) {
      setStep('images', `이미지 ${candidates.length}장을 AI가 확인하는 중`);
      judgments = await images.judgeImages(article, candidates, rawDir);
    } else {
      judgments = article.blocks
        .filter((b) => b.type === 'image')
        .map((b) => ({ slot: b.slot, file: null, reason: '사용 가능한 이미지 없음' }));
    }
    store.saveJudgments(draftId, judgments);

    // 4~5. 임시저장(기본) 또는 발행
    //      (연예인 뉴스 글은 상품 링크 없이 출처 링크만 — 상품 소개는 runProduct 별도 모드)
    const postUrl = await publishAndNotify(draftId, article, judgments, visibility, opts.mode || 'draft');
    return { ok: true, postUrl };
  } catch (e) {
    const stopped = e.message && e.message.includes('중지');
    console.error(`[pipeline] ${draftId} ${stopped ? '중지' : '실패'}:`, e.message);
    store.updateDraft(draftId, { status: 'error', step: stopped ? '⏹ 사용자 요청으로 중지됨' : '실패: ' + e.message, error: e.message });
    return { ok: false, error: e.message };
  }
}

/**
 * 상품 소개 파이프라인: 반응 좋은 쇼핑커넥트 상품 1개 선정 → 소개 글 작성
 * → 상세페이지 이미지 본문 배치 → 제휴 링크 발급 → 임시저장/발행.
 * 예외를 던지지 않고 {ok, postUrl?, error?} 반환.
 */
async function runProduct(draftId, visibility, opts = {}) {
  const setStep = (status, step) => { checkStop(draftId); store.updateDraft(draftId, { status, step }); };
  try {
    let product, link, detail;

    if (opts.productUrl) {
      // 1-b. 사용자가 지정한 상품 링크로
      setStep('collecting', '지정한 상품 정보·이미지 확인 중');
      const r = await brandconnect.resolveProductByUrl(opts.productUrl);
      product = r.product;
      link = r.link;
      detail = r.detail || {};
      if (!product || !product.name) throw new Error('상품 정보를 확인하지 못했습니다. 링크를 확인해주세요.');
      console.log(`[pipeline] 지정 상품: ${product.name.slice(0, 40)}`);
    } else {
      // 1-a. 반응 좋은 상품 자동 선정 (최근 소개한 상품은 제외)
      setStep('collecting', '쇼핑커넥트에서 반응 좋은 상품 찾는 중');
      const avoidIds = store
        .listDrafts()
        .map((d) => d.product && d.product.id)
        .filter(Boolean)
        .slice(0, 20);
      product = await brandconnect.getBestProduct({ avoidIds });
      if (!product) throw new Error('소개할 상품을 찾지 못했습니다.');
      console.log(`[pipeline] 선정 상품: ${product.name.slice(0, 40)} (리뷰 ${product.reviews})`);

      setStep('collecting', '제휴 링크 발급 중');
      link = await brandconnect.issueAffiliateLink(product.url);
      if (!link) throw new Error('제휴 링크 발급에 실패했습니다.');

      setStep('collecting', '상품 상세페이지 이미지·정보 수집 중');
      try {
        detail = await brandconnect.getStoreDetail(link);
      } catch (e) {
        console.log(`[pipeline] 스토어 상세 실패(BC 페이지 폴백): ${e.message}`);
      }
      if (!detail || !detail.images || !detail.images.length) {
        detail = await brandconnect.getProductDetail(product.url).catch(() => ({}));
      }
    }

    store.updateDraft(draftId, { product, keyword: product.query || '쇼핑커넥트 상품', title: (product.name || '상품').slice(0, 40) });
    const products = [{ name: product.name, price: product.price, commission: product.commission, link }];
    store.updateDraft(draftId, { products });

    if (!detail.images || !detail.images.length) {
      console.log('[pipeline] 상세 이미지가 없어 카드 이미지로 대체');
      detail.images = product.image ? [product.image] : [];
    }
    console.log(`[pipeline] 상세 이미지 ${detail.images.length}장 확보`);

    // 3. AI 소개 글 작성
    setStep('writing', 'AI가 상품 소개 글 작성 중 — 수 분 걸릴 수 있어요');
    const article = await writer.writeProductArticle(product, detail);
    store.saveArticle(draftId, article);
    store.updateDraft(draftId, {
      title: article.title,
      frameKey: article.frameKey,
      frameLabel: article.frameLabel,
    });

    // 4. 상세페이지 이미지 다운로드 → 슬롯에 순서대로 배치 (전부 해당 상품 사진이므로 AI 판정 불필요)
    setStep('images', '상품 이미지 다운로드 중');
    const rawDir = path.join(store.imagesDir(draftId), 'raw');
    const imageList = (detail.images || []).map((u) => ({ url: u, referer: product.url, sourceName: '공식 스토어' }));
    const slots = article.blocks.filter((b) => b.type === 'image');
    const candidates = await collector.downloadImages(imageList, rawDir, { maxCount: Math.max(slots.length + 2, 6) });
    store.writeJson(path.join(store.imagesDir(draftId), 'candidates.json'), candidates);

    // 4-b. 상세 이미지가 부족하면(슬롯 수보다 적으면) AI 연출 이미지로 빈 슬롯 채움
    //      (스킬 규칙: 제품 없는 "문제 상황·사용 공간" 분위기 컷만 생성)
    let aiImages = [];
    if (candidates.length < slots.length) {
      const need = slots.length - candidates.length;
      setStep('images', `설득력 있는 이미지 보강 — AI 연출 이미지 ${need}장 생성 중`);
      const emptySlots = slots.slice(candidates.length);
      const descs = emptySlots.map((s) => s.desc || s.caption || product.query || '상품 사용 장면');
      try {
        aiImages = await aiimage.generateMany(descs, rawDir, { prefix: 'ai', category: product.query || '' });
        console.log(`[pipeline] AI 연출 이미지 ${aiImages.length}/${need}장 생성`);
      } catch (e) {
        console.log(`[pipeline] AI 이미지 생성 실패(건너뜀): ${e.message}`);
      }
    }

    const judgments = slots.map((s, i) => {
      const real = candidates[i];
      const ai = !real ? aiImages[i - candidates.length] : null;
      const isAi = !!ai;
      return {
        slot: s.slot,
        file: real ? real.file : ai ? ai.file : null,
        caption: isAi ? `${s.caption || ''} (AI 연출 이미지)`.trim() : s.caption || '',
        sourceName: isAi ? 'AI 연출 이미지' : '공식 스토어',
        sourceUrl: isAi ? '' : product.url,
        ai: isAi,
        reason: isAi ? 'AI 연출 이미지(상황·공간 분위기)' : '상품 상세 이미지 순서 배치',
      };
    });
    store.saveJudgments(draftId, judgments);

    // 5. 임시저장/발행 (products는 meta에서 읽힘, 뉴스 출처는 없음)
    const postUrl = await publishAndNotify(draftId, article, judgments, visibility, opts.mode || 'draft');
    return { ok: true, postUrl };
  } catch (e) {
    const stopped = e.message && e.message.includes('중지');
    console.error(`[pipeline] ${draftId} (상품) ${stopped ? '중지' : '실패'}:`, e.message);
    store.updateDraft(draftId, { status: 'error', step: stopped ? '⏹ 사용자 요청으로 중지됨' : '실패: ' + e.message, error: e.message });
    return { ok: false, error: e.message };
  }
}

module.exports = { run, runProduct, publishAndNotify };
