// Codex CLI 비대화형 실행 래퍼 — ChatGPT/Codex 구독 로그인으로 AI 호출
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');

function findCodexCli() {
  const candidates = [
    process.env.CODEX_CLI_PATH,
    process.env.APPDATA && path.join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe'
    ),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'codex.cmd'),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || 'codex';
}

// API 키가 환경변수에 남아 있어도 사용하지 않고, 저장된 ChatGPT 로그인을 사용한다.
function subscriptionEnv() {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

function spawnOptions(extra = {}) {
  const cli = findCodexCli();
  return {
    cli,
    options: {
      windowsHide: true,
      env: subscriptionEnv(),
      shell: cli.toLowerCase().endsWith('.cmd'),
      ...extra,
    },
  };
}

function checkCli() {
  try {
    const { cli, options } = spawnOptions({ encoding: 'utf8', timeout: 20000 });
    const result = spawnSync(cli, ['--version'], options);
    if (result.status === 0) {
      return {
        ok: true,
        version: String(result.stdout || '').trim(),
        path: cli,
      };
    }
    return { ok: false, error: String(result.stderr || result.error?.message || '실행 실패').trim() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * codex exec를 호출해 마지막 텍스트 응답을 받는다.
 * 프롬프트는 stdin으로 전달하고, 이미지가 있으면 공식 --image 옵션으로 첨부한다.
 */
function invoke(prompt, { timeoutMs = 180000, imagePaths = [] } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--cd',
      PROJECT_ROOT,
    ];
    const validImages = imagePaths.filter((file) => file && fs.existsSync(file));
    if (validImages.length) args.push('--image', ...validImages);
    args.push('-');

    const { cli, options } = spawnOptions({ cwd: PROJECT_ROOT });
    const child = spawn(cli, args, options);
    let out = '';
    let err = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`Codex 호출이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`));
    }, timeoutMs);

    child.stdout.on('data', (data) => (out += data));
    child.stderr.on('data', (data) => (err += data));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Codex CLI 실행 실패: ${error.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Codex 종료 코드 ${code}: ${(err || out).slice(-700)}`));
      }
      resolve(String(out).trim());
    });

    child.stdin.on('error', () => {});
    child.stdin.write(String(prompt), 'utf8');
    child.stdin.end();
  });
}

// 응답 텍스트에서 JSON 부분만 추출해 파싱
function extractJson(text) {
  let value = String(text).trim().replace(/```(?:json)?/gi, '').trim();
  const firstObject = value.indexOf('{');
  const firstArray = value.indexOf('[');
  let start = -1;
  let close;

  if (firstArray !== -1 && (firstObject === -1 || firstArray < firstObject)) {
    start = firstArray;
    close = ']';
  } else if (firstObject !== -1) {
    start = firstObject;
    close = '}';
  }
  if (start === -1) throw new Error('응답에서 JSON을 찾지 못했습니다: ' + value.slice(0, 200));
  const end = value.lastIndexOf(close);
  if (end <= start) throw new Error('JSON 형식이 완전하지 않습니다: ' + value.slice(0, 200));
  return JSON.parse(value.slice(start, end + 1));
}

// JSON 응답을 강제하는 호출. 파싱 실패 시 1회 재시도.
async function invokeJson(prompt, opts = {}) {
  const suffix = '\n\n중요: 설명 없이 오직 유효한 JSON만 출력하세요. 코드블록 표시도 넣지 마세요.';
  try {
    return extractJson(await invoke(prompt + suffix, opts));
  } catch (error) {
    if (error.message.startsWith('Codex')) throw error;
    const retryPrompt =
      prompt + suffix + '\n(직전 응답이 JSON 파싱에 실패했습니다. 반드시 JSON만 출력하세요.)';
    return extractJson(await invoke(retryPrompt, opts));
  }
}

let authStatus = null;

async function checkAuth(force = false) {
  if (!force && authStatus && Date.now() - authStatus.at < 30 * 60 * 1000) return authStatus;
  try {
    await invoke('다른 설명 없이 OK 한 단어로만 답하세요.', { timeoutMs: 120000 });
    authStatus = { ok: true, method: 'ChatGPT 구독 로그인', at: Date.now() };
  } catch (error) {
    const loginProblem = /401|authenticate|login|not logged/i.test(error.message);
    authStatus = {
      ok: false,
      error: loginProblem
        ? 'Codex 로그인이 필요합니다. 터미널에서 codex login을 실행해 ChatGPT로 로그인하세요.'
        : error.message.slice(0, 300),
      at: Date.now(),
    };
  }
  return authStatus;
}

module.exports = {
  checkCli,
  invoke,
  invokeJson,
  extractJson,
  checkAuth,
  getAuthStatus: () => authStatus,
};
