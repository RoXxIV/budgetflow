import api from './index.js'

// Catégories : le rangement des lignes budgétaires. Leur type (dépense, revenu,
// épargne, transfert) pilote les totaux et les statistiques.

export const getCategories = () => api.get('/categories')
export const createCategory = (data) => api.post('/categories', data)
export const updateCategory = (id, data) => api.put(`/categories/${id}`, data)
export const reorderCategories = (orders) => api.put('/categories/reorder', { orders })
// force=1 : accepter que les lignes qui l'utilisaient deviennent « sans catégorie »
export const deleteCategory = (id, force = false) => api.delete(`/categories/${id}${force ? '?force=1' : ''}`)
