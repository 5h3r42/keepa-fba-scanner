import "./globals.css";
import type { Metadata } from "next";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { DashboardSettingsProvider } from "@/lib/dashboard-settings";

export const metadata: Metadata = {
  title: "FBA SaaS Dashboard",
  description: "Amazon FBA Intelligence Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0b1b34] text-white">
        <DashboardSettingsProvider>
          <div className="flex min-h-screen overflow-x-hidden">
            <DashboardSidebar />

            <main className="flex-1 min-w-0 p-10 bg-[#0b1b34]">
              <div className="bg-[#12284d] border border-[#1e365d] rounded-xl p-10 min-h-[600px] overflow-x-hidden">
                {children}
              </div>
            </main>
          </div>
        </DashboardSettingsProvider>
      </body>
    </html>
  );
}
