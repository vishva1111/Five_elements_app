import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';

export default function SubmitSuccessScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const remainingCredits = user?.credits ?? 0;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark-circle" size={80} color="#22c55e" />
        </View>

        <Text style={styles.title}>Tree Submitted! 🌳</Text>
        <Text style={styles.subtitle}>
          Your tree record has been saved and synced with the admin panel in real-time.
        </Text>

        {/* Updated credit balance — shown immediately after the 1-credit deduction */}
        <View style={styles.creditCard}>
          <View style={styles.creditRow}>
            <View style={styles.creditIconWrap}>
              <Ionicons name="wallet-outline" size={22} color="#1a5c2a" />
            </View>
            <View style={styles.creditInfo}>
              <Text style={styles.creditLabel}>🌳 −1 credit used for this tree</Text>
              <Text style={styles.creditValue}>
                Remaining Credits: <Text style={styles.creditNumber}>{remainingCredits}</Text>
              </Text>
            </View>
          </View>
        </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1a5c2a',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  creditCard: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingVertical:  14,
    paddingHorizontal:  16,
    marginBottom:  16,
    width: '100%',
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap:  12,
  },
  creditIconWrap: {
    width:  42,
    height:  42,
    borderRadius:  21,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent:'center',
  },
  creditInfo: { flex:  1 },
  creditLabel: { fontSize:  12, color: '#666' },
  creditValue: { fontSize:14, fontWeight: '600', color: '#333', marginTop: 2 },
  creditNumber: { color: '#1a5c2a', fontWeight: 'bold', fontSize:17 },
  infoBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    gap: 8,
    marginBottom: 28,
  },
  infoItem: { fontSize: 14, color: '#15803d', fontWeight: '500' },
  captureMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1a5c2a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    width: '100%',
    justifyContent: 'center',
    marginBottom: 12,
  },
  captureMoreText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  homeBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    width: '100%',
    alignItems: 'center',
  },
  homeBtnText: { color: '#1a5c2a', fontWeight: '600', fontSize: 14 },
});
