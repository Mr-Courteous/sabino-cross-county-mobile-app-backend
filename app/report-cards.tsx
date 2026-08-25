import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  Modal,
  ImageBackground,
  ScrollView,
  useWindowDimensions
} from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { API_BASE_URL } from '@/utils/api-service';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/design-system';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { useRouter } from 'expo-router';
import { useAppColors } from '@/hooks/use-app-colors';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as MailComposer from 'expo-mail-composer';

const getToken = async () => {
  if (Platform.OS !== 'web') return await SecureStore.getItemAsync('userToken');
  return localStorage.getItem('userToken');
};

export default function ReportSearchScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTiny = width < 300;
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const [mode, setMode] = useState<'student' | 'class'>('student');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedStudentTerms, setSelectedStudentTerms] = useState<{ [key: number]: string }>({});

  // Class mode filters
  const [selectedClass, setSelectedClass] = useState<any | null>(null);
  const [selectedTerm, setSelectedTerm] = useState('1');
  const [selectedSession, setSelectedSession] = useState('1');
  const [sessions, setSessions] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [classReportData, setClassReportData] = useState<any[]>([]);
  const [showingReportData, setShowingReportData] = useState(false);
  const [batchSearchQuery, setBatchSearchQuery] = useState('');

  // Track successful emails for visual feedback
  const [sentSuccessIds, setSentSuccessIds] = useState<Record<string, boolean>>({});

  // Download/share state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

  // Native Score Preview State
  const [selectedPreviewStudent, setSelectedPreviewStudent] = useState<any>(null);
  const [regeneratingRemark, setRegeneratingRemark] = useState(false);

  // Dropdown States
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [showClassSelector, setShowClassSelector] = useState(false);
  const [showTermSelector, setShowTermSelector] = useState(false);

  // Success Modal State
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const [currentEmailRequest, setCurrentEmailRequest] = useState<{
    enrollmentId: number;
    studentName: string;
    term: number;
    sessionId: number;
  } | null>(null);

  const [emailInput, setEmailInput] = useState('');

  // ─── Download & Share ──────────────────────────────────────────────────────

  /**
   * Downloads report card PDF from backend and opens share sheet.
   * Teacher can then save to device, share via WhatsApp, email attachment, etc.
   */
  const handleDownloadAndShare = async (enrollmentId: number, studentName: string, term: number, sessionId: number) => {
    const key = `${enrollmentId}-${term}`;
    setDownloadingId(key);

    try {
      const token = await getToken();
      const url = `${API_BASE_URL}/api/reports/pdf/${enrollmentId}?term=${term}&sessionId=${sessionId}`;

      // Download the PDF to a temp file
      const fileName = `${studentName.replace(/\s+/g, '_')}_Term${term}_Report.pdf`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      const downloadResult = await FileSystem.downloadAsync(url, fileUri, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (downloadResult.status !== 200) {
        throw new Error('Failed to download report card');
      }

      // Check if sharing is available on this device
      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (!isSharingAvailable) {
        setStatusAlert({
          visible: true,
          type: 'error',
          title: 'Sharing unavailable',
          message: 'Sharing is not available on this device.',
        });
        return;
      }

      // Open native share sheet — WhatsApp, Gmail, save to files, etc.
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/pdf',
        dialogTitle: `${studentName} - Term ${term} Report Card`,
        UTI: 'com.adobe.pdf',
      });

    } catch (err: any) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Download Failed',
        message: err.message || 'Could not download report card. Please try again.',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  /**
   * Opens device mail app with the PDF attached directly.
   * Different from the existing "Email Official" which sends from your backend server.
   * This one lets the teacher send from their own email.
   */
  const handleSendFromDeviceMail = async (enrollmentId: number, studentName: string, term: number, sessionId: number) => {
    const key = `${enrollmentId}-${term}`;
    setDownloadingId(key);

    try {
      const isMailAvailable = await MailComposer.isAvailableAsync();
      if (!isMailAvailable) {
        setStatusAlert({
          visible: true,
          type: 'info',
          title: 'Mail not available',
          message: 'No email app found on this device. Use "Share" instead.',
        });
        return;
      }

      const token = await getToken();
      const url = `${API_BASE_URL}/api/reports/pdf/${enrollmentId}?term=${term}&sessionId=${sessionId}`;
      const fileName = `${studentName.replace(/\s+/g, '_')}_Term${term}_Report.pdf`;
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      const downloadResult = await FileSystem.downloadAsync(url, fileUri, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (downloadResult.status !== 200) {
        throw new Error('Failed to download report card');
      }

      await MailComposer.composeAsync({
        subject: `${studentName} - Term ${term} Report Card`,
        body: `Please find attached the Term ${term} report card for ${studentName}.\n\nRegards,\nSabino Edu`,
        attachments: [fileUri],
      });

    } catch (err: any) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Mail Error',
        message: err.message || 'Could not open mail composer.',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  // ─── Existing logic (unchanged) ───────────────────────────────────────────

  const handleFetch = useCallback(async (query = '') => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();

      if (!token) {
        setError('Authentication required. Please login again.');
        return;
      }

      const endpoint = mode === 'student'
        ? `/api/reports/search/students?name=${encodeURIComponent(query)}`
        // IMPORTANT: /api/classes returns GLOBAL curriculum templates
        // (global_class_templates ids). GET /api/reports/data/class/:classId
        // filters enrollments.class_id, which is this school's real
        // `classes` table id — using the global id here silently
        // returned wrong/empty class report data (same bug that hit
        // score entry). /api/classes/school returns the correct ids.
        : `/api/classes/school`;

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 402) { router.replace('/pricing'); return; }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const json = await response.json();

      if (json.success) {
        const normalizedData = json.data.map((item: any) => {
          if (item.class_average !== undefined) {
            item.class_average = item.class_average ? Number(item.class_average) : null;
          }
          if (item.subject_class_average !== undefined) {
            item.subject_class_average = item.subject_class_average ? Number(item.subject_class_average) : null;
          }
          if (item.ca1_score !== undefined) item.ca1_score = Number(item.ca1_score) || 0;
          if (item.ca2_score !== undefined) item.ca2_score = Number(item.ca2_score) || 0;
          if (item.ca3_score !== undefined) item.ca3_score = Number(item.ca3_score) || 0;
          if (item.ca4_score !== undefined) item.ca4_score = Number(item.ca4_score) || 0;
          if (item.exam_score !== undefined) item.exam_score = Number(item.exam_score) || 0;
          if (item.student_total !== undefined) item.student_total = Number(item.student_total) || 0;
          if (item.subject_total !== undefined) item.subject_total = Number(item.subject_total) || 0;
          return item;
        });

        if (mode === 'student') {
          setResults(normalizedData);
        } else {
          setClasses(normalizedData);
          setResults([]);
        }

        if (normalizedData.length === 0 && query) {
          setError(`No ${mode === 'student' ? 'students' : 'classes'} found matching your search.`);
        }
      } else {
        setError(json.error || 'Failed to fetch data');
      }
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : 'Connection error. Check your network.';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'student') {
      if (searchQuery.length >= 3) {
        handleFetch(searchQuery);
      } else if (searchQuery.length === 0) {
        setResults([]);
      }
    } else {
      handleFetch();
      fetchSessions();
    }
  }, [mode, searchQuery, handleFetch]);

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
    } catch (err) { }
  };

  const fetchClassReportData = async () => {
    if (!selectedClass) return;
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const endpoint = `/api/reports/data/class/${selectedClass}?term=${selectedTerm}&sessionId=${selectedSession}`;
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 402) { router.replace('/pricing'); return; }
      const json = await response.json();
      if (json.success) {
        setClassReportData(json.data);
        setShowingReportData(true);
      } else {
        setError(json.error || 'Failed to load class report data');
      }
    } catch (err) {
      setError('Connection error occurred while fetching reports.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailModalSubmit = async () => {
    if (!currentEmailRequest || !emailInput.trim()) return;
    if (!emailInput.includes('@')) {
      setStatusAlert({ visible: true, type: 'error', title: 'Invalid Email', message: 'Enter a valid address.' });
      return;
    }

    const request = currentEmailRequest;
    setLoading(true);

    try {
      const token = await getToken();
      const emailUrl = `${API_BASE_URL}/api/reports/email/official-report/${request.enrollmentId}`;
      const response = await fetch(emailUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ term: request.term, sessionId: request.sessionId, email: emailInput.trim() }),
      });

      if (response.status === 402) { router.replace('/pricing'); return; }

      const result = await response.json();
      if (response.ok && result.success) {
        setCurrentEmailRequest(null);
        setShowSuccessModal(true);
        setSentSuccessIds(prev => ({ ...prev, [`${request.enrollmentId}-${request.term}`]: true }));
      } else {
        throw new Error(result.error || 'Dispatch failure');
      }
    } catch (err: any) {
      setStatusAlert({ visible: true, type: 'error', title: 'Dispatch Error', message: err.message || 'Failed to transmit report.' });
    } finally {
      setLoading(false);
      setEmailInput('');
    }
  };

  const handleProceedToEmail = () => {
    if (!selectedPreviewStudent) return;
    const student = selectedPreviewStudent;
    const term = Number(student.displayTerm || '1');
    const sessionId = Number(student.session_id || selectedSession);
    setSelectedPreviewStudent(null);
    setCurrentEmailRequest({
      enrollmentId: student.enrollment_id,
      studentName: student.name || `${student.first_name} ${student.last_name}`,
      term,
      sessionId
    });
  };

  const handleRegenerateRemark = async () => {
    setStatusAlert(prev => ({ ...prev, visible: false }));
    if (!selectedPreviewStudent) return;
    const enrollmentId = selectedPreviewStudent.enrollment_id;
    const term = selectedPreviewStudent.displayTerm || '1';
    const sessionId = selectedPreviewStudent.session_id || selectedSession;

    setRegeneratingRemark(true);
    try {
      const token = await getToken();
      const response = await fetch(
        `${API_BASE_URL}/api/reports/regenerate-remark/${enrollmentId}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ term: parseInt(term), sessionId: parseInt(sessionId) }),
        }
      );
      if (response.status === 402) { router.replace('/pricing'); return; }
      const result = await response.json();
      if (response.ok && result.success) {
        setStatusAlert({
          visible: true,
          type: 'success',
          title: 'Remark Regenerated',
          message: result.message || 'AI remark has been regenerated successfully.',
        });
      } else {
        throw new Error(result.error || 'Failed to regenerate remark');
      }
    } catch (err: any) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Regeneration Failed',
        message: err.message || 'Could not regenerate AI remark. Please try again.',
      });
    } finally {
      setRegeneratingRemark(false);
    }
  };

  const handleNativePreview = (student: any, term: string) => {
    student.displayTerm = term;
    setSelectedPreviewStudent(student);
  };

  // ─── Render student card (Search mode) ────────────────────────────────────

  const renderStudentItem = ({ item }: { item: any }) => {
    const term = selectedStudentTerms[item.enrollment_id] || '1';
    const isSent = sentSuccessIds[`${item.enrollment_id}-${term}`];
    const isDownloading = downloadingId === `${item.enrollment_id}-${term}`;
    const isTinyLocal = width < 300;

    return (
      <View style={[styles.resultCard, isTinyLocal && { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <View style={[styles.avatarContainer, isTinyLocal && { marginBottom: 12 }]}>
          <ThemedText style={styles.avatarText}>{(item.first_name?.[0] || '') + (item.last_name?.[0] || '')}</ThemedText>
        </View>
        <View style={[styles.studentInfo, isTinyLocal && { marginLeft: 0, width: '100%' }]}>
          <ThemedText style={styles.resultTitle}>{item.first_name} {item.last_name}</ThemedText>
          <View style={styles.metaRow}>
            <Ionicons name="school-outline" size={11} color={C.textSecondary} />
            <ThemedText style={styles.resultSubtitle}>{item.class_name} • {item.session_name || 'Current'}</ThemedText>
          </View>
          <View style={[styles.metaRow, { marginTop: 2 }]}>
            <Ionicons name="calendar-outline" size={11} color={Colors.accent.gold} />
            <ThemedText style={[styles.resultSubtitle, { color: Colors.accent.gold, fontWeight: '800' }]}>
              {term === '1' ? 'First' : term === '2' ? 'Second' : 'Third'} Term
            </ThemedText>
          </View>

          <View style={[styles.termSection, isTinyLocal && { flexWrap: 'wrap' }]}>
            {['1', '2', '3'].map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.miniChip, term === t && styles.activeMiniChip]}
                onPress={() => setSelectedStudentTerms(prev => ({ ...prev, [item.enrollment_id]: t }))}
              >
                <ThemedText style={[styles.miniChipText, term === t && styles.activeMiniChipText]}>TERM {t}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          {/* Row 1: Preview + Email Official */}
          <View style={[styles.cardActions, { marginBottom: 8 }]}>
            <TouchableOpacity
              style={styles.fullActionBtn}
              onPress={() => handleNativePreview(item, term)}
            >
              <Ionicons name="eye-outline" size={isTinyLocal ? 12 : 14} color={C.text} />
              <ThemedText style={styles.actionBtnText}>Preview</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fullActionBtn, isSent && { borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.05)' }]}
              onPress={() => setCurrentEmailRequest({
                enrollmentId: item.enrollment_id,
                studentName: `${item.first_name} ${item.last_name}`,
                term: Number(term),
                sessionId: item.session_id
              })}
            >
              <Ionicons name={isSent ? "checkmark-circle" : "mail-outline"} size={isTinyLocal ? 12 : 14} color={isSent ? "#10B981" : C.text} />
              <ThemedText style={[styles.actionBtnText, isSent && { color: '#10B981' }]}>
                {isSent ? "Sent" : "Email"}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* Row 2: Download/Share + Send from my mail */}
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[styles.fullActionBtn, { borderColor: Colors.accent.gold, backgroundColor: 'rgba(250, 204, 21, 0.05)' }]}
              onPress={() => handleDownloadAndShare(item.enrollment_id, `${item.first_name} ${item.last_name}`, Number(term), item.session_id)}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color={Colors.accent.gold} />
              ) : (
                <>
                  <Ionicons name="share-social-outline" size={isTinyLocal ? 12 : 14} color={Colors.accent.gold} />
                  <ThemedText style={[styles.actionBtnText, { color: Colors.accent.gold }]}>Share PDF</ThemedText>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fullActionBtn, { borderColor: '#60A5FA', backgroundColor: 'rgba(96, 165, 250, 0.05)' }]}
              onPress={() => handleSendFromDeviceMail(item.enrollment_id, `${item.first_name} ${item.last_name}`, Number(term), item.session_id)}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#60A5FA" />
              ) : (
                <>
                  <Ionicons name="paper-plane-outline" size={isTinyLocal ? 12 : 14} color="#60A5FA" />
                  <ThemedText style={[styles.actionBtnText, { color: '#60A5FA' }]}>My Mail</ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // ─── Render class batch student card ──────────────────────────────────────

  const renderClassReportStudent = ({ item }: { item: any }) => {
    const isSent = sentSuccessIds[`${item.enrollment_id}-${selectedTerm}`];
    const isDownloading = downloadingId === `${item.enrollment_id}-${selectedTerm}`;
    const isTinyLocal = width < 300;

    return (
      <View style={[styles.resultCard, isTinyLocal && { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <View style={[styles.rankBadge, isTinyLocal && { marginBottom: 12 }]}>
          <ThemedText style={styles.rankText}>{classReportData.indexOf(item) + 1}</ThemedText>
        </View>
        <View style={[styles.studentInfo, isTinyLocal && { marginLeft: 0, width: '100%' }]}>
          <ThemedText style={styles.resultTitle}>{item.name}</ThemedText>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={11} color={Colors.accent.gold} />
            <ThemedText style={[styles.resultSubtitle, { color: Colors.accent.gold, fontWeight: '800' }]}>
              {sessions.find(s => String(s.id) === selectedSession)?.session_name || 'Current'} • {selectedTerm === '1' ? 'First' : selectedTerm === '2' ? 'Second' : 'Third'} Term
            </ThemedText>
          </View>

          {/* Row 1: Preview + Email Official */}
          <View style={[styles.cardActions, { marginBottom: 8 }]}>
            <TouchableOpacity
              style={styles.fullActionBtn}
              onPress={() => handleNativePreview(item, selectedTerm)}
            >
              <Ionicons name="eye-outline" size={isTinyLocal ? 12 : 14} color={C.text} />
              <ThemedText style={styles.actionBtnText}>Preview</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fullActionBtn, isSent && { borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.05)' }]}
              onPress={() => setCurrentEmailRequest({
                enrollmentId: item.enrollment_id,
                studentName: item.name,
                term: Number(selectedTerm),
                sessionId: Number(selectedSession)
              })}
            >
              <Ionicons name={isSent ? "checkmark-circle" : "mail-outline"} size={isTinyLocal ? 12 : 14} color={isSent ? "#10B981" : C.text} />
              <ThemedText style={[styles.actionBtnText, isSent && { color: '#10B981' }]}>
                {isSent ? "Sent" : "Email Official"}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* Row 2: Share PDF + My Mail */}
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[styles.fullActionBtn, { borderColor: Colors.accent.gold, backgroundColor: 'rgba(250, 204, 21, 0.05)' }]}
              onPress={() => handleDownloadAndShare(item.enrollment_id, item.name, Number(selectedTerm), Number(selectedSession))}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color={Colors.accent.gold} />
              ) : (
                <>
                  <Ionicons name="share-social-outline" size={isTinyLocal ? 12 : 14} color={Colors.accent.gold} />
                  <ThemedText style={[styles.actionBtnText, { color: Colors.accent.gold }]}>Share PDF</ThemedText>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fullActionBtn, { borderColor: '#60A5FA', backgroundColor: 'rgba(96, 165, 250, 0.05)' }]}
              onPress={() => handleSendFromDeviceMail(item.enrollment_id, item.name, Number(selectedTerm), Number(selectedSession))}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#60A5FA" />
              ) : (
                <>
                  <Ionicons name="paper-plane-outline" size={isTinyLocal ? 12 : 14} color="#60A5FA" />
                  <ThemedText style={[styles.actionBtnText, { color: '#60A5FA' }]}>My Mail</ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <ThemedView style={styles.mainWrapper}>
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?q=80&w=2070' }}
        style={styles.hero}
      >
        <LinearGradient
          colors={['transparent', C.isDark ? Colors.accent.navy : C.background]}
          style={styles.heroOverlay}
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={20} color={C.isDark ? "#FFFFFF" : Colors.accent.navy} />
            </TouchableOpacity>
            <ThemedText style={styles.headerTitle}>Report Center</ThemedText>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.heroContent}>
            <ThemedText style={styles.heroSubtitle}>ACADEMIC LOGISTICS</ThemedText>
            <ThemedText style={styles.heroTitle}>Reports</ThemedText>
          </View>
        </LinearGradient>
      </ImageBackground>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.contentWrapper}>
          <View style={styles.glassCard}>
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'student' && styles.activeModeBtn]}
                onPress={() => { setMode('student'); setShowingReportData(false); setResults([]); }}
              >
                <ThemedText style={[styles.modeBtnText, mode === 'student' && styles.activeModeBtnText]}>Search</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, mode === 'class' && styles.activeModeBtn]}
                onPress={() => { setMode('class'); setResults([]); }}
              >
                <ThemedText style={[styles.modeBtnText, mode === 'class' && styles.activeModeBtnText]}>Batching</ThemedText>
              </TouchableOpacity>
            </View>

            {mode === 'student' ? (
              <View style={styles.searchWrapper}>
                <Ionicons name="search" size={18} color={C.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Enter student name..."
                  placeholderTextColor={C.textMuted}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>
            ) : !showingReportData && (
              <View style={styles.filtersArea}>
                <View style={styles.filterRow}>
                  <View style={styles.filterGroup}>
                    <ThemedText style={styles.filterLabel}>YEAR</ThemedText>
                    <TouchableOpacity style={styles.inputSelector} onPress={() => setShowSessionSelector(!showSessionSelector)}>
                      <ThemedText style={styles.selectorText} numberOfLines={1}>
                        {sessions.find((s: any) => String(s.id) === selectedSession)?.session_name || 'Select'}
                      </ThemedText>
                      <Ionicons name={showSessionSelector ? "chevron-up" : "chevron-down"} size={16} color={Colors.accent.gold} />
                    </TouchableOpacity>
                    {showSessionSelector && (
                      <View style={styles.selectorList}>
                        <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                          {sessions.map((sess: any) => (
                            <TouchableOpacity key={sess.id} style={[styles.selectorItem, selectedSession === String(sess.id) && styles.selectorItemActive]} onPress={() => { setSelectedSession(String(sess.id)); setShowSessionSelector(false); }}>
                              <ThemedText style={[styles.selectorItemText, selectedSession === String(sess.id) && styles.selectorItemTextActive]}>{sess.session_name}</ThemedText>
                              {selectedSession === String(sess.id) && <Ionicons name="checkmark-circle" size={16} color={Colors.accent.gold} />}
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </View>

                  <View style={styles.filterGroup}>
                    <ThemedText style={styles.filterLabel}>PERIOD</ThemedText>
                    <TouchableOpacity style={styles.inputSelector} onPress={() => setShowTermSelector(!showTermSelector)}>
                      <ThemedText style={styles.selectorText}>T{selectedTerm}</ThemedText>
                      <Ionicons name={showTermSelector ? "chevron-up" : "chevron-down"} size={16} color={Colors.accent.gold} />
                    </TouchableOpacity>
                    {showTermSelector && (
                      <View style={styles.selectorList}>
                        <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                          {['1', '2', '3'].map((term) => (
                            <TouchableOpacity key={term} style={[styles.selectorItem, selectedTerm === term && styles.selectorItemActive]} onPress={() => { setSelectedTerm(term); setShowTermSelector(false); }}>
                              <ThemedText style={[styles.selectorItemText, selectedTerm === term && styles.selectorItemTextActive]}>Term {term}</ThemedText>
                              {selectedTerm === term && <Ionicons name="checkmark-circle" size={16} color={Colors.accent.gold} />}
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.filterGroup}>
                  <ThemedText style={styles.filterLabel}>SELECT CLASS</ThemedText>
                  <TouchableOpacity style={styles.inputSelector} onPress={() => setShowClassSelector(!showClassSelector)}>
                    <ThemedText style={styles.selectorText}>
                      {classes.find((c: any) => String(c.id) === selectedClass)?.class_name || 'Select Class'}
                    </ThemedText>
                    <Ionicons name={showClassSelector ? "chevron-up" : "chevron-down"} size={16} color={Colors.accent.gold} />
                  </TouchableOpacity>
                  {showClassSelector && (
                    <View style={styles.selectorList}>
                      <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                        {classes.map((cls: any) => (
                          <TouchableOpacity key={cls.id} style={[styles.selectorItem, selectedClass === String(cls.id) && styles.selectorItemActive]} onPress={() => { setSelectedClass(String(cls.id)); setShowClassSelector(false); }}>
                            <ThemedText style={[styles.selectorItemText, selectedClass === String(cls.id) && styles.selectorItemTextActive]}>{cls.class_name}</ThemedText>
                            {selectedClass === String(cls.id) && <Ionicons name="checkmark-circle" size={16} color={Colors.accent.gold} />}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>

                {selectedClass && (
                  <CustomButton title="Load Class Batch" onPress={fetchClassReportData} loading={loading} variant="premium" style={{ paddingVertical: 14 }} />
                )}
              </View>
            )}
          </View>
        </View>

        {mode === 'class' && showingReportData && (
          <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity style={styles.backLink} onPress={() => { setShowingReportData(false); setBatchSearchQuery(''); }}>
                <Ionicons name="chevron-back" size={18} color={Colors.accent.gold} />
                <ThemedText style={{ color: Colors.accent.gold, fontWeight: '800', fontSize: 11 }}>BACK TO FILTERS</ThemedText>
              </TouchableOpacity>
              {batchSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setBatchSearchQuery('')}>
                  <ThemedText style={{ color: Colors.accent.gold, fontSize: 10, fontWeight: '700' }}>CLEAR</ThemedText>
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.searchWrapper, { height: 42, borderRadius: 12, backgroundColor: C.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]}>
              <Ionicons name="search" size={16} color={C.textMuted} />
              <TextInput
                style={[styles.searchInput, { fontSize: 12 }]}
                placeholder="Filter students in this class..."
                placeholderTextColor={C.textMuted}
                value={batchSearchQuery}
                onChangeText={setBatchSearchQuery}
              />
            </View>
          </View>
        )}

        <View style={styles.listContent}>
          {loading ? (
            <View style={styles.centerLoader}>
              <ActivityIndicator color={Colors.accent.gold} />
              <ThemedText style={styles.loaderText}>FETCHING RECORDS</ThemedText>
            </View>
          ) : error ? (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle" size={18} color="#EF4444" />
              <ThemedText style={styles.errorText}>{error}</ThemedText>
            </View>
          ) : (
            <FlatList
              data={showingReportData
                ? classReportData.filter(s =>
                  (s.name || `${s.first_name} ${s.last_name}`)
                    .toLowerCase()
                    .includes(batchSearchQuery.toLowerCase())
                )
                : results}
              keyExtractor={(item) => `report-${item.enrollment_id}`}
              renderItem={showingReportData ? renderClassReportStudent : renderStudentItem}
              scrollEnabled={false}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', padding: 40 }}>
                  <View style={styles.emptyIconCircle}>
                    <Ionicons name="document-text-outline" size={32} color={C.textMuted} />
                  </View>
                  <ThemedText style={styles.emptyTitle}>
                    {showingReportData ? "No Records" : "Start Here"}
                  </ThemedText>
                  <ThemedText style={styles.emptySubtitle}>
                    {showingReportData
                      ? "No reports found for this period."
                      : (searchQuery ? "No matching records." : "Configure parameters above.")}
                  </ThemedText>
                </View>
              }
            />
          )}
        </View>
      </ScrollView>

      {/* Preview Modal */}
      <Modal visible={selectedPreviewStudent !== null} transparent animationType="slide" onRequestClose={() => setSelectedPreviewStudent(null)}>
        <View style={[styles.previewOverlay, isTiny && { padding: 0 }]}>
          <View style={[styles.previewContainer, { backgroundColor: C.modalBg }]}>
            <View style={styles.previewHeader}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.previewTitle}>Performance</ThemedText>
                <ThemedText style={styles.previewSubtitle} numberOfLines={1}>
                  {selectedPreviewStudent?.name || `${selectedPreviewStudent?.first_name || ''} ${selectedPreviewStudent?.last_name || ''}`.trim()} - T{selectedPreviewStudent?.displayTerm}
                </ThemedText>
              </View>
              <TouchableOpacity onPress={() => setSelectedPreviewStudent(null)} style={styles.previewCloseBtn}>
                <Ionicons name="close" size={20} color={Colors.accent.gold} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              {(() => {
                const termToDisplay = selectedPreviewStudent?.displayTerm || '1';
                const subjectList = selectedPreviewStudent?.scores_by_term ? selectedPreviewStudent.scores_by_term[termToDisplay] : selectedPreviewStudent?.subjects;
                if (subjectList?.length > 0) {
                  return subjectList.map((subject: any, idx: number) => {
                    const total = Number(subject.student_total ?? subject.subject_total ?? subject.total_score) || (Number(subject.ca1_score || 0) + Number(subject.ca2_score || 0) + Number(subject.ca3_score || 0) + Number(subject.ca4_score || 0) + Number(subject.exam_score || 0));
                    return (
                      <View key={idx} style={styles.previewSubjectCard}>
                        <ThemedText style={styles.previewSubjectTitle}>{subject.subject_name || subject.subject || 'Subject'}</ThemedText>
                        <View style={styles.previewScoreRow}>
                          <ThemedText style={styles.previewScoreLabel}>CA Marks:</ThemedText>
                          <ThemedText style={styles.previewScoreValue}>{Number(subject.ca1_score || 0) + Number(subject.ca2_score || 0) + Number(subject.ca3_score || 0) + Number(subject.ca4_score || 0)} / 40</ThemedText>
                        </View>
                        <View style={styles.previewScoreRow}>
                          <ThemedText style={styles.previewScoreLabel}>Exam:</ThemedText>
                          <ThemedText style={styles.previewScoreValue}>{subject.exam_score || 0} / 60</ThemedText>
                        </View>
                        <View style={styles.previewTotalRow}>
                          <ThemedText style={styles.previewTotalLabel}>TOTAL:</ThemedText>
                          <ThemedText style={styles.previewTotalValue}>{total}%</ThemedText>
                        </View>
                      </View>
                    );
                  });
                }
                return (
                  <View style={{ padding: 30, alignItems: 'center' }}>
                    <Ionicons name="document-text-outline" size={40} color={C.textMuted} />
                    <ThemedText style={{ color: C.textSecondary, marginTop: 12, textAlign: 'center', fontSize: 12 }}>No scores yet.</ThemedText>
                  </View>
                );
              })()}
            </ScrollView>

            <View style={styles.previewFooter}>
              <View style={styles.previewActionRow}>
                <TouchableOpacity
                  style={[styles.previewRegenerate, regeneratingRemark && styles.previewRegenerateDisabled]}
                  onPress={() => {
                    setStatusAlert({
                      visible: true,
                      type: 'warning',
                      title: 'AI Synthesis',
                      message: 'This will reset and regenerate fresh AI remarks for this report card. Proceed?',
                      confirmLabel: 'Regenerate',
                      onConfirm: handleRegenerateRemark
                    });
                  }}
                  disabled={regeneratingRemark}
                >
                  {regeneratingRemark ? (
                    <ActivityIndicator size="small" color={Colors.accent.navy} />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={16} color={Colors.accent.navy} />
                      <ThemedText style={styles.previewRegenerateText}>AI Refine</ThemedText>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.previewSubmit} onPress={handleProceedToEmail}>
                  <ThemedText style={styles.previewSubmitText}>Send Email</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Email Modal */}
      <Modal visible={currentEmailRequest !== null} transparent animationType="fade" onRequestClose={() => setCurrentEmailRequest(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ThemedText style={styles.modalTitle}>Dispatch</ThemedText>
            <ThemedText style={styles.modalSubtitle}>Recipient's email address</ThemedText>
            <View style={styles.inputWrapper}>
              <Ionicons name="at" size={18} color={C.textMuted} />
              <TextInput style={styles.modalInput} placeholder="name@email.com" placeholderTextColor={C.textMuted} value={emailInput} onChangeText={setEmailInput} keyboardType="email-address" autoCapitalize="none" />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalCancel, loading && { opacity: 0.5 }]}
                onPress={() => setCurrentEmailRequest(null)}
                disabled={loading}
              >
                <ThemedText style={styles.modalCancelText}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmit, loading && { opacity: 0.7 }]}
                onPress={handleEmailModalSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={Colors.accent.navy} />
                ) : (
                  <ThemedText style={styles.modalSubmitText}>Send</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success Modal */}
      <Modal visible={showSuccessModal} transparent animationType="fade" onRequestClose={() => setShowSuccessModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.successIcon}><Ionicons name="checkmark-circle" size={48} color="#10B981" /></View>
            <ThemedText style={styles.modalTitle}>Sent!</ThemedText>
            <ThemedText style={styles.modalSubtitle}>Report has been transmitted.</ThemedText>
            <CustomButton title="OK" onPress={() => setShowSuccessModal(false)} variant="premium" style={{ width: '100%', paddingVertical: 14 }} />
          </View>
        </View>
      </Modal>

      {statusAlert.visible && (
        <CustomAlert type={statusAlert.type} title={statusAlert.title} message={statusAlert.message} onClose={() => setStatusAlert({ ...statusAlert, visible: false })} onConfirm={statusAlert.onConfirm} style={{ margin: 20 }} />
      )}
    </ThemedView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    mainWrapper: { flex: 1, backgroundColor: C.background },
    hero: { height: isTiny ? 160 : 220, width: '100%' },
    heroOverlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 22, paddingTop: isTiny ? 40 : 50 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: isTiny ? 10 : 16 },
    backButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: C.text, fontSize: isTiny ? 12 : 14, fontWeight: '800', letterSpacing: 0.5 },
    heroContent: { marginTop: 'auto', marginBottom: isTiny ? 12 : 18 },
    heroSubtitle: { color: Colors.accent.gold, fontSize: isTiny ? 8 : 9, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
    heroTitle: { color: C.text, fontSize: isTiny ? 22 : 28, fontWeight: '900', letterSpacing: -1 },
    contentWrapper: { paddingHorizontal: isTiny ? 16 : 20, marginTop: 0 },
    glassCard: { backgroundColor: C.card, borderRadius: isTiny ? 20 : 28, padding: isTiny ? 14 : 20, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 16 },
    modeToggle: { flexDirection: 'row', backgroundColor: C.inputBg, borderRadius: 14, padding: 3, marginBottom: isTiny ? 14 : 20 },
    modeBtn: { flex: 1, paddingVertical: isTiny ? 7 : 9, alignItems: 'center', borderRadius: 11 },
    activeModeBtn: { backgroundColor: Colors.accent.gold },
    modeBtnText: { color: C.textSecondary, fontSize: isTiny ? 10 : 12, fontWeight: '700' },
    activeModeBtnText: { color: Colors.accent.navy, fontWeight: '800' },
    searchWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderRadius: 14, paddingHorizontal: 14, height: isTiny ? 44 : 48, borderWidth: 1, borderColor: C.inputBorder },
    searchInput: { flex: 1, marginLeft: 10, color: C.inputText, fontSize: isTiny ? 11 : 13, fontWeight: '600' },
    filtersArea: { gap: 12, marginBottom: 10 },
    filterRow: { flexDirection: 'column', gap: 12 },
    filterGroup: { marginBottom: 4 },
    filterLabel: { color: C.textLabel, fontSize: 8, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
    inputSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 12, paddingHorizontal: 12, height: isTiny ? 42 : 46, borderWidth: 1, borderColor: C.inputBorder },
    selectorText: { color: C.inputText, fontSize: isTiny ? 11 : 13, fontWeight: '700' },
    selectorList: { backgroundColor: C.modalBg, borderRadius: 12, marginTop: 6, padding: 6, borderWidth: 1, borderColor: C.cardBorder },
    selectorItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 8 },
    selectorItemActive: { backgroundColor: 'rgba(250, 204, 21, 0.1)' },
    selectorItemText: { color: C.textSecondary, fontSize: 11, fontWeight: '600' },
    selectorItemTextActive: { color: Colors.accent.gold, fontWeight: '800' },
    backLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    listContent: { paddingHorizontal: isTiny ? 16 : 20, paddingTop: 8, paddingBottom: 100 },
    resultCard: { backgroundColor: C.card, borderRadius: 20, padding: isTiny ? 12 : 14, flexDirection: 'row', alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: C.cardBorder },
    avatarContainer: { width: isTiny ? 40 : 48, height: isTiny ? 40 : 48, borderRadius: 14, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.accent.gold },
    avatarText: { color: Colors.accent.gold, fontSize: isTiny ? 12 : 14, fontWeight: '800' },
    rankBadge: { width: isTiny ? 40 : 48, height: isTiny ? 40 : 48, borderRadius: 14, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center' },
    rankText: { color: Colors.accent.navy, fontSize: isTiny ? 14 : 16, fontWeight: '900' },
    studentInfo: { flex: 1, marginLeft: isTiny ? 10 : 14 },
    resultTitle: { fontSize: isTiny ? 13 : 15, fontWeight: '800', color: C.text, marginBottom: 3 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
    resultSubtitle: { fontSize: 10, color: C.textSecondary, fontWeight: '600' },
    scoreMeta: { fontSize: 9, color: Colors.accent.gold, fontWeight: '800', marginBottom: 10 },
    termSection: { flexDirection: 'row', gap: 5, marginBottom: 12 },
    miniChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: C.actionItemBg },
    activeMiniChip: { backgroundColor: Colors.accent.gold },
    miniChipText: { fontSize: 8, color: C.textSecondary, fontWeight: '800' },
    activeMiniChipText: { color: Colors.accent.navy },
    cardActions: { gap: 8, flexDirection: 'row' },
    fullActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 10, backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.cardBorder },
    actionBtnText: { fontSize: 10, fontWeight: '700', color: C.text },
    centerLoader: { padding: 40, alignItems: 'center' },
    loaderText: { color: Colors.accent.gold, marginTop: 10, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
    errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: 12, borderRadius: 12 },
    errorText: { color: '#EF4444', fontSize: 12, fontWeight: '600', flex: 1 },
    emptyIconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    emptyTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 6 },
    emptySubtitle: { color: C.textSecondary, fontSize: 11, textAlign: 'center', lineHeight: 16 },
    previewOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'center', padding: isTiny ? 4 : 20 },
    previewContainer: { borderRadius: isTiny ? 16 : 24, flex: 1, maxHeight: isTiny ? '98%' : '85%', overflow: 'hidden', borderWidth: 1, borderColor: C.cardBorder },
    previewHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.divider },
    previewTitle: { fontSize: 18, fontWeight: '900', color: C.text },
    previewSubtitle: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
    previewCloseBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    previewSubjectCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.divider },
    previewSubjectTitle: { fontSize: 12, fontWeight: '800', color: Colors.accent.gold, marginBottom: 8 },
    previewScoreRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    previewScoreLabel: { fontSize: 10, color: C.textSecondary },
    previewScoreValue: { fontSize: 10, fontWeight: '700', color: C.text },
    previewTotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.divider },
    previewTotalLabel: { fontSize: 10, fontWeight: '800', color: C.text },
    previewTotalValue: { fontSize: 12, fontWeight: '900', color: Colors.accent.gold },
    previewFooter: { padding: 16, borderTopWidth: 1, borderTopColor: C.divider, backgroundColor: C.modalBg },
    previewActionRow: { flexDirection: 'row', gap: 10 },
    previewRegenerate: { flex: 1, height: 44, borderRadius: 14, backgroundColor: Colors.accent.gold, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
    previewRegenerateText: { color: Colors.accent.navy, fontWeight: '800', fontSize: 13 },
    previewRegenerateDisabled: { opacity: 0.5 },
    previewSubmit: { flex: 1, height: 44, backgroundColor: Colors.accent.gold, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    previewSubmitText: { color: Colors.accent.navy, fontWeight: '900', fontSize: 13 },
    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: C.modalBg, borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: C.cardBorder },
    modalTitle: { fontSize: 18, fontWeight: '900', color: C.text, marginBottom: 6 },
    modalSubtitle: { color: C.textSecondary, fontSize: 12, textAlign: 'center', marginBottom: 18, lineHeight: 18 },
    inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderRadius: 14, paddingHorizontal: 14, height: 48, marginBottom: 18, borderWidth: 1, borderColor: C.inputBorder, width: '100%' },
    modalInput: { flex: 1, marginLeft: 10, color: C.inputText, fontSize: 14, fontWeight: '600' },
    modalActions: { flexDirection: 'row', gap: 10, width: '100%' },
    modalCancel: { flex: 1, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: C.actionItemBg },
    modalCancelText: { color: C.text, fontSize: 13, fontWeight: '700' },
    modalSubmit: { flex: 2, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: Colors.accent.gold },
    modalSubmitText: { color: Colors.accent.navy, fontSize: 13, fontWeight: '800' },
    successIcon: { marginBottom: 12 }
  });
}