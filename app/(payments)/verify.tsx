import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppColors } from '@/hooks/use-app-colors';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/design-system';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';

export default function VerifyPayment() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const [txRef, setTxRef] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [loading, setLoading] = useState(false);

  const getToken = async () => {
    if (Platform.OS === 'web') return localStorage.getItem('userToken');
    return await SecureStore.getItemAsync('userToken');
  };

  useEffect(() => {
    if (Platform.OS === 'web') {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get('tx_ref') || sp.get('txref') || sp.get('txRef');
      if (t) setTxRef(t);
    }
  }, []);

  const verify = async () => {
    if (!txRef && !transactionId) return Alert.alert('Error', 'Input required.');
    setLoading(true);
    try {
      const token = await getToken();
      const body: any = {};
      if (transactionId) body.transaction_id = transactionId;
      if (txRef) body.tx_ref = txRef;

      const res = await fetch(`${API_BASE_URL}/api/payments/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Verification failed');

      Alert.alert('Success', 'Subscription active');
      router.push('/(student)/dashboard');
    } catch (err: any) {
      Alert.alert('Verification Error', err.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const isTiny = width < 300;

  return (
    <ThemedView style={styles.container}>
      <ThemedText style={styles.title}>Verify Receipt</ThemedText>

      <ThemedText style={styles.label}>Transaction Ref</ThemedText>
      <TextInput 
        value={txRef} 
        onChangeText={setTxRef} 
        placeholder="tx_ref" 
        placeholderTextColor={C.textMuted}
        style={styles.input} 
      />

      <ThemedText style={styles.label}>Trans ID (Optional)</ThemedText>
      <TextInput 
        value={transactionId} 
        onChangeText={setTransactionId} 
        placeholder="id" 
        placeholderTextColor={C.textMuted}
        style={styles.input} 
      />

      <TouchableOpacity onPress={verify} disabled={loading} style={styles.button}>
        {loading ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>CONFIRM PAYMENT</ThemedText>}
      </TouchableOpacity>
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
    button: { backgroundColor: '#10B981', height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: '#fff', fontWeight: '800', letterSpacing: 1, fontSize: 12 }
  });
}
