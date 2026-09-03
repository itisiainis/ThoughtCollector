// The area picker, in the one shape it takes everywhere: a row of chips with
// the choices already on screen. A dropdown hid them behind a tap and made the
// quick capture block and the editor dialog disagree about what picking an area
// looks like.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import type { Area } from '../db';
import * as T from '../theme';

interface Props {
  areas: Area[];
  chosen: number | null;
  onPick: (id: number | null) => void;
}

export default function AreaChips({ areas, chosen, onPick }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.row}
      contentContainerStyle={styles.content}
    >
      <Chip label="no area" active={chosen == null} onPress={() => onPick(null)} />
      {areas.map((area) => (
        <Chip
          key={area.id}
          label={area.name}
          color={area.color}
          active={chosen === area.id}
          onPress={() => onPick(area.id)}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: active ? (color ?? T.NEUTRAL_GREY) : '#EEEEEE' },
      ]}
    >
      <Text style={{ fontSize: 13, fontWeight: active ? 'bold' : 'normal' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: 10, maxHeight: 44 },
  content: { alignItems: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, marginRight: 6 },
});
