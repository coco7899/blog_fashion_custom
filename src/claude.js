// claude -p (Claude Code CLI 헤드리스) 래퍼 — 구독 요금제로 AI 호출
const { spawn, spawnSync } = require('child_process');

// Claude Code 세션 안에서 서버를 실행해도 자식 claude가 구독 로그인 인증을 쓰도록
// 상속되면 안 되는 환경변수를 제거한다.
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CLAUDE_CODE_|CLAUDECODE|CLAUDE_AGENT_|ANTHROPIC_)/i.test(key)) delete env[key];
  }
  return env;
}

function checkCli() {
  try {
    const r = spawnSync('claude', ['--version'], { shell: true, encoding: 'utf8', timeout: 20000, env: cleanEnv() });
    if (r.status === 0) return { ok: true, version: String(r.stdout || '').trim() };
    return { ok: false, error: String(r.stderr || '실행 실패').trim() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * claude -p 를 호출해 텍스트 응답을 받는다. 프롬프트는 stdin으로 전달(인용 문제 회피).
 * allowedTools 에 'Read' 를 넣으면 로컬 이미지 파일을 직접 보고 판단할 수 있다.
 */
function invoke(prompt, { timeoutMs = 180000, allowedTools = [] } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json'];
    if (allowedTools.length) {
      args.push('--allowedTools', allowedTools.join(','));
    }
    const child = spawn('claude', args, { shell: true, windowsHide: true, env: cleanEnv() });
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`claude 호출이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`claude CLI 실행 실패: ${e.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`claude 종료 코드 ${code}: ${(err || out).slice(0, 500)}`));
      }
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error) return reject(new Error(`claude 오류: ${String(parsed.result).slice(0, 500)}`));
        resolve(parsed.result != null ? String(parsed.result) : out);
      } catch {
        resolve(out); // json 래핑 실패 시 원문 반환
      }
    });

    child.stdin.on('error', () => {});
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();
  });
}

// 응답 텍스트에서 JSON 부분만 추출해 파싱
function extractJson(text) {
  let t = String(text).trim();
  t = t.replace(/```(?:json)?/gi, '').trim();
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  let start = -1;
  let open, close;
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr; open = '['; close = ']';
  } else if (firstObj !== -1) {
    start = firstObj; open = '{'; close = '}';
  }
  if (start === -1) throw new Error('응답에서 JSON을 찾지 못했습니다: ' + t.slice(0, 200));
  const end = t.lastIndexOf(close);
  if (end <= start) throw new Error('JSON 형식이 완전하지 않습니다: ' + t.slice(0, 200));
  return JSON.parse(t.slice(start, end + 1));
}

// JSON 응답을 강제하는 호출. 파싱 실패 시 1회 재시도.
async function invokeJson(prompt, opts = {}) {
  const suffix = '\n\n중요: 설명 없이 오직 유효한 JSON만 출력하세요. 코드블록 표시도 넣지 마세요.';
  try {
    const text = await invoke(prompt + suffix, opts);
    return extractJson(text);
  } catch (e) {
    if (e.message.startsWith('claude')) throw e; // CLI 자체 오류는 재시도 의미 없음
    const text = await invoke(
      prompt + suffix + '\n(직전 응답이 JSON 파싱에 실패했습니다. 반드시 JSON만 출력하세요.)',
      opts
    );
    return extractJson(text);
  }
}

// 실제 인증 상태 점검 (서버 시작 시 1회 + 요청 시 갱신)
let authStatus = null; // { ok, error, at }
async function checkAuth(force = false) {
  if (!force && authStatus && Date.now() - authStatus.at < 30 * 60 * 1000) return authStatus;
  try {
    await invoke('OK 라고 한 단어로만 답하세요.', { timeoutMs: 90000 });
    authStatus = { ok: true, at: Date.now() };
  } catch (e) {
    const is401 = /401|authenticate/i.test(e.message);
    authStatus = {
      ok: false,
      error: is401 ? '구독 로그인 만료 — 터미널에서 claude 실행 후 /login 필요' : e.message.slice(0, 200),
      at: Date.now(),
    };
  }
  return authStatus;
}

module.exports = { checkCli, invoke, invokeJson, extractJson, checkAuth, getAuthStatus: () => authStatus };
