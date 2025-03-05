# Markdown Converter Tool

This tool converts Markdown files to HTML or PDF with enhanced features including code highlighting, styled tables, and an automatically generated table of contents.

## Features

- Convert multiple Markdown files to HTML or PDF
- Generate a single combined output file or individual files for each input
- Syntax highlighting for code blocks
- Professionally styled tables and headers
- Automatic table of contents with clickable links
- Support for different paper sizes when generating PDFs

## Installation

1. Clone or download the repository
2. Install the required dependencies:

```bash
npm install markdown-it puppeteer commander highlight.js slugify
```

## Usage

```bash
node index.cjs [options]
```

### Available Options

| Option                   | Description                                             | Default       |
| ------------------------ | ------------------------------------------------------- | ------------- |
| `-d, --directory <path>` | Directory containing Markdown files                     | `./markdowns` |
| `-f, --format <type>`    | Output format: `html` or `pdf`                          | `html`        |
| `-s, --single`           | Generate a single output file instead of separate files | `false`       |
| `-o, --output <path>`    | Output directory                                        | `output`      |
| `-p, --paper <size>`     | Paper size for PDF: `A4`, `Letter`, or `Legal`          | `A4`          |

## Examples

### Convert Markdown files to HTML (individual files)

```bash
node index.cjs -d ./docs -f html
```

### Convert Markdown files to a single combined HTML file

```bash
node index.cjs -d ./docs -f html -s
```

### Generate PDF with Letter paper size

```bash
node index.cjs -d ./docs -f pdf -p Letter
```

### Generate a single PDF with Legal paper size

```bash
node index.cjs -d ./docs -f pdf -s -p Legal -o ./documentation
```

## Output

The generated files will be placed in the specified output directory (default: `./output`). When using the `-s` (single) option, the combined output will be named:

- HTML: `combined.html`
- PDF: `combined.pdf`

Without the `-s` option, each input file will have a corresponding output file with the same name but a different extension (`.html` or `.pdf`).

## Example

```sh
git clone https://github.com/google/material-design-lite.git
```
