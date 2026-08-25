import React, { useState } from 'react';
import { TextInput, View, Text, TouchableOpacity, StyleSheet, ViewStyle, TextInputProps, useWindowDimensions } from 'react-native';
import { InputStyle, Colors, Typography, Spacing } from '@/constants/design-system';

interface CustomInputProps extends TextInputProps { label?: string; placeholder?: string; error?: string; isPassword?: boolean; containerStyle?: ViewStyle; inputStyle?: any; icon?: React.ReactNode; rightIcon?: React.ReactNode; helperText?: string; }

export function CustomInput({ label, placeholder, error, isPassword = false, containerStyle, inputStyle, icon, rightIcon, helperText, value, onChangeText, ...props }: CustomInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { width } = useWindowDimensions();
  const isTiny = width < 300;

  return (
    <View style={[styles.wrapper, { marginBottom: isTiny ? 12 : 16 }, containerStyle]}>
      {label && <Text style={[styles.label, { fontSize: isTiny ? 11 : 12, color: error ? Colors.error : Colors.text.primary }]}>{label}</Text>}
      <View style={[InputStyle.container, isFocused && InputStyle.focused, error && InputStyle.error, styles.inputContainer, { paddingHorizontal: isTiny ? 10 : 16 }]}>
        {icon && <View style={styles.iconLeft}>{icon}</View>}
        <TextInput
          style={[styles.input, { color: Colors.text.primary, fontSize: isTiny ? 13 : 14, paddingVertical: isTiny ? 10 : 12 }, inputStyle]}
          placeholder={placeholder} placeholderTextColor={InputStyle.placeholder} secureTextEntry={isPassword && !showPassword}
          value={value} onChangeText={onChangeText} onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)} {...props}
        />
        {isPassword ? (
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)}><Text style={{ fontSize: 16 }}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text></TouchableOpacity>
        ) : (rightIcon && <View style={styles.iconRight}>{rightIcon}</View>)}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  label: { fontWeight: '600', marginBottom: 6, letterSpacing: 0.3 },
  inputContainer: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, fontWeight: '400' },
  iconLeft: { marginRight: 8 },
  iconRight: { marginLeft: 8 },
  errorText: { color: Colors.error, fontSize: 10, marginTop: 4, fontWeight: '500' },
});
