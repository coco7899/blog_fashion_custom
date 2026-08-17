// 무료 TTS — 구글 번역 TTS 엔드포인트(키 불필요)로 한국어 내레이션 음성(mp3) 생성.
// 한 번에 ~200자 제한이 있어 문장/어절 경계로 잘라 각 조각을 받아 이어 붙인다.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// 텍스트를 max자 이하 조각으로 — 문장(. ! ? …) 우선, 넘치면 어절 단위
function chunkText(text, max = 180) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const out = [];
  const sents = text.match(/[^.!?…]+[.!?…]*/g) || [text];
  let cur = '';
  for (const raw of sents) {
    const seg = raw.trim();
    if (!seg) continue;
    if ((cur ? cur + ' ' + seg : seg).length <= max) { cur = cur ? cur + ' ' + seg : seg; continue; }
    if (cur) { out.push(cur); cur = ''; }
    if (seg.length <= max) { cur = seg; continue; }
    let w = '';
    for (const word of seg.split(' ')) {
      if ((w ? w + ' ' + word : word).length > max && w) { out.push(w); w = word; }
      else w = w ? w + ' ' + word : word;
    }
    if (w) cur = w;
  }
  if (cur) out.push(cur);
  return out;
}

function ttsUrl(text) {
  return 'https://translate.google.com/translate_tts?ie=UTF-8&tl=ko&client=tw-ob&q=' + encodeURIComponent(text);
}

async function fetchChunk(text) {
  const url = ttsUrl(text);
  const headers = { 'User-Agent': UA, Referer: 'https://translate.google.com/' };
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (r.ok) {
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > 500) return b;
    }
  } catch (e) {
    /* 폴백으로 진행 */
  }
  // 차단 시 headless 크로미움으로 재시도
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const resp = await ctx.request.get(url, { headers, timeout: 30000 });
    if (resp.ok()) {
      const b = await resp.body();
      if (b.length > 500) return b;
    }
  } catch (e) {
    /* null 반환 */
  } finally {
    await browser.close().catch(() => {});
  }
  return null;
}

// 한 장면의 내레이션 → mp3 Buffer (조각 mp3를 이어 붙임)
async function synthesize(text) {
  const chunks = chunkText(text);
  if (!chunks.length) return null;
  const parts = [];
  for (const c of chunks) {
    const b = await fetchChunk(c);
    if (b) parts.push(b);
    await sleep(300); // 호출 간격
  }
  if (!parts.length) return null;
  return Buffer.concat(parts);
}

module.exports = { synthesize, chunkText };
