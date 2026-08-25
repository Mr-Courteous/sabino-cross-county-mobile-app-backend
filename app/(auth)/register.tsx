import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import {
    View,
    ScrollView,
    ImageBackground,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import {
    Colors,
} from '@/constants/design-system';

export default function RegisterScreen() {
    const router = useRouter();
    const { width } = useWindowDimensions();
    const styles = useMemo(() => makeStyles(width), [width]);

    return (
        <ThemedView style={{ flex: 1, backgroundColor: Colors.accent.navy }}>
            <ImageBackground
                source={{ uri: 'https://images.unsplash.com/photo-1523050853064-8504f2f495d7?q=80&w=2070' }}
                style={styles.hero}
            >
                <LinearGradient
                    colors={['rgba(10, 15, 30, 0.8)', 'rgba(15, 23, 42, 0.98)']}
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
                            <Text style={styles.title}>Registration</Text>
                            <View style={styles.goldBar} />
                            <Text style={styles.subtitle}>Join the Platinum Standard</Text>
                        </View>

                        <View style={styles.card}>
                            <CustomAlert
                                type="info"
                                title="ENROLLMENT"
                                message="Verify email, OTP, and school profile."
                                style={{ marginBottom: 20 }}
                            />

                            <View style={styles.featureList}>
                                <FeatureItem icon="shield-checkmark" text="Secure Session Encryption" />
                                <FeatureItem icon="cloud-done" text="Instant Data Sync" />
                                <FeatureItem icon="color-palette" text="Custom Portal Branding" />
                            </View>

                            <CustomButton
                                title="START REGISTRATION"
                                onPress={() => router.push('/(auth)/verify-email')}
                                variant="premium"
                                style={styles.ctaButton}
                            />

                            <View style={styles.divider} />

                            <View style={styles.loginSection}>
                                <Text style={styles.loginLabel}>Already registered?</Text>
                                <CustomButton
                                    title="BACK TO LOGIN"
                                    onPress={() => router.push('/(auth)')}
                                    variant="outline"
                                    style={styles.outlineButton}
                                    textStyle={{ color: '#fff', fontWeight: '800', fontSize: 12 }}
                                />
                            </View>
                        </View>

                        <View style={styles.footer}>
                            <Text style={styles.footerText}>SECURE ADMINISTRATION SYSTEM</Text>
                        </View>
                    </ScrollView>
                </LinearGradient>
            </ImageBackground>
        </ThemedView>
    );
}

function FeatureItem({ icon, text }: { icon: keyof typeof Ionicons.glyphMap, text: string }) {
    return (
        <View style={styles.featureItem}>
            <Ionicons name={icon} size={18} color="#2563EB" />
            <Text style={styles.featureText}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    featureItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    featureText: { color: '#E2E8F0', marginLeft: 10, fontSize: 12, fontWeight: '500' },
} as any);

function makeStyles(width: number) {
    const isTiny = width < 300;
    return StyleSheet.create({
        hero: { flex: 1, width: '100%' },
        overlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24 },
        scrollContainer: { flexGrow: 1, justifyContent: 'center', paddingVertical: isTiny ? 40 : 60 },
        
        header: { alignItems: 'center', marginBottom: isTiny ? 24 : 40 },
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
        logoBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.08)',
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)'
        },
        logoText: { color: '#FACC15', fontSize: 11, fontWeight: '900', marginLeft: 8, letterSpacing: 2 },
        title: { fontSize: isTiny ? 26 : 30, fontWeight: '900', color: '#fff', letterSpacing: -1 },
        goldBar: { width: 40, height: 3, backgroundColor: '#FACC15', borderRadius: 2, marginVertical: 12 },
        subtitle: { fontSize: 12, color: '#94A3B8', fontWeight: '500' },

        card: {
            backgroundColor: 'rgba(30, 41, 59, 0.7)',
            borderRadius: 28,
            padding: isTiny ? 20 : 26,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
        },
        featureList: { marginBottom: 24 },
        
        ctaButton: { height: 52, borderRadius: 12 },
        divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 24 },
        
        loginSection: { alignItems: 'center' },
        loginLabel: { color: '#2563EB', fontSize: 11, marginBottom: 14, fontWeight: '600' },
        outlineButton: { borderColor: '#2563EB', borderWidth: 1.5, borderRadius: 12, width: '100%', height: 48 },
        
        footer: { marginTop: 30, alignItems: 'center' },
        footerText: { color: '#334155', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    });
}