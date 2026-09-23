import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TreeRecord } from '../types';
import { displayTreeId } from '../utils/treeId';

interface Props {
  tree: TreeRecord;
  onPress?: () => void;
}

const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#16a34a',
  Stressed: '#d97706',
  Diseased: '#dc2626',
  Dead: '#4b5563',
};

export default function TreeCard({ tree, onPress }: Props) {
  const date = new Date(tree.submitted_at).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Project-based tree ID only — tree_id column, with the legacy ##META## notes
  // fallback. The database uuid is never shown.
  const treeUniqueId = displayTreeId(tree);
  const conditionColor = CONDITION_COLORS[tree.tree_condition || 'Healthy'] || '#16a34a';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Photo left */}
      <View style={styles.photoWrap}>
        {tree.photo_url ? (
          <Image source={{ uri: tree.photo_url }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderText}>🌳</Text>
          </View>
        )}
      </View>

      {/* Info right */}
      <View style={styles.info}>
        <View style={styles.topRow}>
          <Text style={styles.taskId}>
            ID: <Text style={styles.taskIdValue}>{treeUniqueId}</Text>
          </Text>
          <Text style={styles.taskName} numberOfLines={1}>{tree.species || 'Tree'}</Text>
        </View>

        {/* Condition badge */}
        {tree.tree_condition ? (
          <View style={[styles.conditionBadge, { backgroundColor: conditionColor + '20', borderColor: conditionColor }]}>
            <View style={[styles.conditionDot, { backgroundColor: conditionColor }]} />
            <Text style={[styles.conditionText, { color: conditionColor }]}>{tree.tree_condition}</Text>
          </View>
        ) : null}

        {/* Bottom row */}
        <View style={styles.bottomRow}>
          {tree.latitude && tree.longitude ? (
            <View style={styles.locationBadge}>
              <Ionicons name="location-outline" size={10} color="#1a5c2a" />
              <Text style={styles.locationText}>Location</Text>
            </View>
          ) : null}
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={10} color="#888" />
            <Text style={styles.date}>{date}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    flexDirection: 'row',
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
    padding: 10,
  },
  photoWrap: {
    width: 80,
    height: 80,
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 12,
  },
  photo: {
    width: 80,
    height: 80,
  },
  photoPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 32 },
  info: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topRow: {
    marginBottom: 4,
  },
  taskId: {
    fontSize: 10,
    fontWeight: '600',
    color: '#999',
    marginBottom: 2,
  },
  taskIdValue: {
    color: '#1a5c2a',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  taskName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#222',
  },
  conditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  conditionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  conditionText: {
    fontSize: 10,
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
  },
  locationText: {
    fontSize: 10,
    color: '#1a5c2a',
    fontWeight: '600',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  date: {
    fontSize: 10,
    color: '#888',
  },
});
