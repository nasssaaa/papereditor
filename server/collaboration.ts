import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import * as awareness from 'y-protocols/awareness';
import type { ServerEvent, User } from '../shared/types.js';
import type { Store } from './store.js';
interface Peer {
  socket: WebSocket;
  user: User;
  projectId: string;
  fileId?: string;
  clientIds: Set<number>;
  token: string;
  alive: boolean;
}
interface Room {
  doc: Y.Doc;
  awareness: awareness.Awareness;
  peers: Set<Peer>;
}
const packet = (kind: number, data: Uint8Array) => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, kind);
  encoding.writeVarUint8Array(e, data);
  return encoding.toUint8Array(e);
};
export class Collaboration {
  rooms = new Map<string, Room>();
  peers = new Set<Peer>();
  wss = new WebSocketServer({ noServer: true, maxPayload: 3 * 1024 * 1024 });
  heartbeat: NodeJS.Timeout;
  onChange: (projectId: string) => void = () => {};
  constructor(
    private store: Store,
    server: Server,
  ) {
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const token = /(?:^|;\s*)paper_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
        const user = store.session(token);
        if (!user) throw new Error('Unauthorized');
        if (req.headers.origin) {
          const origin = new URL(req.headers.origin);
          const isDev =
            origin.hostname === '127.0.0.1' &&
            origin.port === '5173' &&
            (req.headers.host || '').startsWith('127.0.0.1:');
          if (origin.host !== req.headers.host && !isDev) throw new Error('Origin rejected');
        }
        let fileId: string | undefined, projectId: string;
        if (url.pathname.startsWith('/collab/')) {
          fileId = url.pathname.slice('/collab/'.length);
          const file = store.file(fileId);
          if (file.kind !== 'text') throw new Error('Not text');
          projectId = file.projectId;
        } else if (url.pathname === '/events') {
          projectId = url.searchParams.get('projectId') || '';
        } else throw new Error('Unknown socket');
        store.requireRole(projectId, user.id);
        this.wss.handleUpgrade(req, socket, head, (ws) =>
          this.connect({
            socket: ws,
            user,
            projectId,
            fileId,
            clientIds: new Set(),
            token,
            alive: true,
          }),
        );
      } catch {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
      }
    });
    this.heartbeat = setInterval(() => {
      for (const p of this.peers) {
        if (!p.alive || !store.session(p.token) || !store.role(p.projectId, p.user.id)) {
          p.socket.terminate();
          continue;
        }
        p.alive = false;
        p.socket.ping();
      }
    }, 30000);
    this.heartbeat.unref();
  }
  room(id: string): Room {
    const old = this.rooms.get(id);
    if (old) return old;
    const doc = this.store.loadDoc(id),
      aw = new awareness.Awareness(doc);
    aw.setLocalState(null);
    const room: Room = { doc, awareness: aw, peers: new Set() };
    this.rooms.set(id, room);
    doc.on('update', (update: Uint8Array) => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, 0);
      sync.writeUpdate(e, update);
      for (const p of room.peers) this.send(p, encoding.toUint8Array(e));
    });
    aw.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const msg = packet(
          1,
          awareness.encodeAwarenessUpdate(aw, [...added, ...updated, ...removed]),
        );
        for (const p of room.peers) this.send(p, msg);
      },
    );
    return room;
  }
  send(peer: Peer, data: Uint8Array | string) {
    if (peer.socket.readyState === WebSocket.OPEN) {
      if (peer.socket.bufferedAmount > 8 * 1024 * 1024)
        peer.socket.close(4503, 'Connection too slow');
      else peer.socket.send(data);
    }
  }
  acknowledge(room: Room) {
    const hash = createHash('sha256').update(room.doc.getText('content').toString()).digest();
    for (const p of room.peers) this.send(p, packet(4, hash));
  }
  connect(peer: Peer) {
    this.peers.add(peer);
    peer.socket.on('pong', () => (peer.alive = true));
    peer.socket.on('error', () => {});
    let room: Room | undefined;
    if (peer.fileId) {
      room = this.room(peer.fileId);
      room.peers.add(peer);
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, 0);
      sync.writeSyncStep1(e, room.doc);
      this.send(peer, encoding.toUint8Array(e));
      this.send(
        peer,
        packet(
          1,
          awareness.encodeAwarenessUpdate(
            room.awareness,
            Array.from(room.awareness.getStates().keys()),
          ),
        ),
      );
      peer.socket.on('message', (raw) => {
        try {
          if (!this.store.session(peer.token)) {
            peer.socket.close(4401, 'Session expired');
            return;
          }
          const role = this.store.requireRole(peer.projectId, peer.user.id);
          const d = decoding.createDecoder(new Uint8Array(raw as Buffer));
          const kind = decoding.readVarUint(d);
          if (kind === 0) {
            const sub = decoding.readVarUint(d);
            if (sub === 0) {
              const e = encoding.createEncoder();
              encoding.writeVarUint(e, 0);
              sync.writeSyncStep2(e, room!.doc, decoding.readVarUint8Array(d));
              this.send(peer, encoding.toUint8Array(e));
              this.acknowledge(room!);
            } else if (sub === 1 || sub === 2) {
              if (role === 'viewer') {
                this.acknowledge(room!);
                return;
              }
              const update = decoding.readVarUint8Array(d);
              const trial = new Y.Doc();
              try {
                Y.applyUpdate(trial, Y.encodeStateAsUpdate(room!.doc));
                Y.applyUpdate(trial, update);
                if (
                  Buffer.byteLength(trial.getText('content').toString()) > 2 * 1024 * 1024 ||
                  Y.encodeStateAsUpdate(trial).byteLength > 4 * 1024 * 1024 ||
                  [...trial.share.keys()].some((k) => k !== 'content')
                )
                  throw new Error('Document too large');
                const changed = !Buffer.from(Y.encodeStateAsUpdate(trial)).equals(
                  Buffer.from(Y.encodeStateAsUpdate(room!.doc)),
                );
                if (changed) {
                  this.store.saveDoc(peer.fileId!, trial);
                  Y.applyUpdate(room!.doc, update);
                  this.onChange(peer.projectId);
                }
                this.acknowledge(room!);
              } finally {
                trial.destroy();
              }
            }
          } else if (kind === 1) {
            const data = decoding.readVarUint8Array(d);
            if (data.length > 8192) throw new Error('Awareness too large');
            const ad = decoding.createDecoder(data),
              ae = encoding.createEncoder(),
              count = decoding.readVarUint(ad);
            if (count > 8) throw new Error('Too many clients');
            encoding.writeVarUint(ae, count);
            for (let i = 0; i < count; i++) {
              const clientId = decoding.readVarUint(ad),
                clock = decoding.readVarUint(ad),
                state = JSON.parse(decoding.readVarString(ad));
              if ([...room!.peers].some((p) => p !== peer && p.clientIds.has(clientId)))
                throw new Error('Client already owned');
              peer.clientIds.add(clientId);
              encoding.writeVarUint(ae, clientId);
              encoding.writeVarUint(ae, clock);
              encoding.writeVarString(
                ae,
                JSON.stringify(
                  state === null
                    ? null
                    : {
                        selection: state.selection,
                        user: { id: peer.user.id, name: peer.user.displayName },
                      },
                ),
              );
            }
            awareness.applyAwarenessUpdate(room!.awareness, encoding.toUint8Array(ae), peer);
          } else if (kind === 3)
            this.send(
              peer,
              packet(
                1,
                awareness.encodeAwarenessUpdate(
                  room!.awareness,
                  Array.from(room!.awareness.getStates().keys()),
                ),
              ),
            );
        } catch {
          peer.socket.close(4400, 'Update rejected; local draft is preserved');
        }
      });
    }
    peer.socket.on('close', () => {
      this.peers.delete(peer);
      if (room) {
        room.peers.delete(peer);
        awareness.removeAwarenessStates(room.awareness, [...peer.clientIds], peer);
        if (room.peers.size === 0) {
          room.awareness.destroy();
          room.doc.destroy();
          this.rooms.delete(peer.fileId!);
        }
      }
      this.presence(peer.projectId);
    });
    this.presence(peer.projectId);
  }
  presence(projectId: string) {
    this.broadcast({
      type: 'presence',
      projectId,
      userIds: [
        ...new Set([...this.peers].filter((p) => p.projectId === projectId).map((p) => p.user.id)),
      ],
    });
  }
  broadcast(event: ServerEvent) {
    for (const p of this.peers)
      if (!p.fileId && p.projectId === event.projectId) this.send(p, JSON.stringify(event));
  }
  revoke(projectId: string, userId: string) {
    for (const p of this.peers)
      if (p.projectId === projectId && p.user.id === userId)
        p.socket.close(4403, 'Project permission changed');
    this.broadcast({ type: 'permissions', projectId });
  }
  removeFile(id: string) {
    const room = this.rooms.get(id);
    if (room) for (const p of room.peers) p.socket.close(4404, 'File deleted');
  }
  close() {
    clearInterval(this.heartbeat);
    for (const p of this.peers) p.socket.terminate();
    for (const r of this.rooms.values()) {
      r.awareness.destroy();
      r.doc.destroy();
    }
    this.rooms.clear();
    this.wss.close();
  }
}
