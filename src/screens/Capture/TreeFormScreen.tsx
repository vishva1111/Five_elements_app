import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { TextInput, Button } from 'react-native-paper';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  CaptureStackParamList,
  TreeFormData,
  HealthStatus,
  TREE_SPECIES,
  HEALTH_STATUS_OPTIONS,
} from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { insertTreeRecord } from '../../services/treeService';
import { uploadTreePhoto } from '../../services/storageService';
import { fetchProjects } from '../../services/treeService';
import MapPreview from '../../components/MapPreview';

type Nav = NativeStackNavigationProp<CaptureStackParamList, 'TreeForm'>;
type Route = RouteProp<CaptureStackParamList, 'TreeForm'>;

export default function TreeFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { photoUri, coords } = route.params;
  const { user } = useAuthStore();
  const { addTree } = useTreeStore();

  const [form, setForm] = useState<TreeFormData>({
    species: '',
    health_status: 'healthy',
    notes: '',
    project_id: '',
  });
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [showSpeciesPicker, setShowSpeciesPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchProjects().then(({ data }) => {
      if (data) setProjects(data as { id: string; name: string }[]);
    });
  }, []);

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

      // 2. Insert tree record
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
      });

      if (error || !data) throw new Error(error ?? 'Failed to save tree record');

      addTree(data);
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
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🌳 Tree Details</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.content}>
        {/* Photo Preview */}
        <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />

        {/* Map Preview */}
        <MapPreview coords={coords} height={140} />

        {/* Form */}
        <View style={styles.form}>
          {/* Species */}
          <Text style={styles.label}>Tree Species *</Text>
          <TouchableOpacity
            style={styles.picker}
            onPress={() => setShowSpeciesPicker(!showSpeciesPicker)}
          >
            <Text style={[styles.pickerText, !form.species && styles.pickerPlaceholder]}>
              {form.species || 'Select species...'}
            </Text>
            <Ionicons name={showSpeciesPicker ? 'chevron-up' : 'chevron-down'} size={18} color="#888" />
          </TouchableOpacity>

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

          {/* Health Status */}
          <Text style={styles.label}>Health Status *</Text>
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
                <Text style={styles.healthBtnEmoji}>{opt.label === 'Healthy' ? '✅' : opt.label === 'Sick' ? '⚠️' : opt.label === 'Dead' ? '❌' : '❓'}</Text>
                <Text style={[
                  styles.healthBtnText,
                  { color: form.health_status === opt.value ? '#fff' : opt.color },
                ]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Project */}
          {projects.length > 0 && (
            <>
              <Text style={styles.label}>Project (Optional)</Text>
              <View style={styles.projectRow}>
                <TouchableOpacity
                  style={[styles.projectBtn, !form.project_id && styles.projectBtnActive]}
                  onPress={() => setForm({ ...form, project_id: '' })}
                >
                  <Text style={[styles.projectBtnText, !form.project_id && styles.projectBtnTextActive]}>
                    None
                  </Text>
                </TouchableOpacity>
                {projects.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.projectBtn, form.project_id === p.id && styles.projectBtnActive]}
                    onPress={() => setForm({ ...form, project_id: p.id })}
                  >
                    <Text style={[styles.projectBtnText, form.project_id === p.id && styles.projectBtnTextActive]}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Notes */}
          <Text style={styles.label}>Notes (Optional)</Text>
          <TextInput
            value={form.notes}
            onChangeText={(t) => setForm({ ...form, notes: t })}
            mode="outlined"
            multiline
            numberOfLines={3}
            placeholder="Observations, condition details..."
            style={styles.notesInput}
            outlineColor="#ddd"
            activeOutlineColor="#1a5c2a"
          />

          {/* Submit */}
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            style={styles.submitBtn}
            contentStyle={styles.submitBtnContent}
            buttonColor="#1a5c2a"
            icon="check-circle"
          >
            {submitting ? 'Submitting...' : 'Submit Tree Record'}
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a5c2a',
    paddingTop: 52,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  photo: { width: '100%', height: 200, borderRadius: 12 },
  form: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginTop: 8, marginBottom: 4 },
  picker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fafafa',
  },
  pickerText: { fontSize: 15, color: '#333' },
  pickerPlaceholder: { color: '#aaa' },
  speciesList: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    overflow: 'hidden',
    maxHeight: 220,
  },
  speciesItem: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  speciesItemActive: { backgroundColor: '#e8f5e9' },
  speciesItemText: { fontSize: 14, color: '#333' },
  speciesItemTextActive: { color: '#1a5c2a', fontWeight: '600' },
  healthRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  healthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
  },
  healthBtnEmoji: { fontSize: 14 },
  healthBtnText: { fontSize: 13, fontWeight: '600' },
  projectRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  projectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  projectBtnActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  projectBtnText: { fontSize: 13, color: '#555' },
  projectBtnTextActive: { color: '#fff', fontWeight: '600' },
  notesInput: { backgroundColor: '#fff', fontSize: 14 },
  submitBtn: { marginTop: 16, borderRadius: 12 },
  submitBtnContent: { paddingVertical: 6 },
});