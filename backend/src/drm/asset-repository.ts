import { pool } from '../db/pool';

export type AssetState =
  | 'uploaded'
  | 'validating'
  | 'scanning'
  | 'encrypting'
  | 'storing'
  | 'ready'
  | 'rejected'
  | 'failed';

export interface AssetRow {
  id: string;
  book_id: string;
  version: number;
  state: AssetState;
  reason_code: string | null;
  reason_detail: string | null;
  /** BIGINT: node-postgres returns it as a string. */
  original_size_bytes: string;
  object_key: string | null;
  ciphertext_size_bytes: string | null;
  ciphertext_sha256: string | null;
  encryption_algorithm: string;
  nonce: Buffer | null;
  auth_tag: Buffer | null;
  extracted_metadata: unknown;
  uploaded_by: string | null;
  created_at: Date;
  updated_at: Date;
  ready_at: Date | null;
  activated_at: Date | null;
  activated_by: string | null;
}

/** The book's current asset, only if it is `ready`; otherwise null. */
export async function currentReadyAsset(bookId: string): Promise<AssetRow | null> {
  const { rows } = await pool.query<AssetRow>(
    `SELECT ba.*
       FROM books b
       JOIN book_assets ba ON ba.id = b.current_asset_id
      WHERE b.id = $1 AND ba.state = 'ready'`,
    [bookId],
  );
  return rows[0] ?? null;
}
