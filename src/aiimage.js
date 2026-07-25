// AI 연출 이미지 생성 — 무료 서비스(Pollinations, API 키 불필요) 사용.
// 스킬 규칙: 실제 상품을 그리지 않고, 글의 "문제 상황·사용 공간" 분위기 컷만 생성한다.
// (제품의 형태·색상·로고를 AI가 정확히 재현할 수 없으므로 제품은 넣지 않는다.)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 한글 desc를 영어 장면 프롬프트로 변환(간단) — 카테고리 힌트 + 공통 스타일
function scenePrompt(desc, category) {
  const base =
    'professional lifestyle photography, soft natural light, clean minimal aesthetic, cozy Korean home, no text, no watermark, no brand logo, no product packaging';
  const hint = String(desc || category || '').slice(0, 80);
  return `${hint}, ${base}`;
}

/**
 * AI 연출 이미지 1장 생성해 destPath에 저장. 실패 시 null.
 * @param {string} desc 장면 설명(글의 상황/공간)
 * @param {string} destPath 저장 경로(.jpg)
 * @param {string} category 카테고리 힌트(선택)
 * @param {object} opts {base, width, height} — 숏폼(9:16) 등 다른 비율/화풍이 필요할 때
 */
// 이미지 1장 받아오기. 크로미움을 띄우지 않는 fetch를 먼저 쓰고(빠름),
// 막히면 playwright 요청으로 폴백한다. 429(호출 제한)는 잠시 쉬었다 재시도.
async function fetchImage(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status === 429) return 429;
    console.log(`[aiimage] fetch 실패 HTTP ${r.status} — 브라우저로 재시도`);
  } catch (e) {
    console.log(`[aiimage] fetch 오류(${e.message.split('\n')[0]}) — 브라우저로 재시도`);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const resp = await ctx.request.get(url, { timeout: 120000 });
    if (!resp.ok()) {
      console.log(`[aiimage] 생성 실패 HTTP ${resp.status()}`);
      return resp.status() === 429 ? 429 : null;
    }
    return await resp.body();
  } catch (e) {
    console.log(`[aiimage] 생성 오류: ${e.message.split('\n')[0]}`);
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function generate(desc, destPath, category = '', opts = {}) {
  const prompt = opts.base
    ? `${String(desc || category || '').slice(0, 80)}, ${opts.base}`
    : scenePrompt(desc, category);
  const width = opts.width || 768;
  const height = opts.height || 768;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;

  // 무료 서비스라 호출 제한(429)이 잦다 — 간격을 늘려가며 최대 3번 시도
  for (let attempt = 0; attempt < 3; attempt++) {
    const buf = await fetchImage(url);
    if (buf === 429) {
      const wait = 5000 * (attempt + 1);
      console.log(`[aiimage] 호출 제한(429) — ${wait / 1000}초 후 재시도`);
      await sleep(wait);
      continue;
    }
    if (!buf || buf.length < 8 * 1024) return null; // 너무 작으면 실패로 간주
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return destPath;
  }
  return null;
}

/**
 * 필요한 개수만큼 AI 연출 이미지를 생성해 파일 정보 배열로 반환.
 * @returns {Array} [{file, ai:true, caption}]
 */
async function generateMany(descs, destDir, { prefix = 'ai', category = '', base, width, height, onProgress } = {}) {
  const out = [];
  for (let i = 0; i < descs.length; i++) {
    const file = `${prefix}-${i + 1}.jpg`;
    const full = path.join(destDir, file);
    if (onProgress) onProgress(i + 1, descs.length);
    const ok = await generate(descs[i], full, category, { base, width, height });
    if (ok) out.push({ file, ai: true, caption: descs[i] });
    await sleep(1500); // 무료 서비스 호출 제한(429) 완화
  }
  return out;
}

module.exports = { generate, generateMany };
