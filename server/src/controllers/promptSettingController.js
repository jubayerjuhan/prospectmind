/**
 * Shared CRUD controller factory for prompt-driven Settings entities
 * (Persona, Playbook, Signal — HLD §3). All three share the same shape:
 * org-scoped { name, prompt, isActive } with unique names per org.
 *
 * `options.appliesTo: true` enables the Signal-only appliesTo field.
 */

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const APPLIES_TO_VALUES = ['prospect', 'company'];

const parseAppliesTo = (input) => {
  if (!Array.isArray(input)) return { ok: false };
  const values = [...new Set(input.map(String))];
  if (values.length === 0 || values.some((v) => !APPLIES_TO_VALUES.includes(v))) {
    return { ok: false };
  }
  return { ok: true, values };
};

export const makePromptSettingController = (Model, label, { appliesTo = false } = {}) => {
  const lower = label.toLowerCase();

  const ensureUniqueName = async ({ organizationId, name, excludeId }) => {
    const existing = await Model.findOne({
      organization: organizationId,
      name: { $regex: `^${escapeRegex(name.trim())}$`, $options: 'i' },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).lean();
    return !existing;
  };

  const list = async (req, res) => {
    try {
      const filter = { organization: req.organization._id };
      if (req.query.active === 'true') filter.isActive = true;
      const docs = await Model.find(filter).sort({ createdAt: -1 }).lean();
      res.json({ success: true, data: docs });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const getOne = async (req, res) => {
    try {
      const doc = await Model.findOne({ _id: req.params.id, organization: req.organization._id }).lean();
      if (!doc) return res.status(404).json({ success: false, message: `${label} not found.` });
      res.json({ success: true, data: doc });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const create = async (req, res) => {
    try {
      const { name, prompt, isActive } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({ success: false, message: `${label} name is required.` });
      }
      if (!prompt?.trim()) {
        return res.status(400).json({ success: false, message: `${label} prompt is required.` });
      }

      const payload = {
        organization: req.organization._id,
        createdBy: req.user._id,
        name: name.trim(),
        prompt: prompt.trim(),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      };

      if (appliesTo && req.body.appliesTo !== undefined) {
        const parsed = parseAppliesTo(req.body.appliesTo);
        if (!parsed.ok) {
          return res.status(400).json({ success: false, message: `appliesTo must be a non-empty subset of: ${APPLIES_TO_VALUES.join(', ')}.` });
        }
        payload.appliesTo = parsed.values;
      }

      const hasUniqueName = await ensureUniqueName({ organizationId: req.organization._id, name });
      if (!hasUniqueName) {
        return res.status(409).json({ success: false, message: `A ${lower} with this name already exists.` });
      }

      const doc = await Model.create(payload);
      res.status(201).json({ success: true, data: doc });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const update = async (req, res) => {
    try {
      const doc = await Model.findOne({ _id: req.params.id, organization: req.organization._id });
      if (!doc) return res.status(404).json({ success: false, message: `${label} not found.` });

      if (typeof req.body.name === 'string') {
        if (!req.body.name.trim()) {
          return res.status(400).json({ success: false, message: `${label} name cannot be empty.` });
        }
        const hasUniqueName = await ensureUniqueName({
          organizationId: req.organization._id,
          name: req.body.name,
          excludeId: doc._id,
        });
        if (!hasUniqueName) {
          return res.status(409).json({ success: false, message: `A ${lower} with this name already exists.` });
        }
        doc.name = req.body.name.trim();
      }

      if (typeof req.body.prompt === 'string') {
        if (!req.body.prompt.trim()) {
          return res.status(400).json({ success: false, message: `${label} prompt cannot be empty.` });
        }
        doc.prompt = req.body.prompt.trim();
      }

      if (appliesTo && req.body.appliesTo !== undefined) {
        const parsed = parseAppliesTo(req.body.appliesTo);
        if (!parsed.ok) {
          return res.status(400).json({ success: false, message: `appliesTo must be a non-empty subset of: ${APPLIES_TO_VALUES.join(', ')}.` });
        }
        doc.appliesTo = parsed.values;
      }

      if (req.body.isActive !== undefined) {
        doc.isActive = Boolean(req.body.isActive);
      }

      await doc.save();
      res.json({ success: true, data: doc });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const remove = async (req, res) => {
    try {
      const doc = await Model.findOneAndDelete({ _id: req.params.id, organization: req.organization._id }).lean();
      if (!doc) return res.status(404).json({ success: false, message: `${label} not found.` });
      res.json({ success: true, message: `${label} deleted.` });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  return { list, getOne, create, update, remove };
};
