import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchTreeById } from '../../services/treeService';
import { TreeRecord } from '../../types';

export default function SubmitSuccessScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const treeId = route.params?.treeId as string | undefined;
  const [tree, setTree] = useState<TreeRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!treeId) {
        if (active) setLoading(false);
        return;
      }
      const { data } = await fetchTreeById(treeId);
      if (active) {
        setTree(data ?? null);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [treeId]);

  const displayId = tree?.tree_id || tree?.id?.slice(0, 8) || '—';

  return (
    <LinearGradient colors={['#0B2416', '#123f24', '#1F6B38']} style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 16) + 8,
          paddingBottom: Math.max(insets.bottom, 16) + 24,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View style={styles.seal}>
            <Ionicons name="checkmark" size={28} color="#123f24" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>FIELD RECORD</Text>
            <Text style={styles.headline}>Planted and locked</Text>
          </View>
        </View>

        <View style={styles.ticket}>
          <View style={styles.notchLeft} />
          <View style={styles.notchRight} />
          {loading ? (
            <ActivityIndicator color="#1a5c2a" style={{ marginVertical: 36 }} />
          ) : (
            <>
              <Text style={styles.ticketLabel}>JUST COMPLETED</Text>
              <Text style={styles.species}>{tree?.species || 'Tree record'}</Text>
              {tree?.scientific_name ? (
                <Text style={styles.scientific}>{tree.scientific_name}</Text>
              ) : null}

              <View style={styles.perforation} />

              <View style={styles.metaGrid}>
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>TREE ID</Text>
                  <Text style={styles.metaValue}>{displayId}</Text>
                </View>
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>EVENT</Text>
                  <Text style={styles.metaValue}>{tree?.event_type || 'Planting'}</Text>
                </View>
              </View>

              <View style={styles.gpsLine}>
                <Ionicons name="navigate" size={16} color="#1a5c2a" />
                <Text style={styles.gpsText}>
                  {tree?.latitude && tree?.longitude
                    ? `${tree.latitude.toFixed(5)}   ${tree.longitude.toFixed(5)}`
                    : 'GPS saved with this record'}
                </Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.path}>
          <View style={styles.pathDot} />
          <View style={styles.pathLine} />
          <View style={[styles.pathDot, styles.pathDotOpen]} />
        </View>

        <TouchableOpacity
          style={styles.nextBtn}
          activeOpacity={0.86}
          accessibilityRole="button"
          accessibilityLabel="Open next assigned task"
          onPress={() => navigation.navigate('Main', { screen: 'Task' })}
        >
          <View>
            <Text style={styles.nextKicker}>YOUR NEXT STOP</Text>
            <Text style={styles.nextText}>Assigned task</Text>
          </View>
          <View style={styles.nextArrow}>
            <Ionicons name="arrow-forward" size={20} color="#123f24" />
          </View>
        </TouchableOpacity>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 22 },
  seal: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  kicker: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
  headline: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 2 },
  ticket: {
    backgroundColor: '#F7FFF9',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 22,
    overflow: 'hidden',
  },
  notchLeft: {
    position: 'absolute',
    left: -14,
    top: '46%',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#164E2C',
  },
  notchRight: {
    position: 'absolute',
    right: -14,
    top: '46%',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#164E2C',
  },
  ticketLabel: { color: '#15803d', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  species: { color: '#123f24', fontSize: 34, fontWeight: '800', marginTop: 6 },
  scientific: { color: '#3f6b4d', fontSize: 16, fontStyle: 'italic', marginTop: 2 },
  perforation: {
    marginVertical: 18,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#B7D7C2',
  },
  metaGrid: { flexDirection: 'row', gap: 12 },
  metaCell: { flex: 1 },
  metaLabel: { color: '#6b8f78', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  metaValue: { color: '#123f24', fontSize: 18, fontWeight: '800', marginTop: 4 },
  gpsLine: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF6EE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  gpsText: { color: '#123f24', fontSize: 14, fontWeight: '700' },
  path: { alignItems: 'center', marginVertical: 8 },
  pathDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E8F5E9' },
  pathDotOpen: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#F6C56B' },
  pathLine: { width: 2, height: 28, backgroundColor: 'rgba(255,255,255,0.35)' },
  nextBtn: {
    minHeight: 78,
    borderRadius: 22,
    backgroundColor: '#F6C56B',
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nextKicker: { color: '#6B4A12', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  nextText: { color: '#123f24', fontSize: 22, fontWeight: '800', marginTop: 2 },
  nextArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
