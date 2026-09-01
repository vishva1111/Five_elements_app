import React, { useState, useEffect } from 'react';
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
  FlatList,
} from 'react-native';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList, Project } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../store/authStore';
import { fetchAllProjects } from '../../services/treeService';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const { signIn, loading } = useAuth();
  const { setAssignedProjects } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });

  // Project selection state
  const [loginStep, setLoginStep] = useState<'credentials' | 'projectSelection'>('credentials');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [loadingProjects, setLoadingProjects] = useState(false);
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
    const { error } = await signIn(email.trim(), password);
    if (error) {
      Alert.alert('Login Failed', error.message ?? 'Invalid credentials. Please try again.');
      return;
    }

    // After successful login, fetch projects for selection
    setFetchingProjects(true);
    try {
      const { data, error: fetchError } = await fetchAllProjects();
      if (fetchError) {
        console.error('Failed to fetch projects:', fetchError);
      }
      if (data && data.length > 0) {
        setProjects(data);
        setLoginStep('projectSelection');
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
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

  const handleProjectConfirm = () => {
    // Get selected project objects
    const selected = projects.filter((p) => selectedProjects.has(p.id));
    setAssignedProjects(selected);
    // Navigation will happen automatically via App.tsx session check
  };

  const handleSkipProjects = () => {
    // Allow user to continue without selecting projects
    setAssignedProjects([]);
  };

  const renderProjectItem = ({ item }: { item: Project }) => {
    const isSelected = selectedProjects.has(item.id);
    return (
      <TouchableOpacity
        style={[styles.projectItem, isSelected && styles.projectItemActive]}
        onPress={() => toggleProjectSelection(item.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
          {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
        </View>
        <View style={styles.projectInfo}>
          <Text style={[styles.projectName, isSelected && styles.projectNameActive]}>
            {item.name}
          </Text>
          {item.description && (
            <Text style={styles.projectDesc} numberOfLines={1}>
              {item.description}
            </Text>
          )}
        </View>
        {item.status && (
          <View style={[styles.statusBadge, item.status === 'active' && styles.statusBadgeActive]}>
            <Text style={[styles.statusText, item.status === 'active' && styles.statusTextActive]}>
              {item.status}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // Show project selection screen
  if (loginStep === 'projectSelection') {
    return (
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.emoji}>🌳</Text>
          <Text style={styles.title}>Select Projects</Text>
          <Text style={styles.subtitle}>Choose projects you want to work in</Text>
        </View>

        {/* Project List */}
        <View style={styles.projectContainer}>
          <Text style={styles.projectHint}>
            Select one or more projects to capture trees in
          </Text>

          {fetchingProjects ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#1a5c2a" />
              <Text style={styles.loadingText}>Loading projects...</Text>
            </View>
          ) : projects.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="folder-open-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>No projects available</Text>
              <Text style={styles.emptySubText}>Contact your administrator</Text>
            </View>
          ) : (
            <>
              <FlatList
                data={projects}
                keyExtractor={(item) => item.id}
                renderItem={renderProjectItem}
                contentContainerStyle={styles.projectList}
                showsVerticalScrollIndicator={false}
              />

              <View style={styles.selectedInfo}>
                <Text style={styles.selectedText}>
                  {selectedProjects.size} project{selectedProjects.size !== 1 ? 's' : ''} selected
                </Text>
              </View>
            </>
          )}

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleProjectConfirm}
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.confirmBtnText}>
                {selectedProjects.size > 0 ? 'Start Working' : 'Continue Without Selection'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipBtn}
              onPress={handleSkipProjects}
            >
              <Text style={styles.skipBtnText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

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
  // Project Selection Styles
  projectContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  projectHint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555',
    marginTop: 12,
  },
  emptySubText: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  projectList: {
    paddingBottom: 16,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    backgroundColor: '#fff',
  },
  projectItemActive: {
    borderColor: '#1a5c2a',
    backgroundColor: '#E8F5E9',
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
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  projectNameActive: {
    color: '#1a5c2a',
  },
  projectDesc: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
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
  selectedInfo: {
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  selectedText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a5c2a',
  },
  actionButtons: {
    gap: 10,
    marginTop: 8,
  },
  confirmBtn: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#1a5c2a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  skipBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
});
