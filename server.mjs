import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CameraError, MAX_CAMERAS, cameraView, idPattern, newCamera, readCameras, windowsProfile, writeCameras } from './camera-store.mjs';
import { exportBackup, importBackup } from './backup.mjs';
import { backupFileLimit } from './settings-format.mjs';
import { LOOPBACK, VideoEngine } from './video-engine.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = 8476;
const host = `${LOOPBACK}:${port}`;
const origin = `http://${host}`;
const itemRoute = new RegExp(`^/api/cameras/(${idPattern})$`, 'u');
const streamRoute = new RegExp(`^/video/(${idPattern})$`, 'u');
const tunnelRoute = /^\/transport\/([a-f0-9]{48})$/u;
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['.runtime/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
]);
const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' ws://${host}; media-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function localRequest(request) {
  return request.socket.remoteAddress === LOOPBACK && request.headers.host === host;
}

function send(response, status, data, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { ...responseHeaders, 'Content-Type': type });
  response.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

async function requestInput(request, limit = 4096) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) {
      request.resume();
      throw new CameraError('Zadané údaje jsou příliš dlouhé.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function matches(actual, expected) {
  return typeof actual === 'string' && Buffer.byteLength(actual) === expected.length
    && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function main() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
    throw new Error('Kamery vyžadují Windows a přihlášený uživatelský profil.');
  }
  await access(join(root, '.runtime', 'app.js')).catch(() => {
    throw new Error('Chybí sestavené rozhraní. Spusťte aplikaci pomocí start.cmd.');
  });
  const directory = join(process.env.LOCALAPPDATA, 'Kamery');
  await mkdir(directory, { recursive: true });
  await windowsProfile('profile', directory);
  let cameras = await readCameras(directory);
  const engine = new VideoEngine(directory, join(root, '.runtime', 'go2rtc.exe'), host);
  const launchKey = randomBytes(32).toString('hex');
  const sessionKey = randomBytes(32).toString('hex');
  const launcher = join(directory, 'open.html');
  let launcherWritten = false;
  let mutations = Promise.resolve();
  let backupBusy = false;
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5000 }, async (request, response) => {
    if (!localRequest(request)) return send(response, 403, { error: 'Přístup je povolen pouze z tohoto počítače.' });
    const { url, method } = request;
    try {
      if (method === 'POST' && url === '/pair') {
        const type = request.headers['content-type']?.split(';')[0];
        if (request.headers.origin !== 'null' || type !== 'application/x-www-form-urlencoded'
          || !matches(new URLSearchParams(await requestInput(request)).get('code'), launchKey)) {
          return send(response, 403, { error: 'Spusťte Kamery z místního profilu Windows.' });
        }
        const nonce = randomBytes(16).toString('base64');
        response.writeHead(200, { ...responseHeaders, 'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'` });
        return response.end(`<!doctype html><meta charset="utf-8"><title>Kamery</title><script nonce="${nonce}">sessionStorage.setItem('kamery.session', '${sessionKey}'); location.replace('/');</script>`);
      }
      if ((request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') {
        return send(response, 403, { error: 'Neplatný původ požadavku.' });
      }
      if (url.startsWith('/api/') && !matches(request.headers.authorization, `Bearer ${sessionKey}`)) {
        return send(response, 401, { error: 'Otevřete Kamery pomocí souboru start.cmd.' });
      }
      if (method === 'GET') {
        if (url === '/favicon.ico') return send(response, 204, '');
        if (url === '/api/cameras') return send(response, 200, { cameras: cameras.map(cameraView) });
        if (url === '/video-rtc.js' && engine.player) return send(response, 200, engine.player, 'text/javascript; charset=utf-8');
        const asset = assets.get(url);
        if (asset) return send(response, 200, await readFile(join(root, asset[0])), asset[1]);
        return send(response, 404, { error: 'Stránka neexistuje.' });
      }
      const id = itemRoute.exec(url)?.[1];
      const exporting = method === 'POST' && url === '/api/settings/export';
      const importing = method === 'POST' && url === '/api/settings/import';
      if (!exporting && !importing && !(method === 'POST' && url === '/api/cameras')
        && !(id && (method === 'PUT' || method === 'DELETE'))) {
        return send(response, 404, { error: 'Požadovaná operace neexistuje.' });
      }
      if (request.headers.origin !== origin) return send(response, 403, { error: 'Neplatný původ požadavku.' });
      if (method !== 'DELETE' && request.headers['content-type']?.split(';')[0] !== 'application/json') {
        return send(response, 415, { error: 'Zadané údaje musí být ve formátu JSON.' });
      }
      let body = null;
      if (method !== 'DELETE') {
        try { body = JSON.parse(await requestInput(request, importing ? backupFileLimit + 4096 : undefined)); } catch (error) {
          if (error instanceof CameraError) throw error;
          throw new CameraError('Zadané údaje nelze přečíst.');
        }
      }
      if (exporting || importing) {
        if (backupBusy) return send(response, 409, { error: 'Počkejte na dokončení operace se zálohou.' });
        if (importing && body?.replace !== true) throw new CameraError('Potvrďte nahrazení nastavení.');
        backupBusy = true;
        try {
          const backup = mutations.then(async () => {
            if (exporting) return exportBackup(cameras, body);
            const restored = await importBackup(body);
            await writeCameras(directory, restored.cameras);
            const previous = cameras;
            cameras = restored.cameras;
            for (const camera of previous) engine.retire(camera);
            return { cameras: cameras.map(cameraView), layout: restored.layout, theme: restored.theme, language: restored.language };
          });
          mutations = backup.catch(() => {});
          return send(response, 200, await backup);
        } finally {
          backupBusy = false;
        }
      }
      const update = mutations.then(async () => {
        const previous = id ? cameras.find(camera => camera.id === id) : null;
        if (id && !previous) return send(response, 404, { error: 'Kamera už v přehledu není.' });
        if (method === 'POST' && cameras.length >= MAX_CAMERAS) {
          return send(response, 409, { error: `Přehled má kapacitu ${MAX_CAMERAS} kamer.` });
        }
        const used = new Set(cameras.map(camera => camera.slot));
        const slot = previous?.slot ?? Array.from({ length: MAX_CAMERAS }, (_, index) => index)
          .find(index => !used.has(index));
        const camera = method === 'DELETE' ? null : await newCamera(body, previous, slot);
        const next = method === 'POST' ? [...cameras, camera]
          : cameras.flatMap(item => item.id === id ? (camera ? [camera] : []) : [item]);
        await writeCameras(directory, next);
        cameras = next;
        if (previous) engine.retire(previous);
        return send(response, method === 'POST' ? 201 : 200, camera ? { camera: cameraView(camera) } : {});
      });
      mutations = update.catch(() => {});
      await update;
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof CameraError) return send(response, 400, { error: error.message });
      send(response, 500, { error: 'Akci se nepodařilo dokončit. Zkontrolujte úložiště aplikace.' });
    }
  });
  server.on('upgrade', (request, socket, head) => {
    if (localRequest(request)) {
      if (request.headers.origin === origin && matches(request.headers['sec-websocket-protocol'], `kamery.${sessionKey}`)) {
        const id = streamRoute.exec(request.url)?.[1];
        const camera = cameras.find(item => item.id === id);
        if (camera && engine.openViewer(request, socket, head, camera)) return;
      } else if (!request.headers.origin) {
        const token = tunnelRoute.exec(request.url)?.[1];
        if (token && engine.openTunnel(request, socket, head, token)) return;
      }
    }
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, resolve);
  }).catch(() => { throw new Error(`Aplikace už běží nebo port ${port} není volný.`); });
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    server.close();
    await mutations;
    await engine.stop();
    if (launcherWritten) await rm(launcher, { force: true });
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGBREAK', stop);
  try {
    await engine.start();
    // The per-launch secret is in a user-profile file, never in browser navigation URLs or argv.
    await writeFile(launcher, `<!doctype html>
<html lang="cs"><meta charset="utf-8"><title>Otevřít Kamery</title>
<form action="${origin}/pair" method="post">
  <input type="hidden" name="code" value="${launchKey}">
  <button>Otevřít Kamery</button>
</form>
<script>document.forms[0].requestSubmit();</script></html>`);
    launcherWritten = true;
    console.log(`Kamery běží na ${origin}`);
    if (process.argv.includes('--open')) {
      const explorer = spawn(join(process.env.SystemRoot, 'explorer.exe'), [launcher], {
        detached: true, stdio: 'ignore',
      });
      explorer.on('error', () => console.log('Otevřete open.html v místním profilu Kamery.'));
      explorer.unref();
    }
  } catch (error) {
    await stop();
    throw error;
  }
}

main().catch(error => {
  console.error(error.code === 'ENOENT' ? 'Chybí go2rtc. Nejdříve spusťte setup.ps1.' : error.message);
  process.exitCode = 1;
});
