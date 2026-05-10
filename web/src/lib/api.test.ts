import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { apiFetch } from './api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('apiFetch includes backend details in thrown errors', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        message: 'Invalid user payload',
        details: {
          fieldErrors: {
            email: ['Invalid email'],
            password: ['String must contain at least 8 character(s)']
          }
        }
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    )) as typeof fetch;

  await assert.rejects(
    () => apiFetch('/api/admin/users', 'token', { method: 'POST', body: '{}' }),
    (error) =>
      error instanceof Error &&
      error.message ===
        'Invalid user payload: email: Invalid email | password: String must contain at least 8 character(s)'
  );
});
