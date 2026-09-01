import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TreeRecord } from '../types';
import StatusBadge from './StatusBadge';

interface Props {
  tree: TreeRecord;
  onPress?: () => void;
}

export default function TreeCard({ tree, onPress }: Props) {
  const date = new Date(tree.submitted_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Photo */}
      {tree.photo_url ? (
        <Image source={{ uri: tree.photo_url }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderText}>🌳</Text>
        </View>
      )}

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.topRow}>
          <Text style={styles.species} numberOfLines={1}>{tree.species}</Text>
          <StatusBadge status={tree.health_status} size="sm" />
        </View>

        <Text style={styles.coords}>
          📍 {tree.latitude.toFixed(5)}, {tree.longitude.toFixed(5)}
        </Text>

        {tree.project_name ? (
          <View style={styles.projectRow}>
            <Ionicons name="folder-outline" size={12} color="#1a5c2a" />
            <Text style={styles.projectName} numberOfLines={1}>{tree.project_name}</Text>
          </View>
        ) : null}

        {tree.notes ? (
          <Text style={styles.notes} numberOfLines={2}>{tree.notes}</Text>
        ) : null}

        <Text style={styles.date}>{date}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
  },
  photo: { width: '100%', height: 160 },
  photoPlaceholder: {
    width: '100%',
    height: 100,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 40 },
  info: { padding: 14 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  species: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', flex: 1, marginRight: 8 },
  coords: { fontSize: 12, color: '#888', marginBottom: 4 },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  projectName: { fontSize: 12, color: '#1a5c2a', fontWeight: '500' },
  notes: { fontSize: 13, color: '#555', marginBottom: 6, lineHeight: 18 },
  date: { fontSize: 11, color: '#aaa' },
});
