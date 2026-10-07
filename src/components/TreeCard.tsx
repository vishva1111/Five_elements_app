import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { TreeRecord, Task, TreeCondition } from '../types';
import { isAutoTreeId, resolveTreeId, shortRecordCode, splitLabeledTreeName } from '../utils/treeId';
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
  const isCompleted = effectiveStatus === 'completed';
  const isApproved = effectiveStatus === 'approved';

  // The code in the name, such as Saag (TREE-A38IN14), is the tree ID.
  // A generated TREE-#### value and the record's short hex code are fallbacks.
  const labeled = splitLabeledTreeName(tree?.species) ;
  const taskLabeled = splitLabeledTreeName(task?.name || task?.title);
  const labeledCode = labeled.code || taskLabeled.code;
  const storedId = tree ? resolveTreeId(tree) : '';
  const nameCode =
    shortRecordCode(tree?.id) ||
    shortRecordCode(task?.tree_id) ||
    shortRecordCode(task?.id);
  const taskCode = task?.task_code?.trim() || '';
  const isAssignedCard = effectiveStatus === 'assigned' || effectiveStatus === 'in_progress';
  const resolvedId = isAssignedCard
    ? taskCode || (task?.id ? task.id.slice(0, 8).toUpperCase() : '—')
    : (labeledCode && !isAutoTreeId(labeledCode) ? labeledCode : '') ||
      (displayIdProp && !isAutoTreeId(displayIdProp) ? displayIdProp : '') ||
      (storedId && !isAutoTreeId(storedId) ? storedId : '') ||
      nameCode ||
      '—';

  // Title is the species only. The ID in parentheses stays on the ID line.
  const title = useMemo(() => {
    const species = (tree?.species || '').trim();
    if (species && species !== 'Tree Capture') {
      return splitLabeledTreeName(species).name || species;
    }

    const rawName = (task?.name || task?.title || '').trim();
    if (rawName) {
      return splitLabeledTreeName(rawName).name || 'Tree';
    }

    return 'Tree';
  }, [task?.name, task?.title, tree?.species]);

  // Photo URL resolution. An audited card shows the latest audit's front photo,
  // not the original planting photo that is still stored on the tree.
  const latestAuditPhoto = useMemo(() => {
    const audits = auditsProp ?? [];
    let latest: any = null;
    let latestRound = -1;
    for (const audit of audits) {
      const round = Number(audit?.monitoring_round) || 0;
      if (round >= latestRound) {
        latest = audit;
        latestRound = round;
      }
    }
    const urls = Array.isArray(latest?.photo_urls) ? latest.photo_urls : [];
    const front = urls.find((url: unknown) => typeof url === 'string' && url);
    return front || latest?.photo_url || null;
  }, [auditsProp]);
  const photoUrl = latestAuditPhoto || task?.photo_url || tree?.photo_url;

  // Condition is an audit result: it is shown only once the tree has actually
  // been audited (at least one monitoring round exists). On an approved card the
  // latest audit's condition wins, so the card updates only when the approved
  // tree was audited — an un-audited approved tree keeps its card unchanged.
  const hasCompletedAudit = (auditsProp ?? []).some(
    (audit) => Number(audit?.monitoring_round) >= 1
  );
  const recordedCondition = task?.tree_condition || tree?.tree_condition;
  const condition =
    hasCompletedAudit && recordedCondition ? (recordedCondition as TreeCondition) : null;
  const conditionColor = condition ? CONDITION_COLORS[condition] || '#16a34a' : '#16a34a';

  // Audit round
  const auditRound = auditRoundProp ?? task?.audit_round;

  // Rejection notes
  const rejectionNotes = rejectionNotesProp !== undefined ? rejectionNotesProp : task?.review_notes;

  // Coordinates
  const lat = task?.latitude ?? tree?.latitude;
  const lng = task?.longitude ?? tree?.longitude;

  // Surveyor
  const surveyor = tree?.surveyor || task?.surveyor;
  const landType = tree?.land_type;

  const isAudit =
    task?.task_type === 'audit' ||
    !!task?.audit_round ||
    actionVariant === 'audit' ||
    ((effectiveStatus === 'approved' || effectiveStatus === 'rejected') && hasCompletedAudit);
  const isCompletedAudit = effectiveStatus === 'completed' && isAudit;
  const isUpdatedCard = effectiveStatus === 'completed' && Boolean(task?.review_notes);
  const isAuditCard = isAudit && (isAssigned || isCompleted || isApproved || isRejected);
  const auditColor = isUpdatedCard
    ? '#ea580c'
    : isAssigned
    ? '#1a5c2a'
    : isApproved
    ? '#7c3aed'
    : isRejected
    ? '#ef4444'
    : '#16a34a';
  const auditTint = isUpdatedCard
    ? '#fff7ed'
    : isAssigned
    ? '#e5f6ea'
    : isApproved
    ? '#f5f3ff'
    : isRejected
    ? '#fef2f2'
    : '#f0fdf4';
  const auditBorder = isUpdatedCard
    ? '#fdba74'
    : isAssigned
    ? '#bbf7d0'
    : isApproved
    ? '#ddd6fe'
    : isRejected
    ? '#fca5a5'
    : '#bbf7d0';
  const showAuditedApprovedCard = isApproved && isAudit && hasCompletedAudit;
  // Date follows the card status: assigned, completed, rejected, approved, or the audit date.
  const rawDate = isAudit
    ? tree?.survey_date || task?.completed_at || task?.due_date || task?.created_at
    : tree?.survey_date || task?.reviewed_at || task?.completed_at || tree?.submitted_at || task?.created_at;
  const dateStr = formatDateCustom(rawDate);
  const dateLabel = isAudit
    ? isCompletedAudit
      ? 'Audited'
      : 'Audit'
    : effectiveStatus === 'approved'
    ? 'Approved'
    : effectiveStatus === 'rejected'
    ? 'Rejected'
    : isUpdatedCard
    ? 'Edited'
    : effectiveStatus === 'completed'
    ? 'Completed'
    : isAssigned
    ? 'Assigned'
    : '';
  const CardContainer = isAssigned && !onPress ? View : TouchableOpacity;
  const containerProps = isAssigned && !onPress ? {} : { onPress, activeOpacity: 0.82 };

  return (
    <CardContainer
      style={[
        styles.card,
        // Every state shares the Assign-tab card design: white card, no coloured
        // left border, a 5px accent bar on the left and identical padding.
        isAssigned && styles.plantingCard,
        (isCompleted || isApproved) && styles.statusCard,
        isRejected && styles.rejectedCard,
      ]}
      {...containerProps}
    >
      {isAuditCard ? (
        <View style={[styles.rejectedAccent, { backgroundColor: auditColor }]} />
      ) : isAssigned ? (
        <View style={[styles.plantingAccent, { backgroundColor: statusColor }]} />
      ) : isCompleted ? (
        <View style={[styles.statusAccent, { backgroundColor: isUpdatedCard ? '#ea580c' : statusColor }]} />
      ) : isApproved ? (
        <View style={[styles.statusAccent, { backgroundColor: statusColor }]} />
      ) : isRejected ? (
        <View style={styles.rejectedAccent} />
      ) : null}
      <View style={[styles.cardMainRow, styles.plantingRow]}>
        {isAssigned && !isAudit && !photoUrl ? (
          <View style={styles.plantingMark}>
            <Ionicons name="leaf" size={22} color="#1a5c2a" />
          </View>
        ) : (
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
              ID: <Text style={[styles.idValue, { color: isAuditCard ? auditColor : isUpdatedCard ? '#ea580c' : statusColor }]}>{resolvedId}</Text>
            </Text>

            {isAuditCard ? (
              <View style={[styles.statusBadge, { backgroundColor: auditTint, borderColor: auditBorder }]}>
                <View style={[styles.statusDot, { backgroundColor: auditColor }]} />
                <Text style={[styles.statusText, { color: auditColor }]}>
                  {isUpdatedCard ? 'EDITED' : isAssigned ? 'ASSIGNED' : isApproved ? 'APPROVED' : isRejected ? 'REJECTED' : 'COMPLETED'}
                </Text>
              </View>
            ) : isAssigned ? null : (
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      effectiveStatus === 'completed' && task?.review_notes
                        ? '#fff7ed'
                        : effectiveStatus === 'approved'
                        ? '#f3e8ff'
                        : statusColor + '15',
                    borderColor:
                      effectiveStatus === 'completed' && task?.review_notes
                        ? '#fdba74'
                        : effectiveStatus === 'approved'
                        ? '#ddd6fe'
                        : statusColor + '30',
                  },
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        effectiveStatus === 'completed' && task?.review_notes ? '#ea580c' : statusColor,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    {
                      color:
                        effectiveStatus === 'completed' && task?.review_notes ? '#ea580c' : statusColor,
                    },
                  ]}
                >
                  {effectiveStatus === 'completed' && task?.review_notes ? 'EDITED' : effectiveStatus.toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* Row 2: Tree Title / Species */}
          <Text style={styles.nameText} numberOfLines={1}>
            {title}
          </Text>

          {/* Row 3: Badges Row (Location stays in its original place) */}
          {(!isAssigned || isAudit || lat != null || condition) ? (
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
                  accessibilityRole="button"
                  accessibilityLabel="Open location"
                >
                  <Ionicons name="location-outline" size={12} color="#15803d" />
                  <Text style={styles.locationText}>Location</Text>
                </TouchableOpacity>
              ) : null}

              {showSurveyor && (surveyor || landType) ? (
                <View style={styles.surveyorRow}>
                  <Ionicons name="person-outline" size={10} color="#888" />
                  <Text style={styles.surveyorText} numberOfLines={1}>
                    {[surveyor, landType].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Row 4: Audit 1–4 tabs. An assigned audit card always shows them. */}
          {isAudit && (isAssigned || isRejected || isCompletedAudit || showAuditedApprovedCard) ? (() => {
            const status = computedAuditStatus;
            const finishedRound = Number(auditRound) || status?.maxRound || status?.completedCount || 1;
            const isFinishedAuditCard = isCompletedAudit;
            const isRejectedAuditCard = isRejected && isAudit;
            const isCompleted = Boolean(status?.allCompleted) && !isFinishedAuditCard && !isRejectedAuditCard;
            const isOverdue = !isFinishedAuditCard && !isRejectedAuditCard && (status?.isOverdue || effectiveDueLabel?.toLowerCase().includes('overdue'));
            const isTaskDay = !isFinishedAuditCard && !isRejectedAuditCard && !isCompleted && !isOverdue && (status?.isDue || effectiveDueLabel === 'Audit Now' || effectiveDueLabel?.toLowerCase().includes('due today'));
            const isRemaining = !isFinishedAuditCard && !isRejectedAuditCard && !isCompleted && !isOverdue && !isTaskDay;

            const mainColor = isAuditCard
              ? auditColor
              : isOverdue
              ? '#dc2626'
              : isTaskDay
              ? '#16a34a'
              : '#2563eb';

            const bgColor = isAuditCard
              ? auditTint
              : isOverdue
              ? '#fef2f2'
              : isTaskDay
              ? '#f0fdf4'
              : '#eff6ff';

            const borderColor = isAuditCard
              ? auditBorder
              : isOverdue
              ? '#fca5a5'
              : isTaskDay
              ? '#bbf7d0'
              : '#dbeafe';

            const tabDotColor = isAuditCard ? auditColor : mainColor;
            const pinnedRound = isFinishedAuditCard || isRejectedAuditCard || showAuditedApprovedCard;
            const dotRounds = [1, 2, 3, 4];

            return (
              <View style={[styles.auditProgressRow, { backgroundColor: bgColor, borderColor }]}>
                <View style={styles.dotsWrap}>
                  {dotRounds.map((r) => {
                    const isDone = pinnedRound
                      ? r < finishedRound
                      : r < (status?.currentRound ?? 1) || (status?.allCompleted && r <= (status?.completedCount ?? 0));
                    const isActive = pinnedRound
                      ? r === finishedRound
                      : r === (status?.currentRound ?? 1) && !status?.allCompleted;
                    return (
                      <View
                        key={r}
                        style={[
                          styles.auditDot,
                          isDone && { backgroundColor: tabDotColor },
                          isActive && { backgroundColor: tabDotColor, width: 8, height: 8, borderRadius: 4 },
                          !isDone && !isActive && { backgroundColor: '#cbd5e1' },
                        ]}
                      />
                    );
                  })}
                </View>
                {(status?.completedCount ?? 0) > 0 ? (
                  <View style={styles.auditCountDot}>
                    <Text style={styles.auditCountText}>{status?.completedCount}</Text>
                  </View>
                ) : null}
                <Text style={[styles.auditProgressText, { color: mainColor }]} numberOfLines={1}>
                  {isFinishedAuditCard ? (
                    <Text style={{ color: auditColor, fontWeight: '800' }}>Audit {finishedRound} is completed</Text>
                  ) : showAuditedApprovedCard ? (
                    <Text style={{ color: auditColor, fontWeight: '800' }}>Audit {finishedRound} approved</Text>
                  ) : isRejectedAuditCard ? (
                    <Text style={{ color: auditColor, fontWeight: '800' }}>Audit {finishedRound} rejected</Text>
                  ) : status?.allCompleted ? (
                    <Text style={{ color: '#16a34a', fontWeight: '700' }}>All 4 Audits Completed ✓</Text>
                  ) : (
                    <>
                      <Text style={{ fontWeight: '800' }}>Audit {status?.currentRound ?? finishedRound}</Text>
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
                {dateLabel ? `${dateLabel}: ${dateStr}` : dateStr}
              </Text>
            </View>
          ) : null}
        </View>
        {isAssigned && !isAudit && onAction ? (
          <TouchableOpacity
            style={styles.plantingBtn}
            onPress={onAction}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Planting"
          >
            <Ionicons name="leaf" size={16} color="#fff" />
            <Text style={styles.plantingBtnText}>{actionLabel || 'Planting'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ─── OPTIONAL BOTTOM ACTION BUTTON ─── */}
      {!isAssigned && !isRejected && onAction && actionLabel ? (
        <TouchableOpacity
          style={styles.actionBtnTouch}
          onPress={(e) => {
            e.stopPropagation();
            onAction();
          }}
          activeOpacity={0.82}
        >
          {actionVariant === 'audit' ? (
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
  plantingCard: {
    backgroundColor: '#fff',
    borderLeftWidth: 0,
    overflow: 'hidden',
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 11,
  },
  plantingAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },
  completedAuditAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: '#ea580c',
  },
  completedAuditAccentPlain: {
    backgroundColor: '#16a34a',
  },
  statusCard: {
    backgroundColor: '#fff',
    borderLeftWidth: 0,
    overflow: 'hidden',
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 11,
  },
  statusAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },
  rejectedCard: {
    backgroundColor: '#fff',
    borderLeftWidth: 0,
    overflow: 'hidden',
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 11,
  },
  rejectedAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: '#ef4444',
  },
  completedAuditBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: '#ffedd5',
    borderWidth: 1,
    borderColor: '#fdba74',
  },
  completedAuditBadgePlain: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  completedAuditBadgeText: {
    color: '#9a3412',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  completedAuditBadgeTextPlain: {
    color: '#166534',
  },
  plantingMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5f6ea',
  },
  plantingBtn: {
    width: 58,
    height: 58,
    borderRadius: 12,
    marginLeft: 8,
    backgroundColor: '#1a5c2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plantingBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 9,
    marginTop: 2,
  },
  updateSquareBtn: {
    width: 46,
    height: 46,
    borderRadius: 10,
    marginLeft: 8,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  updateSquareText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 9,
    marginTop: 2,
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  plantingRow: {
    alignItems: 'center',
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
  // Audit count dot — number of completed audits, shown only after the first audit.
  auditCountDot: {
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  auditCountText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  assignedDateRow: {
    marginTop: 1,
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
  rejectedActionBtn: {
    backgroundColor: '#dc2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
});
