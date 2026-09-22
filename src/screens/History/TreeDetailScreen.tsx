import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Modal,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { HistoryStackParamList, TreeRecord, getMonitoringRoundInfo } from '../../types';
import { fetchTreeById, ensureProjectTreeId, fetchTreeMonitoringRecords } from '../../services/treeService';
import {
  getAuditStatus,
  formatDateFriendly,
  getLatestAudit,
} from '../../services/auditService';
import { getPendingMonitoringRecords } from '../../services/localMonitoringService';
import { displayTreeId, parseTreeMeta, stripTreeMeta, resolveTreeId } from '../../utils/treeId';
import MapPreview from '../../components/MapPreview';

type Route = RouteProp<HistoryStackParamList, 'TreeDetail'>;
type Nav = NativeStackNavigationProp<HistoryStackParamList, 'TreeDetail'>;

const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#16a34a',
  Stressed: '#d97706',
  Diseased: '#dc2626',
  Dead: '#4b5563',
};

const SURVIVAL_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  alive: { bg: '#dcfce7', text: '#16a34a', icon: 'checkmark-circle' },
  dead: { bg: '#fee2e2', text: '#dc2626', icon: 'close-circle' },
  missing: { bg: '#fef3c7', text: '#d97706', icon: 'help-circle' },
};

export default function TreeDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { treeId } = route.params;
  const [tree, setTree] = useState<TreeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [audits, setAudits] = useState<any[]>([]);
  const [hubTab, setHubTab] = useState<'growth' | 'history' | 'baseline'>('growth');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [photoMode, setPhotoMode] = useState<'latest' | 'planting' | 'both'>('latest');
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  const loadTreeData = useCallback(async () => {
    try {
      let { data } = await fetchTreeById(treeId);

      // If treeId was an audit id, resolve it to the underlying tree
      if (!data) {
        try {
          const local = (await getPendingMonitoringRecords()).find((r) => r.id === treeId);
          if (local?.tree_record_id) {
            const res2 = await fetchTreeById(local.tree_record_id);
            data = res2.data;
          }
        } catch {}
      }

      if (!data) {
        setLoading(false);
        return;
      }

      if (!(data.tree_id ?? '').trim()) {
        const assigned = await ensureProjectTreeId(data);
        if (assigned) data.tree_id = assigned;
      }

      setTree(data);
      setLoading(false);

      // Fetch monitoring records (both DB + local pending)
      try {
        const { data: records } = await fetchTreeMonitoringRecords(data.id);
        const sorted = (records ?? []).slice().sort((a, b) => {
          const ra = Number(a?.monitoring_round) || 0;
          const rb = Number(b?.monitoring_round) || 0;
          if (ra !== rb) return ra - rb;
          return String(a?.survey_date ?? a?.submitted_at ?? '').localeCompare(
            String(b?.survey_date ?? b?.submitted_at ?? '')
          );
        });
        setAudits(sorted);
      } catch (auditErr) {
        console.warn('[TreeApp] fetch audits failed:', auditErr);
      }
    } catch (err) {
      console.warn('[TreeApp] fetchTreeById failed:', err);
      setLoading(false);
    }
  }, [treeId]);

  useFocusEffect(
    useCallback(() => {
      loadTreeData();
    }, [loadTreeData])
  );

  const openInMaps = () => {
    if (!tree) return;
    const url = `https://www.openstreetmap.org/?mlat=${tree.latitude}&mlon=${tree.longitude}&zoom=17`;
    Linking.openURL(url);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a5c2a" />
      </View>
    );
  }

  if (!tree) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Tree record not found.</Text>
      </View>
    );
  }

  const date = new Date(tree.submitted_at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const displayId = displayTreeId(tree);
  const meta = parseTreeMeta(tree.notes);
  const cleanNotes = stripTreeMeta(tree.notes);

  const scientificName = tree.scientific_name || meta.scientific_name || '';
  const dbhCm = tree.dbh_cm || meta.dbh_cm;
  const heightM = tree.height_m || meta.height_m;
  const woodDensity = tree.wood_density || meta.wood_density;
  const crownDiam = tree.crown_diameter_m || meta.crown_diameter_m;
  const treeCondition = tree.tree_condition || meta.tree_condition;
  const multiStem = tree.multi_stem || meta.multi_stem;
  const ageYears = tree.age_years || meta.age_years;
  const landType = tree.land_type || meta.land_type;
  const eventType = tree.event_type || meta.event_type;
  const quantity = tree.quantity || meta.quantity;
  const surveyor = tree.surveyor || meta.surveyor;
  const surveyDate = tree.survey_date || meta.survey_date;

  const auditStatus = getAuditStatus(tree, audits);
  const latestAudit = getLatestAudit(audits);

  const latestDbh = latestAudit?.dbh_cm ?? dbhCm;
  const latestHeight = latestAudit?.height_m ?? heightM;
  const latestCrown = latestAudit?.crown_diameter_m ?? crownDiam;
  const latestCondition = latestAudit?.tree_condition ?? treeCondition;
  const latestConditionColor = CONDITION_COLORS[latestCondition || 'Healthy'] || '#16a34a';
  const latestSurvivalStatus: string = latestAudit?.survival_status ?? 'alive';
  const survivalConfig = SURVIVAL_COLORS[latestSurvivalStatus] ?? SURVIVAL_COLORS.alive;

  // Growth calculation compared to planting baseline
  const dbhBaselineNum = dbhCm != null && !isNaN(Number(dbhCm)) ? Number(dbhCm) : null;
  const dbhLatestNum = latestDbh != null && !isNaN(Number(latestDbh)) ? Number(latestDbh) : null;
  const dbhDiff =
    dbhBaselineNum !== null && dbhLatestNum !== null
      ? (dbhLatestNum - dbhBaselineNum).toFixed(1)
      : null;

  const heightBaselineNum = heightM != null && !isNaN(Number(heightM)) ? Number(heightM) : null;
  const heightLatestNum = latestHeight != null && !isNaN(Number(latestHeight)) ? Number(latestHeight) : null;
  const heightDiff =
    heightBaselineNum !== null && heightLatestNum !== null
      ? (heightLatestNum - heightBaselineNum).toFixed(1)
      : null;

  const completedRoundsSet = new Set(audits.map((a) => Number(a.monitoring_round)).filter(Boolean));
  const liveTreeId = resolveTreeId(tree) || treeId;

  const hasUpdatedPhoto = Boolean(latestAudit?.photo_url && latestAudit.photo_url !== tree.photo_url);

  // Active photo URI according to selected switcher tab
  const currentPhotoUri =
    photoMode === 'planting' || !latestAudit?.photo_url
      ? tree.photo_url
      : latestAudit.photo_url;
  const isShowingAudit = photoMode === 'latest' && Boolean(latestAudit?.photo_url);

  // Render timeline helper (used in history tab or drawer)
  const renderAuditTimeline = () => {
    if (audits.length === 0) {
      return (
        <View style={styles.emptyHistoryBox}>
          <Ionicons name="hourglass-outline" size={24} color="#9ca3af" />
          <Text style={styles.emptyHistoryText}>No past audits yet. Start Audit 1 below.</Text>
        </View>
      );
    }

    return (
      <View style={styles.timeline}>
        {audits.map((a, idx) => {
          const round = Number(a.monitoring_round) || 1;
          const info = getMonitoringRoundInfo(round);
          const isLast = idx === audits.length - 1;
          const survival: string = a.survival_status ?? 'alive';
          const sc = SURVIVAL_COLORS[survival] ?? SURVIVAL_COLORS.alive;

          return (
            <View key={a.id ?? idx} style={styles.timelineRow}>
              <View style={styles.timelineLeft}>
                <View style={[styles.timelineDot, { backgroundColor: info.color }]} />
                {!isLast && <View style={styles.timelineLine} />}
              </View>

              <View style={styles.timelineBody}>
                <View style={styles.timelineTop}>
                  <View style={[styles.auditRoundChip, { backgroundColor: info.color }]}>
                    <Text style={styles.auditRoundChipText}>Audit {round}</Text>
                  </View>
                  <Text style={styles.timelineDate}>
                    {formatDateFriendly(a.survey_date ?? a.submitted_at)}
                  </Text>
                  {a.survival_status ? (
                    <View style={[styles.survivalMini, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.survivalMiniText, { color: sc.text }]}>
                        {survival.toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Audit Details Box */}
                <View style={styles.pastAuditDetailsBox}>
                  <View style={styles.pastAuditMeasurements}>
                    <Text style={styles.pastAuditMeasureText}>
                      <Text style={{ fontWeight: '800' }}>DBH:</Text> {a.dbh_cm ?? '—'} cm  ·  <Text style={{ fontWeight: '800' }}>H:</Text> {a.height_m ?? '—'} m  ·  <Text style={{ fontWeight: '800' }}>Crown:</Text> {a.crown_diameter_m ?? '—'} m
                    </Text>
                    {a.tree_condition ? (
                      <Text style={styles.pastAuditCondText}>
                        Condition: <Text style={{ fontWeight: '800' }}>{a.tree_condition}</Text>
                      </Text>
                    ) : null}
                    {a.surveyor ? (
                      <Text style={styles.pastAuditSurveyorText}>
                        Surveyor: {a.surveyor}
                      </Text>
                    ) : null}
                    {a.notes ? (
                      <Text style={styles.pastAuditNotesText} numberOfLines={2}>
                        Notes: "{a.notes}"
                      </Text>
                    ) : null}
                  </View>

                  {/* Thumbnail if photo captured */}
                  {a.photo_url ? (
                    <TouchableOpacity onPress={() => setFullscreenPhoto(a.photo_url)} activeOpacity={0.8}>
                      <Image source={{ uri: a.photo_url }} style={styles.pastAuditThumb as any} resizeMode="cover" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* ─── Top Gradient Navigation Header ─── */}
      <LinearGradient colors={['#0f331d', '#1a5c2a', '#286e3a']} style={[styles.header, { paddingTop: 48 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>TREE PROFILE</Text>
          <Text style={styles.headerSubtitle}>{displayId}</Text>
        </View>
        {auditStatus.allCompleted ? (
          <View style={styles.completedHeaderBadge}>
            <Ionicons name="checkmark-done" size={13} color="#fff" />
            <Text style={styles.completedHeaderBadgeText}>4/4 COMPLETE</Text>
          </View>
        ) : tree.locked ? (
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={14} color="#F09125" />
            <Text style={styles.lockBadgeText}>LOCKED</Text>
          </View>
        ) : (
          <View style={styles.headerRight} />
        )}
      </LinearGradient>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ─── 1. AUDIT PROGRESS STEPPER (1 -> 2 -> 3 -> 4) ─── */}
        <View style={styles.stepperCard}>
          <View style={styles.stepperHeader}>
            <View style={styles.stepperTitleWrap}>
              <Ionicons name="git-network-outline" size={15} color="#1a5c2a" />
              <Text style={styles.stepperTitle}>Audit Progress Journey</Text>
            </View>
            <View style={styles.stepperProgressPill}>
              <Text style={styles.stepperCount}>
                {completedRoundsSet.size}/4 Completed
              </Text>
            </View>
          </View>

          <View style={styles.stepperRow}>
            {[1, 2, 3, 4].map((roundNum, idx) => {
              const isDone = completedRoundsSet.has(roundNum);
              const isCurrent = roundNum === auditStatus.currentRound && !auditStatus.allCompleted;

              return (
                <React.Fragment key={roundNum}>
                  <View style={styles.stepNode}>
                    <View
                      style={[
                        styles.stepCircle,
                        isDone && styles.stepCircleDone,
                        isCurrent && styles.stepCircleCurrent,
                        !isDone && !isCurrent && styles.stepCircleLocked,
                      ]}
                    >
                      {isDone ? (
                        <Ionicons name="checkmark" size={14} color="#fff" />
                      ) : isCurrent ? (
                        <Ionicons name="time" size={13} color="#d97706" />
                      ) : (
                        <Ionicons name="lock-closed" size={10} color="#9ca3af" />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.stepLabel,
                        isDone && { color: '#16a34a', fontWeight: '800' },
                        isCurrent && { color: '#d97706', fontWeight: '800' },
                        !isDone && !isCurrent && { color: '#9ca3af' },
                      ]}
                    >
                      Audit {roundNum}
                    </Text>
                    <Text style={styles.stepSub}>
                      {isDone ? 'Done ✓' : isCurrent ? 'Next ⏳' : 'Locked 🔒'}
                    </Text>
                  </View>
                  {idx < 3 && (
                    <View
                      style={[
                        styles.stepLine,
                        completedRoundsSet.has(roundNum + 1)
                          ? { backgroundColor: '#16a34a' }
                          : isDone
                          ? { backgroundColor: '#d97706' }
                          : { backgroundColor: '#e5e7eb' },
                      ]}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </View>
        </View>

        {/* ═════════════════════════════════════════════════════════════════════
            2. CREATIVE HERO PHOTO VIEWER + 3D OVERLAPPING IDENTITY CARD
           ═════════════════════════════════════════════════════════════════════ */}
        <View style={styles.creativeHeroContainer}>
          {/* Main Photo Card Frame */}
          <View style={styles.heroPhotoFrame}>
            {/* Top Floating Glassmorphic Switcher */}
            {hasUpdatedPhoto && (
              <View style={styles.glassSwitcherContainer}>
                <View style={styles.glassSwitcherPill}>
                  <TouchableOpacity
                    style={[styles.glassTab, photoMode === 'latest' && styles.glassTabActive]}
                    onPress={() => setPhotoMode('latest')}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="sparkles"
                      size={12}
                      color={photoMode === 'latest' ? '#fff' : 'rgba(255,255,255,0.7)'}
                    />
                    <Text style={[styles.glassTabText, photoMode === 'latest' && styles.glassTabTextActive]}>
                      Audit {latestAudit?.monitoring_round} (Latest)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.glassTab, photoMode === 'planting' && styles.glassTabActive]}
                    onPress={() => setPhotoMode('planting')}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="leaf"
                      size={12}
                      color={photoMode === 'planting' ? '#fff' : 'rgba(255,255,255,0.7)'}
                    />
                    <Text style={[styles.glassTabText, photoMode === 'planting' && styles.glassTabTextActive]}>
                      Planting
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.glassTab, photoMode === 'both' && styles.glassTabActive]}
                    onPress={() => setPhotoMode('both')}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="git-compare"
                      size={12}
                      color={photoMode === 'both' ? '#fff' : 'rgba(255,255,255,0.7)'}
                    />
                    <Text style={[styles.glassTabText, photoMode === 'both' && styles.glassTabTextActive]}>
                      Compare
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Photo Rendering */}
            {photoMode === 'both' && hasUpdatedPhoto ? (
              <View style={styles.splitCompareFrame}>
                {/* Left: Planting */}
                <View style={styles.splitPhotoCol}>
                  <Image source={{ uri: tree.photo_url }} style={styles.splitImg as any} resizeMode="cover" />
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.splitPhotoGradient}>
                    <View style={styles.splitTag}>
                      <Ionicons name="leaf" size={10} color="#86efac" />
                      <Text style={styles.splitTagText}>Planting Baseline</Text>
                    </View>
                  </LinearGradient>
                </View>

                {/* Center Divider Circle */}
                <View style={styles.splitCenterDivider}>
                  <View style={styles.splitDividerCircle}>
                    <Ionicons name="swap-horizontal" size={14} color="#15803d" />
                  </View>
                </View>

                {/* Right: Latest Audit */}
                <View style={styles.splitPhotoCol}>
                  <Image source={{ uri: latestAudit?.photo_url }} style={styles.splitImg as any} resizeMode="cover" />
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.splitPhotoGradient}>
                    <View style={[styles.splitTag, { backgroundColor: '#15803d' }]}>
                      <Ionicons name="sparkles" size={10} color="#fff" />
                      <Text style={[styles.splitTagText, { color: '#fff' }]}>
                        Audit {latestAudit?.monitoring_round} Update
                      </Text>
                    </View>
                  </LinearGradient>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.heroTouchable}
                activeOpacity={0.95}
                onPress={() => currentPhotoUri && setFullscreenPhoto(currentPhotoUri)}
              >
                {currentPhotoUri ? (
                  <Image source={{ uri: currentPhotoUri }} style={styles.heroImage as any} resizeMode="cover" />
                ) : (
                  <View style={[styles.heroImage, styles.emptyHeroWrap]}>
                    <Text style={{ fontSize: 52 }}>🌳</Text>
                    <Text style={styles.emptyHeroText}>No Photo Recorded</Text>
                  </View>
                )}

                {/* Bottom Cinematic Gradient Overlay */}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.85)']}
                  style={styles.heroBottomGradient}
                >
                  <View style={styles.heroBottomBar}>
                    <View style={styles.heroStatusRibbon}>
                      <View style={[styles.heroStatusDot, isShowingAudit ? styles.dotGreen : styles.dotAmber]} />
                      <Text style={styles.heroStatusLabel}>
                        {isShowingAudit ? `Latest Audit ${latestAudit?.monitoring_round} Photo` : 'Planting Baseline Photo'}
                      </Text>
                      <Text style={styles.heroStatusDate}>
                        · {formatDateFriendly(isShowingAudit ? (latestAudit?.survey_date ?? latestAudit?.submitted_at) : tree.submitted_at)}
                      </Text>
                    </View>

                    <View style={styles.zoomPill}>
                      <Ionicons name="scan-outline" size={14} color="#fff" />
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>

          {/* ─── 3D Overlapping Identity Card ─── */}
          <View style={styles.floatingIdentityCard}>
            {/* Top Badges: Tech ID + Condition + Survival */}
            <View style={styles.identityTopRow}>
              <View style={styles.techIdChip}>
                <Ionicons name="finger-print" size={14} color="#15803d" />
                <Text style={styles.techIdText}>{displayId}</Text>
              </View>

              <View style={styles.identityRightBadges}>
                <View
                  style={[
                    styles.creativeConditionBadge,
                    { backgroundColor: latestConditionColor + '18', borderColor: latestConditionColor },
                  ]}
                >
                  <View style={[styles.conditionPulseDot, { backgroundColor: latestConditionColor }]} />
                  <Text style={[styles.creativeConditionText, { color: latestConditionColor }]}>
                    {latestCondition}
                  </Text>
                </View>

                {latestAudit?.survival_status ? (
                  <View style={[styles.survivalChip, { backgroundColor: survivalConfig.bg }]}>
                    <Ionicons name={survivalConfig.icon as any} size={12} color={survivalConfig.text} />
                    <Text style={[styles.survivalChipText, { color: survivalConfig.text }]}>
                      {latestSurvivalStatus.toUpperCase()}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Species Typography */}
            <View style={styles.speciesNameBlock}>
              <Text style={styles.speciesBigTitle}>{tree.species}</Text>
              {scientificName ? (
                <View style={styles.botanicalRow}>
                  <Ionicons name="leaf-outline" size={13} color="#15803d" />
                  <Text style={styles.botanicalName}>{scientificName}</Text>
                </View>
              ) : null}
            </View>

            {/* Quick-Glance Stat Ribbon */}
            <View style={styles.quickMetricsRibbon}>
              <View style={styles.miniMetricCell}>
                <Text style={styles.miniMetricLabel}>DBH</Text>
                <Text style={styles.miniMetricValue}>
                  {latestDbh ?? '—'} <Text style={styles.miniMetricUnit}>cm</Text>
                </Text>
                {dbhDiff && Number(dbhDiff) !== 0 ? (
                  <Text style={[styles.miniGrowthBadge, Number(dbhDiff) > 0 ? styles.miniGrowthPos : styles.miniGrowthNeu]}>
                    {Number(dbhDiff) > 0 ? `+${dbhDiff}` : dbhDiff}
                  </Text>
                ) : null}
              </View>

              <View style={styles.miniMetricDivider} />

              <View style={styles.miniMetricCell}>
                <Text style={styles.miniMetricLabel}>HEIGHT</Text>
                <Text style={styles.miniMetricValue}>
                  {latestHeight ?? '—'} <Text style={styles.miniMetricUnit}>m</Text>
                </Text>
                {heightDiff && Number(heightDiff) !== 0 ? (
                  <Text style={[styles.miniGrowthBadge, Number(heightDiff) > 0 ? styles.miniGrowthPos : styles.miniGrowthNeu]}>
                    {Number(heightDiff) > 0 ? `+${heightDiff}` : heightDiff}
                  </Text>
                ) : null}
              </View>

              <View style={styles.miniMetricDivider} />

              <View style={styles.miniMetricCell}>
                <Text style={styles.miniMetricLabel}>CROWN</Text>
                <Text style={styles.miniMetricValue}>
                  {latestCrown ?? '—'} <Text style={styles.miniMetricUnit}>m</Text>
                </Text>
                <Text style={styles.miniMetricSub}>width</Text>
              </View>

              <View style={styles.miniMetricDivider} />

              <View style={styles.miniMetricCell}>
                <Text style={styles.miniMetricLabel}>AUDIT</Text>
                <Text style={[styles.miniMetricValue, { color: '#15803d' }]}>
                  {completedRoundsSet.size}/4
                </Text>
                <Text style={styles.miniMetricSub}>rounds</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ═════════════════════════════════════════════════════════════════════
            3. MERGED UNIFIED AUDIT & GROWTH INTELLIGENCE HUB
            (Replaces the 3 disconnected cards with a cohesive, creative hub)
           ═════════════════════════════════════════════════════════════════════ */}
        <View style={styles.hubMasterCard}>
          {/* Hub Header Gradient */}
          <LinearGradient
            colors={['#14532d', '#15803d']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.hubHeaderGradient}
          >
            <View style={styles.hubHeaderLeft}>
              <View style={styles.hubHeaderSparkleWrap}>
                <Ionicons name="sparkles" size={14} color="#86efac" />
              </View>
              <View>
                <Text style={styles.hubHeaderTitle}>
                  {latestAudit ? `Audit ${latestAudit.monitoring_round} · Growth & Vitality` : 'Planting Baseline Active'}
                </Text>
                <Text style={styles.hubHeaderSubtitle}>
                  {latestAudit ? 'Comparative Growth & Lifecycle Audit Hub' : 'Awaiting Audit 1 Field Inspection'}
                </Text>
              </View>
            </View>

            <View style={styles.hubDateChip}>
              <Ionicons name="calendar-outline" size={11} color="#dcfce7" />
              <Text style={styles.hubDateChipText}>
                {latestAudit ? formatDateFriendly(latestAudit.survey_date ?? latestAudit.submitted_at) : 'Baseline'}
              </Text>
            </View>
          </LinearGradient>

          {/* Hub Control Tabs */}
          <View style={styles.hubTabBar}>
            <TouchableOpacity
              style={[styles.hubTabItem, hubTab === 'growth' && styles.hubTabItemActive]}
              onPress={() => setHubTab('growth')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="trending-up"
                size={13}
                color={hubTab === 'growth' ? '#15803d' : '#6b7280'}
              />
              <Text style={[styles.hubTabItemText, hubTab === 'growth' && styles.hubTabItemTextActive]}>
                Growth Delta
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.hubTabItem, hubTab === 'history' && styles.hubTabItemActive]}
              onPress={() => setHubTab('history')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="time-outline"
                size={13}
                color={hubTab === 'history' ? '#15803d' : '#6b7280'}
              />
              <Text style={[styles.hubTabItemText, hubTab === 'history' && styles.hubTabItemTextActive]}>
                History ({audits.length}/4)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.hubTabItem, hubTab === 'baseline' && styles.hubTabItemActive]}
              onPress={() => setHubTab('baseline')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="leaf-outline"
                size={13}
                color={hubTab === 'baseline' ? '#15803d' : '#6b7280'}
              />
              <Text style={[styles.hubTabItemText, hubTab === 'baseline' && styles.hubTabItemTextActive]}>
                Planting Specs
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.hubBodyContent}>
            {/* ── TAB 1: GROWTH COMPARISON (MERGES UPDATED DATA + BASELINE) ── */}
            {hubTab === 'growth' && (
              <>
                {/* Vitality Status Row */}
                {latestAudit ? (
                  <View style={styles.hubVitalityBanner}>
                    <View style={styles.hubVitalityPills}>
                      <View style={[styles.hubSurvivalBadge, { backgroundColor: survivalConfig.bg }]}>
                        <Ionicons name={survivalConfig.icon as any} size={14} color={survivalConfig.text} />
                        <Text style={[styles.hubSurvivalBadgeText, { color: survivalConfig.text }]}>
                          STATUS: {latestSurvivalStatus.toUpperCase()}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.hubConditionBadge,
                          { backgroundColor: latestConditionColor + '18', borderColor: latestConditionColor },
                        ]}
                      >
                        <View style={[styles.hubConditionPulse, { backgroundColor: latestConditionColor }]} />
                        <Text style={[styles.hubConditionBadgeText, { color: latestConditionColor }]}>
                          Condition: {latestCondition}
                        </Text>
                      </View>
                    </View>

                    {latestAudit.surveyor ? (
                      <View style={styles.hubAuditorPill}>
                        <Ionicons name="person-circle-outline" size={14} color="#15803d" />
                        <Text style={styles.hubAuditorText}>
                          Audited by <Text style={{ fontWeight: '800' }}>{latestAudit.surveyor}</Text>
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.noAuditPromptBox}>
                    <Ionicons name="leaf-outline" size={24} color="#15803d" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.noAuditPromptTitle}>Ready for Audit 1</Text>
                      <Text style={styles.noAuditPromptSub}>
                        Baseline measurements recorded. Perform Audit 1 to start monitoring growth trends.
                      </Text>
                    </View>
                  </View>
                )}

                {/* ── Direct Comparative Growth Cards ── */}
                <View style={styles.compMatrixWrap}>
                  {/* DBH Trunk Diameter */}
                  <View style={styles.compCard}>
                    <View style={styles.compCardHeader}>
                      <View style={styles.compIconCircle}>
                        <Ionicons name="git-commit" size={13} color="#15803d" />
                      </View>
                      <Text style={styles.compCardTitle}>TRUNK DIAMETER (DBH)</Text>
                      {dbhDiff !== null && (
                        <View
                          style={[
                            styles.compDeltaBadge,
                            parseFloat(dbhDiff) > 0
                              ? styles.compDeltaPositive
                              : parseFloat(dbhDiff) === 0
                              ? styles.compDeltaNeutral
                              : styles.compDeltaNegative,
                          ]}
                        >
                          <Text
                            style={[
                              styles.compDeltaText,
                              parseFloat(dbhDiff) > 0
                                ? styles.compDeltaTextPositive
                                : parseFloat(dbhDiff) === 0
                                ? styles.compDeltaTextNeutral
                                : styles.compDeltaTextNegative,
                            ]}
                          >
                            {parseFloat(dbhDiff) > 0 ? `▲ +${dbhDiff} cm` : parseFloat(dbhDiff) === 0 ? `▬ 0.0 cm` : `▼ ${dbhDiff} cm`}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.compTrackRow}>
                      <View style={styles.compTrackCell}>
                        <Text style={styles.compTrackLabel}>PLANTING BASELINE</Text>
                        <Text style={styles.compTrackVal}>
                          {dbhCm ?? '—'} <Text style={styles.compTrackUnit}>cm</Text>
                        </Text>
                      </View>

                      <View style={styles.compTrackArrowWrap}>
                        <Ionicons name="arrow-forward" size={16} color="#16a34a" />
                      </View>

                      <View style={[styles.compTrackCell, styles.compTrackCellActive]}>
                        <Text style={styles.compTrackLabelActive}>
                          LATEST {latestAudit ? `(A${latestAudit.monitoring_round})` : ''}
                        </Text>
                        <Text style={styles.compTrackValActive}>
                          {latestDbh ?? '—'} <Text style={styles.compTrackUnit}>cm</Text>
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Vertical Height */}
                  <View style={styles.compCard}>
                    <View style={styles.compCardHeader}>
                      <View style={styles.compIconCircle}>
                        <Ionicons name="trending-up" size={13} color="#15803d" />
                      </View>
                      <Text style={styles.compCardTitle}>VERTICAL HEIGHT</Text>
                      {heightDiff !== null && (
                        <View
                          style={[
                            styles.compDeltaBadge,
                            parseFloat(heightDiff) > 0
                              ? styles.compDeltaPositive
                              : parseFloat(heightDiff) === 0
                              ? styles.compDeltaNeutral
                              : styles.compDeltaNegative,
                          ]}
                        >
                          <Text
                            style={[
                              styles.compDeltaText,
                              parseFloat(heightDiff) > 0
                                ? styles.compDeltaTextPositive
                                : parseFloat(heightDiff) === 0
                                ? styles.compDeltaTextNeutral
                                : styles.compDeltaTextNegative,
                            ]}
                          >
                            {parseFloat(heightDiff) > 0 ? `▲ +${heightDiff} m` : parseFloat(heightDiff) === 0 ? `▬ 0.0 m` : `▼ ${heightDiff} m`}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.compTrackRow}>
                      <View style={styles.compTrackCell}>
                        <Text style={styles.compTrackLabel}>PLANTING BASELINE</Text>
                        <Text style={styles.compTrackVal}>
                          {heightM ?? '—'} <Text style={styles.compTrackUnit}>m</Text>
                        </Text>
                      </View>

                      <View style={styles.compTrackArrowWrap}>
                        <Ionicons name="arrow-forward" size={16} color="#16a34a" />
                      </View>

                      <View style={[styles.compTrackCell, styles.compTrackCellActive]}>
                        <Text style={styles.compTrackLabelActive}>
                          LATEST {latestAudit ? `(A${latestAudit.monitoring_round})` : ''}
                        </Text>
                        <Text style={styles.compTrackValActive}>
                          {latestHeight ?? '—'} <Text style={styles.compTrackUnit}>m</Text>
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Dual Grid: Canopy Crown & Wood Density */}
                  <View style={styles.compDualRow}>
                    {/* Crown Spread */}
                    <View style={[styles.compCard, { flex: 1 }]}>
                      <View style={styles.compCardHeader}>
                        <View style={styles.compIconCircle}>
                          <Ionicons name="aperture" size={13} color="#15803d" />
                        </View>
                        <Text style={styles.compCardTitle} numberOfLines={1}>CROWN</Text>
                      </View>
                      <View style={styles.compMiniTrack}>
                        <View>
                          <Text style={styles.compMiniSub}>Planting: {crownDiam ? `${crownDiam}m` : '—'}</Text>
                          <Text style={styles.compMiniMain}>
                            {latestCrown ?? '—'} <Text style={styles.compTrackUnit}>m</Text>
                          </Text>
                        </View>
                        <View style={styles.crownTagPill}>
                          <Text style={styles.crownTagText}>Spread</Text>
                        </View>
                      </View>
                    </View>

                    {/* Density & Structure */}
                    <View style={[styles.compCard, { flex: 1 }]}>
                      <View style={styles.compCardHeader}>
                        <View style={styles.compIconCircle}>
                          <Ionicons name="barbell-outline" size={13} color="#15803d" />
                        </View>
                        <Text style={styles.compCardTitle} numberOfLines={1}>DENSITY</Text>
                      </View>
                      <View style={styles.compMiniTrack}>
                        <View>
                          <Text style={styles.compMiniSub}>Baseline Spec</Text>
                          <Text style={styles.compMiniMain}>
                            {woodDensity ?? '—'} <Text style={styles.compTrackUnit}>g/cm³</Text>
                          </Text>
                        </View>
                        <View style={styles.crownTagPill}>
                          <Text style={styles.crownTagText}>{multiStem || 'Single'}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Auditor Field Note Quote Box */}
                {latestAudit?.notes ? (
                  <View style={styles.hubFieldQuoteBox}>
                    <View style={styles.hubFieldQuoteTop}>
                      <Ionicons name="chatbubble-ellipses" size={14} color="#15803d" />
                      <Text style={styles.hubFieldQuoteLabel}>AUDITOR FIELD NOTE</Text>
                    </View>
                    <Text style={styles.hubFieldQuoteText}>"{latestAudit.notes}"</Text>
                    <Text style={styles.hubFieldQuoteAuthor}>
                      — {latestAudit.surveyor || 'Verified Field Auditor'}
                    </Text>
                  </View>
                ) : null}

                {/* Expandable Past Audits Drawer */}
                {audits.length > 0 && (
                  <TouchableOpacity
                    style={styles.hubDrawerTrigger}
                    onPress={() => setHistoryExpanded(!historyExpanded)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.hubDrawerLeft}>
                      <Ionicons name="time" size={16} color="#15803d" />
                      <Text style={styles.hubDrawerTitle}>Past All Audit Details</Text>
                      <View style={styles.hubDrawerCountBadge}>
                        <Text style={styles.hubDrawerCountText}>
                          {audits.length} of 4 Recorded
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name={historyExpanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color="#15803d"
                    />
                  </TouchableOpacity>
                )}

                {/* Inlined timeline if drawer open */}
                {historyExpanded && audits.length > 0 && (
                  <View style={styles.hubDrawerTimelineWrap}>
                    {renderAuditTimeline()}
                  </View>
                )}
              </>
            )}

            {/* ── TAB 2: AUDIT HISTORY TIMELINE ── */}
            {hubTab === 'history' && (
              <View style={styles.hubTimelineFullWrap}>
                <View style={styles.hubTimelineFullHeader}>
                  <Text style={styles.hubTimelineFullTitle}>All Recorded Monitoring Audits</Text>
                  <View style={styles.hubTimelineFullPill}>
                    <Text style={styles.hubTimelineFullPillText}>{audits.length} of 4 Recorded</Text>
                  </View>
                </View>
                {renderAuditTimeline()}
              </View>
            )}

            {/* ── TAB 3: PLANTING BASELINE SPECS ── */}
            {hubTab === 'baseline' && (
              <View style={styles.hubBaselineWrap}>
                <View style={styles.hubBaselineHeader}>
                  <Ionicons name="leaf" size={16} color="#15803d" />
                  <Text style={styles.hubBaselineTitle}>Original Planting Baseline Profile</Text>
                </View>

                <View style={styles.hubBaselineGrid}>
                  <View style={styles.hubBaselineCell}>
                    <Text style={styles.hubBaselineCellVal}>{dbhCm ?? '—'} cm</Text>
                    <Text style={styles.hubBaselineCellLabel}>Initial DBH</Text>
                  </View>
                  <View style={styles.hubBaselineCell}>
                    <Text style={styles.hubBaselineCellVal}>{heightM ?? '—'} m</Text>
                    <Text style={styles.hubBaselineCellLabel}>Initial Height</Text>
                  </View>
                  <View style={styles.hubBaselineCell}>
                    <Text style={styles.hubBaselineCellVal}>{crownDiam ?? '—'} m</Text>
                    <Text style={styles.hubBaselineCellLabel}>Initial Crown</Text>
                  </View>
                  <View style={styles.hubBaselineCell}>
                    <Text style={styles.hubBaselineCellVal}>{woodDensity ?? '—'}</Text>
                    <Text style={styles.hubBaselineCellLabel}>Density</Text>
                  </View>
                </View>

                <View style={styles.hubBaselineDetailsCard}>
                  <HalfDetailRow label="Multi-Stem Form" value={multiStem ?? 'Single stem'} />
                  <HalfDetailRow label="Tree Age at Planting" value={ageYears ? `${ageYears} years` : '—'} />
                  <HalfDetailRow label="Land / Soil Type" value={landType ?? '—'} />
                  <HalfDetailRow label="Planting Event" value={eventType ?? '—'} />
                  <HalfDetailRow label="Batch Quantity" value={quantity ? String(quantity) : '1'} />
                  <HalfDetailRow label="Original Planting Surveyor" value={surveyor ?? '—'} />
                  <HalfDetailRow label="Planting Survey Date" value={surveyDate ? formatDateFriendly(surveyDate) : date} />
                </View>
              </View>
            )}
          </View>
        </View>

        {/* ─── 4. PROJECT & HISTORY ─── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="folder" size={16} color="#1a5c2a" />
            <Text style={styles.cardTitle}>Project & History</Text>
          </View>
          <DetailRow icon="folder-outline" label="Project" value={tree.project_name ?? 'No project'} />
          <DetailRow icon="calendar" label="Planting Submitted" value={date} />
          {cleanNotes ? <DetailRow icon="document-text" label="Planting Notes" value={cleanNotes} /> : null}
        </View>

        {/* ─── 5. LOCATION CARD ─── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="location" size={16} color="#1a5c2a" />
            <Text style={styles.cardTitle}>Location</Text>
          </View>
          <MapPreview
            coords={{ latitude: Number(tree.latitude) || 0, longitude: Number(tree.longitude) || 0 }}
            height={170}
          />
          <TouchableOpacity
            style={styles.mapsBtn}
            onPress={() => navigation.getParent()?.getParent()?.navigate('Map', { focusTreeId: tree.id })}
          >
            <Ionicons name="map" size={16} color="#fff" />
            <Text style={styles.mapsBtnText}>View on Map</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mapsBtnOutline} onPress={openInMaps}>
            <Ionicons name="open-outline" size={16} color="#1a5c2a" />
            <Text style={styles.mapsBtnOutlineText}>Open in Browser</Text>
          </TouchableOpacity>
          <View style={styles.coordsRow}>
            <View style={styles.coordCell}>
              <Text style={styles.coordLabel}>LAT</Text>
              <Text style={styles.coordValue}>{Number(tree.latitude ?? 0).toFixed(6)}</Text>
            </View>
            <View style={styles.coordCell}>
              <Text style={styles.coordLabel}>LONG</Text>
              <Text style={styles.coordValue}>{Number(tree.longitude ?? 0).toFixed(6)}</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ─── FULLSCREEN PHOTO MODAL ─── */}
      <Modal visible={Boolean(fullscreenPhoto)} transparent animationType="fade" onRequestClose={() => setFullscreenPhoto(null)}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setFullscreenPhoto(null)}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          {fullscreenPhoto ? (
            <Image source={{ uri: fullscreenPhoto }} style={styles.modalImg as any} resizeMode="contain" />
          ) : null}
        </View>
      </Modal>

      {/* ─── FLOATING ACTION BUTTON (NO REPEATS, ADVANCES 1 -> 2 -> 3 -> 4) ─── */}
      {auditStatus.allCompleted ? (
        <View style={styles.allCompletedFab}>
          <LinearGradient
            colors={['#166534', '#15803d']}
            style={styles.auditFabGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="checkmark-done-circle" size={22} color="#fff" />
            <Text style={styles.auditFabText}>All 4 Audits Completed ✓</Text>
          </LinearGradient>
        </View>
      ) : !tree.locked ? (
        <TouchableOpacity
          style={styles.auditFab}
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate('UpdateTree', {
              treeId: tree.id,
              treeIdDisplay: liveTreeId,
              currentRound: auditStatus.currentRound,
            })
          }
        >
          <LinearGradient
            colors={['#1a5c2a', '#2e7d43']}
            style={styles.auditFabGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="clipboard-outline" size={20} color="#fff" />
            <Text style={styles.auditFabText}>
              {audits.length === 0 ? 'Start Audit 1' : `Start Audit ${auditStatus.currentRound}`}
            </Text>
            {auditStatus.isDue && (
              <View style={styles.auditFabDueBadge}>
                <Text style={styles.auditFabDueBadgeText}>
                  {auditStatus.isOverdue ? 'OVERDUE' : 'DUE'}
                </Text>
              </View>
            )}
          </LinearGradient>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={detailStyles.row}>
      <Ionicons name={icon as any} size={14} color="#1a5c2a" style={detailStyles.icon} />
      <View style={detailStyles.textGroup}>
        <Text style={detailStyles.label}>{label}</Text>
        <Text style={detailStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

function HalfDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={halfDetailStyles.row}>
      <Text style={halfDetailStyles.label}>{label}</Text>
      <Text style={halfDetailStyles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#e8efe8', gap: 10 },
  icon: { marginTop: 2 },
  textGroup: { flex: 1 },
  label: { fontSize: 11, color: '#888', marginBottom: 2 },
  value: { fontSize: 13, color: '#222', fontWeight: '800' },
});

const halfDetailStyles = StyleSheet.create({
  row: { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#e8efe8' },
  label: { fontSize: 9, color: '#888', marginBottom: 2 },
  value: { fontSize: 12, color: '#222', fontWeight: '800' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: '#888' },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 16, paddingHorizontal: 18 },
  backBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '800', textTransform: 'uppercase' },
  headerSubtitle: { color: '#cde8d3', fontSize: 11, marginTop: 3 },
  headerRight: { width: 42 },
  completedHeaderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(22,163,74,0.4)', borderWidth: 1, borderColor: '#4ade80', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  completedHeaderBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  lockBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(240,145,37,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  lockBadgeText: { color: '#F09125', fontSize: 10, fontWeight: '800' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 20 },

  // Stepper Card
  stepperCard: { backgroundColor: '#fff', borderRadius: 18, padding: 14, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  stepperHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  stepperTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperTitle: { fontSize: 13, fontWeight: '800', color: '#1a5c2a' },
  stepperProgressPill: { backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  stepperCount: { fontSize: 11, fontWeight: '800', color: '#15803d' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  stepNode: { alignItems: 'center', width: 56 },
  stepCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepCircleDone: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  stepCircleCurrent: { backgroundColor: '#fef3c7', borderColor: '#d97706', borderWidth: 2 },
  stepCircleLocked: { backgroundColor: '#f3f4f6', borderColor: '#d1d5db', borderWidth: 1 },
  stepLabel: { fontSize: 10, marginTop: 4 },
  stepSub: { fontSize: 8, color: '#9ca3af', marginTop: 1 },
  stepLine: { flex: 1, height: 3, marginBottom: 14 },

  // ═════════════════════════════════════════════════════════════════════
  // CREATIVE HERO CONTAINER
  // ═════════════════════════════════════════════════════════════════════
  creativeHeroContainer: {
    marginBottom: 4,
  },
  heroPhotoFrame: {
    backgroundColor: '#0a1d12',
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    position: 'relative',
  },
  glassSwitcherContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 10,
  },
  glassSwitcherPill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(10, 29, 18, 0.65)',
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  glassTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 12,
  },
  glassTabActive: {
    backgroundColor: '#16a34a',
  },
  glassTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.75)',
  },
  glassTabTextActive: {
    color: '#fff',
    fontWeight: '800',
  },

  heroTouchable: {
    width: '100%',
    height: 270,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: 270,
    backgroundColor: '#1c3a26',
  },
  emptyHeroWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5e9',
  },
  emptyHeroText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1a5c2a',
    marginTop: 6,
  },
  heroBottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 90,
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
    paddingBottom: 28,
  },
  heroBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroStatusRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(10, 29, 18, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  heroStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: '#4ade80',
  },
  dotAmber: {
    backgroundColor: '#fbbf24',
  },
  heroStatusLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  heroStatusDate: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 10,
    fontWeight: '600',
  },
  zoomPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(10, 29, 18, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },

  // Split comparison view
  splitCompareFrame: {
    flexDirection: 'row',
    height: 270,
    position: 'relative',
    paddingTop: 52,
    paddingBottom: 24,
    paddingHorizontal: 8,
    gap: 8,
  },
  splitPhotoCol: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  splitImg: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1b3b28',
  },
  splitPhotoGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 48,
    justifyContent: 'flex-end',
    padding: 6,
  },
  splitTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  splitTagText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  splitCenterDivider: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -16 }, { translateY: -4 }],
    zIndex: 10,
  },
  splitDividerCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    borderWidth: 1.5,
    borderColor: '#15803d',
  },

  // 3D Overlapping Identity Card
  floatingIdentityCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    marginTop: -22,
    marginHorizontal: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    elevation: 6,
    shadowColor: '#0f331d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: '#e2ece4',
  },
  identityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  techIdChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  techIdText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803d',
    letterSpacing: 0.5,
  },
  identityRightBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  creativeConditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  conditionPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  creativeConditionText: {
    fontSize: 11,
    fontWeight: '800',
  },
  survivalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  survivalChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  speciesNameBlock: {
    marginBottom: 12,
  },
  speciesBigTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -0.3,
  },
  botanicalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  botanicalName: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#15803d',
    fontWeight: '600',
  },
  quickMetricsRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8faf9',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#e8efe8',
  },
  miniMetricCell: {
    flex: 1,
    alignItems: 'center',
  },
  miniMetricLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  miniMetricValue: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111827',
  },
  miniMetricUnit: {
    fontSize: 9,
    fontWeight: '600',
    color: '#6b7280',
  },
  miniMetricSub: {
    fontSize: 8,
    color: '#9ca3af',
  },
  miniMetricDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#e5e7eb',
  },
  miniGrowthBadge: {
    fontSize: 8,
    fontWeight: '800',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
    marginTop: 1,
  },
  miniGrowthPos: {
    color: '#15803d',
    backgroundColor: '#dcfce7',
  },
  miniGrowthNeu: {
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
  },

  // ═════════════════════════════════════════════════════════════════════
  // MERGED UNIFIED AUDIT & GROWTH INTELLIGENCE HUB
  // ═════════════════════════════════════════════════════════════════════
  hubMasterCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  hubHeaderGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  hubHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hubHeaderSparkleWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubHeaderTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },
  hubHeaderSubtitle: {
    fontSize: 10,
    color: '#bbf7d0',
    marginTop: 1,
  },
  hubDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  hubDateChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#dcfce7',
  },
  hubTabBar: {
    flexDirection: 'row',
    backgroundColor: '#f0fdf4',
    borderBottomWidth: 1,
    borderBottomColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  hubTabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  hubTabItemActive: {
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  hubTabItemText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
  },
  hubTabItemTextActive: {
    color: '#15803d',
    fontWeight: '800',
  },
  hubBodyContent: {
    padding: 14,
    gap: 12,
  },

  // Vitality & health row
  hubVitalityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f4f1',
    flexWrap: 'wrap',
    gap: 8,
  },
  hubVitalityPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hubSurvivalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
  },
  hubSurvivalBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  hubConditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  hubConditionPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  hubConditionBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  hubAuditorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f8faf9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  hubAuditorText: {
    fontSize: 10,
    color: '#555',
  },
  noAuditPromptBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f0fdf4',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  noAuditPromptTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803d',
  },
  noAuditPromptSub: {
    fontSize: 10,
    color: '#4b5563',
    marginTop: 2,
  },

  // Comparative Matrix
  compMatrixWrap: {
    gap: 10,
  },
  compCard: {
    backgroundColor: '#fbfdfc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e8efe8',
  },
  compCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  compIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  compCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#374151',
    flex: 1,
    letterSpacing: 0.3,
  },
  compDeltaBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  compDeltaPositive: {
    backgroundColor: '#dcfce7',
  },
  compDeltaNeutral: {
    backgroundColor: '#f3f4f6',
  },
  compDeltaNegative: {
    backgroundColor: '#fee2e2',
  },
  compDeltaText: {
    fontSize: 10,
    fontWeight: '800',
  },
  compDeltaTextPositive: {
    color: '#15803d',
  },
  compDeltaTextNeutral: {
    color: '#6b7280',
  },
  compDeltaTextNegative: {
    color: '#dc2626',
  },
  compTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compTrackCell: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  compTrackCellActive: {
    backgroundColor: '#e8f5e9',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  compTrackLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  compTrackLabelActive: {
    fontSize: 8,
    fontWeight: '800',
    color: '#15803d',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  compTrackVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1f2937',
  },
  compTrackValActive: {
    fontSize: 16,
    fontWeight: '900',
    color: '#15803d',
  },
  compTrackUnit: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6b7280',
  },
  compTrackArrowWrap: {
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Dual Row
  compDualRow: {
    flexDirection: 'row',
    gap: 10,
  },
  compMiniTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  compMiniSub: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 2,
  },
  compMiniMain: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
  },
  crownTagPill: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  crownTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#15803d',
  },

  // Auditor Field Notes Box
  hubFieldQuoteBox: {
    backgroundColor: '#f8faf9',
    borderRadius: 12,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#16a34a',
    gap: 4,
  },
  hubFieldQuoteTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hubFieldQuoteLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#15803d',
    letterSpacing: 0.5,
  },
  hubFieldQuoteText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#374151',
    lineHeight: 17,
  },
  hubFieldQuoteAuthor: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6b7280',
    alignSelf: 'flex-end',
  },

  // Hub Drawer Trigger
  hubDrawerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dcfce7',
    marginTop: 2,
  },
  hubDrawerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hubDrawerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803d',
  },
  hubDrawerCountBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  hubDrawerCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803d',
  },
  hubDrawerTimelineWrap: {
    paddingTop: 8,
  },

  // History Tab Full
  hubTimelineFullWrap: {
    gap: 10,
  },
  hubTimelineFullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e8efe8',
  },
  hubTimelineFullTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803d',
  },
  hubTimelineFullPill: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  hubTimelineFullPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803d',
  },

  // Baseline Tab Full
  hubBaselineWrap: {
    gap: 12,
  },
  hubBaselineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hubBaselineTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803d',
  },
  hubBaselineGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  hubBaselineCell: {
    flex: 1,
    backgroundColor: '#f8faf9',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8efe8',
  },
  hubBaselineCellVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  hubBaselineCellLabel: {
    fontSize: 8,
    color: '#6b7280',
    marginTop: 2,
    textAlign: 'center',
  },
  hubBaselineDetailsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#e8efe8',
  },

  // Past Audit Timeline
  timeline: { paddingLeft: 6, paddingTop: 4 },
  timelineRow: { flexDirection: 'row', marginBottom: 12 },
  timelineLeft: { width: 22, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  timelineLine: { width: 2, flex: 1, backgroundColor: '#e5e7eb', marginTop: 4 },
  timelineBody: { flex: 1, paddingLeft: 8 },
  timelineTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 },
  auditRoundChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  auditRoundChipText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  timelineDate: { fontSize: 11, color: '#6b7280', fontWeight: '600' },
  survivalMini: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  survivalMiniText: { fontSize: 9, fontWeight: '800' },
  pastAuditDetailsBox: {
    flexDirection: 'row',
    backgroundColor: '#f8faf9',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e8efe8',
    gap: 8,
  },
  pastAuditMeasurements: { flex: 1, gap: 2 },
  pastAuditMeasureText: { fontSize: 11, color: '#374151' },
  pastAuditCondText: { fontSize: 10, color: '#6b7280' },
  pastAuditSurveyorText: { fontSize: 10, color: '#6b7280' },
  pastAuditNotesText: { fontSize: 10, color: '#4b5563', fontStyle: 'italic' },
  pastAuditThumb: { width: 54, height: 54, borderRadius: 8, backgroundColor: '#e5e7eb' },
  emptyHistoryBox: { alignItems: 'center', padding: 20, gap: 6 },
  emptyHistoryText: { fontSize: 12, color: '#9ca3af' },

  // Cards
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#1a5c2a' },

  // Location
  mapsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a5c2a', paddingVertical: 11, borderRadius: 12, marginTop: 10 },
  mapsBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  mapsBtnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#f0f7f2', paddingVertical: 10, borderRadius: 12, marginTop: 6, borderWidth: 1, borderColor: '#cde8d3' },
  mapsBtnOutlineText: { color: '#1a5c2a', fontSize: 12, fontWeight: '800' },
  coordsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  coordCell: { flex: 1, backgroundColor: '#f5faf6', padding: 8, borderRadius: 8, alignItems: 'center' },
  coordLabel: { fontSize: 9, color: '#888', fontWeight: '800', letterSpacing: 0.5 },
  coordValue: { fontSize: 12, color: '#1a5c2a', fontWeight: '800', marginTop: 2 },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  modalCloseBtn: { position: 'absolute', top: 50, right: 20, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  modalImg: { width: '92%', height: '80%' },

  // FAB
  auditFab: { position: 'absolute', bottom: 20, left: 16, right: 16, borderRadius: 16, elevation: 6, shadowColor: '#1a5c2a', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  allCompletedFab: { position: 'absolute', bottom: 20, left: 16, right: 16, borderRadius: 16, elevation: 4 },
  auditFabGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: 16 },
  auditFabText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  auditFabDueBadge: { backgroundColor: '#ef4444', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginLeft: 4 },
  auditFabDueBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
});
