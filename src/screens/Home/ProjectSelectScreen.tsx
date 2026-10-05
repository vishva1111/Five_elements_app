import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  RefreshControl,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { fetchAllProjects, fetchAllTrees } from '../../services/treeService';
import { Project, TreeRecord } from '../../types';
import { classifyTree, computeTreeStats } from './HomeScreen';

export default function ProjectSelectScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAnimId, setSelectedAnimId] = useState<string | null>(null);

  const [projectStatsMap, setProjectStatsMap] = useState<
    Record<string, { total: number; healthy: number; sick: number; dead: number }>
  >({});

  // ─── Build Stats Map Helper ───────────────────────────────────────────────
  const buildStatsMap = useCallback((allTrees: TreeRecord[]) => {
    const map: Record<string, { total: number; healthy: number; sick: number; dead: number }> = {};
    map['__all__'] = computeTreeStats(allTrees);
    allTrees.forEach((t) => {
      const pid = t.project_id || 'unassigned';
      if (!map[pid]) {
        map[pid] = { total: 0, healthy: 0, sick: 0, dead: 0 };
      }
      map[pid].total++;
      const cat = classifyTree(t);
      map[pid][cat]++;
    });
    return map;
  }, []);

  // ─── Load Projects & Stats ────────────────────────────────────────────────
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [projRes, treeRes] = await Promise.all([
        fetchAllProjects(),
        fetchAllTrees().catch(() => ({ data: null })),
      ]);

      if (projRes.data) {
        setProjects(projRes.data);
      }

      if (treeRes.data && treeRes.data.length > 0) {
        setProjectStatsMap(buildStatsMap(treeRes.data));
      }
    } catch (err) {
      console.warn('[ProjectSelectScreen] Error loading data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildStatsMap]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Project Selection Handler ────────────────────────────────────────────
  const handleSelect = (projectId: string) => {
    setSelectedAnimId(projectId);
    setActiveProjectId(projectId);

    // Smooth return to dashboard
    setTimeout(() => {
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('Main');
      }
    }, 200);
  };

  // ─── Filter & Search Logic with Active Project First ───────────────────────
  const filteredProjects = useMemo(() => {
    let list = [...projects];

    // Search query filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((p) => {
        const nameMatch = (p.name || '').toLowerCase().includes(query);
        const descMatch = (p.description || '').toLowerCase().includes(query);
        const idMatch = (p.id || '').toLowerCase().includes(query);
        return nameMatch || descMatch || idMatch;
      });
    }

    // Active project always shows first at the top
    if (activeProjectId) {
      list.sort((a, b) => {
        if (a.id === activeProjectId) return -1;
        if (b.id === activeProjectId) return 1;
        return 0;
      });
    }

    return list;
  }, [projects, searchQuery, activeProjectId]);

  // ─── Render Project Card ──────────────────────────────────────────────────
  const renderProjectCard = ({ item }: { item: Project }) => {
    const isSelected = item.id === activeProjectId;
    const isAnimSelected = selectedAnimId === item.id;
    const stats = projectStatsMap[item.id] || { total: 0, healthy: 0, sick: 0, dead: 0 };

    return (
      <TouchableOpacity
        style={[
          styles.projectCard,
          isSelected && styles.projectCardSelected,
          isAnimSelected && styles.projectCardAnimSelected,
        ]}
        onPress={() => handleSelect(item.id)}
        activeOpacity={0.8}
      >
        {/* Accent Edge */}
        <View style={[styles.cardAccent, isSelected ? styles.cardAccentActive : styles.cardAccentInactive]} />

        <View style={styles.cardContent}>
          {/* Top Row: Icon + Name + Radio/Check */}
          <View style={styles.cardHeader}>
            <View style={[styles.avatarWrap, isSelected && styles.avatarWrapActive]}>
              <Ionicons
                name={isSelected ? 'folder-open' : 'folder-outline'}
                size={22}
                color={isSelected ? '#1a5c2a' : '#2e7d43'}
              />
            </View>

            <View style={styles.headerInfo}>
              <View style={styles.titleRow}>
                <Text style={[styles.projectName, isSelected && styles.projectNameActive]} numberOfLines={1}>
                  {item.name}
                </Text>
                {isSelected && (
                  <View style={styles.activePill}>
                    <View style={styles.pulseDot} />
                    <Text style={styles.activePillText}>ACTIVE</Text>
                  </View>
                )}
              </View>
              {item.status ? (
                <Text style={styles.projectStatusText}>Status: {item.status.toUpperCase()}</Text>
              ) : null}
            </View>

            <View style={styles.checkWrap}>
              {isSelected ? (
                <Ionicons name="checkmark-circle" size={24} color="#1a5c2a" />
              ) : (
                <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />
              )}
            </View>
          </View>

          {/* Description */}
          {item.description ? (
            <Text style={styles.projectDesc}>{item.description}</Text>
          ) : null}

          {/* Metrics Strip */}
          <View style={styles.metricsStrip}>
            <View style={styles.treeTotalBadge}>
              <Ionicons name="leaf" size={13} color="#1a5c2a" />
              <Text style={styles.treeTotalBadgeText}>
                {stats.total} {stats.total === 1 ? 'tree' : 'trees'}
              </Text>
            </View>

            {stats.total > 0 ? (
              <View style={styles.healthBreakdown}>
                <View style={styles.healthItem}>
                  <View style={[styles.healthDot, { backgroundColor: '#22c55e' }]} />
                  <Text style={styles.healthCount}>{stats.healthy}</Text>
                </View>
                <View style={styles.healthItem}>
                  <View style={[styles.healthDot, { backgroundColor: '#f59e0b' }]} />
                  <Text style={styles.healthCount}>{stats.sick}</Text>
                </View>
                <View style={styles.healthItem}>
                  <View style={[styles.healthDot, { backgroundColor: '#ef4444' }]} />
                  <Text style={styles.healthCount}>{stats.dead}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.noTreesYetText}>No trees captured yet</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#123f24" />

      {/* ─── Header Gradient with CurveDivider ─── */}
      <View style={styles.headerWrap}>
        <LinearGradient
          colors={['#123f24', '#1a5c2a', '#2e7d43']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.headerGradient, { paddingTop: Math.max(insets.top + 8, 20) }]}
        >
          {/* Navigation Bar */}
          <View style={styles.navBar}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={22} color="#ffffff" />
            </TouchableOpacity>

            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>Select Project</Text>
              <Text style={styles.headerSubtitle}>
                {projects.length} {projects.length === 1 ? 'workspace' : 'workspaces'} available
              </Text>
            </View>

            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={() => loadData(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* ─── Search Bar ─────────────────────────────────────────────────── */}
          <View style={styles.searchBarContainer}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={20} color="#1a5c2a" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search projects by name, code or details..."
                placeholderTextColor="#94a3b8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
                  <Ionicons name="close-circle" size={18} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </LinearGradient>
      </View>

      {/* ─── Project List ──────────────────────────────────────────────────── */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1a5c2a" />
          <Text style={styles.loadingText}>Loading projects...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProjects}
          keyExtractor={(item) => item.id}
          renderItem={renderProjectCard}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 16 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              tintColor="#1a5c2a"
              colors={['#1a5c2a']}
            />
          }
          ListHeaderComponent={
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {searchQuery ? 'SEARCH RESULTS' : 'ASSIGNED WORKSPACES'}
              </Text>
              <Text style={styles.sectionBadge}>
                {filteredProjects.length} {filteredProjects.length === 1 ? 'project' : 'projects'}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="search-outline" size={36} color="#94a3b8" />
              </View>
              <Text style={styles.emptyTitle}>No Matching Projects</Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery
                  ? `No project matches "${searchQuery}". Check the spelling or search for another term.`
                  : 'No projects found.'}
              </Text>
              {searchQuery ? (
                <TouchableOpacity
                  style={styles.clearSearchFullBtn}
                  onPress={() => setSearchQuery('')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close-circle-outline" size={18} color="#1a5c2a" />
                  <Text style={styles.clearSearchFullBtnText}>Clear Search</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f1',
  },
  headerWrap: {
    zIndex: 5,
  },
  headerGradient: {
    paddingBottom: 18,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  curveDivider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    alignItems: 'flex-start',
    marginLeft: 10,
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#d4edd9',
    fontWeight: '500',
    marginTop: 2,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '500',
  },
  clearSearchBtn: {
    padding: 4,
  },
  listContent: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.8,
  },
  sectionBadge: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  projectCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  projectCardSelected: {
    borderColor: '#1a5c2a',
    backgroundColor: '#f6fbf7',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  projectCardAnimSelected: {
    transform: [{ scale: 0.98 }],
  },
  cardAccent: {
    width: 5,
  },
  cardAccentActive: {
    backgroundColor: '#1a5c2a',
  },
  cardAccentInactive: {
    backgroundColor: 'transparent',
  },
  cardContent: {
    flex: 1,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarWrapActive: {
    backgroundColor: '#dcfce7',
  },
  headerInfo: {
    flex: 1,
    paddingRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  projectNameActive: {
    color: '#1a5c2a',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#86efac',
    gap: 4,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1a5c2a',
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1a5c2a',
    letterSpacing: 0.5,
  },
  projectStatusText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 2,
  },
  checkWrap: {
    paddingLeft: 4,
    paddingTop: 2,
  },
  projectDesc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginTop: 6,
  },
  metricsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  treeTotalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    gap: 5,
  },
  treeTotalBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1a5c2a',
  },
  healthBreakdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  healthItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  healthDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  healthCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  noTreesYetText: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
  clearSearchFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#dcfce7',
    borderRadius: 20,
    gap: 6,
  },
  clearSearchFullBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a5c2a',
  },
});
