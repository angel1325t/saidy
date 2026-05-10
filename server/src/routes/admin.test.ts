import assert from 'node:assert/strict';
import test from 'node:test';
import { getRoleCreateErrorResponse } from './admin.js';

test('role creation maps duplicate role keys to a conflict response', () => {
  const response = getRoleCreateErrorResponse({
    code: '23505',
    message: 'duplicate key value violates unique constraint "roles_key_key"'
  });

  assert.deepEqual(response, {
    status: 409,
    message: 'Role key already exists',
    details: 'duplicate key value violates unique constraint "roles_key_key"'
  });
});
