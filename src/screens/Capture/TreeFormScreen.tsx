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
  Modal,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CaptureStackParamList,
  TreeFormData,
  TREE_SPECIES,
  EVENT_TYPES,
  TREE_CONDITION_OPTIONS,
  LAND_TYPE_OPTIONS,
  TreeCondition,
  MultiStemOption,
  LandType,
} from '../../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { insertTreeRecord, syncUserCredits, computeCreditsForProject, fetchAllProjects, generateProjectTreeId } from '../../services/treeService';
import { Project } from '../../types';
import { uploadTreePhoto } from '../../services/storageService';
import { completeTask } from '../../services/taskService';
import { useTaskStore } from '../../store/taskStore';
import { useProjectRefreshStore } from '../../store/projectRefreshStore';
import MapPreview from '../../components/MapPreview';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'TreeForm'>;
type Route = RouteProp<CaptureStackParamList, 'TreeForm'>;

export default function TreeFormScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { photoUris, coords } = route.params;
  // Primary photo is the first in the array; all 3 are uploaded
  const photoUri = photoUris?.[0] ?? '';
  const { user, activeProjectId, setUserCredits } = useAuthStore();
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
  const [showSpeciesPicker, setShowSpeciesPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showNoteHelper, setShowNoteHelper] = useState(false);

  // Auto-generate project-wise sequential TreeID on mount
  useEffect(() => {
    (async () => {
      const projects = allProjects.length > 0 ? allProjects : (await fetchAllProjects()).data ?? [];
      const project = projects.find((p) => p.id === (activeProjectId ?? form.project_id));
      const treeId = await generateProjectTreeId(
        project?.id ?? activeProjectId,
        project?.name
      );
      setForm((f) => ({ ...f, tree_id: treeId }));
    })();
  }, [activeProjectId, allProjects.length]);

  // Refs used to keep fields visible above the keyboard while typing
  const scrollRef = useRef<ScrollView>(null);
  const notesFieldRef = useRef<TextInput>(null);
  const scrollOffsetRef = useRef(0);
  const windowHRef = useRef(Dimensions.get('window').height);

  // Generic: scroll any focused input into view above the keyboard
  const scrollToInput = (ref: React.RefObject<TextInput>) => {
    const scroll = scrollRef.current;
    const input = ref.current;
    if (!scroll || !input) return;
    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const winH = Dimensions.get('window').height;
      const resized = winH < windowHRef.current - 20;
      const kbHeight = 300;
      const visibleBottom = resized ? winH : winH - kbHeight;
      const overflow = y + h + 16 - visibleBottom;
      if (overflow > 0) {
        scroll.scrollTo({ y: scrollOffsetRef.current + overflow, animated: true });
      }
    });
  };

  // Generic handler: when any input is focused, scroll so it stays above the keyboard
  const handleInputFocus = (e: any) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    // e.target is the native tag; we can measure it via the responder
    const node = e?.target;
    if (!node) return;
    // Small delay to let keyboard animation start
    setTimeout(() => {
      // On Android/iOS the native node exposes measureInWindow via the Fabric/TurboModule
      // bridge. If it's not available we fall back to a conservative scroll.
      if (typeof node.measureInWindow === 'function') {
        node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
          const winH = Dimensions.get('window').height;
          const keyboardHeight = 320;
          const visibleTop = scrollOffsetRef.current;
          const visibleBottom = visibleTop + winH - keyboardHeight;
          if (y + h > visibleBottom) {
            scroll.scrollTo({ y: scrollOffsetRef.current + (y + h - visibleBottom) + 16, animated: true });
          }
        });
      } else {
        scroll.scrollTo({ y: scrollOffsetRef.current + 250, animated: true });
      }
    }, 150);
  };

  const handleNotesFocus = () => {
    setShowSpeciesPicker(false);
    setTimeout(() => scrollToInput(notesFieldRef), 100);
    setTimeout(() => scrollToInput(notesFieldRef), 350);
  };

  // When keyboard opens, make sure the focused input stays visible
  useEffect(() => {
    const willShow = Keyboard.addListener('keyboardWillShow', () => {
      // iOS: keyboard animation starting, give layout a moment then re-measure
      setTimeout(() => {
        const scroll = scrollRef.current;
        if (scroll) {
          scroll.scrollTo({ y: scrollOffsetRef.current + 200, animated: true });
        }
      }, 150);
    });
    const didShow = Keyboard.addListener('keyboardDidShow', () => {
      // Android: keyboard already shown, nudge scroll
      setTimeout(() => {
        const scroll = scrollRef.current;
        if (scroll) {
          scroll.scrollTo({ y: scrollOffsetRef.current + 200, animated: true });
        }
      }, 200);
    });
    return () => {
      willShow.remove();
      didShow.remove();
    };
  }, []);

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
    if (!form.species.trim()) {
      Alert.alert('Required', 'Please select or enter a tree species.');
      return;
    }
    if (!form.dbh_cm || parseFloat(form.dbh_cm) <= 0) {
      Alert.alert('Required', 'Please enter DBH (cm).');
      return;
    }
    if (!form.height_m || parseFloat(form.height_m) <= 0) {
      Alert.alert('Required', 'Please enter Height (m).');
      return;
    }
    if (!user) return;

    setSubmitting(true);
    try {
      // 1. Upload all 3 photos; the first becomes the main photo_url
      const uploadedUrls: string[] = [];
      for (const uri of photoUris) {
        const url = await uploadTreePhoto(uri, user.id);
        if (!url) throw new Error('Photo upload failed');
        uploadedUrls.push(url);
      }
      const primaryPhotoUrl = uploadedUrls[0];

      // 2. Insert tree record with all fields
      const { data, error } = await insertTreeRecord({
        user_id: user.id,
        project_id: form.project_id || undefined,
        photo_url: primaryPhotoUrl,
        // Store all 3 photo URLs (fall back gracefully if DB column missing)
        ...(uploadedUrls.length > 1 ? { photo_urls: uploadedUrls } : {}),
        latitude: coords.latitude,
        longitude: coords.longitude,
        species: form.species.trim(),
        scientific_name: form.scientific_name.trim() || undefined,
        health_status: form.health_status,
        notes: form.notes.trim() || undefined,
        synced: true,
        event_type: form.event_type,
        quantity: form.quantity,
        tree_id: form.tree_id || undefined,
        dbh_cm: parseFloat(form.dbh_cm) || undefined,
        height_m: parseFloat(form.height_m) || undefined,
        wood_density: parseFloat(form.wood_density) || undefined,
        crown_diameter_m: parseFloat(form.crown_diameter_m) || undefined,
        tree_condition: form.tree_condition,
        multi_stem: form.multi_stem,
        age_years: parseInt(form.age_years) || undefined,
        land_type: form.land_type,
        surveyor: form.surveyor.trim() || undefined,
        survey_date: form.survey_date || undefined,
      });

      if (error || !data) throw new Error(error ?? 'Failed to save tree record');

      // 3. Deduct credit — 1 credit deducted per tree added within the ACTIVE
      //    project (each project has its own 500-credit pool)
      addTree(data);
      const { activeProjectId } = useAuthStore.getState();
      const remainingCredits = computeCreditsForProject(
        useTreeStore.getState().trees,
        activeProjectId
      );
      setUserCredits(remainingCredits);
      // Keep the profile credits column in sync (best-effort, non-blocking)
      syncUserCredits(user.id, remainingCredits);

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

        if (matchingTask && matchingTask.status === 'assigned') {
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

      useProjectRefreshStore.getState().triggerProjectRefresh();
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
      <LinearGradient
        colors={['#123f24', '#1a5c2a', '#2e7d43']}
        style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 8 }]}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerTextCol}>
          <Text style={styles.headerTitle}>Field capture</Text>
          <Text style={styles.headerProjectName} numberOfLines={1}>
            {selectedProject?.name ?? 'All Projects'}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView
        ref={scrollRef}
        style={styles.scrollContent}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 36 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e: any) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
      >
        {/* Photo Preview — all 3 captured photos */}
        <View style={styles.photoSection}>
          <View style={styles.photoGalleryRow}>
            {photoUris.map((uri, idx) => (
              <View key={idx} style={styles.photoThumbWrap}>
                <Image source={{ uri }} style={styles.photoThumb} resizeMode="cover" />
                <View style={styles.photoThumbBadge}>
                  <Text style={styles.photoThumbBadgeText}>Photo {idx + 1}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={styles.photoOverlay}>
            <View style={styles.photoBadge}>
              <Ionicons name="camera" size={14} color="#fff" />
              <Text style={styles.photoBadgeText}>{photoUris.length} Photos Captured</Text>
            </View>
          </View>
        </View>

        {/* Map Preview */}
        <View style={styles.mapSection}>
          <MapPreview coords={coords} height={120} />
        </View>

        {/* Form */}
        <View style={styles.form}>

          {/* ─── SECTION: Tree Identity ─── */}
          <View style={styles.sectionHeader}>
            <Ionicons name="finger-print" size={16} color="#1a5c2a" />
            <Text style={styles.sectionTitle}>Tree Identity</Text>
          </View>

          {/* Tree ID — auto-generated */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>TREE ID</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{form.tree_id}</Text>
            </View>
          </View>

          {/* Common Name (Species) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>COMMON NAME <Text style={styles.required}>· required</Text></Text>
            <TouchableOpacity
              style={styles.speciesInput}
              onPress={() => {
                Keyboard.dismiss();
                setShowSpeciesPicker(!showSpeciesPicker);
              }}
            >
              <Text style={[styles.speciesInputText, !form.species && styles.speciesPlaceholder]}>
                {form.species || 'Select or type a species'}
              </Text>
              <Ionicons name={showSpeciesPicker ? 'chevron-up' : 'chevron-down'} size={18} color="#888" />
            </TouchableOpacity>
            {showSpeciesPicker && (
              <View style={styles.speciesList}>
                <ScrollView
                  style={styles.speciesListScroll}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {TREE_SPECIES.map((sp) => (
                    <TouchableOpacity
                      key={sp}
                      style={[styles.speciesItem, form.species === sp && styles.speciesItemActive]}
                      onPress={() => {
                        setForm({ ...form, species: sp });
                        setShowSpeciesPicker(false);
                      }}
                    >
                      <Text style={[styles.speciesItemText, form.species === sp && styles.speciesItemTextActive]}>
                        {sp}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Scientific Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>SCIENTIFIC NAME <Text style={styles.optional}>· optional</Text></Text>
            <TextInput
              style={styles.textInput}
              value={form.scientific_name}
              onChangeText={(t) => setForm({ ...form, scientific_name: t })}
              placeholder="e.g. Azadirachta indica"
              placeholderTextColor="#aaa"
              onFocus={handleInputFocus}
            />
          </View>

          {/* ─── SECTION: Location ─── */}
          <View style={styles.sectionHeader}>
            <Ionicons name="location" size={16} color="#1a5c2a" />
            <Text style={styles.sectionTitle}>Location</Text>
          </View>

          {/* Lat / Long — read-only from GPS */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>LAT / LONG</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>
                {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
              </Text>
              <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
            </View>
          </View>

          {/* Land Type */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>LAND TYPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventTypeScroll}>
              {LAND_TYPE_OPTIONS.map((lt) => (
                <TouchableOpacity
                  key={lt}
                  style={[styles.eventTypeBtn, form.land_type === lt && styles.eventTypeBtnActive]}
                  onPress={() => setForm({ ...form, land_type: lt })}
                >
                  <Text style={[styles.eventTypeText, form.land_type === lt && styles.eventTypeTextActive]}>
                    {lt}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ─── SECTION: Measurements ─── */}
          <View style={styles.sectionHeader}>
            <Ionicons name="create-outline" size={14} color="#1a5c2a" />
            <Text style={styles.sectionTitle}>Measurements</Text>
          </View>

          {/* 4-column compact grid */}
          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>DBH (CM) <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.measureInput}
                value={form.dbh_cm}
                onChangeText={(t) => setForm({ ...form, dbh_cm: t.replace(/[^0-9.]/g, '') })}
                placeholder="0.0"
                placeholderTextColor="#bbb"
                keyboardType="decimal-pad"
                onFocus={handleInputFocus}
              />
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>HEIGHT (M) <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.measureInput}
                value={form.height_m}
                onChangeText={(t) => setForm({ ...form, height_m: t.replace(/[^0-9.]/g, '') })}
                placeholder="0.0"
                placeholderTextColor="#bbb"
                keyboardType="decimal-pad"
                onFocus={handleInputFocus}
              />
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>DENSITY (G/CM³) <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.measureInput}
                value={form.wood_density}
                onChangeText={(t) => setForm({ ...form, wood_density: t.replace(/[^0-9.]/g, '') })}
                placeholder="0.0"
                placeholderTextColor="#bbb"
                keyboardType="decimal-pad"
                onFocus={handleInputFocus}
              />
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.measureLabel}>CROWN (M)</Text>
              <TextInput
                style={styles.measureInput}
                value={form.crown_diameter_m}
                onChangeText={(t) => setForm({ ...form, crown_diameter_m: t.replace(/[^0-9.]/g, '') })}
                placeholder="0.0"
                placeholderTextColor="#bbb"
                keyboardType="decimal-pad"
                onFocus={handleInputFocus}
              />
            </View>
          </View>

          {/* ─── SECTION: Condition & Metadata ─── */}
          <View style={styles.sectionHeader}>
            <Ionicons name="information-circle" size={16} color="#1a5c2a" />
            <Text style={styles.sectionTitle}>Condition & Metadata</Text>
          </View>

          {/* Tree Condition */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>CONDITION</Text>
            <View style={styles.healthRow}>
              {TREE_CONDITION_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[
                    styles.healthBtn,
                    styles.healthBtnCompact,
                    { borderColor: opt.color },
                    form.tree_condition === opt.label && { backgroundColor: opt.color },
                  ]}
                  onPress={() => setForm({ ...form, tree_condition: opt.label })}
                >
                  <Text style={[
                    styles.healthBtnText,
                    { color: form.tree_condition === opt.label ? '#fff' : opt.color },
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Multi Stem + Age in one row */}
          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>MULTI STEM</Text>
              <View style={styles.multiStemRow}>
                {(['Yes', 'No'] as MultiStemOption[]).map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.multiStemBtn, form.multi_stem === opt && styles.multiStemBtnActive]}
                    onPress={() => setForm({ ...form, multi_stem: opt })}
                  >
                    <Text style={[styles.multiStemBtnText, form.multi_stem === opt && styles.multiStemBtnTextActive]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>AGE (yrs)</Text>
              <TextInput
                style={styles.measureInput}
                value={form.age_years}
                onChangeText={(t) => setForm({ ...form, age_years: t.replace(/[^0-9]/g, '') })}
                placeholder="0"
                placeholderTextColor="#bbb"
                keyboardType="number-pad"
                onFocus={handleInputFocus}
              />
            </View>
          </View>

          {/* Event Type */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>EVENT TYPE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.eventTypeScroll}
            >
              {EVENT_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.eventTypeBtn, form.event_type === type && styles.eventTypeBtnActive]}
                  onPress={() => setForm({ ...form, event_type: type })}
                >
                  <Text style={[styles.eventTypeText, form.event_type === type && styles.eventTypeTextActive]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Surveyor + Date in one row */}
          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>SURVEYOR</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{form.surveyor || '—'}</Text>
              </View>
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>DATE</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{form.survey_date || '—'}</Text>
              </View>
            </View>
          </View>

          {/* Notes */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>NOTE <Text style={styles.optional}>· optional</Text></Text>
            <TouchableOpacity
              style={styles.notesInput}
              onPress={() => { Keyboard.dismiss(); setShowNoteHelper(true); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.notesInputText, !form.notes && styles.speciesPlaceholder]}>
                {form.notes || 'Tap to add a note...'}
              </Text>
              <Ionicons name="pencil" size={14} color="#888" />
            </TouchableOpacity>
          </View>

          {/* Note Helper Modal */}
          <Modal
            visible={showNoteHelper}
            transparent
            animationType="slide"
            onRequestClose={() => setShowNoteHelper(false)}
          >
            <View style={styles.modalBackdrop}>
              <TouchableOpacity
                style={styles.modalBackdropTouch}
                activeOpacity={1}
                onPress={() => setShowNoteHelper(false)}
              />
              <View style={styles.noteModalSheet}>
                <View style={styles.noteModalHeader}>
                  <Text style={styles.noteModalTitle}>Add Note</Text>
                  <TouchableOpacity onPress={() => setShowNoteHelper(false)}>
                    <Ionicons name="close" size={22} color="#333" />
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={styles.noteModalInput}
                  value={form.notes}
                  onChangeText={(t) => setForm({ ...form, notes: t })}
                  multiline
                  numberOfLines={4}
                  placeholder="Type your note here..."
                  placeholderTextColor="#aaa"
                  textAlignVertical="top"
                  autoFocus
                />

                <Text style={styles.noteSuggestionLabel}>Quick suggestions:</Text>
                <View style={styles.noteSuggestionChips}>
                  {[
                    'Tree near water source',
                    'Needs pruning',
                    'Pest damage visible',
                    'Good canopy cover',
                    'New sapling',
                    'Marked for removal',
                    'Fence nearby',
                    'Irrigation required',
                  ].map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={styles.noteChip}
                      onPress={() => {
                        const sep = form.notes.trim() ? '\n' : '';
                        setForm({ ...form, notes: form.notes + sep + s });
                      }}
                    >
                      <Text style={styles.noteChipText}>{s}</Text>
                      <Ionicons name="add-circle" size={14} color="#1a5c2a" />
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={styles.noteDoneBtn}
                  onPress={() => setShowNoteHelper(false)}
                >
                  <Text style={styles.noteDoneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Low Accuracy Warning */}
          {coords && coords.accuracy && coords.accuracy > 50 && (
            <View style={styles.accuracyWarning}>
              <View style={styles.accuracyDot} />
              <Text style={styles.accuracyText}>
                <Text style={{ fontWeight: '700' }}>Location is approximate</Text> — that's fine, we've noted it. Your capture saves and is flagged for review, never blocked.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Save Button */}
      <View style={[styles.saveSection, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <TouchableOpacity
          style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          <Ionicons name="checkmark-circle" size={20} color="#112121" />
          <Text style={styles.saveBtnText}>
            {submitting ? 'Submitting...' : 'Save capture'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 14,
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
  headerTextCol: {
    flex: 1,
    alignItems: 'flex-start',
    marginLeft: 10,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  headerProjectName: {
    color: '#cde8d3',
    fontSize: 12,
    marginTop: 2,
  },
  headerCredits: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    minWidth: 48,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
  // Photo Section — 3-photo gallery
  photoSection: {
    backgroundColor: '#0D1A17',
    position: 'relative',
  },
  photoGalleryRow: {
    flexDirection: 'row',
    height: 160,
  },
  photoThumbWrap: {
    flex: 1,
    position: 'relative',
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,0,0,0.3)',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  photoThumbBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  photoThumbBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  photoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
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
    borderRadius: 14,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  readOnlyText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    flex: 1,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
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
    borderRadius: 14,
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
    borderRadius: 14,
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
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
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
    borderRadius: 14,
    overflow: 'hidden',
    maxHeight: 240,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  // Internal scroll area of the species dropdown — every name stays reachable
  speciesListScroll: {
    flexGrow: 0,
  },
  speciesItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
    borderRadius: 14,
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
    borderRadius: 14,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
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
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
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
    borderRadius: 14,
    overflow: 'hidden',
    maxHeight: 220,
    backgroundColor: '#fff',
    marginTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
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
    borderRadius: 14,
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
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '70%',
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
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
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: '#1a1a1a',
    backgroundColor: '#f9fdf8',
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
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
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  noteChipText: {
    fontSize: 12,
    color: '#1a5c2a',
    fontWeight: '500',
  },
  noteDoneBtn: {
    backgroundColor: '#1a5c2a',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
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
    borderRadius: 14,
    padding: 12,
    shadowColor: '#EF9F27',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  accuracyDot: {
    width: 10,
    height: 10,
    borderRadius: 14,
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
    borderTopColor: '#E8F5E9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 8,
  },
  saveBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F09125',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#F09125',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
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
