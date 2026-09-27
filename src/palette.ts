export type AppearancePreference = 'light' | 'dark' | 'system';
export const lightColors = {
  bg: '#F5F8F7', card: '#FFFFFF', raised: '#E6F1EE', line: '#D6E3E0',
  text: '#142D36', muted: '#506770', accent: '#006C67', onAccent: '#FFFFFF',
  good: '#006C67', error: '#A12D39', errorSurface: '#FCECEE', badge: '#CFEDE5',
};
export type Palette = typeof lightColors;
export const darkColors: Palette = {
  bg: '#0E1C22', card: '#172D35', raised: '#223E46', line: '#34515A',
  text: '#F5F8F7', muted: '#B1C8CD', accent: '#91DBCE', onAccent: '#142D36',
  good: '#91DBCE', error: '#FFBAC3', errorSurface: '#442832', badge: '#203F40',
};
export function parseAppearance(value: string | null): AppearancePreference {
  return value === 'dark' || value === 'system' ? value : 'light';
}
export function resolveAppearance(preference: AppearancePreference, system: string | null | undefined) {
  return preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
}
