import api from './index.js'

export const getAccounts = () => api.get('/accounts')
export const getNetWorth = () => api.get('/accounts/net-worth')
export const createAccount = (data) => api.post('/accounts', data)
export const updateAccount = (id, data) => api.put(`/accounts/${id}`, data)
export const deleteAccount = (id, transferTo = null) => api.delete(`/accounts/${id}`, transferTo ? { params: { transferTo } } : undefined)
export const getAccountUsage = (id) => api.get(`/accounts/${id}/usage`)
