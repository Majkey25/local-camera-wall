import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, writeFile, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_CAMERAS, sourceUrl } from './camera-store.mjs';

export const LOOPBACK = '127.0.0.1';
const engineHost = `${LOOPBACK}:8477`;
const maxBuffered = 8 * 1024 * 1024;

function closePeer(socket) {
  if (socket.readyState === WebSocket.OPEN) socket.close();
  if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
}

export class VideoEngine {
  slots = new Map();
  sessions = new Map();
  tunnels = new Map();
  viewer = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  transport = new WebSocketServer({ noServer: true, maxPayload: 65536 });

  constructor(directory, executable, host) {
    this.config = join(directory, 'engine.json');
    this.executable = executable;
    this.host = host;
    this.password = randomBytes(32).toString('hex');
    this.authorization = `Basic ${Buffer.from(`kamery:${this.password}`).toString('base64')}`;
  }

  async request(path, method = 'GET') {
    return fetch(`http://${engineHost}${path}`, {
      method, headers: { Authorization: this.authorization },
      signal: AbortSignal.timeout(2500), redirect: 'error',
    });
  }

  async start() {
    await access(this.executable);
    // PATCH /api/streams registers sources in memory. The upstream PUT endpoint writes them to disk.
    await writeFile(this.config, JSON.stringify({
      app: { modules: ['api', 'ws', 'rtsp', 'mp4'] },
      log: { level: 'disabled', api: 'info', format: 'json', output: 'stdout' },
      api: { listen: engineHost, username: 'kamery', password: '${KAMERY_ENGINE_PASSWORD}',
        local_auth: true, allow_paths: ['/', '/api', '/api/streams', '/api/ws'] },
      rtsp: { listen: '' },
      webrtc: { listen: '', ice_servers: [] },
    }));
    this.child = spawn(this.executable, ['-config', this.config], {
      stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, cwd: dirname(this.executable),
      env: { SystemRoot: process.env.SystemRoot, KAMERY_ENGINE_PASSWORD: this.password },
    });
    this.child.once('error', () => { this.failed = true; });
    this.child.once('exit', () => { this.failed = true; });
    const lines = createInterface({ input: this.child.stdout });
    await new Promise((resolve, reject) => {
      const problem = new Error('Videoslužba se nespustila. Zkontrolujte port 8477 a instalaci go2rtc.');
      const fail = () => finish(problem);
      const timer = setTimeout(fail, 4500);
      const check = line => {
        try {
          const entry = JSON.parse(line);
          if (entry.message === '[api] listen' && entry.addr === engineHost && !this.failed) finish();
        } catch {
          // Startup also emits human-readable build information.
        }
      };
      const finish = error => {
        clearTimeout(timer);
        this.child.off('error', fail);
        this.child.off('exit', fail);
        lines.off('line', check);
        if (error) reject(error);
        else resolve();
      };
      lines.on('line', check);
      this.child.once('error', fail);
      this.child.once('exit', fail);
    });
    const response = await this.request('/api');
    if (!response.ok || (await response.json()).version !== '1.9.15') {
      throw new Error('Neočekávaná odpověď videoslužby.');
    }
    const player = await this.request('/video-rtc.js');
    if (!player.ok) throw new Error('Videoslužba neposkytla přehrávač.');
    this.player = await player.text();
  }

  async stop() {
    for (const socket of [...this.viewer.clients, ...this.transport.clients]) socket.terminate();
    if (this.child && !this.failed) this.child.kill();
    this.viewer.close();
    this.transport.close();
    await rm(this.config, { force: true });
  }

  async patch(slot, source) {
    const query = new URLSearchParams({ name: `camera-${slot}`, src: source });
    const response = await this.request(`/api/streams?${query}`, 'PATCH');
    await response.body?.cancel();
    if (!response.ok) throw new Error('Videoslužba odmítla zdroj.');
  }

  prepare(camera) {
    const existing = this.slots.get(camera.slot);
    if (existing?.camera === camera) return existing.ready;
    const token = randomBytes(24).toString('hex');
    const address = new URL(camera.address);
    const tunnel = { host: address.hostname, port: Number(address.port || 554), connects: [] };
    const ready = (existing?.ready ?? Promise.resolve()).catch(() => {}).then(async () => {
      const source = await sourceUrl(camera);
      this.tunnels.set(token, tunnel);
      // The pinned tunnel keeps upstream RTSP redirects on the originally selected camera.
      const transport = `ws://${this.host}/transport/${token}`;
      await this.patch(camera.slot, `${source}#transport=${transport}#media=video`);
    });
    this.slots.set(camera.slot, { camera, token, ready });
    ready.catch(() => {
      this.tunnels.delete(token);
      if (this.slots.get(camera.slot)?.ready === ready) this.slots.delete(camera.slot);
    });
    return ready;
  }

  retire(camera) {
    for (const client of this.sessions.get(camera.id) ?? []) client.terminate();
    const previous = this.slots.get(camera.slot);
    if (!previous) return;
    this.tunnels.delete(previous.token);
    const ready = previous.ready.catch(() => {}).then(() => {
      this.tunnels.delete(previous.token);
      return this.patch(camera.slot, `rtsp://${LOOPBACK}:1/`);
    });
    this.slots.set(camera.slot, { ready });
    ready.catch(() => {});
  }

  openTunnel(request, socket, head, token) {
    const target = this.tunnels.get(token);
    if (!target || request.headers.origin || this.transport.clients.size >= MAX_CAMERAS * 2) return false;
    const now = Date.now();
    target.connects = target.connects.filter(time => now - time < 10_000);
    if (target.connects.length >= 8) return false;
    target.connects.push(now);
    this.transport.handleUpgrade(request, socket, head, ws => {
      const tcp = createConnection({ host: target.host, port: target.port });
      tcp.setTimeout(12_000, () => tcp.destroy());
      tcp.on('data', chunk => {
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > maxBuffered) ws.terminate();
        else ws.send(chunk, { binary: true });
      });
      ws.on('message', (data, binary) => {
        if (!binary || tcp.writableLength > maxBuffered) tcp.destroy();
        else tcp.write(data);
      });
      ws.on('error', () => tcp.destroy());
      ws.on('close', () => tcp.destroy());
      tcp.on('error', () => ws.terminate());
      tcp.on('close', () => ws.terminate());
    });
    return true;
  }

  openViewer(request, socket, head, camera) {
    if (this.viewer.clients.size >= MAX_CAMERAS * 3 || (this.sessions.get(camera.id)?.size ?? 0) >= 6) return false;
    this.viewer.handleUpgrade(request, socket, head, client => {
      let upstream;
      let negotiated = false;
      const viewers = this.sessions.get(camera.id) ?? new Set();
      viewers.add(client);
      this.sessions.set(camera.id, viewers);
      const reject = (reason = 'unavailable') => {
        if (client.readyState !== WebSocket.OPEN) return;
        client.send(JSON.stringify({ type: 'error', reason }));
        client.close(1011);
      };
      client.on('error', () => closePeer(upstream ?? client));
      client.on('close', () => {
        if (upstream) closePeer(upstream);
        viewers.delete(client);
        if (!viewers.size) this.sessions.delete(camera.id);
      });
      client.on('message', async (data, binary) => {
        let message;
        try { message = JSON.parse(data.toString()); } catch { return reject(); }
        if (binary || negotiated || message?.type !== 'mse' || typeof message.value !== 'string'
          || !/^[a-z0-9.,]{1,256}$/iu.test(message.value)) return reject();
        negotiated = true;
        try {
          await this.prepare(camera);
          if (client.readyState !== WebSocket.OPEN) return;
          upstream = new WebSocket(`ws://${engineHost}/api/ws?src=camera-${camera.slot}`, {
            headers: { Authorization: this.authorization }, handshakeTimeout: 3000, maxPayload: maxBuffered,
          });
          upstream.once('open', () => upstream.send(JSON.stringify({ type: 'mse', value: message.value })));
          upstream.on('message', (payload, isBinary) => {
            if (client.readyState !== WebSocket.OPEN) return;
            if (client.bufferedAmount > maxBuffered) return client.terminate();
            if (isBinary) return client.send(payload, { binary: true });
            try {
              const result = JSON.parse(payload.toString());
              if (result.type === 'mse' && /^video\/mp4; codecs="[a-z0-9., ]+"$/iu.test(result.value)) {
                client.send(JSON.stringify({ type: 'mse', value: result.value }));
              } else {
                const authError = /wrong user\/pass|user\/pass not provided|\b401\b/iu.test(result.value);
                reject(authError ? 'credentials' : 'unavailable');
              }
            } catch { reject(); }
          });
          upstream.on('unexpected-response', (_request, response) => {
            response.resume();
            upstream.terminate();
          });
          upstream.on('error', () => reject());
          upstream.on('close', () => reject());
        } catch { reject(); }
      });
    });
    return true;
  }
}
