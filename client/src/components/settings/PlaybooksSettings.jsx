import { BookOpen } from 'lucide-react';
import PromptSettingsSection from './PromptSettingsSection';

export default function PlaybooksSettings() {
  return (
    <PromptSettingsSection
      resource="playbooks"
      label="Playbook"
      icon={BookOpen}
      description={
        <>
          Playbooks define <strong>how to communicate</strong> for a business objective (sell, recruit, partner,
          fundraise…). Each carries an AI prompt with your business context, value proposition, tone, messaging strategy,
          and call to action. Campaigns select a playbook to drive outreach generation.
        </>
      }
      namePlaceholder="e.g. Sell GoodHive to Web3 startups"
      promptPlaceholder="Describe the business context, value proposition, communication style, messaging strategy and call to action for this objective."
      activeHint="Active (selectable in campaigns)"
    />
  );
}
