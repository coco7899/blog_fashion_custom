// 대시보드 프런트엔드
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
  { key: 'images', label: '이미지 선별' },
  { key: 'publishing', label: '임시저장' },
  { key: 'saved', label: '완료' },
];

let currentSearch = null;
let watchingDraft = null;
let loginPolling = false;
let runningTopicIndex = null;        // 현재 실행 중인 글감 인덱스 (오렌지)
const completedTopics = new Set();   // 이미 실행 완료한 글감 인덱스 (연회색)

// ── 로그인 상태 ──────────────────────────────
async function refreshStatus() {
  try {
    const s = await api('/api/status');
    const badge = $('loginBadge');
    if (!s.claude.ok) {
      $('envBadge').hidden = false;
      $('envBadge').className = 'badge badge-warn';
      $('envBadge').textContent = '⚠ claude CLI 없음';
    } else if (s.claudeAuth && !s.claudeAuth.ok) {
      $('envBadge').hidden = false;
      $('envBadge').className = 'badge badge-warn';
      $('envBadge').textContent = '⚠ AI 사용 불가: ' + s.claudeAuth.error;
    } else {
      $('envBadge').hidden = true;
    }
    if (s.session) {
      badge.className = 'badge';
      badge.textContent = s.blogId ? `로그인됨 (${s.blogId})` : '로그인됨';
      $('loginBtn').textContent = '다시 로그인';
      $('logoutBtn').hidden = false;
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

// ── 모드 1: 연예인 뉴스 글 — 글감 찾기 (중지 가능) ────────
let topicsAbort = null;
$('newsModeBtn').onclick = async () => {
  const btn = $('newsModeBtn');
  const stopBtn = $('newsStopBtn');
  btn.disabled = true;
  stopBtn.hidden = false;
  const st = $('newsModeStatus');
  st.hidden = false;
  st.className = 'status';
  st.textContent = '최신 연예인 뉴스를 수집하고 AI가 글감을 뽑는 중... (1~2분) — 오른쪽 중지 버튼으로 취소할 수 있어요.';
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
    stopBtn.hidden = true;
    topicsAbort = null;
  }
};
// 글감 찾기 중지 — 진행 중인 요청을 취소한다
$('newsStopBtn').onclick = () => {
  if (topicsAbort) topicsAbort.abort();
};

// ── 모드 1-b: 뉴스 링크로 바로 글쓰기 ─────────
$('linkModeBtn').onclick = async () => {
  const url = $('linkInput').value.trim();
  if (!/^https?:\/\//.test(url)) return alert('뉴스 기사 링크(https://...)를 붙여넣어 주세요.');
  const mode = $('runMode').value;
  const visibility = $('runVisibility').value;
  const actLabel = mode === 'publish' ? `바로 ${visibility === 'private' ? '비공개' : '공개'} 발행` : '임시저장';
  if (!(await uiConfirm(`이 기사 링크를 바탕으로 AI가 글을 쓰고 ${actLabel}까지 진행합니다.\n${url}\n시작할까요?`))) return;
  const btn = $('linkModeBtn');
  btn.disabled = true;
  const st = $('newsModeStatus');
  st.hidden = false;
  st.className = 'status';
  st.textContent = '기사를 확인하는 중...';
  try {
    const data = await api('/api/run-link', { method: 'POST', body: { url, visibility, mode } });
    st.textContent = `"${(data.title || '').slice(0, 40)}" 기사로 작성 시작 — 아래 진행 상황에서 확인하세요.`;
    watchDraft(data.draftId);
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

// ── 모드 2: 상품 소개 글 — 반응 좋은 상품 자동 선정 ──
$('productModeBtn').onclick = async () => {
  const mode = $('runMode').value;
  const visibility = $('runVisibility').value;
  const actLabel = mode === 'publish' ? `바로 ${visibility === 'private' ? '비공개' : '공개'} 발행` : '임시저장';
  if (!(await uiConfirm(`쇼핑커넥트에서 지금 반응 좋은 상품 1개를 자동으로 골라 소개 글을 쓰고 ${actLabel}까지 진행합니다.\n시작할까요?`))) return;
  const btn = $('productModeBtn');
  btn.disabled = true;
  const st = $('productModeStatus');
  st.hidden = false;
  st.className = 'status';
  st.textContent = '상품 선정 및 글 작성을 시작합니다...';
  try {
    const { draftId } = await api('/api/run-product', { method: 'POST', body: { visibility, mode } });
    st.textContent = '진행 중 — 아래 진행 상황에서 확인하세요.';
    watchDraft(draftId);
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

// ── 모드 2-b: 내 상품 링크로 소개 글쓰기 ──────
$('productLinkBtn').onclick = async () => {
  const url = $('productLinkInput').value.trim();
  if (!/^https?:\/\//.test(url)) return alert('상품 링크(쇼핑커넥트/스마트스토어, https://...)를 붙여넣어 주세요.');
  const mode = $('runMode').value;
  const visibility = $('runVisibility').value;
  const actLabel = mode === 'publish' ? `바로 ${visibility === 'private' ? '비공개' : '공개'} 발행` : '임시저장';
  if (!(await uiConfirm(`이 상품 링크로 소개 글을 쓰고 ${actLabel}까지 진행합니다.\n${url}\n시작할까요?`))) return;
  const btn = $('productLinkBtn');
  btn.disabled = true;
  const st = $('productModeStatus');
  st.hidden = false;
  st.className = 'status';
  st.textContent = '상품 정보를 확인하는 중...';
  try {
    const data = await api('/api/run-product', { method: 'POST', body: { url, visibility, mode } });
    st.textContent = '진행 중 — 아래 진행 상황에서 확인하세요.';
    watchDraft(data.draftId);
  } catch (e) {
    st.className = 'status err';
    st.textContent = '실패: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

// ── 모든 글감 삭제 (#5) ───────────────────────
$('clearTopicsBtn').onclick = () => {
  currentSearch = null;
  $('topicsList').innerHTML = '';
  $('topicsCard').hidden = true;
};

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
function renderTopics(data, visOverride) {
  $('topicsCard').hidden = false;
  // 새 글감 목록 → 실행 상태 초기화 (모두 대기=초록)
  runningTopicIndex = null;
  completedTopics.clear();
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
    div.querySelector('.t-angle').textContent = t.angle;
    div.querySelector('.t-keywords').textContent = (t.keywords || []).map((k) => '#' + k).join(' ');
    div.querySelector('button').onclick = (e) => startRun(i, visOverride, e.currentTarget);
    list.appendChild(div);
  });
  $('topicsCard').scrollIntoView({ behavior: 'smooth' });
}

// ── 파이프라인 실행 & 진행 표시 ──────────────
async function startRun(topicIndex, visOverride, btnEl) {
  if (!currentSearch) return;
  // 발행 방식·공개 설정은 상단 "글쓰기 모드 선택"의 설정을 따른다
  const visibility = visOverride || $('runVisibility').value;
  const mode = $('runMode').value; // 'draft' | 'publish'
  const actLabel = mode === 'publish' ? `바로 ${visibility === 'private' ? '비공개' : '공개'} 발행` : '네이버 블로그에 임시저장';
  if (!(await uiConfirm(`"${currentSearch.topics[topicIndex].title}"\n\n이 글감으로 AI가 글을 쓰고 ${actLabel}까지 자동 진행합니다.\n시작할까요?`))) return;
  // 선택한 글감만 오렌지(실행 중), 나머지 대기 글감은 초록 유지, 완료 글감은 연회색 유지
  runningTopicIndex = topicIndex;
  refreshTopicButtons();
  try {
    const { draftId } = await api('/api/run', {
      method: 'POST',
      body: { searchId: currentSearch.searchId, topicIndex, visibility, mode },
    });
    watchDraft(draftId, topicIndex);
  } catch (e) {
    alert(e.message);
    // 실패 시 실행 중 상태 해제 → 초록으로 원복
    runningTopicIndex = null;
    refreshTopicButtons();
  }
}

// 글감 실행 버튼 색상을 상태에 맞게 다시 그린다
//  - 완료: 연회색 '실행완료'  · 실행 중: 오렌지  · 그 외 대기: 초록
function refreshTopicButtons() {
  const anyRunning = runningTopicIndex !== null;
  document.querySelectorAll('.topic-run-btn').forEach((b, i) => {
    b.classList.remove('btn-green', 'btn-running', 'btn-done', 'btn-primary', 'btn-ghost');
    if (completedTopics.has(i)) {
      b.disabled = true;
      b.classList.add('btn-done');
      b.innerHTML = '실행완료';
    } else if (i === runningTopicIndex) {
      b.disabled = true;
      b.classList.add('btn-running');
      b.innerHTML = '이 글감으로<br>실행 중…';
    } else {
      b.disabled = anyRunning; // 다른 글감 실행 중엔 클릭 방지, 색은 초록 유지
      b.classList.add('btn-green');
      b.innerHTML = '이 글감으로<br>실행';
    }
  });
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
  if (!(await uiConfirm('진행 중인 작업을 중지할까요?'))) return;
  const id = watchingDraft;
  $('stopBtn').disabled = true;
  $('stopBtn').textContent = '중지 중…';
  try {
    await api(`/api/drafts/${id}/stop`, { method: 'POST' });
  } catch (e) {
    // 백엔드 중지 요청이 실패해도 UI는 초기화한다
    console.warn('중지 요청 실패:', e.message);
  }
  // 폴링 중단 + 화면 초기화 (버튼 전부 흰색)
  watchingDraft = null;
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
  $('stopBtn').hidden = false;
  $('stopBtn').disabled = false;
  $('stopBtn').textContent = '■ 진행 중지';
  $('progressCard').scrollIntoView({ behavior: 'smooth' });
  const poll = setInterval(async () => {
    if (watchingDraft !== draftId) return clearInterval(poll);
    try {
      const { meta } = await api('/api/drafts/' + draftId);
      renderSteps(meta.status, meta.mode);
      $('progressMsg').className = meta.status === 'error' ? 'status err' : 'status';
      $('progressMsg').textContent = meta.step || meta.status;
      if (meta.status === 'saved' || meta.status === 'published') {
        clearInterval(poll);
        $('stopBtn').hidden = true;
        // 이 글감을 '실행완료(연회색)'로 고정, 나머지는 초록 복귀
        if (topicIndex !== null) completedTopics.add(topicIndex);
        resetTopicButtons();
        const r = $('progressResult');
        r.hidden = false;
        if (meta.status === 'saved') {
          r.innerHTML = `✅ 임시저장 완료! 네이버 블로그 글쓰기에서 "이어쓰기"로 열어 검토 후 발행하세요. <a href="${meta.postUrl}" target="_blank" style="color:#03c75a;font-weight:700">글쓰기 열기 →</a>`;
        } else {
          r.innerHTML = `🎉 발행 완료! <a href="${meta.postUrl}" target="_blank" style="color:#03c75a;font-weight:700">발행된 글 보기 →</a>`;
        }
        loadDrafts();
      } else if (meta.status === 'error') {
        clearInterval(poll);
        $('stopBtn').hidden = true;
        resetTopicButtons();
        loadDrafts();
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
    const done = ['published', 'saved'].includes(d.status);
    const running = !done && d.status !== 'error';
    const tag = done ? 'tag-published' : d.status === 'error' ? 'tag-error' : 'tag-running';
    const tagText = d.status === 'saved' ? '임시저장됨' : d.status === 'published' ? '발행됨' : d.status === 'error' ? '실패' : '진행 중';
    const linkLabel = d.status === 'saved' ? '글쓰기 열기 →' : '글 보기 →';
    div.innerHTML = `
      <div>
        <div class="d-title"></div>
        <div class="d-sub"></div>
      </div>
      <div class="d-actions">
        <span class="tag-status ${tag}">${tagText}</span>
        ${d.status === 'error' && d.title ? `<button class="btn btn-primary btn-retry">${d.mode === 'publish' ? '발행' : '임시저장'} 재시도</button>` : ''}
        <button class="btn btn-ghost btn-preview">미리보기</button>
        ${d.postUrl ? `<a href="${d.postUrl}" target="_blank">${linkLabel}</a>` : ''}
      </div>`;
    div.querySelector('.d-title').textContent = d.title || d.topic?.title || d.keyword;
    div.querySelector('.d-sub').textContent =
      `${new Date(d.createdAt).toLocaleString('ko-KR')} · ${d.keyword} · ${d.visibility === 'private' ? '비공개' : '공개'}` +
      (d.frameLabel ? ` · 구성: ${d.frameLabel}` : '') +
      (d.status === 'error' ? ` · ${d.error || ''}` : '');
    div.querySelector('.btn-preview').onclick = () => openPreview(d.id);
    if (running) div.querySelector('.btn-preview').onclick = () => watchDraft(d.id);
    const retryBtn = div.querySelector('.btn-retry');
    if (retryBtn) {
      retryBtn.onclick = async () => {
        const noun = d.mode === 'publish' ? '발행' : '임시저장';
        if (!(await uiConfirm(`작성된 글 그대로 ${noun}만 다시 시도할까요?`))) return;
        try {
          await api(`/api/drafts/${d.id}/retry-publish`, { method: 'POST', body: { mode: d.mode || 'draft' } });
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
    const body = $('modalBody');
    body.innerHTML = '';
    const h1 = document.createElement('h1');
    h1.textContent = article.title;
    body.appendChild(h1);
    if (article.titleAlternatives?.length) {
      const alt = document.createElement('div');
      alt.style.cssText = 'font-size:12px;color:#888;margin:-10px 0 14px';
      alt.textContent = '제목 대안: ' + article.titleAlternatives.join(' | ');
      body.appendChild(alt);
    }
    // 공정위 고지 — 제휴 링크(상품)가 있는 글에만 (발행 시 시스템이 본문 맨 위 삽입)
    if ((meta.products || []).some((p) => p && p.link)) {
      const disc = document.createElement('p');
      disc.style.cssText = 'font-size:13px;color:#777';
      disc.textContent = '이 글은 네이버 쇼핑커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.';
      body.appendChild(disc);
    }
    const bySlot = new Map((judgments || []).map((j) => [j.slot, j]));
    for (const b of article.blocks) {
      if (b.type === 'heading') {
        const el = document.createElement('h3');
        el.textContent = b.text;
        body.appendChild(el);
      } else if (b.type === 'paragraph') {
        if (/쇼핑커넥트 활동/.test(b.text || '')) continue; // 고지 문구는 위에서 이미 표시
        const el = document.createElement('p');
        el.style.textAlign = 'left';
        el.innerHTML = escapeHtml(b.text)
          .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
          .replace(/\n/g, '<br>'); // 문단 안 줄은 붙여서 (실제 에디터와 동일)
        body.appendChild(el);
      } else if (b.type === 'quote') {
        const el = document.createElement('blockquote');
        el.innerHTML = escapeHtml(b.text).replace(/\n/g, '<br>');
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
          cap.textContent = `▲ ${j.caption || ''}${j.sourceName ? ` (사진 출처: ${j.sourceName})` : ''}`;
          body.appendChild(cap);
        }
      }
    }
    // 출처 (참고한 뉴스 링크) — 글 맨 아래
    const newsRefs = (meta.refs || []).filter((r) => r && r.url && r.kind === 'news');
    if (newsRefs.length) {
      body.appendChild(document.createElement('hr'));
      const st = document.createElement('h3');
      st.textContent = '📌 출처';
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
    }
    // 상품 제휴 링크 (상품 소개 글)
    const prods = (meta.products || []).filter((p) => p && p.link);
    if (prods.length) {
      body.appendChild(document.createElement('hr'));
      const st2 = document.createElement('h3');
      st2.textContent = '🛍 상품 링크';
      body.appendChild(st2);
      prods.forEach((p) => {
        const line = document.createElement('div');
        line.style.cssText = 'font-size:13px;margin-bottom:6px';
        const a = document.createElement('a');
        a.href = p.link;
        a.target = '_blank';
        a.style.color = '#03c75a';
        a.textContent = `· ${p.name || '상품'} → ${p.link}`;
        line.appendChild(a);
        body.appendChild(line);
      });
    }
    if (article.tags?.length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      tags.textContent = article.tags.map((t) => '#' + t).join(' ');
      body.appendChild(tags);
    }
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

// 초기화
refreshStatus();
loadDrafts();
setInterval(loadDrafts, 15000);
setInterval(refreshStatus, 10000);
