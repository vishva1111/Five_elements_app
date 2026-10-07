import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  Alert,
  Dimensions,
} from 'react-native';
import { useRoute, useNavigation, useFocusEffect, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HistoryStackParamList, TreeRecord, getMonitoringRoundInfo, getSpeciesDefault, Task } from '../../types';
import { fetchTreeById, ensureProjectTreeId, fetchTreeMonitoringRecords } from '../../services/treeService';
import { supabase } from '../../services/supabase';
import {
  getAuditStatus,
  getDueLabel,
  formatDateFriendly,
  getLatestAudit,
} from '../../services/auditService';
import { displayTreeId, parseTreeMeta, stripTreeMeta, resolveTreeId } from '../../utils/treeId';
import MapPreview from '../../components/MapPreview';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_PAGE_W = SCREEN_WIDTH - 28; // 14px padding on each side
const PHOTO_ANGLES = [
  { label: 'Front View', short: 'Front', icon: 'leaf' },
  { label: 'Side View', short: 'Side', icon: 'git-network-outline' },
  { label: 'Close-up', short: 'Close-up', icon: 'scan-outline' },
];

type Route = RouteProp<HistoryStackParamList, 'TreeDetail'>;
type Nav = NativeStackNavigationProp<HistoryStackParamList, 'TreeDetail'>;

export default function TreeDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { treeId, asAuditProfile, rejectionNotes } = route.params;

  const [tree, setTree] = useState<TreeRecord | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [audits, setAudits] = useState<any[]>([]);

  // Simple Photo Mode: 'audit' (Now) or 'planting'
  const [photoView, setPhotoView] = useState<'audit' | 'planting'>('audit');
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  // Selected audit round for interactive journey inspection
  const [selectedAuditRound, setSelectedAuditRound] = useState<number | null>(null);

  // Planting details stay closed until the header is tapped.
  const [baselineExpanded, setBaselineExpanded] = useState(false);

  // Active photo index within the sliding photo pager
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const photoScrollRef = useRef<ScrollView>(null);

  // ── Multi-photo support ────────────────────────────────────────────────────
  // Derived BEFORE the loading / not-found early returns below. Hooks must run
  // in the same order on every render, so the effects that follow must never be
  // skipped on the first (loading) render — otherwise React throws
  // "Rendered more hooks than during the previous render".
  const latestAudit = getLatestAudit(audits);

  // Planting photos: photo_urls first, then the ##META## copy inside notes
  // (records saved before the photo_urls column existed), then photo_url.
  const metaPhotoUrls: unknown = tree ? parseTreeMeta(tree.notes)?.photo_urls : null;
  const taskPhotoUrls: unknown = task ? parseTreeMeta(task.notes)?.photo_urls : null;
  const plantingPhotos: string[] = !tree
    ? []
    : Array.isArray(metaPhotoUrls) && metaPhotoUrls.length > 0
    ? metaPhotoUrls.filter((u: unknown): u is string => typeof u === 'string' && !!u)
    : tree.photo_urls && tree.photo_urls.length > 0
    ? tree.photo_urls
    : Array.isArray(taskPhotoUrls) && taskPhotoUrls.length > 0
    ? taskPhotoUrls.filter((u: unknown): u is string => typeof u === 'string' && !!u)
    : tree.photo_url
    ? [tree.photo_url]
    : task?.photo_url
    ? [task.photo_url]
    : [];

  // Audit photos for the currently selected/latest audit
  const activeInspectorAudit =
    selectedAuditRound !== null
      ? audits.find((a) => Number(a.monitoring_round) === selectedAuditRound) ?? latestAudit
      : latestAudit;

  const photosFromAudit = (audit: any): string[] => {
    if (!audit) return [];
    const raw = Array.isArray(audit.photo_urls) && audit.photo_urls.length > 0
      ? audit.photo_urls
      : audit.photo_url
      ? [audit.photo_url]
      : [];
    // Each visit stores the three sides only: Front, Side, Close-up.
    return raw
      .filter((uri: unknown): uri is string => typeof uri === 'string' && !!uri)
      .slice(0, PHOTO_ANGLES.length);
  };

  // One tab per completed audit, newest first (Audit 2, Audit 1, …), then Planting.
  const completedAuditSets = (() => {
    const byRound = new Map<number, string[]>();
    for (const audit of audits) {
      const round = Number(audit?.monitoring_round) || 0;
      const photos = photosFromAudit(audit);
      if (round > 0 && photos.length > 0) byRound.set(round, photos);
    }
    return [...byRound.entries()]
      .map(([round, photos]) => ({ round, photos }))
      .sort((a, b) => b.round - a.round);
  })();

  const hasAuditPhoto = completedAuditSets.length > 0;
  const plantingAnglePhotos = plantingPhotos.slice(0, PHOTO_ANGLES.length);
  const selectedAuditSet =
    completedAuditSets.find((set) => set.round === Number(activeInspectorAudit?.monitoring_round))
    ?? completedAuditSets[0];

  // The open tab shows only that visit's three sides — never every audit stacked together.
  const displayedPhotos: string[] =
    photoView === 'planting' || !hasAuditPhoto
      ? plantingAnglePhotos
      : (selectedAuditSet?.photos ?? plantingAnglePhotos);

  // Keep the sliding pager in step with the photo set it is showing. Switching
  // the Audit/Planting set or inspecting another audit round swaps the array,
  // so the counter and the scroll offset must go back to the first photo
  // instead of pointing at an index that no longer exists.
  useEffect(() => {
    setActivePhotoIdx(0);
    photoScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [photoView, selectedAuditRound]);

  // Data reloads can shrink the set (3 photos -> 1). Clamp so the N/3 counter
  // and the highlighted angle tab can never fall outside the array.
  useEffect(() => {
    const maxIdx = Math.max(0, displayedPhotos.length - 1);
    setActivePhotoIdx((idx) => (idx > maxIdx ? maxIdx : idx));
  }, [displayedPhotos.length]);

  const loadTreeData = useCallback(async () => {
    try {
      const { data } = await fetchTreeById(treeId);

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

        // Auto-select latest audit round for inspector
        if (sorted.length > 0 && selectedAuditRound === null) {
          const lastRound = Number(sorted[sorted.length - 1]?.monitoring_round) || 1;
          setSelectedAuditRound(lastRound);
        }
      } catch (auditErr) {
        console.warn('[TreeApp] fetch audits failed:', auditErr);
      }

      // A tree can have a planting task and an audit task. A rejected audit
      // must win, or the profile keeps showing the next "Start Audit" button.
      try {
        const taskFilters = [
          `tree_id.eq.${data.id},tree_record_id.eq.${data.id},id.eq.${data.id}`,
          `tree_id.eq.${data.id},id.eq.${data.id}`,
        ];
        let taskRows: any[] = [];
        for (const filter of taskFilters) {
          const res = await supabase.from('tasks').select('*').or(filter).limit(20);
          if (!res.error) {
            taskRows = res.data ?? [];
            break;
          }
        }
        const isAuditRow = (row: any) =>
          row?.task_type === 'audit' || Number(row?.audit_round) > 0;
        const isOpen = (row: any) =>
          row?.status === 'assigned' || row?.status === 'in_progress';
        const rejectedAuditTask = taskRows
          .filter((row) => row?.status === 'rejected' && isAuditRow(row))
          .sort((a, b) => Number(b?.audit_round || 0) - Number(a?.audit_round || 0))[0];
        const openAuditTask = taskRows
          .filter((row) => isOpen(row) && isAuditRow(row))
          .sort((a, b) => Number(b?.audit_round || 0) - Number(a?.audit_round || 0))[0];
        // An open or rejected audit task must win over an older planting task,
        // or Start Audit opens the wrong form and the assigned card never moves.
        const linkedTask =
          (asAuditProfile ? rejectedAuditTask || openAuditTask : null) ||
          rejectedAuditTask ||
          openAuditTask ||
          taskRows.find((row) => row?.status === 'rejected') ||
          taskRows.find((row) => row?.id === data.id) ||
          taskRows[0];
        if (linkedTask) setTask(linkedTask);
      } catch (taskErr) {
        console.warn('[TreeApp] fetch linked task failed:', taskErr);
      }
    } catch (err) {
      console.warn('[TreeApp] fetchTreeById failed:', err);
      setLoading(false);
    }
  }, [treeId, selectedAuditRound]);

  useFocusEffect(
    useCallback(() => {
      loadTreeData();
    }, [loadTreeData])
  );

  const openInSatelliteMaps = () => {
    const lat = Number(tree?.latitude) || Number(task?.latitude) || 0;
    const lng = Number(tree?.longitude) || Number(task?.longitude) || 0;
    if (!lat || !lng) {
      Alert.alert('No GPS Coordinates', 'This tree does not have valid coordinates recorded.');
      return;
    }
    // Universal Google Maps URL forcing satellite view with t=k & basemap=satellite
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&basemap=satellite`;
    const fallbackUrl = `https://maps.google.com/?q=${lat},${lng}&t=k&z=19`;
    Linking.openURL(googleMapsUrl).catch(() => {
      Linking.openURL(fallbackUrl).catch(() => {});
    });
  };

  const handleViewOnInteractiveMap = () => {
    if (!tree) return;
    const navParams = {
      focusTreeId: tree.id,
      focusLat: Number(tree.latitude) || Number(task?.latitude) || undefined,
      focusLng: Number(tree.longitude) || Number(task?.longitude) || undefined,
    };

    // 1. Direct navigate on current navigator (works for HistoryStack, RootStack, or child)
    try {
      (navigation as any).navigate('Map', navParams);
      return;
    } catch (e1) {
      console.warn('[TreeDetailScreen] direct navigate to Map failed:', e1);
    }

    // 2. Parent navigator
    try {
      const p = navigation.getParent();
      if (p) {
        (p as any).navigate('Map', navParams);
        return;
      }
    } catch (e2) {
      console.warn('[TreeDetailScreen] parent navigate to Map failed:', e2);
    }

    // 3. Grandparent navigator
    try {
      const gp = navigation.getParent()?.getParent();
      if (gp) {
        (gp as any).navigate('Map', navParams);
        return;
      }
    } catch (e3) {
      console.warn('[TreeDetailScreen] grandparent navigate to Map failed:', e3);
    }

    // 4. Fallback: open Google Maps in satellite view
    openInSatelliteMaps();
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

  const plantingDateStr = new Date(tree.submitted_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const displayId = displayTreeId(tree);
  const meta = parseTreeMeta(tree.notes);
  const cleanNotes = stripTreeMeta(tree.notes);

  const speciesTitle =
    (tree.species || '').replace(/\s*\([A-Za-z0-9-]{1,40}\)\s*$/, '').trim() || tree.species || '';
  const scientificName =
    tree.scientific_name ||
    meta.scientific_name ||
    getSpeciesDefault(speciesTitle)?.scientific ||
    '';
  const dbhCm = tree.dbh_cm || meta.dbh_cm;
  const heightM = tree.height_m || meta.height_m;
  const woodDensity = tree.wood_density || meta.wood_density;
  const crownDiam = tree.crown_diameter_m || meta.crown_diameter_m;
  const treeCondition = tree.tree_condition || meta.tree_condition;
  const multiStem = tree.multi_stem || meta.multi_stem;
  const ageYears = tree.age_years || meta.age_years;
  const landType = tree.land_type || meta.land_type;
  const eventType = tree.event_type || meta.event_type;
  const surveyor = tree.surveyor || meta.surveyor;
  const surveyName = task?.name || (surveyor ? `Survey by ${surveyor}` : tree.project_name);

  const auditStatus = getAuditStatus(tree, audits);

  // Active measurements: latest audit overrides baseline
  const activeDbh = latestAudit?.dbh_cm ?? dbhCm;
  const activeHeight = latestAudit?.height_m ?? heightM;
  const activeCrown = latestAudit?.crown_diameter_m ?? crownDiam;
  const activeDensity = latestAudit?.wood_density ?? woodDensity;
  const activeMultiStem = latestAudit?.multi_stem ?? multiStem;
  const activeAge = latestAudit?.age_years ?? ageYears;
  const activeNotes = stripTreeMeta(latestAudit?.notes) || cleanNotes;

  // Growth calculation compared to planting baseline
  const baselineDbhNum = dbhCm != null && !isNaN(Number(dbhCm)) ? Number(dbhCm) : null;
  const latestDbhNum = activeDbh != null && !isNaN(Number(activeDbh)) ? Number(activeDbh) : null;
  const dbhDiff =
    baselineDbhNum !== null && latestDbhNum !== null
      ? (latestDbhNum - baselineDbhNum).toFixed(1)
      : null;

  const baselineHeightNum = heightM != null && !isNaN(Number(heightM)) ? Number(heightM) : null;
  const latestHeightNum = activeHeight != null && !isNaN(Number(activeHeight)) ? Number(activeHeight) : null;
  const heightDiff =
    baselineHeightNum !== null && latestHeightNum !== null
      ? (latestHeightNum - baselineHeightNum).toFixed(1)
      : null;

  const completedRoundsSet = new Set(audits.map((a) => Number(a.monitoring_round)).filter(Boolean));
  const liveTreeId = resolveTreeId(tree) || treeId;

  // Approval status & modes
  const isApproved = Boolean(tree.locked || task?.status === 'approved');
  const isRejected = task?.status === 'rejected';
  const hasAudits = audits.length > 0;
  const showAuditProfile = hasAudits || Boolean(asAuditProfile);
  const rejectedAuditRound =
    isRejected &&
    (task?.task_type === 'audit' ||
      Number(task?.audit_round) > 0 ||
      (showAuditProfile && task?.task_type !== 'capture'))
      ? Number(task?.audit_round) || Number(latestAudit?.monitoring_round) || 1
      : 0;
  const isRejectedAudit = rejectedAuditRound > 0;
  const rejectionReason = isRejected
    ? (rejectionNotes || task?.review_notes || 'This audit was rejected. Edit it and submit again.')
    : null;
  const isUpdated = task?.status === 'completed' && Boolean(task?.review_notes);
  const isPending = !isApproved && !isRejected;
  const canStartAudit =
    Boolean(asAuditProfile) ||
    ((task?.status === 'assigned' || task?.status === 'in_progress') &&
      (task?.task_type === 'audit' || Number(task?.audit_round) > 0));
  const hasBottomAction =
    (!showAuditProfile && ((!isApproved && isRejected) || (isApproved && canStartAudit))) ||
    (showAuditProfile && (auditStatus.allCompleted || isRejectedAudit || canStartAudit));
  // Clear the phone navigation bar, and the bottom button when one is showing.
  const bottomPad = insets.bottom + (hasBottomAction ? 64 : 12);

  // (Multi-photo derivation + pager-sync effects live above the loading /
  // not-found early returns so the hook order never changes between renders.)

  return (
    <View style={styles.container}>
      {/* ─── 1. TOP HEADER (STATUS & NAVIGATION) ─── */}
      <LinearGradient colors={['#0f331d', '#1a5c2a', '#226934']} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {showAuditProfile ? 'TREE PROFILE' : 'TREE DETAILS'}
          </Text>
          <Text style={styles.headerSubtitle}>{displayId}</Text>
        </View>

        {showAuditProfile && auditStatus.allCompleted ? (
          <View style={styles.completedPill}>
            <Ionicons name="checkmark-done" size={12} color="#fff" />
            <Text style={styles.completedPillText}>4/4 DONE</Text>
          </View>
        ) : isRejected ? (
          <View style={styles.rejectedPill}>
            <Ionicons name="close-circle" size={12} color="#fff" />
            <Text style={styles.rejectedPillText}>REJECTED</Text>
          </View>
        ) : isApproved ? (
          <View style={styles.approvedPill}>
            <Ionicons name="shield-checkmark" size={12} color="#fff" />
            <Text style={styles.approvedPillText}>APPROVED</Text>
          </View>
        ) : isUpdated ? (
          <View style={styles.updatedPill}>
            <Ionicons name="refresh" size={12} color="#fff" />
            <Text style={styles.updatedPillText}>UPDATED</Text>
          </View>
        ) : task?.status === 'completed' ? (
          <View style={styles.completedPill}>
            <Ionicons name="checkmark-circle" size={12} color="#fff" />
            <Text style={styles.completedPillText}>COMPLETED</Text>
          </View>
        ) : (
          <View style={styles.pendingPill}>
            <Ionicons name="time" size={12} color="#fff" />
            <Text style={styles.pendingPillText}>PENDING</Text>
          </View>
        )}
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Rejection Notice Banner if rejected */}
        {isRejected && rejectionReason ? (
          <View style={styles.rejectionNoticeCard}>
            <Ionicons name="alert-circle" size={20} color="#ef4444" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rejectionNoticeTitle}>Rejection Reason:</Text>
              <Text style={styles.rejectionNoticeBody}>{rejectionReason}</Text>
              <Text style={styles.rejectionNoticeDate}>
                Rejected date: {formatDateFriendly(task?.reviewed_at || task?.completed_at || task?.created_at)}
              </Text>
            </View>
          </View>
        ) : null}

        {/* ─── 2. HERO PHOTO SLIDER: SWIPE THROUGH THE 3 VIEWS ─── */}
        <View style={styles.photoContainer}>
          {displayedPhotos.length > 0 ? (
            <ScrollView
              ref={photoScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.photoStrip}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / PHOTO_PAGE_W);
                setActivePhotoIdx(Math.max(0, Math.min(idx, displayedPhotos.length - 1)));
              }}
            >
              {displayedPhotos.map((uri, idx) => (
                <TouchableOpacity
                  key={`${photoView}-${idx}`}
                  activeOpacity={0.95}
                  style={styles.photoPage}
                  onPress={() => setFullscreenPhoto(uri)}
                >
                  <Image source={{ uri }} style={styles.heroPhoto as any} resizeMode="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyPhotoWrap}>
              <Ionicons name="leaf-outline" size={48} color="#15803d" />
              <Text style={styles.emptyPhotoText}>No Photo Recorded</Text>
            </View>
          )}

          {/* Top Floating Glass Header: photo-set toggle left, N/3 counter right */}
          <View style={styles.photoTopRow}>
            <View style={styles.photoToggleSlot}>
              {hasAuditPhoto ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.photoToggleScroll}
                  contentContainerStyle={styles.photoTogglePill}
                >
                  {completedAuditSets.map((set) => {
                    const isActive = photoView === 'audit' && selectedAuditSet?.round === set.round;
                    return (
                      <TouchableOpacity
                        key={`audit-tab-${set.round}`}
                        style={[styles.toggleBtn, isActive && styles.toggleBtnActive]}
                        onPress={() => {
                          setPhotoView('audit');
                          setSelectedAuditRound(set.round);
                          setActivePhotoIdx(0);
                          photoScrollRef.current?.scrollTo({ x: 0, animated: false });
                        }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="sparkles" size={11} color={isActive ? '#fff' : 'rgba(255,255,255,0.7)'} />
                        <Text style={[styles.toggleText, isActive && styles.toggleTextActive]}>
                          Audit {set.round}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TouchableOpacity
                    style={[styles.toggleBtn, photoView === 'planting' && styles.toggleBtnActive]}
                    onPress={() => {
                      setPhotoView('planting');
                      setActivePhotoIdx(0);
                      photoScrollRef.current?.scrollTo({ x: 0, animated: false });
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="leaf" size={11} color={photoView === 'planting' ? '#fff' : 'rgba(255,255,255,0.7)'} />
                    <Text style={[styles.toggleText, photoView === 'planting' && styles.toggleTextActive]}>
                      Planting
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              ) : null}
            </View>

            {displayedPhotos.length > 1 ? (
              <View style={styles.photoIndexPill}>
                <Text style={styles.photoIndexText}>
                  {activePhotoIdx + 1}/{displayedPhotos.length}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Bottom angle tabs: jump straight to Front / Side / Close-up */}
          {displayedPhotos.length > 1 ? (
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.8)']}
              style={styles.photoBottomGradient}
              pointerEvents="box-none"
            >
              <View style={styles.angleTabsRow}>
                {PHOTO_ANGLES.slice(0, displayedPhotos.length).map((angleCfg, idx) => {
                  const isActive = activePhotoIdx === idx;
                  return (
                    <TouchableOpacity
                      key={angleCfg.short}
                      activeOpacity={0.8}
                      onPress={() => {
                        setActivePhotoIdx(idx);
                        photoScrollRef.current?.scrollTo({ x: idx * PHOTO_PAGE_W, animated: true });
                      }}
                      style={[styles.angleTabBtn, isActive && styles.angleTabBtnActive]}
                    >
                      <Ionicons
                        name={angleCfg.icon as any}
                        size={11}
                        color={isActive ? '#fff' : 'rgba(255,255,255,0.75)'}
                      />
                      <Text style={[styles.angleTabText, isActive && styles.angleTabTextActive]}>
                        {angleCfg.short}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </LinearGradient>
          ) : null}
        </View>

        {/* ─── 3. MERGED SPECIES & GROWTH VITALS CARD ─── */}
        <View style={styles.speciesGrowthCard}>
          {/* Species Identity Top Row */}
          <View style={styles.identityPass}>
            <View style={styles.identityMark}>
              <Ionicons name="leaf" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.identityKicker}>TREE IDENTITY</Text>
              <Text style={styles.speciesTitle}>
                {speciesTitle || tree.species}
              </Text>
              {scientificName ? <Text style={styles.speciesScientific}>{scientificName}</Text> : null}
            </View>
            <View style={styles.identityStamp}>
              <Text style={styles.identityStampLabel}>
                {hasAudits ? `Audit ${latestAudit?.monitoring_round || 1}` : eventType || 'Planting'}
              </Text>
              <Text style={styles.identityStampId}>{displayId}</Text>
            </View>
          </View>
          {latestAudit?.surveyor || surveyor || surveyName ? (
            <View style={styles.surveyorStrip}>
              <Ionicons name="person" size={14} color="#123f24" />
              <Text style={styles.surveyorStripText} numberOfLines={1}>
                Field surveyor · {latestAudit?.surveyor || surveyor || surveyName}
              </Text>
            </View>
          ) : null}
          <View style={styles.infoBoxRow}>
            {landType || tree.survey_date ? (
              <View style={[styles.landTypeRow, styles.infoBoxHalf]}>
                <View style={styles.landTypeIconBox}>
                  <Ionicons name="map-outline" size={16} color="#15803d" />
                </View>
                <View style={styles.landTypeBody}>
                  <Text style={styles.landTypeLabel}>LAND TYPE</Text>
                  <Text style={styles.landTypeValue} numberOfLines={1}>
                    {landType || 'Not recorded'}
                  </Text>
                </View>
              </View>
            ) : null}
            <View
              style={[
                styles.landTypeRow,
                styles.infoBoxHalf,
                {
                  backgroundColor: isUpdated
                    ? '#fff7ed'
                    : isRejected
                    ? '#fef2f2'
                    : isApproved
                    ? '#f3e8ff'
                    : task?.status === 'completed'
                    ? '#ecfdf5'
                    : '#eff6ff',
                  borderColor: isUpdated
                    ? '#fdba74'
                    : isRejected
                    ? '#fecaca'
                    : isApproved
                    ? '#ddd6fe'
                    : task?.status === 'completed'
                    ? '#bbf7d0'
                    : '#bfdbfe',
                },
              ]}
            >
              <View
                style={[
                  styles.landTypeIconBox,
                  {
                    backgroundColor: isUpdated
                      ? '#ffedd5'
                      : isRejected
                      ? '#fee2e2'
                      : isApproved
                      ? '#ede9fe'
                      : task?.status === 'completed'
                      ? '#dcfce7'
                      : '#dbeafe',
                  },
                ]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={
                    isUpdated
                      ? '#ea580c'
                      : isRejected
                      ? '#dc2626'
                      : isApproved
                      ? '#7c3aed'
                      : task?.status === 'completed'
                      ? '#15803d'
                      : '#2563eb'
                  }
                />
              </View>
              <View style={styles.landTypeBody}>
                <Text
                  style={[
                    styles.landTypeLabel,
                    {
                      color: isUpdated
                        ? '#ea580c'
                        : isRejected
                        ? '#dc2626'
                        : isApproved
                        ? '#7c3aed'
                        : task?.status === 'completed'
                        ? '#15803d'
                        : '#2563eb',
                    },
                  ]}
                >
                  {hasAudits
                    ? `AUDIT ${latestAudit?.monitoring_round || 1} DATE`
                    : isUpdated
                    ? 'UPDATED DATE'
                    : isRejected
                    ? 'REJECTED DATE'
                    : isApproved
                    ? 'APPROVED DATE'
                    : task?.status === 'completed'
                    ? 'COMPLETED DATE'
                    : 'ASSIGNED DATE'}
                </Text>
                <Text style={styles.landTypeValue} numberOfLines={1}>
                  {formatDateFriendly(
                    hasAudits
                      ? activeInspectorAudit?.survey_date || activeInspectorAudit?.submitted_at || tree.survey_date
                      : tree.survey_date || task?.reviewed_at || task?.completed_at || tree.submitted_at || task?.created_at
                  ) || '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* Divider */}
          {hasAudits ? <View style={styles.speciesGrowthDivider} /> : null}

          {/* 3 Metric Pills */}
          {hasAudits ? <View style={styles.growthGrid}>
            {/* Trunk Diameter (DBH) */}
            <View style={styles.growthCard}>
              <View style={styles.growthCardTop}>
                <Ionicons name="git-commit" size={13} color="#15803d" />
                <Text style={styles.growthLabel}>TRUNK (DBH)</Text>
              </View>
              <Text style={styles.growthValue}>
                {activeDbh ?? '—'} <Text style={styles.growthUnit}>cm</Text>
              </Text>
              {dbhDiff !== null ? (
                <View
                  style={[
                    styles.growthTag,
                    parseFloat(dbhDiff) > 0
                      ? styles.growthTagPos
                      : parseFloat(dbhDiff) === 0
                      ? styles.growthTagNeu
                      : styles.growthTagNeg,
                  ]}
                >
                  <Text
                    style={[
                      styles.growthTagText,
                      parseFloat(dbhDiff) > 0
                        ? styles.growthTextPos
                        : parseFloat(dbhDiff) === 0
                        ? styles.growthTextNeu
                        : styles.growthTextNeg,
                    ]}
                  >
                    {parseFloat(dbhDiff) > 0 ? `▲ +${dbhDiff} cm` : parseFloat(dbhDiff) === 0 ? `▬ 0 cm` : `▼ ${dbhDiff} cm`}
                  </Text>
                </View>
              ) : (
                <Text style={styles.growthBaselineHint}>Baseline: {dbhCm ?? '—'}cm</Text>
              )}
            </View>

            {/* Height */}
            <View style={styles.growthCard}>
              <View style={styles.growthCardTop}>
                <Ionicons name="trending-up" size={13} color="#15803d" />
                <Text style={styles.growthLabel}>HEIGHT</Text>
              </View>
              <Text style={styles.growthValue}>
                {activeHeight ?? '—'} <Text style={styles.growthUnit}>m</Text>
              </Text>
              {heightDiff !== null ? (
                <View
                  style={[
                    styles.growthTag,
                    parseFloat(heightDiff) > 0
                      ? styles.growthTagPos
                      : parseFloat(heightDiff) === 0
                      ? styles.growthTagNeu
                      : styles.growthTagNeg,
                  ]}
                >
                  <Text
                    style={[
                      styles.growthTagText,
                      parseFloat(heightDiff) > 0
                        ? styles.growthTextPos
                        : parseFloat(heightDiff) === 0
                        ? styles.growthTextNeu
                        : styles.growthTextNeg,
                    ]}
                  >
                    {parseFloat(heightDiff) > 0 ? `▲ +${heightDiff} m` : parseFloat(heightDiff) === 0 ? `▬ 0 m` : `▼ ${heightDiff} m`}
                  </Text>
                </View>
              ) : (
                <Text style={styles.growthBaselineHint}>Baseline: {heightM ?? '—'}m</Text>
              )}
            </View>

            {/* Canopy Crown */}
            <View style={styles.growthCard}>
              <View style={styles.growthCardTop}>
                <Ionicons name="aperture" size={13} color="#15803d" />
                <Text style={styles.growthLabel}>CANOPY</Text>
              </View>
              <Text style={styles.growthValue}>
                {activeCrown ?? '—'} <Text style={styles.growthUnit}>m</Text>
              </Text>
              <View style={styles.growthTagSpread}>
                <Text style={styles.growthTagSpreadText}>Spread</Text>
              </View>
            </View>
          </View> : null}
        </View>

        {/* ─── 5. INTERACTIVE 4-STEP AUDIT JOURNEY (POST-AUDIT MODE ONLY) ─── */}
        {showAuditProfile ? (
          <View style={styles.journeyCard}>
            <View style={styles.journeyHeader}>
              <View style={styles.journeyTitleWrap}>
                <Ionicons name="git-network-outline" size={15} color="#15803d" />
                <Text style={styles.journeyTitle}>Audit Monitoring Journey</Text>
              </View>
              <View style={styles.journeyBadge}>
                <Text style={styles.journeyBadgeText}>
                  {completedRoundsSet.size} of 4 Recorded
                </Text>
              </View>
            </View>

            {/* 4 Interactive Nodes */}
            <View style={styles.journeyNodesRow}>
              {[1, 2, 3, 4].map((roundNum, idx) => {
                const isDone = completedRoundsSet.has(roundNum);
                const isNext = roundNum === auditStatus.currentRound && !auditStatus.allCompleted;
                const isSelected = selectedAuditRound === roundNum;

                return (
                  <React.Fragment key={roundNum}>
                    <TouchableOpacity
                      style={styles.nodeItem}
                      activeOpacity={isDone ? 0.7 : 1}
                      onPress={() => isDone && setSelectedAuditRound(roundNum)}
                    >
                      <View
                        style={[
                          styles.nodeCircle,
                          isDone && styles.nodeCircleDone,
                          isNext && styles.nodeCircleNext,
                          !isDone && !isNext && styles.nodeCircleLocked,
                          isSelected && styles.nodeCircleSelected,
                        ]}
                      >
                        {isDone ? (
                          <Ionicons name="checkmark" size={13} color="#fff" />
                        ) : isNext ? (
                          <Ionicons name="time" size={12} color="#d97706" />
                        ) : (
                          <Ionicons name="lock-closed" size={10} color="#9ca3af" />
                        )}
                      </View>

                      <Text
                        style={[
                          styles.nodeLabel,
                          isDone && styles.nodeLabelDone,
                          isNext && styles.nodeLabelNext,
                          !isDone && !isNext && styles.nodeLabelLocked,
                          isSelected && { fontWeight: '900', color: '#15803d' },
                        ]}
                      >
                        Audit {roundNum}
                      </Text>

                      <Text style={styles.nodeStatusSub}>
                        {isDone ? 'View ✓' : isNext ? 'Next ⏳' : 'Locked'}
                      </Text>
                    </TouchableOpacity>

                    {idx < 3 && (
                      <View
                        style={[
                          styles.nodeConnectorLine,
                          completedRoundsSet.has(roundNum + 1)
                            ? styles.lineDone
                            : isDone
                            ? styles.lineNext
                            : styles.lineLocked,
                        ]}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </View>

            {/* Selected Audit Snapshot (Clean Inspector) */}
            {activeInspectorAudit ? (
              <View style={styles.auditSnapshotCard}>
                <View style={styles.snapshotTopRow}>
                  <View style={styles.snapshotBadge}>
                    <Text style={styles.snapshotBadgeText}>
                      Audit {activeInspectorAudit.monitoring_round} Details
                    </Text>
                  </View>
                  <Text style={styles.snapshotDate}>
                    {formatDateFriendly(activeInspectorAudit.survey_date ?? activeInspectorAudit.submitted_at)}
                  </Text>
                </View>

                <View style={styles.snapshotBodyRow}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.snapshotMetrics}>
                      <Text style={{ fontWeight: '800' }}>DBH:</Text> {activeInspectorAudit.dbh_cm ?? '—'}cm  ·  <Text style={{ fontWeight: '800' }}>H:</Text> {activeInspectorAudit.height_m ?? '—'}m  ·  <Text style={{ fontWeight: '800' }}>Crown:</Text> {activeInspectorAudit.crown_diameter_m ?? '—'}m
                    </Text>

                    {activeInspectorAudit.tree_condition ? (
                      <Text style={styles.snapshotCondition}>
                        Condition: <Text style={{ fontWeight: '800', color: '#15803d' }}>{activeInspectorAudit.tree_condition}</Text>
                      </Text>
                    ) : null}

                    {activeInspectorAudit.surveyor ? (
                      <Text style={styles.snapshotSurveyor}>
                        Auditor: <Text style={{ fontWeight: '700' }}>{activeInspectorAudit.surveyor}</Text>
                      </Text>
                    ) : null}
                  </View>
                </View>

                {activeInspectorAudit.notes ? (
                  <View style={styles.snapshotNotesBox}>
                    <Text style={styles.snapshotNotesQuote}>
                      "{activeInspectorAudit.notes}"
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ─── 6. PLANTING BASELINE & SPECS (CLEAN EXPANDABLE ACCORDION) ─── */}
        <View style={styles.accordionCard}>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setBaselineExpanded(!baselineExpanded)}
            activeOpacity={0.7}
          >
            <View style={styles.accordionTitleRow}>
              <Ionicons name="leaf-outline" size={16} color="#15803d" />
              <Text style={styles.accordionTitle}>Planting Baseline & Tree Specs</Text>
            </View>
            <Ionicons
              name={baselineExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="#15803d"
            />
          </TouchableOpacity>

          {baselineExpanded && (
            <View style={styles.accordionBody}>
              <View style={styles.specGrid}>
                <View style={styles.specCell}>
                  <Text style={styles.specLabel}>Initial DBH</Text>
                  <Text style={styles.specValue}>{dbhCm ? `${dbhCm} cm` : '—'}</Text>
                </View>
                <View style={styles.specCell}>
                  <Text style={styles.specLabel}>Initial Height</Text>
                  <Text style={styles.specValue}>{heightM ? `${heightM} m` : '—'}</Text>
                </View>
                <View style={styles.specCell}>
                  <Text style={styles.specLabel}>Initial Crown</Text>
                  <Text style={styles.specValue}>{crownDiam ? `${crownDiam} m` : '—'}</Text>
                </View>
                <View style={styles.specCell}>
                  <Text style={styles.specLabel}>Wood Density</Text>
                  <Text style={styles.specValue}>{activeDensity ?? '—'}</Text>
                </View>
              </View>

              <View style={styles.specDetailsList}>
                {tree.project_name ? <SpecRow label="Project Name" value={tree.project_name} /> : null}
                <SpecRow label="Planting Date" value={plantingDateStr} />
                <SpecRow
                  label={
                    isUpdated
                      ? 'Updated Date'
                      : isRejected
                      ? 'Rejected Date'
                      : isApproved
                      ? 'Approved Date'
                      : task?.status === 'completed'
                      ? 'Completed Date'
                      : 'Assigned Date'
                  }
                  value={formatDateFriendly(
                    tree.survey_date || task?.reviewed_at || task?.completed_at || tree.submitted_at || task?.created_at
                  )}
                />
                {hasAudits ? (
                  <SpecRow
                    label="Audit Date"
                    value={formatDateFriendly(activeInspectorAudit?.survey_date ?? activeInspectorAudit?.submitted_at)}
                  />
                ) : null}
                <SpecRow label="Form" value={activeMultiStem ?? 'Single stem'} />
                <SpecRow label="Tree Age at Planting" value={activeAge ? `${activeAge}y` : '—'} />
                <SpecRow label="Land / Soil Type" value={landType ?? '—'} />
                <SpecRow label="Field Surveyor" value={latestAudit?.surveyor || surveyor || '—'} />
                {activeNotes ? <SpecRow label="Audit Notes" value={activeNotes} /> : null}
              </View>
            </View>
          )}
        </View>

        {/* ─── 7. LOCATION & MAP CARD ─── */}
        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <Ionicons name="location-outline" size={16} color="#15803d" />
            <Text style={styles.locationTitle}>Location & Coordinates</Text>
          </View>

          <MapPreview
            coords={{
              latitude: Number(tree.latitude) || Number(task?.latitude) || 0,
              longitude: Number(tree.longitude) || Number(task?.longitude) || 0,
            }}
            height={150}
            onPress={handleViewOnInteractiveMap}
          />

          <View style={styles.locationActionsRow}>
            <TouchableOpacity
              style={styles.mapActionPrimary}
              onPress={handleViewOnInteractiveMap}
              activeOpacity={0.8}
            >
              <Ionicons name="map" size={14} color="#fff" />
              <Text style={styles.mapActionPrimaryText}>View on Interactive Map</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.mapActionSecondary}
              onPress={openInSatelliteMaps}
              activeOpacity={0.8}
            >
              <Ionicons name="open-outline" size={14} color="#15803d" />
            </TouchableOpacity>
          </View>

          <View style={styles.coordsStrip}>
            <Text style={styles.coordsText}>
              Lat: <Text style={{ fontWeight: '800', color: '#111827' }}>{(Number(tree.latitude) || Number(task?.latitude) || 0).toFixed(6)}</Text>  ·  Long: <Text style={{ fontWeight: '800', color: '#111827' }}>{(Number(tree.longitude) || Number(task?.longitude) || 0).toFixed(6)}</Text>
            </Text>
          </View>
        </View>

      </ScrollView>

      {/* ─── FULLSCREEN LIGHTBOX MODAL ─── */}
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

      {/* ─── 8. BOTTOM ACTION BUTTON (APPROVAL & AUDIT AWARE) ─── */}
      {!showAuditProfile ? (
        !isApproved ? (
          // The "Edit Tree Details" button was removed for pending submissions.
          // A rejected submission keeps a single path to fix and resubmit.
          isRejected ? (
            <TouchableOpacity
              style={[styles.fab, { bottom: Math.max(insets.bottom, 16) + 4 }]}
              activeOpacity={0.85}
              onPress={() =>
                navigation.navigate('EditTree', {
                  treeId: tree.id,
                  taskId: task?.id || null,
                  rejectionNotes: rejectionReason,
                })
              }
            >
              <LinearGradient
                colors={['#dc2626', '#ef4444']}
                style={styles.fabGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons name="create-outline" size={18} color="#fff" />
                <Text style={styles.fabText}>Edit</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : null
        ) : canStartAudit ? (
          // Start Audit is only for an assigned audit card.
          <TouchableOpacity
            style={[styles.fab, { bottom: Math.max(insets.bottom, 16) + 4 }]}
            activeOpacity={0.85}
            onPress={() =>
              navigation.navigate('EditTree', {
                treeId: tree.id,
                taskId: task?.id || null,
                auditRound: Number(task?.audit_round) || auditStatus.currentRound || 1,
              })
            }
          >
            <LinearGradient
              colors={['#16a34a', '#15803d']}
              style={styles.fabGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="clipboard" size={18} color="#fff" />
              <Text style={styles.fabText}>Start Audit 1</Text>
              <View style={[styles.duePill, { backgroundColor: '#fff' }]}>
                <Text style={[styles.duePillText, { color: '#16a34a', fontWeight: '800' }]}>AUDIT NOW</Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        ) : null
      ) : auditStatus.allCompleted ? (
        <View style={[styles.fab, { bottom: Math.max(insets.bottom, 16) + 4 }]}>
          <View style={styles.allCompletedBar}>
            <LinearGradient
              colors={['#166534', '#15803d']}
              style={styles.fabGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="checkmark-done-circle" size={20} color="#fff" />
              <Text style={styles.fabText}>All 4 Audits Completed ✓</Text>
            </LinearGradient>
          </View>
        </View>
      ) : isRejectedAudit ? (
        <TouchableOpacity
          style={[styles.fab, { bottom: Math.max(insets.bottom, 16) + 4 }]}
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate('EditTree', {
              treeId: tree.id,
              taskId: task?.id || null,
              auditRound: rejectedAuditRound,
              rejectionNotes: rejectionReason,
            })
          }
        >
          <LinearGradient
            colors={['#dc2626', '#ef4444']}
            style={styles.fabGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="create-outline" size={18} color="#fff" />
            <Text style={styles.fabText}>Edit Audit {rejectedAuditRound}</Text>
          </LinearGradient>
        </TouchableOpacity>
      ) : canStartAudit ? (
        // Start Audit is only shown for a card opened from the Assigned tab.
        <TouchableOpacity
          style={[styles.fab, { bottom: Math.max(insets.bottom, 16) + 4 }]}
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate('EditTree', {
              treeId: tree.id,
              taskId: task?.id || null,
              auditRound: Number(task?.audit_round) || auditStatus.currentRound || 1,
            })
          }
        >
          <LinearGradient
            colors={['#16a34a', '#15803d']}
            style={styles.fabGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="clipboard" size={18} color="#fff" />
            <Text style={styles.fabText}>Start Audit {auditStatus.currentRound}</Text>
            <View style={[styles.duePill, { backgroundColor: '#fff' }]}>
              <Text style={[styles.duePillText, { color: '#16a34a', fontWeight: '800' }]}>AUDIT NOW</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={specRowStyles.row}>
      <Text style={specRowStyles.label}>{label}</Text>
      <Text style={specRowStyles.value}>{value}</Text>
    </View>
  );
}

const specRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  label: { fontSize: 11, color: '#6b7280' },
  value: { fontSize: 12, fontWeight: '700', color: '#1f2937' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: '#6b7280' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'flex-start', marginLeft: 10 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  headerSubtitle: { color: '#bbf7d0', fontSize: 11, marginTop: 2, fontWeight: '600' },
  completedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34, 197, 94, 0.35)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  completedPillText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  approvedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#8b5cf6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  approvedPillText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  rejectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ef4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rejectedPillText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  updatedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ea580c',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  updatedPillText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pendingPillText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  rejectionNoticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  rejectionNoticeTitle: { fontSize: 12, fontWeight: '800', color: '#ef4444' },
  rejectionNoticeBody: { fontSize: 12, color: '#991b1b', lineHeight: 16, marginTop: 2 },
  rejectionNoticeDate: { fontSize: 11, color: '#b91c1c', fontWeight: '700', marginTop: 4 },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 14, paddingBottom: 20 },

  // Hero Photo Gallery
  photoContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#0f2918',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    height: 260,
    position: 'relative',
  },
  photoStrip: {
    width: '100%',
    height: 260,
  },
  photoPage: {
    width: PHOTO_PAGE_W,
    height: 260,
    position: 'relative',
  },
  heroPhoto: { width: '100%', height: 260 },
  emptyPhotoWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5e9',
    gap: 6,
  },
  emptyPhotoText: { fontSize: 12, fontWeight: '700', color: '#15803d' },

  // Top Row Controls
  photoTopRow: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  photoTopRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  photoIndexPill: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  photoIndexText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  photoToggleSlot: {
    flexShrink: 1,
    marginRight: 8,
  },
  photoToggleScroll: {
    flexGrow: 0,
    maxWidth: SCREEN_WIDTH - 120,
  },
  photoTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 14,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 11,
  },
  toggleBtnActive: {
    backgroundColor: '#15803d',
  },
  toggleText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  toggleTextActive: { color: '#fff', fontWeight: '800' },
  singlePhotoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  singlePhotoText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  zoomHintBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  // Bottom Gradient & Angle Tabs (Downside)
  photoBottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 36,
    paddingBottom: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  angleTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  angleTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  angleTabBtnActive: {
    backgroundColor: '#15803d',
    borderColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  angleTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
  },
  angleTabTextActive: {
    color: '#fff',
    fontWeight: '900',
  },

  // Merged Species & Growth Card
  speciesGrowthCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 5,
    borderWidth: 1,
    borderColor: '#e8efe8',
    gap: 8,
  },
  speciesGrowthDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
  },
  speciesTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  speciesTitle: { fontSize: 22, fontWeight: '900', color: '#123f24' },
  identityPass: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#1a5c2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityKicker: { fontSize: 10, fontWeight: '800', color: '#6b8f78', letterSpacing: 1.1 },
  identityStamp: {
    minWidth: 86,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#1a5c2a',
    backgroundColor: '#F3FBF5',
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  identityStampLabel: { fontSize: 11, fontWeight: '800', color: '#1a5c2a' },
  identityStampId: { fontSize: 13, fontWeight: '900', color: '#123f24', marginTop: 2 },
  surveyorStrip: {
    // Spacing comes from the card's `gap` — no extra margin on top of it.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF6EE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  surveyorStripText: { flex: 1, color: '#123f24', fontSize: 13, fontWeight: '700' },
  landTypeRow: {
    // Spacing comes from the card's `gap` — no extra margin on top of it.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0FDF4',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  landTypeIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landTypeBody: { flex: 1 },
  landTypeLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: '#16A34A',
    letterSpacing: 1,
  },
  landTypeValue: { fontSize: 14, fontWeight: '800', color: '#123F24', marginTop: 2 },
  // Two info boxes (Land Type · Date) sharing one line, half width each.
  infoBoxRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  infoBoxHalf: { flex: 1 },
  surveyDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  surveyDateText: { fontSize: 10, fontWeight: '700', color: '#15803D' },
  eventChipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#E5F6EA',
    borderWidth: 1,
    borderColor: '#B7E0C2',
  },
  eventChipText: { fontSize: 12, fontWeight: '700', color: '#1a5c2a' },
  speciesScientific: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#15803d',
    marginTop: 2,
    fontWeight: '600',
  },
  surveyNamePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  surveyNameText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803d',
  },
  treeIdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  treeIdText: { fontSize: 11, fontWeight: '800', color: '#15803d' },

  // Growth Section
  growthGrid: { flexDirection: 'row', gap: 8 },
  growthCard: {
    flex: 1,
    backgroundColor: '#f8faf9',
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8efe8',
  },
  growthCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  growthLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#6b7280',
    letterSpacing: 0.3,
  },
  growthValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
  },
  growthUnit: { fontSize: 10, fontWeight: '600', color: '#6b7280' },
  growthTag: {
    marginTop: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  growthTagPos: { backgroundColor: '#dcfce7' },
  growthTagNeu: { backgroundColor: '#f3f4f6' },
  growthTagNeg: { backgroundColor: '#fee2e2' },
  growthTagText: { fontSize: 9, fontWeight: '800' },
  growthTextPos: { color: '#15803d' },
  growthTextNeu: { color: '#6b7280' },
  growthTextNeg: { color: '#dc2626' },
  growthBaselineHint: {
    fontSize: 9,
    color: '#9ca3af',
    marginTop: 4,
  },
  growthTagSpread: {
    marginTop: 6,
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  growthTagSpreadText: { fontSize: 9, fontWeight: '800', color: '#15803d' },

  // Journey Card
  journeyCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 5,
    borderWidth: 1,
    borderColor: '#e8efe8',
  },
  journeyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  journeyTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  journeyTitle: { fontSize: 13, fontWeight: '800', color: '#111827' },
  journeyBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  journeyBadgeText: { fontSize: 10, fontWeight: '800', color: '#15803d' },
  journeyNodesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  nodeItem: { alignItems: 'center', width: 56 },
  nodeCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeCircleDone: { backgroundColor: '#15803d' },
  nodeCircleNext: { backgroundColor: '#fef3c7', borderWidth: 2, borderColor: '#d97706' },
  nodeCircleLocked: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  nodeCircleSelected: {
    borderWidth: 2,
    borderColor: '#15803d',
    transform: [{ scale: 1.1 }],
  },
  nodeLabel: { fontSize: 10, marginTop: 4 },
  nodeLabelDone: { color: '#15803d', fontWeight: '800' },
  nodeLabelNext: { color: '#d97706', fontWeight: '800' },
  nodeLabelLocked: { color: '#9ca3af' },
  nodeStatusSub: { fontSize: 8, color: '#9ca3af', marginTop: 1 },
  nodeConnectorLine: { flex: 1, height: 2.5, marginBottom: 16 },
  lineDone: { backgroundColor: '#15803d' },
  lineNext: { backgroundColor: '#d97706' },
  lineLocked: { backgroundColor: '#e5e7eb' },

  // Snapshot Inspector
  auditSnapshotCard: {
    backgroundColor: '#f8faf9',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2ece4',
    gap: 8,
  },
  snapshotTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  snapshotBadge: {
    backgroundColor: '#15803d',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  snapshotBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  snapshotDate: { fontSize: 11, color: '#6b7280', fontWeight: '600' },
  snapshotBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  snapshotMetrics: { fontSize: 11, color: '#374151' },
  snapshotCondition: { fontSize: 10, color: '#6b7280' },
  snapshotSurveyor: { fontSize: 10, color: '#6b7280' },
  snapshotThumb: { width: 50, height: 50, borderRadius: 8, backgroundColor: '#e5e7eb' },
  snapshotPhotosWrap: {
    alignItems: 'center',
    gap: 0,
  },
  snapshotThumbNumBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#15803d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapshotThumbNumText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  snapshotNotesBox: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#15803d',
  },
  snapshotNotesQuote: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#4b5563',
  },
  noAuditTipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f0fdf4',
    padding: 10,
    borderRadius: 10,
  },
  noAuditTipText: { fontSize: 11, color: '#15803d', flex: 1 },

  // Baseline Accordion
  accordionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e8efe8',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  accordionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accordionTitle: { fontSize: 12, fontWeight: '800', color: '#15803d' },
  accordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  specGrid: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 10,
  },
  specCell: {
    flex: 1,
    backgroundColor: '#f8faf9',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  specLabel: { fontSize: 8, color: '#6b7280', marginBottom: 2 },
  specValue: { fontSize: 11, fontWeight: '800', color: '#111827' },
  specDetailsList: { gap: 2 },

  // Location Card
  locationCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 5,
    borderWidth: 1,
    borderColor: '#e8efe8',
    gap: 10,
  },
  locationHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationTitle: { fontSize: 12, fontWeight: '800', color: '#111827' },
  locationActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mapActionPrimary: {
    flex: 1,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#15803d',
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  mapActionPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '800', flexShrink: 1 },
  mapActionSecondary: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  coordsStrip: {
    backgroundColor: '#f8faf9',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  coordsText: { fontSize: 10, color: '#6b7280' },

  // Fullscreen Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalImg: { width: '92%', height: '80%' },

  // Bottom Fixed FAB
  fab: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 16,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 50,
  },
  allCompletedBar: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  fabGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
  },
  fabText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  duePill: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 4,
  },
  duePillText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
