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
 */
async function generate(desc, destPath, category = '') {
  const prompt = scenePrompt(desc, category);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const resp = await ctx.request.get(url, { timeout: 90000 });
    if (!resp.ok()) {
      console.log(`[aiimage] 생성 실패 HTTP ${resp.status()}`);
      return null;
    }
    const buf = await resp.body();
    if (buf.length < 8 * 1024) return null; // 너무 작으면 실패로 간주
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    return destPath;
  } catch (e) {
    console.log(`[aiimage] 생성 오류: ${e.message.split('\n')[0]}`);
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * 필요한 개수만큼 AI 연출 이미지를 생성해 파일 정보 배열로 반환.
 * @returns {Array} [{file, ai:true, caption}]
 */
async function generateMany(descs, destDir, { prefix = 'ai', category = '' } = {}) {
  const out = [];
  for (let i = 0; i < descs.length; i++) {
    const file = `${prefix}-${i + 1}.jpg`;
    const full = path.join(destDir, file);
    const ok = await generate(descs[i], full, category);
    if (ok) out.push({ file, ai: true, caption: descs[i] });
    await sleep(500);
  }
  return out;
}

module.exports = { generate, generateMany };
