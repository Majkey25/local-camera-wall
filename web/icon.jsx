const strokes = {
  layout: 'M3 4h11v16H3z M17 4h4v7h-4z M17 14h4v6h-4z',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  check: 'm5 12 4 4L19 6',
  settings: 'M4 6h10m4 0h2 M4 12h3m4 0h9 M4 18h10m4 0h2 M14 4v4m-7 2v4m7 2v4',
  reset: 'M4 10a8 8 0 1 1 2 7 M4 4v6h6',
  expand: 'M9 4H4v5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  collapse: 'M4 9h5V4 M20 9h-5V4 M15 20v-5h5 M9 20v-5H4',
  more: 'M5.8 12h.4 M11.8 12h.4 M17.8 12h.4',
  grip: 'M8.8 5h.4 M14.8 5h.4 M8.8 12h.4 M14.8 12h.4 M8.8 19h.4 M14.8 19h.4',
  resize: 'M7 17 17 7 M7 12v5h5 M12 7h5v5',
  pencil: 'm5 16 10-10 3 3-10 10H5z M14 7l3 3',
  camera: 'M3 7h12v10H3z M15 10l6-3v10l-6-3',
  signal: 'M4 18h.1 M9 14v4 M14 10v8 M19 6v12',
  offline: 'M4 18h.1 M9 14v4 M14 10v8 M19 6v12 M3 3l18 18',
  monitor: 'M3 4h18v13H3z M12 17v4 M8 21h8',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z M12 2v2m0 16v2 M2 12h2m16 0h2 M5 5l1.4 1.4m11.2 11.2L19 19 M19 5l-1.4 1.4M6.4 17.6 5 19',
  moon: 'M20 15A8.5 8.5 0 0 1 9 4a8.5 8.5 0 1 0 11 11Z',
  upload: 'M12 16V4m-5 5 5-5 5 5 M4 16v4h16v-4',
  download: 'M12 4v12m-5-5 5 5 5-5 M4 16v4h16v-4',
};

export function Icon({ name }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={name === 'grip' || name === 'more' ? 2.6 : 1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={strokes[name]} />
    </svg>
  );
}
