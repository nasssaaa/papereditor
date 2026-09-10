import { useEffect, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { MonacoBinding } from 'y-monaco';
import * as decoding from 'lib0/decoding';
import { digest } from 'lib0/hash/sha256';
import type { Diagnostic, ProjectFile, User } from '../shared/types';
import { api, websocketUrl } from './api';
(self as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
monaco.languages.register({ id: 'latex' });
monaco.languages.setMonarchTokensProvider('latex', {
  tokenizer: {
    root: [
      [/%.*/, 'comment'],
      [
        /\\(?:begin|end|documentclass|usepackage|section|subsection|chapter|title|author)\b/,
        'keyword',
      ],
      [/\\[a-zA-Z@]+/, 'tag'],
      [/\$[^$]*\$/, 'string'],
      [/[{}\[\]]/, 'delimiter'],
      [/\d+(?:\.\d+)?/, 'number'],
    ],
  },
});
monaco.languages.setLanguageConfiguration('latex', {
  comments: { lineComment: '%' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ],
});
monaco.editor.defineTheme('paper-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'C586C0' },
    { token: 'tag', foreground: 'DCDCAA' },
    { token: 'comment', foreground: '6A9955' },
    { token: 'string', foreground: 'CE9178' },
  ],
  colors: {
    'editor.background': '#1E1E1E',
    'editor.lineHighlightBackground': '#242424',
    'editorLineNumber.foreground': '#858585',
    'editor.selectionBackground': '#264F78',
    'editorCursor.foreground': '#AEAFAD',
    'editorWidget.background': '#252526',
  },
});
export type SaveStatus = 'connecting' | 'saved' | 'saving' | 'offline' | 'readonly' | 'error';
export interface EditorHandle {
  jump(line: number): void;
  search(): void;
  forward(): void;
  flush(): Promise<void>;
  getValue(): string;
  undo(): void;
  redo(): void;
}
interface Props {
  file: ProjectFile;
  user: User;
  readOnly: boolean;
  diagnostics: Diagnostic[];
  onStatus: (s: SaveStatus) => void;
  onCount: (value: number) => void;
  onCompile: () => void;
  onForward: (line: number) => void;
  handle: React.MutableRefObject<EditorHandle | null>;
}
export function SourceEditor(props: Props) {
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null),
    [initialized, setInitialized] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(() => {
    if (!editor) return;
    let disposed = false,
      connected = false,
      ack: Uint8Array | null = null,
      ready = false;
    const doc = new Y.Doc(),
      text = doc.getText('content');
    const persistence = props.readOnly
      ? null
      : new IndexeddbPersistence(`papereditor:${props.user.id}:${props.file.id}`, doc);
    const provider = new WebsocketProvider(websocketUrl('/collab'), props.file.id, doc, {
      connect: false,
      disableBc: true,
    });
    const model = editor.getModel()!;
    const binding = new MonacoBinding(text, model, new Set([editor]), provider.awareness);
    const undo = new Y.UndoManager(text, {
      trackedOrigins: new Set([binding]),
      captureTimeout: 500,
    });
    const flushWaiters = new Set<{
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }>();
    const currentSaved = () =>
      !!ack && digest(new TextEncoder().encode(text.toString())).every((v, i) => v === ack![i]);
    const updateStatus = () => {
      if (disposed) return;
      const status: SaveStatus = props.readOnly
        ? 'readonly'
        : !connected
          ? 'offline'
          : !ready
            ? 'connecting'
            : currentSaved()
              ? 'saved'
              : 'saving';
      propsRef.current.onStatus(status);
      propsRef.current.onCount(
        text
          .toString()
          .replace(/%.*/g, '')
          .replace(/\\[a-zA-Z]+/g, '')
          .replace(/\s|[{}]/g, '').length,
      );
      if (status === 'saved')
        for (const waiter of flushWaiters) {
          clearTimeout(waiter.timer);
          waiter.resolve();
          flushWaiters.delete(waiter);
        }
    };
    provider.messageHandlers[4] = (_encoder, decoder) => {
      ack = decoding.readVarUint8Array(decoder);
      updateStatus();
    };
    provider.on('status', ({ status }: { status: string }) => {
      connected = status === 'connected';
      if (!connected) ack = null;
      updateStatus();
    });
    provider.on('sync', (synced: boolean) => {
      if (synced) {
        ready = true;
        setInitialized(true);
      }
      updateStatus();
    });
    provider.on('connection-close', (event: CloseEvent | null) => {
      if (event && event.code >= 4400 && event.code < 4500) propsRef.current.onStatus('error');
    });
    doc.on('update', () => queueMicrotask(updateStatus));
    propsRef.current.handle.current = {
      jump: (line) => {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      },
      search: () => {
        void editor.getAction('actions.find')?.run();
      },
      forward: () => propsRef.current.onForward(editor.getPosition()?.lineNumber || 1),
      getValue: () => text.toString(),
      undo: () => undo.undo(),
      redo: () => undo.redo(),
      flush: () => {
        if (props.readOnly || (connected && currentSaved())) return Promise.resolve();
        if (!connected) return Promise.reject(new Error('当前处于离线状态，恢复连接后才能编译。'));
        return new Promise<void>((resolve, reject) => {
          const waiter = {
            resolve,
            reject,
            timer: setTimeout(() => {
              flushWaiters.delete(waiter);
              reject(new Error('修改仍在同步，请稍后编译。'));
            }, 8000),
          };
          flushWaiters.add(waiter);
        });
      },
    };
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      propsRef.current.onCompile(),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => undo.undo());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () =>
      undo.redo(),
    );
    const style = document.createElement('style');
    document.head.appendChild(style);
    const decorate = () => {
      const colors = ['#569cd6', '#c586c0', '#4ec9b0', '#d7ba7d', '#ce9178'];
      let css = '';
      for (const [id, state] of provider.awareness.getStates()) {
        if (id === doc.clientID) continue;
        const color = colors[id % colors.length];
        const name = JSON.stringify(String(state.user?.name || '合作者').slice(0, 48)).replaceAll(
          '<',
          '\\3c ',
        );
        css += `.yRemoteSelection-${id}{background:${color}33}.yRemoteSelectionHead-${id}{border-left:2px solid ${color};position:relative}.yRemoteSelectionHead-${id}::after{content:${name};position:absolute;left:-2px;top:-18px;line-height:18px;background:${color};color:#151515;font:11px sans-serif;padding:0 4px;white-space:nowrap;opacity:.85}`;
      }
      style.textContent = css;
    };
    provider.awareness.on('change', decorate);
    const connect = () => {
      if (disposed) return;
      if (text.length > 0) {
        ready = true;
        setInitialized(true);
      }
      provider.connect();
    };
    if (persistence) persistence.whenSynced.then(connect).catch(connect);
    else connect();
    const completion = monaco.languages.registerCompletionItemProvider('latex', {
      triggerCharacters: ['\\', '{'],
      provideCompletionItems: async (model, position) => {
        if (model !== editor.getModel()) return { suggestions: [] };
        const prefix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        };
        if (/\\(?:cite\w*|ref|eqref|autoref)\{[^}]*$/.test(prefix)) {
          const index = await api<{ labels: string[]; citations: string[] }>(
            `/projects/${props.file.projectId}/completions`,
          ).catch(() => ({ labels: [], citations: [] }));
          return {
            suggestions: (/\\cite/.test(prefix) ? index.citations : index.labels).map((label) => ({
              label,
              insertText: label,
              kind: monaco.languages.CompletionItemKind.Reference,
              range,
            })),
          };
        }
        const commands = [
          'section',
          'subsection',
          'chapter',
          'label',
          'ref',
          'cite',
          'textbf',
          'textit',
          'emph',
          'footnote',
          'includegraphics',
          'input',
          'caption',
        ];
        return {
          suggestions: commands.map((label) => ({
            label: '\\' + label,
            insertText: label + '{${1}}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            kind: monaco.languages.CompletionItemKind.Function,
            range,
          })),
        };
      },
    });
    return () => {
      disposed = true;
      propsRef.current.handle.current = null;
      for (const w of flushWaiters) {
        clearTimeout(w.timer);
        w.reject(new Error('文件已切换，请重新编译。'));
      }
      completion.dispose();
      provider.awareness.off('change', decorate);
      style.remove();
      undo.destroy();
      binding.destroy();
      provider.destroy();
      void persistence?.destroy();
      doc.destroy();
    };
  }, [editor, props.file.id, props.user.id, props.readOnly]);
  useEffect(() => {
    if (!editor) return;
    monaco.editor.setModelMarkers(
      editor.getModel()!,
      'latex',
      props.diagnostics
        .filter((d) => d.file === props.file.path)
        .map((d) => ({
          message: d.message,
          severity:
            d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          startLineNumber: Math.min(d.line || 1, editor.getModel()!.getLineCount()),
          startColumn: 1,
          endLineNumber: Math.min(d.line || 1, editor.getModel()!.getLineCount()),
          endColumn: 1000,
        })),
    );
  }, [editor, props.diagnostics, props.file.path]);
  return (
    <Editor
      loading={<div className="editor-loading">正在载入编辑器…</div>}
      defaultLanguage="latex"
      theme="paper-dark"
      path={props.file.id}
      onMount={setEditor}
      options={{
        readOnly: props.readOnly || !initialized,
        fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, "Microsoft YaHei", monospace',
        fontSize: 14,
        lineHeight: 25,
        padding: { top: 18, bottom: 24 },
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderLineHighlight: 'line',
        smoothScrolling: true,
        bracketPairColorization: { enabled: true },
        quickSuggestions: false,
        occurrencesHighlight: 'off',
        unicodeHighlight: { ambiguousCharacters: false, nonBasicASCII: false },
        overviewRulerBorder: false,
      }}
    />
  );
}
