import Persona from '../models/Persona.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ensureUniqueName = async ({ organizationId, name, excludeId }) => {
  const existing = await Persona.findOne({
    organization: organizationId,
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();

  return !existing;
};

// GET /api/personas
export const getPersonas = async (req, res) => {
  try {
    const filter = { organization: req.organization._id };
    if (req.query.active === 'true') filter.isActive = true;

    const personas = await Persona.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: personas });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/personas/:id
export const getPersona = async (req, res) => {
  try {
    const persona = await Persona.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    }).lean();

    if (!persona) {
      return res.status(404).json({ success: false, message: 'Persona not found.' });
    }

    res.json({ success: true, data: persona });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/personas
export const createPersona = async (req, res) => {
  try {
    const { name, prompt, isActive } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Persona name is required.' });
    }
    if (!prompt?.trim()) {
      return res.status(400).json({ success: false, message: 'Persona prompt is required.' });
    }

    const hasUniqueName = await ensureUniqueName({
      organizationId: req.organization._id,
      name,
    });
    if (!hasUniqueName) {
      return res.status(409).json({ success: false, message: 'A persona with this name already exists.' });
    }

    const persona = await Persona.create({
      organization: req.organization._id,
      createdBy: req.user._id,
      name: name.trim(),
      prompt: prompt.trim(),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });

    res.status(201).json({ success: true, data: persona });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/personas/:id
export const updatePersona = async (req, res) => {
  try {
    const persona = await Persona.findOne({
      _id: req.params.id,
      organization: req.organization._id,
    });

    if (!persona) {
      return res.status(404).json({ success: false, message: 'Persona not found.' });
    }

    if (typeof req.body.name === 'string') {
      if (!req.body.name.trim()) {
        return res.status(400).json({ success: false, message: 'Persona name cannot be empty.' });
      }
      const hasUniqueName = await ensureUniqueName({
        organizationId: req.organization._id,
        name: req.body.name,
        excludeId: persona._id,
      });
      if (!hasUniqueName) {
        return res.status(409).json({ success: false, message: 'A persona with this name already exists.' });
      }
      persona.name = req.body.name.trim();
    }

    if (typeof req.body.prompt === 'string') {
      if (!req.body.prompt.trim()) {
        return res.status(400).json({ success: false, message: 'Persona prompt cannot be empty.' });
      }
      persona.prompt = req.body.prompt.trim();
    }

    if (req.body.isActive !== undefined) {
      persona.isActive = Boolean(req.body.isActive);
    }

    await persona.save();
    res.json({ success: true, data: persona });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/personas/:id
export const deletePersona = async (req, res) => {
  try {
    const persona = await Persona.findOneAndDelete({
      _id: req.params.id,
      organization: req.organization._id,
    }).lean();

    if (!persona) {
      return res.status(404).json({ success: false, message: 'Persona not found.' });
    }

    res.json({ success: true, message: 'Persona deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
