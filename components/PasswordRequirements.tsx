import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { validatePassword } from '@/utils/password-validator';

interface PasswordRequirementsProps { password: string; style?: any; }

export function PasswordRequirements({ password, style }: PasswordRequirementsProps) {
    const validation = validatePassword(password);
    const { width } = useWindowDimensions();
    const isTiny = width < 300;

    return (
        <View style={[styles.container, { padding: isTiny ? 8 : 12 }, style]}>
            <Text style={[styles.title, { fontSize: isTiny ? 10 : 11 }]}>Security Requirements:</Text>
            {validation.requirements.map((req, index) => (
                <View key={index} style={styles.requirement}>
                    <Ionicons name={req.met ? 'checkmark-circle' : 'close-circle'} size={isTiny ? 12 : 14} color={req.met ? '#10B981' : '#64748B'} style={styles.icon} />
                    <Text style={[styles.text, { fontSize: isTiny ? 10 : 11 }, req.met && styles.textMet]}>{req.label}</Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 10, marginTop: 6, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.08)' },
    title: { fontWeight: '800', color: '#E2E8F0', marginBottom: 6, letterSpacing: 0.5 },
    requirement: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
    icon: { marginRight: 6 },
    text: { color: '#64748B', fontWeight: '500' },
    textMet: { color: '#10B981', textDecorationLine: 'line-through', opacity: 0.7 },
});
