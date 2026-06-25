<script setup>
// Carte d'une catégorie de dépense (repliable). Toute la logique vit dans le parent
// (SheetView) et est passée via `ctx` pour éviter une multitude de props.
defineProps({
  group: { type: Object, required: true },
  ctx: { type: Object, required: true },
})
</script>

<template>
  <div class="glass-card overflow-hidden">
    <!-- En-tête (cliquable pour replier/déplier) -->
    <div
      class="flex items-center justify-between text-[13px] font-semibold text-gray-950 dark:text-gray-100 px-4 py-3 border-b border-gray-100 dark:border-gray-700 cursor-pointer select-none"
      @click="ctx.toggleSection(group.section._id)"
    >
      <span class="flex items-center gap-2">
        <span class="line-chevron">{{ ctx.isSectionOpen(group.section._id) ? '▼' : '▶' }}</span>
        <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: group.section.color }"></span>
        {{ group.section.name }}
        <span class="entry-count">{{ group.lines.length }}</span>
      </span>
      <button
        class="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 hover:bg-violet-100 dark:hover:bg-violet-950/50 border-none rounded-md py-1 px-2.5 cursor-pointer font-medium"
        @click.stop="ctx.openAddLineModal(group.section._id)"
      >
        <font-awesome-icon icon="plus" /> Ajouter
      </button>
    </div>

    <div class="lines-table">
      <transition name="expand">
        <div v-if="ctx.isSectionOpen(group.section._id)">
          <div class="lines-head has-date" :class="{ 'lines-row--no-planned': !group.hasPlanned }">
            <span>Description</span>
            <span class="col-date">Date</span>
            <span v-if="group.hasPlanned" class="col-r">Prévu</span>
            <span class="col-r">Réel</span>
            <span v-if="group.hasPlanned" class="col-r">Reste</span>
            <span class="col-flags">½</span>
            <span></span>
          </div>

          <div v-if="!group.lines.length" class="section-empty">Aucune ligne budgétaire</div>

          <div v-for="line in group.lines" :key="line._id" class="line-wrap">
            <div
              class="line-row has-date"
              :class="{ 'lines-row--no-planned': !group.hasPlanned }"
            >
              <span class="line-label">
                {{ line.label
                }}<template v-if="ctx.lineEntries(line).length === 1 && ctx.lineEntries(line)[0].details">
                  - {{ ctx.lineEntries(line)[0].details }}</template>
                <span
                  v-if="ctx.lineThemeBadge(line)"
                  class="theme-badge"
                  :style="{ background: ctx.lineThemeBadge(line).color + '22', color: ctx.lineThemeBadge(line).color }"
                >{{ ctx.lineThemeBadge(line).name }}</span>
                <span v-if="ctx.lineEntries(line).length >= 2" class="entry-count">{{ ctx.lineEntries(line).length }} entrées</span>
              </span>
              <span class="col-date line-date">{{ ctx.lineDate(line) ? ctx.fmtDate(ctx.lineDate(line)) : '—' }}</span>
              <span v-if="group.hasPlanned" class="col-r line-planned">{{ ctx.fmt(line.plannedAmount) }} €</span>
              <span class="col-r">
                <button
                  type="button"
                  class="actual-toggle"
                  :class="ctx.actualClass(line)"
                  @click.stop="ctx.toggleLineTx(line)"
                  title="Voir / ajouter les entrées"
                >
                  {{ ctx.fmt(line.actualAmount || 0) }} €
                  <span class="line-chevron">{{ ctx.isTxOpen(line) ? '▼' : '▶' }}</span>
                </button>
              </span>
              <span v-if="group.hasPlanned" class="col-r line-remaining" :class="ctx.remainingClass(line)">
                {{ ctx.fmt(ctx.remaining(line)) }} €
              </span>
              <span class="col-flags">
                <span v-if="ctx.lineHasShared(line)" class="flag-on">½</span>
              </span>
              <button class="btn-icon-action" @click.stop="ctx.openEditLineModal(line)" title="Modifier">
                <font-awesome-icon icon="pen" />
              </button>
            </div>

            <!-- Entrées de la ligne -->
            <transition name="expand">
              <div v-if="ctx.isTxOpen(line)" class="tx-panel" @click.stop>
                <div v-if="ctx.lineEntries(line).length" class="tx-list">
                  <div
                    v-for="t in ctx.lineEntries(line)"
                    :key="t._id"
                    class="tx-row tx-row--line"
                  >
                    <span class="tx-date">{{ ctx.fmtDate(t.date) }}</span>
                    <span class="tx-label">
                      {{ line.label }}<template v-if="t.details"> - {{ t.details }}</template>
                      <span
                        v-if="ctx.entryTheme(line, t)"
                        class="theme-badge"
                        :style="{ background: ctx.entryTheme(line, t).color + '22', color: ctx.entryTheme(line, t).color, marginLeft: '6px' }"
                      >{{ ctx.entryTheme(line, t).name }}</span>
                      <span v-if="t.isShared" class="flag-on" style="margin-left: 6px">½</span>
                    </span>
                    <span class="tx-amount tx-expense">{{ ctx.fmt(t.amount) }} €</span>
                    <button class="btn-tx-edit" @click.stop="ctx.openEditTxModal(line, t)" title="Modifier"><font-awesome-icon icon="pen" /></button>
                    <button class="btn-tx-del" @click.stop="ctx.deleteLineTx(line, t._id)" title="Supprimer">✕</button>
                  </div>
                </div>
                <p v-else class="tx-empty">Aucune entrée pour l'instant</p>

                <button class="btn-add-entry" @click.stop="ctx.openAddTxModal(line)">
                  <font-awesome-icon icon="plus" /> Ajouter une entrée
                </button>
              </div>
            </transition>
          </div>
        </div>
      </transition>

      <!-- Totaux (toujours visibles) -->
      <div
        v-if="group.lines.length"
        class="section-totals has-date dark:border-gray-700"
        :class="{ 'section-totals--no-planned': !group.hasPlanned }"
      >
        <span class="totals-label">Total</span>
        <span class="col-date"></span>
        <span v-if="group.hasPlanned" class="col-r totals-val">
          <span v-if="!ctx.isSectionOpen(group.section._id)" class="totals-cap">Prévu</span>
          {{ ctx.fmt(group.lines.reduce((s, l) => s + (l.plannedAmount || 0), 0)) }} €
        </span>
        <span class="col-r totals-val">
          <span v-if="!ctx.isSectionOpen(group.section._id)" class="totals-cap">Réel</span>
          {{ ctx.fmt(group.lines.reduce((s, l) => s + (l.actualAmount || 0), 0)) }} €
        </span>
        <span
          v-if="group.hasPlanned"
          class="col-r totals-val"
          :class="group.lines.reduce((s, l) => s + ctx.remaining(l), 0) >= 0 ? 'text-ok' : 'text-over'"
        >
          <span v-if="!ctx.isSectionOpen(group.section._id)" class="totals-cap">Reste</span>
          {{ ctx.fmt(group.lines.reduce((s, l) => s + ctx.remaining(l), 0)) }} €
        </span>
        <span class="col-flags"></span>
      </div>
    </div>
  </div>
</template>
