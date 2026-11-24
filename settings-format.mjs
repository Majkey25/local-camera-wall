export const backupFileLimit = 200 * 1024;
export const backupPasswordMin = 12;
export const backupPasswordMax = 256;

export function normalizeTheme(value) {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function normalizeLanguage(value) {
  return value === 'cs' || value === 'en' ? value : 'system';
}
