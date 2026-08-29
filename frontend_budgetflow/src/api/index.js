import axios from 'axios'

// URL de l'API surchargeable en dev via VITE_API_URL (.env.development.local),
// sinon le port 3001 du backend embarqué dans l'app Tauri
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
})

export default api
