import {
  BaseObserver,
  UpdateType,
  type AbstractPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
} from '@powersync/web'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

export type SupabaseConfig = {
  supabaseUrl: string
  supabaseAnonKey: string
  powersyncUrl: string
}

/// Postgres error codes we can't recover from by retrying — see uploadData().
const FATAL_RESPONSE_CODES = [
  // Class 22 — Data Exception (e.g. type mismatch in a value)
  /^22...$/,
  // Class 23 — Integrity Constraint Violation (NOT NULL, FK, UNIQUE)
  /^23...$/,
  // Class 42 — Syntax Error or Access Rule Violation: insufficient
  // privilege (RLS), undefined column, datatype mismatch between the local
  // schema and Postgres (e.g. sending an integer where Postgres expects a
  // boolean — see 0003_fix_wouldnt_go_back_type.sql for a real instance of
  // this). None of these succeed on retry; they need a schema/code fix.
  /^42...$/,
]

export type SupabaseConnectorListener = {
  initialized: () => void
  sessionStarted: (session: Session) => void
}

/**
 * Bridges PowerSync's local SQLite store to Supabase: fetchCredentials()
 * authenticates the sync stream with the current Supabase session, and
 * uploadData() replays local writes (the CRUD queue) back to Postgres
 * whenever the app is online. This is the piece the PRD flagged as worth
 * prototyping early — see PRD.md "Platform and architecture".
 */
export class SupabaseConnector
  extends BaseObserver<SupabaseConnectorListener>
  implements PowerSyncBackendConnector
{
  readonly client: SupabaseClient
  readonly config: SupabaseConfig

  ready: boolean
  currentSession: Session | null

  constructor() {
    super()
    this.config = {
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      powersyncUrl: import.meta.env.VITE_POWERSYNC_URL,
    }

    this.client = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      auth: {
        persistSession: true,
      },
    })
    this.currentSession = null
    this.ready = false
  }

  async init() {
    if (this.ready) return

    const sessionResponse = await this.client.auth.getSession()
    this.updateSession(sessionResponse.data.session)

    this.ready = true
    this.iterateListeners((cb) => cb.initialized?.())
  }

  async login(email: string, password: string) {
    const {
      data: { session },
      error,
    } = await this.client.auth.signInWithPassword({ email, password })

    if (error) throw error
    this.updateSession(session)
  }

  async logout() {
    await this.client.auth.signOut()
    this.updateSession(null)
  }

  async fetchCredentials() {
    const {
      data: { session },
      error,
    } = await this.client.auth.getSession()

    if (!session || error) {
      throw new Error(`Could not fetch Supabase credentials: ${error}`)
    }

    return {
      endpoint: this.config.powersyncUrl,
      token: session.access_token ?? '',
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction()
    if (!transaction) return

    let lastOp: CrudEntry | null = null
    try {
      // Two of us editing the same record at the same time is an accepted
      // risk per PRD.md ("Who uses it") — last write wins here, no merge UI.
      for (const op of transaction.crud) {
        lastOp = op
        const table = this.client.from(op.table)
        let result: { error: { message: string; code: string } | null }

        switch (op.op) {
          case UpdateType.PUT:
            result = await table.upsert({ ...op.opData, id: op.id })
            break
          case UpdateType.PATCH:
            result = await table.update(op.opData ?? {}).eq('id', op.id)
            break
          case UpdateType.DELETE:
            result = await table.delete().eq('id', op.id)
            break
        }

        if (result.error) {
          console.error(result.error)
          // Preserve the Postgres error code on the thrown Error — a plain
          // `new Error(...)` drops it, which silently defeated the
          // FATAL_RESPONSE_CODES check below (permanent failures were
          // retried forever instead of being discarded, jamming the queue
          // for every record behind them).
          const uploadError = new Error(`Could not update Supabase. Received error: ${result.error.message}`)
          ;(uploadError as { code?: string }).code = result.error.code
          throw uploadError
        }
      }

      await transaction.complete()
    } catch (ex: any) {
      console.debug(ex)
      if (typeof ex.code === 'string' && FATAL_RESPONSE_CODES.some((re) => re.test(ex.code))) {
        // Discard rather than retry forever — a fatal error here means a bug
        // in the app (bad data shape, RLS rule), not a transient network blip.
        console.error(`Data upload error - discarding ${lastOp}`, ex)
        await transaction.complete()
      } else {
        // Likely a network error or temporary server error — rethrowing
        // causes PowerSync to retry this transaction after a delay.
        throw ex
      }
    }
  }

  private updateSession(session: Session | null) {
    this.currentSession = session
    if (!session) return
    this.iterateListeners((cb) => cb.sessionStarted?.(session))
  }
}
