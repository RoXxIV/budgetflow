/**
 * Évaluateur arithmétique à périmètre fermé pour les calculateurs.
 * Accepte : nombres (virgule ou point), symboles, + − × ÷ * /, parenthèses, moins unaire.
 * Refuse tout le reste (pas de fonctions, pas d'accès aux données du budget). Jamais d'eval.
 *
 *   evaluate("(hp × prixHP + hc × prixHC) × (1 + tva / 100) + abo", { hp: 282, ... }) → 86.3
 */

const SYMBOL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidSymbol(s) {
  return SYMBOL_RE.test(s || "");
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.,]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.,]/.test(src[j])) j++;
      const raw = src.slice(i, j).replace(",", ".");
      const value = Number(raw);
      if (Number.isNaN(value)) throw new Error(`Nombre invalide : « ${src.slice(i, j)} »`);
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ type: "sym", name: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/()".includes(c)) { tokens.push({ type: "op", op: c }); i++; continue; }
    if (c === "×") { tokens.push({ type: "op", op: "*" }); i++; continue; }
    if (c === "÷") { tokens.push({ type: "op", op: "/" }); i++; continue; }
    if (c === "−") { tokens.push({ type: "op", op: "-" }); i++; continue; }
    throw new Error(`Caractère non autorisé : « ${c} »`);
  }
  return tokens;
}

// Analyse récursive : expr → term (('+'|'-') term)* ; term → factor (('*'|'/') factor)* ; factor → '-'? (num | sym | '(' expr ')')
function parse(tokens, vars) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function factor() {
    const t = next();
    if (!t) throw new Error("Expression incomplète");
    if (t.type === "op" && t.op === "-") return -factor();
    if (t.type === "num") return t.value;
    if (t.type === "sym") {
      if (!(t.name in vars)) {
        const known = Object.keys(vars);
        const hint = known.find((k) => k.toLowerCase() === t.name.toLowerCase());
        throw new Error(`Symbole inconnu : « ${t.name} »${hint ? ` — vouliez-vous « ${hint} » ?` : ""}`);
      }
      const v = vars[t.name];
      if (v === null || v === undefined || Number.isNaN(v)) throw new Error(`« ${t.name} » n'a pas de valeur`);
      return v;
    }
    if (t.type === "op" && t.op === "(") {
      const v = expr();
      const close = next();
      if (!close || close.op !== ")") throw new Error("Parenthèse fermante manquante");
      return v;
    }
    throw new Error(`Élément inattendu : « ${t.op ?? t.name ?? t.value} »`);
  }

  function term() {
    let v = factor();
    while (peek() && peek().type === "op" && (peek().op === "*" || peek().op === "/")) {
      const op = next().op;
      const r = factor();
      if (op === "/" && r === 0) throw new Error("Division par zéro");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function expr() {
    let v = term();
    while (peek() && peek().type === "op" && (peek().op === "+" || peek().op === "-")) {
      const op = next().op;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const result = expr();
  if (pos < tokens.length) throw new Error(`Élément inattendu après la fin : « ${tokens[pos].op ?? tokens[pos].name ?? tokens[pos].value} »`);
  return result;
}

// Retourne un nombre, lève une Error lisible sinon
export function evaluate(formula, vars = {}) {
  const src = (formula || "").trim();
  if (!src) throw new Error("Formule vide");
  const tokens = tokenize(src);
  const value = parse(tokens, vars);
  if (!Number.isFinite(value)) throw new Error("Résultat non calculable");
  return value;
}

// Symboles utilisés par une formule (pour l'éditeur)
export function symbolsOf(formula) {
  try {
    return [...new Set(tokenize(formula || "").filter((t) => t.type === "sym").map((t) => t.name))];
  } catch {
    return [];
  }
}
