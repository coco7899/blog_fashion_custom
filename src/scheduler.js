// 자동 발행 스케줄러: 하루 발행 개수 + 첫 발행 시각 + 발행 간격(텀)에 따라
// 주제 키워드에서 최신 뉴스를 수집하고 AI가 글감을 골라 무개입 발행한다.
const path = require('path');
const store = require('./store');
const collector = require('./collector');
const topics = require('./topics');
const pipeline = require('./pipeline');
const auth = require('./naverAuth');

const FILE = path.join(store.DATA_DIR, 'schedule.json');

const DEFAULT_SETTINGS = {
  enabled: false,
  mode: 'draft',              // 'draft'(임시저장) | 'publish'(자동발행)
  postsPerDay: 2,             // 하루 처리 개수
  startTime: '09:00',         // 첫 실행 시각
  intervalMin: 180,           // 실행 간격(분)
  // 글감 주제 (돌아가며 사용) — 패션·뷰티·생활용품·건강·방송/SNS 화제·셀럽 제품
  keywords: ['연예인 패션', '연예인 뷰티', '연예인 생활용품', '연예인 건강식품', '연예인 SNS 화제', '연예인 애용템'],
  visibility: 'public',
};

let running = false;
let lastError = null;
let timer = null;

function load() {
  const data = store.readJson(FILE, {});
  return {
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    state: {
      date: '',
      publishedToday: 0,
      lastPublishAt: null,
      lastAttemptAt: null,
      rotation: 0,
      ...(data.state || {}),
    },
  };
}

function save(data) {
  store.writeJson(FILE, data);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '09:00'));
  return m ? { h: +m[1], min: +m[2] } : { h: 9, min: 0 };
}

// 다음 발행 예정 시각 계산 (없으면 null)
function computeNextRun(settings, state) {
  if (!settings.enabled) return null;
  const now = new Date();
  const { h, min } = parseTime(settings.startTime);
  const published = state.date === todayStr() ? state.publishedToday : 0;

  if (published >= settings.postsPerDay) {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(h, min, 0, 0);
    return next;
  }
  if (published === 0 || !state.lastPublishAt) {
    const start = new Date(now);
    start.setHours(h, min, 0, 0);
    return start; // 이미 지났으면 즉시 발행 대상
  }
  return new Date(new Date(state.lastPublishAt).getTime() + settings.intervalMin * 60 * 1000);
}

function getStatus() {
  const data = load();
  const published = data.state.date === todayStr() ? data.state.publishedToday : 0;
  const next = computeNextRun(data.settings, data.state);
  return {
    settings: data.settings,
    todayCount: published,
    nextRunAt: next ? next.toISOString() : null,
    running,
    lastError,
  };
}

function updateSettings(patch) {
  const data = load();
  const s = { ...data.settings };
  if (patch.enabled !== undefined) s.enabled = !!patch.enabled;
  if (patch.postsPerDay !== undefined) s.postsPerDay = Math.max(1, Math.min(10, parseInt(patch.postsPerDay, 10) || 1));
  if (patch.startTime !== undefined && /^\d{1,2}:\d{2}$/.test(patch.startTime)) s.startTime = patch.startTime;
  if (patch.intervalMin !== undefined) s.intervalMin = Math.max(10, Math.min(1440, parseInt(patch.intervalMin, 10) || 60));
  if (patch.keywords !== undefined) {
    const arr = (Array.isArray(patch.keywords) ? patch.keywords : String(patch.keywords).split(','))
      .map((k) => String(k).trim())
      .filter(Boolean);
    if (arr.length) s.keywords = arr.slice(0, 10);
  }
  if (patch.visibility !== undefined) s.visibility = patch.visibility === 'private' ? 'private' : 'public';
  if (patch.mode !== undefined) s.mode = patch.mode === 'publish' ? 'publish' : 'draft';
  data.settings = s;
  save(data);
  return getStatus();
}

// 최근 발행/작성 제목 (글감 중복 회피용)
function recentTitles(limit = 20) {
  return store
    .listDrafts()
    .map((d) => d.title || (d.topic && d.topic.title))
    .filter(Boolean)
    .slice(0, limit);
}

// 1회 자동 발행 실행
async function autoPublishOnce() {
  const data = load();
  const { settings } = data;
  const keyword = settings.keywords[data.state.rotation % settings.keywords.length];
  data.state.rotation += 1;
  data.state.lastAttemptAt = new Date().toISOString();
  save(data);

  // AI 작업 전에 네이버 로그인부터 확인 (만료 시 헛수고 방지)
  const login = await auth.verify();
  if (!login.loggedIn) {
    throw new Error('네이버 로그인 세션이 만료되었습니다. 대시보드에서 다시 로그인하세요.');
  }

  console.log(`[scheduler] 자동 임시저장 시작 — 키워드: "${keyword}"`);
  const { news, blogs } = await collector.searchNaver(keyword, { recentNews: true });
  const sources = [...news, ...blogs];
  if (!sources.length) throw new Error(`"${keyword}" 검색 결과가 없습니다.`);

  const list = await topics.suggestTopics(keyword, sources, { avoidTitles: recentTitles() });
  const topic = list[0]; // AI가 1순위로 추천한 글감
  console.log(`[scheduler] 선정된 글감: ${topic.title}`);

  const meta = store.createDraft({ keyword, topic, visibility: settings.visibility, mode: settings.mode, auto: true });
  const result = await pipeline.run(meta.id, { sources }, topic, settings.visibility, {
    mode: settings.mode,
  });
  if (!result.ok) throw new Error(result.error);

  // 성공 기록
  const after = load();
  const today = todayStr();
  if (after.state.date !== today) {
    after.state.date = today;
    after.state.publishedToday = 0;
  }
  after.state.publishedToday += 1;
  after.state.lastPublishAt = new Date().toISOString();
  save(after);
  console.log(`[scheduler] 오늘 ${after.state.publishedToday}/${after.settings.postsPerDay}건 임시저장 완료`);
}

async function tick() {
  if (running) return;
  const data = load();
  if (!data.settings.enabled) return;

  // 날짜 바뀌면 카운터 리셋
  if (data.state.date !== todayStr()) {
    data.state.date = todayStr();
    data.state.publishedToday = 0;
    save(data);
  }

  const next = computeNextRun(data.settings, data.state);
  if (!next || new Date() < next) return;
  if (data.state.publishedToday >= data.settings.postsPerDay) return;

  // 실패 후 재시도는 15분 간격
  if (data.state.lastAttemptAt && lastError) {
    const since = Date.now() - new Date(data.state.lastAttemptAt).getTime();
    if (since < 15 * 60 * 1000) return;
  }

  running = true;
  try {
    await autoPublishOnce();
    lastError = null;
  } catch (e) {
    lastError = e.message;
    console.error('[scheduler] 자동 발행 실패:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => tick().catch((e) => console.error('[scheduler]', e.message)), 60 * 1000);
  console.log('[scheduler] 스케줄러 시작 (1분 주기 점검)');
}

module.exports = { start, getStatus, updateSettings, tick, recentTitles };
