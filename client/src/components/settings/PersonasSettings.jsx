import { Users } from 'lucide-react';
import PromptSettingsSection from './PromptSettingsSection';

export default function PersonasSettings() {
  return (
    <PromptSettingsSection
      resource="personas"
      label="Persona"
      icon={Users}
      description={
        <>
          Personas describe the <strong>types of prospects</strong> you target (Founder, CTO, Recruiter…). Each carries an
          AI prompt that tells the pipeline how to recognize and score that type. A prospect is scored against every active persona.
        </>
      }
      namePlaceholder="e.g. Founder hiring Web3 talent"
      promptPlaceholder="Describe how to recognize and score this type of prospect. e.g. 'You are evaluating whether this prospect is a founder hiring Web3 engineers. Consider… Give a score 0-100 with evidence.'"
      activeHint="Active (used in scoring)"
    />
  );
}
