import Dashboard from "@/components/Dashboard";
import { fetchLeads, isAirtableConfigured } from "@/lib/airtable";
import type { Lead } from "@/lib/types";

export default async function Home() {
  let leads: Lead[];
  let loadError: string | null = null;
  try {
    leads = await fetchLeads();
  } catch (err) {
    console.error("Failed to load leads:", err);
    leads = [];
    loadError = "Couldn't load leads from Airtable right now — try refreshing.";
  }
  return (
    <Dashboard
      initialLeads={leads}
      demoMode={!isAirtableConfigured}
      initialError={loadError}
    />
  );
}
