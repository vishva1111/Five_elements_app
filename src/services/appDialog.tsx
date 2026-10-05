import React, { useEffect, useSyncExternalStore } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './supabase';

const HOUR_MS = 60 * 60 * 1000;
const REPORT_EMAIL = 'deepnimbark05@gmail.com';

type DialogTone = 'warning' | 'success' | 'danger' | 'info';

type DialogButton = {
  text?: string;
  onPress?: ((value?: any) => void) | undefined;
  style?: 'default' | 'cancel' | 'destructive';
};

type DialogRequest = {
  id: string;
  title: string;
  message?: string;
  buttons: DialogButton[];
  tone: DialogTone;
};

export type AppNotice = {
  id: string;
  title: string;
  message: string;
  tone: DialogTone;
  at: number;
  read: boolean;
};

type WorkItem = { id: string; title: string; message: string; at: number };

type Snapshot = {
  current: DialogRequest | null;
  notices: AppNotice[];
  centerOpen: boolean;
  banner: AppNotice | null;
};

type Persisted = {
  notices: AppNotice[];
  work: WorkItem[];
  lastDigestAt: number;
  userLabel: string;
};

const TONE_META: Record<
  DialogTone,
  { icon: keyof typeof Ionicons.glyphMap; color: string; wash: string; kicker: string }
> = {
  warning: { icon: 'alert-circle', color: '#b45309', wash: '#fff7ed', kicker: 'CHECK REQUIRED' },
  success: { icon: 'checkmark-circle', color: '#166534', wash: '#f0fdf4', kicker: 'COMPLETED' },
  danger: { icon: 'lock-closed', color: '#b91c1c', wash: '#fef2f2', kicker: 'BLOCKED' },
  info: { icon: 'leaf', color: '#1a5c2a', wash: '#f0fdf4', kicker: 'TREEAPP' },
};

let snapshot: Snapshot = { current: null, notices: [], centerOpen: false, banner: null };
let latestOutcome: AppNotice | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();
let persist: Persisted = { notices: [], work: [], lastDigestAt: 0, userLabel: 'Field user' };
let booted = false;
let digestTimer: ReturnType<typeof setInterval> | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function toneFor(title: string): DialogTone {
  const text = title.toLowerCase();
  if (/fail|error|denied|blocked|outside|required/.test(text)) return 'danger';
  if (/saved|updated|locked|completed|submitted|synced|success/.test(text)) return 'success';
  if (/not due|not available|gps|location|clear|retake|sign out/.test(text)) return 'warning';
  return 'info';
}

function isCompletedWork(title: string) {
  return /saved|updated|locked|completed|submitted|synced/.test(title.toLowerCase());
}

async function loadPersisted() {
  if (booted) return;
  booted = true;
}

async function savePersisted() {
  // Notices stay in memory for this session. They are not saved on the phone.
}

function rememberWork(title: string, message: string) {
  if (!isCompletedWork(title)) return;
  persist.work = [
    { id: `${Date.now()}`, title, message, at: Date.now() },
    ...persist.work,
  ].slice(0, 80);
  void savePersisted();
}

function showBanner(title: string, message: string, tone: DialogTone, remember = true) {
  const notice: AppNotice = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    message,
    tone,
    at: Date.now(),
    read: false,
  };
  if (remember) {
    latestOutcome = notice;
    persist.notices = [notice, ...persist.notices].slice(0, 40);
    void savePersisted();
  }
  snapshot = { ...snapshot, banner: notice, notices: persist.notices, centerOpen: false };
  emit();
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    if (snapshot.banner?.id === notice.id) {
      snapshot = { ...snapshot, banner: null };
      emit();
    }
  }, 4200);
}

function hideBanner() {
  if (bannerTimer) clearTimeout(bannerTimer);
  snapshot = { ...snapshot, banner: null };
  emit();
}

function showNext(request?: DialogRequest) {
  if (request) queue.push(request);
  if (snapshot.current || queue.length === 0) {
    emit();
    return;
  }
  snapshot = { ...snapshot, current: queue.shift() || null };
  emit();
}

function dismissCurrent(button?: DialogButton) {
  const current = snapshot.current;
  snapshot = { ...snapshot, current: null };
  emit();
  try {
    button?.onPress?.();
  } catch {
    // A button handler must not leave the dialog stuck open.
  }
  if (current) showNext();
}

export function openNotificationCenter() {
  if (!latestOutcome) {
    showBanner('No new outcome', 'Completed work appears here at the top of the screen.', 'info', false);
    return;
  }
  showBanner(latestOutcome.title, latestOutcome.message, latestOutcome.tone, false);
}

export function closeNotificationCenter() {
  snapshot = { ...snapshot, centerOpen: false };
  emit();
}

export function setWorkReportUser(label: string) {
  const next = label.trim();
  if (!next || persist.userLabel === next) return;
  persist.userLabel = next;
  void savePersisted();
}

export function useAppNotices() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function formatWhen(at: number) {
  return new Date(at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function completedFieldWork(since: number): Promise<WorkItem[]> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return [];
  const sinceIso = new Date(since).toISOString();
  const [trees, tasks] = await Promise.all([
    supabase
      .from('tree_records')
      .select('id, species, tree_id, submitted_at')
      .eq('user_id', userId)
      .gte('submitted_at', sinceIso),
    supabase
      .from('tasks')
      .select('id, name, status, completed_at')
      .eq('assignee_id', userId)
      .eq('status', 'completed')
      .gte('completed_at', sinceIso),
  ]);
  const items: WorkItem[] = [];
  (trees.data ?? []).forEach((tree: any) => {
    items.push({
      id: `tree-${tree.id}`,
      title: `Tree submitted · ${tree.species || 'Tree'}`,
      message: tree.tree_id || '',
      at: new Date(tree.submitted_at).getTime() || Date.now(),
    });
  });
  (tasks.data ?? []).forEach((task: any) => {
    items.push({
      id: `task-${task.id}`,
      title: `Task completed · ${task.name || 'Task'}`,
      message: '',
      at: new Date(task.completed_at).getTime() || Date.now(),
    });
  });
  return items;
}

async function sendHourlyWorkMail() {
  await loadPersisted();
  const now = Date.now();
  if (persist.lastDigestAt && now - persist.lastDigestAt < HOUR_MS) return;
  const since = persist.lastDigestAt || now - HOUR_MS;
  const fieldWork = await completedFieldWork(since).catch(() => []);
  const seen = new Set(fieldWork.map((item) => item.title));
  const completed = [
    ...fieldWork,
    ...persist.work.filter((item) => item.at >= since && !seen.has(item.title)),
  ].sort((a, b) => a.at - b.at);
  if (completed.length === 0) return;

  const lines = completed
    .slice()
    .reverse()
    .map((item) => `• ${formatWhen(item.at)} — ${item.title}${item.message ? `: ${item.message.replace(/\s+/g, ' ').slice(0, 180)}` : ''}`)
    .join('\n');
  const subject = `TreeApp hourly work · ${persist.userLabel}`;
  const message = `Completed field work in the last hour\nUser: ${persist.userLabel}\n\n${lines}`;

  persist.lastDigestAt = now;
  persist.work = persist.work.filter((item) => item.at < since);
  await savePersisted();

  try {
    const response = await fetch(`https://formsubmit.co/ajax/${REPORT_EMAIL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: persist.userLabel,
        _subject: subject,
        _template: 'box',
        message,
      }),
    });
    if (!response.ok) throw new Error('mail rejected');
    showBanner('Hourly work report sent', `Sent ${completed.length} completed item${completed.length === 1 ? '' : 's'} to ${REPORT_EMAIL}.`, 'success');
  } catch {
    const url = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    showBanner('Hourly work report ready', `Could not send automatically. The mail draft for ${REPORT_EMAIL} is ready to send.`, 'warning');
    Linking.openURL(url).catch(() => {});
  }
}

export function startWorkDigest() {
  void loadPersisted().then(sendHourlyWorkMail);
  if (digestTimer) return;
  digestTimer = setInterval(() => {
    void sendHourlyWorkMail();
  }, HOUR_MS);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void sendHourlyWorkMail();
  });
}

export function installAppDialog() {
  const alertApi = Alert as typeof Alert & { __treeAppDialog?: boolean };
  if (alertApi.__treeAppDialog) return;
  alertApi.__treeAppDialog = true;
  Alert.alert = (title, message, buttons) => {
    const tone = toneFor(String(title || 'Notice'));
    const text = typeof message === 'string' ? message : '';
    const heading = String(title || 'Notice');
    const actions = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
    const needsChoice = actions.some((button) => button.onPress || button.style === 'destructive') || actions.length > 1;
    rememberWork(heading, text);
    showBanner(heading, text, tone);
    if (!needsChoice) return;
    showNext({
      id: `${Date.now()}`,
      title: heading,
      message: text,
      buttons: actions,
      tone,
    });
  };
  void loadPersisted();
}

function distanceFrom(message?: string) {
  const match = message?.match(/current distance:\s*([^\n.]+)/i);
  return match?.[1]?.trim() || '';
}

function DialogCard({ request }: { request: DialogRequest }) {
  const tone = TONE_META[request.tone];
  const distance = distanceFrom(request.message);
  const paragraphs = (request.message || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^your current distance:/i.test(line));

  return (
    <View style={styles.card}>
      <View style={[styles.accent, { backgroundColor: tone.color }]} />
      <View style={[styles.iconMedallion, { backgroundColor: tone.wash }]}>
        <Ionicons name={tone.icon} size={26} color={tone.color} />
      </View>
      <Text style={[styles.kicker, { color: tone.color }]}>{tone.kicker}</Text>
      <Text style={styles.title}>{request.title}</Text>
      {paragraphs.map((line) => (
        <Text key={line} style={styles.body}>{line}</Text>
      ))}
      {distance ? (
        <View style={styles.distanceChip}>
          <Ionicons name="walk" size={16} color="#9a3412" />
          <Text style={styles.distanceText}>Current distance · {distance}</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        {request.buttons.map((button, index) => {
          const label = button.text || 'OK';
          const isCancel = button.style === 'cancel';
          const isDanger = button.style === 'destructive';
          const isPrimary = !isCancel && index === request.buttons.length - 1;
          return (
            <Pressable
              key={`${label}-${index}`}
              onPress={() => dismissCurrent(button)}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={({ pressed }) => [
                styles.action,
                isPrimary && { backgroundColor: tone.color },
                isDanger && styles.dangerAction,
                isCancel && styles.cancelAction,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.actionText,
                  isPrimary && styles.primaryText,
                  isDanger && styles.dangerText,
                  isCancel && styles.cancelText,
                ]}
              >
                {label.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function AppDialogHost() {
  const state = useAppNotices();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    installAppDialog();
    startWorkDigest();
  }, []);

  return (
    <>
      <Modal visible={Boolean(state.current)} transparent animationType="fade" onRequestClose={() => dismissCurrent(state.current?.buttons.find((button) => button.style === 'cancel'))}>
        <View style={styles.scrim}>
          {state.current ? <DialogCard request={state.current} /> : null}
        </View>
      </Modal>
      {state.banner ? (
        <View style={styles.bannerScrim} pointerEvents="box-none">
          <View style={[styles.topBanner, { marginTop: insets.top + 8, borderLeftColor: TONE_META[state.banner.tone].color }]}>
            <Ionicons name={TONE_META[state.banner.tone].icon} size={18} color={TONE_META[state.banner.tone].color} />
            <View style={styles.bannerCopy}>
              <Text style={styles.bannerTitle} numberOfLines={1}>{state.banner.title}</Text>
              {state.banner.message ? <Text style={styles.bannerBody} numberOfLines={2}>{state.banner.message}</Text> : null}
            </View>
            <Pressable onPress={hideBanner} accessibilityRole="button" accessibilityLabel="Dismiss notification" hitSlop={8}>
              <Ionicons name="close" size={18} color="#667066" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(8, 28, 16, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
  },
  iconMedallion: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    marginTop: 4,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#122117',
  },
  body: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: '#3f4a42',
  },
  distanceChip: {
    marginTop: 14,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffedd5',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  distanceText: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '800',
  },
  actions: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  action: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef4ef',
  },
  dangerAction: { backgroundColor: '#fef2f2' },
  cancelAction: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.72 },
  actionText: { fontSize: 13, fontWeight: '800', color: '#1a5c2a' },
  primaryText: { color: '#fff' },
  dangerText: { color: '#b91c1c' },
  cancelText: { color: '#667066' },
  bannerScrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40 },
  topBanner: {
    marginHorizontal: 12,
    minHeight: 64,
    borderRadius: 16,
    borderLeftWidth: 5,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    elevation: 8,
    shadowColor: '#122117',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  bannerCopy: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: '800', color: '#122117' },
  bannerBody: { marginTop: 2, fontSize: 13, lineHeight: 18, color: '#3f4a42' },
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(8, 28, 16, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '78%',
    backgroundColor: '#f7faf7',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  sheetHead: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: '#123f24' },
  sheetList: { paddingHorizontal: 16, paddingBottom: 20, gap: 10 },
  empty: { textAlign: 'center', color: '#667066', paddingVertical: 28 },
  notice: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
  },
  noticeCopy: { flex: 1 },
  noticeTitle: { fontSize: 14, fontWeight: '800', color: '#122117' },
  noticeBody: { marginTop: 3, fontSize: 13, lineHeight: 18, color: '#3f4a42' },
  noticeTime: { marginTop: 6, fontSize: 11, fontWeight: '700', color: '#7b877f' },
});
