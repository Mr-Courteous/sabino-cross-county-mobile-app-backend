import React, { useState, useEffect, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Image,
    Platform,
    RefreshControl,
    Modal,
    Linking,
    ImageBackground,
    useWindowDimensions,
    Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { clearAllStorage } from '@/utils/storage';
import Footer from '../components/Footer';
import EditProfileModal from '../../components/EditProfileModal';
import { Colors } from '@/constants/design-system';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { useAppColors } from '@/hooks/use-app-colors';

interface StudentData {
    id: number;
    school_id: number;
    first_name: string;
    last_name: string;
    email: string;
    registration_number: string;
    phone?: string;
    date_of_birth?: string;
    gender?: string;
    photo?: string;
    school_name?: string;
}

export default function StudentDashboard() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const C = useAppColors();
    const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);

    function CompactActionCard({ icon, label, color, onPress }: any) {
        return (
            <TouchableOpacity style={styles.compactCard} onPress={onPress}>
                <View style={[styles.compactIcon, { backgroundColor: `${color}15` }]}>
                    <Ionicons name={icon} size={18} color={color} />
                </View>
                <Text style={styles.compactLabel}>{label}</Text>
            </TouchableOpacity>
        );
    }

    const [student, setStudent] = useState<StudentData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);

    // Enrollment State
    const [enrollModalVisible, setEnrollModalVisible] = useState(false);
    const [sessions, setSessions] = useState<any[]>([]);
    const [classes, setClasses] = useState<any[]>([]);
    const [enrollments, setEnrollments] = useState<any[]>([]);
    const [selectedSession, setSelectedSession] = useState<string>('');
    const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
    const [enrollLoading, setEnrollLoading] = useState(false);
    const [statusAlert, setStatusAlert] = useState<{
        visible: boolean;
        type: 'success' | 'error' | 'warning' | 'info';
        title: string;
        message: string;
        onConfirm?: () => void;
    }>({
        visible: false,
        type: 'info',
        title: '',
        message: '',
    });
    const [editProfileVisible, setEditProfileVisible] = useState(false);
    const [showSessionSelector, setShowSessionSelector] = useState(false);
    const [showClassSelector, setShowClassSelector] = useState(false);

    // Modal Feedback State
    const [enrollError, setEnrollError] = useState<string | null>(null);
    const [enrollSuccess, setEnrollSuccess] = useState(false);

    useEffect(() => {
        if (!enrollModalVisible) {
            setEnrollError(null);
            setEnrollSuccess(false);
        }
    }, [enrollModalVisible]);

    const handleAuthError = (message: string) => {
        setAuthErrorMessage(message);
    };

    useEffect(() => {
        initializeDashboard();
    }, []);

    const initializeDashboard = async () => {
        setLoading(true);
        const startTime = Date.now();
        try {
            // 1. Check Student Data
            let studentData: string | null = null;
            if (Platform.OS === 'web') {
                studentData = localStorage.getItem('studentData');
            } else {
                studentData = await SecureStore.getItemAsync('studentData');
            }

            if (!studentData) {
                handleAuthError('Session not found. Please log in again.');
                return;
            }
            const parsed = JSON.parse(studentData);
            setStudent(parsed);

            // 2. Check Token & Enrollments
            const token = Platform.OS === 'web'
                ? localStorage.getItem('studentToken')
                : await SecureStore.getItemAsync('studentToken');

            if (!token) {
                handleAuthError('Authentication token missing.');
                return;
            }

            const res = await fetch(`${API_BASE_URL}/api/students/me/enrollments`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.status === 401 || res.status === 403) {
                const errorData = await res.json().catch(() => ({}));
                handleAuthError(errorData.error || 'Your session has expired. Please log in again.');
                return;
            }

            const data = await res.json();
            if (data && data.success) {
                setEnrollments(data.data || []);
            }
        } catch (error) {
            console.error('Dashboard Init Error:', error);
        } finally {
            // Ensure syncing screen lingers for at least 2 seconds for a premium feel
            const elapsedTime = Date.now() - startTime;
            const delay = Math.max(0, 2000 - elapsedTime);
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            setLoading(false);
        }
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await initializeDashboard();
        setRefreshing(false);
    };

    const performLogout = async () => {
        await clearAllStorage();
        router.replace('/');
    };

    const handleLogout = async () => {
        setStatusAlert({
            visible: true,
            type: 'warning',
            title: 'Logout',
            message: 'Exit the student portal?',
            onConfirm: performLogout
        });
    };

    const openEnrollmentModal = async () => {
        setEnrollModalVisible(true);
        await fetchEnrollmentOptions();
    };

    const fetchEnrollmentOptions = async () => {
        try {
            const token = Platform.OS === 'web'
                ? localStorage.getItem('studentToken')
                : await SecureStore.getItemAsync('studentToken');

            if (!token) return;

            const [sessionRes, classRes] = await Promise.all([
                fetch(`${API_BASE_URL}/api/academic-sessions`, { headers: { Authorization: `Bearer ${token}` } }),
                // /api/classes/school — real classes.id (what
                // students.self-enroll's classId is checked against),
                // not the global_class_templates ids /api/classes returns.
                fetch(`${API_BASE_URL}/api/classes/school`, { headers: { Authorization: `Bearer ${token}` } })
            ]);

            if (sessionRes.status === 401 || sessionRes.status === 403 || classRes.status === 401 || classRes.status === 403) {
                setEnrollModalVisible(false);
                handleAuthError('Your session has expired. Please log in again.');
                return;
            }

            const sessionData = await sessionRes.json();
            const classData = await classRes.json();

            if (sessionData.success) {
                setSessions(sessionData.data);
                if (sessionData.data.length > 0) {
                    setSelectedSession(sessionData.data[0].year_label || sessionData.data[0].session_name);
                }
            }
            if (classData.success) setClasses(classData.data);
        } catch (error) {
            setEnrollError('Connection failure.');
        }
    };

    const handleSelfEnroll = async () => {
        if (!selectedSession || !selectedClassId) {
            setEnrollError('Selection required.');
            return;
        }

        setEnrollLoading(true);
        setEnrollError(null);
        try {
            const token = Platform.OS === 'web'
                ? localStorage.getItem('studentToken')
                : await SecureStore.getItemAsync('studentToken');

            const response = await fetch(`${API_BASE_URL}/api/students/self-enroll`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    academicSession: selectedSession,
                    classId: selectedClassId
                })
            });

            const data = await response.json();
            if (response.status === 401 || response.status === 403) {
                setEnrollModalVisible(false);
                handleAuthError(data.error || 'Your session has expired. Please log in again.');
                return;
            }

            if (data.success) {
                setEnrollSuccess(true);
                onRefresh();
            } else {
                setEnrollError(data.error || 'Enrollment failed.');
            }
        } catch (error) {
            setEnrollError('Network interruption.');
        } finally {
            setEnrollLoading(false);
        }
    };

    if (authErrorMessage) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
                <CustomAlert
                    type="error"
                    title="Access Denied"
                    message={authErrorMessage}
                    onClose={async () => {
                        await clearAllStorage();
                        router.replace('/(student)');
                    }}
                />
            </View>
        );
    }

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={Colors.accent.gold} />
                <Text style={styles.loadingText}>SYNCING...</Text>
            </View>
        );
    }

    if (!student) return null;

    const isTiny = width < 320;
    const isNano = width < 280;

    return (
        <View style={styles.container}>
            {statusAlert.visible && (
                <CustomAlert
                    {...statusAlert}
                    onClose={async () => {
                        if (statusAlert.onClose) {
                            await statusAlert.onClose();
                        }
                        setStatusAlert({ ...statusAlert, visible: false });
                    }}
                    style={{ marginHorizontal: isTiny ? 16 : 24, marginVertical: 10 }}
                />
            )}
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
            >

                <ImageBackground
                    source={{ uri: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2070' }}
                    style={styles.heroHeader}
                    imageStyle={{ borderBottomLeftRadius: isTiny ? 30 : 40, borderBottomRightRadius: isTiny ? 30 : 40 }}
                >
                    <LinearGradient
                        colors={C.isDark ? ['rgba(15, 23, 42, 0.4)', 'rgba(15, 23, 42, 0.95)'] : ['rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0.95)']}
                        style={styles.heroOverlay}
                    >
                        <View style={styles.topRow}>
                            <View style={styles.logoBadge}>
                                <Ionicons name="school" size={16} color="#FACC15" />
                                <Text style={styles.logoText}>SABINO EDU</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                                <TouchableOpacity style={styles.settingsFab} onPress={() => router.push('/(student)/preferences' as any)}>
                                    <Ionicons name="settings-outline" size={18} color={Colors.accent.gold} />
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.logoutFab} onPress={handleLogout}>
                                    <Ionicons name="power" size={18} color="#EF4444" />
                                </TouchableOpacity>
                            </View>
                        </View>

                        <View style={styles.welcomeInfo}>
                            <Text style={styles.greeting}>ACCESS GRANTED</Text>
                            <Text style={styles.studentName} numberOfLines={1}>{student.first_name} {student.last_name}</Text>
                            <View style={styles.regBadge}>
                                <Text style={styles.regText}>{student.registration_number}</Text>
                            </View>
                        </View>
                    </LinearGradient>
                </ImageBackground>

                <View style={[styles.section, { marginTop: 0 }]}>
                    <View style={styles.glassCard}>
                        <View style={styles.idCardHeader}>
                            <View style={styles.idCardBrand}>
                                <Ionicons name="shield-checkmark" size={16} color="#FACC15" />
                                <Text style={styles.idCardBrandText}>{(student.school_name || 'ACADEMIC IDENTITY').toUpperCase()}</Text>
                            </View>
                            <TouchableOpacity style={styles.idCardEdit} onPress={() => setEditProfileVisible(true)}>
                                <Ionicons name="pencil" size={12} color="#FACC15" />
                            </TouchableOpacity>
                        </View>

                        <View style={[styles.profileSummary, isNano && { flexDirection: 'column', alignItems: 'center' }]}>
                            <View style={styles.avatarLarge}>
                                {student.photo ? (
                                    <Image source={{ uri: student.photo }} style={styles.avatarImg} />
                                ) : (
                                    <View style={styles.avatarLargePlaceholder}>
                                        <Text style={styles.avatarLargeText}>
                                            {student.first_name[0]}{student.last_name[0]}
                                        </Text>
                                    </View>
                                )}
                                <View style={styles.onlineSignal} />
                            </View>

                            <View style={[styles.idInfo, isNano && { marginLeft: 0, marginTop: 12, alignItems: 'center' }]}>
                                <Text style={styles.idNameText}>{student.first_name} {student.last_name}</Text>
                                <Text style={styles.idRegValue}>{student.registration_number}</Text>
                                <View style={styles.schoolTag}>
                                    <Ionicons name="business" size={10} color={C.textMuted} />
                                    <Text style={[styles.schoolTagText, isNano && { textAlign: 'center' }]} numberOfLines={1}>{student.school_name || 'Global Academy'}</Text>
                                </View>
                            </View>
                        </View>

                        <View style={styles.cardDivider} />

                        <View style={styles.miniStats}>
                            <View style={styles.statItem}>
                                <Text style={styles.statLabel}>CLASSES</Text>
                                <Text style={styles.statValue}>{enrollments.length}</Text>
                            </View>
                            <View style={styles.divider} />
                            <View style={styles.statItem}>
                                <Text style={styles.statLabel}>GENDER</Text>
                                <Text style={styles.statValue}>{student.gender || 'N/A'}</Text>
                            </View>
                            <View style={styles.divider} />
                            <View style={styles.statItem}>
                                <Text style={styles.statLabel}>DOB</Text>
                                <Text style={styles.statValue}>{student.date_of_birth ? new Date(student.date_of_birth).toLocaleDateString() : 'N/A'}</Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.contactSection}>
                        <View style={[styles.contactGrid, isNano && { flexDirection: 'column' }]}>
                            <View style={styles.contactCard}>
                                <View style={styles.contactIconBox}><Ionicons name="mail" size={14} color="#3B82F6" /></View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.contactLabel}>EMAIL ADDRESS</Text>
                                    <Text style={styles.contactValue} numberOfLines={1}>{student.email || 'N/A'}</Text>
                                </View>
                            </View>
                            <View style={styles.contactCard}>
                                <View style={styles.contactIconBox}><Ionicons name="call" size={14} color="#10B981" /></View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.contactLabel}>PHONE NUMBER</Text>
                                    <Text style={styles.contactValue}>{student.phone || 'N/A'}</Text>
                                </View>
                            </View>
                        </View>

                        <View style={[styles.contactCard, { marginTop: 10, width: '100%' }]}>
                            <View style={styles.contactIconBox}><Ionicons name="location" size={14} color="#F59E0B" /></View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.contactLabel}>RESIDENTIAL LOCATION</Text>
                                <Text style={styles.contactValue} numberOfLines={2}>{student.address || 'Address not registered in system'}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>OPERATIONS</Text>
                    <View style={[styles.actionGrid, isTiny && { flexDirection: 'column' }]}>
                        <CompactActionCard icon="add-circle" label="ENROLL" color="#FACC15" onPress={openEnrollmentModal} />
                        <CompactActionCard icon="analytics" label="REPORTS" color="#3B82F6" onPress={() => router.push('/(student)/grades')} />
                    </View>
                </View>

                <View style={[styles.section, { marginBottom: 24 }]}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionLabel}>REGISTRY</Text>
                        <TouchableOpacity onPress={onRefresh}><Ionicons name="reload" size={14} color="#475569" /></TouchableOpacity>
                    </View>

                    {enrollments.length === 0 ? (
                        <View style={styles.emptyRegistry}>
                            <Ionicons name="file-tray-outline" size={32} color="#334155" />
                            <Text style={styles.emptyTitle}>EMPTY</Text>
                        </View>
                    ) : (
                        enrollments.map((item, idx) => (
                            <View key={idx} style={styles.registryItem}>
                                <View style={styles.registryIcon}><Ionicons name="ribbon" size={20} color="#FACC15" /></View>
                                <View style={styles.registryInfo}>
                                    <Text style={styles.regSession}>{item.session_name || item.year_label}</Text>
                                    <Text style={styles.regClass}>{item.class_name || item.display_name}</Text>
                                    <TouchableOpacity style={styles.regBtn} onPress={() => router.push(`/(student)/grades?enrollmentId=${item.enrollment_id || item.id}&sessionId=${item.session_id || item.academic_session_id}`)}>
                                        <Ionicons name="eye" size={12} color="#FACC15" />
                                        <Text style={styles.regBtnText}>GRADES</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ))
                    )}
                </View>

                <View style={{ paddingBottom: 20 }}><Footer onLogout={handleLogout} /></View>
            </ScrollView>

            <Modal animationType="slide" transparent visible={enrollModalVisible} onRequestClose={() => setEnrollModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: C.modalBg }]}>
                        <View style={styles.modalIndictor} />
                        {enrollSuccess ? (
                            <View style={styles.successContainer}>
                                <Ionicons name="checkmark-done-circle" size={60} color="#10B981" />
                                <Text style={styles.successTitle}>FINALIZED</Text>
                                <CustomButton title="CLOSE" onPress={() => setEnrollModalVisible(false)} variant="premium" style={{ width: '100%', marginTop: 20 }} />
                            </View>
                        ) : (
                            <ScrollView showsVerticalScrollIndicator={false}>
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>ENROLLMENT</Text>
                                    <TouchableOpacity onPress={() => setEnrollModalVisible(false)} style={styles.closeBtn}><Ionicons name="close" size={20} color="#fff" /></TouchableOpacity>
                                </View>

                                {enrollError && <Text style={styles.errorBannerText}>{enrollError}</Text>}

                                <View style={{ marginBottom: 16 }}>
                                    <Text style={styles.formLabel}>SESSION</Text>
                                    <TouchableOpacity style={styles.inputSelector} onPress={() => setShowSessionSelector(!showSessionSelector)}>
                                        <Text style={styles.selectorText}>{selectedSession || 'Select'}</Text>
                                        <Ionicons name="chevron-down" size={18} color="#FACC15" />
                                    </TouchableOpacity>
                                    {showSessionSelector && (
                                        <View style={styles.selectorList}>
                                            <ScrollView nestedScrollEnabled style={{ maxHeight: 150 }}>
                                                {sessions.map((s, i) => (
                                                    <TouchableOpacity key={i} style={styles.selectorItem} onPress={() => { setSelectedSession(s.year_label || s.session_name); setShowSessionSelector(false); }}>
                                                        <Text style={styles.selectorItemText}>{s.year_label || s.session_name}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </ScrollView>
                                        </View>
                                    )}
                                </View>

                                <View style={{ marginBottom: 20 }}>
                                    <Text style={styles.formLabel}>CLASS</Text>
                                    <TouchableOpacity style={styles.inputSelector} onPress={() => setShowClassSelector(!showClassSelector)}>
                                        <Text style={styles.selectorText}>{classes.find((c: any) => c.id === selectedClassId)?.class_name || 'Select'}</Text>
                                        <Ionicons name="chevron-down" size={18} color="#FACC15" />
                                    </TouchableOpacity>
                                    {showClassSelector && (
                                        <View style={styles.selectorList}>
                                            <ScrollView nestedScrollEnabled style={{ maxHeight: 150 }}>
                                                {classes.map((c, i) => (
                                                    <TouchableOpacity key={i} style={styles.selectorItem} onPress={() => { setSelectedClassId(c.id); setShowClassSelector(false); }}>
                                                        <Text style={styles.selectorItemText}>{c.class_name}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </ScrollView>
                                        </View>
                                    )}
                                </View>

                                <CustomButton title={enrollLoading ? "..." : "CONFIRM"} onPress={handleSelfEnroll} loading={enrollLoading} variant="premium" style={{ height: 52 }} />
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>

            <EditProfileModal visible={editProfileVisible} onClose={() => setEditProfileVisible(false)} student={student} onUpdate={setStudent} />
        </View>
    );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
    const isTiny = width < 320;
    const isNano = width < 280;
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: C.background },
        loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        loadingText: { color: C.textSecondary, marginTop: 12, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
        scrollContent: { flexGrow: 1 },
        heroHeader: { height: isTiny ? 220 : 260, width: '100%' },
        heroOverlay: { flex: 1, padding: isTiny ? 16 : 24, paddingTop: Platform.OS === 'ios' ? 50 : 40 },
        topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        logoBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15 },
        logoText: { color: '#FACC15', fontSize: 9, fontWeight: '900', marginLeft: 6, letterSpacing: 1.5 },
        logoutFab: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(239, 68, 68, 0.1)', justifyContent: 'center', alignItems: 'center' },
        settingsFab: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(250, 204, 21, 0.1)', justifyContent: 'center', alignItems: 'center' },
        welcomeInfo: { marginTop: isTiny ? 20 : 30 },
        greeting: { color: '#FACC15', fontSize: 9, fontWeight: '900', letterSpacing: 2 },
        studentName: { color: '#fff', fontSize: isTiny ? 20 : 24, fontWeight: '900', marginTop: 2 },
        regBadge: { backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start', marginTop: 8 },
        regText: { color: '#94A3B8', fontSize: 10, fontWeight: '700' },
        section: { paddingHorizontal: isTiny ? 16 : 24, marginBottom: 30 },
        glassCard: { backgroundColor: C.card, borderRadius: 24, padding: isTiny ? 16 : 20, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 6 },
        profileSummary: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
        avatarLarge: { position: 'relative' },
        avatarImg: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: '#FACC15' },
        avatarLargePlaceholder: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(250, 204, 21, 0.1)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FACC15' },
        avatarLargeText: { color: '#FACC15', fontSize: 18, fontWeight: '900' },
        onlineSignal: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: '#10B981', borderWidth: 2, borderColor: '#1E293B' },
        idInfo: { marginLeft: 12, flex: 1 },
        idTitle: { color: C.textLabel, fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
        idValue: { color: C.text, fontSize: 13, fontWeight: '700', marginTop: 2 },
        editProfileBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
        editProfileText: { color: '#FACC15', fontSize: 9, fontWeight: '900', marginLeft: 4 },
        miniStats: { flexDirection: 'row', backgroundColor: C.actionItemBg, borderRadius: 12, padding: 12 },
        statItem: { flex: 1, alignItems: 'center' },
        statLabel: { color: C.textSecondary, fontSize: 8, fontWeight: '900' },
        statValue: { color: C.text, fontSize: 12, fontWeight: '800', marginTop: 2 },
        divider: { width: 1, height: '100%', backgroundColor: C.divider },
        idCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
        idCardBrand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        idCardBrandText: { color: Colors.accent.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
        idCardEdit: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(250, 204, 21, 0.1)', justifyContent: 'center', alignItems: 'center' },
        verifiedBadge: { backgroundColor: 'rgba(16, 185, 129, 0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
        verifiedText: { color: '#10B981', fontSize: 8, fontWeight: '900' },
        idNameText: { color: C.text, fontSize: 16, fontWeight: '900' },
        idRegValue: { color: Colors.accent.gold, fontSize: 12, fontWeight: '800', marginTop: 2 },
        schoolTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
        schoolTagText: { color: C.textMuted, fontSize: 10, fontWeight: '600' },
        cardDivider: { height: 1, backgroundColor: C.divider, marginVertical: 15, opacity: 0.5 },
        contactSection: { marginTop: 10 },
        contactGrid: { flexDirection: 'row', gap: 10 },
        contactCard: { flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.cardBorder },
        contactIconBox: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
        contactLabel: { color: C.textLabel, fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
        contactValue: { color: C.text, fontSize: 11, fontWeight: '700', marginTop: 1 },
        sectionLabel: { color: C.textLabel, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 },
        actionGrid: { flexDirection: 'row', gap: 12 },
        compactCard: { flex: 1, alignItems: 'center', backgroundColor: C.actionItemBg, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder },
        compactIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
        compactLabel: { color: C.textSecondary, fontSize: 9, fontWeight: '800' },
        sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
        registryItem: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.cardBorder },
        registryIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(250, 204, 21, 0.05)', justifyContent: 'center', alignItems: 'center' },
        registryInfo: { flex: 1, marginLeft: 12 },
        regSession: { color: C.text, fontSize: 12, fontWeight: '800' },
        regClass: { color: C.textSecondary, fontSize: 11, fontWeight: '600' },
        regBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.actionIconWrap, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 8, alignSelf: 'flex-start' },
        regBtnText: { color: '#FACC15', fontSize: 8, fontWeight: '900', marginLeft: 4 },
        emptyRegistry: { alignItems: 'center', padding: 30, backgroundColor: C.actionItemBg, borderRadius: 20, borderStyle: 'dashed', borderWidth: 1, borderColor: C.cardBorder },
        emptyTitle: { color: C.textLabel, fontSize: 10, fontWeight: '900', marginTop: 10 },
        modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'flex-end' },
        modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, maxHeight: '80%' },
        modalIndictor: { width: 36, height: 4, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
        modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
        modalTitle: { color: C.text, fontSize: 16, fontWeight: '900' },
        closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.actionIconWrap, justifyContent: 'center', alignItems: 'center' },
        inputSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 12, paddingHorizontal: 16, height: 48, borderWidth: 1, borderColor: C.inputBorder },
        selectorText: { color: C.inputText, fontSize: 13, fontWeight: '700' },
        selectorList: { backgroundColor: C.modalBg, borderRadius: 16, marginTop: 6, padding: 6, borderWidth: 1, borderColor: C.cardBorder },
        selectorItem: { padding: 12, borderRadius: 8 },
        selectorItemText: { color: C.textSecondary, fontSize: 12, fontWeight: '600' },
        formLabel: { fontSize: 9, fontWeight: '800', color: C.textLabel, marginBottom: 6 },
        errorBannerText: { color: '#EF4444', fontSize: 11, marginBottom: 12, textAlign: 'center' },
        successContainer: { padding: 40, alignItems: 'center' },
        successTitle: { color: C.text, fontSize: 18, fontWeight: '900', marginTop: 16 },
    });
}
