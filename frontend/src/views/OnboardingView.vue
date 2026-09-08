<script setup>
// Flux de première utilisation — s'impose tant que le guide n'a pas été mené à son terme.
// L'ordre des étapes n'est pas cosmétique, il est imposé par le code :
//   compte     → un mois exige un compte actif (month.service : 409 sinon)
//   catégories → sans elles, la page Template n'affiche aucun registre
//   thèmes     → facultatifs, mais c'est le moment de les poser : ils étiquettent les lignes
//   template   → dernière étape ; le guide ne crée aucun mois, il rend la main sur la page Mois
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getOnboarding, completeOnboarding } from '@/api/settings.js'
import { getAccounts, createAccount, deleteAccount } from '@/api/accounts.js'
import { getCategories, createCategory, deleteCategory } from '@/api/categories.js'
import { getThemes, createTheme, deleteTheme } from '@/api/themes.js'
import { getTemplateLines, deleteTemplateLine } from '@/api/template.js'
import { CATEGORY_PRESETS, CATEGORY_TYPES } from '@/lib/categories.js'
import { THEME_PRESETS } from '@/lib/themes.js'
import { refreshOnboarding } from '@/lib/onboarding.js'
import { eur } from '@/lib/format.js'
import { importData } from '@/api/data.js'
import AppSpinner from '@/components/AppSpinner.vue'
import { confirmDialog, apiError } from '@/composables/useDialog.js'

const router = useRouter()
const route = useRoute()
const fmt = (v) => eur(v)

const STEPS = [
  { key: 'compte', label: 'Compte' },
  { key: 'categories', label: 'Catégories' },
  { key: 'themes', label: 'Thèmes' },
  { key: 'template', label: 'Template' },
]

const stepIndex = ref(0)
const ready = ref(false)
const busy = ref(false)
const error = ref('')

// ─── Reprendre une sauvegarde ────────────────────────────
// Pendant le guide, la navigation est masquée et le routeur ramène toujours ici : les
// Paramètres — donc l'import — sont hors d'atteinte. Sans cette porte, quelqu'un qui
// réinstalle avec sa sauvegarde sous le bras n'aurait aucun moyen de la charger, et
// devrait tout ressaisir avant de pouvoir la restaurer.
const fileInput = ref(null)
const importing = ref(false)

const accounts = ref([])
const categories = ref([])
const themes = ref([])
const templateLines = ref([])

// Sens de l'animation : +1 en avançant, -1 en revenant (le contenu glisse dans ce sens)
const direction = ref(1)

// L'étape la plus avancée atteinte : revenir en arrière ne doit pas effacer la
// progression du fil, ni obliger à retraverser les étapes déjà faites pour revenir.
const maxStep = ref(0)
const progress = computed(() => (maxStep.value / (STEPS.length - 1)) * 100)

// ─── Reprise : l'avancement vient de l'état réel de la base ───
onMounted(async () => {
  try {
    const { data } = await getOnboarding()
    if (!data.needsOnboarding) { router.replace('/mois'); return }
    // Le retour depuis le Template impose son étape : l'état déduit pourrait viser
    // ailleurs et l'utilisateur ne reverrait jamais ce qu'il vient de construire.
    const reached = Math.max(0, STEPS.findIndex((s) => s.key === data.step))
    const asked = STEPS.findIndex((s) => s.key === route.query.etape)
    stepIndex.value = asked >= 0 ? asked : reached
    maxStep.value = Math.max(reached, stepIndex.value)
    await refresh()
  } catch (e) {
    error.value = e.response?.data?.message || e.message
  }
  ready.value = true
})

/** Relit tout ce que le guide affiche : comptes, catégories, thèmes, Template. */
async function refresh() {
  const [acc, cat, th, tpl] = await Promise.all([getAccounts(), getCategories(), getThemes(), getTemplateLines()])
  accounts.value = acc.data
  categories.value = cat.data
  themes.value = th.data
  templateLines.value = tpl.data
}

/**
 * Va à une étape, et oriente l'animation dans le sens du déplacement.
 *
 * `maxStep` ne redescend jamais : revenir en arrière ne doit ni vider la barre de
 * progression, ni verrouiller les étapes déjà franchies.
 *
 * @param {number} index L'étape visée, indice dans STEPS.
 */
async function goTo(index) {
  direction.value = index > stepIndex.value ? 1 : -1
  stepIndex.value = index
  maxStep.value = Math.max(maxStep.value, index)
  await nextTick()
}

// ─── Étape 1 : les comptes ─────────────────────────────────
const ACCOUNT_TYPES = [
  { value: 'courant', label: 'Courant' },
  { value: 'epargne', label: 'Épargne' },
  { value: 'investissement', label: 'Investissement' },
]
const accountForm = ref({ name: '', type: 'courant' })
const accountTypeLabel = (type) => ACCOUNT_TYPES.find((t) => t.value === type)?.label || type

/**
 * Restaure une sauvegarde au lieu de repartir de zéro.
 *
 * Le rechargement complet qui suit n'est pas une commodité : l'état du guide se
 * déduit du contenu de la base et se relit au démarrage. C'est lui qui fait sortir
 * d'ici vers l'application, une fois les données en place.
 *
 * @param {Event} event Le change du champ fichier.
 */
async function importerSauvegarde(event) {
  const fichier = event.target.files?.[0]
  event.target.value = '' // sans ça, resélectionner le même fichier ne déclencherait rien
  if (!fichier) return

  const ok = await confirmDialog({
    title: 'Restaurer une sauvegarde ?',
    message: `« ${fichier.name} » va remplacer le contenu actuel de l'application.\n\nL'état présent est archivé sur ton disque avant le remplacement.`,
    confirmLabel: 'Restaurer',
  })
  if (!ok) return

  importing.value = true
  try {
    await importData(fichier)
    window.location.reload()
  } catch (e) {
    apiError(e)
    importing.value = false
  }
}

/**
 * Ajoute un compte à la liste de l'étape 1.
 *
 * @returns {Promise<boolean>} true si la création a abouti — « Continuer » s'en sert
 *   pour ne pas avancer sur un échec.
 */
async function addAccount() {
  const f = accountForm.value
  if (!f.name.trim() || busy.value) return
  busy.value = true
  try {
    // Pas de solde ici : il se saisit une seule fois, à la création du premier mois
    await createAccount({ name: f.name.trim(), type: f.type })
    await refresh()
    accountForm.value = { name: '', type: 'courant' }
    return true
  } catch (e) { apiError(e); return false } finally { busy.value = false }
}

// « Continuer » ne laisse jamais une saisie en plan : ce qui est tapé dans le champ
// est ajouté avant de passer à la suite. Sans cela, un nom saisi mais non ajouté
// laissait le bouton grisé sans explication.
/** Ajoute le compte en cours de saisie, puis passe aux catégories. */
async function continueFromAccounts() {
  if (accountForm.value.name.trim() && !(await addAccount())) return
  if (accounts.value.length) await goTo(1)
}

/**
 * Retire un compte de la liste.
 *
 * Un compte épargne porte déjà une enveloppe créée d'office : le serveur refuse alors
 * sa suppression (« jamais de perte ») et son message dit quoi faire.
 *
 * @param {object} account Le compte à retirer.
 */
async function removeAccount(account) {
  if (busy.value) return
  busy.value = true
  try {
    // Un compte épargne porte déjà une enveloppe : le serveur refuse alors la suppression
    // (« jamais de perte ») et son message dit quoi faire.
    await deleteAccount(account.id)
    await refresh()
  } catch (e) { apiError(e) } finally { busy.value = false }
}

// ─── Étape 2 : les catégories ──────────────────────────────
const categoryForm = ref({ name: '', type: 'depense' })
const presetsUsed = computed(() =>
  CATEGORY_PRESETS.every((p) => categories.value.some((c) => c.name.toLowerCase() === p.name.toLowerCase()))
)

/**
 * Crée les catégories proposées, en sautant celles qui existent déjà.
 *
 * Le contrôle par nom permet de cliquer le lien après en avoir ajouté à la main, sans
 * récolter de doublon ni d'erreur d'unicité.
 */
async function applyPresets() {
  if (busy.value) return
  busy.value = true
  try {
    for (const p of CATEGORY_PRESETS) {
      if (categories.value.some((c) => c.name.toLowerCase() === p.name.toLowerCase())) continue
      await createCategory(p)
    }
    await refresh()
  } catch (e) { apiError(e) } finally { busy.value = false }
}

/**
 * Ajoute une catégorie.
 *
 * @returns {Promise<boolean>} true si la création a abouti.
 */
async function addCategory() {
  const f = categoryForm.value
  if (!f.name.trim() || busy.value) return
  busy.value = true
  try {
    await createCategory({ name: f.name.trim(), type: f.type })
    await refresh()
    categoryForm.value = { name: '', type: 'depense' }
    return true
  } catch (e) { apiError(e); return false } finally { busy.value = false }
}

/** Ajoute la catégorie en cours de saisie, puis passe aux thèmes. */
async function continueFromCategories() {
  if (categoryForm.value.name.trim() && !(await addCategory())) return
  if (categories.value.length) await goTo(2)
}

/**
 * Retire une catégorie.
 *
 * Refusé par le serveur si elle sert déjà à une ligne du Template — son message
 * explique alors ce qui l'utilise.
 *
 * @param {object} category La catégorie à retirer.
 */
async function removeCategory(category) {
  if (busy.value) return
  busy.value = true
  try {
    await deleteCategory(category.id)
    await refresh()
  } catch (e) { apiError(e) } finally { busy.value = false }
}

// ─── Étape 3 : les thèmes ──────────────────────────────────
const themeName = ref('')
const themePresetsUsed = computed(() =>
  THEME_PRESETS.every((name) => themes.value.some((t) => t.name.toLowerCase() === name.toLowerCase()))
)

/** Crée les thèmes proposés, en sautant ceux qui existent déjà. */
async function applyThemePresets() {
  if (busy.value) return
  busy.value = true
  try {
    for (const name of THEME_PRESETS) {
      if (themes.value.some((t) => t.name.toLowerCase() === name.toLowerCase())) continue
      await createTheme({ name })
    }
    await refresh()
  } catch (e) { apiError(e) } finally { busy.value = false }
}

/**
 * Ajoute un thème.
 *
 * @returns {Promise<boolean>} true si la création a abouti.
 */
async function addTheme() {
  if (!themeName.value.trim() || busy.value) return
  busy.value = true
  try {
    await createTheme({ name: themeName.value.trim() })
    await refresh()
    themeName.value = ''
    return true
  } catch (e) { apiError(e); return false } finally { busy.value = false }
}

/** Ajoute le thème en cours de saisie, puis passe au Template (étape facultative). */
async function continueFromThemes() {
  if (themeName.value.trim() && !(await addTheme())) return
  await goTo(3)
}

/**
 * Retire un thème.
 *
 * @param {object} theme Le thème à retirer.
 */
async function removeTheme(theme) {
  if (busy.value) return
  busy.value = true
  try {
    await deleteTheme(theme.id)
    await refresh()
  } catch (e) { apiError(e) } finally { busy.value = false }
}

// ─── Étape 4 : le Template ──────────────────────────────
// La saisie se fait dans la vraie page Template, avec toutes ses options (jour de
// prélèvement, périodicité, compte, cagnotte…) : la dupliquer ici n'en donnerait
// qu'une version appauvrie. Le guide y envoie, le bouton Terminer ramène.
/**
 * Retire une ligne du Template depuis le guide.
 *
 * @param {object} line La ligne à retirer.
 */
async function removeTemplateLine(line) {
  if (busy.value) return
  busy.value = true
  try {
    await deleteTemplateLine(line.id)
    await refresh()
  } catch (e) { apiError(e) } finally { busy.value = false }
}

// Une ligne peut n'avoir aucune catégorie : elle se range alors dans « Sans catégorie »
const categoryName = (id) => categories.value.find((c) => c.id === id)?.name || 'Sans catégorie'

// Le type de la catégorie pilote, comme dans la page Template : additionner un revenu
// et une dépense donnerait un nombre qui ne veut rien dire.
const templateTotals = computed(() => {
  const byType = { depense: 0, revenu: 0, epargne: 0, transfert: 0 }
  for (const l of templateLines.value) {
    const type = categories.value.find((c) => c.id === l.categoryId)?.type || 'depense'
    byType[type] += l.plannedAmount || 0
  }
  return { ...byType, reste: byType.revenu - byType.depense - byType.epargne - byType.transfert }
})

// ─── Fin du guide : aucun mois créé, on rend la main sur la page Mois ───
/**
 * Clôt le guide et rend la main à la visite guidée, qui démarre sur les Comptes.
 *
 * Le drapeau serveur est indispensable : le guide ne crée aucun mois, donc rien
 * d'autre en base ne signerait sa fin. `refreshOnboarding` republie l'état pour que
 * le routeur et la barre d'application le voient tout de suite.
 */
async function finish() {
  if (busy.value) return
  busy.value = true
  try {
    await completeOnboarding()
    await refreshOnboarding()
    // La visite guidée démarre sur les Comptes et se terminera sur les Mois
    router.replace('/comptes')
  } catch (e) { apiError(e); busy.value = false }
}
</script>

<template>
  <div class="onb">
    <div v-if="ready" class="onb-card">
      <!-- ─── Fil des étapes ─────────────────────────── -->
      <div class="stepper" role="group" aria-label="Progression de la configuration">
        <div class="stepper-track"><span class="stepper-fill" :style="{ width: progress + '%' }" /></div>
        <div class="stepper-dots">
          <div
            v-for="(s, i) in STEPS"
            :key="s.key"
            class="stepper-step"
            :class="{ 'is-done': i !== stepIndex && i <= maxStep, 'is-current': i === stepIndex }"
          >
            <button
              class="stepper-dot"
              :disabled="i > maxStep"
              :aria-current="i === stepIndex ? 'step' : undefined"
              :title="i !== stepIndex && i <= maxStep ? 'Aller à cette étape' : s.label"
              @click="i !== stepIndex && i <= maxStep && goTo(i)"
            />
            <span class="stepper-label">{{ s.label }}</span>
          </div>
        </div>
      </div>

      <p v-if="error" class="onb-error">{{ error }}</p>

      <!-- ─── Contenu de l'étape ─────────────────────── -->
      <Transition :name="direction > 0 ? 'step-next' : 'step-prev'" mode="out-in">
        <!-- Étape 1 : comptes -->
        <section v-if="stepIndex === 0" key="compte" class="onb-step">
          <h1 class="onb-title">Un peu d'organisation, plus de tranquillité.</h1>
          <p class="onb-lead">Commençons par ajouter le compte que tu utilises au quotidien.</p>

          <div v-if="accounts.length" class="tpl-list">
            <div v-for="a in accounts" :key="a.id" class="tpl-item acc-item">
              <span class="tpl-label">
                {{ a.name }}<span v-if="a.isMain" class="tag-main">principal</span>
              </span>
              <span class="tpl-cat">{{ accountTypeLabel(a.type) }}</span>
              <button class="chip-remove tpl-remove" :disabled="busy" :title="'Retirer « ' + a.name + ' »'" @click="removeAccount(a)">×</button>
            </div>
          </div>

          <div class="onb-form onb-form-inline">
            <label class="field grow">
              <span>Nom du compte</span>
              <input v-model="accountForm.name" type="text" class="input" placeholder="Ex. : Mon compte courant" @keyup.enter="addAccount" />
            </label>
            <label class="field">
              <span>Type de compte</span>
              <select v-model="accountForm.type" class="input">
                <option v-for="t in ACCOUNT_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </label>
            <button class="btn-secondary" :disabled="!accountForm.name.trim() || busy" @click="addAccount">Ajouter</button>
          </div>
          <p class="onb-hint">
            Livret, compte joint, épargne : ajoute-les tous ici. Leurs soldes te seront demandés à la création de ton premier mois.
          </p>

          <div class="onb-actions">
            <button class="btn-primary" :disabled="(!accounts.length && !accountForm.name.trim()) || busy" @click="continueFromAccounts">Continuer</button>
          </div>
          <p class="onb-note">Le premier compte ajouté est ton compte principal. Tu pourras en ajouter d'autres par la suite.</p>
        </section>

        <!-- Étape 2 : catégories -->
        <section v-else-if="stepIndex === 1" key="categories" class="onb-step">
          <h1 class="onb-title">Chaque chose à sa place</h1>
          <p class="onb-lead">
            Courses, logement, salaire… Les catégories t'aident à y voir clair dans tes dépenses et tes revenus.
          </p>

          <div v-if="categories.length" class="chips">
            <span v-for="c in categories" :key="c.id" class="chip">
              <span class="chip-dot" :style="{ background: c.color }" />{{ c.name }}
              <button class="chip-remove" :disabled="busy" :title="'Retirer « ' + c.name + ' »'" @click="removeCategory(c)">×</button>
            </span>
          </div>

          <div class="onb-form onb-form-inline">
            <label class="field grow">
              <span>Ajouter une catégorie</span>
              <input v-model="categoryForm.name" type="text" class="input" placeholder="Ex. : Courses, Loisirs, Salaire…" @keyup.enter="addCategory" />
            </label>
            <label class="field">
              <span>Type de catégorie</span>
              <select v-model="categoryForm.type" class="input">
                <option v-for="t in CATEGORY_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </label>
            <button class="btn-secondary" :disabled="!categoryForm.name.trim() || busy" @click="addCategory">Ajouter</button>
          </div>

          <p v-if="!presetsUsed" class="onb-hint">
            Besoin d'un point de départ ?
            <button class="link-btn" :disabled="busy" @click="applyPresets">Utiliser les catégories proposées</button>
          </p>

          <div class="onb-actions">
            <button class="btn-secondary" @click="goTo(0)">Retour</button>
            <button class="btn-primary" :disabled="(!categories.length && !categoryForm.name.trim()) || busy" @click="continueFromCategories">Continuer</button>
          </div>
          <p class="onb-note">Tu pourras les renommer, en ajouter ou en supprimer à tout moment.</p>
        </section>

        <!-- Étape 3 : thèmes -->
        <section v-else-if="stepIndex === 2" key="themes" class="onb-step">
          <h1 class="onb-title">Tes projets, en un coup d'œil</h1>
          <p class="onb-lead">
            Transport, hébergement, restaurants… Avec un thème « Vacances », retrouve toutes les dépenses
            de ton voyage, même si elles sont dans des catégories différentes.
          </p>

          <div v-if="themes.length" class="chips">
            <span v-for="t in themes" :key="t.id" class="chip">
              {{ t.name }}
              <button class="chip-remove" :disabled="busy" :title="'Retirer « ' + t.name + ' »'" @click="removeTheme(t)">×</button>
            </span>
          </div>

          <div class="onb-form onb-form-inline">
            <label class="field grow">
              <span>Ajouter un thème</span>
              <input v-model="themeName" type="text" class="input" placeholder="Ex. : Vacances, Maison, Voiture…" @keyup.enter="addTheme" />
            </label>
            <button class="btn-secondary" :disabled="!themeName.trim() || busy" @click="addTheme">Ajouter</button>
          </div>
          <p v-if="!themePresetsUsed" class="onb-hint">
            Besoin d'inspiration ?
            <button class="link-btn" :disabled="busy" @click="applyThemePresets">Utiliser les thèmes proposés</button>
          </p>
          <p v-if="!themes.length" class="onb-note">
            Tu peux passer cette étape et ajouter des thèmes quand tu en auras besoin.
          </p>

          <div class="onb-actions">
            <button class="btn-secondary" @click="goTo(1)">Retour</button>
            <button class="btn-primary" :disabled="busy" @click="continueFromThemes">
              {{ themes.length || themeName.trim() ? 'Continuer' : 'Passer cette étape' }}
            </button>
          </div>
        </section>

        <!-- Étape 4 : Template -->
        <section v-else key="template" class="onb-step">
          <h1 class="onb-title">Un peu de préparation, du temps gagné</h1>
          <p class="onb-lead">
            Loyer, salaire, abonnements… Ajoute les dépenses et les revenus qui reviennent chaque mois.
            Tu les retrouveras dans chaque nouveau budget, sans avoir à tout ressaisir.
          </p>

          <div v-if="templateLines.length" class="tpl-list">
            <div v-for="l in templateLines" :key="l.id" class="tpl-item">
              <span class="tpl-label">{{ l.label }}</span>
              <span class="tpl-cat">{{ categoryName(l.categoryId) }}</span>
              <span class="num tpl-amount">{{ fmt(l.plannedAmount) }}</span>
              <button class="chip-remove tpl-remove" :disabled="busy" :title="'Retirer « ' + l.label + ' »'" @click="removeTemplateLine(l)">×</button>
            </div>
            <div class="tpl-item tpl-total">
              <span class="tpl-label">{{ templateLines.length }} ligne{{ templateLines.length > 1 ? 's' : '' }}</span>
              <span class="tpl-sums">
                <span v-if="templateTotals.revenu">Revenus <b class="num">{{ fmt(templateTotals.revenu) }}</b></span>
                <span v-if="templateTotals.depense">Dépenses <b class="num">{{ fmt(templateTotals.depense) }}</b></span>
                <span v-if="templateTotals.epargne">Épargne <b class="num">{{ fmt(templateTotals.epargne) }}</b></span>
                <span v-if="templateTotals.transfert">Transferts <b class="num">{{ fmt(templateTotals.transfert) }}</b></span>
              </span>
              <span class="num tpl-amount" :class="templateTotals.reste < 0 ? 'is-over' : 'is-credit'">{{ fmt(templateTotals.reste) }}</span>
              <span />
            </div>
          </div>

          <div class="onb-actions">
            <button
              :class="templateLines.length ? 'btn-secondary' : 'btn-primary'"
              @click="router.push('/template')"
            >
              {{ templateLines.length ? 'Compléter mon Template' : 'Construire mon Template' }}
            </button>
          </div>
          <p class="onb-hint">
            <template v-if="templateLines.length">Le jour de prélèvement, la périodicité et le compte se règlent là-bas.</template>
            <template v-else>Tu préfères commencer directement ? Tu pourras construire ton Template plus tard.</template>
          </p>

          <div class="onb-actions">
            <button class="btn-secondary" @click="goTo(2)">Retour</button>
            <button class="btn-primary" :disabled="busy" @click="finish">Terminer</button>
          </div>
          <p class="onb-note">On fait ensuite le tour de l'app en quelques écrans, puis tu créeras ton premier mois.</p>
        </section>
      </Transition>

      <!-- Reprendre une sauvegarde. Seulement à la première étape : plus loin, importer
           effacerait ce qui vient d'être configuré. -->
      <div v-if="stepIndex === 0" class="onb-restore">
        <input ref="fileInput" type="file" accept=".db,.sqlite,.sqlite3" class="onb-file" @change="importerSauvegarde" />
        <button class="onb-link" :disabled="importing" @click="fileInput?.click()">
          <AppSpinner v-if="importing" :size="12" />
          <template v-if="importing">Restauration en cours…</template>
          <template v-else>J'ai déjà une sauvegarde BudgetFlow — la restaurer</template>
        </button>
      </div>

      <!-- La restauration remplace toute la base, puis recharge : on couvre l'écran -->
      <AppSpinner v-if="importing" overlay :size="30" label="Restauration de ta sauvegarde…" />
    </div>
  </div>
</template>

<style scoped>
/* Plein écran, sans barre de navigation : rien d'autre à faire que la configuration */
.onb {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-7);
  background: var(--c-canvas);
}
.onb-card {
  width: 100%;
  max-width: 620px;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-container);
  padding: var(--s-8);
  animation: onb-card-in var(--dur-base) var(--ease);
}
@keyframes onb-card-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}

/* ─── Fil des étapes : la barre se remplit, le point actif s'allume ─── */
.stepper { position: relative; margin-bottom: var(--s-8); }
.stepper-track {
  position: absolute;
  top: 6px;
  left: 7px;
  right: 7px;
  height: 2px;
  background: var(--c-track);
  border-radius: var(--r-pill);
}
.stepper-fill {
  display: block;
  height: 100%;
  background: var(--c-accent);
  border-radius: var(--r-pill);
  transition: width 420ms var(--ease);
}
.stepper-dots { position: relative; display: flex; justify-content: space-between; }
.stepper-step { display: flex; flex-direction: column; align-items: center; gap: var(--s-2); }
.stepper-dot {
  width: 14px;
  height: 14px;
  border-radius: var(--r-pill);
  background: var(--c-surface);
  border: 2px solid var(--c-line-strong);
  padding: 0;
  cursor: default;
  transition: background-color var(--dur-base) var(--ease),
              border-color var(--dur-base) var(--ease),
              transform var(--dur-base) var(--ease);
}
.stepper-step.is-done .stepper-dot {
  background: var(--c-accent);
  border-color: var(--c-accent);
  cursor: pointer;
}
.stepper-step.is-current .stepper-dot {
  background: var(--c-accent);
  border-color: var(--c-accent);
  transform: scale(1.25);
  animation: dot-pulse 2s var(--ease) infinite;
}
/* Halo qui respire sur l'étape en cours — discret, jamais clignotant */
@keyframes dot-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--c-accent-ring); }
  50%      { box-shadow: 0 0 0 7px transparent; }
}
.stepper-label {
  font-size: var(--t-meta);
  color: var(--c-ink-3);
  transition: color var(--dur-base) var(--ease);
}
.stepper-step.is-current .stepper-label { color: var(--c-accent); font-weight: 600; }
.stepper-step.is-done .stepper-label { color: var(--c-ink-2); }

/* ─── Passage d'une étape à l'autre : glissement dans le sens de la marche ─── */
.step-next-enter-active, .step-next-leave-active,
.step-prev-enter-active, .step-prev-leave-active {
  transition: opacity var(--dur-base) var(--ease), transform var(--dur-base) var(--ease);
}
.step-next-enter-from { opacity: 0; transform: translateX(24px); }
.step-next-leave-to   { opacity: 0; transform: translateX(-24px); }
.step-prev-enter-from { opacity: 0; transform: translateX(-24px); }
.step-prev-leave-to   { opacity: 0; transform: translateX(24px); }

/* ─── Contenu ─── */
.onb-step { display: flex; flex-direction: column; gap: var(--s-4); }
.onb-title { font-size: var(--t-hero); font-weight: 600; color: var(--c-ink); letter-spacing: -0.02em; }
.onb-lead { font-size: var(--t-body); color: var(--c-ink-2); line-height: 1.55; }
.onb-form { display: flex; flex-wrap: wrap; gap: var(--s-4); }
.onb-form-inline { align-items: flex-end; }
.onb-form .field { min-width: 140px; }
.onb-form .field.grow { flex: 1 1 190px; }
.onb-hint { font-size: var(--t-small); color: var(--c-ink-3); font-weight: 400; }
.onb-note { font-size: var(--t-meta); color: var(--c-ink-3); }

/* Reprendre une sauvegarde : discret, sous l'étape, séparé par un filet */
.onb-restore { margin-top: var(--s-6); padding-top: var(--s-4); border-top: 1px solid var(--c-line); text-align: center; }
.onb-file { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.onb-link { display: inline-flex; align-items: center; gap: var(--s-2); font-size: var(--t-meta); color: var(--c-ink-3); cursor: pointer; transition: color var(--dur-fast) var(--ease); }
.onb-link:hover { color: var(--c-accent); }
.onb-link:disabled { opacity: 0.6; cursor: default; }
.onb-error { font-size: var(--t-small); color: var(--c-over); margin-bottom: var(--s-4); }
.onb-actions { display: flex; gap: var(--s-3); margin-top: var(--s-3); }
.link-btn {
  color: var(--c-accent);
  font-size: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.link-btn:disabled { opacity: 0.5; cursor: default; }

/* Pastilles : catégories et thèmes */
.chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.chip {
  display: inline-flex; align-items: center; gap: var(--s-2);
  padding: 3px var(--s-3);
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-line);
  border-radius: var(--r-pill);
  font-size: var(--t-tag);
  color: var(--c-ink-2);
  animation: item-in var(--dur-base) var(--ease);
}
@keyframes item-in {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: none; }
}
.chip-dot { width: 8px; height: 8px; border-radius: var(--r-pill); }
/* Croix révélée au survol — la place est réservée en permanence, la pastille ne saute pas */
.chip-remove {
  width: 14px; height: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: 1px;
  border-radius: var(--r-pill);
  color: var(--c-ink-3);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.chip:hover .chip-remove,
.tpl-item:hover .tpl-remove,
.chip-remove:focus-visible { opacity: 1; }
.chip-remove:hover { background: var(--c-over-soft); color: var(--c-over); }

/* Listes en registre : comptes et lignes du Template */
.tpl-list { display: flex; flex-direction: column; border: 1px solid var(--c-line); border-radius: var(--r-control); overflow: hidden; }
.tpl-item {
  display: grid;
  grid-template-columns: 1fr auto 100px 16px;
  gap: var(--s-4);
  align-items: center;
  padding: var(--s-3) var(--s-4);
  border-bottom: 1px solid var(--c-line);
  font-size: var(--t-body);
  animation: item-in var(--dur-base) var(--ease);
}
.tpl-item:last-child { border-bottom: none; }
.tpl-label { color: var(--c-ink); }
.tpl-cat { font-size: var(--t-meta); color: var(--c-ink-3); }
.tpl-amount { text-align: right; color: var(--c-ink); }
.tpl-total { background: var(--c-surface-sunken); font-weight: 600; }
.tpl-sums { display: flex; flex-wrap: wrap; gap: var(--s-4); font-size: var(--t-meta); font-weight: 400; color: var(--c-ink-3); }
.tpl-sums b { color: var(--c-ink-2); }
.is-credit { color: var(--c-credit); }
.is-over { color: var(--c-over); }
/* Les comptes n'affichent pas de montant : trois colonnes au lieu de quatre */
.acc-item { grid-template-columns: 1fr auto 16px; }
.tag-main {
  margin-left: var(--s-3);
  padding: 1px var(--s-2);
  background: var(--c-accent-soft);
  color: var(--c-accent);
  border-radius: var(--r-pill);
  font-size: var(--t-meta);
  font-weight: 500;
}

/* ─── Classes communes (mêmes définitions que les autres vues) ─── */
.field { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); }
.input { padding: 6px var(--s-3); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); font-size: 13px; color: var(--c-ink); background: var(--c-surface); outline: none; font-family: var(--font-ui); }
.input:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.btn-primary { height: 34px; padding: 0 var(--s-5); background: var(--c-accent); color: var(--c-on-accent); border-radius: var(--r-control); font-size: 13px; font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-primary:hover { background: var(--c-accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { height: 34px; padding: 0 var(--s-4); background: var(--c-surface); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); color: var(--c-ink); font-size: var(--t-small); font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-secondary:hover { background: var(--c-surface-hover); }
.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
