import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { normalizeLayout, moveCamera } from './layout.mjs';
import { CameraWall } from './wall.jsx';
import { session } from './player.js';

const layoutKey = 'kamery.layout';

function readPreference(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

async function api(path = '', method = 'GET', body) {
  const response = await fetch(`/api/cameras${path}`, {
    method,
    headers: { Authorization: `Bearer ${session}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Akci se nepodařilo dokončit.');
  return data;
}

function CameraForm({ camera, onClose, onSave, onRemove }) {
  const dialog = useRef(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { dialog.current.showModal(); }, []);

  async function submit(action, form) {
    setBusy(true);
    setError('');
    try {
      await action();
      dialog.current.close();
    } catch (error) {
      setError(error.message);
    } finally {
      form.elements.password.value = '';
      setBusy(false);
    }
  }

  function save(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const data = { name: fields.get('name').trim(), address: fields.get('address').trim(), username: fields.get('username') };
    if (!camera || fields.get('password')) data.password = fields.get('password');
    void submit(() => onSave(camera, data), form);
  }

  return (
    <dialog ref={dialog} aria-labelledby="form-title" onClose={onClose}
      onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={save}>
        <h2 id="form-title">{camera ? 'Upravit kameru' : 'Přidat kameru'}</h2>
        <label>Název
          <input name="name" required maxLength={60} defaultValue={camera?.name} autoFocus />
        </label>
        <label>Adresa RTSP
          <input name="address" required maxLength={512} spellCheck={false} autoComplete="off" autoCapitalize="off"
            defaultValue={camera?.address} placeholder="rtsp://IP_KAMERY:554/stream1" aria-describedby="address-help" />
        </label>
        <p className="hint" id="address-help">Přihlašovací údaje zadejte do polí níže.</p>
        <div className="fields">
          <label>Uživatelské jméno
            <input name="username" maxLength={128} defaultValue={camera?.username} autoComplete="off"
              spellCheck={false} autoCapitalize="off" />
          </label>
          <label>Heslo kamery
            <input name="password" type="password" maxLength={256} autoComplete="new-password"
              aria-describedby={camera ? 'password-help' : undefined} />
          </label>
        </div>
        {camera && <p className="hint" id="password-help">Prázdné pole ponechá uložené heslo.</p>}
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="dialog-actions">
          {camera && <button className="remove-camera" type="button" disabled={busy} onClick={event => {
            if (!confirmRemoval) setConfirmRemoval(true);
            else void submit(() => onRemove(camera), event.currentTarget.form);
          }}>{confirmRemoval ? 'Potvrdit odebrání' : 'Odebrat'}</button>}
          <button type="button" disabled={busy} onClick={() => dialog.current.close()}>Zrušit</button>
          <button type="submit" disabled={busy}>Uložit</button>
        </div>
      </form>
    </dialog>
  );
}

function App() {
  const [model, setModel] = useState(null);
  const [editor, setEditor] = useState(null);
  const [editingLayout, setEditingLayout] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const addCamera = useRef(null);

  useEffect(() => {
    if (!session) return;
    api().then(({ cameras }) => setModel({
      cameras, layout: normalizeLayout(cameras.map(camera => camera.id), readPreference(layoutKey), readPreference('kamery.widths')),
    })).catch(error => setError(error.message));
  }, []);

  const layout = model?.layout;
  useEffect(() => {
    if (!layout) return;
    try { localStorage.setItem(layoutKey, JSON.stringify(layout)); } catch {}
  }, [layout]);

  function updateCameras(update) {
    setModel(current => {
      const cameras = update(current.cameras);
      return { cameras, layout: normalizeLayout(cameras.map(camera => camera.id), current.layout) };
    });
  }

  async function saveCamera(previous, fields) {
    const { camera } = await api(previous ? `/${previous.id}` : '', previous ? 'PUT' : 'POST', fields);
    updateCameras(cameras => previous ? cameras.map(item => item.id === camera.id ? camera : item) : [...cameras, camera]);
  }

  async function removeCamera(camera) {
    await api(`/${camera.id}`, 'DELETE');
    updateCameras(cameras => cameras.filter(item => item.id !== camera.id));
  }

  function changePosition(camera, position) {
    const next = moveCamera(layout.order, camera.id, position);
    if (next === layout.order) return;
    setModel(current => ({ ...current, layout: { ...current.layout, order: next } }));
    setAnnouncement(`${camera.name}, pozice ${position + 1} z ${next.length}.`);
  }

  function changeSize(camera, size) {
    if ((layout.sizes[camera.id] ?? 1) === size) return;
    setModel(current => {
      const sizes = { ...current.layout.sizes };
      if (size === 1) delete sizes[camera.id];
      else sizes[camera.id] = size;
      return { ...current, layout: { ...current.layout, sizes } };
    });
    setAnnouncement(`Změněna velikost záběru ${camera.name}.`);
  }

  function reset() {
    setModel(current => ({
      ...current, layout: normalizeLayout(current.cameras.map(camera => camera.id), null),
    }));
    setAnnouncement('Rozložení obnoveno.');
  }

  const changed = model && (Object.keys(layout.sizes).length > 0
    || model.cameras.some((camera, index) => camera.id !== layout.order[index]));
  const hasCameras = Boolean(model?.cameras.length);
  return (
    <>
      <header className="toolbar">
        <h1>Kamery</h1>
        {hasCameras && <>
          {editingLayout && <button type="button" onClick={reset} disabled={!changed}>Resetovat rozložení</button>}
          <button className={editingLayout ? 'is-editing' : undefined} type="button"
            onClick={() => setEditingLayout(value => !value)}>
            {editingLayout ? 'Hotovo' : 'Upravit rozložení'}
          </button>
        </>}
        {model && (!editingLayout || !hasCameras)
          && <button type="button" ref={addCamera} onClick={() => setEditor({ camera: null })}>Přidat kameru</button>}
      </header>
      <main className="feed">
        {!session && <p className="page-message" role="status">Otevřete aplikaci pomocí souboru start.cmd.</p>}
        {session && !model && !error && <p className="page-message" role="status">Načítám kamery…</p>}
        {error && <p className="page-message alert" role="alert">{error}</p>}
        {model && !hasCameras && <p className="page-message">Přidejte první kameru.</p>}
        {model && <CameraWall cameras={model.cameras} layout={layout} editing={editingLayout}
          onMove={changePosition} onResize={changeSize} onEdit={camera => setEditor({ camera })} onError={setError} />}
        <p className="visually-hidden" role="status">{announcement}</p>
      </main>
      {editor && <CameraForm camera={editor.camera} onSave={saveCamera} onRemove={removeCamera}
        onClose={() => {
          setEditor(null);
          if (!document.activeElement || document.activeElement === document.body) addCamera.current?.focus();
        }} />}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
