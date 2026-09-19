import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Project } from '../types';

interface Props {
  projects: Project[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
}

export default function ProjectSelector({ projects, selectedProjectId, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)}>
        <View style={styles.triggerLeft}>
          <Ionicons name="folder-outline" size={20} color="#1a5c2a" />
          <Text style={styles.triggerText} numberOfLines={1}>
            {selectedProject?.name ?? 'Select Project'}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={20} color="#888" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide">
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Project</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={24} color="#1a1a1a" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={projects}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.option,
                    item.id === selectedProjectId && styles.optionActive,
                  ]}
                  onPress={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                >
                  <Ionicons
                    name="folder"
                    size={20}
                    color={item.id === selectedProjectId ? '#fff' : '#1a5c2a'}
                  />
                  <Text
                    style={[
                      styles.optionText,
                      item.id === selectedProjectId && styles.optionTextActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                  {item.id === selectedProjectId && (
                    <Ionicons name="checkmark" size={20} color="#fff" />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  triggerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  triggerText: { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '60%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    marginBottom: 4,
  },
  optionActive: { backgroundColor: '#1a5c2a' },
  optionText: { flex: 1, fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  optionTextActive: { color: '#fff' },
});
