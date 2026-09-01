import api from './index.js'

export const getAccounts = () => api.get('/accounts')
export const getNetWorth = () => api.get('/accounts/net-worth')
export const createAccount = (data) => api.post('/accounts', data)
export const updateAccount = (id, data) => api.put(`/accounts/${id}`, data)
export const deleteAccount = (id) => api.delete(`/accounts/${id}`)
