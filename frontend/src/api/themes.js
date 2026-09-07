import api from './index.js'

// Thèmes : étiquettes transversales aux catégories (« Voiture », « Vacances »),
// posées sur les lignes, les entrées et les calculateurs.

export const getThemes = () => api.get('/themes')
export const createTheme = (data) => api.post('/themes', data)
export const updateTheme = (id, data) => api.put(`/themes/${id}`, data)
// Fusion : tout ce qui pointait sur ce thème passe sur la cible, puis il disparaît
export const mergeTheme = (id, targetId) => api.post(`/themes/${id}/merge`, { targetId })
// force=1 : accepter que ce qui l'utilisait devienne « sans thème » — préférer la fusion
export const deleteTheme = (id, force = false) => api.delete(`/themes/${id}${force ? '?force=1' : ''}`)
