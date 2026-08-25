import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Platform,
  ImageBackground, RefreshControl, Modal, useWindowDimensions
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { API_BASE_URL } from '@/utils/api-service';
import { isSchoolOwner } from '@/utils/jwt-decoder';
import { useTheme } from '@/contexts/theme-context';
import { Colors } from '@/constants/design-system';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { CustomButton } from '@/components/custom-button';
import { CustomAlert } from '@/components/custom-alert';
import { useAppColors } from '@/hooks/use-app-colors';

const SWATCHES = [
  '#1E40AF', '#2563EB', '#0EA5E9', '#059669',
  '#10B981', '#D97706', '#EF4444', '#EC4899',
  '#8B5CF6', '#1E293B', '#475569', '#FACC15',
];

export default function SchoolPreferencesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const { themeColor, loadThemeFromPreferences, themeMode, setThemeMode } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Only the owner can edit branding; admins can still view this screen
  // read-only if they land on it via a deep link. Display Mode (light/
  // dark/system) is a personal device preference, not synced branding —
  // that stays available to everyone regardless of role.
  const [isOwner, setIsOwner] = useState(true);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pickerColor, setPickerColor] = useState('#2563EB');
  
  const isLargeScreen = width > 768;
  const contentWidth = isLargeScreen ? 700 : width;

  const [statusAlert, setStatusAlert] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
  }>({
    visible: false,
    type: 'info',
    title: '',
    message: '',
  });

  const [prefs, setPrefs] = useState({
    theme_color: '#2563EB',
    logo_url: '',
    stamp_url: '',
    report_footer_text: '',
    show_attendance: false,
  });

  const [logoFile, setLogoFile] = useState<any>(null);
  const [stampFile, setStampFile] = useState<any>(null);

  const getAuthData = async () => {
    const token = Platform.OS === 'web'
      ? localStorage.getItem('userToken')
      : await SecureStore.getItemAsync('userToken');
    const userDataStr = Platform.OS === 'web'
      ? localStorage.getItem('userData')
      : await SecureStore.getItemAsync('userData');

    const schoolId = JSON.parse(userDataStr || '{}').schoolId;
    return { token, schoolId };
  };

  const fetchPreferences = useCallback(async () => {
    try {
      const { token, schoolId } = await getAuthData();
      if (!token || !schoolId) return;

      setIsOwner(isSchoolOwner(token));

      const response = await fetch(`${API_BASE_URL}/api/preferences/${schoolId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      });

      // Redirect to pricing if subscription required - check BEFORE parsing JSON
      if (response.status === 402) {
        router.replace('/pricing');
        return;
      }

      const data = await response.json();
      if (data.success) {
        const color = data.data.theme_color || '#2563EB';
        setPrefs({
          theme_color: color,
          logo_url: data.data.logo_url || '',
          stamp_url: data.data.stamp_url || '',
          report_footer_text: data.data.header_text || data.data.report_footer_text || '',
          show_attendance: data.data.show_attendance || false,
        });
        setPickerColor(color);
      }
    } catch (err) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Fetch Error',
        message: 'Unable to retrieve school branding profiles.'
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPreferences();
  };

  const handlePickDocument = async (type: 'logo' | 'stamp') => {
    try {
      // Uses the Android Photo Picker on Android 13+ (API 33+) automatically —
      // no READ_EXTERNAL_STORAGE permission needed. Falls back to the system
      // file picker on older Android versions. Uses Photos/Camera Roll on iOS.
      // The new mediaTypes array API (expo-image-picker v17+) is required to
      // trigger the native Android Photo Picker.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        allowsMultipleSelection: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const file = {
          uri: asset.uri,
          name: asset.fileName || `${type}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        };
        if (type === 'logo') {
          setLogoFile(file);
          setPrefs(prev => ({ ...prev, logo_url: asset.uri }));
        } else {
          setStampFile(file);
          setPrefs(prev => ({ ...prev, stamp_url: asset.uri }));
        }
      }
    } catch (err) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Selection Error',
        message: 'Failed to acquire asset from device gallery.'
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { token, schoolId } = await getAuthData();
      const formData = new FormData();

      formData.append('theme_color', prefs.theme_color);
      formData.append('header_text', prefs.report_footer_text);
      formData.append('show_attendance', String(prefs.show_attendance));

      if (logoFile) {
        if (Platform.OS === 'web' && logoFile.file) {
          formData.append('logo', logoFile.file);
        } else {
          const logoData: any = {
            uri: Platform.OS === 'ios' ? logoFile.uri.replace('file://', '') : logoFile.uri,
            name: logoFile.name || 'logo.png',
            type: logoFile.mimeType || 'image/png',
          };
          formData.append('logo', logoData);
        }
      } else if (prefs.logo_url) {
        formData.append('logo_url', prefs.logo_url);
      }

      if (stampFile) {
        if (Platform.OS === 'web' && stampFile.file) {
          formData.append('stamp', stampFile.file);
        } else {
          const stampData: any = {
            uri: Platform.OS === 'ios' ? stampFile.uri.replace('file://', '') : stampFile.uri,
            name: stampFile.name || 'stamp.png',
            type: stampFile.mimeType || 'image/png',
          };
          formData.append('stamp', stampData);
        }
      } else if (prefs.stamp_url) {
        formData.append('stamp_url', prefs.stamp_url);
      }

      const response = await fetch(`${API_BASE_URL}/api/preferences/${schoolId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      const result = await response.json();
      if (result.success) {
        await loadThemeFromPreferences();
        setStatusAlert({
          visible: true,
          type: 'success',
          title: 'Success',
          message: 'School branding updated.'
        });
        setLogoFile(null);
        setStampFile(null);
        fetchPreferences();
      } else {
        throw new Error(result.error || 'Update failed');
      }
    } catch (err: any) {
      setStatusAlert({
        visible: true,
        type: 'error',
        title: 'Error',
        message: err.message || 'Failed to save changes.'
      });
    } finally {
      setSaving(false);
    }
  };

  const selectColor = (hex: string) => {
    setPickerColor(hex);
    setPrefs(prev => ({ ...prev, theme_color: hex }));
    setShowColorPicker(false);
  };

  function AssetUploader({ title, subtitle, url, onUpload, icon }: any) {
    const isTiny = width < 300;
    return (
      <View style={styles.assetRow}>
        <View style={styles.assetPreview}>
          {url ? (
            <Image source={{ uri: url }} style={styles.assetImage} contentFit="contain" />
          ) : (
            <View style={styles.assetPlaceholder}>
              <Ionicons name={icon} size={22} color={C.isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"} />
            </View>
          )}
        </View>
        <View style={styles.assetInfo}>
          <ThemedText style={styles.assetTitle}>{title}</ThemedText>
          <ThemedText style={styles.assetSubtitle}>{subtitle}</ThemedText>
          {isOwner ? (
            <TouchableOpacity style={styles.uploadBtn} onPress={onUpload}>
              <Ionicons name="cloud-upload" size={12} color={Colors.accent.gold} />
              <ThemedText style={styles.uploadBtnText}>Select File</ThemedText>
            </TouchableOpacity>
          ) : (
            <View style={styles.uploadBtn}>
              <Ionicons name="lock-closed-outline" size={12} color={C.textMuted} />
              <ThemedText style={[styles.uploadBtnText, { color: C.textMuted }]}>Owner only</ThemedText>
            </View>
          )}
        </View>
      </View>
    );
  }

  function ThemeModeButton({ icon, label, isActive, onPress }: any) {
    const isTiny = width < 300;
    return (
      <TouchableOpacity
        onPress={onPress}
        style={[
          styles.themeModeBtn,
          {
            backgroundColor: isActive ? 'rgba(37,99,235,0.12)' : C.actionItemBg,
            borderColor: isActive ? '#2563EB' : C.cardBorder,
            borderWidth: isActive ? 2 : 1,
            padding: isTiny ? 8 : 10,
          }
        ]}
        activeOpacity={0.85}
      >
        <Ionicons name={icon} size={isTiny ? 16 : 18} color={isActive ? '#2563EB' : C.textSecondary} />
        <ThemedText style={[styles.themeModeLabel, { color: isActive ? '#2563EB' : C.textSecondary, fontSize: isTiny ? 10 : 11 }]}>{label}</ThemedText>
      </TouchableOpacity>
    );
  }

  if (loading) return (
    <ThemedView style={styles.loader}>
      <ActivityIndicator size="large" color={Colors.accent.gold} />
      <ThemedText style={styles.loadingText}>SYNCHRONIZING...</ThemedText>
    </ThemedView>
  );

  return (
    <ThemedView style={styles.mainWrapper}>
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?q=80&w=2074&auto=format&fit=crop' }}
        style={[styles.hero, { height: isLargeScreen ? 350 : 220 }]}
      >
        <LinearGradient
          colors={[C.isDark ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255, 255, 255, 0.7)', C.background]}
          style={styles.heroOverlay}
        >
          <View style={[styles.header, { maxWidth: 1200, alignSelf: 'center', width: '100%', marginBottom: isLargeScreen ? 60 : 16 }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="chevron-back" size={20} color={C.text} />
            </TouchableOpacity>
            <ThemedText style={styles.headerTitle}>System Branding</ThemedText>
            <View style={{ width: 40 }} />
          </View>

          <View style={[styles.heroContent, { maxWidth: contentWidth, alignSelf: 'center', width: '100%', marginBottom: isLargeScreen ? 60 : 20 }]}>
            <ThemedText style={styles.heroSubtitle}>VISUAL IDENTITY</ThemedText>
            <ThemedText style={styles.heroMainTitle}>Portal Theme</ThemedText>
          </View>
        </LinearGradient>
      </ImageBackground>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { maxWidth: contentWidth, alignSelf: 'center', width: '100%' }
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
      >
        {statusAlert.visible && (
          <CustomAlert
            type={statusAlert.type}
            title={statusAlert.title}
            message={statusAlert.message}
            onClose={() => setStatusAlert({ ...statusAlert, visible: false })}
            style={styles.alert}
          />
        )}

        <View style={styles.card}>
          <ThemedText style={styles.cardLabel}>SPECIFICATION</ThemedText>
          <TouchableOpacity
            style={[styles.colorTrigger, { borderColor: prefs.theme_color }]}
            onPress={() => isOwner && setShowColorPicker(true)}
            activeOpacity={isOwner ? 0.85 : 1}
          >
            <View style={[styles.colorDot, { backgroundColor: prefs.theme_color }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText style={styles.colorTriggerLabel}>Accent Color</ThemedText>
              <ThemedText style={styles.colorTriggerValue}>{prefs.theme_color.toUpperCase()}</ThemedText>
            </View>
            {!isOwner && <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <ThemedText style={styles.cardLabel}>DISPLAY MODE</ThemedText>
          <View style={styles.themeModeContainer}>
            <ThemeModeButton icon="sunny" label="Light" isActive={themeMode === 'light'} onPress={() => setThemeMode('light')} />
            <ThemeModeButton icon="moon" label="Dark" isActive={themeMode === 'dark'} onPress={() => setThemeMode('dark')} />
            <ThemeModeButton icon="phone-portrait" label="System" isActive={themeMode === 'system'} onPress={() => setThemeMode('system')} />
          </View>
        </View>

        <View style={styles.card}>
          <ThemedText style={styles.cardLabel}>IDENTITY ASSETS</ThemedText>
          <AssetUploader title="Emblem" subtitle="Logo file" url={prefs.logo_url} onUpload={() => handlePickDocument('logo')} icon="image-outline" />
          <View style={styles.divider} />
          <AssetUploader title="Official Stamp" subtitle="Verification" url={prefs.stamp_url} onUpload={() => handlePickDocument('stamp')} icon="ribbon-outline" />
        </View>

        <View style={styles.card}>
          <ThemedText style={styles.cardLabel}>FOOTER CONFIG</ThemedText>
          <TextInput
            style={styles.textArea}
            value={prefs.report_footer_text}
            onChangeText={(txt) => setPrefs({ ...prefs, report_footer_text: txt })}
            placeholder="Footer text..."
            placeholderTextColor={C.textMuted}
            multiline
            editable={isOwner}
          />
        </View>

        {!isOwner && (
          <View style={styles.noticeBanner}>
            <Ionicons name="information-circle-outline" size={16} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>Only the school owner can edit branding.</ThemedText>
          </View>
        )}

        {isOwner && (
          <View style={styles.actionRow}>
            <CustomButton title={saving ? "Applying..." : "Save Branding"} onPress={handleSave} loading={saving} variant="premium" style={{ paddingVertical: 14 }} />
          </View>
        )}
      </ScrollView>

      <Modal visible={showColorPicker} transparent animationType="fade" onRequestClose={() => setShowColorPicker(false)}>
        <View style={[styles.pickerOverlay, isLargeScreen && styles.pickerOverlayLarge]}>
          <View style={[styles.pickerSheet, isLargeScreen && { width: 450, borderRadius: 28, alignSelf: 'center' }]}>
            <View style={styles.pickerHeader}>
              <ThemedText style={styles.pickerTitle}>Color</ThemedText>
              <TouchableOpacity onPress={() => setShowColorPicker(false)} style={styles.pickerClose}>
                <Ionicons name="close" size={20} color={Colors.accent.gold} />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
              {SWATCHES.map((color) => (
                <TouchableOpacity
                  key={color}
                  onPress={() => selectColor(color)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: color,
                    borderWidth: prefs.theme_color === color ? 3 : 0,
                    borderColor: C.text,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  {prefs.theme_color === color && <Ionicons name="checkmark" size={20} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    mainWrapper: { flex: 1, backgroundColor: C.background },
    loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
    loadingText: { color: Colors.accent.gold, marginTop: 15, fontSize: 10, fontWeight: '800', letterSpacing: 2 },

    hero: { height: 220, width: '100%' },
    heroOverlay: { flex: 1, paddingHorizontal: 20, paddingTop: 50 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    backButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.backButton, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: C.text, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },

    heroContent: { marginTop: 'auto', marginBottom: 20 },
    heroSubtitle: { color: Colors.accent.gold, fontSize: 9, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
    heroMainTitle: { color: C.text, fontSize: isTiny ? 24 : 28, fontWeight: '900', letterSpacing: -1 },

    scrollView: { flex: 1, marginTop: -10 },
    scrollContent: { padding: 16, paddingBottom: 60 },
    alert: { marginBottom: 16 },

    card: { backgroundColor: C.card, borderRadius: 24, padding: isTiny ? 16 : 20, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 18 },
    cardLabel: { color: Colors.accent.gold, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 12 },
    helperText: { color: C.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 10 },
    
    themeModeBtn: { flex: 1, alignItems: 'center', borderRadius: 10 },
    themeModeLabel: { fontWeight: 'bold', marginTop: 4 },
    themeModeContainer: { flexDirection: 'row', gap: 6 },

    colorTrigger: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.actionItemBg, borderRadius: 16, padding: 12, borderWidth: 1.5, borderColor: C.cardBorder },
    colorDot: { width: 36, height: 36, borderRadius: 12, borderWidth: 1, borderColor: C.divider },
    colorTriggerLabel: { color: C.textLabel, fontSize: 8, fontWeight: '800', letterSpacing: 1.5, marginBottom: 2 },
    colorTriggerValue: { color: C.text, fontSize: 14, fontWeight: '900', letterSpacing: 1 },

    pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    pickerOverlayLarge: { justifyContent: 'center' },
    pickerSheet: { backgroundColor: C.modalBg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 30, borderTopWidth: 1, borderColor: C.cardBorder },
    pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
    pickerTitle: { color: C.text, fontSize: 18, fontWeight: '900' },
    pickerClose: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.actionIconWrap, justifyContent: 'center', alignItems: 'center' },

    assetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    assetPreview: { width: 60, height: 60, borderRadius: 16, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder, overflow: 'hidden' },
    assetImage: { width: '100%', height: '100%' },
    assetPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    assetInfo: { flex: 1, gap: 2 },
    assetTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
    assetSubtitle: { color: C.textMuted, fontSize: 10, fontWeight: '600' },
    uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    uploadBtnText: { color: Colors.accent.gold, fontSize: 10, fontWeight: '800' },
    
    divider: { height: 1, backgroundColor: C.divider, marginVertical: 16 },
    textArea: { backgroundColor: C.inputBg, borderRadius: 16, padding: 12, color: C.inputText, fontSize: 12, height: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: C.inputBorder },
    actionRow: { marginTop: 10 },

    noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, padding: 12, marginTop: 4, marginBottom: 8, borderWidth: 1, borderColor: C.cardBorder },
    noticeText: { flex: 1, color: C.textMuted, fontSize: 11, lineHeight: 15 },
  });
}