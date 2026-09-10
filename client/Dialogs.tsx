import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  FilePlus2,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import type { Member, Project, ProjectFile, User } from '../shared/types';
import { api, patch, post } from './api';
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,select,a[href],textarea',
            ) || [],
          ),
          first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function FormModal({
  title,
  label,
  initial = '',
  submitLabel = '确定',
  description,
  onClose,
  onSubmit,
  danger = false,
}: {
  title: string;
  label: string;
  initial?: string;
  submitLabel?: string;
  description?: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
  danger?: boolean;
}) {
  const [value, setValue] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onSubmit(value);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {description && <p className="form-description">{description}</p>}
        <label className="field-label">
          {label}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required={!danger}
            maxLength={240}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button className={danger ? 'danger-button' : 'primary-button'} disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : null}
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [title, setTitle] = useState('未命名论文'),
    [template, setTemplate] = useState('chinese'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await post<Project>('/projects', { title, template }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="新建论文项目" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label">
          项目名称
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <div className="template-options">
          {[
            ['chinese', '中文论文', 'XeLaTeX · 章节与参考文献'],
            ['english', 'English paper', 'pdfLaTeX · Article template'],
            ['blank', '空白项目', '从一个简单文档开始'],
          ].map(([id, name, description]) => (
            <label key={id} className={`template-option ${template === id ? 'selected' : ''}`}>
              <input
                type="radio"
                name="template"
                value={id}
                checked={template === id}
                onChange={() => setTemplate(id)}
              />
              <FilePlus2 size={21} />
              <span>
                <strong>{name}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <Upload size={15} />
            导入 ZIP
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}创建项目
          </button>
        </div>
      </form>
      <input
        ref={input}
        hidden
        type="file"
        accept=".zip"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const form = new FormData();
            form.append('file', file);
            onCreated(await api<Project>('/projects/import', { method: 'POST', body: form }));
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Modal>
  );
}
export function SettingsModal({
  project,
  files,
  onClose,
  onUpdated,
}: {
  project: Project;
  files: ProjectFile[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [title, setTitle] = useState(project.title),
    [engine, setEngine] = useState(project.engine),
    [mainFileId, setMain] = useState(project.mainFileId || ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="项目设置" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await patch(`/projects/${project.id}`, {
              title,
              engine,
              ...(mainFileId ? { mainFileId } : {}),
            });
            onUpdated();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label">
          论文名称
          <input
            required
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field-label">
          主文件
          <select value={mainFileId} required onChange={(e) => setMain(e.target.value)}>
            <option value="" disabled>
              选择主 .tex 文件
            </option>
            {files
              .filter((f) => f.path.endsWith('.tex'))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                </option>
              ))}
          </select>
        </label>
        <label className="field-label">
          编译引擎
          <select value={engine} onChange={(e) => setEngine(e.target.value as Project['engine'])}>
            <option value="xelatex">XeLaTeX（适合中文论文）</option>
            <option value="pdflatex">pdfLaTeX</option>
            <option value="lualatex">LuaLaTeX</option>
          </select>
        </label>
        <p className="form-description">编译引擎与主文件由整个项目共享。更改后会重新生成 PDF。</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" disabled={busy}>
            保存设置
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MembersModal({
  project,
  user,
  onClose,
  onUpdated,
}: {
  project: Project;
  user: User;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [username, setUsername] = useState(''),
    [role, setRole] = useState('editor'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [newUser, setNewUser] = useState(false),
    [displayName, setDisplayName] = useState(''),
    [password, setPassword] = useState('');
  const load = () =>
    api<Member[]>(`/projects/${project.id}/members`)
      .then(setMembers)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [project.id]);
  return (
    <Modal title="项目成员" wide onClose={onClose}>
      <p className="form-description">合作者使用各自的账号登录后，可以在项目列表中打开这篇论文。</p>
      <div className="member-list">
        {members.map((m) => (
          <div key={m.id} className="member-row">
            <span className="avatar">{m.displayName.slice(0, 1)}</span>
            <div>
              <strong>{m.displayName}</strong>
              <small>@{m.username}</small>
            </div>
            <span className="role-label">
              {{ owner: '所有者', editor: '可编辑', viewer: '只读' }[m.role]}
            </span>
            {project.role === 'owner' && m.role !== 'owner' && (
              <button
                className="icon-button"
                aria-label={`移除 ${m.displayName}`}
                onClick={async () => {
                  try {
                    await api(`/projects/${project.id}/members/${m.id}`, { method: 'DELETE' });
                    await load();
                    onUpdated();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      {project.role === 'owner' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              if (newUser) await post('/users', { username, displayName, password });
              await post(`/projects/${project.id}/members`, { username, role });
              setUsername('');
              setPassword('');
              setDisplayName('');
              await load();
              onUpdated();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-separator" />
          {user.isAdmin && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={newUser}
                onChange={(e) => setNewUser(e.target.checked)}
              />
              同时创建新账号
            </label>
          )}
          <div className="form-row">
            <label className="field-label">
              用户名
              <input
                value={username}
                placeholder="输入合作者的用户名"
                required
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="field-label compact-field">
              权限
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="editor">可编辑</option>
                <option value="viewer">只读</option>
              </select>
            </label>
          </div>
          {newUser && (
            <>
              <label className="field-label">
                显示名称
                <input
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
              <label className="field-label">
                初始密码
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 10 个字符"
                />
              </label>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button className="primary-button" disabled={busy}>
              <UserPlus size={15} />
              {newUser ? '创建并添加' : '添加或更新成员'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
export function PasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOld] = useState(''),
    [newPassword, setNew] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="修改密码" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post('/auth/password', { oldPassword, newPassword });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field-label">
          原密码
          <input
            type="password"
            autoComplete="current-password"
            required
            value={oldPassword}
            onChange={(e) => setOld(e.target.value)}
          />
        </label>
        <label className="field-label">
          新密码
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            placeholder="至少 10 个字符"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="primary-button" disabled={busy}>
            <KeyRound size={15} />
            更新密码
          </button>
        </div>
      </form>
    </Modal>
  );
}
