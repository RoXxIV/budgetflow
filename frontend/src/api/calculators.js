import api from './index.js'

// Calculateurs : estiment une facture à partir de relevés (index EDF, eau…) et
// d'une formule, puis régularisent l'écart avec le montant réellement prélevé.

export const getCalculators = () => api.get('/calculators')
export const createCalculator = (data) => api.post('/calculators', data)
export const updateCalculator = (id, data) => api.put(`/calculators/${id}`, data)
export const deleteCalculator = (id) => api.delete(`/calculators/${id}`)
// Valide une formule avant enregistrement, en vérifiant que ses symboles existent
export const checkFormula = (formula, symbols) => api.post('/calculators/check', { formula, symbols })

export const getMonthCalculators = (monthId) => api.get(`/months/${monthId}/calculators`)
export const saveMonthReadings = (monthId, calcId, readings) => api.put(`/months/${monthId}/calculators/${calcId}/readings`, { readings })
// Reporte l'écart entre estimation et prélèvement réel sur la ligne du mois
export const regularizeCalculator = (monthId, calcId) => api.post(`/months/${monthId}/calculators/${calcId}/regularize`)
