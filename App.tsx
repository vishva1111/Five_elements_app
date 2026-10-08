import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { GestureHandlerRootView, PanGestureHandler, State } from 'react-native-gesture-handler';
import { Animated, Easing, StyleSheet, View, ActivityIndicator, Text, Image, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { supabase } from './src/services/supabase';
import { AppDialogHost, setWorkReportUser } from './src/services/appDialog';
import { getCachedActiveProject, useAuthStore } from './src/store/authStore';
import { useTreeStore } from './src/store/treeStore';
import { fetchUserProfile, fetchUserProjects, fetchAllProjects, buildUserFromProfile } from './src/services/treeService';
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
      <HistoryStack.Screen name="EditTree" component={EditTreeScreen} options={{ title: 'EDIT TREE', headerShown: false }} />
      <HistoryStack.Screen name="Map" component={TreeMapScreen} options={{ title: 'MAP', headerShown: false }} />
    </HistoryStack.Navigator>
  );
}

const HIDE_TAB_BAR_SCREENS = new Set([
  'TreeDetail',
  'Map',
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

function MainTabs() {
  const { width } = useWindowDimensions();
  const slideX = useRef(new Animated.Value(0)).current;
  const tabIndexRef = useRef(0);
  const tabStateRef = useRef<BottomTabBarProps['state'] | null>(null);
  const tabNavRef = useRef<BottomTabBarProps['navigation'] | null>(null);

  const onTabSwipe = (event: { nativeEvent: { state: number; translationX: number; velocityX: number } }) => {
    if (event.nativeEvent.state !== State.END) return;
    const tabState = tabStateRef.current;
    const tabNavigation = tabNavRef.current;
    if (!tabState || !tabNavigation || shouldHideTabBar(tabState)) return;
    const { translationX, velocityX } = event.nativeEvent;
    const nextIndex =
      translationX < -56 || velocityX < -650
        ? tabState.index + 1
        : translationX > 56 || velocityX > 650
          ? tabState.index - 1
          : tabState.index;
    const route = tabState.routes[nextIndex];
    if (!route || nextIndex === tabState.index) return;
    tabNavigation.navigate(route.name);
  };

  return (
    <PanGestureHandler
      activeOffsetX={[-28, 28]}
      failOffsetY={[-16, 16]}
      onHandlerStateChange={onTabSwipe}
    >
    <Animated.View style={{ flex: 1, transform: [{ translateX: slideX }] }}>
    <Tab.Navigator
      tabBar={(props) => {
        tabStateRef.current = props.state;
        tabNavRef.current = props.navigation;
        if (props.state.index !== tabIndexRef.current) {
          const direction = props.state.index > tabIndexRef.current ? 1 : -1;
          tabIndexRef.current = props.state.index;
          slideX.setValue(direction * Math.min(width * 0.18, 72));
          Animated.timing(slideX, {
            toValue: 0,
            duration: 180,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        }
        return shouldHideTabBar(props.state) ? null : <FloatingTabBar {...props} />;
      }}
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
    </Animated.View>
    </PanGestureHandler>
  );
}

// ─── Fetch full user data (profile + credits + projects) ──────────────────────
async function loadUserData(userId: string, email: string, metadata?: any) {
  const { data: profile, error: profileError } = await fetchUserProfile(userId);

  // Admins keep the full catalog. Every other signed-in user sees only the
  // projects assigned to them.
  const isAdmin = String(profile?.role ?? '').trim().toLowerCase() === 'admin';
  let catalog: any[] = [];
  if (isAdmin) {
    try {
      const { data } = await fetchAllProjects();
      catalog = data ?? [];
    } catch {
      catalog = [];
    }
  }

  let assignedProjects: any[] = [];
  try {
    const { data } = await fetchUserProjects(userId);
    assignedProjects = data ?? [];
  } catch {
    assignedProjects = [];
  }
  const visibleProjects = isAdmin && catalog.length > 0 ? catalog : assignedProjects;

  const cachedProjectId = await getCachedActiveProject(userId);
  const initialActiveProjectId =
    (cachedProjectId && visibleProjects.some((project) => project.id === cachedProjectId)
      ? cachedProjectId
      : null) ??
    visibleProjects[0]?.id ??
    null;

  const user = buildUserFromProfile(
    userId,
    email,
    profileError ? null : profile,
    null,
    metadata
  );

  return { user, projects: visibleProjects, initialActiveProjectId };
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
        loadUserData(s.user.id, s.user.email ?? '', s.user.user_metadata)
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
