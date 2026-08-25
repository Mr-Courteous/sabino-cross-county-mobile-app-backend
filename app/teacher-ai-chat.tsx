import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { API_BASE_URL } from '@/utils/api-service';
import { Colors } from '@/constants/design-system';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppColors } from '@/hooks/use-app-colors';
import {
  getToken,
  teacherAiApi,
  ContentType,
  DOC_TYPE_LABELS,
  CONTENT_TYPE_TO_DOC_TYPE,
  DISCLAIMER,
} from '@/utils/teacher-ai-api';

interface Attachment {
  type: 'document' | 'image';
  name: string;
  uri: string;
  mimeType?: string;
  webFile?: any; // the raw web File object — only present/used on Platform.OS === 'web'
  // 'extracting'/'ready'/'error' only apply to documents (text is pulled
  // via POST /attachments/extract right after picking). Images are
  // always 'unsupported' — Sabino AI has no vision input yet, so an
  // attached image is just a label, not something the AI can read.
  status?: 'extracting' | 'ready' | 'error' | 'unsupported';
  extractedText?: string;
  errorMessage?: string;
}
interface LibraryDoc { id: number; docType: string; visibility: string; title: string; fileType: string; }
interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  structured?: any;
  contentType?: ContentType | null;
  attachments?: Attachment[];
  edited?: boolean;
}

const CHIPS: { contentType: ContentType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { contentType: 'scheme_of_work', label: 'Scheme of Work', icon: 'calendar-outline' },
  { contentType: 'lesson_plan', label: 'Lesson Plan', icon: 'clipboard-outline' },
  { contentType: 'lesson_note', label: 'Lesson Note', icon: 'document-text-outline' },
];

// document_library rows use underscored doc_type values
// ('scheme_of_work' etc.) — different from teacher-ai-api's DocType
// ('scheme-of-work'), which is hyphenated. Kept as a small local map
// rather than reconciling the two vocabularies app-wide.
const LIBRARY_DOC_TYPE_LABELS: Record<string, string> = {
  scheme_of_work: 'Scheme of Work',
  lesson_plan: 'Lesson Plan',
  lesson_note: 'Lesson Note',
};

// teacher_ai_chat (addendum §1.3) — the "Ask Sabino AI" conversational
// entry point. Shortcut chips above a free-text input; each AI reply
// renders as a card with Edit / Try Again / Copy to Editor and always
// carries the disclaimer.
export default function TeacherAiChatPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ contentType?: string; conversationId?: string }>();
  const { width } = useWindowDimensions();
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C, width), [C.scheme, width]);
  const isTiny = width < 300;
  const scrollRef = useRef<ScrollView>(null);

  const [loading, setLoading] = useState(!!params.conversationId);
  const [conversationId, setConversationId] = useState<number | null>(
    params.conversationId ? Number(params.conversationId) : null
  );
  const [activeContentType, setActiveContentType] = useState<ContentType | null>(
    (params.contentType as ContentType) || null
  );
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  // Total stored thread length INCLUDING the synthetic reference
  // messages (library docs / file attachments) that are folded into the
  // AI's context but deliberately never shown as chat bubbles (see the
  // hydration effect below) — this is what the truncation notice keys
  // off, since it matches chat.js's `history.slice(-20)` window, not
  // `messages.length` (the filtered, display-only count).
  const [totalMessageCount, setTotalMessageCount] = useState(0);
  const [inputText, setInputText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [libraryReference, setLibraryReference] = useState<{ id: number; title: string } | null>(null);
  const [libraryPickerVisible, setLibraryPickerVisible] = useState(false);
  const [libraryDocs, setLibraryDocs] = useState<LibraryDoc[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [alert, setAlert] = useState<{ visible: boolean; type: 'success' | 'error' | 'info'; message: string }>({
    visible: false,
    type: 'info',
    message: '',
  });

  useEffect(() => {
    if (!params.conversationId) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) { router.replace('/(auth)'); return; }
        const res = await teacherAiApi.getConversation(token, params.conversationId as string);
        const data = await res.json();
        if (data.success) {
          setConversationId(data.data.id);
          setActiveContentType(data.data.contentType || null);
          const rawMessages = data.data.messages || [];
          setTotalMessageCount(rawMessages.length);
          setMessages(
            rawMessages
              // Reference entries (a pinned library doc, or a paperclip
              // attachment's extracted text) are context for the AI, not
              // something the teacher typed — never render them as a
              // chat bubble, or reopening a conversation would dump the
              // full source document's text into the thread.
              .filter((m: any) => !m.isReference)
              .map((m: any, idx: number) => ({
                id: `hydrated-${idx}`,
                role: m.role,
                text: m.content,
                structured: m.structured,
                contentType: m.contentType,
                attachments: m.attachments,
              }))
          );
        }
      } catch (e) {
        // Silent — an empty chat is a reasonable fallback.
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

  const selectChip = (chip: (typeof CHIPS)[number]) => {
    setActiveContentType(chip.contentType);
    if (!inputText.trim()) {
      setInputText(`Help me create a ${chip.label.toLowerCase()} for `);
    }
  };

  async function sendMessage(text: string, attachments: Attachment[] = []) {
    if (!text.trim() || sending) return;
    const token = await getToken();
    if (!token) { router.replace('/(auth)'); return; }

    const userMsg: LocalMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      text: text.trim(),
      attachments,
    };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    scrollToEnd();

    try {
      const res = await teacherAiApi.sendChatMessage(token, {
        message: text.trim(),
        conversationId: conversationId || undefined,
        contentType: activeContentType || undefined,
        // `text` rides along only for attachments that finished
        // extracting successfully — chat.js folds it into the AI's
        // context. Failed/unsupported attachments still show up as a
        // label (type + name) so the AI at least knows something was
        // attached, but carry no content.
        attachments: attachments.map((a) => ({ type: a.type, name: a.name, text: a.extractedText })),
        referenceDocumentId: libraryReference?.id,
      });

      if (res.status === 402) { router.replace('/pricing'); return; }
      if (res.status === 401) { router.replace('/(auth)'); return; }

      const data = await res.json();
      if (data.success) {
        setConversationId(data.data.conversationId);
        if (data.data.contentType) setActiveContentType(data.data.contentType);
        if (typeof data.data.messageCount === 'number') setTotalMessageCount(data.data.messageCount);
        const assistantMsg: LocalMessage = {
          id: `srv-${data.data.conversationId}-${Date.now()}`,
          role: 'assistant',
          text: data.data.message.text,
          structured: data.data.message.structured,
          contentType: data.data.message.contentType,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        if (data.conversationId) setConversationId(data.conversationId);
        setAlert({ visible: true, type: 'error', message: data.error || 'Sabino AI could not respond. Please try again.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    if (pendingAttachments.some((a) => a.status === 'extracting')) {
      setAlert({ visible: true, type: 'info', message: 'Still reading the attached file — one moment, then hit send again.' });
      return;
    }
    const attachments = pendingAttachments;
    setInputText('');
    setPendingAttachments([]);
    sendMessage(text, attachments);
  };

  const handleTryAgain = (assistantIndex: number) => {
    // Find the user message immediately preceding this assistant reply.
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        sendMessage(messages[i].text, messages[i].attachments || []);
        return;
      }
    }
  };

  const startEdit = (msg: LocalMessage) => {
    setEditingId(msg.id);
    setEditText(msg.text);
  };

  const saveEdit = () => {
    setMessages((prev) => prev.map((m) => (m.id === editingId ? { ...m, text: editText, edited: true } : m)));
    setEditingId(null);
    setEditText('');
  };

  const handleCopyToEditor = async (msg: LocalMessage) => {
    if (!msg.structured || !msg.contentType) return;
    const docType = CONTENT_TYPE_TO_DOC_TYPE[msg.contentType];
    const token = await getToken();
    if (!token) { router.replace('/(auth)'); return; }

    setCopyingId(msg.id);
    try {
      const s = msg.structured;
      const body: any = {
        title: s.title,
        createdVia: 'ai',
        aiProvenance: {
          conversationId,
          model: 'llama-3.3-70b-versatile',
          generatedAt: new Date().toISOString(),
        },
      };
      if (docType === 'scheme-of-work') {
        body.weeks = s.weeks || [];
      } else if (docType === 'lesson-plans') {
        Object.assign(body, {
          topic: s.topic, duration: s.duration, objectives: s.objectives, materials: s.materials,
          teacherActivities: s.teacherActivities, studentActivities: s.studentActivities, evaluation: s.evaluation,
        });
      } else {
        Object.assign(body, {
          topic: s.topic, objectives: s.objectives,
          teacherActivities: s.teacherActivities, studentActivities: s.studentActivities, assessment: s.assessment,
        });
      }

      const res = await teacherAiApi.createDocument(token, docType, body);
      if (res.status === 402) { router.replace('/pricing'); return; }
      const data = await res.json();
      if (data.success) {
        router.push({ pathname: '/teacher-ai-editor', params: { type: docType, id: String(data.data.id) } } as any);
      } else {
        setAlert({ visible: true, type: 'error', message: data.error || 'Could not save this document.' });
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setCopyingId(null);
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;

      const attachment: Attachment = {
        type: 'document',
        name: asset.name,
        uri: asset.uri,
        mimeType: asset.mimeType,
        webFile: (asset as any).file,
        status: 'extracting',
      };
      setPendingAttachments((prev) => [...prev, attachment]);

      // Read the file's content right away so it's ready by the time
      // the teacher hits send — a spinner shows on the chip meanwhile.
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }
      try {
        const res = await teacherAiApi.extractAttachment(token, attachment);
        const data = await res.json();
        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.uri !== attachment.uri
              ? a
              : data.success
              ? { ...a, status: 'ready', extractedText: data.data.text }
              : { ...a, status: 'error', errorMessage: data.error || 'Could not read that file.' }
          )
        );
      } catch (e) {
        setPendingAttachments((prev) =>
          prev.map((a) => (a.uri === attachment.uri ? { ...a, status: 'error', errorMessage: 'Network error.' } : a))
        );
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Could not attach that file.' });
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      // Sabino AI is text-only (see chat.js) — an attached photo can't
      // actually be read yet. Still attach it for the teacher's own
      // reference in the thread, but mark it clearly so it isn't
      // mistaken for something the AI looked at.
      setPendingAttachments((prev) => [
        ...prev,
        {
          type: 'image',
          name: asset.fileName || 'photo.jpg',
          uri: asset.uri,
          status: 'unsupported',
          errorMessage: "Sabino AI can't read images yet",
        },
      ]);
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Could not attach that image.' });
    }
  };

  const pickAudio = () => {
    setAlert({ visible: true, type: 'info', message: 'Voice notes are coming soon.' });
  };

  const openLibraryPicker = async () => {
    setLibraryPickerVisible(true);
    setLibraryLoading(true);
    try {
      const token = await getToken();
      if (!token) { router.replace('/(auth)'); return; }
      const res = await fetch(`${API_BASE_URL}/api/document-library`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (result.success) {
        // Show every uploaded file. Old .doc files can't be text-extracted
        // for AI reference, but they still appear here (greyed out, see
        // below) so the list matches what's actually in the library —
        // selecting one surfaces a clear "please re-upload as PDF/DOCX"
        // error from the backend rather than being silently hidden.
        setLibraryDocs(result.data || []);
      }
    } catch (e) {
      setAlert({ visible: true, type: 'error', message: 'Could not load your uploaded files.' });
    } finally {
      setLibraryLoading(false);
    }
  };

  const selectLibraryReference = (doc: LibraryDoc) => {
    setLibraryReference({ id: doc.id, title: doc.title });
    setLibraryPickerVisible(false);
  };

  const removeAttachment = (uri: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.uri !== uri));
  };

  if (loading) {
    return (
      <ThemedView style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.accent.gold} />
        <ThemedText style={styles.loadingText}>Loading conversation...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={styles.container}>
        <StatusBar style={C.isDark ? 'light' : 'dark'} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={isTiny ? 18 : 22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <ThemedText style={styles.headerTitle}>Ask Sabino AI</ThemedText>
            {activeContentType && (
              <ThemedText style={styles.headerSub}>{DOC_TYPE_LABELS[CONTENT_TYPE_TO_DOC_TYPE[activeContentType]]}</ThemedText>
            )}
          </View>
          <TouchableOpacity onPress={() => router.push('/teacher-ai-history' as any)} style={styles.backBtn}>
            <Ionicons name="time-outline" size={isTiny ? 18 : 22} color={C.text} />
          </TouchableOpacity>
        </View>

        {totalMessageCount > 20 && (
          <View style={styles.contextNotice}>
            <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
            <ThemedText style={styles.contextNoticeText}>
              This conversation has {totalMessageCount} messages. Sabino AI only actively reads the most recent 20
              when replying — everything above that is still here for you to scroll back through, just outside what
              the AI currently has in mind.
            </ThemedText>
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="sparkles" size={28} color={Colors.accent.gold} />
              <ThemedText style={styles.emptyTitle}>What are we creating today?</ThemedText>
              <ThemedText style={styles.emptySub}>
                Pick a shortcut below, or just describe what you need — a scheme of work, a lesson plan, or a lesson note.
              </ThemedText>
            </View>
          )}

          {messages.length === 0 && (
            <View style={styles.chipRow}>
              {CHIPS.map((chip) => (
                <TouchableOpacity
                  key={chip.contentType}
                  style={[styles.chip, activeContentType === chip.contentType && styles.chipActive]}
                  onPress={() => selectChip(chip)}
                >
                  <Ionicons name={chip.icon} size={14} color={activeContentType === chip.contentType ? '#0F172A' : Colors.accent.gold} />
                  <ThemedText style={[styles.chipText, activeContentType === chip.contentType && styles.chipTextActive]}>
                    {chip.label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {messages.map((msg, idx) => (
            <View key={msg.id} style={[styles.msgRow, msg.role === 'user' ? styles.msgRowUser : styles.msgRowAi]}>
              {msg.role === 'user' ? (
                <View style={styles.userBubble}>
                  <ThemedText style={styles.userText}>{msg.text}</ThemedText>
                  {!!msg.attachments?.length && (
                    <View style={styles.attachmentsRow}>
                      {msg.attachments.map((a) => (
                        <View key={a.uri} style={styles.attachmentPillSent}>
                          <Ionicons name={a.type === 'image' ? 'image-outline' : 'document-outline'} size={11} color="#fff" />
                          <ThemedText style={styles.attachmentPillSentText} numberOfLines={1}>{a.name}</ThemedText>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.aiCard}>
                  {editingId === msg.id ? (
                    <>
                      <TextInput
                        style={styles.editInput}
                        value={editText}
                        onChangeText={setEditText}
                        multiline
                        placeholderTextColor={C.placeholder}
                      />
                      <View style={styles.editActionsRow}>
                        <TouchableOpacity onPress={() => setEditingId(null)} style={styles.editCancelBtn}>
                          <ThemedText style={styles.editCancelText}>Cancel</ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={saveEdit} style={styles.editSaveBtn}>
                          <ThemedText style={styles.editSaveText}>Save</ThemedText>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <ThemedText style={styles.aiText}>{msg.text}{msg.edited ? '  ·  (edited)' : ''}</ThemedText>

                      {msg.structured && (
                        <View style={styles.structuredPreview}>
                          <Ionicons name="document-attach-outline" size={14} color={Colors.accent.gold} />
                          <ThemedText style={styles.structuredPreviewText} numberOfLines={1}>
                            {msg.structured.title || DOC_TYPE_LABELS[CONTENT_TYPE_TO_DOC_TYPE[msg.contentType as ContentType]]} ready to save
                          </ThemedText>
                        </View>
                      )}

                      <View style={styles.aiActionsRow}>
                        <TouchableOpacity style={styles.aiActionBtn} onPress={() => startEdit(msg)}>
                          <Ionicons name="create-outline" size={13} color={C.textMuted} />
                          <ThemedText style={styles.aiActionText}>Edit</ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.aiActionBtn} onPress={() => handleTryAgain(idx)} disabled={sending}>
                          <Ionicons name="refresh-outline" size={13} color={C.textMuted} />
                          <ThemedText style={styles.aiActionText}>Try Again</ThemedText>
                        </TouchableOpacity>
                        {msg.structured && (
                          <TouchableOpacity
                            style={[styles.aiActionBtn, styles.copyBtn]}
                            onPress={() => handleCopyToEditor(msg)}
                            disabled={copyingId === msg.id}
                          >
                            {copyingId === msg.id ? (
                              <ActivityIndicator size="small" color="#0F172A" />
                            ) : (
                              <>
                                <Ionicons name="arrow-redo-outline" size={13} color="#0F172A" />
                                <ThemedText style={styles.copyBtnText}>Copy to Editor</ThemedText>
                              </>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>

                      <ThemedText style={styles.disclaimer}>{DISCLAIMER}</ThemedText>
                    </>
                  )}
                </View>
              )}
            </View>
          ))}

          {sending && (
            <View style={[styles.msgRow, styles.msgRowAi]}>
              <View style={[styles.aiCard, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                <ActivityIndicator size="small" color={Colors.accent.gold} />
                <ThemedText style={styles.aiText}>Sabino AI is thinking...</ThemedText>
              </View>
            </View>
          )}
        </ScrollView>

        {!!pendingAttachments.length && (
          <View style={styles.pendingRow}>
            {pendingAttachments.map((a) => (
              <View
                key={a.uri}
                style={[styles.attachmentPill, a.status === 'error' && styles.attachmentPillError]}
              >
                {a.status === 'extracting' ? (
                  <ActivityIndicator size="small" color={C.textMuted} />
                ) : (
                  <Ionicons
                    name={
                      a.status === 'error'
                        ? 'alert-circle-outline'
                        : a.status === 'unsupported'
                        ? 'information-circle-outline'
                        : a.type === 'image'
                        ? 'image-outline'
                        : 'document-outline'
                    }
                    size={12}
                    color={a.status === 'error' ? '#DC2626' : a.status === 'unsupported' ? Colors.accent.gold : C.text}
                  />
                )}
                <ThemedText
                  style={[styles.attachmentPillText, a.status === 'error' && { color: '#DC2626' }]}
                  numberOfLines={1}
                >
                  {a.name}
                  {a.status === 'error' ? ' — could not be read' : ''}
                  {a.status === 'unsupported' ? ' — not read by AI' : ''}
                </ThemedText>
                <TouchableOpacity onPress={() => removeAttachment(a.uri)}>
                  <Ionicons name="close-circle" size={14} color={C.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {libraryReference && (
          <View style={styles.pendingRow}>
            <View style={[styles.attachmentPill, { maxWidth: '100%', backgroundColor: `${Colors.accent.gold}15`, borderColor: Colors.accent.gold }]}>
              <Ionicons name="folder-open-outline" size={12} color={Colors.accent.gold} />
              <ThemedText style={[styles.attachmentPillText, { color: C.text }]} numberOfLines={1}>
                Generating from: {libraryReference.title}
              </ThemedText>
              <TouchableOpacity onPress={() => setLibraryReference(null)}>
                <Ionicons name="close-circle" size={14} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.composer}>
          <TouchableOpacity onPress={pickDocument} style={styles.composerIconBtn}>
            <Ionicons name="document-attach-outline" size={19} color={C.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={pickImage} style={styles.composerIconBtn}>
            <Ionicons name="image-outline" size={19} color={C.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openLibraryPicker} style={styles.composerIconBtn}>
            <Ionicons name="folder-open-outline" size={19} color={libraryReference ? Colors.accent.gold : C.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={pickAudio} style={styles.composerIconBtn}>
            <Ionicons name="mic-outline" size={19} color={C.textMuted} />
          </TouchableOpacity>
          <TextInput
            style={styles.composerInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask Sabino AI..."
            placeholderTextColor={C.placeholder}
            multiline
          />
          <TouchableOpacity
            onPress={handleSend}
            style={[styles.sendBtn, (!inputText.trim() || sending) && { opacity: 0.4 }]}
            disabled={!inputText.trim() || sending}
          >
            <Ionicons name="send" size={16} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* Attach-from-library picker */}
        <Modal visible={libraryPickerVisible} transparent animationType="slide" onRequestClose={() => setLibraryPickerVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.sheetHandle} />
              <ThemedText style={styles.modalTitle}>Generate From an Uploaded File</ThemedText>
              <ThemedText style={[styles.emptySub, { marginBottom: 14, maxWidth: undefined }]}>
                Pick a lesson note, lesson plan, or scheme of work you've already uploaded. Sabino AI will read it and use it as the basis for what you ask next.
              </ThemedText>

              {libraryLoading ? (
                <ActivityIndicator size="small" color={Colors.accent.gold} style={{ marginVertical: 20 }} />
              ) : libraryDocs.length === 0 ? (
                <ThemedText style={[styles.emptySub, { maxWidth: undefined }]}>
                  No uploaded files found. Upload one from the File Library first.
                </ThemedText>
              ) : (
                <ScrollView style={{ maxHeight: 320 }}>
                  {libraryDocs.map((doc) => {
                    const unreadable = doc.fileType !== 'pdf' && doc.fileType !== 'docx';
                    return (
                      <TouchableOpacity
                        key={doc.id}
                        style={[styles.libraryPickRow, unreadable && { opacity: 0.5 }]}
                        onPress={() => selectLibraryReference(doc)}
                      >
                        <Ionicons name={doc.fileType === 'pdf' ? 'document-text-outline' : 'document-outline'} size={16} color={Colors.accent.gold} />
                        <View style={{ flex: 1 }}>
                          <ThemedText style={styles.libraryPickTitle} numberOfLines={1}>{doc.title}</ThemedText>
                          <ThemedText style={styles.libraryPickSub}>
                            {LIBRARY_DOC_TYPE_LABELS[doc.docType] || doc.docType} · {doc.visibility === 'school' ? 'School Library' : doc.visibility === 'submission' ? 'Submission' : 'Personal'}
                            {unreadable ? ' · Re-upload as PDF/DOCX to use with AI' : ''}
                          </ThemedText>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <TouchableOpacity style={styles.editCancelBtn} onPress={() => setLibraryPickerVisible(false)}>
                <ThemedText style={styles.editCancelText}>Close</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {alert.visible && (
          <CustomAlert type={alert.type} message={alert.message} onClose={() => setAlert({ ...alert, visible: false })} />
        )}
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(C: ReturnType<typeof import('@/hooks/use-app-colors').useAppColors>, width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.background },
    loadingText: { color: Colors.accent.gold, marginTop: 15, fontWeight: '800', fontSize: 10, letterSpacing: 2 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: isTiny ? 15 : 20, paddingBottom: 16, backgroundColor: C.modalBg, borderBottomWidth: 1, borderColor: C.divider },
    backBtn: { width: isTiny ? 36 : 40, height: isTiny ? 36 : 40, borderRadius: 12, backgroundColor: C.actionItemBg, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: C.text, fontSize: isTiny ? 14 : 16, fontWeight: '800' },
    headerSub: { color: Colors.accent.gold, fontSize: 9.5, fontWeight: '700', marginTop: 2 },
    contextNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.actionItemBg, borderBottomWidth: 1, borderColor: C.divider, paddingHorizontal: isTiny ? 15 : 20, paddingVertical: 10 },
    contextNoticeText: { flex: 1, color: C.textMuted, fontSize: 10.5, lineHeight: 14 },

    scrollContent: { padding: isTiny ? 14 : 18, paddingBottom: 20 },

    emptyState: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20 },
    emptyTitle: { color: C.text, fontSize: 15, fontWeight: '900', marginTop: 12, textAlign: 'center' },
    emptySub: { color: C.textMuted, fontSize: 11.5, textAlign: 'center', marginTop: 8, lineHeight: 17, maxWidth: 280 },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 20 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder },
    chipActive: { backgroundColor: Colors.accent.gold, borderColor: Colors.accent.gold },
    chipText: { color: C.text, fontSize: 11, fontWeight: '700' },
    chipTextActive: { color: '#0F172A' },

    msgRow: { marginBottom: 14, flexDirection: 'row' },
    msgRowUser: { justifyContent: 'flex-end' },
    msgRowAi: { justifyContent: 'flex-start' },

    userBubble: { maxWidth: '82%', backgroundColor: '#2563EB', borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 },
    userText: { color: '#fff', fontSize: 13, lineHeight: 19 },
    attachmentsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    attachmentPillSent: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 140 },
    attachmentPillSentText: { color: '#fff', fontSize: 9.5, fontWeight: '600' },

    aiCard: { maxWidth: '90%', backgroundColor: C.card, borderRadius: 18, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.cardBorder, padding: 14 },
    aiText: { color: C.text, fontSize: 13, lineHeight: 20 },

    structuredPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${Colors.accent.gold}12`, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
    structuredPreviewText: { flex: 1, color: C.text, fontSize: 11, fontWeight: '700' },

    aiActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    aiActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder },
    aiActionText: { color: C.textMuted, fontSize: 10.5, fontWeight: '700' },
    copyBtn: { backgroundColor: Colors.accent.gold, borderColor: Colors.accent.gold },
    copyBtnText: { color: '#0F172A', fontSize: 10.5, fontWeight: '800' },

    disclaimer: { color: C.textMuted, fontSize: 9, fontStyle: 'italic', marginTop: 10, lineHeight: 13 },

    editInput: { color: C.text, fontSize: 13, lineHeight: 19, minHeight: 80, textAlignVertical: 'top', backgroundColor: C.inputBg, borderRadius: 10, borderWidth: 1, borderColor: C.inputBorder, padding: 10 },
    editActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'flex-end' },
    editCancelBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: C.actionItemBg },
    editCancelText: { color: C.textMuted, fontSize: 11, fontWeight: '700' },
    editSaveBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: Colors.accent.gold },
    editSaveText: { color: '#0F172A', fontSize: 11, fontWeight: '800' },

    pendingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: isTiny ? 14 : 18, paddingTop: 8, backgroundColor: C.modalBg },
    attachmentPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.actionItemBg, borderWidth: 1, borderColor: C.actionItemBorder, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, maxWidth: 160 },
    attachmentPillError: { backgroundColor: '#DC262615', borderColor: '#DC2626' },
    attachmentPillText: { color: C.text, fontSize: 10, fontWeight: '600', flexShrink: 1 },

    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: isTiny ? 10 : 14, backgroundColor: C.modalBg, borderTopWidth: 1, borderColor: C.divider },
    composerIconBtn: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    composerInput: { flex: 1, minHeight: 38, maxHeight: 100, backgroundColor: C.inputBg, borderRadius: 14, borderWidth: 1, borderColor: C.inputBorder, paddingHorizontal: 14, paddingVertical: 9, color: C.inputText, fontSize: 13 },
    sendBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: Colors.accent.gold, justifyContent: 'center', alignItems: 'center' },

    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: C.modalBg, borderColor: C.cardBorder, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: isTiny ? 16 : 24, borderTopWidth: 1 },
    sheetHandle: { width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: C.text, fontSize: 15, fontWeight: '900', marginBottom: 8, textAlign: 'center' },

    libraryPickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: C.divider },
    libraryPickTitle: { color: C.text, fontSize: 12.5, fontWeight: '700' },
    libraryPickSub: { color: C.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2 },
  });
}
