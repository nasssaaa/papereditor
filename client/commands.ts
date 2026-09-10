export type CommandScope = 'workspace' | 'editor' | 'context';
export interface CommandDefinition {
  id: string;
  title: string;
  category: string;
  keywords: string;
  keys?: string[];
  windowsKeys?: string[];
  scope?: CommandScope;
  repeat?: boolean;
  referenceOnly?: boolean;
}
export const commandDefinitions: CommandDefinition[] = [
  {
    id: 'palette',
    title: '打开命令面板',
    category: '工作区',
    keywords: 'command palette commands',
    keys: ['Mod+Shift+KeyP', 'F1'],
  },
  { id: 'shortcuts', title: '快捷键速查', category: '帮助', keywords: 'keyboard shortcuts help' },
  {
    id: 'quick',
    title: '快速打开文件',
    category: '文件',
    keywords: 'quick open file',
    keys: ['Mod+KeyP'],
  },
  {
    id: 'save',
    title: '保存并编译',
    category: '编译',
    keywords: 'save build compile',
    keys: ['Mod+KeyS'],
  },
  {
    id: 'compile',
    title: '编译论文',
    category: '编译',
    keywords: 'build compile latex',
    keys: ['Mod+Shift+KeyB'],
  },
  { id: 'cancel', title: '停止编译', category: '编译', keywords: 'stop cancel build' },
  {
    id: 'find',
    title: '搜索当前区域',
    category: '搜索',
    keywords: 'find search source pdf',
    keys: ['Mod+KeyF'],
    scope: 'context',
  },
  {
    id: 'search',
    title: '项目全文搜索',
    category: '搜索',
    keywords: 'project search all files',
    keys: ['Mod+Shift+KeyF'],
  },
  {
    id: 'sidebar',
    title: '显示／隐藏侧栏',
    category: '视图',
    keywords: 'toggle sidebar explorer',
    keys: ['Mod+KeyB'],
  },
  {
    id: 'output',
    title: '显示／隐藏编译输出',
    category: '视图',
    keywords: 'toggle output log problems',
    keys: ['Mod+Backquote'],
  },
  {
    id: 'forward',
    title: '源码定位到 PDF',
    category: '定位',
    keywords: 'synctex sync source pdf',
    keys: ['Mod+Alt+KeyS'],
  },
  {
    id: 'focus',
    title: '源码与 PDF 切换焦点',
    category: '视图',
    keywords: 'focus switch source pdf preview',
    keys: ['Mod+Alt+KeyV'],
  },
  {
    id: 'nextProblem',
    title: '下一个问题',
    category: '定位',
    keywords: 'next error warning diagnostic',
    keys: ['F8'],
  },
  {
    id: 'previousProblem',
    title: '上一个问题',
    category: '定位',
    keywords: 'previous error warning diagnostic',
    keys: ['Shift+F8'],
  },
  {
    id: 'comment',
    title: '注释／取消注释',
    category: '编辑',
    keywords: 'toggle line comment',
    keys: ['Mod+Slash'],
    scope: 'editor',
  },
  {
    id: 'undo',
    title: '撤销自己的修改',
    category: '编辑',
    keywords: 'undo',
    keys: ['Mod+KeyZ'],
    scope: 'editor',
    repeat: true,
  },
  {
    id: 'redo',
    title: '重做自己的修改',
    category: '编辑',
    keywords: 'redo',
    keys: ['Mod+Shift+KeyZ'],
    windowsKeys: ['Mod+KeyY'],
    scope: 'editor',
    repeat: true,
  },
  {
    id: 'moveUp',
    title: '向上移动行',
    category: '编辑',
    keywords: 'move line up',
    keys: ['Alt+ArrowUp'],
    scope: 'editor',
    repeat: true,
  },
  {
    id: 'moveDown',
    title: '向下移动行',
    category: '编辑',
    keywords: 'move line down',
    keys: ['Alt+ArrowDown'],
    scope: 'editor',
    repeat: true,
  },
  {
    id: 'copyUp',
    title: '向上复制行',
    category: '编辑',
    keywords: 'copy line up',
    keys: ['Alt+Shift+ArrowUp'],
    scope: 'editor',
    repeat: true,
  },
  {
    id: 'copyDown',
    title: '向下复制行',
    category: '编辑',
    keywords: 'copy line down',
    keys: ['Alt+Shift+ArrowDown'],
    scope: 'editor',
    repeat: true,
  },
  {
    id: 'escape',
    title: '关闭当前浮层',
    category: '工作区',
    keywords: 'escape close dismiss',
    keys: ['Escape'],
    referenceOnly: true,
  },
  { id: 'newFile', title: '新建文件', category: '文件', keywords: 'new create file' },
  { id: 'rename', title: '重命名文件', category: '文件', keywords: 'rename move file' },
  { id: 'closeFile', title: '关闭当前文件标签', category: '文件', keywords: 'close file tab' },
  { id: 'editorView', title: '仅显示源码', category: '视图', keywords: 'source editor view' },
  { id: 'splitView', title: '源码与 PDF 分栏', category: '视图', keywords: 'split view' },
  { id: 'previewView', title: '仅显示 PDF', category: '视图', keywords: 'preview pdf view' },
  { id: 'pdfSearch', title: '搜索 PDF 正文', category: 'PDF', keywords: 'search find pdf' },
  { id: 'pdfZoomIn', title: '放大 PDF', category: 'PDF', keywords: 'zoom in pdf' },
  { id: 'pdfZoomOut', title: '缩小 PDF', category: 'PDF', keywords: 'zoom out pdf' },
  { id: 'pdfFit', title: 'PDF 适应宽度', category: 'PDF', keywords: 'fit width pdf' },
  { id: 'pdfDownload', title: '下载 PDF', category: 'PDF', keywords: 'download export pdf' },
  { id: 'snapshot', title: '创建版本快照', category: '版本', keywords: 'create snapshot version' },
  {
    id: 'history',
    title: '查看版本快照',
    category: '版本',
    keywords: 'history snapshots versions',
  },
  { id: 'settings', title: '项目设置', category: '项目', keywords: 'project settings engine main' },
  {
    id: 'members',
    title: '成员管理',
    category: '项目',
    keywords: 'members collaborators permissions',
  },
  { id: 'bold', title: '包裹为粗体', category: '写作', keywords: 'bold textbf' },
  { id: 'italic', title: '包裹为斜体', category: '写作', keywords: 'italic textit' },
  { id: 'inlineMath', title: '插入行内公式', category: '写作', keywords: 'inline math equation' },
  { id: 'displayMath', title: '插入独立公式', category: '写作', keywords: 'display math equation' },
  { id: 'itemize', title: '插入无序列表', category: '写作', keywords: 'unordered list itemize' },
  {
    id: 'enumerate',
    title: '插入有序列表',
    category: '写作',
    keywords: 'ordered numbered list enumerate',
  },
];
export interface Command extends CommandDefinition {
  disabledReason?: string;
  run: () => void | Promise<unknown>;
}
export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const bindingsFor = (command: CommandDefinition, mac = isMac()) => [
  ...(command.keys || []),
  ...(!mac ? command.windowsKeys || [] : []),
];
export function formatBinding(binding: string, mac = isMac()) {
  return binding
    .split('+')
    .map(
      (key) =>
        ({
          Mod: mac ? '⌘' : 'Ctrl',
          Alt: mac ? 'Option' : 'Alt',
          Shift: 'Shift',
          Backquote: '`',
          Slash: '/',
          Escape: 'Esc',
          ArrowUp: '↑',
          ArrowDown: '↓',
        })[key] || key.replace(/^Key/, ''),
    )
    .join('+');
}
export const shortcutLabel = (id: string) => {
  const command = commandDefinitions.find((c) => c.id === id);
  return command
    ? bindingsFor(command)
        .map((b) => formatBinding(b))
        .join(' / ')
    : '';
};
export const commandTitle = (id: string) => {
  const command = commandDefinitions.find((c) => c.id === id);
  return `${command?.title || id}${shortcutLabel(id) ? ` (${shortcutLabel(id)})` : ''}`;
};
export function matchesBinding(
  e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  binding: string,
  mac = isMac(),
) {
  const parts = binding.split('+');
  return (
    e.code === parts.at(-1) &&
    e.ctrlKey === (!mac && parts.includes('Mod')) &&
    e.metaKey === (mac && parts.includes('Mod')) &&
    e.altKey === parts.includes('Alt') &&
    e.shiftKey === parts.includes('Shift')
  );
}
