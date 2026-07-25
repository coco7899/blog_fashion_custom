// data/ 아래 초안(draft)과 검색 결과를 파일로 관리하는 저장소
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
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
    .map((id) => getMeta(id))
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
};
