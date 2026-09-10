import Dashboard from "@/components/Dashboard";
import { fetchLeads, isAirtableConfigured } from "@/lib/airtable";

export default async function Home() {
  const leads = await fetchLeads();
  return <Dashboard initialLeads={leads} demoMode={!isAirtableConfigured} />;
}
