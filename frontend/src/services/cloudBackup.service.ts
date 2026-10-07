/**
 * cloudBackup.service.ts
 * ======================
 * HTTP calls for the cloud backup / disaster recovery API.
 * Endpoint base: /api/v1/backups/
 *
 * Cloud backups are stored on the Render server per business.
 * On a fresh PC install, the system checks for an existing cloud backup
 * matching the current business and offers the customer to restore it.
 */
import api from './api';

export interface CloudBackupEntry {
  id: string;
  filename: string;
  size_mb: number;
  created_at: string;
  notes: string;
}

export interface CloudBackupListResponse {
  backups: CloudBackupEntry[];
}

export interface CloudBackupUploadResponse {
  id: string;
  filename: string;
  size_mb: number;
  created_at: string;
}

/** Upload a fresh backup of the current database to the cloud */
export async function uploadCloudBackup(notes?: string): Promise<CloudBackupUploadResponse> {
  const res = await api.post<CloudBackupUploadResponse>('/backups/cloud-upload/', { notes: notes ?? '' }, {
    timeout: 300_000, // 5 min — pg_dump can take time
  });
  return res.data;
}

/** List all cloud backups for the current business */
export async function listCloudBackups(): Promise<CloudBackupEntry[]> {
  const res = await api.get<CloudBackupListResponse>('/backups/cloud-list/');
  return res.data.backups ?? [];
}

/** Download a cloud backup as a Blob (for import/restore) */
export async function downloadCloudBackup(id: string): Promise<Blob> {
  const res = await api.get(`/backups/cloud-download/${id}/`, {
    responseType: 'blob',
    timeout: 300_000,
  });
  return res.data as Blob;
}

/** Delete a cloud backup */
export async function deleteCloudBackup(id: string): Promise<void> {
  await api.delete(`/backups/cloud-delete/${id}/`);
}
