export const minSize = 0.5;
export const maxSize = 3;

export function normalizeLayout(ids, previous, legacyWidths = []) {
  const valid = new Set(ids);
  const savedOrder = Array.isArray(previous?.order) ? previous.order : [];
  const savedSizes = previous?.sizes ?? previous ?? Object.fromEntries(
    Array.isArray(legacyWidths) ? legacyWidths.filter(id => typeof id === 'string').map(id => [id, 2]) : [],
  );
  const order = [...new Set([...savedOrder.filter(id => valid.has(id)), ...ids])];
  const sizes = Object.fromEntries(ids
    .filter(id => Number.isFinite(savedSizes[id]) && savedSizes[id] >= minSize
      && savedSizes[id] <= maxSize && savedSizes[id] !== 1)
    .map(id => [id, savedSizes[id]]));
  return { order, sizes };
}

export function moveCamera(order, id, targetIndex) {
  const index = order.indexOf(id);
  if (index < 0 || !Number.isInteger(targetIndex) || targetIndex < 0
      || targetIndex >= order.length || targetIndex === index) return order;
  const next = [...order];
  next.splice(index, 1);
  next.splice(targetIndex, 0, id);
  return next;
}

export function resizeWidth(initial, dx, dy, aspectRatio) {
  // Project the pointer onto the corner's path at the video's aspect ratio.
  const slope = 1 / aspectRatio;
  return initial + (dx + dy * slope) / (1 + slope * slope);
}
