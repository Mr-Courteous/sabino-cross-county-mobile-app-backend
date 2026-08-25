import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Modal,
  FlatList,
  TouchableWithoutFeedback,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { isSchoolOwner, decodeToken } from '@/utils/jwt-decoder';
import { Colors } from '@/constants/design-system';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';

interface Admin {
  id: number;
  full_name: string;
  email: string;
  phone?: string;
  role?: string;
  class_id?: number | null;
  class_name?: string | null;
  status: string; // 'active' | 'password_reset_required' | 'invited' | ...
  created_at: string;
}

interface PendingInvite {
  id: number;
  code: string;
  full_name?: string;
  email?: string;
  phone?: string;
  role?: string;
  class_id?: number | null;
  class_name?: string | null;
  status: string;
  expires_at: string;
  created_at: string;
}

interface ClassTemplate { id: number; display_name: string; }

export default function StaffDirectoryPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);

  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  // A full admin (not owner, not class_teacher) can delete class_teacher
  // accounts but not other admins — see backend DELETE /admins/:staffId.
  const [isFullAdmin, setIsFullAdmin] = useState(false);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [classModalStaff, setClassModalStaff] = useState<Admin | null>(null);
  const [classTemplates, setClassTemplates] = useState<ClassTemplate[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [savingClass, setSavingClass] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteStaff, setConfirmDeleteStaff] = useState<Admin | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [confirmRevokeInvite, setConfirmRevokeInvite] = useState<PendingInvite | null>(null);
  const [alert, setAlert] = useState<{ visible: boolean; type: 'success' | 'error' | 'info'; message: string }>({
    visible: false,
    type: 'info',
    message: '',
  });

  const getToken = async () => {
    return Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
  };

  const fetchStaff = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        router.replace('/(auth)');
        return;
      }

      setIsOwner(isSchoolOwner(token));
      const decoded = decodeToken(token);
      setIsFullAdmin(!isSchoolOwner(token) && decoded?.staffRole === 'admin');

      const res = await fetch(`${API_BASE_URL}/api/staff/admins`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 401) { router.replace('/(auth)'); return; }

      const result = await res.json();
      if (result.success) {
        setAdmins(result.data?.admins || []);
        setPendingInvites(result.data?.pendingInvites || []);
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || 'Failed to load staff.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(true);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      // Full-screen loader only on the very first load; refocusing after
      // Add Staff refreshes quietly in the background instead.
      if (hasLoadedOnce) {
        fetchStaff();
      } else {
        setLoading(true);
        fetchStaff();
      }
    }, [fetchStaff, hasLoadedOnce])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchStaff();
  };

  const handleAddStaff = () => {
    router.push('/add-staff');
  };

  const openClassModal = async (admin: Admin) => {
    setClassModalStaff(admin);
    if (classTemplates.length > 0) return;
    setLoadingClasses(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/classes`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setClassTemplates(data.data || []);
    } catch (e) {
      // Non-fatal — the sheet still works for clearing an assignment.
    } finally {
      setLoadingClasses(false);
    }
  };

  const assignClass = async (className: string | null) => {
    if (!classModalStaff) return;
    setSavingClass(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/staff/admins/${classModalStaff.id}/class`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(className ? { className } : { clear: true }),
      });
      const data = await res.json();
      if (data.success) {
        setAdmins((prev) => prev.map((a) => (a.id === classModalStaff.id ? { ...a, class_id: data.data.class_id, class_name: data.data.class_name } : a)));
        setAlert({ visible: true, type: 'success', message: data.message || 'Class assignment updated.' });
        setClassModalStaff(null);
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to update class assignment.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSavingClass(false);
    }
  };

  const canManage = isOwner || isFullAdmin;

  const canDeleteStaff = (a: Admin) => {
    if (isOwner) return true;
    if (isFullAdmin) return a.role !== 'admin'; // full admins can't remove other admins
    return false;
  };

  const requestDeleteStaff = (a: Admin) => {
    if (!canDeleteStaff(a)) return;
    setConfirmDeleteStaff(a);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteStaff) return;
    const target = confirmDeleteStaff;
    setConfirmDeleteStaff(null);
    setDeletingId(target.id);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/staff/admins/${target.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setAdmins((prev) => prev.filter((a) => a.id !== target.id));
        setAlert({ visible: true, type: 'success', message: data.message || 'Account removed.' });
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to remove this account.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setDeletingId(null);
    }
  };

  const resendInvite = async (inv: PendingInvite) => {
    setResendingId(inv.id);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/staff/admins/invite/${inv.id}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setPendingInvites((prev) => prev.map((p) => (p.id === inv.id ? { ...p, expires_at: data.data.expires_at } : p)));
        setAlert({ visible: true, type: 'success', message: data.message || 'Invite resent.' });
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to resend invite.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setResendingId(null);
    }
  };

  const requestRevokeInvite = (inv: PendingInvite) => setConfirmRevokeInvite(inv);

  const confirmRevoke = async () => {
    if (!confirmRevokeInvite) return;
    const target = confirmRevokeInvite;
    setConfirmRevokeInvite(null);
    setRevokingId(target.id);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/staff/admins/invite/${target.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setPendingInvites((prev) => prev.filter((p) => p.id !== target.id));
        setAlert({ visible: true, type: 'success', message: data.message || 'Invite revoked.' });
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to revoke invite.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setRevokingId(null);
    }
  };

  const isTiny = width < 300;

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading Staff...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <StatusBar style={C.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={isTiny ? 18 : 22} color={C.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Staff Directory</ThemedText>
        {isOwner ? (
          <TouchableOpacity onPress={handleAddStaff} style={styles.addBtn}>
            <Ionicons name="add" size={isTiny ? 20 : 24} color="#0F172A" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
      >
        {!canManage && (
          <View style={styles.noticeBanner}>
            <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>Only the school owner or an admin can manage staff accounts.</ThemedText>
          </View>
        )}
        {isFullAdmin && (
          <View style={styles.noticeBanner}>
            <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>As an admin, you can remove teacher accounts. Only the owner can add staff or remove other admins.</ThemedText>
          </View>
        )}

        {isOwner && (
          <TouchableOpacity style={styles.auditLinkRow} onPress={() => router.push('/staff-audit-log')}>
            <Ionicons name="document-text-outline" size={15} color={Colors.accent.gold} />
            <ThemedText style={styles.auditLinkText}>View Audit Log</ThemedText>
            <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
          </TouchableOpacity>
        )}

        <ThemedText style={styles.sectionLabel}>ACTIVE STAFF MEMBERS ({admins.length})</ThemedText>
        {admins.length === 0 ? (
          <View style={styles.emptyCard}>
            <ThemedText style={styles.emptyText}>No staff member's accounts yet.</ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {admins.map((a) => {
              const isClassTeacher = a.role === 'class_teacher';
              const tappable = isOwner && isClassTeacher;
              const deletable = canDeleteStaff(a);
              return (
                <TouchableOpacity
                  key={a.id}
                  style={styles.staffCard}
                  onPress={() => tappable && openClassModal(a)}
                  disabled={!tappable}
                  activeOpacity={tappable ? 0.75 : 1}
                >
                  <View style={styles.staffIconWrap}>
                    <Ionicons name={isClassTeacher ? 'school-outline' : 'person-outline'} size={18} color={Colors.accent.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.staffName} numberOfLines={1}>{a.full_name}</ThemedText>
                    <ThemedText style={styles.staffSub} numberOfLines={1}>{a.email}</ThemedText>
                    {isClassTeacher && (
                      <View style={styles.roleTagRow}>
                        <Ionicons name="albums-outline" size={10} color={Colors.accent.gold} />
                        <ThemedText style={styles.roleTagText}>{a.class_name || 'No class assigned'}</ThemedText>
                        {isOwner && <ThemedText style={styles.roleTagEdit}> · Tap to change</ThemedText>}
                      </View>
                    )}
                  </View>
                  <StatusBadge status={a.status} />
                  {deletable && (
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => requestDeleteStaff(a)}
                      disabled={deletingId === a.id}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      {deletingId === a.id ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                      ) : (
                        <Ionicons name="trash-outline" size={16} color="#EF4444" />
                      )}
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <ThemedText style={[styles.sectionLabel, { marginTop: 24 }]}>PENDING INVITES ({pendingInvites.length})</ThemedText>
        {pendingInvites.length === 0 ? (
          <View style={styles.emptyCard}>
            <ThemedText style={styles.emptyText}>No pending invites.</ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {pendingInvites.map((inv) => (
              <View key={inv.id} style={styles.staffCard}>
                <View style={[styles.staffIconWrap, { backgroundColor: '#F59E0B15' }]}>
                  <Ionicons name="mail-outline" size={18} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.staffName} numberOfLines={1}>{inv.full_name || inv.email || 'Unnamed invite'}</ThemedText>
                  <ThemedText style={styles.staffSub} numberOfLines={1}>Code: {inv.code}</ThemedText>
                  <ThemedText style={styles.staffSub} numberOfLines={1}>Expires {new Date(inv.expires_at).toLocaleDateString()}</ThemedText>
                  {inv.role === 'class_teacher' && (
                    <View style={styles.roleTagRow}>
                      <Ionicons name="albums-outline" size={10} color={Colors.accent.gold} />
                      <ThemedText style={styles.roleTagText}>{inv.class_name || 'No class assigned'}</ThemedText>
                    </View>
                  )}
                </View>
                {isOwner && (
                  <View style={styles.inviteActions}>
                    <TouchableOpacity
                      style={styles.inviteActionBtn}
                      onPress={() => resendInvite(inv)}
                      disabled={resendingId === inv.id}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      {resendingId === inv.id ? (
                        <ActivityIndicator size="small" color={Colors.accent.gold} />
                      ) : (
                        <Ionicons name="refresh-outline" size={16} color={Colors.accent.gold} />
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.inviteActionBtn}
                      onPress={() => requestRevokeInvite(inv)}
                      disabled={revokingId === inv.id}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      {revokingId === inv.id ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                      ) : (
                        <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                      )}
                    </TouchableOpacity>
                  </View>
                )}
                <StatusBadge status="pending" />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {confirmDeleteStaff && (
        <CustomAlert
          type="warning"
          message={`Remove ${confirmDeleteStaff.full_name}'s account permanently? They'll lose access immediately. This can't be undone.`}
          confirmLabel="Remove"
          onConfirm={confirmDelete}
          onClose={() => setConfirmDeleteStaff(null)}
        />
      )}

      {confirmRevokeInvite && (
        <CustomAlert
          type="warning"
          message={`Revoke the invite for ${confirmRevokeInvite.full_name || confirmRevokeInvite.email}? The code will stop working.`}
          confirmLabel="Revoke"
          onConfirm={confirmRevoke}
          onClose={() => setConfirmRevokeInvite(null)}
        />
      )}

      <Modal visible={!!classModalStaff} transparent animationType="slide" onRequestClose={() => setClassModalStaff(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => !savingClass && setClassModalStaff(null)}>
          <TouchableWithoutFeedback>
            <View style={styles.modalSheet}>
              <View style={styles.sheetHandle} />
              <ThemedText style={styles.modalTitle}>Assign Class</ThemedText>
              <ThemedText style={styles.modalSubtitle}>{classModalStaff?.full_name}</ThemedText>

              <TouchableOpacity
                style={styles.clearRow}
                onPress={() => assignClass(null)}
                disabled={savingClass || !classModalStaff?.class_name}
              >
                <Ionicons name="close-circle-outline" size={16} color={C.textMuted} />
                <ThemedText style={styles.clearRowText}>Clear assignment (unrestricted until reassigned)</ThemedText>
              </TouchableOpacity>

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
                      onPress={() => assignClass(item.display_name)}
                      disabled={savingClass}
                    >
                      <ThemedText style={styles.modalItemText}>{item.display_name}</ThemedText>
                      {classModalStaff?.class_name === item.display_name && <Ionicons name="checkmark" size={16} color={Colors.accent.gold} />}
                    </TouchableOpacity>
                  )}
                  contentContainerStyle={{ paddingBottom: 20 }}
                />
              )}
              {savingClass && <ActivityIndicator size="small" color={Colors.accent.gold} style={{ marginTop: 10 }} />}
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

function StatusBadge({ status }: { status: string }) {
  const normalized = (status || '').toLowerCase();
  // An account exists and can log in right now — it just hasn't set its
  // own password yet. That's not the same as an invite with no account.
  const needsPasswordReset = normalized === 'password_reset_required';
  const isActive = normalized === 'active' || needsPasswordReset;
  const isPending = normalized === 'pending' || normalized === 'invited';

  const label = needsPasswordReset ? 'Active · Reset pending' : isActive ? 'Active' : isPending ? 'Pending' : status;
  const color = isActive ? '#22C55E' : isPending ? '#F59E0B' : '#94A3B8';

  return (
    <View style={[badgeStyles.badge, { backgroundColor: `${color}15`, borderColor: `${color}40` }]}>
      <View style={[badgeStyles.dot, { backgroundColor: color }]} />
      <ThemedText style={[badgeStyles.text, { color }]}>{label}</ThemedText>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 10, fontWeight: '800' },
});

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
    loadingText: { color: Colors.accent.gold, marginTop: 15, fontWeight: '800', fontSize: 10, letterSpacing: 2 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: isTiny ? 15 : 20, paddingBottom: 16, backgroundColor: C.modalBg, borderBottomWidth: 1, borderColor: C.divider },
    backBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: C.text, fontSize: isTiny ? 14 : 16, fontWeight: '800' },
    addBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center' },

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 60 },

    noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: C.actionItemBorder },
    noticeText: { flex: 1, color: C.textMuted, fontSize: 11, lineHeight: 15 },

    auditLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 20, borderWidth: 1, borderColor: C.actionItemBorder },
    auditLinkText: { flex: 1, color: C.text, fontSize: 12, fontWeight: '700' },

    sectionLabel: { color: C.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 },

    emptyCard: { backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 18, alignItems: 'center' },
    emptyText: { color: C.textMuted, fontSize: 12, fontWeight: '600' },

    list: { gap: 10 },
    staffCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 12 },
    staffIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: `${Colors.accent.gold}15`, justifyContent: 'center', alignItems: 'center' },
    staffName: { color: C.text, fontSize: 13, fontWeight: '800' },
    staffSub: { color: C.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2 },

    roleTagRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    roleTagText: { color: Colors.accent.gold, fontSize: 9.5, fontWeight: '700' },
    roleTagEdit: { color: C.textMuted, fontSize: 9.5, fontWeight: '600' },

    deleteBtn: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#EF444415', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
    inviteActions: { flexDirection: 'row', gap: 6, marginRight: 8 },
    inviteActionBtn: { width: 30, height: 30, borderRadius: 10, backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder, justifyContent: 'center', alignItems: 'center' },

    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: C.modalBg, borderColor: C.cardBorder, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: isTiny ? 16 : 24, borderTopWidth: 1, maxHeight: '75%' },
    sheetHandle: { width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginBottom: 4, textAlign: 'center' },
    modalSubtitle: { color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 14, textAlign: 'center' },
    modalEmptyText: { color: C.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 20 },
    modalItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 4 },
    modalItemText: { color: C.text, fontSize: 13, fontWeight: '600' },
    clearRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 4, marginBottom: 8, borderBottomWidth: 1, borderColor: C.divider },
    clearRowText: { color: C.textMuted, fontSize: 11.5, fontWeight: '600', flex: 1 },
  });
}
