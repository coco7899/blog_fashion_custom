// 네이버 뉴스/블로그 검색 수집 + 본문/이미지 추출 + 이미지 다운로드
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const sizeOf = require('image-size');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'ko-KR' });
    return await fn(context);
  } finally {
    await browser.close().catch(() => {});
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 네이버 블로그 이미지 호스트 — 타인 블로그 이미지는 절대 사용하지 않는다
const BLOG_IMG_HOSTS = /(postfiles\.pstatic\.net|blogfiles\.naver\.net|mblogthumb-phinf\.pstatic\.net|blogpfthumb|blogthumb)/i;
function isBlogImage(url) {
  return !url || BLOG_IMG_HOSTS.test(url) || /blog\.naver\.com/i.test(url);
}

/** 네이버 통합검색 뉴스 탭 + 블로그 탭에서 상위 결과 수집. recentNews=true면 최신순 */
async function searchNaver(keyword, { recentNews = false } = {}) {
  return withBrowser(async (context) => {
    const page = await context.newPage();
    const enc = encodeURIComponent(keyword);
    const sort = recentNews ? '&sort=1' : '';

    // ── 뉴스 탭
    await page.goto(`https://search.naver.com/search.naver?where=news&query=${enc}${sort}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(1500);
    const news = await page.evaluate(() => {
      const seen = new Set();
      const items = [];
      // 기사 날짜 추출 — 제목 앵커에서 위 조상으로 올라가며 "3시간 전 / 1일 전 / 2026.07.20." 탐색.
      // (새 UI는 li/news_area가 없고 sds-comps-* div 구조라 조상 순회로 찾는다.)
      // 상대/절대 표기를 실제 날짜(YYYY.MM.DD)로 정규화 — "며칠 뉴스인지" 명확히 보이게
      const toAbsDate = (raw) => {
        const s = raw.replace(/\s+/g, '');
        const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        // 이미 절대 날짜면 그대로 정리해서 반환
        const abs = s.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
        if (abs) return `${abs[1]}.${String(+abs[2]).padStart(2, '0')}.${String(+abs[3]).padStart(2, '0')}`;
        // 상대 표기 → 오늘 기준 계산
        const rel = s.match(/(\d+)(분|시간|일|주|개월)전/);
        if (rel) {
          const n = +rel[1];
          const d = new Date();
          if (rel[2] === '분' || rel[2] === '시간') return fmt(d); // 오늘
          if (rel[2] === '일') d.setDate(d.getDate() - n);
          else if (rel[2] === '주') d.setDate(d.getDate() - n * 7);
          else if (rel[2] === '개월') d.setMonth(d.getMonth() - n);
          return fmt(d);
        }
        return '';
      };
      const dateFrom = (a) => {
        let el = a;
        for (let i = 0; i < 6 && el; i++) {
          el = el.parentElement;
          if (!el) break;
          const txt = el.innerText || '';
          if (txt.length > 800) break; // 리스트 전체 컨테이너면 중단
          const m = txt.match(/(\d+\s*(?:분|시간|일|주|개월)\s*전)|(\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?)/);
          if (m) return toAbsDate(m[0]);
        }
        return '';
      };
      const push = (title, url, a, source) => {
        title = (title || '').trim();
        if (!title || title.length < 8 || !url || seen.has(url)) return;
        seen.add(url);
        items.push({ kind: 'news', title, url, source: (source || '').trim(), date: dateFrom(a) });
      };
      // 구형 UI
      document.querySelectorAll('a.news_tit').forEach((a) => {
        const area = a.closest('.news_area') || a.closest('li');
        const press = area && area.querySelector('.info.press');
        push(a.title || a.innerText, a.href, a, press && press.innerText);
      });
      // 신형 UI (headline 스팬)
      document.querySelectorAll('span[class*="headline"]').forEach((s) => {
        const a = s.closest('a');
        if (a) push(s.innerText, a.href, a, '');
      });
      // 폴백: 네이버뉴스 링크
      document.querySelectorAll('a[href*="n.news.naver.com"]').forEach((a) => {
        push(a.innerText, a.href, a, '');
      });
      return items.slice(0, 12);
    });

    await sleep(800);

    // ── 블로그 탭
    await page.goto(`https://search.naver.com/search.naver?ssc=tab.blog.all&query=${enc}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(1500);
    const blogs = await page.evaluate(() => {
      const seen = new Set();
      const items = [];
      const push = (title, url, source) => {
        title = (title || '').trim();
        if (!title || title.length < 8 || !url || seen.has(url)) return;
        if (!/blog\.naver\.com\/[^/]+\/\d+/.test(url)) return;
        seen.add(url);
        items.push({ kind: 'blog', title, url, source: (source || '').trim() });
      };
      document.querySelectorAll('a.title_link').forEach((a) => {
        const box = a.closest('.view_wrap, .detail_box, li');
        const name = box && box.querySelector('.name, .user_info a');
        push(a.innerText, a.href, name && name.innerText);
      });
      // 폴백: 블로그 글 링크 전체 스캔
      document.querySelectorAll('a[href*="blog.naver.com"]').forEach((a) => {
        push(a.innerText, a.href, '');
      });
      return items.slice(0, 8);
    });

    await page.close().catch(() => {});
    return { news, blogs };
  });
}

/** 개별 기사/블로그 글에서 본문 텍스트와 이미지 URL 추출 */
async function extractArticle(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1200);
    let text = '';
    let images = [];
    const title = await page.title().catch(() => '');

    if (/blog\.naver\.com/.test(url)) {
      // 네이버 블로그: mainFrame iframe 안의 스마트에디터 본문
      let frame = page.frames().find((f) => f.name() === 'mainFrame') || page.mainFrame();
      await frame.waitForSelector('.se-main-container', { timeout: 8000 }).catch(() => {});
      const data = await frame
        .evaluate(() => {
          const el = document.querySelector('.se-main-container') || document.body;
          const imgs = Array.from(el.querySelectorAll('img'))
            .map((i) => i.getAttribute('data-lazy-src') || i.src)
            .filter((s) => s && s.startsWith('http'));
          return { text: el.innerText, imgs };
        })
        .catch(() => ({ text: '', imgs: [] }));
      text = data.text;
      images = data.imgs;
    } else {
      const data = await page.evaluate(() => {
        const pickText = () => {
          const dic = document.querySelector('#dic_area'); // 네이버 뉴스 본문
          if (dic) return dic.innerText;
          const art = document.querySelector('article');
          if (art && art.innerText.length > 300) return art.innerText;
          // 폴백: 문단 텍스트 결합
          return Array.from(document.querySelectorAll('p'))
            .map((p) => p.innerText.trim())
            .filter((t) => t.length > 40)
            .join('\n');
        };
        const imgs = new Set();
        const og = document.querySelector('meta[property="og:image"]');
        if (og && og.content) imgs.add(og.content);
        const scope = document.querySelector('#dic_area, article') || document.body;
        scope.querySelectorAll('img').forEach((i) => {
          const s = i.getAttribute('data-src') || i.src;
          if (s && s.startsWith('http')) imgs.add(s);
        });
        return { text: pickText(), imgs: Array.from(imgs) };
      });
      text = data.text;
      images = data.imgs;
    }

    return {
      url,
      title,
      text: String(text || '').replace(/\n{3,}/g, '\n\n').slice(0, 6000),
      images: images.slice(0, 10),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/** 참고자료(뉴스/블로그) 목록의 본문을 순차 수집 */
async function collectReferences(sources) {
  return withBrowser(async (context) => {
    const refs = [];
    for (const src of sources) {
      try {
        const art = await extractArticle(context, src.url);
        if (art.text && art.text.length > 200) {
          refs.push({ ...src, ...art });
        }
      } catch (e) {
        console.log(`[collector] 본문 추출 실패 (${src.url}): ${e.message}`);
      }
      await sleep(900);
    }
    return refs;
  });
}

/**
 * 관련 뉴스 기사에서 이미지를 보충 수집한다 (타인 블로그 이미지는 쓰지 않으므로 뉴스에서만).
 * 뉴스 기사 본문에는 연예인 인스타그램 사진이 함께 실린 경우가 많아 그런 이미지도 여기서 얻는다.
 * @returns {Array} [{url, referer, sourceName}]  (블로그 이미지는 제외)
 */
async function searchNewsImages(keyword, { maxArticles = 5 } = {}) {
  const { news } = await searchNaver(keyword, { recentNews: true });
  const top = news.slice(0, maxArticles);
  return withBrowser(async (context) => {
    const out = [];
    for (const src of top) {
      try {
        const art = await extractArticle(context, src.url);
        for (const u of art.images || []) {
          if (isBlogImage(u)) continue;
          out.push({ url: u, referer: src.url, sourceName: src.source || src.title });
        }
      } catch (e) {
        console.log(`[collector] 뉴스 이미지 수집 실패 (${src.url}): ${e.message}`);
      }
      await sleep(700);
    }
    return out;
  });
}

/**
 * 네이버 이미지 검색으로 주제에 맞는 뉴스 이미지를 수집한다.
 * 검색 결과는 search.pstatic.net 프록시 URL이고 그 안 src= 파라미터에 원본 주소가 들어있다.
 * 원본이 블로그(blogfiles 등)면 제외하고 뉴스(imgnews 등)만 남긴다. 각 이미지의 alt 설명도 함께 반환.
 * @returns {Array} [{url, referer, sourceName, alt}]
 */
async function searchImages(query, { maxCount = 15 } = {}) {
  return withBrowser(async (context) => {
    const page = await context.newPage();
    const enc = encodeURIComponent(query);
    try {
      await page.goto(`https://search.naver.com/search.naver?where=image&query=${enc}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2200);
      const items = await page.evaluate(() => {
        const res = [];
        document.querySelectorAll('img').forEach((i) => {
          const s = i.src || '';
          const m = s.match(/[?&]src=([^&]+)/);
          if (!m) return;
          let orig;
          try {
            orig = decodeURIComponent(m[1]);
          } catch {
            return;
          }
          if (!/^https?:\/\//.test(orig)) return;
          res.push({ url: orig, alt: (i.alt || '').trim() });
        });
        return res;
      });
      await page.close().catch(() => {});
      const seen = new Set();
      return items
        .filter((it) => !isBlogImage(it.url) && !seen.has(it.url) && seen.add(it.url))
        .slice(0, maxCount)
        .map((it) => ({ url: it.url, referer: 'https://search.naver.com/', sourceName: '뉴스 기사', alt: it.alt }));
    } catch (e) {
      console.log(`[collector] 이미지 검색 실패 (${query}): ${e.message}`);
      await page.close().catch(() => {});
      return [];
    }
  });
}

/**
 * 이미지 URL들을 다운로드해 destDir/raw-N.jpg 로 저장.
 * 너무 작은 이미지(로고/아이콘)와 블로그 이미지는 제외. 각 이미지에 출처 정보를 붙여 반환.
 */
async function downloadImages(imageList, destDir, { maxCount = 8 } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  return withBrowser(async (context) => {
    const saved = [];
    let n = 0;
    const seen = new Set();
    for (const item of imageList) {
      if (saved.length >= maxCount) break;
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      if (isBlogImage(item.url)) continue; // 타인 블로그 이미지 차단 (안전장치)
      try {
        const resp = await context.request.get(item.url, {
          headers: { referer: item.referer || 'https://www.naver.com/', 'user-agent': UA },
          timeout: 15000,
        });
        if (!resp.ok()) continue;
        const buf = await resp.body();
        if (buf.length < 8 * 1024) continue; // 너무 작은 파일 제외
        let dim;
        try {
          dim = sizeOf(buf);
        } catch {
          continue;
        }
        if (!dim || dim.width < 300 || dim.height < 200) continue;
        const ext = dim.type === 'png' ? 'png' : dim.type === 'webp' ? 'webp' : dim.type === 'gif' ? 'gif' : 'jpg';
        n += 1;
        const file = `raw-${n}.${ext}`;
        fs.writeFileSync(path.join(destDir, file), buf);
        saved.push({
          file,
          width: dim.width,
          height: dim.height,
          sourceUrl: item.referer || item.url,
          sourceName: item.sourceName || '',
          alt: item.alt || '',
        });
      } catch {
        // 개별 이미지 실패는 무시
      }
      await sleep(400);
    }
    return saved;
  });
}

module.exports = { searchNaver, collectReferences, downloadImages, withBrowser, extractArticle, searchNewsImages, searchImages, isBlogImage };
