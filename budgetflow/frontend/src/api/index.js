import axios from 'axios'

// Backend budgetflow (nouveau) : port 3003 en dev, surchargeable via VITE_API_URL
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3003/api',
})

export default api
