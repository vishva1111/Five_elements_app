import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface Props {
  height?: number;
  color?: string;
  cornerRadius?: number;
  style?: ViewStyle;
}

export default function CurveDivider({ height = 30, color = '#E8F5E9', cornerRadius = 24, style }: Props) {
  return (
    <View style={[styles.container, style]}>
      <Svg width="100%" height={height} viewBox={`0 0 400 ${height}`} preserveAspectRatio="none">
        <Path
          d={`M0,0 Q200,${height} 400,0 L400,${height} L0,${height} Z`}
          fill={color}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 0,
  },
});
