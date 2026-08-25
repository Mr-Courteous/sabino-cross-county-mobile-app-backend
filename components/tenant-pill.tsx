import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

export default function TenantPill({ tenants = ['OAGS PORTAL', 'OAGS ACADEMY', 'OAGS PRIMARY'] }: { tenants?: string[] }) {
  const [index, setIndex] = useState(0);
  const { width } = useWindowDimensions();
  const isTiny = width < 300;

  return (
    <TouchableOpacity style={[styles.pill, { minWidth: isTiny ? 100 : 130 }]} onPress={() => setIndex((i) => (i + 1) % tenants.length)} activeOpacity={0.85}>
      <View>
        <Text style={[styles.title, { fontSize: isTiny ? 8 : 9 }]}>Organization</Text>
        <Text style={[styles.name, { fontSize: isTiny ? 11 : 12 }]}>{tenants[index]}</Text>
      </View>
      {!isTiny && <Text style={styles.hint}>Switch</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, elevation: 2 },
  title: { color: '#64748B', fontWeight: '800', letterSpacing: 0.5 },
  name: { fontWeight: '900', color: '#0F172A' },
  hint: { fontSize: 10, color: '#94A3B8', fontWeight: '600' },
});
