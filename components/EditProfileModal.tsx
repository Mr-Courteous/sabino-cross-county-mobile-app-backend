import React, { useState, useEffect, useMemo } from 'react';
import {
    View, TextInput, TouchableOpacity, StyleSheet, Modal,
    ScrollView, ActivityIndicator, Alert, Platform, Image, useWindowDimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { useAppColors } from '@/hooks/use-app-colors';
import { ThemedText } from './themed-text';
import { CustomButton } from './custom-button';
import { Colors } from '@/constants/design-system';

interface StudentData {
    id: number; school_id: number; first_name: string; last_name: string; email: string;
    registration_number: string; phone?: string; date_of_birth?: string; gender?: string; photo?: string; address?: string;
}

interface EditProfileModalProps {
    visible: boolean; onClose: () => void; student: StudentData; onUpdate: (updatedStudent: StudentData) => void;
}

export default function EditProfileModal({ visible, onClose, student, onUpdate }: EditProfileModalProps) {
    const C = useAppColors();
    const { width } = useWindowDimensions();
    const isTiny = width < 300;
    const styles = useMemo(() => makeStyles(C, isTiny), [C.scheme, isTiny]);

    const [form, setForm] = useState({
        firstName: student.first_name, lastName: student.last_name, phone: student.phone || '',
        address: student.address || '',
        dateOfBirth: student.date_of_birth || '', gender: student.gender || 'Male', photo: student.photo || null as string | null
    });
    const [dobParts, setDobParts] = useState({ year: '', month: '', day: '' });
    const [selectedImage, setSelectedImage] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let y = '', m = '', d = '';
        if (student.date_of_birth) {
            const parts = student.date_of_birth.split('T')[0].split('-');
            y = parts[0] || ''; m = parts[1] || ''; d = parts[2] || '';
        }
        setDobParts({ year: y, month: m, day: d });
        setForm({
            firstName: student.first_name, lastName: student.last_name, phone: student.phone || '',
            address: student.address || '',
            dateOfBirth: student.date_of_birth ? student.date_of_birth.split('T')[0] : '',
            gender: student.gender || 'Male', photo: student.photo || null
        });
        setError(null);
    }, [student, visible]);

    const handlePickImage = async () => {
        try {
            // Uses the Android Photo Picker on Android 13+ (API 33+) automatically —
            // no READ_EXTERNAL_STORAGE permission needed. Falls back gracefully
            // on older Android versions. Uses Photos/Camera Roll on iOS.
            // Requires the new mediaTypes array API (expo-image-picker v17+).
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
                allowsMultipleSelection: false,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                const imageFile = {
                    uri: asset.uri,
                    name: asset.fileName || 'photo.jpg',
                    mimeType: asset.mimeType || 'image/jpeg',
                };
                setSelectedImage(imageFile);
                setForm({ ...form, photo: asset.uri });
            }
        } catch (err) { setError('Failed to open photo picker'); }
    };

    const handleSave = async () => {
        if (!form.firstName.trim() || !form.lastName.trim()) { setError('Names required'); return; }
        const finalDob = (dobParts.year && dobParts.month && dobParts.day) 
            ? `${dobParts.year}-${dobParts.month.padStart(2, '0')}-${dobParts.day.padStart(2, '0')}` 
            : form.dateOfBirth;

        setLoading(true);
        try {
            const token = Platform.OS === 'web' ? localStorage.getItem('studentToken') : await SecureStore.getItemAsync('studentToken');
            const formData = new FormData();
            formData.append('firstName', form.firstName.trim());
            formData.append('lastName', form.lastName.trim());
            formData.append('phone', form.phone);
            formData.append('address', form.address);
            formData.append('dateOfBirth', finalDob);
            formData.append('gender', form.gender);

            if (selectedImage) {
                if (Platform.OS === 'web') formData.append('photo', (selectedImage as any).file || selectedImage);
                else formData.append('photo', { uri: selectedImage.uri, name: 'p.jpg', type: selectedImage.mimeType || 'image/jpeg' } as any);
            }

            const response = await fetch(`${API_BASE_URL}/api/students/profile`, {
                method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }, body: formData,
            });
            const data = await response.json();
            if (data.success) {
                onUpdate({ ...student, ...data.data });
                Alert.alert('Success', 'Profile updated');
                onClose();
            } else throw new Error(data.error || 'Update failed');
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const years = Array.from({ length: 80 }, (_, i) => String(new Date().getFullYear() - 5 - i));
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <View style={styles.modalIndictor} />
                    <View style={styles.header}>
                        <ThemedText style={styles.title}>UPDATE PROFILE</ThemedText>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Ionicons name="close" size={20} color={C.text} /></TouchableOpacity>
                    </View>
                    {error && <View style={styles.error}><Ionicons name="alert-circle" size={16} color="#EF4444" /><ThemedText style={styles.errorText}>{error}</ThemedText></View>}
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
                        <View style={styles.photoBox}>
                            <TouchableOpacity onPress={handlePickImage} style={styles.avatarWrap}>
                                {form.photo ? <Image source={{ uri: form.photo }} style={styles.avatar} /> : <View style={styles.avatarPlaceholder}><ThemedText style={styles.avatarText}>{form.firstName?.[0]}{form.lastName?.[0]}</ThemedText></View>}
                                <View style={styles.camera}><Ionicons name="camera" size={14} color="#fff" /></View>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.group}><ThemedText style={styles.label}>FIRST NAME</ThemedText><TextInput style={styles.input} value={form.firstName} onChangeText={t => setForm({...form, firstName: t})} placeholder="First" /></View>
                        <View style={styles.group}><ThemedText style={styles.label}>LAST NAME</ThemedText><TextInput style={styles.input} value={form.lastName} onChangeText={t => setForm({...form, lastName: t})} placeholder="Last" /></View>
                        <View style={styles.group}><ThemedText style={styles.label}>PHONE</ThemedText><TextInput style={styles.input} value={form.phone} onChangeText={t => setForm({...form, phone: t})} placeholder="Phone" keyboardType="phone-pad" /></View>
                        <View style={styles.group}><ThemedText style={styles.label}>ADDRESS</ThemedText><TextInput style={styles.input} value={form.address} onChangeText={t => setForm({...form, address: t})} placeholder="Residential Address" /></View>
                        <View style={styles.group}>
                            <ThemedText style={styles.label}>GENDER</ThemedText>
                            <View style={styles.row}>{['Male', 'Female'].map(g => (<TouchableOpacity key={g} style={[styles.genderBtn, form.gender === g && styles.activeG]} onPress={() => setForm({...form, gender: g})}><ThemedText style={[styles.genderText, form.gender === g && styles.activeGText]}>{g}</ThemedText></TouchableOpacity>))}</View>
                        </View>
                        <View style={styles.group}>
                            <ThemedText style={styles.label}>DATE OF BIRTH</ThemedText>
                            <View style={styles.dobRow}>
                                {[years, months, days].map((arr, i) => (
                                    <View key={i} style={styles.dobPart}><ScrollView style={{ flex: 1 }} nestedScrollEnabled>
                                        {arr.map(v => (<TouchableOpacity key={v} style={[styles.dobItem, [dobParts.year, dobParts.month, dobParts.day][i] === v && styles.activeDob]} onPress={() => {const np = {...dobParts}; if(i===0)np.year=v; if(i===1)np.month=v; if(i===2)np.day=v; setDobParts(np);}}><ThemedText style={[styles.dobText, [dobParts.year, dobParts.month, dobParts.day][i] === v && styles.activeDobText]}>{v}</ThemedText></TouchableOpacity>))}
                                    </ScrollView></View>
                                ))}
                            </View>
                        </View>
                        <View style={{ marginTop: 10 }}>
                            <CustomButton 
                                title="SAVE CHANGES" 
                                onPress={handleSave} 
                                loading={loading} 
                                variant="premium" 
                                style={{ height: 52 }} 
                            />
                        </View>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const makeStyles = (C: any, isTiny: boolean) => StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'flex-end' },
    card: { backgroundColor: C.modalBg, borderTopLeftRadius: 32, borderTopRightRadius: 32, height: '88%', padding: isTiny ? 20 : 24 },
    modalIndictor: { width: 36, height: 4, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    title: { fontSize: isTiny ? 16 : 18, fontWeight: '900', color: C.text, letterSpacing: 1 },
    closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.actionIconWrap, justifyContent: 'center', alignItems: 'center' },
    error: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF444415', padding: 12, borderRadius: 12, marginBottom: 20, gap: 8, borderWidth: 1, borderColor: '#EF444430' },
    errorText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
    scroll: { paddingBottom: 30 },
    photoBox: { alignItems: 'center', marginBottom: 30 },
    avatarWrap: { position: 'relative' },
    avatar: { width: isTiny ? 80 : 90, height: isTiny ? 80 : 90, borderRadius: 45, borderWidth: 3, borderColor: Colors.accent.gold },
    avatarPlaceholder: { width: isTiny ? 80 : 90, height: isTiny ? 80 : 90, borderRadius: 45, backgroundColor: 'rgba(250, 204, 21, 0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.accent.gold },
    avatarText: { fontSize: 24, fontWeight: '900', color: Colors.accent.gold },
    camera: { position: 'absolute', bottom: 0, right: 0, backgroundColor: Colors.accent.gold, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.modalBg },
    group: { marginBottom: 20 },
    label: { fontSize: 9, fontWeight: '800', color: C.textLabel, marginBottom: 8, letterSpacing: 1 },
    input: { backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 12, paddingHorizontal: 16, height: 48, color: C.inputText, fontSize: 13, fontWeight: '600' },
    row: { flexDirection: 'row', gap: 12 },
    genderBtn: { flex: 1, height: 48, borderRadius: 12, backgroundColor: C.inputBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.inputBorder },
    activeG: { backgroundColor: 'rgba(250, 204, 21, 0.1)', borderColor: Colors.accent.gold },
    genderText: { color: C.textSecondary, fontWeight: '700', fontSize: 12 },
    activeGText: { color: Colors.accent.gold, fontWeight: '800' },
    dobRow: { flexDirection: 'row', gap: 10, height: 130 },
    dobPart: { flex: 1, backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.inputBorder, overflow: 'hidden' },
    dobItem: { paddingVertical: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.divider },
    activeDob: { backgroundColor: 'rgba(250, 204, 21, 0.1)' },
    dobText: { color: C.inputText, fontSize: 13, fontWeight: '600' },
    activeDobText: { color: Colors.accent.gold, fontWeight: '900' },
});
