// 숏폼 공용 렌더러 — 대시보드 인라인 미리보기와 편집기가 '똑같은 화면'을 그리도록
// 시각 로직(캔버스 드로잉)·영상 내보내기·이미지 ZIP을 한곳에 모았다. window.SF 로 노출.
(function () {
  const W = 1080;
  const H = 1920;
  const FONT = "'Pretendard Variable', 'Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
  // 장면별 켄번즈 초점(구도상 중요 지점) — coco 방식
  const FOCI = [[0.5, 0.42], [0.36, 0.36], [0.64, 0.4], [0.5, 0.62], [0.32, 0.55], [0.68, 0.58], [0.5, 0.35]];
  const THEMES = {
    dark:  { text: '#ffffff', sub: '#e8eef3', accent: '#03c75a', chipText: '#ffffff', box: 'rgba(0,0,0,.52)', dim: .38 },
    light: { text: '#14181c', sub: '#3b444c', accent: '#2563eb', chipText: '#ffffff', box: 'rgba(255,255,255,.80)', dim: -.30 },
    vivid: { text: '#ffffff', sub: '#fff4c2', accent: '#ff2d55', chipText: '#ffffff', box: 'rgba(10,10,14,.62)', dim: .42 },
  };
  const HL_RED = /[0-9０-９%]|만원|천원|억원|원$/;
  const HL_YEL = /(무료|최대|최고|주의|손해|금지|필수|꿀팁|강추|비추|단점|장점|후회|대박|핵심|진짜|중요|공짜|할인|반값|이득|주목|경고|절대|추천|솔직|처음|드디어|충격|의외)/;

  const totalSec = (sf) => (sf && sf.scenes ? sf.scenes.reduce((a, s) => a + (Number(s.seconds) || 4), 0) : 0);

  function sceneAt(sf, t) {
    let acc = 0;
    for (let i = 0; i < sf.scenes.length; i++) {
      const d = Number(sf.scenes[i].seconds) || 4;
      if (t < acc + d || i === sf.scenes.length - 1) {
        return { index: i, scene: sf.scenes[i], local: Math.min(d, Math.max(0, t - acc)), dur: d, start: acc };
      }
      acc += d;
    }
    return { index: 0, scene: sf.scenes[0], local: 0, dur: 4, start: 0 };
  }

  function mediaUrl(draftId, file) {
    return `/api/drafts/${draftId}/shortform/media/${encodeURIComponent(file)}`;
  }

  function loadImage(imgCache, draftId, file) {
    if (!file) return Promise.resolve(null);
    if (imgCache.has(file)) return Promise.resolve(imgCache.get(file));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { imgCache.set(file, img); resolve(img); };
      img.onerror = () => { imgCache.set(file, null); resolve(null); };
      img.src = mediaUrl(draftId, file);
    });
  }

  const preloadAll = (imgCache, draftId, sf) =>
    Promise.all((sf.scenes || []).map((s) => loadImage(imgCache, draftId, s.file)));

  // 캔버스에 그리기 전에 프리텐다드 각 굵기를 미리 로드 (안 하면 첫 프레임이 폴백 폰트로 그려짐)
  let fontReady = null;
  function ensureFont() {
    if (fontReady) return fontReady;
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    fontReady = Promise.all([
      document.fonts.load("500 60px 'Pretendard Variable'"),
      document.fonts.load("600 40px 'Pretendard Variable'"),
      document.fonts.load("700 60px 'Pretendard Variable'"),
      document.fonts.load("800 76px 'Pretendard Variable'"),
    ]).then(() => document.fonts.ready).catch(() => {});
    return fontReady;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function wrapWords(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const out = [];
    let line = '';
    for (const wd of words) {
      const test = line ? line + ' ' + wd : wd;
      if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
      if (line) { out.push(line); line = ''; }
      if (ctx.measureText(wd).width <= maxWidth) { line = wd; continue; }
      let cur = '';
      for (const ch of wd) {
        if (ctx.measureText(cur + ch).width > maxWidth && cur) { out.push(cur); cur = ch; }
        else cur += ch;
      }
      line = cur;
    }
    if (line) out.push(line);
    return out;
  }

  function wrapLines(ctx, text, maxWidth) {
    const out = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) { out.push(''); continue; }
      if (ctx.measureText(line).width <= maxWidth) { out.push(line); continue; }
      wrapWords(ctx, line, maxWidth).forEach((l) => out.push(l));
    }
    return out.slice(0, 4);
  }

  function capHighlights(words, baseColor) {
    const colors = words.map((w) => (HL_RED.test(w) ? '#FF4D4D' : HL_YEL.test(w) ? '#FDFF54' : baseColor));
    if (!colors.some((c) => c !== baseColor) && words.length) {
      let li = 0;
      words.forEach((w, i) => { if (w.length > words[li].length) li = i; });
      colors[li] = '#FDFF54';
    }
    return colors;
  }

  function narrationUnit(ctx, narration, progress, maxWidth) {
    const sents = (String(narration || '').match(/[^.!?…]+[.!?…]*/g) || []).map((s) => s.trim()).filter(Boolean);
    const units = [];
    sents.forEach((s) => wrapWords(ctx, s, maxWidth).forEach((u) => units.push(u)));
    if (!units.length) return '';
    return units[Math.min(Math.floor(progress * units.length), units.length - 1)];
  }

  const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  // ── 한 프레임 그리기 (1080×1920 기준) ─────────────────────────
  function drawFrame(ctx, sf, t, imgCache) {
    const st = sf.style || {};
    const th = THEMES[st.theme] || THEMES.dark;
    const { scene, local, dur, index } = sceneAt(sf, t);
    const img = imgCache.get(scene.file) || null;
    const p = dur ? local / dur : 0;

    // 배경 — 장면별 초점을 향해 확대. 훅·1번 장면은 더 깊은 줌+팬(시네마틱).
    ctx.save();
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, W, H);
    if (img && img.width) {
      const f = FOCI[index % FOCI.length];
      const motion = st.kenBurns && index <= 1;
      const e = 1 - Math.pow(1 - p, 2);
      const z = st.kenBurns ? (motion ? 1.06 : 1.03) + (motion ? 0.40 : 0.22) * e : 1.03;
      let fx = f[0];
      const fy = f[1];
      if (motion) fx += 0.05 * Math.sin(p * Math.PI);
      const scale = Math.max(W / img.width, H / img.height) * z;
      const iw = img.width * scale;
      const ih = img.height * scale;
      let dx = W / 2 - fx * iw;
      let dy = H / 2 - fy * ih;
      dx = Math.max(W - iw, Math.min(0, dx));
      dy = Math.max(H - ih, Math.min(0, dy));
      ctx.drawImage(img, dx, dy, iw, ih);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1f2937');
      g.addColorStop(1, '#0b0d10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    // 가독성 오버레이 — dim이 음수면 흰색으로 덮는다(라이트 테마)
    const og = ctx.createLinearGradient(0, 0, 0, H);
    if (th.dim >= 0) {
      og.addColorStop(0, `rgba(0,0,0,${(th.dim + 0.24).toFixed(3)})`);
      og.addColorStop(0.42, `rgba(0,0,0,${(th.dim * 0.55).toFixed(3)})`);
      og.addColorStop(1, `rgba(0,0,0,${(th.dim + 0.20).toFixed(3)})`);
    } else {
      const a = -th.dim;
      og.addColorStop(0, `rgba(255,255,255,${(a + 0.30).toFixed(3)})`);
      og.addColorStop(0.42, `rgba(255,255,255,${a.toFixed(3)})`);
      og.addColorStop(1, `rgba(255,255,255,${(a + 0.25).toFixed(3)})`);
    }
    ctx.fillStyle = og;
    ctx.fillRect(0, 0, W, H);

    // ── 상단 후킹 (영상 내내 고정) — 위치·색상·박스 편집 가능 ──
    const hookSize = Number(st.hookSize) || 76;
    const hookY = Number.isFinite(Number(st.hookY)) ? Number(st.hookY) : 172;
    const hookColor = st.hookColor || th.accent;         // 배경(박스) 색
    const hookTextColor = st.hookTextColor || th.chipText; // 글자 색
    const hookBoxed = st.hookBoxed !== false;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${hookSize}px ${FONT}`;
    const hookLines = wrapLines(ctx, sf.hook || '', W - 180).slice(0, 2);
    const hookLH = hookSize * 1.22;
    const hookH = hookLines.length * hookLH;
    const hookW = Math.min(W - 100, Math.max(...hookLines.map((l) => ctx.measureText(l).width), 0) + 84);
    const hookTop = hookY - hookH / 2 + hookLH / 2;

    if (hookBoxed) {
      ctx.save();
      ctx.fillStyle = hookColor;
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 8;
      roundRect(ctx, (W - hookW) / 2, hookY - hookH / 2 - 26, hookW, hookH + 52, 26);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = hookTextColor;
      hookLines.forEach((l, i) => ctx.fillText(l, W / 2, hookTop + i * hookLH));
    } else {
      // 박스 없이 글자만 — 어두운 외곽선으로 가독성 확보
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = Math.round(hookSize * 0.15);
      ctx.fillStyle = hookTextColor;
      hookLines.forEach((l, i) => {
        const yy = hookTop + i * hookLH;
        ctx.strokeText(l, W / 2, yy);
        ctx.fillText(l, W / 2, yy);
      });
      ctx.restore();
    }

    if (sf.hookSub) {
      ctx.font = `600 ${Math.round(hookSize * 0.42)}px ${FONT}`;
      ctx.fillStyle = th.sub;
      ctx.save();
      ctx.shadowColor = th.dim >= 0 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.7)';
      ctx.shadowBlur = 12;
      ctx.fillText(sf.hookSub, W / 2, hookY + hookH / 2 + 62);
      ctx.restore();
    }

    // ── 대본 자막: 화면 정가운데에서 offsetY 만큼 아래 ──
    const textSize = Number(st.textSize) || 60;
    const offsetY = Number.isFinite(Number(st.offsetY)) ? Number(st.offsetY) : 10;
    ctx.font = `700 ${textSize}px ${FONT}`;
    const lines = wrapLines(ctx, scene.text || '', W - 190);
    const lh = textSize * 1.42;
    const blockTop = H / 2 + offsetY;
    const blockH = lines.length * lh;

    const appear = easeOut(local / 0.35);
    ctx.save();
    ctx.globalAlpha = appear;
    ctx.translate(0, (1 - appear) * 26);

    if (st.boxed && lines.length) {
      const boxW = Math.min(W - 80, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 76);
      ctx.fillStyle = th.box;
      roundRect(ctx, (W - boxW) / 2, blockTop - 34, boxW, blockH + 68, 28);
      ctx.fill();
    }

    // 핵심 단어 색 강조: 줄별로 어절을 왼쪽부터 이어 그린다
    ctx.lineJoin = 'round';
    const allWords = lines.flatMap((l) => l.split(' '));
    const colorMap = capHighlights(allWords, th.text);
    let wIdx = 0;
    lines.forEach((l, i) => {
      const y = blockTop + lh / 2 + i * lh;
      const lineW = ctx.measureText(l).width;
      const words = l.split(' ');
      ctx.textAlign = 'left';
      let wx = (W - lineW) / 2;
      words.forEach((wd, k) => {
        const chunk = wd + (k < words.length - 1 ? ' ' : '');
        if (!st.boxed) {
          ctx.strokeStyle = th.dim >= 0 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.78)';
          ctx.lineWidth = Math.round(textSize * 0.16);
          ctx.strokeText(chunk, wx, y);
        }
        ctx.fillStyle = colorMap[wIdx] || th.text;
        ctx.fillText(chunk, wx, y);
        wx += ctx.measureText(chunk).width;
        wIdx++;
      });
      ctx.textAlign = 'center';
    });
    ctx.restore();

    // ── 하단 내레이션 자막 ──
    if (st.narration !== false && scene.narration) {
      const nSize = Math.round(textSize * 0.82);
      ctx.font = `500 ${nSize}px ${FONT}`;
      const unit = narrationUnit(ctx, scene.narration, p, W - 170);
      if (unit) {
        const ny = H - 232;
        const nw = ctx.measureText(unit).width;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        roundRect(ctx, (W - nw) / 2 - 26, ny - nSize * 0.9, nw + 52, nSize * 1.5, 15);
        ctx.fill();
        ctx.fillStyle = '#f5f5f5';
        ctx.fillText(unit, W / 2, ny);
      }
    }

    // ── 하단 진행 바 (장면 단위) ──
    const barY = H - 118;
    const barW = W - 160;
    const gap = 10;
    const segW = (barW - gap * (sf.scenes.length - 1)) / sf.scenes.length;
    for (let i = 0; i < sf.scenes.length; i++) {
      const x = 80 + i * (segW + gap);
      ctx.fillStyle = th.dim >= 0 ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.18)';
      roundRect(ctx, x, barY, segW, 8, 4);
      ctx.fill();
      const fill = i < index ? 1 : i === index ? p : 0;
      if (fill > 0) {
        ctx.fillStyle = th.accent;
        roundRect(ctx, x, barY, segW * fill, 8, 4);
        ctx.fill();
      }
    }
  }

  // 프레임이 밀려도 다음 프레임이 반드시 오도록 rAF와 타이머를 경주
  function nextTick() {
    return new Promise((resolve) => {
      let done = false;
      const fire = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(fire);
      setTimeout(fire, 33);
    });
  }

  function pickMime() {
    const list = ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // 영상 녹화. onProgress(playT, total, frames) 로 진행 과정을 노출한다.
  // captureStream(0) + track.requestFrame() 로 화면 합성 상태와 무관하게 그린 프레임을 담는다.
  // audio: { narrationBuffer, bgmBuffer, narrGain, bgmGain } 를 주면 소리를 함께 녹음한다.
  async function exportVideo(canvas, ctx, sf, imgCache, draftId, { onProgress, audio } = {}) {
    if (!window.MediaRecorder) throw new Error('이 브라우저는 영상 녹화를 지원하지 않습니다. Chrome/Edge에서 열어주세요.');
    const mime = pickMime();
    if (!mime) throw new Error('이 브라우저에서 지원하는 영상 코덱을 찾지 못했습니다.');
    await ensureFont();
    await preloadAll(imgCache, draftId, sf);

    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];

    // 오디오 믹싱 준비 (있을 때만)
    let audioCtx = null;
    let startAudio = null;
    if (audio && (audio.narrationBuffer || audio.bgmBuffer)) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      const sources = [];
      if (audio.bgmBuffer) {
        const s = audioCtx.createBufferSource();
        s.buffer = audio.bgmBuffer;
        const g = audioCtx.createGain();
        g.gain.value = audio.bgmGain != null ? audio.bgmGain : 0.18;
        s.connect(g).connect(dest);
        sources.push(s);
      }
      if (audio.narrationBuffer) {
        const s = audioCtx.createBufferSource();
        s.buffer = audio.narrationBuffer;
        const g = audioCtx.createGain();
        g.gain.value = audio.narrGain != null ? audio.narrGain : 1;
        s.connect(g).connect(dest);
        sources.push(s);
      }
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      startAudio = () => sources.forEach((s) => { try { s.start(); } catch (e) {} });
    }

    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));

    const total = totalSec(sf);
    drawFrame(ctx, sf, 0, imgCache);
    rec.start(200);
    if (startAudio) startAudio(); // 녹화 시작과 함께 오디오 재생
    const t0 = performance.now();
    let frames = 0;
    let playT = 0;
    for (;;) {
      playT = Math.min(total, (performance.now() - t0) / 1000);
      drawFrame(ctx, sf, playT, imgCache);
      if (track.requestFrame) track.requestFrame();
      frames++;
      if (onProgress) onProgress(playT, total, frames);
      if (playT >= total) break;
      await nextTick();
    }
    await new Promise((r) => setTimeout(r, 300));
    rec.stop();
    await stopped;
    if (audioCtx) audioCtx.close().catch(() => {});

    const blob = new Blob(chunks, { type: mime });
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    return { blob, ext, frames, total };
  }

  // ── 오디오: WAV 인코딩 · 배경음악 생성 · 내레이션 렌더 ──
  function bufferToWav(buf) {
    const numCh = buf.numberOfChannels;
    const len = buf.length;
    const sr = buf.sampleRate;
    const blockAlign = numCh * 2;
    const dataLen = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataLen);
    const dv = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, numCh, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * blockAlign, true);
    dv.setUint16(32, blockAlign, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, dataLen, true);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  // 잔잔한 배경음악을 코드 진행으로 생성 (OfflineAudioContext → AudioBuffer)
  const BGM_PRESETS = {
    calm:   { tempo: 68,  wave: 'sine',     root: 220, prog: [0, 7, 9, 5],  chord: [0, 4, 7], gain: 0.5, cutoff: 2000 },
    lofi:   { tempo: 78,  wave: 'triangle', root: 196, prog: [0, 5, 9, 7],  chord: [0, 3, 7], gain: 0.5, cutoff: 1500 },
    bright: { tempo: 104, wave: 'sine',     root: 262, prog: [0, 7, 5, 9],  chord: [0, 4, 7], gain: 0.45, cutoff: 2600 },
  };
  async function renderBgm(style, durationSec) {
    const P = BGM_PRESETS[style] || BGM_PRESETS.calm;
    const sr = 44100;
    const len = Math.ceil((durationSec + 1) * sr);
    const oc = new OfflineAudioContext(2, len, sr);
    const semis = (n) => Math.pow(2, n / 12);
    const beat = 60 / P.tempo;
    const barLen = beat * 4;

    const master = oc.createGain();
    master.gain.value = P.gain;
    const lp = oc.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = P.cutoff;
    master.connect(lp).connect(oc.destination);

    let t = 0;
    let bar = 0;
    while (t < durationSec) {
      const deg = P.prog[bar % P.prog.length];
      const rootFreq = P.root * semis(deg);
      const sustain = Math.min(barLen, durationSec - t);
      // 화음 패드
      P.chord.forEach((iv, ci) => {
        const osc = oc.createOscillator();
        osc.type = P.wave;
        osc.frequency.value = rootFreq * semis(iv);
        const g = oc.createGain();
        const a = 0.5;
        const peak = 0.9 / (ci + 1);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + a);
        g.gain.setValueAtTime(peak, t + Math.max(a, sustain - 0.7));
        g.gain.linearRampToValueAtTime(0, t + sustain);
        osc.connect(g).connect(master);
        osc.start(t);
        osc.stop(t + sustain + 0.05);
      });
      // 부드러운 베이스
      const bass = oc.createOscillator();
      bass.type = 'sine';
      bass.frequency.value = rootFreq / 2;
      const bg = oc.createGain();
      bg.gain.setValueAtTime(0, t);
      bg.gain.linearRampToValueAtTime(0.55, t + 0.06);
      bg.gain.linearRampToValueAtTime(0, t + sustain);
      bass.connect(bg).connect(master);
      bass.start(t);
      bass.stop(t + sustain + 0.05);

      t += barLen;
      bar++;
    }
    return oc.startRendering();
  }

  // 장면별 TTS mp3를 각 장면 시작 시각에 배치해 하나의 내레이션 트랙으로 렌더
  async function renderNarration(draftId, sf) {
    const total = totalSec(sf);
    const sr = 44100;
    const oc = new OfflineAudioContext(2, Math.ceil((total + 1) * sr), sr);
    let acc = 0;
    let any = false;
    for (const s of sf.scenes) {
      const dur = Number(s.seconds) || 4;
      if (s.ttsFile) {
        try {
          const resp = await fetch(mediaUrl(draftId, s.ttsFile));
          if (resp.ok) {
            const arr = await resp.arrayBuffer();
            const decoded = await oc.decodeAudioData(arr);
            const src = oc.createBufferSource();
            src.buffer = decoded;
            src.connect(oc.destination);
            src.start(acc);
            any = true;
          }
        } catch (e) { /* 이 장면 건너뜀 */ }
      }
      acc += dur;
    }
    if (!any) return null;
    return oc.startRendering();
  }

  // ── 이미지 전체 ZIP (무압축 store 방식 — JPEG는 이미 압축돼 있음) ──
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function buildZip(entries) {
    // entries: [{name, data:Uint8Array}]
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
    const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const crc = crc32(e.data);
      const size = e.data.length;
      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)
      );
      parts.push(new Uint8Array(local), nameBytes, e.data);
      const localLen = local.length + nameBytes.length + size;
      central.push({ nameBytes, crc, size, offset });
      offset += localLen;
    }
    const cdParts = [];
    let cdSize = 0;
    for (const c of central) {
      const rec = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(c.crc), u32(c.size), u32(c.size), u16(c.nameBytes.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset)
      );
      cdParts.push(new Uint8Array(rec), c.nameBytes);
      cdSize += rec.length + c.nameBytes.length;
    }
    const end = [].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(cdSize), u32(offset), u16(0)
    );
    return new Blob([...parts, ...cdParts, new Uint8Array(end)], { type: 'application/zip' });
  }

  // 장면 배경 이미지를 모두 받아 ZIP Blob 생성 (중복 파일 1회만)
  async function buildImagesZip(draftId, sf) {
    const seen = new Set();
    const entries = [];
    let n = 1;
    for (const s of sf.scenes || []) {
      if (!s.file || seen.has(s.file)) continue;
      seen.add(s.file);
      try {
        const resp = await fetch(mediaUrl(draftId, s.file));
        if (!resp.ok) continue;
        const buf = new Uint8Array(await resp.arrayBuffer());
        const ext = /\.(png|jpe?g|webp)$/i.test(s.file) ? s.file.split('.').pop() : 'jpg';
        entries.push({ name: `scene-${String(n).padStart(2, '0')}.${ext}`, data: buf });
        n++;
      } catch {}
    }
    if (!entries.length) throw new Error('내려받을 이미지가 없습니다.');
    return buildZip(entries);
  }

  window.SF = {
    W, H, FONT, THEMES, FOCI,
    totalSec, sceneAt, mediaUrl, loadImage, preloadAll, ensureFont,
    drawFrame, nextTick, pickMime, download, exportVideo, buildImagesZip,
    bufferToWav, renderBgm, renderNarration,
  };
})();
