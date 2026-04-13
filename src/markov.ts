export interface MarkovData {
  starts: [string, string][]
  transitions: Record<string, Record<string, number>>
}

const MAX_SENTENCE_WORDS = 25

function isSentenceEnd(word: string): boolean {
  return /[.!?]$/.test(word)
}

function weightedPick(options: Record<string, number>): string | null {
  const entries = Object.entries(options)
  if (entries.length === 0) return null
  let total = 0
  for (const [, count] of entries) total += count
  let r = Math.random() * total
  for (const [word, count] of entries) {
    r -= count
    if (r <= 0) return word
  }
  return entries[entries.length - 1]![0]
}

export class MarkovGenerator {
  private data: MarkovData

  constructor(data: MarkovData) {
    this.data = data
  }

  generateSentence(): string {
    const { starts, transitions } = this.data
    if (starts.length === 0) return 'The end.'

    const [first, second] = starts[Math.floor(Math.random() * starts.length)]!
    const words: string[] = [first, second]

    for (let i = 0; i < MAX_SENTENCE_WORDS - 2; i++) {
      const key = `${words[words.length - 2]}|${words[words.length - 1]}`
      const options = transitions[key]

      if (!options) break

      const next = weightedPick(options)
      if (!next) break

      words.push(next)

      if (isSentenceEnd(next)) break
    }

    let result = words.join(' ')

    if (!isSentenceEnd(result)) {
      // Strip trailing punctuation that isn't sentence-ending
      const last = words[words.length - 1]
      if (last && /[,;:]$/.test(last)) {
        words[words.length - 1] = last.slice(0, -1)
      }
      result = words.join(' ') + '.'
    }

    return result
  }

  generateWords(count: number): string[] {
    const words: string[] = []
    let attempts = 0
    const maxAttempts = count * 2

    while (words.length < count && attempts < maxAttempts) {
      const sentence = this.generateSentence()
      const parts = sentence.split(/\s+/)
      words.push(...parts)
      attempts++
    }

    return words.slice(0, count)
  }
}
