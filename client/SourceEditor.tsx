import { useEffect, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { MonacoBinding } from 'y-monaco';
import * as decoding from 'lib0/decoding';
import { digest } from 'lib0/hash/sha256';
import type { Diagnostic, ProjectFile, User } from '../shared/types';
import { api, websocketUrl } from './api';
import { writingEdit, type WritingAction } from './writing';
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
  focus(): void;
  captureSelection(): void;
  clearSelectionCapture(): void;
  action(id: string): void;
  write(action: WritingAction): void;
  position(): number;
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
    propsRef.current.onStatus('connecting');
    let disposed = false,
      connected = false,
      ack: Uint8Array | null = null,
      ready = false;
    let cacheLoaded = false;
    const doc = new Y.Doc(),
      text = doc.getText('content');
    const persistence = props.readOnly
      ? null
      : new IndexeddbPersistence(`papereditor:${props.user.id}:${props.file.id}`, doc);
    const provider = new WebsocketProvider(websocketUrl('/collab'), props.file.id, doc, {
      connect: false,
      disableBc: true,
    });
    // y-websocket normally echoes remote awareness updates. The server binds each
    // client ID to its socket, so only send this document's own awareness state.
    const broadcastAwareness = provider._awarenessUpdateHandler;
    provider.awareness.off('update', broadcastAwareness);
    const ownAwareness = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      const own = {
        added: changes.added.filter((id) => id === doc.clientID),
        updated: changes.updated.filter((id) => id === doc.clientID),
        removed: changes.removed.filter((id) => id === doc.clientID),
      };
      if (own.added.length || own.updated.length || own.removed.length)
        broadcastAwareness(own, origin);
    };
    provider.awareness.on('update', ownAwareness);
    const model = editor.getModel()!;
    // Y.Text and Monaco must count each line break identically on Windows and Mac.
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    const binding = new MonacoBinding(text, model, new Set([editor]), provider.awareness);
    const normalizeLineEndings = () => {
      if (props.readOnly || disposed) return;
      const value = text.toString();
      if (!value.includes('\r')) return;
      // Monaco has already normalized the displayed text; suppress the binding's
      // model edits while bringing the CRDT offsets into the same LF coordinate space.
      binding.mux(() =>
        doc.transact(() => {
          for (let i = value.length - 1; i >= 0; i--)
            if (value[i] === '\r') {
              text.delete(i, 1);
              if (value[i + 1] !== '\n') text.insert(i, '\n');
            }
        }, 'papereditor.lineEndings'),
      );
    };
    const undo = new Y.UndoManager(text, {
      trackedOrigins: new Set([binding]),
      captureTimeout: 500,
    });
    let captured: string[] = [];
    const clearSelectionCapture = () => {
      captured = model.deltaDecorations(captured, []);
    };
    const restoreSelection = () => {
      if (!captured.length) return;
      const selections = captured
        .map((id) => model.getDecorationRange(id))
        .filter((range): range is monaco.Range => !!range)
        .map((range) => monaco.Selection.fromRange(range, monaco.SelectionDirection.LTR));
      clearSelectionCapture();
      if (selections.length) editor.setSelections(selections);
    };
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
        normalizeLineEndings();
        ready = true;
        editor.updateOptions({ readOnly: props.readOnly });
        setInitialized(true);
      }
      updateStatus();
    });
    provider.on('connection-close', (event: CloseEvent | null) => {
      if (event && event.code >= 4400 && event.code < 4500) propsRef.current.onStatus('error');
    });
    doc.on('update', () =>
      queueMicrotask(() => {
        normalizeLineEndings();
        updateStatus();
      }),
    );
    propsRef.current.handle.current = {
      focus: () => editor.focus(),
      position: () => editor.getPosition()?.lineNumber || 1,
      captureSelection: () => {
        captured = model.deltaDecorations(
          captured,
          (editor.getSelections() || []).map((range) => ({
            range,
            options: {
              description: 'papereditor-command-selection',
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            },
          })),
        );
      },
      clearSelectionCapture,
      action: (id) => {
        restoreSelection();
        editor.focus();
        void editor.getAction(id)?.run();
      },
      write: (action) => {
        if (props.readOnly || !ready) return;
        restoreSelection();
        const ranges = (editor.getSelections() || []).sort(monaco.Range.compareRangesUsingStarts);
        const eol = model.getEOL();
        let delta = 0;
        const cursors: { start: number; end: number }[] = [];
        const edits = ranges.map((range) => {
          const value = model.getValueInRange(range),
            result = writingEdit(action, value.replace(/\r\n/g, '\n'));
          const normalized = result.text.replace(/\n/g, eol);
          const offset = result.text.slice(0, result.offset).replace(/\n/g, eol).length;
          const length = result.text
            .slice(result.offset, result.offset + result.length)
            .replace(/\n/g, eol).length;
          const start = model.getOffsetAt(range.getStartPosition()) + delta + offset;
          cursors.push({ start, end: start + length });
          delta += normalized.length - value.length;
          return { range, text: normalized, forceMoveMarkers: true };
        });
        undo.stopCapturing();
        editor.executeEdits('papereditor.writing', edits, () =>
          cursors.map(({ start, end }) =>
            monaco.Selection.fromPositions(model.getPositionAt(start), model.getPositionAt(end)),
          ),
        );
        undo.stopCapturing();
        editor.focus();
      },
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
      undo: () => {
        if (!props.readOnly) {
          restoreSelection();
          undo.undo();
          editor.focus();
        }
      },
      redo: () => {
        if (!props.readOnly) {
          restoreSelection();
          undo.redo();
          editor.focus();
        }
      },
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
    const undoActions = [
      editor.addAction({
        id: 'papereditor.undo',
        label: '撤销自己的修改',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
        precondition: '!editorReadonly',
        run: () => {
          undo.undo();
        },
      }),
      editor.addAction({
        id: 'papereditor.redo',
        label: '重做自己的修改',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ],
        precondition: '!editorReadonly',
        run: () => {
          undo.redo();
        },
      }),
    ];
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
      cacheLoaded = true;
      if (text.length > 0) {
        normalizeLineEndings();
        ready = true;
        editor.updateOptions({ readOnly: props.readOnly });
        setInitialized(true);
      }
      if (navigator.onLine) provider.connect();
    };
    const reconnect = () => {
      if (!disposed && cacheLoaded) provider.connect();
    };
    const disconnect = () => provider.disconnect();
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', disconnect);
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
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', disconnect);
      propsRef.current.handle.current = null;
      for (const w of flushWaiters) {
        clearTimeout(w.timer);
        w.reject(new Error('文件已切换，请重新编译。'));
      }
      completion.dispose();
      clearSelectionCapture();
      undoActions.forEach((action) => action.dispose());
      provider.awareness.off('change', decorate);
      provider.awareness.off('update', ownAwareness);
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
