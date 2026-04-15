/**
 * Analyze word overlap between our base dictionary (SCOWL) and supplementary datasets.
 * Base = SCOWL size 70 word list. We only care about words IN the base that are
 * MISSING from supplementary datasets (frequency, phonetics, synonyms).
 */

const DATA_DIR = new URL("../data", import.meta.url).pathname

// --- Loaders ---

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

async function loadSubtlexWords(path: string): Promise<Set<string>> {
  const text = await Bun.file(path).text()
  const words = new Set<string>()
  for (const line of text.split("\n").slice(1)) {
    const word = line.split("\t")[0]?.trim().toLowerCase()
    if (word && /^[a-z]+$/.test(word)) {
      words.add(word)
    }
  }
  return words
}

async function loadCmuWords(path: string): Promise<Set<string>> {
  const text = await Bun.file(path).text()
  const words = new Set<string>()
  for (const line of text.split("\n")) {
    if (line.startsWith(";;;") || !line.trim()) continue
    const word = line.split(" ")[0]?.replace(/\(\d+\)$/, "").trim().toLowerCase()
    if (word && /^[a-z]+$/.test(word)) {
      words.add(word)
    }
  }
  return words
}

async function loadWordNetWords(dictDir: string): Promise<Set<string>> {
  const words = new Set<string>()
  for (const pos of ["noun", "verb", "adj", "adv"]) {
    const text = await Bun.file(`${dictDir}/index.${pos}`).text()
    for (const line of text.split("\n")) {
      if (line.startsWith(" ") || !line.trim()) continue
      const word = line.split(" ")[0]?.trim().toLowerCase().replace(/_/g, " ")
      if (word && /^[a-z]+$/.test(word)) {
        words.add(word)
      }
    }
  }
  return words
}

// --- Analysis ---

function analyzeOverlap(
  baseName: string,
  base: Set<string>,
  datasets: Record<string, Set<string>>
) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`BASE: ${baseName} (${base.size.toLocaleString()} words)`)
  console.log("=".repeat(60))

  for (const [name, dataset] of Object.entries(datasets)) {
    const missing = new Set<string>()
    for (const word of base) {
      if (!dataset.has(word)) missing.add(word)
    }

    const covered = base.size - missing.size
    const coveragePct = ((covered / base.size) * 100).toFixed(1)

    console.log(`\n${name}`)
    console.log(`  Dataset size:   ${dataset.size.toLocaleString()} words`)
    console.log(`  Covers base:    ${covered.toLocaleString()} / ${base.size.toLocaleString()} (${coveragePct}%)`)
    console.log(`  Missing:        ${missing.size.toLocaleString()} base words`)

    // show sample of missing words
    const missingSorted = [...missing].sort()
    const sampleSize = Math.min(30, missingSorted.length)
    if (sampleSize > 0) {
      console.log(`  Sample missing: ${missingSorted.slice(0, sampleSize).join(", ")}`)
    }

    let extraCount = 0
    for (const word of dataset) {
      if (!base.has(word)) extraCount++
    }
    console.log(`  Extra (not in base): ${extraCount.toLocaleString()}`)
  }

  // combined coverage: how many base words have data in ALL datasets?
  console.log(`\n${"─".repeat(60)}`)
  console.log("COMBINED COVERAGE")

  let coveredByAll = 0
  let coveredByNone = 0
  const coverageCount: Record<number, number> = {}

  for (const word of base) {
    let count = 0
    for (const dataset of Object.values(datasets)) {
      if (dataset.has(word)) count++
    }
    coverageCount[count] = (coverageCount[count] ?? 0) + 1
    if (count === Object.keys(datasets).length) coveredByAll++
    if (count === 0) coveredByNone++
  }

  const datasetCount = Object.keys(datasets).length
  for (let i = 0; i <= datasetCount; i++) {
    const count = coverageCount[i] ?? 0
    const pct = ((count / base.size) * 100).toFixed(1)
    const label = i === 0 ? "in NO datasets" : i === datasetCount ? "in ALL datasets" : `in ${i}/${datasetCount} datasets`
    console.log(`  ${label}: ${count.toLocaleString()} words (${pct}%)`)
  }
}

async function loadHunspellBaseWords(dicPath: string): Promise<Set<string>> {
  const text = await Bun.file(dicPath).text()
  const words = new Set<string>()
  for (const line of text.split("\n")) {
    // skip first line (count) and empty lines
    if (!line.trim() || /^\d+$/.test(line.trim())) continue
    // extract word before the /flags
    const word = line.split("/")[0]?.trim().toLowerCase()
    if (word && /^[a-z]+$/.test(word)) {
      words.add(word)
    }
  }
  return words
}

// --- Main ---

console.log("Loading datasets...")

const [scowl, hunspellBase, subtlex, cmu, wordnet] = await Promise.all([
  loadScowlWords(`${DATA_DIR}/scowl-70.txt`),
  loadHunspellBaseWords(`${DATA_DIR}/en_US-custom.dic`),
  loadSubtlexWords(`${DATA_DIR}/subtlex-us.tsv`),
  loadCmuWords(`${DATA_DIR}/cmudict.txt`),
  loadWordNetWords(`${DATA_DIR}/wordnet/dict`),
])

console.log("Loaded.")

const datasets = {
  "SUBTLEX-US (frequency)": subtlex,
  "CMU Dict (phonetics)": cmu,
  "WordNet 3.0 (synsets)": wordnet,
}

console.log("\n\n>>> EXPANDED WORD LIST (all inflections)")
analyzeOverlap("SCOWL size 70 expanded", scowl, datasets)

console.log("\n\n>>> BASE FORMS ONLY (Hunspell .dic roots)")
analyzeOverlap("Hunspell base forms", hunspellBase, datasets)
