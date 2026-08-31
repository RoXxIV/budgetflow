import api from './index.js'

export const getEnvelopes = () => api.get('/envelopes')
export const createEnvelope = (data) => api.post('/envelopes', data)
export const updateEnvelope = (id, data) => api.put(`/envelopes/${id}`, data)
export const deleteEnvelope = (id) => api.delete(`/envelopes/${id}`)
export const getContributions = (id) => api.get(`/envelopes/${id}/contributions`)
export const addContribution = (id, data) => api.post(`/envelopes/${id}/contributions`, data)
export const removeContribution = (id, contribId) => api.delete(`/envelopes/${id}/contributions/${contribId}`)
