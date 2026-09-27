import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClientProvider, useClient } from '../ClientProvider';
import { WalletProvider } from '../WalletProvider';
import { useUI } from '../ui';
import { ThemeProvider } from '../ThemeProvider';
import { ArgusLogo } from '../ArgusLogo';
void SplashScreen.preventAutoHideAsync().catch(() => {});
function Navigation() {
  const c = useClient();
  const { colors, dark, ready } = useUI();
  useEffect(() => { if (ready) void SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><ArgusLogo size={112} /><Text style={{ color: colors.text, fontSize: 36, fontWeight: '700' }}>Argus</Text></View>;
  return <View style={{ flex: 1, backgroundColor: colors.bg }}><StatusBar style={dark ? 'light' : 'dark'} /><Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerShadowVisible: false, contentStyle: { backgroundColor: colors.bg }, headerBackTitle: 'Back', headerTitle: '' }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
  </Stack>{!c.foreground && <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}><ArgusLogo size={64} /><Text style={{ color: colors.text, fontSize: 20 }}>Argus paused</Text></View>}</View>;
}
export default function RootLayout() { return <SafeAreaProvider><ThemeProvider><ClientProvider><WalletProvider><Navigation /></WalletProvider></ClientProvider></ThemeProvider></SafeAreaProvider>; }
