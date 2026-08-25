import React from 'react';
import { View, StyleSheet, TouchableOpacity, ImageBackground } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CustomButton } from '@/components/custom-button';
import { Colors } from '@/constants/design-system';

export default function AccessDeniedScreen() {
  const router = useRouter();

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="light" />
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2070' }}
        style={styles.hero}
      >
        <LinearGradient
          colors={['rgba(15,23,42,0.85)', 'rgba(15,23,42,0.99)']}
          style={styles.overlay}
        >
          <View style={styles.content}>
            <View style={styles.iconWrap}>
              <View style={styles.iconBg}>
                <Ionicons name="alert-circle" size={80} color="#FACC15" />
              </View>
            </View>

            <ThemedText style={styles.title}>Access Restricted</ThemedText>
            
            <View style={styles.messageCard}>
              <ThemedText style={styles.message}>
                Your school's access to the Sabino Edu platform is currently inactive.
              </ThemedText>
              <ThemedText style={styles.subMessage}>
                Please reach out to your school administrator or bursar to resolve this and restore your dashboard access.
              </ThemedText>
            </View>

            <CustomButton
              title="RETURN TO LOGIN"
              onPress={() => router.replace('/(student)' as any)}
              variant="outline"
              style={styles.button}
            />

            <ThemedText style={styles.footer}>
              Inaccessible. Contact your school admin for more enquiries.
            </ThemedText>
          </View>
        </LinearGradient>
      </ImageBackground>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A' },
  hero: { flex: 1, width: '100%' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { width: '100%', alignItems: 'center', maxWidth: 400 },
  iconWrap: { marginBottom: 32 },
  iconBg: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(250,204,21,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.2)',
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 24,
    textAlign: 'center',
  },
  messageCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 32,
    width: '100%',
  },
  message: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 26,
  },
  subMessage: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    width: '100%',
    height: 56,
    borderRadius: 16,
  },
  footer: {
    marginTop: 40,
    fontSize: 12,
    color: '#475569',
    textAlign: 'center',
    fontWeight: '600',
    fontStyle: 'italic',
  },
});
