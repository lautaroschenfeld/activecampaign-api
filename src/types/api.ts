export interface ContactSyncRequest {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  country?: string;
  consent?: boolean;
  list_ids: number[];
  tag_ids?: number[];
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  page_url?: string;
  referrer?: string;
}

export interface NormalizedContactSyncRequest {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  country?: string;
  consent?: boolean;
  list_ids: number[];
  tag_ids?: number[];
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  page_url?: string;
  referrer?: string;
}

export interface ContactSyncSuccessResponse {
  ok: true;
  request_id: string;
  action: "synced";
  contact_id: number;
  subscribed_list_ids: number[];
  meta: Record<string, unknown>;
  warnings: string[];
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface ApiErrorResponse {
  ok: false;
  request_id: string;
  error: ApiErrorPayload;
}

export interface HealthResponse {
  ok: true;
  service: string;
  version: string;
  environment: string;
  timestamp: string;
}
