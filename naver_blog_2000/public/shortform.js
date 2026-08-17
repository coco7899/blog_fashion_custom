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

let sf = null;                 // 서버의 shortform 문서
const imgCache = new Map();    // file → HTMLImageElement
let playing = false;
let playT = 0;                 // 현재 재생 위치(초)
let rafId = null;

const canvas = $('stage');
const ctx = canvas.getContext('2d');

// ── 공용 렌더러(SF) 위임 — 대시보드 인라인 미리보기와 동일한 화면 ──
const totalSec = () => SF.totalSec(sf);
const sceneAt = (t) => SF.sceneAt(sf, t);
const loadImage = (file) => SF.loadImage(imgCache, draftId, file);
const preloadAll = () => SF.preloadAll(imgCache, draftId, sf);
const downloadBlob = SF.download;
function drawFrame(t) { SF.drawFrame(ctx, sf, t, imgCache); }

function render() {
  if (!sf || !sf.scenes || !sf.scenes.length) return;
  drawFrame(playT);
  const total = totalSec();
  $('seek').value = total ? Math.round((playT / total) * 1000) : 0;
  $('timeLabel').textContent = `${playT.toFixed(1)} / ${total.toFixed(1)}초`;
  const idx = sceneAt(playT).index;
  const label = $('curSceneLabel');
  if (label) label.textContent = `장면 ${idx + 1} / ${sf.scenes.length}`;
  // 재생 중에는 지금 나오는 장면을 목록에서 강조
  if (playing) {
    activeScene = idx;
    document.querySelectorAll('.sf-scene').forEach((el) => el.classList.toggle('active', Number(el.dataset.i) === idx));
  }
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

// ── 영상 다운로드 (공용 렌더러의 MediaRecorder 사용) ────────────
$('exportBtn').onclick = async () => {
  const btn = $('exportBtn');
  const st = $('exportStatus');
  btn.disabled = true;
  stopLoop();
  st.hidden = false;
  st.className = 'status';
  st.textContent = '녹화 준비 중...';
  try {
    const total = totalSec();
    const hasAudio = audioState.narrationBuffer || audioState.bgmBuffer;
    const { blob, ext, frames } = await SF.exportVideo(canvas, ctx, sf, imgCache, draftId, {
      onProgress: (t) => { st.textContent = `녹화 중${hasAudio ? '(소리 포함)' : ''}... ${t.toFixed(1)} / ${total.toFixed(1)}초`; },
      audio: hasAudio
        ? {
            narrationBuffer: audioState.narrationBuffer,
            bgmBuffer: audioState.bgmBuffer,
            narrGain: Number($('narrGain').value) / 100,
            bgmGain: Number($('bgmGain').value) / 100,
          }
        : null,
    });
    console.log(`[shortform] ${frames}프레임 / ${total}초 녹화 (audio=${!!hasAudio})`);
    render();
    const name = `shortform-${(sf.title || draftId).replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}.${ext}`;
    SF.download(blob, name);
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

// ── 사용된 이미지 전체 ZIP 다운로드 ────────────
$('zipBtn').onclick = async () => {
  const btn = $('zipBtn');
  const st = $('exportStatus');
  btn.disabled = true;
  st.hidden = false;
  st.className = 'status';
  st.textContent = '이미지 압축 중...';
  try {
    const blob = await SF.buildImagesZip(draftId, sf);
    const name = `shortform-images-${(sf.title || draftId).replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}.zip`;
    SF.download(blob, name);
    st.textContent = `✅ 이미지 ${sf.scenes.filter((s) => s.file).length}장 ZIP 다운로드 완료`;
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

$('pngBtn').onclick = () => {
  canvas.toBlob((b) => SF.download(b, `shortform-scene-${sceneAt(playT).index + 1}.png`), 'image/png');
};

// ── 오디오: 더빙(무료 TTS) + 배경음악 ──────────
const audioState = { narrationBuffer: null, bgmBuffer: null, ttsPoll: null };
const safeName = () => (sf.title || draftId).replace(/[\\/:*?"<>|]/g, '').slice(0, 30);

$('narrGain').oninput = () => { $('narrGainVal').textContent = $('narrGain').value + '%'; };
$('bgmGain').oninput = () => { $('bgmGainVal').textContent = $('bgmGain').value + '%'; };

// 내레이션 자동 생성 (서버 무료 TTS) → 완료되면 오디오 버퍼로 렌더
$('ttsBtn').onclick = async () => {
  const btn = $('ttsBtn');
  const st = $('ttsStatus');
  btn.disabled = true;
  st.hidden = false;
  st.className = 'status';
  st.textContent = '내레이션 음성 생성 시작…';
  try {
    await api(`/api/drafts/${draftId}/shortform/tts`, { method: 'POST' });
    clearInterval(audioState.ttsPoll);
    audioState.ttsPoll = setInterval(async () => {
      const data = await api(`/api/drafts/${draftId}/shortform`).catch(() => null);
      if (!data) return;
      st.textContent = data.ttsStep || '진행 중…';
      if (data.ttsStatus === 'ready') {
        clearInterval(audioState.ttsPoll);
        sf.scenes = data.scenes; // ttsFile 반영
        st.textContent = '음성 합치는 중…';
        audioState.narrationBuffer = await SF.renderNarration(draftId, sf);
        if (audioState.narrationBuffer) {
          $('narrDlBtn').disabled = false;
          st.textContent = `✅ 내레이션 음성 준비 완료 (${audioState.narrationBuffer.duration.toFixed(1)}초) — 영상에 포함됩니다`;
        } else {
          st.className = 'status err';
          st.textContent = '내레이션이 비어 있거나 음성 생성에 실패했습니다.';
        }
        btn.disabled = false;
      } else if (data.ttsStatus === 'error') {
        clearInterval(audioState.ttsPoll);
        st.className = 'status err';
        st.textContent = '실패: ' + (data.ttsError || '음성 생성 오류');
        btn.disabled = false;
      }
    }, 2000);
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
    btn.disabled = false;
  }
};

$('narrDlBtn').onclick = () => {
  if (!audioState.narrationBuffer) return;
  SF.download(SF.bufferToWav(audioState.narrationBuffer), `shortform-narration-${safeName()}.wav`);
};

// 배경음악 생성 (브라우저 Web Audio로 즉석 생성)
$('bgmBtn').onclick = async () => {
  const btn = $('bgmBtn');
  const st = $('audioStatus');
  btn.disabled = true;
  st.className = 'hint';
  st.textContent = '배경음악 생성 중…';
  try {
    audioState.bgmBuffer = await SF.renderBgm($('bgmStyle').value, totalSec());
    $('bgmDlBtn').disabled = false;
    st.textContent = `✅ 배경음악 준비 완료 (${audioState.bgmBuffer.duration.toFixed(1)}초) — 영상에 포함됩니다`;
  } catch (e) {
    st.textContent = '배경음악 생성 실패: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

$('bgmDlBtn').onclick = () => {
  if (!audioState.bgmBuffer) return;
  SF.download(SF.bufferToWav(audioState.bgmBuffer), `shortform-bgm-${safeName()}.wav`);
};

$('txtBtn').onclick = () => {
  const lines = [
    `[숏폼 대본] ${sf.title || ''}`,
    sf.videoTitle ? `영상 제목: ${sf.videoTitle}` : '',
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

// 내레이션만 — 더빙·녹음용 (자막·해시태그 제외)
$('narrTxtBtn').onclick = () => {
  const lines = [
    `[내레이션 대본] ${sf.videoTitle || sf.title || ''}`.trim(),
    '',
    ...sf.scenes.map((s, i) => `${i + 1}. ${(s.narration || '').trim() || '-'}`),
  ];
  SF.download(new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' }), `shortform-narration-${draftId}.txt`);
};

// ── 편집 UI ──────────────────────────────────
function fillEditor() {
  $('sfTitle').textContent = sf.title || '';
  $('hookInput').value = sf.hook || '';
  $('hookSubInput').value = sf.hookSub || '';
  $('captionInput').value = sf.caption || '';
  $('tagsLine').textContent = (sf.hashtags || []).map((h) => '#' + h).join(' ');

  const st = sf.style || {};
  const th = SF.THEMES[st.theme] || SF.THEMES.dark;
  $('offsetY').value = st.offsetY ?? 10;
  $('offsetYVal').textContent = (st.offsetY ?? 10) + 'px';
  $('hookY').value = st.hookY ?? 172;
  $('hookYVal').textContent = (st.hookY ?? 172) + 'px';
  $('hookSize').value = st.hookSize ?? 76;
  $('hookSizeVal').textContent = st.hookSize ?? 76;
  $('hookColor').value = toHex(st.hookColor || th.accent);
  $('hookTextColor').value = toHex(st.hookTextColor || th.chipText);
  $('hookBoxed').checked = st.hookBoxed !== false;
  $('textSize').value = st.textSize ?? 60;
  $('textSizeVal').textContent = st.textSize ?? 60;
  $('theme').value = st.theme || 'dark';
  $('boxed').checked = st.boxed !== false;
  $('kenBurns').checked = st.kenBurns !== false;
  $('narrationChk').checked = st.narration !== false;

  renderScenes();
}

// <input type=color>는 #rrggbb만 받는다 → 색 문자열을 안전한 hex로
function toHex(c) {
  c = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return '#03c75a';
}

let activeScene = 0;

function renderScenes() {
  const wrap = $('scenesList');
  wrap.innerHTML = '';
  sf.scenes.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sf-scene' + (i === activeScene ? ' active' : '');
    row.dataset.i = i;
    row.innerHTML = `
      <div class="sf-thumb"><img alt="" /><span class="sf-thumb-no">${i + 1}</span><span class="sf-badge"></span></div>
      <div class="sf-scene-body">
        <div class="sf-scene-head">
          <b>장면 ${i + 1}</b>
          <span class="sf-sec"><input type="number" class="s-sec" min="2" max="8" step="0.5" /> 초</span>
          <button class="btn btn-ghost btn-sm s-regen" title="이 장면 배경을 AI로 다시 생성">🖼 배경 바꾸기</button>
          <button class="btn btn-ghost btn-sm s-upload" title="내 이미지를 이 장면 배경으로 업로드">⬆ 업로드</button>
          <input type="file" class="s-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
        </div>
        <textarea class="s-text" rows="2" placeholder="화면 자막 (16자·2줄 권장)"></textarea>
        <textarea class="s-narr" rows="1" placeholder="내레이션 (하단 자막·녹음용)"></textarea>
      </div>`;
    const img = row.querySelector('img');
    if (s.file) img.src = `/api/drafts/${draftId}/shortform/media/${encodeURIComponent(s.file)}`;
    else img.style.visibility = 'hidden';
    const badge = row.querySelector('.sf-badge');
    const isUp = s.source === 'upload';
    badge.textContent = isUp ? '업로드' : s.ai ? 'AI' : '원고';
    badge.className = 'sf-badge ' + (isUp ? 'sf-badge-up' : s.ai ? 'sf-badge-ai' : '');

    const textEl = row.querySelector('.s-text');
    const narrEl = row.querySelector('.s-narr');
    const secEl = row.querySelector('.s-sec');
    textEl.value = s.text || '';
    narrEl.value = s.narration || '';
    secEl.value = s.seconds;

    // 장면(빈 곳/썸네일) 클릭 → 그 장면으로 이동. 입력칸 클릭도 해당 장면 선택.
    row.onclick = () => selectScene(i);
    textEl.oninput = () => { s.text = textEl.value; selectScene(i); scheduleSave(); };
    narrEl.oninput = () => { s.narration = narrEl.value; render(); scheduleSave(); };
    secEl.oninput = () => { s.seconds = Math.min(8, Math.max(2, Number(secEl.value) || 4)); render(); scheduleSave(); };
    row.querySelector('.s-regen').onclick = async (e) => {
      e.stopPropagation();
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = '생성 중…';
      try {
        const updated = await api(`/api/drafts/${draftId}/shortform/scenes/${i}/image`, { method: 'POST', body: {} });
        sf.scenes = updated.scenes;
        imgCache.delete(sf.scenes[i].file);
        await loadImage(sf.scenes[i].file);
        renderScenes();
        selectScene(i);
      } catch (err) {
        alert('실패: ' + err.message);
        b.disabled = false;
        b.textContent = '🖼 배경 바꾸기';
      }
    };

    // 외부 이미지 업로드 → 이 장면 배경으로 (9:16은 렌더러가 cover로 자동 맞춤)
    const fileInput = row.querySelector('.s-file');
    const upBtn = row.querySelector('.s-upload');
    upBtn.onclick = (e) => { e.stopPropagation(); fileInput.click(); };
    fileInput.onclick = (e) => e.stopPropagation();
    fileInput.onchange = async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 25 * 1024 * 1024) { alert('이미지가 너무 큽니다. (25MB 이하)'); fileInput.value = ''; return; }
      upBtn.disabled = true;
      upBtn.textContent = '올리는 중…';
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
          fr.readAsDataURL(f);
        });
        const updated = await api(`/api/drafts/${draftId}/shortform/scenes/${i}/upload`, { method: 'POST', body: { dataUrl } });
        sf.scenes = updated.scenes;
        imgCache.delete(sf.scenes[i].file);
        await loadImage(sf.scenes[i].file);
        renderScenes();
        selectScene(i);
      } catch (err) {
        alert('업로드 실패: ' + err.message);
        upBtn.disabled = false;
        upBtn.textContent = '⬆ 업로드';
      } finally {
        fileInput.value = '';
      }
    };
    wrap.appendChild(row);
  });
}

// 장면 선택 = 미리보기 이동 + 목록 강조
function selectScene(i) {
  activeScene = Math.max(0, Math.min(sf.scenes.length - 1, i));
  document.querySelectorAll('.sf-scene').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.i) === activeScene);
  });
  jumpTo(activeScene);
}

function jumpTo(i) {
  stopLoop();
  let acc = 0;
  for (let k = 0; k < i; k++) acc += Number(sf.scenes[k].seconds) || 4;
  playT = acc + 0.35; // 등장 애니메이션이 끝난 시점
  render();
}

// ── 자동 저장 (편집 후 0.8초 뒤 한 번에 저장) ──
let saveTimer = null;
function setSaveState(text, cls) {
  const el = $('saveState');
  if (!el) return;
  el.textContent = text;
  el.className = 'hint' + (cls ? ' ' + cls : '');
  el.style.cssText = 'float:right;margin:0' + (cls === 'err' ? ';color:#c0392b' : cls === 'ok' ? ';color:#1b7a2f' : '');
}
async function doSave() {
  try {
    setSaveState('저장 중…');
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
    setSaveState('✅ 자동 저장됨', 'ok');
  } catch (e) {
    setSaveState('저장 실패: ' + e.message, 'err');
  }
}
function scheduleSave() {
  setSaveState('편집 중…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 800);
}

$('hookInput').oninput = () => { sf.hook = $('hookInput').value; render(); scheduleSave(); };
$('hookSubInput').oninput = () => { sf.hookSub = $('hookSubInput').value; render(); scheduleSave(); };
$('captionInput').oninput = () => { sf.caption = $('captionInput').value; scheduleSave(); };
$('theme').onchange = () => {
  sf.style.theme = $('theme').value;
  // 후킹 색을 따로 지정하지 않았으면 색 입력칸을 새 테마 기본색으로 갱신
  const th = SF.THEMES[sf.style.theme] || SF.THEMES.dark;
  if (!sf.style.hookColor) $('hookColor').value = toHex(th.accent);
  if (!sf.style.hookTextColor) $('hookTextColor').value = toHex(th.chipText);
  render();
  scheduleSave();
};
// 후킹 디자인
$('hookColor').oninput = () => { sf.style.hookColor = $('hookColor').value; render(); scheduleSave(); };
$('hookTextColor').oninput = () => { sf.style.hookTextColor = $('hookTextColor').value; render(); scheduleSave(); };
$('hookBoxed').onchange = () => { sf.style.hookBoxed = $('hookBoxed').checked; render(); scheduleSave(); };
$('hookColorReset').onclick = () => {
  const th = SF.THEMES[sf.style.theme] || SF.THEMES.dark;
  delete sf.style.hookColor;
  delete sf.style.hookTextColor;
  $('hookColor').value = toHex(th.accent);
  $('hookTextColor').value = toHex(th.chipText);
  render();
  scheduleSave();
};
$('boxed').onchange = () => { sf.style.boxed = $('boxed').checked; render(); scheduleSave(); };
$('kenBurns').onchange = () => { sf.style.kenBurns = $('kenBurns').checked; render(); scheduleSave(); };
$('narrationChk').onchange = () => { sf.style.narration = $('narrationChk').checked; render(); scheduleSave(); };
function bindStyleControlSave(id, key, fmt) {
  const el = $(id);
  const label = $(id + 'Val');
  el.oninput = () => {
    sf.style[key] = Number(el.value);
    if (label) label.textContent = fmt ? fmt(el.value) : el.value;
    render();
    scheduleSave();
  };
}
bindStyleControlSave('offsetY', 'offsetY', (v) => v + 'px');
bindStyleControlSave('hookY', 'hookY', (v) => v + 'px');
bindStyleControlSave('hookSize', 'hookSize');
bindStyleControlSave('textSize', 'textSize');

// 장면 이동 버튼
$('prevSceneBtn').onclick = () => selectScene(activeScene - 1);
$('nextSceneBtn').onclick = () => selectScene(activeScene + 1);

// 미리보기 접기/펼치기
$('foldBtn').onclick = () => {
  const body = $('previewBody');
  const folded = body.hasAttribute('hidden');
  if (folded) { body.removeAttribute('hidden'); $('foldBtn').textContent = '접기 ▲'; }
  else { body.setAttribute('hidden', ''); $('foldBtn').textContent = '펼치기 ▼'; }
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
  sf.style = { offsetY: 10, hookY: 172, hookSize: 76, hookBoxed: true, textSize: 60, theme: 'dark', boxed: true, kenBurns: true, narration: true, ...(data.style || {}) };
  activeScene = 0;
  $('makeCard').hidden = true;
  $('editor').hidden = false;
  fillEditor();
  await SF.ensureFont();
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
