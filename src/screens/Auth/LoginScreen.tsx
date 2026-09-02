import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList, Project } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../store/authStore';
import { fetchAllProjects, saveUserProjects, fetchUserProjects, getCachedUserProjects, cacheUserProjects } from '../../services/treeService';
import { supabase } from '../../services/supabase';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const { signIn, loading } = useAuth();
  const { setAssignedProjects, setActiveProjectId, setProjectSelectionPending } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });

  // Project selection state — multi-select dropdown shown on the login page
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [savingProjects, setSavingProjects] = useState(false);
  const [fetchingProjects, setFetchingProjects] = useState(false);

  const validate = () => {
    const newErrors = { email: '', password: '' };
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Enter a valid email';
    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 6) newErrors.password = 'Password must be at least 6 characters';
    setErrors(newErrors);
    return !newErrors.email && !newErrors.password;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    // Hold the app on the login screen while signing in + choosing projects.
    // Must be set BEFORE signIn so the SIGNED_IN event can't navigate away first.
    setProjectSelectionPending(true);
    const { data: signInData, error } = await signIn(email.trim(), password);
    if (error) {
      setProjectSelectionPending(false);
      Alert.alert('Login Failed', error.message ?? 'Invalid credentials. Please try again.');
      return;
    }

    // After successful login, fetch projects and show the multi-select dropdown
    // on the login page. Keep the user here until they confirm / skip.
    const userId =
      signInData?.session?.user?.id ??
      (await supabase.auth.getUser()).data.user?.id;

    setFetchingProjects(true);
    try {
      // ─── Load previously selected projects (DB first, then device cache) ────
      let existing: Project[] = [];
      if (userId) {
        const { data: saved } = await fetchUserProjects(userId);
        existing = saved ?? [];
        if (existing.length === 0) {
          // Fall back to the last selection saved on this device
          const cached = await getCachedUserProjects(userId);
          if (cached && cached.length > 0) existing = cached;
        }
      }

      // ─── Fetch the project list and ALWAYS show the selection at login ─────
      // Previously-selected projects are pre-checked so the user can confirm
      // them as-is or change the selection before entering the app.
      const { data, error } = await fetchAllProjects();
      if (error) {
        console.warn('[TreeApp] Could not load projects:', error);
        Alert.alert(
          'Projects Unavailable',
          'Could not load the project list. Continuing with your saved selection.'
        );
      }

      if (data && data.length > 0) {
        setProjects(data);
        // Pre-check the previously selected projects
        if (existing.length > 0) {
          setSelectedProjects(new Set(existing.map((p) => p.id)));
        }
        setDropdownOpen(true); // open the list right away so it is visible
        setShowProjectDropdown(true);
      } else {
        // No projects exist (or query failed) — continue with the saved selection
        setAssignedProjects(existing);
        setProjectSelectionPending(false);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
      setProjectSelectionPending(false);
    } finally {
      setFetchingProjects(false);
    }
  };

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjects((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      return newSet;
    });
  };

  const handleProjectConfirm = async () => {
    // Get selected project objects — only these will be visible to this user
    const selected = projects.filter((p) => selectedProjects.has(p.id));
    setSavingProjects(true);

    // Persist the selection so it is restored on every future login
    try {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (userId) {
        const { error: saveError } = await saveUserProjects(
          userId,
          Array.from(selectedProjects)
        );
        if (saveError) {
          console.warn('[TreeApp] Could not save project selection:', saveError);
          const tableMissing = /could not find the table/i.test(saveError);
          Alert.alert(
            'Not Saved to Cloud',
            tableMissing
              ? 'The user_projects table is missing in your Supabase database.\n\nFIX: Open Supabase Dashboard → SQL Editor → paste the ENTIRE file supabase/migrations/000_full_database_setup.sql → RUN. Then reload the app and log in again.'
              : `Your selection was kept on this device, but the server rejected it.\n\n${saveError}\n\nAsk your admin to run supabase/migrations/000_full_database_setup.sql in the Supabase SQL editor.`
          );
        }
        // Also cache on this device so the app opens with the same projects
        // next time even if the DB write failed
        await cacheUserProjects(userId, selected);
      }
    } catch (err) {
      console.warn('[TreeApp] Could not save project selection:', err);
    }

    setAssignedProjects(selected);
    // Set active project to first selected project
    if (selected.length > 0) {
      setActiveProjectId(selected[0].id);
    }
    setProjectSelectionPending(false);
    setSavingProjects(false);
  };

  // Show login form
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.emoji}>🌳</Text>
          <Text style={styles.title}>TreeApp</Text>
          <Text style={styles.subtitle}>Five Elements Field Capture</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.formTitle}>Sign In</Text>

          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            left={<TextInput.Icon icon="email" />}
            style={styles.input}
            outlineColor="#ccc"
            activeOutlineColor="#1a5c2a"
            error={!!errors.email}
          />
          <HelperText type="error" visible={!!errors.email}>
            {errors.email}
          </HelperText>

          <TextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            mode="outlined"
            secureTextEntry={!showPassword}
            left={<TextInput.Icon icon="lock" />}
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off' : 'eye'}
                onPress={() => setShowPassword(!showPassword)}
              />
            }
            style={styles.input}
            outlineColor="#ccc"
            activeOutlineColor="#1a5c2a"
            error={!!errors.password}
          />
          <HelperText type="error" visible={!!errors.password}>
            {errors.password}
          </HelperText>

          <Button
            mode="contained"
            onPress={handleLogin}
            loading={loading || fetchingProjects}
            disabled={loading || fetchingProjects}
            style={styles.button}
            contentStyle={styles.buttonContent}
            buttonColor="#1a5c2a"
          >
            {loading ? 'Signing in...' : fetchingProjects ? 'Loading projects...' : 'Sign In'}
          </Button>

          {/* ── Multi-select project dropdown (shown after successful sign-in) ── */}
          {showProjectDropdown && (
            <View style={styles.dropdownSection}>
              <Text style={styles.dropdownLabel}>Select your projects</Text>
              <Text style={styles.dropdownHint}>
                You can work in the projects you choose. Other projects won't be visible to you.
              </Text>

              {/* Dropdown trigger */}
              <TouchableOpacity
                style={styles.dropdownTrigger}
                onPress={() => setDropdownOpen(!dropdownOpen)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.dropdownTriggerText,
                    selectedProjects.size === 0 && styles.dropdownPlaceholder,
                  ]}
                  numberOfLines={1}
                >
                  {selectedProjects.size === 0
                    ? 'Select projects'
                    : projects
                        .filter((p) => selectedProjects.has(p.id))
                        .map((p) => p.name)
                        .join(', ')}
                </Text>
                <Ionicons
                  name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color="#666"
                />
              </TouchableOpacity>

              {/* Dropdown options */}
              {dropdownOpen && (
                <View style={styles.dropdownList}>
                  <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
                    {projects.map((item) => {
                      const isSelected = selectedProjects.has(item.id);
                      return (
                        <TouchableOpacity
                          key={item.id}
                          style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                          onPress={() => toggleProjectSelection(item.id)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                            {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                          </View>
                          <Text
                            style={[
                              styles.dropdownItemText,
                              isSelected && styles.dropdownItemTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                          {item.status && (
                            <View
                              style={[
                                styles.statusBadge,
                                item.status === 'active' && styles.statusBadgeActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusText,
                                  item.status === 'active' && styles.statusTextActive,
                                ]}
                              >
                                {item.status}
                              </Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              <Text style={styles.selectedCount}>
                {selectedProjects.size} project{selectedProjects.size !== 1 ? 's' : ''} selected
              </Text>

              {/* Action buttons */}
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={handleProjectConfirm}
                disabled={savingProjects}
              >
                {savingProjects ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                )}
                <Text style={styles.confirmBtnText}>
                  {selectedProjects.size > 0 ? 'Start Working' : 'Continue Without Projects'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.hint}>
            Use your Five Elements CARM account credentials
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    backgroundColor: '#1a5c2a',
    marginHorizontal: -24,
    marginTop: -24,
    paddingTop: 60,
    paddingBottom: 40,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  emoji: {
    fontSize: 60,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 13,
    color: '#a5d6a7',
    marginTop: 4,
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a5c2a',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#fff',
    marginBottom: 4,
  },
  button: {
    marginTop: 16,
    borderRadius: 8,
  },
  buttonContent: {
    paddingVertical: 6,
  },
  hint: {
    textAlign: 'center',
    color: '#888',
    fontSize: 12,
    marginTop: 16,
  },
  // ── Project Multi-Select Dropdown Styles ──
  dropdownSection: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 16,
  },
  dropdownLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  dropdownHint: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
    marginBottom: 10,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  dropdownTriggerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a5c2a',
    marginRight: 8,
  },
  dropdownPlaceholder: {
    color: '#999',
    fontWeight: '400',
  },
  dropdownList: {
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    marginTop: 6,
    backgroundColor: '#fff',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  dropdownItemActive: {
    backgroundColor: '#E8F5E9',
  },
  dropdownItemText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    marginRight: 8,
  },
  dropdownItemTextActive: {
    color: '#1a5c2a',
    fontWeight: '600',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxActive: {
    backgroundColor: '#1a5c2a',
    borderColor: '#1a5c2a',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
  },
  statusBadgeActive: {
    backgroundColor: '#C8E6C9',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
  },
  statusTextActive: {
    color: '#2E7D32',
  },
  selectedCount: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#1a5c2a',
    marginTop: 10,
  },
  confirmBtn: {
    height: 50,
    borderRadius: 10,
    backgroundColor: '#1a5c2a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
