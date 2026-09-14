import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { HistoryStackParamList, TreeRecord } from '../../types';
import { fetchTreeById } from '../../services/treeService';
import MapPreview from '../../components/MapPreview';

type Route = RouteProp<HistoryStackParamList, 'TreeDetail'>;
type Nav = NativeStackNavigationProp<HistoryStackParamList, 'TreeDetail'>;

const CONDITION_COLORS: Record<string, string> = {
  Healthy: '#22c55e',
  Stressed: '#f59e0b',
  Diseased: '#ef4444',
  Dead: '#6b7280',
};

export default function TreeDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { treeId } = route.params;
  const [tree, setTree] = useState<TreeRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchTreeById(treeId)
      .then(({ data }) => {
        if (!cancelled) {
          setTree(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn('[TreeApp] fetchTreeById failed:', err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [treeId]);

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
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const displayId = tree.tree_id || `TREE-${tree.id.slice(0, 8).toUpperCase()}`;
  const conditionColor = CONDITION_COLORS[tree.tree_condition || ''] || '#6b7280';

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={['#123f24', '#1a5c2a', '#2e7d43']} style={[styles.header, { paddingTop: 48 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>TREE DETAILS</Text>
          <Text style={styles.headerSubtitle}>{displayId}</Text>
        </View>
        <View style={styles.headerRight} />
      </LinearGradient>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Photo */}
        {tree.photo_url ? (
          <Image source={{ uri: tree.photo_url }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderText}>🌳</Text>
          </View>
        )}

        {/* Tree ID + Condition + Species */}
        <View style={styles.idRow}>
          <View style={styles.idBadge}>
            <Ionicons name="finger-print" size={14} color="#1a5c2a" />
            <Text style={styles.idText}>{displayId}</Text>
          </View>
          {tree.tree_condition ? (
            <View style={[styles.conditionBadge, { backgroundColor: conditionColor + '20', borderColor: conditionColor }]}>
              <View style={[styles.conditionDot, { backgroundColor: conditionColor }]} />
              <Text style={[styles.conditionText, { color: conditionColor }]}>{tree.tree_condition}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.species}>{tree.species}</Text>
        {tree.scientific_name ? (
          <Text style={styles.scientificName}>{tree.scientific_name}</Text>
        ) : null}

        {/* Measurements Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="resize-outline" size={16} color="#1a5c2a" />
            <Text style={styles.cardTitle}>Measurements</Text>
          </View>
          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={[styles.measureValue, !tree.dbh_cm && styles.measureEmpty]}>{tree.dbh_cm ?? '—'}</Text>
              <Text style={styles.measureLabel}>DBH (cm)</Text>
            </View>
            <View style={styles.measureCell}>
              <Text style={[styles.measureValue, !tree.height_m && styles.measureEmpty]}>{tree.height_m ?? '—'}</Text>
              <Text style={styles.measureLabel}>Height (m)</Text>
            </View>
          </View>
          <View style={styles.measureGrid}>
            <View style={styles.measureCell}>
              <Text style={[styles.measureValue, !tree.wood_density && styles.measureEmpty]}>{tree.wood_density ?? '—'}</Text>
              <Text style={styles.measureLabel}>Density</Text>
            </View>
            <View style={styles.measureCell}>
              <Text style={[styles.measureValue, !tree.crown_diameter_m && styles.measureEmpty]}>{tree.crown_diameter_m ?? '—'}</Text>
              <Text style={styles.measureLabel}>Crown (m)</Text>
            </View>
          </View>
        </View>

        {/* Tree Info + Survey Details — side by side */}
        <View style={styles.sideBySide}>
          {/* Tree Info Card */}
          <View style={styles.halfCard}>
            <View style={styles.cardHeader}>
              <Ionicons name="information-circle" size={14} color="#1a5c2a" />
              <Text style={styles.cardTitleSmall}>Tree Info</Text>
            </View>
            <HalfDetailRow label="Tree ID" value={tree.tree_id ?? displayId} />
            <HalfDetailRow label="Multi Stem" value={tree.multi_stem ?? '—'} />
            <HalfDetailRow label="Age" value={tree.age_years ? `${tree.age_years}y` : '—'} />
            <HalfDetailRow label="Land Type" value={tree.land_type ?? '—'} />
          </View>

          {/* Survey Details Card */}
          <View style={styles.halfCard}>
            <View style={styles.cardHeader}>
              <Ionicons name="clipboard" size={14} color="#1a5c2a" />
              <Text style={styles.cardTitleSmall}>Survey</Text>
            </View>
            <HalfDetailRow label="Event" value={tree.event_type ?? '—'} />
            <HalfDetailRow label="Qty" value={tree.quantity ? `${tree.quantity}` : '—'} />
            <HalfDetailRow label="Surveyor" value={tree.surveyor ?? '—'} />
            <HalfDetailRow label="Date" value={tree.survey_date ?? '—'} />
          </View>
        </View>

        {/* Project + Notes Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="folder" size={16} color="#1a5c2a" />
            <Text style={styles.cardTitle}>Project & Notes</Text>
          </View>
          <DetailRow icon="folder-outline" label="Project" value={tree.project_name ?? 'No project'} />
          {tree.notes ? <DetailRow icon="document-text" label="Notes" value={tree.notes} /> : null}
        </View>

        {/* Location Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="location" size={16} color="#1a5c2a" />
            <Text style={styles.cardTitle}>Location</Text>
          </View>
          <MapPreview
            coords={{
              latitude: Number(tree.latitude) || 0,
              longitude: Number(tree.longitude) || 0,
            }}
            height={180}
          />
          <TouchableOpacity style={styles.mapsBtn} onPress={openInMaps}>
            <Ionicons name="map" size={16} color="#1a5c2a" />
            <Text style={styles.mapsBtnText}>Open in Maps</Text>
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
      </ScrollView>
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
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 10,
  },
  icon: { marginTop: 2 },
  textGroup: { flex: 1 },
  label: { fontSize: 11, color: '#888', marginBottom: 2 },
  value: { fontSize: 14, color: '#222', fontWeight: '600' },
});

const halfDetailStyles = StyleSheet.create({
  row: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: { fontSize: 9, color: '#888', marginBottom: 1 },
  value: { fontSize: 12, color: '#222', fontWeight: '600' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: '#888' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 14,
    paddingHorizontal: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 7.5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', textTransform: 'uppercase' },
  headerSubtitle: { color: '#cde8d3', fontSize: 11, marginTop: 2 },
  headerRight: { width: 40 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },
  photo: { width: '100%', height: 220, borderRadius: 7.5 },
  photoPlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7.5,
  },
  photoPlaceholderText: { fontSize: 60 },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  idBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7.5,
  },
  idText: { fontSize: 12, fontWeight: '700', color: '#1a5c2a', fontFamily: 'monospace' },
  species: { fontSize: 22, fontWeight: 'bold', color: '#1a1a1a' },
  scientificName: { fontSize: 13, color: '#666', fontStyle: 'italic', marginTop: -4 },
  conditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7.5,
    borderWidth: 1,
  },
  conditionDot: { width: 8, height: 8, borderRadius: 4 },
  conditionText: { fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 7.5,
    padding: 14,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E8F5E9',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#1a5c2a' },
  sideBySide: {
    flexDirection: 'row',
    gap: 10,
  },
  halfCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 7.5,
    padding: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardTitleSmall: { fontSize: 12, fontWeight: '700', color: '#1a5c2a' },
  measureGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  measureCell: {
    flex: 1,
    backgroundColor: '#f9fdf8',
    borderRadius: 7.5,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  measureValue: { fontSize: 18, fontWeight: '700', color: '#1a5c2a' },
  measureEmpty: { color: '#ccc' },
  measureLabel: { fontSize: 9, color: '#888', marginTop: 2 },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#1a5c2a',
    borderRadius: 7.5,
    justifyContent: 'center',
    marginTop: 8,
  },
  mapsBtnText: { color: '#1a5c2a', fontWeight: '600', fontSize: 13 },
  coordsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  coordCell: {
    flex: 1,
    backgroundColor: '#f9fdf8',
    borderRadius: 7.5,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  coordLabel: { fontSize: 9, color: '#888', fontWeight: '600' },
  coordValue: { fontSize: 12, color: '#1a5c2a', fontWeight: '600', fontFamily: 'monospace', marginTop: 2 },
});
