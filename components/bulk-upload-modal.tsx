import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { API_BASE_URL } from '@/utils/api-service';
import { Colors } from '@/constants/design-system';
import { useAppColors } from '@/hooks/use-app-colors';
import { ThemedText } from '@/components/themed-text';
import { getTeacherClassScope } from '@/utils/jwt-decoder';

// NOTE: `class_name`/id here come from GET /api/classes/school — this
// school's OWN classes table (the real id enrollments.class_id
// references). GET /api/classes (no /school) returns
// global_class_templates instead, a different id space; that endpoint
// is display-name-only and must never feed a classId sent to a write
// endpoint like POST /api/students/bulk below.
type ClassItem = { id: number; class_name: string; capacity?: number; };
type SessionItem = { id: number; session_name: string; year_label?: string; };
type UploadResult = { success: boolean; count?: number; error?: string; };
interface BulkUploadModalProps { visible: boolean; onClose: () => void; onUploadComplete: (result: UploadResult) => void; }

const getToken = async () => {
  return Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
};

function parseStudentCsv(text: string) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV is empty.');
  const students: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const attrs = lines[i].split(',').map((a) => a.trim());
    if (attrs.length >= 2 && attrs[0] && attrs[1]) {
      students.push({ 
        firstName: attrs[0], 
        lastName: attrs[1], 
        email: attrs[2] || undefined, 
        phone: attrs[3] || undefined, 
        studentNumber: attrs[4] || undefined, 
        gender: attrs[5] || undefined 
      });
    }
  }
  if (students.length === 0) throw new Error('No valid rows.');
  return students;
}

type Step = 'select' | 'upload' | 'done' | 'error';

export default function BulkUploadModal({ visible, onClose, onUploadComplete }: BulkUploadModalProps) {
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null);
  const [showClassDropdown, setShowClassDropdown] = useState(false);
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);
  const [step, setStep] = useState<Step>('select');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [emailForTemplate, setEmailForTemplate] = useState('');
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateSuccess, setTemplateSuccess] = useState(false);

  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string; size?: number } | null>(null);
  const [parsedStudents, setParsedStudents] = useState<any[]>([]);
  // A class_teacher can only bulk-enroll into their own class — locked,
  // not just pre-selected, so there's no way to pick around it client-side
  // (the server enforces this too, but the UI shouldn't offer a dead end).
  const [classScope, setClassScope] = useState<{ classId: number } | null>(null);

  const fetchData = useCallback(async () => {
    setLoadingData(true);
    setDataError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Auth required.');
      setClassScope(getTeacherClassScope(token));
      const [classRes, sessionRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/classes/school`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/academic-sessions`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [classData, sessionData] = await Promise.all([classRes.json(), sessionRes.json()]);
      if (classData.success) {
        const list: ClassItem[] = classData.data ?? [];
        setClasses(list);
        const scope = getTeacherClassScope(token);
        if (scope) {
          const own = list.find((c) => c.id === scope.classId);
          if (own) setSelectedClass(own);
        }
      }
      if (sessionData.success) setSessions(sessionData.data ?? []);
    } catch (e: any) {
      setDataError(e?.message || 'Data error.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setStep('select'); setSelectedClass(null); setSelectedSession(null);
      setShowClassDropdown(false); setShowSessionDropdown(false); setUploadError(null);
      setUploadedCount(0); setEmailForTemplate(''); setTemplateError(null);
      setTemplateSuccess(false); setSelectedFile(null); setParsedStudents([]);
      fetchData();
    }
  }, [visible, fetchData]);

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['text/comma-separated-values', 'text/csv', '*/*'] });
      if (result.canceled) return;
      const file = result.assets[0];

      let text: string;
      if (Platform.OS === 'web') {
        text = await (file as any).file.text();
      } else {
        // ✅ New FileSystem API — replaces deprecated readAsStringAsync
        const fileRef = new FileSystem.File(file.uri);
        text = await fileRef.text();
      }

      const students = parseStudentCsv(text);
      setSelectedFile({ name: file.name, uri: file.uri, size: file.size });
      setParsedStudents(students);
      setUploadError(null);
    } catch (e: any) {
      setUploadError(e.message || 'Failed to read file.');
      setSelectedFile(null);
      setParsedStudents([]);
    }
  };

  const handleUpload = async () => {
    if (!selectedClass || !selectedSession || !parsedStudents.length) return;
    setUploading(true);
    setUploadError(null);
    setStep('upload');

    try {
      const payload = parsedStudents.map((s) => ({ ...s, classId: selectedClass.id }));
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/students/bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ students: payload, academicSession: selectedSession.session_name }),
      });

      const json = await res.json();
      if (json.success) {
        setUploadedCount(json.count || parsedStudents.length);
        setStep('done');
        onUploadComplete({ success: true, count: json.count || parsedStudents.length });
      } else {
        throw new Error(json.error || json.message || 'Upload rejected by server.');
      }
    } catch (e: any) {
      setUploadError(e?.message || 'Upload failed.');
      setStep('select'); // Stay on select screen to allow fixing
      onUploadComplete({ success: false, error: e?.message });
    } finally {
      setUploading(false);
    }
  };

  const handleSendTemplateToEmail = async () => {
    if (!emailForTemplate.trim()) return;
    try {
      setSendingTemplate(true); setTemplateError(null);
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/students/email/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: emailForTemplate.trim() }),
      });
      const json = await response.json();
      if (json.success) { setTemplateSuccess(true); setEmailForTemplate(''); }
      else throw new Error(json.message || 'Dispatch failure.');
    } catch (e: any) { setTemplateError(e.message || 'Server error.'); }
    finally { setSendingTemplate(false); }
  };

  const isTiny = width < 300;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableWithoutFeedback>
          <LinearGradient colors={[C.isDark ? 'rgba(15,23,42,0.98)' : 'rgba(255,255,255,0.99)', C.card]} style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View><ThemedText style={styles.title}>Bulk Enrollment</ThemedText></View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}><Ionicons name="close" size={18} color={Colors.accent.gold} /></TouchableOpacity>
            </View>

            {loadingData ? (
              <View style={styles.center}><ActivityIndicator size="small" color={Colors.accent.gold} /><ThemedText style={styles.loadingText}>Syncing options...</ThemedText></View>
            ) : step === 'done' ? (
              <View style={styles.center}>
                <Ionicons name="checkmark-done-circle" size={54} color="#10B981" />
                <ThemedText style={styles.successTitle}>Enrolled Successfully</ThemedText>
                <ThemedText style={styles.successSubtitle}>{uploadedCount} students have been added to {selectedClass?.class_name}</ThemedText>
                <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
                  <ThemedText style={styles.doneBtnText}>CONTINUE</ThemedText>
                </TouchableOpacity>
              </View>
            ) : step === 'upload' ? (
              <View style={styles.center}><ActivityIndicator size="large" color={Colors.accent.gold} /><ThemedText style={[styles.loadingText, { marginTop: 20 }]}>Processing Enrollment Database...</ThemedText></View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {uploadError && (
                  <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={16} color="#fff" style={{ marginRight: 8 }} />
                    <ThemedText style={styles.errorText}>{uploadError}</ThemedText>
                    <TouchableOpacity onPress={() => setUploadError(null)}><Ionicons name="close-circle" size={16} color="#fff" /></TouchableOpacity>
                  </View>
                )}

                <SectionHeader icon="school-outline" label="CLASS" />
                <TouchableOpacity
                  style={[styles.inputSelector, !!classScope && { opacity: 0.6 }]}
                  onPress={() => !classScope && setShowClassDropdown(!showClassDropdown)}
                  disabled={!!classScope}
                >
                  <ThemedText style={styles.selectorText}>{selectedClass?.class_name || 'Select Class'}</ThemedText>
                  {!classScope && <Ionicons name="chevron-down" size={18} color={Colors.accent.gold} />}
                </TouchableOpacity>
                {!!classScope && (
                  <ThemedText style={styles.classLockHint}>You're a class teacher — this upload goes into your assigned class.</ThemedText>
                )}
                {showClassDropdown && !classScope && (
                  <View style={styles.listBox}>
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 150 }}>
                      {classes.map(c => (
                        <TouchableOpacity key={c.id} style={[styles.listItem, selectedClass?.id === c.id && styles.listItemActive]} onPress={() => { setSelectedClass(c); setShowClassDropdown(false); }}>
                          <ThemedText style={[styles.listItemText, selectedClass?.id === c.id && { color: Colors.accent.gold, fontWeight: '800' }]}>{c.class_name}</ThemedText>
                          {selectedClass?.id === c.id && <Ionicons name="checkmark-circle" size={18} color={Colors.accent.gold} />}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                <View style={{ height: 12 }} />

                <SectionHeader icon="calendar-outline" label="SESSION" />
                <TouchableOpacity style={styles.inputSelector} onPress={() => setShowSessionDropdown(!showSessionDropdown)}>
                  <ThemedText style={styles.selectorText}>{selectedSession?.session_name || 'Select Session'}</ThemedText>
                  <Ionicons name="chevron-down" size={18} color={Colors.accent.gold} />
                </TouchableOpacity>
                {showSessionDropdown && (
                  <View style={styles.listBox}>
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 150 }}>
                      {sessions.map(s => (
                        <TouchableOpacity key={s.id} style={[styles.listItem, selectedSession?.id === s.id && styles.listItemActive]} onPress={() => { setSelectedSession(s); setShowSessionDropdown(false); }}>
                          <ThemedText style={[styles.listItemText, selectedSession?.id === s.id && { color: Colors.accent.gold, fontWeight: '800' }]}>{s.session_name}</ThemedText>
                          {selectedSession?.id === s.id && <Ionicons name="checkmark-circle" size={18} color={Colors.accent.gold} />}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                <View style={{ height: 12 }} />

                <SectionHeader icon="document-attach-outline" label="FILE ATTACHMENT" />
                {selectedFile ? (
                  <View style={styles.fileSelectedBox}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Ionicons name="document-text" size={24} color={Colors.accent.gold} />
                      <View style={{ marginLeft: 12, flex: 1 }}>
                        <ThemedText style={styles.fileName} numberOfLines={1}>{selectedFile.name}</ThemedText>
                        <ThemedText style={styles.fileDetail}>{parsedStudents.length} students found in CSV</ThemedText>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => { setSelectedFile(null); setParsedStudents([]); }}>
                      <Ionicons name="trash-outline" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.filePickerBtn} onPress={handlePickFile}>
                    <Ionicons name="cloud-upload-outline" size={20} color={Colors.accent.gold} style={{ marginRight: 8 }} />
                    <ThemedText style={styles.filePickerText}>PICK CSV FILE</ThemedText>
                  </TouchableOpacity>
                )}

                <View style={styles.emailSection}>
                  <SectionHeader icon="mail-outline" label="GET TEMPLATE VIA EMAIL" />
                  <View style={styles.emailRow}>
                    <TextInput style={styles.emailInput} placeholder="email@oags.com" placeholderTextColor={C.textMuted} value={emailForTemplate} onChangeText={setEmailForTemplate} keyboardType="email-address" />
                    <TouchableOpacity onPress={handleSendTemplateToEmail} disabled={sendingTemplate || !emailForTemplate}>
                      {sendingTemplate ? <ActivityIndicator size="small" color={Colors.accent.gold} /> : <Ionicons name="send" size={18} color={Colors.accent.gold} />}
                    </TouchableOpacity>
                  </View>
                  {templateSuccess && <ThemedText style={styles.templateSuccessText}>Template sent successfully!</ThemedText>}
                  {templateError && <ThemedText style={styles.templateErrorText}>{templateError}</ThemedText>}
                </View>

                <TouchableOpacity
                  style={[styles.uploadBtn, (!selectedClass || !selectedSession || !selectedFile) && styles.uploadDisabled]}
                  onPress={handleUpload}
                  disabled={!selectedClass || !selectedSession || !selectedFile}
                >
                  <ThemedText style={styles.uploadBtnText}>READY TO UPLOAD</ThemedText>
                </TouchableOpacity>
              </ScrollView>
            )}
          </LinearGradient>
        </TouchableWithoutFeedback>
      </TouchableOpacity>
    </Modal>
  );
}

function SectionHeader({ icon, label }: any) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, marginTop: 12 }}>
      <Ionicons name={icon} size={12} color={Colors.accent.gold} style={{ marginRight: 6 }} />
      <Text style={{ color: Colors.accent.gold, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>{label}</Text>
    </View>
  );
}

function makeStyles(C: any, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'flex-end' },
    sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: isTiny ? 16 : 24, maxHeight: '90%' },
    handle: { width: 34, height: 4, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    title: { fontSize: 18, fontWeight: '900', color: C.text },
    closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.inputBg, justifyContent: 'center', alignItems: 'center' },
    center: { alignItems: 'center', padding: 30 },
    loadingText: { color: C.textMuted, marginTop: 10, fontSize: 11 },
    inputSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 12, paddingHorizontal: 16, height: 48, borderWidth: 1, borderColor: C.inputBorder, marginBottom: 8 },
    selectorText: { color: C.inputText, fontSize: 13, fontWeight: '700' },
    classLockHint: { fontSize: 9.5, color: C.textMuted, marginTop: -4, marginBottom: 10, lineHeight: 13 },
    listBox: { backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.inputBorder, overflow: 'hidden' },
    listItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: C.divider, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    listItemActive: { backgroundColor: Colors.accent.gold + '10' },
    listItemText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' },
    emailSection: { marginTop: 16 },
    emailRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderRadius: 10, paddingHorizontal: 12, height: 40, borderWidth: 1, borderColor: C.inputBorder },
    emailInput: { flex: 1, fontSize: 12, color: C.inputText },
    uploadBtn: { backgroundColor: Colors.accent.gold, borderRadius: 12, height: 48, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
    uploadDisabled: { opacity: 0.5 },
    uploadBtnText: { color: Colors.accent.navy, fontWeight: '900', fontSize: 13 },
    errorBanner: { backgroundColor: '#EF4444', padding: 12, borderRadius: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
    errorText: { color: '#fff', fontSize: 11, fontWeight: '700', flex: 1 },
    successTitle: { fontSize: 18, fontWeight: '900', color: C.text, marginTop: 12 },
    successSubtitle: { fontSize: 13, color: C.textMuted, textAlign: 'center', marginTop: 8, marginBottom: 12 },
    doneBtn: { backgroundColor: '#10B981', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
    doneBtnText: { color: '#fff', fontWeight: '800' },
    filePickerBtn: { height: 48, borderRadius: 12, borderStyle: 'dashed', borderWidth: 2, borderColor: Colors.accent.gold + '40', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', backgroundColor: Colors.accent.gold + '05' },
    filePickerText: { color: Colors.accent.gold, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
    fileSelectedBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.accent.gold + '30' },
    fileName: { color: C.text, fontSize: 13, fontWeight: '700' },
    fileDetail: { color: C.textMuted, fontSize: 11, marginTop: 2 },
    templateSuccessText: { color: '#10B981', fontSize: 10, fontWeight: '700', marginTop: 6, marginLeft: 4 },
    templateErrorText: { color: '#EF4444', fontSize: 10, fontWeight: '700', marginTop: 6, marginLeft: 4 },
  });
}
