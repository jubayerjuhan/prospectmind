/**
 * Campaign persona helpers.
 *
 * A campaign targets first-class `Persona` records selected from Settings.
 * These helpers resolve that selection and turn it into a prompt block, so the
 * personas drive scoring, signal context and outreach the same way the old
 * inline `targetPersonas` notes used to.
 */

import Persona from '../models/Persona.js';

const MAX_PROMPT_CHARS_PER_PERSONA = 800;

const clip = (text = '', max = MAX_PROMPT_CHARS_PER_PERSONA) => {
  const value = String(text).trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

/**
 * The Personas a campaign targets: its explicit selection, or every active
 * Persona in the org when nothing is selected.
 *
 * @param {Object} campaign ProspectList doc/lean object ({ organization, personas })
 * @returns {Promise<Array>} Persona docs ({ _id, name, prompt })
 */
export async function loadCampaignPersonas(campaign) {
  const organization = campaign?.organization;
  if (!organization) return [];

  const selected = campaign.personas || [];
  return Persona.find(
    selected.length
      ? { _id: { $in: selected }, organization }
      : { organization, isActive: true }
  )
    .select('_id name prompt')
    .lean();
}

/** Render Personas as a prompt block: one clipped `- Name: definition` per line. */
export function formatPersonasForPrompt(personas) {
  if (!Array.isArray(personas)) return '';
  return personas
    .filter((persona) => persona?.name)
    .map((persona) => (persona.prompt ? `- ${persona.name}: ${clip(persona.prompt)}` : `- ${persona.name}`))
    .join('\n');
}

/**
 * Find-or-create Personas by name for an org and return their ids. Used to seed
 * a campaign with default personas without duplicating existing ones.
 *
 * @param {Object} params
 * @param {ObjectId} params.organization
 * @param {ObjectId} params.createdBy
 * @param {Array} params.definitions [{ name, prompt }]
 * @returns {Promise<Array<ObjectId>>}
 */
export async function ensurePersonas({ organization, createdBy, definitions = [] }) {
  const ids = [];

  for (const { name, prompt } of definitions) {
    if (!name?.trim() || !prompt?.trim()) continue;
    const existing = await Persona.findOne({ organization, name: name.trim() }).select('_id').lean();
    if (existing) {
      ids.push(existing._id);
      continue;
    }
    const created = await Persona.create({
      organization,
      createdBy,
      name: name.trim(),
      prompt: prompt.trim(),
    });
    ids.push(created._id);
  }

  return ids;
}
