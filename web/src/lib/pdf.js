import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
}

export const PDF_CMAP_URL = '/api/cmaps/'
export const PDF_STANDARD_FONTS_URL = '/api/standard_fonts/'

export function getDocumentParams(urlOrParams) {
  const base = typeof urlOrParams === 'string' ? { url: urlOrParams } : urlOrParams
  return {
    cMapUrl: PDF_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDF_STANDARD_FONTS_URL,
    ...base
  }
}

export { pdfjsLib, workerUrl }
