export interface ActiveCampaignContactSyncRequest {
  contact: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
}

export interface ActiveCampaignContactSyncResponse {
  contact?: {
    id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
}

export interface ActiveCampaignContactListRequest {
  contactList: {
    list: string;
    contact: string;
    status: string;
  };
}

export interface ActiveCampaignContactListResponse {
  contactList?: {
    id?: string;
    list?: string;
    contact?: string;
    status?: string;
  };
}

export interface ActiveCampaignContactTagRequest {
  contactTag: {
    contact: string;
    tag: string;
  };
}

export interface ActiveCampaignContactTagResponse {
  contactTag?: {
    id?: string;
    contact?: string;
    tag?: string;
  };
}

export interface ActiveCampaignErrorResponse {
  errors?: Array<{
    title?: string;
    detail?: string;
  }>;
  [key: string]: unknown;
}
