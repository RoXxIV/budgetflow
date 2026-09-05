import api from './index.js'

// Tracker d'abonnements (bac à sable) : rien ne se répercute ailleurs
export const getSubscriptions = () => api.get('/subscriptions')
export const createSubscription = (data) => api.post('/subscriptions', data)
export const updateSubscription = (id, data) => api.put(`/subscriptions/${id}`, data)
export const deleteSubscription = (id) => api.delete(`/subscriptions/${id}`)
export const importSubscriptions = () => api.post('/subscriptions/import')
