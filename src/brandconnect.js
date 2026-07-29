// 네이버 브랜드커넥트(쇼핑커넥트) 제휴 상품 검색 + 제휴 링크 발급
// - 상품 검색: /affiliate/products/search?query=... (뷰티·패션 등 상품 목록)
// - 제휴 링크: 상품 상세에서 "링크 발급" → naver.me 단축 제휴 링크 생성(클립보드 복사)
const browserHelper = require('./browser');
const auth = require('./naverAuth');
const codex = require('./codex');

const CREATOR_ID = '719569259757728'; // 사용자의 브랜드커넥트 크리에이터 ID
const BASE = `https://brandconnect.naver.com/${CREATOR_ID}/affiliate`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 브랜드커넥트는 헤드리스 번들 크로미움을 차단하므로 시스템 크롬 채널을 쓴다.
async function withContext(fn) {
  const browser = await browserHelper.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: auth.STATE_PATH,
      locale: 'ko-KR',
      userAgent: UA,
      viewport: { width: 1400, height: 1200 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const result = await fn(context);
    await auth.persistState(context); // 갱신된 쿠키 저장 (세션 연장)
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

// 상품 카드 innerText에서 상품명과 가격을 파싱한다.
// 예: "수수료 5% 판매가 25,000원 할인율 34% 할인가 16,500 원 부쉬맨 워터프루프 프로 선크림 SPF"
function parseCard(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const commission = (t.match(/수수료\s*(\d+)%/) || [])[1] || null;
  // 마지막 "원" 뒤가 상품명 (리뷰/평점 표기는 뒤에서 제거)
  let name = '';
  const lastWon = t.lastIndexOf('원 ');
  if (lastWon !== -1) name = t.slice(lastWon + 2);
  else name = t;
  name = name.replace(/\d+(\.\d+)?\s*리뷰\s*\d+.*$/, '').replace(/★.*$/, '').trim();
  // 대표 가격(할인가 우선, 없으면 첫 가격)
  const priceMatch = t.match(/할인가\s*([\d,]+)/) || t.match(/([\d,]{4,})\s*원/);
  const price = priceMatch ? priceMatch[1].replace(/,/g, '') : null;
  // 반응(리뷰 수·평점) — "4.91 리뷰 324" 형태
  const reviews = parseInt(((t.match(/리뷰\s*([\d,]+)/) || [])[1] || '0').replace(/,/g, ''), 10) || 0;
  const rating = parseFloat((t.match(/(\d\.\d{1,2})\s*리뷰/) || [])[1] || '0') || 0;
  return { name, price, commission, reviews, rating };
}

// 컨텍스트 안에서 상품 검색 (컨텍스트 재사용용 내부 함수)
async function searchInContext(context, query, { maxCount = 8 } = {}) {
  const page = await context.newPage();
  const url = `${BASE}/products/search?query=${encodeURIComponent(query)}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.log(`[brandconnect] 검색 이동 실패 (${query}): ${e.message.split('\n')[0]}`);
  }
  await sleep(6500);
  const items = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/affiliate/products/"]').forEach((a) => {
      if (/\/search/.test(a.href)) return;
      const m = a.href.match(/\/affiliate\/products\/(\d+)/);
      if (!m || seen.has(m[1])) return;
      const text = (a.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < 6) return;
      seen.add(m[1]);
      const img = a.querySelector('img');
      out.push({ id: m[1], url: a.href, text, image: img ? img.src : '' });
    });
    return out;
  });
  await page.close().catch(() => {});
  return items.slice(0, maxCount).map((it) => {
    const parsed = parseCard(it.text);
    return { id: it.id, url: it.url, image: it.image, ...parsed };
  });
}

// 컨텍스트 안에서 제휴 링크 발급 (컨텍스트 재사용용 내부 함수)
async function issueInContext(context, productUrl) {
  const page = await context.newPage();
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.log(`[brandconnect] 상품 이동 실패: ${e.message.split('\n')[0]}`);
  }
  await sleep(5500);

  // "링크 발급"(미발급) 또는 "링크 복사"(이미 발급됨) 둘 중 보이는 걸 누른다.
  const issueBtn = page.locator('button:has-text("링크 발급"), a:has-text("링크 발급")').first();
  if (await issueBtn.isVisible().catch(() => false)) {
    await issueBtn.click().catch(() => {});
    await sleep(2500);
  }
  const copyBtn = page.locator('button:has-text("링크 복사"), a:has-text("링크 복사")').first();
  if (await copyBtn.isVisible().catch(() => false)) {
    await copyBtn.click().catch(() => {});
    await sleep(1500);
  }

  const readLink = async () => {
    let l = await page
      .evaluate(() => {
        for (const i of document.querySelectorAll('input,textarea')) {
          if (/naver\.me|naver\.com\/.*link/i.test(i.value || '')) return i.value;
        }
        const m = document.body.innerText.match(/https?:\/\/naver\.me\/[A-Za-z0-9]+/);
        return m ? m[0] : null;
      })
      .catch(() => null);
    if (!l) {
      l = await page.evaluate(() => navigator.clipboard.readText().catch(() => null)).catch(() => null);
      if (l && !/naver\.me|https?:\/\//.test(l)) l = null;
    }
    return l;
  };

  let link = await readLink();
  if (!link) {
    await sleep(1500);
    link = await readLink();
  }
  await page.close().catch(() => {});
  return link ? link.trim() : null;
}

/** 브랜드커넥트에서 키워드로 제휴 상품을 검색한다. @returns {Array} [{id,url,name,price,commission,image}] */
async function searchProducts(query, opts) {
  if (!auth.hasState()) throw new Error('네이버 로그인이 필요합니다.');
  return withContext((context) => searchInContext(context, query, opts));
}

// 인기 카테고리 키워드 풀 — "지금 반응 좋은 상품"을 찾을 때 돌아가며 검색
const TREND_KEYWORDS = ['선크림', '쿠션', '립밤', '토너', '앰플', '클렌징', '원피스', '여름 가디건', '헤어 에센스', '바디로션'];

/**
 * 지금 반응(리뷰 수) 좋은 제휴 상품 1개를 고른다.
 * 여러 키워드를 검색해 리뷰 수 기준 최상위 상품을 선택. avoidIds로 최근 소개한 상품 제외.
 * @returns {object|null} {id,url,name,price,commission,image,reviews,rating,query}
 */
async function getBestProduct({ keywords, avoidIds = [] } = {}) {
  if (!auth.hasState()) throw new Error('네이버 로그인이 필요합니다.');
  const pool = (keywords && keywords.length ? keywords : TREND_KEYWORDS).slice(0, 5);
  return withContext(async (context) => {
    const all = [];
    for (const q of pool) {
      try {
        const found = await searchInContext(context, q, { maxCount: 8 });
        for (const p of found) all.push({ ...p, query: q });
      } catch (e) {
        console.log(`[brandconnect] 인기상품 검색 실패 (${q}): ${e.message.split('\n')[0]}`);
      }
    }
    const avoid = new Set(avoidIds.map(String));
    const ranked = all
      .filter((p) => p.name && !avoid.has(String(p.id)))
      .sort((a, b) => (b.reviews || 0) - (a.reviews || 0) || (b.rating || 0) - (a.rating || 0));
    return ranked[0] || null;
  });
}

// 상세페이지 텍스트에서 가격·수수료·리뷰 파싱
function parseDetailText(text) {
  const t = String(text).replace(/\s+/g, ' ');
  const commission = (t.match(/수수료\s*(\d+)%/) || [])[1] || null;
  const price = ((t.match(/할인가[^0-9]*([\d,]+)\s*원/) || t.match(/판매가[^0-9]*([\d,]+)\s*원/) || [])[1] || '')
    .replace(/,/g, '') || null;
  const reviews = parseInt(((t.match(/리뷰\s*([\d,]+)/) || [])[1] || '0').replace(/,/g, ''), 10) || 0;
  const rating = parseFloat((t.match(/(\d\.\d{1,2})\s*리뷰/) || [])[1] || '0') || 0;
  return { commission, price, reviews, rating };
}

/**
 * 사용자가 준 상품 링크(쇼핑커넥트 상품 페이지 / naver.me 제휴링크 / 스마트스토어)로
 * 상품 정보·제휴 링크·상세 이미지를 확보한다.
 * @returns {object} { product:{id,url,name,price,commission,reviews,rating,image}, link, detail }
 */
async function resolveProductByUrl(url) {
  if (!auth.hasState()) throw new Error('네이버 로그인이 필요합니다.');
  const bcMatch = url.match(/brandconnect\.naver\.com\/\d+\/affiliate\/products\/(\d+)/);
  if (bcMatch) {
    // 쇼핑커넥트 상품 페이지 → 제휴 링크 발급 + 상세 정보
    const link = await issueAffiliateLink(url).catch(() => null);
    const bc = await getProductDetail(url).catch(() => ({}));
    const info = parseDetailText(bc.description || '');
    let detail = {};
    if (link) detail = await getStoreDetail(link).catch(() => ({}));
    const name = (detail.title || '').split(/\s*:\s*/)[0].trim() || (bc.title || '상품');
    const product = {
      id: bcMatch[1], url, name,
      price: info.price, commission: info.commission, reviews: info.reviews, rating: info.rating,
      image: (detail.images || [])[0] || (bc.images || [])[0] || '',
    };
    return { product, link: link || url, detail: (detail.images && detail.images.length) ? detail : bc };
  }
  // naver.me 단축 링크 / 스마트스토어 직접 링크 → 그 링크로 스토어 상세 수집
  const detail = await getStoreDetail(url).catch(() => ({}));
  const name = (detail.title || '').split(/\s*:\s*/)[0].trim() || '상품';
  const info = parseDetailText(detail.description || '');
  const product = {
    id: null, url, name,
    price: info.price, commission: info.commission, reviews: info.reviews, rating: info.rating,
    image: (detail.images || [])[0] || '',
  };
  return { product, link: url, detail };
}

/**
 * 스마트스토어(브랜드스토어) 상품 페이지에서 판매자 상세 이미지와 설명을 추출한다.
 * 제휴 링크(naver.me)를 그대로 넘기면 스토어 페이지로 리다이렉트되어 수집된다.
 * 판매자 업로드 이미지(shop-phinf)만 사용 — 구매자 리뷰 사진은 제외(저작권).
 * @returns {object} {images:[url], description, title}
 */
async function getStoreDetail(storeUrl) {
  if (!auth.hasState()) throw new Error('네이버 로그인이 필요합니다.');
  return withContext(async (context) => {
    const page = await context.newPage();
    try {
      await page.goto(storeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      console.log(`[brandconnect] 스토어 이동 실패: ${e.message.split('\n')[0]}`);
    }
    await sleep(5000);
    // 상세정보 영역 lazy-load 로딩을 위해 스크롤
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 1600).catch(() => {});
      await sleep(700);
    }
    const detail = await page.evaluate(() => {
      const imgs = [];
      const seen = new Set();
      document.querySelectorAll('img').forEach((i) => {
        const s = i.src || '';
        const w = i.naturalWidth || 0;
        if (!/^https?:\/\/shop-phinf\.pstatic\.net\//.test(s)) return; // 판매자 이미지만
        if (/logo|icon|profile/i.test(s)) return;
        if (w < 400) return; // 상세 컷 위주
        if (seen.has(s)) return;
        seen.add(s);
        imgs.push(s);
      });
      return {
        title: document.title,
        images: imgs.slice(0, 12),
        description: document.body.innerText.replace(/\s+/g, ' ').slice(0, 3000),
        finalUrl: location.href,
      };
    });
    await page.close().catch(() => {});
    return detail;
  });
}

/**
 * (폴백) 브랜드커넥트 상세페이지에서 이미지·설명 추출.
 * @returns {object} {images:[url], description, title}
 */
async function getProductDetail(productUrl) {
  if (!auth.hasState()) throw new Error('네이버 로그인이 필요합니다.');
  return withContext(async (context) => {
    const page = await context.newPage();
    try {
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      console.log(`[brandconnect] 상세 이동 실패: ${e.message.split('\n')[0]}`);
    }
    await sleep(7000);
    const detail = await page.evaluate(() => {
      const imgs = [];
      const seen = new Set();
      document.querySelectorAll('img').forEach((i) => {
        const s = i.src || '';
        const w = i.naturalWidth || i.width || 0;
        if (!/^https?/.test(s) || seen.has(s)) return;
        if (/icon|logo|profile|gnb|sprite|blank/i.test(s)) return;
        if (w < 200) return;
        seen.add(s);
        imgs.push(s);
      });
      return {
        title: document.title,
        images: imgs.slice(0, 12),
        description: document.body.innerText.replace(/\s+/g, ' ').slice(0, 2500),
      };
    });
    await page.close().catch(() => {});
    return detail;
  });
}

/** 상품 상세에서 "링크 발급"을 눌러 제휴 링크(naver.me/...)를 생성해 반환한다. */
async function issueAffiliateLink(productUrl) {
  if (!auth.hasState()) throw new Error('네이버 로그인이 필요합니다.');
  return withContext((context) => issueInContext(context, productUrl));
}

// 글에 팔 만한 쇼핑 검색 키워드를 AI로 뽑는다 (실패 시 예외 → 호출부에서 폴백).
async function aiShoppingKeywords(article, topic) {
  const heads = article.blocks
    .filter((b) => b.type === 'heading' || b.type === 'paragraph')
    .map((b) => b.text)
    .join(' ')
    .slice(0, 1200);
  const prompt = `아래 블로그 글과 관련해 네이버 쇼핑에서 검색하면 나올 만한 "실제 판매 상품 카테고리 키워드"를 2개만 뽑아주세요.
글 제목: ${topic.title}
글 내용 일부: ${heads}

규칙: 사람 이름·추상적 표현 말고, 실제로 살 수 있는 상품 검색어로. (예: "선크림", "여행 파우치", "여름 원피스")
JSON 배열로만: ["키워드1","키워드2"]`;
  const arr = await codex.invokeJson(prompt, { timeoutMs: 60000 });
  return (Array.isArray(arr) ? arr : []).map((s) => String(s).trim()).filter((s) => s.length >= 2).slice(0, 2);
}

/**
 * 글에 관련된 브랜드커넥트 제휴 상품을 매칭해 링크까지 발급한다.
 * @returns {Array} [{name, price, commission, link}]
 */
async function recommendProducts(article, topic, { max = 3 } = {}) {
  if (!auth.hasState()) return [];
  // 1) 검색 키워드 (AI 우선, 실패 시 글감 키워드로 폴백)
  let queries = [];
  try {
    queries = await aiShoppingKeywords(article, topic);
  } catch (e) {
    console.log(`[brandconnect] AI 키워드 추출 실패(폴백 사용): ${e.message.split('\n')[0]}`);
  }
  if (!queries.length) {
    queries = (topic.keywords || []).map((k) => String(k).trim()).filter((k) => k.length >= 2).slice(0, 2);
  }
  if (!queries.length) return [];

  // 2~3) 하나의 브라우저 컨텍스트로 검색 + 링크 발급 (반복 실행 절약)
  return withContext(async (context) => {
    const byId = new Map();
    for (const q of queries.slice(0, 2)) {
      try {
        const found = await searchInContext(context, q, { maxCount: 6 });
        for (const p of found) if (p.name && !byId.has(p.id)) byId.set(p.id, p);
      } catch (e) {
        console.log(`[brandconnect] 검색 실패 (${q}): ${e.message.split('\n')[0]}`);
      }
      if (byId.size >= 8) break;
    }
    const candidates = [...byId.values()];
    if (!candidates.length) return [];

    const out = [];
    for (const p of candidates.slice(0, max)) {
      try {
        const link = await issueInContext(context, p.url);
        if (link) out.push({ name: p.name, price: p.price, commission: p.commission, link });
      } catch (e) {
        console.log(`[brandconnect] 링크 발급 실패 (${p.name}): ${e.message.split('\n')[0]}`);
      }
    }
    return out;
  });
}

module.exports = {
  searchProducts,
  issueAffiliateLink,
  recommendProducts,
  aiShoppingKeywords,
  getBestProduct,
  resolveProductByUrl,
  getProductDetail,
  getStoreDetail,
  TREND_KEYWORDS,
  CREATOR_ID,
};
