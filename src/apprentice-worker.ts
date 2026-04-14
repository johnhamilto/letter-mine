/**
 * Apprentice worker — off-main-thread dictionary search for the apprentice shelf.
 * Keeps the render loop smooth when iterating 143k words.
 */

import type { DictionaryEntry } from './types'

interface InitMsg {
  type: 'init'
  dictionary: Record<string, DictionaryEntry>
}

interface FindMsg {
  type: 'find'
  id: number
  discovered: string[]
  basinCounts: Record<string, number>
  maxLength: number
  preferHighValue: boolean
}

interface FoundMsg {
  type: 'found'
  id: number
  word: string | null
}

export type ApprenticeWorkerInMsg = InitMsg | FindMsg
export type ApprenticeWorkerOutMsg = FoundMsg

let dictionary: Record<string, DictionaryEntry> = {}
const wordsByLength = new Map<number, string[]>()

self.onmessage = (e: MessageEvent<ApprenticeWorkerInMsg>) => {
  const msg = e.data
  if (msg.type === 'init') {
    dictionary = msg.dictionary
    wordsByLength.clear()
    for (const word in dictionary) {
      const len = word.length
      if (len < 4) continue
      let bucket = wordsByLength.get(len)
      if (!bucket) {
        bucket = []
        wordsByLength.set(len, bucket)
      }
      bucket.push(word)
    }
    return
  }

  if (msg.type === 'find') {
    const word = findBestWord(msg)
    const out: FoundMsg = { type: 'found', id: msg.id, word }
    self.postMessage(out)
  }
}

function findBestWord(msg: FindMsg): string | null {
  const discovered = new Set(msg.discovered)
  const available = msg.basinCounts
  // Group formable undiscovered words by length, keeping only the preferred tier per length.
  const byLength = new Map<number, { bestTier: number; words: string[] }>()

  for (let len = 4; len <= msg.maxLength; len++) {
    const words = wordsByLength.get(len)
    if (!words) continue

    for (const word of words) {
      if (discovered.has(word)) continue

      // Basin-count buffer: never use the last 2 of any letter.
      let canForm = true
      const needed: Record<string, number> = Object.create(null)
      for (let i = 0; i < word.length; i++) {
        const ch = word[i]!
        needed[ch] = (needed[ch] ?? 0) + 1
        if ((available[ch] ?? 0) < needed[ch]! + 2) {
          canForm = false
          break
        }
      }
      if (!canForm) continue

      const tier = dictionary[word]?.tier ?? 0
      const bucket = byLength.get(len)
      if (!bucket) {
        byLength.set(len, { bestTier: tier, words: [word] })
      } else {
        const tierBetter = msg.preferHighValue ? tier < bucket.bestTier : tier > bucket.bestTier
        if (tierBetter) {
          bucket.bestTier = tier
          bucket.words = [word]
        } else if (tier === bucket.bestTier) {
          bucket.words.push(word)
        }
      }
    }
  }

  const lengths = [...byLength.keys()]
  if (lengths.length === 0) return null

  const randomLength = lengths[Math.floor(Math.random() * lengths.length)]!
  const bucket = byLength.get(randomLength)!
  return bucket.words[Math.floor(Math.random() * bucket.words.length)] ?? null
}
