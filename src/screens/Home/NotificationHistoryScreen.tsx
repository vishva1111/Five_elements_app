import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppNotice, useAppNotices } from '../../services/appDialog';

const TONE_COLOR = {
  warning: '#b45309',
  success: '#166534',
  danger: '#b91c1c',
  info: '#1a5c2a',
};

function formatWhen(at: number) {
  return new Date(at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function NotificationHistoryScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const notices = useAppNotices().notices;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>History of notices shown at the top</Text>
        </View>
      </LinearGradient>
      <FlatList
        data={notices}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
        ListEmptyComponent={<Text style={styles.empty}>No notifications yet.</Text>}
        renderItem={({ item }) => <NoticeRow notice={item} />}
      />
    </View>
  );
}

function NoticeRow({ notice }: { notice: AppNotice }) {
  return (
    <View style={[styles.row, { borderLeftColor: TONE_COLOR[notice.tone] }]}>
      <Text style={styles.rowTitle}>{notice.title}</Text>
      {notice.message ? <Text style={styles.rowBody}>{notice.message}</Text> : null}
      <Text style={styles.rowTime}>{formatWhen(notice.at)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerCopy: { flex: 1 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2 },
  list: { padding: 16, gap: 10 },
  empty: { textAlign: 'center', color: '#667066', paddingVertical: 48 },
  row: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderLeftWidth: 5,
    padding: 14,
  },
  rowTitle: { fontSize: 15, fontWeight: '800', color: '#122117' },
  rowBody: { marginTop: 4, fontSize: 13, lineHeight: 19, color: '#3f4a42' },
  rowTime: { marginTop: 8, fontSize: 11, fontWeight: '700', color: '#7b877f' },
});
