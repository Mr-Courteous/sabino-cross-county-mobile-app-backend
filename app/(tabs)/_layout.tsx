import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { TouchableOpacity, Text, Alert, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { clearAllStorage } from '@/utils/storage';

export default function TabLayout() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTiny = width < 300;

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const ok = window.confirm('Logout of Sabino Edu?');
      if (ok) {
        try { await clearAllStorage(); } catch (e) { }
        router.replace('/');
      }
      return;
    }

    Alert.alert('Logout', 'Logout of Sabino Edu?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', onPress: async () => { try { await clearAllStorage(); } catch (e) { } router.replace('/'); }, style: 'destructive' }
    ]);
  };

  return (
    <Tabs
      screenOptions={{
        headerRight: () => (
          <TouchableOpacity
            onPress={handleLogout}
            style={{ marginRight: isTiny ? 10 : 15, flexDirection: 'row', alignItems: 'center' }}
          >
            <Ionicons name="log-out" size={18} color="#EF4444" />
            {!isTiny && <Text style={{ color: '#EF4444', fontWeight: '700', marginLeft: 6, fontSize: 13 }}>Logout</Text>}
          </TouchableOpacity>
        ),
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#64748B',
        headerTitleStyle: { fontSize: isTiny ? 14 : 16, fontWeight: '800' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home" size={20} color={color} />,
          tabBarLabelStyle: { fontSize: 10 },
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: 'Students',
          tabBarIcon: ({ color }) => <Ionicons name="people" size={20} color={color} />,
          tabBarLabelStyle: { fontSize: 10 },
        }}
      />
    </Tabs>
  );
}