import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle, Animated, Dimensions, BackHandler, Platform, useWindowDimensions, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, Typography, Colors, BorderRadius } from '@/constants/design-system';

type AlertType = 'success' | 'error' | 'warning' | 'info';
interface CustomAlertProps { type?: AlertType; title?: string; message: string; onClose?: () => void; onConfirm?: () => void; confirmLabel?: string; showCloseButton?: boolean; style?: ViewStyle; icon?: boolean; }

const alertIcons: Record<AlertType, keyof typeof Ionicons.glyphMap> = { success: 'checkmark-circle', error: 'alert-circle', warning: 'warning', info: 'information-circle' };
const alertColors: Record<AlertType, string> = { success: '#22C55E', error: '#EF4444', warning: '#F59E0B', info: '#3B82F6' };

export function CustomAlert({ type = 'info', title, message, onClose, onConfirm, confirmLabel = 'OK', showCloseButton = true, style, icon = true }: CustomAlertProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTiny = width < 300;
  const slideAnim = useRef(new Animated.Value(height)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, damping: 20, stiffness: 150, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    if (Platform.OS === 'android') {
      const handler = BackHandler.addEventListener('hardwareBackPress', () => { onClose?.(); return true; });
      return () => handler.remove();
    }
  }, []);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: height, duration: 200, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose?.());
  };

  const alertColor = alertColors[type];

  return (
    <Modal
      transparent
      visible={true}
      animationType="none"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}><TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} /></Animated.View>
        <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }], paddingBottom: Math.max(insets.bottom, 16) }, style]}>
          <View style={styles.dragHandleContainer}><View style={styles.dragHandle} /></View>
          <View style={styles.content}>
            {icon && !isTiny && <View style={[styles.iconBox, { backgroundColor: `${alertColor}15` }]}><Ionicons name={alertIcons[type]} size={28} color={alertColor} /></View>}
            <View style={styles.textBox}>
              {title && <Text style={[styles.title, { fontSize: isTiny ? 15 : 16 }]}>{title}</Text>}
              <Text style={[styles.message, { fontSize: isTiny ? 12 : 13 }]}>{message}</Text>
            </View>
            {showCloseButton && <TouchableOpacity onPress={handleClose}><Ionicons name="close" size={18} color="rgba(255,255,255,0.4)" /></TouchableOpacity>}
          </View>
          <View style={styles.actions}>
            {onConfirm ? (
              <>
                <TouchableOpacity style={styles.btnCancel} onPress={handleClose}><Text style={styles.btnCancelText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.btnConfirm, { backgroundColor: alertColor }]} onPress={() => { onConfirm(); handleClose(); }}><Text style={styles.btnText}>{confirmLabel}</Text></TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[styles.btnSingle, { backgroundColor: alertColor }]} onPress={handleClose}><Text style={styles.btnText}>{confirmLabel || 'OK'}</Text></TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 1000 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  container: { backgroundColor: '#1E293B', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12 },
  dragHandleContainer: { alignItems: 'center', marginBottom: 16 },
  dragHandle: { width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2 },
  content: { flexDirection: 'row', alignItems: 'flex-start' },
  iconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  textBox: { flex: 1, paddingRight: 8 },
  title: { fontWeight: '700', color: '#fff', marginBottom: 4 },
  message: { color: 'rgba(255,255,255,0.6)', lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20, marginBottom: 4 },
  btnCancel: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  btnCancelText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  btnConfirm: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnSingle: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
