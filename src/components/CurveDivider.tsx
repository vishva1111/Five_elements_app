import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

interface Props {
  height?: number;
  color?: string;
  cornerRadius?: number;
  style?: ViewStyle;
}

export default function CurveDivider({ height = 30, color = '#f5f5f5', cornerRadius = 24, style }: Props) {
  return (
    <View style={[{ height }, style]}>
      <View
        style={{
          flex: 1,
          backgroundColor: color,
          borderTopLeftRadius: cornerRadius,
          borderTopRightRadius: cornerRadius,
        }}
      />
    </View>
  );
}
