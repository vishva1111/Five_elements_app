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
import { HistoryStackParamList, TreeRecord } from '../../types';
import { fetchTreeById } from '../../services/treeService';
import StatusBadge from '../../components/StatusBadge';
import MapPreview from '../../components/MapPreview';

type Route = RouteProp<HistoryStackParamList, 'TreeDetail'>;
type Nav = NativeStackNavigationProp<HistoryStackParamList, 'TreeDetail'>;

export default function TreeDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { treeId } = route.params;
  const [tree, setTree] = useState<TreeRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTreeById(treeId).then(({ data }) => {
      setTree(data);
      setLoading(false);
    });
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

  return (
    <ScrollView style={styles.container}>
      {/* Photo with back button overlay */}
      <View>
        {tree.photo_url ? (
          <Image source={{ uri: tree.photo_url }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderText}>🌳</Text>
          </View>
        )}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.species}>{tree.species}</Text>
          <StatusBadge status={tree.health_status} />
        </View>

        {/* Details */}
        <View style={styles.detailsCard}>
          <DetailRow icon="calendar" label="Submitted" value={date} />
          <DetailRow icon="leaf" label="Species" value={tree.species} />
          <DetailRow icon="heart" label="Health" value={tree.health_status.charAt(0).toUpperCase() + tree.health_status.slice(1)} />
          {tree.notes ? <DetailRow icon="document-text" label="Notes" value={tree.notes} /> : null}
          {tree.project_name ? <DetailRow icon="folder" label="Project" value={tree.project_name} /> : null}
          {tree.submitted_by ? <DetailRow icon="person" label="Submitted by" value={tree.submitted_by} /> : null}
        </View>

        {/* Map */}
        <Text style={styles.sectionTitle}>📍 Location</Text>
        <MapPreview
          coords={{ latitude: tree.latitude, longitude: tree.longitude }}
          height={200}
        />

        <TouchableOpacity style={styles.mapsBtn} onPress={openInMaps}>
          <Ionicons name="map" size={18} color="#1a5c2a" />
          <Text style={styles.mapsBtnText}>Open in OpenStreetMap</Text>
        </TouchableOpacity>

        <View style={styles.coordsBox}>
          <Text style={styles.coordsLabel}>Latitude</Text>
          <Text style={styles.coordsValue}>{tree.latitude.toFixed(8)}</Text>
          <Text style={styles.coordsLabel}>Longitude</Text>
          <Text style={styles.coordsValue}>{tree.longitude.toFixed(8)}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={detailStyles.row}>
      <Ionicons name={icon as any} size={16} color="#1a5c2a" style={detailStyles.icon} />
      <View style={detailStyles.textGroup}>
        <Text style={detailStyles.label}>{label}</Text>
        <Text style={detailStyles.value}>{value}</Text>
      </View>
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
    gap: 12,
  },
  icon: { marginTop: 2 },
  textGroup: { flex: 1 },
  label: { fontSize: 11, color: '#888', marginBottom: 2 },
  value: { fontSize: 14, color: '#222', fontWeight: '500' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: '#888' },
  photo: { width: '100%', height: 260 },
  photoPlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 60 },
  content: { padding: 16, gap: 12 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  species: { fontSize: 22, fontWeight: 'bold', color: '#1a1a1a', flex: 1, marginRight: 12 },
  detailsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginTop: 4 },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: '#1a5c2a',
    borderRadius: 10,
    justifyContent: 'center',
  },
  mapsBtnText: { color: '#1a5c2a', fontWeight: '600', fontSize: 14 },
  coordsBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  coordsLabel: { fontSize: 11, color: '#888', marginBottom: 2, marginTop: 6 },
  coordsValue: { fontSize: 14, color: '#1a5c2a', fontWeight: '600', fontFamily: 'monospace' },
  backBtn: {
    position: 'absolute',
    top: 48,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});