/**
 * Build pipeline: merges SCOWL, Hunspell, SUBTLEX-US, CMU, and WordNet
 * into a single unified dictionary JSON for the game.
 *
 * Inputs (all in data/):
 *   scowl-70.txt        — expanded word list (validation set)
 *   en_US-custom.dic    — Hunspell base words + affix flags
 *   en_US-custom.aff    — Hunspell affix rules
 *   subtlex-us.tsv      — word frequency (SUBTLCD column)
 *   cmudict.txt         — phonetic transcriptions
 *   wordnet/dict/       — index.noun, index.verb, index.adj, index.adv
 *
 * Output:
 *   dist/dictionary.json
 */

import { type DictionaryEntry } from "../src/types"

const DATA_DIR = new URL("../data", import.meta.url).pathname
const DIST_DIR = new URL("../dist", import.meta.url).pathname

// ── Types ──

interface AffixRule {
  type: "PFX" | "SFX"
  flag: string
  strip: string
  add: string
  condition: RegExp | null
}

// ── Affix expansion ──

async function parseAffixRules(affPath: string): Promise<Map<string, AffixRule[]>> {
  const text = await Bun.file(affPath).text()
  const rules = new Map<string, AffixRule[]>()

  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] !== "PFX" && parts[0] !== "SFX") continue
    // skip header lines (PFX A Y 1)
    if (parts.length < 5) continue

    const type = parts[0] as "PFX" | "SFX"
    const flag = parts[1]
    const strip = parts[2] === "0" ? "" : parts[2]
    const add = parts[3].replace(/\/.*$/, "") // strip continuation flags
    const conditionStr = parts[4]

    let condition: RegExp | null = null
    if (conditionStr && conditionStr !== ".") {
      if (type === "SFX") {
        condition = new RegExp(`${conditionStr}$`)
      } else {
        condition = new RegExp(`^${conditionStr}`)
      }
    }

    const ruleList = rules.get(flag) ?? []
    ruleList.push({ type, flag, strip, add, condition })
    rules.set(flag, ruleList)
  }

  return rules
}

function expandWord(
  word: string,
  flags: string,
  rules: Map<string, AffixRule[]>
): Map<string, string> {
  // returns map of expanded_form → root_word
  const result = new Map<string, string>()
  result.set(word, word) // word is its own root

  for (const flag of flags) {
    const ruleList = rules.get(flag)
    if (!ruleList) continue

    for (const rule of ruleList) {
      if (rule.condition && !rule.condition.test(word)) continue

      let expanded: string
      if (rule.type === "SFX") {
        const base = rule.strip ? word.slice(0, -rule.strip.length) : word
        expanded = base + rule.add
      } else {
        const base = rule.strip ? word.slice(rule.strip.length) : word
        expanded = rule.add + base
      }

      if (expanded && expanded !== word) {
        result.set(expanded.toLowerCase(), word)
      }
    }
  }

  return result
}

async function buildFamilyMap(
  dicPath: string,
  rules: Map<string, AffixRule[]>
): Promise<Map<string, string>> {
  const text = await Bun.file(dicPath).text()
  const familyMap = new Map<string, string>() // expanded → root

  for (const line of text.split("\n")) {
    if (!line.trim() || /^\d+$/.test(line.trim())) continue

    const slashIdx = line.indexOf("/")
    let word: string
    let flags: string

    if (slashIdx !== -1) {
      word = line.slice(0, slashIdx).trim().toLowerCase()
      flags = line.slice(slashIdx + 1).trim().split(/\s/)[0] // flags before any spaces
    } else {
      word = line.trim().toLowerCase()
      flags = ""
    }

    if (!/^[a-z]+$/.test(word)) continue

    const expanded = expandWord(word, flags, rules)
    for (const [form, root] of expanded) {
      // prefer shorter roots if conflict
      const existing = familyMap.get(form)
      if (!existing || root.length < existing.length) {
        familyMap.set(form, root)
      }
    }
  }

  return familyMap
}

// ── SUBTLEX ──

interface SubtlexEntry {
  freqCount: number
  cdPercent: number // SUBTLCD — % of films
}

async function loadSubtlex(path: string): Promise<Map<string, SubtlexEntry>> {
  const text = await Bun.file(path).text()
  const entries = new Map<string, SubtlexEntry>()

  for (const line of text.split("\n").slice(1)) {
    const cols = line.split("\t")
    if (cols.length < 8) continue
    const word = cols[0].trim().toLowerCase()
    if (!word || !/^[a-z]+$/.test(word)) continue

    entries.set(word, {
      freqCount: parseInt(cols[1], 10) || 0,
      cdPercent: parseFloat(cols[7]) || 0, // SUBTLCD column
    })
  }

  return entries
}

function frequencyToTier(cdPercent: number): number {
  if (cdPercent >= 50) return 4    // universal — "the", "run", "go"
  if (cdPercent >= 10) return 3    // common — "dog", "ocean", "camera"
  if (cdPercent >= 1) return 2     // uncommon — "lantern", "cobalt"
  if (cdPercent > 0) return 1      // rare — "quixotic", "zymurgy"
  return 0                         // legendary — not in SUBTLEX at all
}

// ── CMU Dict ──

interface CmuEntry {
  phonemes: string[]
  syllables: number
  rhyme: string // trailing phonemes from last stressed vowel
}

async function loadCmu(path: string): Promise<Map<string, CmuEntry>> {
  const text = await Bun.file(path).text()
  const entries = new Map<string, CmuEntry>()

  for (const line of text.split("\n")) {
    if (line.startsWith(";;;") || !line.trim()) continue

    const firstSpace = line.indexOf(" ")
    if (firstSpace === -1) continue

    const rawWord = line.slice(0, firstSpace).replace(/\(\d+\)$/, "").trim().toLowerCase()
    if (!rawWord || !/^[a-z]+$/.test(rawWord)) continue

    if (entries.has(rawWord)) continue

    const phonemes = line.slice(firstSpace).trim().split(/\s+/)
    const syllables = phonemes.filter(p => /[0-9]/.test(p)).length

    // rhyme = phonemes from last stressed vowel (marker 1) onward
    let rhymeStart = -1
    for (let i = phonemes.length - 1; i >= 0; i--) {
      if (phonemes[i].includes("1")) {
        rhymeStart = i
        break
      }
    }
    // fallback: last vowel of any stress
    if (rhymeStart === -1) {
      for (let i = phonemes.length - 1; i >= 0; i--) {
        if (/[0-9]/.test(phonemes[i])) {
          rhymeStart = i
          break
        }
      }
    }

    const rhyme = rhymeStart >= 0
      ? phonemes.slice(rhymeStart).map(p => p.replace(/[0-9]/g, "")).join("-")
      : null

    if (rhyme) {
      entries.set(rawWord, { phonemes, syllables, rhyme })
    }
  }

  return entries
}

// ── WordNet ──

type POS = "n" | "v" | "adj" | "adv"

async function loadWordNetPos(dictDir: string): Promise<Map<string, Set<POS>>> {
  const posMap = new Map<string, Set<POS>>()

  const files: Array<{ file: string; pos: POS }> = [
    { file: "index.noun", pos: "n" },
    { file: "index.verb", pos: "v" },
    { file: "index.adj", pos: "adj" },
    { file: "index.adv", pos: "adv" },
  ]

  for (const { file, pos } of files) {
    const text = await Bun.file(`${dictDir}/${file}`).text()
    for (const line of text.split("\n")) {
      if (line.startsWith(" ") || !line.trim()) continue
      const word = line.split(" ")[0]?.trim().toLowerCase()
      if (!word || !/^[a-z]+$/.test(word)) continue

      const existing = posMap.get(word) ?? new Set<POS>()
      existing.add(pos)
      posMap.set(word, existing)
    }
  }

  return posMap
}

// ── SCOWL base word list ──

async function loadScowlWords(path: string): Promise<Set<string>> {
  const text = await Bun.file(path).text()
  const words = new Set<string>()
  for (const line of text.split("\n")) {
    const trimmed = line.trim().toLowerCase()
    if (trimmed && /^[a-z]+$/.test(trimmed)) {
      words.add(trimmed)
    }
  }
  return words
}

// ── Main pipeline ──

console.log("Loading sources...")
const t0 = performance.now()

const [scowlWords, affixRules, subtlex, cmu, wordnetPos] = await Promise.all([
  loadScowlWords(`${DATA_DIR}/scowl-70.txt`),
  parseAffixRules(`${DATA_DIR}/en_US-custom.aff`),
  loadSubtlex(`${DATA_DIR}/subtlex-us.tsv`),
  loadCmu(`${DATA_DIR}/cmudict.txt`),
  loadWordNetPos(`${DATA_DIR}/wordnet/dict`),
])

console.log(`  Sources loaded in ${(performance.now() - t0).toFixed(0)}ms`)
console.log(`  SCOWL: ${scowlWords.size.toLocaleString()} words`)
console.log(`  SUBTLEX: ${subtlex.size.toLocaleString()} entries`)
console.log(`  CMU: ${cmu.size.toLocaleString()} entries`)
console.log(`  WordNet POS: ${wordnetPos.size.toLocaleString()} entries`)
console.log(`  Affix rules: ${affixRules.size} flags`)

console.log("\nBuilding word families from Hunspell...")
const t1 = performance.now()
const familyMap = await buildFamilyMap(`${DATA_DIR}/en_US-custom.dic`, affixRules)
console.log(`  Family map: ${familyMap.size.toLocaleString()} expanded forms in ${(performance.now() - t1).toFixed(0)}ms`)

console.log("\nMerging into unified dictionary...")
const t2 = performance.now()

const dictionary: Record<string, DictionaryEntry> = {}
const stats = { total: 0, withFreq: 0, withCmu: 0, withPos: 0, withFamily: 0, tiers: [0, 0, 0, 0, 0] }

for (const word of scowlWords) {
  // frequency
  const sub = subtlex.get(word)
  const cdPercent = sub?.cdPercent ?? 0
  const tier = frequencyToTier(cdPercent)

  // family root — check hunspell expansion, fallback to self
  const root = familyMap.get(word) ?? word

  // phonetics — try word directly, then try root
  const cmuEntry = cmu.get(word) ?? cmu.get(root)
  const syl = cmuEntry?.syllables ?? 0
  const rhyme = cmuEntry?.rhyme ?? null

  // POS — try word directly, then try root
  const posSet = wordnetPos.get(word) ?? wordnetPos.get(root)
  const pos = posSet ? [...posSet].sort() : []

  dictionary[word] = { freq: cdPercent, tier, root, pos, syl, rhyme }

  stats.total++
  if (sub) stats.withFreq++
  if (cmuEntry) stats.withCmu++
  if (posSet) stats.withPos++
  if (root !== word) stats.withFamily++
  stats.tiers[tier]++
}

console.log(`  Merged ${stats.total.toLocaleString()} words in ${(performance.now() - t2).toFixed(0)}ms`)

console.log("\n── Coverage ──")
console.log(`  Frequency data:  ${stats.withFreq.toLocaleString()} (${((stats.withFreq / stats.total) * 100).toFixed(1)}%)`)
console.log(`  Phonetics:       ${stats.withCmu.toLocaleString()} (${((stats.withCmu / stats.total) * 100).toFixed(1)}%)`)
console.log(`  POS tags:        ${stats.withPos.toLocaleString()} (${((stats.withPos / stats.total) * 100).toFixed(1)}%)`)
console.log(`  Has family root: ${stats.withFamily.toLocaleString()} (${((stats.withFamily / stats.total) * 100).toFixed(1)}%)`)

console.log("\n── Tier distribution ──")
const tierNames = ["legendary", "rare", "uncommon", "common", "universal"]
for (let i = 0; i < 5; i++) {
  const count = stats.tiers[i]
  const pct = ((count / stats.total) * 100).toFixed(1)
  console.log(`  ${i} (${tierNames[i].padEnd(10)}): ${count.toLocaleString().padStart(7)} (${pct}%)`)
}

// write output
await Bun.write(`${DIST_DIR}/dictionary.json`, JSON.stringify(dictionary))
const fileSize = new Blob([JSON.stringify(dictionary)]).size
console.log(`\nWrote ${DIST_DIR}/dictionary.json (${(fileSize / 1024 / 1024).toFixed(1)} MB)`)

// sample entries
console.log("\n── Sample entries ──")
for (const sample of ["the", "cat", "cats", "ocean", "running", "quixotic", "defenestrate", "abampere"]) {
  const entry = dictionary[sample]
  if (entry) {
    console.log(`  ${sample}: ${JSON.stringify(entry)}`)
  } else {
    console.log(`  ${sample}: NOT IN DICTIONARY`)
  }
}
