import api from './index.js'

// Enveloppes : de l'argent réservé à l'intérieur d'un compte (un voyage, une facture
// annuelle). Le solde bancaire ne bouge pas, seule la part disponible diminue.

export const getEnvelopes = () => api.get('/envelopes')
export const createEnvelope = (data) => api.post('/envelopes', data)
export const updateEnvelope = (id, data) => api.put(`/envelopes/${id}`, data)
export const deleteEnvelope = (id) => api.delete(`/envelopes/${id}`)
// Clôture d'une enveloppe qui porte de l'histoire : son contenu est réaffecté
// ailleurs plutôt que perdu (« jamais de perte »)
export const closeEnvelopeInto = (id, data) => api.post(`/envelopes/${id}/close-into`, data)
// Mensualisée : vide l'enveloppe vers un compte et relance le cycle (l'échéance est payée)
export const liquidateEnvelope = (id, toAccountId) => api.post(`/envelopes/${id}/liquidate`, { toAccountId })
export const getContributions = (id) => api.get(`/envelopes/${id}/contributions`)
export const addContribution = (id, data) => api.post(`/envelopes/${id}/contributions`, data)
export const removeContribution = (id, contribId) => api.delete(`/envelopes/${id}/contributions/${contribId}`)
// Disponible hors enveloppes d'un compte : l'invariant Σ enveloppes ≤ solde
export const getAvailability = (accountId) => api.get(`/envelopes/availability/${accountId}`)
// Simulation « cible X en N mois » du formulaire : n'écrit rien en base
export const simulateEnvelope = (data) => api.post('/envelopes/simulate', data)
// Déplacement d'argent entre deux enveloppes d'un même compte : aucun mouvement bancaire
export const reallocateEnvelope = (id, data) => api.post(`/envelopes/${id}/reallocate`, data)
