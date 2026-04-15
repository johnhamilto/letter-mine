import { Text, type TextStyleOptions } from 'pixi.js'

type StyleOverrides = Omit<TextStyleOptions, 'fontFamily'>

export function makeText(text: string, style: StyleOverrides = {}): Text {
  return new Text({
    text,
    style: { fontFamily: 'Playfair Display', ...style },
  })
}
