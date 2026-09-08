<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getSettings, updateSettings } from '@/api/settings.js'
import { getCategories, createCategory, updateCategory, reorderCategories, deleteCategory } from '@/api/categories.js'
import { getThemes, createTheme, updateTheme, deleteTheme, mergeTheme } from '@/api/themes.js'
import { getTemplateLines } from '@/api/template.js'
import { getCalculators, createCalculator, updateCalculator, deleteCalculator, checkFormula } from '@/api/calculators.js'
import { getDataStats, exportData, importData, resetData } from '@/api/data.js'
import AppModal from '@/components/AppModal.vue'
import AppSpinner from '@/components/AppSpinner.vue'
import { confirmDialog, apiError, toast } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'
import { CATEGORY_PRESETS, CATEGORY_PALETTE, CATEGORY_TYPES } from '@/lib/categories.js'
import { THEME_OPTIONS, getThemePref, setThemePref } from '@/lib/theme.js'

/**
 * Directive v-focus : donne le focus à un champ dès son apparition, curseur en fin
 * de texte pour compléter plutôt que remplacer.
 *
 * setSelectionRange n'existe pas sur un <input type="number"> : l'exception est
 * avalée, le focus reste acquis.
 */
const vFocus = {
  mounted: (el) => { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length) } catch { /* type number */ } },
}

// ─── Data ────────────────────────────────────────────────
const settings = ref(null)
const categories = ref([])
const themes = ref([])
const templateLines = ref([])
const calculators = ref([])
const dataStats = ref(null)

/** Recharge les collections de la page en un seul aller-retour groupé. */
async function load() {
  const [setRes, catRes, themeRes, tlRes, calcRes, dataRes] = await Promise.all([
    getSettings(), getCategories(), getThemes(), getTemplateLines(), getCalculators(), getDataStats(),
  ])
  settings.value = setRes.data
  categories.value = catRes.data
  themes.value = themeRes.data
  templateLines.value = tlRes.data
  calculators.value = calcRes.data
  dataStats.value = dataRes.data
}
onMounted(async () => { try { await load() } catch (e) { apiError(e) } })

const fmt = eur

// ─── Vos données : sauvegarder, importer, tout effacer ───
// Ces trois actions travaillent sur le FICHIER de base, jamais sur les tables : côté
// serveur, aucune requête destructrice n'existe. L'écran, lui, a une seule charge —
// que rien d'irréversible ne parte sur un clic distrait.

const dataBusy = ref('')   // 'export' | 'import' | 'reset' : n'occupe qu'un bouton à la fois
const dataLabel = ref('')  // ce que le voile annonce pendant l'attente, puis le résultat
const resetStep = ref(0)   // 0 fermé · 1 « êtes-vous sûr » · 2 « c'est définitif »
const fileInput = ref(null)

// Ce qui est en jeu, en clair : « 401 écritures · 8 mois · 9 comptes »
const dataResume = computed(() => (dataStats.value?.lignes || []).map((l) => `${l.count} ${l.label}`).join(' · '))
// Poids du fichier, dans l'unité qui se lit le mieux
const dataTaille = computed(() => {
  const o = dataStats.value?.taille || 0
  return o >= 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.round(o / 1024)} Ko`
})

/**
 * Donne un blob à enregistrer sous un nom choisi.
 *
 * Passer par un lien créé puis cliqué est le seul moyen de nommer un fichier
 * téléchargé depuis du JavaScript. L'URL objet est révoquée dans la foulée : sans
 * ça, le blob resterait en mémoire jusqu'au rechargement de la page.
 *
 * @param {Blob} blob Le contenu à enregistrer.
 * @param {string} nom Le nom de fichier proposé.
 */
function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Recharge la page après une opération qui a changé la base sous les pieds de l'app.
 *
 * Un import ou une remise à zéro invalident tout ce que les autres écrans ont en
 * mémoire, et l'état du guide de bienvenue se relit au démarrage : rien de moins
 * qu'un rechargement complet ne remet l'application d'aplomb.
 *
 * Le résultat s'affiche sur le voile, pas en notification : le voile reste posé
 * jusqu'au rechargement, un toast passerait dessous sans être lu.
 *
 * @param {string} message Ce qui vient de se passer.
 */
function rechargerApres(message) {
  dataLabel.value = message
  setTimeout(() => window.location.reload(), 1400)
}

/** Télécharge une copie complète de la base. */
async function sauvegarder() {
  dataBusy.value = 'export'
  try {
    const res = await exportData()
    // Le serveur nomme le fichier dans l'en-tête ; le nom de repli ne sert qu'en cas d'absence
    const nom = /filename="?([^";]+)"?/.exec(res.headers['content-disposition'] || '')?.[1]
    telecharger(res.data, nom || 'budgetflow.db')
    toast('Sauvegarde téléchargée')
  } catch (e) {
    apiError(e)
  } finally { dataBusy.value = '' }
}

/**
 * Remplace toutes les données par celles d'une sauvegarde.
 *
 * Le champ est vidé dès la sélection : sans ça, choisir le même fichier après une
 * annulation ne déclencherait aucun événement, et le bouton semblerait cassé.
 */
async function importer(event) {
  const fichier = event.target.files?.[0]
  event.target.value = ''
  if (!fichier) return

  const ok = await confirmDialog({
    title: 'Remplacer vos données ?',
    message: `« ${fichier.name} » va prendre la place de vos données actuelles.\n\n${dataResume.value || 'La base est vide.'}\n\nL'état présent est archivé sur votre disque avant le remplacement.`,
    confirmLabel: 'Remplacer', danger: true,
  })
  if (!ok) return

  dataBusy.value = 'import'
  dataLabel.value = 'Import en cours…'
  try {
    const { data } = await importData(fichier)
    const quoi = data.importe.lignes.map((l) => `${l.count} ${l.label}`).join(' · ')
    rechargerApres(`Données remplacées — ${quoi}`)
  } catch (e) {
    apiError(e)
    dataBusy.value = ''
  }
}

/** Efface tout, après les deux confirmations. Le serveur archive avant de vider. */
async function effacerTout() {
  dataBusy.value = 'reset'
  dataLabel.value = 'Effacement en cours…'
  try {
    await resetData()
    resetStep.value = 0
    rechargerApres('Données effacées — une archive est conservée sur votre disque')
  } catch (e) {
    apiError(e)
    dataBusy.value = ''
  }
}

/**
 * Met une majuscule initiale à un nom saisi.
 *
 * Les sigles courts tout en capitales sont laissés intacts : « CB » ne doit pas
 * devenir « Cb ».
 *
 * @param {string} s Le texte saisi.
 * @returns {string} Le texte avec son initiale en majuscule.
 */
const capFirst = (s) => (s.length <= 3 && s === s.toUpperCase() ? s : s.charAt(0).toUpperCase() + s.slice(1))

// ─── Un seul modèle d'enregistrement : au blur, indicateur « Enregistré » 2 s ───
const savedIn = ref('')
let savedTimer = null

/**
 * Affiche « Enregistré » sur un panneau, deux secondes.
 *
 * La page n'a pas de bouton « Sauver » : tout part au blur. Ce témoin est le seul
 * retour visible, sans quoi l'utilisateur ne saurait pas si sa saisie a été prise.
 * Le minuteur est remis à zéro à chaque appel — deux enregistrements rapprochés ne
 * font pas disparaître le témoin plus tôt.
 *
 * @param {string} panel Le panneau concerné ('general', 'categories', 'themes'…).
 */
function flashSaved(panel) {
  savedIn.value = panel
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => { savedIn.value = '' }, 2000)
}

// ─── Édition en place : une ligne se lit comme du texte, devient un champ au clic ───
// Une seule ligne éditable à la fois dans toute la page : `key` désigne laquelle
// (« cat12 », « theme3 », « rate »…), `val` porte la saisie en cours
const edit = ref({ key: null, val: '' })
const startEdit = (key, val) => { edit.value = { key, val: String(val ?? '') } }
const cancelEdit = () => { edit.value = { key: null, val: '' } }

// ─── Menus ⋯ ─────────────────────────────────────────────
const menuKey = ref(null)

// ─── Général ─────────────────────────────────────────────
const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']
// Une devise enregistrée hors liste reste proposée : la changer ne doit pas être
// un aller sans retour
const currencyOptions = computed(() => {
  const c = settings.value?.currency
  return c && !CURRENCIES.includes(c) ? [c, ...CURRENCIES] : CURRENCIES
})

/**
 * Enregistre une modification des réglages généraux.
 *
 * En cas d'échec, les réglages sont relus depuis le serveur : l'écran doit montrer ce
 * qui est réellement enregistré, pas ce que l'utilisateur croyait avoir posé.
 *
 * @param {object} patch Les champs à modifier.
 */
async function saveGeneral(patch) {
  try {
    settings.value = (await updateSettings(patch)).data
    flashSaved('general')
  } catch (e) { apiError(e); settings.value = (await getSettings()).data }
}
/**
 * Enregistre le taux d'épargne visé, à la sortie du champ.
 *
 * Une saisie illisible laisse la valeur en place plutôt que de la remettre à zéro en
 * silence — un objectif d'épargne effacé par accident ne se remarque pas. Le taux est
 * borné à 0-100 : au-delà, la phrase d'exemple n'aurait plus de sens.
 */
async function commitRate() {
  if (edit.value.key !== 'rate') return
  const raw = parseFloat(String(edit.value.val).replace(',', '.'))
  cancelEdit()
  if (Number.isNaN(raw)) return // saisie invalide : on garde la valeur en place, jamais 0 en silence
  const v = Math.min(100, Math.max(0, raw))
  if (v !== settings.value.savingRate) await saveGeneral({ savingRate: v })
}
// Revenus du mois-type : la somme des lignes rangées dans une catégorie de type revenu
const revenusPrevus = computed(() => {
  const revCats = new Set(categories.value.filter((c) => c.type === 'revenu').map((c) => c.id))
  return templateLines.value.reduce((s, l) => s + (revCats.has(l.categoryId) ? (l.plannedAmount || 0) : 0), 0)
})
// Traduit le taux en euros (« 40 % de 2 418,00 € = 967,20 € par mois ») : un
// pourcentage seul ne parle pas, un montant si
const savingsPhrase = computed(() => {
  const rate = settings.value?.savingRate || 0
  if (!rate || !revenusPrevus.value) return ''
  return `${rate} % de ${fmt(revenusPrevus.value)} = ${fmt(Math.round(revenusPrevus.value * rate) / 100)} par mois.`
})

// Bascule clair / sombre / système. Cette préférence vit dans le navigateur, pas en
// base : elle est propre à la machine, pas à l'utilisateur.
const themePref = ref(getThemePref())

/** Applique le thème choisi et le retient. */
function changeTheme() {
  setThemePref(themePref.value)
  flashSaved('general')
}

const newPaymentMethod = ref('')

/** Ajoute un moyen de paiement, en ignorant les doublons. */
async function addPaymentMethod() {
  const v = capFirst(newPaymentMethod.value.trim())
  if (!v || settings.value.paymentMethods.includes(v)) return
  newPaymentMethod.value = ''
  await saveGeneral({ paymentMethods: [...settings.value.paymentMethods, v] })
}
/** Retire un moyen de paiement de la liste proposée aux saisies. */
async function removePaymentMethod(m) {
  await saveGeneral({ paymentMethods: settings.value.paymentMethods.filter((x) => x !== m) })
}
const newInvestmentType = ref('')

/** Ajoute une classe d'investissement (ETF, Crypto…), en ignorant les doublons. */
async function addInvestmentType() {
  const v = capFirst(newInvestmentType.value.trim())
  if (!v || settings.value.investmentTypes.includes(v)) return
  newInvestmentType.value = ''
  await saveGeneral({ investmentTypes: [...settings.value.investmentTypes, v] })
}
/** Retire une classe d'investissement de la liste proposée. */
async function removeInvestmentType(t) {
  await saveGeneral({ investmentTypes: settings.value.investmentTypes.filter((x) => x !== t) })
}

// ─── Catégories ──────────────────────────────────────────
const TYPE_HINTS = {
  depense: 'comptée dans les dépenses et les stats',
  revenu: 'comptée dans les revenus du mois',
  epargne: 'comptée dans « mis de côté », pas dans les dépenses',
  transfert: 'bouge les soldes, exclue des stats de dépenses',
}
// Prochaine couleur libre de la palette fermée ; au-delà de douze catégories, on
// recommence le tour plutôt que d'inventer une couleur hors palette
const nextColor = () => CATEGORY_PALETTE.find((p) => !categories.value.some((c) => c.color === p)) || CATEGORY_PALETTE[categories.value.length % 12]
const colorPickerFor = ref(null) // id de la catégorie dont la palette est ouverte ('new' pour l'ajout)

const newCategory = ref({ name: '', type: 'depense', color: null })

/** Crée une catégorie ; sans couleur choisie, elle prend la prochaine libre. */
async function addCategory() {
  const name = capFirst(newCategory.value.name.trim())
  if (!name) return
  try {
    await createCategory({ name, type: newCategory.value.type, color: newCategory.value.color || nextColor() })
    newCategory.value = { name: '', type: 'depense', color: null }
    categories.value = (await getCategories()).data
    flashSaved('categories')
  } catch (e) { apiError(e) }
}
/**
 * Renomme une catégorie, à la sortie du champ.
 *
 * Un nom vide ou inchangé n'appelle pas le serveur. En cas d'échec — un nom déjà pris,
 * par exemple — la liste est relue pour effacer la modification optimiste affichée.
 *
 * @param {object} category La catégorie renommée.
 */
async function commitCatName(category) {
  if (edit.value.key !== 'cat' + category.id) return
  const name = edit.value.val.trim()
  cancelEdit()
  if (!name || name === category.name) return
  try {
    await updateCategory(category.id, { name })
    categories.value = (await getCategories()).data
    flashSaved('categories')
  } catch (e) { apiError(e); categories.value = (await getCategories()).data }
}
/**
 * Change le type d'une catégorie (dépense, revenu, épargne, transfert).
 *
 * Loin d'être cosmétique : le type décide de quel côté la catégorie tombe dans tous
 * les totaux et toutes les statistiques.
 *
 * @param {object} category La catégorie, dont `type` porte déjà la nouvelle valeur.
 */
async function setCatType(category) {
  try { await updateCategory(category.id, { type: category.type }); flashSaved('categories') }
  catch (e) { apiError(e); categories.value = (await getCategories()).data }
}
/**
 * Change la couleur d'une catégorie et referme la palette.
 *
 * @param {object} category La catégorie.
 * @param {string} color La couleur choisie, prise dans la palette fermée.
 */
async function setCatColor(category, color) {
  colorPickerFor.value = null
  if (color === category.color) return
  try {
    await updateCategory(category.id, { color })
    categories.value = (await getCategories()).data
    flashSaved('categories')
  } catch (e) { apiError(e) }
}

// Combien de lignes s'appuient sur cette catégorie, template et mois confondus
const catUsage = (c) => (c.templateLines || 0) + (c.monthLines || 0)

/**
 * Supprime une catégorie, après un avertissement proportionné.
 *
 * Le message change selon l'usage : une catégorie inutilisée part sans cérémonie,
 * une catégorie employée annonce combien de lignes basculeront en « Sans catégorie ».
 * Le `force` passé au serveur est précisément cette acceptation.
 *
 * @param {object} category La catégorie à supprimer.
 */
async function removeCategoryConfirm(category) {
  const used = catUsage(category)
  const ok = await confirmDialog({
    title: 'Supprimer la catégorie',
    message: used
      ? `Supprimer « ${category.name} » ?\n${category.templateLines} ligne(s) du template et ${category.monthLines} ligne(s) de mois y sont rattachées : elles passeront en « Sans catégorie ».`
      : `Supprimer « ${category.name} » ? Elle n'est utilisée nulle part.`,
    confirmLabel: 'Supprimer la catégorie', danger: true,
  })
  if (!ok) return
  try {
    await deleteCategory(category.id, used > 0)
    categories.value = (await getCategories()).data
  } catch (e) { apiError(e) }
}

// Réordonnancement : poignée de glissement + Alt+↑/↓ au clavier (annoncé en aria-live)
const ariaMsg = ref('')
const dragId = ref(null)      // catégorie en cours de glissement
const dragArmed = ref(null)   // poignée pressée : la ligne devient draggable
/** Début de glissement : mémorise la catégorie déplacée. */
function onDragStart(category) { dragId.value = category.id }

/**
 * Réordonne pendant le glissement, à chaque survol d'une autre ligne.
 *
 * La liste locale est réarrangée en direct pour que l'utilisateur voie le résultat
 * sous son curseur ; rien n'est envoyé au serveur avant le relâchement.
 *
 * @param {object} category La catégorie survolée.
 */
function onDragOver(category) {
  if (dragId.value === null || dragId.value === category.id) return
  const list = [...categories.value]
  const from = list.findIndex((c) => c.id === dragId.value)
  const to = list.findIndex((c) => c.id === category.id)
  list.splice(to, 0, list.splice(from, 1)[0])
  categories.value = list
}
/**
 * Fin de glissement : enregistre le nouvel ordre.
 *
 * En cas d'échec, la liste est relue — l'ordre affiché ne doit jamais différer de
 * celui qui est enregistré.
 */
async function onDragEnd() {
  dragId.value = null
  dragArmed.value = null
  try { await reorderCategories(categories.value.map((c, i) => ({ id: c.id, order: i }))); flashSaved('categories') }
  catch (e) { apiError(e); categories.value = (await getCategories()).data }
}
/**
 * Déplace une catégorie au clavier (Alt+↑/↓), alternative au glisser-déposer.
 *
 * Le déplacement est annoncé dans une zone aria-live : au clavier, on ne voit pas
 * forcément la ligne bouger, il faut donc l'énoncer.
 *
 * @param {number} index Position actuelle.
 * @param {number} delta -1 pour monter, +1 pour descendre.
 */
async function moveCategory(index, delta) {
  const target = index + delta
  if (target < 0 || target >= categories.value.length) return
  const list = [...categories.value]
  ;[list[index], list[target]] = [list[target], list[index]]
  categories.value = list
  ariaMsg.value = `« ${list[target].name} » déplacée en position ${target + 1} sur ${list.length}`
  try { await reorderCategories(list.map((c, i) => ({ id: c.id, order: i }))); flashSaved('categories') }
  catch (e) { apiError(e) }
}

/** Crée d'un coup les catégories proposées, quand la liste est vide. */
async function applyPresets() {
  try {
    for (const p of CATEGORY_PRESETS) await createCategory(p)
    categories.value = (await getCategories()).data
  } catch (e) { apiError(e) }
}

// ─── Thèmes : plus de couleur stockée à la saisie, recherche, tri, fusion via menu ───
const themeSearch = ref('')
const themeSort = ref('alpha') // 'alpha' | 'usage'
// Combien d'objets portent ce thème — lignes, entrées et calculateurs confondus
const themeUsage = (t) => (t.lines || 0) + (t.entries || 0) + (t.calculators || 0)

// Liste filtrée puis triée. Le tri « par usage » remonte les MOINS utilisés en tête :
// on trie par usage quand on cherche à faire le ménage, pas à admirer ses classiques.
const sortedThemes = computed(() => {
  const q = themeSearch.value.trim().toLowerCase()
  const list = themes.value.filter((t) => !q || t.name.toLowerCase().includes(q))
  return themeSort.value === 'usage'
    ? [...list].sort((a, b) => themeUsage(a) - themeUsage(b) || a.name.localeCompare(b.name, 'fr'))
    : [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr')) // A-Z explicite, sans dépendre de l'ordre du backend
})
const newTheme = ref('')

/** Crée un thème. */
async function addTheme() {
  const name = capFirst(newTheme.value.trim())
  if (!name) return
  try {
    await createTheme({ name })
    newTheme.value = ''
    themes.value = (await getThemes()).data
    flashSaved('themes')
  } catch (e) { apiError(e) }
}
/**
 * Renomme un thème, à la sortie du champ.
 *
 * @param {object} theme Le thème renommé.
 */
async function commitThemeName(theme) {
  if (edit.value.key !== 'theme' + theme.id) return
  const name = edit.value.val.trim()
  cancelEdit()
  if (!name || name === theme.name) return
  try {
    await updateTheme(theme.id, { name })
    themes.value = (await getThemes()).data
    flashSaved('themes')
  } catch (e) { apiError(e); themes.value = (await getThemes()).data }
}
/**
 * Supprime un thème, après un avertissement proportionné à son usage.
 *
 * Le message oriente vers la FUSION quand le thème sert déjà : elle garde
 * l'historique là où la suppression le disperse en « sans thème ».
 *
 * @param {object} theme Le thème à supprimer.
 */
async function removeThemeConfirm(theme) {
  const used = themeUsage(theme)
  const ok = await confirmDialog({
    title: 'Supprimer le thème',
    message: used
      ? `Supprimer « ${theme.name} » ?\n${theme.lines} ligne(s) et ${theme.entries} entrée(s) y sont rattachées : elles passeront en « sans thème ». Pour garder l'historique, préférez la fusion dans un autre thème.`
      : `Supprimer « ${theme.name} » ? Il n'est utilisé nulle part.`,
    confirmLabel: used ? 'Supprimer quand même' : 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteTheme(theme.id, used > 0)
    themes.value = (await getThemes()).data
  } catch (e) { apiError(e) }
}
// Fusion (l'ancien select anonyme, désormais nommée et confirmée)
const mergeFor = ref(null)     // thème source
const mergeTargetId = ref('')
onUnmounted(() => { clearTimeout(savedTimer); clearTimeout(calcCheckTimer) })
/**
 * Ouvre la fusion d'un thème vers un autre.
 *
 * @param {object} theme Le thème source, celui qui disparaîtra.
 */
function openMerge(theme) {
  mergeFor.value = theme
  mergeTargetId.value = ''
}
/**
 * Exécute la fusion : tout ce qui portait le thème source passe sur la cible.
 *
 * Le message de retour vient du serveur, qui sait combien d'objets ont bougé.
 */
async function confirmMerge() {
  if (!mergeFor.value || !mergeTargetId.value) return
  try {
    const { data } = await mergeTheme(mergeFor.value.id, mergeTargetId.value)
    toast(data.message, 'success')
    mergeFor.value = null
    themes.value = (await getThemes()).data
  } catch (e) { apiError(e) }
}

// ─── Calculateurs ────────────────────────────────────────
const calcForm = ref(null)      // éditeur ouvert (null = fermé)
const calcCheck = ref(null)     // résultat du test de formule { ok, value | error }
let calcCheckTimer = null

/** Un calculateur vierge, tout à saisir. */
function emptyCalculator() {
  return { id: null, name: '', formula: '', lineId: '', themeId: '', params: [], readings: [] }
}
/**
 * Un exemple pré-rempli, pour ne pas partir d'une formule blanche.
 *
 * C'est un point de départ à adapter, pas un module « électricité » codé en dur :
 * prix, TVA et abonnement sont des paramètres comme les autres, et la formule
 * s'édite librement.
 *
 * @returns {object} Le calculateur d'exemple.
 */
function exampleCalculator() {
  return {
    id: null,
    name: 'Électricité',
    formula: '(hp × prixHP + hc × prixHC) × (1 + tva / 100) + abo',
    lineId: '',
    themeId: '',
    params: [
      { symbol: 'prixHP', label: 'Prix heure pleine', value: 0.27, unit: '€/kWh' },
      { symbol: 'prixHC', label: 'Prix heure creuse', value: 0.20, unit: '€/kWh' },
      { symbol: 'abo', label: 'Abonnement', value: 12.5, unit: '€' },
      { symbol: 'tva', label: 'TVA', value: 20, unit: '%' },
    ],
    readings: [
      { symbol: 'hp', label: 'Heures pleines', kind: 'index', unit: 'kWh' },
      { symbol: 'hc', label: 'Heures creuses', kind: 'index', unit: 'kWh' },
    ],
  }
}
/**
 * Ouvre l'éditeur sur un calculateur existant, ou vierge.
 *
 * La copie profonde est nécessaire : l'éditeur modifie params et readings en place,
 * et sans elle la liste affichée derrière changerait avant tout enregistrement.
 *
 * @param {object|null} calc Le calculateur à éditer, null pour en créer un.
 */
function openCalculator(calc) {
  calcForm.value = calc ? JSON.parse(JSON.stringify({ ...calc, lineId: calc.lineId || '', themeId: calc.themeId || '' })) : emptyCalculator()
  calcCheck.value = null
  scheduleCheck()
}
/** Ouvre l'éditeur sur l'exemple pré-rempli. */
function openExample() {
  calcForm.value = exampleCalculator()
  calcCheck.value = null
  scheduleCheck()
}
function closeCalculator() { calcForm.value = null }

// Un paramètre est une constante (prix du kWh) ; un relevé est saisi chaque mois
const addParam = () => calcForm.value.params.push({ symbol: '', label: '', value: 0, unit: '' })
const addReading = () => calcForm.value.readings.push({ symbol: '', label: '', kind: 'index', unit: '' })

// Symboles utilisables dans la formule. Les relevés valent 1 pour le test : on vérifie
// que la formule se CALCULE, pas qu'elle donne le bon montant — il n'y a pas encore de relevé.
const calcSymbols = computed(() => {
  if (!calcForm.value) return []
  return [
    ...calcForm.value.params.map((p) => ({ symbol: p.symbol, value: p.value, kind: 'param' })),
    ...calcForm.value.readings.map((r) => ({ symbol: r.symbol, value: 1, kind: r.kind })),
  ].filter((s) => s.symbol)
})
/**
 * Insère un symbole à la fin de la formule, en un clic.
 *
 * Évite les fautes de frappe sur des noms comme `prixHC`, qui feraient échouer le
 * calcul sans que la cause saute aux yeux.
 *
 * @param {string} symbol Le symbole à insérer.
 */
function insertSymbol(symbol) {
  const f = calcForm.value
  f.formula = (f.formula || '').trimEnd() + (f.formula ? ' ' : '') + symbol + ' '
  scheduleCheck()
}
/**
 * Teste la formule auprès du serveur, 300 ms après la dernière frappe.
 *
 * Le délai évite d'envoyer une requête par caractère, et surtout de signaler une
 * erreur sur une formule qu'on est en train d'écrire.
 */
function scheduleCheck() {
  clearTimeout(calcCheckTimer)
  calcCheckTimer = setTimeout(async () => {
    if (!calcForm.value) return
    if (!calcForm.value.formula.trim()) { calcCheck.value = null; return }
    try {
      calcCheck.value = (await checkFormula(calcForm.value.formula, calcSymbols.value)).data
    } catch (e) { calcCheck.value = { ok: false, error: e.message } }
  }, 300)
}
/**
 * Enregistre le calculateur.
 *
 * Les paramètres et relevés sans symbole sont écartés : ce sont des lignes ajoutées
 * puis laissées vides, elles n'ont rien à faire dans la formule.
 */
async function saveCalculator() {
  const f = calcForm.value
  if (!f.name.trim()) return
  const data = {
    name: f.name,
    formula: f.formula,
    lineId: f.lineId || null,
    themeId: f.themeId || null,
    params: f.params.filter((p) => p.symbol.trim()).map((p) => ({ ...p, symbol: p.symbol.trim(), value: Number(p.value) || 0 })),
    readings: f.readings.filter((r) => r.symbol.trim()).map((r) => ({ ...r, symbol: r.symbol.trim() })),
  }
  try {
    if (f.id) await updateCalculator(f.id, data)
    else await createCalculator(data)
    calculators.value = (await getCalculators()).data
    calcForm.value = null
    flashSaved('calculators')
  } catch (e) { apiError(e) }
}
/**
 * Supprime un calculateur et ses relevés, après confirmation.
 *
 * Les régularisations déjà posées dans les mois restent : ce sont des montants
 * enregistrés, pas des projections du calculateur.
 *
 * @param {object} calc Le calculateur à supprimer.
 */
async function removeCalculatorConfirm(calc) {
  const ok = await confirmDialog({ title: 'Supprimer le calculateur', message: `« ${calc.name} » et tous ses relevés mensuels seront supprimés. Les régularisations déjà posées dans les mois restent.`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try {
    await deleteCalculator(calc.id)
    calculators.value = (await getCalculators()).data
    if (calcForm.value?.id === calc.id) calcForm.value = null
  } catch (e) { apiError(e) }
}
const templateLineLabel = (id) => templateLines.value.find((l) => l.id === id)?.label || null
</script>

<template>
  <div v-if="settings" @click="menuKey = null; colorPickerFor = null">
    <div class="sr-only" aria-live="polite">{{ ariaMsg }}</div>

    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="mb-6">
      <h1 class="text-[22px] font-semibold">Paramètres</h1>
      <p class="page-sub">Catégories, thèmes et réglages généraux</p>
    </div>

    <!-- ─── Général — §7 : le bloc fondamental passe en premier ── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Général</h2>
        <span v-if="savedIn === 'general'" class="saved-note">Enregistré</span>
      </div>
      <div class="gen-grid">
        <label class="field">
          <span>Devise</span>
          <span class="select-wrap">
            <select :value="settings.currency" class="select w-24" @change="saveGeneral({ currency: $event.target.value })">
              <option v-for="c in currencyOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </span>
        </label>
        <label class="field">
          <span>Thème</span>
          <span class="select-wrap">
            <select v-model="themePref" class="select w-32" title="« Système » suit le réglage clair/sombre de votre appareil" @change="changeTheme">
              <option v-for="o in THEME_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </span>
        </label>
        <div class="field">
          <span>Objectif d'épargne <span class="meta">(% du revenu du mois)</span></span>
          <button v-if="edit.key !== 'rate'" class="edit-text num" @click.stop="startEdit('rate', settings.savingRate)">{{ settings.savingRate }} %</button>
          <span v-else class="rate-edit">
            <input v-focus v-model="edit.val" type="text" inputmode="decimal" class="input w-16 num text-right" @click.stop @blur="commitRate" @keyup.enter="$event.target.blur()" @keydown.esc="cancelEdit" />
            <span class="rate-suffix">%</span>
          </span>
          <span v-if="savingsPhrase" class="meta text-[12px] num">{{ savingsPhrase }}</span>
        </div>
      </div>
      <div class="gen-block">
        <p class="gen-label">Moyens de paiement</p>
        <div class="chips">
          <span v-for="m in settings.paymentMethods" :key="m" class="tag tag-neutral">
            {{ m }}
            <button class="tag-x" :title="'Retirer ' + m" @click="removePaymentMethod(m)">×</button>
          </span>
          <input v-model="newPaymentMethod" type="text" class="input w-32" placeholder="Ajouter…" @keyup.enter="addPaymentMethod" />
        </div>
      </div>
      <div class="gen-block">
        <p class="gen-label">Types d'investissement</p>
        <div class="chips">
          <span v-for="t in settings.investmentTypes" :key="t" class="tag tag-neutral">
            {{ t }}
            <button class="tag-x" :title="'Retirer ' + t" @click="removeInvestmentType(t)">×</button>
          </span>
          <input v-model="newInvestmentType" type="text" class="input w-32" placeholder="Ajouter…" @keyup.enter="addInvestmentType" />
        </div>
      </div>
    </div>

    <!-- ─── Catégories — §4 ─────────────────────────── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Catégories <span class="panel-count num">{{ categories.length }}</span></h2>
        <span v-if="savedIn === 'categories'" class="saved-note">Enregistré</span>
      </div>
      <p class="panel-sub">Les blocs de votre mois. Leur type pilote les calculs.</p>

      <div v-if="!categories.length" class="empty-block">
        <p class="mb-3">Aucune catégorie pour l'instant.</p>
        <button class="btn-primary" @click="applyPresets">Partir d'un jeu de base</button>
        <p class="meta text-[11.5px] mt-2">Factures, Abonnements, Courses… — renommez ou supprimez ensuite.</p>
      </div>

      <div v-for="(category, i) in categories" :key="category.id"
        class="cat-grid cat-row" tabindex="0"
        :class="{ 'is-dragging': dragId === category.id }"
        :draggable="dragArmed === category.id"
        @dragstart="onDragStart(category)" @dragover.prevent="onDragOver(category)" @dragend="onDragEnd" @drop.prevent
        @keydown.alt.up.prevent="moveCategory(i, -1)" @keydown.alt.down.prevent="moveCategory(i, 1)">
        <span class="drag-handle" title="Glisser pour réordonner (ou Alt + ↑/↓)" @mousedown="dragArmed = category.id" @mouseup="dragArmed = null">⠿</span>
        <span class="swatch-wrap" @click.stop>
          <button class="swatch" :style="{ background: category.color }" :title="'Couleur de « ' + category.name + ' »'" @click="colorPickerFor = colorPickerFor === category.id ? null : category.id" />
          <div v-if="colorPickerFor === category.id" class="palette">
            <button v-for="p in CATEGORY_PALETTE" :key="p" class="swatch" :class="{ 'is-current': p === category.color }" :style="{ background: p }" @click="setCatColor(category, p)" />
          </div>
        </span>
        <span class="cell-name">
          <button v-if="edit.key !== 'cat' + category.id" class="edit-text" @click.stop="startEdit('cat' + category.id, category.name)">{{ category.name }}</button>
          <input v-else v-focus v-model="edit.val" type="text" class="input edit-input" @click.stop
            @blur="commitCatName(category)" @keyup.enter="$event.target.blur()" @keydown.esc="cancelEdit" />
        </span>
        <span class="select-wrap" @click.stop>
          <select v-model="category.type" class="select w-full" :title="'Leur type pilote les calculs — ' + TYPE_HINTS[category.type]" @change="setCatType(category)">
            <option v-for="t in CATEGORY_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </span>
        <span class="cell-usage" :class="{ 'is-warn': !catUsage(category) }" :title="category.templateLines + ' ligne(s) du template · ' + category.monthLines + ' ligne(s) de mois'">
          {{ catUsage(category) ? 'utilisée par ' + catUsage(category) + ' ligne' + (catUsage(category) > 1 ? 's' : '') : 'inutilisée' }}
        </span>
        <span class="cell-actions" @click.stop>
          <span class="menu-wrap">
            <button class="btn-icon" title="Actions" @click="menuKey = menuKey === 'cat' + category.id ? null : 'cat' + category.id">⋯</button>
            <div v-if="menuKey === 'cat' + category.id" class="menu">
              <button class="menu-item" :disabled="i === 0" @click="menuKey = null; moveCategory(i, -1)">Monter</button>
              <button class="menu-item" :disabled="i === categories.length - 1" @click="menuKey = null; moveCategory(i, 1)">Descendre</button>
              <div class="menu-sep" />
              <button class="menu-item is-danger" @click="menuKey = null; removeCategoryConfirm(category)">Supprimer</button>
            </div>
          </span>
        </span>
      </div>

      <!-- Ligne d'ajout : même grille que les autres -->
      <div class="cat-grid cat-add">
        <span></span>
        <span class="swatch-wrap" @click.stop>
          <button class="swatch" :style="{ background: newCategory.color || nextColor() }" title="Couleur" @click="colorPickerFor = colorPickerFor === 'new' ? null : 'new'" />
          <div v-if="colorPickerFor === 'new'" class="palette">
            <button v-for="p in CATEGORY_PALETTE" :key="p" class="swatch" :class="{ 'is-current': p === (newCategory.color || nextColor()) }" :style="{ background: p }" @click="newCategory.color = p; colorPickerFor = null" />
          </div>
        </span>
        <input v-model="newCategory.name" type="text" class="input" placeholder="Nouvelle catégorie" @keyup.enter="addCategory" />
        <span class="select-wrap">
          <select v-model="newCategory.type" class="select w-full" :title="TYPE_HINTS[newCategory.type]">
            <option v-for="t in CATEGORY_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </span>
        <span class="cell-usage"></span>
        <span class="cell-actions"><button class="btn-secondary" @click="addCategory">Ajouter</button></span>
      </div>
    </div>

    <!-- ─── Thèmes — §5 : grille compacte, recherche, plus de couleur ── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Thèmes <span class="panel-count num">{{ themes.length }}</span></h2>
        <div class="panel-tools">
          <span v-if="savedIn === 'themes'" class="saved-note">Enregistré</span>
          <span class="view-tabs">
            <button class="view-tab" :class="{ 'is-active': themeSort === 'alpha' }" @click="themeSort = 'alpha'">A–Z</button>
            <button class="view-tab" :class="{ 'is-active': themeSort === 'usage' }" title="Les moins utilisés d'abord, pour faire le ménage" @click="themeSort = 'usage'">par usage</button>
          </span>
          <input v-model="themeSearch" type="text" class="input w-44" placeholder="Rechercher un thème…" />
        </div>
      </div>
      <p class="panel-sub">Étiquettes d'analyse facultatives, modifiables sur chaque entrée.</p>

      <div v-if="themes.length" class="themes-grid">
        <div v-for="theme in sortedThemes" :key="theme.id" class="theme-item">
          <span class="cell-name">
            <button v-if="edit.key !== 'theme' + theme.id" class="edit-text" @click.stop="startEdit('theme' + theme.id, theme.name)">{{ theme.name }}</button>
            <input v-else v-focus v-model="edit.val" type="text" class="input edit-input" @click.stop
              @blur="commitThemeName(theme)" @keyup.enter="$event.target.blur()" @keydown.esc="cancelEdit" />
          </span>
          <span class="cell-usage" :class="{ 'is-warn': !themeUsage(theme) }" :title="(theme.lines || 0) + ' ligne(s) · ' + (theme.entries || 0) + ' entrée(s)' + ((theme.calculators || 0) ? ' · ' + theme.calculators + ' calculateur(s)' : '')">
            {{ themeUsage(theme) ? themeUsage(theme) : 'inutilisé' }}
          </span>
          <span class="cell-actions" @click.stop>
            <span class="menu-wrap">
              <button class="btn-icon" title="Actions" @click="menuKey = menuKey === 'theme' + theme.id ? null : 'theme' + theme.id">⋯</button>
              <div v-if="menuKey === 'theme' + theme.id" class="menu">
                <button v-if="themes.length > 1" class="menu-item" @click="menuKey = null; openMerge(theme)">Fusionner dans un autre thème…</button>
                <div v-if="themes.length > 1" class="menu-sep" />
                <button class="menu-item is-danger" @click="menuKey = null; removeThemeConfirm(theme)">Supprimer</button>
              </div>
            </span>
          </span>
        </div>
      </div>
      <p v-else class="empty-line">Aucun thème — l'app fonctionne aussi sans (le champ n'apparaîtra pas à la saisie).</p>

      <div class="theme-add">
        <input v-model="newTheme" type="text" class="input w-72" placeholder="Nouveau thème (IA, Restaurants…)" @keyup.enter="addTheme" />
        <button class="btn-secondary" @click="addTheme">Ajouter</button>
      </div>
    </div>

    <!-- ─── Fusion de thèmes ─────────────────────────── -->
    <AppModal :open="!!mergeFor" title="Fusionner deux thèmes" @close="mergeFor = null">
      <div v-if="mergeFor" class="flex flex-col gap-3 text-[13px]">
        <p>
          Toutes les lignes et entrées de « <b>{{ mergeFor.name }}</b> »
          ({{ mergeFor.lines || 0 }} ligne{{ (mergeFor.lines || 0) > 1 ? 's' : '' }}, {{ mergeFor.entries || 0 }} entrée{{ (mergeFor.entries || 0) > 1 ? 's' : '' }})
          passeront sur le thème choisi, puis « {{ mergeFor.name }} » sera supprimé.
        </p>
        <label class="field"><span>Fusionner dans</span>
          <span class="select-wrap">
            <select v-model="mergeTargetId" class="select w-56">
              <option value="">— choisir un thème</option>
              <option v-for="t in themes.filter((x) => x.id !== mergeFor.id)" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </span>
        </label>
      </div>
      <template #footer>
        <button class="btn-primary" :disabled="!mergeTargetId" @click="confirmMerge">Fusionner</button>
        <button class="btn-secondary" @click="mergeFor = null">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Calculateurs — §8 ───────────────────────── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Calculateurs <span class="panel-count num">{{ calculators.length }}</span></h2>
        <div class="panel-tools">
          <span v-if="savedIn === 'calculators'" class="saved-note">Enregistré</span>
          <span class="menu-wrap" @click.stop>
            <button class="btn-primary" @click="menuKey = menuKey === 'add-calc' ? null : 'add-calc'">Ajouter un calculateur</button>
            <div v-if="menuKey === 'add-calc'" class="menu">
              <button class="menu-item" @click="menuKey = null; openCalculator(null)">Créer un calculateur</button>
              <button class="menu-item" @click="menuKey = null; openExample()">Partir de l'exemple électricité HP/HC</button>
            </div>
          </span>
        </div>
      </div>
      <p class="panel-sub">Un calculateur estime une facture à partir de relevés saisis chaque mois.</p>

      <div v-for="calc in calculators" :key="calc.id" class="calc-row">
        <div class="calc-main">
          <span class="calc-name">{{ calc.name }}</span>
          <code class="calc-formula">{{ calc.formula || '—' }}</code>
          <span v-if="calc.lineId" class="meta text-[12px]">rattaché à {{ templateLineLabel(calc.lineId) || 'une ligne supprimée' }}</span>
          <span class="cell-actions" @click.stop>
            <span class="menu-wrap">
              <button class="btn-icon" title="Actions" @click="menuKey = menuKey === 'calc' + calc.id ? null : 'calc' + calc.id">⋯</button>
              <div v-if="menuKey === 'calc' + calc.id" class="menu">
                <button class="menu-item" @click="menuKey = null; openCalculator(calc)">Modifier</button>
                <div class="menu-sep" />
                <button class="menu-item is-danger" @click="menuKey = null; removeCalculatorConfirm(calc)">Supprimer</button>
              </div>
            </span>
          </span>
        </div>
        <p class="calc-meta meta">{{ (calc.params || []).length }} paramètre{{ (calc.params || []).length > 1 ? 's' : '' }} · {{ (calc.readings || []).length }} relevé{{ (calc.readings || []).length > 1 ? 's' : '' }} mensuel{{ (calc.readings || []).length > 1 ? 's' : '' }}</p>
      </div>
      <p v-if="!calculators.length && !calcForm" class="empty-line">Aucun calculateur.</p>

      <!-- Éditeur : c'est ici que vivent les détails (paramètres, relevés, formule) -->
      <div v-if="calcForm" class="calc-editor" @click.stop>
        <div class="flex flex-wrap gap-4 items-end">
          <label class="field"><span>Nom</span><input v-model="calcForm.name" type="text" class="input w-44" placeholder="Électricité, Eau, Essence…" /></label>
          <label class="field">
            <span>Ligne du template (mensualité)</span>
            <span class="select-wrap">
              <select v-model="calcForm.lineId" class="select w-48">
                <option value="">— aucune (estimation seule)</option>
                <option v-for="l in templateLines" :key="l.id" :value="l.id">{{ l.label }}</option>
              </select>
            </span>
          </label>
          <label v-if="themes.length" class="field">
            <span>Thème de la régularisation</span>
            <span class="select-wrap">
              <select v-model="calcForm.themeId" class="select w-44">
                <option value="">— celui de la ligne</option>
                <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
            </span>
          </label>
        </div>

        <div class="editor-cols">
          <div>
            <p class="editor-title">Paramètres <span class="meta">— constants d'un mois à l'autre</span></p>
            <div v-for="(p, i) in calcForm.params" :key="'p' + i" class="editor-row">
              <input v-model="p.symbol" type="text" class="input mono w-24" placeholder="symbole" @input="scheduleCheck" />
              <input v-model="p.label" type="text" class="input flex-1" placeholder="Libellé" />
              <input v-model="p.value" type="number" step="any" class="input w-20 num" @input="scheduleCheck" />
              <input v-model="p.unit" type="text" class="input w-16" placeholder="unité" />
              <button class="btn-icon is-danger" @click="calcForm.params.splice(i, 1); scheduleCheck()">×</button>
            </div>
            <button class="btn-discret" @click="addParam">+ paramètre</button>
          </div>
          <div>
            <p class="editor-title">Relevés <span class="meta">— saisis chaque mois</span></p>
            <div v-for="(r, i) in calcForm.readings" :key="'r' + i" class="editor-row">
              <input v-model="r.symbol" type="text" class="input mono w-24" placeholder="symbole" @input="scheduleCheck" />
              <input v-model="r.label" type="text" class="input flex-1" placeholder="Libellé" />
              <span class="select-wrap">
                <select v-model="r.kind" class="select w-24" title="index : la valeur du mois = index de fin − index de début (report automatique)">
                  <option value="index">index</option>
                  <option value="valeur">valeur</option>
                </select>
              </span>
              <input v-model="r.unit" type="text" class="input w-16" placeholder="unité" />
              <button class="btn-icon is-danger" @click="calcForm.readings.splice(i, 1); scheduleCheck()">×</button>
            </div>
            <button class="btn-discret" @click="addReading">+ relevé</button>
          </div>
        </div>

        <div>
          <p class="editor-title">Formule <span class="meta">— + − × ÷ et parenthèses sur les symboles ci-dessus</span></p>
          <div class="flex flex-wrap gap-1 mb-1.5">
            <button v-for="s in calcSymbols" :key="s.symbol" class="tag tag-neutral mono cursor-pointer" @click="insertSymbol(s.symbol)">{{ s.symbol }}</button>
          </div>
          <input v-model="calcForm.formula" type="text" class="input mono w-full" placeholder="(hp × prixHP + hc × prixHC) × (1 + tva / 100) + abo" @input="scheduleCheck" />
          <p v-if="calcCheck" class="text-[12px] mt-1" :class="calcCheck.ok ? 'is-credit' : 'is-over'">
            {{ calcCheck.ok ? '✓ Formule valide' + (calcCheck.value != null ? ' — avec les paramètres actuels et 1 par relevé : ' + calcCheck.value.toFixed(2) : '') : '✗ ' + calcCheck.error }}
          </p>
        </div>

        <div class="flex gap-2">
          <button class="btn-primary" @click="saveCalculator">{{ calcForm.id ? 'Sauver' : 'Créer' }}</button>
          <button class="btn-secondary" @click="closeCalculator">Annuler</button>
        </div>
      </div>
    </div>

    <!-- ─── Vos données — §9, en dernier : on ne tombe pas dessus par hasard ─── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Vos données</h2>
        <span v-if="dataStats" class="panel-count num">{{ dataTaille }}</span>
      </div>
      <p class="panel-sub">
        Tout tient dans un seul fichier, sur cet ordinateur. Le sauvegarder, c'est pouvoir
        le retrouver ailleurs — ou revenir en arrière.
      </p>

      <div class="data-rows">
        <div class="data-row">
          <div class="data-text">
            <p class="data-title">Sauvegarder</p>
            <p class="data-sub">Une copie complète, à ranger où vous voulez.</p>
          </div>
          <button class="btn-secondary btn-wait" :disabled="!!dataBusy" @click="sauvegarder">
            <AppSpinner v-if="dataBusy === 'export'" />
            {{ dataBusy === 'export' ? 'Préparation…' : 'Télécharger' }}
          </button>
        </div>

        <div class="data-row">
          <div class="data-text">
            <p class="data-title">Importer une sauvegarde</p>
            <p class="data-sub">Remplace tout par le contenu du fichier. L'état actuel est archivé avant.</p>
          </div>
          <input ref="fileInput" type="file" accept=".db,.sqlite,.sqlite3" class="sr-only" @change="importer" />
          <button class="btn-secondary btn-wait" :disabled="!!dataBusy" @click="fileInput?.click()">
            <AppSpinner v-if="dataBusy === 'import'" />
            {{ dataBusy === 'import' ? 'Import…' : 'Choisir un fichier' }}
          </button>
        </div>

        <div class="data-row is-danger-row">
          <div class="data-text">
            <p class="data-title">Effacer toutes les données</p>
            <p class="data-sub">
              <span v-if="dataResume" class="num">{{ dataResume }}. </span>
              L'application repart à neuf, comme au premier lancement.
            </p>
          </div>
          <button class="btn-danger is-solid" :disabled="!!dataBusy" @click="resetStep = 1">Effacer…</button>
        </div>
      </div>
    </div>

    <!-- Première confirmation : ce qui est en jeu, et la sauvegarde reproposée -->
    <AppModal :open="resetStep === 1" title="Effacer toutes vos données ?" @close="resetStep = 0">
      <p class="mb-3">Vont disparaître de l'application :</p>
      <ul class="data-list">
        <li v-for="l in dataStats?.lignes || []" :key="l.table"><b class="num">{{ l.count }}</b> {{ l.label }}</li>
      </ul>
      <p class="data-warn">
        Une archive est posée sur votre disque avant l'effacement — mais elle est sur cette
        machine. Si ces données comptent, téléchargez-en une copie maintenant.
      </p>
      <template #footer>
        <button class="btn-secondary btn-wait" :disabled="!!dataBusy" @click="sauvegarder">
          <AppSpinner v-if="dataBusy === 'export'" />
          {{ dataBusy === 'export' ? 'Préparation…' : 'Télécharger une sauvegarde' }}
        </button>
        <span class="flex-1"></span>
        <button class="btn-secondary" @click="resetStep = 0">Annuler</button>
        <button class="btn-danger is-solid" @click="resetStep = 2">Continuer</button>
      </template>
    </AppModal>

    <!-- Import et effacement remplacent toute la base : plus rien n'est cliquable
         tant que la page n'a pas été rechargée. -->
    <AppSpinner v-if="dataBusy === 'import' || dataBusy === 'reset'" overlay :size="30" :label="dataLabel" />

    <!-- Seconde confirmation : plus rien à expliquer, juste le poids du geste -->
    <AppModal :open="resetStep === 2" title="Cette action est définitive" @close="resetStep = 0">
      <p>
        Il n'y a pas de retour en arrière depuis l'application. Seule la sauvegarde que vous
        avez téléchargée, ou l'archive posée sur le disque, permettrait de retrouver ces données.
      </p>
      <template #footer>
        <span class="flex-1"></span>
        <button class="btn-secondary" @click="resetStep = 0">Annuler</button>
        <button class="btn-danger is-solid btn-wait" :disabled="dataBusy === 'reset'" @click="effacerTout">
          <AppSpinner v-if="dataBusy === 'reset'" />
          {{ dataBusy === 'reset' ? 'Effacement…' : 'Effacer définitivement' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* ─── Page ─── */
.set-panel { padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.is-warn { color: var(--c-warn); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ─── Vos données : une ligne par action, la dangereuse en dernier ─── */
.data-rows { display: flex; flex-direction: column; }
.data-row { display: flex; align-items: center; gap: var(--s-4); padding: var(--s-3) 0; border-top: 1px solid var(--c-line); }
.data-row:first-child { border-top: 0; padding-top: 0; }
.data-text { flex: 1; min-width: 0; }
.data-title { font-size: 14px; font-weight: 500; color: var(--c-ink); }
.data-sub { font-size: 13px; color: var(--c-ink-2); margin-top: 2px; }
.is-danger-row .data-title { color: var(--c-over); }
.data-list { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-5); font-size: 13px; color: var(--c-ink-2); }
.data-warn { font-size: 13px; color: var(--c-ink-2); margin-top: var(--s-4); }

.panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); flex-wrap: wrap; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--c-ink); }
.panel-count { font-size: 13px; font-weight: 400; color: var(--c-ink-3); margin-left: var(--s-2); }
.panel-sub { font-size: 13px; color: var(--c-ink-2); margin-top: 2px; margin-bottom: var(--s-3); }
.panel-tools { display: flex; align-items: center; gap: var(--s-4); }
.saved-note { font-size: 12px; color: var(--c-ink-3); }
.view-tabs { display: inline-flex; gap: var(--s-4); }

/* ─── Édition en place : du texte au repos, un champ au clic ─── */
.edit-text {
  font-size: 14px; font-weight: 500; color: var(--c-ink);
  padding: 2px var(--s-2); margin-left: calc(-1 * var(--s-2));
  border: 1px solid transparent; border-radius: var(--r-control);
  cursor: text; text-align: left; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.edit-text:hover { border-color: var(--c-line-strong); background: var(--c-surface); }
.edit-input { width: 100%; }

/* ─── Général ─── */
.gen-grid { display: flex; gap: var(--s-8); flex-wrap: wrap; margin-bottom: var(--s-4); }
.gen-block { margin-bottom: var(--s-4); }
.gen-block:last-child { margin-bottom: 0; }
.gen-label { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); margin-bottom: var(--s-2); }
.chips { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.rate-edit { display: inline-flex; align-items: center; gap: var(--s-2); }
.rate-suffix { font-size: 13px; color: var(--c-ink-2); }

/* ─── Catégories ─── */
.cat-grid {
  display: grid;
  grid-template-columns: 24px 24px minmax(0, 1fr) 128px 160px 40px;
  align-items: center;
  gap: var(--s-3);
  min-height: var(--h-row);
}
.cat-row { border-bottom: 1px solid var(--c-line); transition: background-color var(--dur-fast) var(--ease); outline: none; }
.cat-row:hover { background: var(--c-surface-hover); }
.cat-row:focus-visible { box-shadow: inset 0 0 0 2px var(--c-accent-ring); }
.cat-row.is-dragging { opacity: 0.5; }
.drag-handle { color: var(--c-ink-3); cursor: grab; text-align: center; user-select: none; font-size: 14px; }
.drag-handle:active { cursor: grabbing; }
.cell-name { min-width: 0; display: flex; }
.cell-usage { font-size: 13px; color: var(--c-ink-3); text-align: right; white-space: nowrap; }
.cell-usage.is-warn { color: var(--c-warn); }
.cell-actions { display: flex; justify-content: flex-end; }
.cat-add { border-top: 1px solid var(--c-line-strong); padding-top: var(--s-2); margin-top: -1px; }

/* Palette fermée : 12 pastilles, l'élue porte l'anneau accent */
.swatch-wrap { position: relative; display: flex; justify-content: center; }
.swatch { width: 20px; height: 20px; border-radius: var(--r-control); cursor: pointer; flex-shrink: 0; }
.swatch.is-current { box-shadow: 0 0 0 2px var(--c-surface), 0 0 0 4px var(--c-accent); }
.palette {
  position: absolute; left: 0; top: calc(100% + 6px); z-index: 40;
  display: grid; grid-template-columns: repeat(4, 20px); gap: var(--s-2);
  background: var(--c-surface); border: 1px solid var(--c-line);
  border-radius: var(--r-container); box-shadow: var(--shadow-overlay);
  padding: var(--s-3);
}

/* ─── Thèmes ─── */
.themes-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: var(--s-7); }
.theme-item { display: flex; align-items: center; gap: var(--s-2); min-height: 36px; border-bottom: 1px solid var(--c-line); }
.theme-item .cell-name { flex: 1; }
.theme-item .cell-usage { margin-left: auto; font-size: var(--t-small); }
.theme-item .edit-text { font-size: 13px; }
.theme-add { display: flex; gap: var(--s-2); margin-top: var(--s-3); }

/* ─── Calculateurs ─── */
.calc-row { padding: var(--s-2) 0; border-bottom: 1px solid var(--c-line); }
.calc-row:last-of-type { border-bottom: none; }
.calc-main { display: flex; align-items: center; gap: var(--s-3); min-height: 32px; }
.calc-name { font-size: 14px; font-weight: 500; color: var(--c-ink); flex-shrink: 0; }
/* Seul endroit de l'app où la chasse fixe est justifiée : c'est du code */
.calc-formula {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 12px; color: var(--c-ink-2);
  background: var(--c-surface-sunken); border-radius: var(--r-control);
  padding: 2px var(--s-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.calc-main .cell-actions { margin-left: auto; }
.calc-meta { font-size: 12px; margin-top: 2px; }
.calc-editor { margin-top: var(--s-3); border-top: 1px solid var(--c-line); padding-top: var(--s-4); display: flex; flex-direction: column; gap: var(--s-5); }
.editor-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-6); }
.editor-title { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); margin-bottom: var(--s-2); }
.editor-row { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-2); }
.mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; }

/* ─── Menus ⋯ ─── */
.menu { min-width: 230px; }
.menu-item:disabled { color: var(--c-ink-disabled); cursor: default; }
.menu-item:disabled:hover { background: none; }

/* ─── Tags, boutons, champs ─── */
.tag-x { font-size: 12px; color: var(--c-ink-3); cursor: pointer; margin-left: 2px; }
.tag-x:hover { color: var(--c-over); }

/* Un bouton qui peut porter une roue : le texte et la roue s'alignent */
.input:focus-visible, .input:focus { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }

/* Select restylé : chevron dessiné, jamais l'apparence native */
.select-wrap { position: relative; display: inline-flex; }
.select {
  appearance: none; -webkit-appearance: none;
  height: 32px; padding: 0 26px 0 var(--s-3);
  border: 1px solid var(--c-line-strong); border-radius: var(--r-control);
  font-size: 13px; color: var(--c-ink); background: var(--c-surface);
  outline: none; cursor: pointer; font-family: var(--font-ui);
}
.select:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.select-wrap::after {
  content: ''; position: absolute; right: 10px; top: 50%; margin-top: -2px;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid var(--c-ink-3);
  pointer-events: none;
}

.empty-block { text-align: center; padding: var(--s-6) 0; font-size: 13px; color: var(--c-ink-2); }
.empty-line { font-size: 13px; color: var(--c-ink-3); padding: var(--s-2) 0; }

button:focus-visible, select:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); border-radius: var(--r-control); }

/* ─── Responsive ─── */
@media (max-width: 1119px) {
  .themes-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 979px) {
  .cat-grid { grid-template-columns: 24px 24px minmax(0, 1fr) 128px 40px; }
  .cat-grid > .cell-usage { display: none; }
  .editor-cols { grid-template-columns: 1fr; }
}
@media (max-width: 719px) {
  .themes-grid { grid-template-columns: 1fr; }
}
</style>
