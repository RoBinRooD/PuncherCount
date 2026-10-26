/**
 * Minimal Google Drive client for a static site: Google Identity Services gives a short-lived
 * access token in the browser, then plain fetch calls the Drive REST API. The `drive.file`
 * scope only reaches files this app created, never the rest of the user's Drive.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const TOKEN_KEY = 'puncher-count:google-token'

/** Marks every file this app creates, so they can be found without relying on names. */
export type AppTag = 'root' | 'index' | 'clip' | 'video'

export interface DriveFile {
  id: string
  name: string
  appProperties?: Record<string, string>
}

export class NeedsSignIn extends Error {
  constructor() {
    super('ต้องเข้าสู่ระบบ Google อีกครั้ง')
  }
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string
            scope: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type: string; message?: string }) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

let token: { value: string; expires: number } | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null')
  } catch {
    return null
  }
})()

function setToken(t: typeof token) {
  token = t
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // keep it in memory only
  }
}

export const hasToken = () => !!token && token.expires > Date.now() + 60_000

let gisLoading: Promise<void> | null = null
function loadGis(): Promise<void> {
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisLoading = null
      reject(new Error('โหลดระบบล็อกอิน Google ไม่ได้ (ต้องต่ออินเทอร์เน็ต)'))
    }
    document.head.appendChild(s)
  })
  return gisLoading
}

/**
 * Ask Google for an access token. Must be called from a tap/click (it may open a popup).
 * `prompt: ''` skips the consent screen when the user already agreed once.
 */
export async function signIn(clientId: string, prompt: '' | 'consent' = ''): Promise<void> {
  await loadGis()
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'เข้าสู่ระบบไม่สำเร็จ'))
        setToken({ value: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 })
        resolve()
      },
      error_callback: (e) =>
        reject(new Error(e.type === 'popup_closed' ? 'ปิดหน้าต่างล็อกอินก่อนเสร็จ' : e.message || 'เข้าสู่ระบบไม่สำเร็จ')),
    })
    client.requestAccessToken({ prompt })
  })
}

export function signOut() {
  if (token) window.google?.accounts.oauth2.revoke(token.value)
  setToken(null)
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  if (!hasToken()) throw new NeedsSignIn()
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token!.value}` } })
  if (res.status === 401) {
    setToken(null)
    throw new NeedsSignIn()
  }
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function list(query: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken,files(id,name,appProperties)',
      pageSize: '1000',
      spaces: 'drive',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const r = await (await call(`${API}/files?${params}`)).json()
    out.push(...r.files)
    pageToken = r.nextPageToken ?? ''
  } while (pageToken)
  return out
}

/** The app's "PuncherCount" folder, created on first use. */
export async function ensureFolder(): Promise<string> {
  const found = await list(`appProperties has { key='pc' and value='root' } and trashed=false`)
  if (found[0]) return found[0].id
  const res = await call(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'PuncherCount', mimeType: 'application/vnd.google-apps.folder', appProperties: { pc: 'root' } }),
  })
  return (await res.json()).id
}

export const listFolder = (folderId: string) => list(`'${q(folderId)}' in parents and trashed=false`)

export async function readJson<T>(fileId: string): Promise<T> {
  return (await call(`${API}/files/${fileId}?alt=media`)).json()
}

/** Create (or overwrite, when `fileId` is given) a JSON file in the folder. */
export async function writeJson(
  folderId: string,
  name: string,
  data: unknown,
  appProperties: Record<string, string>,
  fileId?: string,
): Promise<string> {
  const meta = fileId ? { name, appProperties } : { name, appProperties, parents: [folderId], mimeType: 'application/json' }
  const body = new FormData()
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }))
  body.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }))
  const url = fileId ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`
  const res = await call(url, { method: fileId ? 'PATCH' : 'POST', body })
  return (await res.json()).id
}

export async function trash(fileId: string) {
  await call(`${API}/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

/** Upload a (possibly large) file with a resumable session so we can report progress. */
export async function uploadFile(
  folderId: string,
  file: Blob,
  name: string,
  appProperties: Record<string, string>,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const type = file.type || 'application/octet-stream'
  const start = await call(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': type },
    body: JSON.stringify({ name, parents: [folderId], appProperties }),
  })
  const session = start.headers.get('Location')
  if (!session) throw new Error('Google Drive ไม่ได้ส่งที่อยู่สำหรับอัปโหลด')
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', session)
    xhr.setRequestHeader('Authorization', `Bearer ${token!.value}`)
    xhr.setRequestHeader('Content-Type', type)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(JSON.parse(xhr.responseText).id)
        : reject(new Error(`อัปโหลดวิดีโอไม่สำเร็จ (${xhr.status})`))
    xhr.onerror = () => reject(new Error('อัปโหลดวิดีโอไม่สำเร็จ (เครือข่าย)'))
    xhr.send(file)
  })
}
