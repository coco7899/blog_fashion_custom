// 네이버 블로그 자동화 대시보드 서버
const path = require('path');
const express = require('express');

const setup = require('./src/setup');
const claude = require('./src/claude');
const store = require('./src/store');
const auth = require('./src/naverAuth');
const collector = require('./src/collector');
const topics = require('./src/topics');
const pipeline = require('./src/pipeline');
const scheduler = require('./src/scheduler');
const shortform = require('./src/shortform');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 환경/로그인 상태 ─────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const env = setup.checkAll();
  // 인증 실패 상태면 2분마다 백그라운드로 재점검 (재로그인 후 자동 복구)
  const authNow = claude.getAuthStatus();
  if (env.claude.ok && authNow && !authNow.ok && Date.now() - authNow.at > 2 * 60 * 1000) {
    claude.checkAuth(true).then((a) => {
      if (a.ok) console.log('[setup] claude 인증 복구 확인 — AI 사용 가능');
    });
  }
  res.json({
    chromium: env.chromium,
    claude: env.claude,
    claudeAuth: authNow, // null이면 아직 점검 전

    session: auth.hasState(),
    blogId: auth.getProfile().blogId || null,
    loginInProgress: auth.isLoginInProgress(),
    loginError: auth.getLastLoginError(),
  });
});

app.post('/api/login', (req, res) => {
  if (auth.isLoginInProgress()) {
    return res.json({ started: false, error: '이미 로그인 창이 열려 있습니다.' });
  }
  // 비동기로 로그인 창을 띄우고 즉시 응답 — UI는 /api/login/status 폴링
  auth.startLogin().then((r) => console.log('[login]', JSON.stringify(r)));
  res.json({ started: true });
});

app.get('/api/login/status', async (req, res) => {
  try {
    const result = await auth.verify(req.query.fresh === '1');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  auth.logout();
  res.json({ ok: true });
});

// ── 글감 찾기 ────────────────────────────────────────────────
app.post('/api/topics', async (req, res) => {
  const keyword = String(req.body.keyword || '').trim();
  if (!keyword) return res.status(400).json({ error: '키워드를 입력하세요.' });
  try {
    console.log(`[topics] "${keyword}" 최신 뉴스 검색 수집 시작`);
    const { news, blogs } = await collector.searchNaver(keyword, { recentNews: true });
    const sources = [...news, ...blogs];
    if (!sources.length) {
      return res.status(500).json({ error: '검색 결과를 수집하지 못했습니다. 키워드를 바꿔보세요.' });
    }
    console.log(`[topics] 뉴스 ${news.length}건 + 블로그 ${blogs.length}건 → 글감 생성 중`);
    const list = await topics.suggestTopics(keyword, sources);
    const searchId = store.saveSearch({ keyword, sources, topics: list, at: new Date().toISOString() });
    res.json({ searchId, keyword, sources, topics: list });
  } catch (e) {
    console.error('[topics] 실패:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 수동 실행: 글감 선택 → 파이프라인 (임시저장 또는 발행) ────
app.post('/api/run', async (req, res) => {
  const { searchId, topicIndex, visibility } = req.body || {};
  const mode = req.body && req.body.mode === 'publish' ? 'publish' : 'draft';
  const search = store.getSearch(searchId);
  if (!search) return res.status(400).json({ error: '검색 세션을 찾을 수 없습니다. 글감을 다시 찾아주세요.' });
  const topic = search.topics && search.topics[topicIndex];
  if (!topic) return res.status(400).json({ error: '글감을 찾을 수 없습니다.' });

  const login = await auth.verify();
  if (!login.loggedIn) {
    return res.status(401).json({ error: '네이버 로그인이 필요합니다. 먼저 로그인해주세요.' });
  }

  const meta = store.createDraft({
    keyword: search.keyword,
    topic,
    visibility: visibility === 'private' ? 'private' : 'public',
    mode,
  });
  // 백그라운드 실행 (알림 메일은 스케줄 설정의 주소 사용)
  pipeline.run(meta.id, search, topic, meta.visibility, {
    notifyEmail: scheduler.getStatus().settings.notifyEmail,
    mode,
  });
  res.json({ draftId: meta.id });
});

// ── 상품 소개 글 실행: 반응 좋은 상품 자동 선정(또는 지정 링크) → 소개 글 → 임시저장/발행 ──
app.post('/api/run-product', async (req, res) => {
  const visibility = req.body && req.body.visibility === 'private' ? 'private' : 'public';
  const mode = req.body && req.body.mode === 'publish' ? 'publish' : 'draft';
  const url = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
  if (url && !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: '올바른 상품 링크(https://...)를 입력하세요.' });
  }

  const login = await auth.verify();
  if (!login.loggedIn) {
    return res.status(401).json({ error: '네이버 로그인이 필요합니다. 먼저 로그인해주세요.' });
  }

  const meta = store.createDraft({ type: 'product', keyword: '쇼핑커넥트 상품', visibility, mode, sourceUrl: url || undefined });
  pipeline.runProduct(meta.id, visibility, {
    notifyEmail: scheduler.getStatus().settings.notifyEmail,
    mode,
    productUrl: url || undefined, // 지정 링크가 있으면 그 상품으로
  });
  res.json({ draftId: meta.id });
});

// ── 뉴스 링크로 바로 글쓰기: URL의 기사를 참고자료로 글 작성 ──
app.post('/api/run-link', async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  const visibility = req.body && req.body.visibility === 'private' ? 'private' : 'public';
  const mode = req.body && req.body.mode === 'publish' ? 'publish' : 'draft';
  if (!/^https?:\/\/.+/.test(url)) {
    return res.status(400).json({ error: '올바른 뉴스 기사 URL을 입력하세요. (https://... )' });
  }

  const login = await auth.verify();
  if (!login.loggedIn) {
    return res.status(401).json({ error: '네이버 로그인이 필요합니다. 먼저 로그인해주세요.' });
  }

  try {
    // 기사 제목 확인 (본문 수집은 파이프라인에서 다시 수행)
    console.log(`[run-link] 기사 확인: ${url}`);
    const art = await collector.withBrowser((ctx) => collector.extractArticle(ctx, url));
    if (!art.text || art.text.length < 200) {
      return res.status(400).json({ error: '기사 본문을 추출하지 못했습니다. 다른 링크를 시도해보세요.' });
    }
    const title = String(art.title || '').replace(/\s*[-|:·]\s*[^-|:·]*$/, '').trim() || url;

    const search = {
      keyword: '링크 글쓰기',
      sources: [{ kind: 'news', title, url, source: '' }],
      at: new Date().toISOString(),
    };
    const searchId = store.saveSearch(search);
    const topic = {
      title: title.slice(0, 60),
      angle: '이 뉴스를 바탕으로 사실을 확인해 독자에게 유용한 블로그 글로 재구성',
      refs: [0],
      keywords: [],
    };
    const meta = store.createDraft({ keyword: '링크 글쓰기', topic, visibility, mode, sourceUrl: url });
    pipeline.run(meta.id, { ...search, id: searchId }, topic, visibility, {
      notifyEmail: scheduler.getStatus().settings.notifyEmail,
      mode,
    });
    res.json({ draftId: meta.id, title });
  } catch (e) {
    console.error('[run-link] 실패:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 스케줄 주제로 즉시 글감 찾기 ─────────────────────────────
app.post('/api/schedule/topics', async (req, res) => {
  try {
    const { settings } = scheduler.getStatus();
    // 키워드 풀에서 매번 3개를 랜덤으로 골라 글감 다양성 확보
    const pool = [...settings.keywords];
    const keywords = [];
    while (keywords.length < 3 && pool.length) {
      keywords.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    console.log(`[schedule/topics] 주제 키워드로 글감 찾기: ${keywords.join(', ')}`);
    let sources = [];
    for (const kw of keywords) {
      const { news, blogs } = await collector.searchNaver(kw, { recentNews: true });
      sources = sources.concat(news.slice(0, 8), blogs.slice(0, 4));
    }
    const seen = new Set();
    sources = sources.filter((s) => !seen.has(s.url) && seen.add(s.url));
    if (!sources.length) {
      return res.status(500).json({ error: '주제 키워드로 검색 결과를 수집하지 못했습니다.' });
    }
    const list = await topics.suggestTopics(keywords.join(', '), sources, {
      avoidTitles: scheduler.recentTitles(),
    });
    const keyword = keywords.join(', ');
    const searchId = store.saveSearch({ keyword, sources, topics: list, at: new Date().toISOString() });
    res.json({ searchId, keyword, sources, topics: list, visibility: settings.visibility });
  } catch (e) {
    console.error('[schedule/topics] 실패:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 자동 발행 스케줄 설정 ───────────────────────────────────
app.get('/api/schedule', (req, res) => {
  res.json(scheduler.getStatus());
});

app.post('/api/schedule', (req, res) => {
  try {
    res.json(scheduler.updateSettings(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── 임시저장/발행만 재시도 (AI 작성·이미지가 끝난 초안 대상) ──
app.post('/api/drafts/:id/retry-publish', async (req, res) => {
  const id = req.params.id;
  const mode = req.body && req.body.mode === 'publish' ? 'publish' : 'draft';
  const meta = store.getMeta(id);
  const article = store.getArticle(id);
  if (!meta) return res.status(404).json({ error: '초안을 찾을 수 없습니다.' });
  if (!article) return res.status(400).json({ error: '작성된 글이 없어 처음부터 다시 실행해야 합니다.' });
  if (meta.status === 'publishing') return res.status(400).json({ error: '이미 작업이 진행 중입니다.' });

  const login = await auth.verify();
  if (!login.loggedIn) return res.status(401).json({ error: '네이버 로그인이 필요합니다.' });

  const judgments = store.getJudgments(id);
  const notifyEmail = scheduler.getStatus().settings.notifyEmail;
  // 백그라운드 실행 — UI는 드래프트 폴링으로 진행 확인
  pipeline
    .publishAndNotify(id, article, judgments, meta.visibility || 'public', notifyEmail, mode)
    .catch((e) => {
      console.error(`[retry-publish] ${id} 실패:`, e.message);
      store.updateDraft(id, { status: 'error', step: '재시도 실패: ' + e.message, error: e.message });
    });
  res.json({ ok: true, draftId: id });
});

// 실패/중단된 초안을 처음부터 다시 실행 (저장된 글감·참고자료 재사용)
app.post('/api/drafts/:id/retry', async (req, res) => {
  const id = req.params.id;
  const mode = req.body && req.body.mode === 'publish' ? 'publish' : 'draft';
  const meta = store.getMeta(id);
  if (!meta) return res.status(404).json({ error: '초안을 찾을 수 없습니다.' });
  if (meta.status === 'publishing' || meta.status === 'writing' || meta.status === 'collecting') {
    return res.status(400).json({ error: '이미 작업이 진행 중입니다.' });
  }

  const login = await auth.verify();
  if (!login.loggedIn) return res.status(401).json({ error: '네이버 로그인이 필요합니다.' });

  const notifyEmail = scheduler.getStatus().settings.notifyEmail;
  // 재시도 시작 — 중지 플래그/오류 초기화
  store.updateDraft(id, { status: 'collecting', step: '재시도 준비 중', error: null, stopRequested: false, mode });

  if (meta.type === 'product') {
    // 상품 글: 저장된 상품 링크(있으면)로, 없으면 자동 재선정
    pipeline.runProduct(id, meta.visibility || 'public', { notifyEmail, mode, productUrl: meta.sourceUrl || undefined });
    return res.json({ ok: true, draftId: id });
  }

  // 뉴스 글: 저장된 참고자료(refs)로 검색 세션을 재구성해 재실행
  const sources = (meta.refs || []).map((r) => ({ kind: r.kind || 'news', title: r.title, url: r.url, source: r.source || '' }));
  if (!sources.length) return res.status(400).json({ error: '재사용할 참고자료가 없어 글감을 다시 찾아야 합니다.' });
  const search = { keyword: meta.keyword, sources };
  const topic = Object.assign({}, meta.topic, { refs: sources.map((_, i) => i) });
  pipeline.run(id, search, topic, meta.visibility || 'public', { notifyEmail, mode });
  res.json({ ok: true, draftId: id });
});

// ── 초안/이력 조회 ──────────────────────────────────────────
app.get('/api/drafts', (req, res) => {
  res.json(store.listDrafts());
});

// 모든 작업(초안) 삭제 — 로컬 이력만 지움 (네이버 저장 글은 유지)
app.delete('/api/drafts', (req, res) => {
  const n = store.clearDrafts();
  console.log(`[drafts] 작업 이력 ${n}건 삭제`);
  res.json({ ok: true, deleted: n });
});

// 진행 중지 요청 — 파이프라인이 다음 단계 진입 시 중단됨
app.post('/api/drafts/:id/stop', (req, res) => {
  const meta = store.getMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'not found' });
  store.updateDraft(req.params.id, { stopRequested: true });
  console.log(`[drafts] ${req.params.id} 중지 요청됨`);
  res.json({ ok: true });
});

app.get('/api/drafts/:id', (req, res) => {
  const meta = store.getMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'not found' });
  res.json({
    meta,
    article: store.getArticle(req.params.id),
    judgments: store.getJudgments(req.params.id),
  });
});

// 미리보기용 이미지 서빙
app.get('/api/drafts/:id/images/:file', (req, res) => {
  const file = path.basename(req.params.file);
  res.sendFile(path.join(store.imagesDir(req.params.id), 'raw', file), (err) => {
    if (err) res.status(404).end();
  });
});

// ── 숏폼(세로 영상) ─────────────────────────────────────────
// 대본 생성은 시간이 걸리므로 백그라운드로 돌리고 UI는 GET 폴링으로 진행을 본다.
app.post('/api/drafts/:id/shortform', (req, res) => {
  const id = req.params.id;
  const meta = store.getMeta(id);
  if (!meta) return res.status(404).json({ error: '초안을 찾을 수 없습니다.' });
  if (!store.getArticle(id)) return res.status(400).json({ error: '작성된 원고가 없습니다. 글쓰기를 먼저 완료해주세요.' });

  const cur = store.getShortform(id);
  if (cur && cur.status === 'building') return res.status(400).json({ error: '이미 숏폼을 만드는 중입니다.' });

  const opts = {
    sceneCount: req.body && req.body.sceneCount,
    totalSeconds: req.body && req.body.totalSeconds,
    imageMode: req.body && req.body.imageMode,
    style: req.body && req.body.style,
  };
  shortform.generate(id, opts); // 백그라운드
  res.json({ ok: true, draftId: id });
});

app.get('/api/drafts/:id/shortform', (req, res) => {
  const sf = store.getShortform(req.params.id);
  if (!sf) return res.status(404).json({ error: 'not found' });
  res.json(sf);
});

// 편집 내용 저장 (후킹/자막/길이/스타일)
app.put('/api/drafts/:id/shortform', (req, res) => {
  const cur = store.getShortform(req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const body = req.body || {};
  const patch = {};
  if (typeof body.hook === 'string') patch.hook = body.hook.slice(0, 40);
  if (typeof body.hookSub === 'string') patch.hookSub = body.hookSub.slice(0, 60);
  if (typeof body.caption === 'string') patch.caption = body.caption.slice(0, 600);
  if (body.style && typeof body.style === 'object') patch.style = { ...cur.style, ...body.style };
  if (Array.isArray(body.scenes)) {
    // 장면 순서·개수는 서버 것을 신뢰하고, 편집 가능한 필드만 덮어쓴다
    patch.scenes = cur.scenes.map((s, i) => {
      const b = body.scenes[i] || {};
      return {
        ...s,
        text: typeof b.text === 'string' ? b.text.slice(0, 80) : s.text,
        narration: typeof b.narration === 'string' ? b.narration.slice(0, 300) : s.narration,
        seconds: Math.min(8, Math.max(2, Number(b.seconds) || s.seconds)),
      };
    });
  }
  res.json(store.updateShortform(req.params.id, patch));
});

// 장면 1개 배경 이미지 AI 재생성
app.post('/api/drafts/:id/shortform/scenes/:index/image', async (req, res) => {
  const id = req.params.id;
  const idx = Number(req.params.index);
  const sf = store.getShortform(id);
  if (!sf || !sf.scenes || !sf.scenes[idx]) return res.status(404).json({ error: 'not found' });
  try {
    const scene = sf.scenes[idx];
    if (req.body && typeof req.body.imageDesc === 'string' && req.body.imageDesc.trim()) {
      scene.imageDesc = req.body.imageDesc.trim().slice(0, 120);
    }
    const made = await shortform.regenerateSceneImage(id, scene);
    const scenes = sf.scenes.slice();
    scenes[idx] = { ...scene, ...made };
    res.json(store.updateShortform(id, { scenes }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 숏폼 배경 이미지 서빙 — 숏폼 폴더 우선, 없으면 원고 이미지(raw)
app.get('/api/drafts/:id/shortform/media/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const sfPath = path.join(store.shortformDir(req.params.id), file);
  res.sendFile(sfPath, (err) => {
    if (!err) return;
    res.sendFile(path.join(store.imagesDir(req.params.id), 'raw', file), (err2) => {
      if (err2) res.status(404).end();
    });
  });
});

// 서버 재시작 등으로 중단된(비종료 상태) 초안을 오류로 정리
function cleanupOrphanDrafts() {
  const terminal = ['saved', 'published', 'error'];
  let n = 0;
  for (const d of store.listDrafts()) {
    if (!terminal.includes(d.status)) {
      store.updateDraft(d.id, { status: 'error', step: '중단됨 (서버 재시작)', error: '작업이 중단되었습니다. 재시도하세요.' });
      n++;
    }
  }
  if (n) console.log(`[setup] 중단된 초안 ${n}건을 오류로 정리했습니다.`);
}

// ── 시작 ────────────────────────────────────────────────────
(async () => {
  cleanupOrphanDrafts();
  const chrome = await setup.ensureChromium();
  if (!chrome.ok) console.error('[setup]', chrome.error);
  const cli = claude.checkCli();
  console.log(cli.ok ? `[setup] claude CLI 확인: ${cli.version}` : `[setup] claude CLI를 찾지 못했습니다: ${cli.error}`);
  if (cli.ok) {
    claude.checkAuth().then((a) => {
      console.log(a.ok ? '[setup] claude 인증 정상 — AI 사용 가능' : `[setup] claude 인증 문제: ${a.error}`);
    });
  }
  scheduler.start();
  app.listen(PORT, () => {
    console.log(`\n네이버 블로그 자동화 대시보드: http://localhost:${PORT}\n`);
  });
})();
