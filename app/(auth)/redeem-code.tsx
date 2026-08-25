import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
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
import { syncPushTokenToBackend } from '@/utils/push-notifications';

export default function RedeemCodeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;

  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRedeem = async () => {
    if (!code.trim()) { setError('Enter your invite code.'); return; }
    if (!fullName.trim()) { setError('Full name is required.'); return; }
    if (!password || password.length < 6) { setError('Choose a password of at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setError('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/staff-auth/redeem-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          password,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.data?.token) {
        const { token, user } = data.data;

        if (Platform.OS === 'web') {
          localStorage.setItem('userToken', token);
          localStorage.setItem('userData', JSON.stringify(user));
        } else {
          await SecureStore.setItemAsync('userToken', token);
          await SecureStore.setItemAsync('userData', JSON.stringify(user));
        }

        router.replace('/dashboard');
        syncPushTokenToBackend(token);
      } else {
        setError(data.error || 'Failed to redeem the invite code.');
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={isTiny ? 18 : 22} color={C.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Staff Registration</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.introCard}>
          <Ionicons name="key-outline" size={22} color={Colors.accent.gold} />
          <ThemedText style={styles.introText}>
            Enter the invite code your school sent you, along with your name and a password, to activate your account.
          </ThemedText>
        </View>

        {!!error && (
          <CustomAlert type="error" message={error} onClose={() => setError('')} style={{ marginBottom: 16 }} />
        )}

        <CustomInput
          label="Invite Code"
          placeholder="e.g. AB12CD34"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          editable={!isLoading}
        />
        <CustomInput
          label="Full Name"
          placeholder="Your full name"
          value={fullName}
          onChangeText={setFullName}
          editable={!isLoading}
        />
        <CustomInput
          label="Phone (optional)"
          placeholder="e.g. 08012345678"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          editable={!isLoading}
        />
        <CustomInput
          label="Password"
          placeholder="Create a password"
          isPassword
          value={password}
          onChangeText={setPassword}
          editable={!isLoading}
        />
        <CustomInput
          label="Confirm Password"
          placeholder="Re-enter your password"
          isPassword
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          editable={!isLoading}
        />

        <CustomButton
          title={isLoading ? 'ACTIVATING...' : 'ACTIVATE ACCOUNT'}
          onPress={handleRedeem}
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
    backBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: C.text, fontSize: isTiny ? 14 : 16, fontWeight: '800' },

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 60 },

    introCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 14, marginBottom: 20 },
    introText: { flex: 1, color: C.textMuted, fontSize: 12, lineHeight: 17 },
  });
}
