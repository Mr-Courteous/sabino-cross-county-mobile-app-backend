import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Platform,
    ScrollView,
    ImageBackground,
    useWindowDimensions,
    Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { getUserTypeFromToken } from '@/utils/jwt-decoder';
import { syncPushTokenToBackend } from '@/utils/push-notifications';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/design-system';
import { useAppColors } from '@/hooks/use-app-colors';

export default function StudentLogin() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const C = useAppColors();
    const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async () => {
        if (!email || !password) {
            setError('Please enter both email and password');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/api/students/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
            });

            const data = await response.json().catch(() => ({}));
            
            if (!response.ok) {
                const errorMessage = data.error || data.message || 'The server encountered an error. Please try again later.';
                throw new Error(errorMessage);
            }

            if (data.success) {
                const { student, token } = data.data;
                const userType = getUserTypeFromToken(token);

                if (userType !== 'student') {
                    setError('Unauthorized: This account is not registered for student portal access.');
                    setLoading(false);
                    return;
                }

                const storage = Platform.OS === 'web' ? localStorage : SecureStore;
                const setItem = Platform.OS === 'web' ? (k: string, v: string) => storage.setItem(k, v) : (k: string, v: string) => SecureStore.setItemAsync(k, v);

                await setItem('userToken', token);
                await setItem('userData', JSON.stringify(student));
                await setItem('studentToken', token);
                await setItem('studentData', JSON.stringify(student));

                // Register push token for student
                syncPushTokenToBackend(token);

                router.replace('/(student)/dashboard' as any);
            }
        } catch (error: any) {
            console.error('Login Error:', error);
            setError(error.message || 'Connection failed. Please check your internet and try again.');
        } finally {
            setLoading(false);
        }
    };

    const isTiny = width < 300;

    return (
        <ThemedView style={{ flex: 1, backgroundColor: C.background }}>
            <ImageBackground
                source={{ uri: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2070' }}
                style={styles.hero}
            >
                <LinearGradient
                    colors={C.isDark ? ['rgba(15, 23, 42, 0.4)', 'rgba(15, 23, 42, 0.95)'] : ['rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0.95)']}
                    style={styles.overlay}
                >
                    <ScrollView
                        contentContainerStyle={styles.scrollContainer}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.header}>
                            <TouchableOpacity
                                style={styles.backBtn}
                                onPress={() => router.back()}
                            >
                                <Ionicons name="arrow-back" size={20} color={C.isDark ? "#FFF" : C.text} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.homeBtn}
                                onPress={() => {
                                    router.replace('/home');
                                }}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="home-outline" size={18} color={C.isDark ? "#FFF" : C.text} />
                            </TouchableOpacity>
                            <View style={styles.logoBadge}>
                                <Image source={require('../../assets/images/sabino.jpeg')} style={{ width: 40, height: 40, borderRadius: 20 }} />
                                <Text style={styles.logoText}>SABINO EDU</Text>
                            </View>
                            <Text style={styles.title}>Student Portal</Text>
                            <View style={styles.goldBar} />
                            <Text style={styles.subtitle}>Secure Academic Access</Text>
                        </View>

                        <View style={styles.card}>
                            {error && (
                                <CustomAlert
                                    type="error"
                                    title="Access Denied"
                                    message={error}
                                    onClose={() => setError('')}
                                    style={{ marginBottom: 16 }}
                                />
                            )}

                            <CustomInput
                                label="Student Email"
                                placeholder="name@oags.com"
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                                editable={!loading}
                                containerStyle={styles.inputContainer}
                                labelStyle={{ fontSize: 10 }}
                            />

                            <CustomInput
                                label="Password"
                                placeholder="••••••••"
                                isPassword
                                value={password}
                                onChangeText={setPassword}
                                editable={!loading}
                                containerStyle={styles.inputContainer}
                                labelStyle={{ fontSize: 10 }}
                            />

                            <CustomButton
                                title={loading ? "AUTHENTICATING..." : "SIGN IN TO PORTAL"}
                                onPress={handleLogin}
                                loading={loading}
                                variant="premium"
                                style={styles.ctaButton}
                                textStyle={{ fontSize: 12 }}
                            />

                            <TouchableOpacity
                                onPress={() => router.push('/(student)/forgot-password')}
                                style={styles.forgotPass}
                                activeOpacity={0.7}
                                disabled={loading}
                            >
                                <ThemedText style={styles.forgotText}>FORGOT PASSWORD?</ThemedText>
                            </TouchableOpacity>

                            <View style={styles.divider}>
                                <View style={styles.dividerLine} />
                                <Text style={styles.dividerText}>OR</Text>
                                <View style={styles.dividerLine} />
                            </View>

                            <TouchableOpacity
                                style={styles.registerButton}
                                onPress={() => router.push('/(student)/verify-email' as any)}
                            >
                                <Text style={styles.registerText}>CREATE ACCOUNT</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.footer}>
                            <Text style={styles.footerText}>© {new Date().getFullYear()} SABINO EDU SYSTEMS GLOBAL</Text>
                        </View>
                    </ScrollView>
                </LinearGradient>
            </ImageBackground>
        </ThemedView>
    );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
    const isTiny = width < 300;
    return StyleSheet.create({
        hero: { flex: 1, width: '100%' },
        overlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24 },
        scrollContainer: { flexGrow: 1, justifyContent: 'center', paddingVertical: isTiny ? 40 : 60 },

        header: { alignItems: 'center', marginBottom: isTiny ? 24 : 30, width: '100%' },
        backBtn: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 36,
            height: 36,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: C.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
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
            backgroundColor: C.actionItemBg,
            borderRadius: 18,
            zIndex: 10
        },
        logoBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.08)',
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)'
        },
        logoText: { color: '#FACC15', fontSize: 11, fontWeight: '900', marginLeft: 8, letterSpacing: 2 },
        title: { fontSize: isTiny ? 28 : 34, fontWeight: '900', color: C.isDark ? '#fff' : C.text, letterSpacing: -1 },
        goldBar: { width: 40, height: 3, backgroundColor: '#FACC15', borderRadius: 1.5, marginVertical: 12 },
        subtitle: { fontSize: 11, color: C.textSecondary, fontWeight: '800', letterSpacing: 1 },

        card: {
            backgroundColor: C.isDark ? 'rgba(30, 41, 59, 0.85)' : 'rgba(255, 255, 255, 0.95)',
            borderRadius: 28,
            padding: isTiny ? 20 : 26,
            borderWidth: 1,
            borderColor: C.cardBorder,
        },
        inputContainer: {
            backgroundColor: C.isDark ? 'rgba(15, 23, 42, 0.5)' : '#F8FAFC',
            borderColor: C.inputBorder,
            marginBottom: 12,
        },
        forgotPass: {
            width: '100%',
            alignItems: 'center',
            marginTop: 20,
            paddingVertical: 12,
        },
        forgotText: { color: '#FACC15', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

        ctaButton: { height: 52, borderRadius: 12 },

        divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
        dividerLine: { flex: 1, height: 1, backgroundColor: C.divider },
        dividerText: { color: C.textSecondary, fontSize: 11, fontWeight: '800', marginHorizontal: 16 },

        registerButton: {
            height: 48,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: '#FACC15',
            alignItems: 'center',
            justifyContent: 'center'
        },
        registerText: { color: '#FACC15', fontSize: 11, fontWeight: '900', letterSpacing: 1 },

        footer: { marginTop: 34, alignItems: 'center' },
        footerText: { color: C.textLabel, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
    });
}
