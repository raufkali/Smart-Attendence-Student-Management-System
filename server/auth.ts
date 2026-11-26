import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  return process.env.SESSION_SECRET?.trim() || EPHEMERAL_SECRET;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface SessionPayload {
  sub: string;
  role: 'admin' | 'teacher';
  name: string;
  teacherId?: number;
  deviceId?: string;
  exp: number;
}

export function signToken(payload: Omit<SessionPayload, 'exp'>, ttlSeconds = 60 * 60 * 12): string {
  const full: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  user?: SessionPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token' });
    return;
  }
  req.user = payload;
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Administrator privileges required' });
      return;
    }
    next();
  });
}

export function requireTeacherOrAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'teacher' && req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Authorized teacher or administrator account required' });
      return;
    }
    next();
  });
}

export function isAdminClaimed(): boolean {
  if (process.env.ADMIN_PASSCODE?.trim()) return true;
  const row = db.prepare("SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1").get();
  return Boolean(row);
}

export function writeAuditLog(params: {
  actor: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | number;
  prevValue?: unknown;
  newValue?: unknown;
  reason?: string;
  source?: string;
}): void {
  db.prepare(`
    INSERT INTO audit_logs (actor, actor_role, action, entity_type, entity_id, prev_value_json, new_value_json, reason, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.actor,
    params.actorRole,
    params.action,
    params.entityType,
    String(params.entityId),
    params.prevValue !== undefined ? JSON.stringify(params.prevValue) : '',
    params.newValue !== undefined ? JSON.stringify(params.newValue) : '',
    params.reason || '',
    params.source || 'desktop-admin',
    new Date().toISOString()
  );
}
