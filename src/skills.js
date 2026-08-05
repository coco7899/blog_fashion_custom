// 스킬 로더 — skills/<이름>/SKILL.md 의 지침 본문을 읽어 AI 프롬프트에 주입한다.
// 스킬 저장소(blog_fashion-01, blog_shopping-02)를 갱신해 skills/ 에 다시 받으면
// 코드 수정 없이 글쓰기 동작이 바뀐다.
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const cache = new Map();
const SKILL_ALIASES = {
  '01-celebrity-news-blog': '03-health-affiliate-blog',
  '02-naver-shopping-connect-blog': '03-health-affiliate-blog',
};

/**
 * 스킬 지침 본문을 반환한다 (YAML frontmatter 제거).
 * @param {string} name 예: '02-naver-shopping-connect-blog'
 * @returns {string} 지침 마크다운 (없으면 '')
 */
function loadSkill(name) {
  if (cache.has(name)) return cache.get(name);
  try {
    // 기존 두 화면 모드는 유지하되, 실제 글쓰기 지침은 같은 건강 전문 스킬을 사용한다.
    const resolvedName = SKILL_ALIASES[name] || name;
    const file = path.join(SKILLS_DIR, resolvedName, 'SKILL.md');
    let text = fs.readFileSync(file, 'utf8');
    // frontmatter (--- ... ---) 제거
    text = text.replace(/^---[\s\S]*?---\s*/m, '').trim();
    cache.set(name, text);
    return text;
  } catch (e) {
    console.log(`[skills] 스킬 로드 실패 (${name}): ${e.message}`);
    cache.set(name, '');
    return '';
  }
}

module.exports = { loadSkill, SKILLS_DIR };
