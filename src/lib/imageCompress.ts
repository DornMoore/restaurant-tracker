// Canvas-based downscale/re-encode before upload — no new dependency, just
// the browser's own Canvas/Blob APIs. Keeps upload size (and the eventual
// public-read Storage bucket, see 0007_restaurant_photos.sql) small without
// pulling in an image-processing library for what's a one-off resize.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.8

/** Downscales (if needed) and re-encodes an image file as a JPEG blob. */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new Error('Could not encode image')
    return blob
  } finally {
    bitmap.close()
  }
}
