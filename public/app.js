// 대시보드 프런트엔드
const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error('사이트 서버 연결이 잠시 끊겼습니다. 잠시 후 다시 시도해주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
};

// 브라우저 내장 confirm()은 일부 환경(임베디드 미리보기 등)에서 차단되어
// 버튼이 "안 눌리는" 것처럼 보인다. 어디서나 동작하는 자체 확인창으로 대체한다.
function uiConfirm(message) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'ui-confirm-overlay';
    ov.innerHTML =
      '<div class="ui-confirm-box">' +
      '<div class="ui-confirm-msg"></div>' +
      '<div class="ui-confirm-actions">' +
      '<button class="btn btn-ghost ui-confirm-no">취소</button>' +
      '<button class="btn btn-green ui-confirm-yes">확인</button>' +
      '</div></div>';
    ov.querySelector('.ui-confirm-msg').textContent = message;
    const done = (v) => {
      ov.remove();
      resolve(v);
    };
    ov.querySelector('.ui-confirm-yes').onclick = () => done(true);
    ov.querySelector('.ui-confirm-no').onclick = () => done(false);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) done(false);
    });
    document.body.appendChild(ov);
    ov.querySelector('.ui-confirm-yes').focus();
  });
}

const STEPS = [
  { key: 'collecting', label: '자료 수집' },
  { key: 'writing', label: 'AI 글 작성' },
  { key: 'images', label: '이미지 자리 준비' },
  { key: 'publishing', label: '임시저장' },
  { key: 'saved', label: '완료' },
];

let currentSearch = null;
let watchingDraft = null;
let loginPolling = false;
let runningTopicIndex = null;        // 현재 실행 중인 글감 인덱스 (오렌지)
const completedTopics = new Set();   // 이미 실행 완료한 글감 인덱스 (연회색)
let runQueue = [];                   // 대기 중인 글감 인덱스 (순서대로 자동 처리)
const queuedAffiliateProducts = new Map(); // 대기열에 넣을 당시 지정한 제휴상품

function selectedAffiliateProduct() {
  return String($('affiliateProductInput')?.value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

$('affiliateProductInput').addEventListener('input', refreshTopicButtons);

// 세션 파일은 있어도 실제 로그인이 만료됐을 수 있어, 유효성을 따로 확인해 배지에 반영한다.
// (서버 verify는 10분 캐시라 자주 호출해도 부담이 적지만, 클라이언트도 2분 간격으로 throttle)
let loginValidity = { at: 0, expired: false, checking: false };
function checkLoginValidity() {
  if (loginValidity.checking || Date.now() - loginValidity.at < 120000) return;
  loginValidity.checking = true;
  api('/api/login/status')
    .then((r) => {
      loginValidity = { at: Date.now(), expired: r && r.loggedIn === false && r.expired === true, checking: false };
      refreshStatus();
    })
    .catch(() => { loginValidity.checking = false; });
}

// ── 로그인 상태 ──────────────────────────────
async function refreshStatus() {
  try {
    const s = await api('/api/status');
    const badge = $('loginBadge');
    // Codex 연결 오류의 긴 기술 메시지는 상단에 표시하지 않는다.
    // 실제 오류 상태는 서버 로그와 글쓰기 작업 결과에서 계속 확인할 수 있다.
    $('envBadge').hidden = true;
    $('envBadge').textContent = '';
    if (s.session) {
      checkLoginValidity(); // 실제 유효성(만료 여부) 확인
      if (loginValidity.expired) {
        badge.className = 'badge badge-off';
        badge.textContent = '⚠ 로그인 만료 — 다시 로그인 필요';
        $('loginBtn').textContent = '다시 로그인';
        $('logoutBtn').hidden = false;
      } else {
        badge.className = 'badge';
        badge.textContent = s.blogId ? `로그인됨 (${s.blogId})` : '로그인됨';
        $('loginBtn').textContent = '다시 로그인';
        $('logoutBtn').hidden = false;
      }
    } else if (s.loginError && !s.loginInProgress) {
      badge.className = 'badge badge-off';
      badge.textContent = '로그인 실패: ' + s.loginError;
      $('loginBtn').textContent = '네이버 로그인';
      $('logoutBtn').hidden = true;
    } else {
      badge.className = 'badge badge-off';
      badge.textContent = '로그인 필요';
      $('loginBtn').textContent = '네이버 로그인';
      $('logoutBtn').hidden = true;
    }
    return s;
  } catch {
    return null;
  }
}

$('loginBtn').onclick = async () => {
  $('loginBtn').disabled = true;
  loginValidity = { at: 0, expired: false, checking: false }; // 재로그인 시 유효성 재확인
  try {
    await api('/api/login', { method: 'POST' });
    $('loginBadge').className = 'badge badge-warn';
    $('loginBadge').textContent = '브라우저 창에서 로그인해주세요...';
    if (!loginPolling) {
      loginPolling = true;
      const poll = setInterval(async () => {
        const s = await api('/api/status').catch(() => null);
        if (s && s.session && !s.loginInProgress) {
          clearInterval(poll);
          loginPolling = false;
          await api('/api/login/status?fresh=1').catch(() => {});
          refreshStatus();
        } else if (s && !s.loginInProgress && !s.session) {
          clearInterval(poll);
          loginPolling = false;
          refreshStatus();
        }
      }, 2000);
    }
  } catch (e) {
    alert(e.message);
  } finally {
    $('loginBtn').disabled = false;
  }
};

$('logoutBtn').onclick = async () => {
  if (!(await uiConfirm('저장된 네이버 로그인 세션을 삭제할까요?'))) return;
  await api('/api/logout', { method: 'POST' });
  refreshStatus();
};

// ── 건강블로그 글감 찾기 (중지 가능) ─────────────────────
let topicsAbort = null;
$('newsModeBtn').onclick = async () => {
  const btn = $('newsModeBtn');
  const stopBtn = $('newsStopBtn');
  btn.disabled = true;
  stopBtn.hidden = false;
  const st = $('newsModeStatus');
  st.hidden = false;
  st.className = 'status';
  st.textContent = '직전 글감과 겹치지 않는 새로운 주제를 찾는 중... (1~2분) — 오른쪽 중지 버튼으로 취소할 수 있어요.';
  topicsAbort = new AbortController();
  try {
    const data = await api('/api/schedule/topics', { method: 'POST', signal: topicsAbort.signal });
    currentSearch = data;
    renderTopics(data);
    st.textContent = `글감 ${data.topics.length}개를 찾았습니다. 아래에서 선택하세요.`;
  } catch (e) {
    if (e.name === 'AbortError') {
      st.className = 'status';
      st.textContent = '글감 찾기를 중지했습니다.';
    } else {
      st.className = 'status err';
      st.textContent = '실패: ' + e.message;
    }
  } finally {
    btn.disabled = false;
    stopBtn.disabled = false;
    stopBtn.textContent = '글감 찾기 중지';
    stopBtn.hidden = true;
    topicsAbort = null;
  }
};
// 글감 찾기 중지 — 진행 중인 요청을 취소한다
$('newsStopBtn').onclick = () => {
  if (!topicsAbort) return;
  $('newsStopBtn').disabled = true;
  $('newsStopBtn').textContent = '중지 중...';
  topicsAbort.abort();
};

// ── 모드 1-c: 키워드로 관련 기사 찾아 글감 만들기 ──────
$('keywordModeBtn').onclick = async () => {
  const keyword = $('keywordInput').value.trim();
  if (!keyword) return alert('찾을 건강 키워드를 입력하세요. (예: 혈당스파이크, 중년 단백질)');
  const btn = $('keywordModeBtn');
  const stopBtn = $('newsStopBtn');
  btn.disabled = true;
  stopBtn.hidden = false;
  const st = $('newsModeStatus');
  st.hidden = false;
  st.className = 'status';
  st.textContent = `"${keyword}" 관련 최신 기사를 찾고 AI가 글감을 뽑는 중... (1~2분)`;
  topicsAbort = new AbortController();
  try {
    const data = await api('/api/topics', { method: 'POST', body: { keyword }, signal: topicsAbort.signal });
    currentSearch = data;
    renderTopics(data);
    const n = (data.sources || []).length;
    st.textContent = `"${keyword}" 관련 기사 ${n}건에서 글감 ${data.topics.length}개를 찾았습니다. 아래에서 선택하세요.`;
  } catch (e) {
    if (e.name === 'AbortError') {
      st.className = 'status';
      st.textContent = '키워드 찾기를 중지했습니다.';
    } else {
      st.className = 'status err';
      st.textContent = '실패: ' + e.message;
    }
  } finally {
    btn.disabled = false;
    stopBtn.disabled = false;
    stopBtn.textContent = '글감 찾기 중지';
    stopBtn.hidden = true;
    topicsAbort = null;
  }
};

// ── 모드 1-b: 뉴스 링크로 바로 글쓰기 ─────────
$('linkModeBtn').onclick = async () => {
  const url = $('linkInput').value.trim();
  if (!/^https?:\/\//.test(url)) return alert('뉴스 기사 링크(https://...)를 붙여넣어 주세요.');
  const mode = $('runMode').value;
  const visibility = $('runVisibility').value;
  const affiliateProduct = selectedAffiliateProduct();
  const actLabel = mode === 'publish' ? `바로 ${visibility === 'private' ? '비공개' : '공개'} 발행` : '임시저장';
  const productLine = affiliateProduct ? `\n제휴상품: ${affiliateProduct}` : '\n제휴상품: 주제에 맞게 자동 매칭';
  if (!(await uiConfirm(`이 기사 링크를 바탕으로 AI가 글을 쓰고 ${actLabel}까지 진행합니다.\n${url}${productLine}\n시작할까요?`))) return;
  const btn = $('linkModeBtn');
  btn.disabled = true;
  const st = $('newsModeStatus');
  st.hidden = false;
  st.className = 'status';
  st.textContent = '기사를 확인하는 중...';
  try {
    const data = await api('/api/run-link', { method: 'POST', body: { url, visibility, mode, affiliateProduct } });
    st.textContent = `"${(data.title || '').slice(0, 40)}" 기사로 작성 시작 — 아래 진행 상황에서 확인하세요.`;
    watchDraft(data.draftId);
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

// ── 모든 글감 삭제 (#5) ───────────────────────
$('clearTopicsBtn').onclick = async () => {
  if (!(await uiConfirm('찾아둔 글감 목록을 모두 삭제할까요?'))) return;
  currentSearch = null;
  runQueue = [];
  queuedAffiliateProducts.clear();
  runningTopicIndex = null;
  completedTopics.clear();
  $('topicsList').innerHTML = '';
  $('topicsCard').hidden = true;
  await api('/api/topics', { method: 'DELETE' }).catch((error) => {
    alert('저장된 글감 삭제 실패: ' + error.message);
  });
};
$('runAllBtn').onclick = () => runAllTopics();

// ── 모든 작업 삭제 (#7) ───────────────────────
$('clearDraftsBtn').onclick = async () => {
  if (!(await uiConfirm('작업 이력의 모든 작업 기록을 삭제할까요? (네이버 블로그에 저장된 글은 지워지지 않습니다)'))) return;
  try {
    await api('/api/drafts', { method: 'DELETE' });
    loadDrafts();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
};

// ── 글감 목록 렌더 ────────────────────────────
function renderTopics(data, visOverride, { scroll = true } = {}) {
  $('topicsCard').hidden = false;
  // 새 글감 목록 → 실행 상태 초기화 (모두 대기=초록)
  runningTopicIndex = null;
  completedTopics.clear();
  runQueue = [];
  queuedAffiliateProducts.clear();
  const list = $('topicsList');
  list.innerHTML = '';
  data.topics.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'topic';
    div.innerHTML = `
      <div>
        <div class="t-badges"></div>
        <div class="t-title"></div>
        <div class="t-fact"></div>
        <div class="t-angle"></div>
        <div class="t-health-plan"></div>
        <div class="t-keywords"></div>
      </div>
      <button class="btn btn-green topic-run-btn">이 글감으로<br>실행</button>`;
    const badges = div.querySelector('.t-badges');
    if (t.recommended) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = '⭐ 추천';
      badges.appendChild(b);
    }
    if (t.field) {
      const f = document.createElement('span');
      f.className = 'badge badge-warn';
      f.textContent = t.field;
      badges.appendChild(f);
    }
    if (t.date) {
      const d = document.createElement('span');
      d.className = 'badge badge-date';
      d.textContent = '📅 ' + t.date;
      badges.appendChild(d);
    }
    div.querySelector('.t-title').textContent = t.title;
    div.querySelector('.t-fact').textContent = t.fact ? '✓ ' + t.fact : '';
    div.querySelector('.t-angle').textContent = String(t.angle || '')
      .split(/(?<=[.!?。])\s+/)
      .filter((sentence) => !/제휴|쇼핑\s*커넥트|주력\s*상품|상품으로\s*연결/.test(sentence))
      .join(' ');
    const healthPlan = div.querySelector('.t-health-plan');
    const planLines = [
      t.problem ? `생활 문제: ${t.problem}` : '',
      t.action ? `실천 방향: ${t.action}` : '',
    ].filter(Boolean);
    healthPlan.textContent = planLines.join('\n');
    div.querySelector('.t-keywords').textContent = (t.keywords || []).map((k) => '#' + k).join(' ');
    div.querySelector('button').onclick = (e) => startRun(i, visOverride, e.currentTarget);
    list.appendChild(div);
  });
  if (scroll) $('topicsCard').scrollIntoView({ behavior: 'smooth' });
}

// 페이지를 새로 열거나 숏폼 제작 화면에서 돌아왔을 때 최근 글감을 복원한다.
async function restoreLatestTopics() {
  const saved = await api('/api/topics/latest').catch(() => null);
  if (!saved || !saved.search || !Array.isArray(saved.search.topics) || !saved.search.topics.length) return;
  currentSearch = saved.search;
  renderTopics(saved.search, saved.search.visibility, { scroll: false });
  for (const index of saved.completedTopicIndexes || []) {
    if (Number.isInteger(index)) completedTopics.add(index);
  }
  refreshTopicButtons();
}

// ── 파이프라인 실행: 여러 글감을 대기열에 쌓아 하나씩 자동 처리 ──
// (동시 발행은 네이버 로그인 브라우저·세션이 충돌하고 스팸 감지 위험이 커서,
//  안전하게 순서대로 처리한다. 사용자는 여러 개를 눌러두고 자리를 비워도 된다.)
async function startRun(topicIndex, visOverride) {
  if (!currentSearch) return;
  const affiliateProduct = selectedAffiliateProduct();
  if ((completedTopics.has(topicIndex) && !affiliateProduct) || runningTopicIndex === topicIndex) return;
  // 대기 중인 글감을 다시 누르면 대기 취소
  if (runQueue.includes(topicIndex)) {
    runQueue = runQueue.filter((x) => x !== topicIndex);
    queuedAffiliateProducts.delete(topicIndex);
    refreshTopicButtons();
    return;
  }
  const mode = $('runMode').value; // 'draft' | 'publish'
  const visibility = visOverride || $('runVisibility').value;
  const actLabel = mode === 'publish' ? `바로 ${visibility === 'private' ? '비공개' : '공개'} 발행` : '네이버 블로그에 임시저장';
  const busy = runningTopicIndex !== null || runQueue.length > 0;
  const productLine = affiliateProduct
    ? `\n제휴상품: ${affiliateProduct}\n이 상품에 맞춰 글의 생활 장면과 선택 기준을 연결합니다.`
    : '\n제휴상품: 주제에 맞게 자동 매칭';
  const msg = busy
    ? `"${currentSearch.topics[topicIndex].title}"\n\n대기열에 추가합니다. 앞의 작업이 끝나면 이어서 ${actLabel}까지 자동 진행합니다.${productLine}\n추가할까요?`
    : `"${currentSearch.topics[topicIndex].title}"\n\n이 글감으로 AI가 글을 쓰고 ${actLabel}까지 자동 진행합니다.${productLine}\n시작할까요?`;
  if (!(await uiConfirm(msg))) return;
  if (completedTopics.has(topicIndex)) completedTopics.delete(topicIndex);
  runQueue.push(topicIndex);
  queuedAffiliateProducts.set(topicIndex, affiliateProduct);
  refreshTopicButtons();
  processQueue(visOverride);
}

// 대기열에서 다음 글감을 꺼내 실행 (한 번에 하나씩)
async function processQueue(visOverride) {
  if (runningTopicIndex !== null) return; // 이미 하나 실행 중이면 대기
  if (!runQueue.length) return;
  const topicIndex = runQueue.shift();
  const affiliateProduct = queuedAffiliateProducts.get(topicIndex) || '';
  queuedAffiliateProducts.delete(topicIndex);
  runningTopicIndex = topicIndex;
  refreshTopicButtons();
  const visibility = visOverride || $('runVisibility').value;
  const mode = $('runMode').value;
  try {
    const { draftId } = await api('/api/run', {
      method: 'POST',
      body: { searchId: currentSearch.searchId, topicIndex, visibility, mode, affiliateProduct },
    });
    watchDraft(draftId, topicIndex);
  } catch (e) {
    // 네이버 로그인 만료(401)면 대기열을 멈추고 재로그인을 안내한다 (계속하면 전부 실패)
    if (/로그인/.test(e.message)) {
      runningTopicIndex = null;
      runQueue = [];
      queuedAffiliateProducts.clear();
      refreshTopicButtons();
      loginValidity = { at: 0, expired: true, checking: false };
      refreshStatus();
      alert('네이버 로그인이 만료되어 실행할 수 없어요.\n우측 상단 "다시 로그인"으로 네이버에 다시 로그인한 뒤 실행해주세요.');
      return;
    }
    alert(e.message);
    runningTopicIndex = null;
    refreshTopicButtons();
    processQueue(visOverride); // 그 외 오류는 다음 글감으로 진행
  }
}

// 남은 글감(완료·실행·대기 제외)을 모두 대기열에 추가해 순서대로 처리
async function runAllTopics() {
  if (!currentSearch) return;
  const pending = currentSearch.topics
    .map((_, i) => i)
    .filter((i) => !completedTopics.has(i) && i !== runningTopicIndex && !runQueue.includes(i));
  if (!pending.length) return alert('대기열에 추가할 글감이 없습니다.');
  const mode = $('runMode').value;
  const visibility = $('runVisibility').value;
  const actLabel = mode === 'publish' ? `바로 ${visibility === 'private' ? '비공개' : '공개'} 발행` : '임시저장';
  const affiliateProduct = selectedAffiliateProduct();
  const productLine = affiliateProduct ? `\n제휴상품: ${affiliateProduct}` : '\n제휴상품: 글마다 자동 매칭';
  if (!(await uiConfirm(`글감 ${pending.length}개를 대기열에 넣고 하나씩 차례대로 ${actLabel}까지 자동 진행합니다.\n(동시가 아니라 안전하게 순서대로 처리됩니다)${productLine}\n시작할까요?`))) return;
  runQueue.push(...pending);
  pending.forEach((index) => queuedAffiliateProducts.set(index, affiliateProduct));
  refreshTopicButtons();
  processQueue();
}

// 글감 실행 버튼 상태 표시
//  - 완료: 연회색 '실행완료' · 실행 중: 오렌지 · 대기: 파랑 '대기 N·취소' · 그 외: 초록
function refreshTopicButtons() {
  document.querySelectorAll('.topic-run-btn').forEach((b, i) => {
    b.classList.remove('btn-green', 'btn-running', 'btn-done', 'btn-primary', 'btn-ghost', 'btn-queued');
    b.disabled = false;
    if (completedTopics.has(i)) {
      if (selectedAffiliateProduct()) {
        b.classList.add('btn-primary');
        b.innerHTML = '지정 상품으로<br>다시쓰기';
      } else {
        b.disabled = true;
        b.classList.add('btn-done');
        b.innerHTML = '실행완료';
      }
    } else if (i === runningTopicIndex) {
      b.disabled = true;
      b.classList.add('btn-running');
      b.innerHTML = '이 글감으로<br>실행 중…';
    } else if (runQueue.includes(i)) {
      // 대기 순번 표시 — 클릭하면 대기 취소
      b.classList.add('btn-queued');
      b.innerHTML = `대기 ${runQueue.indexOf(i) + 1}<br>(취소)`;
    } else {
      b.classList.add('btn-green');
      b.innerHTML = '이 글감으로<br>실행';
    }
  });
  const allBtn = $('runAllBtn');
  if (allBtn) {
    const q = runQueue.length + (runningTopicIndex !== null ? 1 : 0);
    allBtn.textContent = q ? `⚡ 전체 실행 (진행·대기 ${q})` : '⚡ 전체 실행';
  }
}

function renderSteps(status, mode) {
  const wrap = $('progressSteps');
  wrap.innerHTML = '';
  const order = STEPS.map((s) => s.key);
  // 'published'(즉시 발행)와 'saved'(임시저장)는 모두 완료로 취급
  const norm = status === 'published' ? 'saved' : status;
  const idx = order.indexOf(norm === 'error' ? '' : norm);
  STEPS.forEach((s, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'pstep-arrow';
      arrow.textContent = '›';
      wrap.appendChild(arrow);
    }
    const el = document.createElement('span');
    el.className = 'pstep';
    let done = false;
    let active = false;
    if (norm === 'saved') done = true;
    else if (status === 'error') { if (i <= idx) el.classList.add('error'); }
    else if (i < idx) done = true;
    else if (i === idx) active = true;
    if (done) el.classList.add('done');
    if (active) el.classList.add('active');
    const label = s.key === 'publishing' ? (mode === 'publish' ? '발행' : '임시저장') : s.label;
    // 완료=✓, 진행중=◐, 대기=번호
    const mark = done ? '✓' : active ? '◐' : String(i + 1);
    el.textContent = `${mark} ${label}`;
    wrap.appendChild(el);
  });
}

// 실행 중 상태를 해제하고 버튼 색을 다시 그린다 (완료=연회색은 보존, 나머지=초록)
function resetTopicButtons() {
  runningTopicIndex = null;
  refreshTopicButtons();
}

// 진행 상황을 초기화(흰색) 상태로 되돌린다 — 중지 시 사용
function resetProgressUI() {
  const wrap = $('progressSteps');
  wrap.innerHTML = '';
  // 모든 단계를 흰색(대기) 버튼으로만 그린다 (active/done/error 없음)
  STEPS.forEach((s, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'pstep-arrow';
      arrow.textContent = '›';
      wrap.appendChild(arrow);
    }
    const el = document.createElement('span');
    el.className = 'pstep';
    const label = s.key === 'publishing' ? '저장/발행' : s.label;
    el.textContent = `${i + 1} ${label}`;
    wrap.appendChild(el);
  });
  $('progressResult').hidden = true;
  $('stopBtn').hidden = true;
}

// 진행 중지 버튼 — 진행을 멈추고 UI를 초기화(흰색) 상태로 되돌린다
$('stopBtn').onclick = async () => {
  if (!watchingDraft) return;
  const hadQueue = runQueue.length > 0;
  const confirmMsg = hadQueue
    ? `진행 중인 작업과 대기 중인 글감 ${runQueue.length}개를 모두 중지할까요?`
    : '진행 중인 작업을 중지할까요?';
  if (!(await uiConfirm(confirmMsg))) return;
  const id = watchingDraft;
  $('stopBtn').disabled = true;
  $('stopBtn').textContent = '중지 중…';
  try {
    await api(`/api/drafts/${id}/stop`, { method: 'POST' });
  } catch (e) {
    // 백엔드 중지 요청이 실패해도 UI는 초기화한다
    console.warn('중지 요청 실패:', e.message);
  }
  // 폴링 중단 + 대기열 비우기 + 화면 초기화 (버튼 전부 흰색)
  watchingDraft = null;
  runQueue = [];
  queuedAffiliateProducts.clear();
  resetProgressUI();
  resetTopicButtons();
  $('progressMsg').className = 'status err';
  $('progressMsg').textContent = '⏹ 진행이 중지되었습니다.';
  loadDrafts();
};

function watchDraft(draftId, topicIndex = null) {
  watchingDraft = draftId;
  $('progressCard').hidden = false;
  $('progressResult').hidden = true;
  $('progressResult').innerHTML = '';
  $('progressMsg').hidden = false;
  $('stopBtn').hidden = false;
  $('stopBtn').disabled = false;
  $('stopBtn').textContent = '■ 진행 중지';
  $('progressCard').scrollIntoView({ behavior: 'smooth' });
  const poll = setInterval(async () => {
    if (watchingDraft !== draftId) return clearInterval(poll);
    try {
      const { meta } = await api('/api/drafts/' + draftId);
      renderSteps(meta.status, meta.mode);
      $('progressMsg').hidden = false;
      $('progressMsg').className = meta.status === 'error' ? 'status err' : 'status';
      $('progressMsg').textContent = meta.step || meta.status;
      if (meta.status === 'saved' || meta.status === 'published') {
        clearInterval(poll);
        $('stopBtn').hidden = true;
        // 이 글감을 '실행완료(연회색)'로 고정, 나머지는 초록 복귀
        if (topicIndex !== null) completedTopics.add(topicIndex);
        resetTopicButtons();
        // 완료 단계는 위 진행 표시로 충분하므로 중복 완료 문구와 후속 버튼은 숨긴다.
        $('progressMsg').textContent = '';
        $('progressMsg').hidden = true;
        $('progressResult').innerHTML = '';
        $('progressResult').hidden = true;
        loadDrafts();
        processQueue(); // 대기열에 다음 글감이 있으면 이어서 자동 실행
      } else if (meta.status === 'error') {
        clearInterval(poll);
        $('stopBtn').hidden = true;
        resetTopicButtons();
        loadDrafts();
        // 한 글의 이미지 생성·배치·2차 임시저장이 끝나기 전에는 다음 글로 넘어가지 않는다.
        // 아래 이력에서 실패 단계만 재시도하면 완료 후 대기열이 다시 이어진다.
      }
    } catch {}
  }, 3000);
}

// ── 발행 이력 ────────────────────────────────
async function loadDrafts() {
  const drafts = await api('/api/drafts').catch(() => []);
  const wrap = $('draftsList');
  if (!drafts.length) {
    wrap.innerHTML = '<p class="hint">아직 기록이 없습니다.</p>';
    return;
  }
  wrap.innerHTML = '';
  drafts.forEach((d) => {
    const div = document.createElement('div');
    div.className = 'draft';
    const done =
      ['published', 'saved'].includes(d.status) &&
      !d.imagesPending &&
      !d.imagePlacementPending;
    const running = !done && d.status !== 'error';
    const tag = done ? 'tag-published' : d.status === 'error' ? 'tag-error' : 'tag-running';
    const awaitingImageWork = Boolean(d.imagesPending);
    const awaitingPlacement = Boolean(d.imagePlacementPending);
    const tagText = d.imagePlacementOnlyError
      ? '이미지 배치 재시도 필요'
      : d.imageOnlyError
      ? '이미지 재시도 필요'
      : d.status === 'images'
        ? awaitingPlacement && !awaitingImageWork
          ? '네이버 이미지 배치 대기'
          : '이미지 생성 중'
        : awaitingImageWork
          ? '이미지 생성 대기'
          : d.status === 'saved'
            ? '완료'
            : d.status === 'published'
              ? '발행됨'
              : d.status === 'error'
                ? '실패'
                : '진행 중';
    const linkLabel = d.savedAsDraft ? '글쓰기 열기 →' : '글 보기 →';
    const placementRetry = d.status === 'error' && d.imagePlacementOnlyError;
    const imageRetry = d.status === 'error' && d.imageOnlyError;
    const needsFullRetry =
      d.status === 'error' && !placementRetry && !imageRetry && (!d.articleAvailable || !d.imageCount);
    div.innerHTML = `
      <div>
        <div class="d-title"></div>
        <div class="d-sub"></div>
      </div>
      <div class="d-actions">
        <span class="tag-status ${tag}">${tagText}</span>
        ${d.status === 'error' && d.topic && !d.recovered ? `<button class="btn btn-primary btn-retry">${placementRetry ? '이미지 배치 재시도' : imageRetry ? '이미지부터 재시도' : needsFullRetry ? '처음부터 재시도' : `${d.mode === 'publish' ? '발행' : '임시저장'} 재시도`}</button>` : ''}
        ${d.articleAvailable === false ? '<span class="tag-status tag-recovered">이력만 복구</span>' : '<button class="btn btn-ghost btn-preview">미리보기</button>'}
        ${d.title && d.articleAvailable !== false ? `<button class="btn btn-shorts btn-shortform" title="이 원고로 세로 숏폼 만들기">🎬 숏폼</button>` : ''}
        ${d.postUrl ? `<a href="${d.postUrl}" target="_blank">${linkLabel}</a>` : ''}
      </div>`;
    const sfBtn = div.querySelector('.btn-shortform');
    if (sfBtn) sfBtn.onclick = () => sfOpenPanel(d.id, d.title || (d.topic && d.topic.title) || d.keyword);
    div.querySelector('.d-title').textContent = d.title || d.topic?.title || d.keyword;
    div.querySelector('.d-sub').textContent =
      `${new Date(d.createdAt).toLocaleString('ko-KR')} · ${d.keyword} · ${d.visibility === 'private' ? '비공개' : '공개'}` +
      (d.affiliateProduct ? ` · 지정 제휴상품: ${d.affiliateProduct}` : ' · 제휴상품 자동 매칭') +
      (d.frameLabel ? ` · 구성: ${d.frameLabel}` : '') +
      (d.status === 'error' ? ` · ${d.error || ''}` : '');
    const previewBtn = div.querySelector('.btn-preview');
    if (previewBtn) {
      previewBtn.onclick = () => openPreview(d.id);
      if (running) previewBtn.onclick = () => watchDraft(d.id);
    }
    const retryBtn = div.querySelector('.btn-retry');
    if (retryBtn) {
      retryBtn.onclick = async () => {
        const noun = d.mode === 'publish' ? '발행' : '임시저장';
        const message = placementRetry
          ? '저장된 이미지는 그대로 두고 같은 네이버 임시글에 이미지 배치만 다시 시도할까요?'
          : imageRetry
          ? '네이버 1차 임시글은 그대로 두고 이미지를 다시 만든 뒤 자동 배치까지 이어서 진행할까요?'
          : needsFullRetry
          ? `실패한 글감을 처음부터 다시 작성하고 이미지 자리를 준비한 후 ${noun}할까요?`
          : `작성된 글 그대로 ${noun}만 다시 시도할까요?`;
        if (!(await uiConfirm(message))) return;
        try {
          const endpoint = placementRetry
            ? 'retry-image-placement'
            : imageRetry
              ? 'retry-images'
              : needsFullRetry
                ? 'retry'
                : 'retry-publish';
          await api(`/api/drafts/${d.id}/${endpoint}`, { method: 'POST', body: { mode: d.mode || 'draft' } });
          watchDraft(d.id);
        } catch (e) {
          alert(e.message);
        }
      };
    }
    wrap.appendChild(div);
  });
}

// ── 미리보기 모달 ────────────────────────────
async function openPreview(id) {
  try {
    const { meta, article, judgments } = await api('/api/drafts/' + id);
    if (!article) return alert('아직 글이 작성되지 않았습니다.');
    const isProductPost = (meta.products || []).some((product) => product && product.link);
    const shoppingConnectDisclosure =
      '이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.';
    const productForbidden = /출처|공식\s*스토어/i;
    const productPriceBenefit =
      /판매가|할인가|정가|가격|배송비|무료\s*배송|쿠폰|적립(?:금)?|할인율|할인\s*(?:금액|혜택)|사은품/i;
    const cleanProductText = (value) =>
      String(value || '')
        .split('\n')
        .map((line) => line.replace(/\s*\(출처\s*[:：][^)]+\)\s*/gi, '').trim())
        .filter(
          (line) =>
            line &&
            (line === shoppingConnectDisclosure ||
              (!productForbidden.test(line) && !productPriceBenefit.test(line)))
        )
        .join('\n');
    const body = $('modalBody');
    body.innerHTML = '';
    body.classList.toggle('preview-product', isProductPost);
    const h1 = document.createElement('h1');
    h1.textContent = isProductPost
      ? cleanProductText(article.title) || `${meta.products?.[0]?.name || '상품'} 구성과 사용 전 확인할 점`
      : article.title;
    body.appendChild(h1);
    if (article.titleAlternatives?.length) {
      const alternatives = isProductPost
        ? article.titleAlternatives.map(cleanProductText).filter(Boolean)
        : article.titleAlternatives;
      const alt = document.createElement('div');
      alt.style.cssText = 'font-size:12px;color:#888;margin:-10px 0 14px';
      alt.textContent = '제목 대안: ' + alternatives.join(' | ');
      if (alternatives.length) body.appendChild(alt);
    }
    const bySlot = new Map((judgments || []).map((j) => [j.slot, j]));
    const previewBlocks = isProductPost
      ? [
          { type: 'paragraph', text: shoppingConnectDisclosure, disclosure: true },
          ...(article.blocks || []).filter(
            (block) =>
              !(block.type === 'paragraph' && /쇼핑\s*커넥트\s*활동|판매\s*발생\s*시\s*수수료/.test(block.text || ''))
          ),
        ]
      : article.blocks || [];
    const deferredPreviewCtaIndex = previewBlocks.reduce(
      (lastIndex, block, index) =>
        block.type === 'paragraph' && !block.disclosure ? index : lastIndex,
      -1
    );
    const deferredPreviewCta = deferredPreviewCtaIndex >= 0
      ? previewBlocks[deferredPreviewCtaIndex]
      : null;
    for (const [blockIndex, b] of previewBlocks.entries()) {
      if (blockIndex === deferredPreviewCtaIndex) continue;
      if (b.type === 'heading') {
        const blockText = isProductPost ? cleanProductText(b.text) : b.text;
        if (!blockText) continue;
        const el = document.createElement('h3');
        el.textContent = blockText;
        body.appendChild(el);
      } else if (b.type === 'paragraph') {
        const blockText = isProductPost ? cleanProductText(b.text) : b.text;
        if (!blockText) continue;
        const el = document.createElement('p');
        el.style.textAlign = 'left';
        el.innerHTML = escapeHtml(blockText)
          .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
          .replace(/\n/g, '<br>'); // 문단 안 줄은 붙여서 (실제 에디터와 동일)
        body.appendChild(el);
      } else if (b.type === 'quote') {
        const blockText = isProductPost ? cleanProductText(b.text) : b.text;
        if (!blockText) continue;
        const el = document.createElement('blockquote');
        if (isProductPost) {
          el.className = blockText.includes('\n') ? 'product-summary' : 'product-point';
        }
        el.innerHTML = escapeHtml(blockText).replace(/\n/g, '<br>');
        body.appendChild(el);
      } else if (b.type === 'divider') {
        body.appendChild(document.createElement('hr'));
      } else if (b.type === 'image') {
        const j = bySlot.get(b.slot);
        if (j && j.file) {
          const img = document.createElement('img');
          img.src = `/api/drafts/${id}/images/${j.file}`;
          body.appendChild(img);
          const cap = document.createElement('div');
          cap.className = 'caption';
          if (j.ai) {
            const cleanCaption = String(j.caption || '').replace(/\s*\(AI 연출 이미지\)\s*$/, '').trim();
            cap.textContent = cleanCaption ? `${cleanCaption}(AI 연출 이미지)` : 'AI 연출 이미지';
          } else if (isProductPost) {
            cap.textContent = cleanProductText(j.caption);
          } else {
            // 건강 글 미리보기에도 조사 출처를 노출하지 않는다.
            cap.textContent = j.caption || '';
          }
          body.appendChild(cap);
        } else if (!isProductPost) {
          const placeholder = document.createElement('div');
          placeholder.className = 'image-placeholder';
          const title = document.createElement('strong');
          title.textContent = `🖼 이미지 ${b.slot} 넣을 자리`;
          const desc = document.createElement('span');
          desc.textContent = `추천 장면: ${j?.desc || b.desc || b.caption || '글 내용에 맞는 이미지'}`;
          placeholder.append(title, desc);
          body.appendChild(placeholder);
        }
      }
    }
    // 상품 글에만 기사 출처를 표시한다. 건강 글의 조사 출처는 내부 기록으로만 보관한다.
    const newsRefs = (meta.refs || []).filter((r) => r && r.url && r.kind === 'news');
    const appendNewsRefs = () => {
      if (!newsRefs.length) return;
      body.appendChild(document.createElement('hr'));
      const st = document.createElement('h3');
      st.textContent = isProductPost ? '📌 참고한 건강 기사' : '📌 출처';
      body.appendChild(st);
      const ul = document.createElement('div');
      ul.style.fontSize = '13px';
      newsRefs.slice(0, 8).forEach((r) => {
        const line = document.createElement('div');
        line.style.marginBottom = '6px';
        const a = document.createElement('a');
        a.href = r.url;
        a.target = '_blank';
        a.style.color = '#2563eb';
        a.textContent = `· ${r.title || r.url}`;
        line.appendChild(a);
        ul.appendChild(line);
      });
      body.appendChild(ul);
    };
    if (isProductPost) appendNewsRefs();
    if (deferredPreviewCta?.text) {
      const cta = document.createElement('p');
      cta.style.cssText = 'text-align:left;margin-top:48px';
      cta.innerHTML = escapeHtml(cleanProductText(deferredPreviewCta.text))
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\n/g, '<br>');
      body.appendChild(cta);
    }
    if (article.tags?.length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      tags.textContent = article.tags.map((t) => '#' + t).join(' ');
      body.appendChild(tags);
    }
    // 주력 상품 링크는 미리보기에서도 항상 마지막에 둔다.
    const prods = (meta.products || []).filter((p) => p && p.link);
    if (prods.length) {
      prods.forEach((p) => {
        const line = document.createElement('div');
        line.style.cssText = 'font-size:13px;margin-bottom:6px';
        const a = document.createElement('a');
        a.href = p.link;
        a.target = '_blank';
        a.style.color = '#03c75a';
        a.textContent = `▶ ${p.name || '상품'} 선택 기준 확인하기 → ${p.link}`;
        line.appendChild(a);
        body.appendChild(line);
      });
    }
    if (!isProductPost) appendNewsRefs();
    $('modal').hidden = false;
  } catch (e) {
    alert(e.message);
  }
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
$('modalClose').onclick = () => ($('modal').hidden = true);
$('modal').onclick = (e) => { if (e.target === $('modal')) $('modal').hidden = true; };

// ═══════════════ 대시보드 인라인 숏폼 ═══════════════
// 글쓰기 완료 → '숏폼 제작하기' → 여기서 바로 생성하고 작은 미리보기를 보여준다.
// 큰 화면은 '미리보기' 버튼(모달)에서. 렌더링은 공용 SF(shortform-render.js) 사용.
const sfS = { draftId: null, sf: null, imgCache: new Map(), playing: false, playT: 0, poll: null };
const sfMiniCanvas = $('sfMiniStage');
const sfMiniCtx = sfMiniCanvas.getContext('2d');
const sfBigCanvas = $('sfBigStage');
const sfBigCtx = sfBigCanvas.getContext('2d');

function sfDefaultsStyle(data) {
  data.style = { offsetY: 10, hookY: 172, hookSize: 76, hookBoxed: true, textSize: 60, theme: 'dark', boxed: true, kenBurns: true, narration: true, ...(data.style || {}) };
  return data;
}

function sfRender() {
  if (!sfS.sf) return;
  SF.drawFrame(sfMiniCtx, sfS.sf, sfS.playT, sfS.imgCache);
  if (!$('sfModal').hidden) {
    SF.drawFrame(sfBigCtx, sfS.sf, sfS.playT, sfS.imgCache);
    const total = SF.totalSec(sfS.sf);
    $('sfBigSeek').value = total ? Math.round((sfS.playT / total) * 1000) : 0;
    $('sfBigTime').textContent = `${sfS.playT.toFixed(1)} / ${total.toFixed(1)}초`;
  }
}

function sfUpdatePlayBtns() {
  $('sfMiniPlay').textContent = sfS.playing ? '❚❚' : '▶';
  $('sfBigPlay').textContent = sfS.playing ? '❚❚ 정지' : '▶ 재생';
}

async function sfStartLoop() {
  const total = SF.totalSec(sfS.sf);
  if (sfS.playT >= total - 0.05) sfS.playT = 0;
  const t0 = performance.now() - sfS.playT * 1000;
  sfS.playing = true;
  sfUpdatePlayBtns();
  while (sfS.playing) {
    sfS.playT = Math.min(total, (performance.now() - t0) / 1000);
    sfRender();
    if (sfS.playT >= total) break;
    await SF.nextTick();
  }
  sfS.playing = false;
  sfUpdatePlayBtns();
}
function sfStop() { sfS.playing = false; sfUpdatePlayBtns(); }

// 진행 상태 문자열 → 진행률(%) 추정
function sfProcPct(step) {
  const m = /\((\d+)\s*\/\s*(\d+)\)/.exec(step || '');
  if (m) return 20 + Math.round((Number(m[1]) / Number(m[2])) * 72); // 이미지 단계 20~92%
  if (/대본/.test(step || '')) return 12;
  if (/준비/.test(step || '')) return 16;
  return 8;
}

function sfShowProcess(step) {
  $('sfMakeRow').hidden = true;
  $('sfResult').hidden = true;
  $('sfProcess').hidden = false;
  $('sfProcStep').textContent = step || '준비 중…';
  $('sfProcFill').style.width = sfProcPct(step) + '%';
}

async function sfShowResult(data) {
  sfS.sf = sfDefaultsStyle(data);
  sfS.playT = 0;
  $('sfProcess').hidden = true;
  $('sfMakeRow').hidden = true;
  $('sfResult').hidden = false;
  const secs = SF.totalSec(sfS.sf).toFixed(0);
  const imgN = sfS.sf.scenes.filter((s) => s.file).length;
  $('sfMeta').innerHTML = `후킹: <b>${escapeHtml(sfS.sf.hook || '')}</b> · ${sfS.sf.scenes.length}장면 · 약 ${secs}초 · 이미지 ${imgN}장`;
  await SF.ensureFont();
  await SF.preloadAll(sfS.imgCache, sfS.draftId, sfS.sf);
  sfS.playT = 0.35;
  sfRender();
}

function sfPollStatus() {
  clearInterval(sfS.poll);
  sfS.poll = setInterval(async () => {
    const data = await api(`/api/drafts/${sfS.draftId}/shortform`).catch(() => null);
    if (!data) return;
    if (data.status === 'ready') {
      clearInterval(sfS.poll);
      sfShowResult(data);
    } else if (data.status === 'error') {
      clearInterval(sfS.poll);
      $('sfProcess').hidden = true;
      $('sfMakeRow').hidden = false;
      alert('숏폼 생성 실패: ' + (data.error || '알 수 없는 오류'));
    } else {
      sfShowProcess(data.step);
    }
  }, 2500);
}

async function sfGenerate() {
  sfStop();
  sfShowProcess('AI가 숏폼 대본을 쓰는 중…');
  try {
    await api(`/api/drafts/${sfS.draftId}/shortform`, {
      method: 'POST',
      body: {
        sceneCount: Number($('sfSceneCount').value),
        totalSeconds: Number($('sfTotalSeconds').value),
        imageMode: $('sfImageMode').value,
      },
    });
    sfPollStatus();
  } catch (e) {
    $('sfProcess').hidden = true;
    $('sfMakeRow').hidden = false;
    alert('시작 실패: ' + e.message);
  }
}

// 패널 열기 — 이미 만들어진 숏폼이 있으면 결과로, 생성 중이면 진행으로, 없으면 옵션 표시
function sfOpenPanel(draftId, title) {
  sfStop();
  clearInterval(sfS.poll);
  sfS.draftId = draftId;
  sfS.sf = null;
  sfS.imgCache = new Map();
  sfS.playT = 0;
  $('shortformCard').hidden = false;
  $('sfForTitle').textContent = title ? '— ' + title : '';
  $('sfProcess').hidden = true;
  $('sfResult').hidden = true;
  $('sfMakeRow').hidden = false;
  $('sfExportStatus').hidden = true;
  $('sfExportBarWrap').hidden = true;
  $('shortformCard').scrollIntoView({ behavior: 'smooth' });
  api(`/api/drafts/${draftId}/shortform`)
    .then((data) => {
      if (data && data.status === 'ready') sfShowResult(data);
      else if (data && data.status === 'building') { sfShowProcess(data.step); sfPollStatus(); }
    })
    .catch(() => {}); // 아직 숏폼 없음 → 옵션 표시 상태 유지
}

$('sfMakeBtn').onclick = sfGenerate;
$('sfRemakeBtn').onclick = async () => {
  if (!(await uiConfirm('현재 숏폼을 버리고 AI가 다시 만들까요?'))) return;
  $('sfResult').hidden = true;
  $('sfMakeRow').hidden = false;
};
$('sfCloseBtn').onclick = () => { sfStop(); clearInterval(sfS.poll); $('shortformCard').hidden = true; };
$('sfMiniPlay').onclick = () => (sfS.playing ? sfStop() : sfStartLoop());
$('sfEditBtn').onclick = () => (location.href = `shortform.html?id=${sfS.draftId}`);

// 큰 미리보기 모달
$('sfPreviewBtn').onclick = () => {
  $('sfModal').hidden = false;
  sfRender();
};
$('sfModalClose').onclick = () => { sfStop(); $('sfModal').hidden = true; };
$('sfModal').onclick = (e) => { if (e.target === $('sfModal')) { sfStop(); $('sfModal').hidden = true; } };
$('sfBigPlay').onclick = () => (sfS.playing ? sfStop() : sfStartLoop());
$('sfBigSeek').oninput = (e) => { sfStop(); sfS.playT = (Number(e.target.value) / 1000) * SF.totalSec(sfS.sf); sfRender(); };

// 영상 다운로드 (진행률 표시)
$('sfVideoBtn').onclick = async () => {
  const btn = $('sfVideoBtn');
  btn.disabled = true;
  sfStop();
  $('sfExportBarWrap').hidden = false;
  $('sfExportStatus').hidden = false;
  $('sfExportStatus').className = 'status';
  $('sfExportStatus').textContent = '녹화 준비 중…';
  try {
    const total = SF.totalSec(sfS.sf);
    // 녹화는 미니 캔버스에 그려 담는다(화면 표시 상태와 무관하게 프레임 확보)
    const { blob, ext } = await SF.exportVideo(sfMiniCanvas, sfMiniCtx, sfS.sf, sfS.imgCache, sfS.draftId, {
      onProgress: (t) => {
        $('sfExportFill').style.width = Math.round((t / total) * 100) + '%';
        $('sfExportStatus').textContent = `녹화 중… ${t.toFixed(1)} / ${total.toFixed(1)}초`;
      },
    });
    sfS.playT = 0.35; sfRender();
    const name = `shortform-${(sfS.sf.title || sfS.draftId).replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}.${ext}`;
    SF.download(blob, name);
    $('sfExportStatus').textContent = `✅ ${name} (${(blob.size / 1024 / 1024).toFixed(1)}MB) 다운로드 완료`;
  } catch (e) {
    $('sfExportStatus').className = 'status err';
    $('sfExportStatus').textContent = '실패: ' + e.message;
  } finally {
    $('sfExportBarWrap').hidden = true;
    btn.disabled = false;
  }
};

// 사용 이미지 전체 ZIP
$('sfZipBtn').onclick = async () => {
  const btn = $('sfZipBtn');
  btn.disabled = true;
  $('sfExportStatus').hidden = false;
  $('sfExportStatus').className = 'status';
  $('sfExportStatus').textContent = '이미지 압축 중…';
  try {
    const blob = await SF.buildImagesZip(sfS.draftId, sfS.sf);
    const name = `shortform-images-${(sfS.sf.title || sfS.draftId).replace(/[\\/:*?"<>|]/g, '').slice(0, 30)}.zip`;
    SF.download(blob, name);
    $('sfExportStatus').textContent = `✅ 이미지 ${sfS.sf.scenes.filter((s) => s.file).length}장 ZIP 다운로드 완료`;
  } catch (e) {
    $('sfExportStatus').className = 'status err';
    $('sfExportStatus').textContent = '실패: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

// 초기화
refreshStatus();
restoreLatestTopics();
loadDrafts();
setInterval(loadDrafts, 15000);
setInterval(refreshStatus, 10000);
