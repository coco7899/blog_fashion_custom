// 수동 연속 자동발행 스케줄러.
// 사용자가 대시보드에 "시작"을 입력한 실행 세션에서만 작동하며,
// 글이 발행될 때마다 최소 30분 이상의 불규칙한 간격을 새로 정한다.
const path = require('path');
const store = require('./store');
const collector = require('./collector');
const topics = require('./topics');
const pipeline = require('./pipeline');
const auth = require('./naverAuth');

const FILE = path.join(store.DATA_DIR, 'schedule.json');
const DEFAULT_SETTINGS = {
  mode: 'publish',
  minIntervalMin: 30,
  maxIntervalMin: 75,
  keywords: [
    '혈당 관리 생활습관', '중년 단백질 섭취', '장 건강 식생활', '눈 건강 생활습관',
    '수면 건강 정보', '걷기 운동 건강', '아침 식사 건강', '나트륨 줄이기',
    '제철 식재료 건강', '건강기능식품 선택 기준',
  ],
  visibility: 'public',
};

let active = false;
let running = false;
let lastError = null;
let timer = null;

function cleanSettings(saved = {}) {
  const settings = { ...DEFAULT_SETTINGS };
  settings.mode = saved.mode === 'draft' ? 'draft' : 'publish';
  settings.visibility = saved.visibility === 'private' ? 'private' : 'public';
  settings.minIntervalMin = Math.max(30, Math.min(1440, Number(saved.minIntervalMin) || 30));
  settings.maxIntervalMin = Math.max(
    settings.minIntervalMin,
    Math.min(1440, Number(saved.maxIntervalMin) || 75)
  );
  const keywords = (saved.keywords || DEFAULT_SETTINGS.keywords)
    .map((keyword) => String(keyword).trim())
    .filter((keyword) => keyword && !topics.isSportsTopic({ title: keyword }));
  settings.keywords = keywords.length ? keywords.slice(0, 30) : [...DEFAULT_SETTINGS.keywords];
  return settings;
}

function load() {
  const data = store.readJson(FILE, {});
  const saved = data.state || {};
  return {
    settings: cleanSettings(data.settings),
    state: {
      sessionStartedAt: saved.sessionStartedAt || null,
      sessionPublished: Math.max(0, Number(saved.sessionPublished) || 0),
      lastPublishAt: saved.lastPublishAt || null,
      lastAttemptAt: saved.lastAttemptAt || null,
      nextRunAt: saved.nextRunAt || null,
      pausedNextRunAt: saved.pausedNextRunAt || null,
      lastIntervalMin: Number(saved.lastIntervalMin) || null,
      rotation: Math.max(0, Number(saved.rotation) || 0),
    },
  };
}

function save(data) {
  store.writeJson(FILE, data);
}

function nextInterval(settings, random = Math.random) {
  const min = settings.minIntervalMin;
  const max = settings.maxIntervalMin;
  return min + Math.floor(random() * (max - min + 1));
}

function normalizeCommand(command) {
  const value = String(command || '').replace(/\s+/g, '').toLowerCase();
  if (value === '시작' || value === 'start') return 'start';
  if (value === '중지' || value === '정지' || value === 'stop') return 'stop';
  return null;
}

function getStatus() {
  const data = load();
  return {
    active,
    running,
    settings: data.settings,
    sessionStartedAt: data.state.sessionStartedAt,
    sessionCount: data.state.sessionPublished,
    nextRunAt: active ? data.state.nextRunAt : null,
    lastPublishAt: data.state.lastPublishAt,
    lastIntervalMin: data.state.lastIntervalMin,
    lastError,
  };
}

function startSession(options = {}) {
  if (active) return getStatus();
  const data = load();
  const now = new Date().toISOString();
  const resumeAt = options.resume && data.state.pausedNextRunAt
    ? new Date(data.state.pausedNextRunAt)
    : null;
  const canResume = resumeAt && Number.isFinite(resumeAt.getTime()) && resumeAt > new Date();
  active = true;
  lastError = null;
  data.settings.mode = 'publish';
  data.settings.visibility = 'public';
  if (!canResume) {
    data.state.sessionStartedAt = now;
    data.state.sessionPublished = 0;
    data.state.lastPublishAt = null;
    data.state.lastAttemptAt = null;
    data.state.lastIntervalMin = null;
  }
  data.state.nextRunAt = canResume ? resumeAt.toISOString() : now;
  data.state.pausedNextRunAt = null;
  save(data);
  console.log('[scheduler] 사용자 명령으로 연속 자동발행 시작');
  setTimeout(() => tick().catch((error) => console.error('[scheduler]', error.message)), 0);
  return getStatus();
}

function stopSession() {
  active = false;
  const data = load();
  data.state.nextRunAt = null;
  save(data);
  console.log('[scheduler] 사용자 명령으로 연속 자동발행 중지');
  return getStatus();
}

function control(command, options = {}) {
  const normalized = normalizeCommand(command);
  if (normalized === 'start') return startSession(options);
  if (normalized === 'stop') return stopSession();
  throw new Error('명령 입력란에 “시작” 또는 “중지”를 입력하세요.');
}

function updateSettings(patch) {
  const data = load();
  const settings = { ...data.settings };
  if (patch.minIntervalMin !== undefined) {
    settings.minIntervalMin = Math.max(30, Math.min(1440, parseInt(patch.minIntervalMin, 10) || 30));
  }
  if (patch.maxIntervalMin !== undefined) {
    settings.maxIntervalMin = Math.max(30, Math.min(1440, parseInt(patch.maxIntervalMin, 10) || 75));
  }
  if (settings.maxIntervalMin < settings.minIntervalMin) settings.maxIntervalMin = settings.minIntervalMin;
  if (patch.keywords !== undefined) {
    const values = (Array.isArray(patch.keywords) ? patch.keywords : String(patch.keywords).split(','))
      .map((keyword) => String(keyword).trim())
      .filter((keyword) => keyword && !topics.isSportsTopic({ title: keyword }));
    if (values.length) settings.keywords = values.slice(0, 30);
  }
  data.settings = cleanSettings(settings);
  save(data);
  if (patch.enabled === true) return startSession();
  if (patch.enabled === false) return stopSession();
  return getStatus();
}

function recentTitles(limit = 20) {
  return store
    .listDrafts()
    .map((draft) => draft.title || (draft.topic && draft.topic.title))
    .filter(Boolean)
    .slice(0, limit);
}

async function autoPublishOnce() {
  const data = load();
  const { settings } = data;
  const keyword = settings.keywords[data.state.rotation % settings.keywords.length];
  data.state.rotation += 1;
  data.state.lastAttemptAt = new Date().toISOString();
  save(data);

  const login = await auth.verify();
  if (!login.loggedIn) {
    throw new Error('네이버 로그인 세션이 만료되었습니다. 대시보드에서 다시 로그인하세요.');
  }

  console.log(`[scheduler] 연속 자동발행 작업 시작 — 키워드: "${keyword}"`);
  const { news, blogs } = await collector.searchNaver(keyword, { recentNews: true });
  const sources = [...news, ...blogs];
  if (!sources.length) throw new Error(`"${keyword}" 검색 결과가 없습니다.`);

  const list = await topics.suggestTopics(keyword, sources, { avoidTitles: recentTitles() });
  const topic = list[0];
  if (!topic) throw new Error(`"${keyword}"에서 새 글감을 선정하지 못했습니다.`);
  console.log(`[scheduler] 선정된 글감: ${topic.title}`);

  const meta = store.createDraft({ keyword, topic, visibility: 'public', mode: 'publish', auto: true });
  const result = await pipeline.run(meta.id, { sources }, topic, 'public', { mode: 'publish' });
  if (!result.ok) throw new Error(result.error);

  const after = load();
  const publishedAt = new Date();
  const gap = nextInterval(after.settings);
  after.state.sessionPublished += 1;
  after.state.lastPublishAt = publishedAt.toISOString();
  after.state.lastIntervalMin = gap;
  after.state.nextRunAt = active
    ? new Date(publishedAt.getTime() + gap * 60 * 1000).toISOString()
    : null;
  save(after);
  console.log(`[scheduler] 이번 실행 ${after.state.sessionPublished}건 발행 완료 · 다음 간격 ${gap}분`);
}

async function tick() {
  if (!active || running) return;
  const data = load();
  const next = data.state.nextRunAt ? new Date(data.state.nextRunAt) : new Date();
  if (new Date() < next) return;

  running = true;
  try {
    await autoPublishOnce();
    lastError = null;
  } catch (error) {
    lastError = error.message;
    const failed = load();
    failed.state.nextRunAt = active
      ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
      : null;
    save(failed);
    console.error('[scheduler] 연속 자동발행 실패:', error.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  // 서버가 다시 켜졌을 때는 사용자의 새 "시작" 명령 전까지 반드시 멈춰 둔다.
  active = false;
  const data = load();
  if (data.state.nextRunAt) data.state.pausedNextRunAt = data.state.nextRunAt;
  data.state.nextRunAt = null;
  save(data);
  timer = setInterval(() => tick().catch((error) => console.error('[scheduler]', error.message)), 60 * 1000);
  console.log('[scheduler] 수동 연속발행 대기 중 (대시보드에서 “시작” 입력)');
}

module.exports = {
  start,
  getStatus,
  updateSettings,
  control,
  tick,
  recentTitles,
  _internals: { cleanSettings, nextInterval, normalizeCommand },
};
