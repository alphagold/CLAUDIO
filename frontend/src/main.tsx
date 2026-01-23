import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode disabled to prevent Leaflet map double-initialization errors
createRoot(document.getElementById('root')!).render(
  <App />
)
