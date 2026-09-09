import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export default function CurveDivider() {
  return (
    <View style={styles.container}>
      <Svg width="100%" height={40} viewBox="0 0 400 40" preserveAspectRatio="none">
        <Path
          d="M0,0 Q200,40 400,0 L400,40 L0,40 Z"
          fill="#E8F5E9"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
});
