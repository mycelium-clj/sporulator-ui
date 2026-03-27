declare module "@nextjournal/clojure-mode" {
  import { Extension } from "@codemirror/state";
  import { KeyBinding } from "@codemirror/view";

  export const default_extensions: Extension[];
  export const paredit_keymap: KeyBinding[];
  export const complete_keymap: KeyBinding[];
  export const builtin_keymap: KeyBinding[];
  export function language_support(): Extension;
  export const parser: unknown;
  export const syntax: Extension;
  export const style_tags: unknown;
  export const fold_node_props: unknown;
}

declare module "parinfer" {
  interface ParinferResult {
    text: string;
    success: boolean;
    error?: { name: string; message: string; lineNo: number; x: number };
    cursorX?: number;
    cursorLine?: number;
  }
  interface ParinferOptions {
    cursorLine?: number;
    cursorX?: number;
    commentChars?: string[];
  }
  export function indentMode(text: string, options?: ParinferOptions): ParinferResult;
  export function parenMode(text: string, options?: ParinferOptions): ParinferResult;
  export function smartMode(text: string, options?: ParinferOptions): ParinferResult;
  export const version: string;
}
