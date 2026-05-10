type ViteImportMeta = ImportMeta & {
  env?: {
    VITE_API_BASE_URL?: string;
  };
};

const baseUrl = (import.meta as ViteImportMeta).env?.VITE_API_BASE_URL || 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function flattenDetails(details: unknown) {
  if (!details || typeof details !== 'object') return null;

  const fieldErrors = 'fieldErrors' in details ? (details as { fieldErrors?: Record<string, string[]> }).fieldErrors : null;
  if (!fieldErrors) return typeof details === 'string' ? details : null;

  const messages = Object.entries(fieldErrors)
    .flatMap(([field, errors]) => errors.map((error) => `${field}: ${error}`))
    .slice(0, 4);

  return messages.length > 0 ? messages.join(' | ') : null;
}

export async function apiFetch<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detailMessage = flattenDetails(body?.details);
    const message = [body?.message || `Request failed with status ${response.status}`, detailMessage].filter(Boolean).join(': ');
    throw new ApiError(message, response.status, body?.details);
  }

  return response.json() as Promise<T>;
}
