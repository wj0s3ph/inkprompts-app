export type PendingDraftResolution = 'saved' | 'discard-authorized' | 'cancelled'

export interface PendingDraftRequest {
  action: string
  concealDetails?: boolean
}

export type ProtectPendingDraft = (request: PendingDraftRequest) => Promise<PendingDraftResolution>
