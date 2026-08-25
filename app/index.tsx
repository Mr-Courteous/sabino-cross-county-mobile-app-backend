import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, TouchableOpacity, View, ImageBackground, useWindowDimensions, Image } from 'react-native';
import { useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppColors } from '@/hooks/use-app-colors';
import { Colors } from '@/constants/design-system';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function HomePage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);

  function FeatureCard({ icon, title, desc }: any) {
    return (
      <View style={styles.fCard}>
        <View style={styles.iconCircle}>
          <Ionicons name={icon} size={width < 300 ? 20 : 22} color={C.isDark ? "#fff" : "#2563EB"} />
        </View>
        <ThemedText style={styles.fTitle}>{title}</ThemedText>
        <ThemedText style={styles.fDesc}>{desc}</ThemedText>
      </View>
    );
  }

  return (
    <ThemedView style={styles.mainWrapper}>
      <StatusBar style={C.isDark ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>

        <ImageBackground
          source={{ uri: 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?q=80&w=2071' }}
          style={styles.hero}
        >
          <LinearGradient
            colors={C.isDark ? ['rgba(10, 15, 30, 0.8)', 'rgba(15, 23, 42, 0.98)'] : ['rgba(255, 255, 255, 0.4)', 'rgba(248, 250, 252, 0.98)']}
            style={styles.overlay}
          >
            <View style={styles.logoBadge}>
              <Image source={require('../assets/images/sabino.jpeg')} style={{ width: width < 300 ? 32 : 40, height: width < 300 ? 32 : 40, borderRadius: 20 }} />
              <ThemedText style={styles.logoText}>SABINO EDU</ThemedText>
            </View>

            {/* ULTRA BOLD HEADER */}
            <ThemedText style={styles.title}>EXCELLENCE{'\n'}IN EVERY{'\n'}RESULT</ThemedText>
            <View style={styles.goldBar} />

            <ThemedText style={styles.tagline}>
              Empowering schools with precision tracking and professional digital identity.
            </ThemedText>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.ctaButton}
                onPress={() => router.push('/(auth)/verify-email')}
              >
                <ThemedText style={styles.ctaButtonText}>CREATE ACCOUNT</ThemedText>
                <Ionicons name="arrow-forward-circle" size={20} color="#fff" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            </View>

            <View style={styles.secondaryButtonRow}>
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.studentLoginButton}
                onPress={() => router.push('/(student)' as any)}
              >
                <Ionicons name="person-outline" size={18} color={C.isDark ? "#fff" : "#2563EB"} style={{ marginRight: 6 }} />
                <ThemedText style={styles.studentLoginText}>STUDENTS' LOGIN</ThemedText>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </ImageBackground>

        <View style={styles.content}>
          <ThemedText style={styles.sectionLabel}>CORE FEATURES</ThemedText>
          <ThemedText style={styles.sectionTitle}>Precision Tools for Educators</ThemedText>

          <View style={styles.featureGrid}>
            <FeatureCard icon="stats-chart" title="Smart Analytics" desc="Instant ranking & class positions." />
            <FeatureCard icon="color-wand" title="Custom Branding" desc="Personalized logos & digital stamps." />
            <FeatureCard icon="notifications" title="Quick Alerts" desc="Keep parents informed instantly." />
            <FeatureCard icon="lock-closed" title="Secure Access" desc="1-hour encrypted sessions." />
          </View>

          <TouchableOpacity style={styles.loginOutline} onPress={() => router.push('/(auth)')}>
            <ThemedText style={styles.loginOutlineText}>ALREADY REGISTERED? SIGN IN</ThemedText>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <ThemedText style={styles.footerBrand}>SABINO EDU</ThemedText>
          <ThemedText style={styles.footerCopyright}>THE GOLD STANDARD FOR ACADEMIC REPORTING</ThemedText>
          <View style={styles.footerDivider} />
          <ThemedText style={styles.footerYear}>© {new Date().getFullYear()} SABINO EDU. ALL RIGHTS RESERVED.</ThemedText>
        </View>

      </ScrollView>
    </ThemedView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isSmall = width < 380;
  const isTiny = width < 300;

  return StyleSheet.create({
    mainWrapper: { flex: 1, backgroundColor: C.background },
    scrollContainer: { flexGrow: 1 },

    hero: { width: '100%', minHeight: isSmall ? 600 : 700, paddingBottom: isTiny ? 20 : 45 },
    overlay: { flex: 1, paddingHorizontal: isTiny ? 15 : 20, paddingVertical: isTiny ? 40 : 60, justifyContent: 'center', alignItems: 'center' },

    logoBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
      paddingHorizontal: isTiny ? 10 : 16,
      paddingVertical: isTiny ? 6 : 10,
      borderRadius: 12,
      marginBottom: isTiny ? 15 : 25,
      borderWidth: 1,
      borderColor: C.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'
    },
    logoText: { color: Colors.accent.gold, fontSize: isTiny ? 10 : 11, fontWeight: '900', marginLeft: 8, letterSpacing: 2 },

    title: {
      fontSize: isTiny ? 28 : isSmall ? 32 : 38,
      fontWeight: '700',
      color: C.isDark ? '#fff' : Colors.accent.navy,
      textAlign: 'center',
      lineHeight: isTiny ? 36 : isSmall ? 40 : 46,
      letterSpacing: -1
    },
    goldBar: { width: 60, height: 5, backgroundColor: Colors.accent.gold, borderRadius: 3, marginVertical: isTiny ? 15 : 20 },

    tagline: { fontSize: isTiny ? 12 : 14, color: C.textSecondary, textAlign: 'center', paddingHorizontal: 10, lineHeight: isTiny ? 20 : 24, fontWeight: '500' },

    ctaButton: {
      flexDirection: 'row',
      backgroundColor: '#2563EB',
      paddingVertical: isTiny ? 14 : 16,
      paddingHorizontal: isTiny ? 15 : 25,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#2563EB',
      shadowOpacity: 0.5,
      shadowRadius: 20,
      elevation: 8,
      flex: isTiny ? 1 : 0,
    },
    ctaButtonText: { color: '#fff', fontWeight: '900', fontSize: isTiny ? 12 : 13, letterSpacing: 0.5 },

    buttonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: isTiny ? 8 : 12,
      marginTop: isTiny ? 30 : 40,
      flexWrap: 'wrap',
      width: '100%',
    },

    pricingButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(250, 204, 21, 0.1)',
      paddingVertical: isTiny ? 14 : 16,
      paddingHorizontal: isTiny ? 15 : 25,
      borderRadius: 15,
      borderWidth: 1.5,
      borderColor: '#FACC15',
      flex: isTiny ? 1 : 0,
    },
    pricingButtonText: { color: '#FACC15', fontWeight: '900', fontSize: isTiny ? 12 : 13, letterSpacing: 0.5 },

    secondaryButtonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
      width: '100%',
    },

    studentLoginButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.isDark ? 'rgba(255,255,255,0.1)' : '#fff',
      paddingVertical: isTiny ? 10 : 12,
      paddingHorizontal: isTiny ? 15 : 25,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.isDark ? 'rgba(255,255,255,0.2)' : '#E2E8F0',
      flex: isTiny ? 1 : 0,
    },
    studentLoginText: { color: C.isDark ? '#fff' : '#2563EB', fontWeight: '900', fontSize: isTiny ? 11 : 12, letterSpacing: 0.5 },

    content: {
      padding: isTiny ? 15 : 24,
      backgroundColor: C.background,
      borderTopLeftRadius: 45,
      borderTopRightRadius: 45,
      marginTop: -45,
      paddingBottom: 50
    },
    sectionLabel: { color: '#2563EB', fontSize: 10, fontWeight: '900', letterSpacing: 2, textAlign: 'center', marginBottom: 8 },
    sectionTitle: { fontSize: isTiny ? 20 : 24, fontWeight: '900', color: C.text, textAlign: 'center', marginBottom: isTiny ? 25 : 35, letterSpacing: -0.5 },

    featureGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    fCard: {
      width: isTiny ? '100%' : (width - 64) / 2,
      backgroundColor: C.card,
      padding: isTiny ? 18 : 22,
      borderRadius: 25,
      marginBottom: 16,
      borderWidth: 1.5,
      borderColor: C.cardBorder
    },
    iconCircle: { width: 44, height: 44, borderRadius: 16, backgroundColor: C.isDark ? '#1e293b' : '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 12, elevation: 2 },
    fTitle: { fontSize: isTiny ? 13 : 14, fontWeight: '900', color: C.text, letterSpacing: -0.3 },
    fDesc: { fontSize: isTiny ? 10 : 11, color: C.textSecondary, marginTop: 6, lineHeight: 18, fontWeight: '500' },

    loginOutline: {
      backgroundColor: '#2563EB',
      marginTop: isTiny ? 15 : 25,
      padding: isTiny ? 16 : 18,
      borderRadius: 15,
      alignItems: 'center',
      shadowColor: '#2563EB',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 8,
    },
    loginOutlineText: { color: '#fff', fontWeight: '900', fontSize: isTiny ? 12 : 13, letterSpacing: 0.8 },

    footer: { backgroundColor: C.isDark ? '#0F172A' : '#F1F5F9', paddingVertical: isTiny ? 40 : 60, paddingHorizontal: 20, alignItems: 'center' },
    footerBrand: { color: C.text, fontSize: isTiny ? 18 : 22, fontWeight: '900', letterSpacing: 4 },
    footerCopyright: { color: C.textMuted, fontSize: 8, fontWeight: '800', marginTop: 12, letterSpacing: 0.5, textAlign: 'center' },
    footerInfo: { color: C.textMuted, fontSize: 8, fontWeight: '600', marginTop: 4, letterSpacing: 0.5 },
    footerContact: { color: C.textMuted, fontSize: 8, fontWeight: '600', marginTop: 4 },
    footerDivider: { width: 40, height: 2, backgroundColor: Colors.accent.gold, marginVertical: 20 },
    footerYear: { color: C.textLabel, fontSize: 9, fontWeight: 'bold' }
  });
}