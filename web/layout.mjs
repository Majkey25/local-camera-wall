export function normalizeLayout(ids, previous, legacyWidths = []) {
  const valid = new Set(ids);
  const savedOrder = Array.isArray(previous?.order) ? previous.order : [];
  const savedSizes = previous?.sizes ?? previous ?? Object.fromEntries(
    Array.isArray(legacyWidths) ? legacyWidths.filter(id => typeof id === 'string').map(id => [id, 2]) : [],
  );
  const order = [...new Set([...savedOrder.filter(id => valid.has(id)), ...ids])];
  const sizes = Object.fromEntries(ids
    .filter(id => savedSizes[id] === 2 || savedSizes[id] === 3)
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

export function resizeStep(initial, dx, dy, track) {
  const vertical = dy * 16 / 9;
  const distance = Math.abs(dx) >= Math.abs(vertical) ? dx : vertical;
  return Math.max(1, Math.min(3, initial + Math.round(distance / track)));
}
