// 숏폼 생성기 — 대본 편집 + Canvas 렌더링 + MediaRecorder 다운로드
// 서버는 "대본 + 장면 배경 이미지"까지만 준비하고, 영상 인코딩은 여기(브라우저)서 한다.
const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
};

const draftId = new URLSearchParams(location.search).get('id');
const W = 1080;
const H = 1920;
const FONT = "'Malgun Gothic', 'Pretendard', 'Apple SD Gothic Neo', sans-serif";

const THEMES = {
  dark:  { text: '#ffffff', sub: '#e8eef3', accent: '#03c75a', chipText: '#ffffff', box: 'rgba(0,0,0,.52)', dim: .38 },
  light: { text: '#14181c', sub: '#3b444c', accent: '#2563eb', chipText: '#ffffff', box: 'rgba(255,255,255,.80)', dim: -.30 },
  vivid: { text: '#ffffff', sub: '#fff4c2', accent: '#ff2d55', chipText: '#ffffff', box: 'rgba(10,10,14,.62)', dim: .42 },
};

let sf = null;                 // 서버의 shortform 문서
const imgCache = new Map();    // file → HTMLImageElement
let playing = false;
let playT = 0;                 // 현재 재생 위치(초)
let rafId = null;

const canvas = $('stage');
const ctx = canvas.getContext('2d');

// ── 공통 유틸 ────────────────────────────────
const totalSec = () => (sf ? sf.scenes.reduce((a, s) => a + (Number(s.seconds) || 4), 0) : 0);

function sceneAt(t) {
  let acc = 0;
  for (let i = 0; i < sf.scenes.length; i++) {
    const d = Number(sf.scenes[i].seconds) || 4;
    if (t < acc + d || i === sf.scenes.length - 1) {
      return { index: i, scene: sf.scenes[i], local: Math.min(d, Math.max(0, t - acc)), dur: d, start: acc };
    }
    acc += d;
  }
  return { index: 0, scene: sf.scenes[0], local: 0, dur: 4, start: 0 };
}

function loadImage(file) {
  if (!file) return Promise.resolve(null);
  if (imgCache.has(file)) return Promise.resolve(imgCache.get(file));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { imgCache.set(file, img); resolve(img); };
    img.onerror = () => { imgCache.set(file, null); resolve(null); };
    img.src = `/api/drafts/${draftId}/shortform/media/${encodeURIComponent(file)}`;
  });
}

const preloadAll = () => Promise.all((sf.scenes || []).map((s) => loadImage(s.file)));

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 명시적 줄바꿈(\n)을 먼저 지키고, 길면 폭에 맞춰 추가로 감싼다 (한글은 글자 단위)
function wrapLines(text, maxWidth) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) { out.push(''); continue; }
    if (ctx.measureText(line).width <= maxWidth) { out.push(line); continue; }
    let cur = '';
    for (const ch of line) {
      const next = cur + ch;
      if (ctx.measureText(next).width > maxWidth && cur) {
        out.push(cur);
        cur = ch === ' ' ? '' : ch;
      } else {
        cur = next;
      }
    }
    if (cur) out.push(cur);
  }
  return out.slice(0, 4);
}

const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// ── 한 프레임 그리기 ─────────────────────────
function drawFrame(t) {
  const st = sf.style || {};
  const th = THEMES[st.theme] || THEMES.dark;
  const { scene, local, dur, index } = sceneAt(t);
  const img = imgCache.get(scene.file) || null;
  const p = dur ? local / dur : 0;

  // 배경 — cover 맞춤 + 천천히 확대(켄번즈)
  ctx.save();
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, W, H);
  if (img && img.width) {
    const zoom = st.kenBurns ? 1.04 + 0.09 * p : 1.04;
    const scale = Math.max(W / img.width, H / img.height) * zoom;
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1f2937');
    g.addColorStop(1, '#0b0d10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  // 가독성 오버레이 — dim이 음수면 흰색으로 덮는다(라이트 테마)
  const og = ctx.createLinearGradient(0, 0, 0, H);
  if (th.dim >= 0) {
    og.addColorStop(0, `rgba(0,0,0,${(th.dim + 0.24).toFixed(3)})`);
    og.addColorStop(0.42, `rgba(0,0,0,${(th.dim * 0.55).toFixed(3)})`);
    og.addColorStop(1, `rgba(0,0,0,${(th.dim + 0.20).toFixed(3)})`);
  } else {
    const a = -th.dim;
    og.addColorStop(0, `rgba(255,255,255,${(a + 0.30).toFixed(3)})`);
    og.addColorStop(0.42, `rgba(255,255,255,${a.toFixed(3)})`);
    og.addColorStop(1, `rgba(255,255,255,${(a + 0.25).toFixed(3)})`);
  }
  ctx.fillStyle = og;
  ctx.fillRect(0, 0, W, H);

  // ── 상단 후킹 (영상 내내 고정) ──
  const hookSize = Number(st.hookSize) || 76;
  const hookY = 172;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${hookSize}px ${FONT}`;
  const hookLines = wrapLines(sf.hook || '', W - 180).slice(0, 2);
  const hookLH = hookSize * 1.22;
  const hookH = hookLines.length * hookLH;
  const hookW = Math.min(W - 100, Math.max(...hookLines.map((l) => ctx.measureText(l).width), 0) + 84);

  ctx.save();
  ctx.fillStyle = th.accent;
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, (W - hookW) / 2, hookY - hookH / 2 - 26, hookW, hookH + 52, 26);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = th.chipText;
  hookLines.forEach((l, i) => {
    ctx.fillText(l, W / 2, hookY - hookH / 2 + hookLH / 2 + i * hookLH);
  });

  if (sf.hookSub) {
    ctx.font = `600 ${Math.round(hookSize * 0.42)}px ${FONT}`;
    ctx.fillStyle = th.sub;
    ctx.save();
    ctx.shadowColor = th.dim >= 0 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.7)';
    ctx.shadowBlur = 12;
    ctx.fillText(sf.hookSub, W / 2, hookY + hookH / 2 + 62);
    ctx.restore();
  }

  // ── 대본 자막: 화면 정가운데에서 offsetY 만큼 아래 ──
  const textSize = Number(st.textSize) || 60;
  const offsetY = Number.isFinite(Number(st.offsetY)) ? Number(st.offsetY) : 10;
  ctx.font = `700 ${textSize}px ${FONT}`;
  const lines = wrapLines(scene.text || '', W - 190);
  const lh = textSize * 1.42;
  const blockTop = H / 2 + offsetY;          // ← 요구 스펙: 가운데에서 10px 아래가 대본 시작점
  const blockH = lines.length * lh;

  // 장면 전환 시 살짝 떠오르며 나타나기 (0.35초)
  const appear = easeOut(local / 0.35);
  ctx.save();
  ctx.globalAlpha = appear;
  ctx.translate(0, (1 - appear) * 26);

  if (st.boxed && lines.length) {
    const boxW = Math.min(W - 80, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 76);
    ctx.fillStyle = th.box;
    roundRect(ctx, (W - boxW) / 2, blockTop - 34, boxW, blockH + 68, 28);
    ctx.fill();
  }

  ctx.fillStyle = th.text;
  ctx.lineJoin = 'round';
  lines.forEach((l, i) => {
    const y = blockTop + lh / 2 + i * lh;
    if (!st.boxed) {
      ctx.strokeStyle = th.dim >= 0 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.75)';
      ctx.lineWidth = Math.round(textSize * 0.16);
      ctx.strokeText(l, W / 2, y);
    }
    ctx.fillText(l, W / 2, y);
  });
  ctx.restore();

  // ── 하단 진행 바 (장면 단위) ──
  const barY = H - 118;
  const barW = W - 160;
  const gap = 10;
  const segW = (barW - gap * (sf.scenes.length - 1)) / sf.scenes.length;
  for (let i = 0; i < sf.scenes.length; i++) {
    const x = 80 + i * (segW + gap);
    ctx.fillStyle = th.dim >= 0 ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.18)';
    roundRect(ctx, x, barY, segW, 8, 4);
    ctx.fill();
    const fill = i < index ? 1 : i === index ? p : 0;
    if (fill > 0) {
      ctx.fillStyle = th.accent;
      roundRect(ctx, x, barY, segW * fill, 8, 4);
      ctx.fill();
    }
  }
}

function render() {
  if (!sf || !sf.scenes || !sf.scenes.length) return;
  drawFrame(playT);
  const total = totalSec();
  $('seek').value = total ? Math.round((playT / total) * 1000) : 0;
  $('timeLabel').textContent = `${playT.toFixed(1)} / ${total.toFixed(1)}초`;
}

// ── 재생 ─────────────────────────────────────
// 탭이 가려지거나 화면이 합성되지 않으면 requestAnimationFrame이 몇 초씩 멈춘다.
// 타이머와 경주시켜 어떤 상황에서도 다음 프레임이 오도록 한다.
function nextTick() {
  return new Promise((resolve) => {
    let done = false;
    const fire = () => { if (!done) { done = true; resolve(); } };
    rafId = requestAnimationFrame(fire);
    setTimeout(fire, 33);
  });
}

// 시작 시각 기준으로 "지금 보여야 할 프레임"을 그린다 → 프레임이 밀려도 전체 길이는 유지
async function startLoop(onEnd) {
  const total = totalSec();
  const t0 = performance.now() - playT * 1000;
  playing = true;
  $('playBtn').textContent = '❚❚ 정지';
  while (playing) {
    playT = Math.min(total, (performance.now() - t0) / 1000);
    render();
    if (playT >= total) break;
    await nextTick();
  }
  const finished = playT >= total;
  stopLoop();
  if (finished && onEnd) onEnd();
}

function stopLoop() {
  playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  $('playBtn').textContent = '▶ 재생';
}

$('playBtn').onclick = () => {
  if (playing) return stopLoop();
  if (playT >= totalSec() - 0.05) playT = 0;
  startLoop();
};

$('seek').oninput = (e) => {
  stopLoop();
  playT = (Number(e.target.value) / 1000) * totalSec();
  render();
};

// ── 영상 다운로드 (MediaRecorder) ────────────
function pickMime() {
  const list = [
    'video/mp4;codecs=avc1.42E01E',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

$('exportBtn').onclick = async () => {
  if (!window.MediaRecorder) return alert('이 브라우저는 영상 녹화를 지원하지 않습니다. Chrome/Edge에서 열어주세요.');
  const mime = pickMime();
  if (!mime) return alert('이 브라우저에서 지원하는 영상 코덱을 찾지 못했습니다.');

  const btn = $('exportBtn');
  const st = $('exportStatus');
  btn.disabled = true;
  stopLoop();
  st.hidden = false;
  st.className = 'status';
  st.textContent = '녹화 준비 중...';

  try {
    await preloadAll();
    // captureStream(0): 자동 캡처를 끄고 프레임마다 직접 requestFrame() 한다.
    // 화면 합성 상태와 무관하게 그린 프레임이 그대로 영상에 들어간다.
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));

    const total = totalSec();
    playT = 0;
    drawFrame(0);
    rec.start(200);

    const t0 = performance.now();
    let frames = 0;
    for (;;) {
      playT = Math.min(total, (performance.now() - t0) / 1000);
      drawFrame(playT);
      if (track.requestFrame) track.requestFrame();
      frames++;
      st.textContent = `녹화 중... ${playT.toFixed(1)} / ${total.toFixed(1)}초`;
      if (playT >= total) break;
      await nextTick();
    }
    await new Promise((r) => setTimeout(r, 300)); // 마지막 프레임이 인코더에 들어갈 여유
    rec.stop();
    await stopped;
    console.log(`[shortform] ${frames}프레임 / ${total}초 녹화`);
    render();

    const blob = new Blob(chunks, { type: mime });
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const name = `shortform-${(sf.title || draftId).replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}.${ext}`;
    downloadBlob(blob, name);
    st.textContent = `✅ ${name} (${(blob.size / 1024 / 1024).toFixed(1)}MB) 다운로드 완료${
      ext === 'webm' ? ' — 인스타/틱톡 업로드 전 mp4 변환이 필요할 수 있습니다.' : ''
    }`;
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

$('pngBtn').onclick = () => {
  canvas.toBlob((b) => downloadBlob(b, `shortform-scene-${sceneAt(playT).index + 1}.png`), 'image/png');
};

$('txtBtn').onclick = () => {
  const lines = [
    `[숏폼 대본] ${sf.title || ''}`,
    `후킹: ${sf.hook}${sf.hookSub ? ` / ${sf.hookSub}` : ''}`,
    `전체 길이: 약 ${totalSec().toFixed(0)}초`,
    '',
    ...sf.scenes.map(
      (s, i) =>
        `#${i + 1} (${s.seconds}초)\n  자막: ${String(s.text).replace(/\n/g, ' / ')}\n  내레이션: ${s.narration || '-'}`
    ),
    '',
    `캡션: ${sf.caption || ''}`,
    `해시태그: ${(sf.hashtags || []).map((h) => '#' + h).join(' ')}`,
  ];
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `shortform-script-${draftId}.txt`);
};

// ── 편집 UI ──────────────────────────────────
function bindStyleControl(id, key, fmt) {
  const el = $(id);
  const label = $(id + 'Val');
  el.oninput = () => {
    sf.style[key] = Number(el.value);
    if (label) label.textContent = fmt ? fmt(el.value) : el.value;
    render();
  };
}

function fillEditor() {
  $('sfTitle').textContent = sf.title || '';
  $('hookInput').value = sf.hook || '';
  $('hookSubInput').value = sf.hookSub || '';
  $('captionInput').value = sf.caption || '';
  $('tagsLine').textContent = (sf.hashtags || []).map((h) => '#' + h).join(' ');

  const st = sf.style || {};
  $('offsetY').value = st.offsetY ?? 10;
  $('offsetYVal').textContent = (st.offsetY ?? 10) + 'px';
  $('hookSize').value = st.hookSize ?? 76;
  $('hookSizeVal').textContent = st.hookSize ?? 76;
  $('textSize').value = st.textSize ?? 60;
  $('textSizeVal').textContent = st.textSize ?? 60;
  $('theme').value = st.theme || 'dark';
  $('boxed').checked = st.boxed !== false;
  $('kenBurns').checked = st.kenBurns !== false;

  renderScenes();
}

function renderScenes() {
  const wrap = $('scenesList');
  wrap.innerHTML = '';
  sf.scenes.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sf-scene';
    row.innerHTML = `
      <div class="sf-thumb"><img alt="" /><span class="sf-badge"></span></div>
      <div class="sf-scene-body">
        <div class="sf-scene-head">
          <b>#${i + 1}</b>
          <span class="sf-sec"><input type="number" class="s-sec" min="2" max="8" step="0.5" /> 초</span>
          <button class="btn btn-ghost btn-sm s-jump">이 장면 보기</button>
          <button class="btn btn-ghost btn-sm s-regen">배경 AI 재생성</button>
        </div>
        <textarea class="s-text" rows="2" placeholder="화면 자막"></textarea>
        <textarea class="s-narr" rows="2" placeholder="내레이션 (영상에는 안 나옴, 녹음용)"></textarea>
      </div>`;
    const img = row.querySelector('img');
    if (s.file) img.src = `/api/drafts/${draftId}/shortform/media/${encodeURIComponent(s.file)}`;
    else img.style.visibility = 'hidden';
    const badge = row.querySelector('.sf-badge');
    badge.textContent = s.ai ? 'AI' : '원고';
    badge.className = 'sf-badge ' + (s.ai ? 'sf-badge-ai' : '');

    const textEl = row.querySelector('.s-text');
    const narrEl = row.querySelector('.s-narr');
    const secEl = row.querySelector('.s-sec');
    textEl.value = s.text || '';
    narrEl.value = s.narration || '';
    secEl.value = s.seconds;

    textEl.oninput = () => { s.text = textEl.value; jumpTo(i); };
    narrEl.oninput = () => { s.narration = narrEl.value; };
    secEl.oninput = () => { s.seconds = Math.min(8, Math.max(2, Number(secEl.value) || 4)); render(); };
    row.querySelector('.s-jump').onclick = () => jumpTo(i);
    row.querySelector('.s-regen').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '생성 중…';
      try {
        const updated = await api(`/api/drafts/${draftId}/shortform/scenes/${i}/image`, { method: 'POST', body: {} });
        sf.scenes = updated.scenes;
        imgCache.delete(sf.scenes[i].file);
        await loadImage(sf.scenes[i].file);
        renderScenes();
        jumpTo(i);
      } catch (err) {
        alert('실패: ' + err.message);
        b.disabled = false;
        b.textContent = '배경 AI 재생성';
      }
    };
    wrap.appendChild(row);
  });
}

function jumpTo(i) {
  stopLoop();
  let acc = 0;
  for (let k = 0; k < i; k++) acc += Number(sf.scenes[k].seconds) || 4;
  playT = acc + 0.35; // 등장 애니메이션이 끝난 시점
  render();
}

$('hookInput').oninput = () => { sf.hook = $('hookInput').value; render(); };
$('hookSubInput').oninput = () => { sf.hookSub = $('hookSubInput').value; render(); };
$('captionInput').oninput = () => { sf.caption = $('captionInput').value; };
$('theme').onchange = () => { sf.style.theme = $('theme').value; render(); };
$('boxed').onchange = () => { sf.style.boxed = $('boxed').checked; render(); };
$('kenBurns').onchange = () => { sf.style.kenBurns = $('kenBurns').checked; render(); };
bindStyleControl('offsetY', 'offsetY', (v) => v + 'px');
bindStyleControl('hookSize', 'hookSize');
bindStyleControl('textSize', 'textSize');

$('saveBtn').onclick = async () => {
  const st = $('saveStatus');
  st.hidden = false;
  st.className = 'status';
  st.textContent = '저장 중...';
  try {
    await api(`/api/drafts/${draftId}/shortform`, {
      method: 'PUT',
      body: {
        hook: sf.hook,
        hookSub: sf.hookSub,
        caption: sf.caption,
        style: sf.style,
        scenes: sf.scenes.map((s) => ({ text: s.text, narration: s.narration, seconds: s.seconds })),
      },
    });
    st.textContent = '✅ 저장되었습니다.';
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
  }
};

$('copyCaptionBtn').onclick = async () => {
  const text = `${sf.caption || ''}\n\n${(sf.hashtags || []).map((h) => '#' + h).join(' ')}`.trim();
  try {
    await navigator.clipboard.writeText(text);
    alert('복사했습니다.');
  } catch {
    prompt('복사해서 사용하세요', text);
  }
};

$('remakeBtn').onclick = () => {
  if (!confirm('현재 대본을 버리고 AI가 다시 만들까요? (편집 내용이 사라집니다)')) return;
  $('editor').hidden = true;
  $('makeCard').hidden = false;
  startMake();
};

// ── 생성 시작 & 폴링 ─────────────────────────
async function startMake() {
  const btn = $('makeBtn');
  const st = $('makeStatus');
  btn.disabled = true;
  st.hidden = false;
  st.className = 'status';
  st.textContent = 'AI가 원고를 읽고 대본을 쓰는 중...';
  try {
    await api(`/api/drafts/${draftId}/shortform`, {
      method: 'POST',
      body: {
        sceneCount: Number($('sceneCount').value),
        totalSeconds: Number($('totalSeconds').value),
        imageMode: $('imageMode').value,
      },
    });
    pollUntilReady();
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
    btn.disabled = false;
  }
}

$('makeBtn').onclick = startMake;

function pollUntilReady() {
  const st = $('makeStatus');
  const poll = setInterval(async () => {
    const data = await api(`/api/drafts/${draftId}/shortform`).catch(() => null);
    if (!data) return;
    st.textContent = data.step || '진행 중...';
    if (data.status === 'ready') {
      clearInterval(poll);
      $('makeBtn').disabled = false;
      await openEditor(data);
    } else if (data.status === 'error') {
      clearInterval(poll);
      st.className = 'status err';
      st.textContent = '실패: ' + (data.error || '알 수 없는 오류');
      $('makeBtn').disabled = false;
    }
  }, 3000);
}

async function openEditor(data) {
  sf = data;
  sf.style = { offsetY: 10, hookSize: 76, textSize: 60, theme: 'dark', boxed: true, kenBurns: true, ...(data.style || {}) };
  $('makeCard').hidden = true;
  $('editor').hidden = false;
  fillEditor();
  await preloadAll();
  playT = 0.35;
  render();
}

// ── 초기 진입 ────────────────────────────────
(async () => {
  if (!draftId) {
    alert('초안 ID가 없습니다. 대시보드에서 다시 들어와 주세요.');
    location.href = '/';
    return;
  }
  const existing = await api(`/api/drafts/${draftId}/shortform`).catch(() => null);
  if (existing && existing.status === 'ready') {
    await openEditor(existing);
  } else if (existing && existing.status === 'building') {
    $('makeCard').hidden = false;
    $('makeBtn').disabled = true;
    $('makeStatus').hidden = false;
    $('makeStatus').textContent = existing.step || '진행 중...';
    pollUntilReady();
  } else {
    $('makeCard').hidden = false;
    const { meta } = await api(`/api/drafts/${draftId}`).catch(() => ({ meta: null }));
    if (meta) $('sfTitle').textContent = meta.title || meta.keyword || '';
  }
})();
