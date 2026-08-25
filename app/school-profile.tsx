import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { isSchoolOwner } from '@/utils/jwt-decoder';
import { Colors } from '@/constants/design-system';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';

export default function SchoolProfileEditPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Only the owner can edit institution details; admins can still view
  // this screen read-only if they land on it via a deep link.
  const [isOwner, setIsOwner] = useState(true);
  const [alert, setAlert] = useState<{ visible: boolean; type: 'success' | 'error'; message: string }>({
    visible: false,
    type: 'success',
    message: '',
  });

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: '',
    registration_code: '',
  });

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const token = Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
      setIsOwner(isSchoolOwner(token));
      const res = await fetch(`${API_BASE_URL}/api/schools/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 402) { router.replace('/pricing'); return; }
      const result = await res.json();
      if (result.success && result.data) {
        const d = result.data;
        setFormData({
          name: d.name || '',
          email: d.email || '',
          phone: d.phone || '',
          address: d.address || '',
          city: d.city || '',
          state: d.state || '',
          country: d.country || '',
          registration_code: d.registration_code || '',
        });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Failed to load profile data.' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!formData.name) {
      setAlert({ visible: true, type: 'error', message: 'Institution Name is required.' });
      return;
    }

    setSaving(true);
    setAlert({ ...alert, visible: false });

    try {
      const token = Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
      const res = await fetch(`${API_BASE_URL}/api/schools/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (res.status === 402) { router.replace('/pricing'); return; }

      const result = await res.json();

      if (result.success) {
        const stored = Platform.OS !== 'web' ? await SecureStore.getItemAsync('userData') : localStorage.getItem('userData');
        if (stored) {
          const userData = JSON.parse(stored);
          userData.firstName = formData.name;
          if (Platform.OS !== 'web') {
            await SecureStore.setItemAsync('userData', JSON.stringify(userData));
          } else {
            localStorage.setItem('userData', JSON.stringify(userData));
          }
        }

        setAlert({ visible: true, type: 'success', message: 'Institution details updated successfully!' });

        setTimeout(() => {
          router.replace('/dashboard');
        }, 1500);
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || result.message || 'Failed to update details.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading Profile...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <StatusBar style={C.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={width < 300 ? 18 : 22} color={C.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Institution Profile</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {alert.visible && (
          <CustomAlert
            type={alert.type}
            message={alert.message}
            onClose={() => setAlert({ ...alert, visible: false })}
            style={{ marginBottom: 16 }}
          />
        )}

        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Institution Name *</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
            placeholderTextColor={C.textMuted}
            editable={isOwner}
          />
        </View>

        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Registration Number</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.registration_code}
            onChangeText={(text) => setFormData({ ...formData, registration_code: text })}
            placeholder="Official School Reg. No"
            placeholderTextColor={C.textMuted}
            editable={isOwner}
          />
        </View>

        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Official Email</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.email}
            onChangeText={(text) => setFormData({ ...formData, email: text })}
            keyboardType="email-address"
            placeholderTextColor={C.textMuted}
            editable={isOwner}
          />
        </View>

        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Contact Phone</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.phone}
            onChangeText={(text) => setFormData({ ...formData, phone: text })}
            keyboardType="phone-pad"
            placeholderTextColor={C.textMuted}
            editable={isOwner}
          />
        </View>

        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Address</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.address}
            onChangeText={(text) => setFormData({ ...formData, address: text })}
            placeholderTextColor={C.textMuted}
            editable={isOwner}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.formGroup, { flex: width < 380 ? 0 : 1, width: width < 380 ? '100%' : undefined, marginRight: width < 380 ? 0 : 10 }]}>
            <ThemedText style={styles.label}>City</ThemedText>
            <TextInput
              style={styles.input}
              value={formData.city}
              onChangeText={(text) => setFormData({ ...formData, city: text })}
              placeholder="E.g. Ikeja"
              placeholderTextColor={C.textMuted}
              editable={isOwner}
            />
          </View>
          <View style={[styles.formGroup, { flex: width < 380 ? 0 : 1, width: width < 380 ? '100%' : undefined }]}>
            <ThemedText style={styles.label}>State</ThemedText>
            <TextInput
              style={styles.input}
              value={formData.state}
              onChangeText={(text) => setFormData({ ...formData, state: text })}
              placeholder="E.g. Lagos State"
              placeholderTextColor={C.textMuted}
              editable={isOwner}
            />
          </View>
        </View>

        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Country</ThemedText>
          <TextInput
            style={[styles.input, { opacity: 0.6, backgroundColor: C.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }]}
            value={formData.country}
            editable={false}
            placeholder="Cannot be modified"
            placeholderTextColor={C.textMuted}
          />
        </View>

        {!isOwner && (
          <View style={styles.noticeBanner}>
            <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>Only the school owner can edit institution details.</ThemedText>
          </View>
        )}

        {isOwner && (
          <CustomButton
            title="Save Changes"
            onPress={handleUpdate}
            loading={saving}
            variant="premium"
            style={styles.submitBtn}
          />
        )}
      </ScrollView>
    </ThemedView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
    loadingText: { color: Colors.accent.gold, marginTop: 15, fontWeight: '800', fontSize: 10, letterSpacing: 2 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: isTiny ? 15 : 20, paddingBottom: 16, backgroundColor: C.modalBg, borderBottomWidth: 1, borderColor: C.divider },
    backBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: C.text, fontSize: isTiny ? 14 : 16, fontWeight: '800' },

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 100 },

    formGroup: { marginBottom: isTiny ? 18 : 22 },
    row: { flexDirection: width < 380 ? 'column' : 'row' },
    label: { color: C.textLabel, fontSize: 9, fontWeight: '800', marginBottom: 8, letterSpacing: 1, marginLeft: 4 },
    input: { backgroundColor: C.inputBg, borderRadius: 14, padding: isTiny ? 12 : 14, color: C.inputText, fontSize: isTiny ? 12 : 13, fontWeight: '600', borderWidth: 1, borderColor: C.inputBorder },

    submitBtn: { marginTop: 12, borderRadius: 14, paddingVertical: isTiny ? 14 : 16 },

    noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, padding: 12, marginTop: 4, marginBottom: 8, borderWidth: 1, borderColor: C.actionItemBorder },
    noticeText: { flex: 1, color: C.textMuted, fontSize: 11, lineHeight: 15 },
  });
}
