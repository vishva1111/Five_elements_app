import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Props {
  size?: number;
  progress: number; // 0..100
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
}

export default function CircularProgress({
  size = 72,
  progress,
  strokeWidth = 6,
  color = '#1a5c2a',
  trackColor = '#E8F5E9',
  children,
}: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(100, Math.max(0, progress));
  const strokeDashoffset = circumference - (clampedProgress / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        style={StyleSheet.absoluteFill}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {/* Center content */}
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </View>
    </View>
  );
}