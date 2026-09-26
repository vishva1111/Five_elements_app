import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';

export default function SubmitSuccessScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContainer,
          {
            paddingTop: Math.max(insets.top, 16) + 16,
            paddingBottom: Math.max(insets.bottom, 16) + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="checkmark-circle" size={80} color="#22c55e" />
          </View>

          <Text style={styles.title}>Tree Submitted! 🌳</Text>
          <Text style={styles.subtitle}>
            Your tree record has been saved and synced with the admin panel in real-time.
          </Text>

          <View style={styles.infoBox}>
            <Text style={styles.infoItem}>✅ Photo uploaded to cloud</Text>
            <Text style={styles.infoItem}>📍 GPS location saved</Text>
            <Text style={styles.infoItem}>🔄 Synced with admin dashboard</Text>
          </View>

          <TouchableOpacity
            style={styles.captureMoreBtn}
            onPress={() => navigation.navigate('CaptureCamera')}
          >
            <Ionicons name="camera" size={20} color="#fff" />
            <Text style={styles.captureMoreText}>Capture Another Tree</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.homeBtn}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={styles.homeBtnText}>Go to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f1',
  },
  scrollContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 36,
    alignItems: 'center',
    width: '100%',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    elevation: 4,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1a5c2a',
    marginBottom: 14,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  creditCard: {
    backgroundColor: '#f0fdf4',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 20,
    width: '100%',
    elevation: 2,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  creditIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  creditInfo: { flex: 1 },
  creditLabel: { fontSize: 13, color: '#666' },
  creditValue: { fontSize: 15, fontWeight: '700', color: '#333', marginTop: 4 },
  creditNumber: { color: '#1a5c2a', fontWeight: '800', fontSize: 18 },
  infoBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    gap: 12,
    marginBottom: 32,
    elevation: 2,
    shadowColor: '#15803d',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  infoItem: { fontSize: 15, color: '#15803d', fontWeight: '600' },
  captureMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1a5c2a',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 32,
    width: '100%',
    justifyContent: 'center',
    marginBottom: 14,
    elevation: 4,
    shadowColor: '#1a5c2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  captureMoreText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  homeBtn: {
    paddingVertical: 16,
    paddingHorizontal: 28,
    width: '100%',
    alignItems: 'center',
    borderRadius: 14,
  },
  homeBtnText: { color: '#1a5c2a', fontWeight: '700', fontSize: 15 },
});
