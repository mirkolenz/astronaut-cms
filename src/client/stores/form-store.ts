/**
 * The forms of a page, such as the fields of an entry. Their values live in a
 * headless editor that shares the page's history, so undo takes back their
 * changes in order with those of the body, and the same on a page without one.
 */
import { create } from "zustand";
import {
  $createParagraphNode,
  $getRoot,
  $getState,
  $setState,
  HISTORIC_TAG,
  REDO_COMMAND,
  UNDO_COMMAND,
  createEditor,
  createState,
} from "lexical";
import { registerHistory } from "@lexical/history";
import { isRecord, type FieldSchema } from "@/shared/field-schema";
import { asRecord } from "@/client/lib/field-values";
import {
  baseUpdate,
  clearPageHistory,
  hasStep,
  historicUpdate,
  pageHistory,
  registerSkipUnchanged,
} from "@/client/lib/page-history";
import { getSelection, isBlockSelection, select } from "@/client/stores/inspector-store";

export type FormValues = Record<string, unknown>;

export interface Form {
  values: FormValues;
  /** The values as stored, or `null` for a draft that saving creates. */
  saved: FormValues | null;
  shape: Record<string, FieldSchema>;
  /** What the form is called, as the way back to it from a value it opens. */
  label: string;
}

const NO_STEPS = { undo: false, redo: false };

const useFormStore = create<{
  forms: Record<string, Form>;
  /** Whether the page's history has a step to undo and to redo. */
  history: { undo: boolean; redo: boolean };
}>()(() => ({ forms: {}, history: NO_STEPS }));

const formsState = createState("cms-forms", {
  parse: (value): Record<string, FormValues> =>
    isRecord(value)
      ? Object.fromEntries(Object.entries(value).map(([id, values]) => [id, asRecord(values)]))
      : {},
});

// Headless, it holds the values of the page's forms for as long as the admin runs.
const formsEditor = createEditor({
  namespace: "cms-forms",
  onError: (error) => {
    throw error;
  },
});

let depths = { undo: 0, redo: 0 };

/** Takes note of whether the page's history has steps, after an update of an editor sharing it. */
export function syncHistory(): void {
  const { undoStack, redoStack } = pageHistory;

  if (undoStack.length === depths.undo && redoStack.length === depths.redo) return;

  depths = { undo: undoStack.length, redo: redoStack.length };
  useFormStore.setState({ history: { undo: hasStep(undoStack), redo: hasStep(redoStack) } });
}

// Lexical restores no state whose root is empty.
formsEditor.update(() => $getRoot().append($createParagraphNode()), {
  discrete: true,
  tag: HISTORIC_TAG,
});
registerHistory(formsEditor, pageHistory, 300);
registerSkipUnchanged(formsEditor);
formsEditor.registerUpdateListener(({ editorState }) => {
  const values = editorState.read(() => $getState($getRoot(), formsState));
  const { forms } = useFormStore.getState();
  // An undo or redo brings the values it restores back to their forms.
  const restored = Object.entries(forms).flatMap(([id, form]) => {
    const next = values[id];

    return next && next !== form.values ? [[id, { ...form, values: next }] as const] : [];
  });

  if (restored.length > 0)
    useFormStore.setState({ forms: { ...forms, ...Object.fromEntries(restored) } });

  syncHistory();
});

// Writes a form's values, as a step to undo, or as where the history starts.
function write(id: string, values: FormValues, mergeKey?: string): void {
  const change = () => $setState($getRoot(), formsState, (forms) => ({ ...forms, [id]: values }));

  if (mergeKey === undefined) baseUpdate(formsEditor, change);
  else historicUpdate(formsEditor, change, mergeKey);
}

// The inspector closes with the forms it shows a value of.
function deselect(closes: (form: string) => boolean): void {
  const selection = getSelection();

  if (selection && !isBlockSelection(selection) && closes(selection.form)) select(null);
}

/** Opens a form, or loads it anew, such as once its entry has been fetched. */
export function openForm(id: string, form: Form): void {
  const current = useFormStore.getState().forms[id];
  // Loaded as they are, the values stay the same object, and so keep their place in the history.
  const same =
    current !== undefined && JSON.stringify(current.values) === JSON.stringify(form.values);
  const next = same
    ? { ...form, values: current.values, saved: form.saved && current.values }
    : form;

  useFormStore.setState(({ forms }) => ({ forms: { ...forms, [id]: next } }));

  if (!same) write(id, next.values);
}

export function closeForm(id: string): void {
  deselect((form) => form === id);
  useFormStore.setState(({ forms }) => ({
    forms: Object.fromEntries(Object.entries(forms).filter(([key]) => key !== id)),
  }));
}

/** Forgets the history, such as once the changes have been discarded. */
export function clearHistory(): void {
  clearPageHistory();
  depths = { undo: 0, redo: 0 };
  useFormStore.setState({ history: NO_STEPS });
}

/** Starts the page over, with no forms and no history. */
export function resetForms(): void {
  deselect(() => true);
  clearHistory();
  useFormStore.setState({ forms: {} });
  baseUpdate(formsEditor, () => $setState($getRoot(), formsState, {}));
}

/** Takes the values a form was saved with as the ones stored. */
export function markSaved(id: string, values: FormValues): void {
  useFormStore.setState(({ forms }) => {
    const form = forms[id];

    return form ? { forms: { ...forms, [id]: { ...form, saved: values } } } : {};
  });
}

export const getForm = (id: string): Form | undefined => useFormStore.getState().forms[id];

export function useForm(id: string): Form | undefined {
  return useFormStore((state) => state.forms[id]);
}

// An undo back to the stored values gives the very object back, so the form is clean again.
const isDirty = (form: Form | undefined) => form !== undefined && form.values !== form.saved;

export function useFormDirty(id: string): boolean {
  return useFormStore((state) => isDirty(state.forms[id]));
}

export function useAnyFormDirty(): boolean {
  return useFormStore((state) => Object.values(state.forms).some(isDirty));
}

/** Sets a field of a form, as a change to undo. */
export function setField(id: string, key: string, value: unknown): void {
  const form = useFormStore.getState().forms[id];

  if (!form) return;

  const values = { ...form.values, [key]: value };

  useFormStore.setState(({ forms }) => ({ forms: { ...forms, [id]: { ...form, values } } }));
  write(id, values, `${id}/${key}`);
}

/** Undoes the page's latest change, of a form or of the body, which its editor then commits. */
export const undo = (): boolean => formsEditor.dispatchCommand(UNDO_COMMAND, undefined);

export const redo = (): boolean => formsEditor.dispatchCommand(REDO_COMMAND, undefined);

export function useCanUndo(): boolean {
  return useFormStore((state) => state.history.undo);
}

export function useCanRedo(): boolean {
  return useFormStore((state) => state.history.redo);
}
