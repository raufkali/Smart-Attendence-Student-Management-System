let authToken = '';

export function setAuthToken(token: string) {
  authToken = token;
}

export function getAuthToken(): string {
  return authToken;
}

export function clearAuthToken() {
  authToken = '';
}

async function handleResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (contentType.includes('application/json')) {
      const errBody = (await res.json()) as { error?: string; conflicts?: unknown[] };
      if (errBody.error) {
        const err = new Error(errBody.error) as Error & { data?: unknown };
        err.data = errBody;
        throw err;
      }
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  return handleResponse<T>(res);
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse<T>(res);
}

export async function apiUpload<T>(url: string, formData: FormData): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  return handleResponse<T>(res);
}

export async function apiDownload(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
