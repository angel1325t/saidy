import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from './auth.js';
import { sendError } from './http.js';

export type RoleRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

export type RoleKey = 'ADMIN' | 'BIBLIOTECARIO' | 'DOCENTE' | 'INVESTIGADOR' | 'ESTUDIANTE';

export type PermissionRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

export function hasAnyPermission(permissions: Array<string | PermissionRecord>, ...required: string[]) {
  const keys = new Set(permissions.map((permission) => (typeof permission === 'string' ? permission : permission.key)));
  return required.some((permission) => keys.has(permission));
}

export function hasAllPermissions(permissions: Array<string | PermissionRecord>, ...required: string[]) {
  const keys = new Set(permissions.map((permission) => (typeof permission === 'string' ? permission : permission.key)));
  return required.every((permission) => keys.has(permission));
}

export function requireAnyPermission(...required: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const permissions = req.auth?.permissions ?? [];
    if (!hasAnyPermission(permissions, ...required)) {
      return sendError(res, 403, 'Insufficient permissions');
    }
    return next();
  };
}

export function requireAllPermissions(...required: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const permissions = req.auth?.permissions ?? [];
    if (!hasAllPermissions(permissions, ...required)) {
      return sendError(res, 403, 'Insufficient permissions');
    }
    return next();
  };
}

export function summarizeRoles(roles: RoleRecord[]) {
  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description
  }));
}
