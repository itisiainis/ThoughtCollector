// A line of text that says what just happened and then goes away.
//
// It exists because the useful thing to do after saving a thought is to leave
// the form open and empty, ready for the next one - and a form that empties
// itself and jumps the cursor back to the top looks exactly like a form that
// lost your work. One sentence is enough to tell the two apart.

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import * as T from '../theme';

const VISIBLE_MS = 2200;
const FADE_MS = 180;

/** `flash(text)` shows the text for a moment. An empty message means nothing. */
export function useFlash(): [string, (text: string) => void] {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flash = (text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), VISIBLE_MS);
  };

  return [message, flash];
}

/**
 * The row keeps its height whether or not there is anything to say. A message
 * that pushed the buttons down on its way in would be its own small flinch,
 * right at the moment the point is to reassure.
 */
export default function Flash({ message }: { message: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(message ? 1 : 0, { duration: FADE_MS }),
  }));

  return (
    <Animated.View style={[styles.row, style]} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { height: 18, justifyContent: 'center', marginTop: 6 },
  text: { fontSize: 12, color: T.TEXT_MUTED },
});
