import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TreeRecord, Task, TreeCondition } from '../types';
import { displayTreeId, resolveTreeId } from '../utils/treeId';

export interface TreeCardProps {
  tree?: TreeRecord | null;
  task?: Task | null;
  status?: 'assigned' | 'in_progress' | 'completed' | 'approved' | 'rejected';
  auditRound?: number | null;
  rejectionNotes?: string | null;
  displayId?: string;
  onPress?: () => void;
  onAction?: () => void;
  actionLabel?: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  actionVariant?: 'start' | 'update' | 'audit';
  onLocationPress?: () => void;
  showSurveyor?: boolean;
}

const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#16a34a',
  Stressed: '#d97706',
  Diseased: '#dc2626',
  Dead: '#4b5563',
};

const STATUS_COLORS: Record<string, string> = {
  assigned: '#1a5c2a',
  in_progress: '#1a5c2a',
  completed: '#22c55e',
  approved: '#8b5cf6',
  rejected: '#ef4444',
};

export default function TreeCard({
  tree,
  task,
  status: statusProp,
  auditRound: auditRoundProp,
  rejectionNotes: rejectionNotesProp,
  displayId: displayIdProp,
  onPress,
  onAction,
  actionLabel,
  actionIcon,
  actionVariant,
  onLocationPress,
  showSurveyor = false,
}: TreeCardProps) {
  // Determine effective status
  const effectiveStatus = (statusProp || task?.status || (tree?.locked ? 'approved' : 'completed')) as
    | 'assigned'
    | 'in_progress'
    | 'completed'
    | 'approved'
    | 'rejected';

  const statusColor = STATUS_COLORS[effectiveStatus] || '#1a5c2a';
  const isRejected = effectiveStatus === 'rejected';
  const isAssigned = effectiveStatus === 'assigned' || effectiveStatus === 'in_progress';

  // Resolved ID: displayIdProp -> treeId from tree -> task ID snippet
  const resolvedId =
    displayIdProp ||
    (tree ? resolveTreeId(tree) || displayTreeId(tree) : null) ||
    (task?.task_code) ||
    (task?.id ? task.id.slice(0, 8).toUpperCase() : 'TREE');

  // Title: task name or species
  const title = task?.name || tree?.species || 'Tree';

  // Photo URL resolution
  const photoUrl = task?.photo_url || tree?.photo_url;

  // Condition resolution
  const condition = (task?.tree_condition || tree?.tree_condition || 'Healthy') as TreeCondition;
  const conditionColor = CONDITION_COLORS[condition] || '#16a34a';

  // Audit round
  const auditRound = auditRoundProp ?? task?.audit_round;

  // Rejection notes
  const rejectionNotes = rejectionNotesProp || task?.review_notes;

  // Coordinates
  const lat = task?.latitude ?? tree?.latitude;
  const lng = task?.longitude ?? tree?.longitude;

  // Surveyor
  const surveyor = task?.surveyor || tree?.surveyor;

  // Date
  const rawDate = task?.created_at || tree?.submitted_at || tree?.survey_date;
  const dateStr = rawDate
    ? new Date(rawDate).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

  const CardContainer = isAssigned ? View : TouchableOpacity;
  const containerProps = isAssigned ? {} : { onPress, activeOpacity: 0.8 };

  return (
    <CardContainer
      style={[styles.card, { borderLeftColor: statusColor }]}
      {...containerProps}
    >
      {/* ─── LEFT: 80x80 Photo Thumbnail (Hidden for assigned tasks) ─── */}
      {!isAssigned && (
        <View style={styles.photoWrap}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="leaf-outline" size={28} color="#1a5c2a" />
            </View>
          )}
        </View>
      )}

      {/* ─── RIGHT: Card Content ─── */}
      <View style={styles.cardContent}>
        {/* Top: ID + Title + Status / Top Action */}
        <View style={styles.cardTop}>
          <View style={styles.titleWrap}>
            <Text style={styles.idText} numberOfLines={1}>
              ID: <Text style={[styles.idValue, { color: statusColor }]}>{resolvedId}</Text>
            </Text>
            <Text style={styles.nameText} numberOfLines={1}>
              {title}
            </Text>
            {!isAssigned && auditRound != null ? (
              <View style={styles.auditChip}>
                <Ionicons name="clipboard-outline" size={10} color="#1a5c2a" />
                <Text style={styles.auditChipText}>Audit {auditRound}</Text>
              </View>
            ) : null}
          </View>

          {/* Top Right Action or Status Badge */}
          {isAssigned ? (
            onAction ? (
              <TouchableOpacity
                style={[styles.startBtn, { backgroundColor: statusColor, shadowColor: statusColor }]}
                onPress={(e) => {
                  e.stopPropagation();
                  onAction();
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="play-circle-outline" size={15} color="#fff" />
                <Text style={styles.startBtnText}>{actionLabel || 'Start'}</Text>
              </TouchableOpacity>
            ) : null
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '18', borderColor: statusColor + '30' }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {effectiveStatus.toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        {/* Rejection Notes Box */}
        {isRejected && rejectionNotes ? (
          <View style={styles.rejectionBox}>
            <Ionicons name="alert-circle-outline" size={12} color="#ef4444" />
            <Text style={styles.rejectionText} numberOfLines={2}>
              {rejectionNotes}
            </Text>
          </View>
        ) : null}

        {/* Badges Row: Condition + Location + Surveyor (Hidden for assigned tasks) */}
        {!isAssigned && (
          <View style={styles.badgesRow}>
            {condition ? (
              <View
                style={[
                  styles.conditionBadge,
                  { backgroundColor: conditionColor + '15', borderColor: conditionColor + '40' },
                ]}
              >
                <View style={[styles.conditionDot, { backgroundColor: conditionColor }]} />
                <Text style={[styles.conditionText, { color: conditionColor }]}>{condition}</Text>
              </View>
            ) : null}

            {lat != null && lng != null ? (
              <TouchableOpacity
                style={styles.locationLink}
                onPress={(e) => {
                  if (onLocationPress) {
                    e.stopPropagation();
                    onLocationPress();
                  }
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="location-outline" size={11} color="#1a5c2a" />
                <Text style={styles.locationText}>Location</Text>
              </TouchableOpacity>
            ) : null}

            {showSurveyor && surveyor ? (
              <View style={styles.surveyorRow}>
                <Ionicons name="person-outline" size={10} color="#888" />
                <Text style={styles.surveyorText} numberOfLines={1}>
                  {surveyor}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Date Row */}
        {dateStr ? (
          <View style={[styles.dateRow, isAssigned && styles.assignedDateRow]}>
            <Ionicons name="calendar-outline" size={isAssigned ? 12 : 10} color="#777" />
            <Text style={[styles.dateText, isAssigned && styles.assignedDateText]}>
              {isAssigned ? `Assigned: ${dateStr}` : dateStr}
            </Text>
          </View>
        ) : null}

        {/* Bottom Full-Width Action Button (e.g. Update Submission for rejected, or Audit) */}
        {!isAssigned && onAction && actionLabel ? (
          <TouchableOpacity
            style={[
              styles.bottomActionBtn,
              actionVariant === 'update' || isRejected
                ? styles.updateBtn
                : actionVariant === 'audit'
                ? styles.auditBtn
                : styles.defaultActionBtn,
            ]}
            onPress={(e) => {
              e.stopPropagation();
              onAction();
            }}
            activeOpacity={0.8}
          >
            <Ionicons
              name={actionIcon || (isRejected ? 'refresh-circle-outline' : 'clipboard-outline')}
              size={15}
              color="#fff"
            />
            <Text style={styles.bottomActionText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </CardContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    elevation: 3,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    borderLeftWidth: 3.5,
    borderLeftColor: '#1a5c2a',
    flexDirection: 'row',
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
    borderRadius: 14,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleWrap: {
    flex: 1,
  },
  idText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#999',
    marginBottom: 2,
  },
  idValue: {
    color: '#1a5c2a',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  nameText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#222',
  },
  auditChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#E8F5E9',
    borderRadius: 10,
  },
  auditChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1a5c2a',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a5c2a',
    borderRadius: 14,
    paddingVertical: 7,
    paddingHorizontal: 14,
    elevation: 3,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  startBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.4,
  },
  rejectionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 6,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderLeftWidth: 2,
    borderLeftColor: '#ef4444',
  },
  rejectionText: {
    fontSize: 10,
    color: '#ef4444',
    flex: 1,
    lineHeight: 14,
    fontWeight: '600',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  conditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  conditionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  conditionText: {
    fontWeight: '700',
    fontSize: 10,
  },
  locationLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
  },
  locationText: {
    fontSize: 10,
    color: '#1a5c2a',
    fontWeight: '800',
  },
  surveyorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  surveyorText: {
    fontSize: 10,
    color: '#777',
    maxWidth: 90,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 5,
  },
  assignedDateRow: {
    marginTop: 8,
    gap: 5,
  },
  dateText: {
    fontSize: 10,
    color: '#888',
  },
  assignedDateText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '600',
  },
  bottomActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 8,
    marginTop: 8,
    elevation: 2,
  },
  updateBtn: {
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  auditBtn: {
    backgroundColor: '#1a5c2a',
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  defaultActionBtn: {
    backgroundColor: '#1a5c2a',
  },
  bottomActionText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 11,
  },
});
