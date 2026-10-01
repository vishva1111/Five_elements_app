import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  TextInput,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CaptureStackParamList,
  LAND_TYPE_OPTIONS,
  TreeFormData,
} from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { insertTreeRecord, fetchAllProjects } from '../../services/treeService';
import { Project } from '../../types';
import { uploadTreePhoto } from '../../services/storageService';
import { completeTask } from '../../services/taskService';
import { useTaskStore } from '../../store/taskStore';
import { createTreeIdentity } from '../../utils/treeId';
import MapPreview from '../../components/MapPreview';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'TreeForm'>;
type Route = RouteProp<CaptureStackParamList, 'TreeForm'>;

const SLOT_LABELS = ['Front', 'Side', 'Close-up'];

function splitAssignedTreeName(value: string): { name: string; code: string } {
  const code = value.match(/\(([A-Za-z0-9]+)\)\s*$/)?.[1]?.toUpperCase() ?? '';
  const withoutCode = value.replace(/\s*\([A-Za-z0-9]+\)\s*$/, '').trim();
  const name = withoutCode.split(/\s+[—–-]\s+/).pop()?.trim() || withoutCode;
  return { name, code };
}

export default function TreeFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { photoUris, coords } = route.params;
  const photos = (photoUris ?? []).filter((uri): uri is string => Boolean(uri));
  const { user, activeProjectId } = useAuthStore();
  const trees = useTreeStore((s) => s.trees) ?? [];
  const addTree = useTreeStore((s) => s.addTree);
  const [allProjects, setAllProjects] = useState<Project[]>([]);

  // Auto-select the active project
  const [form, setForm] = useState<TreeFormData>({
    species: '',
    scientific_name: '',
    health_status: 'healthy',
    notes: '',
    project_id: activeProjectId ?? '',
    event_type: 'Planting',
    quantity: 1,
    tree_id: '',
    dbh_cm: '',
    height_m: '',
    wood_density: '',
    crown_diameter_m: '',
    tree_condition: 'Healthy',
    multi_stem: 'No',
    age_years: '',
    land_type: 'Roadside',
    surveyor: user?.full_name ?? '',
    survey_date: new Date().toISOString().split('T')[0],
  });
  const [submitting, setSubmitting] = useState(false);
  const recordIdRef = useRef('');

  // The tree ID is the 8-character record code shown beside the tree name.
  // The tree name starts as the assigned task name.
  useEffect(() => {
    const identity = createTreeIdentity();
    recordIdRef.current = identity.id;
    const tasks = useTaskStore.getState().tasks ?? [];
    const activeTaskId = useTaskStore.getState().activeTaskId;
    const assignedTask = activeTaskId
      ? tasks.find((task) => task.id === activeTaskId)
      : tasks.find((task) => task.status === 'assigned' && !task.tree_id);
    const assignedName = assignedTask?.name || assignedTask?.title || '';
    const parsed = splitAssignedTreeName(assignedName);
    setForm((f) => ({
      ...f,
      tree_id: parsed.code || identity.code,
      species: f.species || parsed.name,
    }));
  }, []);

  const scrollRef = useRef<ScrollView>(null);

  // ─── Load ALL projects so the picker matches the dashboard (not just login) ──
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await fetchAllProjects();
      if (active && data) setAllProjects(data);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Keep the form's project in step with the ACTIVE project: whenever the user
  // switches the active project, the capture is pre-assigned to it.
  useEffect(() => {
    if (activeProjectId && form.project_id !== activeProjectId) {
      setForm((f) => ({ ...f, project_id: activeProjectId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // ─── PROJECT dropdown shows ALL projects, defaults to the active one ───────
  const projects = allProjects;
  const selectedProject = projects.find((p) => p.id === form.project_id);

  const handleSubmit = async () => {
    if (!user) return;
    if (photos.length === 0) {
      Alert.alert('Required', 'The tree photos are missing. Please capture them again.');
      return;
    }
    if (!coords?.latitude || !coords?.longitude) {
      Alert.alert('Required', 'The tree location is missing. Please capture it again.');
      return;
    }

    setSubmitting(true);
    try {
      const allTasks = useTaskStore.getState().tasks ?? [];
      const activeTaskId = useTaskStore.getState().activeTaskId;
      const matchingTask = activeTaskId
        ? allTasks.find((t) => t.id === activeTaskId)
        : allTasks.find(
            (t) => t.status === 'assigned' && (t.tree_id === form.tree_id || !t.tree_id)
          );

      // 1. Upload every captured photo. The first URL stays the primary photo.
      const uploadedUrls: string[] = [];
      for (const uri of photos) {
        const url = await uploadTreePhoto(uri, user.id);
        if (!url) throw new Error('Photo upload failed. Check your connection and try again.');
        uploadedUrls.push(url);
      }
      const photoUrl = uploadedUrls[0];

      // 2. Planting stores only the photos, location, and the assigned task name.
      const { data, error } = await insertTreeRecord({
        id: recordIdRef.current || undefined,
        user_id: user.id,
        project_id: form.project_id || undefined,
        photo_url: photoUrl,
        photo_urls: uploadedUrls,
        latitude: coords.latitude,
        longitude: coords.longitude,
        species: form.species.trim() || matchingTask?.name || matchingTask?.title || 'Planted tree',
        health_status: 'healthy',
        notes: matchingTask?.name || matchingTask?.title || undefined,
        synced: true,
        event_type: 'Planting',
        tree_id: form.tree_id || undefined,
        land_type: form.land_type,
        surveyor: user.full_name || undefined,
        survey_date: form.survey_date || undefined,
      });

      if (error || !data) throw new Error(error ?? 'Failed to save tree record');

      addTree(data);

      // 4. Complete the task this capture was started from ("Start Now" on the Task
      //    screen sets activeTaskId), falling back to fuzzy-matching an assigned
      //    capture-style task if this Capture wasn't reached from a specific task.
      //    No in_progress step anywhere — assigned goes straight to completed.
      //    (best-effort — non-blocking, won't fail the submit)
      try {
        const allTasks = useTaskStore.getState().tasks ?? [];
        const activeTaskId = useTaskStore.getState().activeTaskId;

        const matchingTask = activeTaskId
          ? allTasks.find((t) => t.id === activeTaskId)
          : allTasks.find(
              (t) => t.status === 'assigned' && (t.tree_id === data.id || t.tree_id === form.tree_id || !t.tree_id)
            );

        if (matchingTask && (matchingTask.status === 'assigned' || matchingTask.status === 'in_progress')) {
          // Use the coords already captured for this tree — exact and no extra GPS round-trip.
          const location = `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
          await completeTask(matchingTask.id, data.id, location);
          // Update local store so TaskScreen reflects immediately
          const updatedTasks = allTasks.map((t) =>
            t.id === matchingTask.id
              ? { ...t, status: 'completed' as const, completed_at: new Date().toISOString(), tree_id: data.id, location }
              : t
          );
          useTaskStore.getState().setTasks(updatedTasks);
        }
        useTaskStore.getState().setActiveTaskId(null);
      } catch (taskErr) {
        // Non-critical — tree was saved successfully
        console.warn('[TreeFormScreen] task auto-complete failed:', taskErr);
        useTaskStore.getState().setActiveTaskId(null);
      }

      navigation.navigate('SubmitSuccess', { treeId: data.id });
    } catch (err: any) {
      const msg = err?.message ?? JSON.stringify(err) ?? 'Please try again.';
      console.error('Submit error:', msg);
      Alert.alert('Submission Failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header with credits on the right */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>FIELD CAPTURE</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {selectedProject?.name ?? 'No project selected'}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        ref={scrollRef}
        style={styles.scrollContent}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Photo Preview */}
        <View style={styles.photoSection}>
          <View style={styles.photoGalleryRow}>
            {SLOT_LABELS.map((label, slot) => {
              const uri = photos[slot];
              return (
                <View key={label} style={styles.photoThumbWrap}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.photoThumb} resizeMode="cover" />
                  ) : (
                    <View style={styles.photoEmpty}>
                      <Ionicons name="camera" size={22} color="#fff" />
                    </View>
                  )}
                  <View style={styles.photoThumbBadge}>
                    <Text style={styles.photoThumbBadgeText}>{uri ? label : 'Empty'}</Text>
                  </View>
                </View>
              );
            })}
          </View>
          <View style={styles.photoOverlay}>
            <View style={styles.photoCountBadge}>
              <Ionicons name="camera" size={14} color="#fff" />
              <Text style={styles.photoBadgeText}>{photos.length}/3 Photos</Text>
            </View>
          </View>
        </View>

        {coords?.latitude && coords?.longitude ? (
          <View style={styles.mapSection}>
            <MapPreview coords={coords} height={160} />
          </View>
        ) : null}

        {/* Form */}
        <View style={styles.form}>

          {/* ─── SECTION: Tree Identity ─── */}
          <View style={styles.sectionHeader}>
            <Ionicons name="finger-print" size={16} color="#1a5c2a" />
            <Text style={[styles.sectionTitle, styles.sectionTitleGrow]}>Tree Identity</Text>
            <View style={styles.plantingTag}>
              <Ionicons name="leaf" size={12} color="#1a5c2a" />
              <Text style={styles.plantingTagText}>{form.event_type}</Text>
            </View>
          </View>

          {/* Tree ID — auto-generated */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>TREE ID</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{form.tree_id}</Text>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>TREE NAME <Text style={styles.optional}>· assigned task</Text></Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{form.species || '—'}</Text>
            </View>
          </View>

          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>FIELD SURVEYOR</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{user?.full_name || form.surveyor || '—'}</Text>
              </View>
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>DATE</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{form.survey_date || '—'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>LAND TYPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventTypeScroll}>
              {LAND_TYPE_OPTIONS.map((landType) => (
                <TouchableOpacity
                  key={landType}
                  style={[styles.eventTypeBtn, form.land_type === landType && styles.eventTypeBtnActive]}
                  onPress={() => setForm({ ...form, land_type: landType })}
                >
                  <Text style={[styles.eventTypeText, form.land_type === landType && styles.eventTypeTextActive]}>
                    {landType}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ─── SECTION: Location ─── */}
          <View style={styles.sectionHeader}>
            <Ionicons name="location" size={16} color="#1a5c2a" />
            <Text style={styles.sectionTitle}>Location</Text>
          </View>

          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>LAT</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{coords.latitude.toFixed(6)}</Text>
              </View>
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>LONG</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{coords.longitude.toFixed(6)}</Text>
              </View>
            </View>
          </View>

          {/* Low Accuracy Warning */}
          {coords && coords.accuracy && coords.accuracy > 50 && (
            <View style={styles.accuracyWarning}>
              <View style={styles.accuracyDot} />
              <Text style={styles.accuracyText}>
                <Text style={{ fontWeight: '700' }}>Location is approximate</Text> — that's fine, we've noted it. Your capture saves and is flagged for review, never blocked.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.captureSaveBtn, submitting && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <Text style={styles.captureSaveBtnText}>Submitting...</Text>
            ) : (
              <Text style={styles.captureSaveBtnText}>Save capture</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f1',
  },
  // Header
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'flex-start',
    marginLeft: 10,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  headerSub: {
    color: '#cde8d3',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  headerCredits: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7.5,
    minWidth: 48,
    justifyContent: 'center',
  },
  headerCreditsText: {
    color: '#1a5c2a',
    fontWeight: '700',
    fontSize: 13,
  },
  headerCreditsLow: {
    backgroundColor: '#F09125',
  },
  headerCreditsLowText: {
    color: '#fff',
  },
  // Scroll Content
  scrollContent: {
    flex: 1,
  },
  // Photo Section
  photoSection: {
    backgroundColor: '#0D1A17',
    position: 'relative',
  },
  photoGalleryRow: { flexDirection: 'row', height: 160 },
  photoThumbWrap: { flex: 1, borderRightWidth: 1, borderRightColor: 'rgba(0,0,0,0.3)' },
  photoThumb: { width: '100%', height: '100%' },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#163126' },
  photoThumbBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  photoThumbBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  photoCountBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  sectionTitleGrow: { flex: 1 },
  plantingTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#E5F6EA', borderWidth: 1, borderColor: '#B7E0C2' },
  plantingTagText: { fontSize: 12, fontWeight: '700', color: '#1a5c2a' },
  notesField: { minHeight: 96, textAlignVertical: 'top' },
  conditionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  conditionCard: { flexBasis: '48%', flexGrow: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, borderWidth: 1.5, backgroundColor: '#fff' },
  conditionIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  conditionLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  conditionLabelActive: { color: '#fff' },
  captureSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a5c2a', borderRadius: 14, paddingVertical: 14, marginTop: 8 },
  captureSaveBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  photoOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  photoBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  // Map Section
  mapSection: {
    height: 120,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 7.5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  // Form
  form: {
    padding: 16,
    gap: 18,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1a5c2a',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  required: {
    color: '#8B3A00',
    fontWeight: '400',
    textTransform: 'none',
  },
  optional: {
    color: '#6B7B6E',
    fontWeight: '400',
    textTransform: 'none',
  },
  // Section Headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E8F5E9',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a5c2a',
    textTransform: 'uppercase',
  },
  // Read-only field
  readOnlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  readOnlyText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    flex: 1,
  },
  speciesValueText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    marginLeft: 8,
  },
  // Text input
  textInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D4E8D0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1a1a1a',
  },
  // Measurement grid
  measureGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  measureCell: {
    flex: 1,
    gap: 4,
  },
  measureLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#1a5c2a',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  measureInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D4E8D0',
    paddingHorizontal: 6,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1a1a1a',
    textAlign: 'center',
    minHeight: 40,
  },
  // Event Type
  eventTypeScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  eventTypeBtn: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#AACBA7',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventTypeBtnActive: {
    backgroundColor: '#1a5c2a',
    borderColor: '#1a5c2a',
  },
  eventTypeBtnCompact: {
    height: 38,
    paddingHorizontal: 12,
  },
  eventTypeBtnSmall: {
    height: 36,
    paddingHorizontal: 10,
    flex: 1,
  },
  // Multi Stem row
  multiStemRow: {
    flexDirection: 'row',
    gap: 6,
  },
  multiStemBtn: {
    flex: 1,
    height: 40,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#D4E8D0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiStemBtnActive: {
    backgroundColor: '#1a5c2a',
    borderColor: '#1a5c2a',
  },
  multiStemBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  multiStemBtnTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  eventTypeText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#112121',
  },
  eventTypeTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  // Quantity
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  quantityBtn: {
    width: 56,
    height: 56,
    borderRadius: 7.5,
    borderWidth: 1.5,
    borderColor: '#1a5c2a',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityBtnText: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a5c2a',
  },
  quantityDisplay: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#AACBA7',
    borderRadius: 7.5,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quantityValue: {
    fontFamily: 'monospace',
    fontSize: 24,
    fontWeight: '700',
    color: '#112121',
  },
  quantityUnit: {
    fontSize: 13,
    color: '#6B7B6E',
  },
  // Species
  speciesInput: {
    height: 52,
    borderWidth: 1.5,
    borderColor: '#AACBA7',
    borderRadius: 7.5,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  speciesInputText: {
    fontSize: 15,
    color: '#112121',
    flex: 1,
  },
  speciesPlaceholder: {
    color: '#aaa',
  },
  speciesList: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 7.5,
    overflow: 'hidden',
    maxHeight: 240,
    backgroundColor: '#fff',
  },
  // Internal scroll area of the species dropdown — every name stays reachable
  speciesListScroll: {
    flexGrow: 0,
  },
  speciesItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  speciesItemActive: {
    backgroundColor: '#EAF3DE',
  },
  speciesItemText: {
    fontSize: 14,
    color: '#333',
  },
  speciesItemTextActive: {
    color: '#1a5c2a',
    fontWeight: '600',
  },
  // Health Status
  healthRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  healthBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 7.5,
    borderWidth: 2,
  },
  healthBtnCompact: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  healthBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Project
  noProjectsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: '#F5F5F5',
    borderRadius: 7.5,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  noProjectsInfoText: {
    fontSize: 13,
    color: '#6B7B6E',
    flex: 1,
    lineHeight: 18,
  },
  // Project dropdown
  projectDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: '#DDE7D8',
    borderRadius: 7.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  projectDropdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
    marginRight: 8,
  },
  projectDropdownText: {
    flex: 1,
    fontSize: 15,
    color: '#112121',
    fontWeight: '500',
  },
  projectDropdownList: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 7.5,
    overflow: 'hidden',
    maxHeight: 220,
    backgroundColor: '#fff',
    marginTop: 6,
  },
  projectDropdownScroll: {
    flexGrow: 0,
  },
  projectDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  projectDropdownItemActive: {
    backgroundColor: '#EAF3DE',
  },
  projectDropdownItemText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  projectDropdownItemTextActive: {
    color: '#1a5c2a',
    fontWeight: '600',
  },
  // Notes
  notesInput: {
    borderWidth: 1.5,
    borderColor: '#AACBA7',
    borderRadius: 7.5,
    padding: 14,
    backgroundColor: '#fff',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notesInputText: {
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
  },
  // Modal backdrop
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Note Helper Modal
  noteModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '70%',
    paddingHorizontal: 20,
  },
  noteModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  noteModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  noteModalInput: {
    borderWidth: 1.5,
    borderColor: '#D4E8D0',
    borderRadius: 7.5,
    padding: 14,
    fontSize: 15,
    color: '#1a1a1a',
    backgroundColor: '#f9fdf8',
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  noteSuggestionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  noteSuggestionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  noteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F5E9',
    borderRadius: 7.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  noteChipText: {
    fontSize: 12,
    color: '#1a5c2a',
    fontWeight: '500',
  },
  noteDoneBtn: {
    backgroundColor: '#1a5c2a',
    borderRadius: 7.5,
    paddingVertical: 14,
    alignItems: 'center',
  },
  noteDoneBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  // Accuracy Warning
  accuracyWarning: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#FEF0E3',
    borderWidth: 1,
    borderColor: '#EF9F27',
    borderRadius: 7.5,
    padding: 12,
  },
  accuracyDot: {
    width: 10,
    height: 10,
    borderRadius: 7.5,
    backgroundColor: '#EF9F27',
    marginTop: 3,
  },
  accuracyText: {
    fontSize: 13,
    color: '#8B3A00',
    lineHeight: 18,
    flex: 1,
  },
  // Save Section
  saveSection: {
    padding: 12,
    paddingHorizontal: 16,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#EDE6DF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 8,
  },
  saveBtn: {
    height: 48,
    borderRadius: 7.5,
    backgroundColor: '#F09125',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#F09125',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 6,
  },
  saveBtnDisabled: {
    backgroundColor: '#ccc',
    shadowOpacity: 0,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#112121',
  },
});
