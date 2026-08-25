import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, SectionList,
  Platform, ScrollView, useWindowDimensions
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { Spacing } from '@/constants/design-system';

const AVAILABLE_CLASSES = [
  "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6",
  "JSS 1", "JSS 2", "JSS 3", "SSS 1", "SSS 2", "SSS 3"
];

export default function StudentList() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTiny = width < 300;
  
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { initialLoad(); }, []);

  const initialLoad = async () => {
    setLoading(true);
    setError(null);
    try {
      let token = Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
      const response = await fetch(`${API_BASE_URL}/students`, {
        headers: { 'Content-Type': 'application/json', ...(token && { 'Authorization': `Bearer ${token}` }) },
      });
      const data = await response.json();
      if (response.ok && data.success) setStudents(data.data);
      else throw new Error(data.message || "Fetch failed");
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const groupedData = useMemo(() => {
    const filtered = students.filter((s: any) => 
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.admission_number?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return AVAILABLE_CLASSES
      .filter(className => !selectedClass || className === selectedClass)
      .map(className => ({ title: className, data: filtered.filter((s: any) => s.class_name_text === className) }))
      .filter(section => section.data.length > 0);
  }, [students, searchQuery, selectedClass]);

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#FACC15" />
      <Text style={styles.loadingText}>Syncing Registry...</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient colors={['#1E293B', '#0F172A']} style={[styles.headerGradient, { paddingTop: isTiny ? 40 : 50 }]}>
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="arrow-back" size={18} color="#fff" /></TouchableOpacity>
          <Text style={[styles.headerTitle, { fontSize: isTiny ? 16 : 18 }]}>Registry</Text>
          <TouchableOpacity onPress={() => initialLoad()} style={styles.backBtn}><Ionicons name="refresh" size={18} color="#fff" /></TouchableOpacity>
        </View>

        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="#94A3B8" style={{ marginLeft: 12 }} />
          <TextInput style={styles.searchInput} placeholder="Search..." placeholderTextColor="#94A3B8" value={searchQuery} onChangeText={setSearchQuery} />
        </View>

        <View style={styles.classSelectorWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.classSelectorContent}>
            <TouchableOpacity style={[styles.classTab, !selectedClass && styles.classTabActive]} onPress={() => setSelectedClass(null)}>
              <Text style={[styles.classTabText, !selectedClass && styles.classTabTextActive]}>All</Text>
            </TouchableOpacity>
            {AVAILABLE_CLASSES.map((cls) => (
              <TouchableOpacity key={cls} style={[styles.classTab, selectedClass === cls && styles.classTabActive]} onPress={() => setSelectedClass(cls)}>
                <Text style={[styles.classTabText, selectedClass === cls && styles.classTabTextActive]}>{cls}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </LinearGradient>

      {error ? (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={40} color="#F87171" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => initialLoad()}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
        </View>
      ) : (
        <SectionList
          sections={groupedData}
          keyExtractor={(item) => item.id.toString()}
          stickySectionHeadersEnabled={true}
          renderItem={({ item }) => (
            <View style={styles.studentCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.first_name?.[0] || '?'}</Text></View>
              <View style={styles.studentInfo}>
                <Text style={[styles.studentName, { fontSize: isTiny ? 13 : 14 }]}>{item.first_name} {item.last_name}</Text>
                <Text style={styles.studentReg}>{item.admission_number || 'N/A'}</Text>
              </View>
            </View>
          )}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}><Text style={styles.sectionHeaderTitle}>{title}</Text></View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={50} color="#CBD5E1" />
              <Text style={[styles.emptyText, { fontSize: isTiny ? 14 : 16 }]}>Registry Empty</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerGradient: { paddingBottom: 20, paddingHorizontal: 16, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  headerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 },
  headerTitle: { fontWeight: '900', color: '#fff' },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, height: 44 },
  searchInput: { flex: 1, paddingHorizontal: 10, fontSize: 13, color: '#1E293B', fontWeight: '600' },
  classSelectorWrapper: { marginTop: 12 },
  classSelectorContent: { paddingRight: 10 },
  classTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', marginRight: 6 },
  classTabActive: { backgroundColor: '#FACC15' },
  classTabText: { color: '#CBD5E1', fontWeight: '700', fontSize: 11 },
  classTabTextActive: { color: '#0F172A' },
  sectionHeader: { backgroundColor: '#F1F5F9', paddingHorizontal: 16, paddingVertical: 8 },
  sectionHeaderTitle: { fontSize: 11, fontWeight: '900', color: '#64748B', textTransform: 'uppercase' },
  studentCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 14, marginVertical: 5, padding: 12, borderRadius: 12 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FACC15', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontWeight: 'bold', fontSize: 13 },
  studentInfo: { marginLeft: 12 },
  studentName: { fontWeight: '700' },
  studentReg: { fontSize: 11, color: '#94A3B8' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { color: '#64748B', textAlign: 'center', marginVertical: 12, fontSize: 14, fontWeight: '600' },
  retryBtn: { backgroundColor: '#0F172A', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, marginTop: 10 },
  retryText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { fontWeight: '900', color: '#1E293B', marginTop: 15 },
  loadingText: { marginTop: 8, color: '#64748B', fontSize: 12 }
});