export type WritingAction =
  | 'bold'
  | 'italic'
  | 'inlineMath'
  | 'displayMath'
  | 'itemize'
  | 'enumerate';
export function writingEdit(action: WritingAction, value: string) {
  if (action === 'itemize' || action === 'enumerate') {
    const lines = value.split(/\r?\n/).filter((line) => line.trim());
    const prefix = `\\begin{${action}}\n  \\item `;
    const text = prefix + (lines.length ? lines.join('\n  \\item ') : '') + `\n\\end{${action}}`;
    return {
      text,
      offset: prefix.length,
      length: lines.length ? text.length - prefix.length - `\n\\end{${action}}`.length : 0,
    };
  }
  const [prefix, suffix] = {
    bold: ['\\textbf{', '}'],
    italic: ['\\textit{', '}'],
    inlineMath: ['\\(', '\\)'],
    displayMath: ['\\[\n', '\n\\]'],
  }[action];
  return { text: prefix + value + suffix, offset: prefix.length, length: value.length };
}
