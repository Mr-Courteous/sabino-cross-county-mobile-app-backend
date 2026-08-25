import { View, TextInput, TouchableOpacity, Text, ActivityIndicator, ScrollView, Alert, Platform, useWindowDimensions, StyleSheet } from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/design-system';
import { Ionicons } from '@expo/vector-icons';

interface ScoreRecord {
  student_id: number; first_name: string; last_name: string; registration_number: string;
  ca1_score?: number; ca2_score?: number; ca3_score?: number; ca4_score?: number; exam_score?: number; teacher_remark?: string;
}

export default function ManageScoresScreen() {
  const { width } = useWindowDimensions();
  const isTiny = width < 300;
  
  const [academicYears, setAcademicYears] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedTerm, setSelectedTerm] = useState('1');
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [scoreRecords, setScoreRecords] = useState<ScoreRecord[]>([]);
  const [scores, setScores] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadInitialData(); }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      let token = Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
      const headers = { 'Content-Type': 'application/json', ...(token && { 'Authorization': `Bearer ${token}` }) };
      const [y, c, s] = await Promise.all([
        fetch(`${API_BASE_URL}/academic-years`, { headers }).then(r => r.json()),
        fetch(`${API_BASE_URL}/classes`, { headers }).then(r => r.json()),
        fetch(`${API_BASE_URL}/classes/subjects`, { headers }).then(r => r.json())
      ]);
      setAcademicYears(y.data || []);
      setClasses(c.data || []);
      setSubjects(s.data || []);
      if (y.data?.length) setSelectedYear(y.data[0].year);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (selectedYear && selectedClassId && selectedSubjectId) fetchScores();
  }, [selectedYear, selectedTerm, selectedClassId, selectedSubjectId]);

  const fetchScores = async () => {
    try {
      let token = Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
      const r = await fetch(`${API_BASE_URL}/scores/class?classId=${selectedClassId}&subjectId=${selectedSubjectId}&academicYear=${selectedYear}&term=${selectedTerm}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await r.json();
      setScoreRecords(data.data || []);
      const map: any = {};
      (data.data || []).forEach((rec: any) => {
        ['ca1_score', 'ca2_score', 'ca3_score', 'ca4_score', 'exam_score'].forEach(f => {
          map[`${rec.student_id}-${f}`] = rec[f];
        });
      });
      setScores(map);
    } catch (e: any) { setError(e.message); }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const payload = scoreRecords.map(r => ({
        student_id: r.student_id, subject_id: selectedSubjectId, class_id: selectedClassId,
        academic_year: selectedYear, term: parseInt(selectedTerm),
        ca1_score: scores[`${r.student_id}-ca1_score`],
        ca2_score: scores[`${r.student_id}-ca2_score`],
        ca3_score: scores[`${r.student_id}-ca3_score`],
        ca4_score: scores[`${r.student_id}-ca4_score`],
        exam_score: scores[`${r.student_id}-exam_score`],
      }));
      let token = Platform.OS !== 'web' ? await SecureStore.getItemAsync('userToken') : localStorage.getItem('userToken');
      await fetch(`${API_BASE_URL}/scores/bulk-upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ scores: payload })
      });
      Alert.alert('Success', 'Scores synchronized.');
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <ThemedView style={styles.center}><ActivityIndicator color="#FACC15" /></ThemedView>;

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: isTiny ? 12 : 16 }}>
        <View style={{ marginBottom: 16 }}>
          <ThemedText type="subtitle" style={{ fontSize: isTiny ? 16 : 18 }}>Manage Scores</ThemedText>
          <ThemedText style={{ opacity: 0.6, fontSize: 11 }}>Update student academic performance</ThemedText>
        </View>

        <View style={styles.filterBox}>
          <ThemedText style={styles.filterLabel}>Year & Term</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            {academicYears.map(y => (
              <TouchableOpacity key={y.id} style={[styles.pill, selectedYear === y.year && styles.pillActive]} onPress={() => setSelectedYear(y.year)}>
                <Text style={[styles.pillText, selectedYear === y.year && styles.pillTextActive]}>{y.year}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.row}>
            {['1', '2', '3'].map(t => (
              <TouchableOpacity key={t} style={[styles.pill, { flex: 1 }, selectedTerm === t && styles.pillActive]} onPress={() => setSelectedTerm(t)}>
                <Text style={[styles.pillText, selectedTerm === t && styles.pillTextActive]}>T{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.filterBox}>
          <ThemedText style={styles.filterLabel}>Class & Subject</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            {classes.map(c => (
              <TouchableOpacity key={c.id} style={[styles.pill, selectedClassId === c.id && styles.pillActive]} onPress={() => setSelectedClassId(c.id)}>
                <Text style={[styles.pillText, selectedClassId === c.id && styles.pillTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {subjects.map(s => (
              <TouchableOpacity key={s.id} style={[styles.pill, selectedSubjectId === s.id && styles.pillActive]} onPress={() => setSelectedSubjectId(s.id)}>
                <Text style={[styles.pillText, selectedSubjectId === s.id && styles.pillTextActive]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {selectedClassId && selectedSubjectId ? (
          <View>
            <View style={styles.tableHeader}>
              <View style={{ flex: 2 }}><Text style={styles.headerText}>STUDENT</Text></View>
              {['C1', 'C2', 'C3', 'EX'].map(h => <View key={h} style={{ flex: 1, alignItems: 'center' }}><Text style={styles.headerText}>{h}</Text></View>)}
            </View>
            {scoreRecords.map(rec => (
              <View key={rec.student_id} style={styles.rowItem}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.studentName} numberOfLines={1}>{rec.first_name} {rec.last_name}</Text>
                  <Text style={styles.studentReg}>{rec.registration_number}</Text>
                </View>
                {['ca1_score', 'ca2_score', 'ca3_score', 'exam_score'].map(f => (
                  <View key={f} style={{ flex: 1, padding: 2 }}>
                    <TextInput
                      style={styles.input} keyboardType="numeric" maxLength={3}
                      value={scores[`${rec.student_id}-${f}`]?.toString() || ''}
                      onChangeText={t => setScores({ ...scores, [`${rec.student_id}-${f}`]: t })}
                    />
                  </View>
                ))}
              </View>
            ))}
            <TouchableOpacity style={styles.saveBtn} onPress={saveAll} disabled={saving}>
              {saving ? <ActivityIndicator color="#000" size="small" /> : <Text style={styles.saveBtnText}>SYNC ALL SCORES</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.empty}><Ionicons name="filter" size={32} color="#94A3B8" /><Text style={styles.emptyText}>Select class and subject to view entries</Text></View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterBox: { marginBottom: 14, backgroundColor: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 12 },
  filterLabel: { fontSize: 10, fontWeight: '900', color: '#94A3B8', marginBottom: 8, letterSpacing: 1 },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', marginRight: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  pillActive: { backgroundColor: '#FACC15', borderColor: '#FACC15' },
  pillText: { fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  pillTextActive: { color: '#000' },
  row: { flexDirection: 'row', gap: 6 },
  tableHeader: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', padding: 8, borderRadius: 8, marginBottom: 6 },
  headerText: { fontSize: 9, fontWeight: '900', color: '#64748B' },
  rowItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', padding: 8, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  studentName: { fontSize: 12, fontWeight: '700', color: '#fff' },
  studentReg: { fontSize: 9, color: '#64748B' },
  input: { backgroundColor: '#000', color: '#FACC15', textAlign: 'center', padding: 4, borderRadius: 4, fontSize: 11, fontWeight: '800' },
  saveBtn: { backgroundColor: '#FACC15', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#000', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#64748B', fontSize: 11, marginTop: 10, textAlign: 'center' }
});
