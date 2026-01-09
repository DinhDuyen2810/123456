// src/utils/session.js
export function saveSession(session) {
  sessionStorage.setItem('session', JSON.stringify(session))
}

export function getSession() {
  const s = sessionStorage.getItem('session')
  if (!s) return null
  return JSON.parse(s)
}

export function clearSession() {
  sessionStorage.removeItem('session')
}
