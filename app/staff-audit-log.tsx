import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { isSchoolOwner } from '@/utils/jwt-decoder';
import { Colors } from '@/constants/design-system';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';

interface AuditEntry {
  id: number;
  actor_type: 'owner' | 'admin';
  actor_staff_id: number | null;
  action: string;
  target_staff_id: number | null;
  details: Record<string, any> | null;
  created_at: string;
}

interface StaffLite {
  id: number;
  full_name: string;
  email: string;
}

const ACTION_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }> = {
  'staff.created': { icon: 'person-add-outline', label: 'registered an admin account', color: '#22C55E' },
  'staff.invited': { icon: 'mail-outline', label: 'sent an invite code', color: '#F59E0B' },
  'staff.invite_revoked': { icon: 'close-circle-outline', label: 'revoked an invite code', color: '#94A3B8' },
  'staff.deactivated': { icon: 'pause-circle-outline', label: 'deactivated an admin account', color: '#EF4444' },
  'staff.reactivated': { icon: 'play-circle-outline', label: 'reactivated an admin account', color: '#22C55E' },
  'staff.deleted': { icon: 'trash-outline', label: 'deleted an admin account', color: '#EF4444' },
  'staff.password_changed': { icon: 'key-outline', label: 'changed their password', color: '#3B82F6' },
  'staff.password_reset': { icon: 'refresh-outline', label: 'reset their password', color: '#3B82F6' },
  'staff.self_registered': { icon: 'checkmark-done-outline', label: 'activated their account via invite code', color: '#22C55E' },
  'student.created': { icon: 'person-add-outline', label: 'registered a student', color: '#22C55E' },
  'student.updated': { icon: 'create-outline', label: 'edited a student\'s details', color: '#3B82F6' },
  'student.deleted': { icon: 'trash-outline', label: 'removed a student', color: '#EF4444' },
  'score.created': { icon: 'add-circle-outline', label: 'added a score', color: '#22C55E' },
  'score.updated': { icon: 'create-outline', label: 'edited a score', color: '#3B82F6' },
};

export default function StaffAuditLogPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [staffMap, setStaffMap] = useState<Record<number, StaffLite>>({});
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const PAGE_SIZE = 30;

  const getToken = async () => {
    return Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
  };

  // reset=true -> first page, replaces the list (initial load / pull-to-refresh)
  // reset=false -> next page, appended to the list (Load more)
  const fetchAudit = useCallback(async (reset: boolean) => {
    try {
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }

      if (!isSchoolOwner(token)) {
        router.back();
        return;
      }

      const before = reset ? '' : cursor ? `&before=${cursor}` : '';
      const [auditRes, adminsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/staff/audit-log?limit=${PAGE_SIZE}${before}`, { headers: { Authorization: `Bearer ${token}` } }),
        // Admin names only change rarely — no need to refetch on every "Load more".
        reset
          ? fetch(`${API_BASE_URL}/api/staff/admins`, { headers: { Authorization: `Bearer ${token}` } })
          : Promise.resolve(null),
      ]);

      if (auditRes.status === 402 || adminsRes?.status === 402) { router.replace('/pricing'); return; }
      if (auditRes.status === 401 || adminsRes?.status === 401) { router.replace('/(auth)'); return; }

      const auditData = await auditRes.json();

      if (auditData.success) {
        setEntries((prev) => (reset ? (auditData.data || []) : [...prev, ...(auditData.data || [])]));
        setHasMore(!!auditData.pagination?.hasMore);
        setCursor(auditData.pagination?.nextCursor ?? null);
      }

      if (adminsRes) {
        const adminsData = await adminsRes.json();
        if (adminsData.success) {
          const map: Record<number, StaffLite> = {};
          for (const a of adminsData.data?.admins || []) {
            map[a.id] = { id: a.id, full_name: a.full_name, email: a.email };
          }
          setStaffMap(map);
        }
      }
    } catch (e) {
      // Silent — the list will just show fewer resolved names / entries.
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setHasLoadedOnce(true);
    }
  }, [router, cursor]);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedOnce) {
        fetchAudit(true);
      } else {
        setLoading(true);
        fetchAudit(true);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasLoadedOnce])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchAudit(true);
  };

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    fetchAudit(false);
  };

  const actorName = (entry: AuditEntry) => {
    if (entry.actor_type === 'owner') return 'The school owner';
    if (entry.actor_staff_id && staffMap[entry.actor_staff_id]) return staffMap[entry.actor_staff_id].full_name;
    return 'An admin';
  };

  const targetName = (entry: AuditEntry) => {
    if (entry.target_staff_id && staffMap[entry.target_staff_id]) return staffMap[entry.target_staff_id].full_name;
    // Non-staff targets (students, scores, etc.) won't resolve via staffMap —
    // fall back to whatever descriptive name the backend put in `details`.
    if (entry.details?.studentName) return entry.details.studentName;
    if (entry.details?.name) return entry.details.name;
    if (entry.details?.email) return entry.details.email;
    return null;
  };

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading Audit Log...</ThemedText>
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
        <ThemedText style={styles.headerTitle}>Audit Log</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
      >
        {entries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={22} color={C.textMuted} />
            <ThemedText style={styles.emptyText}>No staff activity recorded yet.</ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => {
              const meta = ACTION_META[entry.action] || { icon: 'ellipse-outline', label: entry.action, color: '#94A3B8' };
              const target = targetName(entry);
              return (
                <View key={entry.id} style={styles.entryCard}>
                  <View style={[styles.iconWrap, { backgroundColor: `${meta.color}15` }]}>
                    <Ionicons name={meta.icon} size={16} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.entryText}>
                      <ThemedText style={styles.entryActor}>{actorName(entry)}</ThemedText>
                      {' '}{meta.label}
                      {target ? <ThemedText style={styles.entryTarget}> — {target}</ThemedText> : null}
                    </ThemedText>
                    <ThemedText style={styles.entryTime}>{formatTimestamp(entry.created_at)}</ThemedText>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {hasMore && entries.length > 0 && (
          <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
            {loadingMore ? (
              <ActivityIndicator size="small" color={Colors.accent.gold} />
            ) : (
              <ThemedText style={styles.loadMoreText}>Load more</ThemedText>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function formatTimestamp(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
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

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 60 },

    emptyCard: { alignItems: 'center', gap: 10, backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 24 },
    emptyText: { color: C.textMuted, fontSize: 12, fontWeight: '600' },

    list: { gap: 10 },
    entryCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: C.actionItemBg, borderRadius: 14, borderWidth: 1, borderColor: C.actionItemBorder, padding: 12 },
    iconWrap: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    entryText: { color: C.text, fontSize: 12.5, lineHeight: 18, fontWeight: '500' },
    entryActor: { fontWeight: '800' },
    entryTarget: { fontWeight: '700', color: Colors.accent.gold },
    entryTime: { color: C.textMuted, fontSize: 10, fontWeight: '600', marginTop: 4 },

    loadMoreBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, marginTop: 14, backgroundColor: C.actionItemBg, borderRadius: 14, borderWidth: 1, borderColor: C.actionItemBorder },
    loadMoreText: { color: Colors.accent.gold, fontSize: 12, fontWeight: '800' },
  });
}
