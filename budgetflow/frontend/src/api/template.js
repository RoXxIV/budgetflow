import api from './index.js'

export const getTemplateLines = () => api.get('/template/lines')
export const createTemplateLine = (data) => api.post('/template/lines', data)
export const updateTemplateLine = (id, data) => api.put(`/template/lines/${id}`, data)
export const reorderTemplateLines = (orders) => api.put('/template/lines/reorder', { orders })
export const deleteTemplateLine = (id) => api.delete(`/template/lines/${id}`)
export const applyTemplateLineToMonth = (id, monthId) => api.post(`/template/lines/${id}/apply-to-month/${monthId}`)
export const monthlyizeTemplateLine = (id, enabled, accountId = null) => api.put(`/template/lines/${id}/monthlyize`, { enabled, accountId })
