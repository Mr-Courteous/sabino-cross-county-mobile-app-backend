import React from 'react';
import {
  View,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import {
  CardStyle,
  Spacing,
} from '@/constants/design-system';

type CardVariant = 'default' | 'small' | 'subtle';

interface CustomCardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  style?: ViewStyle;
  onPress?: () => void;
}

export function CustomCard({
  children,
  variant = 'default',
  style,
  onPress,
}: CustomCardProps) {
  const variantStyles: Record<CardVariant, ViewStyle> = {
    default: CardStyle.container,
    small: CardStyle.containerSmall,
    subtle: CardStyle.containerSubtle,
  };

  const Component = onPress ? require('react-native').TouchableOpacity : View;

  return (
    <Component
      style={[variantStyles[variant], style]}
      {...(onPress && { onPress })}
    >
      {children}
    </Component>
  );
}

const styles = StyleSheet.create({});
