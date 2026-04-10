import type {
  ActiveCampaignContactListRequest,
  ActiveCampaignContactListResponse,
  ActiveCampaignContactSyncRequest,
  ActiveCampaignContactSyncResponse
} from "../types/activecampaign";
import type { NormalizedContactSyncRequest } from "../types/api";
import { ProviderError } from "../utils/errors";
import { ActiveCampaignClient } from "./activecampaign-client";

export class ActiveCampaignService {
  constructor(private readonly client: ActiveCampaignClient) {}

  async syncContact(input: NormalizedContactSyncRequest): Promise<{ contactId: number }> {
    const payload: ActiveCampaignContactSyncRequest = {
      contact: {
        email: input.email,
        firstName: input.first_name,
        lastName: input.last_name,
        phone: input.phone
      }
    };

    const response = await this.client.request<ActiveCampaignContactSyncResponse>({
      method: "POST",
      path: "contact/sync",
      body: payload
    });

    const contactId = Number(response.contact?.id);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      throw new ProviderError("Invalid sync contact response", {
        provider_response: response
      });
    }

    return { contactId };
  }

  async addContactToList(contactId: number, listId: number): Promise<void> {
    const payload: ActiveCampaignContactListRequest = {
      contactList: {
        list: String(listId),
        contact: String(contactId),
        status: "1"
      }
    };

    const response = await this.client.request<ActiveCampaignContactListResponse>({
      method: "POST",
      path: "contactLists",
      body: payload
    });

    if (!response.contactList) {
      throw new ProviderError("Invalid add contact to list response", {
        provider_response: response,
        list_id: listId
      });
    }
  }

  async addContactToLists(contactId: number, listIds: number[]): Promise<{ subscribedListIds: number[] }> {
    const subscribedListIds: number[] = [];

    for (const listId of listIds) {
      try {
        await this.addContactToList(contactId, listId);
        subscribedListIds.push(listId);
      } catch (error) {
        if (error instanceof ProviderError) {
          throw new ProviderError("Failed to subscribe contact to list", {
            ...error.details,
            contact_id: contactId,
            list_id: listId,
            subscribed_list_ids: subscribedListIds
          });
        }

        throw error;
      }
    }

    return { subscribedListIds };
  }
}
