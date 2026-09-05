// Quick capture. Sits at the top of the list screen so writing a thought down
// is the first thing available, not something you navigate to.
//
// Collapsed it is a single line. Tapping it - not typing into it - opens the
// area picker, the description and the buttons underneath; SAVE writes the task
// and empties the fields but leaves them open, because the thought you have
// after writing one down is usually the next one. The block stays out of the
// way until you reach for it: otherwise the list you came to read is pushed off
// the screen.

import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import AreaChips from './AreaChips';
import Flash, { useFlash } from './Flash';
import * as DB from '../db';
import * as T from '../theme';

interface Props {
  areas: DB.Area[];
  onSaved: () => void;
}

export default function QuickCapture({ areas, onSaved }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [areaId, setAreaId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  // The natural height of the block when open. Measured rather than guessed:
  // it changes with the number of areas and with how long the description gets.
  const [contentHeight, setContentHeight] = useState(0);
  const [flashMessage, flash] = useFlash();

  const nameRef = useRef<TextInput>(null);
  const descriptionRef = useRef<TextInput>(null);
  // Moving from the name to the description blurs one field before focusing the
  // next. A blur is only really a blur if nothing takes focus straight after.
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A save is not a dismissal either, and it is the one hand-off the timer
  // above cannot be trusted to cover. Enter on an empty description has to
  // blur the field to count as a submit at all (a multiline field that does
  // not blur inserts a newline instead), so the close timer starts running
  // while the task is still being written - and the focus that would cancel
  // it only comes back after the database has answered. Anything slower than
  // those 120ms shut the drawer just as the cursor returned for the next
  // thought, which is exactly the moment the block is meant to stay open.
  const saving = useRef(false);
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whether either field currently holds focus. The keyboard going away only
  // means the user is done when nothing is focused: Android hides and re-shows
  // it while focus moves from one field to the other, and that flicker arrives
  // as a keyboardDidHide like any real dismissal. Waiting 120ms before acting
  // on it is not enough - the hide event itself is delayed by the keyboard's
  // own animation, so it can land well after focus has already come back.
  const hasFocus = useRef(false);

  // Only a description in progress holds the drawer open. The name stays
  // visible in the collapsed field either way, so nothing typed is ever hidden
  // by closing - and tapping away from a block opened by accident should shut
  // it, not leave it standing.
  const held = () => description.trim().length > 0;

  const scheduleClose = () => {
    if (closing.current) clearTimeout(closing.current);
    if (saving.current) return;
    closing.current = setTimeout(() => {
      if (!held() && !hasFocus.current) setOpen(false);
    }, 120);
  };

  const focused = () => {
    hasFocus.current = true;
    // Focus is back where the save was sending it - the hand-off is over.
    saving.current = false;
    if (closing.current) clearTimeout(closing.current);
    setOpen(true);
  };

  const blurred = () => {
    hasFocus.current = false;
    scheduleClose();
  };

  const keyboardHidden = () => {
    if (!hasFocus.current) scheduleClose();
  };

  // Name and description only - the area stays chosen, the same way SAVE
  // leaves it. Erase alone resets it, since Erase is the one action that means
  // "start completely over" rather than "on to the next thought."
  const clearFields = () => {
    setName('');
    setDescription('');
  };

  const erase = () => {
    clearFields();
    setAreaId(null);
    // Cleared, not closed - Erase means "start over", not "go away".
    nameRef.current?.focus();
  };

  const save = async () => {
    if (!name.trim()) return;
    // Set before the first await, so the blur that Enter causes is already
    // covered by the time it arrives.
    saving.current = true;
    // Cleared by focused() the moment the name field takes it back. This is
    // only the backstop for a focus that never lands - without it the drawer
    // would be held open for good.
    if (giveUp.current) clearTimeout(giveUp.current);
    giveUp.current = setTimeout(() => (saving.current = false), 800);

    await DB.createTask(name.trim(), description.trim(), areaId);
    clearFields();
    // Emptied, not closed - and the cursor goes back where the next thought
    // will be typed. Which, without a word about it, looks exactly like a form
    // that threw the thought away.
    nameRef.current?.focus();
    flash('Task added! Anything else?');
    onSaved();
  };

  // Tapping anywhere outside dismisses the keyboard - the list container is
  // what does that - and the drawer follows it down through the same debounced
  // check a blur uses. It asks first whether a field still holds focus, since
  // the keyboard's brief flicker during a hand-off between the two fields
  // arrives here as a hide and is not a dismissal at all.
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', keyboardHidden);
    return () => hidden.remove();
  });

  // Opening and closing is a transition worth animating. Growing or shrinking
  // while already open is not: after a save clears the fields, the content is
  // suddenly a couple of lines shorter, and animating the drawer down to meet
  // it makes the whole block look like it flinched. Snap in that case.
  const drawerHeight = useSharedValue(0);
  const wasOpen = useRef(open);
  useEffect(() => {
    const transition = wasOpen.current !== open;
    wasOpen.current = open;
    const to = open ? contentHeight : 0;
    drawerHeight.value = transition ? withTiming(to, { duration: T.FOLD_MS }) : to;
  }, [open, contentHeight]);

  const drawer = useAnimatedStyle(() => ({
    height: drawerHeight.value,
    opacity: withTiming(open ? 1 : 0, { duration: T.FOLD_MS }),
  }));

  return (
    <View style={styles.block}>
      <TextInput
        ref={nameRef}
        value={name}
        onChangeText={setName}
        onFocus={focused}
        onBlur={blurred}
        placeholder="write the thought down..."
        placeholderTextColor={T.TEXT_MUTED}
        style={styles.nameInput}
        // multiline so a long title wraps instead of scrolling sideways, but
        // blurOnSubmit keeps Enter as "move on" rather than inserting a line.
        multiline
        blurOnSubmit
        returnKeyType="next"
        onSubmitEditing={() => descriptionRef.current?.focus()}
      />

      {/* Always mounted, only ever zero-height: an unmounted drawer cannot be
          measured, and cannot animate its way out either.

          The contents are absolutely positioned inside it. A normal child of a
          container whose height is being animated gets laid out against that
          height - which is zero while the drawer is shut, so it measured itself
          as nothing and the drawer had nothing to open to. An absolute child is
          measured on its own terms. */}
      <Animated.View style={[styles.drawer, drawer]}>
        <View
          style={styles.drawerContent}
          onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}
        >
          <AreaChips areas={areas} chosen={areaId} onPick={setAreaId} />

          <TextInput
            ref={descriptionRef}
            value={description}
            onChangeText={setDescription}
            onFocus={focused}
            onBlur={blurred}
            placeholder="description..."
            placeholderTextColor={T.TEXT_MUTED}
            multiline
            // Enter submits, the same as the name field's own "next" - but
            // only while the description is still empty. Once there is a line
            // in it, Enter goes back to being an ordinary newline.
            //
            // This used to be done by watching onChangeText for a lone "\n"
            // and swallowing it - but by the time that fires, Android has
            // already committed the newline into its own native text buffer
            // and, on some keyboards, redelivers the same Enter as the action
            // button of whichever field focus lands on next. That is what sent
            // focus jumping straight through the name field and back into this
            // same description box. A dedicated "done" key never inserts a
            // character at all, so there is nothing left for Android to
            // redeliver.
            returnKeyType={description.length === 0 ? 'done' : 'default'}
            blurOnSubmit={description.length === 0}
            onSubmitEditing={description.length === 0 ? () => save() : undefined}
            style={styles.descriptionInput}
          />

          <Flash message={flashMessage} />

          <View style={styles.actions}>
            <Pressable onPress={erase} style={[styles.button, styles.erase]}>
              <Text style={styles.eraseText}>ERASE</Text>
            </Pressable>
            {/* Grows once there is something to save, as sketched. */}
            <Pressable onPress={save} style={[styles.button, styles.save]}>
              <Text style={styles.saveText}>SAVE</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No bottom padding: the rule below the form keeps the same distance from it
  // that the cards keep from each other.
  block: { paddingTop: 6, paddingBottom: 0 },
  drawer: { overflow: 'hidden' },
  drawerContent: { position: 'absolute', top: 0, left: 0, right: 0 },
  nameInput: {
    borderWidth: 1,
    borderColor: '#BDBDBD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#FAFAFA',
    textAlignVertical: 'top',
  },
  descriptionInput: {
    borderWidth: 1,
    borderColor: '#BDBDBD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 62,
    textAlignVertical: 'top',
    backgroundColor: '#FAFAFA',
    marginTop: 6,
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, paddingBottom: 2 },
  button: { borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  erase: { flex: 1, borderWidth: 1, borderColor: '#BDBDBD' },
  eraseText: { color: '#666666', fontWeight: '600' },
  save: { flex: 2, backgroundColor: '#3E5F8A' },
  saveText: { color: '#FFFFFF', fontWeight: '600' },
});
