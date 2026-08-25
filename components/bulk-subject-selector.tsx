import React, { useState, useCallback, useMemo } from 'react';
import {
  Modal, View, TouchableOpacity, StyleSheet, FlatList, TextInput, ActivityIndicator, Platform, useWindowDimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/design-system';
import { CustomButton } from './custom-button';
import { useAppColors } from '@/hooks/use-app-colors';
import { ThemedText } from './themed-text';

interface Subject { id: number; name: string; category?: string; }
interface BulkSubjectSelectorProps {
  visible: boolean; subjects: Subject[]; selectedSubjectIds: number[];
  onSelectionChange: (selectedIds: number[]) => void; onConfirm: (selectedSubjects: Subject[]) => void; onCancel: () => void;
  loading?: boolean; classId?: number; sessionName?: string; term?: number;
}

export const BulkSubjectSelector: React.FC<BulkSubjectSelectorProps> = ({
  visible, subjects, selectedSubjectIds, onSelectionChange, onConfirm, onCancel, loading = false, classId, sessionName, term,
}) => {
  const C = useAppColors();
  const { width } = useWindowDimensions();
  const isTiny = width < 300;
  const styles = useMemo(() => makeStyles(C, isTiny), [C.scheme, isTiny]);
  const [searchQuery, setSearchQuery] = useState('');
  const [initializing, setInitializing] = useState(false);

  const filtered = subjects.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleConfirm = () => {
    setInitializing(true);
    onConfirm(subjects.filter(s => selectedSubjectIds.includes(s.id)));
    setTimeout(() => setInitializing(false), 1000);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel}><Ionicons name="close" size={24} color={Colors.accent.gold} /></TouchableOpacity>
          <ThemedText style={styles.title}>Bulk Enrollment</ThemedText>
          <View style={{ width: 24 }} />
        </View>

        {classId && (
          <View style={styles.info}>
            <Ionicons name="information-circle-outline" size={14} color={Colors.accent.gold} />
            <ThemedText style={styles.infoText}>{sessionName} • Term {term}</ThemedText>
          </View>
        )}

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={C.textMuted} />
          <TextInput style={styles.input} placeholder="Search subjects..." placeholderTextColor={C.textMuted} value={searchQuery} onChangeText={setSearchQuery} />
        </View>

        <TouchableOpacity style={[styles.selectAll, selectedSubjectIds.length > 0 && styles.selectAllActive]} onPress={() => onSelectionChange(selectedSubjectIds.length === filtered.length ? [] : filtered.map(s => s.id))}>
          <Ionicons name={selectedSubjectIds.length === filtered.length ? 'checkbox' : 'square-outline'} size={18} color={Colors.accent.gold} />
          <ThemedText style={styles.selectAllText}>Select All ({filtered.length})</ThemedText>
        </TouchableOpacity>

        <FlatList
          data={filtered}
          keyExtractor={item => item.id.toString()}
          renderItem={({ item }) => {
            const isSelected = selectedSubjectIds.includes(item.id);
            return (
              <TouchableOpacity style={[styles.item, isSelected && styles.itemSelected]} onPress={() => onSelectionChange(isSelected ? selectedSubjectIds.filter(id => id !== item.id) : [...selectedSubjectIds, item.id])}>
                <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={20} color={isSelected ? Colors.accent.gold : C.textMuted} />
                <View style={{ flex: 1 }}><ThemedText style={styles.itemName}>{item.name}</ThemedText></View>
              </TouchableOpacity>
            );
          }}
          style={styles.list}
        />

        <View style={styles.footer}>
          <ThemedText style={styles.summary}>{selectedSubjectIds.length} Selected</ThemedText>
          <View style={styles.actions}>
            <View style={{ flex: 1 }}><CustomButton title="Cancel" onPress={onCancel} variant="outline" /></View>
            <View style={{ flex: 2 }}><CustomButton title={initializing ? '...' : `Add (${selectedSubjectIds.length})`} onPress={handleConfirm} variant="premium" disabled={!selectedSubjectIds.length || loading || initializing} /></View>
          </View>
        </View>

        {(loading || initializing) && <View style={styles.overlay}><ActivityIndicator size="large" color={Colors.accent.gold} /></View>}
      </View>
    </Modal>
  );
};

const makeStyles = (C: any, isTiny: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingTop: Platform.OS === 'ios' ? 44 : 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.divider },
  title: { color: C.text, fontSize: isTiny ? 15 : 17, fontWeight: '900', textAlign: 'center' },
  info: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginVertical: 8, padding: 8, backgroundColor: 'rgba(250,204,21,0.05)', borderRadius: 10 },
  infoText: { color: Colors.accent.gold, fontSize: 10, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderRadius: 10, paddingHorizontal: 10, marginHorizontal: 16, marginVertical: 8, borderWidth: 1, borderColor: C.inputBorder, height: 40 },
  input: { flex: 1, marginLeft: 8, color: C.inputText, fontSize: 13 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginHorizontal: 16, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 8 },
  selectAllActive: { backgroundColor: 'rgba(250,204,21,0.05)' },
  selectAllText: { color: C.text, fontSize: 12, fontWeight: '700' },
  list: { flex: 1, paddingHorizontal: 16 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 6, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder },
  itemSelected: { backgroundColor: 'rgba(250,204,21,0.05)', borderColor: 'rgba(250,204,21,0.2)' },
  itemName: { color: C.text, fontSize: 13, fontWeight: '700' },
  footer: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.divider, backgroundColor: C.modalBg },
  summary: { color: C.textSecondary, fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 10 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
});
