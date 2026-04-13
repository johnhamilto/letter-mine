/**
 * Build a trigram Markov chain from Project Gutenberg corpus files.
 *
 * Reads all .txt files from data/corpus/, strips Gutenberg boilerplate,
 * tokenizes into sentences/words, builds a trigram transition table,
 * and outputs public/markov.json.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const CORPUS_DIR = join(import.meta.dir, '..', 'data', 'corpus')
const OUTPUT_PATH = join(import.meta.dir, '..', 'public', 'markov.json')

const MAX_WORD_LEN = 14
const MIN_WORD_LEN = 1

function stripGutenbergBoilerplate(text: string): string {
  const startMatch = text.match(/\*\*\* START OF .+? \*\*\*/)
  const endMatch = text.match(/\*\*\* END OF .+? \*\*\*/)
  const startIdx = startMatch ? text.indexOf(startMatch[0]) + startMatch[0].length : 0
  const endIdx = endMatch ? text.indexOf(endMatch[0]) : text.length
  return text.slice(startIdx, endIdx)
}

function normalizeText(text: string): string {
  return (
    text
      // Collapse whitespace (including line breaks) to single spaces
      .replace(/\r\n/g, '\n')
      .replace(/\n{2,}/g, '\n\n')
      // Remove chapter headings (ALL CAPS lines)
      .replace(/^[A-Z][A-Z\s.,;:!?'-]{5,}$/gm, '')
      // Remove Roman numeral chapter markers
      .replace(/^\s*(?:CHAPTER|ADVENTURE|PART)\s+[IVXLCDM]+\.?\s*$/gm, '')
      // Normalize unicode quotes/dashes
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2014\u2013]/g, '--')
      // Collapse whitespace
      .replace(/[ \t]+/g, ' ')
      .replace(/\n /g, '\n')
  )
}

function splitSentences(text: string): string[][] {
  // Split on sentence-ending punctuation followed by space or newline
  const raw = text.split(/(?<=[.!?])\s+/)
  const sentences: string[][] = []

  for (const chunk of raw) {
    const trimmed = chunk.trim()
    if (!trimmed) continue

    const words = trimmed.split(/\s+/).filter((w) => w.length > 0)
    if (words.length < 3) continue

    const cleaned = words.map(cleanWord).filter((w): w is string => w !== null)

    if (cleaned.length >= 3) {
      sentences.push(cleaned)
    }
  }

  return sentences
}

function cleanWord(word: string): string | null {
  // Strip surrounding quotes and parentheses
  let w = word.replace(/^["'(]+/, '').replace(/["')]+$/, '')

  // Skip words with numbers
  if (/\d/.test(w)) return null

  // Skip ALL CAPS words (chapter headings that leaked through)
  const stripped = w.replace(/[^a-zA-Z]/g, '')
  if (stripped.length > 1 && stripped === stripped.toUpperCase()) return null

  // Skip very long or empty words
  if (stripped.length < MIN_WORD_LEN || stripped.length > MAX_WORD_LEN) return null

  // Skip words with weird characters
  if (/[^a-zA-Z',;:.!?\-]/.test(w)) return null

  // Normalize: lowercase unless it starts a sentence (caller handles capitalization)
  // Keep the word as-is to preserve sentence starts
  return w
}

function isSentenceEnd(word: string): boolean {
  return /[.!?]$/.test(word)
}

interface MarkovData {
  starts: [string, string][]
  transitions: Record<string, Record<string, number>>
}

async function main() {
  const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith('.txt'))
  if (files.length === 0) {
    console.error('No .txt files found in', CORPUS_DIR)
    process.exit(1)
  }

  console.log(`Found ${files.length} corpus files`)

  const allSentences: string[][] = []

  for (const file of files) {
    const raw = await readFile(join(CORPUS_DIR, file), 'utf-8')
    const stripped = stripGutenbergBoilerplate(raw)
    const normalized = normalizeText(stripped)
    const sentences = splitSentences(normalized)
    console.log(`  ${file}: ${sentences.length} sentences`)
    allSentences.push(...sentences)
  }

  console.log(`Total sentences: ${allSentences.length}`)

  // Build trigram transitions
  const transitions: Record<string, Record<string, number>> = {}
  const startPairs: Map<string, number> = new Map()

  for (const sentence of allSentences) {
    if (sentence.length < 3) continue

    // Track sentence start pair
    const startKey = `${sentence[0]}|${sentence[1]}`
    startPairs.set(startKey, (startPairs.get(startKey) ?? 0) + 1)

    // Build trigrams
    for (let i = 0; i < sentence.length - 2; i++) {
      const key = `${sentence[i]}|${sentence[i + 1]}`
      const next = sentence[i + 2]!
      if (!transitions[key]) transitions[key] = {}
      transitions[key][next] = (transitions[key][next] ?? 0) + 1
    }
  }

  // Convert start pairs to sorted array (most common first, deduplicated)
  const starts: [string, string][] = [...startPairs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300) // Keep top 300 start pairs
    .map(([key]) => {
      const [a, b] = key.split('|')
      return [a!, b!]
    })

  // Prune to keep file compact (target ~100-300KB)
  // 1. Remove transition entries that only appeared once
  for (const key of Object.keys(transitions)) {
    const entries = Object.entries(transitions[key]!)
    const filtered: Record<string, number> = {}
    for (const [word, count] of entries) {
      if (count >= 2) filtered[word] = count
    }
    if (Object.keys(filtered).length > 0) {
      transitions[key] = filtered
    } else {
      delete transitions[key]
    }
  }

  // 2. For remaining keys with many options, keep only top N by frequency
  const MAX_OPTIONS = 6
  for (const key of Object.keys(transitions)) {
    const entries = Object.entries(transitions[key]!)
    if (entries.length > MAX_OPTIONS) {
      entries.sort((a, b) => b[1] - a[1])
      transitions[key] = Object.fromEntries(entries.slice(0, MAX_OPTIONS))
    }
  }

  const data: MarkovData = { starts, transitions }
  const json = JSON.stringify(data)
  await writeFile(OUTPUT_PATH, json, 'utf-8')

  const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1)
  const transitionCount = Object.keys(transitions).length
  console.log(`\nOutput: ${OUTPUT_PATH}`)
  console.log(`  Size: ${sizeKB} KB`)
  console.log(`  Start pairs: ${starts.length}`)
  console.log(`  Transition keys: ${transitionCount}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
