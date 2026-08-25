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
import { isSchoolOwner, decodeToken, getTeacherClassScope } from '@/utils/jwt-decoder';
import { Colors } from '@/constants/design-system';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';

interface Enrollment {
  enrollment_id: number;
  school_id: number;
  student_id: number;
  class_id: number;
  session_id: number;
  enrollment_status: string; // 'active' | 'promoted' | 'repeated' | 'transferred' | 'graduated'
  enrolled_at: string;
  first_name: string;
  last_name: string;
  email?: string;
  registration_number?: string;
  gender?: string;
  phone?: string;
  photo?: string;
  class_name: string;
  academic_session: string;
  academic_year?: string;
}

interface ClassOption { id: number; class_name: string; }
interface SessionOption { id: number; year_label: string; }

const STATUS_FILTERS = ['all', 'active', 'promoted', 'repeated', 'transferred', 'graduated'] as const;

export default function EnrollmentsPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;

  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const [isFullAdmin, setIsFullAdmin] = useState(false);
  const [scopedClassId, setScopedClassId] = useState<number | null>(null);

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>([]);

  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number]>('all');
  const [classFilter, setClassFilter] = useState<ClassOption | null>(null);
  const [sessionFilter, setSessionFilter] = useState<SessionOption | null>(null);
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);

  const [alert, setAlert] = useState<{ visible: boolean; type: 'success' | 'error' | 'info'; message: string }>({
    visible: false,
    type: 'info',
    message: '',
  });

  const getToken = async () => {
    return Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
  };

  const fetchFilterOptions = useCallback(async (token: string) => {
    try {
      const [classRes, sessionRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/classes/school`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/academic-years`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const classData = await classRes.json();
      const sessionData = await sessionRes.json();
      if (classData.success) setClassOptions(classData.data || []);
      if (sessionData.success) setSessionOptions(sessionData.data || []);
    } catch (e) {
      // Non-fatal — filters just won't populate; the list itself still loads.
    }
  }, []);

  const fetchEnrollments = useCallback(async (opts?: { status?: string; classId?: number; sessionId?: number }) => {
    try {
      const token = await getToken();
      if (!token) {
        router.replace('/(auth)');
        return;
      }

      setIsOwner(isSchoolOwner(token));
      const decoded = decodeToken(token);
      setIsFullAdmin(!isSchoolOwner(token) && decoded?.staffRole === 'admin');
      setScopedClassId(getTeacherClassScope(token)?.classId ?? null);

      if (classOptions.length === 0 && sessionOptions.length === 0) {
        fetchFilterOptions(token);
      }

      const params = new URLSearchParams();
      if (opts?.status && opts.status !== 'all') params.set('status', opts.status);
      if (opts?.classId) params.set('classId', String(opts.classId));
      if (opts?.sessionId) params.set('sessionId', String(opts.sessionId));

      const qs = params.toString();
      const res = await fetch(`${API_BASE_URL}/api/students/enrollments${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 401) { router.replace('/(auth)'); return; }

      const result = await res.json();
      if (result.success) {
        setEnrollments(result.data || []);
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || 'Failed to load enrollments.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const opts = { status: statusFilter, classId: classFilter?.id, sessionId: sessionFilter?.id };
      if (hasLoadedOnce) {
        fetchEnrollments(opts);
      } else {
        setLoading(true);
        fetchEnrollments(opts);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchEnrollments])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchEnrollments({ status: statusFilter, classId: classFilter?.id, sessionId: sessionFilter?.id });
  };

  const applyStatusFilter = (status: typeof STATUS_FILTERS[number]) => {
    setStatusFilter(status);
    setLoading(true);
    fetchEnrollments({ status, classId: classFilter?.id, sessionId: sessionFilter?.id });
  };

  const applyClassFilter = (opt: ClassOption | null) => {
    setClassFilter(opt);
    setClassPickerOpen(false);
    setLoading(true);
    fetchEnrollments({ status: statusFilter, classId: opt?.id, sessionId: sessionFilter?.id });
  };

  const applySessionFilter = (opt: SessionOption | null) => {
    setSessionFilter(opt);
    setSessionPickerOpen(false);
    setLoading(true);
    fetchEnrollments({ status: statusFilter, classId: classFilter?.id, sessionId: opt?.id });
  };

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading Enrollments...</ThemedText>
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
        <ThemedText style={styles.headerTitle}>Enrollments</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      {scopedClassId && (
        <View style={styles.noticeBanner}>
          <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
          <ThemedText style={styles.noticeText}>
            You're a class teacher, so this only shows enrollments for your assigned class.
          </ThemedText>
        </View>
      )}

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {STATUS_FILTERS.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.statusChip, statusFilter === s && styles.statusChipActive]}
              onPress={() => applyStatusFilter(s)}
            >
              <ThemedText style={[styles.statusChipText, statusFilter === s && styles.statusChipTextActive]}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.filterRow}>
        {!scopedClassId && (
          <TouchableOpacity style={styles.filterPill} onPress={() => setClassPickerOpen(true)}>
            <Ionicons name="school-outline" size={13} color={C.textMuted} />
            <ThemedText style={styles.filterPillText} numberOfLines={1}>
              {classFilter?.class_name || 'All classes'}
            </ThemedText>
            <Ionicons name="chevron-down" size={13} color={C.textMuted} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.filterPill} onPress={() => setSessionPickerOpen(true)}>
          <Ionicons name="calendar-outline" size={13} color={C.textMuted} />
          <ThemedText style={styles.filterPillText} numberOfLines={1}>
            {sessionFilter?.year_label || 'All sessions'}
          </ThemedText>
          <Ionicons name="chevron-down" size={13} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
      >
        <ThemedText style={styles.countLabel}>
          {enrollments.length} enrollment{enrollments.length === 1 ? '' : 's'}
        </ThemedText>

        {enrollments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="file-tray-outline" size={22} color={C.textMuted} />
            <ThemedText style={styles.emptyText}>No enrollments match these filters.</ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {enrollments.map((e) => (
              <View key={e.enrollment_id} style={styles.enrollCard}>
                <View style={styles.enrollIconWrap}>
                  <Ionicons name="person-outline" size={16} color={Colors.accent.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.enrollName} numberOfLines={1}>
                    {e.first_name} {e.last_name}
                  </ThemedText>
                  <ThemedText style={styles.enrollSub} numberOfLines={1}>
                    {e.class_name} · {e.academic_session}
                    {e.registration_number ? ` · ${e.registration_number}` : ''}
                  </ThemedText>
                </View>
                <StatusBadge status={e.enrollment_status} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Class picker */}
      <Modal visible={classPickerOpen} transparent animationType="slide" onRequestClose={() => setClassPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setClassPickerOpen(false)}>
          <TouchableWithoutFeedback>
            <View style={styles.modalSheet}>
              <View style={styles.sheetHandle} />
              <ThemedText style={styles.modalTitle}>Filter by Class</ThemedText>
              <TouchableOpacity style={styles.clearRow} onPress={() => applyClassFilter(null)}>
                <Ionicons name="close-circle-outline" size={16} color={C.textMuted} />
                <ThemedText style={styles.clearRowText}>All classes</ThemedText>
              </TouchableOpacity>
              {classOptions.length === 0 ? (
                <ThemedText style={styles.modalEmptyText}>No classes found.</ThemedText>
              ) : (
                <FlatList
                  data={classOptions}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.modalItem} onPress={() => applyClassFilter(item)}>
                      <ThemedText style={styles.modalItemText}>{item.class_name}</ThemedText>
                      {classFilter?.id === item.id && <Ionicons name="checkmark" size={16} color={Colors.accent.gold} />}
                    </TouchableOpacity>
                  )}
                  contentContainerStyle={{ paddingBottom: 20 }}
                />
              )}
            </View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
      </Modal>

      {/* Session picker */}
      <Modal visible={sessionPickerOpen} transparent animationType="slide" onRequestClose={() => setSessionPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSessionPickerOpen(false)}>
          <TouchableWithoutFeedback>
            <View style={styles.modalSheet}>
              <View style={styles.sheetHandle} />
              <ThemedText style={styles.modalTitle}>Filter by Session</ThemedText>
              <TouchableOpacity style={styles.clearRow} onPress={() => applySessionFilter(null)}>
                <Ionicons name="close-circle-outline" size={16} color={C.textMuted} />
                <ThemedText style={styles.clearRowText}>All sessions</ThemedText>
              </TouchableOpacity>
              {sessionOptions.length === 0 ? (
                <ThemedText style={styles.modalEmptyText}>No sessions found.</ThemedText>
              ) : (
                <FlatList
                  data={sessionOptions}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.modalItem} onPress={() => applySessionFilter(item)}>
                      <ThemedText style={styles.modalItemText}>{item.year_label}</ThemedText>
                      {sessionFilter?.id === item.id && <Ionicons name="checkmark" size={16} color={Colors.accent.gold} />}
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

function StatusBadge({ status }: { status: string }) {
  const normalized = (status || '').toLowerCase();
  const colorMap: Record<string, string> = {
    active: '#22C55E',
    promoted: '#3B82F6',
    repeated: '#F59E0B',
    transferred: '#A855F7',
    graduated: '#94A3B8',
  };
  const color = colorMap[normalized] || '#94A3B8';
  const label = normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown';

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

    noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, padding: 12, marginHorizontal: isTiny ? 16 : 20, marginTop: 14, borderWidth: 1, borderColor: C.actionItemBorder },
    noticeText: { flex: 1, color: C.textMuted, fontSize: 11, lineHeight: 15 },

    filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: isTiny ? 16 : 20, marginTop: 12 },
    statusChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder },
    statusChipActive: { backgroundColor: `${Colors.accent.gold}20`, borderColor: Colors.accent.gold },
    statusChipText: { color: C.textMuted, fontSize: 11, fontWeight: '700' },
    statusChipTextActive: { color: Colors.accent.gold, fontWeight: '800' },

    filterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.actionItemBg, borderRadius: 14, borderWidth: 1, borderColor: C.actionItemBorder, paddingHorizontal: 12, paddingVertical: 9, flex: 1, maxWidth: '48%' },
    filterPillText: { flex: 1, color: C.text, fontSize: 11.5, fontWeight: '700' },

    scrollView: { flex: 1 },
    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 60 },

    countLabel: { color: C.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 },

    emptyCard: { backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 22, alignItems: 'center', gap: 8 },
    emptyText: { color: C.textMuted, fontSize: 12, fontWeight: '600' },

    list: { gap: 10 },
    enrollCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 12 },
    enrollIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: `${Colors.accent.gold}15`, justifyContent: 'center', alignItems: 'center' },
    enrollName: { color: C.text, fontSize: 13, fontWeight: '800' },
    enrollSub: { color: C.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2 },

    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: C.modalBg, borderColor: C.cardBorder, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: isTiny ? 16 : 24, borderTopWidth: 1, maxHeight: '75%' },
    sheetHandle: { width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginBottom: 14, textAlign: 'center' },
    modalEmptyText: { color: C.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 20 },
    modalItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 4 },
    modalItemText: { color: C.text, fontSize: 13, fontWeight: '600' },
    clearRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 4, marginBottom: 8, borderBottomWidth: 1, borderColor: C.divider },
    clearRowText: { color: C.textMuted, fontSize: 11.5, fontWeight: '600', flex: 1 },
  });
}
