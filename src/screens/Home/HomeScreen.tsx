import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  FlatList,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useTreeStore } from '../../store/treeStore';
import { fetchMyTrees, fetchAllProjects } from '../../services/treeService';
import { fetchAgentTasks } from '../../services/taskService';
import { loadLocalTasks } from '../../services/localTaskService';
import ProjectSelector from '../../components/ProjectSelector';
import CurveDivider from '../../components/CurveDivider';
import CircularProgress from '../../components/CircularProgress';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Task, Project } from '../../types';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);
  const assignedProjects = useAuthStore((s) => s.assignedProjects) ?? [];
  const refreshCredits = useAuthStore((s) => s.refreshCredits);
  const trees = useTreeStore((s) => s.trees) ?? [];
  const setTrees = useTreeStore((s) => s.setTrees);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ total: 0, healthy: 0, sick: 0, dead: 0 });
  const [taskStats, setTaskStats] = useState({ total: 0, assigned: 0, rejected: 0, completed: 0 });
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const loadSeqRef = useRef(0);

  const firstName = (user?.full_name?.trim()?.split(' ')[0] || '').replace(/[.!]$/, '');
  const greetingName = firstName || 'there';

  // Fetch all projects on mount
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await fetchAllProjects();
      if (active && data) setAllProjects(data);
    })();
    return () => { active = false; };
  }, []);

  const loadTrees = useCallback(async () => {
    if (!userId) return;
    const seq = ++loadSeqRef.current;
    const { data } = await fetchMyTrees(userId);
    if (seq !== loadSeqRef.current) return;
    if (data) {
      const visibleTrees = activeProjectId
        ? data.filter((t) => t.project_id === activeProjectId)
        : data;
      setTrees(visibleTrees);
      setStats({
        total: visibleTrees.length,
        healthy: visibleTrees.filter((t) => t.health_status === 'healthy').length,
        sick: visibleTrees.filter((t) => t.health_status === 'sick').length,
        dead: visibleTrees.filter((t) => t.health_status === 'dead').length,
      });
    }
  }, [userId, activeProjectId, setTrees]);

  const loadTasks = useCallback(async () => {
    if (!userId) return;
    const seq = ++loadSeqRef.current;
    
    // Fetch DB tasks
    const { data: dbTasks } = await fetchAgentTasks(userId);
    if (seq !== loadSeqRef.current) return;
    
    // Fetch local tasks
    const localTasks = await loadLocalTasks();
    if (seq !== loadSeqRef.current) return;
    
    // Fetch tree captures (count as completed tasks)
    const { data: treeData } = await fetchMyTrees(userId);
    if (seq !== loadSeqRef.current) return;
    const treeCaptures = (treeData ?? []).length;
    
    // Show ALL tasks across all projects
    const allTasks: Task[] = [
      ...(dbTasks ?? []),
      ...localTasks,
    ];
    
    const dbCompleted = allTasks.filter((t) => t.status === 'completed').length;
    
    // Calculate stats from all tasks + tree captures
    setTaskStats({
      total: allTasks.length + treeCaptures,
      assigned: allTasks.filter((t) => t.status === 'assigned').length,
      rejected: allTasks.filter((t) => t.status === 'rejected').length,
      completed: dbCompleted + treeCaptures,
    });
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      refreshCredits();
      loadTrees();
      loadTasks();
    }, [loadTrees, loadTasks, refreshCredits])
  );

  // Auto-refresh when project changes
  useEffect(() => {
    loadTrees();
    loadTasks();
  }, [activeProjectId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrees();
    await loadTasks();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1a5c2a" />}
    >
      <View style={styles.bannerWrap}>
        <LinearGradient
          colors={['#123f24', '#1a5c2a', '#2e7d43']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.banner, { paddingTop: insets.top + 18 }]}
        >
          <View style={styles.bannerTopRow}>
            <View style={styles.bannerGreeting}>
              <Text style={styles.greeting}>Hi {greetingName}</Text>
              <Text style={styles.bannerSub}>Ready to capture trees today?</Text>
            </View>
            <View style={styles.creditsPill}>
              <Ionicons name="wallet-outline" size={15} color="#F09125" />
              <Text style={styles.creditsPillText}>{user?.credits ?? 0}</Text>
            </View>
          </View>

          {/* Active Project Card - Tappable Dropdown */}
          <TouchableOpacity
            style={styles.activeProjectCard}
            onPress={() => setProjectDropdownOpen(true)}
            activeOpacity={0.8}
          >
            <View style={styles.activeProjectIcon}>
              <Ionicons name="folder-open" size={20} color="#1a5c2a" />
            </View>
            <View style={styles.activeProjectInfo}>
              <Text style={styles.activeProjectLabel}>ACTIVE PROJECT</Text>
              <Text style={styles.activeProjectName} numberOfLines={1}>
                {allProjects.find((p) => p.id === activeProjectId)?.name ?? 'All Projects'}
              </Text>
            </View>
            <View style={styles.activeProjectArrow}>
              <Ionicons name="chevron-down" size={18} color="#1a5c2a" />
            </View>
          </TouchableOpacity>
        </LinearGradient>
        <CurveDivider height={30} color="#f5f5f5" cornerRadius={24} style={styles.curveDivider} />
      </View>

      <View style={styles.contentSection}>
        {/* Tree Stats - 4 cards in a row */}
        <View style={styles.treeStatsRow}>
          <View style={[styles.treeStatCard, { borderTopColor: '#1a5c2a' }]}>
            <Text style={[styles.treeStatNumber, { color: '#1a5c2a' }]}>{stats.total}</Text>
            <Text style={styles.treeStatLabel}>Total Trees</Text>
          </View>
          <View style={[styles.treeStatCard, { borderTopColor: '#22c55e' }]}>
            <Text style={[styles.treeStatNumber, { color: '#22c55e' }]}>{stats.healthy}</Text>
            <Text style={styles.treeStatLabel}>Healthy</Text>
          </View>
          <View style={[styles.treeStatCard, { borderTopColor: '#f59e0b' }]}>
            <Text style={[styles.treeStatNumber, { color: '#f59e0b' }]}>{stats.sick}</Text>
            <Text style={styles.treeStatLabel}>Sick</Text>
          </View>
          <View style={[styles.treeStatCard, { borderTopColor: '#ef4444' }]}>
            <Text style={[styles.treeStatNumber, { color: '#ef4444' }]}>{stats.dead}</Text>
            <Text style={styles.treeStatLabel}>Dead</Text>
          </View>
        </View>

        {/* Capture a Tree Card */}
        <TouchableOpacity
          style={styles.captureCard}
          onPress={() => navigation.navigate('Capture')}
          activeOpacity={0.85}
        >
          <View style={styles.captureIconWrap}>
            <Text style={styles.captureIconEmoji}>📷</Text>
          </View>
          <View style={styles.captureInfo}>
            <Text style={styles.captureTitle}>Capture a Tree</Text>
            <Text style={styles.captureSub}>Take photo + tag GPS location</Text>
          </View>
          <View style={styles.captureBadge}>
            <Text style={styles.captureBadgeText}>{user?.credits ?? 0} credits</Text>
          </View>
        </TouchableOpacity>

        {/* Task Stats - 2x2 Grid with CircularProgress */}
        <View style={styles.taskStatsContainer}>
          <View style={styles.taskStatsRow}>
            <TouchableOpacity
              style={styles.taskStatCard}
              onPress={() => navigation.navigate('Task')}
              activeOpacity={0.7}
            >
              <CircularProgress
                size={64}
                progress={100}
                strokeWidth={5}
                color="#F09125"
                trackColor="#FFF3E0"
              >
                <Text style={styles.taskStatNumber}>{taskStats.total}</Text>
              </CircularProgress>
              <Text style={styles.taskStatLabel}>Total Tasks</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.taskStatCard}
              onPress={() => navigation.navigate('Task')}
              activeOpacity={0.7}
            >
              <CircularProgress
                size={64}
                progress={100}
                strokeWidth={5}
                color="#1a5c2a"
                trackColor="#E8F5E9"
              >
                <Text style={styles.taskStatNumber}>{allProjects.length}</Text>
              </CircularProgress>
              <Text style={styles.taskStatLabel}>Projects</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.taskStatsRow}>
            <TouchableOpacity
              style={styles.taskStatCard}
              onPress={() => navigation.navigate('Task')}
              activeOpacity={0.7}
            >
              <CircularProgress
                size={64}
                progress={taskStats.total > 0 ? (taskStats.rejected / taskStats.total) * 100 : 0}
                strokeWidth={5}
                color="#ef4444"
                trackColor="#FEE2E2"
              >
                <Text style={styles.taskStatNumber}>{taskStats.rejected}</Text>
              </CircularProgress>
              <Text style={styles.taskStatLabel}>Rejected</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.taskStatCard}
              onPress={() => navigation.navigate('Task')}
              activeOpacity={0.7}
            >
              <CircularProgress
                size={64}
                progress={taskStats.total > 0 ? (taskStats.completed / taskStats.total) * 100 : 0}
                strokeWidth={5}
                color="#43A047"
                trackColor="#E8F5E9"
              >
                <Text style={styles.taskStatNumber}>{taskStats.completed}</Text>
              </CircularProgress>
              <Text style={styles.taskStatLabel}>Completed</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ScrollView>

    {/* Project Selection Modal */}
    <Modal
      visible={projectDropdownOpen}
      transparent
      animationType="slide"
      onRequestClose={() => setProjectDropdownOpen(false)}
    >
      <View style={styles.modalBackdrop}>
        <TouchableOpacity
          style={styles.modalBackdropTouch}
          activeOpacity={1}
          onPress={() => setProjectDropdownOpen(false)}
        />
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Project</Text>
            <TouchableOpacity onPress={() => setProjectDropdownOpen(false)}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={[{ id: '__all__', name: 'All Projects', description: 'Show all projects' }, ...allProjects]}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isAll = item.id === '__all__';
              const isActive = isAll ? !activeProjectId : item.id === activeProjectId;
              return (
                <TouchableOpacity
                  style={[styles.modalOption, isActive && styles.modalOptionActive]}
                  onPress={() => {
                    setActiveProjectId(isAll ? null : item.id);
                    refreshCredits();
                    setProjectDropdownOpen(false);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.modalOptionIcon, isActive && styles.modalOptionIconActive]}>
                    <Ionicons
                      name={isAll ? 'layers-outline' : 'folder-outline'}
                      size={18}
                      color={isActive ? '#fff' : '#1a5c2a'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalOptionName, isActive && styles.modalOptionNameActive]}>
                      {item.name}
                    </Text>
                    {'description' in item && item.description ? (
                      <Text style={[styles.modalOptionDesc, isActive && styles.modalOptionDescActive]}>
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                  {isActive && <Ionicons name="checkmark" size={20} color="#fff" />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { flex: 1 },
  bannerWrap: { zIndex: 5 },
  banner: {
    backgroundColor: '#1a5c2a',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 50,
  },
  curveDivider: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  contentSection: {
    backgroundColor: '#f5f5f5',
    paddingBottom: 8,
    marginTop: -4,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerGreeting: { flex: 1 },
  creditsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 7.5,
    alignSelf: 'flex-start',
  },
  creditsPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F09125',
  },
  greeting: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  bannerSub: { fontSize: 13, color: '#cde8d3', marginTop: 2 },
  captureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a5c2a',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  captureIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureIconEmoji: { fontSize: 28 },
  captureInfo: { flex: 1 },
  captureTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  captureSub: { fontSize: 12, color: '#cde8d3', marginTop: 2 },
  captureBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7.5,
  },
  captureBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  activeProjectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    gap: 10,
  },
  activeProjectIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeProjectInfo: { flex: 1 },
  activeProjectLabel: { fontSize: 9, fontWeight: '700', color: '#888', letterSpacing: 0.5 },
  activeProjectName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginTop: 1 },
  activeProjectArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalOptionActive: { backgroundColor: '#1a5c2a' },
  modalOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOptionIconActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  modalOptionName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  modalOptionNameActive: { color: '#fff' },
  modalOptionDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  modalOptionDescActive: { color: '#cde8d3' },
  projectSelectorWrapper: { marginTop: 14 },
  treeStatsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 6,
    gap: 8,
  },
  treeStatCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderTopWidth: 3,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  treeStatNumber: { fontSize: 22, fontWeight: 'bold' },
  treeStatLabel: { fontSize: 10, color: '#888', marginTop: 4 },
  taskStatsContainer: {
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  taskStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  taskStatCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  taskStatNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  taskStatLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
  },
});
