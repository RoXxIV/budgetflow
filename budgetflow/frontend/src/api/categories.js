import api from './index.js'

export const getCategories = () => api.get('/categories')
export const createCategory = (data) => api.post('/categories', data)
export const updateCategory = (id, data) => api.put(`/categories/${id}`, data)
export const reorderCategories = (orders) => api.put('/categories/reorder', { orders })
export const deleteCategory = (id) => api.delete(`/categories/${id}`)
