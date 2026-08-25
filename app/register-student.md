import React, { useState, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions, ImageBackground, RefreshControl
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { Colors } from '@/constants/design-system';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';

const { width } = Dimensions.get('window');

export default function RegisterStudent() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [students, setStudents] = useState([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [classes, setClasses] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(false);

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

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    registrationNumber: '',
    gender: 'Male'
  });

  useEffect(() => {
    initializeData();
  }, []);

  const initializeData = async () => {
    setLoadingFilters(true);
    await Promise.all([
      fetchClassesAndSessions(),
      fetchStudents()
    ]);
    setLoadingFilters(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await initializeData();
    setRefreshing(false);
  };

  const getToken = async () => {
    return Platform.OS !== 'web'
      ? await SecureStore.getItemAsync('userToken')
      : localStorage.getItem('userToken');
  };

  const fetchClassesAndSessions = async () => {
    try {
      const token = await getToken();
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      const [classRes, sessionRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/classes`, { headers }),
        fetch(`${API_BASE_URL}/api/academic-sessions`, { headers })
      ]);

      const classData = await classRes.json();
      const sessionData = await sessionRes.json();

      if (classData.success) {
        setClasses(classData.data);
        if (classData.data.length > 0 && !selectedClass) {
          setSelectedClass(classData.data[0].id);
        }
      }

      if (sessionData.success) {
        setSessions(sessionData.data);
        const activeSession = sessionData.data.find((s: any) => s.is_active);
        if (activeSession) {
          setSelectedSession(activeSession.id);
        } else if (sessionData.data.length > 0 && !selectedSession) {
          setSelectedSession(sessionData.data[0].id);
        }
      }
    } catch (e) {
      console.error("Error fetching filters:", e);
    }
  };

  const fetchStudents = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/students`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) setStudents(result.data.slice(0, 10)); // Just recent ones
    } catch (e) {
      console.error("Fetch error", e);
    }
  };

  const handleSave = async () => {
    if (!form.firstName || !form.lastName) {
      setStatusAlert({
        visible: true,
        type: 'warning',
        title: 'Input Missing',
        message: 'Formal names are mandatory for student registration.'
      });
      return;
    }

    if (!selectedClass || !selectedSession) {
      setStatusAlert({
        visible: true,
        type: 'warning',
        title: 'Context Missing',
        message: 'Please select an academic class and session to proceed.'
      });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();

      if (editingId) {
        const url = `${API_BASE_URL}/api/students/${editingId}`;
        const response = await fetch(url, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(form)
        });

        const result = await response.json();
        if (result.success) {
          setForm({ firstName: '', lastName: '', email: '', registrationNumber: '', gender: 'Male' });
          setEditingId(null);
          fetchStudents();
          setStatusAlert({
            visible: true,
            type: 'success',
            title: 'Profile Updated',
            message: 'Student record has been successfully synchronized.'
          });
        } else {
          setStatusAlert({
            visible: true,
            type: 'error',
            title: 'Update Failed',
            message: result.message || "The system could not process the update."
          });
        }
      } else {
        const payload = {
          students: [
            {
              firstName: form.firstName,
              lastName: form.lastName,
              email: form.email || null,
              registrationNumber: form.registrationNumber || null,
              gender: form.gender || null,
              classId: selectedClass,
              sessionId: selectedSession
            }
          ]
        };

        const response = await fetch(`${API_BASE_URL}/api/students/bulk`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.success) {
          setForm({ firstName: '', lastName: '', email: '', registrationNumber: '', gender: 'Male' });
          fetchStudents();
          setStatusAlert({
            visible: true,
            type: 'success',
            title: 'Registration Successful',
            message: 'Student has been registered and enrolled in the designated class.'
          });
        } else {
          setStatusAlert({
            visible: true,
            type: 'error',
            title: 'Enrollment Error',
            message: result.message || "System was unable to finalize the registration."
          });
        }
      }
    } catch (error) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Network Fault',
        message: 'Connectivity issues detected during synchronization.'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    setStatusAlert({
      visible: true,
      type: 'warning',
      title: 'Delete Record',
      message: `Are you sure you want to permanently remove ${name}?`,
      onConfirm: async () => {
        const token = await getToken();
        await fetch(`${API_BASE_URL}/api/students/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        fetchStudents();
      }
    });
  };

  const startEdit = (student: any) => {
    setEditingId(student.id);
    setForm({
      firstName: student.first_name,
      lastName: student.last_name,
      email: student.email || '',
      registrationNumber: student.registration_number || '',
      gender: student.gender || 'Male'
    });
    // Scroll to top
  };

  return (
    <ThemedView style={styles.mainWrapper}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>

        <ImageBackground
          style={styles.hero}
        >
          <LinearGradient
            colors={['rgba(15, 23, 42, 0.6)', Colors.accent.navy]}
            style={styles.heroOverlay}
          >
            <View style={styles.header}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <ThemedText style={styles.headerTitle}>Student Portal</ThemedText>
              <View style={{ width: 44 }} />
            </View>

            <View style={styles.heroContent}>
              <ThemedText style={styles.heroSubtitle}>ACADEMIC ONBOARDING</ThemedText>
              <ThemedText style={styles.heroMainTitle}>{editingId ? 'Modify Profile' : 'Student Registry'}</ThemedText>
            </View>
          </LinearGradient>
        </ImageBackground>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
        >
          {statusAlert.visible && (
            <CustomAlert
              type={statusAlert.type}
              title={statusAlert.title}
              message={statusAlert.message}
              onClose={() => setStatusAlert({ ...statusAlert, visible: false })}
              onConfirm={statusAlert.onConfirm}
              style={styles.alert}
            />
          )}

          {/* ACADEMIC CONTEXT CARD */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="school-outline" size={20} color={Colors.accent.gold} />
              <ThemedText style={styles.cardLabel}>ACADEMIC ASSIGNMENT</ThemedText>
            </View>

            {loadingFilters ? (
              <ActivityIndicator color={Colors.accent.gold} style={{ marginVertical: 20 }} />
            ) : (
              <>
                <View style={styles.filterSection}>
                  <ThemedText style={styles.subLabel}>Target Class</ThemedText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    {classes.map((cls: any) => (
                      <TouchableOpacity
                        key={cls.id}
                        style={[styles.filterChip, selectedClass === cls.id && styles.filterChipActive]}
                        onPress={() => setSelectedClass(cls.id)}
                      >
                        <ThemedText style={[styles.filterChipText, selectedClass === cls.id && styles.filterChipTextActive]}>
                          {cls.class_name}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.filterSection}>
                  <ThemedText style={styles.subLabel}>Academic Session</ThemedText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    {sessions.map((session: any) => (
                      <TouchableOpacity
                        key={session.id}
                        style={[styles.filterChip, selectedSession === session.id && styles.filterChipActive]}
                        onPress={() => setSelectedSession(session.id)}
                      >
                        <ThemedText style={[styles.filterChipText, selectedSession === session.id && styles.filterChipTextActive]}>
                          {session.session_name}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </>
            )}
          </View>

          {/* REGISTRATION FORM CARD */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="person-add-outline" size={20} color={Colors.accent.gold} />
              <ThemedText style={styles.cardLabel}>BIOMETRIC & IDENTITY DATA</ThemedText>
            </View>

            <View style={styles.inputRow}>
              <View style={{ flex: 1 }}>
                <CustomInput
                  label="First Name *"
                  placeholder="John"
                  value={form.firstName}
                  onChangeText={(t) => setForm({ ...form, firstName: t })}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <CustomInput
                  label="Last Name *"
                  placeholder="Doe"
                  value={form.lastName}
                  onChangeText={(t) => setForm({ ...form, lastName: t })}
                />
              </View>
            </View>

            <CustomInput
              label="Registration ID"
              placeholder="STU-2024-001"
              value={form.registrationNumber}
              onChangeText={(t) => setForm({ ...form, registrationNumber: t })}
              containerStyle={{ marginTop: 12 }}
            />

            <CustomInput
              label="Email Address (Optional)"
              placeholder="student@academy.com"
              value={form.email}
              onChangeText={(t) => setForm({ ...form, email: t })}
              keyboardType="email-address"
              containerStyle={{ marginTop: 12 }}
            />

            <View style={styles.formActions}>
              <CustomButton
                title={loading ? "SYNCHRONIZING..." : (editingId ? "UPDATE RECORD" : "FINALIZE REGISTRATION")}
                onPress={handleSave}
                loading={loading}
                variant="premium"
                style={{ flex: 1 }}
              />
              {editingId && (
                <TouchableOpacity
                  onPress={() => { setEditingId(null); setForm({ firstName: '', lastName: '', email: '', registrationNumber: '', gender: 'Male' }) }}
                  style={styles.cancelLink}
                >
                  <ThemedText style={styles.cancelText}>CANCEL</ThemedText>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* RECENT RECORDS */}
          <ThemedText style={styles.sectionTitle}>RECENT REGISTRY ENTRIES</ThemedText>
          {students.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={48} color="rgba(255,255,255,0.05)" />
              <ThemedText style={styles.emptyText}>No recent registrations found</ThemedText>
            </View>
          ) : (
            students.map((item: any) => (
              <View key={item.id} style={styles.studentItem}>
                <View style={styles.studentAvatar}>
                  <ThemedText style={styles.avatarText}>{(item.first_name?.[0] || '') + (item.last_name?.[0] || '')}</ThemedText>
                </View>
                <View style={styles.studentDetails}>
                  <ThemedText style={styles.studentName}>{item.first_name} {item.last_name}</ThemedText>
                  <ThemedText style={styles.studentSub}>{item.registration_number || 'NO ID ASSIGNED'}</ThemedText>
                </View>
                <View style={styles.actionRow}>
                  <TouchableOpacity onPress={() => startEdit(item)} style={styles.actionBtn}>
                    <Ionicons name="pencil" size={16} color={Colors.accent.gold} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(item.id, `${item.first_name} ${item.last_name}`)} style={[styles.actionBtn, { borderColor: 'rgba(239, 68, 68, 0.2)' }]}>
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1, backgroundColor: Colors.accent.navy },
  hero: { height: 280, width: '100%' },
  heroOverlay: { flex: 1, paddingHorizontal: 24, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 },
  backButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255, 255, 255, 0.1)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },

  heroContent: { marginTop: 'auto', marginBottom: 30 },
  heroSubtitle: { color: Colors.accent.gold, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  heroMainTitle: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', letterSpacing: -1 },

  scrollView: { flex: 1, marginTop: -30 },
  scrollContent: { padding: 20, paddingBottom: 60 },
  alert: { marginBottom: 20 },

  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 32,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 24
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  cardLabel: { color: '#64748B', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  subLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '700', marginBottom: 12, marginLeft: 4 },

  filterSection: { marginBottom: 20 },
  chipScroll: { marginHorizontal: -4 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)'
  },
  filterChipActive: { backgroundColor: Colors.accent.gold, borderColor: Colors.accent.gold },
  filterChipText: { fontSize: 12, fontWeight: '700', color: '#94A3B8' },
  filterChipTextActive: { color: Colors.accent.navy },

  inputRow: { flexDirection: 'row' },
  formActions: { marginTop: 24, gap: 16 },
  cancelLink: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { color: '#EF4444', fontSize: 12, fontWeight: '900', letterSpacing: 1 },

  sectionTitle: { fontSize: 12, fontWeight: '800', color: Colors.accent.gold, letterSpacing: 1.5, marginTop: 20, marginBottom: 16, marginLeft: 8 },
  studentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    padding: 16,
    borderRadius: 24,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)'
  },
  studentAvatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(250, 204, 21, 0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  avatarText: { color: Colors.accent.gold, fontSize: 14, fontWeight: '900' },
  studentDetails: { flex: 1, gap: 2 },
  studentName: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  studentSub: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { color: 'rgba(255,255,255,0.2)', fontSize: 13, fontWeight: '600' }
});