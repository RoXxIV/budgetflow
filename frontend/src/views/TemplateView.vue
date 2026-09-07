<script setup>
import { ref, computed, onMounted } from 'vue'
import { getTemplateLines, createTemplateLine, updateTemplateLine, reorderTemplateLines, deleteTemplateLine, applyTemplateLineToMonth, monthlyizeTemplateLine } from '@/api/template.js'
import { getCurrentMonth } from '@/api/months.js'
import { getCategories } from '@/api/categories.js'
import { getThemes } from '@/api/themes.js'
import { getAccounts } from '@/api/accounts.js'
import { getSettings } from '@/api/settings.js'
import { getEnvelopes, updateEnvelope } from '@/api/envelopes.js'
import AppModal from '@/components/AppModal.vue'
import HelpTip from '@/components/HelpTip.vue'
import { confirmDialog, apiError, toast } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

// ─── Data ────────────────────────────────────────────────
const lines = ref([])
const categories = ref([])
const themes = ref([])
const accounts = ref([])
const settings = ref(null)

const currentMonth = ref(null)   // mois ouvert du calendrier (cible de la propagation), ou null
const envelopes = ref([])        // pour afficher / changer le compte hôte d'une ligne mensualisée

/** Recharge tout l'écran en un seul aller-retour groupé. */
async function load() {
  const [lRes, cRes, tRes, aRes, sRes, mRes, eRes] = await Promise.all([
    getTemplateLines(), getCategories(), getThemes(), getAccounts(), getSettings(), getCurrentMonth(), getEnvelopes(),
  ])
  lines.value = lRes.data
  categories.value = cRes.data
  themes.value = tRes.data
  accounts.value = aRes.data
  settings.value = sRes.data
  currentMonth.value = mRes.data
  envelopes.value = eRes.data
}
const envelopeById = (id) => envelopes.value.find((e) => e.id === id) || null
onMounted(async () => { try { await load() } catch (e) { apiError(e) } })

/**
 * Copie une ligne du budget type dans le mois en cours.
 *
 * Un mois ne se remplit du budget type qu'à sa naissance : une ligne ajoutée après
 * coup n'apparaîtrait qu'au mois suivant. Cette propagation comble ce décalage, sans
 * jamais toucher au réel déjà saisi.
 *
 * @param {object} line La ligne du budget type à propager.
 * @param {object} [options]
 * @param {boolean} [options.ask] false pour enchaîner sans reposer la question
 *   (l'appelant vient déjà de la poser).
 */
async function applyToCurrentMonth(line, { ask = true } = {}) {
  if (!currentMonth.value) return
  if (ask) {
    const ok = await confirmDialog({ title: `Appliquer à ${currentMonth.value.name}`, message: `La ligne « ${line.label} » sera copiée dans ${currentMonth.value.name} (ou sa copie mise à jour). Le réel du mois n'est pas touché.`, confirmLabel: 'Appliquer' })
    if (!ok) return
  }
  try {
    await applyTemplateLineToMonth(line.id, currentMonth.value.id)
    toast(`« ${line.label} » appliquée à ${currentMonth.value.name}`, 'success')
  } catch (e) { apiError(e) }
}

// ─── Helpers ─────────────────────────────────────────────
const fmt = eur
const themeById = (id) => themes.value.find((t) => t.id === id) || null
const activeAccounts = computed(() => accounts.value.filter((a) => a.isActive)) // saisies : comptes actifs seulement

/**
 * Désature une couleur de catégorie vers son gris, à 65 %.
 *
 * Les pastilles servent à reconnaître une catégorie, pas à crier : on mélange la
 * couleur d'origine avec sa propre luminance (formule de perception 0,299/0,587/0,114,
 * qui pondère le vert plus que le bleu, comme l'œil). Une valeur illisible retombe sur
 * l'encre neutre plutôt que de casser l'affichage.
 *
 * @param {string} hex La couleur de la catégorie, au format #rrggbb.
 * @returns {string} La couleur désaturée en rgb(), ou un token neutre.
 */
function desat(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 'var(--c-ink-3)'
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  const mix = (c) => Math.round(c * 0.65 + gray * 0.35)
  return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')'
}

// Cagnottes du template : les ½ n'existent que s'il y en a au moins une
const pots = computed(() => lines.value.filter((l) => l.isPot))
const sharingOn = computed(() => pots.value.length > 0)

// ─── Cagnotte : prévu théorique, même formule que le mois (pot.service) ───
// payé par moi = Σ prévus des lignes ½ ; total = + part du partenaire ; à envoyer = ma part − payé par moi.
// Compté dans les totaux pour que le template et le mois affichent le même chiffre.
/**
 * Calcule où en est une cagnotte : ce que chacun a payé, et ce qu'il reste à envoyer.
 *
 * Même formule que le backend (pot.service), pour que le budget type et le mois
 * affichent le même chiffre. Le raisonnement : on somme ce que J'AI déjà payé sur mes
 * lignes ½, on y ajoute ce que le partenaire a payé pour obtenir le total commun, on
 * en prend ma part (50 % par défaut), et l'écart avec ce que j'ai déjà sorti est ce
 * que je dois encore envoyer — négatif si j'ai trop payé.
 *
 * @param {object} pot La ligne de cagnotte.
 * @returns {{sharedByMe: number, partnerPaid: number, total: number, myShare: number,
 *   myPart: number, partnerName: string, toSend: number}}
 */
const potCalc = (pot) => {
  const defaultPotId = pots.value[0]?.id ?? null
  const sharedByMe = lines.value.reduce((s, l) => {
    if (!l.isShared || l.isPot) return s
    return (l.potLineId || defaultPotId) === pot.id ? s + (l.plannedAmount || 0) : s
  }, 0)
  const partnerPaid = pot.potPartnerPaid || 0
  const total = sharedByMe + partnerPaid
  const myShare = pot.potMyShare ?? 50
  const myPart = (total * myShare) / 100
  return {
    sharedByMe, partnerPaid, total, myShare, myPart,
    partnerName: pot.potPartnerName || 'partenaire',
    toSend: Math.round((myPart - sharedByMe) * 100) / 100,
  }
}
// Les totaux raisonnent en mois-type : une ligne non mensuelle compte pour sa part
// mensuelle (monthlyAmount, calculé par le backend), pas pour son montant prélevé.
/**
 * Ce qu'une ligne pèse dans un mois-type.
 *
 * Trois cas : une cagnotte compte pour ce qu'il reste à envoyer ; une ligne non
 * mensuelle compte pour sa part mensuelle (`monthlyAmount`, calculé côté serveur) et
 * non pour son montant prélevé ; une ligne mensuelle compte pour son montant.
 *
 * C'est ce qui empêche un abonnement annuel de 79,99 € de gonfler le total d'un mois
 * de 79,99 € au lieu de 6,67 €.
 *
 * @param {object} l La ligne.
 * @returns {number} Son poids mensuel, en euros.
 */
const lineAmount = (l) => (l.isPot ? potCalc(l).toSend : (l.monthlyAmount ?? l.plannedAmount ?? 0))
const potTip = (l) => {
  const p = potCalc(l)
  return `Calculé — cagnotte : ${fmt(p.total)} en commun (dont ${fmt(p.partnerPaid)} payés par ${p.partnerName}), ma part ${p.myShare} % = ${fmt(p.myPart)}, moins ${fmt(p.sharedByMe)} déjà sur mes lignes ½ → ${fmt(p.toSend)} à envoyer.`
}

// Part lissée d'un groupe : ce que les lignes non mensuelles y pèsent chaque mois.
// Sans ça le total ne colle pas avec la somme des montants affichés, qui sont les
// montants réellement prélevés (79,99 € une fois par an, pas 6,67 € par mois).
/**
 * Repère les lignes non mensuelles d'un groupe et ce qu'elles y pèsent.
 *
 * Nécessaire parce que la colonne affiche les montants RÉELLEMENT prélevés (79,99 €
 * une fois par an) alors que le total raisonne en mois-type (6,67 €) : sans cette
 * mention, le total ne collerait pas avec la somme des lignes visibles, et se lirait
 * comme une erreur.
 *
 * @param {Array<object>} grpLines Les lignes du groupe.
 * @returns {{count: number, monthly: number, charged: number, lines: Array}|null}
 *   null si le groupe n'a que des lignes mensuelles.
 */
const smoothedInfo = (grpLines) => {
  const cycliques = grpLines.filter((l) => (l.intervalMonths || 1) > 1)
  if (!cycliques.length) return null
  return {
    count: cycliques.length,
    monthly: cycliques.reduce((s, l) => s + lineAmount(l), 0),
    charged: cycliques.reduce((s, l) => s + (l.plannedAmount || 0), 0),
    lines: cycliques,
  }
}
const smoothedTip = (info) => {
  const pluriel = info.count > 1 ? 's' : ''
  const detail = info.lines.map((l) => `${l.label} ${fmt(l.plannedAmount)} ${periodLabel(l)} → ${fmt(lineAmount(l))}/mois`).join(' · ')
  return `${info.count} ligne${pluriel} non mensuelle${pluriel} (${fmt(info.charged)} prélevés par cycle) compte${info.count > 1 ? 'nt' : ''} ici pour ${fmt(info.monthly)} par mois : ${detail}`
}

// ─── Lignes groupées par catégorie ───────────────────────
const NO_CATEGORY = { id: null, name: 'Sans catégorie', type: 'depense', color: '#9ca3af' }
const TYPE_ORDER = { revenu: 0, depense: 1, epargne: 2, transfert: 3 }
const TYPE_LABELS = { depense: 'dépenses', revenu: 'revenus', epargne: 'épargne', transfert: 'transferts' }

// Ordre de lecture d'un budget (brief §4) : revenus, puis dépenses par total décroissant, transferts en dernier
/**
 * Range les lignes par catégorie, dans l'ordre de lecture d'un budget.
 *
 * Revenus d'abord, puis dépenses de la plus lourde à la plus légère, épargne, et
 * transferts en dernier. Les lignes orphelines — sans catégorie, ou pointant sur une
 * catégorie supprimée — sont regroupées à part plutôt que perdues.
 *
 * @returns {Array<{category: object, lines: Array, total: number, smoothed: object|null}>}
 */
const groups = computed(() => {
  const result = categories.value.map((c) => ({
    category: c,
    lines: lines.value.filter((l) => l.categoryId === c.id),
  }))
  const orphans = lines.value.filter((l) => !l.categoryId || !categories.value.some((c) => c.id === l.categoryId))
  if (orphans.length) result.push({ category: NO_CATEGORY, lines: orphans })
  return result
    .map((g) => ({ ...g, total: g.lines.reduce((s, l) => s + lineAmount(l), 0), smoothed: smoothedInfo(g.lines) }))
    .sort((a, b) => ((TYPE_ORDER[a.category.type] ?? 9) - (TYPE_ORDER[b.category.type] ?? 9))
      || (a.category.type === 'depense' ? b.total - a.total : 0))
})

/**
 * Les totaux prévisionnels du mois-type, par nature.
 *
 * C'est le TYPE DE LA CATÉGORIE qui décide, pas la ligne : additionner un salaire et
 * un loyer ne voudrait rien dire. Le reste est ce qui subsiste des revenus une fois
 * les dépenses, l'épargne et les transferts prélevés.
 *
 * @returns {{depense: number, revenu: number, epargne: number, transfert: number,
 *   counts: object, reste: number}}
 */
const totals = computed(() => {
  const byType = { depense: 0, revenu: 0, epargne: 0, transfert: 0 }
  const counts = { depense: 0, revenu: 0, epargne: 0, transfert: 0 }
  groups.value.forEach((g) => { byType[g.category.type] += g.total; counts[g.category.type] += g.lines.length })
  return {
    ...byType, counts,
    reste: byType.revenu - byType.depense - byType.epargne - byType.transfert,
  }
})

/**
 * Barre de composition : à quoi passent les revenus du mois-type.
 *
 * Rapportée aux revenus, jamais au total des dépenses : la question est « quelle part
 * de ce que je gagne part où ? ». Sans revenus, elle n'a pas de sens et n'est pas
 * affichée. Les segments sont des nuances d'une même encre — leur taille porte
 * l'information, pas leur couleur.
 *
 * @returns {{segs: Array<{key: string, label: string, pct: number, opacity: number}>,
 *   restePct: number}|null}
 */
const compo = computed(() => {
  const t = totals.value
  if (!(t.revenu > 0)) return null
  const pct = (v) => Math.max(0, (v / t.revenu) * 100)
  const segs = [
    { key: 'depense', label: 'Dépenses', pct: pct(t.depense), opacity: 1 },
    { key: 'epargne', label: 'Épargne', pct: pct(t.epargne), opacity: 0.65 },
    { key: 'transfert', label: 'Transferts', pct: pct(t.transfert), opacity: 0.4 },
  ].filter((s) => s.pct > 0)
  return { segs, restePct: (t.reste / t.revenu) * 100 }
})

/**
 * Écrit la périodicité d'une ligne (« mensuel », « annuel, lissé »).
 *
 * @param {object} l La ligne.
 * @returns {string} Sa périodicité en clair.
 */
const periodLabel = (l) => {
  const n = l.intervalMonths || 1
  const base = n === 1 ? 'mensuel' : n === 3 ? 'trimestriel' : n === 6 ? 'semestriel' : n === 12 ? 'annuel' : `tous les ${n} mois`
  return l.envelopeId ? base + ', lissé' : base
}
/**
 * Infobulle d'une ligne non mensuelle : le montant prélevé, sa part mensuelle, et où
 * en est la mise de côté.
 *
 * C'est là que se règle la confusion possible entre les deux montants — celui de la
 * colonne (ce qui est prélevé) et celui du total (ce que ça coûte par mois).
 *
 * @param {object} l La ligne.
 * @returns {string} L'explication, vide pour une ligne mensuelle.
 */
const periodTip = (l) => {
  const n = l.intervalMonths || 1
  if (n <= 1) return ''
  let tip = `${fmt(l.plannedAmount)} ${n === 12 ? 'par an' : 'tous les ' + n + ' mois'}, soit ${fmt((l.plannedAmount || 0) / n)} par mois`
  if (l.envelopeId) {
    const env = envelopeById(l.envelopeId)
    if (env) tip += ` — l'enveloppe « ${env.name} » met de côté (${fmt(env.total)} / ${fmt(env.targetAmount)})`
  }
  if (l.nextDue) tip += ` · prochaine échéance ${fmtDue(l.nextDue)}`
  return tip
}
const fmtDue = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const fmtDueShort = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '')
// Un seul format par nature : « le 10 » pour le mensuel, « 1 juil. » pour le cyclique (l'année en infobulle)
const dueLabel = (l) => ((l.intervalMonths || 1) > 1 ? (l.nextDue ? fmtDueShort(l.nextDue) : '—') : (l.recurringDay ? 'le ' + l.recurringDay : '—'))
const dueTip = (l) => ((l.intervalMonths || 1) > 1 && l.nextDue ? 'Prochaine échéance ' + fmtDue(l.nextDue) : (l.recurringDay ? 'Jour du prélèvement : date par défaut du ☐ payé' : ''))
const shareTip = (l) => {
  const p = pots.value.find((x) => x.id === l.potLineId) || pots.value[0]
  return p ? `Dépense partagée (cagnotte « ${p.label} »${p.potPartnerName ? ' avec ' + p.potPartnerName : ''}), ${p.potMyShare ?? 50} % à ma charge.` : 'Dépense partagée.'
}

// ─── Vue par catégorie / par échéance (brief §8) ─────────
const viewMode = ref('categorie')
/**
 * Range les lignes par jour du mois, pour la vue « par échéance ».
 *
 * Le jour ne se lit pas au même endroit selon la ligne : `recurringDay` pour une
 * mensuelle, le jour de la prochaine échéance pour une cyclique. Les lignes sans date
 * sont regroupées en fin de liste plutôt qu'écartées.
 *
 * @returns {Array<{day: number|null, lines: Array, total: number, smoothed: object|null}>}
 */
const dayGroups = computed(() => {
  const map = new Map()
  for (const l of lines.value) {
    const n = l.intervalMonths || 1
    const day = n > 1 ? (l.nextDue ? Number(l.nextDue.slice(8, 10)) : null) : (l.recurringDay || null)
    const key = day ?? 'none'
    if (!map.has(key)) map.set(key, { day, lines: [] })
    map.get(key).lines.push(l)
  }
  return [...map.values()]
    .sort((a, b) => (a.day ?? 99) - (b.day ?? 99))
    .map((g) => ({ ...g, total: g.lines.reduce((s, l) => s + lineAmount(l), 0), smoothed: smoothedInfo(g.lines) }))
})
const displayGroups = computed(() => (viewMode.value === 'categorie'
  ? groups.value.map((g) => ({
      key: 'c' + (g.category.id ?? 'none'), title: g.category.name, dot: g.category.color,
      typeLabel: TYPE_LABELS[g.category.type], count: g.lines.length, total: g.total, smoothed: g.smoothed, lines: g.lines, orig: g,
    }))
  : dayGroups.value.map((g) => ({
      key: 'd' + (g.day ?? 'none'), title: g.day ? 'Le ' + g.day : 'Sans date', dot: null,
      typeLabel: '', count: g.lines.length, total: g.total, smoothed: g.smoothed, lines: g.lines, orig: null,
    }))))

// ─── Édition du montant en place ─────────────────────────

/**
 * Prépare la cellule de montant pour la saisie, au focus.
 *
 * La cellule affiche « 1 234,50 € » ; on la remplace par la valeur brute et on la
 * présélectionne, pour taper par-dessus sans effacer à la main.
 *
 * @param {object} line La ligne éditée.
 * @param {FocusEvent} e L'événement de focus.
 */
function startAmountEdit(line, e) {
  e.target.value = String(line.plannedAmount ?? 0).replace('.', ',')
  e.target.select()
}

/**
 * Enregistre le montant saisi, à la sortie du champ.
 *
 * Saisie tolérante : espaces (fines comprises), virgule décimale et € sont acceptés.
 * Une valeur invalide ou inchangée n'appelle pas le serveur, et le champ est réaffiché
 * à sa valeur d'avant — y compris en cas d'échec réseau, pour qu'il ne montre jamais
 * autre chose que ce qui est réellement enregistré.
 *
 * @param {object} line La ligne éditée.
 * @param {FocusEvent} e L'événement de sortie de champ.
 */
async function commitAmount(line, e) {
  const raw = e.target.value.replace(/[\s  €]/g, '').replace(',', '.')
  const v = parseFloat(raw)
  if (!isFinite(v) || v === line.plannedAmount) { e.target.value = fmt(line.plannedAmount); return }
  try {
    await updateTemplateLine(line.id, { plannedAmount: v })
    lines.value = (await getTemplateLines()).data
  } catch (err) {
    apiError(err)
    e.target.value = fmt(line.plannedAmount)
  }
}

// ─── Menu ⋯ par ligne ────────────────────────────────────
const menuLineId = ref(null)

// ─── Édition (modal par ligne) ───────────────────────────
const openLineId = ref(null)   // id de ligne existante en édition, ou 'new-<catId>' pour un ajout
const form = ref({})

/**
 * Valeurs de départ du formulaire d'une nouvelle ligne.
 *
 * Le compte « Depuis » est pré-rempli au compte principal, sauf pour un revenu : un
 * salaire ne part d'aucun de mes comptes, il y arrive.
 *
 * @param {object} category La catégorie dans laquelle la ligne est créée.
 * @returns {object} Le formulaire vierge.
 */
function defaultForm(category) {
  return {
    label: '',
    plannedAmount: '',
    categoryId: category.id,
    themeId: '',
    fromAccountId: category.type === 'revenu' ? '' : (accounts.value.find((a) => a.isMain)?.id || ''),
    toAccountId: '',
    paymentMethod: settings.value?.paymentMethods?.[0] || '',
    isShared: false,
    recurringDay: '',
    notes: '',
    potLineId: pots.value[0]?.id || '',
    isPot: false,
    potPartnerName: '',
    potPartnerPaid: '',
    potMyShare: 50,
    intervalMonths: 1,       // périodicité : tous les N mois
    anchorMonth: '',         // mois d'ancrage (si N > 1)
    monthlyize: false,       // mensualiser : enveloppe liée qui lisse la charge
    monthlyizeAccountId: '', // où l'argent attend (vide = compte principal, enveloppe virtuelle)
  }
}

const INTERVALS = [
  { value: 1, label: 'Chaque mois' },
  { value: 2, label: 'Tous les 2 mois' },
  { value: 3, label: 'Tous les 3 mois' },
  { value: 6, label: 'Tous les 6 mois' },
  { value: 12, label: 'Une fois par an' },
]
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// Modal de ligne (ajout et édition) — même composant que dans le Mois
const modalLine = ref(null)       // ligne en édition (null = ajout)
const modalCategory = ref(null)   // catégorie du « + ligne »
const modalOpen = computed(() => openLineId.value !== null)
const modalAdding = computed(() => typeof openLineId.value === 'string')
// Mensualisée : la mise de côté et le remboursement du jour J passent par l'enveloppe
// (virement système automatique) — « Vers » n'a pas de sens, le paiement va à l'extérieur
const isMonthlyized = computed(() => Number(form.value.intervalMonths) > 1 && form.value.monthlyize)
// « Vers » : catégorie à destination, virement (provision vers un de mes comptes / extérieur), ou ligne qui en a déjà un
const showVers = computed(() =>
  !isMonthlyized.value
  && (formCategoryType.value !== 'depense' || /virement/i.test(form.value.paymentMethod || '') || !!form.value.toAccountId)
)
// « Vers » ne propose jamais le compte « Depuis » (un virement vers soi-même n'a pas de sens)
const versAccounts = computed(() => activeAccounts.value.filter((a) => a.id !== form.value.fromAccountId))

/**
 * Ouvre le formulaire d'ajout dans une catégorie donnée.
 *
 * L'identifiant `new-<catId>` est une chaîne là où une édition porte un nombre :
 * c'est ce qui distingue l'ajout de la modification au moment d'enregistrer.
 *
 * @param {object} category La catégorie d'accueil.
 */
function openAdd(category) {
  openLineId.value = `new-${category.id}`
  modalLine.value = null
  modalCategory.value = category
  form.value = defaultForm(category)
}

/** Bouton d'ajout général : ouvre le formulaire sur la première catégorie venue. */
function openAddGlobal() {
  if (categories.value.length) openAdd(categories.value[0])
}

/**
 * Ouvre le formulaire pré-rempli sur une ligne existante.
 *
 * Les champs vides deviennent '' plutôt que null, qu'un <select> afficherait
 * littéralement. La case « mensualiser » se déduit de l'existence d'une enveloppe liée.
 *
 * @param {object} line La ligne à modifier.
 */
function openEdit(line) {
  openLineId.value = line.id
  modalLine.value = line
  modalCategory.value = categories.value.find((c) => c.id === line.categoryId) || null
  form.value = {
    label: line.label,
    plannedAmount: line.plannedAmount ?? '',
    categoryId: line.categoryId,
    themeId: line.themeId || '',
    fromAccountId: line.fromAccountId || '',
    toAccountId: line.toAccountId || '',
    paymentMethod: line.paymentMethod || '',
    isShared: line.isShared,
    recurringDay: line.recurringDay || '',
    notes: line.notes || '',
    potLineId: line.potLineId || pots.value[0]?.id || '',
    isPot: line.isPot,
    potPartnerName: line.potPartnerName || '',
    potPartnerPaid: line.potPartnerPaid ?? '',
    potMyShare: line.potMyShare ?? 50,
    intervalMonths: line.intervalMonths || 1,
    anchorMonth: line.anchorMonth || '',
    monthlyize: !!line.envelopeId,
    monthlyizeAccountId: envelopeById(line.envelopeId)?.accountId || '',
  }
}

function closePanel() {
  openLineId.value = null
  modalLine.value = null
}

/**
 * Traduit le formulaire en charge utile pour l'API.
 *
 * Le chemin inverse d'openEdit : les '' redeviennent null ou 0. Deux règles y sont
 * appliquées au passage — une ligne mensualisée n'a pas de compte « Vers » (le
 * paiement part vers l'extérieur, l'enveloppe ne fait qu'attendre), et les champs de
 * cagnotte ou de partage sont remis à zéro dès que la case correspondante est décochée,
 * pour ne pas laisser traîner des valeurs orphelines.
 *
 * @returns {object} Le corps de la requête.
 */
function formData() {
  const f = form.value
  return {
    label: f.label,
    plannedAmount: f.plannedAmount === '' ? 0 : parseFloat(f.plannedAmount),
    categoryId: f.categoryId || null,
    themeId: f.themeId || null,
    fromAccountId: f.fromAccountId || null,
    toAccountId: Number(f.intervalMonths) > 1 && f.monthlyize ? null : (f.toAccountId || null),
    paymentMethod: f.paymentMethod || null,
    isShared: f.isShared,
    recurringDay: f.recurringDay === '' ? null : Number(f.recurringDay),
    notes: f.notes || null,
    potLineId: f.isShared ? (f.potLineId || null) : null,
    isPot: !!f.isPot,
    potPartnerName: f.isPot ? (f.potPartnerName || null) : null,
    potPartnerPaid: f.isPot && f.potPartnerPaid !== '' ? parseFloat(f.potPartnerPaid) : 0,
    potMyShare: f.isPot ? (Number(f.potMyShare) || 50) : 50,
    intervalMonths: Number(f.intervalMonths) || 1,
    anchorMonth: Number(f.intervalMonths) > 1 ? (Number(f.anchorMonth) || null) : null,
  }
}

/**
 * Enregistre la ligne, puis règle tout ce qui en découle.
 *
 * Trois choses s'enchaînent après la sauvegarde :
 *  1. une ligne mensuelle qui vient d'être créée peut être ajoutée au mois en cours,
 *     sans quoi elle n'apparaîtrait qu'au mois suivant ;
 *  2. cocher ou décocher « mensualiser » crée ou délie l'enveloppe qui lisse la charge ;
 *  3. changer le compte hôte d'une enveloppe qui contient déjà de l'argent déclenche un
 *     virement système — l'argent doit physiquement suivre, et ça se confirme.
 */
async function submit() {
  if (!form.value.label.trim()) return
  const f = form.value
  if (Number(f.intervalMonths) > 1 && !f.anchorMonth) { toast("Indiquez le mois d'ancrage pour une ligne non mensuelle.", 'error'); return }
  try {
    let saved
    if (typeof openLineId.value === 'string') {
      saved = (await createTemplateLine(formData())).data
      // Nouvelle ligne : proposer de l'ajouter aussi au mois en cours (sinon elle n'apparaît qu'au prochain mois)
      if (currentMonth.value && Number(f.intervalMonths) <= 1) {
        const also = await confirmDialog({ title: 'Ligne ajoutée au template', message: `L'ajouter aussi à ${currentMonth.value.name} ? Sinon elle n'apparaîtra qu'à partir du prochain mois.`, confirmLabel: `Oui, ajouter à ${currentMonth.value.name}`, cancelLabel: 'Non, template seulement' })
        if (also) await applyToCurrentMonth(saved, { ask: false })
      }
    } else {
      saved = (await updateTemplateLine(openLineId.value, formData())).data
    }
    // Mensualisation : enveloppe liée créée / déliée selon la case ; compte hôte modifiable ensuite
    const wantMonthly = Number(f.intervalMonths) > 1 && f.monthlyize
    if (wantMonthly !== !!saved.envelopeId) {
      await monthlyizeTemplateLine(saved.id, wantMonthly, f.monthlyizeAccountId || null)
    } else if (wantMonthly && saved.envelopeId) {
      const env = envelopeById(saved.envelopeId)
      const wantedAccount = f.monthlyizeAccountId || accounts.value.find((a) => a.isMain)?.id || null
      if (env && (env.accountId || null) !== wantedAccount) {
        // L'enveloppe contient déjà de l'argent : il doit physiquement suivre → virement système confirmé
        let moveOk = true
        if (env.total > 0) {
          const name = (id) => accounts.value.find((a) => a.id === id)?.name || 'le compte principal'
          const oldHost = env.accountId || accounts.value.find((a) => a.isMain)?.id || null
          moveOk = await confirmDialog({
            title: 'Déplacer la mise de côté',
            message: `L'enveloppe « ${env.name} » contient ${fmt(env.total)} : un virement de ce montant sera enregistré de ${name(oldHost)} vers ${name(wantedAccount)} dans le mois en cours.`,
            confirmLabel: 'Déplacer et virer',
          })
        }
        if (moveOk) await updateEnvelope(env.id, { accountId: wantedAccount })
      }
    }
    closePanel()
    const [lRes, eRes] = await Promise.all([getTemplateLines(), getEnvelopes()])
    lines.value = lRes.data
    envelopes.value = eRes.data
  } catch (e) { apiError(e) }
}

/**
 * Retire une ligne du budget type, après confirmation.
 *
 * Les copies déjà présentes dans les mois ne sont pas touchées : elles se détachent du
 * template et gardent leur réel. Le message le dit, parce que c'est contre-intuitif.
 *
 * @param {object} line La ligne à retirer.
 */
async function removeLineConfirm(line) {
  const ok = await confirmDialog({
    title: 'Supprimer du template',
    message: `« ${line.label} » ne sera plus copiée dans les prochains mois. Les copies déjà présentes dans les mois restent (détachées du template)${line.envelopeId ? ' ; son enveloppe est supprimée si elle est vide et n\'a jamais servi, sinon elle reste ouverte' : ''}.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteTemplateLine(line.id)
    if (openLineId.value === line.id) closePanel()
    lines.value = (await getTemplateLines()).data
  } catch (e) { apiError(e) }
}

/**
 * Monte ou descend une ligne dans sa catégorie.
 *
 * L'ordre est global à tout le budget type, pas propre à chaque catégorie : on réécrit
 * donc le rang de TOUTES les lignes, groupe par groupe, en substituant la liste
 * réordonnée à celle du groupe concerné. Ne renuméroter que le groupe créerait des
 * rangs en double d'un groupe à l'autre.
 *
 * @param {object} group Le groupe contenant la ligne.
 * @param {number} index Position actuelle dans le groupe.
 * @param {number} delta -1 pour monter, +1 pour descendre.
 */
async function moveLine(group, index, delta) {
  const target = index + delta
  if (target < 0 || target >= group.lines.length) return
  const list = [...group.lines]
  ;[list[index], list[target]] = [list[target], list[index]]
  // L'ordre est global : on réécrit le sort_order de toutes les lignes, groupe par groupe
  const orders = []
  let order = 0
  groups.value.forEach((g) => {
    const groupLines = g.category.id === group.category.id ? list : g.lines
    groupLines.forEach((l) => orders.push({ id: l.id, order: order++ }))
  })
  try {
    lines.value = (await reorderTemplateLines(orders)).data
  } catch (e) { apiError(e) }
}

// Le type de la catégorie du formulaire (adapte les champs affichés)
const formCategoryType = computed(() => {
  const c = categories.value.find((x) => x.id === form.value.categoryId)
  return c?.type || 'depense'
})
</script>

<template>
  <div @click="menuLineId = null">
    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold">Template</h1>
        <p class="page-sub">Les lignes recopiées dans chaque nouveau mois. Les modifier n'affecte pas les mois déjà créés.</p>
      </div>
      <button v-if="categories.length" class="btn-primary" @click="openAddGlobal">+ Ligne</button>
    </div>

    <!-- ─── Bandeau : le reste théorique en héros — brief §2 ── -->
    <div v-if="lines.length" class="panel bandeau">
      <div class="bandeau-row">
        <div class="synth-hero">
          <span class="num synth-solde" :class="{ 'is-over': totals.reste < 0 }">{{ fmt(totals.reste) }}</span>
          <span class="synth-sub has-tip" title="Revenus − dépenses − épargne − transferts, cagnottes calculées comprises. Les lignes non mensuelles comptent pour leur part mensuelle. Ce que le template laisse chaque mois avant imprévus.">Reste théorique</span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k">Revenus</span>
          <span class="num synth-v">{{ fmt(totals.revenu) }}</span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k">Dépenses</span>
          <span class="num synth-v">{{ fmt(totals.depense) }}</span>
        </div>
        <template v-if="totals.counts.epargne">
          <div class="synth-sep" />
          <div class="synth-kv">
            <span class="synth-k">Épargne</span>
            <span class="num synth-v">{{ fmt(totals.epargne) }}</span>
          </div>
        </template>
        <template v-if="totals.counts.transfert">
          <div class="synth-sep" />
          <div class="synth-kv">
            <span class="synth-k">Transferts</span>
            <span class="num synth-v">{{ fmt(totals.transfert) }}</span>
          </div>
        </template>
      </div>
      <!-- Composition sur la base des revenus -->
      <div v-if="compo" class="compo">
        <div class="compo-bar">
          <span v-for="s in compo.segs" :key="s.key" class="compo-seg" :style="{ width: Math.min(100, s.pct) + '%', opacity: s.opacity }" />
        </div>
        <div class="compo-legend">
          <span v-for="s in compo.segs" :key="'l' + s.key" class="compo-item">
            <span class="compo-dot" :style="{ opacity: s.opacity }" />{{ s.label }} <span class="num meta">{{ Math.round(s.pct) }}&#8239;%</span>
          </span>
          <span class="compo-item"><span class="compo-dot is-track" />Reste <span class="num" :class="compo.restePct < 0 ? 'is-over' : 'meta'">{{ Math.round(compo.restePct) }}&#8239;%</span></span>
        </div>
      </div>
    </div>

    <!-- ─── Ligne du template (modal : ajout et édition) ── -->
    <AppModal :open="modalOpen" :title="modalAdding ? 'Nouvelle ligne' : 'Modifier « ' + (modalLine?.label || '') + ' »'" wide @close="closePanel">
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap gap-3 items-end">
          <label class="field"><span>Libellé</span><input v-model="form.label" type="text" class="input w-44" placeholder="Loyer, Courses…" @keyup.enter="submit" /></label>
          <label v-if="!form.isPot" class="field"><span class="flex items-center gap-1">Prévu (€) <HelpTip text="Le montant attendu chaque mois. Dans le mois, une ligne avec un prévu et aucune entrée a une case ☐ : cocher = payé au prévu. Dès qu'une entrée existe, le réel remplace le prévu." /></span><input v-model="form.plannedAmount" type="number" step="0.01" class="input w-24" @keyup.enter="submit" /></label>
          <label class="field"><span class="flex items-center gap-1">Jour du mois <HelpTip :text="form.isPot ? 'Jour où vous réglez la cagnotte : date par défaut du ☐ payé.' : 'Jour du prélèvement : date par défaut quand vous cochez ☐ payé dans le mois.'" /></span><input v-model="form.recurringDay" type="number" min="1" max="31" class="input w-20" placeholder="—" /></label>
          <label class="field"><span>Catégorie</span>
            <select v-model="form.categoryId" class="input w-40">
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <label v-if="themes.length" class="field"><span>Thème</span>
            <select v-model="form.themeId" class="input w-32">
              <option value="">—</option>
              <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
        </div>

        <!-- Périodicité et mensualisation -->
        <div v-if="!form.isPot" class="flex flex-wrap gap-3 items-end">
          <label class="field"><span class="flex items-center gap-1">Périodicité <HelpTip text="Chaque mois, ou tous les N mois à partir d'un mois d'ancrage (ex. une fois par an en juillet, tous les 6 mois en mars et septembre). La ligne n'apparaît que les mois du cycle." /></span>
            <select v-model="form.intervalMonths" class="input w-40">
              <option v-for="i in INTERVALS" :key="i.value" :value="i.value">{{ i.label }}</option>
            </select>
          </label>
          <label v-if="Number(form.intervalMonths) > 1" class="field"><span>Mois d'ancrage</span>
            <select v-model="form.anchorMonth" class="input w-36">
              <option value="">—</option>
              <option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option>
            </select>
          </label>
          <template v-if="Number(form.intervalMonths) > 1">
            <label class="checkbox self-end"><input v-model="form.monthlyize" type="checkbox" /><span>Mensualiser</span><HelpTip wide text="Lisse une charge non mensuelle : une enveloppe du même nom est créée (cible = le montant, échéance = la prochaine occurrence) et suggère chaque mois la part à mettre de côté — ☐ versé dans le mois. Le jour J, ☐ payé sort le montant de l'enveloppe et le cycle repart. L'enveloppe démarre à 0 : les premières mensualités sont plus grosses." /></label>
            <label v-if="form.monthlyize" class="field" title="Compte hôte de l'enveloppe : c'est là que les mensualités s'accumulent, et de là que le paiement partira le jour J"><span>Mise de côté sur</span>
              <select v-model="form.monthlyizeAccountId" class="input w-44">
                <option value="">Compte principal (virtuelle)</option>
                <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
          </template>
        </div>
        <p v-if="Number(form.intervalMonths) > 1" class="modal-hint -mt-2">
          Apparaît {{ form.anchorMonth ? (Number(form.intervalMonths) === 12 ? 'chaque ' + MONTHS[form.anchorMonth - 1] : 'en ' + MONTHS[form.anchorMonth - 1] + ' puis tous les ' + form.intervalMonths + ' mois') : 'les mois du cycle' }}.
          <template v-if="form.monthlyize && modalLine?.envelopeId && envelopeById(modalLine.envelopeId)">
            Enveloppe « {{ envelopeById(modalLine.envelopeId).name }} » : <span class="num">{{ fmt(envelopeById(modalLine.envelopeId).total) }} / {{ fmt(envelopeById(modalLine.envelopeId).targetAmount) }}</span>, ≈ <span class="num">{{ fmt(envelopeById(modalLine.envelopeId).monthlySuggestion) }}</span>/mois.
          </template>
          <template v-else-if="form.monthlyize">L'enveloppe « {{ form.label || '…' }} » sera créée à 0.</template>
          <template v-if="form.monthlyize"> Le jour J, ☐ payé règle depuis le compte « Depuis » et l'enveloppe le rembourse (virement système automatique).</template>
        </p>

        <div class="flex flex-wrap gap-3 items-end">
          <label v-if="formCategoryType === 'revenu'" class="field"><span>Compte crédité</span>
            <select v-model="form.toAccountId" class="input w-40">
              <option value="">—</option>
              <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <template v-else>
            <label class="field"><span class="flex items-center gap-1">Depuis <HelpTip text="Le compte débité par défaut. « Vers » n'apparaît que si l'argent va sur un autre de vos comptes (épargne, virement, provision) ; pour un paiement à un tiers, laissez « extérieur »." /></span>
              <select v-model="form.fromAccountId" class="input w-40">
                <option value="">— aucun</option>
                <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
            <label class="field"><span>Moyen de paiement</span>
              <select v-model="form.paymentMethod" class="input w-32">
                <option value="">—</option>
                <option v-for="m in settings?.paymentMethods || []" :key="m" :value="m">{{ m }}</option>
              </select>
            </label>
            <label v-if="showVers" class="field" :title="formCategoryType === 'depense' ? 'Provision : l\'argent part vers un de vos comptes' : 'Compte destination'"><span>Vers</span>
              <select v-model="form.toAccountId" class="input w-44">
                <option value="">{{ formCategoryType === 'depense' ? '— extérieur (quelqu\'un d\'autre)' : '— compte destination' }}</option>
                <option v-for="a in versAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
          </template>
        </div>

        <div v-if="formCategoryType !== 'revenu'" class="flex flex-wrap gap-3 items-end">
          <label v-if="sharingOn && !form.isPot" class="checkbox"><input v-model="form.isShared" type="checkbox" /><span>Partagé ½</span><HelpTip text="Dépense commune avec le partenaire d'une cagnotte : elle entre dans le calcul de ce que vous vous devez." /></label>
          <select v-if="sharingOn && !form.isPot && form.isShared && pots.length > 1" v-model="form.potLineId" class="input w-40" title="Cagnotte concernée">
            <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.potPartnerName }}</option>
          </select>
          <label class="checkbox"><input v-model="form.isPot" type="checkbox" /><span>Cette ligne est une cagnotte</span><HelpTip wide text="Une cagnotte égalise des dépenses communes avec quelqu'un (loyer avec votre conjoint, vacances avec un ami). Vous indiquez ce que l'autre paie et votre part ; les lignes et entrées marquées ½ sont les vôtres. Le prévu de la cagnotte est calculé : ce que vous devez envoyer (ou recevoir). ☐ payé le jour du virement." /></label>
          <template v-if="form.isPot">
            <label class="field"><span>Partenaire</span><input v-model="form.potPartnerName" type="text" class="input w-28" placeholder="Prénom" /></label>
            <label class="field"><span>Il/elle paie (€/mois)</span><input v-model="form.potPartnerPaid" type="number" step="0.01" class="input w-24" placeholder="0" /></label>
            <label class="field"><span>Ma part (%)</span><input v-model="form.potMyShare" type="number" min="0" max="100" class="input w-16" /></label>
          </template>
        </div>
      </div>
      <template #footer>
        <button class="btn-primary" @click="submit">{{ modalAdding ? 'Ajouter' : 'Sauver' }}</button>
        <button class="btn-secondary" @click="closePanel">Annuler</button>
        <template v-if="!modalAdding && modalLine">
          <button v-if="currentMonth" class="link-accent" title="Copie ou met à jour cette ligne dans le mois en cours (sauvez d'abord vos modifications)" @click="applyToCurrentMonth(modalLine)">Appliquer à {{ currentMonth.name }}</button>
          <button class="btn-danger ml-auto" @click="removeLineConfirm(modalLine)">Supprimer</button>
        </template>
      </template>
    </AppModal>

    <!-- ─── Aucune catégorie ─────────────────────────── -->
    <div v-if="!categories.length" class="panel empty-panel">
      <p>Créez d'abord vos catégories dans les Paramètres.</p>
      <router-link to="/parametres" class="btn-primary inline-flex items-center">Aller aux Paramètres</router-link>
    </div>

    <!-- ─── Registre du template — brief §4/§5 ───────── -->
    <div v-else class="panel tpl-panel" :class="{ 'no-share': !sharingOn }">
      <!-- Bascule de vue (brief §8) -->
      <div class="tpl-toolbar">
        <button class="view-tab" :class="{ 'is-active': viewMode === 'categorie' }" @click="viewMode = 'categorie'">Par catégorie</button>
        <button class="view-tab" :class="{ 'is-active': viewMode === 'echeance' }" @click="viewMode = 'echeance'">Par échéance</button>
      </div>
      <div class="tpl-grid tpl-head">
        <span></span>
        <span class="colh is-left">thème</span>
        <span class="colh is-left">périodicité</span>
        <span class="colh is-left">échéance</span>
        <span v-if="sharingOn" class="colh is-center">partagé</span>
        <span class="colh">montant</span>
        <span></span>
      </div>

      <section v-for="grp in displayGroups" :key="grp.key" class="tpl-section">
        <div class="tpl-grid tpl-sec-head">
          <span class="sec-title">
            <span v-if="grp.dot" class="sec-dot" :style="{ background: desat(grp.dot) }" />
            {{ grp.title }}
            <span class="sec-count num">{{ grp.count }}</span>
            <span v-if="grp.typeLabel" class="sec-type">{{ grp.typeLabel }}</span>
          </span>
          <span></span><span></span><span></span>
          <span v-if="sharingOn"></span>
          <span class="num sec-total">
            {{ fmt(grp.total) }}
            <span v-if="grp.smoothed" class="sec-lisse has-tip" :title="smoothedTip(grp.smoothed)">dont {{ fmt(grp.smoothed.monthly) }} lissés</span>
          </span>
          <span></span>
        </div>

        <div v-for="(line, i) in grp.lines" :key="line.id" class="tpl-grid tpl-row" @click="openEdit(line)">
          <span class="cell-label">
            <span class="row-label" :title="line.label">{{ line.label }}</span>
            <span v-if="line.isPot" class="tag tag-info" :title="potTip(line)">calculé</span>
          </span>
          <span class="cell-theme">
            <template v-if="themeById(line.themeId)">
              <span class="theme-dot" :style="{ background: desat(themeById(line.themeId).color) }" />{{ themeById(line.themeId).name }}
            </template>
            <span v-else class="meta">—</span>
          </span>
          <span class="cell-period" :class="{ 'has-tip': (line.intervalMonths || 1) > 1 }" :title="periodTip(line)">{{ periodLabel(line) }}</span>
          <span class="cell-due num" :title="dueTip(line)">{{ dueLabel(line) }}</span>
          <span v-if="sharingOn" class="cell-share" :title="line.isShared && !line.isPot ? shareTip(line) : ''">{{ line.isShared && !line.isPot ? '½' : '—' }}</span>
          <span class="cell-amount" @click.stop>
            <span v-if="line.isPot" class="num amount-calc" :title="potTip(line)">{{ fmt(lineAmount(line)) }}</span>
            <input v-else class="num amount-input" type="text" inputmode="decimal" :value="fmt(line.plannedAmount)"
              @focus="startAmountEdit(line, $event)" @blur="commitAmount(line, $event)" @keyup.enter="$event.target.blur()" />
          </span>
          <span class="cell-actions" @click.stop>
            <button class="btn-icon row-action" title="Modifier" @click="openEdit(line)">✎</button>
            <span class="menu-wrap">
              <button class="btn-icon" title="Actions" @click="menuLineId = menuLineId === line.id ? null : line.id">⋯</button>
              <div v-if="menuLineId === line.id" class="menu">
                <button class="menu-item" @click="menuLineId = null; openEdit(line)">Modifier</button>
                <button v-if="currentMonth" class="menu-item" @click="menuLineId = null; applyToCurrentMonth(line)">Appliquer à {{ currentMonth.name }}</button>
                <template v-if="grp.orig">
                  <button class="menu-item" :disabled="i === 0" @click="menuLineId = null; moveLine(grp.orig, i, -1)">Monter</button>
                  <button class="menu-item" :disabled="i === grp.lines.length - 1" @click="menuLineId = null; moveLine(grp.orig, i, 1)">Descendre</button>
                </template>
                <div class="menu-sep" />
                <button class="menu-item is-danger" @click="menuLineId = null; removeLineConfirm(line)">Supprimer</button>
              </div>
            </span>
          </span>
        </div>

        <p v-if="!grp.lines.length" class="tpl-empty">Aucune ligne récurrente.</p>
        <button v-if="grp.orig" class="btn-discret tpl-add" @click="openAdd(grp.orig.category)"><PhPlus :size="12" weight="bold" /> Ajouter une ligne</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ─── Page ─── */
.page-sub { font-size: 13px; color: var(--c-ink-2); margin-top: 2px; }
.panel { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--r-container); }
.meta { color: var(--c-ink-3); font-weight: 400; }
.is-over { color: var(--c-over); }

/* ─── Bandeau ─── */
.bandeau { padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.bandeau-row { display: flex; align-items: center; gap: var(--s-6); }
.synth-hero { display: flex; flex-direction: column; line-height: var(--lh-tight); }
.synth-solde { font-size: var(--t-hero); font-weight: 600; color: var(--c-ink); }
.synth-sub { font-size: var(--t-meta); color: var(--c-ink-3); margin-top: 2px; align-self: flex-start; }
.has-tip { text-decoration: underline dotted var(--c-ink-3); text-underline-offset: 3px; cursor: help; }
.synth-sep { width: 1px; align-self: stretch; background: var(--c-line); }
.synth-kv { display: flex; flex-direction: column; gap: 2px; line-height: var(--lh-tight); }
.synth-k { font-size: var(--t-small); color: var(--c-ink-3); }
.synth-v { font-size: var(--t-amount); color: var(--c-ink); }

/* ─── Composition ─── */
.compo { margin-top: var(--s-4); border-top: 1px solid var(--c-line); padding-top: var(--s-4); }
.compo-bar { display: flex; height: 10px; border-radius: var(--r-pill); overflow: hidden; background: var(--c-track); }
.compo-seg { display: block; background: var(--c-fill); }
.compo-seg + .compo-seg { border-left: 2px solid var(--c-surface); }
.compo-legend { display: flex; flex-wrap: wrap; gap: var(--s-5); margin-top: var(--s-2); font-size: var(--t-small); color: var(--c-ink-2); }
.compo-item { display: inline-flex; align-items: center; gap: var(--s-2); }
.compo-dot { width: 8px; height: 8px; border-radius: var(--r-pill); background: var(--c-fill); flex-shrink: 0; }
.compo-dot.is-track { background: var(--c-track); }

/* ─── Registre ─── */
.tpl-panel { overflow: visible; }
.tpl-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 148px 120px 84px 64px 120px 64px;
  align-items: center;
  gap: var(--s-3);
  padding-inline: var(--s-5);
}
.tpl-panel.no-share .tpl-grid { grid-template-columns: minmax(0, 1fr) 148px 120px 84px 120px 64px; }
.tpl-toolbar { display: flex; gap: var(--s-5); padding: var(--s-3) var(--s-5) 0; }
.view-tab { font-size: 13px; font-weight: 500; color: var(--c-ink-3); padding: var(--s-2) 0 var(--s-3); cursor: pointer; border-bottom: 2px solid transparent; }
.view-tab:hover { color: var(--c-ink); }
.view-tab.is-active { color: var(--c-ink); border-bottom-color: var(--c-accent); }
.tpl-head { min-height: 30px; border-block: 1px solid var(--c-line); background: var(--c-surface-sunken); }
.colh { font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); text-align: right; }
.colh.is-left { text-align: left; }
.colh.is-center { text-align: center; }

.tpl-section + .tpl-section { border-top: 1px solid var(--c-line-strong); }
.tpl-sec-head { min-height: 44px; background: var(--c-surface-sunken); position: sticky; top: 0; z-index: 10; }
.sec-title { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-section); font-weight: 600; color: var(--c-ink); min-width: 0; }
.sec-dot { width: 8px; height: 8px; border-radius: var(--r-pill); flex-shrink: 0; }
.sec-count { font-size: var(--t-small); font-weight: 400; color: var(--c-ink-3); }
.sec-type { font-size: var(--t-small); font-weight: 400; color: var(--c-ink-3); }
.sec-total { font-size: var(--t-section-n); font-weight: 600; color: var(--c-ink); text-align: right; line-height: 1.2; }
.sec-lisse { display: block; font-size: var(--t-meta); font-weight: 400; color: var(--c-ink-3); white-space: nowrap; }

.tpl-row { min-height: var(--h-row); border-bottom: 1px solid var(--c-line); cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.tpl-row:hover { background: var(--c-surface-hover); }
.tpl-section .tpl-row:last-of-type { border-bottom: none; }
.cell-label { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.row-label { font-size: var(--t-body); font-weight: 500; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-theme { display: flex; align-items: center; gap: var(--s-2); font-size: 13px; color: var(--c-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.theme-dot { width: 6px; height: 6px; border-radius: var(--r-pill); flex-shrink: 0; }
.cell-period { font-size: 13px; color: var(--c-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-period.has-tip { text-decoration: underline dotted var(--c-ink-3); text-underline-offset: 3px; cursor: help; }
.cell-due { font-size: 13px; color: var(--c-ink-2); text-align: left; white-space: nowrap; }
.cell-share { font-size: 13px; color: var(--c-ink-2); text-align: center; }
.cell-amount { display: flex; justify-content: flex-end; }
.amount-calc { font-size: var(--t-amount); color: var(--c-ink-2); cursor: not-allowed; padding: 2px var(--s-2); }
.amount-input {
  width: 100%; max-width: 120px; text-align: right;
  font-size: var(--t-amount); color: var(--c-ink);
  background: transparent; border: 1px solid transparent; border-radius: var(--r-control);
  padding: 2px var(--s-2); outline: none; font-family: var(--font-ui);
  transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.amount-input:hover { border-color: var(--c-line-strong); background: var(--c-surface); }
.amount-input:focus { border-color: var(--c-accent); background: var(--c-surface); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.cell-actions { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.row-action { opacity: 0; }
.tpl-row:hover .row-action, .row-action:focus-visible { opacity: 1; }

.tpl-empty { font-size: 13px; color: var(--c-ink-2); padding: var(--s-3) var(--s-5); }
.tpl-add { margin: var(--s-1) var(--s-5) var(--s-3); }

/* Menu ⋯ */
.menu-wrap { position: relative; }
.menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 40;
  min-width: 210px;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-container);
  box-shadow: var(--shadow-overlay);
  padding: var(--s-2);
}
.menu-item {
  display: block; width: 100%; text-align: left;
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-control);
  font-size: 13px; color: var(--c-ink);
  cursor: pointer;
}
.menu-item:hover { background: var(--c-surface-hover); }
.menu-item:disabled { color: var(--c-ink-disabled); cursor: default; }
.menu-item:disabled:hover { background: none; }
.menu-item.is-danger { color: var(--c-over); }
.menu-item.is-danger:hover { background: var(--c-over-soft); }
.menu-sep { height: 1px; background: var(--c-line); margin: var(--s-2) 0; }

/* ─── États vides ─── */
.empty-panel { text-align: center; padding: var(--s-8); font-size: 13px; color: var(--c-ink-2); display: flex; flex-direction: column; align-items: center; gap: var(--s-4); }

/* ─── Tags ─── */
.tag {
  display: inline-flex; align-items: center; gap: var(--s-1);
  height: 20px; padding: 0 var(--s-3);
  border-radius: var(--r-control);
  font-size: var(--t-tag); font-weight: 500;
  white-space: nowrap; flex-shrink: 0;
}
.tag-info { background: var(--c-surface-sunken); color: var(--c-ink-2); border: 1px solid var(--c-line); cursor: help; }

/* ─── Boutons, liens, champs (partagés avec la modale) ─── */
.btn-primary { height: 34px; padding: 0 var(--s-5); background: var(--c-accent); color: var(--c-on-accent); border-radius: var(--r-control); font-size: 13px; font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-primary:hover { background: var(--c-accent-hover); }
.btn-secondary { height: 30px; padding: 0 var(--s-4); background: var(--c-surface); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); color: var(--c-ink); font-size: var(--t-small); font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-secondary:hover { background: var(--c-surface-hover); }
.btn-danger { height: 30px; padding: 0 var(--s-4); background: var(--c-surface); border: 1px solid var(--c-over); border-radius: var(--r-control); color: var(--c-over); font-size: var(--t-small); font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-danger:hover { background: var(--c-over-soft); }
.btn-icon { width: 26px; height: 26px; border-radius: var(--r-control); display: inline-flex; align-items: center; justify-content: center; color: var(--c-ink-3); font-size: 13px; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-icon:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.btn-discret { display: inline-flex; align-items: center; gap: var(--s-1); color: var(--c-accent); font-size: var(--t-small); font-weight: 500; padding: var(--s-2) 0; cursor: pointer; }
.btn-discret:hover { color: var(--c-accent-hover); }
.link-accent { color: var(--c-accent); font-size: var(--t-small); font-weight: 500; cursor: pointer; }
.link-accent:hover { color: var(--c-accent-hover); text-decoration: underline; }
.field { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); }
.input { padding: 6px var(--s-3); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); font-size: 13px; color: var(--c-ink); background: var(--c-surface); outline: none; font-family: var(--font-ui); }
.input:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.checkbox { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-small); color: var(--c-ink-2); cursor: pointer; }
.modal-hint { font-size: 11.5px; color: var(--c-ink-3); }

button:focus-visible, select:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); border-radius: var(--r-control); }

/* ─── Responsive — brief §5 ─── */
@media (max-width: 1199px) {
  /* la colonne thème disparaît */
  .tpl-grid { grid-template-columns: minmax(0, 1fr) 120px 84px 64px 120px 64px; }
  .tpl-panel.no-share .tpl-grid { grid-template-columns: minmax(0, 1fr) 120px 84px 120px 64px; }
  .tpl-grid > :nth-child(2) { display: none; }
}
@media (max-width: 979px) {
  /* partagé et échéance disparaissent : libellé, périodicité, montant, actions */
  .tpl-grid { grid-template-columns: minmax(0, 1fr) 120px 120px 64px; min-height: var(--h-row-touch); }
  .tpl-panel.no-share .tpl-grid { grid-template-columns: minmax(0, 1fr) 120px 120px 64px; }
  .tpl-grid > :nth-child(4) { display: none; }
  .tpl-panel:not(.no-share) .tpl-grid > :nth-child(5) { display: none; }
  .tpl-panel.no-share .tpl-grid > :nth-child(1) { grid-column: 1; }
  .bandeau-row { flex-wrap: wrap; gap: var(--s-4); }
  .synth-sep { display: none; }
}
</style>
