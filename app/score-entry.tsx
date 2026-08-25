import {
  View,
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
  useWindowDimensions
} from 'react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '@/utils/api-service';
import { isSchoolOwner } from '@/utils/jwt-decoder';
import { Colors } from '@/constants/design-system';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { useRouter } from 'expo-router';
import { useAppColors } from '@/hooks/use-app-colors';

interface Subject {
  id: number;
  name: string;
  category: string;
  education_level: string;
}

interface Class {
  id: number;
  class_name: string;
  capacity: number;
}

interface SubjectScore {
  score_id: number | null;
  ca1: string | number;
  ca2: string | number;
  ca3: string | number;
  ca4: string | number;
  exam: string | number;
}

interface StudentMatrixRow {
  enrollment_id: number;
  student_id: string | number;
  first_name: string;
  last_name: string;
  registration_number: string;
  scores: { [subjectId: number]: SubjectScore };
}

export default function ScoreEntryScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  
  // Authentication & Token
  const [token, setToken] = useState<string>('');
  // Owner-vs-admin gating (Staff Onboarding): only the school owner can
  // delete a score. Defaults to true so it never hides delete access
  // before the token has loaded, or for a lone owner account.
  const [isOwner, setIsOwner] = useState(true);
  const [countryId, setCountryId] = useState<number | null>(null);
  const [schoolId, setSchoolId] = useState<number | null>(null);

  // Data
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [academicSessions, setAcademicSessions] = useState<{ id: number; session_name: string }[]>([]);
  const [matrixData, setMatrixData] = useState<StudentMatrixRow[]>([]);

  // Selection State
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedTerm, setSelectedTerm] = useState<string>('First');
  const [selectedTermId, setSelectedTermId] = useState<number>(1);
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [subjectSearchQuery, setSubjectSearchQuery] = useState('');
  const [searchingSubjects, setSearchingSubjects] = useState(false);
  const [activeModal, setActiveModal] = useState<'session' | 'term' | 'class' | 'subject' | 'subjects-sheet' | null>(null);
  const [selectedSheetSubjects, setSelectedSheetSubjects] = useState<Subject[]>([]);
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

  // Loading & Errors
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [savingScores, setSavingScores] = useState(false);
  const [initialError, setInitialError] = useState('');
  const [sheetErrorMessage, setSheetErrorMessage] = useState<string | null>(null);
  const [scoreErrors, setScoreErrors] = useState<{ [key: string]: string }>({});

  const terms = ['First', 'Second', 'Third'];

  useEffect(() => {
    const timer = setTimeout(() => {
      if (subjectSearchQuery.trim()) {
        searchSubjects(subjectSearchQuery);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [subjectSearchQuery]);

  useEffect(() => {
    const termIndex = terms.indexOf(selectedTerm);
    setSelectedTermId(termIndex + 1);
  }, [selectedTerm]);

  useEffect(() => {
    initializeScreen();
  }, []);

  useEffect(() => {
    if (selectedClass && selectedSessionId && selectedTermId && selectedSheetSubjects.length > 0) {
      loadScoringMatrix(selectedClass.id);
    } else if (!selectedSheetSubjects.length) {
      setMatrixData([]);
    }
  }, [selectedClass, selectedSessionId, selectedTermId, selectedSheetSubjects.length]);

  const initializeScreen = async () => {
    try {
      setLoadingInitial(true);
      setInitialError('');

      let tokenValue = '';
      let countryIdValue: number | null = null;
      let schoolIdValue: number | null = null;
      let userData: any = null;

      if (Platform.OS !== 'web') {
        try {
          const userDataString = await SecureStore.getItemAsync('userData');
          if (userDataString) {
            userData = JSON.parse(userDataString);
          }
        } catch (secureStoreError) {
          const userDataString = localStorage.getItem('userData');
          if (userDataString) {
            userData = JSON.parse(userDataString);
          }
        }
      } else {
        const userDataString = localStorage.getItem('userData');
        if (userDataString) {
          userData = JSON.parse(userDataString);
        }
      }

      if (userData) {
        if (Platform.OS !== 'web') {
          try {
            tokenValue = (await SecureStore.getItemAsync('userToken')) || '';
          } catch (e) {
            tokenValue = localStorage.getItem('userToken') || '';
          }
        } else {
          tokenValue = localStorage.getItem('userToken') || '';
        }

        if (userData.countryId) {
          countryIdValue = parseInt(userData.countryId);
        } else if (userData.user?.countryId) {
          countryIdValue = parseInt(userData.user.countryId);
        }

        if (userData.schoolId) {
          schoolIdValue = userData.schoolId;
        } else if (userData.user?.schoolId) {
          schoolIdValue = userData.user.schoolId;
        }
      }

      if (!tokenValue) {
        setInitialError('Authentication failed: No token found. Please login again.');
        return;
      }

      setToken(tokenValue);
      setIsOwner(isSchoolOwner(tokenValue));
      setCountryId(countryIdValue);
      setSchoolId(schoolIdValue);

      if (tokenValue) {
        await Promise.all([
          fetchClasses(tokenValue),
          fetchSubjects(tokenValue),
          fetchAcademicSessions(tokenValue),
        ]);
      }

    } catch (err) {
      setInitialError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoadingInitial(false);
    }
  };

  const fetchClasses = async (tokenValue: string) => {
    try {
      // IMPORTANT: /api/classes returns GLOBAL curriculum templates
      // (global_class_templates ids) — those ids are NOT what
      // enrollments.class_id references, so using them here silently
      // pulled the wrong (or zero) students into the scoring sheet.
      // /api/classes/school returns THIS school's real, instantiated
      // classes table rows, whose ids are the ones every write/read
      // endpoint (including /api/scores/sheet) actually filters on.
      const response = await fetch(`${API_BASE_URL}/api/classes/school`, {
        headers: { 'Authorization': `Bearer ${tokenValue}`, 'Content-Type': 'application/json' },
      });
      if (response.status === 402) { router.replace('/pricing'); return; }
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        setClasses(data.data);
      }
    } catch (err) {
    }
  };

  const fetchSubjects = async (tokenValue: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/classes/subjects`, {
        headers: { 'Authorization': `Bearer ${tokenValue}`, 'Content-Type': 'application/json' },
      });
      if (response.status === 402) { router.replace('/pricing'); return; }
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        setSubjects(data.data);
      }
    } catch (err) {
    }
  };

  const searchSubjects = async (keyword: string) => {
    if (!keyword.trim()) {
      setSubjects([]);
      return;
    }
    try {
      setSearchingSubjects(true);
      const response = await fetch(`${API_BASE_URL}/api/subjects/search?keyword=${encodeURIComponent(keyword)}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (response.status === 402) { router.replace('/pricing'); return; }
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        setSubjects(data.data);
      }
    } catch (err) {
    } finally {
      setSearchingSubjects(false);
    }
  };

  const fetchAcademicSessions = async (tokenValue: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/academic-sessions`, {
        headers: { 'Authorization': `Bearer ${tokenValue}`, 'Content-Type': 'application/json' },
      });
      if (response.status === 402) { router.replace('/pricing'); return; }
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        const sessions = data.data.map((s: any) => ({
          id: s.id,
          session_name: s.session_name || s.name
        }));
        setAcademicSessions(sessions);
        if (sessions.length > 0) {
          setSelectedSession(sessions[0].session_name);
          setSelectedSessionId(sessions[0].id);
        }
      }
    } catch (err) {
    }
  };

  const loadScoringMatrix = async (classId: number) => {
    if (!token || !selectedSessionId || !selectedTermId || selectedSheetSubjects.length === 0) return;
    try {
      setLoadingSheet(true);
      setSheetErrorMessage(null);
      const promises = selectedSheetSubjects.map(sub => 
        fetch(
          `${API_BASE_URL}/api/scores/sheet?classId=${classId}&subjectId=${sub.id}&sessionId=${selectedSessionId}&termId=${selectedTermId}`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
        ).then(async r => {
          const json = await r.json();
          if (!r.ok || !json.success) {
            throw new Error(json.message || json.error || 'Failed to load sheet');
          }
          return json;
        })
      );

      const results = await Promise.all(promises);
      const matrixMap: Record<number, StudentMatrixRow> = {};
      
      results.forEach((data, index) => {
        const subjectId = selectedSheetSubjects[index].id;
        if (data.success && data.data) {
          data.data.forEach((item: any) => {
            if (!matrixMap[item.enrollment_id]) {
              matrixMap[item.enrollment_id] = {
                enrollment_id: item.enrollment_id,
                student_id: item.student_id,
                first_name: item.first_name,
                last_name: item.last_name,
                registration_number: item.registration_number || 'N/A',
                scores: {}
              };
            }
            const parsedScoreId = item.score_id && item.score_id > 0 ? parseInt(item.score_id) : null;
            matrixMap[item.enrollment_id].scores[subjectId] = {
              score_id: parsedScoreId,
              ca1: item.ca1_score !== null ? String(item.ca1_score) : '',
              ca2: item.ca2_score !== null ? String(item.ca2_score) : '',
              ca3: item.ca3_score !== null ? String(item.ca3_score) : '',
              ca4: item.ca4_score !== null ? String(item.ca4_score) : '',
              exam: item.exam_score !== null ? String(item.exam_score) : '',
            };
          });
        }
      });

      const allRows = Object.values(matrixMap);
      allRows.forEach(row => {
        selectedSheetSubjects.forEach(sub => {
          if (!row.scores[sub.id]) {
            row.scores[sub.id] = { score_id: null, ca1: '', ca2: '', ca3: '', ca4: '', exam: '' };
          }
        });
      });

      setMatrixData(allRows);
    } catch (err: any) {
      setSheetErrorMessage(err.message || 'Unable to load scoring matrix.');
      setMatrixData([]);
    } finally {
      setLoadingSheet(false);
    }
  };

  const handleMatrixChange = (
    enrollmentId: number,
    subjectId: number,
    field: string,
    value: string
  ) => {
    const numValue = value === '' ? '' : parseFloat(value);
    const errorKey = `${enrollmentId}-${subjectId}-${field}`;
    let error = '';

    if (numValue !== '') {
      if (field === 'exam') {
        if ((numValue as number) > 60 || (numValue as number) < 0) {
          error = 'Max 60';
        }
      } else {
        if ((numValue as number) > 10 || (numValue as number) < 0) {
          error = 'Max 10';
        }
      }
    }

    const newErrors = { ...scoreErrors };
    if (error) {
      newErrors[errorKey] = error;
    } else {
      delete newErrors[errorKey];
    }
    setScoreErrors(newErrors);

    setMatrixData(prev => prev.map(row => {
      if (row.enrollment_id === enrollmentId) {
        return {
          ...row,
          scores: {
            ...row.scores,
            [subjectId]: {
              ...row.scores[subjectId],
              [field]: numValue
            }
          }
        };
      }
      return row;
    }));
  };

  const calculateTotal = (score: SubjectScore): number => {
    if (!score) return 0;
    const ca1 = typeof score.ca1 === 'string' ? parseFloat(score.ca1) || 0 : score.ca1 || 0;
    const ca2 = typeof score.ca2 === 'string' ? parseFloat(score.ca2) || 0 : score.ca2 || 0;
    const ca3 = typeof score.ca3 === 'string' ? parseFloat(score.ca3) || 0 : score.ca3 || 0;
    const ca4 = typeof score.ca4 === 'string' ? parseFloat(score.ca4) || 0 : score.ca4 || 0;
    const exam = typeof score.exam === 'string' ? parseFloat(score.exam) || 0 : score.exam || 0;
    return (ca1 as number) + (ca2 as number) + (ca3 as number) + (ca4 as number) + (exam as number);
  };

  const validateAllScores = (): boolean => {
    const errors: { [key: string]: string } = {};
    let isValid = true;

    matrixData.forEach(row => {
      selectedSheetSubjects.forEach(sub => {
        const score = row.scores[sub.id];
        if (!score) return;
        ['ca1', 'ca2', 'ca3', 'ca4'].forEach(field => {
          const val = score[field as keyof SubjectScore];
          const numVal = typeof val === 'string' ? parseFloat(val) : (val as number);
          if (!isNaN(numVal) && numVal !== null) {
             if (numVal > 10 || numVal < 0) {
                errors[`${row.enrollment_id}-${sub.id}-${field}`] = 'Max 10';
                isValid = false;
             }
          }
        });
        const examVal = score.exam;
        const numExam = typeof examVal === 'string' ? parseFloat(examVal) : (examVal as number);
        if (!isNaN(numExam) && numExam !== null) {
          if (numExam > 60 || numExam < 0) {
             errors[`${row.enrollment_id}-${sub.id}-exam`] = 'Max 60';
             isValid = false;
          }
        }
      });
    });

    setScoreErrors(errors);
    return isValid;
  };

  const handleSaveAllScores = async () => {
    if (!validateAllScores()) return;
    if (matrixData.length === 0) return;

    try {
      setSavingScores(true);
      const scoresPayload: any[] = [];
      matrixData.forEach(row => {
         selectedSheetSubjects.forEach(sub => {
            const score = row.scores[sub.id];
            if (score && (score.ca1 !== '' || score.ca2 !== '' || score.ca3 !== '' || score.ca4 !== '' || score.exam !== '')) {
               scoresPayload.push({
                 enrollment_id: row.enrollment_id,
                 subject_id: sub.id,
                 term_id: selectedTermId,
                 sessionId: selectedSessionId,
                 ca1_score: score.ca1 === '' ? null : parseFloat(String(score.ca1)),
                 ca2_score: score.ca2 === '' ? null : parseFloat(String(score.ca2)),
                 ca3_score: score.ca3 === '' ? null : parseFloat(String(score.ca3)),
                 ca4_score: score.ca4 === '' ? null : parseFloat(String(score.ca4)),
                 exam_score: score.exam === '' ? null : parseFloat(String(score.exam)),
               });
            }
         });
      });

      if (scoresPayload.length === 0) {
        setStatusAlert({ visible: true, type: 'error', title: 'Missing Data', message: 'Enter at least one score.' });
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/scores/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scores: scoresPayload }),
      });

      if (response.status === 402) { router.replace('/pricing'); return; }

      const data = await response.json();
      if (response.ok && data.success) {
        setStatusAlert({ visible: true, type: 'success', title: 'System Updated', message: `${data.count} score(s) saved.` });
        setTimeout(() => setStatusAlert(prev => ({ ...prev, visible: false })), 3000);
        if (selectedClass) loadScoringMatrix(selectedClass.id);
      } else {
        setStatusAlert({ visible: true, type: 'error', title: 'Update Failed', message: data.message || 'Unable to save scores.' });
      }
    } catch (err) {
    } finally {
      setSavingScores(false);
    }
  };

  const handleDeleteScore = async (scoreId: number) => {
    if (!scoreId || !token) return;
    
    try {
      setSavingScores(true);
      const response = await fetch(`${API_BASE_URL}/api/scores/${scoreId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });

      if (response.status === 402) { router.replace('/pricing'); return; }

      const data = await response.json();
      if (response.ok && data.success) {
        setStatusAlert({ 
          visible: true, 
          type: 'success', 
          title: 'Deleted', 
          message: 'Score record deleted successfully.' 
        });
        if (selectedClass) loadScoringMatrix(selectedClass.id);
      } else {
        setStatusAlert({ 
          visible: true, 
          type: 'error', 
          title: 'Delete Failed', 
          message: data.message || 'Unable to delete score.' 
        });
      }
    } catch (err) {
      setStatusAlert({ 
        visible: true, 
        type: 'error', 
        title: 'Error', 
        message: 'Connection error during deletion.' 
      });
    } finally {
      setSavingScores(false);
    }
  };

  if (loadingInitial) {
    return (
      <View style={[styles.mainWrapper, { backgroundColor: C.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={{ marginTop: 24, fontSize: 9, fontWeight: '800', letterSpacing: 2, color: Colors.accent.gold }}>INITIALIZING PORTAL...</ThemedText>
      </View>
    );
  }

  const renderDropdownModal = () => {
    if (!activeModal) return null;

    if (activeModal === 'subjects-sheet') {
      return (
        <Modal
          visible={activeModal === 'subjects-sheet'}
          transparent
          animationType="slide"
          onRequestClose={() => setActiveModal(null)}
        >
          <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
            <View style={[styles.modalContent, { height: '80%', width: '100%', backgroundColor: C.modalBg, borderColor: C.cardBorder, borderRadius: 32, borderTopLeftRadius: 32, borderTopRightRadius: 32, borderBottomWidth: 1, overflow: 'hidden' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.modalTitle}>Load Score Sheet</ThemedText>
                  <ThemedText style={{ color: C.textSecondary, fontSize: 10 }}>Select subjects to load matrix</ThemedText>
                </View>
                <TouchableOpacity onPress={() => setActiveModal(null)}>
                  <Ionicons name="close-circle" size={28} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={[styles.pickerButton, { marginBottom: 12, height: 44 }]}>
                <Ionicons name="search" size={18} color={C.textMuted} />
                <TextInput
                  style={[styles.pickerText, { flex: 1, marginLeft: 10, fontSize: 13 }]}
                  placeholder="Search subjects..."
                  value={subjectSearchQuery}
                  onChangeText={setSubjectSearchQuery}
                  placeholderTextColor={C.textMuted}
                />
              </View>
              
              <FlatList
                data={subjects}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => {
                  const isSelected = selectedSheetSubjects.some(s => s.id === item.id);
                  return (
                    <TouchableOpacity
                      style={[styles.dropdownItem, isSelected && styles.selectedItem]}
                      onPress={() => {
                        setSelectedSheetSubjects(prev => 
                          prev.some(s => s.id === item.id)
                            ? prev.filter(s => s.id !== item.id)
                            : [...prev, item]
                        );
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                        <ThemedText style={[styles.dropdownItemText, isSelected && styles.selectedItemText, { fontSize: 13 }]}>
                          {item.name}
                        </ThemedText>
                        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: isSelected ? Colors.accent.gold : C.divider, backgroundColor: isSelected ? Colors.accent.gold : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                          {isSelected && <Ionicons name="checkmark" size={14} color={Colors.accent.navy} />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={{ paddingBottom: 20 }}
              />

              <View style={{ paddingTop: 16, borderTopWidth: 1, borderTopColor: C.divider }}>
                <CustomButton 
                  title={`Load ${selectedSheetSubjects.length} Subject${selectedSheetSubjects.length !== 1 ? 's' : ''}`}
                  onPress={() => setActiveModal(null)}
                  disabled={selectedSheetSubjects.length === 0}
                  variant="premium"
                  style={{ paddingVertical: 14 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      );
    }

    let data: any[] = [];
    let title = '';
    let currentSelection: any = null;
    let onSelect = (item: any) => {};

    switch (activeModal) {
      case 'session':
        data = academicSessions;
        title = 'Select Session';
        currentSelection = selectedSessionId;
        onSelect = (item) => {
          setSelectedSession(item.session_name);
          setSelectedSessionId(item.id);
        };
        break;
      case 'term':
        data = terms.map(t => ({ id: t, name: t }));
        title = 'Select Term';
        currentSelection = selectedTerm;
        onSelect = (item) => setSelectedTerm(item.name);
        break;
      case 'class':
        data = classes;
        title = 'Select Class';
        currentSelection = selectedClass?.id;
        onSelect = (item) => setSelectedClass(item);
        break;
      case 'subject':
        data = subjects;
        title = 'Select Subject';
        currentSelection = selectedSubject?.id;
        onSelect = (item) => setSelectedSubject(item);
        break;
    }

    return (
      <Modal
        visible={activeModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveModal(null)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setActiveModal(null)}
        >
          <TouchableWithoutFeedback>
            <View style={[
              styles.bottomSheet, 
              { backgroundColor: C.modalBg, borderColor: C.cardBorder, padding: width < 300 ? 16 : 24 }
            ]}>
              <View style={styles.sheetHandle} />
              <ThemedText style={[styles.modalTitle, { fontSize: 18 }]}>{title}</ThemedText>
              <FlatList
                data={data}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => {
                  const isSelected = (activeModal === 'term' ? item.name === currentSelection : item.id === currentSelection);
                  return (
                    <TouchableOpacity
                      style={[styles.dropdownItem, isSelected && styles.selectedItem]}
                      onPress={() => {
                        onSelect(item);
                        setActiveModal(null);
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                        <ThemedText style={[styles.dropdownItemText, isSelected && styles.selectedItemText, { fontSize: 13 }]}>
                          {item.class_name || item.display_name || item.session_name || item.name}
                        </ThemedText>
                        <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: isSelected ? Colors.accent.gold : C.divider, backgroundColor: isSelected ? Colors.accent.gold : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                          {isSelected && <Ionicons name="checkmark" size={12} color={Colors.accent.navy} />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            </View>
          </TouchableWithoutFeedback>
        </TouchableOpacity>
      </Modal>
    );
  };

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ThemedView style={styles.mainWrapper}>
        <ImageBackground
          source={{ uri: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2070' }}
          style={styles.hero}
        >
          <LinearGradient
            colors={['transparent', C.isDark ? Colors.accent.navy : C.background]}
            style={styles.heroOverlay}
          >
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={20} color={C.isDark ? "#FFFFFF" : Colors.accent.navy} />
              </TouchableOpacity>
              <ThemedText style={styles.headerTitle}>Academic Registry</ThemedText>
              <View style={{ width: 40 }} />
            </View>

            <View style={styles.heroContent}>
              <ThemedText style={styles.heroSubtitle}>DATA ARCHITECTURE</ThemedText>
              <ThemedText style={styles.heroTitle}>Score Entry</ThemedText>
            </View>
          </LinearGradient>
        </ImageBackground>

        <ScrollView stickyHeaderIndices={[1]} showsVerticalScrollIndicator={false}>
          <View style={styles.contentWrapper}>
            <View style={styles.glassCard}>
              <View style={styles.filterGrid}>
                <View style={styles.gridItem}>
                  <ThemedText style={styles.label}>SESSION</ThemedText>
                  <TouchableOpacity style={styles.miniPicker} onPress={() => setActiveModal('session')}>
                    <ThemedText style={styles.miniPickerText} numberOfLines={1}>{selectedSession || 'Select'}</ThemedText>
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
                  <TouchableOpacity style={styles.miniPicker} onPress={() => setActiveModal('class')}>
                    <ThemedText style={selectedClass ? styles.miniPickerText : styles.placeholderText} numberOfLines={1}>
                      {selectedClass ? selectedClass.class_name : 'Choose...'}
                    </ThemedText>
                    <Ionicons name="school-outline" size={12} color={Colors.accent.gold} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ marginBottom: 20 }}>
                <ThemedText style={styles.label}>SUBJECT PAYLOAD CONFIGURATION</ThemedText>
                <TouchableOpacity 
                  style={[styles.payloadButton, { borderColor: selectedSheetSubjects.length > 0 ? Colors.accent.gold : C.inputBorder }]} 
                  onPress={() => setActiveModal('subjects-sheet')}
                >
                  <View style={styles.payloadIconBox}>
                    <Ionicons name="layers" size={18} color={selectedSheetSubjects.length > 0 ? Colors.accent.gold : C.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={selectedSheetSubjects.length > 0 ? styles.pickerText : styles.placeholderText}>
                      {selectedSheetSubjects.length > 0 
                        ? `${selectedSheetSubjects.length} Subjects Loaded` 
                        : 'Tap to load score sheet...'}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              <CustomButton
                title={savingScores ? "Updating Records..." : "Save All Scores"}
                onPress={handleSaveAllScores}
                loading={savingScores}
                variant="premium"
                disabled={matrixData.length === 0}
                style={{ paddingVertical: 16 }}
              />
            </View>

            {loadingSheet ? (
              <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color={Colors.accent.gold} />
                <ThemedText style={styles.loaderText}>SYNCHRONIZING SCORING MATRIX...</ThemedText>
              </View>
            ) : matrixData.length > 0 ? (
              <View style={styles.matrixContainer}>
                <View style={styles.scoringGuide}>
                  <Ionicons name="information-circle-outline" size={14} color={Colors.accent.gold} />
                  <ThemedText style={styles.scoringGuideText}>
                    Scoring Guide: Each CA (Max 10) • Exam (Max 60)
                  </ThemedText>
                </View>
                {matrixData.map((row, idx) => (
                  <View key={row.enrollment_id} style={styles.studentCard}>
                    <View style={styles.studentHeader}>
                      <View style={styles.avatarMini}>
                        <ThemedText style={styles.avatarText}>{(row.first_name?.[0] || '') + (row.last_name?.[0] || '')}</ThemedText>
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={styles.studentNameText}>
                          {row.first_name} {row.last_name}
                        </ThemedText>
                        <ThemedText style={styles.studentIdText}>REG: {row.registration_number}</ThemedText>
                      </View>
                      <View style={styles.totalBadgeMini}>
                        <ThemedText style={styles.totalTextMini}>
                          {selectedSheetSubjects.reduce((acc, sub) => acc + calculateTotal(row.scores[sub.id]), 0)}
                        </ThemedText>
                        <ThemedText style={styles.totalLabelMini}>TOTAL</ThemedText>
                      </View>
                    </View>

                    <View style={styles.subjectsList}>
                      {selectedSheetSubjects.map(sub => {
                        const score = row.scores[sub.id];
                        const total = calculateTotal(score);
                        return (
                          <View key={sub.id} style={styles.subjectBlock}>
                            <View style={styles.subjectTitleRow}>
                              <Ionicons name="book-outline" size={12} color={Colors.accent.gold} />
                              <ThemedText style={styles.subjectNameText}>{sub.name.toUpperCase()}</ThemedText>
                              <View style={styles.totalIndicator}>
                                <ThemedText style={[styles.totalValueText, { color: total > 0 ? Colors.accent.gold : C.textMuted }]}>{total}%</ThemedText>
                              </View>
                              {score?.score_id && isOwner && (
                                <TouchableOpacity 
                                  onPress={() => {
                                    setStatusAlert({
                                      visible: true,
                                      type: 'warning',
                                      title: 'Delete Score?',
                                      message: `Are you sure you want to delete ${sub.name} score for ${row.first_name}?`,
                                      confirmLabel: 'Delete',
                                      onConfirm: () => handleDeleteScore(score.score_id as number)
                                    });
                                  }}
                                  style={{ marginLeft: 8 }}
                                >
                                  <Ionicons name="trash-outline" size={14} color="#EF4444" />
                                </TouchableOpacity>
                              )}
                            </View>

                            <View style={styles.scoreGrid}>
                              {['ca1', 'ca2', 'ca3', 'ca4'].map(ca => {
                                const error = scoreErrors[`${row.enrollment_id}-${sub.id}-${ca}`];
                                return (
                                  <View key={ca} style={styles.scoreInputGroup}>
                                    <ThemedText style={styles.scoreLabel}>{ca.toUpperCase()} (10)</ThemedText>
                                    <TextInput
                                      style={[styles.scoreInput, error ? styles.inputError : null]}
                                      keyboardType="numeric"
                                      value={String(score ? score[ca as keyof SubjectScore] || '' : '')}
                                      onChangeText={val => handleMatrixChange(row.enrollment_id, sub.id, ca, val)}
                                      placeholder="0"
                                      placeholderTextColor={C.textMuted}
                                      maxLength={4}
                                    />
                                  </View>
                                );
                              })}
                              
                              <View style={[styles.scoreInputGroup, { flex: 1.5 }]}>
                                <ThemedText style={[styles.scoreLabel, { color: Colors.accent.gold }]}>EXAM (60)</ThemedText>
                                <TextInput
                                  style={[styles.scoreInput, styles.examInput, scoreErrors[`${row.enrollment_id}-${sub.id}-exam`] ? styles.inputError : null]}
                                  keyboardType="numeric"
                                  value={String(score ? score.exam || '' : '')}
                                  onChangeText={val => handleMatrixChange(row.enrollment_id, sub.id, 'exam', val)}
                                  placeholder="0"
                                  placeholderTextColor={C.textMuted}
                                  maxLength={4}
                                />
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons 
                  name={sheetErrorMessage ? "alert-circle-outline" : "layers-outline"} 
                  size={56} 
                  color={sheetErrorMessage ? "#EF4444" : C.textMuted} 
                />
                <ThemedText style={styles.emptyTitle}>
                  {sheetErrorMessage ? "No Data Available" : "Matrix Uninitialized"}
                </ThemedText>
                <ThemedText style={styles.emptySubtitle}>
                  {sheetErrorMessage || "Select class and subjects to initialize the scoring sheet matrix."}
                </ThemedText>
                {sheetErrorMessage && (
                  <TouchableOpacity 
                    onPress={() => loadScoringMatrix(selectedClass!.id)}
                    style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.actionItemBg, borderRadius: 12 }}
                  >
                    <ThemedText style={{ color: Colors.accent.gold, fontSize: 10, fontWeight: '800' }}>RETRY SYNC</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {renderDropdownModal()}
        
        {statusAlert.visible && (
          <CustomAlert
            type={statusAlert.type}
            title={statusAlert.title}
            message={statusAlert.message}
            onClose={() => setStatusAlert({ ...statusAlert, visible: false })}
            onConfirm={statusAlert.onConfirm}
            confirmLabel={statusAlert.confirmLabel}
            style={styles.alert}
          />
        )}
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  const isSmall = width < 380;

  return StyleSheet.create({
    mainWrapper: { flex: 1, backgroundColor: C.background },
    hero: { height: isTiny ? 160 : 230, width: '100%' },
    heroOverlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24, paddingTop: isTiny ? 40 : 50 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: isTiny ? 10 : 16 },
    backButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: C.text, fontSize: isTiny ? 12 : 14, fontWeight: '800', letterSpacing: 0.5 },
    heroContent: { marginTop: 'auto', marginBottom: 20 },
    heroSubtitle: { color: Colors.accent.gold, fontSize: isTiny ? 8 : 9, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
    heroTitle: { color: C.text, fontSize: isTiny ? 22 : 28, fontWeight: '900', letterSpacing: -1 },

    contentWrapper: { paddingHorizontal: isTiny ? 12 : 20, marginTop: 0, paddingBottom: 100 },
    glassCard: { backgroundColor: C.card, borderRadius: isTiny ? 20 : 28, padding: isTiny ? 14 : 20, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 20 },
    label: { color: C.textLabel, fontSize: isTiny ? 7 : 8, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
    
    filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    gridItem: { minWidth: isTiny ? '45%' : 90, flex: 1, gap: 4 },
    miniPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 8, paddingHorizontal: 8, height: 36, borderWidth: 1, borderColor: C.inputBorder },
    miniPickerText: { color: C.inputText, fontSize: isTiny ? 9 : 10, fontWeight: '700' },
    placeholderText: { color: C.textMuted, fontSize: isTiny ? 9 : 10, fontWeight: '600' },
    
    loaderContainer: { padding: 40, alignItems: 'center' },
    loaderText: { marginTop: 16, color: C.textSecondary, fontSize: 8, fontWeight: '800', letterSpacing: 2 },
    
    payloadButton: { flexDirection: 'row', alignItems: 'center', gap: isTiny ? 8 : 12, backgroundColor: C.inputBg, borderRadius: 14, padding: isTiny ? 10 : 14, borderWidth: 1, borderColor: C.inputBorder },
    payloadIconBox: { width: isTiny ? 32 : 38, height: isTiny ? 32 : 38, borderRadius: 10, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    pickerText: { color: C.inputText, fontSize: isTiny ? 11 : 12, fontWeight: '700' },

    matrixContainer: { gap: 16 },
    studentCard: { backgroundColor: C.card, borderRadius: isTiny ? 18 : 24, padding: isTiny ? 10 : 14, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden', marginBottom: 4 },
    studentHeader: { flexDirection: 'row', alignItems: 'center', gap: isTiny ? 8 : 10, marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.divider },
    avatarMini: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.accent.gold },
    avatarText: { color: Colors.accent.gold, fontSize: 10, fontWeight: '800' },
    studentNameText: { color: Colors.accent.gold, fontSize: isTiny ? 12 : 14, fontWeight: '900', letterSpacing: 0.2 },
    studentIdText: { color: C.textSecondary, fontSize: isTiny ? 8 : 9, fontWeight: '600', marginTop: 1 },
    totalBadgeMini: { backgroundColor: Colors.accent.gold + '15', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, alignItems: 'center', minWidth: 36 },
    totalTextMini: { color: Colors.accent.gold, fontSize: isTiny ? 10 : 11, fontWeight: '900' },
    totalLabelMini: { color: Colors.accent.gold, fontSize: 6, fontWeight: '800' },

    subjectsList: { gap: isTiny ? 12 : 16 },
    subjectBlock: { gap: 6 },
    subjectTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    subjectNameText: { color: C.textSecondary, fontSize: isTiny ? 8 : 9, fontWeight: '900', letterSpacing: 0.5, flex: 1 },
    totalIndicator: { backgroundColor: C.actionItemBg, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
    totalValueText: { fontSize: isTiny ? 8 : 10, fontWeight: '900' },

    scoreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: isTiny ? 5 : 6 },
    scoreInputGroup: { flex: 1, minWidth: isTiny ? 36 : 40, gap: 2 },
    scoreLabel: { fontSize: isTiny ? 6 : 8, fontWeight: '800', color: C.textMuted, textAlign: 'center' },
    scoreInput: { height: isTiny ? 32 : 38, backgroundColor: C.inputBg, borderRadius: 8, textAlign: 'center', color: C.inputText, fontSize: isTiny ? 11 : 12, fontWeight: '800', borderWidth: 1, borderColor: C.inputBorder },
    examInput: { borderColor: Colors.accent.gold + '40', backgroundColor: Colors.accent.gold + '05' },
    inputError: { borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.05)' },
    
    scoringGuide: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.accent.gold + '10', padding: 12, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.accent.gold + '20' },
    scoringGuideText: { color: Colors.accent.gold, fontSize: isTiny ? 9 : 10, fontWeight: '800' },

    emptyState: { padding: 40, alignItems: 'center' },
    emptyTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginTop: 16, marginBottom: 6 },
    emptySubtitle: { color: C.textSecondary, fontSize: 11, textAlign: 'center', lineHeight: 18 },

    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' },
    modalContent: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, borderTopWidth: 1 },
    bottomSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, borderTopWidth: 1, maxHeight: '80%' },
    sheetHandle: { width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: C.text, fontSize: 18, fontWeight: '900', marginBottom: 16, textAlign: 'center' },
    dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 4 },
    selectedItem: { backgroundColor: Colors.accent.gold + '10' },
    dropdownItemText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
    selectedItemText: { color: Colors.accent.gold, fontWeight: '800' },
    
    alert: { position: 'absolute', top: 50, left: 16, right: 16, zIndex: 9999 }
  });
}