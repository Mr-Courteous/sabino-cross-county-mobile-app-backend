// ─────────────────────────────────────────────────────────────
// components/attendance-date-picker.tsx
//
// Calendar-grid date picker for the Attendance Register (app/attendance.tsx).
// Built to match the app's existing bottom-sheet modal pattern (same
// modalOverlay / bottomSheet / sheetHandle look used for the
// session/term/class pickers) rather than pulling in a new dependency —
// this app has no calendar/date-picker package installed anywhere else,
// so a hand-rolled grid keeps things consistent with the rest of the
// codebase's "no extra date libs" approach (see the year/month/day
// dropdowns used for date-of-birth in components/students-manager.tsx).
//
// Dates that already have a saved attendance record are shown with a
// small dot under the day number, so a class teacher or owner can see
// at a glance which days have a register on file and jump straight to
// any of them — no more paging one day/week at a time to find one.
// ─────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { View, TouchableOpacity, Modal, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/design-system';
import { useAppColors } from '@/hooks/use-app-colors';

interface AttendanceDatePickerProps {
  visible: boolean;
  onClose: () => void;
  selectedDate: string; // 'YYYY-MM-DD'
  onSelect: (date: string) => void;
  // Dates known to have at least one saved attendance record — shown
  // with a dot. Optional: omit to render a plain calendar.
  markedDates?: Set<string>;
  title?: string;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDateStr = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

function parseParts(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  return { year: y, month: m - 1, day: d };
}

// Monday-first grid, matching the app's own week-of convention
// (routes/attendance/index.js -> mondayOf()).
function mondayIndexedWeekday(y: number, m: number, d: number) {
  const jsDay = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

export function AttendanceDatePicker({
  visible,
  onClose,
  selectedDate,
  onSelect,
  markedDates,
  title = 'Select Date',
}: AttendanceDatePickerProps) {
  const C = useAppColors();
  const styles = useMemo(() => makeStyles(C), [C.scheme]);

  const initial = parseParts(selectedDate || todayStr());
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  const monthLabel = useMemo(
    () =>
      new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [viewYear, viewMonth]
  );

  const cells = useMemo(() => {
    const total = daysInMonth(viewYear, viewMonth);
    const leadingBlanks = mondayIndexedWeekday(viewYear, viewMonth, 1);
    const out: (number | null)[] = Array(leadingBlanks).fill(null);
    for (let d = 1; d <= total; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [viewYear, viewMonth]);

  const shiftMonth = (n: number) => {
    let m = viewMonth + n;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  };

  if (!visible) return null;

  const today = todayStr();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={[styles.bottomSheet, { backgroundColor: C.modalBg, borderColor: C.cardBorder }]}>
            <View style={styles.sheetHandle} />
            <ThemedText style={styles.modalTitle}>{title}</ThemedText>

            <View style={styles.monthNavRow}>
              <TouchableOpacity style={styles.monthArrow} onPress={() => shiftMonth(-1)}>
                <Ionicons name="chevron-back" size={16} color={Colors.accent.gold} />
              </TouchableOpacity>
              <ThemedText style={styles.monthLabel}>{monthLabel}</ThemedText>
              <TouchableOpacity style={styles.monthArrow} onPress={() => shiftMonth(1)}>
                <Ionicons name="chevron-forward" size={16} color={Colors.accent.gold} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map((w) => (
                <View key={w} style={styles.weekdayCell}>
                  <ThemedText style={styles.weekdayText}>{w}</ThemedText>
                </View>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((day, idx) => {
                if (day === null) return <View key={`blank-${idx}`} style={styles.dayCell} />;
                const dateStr = toDateStr(viewYear, viewMonth, day);
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === today;
                const isWeekend = mondayIndexedWeekday(viewYear, viewMonth, day) >= 5;
                const hasRecord = !!markedDates?.has(dateStr);

                return (
                  <TouchableOpacity
                    key={dateStr}
                    style={styles.dayCell}
                    onPress={() => {
                      onSelect(dateStr);
                      onClose();
                    }}
                  >
                    <View
                      style={[
                        styles.dayCircle,
                        isSelected && styles.dayCircleSelected,
                        !isSelected && isToday && styles.dayCircleToday,
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.dayText,
                          isWeekend && !isSelected && { color: '#EF4444' },
                          isSelected && styles.dayTextSelected,
                        ]}
                      >
                        {day}
                      </ThemedText>
                    </View>
                    {hasRecord && <View style={[styles.recordDot, isSelected && { backgroundColor: Colors.accent.gold }]} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={styles.recordDotStatic} />
                <ThemedText style={styles.legendLabel}>Has saved record</ThemedText>
              </View>
              <TouchableOpacity
                style={styles.todayJumpBtn}
                onPress={() => {
                  onSelect(today);
                  onClose();
                }}
              >
                <ThemedText style={styles.todayJumpText}>Jump to Today</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(C: ReturnType<typeof useAppColors>) {
  return StyleSheet.create({
    modalOverlay: { flex: 1, backgroundColor: C.modalOverlay, justifyContent: 'flex-end' },
    bottomSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, borderTopWidth: 1 },
    sheetHandle: { width: 36, height: 3, backgroundColor: C.divider, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    modalTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginBottom: 14, textAlign: 'center' },

    monthNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    monthArrow: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder, justifyContent: 'center', alignItems: 'center' },
    monthLabel: { color: C.text, fontSize: 13, fontWeight: '800' },

    weekdayRow: { flexDirection: 'row', marginBottom: 6 },
    weekdayCell: { flex: 1, alignItems: 'center' },
    weekdayText: { color: C.textLabel, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
    dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    dayCircleSelected: { backgroundColor: Colors.accent.gold },
    dayCircleToday: { borderWidth: 1, borderColor: Colors.accent.gold },
    dayText: { color: C.text, fontSize: 12, fontWeight: '700' },
    dayTextSelected: { color: Colors.accent.navy, fontWeight: '900' },
    recordDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#22C55E', marginTop: -6 },

    legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.divider },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    recordDotStatic: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#22C55E' },
    legendLabel: { color: C.textMuted, fontSize: 9, fontWeight: '700' },
    todayJumpBtn: { paddingHorizontal: 10, height: 30, borderRadius: 8, backgroundColor: Colors.accent.gold + '15', borderWidth: 1, borderColor: Colors.accent.gold + '40', justifyContent: 'center' },
    todayJumpText: { color: Colors.accent.gold, fontSize: 9, fontWeight: '800' },
  });
}
