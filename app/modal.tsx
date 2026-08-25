import { Link } from 'expo-router';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/design-system';

export default function ModalScreen() {
  const { width } = useWindowDimensions();
  const isTiny = width < 300;

  return (
    <ThemedView style={[styles.container, { padding: isTiny ? Spacing.lg : Spacing.xl }]}>
      <ThemedText type="title">System Modal</ThemedText>
      <Link href="/" dismissTo style={styles.link}>
        <ThemedText type="link">Return to Portal</ThemedText>
      </Link>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
  },
});
