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
import { API_BASE_URL } from '@/utils/api-service';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/design-system';

export default function StudentVerifyResetOtp() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const styles = useMemo(() => makeStyles(width), [width]);
    const params = useLocalSearchParams();
    const email = params.email as string;

    const [otp, setOtp] = useState('');
    const [timeLeft, setTimeLeft] = useState(600);
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { if (!email) router.replace('/(student)/forgot-password'); }, [email]);

    useEffect(() => {
        if (timeLeft <= 0) { setError('Code expired'); return; }
        const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
        return () => clearInterval(timer);
    }, [timeLeft]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleVerifyOtp = async () => {
        if (otp.length !== 6) return;
        setVerifying(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/students/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error('Invalid code');
            router.push({ pathname: '/(student)/reset-password', params: { email } });
        } catch (err: any) { setError(err.message); }
        finally { setVerifying(false); }
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
                            <Text style={styles.title}>Confirm Code</Text>
                            <View style={styles.goldBar} />
                        </View>

                        <View style={styles.card}>
                            {!isTiny && <View style={styles.iconCircle}><Ionicons name="mail-open" size={32} color="#FACC15" /></View>}
                            {error ? <CustomAlert type="error" title="Error" message={error} onClose={() => setError('')} style={{ marginBottom: 16 }} /> : null}
                            <CustomInput placeholder="000 000" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" editable={!verifying} inputStyle={styles.otpInput} containerStyle={styles.inputContainer} />
                            <View style={styles.timerBox}>
                                <Ionicons name="timer-outline" size={14} color={timeLeft <= 60 ? "#EF4444" : "#94A3B8"} />
                                <Text style={[styles.timerText, timeLeft <= 60 && { color: '#EF4444' }]}>{timeLeft > 0 ? `EXPIRES IN ${formatTime(timeLeft)}` : 'EXPIRED'}</Text>
                            </View>
                            <CustomButton title={verifying ? "VERIFYING..." : "CONFIRM"} onPress={handleVerifyOtp} loading={verifying} variant="premium" style={styles.ctaButton} />
                            <TouchableOpacity style={styles.resendLink} onPress={() => {}} disabled={verifying}><Text style={styles.resendText}>DISPATCH AGAIN</Text></TouchableOpacity>
                        </View>
                        <View style={styles.footer}><Text style={styles.footerText}>RECOVERY PROTOCOL ACTIVE</Text></View>
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
        otpInput: { fontSize: 24, letterSpacing: 8, fontWeight: '900', textAlign: 'center' },
        inputContainer: { backgroundColor: 'rgba(15, 23, 42, 0.5)', borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', paddingHorizontal: 0 },
        timerBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, marginBottom: 20 },
        timerText: { color: '#94A3B8', fontSize: 9, fontWeight: '800', marginLeft: 6, letterSpacing: 1 },
        ctaButton: { height: 52, borderRadius: 12 },
        resendLink: { marginTop: 16, alignItems: 'center' },
        resendText: { color: '#FACC15', fontSize: 10, letterSpacing: 1, fontWeight: '800' },
        footer: { marginTop: 30, alignItems: 'center' },
        footerText: { color: '#334155', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    });
}
