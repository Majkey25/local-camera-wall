import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { cameraView, newCamera, readCameras, rtspAddress, sourceUrl, writeCameras } from '../camera-store.mjs';

const privateIp = [192, 168, 200, 42].join('.');
const publicIp = [203, 0, 113, 42].join('.');
const address = `rtsp://${privateIp}:554/cam/realmonitor?channel=1&subtype=0`;

test('only canonical private IPv4 RTSP addresses without credentials or options are accepted', () => {
  assert.equal(rtspAddress(address), address);
  assert.equal(rtspAddress(`rtsp://${privateIp}/stream1`), `rtsp://${privateIp}/stream1`);
  for (const invalid of [
    `http://${privateIp}/stream`,
    `rtsp://${publicIp}/stream`,
    'rtsp://localhost/stream',
    'rtsp://[::1]/stream',
    `rtsp://username@${privateIp}/stream`,
    `rtsp://0${privateIp}/stream`,
    `rtsp://${privateIp}:65536/stream`,
    `rtsp://${privateIp}/stream#transport=x`,
    `rtsp://${privateIp}/stream%ZZ`,
    `rtsp://${privateIp}/stream\n`,
  ]) assert.throws(() => rtspAddress(invalid));
});

test('DPAPI stays outside the public camera shape and preserves the password across saves', {
  skip: process.platform !== 'win32',
}, async () => {
  await mkdir('.reference/tmp', { recursive: true });
  const directory = await mkdtemp(join('.reference/tmp', 'kamery-test-'));
  const canary = `${randomUUID()}@%/#? Žluťoučký`;
  const username = 'test:user';
  try {
    assert.deepEqual(await readCameras(directory), []);
    const added = await newCamera({ name: 'Example', address, username, password: canary }, null, 0);
    await writeCameras(directory, [added]);
    assert.ok(!(await readFile(join(directory, 'cameras.json'), 'utf8')).includes(canary));
    const [saved] = await readCameras(directory);
    assert.deepEqual(cameraView(saved), { id: added.id, name: 'Example', address, username });
    const url = new URL(await sourceUrl(saved));
    assert.equal(decodeURIComponent(url.password), canary);
    assert.equal(decodeURIComponent(url.username), username);
    const corrected = await newCamera({ name: 'Renamed', address, username }, saved, 0);
    assert.equal(corrected.ciphertext, added.ciphertext);
    await assert.rejects(newCamera({ name: 'Renamed', address, username: 'other-user' }, saved, 0));
    await writeCameras(directory, [corrected]);
    assert.equal((await readCameras(directory))[0].name, 'Renamed');
    await writeCameras(directory, []);
    assert.deepEqual(await readCameras(directory), []);
  } finally {
    await rm(join(directory, 'cameras.json'), { force: true });
    await rmdir(directory);
  }
});
