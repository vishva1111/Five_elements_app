import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { GestureHandlerRootView, PanGestureHandler, State } from 'react-native-gesture-handler';
import { StyleSheet, View, ActivityIndicator, Text, Image } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { supabase } from './src/services/supabase';
import { AppDialogHost, setWorkReportUser } from './src/services/appDialog';
import { useAuthStore } from './src/store/authStore';
import { useTreeStore } from './src/store/treeStore';
import { fetchUserProfile, fetchMyTrees, fetchUserProjects, fetchAllProjects, buildUserFromProfile, computeCreditsForProject, INITIAL_CREDITS, getCachedUserProjects, cacheUserProjects } from './src/services/treeService';
import { getCachedActiveProject } from './src/store/authStore';
import logo from './src/assets/logo.png';
import FloatingTabBar from './src/components/FloatingTabBar';

// Screens
import LoginScreen from './src/screens/Auth/LoginScreen';
import HomeScreen from './src/screens/Home/HomeScreen';
import ProjectSelectScreen from './src/screens/Home/ProjectSelectScreen';
import NotificationHistoryScreen from './src/screens/Home/NotificationHistoryScreen';
import CaptureScreen from './src/screens/Capture/CaptureScreen';
import MapPickerScreen from './src/screens/Capture/MapPickerScreen';
import TreeFormScreen from './src/screens/Capture/TreeFormScreen';
import SubmitSuccessScreen from './src/screens/Capture/SubmitSuccessScreen';

import HistoryScreen from './src/screens/History/HistoryScreen';
import TreeDetailScreen from './src/screens/History/TreeDetailScreen';
import UpdateTreeScreen from './src/screens/History/UpdateTreeScreen';
import EditTreeScreen from './src/screens/History/EditTreeScreen';
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
      <HistoryStack.Screen name="HistoryList" component={HistoryScreen} options={{ title: 'SEARCH', headerShown: false }} />
      <HistoryStack.Screen name="TreeDetail" component={TreeDetailScreen} options={{ title: 'TREE DETAILS', headerShown: false }} />
      <HistoryStack.Screen name="UpdateTree" component={UpdateTreeScreen} options={{ title: 'AUDIT TREE', headerShown: false }} />
      <HistoryStack.Screen name="EditTree" component={EditTreeScreen} options={{ title: 'EDIT TREE', headerShown: false }} />
      <HistoryStack.Screen name="Map" component={TreeMapScreen} options={{ title: 'MAP', headerShown: false }} />
    </HistoryStack.Navigator>
  );
}

const HIDE_TAB_BAR_SCREENS = new Set([
  'TreeDetail',
  'Map',
  'UpdateTree',
  'EditTree',
]);

function shouldHideTabBar(state: { index: number; routes: { name: string; state?: { index?: number } }[] }) {
  const route = state.routes[state.index];
  const focusedName = getFocusedRouteNameFromRoute(route as any);
  const routeIndex = route?.state?.index;
  return Boolean(
    (focusedName && HIDE_TAB_BAR_SCREENS.has(focusedName)) ||
    (typeof routeIndex === 'number' && routeIndex > 0)
  );
}

function SwipeTabBar({
  onSync,
  ...props
}: BottomTabBarProps & {
  onSync: (state: BottomTabBarProps['state'], navigation: BottomTabBarProps['navigation']) => void;
}) {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  useEffect(() => {
    onSyncRef.current(props.state, props.navigation);
  }, [props.state, props.navigation]);

  if (shouldHideTabBar(props.state)) return null;
  return <FloatingTabBar {...props} />;
}

function MainTabs() {
  const navRef = useRef<any>(null);
  const indexRef = useRef(0);
  const routesRef = useRef<string[]>([]);
  const swipeEnabledRef = useRef(true);
  const [swipeEnabled, setSwipeEnabled] = useState(true);

  const syncSwipe = (
    tabState: { index: number; routes: { name: string; state?: { index?: number } }[] },
    navigation: any
  ) => {
    navRef.current = navigation;
    indexRef.current = tabState.index;
    routesRef.current = tabState.routes.map((route) => route.name);
    const nextEnabled = !shouldHideTabBar(tabState);
    swipeEnabledRef.current = nextEnabled;
    setSwipeEnabled((current) => (current === nextEnabled ? current : nextEnabled));
  };

  const onPageSwipe = (event: { nativeEvent: { state: number; translationX: number; velocityX: number } }) => {
    if (event.nativeEvent.state !== State.END) return;
    if (!swipeEnabledRef.current || !navRef.current) return;
    const { translationX, velocityX } = event.nativeEvent;
    const nextDelta =
      translationX <= -56 || (translationX < -24 && velocityX < -500)
        ? 1
        : translationX >= 56 || (translationX > 24 && velocityX > 500)
          ? -1
          : 0;
    if (!nextDelta) return;
    const nextName = routesRef.current[indexRef.current + nextDelta];
    if (!nextName) return;
    navRef.current.navigate(nextName);
  };

  return (
    <PanGestureHandler
      enabled={swipeEnabled}
      activeOffsetX={[-28, 28]}
        failOffsetY={[-18, 18]}
        onHandlerStateChange={onPageSwipe}
      >
    <View style={styles.root}>
      <Tab.Navigator
        tabBar={(props) => <SwipeTabBar {...props} onSync={syncSwipe} />}
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false, title: 'DASHBOARD' }} />
        <Tab.Screen name="Task" component={TaskScreen} options={{ headerShown: false, title: 'TASKS' }} />
        <Tab.Screen name="Search" component={HistoryNavigator} options={{ headerShown: false, title: 'SEARCH' }} />
        <Tab.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false, title: 'PROFILE' }} />
      </Tab.Navigator>
    </View>
    </PanGestureHandler>
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
            setWorkReportUser(user?.full_name || user?.email || 'Field user');
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
        <StatusBar style="dark" />
        <Image source={logo} style={styles.loadingLogo} resizeMode="contain" />
        <ActivityIndicator size="large" color="#1a5c2a" style={{ marginTop: 24 }} />
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
                  <RootStack.Screen name="ProjectSelect" component={ProjectSelectScreen} options={{ headerShown: false }} />
                  <RootStack.Screen name="Notifications" component={NotificationHistoryScreen} options={{ headerShown: false }} />
                  <RootStack.Screen name="Capture" component={CaptureNavigator} />
                  <RootStack.Screen name="TreeDetail" component={TreeDetailScreen} options={{ title: 'TREE DETAILS' }} />
                  <RootStack.Screen name="UpdateTree" component={UpdateTreeScreen} options={{ title: 'AUDIT TREE', headerShown: false }} />
                  <RootStack.Screen name="EditTree" component={EditTreeScreen} options={{ title: 'EDIT TREE', headerShown: false }} />
                  <RootStack.Screen name="Map" component={TreeMapScreen} options={{ title: 'MAP', headerShown: false }} />
                </>
              )}
            </RootStack.Navigator>
          </NavigationContainer>
          <AppDialogHost />
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
    backgroundColor: '#ffffff',
  },
  loadingLogo: {
    width: 140,
    height: 140,
    marginBottom: 8,
  },
  loadingText: {
    marginTop: 14,
    fontSize: 22,
    fontWeight: '700',
    color: '#1a5c2a',
    letterSpacing: 1.2,
  },
});
