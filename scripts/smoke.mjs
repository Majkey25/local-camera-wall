import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const scratch = join(root, '.reference', 'tmp');
await mkdir(scratch, { recursive: true });
const profile = await mkdtemp(join(scratch, 'smoke-'));
const origin = 'http://127.0.0.1:8476';
const app = spawn(process.execPath, ['server.mjs'], {
  cwd: root, env: { ...process.env, LOCALAPPDATA: profile },
  stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
});
const finished = new Promise(resolve => app.once('close', resolve));

try {
  const ready = Promise.withResolvers();
  app.once('error', ready.reject);
  app.once('exit', code => ready.reject(new Error(`Dashboard closed before startup (${code}).`)));
  let output = '';
  app.stdout.on('data', chunk => {
    output = (output + chunk).slice(-4096);
    if (output.includes(origin)) ready.resolve();
  });
  const timeout = setTimeout(() => ready.reject(new Error('The dashboard did not start.')), 20000);
  try { await ready.promise; } finally { clearTimeout(timeout); }

  const read = (path, options = {}) => fetch(origin + path, { signal: AbortSignal.timeout(5000), ...options });
  assert.equal((await read('/api/cameras')).status, 401);
  assert.equal((await read('/api/cameras', { headers: { origin: 'https://example.test' } })).status, 403);
  const launcher = await readFile(join(profile, 'Kamery', 'open.html'), 'utf8');
  const code = /name="code" value="([a-f0-9]+)"/u.exec(launcher)?.[1];
  assert(code, 'The local launcher was not created.');
  const pair = await read('/pair', { method: 'POST', headers: { origin: 'null' }, body: new URLSearchParams({ code }) });
  assert.equal(pair.status, 200);
  const session = /sessionStorage\.setItem\('kamery\.session', '([a-f0-9]+)'\)/u.exec(await pair.text())?.[1];
  assert(session, 'The local launcher did not pair.');
  const cameras = await read('/api/cameras', { headers: { authorization: `Bearer ${session}` } });
  assert.equal(cameras.status, 200);
  assert.deepEqual(await cameras.json(), { cameras: [] });
  for (const path of ['/', '/app.js', '/style.css', '/video-rtc.js']) {
    const asset = await read(path);
    assert.equal(asset.status, 200);
    assert((await asset.arrayBuffer()).byteLength > 0);
  }
  console.log('Windows startup, local pairing, API access and player assets passed.');
} finally {
  if (app.pid && app.exitCode === null) {
    await promisify(execFile)('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true });
  }
  await finished;
  await rm(profile, { recursive: true, force: true });
}
