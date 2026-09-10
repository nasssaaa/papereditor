import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { bindingsFor, formatBinding, type Command } from './commands';

export function CommandPalette({
  commands,
  kind,
  onClose,
  onRun,
}: {
  commands: Command[];
  kind: 'commands' | 'shortcuts' | 'files';
  onClose: () => void;
  onRun: (command: Command) => void;
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const title = { commands: '命令面板', shortcuts: '快捷键速查', files: '快速打开' }[kind];
  const words = query.trim().toLocaleLowerCase().split(/\s+/);
  const filtered = commands.filter((c) =>
    words.every((w) =>
      `${c.title} ${c.category} ${c.keywords} ${bindingsFor(c)
        .map((b) => formatBinding(b))
        .join(' ')}`
        .toLocaleLowerCase()
        .includes(w),
    ),
  );
  const index = Math.min(selected, Math.max(0, filtered.length - 1));
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index, query]);
  const choose = (command: Command) => {
    if (!command.disabledReason && !command.referenceOnly) onRun(command);
  };
  return (
    <div
      className="command-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setSelected(
              (index + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
                Math.max(1, filtered.length),
            );
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[index]) choose(filtered[index]);
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            input.current?.focus();
          }
        }}
      >
        <div className="command-heading">
          <span>{title}</span>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="command-input">
          <Search size={17} />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={filtered[index] ? `command-option-${index}` : undefined}
            aria-label={kind === 'files' ? '快速打开文件名' : '搜索命令'}
            placeholder={kind === 'files' ? '输入文件名…' : '输入操作名称，例如：编译、公式、快照…'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
          />
        </div>
        <div
          className="command-results"
          role="listbox"
          id="command-results"
          aria-label={title}
          ref={list}
        >
          {filtered.map((command, i) => (
            <button
              key={command.id}
              role="option"
              id={`command-option-${i}`}
              aria-selected={i === index}
              aria-disabled={!!command.disabledReason || !!command.referenceOnly}
              tabIndex={-1}
              data-index={i}
              data-command={command.id}
              className={`command-option ${i === index ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setSelected(i)}
              onClick={() => choose(command)}
            >
              <span className="command-description">
                <span>
                  <small>{command.category}</small>
                  {command.title}
                </span>
                {command.disabledReason && <em>{command.disabledReason}</em>}
              </span>
              <span className="command-keys">
                {bindingsFor(command).map((binding) => (
                  <kbd key={binding}>{formatBinding(binding)}</kbd>
                ))}
              </span>
            </button>
          ))}
          {!filtered.length && <p className="command-empty">没有匹配的操作</p>}
        </div>
        <footer>
          <span>↑ ↓ 选择 · Enter 执行 · Esc 返回</span>
          <span>{filtered.length} 项</span>
        </footer>
      </div>
    </div>
  );
}
