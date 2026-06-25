import api from './index.js'

export const getSavingGoals = () => api.get('/saving-goals')
export const createSavingGoal = (data) => api.post('/saving-goals', data)
export const updateSavingGoal = (id, data) => api.put(`/saving-goals/${id}`, data)
export const deleteSavingGoal = (id) => api.delete(`/saving-goals/${id}`)

export const addContribution = (goalId, data) => api.post(`/saving-goals/${goalId}/contributions`, data)
export const removeContribution = (goalId, contributionId) =>
  api.delete(`/saving-goals/${goalId}/contributions/${contributionId}`)
export const getContributions = (goalId) => api.get(`/saving-goals/${goalId}/contributions`)
