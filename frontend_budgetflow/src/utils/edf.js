/**
 * Utilitaires de calcul pour les compteurs EDF (HP/HC).
 *
 * Structure attendue d'un `reading` :
 *   reading.hpPrevious / hpCurrent  — index HP début/fin de mois
 *   reading.hcPrevious / hcCurrent  — index HC début/fin de mois
 *   reading.meter.config            — { hpPrice, hcPrice, subscriptionPrice, tvaRate }
 */

/**
 * Extrait les kWh consommés et les paramètres tarifaires d'un relevé.
 * Retourne null si les index ne sont pas encore saisis (delta négatif).
 *
 * @param {Object} reading
 * @returns {{ hp, hc, hpPrice, hcPrice, subscriptionPrice, tvaRate } | null}
 */
function parseReading(reading) {
  const meter = reading.meter
  if (!meter?.config) return null

  const hp = (reading.hpCurrent || 0) - (reading.hpPrevious || 0)
  const hc = (reading.hcCurrent || 0) - (reading.hcPrevious || 0)

  // Index non encore saisis : on ne calcule pas
  if (hp < 0 || hc < 0) return null

  const { hpPrice = 0, hcPrice = 0, subscriptionPrice = 0, tvaRate = 20 } = meter.config
  return { hp, hc, hpPrice, hcPrice, subscriptionPrice, tvaRate }
}

/**
 * Calcule le coût total estimé d'une facture EDF.
 * Formule : (HP_kWh × hpPrice + HC_kWh × hcPrice) × (1 + TVA/100) + abonnement
 *
 * @param {Object} reading
 * @returns {number | null} coût total en €, ou null si non calculable
 */
export function computeEDF(reading) {
  const parsed = parseReading(reading)
  if (!parsed) return null

  const { hp, hc, hpPrice, hcPrice, subscriptionPrice, tvaRate } = parsed
  const energyHT = hp * hpPrice + hc * hcPrice
  return parseFloat((energyHT * (1 + tvaRate / 100) + subscriptionPrice).toFixed(2))
}

/**
 * Retourne le détail ventilé de la facture EDF (pour l'affichage HP/HC).
 * Pratique pour afficher "HP 282 kWh × 70,50 € · HC 239 kWh × 45,41 €".
 *
 * @param {Object} reading
 * @returns {{ hp, hc, htHP, htHC, subscriptionPrice, tvaRate } | null}
 */
export function computeEDFDetail(reading) {
  const parsed = parseReading(reading)
  if (!parsed) return null

  const { hp, hc, hpPrice, hcPrice, subscriptionPrice, tvaRate } = parsed
  return {
    hp,
    hc,
    htHP: parseFloat((hp * hpPrice).toFixed(2)),
    htHC: parseFloat((hc * hcPrice).toFixed(2)),
    subscriptionPrice,
    tvaRate,
  }
}
