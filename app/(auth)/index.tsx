import { useRouter } from 'expo-router';
import React, { useState, useMemo } from 'react';
import {
    View,
    ActivityIndicator,
    Platform,
    ScrollView,
    TouchableOpacity,
    ImageBackground,
    StyleSheet,
    useWindowDimensions,
    Image,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/utils/api-service';
import { getUserTypeFromToken } from '@/utils/jwt-decoder';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { useAppColors } from '@/hooks/use-app-colors';
import { Colors } from '@/constants/design-system';
import { syncPushTokenToBackend } from '@/utils/push-notifications'; // <-- NEW

export default function LoginScreen() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const C = useAppColors();
    const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const persistSession = async (token: string, user: any, countryId: number | null) => {
        if (Platform.OS === 'web') {
            localStorage.setItem('userToken', token);
            localStorage.setItem('userData', JSON.stringify(user));
            if (countryId) localStorage.setItem('countryId', countryId.toString());
        } else {
            await SecureStore.setItemAsync('userToken', token);
            await SecureStore.setItemAsync('userData', JSON.stringify(user));
            if (countryId) await SecureStore.setItemAsync('countryId', countryId.toString());
        }
    };

    const handleLogin = async () => {
        if (!email || !password) {
            setError('Please enter email and password');
            return;
        }

        setError('');
        setIsLoading(true);

        try {
            // Try the school-owner login first — unchanged behaviour, owners
            // authenticate exactly as before and never touch the branch below.
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
            });

            const data = await response.json();

            if (response.ok && data.success && data.data?.token) {
                const { token, user } = data.data;
                const userType = getUserTypeFromToken(token);

                if (userType !== 'school') {
                    setError('Invalid credentials. Please try again.');
                    setIsLoading(false);
                    return;
                }

                const countryId = user?.countryId;
                if (!countryId) {
                    setError('Server error: Country information missing.');
                    setIsLoading(false);
                    return;
                }

                await persistSession(token, user, countryId);
                router.replace('/dashboard');
                syncPushTokenToBackend(token); // <-- NEW
                return;
            }

            // Owner login failed with invalid credentials — this email/password
            // might belong to an admin (staff) account instead. Admin accounts
            // live in a separate table with their own login route, so try that
            // before giving up. Any other kind of failure (server error, etc.)
            // is reported as-is without this fallback.
            if (response.status === 401) {
                const staffResponse = await fetch(`${API_BASE_URL}/api/staff-auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
                });

                const staffData = await staffResponse.json();

                if (staffResponse.ok && staffData.success && staffData.data?.token) {
                    const { token, user, forcePasswordChange } = staffData.data;
                    await persistSession(token, user, null);

                    if (forcePasswordChange) {
                        syncPushTokenToBackend(token); // <-- NEW
                        router.replace({ pathname: '/(auth)/change-temp-password', params: { tempPassword: password } } as any);
                    } else {
                        router.replace('/dashboard');
                        syncPushTokenToBackend(token); // <-- NEW
                    }
                    return;
                }

                if (staffData.code === 'ACCOUNT_DEACTIVATED') {
                    setError(staffData.error);
                } else {
                    setError('Invalid email or password');
                }
                setIsLoading(false);
                return;
            }

            setError(data.error || data.message || 'Invalid email or password');
            setIsLoading(false);
        } catch (err) {
            setError('Login failed. Please try again.');
            setIsLoading(false);
        }
    };

    const isTiny = width < 300;

    return (
        <ThemedView style={{ flex: 1, backgroundColor: C.background }}>
            <ImageBackground
                source={{ uri: 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?q=80&w=2071' }}
                style={styles.hero}
            >
                <LinearGradient
                    colors={C.isDark ? ['rgba(10, 15, 30, 0.7)', 'rgba(15, 23, 42, 0.95)'] : ['rgba(255, 255, 255, 0.4)', 'rgba(248, 250, 252, 0.95)']}
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
                                <Ionicons name="arrow-back" size={20} color={C.text} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.homeBtn}
                                onPress={() => {
                                    router.replace('/home');
                                }}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="home-outline" size={18} color={C.text} />
                            </TouchableOpacity>
                            <View style={styles.logoBadge}>
                                <Image source={require('../../assets/images/sabino.jpeg')} style={{ width: 40, height: 40, borderRadius: 20 }} />
                                <ThemedText style={styles.logoText}>SABINO EDU</ThemedText>
                            </View>
                            <ThemedText style={styles.title}>School Login</ThemedText>
                            <View style={styles.goldBar} />
                            <ThemedText style={styles.subtitle}>Secure Access to Management</ThemedText>
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
                                label="School Email"
                                placeholder="Email address"
                                keyboardType="email-address"
                                value={email}
                                onChangeText={setEmail}
                                editable={!isLoading}
                                containerStyle={styles.inputContainer}
                                labelStyle={{ fontSize: 10 }}
                            />

                            <CustomInput
                                label="Password"
                                placeholder="Password"
                                isPassword
                                value={password}
                                onChangeText={setPassword}
                                editable={!isLoading}
                                containerStyle={styles.inputContainer}
                                labelStyle={{ fontSize: 10 }}
                            />

                            <CustomButton
                                title={isLoading ? "AUTHENTICATING..." : "LOGIN TO DASHBOARD"}
                                onPress={handleLogin}
                                disabled={isLoading}
                                loading={isLoading}
                                variant="premium"
                                style={styles.loginButton}
                                textStyle={{ fontSize: 12 }}
                            />

                            <TouchableOpacity
                                onPress={() => router.push('/(auth)/forgot-password')}
                                style={{ alignSelf: 'center', marginTop: 16 }}
                                disabled={isLoading}
                            >
                                <ThemedText style={styles.forgotText}>FORGOT PASSWORD?</ThemedText>
                            </TouchableOpacity>

                            <View style={styles.divider} />

                            <View style={styles.registerSection}>
                                <ThemedText style={styles.registerLabel}>New institution?</ThemedText>
                                <CustomButton
                                    title="REGISTER YOUR SCHOOL"
                                    onPress={() => router.push('/(auth)/verify-email')}
                                    disabled={isLoading}
                                    variant="outline"
                                    style={styles.registerButton}
                                    textStyle={{ color: Colors.accent.blue, fontWeight: '800', fontSize: 11 }}
                                />

                                <TouchableOpacity
                                    style={styles.studentChannel}
                                    onPress={() => router.push('/(auth)/redeem-code' as any)}
                                >
                                    <ThemedText style={styles.studentChannelText}>
                                        Have a staff invite code? <ThemedText style={styles.studentChannelHighlight}>Register here</ThemedText>
                                    </ThemedText>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.studentChannel}
                                    onPress={() => router.push('/(student)' as any)}
                                >
                                    <ThemedText style={styles.studentChannelText}>
                                        Are you a student? <ThemedText style={styles.studentChannelHighlight}>Login here</ThemedText>
                                    </ThemedText>
                                </TouchableOpacity>
                            </View>
                        </View>

                        <View style={styles.footer}>
                            <ThemedText style={styles.footerText}>© {new Date().getFullYear()} SABINO EDU SYSTEMS GLOBAL</ThemedText>
                            <ThemedText style={styles.footerSubtext}>THE GOLD STANDARD FOR REPORTING</ThemedText>
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

        header: { alignItems: 'center', marginBottom: isTiny ? 24 : 34, width: '100%' },
        backBtn: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 36,
            height: 36,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: C.actionItemBg,
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
            backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: C.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
        },
        logoText: { color: Colors.accent.gold, fontSize: 11, fontWeight: '900', marginLeft: 8, letterSpacing: 2 },
        title: { fontSize: isTiny ? 24 : 28, fontWeight: '900', color: C.text, letterSpacing: -1 },
        goldBar: { width: 40, height: 3, backgroundColor: Colors.accent.gold, borderRadius: 1.5, marginVertical: 12 },
        subtitle: { fontSize: 12, color: C.textSecondary, fontWeight: '500', textAlign: 'center' },

        card: {
            backgroundColor: C.card,
            borderRadius: 28,
            padding: isTiny ? 20 : 26,
            borderWidth: 1,
            borderColor: C.cardBorder,
        },
        inputContainer: {
            backgroundColor: C.inputBg,
            borderColor: C.inputBorder,
            marginBottom: 14,
        },
        loginButton: {
            marginTop: 10,
            borderRadius: 12,
            height: 52,
        },
        forgotText: {
            color: C.textSecondary,
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 1,
        },
        divider: {
            height: 1,
            backgroundColor: C.divider,
            marginVertical: 20,
        },
        registerSection: { alignItems: 'center' },
        registerLabel: { color: C.textMuted, fontSize: 11, marginBottom: 12, fontWeight: '600' },
        registerButton: {
            borderColor: '#2563EB',
            borderWidth: 2,
            borderRadius: 12,
            width: '100%',
            height: 48,
            marginBottom: 16,
        },
        studentChannel: {
            marginTop: 24,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: C.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
            width: '100%',
            alignItems: 'center'
        },
        studentChannelText: {
            color: C.textSecondary,
            fontSize: 12,
            fontWeight: '600'
        },
        studentChannelHighlight: {
            color: Colors.accent.gold,
            fontWeight: '900'
        },
        footer: { marginTop: 34, alignItems: 'center' },
        footerText: { color: C.textLabel, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
        footerSubtext: { color: C.textSecondary, fontSize: 8, fontWeight: '900', marginTop: 4 }
    });
}