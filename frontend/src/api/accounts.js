import api from './index.js'

// Comptes bancaires : le socle de tout le reste — un mois suit les soldes de comptes,
// une enveloppe est hébergée par un compte, le patrimoine les additionne.

export const getAccounts = () => api.get('/accounts')
// Le patrimoine : soldes du mois en cours + valeur de marché des investissements
export const getNetWorth = () => api.get('/accounts/net-worth')
export const createAccount = (data) => api.post('/accounts', data)
export const updateAccount = (id, data) => api.put(`/accounts/${id}`, data)
export const deleteAccount = (id) => api.delete(`/accounts/${id}`)
// Désactivation plutôt que suppression dès qu'un compte porte de l'histoire
// (« jamais de perte ») ; transferTo reçoit le solde restant.
export const setAccountActive = (id, isActive, transferTo = null) => api.put(`/accounts/${id}/active`, { isActive, transferTo })
