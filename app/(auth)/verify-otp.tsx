import { View, ActivityIndicator, ScrollView, ImageBackground, StyleSheet, Text, TouchableOpacity, useWindowDimensions, Image } from 'react-native';
import { useState, useEffect, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/utils/api-service';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/design-system';

export default function VerifyOTPScreen() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const styles = useMemo(() => makeStyles(width), [width]);
    const params = useLocalSearchParams();
    const email = params.email as string;

    const [otp, setOtp] = useState('');
    const [timeLeft, setTimeLeft] = useState(600);
    const [statusAlert, setStatusAlert] = useState<{
        visible: boolean;
        type: 'success' | 'error' | 'warning' | 'info';
        title: string;
        message: string;
    }>({ visible: false, type: 'info', title: '', message: '' });
    const [verifying, setVerifying] = useState(false);

    useEffect(() => {
        if (timeLeft <= 0) return;
        const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
        return () => clearInterval(timer);
    }, [timeLeft]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleVerifyOTP = async () => {
        if (otp.length !== 6) return;
        setVerifying(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/schools/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp }),
            });
            const data = await response.json();
            if (response.ok && data.success) router.push({ pathname: '/(auth)/complete-registration', params: { email } });
            else throw new Error(data.message || 'OTP verification failed');
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
                            {!isTiny && <View style={styles.iconCircle}><Ionicons name="mail-open" size={28} color="#FACC15" /></View>}
                            <View style={styles.infoBox}><Text style={styles.infoValue}>{email}</Text></View>
                            {statusAlert.visible && <CustomAlert {...statusAlert} onClose={() => setStatusAlert({ ...statusAlert, visible: false })} style={{ marginBottom: 16 }} />}
                            <CustomInput label="6-Digit OTP" placeholder="000000" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))} keyboardType="numeric" maxLength={6} editable={timeLeft > 0 && !verifying} inputStyle={styles.otpInput} />
                            <Text style={[styles.timerText, timeLeft <= 60 && { color: '#EF4444' }]}>{timeLeft > 0 ? `Code expires in ${formatTime(timeLeft)}` : 'Code expired'}</Text>
                            <CustomButton title={verifying ? "VERIFYING..." : "CONTINUE"} onPress={handleVerifyOTP} disabled={timeLeft <= 0 || verifying} loading={verifying} variant="premium" style={styles.ctaButton} />
                            <TouchableOpacity style={styles.resendBtn} onPress={() => router.back()} disabled={verifying}><Text style={styles.resendText}>REQUEST NEW CODE</Text></TouchableOpacity>
                        </View>
                        <View style={styles.footer}><Text style={styles.footerText}>ENCRYPTED HANDSHAKE</Text></View>
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
        infoBox: { backgroundColor: 'rgba(15, 23, 42, 0.4)', padding: 10, borderRadius: 12, marginBottom: 16, alignItems: 'center' },
        infoValue: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' },
        otpInput: { letterSpacing: 6, textAlign: 'center', fontSize: 20, fontWeight: '900' },
        timerText: { fontSize: 10, color: '#94A3B8', marginTop: 10, textAlign: 'center', fontWeight: '700' },
        ctaButton: { height: 52, borderRadius: 12, marginTop: 20 },
        resendBtn: { marginTop: 16, alignItems: 'center' },
        resendText: { color: '#FACC15', fontSize: 11, fontWeight: '800' },
        footer: { marginTop: 30, alignItems: 'center' },
        footerText: { color: '#334155', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    });
}
