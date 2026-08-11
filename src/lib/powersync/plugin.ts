import { PowerSyncDatabase } from '@powersync/web'
import { createPowerSyncPlugin } from '@powersync/vue'
import { AppSchema } from './schema'
import { SupabaseConnector } from './SupabaseConnector'

export const supabaseConnector = new SupabaseConnector()

export const powerSync = new PowerSyncDatabase({
  database: {
    dbFilename: 'restaurant-tracker.db',
  },
  schema: AppSchema,
})

// Registered as a Vue plugin in main.ts — makes usePowerSync()/useQuery()
// available in every component without prop-drilling the database instance.
export const powerSyncPlugin = createPowerSyncPlugin({ database: powerSync })

/**
 * Call once on app mount (see App.vue). Starts the local database, then
 * connects the sync stream using the Supabase connector for auth + upload.
 * Safe to call even while offline — connect() just won't establish a stream
 * until a connection is available, and local reads/writes work regardless.
 */
export async function initPowerSync() {
  await powerSync.init()
  await supabaseConnector.init()
  await powerSync.connect(supabaseConnector)
}
