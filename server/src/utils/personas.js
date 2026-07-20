/**
 * Persona normalization + prompt formatting helpers.
 * Personas are stored as { name, description } objects. This module also
 * tolerates legacy data where personas were plain strings.
 */

export function normalizePersonas(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((p) => {
      if (typeof p === 'string') {
        const name = p.trim();
        return name ? { name, description: '' } : null;
      }
      if (p && typeof p === 'object') {
        const name = String(p.name || '').trim();
        const description = String(p.description || '').trim();
        return name ? { name, description } : null;
      }
      return null;
    })
    .filter(Boolean);
}

export function formatPersonasForPrompt(input) {
  const personas = normalizePersonas(input);
  if (!personas.length) return '';
  return personas
    .map((p) => (p.description ? `- ${p.name}: ${p.description}` : `- ${p.name}`))
    .join('\n');
}
