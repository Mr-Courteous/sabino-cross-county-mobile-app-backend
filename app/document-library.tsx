import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Linking,
  Modal,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { API_BASE_URL } from '@/utils/api-service';
import { getToken } from '@/utils/teacher-ai-api';
import { isSchoolOwner, decodeToken } from '@/utils/jwt-decoder';
import { Colors } from '@/constants/design-system';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';

type DocType = 'scheme_of_work' | 'lesson_plan' | 'lesson_note';
type Visibility = 'school' | 'personal' | 'submission';
type Tab = 'school' | 'mine' | 'review';

const TYPE_LABELS: Record<DocType, string> = {
  scheme_of_work: 'Scheme of Work',
  lesson_plan: 'Lesson Plan',
  lesson_note: 'Lesson Note',
};

interface DocRow {
  id: number;
  docType: DocType;
  visibility: Visibility;
  uploadedByType: 'owner' | 'staff';
  uploadedById: number;
  uploadedByName: string | null;
  title: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  reviewStatus: 'pending' | 'changes_requested' | 'approved' | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  file?: any; // web File object
}

export default function DocumentLibraryPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  // type=all → the unified "every file I can see" view (added because
  // the AI chat's file-reference picker aggregates across all three
  // types already, and teachers were finding files there that seemed
  // "missing" from this screen — they weren't missing, just filed under
  // a different type tab. This view mirrors that picker's scope.
  const isAllView = params.type === 'all';
  const docType = (isAllView ? null : ((params.type as DocType) || 'scheme_of_work')) as DocType | null;
  const label = docType ? TYPE_LABELS[docType] : 'All Files';
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;

  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('school');
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [canManageSchoolDocs, setCanManageSchoolDocs] = useState(false);
  const [identityType, setIdentityType] = useState<'owner' | 'staff'>('owner');
  const [identityId, setIdentityId] = useState<number | null>(null);

  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [uploadVisibility, setUploadVisibility] = useState<Visibility>('personal');
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [reviewModalDoc, setReviewModalDoc] = useState<DocRow | null>(null);
  const [reviewNoteInput, setReviewNoteInput] = useState('');
  const [reviewing, setReviewing] = useState<'approved' | 'changes_requested' | null>(null);

  const [alert, setAlert] = useState<{ visible: boolean; type: 'success' | 'error' | 'info'; message: string }>({
    visible: false,
    type: 'info',
    message: '',
  });

  const fetchDocs = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }

      const owner = isSchoolOwner(token);
      const decoded = decodeToken(token);
      setCanManageSchoolDocs(owner || decoded?.staffRole === 'admin');
      setIdentityType(decoded?.staffId ? 'staff' : 'owner');
      setIdentityId(decoded?.staffId ?? decoded?.id ?? null);

      const res = await fetch(`${API_BASE_URL}/api/document-library${docType ? `?docType=${docType}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 401) { router.replace('/(auth)'); return; }

      const result = await res.json();
      if (result.success) {
        setDocs(result.data || []);
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || `Failed to load ${isAllView ? 'your files' : label.toLowerCase() + 's'}.` });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, router]);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedOnce) {
        fetchDocs();
      } else {
        setLoading(true);
        fetchDocs();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchDocs])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchDocs();
  };

  const schoolDocs = useMemo(() => docs.filter((d) => d.visibility === 'school'), [docs]);
  const myDocs = useMemo(() => docs.filter((d) => d.visibility === 'personal'), [docs]);
  // Review tab: admins/owners see EVERY submission (their review queue);
  // a regular teacher only sees their own (so they can track status).
  const reviewDocs = useMemo(
    () =>
      docs.filter((d) => {
        if (d.visibility !== 'submission') return false;
        if (canManageSchoolDocs) return true;
        return d.uploadedByType === identityType && Number(d.uploadedById) === Number(identityId);
      }),
    [docs, canManageSchoolDocs, identityType, identityId]
  );

  const openUploadModal = (visibility: Visibility) => {
    setUploadVisibility(visibility);
    setPickedFile(null);
    setUploadTitle('');
    setUploadModalVisible(true);
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;

      setPickedFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || 'application/pdf',
        size: asset.size,
        file: (asset as any).file,
      });
      if (!uploadTitle) setUploadTitle(asset.name.replace(/\.(pdf|docx?|DOCX?|PDF)$/, ''));
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Could not open that file.' });
    }
  };

  const handleUpload = async () => {
    if (!pickedFile || !uploadTitle.trim()) return;
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }

      const formData = new FormData();
      formData.append('docType', docType);
      formData.append('visibility', uploadVisibility);
      formData.append('title', uploadTitle.trim());

      if (Platform.OS === 'web' && pickedFile.file) {
        formData.append('file', pickedFile.file);
      } else {
        formData.append('file', {
          uri: Platform.OS === 'ios' ? pickedFile.uri.replace('file://', '') : pickedFile.uri,
          name: pickedFile.name,
          type: pickedFile.mimeType,
        } as any);
      }

      const res = await fetch(`${API_BASE_URL}/api/document-library`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await res.json();

      if (result.success) {
        setUploadModalVisible(false);
        setAlert({
          visible: true,
          type: 'success',
          message: uploadVisibility === 'submission' ? `${label} submitted for review.` : `${label} uploaded.`,
        });
        setTab(uploadVisibility === 'submission' ? 'review' : uploadVisibility);
        fetchDocs();
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || 'Upload failed.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: DocRow) => {
    setDeletingId(doc.id);
    try {
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }

      const res = await fetch(`${API_BASE_URL}/api/document-library/${doc.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (result.success) {
        setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || 'Failed to delete.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setDeletingId(null);
    }
  };

  const openReviewModal = (doc: DocRow) => {
    setReviewModalDoc(doc);
    setReviewNoteInput('');
  };

  const submitReview = async (decision: 'approved' | 'changes_requested') => {
    if (!reviewModalDoc) return;
    if (decision === 'changes_requested' && !reviewNoteInput.trim()) {
      setAlert({ visible: true, type: 'error', message: 'Add a note explaining what needs to change.' });
      return;
    }
    setReviewing(decision);
    try {
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }

      const res = await fetch(`${API_BASE_URL}/api/document-library/${reviewModalDoc.id}/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: reviewNoteInput.trim() || undefined }),
      });
      const result = await res.json();
      if (result.success) {
        setReviewModalDoc(null);
        setAlert({
          visible: true,
          type: 'success',
          message: decision === 'approved' ? 'Approved — now in the School Library.' : 'Sent back for changes.',
        });
        fetchDocs();
      } else {
        setAlert({ visible: true, type: 'error', message: result.error || 'Failed to record decision.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setReviewing(null);
    }
  };

  const canDelete = (doc: DocRow) => {
    if (doc.visibility === 'school') return canManageSchoolDocs;
    return doc.uploadedByType === identityType && Number(doc.uploadedById) === Number(identityId);
  };

  const activeList = tab === 'school' ? schoolDocs : tab === 'mine' ? myDocs : reviewDocs;

  // Who can tap "+"? School tab -> admin/owner only. My Uploads -> always.
  // Review tab -> only a non-admin teacher SUBMITS here; admins/owners
  // only review on this tab, they don't upload from it. Never on the
  // unified All Files view — uploading needs one specific doc type, so
  // that still happens from the type-specific screen.
  const canAddOnCurrentTab =
    !isAllView &&
    ((tab === 'school' && canManageSchoolDocs) || tab === 'mine' || (tab === 'review' && !canManageSchoolDocs));

  const addButtonVisibility: Visibility = tab === 'school' ? 'school' : tab === 'review' ? 'submission' : 'personal';

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading {isAllView ? 'files' : `${label.toLowerCase()}s`}...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <StatusBar style={C.isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={isTiny ? 18 : 22} color={C.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle} numberOfLines={1}>{label}</ThemedText>
        {canAddOnCurrentTab ? (
          <TouchableOpacity onPress={() => openUploadModal(addButtonVisibility)} style={styles.addBtn}>
            <Ionicons name="add" size={isTiny ? 20 : 24} color="#0F172A" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: isTiny ? 36 : 40 }} />
        )}
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'school' && styles.tabBtnActive]} onPress={() => setTab('school')}>
          <ThemedText style={[styles.tabText, tab === 'school' && styles.tabTextActive]}>School Library</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'mine' && styles.tabBtnActive]} onPress={() => setTab('mine')}>
          <ThemedText style={[styles.tabText, tab === 'mine' && styles.tabTextActive]}>My Uploads</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'review' && styles.tabBtnActive]} onPress={() => setTab('review')}>
          <ThemedText style={[styles.tabText, tab === 'review' && styles.tabTextActive]}>
            {canManageSchoolDocs ? 'Review' : 'For Review'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent.gold} />}
      >
        {isAllView && (
          <View style={styles.noticeBanner}>
            <Ionicons name="apps-outline" size={15} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>
              Every file you can see, across Scheme of Work, Lesson Plan, and Lesson Note. To upload a new file, go
              back and open the specific type first.
            </ThemedText>
          </View>
        )}
        {tab === 'school' && (
          <View style={styles.noticeBanner}>
            <Ionicons name="eye-outline" size={15} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>
              {canManageSchoolDocs
                ? `Official ${isAllView ? 'files' : label.toLowerCase() + 's'} for the whole school. Everyone can view these; only the owner or an admin can upload or remove one.`
                : `Official ${isAllView ? 'files' : label.toLowerCase() + 's'} uploaded by the school owner or an admin. You can view and download these, but not delete or replace them.`}
            </ThemedText>
          </View>
        )}
        {tab === 'mine' && (
          <View style={styles.noticeBanner}>
            <Ionicons name="lock-closed-outline" size={15} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>
              Personal to you — nobody else at the school can see these.
            </ThemedText>
          </View>
        )}
        {tab === 'review' && (
          <View style={styles.noticeBanner}>
            <Ionicons name={canManageSchoolDocs ? 'checkmark-done-outline' : 'paper-plane-outline'} size={15} color={C.textMuted} />
            <ThemedText style={styles.noticeText}>
              {canManageSchoolDocs
                ? `${isAllView ? 'Files' : label + 's'} teachers have submitted for review. Approve one to publish it to the School Library, or send it back with a note.`
                : `Submit a ${isAllView ? 'file' : label.toLowerCase()} for the owner or an admin to review. Once approved, it moves to the School Library for everyone to see.`}
            </ThemedText>
          </View>
        )}

        {activeList.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-outline" size={28} color={C.textMuted} style={{ marginBottom: 8 }} />
            <ThemedText style={styles.emptyText}>
              {tab === 'school' && (isAllView ? 'No school-wide files uploaded yet.' : `No school-wide ${label.toLowerCase()}s uploaded yet.`)}
              {tab === 'mine' && (isAllView ? "You haven't uploaded a personal file yet." : `You haven't uploaded a personal ${label.toLowerCase()} yet.`)}
              {tab === 'review' && (canManageSchoolDocs ? 'Nothing waiting for review.' : (isAllView ? "You haven't submitted a file yet." : `You haven't submitted a ${label.toLowerCase()} yet.`))}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {activeList.map((doc) => (
              <View key={doc.id} style={styles.docCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => Linking.openURL(doc.fileUrl)} activeOpacity={0.75}>
                    <View style={styles.docIconWrap}>
                      <Ionicons name={doc.fileType === 'pdf' ? 'document-text-outline' : 'document-outline'} size={18} color={Colors.accent.gold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={styles.docTitle} numberOfLines={1}>{doc.title}</ThemedText>
                      <ThemedText style={styles.docSub} numberOfLines={1}>
                        {(doc.visibility === 'school' || (tab === 'review' && canManageSchoolDocs)) && doc.uploadedByName ? `${doc.uploadedByName} · ` : ''}
                        {isAllView ? `${TYPE_LABELS[doc.docType]} · ` : ''}
                        {doc.fileType.toUpperCase()} · {new Date(doc.createdAt).toLocaleDateString()}
                      </ThemedText>
                    </View>
                    <Ionicons name="open-outline" size={16} color={C.textMuted} />
                  </TouchableOpacity>
                  {canDelete(doc) && (
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleDelete(doc)}
                      disabled={deletingId === doc.id}
                    >
                      {deletingId === doc.id ? (
                        <ActivityIndicator size="small" color="#EF4444" />
                      ) : (
                        <Ionicons name="trash-outline" size={16} color="#EF4444" />
                      )}
                    </TouchableOpacity>
                  )}
                </View>

                {tab === 'review' && (
                  <View style={styles.reviewFooter}>
                    <ReviewStatusBadge status={doc.reviewStatus} />
                    {doc.reviewStatus === 'changes_requested' && doc.reviewNote && (
                      <ThemedText style={styles.reviewNoteText}>"{doc.reviewNote}"</ThemedText>
                    )}
                    {canManageSchoolDocs && doc.reviewStatus === 'pending' && (
                      <TouchableOpacity style={styles.reviewBtn} onPress={() => openReviewModal(doc)}>
                        <ThemedText style={styles.reviewBtnText}>Review</ThemedText>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Upload modal */}
      <Modal visible={uploadModalVisible} transparent animationType="slide" onRequestClose={() => setUploadModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <ThemedText style={styles.modalTitle}>
              {uploadVisibility === 'submission' ? `Submit ${label} for Review` : `Upload ${label}`}
              {uploadVisibility === 'school' ? ' — School Library' : uploadVisibility === 'personal' ? ' — Personal' : ''}
            </ThemedText>

            {uploadVisibility === 'school' && (
              <View style={[styles.noticeBanner, { marginBottom: 16 }]}>
                <Ionicons name="megaphone-outline" size={14} color={C.textMuted} />
                <ThemedText style={styles.noticeText}>This will be visible to every admin and teacher at the school.</ThemedText>
              </View>
            )}
            {uploadVisibility === 'submission' && (
              <View style={[styles.noticeBanner, { marginBottom: 16 }]}>
                <Ionicons name="paper-plane-outline" size={14} color={C.textMuted} />
                <ThemedText style={styles.noticeText}>Only the owner and admins will see this until it's reviewed.</ThemedText>
              </View>
            )}

            <TouchableOpacity style={styles.filePickerBtn} onPress={pickFile}>
              <Ionicons name="attach-outline" size={18} color={pickedFile ? Colors.accent.gold : C.textMuted} />
              <ThemedText style={[styles.filePickerText, pickedFile && { color: C.text }]} numberOfLines={1}>
                {pickedFile ? pickedFile.name : 'Choose a PDF or Word file'}
              </ThemedText>
            </TouchableOpacity>

            <ThemedText style={styles.inputLabel}>Title</ThemedText>
            <TextInput
              style={styles.textInput}
              value={uploadTitle}
              onChangeText={setUploadTitle}
              placeholder={`e.g. JSS2 ${label} — First Term`}
              placeholderTextColor={C.placeholder}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setUploadModalVisible(false)} disabled={uploading}>
                <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.uploadBtn, (!pickedFile || !uploadTitle.trim() || uploading) && { opacity: 0.5 }]}
                onPress={handleUpload}
                disabled={!pickedFile || !uploadTitle.trim() || uploading}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color="#0F172A" />
                ) : (
                  <ThemedText style={styles.uploadBtnText}>{uploadVisibility === 'submission' ? 'Submit' : 'Upload'}</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Review decision modal (admin/owner) */}
      <Modal visible={!!reviewModalDoc} transparent animationType="slide" onRequestClose={() => setReviewModalDoc(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <ThemedText style={styles.modalTitle} numberOfLines={2}>{reviewModalDoc?.title}</ThemedText>
            <ThemedText style={[styles.noticeText, { textAlign: 'center', marginBottom: 16 }]}>
              Submitted by {reviewModalDoc?.uploadedByName || 'a teacher'}
            </ThemedText>

            <TouchableOpacity
              style={styles.filePickerBtn}
              onPress={() => reviewModalDoc && Linking.openURL(reviewModalDoc.fileUrl)}
            >
              <Ionicons name="open-outline" size={18} color={Colors.accent.gold} />
              <ThemedText style={[styles.filePickerText, { color: C.text }]}>Open the file to review it</ThemedText>
            </TouchableOpacity>

            <ThemedText style={styles.inputLabel}>Note (required if requesting changes)</ThemedText>
            <TextInput
              style={[styles.textInput, { minHeight: 80, textAlignVertical: 'top' }]}
              value={reviewNoteInput}
              onChangeText={setReviewNoteInput}
              placeholder="What should they fix or add?"
              placeholderTextColor={C.placeholder}
              multiline
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B40' }]}
                onPress={() => submitReview('changes_requested')}
                disabled={!!reviewing}
              >
                {reviewing === 'changes_requested' ? (
                  <ActivityIndicator size="small" color="#F59E0B" />
                ) : (
                  <ThemedText style={[styles.cancelBtnText, { color: '#F59E0B' }]}>Request Changes</ThemedText>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={() => submitReview('approved')}
                disabled={!!reviewing}
              >
                {reviewing === 'approved' ? (
                  <ActivityIndicator size="small" color="#0F172A" />
                ) : (
                  <ThemedText style={styles.uploadBtnText}>Approve</ThemedText>
                )}
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={{ marginTop: 12, alignItems: 'center' }} onPress={() => setReviewModalDoc(null)} disabled={!!reviewing}>
              <ThemedText style={{ color: C.textMuted, fontSize: 12 }}>Cancel</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {alert.visible && (
        <CustomAlert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert({ ...alert, visible: false })}
        />
      )}
    </ThemedView>
  );
}

function ReviewStatusBadge({ status }: { status: DocRow['reviewStatus'] }) {
  const map: Record<string, { color: string; label: string }> = {
    pending: { color: '#F59E0B', label: 'Pending' },
    changes_requested: { color: '#EF4444', label: 'Changes Requested' },
    approved: { color: '#22C55E', label: 'Approved' },
  };
  const cfg = map[status || ''] || { color: '#94A3B8', label: 'Unknown' };
  return (
    <View style={[badgeStyles.badge, { backgroundColor: `${cfg.color}15`, borderColor: `${cfg.color}40` }]}>
      <View style={[badgeStyles.dot, { backgroundColor: cfg.color }]} />
      <ThemedText style={[badgeStyles.text, { color: cfg.color }]}>{cfg.label}</ThemedText>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, borderWidth: 1, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 9.5, fontWeight: '800' },
});

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
    loadingText: { color: Colors.accent.gold, marginTop: 15, fontWeight: '800', fontSize: 10, letterSpacing: 2 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: isTiny ? 15 : 20, paddingBottom: 16, backgroundColor: C.modalBg, borderBottomWidth: 1, borderColor: C.divider },
    backBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', color: C.text, fontSize: isTiny ? 14 : 16, fontWeight: '800', marginHorizontal: 8 },
    addBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center' },

    tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: isTiny ? 15 : 20, paddingVertical: 12, backgroundColor: C.modalBg, borderBottomWidth: 1, borderColor: C.divider },
    tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center', backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder },
    tabBtnActive: { backgroundColor: `${Colors.accent.gold}15`, borderColor: Colors.accent.gold },
    tabText: { color: C.textMuted, fontSize: 10, fontWeight: '800' },
    tabTextActive: { color: Colors.accent.gold },

    scrollContent: { padding: isTiny ? 16 : 22, paddingBottom: 60 },

    noticeBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.actionItemBg, borderRadius: 14, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: C.actionItemBorder },
    noticeText: { flex: 1, color: C.textMuted, fontSize: 11, lineHeight: 15 },

    emptyCard: { backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 24, alignItems: 'center' },
    emptyText: { color: C.textMuted, fontSize: 12, fontWeight: '600', textAlign: 'center' },

    list: { gap: 10 },
    docCard: { backgroundColor: C.actionItemBg, borderRadius: 16, borderWidth: 1, borderColor: C.actionItemBorder, padding: 12, gap: 10 },
    docIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: `${Colors.accent.gold}15`, justifyContent: 'center', alignItems: 'center' },
    docTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
    docSub: { color: C.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2 },
    deleteBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#EF444415', justifyContent: 'center', alignItems: 'center' },

    reviewFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderColor: C.divider, paddingTop: 10 },
    reviewNoteText: { flex: 1, color: C.textMuted, fontSize: 10.5, fontStyle: 'italic' },
    reviewBtn: { marginLeft: 'auto', backgroundColor: Colors.accent.gold, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
    reviewBtnText: { color: '#0F172A', fontSize: 11, fontWeight: '800' },

    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: C.modalBg, borderColor: C.cardBorder, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: isTiny ? 16 : 24, borderTopWidth: 1 },
    sheetHandle: { width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: C.text, fontSize: 15, fontWeight: '900', marginBottom: 14, textAlign: 'center' },

    filePickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.inputBg, borderRadius: 14, borderWidth: 1, borderColor: C.inputBorder, padding: 14, marginBottom: 14 },
    filePickerText: { flex: 1, color: C.textMuted, fontSize: 12.5, fontWeight: '600' },

    inputLabel: { color: C.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
    textInput: { backgroundColor: C.inputBg, borderRadius: 14, borderWidth: 1, borderColor: C.inputBorder, padding: 14, color: C.inputText, fontSize: 13, marginBottom: 8 },

    modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
    cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: 'center', backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder },
    cancelBtnText: { color: C.textMuted, fontSize: 12.5, fontWeight: '800' },
    uploadBtn: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: 'center', backgroundColor: Colors.accent.gold },
    uploadBtnText: { color: '#0F172A', fontSize: 12.5, fontWeight: '800' },
  });
}
