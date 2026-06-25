import api from './index.js'

export const getSections = () => api.get('/sections')
export const createSection = (data) => api.post('/sections', data)
export const updateSection = (id, data) => api.put(`/sections/${id}`, data)
export const deleteSection = (id) => api.delete(`/sections/${id}`)
export const reorderSections = (orders) => api.put('/sections/reorder', orders)
