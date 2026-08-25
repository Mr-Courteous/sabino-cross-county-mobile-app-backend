import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    View,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Platform,
    Alert,
    RefreshControl,
    Modal,
    TextInput,
    ImageBackground,
    useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { Colors } from '@/constants/design-system';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { useAppColors } from '@/hooks/use-app-colors';

interface Grade {
    subject_name: string | null;
    ca1_score: number | string | null;
    ca2_score: number | string | null;
    ca3_score: number | string | null;
    ca4_score: number | string | null;
    exam_score: number | string | null;
    student_total?: number | string | null;
    total_score?: number | string | null;
    class_average?: number | string | null;
}

interface Enrollment {
    enrollment_id: number;
    session_id: number;
    academic_year_label: string;
    academic_session: string;
    enrollment_status: string;
    class_id: number;
    class_name: string;
}

interface Session {
    id: number;
    year_label: string;
}

interface Summary {
    average_score?: number | string | null;
    subjects_passed?: number | string | null;
}

const getLetterGrade = (score: number) => {
    if (score >= 75) return { label: 'A', color: '#10B981', desc: 'EXCELLENT' };
    if (score >= 65) return { label: 'B', color: '#3B82F6', desc: 'VERY GOOD' };
    if (score >= 55) return { label: 'C', color: '#FACC15', desc: 'GOOD' };
    if (score >= 45) return { label: 'D', color: '#FB923C', desc: 'PASS' };
    return { label: 'F', color: '#EF4444', desc: 'FAIL' };
};

export default function StudentGrades() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const C = useAppColors();
    const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Selectors
    const [sessions, setSessions] = useState<Session[]>([]);
    const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
    const [selectedEnrollment, setSelectedEnrollment] = useState<Enrollment | null>(null);
    const [selectedTerm, setSelectedTerm] = useState<number>(1);

    // Data
    const [grades, setGrades] = useState<Grade[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [fetchingMetadata, setFetchingMetadata] = useState(false);
    const [fetchingGrades, setFetchingGrades] = useState(false);

    // Status states
    const [downloading, setDownloading] = useState(false);

    // Error Display
    const [statusAlert, setStatusAlert] = useState<{
        visible: boolean;
        type: 'success' | 'error' | 'warning' | 'info';
        title: string;
        message: string;
    }>({
        visible: false,
        type: 'info',
        title: '',
        message: '',
    });

    // Dropdown States
    const [showSessionSelector, setShowSessionSelector] = useState(false);
    const [showEnrollmentSelector, setShowEnrollmentSelector] = useState(false);
    const [showTermSelector, setShowTermSelector] = useState(false);

    // Email modal state
    const [emailModalVisible, setEmailModalVisible] = useState(false);
    const [emailInput, setEmailInput] = useState('');

    useEffect(() => {
        fetchInitialData();
    }, []);

    const getToken = async () => {
        return Platform.OS === 'web'
            ? localStorage.getItem('studentToken')
            : await SecureStore.getItemAsync('studentToken');
    };

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const token = await getToken();
            if (!token) {
                router.replace('/(student)');
                return;
            }

            const sessRes = await fetch(`${API_BASE_URL}/api/academic-years`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const sessData = await sessRes.json();
            if (sessData.success) {
                setSessions(sessData.data);
                if (sessData.data.length > 0) {
                    const latest = sessData.data[0];
                    setSelectedSessionId(latest.id);
                    await fetchSessionEnrollments(latest.id);
                }
            }
        } catch (err: any) {
            setStatusAlert({
                visible: true,
                type: 'error',
                title: 'Offline',
                message: 'Failed to initialize portal.'
            });
        } finally {
            setLoading(false);
        }
    };

    const fetchSessionEnrollments = async (sessionId: number) => {
        setFetchingMetadata(true);
        try {
            const token = await getToken();
            const res = await fetch(`${API_BASE_URL}/api/students/me/enrollments/${sessionId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setEnrollments(data.data);
                if (data.data.length > 0) setSelectedEnrollment(data.data[0]);
                else setSelectedEnrollment(null);
            }
        } catch (error) {
        } finally {
            setFetchingMetadata(false);
        }
    };

    const fetchGrades = async () => {
        if (!selectedEnrollment) {
            setStatusAlert({ visible: true, type: 'warning', title: 'Selection Required', message: 'Choose an enrollment.' });
            return;
        }

        setFetchingGrades(true);
        try {
            const token = await getToken();
            const sessionIdToUse = selectedEnrollment?.session_id || selectedSessionId;
            const endpoint = `${API_BASE_URL}/api/scores/my-grades?term=${selectedTerm}&sessionId=${sessionIdToUse}`;

            const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            console.log('📡 [DEBUG] My Grades Fetch:', { endpoint, status: res.status, data });

            if (data.success && data.data.length > 0) {
                setGrades(data.data);
                setSummary(data.summary);
            } else {
                setGrades([]);
                setSummary(null);
                setStatusAlert({ visible: true, type: 'info', title: 'No Records', message: 'No scores for this term.' });
            }
        } catch (err) {
            console.error('❌ [ERROR] My Grades Fetch Failure:', err);
            setStatusAlert({ visible: true, type: 'error', title: 'Fault', message: 'Unable to sync records.' });
        } finally {
            setFetchingGrades(false);
        }
    };

    const sendEmailReport = useCallback(async (email: string) => {
        try {
            const token = await getToken();
            const sessionIdToUse = selectedEnrollment?.session_id || selectedSessionId;
            const emailUrl = `${API_BASE_URL}/api/reports/email/official-report/${selectedEnrollment?.enrollment_id}`;
            const response = await fetch(emailUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ term: selectedTerm, sessionId: sessionIdToUse, email: email.trim() }),
            });

            const result = await response.json();
            if (response.ok && result.success) {
                setStatusAlert({
                    visible: true,
                    type: 'success',
                    title: 'Dispatch Success',
                    message: `Official report has been transmitted to ${email.trim()}.`
                });
            } else {
                throw new Error(result.error || 'Failed to transmit.');
            }
        } catch (err: any) {
            setStatusAlert({ visible: true, type: 'error', title: 'Dispatch Error', message: err.message || 'Delivery failure.' });
        }
    }, [selectedEnrollment, selectedSessionId, selectedTerm]);

    const handleEmailModalSubmit = async () => {
        if (!emailInput.trim() || !emailInput.includes('@')) {
            setStatusAlert({ visible: true, type: 'warning', title: 'Invalid Email', message: 'Enter a valid electronic address.' });
            return;
        }
        setEmailModalVisible(false);
        setDownloading(true);
        await sendEmailReport(emailInput.trim());
        setDownloading(false);
        setEmailInput('');
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchInitialData();
        setRefreshing(false);
    };

    if (loading) {
        return (
            <ThemedView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={Colors.accent.gold} />
                <ThemedText style={styles.loadingText}>SYNCING RECORDS...</ThemedText>
            </ThemedView>
        );
    }

    const MetricCard = ({ label, value, icon, color }: any) => (
        <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: color + '15' }]}>
                <Ionicons name={icon as any} size={16} color={color} />
            </View>
            <ThemedText style={styles.metricValue}>{value}</ThemedText>
            <ThemedText style={styles.metricLabel}>{label}</ThemedText>
        </View>
    );

    const isTiny = width < 300;

    return (
        <ThemedView style={styles.container}>
            <ImageBackground source={{ uri: 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?q=80&w=2071' }} style={styles.hero}>
                <LinearGradient colors={[C.isDark ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255, 255, 255, 0.7)', C.background]} style={styles.heroOverlay}>
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                            <Ionicons name="chevron-back" size={20} color={C.isDark ? "#FFFFFF" : Colors.accent.navy} />
                        </TouchableOpacity>
                        <ThemedText style={styles.headerTitle}>Academic Performance</ThemedText>
                        <View style={{ width: 40 }} />
                    </View>
                    <View style={styles.heroContent}>
                        <ThemedText style={styles.heroSubtitle}>PROXIMITY TO EXCELLENCE</ThemedText>
                        <ThemedText style={styles.heroMainTitle}>Student Grades</ThemedText>
                    </View>
                </LinearGradient>
            </ImageBackground>

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FACC15" />}>
                {statusAlert.visible && <CustomAlert {...statusAlert} onClose={() => setStatusAlert({ ...statusAlert, visible: false })} style={styles.alert} />}

                <View style={styles.card}>
                    <ThemedText style={styles.cardLabel}>PARAMETERS</ThemedText>
                    <TouchableOpacity style={styles.inputSelector} onPress={() => setShowSessionSelector(!showSessionSelector)}>
                        <ThemedText style={styles.selectorText}>{sessions.find(s => s.id === selectedSessionId)?.year_label || 'Year'}</ThemedText>
                        <Ionicons name="chevron-down" size={16} color={Colors.accent.gold} />
                    </TouchableOpacity>
                    {showSessionSelector && (
                        <View style={styles.selectorList}>
                            <ScrollView nestedScrollEnabled style={{ maxHeight: 150 }}>
                                {sessions.map((sess) => (
                                    <TouchableOpacity key={sess.id} style={styles.selectorItem} onPress={() => { setSelectedSessionId(sess.id); fetchSessionEnrollments(sess.id); setShowSessionSelector(false); }}>
                                        <ThemedText style={styles.selectorItemText}>{sess.year_label}</ThemedText>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    )}

                    <TouchableOpacity style={[styles.inputSelector, { marginTop: 12 }]} onPress={() => setShowEnrollmentSelector(!showEnrollmentSelector)}>
                        <ThemedText style={styles.selectorText} numberOfLines={1}>{selectedEnrollment?.class_name || 'Class'}</ThemedText>
                        <Ionicons name="chevron-down" size={16} color={Colors.accent.gold} />
                    </TouchableOpacity>
                    {showEnrollmentSelector && (
                        <View style={styles.selectorList}>
                            <ScrollView nestedScrollEnabled style={{ maxHeight: 150 }}>
                                {enrollments.map((enr) => (
                                    <TouchableOpacity key={enr.enrollment_id} style={styles.selectorItem} onPress={() => { setSelectedEnrollment(enr); setShowEnrollmentSelector(false); }}>
                                        <ThemedText style={styles.selectorItemText}>{enr.class_name}</ThemedText>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    )}

                    <TouchableOpacity style={[styles.inputSelector, { marginTop: 12 }]} onPress={() => setShowTermSelector(!showTermSelector)}>
                        <ThemedText style={styles.selectorText}>TERM {selectedTerm}</ThemedText>
                        <Ionicons name="chevron-down" size={16} color={Colors.accent.gold} />
                    </TouchableOpacity>
                    {showTermSelector && (
                        <View style={styles.selectorList}>
                            {[1, 2, 3].map((t) => (
                                <TouchableOpacity key={t} style={styles.selectorItem} onPress={() => { setSelectedTerm(t); setShowTermSelector(false); }}>
                                    <ThemedText style={styles.selectorItemText}>Term {t}</ThemedText>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    <CustomButton title={fetchingGrades ? "..." : "DECRYPT RECORDS"} onPress={fetchGrades} variant="premium" loading={fetchingGrades} disabled={!selectedEnrollment} style={{ height: 48, marginTop: 16 }} />
                </View>

                {grades.length > 0 ? (
                    <>
                        {grades.map((grade, idx) => {
                            const hasAnyCA = grade.ca1_score !== null || grade.ca2_score !== null || grade.ca3_score !== null || grade.ca4_score !== null;
                            const totalCA = hasAnyCA ? (Number(grade.ca1_score) || 0) + (Number(grade.ca2_score) || 0) + (Number(grade.ca3_score) || 0) + (Number(grade.ca4_score) || 0) : null;
                            const examScore = grade.exam_score !== null ? Number(grade.exam_score) : null;
                            
                            const total = (totalCA || 0) + (examScore || 0);
                            const letterGrade = getLetterGrade(total);
                            
                            return (
                                <View key={idx} style={styles.gradeCard}>
                                    <View style={styles.gradeHeader}>
                                        <View style={{ flex: 1 }}>
                                            <ThemedText style={styles.subjectName}>{grade.subject_name}</ThemedText>
                                        </View>
                                        <View style={[styles.gradeCircle, { borderColor: letterGrade.color }]}>
                                            <ThemedText style={[styles.gradeLetter, { color: letterGrade.color }]}>{letterGrade.label}</ThemedText>
                                        </View>
                                    </View>

                                    <View style={styles.breakdownContainer}>
                                        <View style={styles.breakdownRow}>
                                            <ScoreItem label="TOTAL CA" value={totalCA} max={40} styles={styles} />
                                            <ScoreItem label="EXAM" value={grade.exam_score} max={60} highlight styles={styles} />
                                        </View>
                                    </View>

                                    <View style={styles.totalRow}>
                                        <View>
                                            <ThemedText style={styles.totalLabel}>TOTAL SCORE</ThemedText>
                                            {grade.teacher_remark && (
                                                <ThemedText style={styles.remarkText} numberOfLines={1}>"{grade.teacher_remark}"</ThemedText>
                                            )}
                                        </View>
                                        <ThemedText style={[styles.totalValue, { color: letterGrade.color }]}>{total}%</ThemedText>
                                    </View>
                                </View>
                            );
                        })}
                        <CustomButton 
                            title={downloading ? "SENDING..." : "Send to email"} 
                            onPress={() => setEmailModalVisible(true)} 
                            variant="premium" 
                            disabled={downloading} 
                            loading={downloading}
                            style={{ height: 52, marginTop: 10 }} 
                        />
                    </>
                ) : (
                    !fetchingGrades && (
                        <View style={styles.emptyState}>
                            <ThemedText style={styles.emptyTitle}>Records Locked</ThemedText>
                            <ThemedText style={styles.emptyDesc}>Authenticate parameters above.</ThemedText>
                        </View>
                    )
                )}
            </ScrollView>

            <Modal visible={emailModalVisible} transparent animationType="fade" onRequestClose={() => setEmailModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: C.modalBg }]}>
                        <ThemedText style={styles.modalTitle}>Dispatch</ThemedText>
                        <TextInput style={styles.modalInput} placeholder="name@oags.com" placeholderTextColor={C.textMuted} value={emailInput} onChangeText={setEmailInput} keyboardType="email-address" autoCapitalize="none" />
                        <View style={styles.modalActions}>
                            <TouchableOpacity onPress={() => setEmailModalVisible(false)}><ThemedText style={styles.modalCancelText}>Cancel</ThemedText></TouchableOpacity>
                            <TouchableOpacity onPress={handleEmailModalSubmit}><ThemedText style={styles.modalSubmitText}>Transmit</ThemedText></TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </ThemedView>
    );
}

const ScoreItem = ({ label, value, max, highlight, styles }: { label: string, value: any, max: number, highlight?: boolean, styles: any }) => {
    const val = value !== null && value !== undefined ? Number(value) : null;
    return (
        <View style={styles.scoreItem}>
            <ThemedText style={[styles.scoreLabel, highlight && { color: Colors.accent.gold }]}>{label}</ThemedText>
            <ThemedText style={styles.scoreValue}>
                {val !== null ? val : '-'}
                <ThemedText style={styles.scoreMax}>/{max}</ThemedText>
            </ThemedText>
        </View>
    );
};

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
    const isTiny = width < 300;
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: C.background },
        loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        loadingText: { color: C.textSecondary, marginTop: 12, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
        hero: { height: isTiny ? 200 : 240, width: '100%' },
        heroOverlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24, paddingTop: isTiny ? 40 : 50 },
        header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
        backButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
        headerTitle: { color: C.text, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
        heroContent: { marginTop: 'auto', marginBottom: 20 },
        heroSubtitle: { color: Colors.accent.gold, fontSize: 8, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
        heroMainTitle: { color: C.text, fontSize: isTiny ? 24 : 30, fontWeight: '900', letterSpacing: -1 },
        scrollView: { flex: 1, marginTop: 0 },
        scrollContent: { padding: isTiny ? 16 : 20, paddingBottom: 60 },
        alert: { marginBottom: 16 },
        card: { backgroundColor: C.card, borderRadius: 28, padding: isTiny ? 16 : 20, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 24 },
        cardLabel: { color: Colors.accent.gold, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 12 },
        inputSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: C.inputBorder },
        selectorText: { color: C.inputText, fontSize: 13, fontWeight: '700' },
        selectorList: { backgroundColor: C.modalBg, borderRadius: 16, marginTop: 6, padding: 6, borderWidth: 1, borderColor: C.cardBorder },
        selectorItem: { padding: 12, borderRadius: 8 },
        selectorItemText: { color: C.text, fontSize: 13, fontWeight: '600' },
        
        summaryGrid: { flexDirection: 'row', gap: 12, marginBottom: 20 },
        
        gradeCard: { backgroundColor: C.surface, borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.divider },
        gradeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
        subjectName: { color: C.text, fontSize: 15, fontWeight: '700' },
        avgText: { color: C.textSecondary, fontSize: 11, marginTop: 2 },
        gradeCircle: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
        gradeLetter: { fontSize: 18, fontWeight: '800' },
        
        breakdownContainer: { backgroundColor: C.background, borderRadius: 12, padding: 12, marginBottom: 16 },
        breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
        scoreItem: { alignItems: 'center', flex: 1 },
        scoreLabel: { color: C.textSecondary, fontSize: 9, fontWeight: '700', marginBottom: 4 },
        scoreValue: { color: C.text, fontSize: 13, fontWeight: '600' },
        scoreMax: { color: C.textMuted, fontSize: 9, fontWeight: '400' },
        
        totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 12 },
        totalLabel: { color: C.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
        totalValue: { fontSize: 24, fontWeight: '900' },
        remarkText: { color: Colors.accent.gold, fontSize: 10, fontStyle: 'italic', marginTop: 2 },

        emptyState: { padding: 40, alignItems: 'center', justifyContent: 'center' },
        emptyTitle: { color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
        emptyDesc: { color: C.textSecondary, fontSize: 12, textAlign: 'center' },
        
        summaryCard: { flex: 1, backgroundColor: C.surface, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: C.divider, flexDirection: 'row', alignItems: 'center', gap: 12 },
        metricCard: { flex: 1, backgroundColor: C.card, borderRadius: 20, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: C.cardBorder },
        metricIcon: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
        metricValue: { color: C.text, fontSize: 14, fontWeight: '900' },
        metricLabel: { color: C.textSecondary, fontSize: 9, fontWeight: '700' },
        
        modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
        modalContent: { borderRadius: 24, padding: 24, borderWidth: 1, borderColor: C.divider },
        modalTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 16, textAlign: 'center' },
        modalInput: { backgroundColor: C.inputBg, borderRadius: 12, padding: 12, color: C.inputText, marginBottom: 20, borderWidth: 1, borderColor: C.inputBorder },
        modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 },
        modalCancelText: { color: C.textSecondary, fontWeight: '700' },
        modalSubmitText: { color: Colors.accent.gold, fontWeight: '800' },
    });
}
