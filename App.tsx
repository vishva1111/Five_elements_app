import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View, ActivityIndicator, Text, Image } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './src/services/supabase';
import { useAuthStore } from './src/store/authStore';
import { useTreeStore } from './src/store/treeStore';
import { fetchUserProfile, fetchMyTrees, fetchUserProjects, fetchAllProjects, buildUserFromProfile, computeCreditsForProject, INITIAL_CREDITS, getCachedUserProjects, cacheUserProjects } from './src/services/treeService';
import { getCachedActiveProject } from './src/store/authStore';
import logo from './src/assets/logo.png';

// Screens
import LoginScreen from './src/screens/Auth/LoginScreen';
import HomeScreen from './src/screens/Home/HomeScreen';
import CaptureScreen from './src/screens/Capture/CaptureScreen';
import MapPickerScreen from './src/screens/Capture/MapPickerScreen';
import TreeFormScreen from './src/screens/Capture/TreeFormScreen';
import SubmitSuccessScreen from './src/screens/Capture/SubmitSuccessScreen';

import HistoryScreen from './src/screens/History/HistoryScreen';
import TreeDetailScreen from './src/screens/History/TreeDetailScreen';
import UpdateTreeScreen from './src/screens/History/UpdateTreeScreen';
import EditTreeScreen from './src/screens/History/EditTreeScreen';
import UpdateLookupScreen from './src/screens/History/UpdateLookupScreen';
import ProfileScreen from './src/screens/Profile/ProfileScreen';
import TaskScreen from './src/screens/Task/TaskScreen';
import TreeMapScreen from './src/screens/Map/TreeMapScreen';

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
const UpdateLookupStack = createNativeStackNavigator();

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
        headerTitleStyle: { fontWeight: 'bold', fontSize: 19 },
        headerTitleAlign: 'center',
      }}
    >
      <HistoryStack.Screen name="HistoryList" component={HistoryScreen} options={{ title: 'MY SUBMISSIONS', headerShown: false }} />
      <HistoryStack.Screen name="TreeDetail" component={TreeDetailScreen} options={{ title: 'TREE DETAILS', headerShown: false }} />
      <HistoryStack.Screen name="UpdateTree" component={UpdateTreeScreen} options={{ title: 'AUDIT TREE', headerShown: false }} />
      <HistoryStack.Screen name="EditTree" component={EditTreeScreen} options={{ title: 'EDIT TREE', headerShown: false }} />
    </HistoryStack.Navigator>
  );
}

function UpdateLookupNavigator() {
  return (
    <UpdateLookupStack.Navigator screenOptions={{ headerShown: false }}>
      <UpdateLookupStack.Screen name="UpdateLookup" component={UpdateLookupScreen} />
      <UpdateLookupStack.Screen name="UpdateTree" component={UpdateTreeScreen} />
      <UpdateLookupStack.Screen name="EditTree" component={EditTreeScreen} />
    </UpdateLookupStack.Navigator>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const focusedName = getFocusedRouteNameFromRoute(route);
        const hideTabBar = focusedName === 'UpdateTree' || focusedName === 'EditTree';
        return {
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'home';
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Task') iconName = focused ? 'clipboard' : 'clipboard-outline';
          else if (route.name === 'Update') iconName = focused ? 'clipboard' : 'clipboard-outline';
          else if (route.name === 'History') iconName = focused ? 'list' : 'list-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
          return (
            <View style={{
              backgroundColor: focused ? 'rgba(26,92,42,0.12)' : 'transparent',
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 6,
            }}>
              <Ionicons name={iconName} size={focused ? 24 : 22} color={color} />
            </View>
          );
        },
        tabBarLabel: ({ focused, color }) => {
          const labels: Record<string, string> = {
            Home: 'Home',
            Task: 'Tasks',
            Update: 'Audit',
            History: 'History',
            Profile: 'Profile',
          };
          return (
            <Text style={{
              fontSize: 10,
              fontWeight: focused ? '700' : '500',
              color,
              marginBottom: 2,
              letterSpacing: 0.3,
            }}>
              {labels[route.name] ?? route.name}
            </Text>
          );
        },
        tabBarActiveTintColor: '#1a5c2a',
        tabBarInactiveTintColor: '#999',
        tabBarShowLabel: true,
        tabBarStyle: hideTabBar
          ? { display: 'none' }
          : {
              backgroundColor: '#fff',
              borderTopWidth: 0,
              elevation: 20,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.1,
              shadowRadius: 12,
              paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
              paddingTop: 8,
              height: 68 + (insets.bottom > 0 ? insets.bottom : 8),
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              position: 'absolute',
            },
        headerStyle: { backgroundColor: '#1a5c2a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold', fontSize: 19 },
        headerTitleAlign: 'center',
        };
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false, title: 'DASHBOARD' }} />
      <Tab.Screen name="Task" component={TaskScreen} options={{ headerShown: false, title: 'TASKS' }} />
      <Tab.Screen name="Update" component={UpdateLookupNavigator} options={{ headerShown: false, title: 'AUDIT' }} />
      <Tab.Screen name="History" component={HistoryNavigator} options={{ headerShown: false, title: 'HISTORY' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false, title: 'PROFILE' }} />
    </Tab.Navigator>
  );
}

// ─── Fetch full user data (profile + credits + projects) ──────────────────────
async function loadUserData(userId: string, email: string) {
  const { data: profile, error: profileError } = await fetchUserProfile(userId);
  // Fetch the user's trees — per-project credits are computed below
  const { data: userTrees } = await fetchMyTrees(userId);
  let remainingCredits = INITIAL_CREDITS;

  // ALL projects — the active-project dropdown and restoration use this list,
  // so the app shows every project and can restore any previously-used project.
  let allProjects: any[] = [];
  try {
    const { data } = await fetchAllProjects();
    allProjects = data ?? [];
  } catch {
    allProjects = [];
  }

  // Assigned projects are kept for backward compatibility (login assignment),
  // but no longer gate what can be selected as the active project.
  let assignedProjects: any[] = [];
  try {
    const { data } = await fetchUserProjects(userId);
    assignedProjects = data ?? [];
    if (assignedProjects.length === 0) {
      const cached = await getCachedUserProjects(userId);
      if (cached && cached.length > 0) assignedProjects = cached;
    } else {
      await cacheUserProjects(userId, assignedProjects);
    }
  } catch {
    assignedProjects = [];
  }

  // Restore the LAST ACTIVE project the user was working with (persisted per
  // user on the device). If it no longer exists, or nothing was saved yet,
  // fall back to the first available project so the app always opens with an
  // active project selected.
  const lastActive = await getCachedActiveProject(userId);
  const validLastActive =
    lastActive && allProjects.some((p: any) => p.id === lastActive) ? lastActive : null;
  const initialActiveProjectId = validLastActive ?? allProjects[0]?.id ?? null;

  remainingCredits = computeCreditsForProject(userTrees, initialActiveProjectId);

  const user = buildUserFromProfile(
    userId,
    email,
    profileError ? null : profile,
    remainingCredits
  );

  return { user, projects: assignedProjects, initialActiveProjectId };
}

export default function App() {
  const [session, setSession] = useState<any>(undefined); // undefined = loading, null = no session
  const { setUser, setSession: storeSetSession, setAssignedProjects, setActiveProjectId } = useAuthStore();
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
          .then(({ user, projects, initialActiveProjectId }) => {
            setUser(user);
            // While the user is still choosing projects on the login screen,
            // do NOT overwrite the selection they are about to confirm there —
            // the login screen owns project assignment until it clears the flag
            if (!useAuthStore.getState().projectSelectionPending) {
              setAssignedProjects(projects);
              // Restore the last active project (persisted per user) so the app
              // reopens showing the same project the user was working on. Falls
              // back to the first available project if nothing was stored yet.
              setActiveProjectId(initialActiveProjectId);
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
        <Image source={logo} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator size="large" color="#1a5c2a" style={{ marginTop: 20 }} />
        <Text style={styles.loadingText}>Five Elements</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <NavigationContainer>
            <StatusBar style="light" />
            <RootStack.Navigator screenOptions={{ headerShown: false }}>
              {!session || projectSelectionPending ? (
                <RootStack.Screen name="Login" component={LoginScreen} />
              ) : (
                <>
                  <RootStack.Screen name="Main" component={MainTabs} />
                  <RootStack.Screen name="Capture" component={CaptureNavigator} />
                  <RootStack.Screen name="TreeDetail" component={TreeDetailScreen} options={{ title: 'TREE DETAILS' }} />
                  <RootStack.Screen name="UpdateTree" component={UpdateTreeScreen} options={{ title: 'AUDIT TREE', headerShown: false }} />
                  <RootStack.Screen name="EditTree" component={EditTreeScreen} options={{ title: 'EDIT TREE', headerShown: false }} />
                  <RootStack.Screen name="Map" component={TreeMapScreen} options={{ title: 'MAP', headerShown: false }} />
                </>
              )}
            </RootStack.Navigator>
          </NavigationContainer>
        </PaperProvider>
      </SafeAreaProvider>
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
  loadingLogo: {
    width: 120,
    height: 120,
    marginBottom: 8,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a5c2a',
  },
});
