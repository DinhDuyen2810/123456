import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initSodium } from './crypto/initSodium.js'

initSodium()

createRoot(document.getElementById('root')).render(
  
    <App />
  ,
)
