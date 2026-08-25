import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/design-system';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';
import { getToken, teacherAiApi, ContentType, DOC_TYPE_LABELS, CONTENT_TYPE_TO_DOC_TYPE } from '@/utils/teacher-ai-api';

interface ConversationSummary {
  id: number;
  contentType: ContentType | null;
  title: string | null;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
}

// teacher_ai_chat history — the "Ask Sabino AI" screen only ever opened
// a brand-new blank conversation (see teacher-ai.tsx's openChat). The
// backend has kept every past thread all along (GET /api/teacher-ai/chat
// already listed them) — this screen is the first place in the app that
// actually surfaces that list so a teacher can find and resume one.
export default function TeacherAiHistoryPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;

  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [alert, setAlert] = useState<{ visible: boolean; type: 'success' | 'error' | 'info'; message: string }>({
    visible: false,
    type: 'info',
    message: '',
  });

  const fetchConversations = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }

      const res = await teacherAiApi.listConversations(token);
      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 401) { router.replace('/(auth)'); return; }

      const result = await res.json();
      if (result.success) {
        setConversations(result.data || []);
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || 'Failed to load your conversations.' });
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
      if (hasLoadedOnce) {
        fetchConversations();
      } else {
        setLoading(true);
        fetchConversations();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchConversations])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchConversations();
  };

  const openConversation = (id: number) => {
    router.push({ pathname: '/teacher-ai-chat', params: { conversationId: String(id) } } as any);
  };

  const startNewChat = () => router.push('/teacher-ai-chat' as any);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }

      const res = await teacherAiApi.deleteConversation(token, id);
      const result = await res.json();
      if (result.success) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || 'Failed to delete.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading conversations...</ThemedText>
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
        <ThemedText style={styles.headerTitle} numberOfLines={1}>Ask Sabino AI History</ThemedText>
        <TouchableOpacity onPress={startNewChat} style={styles.addBtn}>
          <Ionicons name="add" size={isTiny ? 20 : 24} color="#0F172A" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
      >
        {conversations.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="chatbubbles-outline" size={28} color={C.textMuted} style={{ marginBottom: 8 }} />
            <ThemedText style={styles.emptyText}>No conversations yet. Start one below.</ThemedText>
            <TouchableOpacity style={styles.emptyStartBtn} onPress={startNewChat}>
              <ThemedText style={styles.emptyStartBtnText}>Ask Sabino AI</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.list}>
            {conversations.map((c) => (
              <View key={c.id} style={styles.convCard}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                  onPress={() => openConversation(c.id)}
                  activeOpacity={0.75}
                >
                  <View style={styles.convIconWrap}>
                    <Ionicons name="sparkles" size={16} color={Colors.accent.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.convTitle} numberOfLines={1}>
                      {c.title || 'Untitled conversation'}
                    </ThemedText>
                    <ThemedText style={styles.convSub} numberOfLines={1}>
                      {c.contentType ? `${DOC_TYPE_LABELS[CONTENT_TYPE_TO_DOC_TYPE[c.contentType]]} · ` : ''}
                      {c.messageCount} message{c.messageCount === 1 ? '' : 's'} · {formatDate(c.updatedAt)}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(c.id)}
                  disabled={deletingId === c.id}
                >
                  {deletingId === c.id ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {alert.visible && (
        <CustomAlert type={alert.type} message={alert.message} onClose={() => setAlert({ ...alert, visible: false })} />
      )}
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
    headerTitle: { flex: 1, textAlign: 'center', color: C.text, fontSize: isTiny ? 14 : 16, fontWeight: '800', marginHorizontal: 8 },
    addBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center' },

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 60 },

    emptyCard: { backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 24, alignItems: 'center' },
    emptyText: { color: C.textMuted, fontSize: 12, fontWeight: '600', textAlign: 'center', marginBottom: 14 },
    emptyStartBtn: { backgroundColor: Colors.accent.gold, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
    emptyStartBtnText: { color: '#0F172A', fontSize: 12.5, fontWeight: '800' },

    list: { gap: 10 },
    convCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 12 },
    convIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: `${Colors.accent.gold}15`, justifyContent: 'center', alignItems: 'center' },
    convTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
    convSub: { color: C.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2 },
    deleteBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#EF444415', justifyContent: 'center', alignItems: 'center' },
  });
}
