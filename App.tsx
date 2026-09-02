import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View, ActivityIndicator, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './src/services/supabase';
import { useAuthStore } from './src/store/authStore';
import { useTreeStore } from './src/store/treeStore';
import { fetchUserProfile, fetchMyTrees, fetchUserProjects, buildUserFromProfile, computeCredits, getCachedUserProjects, cacheUserProjects } from './src/services/treeService';

// Screens
import LoginScreen from './src/screens/Auth/LoginScreen';
import HomeScreen from './src/screens/Home/HomeScreen';
import CaptureScreen from './src/screens/Capture/CaptureScreen';
import MapPickerScreen from './src/screens/Capture/MapPickerScreen';
import TreeFormScreen from './src/screens/Capture/TreeFormScreen';
import SubmitSuccessScreen from './src/screens/Capture/SubmitSuccessScreen';
import HistoryScreen from './src/screens/History/HistoryScreen';
import TreeDetailScreen from './src/screens/History/TreeDetailScreen';
import ProfileScreen from './src/screens/Profile/ProfileScreen';

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1a5c2a',
    secondary: '#4caf50',
    background: '#f5f5f5',
  },
};

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const CaptureStack = createNativeStackNavigator();
const HistoryStack = createNativeStackNavigator();

function CaptureNavigator() {
  return (
    <CaptureStack.Navigator screenOptions={{ headerShown: false }}>
      <CaptureStack.Screen name="CaptureCamera" component={CaptureScreen} />
      <CaptureStack.Screen name="MapPicker" component={MapPickerScreen} />
      <CaptureStack.Screen name="TreeForm" component={TreeFormScreen} />
      <CaptureStack.Screen name="SubmitSuccess" component={SubmitSuccessScreen} />
    </CaptureStack.Navigator>
  );
}

function HistoryNavigator() {
  return (
    <HistoryStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#1a5c2a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <HistoryStack.Screen name="HistoryList" component={HistoryScreen} options={{ title: 'My Submissions' }} />
      <HistoryStack.Screen name="TreeDetail" component={TreeDetailScreen} options={{ title: 'Tree Details' }} />
    </HistoryStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'home';
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Capture') iconName = focused ? 'camera' : 'camera-outline';
          else if (route.name === 'History') iconName = focused ? 'list' : 'list-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#1a5c2a',
        tabBarInactiveTintColor: '#888',
        tabBarStyle: { paddingBottom: 4, height: 60 },
        headerStyle: { backgroundColor: '#1a5c2a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="Capture" component={CaptureNavigator} options={{ headerShown: false, title: 'Capture Tree' }} />
      <Tab.Screen name="History" component={HistoryNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'My Profile' }} />
    </Tab.Navigator>
  );
}

// ─── Fetch full user data (profile + credits + projects) ──────────────────────
async function loadUserData(userId: string, email: string) {
  const { data: profile, error: profileError } = await fetchUserProfile(userId);
  // Fetch the user's trees — credits are computed from the selected projects below
  const { data: userTrees } = await fetchMyTrees(userId);
  let remainingCredits = 0;
 
  let projects: any[] = [];
  try {
    const { data: userProjects } = await fetchUserProjects(userId);
    // Only the projects this user selected at login are visible — no fallback
    projects = userProjects ?? [];
    if (projects.length === 0) {
      // Fall back to the last selection saved on this device, so the app
      // opens directly with the already-selected projects
      const cached = await getCachedUserProjects(userId);
      if (cached && cached.length > 0) projects = cached;
    } else {
      // Keep the device cache fresh for future fallbacks
      await cacheUserProjects(userId, projects);
    }
  } catch {
    projects = [];
  }

  // Credits = 500 given credits minus trees added in the selected projects
  remainingCredits = computeCredits(userTrees, projects);

  const user = buildUserFromProfile(
    userId,
    email,
    profileError ? null : profile,
    remainingCredits
  );

  return { user, projects };
}

export default function App() {
  const [session, setSession] = useState<any>(undefined); // undefined = loading, null = no session
  const { setUser, setSession: storeSetSession, setAssignedProjects } = useAuthStore();
  // While the user is choosing projects on the login page, keep them there
  const projectSelectionPending = useAuthStore((s) => s.projectSelectionPending);
  // Remember which user we already loaded so one login never loads twice
  const loadedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Get initial session with 4s timeout
    const timer = setTimeout(() => {
      if (session === undefined) {
        setSession(null);
        setUser(null);
      }
    }, 4000);

    // ─── Single owner of auth state ──────────────────────────────────────────
    // IMPORTANT: never await inside the listener callback. supabase-js holds an
    // internal auth lock while callbacks run — awaiting DB queries here deadlocks
    // the sign-in that follows a logout (the "have to login twice" bug).
    const handleAuthChange = (event: string, s: any) => {
      // Only react to real session transitions — ignore TOKEN_REFRESHED etc.
      if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') {
        return;
      }

      setSession(s ?? null);
      storeSetSession(s ?? null);

      if (s?.user) {
        // Skip duplicate loads for the same login (repeated SIGNED_IN events)
        if (loadedUserIdRef.current === s.user.id) return;
        loadedUserIdRef.current = s.user.id;
        // Fire and forget — a data-loading failure must NEVER log the user out
        loadUserData(s.user.id, s.user.email ?? '')
          .then(({ user, projects }) => {
            setUser(user);
            // While the user is still choosing projects on the login screen,
            // do NOT overwrite the selection they are about to confirm there —
            // the login screen owns project assignment until it clears the flag
            if (!useAuthStore.getState().projectSelectionPending) {
              setAssignedProjects(projects);
            }
          })
          .catch((err) => {
            console.warn('[TreeApp] Failed to load user data:', err);
          });
      } else {
        loadedUserIdRef.current = null;
        setUser(null);
        setAssignedProjects([]);
        // Clear the previous user's trees from the store
        useTreeStore.getState().setTrees([]);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      clearTimeout(timer);
      handleAuthChange('INITIAL_SESSION', data.session ?? null);
    }).catch(() => {
      clearTimeout(timer);
      setSession(null);
      setUser(null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthChange);

    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  if (session === undefined) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingEmoji}>🌳</Text>
        <ActivityIndicator size="large" color="#1a5c2a" style={{ marginTop: 16 }} />
        <Text style={styles.loadingText}>TreeApp</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <PaperProvider theme={theme}>
        <NavigationContainer>
          <StatusBar style="light" backgroundColor="#1a5c2a" />
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            {!session || projectSelectionPending ? (
              <RootStack.Screen name="Login" component={LoginScreen} />
            ) : (
              <RootStack.Screen name="Main" component={MainTabs} />
            )}
          </RootStack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingEmoji: { fontSize: 64 },
  loadingText: {
    marginTop: 12,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a5c2a',
  },
});
