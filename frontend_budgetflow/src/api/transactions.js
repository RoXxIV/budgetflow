import api from './index.js'

export const getTransactionsByLine = (lineId) => api.get(`/transactions/line/${lineId}`)
export const createTransaction = (data) => api.post('/transactions', data)
export const updateTransaction = (id, data) => api.put(`/transactions/${id}`, data)
export const cancelTransaction = (id) => api.post(`/transactions/${id}/cancel`)
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`)
