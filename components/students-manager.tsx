import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  Alert,
  ScrollView,
  RefreshControl,
  ImageBackground,
  TouchableWithoutFeedback,
  useWindowDimensions,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from '@/utils/api-service';
import { isSchoolOwner, getTeacherClassScope } from '@/utils/jwt-decoder';
import { clearAllStorage } from '@/utils/storage';
import { Colors } from '@/constants/design-system';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { useAppColors } from '@/hooks/use-app-colors';
import Footer from '../app/components/Footer';
import BulkUploadModal from '@/components/bulk-upload-modal';

type Student = {
  id: string | number;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  registration_number?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  phone?: string | null;
};

type Class = {
  id: number;
  class_name: string;
  capacity: number;
};

export default function StudentsManager() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);

  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'students' | 'enrollments'>('students');
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState<boolean>(false);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterClassId, setFilterClassId] = useState<number | null>(null);
  const [filterSessionId, setFilterSessionId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
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

  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    registrationNumber: '',
    gender: 'Male',
    dateOfBirth: '',
    classId: null,
  });
  const [dobParts, setDobParts] = useState({ year: '', month: '', day: '' });
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [activeSessionName, setActiveSessionName] = useState<string>('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);
  const [showClassDropdown, setShowClassDropdown] = useState(false);
  const [isClassListOpen, setIsClassListOpen] = useState<boolean>(false);
  const [classSearchQuery, setClassSearchQuery] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');
  const [downloadModalVisible, setDownloadModalVisible] = useState(false);
  const [emailForTemplate, setEmailForTemplate] = useState('');
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateSuccess, setTemplateSuccess] = useState(false);
  const [bulkUploadVisible, setBulkUploadVisible] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  // Owner-vs-admin gating (Staff Onboarding): only the school owner can
  // delete data. Defaults to true so a lone owner account (no admins
  // added yet, or token decode fails) never loses its own delete access.
  const [isOwner, setIsOwner] = useState(true);
  // A class_teacher (see backend middleware/auth.js -> getTeacherClassScope)
  // is restricted to their own class — null for everyone else.
  const [classScope, setClassScope] = useState<{ classId: number } | null>(null);

  const getToken = async () => {
    return Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
  };

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        setIsOwner(isSchoolOwner(token));
        setClassScope(getTeacherClassScope(token));
      }
    })();
  }, []);

  const fetchInitialData = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const [classRes, studentRes, sessionRes] = await Promise.all([
        // NOTE: /api/classes/school — this school's OWN class rows (real
        // classes.id, what enrollments.class_id actually references).
        // GET /api/classes (no /school) returns global_class_templates
        // ids instead, a different id space — display-name source only,
        // never send its ids back to a write endpoint.
        fetch(`${API_BASE_URL}/api/classes/school`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/students`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE_URL}/api/academic-sessions`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      const [classData, studentData, sessionData] = await Promise.all([classRes.json(), studentRes.json(), sessionRes.json()]);

      if (classData.success) setClasses(classData.data);
      if (studentData.success) setStudents(studentData.data || []);
      if (sessionData.success && sessionData.data?.length > 0) {
        setSessions(sessionData.data);
        const active = sessionData.data.find((s: any) => s.is_active) || sessionData.data[0];
        setActiveSessionName(active.session_name);
      }
    } catch (e: any) {
      setStatusAlert({ visible: true, type: 'error', title: 'Error', message: 'Unable to sync records.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchInitialData(); }, [fetchInitialData]);

  const fetchEnrollments = useCallback(async () => {
    try {
      setEnrollmentsLoading(true);
      const token = await getToken();
      if (!token) return;

      let queryParams = [];
      if (filterStatus) queryParams.push(`status=${filterStatus}`);
      if (filterClassId) queryParams.push(`classId=${filterClassId}`);
      if (filterSessionId) queryParams.push(`sessionId=${filterSessionId}`);

      const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

      const res = await fetch(`${API_BASE_URL}/api/students/enrollments${queryString}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setEnrollments(data.data || []);
      }
    } catch (e: any) {
      console.error('Fetch Enrollments Error:', e);
    } finally {
      setEnrollmentsLoading(false);
    }
  }, [filterStatus, filterClassId, filterSessionId]);

  useEffect(() => {
    if (activeTab === 'enrollments') {
      fetchEnrollments();
    }
  }, [activeTab, fetchEnrollments]);

  const confirmDeleteEnrollment = (item: any) => {
    setStatusAlert({
      visible: true,
      type: 'warning',
      title: 'Remove Enrollment',
      message: `Are you sure you want to remove the enrollment for ${item.first_name} ${item.last_name} in ${item.class_name} (${item.academic_session})?`,
      onConfirm: async () => {
        await deleteEnrollment(item.enrollment_id, `${item.first_name} ${item.last_name}`);
      }
    });
  };

  const deleteEnrollment = async (enrollmentId: number, studentName: string) => {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/students/enrollments/${enrollmentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) {
        fetchEnrollments();
        setStatusAlert({
          visible: true,
          type: 'success',
          title: 'Removed!',
          message: `Enrollment for ${studentName} has been successfully deleted.`
        });
      } else throw new Error(json.error || 'Request rejected.');
    } catch (e: any) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Failed',
        message: e?.message || 'Connection lost.'
      });
    } finally {
      setSaving(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); fetchInitialData(); };

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
      },
    });
  };

  const handleSendTemplateToEmail = async () => {
    if (!emailForTemplate.includes('@')) return;
    try {
      setSendingTemplate(true);
      setTemplateError(null);
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/students/email/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: emailForTemplate.trim() }),
      });
      const json = await response.json();
      if (json.success) {
        setTemplateSuccess(true);
        setEmailForTemplate('');
      } else throw new Error(json.message || 'Dispatch failure');
    } catch (e: any) {
      setTemplateError(e.message || 'Server error.');
    } finally {
      setSendingTemplate(false);
    }
  };

  const saveStudent = async () => {
    if (!form.firstName || !form.lastName) return;
    const { year, month, day } = dobParts;
    let finalDob = form.dateOfBirth;
    if (year && month && day) finalDob = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    setSaving(true);
    try {
      const token = await getToken();
      const method = editingId ? 'PUT' : 'POST';
      const endpoint = editingId ? `/api/students/${editingId}` : `/api/students/bulk`;
      const body = editingId
        ? JSON.stringify({ ...form, dateOfBirth: finalDob })
        : JSON.stringify({ students: [{ ...form, dateOfBirth: finalDob }], academicSession: activeSessionName });

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body
      });
      const json = await res.json();
      if (json.success) {
        setModalVisible(false);
        fetchInitialData();
        setStatusAlert({ visible: true, type: 'success', title: editingId ? 'Updated!' : 'Enrolled!', message: `${form.firstName} ${form.lastName} has been ${editingId ? 'updated' : 'added'} successfully.` });
      } else throw new Error(json.error || 'Request rejected.');
    } catch (e: any) {
      setEnrollError(e?.message || 'Connection lost.');
      setStatusAlert({ visible: true, type: 'error', title: 'Failed', message: e?.message || 'Connection lost.' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    setStatusAlert({
      visible: true,
      type: 'error',
      title: 'PERMANENT DELETION',
      message: `Are you sure you want to PERMANENTLY delete ${form.firstName} ${form.lastName}? This will erase their profile, enrollments, reports, and scores permanently. This action cannot be undone.`,
      onConfirm: async () => {
        await deleteStudent();
      }
    });
  };

  const deleteStudent = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/students/${editingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) {
        setModalVisible(false);
        fetchInitialData();
        setStatusAlert({
          visible: true,
          type: 'success',
          title: 'Deleted!',
          message: `${form.firstName} ${form.lastName} has been permanently deleted.`
        });
      } else throw new Error(json.error || 'Request rejected.');
    } catch (e: any) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Failed',
        message: e?.message || 'Connection lost.'
      });
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (s: Student) => {
    let year = '', month = '', day = '';
    if (s.date_of_birth) {
      const parts = String(s.date_of_birth).split('T')[0].split('-');
      if (parts.length === 3) { year = parts[0]; month = parts[1]; day = parts[2]; }
    }
    setDobParts({ year, month, day });
    setForm({ firstName: s.first_name, lastName: s.last_name, email: s.email, registrationNumber: s.registration_number, phone: s.phone, gender: s.gender || 'Male', dateOfBirth: s.date_of_birth, classId: null });
    setEditingId(s.id);
    setEnrollError(null);
    setModalVisible(true);
  };

  const isTiny = width < 300;

  const renderStudent = ({ item }: { item: Student }) => (
    <TouchableOpacity style={styles.studentCard} onPress={() => openEdit(item)}>
      <View style={styles.cardHeader}>
        <View style={styles.avatarContainer}>
          <ThemedText style={styles.avatarText}>{(item.first_name?.[0] || '') + (item.last_name?.[0] || '')}</ThemedText>
        </View>
        <View style={styles.studentInfo}>
          <ThemedText style={styles.studentName} numberOfLines={1}>{item.first_name} {item.last_name}</ThemedText>
          <ThemedText style={styles.studentSub}>{item.registration_number || 'No REG'}</ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
      </View>
    </TouchableOpacity>
  );

  if (loading) return (
    <ThemedView style={styles.loader}>
      <ActivityIndicator size="large" color={Colors.accent.gold} />
      <ThemedText style={styles.loadingText}>SYNCING...</ThemedText>
    </ThemedView>
  );

  return (
    <ThemedView style={styles.mainWrapper}>
      <ImageBackground source={{ uri: 'https://images.unsplash.com/photo-1577891913314-147eeaa99602?q=80&w=2069' }} style={styles.hero}>
        <LinearGradient colors={['rgba(15, 23, 42, 0.7)', Colors.accent.navy]} style={styles.heroOverlay}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}><Ionicons name="chevron-back" size={20} color={C.text} /></TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.actionIcon} onPress={() => setBulkUploadVisible(true)}><Ionicons name="cloud-upload-outline" size={18} color={Colors.accent.gold} /></TouchableOpacity>
              <TouchableOpacity style={styles.addButton} onPress={() => { setForm({ gender: 'Male', classId: classScope?.classId || null }); setDobParts({ year: '', month: '', day: '' }); setEditingId(null); setModalVisible(true); }}><Ionicons name="add" size={22} color={Colors.accent.navy} /></TouchableOpacity>
            </View>
          </View>
          <View style={styles.heroContent}>
            <ThemedText style={styles.heroSubtitle}>OAGS REGISTRY</ThemedText>
            <ThemedText style={styles.heroMainTitle}>Students</ThemedText>
          </View>
        </LinearGradient>
      </ImageBackground>

      <View style={styles.noticeBox}>
        <ThemedText style={styles.noticeTitle}>Default student password</ThemedText>
        <ThemedText style={styles.noticeText}>
          Every student added will have the default password "1234567890". Encourage students to change this password immediately after first login.
        </ThemedText>
      </View>

      <View style={styles.segmentedControl}>
        <TouchableOpacity 
          style={[styles.segmentButton, activeTab === 'students' && styles.activeSegment]}
          onPress={() => setActiveTab('students')}
        >
          <Ionicons name="people" size={16} color={activeTab === 'students' ? Colors.accent.gold : C.textMuted} style={{ marginRight: 6 }} />
          <Text style={[styles.segmentText, activeTab === 'students' && { color: Colors.accent.gold, fontWeight: '800' }]}>Students</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.segmentButton, activeTab === 'enrollments' && styles.activeSegment]}
          onPress={() => setActiveTab('enrollments')}
        >
          <Ionicons name="school" size={16} color={activeTab === 'enrollments' ? Colors.accent.gold : C.textMuted} style={{ marginRight: 6 }} />
          <Text style={[styles.segmentText, activeTab === 'enrollments' && { color: Colors.accent.gold, fontWeight: '800' }]}>Enrollments</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchSection}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={16} color="#94A3B8" style={{ marginRight: 10 }} />
          <TextInput placeholder="Search..." style={styles.searchInput} placeholderTextColor={C.textMuted} value={searchText} onChangeText={setSearchText} />
        </View>
      </View>

      {activeTab === 'enrollments' && (
        <View style={styles.filtersSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContainer}>
            {/* Status Filter */}
            <TouchableOpacity 
              style={[styles.filterPill, filterStatus !== '' && styles.activeFilterPill]}
              onPress={() => {
                Alert.alert(
                  'Filter by Status',
                  'Select enrollment status:',
                  [
                    { text: 'All', onPress: () => setFilterStatus('') },
                    { text: 'Active', onPress: () => setFilterStatus('active') },
                    { text: 'Promoted', onPress: () => setFilterStatus('promoted') },
                    { text: 'Repeated', onPress: () => setFilterStatus('repeated') },
                    { text: 'Transferred', onPress: () => setFilterStatus('transferred') },
                    { text: 'Graduated', onPress: () => setFilterStatus('graduated') },
                  ]
                );
              }}
            >
              <Text style={[styles.filterPillText, filterStatus !== '' && { color: Colors.accent.gold }]}>
                Status: {filterStatus ? filterStatus.toUpperCase() : 'All'}
              </Text>
              <Ionicons name="chevron-down" size={10} color={filterStatus !== '' ? Colors.accent.gold : C.textMuted} style={{ marginLeft: 4 }} />
            </TouchableOpacity>

            {/* Class Filter */}
            <TouchableOpacity 
              style={[styles.filterPill, filterClassId !== null && styles.activeFilterPill]}
              onPress={() => {
                const classOptions = classes.map(c => ({
                  text: c.class_name,
                  onPress: () => setFilterClassId(c.id)
                }));
                Alert.alert(
                  'Filter by Class',
                  'Select class:',
                  [
                    { text: 'All', onPress: () => setFilterClassId(null) },
                    ...classOptions
                  ]
                );
              }}
            >
              <Text style={[styles.filterPillText, filterClassId !== null && { color: Colors.accent.gold }]}>
                Class: {filterClassId !== null ? (classes.find(c => c.id === filterClassId)?.class_name || 'Selected') : 'All'}
              </Text>
              <Ionicons name="chevron-down" size={10} color={filterClassId !== null ? Colors.accent.gold : C.textMuted} style={{ marginLeft: 4 }} />
            </TouchableOpacity>

            {/* Session Filter */}
            <TouchableOpacity 
              style={[styles.filterPill, filterSessionId !== null && styles.activeFilterPill]}
              onPress={() => {
                const sessionOptions = sessions.map(s => ({
                  text: s.session_name,
                  onPress: () => setFilterSessionId(s.id)
                }));
                Alert.alert(
                  'Filter by Session',
                  'Select academic session:',
                  [
                    { text: 'All', onPress: () => setFilterSessionId(null) },
                    ...sessionOptions
                  ]
                );
              }}
            >
              <Text style={[styles.filterPillText, filterSessionId !== null && { color: Colors.accent.gold }]}>
                Session: {filterSessionId !== null ? (sessions.find(s => s.id === filterSessionId)?.session_name || 'Selected') : 'All'}
              </Text>
              <Ionicons name="chevron-down" size={10} color={filterSessionId !== null ? Colors.accent.gold : C.textMuted} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {activeTab === 'students' ? (
        <FlatList
          data={students.filter(s => {
            const search = searchText.toLowerCase();
            return `${s.first_name} ${s.last_name}`.toLowerCase().includes(search) || (s.registration_number || '').toLowerCase().includes(search);
          })}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={styles.listContent}
          renderItem={renderStudent}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color={C.textMuted} style={{ marginBottom: 6 }} />
              <ThemedText style={styles.emptyText}>No students found</ThemedText>
            </View>
          }
          ListFooterComponent={<Footer themeColor={Colors.accent.gold} onLogout={handleLogout} />}
        />
      ) : (
        <FlatList
          data={enrollments.filter(e => {
            const search = searchText.toLowerCase();
            return `${e.first_name} ${e.last_name}`.toLowerCase().includes(search) || 
                   (e.registration_number || '').toLowerCase().includes(search) ||
                   (e.class_name || '').toLowerCase().includes(search) ||
                   (e.academic_session || '').toLowerCase().includes(search);
          })}
          keyExtractor={(i) => String(i.enrollment_id)}
          contentContainerStyle={styles.listContent}
          refreshing={enrollmentsLoading}
          onRefresh={fetchEnrollments}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              {enrollmentsLoading ? (
                <ActivityIndicator size="small" color={Colors.accent.gold} />
              ) : (
                <>
                  <Ionicons name="school-outline" size={48} color={C.textMuted} style={{ marginBottom: 6 }} />
                  <ThemedText style={styles.emptyText}>No enrollments found</ThemedText>
                </>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.enrollmentCard}>
              <View style={styles.enrollmentHeader}>
                <View style={styles.avatarContainer}>
                  <ThemedText style={styles.avatarText}>{(item.first_name?.[0] || '') + (item.last_name?.[0] || '')}</ThemedText>
                </View>
                <View style={styles.studentInfo}>
                  <ThemedText style={styles.studentName} numberOfLines={1}>{item.first_name} {item.last_name}</ThemedText>
                  <ThemedText style={styles.studentSub}>{item.registration_number || 'No REG'}</ThemedText>
                </View>
                {isOwner && (
                  <TouchableOpacity 
                    style={styles.deleteEnrollBtn} 
                    onPress={() => confirmDeleteEnrollment(item)}
                  >
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </View>
              
              <View style={styles.enrollmentDetails}>
                <View style={styles.detailRow}>
                  <Ionicons name="book-outline" size={12} color={C.textMuted} style={{ marginRight: 6 }} />
                  <ThemedText style={styles.detailText}>{item.class_name}</ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="calendar-outline" size={12} color={C.textMuted} style={{ marginRight: 6 }} />
                  <ThemedText style={styles.detailText}>{item.academic_session}</ThemedText>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: item.enrollment_status === 'active' ? '#22C55E15' : '#F59E0B15' }]}>
                  <Text style={[styles.statusText, { color: item.enrollment_status === 'active' ? '#22C55E' : '#F59E0B' }]}>
                    {item.enrollment_status.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>
          )}
          ListFooterComponent={<Footer themeColor={Colors.accent.gold} onLogout={handleLogout} />}
        />
      )}

      <BulkUploadModal
        visible={bulkUploadVisible}
        onClose={() => setBulkUploadVisible(false)}
        onUploadComplete={(res) => {
          if (res.success) fetchInitialData();
        }}
      />

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <LinearGradient colors={[C.isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)', C.card]} style={styles.modalSheet}>
            <>
              <View style={styles.modalHeader}>
                <View><ThemedText style={styles.modalTitle}>{editingId ? 'Edit Record' : 'Enrollment'}</ThemedText></View>
                <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}><Ionicons name="close" size={20} color={Colors.accent.gold} /></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.formSection}>
                  <ThemedText style={styles.sectionLabel}>IDENTITY</ThemedText>
                  <TextInput style={styles.formInput} value={form.firstName} onChangeText={(t) => setForm({ ...form, firstName: t })} placeholder="First Name" placeholderTextColor={C.textMuted} />
                  <TextInput style={styles.formInput} value={form.lastName} onChangeText={(t) => setForm({ ...form, lastName: t })} placeholder="Last Name" placeholderTextColor={C.textMuted} />
                  <View style={styles.genderSelect}>
                    {['Male', 'Female'].map(g => (
                      <TouchableOpacity key={g} style={[styles.genderOption, form.gender === g && styles.activeGender]} onPress={() => setForm({ ...form, gender: g })}>
                        <ThemedText style={[styles.genderText, form.gender === g && { color: Colors.accent.gold }]}>{g}</ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {!editingId && (
                  <View style={styles.formSection}>
                    <ThemedText style={styles.sectionLabel}>ENROLLMENT</ThemedText>

                    <ThemedText style={styles.formLabel}>CLASS</ThemedText>
                    <TouchableOpacity
                      style={[styles.inputSelector, !!classScope && { opacity: 0.6 }]}
                      onPress={() => !classScope && setShowClassDropdown(!showClassDropdown)}
                      disabled={!!classScope}
                    >
                      <ThemedText style={styles.selectorText}>{classes.find(c => c.id === form.classId)?.class_name || 'Select Class'}</ThemedText>
                      {!classScope && <Ionicons name="chevron-down" size={18} color={Colors.accent.gold} />}
                    </TouchableOpacity>
                    {!!classScope && (
                      <ThemedText style={styles.classLockHint}>You're a class teacher — new students go into your assigned class.</ThemedText>
                    )}
                    {showClassDropdown && !classScope && (
                      <View style={styles.listBox}>
                        <ScrollView nestedScrollEnabled style={{ maxHeight: 150 }}>
                          {classes.map(c => (
                            <TouchableOpacity key={c.id} style={[styles.listItem, form.classId === c.id && styles.listItemActive]} onPress={() => { setForm({ ...form, classId: c.id }); setShowClassDropdown(false); }}>
                              <ThemedText style={[styles.listItemText, form.classId === c.id && { color: Colors.accent.gold, fontWeight: '800' }]}>{c.class_name}</ThemedText>
                              {form.classId === c.id && <Ionicons name="checkmark-circle" size={18} color={Colors.accent.gold} />}
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}

                    <ThemedText style={styles.formLabel}>SESSION</ThemedText>
                    <TouchableOpacity style={styles.inputSelector} onPress={() => setShowSessionDropdown(!showSessionDropdown)}>
                      <ThemedText style={styles.selectorText}>{activeSessionName || 'Select Session'}</ThemedText>
                      <Ionicons name="chevron-down" size={18} color={Colors.accent.gold} />
                    </TouchableOpacity>
                    {showSessionDropdown && (
                      <View style={styles.listBox}>
                        <ScrollView nestedScrollEnabled style={{ maxHeight: 150 }}>
                          {sessions.map(s => (
                            <TouchableOpacity key={s.id} style={[styles.listItem, activeSessionName === s.session_name && styles.listItemActive]} onPress={() => { setActiveSessionName(s.session_name); setShowSessionDropdown(false); }}>
                              <ThemedText style={[styles.listItemText, activeSessionName === s.session_name && { color: Colors.accent.gold, fontWeight: '800' }]}>{s.session_name}</ThemedText>
                              {activeSessionName === s.session_name && <Ionicons name="checkmark-circle" size={18} color={Colors.accent.gold} />}
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                )}
                <View style={styles.formSection}>
                  <ThemedText style={styles.sectionLabel}>CONTACT</ThemedText>
                  <TextInput style={styles.formInput} value={form.email} onChangeText={(t) => setForm({ ...form, email: t })} placeholder="Email" placeholderTextColor={C.textMuted} keyboardType="email-address" />
                  <TextInput style={styles.formInput} value={form.phone} onChangeText={(t) => setForm({ ...form, phone: t })} placeholder="Phone" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
                </View>
                <CustomButton title={saving ? "SAVING..." : "SAVE RECORD"} onPress={saveStudent} loading={saving} variant="premium" style={{ marginTop: 20 }} />
                 {editingId && isOwner && (
                   <View style={styles.dangerZone}>
                     <ThemedText style={styles.dangerTitle}>DANGER ZONE</ThemedText>
                     <TouchableOpacity 
                       style={[styles.dangerButton, { borderColor: '#EF4444' }]} 
                       onPress={() => confirmDelete()}
                     >
                       <Ionicons name="trash-outline" size={16} color="#EF4444" style={{ marginRight: 6 }} />
                       <Text style={[styles.dangerButtonText, { color: '#EF4444' }]}>Delete Student Permanently</Text>
                     </TouchableOpacity>
                   </View>
                 )}
               </ScrollView>
            </>
          </LinearGradient>
        </View>
      </Modal>

      {statusAlert.visible && (
        <CustomAlert
          type={statusAlert.type}
          title={statusAlert.title}
          message={statusAlert.message}
          onConfirm={statusAlert.onConfirm}
          confirmLabel={statusAlert.confirmLabel}
          onClose={() => setStatusAlert({ ...statusAlert, visible: false })}
        />
      )}
    </ThemedView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    mainWrapper: { flex: 1, backgroundColor: C.background },
    loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: Colors.accent.gold, marginTop: 10, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
    hero: { height: isTiny ? 180 : 220, width: '100%' },
    heroOverlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24, paddingTop: Platform.OS === 'ios' ? 50 : 40 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    backButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
    addButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center' },
    actionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
    heroContent: { marginTop: 'auto', marginBottom: 16 },
    heroSubtitle: { color: Colors.accent.gold, fontSize: 9, fontWeight: '800', letterSpacing: 2 },
    heroMainTitle: { color: C.text, fontSize: isTiny ? 24 : 28, fontWeight: '900', letterSpacing: -1 },
    searchSection: { paddingHorizontal: isTiny ? 16 : 24, marginTop: -10, marginBottom: 16 },
    searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: C.inputBorder },
    searchInput: { flex: 1, color: C.inputText, fontSize: 13, fontWeight: '600' },
    listContent: { paddingHorizontal: isTiny ? 16 : 24, paddingBottom: 60 },
    studentCard: { backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.cardBorder },
    cardHeader: { flexDirection: 'row', alignItems: 'center' },
    avatarContainer: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.actionIconWrap, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.accent.gold },
    avatarText: { color: Colors.accent.gold, fontSize: 12, fontWeight: '800' },
    studentInfo: { flex: 1, marginLeft: 12 },
    studentName: { fontSize: 13, fontWeight: '800', color: C.text },
    studentSub: { fontSize: 10, color: C.textSecondary },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'flex-end' },
    modalSheet: { height: '85%', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
    modalTitle: { color: C.text, fontSize: 18, fontWeight: '900' },
    closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    formSection: { marginBottom: 22 },
    sectionLabel: { color: C.textLabel, fontSize: 9, fontWeight: '800', marginBottom: 8 },
    formInput: { backgroundColor: C.inputBg, borderRadius: 12, padding: 12, color: C.inputText, fontSize: 13, borderWidth: 1, borderColor: C.inputBorder, marginBottom: 10 },
    genderSelect: { flexDirection: 'row', gap: 10 },
    genderOption: { flex: 1, height: 40, borderRadius: 10, backgroundColor: C.inputBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.inputBorder },
    activeGender: { borderColor: Colors.accent.gold, backgroundColor: Colors.accent.gold + '10' },
    genderText: { color: C.textMuted, fontSize: 12, fontWeight: '700' },
    inputSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.inputBg, borderRadius: 12, paddingHorizontal: 16, height: 48, borderWidth: 1, borderColor: C.inputBorder, marginBottom: 10 },
    selectorText: { color: C.inputText, fontSize: 13, fontWeight: '700' },
    listBox: { backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.inputBorder, overflow: 'hidden', marginBottom: 10 },
    listItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: C.divider, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    listItemActive: { backgroundColor: Colors.accent.gold + '10' },
    listItemText: { fontSize: 13, color: C.textSecondary, fontWeight: '600' },
    formLabel: { fontSize: 9, fontWeight: '800', color: C.textLabel, marginBottom: 6 },
    classLockHint: { fontSize: 9.5, color: C.textMuted, marginTop: -6, marginBottom: 10, lineHeight: 13 },
    noticeBox: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginHorizontal: isTiny ? 16 : 24, marginTop: -20, marginBottom: 16, borderWidth: 1, borderColor: Colors.accent.gold + '20' },
    noticeTitle: { color: Colors.accent.gold, fontSize: 12, fontWeight: '900', marginBottom: 6 },
    noticeText: { color: C.text, fontSize: 12, lineHeight: 18 },
    dangerZone: { marginTop: 24, padding: 16, borderRadius: 16, backgroundColor: C.isDark ? '#EF444408' : '#EF444403', borderStyle: 'dashed', borderWidth: 1, borderColor: '#EF444430', marginBottom: 20 },
    dangerTitle: { color: '#EF4444', fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 12 },
    dangerButtons: { flexDirection: 'row', gap: 10 },
    dangerButton: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: C.isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.8)' },
    dangerButtonText: { fontSize: 12, fontWeight: '700' },
    segmentedControl: { flexDirection: 'row', backgroundColor: C.inputBg, marginHorizontal: isTiny ? 16 : 24, borderRadius: 16, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: C.inputBorder },
    segmentButton: { flex: 1, height: 38, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    activeSegment: { backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
    segmentText: { fontSize: 13, fontWeight: '600', color: C.textMuted },
    filtersSection: { marginBottom: 12, paddingHorizontal: isTiny ? 16 : 24 },
    filtersContainer: { gap: 8 },
    filterPill: { height: 32, borderRadius: 10, paddingHorizontal: 12, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    activeFilterPill: { borderColor: Colors.accent.gold, backgroundColor: Colors.accent.gold + '10' },
    filterPillText: { fontSize: 11, fontWeight: '700', color: C.textSecondary },
    enrollmentCard: { backgroundColor: C.card, borderRadius: 20, padding: 16, marginHorizontal: isTiny ? 16 : 24, marginBottom: 12, borderWidth: 1, borderColor: C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
    enrollmentHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
    deleteEnrollBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.isDark ? '#EF444415' : '#EF444408', justifyContent: 'center', alignItems: 'center' },
    enrollmentDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 12 },
    detailRow: { flexDirection: 'row', alignItems: 'center' },
    detailText: { fontSize: 12, color: C.textSecondary, fontWeight: '600' },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
    statusText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 },
    emptyText: { color: C.textMuted, fontSize: 14, fontWeight: '600' },
  });
}