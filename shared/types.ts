export type Role = 'owner' | 'editor' | 'viewer';
export type Engine = 'xelatex' | 'pdflatex' | 'lualatex';
export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}
export interface Project {
  id: string;
  title: string;
  ownerId: string;
  mainFileId: string | null;
  engine: Engine;
  autoCompile: boolean;
  revision: number;
  updatedAt: number;
  role: Role;
}
export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  kind: 'text' | 'binary';
  size: number;
}
export interface Diagnostic {
  file: string;
  line: number;
  message: string;
  severity: 'error' | 'warning';
}
export interface Build {
  id: string;
  projectId: string;
  revision: number;
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled';
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  log: string;
  diagnostics: Diagnostic[];
  hasPdf: boolean;
}
export interface Snapshot {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  revision: number;
}
export interface Member extends User {
  role: Role;
}
export interface ProjectDetail {
  project: Project;
  files: ProjectFile[];
  build: Build | null;
  lastSuccess: Build | null;
}
export type ServerEvent = {
  type: 'files' | 'project' | 'build' | 'presence' | 'permissions';
  projectId: string;
  build?: Build;
  userIds?: string[];
};
