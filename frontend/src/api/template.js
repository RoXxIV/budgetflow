import api from './index.js'

// Budget type : le mois modèle, dont chaque nouveau mois est recopié. Ses lignes
// portent le jour de prélèvement, la périodicité et le compte concerné.

export const getTemplateLines = () => api.get('/template/lines')
export const createTemplateLine = (data) => api.post('/template/lines', data)
export const updateTemplateLine = (id, data) => api.put(`/template/lines/${id}`, data)
export const reorderTemplateLines = (orders) => api.put('/template/lines/reorder', { orders })
export const deleteTemplateLine = (id) => api.delete(`/template/lines/${id}`)
// Pousse une ligne du budget type dans un mois déjà créé (il ne se recopie qu'à la naissance)
export const applyTemplateLineToMonth = (id, monthId) => api.post(`/template/lines/${id}/apply-to-month/${monthId}`)
// Mensualiser une ligne annuelle : une enveloppe liée met de côté chaque mois,
// et l'échéance se paie en la liquidant
export const monthlyizeTemplateLine = (id, enabled, accountId = null) => api.put(`/template/lines/${id}/monthlyize`, { enabled, accountId })
