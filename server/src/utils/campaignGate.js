/**
 * Campaign Gate — checks whether a prospect's campaign has the minimum required
 * settings before allowing the AI pipeline to run.
 *
 * Rules:
 *  - If the prospect is NOT in any campaign → allowed (orphan prospects run freely)
 *  - If the prospect IS in a campaign → both campaignDescription AND
 *    targetEcosystemContext must be non-empty strings.
 */

import ProspectList from '../models/ProspectList.js';

/**
 * @param {string|ObjectId} prospectId
 * @param {string|ObjectId} organizationId
 * @returns {{ allowed: boolean, campaignId?: string, campaignName?: string, missingFields?: string[] }}
 */
export const checkCampaignGate = async (prospectId, organizationId) => {
  const campaign = await ProspectList.findOne({
    organization: organizationId,
    type: 'manual',
    isArchived: false,
    prospects: prospectId,
  })
    .select('_id name campaignDescription targetEcosystemContext')
    .lean();

  // No campaign found — prospect is standalone, always allowed
  if (!campaign) {
    return { allowed: true };
  }

  const missingFields = [];
  if (!campaign.campaignDescription?.trim()) missingFields.push('Campaign Description & Goals');
  if (!campaign.targetEcosystemContext?.trim()) missingFields.push('Target Ecosystem & Context');

  if (missingFields.length > 0) {
    return {
      allowed: false,
      campaignId: campaign._id.toString(),
      campaignName: campaign.name,
      missingFields,
    };
  }

  return {
    allowed: true,
    campaignId: campaign._id.toString(),
    campaignName: campaign.name,
  };
};
