import api from './index.js'

export const getCalculators = () => api.get('/calculators')
export const createCalculator = (data) => api.post('/calculators', data)
export const updateCalculator = (id, data) => api.put(`/calculators/${id}`, data)
export const deleteCalculator = (id) => api.delete(`/calculators/${id}`)
export const checkFormula = (formula, symbols) => api.post('/calculators/check', { formula, symbols })

export const getMonthCalculators = (monthId) => api.get(`/months/${monthId}/calculators`)
export const saveMonthReadings = (monthId, calcId, readings) => api.put(`/months/${monthId}/calculators/${calcId}/readings`, { readings })
export const regularizeCalculator = (monthId, calcId) => api.post(`/months/${monthId}/calculators/${calcId}/regularize`)
