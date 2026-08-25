import { useRouter } from 'expo-router';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  Platform,
  ActivityIndicator,
  Image,
  RefreshControl,
  Modal,
  ImageBackground,
  useWindowDimensions,
} from 'react-native';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { isSchoolOwner, decodeToken } from '@/utils/jwt-decoder';
import { clearAllStorage } from '@/utils/storage';
import { useTheme } from '@/contexts/theme-context';
import { Colors } from '@/constants/design-system';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';
import Footer from './components/Footer';

export default function DashboardPage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { themeColor, loadThemeFromPreferences } = useTheme();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, themeColor, width]);

  const [schoolData, setSchoolData] = useState<any>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  // Staff Onboarding: only the school owner sees/uses the "Manage Staff" entry.
  // Defaults to true so a lone owner account (or a token-decode failure)
  // never loses its own access.
  const [isOwner, setIsOwner] = useState(true);
  // A full admin (not owner, not class_teacher) can see the school-wide
  // Enrollments screen too — same tier used to gate class-teacher removal
  // in staff-directory.tsx.
  const [isFullAdmin, setIsFullAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusAlert, setStatusAlert] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
    onConfirm?: () => void;
    confirmLabel?: string;
  }>({
    visible: false,
    type: 'info',
    title: '',
    message: '',
  });

  const fetchDashboardData = useCallback(async () => {
    try {
      const token = Platform.OS !== 'web'
        ? await SecureStore.getItemAsync('userToken')
        : localStorage.getItem('userToken');

      if (!token) {
        router.replace('/(auth)');
        return;
      }

      setIsOwner(isSchoolOwner(token));
      const decoded = decodeToken(token);
      setIsFullAdmin(!isSchoolOwner(token) && decoded?.staffRole === 'admin');

      await loadThemeFromPreferences();

      const [schoolRes, sessionRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/schools/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/academic-sessions`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      // Handle subscription/payment required (402)
      if (schoolRes.status === 402 || sessionRes.status === 402) {
        router.replace('/pricing');
        return;
      }

      if (schoolRes.status === 401 || sessionRes.status === 401) {
        await clearAllStorage();
        router.replace('/(auth)');
        return;
      }

      const schoolResult = await schoolRes.json();
      if (schoolResult.success) setSchoolData(schoolResult.data);

      const sessionResult = await sessionRes.json();
      if (sessionResult.success && sessionResult.data.length > 0) {
        const activeSession = sessionResult.data.find((s: any) => s.is_active);
        if (activeSession) {
          setActiveSessionId(activeSession.id);
          const sid = String(activeSession.id);
          Platform.OS !== 'web'
            ? await SecureStore.setItemAsync('activeSessionId', sid)
            : localStorage.setItem('activeSessionId', sid);
        }
      }
    } catch (e: any) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'System Error',
        message: 'Unable to sync dashboard.'
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadThemeFromPreferences, router]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  const handleLogout = async () => {
    setStatusAlert({
      visible: true,
      type: 'warning',
      title: 'Portal Sign-out',
      message: 'Terminate administrative session?',
      confirmLabel: 'LOGOUT',
      onConfirm: async () => {
        await clearAllStorage();
        router.replace('/');
      }
    });
  };

  if (loading) return (
    <ThemedView style={styles.loader}>
      <ActivityIndicator size="large" color={Colors.accent.gold} />
      <ThemedText style={styles.loadingText}>SABINO EDU...</ThemedText>
    </ThemedView>
  );

  const isTiny = width < 300;

  return (
    <ThemedView style={styles.mainWrapper}>
      <StatusBar style={C.isDark ? 'light' : 'dark'} />

      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?q=80&w=2070' }}
        style={styles.hero}
        imageStyle={{ borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}
      >
        <LinearGradient
          colors={C.isDark ? ['rgba(15, 23, 42, 0.4)', 'rgba(15, 23, 42, 0.95)'] : ['rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0.95)']}
          style={styles.heroOverlay}
        >
          <View style={styles.header}>
            <View style={[styles.logoContainer, { backgroundColor: C.isDark ? '#FFFFFF' : '#F8FAFC' }]}>
              {schoolData?.logo ? (
                <Image source={{ uri: schoolData.logo }} style={styles.schoolLogo} />
              ) : (
                <View style={[styles.logoPlaceholder, { backgroundColor: themeColor + '20' }]}>
                  <Ionicons name="school" size={24} color={themeColor} />
                </View>
              )}
            </View>
            <TouchableOpacity onPress={handleLogout} style={styles.powerBtn}>
              <Ionicons name="power" size={18} color={Colors.accent.gold} />
            </TouchableOpacity>
          </View>

          <View style={styles.heroContent}>
            <ThemedText style={styles.schoolType}>
              {schoolData?.school_type?.toUpperCase() || 'REGISTERED INSTITUTION'}
            </ThemedText>
            <ThemedText style={styles.schoolName} numberOfLines={2}>
              {schoolData?.name?.toUpperCase() || 'SABINO EDU'}
            </ThemedText>
            <View style={styles.schoolMetaRow}>
              <View style={styles.metaBadge}>
                <Ionicons name="shield-checkmark" size={10} color={C.textSecondary} />
                <ThemedText style={styles.schoolReg}>REG: {schoolData?.registration_code || 'PENDING'}</ThemedText>
              </View>
              {schoolData?.email && (
                <View style={styles.metaBadge}>
                  <Ionicons name="mail" size={10} color={C.textSecondary} />
                  <ThemedText style={styles.schoolReg}>{schoolData.email}</ThemedText>
                </View>
              )}
              {schoolData?.phone && (
                <View style={styles.metaBadge}>
                  <Ionicons name="call" size={10} color={C.textSecondary} />
                  <ThemedText style={styles.schoolReg}>{schoolData.phone}</ThemedText>
                </View>
              )}
            </View>
          </View>
        </LinearGradient>
      </ImageBackground>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
      >
        <View style={[styles.card, { marginTop: 15 }]}>
          <ThemedText style={styles.cardLabel}>SCHOOL DETAILS</ThemedText>
          <View style={styles.actionList}>
            <DetailItem icon="map" label="Region" value={`${schoolData?.city || 'N/A'}, ${schoolData?.state || 'N/A'}`} C={C} styles={styles} />
            <DetailItem icon="location" label="Address" value={schoolData?.address || 'Address not set'} C={C} styles={styles} />
            <DetailItem icon="mail" label="Official Email" value={schoolData?.email || 'N/A'} C={C} styles={styles} />
            <DetailItem icon="call" label="Contact Number" value={schoolData?.phone || 'N/A'} C={C} styles={styles} />
          </View>
        </View>
        <View style={styles.card}>
          <ThemedText style={styles.cardLabel}>OPERATIONS CENTER</ThemedText>
          <View style={styles.actionList}>
            <ActionListItem title="Students" icon="people-outline" onPress={() => router.push('/students_list')} highlight themeColor={Colors.primary.main} C={C} styles={styles} />
            <ActionListItem title="Score Entry" icon="document-text-outline" onPress={() => router.push('/score-entry')} C={C} styles={styles} />
            {/* Attendance: available to BOTH owner/admin and class_teacher
                accounts, same as Teaching Assistant — class scoping for a
                class_teacher is enforced server-side (routes/attendance),
                so no isOwner gate is needed here. */}
            <ActionListItem title="Attendance" subtitle="Daily register, weekly grid & term summary" icon="checkmark-done-circle-outline" onPress={() => router.push('/attendance')} C={C} styles={styles} />
            <ActionListItem title="Reports" icon="copy-outline" onPress={() => router.push('/report-cards')} C={C} styles={styles} />
            {(isOwner || isFullAdmin) && (
              <ActionListItem title="Enrollments" subtitle="See every student's class & session enrollment" icon="list-outline" onPress={() => router.push('/enrollments')} C={C} styles={styles} />
            )}
            {/* Teaching Assistant: available to BOTH the school owner and
                admin/staff accounts — deliberately no isOwner gate, unlike
                Institution/Branding/Manage Staff below. */}
            <ActionListItem title="Teaching Assistant" subtitle="AI-assisted scheme of work, lesson plans & notes" icon="sparkles-outline" onPress={() => router.push('/teacher-ai')} C={C} styles={styles} />
            {isOwner && (
              <ActionListItem title="Institution" icon="business-outline" onPress={() => router.push('/school-profile')} C={C} styles={styles} />
            )}
            {isOwner && (
              <ActionListItem title="Branding" icon="color-palette-outline" onPress={() => router.push('/preferences')} C={C} styles={styles} />
            )}
            {isOwner && (
              <ActionListItem title="Manage Staff" subtitle="Add teachers/admins, invite codes" icon="people-circle-outline" onPress={() => router.push('/staff-directory')} C={C} styles={styles} />
            )}
            <ActionListItem title="Chat Support" subtitle="Chat us on WhatsApp if you have any issue" icon="logo-whatsapp" onPress={() => router.push('https://wa.me/2347042423411')} C={C} styles={styles} />
          </View>
        </View>

        <View style={{ flex: 1 }} />
        <Footer themeColor={themeColor} schoolName="SABINO EDU" onLogout={handleLogout} />
      </ScrollView>

      <Modal visible={statusAlert.visible} transparent animationType="fade" onRequestClose={() => setStatusAlert({ ...statusAlert, visible: false })}>
        <View style={styles.alertOverlay}>
          <View style={styles.alertBackdrop}><TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setStatusAlert({ ...statusAlert, visible: false })} activeOpacity={1} /></View>
          <View style={styles.alertContainerCentered}>
            <View style={styles.alertContent}>
              <View style={[styles.alertIconBox, { backgroundColor: `${statusAlert.type === 'warning' ? '#F59E0B' : statusAlert.type === 'error' ? '#EF4444' : '#3B82F6'}15` }]}>
                <Ionicons name={statusAlert.type === 'warning' ? 'warning' : statusAlert.type === 'error' ? 'alert-circle' : 'information-circle'} size={28} color={statusAlert.type === 'warning' ? '#F59E0B' : statusAlert.type === 'error' ? '#EF4444' : '#3B82F6'} />
              </View>
              <View style={styles.alertTextBox}>
                <ThemedText style={styles.alertTitle}>{statusAlert.title}</ThemedText>
                <ThemedText style={styles.alertMessage}>{statusAlert.message}</ThemedText>
              </View>
              <TouchableOpacity onPress={() => setStatusAlert({ ...statusAlert, visible: false })}><Ionicons name="close" size={18} color="rgba(255,255,255,0.4)" /></TouchableOpacity>
            </View>
            <View style={styles.alertActions}>
              {statusAlert.confirmLabel ? (
                <>
                  <TouchableOpacity style={styles.alertBtnCancel} onPress={() => setStatusAlert({ ...statusAlert, visible: false })}><ThemedText style={styles.alertBtnCancelText}>CANCEL</ThemedText></TouchableOpacity>
                  <TouchableOpacity style={[styles.alertBtnConfirm, { backgroundColor: statusAlert.type === 'warning' ? '#EF4444' : '#FACC15' }]} onPress={() => { setStatusAlert({ ...statusAlert, visible: false }); statusAlert.onConfirm?.(); }}><ThemedText style={styles.alertBtnText}>{statusAlert.confirmLabel}</ThemedText></TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={[styles.alertBtnSingle, { backgroundColor: '#FACC15' }]} onPress={() => setStatusAlert({ ...statusAlert, visible: false })}><ThemedText style={styles.alertBtnText}>OK</ThemedText></TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

function ActionListItem({ title, subtitle, icon, onPress, themeColor, highlight, C, styles }: any) {
  return (
    <TouchableOpacity
      style={[styles.actionListItem, { backgroundColor: highlight ? themeColor + '10' : C.actionItemBg, borderColor: highlight ? themeColor + '40' : C.actionItemBorder }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.actionListLeft}>
        <View style={[styles.actionListIconWrap, { backgroundColor: highlight ? themeColor + '15' : C.actionIconWrap }]}> 
          <Ionicons name={icon} size={18} color={highlight ? themeColor : Colors.accent.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText style={[styles.actionListTitle, { fontWeight: highlight ? '800' : '700' }]} numberOfLines={1}>{title}</ThemedText>
          {subtitle ? (
            <ThemedText style={{ color: C.textMuted, fontSize: 10, marginTop: 2 }} numberOfLines={2}>{subtitle}</ThemedText>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
    </TouchableOpacity>
  );
}

function DetailItem({ icon, label, value, C, styles }: any) {
  return (
    <View style={[styles.actionListItem, { backgroundColor: C.actionItemBg, borderColor: C.actionItemBorder }]}>
      <View style={styles.actionListLeft}>
        <View style={[styles.actionListIconWrap, { backgroundColor: C.actionIconWrap }]}>
          <Ionicons name={icon} size={18} color={Colors.accent.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedText style={{ color: C.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginBottom: 2 }}>{label.toUpperCase()}</ThemedText>
          <ThemedText style={{ color: C.text, fontSize: 13, fontWeight: '800' }} numberOfLines={2}>{value}</ThemedText>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) => {
  const isTiny = width < 320;
  const isNano = width < 280;
  return StyleSheet.create({
    mainWrapper: { flex: 1, backgroundColor: C.background },
    loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
    loadingText: { color: Colors.accent.gold, marginTop: 12, fontSize: 10, fontWeight: '800', letterSpacing: 2 },

    hero: { height: isTiny ? 280 : 340, width: '100%', zIndex: 100, marginBottom: 2, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12 },
    heroOverlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24, paddingTop: Platform.OS === 'ios' ? 60 : 45 },
    header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
    logoContainer: { width: isNano ? 48 : 56, height: isNano ? 48 : 56, borderRadius: 16, padding: 3, elevation: 4 },
    schoolLogo: { width: '100%', height: '100%', borderRadius: 14 },
    logoPlaceholder: { width: '100%', height: '100%', borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    powerBtn: { width: isNano ? 32 : 36, height: isNano ? 32 : 36, borderRadius: 18, backgroundColor: 'rgba(239, 68, 68, 0.15)', justifyContent: 'center', alignItems: 'center' },

    heroContent: { marginTop: 'auto', marginBottom: isTiny ? 60 : 70 },
    schoolType: { color: C.isDark ? Colors.accent.gold : '#2563EB', fontSize: isNano ? 8 : 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 6 },
    schoolName: { color: C.text, fontSize: isNano ? 20 : isTiny ? 24 : 28, fontWeight: '900', letterSpacing: -0.5, marginBottom: 10 },

    schoolMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    metaBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, gap: 4, backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
    schoolReg: { color: C.textSecondary, fontSize: isNano ? 8 : 9, fontWeight: '700' },

    scrollView: { flex: 1, marginTop: 0, zIndex: 1 },
    scrollContent: { paddingHorizontal: isTiny ? 16 : 24, paddingBottom: 60, flexGrow: 1 },

    alertOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.6)' },
    alertBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
    alertContainerCentered: { backgroundColor: '#1E293B', borderRadius: 24, padding: 20, width: '100%', maxWidth: 340 },
    alertContent: { flexDirection: 'row', alignItems: 'flex-start' },
    alertIconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    alertTextBox: { flex: 1, paddingRight: 8 },
    alertTitle: { fontWeight: '700', color: '#fff', marginBottom: 4, fontSize: 16 },
    alertMessage: { color: 'rgba(255,255,255,0.6)', lineHeight: 18, fontSize: 13 },
    alertActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
    alertBtnCancel: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
    alertBtnCancelText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
    alertBtnConfirm: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
    alertBtnSingle: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
    alertBtnText: { color: '#0F172A', fontSize: 13, fontWeight: '700' },

    card: { backgroundColor: C.card, borderRadius: 28, padding: isTiny ? 16 : 20, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 20 },
    cardLabel: { color: C.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 20 },

    actionList: { gap: 14 },
    actionListItem: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16, paddingVertical: 10, paddingLeft: 10, borderRadius: 16, borderWidth: 1 },
    actionListLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    actionListIconWrap: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    actionListTitle: { color: C.text, fontSize: 12, letterSpacing: 0.5 },
  });
}