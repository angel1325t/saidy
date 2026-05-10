import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const routesDir = resolve(process.cwd(), 'src', 'routes');

function source(file: string) {
  return readFileSync(resolve(routesDir, file), 'utf8');
}

function assertRoute(file: string, method: string, path: string) {
  const pattern = new RegExp(`\\.${method}\\(\\s*['"\`]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
  assert.match(source(file), pattern, `${file} should expose ${method.toUpperCase()} ${path}`);
}

test('catalog exposes REST CRUD routes for materials and copies', () => {
  assertRoute('catalog.ts', 'get', '/materials/:id');
  assertRoute('catalog.ts', 'patch', '/materials/:id');
  assertRoute('catalog.ts', 'delete', '/materials/:id');
  assertRoute('catalog.ts', 'get', '/copies/:id');
  assertRoute('catalog.ts', 'patch', '/copies/:id');
  assertRoute('catalog.ts', 'delete', '/copies/:id');
});

test('circulation exposes REST CRUD routes for loans, reservations, and fines', () => {
  for (const resource of ['loans', 'reservations', 'fines']) {
    assertRoute('circulation.ts', 'get', `/${resource}/:id`);
    assertRoute('circulation.ts', 'patch', `/${resource}/:id`);
    assertRoute('circulation.ts', 'delete', `/${resource}/:id`);
  }
});

test('admin exposes REST CRUD routes for operational resources and RBAC directories', () => {
  for (const resource of ['inventory', 'acquisitions', 'interlibrary', 'notifications', 'roles', 'permissions', 'users']) {
    assertRoute('admin.ts', 'get', `/${resource}/:id`);
    assertRoute('admin.ts', 'patch', `/${resource}/:id`);
    assertRoute('admin.ts', 'delete', `/${resource}/:id`);
  }
});
