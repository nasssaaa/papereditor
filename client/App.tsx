import { useCallback, useEffect, useRef, useState, lazy, Suspense, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeftRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Code2,
  Columns2,
  File,
  FileCode2,
  FilePlus2,
  FileText,
  Files,
  Folder,
  FolderOpen,
  History,
  KeyRound,
  LoaderCircle,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  Terminal,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type {
  Build,
  Member,
  Project,
  ProjectDetail,
  ProjectFile,
  ServerEvent,
  Snapshot,
  User,
} from '../shared/types';
import { api, apiUrl, patch, post, websocketUrl } from './api';
import type { EditorHandle, SaveStatus } from './SourceEditor';
const SourceEditor = lazy(() =>
  import('./SourceEditor').then((m) => ({ default: m.SourceEditor })),
);
import type { PdfTarget } from './PdfPreview';
const PdfPreview = lazy(() => import('./PdfPreview').then((m) => ({ default: m.PdfPreview })));
import {
  FormModal,
  MembersModal,
  Modal,
  NewProjectModal,
  PasswordModal,
  SettingsModal,
} from './Dialogs';
const statusText: Record<SaveStatus, string> = {
  connecting: '连接文档中',
  saved: '已保存',
  saving: '保存中…',
  offline: '离线草稿',
  readonly: '只读模式',
  error: '连接被拒绝，草稿保留在本机',
};
const timeAgo = (time: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time);
function FileIcon({ file }: { file: ProjectFile }) {
  return file.kind === 'binary' ? (
    <File size={15} className="asset-icon" />
  ) : file.path.endsWith('.bib') ? (
    <BookOpen size={15} className="bib-icon" />
  ) : (
    <span className="tex-icon">
      T<span>E</span>X
    </span>
  );
}
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin((await post<{ user: User }>('/auth/login', { username, password })).user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-screen">
      <div className="login-brand">
        <div className="brand-icon">
          <FileText size={24} />
        </div>
        <span>Paper Editor</span>
        <span className="beta-label">BETA</span>
      </div>
      <main className="login-main">
        <div className="login-intro">
          <span className="eyebrow">YOUR RESEARCH WORKSPACE</span>
          <h1>
            专注于想法，
            <br />
            一起写好论文。
          </h1>
          <p>源码、协作与排版，在同一个工作空间。</p>
          <div className="login-code">
            <div>
              <i />
              <i />
              <i />
              <span>main.tex</span>
            </div>
            <pre>
              <span className="syntax-purple">{'\\begin'}</span>
              {'{document}\n\n'}
              <span className="syntax-green">{'% 每一个发现，都值得被写下。'}</span>
              {'\n'}
              <span className="syntax-yellow">{'\\section'}</span>
              {'{新的开始}\n\n'}
              <span className="syntax-purple">{'\\end'}</span>
              {'{document}'}
            </pre>
          </div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <h2>登录工作空间</h2>
          <p>使用团队管理员为你创建的账号。</p>
          <label className="field-label">
            用户名
            <input
              autoFocus
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="你的用户名"
            />
          </label>
          <label className="field-label">
            密码
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button login-submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowLeftRight size={17} />}
            进入工作空间
          </button>
          <small>LaTeX · 实时协作 · PDF 预览</small>
        </form>
      </main>
      <footer className="login-footer">
        <span>Paper Editor</span>
        <span>为研究与写作而建</span>
      </footer>
    </div>
  );
}
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <div className="app-loading">
        <LoaderCircle className="spin" />
        正在打开工作空间…
      </div>
    );
  return user ? (
    <Workspace key={user.id} user={user} onLogout={() => setUser(null)} />
  ) : (
    <Login onLogin={setUser} />
  );
}
type Panel = 'files' | 'search' | 'history';
function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState(''),
    [detail, setDetail] = useState<ProjectDetail | null>(null),
    [selectedFileId, setSelectedFileId] = useState(''),
    [tabs, setTabs] = useState<string[]>([]),
    [panel, setPanel] = useState<Panel>('files'),
    [sidebar, setSidebar] = useState(true),
    [mode, setMode] = useState<'split' | 'editor' | 'preview'>('split');
  const [modal, setModal] = useState<string | null>(null),
    [saveStatus, setSaveStatus] = useState<SaveStatus>('connecting'),
    [characters, setCharacters] = useState(0),
    [online, setOnline] = useState(false),
    [members, setMembers] = useState<Member[]>([]),
    [onlineIds, setOnlineIds] = useState<string[]>([]),
    [toast, setToast] = useState(''),
    [panelOpen, setPanelOpen] = useState(false),
    [outputTab, setOutputTab] = useState<'problems' | 'log'>('problems');
  const [search, setSearch] = useState(''),
    [results, setResults] = useState<
      { fileId: string; path: string; line: number; text: string }[]
    >([]),
    [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [quickQuery, setQuickQuery] = useState(''),
    [target, setTarget] = useState<PdfTarget | null>(null),
    [editorPercent, setEditorPercent] = useState(54),
    [busyUpload, setBusyUpload] = useState(false);
  const editorHandle = useRef<EditorHandle | null>(null),
    uploadInput = useRef<HTMLInputElement>(null),
    currentProject = useRef(''),
    splitRoot = useRef<HTMLDivElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    jumpPending = useRef<{ id: string; line: number } | null>(null);
  currentProject.current = projectId;
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 900px)');
    const collapse = () => {
      if (narrow.matches) setSidebar(false);
    };
    collapse();
    narrow.addEventListener('change', collapse);
    return () => narrow.removeEventListener('change', collapse);
  }, []);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  const loadProjects = useCallback(async () => {
    const list = await api<Project[]>('/projects');
    setProjects(list);
    return list;
  }, []);
  const selectProject = useCallback((id: string) => {
    setSaveStatus('connecting');
    setDetail(null);
    setProjectId(id);
    location.hash = `/project/${id}`;
    setModal(null);
  }, []);
  useEffect(() => {
    void loadProjects()
      .then((list) => {
        const id = location.hash.split('/project/')[1];
        if (list.length) selectProject(list.some((p) => p.id === id) ? id : list[0].id);
      })
      .catch((e) => notify(e.message));
  }, []);
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const data = await api<ProjectDetail>(`/projects/${projectId}`);
    if (currentProject.current !== projectId) return;
    setDetail(data);
    setProjects((previous) => previous.map((p) => (p.id === projectId ? data.project : p)));
    setSelectedFileId((previous) =>
      data.files.some((f) => f.id === previous)
        ? previous
        : data.project.mainFileId || data.files[0]?.id || '',
    );
    setTabs((previous) => previous.filter((id) => data.files.some((f) => f.id === id)));
  }, [projectId]);
  const loadMembers = useCallback(
    () => api<Member[]>(`/projects/${projectId}/members`).then(setMembers),
    [projectId],
  );
  const loadSnapshots = useCallback(
    () => api<Snapshot[]>(`/projects/${projectId}/snapshots`).then(setSnapshots),
    [projectId],
  );
  useEffect(() => {
    if (!projectId) return;
    setDetail(null);
    setSelectedFileId('');
    setTabs([]);
    setTarget(null);
    setSearch('');
    setSnapshots([]);
    void refresh().catch((e) => notify(e.message));
    void loadMembers().catch(() => {});
  }, [projectId]);
  useEffect(() => {
    if (selectedFileId) setTabs((t) => (t.includes(selectedFileId) ? t : [...t, selectedFileId]));
  }, [selectedFileId]);
  useEffect(() => {
    if (panel === 'history' && projectId) void loadSnapshots().catch((e) => notify(e.message));
  }, [panel, projectId]);
  useEffect(() => {
    if (!search.trim() || !projectId) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api<typeof results>(`/projects/${projectId}/search?q=${encodeURIComponent(search)}`)
        .then((r) => {
          if (!cancelled) setResults(r);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, projectId]);
  useEffect(() => {
    if (!projectId) return;
    let disposed = false,
      ws: WebSocket | null = null,
      timer: ReturnType<typeof setTimeout> | undefined,
      reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(websocketUrl(`/events?projectId=${projectId}`));
      ws.onopen = () => {
        setOnline(true);
        void refresh().catch(() => {});
      };
      ws.onclose = () => {
        setOnline(false);
        if (!disposed) timer = setTimeout(connect, 2000);
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as ServerEvent;
          if (event.projectId !== currentProject.current) return;
          if (event.type === 'build' && event.build) {
            const b = event.build;
            setDetail((old) => {
              if (!old) return old;
              const current =
                !old.build || old.build.id === b.id || b.startedAt >= old.build.startedAt
                  ? b
                  : old.build;
              const success =
                b.status === 'success' &&
                b.hasPdf &&
                (!old.lastSuccess || b.revision >= old.lastSuccess.revision)
                  ? b
                  : old.lastSuccess;
              return { ...old, build: current, lastSuccess: success };
            });
          } else if (event.type === 'presence') setOnlineIds(event.userIds || []);
          else if (event.type === 'permissions') {
            void loadMembers();
            void refresh().catch((e) => {
              notify(e.message);
              void loadProjects().then((p) => {
                if (p[0]) selectProject(p[0].id);
                else {
                  setProjectId('');
                  setDetail(null);
                }
              });
            });
          } else {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(
              () => void refresh().catch(() => {}),
              event.type === 'files' ? 50 : 500,
            );
          }
        } catch {}
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(reloadTimer);
      ws?.close();
    };
  }, [projectId, refresh]);
  const file = detail?.files.find((f) => f.id === selectedFileId),
    canEdit = detail?.project.role !== 'viewer';
  const build = detail?.build || null,
    lastSuccess = detail?.lastSuccess || null,
    busy = build?.status === 'running' || build?.status === 'queued';
  const compile = useCallback(async () => {
    if (!projectId || !canEdit) return;
    try {
      await editorHandle.current?.flush();
      const b = await post<Build>(`/projects/${projectId}/compile`);
      setDetail((d) => (d ? { ...d, build: b } : d));
    } catch (e) {
      notify((e as Error).message);
    }
  }, [projectId, canEdit]);
  const jump = useCallback(
    (id: string, line: number) => {
      setSelectedFileId(id);
      if (mode === 'preview') setMode('split');
      if (id === selectedFileId && editorHandle.current) editorHandle.current.jump(line);
      else jumpPending.current = { id, line };
    },
    [selectedFileId, mode],
  );
  const onEditorStatus = useCallback(
    (status: SaveStatus) => {
      setSaveStatus(status);
      if (
        jumpPending.current?.id === selectedFileId &&
        (status === 'saved' || status === 'readonly' || status === 'saving')
      ) {
        editorHandle.current?.jump(jumpPending.current.line);
        jumpPending.current = null;
      }
    },
    [selectedFileId],
  );
  const forward = useCallback(
    async (line: number) => {
      if (!lastSuccess || !file) return;
      try {
        const pos = await post<{ page: number; x: number; y: number }>(
          `/builds/${lastSuccess.id}/synctex`,
          { fileId: file.id, line },
        );
        setTarget({ ...pos, key: Date.now() });
        if (mode === 'editor') setMode('split');
      } catch (e) {
        notify((e as Error).message);
      }
    },
    [lastSuccess?.id, file?.id, mode],
  );
  const reverse = useCallback(
    async (page: number, x: number, y: number) => {
      if (!lastSuccess) return;
      try {
        const pos = await post<{ fileId: string; line: number }>(
          `/builds/${lastSuccess.id}/synctex`,
          { page, x, y },
        );
        jump(pos.fileId, pos.line);
      } catch (e) {
        notify((e as Error).message);
      }
    },
    [lastSuccess?.id, jump],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        void compile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setQuickQuery('');
        setModal('quick');
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSidebar(true);
        setPanel('search');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebar((s) => !s);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [compile]);
  useEffect(() => {
    const hash = () => {
      const id = location.hash.split('/project/')[1];
      if (projects.some((p) => p.id === id)) setProjectId(id);
    };
    window.addEventListener('hashchange', hash);
    return () => window.removeEventListener('hashchange', hash);
  }, [projects]);
  const created = (p: Project) => {
    setProjects((old) => [p, ...old]);
    selectProject(p.id);
  };
  const iconPanel = (p: Panel) => {
    if (panel === p) setSidebar(!sidebar);
    else {
      setPanel(p);
      setSidebar(true);
    }
  };
  const closeTab = (id: string) => {
    const next = tabs.filter((t) => t !== id);
    setTabs(next);
    if (id === selectedFileId) setSelectedFileId(next[next.length - 1] || '');
  };
  const errors = build?.diagnostics.filter((d) => d.severity === 'error').length || 0,
    warnings = build?.diagnostics.filter((d) => d.severity === 'warning').length || 0;
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = splitRoot.current!.getBoundingClientRect();
    const move = (event: PointerEvent) =>
      setEditorPercent(
        Math.max(30, Math.min(70, ((event.clientX - rect.left) / rect.width) * 100)),
      );
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };
  const pathTree = () => {
    const output: React.ReactNode[] = [];
    const seen = new Set<string>();
    for (const f of detail?.files || []) {
      const parts = f.path.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        const folder = parts.slice(0, i + 1).join('/');
        if (!seen.has(folder)) {
          seen.add(folder);
          output.push(
            <div
              className="tree-folder"
              key={'folder:' + folder}
              style={{ paddingLeft: 14 + i * 14 }}
            >
              <ChevronDown size={13} />
              <FolderOpen size={15} />
              <span>{parts[i]}</span>
            </div>,
          );
        }
      }
      output.push(
        <div
          key={f.id}
          className={`tree-file ${selectedFileId === f.id ? 'selected' : ''}`}
          style={{ paddingLeft: 24 + (parts.length - 1) * 14 }}
        >
          <button className="tree-file-main" onClick={() => setSelectedFileId(f.id)} title={f.path}>
            <FileIcon file={f} />
            <span>{parts[parts.length - 1]}</span>
            {detail?.project.mainFileId === f.id && (
              <span className="main-badge" title="主文件">
                M
              </span>
            )}
          </button>
          {canEdit && (
            <button
              className="file-menu-button"
              aria-label={`操作 ${f.path}`}
              onClick={() => {
                setSelectedFileId(f.id);
                setModal('file-menu');
              }}
            >
              ···
            </button>
          )}
        </div>,
      );
    }
    return output;
  };
  return (
    <div className="workspace">
      <header className="titlebar">
        <div className="app-wordmark">
          <FileText size={21} />
          <strong>Paper Editor</strong>
        </div>
        <div className="project-picker">
          <FolderOpen size={15} />
          <select
            aria-label="选择项目"
            value={projectId}
            onChange={(e) => selectProject(e.target.value)}
          >
            {!projects.length && <option value="">选择项目</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
        <button
          className="icon-button title-new"
          title="新建项目"
          aria-label="新建项目"
          onClick={() => setModal('new-project')}
        >
          <Plus size={17} />
        </button>
        <div className="titlebar-right">
          <span className={`connection-indicator ${online ? '' : 'offline'}`}>
            {online ? <Cloud size={14} /> : <CloudOff size={14} />}
            <span>{online ? '已连接' : '未连接'}</span>
          </span>
          <button className="profile-button" title="账号设置" onClick={() => setModal('account')}>
            <span className="avatar small">{user.displayName.slice(0, 1)}</span>
            <span>{user.displayName}</span>
          </button>
        </div>
      </header>
      <div className="workbench">
        <nav className="activitybar" aria-label="活动栏">
          <div>
            {[
              [Files, 'files', '资源管理器'],
              [Search, 'search', '全局搜索'],
              [History, 'history', '版本快照'],
            ].map(([Icon, p, title]) => {
              const I = Icon as typeof Files;
              return (
                <button
                  key={String(p)}
                  className={`activity-button ${sidebar && panel === p ? 'active' : ''}`}
                  title={String(title)}
                  aria-label={String(title)}
                  onClick={() => iconPanel(p as Panel)}
                >
                  <I size={23} strokeWidth={1.5} />
                </button>
              );
            })}
            <button
              className="activity-button"
              title="项目成员"
              aria-label="项目成员"
              disabled={!detail}
              onClick={() => setModal('members')}
            >
              <Users size={23} strokeWidth={1.5} />
            </button>
          </div>
          <div>
            <button
              className="activity-button"
              title="项目设置"
              aria-label="项目设置"
              disabled={!detail || !canEdit}
              onClick={() => setModal('settings')}
            >
              <Settings size={23} strokeWidth={1.5} />
            </button>
          </div>
        </nav>
        {sidebar && (
          <aside className="sidebar">
            <div className="sidebar-heading">
              <span>{{ files: '资源管理器', search: '搜索', history: '版本快照' }[panel]}</span>
              <button
                className="icon-button"
                title="收起侧栏"
                aria-label="收起侧栏"
                onClick={() => setSidebar(false)}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            {panel === 'files' ? (
              <>
                <div className="project-tree-heading">
                  <ChevronDown size={14} />
                  <span title={detail?.project.title}>{detail?.project.title || '项目文件'}</span>
                  <div>
                    <button
                      className="icon-button"
                      aria-label="新建文件"
                      title="新建文件"
                      disabled={!detail || !canEdit}
                      onClick={() => setModal('new-file')}
                    >
                      <FilePlus2 size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="上传文件"
                      title="上传图片或文件"
                      disabled={!detail || !canEdit || busyUpload}
                      onClick={() => uploadInput.current?.click()}
                    >
                      {busyUpload ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <Upload size={15} />
                      )}
                    </button>
                  </div>
                </div>
                <div className="file-tree">{pathTree()}</div>
                <div className="sidebar-bottom">
                  <div className="outline-heading">项目概览</div>
                  <div>
                    <Files size={14} />
                    {detail?.files.length || 0} 个文件
                  </div>
                  <div>
                    <Code2 size={14} />
                    {detail?.project.engine || 'LaTeX'}
                  </div>
                  <button
                    className="text-button"
                    disabled={!detail}
                    onClick={() => {
                      if (detail) location.href = apiUrl(`/projects/${projectId}/export`);
                    }}
                  >
                    <ArrowDownToLine size={14} />
                    导出源码 ZIP
                  </button>
                </div>
              </>
            ) : panel === 'search' ? (
              <div className="search-panel">
                <div className="search-input">
                  <Search size={15} />
                  <input
                    aria-label="全局搜索词"
                    placeholder="搜索项目文件"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <p className="subtle-text">
                  {search
                    ? `${results.length} 处匹配${results.length === 200 ? '（最多显示 200 处）' : ''}`
                    : '在所有文本文件中查找'}
                </p>
                <div className="search-results">
                  {results.map((r, i) => (
                    <button key={i} onClick={() => jump(r.fileId, r.line)}>
                      <span>
                        {r.path}
                        <small>:{r.line}</small>
                      </span>
                      <p>{r.text}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="history-panel">
                <p className="subtle-text">保存一个写作节点，随时恢复为新项目。</p>
                <button
                  className="secondary-button full-width"
                  disabled={!detail || !canEdit}
                  onClick={() => setModal('snapshot')}
                >
                  <Plus size={15} />
                  创建快照
                </button>
                {snapshots.length ? (
                  snapshots.map((s) => (
                    <button
                      key={s.id}
                      className="snapshot-item"
                      onClick={() => setModal(`restore:${s.id}`)}
                    >
                      <History size={16} />
                      <span>
                        <strong>{s.name}</strong>
                        <small>
                          {timeAgo(s.createdAt)} · v{s.revision}
                        </small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))
                ) : (
                  <p className="empty-hint">还没有版本快照</p>
                )}
              </div>
            )}
          </aside>
        )}
        <main className="main-workspace">
          {detail ? (
            <>
              <div className="workspace-toolbar">
                <div className="toolbar-left">
                  {!sidebar && (
                    <button
                      className="icon-button"
                      aria-label="展开侧栏"
                      title="展开侧栏"
                      onClick={() => setSidebar(true)}
                    >
                      <PanelLeftOpen size={17} />
                    </button>
                  )}
                  <div className="view-switch" aria-label="视图模式">
                    {[
                      ['editor', Code2, '源码'],
                      ['split', Columns2, '分栏'],
                      ['preview', FileText, '预览'],
                    ].map(([value, Icon, label]) => {
                      const I = Icon as typeof Code2;
                      return (
                        <button
                          key={String(value)}
                          title={String(label)}
                          aria-label={String(label) + '视图'}
                          className={mode === value ? 'active' : ''}
                          onClick={() => setMode(value as typeof mode)}
                        >
                          <I size={15} />
                          <span>{String(label)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <span className="toolbar-divider" />
                  <button
                    className="icon-button"
                    title="源码定位到 PDF"
                    aria-label="源码定位到 PDF"
                    disabled={!file || !lastSuccess}
                    onClick={() => editorHandle.current?.forward()}
                  >
                    <ArrowLeftRight size={16} />
                  </button>
                </div>
                <div className="toolbar-right">
                  <button
                    className="collaborators"
                    title="管理项目成员"
                    onClick={() => setModal('members')}
                  >
                    {members
                      .filter((m) => onlineIds.includes(m.id))
                      .slice(0, 3)
                      .map((m, i) => (
                        <span className={`avatar mini color-${i}`} key={m.id}>
                          {m.displayName.slice(0, 1)}
                        </span>
                      ))}
                    <span>{onlineIds.length} 人在线</span>
                  </button>
                  <label className="auto-compile" title="项目成员共享此设置">
                    <input
                      type="checkbox"
                      checked={detail.project.autoCompile}
                      disabled={!canEdit}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        setDetail((d) =>
                          d ? { ...d, project: { ...d.project, autoCompile: checked } } : d,
                        );
                        try {
                          const p = await patch<Project>(`/projects/${projectId}`, {
                            autoCompile: checked,
                          });
                          setDetail((d) => (d ? { ...d, project: p } : d));
                        } catch (e) {
                          notify((e as Error).message);
                        }
                      }}
                    />
                    <span>自动编译</span>
                  </label>
                  {busy && (
                    <button
                      className="icon-button"
                      aria-label="停止编译"
                      title="停止编译"
                      disabled={!canEdit}
                      onClick={() =>
                        void post(`/projects/${projectId}/compile/cancel`).catch((e) =>
                          notify(e.message),
                        )
                      }
                    >
                      <Square size={15} />
                    </button>
                  )}
                  <button
                    className="compile-button"
                    disabled={!canEdit}
                    onClick={() => void compile()}
                  >
                    {busy ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <Play size={15} fill="currentColor" />
                    )}
                    <span>{busy ? '重新排队' : '编译'}</span>
                    <kbd>Ctrl S</kbd>
                  </button>
                </div>
              </div>
              <div
                className={`editor-preview mode-${mode}`}
                ref={splitRoot}
                style={{
                  gridTemplateColumns:
                    mode === 'split'
                      ? `minmax(0,${editorPercent}fr) 5px minmax(0,${100 - editorPercent}fr)`
                      : undefined,
                }}
              >
                <section className="source-panel" aria-label="源码编辑区">
                  <div className="editor-tabs">
                    {tabs
                      .map((id) => detail.files.find((f) => f.id === id))
                      .filter((f): f is ProjectFile => !!f)
                      .map((f) => (
                        <div
                          key={f.id}
                          className={`editor-tab ${selectedFileId === f.id ? 'active' : ''}`}
                        >
                          <button onClick={() => setSelectedFileId(f.id)}>
                            <FileIcon file={f} />
                            <span>{f.path.split('/').pop()}</span>
                          </button>
                          <button
                            aria-label={`关闭 ${f.path}`}
                            className="tab-close"
                            onClick={() => closeTab(f.id)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                  </div>
                  {file ? (
                    <>
                      <div className="breadcrumbs">
                        <span>{detail.project.title}</span>
                        <ChevronRight size={12} />
                        <span>{file.path}</span>
                        {detail.project.mainFileId === file.id && (
                          <span className="breadcrumb-main">主文件</span>
                        )}
                      </div>
                      <div className="source-editor">
                        {file.kind === 'text' ? (
                          <Suspense
                            fallback={<div className="editor-loading">正在载入编辑器…</div>}
                          >
                            <SourceEditor
                              key={`${file.id}:${detail.project.role}`}
                              file={file}
                              user={user}
                              readOnly={!canEdit}
                              diagnostics={
                                build?.revision === detail.project.revision ? build.diagnostics : []
                              }
                              onStatus={onEditorStatus}
                              onCount={setCharacters}
                              onCompile={() => void compile()}
                              onForward={(line) => void forward(line)}
                              handle={editorHandle}
                            />
                          </Suspense>
                        ) : (
                          <div className="binary-preview">
                            <File size={48} strokeWidth={1} />
                            <h2>{file.path}</h2>
                            <p>{(file.size / 1024).toFixed(1)} KB · 此文件参与论文编译</p>
                            <a
                              className="secondary-button"
                              href={apiUrl(`/files/${file.id}/content`)}
                              download
                            >
                              下载文件
                            </a>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="source-empty">
                      <FileText size={44} strokeWidth={1} />
                      <p>在左侧选择一个文件开始编辑</p>
                      <button className="text-button" onClick={() => setModal('quick')}>
                        快速打开文件 <kbd>Ctrl P</kbd>
                      </button>
                    </div>
                  )}
                </section>
                <div
                  className="split-handle"
                  role="separator"
                  aria-label="调整分栏宽度"
                  aria-orientation="vertical"
                  tabIndex={0}
                  onPointerDown={startResize}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') setEditorPercent((p) => Math.max(30, p - 2));
                    if (e.key === 'ArrowRight') setEditorPercent((p) => Math.min(70, p + 2));
                  }}
                />
                <Suspense fallback={<div className="app-loading">正在载入预览…</div>}>
                  <PdfPreview
                    build={lastSuccess}
                    busy={!!busy}
                    onCompile={() => void compile()}
                    onReverse={(...args) => void reverse(...args)}
                    target={target}
                  />
                </Suspense>
              </div>
              <section
                className={`output-panel ${panelOpen ? 'expanded' : ''}`}
                aria-label="编译输出"
              >
                <div className="output-header">
                  <button
                    className={outputTab === 'problems' && panelOpen ? 'active' : ''}
                    onClick={() => {
                      setOutputTab('problems');
                      setPanelOpen(outputTab === 'problems' ? !panelOpen : true);
                    }}
                  >
                    <AlertCircle size={14} />
                    问题
                    {errors + warnings > 0 && (
                      <span className="count-badge">{errors + warnings}</span>
                    )}
                  </button>
                  <button
                    className={outputTab === 'log' && panelOpen ? 'active' : ''}
                    onClick={() => {
                      setOutputTab('log');
                      setPanelOpen(outputTab === 'log' ? !panelOpen : true);
                    }}
                  >
                    <Terminal size={14} />
                    编译日志
                  </button>
                  <div
                    className={`compile-status ${build?.status === 'error' ? 'error-text' : ''}`}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle size={13} className="spin" />
                        {build?.status === 'queued' ? '等待编译' : '正在编译'}
                      </>
                    ) : build?.status === 'success' ? (
                      <>
                        <Check size={14} />
                        编译成功 · {((build.durationMs || 0) / 1000).toFixed(1)} 秒
                        {build.revision !== detail.project.revision ? ' · 存在新修改' : ''}
                      </>
                    ) : build?.status === 'error' ? (
                      <>
                        <AlertCircle size={14} />
                        编译失败，保留上次预览
                      </>
                    ) : build?.status === 'cancelled' ? (
                      '编译已停止'
                    ) : (
                      '尚未编译'
                    )}
                  </div>
                  {panelOpen && (
                    <button
                      className="icon-button"
                      aria-label="关闭输出面板"
                      onClick={() => setPanelOpen(false)}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {panelOpen && (
                  <div className="output-content">
                    {outputTab === 'log' ? (
                      <pre>{build?.log || '编译日志将在这里显示。'}</pre>
                    ) : build?.diagnostics.length ? (
                      build.diagnostics.map((d, i) => (
                        <button
                          className="diagnostic-row"
                          key={i}
                          onClick={() => {
                            const f = detail.files.find((f) => f.path === d.file);
                            if (f) jump(f.id, d.line);
                          }}
                        >
                          <AlertCircle
                            size={14}
                            className={d.severity === 'error' ? 'error-text' : 'warning-text'}
                          />
                          <span>{d.message}</span>
                          <small>
                            {d.file}
                            {d.line ? `:${d.line}` : ''}
                          </small>
                        </button>
                      ))
                    ) : (
                      <div className="no-problems">
                        <CheckCheck size={17} />
                        {build ? '没有发现编译问题' : '编译后显示错误与警告'}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </>
          ) : projectId ? (
            <div className="app-loading">
              <LoaderCircle className="spin" />
              正在载入项目…
            </div>
          ) : (
            <div className="empty-workspace">
              <FileText size={55} strokeWidth={1} />
              <h1>开始一篇新论文</h1>
              <p>创建项目，或者让合作者把你加入现有项目。</p>
              <button className="primary-button" onClick={() => setModal('new-project')}>
                <Plus size={17} />
                新建项目
              </button>
            </div>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <div>
          <span className="status-remote">
            <ArrowLeftRight size={13} />
          </span>
          <button
            title="保存状态"
            onClick={() => {
              if (saveStatus === 'error' || saveStatus === 'offline')
                notify('离线内容保留在此浏览器。请恢复连接后等待保存确认，也可导出当前草稿。');
            }}
          >
            {saveStatus === 'saved' ? (
              <Check size={13} />
            ) : saveStatus === 'offline' ? (
              <CloudOff size={13} />
            ) : (
              <Cloud size={13} />
            )}
            <span>
              {file?.kind === 'text' ? statusText[saveStatus] : online ? '已连接' : '离线'}
            </span>
          </button>
          <button
            onClick={() => {
              setPanelOpen(true);
              setOutputTab('problems');
            }}
          >
            <AlertCircle size={12} />
            {errors}
            <span className="warning-symbol">△</span>
            {warnings}
          </button>
        </div>
        <div>
          <span>{file?.kind === 'text' ? `${characters.toLocaleString()} 字符` : ''}</span>
          <span>UTF-8</span>
          <span>{detail?.project.engine || 'LaTeX'}</span>
          <button title="账号设置" onClick={() => setModal('account')}>
            {detail?.project.role === 'viewer' ? '只读' : '协作编辑'}
          </button>
        </div>
      </footer>
      <input
        ref={uploadInput}
        hidden
        type="file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusyUpload(true);
          try {
            const form = new FormData();
            form.append('file', f);
            const created = await api<ProjectFile>(`/projects/${projectId}/upload`, {
              method: 'POST',
              body: form,
            });
            await refresh();
            setSelectedFileId(created.id);
            notify('文件已上传。');
          } catch (e) {
            notify((e as Error).message);
          } finally {
            setBusyUpload(false);
            if (uploadInput.current) uploadInput.current.value = '';
          }
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={17} />
          <span>{toast}</span>
          <button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {modal === 'new-project' && (
        <NewProjectModal onClose={() => setModal(null)} onCreated={created} />
      )}
      {modal === 'new-file' && (
        <FormModal
          title="新建文件"
          label="文件路径"
          initial="sections/new-section.tex"
          description="使用 / 创建子目录，例如 sections/method.tex。"
          submitLabel="创建文件"
          onClose={() => setModal(null)}
          onSubmit={async (path) => {
            const f = await post<ProjectFile>(`/projects/${projectId}/files`, {
              path,
              content: '',
            });
            await refresh();
            setSelectedFileId(f.id);
          }}
        />
      )}
      {modal === 'rename' && file && (
        <FormModal
          title="重命名文件"
          label="文件路径"
          initial={file.path}
          onClose={() => setModal(null)}
          onSubmit={async (path) => {
            await patch(`/files/${file.id}`, { path });
            await refresh();
          }}
        />
      )}
      {modal === 'delete' && file && (
        <FormModal
          title="删除文件"
          label="即将删除"
          initial={file.path}
          danger
          description="删除会同步给所有成员。建议先创建版本快照，以便恢复。"
          submitLabel="删除文件"
          onClose={() => setModal(null)}
          onSubmit={async () => {
            await api(`/files/${file.id}`, { method: 'DELETE' });
            await refresh();
          }}
        />
      )}
      {modal === 'file-menu' && file && (
        <Modal title={file.path} onClose={() => setModal(null)}>
          <div className="action-list">
            <button onClick={() => setModal('rename')}>重命名 / 移动</button>
            {file.path.endsWith('.tex') && (
              <button
                onClick={async () => {
                  try {
                    await patch(`/projects/${projectId}`, { mainFileId: file.id });
                    await refresh();
                    setModal(null);
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                设为主文件
              </button>
            )}
            <button onClick={() => setModal('delete')} className="error-text">
              <Trash2 size={16} />
              删除文件
            </button>
          </div>
        </Modal>
      )}
      {modal === 'settings' && detail && (
        <SettingsModal
          project={detail.project}
          files={detail.files}
          onClose={() => setModal(null)}
          onUpdated={() => void refresh()}
        />
      )}
      {modal === 'members' && detail && (
        <MembersModal
          project={detail.project}
          user={user}
          onClose={() => setModal(null)}
          onUpdated={() => void loadMembers()}
        />
      )}
      {modal === 'snapshot' && (
        <FormModal
          title="创建版本快照"
          label="快照名称"
          initial={`写作节点 ${timeAgo(Date.now())}`}
          submitLabel="保存快照"
          onClose={() => setModal(null)}
          onSubmit={async (name) => {
            await editorHandle.current?.flush();
            await post(`/projects/${projectId}/snapshots`, { name });
            await loadSnapshots();
            notify('版本快照已保存。');
          }}
        />
      )}
      {modal?.startsWith('restore:') && (
        <Modal title="恢复版本快照" onClose={() => setModal(null)}>
          <p className="form-description">将此快照恢复为一个新项目，当前项目继续保留。</p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              取消
            </button>
            <button
              className="primary-button"
              onClick={async () => {
                try {
                  created(await post<Project>(`/snapshots/${modal.split(':')[1]}/restore`));
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              恢复为新项目
            </button>
          </div>
        </Modal>
      )}
      {modal === 'quick' && detail && (
        <Modal title="快速打开" onClose={() => setModal(null)}>
          <input
            className="quick-input"
            placeholder="输入文件名…"
            aria-label="快速打开文件名"
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
          />
          <div className="quick-files">
            {detail.files
              .filter((f) => f.path.toLocaleLowerCase().includes(quickQuery.toLocaleLowerCase()))
              .map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setSelectedFileId(f.id);
                    setModal(null);
                  }}
                >
                  <FileIcon file={f} />
                  {f.path}
                </button>
              ))}
          </div>
        </Modal>
      )}
      {modal === 'account' && (
        <Modal title="账号" onClose={() => setModal(null)}>
          <div className="account-info">
            <span className="avatar">{user.displayName.slice(0, 1)}</span>
            <div>
              <strong>{user.displayName}</strong>
              <p>@{user.username}</p>
            </div>
          </div>
          <div className="action-list">
            <button onClick={() => setModal('password')}>
              <KeyRound size={16} />
              修改密码
            </button>
            {file?.kind === 'text' && (
              <button
                onClick={() => {
                  const blob = new Blob([editorHandle.current?.getValue() || ''], {
                      type: 'text/plain;charset=utf-8',
                    }),
                    url = URL.createObjectURL(blob),
                    a = document.createElement('a');
                  a.href = url;
                  a.download = file.path.split('/').pop()!;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <ArrowDownToLine size={16} />
                下载当前文件草稿
              </button>
            )}
            <button
              onClick={async () => {
                await post('/auth/logout');
                onLogout();
              }}
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </Modal>
      )}
      {modal === 'password' && <PasswordModal onClose={() => setModal(null)} />}
    </div>
  );
}
