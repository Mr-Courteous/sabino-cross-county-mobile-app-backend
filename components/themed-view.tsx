import { View, type ViewProps } from 'react-native';
import { useEffectiveColorScheme } from '@/contexts/theme-context';
import { Colors } from '@/constants/theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  /** 'background' = page bg, 'surface' = card/sheet bg, 'transparent' = no fill */
  variant?: 'background' | 'surface' | 'surfaceElevated' | 'surfaceMuted' | 'transparent';
};

export function ThemedView({
  style,
  lightColor,
  darkColor,
  variant = 'background',
  ...otherProps
}: ThemedViewProps) {
  const scheme = useEffectiveColorScheme();

  let backgroundColor: string;
  if (variant === 'transparent') {
    backgroundColor = 'transparent';
  } else {
    const explicitColor = scheme === 'light' ? lightColor : darkColor;
    backgroundColor =
      explicitColor ??
      (Colors[scheme][variant as keyof (typeof Colors)['light']] as string);
  }

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
