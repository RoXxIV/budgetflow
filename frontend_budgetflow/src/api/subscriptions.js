import api from './index.js'

export const getSubscriptions = () => api.get('/subscriptions')
export const createSubscription = (data) => api.post('/subscriptions', data)
export const updateSubscription = (id, data) => api.put(`/subscriptions/${id}`, data)
export const deleteSubscription = (id) => api.delete(`/subscriptions/${id}`)
