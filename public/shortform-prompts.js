window.ScenePrompts = (() => {
  let id, getSF, state = { references: [] }, busy = false, timer, initialized = false;
  const el = name => document.getElementById(name);
  const endpoint = () => `/api/drafts/${encodeURIComponent(id)}/shortform/prompts`;
  const scenes = () => (getSF()?.scenes || []).map(s => ({ text: String(s.text || '').trim().slice(0,200), narration: String(s.narration || '').trim().slice(0,1000), imageDesc: String(s.imageDesc || '').trim().slice(0,500) }));
  const stale = () => state.sourceScenes && JSON.stringify(state.sourceScenes) !== JSON.stringify(scenes());
  const message = (text, error = false) => { el('promptStatus').textContent = text; el('promptStatus').className = 'status' + (error ? ' err' : ''); };
  async function request(suffix = '', method = 'GET', body) {
    const response = await fetch(endpoint() + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '요청 실패');
    return data;
  }
  function button(text, handler) { const b = document.createElement('button'); b.className = 'btn btn-ghost btn-sm'; b.textContent = text; b.onclick = handler; return b; }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); message('복사했습니다. 참조이미지와 함께 채팅창에 붙여넣으세요.'); }
    catch { const area = document.createElement('textarea'); area.value = text; area.rows = 12; area.style.width = '100%'; area.setAttribute('aria-label', '복사할 프롬프트'); el('promptResults').prepend(area); area.focus(); area.select(); message('브라우저가 자동 복사를 허용하지 않았습니다. 선택된 내용을 Ctrl+C로 복사하세요.'); }
  }
  function refresh() {
    if (!initialized) return;
    const building = busy || state.status === 'building';
    el('promptGenerate').disabled = building;
    const ready = state.status === 'ready' && state.result && !stale() && !building;
    el('promptCopyAll').disabled = !ready; el('promptDownload').disabled = !ready;
    el('promptResults').querySelectorAll('button').forEach(b => { b.disabled = !ready; });
    el('promptReferences').querySelectorAll('input,button').forEach(b => { b.disabled = building; });
    if (stale() && !building) message('대본이 변경되었습니다. 현재 대본으로 프롬프트를 다시 만들어 주세요.', true);
  }
  function render() {
    const refs = el('promptReferences'); refs.replaceChildren();
    for (let slot = 1; slot <= 5; slot++) {
      const ref = state.references.find(r => r.slot === slot);
      const box = document.createElement('div'); box.className = 'prompt-reference';
      const label = document.createElement('strong'); label.textContent = `참조 ${slot}`; box.append(label);
      if (ref) {
        const img = document.createElement('img'); img.src = endpoint() + `/references/${slot}?v=${encodeURIComponent(ref.file)}`; img.alt = `참조 ${slot}: ${ref.name}`; box.append(img);
        const name = document.createElement('small'); name.textContent = ref.name; box.append(name);
      }
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.hidden = true; input.setAttribute('aria-label', `참조 ${slot} 이미지 업로드`);
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        if (file.size > 8 * 1024 * 1024) { message('참조이미지는 한 장당 8MB 이하로 올려 주세요.', true); input.value = ''; return; }
        busy = true; refresh(); message(`참조 ${slot} 업로드 중…`);
        try {
          const dataUrl = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.')); reader.readAsDataURL(file); });
          state = await request(`/references/${slot}`, 'PUT', { dataUrl, name: file.name });
          message('참조이미지를 등록했습니다. 프롬프트 만들기를 눌러 주세요.');
        } catch (e) { message(e.message, true); }
        finally { busy = false; render(); }
      };
      box.append(input, button(ref ? '이미지 교체' : '+ 이미지 추가', () => input.click()));
      if (ref) box.append(button('삭제', async () => {
        busy = true; refresh();
        try { state = await request(`/references/${slot}`, 'DELETE'); message('참조이미지를 삭제했습니다.'); }
        catch (e) { message(e.message, true); }
        finally { busy = false; render(); }
      }));
      refs.append(box);
    }
    const analysis = el('promptAnalysis'); analysis.replaceChildren();
    for (const ref of state.result?.analyses || []) {
      const p = document.createElement('p'); p.className = 'hint'; p.textContent = `참조 ${ref.slot} 분석: ${ref.description}`; analysis.append(p);
    }
    const results = el('promptResults'); results.replaceChildren();
    for (const p of state.result?.prompts || []) {
      const section = document.createElement('details'); section.className = 'prompt-scene'; section.open = p.number === 1;
      const summary = document.createElement('summary'); summary.textContent = `장면 ${p.number} · ${p.filename} · ${p.referenceSlots.length ? '참조 ' + p.referenceSlots.join(', ') : '참조 없음'}`;
      const text = document.createElement('textarea'); text.readOnly = true; text.rows = 9; text.value = p.prompt; text.setAttribute('aria-label', `장면 ${p.number} 이미지 프롬프트`);
      section.append(summary, text, button('이 장면 이미지 프롬프트 복사', () => copy(p.prompt)));
      if (p.videoPrompt) {
        const video = document.createElement('p'); video.className = 'hint'; video.textContent = `영상 움직임: ${p.videoPrompt}`;
        section.append(video, button('영상용 프롬프트 복사', () => copy(`${p.prompt}\n\n영상으로 만들 때: ${p.videoPrompt}`)));
      }
      results.append(section);
    }
    refresh();
  }
  async function poll() {
    clearTimeout(timer);
    try {
      state = await request(); render();
      if (state.status === 'building') { message('참조이미지를 분석하고 장면별 프롬프트를 쓰고 있습니다…'); timer = setTimeout(poll, 2000); }
      else if (state.status === 'error') message(state.error || '생성에 실패했습니다. 다시 시도해 주세요.', true);
      else if (!stale()) message(state.result ? '프롬프트가 준비되었습니다. 개별 또는 전체 복사를 선택하세요.' : '참조이미지를 올리거나 바로 프롬프트를 만들어 주세요.');
    } catch (e) { message(e.message + ' 새로고침 후 다시 확인해 주세요.', true); }
  }
  function open(draftId, getter) {
    id = draftId; getSF = getter; initialized = true;
    el('promptGenerate').onclick = async () => {
      busy = true; refresh(); message('프롬프트 생성 요청 중…');
      try { await request('', 'POST', { scenes: scenes() }); state.status = 'building'; }
      catch (e) { message(e.message, true); busy = false; refresh(); return; }
      busy = false; poll();
    };
    el('promptCopyAll').onclick = () => copy(state.result.allText);
    el('promptDownload').onclick = () => SF.download(new Blob([state.result.allText], { type: 'text/plain;charset=utf-8' }), `scene-prompts-${id}.txt`);
    poll();
  }
  return { open, refresh };
})();
