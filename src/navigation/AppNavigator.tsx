import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';

// Screens
import SplashScreen from '../screens/Auth/SplashScreen';
import LoginScreen from '../screens/Auth/LoginScreen';
import HomeScreen from '../screens/Home/HomeScreen';
import CaptureScreen from '../screens/Capture/CaptureScreen';
import MapPickerScreen from '../screens/Capture/MapPickerScreen';
import TreeFormScreen from '../screens/Capture/TreeFormScreen';
import SubmitSuccessScreen from '../screens/Capture/SubmitSuccessScreen';
import HistoryScreen from '../screens/History/HistoryScreen';
import TreeDetailScreen from '../screens/History/TreeDetailScreen';
import ProfileScreen from '../screens/Profile/ProfileScreen';

import {
  RootStackParamList,
  MainTabParamList,
  CaptureStackParamList,
  HistoryStackParamList,
} from '../types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const CaptureStack = createNativeStackNavigator<CaptureStackParamList>();
const HistoryStack = createNativeStackNavigator<HistoryStackParamList>();

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
      <HistoryStack.Screen
        name="HistoryList"
        component={HistoryScreen}
        options={{ title: 'My Submissions' }}
      />
      <HistoryStack.Screen
        name="TreeDetail"
        component={TreeDetailScreen}
        options={{ title: 'Tree Details' }}
      />
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
      <Tab.Screen
        name="Capture"
        component={CaptureNavigator}
        options={{ headerShown: false, title: 'Capture Tree' }}
      />
            <Tab.Screen name="History" component={HistoryNavigator} options={{ headerShown: true, title: 'My Submissions' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'My Profile' }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { session } = useAuthStore();

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {!session ? (
        <>
          <RootStack.Screen name="Splash" component={SplashScreen} />
          <RootStack.Screen name="Login" component={LoginScreen} />
        </>
      ) : (
        <RootStack.Screen name="Main" component={MainTabs} />
      )}
    </RootStack.Navigator>
  );
}