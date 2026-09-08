import api from './index.js'

// Plan de financement — bac à sable : le calcul part de ce qu'on envoie, rien n'est
// enregistré en base.
export const computePlan = (input) => api.post('/plan/compute', input)
// L'autre sens : une cible et un délai donnent une mensualité
export const shareFor = (target, months, already = 0) => api.post('/plan/share', { target, months, already })
// Les moyennes réelles par thème et par catégorie, pour pré-remplir une ligne
export const getAverages = () => api.get('/plan/averages')
