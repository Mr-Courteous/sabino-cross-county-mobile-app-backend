import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

type FooterProps = {
  themeColor?: string;
  schoolName?: string | null;
  onLogout: () => void;
};

export default function Footer({ themeColor = '#FACC15', schoolName = 'SABINO EDU', onLogout }: FooterProps) {
  const { width } = useWindowDimensions();
  const isTiny = width < 300;

  return (
    <View style={[styles.wrap, { paddingHorizontal: isTiny ? 14 : 20 }]}>
      <LinearGradient colors={[themeColor + '10', '#ffffff00']} style={[styles.container, { borderColor: themeColor + '22' }]}> 
        <View style={styles.row}>
          <View style={styles.brandRow}>
            <View style={[styles.brandCircle, { backgroundColor: themeColor + '20', width: isTiny ? 34 : 42, height: isTiny ? 34 : 42 }]}>
              <Ionicons name="school" size={isTiny ? 16 : 18} color={themeColor} />
            </View>
            <Text style={[styles.schoolName, { fontSize: isTiny ? 11 : 13 }]} numberOfLines={1}>{schoolName || 'SABINO EDU'}</Text>
          </View>

          <TouchableOpacity style={[styles.logoutBtn, { borderColor: themeColor, paddingVertical: isTiny ? 6 : 8, paddingHorizontal: isTiny ? 10 : 12 }]} onPress={onLogout} activeOpacity={0.8}>
            <Ionicons name="power" size={isTiny ? 14 : 16} color={themeColor} />
            {!isTiny && <Text style={[styles.logoutText, { color: themeColor }]}>Logout</Text>}
          </TouchableOpacity>
        </View>

        <Text style={[styles.copy, { fontSize: isTiny ? 9 : 11 }]}>© {new Date().getFullYear()} {schoolName || 'SABINO EDU'}. All rights reserved.</Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 18, paddingBottom: 8 },
  container: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 },
  brandCircle: { borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  schoolName: { fontWeight: '900', color: '#0F172A', flexShrink: 1 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, borderWidth: 1 },
  logoutText: { marginLeft: 8, fontWeight: '900', fontSize: 11 },
  copy: { marginTop: 8, color: '#64748B', fontWeight: '700' }
});
