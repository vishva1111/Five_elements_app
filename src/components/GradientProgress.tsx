import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { smoothPalette } from '../utils/colorMix';

interface Props {
  progress: number; // 0-100
  size?: number;
  strokeWidth?: number;
  /** The mixed color palette applied along the arc (2+ colors recommended). */
  colors?: string[];
  trackColor?: string;
  children?: React.ReactNode;
}

/**
 * Circular progress ring that fills the 0 → progress arc with a smooth
 * GRADIENT mix of the given palette (colors melt into each other, no hard
 * blocks). Low progress only reveals the first colors; as progress grows,
 * the full gradient blend becomes visible.
 */
export default function GradientProgress({
  progress,
  size = 80,
  strokeWidth = 8,
  colors = ['#f97316', '#fbbf24'],
  trackColor = '#e0e0e0',
  children,
}: Props) {
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, progress));
  const arcLength = (pct / 100) * circumference;

  // Expand the palette into a fine ramp → smooth gradient look.
  const ramp = smoothPalette(colors.length >= 1 ? colors : ['#f97316'], 48);
  const stepLength = arcLength / ramp.length;

  let offset = 0;
  const segments = ramp.map((color, i) => {
    const seg = (
      <Circle
        key={i}
        cx={center}
        cy={center}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${stepLength} ${circumference - stepLength}`}
        strokeDashoffset={-offset}
        strokeLinecap="butt"
        transform={`rotate(-90 ${center} ${center})`}
      />
    );
    offset += stepLength;
    return seg;
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Track background */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Smooth gradient progress segments */}
        {segments}
      </Svg>
      <View style={styles.labelContainer}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
});