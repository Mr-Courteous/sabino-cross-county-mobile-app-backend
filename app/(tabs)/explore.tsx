import { Image } from 'expo-image';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { Collapsible } from '@/components/ui/collapsible';
import { ExternalLink } from '@/components/external-link';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function TabTwoScreen() {
  const { width } = useWindowDimensions();
  const isTiny = width < 300;

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={isTiny ? 200 : 310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title" style={{ fontSize: isTiny ? 26 : 30 }}>Explore</ThemedText>
      </ThemedView>
      <ThemedText style={{ fontSize: isTiny ? 12 : 14 }}>Core system features and developer information.</ThemedText>
      
      <Collapsible title="Portal Architecture">
        <ThemedText style={{ fontSize: isTiny ? 11 : 13 }}>
          This portal uses a high-performance file-based router. All administrative routes are located in <ThemedText type="defaultSemiBold">app/</ThemedText> while auth flows reside in <ThemedText type="defaultSemiBold">app/(auth)</ThemedText>.
        </ThemedText>
      </Collapsible>

      <Collapsible title="Cross-Platform Support">
        <ThemedText style={{ fontSize: isTiny ? 11 : 13 }}>
          The Sabino Edu application is optimized for Android, iOS, and Web. Responsive design logic ensures accessibility from 250px viewports upward.
        </ThemedText>
      </Collapsible>

      <Collapsible title="Security Protocols">
        <ThemedText style={{ fontSize: isTiny ? 11 : 13 }}>
          All data exchanges are encrypted. The system uses SecureStore for mobile credentials and localStorage for web persistence.
        </ThemedText>
      </Collapsible>

      <Collapsible title="Asset Delivery">
        <ThemedText style={{ fontSize: isTiny ? 11 : 13 }}>
          Static assets are delivered using Expo Image for optimized caching and blurred placeholders during loading.
        </ThemedText>
        <Image
          source={require('@/assets/images/react-logo.png')}
          style={{ width: 80, height: 80, alignSelf: 'center', marginTop: 10 }}
        />
      </Collapsible>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8
  },
});
