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
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '@/utils/api-service';
import { Colors } from '@/constants/design-system';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';
import {
  getToken,
  teacherAiApi,
  DocType,
  DOC_TYPE_LABELS,
  DOC_TYPE_TO_CONTENT_TYPE,
} from '@/utils/teacher-ai-api';

interface DocRow {
  id: number;
  title: string;
  status: 'draft' | 'approved';
  subjectId: number | null;
  classId: number | null;
  term: string | null;
  session: string | null;
  updatedAt: string;
  teacherName: string | null;
}

export default function TeacherAiDocumentsPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const type = (params.type as DocType) || 'lesson-notes';
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;
  const label = DOC_TYPE_LABELS[type] || 'Documents';

  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'mine' | 'approved'>('mine');
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [subjectsById, setSubjectsById] = useState<Record<number, string>>({});
  const [classesById, setClassesById] = useState<Record<number, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadLookups = useCallback(async (token: string) => {
    try {
      const [classesRes, subjectsRes] = await Promise.all([
        // /api/classes/school — this school's own classes.id (the real FK
        // ai_scheme_of_work.class_id etc. reference), not the
        // global_class_templates ids GET /api/classes (no /school) returns.
        fetch(`${API_BASE_URL}/api/classes/school`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/classes/subjects`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const classesData = await classesRes.json();
      const subjectsData = await subjectsRes.json();
      if (classesData.success && Array.isArray(classesData.data)) {
        const map: Record<number, string> = {};
        classesData.data.forEach((c: any) => { map[c.id] = c.class_name; });
        setClassesById(map);
      }
      if (subjectsData.success && Array.isArray(subjectsData.data)) {
        const map: Record<number, string> = {};
        subjectsData.data.forEach((s: any) => { map[s.id] = s.subject_name || s.name; });
        setSubjectsById(map);
      }
    } catch (e) {
      // Non-fatal — the list still works, just without subject/class labels.
    }
  }, []);

  const fetchDocs = useCallback(async (currentTab: 'mine' | 'approved') => {
    try {
      setErrorMsg(null);
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }

      await loadLookups(token);

      const res = currentTab === 'mine'
        ? await teacherAiApi.listDocuments(token, type)
        : await teacherAiApi.listApprovedDocuments(token, type);

      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 401) { router.replace('/(auth)'); return; }

      const result = await res.json();
      if (result.success) {
        setDocs(result.data || []);
      } else {
        setErrorMsg(result.error || 'Failed to load documents.');
      }
    } catch (e) {
      setErrorMsg('Network error. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(true);
    }
  }, [type, router, loadLookups]);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedOnce) {
        fetchDocs(tab);
      } else {
        setLoading(true);
        fetchDocs(tab);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchDocs, tab])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchDocs(tab);
  };

  const switchTab = (next: 'mine' | 'approved') => {
    if (next === tab) return;
    setTab(next);
    setLoading(true);
    fetchDocs(next);
  };

  const openNew = () => {
    router.push({
      pathname: '/teacher-ai-chat',
      params: { contentType: DOC_TYPE_TO_CONTENT_TYPE[type] },
    } as any);
  };

  const openDoc = (id: number) => {
    router.push({ pathname: '/teacher-ai-editor', params: { type, id: String(id) } } as any);
  };

  // Group by subject · class · term, per addendum §1.4 ("grouped by
  // subject, class and term").
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; rows: DocRow[] }>();
    for (const doc of docs) {
      const subjectLabel = doc.subjectId ? subjectsById[doc.subjectId] || `Subject #${doc.subjectId}` : 'No subject';
      const classLabel = doc.classId ? classesById[doc.classId] || `Class #${doc.classId}` : 'No class';
      const termLabel = doc.term || 'No term';
      const key = `${subjectLabel}__${classLabel}__${termLabel}`;
      if (!map.has(key)) map.set(key, { key, label: `${subjectLabel} · ${classLabel} · ${termLabel}`, rows: [] });
      map.get(key)!.rows.push(doc);
    }
    return Array.from(map.values());
  }, [docs, subjectsById, classesById]);

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading {label}s...</ThemedText>
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
        <ThemedText style={styles.headerTitle} numberOfLines={1}>{label}</ThemedText>
        <TouchableOpacity onPress={openNew} style={styles.addBtn}>
          <Ionicons name="add" size={isTiny ? 20 : 24} color="#0F172A" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'mine' && styles.tabBtnActive]} onPress={() => switchTab('mine')}>
          <ThemedText style={[styles.tabText, tab === 'mine' && styles.tabTextActive]}>My {label}s</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'approved' && styles.tabBtnActive]} onPress={() => switchTab('approved')}>
          <ThemedText style={[styles.tabText, tab === 'approved' && styles.tabTextActive]}>Approved (School-wide)</ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
      >
        {tab === 'approved' && (
          <View style={styles.noticeBanner}>
            <Ionicons name="eye-outline" size={15} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>
              Read-only oversight view of every teacher's approved {label.toLowerCase()}s at this school.
            </ThemedText>
          </View>
        )}

        {errorMsg && (
          <View style={[styles.noticeBanner, { borderColor: '#EF444440' }]}>
            <Ionicons name="alert-circle-outline" size={15} color="#EF4444" />
            <ThemedText style={[styles.noticeText, { color: '#EF4444' }]}>{errorMsg}</ThemedText>
          </View>
        )}

        {groups.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-outline" size={28} color={C.textMuted} style={{ marginBottom: 8 }} />
            <ThemedText style={styles.emptyText}>
              {tab === 'mine' ? `No ${label.toLowerCase()}s yet. Tap + to start one with Sabino AI.` : 'No approved documents yet.'}
            </ThemedText>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={{ marginBottom: 20 }}>
              <ThemedText style={styles.groupLabel} numberOfLines={1}>{group.label.toUpperCase()}</ThemedText>
              <View style={styles.list}>
                {group.rows.map((doc) => (
                  <TouchableOpacity key={doc.id} style={styles.docCard} onPress={() => openDoc(doc.id)} activeOpacity={0.75}>
                    <View style={styles.docIconWrap}>
                      <Ionicons name="document-text-outline" size={18} color={Colors.accent.gold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={styles.docTitle} numberOfLines={1}>{doc.title || `Untitled ${label}`}</ThemedText>
                      <ThemedText style={styles.docSub} numberOfLines={1}>
                        {tab === 'approved' && doc.teacherName ? `${doc.teacherName} · ` : ''}
                        Updated {new Date(doc.updatedAt).toLocaleDateString()}
                      </ThemedText>
                    </View>
                    <StatusBadge status={doc.status} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </ThemedView>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isApproved = status === 'approved';
  const color = isApproved ? '#22C55E' : '#F59E0B';
  return (
    <View style={[badgeStyles.badge, { backgroundColor: `${color}15`, borderColor: `${color}40` }]}>
      <View style={[badgeStyles.dot, { backgroundColor: color }]} />
      <ThemedText style={[badgeStyles.text, { color }]}>{isApproved ? 'Approved' : 'Draft'}</ThemedText>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 9.5, fontWeight: '800' },
});

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
    loadingText: { color: Colors.accent.gold, marginTop: 15, fontWeight: '800', fontSize: 10, letterSpacing: 2 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: isTiny ? 15 : 20, paddingBottom: 16, backgroundColor: C.modalBg, borderBottomWidth: 1, borderColor: C.divider },
    backBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', color: C.text, fontSize: isTiny ? 14 : 16, fontWeight: '800', marginHorizontal: 8 },
    addBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center' },

    tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: isTiny ? 15 : 20, paddingVertical: 12, backgroundColor: C.modalBg, borderBottomWidth: 1, borderColor: C.divider },
    tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center', backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder },
    tabBtnActive: { backgroundColor: `${Colors.accent.gold}15`, borderColor: Colors.accent.gold },
    tabText: { color: C.textMuted, fontSize: 10.5, fontWeight: '800' },
    tabTextActive: { color: Colors.accent.gold },

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 60 },

    noticeBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: C.actionItemBorder },
    noticeText: { flex: 1, color: C.textMuted, fontSize: 11, lineHeight: 15 },

    emptyCard: { backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 24, alignItems: 'center' },
    emptyText: { color: C.textMuted, fontSize: 12, fontWeight: '600', textAlign: 'center' },

    groupLabel: { color: C.textMuted, fontSize: 9.5, fontWeight: '900', letterSpacing: 1, marginBottom: 10 },
    list: { gap: 10 },
    docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 12 },
    docIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: `${Colors.accent.gold}15`, justifyContent: 'center', alignItems: 'center' },
    docTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
    docSub: { color: C.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2 },
  });
}
