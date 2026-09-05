// Create and edit share one dialog, as designed. The only difference is the
// buttons: a new item offers CANCEL / DONE, an existing one offers CLOSE, since
// edits to something that already exists save as you type.
//
// The dialog is pinned near the top of the screen and given exactly the height
// left over above the keyboard. A centred dialog ends up behind the keys, and
// KeyboardAvoidingView could only push it - which on a tall dialog pushes the
// title off the screen instead. Anything that does not fit scrolls inside.

import React, { forwardRef, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AreaChips from './AreaChips';
import Flash, { useFlash } from './Flash';
import * as DB from '../db';
import { copyArea, copyTask, shareArea, shareTask } from '../share';
import * as T from '../theme';

const TOP_GAP = 12;

interface AreaEditorProps {
  visible: boolean;
  area: DB.Area | null; // null -> create
  onClose: () => void;
  onChanged: () => void;
}

export function AreaEditor({ visible, area, onClose, onChanged }: AreaEditorProps) {
  const creating = area == null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(T.AREA_PALETTE[0]);
  const [flashMessage, flash] = useFlash();
  const nameRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setName(area?.name ?? '');
    setDescription(area?.description ?? '');
    setColor(area?.color ?? T.AREA_PALETTE[0]);
  }, [visible, area]);

  /** Existing areas write through as you type - there is nothing to confirm. */
  const liveSave = async (fields: Partial<DB.Area>) => {
    if (creating || !area) return;
    await DB.updateArea(area.id, fields);
    onChanged();
  };

  // Creating one area is rarely the last thought of the session, so DONE
  // clears the form and hands focus back to the name rather than closing -
  // the colour stays picked, the same way quick capture keeps its area chosen.
  //
  // The focus is deferred a tick: DONE can also fire from the description
  // field's own Enter key (see onEmptyEnter below), and while Android is still
  // finishing that keypress, focusing the name field immediately hands the
  // same keypress to it - which sent focus straight past the name and into the
  // next field again. Waiting for the current event to finish avoids it.
  const done = async () => {
    if (!name.trim()) return;
    await DB.createArea(name.trim(), description.trim(), color);
    onChanged();
    setName('');
    setDescription('');
    setTimeout(() => nameRef.current?.focus(), 0);
    flash('Area added! Anything else?');
  };

  // Trimming happens on the way out, not on every keystroke: trimming as you
  // type means the space you just pressed is deleted before the next letter.
  const close = async () => {
    if (!creating && area) {
      await DB.updateArea(area.id, {
        name: name.trim() || area.name,
        description: description.trim(),
      });
      onChanged();
    }
    onClose();
  };

  // Both hand out the same text; only the destination differs. The name and
  // description come from the fields rather than from `area`, so what leaves
  // the dialog is what is on the screen - edits write through as you type, but
  // the row this dialog was opened from is a render behind.
  const outgoing = async (edited: DB.Area) =>
    [
      { ...edited, name: name.trim() || edited.name, description },
      await DB.listTasks(edited.id),
    ] as const;

  const share = async () => {
    if (!area) return;
    await shareArea(...(await outgoing(area)));
  };

  const copy = async () => {
    if (!area) return;
    await copyArea(...(await outgoing(area)));
  };

  return (
    <Shell
      visible={visible}
      title={creating ? 'New area' : 'Area'}
      onDismiss={close}
      onShare={creating ? undefined : share}
      onCopy={creating ? undefined : copy}
    >
      <GrowingInput
        ref={nameRef}
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (v.trim()) liveSave({ name: v.trim() });
        }}
        placeholder="area name here..."
        textStyle={styles.areaNameText}
        autoFocus
      />

      <View style={styles.swatches}>
        {T.AREA_PALETTE.map((c) => (
          <Pressable
            key={c}
            onPress={() => {
              setColor(c);
              liveSave({ color: c });
            }}
            style={[
              styles.swatch,
              { backgroundColor: c, borderColor: c === color ? '#000' : c },
            ]}
          />
        ))}
      </View>

      <GrowingInput
        value={description}
        onChangeText={(v) => {
          setDescription(v);
          liveSave({ description: v });
        }}
        onEmptyEnter={creating ? done : undefined}
        placeholder="area description here..."
        textStyle={styles.bodyText}
        minHeight={90}
      />

      <Flash message={flashMessage} />

      <Actions creating={creating} onCancel={onClose} onDone={done} onClose={close} />
    </Shell>
  );
}

interface TaskEditorProps {
  visible: boolean;
  task: DB.Task | null;
  areaId: number | null; // preselected section when creating
  areas: DB.Area[];
  onClose: () => void;
  onChanged: () => void;
}

export function TaskEditor({
  visible,
  task,
  areaId,
  areas,
  onClose,
  onChanged,
}: TaskEditorProps) {
  const creating = task == null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [chosenArea, setChosenArea] = useState<number | null>(null);
  const [flashMessage, flash] = useFlash();
  const nameRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setName(task?.name ?? '');
    setDescription(task?.description ?? '');
    setChosenArea(creating ? areaId : (task?.area_id ?? null));
  }, [visible, task, areaId]);

  const liveSave = async (fields: Partial<DB.Task>) => {
    if (creating || !task) return;
    await DB.updateTask(task.id, fields);
    onChanged();
  };

  const pickArea = async (id: number | null) => {
    setChosenArea(id);
    if (!creating && task && id !== task.area_id) {
      // Manual reassignment also clears the orphan stamp.
      await DB.reassignTask(task.id, id);
      onChanged();
    }
  };

  // Same reasoning as the area editor's DONE: writing several thoughts into
  // the same area, one after another, is the common case, so the area chosen
  // stays chosen and only the name and description are wiped. The focus is
  // deferred for the same reason too - see the note on AreaEditor's done().
  const done = async () => {
    if (!name.trim()) return;
    await DB.createTask(name.trim(), description.trim(), chosenArea);
    onChanged();
    setName('');
    setDescription('');
    setTimeout(() => nameRef.current?.focus(), 0);
    flash('Task added! Anything else?');
  };

  const close = async () => {
    if (!creating && task) {
      await DB.updateTask(task.id, {
        name: name.trim() || task.name,
        description: description.trim(),
      });
      onChanged();
    }
    onClose();
  };

  // As in the area editor: the text is built from the fields, not from `task`,
  // so it carries what is on the screen right now.
  const outgoing = (edited: DB.Task) => {
    const area = chosenArea == null ? null : areas.find((a) => a.id === chosenArea);
    return [{ ...edited, name, description }, area?.name ?? null] as const;
  };

  const share = async () => {
    if (!task) return;
    await shareTask(...outgoing(task));
  };

  const copy = async () => {
    if (!task) return;
    await copyTask(...outgoing(task));
  };

  return (
    <Shell
      visible={visible}
      title={creating ? 'New task' : 'Task'}
      onDismiss={close}
      onShare={creating ? undefined : share}
      onCopy={creating ? undefined : copy}
    >
      <GrowingInput
        ref={nameRef}
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (v.trim()) liveSave({ name: v.trim() });
        }}
        placeholder="task name here..."
        textStyle={styles.taskNameText}
        autoFocus
      />

      <AreaChips areas={areas} chosen={chosenArea} onPick={pickArea} />

      <GrowingInput
        value={description}
        onChangeText={(v) => {
          setDescription(v);
          liveSave({ description: v });
        }}
        onEmptyEnter={creating ? done : undefined}
        placeholder="task description here..."
        textStyle={styles.bodyText}
        minHeight={90}
      />

      <Flash message={flashMessage} />

      <Actions creating={creating} onCancel={onClose} onDone={done} onClose={close} />
    </Shell>
  );
}

// ---------------------------------------------------------------- pieces

/**
 * A field that grows with what is typed into it instead of scrolling its own
 * text out of sight. Both fields are multiline for the same reason - a name
 * long enough to matter is a name you want to read while writing it.
 *
 * `textStyle` carries the font of whatever this text becomes once saved - the
 * card's name, the section band's name, the card's body - so wrapping while
 * writing already breaks where it will break on the list, instead of the
 * generic form-field type this used to draw in.
 */
const GrowingInput = forwardRef<
  TextInput,
  {
    value: string;
    onChangeText: (v: string) => void;
    /** Fires instead of onChangeText when Enter is pressed on an empty field. */
    onEmptyEnter?: () => void;
    placeholder: string;
    textStyle?: object;
    autoFocus?: boolean;
    minHeight?: number;
  }
>(function GrowingInput(
  {
    value,
    onChangeText,
    onEmptyEnter,
    placeholder,
    textStyle,
    autoFocus = false,
    minHeight = 42,
  },
  ref,
) {
  const [height, setHeight] = useState(minHeight);
  // An empty field is one line tall by definition. Waiting for
  // onContentSizeChange to say so leaves a frame of tall, empty box - which is
  // precisely the frame right after a save clears the form.
  const shownHeight = value.length === 0 ? minHeight : height;
  // Only while the field is genuinely empty and something is listening for it
  // - a description field wired to onEmptyEnter - does Enter mean anything
  // other than a newline.
  const submitsWhenEmpty = Boolean(onEmptyEnter) && value.length === 0;
  return (
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      multiline
      autoFocus={autoFocus}
      scrollEnabled={false}
      // A dedicated "done" key, not a sniffed "\n" in onChangeText: that used
      // to let Android commit the newline into its own text buffer before the
      // JS side could react, and on some keyboards the same Enter would then
      // be redelivered to whichever field focus landed on next - sending focus
      // jumping straight through the name field it was meant to land on. The
      // done key never inserts a character, so there is nothing left over to
      // redeliver.
      returnKeyType={submitsWhenEmpty ? 'done' : 'default'}
      blurOnSubmit={submitsWhenEmpty}
      onSubmitEditing={submitsWhenEmpty ? onEmptyEnter : undefined}
      onContentSizeChange={(e) =>
        setHeight(Math.max(minHeight, e.nativeEvent.contentSize.height + 18))
      }
      style={[styles.input, textStyle, { height: shownHeight }]}
    />
  );
});

function Shell({
  visible,
  title,
  onDismiss,
  onShare,
  onCopy,
  children,
}: {
  visible: boolean;
  title: string;
  onDismiss: () => void;
  onShare?: () => void;
  onCopy?: () => void;
  children: React.ReactNode;
}) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKeyboard(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const top = insets.top + TOP_GAP;
  const available = screenHeight - keyboard - top - 16;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      {/* Tapping outside closes; edits are already saved either way. */}
      <Pressable style={styles.scrim} onPress={onDismiss}>
        <View style={[styles.centre, { paddingTop: top }]}>
          <Pressable
            style={[styles.dialog, { maxHeight: Math.max(220, available) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.titleRow}>
              <Text style={styles.dialogTitle}>{title}</Text>
              {/* Same pair, same order as a section header's: copy first, then
                  share. */}
              <View style={styles.titleActions}>
                {onCopy && (
                  <Pressable onPress={onCopy} hitSlop={10} style={styles.shareButton}>
                    <Ionicons name="copy-outline" size={22} color="#1565C0" />
                  </Pressable>
                )}
                {onShare && (
                  <Pressable onPress={onShare} hitSlop={10} style={styles.shareButton}>
                    <Ionicons name="share-social-outline" size={22} color="#1565C0" />
                  </Pressable>
                )}
              </View>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function Actions({
  creating,
  onCancel,
  onDone,
  onClose,
}: {
  creating: boolean;
  onCancel: () => void;
  onDone: () => void;
  onClose: () => void;
}) {
  // Confirming action on the right, matching every other app.
  return (
    <View style={styles.actions}>
      {creating ? (
        <>
          <Pressable onPress={onCancel} style={styles.action}>
            <Text style={styles.actionText}>CANCEL</Text>
          </Pressable>
          <Pressable onPress={onDone} style={styles.action}>
            <Text style={styles.actionText}>DONE</Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={onClose} style={styles.action}>
          <Text style={styles.actionText}>CLOSE</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  centre: { flex: 1, justifyContent: 'flex-start', paddingHorizontal: 13 },
  dialog: { backgroundColor: '#F2F2F2', borderRadius: 14, padding: 18 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dialogTitle: { fontSize: 22, fontWeight: '600' },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareButton: { paddingHorizontal: 4, paddingVertical: 2 },
  input: {
    borderWidth: 1,
    borderColor: '#9E9E9E',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
    marginTop: 10,
  },
  // Mirrors Card's name text - see the note on GrowingInput above.
  taskNameText: { fontSize: 16, fontWeight: 'bold', fontStyle: 'italic' },
  // Mirrors the section band's name text in ListScreen.
  areaNameText: { fontSize: 19, fontWeight: 'bold', fontStyle: 'italic' },
  // Mirrors Card's bodyText - the same for both a task's and an area's body.
  bodyText: { fontSize: 14, lineHeight: T.BODY_LINE_HEIGHT },
  swatches: { flexDirection: 'row', gap: 8, marginTop: 12 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 3 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 4 },
  action: { paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { color: '#1565C0', fontWeight: '600' },
});
