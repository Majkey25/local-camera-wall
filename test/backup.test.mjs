import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { exportBackup, importBackup } from '../backup.mjs';
import { cameraPassword, newCamera } from '../camera-store.mjs';

test('portable backup authenticates data and re-protects camera passwords on import', { skip: process.platform !== 'win32' }, async () => {
  const password = randomBytes(16).toString('hex');
  const cameraSecret = randomBytes(16).toString('hex');
  const address = ['rtsp://', [10, 0, 0, 1].join('.'), '/stream'].join('');
  const camera = await newCamera({ name: 'Test', address, username: 'test', password: cameraSecret }, null, 0);
  const layout = { order: [camera.id], sizes: { [camera.id]: 0.725 } };
  const backup = await exportBackup([camera], { password, layout, theme: 'dark', language: 'en' });
  const file = JSON.stringify(backup);
  for (const secret of [password, cameraSecret, camera.id, address, camera.ciphertext]) {
    assert(!file.includes(secret));
  }

  await assert.rejects(importBackup({ backup, password: randomBytes(16).toString('hex') }), /poškozená/u);
  const changed = Buffer.from(backup.data, 'base64url');
  changed[0] ^= 1;
  await assert.rejects(importBackup({ backup: { ...backup, data: changed.toString('base64url') }, password }), /poškozená/u);
  const restored = await importBackup({ backup: JSON.parse(file), password });
  assert.deepEqual(restored.layout, layout);
  assert.equal(restored.theme, 'dark');
  assert.equal(restored.language, 'en');
  assert.equal(restored.cameras[0].id, camera.id);
  assert.equal(restored.cameras[0].address, address);
  assert.notEqual(restored.cameras[0].ciphertext, camera.ciphertext);
  assert(await cameraPassword(restored.cameras[0]) === cameraSecret);
});
