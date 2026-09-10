import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commandDefinitions,
  bindingsFor,
  matchesBinding,
  formatBinding,
} from '../client/commands.js';
import { writingEdit } from '../client/writing.js';

test('default bindings are unique and require exact platform modifiers', () => {
  for (const mac of [false, true]) {
    const seen = new Set<string>();
    for (const command of commandDefinitions)
      for (const binding of bindingsFor(command, mac)) {
        assert.ok(!seen.has(binding), `${binding} assigned twice`);
        seen.add(binding);
        const parts = binding.split('+');
        const event = {
          code: parts.at(-1)!,
          ctrlKey: !mac && parts.includes('Mod'),
          metaKey: mac && parts.includes('Mod'),
          altKey: parts.includes('Alt'),
          shiftKey: parts.includes('Shift'),
        };
        assert.equal(matchesBinding(event, binding, mac), true);
        for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const)
          assert.equal(
            matchesBinding({ ...event, [modifier]: !event[modifier] }, binding, mac),
            false,
          );
      }
  }
  assert.equal(formatBinding('Mod+Alt+KeyS', true), '⌘+Option+S');
  assert.equal(formatBinding('Mod+Backquote', false), 'Ctrl+`');
});
test('writing helpers preserve TeX content and place empty cursors inside delimiters', () => {
  for (const action of [
    'bold',
    'italic',
    'inlineMath',
    'displayMath',
    'itemize',
    'enumerate',
  ] as const) {
    const empty = writingEdit(action, '');
    assert.equal(empty.length, 0);
    assert.ok(empty.offset > 0 && empty.offset < empty.text.length);
    const result = writingEdit(action, '中文 \\alpha');
    assert.equal(result.text.slice(result.offset, result.offset + result.length), '中文 \\alpha');
  }
  assert.equal(
    writingEdit('itemize', 'one\n\n二').text,
    '\\begin{itemize}\n  \\item one\n  \\item 二\n\\end{itemize}',
  );
});
