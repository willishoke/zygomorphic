import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const svgPath = join(__dirname, '../assets/icon.svg')
const pngPath = join(__dirname, '../assets/icon.png')

const svg = readFileSync(svgPath)
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } })
const rendered = resvg.render()
writeFileSync(pngPath, rendered.asPng())
console.log('icon.png written (1024x1024)')
