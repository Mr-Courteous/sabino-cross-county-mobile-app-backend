import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  GestureResponderEvent,
} from 'react-native';
import {
  ButtonStyles,
  Colors,
  Typography,
  Spacing,
  Animation,
} from '@/constants/design-system';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'premium';
type ButtonSize = 'small' | 'medium' | 'large';

interface CustomButtonProps {
  title: string;
  onPress: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function CustomButton({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  fullWidth = true,
  icon,
  style,
  textStyle,
}: CustomButtonProps) {
  const variantStyle = ButtonStyles[variant];

  const sizeStyles: Record<ButtonSize, ViewStyle> = {
    small: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      minHeight: 40,
    },
    medium: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.xl,
      minHeight: 50,
    },
    large: {
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing['2xl'],
      minHeight: 56,
    },
  };

  return (
    <TouchableOpacity
      style={[
        variantStyle.container,
        sizeStyles[size],
        fullWidth && { alignSelf: 'stretch' },
        disabled && variantStyle.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator
          color={variantStyle.text.color}
          size="small"
        />
      ) : (
        <>
          {icon && icon}
          <Text
            style={[
              variantStyle.text,
              {
                fontSize:
                  size === 'small'
                    ? Typography.fontSize.sm
                    : size === 'large'
                      ? Typography.fontSize.lg
                      : Typography.fontSize.base,
              },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}
