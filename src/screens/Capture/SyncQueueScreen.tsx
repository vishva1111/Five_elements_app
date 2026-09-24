/**
 * SyncQueueScreen — P5 of FRD #3.
 *
 * Makes the invisible visible: what is waiting, that it is safe, and when it
 * has actually reached the platform. "Synced" here means the server confirmed
 * the insert, never that an upload merely started (P5-03).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  loadQueue,
  syncQueue,
  syncEntry,
  removeEntry,
  CaptureEntry,
} from '../../services/captureQueue';

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  local:     { bg: '#F0EDE8', fg: '#4A5A4D', label: 'Waiting' },
  uploading: { bg: '#FEF0E3', fg: '#8B3A00', label: 'Uploading…' },
  failed:    { bg: '#FDECEC', fg: '#A32020', label: 'Failed' },
  synced:    { bg: '#EAF3DE', fg: '#27500A', label: 'Synced' },
};

export default function SyncQueueScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<CaptureEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const queue = await loadQueue();
    setItems(queue);
    setLoading(false);
  }, []);

  // Re-read whenever the screen comes forward, and try a sync then too: with no
  // connectivity listener available, opening this screen is the clearest signal
  // that the user wants their queue moving.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await refresh();
        if (cancelled) return;
        const queue = await loadQueue();
        if (queue.some((e) => e.status !== 'synced')) {
          await runSync(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [refresh])
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function runSync(quiet = false) {
    setSyncing(true);
    try {
      const result = await syncQueue();
      await refresh();
      if (!quiet && result.synced === 0 && result.failed > 0) {
        Alert.alert(
          'Still waiting',
          "Nothing uploaded this time — your work is safe on this device and we'll keep trying."
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  async function retryOne(entry: CaptureEntry) {
    setSyncing(true);
    try {
      const result = await syncEntry(entry);
      await refresh();
      if (!result.ok) {
        Alert.alert('Upload failed', result.error ?? 'Please try again when you have signal.');
      }
    } finally {
      setSyncing(false);
    }
  }

  function confirmDiscard(entry: CaptureEntry) {
    Alert.alert(
      'Discard this capture?',
      'It has not reached the platform yet. This cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await removeEntry(entry.id);
            await refresh();
          },
        },
      ]
    );
  }

  const pending = items.filter((e) => e.status !== 'synced');

  const headline = syncing
    ? 'Uploading…'
    : pending.length === 0
    ? "You're all caught up"
    : `${pending.length} waiting to upload`;

  const subline = syncing
    ? 'Sending your captures to the platform.'
    : pending.length === 0
    ? "Everything's on the platform."
    : "They'll upload automatically when you're back online.";

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>Sync queue</Text>
      <Text style={styles.subtitle}>Everything here is saved on this device</Text>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusIcon,
              { backgroundColor: pending.length === 0 ? '#2B5341' : '#F09125' },
            ]}
          >
            <Ionicons
              name={pending.length === 0 ? 'checkmark' : 'cloud-upload-outline'}
              size={18}
              color="#fff"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{headline}</Text>
            <Text style={styles.statusSub}>{subline}</Text>
          </View>
        </View>

        {pending.length > 0 && (
          <TouchableOpacity
            style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
            onPress={() => runSync()}
            disabled={syncing}
            accessibilityRole="button"
          >
            {syncing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.syncBtnText}>Upload now</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} color="#2B5341" />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-done-outline" size={44} color="#AACBA7" />
          <Text style={styles.emptyTitle}>Nothing to sync</Text>
          <Text style={styles.emptySub}>
            Captures you save in the field appear here until the platform confirms them.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={() => runSync()} tintColor="#2B5341" />
          }
          renderItem={({ item }) => {
            const style = STATUS_STYLE[item.status] ?? STATUS_STYLE.local;
            return (
              <View style={styles.row}>
                <Image source={{ uri: item.localPhotoUri }} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.species || 'Capture'}
                    {item.quantity ? ` · ${item.quantity}` : ''}
                  </Text>
                  {!!item.projectName && (
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {item.projectName}
                    </Text>
                  )}
                  <Text style={styles.rowMeta}>
                    {new Date(item.capturedAt).toLocaleString()}
                  </Text>
                  {item.status === 'failed' && !!item.errorMessage && (
                    <Text style={styles.rowError}>{item.errorMessage}</Text>
                  )}

                  {item.status !== 'uploading' && item.status !== 'synced' && (
                    <View style={styles.actions}>
                      <TouchableOpacity onPress={() => retryOne(item)} disabled={syncing}>
                        <Text style={styles.actionPrimary}>Retry</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => confirmDiscard(item)} disabled={syncing}>
                        <Text style={styles.actionDanger}>Discard</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* Colour is paired with a label, never used alone (PG-08). */}
                <View style={[styles.badge, { backgroundColor: style.bg }]}>
                  <Text style={[styles.badgeText, { color: style.fg }]}>{style.label}</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      <Text style={styles.footnote}>
        Queued items stay on this device until the platform confirms receipt.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F0EC', paddingHorizontal: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#112121' },
  subtitle: { fontSize: 13, color: '#6B7B6E', marginTop: 2, marginBottom: 14 },

  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2DAD1',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 15, fontWeight: '700', color: '#112121' },
  statusSub: { fontSize: 12.5, color: '#6B7B6E', marginTop: 2 },

  syncBtn: {
    marginTop: 14,
    backgroundColor: '#2B5341',
    borderRadius: 10,
    minHeight: 48,           // 48px targets for gloved hands (PG-07)
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBtnDisabled: { opacity: 0.6 },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EDE6DF',
  },
  thumb: { width: 54, height: 54, borderRadius: 8, backgroundColor: '#E2DAD1' },
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#112121' },
  rowMeta: { fontSize: 11.5, color: '#6B7B6E', marginTop: 1 },
  rowError: { fontSize: 11.5, color: '#A32020', marginTop: 4 },

  actions: { flexDirection: 'row', gap: 18, marginTop: 8 },
  actionPrimary: { fontSize: 13, fontWeight: '700', color: '#2B5341', paddingVertical: 6 },
  actionDanger: { fontSize: 13, fontWeight: '700', color: '#A32020', paddingVertical: 6 },

  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#112121', marginTop: 12 },
  emptySub: { fontSize: 13, color: '#6B7B6E', textAlign: 'center', marginTop: 6, lineHeight: 19 },

  footnote: { fontSize: 11, color: '#9AA79C', textAlign: 'center', paddingVertical: 10 },
});
