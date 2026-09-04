import api from './index.js'

export const getThemes = () => api.get('/themes')
export const createTheme = (data) => api.post('/themes', data)
export const updateTheme = (id, data) => api.put(`/themes/${id}`, data)
export const mergeTheme = (id, targetId) => api.post(`/themes/${id}/merge`, { targetId })
export const deleteTheme = (id, force = false) => api.delete(`/themes/${id}${force ? '?force=1' : ''}`)
