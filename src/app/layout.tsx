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
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        <DashboardSettingsProvider>
          <div className="flex min-h-screen overflow-x-hidden">
            <DashboardSidebar />

            <main className="flex-1 min-w-0 bg-zinc-950 p-6 md:p-8">
              <div className="min-h-[600px] overflow-x-hidden rounded-2xl border border-zinc-800 bg-black p-6 shadow-sm md:p-8">
                {children}
              </div>
            </main>
          </div>
        </DashboardSettingsProvider>
      </body>
    </html>
  );
}
