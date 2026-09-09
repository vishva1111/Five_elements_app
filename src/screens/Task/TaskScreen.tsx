import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../../store/authStore';
import { useTaskStore } from '../../store/taskStore';
import { fetchAgentTasks } from '../../services/taskService';
import { loadLocalTasks, saveLocalTask } from '../../services/localTaskService';
import { Task, TaskStatus } from '../../types';

const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

const STATUS_ICONS: Record<TaskStatus, keyof typeof Ionicons.glyphMap> = {
  assigned: 'clipboard-outline',
  in_progress: 'time-outline',
  completed: 'checkmark-circle',
};

export default function TaskScreen() {
  const user = useAuthStore((s) => s.user);
  const { tasks, setTasks, localTasks, setLocalTasks } = useTaskStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');
  const [newTask, setNewTask] = useState({
    name: '',
    target_count: '',
    priority: 'medium' as 'high' | 'medium' | 'low',
    location: '',
    due_date: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await fetchAgentTasks(user.id);
    if (data) setTasks(data);
  }, [user?.id, setTasks]);

  const loadLocal = useCallback(async () => {
    const local = await loadLocalTasks();
    setLocalTasks(local);
  }, [setLocalTasks]);

  useFocusEffect(
    useCallback(() => {
      loadTasks();
      loadLocal();
    }, [loadTasks, loadLocal])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadTasks(), loadLocal()]);
    setRefreshing(false);
  }, [loadTasks, loadLocal]);

  const handleAddTask = async () => {
    if (!newTask.name.trim()) {
      Alert.alert('Error', 'Please enter a task name');
      return;
    }
    if (!newTask.target_count || parseInt(newTask.target_count) <= 0) {
      Alert.alert('Error', 'Please enter a valid target count');
      return;
    }

    setSubmitting(true);
    const taskId = `local_${Date.now()}`;
    const task: Task = {
      id: taskId,
      name: newTask.name.trim(),
      assignee_id: user?.id ?? '',
      target_count: parseInt(newTask.target_count),
      priority: newTask.priority,
      location: newTask.location.trim() || undefined,
      due_date: newTask.due_date || null,
      created_at: new Date().toISOString(),
      captured: 0,
      remaining: parseInt(newTask.target_count),
      progress: 0,
      status: 'assigned',
    };

    await saveLocalTask(task);
    const updated = await loadLocalTasks();
    setLocalTasks(updated);

    setNewTask({ name: '', target_count: '', priority: 'medium', location: '', due_date: '' });
    setShowAddModal(false);
    setSubmitting(false);
  };

  const allTasks = [...tasks, ...localTasks];
  const filteredTasks = filter === 'all' ? allTasks : allTasks.filter((t) => t.status === filter);
  const stats = {
    total: allTasks.length,
    assigned: allTasks.filter((t) => t.status === 'assigned').length,
    inProgress: allTasks.filter((t) => t.status === 'in_progress').length,
    completed: allTasks.filter((t) => t.status === 'completed').length,
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1a5c2a', '#2e7d32']} style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>My Tasks</Text>
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: '#f59e0b' }]}>{stats.assigned}</Text>
            <Text style={styles.statLabel}>Assigned</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: '#2196F3' }]}>{stats.inProgress}</Text>
            <Text style={styles.statLabel}>In Progress</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: '#22c55e' }]}>{stats.completed}</Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.filterRow}>
        {(['all', 'assigned', 'in_progress', 'completed'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {filteredTasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="clipboard-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>No tasks found</Text>
            <Text style={styles.emptySubtext}>Tap + to create a new task</Text>
          </View>
        ) : (
          filteredTasks.map((task) => (
            <View key={task.id} style={styles.taskCard}>
              <View style={styles.taskHeader}>
                <View style={styles.taskTitleRow}>
                  <Ionicons
                    name={STATUS_ICONS[task.status]}
                    size={20}
                    color={task.status === 'completed' ? '#22c55e' : task.status === 'in_progress' ? '#2196F3' : '#f59e0b'}
                  />
                  <Text style={styles.taskName}>{task.name}</Text>
                </View>
                <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[task.priority] + '20' }]}>
                  <Text style={[styles.priorityText, { color: PRIORITY_COLORS[task.priority] }]}>
                    {task.priority.toUpperCase()}
                  </Text>
                </View>
              </View>
              {task.location ? (
                <View style={styles.taskDetail}>
                  <Ionicons name="location-outline" size={14} color="#888" />
                  <Text style={styles.taskDetailText}>{task.location}</Text>
                </View>
              ) : null}
              <View style={styles.taskProgress}>
                <View style={styles.progressInfo}>
                  <Text style={styles.progressText}>{task.captured} / {task.target_count}</Text>
                  <Text style={styles.progressPercent}>{Math.round(task.progress)}%</Text>
                </View>
                <View style={styles.progressBar}>
                  <View
                    style={[styles.progressFill, { width: `${task.progress}%`, backgroundColor: task.progress >= 100 ? '#22c55e' : '#1a5c2a' }]}
                  />
                </View>
              </View>
              <View style={styles.taskFooter}>
                <Text style={styles.taskDate}>
                  Due: {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date'}
                </Text>
                {task.project_name && (
                  <View style={styles.projectTag}>
                    <Text style={styles.projectTagText}>{task.project_name}</Text>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create New Task</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#1a1a1a" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent}>
              <Text style={styles.inputLabel}>Task Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter task name"
                value={newTask.name}
                onChangeText={(text) => setNewTask({ ...newTask, name: text })}
              />
              <Text style={styles.inputLabel}>Target Count *</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter target number"
                keyboardType="numeric"
                value={newTask.target_count}
                onChangeText={(text) => setNewTask({ ...newTask, target_count: text })}
              />
              <Text style={styles.inputLabel}>Priority</Text>
              <View style={styles.priorityRow}>
                {(['high', 'medium', 'low'] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.priorityOption, newTask.priority === p && { backgroundColor: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p] }]}
                    onPress={() => setNewTask({ ...newTask, priority: p })}
                  >
                    <Text style={[styles.priorityOptionText, newTask.priority === p && { color: '#fff' }]}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.inputLabel}>Location</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter location (optional)"
                value={newTask.location}
                onChangeText={(text) => setNewTask({ ...newTask, location: text })}
              />
              <Text style={styles.inputLabel}>Due Date</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD (optional)"
                value={newTask.due_date}
                onChangeText={(text) => setNewTask({ ...newTask, due_date: text })}
              />
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowAddModal(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                onPress={handleAddTask}
                disabled={submitting}
              >
                <Text style={styles.submitButtonText}>{submitting ? 'Creating...' : 'Create Task'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { paddingTop: 48, paddingBottom: 20, paddingHorizontal: 16 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  addButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 12, alignItems: 'center' },
  statNumber: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e0e0' },
  filterTabActive: { backgroundColor: '#1a5c2a', borderColor: '#1a5c2a' },
  filterText: { fontSize: 13, color: '#666', fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  taskCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  taskName: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', flex: 1 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  priorityText: { fontSize: 10, fontWeight: '700' },
  taskDetail: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  taskDetailText: { fontSize: 13, color: '#888' },
  taskProgress: { marginTop: 8 },
  progressInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressText: { fontSize: 13, color: '#555', fontWeight: '500' },
  progressPercent: { fontSize: 13, color: '#1a5c2a', fontWeight: '700' },
  progressBar: { height: 6, backgroundColor: '#e0e0e0', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  taskFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  taskDate: { fontSize: 12, color: '#888' },
  projectTag: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  projectTagText: { fontSize: 11, color: '#1a5c2a', fontWeight: '500' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#888', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#aaa', marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  modalContent: { paddingHorizontal: 20 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1.5, borderColor: '#DDE7D8', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: '#fff' },
  priorityRow: { flexDirection: 'row', gap: 10 },
  priorityOption: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#DDE7D8', alignItems: 'center' },
  priorityOptionText: { fontSize: 14, fontWeight: '600', color: '#555' },
  modalFooter: { flexDirection: 'row', gap: 12, padding: 20, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  cancelButton: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: '#DDE7D8', alignItems: 'center' },
  cancelButtonText: { fontSize: 15, fontWeight: '600', color: '#666' },
  submitButton: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1a5c2a', alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#ccc' },
  submitButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
