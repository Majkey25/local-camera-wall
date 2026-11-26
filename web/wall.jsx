import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { maxSize, minSize, resizeWidth } from './layout.mjs';
import { Icon } from './icon.jsx';

const nativePopover = 'showPopover' in HTMLElement.prototype;
const firstRetryDelay = 2000;
const maxRetryDelay = 60_000;
const stablePlaybackTime = 30_000;
const statusTexts = {
  live: 'Živě',
  paused: 'Přehrávání je pozastavené.',
  loading: 'Připojuji…',
  buffering: 'Čekám na data…',
  error: 'Kamera je nedostupná.',
  credentials: 'Kamera odmítla přihlášení.',
  codec: 'Tento prohlížeč nepodporuje přehrávání.',
};

function SizeSlider({ size, maximum, onCommit }) {
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
  return <input ref={slider} type="range" min={minSize} max={maximum} step="0.01" defaultValue={size} />;
}

function Stream({ camera, visible, status, onStatus, onAspectRatio, t }) {
  const picture = useRef(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const mount = picture.current;
    let player;
    let retryTimer;
    let retryDelay = firstRetryDelay;
    function connect() {
      let liveSince;
      retryTimer = undefined;
      player?.remove();
      onStatus('loading');
      player = document.createElement('camera-player');
      player.camera = camera;
      player.addEventListener('playback', ({ detail }) => {
        onStatus(detail);
        if (detail === 'live') liveSince ??= performance.now();
        if (detail === 'error' && retryTimer === undefined) {
          if (liveSince !== undefined && performance.now() - liveSince >= stablePlaybackTime) {
            retryDelay = firstRetryDelay;
          }
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
        }
      });
      player.addEventListener('aspect-ratio', event => onAspectRatio(event.detail));
      player.src = `/video/${camera.id}`;
      mount.append(player);
    }
    connect();
    return () => {
      clearTimeout(retryTimer);
      player.remove();
    };
  }, [camera, visible, attempt, onStatus, onAspectRatio]);

  const waiting = status === 'loading' || status === 'buffering';

  return (
    <>
      <div className="picture" ref={picture} />
      <div className="stream-status">
        <span className={status === 'live' ? 'visually-hidden' : 'status-text'} role="status">
          {status !== 'live' && <Icon name={waiting ? 'signal' : 'offline'} />}
          {t(statusTexts[status])}
        </span>
        {status === 'error' && <button type="button" className="retry"
          onClick={() => setAttempt(value => value + 1)}><Icon name="reset" />{t('Zkusit znovu')}</button>}
      </div>
    </>
  );
}

function CameraTile({ camera, slot, size, maximum, position, total, visible, gesture, fullscreen,
  onMove, onResize, onEdit, onError, t }) {
  const article = useRef(null);
  const menu = useRef(null);
  const opener = useRef(null);
  const details = useRef(null);
  const [playback, setPlayback] = useState('loading');
  const [aspectRatio, setAspectRatio] = useState(null);
  const status = visible ? playback : 'paused';
  const expanded = fullscreen !== null && fullscreen === article.current;
  const leftCorner = total === 2 && position === 1;
  const fullscreenLabel = t(expanded ? 'Ukončit celou obrazovku' : 'Celá obrazovka');
  const panelId = `settings-${camera.id}`;
  useLayoutEffect(() => { slot.style.setProperty('--size', size); }, [slot, size]);
  useLayoutEffect(() => {
    if (total < 3 || expanded) return;
    const rowHeight = Number.parseFloat(getComputedStyle(slot.parentElement).gridAutoRows);
    const fitRows = () => {
      const rows = String(Math.ceil(slot.getBoundingClientRect().height / rowHeight));
      if (slot.style.getPropertyValue('--rows') !== rows) slot.style.setProperty('--rows', rows);
    };
    fitRows();
    const observer = new ResizeObserver(fitRows);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot, total, expanded]);

  function closeMenu() {
    if (nativePopover) {
      if (menu.current.matches(':popover-open')) menu.current.hidePopover();
    } else details.current.open = false;
  }

  async function toggleFullscreen() {
    closeMenu();
    try {
      if (expanded) await document.exitFullscreen();
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

  function moveByKey(event) {
    const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    onMove(camera, position + delta);
  }

  const controls = (
    <>
      {total > 1 && <label>{t('Přesunout na pozici')}
        <select value={position} onChange={event => onMove(camera, Number(event.currentTarget.value))}>
          {Array.from({ length: total }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}
        </select>
      </label>}
      <label>{t('Velikost záběru')}
        <SizeSlider size={size} maximum={maximum} onCommit={next => onResize(camera, next)} />
      </label>
      <div className="camera-actions">
        {document.fullscreenEnabled && <button type="button" onClick={toggleFullscreen}>
          <Icon name={expanded ? 'collapse' : 'expand'} />{fullscreenLabel}
        </button>}
        <button type="button" onClick={() => { closeMenu(); onEdit(camera); }}><Icon name="pencil" />{t('Upravit kameru')}</button>
      </div>
    </>
  );
  const corner = <button className="handle resize-handle" type="button" title={t('Změnit velikost {name}', { name: camera.name })}
    aria-label={t('Změnit velikost {name}', { name: camera.name })} onClick={openOptions}><Icon name="resize" /></button>;

  return (
    <article className="camera" ref={article} aria-label={camera.name} data-camera={camera.id} data-stream-state={status}
      style={aspectRatio ? { '--feed-ratio': aspectRatio } : undefined}
      {...gesture.events} onPointerDown={event => {
        if (expanded) return;
        const control = event.target.closest('button, summary, input, select, a');
        if (control?.matches('.resize-handle')) {
          gesture.start(event, 'resize', camera, control, size, maximum);
        } else if (total > 1 && (!control || control.matches('.move-handle'))
          && (event.target.closest('.camera-bar') || (event.pointerType === 'mouse' && event.target.closest('.screen')))) {
          gesture.start(event, 'move', camera, control ?? event.currentTarget, size, maximum);
        }
      }}>
      <header className="camera-bar" data-movable={total > 1 && !expanded || undefined}>
        {total > 1 && !expanded && <button className="handle move-handle" type="button" aria-label={t('Přesunout {name}', { name: camera.name })}
          title={t('Přesunout {name}', { name: camera.name })} onKeyDown={moveByKey} onClick={openOptions}>
          <Icon name="grip" />
        </button>}
        <span className="camera-signal" aria-hidden="true" title={t(statusTexts[status])} />
        <h2 title={camera.name}>{camera.name}</h2>
        {document.fullscreenEnabled && <button className="camera-trigger fullscreen-trigger" type="button"
          aria-label={fullscreenLabel} title={fullscreenLabel} onClick={toggleFullscreen}>
          <Icon name={expanded ? 'collapse' : 'expand'} />
        </button>}
        {nativePopover ? (
          <>
            <button ref={opener} className="camera-trigger" type="button" popoverTarget={panelId}
              aria-label={t('Nastavení kamery {name}', { name: camera.name })}
              title={t('Nastavení kamery {name}', { name: camera.name })}><Icon name="more" /></button>
            <div ref={menu} id={panelId} className="camera-settings" popover="auto">{controls}</div>
          </>
        ) : (
          <details className="camera-options" ref={details}>
            <summary ref={opener} className="camera-trigger" aria-label={t('Nastavení kamery {name}', { name: camera.name })}>
              <Icon name="more" />
            </summary>
            <div className="camera-settings">{controls}</div>
          </details>
        )}
      </header>
      <div className="screen">
        <Stream camera={camera} visible={visible} status={status} onStatus={setPlayback}
          onAspectRatio={setAspectRatio} t={t} />
      </div>
      {!expanded && <footer className="size-controls">
        {leftCorner && corner}
        <button className="camera-trigger" type="button" disabled={size <= minSize}
          aria-label={t('Zmenšit {name}', { name: camera.name })} title={t('Zmenšit {name}', { name: camera.name })}
          onClick={() => onResize(camera, Math.max(minSize, Math.ceil(size) - 1))}><Icon name="minus" /></button>
        <button className="camera-trigger" type="button" disabled={size >= maximum}
          aria-label={t('Zvětšit {name}', { name: camera.name })} title={t('Zvětšit {name}', { name: camera.name })}
          onClick={() => onResize(camera, Math.min(maximum, Math.floor(size) + 1))}><Icon name="plus" /></button>
        {!leftCorner && corner}
      </footer>}
    </article>
  );
}

function useGesture(grid, layout, onMove, onResize) {
  const active = useRef(null);
  const consumedClick = useRef(null);
  const released = useRef(null);
  const { order, sizes } = layout;

  useLayoutEffect(() => () => { finish(null, false); }, [layout]);

  function start(event, kind, camera, handle, size, maximum) {
    if (!event.isPrimary || event.button !== 0 || active.current) return;
    const wall = grid.current;
    const tile = event.currentTarget;
    for (const animation of tile.getAnimations()) animation.cancel();
    const rect = tile.getBoundingClientRect();
    const wallRect = wall.getBoundingClientRect();
    const gridStyle = getComputedStyle(wall);
    const seam = Number.parseFloat(gridStyle.getPropertyValue('--seam'));
    const pair = order.length === 2;
    const right = pair && order[1] === camera.id;
    const otherSize = pair ? sizes[order[right ? 0 : 1]] ?? 1 : 1;
    const width = wallRect.width - (order.length > 1 ? seam : 0);
    const availableRight = wallRect.left + width - rect.left;
    const span = Number(gridStyle.getPropertyValue('--columns'));
    const units = Number(gridStyle.getPropertyValue('--units-per-size'));
    const offset = Number(gridStyle.getPropertyValue('--base-units'));
    const aspectRatio = Number(getComputedStyle(tile).getPropertyValue('--feed-ratio'));

    consumedClick.current = null;
    active.current = { kind, camera, handle, tile, wall, maximum, initialSize: size, initialWidth: rect.width,
      pointerId: event.pointerId, x: event.pageX, y: event.pageY, pair, right, otherSize, width, availableRight,
      span, units, offset, seam, aspectRatio, target: null, result: null, frame: 0 };
    handle.setPointerCapture(event.pointerId);
    (kind === 'move' ? tile.querySelector('.move-handle') : handle).focus({ preventScroll: true });
  }

  function paint(event, current) {
    const dx = event.pageX - current.x;
    const dy = event.pageY - current.y;
    if (!current.result && Math.hypot(dx, dy) < 4) return;
    const { tile, wall } = current;
    if (current.kind === 'resize') {
      const { maximum, initialWidth, width, availableRight, pair, right, otherSize, span, units, offset, seam } = current;
      const desired = resizeWidth(initialWidth, right ? -dx : dx, dy, current.aspectRatio);
      let size;
      if (pair) {
        // Two feeds share the row using proportional column weights.
        const fraction = Math.max(0, Math.min(1, desired / width));
        size = otherSize * fraction / (1 - fraction);
      } else if (span > 1) {
        size = ((desired + seam) * span / (width + seam) - offset) / units;
      } else {
        size = desired / width;
      }
      size = Math.max(minSize, Math.min(maximum, size));
      if (!current.result) tile.dataset.resizing = '';
      current.result = { size };
      if (pair) {
        wall.style.setProperty(right ? '--preview-second' : '--preview-first', `${size}fr`);
      } else {
        const pixels = span > 1 ? (width + seam) * (size * units + offset) / span - seam : width * size;
        tile.style.setProperty('--preview-width', `${pixels}px`);
        tile.style.setProperty('--resize-shift', `${Math.min(0, availableRight - pixels)}px`);
      }
      return;
    }
    const target = document.elementsFromPoint(event.clientX, event.clientY)
      .map(element => element.closest('.camera'))
      .find(candidate => candidate && candidate !== tile && wall.contains(candidate));
    if (target !== current.target) {
      current.target?.removeAttribute('data-drop-target');
      target?.setAttribute('data-drop-target', '');
      current.target = target;
    }
    if (!current.result) tile.dataset.dragging = '';
    current.result = { target };
    tile.style.translate = `${dx}px ${dy}px`;
  }

  function update(event) {
    const current = active.current;
    if (current?.pointerId !== event.pointerId) return;
    current.event = event;
    if (!current.frame) current.frame = requestAnimationFrame(() => {
      current.frame = 0;
      paint(current.event, current);
    });
  }

  function finish(event, commit) {
    const current = active.current;
    if (!current || (event && event.pointerId !== current.pointerId)) return false;
    active.current = null;
    cancelAnimationFrame(current.frame);
    if (commit) paint(event, current);
    const { result, tile, wall } = current;
    if (commit && result?.target) released.current = { tile, rect: tile.getBoundingClientRect() };
    current.target?.removeAttribute('data-drop-target');
    tile.removeAttribute('data-dragging');
    tile.removeAttribute('data-resizing');
    tile.style.removeProperty('translate');
    tile.style.removeProperty('--preview-width');
    tile.style.removeProperty('--resize-shift');
    wall.style.removeProperty('--preview-first');
    wall.style.removeProperty('--preview-second');
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    if (!result) return true;
    consumedClick.current = current.handle;
    if (commit && current.kind === 'resize') {
      const size = Math.round(result.size * 10_000) / 10_000;
      if (size !== current.initialSize) onResize(current.camera, size);
    } else if (commit && result.target) {
      onMove(current.camera, order.indexOf(result.target.dataset.camera));
    }
    return true;
  }

  return {
    released, start,
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

export function CameraWall({ cameras, layout, onMove, onResize, onEdit, onError, t }) {
  const grid = useRef(null);
  const [slots, setSlots] = useState(new Map());
  const [visible, setVisible] = useState(!document.hidden);
  const [fullscreen, setFullscreen] = useState(document.fullscreenElement);
  const gesture = useGesture(grid, layout, onMove, onResize);

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

  const { released } = gesture;
  useLayoutEffect(() => {
    const drop = released.current;
    released.current = null;
    if (!drop || !drop.tile.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = drop.tile.getBoundingClientRect();
    drop.tile.animate({ translate: [`${drop.rect.x - rect.x}px ${drop.rect.y - rect.y}px`, '0 0'] },
      { duration: 150, easing: 'ease-out' });
  }, [layout.order, released]);

  const maximum = cameras.length === 1 ? 1 : maxSize;
  return (
    <section ref={grid} className="grid" aria-label={t('Živé záběry')} data-camera-count={cameras.length}
      style={cameras.length === 2 ? { '--first-size': `${layout.sizes[layout.order[0]] ?? 1}fr`,
        '--second-size': `${layout.sizes[layout.order[1]] ?? 1}fr` } : undefined}
      onKeyDown={event => { if (event.key === 'Escape' && gesture.cancel()) event.preventDefault(); }}>
      {cameras.map(camera => {
        const slot = slots.get(camera.id);
        return slot && createPortal(
          <CameraTile camera={camera} slot={slot} size={Math.min(maximum, layout.sizes[camera.id] ?? 1)}
            maximum={maximum} visible={visible} t={t}
            position={layout.order.indexOf(camera.id)} total={cameras.length} fullscreen={fullscreen}
            gesture={gesture} onMove={onMove} onResize={onResize} onEdit={onEdit} onError={onError} />,
          slot, camera.id,
        );
      })}
    </section>
  );
}
