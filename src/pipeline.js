// 수집 → AI 작성 → 이미지 판정(본문 곳곳 배치) → 임시저장/발행 파이프라인
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const store = require('./store');
const collector = require('./collector');
const writer = require('./writer');
const images = require('./images');
const publisher = require('./publisher');
const brandconnect = require('./brandconnect');
const aiimage = require('./aiimage');
const imageZip = require('./imageZip');

// 링크 분석 결과는 제목을 고르는 짧은 시간 동안만 메모리에 보관한다.
// 네이버 계정 정보나 비밀번호는 저장하지 않는다.
const productPlans = new Map();
const PRODUCT_PLAN_TTL_MS = 30 * 60 * 1000;

async function prepareProductChoices(productUrl) {
  const now = Date.now();
  for (const [id, plan] of productPlans) {
    if (now - plan.createdAt > PRODUCT_PLAN_TTL_MS) productPlans.delete(id);
  }

  const resolved = await brandconnect.resolveProductByUrl(productUrl);
  const product = resolved.product;
  const detail = resolved.detail || {};
  if (!product || !product.name) throw new Error('상품 정보를 확인하지 못했습니다. 링크를 확인해주세요.');
  const choices = await writer.suggestProductHooks(product, detail);
  const planId = crypto.randomUUID();
  productPlans.set(planId, {
    createdAt: now,
    sourceUrl: productUrl,
    product,
    link: resolved.link || productUrl,
    detail,
    choices,
  });
  return {
    planId,
    product: { name: product.name, image: product.image || (detail.images || [])[0] || '' },
    choices,
  };
}

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

// 예전 버전에서 저장된 글감에 남아 있는 상품 자동 연결 문장은 새 건강 글에 넘기지 않는다.
function withoutAffiliateAngle(value) {
  return String(value || '')
    .split(/(?<=[.!?。])\s+/)
    .filter((sentence) => !/제휴|쇼핑\s*커넥트|주력\s*상품|상품으로\s*연결/.test(sentence))
    .join(' ')
    .trim();
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
    const healthTopic = {
      ...topic,
      angle: withoutAffiliateAngle(topic.angle),
      primaryProduct: undefined,
      productReason: undefined,
      productKeywords: undefined,
    };

    // 2. 상품 검색·제휴 링크 발급 없이 건강정보 원고만 충실하게 작성한다.
    store.updateDraft(draftId, {
      products: [],
      healthPlan: {
        problem: healthTopic.problem || '',
        action: healthTopic.action || '',
      },
    });

    // 3. 수집한 건강 자료를 바탕으로 생활 건강정보 글을 작성한다.
    setStep('writing', `건강정보 원고 작성·자체 검수 중 (참고자료 ${refs.length}건)`);
    const article = await writer.writeArticle(healthTopic, refs);
    store.saveArticle(draftId, article);
    store.updateDraft(draftId, {
      title: article.title,
      frameKey: article.frameKey,
      frameLabel: article.frameLabel,
    });

    // 4. 이미지를 생성하지 않고, 나중에 사용자가 채울 이미지 자리와 장면 설명만 준비한다.
    setStep('images', '본문 이미지 자리와 추천 장면을 정리하는 중');
    const slots = article.blocks.filter((block) => block.type === 'image');
    if (slots.length < 4) throw new Error('건강 원고의 이미지 자리가 4개보다 적습니다.');
    const judgments = slots.map((slot) => ({
      slot: slot.slot,
      file: null,
      caption: slot.caption || '',
      desc: slot.desc || slot.caption || `건강 글 이미지 ${slot.slot}`,
      sourceName: '',
      sourceUrl: '',
      ai: false,
      generated: false,
      placeholder: true,
      reason: '이미지를 나중에 넣을 수 있도록 본문 위치와 추천 장면을 표시',
    }));
    store.saveJudgments(draftId, judgments);

    article.assetReview = {
      passed: true,
      imageCount: 0,
      imageSlotCount: slots.length,
      imagesPending: true,
    };
    store.saveArticle(draftId, article);
    store.updateDraft(draftId, {
      imageCount: 0,
      imageSlotCount: slots.length,
      imagesPending: true,
      imageZipAvailable: false,
    });

    // 5. 이미지 자리 안내를 본문 위치에 넣고 기사 출처와 함께 임시저장/발행한다.
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
    const automaticSelection = !opts.planId && !opts.productUrl;
    let product, link, detail;
    let selectedHook = opts.selectedHook || null;

    if (opts.planId) {
      const plan = productPlans.get(opts.planId);
      if (!plan || Date.now() - plan.createdAt > PRODUCT_PLAN_TTL_MS) {
        throw new Error('제목 선택 시간이 지났습니다. 상품 링크로 고민 제목을 다시 받아주세요.');
      }
      const selectedIndex = Number(opts.selectedIndex);
      if (!Number.isInteger(selectedIndex) || !plan.choices[selectedIndex]) {
        throw new Error('작성할 고민 제목을 선택해주세요.');
      }
      productPlans.delete(opts.planId);
      product = plan.product;
      link = plan.link;
      detail = plan.detail || {};
      selectedHook = plan.choices[selectedIndex];
      console.log(`[pipeline] 사용자가 고른 상품 제목: ${selectedHook.title.slice(0, 60)}`);
    } else if (opts.productUrl) {
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

    store.updateDraft(draftId, {
      product,
      keyword: product.query || '쇼핑커넥트 상품',
      title: selectedHook?.title || (product.name || '상품').slice(0, 40),
      selectedProductHook: selectedHook || undefined,
    });
    const products = [{ name: product.name, price: product.price, commission: product.commission, link }];
    store.updateDraft(draftId, { products });

    if (!detail.images || !detail.images.length) {
      console.log('[pipeline] 상세 이미지가 없어 카드 이미지로 대체');
      detail.images = product.image ? [product.image] : [];
    }
    console.log(`[pipeline] 상세 이미지 ${detail.images.length}장 확보`);

    // 3. AI 소개 글 작성
    setStep('writing', automaticSelection
      ? 'AI 초안 작성 후 구매 설득력 자체 검수 중 — 수 분 걸릴 수 있어요'
      : 'AI가 상품 소개 글 작성 중 — 수 분 걸릴 수 있어요');
    const article = await writer.writeProductArticle(product, detail, selectedHook, {
      minImages: 4,
      selfReview: automaticSelection,
    });
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

    if (automaticSelection) {
      const usable = judgments.filter((judgment) => judgment.file && fs.existsSync(judgment.file));
      if (usable.length < 4) {
        throw new Error(`자동 상품 글 이미지 자체 검수 실패: 관련 이미지가 ${usable.length}장뿐입니다. 4장 이상 확보해야 저장합니다.`);
      }
      const zipPath = path.join(store.imagesDir(draftId), 'product-images.zip');
      const zip = imageZip.createZip(usable, zipPath);
      if (zip.count !== usable.length || !fs.existsSync(zipPath)) {
        throw new Error('자동 상품 글 ZIP 자체 검수 실패: 이미지 누락 없이 압축하지 못했습니다.');
      }
      article.assetReview = {
        passed: true,
        imageCount: usable.length,
        imagesDirectlyRelated: judgments.every((judgment) => Boolean(judgment.reason && judgment.file)),
        zipComplete: true,
      };
      if (!article.assetReview.imagesDirectlyRelated) {
        throw new Error('자동 상품 글 이미지 자체 검수 실패: 글과 직접 연결되지 않은 이미지가 있습니다.');
      }
      store.saveArticle(draftId, article);
      store.updateDraft(draftId, {
        qualityScore: article.qualityReview?.score || null,
        qualityPassed: true,
        imageCount: usable.length,
        imageZipAvailable: true,
      });
      console.log(`[pipeline] 자동 상품 글 최종 검수 통과: ${article.qualityReview?.score || 0}점, 이미지 ${usable.length}장, ZIP ${zip.count}장`);
    }

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

module.exports = { run, runProduct, prepareProductChoices, publishAndNotify };
