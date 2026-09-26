import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { TreeRecord, Task, TreeCondition } from '../types';
import { displayTreeId, resolveTreeId } from '../utils/treeId';
import { getAuditStatus, getDueLabel, AuditStatus } from '../services/auditService';

export interface TreeCardProps {
  tree?: TreeRecord | null;
  task?: Task | null;
  status?: 'assigned' | 'in_progress' | 'completed' | 'approved' | 'rejected';
  auditRound?: number | null;
  audits?: any[];
  dueLabel?: string;
  auditStatus?: AuditStatus;
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
  completed: '#16a34a',
  approved: '#7c3aed',
  rejected: '#ef4444',
};

function formatDateCustom(rawDate: string | number | Date | null | undefined): string {
  if (!rawDate) return '';
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
  ];
  const dayName = days[d.getDay()];
  const dayNum = d.getDate();
  const monthName = months[d.getMonth()];
  const year = d.getFullYear();
  return `${dayName}, ${dayNum} ${monthName}, ${year}`;
}

export default function TreeCard({
  tree,
  task,
  status: statusProp,
  auditRound: auditRoundProp,
  audits: auditsProp,
  dueLabel: dueLabelProp,
  auditStatus: auditStatusProp,
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

  // Compute audit status & due label for approved trees
  const computedAuditStatus = useMemo(() => {
    if (auditStatusProp) return auditStatusProp;
    if (tree || task) {
      return getAuditStatus(tree ?? { submitted_at: task?.created_at }, auditsProp ?? []);
    }
    return null;
  }, [tree, task, auditsProp, auditStatusProp]);

  const effectiveDueLabel = dueLabelProp || (computedAuditStatus ? getDueLabel(computedAuditStatus) : null);

  const statusColor = STATUS_COLORS[effectiveStatus] || '#7c3aed';
  const isRejected = effectiveStatus === 'rejected';
  const isAssigned = effectiveStatus === 'assigned' || effectiveStatus === 'in_progress';

  // Resolved ID: displayIdProp -> treeId from tree -> task ID snippet
  const resolvedId =
    displayIdProp ||
    (tree ? resolveTreeId(tree) || displayTreeId(tree) : null) ||
    (task?.task_code) ||
    (task?.id ? task.id.slice(0, 8).toUpperCase() : 'TREE');

  // Title: clean species / tree name (e.g. "Neem (B4D3AE5B)")
  const title = useMemo(() => {
    const rawName = task?.name;
    const species = tree?.species || '';
    const cleanSpecies = species.trim() && species !== 'Tree Capture' ? species.trim() : '';

    // Extract short hex code from tree.id or task
    const uuidStr = (tree?.id || task?.tree_id || task?.id || '').replace(/-/g, '');
    const shortHex = uuidStr ? uuidStr.slice(0, 8).toUpperCase() : '';

    if (cleanSpecies) {
      if (cleanSpecies.includes('(') && cleanSpecies.includes(')')) {
        return cleanSpecies;
      }
      const match = rawName?.match(/\(([A-Fa-f0-9]{4,36})\)/);
      if (match) {
        return `${cleanSpecies} (${match[1]})`;
      }
      if (shortHex) {
        return `${cleanSpecies} (${shortHex})`;
      }
      return cleanSpecies;
    }

    if (rawName) {
      const parts = rawName.split(/ — | - | · /);
      const mainPart = parts.length > 1 ? parts[parts.length - 1].trim() : rawName.trim();
      return mainPart;
    }

    return shortHex ? `Tree (${shortHex})` : 'Tree';
  }, [task?.name, task?.tree_id, task?.id, tree?.species, tree?.id]);

  // Photo URL resolution
  const photoUrl = task?.photo_url || tree?.photo_url;

  // Condition resolution
  const condition = (task?.tree_condition || tree?.tree_condition || 'Healthy') as TreeCondition;
  const conditionColor = CONDITION_COLORS[condition] || '#16a34a';

  // Audit round
  const auditRound = auditRoundProp ?? task?.audit_round;

  // Rejection notes
  const rejectionNotes = rejectionNotesProp !== undefined ? rejectionNotesProp : task?.review_notes;

  // Coordinates
  const lat = task?.latitude ?? tree?.latitude;
  const lng = task?.longitude ?? tree?.longitude;

  // Surveyor
  const surveyor = task?.surveyor || tree?.surveyor;

  // Date
  const rawDate = task?.created_at || tree?.submitted_at || tree?.survey_date;
  const dateStr = formatDateCustom(rawDate);

  const isAudit = task?.task_type === 'audit' || !!task?.audit_round || actionVariant === 'audit';
  const CardContainer = isAssigned && !onPress ? View : TouchableOpacity;
  const containerProps = isAssigned && !onPress ? {} : { onPress, activeOpacity: 0.82 };

  return (
    <CardContainer
      style={[styles.card, { borderLeftColor: isAudit ? '#ea580c' : statusColor }]}
      {...containerProps}
    >
      <View style={styles.cardMainRow}>
        {/* ─── LEFT: Photo Thumbnail (Hidden for assigned tasks unless audit task) ─── */}
        {(!isAssigned || isAudit) && (
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
          {/* Row 1: ID (left) + Status Badge (right) */}
          <View style={styles.cardHeaderRow}>
            <Text style={styles.idText} numberOfLines={1}>
              ID: <Text style={[styles.idValue, { color: isAudit ? '#ea580c' : statusColor }]}>{resolvedId}</Text>
            </Text>

            {isAssigned ? (
              onAction ? (
                <TouchableOpacity
                  style={[
                    styles.startBtn,
                    {
                      backgroundColor: actionVariant === 'audit' ? '#ea580c' : statusColor,
                      shadowColor: actionVariant === 'audit' ? '#ea580c' : statusColor,
                    },
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    onAction();
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={actionIcon || (actionVariant === 'audit' ? 'clipboard-outline' : 'play-circle-outline')}
                    size={14}
                    color="#fff"
                  />
                  <Text style={styles.startBtnText}>{actionLabel || 'Start'}</Text>
                </TouchableOpacity>
              ) : null
            ) : (
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      effectiveStatus === 'approved'
                        ? '#f3e8ff'
                        : statusColor + '15',
                    borderColor:
                      effectiveStatus === 'approved'
                        ? '#ddd6fe'
                        : statusColor + '30',
                  },
                ]}
              >
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {effectiveStatus.toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* Row 2: Tree Title / Species */}
          <Text style={styles.nameText} numberOfLines={1}>
            {title}
          </Text>

          {/* Rejection Notes Box if rejected */}
          {isRejected && rejectionNotes ? (
            <View style={styles.rejectionBox}>
              <Ionicons name="alert-circle-outline" size={12} color="#ef4444" />
              <Text style={styles.rejectionText} numberOfLines={2}>
                {rejectionNotes}
              </Text>
            </View>
          ) : null}

          {/* Row 3: Badges Row (Condition + Location) */}
          {(!isAssigned || isAudit) && (
            <View style={styles.badgesRow}>
              {condition ? (
                <View style={styles.conditionBadge}>
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
                  <Ionicons name="location-outline" size={12} color="#15803d" />
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

          {/* Row 4: Audit Progress (4 Dots + Overdue/Due Status) */}
          {((!isAssigned && effectiveStatus === 'approved') || (isAssigned && isAudit)) && computedAuditStatus ? (() => {
            const isCompleted = computedAuditStatus.allCompleted;
            const isOverdue = computedAuditStatus.isOverdue || effectiveDueLabel?.toLowerCase().includes('overdue');
            const isTaskDay = !isCompleted && !isOverdue && (computedAuditStatus.isDue || effectiveDueLabel === 'Audit Now' || effectiveDueLabel?.toLowerCase().includes('due today'));
            const isRemaining = !isCompleted && !isOverdue && !isTaskDay;

            const mainColor = isCompleted
              ? '#16a34a'
              : isOverdue
              ? '#dc2626'
              : isTaskDay
              ? '#16a34a'
              : '#2563eb';

            const bgColor = isCompleted
              ? '#f0fdf4'
              : isOverdue
              ? '#fef2f2'
              : isTaskDay
              ? '#f0fdf4'
              : '#eff6ff';

            const borderColor = isCompleted
              ? '#bbf7d0'
              : isOverdue
              ? '#fca5a5'
              : isTaskDay
              ? '#bbf7d0'
              : '#dbeafe';

            const dotRounds = [1, 2, 3, 4];

            return (
              <View style={[styles.auditProgressRow, { backgroundColor: bgColor, borderColor }]}>
                <View style={styles.dotsWrap}>
                  {dotRounds.map((r) => {
                    const isDone = r < computedAuditStatus.currentRound || (computedAuditStatus.allCompleted && r <= computedAuditStatus.completedCount);
                    const isActive = r === computedAuditStatus.currentRound && !computedAuditStatus.allCompleted;
                    return (
                      <View
                        key={r}
                        style={[
                          styles.auditDot,
                          isDone && { backgroundColor: '#22c55e' },
                          isActive && { backgroundColor: mainColor, width: 8, height: 8, borderRadius: 4 },
                          !isDone && !isActive && { backgroundColor: '#cbd5e1' },
                        ]}
                      />
                    );
                  })}
                </View>
                <Text style={[styles.auditProgressText, { color: mainColor }]} numberOfLines={1}>
                  {computedAuditStatus.allCompleted ? (
                    <Text style={{ color: '#16a34a', fontWeight: '700' }}>All 4 Audits Completed ✓</Text>
                  ) : (
                    <>
                      <Text style={{ fontWeight: '800' }}>Audit {computedAuditStatus.currentRound}</Text>
                      <Text style={{ color: mainColor, opacity: 0.6, fontWeight: '400' }}> · </Text>
                      <Text style={{ fontWeight: '700' }}>
                        {effectiveDueLabel}
                      </Text>
                    </>
                  )}
                </Text>
              </View>
            );
          })() : null}

          {/* Row 5: Date Row */}
          {dateStr ? (
            <View style={[styles.dateRow, isAssigned && styles.assignedDateRow]}>
              <Ionicons name="calendar-outline" size={12} color="#6b7280" />
              <Text style={[styles.dateText, isAssigned && styles.assignedDateText]}>
                {isAssigned ? `Assigned: ${dateStr}` : dateStr}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ─── OPTIONAL BOTTOM ACTION BUTTON ─── */}
      {!isAssigned && onAction && actionLabel && (actionVariant !== 'audit' || (computedAuditStatus && computedAuditStatus.isDue)) ? (
        <TouchableOpacity
          style={styles.actionBtnTouch}
          onPress={(e) => {
            e.stopPropagation();
            onAction();
          }}
          activeOpacity={0.82}
        >
          {isRejected || actionVariant === 'update' ? (
            <LinearGradient
              colors={['#f87171', '#ef4444', '#dc2626']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.updateGradientBtn}
            >
              <View style={styles.actionIconBadge}>
                <Ionicons name="create" size={13} color="#dc2626" />
              </View>
              <Text style={styles.updateBtnText}>{actionLabel}</Text>
              <Ionicons name="arrow-forward" size={14} color="#fff" />
            </LinearGradient>
          ) : actionVariant === 'audit' ? (
            <LinearGradient
              colors={['#2e7d32', '#1a5c2a']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.auditGradientBtn}
            >
              <View style={[styles.actionIconBadge, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="clipboard" size={13} color="#1a5c2a" />
              </View>
              <Text style={styles.updateBtnText}>{actionLabel}</Text>
              <Ionicons name="arrow-forward" size={14} color="#fff" />
            </LinearGradient>
          ) : (
            <View style={styles.defaultActionBtn}>
              <Ionicons name={actionIcon || 'chevron-forward-circle-outline'} size={15} color="#fff" />
              <Text style={styles.updateBtnText}>{actionLabel}</Text>
            </View>
          )}
        </TouchableOpacity>
      ) : null}
    </CardContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 9,
    marginBottom: 9,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    borderLeftWidth: 3.5,
    borderLeftColor: '#7c3aed',
    flexDirection: 'column',
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  photoWrap: {
    width: 76,
    height: 76,
    borderRadius: 12,
    overflow: 'hidden',
    marginRight: 10,
  },
  photo: {
    width: 76,
    height: 76,
  },
  photoPlaceholder: {
    width: 76,
    height: 76,
    borderRadius: 12,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  idText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6b7280',
    flex: 1,
  },
  idValue: {
    fontWeight: '800',
    fontSize: 10.5,
  },
  nameText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    lineHeight: 18,
    marginTop: 2,
    marginBottom: 6,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
  },
  statusDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
  },
  statusText: {
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1a5c2a',
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  startBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 10,
  },
  rejectionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 3,
    marginBottom: 3,
    backgroundColor: '#fef2f2',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderLeftWidth: 2,
    borderLeftColor: '#ef4444',
  },
  rejectionText: {
    fontSize: 9.5,
    color: '#ef4444',
    flex: 1,
    lineHeight: 13,
    fontWeight: '600',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  conditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#e8f5e9',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  conditionDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  conditionText: {
    fontWeight: '700',
    fontSize: 10,
    color: '#15803d',
  },
  locationLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  locationText: {
    fontSize: 10,
    color: '#15803d',
    fontWeight: '700',
  },
  surveyorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  surveyorText: {
    fontSize: 9.5,
    color: '#777',
    maxWidth: 90,
  },
  auditProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  dotsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  auditDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  auditProgressText: {
    fontSize: 9.5,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  assignedDateRow: {
    marginTop: 4,
    gap: 3,
  },
  dateText: {
    fontSize: 9.5,
    color: '#6b7280',
    fontWeight: '600',
  },
  assignedDateText: {
    fontSize: 9.5,
    color: '#6b7280',
    fontWeight: '600',
  },
  actionBtnTouch: {
    marginTop: 6,
    borderRadius: 10,
    overflow: 'hidden',
  },
  updateGradientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  auditGradientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  actionIconBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  defaultActionBtn: {
    backgroundColor: '#1a5c2a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
});
