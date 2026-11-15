import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

interface FirestoreDocumentResponse {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}

const PROJECT_ID = firebaseConfig.projectId;
const DATABASE_ID = firebaseConfig.firestoreDatabaseId || '(default)';
const DOCS_BASE = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/databases/${encodeURIComponent(DATABASE_ID)}/documents`;
const DOC_NAME_PREFIX = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

export const SERVER_TIMESTAMP_SENTINEL = Symbol('SERVER_TIMESTAMP');

export function fromFirestoreValue(val: FirestoreValue): unknown {
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) return (val.arrayValue.values ?? []).map(fromFirestoreValue);
  if ('mapValue' in val) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields ?? {})) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined && v !== SERVER_TIMESTAMP_SENTINEL) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function decodeFirestoreDoc<T>(doc: FirestoreDocumentResponse): T | null {
  if (!doc.fields) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out as T;
}

export async function restGetDoc<T>(docPath: string, idToken: string): Promise<T | null> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const res = await fetch(`${DOCS_BASE}/${cleanPath}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`FIRESTORE_REST_ERROR_${res.status}`);
  }
  const json = (await res.json()) as FirestoreDocumentResponse;
  return decodeFirestoreDoc<T>(json);
}

export async function restListCollection<T>(collectionPath: string, idToken: string): Promise<T[]> {
  const cleanPath = collectionPath.replace(/^\/+/, '');
  const res = await fetch(`${DOCS_BASE}/${cleanPath}?pageSize=500`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`FIRESTORE_REST_ERROR_${res.status}`);
  }
  const json = (await res.json()) as { documents?: FirestoreDocumentResponse[] };
  return (json.documents ?? [])
    .map((d) => decodeFirestoreDoc<T>(d))
    .filter((d): d is T => d !== null);
}

export interface RestWriteInstruction {
  type: 'set' | 'update';
  path: string;
  data: Record<string, unknown>;
}

export async function restCommitWrites(
  writes: RestWriteInstruction[],
  idToken: string
): Promise<void> {
  const restWrites = writes.map((w) => {
    const cleanPath = w.path.replace(/^\/+/, '');
    const name = `${DOC_NAME_PREFIX}/${cleanPath}`;
    const fields: Record<string, FirestoreValue> = {};
    const fieldTransforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = [];
    const updateMaskPaths: string[] = [];

    for (const [key, value] of Object.entries(w.data)) {
      if (value === undefined) continue;
      updateMaskPaths.push(key);
      if (value === SERVER_TIMESTAMP_SENTINEL) {
        fieldTransforms.push({ fieldPath: key, setToServerValue: 'REQUEST_TIME' });
      } else {
        fields[key] = toFirestoreValue(value);
      }
    }

    const writeObj: Record<string, unknown> = {
      update: {
        name,
        fields,
      },
      updateTransforms: fieldTransforms,
    };

    if (w.type === 'update') {
      writeObj.updateMask = { fieldPaths: updateMaskPaths };
      writeObj.currentDocument = { exists: true };
    }

    return writeObj;
  });

  const res = await fetch(`${DOCS_BASE}:commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ writes: restWrites }),
  });

  if (!res.ok) {
    throw new Error(`FIRESTORE_COMMIT_ERROR_${res.status}`);
  }
}
