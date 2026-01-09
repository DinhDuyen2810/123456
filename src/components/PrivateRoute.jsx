// src/components/PrivateRoute.jsx
import { Navigate } from 'react-router-dom'
import { getSession } from '../utils/session'

export default function PrivateRoute({ children }) {
  const session = getSession()
  if (!session) return <Navigate to="/" replace />
  return children
}
