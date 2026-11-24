import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_CAMERAS = 24;
const helper = fileURLToPath(new URL('./dpapi.ps1', import.meta.url));
export const idPattern = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const idMatcher = new RegExp(`^${idPattern}$`, 'u');

export class CameraError extends Error {}

export function rtspAddress(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\s\x00-\x1f\x7f\\#]|%(?![\da-f]{2})/iu.test(value)) {
    throw new CameraError('Zadejte adresu RTSP bez mezer a přihlašovacích údajů.');
  }
  const parts = /^rtsp:\/\/([0-9.]+)(?::([1-9][0-9]{0,4}))?(\/[^#]*)?$/u.exec(value);
  if (!parts || !isIPv4(parts[1]) || Number(parts[2]) > 65535) {
    throw new CameraError('Zadejte RTSP adresu s číselnou IPv4 adresou kamery.');
  }
  const [first, second] = parts[1].split('.').map(Number);
  const privateIp = first === 10 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
  if (!privateIp) {
    throw new CameraError('Adresa kamery musí být z privátní sítě.');
  }
  return value;
}

export function windowsProfile(operation, value) {
  return new Promise((resolve, reject) => {
    const windowsPowerShell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0');
    const powershell = join(windowsPowerShell, 'powershell.exe');
    const child = execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', helper, operation], {
      windowsHide: true, timeout: 10_000, maxBuffer: 8192,
      env: { ...process.env, PSModulePath: join(windowsPowerShell, 'Modules') },
    }, (error, stdout) => {
      if (error || !stdout) reject(new CameraError(operation === 'profile'
        ? 'Windows nemůže zabezpečit místní profil aplikace.'
        : 'Windows nemůže uložit nebo otevřít heslo kamery.'));
      else resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(value, 'utf8');
  });
}

export function cameraView({ id, name, address, username }) {
  return { id, name, address, username };
}

export async function readCameras(directory) {
  await mkdir(directory, { recursive: true });
  let raw;
  try {
    raw = JSON.parse(await readFile(join(directory, 'cameras.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new CameraError('Soubor s kamerami nelze přečíst.');
  }
  if (!Array.isArray(raw) || raw.length > MAX_CAMERAS) throw new CameraError('Soubor s kamerami má neplatný formát.');
  const ids = new Set();
  const slots = new Set();
  for (const camera of raw) {
    if (!camera || typeof camera.id !== 'string' || !idMatcher.test(camera.id) || ids.has(camera.id)
      || !Number.isInteger(camera.slot) || camera.slot < 0 || camera.slot >= MAX_CAMERAS || slots.has(camera.slot)
      || typeof camera.name !== 'string' || typeof camera.username !== 'string'
      || (camera.ciphertext !== '' && (typeof camera.ciphertext !== 'string' || !/^[a-f0-9]+$/iu.test(camera.ciphertext)))) {
      throw new CameraError('Soubor s kamerami má neplatný záznam.');
    }
    rtspAddress(camera.address);
    ids.add(camera.id);
    slots.add(camera.slot);
  }
  return raw;
}

export async function writeCameras(directory, cameras) {
  const temporary = join(directory, `cameras-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(cameras, null, 2), { flag: 'wx' });
  try {
    await rename(temporary, join(directory, 'cameras.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function newCamera(body, previous, slot) {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 60) {
    throw new CameraError('Zadejte název kamery do 60 znaků.');
  }
  const address = rtspAddress(body.address);
  if (typeof body.username !== 'string' || body.username.length > 128 || /[\x00-\x1f\x7f]/u.test(body.username)) {
    throw new CameraError('Uživatelské jméno kamery je neplatné.');
  }
  const userChanged = previous && (new URL(address).host !== new URL(previous.address).host || body.username !== previous.username);
  if (body.password === undefined && userChanged && previous.ciphertext) {
    throw new CameraError('Při změně adresy nebo uživatele zadejte heslo znovu.');
  }
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 256
    || /[\x00-\x1f\x7f]/u.test(body.password) || (body.password && !body.username))) {
    throw new CameraError('Zadejte platné heslo a uživatelské jméno.');
  }
  const ciphertext = body.password === undefined ? previous?.ciphertext ?? ''
    : body.password ? await windowsProfile('protect', body.password) : '';
  return { id: previous?.id ?? randomUUID(), slot, name: body.name.trim(), address, username: body.username, ciphertext };
}

export async function sourceUrl(camera) {
  if (!camera.username) return rtspAddress(camera.address);
  const password = camera.ciphertext ? await windowsProfile('unprotect', camera.ciphertext) : '';
  const userinfo = `${encodeURIComponent(camera.username)}:${encodeURIComponent(password)}@`;
  return `rtsp://${userinfo}${rtspAddress(camera.address).slice('rtsp://'.length)}`;
}
