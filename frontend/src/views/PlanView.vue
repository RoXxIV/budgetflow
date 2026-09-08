<script setup>
// Plan de financement — page BAC À SABLE : rien de ce qui est saisi ici n'alimente
// les mois, les enveloppes ou les investissements réels.
//
// Ce qu'elle remplace : un tableur où l'on répartit à la main une capacité mensuelle
// entre plusieurs projets, en décalant les parts à mesure que les objectifs tombent.
// Le calcul de la cascade vit côté serveur (plan.service) ; la page ne fait que
// saisir, afficher, et laisser retoucher.
//
// Le lien avec les vraies données est volontairement manuel : on n'importe une
// moyenne que si on la demande, ligne par ligne.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { computePlan, getAverages } from '@/api/plan.js'
import HelpTip from '@/components/HelpTip.vue'
import { apiError } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

const fmt = eur
const round2 = (n) => Math.round(n * 100) / 100

const MOIS = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const moisCourt = (p) => { const [y, m] = p.split('-').map(Number); return `${MOIS[m - 1]} ${String(y).slice(2)}` }
const moisLong = (p) => { const [y, m] = p.split('-').map(Number); return `${MOIS[m - 1]} ${y}` }

const currentPeriod = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` }
const nextPeriod = (p) => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }

// ─── Persistance : le plan se retravaille, il ne doit pas mourir au rechargement ───
// localStorage plutôt qu'une table : c'est un bac à sable, rien n'a à survivre à un
// changement de machine, et ça évite une migration pour une page en rodage.
const LS = 'budgetflow.plan'
const nextId = () => Math.random().toString(36).slice(2, 9)

const lignes = ref([])     // { id, label, type: 'revenu'|'depense', amount }
const objectifs = ref([])  // { id, label, type, target|'', startPeriod, already }
const zones = ref([])      // [{ percents: { objectifId: pourcentage } }] — une par zone
const locks = ref({})      // { 'AAAA-MM': { objectifId: montant } }
const startPeriod = ref(nextPeriod(currentPeriod()))
// La somme à répartir est calculée depuis les lignes, mais reste modifiable à la main :
// on veut pouvoir dire « je ne mets que 800 » sans toucher à son budget.
const capaciteSaisie = ref('')

function planVierge() {
  lignes.value = [
    { id: nextId(), label: 'Revenu', type: 'revenu', amount: '' },
    { id: nextId(), label: 'Charges fixes', type: 'depense', amount: '' },
    { id: nextId(), label: 'Courses', type: 'depense', amount: '' },
  ]
  objectifs.value = [{ id: nextId(), label: '', type: 'epargne', target: '', startPeriod: '', already: '' }]
  zones.value = []
  locks.value = {}
  capaciteSaisie.value = ''
}

onMounted(async () => {
  try {
    const brut = localStorage.getItem(LS)
    if (brut) {
      const p = JSON.parse(brut)
      lignes.value = p.lignes || []
      objectifs.value = p.objectifs || []
      zones.value = p.zones || []
      locks.value = p.locks || {}
      startPeriod.value = p.startPeriod || startPeriod.value
      capaciteSaisie.value = p.capaciteSaisie ?? ''
    } else planVierge()
  } catch { planVierge() }

  try { moyennes.value = (await getAverages()).data } catch { /* l'import restera indisponible */ }
  recalculer()
})

// Toute modification est retenue, sans bouton « enregistrer » : la page est un brouillon
watch([lignes, objectifs, zones, locks, startPeriod, capaciteSaisie], () => {
  try {
    localStorage.setItem(LS, JSON.stringify({
      lignes: lignes.value, objectifs: objectifs.value, zones: zones.value,
      locks: locks.value, startPeriod: startPeriod.value, capaciteSaisie: capaciteSaisie.value,
    }))
  } catch { /* stockage indisponible : le plan vivra le temps de la session */ }
}, { deep: true })

// ─── Bloc 1 : revenus et charges → la capacité ───
const nombre = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const totalRevenus = computed(() => round2(lignes.value.filter((l) => l.type === 'revenu').reduce((s, l) => s + nombre(l.amount), 0)))
const totalCharges = computed(() => round2(lignes.value.filter((l) => l.type === 'depense').reduce((s, l) => s + nombre(l.amount), 0)))
// Ce qui reste des revenus une fois les charges retirées
const resteCalcule = computed(() => round2(totalRevenus.value - totalCharges.value))
// La somme réellement répartie : celle qu'on saisit, à défaut celle qu'on a calculée
const capacite = computed(() => (String(capaciteSaisie.value).trim() === '' ? resteCalcule.value : round2(nombre(capaciteSaisie.value))))
const capaciteSurchargee = computed(() => String(capaciteSaisie.value).trim() !== '' && capacite.value !== resteCalcule.value)

const ajouterLigne = () => lignes.value.push({ id: nextId(), label: '', type: 'depense', amount: '' })

/**
 * Crée une ligne par thème, avec sa moyenne réelle.
 *
 * Plus rapide que d'importer poste par poste quand on part d'une page blanche : on
 * ramène tout, puis on retire ce qui ne sert pas. Les thèmes déjà présents dans le
 * plan sont sautés, pour que le bouton reste rejouable sans créer de doublons.
 */
function importerTousLesThemes() {
  if (!moyennes.value) return
  const dejaLa = new Set(lignes.value.map((l) => (l.importe || l.label).trim().toLowerCase()))
  let n = 0
  for (const t of moyennes.value.themes) {
    if (dejaLa.has(t.name.trim().toLowerCase())) continue
    lignes.value.push({ id: nextId(), label: t.name, type: 'depense', amount: t.average, importe: t.name })
    n++
  }
  if (n) recalculer()
}
const retirerLigne = (id) => { lignes.value = lignes.value.filter((l) => l.id !== id) }

// ─── Import d'une moyenne réelle, à la demande ───
const moyennes = ref(null)
const importPour = ref(null)   // id de la ligne dont le menu est ouvert
const rechercheImport = ref('')

const propositions = computed(() => {
  if (!moyennes.value) return []
  const q = rechercheImport.value.trim().toLowerCase()
  const tout = [
    ...moyennes.value.categories.map((c) => ({ ...c, source: 'catégorie' })),
    ...moyennes.value.themes.map((t) => ({ ...t, source: 'thème' })),
  ]
  return (q ? tout.filter((x) => x.name.toLowerCase().includes(q)) : tout).slice(0, 40)
})

/**
 * Ouvre (ou referme) le menu d'import d'une ligne.
 *
 * La recherche repart toujours vide : pré-remplir avec le libellé filtrait d'emblée
 * la liste et cachait tout le reste, alors qu'on vient justement voir ce qui existe.
 *
 * @param {object} ligne La ligne du plan concernée.
 */
function ouvrirImport(ligne) {
  importPour.value = importPour.value === ligne.id ? null : ligne.id
  rechercheImport.value = ''
}

// Le menu se ferme au clic à côté et à Échap — sans quoi il restait ouvert dès qu'on
// cliquait ailleurs que sur son propre bouton.
const fermerImport = () => { importPour.value = null }
onMounted(() => window.addEventListener('keydown', surEchap))
onUnmounted(() => window.removeEventListener('keydown', surEchap))
function surEchap(e) { if (e.key === 'Escape') fermerImport() }

/**
 * Reprend une moyenne réelle dans une ligne du plan.
 *
 * @param {object} ligne La ligne du plan à remplir.
 * @param {object} proposition L'entrée choisie dans le menu.
 */
function importerMoyenne(ligne, proposition) {
  ligne.amount = proposition.average
  if (!ligne.label.trim()) ligne.label = proposition.name
  if (proposition.type === 'revenu') ligne.type = 'revenu'
  ligne.importe = proposition.name
  importPour.value = null
  recalculer()
}

// ─── Bloc 2 : les objectifs ───
const TYPES_OBJECTIF = [
  { value: 'epargne', label: 'Épargne' },
  { value: 'investissement', label: 'Investissement' },
]
const ajouterObjectif = () => objectifs.value.push({ id: nextId(), label: '', type: 'epargne', target: '', startPeriod: '', already: '' })
const retirerObjectif = (id) => {
  objectifs.value = objectifs.value.filter((o) => o.id !== id)
  // Ses cellules verrouillées n'ont plus d'objet
  for (const p of Object.keys(locks.value)) delete locks.value[p][id]
  recalculer()
}
const monter = (i) => { if (i > 0) { const l = [...objectifs.value]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; objectifs.value = l; recalculer() } }
const descendre = (i) => { if (i < objectifs.value.length - 1) { const l = [...objectifs.value]; [l[i], l[i + 1]] = [l[i + 1], l[i]]; objectifs.value = l; recalculer() } }

// Un objectif sans montant est « sans fin » : il encaisse sa part indéfiniment
const sansFin = (o) => String(o.target).trim() === ''
const nomObjectif = (id) => objectifs.value.find((o) => o.id === id)?.label || '—'

// ─── Les zones : qui reçoit quoi, et jusqu'à quand ───
// Une zone est une période où la répartition ne change pas ; on passe à la suivante
// dès qu'un objectif est soldé. Le serveur renvoie leur composition réelle, la page
// n'a qu'à proposer les curseurs correspondants.
const pourcent = (zi, id) => {
  const p = Number(zones.value[zi]?.percents?.[id])
  return Number.isFinite(p) ? p : 0
}

/**
 * Règle la part d'un objectif dans une zone, et rééquilibre les autres.
 *
 * Le total d'une zone fait toujours 100 % : ce qu'on donne à l'un est repris aux
 * autres, au prorata de ce qu'ils avaient. Sans ce rééquilibrage, il faudrait régler
 * les curseurs dans le bon ordre pour ne jamais dépasser — ce qui est intenable.
 *
 * @param {number} zi Rang de la zone.
 * @param {string} id L'objectif déplacé.
 * @param {number} valeur Sa nouvelle part, en pourcentage.
 */
function reglerPourcent(zi, id, valeur) {
  const zone = plan.value?.zones?.[zi]
  if (!zone) return
  const v = Math.min(100, Math.max(0, Math.round(Number(valeur) || 0)))
  const autres = zone.goals.filter((k) => k !== id)

  if (!zones.value[zi]) zones.value[zi] = { percents: {} }
  const actuels = {}
  for (const k of zone.goals) actuels[k] = pourcent(zi, k)

  const reste = 100 - v
  const sommeAutres = autres.reduce((s, k) => s + actuels[k], 0)
  const nouveaux = { [id]: v }
  if (autres.length) {
    if (sommeAutres <= 0) {
      // Les autres étaient tous à zéro : on partage le reste également
      autres.forEach((k, i) => { nouveaux[k] = i === autres.length - 1 ? reste - Math.floor(reste / autres.length) * (autres.length - 1) : Math.floor(reste / autres.length) })
    } else {
      let cumul = 0
      autres.forEach((k, i) => {
        const part = i === autres.length - 1 ? reste - cumul : Math.round((actuels[k] / sommeAutres) * reste)
        nouveaux[k] = Math.max(0, part)
        cumul += nouveaux[k]
      })
    }
  }
  zones.value[zi] = { percents: { ...zones.value[zi].percents, ...nouveaux } }
  recalculer()
}

/** Remet une zone à parts égales. */
function egaliserZone(zi) {
  const zone = plan.value?.zones?.[zi]
  if (!zone || !zone.goals.length) return
  const n = zone.goals.length
  const base = Math.floor(100 / n)
  const percents = {}
  zone.goals.forEach((k, i) => { percents[k] = i === n - 1 ? 100 - base * (n - 1) : base })
  zones.value[zi] = { percents }
  recalculer()
}

// ─── Le calcul ───
const plan = ref(null)
const calculEnCours = ref(false)

// Un objectif compte dès qu'il porte un nom : sa part se règle ensuite par zone
const objectifsValides = computed(() => objectifs.value.filter((o) => o.label.trim()))

/** Envoie le plan au serveur et récupère le tableau. */
async function recalculer() {
  if (capacite.value <= 0 || !objectifsValides.value.length) { plan.value = null; return }
  calculEnCours.value = true
  try {
    const { data } = await computePlan({
      capacity: capacite.value,
      startPeriod: startPeriod.value,
      goals: objectifsValides.value.map((o) => ({
        key: o.id,
        name: o.label.trim(),
        type: o.type,
        target: sansFin(o) ? null : nombre(o.target),
        startPeriod: o.startPeriod || startPeriod.value,
        already: nombre(o.already),
      })),
      zones: zones.value,
      locks: locks.value,
    })
    plan.value = data
  } catch (e) { apiError(e) } finally { calculEnCours.value = false }
}

const objectifParId = (id) => objectifs.value.find((o) => o.id === id) || null

// ─── Le tableau : retoucher une cellule la fige, le reste se redistribue ───
const estVerrouille = (periode, id) => !!locks.value[periode] && id in locks.value[periode]

/**
 * Fige une cellule à la valeur saisie.
 *
 * C'est le geste central du tableau : la valeur ne bougera plus, et le calcul
 * redistribue tout le reste autour d'elle — mois suivants compris.
 */
function verrouiller(periode, id, valeur) {
  const v = nombre(valeur)
  if (!locks.value[periode]) locks.value[periode] = {}
  locks.value[periode][id] = Math.max(0, round2(v))
  recalculer()
}

/** Rend une cellule au calcul. */
function deverrouiller(periode, id) {
  if (!locks.value[periode]) return
  delete locks.value[periode][id]
  if (!Object.keys(locks.value[periode]).length) delete locks.value[periode]
  recalculer()
}

const nbVerrous = computed(() => Object.values(locks.value).reduce((s, r) => s + Object.keys(r).length, 0))
function toutDeverrouiller() { locks.value = {}; recalculer() }

function reinitialiser() {
  planVierge()
  recalculer()
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="plan-head">
      <div>
        <h1 class="plan-title">Plan de financement</h1>
        <p class="plan-sub">
          Un brouillon : rien de ce qui est saisi ici ne touche vos mois, vos enveloppes ou vos investissements.
          Vous pouvez y reprendre vos moyennes réelles, ligne par ligne.
        </p>
      </div>
      <button class="btn-secondary" @click="reinitialiser">Repartir de zéro</button>
    </header>

    <!-- ─── 1. Revenus et charges ─────────────────────── -->
    <section class="panel">
      <div class="sec-head">
        <h2 class="sec-title">Chaque mois</h2>
        <span class="sec-hint" v-if="moyennes">
          moyennes sur {{ moyennes.months }} mois révolus
          <button class="link-btn" title="Créer une ligne par thème, avec sa moyenne — à vous de retirer ce qui ne sert pas" @click="importerTousLesThemes">
            importer tous mes thèmes
          </button>
        </span>
      </div>

      <div class="rows">
        <div v-for="l in lignes" :key="l.id" class="row">
          <input v-model="l.label" class="input grow" placeholder="Libellé" @change="recalculer" />
          <select v-model="l.type" class="input w-32" @change="recalculer">
            <option value="revenu">Revenu</option>
            <option value="depense">Dépense</option>
          </select>
          <input v-model="l.amount" type="number" step="0.01" class="input num-input" placeholder="0.00" @change="recalculer" />
          <span class="row-tools">
            <button class="link-btn" :disabled="!moyennes" title="Reprendre une moyenne réelle" @click="ouvrirImport(l)">importer</button>
            <button class="chip-remove" title="Retirer" @click="retirerLigne(l.id)">×</button>
          </span>

          <!-- Menu d'import : catégories et thèmes, avec leur moyenne -->
          <span v-if="importPour === l.id" class="imp-veil" @click="fermerImport" />
          <div v-if="importPour === l.id" class="imp">
            <div class="imp-head">
              <input v-model="rechercheImport" class="input imp-search" placeholder="Filtrer…" />
              <button class="chip-remove" title="Fermer (Échap)" @click="fermerImport">×</button>
            </div>
            <div class="imp-list">
              <button v-for="p in propositions" :key="p.source + p.id" class="imp-item" @click="importerMoyenne(l, p)">
                <span class="imp-name">{{ p.name }}</span>
                <span class="imp-src">{{ p.source }}</span>
                <span class="imp-avg num">{{ fmt(p.average) }}</span>
              </button>
              <p v-if="!propositions.length" class="imp-empty">Aucun résultat.</p>
            </div>
          </div>
          <p v-else-if="l.importe" class="row-note">importé : {{ l.importe }}</p>
        </div>
      </div>

      <button class="btn-discret" @click="ajouterLigne">+ ajouter une ligne</button>

      <div class="totaux">
        <span>Revenus <b class="num">{{ fmt(totalRevenus) }}</b></span>
        <span>Charges <b class="num">{{ fmt(totalCharges) }}</b></span>
        <span>Reste <b class="num">{{ fmt(resteCalcule) }}</b></span>
        <span class="totaux-final">
          <span>À répartir chaque mois</span>
          <input
            v-model="capaciteSaisie"
            type="number" step="0.01"
            class="input num-input cap-input"
            :placeholder="String(resteCalcule)"
            @change="recalculer"
          />
          <button v-if="capaciteSurchargee" class="link-btn" title="Revenir au reste calculé" @click="capaciteSaisie = ''; recalculer()">
            reprendre {{ fmt(resteCalcule) }}
          </button>
          <HelpTip text="Ce que vous consacrez réellement à vos objectifs. Vide, c'est le reste calculé au-dessus ; vous pouvez saisir moins pour garder du volant." />
        </span>
      </div>
    </section>

    <!-- ─── 2. Objectifs ──────────────────────────────── -->
    <section class="panel">
      <div class="sec-head">
        <h2 class="sec-title">Mes objectifs</h2>
        <label class="sec-hint start">
          à partir de
          <input v-model="startPeriod" type="month" class="input w-36" @change="recalculer" />
        </label>
      </div>

      <div class="goals-head">
        <span></span><span>Objectif</span><span>Type</span><span>Montant</span>
        <span>Déjà mis</span><span>Départ</span><span></span>
      </div>
      <div v-for="(o, i) in objectifs" :key="o.id" class="goal-row">
        <span class="goal-rank">
          <button class="chip-remove" :disabled="i === 0" title="Monter" @click="monter(i)">↑</button>
          <button class="chip-remove" :disabled="i === objectifs.length - 1" title="Descendre" @click="descendre(i)">↓</button>
        </span>
        <input v-model="o.label" class="input" placeholder="PC, apport, voyage…" @change="recalculer" />
        <select v-model="o.type" class="input" @change="recalculer">
          <option v-for="t in TYPES_OBJECTIF" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <input v-model="o.target" type="number" step="0.01" class="input num-input" placeholder="sans fin" @change="recalculer" />
        <input v-model="o.already" type="number" step="0.01" class="input num-input" placeholder="0" @change="recalculer" />
        <input v-model="o.startPeriod" type="month" class="input" :placeholder="startPeriod" @change="recalculer" />
        <button class="chip-remove" title="Retirer" @click="retirerObjectif(o.id)">×</button>
      </div>

      <button class="btn-discret" @click="ajouterObjectif">+ ajouter un objectif</button>

      <p class="sec-note">
        Un objectif sans montant est <b>sans fin</b> : il encaisse sa part indéfiniment, comme un DCA.
        La répartition se règle ci-dessous, zone par zone.
      </p>
    </section>

    <!-- ─── 3. Les zones : comment répartir, et jusqu'à quand ─── -->
    <section v-if="plan && plan.zones.length" class="panel">
      <div class="sec-head">
        <h2 class="sec-title">Répartition par zone</h2>
        <span class="sec-hint">une zone se termine quand un objectif est atteint</span>
      </div>

      <div class="zones">
        <div v-for="z in plan.zones" :key="z.index" class="zone">
          <div class="zone-head">
            <span class="zone-num">Zone {{ z.index + 1 }}</span>
            <span class="zone-from">à partir de {{ moisLong(z.from) }}</span>
            <button class="link-btn" @click="egaliserZone(z.index)">à parts égales</button>
          </div>

          <!-- La barre : chaque segment est une part, largeur proportionnelle -->
          <div class="bar">
            <span
              v-for="(k, i) in z.goals"
              :key="k"
              class="bar-seg"
              :style="{ width: pourcent(z.index, k) + '%', opacity: 1 - i * 0.22 }"
              :title="nomObjectif(k) + ' — ' + pourcent(z.index, k) + ' %'"
            />
          </div>

          <div class="zone-goals">
            <label v-for="k in z.goals" :key="k" class="zone-goal">
              <span class="zg-name">{{ nomObjectif(k) }}</span>
              <input
                type="range" min="0" max="100" step="1" class="zg-range"
                :value="pourcent(z.index, k)"
                @input="reglerPourcent(z.index, k, $event.target.value)"
              />
              <span class="zg-pct num">{{ pourcent(z.index, k) }} %</span>
              <span class="zg-eur num">{{ fmt(round2(capacite * pourcent(z.index, k) / 100)) }}</span>
            </label>
          </div>
        </div>
      </div>
      <p class="sec-note">
        Déplacer un curseur reprend aux autres ce qu'il donne : une zone fait toujours 100 %.
      </p>
    </section>

    <!-- ─── 4. Répartition mois par mois ──────────────── -->
    <section v-if="plan && plan.rows.length" class="panel">
      <div class="sec-head">
        <h2 class="sec-title">Mois par mois</h2>
        <span class="sec-hint">
          {{ plan.rows.length }} mois
          <template v-if="nbVerrous">
            · {{ nbVerrous }} cellule{{ nbVerrous > 1 ? 's' : '' }} figée{{ nbVerrous > 1 ? 's' : '' }}
            <button class="link-btn" @click="toutDeverrouiller">tout libérer</button>
          </template>
        </span>
      </div>

      <p v-for="(w, i) in plan.warnings" :key="i" class="warn">{{ w }}</p>

      <!-- Bilan par objectif -->
      <div class="recap">
        <div v-for="g in plan.goals" :key="g.key" class="recap-item">
          <span class="recap-name">{{ g.name }}</span>
          <span class="num recap-val">{{ fmt(g.paid) }}<template v-if="g.target"> / {{ fmt(g.target) }}</template></span>
          <span v-if="g.target === null" class="recap-when">sans fin</span>
          <span v-else-if="g.reached" class="recap-when is-credit">atteint {{ moisLong(g.reached) }}</span>
          <span v-else class="recap-when is-over">il manque {{ fmt(g.shortfall) }}</span>
        </div>
      </div>

      <div class="table-wrap">
        <table class="plan-table">
          <thead>
            <tr>
              <th class="th-mois">mois</th>
              <th v-for="g in plan.goals" :key="g.key">{{ g.name }}</th>
              <th class="th-total">total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in plan.rows" :key="r.period">
              <td class="td-mois">{{ moisCourt(r.period) }}</td>
              <td v-for="g in plan.goals" :key="g.key" class="td-cell" :class="{ 'is-locked': estVerrouille(r.period, g.key) }">
                <input
                  class="cell-input num"
                  :value="r.cells[g.key] ?? ''"
                  placeholder="—"
                  @change="verrouiller(r.period, g.key, $event.target.value)"
                />
                <button
                  v-if="estVerrouille(r.period, g.key)"
                  class="cell-unlock"
                  title="Rendre cette cellule au calcul"
                  @click="deverrouiller(r.period, g.key)"
                >×</button>
              </td>
              <td class="num td-total">{{ fmt(r.total) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="td-mois">Total</td>
              <td v-for="g in plan.goals" :key="g.key" class="num td-foot">{{ fmt(g.paid) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="table-note">
        Modifiez une cellule pour la figer : le calcul redistribue tout le reste autour d'elle.
      </p>
    </section>

    <p v-else class="panel empty">
      Renseignez vos revenus, vos charges et au moins un objectif avec sa part mensuelle : la répartition s'affichera ici.
    </p>
  </div>
</template>

<style scoped>
.plan-head { display: flex; align-items: flex-start; gap: var(--s-5); }
.plan-title { font-size: var(--t-section-n); font-weight: 600; color: var(--c-ink); }
.plan-sub { font-size: var(--t-small); color: var(--c-ink-3); margin-top: var(--s-1); max-width: 70ch; line-height: 1.5; }
.plan-head .btn-secondary { margin-left: auto; flex-shrink: 0; }

.panel { padding: var(--s-5); }
.sec-head { display: flex; align-items: baseline; gap: var(--s-4); margin-bottom: var(--s-4); }
.sec-title { font-size: var(--t-section); font-weight: 600; color: var(--c-ink); }
.sec-hint { font-size: var(--t-meta); color: var(--c-ink-3); margin-left: auto; display: flex; align-items: center; gap: var(--s-2); }
.sec-hint.start { gap: var(--s-2); }

.rows { display: flex; flex-direction: column; gap: var(--s-2); }
.row { display: flex; align-items: center; gap: var(--s-3); position: relative; flex-wrap: wrap; }
.row .grow { flex: 1 1 200px; }
.num-input { width: 110px; text-align: right; }
.row-tools { display: flex; align-items: center; gap: var(--s-2); margin-left: auto; }
.row-note { flex-basis: 100%; font-size: var(--t-meta); color: var(--c-ink-3); margin-left: 2px; }

/* Menu d'import : la liste des moyennes réelles */
.imp {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 30; width: 340px;
  background: var(--c-surface); border: 1px solid var(--c-line-strong);
  border-radius: var(--r-container); box-shadow: var(--shadow-overlay); padding: var(--s-3);
}
/* Voile transparent : un clic n'importe où ailleurs referme le menu */
.imp-veil { position: fixed; inset: 0; z-index: 25; }
.imp-head { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-2); }
.imp-search { flex: 1; }
.imp-list { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; }
.imp-item {
  display: grid; grid-template-columns: 1fr auto auto; gap: var(--s-3); align-items: center;
  padding: var(--s-2); border-radius: var(--r-control); font-size: 13px; text-align: left; cursor: pointer;
}
.imp-item:hover { background: var(--c-surface-hover); }
.imp-name { color: var(--c-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imp-src { font-size: var(--t-meta); color: var(--c-ink-3); }
.imp-avg { color: var(--c-ink-2); font-weight: 500; }
.imp-empty { font-size: var(--t-small); color: var(--c-ink-3); padding: var(--s-2); }

.totaux { display: flex; flex-wrap: wrap; gap: var(--s-6); margin-top: var(--s-4); padding-top: var(--s-3); border-top: 1px solid var(--c-line); font-size: var(--t-small); color: var(--c-ink-3); }
.totaux b { color: var(--c-ink); }
.totaux-final { display: flex; align-items: center; gap: var(--s-2); margin-left: auto; }

.goals-head, .goal-row {
  display: grid;
  grid-template-columns: 44px minmax(120px, 1.4fr) 130px 110px 110px 130px 24px;
  gap: var(--s-3); align-items: center;
}
.goals-head { font-size: var(--t-meta); color: var(--c-ink-3); padding-bottom: var(--s-2); }
.goal-row { padding: var(--s-1) 0; }
.goal-rank { display: flex; gap: 2px; }
.goal-share { display: flex; align-items: center; gap: var(--s-2); }

.warn { font-size: var(--t-small); color: var(--c-warn); margin-bottom: var(--s-2); }

.recap { display: flex; flex-wrap: wrap; gap: var(--s-5); margin-bottom: var(--s-4); }
.recap-item { display: flex; align-items: baseline; gap: var(--s-2); font-size: var(--t-small); }
.recap-name { font-weight: 600; color: var(--c-ink); }
.recap-val { color: var(--c-ink-2); }
.recap-when { font-size: var(--t-meta); color: var(--c-ink-3); }

/* Les zones : une barre segmentée, puis un curseur par objectif */
.zones { display: flex; flex-direction: column; gap: var(--s-6); }
.zone { display: flex; flex-direction: column; gap: var(--s-3); }
.zone-head { display: flex; align-items: baseline; gap: var(--s-3); }
.zone-num { font-size: var(--t-small); font-weight: 600; color: var(--c-ink); }
.zone-from { font-size: var(--t-meta); color: var(--c-ink-3); }
.zone-head .link-btn { margin-left: auto; }

.bar { display: flex; height: 10px; border-radius: var(--r-pill); overflow: hidden; background: var(--c-track); }
.bar-seg { background: var(--c-accent); transition: width var(--dur-base) var(--ease); }

.zone-goals { display: flex; flex-direction: column; gap: var(--s-2); }
.zone-goal { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(140px, 2fr) 56px 92px; gap: var(--s-3); align-items: center; font-size: var(--t-small); }
.zg-name { color: var(--c-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zg-range { width: 100%; accent-color: var(--c-accent); cursor: pointer; }
.zg-pct { text-align: right; color: var(--c-ink-2); }
.zg-eur { text-align: right; color: var(--c-ink-3); }

.sec-note { font-size: var(--t-meta); color: var(--c-ink-3); margin-top: var(--s-3); }
.cap-input { width: 120px; }

.table-wrap { overflow-x: auto; }
.plan-table { width: 100%; border-collapse: collapse; font-size: var(--t-small); }
.plan-table th { font-weight: 500; color: var(--c-ink-3); font-size: var(--t-meta); text-align: right; padding: var(--s-2) var(--s-3); border-bottom: 1px solid var(--c-line); }
.plan-table th.th-mois { text-align: left; }
.plan-table td { padding: 0 var(--s-2); border-bottom: 1px solid var(--c-line); }
.td-mois { color: var(--c-ink-2); white-space: nowrap; padding-left: var(--s-3) !important; }
.td-cell { position: relative; }
.cell-input {
  width: 100%; min-width: 78px; padding: 5px var(--s-2); text-align: right;
  background: transparent; border: 1px solid transparent; border-radius: var(--r-control);
  color: var(--c-ink); font-size: var(--t-small); outline: none; font-family: var(--font-ui);
}
.cell-input:hover { border-color: var(--c-line); }
.cell-input:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.td-cell.is-locked .cell-input { background: var(--c-accent-soft); color: var(--c-accent); font-weight: 600; }
.cell-unlock {
  position: absolute; top: 50%; right: 2px; transform: translateY(-50%);
  width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--r-pill); color: var(--c-accent); font-size: 11px; cursor: pointer;
}
.cell-unlock:hover { background: var(--c-over-soft); color: var(--c-over); }
.td-total, .td-foot { text-align: right; color: var(--c-ink); font-weight: 500; padding-right: var(--s-3) !important; white-space: nowrap; }
.plan-table tfoot td { border-bottom: none; border-top: 1px solid var(--c-line-strong); padding-block: var(--s-2); font-weight: 600; }
.table-note { font-size: var(--t-meta); color: var(--c-ink-3); margin-top: var(--s-3); }

.empty { font-size: var(--t-small); color: var(--c-ink-3); text-align: center; padding: var(--s-8); }

/* ─── Classes communes (mêmes définitions que les autres vues) ─── */
.btn-discret { margin-top: var(--s-3); }
.btn-discret:hover { text-decoration: underline; }
.link-btn { font-size: var(--t-meta); color: var(--c-accent); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.link-btn:disabled { opacity: 0.4; cursor: default; text-decoration: none; }
.chip-remove {
  width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--r-control); color: var(--c-ink-3); font-size: 12px; cursor: pointer;
}
.chip-remove:hover { background: var(--c-over-soft); color: var(--c-over); }
.chip-remove:disabled { opacity: 0.3; cursor: default; }
</style>
