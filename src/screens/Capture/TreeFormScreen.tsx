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
import {
  CaptureStackParamList,
  TreeFormData,
  TREE_SPECIES,
  HEALTH_STATUS_OPTIONS,
  EVENT_TYPES,
} from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { insertTreeRecord, syncUserCredits, computeCreditsForProject, fetchAllProjects } from '../../services/treeService';
import { Project } from '../../types';
import { uploadTreePhoto } from '../../services/storageService';
import MapPreview from '../../components/MapPreview';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'TreeForm'>;
type Route = RouteProp<CaptureStackParamList, 'TreeForm'>;

export default function TreeFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { photoUri, coords } = route.params;
  const { user, activeProjectId, setUserCredits } = useAuthStore();
  const { addTree, trees } = useTreeStore();
  const [allProjects, setAllProjects] = useState<Project[]>([]);

  // Auto-select the active project
  const [form, setForm] = useState<TreeFormData>({
    species: '',
    health_status: 'healthy',
    notes: '',
    project_id: activeProjectId ?? '',
    event_type: 'Planting',
    quantity: 200,
  });
  const [showSpeciesPicker, setShowSpeciesPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Refs used to keep the NOTE field visible above the keyboard while typing
  const scrollRef = useRef<ScrollView>(null);
  const notesFieldRef = useRef<TextInput>(null);
  const scrollOffsetRef = useRef(0);
  const windowHRef = useRef(Dimensions.get('window').height);

  // Scroll the page so the NOTE field sits fully above the keyboard. Uses the
  // ACTUAL measured keyboard height (instead of a hardcoded guess) and handles
  // both iOS "padding" and Android "adjustResize" so the field is never hidden.
  const bringNotesAboveKeyboard = (kb?: number) => {
    const scroll = scrollRef.current;
    const input = notesFieldRef.current;
    if (!scroll || !input) return;
    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const winH = Dimensions.get('window').height;
      // If the OS already shrank the window (adjustResize), the keyboard is
      // excluded from winH; otherwise subtract the measured keyboard height.
      const resized = winH < windowHRef.current - 20;
      const visibleBottom = resized ? winH : winH - (kb ?? 300);
      const overflow = y + h + 16 - visibleBottom;
      if (overflow > 0) {
        scroll.scrollTo({ y: scrollOffsetRef.current + overflow, animated: true });
      }
    });
  };

  const handleNotesFocus = () => {
    // Close the species dropdown so it never sits over the keyboard
    setShowSpeciesPicker(false);
    // Scroll a few times so the NOTE field ends up visible after the layout
    // settles on every device
    setTimeout(() => bringNotesAboveKeyboard(), 150);
    setTimeout(() => bringNotesAboveKeyboard(), 500);
  };

  // Whenever the keyboard opens while the NOTE field is focused, re-scroll so
  // the field (and what you type) stays visible using the REAL keyboard height
  useEffect(() => {
    const willShow = Keyboard.addListener('keyboardWillShow', (e) => {
      setTimeout(() => bringNotesAboveKeyboard(e.endCoordinates.height), 150);
      setTimeout(() => bringNotesAboveKeyboard(e.endCoordinates.height), 500);
    });
    const didShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setTimeout(() => bringNotesAboveKeyboard(e.endCoordinates.height), 150);
      setTimeout(() => bringNotesAboveKeyboard(e.endCoordinates.height), 450);
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
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  const projects = allProjects;
  const selectedProject = projects.find((p) => p.id === form.project_id);

  const handleSubmit = async () => {
    if (!form.species.trim()) {
      Alert.alert('Required', 'Please select or enter a tree species.');
      return;
    }
    if (!user) return;

    setSubmitting(true);
    try {
      // 1. Upload photo
      const photoUrl = await uploadTreePhoto(photoUri, user.id);
      if (!photoUrl) throw new Error('Photo upload failed');

      // 2. Insert tree record (includes event_type and quantity)
      const { data, error } = await insertTreeRecord({
        user_id: user.id,
        project_id: form.project_id || undefined,
        photo_url: photoUrl,
        latitude: coords.latitude,
        longitude: coords.longitude,
        species: form.species.trim(),
        health_status: form.health_status,
        notes: form.notes.trim() || undefined,
        synced: true,
        event_type: form.event_type,
        quantity: form.quantity,
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Field capture</Text>
        <View
          style={[
            styles.headerCredits,
            user?.credits !== undefined && user.credits <= 3 && styles.headerCreditsLow,
          ]}
        >
          <Ionicons
            name="wallet-outline"
            size={14}
            color={user?.credits !== undefined && user.credits <= 3 ? '#fff' : '#1a5c2a'}
          />
          <Text
            style={[
              styles.headerCreditsText,
              user?.credits !== undefined && user.credits <= 3 && styles.headerCreditsLowText,
            ]}
          >
            {user?.credits ?? 0}
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e: any) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
      >
        {/* Photo Preview */}
        <View style={styles.photoSection}>
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          <View style={styles.photoOverlay}>
            <View style={styles.photoBadge}>
              <Ionicons name="camera" size={14} color="#fff" />
              <Text style={styles.photoBadgeText}>Captured</Text>
            </View>
          </View>
        </View>

        {/* Map Preview */}
        <View style={styles.mapSection}>
          <MapPreview coords={coords} height={120} />
        </View>

        {/* Form */}
        <View style={styles.form}>
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

          {/* Quantity */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>QUANTITY</Text>
            <View style={styles.quantityRow}>
              <TouchableOpacity
                style={styles.quantityBtn}
                onPress={() => setForm({ ...form, quantity: Math.max(1, form.quantity - 10) })}
              >
                <Text style={styles.quantityBtnText}>-</Text>
              </TouchableOpacity>
              <View style={styles.quantityDisplay}>
                <Text style={styles.quantityValue}>{form.quantity}</Text>
                <Text style={styles.quantityUnit}>saplings</Text>
              </View>
              <TouchableOpacity
                style={styles.quantityBtn}
                onPress={() => setForm({ ...form, quantity: form.quantity + 10 })}
              >
                <Text style={styles.quantityBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Species */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>SPECIES <Text style={styles.required}>· required</Text></Text>
            <TouchableOpacity
              style={styles.speciesInput}
              onPress={() => {
                Keyboard.dismiss(); // keep the keyboard from covering the list
                setShowSpeciesPicker(!showSpeciesPicker);
              }}
            >
              <Text style={[styles.speciesInputText, !form.species && styles.speciesPlaceholder]}>
                {form.species || 'Type a species — free text works offline'}
              </Text>
              <Ionicons name={showSpeciesPicker ? 'chevron-up' : 'chevron-down'} size={18} color="#888" />
            </TouchableOpacity>

            {/* Species Picker List — internally scrollable so every name is reachable */}
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

          {/* Health Status */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>HEALTH STATUS</Text>
            <View style={styles.healthRow}>
              {HEALTH_STATUS_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.healthBtn,
                    { borderColor: opt.color },
                    form.health_status === opt.value && { backgroundColor: opt.color },
                  ]}
                  onPress={() => setForm({ ...form, health_status: opt.value })}
                >
                  <Text style={[
                    styles.healthBtnText,
                    { color: form.health_status === opt.value ? '#fff' : opt.color },
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Project — shows active project as pre-selected */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>PROJECT</Text>
            {projects.length > 0 ? (
              <>
                <TouchableOpacity
                  style={styles.projectDropdownTrigger}
                  onPress={() => {
                    Keyboard.dismiss(); // keep the keyboard from covering the list
                    setShowProjectDropdown(!showProjectDropdown);
                  }}
                >
                  <View style={styles.projectDropdownLeft}>
                    <Ionicons name="folder" size={18} color="#1a5c2a" />
                    <Text
                      style={styles.projectDropdownText}
                      numberOfLines={1}
                    >
                      {selectedProject?.name ?? 'Select a project'}
                    </Text>
                  </View>
                  <Ionicons name={showProjectDropdown ? 'chevron-up' : 'chevron-down'} size={18} color="#888" />
                </TouchableOpacity>

                {showProjectDropdown && (
                  <View style={styles.projectDropdownList}>
                    <ScrollView
                      style={styles.projectDropdownScroll}
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="handled"
                    >
                      {projects.map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          style={[
                            styles.projectDropdownItem,
                            form.project_id === p.id && styles.projectDropdownItemActive,
                          ]}
                          onPress={() => {
                            setForm({ ...form, project_id: p.id });
                            setShowProjectDropdown(false);
                          }}
                        >
                          <View style={styles.projectDropdownLeft}>
                            <Ionicons
                              name="folder"
                              size={18}
                              color={form.project_id === p.id ? '#1a5c2a' : '#8AA08F'}
                            />
                            <Text
                              style={[
                                styles.projectDropdownItemText,
                                form.project_id === p.id && styles.projectDropdownItemTextActive,
                              ]}
                              numberOfLines={1}
                            >
                              {p.name}
                            </Text>
                          </View>
                          {form.project_id === p.id && (
                            <Ionicons name="checkmark-circle" size={18} color="#1a5c2a" />
                          )}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noProjectsInfo}>
                <Ionicons name="information-circle-outline" size={18} color="#6B7B6E" />
                <Text style={styles.noProjectsInfoText}>
                  No projects available. You can still capture trees without selecting a project.
                </Text>              </View>
            )}
          </View>

          {/* Notes */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>NOTE <Text style={styles.optional}>· optional</Text></Text>
            <TextInput
              ref={notesFieldRef}
              style={styles.notesInput}
              value={form.notes}
              onChangeText={(t) => setForm({ ...form, notes: t })}
              onFocus={handleNotesFocus}
              onSelectionChange={() => {
                // While writing, keep the NOTE field above the keyboard at all
                // times — as the note grows to more lines, the page follows it
                // so the field and the keypad are visible at the same time
                setTimeout(() => bringNotesAboveKeyboard(), 100);
              }}
              multiline
              numberOfLines={3}
              placeholder="Anything the reviewer should know"
              placeholderTextColor="#aaa"
              textAlignVertical="top"
            />
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
        </View>
      </ScrollView>

      {/* Save Button */}
      <View style={styles.saveSection}>
        <TouchableOpacity
          style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting || (user?.credits ?? 0) <= 0}
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
    backgroundColor: '#1a5c2a',
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 14,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
    textTransform: 'uppercase',
    textAlign: 'center',
    flex: 1,
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
    height: 200,
    backgroundColor: '#0D1A17',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  photoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7.5,
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
  // Event Type
  eventTypeScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  eventTypeBtn: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 7.5,
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
    fontSize: 15,
    backgroundColor: '#fff',
    minHeight: 80,
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
