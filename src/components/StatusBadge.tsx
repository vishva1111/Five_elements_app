import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { HealthStatus } from '../types';

interface Props {
  status: HealthStatus;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<HealthStatus, { label: string; bg: string; text: string; emoji: string }> = {
  healthy: { label: 'Healthy', bg: '#dcfce7', text: '#15803d', emoji: '✅' },
  sick:    { label: 'Sick',    bg: '#fef9c3', text: '#a16207', emoji: '⚠️' },
  dead:    { label: 'Dead',    bg: '#fee2e2', text: '#b91c1c', emoji: '❌' },
  unknown: { label: 'Unknown', bg: '#f3f4f6', text: '#6b7280', emoji: '❓' },
};

export default function StatusBadge({ status, size = 'md' }: Props) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  const isSmall = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, isSmall && styles.badgeSm]}>
      <Text style={[styles.emoji, isSmall && styles.emojiSm]}>{config.emoji}</Text>
      <Text style={[styles.label, { color: config.text }, isSmall && styles.labelSm]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7.5,
    gap: 4,
  },
  badgeSm: { paddingHorizontal: 7, paddingVertical: 3 },
  emoji: { fontSize: 13 },
  emojiSm: { fontSize: 10 },
  label: { fontSize: 13, fontWeight: '600' },
  labelSm: { fontSize: 11 },
});