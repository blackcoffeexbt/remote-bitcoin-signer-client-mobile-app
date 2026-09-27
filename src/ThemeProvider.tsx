import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { darkColors, lightColors, parseAppearance, resolveAppearance } from './palette';
import type { AppearancePreference } from './palette';

const preferenceKey = 'argus.appearance.v1';
const ThemeContext = createContext({
  colors: lightColors, dark: false, ready: false, saving: false, error: '',
  preference: 'light' as AppearancePreference,
  setPreference: async (_value: AppearancePreference) => { void _value; },
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, updatePreference] = useState<AppearancePreference>('light');
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const writing = useRef(false);
  const dark = resolveAppearance(preference, system) === 'dark';
  const colors = dark ? darkColors : lightColors;
  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(preferenceKey).then(value => {
      if (active) updatePreference(parseAppearance(value));
    }).catch(() => {
      if (active) setError('Could not load your appearance preference.');
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    // Native dialogs and keyboards follow the selected appearance too.
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  }, [preference, ready]);
  useEffect(() => { void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {}); }, [colors.bg]);
  const value = useMemo(() => ({
    colors, dark, ready, saving, error, preference,
    setPreference: async (next: AppearancePreference) => {
      if (!ready || writing.current) return;
      writing.current = true; setSaving(true); setError('');
      try {
        await SecureStore.setItemAsync(preferenceKey, next);
        updatePreference(next);
      } catch { setError('Could not save your appearance. Please try again.'); }
      finally { writing.current = false; setSaving(false); }
    },
  }), [colors, dark, ready, saving, error, preference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme() { return useContext(ThemeContext); }
