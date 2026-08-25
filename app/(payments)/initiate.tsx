import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Linking, Alert, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppColors } from '@/hooks/use-app-colors';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/design-system';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';

export default function InitiatePayment() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const [planId, setPlanId] = useState('');
  const [loading, setLoading] = useState(false);
  const [txRef, setTxRef] = useState('');

  const getToken = async () => {
    if (Platform.OS === 'web') return localStorage.getItem('userToken');
    return await SecureStore.getItemAsync('userToken');
  };

  useEffect(() => {
    if (Platform.OS === 'web') {
      const sp = new URLSearchParams(window.location.search);
      const p = sp.get('planId') || sp.get('plan_id') || sp.get('plan');
      if (p) setPlanId(p);
    }
  }, []);

  const initiate = async () => {
    if (!planId) return Alert.alert('Error', 'Selection required.');
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/payments/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_id: Number(planId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to initiate');
      setTxRef(data.tx_ref);
      if (data.link) Linking.openURL(data.link);
    } catch (err: any) {
      Alert.alert('Payment Error', err.message || 'Could not initiate.');
    } finally {
      setLoading(false);
    }
  };

  const isTiny = width < 300;

  return (
    <ThemedView style={styles.container}>
      <ThemedText style={styles.title}>Secure Payment</ThemedText>

      <ThemedText style={styles.label}>Subscription Plan</ThemedText>
      <TextInput
        value={String(planId)}
        onChangeText={setPlanId}
        placeholder="Enter ID"
        placeholderTextColor={C.textMuted}
        keyboardType="numeric"
        style={styles.input}
      />

      <TouchableOpacity onPress={initiate} disabled={loading} style={styles.button}>
        {loading ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>GENERATE LINK</ThemedText>}
      </TouchableOpacity>

      {txRef ? (
        <View style={{ marginTop: 16 }}>
          <ThemedText style={styles.txRef}>Reference: {txRef}</ThemedText>
          <TouchableOpacity onPress={() => router.push({ pathname: '/(payments)/verify', params: { tx_ref: txRef, plan_id: planId } } as any)} style={{ marginTop: 12 }}>
            <ThemedText style={styles.verifyLink}>Verify Transaction</ThemedText>
          </TouchableOpacity>
        </View>
      ) : null}
    </ThemedView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    container: { flex: 1, padding: isTiny ? 20 : 26, justifyContent: 'center', backgroundColor: C.background },
    title: { fontSize: isTiny ? 20 : 22, fontWeight: '900', color: C.text, marginBottom: 20 },
    label: { fontSize: 10, fontWeight: '800', color: C.textLabel, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
    input: { padding: 14, backgroundColor: C.inputBg, color: C.inputText, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 12, marginBottom: 16, fontSize: 14, fontWeight: '600' },
    button: { backgroundColor: Colors.accent.navy, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: '#fff', fontWeight: '800', letterSpacing: 1, fontSize: 12 },
    txRef: { fontSize: 10, color: C.textSecondary, fontWeight: '600' },
    verifyLink: { color: Colors.accent.gold, fontWeight: '800', fontSize: 12 }
  });
}
