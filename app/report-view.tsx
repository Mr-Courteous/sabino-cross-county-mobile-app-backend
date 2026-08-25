import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  FlatList,
  Modal,
  TextInput,
  ImageBackground,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { Colors } from '@/constants/design-system';
import { API_BASE_URL } from '@/utils/api-service';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppColors } from '@/hooks/use-app-colors';

const getToken = async () => {
  if (Platform.OS !== 'web') return await SecureStore.getItemAsync('userToken');
  return localStorage.getItem('userToken');
};

interface ScoreData {
  subject_name: string;
  ca1_score: number;
  ca2_score: number;
  ca3_score: number;
  ca4_score: number;
  exam_score: number;
  student_total: number;
  class_average?: number;
}

interface ClassStudent {
  enrollment_id: number;
  name: string;
  subjects: Array<{
    subject: string;
    ca1_score: number;
    ca2_score: number;
    ca3_score: number;
    ca4_score: number;
    exam_score: number;
    subject_total: number;
    subject_class_average: number;
  }>;
  grand_total: number;
}

interface ClassOption {
  id: number;
  display_name: string;
}

interface AcademicSession {
  id: number;
  session_name: string;
}

export default function ReportViewScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const { id: initialId, mode: initialMode, name: initialName, term: initialTerm, session: initialSession } = useLocalSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [studentData, setStudentData] = useState<ScoreData[]>([]);
  const [classData, setClassData] = useState<ClassStudent[]>([]);
  const [selectedTerm, setSelectedTerm] = useState((initialTerm as string) || '1');
  const [selectedSession, setSelectedSession] = useState((initialSession as string) || '1');
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassOption | null>(null);
  const [mode, setMode] = useState<'student' | 'class'>(initialMode as 'student' | 'class' || 'student');
  const [reportId, setReportId] = useState<string | null>(initialId as string || null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [downloadingStudentId, setDownloadingStudentId] = useState<number | null>(null);
  const [studentDownloadError, setStudentDownloadError] = useState<{ [key: number]: string }>({});

  // Premium design system state
  const [activePortalModal, setActivePortalModal] = useState<'class' | 'session' | 'email' | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [currentEmailRequest, setCurrentEmailRequest] = useState<{
    enrollmentId: number;
    studentName: string;
  } | null>(null);
  
  const [statusAlert, setStatusAlert] = useState<{ visible: boolean; type: 'success' | 'error'; title: string; message: string }>({
    visible: false,
    type: 'success',
    title: '',
    message: ''
  });

  useEffect(() => {
    if (reportId && mode === 'student') {
      fetchReportData();
    } else if (mode === 'class') {
      setLoading(false);
    }
  }, [reportId, mode, selectedTerm, selectedSession]);

  useEffect(() => {
    fetchSessions();
    fetchClasses();
  }, []);

  const fetchSessions = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/academic-sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 402) { router.replace('/pricing'); return; }
      const json = await response.json();
      if (json.success && json.data) {
        setSessions(json.data);
        if (json.data.length > 0) {
          setSelectedSession(String(json.data[0].id));
        }
      }
    } catch (err) {
    }
  };

  const fetchClasses = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/reports/list/classes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 402) { router.replace('/pricing'); return; }
      const json = await response.json();
      if (json.success && json.data) {
        setClasses(json.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch classes');
    }
  };

  const fetchReportData = async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const currentId = mode === 'class' ? selectedClass?.id : reportId;
      
      if (!currentId) {
        if (mode === 'class') setError('Please select a class');
        else setError('Missing report ID');
        setLoading(false);
        return;
      }

      const endpoint = mode === 'student'
        ? `/api/reports/data/student/${currentId}?term=${selectedTerm}&sessionId=${selectedSession}`
        : `/api/reports/data/class/${currentId}?term=${selectedTerm}&sessionId=${selectedSession}`;

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 402) { router.replace('/pricing'); return; }

      const json = await response.json();

      if (json.success) {
        if (mode === 'student') setStudentData(json.data);
        else setClassData(json.data);
      } else {
        setError(json.error || 'Failed to load report data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const emailStudentPDF = async (enrollmentId: number, studentName: string) => {
    setCurrentEmailRequest({ enrollmentId, studentName });
    setEmailInput('');
    setActivePortalModal('email');
  };

  const sendEmailReport = async (enrollmentId: number, term: string, sessionId: string, email: string, token: string) => {
    const emailUrl = `${API_BASE_URL}/api/reports/email/official-report/${enrollmentId}`;
    const response = await fetch(emailUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        term: parseInt(term),
        sessionId: parseInt(sessionId),
        email: email
      }),
    });

    if (response.status === 402) { router.replace('/pricing'); return; }

    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Failed to send email');
  };

  const handleEmailModalSubmit = async () => {
    if (!currentEmailRequest || !emailInput.trim()) return;
    if (!emailInput.includes('@')) {
      setStatusAlert({ visible: true, type: 'error', title: 'Invalid Email', message: 'Enter a valid address.' });
      return;
    }

    setActivePortalModal(null);
    const token = await getToken();
    if (!token) return;

    setDownloadingStudentId(currentEmailRequest.enrollmentId);

    try {
      if (currentEmailRequest.enrollmentId === 0) {
        await sendBulkEmailReports(emailInput.trim());
      } else {
        await sendEmailReport(currentEmailRequest.enrollmentId, selectedTerm, selectedSession, emailInput.trim(), token);
        setStatusAlert({ visible: true, type: 'success', title: 'Sent', message: 'Report has been emailed.' });
        setStudentDownloadError(prev => ({ ...prev, [currentEmailRequest.enrollmentId]: '✓ Emailed' }));
      }
    } catch (err) {
      setStatusAlert({ visible: true, type: 'error', title: 'Failed', message: 'Delivery failure.' });
    } finally {
      setDownloadingStudentId(null);
      setCurrentEmailRequest(null);
    }
  };

  const sendBulkEmailReports = async (email: string) => {
    setDownloadingAll(true);
    setDownloadProgress({ current: 0, total: classData.length });
    try {
      const token = await getToken();
      if (!token) return;
      let success = 0;
      for (let i = 0; i < classData.length; i++) {
        try {
          await sendEmailReport(classData[i].enrollment_id, selectedTerm, selectedSession, email, token);
          success++;
        } catch (err) {}
        setDownloadProgress({ current: i + 1, total: classData.length });
      }
      setStatusAlert({ visible: true, type: 'success', title: 'Complete', message: `${success} reports emailed.` });
    } finally {
      setDownloadingAll(false);
    }
  };

  const getPerformanceColor = (student: number, classAvg: number): string => {
    if (student >= classAvg * 1.1) return '#4CAF50';
    if (student >= classAvg) return '#2196F3';
    return '#F44336';
  };

  const renderPortalModal = () => {
    if (!activePortalModal) return null;

    if (activePortalModal === 'email') {
      return (
        <Modal visible transparent animationType="fade" onRequestClose={() => setActivePortalModal(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: C.modalBg }]}>
              <ThemedText style={styles.modalTitle}>Email Report</ThemedText>
              <TextInput
                style={styles.emailInput}
                placeholder="recipient@example.com"
                placeholderTextColor={C.textMuted}
                value={emailInput}
                onChangeText={setEmailInput}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <CustomButton title="Cancel" onPress={() => setActivePortalModal(null)} style={{ flex: 1 }} />
                <CustomButton title="Send" variant="premium" onPress={handleEmailModalSubmit} style={{ flex: 1 }} />
              </View>
            </View>
          </View>
        </Modal>
      );
    }

    let data: any[] = [];
    let title = '';
    let currentId: any = null;
    let onSelect = (item: any) => {};

    if (activePortalModal === 'class') {
      data = classes;
      title = 'Select Class';
      currentId = selectedClass?.id;
      onSelect = (item) => setSelectedClass(item);
    } else if (activePortalModal === 'session') {
      data = sessions.map(s => ({ id: s.id, name: s.session_name }));
      title = 'Academic Year';
      currentId = Number(selectedSession);
      onSelect = (item) => setSelectedSession(String(item.id));
    }

    return (
      <Modal visible transparent animationType="slide" onRequestClose={() => setActivePortalModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActivePortalModal(null)}>
          <View style={[styles.modalContent, { backgroundColor: C.modalBg, maxHeight: '70%' }]}>
            <ThemedText style={styles.modalTitle}>{title}</ThemedText>
            <FlatList
              data={data}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.dropdownItem, currentId === item.id && styles.dropdownItemSelected]}
                  onPress={() => {
                    onSelect(item);
                    setActivePortalModal(null);
                  }}
                >
                  <ThemedText style={[styles.dropdownItemText, { fontSize: 13 }]}>{item.display_name || item.name}</ThemedText>
                  {currentId === item.id && <Ionicons name="checkmark-circle" size={18} color={Colors.accent.gold} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  return (
    <ThemedView style={styles.mainWrapper}>
      <ScrollView stickyHeaderIndices={[1]} showsVerticalScrollIndicator={false}>
        <ImageBackground
          source={{ uri: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2070' }}
          style={styles.hero}
        >
          <LinearGradient colors={['transparent', C.isDark ? Colors.accent.navy : C.background]} style={styles.heroOverlay}>
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={22} color={C.isDark ? "#FFFFFF" : Colors.accent.navy} />
              </TouchableOpacity>
            </View>
            <View style={styles.heroContent}>
              <ThemedText style={styles.heroSubtitle}>ACADEMIC INSIGHTS</ThemedText>
              <ThemedText style={styles.heroTitle}>{mode === 'student' ? 'Report Card' : 'Class Report'}</ThemedText>
            </View>
          </LinearGradient>
        </ImageBackground>

        <View style={styles.contentWrapper}>
          <View style={styles.glassCard}>
            <View style={styles.filterRow}>
              <View style={styles.filterItem}>
                <ThemedText style={styles.label}>Term</ThemedText>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {['1', '2', '3'].map((term) => (
                    <TouchableOpacity
                      key={term}
                      style={[styles.termOption, selectedTerm === term && styles.termOptionSelected]}
                      onPress={() => setSelectedTerm(term)}
                    >
                      <ThemedText style={[styles.termText, selectedTerm === term && styles.termTextSelected]}>T{term}</ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.filterItem}>
                <ThemedText style={styles.label}>Year</ThemedText>
                <TouchableOpacity style={styles.pickerButton} onPress={() => setActivePortalModal('session')}>
                  <ThemedText style={styles.pickerText} numberOfLines={1}>
                    {sessions.find((s: any) => String(s.id) === selectedSession)?.session_name || 'Select'}
                  </ThemedText>
                  <Ionicons name="chevron-down" size={14} color={Colors.accent.gold} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ marginBottom: 16 }}>
              <ThemedText style={styles.label}>Class</ThemedText>
              <TouchableOpacity style={styles.pickerButton} onPress={() => setActivePortalModal('class')}>
                <ThemedText style={selectedClass ? styles.pickerText : styles.placeholderText} numberOfLines={1}>
                  {selectedClass ? selectedClass.display_name : 'Choose class...'}
                </ThemedText>
                <Ionicons name="chevron-down" size={16} color={Colors.accent.gold} />
              </TouchableOpacity>
            </View>

            <CustomButton
              title={loading ? "Loading..." : "View Report"}
              onPress={fetchReportData}
              loading={loading}
              disabled={!selectedClass && mode === 'class'}
              variant="premium"
              style={{ paddingVertical: 14 }}
            />
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={Colors.accent.gold} style={{ marginTop: 40 }} />
          ) : error ? (
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          ) : (
            <View>
              {mode === 'student' ? (
                studentData.map((subject, idx) => (
                  <View key={idx} style={styles.subjectCard}>
                    <ThemedText style={styles.subjectTitle}>{subject.subject_name}</ThemedText>
                    <View style={styles.statsGrid}>
                      <ThemedText style={styles.statLabel}>Total: {subject.student_total}</ThemedText>
                      <ThemedText style={styles.statLabel}>Avg: {subject.class_average}</ThemedText>
                    </View>
                  </View>
                ))
              ) : (
                classData.map((student, idx) => (
                  <View key={idx} style={styles.studentCard}>
                    <View style={styles.studentHeader}>
                      <ThemedText style={styles.studentName}>{student.name}</ThemedText>
                      <ThemedText style={styles.totalPoints}>{student.grand_total} Pts</ThemedText>
                    </View>
                    <TouchableOpacity 
                      style={styles.individualDownloadButton}
                      onPress={() => emailStudentPDF(student.enrollment_id, student.name)}
                    >
                      <Ionicons name="mail-outline" size={16} color={C.text} />
                      <ThemedText style={styles.individualDownloadButtonText}>Email</ThemedText>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {renderPortalModal()}
      {statusAlert.visible && (
        <CustomAlert {...statusAlert} onClose={() => setStatusAlert({ ...statusAlert, visible: false })} style={{ margin: 20 }} />
      )}
    </ThemedView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    mainWrapper: { flex: 1, backgroundColor: C.background },
    hero: { height: isTiny ? 160 : 200, width: '100%' },
    heroOverlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24, paddingTop: isTiny ? 40 : 50 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    backButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
    heroContent: { marginTop: 'auto', marginBottom: 20 },
    heroSubtitle: { color: Colors.accent.gold, fontSize: 8, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
    heroTitle: { color: C.text, fontSize: isTiny ? 22 : 28, fontWeight: '900', letterSpacing: -1 },
    contentWrapper: { paddingHorizontal: isTiny ? 16 : 24, marginTop: 0 },
    glassCard: { backgroundColor: C.card, borderRadius: 24, padding: isTiny ? 16 : 20, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 24 },
    label: { color: C.textLabel, fontSize: 8, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
    filterRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    filterItem: { flex: 1 },
    termOption: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder, flex: 1, alignItems: 'center' },
    termOptionSelected: { borderColor: Colors.accent.gold, backgroundColor: Colors.accent.gold + '20' },
    termText: { fontSize: 11, fontWeight: '700', color: C.textSecondary },
    termTextSelected: { color: Colors.accent.gold },
    pickerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 12, paddingHorizontal: 12, height: 42, borderWidth: 1, borderColor: C.inputBorder },
    pickerText: { color: C.inputText, fontSize: 12, fontWeight: '700' },
    placeholderText: { color: C.textMuted, fontSize: 12, fontWeight: '600' },
    errorText: { color: '#EF4444', textAlign: 'center', marginTop: 20, fontSize: 13 },
    subjectCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.cardBorder },
    subjectTitle: { fontSize: 13, fontWeight: '800', color: C.text, marginBottom: 6 },
    statsGrid: { flexDirection: 'row', gap: 12 },
    statLabel: { fontSize: 11, color: C.textSecondary },
    studentCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.cardBorder },
    studentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    studentName: { fontSize: 14, fontWeight: '800', color: C.text },
    totalPoints: { fontSize: 12, fontWeight: '700', color: Colors.accent.gold },
    individualDownloadButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.actionItemBg },
    individualDownloadButtonText: { fontSize: 11, fontWeight: '700', color: C.text },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
    modalContent: { borderRadius: 24, padding: 24, borderWidth: 1, borderColor: C.cardBorder },
    modalTitle: { fontSize: 18, fontWeight: '900', color: C.text, marginBottom: 16, textAlign: 'center' },
    emailInput: { backgroundColor: C.inputBg, borderRadius: 12, padding: 12, color: C.inputText, marginBottom: 20, borderWidth: 1, borderColor: C.inputBorder },
    dropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: C.divider },
    dropdownItemSelected: { backgroundColor: Colors.accent.gold + '10' },
    dropdownItemText: { color: C.text, fontWeight: '600' },
    dropdownItemTextSelected: { color: Colors.accent.gold, fontWeight: '800' }
  });
}
