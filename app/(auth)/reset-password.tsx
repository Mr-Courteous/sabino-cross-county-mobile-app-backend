import { View, ActivityIndicator, ScrollView, Platform, ImageBackground, StyleSheet, Text, TouchableOpacity, useWindowDimensions, Image } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useState, useEffect, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/utils/api-service';
import { validatePassword } from '@/utils/password-validator';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/design-system';

export default function SchoolResetPasswordScreen() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const styles = useMemo(() => makeStyles(width), [width]);
    const params = useLocalSearchParams();
    const email = params.email as string;
    const accountType = (params.accountType as string) === 'admin' ? 'admin' : 'owner';

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusAlert, setStatusAlert] = useState<{
        visible: boolean;
        type: 'success' | 'error' | 'warning' | 'info';
        title: string;
        message: string;
        onConfirm?: () => void;
    }>({ visible: false, type: 'info', title: '', message: '' });

    useEffect(() => { if (!email) router.replace('/(auth)/forgot-password'); }, [email]);

    const handleResetPassword = async () => {
        if (!password || !confirmPassword) return;
        const validation = validatePassword(password);
        if (!validation.isValid) { setStatusAlert({ visible: true, type: 'error', title: 'Invalid', message: validation.errorMessage }); return; }
        if (password !== confirmPassword) { setStatusAlert({ visible: true, type: 'error', title: 'Mismatch', message: 'Passwords do not match' }); return; }

        setLoading(true);
        try {
            const endpoint = accountType === 'admin' ? '/api/staff-auth/reset-password' : '/api/schools/reset-password';
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.toLowerCase(), password }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || data.error || 'Reset failed');

            setStatusAlert({
                visible: true,
                type: 'success',
                title: 'Success',
                message: accountType === 'admin' ? 'Password reset successfully.' : 'Administrator password reset successfully.',
                onConfirm: async () => {
                    if (Platform.OS === 'web') { localStorage.removeItem('userToken'); localStorage.removeItem('studentToken'); }
                    else { await SecureStore.deleteItemAsync('userToken'); await SecureStore.deleteItemAsync('studentToken'); }
                    router.replace('/');
                }
            });
        } catch (error: any) {
            setStatusAlert({ visible: true, type: 'error', title: 'Error', message: error.message || 'Reset failed' });
        } finally { setLoading(false); }
    };

    const isTiny = width < 300;

    return (
        <ThemedView style={{ flex: 1, backgroundColor: Colors.accent.navy }}>
            <ImageBackground source={{ uri: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2070' }} style={styles.hero}>
                <LinearGradient colors={['rgba(10, 15, 30, 0.8)', 'rgba(15, 23, 42, 0.98)']} style={styles.overlay}>
                    <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                        <View style={styles.header}>
                            <TouchableOpacity 
                                style={styles.backBtn}
                                onPress={() => router.back()}
                            >
                                <Ionicons name="arrow-back" size={20} color="#fff" />
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={styles.homeBtn}
                                onPress={() => {
                                    router.replace('/home');
                                }}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="home-outline" size={18} color="#fff" />
                            </TouchableOpacity>
                            <View style={styles.logoBadge}>
                                <Image source={require('../../assets/images/sabino.jpeg')} style={{ width: 40, height: 40, borderRadius: 20 }} />
                                <Text style={styles.logoText}>SABINO EDU</Text>
                            </View>
                            <Text style={styles.title}>New Password</Text>
                            <View style={styles.goldBar} />
                        </View>

                        <View style={styles.card}>
                            {!isTiny && <View style={styles.iconCircle}><Ionicons name="lock-closed" size={28} color="#FACC15" /></View>}
                            {statusAlert.visible && <CustomAlert {...statusAlert} onClose={() => setStatusAlert({ ...statusAlert, visible: false })} style={{ marginBottom: 16 }} />}
                            <CustomInput label="New Password" placeholder="Min. 8 chars" isPassword value={password} onChangeText={setPassword} />
                            <CustomInput label="Confirm Password" placeholder="Confirm Password" isPassword value={confirmPassword} onChangeText={setConfirmPassword} />
                            
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 12 }}>
                                <Ionicons name="information-circle-outline" size={14} color="#94A3B8" />
                                <Text style={{ color: '#94A3B8', fontSize: 10, marginLeft: 6, fontWeight: '600' }}>
                                    USE 8+ CHARACTERS (UPPER, LOWER, NUMBER & SYMBOL)
                                </Text>
                            </View>
                            <CustomButton title={loading ? "RESETTING..." : "CONFIRM"} onPress={handleResetPassword} disabled={loading} loading={loading} variant="premium" style={styles.ctaButton} />
                        </View>
                        {/* <View style={styles.footer}><Text style={styles.footerText}>ENCRYPTED SECURITY LAYER</Text></View> */}
                    </ScrollView>
                </LinearGradient>
            </ImageBackground>
        </ThemedView>
    );
}

function makeStyles(width: number) {
    const isTiny = width < 300;
    return StyleSheet.create({
        hero: { flex: 1, width: '100%' },
        overlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24 },
        scrollContainer: { flexGrow: 1, justifyContent: 'center', paddingVertical: isTiny ? 40 : 60 },
        header: { alignItems: 'center', marginBottom: isTiny ? 24 : 32 },
        backBtn: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 36,
            height: 36,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.1)',
            borderRadius: 18,
            zIndex: 10
        },
        homeBtn: {
            position: 'absolute',
            top: 0,
            right: 0,
            width: 36,
            height: 36,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.1)',
            borderRadius: 18,
            zIndex: 10
        },
        logoBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
        logoText: { color: '#FACC15', fontSize: 11, fontWeight: '900', marginLeft: 8, letterSpacing: 2 },
        title: { fontSize: isTiny ? 26 : 30, fontWeight: '900', color: '#fff', letterSpacing: -1 },
        goldBar: { width: 40, height: 3, backgroundColor: '#FACC15', borderRadius: 2, marginVertical: 12 },
        card: { backgroundColor: 'rgba(30, 41, 59, 0.7)', borderRadius: 28, padding: isTiny ? 20 : 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
        iconCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(250, 204, 21, 0.1)', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(250, 204, 21, 0.2)' },
        ctaButton: { height: 52, borderRadius: 12, marginTop: 10 },
        footer: { marginTop: 30, alignItems: 'center' },
        footerText: { color: '#334155', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    });
}
