import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/design-system';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';

// teacher_ai_home — a gradient "Ask Sabino AI" CTA that opens the chat
// directly, plus the File Library (real PDF/Word uploads for Scheme
// of Work, Lesson Plan, Lesson Note). Available to BOTH the school
// owner and admin/staff accounts — unlike Manage Staff/Institution/
// Branding elsewhere on the dashboard, this screen has no isOwner gate.
export default function TeacherAiHomePage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;

  const openChat = () => router.push('/teacher-ai-chat' as any);

  const openLibrary = (type: 'scheme_of_work' | 'lesson_plan' | 'lesson_note') =>
    router.push({ pathname: '/document-library', params: { type } } as any);

  const openAllFiles = () => router.push({ pathname: '/document-library', params: { type: 'all' } } as any);

  return (
    <ThemedView style={styles.container}>
      <StatusBar style={C.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={isTiny ? 18 : 22} color={C.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Teaching Assistant</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity activeOpacity={0.9} onPress={openChat}>
          <LinearGradient colors={['#2563EB', '#1E40AF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.aiCard}>
            <View style={styles.aiIconWrap}>
              <Ionicons name="sparkles" size={22} color="#FACC15" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.aiTitle}>Ask Sabino AI</ThemedText>
              <ThemedText style={styles.aiSub}>Generate a scheme of work, lesson plan or lesson note in seconds.</ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.9} onPress={() => router.push('/teacher-ai-history' as any)} style={styles.historyRow}>
          <Ionicons name="time-outline" size={16} color={C.textMuted} />
          <ThemedText style={styles.historyRowText}>View past conversations</ThemedText>
          <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
        </TouchableOpacity>

        <ThemedText style={styles.sectionLabel}>FILE LIBRARY</ThemedText>
        <ThemedText style={styles.fileLibraryDesc}>
          Upload or browse the official school document, or your own personal copy.
        </ThemedText>
        <View style={styles.list}>
          <TypeRow
            icon="albums-outline"
            title="All Files"
            desc="Every file you can see in one place — school-wide and your own personal uploads, all types."
            onPress={openAllFiles}
            C={C}
            styles={styles}
          />
          <TypeRow
            icon="folder-open-outline"
            title="Scheme of Work Files"
            desc="Official document, plus any personal copy you've uploaded."
            onPress={() => openLibrary('scheme_of_work')}
            C={C}
            styles={styles}
          />
          <TypeRow
            icon="folder-open-outline"
            title="Lesson Plan Files"
            desc="Official document, plus any personal copy you've uploaded."
            onPress={() => openLibrary('lesson_plan')}
            C={C}
            styles={styles}
          />
          <TypeRow
            icon="folder-open-outline"
            title="Lesson Note Files"
            desc="Official document, plus any personal copy you've uploaded."
            onPress={() => openLibrary('lesson_note')}
            C={C}
            styles={styles}
          />
        </View>

        <View style={styles.noticeBanner}>
          <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
          <ThemedText style={styles.noticeText}>
            AI-generated content may contain errors. You are encouraged to review before use.
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function TypeRow({ icon, title, desc, onPress, C, styles }: any) {
  return (
    <TouchableOpacity style={styles.typeRow} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.typeIconWrap}>
        <Ionicons name={icon} size={19} color={Colors.accent.gold} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.typeTitle}>{title}</ThemedText>
        <ThemedText style={styles.typeDesc} numberOfLines={2}>{desc}</ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
    </TouchableOpacity>
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

    aiCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 24, padding: isTiny ? 16 : 20, marginBottom: 26, shadowColor: '#2563EB', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder, borderRadius: 14, padding: 12, marginTop: -12, marginBottom: 26 },
    historyRowText: { flex: 1, color: C.textMuted, fontSize: 11.5, fontWeight: '700' },
    aiIconWrap: { width: 46, height: 46, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' },
    aiTitle: { color: '#fff', fontSize: 15, fontWeight: '900' },
    aiSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 4, lineHeight: 15 },

    sectionLabel: { color: C.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 },
    fileLibraryDesc: { color: C.textMuted, fontSize: 10.5, marginBottom: 12, lineHeight: 14 },

    list: { gap: 10 },
    typeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 14 },
    typeIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: `${Colors.accent.gold}15`, justifyContent: 'center', alignItems: 'center' },
    typeTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
    typeDesc: { color: C.textMuted, fontSize: 10.5, marginTop: 3, lineHeight: 14 },

    noticeBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, padding: 12, marginTop: 24, borderWidth: 1, borderColor: C.actionItemBorder },
    noticeText: { flex: 1, color: C.textMuted, fontSize: 10.5, lineHeight: 15 },
  });
}
