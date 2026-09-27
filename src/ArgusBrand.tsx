import { Text, View } from 'react-native';
import { ArgusLogo } from './ArgusLogo';
import { LNbitsLogo } from './LNbitsLogo';
import { useTheme } from './ThemeProvider';

export function ArgusBrand({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  return <View style={{ alignItems: 'center', gap: 6 }}>
    <ArgusLogo size={compact ? 88 : 112} />
    <Text style={{ color: colors.text, fontSize: compact ? 32 : 36, fontWeight: '700' }}>Argus</Text>
    <Text style={{ color: colors.muted, fontSize: 12 }}>by</Text>
    <LNbitsLogo width={compact ? 76 : 88} />
  </View>;
}
