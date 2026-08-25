import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  FlatList,
  TouchableWithoutFeedback,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '@/utils/api-service';
import { Colors } from '@/constants/design-system';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';
import {
  getToken,
  teacherAiApi,
  DocType,
  DOC_TYPE_LABELS,
  DOC_TYPE_TO_CONTENT_TYPE,
  DISCLAIMER,
} from '@/utils/teacher-ai-api';

const TERMS = ['First', 'Second', 'Third'];

interface Week { weekNo: number; topic: string; objectives: string; resources: string; }

// teacher_ai_editor (addendum §1.3/§1.4/§1.5) — the structured document
// editor AI output (or a manual entry) lands in. Draft badge, persistent
// AI-content banner, section-by-section fields, floating "Ask AI"
// button, sticky footer with Save Draft / Approve & Save. Shared by all
// three content types via the `type` param.
export default function TeacherAiEditorPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type: string; id?: string }>();
  const type = params.type as DocType;
  const id = params.id ? Number(params.id) : null;
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;
  const label = DOC_TYPE_LABELS[type] || 'Document';

  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [docId, setDocId] = useState<number | null>(id);
  const [status, setStatus] = useState<'draft' | 'approved'>('draft');
  const [createdVia, setCreatedVia] = useState<'ai' | 'manual'>('manual');
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [approvedByName, setApprovedByName] = useState<string | null>(null);
  const isApproved = status === 'approved';
  const isReadOnly = isApproved;

  // Common fields
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [subjectName, setSubjectName] = useState('');
  const [classId, setClassId] = useState<number | null>(null);
  const [className, setClassName] = useState('');
  const [term, setTerm] = useState<string>('');
  const [session, setSession] = useState<string>('');

  // Scheme of Work
  const [weeks, setWeeks] = useState<Week[]>([]);

  // Lesson Plan
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState('');
  const [objectives, setObjectives] = useState('');
  const [materials, setMaterials] = useState('');
  const [teacherActivities, setTeacherActivities] = useState('');
  const [studentActivities, setStudentActivities] = useState('');
  const [evaluation, setEvaluation] = useState('');

  // Lesson Note
  const [assessment, setAssessment] = useState('');

  const [subjects, setSubjects] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeModal, setActiveModal] = useState<'subject' | 'class' | 'term' | 'session' | null>(null);

  const [alert, setAlert] = useState<{ visible: boolean; type: 'success' | 'error' | 'warning' | 'info'; message: string; onConfirm?: () => void; confirmLabel?: string }>({
    visible: false,
    type: 'info',
    message: '',
  });

  const getFieldsToken = getToken;

  const loadLookups = useCallback(async (token: string) => {
    try {
      const [classesRes, subjectsRes, sessionsRes] = await Promise.all([
        // /api/classes/school — real classes.id, matching the FK
        // ai_scheme_of_work.class_id etc. actually reference.
        fetch(`${API_BASE_URL}/api/classes/school`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/classes/subjects`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/academic-sessions`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const classesData = await classesRes.json();
      const subjectsData = await subjectsRes.json();
      const sessionsData = await sessionsRes.json();
      if (classesData.success) setClasses(classesData.data || []);
      if (subjectsData.success) setSubjects(subjectsData.data || []);
      if (sessionsData.success) {
        const list = (sessionsData.data || []).map((s: any) => ({ id: s.id, session_name: s.session_name || s.name, is_active: s.is_active }));
        setSessions(list);
        if (!session) {
          const active = list.find((s: any) => s.is_active) || list[0];
          if (active) setSession(active.session_name);
        }
      }
    } catch (e) {
      // Non-fatal.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDoc = useCallback(async () => {
    try {
      const token = await getFieldsToken();
      if (!token) { router.replace('/(auth)'); return; }

      await loadLookups(token);

      if (!id) { setLoading(false); return; }

      const res = await teacherAiApi.getDocument(token, type, id);
      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 404) {
        setAlert({ visible: true, type: 'error', message: `This ${label.toLowerCase()} could not be found.` });
        setLoading(false);
        return;
      }
      if (res.status === 403) {
        setAlert({ visible: true, type: 'error', message: 'This document is still a draft and only visible to its author.' });
        setLoading(false);
        return;
      }

      const data = await res.json();
      if (data.success) {
        const doc = data.data;
        setDocId(doc.id);
        setStatus(doc.status);
        setCreatedVia(doc.createdVia || 'manual');
        setApprovedAt(doc.approvedAt || null);
        setApprovedByName(doc.approvedByName || null);
        setTitle(doc.title || '');
        setSubjectId(doc.subjectId || null);
        setClassId(doc.classId || null);
        setTerm(doc.term || '');
        setSession(doc.session || '');

        if (type === 'scheme-of-work') {
          setWeeks(Array.isArray(doc.weeks) ? doc.weeks : []);
        } else if (type === 'lesson-plans') {
          setTopic(doc.topic || '');
          setDuration(doc.duration || '');
          setObjectives(doc.objectives || '');
          setMaterials(doc.materials || '');
          setTeacherActivities(doc.teacherActivities || '');
          setStudentActivities(doc.studentActivities || '');
          setEvaluation(doc.evaluation || '');
        } else {
          setTopic(doc.topic || '');
          setObjectives(doc.objectives || '');
          setTeacherActivities(doc.teacherActivities || '');
          setStudentActivities(doc.studentActivities || '');
          setAssessment(doc.assessment || '');
        }
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to load document.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, type]);

  useFocusEffect(
    useCallback(() => {
      loadDoc();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadDoc])
  );

  useEffect(() => {
    if (classId) {
      const c = classes.find((x) => x.id === classId);
      if (c) setClassName(c.class_name);
    }
    if (subjectId) {
      const s = subjects.find((x) => x.id === subjectId);
      if (s) setSubjectName(s.subject_name || s.name);
    }
  }, [classId, subjectId, classes, subjects]);

  const buildBody = () => {
    const body: any = { title: title.trim() || undefined, subjectId, classId, term: term || undefined, session: session || undefined };
    if (type === 'scheme-of-work') {
      body.weeks = weeks;
    } else if (type === 'lesson-plans') {
      Object.assign(body, { topic, duration, objectives, materials, teacherActivities, studentActivities, evaluation });
    } else {
      Object.assign(body, { topic, objectives, teacherActivities, studentActivities, assessment });
    }
    return body;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const token = await getFieldsToken();
      if (!token) { router.replace('/(auth)'); return; }

      const body = buildBody();
      const res = docId
        ? await teacherAiApi.updateDocument(token, type, docId, body)
        : await teacherAiApi.createDocument(token, type, body);

      if (res.status === 402) { router.replace('/pricing'); return; }
      const data = await res.json();
      if (data.success) {
        setDocId(data.data.id);
        setTitle(data.data.title || '');
        setAlert({ visible: true, type: 'success', message: `${label} saved as draft.` });
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to save draft.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const confirmApprove = () => {
    if (!docId) {
      setAlert({ visible: true, type: 'warning', message: 'Save this as a draft first, then approve it.' });
      return;
    }
    setAlert({
      visible: true,
      type: 'warning',
      message: `Approving locks this ${label.toLowerCase()} from further edits and makes it visible to Admin for oversight. Continue?`,
      confirmLabel: 'Approve & Save',
      onConfirm: doApprove,
    });
  };

  const doApprove = async () => {
    if (!docId) return;
    setApproving(true);
    try {
      const token = await getFieldsToken();
      if (!token) { router.replace('/(auth)'); return; }
      const res = await teacherAiApi.approveDocument(token, type, docId);
      if (res.status === 402) { router.replace('/pricing'); return; }
      const data = await res.json();
      if (data.success) {
        setStatus('approved');
        setApprovedAt(data.data.approvedAt);
        setApprovedByName(data.data.approvedByName);
        setAlert({ visible: true, type: 'success', message: `${label} approved.` });
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Failed to approve.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setApproving(false);
    }
  };

  const openAskAi = () => {
    router.push({ pathname: '/teacher-ai-chat', params: { contentType: DOC_TYPE_TO_CONTENT_TYPE[type] } } as any);
  };

  const addWeek = () => {
    setWeeks((prev) => [...prev, { weekNo: prev.length + 1, topic: '', objectives: '', resources: '' }]);
  };
  const removeWeek = (index: number) => {
    setWeeks((prev) => prev.filter((_, i) => i !== index).map((w, i) => ({ ...w, weekNo: i + 1 })));
  };
  const updateWeek = (index: number, field: keyof Week, value: string) => {
    setWeeks((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
  };

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading {label}...</ThemedText>
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
        <ThemedText style={styles.headerTitle} numberOfLines={1}>{label}</ThemedText>
        <StatusPill status={status} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {createdVia === 'ai' && (
          <View style={styles.aiBanner}>
            <Ionicons name="sparkles-outline" size={14} color={Colors.accent.gold} />
            <ThemedText style={styles.aiBannerText}>{DISCLAIMER}</ThemedText>
          </View>
        )}

        {isApproved && (
          <View style={styles.approvedBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
            <ThemedText style={styles.approvedBannerText}>
              Approved{approvedAt ? ` ${new Date(approvedAt).toLocaleDateString()}` : ''}{approvedByName ? ` by ${approvedByName}` : ''}. This document is locked from further edits.
            </ThemedText>
          </View>
        )}

        <FieldLabel text="TITLE" C={C} />
        <TextInput
          style={[styles.input, isReadOnly && styles.inputDisabled]}
          value={title}
          onChangeText={setTitle}
          placeholder={`e.g. ${label} — auto-generated if left blank`}
          placeholderTextColor={C.placeholder}
          editable={!isReadOnly}
        />

        <View style={styles.pickerRow}>
          <View style={{ flex: 1 }}>
            <FieldLabel text="SUBJECT" C={C} />
            <PickerButton value={subjectName || 'Select'} onPress={() => !isReadOnly && setActiveModal('subject')} disabled={isReadOnly} C={C} styles={styles} />
          </View>
          <View style={{ flex: 1 }}>
            <FieldLabel text="CLASS" C={C} />
            <PickerButton value={className || 'Select'} onPress={() => !isReadOnly && setActiveModal('class')} disabled={isReadOnly} C={C} styles={styles} />
          </View>
        </View>

        <View style={styles.pickerRow}>
          <View style={{ flex: 1 }}>
            <FieldLabel text="TERM" C={C} />
            <PickerButton value={term || 'Select'} onPress={() => !isReadOnly && setActiveModal('term')} disabled={isReadOnly} C={C} styles={styles} />
          </View>
          <View style={{ flex: 1 }}>
            <FieldLabel text="SESSION" C={C} />
            <PickerButton value={session || 'Select'} onPress={() => !isReadOnly && setActiveModal('session')} disabled={isReadOnly} C={C} styles={styles} />
          </View>
        </View>

        {type === 'scheme-of-work' && (
          <>
            <View style={styles.weeksHeaderRow}>
              <FieldLabel text={`WEEKS (${weeks.length})`} C={C} />
              {!isReadOnly && (
                <TouchableOpacity onPress={addWeek} style={styles.addWeekBtn}>
                  <Ionicons name="add" size={14} color="#0F172A" />
                  <ThemedText style={styles.addWeekText}>Add Week</ThemedText>
                </TouchableOpacity>
              )}
            </View>
            {weeks.length === 0 ? (
              <View style={styles.emptyWeeks}>
                <ThemedText style={styles.emptyWeeksText}>No weeks yet. Add the first week of the term.</ThemedText>
              </View>
            ) : (
              weeks.map((w, i) => (
                <View key={i} style={styles.weekCard}>
                  <View style={styles.weekCardHeader}>
                    <ThemedText style={styles.weekCardTitle}>Week {w.weekNo}</ThemedText>
                    {!isReadOnly && (
                      <TouchableOpacity onPress={() => removeWeek(i)}>
                        <Ionicons name="trash-outline" size={15} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={[styles.input, styles.weekInput, isReadOnly && styles.inputDisabled]}
                    value={w.topic}
                    onChangeText={(v) => updateWeek(i, 'topic', v)}
                    placeholder="Topic"
                    placeholderTextColor={C.placeholder}
                    editable={!isReadOnly}
                  />
                  <TextInput
                    style={[styles.input, styles.weekInput, styles.textarea, isReadOnly && styles.inputDisabled]}
                    value={w.objectives}
                    onChangeText={(v) => updateWeek(i, 'objectives', v)}
                    placeholder="Objectives"
                    placeholderTextColor={C.placeholder}
                    editable={!isReadOnly}
                    multiline
                  />
                  <TextInput
                    style={[styles.input, styles.weekInput, isReadOnly && styles.inputDisabled]}
                    value={w.resources}
                    onChangeText={(v) => updateWeek(i, 'resources', v)}
                    placeholder="Resources"
                    placeholderTextColor={C.placeholder}
                    editable={!isReadOnly}
                  />
                </View>
              ))
            )}
          </>
        )}

        {type === 'lesson-plans' && (
          <>
            <TextField label="TOPIC" value={topic} onChangeText={setTopic} editable={!isReadOnly} C={C} styles={styles} />
            <TextField label="DURATION" value={duration} onChangeText={setDuration} editable={!isReadOnly} placeholder="e.g. 40 minutes" C={C} styles={styles} />
            <TextField label="OBJECTIVES" value={objectives} onChangeText={setObjectives} editable={!isReadOnly} multiline C={C} styles={styles} />
            <TextField label="MATERIALS" value={materials} onChangeText={setMaterials} editable={!isReadOnly} multiline C={C} styles={styles} />
            <TextField label="TEACHER ACTIVITIES" value={teacherActivities} onChangeText={setTeacherActivities} editable={!isReadOnly} multiline C={C} styles={styles} />
            <TextField label="STUDENT ACTIVITIES" value={studentActivities} onChangeText={setStudentActivities} editable={!isReadOnly} multiline C={C} styles={styles} />
            <TextField label="EVALUATION" value={evaluation} onChangeText={setEvaluation} editable={!isReadOnly} multiline C={C} styles={styles} />
          </>
        )}

        {type === 'lesson-notes' && (
          <>
            <TextField label="TOPIC" value={topic} onChangeText={setTopic} editable={!isReadOnly} C={C} styles={styles} />
            <TextField label="OBJECTIVES" value={objectives} onChangeText={setObjectives} editable={!isReadOnly} multiline C={C} styles={styles} />
            <TextField label="TEACHER ACTIVITIES" value={teacherActivities} onChangeText={setTeacherActivities} editable={!isReadOnly} multiline C={C} styles={styles} />
            <TextField label="STUDENT ACTIVITIES" value={studentActivities} onChangeText={setStudentActivities} editable={!isReadOnly} multiline C={C} styles={styles} />
            <TextField label="ASSESSMENT" value={assessment} onChangeText={setAssessment} editable={!isReadOnly} multiline C={C} styles={styles} />
          </>
        )}

        <View style={{ height: 90 }} />
      </ScrollView>

      {!isReadOnly && (
        <TouchableOpacity style={styles.fab} onPress={openAskAi} activeOpacity={0.85}>
          <Ionicons name="sparkles" size={20} color="#0F172A" />
        </TouchableOpacity>
      )}

      {!isReadOnly && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerBtnOutline} onPress={handleSaveDraft} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={C.text} /> : <ThemedText style={styles.footerBtnOutlineText}>Save Draft</ThemedText>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerBtnPrimary} onPress={confirmApprove} disabled={approving}>
            {approving ? <ActivityIndicator size="small" color="#0F172A" /> : <ThemedText style={styles.footerBtnPrimaryText}>Approve & Save</ThemedText>}
          </TouchableOpacity>
        </View>
      )}

      <PickerModal
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        subjects={subjects}
        classes={classes}
        sessions={sessions}
        term={term}
        onSelectSubject={(s) => { setSubjectId(s.id); setSubjectName(s.subject_name || s.name); }}
        onSelectClass={(c) => { setClassId(c.id); setClassName(c.class_name); }}
        onSelectTerm={(t) => setTerm(t)}
        onSelectSession={(s) => setSession(s.session_name)}
        C={C}
        width={width}
      />

      {alert.visible && (
        <CustomAlert
          type={alert.type}
          message={alert.message}
          confirmLabel={alert.confirmLabel}
          onConfirm={alert.onConfirm}
          onClose={() => setAlert({ ...alert, visible: false })}
        />
      )}
    </ThemedView>
  );
}

function FieldLabel({ text, C }: { text: string; C: any }) {
  return <ThemedText style={{ color: C.textMuted, fontSize: 9.5, fontWeight: '900', letterSpacing: 1, marginBottom: 6, marginTop: 14 }}>{text}</ThemedText>;
}

function TextField({ label, value, onChangeText, editable, multiline, placeholder, C, styles }: any) {
  return (
    <>
      <FieldLabel text={label} C={C} />
      <TextInput
        style={[styles.input, multiline && styles.textarea, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        multiline={multiline}
        placeholder={placeholder || `Enter ${label.toLowerCase()}`}
        placeholderTextColor={C.placeholder}
      />
    </>
  );
}

function PickerButton({ value, onPress, disabled, C, styles }: any) {
  return (
    <TouchableOpacity style={[styles.pickerBtn, disabled && styles.inputDisabled]} onPress={onPress} disabled={disabled}>
      <ThemedText style={styles.pickerBtnText} numberOfLines={1}>{value}</ThemedText>
      {!disabled && <Ionicons name="chevron-down" size={14} color={C.textMuted} />}
    </TouchableOpacity>
  );
}

function StatusPill({ status }: { status: string }) {
  const isApproved = status === 'approved';
  const color = isApproved ? '#22C55E' : '#F59E0B';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: `${color}15`, borderColor: `${color}40`, borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <ThemedText style={{ color, fontSize: 9.5, fontWeight: '800' }}>{isApproved ? 'Approved' : 'Draft'}</ThemedText>
    </View>
  );
}

function PickerModal({ activeModal, onClose, subjects, classes, sessions, term, onSelectSubject, onSelectClass, onSelectTerm, onSelectSession, C, width }: any) {
  if (!activeModal) return null;

  let data: any[] = [];
  let title = '';
  let renderLabel = (item: any) => item.name;
  let onSelect = (item: any) => {};

  if (activeModal === 'subject') {
    data = subjects; title = 'Select Subject';
    renderLabel = (item) => item.subject_name || item.name;
    onSelect = onSelectSubject;
  } else if (activeModal === 'class') {
    data = classes; title = 'Select Class';
    renderLabel = (item) => item.class_name;
    onSelect = onSelectClass;
  } else if (activeModal === 'term') {
    data = TERMS.map((t) => ({ id: t, name: t }));
    title = 'Select Term';
    onSelect = (item) => onSelectTerm(item.name);
  } else if (activeModal === 'session') {
    data = sessions; title = 'Select Session';
    renderLabel = (item) => item.session_name;
    onSelect = onSelectSession;
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' }} activeOpacity={1} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={{ backgroundColor: C.modalBg, borderColor: C.cardBorder, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: width < 300 ? 16 : 24, borderTopWidth: 1, maxHeight: '75%' }}>
            <View style={{ width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
            <ThemedText style={{ color: C.text, fontSize: 16, fontWeight: '900', marginBottom: 14, textAlign: 'center' }}>{title}</ThemedText>
            {data.length === 0 ? (
              <ThemedText style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 20 }}>Nothing to select yet.</ThemedText>
            ) : (
              <FlatList
                data={data}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 4 }}
                    onPress={() => { onSelect(item); onClose(); }}
                  >
                    <ThemedText style={{ color: C.textSecondary, fontSize: 13, fontWeight: '600' }}>{renderLabel(item)}</ThemedText>
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingBottom: 30 }}
              />
            )}
          </View>
        </TouchableWithoutFeedback>
      </TouchableOpacity>
    </Modal>
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

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 30 },

    aiBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: `${Colors.accent.gold}12`, borderRadius: 14, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: `${Colors.accent.gold}40` },
    aiBannerText: { flex: 1, color: C.text, fontSize: 10.5, lineHeight: 15, fontWeight: '600' },

    approvedBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#22C55E12', borderRadius: 14, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#22C55E40' },
    approvedBannerText: { flex: 1, color: C.text, fontSize: 10.5, lineHeight: 15, fontWeight: '600' },

    input: { backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.inputBorder, paddingHorizontal: 14, paddingVertical: 11, color: C.inputText, fontSize: 13 },
    inputDisabled: { opacity: 0.55 },
    textarea: { minHeight: 80, textAlignVertical: 'top' },

    pickerRow: { flexDirection: 'row', gap: 12 },
    pickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.inputBorder, paddingHorizontal: 14, paddingVertical: 11 },
    pickerBtnText: { color: C.inputText, fontSize: 12.5, fontWeight: '600', flex: 1 },

    weeksHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
    addWeekBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.accent.gold, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    addWeekText: { color: '#0F172A', fontSize: 10.5, fontWeight: '800' },

    emptyWeeks: { backgroundColor: C.actionItemBg, borderRadius: 14, borderWidth: 1, borderColor: C.actionItemBorder, padding: 16, alignItems: 'center', marginTop: 10 },
    emptyWeeksText: { color: C.textMuted, fontSize: 11.5, textAlign: 'center' },

    weekCard: { backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 12, marginTop: 10, gap: 8 },
    weekCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
    weekCardTitle: { color: C.text, fontSize: 12, fontWeight: '800' },
    weekInput: { fontSize: 12 },

    fab: { position: 'absolute', right: 18, bottom: 90, width: 50, height: 50, borderRadius: 25, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },

    footer: { flexDirection: 'row', gap: 10, padding: isTiny ? 14 : 18, paddingBottom: Platform.OS === 'ios' ? 30 : 18, backgroundColor: C.modalBg, borderTopWidth: 1, borderColor: C.divider },
    footerBtnOutline: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.borderStrong },
    footerBtnOutlineText: { color: C.text, fontSize: 12.5, fontWeight: '800' },
    footerBtnPrimary: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.accent.gold },
    footerBtnPrimaryText: { color: '#0F172A', fontSize: 12.5, fontWeight: '800' },
  });
}
