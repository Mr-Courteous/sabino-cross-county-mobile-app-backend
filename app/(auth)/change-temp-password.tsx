import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { Colors } from '@/constants/design-system';
import { CustomInput } from '@/components/custom-input';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';

export default function ChangeTempPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tempPassword?: string }>();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;

  const [currentPassword, setCurrentPassword] = useState(params.tempPassword || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const getToken = async () => {
    return Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
  };

  const handleChangePassword = async () => {
    if (!currentPassword) { setError('Enter your temporary password.'); return; }
    if (!newPassword || newPassword.length < 6) { setError('Choose a new password of at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (newPassword === currentPassword) { setError('Choose a password different from the temporary one.'); return; }

    setError('');
    setIsLoading(true);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/staff-auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        router.replace('/dashboard');
      } else {
        setError(data.error || 'Failed to change password.');
        setIsLoading(false);
      }
    } catch (e) {
      setError('Network error. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar style={C.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <View style={{ width: 40 }} />
        <ThemedText style={styles.headerTitle}>Set Your Password</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.introCard}>
          <Ionicons name="lock-closed-outline" size={22} color={Colors.accent.gold} />
          <ThemedText style={styles.introText}>
            For security, you need to set your own password before continuing. This replaces the temporary one you were given.
          </ThemedText>
        </View>

        {!!error && (
          <CustomAlert type="error" message={error} onClose={() => setError('')} style={{ marginBottom: 16 }} />
        )}

        <CustomInput
          label="Temporary Password"
          placeholder="The password you logged in with"
          isPassword
          value={currentPassword}
          onChangeText={setCurrentPassword}
          editable={!isLoading}
        />
        <CustomInput
          label="New Password"
          placeholder="Choose a new password"
          isPassword
          value={newPassword}
          onChangeText={setNewPassword}
          editable={!isLoading}
        />
        <CustomInput
          label="Confirm New Password"
          placeholder="Re-enter your new password"
          isPassword
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          editable={!isLoading}
        />

        <CustomButton
          title={isLoading ? 'SAVING...' : 'SET PASSWORD & CONTINUE'}
          onPress={handleChangePassword}
          loading={isLoading}
          disabled={isLoading}
          variant="premium"
          style={{ marginTop: 8 }}
        />
      </ScrollView>
    </ThemedView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: isTiny ? 15 : 20, paddingBottom: 16, backgroundColor: C.modalBg, borderBottomWidth: 1, borderColor: C.divider },
    headerTitle: { color: C.text, fontSize: isTiny ? 14 : 16, fontWeight: '800' },

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 60 },

    introCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 14, marginBottom: 20 },
    introText: { flex: 1, color: C.textMuted, fontSize: 12, lineHeight: 17 },
  });
}
