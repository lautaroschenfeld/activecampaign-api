import type { NormalizedContactSyncRequest } from "../types/api";
import { ActiveCampaignService } from "./activecampaign-service";

export interface ContactSyncResult {
  contactId: number;
  subscribedListIds: number[];
  taggedTagIds: number[];
  meta: Record<string, unknown>;
  warnings: string[];
}

export class ContactSyncService {
  constructor(private readonly activeCampaignService: ActiveCampaignService) {}

  async syncAndSubscribe(payload: NormalizedContactSyncRequest): Promise<ContactSyncResult> {
    const { contactId } = await this.activeCampaignService.syncContact(payload);
    const { subscribedListIds } = await this.activeCampaignService.addContactToLists(
      contactId,
      payload.list_ids
    );
    const { taggedTagIds } = payload.tag_ids?.length
      ? await this.activeCampaignService.addContactToTags(contactId, payload.tag_ids)
      : { taggedTagIds: [] };

    return {
      contactId,
      subscribedListIds,
      taggedTagIds,
      meta: taggedTagIds.length > 0 ? { tagged_tag_ids: taggedTagIds } : {},
      warnings: []
    };
  }
}
