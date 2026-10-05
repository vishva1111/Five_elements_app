import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TABS: { name: string; label: string; icon: keyof typeof Ionicons.glyphMap; iconOutline: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'Home', label: 'Home', icon: 'leaf', iconOutline: 'leaf-outline' },
  { name: 'Task', label: 'Tasks', icon: 'layers', iconOutline: 'layers-outline' },
  { name: 'Search', label: 'Search', icon: 'compass', iconOutline: 'compass-outline' },
  { name: 'Profile', label: 'Profile', icon: 'person-circle', iconOutline: 'person-circle-outline' },
];

export default function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const slideX = useRef(new Animated.Value(0)).current;
  const count = Math.max(state.routes.length, 1);
  const slot = barWidth > 0 ? barWidth / count : 0;

  useEffect(() => {
    if (!slot) return;
    Animated.timing(slideX, {
      toValue: state.index * slot,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideX, slot, state.index]);

  const goTo = (index: number) => {
    const route = state.routes[index];
    if (!route || index === state.index) return;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
    >
      {slot > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.slider,
            {
              width: 52,
              transform: [{ translateX: Animated.add(slideX, (slot - 52) / 2) }],
            },
          ]}
        />
      ) : null}
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const tab = TABS.find((item) => item.name === route.name) ?? TABS[0];
        return (
          <Pressable
            key={route.key}
            onPress={() => goTo(index)}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            style={styles.item}
          >
            <View style={styles.iconWrap}>
              <Ionicons
                name={focused ? tab.icon : tab.iconOutline}
                size={22}
                color={focused ? '#1a5c2a' : '#9AA0A6'}
              />
            </View>
            <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 12,
  },
  slider: {
    position: 'absolute',
    top: 10,
    left: 0,
    height: 32,
    borderRadius: 14,
    backgroundColor: '#E5F6EA',
  },
  item: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 52,
    height: 32,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  label: {
    color: '#9AA0A6',
    fontSize: 11,
    fontWeight: '600',
  },
  labelActive: {
    color: '#1a5c2a',
    fontWeight: '700',
  },
});
