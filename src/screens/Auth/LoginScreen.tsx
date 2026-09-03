import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../store/authStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import logo from '../../assets/logo.png';
import { LinearGradient } from 'expo-linear-gradient';

export default function LoginScreen() {
  const { signIn, loading } = useAuth();
  const { setProjectSelectionPending } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });

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
    // Hold the login screen while authenticating. On success we clear the flag
    // so the App auth handler finishes assigning the user's projects and the
    // dashboard can show the project-selection prompt.
    setProjectSelectionPending(true);
    const { error } = await signIn(email.trim(), password);
    if (error) {
      setProjectSelectionPending(false);
      Alert.alert('Login Failed', error.message ?? 'Invalid credentials. Please try again.');
      return;
    }
    // Success — clear the pending flag so the App auth gate renders the main
    // dashboard once the session + user data are ready. The dashboard then
    // shows the project-selection prompt.
    setProjectSelectionPending(false);
  };

  return (
    <View style={styles.bg}>
      {/* Green gradient on the BOTTOM half only: dark green at the bottom
          fading up to light/white at the top */}
      <LinearGradient
        colors={['#ffffff', '#d7ece0', '#6fae83', '#1a5c2a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.bottomGradient}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Image source={logo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.subtitle}>CARM Field Capture</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.formTitle}>Sign In</Text>
            <Text style={styles.formSub}>
              Use your Five Elements CARM account credentials
            </Text>

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
              loading={loading}
              disabled={loading}
              style={styles.button}
              contentStyle={styles.buttonContent}
              buttonColor="#1a5c2a"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '100%',
  },
  container: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 180,
    height: 180,
    marginBottom: -20,
  },
  subtitle: {
    fontSize: 20,
    color: '#1a5c2a',
    marginTop: -25,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 7.5,
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
    marginBottom: 4,
  },
  formSub: {
    fontSize: 13,
    color: '#888',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#fff',
    marginBottom: 4,
  },
  button: {
    marginTop: 16,
    borderRadius: 7.5,
  },
  buttonContent: {
    paddingVertical: 6,
  },
});
