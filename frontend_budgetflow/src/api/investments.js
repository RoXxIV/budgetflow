import api from './index.js'

export const getInvestments = () => api.get('/investments')
export const createInvestment = (data) => api.post('/investments', data)
export const updateInvestment = (id, data) => api.put(`/investments/${id}`, data)
export const deleteInvestment = (id) => api.delete(`/investments/${id}`)
