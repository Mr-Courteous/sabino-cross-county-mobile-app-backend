import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  Share,
  Modal,
  FlatList,
  TouchableWithoutFeedback,
  ActivityIndicator,
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

type StaffRole = 'admin' | 'class_teacher';

type ResultState =
  | { kind: 'credentials'; fullName: string; email: string; tempPassword: string; role: StaffRole; className: string | null }
  | { kind: 'invite'; fullName: string; email: string; code: string; expiresAt: string; role: StaffRole; className: string | null }
  | null;

interface ClassTemplate { id: number; display_name: string; }

export default function AddStaffPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('admin');
  const [className, setClassName] = useState<string | null>(null);
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [classTemplates, setClassTemplates] = useState<ClassTemplate[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [savingPath, setSavingPath] = useState<'A' | 'B' | null>(null);
  const [result, setResult] = useState<ResultState>(null);
  const [alert, setAlert] = useState<{ visible: boolean; type: 'success' | 'error'; message: string }>({
    visible: false,
    type: 'success',
    message: '',
  });

  const getToken = async () => {
    return Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
  };

  // Classes are country-scoped — GET /api/classes reads the admin's own
  // countryId off their token, so a Ghana school sees "GHS 1" etc. and a
  // Nigeria school sees "JSS 1" etc. automatically; no country picker
  // needed here. Only fetched once the admin actually opens the picker.
  const openClassPicker = async () => {
    setClassPickerOpen(true);
    if (classTemplates.length > 0) return;
    setLoadingClasses(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/classes`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setClassTemplates(data.data || []);
    } catch (e) {
      // Non-fatal — the admin can still submit without a class and assign one later.
    } finally {
      setLoadingClasses(false);
    }
  };

  const validate = () => {
    if (!fullName.trim()) {
      setAlert({ visible: true, type: 'error', message: 'Full name is required.' });
      return false;
    }
    if (!email.trim() || !email.includes('@')) {
      setAlert({ visible: true, type: 'error', message: 'A valid email is required.' });
      return false;
    }
    return true;
  };

  const buildBaseBody = () => ({
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim() || undefined,
    role,
    // className only means anything for a class_teacher — the server
    // resolves it against this school's own classes (creating the row
    // if this is the first time that class has been used), so we never
    // send a raw id from the country-template list.
    className: role === 'class_teacher' && className ? className : undefined,
  });

  // Path A — register the account immediately with a temp password.
  const handleRegisterNow = async () => {
    if (!validate()) return;
    setSavingPath('A');
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/staff/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildBaseBody()),
      });

      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 403) {
        setAlert({ visible: true, type: 'error', message: 'Only the school owner can add staff accounts.' });
        return;
      }

      const data = await res.json();
      if (data.success) {
        setResult({
          kind: 'credentials',
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          tempPassword: data.data.temporaryPassword,
          role,
          className: data.data.admin?.class_name || null,
        });
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to create the account.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSavingPath(null);
    }
  };

  // Path B — generate a self-registration code.
  const handleSendCode = async () => {
    if (!validate()) return;
    setSavingPath('B');
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/staff/admins/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildBaseBody()),
      });

      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 403) {
        setAlert({ visible: true, type: 'error', message: 'Only the school owner can invite staff.' });
        return;
      }

      const data = await res.json();
      if (data.success) {
        setResult({
          kind: 'invite',
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          code: data.data.code,
          expiresAt: data.data.expires_at,
          role,
          className: data.data.class_name || null,
        });
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to generate an invite code.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSavingPath(null);
    }
  };

  const shareCredentials = () => {
    if (result?.kind !== 'credentials') return;
    const roleLine = result.role === 'class_teacher'
      ? `Role: Class Teacher${result.className ? ` (${result.className})` : ' (class not yet assigned)'}\n`
      : '';
    Share.share({
      message: `You've been added as ${result.role === 'class_teacher' ? 'a class teacher' : 'an admin'} on Sabino Edu.\n\n${roleLine}Email: ${result.email}\nTemporary password: ${result.tempPassword}\n\nYou'll be asked to set your own password on first login.`,
    });
  };

  const shareCode = () => {
    if (result?.kind !== 'invite') return;
    const roleLine = result.role === 'class_teacher'
      ? `Role: Class Teacher${result.className ? ` (${result.className})` : ' (class not yet assigned)'}\n`
      : '';
    Share.share({
      message: `You're invited to join Sabino Edu as ${result.role === 'class_teacher' ? 'a class teacher' : 'an admin'}.\n\n${roleLine}Open the app, choose "Register with a code", and enter: ${result.code}\n\nThis code expires ${new Date(result.expiresAt).toLocaleString()}.`,
    });
  };

  const resetForm = () => {
    setFullName('');
    setEmail('');
    setPhone('');
    setRole('admin');
    setClassName(null);
    setResult(null);
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar style={C.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={isTiny ? 18 : 22} color={C.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Add Staff</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {result ? (
          <View style={styles.resultCard}>
            <View style={styles.resultIconWrap}>
              <Ionicons name="checkmark-circle" size={32} color="#22C55E" />
            </View>
            <ThemedText style={styles.resultTitle}>
              {result.kind === 'credentials' ? 'Account created' : 'Invite code generated'}
            </ThemedText>
            <ThemedText style={styles.resultSub}>
              {result.kind === 'credentials'
                ? `${result.fullName} can log in now with the details below. They'll be asked to set their own password on first login. These credentials were also emailed to ${result.email}.`
                : `Share this code with ${result.fullName || result.email}. It also went to ${result.email} by email.`}
            </ThemedText>

            {result.role === 'class_teacher' && (
              <View style={styles.rolePill}>
                <Ionicons name="school-outline" size={13} color={Colors.accent.gold} />
                <ThemedText style={styles.rolePillText}>
                  Class Teacher{result.className ? ` · ${result.className}` : ' · no class assigned yet'}
                </ThemedText>
              </View>
            )}

            {result.kind === 'credentials' ? (
              <View style={styles.credBox}>
                <View style={styles.credRow}>
                  <ThemedText style={styles.credLabel}>EMAIL</ThemedText>
                  <ThemedText style={styles.credValue} selectable>{result.email}</ThemedText>
                </View>
                <View style={styles.credRow}>
                  <ThemedText style={styles.credLabel}>TEMP PASSWORD</ThemedText>
                  <ThemedText style={styles.credValue} selectable>{result.tempPassword}</ThemedText>
                </View>
              </View>
            ) : (
              <View style={styles.credBox}>
                <ThemedText style={styles.credLabel}>INVITE CODE</ThemedText>
                <ThemedText style={styles.codeValue} selectable>{result.code}</ThemedText>
                <ThemedText style={styles.credSub}>Expires {new Date(result.expiresAt).toLocaleString()}</ThemedText>
              </View>
            )}

            <CustomButton
              title={result.kind === 'credentials' ? 'Share Credentials' : 'Share Code'}
              onPress={result.kind === 'credentials' ? shareCredentials : shareCode}
              variant="premium"
              icon={<Ionicons name="share-social-outline" size={16} color="#0F172A" style={{ marginRight: 6 }} />}
              style={{ marginTop: 8 }}
            />
            <TouchableOpacity onPress={resetForm} style={styles.addAnotherBtn}>
              <ThemedText style={styles.addAnotherText}>+ Add another staff member</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.back()} style={styles.doneBtn}>
              <ThemedText style={styles.doneText}>Done</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ThemedText style={styles.sectionLabel}>STAFF DETAILS</ThemedText>
            <CustomInput
              label="Full Name"
              placeholder="e.g. Jane Adeyemi"
              value={fullName}
              onChangeText={setFullName}
            />
            <CustomInput
              label="Email"
              placeholder="e.g. jane@school.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <CustomInput
              label="Phone (optional)"
              placeholder="e.g. 08012345678"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <ThemedText style={[styles.sectionLabel, { marginTop: 8 }]}>ROLE</ThemedText>
            <View style={styles.roleRow}>
              <TouchableOpacity
                style={[styles.roleChip, role === 'admin' && styles.roleChipActive]}
                onPress={() => { setRole('admin'); setClassName(null); }}
              >
                <Ionicons name="shield-checkmark-outline" size={15} color={role === 'admin' ? '#0F172A' : Colors.accent.gold} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.roleChipTitle, role === 'admin' && styles.roleChipTitleActive]}>Admin</ThemedText>
                  <ThemedText style={[styles.roleChipSub, role === 'admin' && styles.roleChipSubActive]}>Full school-wide access</ThemedText>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleChip, role === 'class_teacher' && styles.roleChipActive]}
                onPress={() => setRole('class_teacher')}
              >
                <Ionicons name="school-outline" size={15} color={role === 'class_teacher' ? '#0F172A' : Colors.accent.gold} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.roleChipTitle, role === 'class_teacher' && styles.roleChipTitleActive]}>Class Teacher</ThemedText>
                  <ThemedText style={[styles.roleChipSub, role === 'class_teacher' && styles.roleChipSubActive]}>Restricted to one class</ThemedText>
                </View>
              </TouchableOpacity>
            </View>

            {role === 'class_teacher' && (
              <>
                <ThemedText style={[styles.sectionLabel, { marginTop: 16 }]}>CLASS (OPTIONAL — CAN BE SET LATER)</ThemedText>
                <TouchableOpacity style={styles.classPickerBtn} onPress={openClassPicker}>
                  <Ionicons name="albums-outline" size={16} color={C.textMuted} />
                  <ThemedText style={styles.classPickerBtnText}>{className || 'Select a class'}</ThemedText>
                  <Ionicons name="chevron-down" size={14} color={C.textMuted} />
                </TouchableOpacity>
                <ThemedText style={styles.classHint}>
                  Once assigned, this teacher can only create or manage students in this class. You can change or clear it any time from Staff Directory.
                </ThemedText>
              </>
            )}

            <ThemedText style={[styles.sectionLabel, { marginTop: 20 }]}>HOW WOULD YOU LIKE TO ADD THEM?</ThemedText>

            <View style={styles.optionCard}>
              <View style={styles.optionIconWrap}>
                <Ionicons name="person-add-outline" size={20} color={Colors.accent.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.optionTitle}>Register for them now</ThemedText>
                <ThemedText style={styles.optionSub}>Creates the login immediately with a temporary password.</ThemedText>
              </View>
            </View>
            <CustomButton
              title="Register Now"
              onPress={handleRegisterNow}
              loading={savingPath === 'A'}
              disabled={savingPath !== null}
              variant="premium"
              style={{ marginBottom: 20 }}
            />

            <View style={styles.optionCard}>
              <View style={styles.optionIconWrap}>
                <Ionicons name="mail-outline" size={20} color={Colors.accent.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.optionTitle}>Send a registration code</ThemedText>
                <ThemedText style={styles.optionSub}>They complete their own profile and set their own password.</ThemedText>
              </View>
            </View>
            <CustomButton
              title="Send Invite Code"
              onPress={handleSendCode}
              loading={savingPath === 'B'}
              disabled={savingPath !== null}
              variant="outline"
            />
          </>
        )}
      </ScrollView>

      <Modal visible={classPickerOpen} transparent animationType="slide" onRequestClose={() => setClassPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setClassPickerOpen(false)}>
          <TouchableWithoutFeedback>
            <View style={styles.modalSheet}>
              <View style={styles.sheetHandle} />
              <ThemedText style={styles.modalTitle}>Select Class</ThemedText>
              {loadingClasses ? (
                <ActivityIndicator size="small" color={Colors.accent.gold} style={{ paddingVertical: 30 }} />
              ) : classTemplates.length === 0 ? (
                <ThemedText style={styles.modalEmptyText}>No classes found for your country.</ThemedText>
              ) : (
                <FlatList
                  data={classTemplates}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.modalItem}
                      onPress={() => { setClassName(item.display_name); setClassPickerOpen(false); }}
                    >
                      <ThemedText style={styles.modalItemText}>{item.display_name}</ThemedText>
                      {className === item.display_name && <Ionicons name="checkmark" size={16} color={Colors.accent.gold} />}
                    </TouchableOpacity>
                  )}
                  contentContainerStyle={{ paddingBottom: 20 }}
                />
              )}
            </View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
      </Modal>

      {alert.visible && (
        <CustomAlert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert({ ...alert, visible: false })}
        />
      )}
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

    sectionLabel: { color: C.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 14 },

    roleRow: { flexDirection: 'row', gap: 10 },
    roleChip: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, borderWidth: 1.5, borderColor: C.actionItemBorder, padding: 12 },
    roleChipActive: { backgroundColor: Colors.accent.gold, borderColor: Colors.accent.gold },
    roleChipTitle: { color: C.text, fontSize: 12, fontWeight: '800' },
    roleChipTitleActive: { color: '#0F172A' },
    roleChipSub: { color: C.textMuted, fontSize: 9.5, marginTop: 2, lineHeight: 12 },
    roleChipSubActive: { color: '#0F172A99' },

    classPickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.inputBorder, paddingHorizontal: 14, paddingVertical: 12 },
    classPickerBtnText: { flex: 1, color: C.inputText, fontSize: 12.5, fontWeight: '600' },
    classHint: { color: C.textMuted, fontSize: 10, lineHeight: 14, marginTop: 8 },

    rolePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${Colors.accent.gold}15`, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 14 },
    rolePillText: { color: C.text, fontSize: 11, fontWeight: '700' },

    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: C.modalBg, borderColor: C.cardBorder, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: isTiny ? 16 : 24, borderTopWidth: 1, maxHeight: '75%' },
    sheetHandle: { width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginBottom: 14, textAlign: 'center' },
    modalEmptyText: { color: C.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 20 },
    modalItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 4 },
    modalItemText: { color: C.text, fontSize: 13, fontWeight: '600' },

    optionCard: { flexDirection: 'row', gap: 12, backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 14, marginBottom: 10 },
    optionIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: `${Colors.accent.gold}15`, justifyContent: 'center', alignItems: 'center' },
    optionTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
    optionSub: { color: C.textMuted, fontSize: 10.5, marginTop: 3, lineHeight: 14 },

    resultCard: { backgroundColor: C.actionItemBg, borderRadius: 20, borderWidth: 1, borderColor: C.actionItemBorder, padding: 20, alignItems: 'center' },
    resultIconWrap: { marginBottom: 12 },
    resultTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginBottom: 6, textAlign: 'center' },
    resultSub: { color: C.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 17, marginBottom: 18 },

    credBox: { width: '100%', backgroundColor: C.inputBg, borderRadius: 14, borderWidth: 1, borderColor: C.inputBorder, padding: 14, marginBottom: 16 },
    credRow: { marginBottom: 10 },
    credLabel: { color: C.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginBottom: 4 },
    credValue: { color: C.text, fontSize: 13, fontWeight: '700' },
    codeValue: { color: Colors.accent.gold, fontSize: 26, fontWeight: '900', letterSpacing: 4, textAlign: 'center', marginVertical: 8 },
    credSub: { color: C.textMuted, fontSize: 10, textAlign: 'center' },

    addAnotherBtn: { marginTop: 14 },
    addAnotherText: { color: Colors.accent.gold, fontSize: 12, fontWeight: '700' },
    doneBtn: { marginTop: 10 },
    doneText: { color: C.textMuted, fontSize: 12, fontWeight: '600' },
  });
}
