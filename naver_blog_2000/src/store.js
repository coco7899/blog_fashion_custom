// data/ 아래 초안(draft)과 검색 결과를 파일로 관리하는 저장소
const fs = require('fs');
const path = require('path');

// 커스텀 실행 파일에서는 코드 폴더 밖의 영구 저장 위치를 지정한다.
// 저장소를 다시 Pull하거나 교체해도 작업 이력이 사라지지 않도록 하기 위함이다.
const DATA_DIR = process.env.BLOG_FASHION_DATA_DIR
  ? path.resolve(process.env.BLOG_FASHION_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const SESSION_DIR = path.join(DATA_DIR, 'session');
const DRAFTS_DIR = path.join(DATA_DIR, 'drafts');
const SEARCHES_DIR = path.join(DATA_DIR, 'searches');

for (const dir of [DATA_DIR, SESSION_DIR, DRAFTS_DIR, SEARCHES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function draftDir(id) {
  return path.join(DRAFTS_DIR, id);
}

function imagesDir(id) {
  return path.join(draftDir(id), 'images');
}

// 숏폼(세로 영상) 대본·장면 이미지 보관 폴더
function shortformDir(id) {
  return path.join(draftDir(id), 'shortform');
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function createDraft(init = {}) {
  const id = newId();
  const meta = {
    id,
    createdAt: new Date().toISOString(),
    status: 'pending', // pending → collecting → writing → images → publishing → published | error
    step: '대기 중',
    ...init,
  };
  writeJson(path.join(draftDir(id), 'meta.json'), meta);
  return meta;
}

function getMeta(id) {
  return readJson(path.join(draftDir(id), 'meta.json'));
}

function updateDraft(id, patch) {
  const meta = getMeta(id);
  if (!meta) return null;
  const next = { ...meta, ...patch, updatedAt: new Date().toISOString() };
  writeJson(path.join(draftDir(id), 'meta.json'), next);
  return next;
}

function saveArticle(id, article) {
  writeJson(path.join(draftDir(id), 'article.json'), article);
}

function getArticle(id) {
  return readJson(path.join(draftDir(id), 'article.json'));
}

function saveJudgments(id, judgments) {
  writeJson(path.join(imagesDir(id), 'judgments.json'), judgments);
}

function getJudgments(id) {
  return readJson(path.join(imagesDir(id), 'judgments.json'), []);
}

function saveShortform(id, data) {
  writeJson(path.join(shortformDir(id), 'shortform.json'), data);
  return data;
}

function getShortform(id) {
  return readJson(path.join(shortformDir(id), 'shortform.json'));
}

// 숏폼 문서를 부분 갱신 (진행 상태/장면 이미지 등)
function updateShortform(id, patch) {
  const cur = getShortform(id);
  if (!cur) return null;
  return saveShortform(id, { ...cur, ...patch, updatedAt: new Date().toISOString() });
}

function listDrafts() {
  if (!fs.existsSync(DRAFTS_DIR)) return [];
  return fs
    .readdirSync(DRAFTS_DIR)
    .map((id) => {
      const meta = getMeta(id);
      if (!meta) return null;
      return {
        ...meta,
        articleAvailable: fs.existsSync(path.join(draftDir(id), 'article.json')),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// 모든 초안(작업 이력) 삭제 — data/drafts 하위 폴더 전체 제거
function clearDrafts() {
  if (!fs.existsSync(DRAFTS_DIR)) return 0;
  const ids = fs.readdirSync(DRAFTS_DIR);
  let n = 0;
  for (const id of ids) {
    try {
      fs.rmSync(path.join(DRAFTS_DIR, id), { recursive: true, force: true });
      n++;
    } catch {}
  }
  return n;
}

function saveSearch(data) {
  const id = newId();
  writeJson(path.join(SEARCHES_DIR, id + '.json'), { id, ...data });
  return id;
}

function getSearch(id) {
  return readJson(path.join(SEARCHES_DIR, String(id) + '.json'));
}

// 가장 최근에 찾은 글감 목록을 대시보드 재진입 시 복원한다.
function getLatestSearch() {
  if (!fs.existsSync(SEARCHES_DIR)) return null;
  return fs
    .readdirSync(SEARCHES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const fullPath = path.join(SEARCHES_DIR, file);
      const search = readJson(fullPath);
      if (!search) return null;
      const stat = fs.statSync(fullPath);
      return { search, savedAt: Date.parse(search.at || '') || stat.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.savedAt - a.savedAt)[0]?.search || null;
}

// 사용자가 '모든 글감 삭제'를 눌렀을 때 저장된 검색 목록도 함께 지운다.
function clearSearches() {
  if (!fs.existsSync(SEARCHES_DIR)) return 0;
  let count = 0;
  for (const file of fs.readdirSync(SEARCHES_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      fs.rmSync(path.join(SEARCHES_DIR, file), { force: true });
      count++;
    } catch {}
  }
  return count;
}

// 정책에서 제외된 글감을 기존 저장 목록에서도 제거한다.
function filterSearchTopics(keepTopic) {
  if (!fs.existsSync(SEARCHES_DIR)) return 0;
  let removed = 0;
  for (const file of fs.readdirSync(SEARCHES_DIR)) {
    if (!file.endsWith('.json')) continue;
    const fullPath = path.join(SEARCHES_DIR, file);
    const search = readJson(fullPath);
    if (!search || !Array.isArray(search.topics)) continue;
    const filtered = search.topics.filter(keepTopic);
    if (filtered.length === search.topics.length) continue;
    removed += search.topics.length - filtered.length;
    writeJson(fullPath, { ...search, topics: filtered });
  }
  return removed;
}

module.exports = {
  DATA_DIR,
  SESSION_DIR,
  draftDir,
  imagesDir,
  shortformDir,
  readJson,
  writeJson,
  createDraft,
  getMeta,
  updateDraft,
  saveArticle,
  getArticle,
  saveJudgments,
  getJudgments,
  saveShortform,
  getShortform,
  updateShortform,
  listDrafts,
  clearDrafts,
  saveSearch,
  getSearch,
  getLatestSearch,
  clearSearches,
  filterSearchTopics,
};
