// Uploads a restaurant photo directly to Supabase Storage (bypassing
// PowerSync — it only syncs structured rows, never blobs, see schema.ts),
// then writes the resulting public URL back through a normal
// powerSync.execute() UPDATE, same as any other field. Fires immediately on
// file selection as its own independent write, not bundled into the edit
// form's Save/Cancel — mirrors how addTag() already works as an
// independent action, and avoids "uploaded a photo, then hit Cancel and
// lost it."
import type { AbstractPowerSyncDatabase } from '@powersync/web'
import { compressImage } from './imageCompress'
import { supabaseConnector } from './powersync/plugin'

const BUCKET = 'restaurant-photos'

export async function uploadRestaurantPhoto(
  powerSync: AbstractPowerSyncDatabase,
  restaurantId: string,
  file: File,
): Promise<string> {
  const blob = await compressImage(file)
  const path = `${restaurantId}/${crypto.randomUUID()}.jpg`

  const { error: uploadError } = await supabaseConnector.client.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (uploadError) throw new Error(`Could not upload photo: ${uploadError.message}`)

  const { data } = supabaseConnector.client.storage.from(BUCKET).getPublicUrl(path)
  const now = new Date().toISOString()
  await powerSync.execute(`UPDATE restaurants SET photo_url = ?, updated_at = ? WHERE id = ?`, [
    data.publicUrl,
    now,
    restaurantId,
  ])
  return data.publicUrl
}
