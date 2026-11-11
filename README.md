# qrgen

A QR code generator written in JavaScript, with the QR encoder implemented
**from scratch** following ISO/IEC 18004. No QR libraries, no runtime
dependencies. It is a terminal tool today, and the same engine is built to
power a static website later.

```text
$ qrgen "hello world"
    █▀▀▀▀▀█  ▀▄▀▀ █▀▀▀▀▀█
    █ ███ █ ███▀▄ █ ███ █
    █ ▀▀▀ █ █ ▀▄▀ █ ▀▀▀ █
    ▀▀▀▀▀▀▀ █ █ ▀ ▀▀▀▀▀▀▀
    ▀▄█▀██▀▄ █ █▄▄█████ ▄
    █ █ ▀█▀▀ █▀▄██▀ ▄██▀
       ▀ ▀▀▀█▀▄ █▀▀ ▄▄  █
    █▀▀▀▀▀█ ▄  ▀ ▄▀▄ ▄██▄
    █ ███ █ █▄ ▀▄▄██▄▄  ▀
    █ ▀▀▀ █ ▀█▄ █▄ ▀▄▄█
    ▀▀▀▀▀▀▀ ▀▀ ▀▀ ▀ ▀  ▀
```

## Features

- Numeric, alphanumeric and byte (UTF-8) modes, picked automatically.
- Versions 1 to 40 and error correction levels L, M, Q, H. The smallest
  version that fits is chosen automatically.
- Reed-Solomon error correction over GF(256), block interleaving, all eight
  mask patterns scored with the four standard penalty rules, format and
  version information with BCH codes.
- Output: terminal (Unicode half blocks or ASCII), SVG, and PNG written by
  hand with a tiny PNG encoder (built-in `zlib` plus a hand-rolled CRC32).
- `src/core/` and the SVG renderer use no Node APIs, so they run unchanged
  in a browser.
- Tested against an independent decoder (jsQR) across all modes, levels,
  masks and a spread of versions up to 40.

## Requirements

- Node.js 20 or newer (developed on Node 24).
- No runtime dependencies. Dev dependencies (`jsqr`, `pngjs`) are only used
  by the tests.

## Install locally

The package is not published to npm yet. Clone the repository and link it
so the `qrgen` command is available everywhere on your machine:

```powershell
git clone https://github.com/jmendoza167/Qr-Code-Generator.git qrgen
cd qrgen
npm install        # dev dependencies, only needed for npm test
npm link           # creates a global "qrgen" command pointing at this folder
qrgen --version
```

To remove the global command later:

```powershell
npm unlink -g @jmendoza167/qrgen
```

## Usage

```text
qrgen [text] [options]
```

| Option                 | Description                                                    | Default   |
| ---------------------- | -------------------------------------------------------------- | --------- |
| `-o, --output <file>`  | Save to a file; the extension picks the format (.png or .svg)  | terminal  |
| `-e, --ecc <L\|M\|Q\|H>` | Error correction level                                       | `M`       |
| `-s, --scale <n>`      | Pixels per module (PNG/SVG)                                    | `10`      |
| `-m, --margin <n>`     | Quiet zone in modules                                          | `4`       |
| `--fg <hex>`           | Foreground colour (PNG/SVG), `#rrggbb` or `#rgb`               | `#000000` |
| `--bg <hex>`           | Background colour (PNG/SVG)                                    | `#ffffff` |
| `--ascii`              | Print with `##` and spaces instead of Unicode half blocks      |           |
| `--invert`             | Swap dark and light in the terminal output                     |           |
| `--info`               | Also print version, mode, ECC level and mask                   |           |
| `-h, --help`           | Show help                                                      |           |
| `-v, --version`        | Show the version number                                        |           |

Exit codes: `0` success, `1` encoding or file error (text too long, cannot
write file), `2` usage error (bad option or value).

### Examples (PowerShell)

```powershell
# Print in the terminal
qrgen "hello world"

# Read the text from stdin
echo "hello from stdin" | qrgen

# Show what was chosen
qrgen "https://github.com/jmendoza167/Qr-Code-Generator" --info

# Save as PNG, 8 pixels per module, custom colours
qrgen "https://example.com" -o qr.png -s 8 --fg "#1a237e" --bg "#fffde7"

# Save as SVG with a 2-module quiet zone and the highest error correction
qrgen "https://example.com" -o qr.svg -m 2 -e H

# Accents and emoji work (UTF-8 byte mode)
qrgen "¡Hola, señor! 😀"

# Fallback for terminals that render block characters badly
qrgen "hello" --ascii
```

### Notes for Windows terminals

- **Dark themes.** The terminal renderer draws dark modules with the text
  colour. On a dark theme that gives a light-on-dark (inverted) code, which
  most phone scanners read fine. If yours does not, add `--invert`.
- **Piping non-ASCII text in Windows PowerShell 5.1.** PowerShell 5.1 sends
  piped text to native programs as ASCII by default, so accents become `?`
  before qrgen ever sees them. Either pass the text as an argument, use
  PowerShell 7, or run this once in the session:

  ```powershell
  $OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  ```

- `echo` adds a line break; qrgen strips one trailing line break from stdin.

## Programmatic use

Everything the CLI does is available as plain functions.

```js
import { encode, renderTerminal, renderSvg, renderPng } from '@jmendoza167/qrgen';
import { writeFileSync } from 'node:fs';

const qr = encode('hello world', { ecc: 'Q' });
// qr = { matrix, size, version, ecc, mask, mode }
//   matrix[row][col] === true  -> dark module

console.log(renderTerminal(qr.matrix));
writeFileSync('qr.svg', renderSvg(qr.matrix, { scale: 8, fg: '#1a237e' }));
writeFileSync('qr.png', renderPng(qr.matrix, { scale: 8, margin: 2 }));
```

`encode(text, options)` options: `ecc` (`'L' | 'M' | 'Q' | 'H'`, default
`'M'`), `version` (force 1..40), `minVersion`, `maxVersion`, `mask` (force
0..7). It throws `DataTooLongError` when the text does not fit.

### In the browser

The engine and the SVG renderer have no Node dependencies. Import only the
browser-safe entry points:

```js
import { encode } from '@jmendoza167/qrgen/core';
import { renderSvg } from '@jmendoza167/qrgen/render/svg';

document.getElementById('out').innerHTML = renderSvg(encode('hello').matrix);
```

(`@jmendoza167/qrgen/render/terminal` is browser-safe too; only the PNG
renderer and the CLI need Node.)

## How QR encoding works

The whole pipeline lives in `src/core/`, one step per file. The comments in
those files go into the details; this is the map.

1. **Mode selection** (`mode.js`). A string of digits is encoded in
   *numeric* mode (3 digits per 10 bits). Uppercase letters, digits and
   ` $%*+-./:` use *alphanumeric* mode (2 characters per 11 bits).
   Everything else uses *byte* mode with UTF-8 (8 bits per byte), which is
   what every modern reader assumes.

2. **Version selection** (`encoder.js`, `version.js`). A symbol's *version*
   (1 to 40) sets its size, 21x21 to 177x177 modules. The number of data
   codewords available at each version and error correction level comes from
   the block tables in `tables.js`. The encoder picks the smallest version
   whose capacity holds the text, remembering that the character count
   indicator gets wider at versions 10 and 27.

3. **Bit stream** (`encoder.js`, `bits.js`). The data becomes a bit stream:
   4-bit mode indicator, character count, the encoded characters, a
   terminator of up to four zero bits, zero padding to a byte boundary, and
   the pad codewords `0xEC 0x11 0xEC 0x11 ...` until every data codeword is
   used.

4. **Error correction** (`gf256.js`, `reed-solomon.js`). Reed-Solomon codes
   treat the data codewords as a polynomial and append the remainder of a
   division by a *generator polynomial*. Arithmetic happens in the finite
   field GF(256) (bytes with XOR as addition and multiplication modulo the
   primitive polynomial `0x11D`), which is implemented with log/antilog
   tables. A reader can repair up to half as many codewords as there are EC
   codewords in a block.

5. **Blocks and interleaving** (`blocks.js`). Larger symbols split the data
   into several blocks, each with its own EC codewords. The blocks are then
   interleaved (first codeword of every block, then the second, ...), so a
   localised smudge damages a little of every block instead of destroying
   one.

6. **The matrix** (`matrix.js`). Function patterns are drawn first: three
   finder patterns with separators, the timing patterns on row and column
   6, alignment patterns at the positions from Annex E, the always-dark
   module, and version information for versions 7+ (an 18-bit BCH code,
   `format.js`). Format information areas are reserved. The codeword bits
   are then placed in the zigzag path: column pairs from right to left,
   alternating upward and downward, skipping function modules and the whole
   vertical timing column.

7. **Masking** (`mask.js`). The data modules are XORed with one of eight
   patterns to break up large uniform areas and finder look-alikes. All
   eight are tried and scored with the four penalty rules (long runs, 2x2
   blocks, finder-like sequences, dark/light balance); the lowest wins. The
   chosen mask and the ECC level are written as a 15-bit BCH-protected
   format code, twice, around the finders.

`qr.js` wires these together, and `render/` turns the resulting boolean
matrix into text, SVG or PNG.

## Project structure

```text
bin/qrgen.js          CLI entry point (shebang)
src/cli.js            argument parsing, stdin, file output
src/index.js          Node entry: engine + all renderers
src/core/             pure engine, no Node APIs
  tables.js           constants from the standard
  gf256.js            GF(256) arithmetic
  reed-solomon.js     EC codeword generation
  bits.js             bit buffer
  mode.js             mode detection, capacities
  version.js          sizes, codeword counts, block layout
  encoder.js          bit stream, version selection, padding
  blocks.js           block splitting and interleaving
  format.js           format / version information (BCH)
  matrix.js           function patterns, placement
  mask.js             masks and penalty scoring
  qr.js               encode()
src/render/
  terminal.js         half blocks / ASCII (browser-safe)
  svg.js              SVG string (browser-safe)
  png.js              PNG writer (Node: zlib)
  color.js            hex colour parsing
test/                 node --test suites, including jsQR round trips
```

## Testing

```powershell
npm test
```

The suite checks GF(256) and Reed-Solomon against published values (the
standard's version 1-M `01234567` example among them), every data codeword
count in Table 7, mode and version selection at the exact capacity
boundaries, matrix geometry for all 40 versions, and round trips through
jsQR for all modes, ECC levels, masks and a spread of versions including
40. PNG output is parsed with pngjs and decoded with jsQR. A guard test
fails if anything under `src/core/` starts importing Node APIs.

## Roadmap

- Static website using `src/core/` and the SVG renderer.
- Presets (Wi-Fi, vCard, URLs) on top of the CLI.

## License

MIT
