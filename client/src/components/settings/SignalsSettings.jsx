import { Radar } from 'lucide-react';
import PromptSettingsSection from './PromptSettingsSection';

export default function SignalsSettings() {
  return (
    <PromptSettingsSection
      resource="signals"
      label="Signal"
      icon={Radar}
      description={
        <>
          Signals define the <strong>business information to detect</strong> (hiring activity, funding, product launches,
          tech stack…). Each carries an AI prompt explaining what to detect, where to look, and how to qualify the result.
          A signal applies to prospects, companies, or both.
        </>
      }
      namePlaceholder="e.g. Engineering Hiring Activity"
      promptPlaceholder="Describe what to detect, where to look for evidence, and how to qualify the result."
      activeHint="Active (used in detection)"
      showAppliesTo
    />
  );
}
