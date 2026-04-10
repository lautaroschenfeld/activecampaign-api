import type {
  ActiveCampaignContactTagRequest,
  ActiveCampaignContactTagResponse,
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

  async addContactTag(contactId: number, tagId: number): Promise<void> {
    const payload: ActiveCampaignContactTagRequest = {
      contactTag: {
        contact: String(contactId),
        tag: String(tagId)
      }
    };

    try {
      const response = await this.client.request<ActiveCampaignContactTagResponse>({
        method: "POST",
        path: "contactTags",
        body: payload
      });

      if (!response.contactTag) {
        throw new ProviderError("Invalid add contact tag response", {
          provider_response: response,
          tag_id: tagId
        });
      }
    } catch (error) {
      if (
        error instanceof ProviderError &&
        this.isDuplicateContactTagError(error)
      ) {
        return;
      }

      throw error;
    }
  }

  async addContactToTags(contactId: number, tagIds: number[]): Promise<{ taggedTagIds: number[] }> {
    const taggedTagIds: number[] = [];

    for (const tagId of tagIds) {
      try {
        await this.addContactTag(contactId, tagId);
        taggedTagIds.push(tagId);
      } catch (error) {
        if (error instanceof ProviderError) {
          throw new ProviderError("Failed to tag contact", {
            ...error.details,
            contact_id: contactId,
            tag_id: tagId,
            tagged_tag_ids: taggedTagIds
          });
        }

        throw error;
      }
    }

    return { taggedTagIds };
  }

  private isDuplicateContactTagError(error: ProviderError): boolean {
    const providerStatus = error.details.provider_status;
    if (providerStatus !== 409 && providerStatus !== 422) {
      return false;
    }

    const providerResponse = error.details.provider_response;
    if (!providerResponse || typeof providerResponse !== "object") {
      return false;
    }

    const errors = (providerResponse as { errors?: unknown }).errors;
    if (!Array.isArray(errors)) {
      return false;
    }

    return errors.some((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const title = "title" in item && typeof item.title === "string" ? item.title : "";
      const detail = "detail" in item && typeof item.detail === "string" ? item.detail : "";
      const combined = `${title} ${detail}`.toLowerCase();

      return combined.includes("already") || combined.includes("duplicate");
    });
  }
}
