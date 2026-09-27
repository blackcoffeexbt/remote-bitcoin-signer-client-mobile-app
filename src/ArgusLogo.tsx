import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from './ThemeProvider';

// Same paths as assets/argus-mark.svg: device, secret keyhole and remote dot.
export function ArgusLogo({ size = 56 }: { size?: number }) {
  const { colors, dark } = useTheme();
  return <Svg accessibilityLabel="Argus logo" accessibilityRole="image" width={size} height={size} viewBox="0 0 256 256">
    <Path fill={dark ? colors.accent : '#142D36'} d="M36 207h164v19q0 22-22 22H58q-22 0-22-22z" />
    <Path fill={colors.accent} fillRule="evenodd" d="M60 58h91q6 0 10 4l35 35q4 4 4 11v103q0 22-22 22H58q-22 0-22-22V82q0-24 24-24z M111 144a22 22 0 1 1 18 0l11 44q1 4-4 4h-32q-5 0-4-4z" />
    <Circle fill={colors.accent} cx="194" cy="28" r="21" />
  </Svg>;
}
