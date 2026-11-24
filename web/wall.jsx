import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resizeStep } from './layout.mjs';

const nativePopover = 'showPopover' in HTMLElement.prototype;
const sizeNames = ['Běžná', 'Větší', 'Největší'];
const statusTexts = {
  loading: 'Připojuji…',
  buffering: 'Čekám na data…',
  error: 'Kamera je nedostupná.',
  credentials: 'Kamera odmítla přihlášení.',
  codec: 'Tento prohlížeč nepodporuje přehrávání.',
};

function SizeSlider({ size, onCommit, t }) {
  const slider = useRef(null);
  useLayoutEffect(() => {
    slider.current.value = size;
  }, [size]);
  useEffect(() => {
    const input = slider.current;
    // Native change waits for release so the moving tile cannot pull the slider away.
    const commit = () => onCommit(input.valueAsNumber);
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, [onCommit]);
  return <input ref={slider} type="range" min="1" max="3" step="1" defaultValue={size}
    aria-valuetext={t(sizeNames[size - 1])}
    onInput={event => event.currentTarget.setAttribute('aria-valuetext', t(sizeNames[event.currentTarget.valueAsNumber - 1]))} />;
}

function Stream({ camera, visible, t }) {
  const picture = useRef(null);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible) return;
    setStatus('loading');
    const player = document.createElement('camera-player');
    player.camera = camera;
    player.addEventListener('playback', event => setStatus(event.detail));
    player.src = `/video/${camera.id}`;
    picture.current.append(player);
    return () => player.remove();
  }, [camera, visible, attempt]);

  return (
    <>
      <div className="picture" ref={picture} />
      <div className="stream-status">
        <span className="status-text" role="status">{statusTexts[status] && t(statusTexts[status])}</span>
        {status === 'error' && <button type="button" className="retry"
          onClick={() => setAttempt(value => value + 1)}>{t('Zkusit znovu')}</button>}
      </div>
    </>
  );
}

function CameraTile({ camera, slot, size, position, total, visible, editing, preview, gesture, fullscreen,
  onMove, onResize, onEdit, onError, t }) {
  const article = useRef(null);
  const menu = useRef(null);
  const opener = useRef(null);
  const details = useRef(null);
  const panelId = `settings-${camera.id}`;
  useLayoutEffect(() => { slot.style.setProperty('--size', size); }, [slot, size]);

  function closeMenu() {
    if (nativePopover) menu.current.hidePopover();
    else details.current.open = false;
  }

  async function toggleFullscreen() {
    closeMenu();
    try {
      if (fullscreen === article.current) await document.exitFullscreen();
      else await article.current.requestFullscreen();
    } catch {
      onError('Celou obrazovku se nepodařilo přepnout.');
    }
  }

  function openOptions(event) {
    if (gesture.skipClick(event)) return;
    opener.current.focus();
    opener.current.click();
  }

  const controls = (
    <>
      {total > 1 && <label>{t('Přesunout na pozici')}
        <select value={position} onChange={event => onMove(camera, Number(event.currentTarget.value))}>
          {Array.from({ length: total }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}
        </select>
      </label>}
      {total > 1 && <label>{t('Velikost záběru')}
        <SizeSlider size={size} t={t} onCommit={next => onResize(camera, next)} />
      </label>}
      <div className="camera-actions">
        {document.fullscreenEnabled && <button type="button" onClick={toggleFullscreen}>
          {t(fullscreen && fullscreen === article.current ? 'Ukončit celou obrazovku' : 'Celá obrazovka')}
        </button>}
        <button type="button" onClick={() => { closeMenu(); onEdit(camera); }}>{t('Upravit kameru')}</button>
      </div>
    </>
  );

  return (
    <article className="camera" ref={article} aria-label={camera.name} data-camera={camera.id}
      data-dragging={preview?.id === camera.id && preview.kind === 'move' || undefined}
      data-drop-target={preview?.target === camera.id || undefined}
      data-resizing={preview?.id === camera.id && preview.kind === 'resize' || undefined}>
      <header className="camera-bar">
        {editing && total > 1 && <button className="handle move-handle" type="button" aria-label={t('Přesunout {name}', { name: camera.name })}
          {...gesture.events} onPointerDown={event => gesture.start(event, 'move', camera, size)} onClick={openOptions}>
          <span aria-hidden="true">⠿</span>
        </button>}
        <h2>{camera.name}</h2>
        {nativePopover ? (
          <>
            <button ref={opener} className="camera-trigger" type="button" popoverTarget={panelId}
              aria-label={t('Nastavení kamery {name}', { name: camera.name })}><span aria-hidden="true">•••</span></button>
            <div ref={menu} id={panelId} className="camera-settings" popover="auto">{controls}</div>
          </>
        ) : (
          <details className="camera-options" ref={details}>
            <summary ref={opener} className="camera-trigger" aria-label={t('Nastavení kamery {name}', { name: camera.name })}>•••</summary>
            <div className="camera-settings">{controls}</div>
          </details>
        )}
      </header>
      <div className="screen">
        <Stream camera={camera} visible={visible} t={t} />
        {editing && total > 1 && <button className="handle resize-handle" type="button"
          aria-label={t('Změnit velikost {name}', { name: camera.name })} {...gesture.events}
          onPointerDown={event => gesture.start(event, 'resize', camera, size)} onClick={openOptions} />}
      </div>
    </article>
  );
}

function useGesture(grid, order, onMove, onResize) {
  const active = useRef(null);
  const consumedClick = useRef(null);
  const [preview, setPreview] = useState(null);

  function start(event, kind, camera, size) {
    if (!event.isPrimary || event.button !== 0 || active.current) return;
    const handle = event.currentTarget;
    consumedClick.current = null;
    const columns = Number(getComputedStyle(grid.current).getPropertyValue('--columns'));
    const track = grid.current.clientWidth / (order.length === 2 ? 8 : columns * 2);
    active.current = { kind, camera, size, track, handle, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, result: null };
    handle.setPointerCapture(event.pointerId);
  }

  function read(event, current) {
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.result && Math.hypot(dx, dy) < 6) return null;
    if (current.kind === 'resize') {
      return { id: current.camera.id, kind: 'resize', size: resizeStep(current.size, dx, dy, current.track) };
    }
    const tile = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-camera]');
    const target = tile && grid.current.contains(tile) && tile.dataset.camera !== current.camera.id ? tile.dataset.camera : null;
    return { id: current.camera.id, kind: 'move', target };
  }

  function update(event) {
    const current = active.current;
    if (current?.pointerId !== event.pointerId) return;
    const next = read(event, current);
    if (!next || (next.size === current.result?.size && next.target === current.result?.target && current.result)) return;
    current.result = next;
    setPreview(next);
  }

  function finish(event, commit) {
    const current = active.current;
    if (!current || (event && event.pointerId !== current.pointerId)) return false;
    const result = commit ? read(event, current) : current.result;
    active.current = null;
    setPreview(null);
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    if (!result) return true;
    consumedClick.current = current.handle;
    if (commit) {
      if (result.kind === 'resize') onResize(current.camera, result.size);
      else if (result.target) onMove(current.camera, order.indexOf(result.target));
    }
    return true;
  }

  return {
    preview, start,
    cancel: () => finish(null, false),
    skipClick: event => {
      if (!event.detail || consumedClick.current !== event.currentTarget) return false;
      consumedClick.current = null;
      return true;
    },
    events: {
      onPointerMove: update,
      onPointerUp: event => finish(event, true),
      onPointerCancel: event => finish(event, false),
      onLostPointerCapture: event => finish(event, false),
    },
  };
}

export function CameraWall({ cameras, layout, editing, onMove, onResize, onEdit, onError, t }) {
  const grid = useRef(null);
  const [slots, setSlots] = useState(new Map());
  const [visible, setVisible] = useState(!document.hidden);
  const [fullscreen, setFullscreen] = useState(document.fullscreenElement);
  const gesture = useGesture(grid, layout.order, onMove, onResize);

  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    const screen = () => setFullscreen(document.fullscreenElement);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('fullscreenchange', screen);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('fullscreenchange', screen);
    };
  }, []);

  useLayoutEffect(() => {
    const wall = grid.current;
    const next = new Map();
    for (const [id, slot] of slots) if (!layout.order.includes(id)) slot.remove();
    layout.order.forEach((id, index) => {
      const slot = slots.get(id) ?? document.createElement('div');
      slot.className = 'camera-slot';
      const reference = wall.children[index] ?? null;
      // React owns each portal, while the wall owns the order of their hosts.
      if (slot !== reference) {
        if (slot.parentNode === wall && 'moveBefore' in wall) wall.moveBefore(slot, reference);
        else {
          const focus = slot.contains(document.activeElement) ? document.activeElement : null;
          wall.insertBefore(slot, reference);
          focus?.focus({ preventScroll: true });
        }
      }
      next.set(id, slot);
    });
    if (next.size !== slots.size || layout.order.some(id => !slots.has(id))) setSlots(next);
  }, [layout.order, slots]);

  function tileSize(id) {
    return gesture.preview?.id === id && gesture.preview.kind === 'resize' ? gesture.preview.size : layout.sizes[id] ?? 1;
  }

  return (
    <section ref={grid} className="grid" aria-label={t('Živé záběry')} data-camera-count={cameras.length}
      style={cameras.length === 2 ? { '--first-size': `${tileSize(layout.order[0])}fr`,
        '--second-size': `${tileSize(layout.order[1])}fr` } : undefined}
      onKeyDown={event => { if (event.key === 'Escape' && gesture.cancel()) event.preventDefault(); }}>
      {cameras.map(camera => {
        const slot = slots.get(camera.id);
        return slot && createPortal(
          <CameraTile camera={camera} slot={slot} size={tileSize(camera.id)} visible={visible} t={t}
            position={layout.order.indexOf(camera.id)} total={cameras.length} editing={editing} fullscreen={fullscreen}
            gesture={gesture} preview={gesture.preview} onMove={onMove} onResize={onResize} onEdit={onEdit} onError={onError} />,
          slot, camera.id,
        );
      })}
    </section>
  );
}
