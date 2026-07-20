import { transcribeAudio } from '../services/ai/geminiClient.js';

export const transcribe = async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body;

    if (!audioBase64 || !mimeType) {
      return res.status(400).json({ success: false, message: 'audioBase64 and mimeType are required.' });
    }

    const text = await transcribeAudio({ audioBase64, mimeType });
    res.json({ success: true, data: { text } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
