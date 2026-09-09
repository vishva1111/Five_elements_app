import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Ring {
  progress: number; // 0-100
  color: string;
  label: string;
}

interface Props {
  rings: Ring[];
  size?: number;
  strokeWidth?: number;
}

export default function MultiProgressRing({ rings, size = 120, strokeWidth = 10 }: Props) {
  const center = size / 2;
  const baseRadius = (size - strokeWidth) / 2 - 5;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {rings.map((ring, index) => {
          const radius = baseRadius - index * (strokeWidth + 4);
          const circumference = 2 * Math.PI * radius;
          const strokeDashoffset = circumference - (ring.progress / 100) * circumference;

          return (
            <Circle
              key={index}
              cx={center}
              cy={center}
              r={radius}
              stroke={index === 0 ? '#e0e0e0' : 'transparent'}
              strokeWidth={strokeWidth}
              fill="none"
            />
          );
        })}
        {rings.map((ring, index) => {
          const radius = baseRadius - index * (strokeWidth + 4);
          const circumference = 2 * Math.PI * radius;
          const strokeDashoffset = circumference - (ring.progress / 100) * circumference;

          return (
            <Circle
              key={`progress-${index}`}
              cx={center}
              cy={center}
              r={radius}
              stroke={ring.color}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${center} ${center})`}
            />
          );
        })}
      </Svg>
      <View style={styles.labelContainer}>
        <Text style={styles.mainLabel}>{rings[0]?.progress ?? 0}%</Text>
        <Text style={styles.subLabel}>Complete</Text>
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
  mainLabel: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  subLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
});
