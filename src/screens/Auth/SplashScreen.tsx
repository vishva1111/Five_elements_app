import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { useAuthStore } from '../../store/authStore';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Splash'>;
};

export default function SplashScreen({ navigation }: Props) {
  const { session, loading } = useAuthStore();

  useEffect(() => {
    if (!loading) {
      if (session) {
        navigation.replace('Main');
      } else {
        navigation.replace('Login');
      }
    }
  }, [loading, session]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Text style={styles.emoji}>🌳</Text>
        <Text style={styles.title}>TreeApp</Text>
        <Text style={styles.subtitle}>Five Elements Field Capture</Text>
      </View>
      <Text style={styles.loading}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a5c2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  emoji: {
    fontSize: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    color: '#a5d6a7',
    marginTop: 8,
    letterSpacing: 1,
  },
  loading: {
    color: '#a5d6a7',
    fontSize: 14,
    position: 'absolute',
    bottom: 60,
  },
});