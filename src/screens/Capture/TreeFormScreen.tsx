import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  CaptureStackParamList,
  TreeFormData,
  HealthStatus,
  TREE_SPECIES,
  HEALTH_STATUS_OPTIONS,
  EVENT_TYPES,
  EventType,
} from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { insertTreeRecord, syncUserCredits, computeCredits } from '../../services/treeService';
import { uploadTreePhoto } from '../../services/storageService';
import MapPreview from '../../components/MapPreview';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'TreeForm'>;
type Route = RouteProp<CaptureStackParamList, 'TreeForm'>;

const SPECIES_SUGGESTIONS = [
  'Rhizophora mucronata',
  'Avicennia marina',
  'Ceriops tagal',
];

export default function TreeFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { photoUri, coords } = route.params;
  const { user, assignedProjects, setUserCredits } = useAuthStore();
  const { addTree } = useTreeStore();

  const [form, setForm] = useState<TreeFormData>({
    species: '',
    health_status: 'healthy',
    notes: '',
    project_id: '',
    event_type: 'Planting',
    quantity: 200,
  });
  const [showSpeciesPicker, setShowSpeciesPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Use assigned projects from auth store (project-level access control)
  const projects = assignedProjects;

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

      // 3. Deduct credit — 1 credit deducted per tree added within the selected
      //    projects (balance starts at the 500 credits given to every user)
      addTree(data);
      // Credits = 500 given credits minus trees added in the projects selected at login
      const { assignedProjects } = useAuthStore.getState();
      const remainingCredits = computeCredits(
        useTreeStore.getState().trees,
        assignedProjects
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Field capture</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Credit Banner */}
      <View style={styles.creditBanner}>
        <Ionicons name="wallet-outline" size={18} color="#1a5c2a" />
        <Text style={styles.creditText}>
          Credits: <Text style={styles.creditCount}>{user?.credits ?? 0}</Text>
        </Text>
        {user?.credits !== undefined && user.credits <= 3 && (
          <Text style={styles.creditWarning}>
            {user.credits === 0 ? 'No credits!' : `Only ${user.credits} left`}
          </Text>
        )}
      </View>

      <ScrollView style={styles.scrollContent} keyboardShouldPersistTaps="handled">
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
              onPress={() => setShowSpeciesPicker(!showSpeciesPicker)}
            >
              <Text style={[styles.speciesInputText, !form.species && styles.speciesPlaceholder]}>
                {form.species || 'Type a species — free text works offline'}
              </Text>
              <Ionicons name={showSpeciesPicker ? 'chevron-up' : 'chevron-down'} size={18} color="#888" />
            </TouchableOpacity>

            {/* Species Suggestions */}
            <View style={styles.speciesSuggestions}>
              {SPECIES_SUGGESTIONS.map((sp) => (
                <TouchableOpacity
                  key={sp}
                  style={[styles.speciesChip, form.species === sp && styles.speciesChipActive]}
                  onPress={() => {
                    setForm({ ...form, species: sp });
                    setShowSpeciesPicker(false);
                  }}
                >
                  <Text style={[styles.speciesChipText, form.species === sp && styles.speciesChipTextActive]}>
                    {sp}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Species Picker List */}
            {showSpeciesPicker && (
              <View style={styles.speciesList}>
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

          {/* Project */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>PROJECT</Text>
            {projects.length > 0 ? (
              <View style={styles.projectList}>
                {projects.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.projectBtn, form.project_id === p.id && styles.projectBtnActive]}
                    onPress={() => setForm({ ...form, project_id: p.id })}
                  >
                    <View style={styles.projectBtnLeft}>
                      <Ionicons name="folder" size={18} color={form.project_id === p.id ? '#fff' : '#2B5341'} />
                      <Text style={[styles.projectBtnText, form.project_id === p.id && styles.projectBtnTextActive]}>
                        {p.name}
                      </Text>
                    </View>
                    {form.project_id === p.id && (
                      <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.noProjectsInfo}>
                <Ionicons name="information-circle-outline" size={18} color="#6B7B6E" />
                <Text style={styles.noProjectsInfoText}>
                  No projects available. You can still capture trees without selecting a project.
                </Text>
              </View>
            )}
          </View>

          {/* Notes */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>NOTE <Text style={styles.optional}>· optional</Text></Text>
            <TextInput
              style={styles.notesInput}
              value={form.notes}
              onChangeText={(t) => setForm({ ...form, notes: t })}
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
          style={[styles.saveBtn, (submitting || (projects.length > 0 && !form.project_id)) && styles.saveBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting || (user?.credits ?? 0) <= 0 || (projects.length > 0 && !form.project_id)}
        >
          <Ionicons name="checkmark-circle" size={22} color="#112121" />
          <Text style={styles.saveBtnText}>
            {submitting ? 'Submitting...' : 'Save capture'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.saveHint}>
          Saves to this device instantly — even with no signal.
        </Text>
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
    justifyContent: 'space-between',
    backgroundColor: '#2B5341',
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
    fontSize: 16,
    fontWeight: '700',
  },
  // Credit Banner
  creditBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#C8E6C9',
  },
  creditText: {
    fontSize: 13,
    color: '#1a5c2a',
    flex: 1,
  },
  creditCount: {
    fontWeight: '700',
    fontSize: 15,
  },
  creditWarning: {
    color: '#8B3A00',
    fontSize: 11,
    fontWeight: '600',
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
    borderRadius: 12,
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
    borderRadius: 12,
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
    color: '#2B5341',
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
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#AACBA7',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventTypeBtnActive: {
    backgroundColor: '#2B5341',
    borderColor: '#2B5341',
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
    borderColor: '#2B5341',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityBtnText: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2B5341',
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
  },
  speciesInputText: {
    fontSize: 15,
    color: '#112121',
    flex: 1,
  },
  speciesPlaceholder: {
    color: '#aaa',
  },
  speciesSuggestions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  speciesChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#AACBA7',
    backgroundColor: '#EAF3DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speciesChipActive: {
    backgroundColor: '#2B5341',
    borderColor: '#2B5341',
  },
  speciesChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#27500A',
  },
  speciesChipTextActive: {
    color: '#fff',
  },
  speciesList: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    overflow: 'hidden',
    maxHeight: 200,
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
    color: '#2B5341',
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
    borderRadius: 20,
    borderWidth: 2,
  },
  healthBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Project
  projectList: {
    gap: 8,
  },
  projectBtn: {
    height: 56,
    borderWidth: 1.5,
    borderColor: '#AACBA7',
    borderRadius: 14,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  projectBtnActive: {
    backgroundColor: '#2B5341',
    borderColor: '#2B5341',
  },
  projectBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  projectBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#112121',
    flex: 1,
  },
  projectBtnTextActive: {
    color: '#fff',
  },
  noProjectsWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#FEF0E3',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EF9F27',
  },
  noProjectsText: {
    fontSize: 13,
    color: '#8B3A00',
    flex: 1,
  },
  noProjectsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  noProjectsInfoText: {
    fontSize: 13,
    color: '#6B7B6E',
    flex: 1,
    lineHeight: 18,
  },
  // Notes
  notesInput: {
    borderWidth: 1.5,
    borderColor: '#AACBA7',
    borderRadius: 14,
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
    borderRadius: 12,
    padding: 12,
  },
  accuracyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
    padding: 16,
    paddingBottom: 24,
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
    height: 60,
    borderRadius: 16,
    backgroundColor: '#F09125',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
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
    fontSize: 18,
    fontWeight: '700',
    color: '#112121',
  },
  saveHint: {
    textAlign: 'center',
    fontSize: 12,
    color: '#6B7B6E',
    marginTop: 8,
  },
});
