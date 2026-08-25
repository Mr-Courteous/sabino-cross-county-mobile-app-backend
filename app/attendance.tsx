// ─────────────────────────────────────────────────────────────
// app/attendance.tsx
//
// Attendance Register screen — daily roll call, a weekly grid, and
// a terminal summary, backed by routes/attendance on the server.
//
// Access rule (enforced server-side, mirrored here for UX):
//   - School owner and full admins -> can take/view attendance for
//     ANY class in the school, and the class picker is unlocked.
//   - A class_teacher account -> locked to their ONE assigned class
//     (see utils/jwt-decoder -> getTeacherClassScope). The class
//     picker is disabled and pre-filled.
//   - A class_teacher with no class assigned yet -> every attendance
//     route rejects with 403 'NOT_ASSIGNED_TO_CLASS'; this screen
//     shows a dedicated empty state instead of a broken picker.
// The frontend lock is a UX convenience only — routes/attendance/db.js
// -> requireClassAccess() is what actually enforces this, so a
// mismatched classId is always rejected by the server regardless of
// what this screen sends.
// ─────────────────────────────────────────────────────────────
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
  FlatList,
  KeyboardAvoidingView,
  ImageBackground,
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  useWindowDimensions,
} from 'react-native';
import { useState, useEffect, useMemo, Fragment } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { API_BASE_URL } from '@/utils/api-service';
import { isSchoolOwner, getTeacherClassScope } from '@/utils/jwt-decoder';
import { Colors } from '@/constants/design-system';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { AttendanceDatePicker } from '@/components/attendance-date-picker';
import { useAppColors } from '@/hooks/use-app-colors';
import {
  attendanceApi,
  AttendanceClass,
  AttendanceLegendItem,
  AttendanceStatus,
  AttendancePeriod,
  AttendanceDateSummary,
  BroadsheetData,
  DEFAULT_LEGEND,
  STATUS_COLORS,
} from '@/utils/attendance-api';

// ── Types ────────────────────────────────────────────────────
interface SessionOption {
  id: number;
  session_name: string;
  is_active?: boolean;
}

interface DayStudentRow {
  enrollmentId: number;
  studentId: number;
  firstName: string;
  lastName: string;
  registrationNumber: string;
  gender: string;
  serial: number | null;
  status: AttendanceStatus | null;
}

interface WeekStudentRow {
  enrollmentId: number;
  serial: number | null;
  firstName: string;
  lastName: string;
  registrationNumber: string;
  gender: string;
  days: Record<string, AttendanceStatus | null>;
}

interface WeekData {
  weekStart: string;
  weekEnd: string;
  students: WeekStudentRow[];
  dailyTotals: { date: string; boysPresent: number; girlsPresent: number; totalPresent: number }[];
}

interface SummaryStudentRow {
  enrollmentId: number;
  serial: number | null;
  firstName: string;
  lastName: string;
  registrationNumber: string;
  timesSchoolOpened: number;
  timesPresent: number;
  timesAbsent: number;
  timesLate: number;
  timesSick: number;
  timesExcused: number;
  percentageAttendance: number | null;
  meetsPromotionRequirement: boolean | null;
  remarks: string | null;
}

interface SummaryData {
  sessionsHeld: number;
  minPercentage: number;
  students: SummaryStudentRow[];
}

type TabKey = 'mark' | 'week' | 'broadsheet' | 'summary' | 'signoff';

interface SignoffData {
  id?: number;
  teacher_signed_at: string | null;
  teacher_signed_by_type: string | null;
  teacher_signed_by_staff_id: number | null;
  principal_signed_at: string | null;
  principal_name: string | null;
  principal_signed_by_staff_id: number | null;
  inspector_signed_at: string | null;
  inspector_name: string | null;
  inspector_notes: string | null;
}

// ── Helpers ──────────────────────────────────────────────────
const TERMS = ['First', 'Second', 'Third'];
const PERIODS: { value: AttendancePeriod; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'full_day', label: 'Full Day', icon: 'sunny-outline' },
  { value: 'morning', label: 'Morning', icon: 'partly-sunny-outline' },
  { value: 'afternoon', label: 'Afternoon', icon: 'moon-outline' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const shiftDate = (dateStr: string, n: number) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isWeekendStr = (dateStr: string) => {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};
const formatLongDate = (dateStr: string) => {
  try {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return dateStr;
  }
};
const formatShortDate = (dateStr: string) => {
  try {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
  } catch {
    return dateStr;
  }
};
const formatDateTime = (iso: string | null) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
};
const initials = (first?: string, last?: string) => `${(first || '?')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

export default function AttendanceScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);

  // Auth
  const [token, setToken] = useState('');
  const [isOwner, setIsOwner] = useState(true);
  // A class_teacher is locked to their assigned class — null for
  // owner/admin (unrestricted) accounts.
  const [classScope, setClassScope] = useState<{ classId: number } | null>(null);
  const [notAssigned, setNotAssigned] = useState(false);

  // Reference data
  const [classes, setClasses] = useState<AttendanceClass[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [legend, setLegend] = useState<AttendanceLegendItem[]>(DEFAULT_LEGEND);

  // Selection
  const [selectedClass, setSelectedClass] = useState<AttendanceClass | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedSessionName, setSelectedSessionName] = useState('');
  const [selectedTerm, setSelectedTerm] = useState('First');
  const [selectedTermId, setSelectedTermId] = useState(1);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [selectedPeriod, setSelectedPeriod] = useState<AttendancePeriod>('full_day');
  const [activeModal, setActiveModal] = useState<'session' | 'term' | 'class' | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('mark');

  // Day (Mark) tab data
  const [dayStudents, setDayStudents] = useState<DayStudentRow[]>([]);
  const [dayErrorMessage, setDayErrorMessage] = useState<string | null>(null);

  // Week tab data
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [weekErrorMessage, setWeekErrorMessage] = useState<string | null>(null);

  // Broadsheet tab data — the full saved-records register for a term.
  const [broadsheetData, setBroadsheetData] = useState<BroadsheetData | null>(null);
  const [broadsheetErrorMessage, setBroadsheetErrorMessage] = useState<string | null>(null);
  const [loadingBroadsheet, setLoadingBroadsheet] = useState(false);
  const [downloadingBroadsheetPdf, setDownloadingBroadsheetPdf] = useState(false);

  // Dates with saved records for the current class/session (any term/
  // period) — powers the calendar date-picker's dot indicators.
  const [recordedDates, setRecordedDates] = useState<Set<string>>(new Set());
  const [datePickerVisible, setDatePickerVisible] = useState(false);


  // Summary tab data
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [summaryErrorMessage, setSummaryErrorMessage] = useState<string | null>(null);
  const [remarkDrafts, setRemarkDrafts] = useState<Record<number, string>>({});
  const [savingRemarkId, setSavingRemarkId] = useState<number | null>(null);

  // Sign-off tab data — weekly teacher -> principal -> inspector trail.
  // Independent blocks; each party fills theirs in whenever ready.
  const [selectedWeekNumber, setSelectedWeekNumber] = useState(1);
  const [signoffData, setSignoffData] = useState<SignoffData | null>(null);
  const [signoffErrorMessage, setSignoffErrorMessage] = useState<string | null>(null);
  const [loadingSignoff, setLoadingSignoff] = useState(false);
  const [savingSignoffRole, setSavingSignoffRole] = useState<'teacher' | 'principal' | 'inspector' | null>(null);
  const [principalName, setPrincipalName] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [inspectorNotes, setInspectorNotes] = useState('');

  // Loading / status
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [initError, setInitError] = useState('');
  const [loadingDay, setLoadingDay] = useState(false);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusAlert, setStatusAlert] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
  }>({ visible: false, type: 'info', title: '', message: '' });

  const showAlert = (type: typeof statusAlert.type, title: string, message: string, autoHide = false) => {
    setStatusAlert({ visible: true, type, title, message });
    if (autoHide) setTimeout(() => setStatusAlert((prev) => ({ ...prev, visible: false })), 2800);
  };

  useEffect(() => {
    initializeScreen();
  }, []);

  useEffect(() => {
    const idx = TERMS.indexOf(selectedTerm);
    setSelectedTermId(idx + 1);
  }, [selectedTerm]);

  useEffect(() => {
    if (activeTab === 'mark' && selectedClass && selectedSessionId) loadDay();
  }, [activeTab, selectedClass?.id, selectedSessionId, selectedDate, selectedPeriod]);

  useEffect(() => {
    if (activeTab === 'week' && selectedClass && selectedSessionId) loadWeek();
  }, [activeTab, selectedClass?.id, selectedSessionId, selectedDate, selectedPeriod]);

  useEffect(() => {
    if (activeTab === 'broadsheet' && selectedClass && selectedSessionId) loadBroadsheet();
  }, [activeTab, selectedClass?.id, selectedSessionId, selectedTermId, selectedPeriod]);

  useEffect(() => {
    // Refresh the "which dates have records" set whenever the class,
    // session, or term changes, so the date picker's dots stay accurate
    // no matter which tab the person opens it from.
    if (selectedClass && selectedSessionId) loadRecordedDates();
  }, [selectedClass?.id, selectedSessionId, selectedTermId]);

  useEffect(() => {
    if (activeTab === 'summary' && selectedClass && selectedSessionId) loadSummary();
  }, [activeTab, selectedClass?.id, selectedSessionId, selectedTermId]);

  useEffect(() => {
    if (activeTab === 'signoff' && selectedClass && selectedSessionId) loadSignoff();
  }, [activeTab, selectedClass?.id, selectedSessionId, selectedTermId, selectedWeekNumber]);

  useEffect(() => {
    // Prefill the name/notes inputs from whatever's already on record so
    // re-signing (e.g. fixing a typo'd name) doesn't start from blank.
    setPrincipalName(signoffData?.principal_name || '');
    setInspectorName(signoffData?.inspector_name || '');
    setInspectorNotes(signoffData?.inspector_notes || '');
  }, [signoffData]);

  // ── Bootstrap ────────────────────────────────────────────────
  const initializeScreen = async () => {
    try {
      setLoadingInitial(true);
      setInitError('');
      setNotAssigned(false);

      let tokenValue = '';
      if (Platform.OS !== 'web') {
        try {
          tokenValue = (await SecureStore.getItemAsync('userToken')) || '';
        } catch (e) {
          tokenValue = localStorage.getItem('userToken') || '';
        }
      } else {
        tokenValue = localStorage.getItem('userToken') || '';
      }

      if (!tokenValue) {
        setInitError('Authentication failed: No token found. Please login again.');
        return;
      }

      const scope = getTeacherClassScope(tokenValue);
      setToken(tokenValue);
      setIsOwner(isSchoolOwner(tokenValue));
      setClassScope(scope);

      const [classesRes, legendRes, sessionsRes] = await Promise.all([
        attendanceApi.getClasses(tokenValue),
        attendanceApi.getLegend(tokenValue),
        fetch(`${API_BASE_URL}/api/academic-sessions`, {
          headers: { Authorization: `Bearer ${tokenValue}`, 'Content-Type': 'application/json' },
        }),
      ]);

      if (classesRes.status === 402) {
        router.replace('/pricing');
        return;
      }
      if (classesRes.status === 403 && classesRes.json.code === 'NOT_ASSIGNED_TO_CLASS') {
        setNotAssigned(true);
        return;
      }
      if (classesRes.json.success && Array.isArray(classesRes.json.data)) {
        const classList = classesRes.json.data as AttendanceClass[];
        setClasses(classList);
        if (classList.length > 0) {
          const preferred = scope ? classList.find((c) => c.id === scope.classId) || classList[0] : classList[0];
          setSelectedClass(preferred);
        }
      }

      if (legendRes.json.success && legendRes.json.data?.legend) {
        setLegend(legendRes.json.data.legend);
      }

      if (sessionsRes.status === 402) {
        router.replace('/pricing');
        return;
      }
      const sessionsJson = await sessionsRes.json();
      if (sessionsJson.success && Array.isArray(sessionsJson.data)) {
        const mapped: SessionOption[] = sessionsJson.data.map((s: any) => ({
          id: s.id,
          session_name: s.session_name || s.name,
          is_active: s.is_active,
        }));
        setSessions(mapped);
        const active = mapped.find((s) => s.is_active) || mapped[0];
        if (active) {
          setSelectedSessionId(active.id);
          setSelectedSessionName(active.session_name);
        }
      }
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to load attendance data.');
    } finally {
      setLoadingInitial(false);
    }
  };

  // ── Mark (Daily) tab ─────────────────────────────────────────
  const loadDay = async () => {
    if (!token || !selectedClass || !selectedSessionId) return;
    try {
      setLoadingDay(true);
      setDayErrorMessage(null);
      const r = await attendanceApi.getDay(token, selectedClass.id, {
        sessionId: selectedSessionId,
        date: selectedDate,
        period: selectedPeriod,
      });
      if (r.status === 402) {
        router.replace('/pricing');
        return;
      }
      if (r.status === 403 && r.json.code === 'CLASS_SCOPE_VIOLATION') {
        setDayErrorMessage('You can only take attendance for your assigned class.');
        setDayStudents([]);
        return;
      }
      if (!r.json.success) {
        setDayErrorMessage(r.json.error || 'Unable to load the register for this date.');
        setDayStudents([]);
        return;
      }
      const students: DayStudentRow[] = (r.json.data?.students || []).map((s: any) => ({
        enrollmentId: s.enrollment_id,
        studentId: s.student_id,
        firstName: s.first_name,
        lastName: s.last_name,
        registrationNumber: s.registration_number || 'N/A',
        gender: s.gender,
        serial: s.serial,
        status: s.status,
      }));
      setDayStudents(students);
    } catch (err) {
      setDayErrorMessage('Connection error while loading the register.');
      setDayStudents([]);
    } finally {
      setLoadingDay(false);
    }
  };

  const setLocalStatus = (enrollmentId: number, status: AttendanceStatus) => {
    setDayStudents((prev) => prev.map((s) => (s.enrollmentId === enrollmentId ? { ...s, status } : s)));
  };

  const markAllPresent = () => {
    setDayStudents((prev) => prev.map((s) => ({ ...s, status: 'present' as AttendanceStatus })));
  };

  const markAllAbsent = () => {
    setDayStudents((prev) => prev.map((s) => ({ ...s, status: 'absent' as AttendanceStatus })));
  };

  const clearAllMarks = () => {
    setDayStudents((prev) => prev.map((s) => ({ ...s, status: null })));
  };

  const handleSaveDay = async () => {
    if (!selectedClass || !selectedSessionId) return;
    const records = dayStudents
      .filter((s) => !!s.status)
      .map((s) => ({ enrollmentId: s.enrollmentId, status: s.status as AttendanceStatus }));

    if (records.length === 0) {
      showAlert('error', 'Nothing to Save', 'Mark at least one student before saving.');
      return;
    }
    if (isWeekendStr(selectedDate)) {
      showAlert('warning', 'Weekend Selected', 'Attendance can only be recorded Monday to Friday.');
      return;
    }

    try {
      setSaving(true);
      const r = await attendanceApi.markAttendance(token, {
        classId: selectedClass.id,
        sessionId: selectedSessionId,
        term: selectedTermId,
        date: selectedDate,
        period: selectedPeriod,
        records,
      });
      if (r.status === 402) {
        router.replace('/pricing');
        return;
      }
      if (r.json.success) {
        showAlert('success', 'Register Saved', `${r.json.data?.saved ?? records.length} student(s) recorded for ${formatLongDate(selectedDate)}.`, true);
        loadDay();
      } else {
        showAlert('error', 'Save Failed', r.json.error || 'Unable to save attendance.');
      }
    } catch (err) {
      showAlert('error', 'Error', 'Connection error while saving the register.');
    } finally {
      setSaving(false);
    }
  };

  // ── Week tab ─────────────────────────────────────────────────
  const loadWeek = async () => {
    if (!token || !selectedClass || !selectedSessionId) return;
    try {
      setLoadingWeek(true);
      setWeekErrorMessage(null);
      const r = await attendanceApi.getWeek(token, selectedClass.id, {
        sessionId: selectedSessionId,
        weekStart: selectedDate,
        period: selectedPeriod,
      });
      if (r.status === 402) {
        router.replace('/pricing');
        return;
      }
      if (r.status === 403 && r.json.code === 'CLASS_SCOPE_VIOLATION') {
        setWeekErrorMessage('You can only view the register for your assigned class.');
        setWeekData(null);
        return;
      }
      if (r.json.success) {
        setWeekData(r.json.data);
      } else {
        setWeekErrorMessage(r.json.error || 'Unable to load the weekly grid.');
        setWeekData(null);
      }
    } catch (err) {
      setWeekErrorMessage('Connection error while loading the weekly grid.');
      setWeekData(null);
    } finally {
      setLoadingWeek(false);
    }
  };

  // ── Recorded dates (powers the date-picker's dot indicators) ───
  const loadRecordedDates = async () => {
    if (!token || !selectedClass || !selectedSessionId) return;
    try {
      const r = await attendanceApi.getDates(token, selectedClass.id, {
        sessionId: selectedSessionId,
        term: selectedTermId,
      });
      if (r.json.success && Array.isArray(r.json.data)) {
        const dates = (r.json.data as AttendanceDateSummary[]).map((d) => d.date);
        setRecordedDates(new Set(dates));
      }
    } catch (err) {
      // Non-critical — the picker just renders without dots.
    }
  };

  // ── Broadsheet tab ───────────────────────────────────────────
  const loadBroadsheet = async () => {
    if (!token || !selectedClass || !selectedSessionId) return;
    try {
      setLoadingBroadsheet(true);
      setBroadsheetErrorMessage(null);
      const r = await attendanceApi.getBroadsheet(token, selectedClass.id, {
        sessionId: selectedSessionId,
        term: selectedTermId,
        period: selectedPeriod,
      });
      if (r.status === 402) {
        router.replace('/pricing');
        return;
      }
      if (r.status === 403 && r.json.code === 'CLASS_SCOPE_VIOLATION') {
        setBroadsheetErrorMessage('You can only view the broadsheet for your assigned class.');
        setBroadsheetData(null);
        return;
      }
      if (r.json.success) {
        setBroadsheetData(r.json.data);
      } else {
        setBroadsheetErrorMessage(r.json.error || 'Unable to load the broadsheet.');
        setBroadsheetData(null);
      }
    } catch (err) {
      setBroadsheetErrorMessage('Connection error while loading the broadsheet.');
      setBroadsheetData(null);
    } finally {
      setLoadingBroadsheet(false);
    }
  };

  // Downloads the broadsheet PDF from the backend and opens the
  // native share sheet so the person can save it or send it on.
  const handleDownloadBroadsheetPdf = async () => {
    if (!token || !selectedClass || !selectedSessionId) return;
    setDownloadingBroadsheetPdf(true);
    try {
      const url = attendanceApi.getBroadsheetPdfUrl(selectedClass.id, {
        sessionId: selectedSessionId,
        term: selectedTermId,
        period: selectedPeriod,
      });
      const fileName = `${selectedClass.class_name}_Term${selectedTermId}_Broadsheet.pdf`.replace(/\s+/g, '_');
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

      const downloadResult = await FileSystem.downloadAsync(url, fileUri, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (downloadResult.status !== 200) {
        throw new Error('Failed to download the broadsheet PDF.');
      }

      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (!isSharingAvailable) {
        showAlert('error', 'Sharing unavailable', 'Sharing is not available on this device.');
        return;
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/pdf',
        dialogTitle: `${selectedClass.class_name} - Term ${selectedTermId} Broadsheet`,
        UTI: 'com.adobe.pdf',
      });
    } catch (err: any) {
      showAlert('error', 'Download Failed', err.message || 'Could not download the broadsheet PDF. Please try again.');
    } finally {
      setDownloadingBroadsheetPdf(false);
    }
  };


  const loadSummary = async () => {
    if (!token || !selectedClass || !selectedSessionId) return;
    try {
      setLoadingSummary(true);
      setSummaryErrorMessage(null);
      const r = await attendanceApi.getSummary(token, selectedClass.id, {
        sessionId: selectedSessionId,
        term: selectedTermId,
        minPercentage: 75,
      });
      if (r.status === 402) {
        router.replace('/pricing');
        return;
      }
      if (r.status === 403 && r.json.code === 'CLASS_SCOPE_VIOLATION') {
        setSummaryErrorMessage('You can only view the summary for your assigned class.');
        setSummaryData(null);
        return;
      }
      if (r.json.success) {
        setSummaryData(r.json.data);
        const drafts: Record<number, string> = {};
        (r.json.data?.students || []).forEach((s: any) => {
          drafts[s.enrollmentId] = s.remarks || '';
        });
        setRemarkDrafts(drafts);
      } else {
        setSummaryErrorMessage(r.json.error || 'Unable to load the term summary.');
        setSummaryData(null);
      }
    } catch (err) {
      setSummaryErrorMessage('Connection error while loading the term summary.');
      setSummaryData(null);
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleSaveRemark = async (enrollmentId: number) => {
    if (!selectedClass || !selectedSessionId) return;
    try {
      setSavingRemarkId(enrollmentId);
      const r = await attendanceApi.putRemarks(token, selectedClass.id, {
        sessionId: selectedSessionId,
        term: selectedTermId,
        enrollmentId,
        remarks: remarkDrafts[enrollmentId] || '',
      });
      if (r.json.success) {
        showAlert('success', 'Remark Saved', 'Terminal remark updated.', true);
      } else {
        showAlert('error', 'Save Failed', r.json.error || 'Unable to save remark.');
      }
    } catch (err) {
      showAlert('error', 'Error', 'Connection error while saving the remark.');
    } finally {
      setSavingRemarkId(null);
    }
  };

  // ── Sign-off tab ─────────────────────────────────────────────
  const loadSignoff = async () => {
    if (!token || !selectedClass || !selectedSessionId) return;
    try {
      setLoadingSignoff(true);
      setSignoffErrorMessage(null);
      const r = await attendanceApi.getSignoff(token, selectedClass.id, {
        sessionId: selectedSessionId,
        term: selectedTermId,
        weekNumber: selectedWeekNumber,
      });
      if (r.status === 402) {
        router.replace('/pricing');
        return;
      }
      if (r.status === 403 && r.json.code === 'CLASS_SCOPE_VIOLATION') {
        setSignoffErrorMessage('You can only view the sign-off trail for your assigned class.');
        setSignoffData(null);
        return;
      }
      if (r.json.success) {
        setSignoffData(r.json.data || null);
      } else {
        setSignoffErrorMessage(r.json.error || 'Unable to load sign-off status.');
        setSignoffData(null);
      }
    } catch (err) {
      setSignoffErrorMessage('Connection error while loading sign-off status.');
      setSignoffData(null);
    } finally {
      setLoadingSignoff(false);
    }
  };

  const handleSignoff = async (role: 'teacher' | 'principal' | 'inspector') => {
    if (!selectedClass || !selectedSessionId) return;

    // Mirrors the server rule (routes/attendance/index.js POST /signoff):
    // only the school owner or a non-class-scoped admin can record the
    // principal's or inspector's sign-off — a class_teacher can only
    // sign their own "teacher" block.
    if ((role === 'principal' || role === 'inspector') && classScope) {
      showAlert('error', 'Not Permitted', `Only the school owner or an administrator can record the ${role}'s sign-off.`);
      return;
    }

    const name = role === 'principal' ? principalName.trim() : role === 'inspector' ? inspectorName.trim() : undefined;
    if ((role === 'principal' || role === 'inspector') && !name) {
      showAlert('error', 'Name Required', `Enter a name to record the ${role}'s sign-off.`);
      return;
    }

    try {
      setSavingSignoffRole(role);
      const r = await attendanceApi.postSignoff(token, selectedClass.id, {
        sessionId: selectedSessionId,
        term: selectedTermId,
        weekNumber: selectedWeekNumber,
        role,
        name,
        notes: role === 'inspector' ? inspectorNotes.trim() || undefined : undefined,
      });
      if (r.status === 402) {
        router.replace('/pricing');
        return;
      }
      if (r.status === 403) {
        showAlert('error', 'Not Permitted', r.json.error || `Only the school owner or an administrator can record the ${role}'s sign-off.`);
        return;
      }
      if (r.json.success) {
        setSignoffData(r.json.data);
        showAlert('success', 'Signed Off', `${role.charAt(0).toUpperCase()}${role.slice(1)}'s sign-off recorded for Week ${selectedWeekNumber}.`, true);
      } else {
        showAlert('error', 'Save Failed', r.json.error || 'Unable to record sign-off.');
      }
    } catch (err) {
      showAlert('error', 'Error', 'Connection error while recording the sign-off.');
    } finally {
      setSavingSignoffRole(null);
    }
  };

  // ── Derived ──────────────────────────────────────────────────
  const markedSoFar = dayStudents.filter((s) => !!s.status).length;
  const weekendSelected = isWeekendStr(selectedDate);

  // ── Early states ─────────────────────────────────────────────
  if (loadingInitial) {
    return (
      <View style={[styles.mainWrapper, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={{ marginTop: 24, fontSize: 9, fontWeight: '800', letterSpacing: 2, color: Colors.accent.gold }}>
          LOADING REGISTER...
        </ThemedText>
      </View>
    );
  }

  if (notAssigned) {
    return (
      <View style={[styles.mainWrapper, { justifyContent: 'center', alignItems: 'center', padding: 30 }]}>
        <Ionicons name="school-outline" size={56} color={C.textMuted} />
        <ThemedText style={{ fontSize: 17, fontWeight: '900', color: C.text, marginTop: 18, textAlign: 'center' }}>
          Not Assigned to a Class
        </ThemedText>
        <ThemedText style={{ fontSize: 12, color: C.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 18 }}>
          You don't have a class assigned yet, so there's no register to take attendance for. Ask your school owner or admin to assign you to a class.
        </ThemedText>
        <CustomButton title="Go Back" onPress={() => router.back()} variant="premium" style={{ marginTop: 24, paddingHorizontal: 32 }} fullWidth={false} />
      </View>
    );
  }

  if (initError) {
    return (
      <View style={[styles.mainWrapper, { justifyContent: 'center', alignItems: 'center', padding: 30 }]}>
        <Ionicons name="alert-circle-outline" size={56} color="#EF4444" />
        <ThemedText style={{ fontSize: 15, fontWeight: '800', color: C.text, marginTop: 16, textAlign: 'center' }}>{initError}</ThemedText>
        <CustomButton title="Retry" onPress={initializeScreen} variant="premium" style={{ marginTop: 20, paddingHorizontal: 32 }} fullWidth={false} />
      </View>
    );
  }

  // ── Picker modal (Session / Term / Class) ───────────────────
  const renderPickerModal = () => {
    if (!activeModal) return null;

    let data: any[] = [];
    let title = '';
    let currentSelection: any = null;
    let onSelect = (item: any) => {};

    if (activeModal === 'session') {
      data = sessions;
      title = 'Select Session';
      currentSelection = selectedSessionId;
      onSelect = (item) => {
        setSelectedSessionId(item.id);
        setSelectedSessionName(item.session_name);
      };
    } else if (activeModal === 'term') {
      data = TERMS.map((t) => ({ id: t, name: t }));
      title = 'Select Term';
      currentSelection = selectedTerm;
      onSelect = (item) => setSelectedTerm(item.name);
    } else if (activeModal === 'class') {
      data = classes;
      title = 'Select Class';
      currentSelection = selectedClass?.id;
      onSelect = (item) => setSelectedClass(item);
    }

    return (
      <Modal visible transparent animationType="slide" onRequestClose={() => setActiveModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActiveModal(null)}>
          <TouchableWithoutFeedback>
            <View style={[styles.bottomSheet, { backgroundColor: C.modalBg, borderColor: C.cardBorder }]}>
              <View style={styles.sheetHandle} />
              <ThemedText style={styles.modalTitle}>{title}</ThemedText>
              <FlatList
                data={data}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => {
                  const isSelected = activeModal === 'term' ? item.name === currentSelection : item.id === currentSelection;
                  return (
                    <TouchableOpacity
                      style={[styles.dropdownItem, isSelected && styles.selectedItem]}
                      onPress={() => {
                        onSelect(item);
                        setActiveModal(null);
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                        <ThemedText style={[styles.dropdownItemText, isSelected && styles.selectedItemText]}>
                          {item.session_name || item.class_name || item.name}
                        </ThemedText>
                        <View
                          style={[
                            styles.radioDot,
                            { borderColor: isSelected ? Colors.accent.gold : C.divider, backgroundColor: isSelected ? Colors.accent.gold : 'transparent' },
                          ]}
                        >
                          {isSelected && <Ionicons name="checkmark" size={12} color={Colors.accent.navy} />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={<ThemedText style={{ color: C.textMuted, textAlign: 'center', padding: 20 }}>No options available.</ThemedText>}
                contentContainerStyle={{ paddingBottom: 30 }}
              />
            </View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
      </Modal>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={styles.mainWrapper}>
        <ImageBackground
          source={{ uri: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?q=80&w=2070' }}
          style={styles.hero}
        >
          <LinearGradient colors={['transparent', C.isDark ? Colors.accent.navy : C.background]} style={styles.heroOverlay}>
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={20} color={C.isDark ? '#FFFFFF' : Colors.accent.navy} />
              </TouchableOpacity>
              <ThemedText style={styles.headerTitle}>ATTENDANCE REGISTER</ThemedText>
              <View style={{ width: 40 }} />
            </View>
            <View style={styles.heroContent}>
              <ThemedText style={styles.heroSubtitle}>DAILY ROLL CALL</ThemedText>
              <ThemedText style={styles.heroTitle}>{selectedClass ? selectedClass.class_name : 'Attendance'}</ThemedText>
            </View>
          </LinearGradient>
        </ImageBackground>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.contentWrapper}>
            {!!classScope && (
              <View style={styles.scopeBanner}>
                <Ionicons name="lock-closed" size={13} color={Colors.accent.gold} />
                <ThemedText style={styles.scopeBannerText}>
                  You're restricted to your assigned class{selectedClass ? ` — ${selectedClass.class_name}` : ''}.
                </ThemedText>
              </View>
            )}

            {/* Filters */}
            <View style={styles.glassCard}>
              <View style={styles.filterGrid}>
                <View style={styles.gridItem}>
                  <ThemedText style={styles.label}>SESSION</ThemedText>
                  <TouchableOpacity style={styles.miniPicker} onPress={() => setActiveModal('session')}>
                    <ThemedText style={styles.miniPickerText} numberOfLines={1}>{selectedSessionName || 'Select'}</ThemedText>
                    <Ionicons name="calendar-outline" size={12} color={Colors.accent.gold} />
                  </TouchableOpacity>
                </View>
                <View style={styles.gridItem}>
                  <ThemedText style={styles.label}>TERM</ThemedText>
                  <TouchableOpacity style={styles.miniPicker} onPress={() => setActiveModal('term')}>
                    <ThemedText style={styles.miniPickerText}>{selectedTerm}</ThemedText>
                    <Ionicons name="time-outline" size={12} color={Colors.accent.gold} />
                  </TouchableOpacity>
                </View>
                <View style={[styles.gridItem, { flex: width < 300 ? 1 : 1.5, minWidth: width < 300 ? '100%' : undefined }]}>
                  <ThemedText style={styles.label}>CLASS</ThemedText>
                  <TouchableOpacity
                    style={[styles.miniPicker, !!classScope && { opacity: 0.55 }]}
                    onPress={() => !classScope && setActiveModal('class')}
                    disabled={!!classScope}
                  >
                    <ThemedText style={selectedClass ? styles.miniPickerText : styles.placeholderText} numberOfLines={1}>
                      {selectedClass ? selectedClass.class_name : 'Choose...'}
                    </ThemedText>
                    {!classScope && <Ionicons name="school-outline" size={12} color={Colors.accent.gold} />}
                    {!!classScope && <Ionicons name="lock-closed" size={11} color={C.textMuted} />}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Period pills */}
              <ThemedText style={styles.label}>PERIOD</ThemedText>
              <View style={styles.periodRow}>
                {PERIODS.map((p) => {
                  const active = selectedPeriod === p.value;
                  return (
                    <TouchableOpacity
                      key={p.value}
                      style={[styles.periodPill, { borderColor: active ? Colors.accent.gold : C.inputBorder, backgroundColor: active ? Colors.accent.gold + '15' : C.inputBg }]}
                      onPress={() => setSelectedPeriod(p.value)}
                    >
                      <Ionicons name={p.icon} size={13} color={active ? Colors.accent.gold : C.textMuted} />
                      <ThemedText style={[styles.periodPillText, active && { color: Colors.accent.gold, fontWeight: '800' }]}>{p.label}</ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Date nav */}
              <ThemedText style={[styles.label, { marginTop: 14 }]}>DATE</ThemedText>
              <View style={styles.dateRow}>
                <TouchableOpacity style={styles.dateArrow} onPress={() => setSelectedDate((d) => shiftDate(d, -1))}>
                  <Ionicons name="chevron-back" size={16} color={Colors.accent.gold} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateCenter} onPress={() => setDatePickerVisible(true)}>
                  <ThemedText style={[styles.dateText, weekendSelected && { color: '#EF4444' }]} numberOfLines={1}>
                    {formatLongDate(selectedDate)}
                  </ThemedText>
                  {weekendSelected && <ThemedText style={styles.dateWeekendNote}>Weekend — register locked</ThemedText>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateArrow} onPress={() => setSelectedDate((d) => shiftDate(d, 1))}>
                  <Ionicons name="chevron-forward" size={16} color={Colors.accent.gold} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.dateArrow} onPress={() => setDatePickerVisible(true)}>
                  <Ionicons name="calendar-outline" size={16} color={Colors.accent.gold} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.todayButton} onPress={() => setSelectedDate(todayStr())}>
                  <ThemedText style={styles.todayButtonText}>TODAY</ThemedText>
                </TouchableOpacity>
              </View>
            </View>

            {/* Tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segmentedControl} contentContainerStyle={{ flexGrow: 1 }}>
              {([
                { key: 'mark', label: 'Mark', icon: 'checkmark-done-outline' },
                { key: 'week', label: 'Week', icon: 'calendar-outline' },
                { key: 'broadsheet', label: 'Broadsheet', icon: 'grid-outline' },
                { key: 'summary', label: 'Summary', icon: 'stats-chart-outline' },
                { key: 'signoff', label: 'Sign-off', icon: 'ribbon-outline' },
              ] as { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[]).map((t) => (
                <TouchableOpacity key={t.key} style={[styles.segmentButton, activeTab === t.key && styles.activeSegment]} onPress={() => setActiveTab(t.key)}>
                  <Ionicons name={t.icon} size={14} color={activeTab === t.key ? Colors.accent.gold : C.textMuted} style={{ marginRight: 6 }} />
                  <ThemedText style={[styles.segmentText, activeTab === t.key && { color: Colors.accent.gold, fontWeight: '800' }]} numberOfLines={1}>
                    {t.label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* ── MARK TAB ── */}
            {activeTab === 'mark' && (
              <View style={styles.glassCard}>
                <View style={styles.legendRow}>
                  {legend.map((item) => (
                    <View key={item.status} style={styles.legendChip}>
                      <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS[item.status] || Colors.accent.gold }]} />
                      <ThemedText style={styles.legendText}>{item.code} · {item.label}</ThemedText>
                    </View>
                  ))}
                </View>

                <View style={styles.quickActionsRow}>
                  <TouchableOpacity style={styles.quickActionBtn} onPress={markAllPresent}>
                    <Ionicons name="checkmark-done" size={14} color="#22C55E" />
                    <ThemedText style={[styles.quickActionText, { color: '#22C55E' }]}>Mark All Present</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickActionBtn} onPress={markAllAbsent}>
                    <Ionicons name="close-circle" size={14} color={STATUS_COLORS.absent} />
                    <ThemedText style={[styles.quickActionText, { color: STATUS_COLORS.absent }]}>Mark All Absent</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickActionBtn} onPress={clearAllMarks}>
                    <Ionicons name="refresh" size={14} color={C.textMuted} />
                    <ThemedText style={styles.quickActionText}>Clear</ThemedText>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }} />
                  <ThemedText style={styles.markedCountText}>{markedSoFar}/{dayStudents.length} marked</ThemedText>
                </View>

                {loadingDay ? (
                  <View style={styles.loaderContainer}>
                    <ActivityIndicator color={Colors.accent.gold} />
                  </View>
                ) : dayErrorMessage ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
                    <ThemedText style={styles.emptySubtitle}>{dayErrorMessage}</ThemedText>
                  </View>
                ) : dayStudents.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="people-outline" size={44} color={C.textMuted} />
                    <ThemedText style={styles.emptySubtitle}>No active students enrolled in this class/session yet.</ThemedText>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {dayStudents.map((s, index) => {
                      // Serial numbers reset per gender group (Boys 1,2,3...
                      // then Girls 1,2,3... — the paper-register convention
                      // this list already follows), so show a small group
                      // label whenever the gender changes, otherwise "1. Taiwo"
                      // followed later by an unrelated "1. Daudu" reads as a
                      // mistake rather than the start of the girls' list.
                      const genderKey = (s.gender || '').toLowerCase();
                      const groupLabel = genderKey === 'male' ? 'BOYS' : genderKey === 'female' ? 'GIRLS' : null;
                      const showGroupHeader = groupLabel && (index === 0 || (dayStudents[index - 1].gender || '').toLowerCase() !== genderKey);
                      return (
                        <Fragment key={s.enrollmentId}>
                          {showGroupHeader && (
                            <ThemedText style={styles.genderGroupHeader}>{groupLabel}</ThemedText>
                          )}
                          <View style={styles.studentRow}>
                            <View style={styles.avatarMini}>
                              <ThemedText style={styles.avatarText}>{initials(s.firstName, s.lastName)}</ThemedText>
                            </View>
                            <View style={{ flex: 1, minWidth: 90 }}>
                              <ThemedText style={styles.studentNameText} numberOfLines={1}>
                                {s.serial ? `${s.serial}. ` : ''}{s.firstName} {s.lastName}
                              </ThemedText>
                              <ThemedText style={styles.studentIdText}>{s.registrationNumber}</ThemedText>
                            </View>
                            <View style={styles.statusButtonsRow}>
                              {legend.map((item) => {
                                const active = s.status === item.status;
                                const color = STATUS_COLORS[item.status] || Colors.accent.gold;
                                return (
                                  <TouchableOpacity
                                    key={item.status}
                                    style={[styles.statusButton, { borderColor: active ? color : C.inputBorder, backgroundColor: active ? color : 'transparent' }]}
                                    onPress={() => setLocalStatus(s.enrollmentId, item.status)}
                                  >
                                    <Text style={[styles.statusButtonText, { color: active ? '#FFFFFF' : C.textMuted }]}>{item.code}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        </Fragment>
                      );
                    })}
                  </View>
                )}

                {dayStudents.length > 0 && (
                  <CustomButton
                    title={saving ? 'Saving...' : `Save Register (${markedSoFar})`}
                    onPress={handleSaveDay}
                    disabled={saving || markedSoFar === 0 || weekendSelected}
                    loading={saving}
                    variant="premium"
                    style={{ marginTop: 18 }}
                  />
                )}
              </View>
            )}

            {/* ── WEEK TAB ── */}
            {activeTab === 'week' && (
              <View style={styles.glassCard}>
                {loadingWeek ? (
                  <View style={styles.loaderContainer}>
                    <ActivityIndicator color={Colors.accent.gold} />
                  </View>
                ) : weekErrorMessage ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
                    <ThemedText style={styles.emptySubtitle}>{weekErrorMessage}</ThemedText>
                  </View>
                ) : !weekData || weekData.students.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="calendar-outline" size={44} color={C.textMuted} />
                    <ThemedText style={styles.emptySubtitle}>No roster to display for this week.</ThemedText>
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={styles.weekHeaderRow}>
                        <ThemedText style={[styles.weekHeaderCell, { width: 160 }]}>Student</ThemedText>
                        {Object.keys(weekData.students[0]?.days || {}).map((date) => (
                          <ThemedText key={date} style={[styles.weekHeaderCell, { width: 64 }]}>{formatShortDate(date)}</ThemedText>
                        ))}
                      </View>
                      {weekData.students.map((row) => (
                        <View key={row.enrollmentId} style={styles.weekBodyRow}>
                          <View style={{ width: 160, paddingHorizontal: 8 }}>
                            <ThemedText style={styles.weekStudentName} numberOfLines={1}>
                              {row.serial ? `${row.serial}. ` : ''}{row.firstName} {row.lastName}
                            </ThemedText>
                          </View>
                          {Object.entries(row.days).map(([date, status]) => (
                            <View key={date} style={{ width: 64, alignItems: 'center' }}>
                              {status ? (
                                <View style={[styles.weekStatusBadge, { backgroundColor: (STATUS_COLORS[status] || Colors.accent.gold) + '25', borderColor: STATUS_COLORS[status] || Colors.accent.gold }]}>
                                  <Text style={{ color: STATUS_COLORS[status] || Colors.accent.gold, fontSize: 10, fontWeight: '900' }}>
                                    {legend.find((l) => l.status === status)?.code || status[0].toUpperCase()}
                                  </Text>
                                </View>
                              ) : (
                                <Text style={{ color: C.textMuted, fontSize: 12 }}>—</Text>
                              )}
                            </View>
                          ))}
                        </View>
                      ))}
                      <View style={[styles.weekBodyRow, { borderTopWidth: 1, borderTopColor: C.divider, marginTop: 4 }]}>
                        <View style={{ width: 160, paddingHorizontal: 8 }}>
                          <ThemedText style={[styles.weekStudentName, { fontWeight: '900' }]}>Total Present</ThemedText>
                        </View>
                        {weekData.dailyTotals.map((t) => (
                          <View key={t.date} style={{ width: 64, alignItems: 'center' }}>
                            <ThemedText style={{ fontWeight: '800', color: Colors.accent.gold, fontSize: 12 }}>{t.totalPresent}</ThemedText>
                          </View>
                        ))}
                      </View>
                    </View>
                  </ScrollView>
                )}
              </View>
            )}

            {/* ── BROADSHEET TAB ── */}
            {activeTab === 'broadsheet' && (
              <View style={styles.glassCard}>
                <View style={styles.quickActionsRow}>
                  <ThemedText style={styles.markedCountText}>
                    {broadsheetData ? `${broadsheetData.dates.length} recorded day(s) · ${selectedTerm} Term` : `${selectedTerm} Term`}
                  </ThemedText>
                  <View style={{ flex: 1 }} />
                  {broadsheetData && broadsheetData.dates.length > 0 && (
                    <TouchableOpacity
                      style={styles.quickActionBtn}
                      onPress={handleDownloadBroadsheetPdf}
                      disabled={downloadingBroadsheetPdf}
                    >
                      {downloadingBroadsheetPdf ? (
                        <ActivityIndicator size="small" color={Colors.accent.gold} />
                      ) : (
                        <>
                          <Ionicons name="download-outline" size={14} color={Colors.accent.gold} />
                          <ThemedText style={[styles.quickActionText, { color: Colors.accent.gold }]}>Download PDF</ThemedText>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.quickActionBtn} onPress={() => setDatePickerVisible(true)}>
                    <Ionicons name="calendar-outline" size={14} color={Colors.accent.gold} />
                    <ThemedText style={[styles.quickActionText, { color: Colors.accent.gold }]}>Jump to Date</ThemedText>
                  </TouchableOpacity>
                </View>

                {loadingBroadsheet ? (
                  <View style={styles.loaderContainer}>
                    <ActivityIndicator color={Colors.accent.gold} />
                  </View>
                ) : broadsheetErrorMessage ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
                    <ThemedText style={styles.emptySubtitle}>{broadsheetErrorMessage}</ThemedText>
                  </View>
                ) : !broadsheetData || broadsheetData.dates.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="grid-outline" size={44} color={C.textMuted} />
                    <ThemedText style={styles.emptySubtitle}>
                      No saved attendance records yet for {selectedTerm} Term. Mark a few days first — they'll show up here.
                    </ThemedText>
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={styles.weekHeaderRow}>
                        <ThemedText style={[styles.weekHeaderCell, { width: 160 }]}>Student</ThemedText>
                        {broadsheetData.dates.map((date) => (
                          <TouchableOpacity
                            key={date}
                            onPress={() => {
                              setSelectedDate(date);
                              setActiveTab('mark');
                            }}
                          >
                            <ThemedText style={[styles.weekHeaderCell, { width: 60 }]}>{formatShortDate(date)}</ThemedText>
                          </TouchableOpacity>
                        ))}
                        <ThemedText style={[styles.weekHeaderCell, { width: 50, textAlign: 'center' }]}>%</ThemedText>
                      </View>
                      {broadsheetData.students.map((row) => (
                        <View key={row.enrollmentId} style={styles.weekBodyRow}>
                          <View style={{ width: 160, paddingHorizontal: 8 }}>
                            <ThemedText style={styles.weekStudentName} numberOfLines={1}>
                              {row.serial ? `${row.serial}. ` : ''}{row.firstName} {row.lastName}
                            </ThemedText>
                          </View>
                          {broadsheetData.dates.map((date) => {
                            const status = row.days[date];
                            return (
                              <View key={date} style={{ width: 60, alignItems: 'center' }}>
                                {status ? (
                                  <View style={[styles.weekStatusBadge, { backgroundColor: (STATUS_COLORS[status] || Colors.accent.gold) + '25', borderColor: STATUS_COLORS[status] || Colors.accent.gold }]}>
                                    <Text style={{ color: STATUS_COLORS[status] || Colors.accent.gold, fontSize: 10, fontWeight: '900' }}>
                                      {legend.find((l) => l.status === status)?.code || status[0].toUpperCase()}
                                    </Text>
                                  </View>
                                ) : (
                                  <Text style={{ color: C.textMuted, fontSize: 12 }}>—</Text>
                                )}
                              </View>
                            );
                          })}
                          <View style={{ width: 50, alignItems: 'center' }}>
                            <ThemedText style={{ fontWeight: '800', color: Colors.accent.gold, fontSize: 11 }}>
                              {row.percentageAttendance ?? '—'}{row.percentageAttendance !== null ? '%' : ''}
                            </ThemedText>
                          </View>
                        </View>
                      ))}
                      <View style={[styles.weekBodyRow, { borderTopWidth: 1, borderTopColor: C.divider, marginTop: 4 }]}>
                        <View style={{ width: 160, paddingHorizontal: 8 }}>
                          <ThemedText style={[styles.weekStudentName, { fontWeight: '900' }]}>Total Present</ThemedText>
                        </View>
                        {broadsheetData.dailyTotals.map((t) => (
                          <View key={t.date} style={{ width: 60, alignItems: 'center' }}>
                            <ThemedText style={{ fontWeight: '800', color: Colors.accent.gold, fontSize: 12 }}>{t.totalPresent}</ThemedText>
                          </View>
                        ))}
                        <View style={{ width: 50 }} />
                      </View>
                    </View>
                  </ScrollView>
                )}
              </View>
            )}

            {/* ── SUMMARY TAB ── */}
            {activeTab === 'summary' && (
              <View style={styles.glassCard}>
                {loadingSummary ? (
                  <View style={styles.loaderContainer}>
                    <ActivityIndicator color={Colors.accent.gold} />
                  </View>
                ) : summaryErrorMessage ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
                    <ThemedText style={styles.emptySubtitle}>{summaryErrorMessage}</ThemedText>
                  </View>
                ) : !summaryData || summaryData.students.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="stats-chart-outline" size={44} color={C.textMuted} />
                    <ThemedText style={styles.emptySubtitle}>No attendance recorded for this term yet.</ThemedText>
                  </View>
                ) : (
                  <View style={{ gap: 12 }}>
                    <ThemedText style={styles.summaryMeta}>
                      School opened {summaryData.sessionsHeld} time(s) this term · promotion threshold {summaryData.minPercentage}%
                    </ThemedText>
                    {summaryData.students.map((s) => {
                      const meets = s.meetsPromotionRequirement;
                      const pctColor = meets === null ? C.textMuted : meets ? '#22C55E' : '#EF4444';
                      return (
                        <View key={s.enrollmentId} style={styles.summaryCard}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <View style={{ flex: 1 }}>
                              <ThemedText style={styles.studentNameText} numberOfLines={1}>
                                {s.serial ? `${s.serial}. ` : ''}{s.firstName} {s.lastName}
                              </ThemedText>
                              <ThemedText style={styles.studentIdText}>{s.registrationNumber}</ThemedText>
                            </View>
                            <View style={[styles.pctBadge, { backgroundColor: pctColor + '18', borderColor: pctColor }]}>
                              <Text style={{ color: pctColor, fontWeight: '900', fontSize: 13 }}>{s.percentageAttendance ?? '—'}%</Text>
                            </View>
                          </View>
                          <View style={styles.summaryStatsRow}>
                            <SummaryStat label="Present" value={s.timesPresent} color="#22C55E" />
                            <SummaryStat label="Absent" value={s.timesAbsent} color="#EF4444" />
                            <SummaryStat label="Late" value={s.timesLate} color="#F59E0B" />
                            <SummaryStat label="Sick" value={s.timesSick} color="#8B5CF6" />
                            <SummaryStat label="Excused" value={s.timesExcused} color="#64748B" />
                          </View>
                          <View style={styles.remarkRow}>
                            <TextInput
                              style={styles.remarkInput}
                              placeholder="Terminal remark (e.g. exemplary punctuality)"
                              placeholderTextColor={C.textMuted}
                              value={remarkDrafts[s.enrollmentId] ?? ''}
                              onChangeText={(val) => setRemarkDrafts((prev) => ({ ...prev, [s.enrollmentId]: val }))}
                              multiline
                            />
                            <TouchableOpacity
                              style={styles.remarkSaveBtn}
                              onPress={() => handleSaveRemark(s.enrollmentId)}
                              disabled={savingRemarkId === s.enrollmentId}
                            >
                              {savingRemarkId === s.enrollmentId ? (
                                <ActivityIndicator size="small" color={Colors.accent.navy} />
                              ) : (
                                <Ionicons name="checkmark" size={16} color={Colors.accent.navy} />
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {/* ── SIGN-OFF TAB ── */}
            {activeTab === 'signoff' && (
              <View style={styles.glassCard}>
                <ThemedText style={[styles.label, { marginBottom: 8 }]}>WEEK NUMBER</ThemedText>
                <View style={styles.dateRow}>
                  <TouchableOpacity
                    style={styles.dateArrow}
                    onPress={() => setSelectedWeekNumber((n) => Math.max(1, n - 1))}
                  >
                    <Ionicons name="chevron-back" size={16} color={Colors.accent.gold} />
                  </TouchableOpacity>
                  <View style={styles.dateCenter}>
                    <ThemedText style={styles.dateText}>Week {selectedWeekNumber} · {selectedTerm} Term</ThemedText>
                  </View>
                  <TouchableOpacity
                    style={styles.dateArrow}
                    onPress={() => setSelectedWeekNumber((n) => Math.min(13, n + 1))}
                  >
                    <Ionicons name="chevron-forward" size={16} color={Colors.accent.gold} />
                  </TouchableOpacity>
                </View>

                <ThemedText style={styles.signoffHint}>
                  Each party signs off separately once the week's register is complete — teacher first, then the principal and an inspector, if applicable.
                </ThemedText>

                {loadingSignoff ? (
                  <View style={styles.loaderContainer}>
                    <ActivityIndicator color={Colors.accent.gold} />
                  </View>
                ) : signoffErrorMessage ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="alert-circle-outline" size={44} color="#EF4444" />
                    <ThemedText style={styles.emptySubtitle}>{signoffErrorMessage}</ThemedText>
                  </View>
                ) : (
                  <View style={{ gap: 12, marginTop: 6 }}>
                    {/* Teacher block */}
                    <View style={styles.signoffBlock}>
                      <View style={styles.signoffBlockHeader}>
                        <Ionicons name="person-outline" size={16} color={Colors.accent.gold} />
                        <ThemedText style={styles.signoffBlockTitle}>Class Teacher</ThemedText>
                        {!!signoffData?.teacher_signed_at && <Ionicons name="checkmark-circle" size={16} color="#22C55E" style={{ marginLeft: 'auto' }} />}
                      </View>
                      {signoffData?.teacher_signed_at ? (
                        <ThemedText style={styles.signoffSignedText}>
                          Signed{signoffData.teacher_signed_by_type ? ` by ${signoffData.teacher_signed_by_type}` : ''} on {formatDateTime(signoffData.teacher_signed_at)}
                        </ThemedText>
                      ) : (
                        <>
                          <ThemedText style={styles.signoffPendingText}>Not yet signed for this week.</ThemedText>
                          <CustomButton
                            title={savingSignoffRole === 'teacher' ? 'Signing...' : 'Sign as Class Teacher'}
                            onPress={() => handleSignoff('teacher')}
                            disabled={savingSignoffRole === 'teacher'}
                            loading={savingSignoffRole === 'teacher'}
                            variant="premium"
                            style={{ marginTop: 10 }}
                          />
                        </>
                      )}
                    </View>

                    {/* Principal block */}
                    <View style={styles.signoffBlock}>
                      <View style={styles.signoffBlockHeader}>
                        <Ionicons name="ribbon-outline" size={16} color={Colors.accent.gold} />
                        <ThemedText style={styles.signoffBlockTitle}>Principal</ThemedText>
                        {!!signoffData?.principal_signed_at && <Ionicons name="checkmark-circle" size={16} color="#22C55E" style={{ marginLeft: 'auto' }} />}
                      </View>
                      {signoffData?.principal_signed_at ? (
                        <ThemedText style={styles.signoffSignedText}>
                          Signed by {signoffData.principal_name} on {formatDateTime(signoffData.principal_signed_at)}
                        </ThemedText>
                      ) : classScope ? (
                        <ThemedText style={styles.signoffLockedText}>Only the school owner or an administrator can record this sign-off.</ThemedText>
                      ) : (
                        <>
                          <ThemedText style={styles.signoffPendingText}>Not yet signed for this week.</ThemedText>
                          <View style={styles.remarkRow}>
                            <TextInput
                              style={styles.remarkInput}
                              placeholder="Principal's name"
                              placeholderTextColor={C.textMuted}
                              value={principalName}
                              onChangeText={setPrincipalName}
                            />
                            <TouchableOpacity
                              style={styles.remarkSaveBtn}
                              onPress={() => handleSignoff('principal')}
                              disabled={savingSignoffRole === 'principal'}
                            >
                              {savingSignoffRole === 'principal' ? (
                                <ActivityIndicator size="small" color={Colors.accent.navy} />
                              ) : (
                                <Ionicons name="checkmark" size={16} color={Colors.accent.navy} />
                              )}
                            </TouchableOpacity>
                          </View>
                        </>
                      )}
                    </View>

                    {/* Inspector block */}
                    <View style={styles.signoffBlock}>
                      <View style={styles.signoffBlockHeader}>
                        <Ionicons name="shield-checkmark-outline" size={16} color={Colors.accent.gold} />
                        <ThemedText style={styles.signoffBlockTitle}>Inspector</ThemedText>
                        {!!signoffData?.inspector_signed_at && <Ionicons name="checkmark-circle" size={16} color="#22C55E" style={{ marginLeft: 'auto' }} />}
                      </View>
                      {signoffData?.inspector_signed_at ? (
                        <>
                          <ThemedText style={styles.signoffSignedText}>
                            Signed by {signoffData.inspector_name} on {formatDateTime(signoffData.inspector_signed_at)}
                          </ThemedText>
                          {!!signoffData.inspector_notes && <ThemedText style={styles.signoffNotesText}>"{signoffData.inspector_notes}"</ThemedText>}
                        </>
                      ) : classScope ? (
                        <ThemedText style={styles.signoffLockedText}>Only the school owner or an administrator can record this sign-off.</ThemedText>
                      ) : (
                        <>
                          <ThemedText style={styles.signoffPendingText}>Not yet signed for this week (optional).</ThemedText>
                          <TextInput
                            style={[styles.remarkInput, { marginTop: 8 }]}
                            placeholder="Inspector's name"
                            placeholderTextColor={C.textMuted}
                            value={inspectorName}
                            onChangeText={setInspectorName}
                          />
                          <View style={styles.remarkRow}>
                            <TextInput
                              style={styles.remarkInput}
                              placeholder="Notes (optional)"
                              placeholderTextColor={C.textMuted}
                              value={inspectorNotes}
                              onChangeText={setInspectorNotes}
                              multiline
                            />
                            <TouchableOpacity
                              style={styles.remarkSaveBtn}
                              onPress={() => handleSignoff('inspector')}
                              disabled={savingSignoffRole === 'inspector'}
                            >
                              {savingSignoffRole === 'inspector' ? (
                                <ActivityIndicator size="small" color={Colors.accent.navy} />
                              ) : (
                                <Ionicons name="checkmark" size={16} color={Colors.accent.navy} />
                              )}
                            </TouchableOpacity>
                          </View>
                        </>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {renderPickerModal()}

        <AttendanceDatePicker
          visible={datePickerVisible}
          onClose={() => setDatePickerVisible(false)}
          selectedDate={selectedDate}
          onSelect={(date) => setSelectedDate(date)}
          markedDates={recordedDates}
          title={`Select Date · ${selectedClass?.class_name || ''}`}
        />

        {statusAlert.visible && (
          <CustomAlert
            type={statusAlert.type}
            title={statusAlert.title}
            message={statusAlert.message}
            onClose={() => setStatusAlert((prev) => ({ ...prev, visible: false }))}
            style={styles.alert}
          />
        )}
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 46 }}>
      <Text style={{ color, fontSize: 14, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: color, opacity: 0.7, fontSize: 8, fontWeight: '800', marginTop: 2 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;

  return StyleSheet.create({
    mainWrapper: { flex: 1, backgroundColor: C.background },
    hero: { height: isTiny ? 150 : 200, width: '100%' },
    heroOverlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24, paddingTop: isTiny ? 40 : 50 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: isTiny ? 10 : 16 },
    backButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: C.text, fontSize: isTiny ? 11 : 12, fontWeight: '800', letterSpacing: 0.5 },
    heroContent: { marginTop: 'auto', marginBottom: 16 },
    heroSubtitle: { color: Colors.accent.gold, fontSize: isTiny ? 8 : 9, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
    heroTitle: { color: C.text, fontSize: isTiny ? 20 : 25, fontWeight: '900', letterSpacing: -0.5 },

    contentWrapper: { paddingHorizontal: isTiny ? 12 : 20, marginTop: 0, paddingBottom: 100 },

    scopeBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.accent.gold + '12', borderWidth: 1, borderColor: Colors.accent.gold + '30', borderRadius: 12, padding: 10, marginBottom: 14 },
    scopeBannerText: { color: Colors.accent.gold, fontSize: 10, fontWeight: '700', flex: 1 },

    glassCard: { backgroundColor: C.card, borderRadius: isTiny ? 20 : 26, padding: isTiny ? 14 : 18, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 16 },
    label: { color: C.textLabel, fontSize: isTiny ? 7 : 8, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },

    filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    gridItem: { minWidth: isTiny ? '45%' : 90, flex: 1, gap: 4 },
    miniPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 8, paddingHorizontal: 8, height: 36, borderWidth: 1, borderColor: C.inputBorder },
    miniPickerText: { color: C.inputText, fontSize: isTiny ? 9 : 10, fontWeight: '700' },
    placeholderText: { color: C.textMuted, fontSize: isTiny ? 9 : 10, fontWeight: '600' },

    periodRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
    periodPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 36, borderRadius: 10, borderWidth: 1 },
    periodPillText: { fontSize: isTiny ? 9 : 10, fontWeight: '700', color: C.textSecondary },

    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dateArrow: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder, justifyContent: 'center', alignItems: 'center' },
    dateCenter: { flex: 1, alignItems: 'center' },
    dateText: { color: C.text, fontSize: isTiny ? 11 : 12, fontWeight: '800' },
    dateWeekendNote: { color: '#EF4444', fontSize: 8, fontWeight: '700', marginTop: 2 },
    todayButton: { paddingHorizontal: 10, height: 32, borderRadius: 8, backgroundColor: Colors.accent.gold + '15', borderWidth: 1, borderColor: Colors.accent.gold + '40', justifyContent: 'center' },
    todayButtonText: { color: Colors.accent.gold, fontSize: 9, fontWeight: '800' },

    segmentedControl: { flexDirection: 'row', backgroundColor: C.inputBg, borderRadius: 16, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: C.inputBorder },
    segmentButton: { minWidth: 84, paddingHorizontal: 14, height: 38, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    activeSegment: { backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
    segmentText: { fontSize: isTiny ? 10 : 12, fontWeight: '600', color: C.textMuted },

    legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
    legendChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.inputBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: C.inputBorder },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { color: C.textSecondary, fontSize: 9, fontWeight: '700' },

    quickActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
    quickActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder },
    quickActionText: { fontSize: 9, fontWeight: '800', color: C.textSecondary },
    markedCountText: { fontSize: 9, fontWeight: '800', color: C.textMuted },

    loaderContainer: { padding: 30, alignItems: 'center' },
    emptyState: { padding: 30, alignItems: 'center', gap: 8 },
    emptySubtitle: { color: C.textSecondary, fontSize: 11, textAlign: 'center', lineHeight: 17 },

    studentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.inputBg, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: C.inputBorder },
    genderGroupHeader: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: Colors.accent.gold, marginTop: 4, marginBottom: -2 },
    avatarMini: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.accent.gold },
    avatarText: { color: Colors.accent.gold, fontSize: 10, fontWeight: '800' },
    studentNameText: { color: C.text, fontSize: isTiny ? 11 : 12, fontWeight: '800' },
    studentIdText: { color: C.textSecondary, fontSize: isTiny ? 8 : 9, fontWeight: '600', marginTop: 1 },
    statusButtonsRow: { flexDirection: 'row', gap: 4 },
    statusButton: { width: 26, height: 26, borderRadius: 7, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
    statusButtonText: { fontSize: 11, fontWeight: '900' },

    weekHeaderRow: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.divider, marginBottom: 6 },
    weekHeaderCell: { color: C.textLabel, fontSize: 9, fontWeight: '800', paddingHorizontal: 8, letterSpacing: 0.5 },
    weekBodyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    weekStudentName: { color: C.text, fontSize: 11, fontWeight: '700' },
    weekStatusBadge: { width: 26, height: 26, borderRadius: 7, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },

    summaryMeta: { color: C.textSecondary, fontSize: 10, fontWeight: '600' },
    summaryCard: { backgroundColor: C.inputBg, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.inputBorder },
    pctBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
    summaryStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.divider },
    remarkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 },
    remarkInput: { flex: 1, minHeight: 36, maxHeight: 80, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.inputBorder, paddingHorizontal: 10, paddingVertical: 8, color: C.inputText, fontSize: 11 },
    remarkSaveBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center' },

    signoffHint: { color: C.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 12, marginBottom: 4 },
    signoffBlock: { backgroundColor: C.inputBg, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.inputBorder },
    signoffBlockHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    signoffBlockTitle: { color: C.text, fontSize: 12, fontWeight: '800' },
    signoffSignedText: { color: '#22C55E', fontSize: 10, fontWeight: '700', lineHeight: 15 },
    signoffPendingText: { color: C.textMuted, fontSize: 10, fontWeight: '600' },
    signoffLockedText: { color: C.textMuted, fontSize: 10, fontWeight: '600', fontStyle: 'italic' },
    signoffNotesText: { color: C.textSecondary, fontSize: 10, fontStyle: 'italic', marginTop: 4 },

    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' },
    bottomSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: isTiny ? 16 : 24, borderTopWidth: 1, maxHeight: '75%' },
    sheetHandle: { width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: C.text, fontSize: 18, fontWeight: '900', marginBottom: 16, textAlign: 'center' },
    dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 4 },
    selectedItem: { backgroundColor: Colors.accent.gold + '10' },
    dropdownItemText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
    selectedItemText: { color: Colors.accent.gold, fontWeight: '800' },
    radioDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },

    alert: { position: 'absolute', top: 50, left: 16, right: 16, zIndex: 9999 },
  });
}
