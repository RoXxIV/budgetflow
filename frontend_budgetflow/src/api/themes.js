import api from './index.js'

export const getThemes = () => api.get('/themes')
export const createTheme = (data) => api.post('/themes', data)
export const updateTheme = (id, data) => api.put(`/themes/${id}`, data)
export const deleteTheme = (id) => api.delete(`/themes/${id}`)
