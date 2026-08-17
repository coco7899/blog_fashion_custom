// AI 연출 이미지 생성 — Pollinations를 우선 사용하고, 외부 서비스가 막히면
// 앱 내부에서 건강 일러스트 JPG를 생성해 포스팅이 중단되지 않게 한다.
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
async function fetchImage(url, headers = {}) {
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(45000),
    });
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok && type.startsWith('image/') && buffer.length >= 8 * 1024,
      status: response.status,
      type,
      buffer,
    };
  } catch (e) {
    console.log(`[aiimage] 외부 이미지 요청 오류: ${e.message.split('\n')[0]}`);
    return { ok: false, status: 0, type: '', buffer: null };
  }
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sceneKind(value) {
  const text = String(value || '');
  if (/수면|잠|침대|밤/.test(text)) return 'sleep';
  if (/운동|걷기|근력|스트레칭/.test(text)) return 'exercise';
  if (/잡곡|보리|식이섬유|장 건강|곡물/.test(text)) return 'grain';
  if (/아침|과일|요거트|식사|식재료|건강식품/.test(text)) return 'meal';
  return 'wellness';
}

function sceneShape(kind) {
  if (kind === 'sleep') {
    return `<circle cx="690" cy="180" r="70" fill="#fff3b0"/>
      <circle cx="720" cy="155" r="70" fill="#d8eef0"/>
      <rect x="170" y="430" width="430" height="120" rx="28" fill="#ffffff"/>
      <rect x="210" y="390" width="155" height="82" rx="32" fill="#f4f7f8"/>
      <path d="M170 510h500v95H170z" fill="#7ab6a3"/><path d="M640 510v110" stroke="#47796d" stroke-width="20"/>`;
  }
  if (kind === 'exercise') {
    return `<circle cx="430" cy="225" r="58" fill="#f4c7a1"/>
      <path d="M430 290v205M430 335l-135 95M430 335l145-70M430 495l-105 150M430 495l120 140" stroke="#386b63" stroke-width="34" stroke-linecap="round"/>
      <circle cx="165" cy="240" r="95" fill="#83bd91"/><rect x="145" y="315" width="38" height="230" rx="16" fill="#8b6a4f"/>
      <path d="M80 650q330-120 700 0" fill="none" stroke="#a7ceb0" stroke-width="34"/>`;
  }
  if (kind === 'grain') {
    return `<path d="M180 380h500q-35 245-250 245T180 380z" fill="#ffffff"/>
      <ellipse cx="430" cy="380" rx="250" ry="82" fill="#e8c98d"/>
      <g fill="#9f7549"><circle cx="300" cy="355" r="18"/><circle cx="360" cy="390" r="16"/><circle cx="430" cy="350" r="19"/><circle cx="505" cy="392" r="17"/><circle cx="570" cy="352" r="18"/></g>
      <path d="M675 220q-120 5-150 120 120 0 150-120zM205 235q115 10 140 120-115-5-140-120z" fill="#69a77d"/>`;
  }
  if (kind === 'meal') {
    return `<ellipse cx="430" cy="555" rx="285" ry="75" fill="#b38a63" opacity=".3"/>
      <path d="M210 350h440q-30 235-220 235T210 350z" fill="#ffffff"/>
      <ellipse cx="430" cy="350" rx="220" ry="72" fill="#f4efe2"/>
      <circle cx="335" cy="330" r="48" fill="#ef7b72"/><circle cx="430" cy="350" r="52" fill="#f0c45d"/><circle cx="520" cy="325" r="46" fill="#7fad76"/>
      <path d="M720 250q-120 5-150 120 120 0 150-120z" fill="#5ea277"/>`;
  }
  return `<circle cx="430" cy="410" r="225" fill="#ffffff" opacity=".92"/>
    <path d="M430 555V330M430 425q-145-5-165-145 145 15 165 145zM430 475q145-5 165-145-145 15-165 145z" fill="#6eae82" stroke="#4c8767" stroke-width="18" stroke-linejoin="round"/>
    <circle cx="430" cy="225" r="48" fill="#f0c45d"/>`;
}

async function generateLocalFallback(desc, destPath, category, { width, height } = {}) {
  const imageWidth = width || 768;
  const imageHeight = height || 768;
  const seed = hashText(`${category}|${desc}`);
  const palettes = [
    ['#e4f3ec', '#b8dcca'], ['#e8f3f5', '#b7d9dc'], ['#f6efe2', '#e1c99e'], ['#eef0fa', '#c9d0ed'],
  ];
  const [top, bottom] = palettes[seed % palettes.length];
  const kind = sceneKind(`${category} ${desc}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: imageWidth, height: imageHeight } });
    await page.setContent(`<!doctype html><html><body style="margin:0;overflow:hidden"><svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 860 768">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
      <rect width="860" height="768" fill="url(#bg)"/><circle cx="90" cy="90" r="135" fill="#fff" opacity=".28"/><circle cx="790" cy="700" r="185" fill="#fff" opacity=".22"/>
      ${sceneShape(kind)}
    </svg></body></html>`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await page.screenshot({ path: destPath, type: 'jpeg', quality: 90 });
    return fs.existsSync(destPath) && fs.statSync(destPath).size >= 8 * 1024;
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
  const seed = Math.floor(Math.random() * 100000);
  const apiKey = String(process.env.POLLINATIONS_API_KEY || '').trim();
  const requests = [];
  if (apiKey) {
    requests.push({
      url: `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=zimage&width=${width}&height=${height}&nologo=true&seed=${seed}`,
      headers: { Authorization: `Bearer ${apiKey}` },
      label: '공식 API',
    });
  }
  requests.push({
    url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&model=flux&seed=${seed}`,
    headers: {},
    label: '무료 API',
  });

  for (const request of requests) {
    const result = await fetchImage(request.url, request.headers);
    if (result.ok) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, result.buffer);
      return { path: destPath, fallback: false, provider: request.label };
    }
    console.log(`[aiimage] ${request.label} 실패 HTTP ${result.status || '연결 오류'} — 내부 생성 이미지로 대체`);
    if (result.status === 429) await sleep(1500);
  }

  try {
    const made = await generateLocalFallback(desc, destPath, category, { width, height });
    if (made) {
      console.log('[aiimage] 내부 건강 일러스트 생성 완료');
      return { path: destPath, fallback: true, provider: '내부 생성 이미지' };
    }
  } catch (error) {
    console.log(`[aiimage] 내부 생성 이미지 실패: ${error.message}`);
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
    const result = await generate(descs[i], full, category, { base, width, height });
    if (result) out.push({
      file,
      ai: !result.fallback,
      generated: true,
      fallback: Boolean(result.fallback),
      provider: result.provider,
      caption: descs[i],
      index: i,
    });
    await sleep(1500); // 무료 서비스 호출 제한(429) 완화
  }
  return out;
}

module.exports = { generate, generateMany };
