import { VideoRTC } from '/video-rtc.js';

const $ = (selector, element = document) => element.querySelector(selector);
const grid = $('#grid');
const layout = $('#layout');
const dialog = $('#camera-dialog');
const form = $('#camera-form');
const remove = $('#remove-camera');
const cancel = $('#cancel-form');
const add = $('#add-camera');
const exit = $('#exit-focus');
const formError = $('#form-error');
const session = sessionStorage.getItem('kamery.session');
const tiles = new Map();
let cameras = [];
let focused = null;
let editing = null;
let confirmedRemoval = false;
let busy = false;

function loadPreference(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const widths = loadPreference('kamery.widths', []);
const wide = new Set(Array.isArray(widths) ? widths.filter(id => typeof id === 'string') : []);
const sizes = new Set(['small', 'medium', 'large']);
let size = loadPreference('kamery.size', 'medium');
if (!sizes.has(size)) size = 'medium';

class CameraPlayer extends VideoRTC {
  constructor() {
    super();
    this.mode = 'mse';
    this.media = 'video';
    this.visibilityCheck = false;
    this.visibilityThreshold = 0;
    this.retries = 0;
  }

  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = true;
    this.video.setAttribute('aria-label', this.camera.name);
    this.video.addEventListener('playing', () => {
      this.retries = 0;
      this.showStatus('live');
    });
    this.video.addEventListener('waiting', () => this.showStatus('loading'));
  }

  onconnect() {
    if (!this.isConnected || !this.wsURL || this.ws) return false;
    this.wsState = WebSocket.CONNECTING;
    this.connectTS = Date.now();
    const socket = new WebSocket(this.wsURL, `kamery.${session}`);
    this.ws = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => this.onopen());
    socket.addEventListener('close', () => this.onclose());
    return true;
  }

  onopen() {
    const modes = super.onopen();
    this.onmessage.status = message => {
      if (message.type === 'error') this.showStatus(message.reason === 'credentials' ? 'credentials' : 'error');
    };
    if (!modes.length) this.showStatus('codec');
    return modes;
  }

  onclose() {
    if (this.wsState === WebSocket.CLOSED) return false;
    if (this.status === 'credentials' || this.status === 'codec' || this.retries >= 2) {
      this.wsState = WebSocket.CLOSED;
      this.ws = null;
      return false;
    }
    this.showStatus('error');
    this.retries++;
    return super.onclose();
  }

  disconnectedCallback() {
    clearTimeout(this.reconnectTID);
    this.wsState = WebSocket.CLOSED;
    this.ws?.close();
    this.ws = null;
    if (!this.video) return;
    this.video.pause();
    if (this.video.src.startsWith('blob:')) URL.revokeObjectURL(this.video.src);
    this.video.removeAttribute('src');
    this.video.srcObject = null;
    this.video.load();
  }

  showStatus(status) {
    if (this.status === status || !this.isConnected) return;
    this.status = status;
    this.dispatchEvent(new CustomEvent('playback', { detail: status }));
  }
}

customElements.define('camera-player', CameraPlayer);

async function api(path = '', method = 'GET', body) {
  const response = await fetch(`/api/cameras${path}`, {
    method, headers: { Authorization: `Bearer ${session}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Akci se nepodařilo dokončit.');
  return data;
}

function errorMessage(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function syncSize() {
  grid.dataset.size = size;
  for (const button of layout.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.size === size));
  }
}

function setTileState(tile, status) {
  if (tile.dataset.status === status) return;
  tile.dataset.status = status;
  const isLive = status === 'live';
  $('.idle', tile).hidden = isLive;
  $('.live', tile).hidden = !isLive;
  $('.retry', tile).hidden = status !== 'error';
  $('.idle-text', tile).textContent = {
    loading: 'Připojuji…',
    error: 'Kamera je nedostupná.',
    credentials: 'Kamera odmítla přihlášení.',
    codec: 'Tento prohlížeč nepodporuje přehrávání.',
  }[status] ?? '';
}

function syncPlayers() {
  for (const camera of cameras) {
    const tile = tiles.get(camera.id);
    const hideTile = Boolean(focused && focused !== camera.id);
    tile.hidden = hideTile;
    const picture = $('.picture', tile);
    if (hideTile || document.hidden) {
      picture.replaceChildren();
      continue;
    }
    if (picture.firstElementChild) continue;
    setTileState(tile, 'loading');
    const player = document.createElement('camera-player');
    player.camera = camera;
    player.addEventListener('playback', event => setTileState(tile, event.detail));
    player.src = `/video/${camera.id}`;
    picture.append(player);
  }
}

function setFocus(id) {
  focused = id;
  grid.toggleAttribute('data-focus', Boolean(id));
  exit.hidden = !id;
  layout.hidden = Boolean(id);
  for (const [cameraId, tile] of tiles) {
    $('.focus', tile).hidden = cameraId === id;
    $('.size', tile).hidden = Boolean(id);
  }
  syncPlayers();
}

function matchWidth(tile, id) {
  const expanded = wide.has(id);
  tile.toggleAttribute('data-wide', expanded);
  const button = $('.size', tile);
  button.setAttribute('aria-pressed', String(expanded));
  button.textContent = expanded ? 'Zúžit' : 'Rozšířit';
}

function buildTile(camera) {
  const tile = $('#camera-card').content.firstElementChild.cloneNode(true);
  tile.setAttribute('aria-label', camera.name);
  $('.camera-name', tile).textContent = camera.name;
  const address = new URL(camera.address);
  $('.address', tile).textContent = `${address.hostname}:${address.port || 554}`;
  matchWidth(tile, camera.id);
  $('.size', tile).addEventListener('click', () => {
    if (wide.has(camera.id)) wide.delete(camera.id);
    else wide.add(camera.id);
    savePreference('kamery.widths', [...wide]);
    matchWidth(tile, camera.id);
  });
  $('.focus', tile).addEventListener('click', () => {
    setFocus(camera.id);
    exit.focus();
  });
  $('.edit', tile).addEventListener('click', () => openForm(camera));
  $('.retry', tile).addEventListener('click', () => {
    $('.picture', tile).replaceChildren();
    syncPlayers();
  });
  return tile;
}

function refresh(changedId) {
  if (changedId) {
    const previous = tiles.get(changedId);
    const replacement = cameras.find(camera => camera.id === changedId);
    if (previous && replacement) {
      const tile = buildTile(replacement);
      previous.replaceWith(tile);
      tiles.set(changedId, tile);
    } else if (previous) {
      previous.remove();
      tiles.delete(changedId);
      wide.delete(changedId);
      savePreference('kamery.widths', [...wide]);
    }
  }
  for (const camera of cameras) {
    if (tiles.has(camera.id)) continue;
    const tile = buildTile(camera);
    tiles.set(camera.id, tile);
    grid.append(tile);
  }
  $('#camera-count').textContent = `${cameras.length} ${cameras.length === 1 ? 'kamera' : cameras.length >= 2 && cameras.length <= 4 ? 'kamery' : 'kamer'}`;
  $('#layout-bar').hidden = !cameras.length;
  $('#empty').hidden = Boolean(cameras.length);
  setFocus(tiles.has(focused) ? focused : null);
}

function openForm(camera = null) {
  editing = camera;
  confirmedRemoval = false;
  form.reset();
  errorMessage(formError, '');
  $('#dialog-title').textContent = camera ? 'Upravit kameru' : 'Přidat kameru';
  $('#password-help').textContent = camera ? 'Prázdné pole ponechá uložené heslo.' : '';
  remove.hidden = !camera;
  remove.textContent = 'Odebrat';
  if (camera) {
    form.elements.name.value = camera.name;
    form.elements.address.value = camera.address;
    form.elements.username.value = camera.username;
  }
  dialog.showModal();
  form.elements.name.focus();
}

function setBusy(value) {
  busy = value;
  for (const button of form.querySelectorAll('button')) button.disabled = value;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  errorMessage(formError, '');
  const fields = new FormData(form);
  const body = { name: fields.get('name').trim(), address: fields.get('address').trim(), username: fields.get('username') };
  if (!editing || fields.get('password')) body.password = fields.get('password');
  try {
    const { camera } = await api(editing ? `/${editing.id}` : '', editing ? 'PUT' : 'POST', body);
    cameras = editing ? cameras.map(item => item.id === camera.id ? camera : item) : [...cameras, camera];
    dialog.close();
    refresh(camera.id);
    $('.edit', tiles.get(camera.id)).focus();
  } catch (error) {
    errorMessage(formError, error.message);
  } finally {
    form.elements.password.value = '';
    setBusy(false);
  }
});

remove.addEventListener('click', async () => {
  if (busy || !editing) return;
  if (!confirmedRemoval) {
    confirmedRemoval = true;
    remove.textContent = 'Potvrdit odebrání';
    return;
  }
  setBusy(true);
  try {
    await api(`/${editing.id}`, 'DELETE');
    cameras = cameras.filter(camera => camera.id !== editing.id);
    dialog.close();
    refresh(editing.id);
    add.focus();
  } catch (error) {
    errorMessage(formError, error.message);
  } finally {
    setBusy(false);
  }
});

dialog.addEventListener('close', () => { form.elements.password.value = ''; });
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
cancel.addEventListener('click', () => dialog.close());
add.addEventListener('click', () => openForm());
exit.addEventListener('click', exitFocus);
layout.addEventListener('click', event => {
  const next = event.target.closest('button')?.dataset.size;
  if (!sizes.has(next)) return;
  size = next;
  savePreference('kamery.size', size);
  syncSize();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && focused && !dialog.open) exitFocus();
});
document.addEventListener('visibilitychange', syncPlayers);

function exitFocus() {
  const previous = focused;
  setFocus(null);
  if (tiles.has(previous)) $('.focus', tiles.get(previous)).focus();
}

syncSize();
if (!session) {
  add.hidden = true;
  $('#camera-count').textContent = 'Otevřete aplikaci pomocí souboru start.cmd.';
} else {
  try {
    ({ cameras } = await api());
    refresh();
  } catch (error) {
    add.hidden = true;
    $('#camera-count').textContent = 'Přehled není dostupný.';
    errorMessage($('#page-error'), error.message);
  }
}
