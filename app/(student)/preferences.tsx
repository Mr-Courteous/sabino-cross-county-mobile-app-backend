import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  ImageBackground,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTheme } from '@/contexts/theme-context';
import { Colors } from '@/constants/design-system';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { useAppColors } from '@/hooks/use-app-colors';

export default function StudentPreferences() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { themeMode, setThemeMode } = useTheme();
  const C = useAppColors();
  const { styles, isTiny } = useMemo(() => makeStyles(C, width), [C.scheme, width]);

  return (
    <ThemedView style={styles.container}>
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?q=80&w=2074&auto=format&fit=crop' }}
        style={styles.hero}
      >
        <LinearGradient
          colors={[C.isDark ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255, 255, 255, 0.7)', C.background]}
          style={styles.heroOverlay}
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color={C.text} />
            </TouchableOpacity>
            <ThemedText style={styles.headerTitle}>PREFERENCES</ThemedText>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.heroContent}>
            <Text style={styles.heroSubtitle}>PERSONALIZATION</Text>
            <Text style={styles.heroTitle}>Appearance</Text>
          </View>
        </LinearGradient>
      </ImageBackground>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>THEME MODE</Text>
          <View style={styles.themeGrid}>
            <ThemeModeButton
              icon="moon"
              label="Dark"
              subtitle="OLED Optimized"
              isActive={themeMode === 'dark'}
              onPress={() => setThemeMode('dark')}
              C={C}
              styles={styles}
            />
            <ThemeModeButton
              icon="sunny"
              label="Light"
              subtitle="High Contrast"
              isActive={themeMode === 'light'}
              onPress={() => setThemeMode('light')}
              C={C}
              styles={styles}
              isTiny={isTiny}
            />
            <ThemeModeButton
              icon="settings"
              label="System"
              subtitle="Auto-adapt"
              isActive={themeMode === 'system'}
              onPress={() => setThemeMode('system')}
              C={C}
              styles={styles}
              isTiny={isTiny}
            />
          </View>
        </View>


      </ScrollView>
    </ThemedView>
  );
}

function ThemeModeButton({ icon, label, subtitle, isActive, onPress, C, styles, isTiny }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.themeButton,
        isActive && { borderColor: Colors.accent.gold, backgroundColor: Colors.accent.gold + '10' }
      ]}
    >
      <View style={[styles.themeIconWrap, isActive && { backgroundColor: Colors.accent.gold }]}>
        <Ionicons name={icon as any} size={18} color={isActive ? Colors.accent.navy : C.textSecondary} />
      </View>
      <View style={styles.themeInfo}>
        <Text style={[styles.themeLabel, isActive && { color: C.text }]}>{label}</Text>
        {!isTiny && <Text style={styles.themeSubtitle}>{subtitle}</Text>}
      </View>
      {isActive && <Ionicons name="checkmark-circle" size={18} color={Colors.accent.gold} />}
    </TouchableOpacity>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    hero: { width: '100%', height: isTiny ? 220 : 260 },
    heroOverlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24, paddingTop: Platform.OS === 'ios' ? 50 : 40 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: isTiny ? 24 : 40 },
    backButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 2, color: C.text },
    
    heroContent: { marginTop: 'auto', marginBottom: 20 },
    heroSubtitle: { color: Colors.accent.gold, fontSize: 9, fontWeight: '900', letterSpacing: 2, marginBottom: 4 },
    heroTitle: { color: C.text, fontSize: isTiny ? 24 : 30, fontWeight: '900', letterSpacing: -1 },

    content: { flex: 1, marginTop: -20, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: C.background, paddingHorizontal: isTiny ? 16 : 24, paddingTop: 24 },
    section: { marginBottom: 24 },
    sectionLabel: { color: C.textLabel, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 16 },
    
    themeGrid: { gap: 10 },
    themeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.card,
      padding: isTiny ? 12 : 14,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: C.cardBorder,
    },
    themeIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: C.actionIconWrap,
      justifyContent: 'center',
      alignItems: 'center',
    },
    themeInfo: { flex: 1, marginLeft: 12 },
    themeLabel: { color: C.textSecondary, fontSize: 14, fontWeight: '800' },
    themeSubtitle: { color: C.textMuted, fontSize: 11, fontWeight: '600', marginTop: 1 },

    infoCard: {
      flexDirection: 'row',
      backgroundColor: C.isDark ? 'rgba(250, 204, 21, 0.05)' : '#FEFCE8',
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.isDark ? 'rgba(250, 204, 21, 0.1)' : '#FEF9C3',
      alignItems: 'center',
      gap: 10,
    },
    infoText: { flex: 1, color: C.isDark ? '#94A3B8' : '#71717A', fontSize: 11, lineHeight: 16, fontWeight: '500' },
  });

  return { styles, isTiny };
}
