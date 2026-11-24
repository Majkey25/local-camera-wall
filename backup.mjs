import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { CameraError, MAX_CAMERAS, cameraPassword, cameraView, idPattern, newCamera } from './camera-store.mjs';
import { normalizeLayout } from './web/layout.mjs';
import { backupPasswordMax, backupPasswordMin, normalizeLanguage, normalizeTheme } from './settings-format.mjs';

const format = 'kamery-backup';
const version = 1;
const aad = Buffer.from(`${format}:${version}`);
const algorithm = 'aes-256-gcm';
const tagLength = 16;
const contentLimit = 144 * 1024;
const deriveKey = promisify(scrypt);
const matchesId = new RegExp(`^${idPattern}$`, 'u');

function invalidBackup() {
  return new CameraError('Soubor není platná záloha aplikace Kamery.');
}

function checkedPassword(password) {
  if (typeof password !== 'string' || password.length > backupPasswordMax || /[\x00-\x1f\x7f]/u.test(password)
    || [...password.trim()].length < backupPasswordMin) {
    throw new CameraError(`Zadejte heslo k záloze o délce alespoň ${backupPasswordMin} znaků bez řídicích znaků.`);
  }
  return password;
}

function keyFor(password, salt) {
  return deriveKey(password, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
}

function decode(value, min, max = min) {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3)) throw invalidBackup();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length < min || bytes.length > max || bytes.toString('base64url') !== value) throw invalidBackup();
  return bytes;
}

export async function exportBackup(cameras, body) {
  const password = checkedPassword(body?.password);
  const layout = normalizeLayout(cameras.map(camera => camera.id), body.layout);
  const theme = normalizeTheme(body.theme);
  const language = normalizeLanguage(body.language);
  const records = [];
  for (const camera of cameras) records.push({ ...cameraView(camera), password: await cameraPassword(camera) });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await keyFor(password, salt);
  try {
    const cipher = createCipheriv(algorithm, key, iv, { authTagLength: tagLength });
    cipher.setAAD(aad);
    const data = Buffer.concat([cipher.update(JSON.stringify({ cameras: records, layout, theme, language }), 'utf8'), cipher.final()]);
    if (data.length > contentLimit) throw new CameraError('Nastavení je pro export příliš velké.');
    return { format, version, salt: salt.toString('base64url'), iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
  } finally {
    key.fill(0);
  }
}

export async function importBackup(body) {
  const password = checkedPassword(body?.password);
  const backup = body.backup;
  if (backup?.format !== format || backup.version !== version) throw invalidBackup();
  const salt = decode(backup.salt, 16);
  const iv = decode(backup.iv, 12);
  const tag = decode(backup.tag, tagLength);
  const data = decode(backup.data, 1, contentLimit);
  const key = await keyFor(password, salt);
  let payload;
  let plaintext;
  try {
    const decipher = createDecipheriv(algorithm, key, iv, { authTagLength: tagLength });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plaintext = decipher.update(data);
    decipher.final();
    payload = JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new CameraError('Heslo nesouhlasí nebo je záloha poškozená.');
  } finally {
    plaintext?.fill(0);
    key.fill(0);
  }

  if (!Array.isArray(payload?.cameras) || payload.cameras.length > MAX_CAMERAS) throw invalidBackup();
  const ids = new Set();
  const cameras = [];
  for (const record of payload.cameras) {
    if (typeof record?.id !== 'string' || !matchesId.test(record.id) || ids.has(record.id)
      || typeof record.password !== 'string') throw invalidBackup();
    ids.add(record.id);
    const camera = await newCamera(record, null, cameras.length);
    cameras.push({ ...camera, id: record.id });
  }
  return { cameras, layout: normalizeLayout([...ids], payload.layout),
    theme: normalizeTheme(payload.theme), language: normalizeLanguage(payload.language) };
}
