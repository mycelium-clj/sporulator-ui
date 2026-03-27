import { useRef, useEffect } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  default_extensions as clojureExtensions,
  paredit_keymap,
} from "@nextjournal/clojure-mode";

// Dark theme matching sporulator UI
const sporulatorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-bg)",
    color: "var(--color-text-bright)",
    fontSize: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "var(--color-accent)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(139, 92, 246, 0.2)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-bg)",
    color: "var(--color-text)",
    border: "none",
    paddingRight: "8px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--color-text-bright)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(139, 92, 246, 0.25)",
    color: "var(--color-text-bright) !important",
    outline: "1px solid rgba(139, 92, 246, 0.4)",
  },
  ".cm-foldGutter": {
    width: "12px",
  },
  ".cm-foldGutter .cm-gutterElement": {
    color: "var(--color-text)",
    cursor: "pointer",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
});

// Syntax highlighting colors
const sporulatorHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: tags.atom, color: "#f78c6c" },
  { tag: tags.number, color: "#f78c6c" },
  { tag: tags.string, color: "#c3e88d" },
  { tag: tags.character, color: "#c3e88d" },
  { tag: tags.regexp, color: "#89ddff" },
  { tag: tags.comment, color: "#546e7a", fontStyle: "italic" },
  { tag: tags.variableName, color: "#eeffff" },
  { tag: tags.definition(tags.variableName), color: "#82aaff" },
  { tag: tags.function(tags.variableName), color: "#82aaff" },
  { tag: tags.propertyName, color: "#ffcb6b" },
  { tag: tags.labelName, color: "#ffcb6b" },
  { tag: tags.operator, color: "#89ddff" },
  { tag: tags.special(tags.string), color: "#f07178" },
  { tag: tags.meta, color: "#ffcb6b" },
  { tag: tags.bracket, color: "#89ddff" },
  { tag: tags.paren, color: "#89ddff" },
  { tag: tags.squareBracket, color: "#89ddff" },
  { tag: tags.brace, color: "#89ddff" },
  { tag: tags.bool, color: "#f78c6c" },
  { tag: tags.null, color: "#f78c6c" },
  { tag: tags.name, color: "#eeffff" },
]);

interface ClojureEditorProps {
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

export function ClojureEditor({ value, readOnly = true, onChange }: ClojureEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const internalUpdate = useRef(false);
  onChangeRef.current = onChange;

  // Create editor on mount, destroy on unmount
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        sporulatorTheme,
        syntaxHighlighting(sporulatorHighlight),
        bracketMatching(),
        highlightSelectionMatches(),
        foldGutter(),
        history(),
        keymap.of([
          ...paredit_keymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        ...clojureExtensions,
        ...(readOnly
          ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
          : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            internalUpdate.current = true;
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate only when readOnly changes — NOT on value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // Update content when value changes externally (not from user typing)
  useEffect(() => {
    if (internalUpdate.current) {
      internalUpdate.current = false;
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="bg-bg rounded-lg border border-border overflow-hidden"
    />
  );
}
