// Move the existing controls, preserving their IDs, values and event handlers.
(() => {
  const column = document.querySelector('.sf-edit-col');
  const [hook, style, scenes, prompts, caption] = [...column.children];
  const audio = document.querySelector('.sf-audio');
  const nav = document.createElement('nav');
  nav.className = 'studio-tabs'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '편집 작업');
  const sections = [
    ['script', '대본', '이야기를 다듬어요', '후킹과 장면별 대본을 편집하세요. 변경 사항은 자동 저장됩니다.'],
    ['images', '이미지 프롬프트', '장면에 맞는 화면을 준비해요', '참조이미지를 분석해 이미지·영상 생성용 프롬프트를 만듭니다.'],
    ['design', '디자인', '화면의 분위기를 맞춰요', '왼쪽 미리보기를 보며 글자, 색상과 위치를 조절하세요.'],
    ['audio', '오디오', '목소리와 음악을 더해요', '내레이션과 배경음악을 만들고 볼륨을 조절하세요.'],
    ['export', '내보내기', '완성한 작업을 저장해요', '영상은 미리보기 아래에서, 이미지와 대본은 여기에서 다운로드하세요.'],
  ];
  const panels = {};
  const buttons = [];
  function select(index, focus = false) {
    sections.forEach(([key], i) => {
      panels[key].hidden = i !== index;
      buttons[i].setAttribute('aria-selected', String(i === index));
      buttons[i].tabIndex = i === index ? 0 : -1;
    });
    if (focus) buttons[index].focus();
  }
  for (const [index, [key, name, heading, description]] of sections.entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
    button.id = `studio-tab-${key}`; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `studio-panel-${key}`);
    button.onclick = () => select(index);
    button.onkeydown = event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
      if (event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = sections.length - 1;
      if (next !== undefined) { event.preventDefault(); select(next, true); }
    };
    nav.append(button); buttons.push(button);
    const panel = document.createElement('div'); panel.className = 'studio-panel'; panel.id = `studio-panel-${key}`;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    const intro = document.createElement('div'); intro.className = 'studio-intro';
    const h = document.createElement('h2'); h.textContent = heading;
    const p = document.createElement('p'); p.textContent = description; intro.append(h, p); panel.append(intro);
    panels[key] = panel;
  }
  const hookDesign = document.createElement('div'); hookDesign.className = 'card';
  hookDesign.append(hook.querySelector('h3'), hook.querySelector('.sf-style-grid'));
  panels.script.append(hook, scenes);
  panels.images.append(prompts);
  panels.design.append(hookDesign, style);
  audio.classList.add('card'); panels.audio.append(audio);
  const downloads = document.createElement('div'); downloads.className = 'card studio-downloads';
  const heading = document.createElement('h2'); heading.textContent = '이미지와 대본'; downloads.append(heading);
  const row = document.createElement('div'); row.className = 'row';
  for (const id of ['zipBtn', 'pngBtn', 'txtBtn', 'narrTxtBtn']) row.append(document.getElementById(id));
  downloads.append(row); panels.export.append(downloads, caption);
  column.replaceChildren(nav, ...Object.values(panels));
  document.getElementById('exportBtn').textContent = '영상 다운로드';
  select(0);
})();
