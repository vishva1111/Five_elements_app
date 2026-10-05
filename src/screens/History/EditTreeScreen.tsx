import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TreeRecord, TreeCondition, LandType, EventType, MultiStemOption } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { fetchTreeById, updateBaselineTree, fetchTreeMonitoringRecords, fetchUserProfile, updateStoredAudit } from '../../services/treeService';
import { useTreeStore } from '../../store/treeStore';
import { submitAudit } from '../../services/auditService';
import { completeTask } from '../../services/taskService';
import { useTaskStore } from '../../store/taskStore';
import { uploadTreePhoto } from '../../services/storageService';
import { useProjectRefreshStore } from '../../store/projectRefreshStore';
import { uiTreeId, stripTreeMeta, parseTreeMeta } from '../../utils/treeId';

const REQUIRED_PHOTOS = 3;

const LAND_TYPES: LandType[] = [
  'Roadside',
  'Park',
  'Residential',
  'Institutional',
  'Forest',
  'Other',
];

const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#16a34a',
  Stressed: '#d97706',
  Diseased: '#dc2626',
  Dead: '#4b5563',
};

const SLOT_CONFIG = [
  { label: 'Front View', short: 'Front' },
  { label: 'Side View', short: 'Side' },
  { label: 'Close-up', short: 'Close-up' },
];

export default function EditTreeScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { treeId, taskId, rejectionNotes, auditRound } = route.params || {};
  const isAudit = Number(auditRound) > 0;
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tree, setTree] = useState<TreeRecord | null>(null);
  const [surveyDate, setSurveyDate] = useState('');
  const [loadedAuditRound, setLoadedAuditRound] = useState<number | null>(null);

  // Form Fields
  const [species, setSpecies] = useState('');
  const [scientificName, setScientificName] = useState('');
  const [eventType, setEventType] = useState<EventType>('Planting');
  const [quantity, setQuantity] = useState('1');
  // 3-photo array: can contain remote URLs or local file URIs
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [treeCondition, setTreeCondition] = useState<TreeCondition>('Healthy');
  const [dbhCm, setDbhCm] = useState('');
  const [heightM, setHeightM] = useState('');
  const [woodDensity, setWoodDensity] = useState('');
  const [crownDiam, setCrownDiam] = useState('');
  const [ageYears, setAgeYears] = useState('');
  const [multiStem, setMultiStem] = useState<MultiStemOption>('No');
  const [landType, setLandType] = useState<LandType>('Roadside');
  const [notes, setNotes] = useState('');
  const [fieldSurveyor, setFieldSurveyor] = useState(user?.full_name || '');

  // The field surveyor is always the signed-in app user, never a typed name.
  useEffect(() => {
    let active = true;
    (async () => {
      const state = useAuthStore.getState();
      const sessionUser = state.session?.user;
      const metadata = sessionUser?.user_metadata || {};
      const userId = user?.id || sessionUser?.id;
      let name = String(
        user?.full_name || metadata.full_name || metadata.name || metadata.display_name || ''
      ).trim();
      if (userId) {
        const profileRes = await fetchUserProfile(userId);
        const profile = profileRes.data as any;
        name = String(
          profile?.display_name || profile?.full_name || profile?.name || name || ''
        ).trim();
      }
      if (!name) {
        const email = user?.email || sessionUser?.email || '';
        name = email.includes('@') ? email.split('@')[0] : email;
      }
      if (active && name) setFieldSurveyor(name);
    })();
    return () => {
      active = false;
    };
  }, [user?.id, user?.full_name, user?.email]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!treeId) return;
      setLoading(true);
      const res = await fetchTreeById(treeId);
      if (active && res.data) {
        const t = res.data;
        setTree(t);
        setSpecies(t.species || '');
        setScientificName(t.scientific_name || '');
        setEventType((t.event_type as EventType) || 'Planting');
        setQuantity(t.quantity ? String(t.quantity) : '1');
        setWoodDensity(t.wood_density ? String(t.wood_density) : '');
        setCrownDiam(t.crown_diameter_m ? String(t.crown_diameter_m) : '');
        setAgeYears(t.age_years ? String(t.age_years) : '');
        setMultiStem((t.multi_stem as MultiStemOption) || 'No');

        if (!isAudit && t.photo_urls && t.photo_urls.length > 0) {
          const urls = t.photo_urls;
          setPhotos([urls[0] ?? null, urls[1] ?? null, urls[2] ?? null]);
        } else if (!isAudit && t.photo_url) {
          setPhotos([t.photo_url, null, null]);
        }

        setTreeCondition((t.tree_condition as TreeCondition) || 'Healthy');
        setDbhCm(t.dbh_cm ? String(t.dbh_cm) : '');
        setHeightM(t.height_m ? String(t.height_m) : '');
        setLandType((t.land_type as LandType) || 'Roadside');
        setSurveyDate(t.survey_date || '');
        // Clean notes without internal ##META## json
        setNotes(stripTreeMeta(t.notes) || '');

        // A rejected audit must reopen that same visit, not the planting values
        // and not a blank next-round form.
        try {
          const monitoring = await fetchTreeMonitoringRecords(t.id);
          const auditRows = (monitoring.data ?? [])
            .filter((row) => Number(row?.monitoring_round) >= 1)
            .sort((a, b) => Number(a.monitoring_round) - Number(b.monitoring_round));
          const savedAudit = isAudit
            ? auditRows.find((row) => Number(row.monitoring_round) === Number(auditRound))
            : auditRows[0];
          if (savedAudit) {
            setLoadedAuditRound(Number(savedAudit.monitoring_round) || 1);
            const urls = Array.isArray(savedAudit.photo_urls) && savedAudit.photo_urls.length > 0
              ? savedAudit.photo_urls
              : savedAudit.photo_url
              ? [savedAudit.photo_url]
              : null;
            if (urls) setPhotos([urls[0] ?? null, urls[1] ?? null, urls[2] ?? null]);
            if (savedAudit.tree_condition) setTreeCondition(savedAudit.tree_condition as TreeCondition);
            if (savedAudit.dbh_cm != null && savedAudit.dbh_cm !== '') setDbhCm(String(savedAudit.dbh_cm));
            if (savedAudit.height_m != null && savedAudit.height_m !== '') setHeightM(String(savedAudit.height_m));
            if (savedAudit.crown_diameter_m != null && savedAudit.crown_diameter_m !== '') {
              setCrownDiam(String(savedAudit.crown_diameter_m));
            }
            if (savedAudit.land_type) setLandType(savedAudit.land_type as LandType);
            if (savedAudit.notes) setNotes(stripTreeMeta(String(savedAudit.notes)) || '');
            if (savedAudit.survey_date) setSurveyDate(String(savedAudit.survey_date).slice(0, 10));
          }
        } catch (auditLoadError) {
          console.warn('[EditTree] audit load:', auditLoadError);
        }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [treeId, isAudit, auditRound]);

  // Direct camera capture for the selected slot (tap to shoot or tap to retake)
  const handleTakePhotoSlot = async (slot: number) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Camera permission is required to capture photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhotos((prev) => {
        const next = [...prev];
        next[slot] = result.assets[0].uri;
        return next;
      });
    }
  };

  const handleSave = async () => {
    if (!treeId) return;

    const filledPhotos = photos.filter(Boolean) as string[];
    if (filledPhotos.length < REQUIRED_PHOTOS) {
      Alert.alert(
        '3 Photos Required',
        `Please provide all ${REQUIRED_PHOTOS} photos for the tree record.\n\nTap an empty slot to take a photo.`
      );
      return;
    }

    setSubmitting(true);
    try {
      // Upload any local file URIs. Remote (already hosted) URLs pass through —
      // submitAudit keeps them as-is so the record retains all 3 photos.
      const finalPhotoUrls: string[] = [];
      for (const p of filledPhotos) {
        if (p.startsWith('http://') || p.startsWith('https://')) {
          finalPhotoUrls.push(p);
        } else if (user?.id) {
          const uploaded = await uploadTreePhoto(p, user.id);
          if (uploaded) {
            finalPhotoUrls.push(uploaded);
          } else {
            throw new Error('Failed to upload one of the photos. Please try again.');
          }
        } else {
          finalPhotoUrls.push(p);
        }
      }

      // The photo_urls column may not exist in this database yet — the insert
      // path then keeps the 3-photo array inside the notes ##META## blob, and
      // updateTreeColumns would silently drop the column write. Re-attach the
      // array to the notes we save (and keep the legacy meta tree_id) so an
      // edit can never delete photos 2 & 3.
      const oldMeta = parseTreeMeta(tree?.notes);
      const keptMeta: Record<string, any> = {};
      if (oldMeta.tree_id) keptMeta.tree_id = oldMeta.tree_id;
      keptMeta.photo_urls = finalPhotoUrls;
      const notesWithMeta = `${notes.trim()}\n##META##${JSON.stringify(keptMeta)}`.trim();

      const actionDate = new Date().toISOString().slice(0, 10);
      const updates: any = {
        land_type: landType,
        notes: notesWithMeta,
        photo_url: finalPhotoUrls[0],
        // Keep the 3-photo set in sync so the tree details slider shows them all
        photo_urls: finalPhotoUrls,
        surveyor: fieldSurveyor || undefined,
        survey_date: actionDate,
      };

      if (isAudit && tree && user?.id) {
        const result = await submitAudit({
          tree,
          round: Number(auditRound),
          userId: user.id,
          projectId: tree.project_id,
          // Pass the full 3-photo set (already uploaded above) — first becomes
          // photo_url, all are stored in photo_urls for the details slider
          photoUris: finalPhotoUrls,
          dbhCm: dbhCm && !isNaN(Number(dbhCm)) ? Number(dbhCm) : null,
          heightM: heightM && !isNaN(Number(heightM)) ? Number(heightM) : null,
          crownDiameterM: crownDiam && !isNaN(Number(crownDiam)) ? Number(crownDiam) : null,
          woodDensity: woodDensity && !isNaN(Number(woodDensity)) ? Number(woodDensity) : null,
          ageYears: ageYears && !isNaN(Number(ageYears)) ? Number(ageYears) : null,
          multiStem,
          treeCondition,
          notes,
          surveyor: fieldSurveyor,
        });
        if (!result.ok) {
          Alert.alert('Save Failed', result.error || 'The audit could not be saved.');
          return;
        }
        const tasks = useTaskStore.getState().tasks ?? [];
        const round = Number(auditRound) || 1;
        const matched =
          tasks.find((task) => task.id === taskId) ||
          tasks.find(
            (task) =>
              (task.status === 'assigned' || task.status === 'in_progress' || task.status === 'rejected') &&
              (task.task_type === 'audit' || !!task.audit_round) &&
              (task.tree_record_id === tree.id || task.tree_id === tree.id) &&
              (Number(task.audit_round) === round || !task.audit_round)
          );
        // The assigned card may not be in the local list yet. Close it by id anyway.
        if (taskId && !matched) {
          await completeTask(
            taskId,
            tree.id,
            undefined,
            rejectionNotes ? { editedAfterReject: true } : undefined
          );
        }
        if (matched) {
          const editedAfterReject = matched.status === 'rejected' || Boolean(rejectionNotes);
          await completeTask(
            matched.id,
            tree.id,
            undefined,
            editedAfterReject ? { editedAfterReject: true } : undefined
          );
          useTaskStore.getState().setTasks(
            tasks.map((task) =>
              task.id === matched.id
                ? {
                    ...task,
                    status: 'completed' as const,
                    completed_at: new Date().toISOString(),
                    ...(editedAfterReject ? { review_notes: 'edited' } : {}),
                  }
                : task
            )
          );
        }
        useTreeStore.getState().updateTree(tree.id, { survey_date: actionDate });
        useProjectRefreshStore.getState().triggerProjectRefresh();
        await updateBaselineTree(treeId, { survey_date: actionDate });
        navigation.navigate('Main', {
          screen: 'Task',
          params: { tab: 'completed', at: Date.now() },
        });
        return;
      }

      const res = await updateBaselineTree(
        treeId,
        updates,
        taskId,
        rejectionNotes ? { editedAfterReject: true } : undefined
      );
      if (!res.error && loadedAuditRound) {
        const auditPhotos: Record<string, unknown> = {
          photo_url: finalPhotoUrls[0],
          photo_urls: finalPhotoUrls,
          surveyor: fieldSurveyor || undefined,
          survey_date: actionDate,
        };
        const auditUpdate = await updateStoredAudit(treeId, Number(loadedAuditRound), auditPhotos);
        if (auditUpdate.error) {
          Alert.alert('Save Failed', auditUpdate.error);
          return;
        }
      }
      if (res.error) {
        Alert.alert('Save Failed', res.error);
      } else {
        if (taskId && rejectionNotes) {
          const tasks = useTaskStore.getState().tasks ?? [];
          useTaskStore.getState().setTasks(
            tasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    status: 'completed' as const,
                    completed_at: new Date().toISOString(),
                    review_notes: 'edited',
                  }
                : task
            )
          );
        }
        useTreeStore.getState().updateTree(treeId, { survey_date: actionDate, land_type: landType });
        useProjectRefreshStore.getState().triggerProjectRefresh();
        Alert.alert(
          'Tree Updated',
          'Your changes and photos have been saved and resubmitted for review.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      }
    } catch (err: any) {
      Alert.alert('Error', String(err?.message || '') || 'Failed to update tree');
    } finally {
      setSubmitting(false);
    }
  };

  const displayId = tree ? uiTreeId(tree) : '—';
  const filledCount = photos.filter(Boolean).length;
  const isAllFilled = filledCount === REQUIRED_PHOTOS;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a5c2a" />
        <Text style={styles.loadingText}>Loading tree data...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ─── Header ─── */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{isAudit ? `AUDIT ${auditRound} DETAILS` : 'EDIT TREE DETAILS'}</Text>
            <Text style={styles.headerSub}>ID: {displayId}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
        <View style={styles.photoSection}>
          <View style={styles.photoGalleryRow}>
            {SLOT_CONFIG.map((cfg, slot) => {
              const uri = photos[slot];
              return (
                <TouchableOpacity key={slot} style={styles.photoThumbWrap} activeOpacity={0.85} onPress={() => handleTakePhotoSlot(slot)}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.photoThumb} resizeMode="cover" />
                  ) : (
                    <View style={styles.photoEmpty}>
                      <Ionicons name="camera" size={22} color="#fff" />
                    </View>
                  )}
                  <View style={styles.photoThumbBadge}>
                    <Text style={styles.photoThumbBadgeText}>{uri ? cfg.short : 'Tap'}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.photoOverlay}>
            <View style={styles.photoCountBadge}>
              <Ionicons name="camera" size={14} color="#fff" />
              <Text style={styles.photoBadgeText}>{filledCount}/{REQUIRED_PHOTOS} Photos</Text>
            </View>
          </View>
        </View>

        <View style={styles.form}>
          {rejectionNotes ? (
            <View style={styles.rejectionNotice}>
              <Ionicons name="alert-circle" size={18} color="#ef4444" />
              <View style={{ flex: 1 }}>
                <Text style={styles.rejectionTitle}>Rejection Reason</Text>
                <Text style={styles.rejectionBody}>{rejectionNotes}</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.sectionHeader}>
            <Ionicons name="finger-print" size={16} color="#1a5c2a" />
            <Text style={[styles.sectionTitle, styles.sectionTitleGrow]}>Tree Identity</Text>
            <View style={styles.plantingTag}>
              <Ionicons name="leaf" size={12} color="#1a5c2a" />
              <Text style={styles.plantingTagText}>{eventType}</Text>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>TREE ID</Text>
            <View style={styles.readOnlyField}><Text style={styles.readOnlyText}>{displayId}</Text></View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>TREE NAME <Text style={styles.optional}>· assigned task</Text></Text>
            <View style={styles.readOnlyField}><Text style={styles.readOnlyText}>{species || '—'}</Text></View>
          </View>

          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>FIELD SURVEYOR</Text>
              <View style={styles.readOnlyField}><Text style={styles.readOnlyText}>{fieldSurveyor || '—'}</Text></View>
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>{isAudit ? 'AUDIT DATE' : 'UPDATE TREE DATE'}</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>
                  {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </View>
            </View>
          </View>
          {isAudit ? (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="create-outline" size={16} color="#1a5c2a" />
                <Text style={styles.sectionTitle}>Measurements</Text>
              </View>
              <View style={styles.measureGrid}>
                <View style={styles.measureCell}>
                  <Text style={styles.fieldLabel}>DBH (CM)</Text>
                  <TextInput style={styles.textInput} value={dbhCm} onChangeText={setDbhCm} placeholder="0.0" placeholderTextColor="#9ca3af" keyboardType="decimal-pad" />
                </View>
                <View style={styles.measureCell}>
                  <Text style={styles.fieldLabel}>HEIGHT (M)</Text>
                  <TextInput style={styles.textInput} value={heightM} onChangeText={setHeightM} placeholder="0.0" placeholderTextColor="#9ca3af" keyboardType="decimal-pad" />
                </View>
              </View>
              <View style={styles.measureGrid}>
                <View style={styles.measureCell}>
                  <Text style={styles.fieldLabel}>DENSITY (G/CM³)</Text>
                  <TextInput style={styles.textInput} value={woodDensity} onChangeText={setWoodDensity} placeholder="0.0" placeholderTextColor="#9ca3af" keyboardType="decimal-pad" />
                </View>
                <View style={styles.measureCell}>
                  <Text style={styles.fieldLabel}>CROWN (M)</Text>
                  <TextInput style={styles.textInput} value={crownDiam} onChangeText={setCrownDiam} placeholder="0.0" placeholderTextColor="#9ca3af" keyboardType="decimal-pad" />
                </View>
              </View>

              <View style={styles.sectionHeader}>
                <Ionicons name="information-circle-outline" size={16} color="#1a5c2a" />
                <Text style={styles.sectionTitle}>Condition & Metadata</Text>
              </View>
              <Text style={styles.fieldLabel}>CONDITION</Text>
              <View style={styles.conditionGrid}>
                {(['Healthy', 'Stressed', 'Diseased', 'Dead'] as TreeCondition[]).map((condition) => {
                  const selected = treeCondition === condition;
                  const color = CONDITION_COLORS[condition];
                  const icon = condition === 'Healthy' ? 'leaf' : condition === 'Stressed' ? 'alert-circle' : condition === 'Diseased' ? 'medkit' : 'close-circle';
                  return (
                    <TouchableOpacity
                      key={condition}
                      style={[styles.conditionCard, selected && { backgroundColor: color, borderColor: color }]}
                      onPress={() => setTreeCondition(condition)}
                    >
                      <Ionicons name={icon as any} size={16} color={selected ? '#fff' : color} />
                      <Text style={[styles.conditionCardText, selected && { color: '#fff' }]}>{condition}</Text>
                      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={selected ? '#fff' : '#9ca3af'} />
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.measureGrid}>
                <View style={styles.measureCell}>
                  <Text style={styles.fieldLabel}>MULTI STEM</Text>
                  <View style={styles.multiStemRow}>
                    {(['Yes', 'No'] as MultiStemOption[]).map((option) => (
                      <TouchableOpacity key={option} style={[styles.multiStemBtn, multiStem === option && styles.multiStemBtnActive]} onPress={() => setMultiStem(option)}>
                        <Text style={[styles.multiStemBtnText, multiStem === option && styles.multiStemBtnTextActive]}>{option}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={styles.measureCell}>
                  <Text style={styles.fieldLabel}>AGE (YRS)</Text>
                  <TextInput style={styles.textInput} value={ageYears} onChangeText={setAgeYears} placeholder="0" placeholderTextColor="#9ca3af" keyboardType="number-pad" />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>NOTES</Text>
                <TextInput
                  style={[styles.textInput, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Write audit notes"
                  placeholderTextColor="#9ca3af"
                  multiline
                  textAlignVertical="top"
                />
              </View>
            </>
          ) : null}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>LAND TYPE</Text>
            {isAudit ? (
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{landType || '—'}</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventTypeScroll}>
                {LAND_TYPES.map((lt) => (
                  <TouchableOpacity key={lt} style={[styles.eventTypeBtn, landType === lt && styles.eventTypeBtnActive]} onPress={() => setLandType(lt)}>
                    <Text style={[styles.eventTypeText, landType === lt && styles.eventTypeTextActive]}>{lt}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={styles.sectionHeader}>
            <Ionicons name="location" size={16} color="#1a5c2a" />
            <Text style={styles.sectionTitle}>Location</Text>
          </View>
          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>LAT</Text>
              <View style={styles.readOnlyField}><Text style={styles.readOnlyText}>{tree?.latitude != null ? Number(tree.latitude).toFixed(6) : '—'}</Text></View>
            </View>
            <View style={styles.measureCell}>
              <Text style={styles.fieldLabel}>LONG</Text>
              <View style={styles.readOnlyField}><Text style={styles.readOnlyText}>{tree?.longitude != null ? Number(tree.longitude).toFixed(6) : '—'}</Text></View>
            </View>
          </View>

          <TouchableOpacity style={[styles.saveBtn, (!isAllFilled || submitting) && { opacity: 0.6 }]} onPress={handleSave} disabled={submitting}>
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>{isAudit ? 'Save Audit' : 'Save & Resubmit for Review'}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f1' },
  photoSection: { backgroundColor: '#0D1A17', position: 'relative' },
  rejectedDateCard: {
    marginHorizontal: 16,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  rejectedDateIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectedDateLabel: { fontSize: 10, fontWeight: '800', color: '#dc2626', letterSpacing: 0.4 },
  rejectedDateValue: { fontSize: 15, fontWeight: '800', color: '#111827', marginTop: 2 },
  photoGalleryRow: { flexDirection: 'row', height: 160 },
  photoThumbWrap: { flex: 1, borderRightWidth: 1, borderRightColor: 'rgba(0,0,0,0.3)' },
  photoThumb: { width: '100%', height: '100%' },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#163126' },
  photoThumbBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  photoThumbBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  photoOverlay: { position: 'absolute', top: 8, right: 8 },
  photoCountBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  form: { padding: 16, gap: 18 },
  fieldGroup: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#E8F5E9' },
  sectionTitleGrow: { flex: 1 },
  plantingTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#E5F6EA', borderWidth: 1, borderColor: '#B7E0C2' },
  plantingTagText: { fontSize: 12, fontWeight: '700', color: '#1a5c2a' },
  readOnlyField: { backgroundColor: '#F5F5F5', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#E5E5E5' },
  readOnlyText: { fontSize: 14, color: '#333', fontWeight: '500' },
  textInput: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#D4E8D0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#1a1a1a' },
  notesInput: { minHeight: 96 },
  measureGrid: { flexDirection: 'row', gap: 6 },
  measureCell: { flex: 1, gap: 4 },
  measureLabel: { fontSize: 8, fontWeight: '700', color: '#1a5c2a', letterSpacing: 0.3, textTransform: 'uppercase' },
  measureInput: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#D4E8D0', paddingHorizontal: 6, paddingVertical: 10, fontSize: 14, color: '#1a1a1a', textAlign: 'center', minHeight: 40 },
  eventTypeScroll: { flexDirection: 'row', gap: 8 },
  eventTypeBtn: { height: 44, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1.5, borderColor: '#AACBA7', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  eventTypeBtnActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  eventTypeText: { fontSize: 14, color: '#112121' },
  eventTypeTextActive: { color: '#fff', fontWeight: '700' },
  multiStemRow: { flexDirection: 'row', gap: 6 },
  multiStemBtn: { flex: 1, height: 40, borderRadius: 14, borderWidth: 1.5, borderColor: '#D4E8D0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  multiStemBtnActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  multiStemBtnText: { fontSize: 14, color: '#1a1a1a' },
  multiStemBtnTextActive: { color: '#fff', fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 13, color: '#666' },
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
  headerCenter: { flex: 1, alignItems: 'flex-start', marginLeft: 10 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 11, fontWeight: '700', color: '#cde8d3', marginTop: 2 },
  scrollContent: { padding: 16 },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#123f24',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  identityMark: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: '#2e7d43',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityKicker: { color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: '800', letterSpacing: 1.0 },
  identityTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginTop: 1 },
  identityIdBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityIdText: { color: '#D1FAE5', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  lockedField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF6EE',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 12,
    minHeight: 48,
  },
  lockedText: { color: '#123f24', fontSize: 15, fontWeight: '700' },
  rejectionNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  rejectionTitle: { fontSize: 12, fontWeight: '800', color: '#ef4444', marginBottom: 2 },
  rejectionBody: { fontSize: 12, color: '#991b1b', lineHeight: 16 },
  section: { marginBottom: 16 },
  row: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 12, fontWeight: '700', color: '#333', marginBottom: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#1a5c2a' },
  photoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  photoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  photoBadgeDone: {
    backgroundColor: '#dcfce7',
  },
  photoBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  photoSlotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  slotWrap: {
    flex: 1,
    height: 120,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  slotFilled: {
    flex: 1,
    position: 'relative',
  },
  slotImage: {
    width: '100%',
    height: '100%',
  },
  slotLabelBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(21, 128, 61, 0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  slotLabelBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  slotRetakeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 3,
    alignItems: 'center',
  },
  slotRetakeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  slotEmpty: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    gap: 4,
  },
  slotEmptyIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  slotEmptyTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#334155',
    textAlign: 'center',
  },
  slotEmptySub: {
    fontSize: 8,
    color: '#15803d',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#222',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  conditionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  conditionCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#fff',
  },
  conditionCardText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  conditionIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conditionLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  conditionLabelActive: {
    color: '#fff',
  },
  landChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  landChipActive: {
    backgroundColor: '#1a5c2a',
    borderColor: '#1a5c2a',
  },
  landChipText: { fontSize: 12, fontWeight: '700', color: '#555' },
  landChipTextActive: { color: '#fff' },
  // Measurements card
  measureCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4EDE6',
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  measureCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  measureCardIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#1a5c2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  measureCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1a5c2a',
    letterSpacing: 1.2,
  },
  measureGrid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  measureCell2: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: '#F7FAF8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4EDE6',
    padding: 10,
    alignItems: 'flex-start',
    gap: 3,
  },
  measureCellIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  measureCellLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#6B7B6E',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  measureCellInput: {
    fontSize: 16,
    fontWeight: '800',
    color: '#112121',
    paddingVertical: 0,
    minWidth: 40,
  },
  measureCellUnit: {
    fontSize: 9,
    fontWeight: '700',
    color: '#aaa',
  },
  // Species dropdown
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
    marginTop: 4,
  },
  speciesListScroll: {
    flexGrow: 0,
  },
  speciesItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  speciesItemMeta: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  speciesItemActive: {
    backgroundColor: '#EAF3DE',
  },
  speciesItemText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  speciesItemTextActive: {
    color: '#1a5c2a',
    fontWeight: '600',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1a5c2a',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 8,
    elevation: 4,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  // Section card system
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4EDE6',
    padding: 14,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionCardIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1a5c2a',
    letterSpacing: 1.2,
  },
  // Field labels inside section cards
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7B6E',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  required: { color: '#ef4444', fontWeight: '700' },
  optional: { color: '#aaa', fontWeight: '600' },
  // Land type grid
  landTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  landTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    backgroundColor: '#F7FAF8',
  },
  landTypeChipActive: {
    backgroundColor: '#1a5c2a',
    borderColor: '#1a5c2a',
  },
  landTypeChipText: { fontSize: 12, fontWeight: '700', color: '#555' },
  landTypeChipTextActive: { color: '#fff' },
  // Rejection icon wrap
  rejectionIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Surveyor inside notes card
  surveyorLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#6B7B6E',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  surveyorName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#112121',
    marginTop: 1,
  },
});
