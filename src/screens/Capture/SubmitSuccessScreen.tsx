import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaptureStackParamList } from '../../types';
import { useTaskStore } from '../../store/taskStore';

type Route = RouteProp<CaptureStackParamList, 'SubmitSuccess'>;

const SAVED = [
  { icon: 'image-outline' as const, label: 'Photo on the tree record' },
  { icon: 'navigate-outline' as const, label: 'GPS point locked' },
  { icon: 'cloud-done-outline' as const, label: 'Sent to the admin panel' },
];

export default function SubmitSuccessScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const treeId = route.params?.treeId;
  const ticket = treeId ? treeId.replace(/-/g, '').slice(0, 8).toUpperCase() : 'FIELD';

  const openNextTask = () => {
    useTaskStore.getState().openTaskTab('assigned');
    navigation.navigate('Main', { screen: 'Task', params: { tab: 'assigned', at: Date.now() } });
  };

  const openTreeDetails = () => {
    if (!treeId) return;
    navigation.navigate('TreeDetail', { treeId });
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.ticket}>
        <View style={styles.ticketHead}>
          <Text style={styles.ticketMark}>Field ticket</Text>
          <Text style={styles.ticketCode}>{ticket}</Text>
        </View>
        <View style={styles.stamp}>
          <Ionicons name="checkmark" size={28} color="#14301C" />
        </View>
        <Text style={styles.title}>Tree on record</Text>
        <Text style={styles.copy}>
          This planting is saved. The admin panel already has the photo, the point, and the tree name.
        </Text>
        <View style={styles.rows}>
          {SAVED.map((item) => (
            <View key={item.label} style={styles.row}>
              <Ionicons name={item.icon} size={18} color="#1F6B3A" />
              <Text style={styles.rowText}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.next, pressed && styles.pressed]}
        onPress={openNextTask}
        accessibilityRole="button"
        accessibilityLabel="Next Task"
      >
        <Ionicons name="arrow-forward" size={18} color="#FFFDF8" />
        <Text style={styles.nextText}>Next Task</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.details, pressed && styles.pressed]}
        onPress={openTreeDetails}
        disabled={!treeId}
        accessibilityRole="button"
        accessibilityLabel="Tree Details"
      >
        <Text style={[styles.detailsText, !treeId && styles.detailsMuted]}>Tree Details</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#E7F0E4',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  ticket: {
    backgroundColor: '#FFFDF8',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#D5E3D4',
  },
  ticketHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ticketMark: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F6B3A',
    letterSpacing: 0.2,
  },
  ticketCode: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5C7262',
  },
  stamp: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#1F6B3A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: '#14301C',
  },
  copy: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 24,
    color: '#3E5646',
    maxWidth: 320,
  },
  rows: {
    marginTop: 24,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#D5E3D4',
    paddingTop: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 28,
  },
  rowText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#14301C',
    fontWeight: '600',
  },
  next: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#1F6B3A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextText: {
    color: '#FFFDF8',
    fontSize: 16,
    fontWeight: '700',
  },
  details: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  detailsText: {
    color: '#1F6B3A',
    fontSize: 16,
    fontWeight: '700',
  },
  detailsMuted: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.82,
  },
});
