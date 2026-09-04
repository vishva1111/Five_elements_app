import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { Project } from '../types';

export default function ProjectSelector() {
  const assignedProjects = useAuthStore((s) => s.assignedProjects);
  const activeProjectId = useAuthStore((s) => s.activeProjectId);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);
  const refreshCredits = useAuthStore((s) => s.refreshCredits);

  const [open, setOpen] = useState(false);

  const activeProject = assignedProjects.find((p) => p.id === activeProjectId);

  const handleSelect = (project: Project | null) => {
    setActiveProjectId(project?.id ?? null);
    refreshCredits();
    setOpen(false);
  };

  if (!assignedProjects || assignedProjects.length === 0) {
    return (
      <View style={styles.pill}>
        <Ionicons name="folder-outline" size={14} color="#a5d6a7" />
        <Text style={styles.pillText} numberOfLines={1}>
          No projects assigned
        </Text>
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity style={styles.pill} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Ionicons name="folder-open-outline" size={14} color="#a5d6a7" />
        <Text style={styles.pillText} numberOfLines={1}>
          {activeProject ? activeProject.name : 'All Projects'}
        </Text>
        <Ionicons name="chevron-down" size={13} color="#a5d6a7" />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Select Project</Text>

            {/* "All Projects" option */}
            <TouchableOpacity
              style={[styles.option, !activeProjectId && styles.optionActive]}
              onPress={() => handleSelect(null)}
            >
              <Ionicons
                name="layers-outline"
                size={16}
                color={!activeProjectId ? '#fff' : '#1a5c2a'}
              />
              <Text style={[styles.optionText, !activeProjectId && styles.optionTextActive]}>
                All Projects
              </Text>
              {!activeProjectId && (
                <Ionicons name="checkmark" size={16} color="#fff" style={{ marginLeft: 'auto' }} />
              )}
            </TouchableOpacity>

            <FlatList
              data={assignedProjects}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => {
                const isActive = item.id === activeProjectId;
                return (
                  <TouchableOpacity
                    style={[styles.option, isActive && styles.optionActive]}
                    onPress={() => handleSelect(item)}
                  >
                    <Ionicons
                      name="folder-outline"
                      size={16}
                      color={isActive ? '#fff' : '#1a5c2a'}
                    />
                    <Text
                      style={[styles.optionText, isActive && styles.optionTextActive]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {isActive && (
                      <Ionicons
                        name="checkmark"
                        size={16}
                        color="#fff"
                        style={{ marginLeft: 'auto' }}
                      />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 7.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    maxWidth: 200,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    maxWidth: 360,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: '#f5f5f5',
  },
  optionActive: {
    backgroundColor: '#1a5c2a',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    flex: 1,
  },
  optionTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
});