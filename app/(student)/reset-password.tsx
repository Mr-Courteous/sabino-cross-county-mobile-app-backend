import React, { useState, useEffect, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Platform,
    ScrollView,
    Alert,
    ImageBackground,
    useWindowDimensions,
    Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { validatePassword } from '@/utils/password-validator';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/design-system';

export default function StudentResetPassword() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const styles = useMemo(() => makeStyles(width), [width]);
    const params = useLocalSearchParams();
    const email = params.email as string;

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => { if (!email) router.replace('/(student)/forgot-password'); }, [email]);

    const handleResetPassword = async () => {
        if (!password || !confirmPassword) return;
        const validation = validatePassword(password);
        if (!validation.isValid) { setError(validation.errorMessage); return; }
        if (password !== confirmPassword) { setError('Passwords mismatch'); return; }

        setLoading(true);
        setError('');
        try {
            const response = await fetch(`${API_BASE_URL}/api/students/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.toLowerCase(), password }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Reset failed');
            
            setSuccess(true);
            
            // Clean up old session
            if (Platform.OS === 'web') { localStorage.removeItem('studentToken'); }
            else { await SecureStore.deleteItemAsync('studentToken'); }

            // Auto-redirect to login after 2.5 seconds
            setTimeout(() => {
                router.replace('/(student)/' as any);
            }, 2500);
            
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
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
                            <Text style={styles.title}>Secure Reset</Text>
                            <View style={styles.goldBar} />
                        </View>

                        <View style={styles.card}>
                            {success ? (
                                <View style={styles.centered}>
                                    <Ionicons name="checkmark-circle" size={80} color="#10B981" />
                                    <Text style={styles.successTitle}>Update Successful</Text>
                                    <Text style={styles.successSubtitle}>Your security credentials have been synchronized. Redirecting to portal...</Text>
                                    <ActivityIndicator color="#FACC15" style={{ marginTop: 10 }} />
                                </View>
                            ) : (
                                <>
                                    {!isTiny && <View style={styles.iconCircle}><Ionicons name="lock-closed" size={32} color="#FACC15" /></View>}
                                    <View style={styles.verifiedBox}><Text style={styles.verifiedText}>{email}</Text></View>
                                    {error ? <CustomAlert type="error" title="Error" message={error} onClose={() => setError('')} style={{ marginBottom: 16 }} /> : null}
                                    <CustomInput label="New Password" placeholder="••••••••" isPassword value={password} onChangeText={setPassword} editable={!loading} />
                                    
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: -4, marginBottom: 12 }}>
                                        <Ionicons name="information-circle-outline" size={12} color="#94A3B8" />
                                        <Text style={{ color: '#94A3B8', fontSize: 9, marginLeft: 6, fontWeight: '700' }}>
                                            USE 8+ CHARACTERS (UPPER, LOWER, NUMBER & SYMBOLS)
                                        </Text>
                                    </View>

                                    <CustomInput label="Confirm Password" placeholder="••••••••" isPassword value={confirmPassword} onChangeText={setConfirmPassword} editable={!loading} />
                                    <CustomButton title={loading ? "SYNCING..." : "UPDATE"} onPress={handleResetPassword} loading={loading} variant="premium" style={styles.ctaButton} />
                                </>
                            )}
                        </View>
                        <View style={styles.footer}><Text style={styles.footerText}>ENCRYPTED EXCHANGE ACTIVE</Text></View>
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
        verifiedBox: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 12, marginBottom: 20, alignItems: 'center' },
        verifiedText: { color: '#FACC15', fontWeight: '800', fontSize: 11 },
        centered: { alignItems: 'center', paddingVertical: 20 },
        successTitle: { color: '#10B981', fontSize: 20, fontWeight: '900', marginTop: 16 },
        successSubtitle: { color: '#94A3B8', fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 10, lineHeight: 20 },
        ctaButton: { height: 52, borderRadius: 12, marginTop: 10 },
        footer: { marginTop: 30, alignItems: 'center' },
        footerText: { color: '#334155', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    });
}
