import { View, ActivityIndicator, ScrollView, ImageBackground, StyleSheet, Text, TouchableOpacity, useWindowDimensions, Image } from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/utils/api-service';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/design-system';

export default function VerifyEmailScreen() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const styles = useMemo(() => makeStyles(width), [width]);

    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [verifying, setVerifying] = useState(false);
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
    const [timeLeft, setTimeLeft] = useState(600);

    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (otpSent && timeLeft > 0) {
            timer = setInterval(() => {
                setTimeLeft((prev) => prev - 1);
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [otpSent, timeLeft]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleSendOTP = async () => {
        if (!email.trim() || !email.includes('@')) {
            setStatusAlert({ visible: true, type: 'error', title: 'Error', message: 'Valid email required' });
            return;
        }
        setLoading(true);
        const normalizedEmail = email.trim().toLowerCase();
        try {
            const response = await fetch(`${API_BASE_URL}/api/schools/otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizedEmail }),
            });
            const result = await response.json();
            if (response.status === 409) {
                setStatusAlert({ visible: true, type: 'info', title: 'Registered', message: 'Email already in use.', onConfirm: () => router.replace('/(auth)') });
                return;
            }
            if (response.ok && result.success) { setOtpSent(true); setTimeLeft(600); }
            else throw new Error(result.message || 'Dispatch failed');
        } catch (err: any) {
            setStatusAlert({ visible: true, type: 'error', title: 'Error', message: err.message || 'Network fault' });
        } finally { setLoading(false); }
    };
 
    const handleVerifyOTP = async () => {
        if (otp.length !== 6) return;
        setVerifying(true);
        const normalizedEmail = email.trim().toLowerCase();
        try {
            const response = await fetch(`${API_BASE_URL}/api/schools/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizedEmail, otp }),
            });
            const data = await response.json();
            if (response.ok && data.success) router.push({ pathname: '/(auth)/complete-registration', params: { email: normalizedEmail } });
            else throw new Error(data.message || 'OTP failure');
        } catch (err: any) {
            setStatusAlert({ visible: true, type: 'error', title: 'Error', message: err.message || 'Verify failed' });
        } finally { setVerifying(false); }
    };

    const isTiny = width < 300;

    return (
        <ThemedView style={{ flex: 1, backgroundColor: Colors.accent.navy }}>
            <ImageBackground source={{ uri: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2070' }} style={styles.hero}>
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
                            <Text style={styles.title}>Verification</Text>
                            <View style={styles.goldBar} />
                        </View>

                        <View style={styles.card}>
                            {statusAlert.visible && <CustomAlert {...statusAlert} onClose={() => setStatusAlert({ ...statusAlert, visible: false })} style={{ marginBottom: 16 }} />}
                            <CustomInput label="School Email" placeholder="admin@oags.com" value={email} onChangeText={setEmail} editable={!loading && !otpSent} keyboardType="email-address" />
                            {otpSent && <TouchableOpacity onPress={() => { setOtpSent(false); setOtp(''); }} style={styles.changeEmail}><Text style={styles.changeEmailText}>CHANGE EMAIL</Text></TouchableOpacity>}
                            {otpSent && (
                                <View style={{ marginTop: 16 }}>
                                    <CustomInput label="6-Digit OTP" placeholder="000000" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))} editable={!verifying} keyboardType="numeric" maxLength={6} inputStyle={styles.otpInput} />
                                    <Text style={[styles.timerText, timeLeft <= 60 && { color: '#EF4444' }]}>{timeLeft > 0 ? `Code expires in ${formatTime(timeLeft)}` : 'Code expired'}</Text>
                                </View>
                            )}
                            <CustomButton title={loading || verifying ? "..." : (otpSent ? 'VERIFY' : 'SEND OTP')} onPress={otpSent ? handleVerifyOTP : handleSendOTP} disabled={loading || verifying} loading={loading || verifying} variant="premium" style={styles.ctaButton} />
                            {otpSent && <TouchableOpacity style={styles.resendBtn} onPress={handleSendOTP} disabled={loading || verifying}><Text style={styles.resendText}>RESEND CODE</Text></TouchableOpacity>}
                            <TouchableOpacity style={styles.loginRedirectBtn} onPress={() => router.push('/(auth)')}><Text style={styles.loginRedirectText}>Already registered? <Text style={styles.loginLink}>LOGIN</Text></Text></TouchableOpacity>
                        </View>
                        <View style={styles.footer}><Text style={styles.footerText}>SECURE PROTOCOL</Text></View>
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
        changeEmail: { marginTop: 6, alignSelf: 'flex-end' },
        changeEmailText: { color: '#FACC15', fontSize: 9, fontWeight: '800' },
        otpInput: { letterSpacing: 6, textAlign: 'center', fontSize: 20, fontWeight: '900' },
        timerText: { fontSize: 10, color: '#94A3B8', marginTop: 8, textAlign: 'center', fontWeight: '700' },
        ctaButton: { height: 52, borderRadius: 12, marginTop: 20 },
        resendBtn: { marginTop: 16, alignItems: 'center' },
        resendText: { color: '#FACC15', fontSize: 11, fontWeight: '800' },
        loginRedirectBtn: { marginTop: 20, alignItems: 'center', paddingVertical: 12 },
        loginRedirectText: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
        loginLink: { color: '#FACC15', fontWeight: '800' },
        footer: { marginTop: 30, alignItems: 'center' },
        footerText: { color: '#334155', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    });
}
